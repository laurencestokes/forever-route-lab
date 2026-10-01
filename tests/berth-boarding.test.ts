/**
 * Client berths and their boarding points on the committed navmesh and taxi file (docs/SIMULATION.md
 * TIME-7; D-050 item 4; review TR-03): the table in src/rules/berths.ts is searched again here, so
 * a rebuilt navmesh or taxi file cannot leave it stale.
 *
 * The rule: the boarding point is the nearest 1-yd point within `BOARDING_RADIUS_YD` of the berth
 * (ties by x, then y) whose runtime snap, with no zone hint as dock endpoints have, is a walkable
 * polygon (not water) and not ambiguous. The evidence the radius rests on is checked too: every
 * boat berth snaps to water, the nearest walkable polygon is 13 to 15 yd away but snaps to the water
 * under the deck, and the walk from the nearest flight point to each boarding point needs no swim
 * (Rut'theran's flight point is not in the file: see berths.ts).
 *
 * No client needed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { distToPoly, legsFrom, loadBlock, type NavMesh, openMap, parseNavManifest, rectDistance, SearchScratch, snap, snapBlocks } from '../src/nav';
import { BERTH_BOARDINGS, BOARDING_NAV_REVISION, BOARDING_RADIUS_YD, type BerthBoarding } from '../src/rules/berths';
import { TRANSPORT_SEEDS } from '../src/rules/travel-seeds';
import { REPO_ROOT } from './support/fake-fetch';

const NAV = join(REPO_ROOT, 'public', 'nav');
const manifest = parseNavManifest(JSON.parse(readFileSync(join(NAV, 'manifest.json'), 'utf8')) as unknown);

interface TaxiFile {
  readonly nodes: readonly { readonly id: number; readonly name: string; readonly mapId: number; readonly x: number; readonly y: number }[];
  readonly transports: readonly { readonly pathId: number; readonly stops: readonly (readonly [number, number, number, number])[] }[];
}
const taxi = JSON.parse(readFileSync(join(REPO_ROOT, 'public', 'maps', 'client', 'taxi.json'), 'utf8')) as TaxiFile;

const meshes = new Map<number, NavMesh>();
function meshOf(mapId: number): NavMesh {
  let mesh = meshes.get(mapId);
  if (mesh === undefined) {
    const entry = manifest.maps.find((m) => m.mapId === mapId);
    if (entry === undefined) throw new Error(`map ${String(mapId)} not in the manifest`);
    mesh = openMap(manifest, mapId, readFileSync(join(NAV, entry.mapFile.path)));
    meshes.set(mapId, mesh);
  }
  return mesh;
}
const loader =
  (mesh: NavMesh) =>
  (blocks: readonly number[]): void => {
    for (const b of blocks) {
      const entry = mesh.entry.blocks[b];
      if (entry !== undefined && !mesh.isLoaded(b)) loadBlock(mesh, b, readFileSync(join(NAV, entry.path)));
    }
  };
const snapAt = (mesh: NavMesh, x: number, y: number) => {
  loader(mesh)(snapBlocks(mesh, x, y));
  return snap(mesh, x, y, 0);
};
const walkable = (mesh: NavMesh, x: number, y: number): boolean => {
  const s = snapAt(mesh, x, y);
  return s.poly >= 0 && mesh.swim[s.poly] === 0 && !s.flags.ambiguous;
};

/** The rule, searched again: the nearest walkable-snapping 1-yd point within the radius, ties by x then y. */
function searchBoarding(mesh: NavMesh, bx: number, by: number): { readonly x: number; readonly y: number; readonly d: number } | null {
  const r = BOARDING_RADIUS_YD;
  const candidates: { x: number; y: number; d: number }[] = [];
  for (let dx = -r; dx <= r; dx += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= r) candidates.push({ x: bx + dx, y: by + dy, d });
    }
  }
  candidates.sort((a, b) => a.d - b.d || a.x - b.x || a.y - b.y);
  return candidates.find((c) => walkable(mesh, c.x, c.y)) ?? null;
}

/** 2D yards from (x, y) to the nearest polygon that is not water, among the blocks within `reach`. */
function nearestWalkablePolygon(mesh: NavMesh, x: number, y: number, reach: number): number {
  const blocks: number[] = [];
  mesh.rects.forEach((rect, i) => {
    if (rectDistance(rect, x, y) <= reach) blocks.push(i);
  });
  loader(mesh)(blocks);
  let best = Infinity;
  for (const b of blocks) {
    const block = mesh.block(b);
    if (block === null) continue;
    for (let p = 0; p < block.np; p += 1) if (mesh.swim[block.base + p] === 0) best = Math.min(best, distToPoly(block, p, x, y));
  }
  return best;
}

