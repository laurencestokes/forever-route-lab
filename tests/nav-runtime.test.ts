/**
 * The runtime `src/nav` on the committed `public/nav` (terrain-navigation.md §5, §6.1, §7.1, §8.1,
 * §9.1; G12, G8b), against the build's own code in `tools/terrain/lib` (which G5, G5b, G10 and
 * G10b check against Recast and Detour):
 *
 * - every block decodes, and the mesh loaded in a scrambled block order equals the build's
 *   `buildMapMesh` edge for edge: the same targets, portals and order for every pair of polygons;
 * - the components stored in `map.bin` equal a recomputation over the runtime mesh;
 * - snaps (rules A and B) and `legsFrom` equal the build's reference exactly on a fixed Durotar
 *   point set (so the shipped 12-vertex runtime inherits G10b's check against Detour);
 * - legs through a tagged passage carry `unverified-passage`, and only those.
 *
 * No client needed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { components as buildComponents } from '../tools/terrain/lib/components';
import { decodeBlock as buildDecode } from '../tools/terrain/lib/encode';
import { legsFrom as buildLegs, scratch as buildScratch } from '../tools/terrain/lib/legs';
import { buildMapMesh, EDGE_CONNECTOR, type MapMesh } from '../tools/terrain/lib/link';
import { snap as buildSnap, snapIndex } from '../tools/terrain/lib/snap';
import { derive, readBuildConfig } from '../tools/terrain/lib/settings';
import { meshParams } from '../tools/terrain/lib/stage2';
import { hasSide, legsFrom, loadBlock, lowerBound, openMap, parseNavManifest, quantise, recomputeComponents, SearchScratch, snap, type NavMesh } from '../src/nav';
import { REPO_ROOT } from './support/fake-fetch';

const NAV = join(REPO_ROOT, 'public', 'nav');
const manifest = parseNavManifest(JSON.parse(readFileSync(join(NAV, 'manifest.json'), 'utf8')) as unknown);
const derived = derive(readBuildConfig().settings);
const grid = { perAdt: derived.perAdt, blockAdts: derived.settings.blockAdts, tileVoxels: derived.settings.tileVoxels };

interface Loaded {
  readonly mesh: NavMesh;
  readonly build: MapMesh;
}

function load(mapId: number): Loaded {
  const entry = manifest.maps.find((m) => m.mapId === mapId);
  if (entry === undefined) throw new Error(`map ${String(mapId)} not in the manifest`);
  const bytes = entry.blocks.map((b) => readFileSync(join(NAV, b.path)));
  const mesh = openMap(manifest, mapId, readFileSync(join(NAV, entry.mapFile.path)));
  // a scrambled load order: global ids and links must not depend on it
  const order = bytes.map((_, i) => i).sort((a, b) => ((a * 7919) % 101) - ((b * 7919) % 101) || a - b);
  for (const b of order) loadBlock(mesh, b, bytes[b] ?? new Uint8Array());
  const build = buildMapMesh(
    bytes.map((b) => buildDecode(b, grid)),
    meshParams(derived),
  );
  return { mesh, build };
}

/** Per polygon, the runtime edges as (target, ax, ay, bx, by), in iteration order. */
function runtimeEdges(mesh: NavMesh, p: number): number[][] {
  const m = mesh.blockOfPoly(p);
  const lp = p - m.base;
  const out: number[][] = [];
  const a = m.polyFirst[lp] ?? 0;
  const b = m.polyFirst[lp + 1] ?? 0;
  for (let s = a; s < b; s += 1) {
    const q = m.nei[s] ?? -1;
    if (q < 0) continue;
    const va = m.slotVert[s] ?? 0;
    const vb = m.slotVert[s + 1 < b ? s + 1 : a] ?? 0;
    out.push([m.base + q, m.vx[va] ?? 0, m.vy[va] ?? 0, m.vx[vb] ?? 0, m.vy[vb] ?? 0]);
  }
  for (let k = m.cross.first[lp] ?? 0; k < (m.cross.first[lp + 1] ?? 0); k += 1) out.push([m.cross.to[k] ?? 0, m.cross.ax[k] ?? 0, m.cross.ay[k] ?? 0, m.cross.bx[k] ?? 0, m.cross.by[k] ?? 0]);
  const sides = m.outerSides[lp] ?? 0;
  for (let side = 0; side < 4; side += 1) {
    const t = m.sides[side];
    if (!hasSide(sides, side) || t === null || t === undefined) continue;
    for (let k = lowerBound(t.from, p); k < t.from.length && t.from[k] === p; k += 1) out.push([t.to[k] ?? 0, t.ax[k] ?? 0, t.ay[k] ?? 0, t.bx[k] ?? 0, t.by[k] ?? 0]);
  }
  return out;
}

/** Stable sort by target: the order that matters is the order among edges to one target. */
const byTarget = (edges: number[][]): number[][] => edges.map((e, i) => ({ e, i })).sort((x, y) => (x.e[0] ?? 0) - (y.e[0] ?? 0) || x.i - y.i).map((x) => x.e);