const stopOf = (entry: BerthBoarding) => taxi.transports.find((path) => path.pathId === entry.pathId)?.stops[entry.stop];
const navMaps = new Set(manifest.maps.map((m) => m.mapId));
const boats = BERTH_BOARDINGS.filter((entry) => entry.fromBerthYd !== 0);

describe('client berths and their boarding points (TIME-7; D-050 item 4; review TR-03)', () => {
  it('was measured on this navigation data, and lists every berth the transport seeds cite on a map with it', () => {
    expect(manifest.navRevision).toBe(BOARDING_NAV_REVISION);
    const cited = TRANSPORT_SEEDS.flatMap((seed) =>
      seed.stops.flatMap((stop) => {
        const at = stop.clientStop ?? null;
        const s = at === null ? undefined : taxi.transports.find((path) => path.pathId === seed.clientPath)?.stops[at];
        return s === undefined || !navMaps.has(s[0]) ? [] : [`${String(seed.clientPath)}:${String(at)}`];
      }),
    );
    expect(BERTH_BOARDINGS.map((entry) => `${String(entry.pathId)}:${String(entry.stop)}`).sort()).toEqual([...new Set(cited)].sort());
    for (const entry of BERTH_BOARDINGS) {
      const s = stopOf(entry);
      expect(s === undefined ? null : { mapId: s[0], x: s[1], y: s[2] }, `${String(entry.pathId)}:${String(entry.stop)}`).toEqual(entry.berth);
    }
  });

  it('equals the rule searched again on the committed navmesh', { timeout: 120_000 }, () => {
    for (const entry of BERTH_BOARDINGS) {
      const found = searchBoarding(meshOf(entry.berth.mapId), entry.berth.x, entry.berth.y);
      const measured = found === null ? { boarding: null, fromBerthYd: null } : { boarding: { mapId: entry.berth.mapId, x: found.x, y: found.y }, fromBerthYd: Math.round(found.d * 10) / 10 };
      expect(measured, `${String(entry.pathId)}:${String(entry.stop)}`).toEqual({ boarding: entry.boarding, fromBerthYd: entry.fromBerthYd });
    }
  });

  it('rests on the evidence: a boat berth snaps to water, and its nearest walkable polygon (13 to 15 yd) snaps to the water under the deck', { timeout: 120_000 }, () => {
    expect(boats).toHaveLength(11);
    const nearest: number[] = [];
    for (const entry of boats) {
      const mesh = meshOf(entry.berth.mapId);
      const own = snapAt(mesh, entry.berth.x, entry.berth.y);
      expect(own.poly >= 0 && mesh.swim[own.poly] === 1, `${String(entry.pathId)}:${String(entry.stop)} snaps to water`).toBe(true);
      nearest.push(nearestWalkablePolygon(mesh, entry.berth.x, entry.berth.y, 30));
    }
    expect(Math.min(...nearest)).toBeGreaterThan(13);
    expect(Math.max(...nearest)).toBeLessThan(15.2);
    // 40 yd (the first proposal) would leave five of the nine boat berths with no boarding point.
    const unique = new Map(boats.map((entry) => [`${String(entry.berth.mapId)}:${String(entry.berth.x)},${String(entry.berth.y)}`, entry.fromBerthYd ?? Infinity]));
    expect(unique.size).toBe(9);
    expect([...unique.values()].filter((d) => d > 40)).toHaveLength(5);
    expect(Math.max(...unique.values())).toBeLessThanOrEqual(BOARDING_RADIUS_YD);
  });

  it('boards where the walk from the nearest flight point needs no swim, where the berth itself needs one', { timeout: 120_000 }, () => {
    const checked: string[] = [];
    for (const entry of boats) {
      const { boarding, berth } = entry;
      if (boarding === null) continue;
      const mesh = meshOf(berth.mapId);
      const node = taxi.nodes
        .filter((candidate) => candidate.mapId === berth.mapId)
        .map((candidate) => ({ candidate, d: Math.hypot(candidate.x - berth.x, candidate.y - berth.y) }))
        .sort((a, b) => a.d - b.d)[0];
      // Rut'theran's flight master (Vesprystus) has no row in the committed file (review TR-10).
      if (node === undefined || node.d > 1300) continue;
      const end = (x: number, y: number) => ({ x, y, poly: snapAt(mesh, x, y).poly });
      const [toBerth, toBoarding] = legsFrom(mesh, new SearchScratch(mesh), end(node.candidate.x, node.candidate.y), [end(berth.x, berth.y), end(boarding.x, boarding.y)], {}, loader(mesh));
      expect(toBerth?.swimTenths, `${node.candidate.name} to the ${String(entry.pathId)}:${String(entry.stop)} berth`).toBeGreaterThan(0);
      expect(toBoarding, `${node.candidate.name} to its boarding point`).toMatchObject({ reachable: true, swimTenths: 0 });
      checked.push(`${String(entry.pathId)}:${String(entry.stop)}`);
    }
    expect(checked).toHaveLength(10);
  });
});