for (const mapId of [0, 1]) {
  describe(`map ${String(mapId)}: the runtime mesh equals the build's (G12)`, () => {
    const { mesh, build } = load(mapId);

    it('loads every block in any order into the same polygons, centroids and edges', () => {
      expect(mesh.loaded).toBe(mesh.blockCount);
      expect(mesh.n).toBe(build.n);
      let centroidMismatch = 0;
      let edgeMismatch = 0;
      let edges = 0;
      for (let p = 0; p < build.n; p += 1) {
        if (build.cx[p] !== mesh.cx[p] || build.cy[p] !== mesh.cy[p] || build.cz[p] !== mesh.cz[p] || build.swim[p] !== mesh.swim[p] || build.zone[p] !== mesh.zoneOf(p)) centroidMismatch += 1;
        const want: number[][] = [];
        for (let k = build.eFirst[p] ?? 0; k < (build.eFirst[p + 1] ?? 0); k += 1) {
          if (build.eKind[k] === EDGE_CONNECTOR) continue;
          want.push([build.eTo[k] ?? 0, build.eAx[k] ?? 0, build.eAy[k] ?? 0, build.eBx[k] ?? 0, build.eBy[k] ?? 0]);
        }
        edges += want.length;
        const got = byTarget(runtimeEdges(mesh, p));
        if (JSON.stringify(got) !== JSON.stringify(want)) edgeMismatch += 1;
      }
      expect(centroidMismatch).toBe(0);
      expect(edgeMismatch).toBe(0);
      expect(edges).toBeGreaterThan(900_000);
    });

    it('stores the components a recomputation over the runtime mesh gives', () => {
      const labels = recomputeComponents(mesh);
      let mismatch = 0;
      for (let p = 0; p < mesh.n; p += 1) if (labels.comp[p] !== mesh.comp[p]) mismatch += 1;
      expect(mismatch).toBe(0);
      expect([...labels.sizes]).toEqual([...mesh.sizes]);
      expect(labels.sizes.length).toBe(manifest.maps.find((m) => m.mapId === mapId)?.components);
    });

    it('snaps and walks exactly like the build reference', () => {
      const zone = mapId === 1 ? 14 : 12; // Durotar; Elwynn Forest
      const comp = buildComponents(build);
      const si = snapIndex(build, manifest.params.snapRadiusYd);
      const picked: number[] = [];
      for (let p = 0; p < build.n; p += 1) if (build.zone[p] === zone && comp.comp[p] === 0) picked.push(p);
      expect(picked.length).toBeGreaterThan(1000);
      const step = Math.floor(picked.length / 40);
      const points = picked.filter((_, i) => i % step === 0).slice(0, 40).map((p) => ({ x: quantise(build.cx[p] ?? 0), y: quantise(build.cy[p] ?? 0) }));
      const ends = points.map((q) => {
        const a = snap(mesh, q.x, q.y, zone);
        const b = buildSnap(si, comp.comp, comp.sizes, q.x, q.y, zone, manifest.params.ruleBMinPolygons);
        expect({ poly: a.poly, dist: a.dist, ...a.flags, comps: a.containingComps, floors: a.floors }).toEqual({ poly: b.poly, dist: b.dist, ...b.flags, comps: b.containingComps, floors: b.floors });
        return { x: q.x, y: q.y, poly: a.poly };
      });
      const S = new SearchScratch(mesh);
      const BS = buildScratch(build);
      let compared = 0;
      for (const src of ends.slice(0, 12)) {
        const got = legsFrom(mesh, S, src, ends);
        const want = buildLegs(build, comp.comp, BS, src, ends);
        got.forEach((l, i) => {
          const w = want[i];
          expect([l.reachable, l.groundTenths, l.swimTenths, l.longestSwimYd, l.corridor]).toEqual([w?.reachable, w?.groundTenths, w?.swimTenths, w?.longestSwimYd, w?.corridor]);
          compared += 1;
        });
      }
      expect(compared).toBe(12 * 40);
    });

    if (mapId === 0) {
      it('flags legs through a tagged passage, and only those (G8b, RC-09)', () => {
        const tagged = [...mesh.passagesOf.keys()].sort((a, b) => a - b);
        expect(tagged.length).toBe(49 + 597);
        const S = new SearchScratch(mesh);
        // from each of a few tagged polygons to a polygon of its component outside every passage
        let flagged = 0;
        for (const p of tagged.filter((_, i) => i % 97 === 0)) {
          const src = { x: mesh.cx[p] ?? 0, y: mesh.cy[p] ?? 0, poly: p };
          const [leg] = legsFrom(mesh, S, src, [src]);
          expect(leg?.flags).toContain('unverified-passage');
          expect(leg?.passages.map((k) => manifest.passages[k])).toEqual((mesh.passagesOf.get(p) ?? []).map((k) => manifest.passages[k]));
          flagged += 1;
        }
        expect(flagged).toBeGreaterThan(5);
        // a leg in Elwynn Forest crosses no passage
        const far = [...Array(mesh.n).keys()].filter((p) => mesh.zoneOf(p) === 12 && mesh.comp[p] === 0).slice(0, 2);
        const [a, b] = far.map((p) => ({ x: mesh.cx[p] ?? 0, y: mesh.cy[p] ?? 0, poly: p }));
        if (a !== undefined && b !== undefined) {
          const [leg] = legsFrom(mesh, S, a, [b]);
          expect(leg?.flags).not.toContain('unverified-passage');
        }
      });
    }
  });
}
