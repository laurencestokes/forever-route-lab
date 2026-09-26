import { describe, expect, it } from 'vitest';
import { censusHash, runCensus } from './census';
import { components } from './components';
import { MAP_ORIGIN_YD } from './formats/grid';
import { buildMapMesh } from './link';
import { blockOf, firstTile, PARAMS, square, tileOf } from './nav-test-support';
import { filterBlocks, pruneKeep, remapLinks } from './prune';
import { censusGate, matchEntry, parseReviewed, splitMatches } from './review';
import { readBuildConfig } from './settings';
import { snap, snapIndex } from './snap';
import type { Spawn } from './spawns';
import { shoreDistance, waterKeep, waterSplits } from './water';

const { tx0, tz0 } = firstTile(28, 36);
const X = (vx: number): number => -MAP_ORIGIN_YD + tx0 * PARAMS.tileYd + vx * PARAMS.cs;
const Y = (vz: number): number => MAP_ORIGIN_YD - tz0 * PARAMS.tileYd - vz * PARAMS.cs;

// main: three squares; an upper floor of two squares over the middle one; an island of two squares in zone 17
const tile = tileOf(tx0, tz0, [
  square(0, 0, 10, 10),
  square(10, 0, 20, 10),
  square(20, 0, 30, 10),
  square(11, 2, 15, 8, 80),
  square(15, 2, 19, 8, 80),
  square(100, 100, 110, 110),
  square(110, 100, 120, 110),
]);
const block = blockOf(28, 36, [tile], [14, 14, 14, 14, 14, 17, 17]);
const mesh = buildMapMesh([block], PARAMS);
const comps = components(mesh);
const si = snapIndex(mesh);

const spawn = (kind: 'npc' | 'object', id: number, index: number, vx: number, vz: number, areaKey = 14): Spawn => ({ kind, id, index, areaKey, mapId: 1, x: X(vx), y: Y(vz) });
const spawns: Spawn[] = [
  spawn('npc', 10, 0, 5, 5),
  spawn('npc', 10, 1, 13, 5),
  spawn('object', 5, 0, 105, 105, 17),
  spawn('npc', 20, 3, 115, 105, 17),
  spawn('npc', 30, 0, 200, 200, 99),
  { ...spawn('npc', 40, 0, 5, 5), mapId: 0 },
];
const hintOf = (s: Spawn): number => s.areaKey;
const opt = { minComp: 2, floorMin: 2 };

describe('snap (terrain-navigation.md §8.1)', () => {
  it('prefers containing polygons, then the larger component, and lists every containing floor', () => {
    const r = snap(si, comps.comp, comps.sizes, X(13), Y(5), 14, 0);
    expect(r.poly).toBe(1);
    expect(r.dist).toBe(0);
    expect(r.floors).toEqual([1, 3]);
    expect(r.flags.ambiguous).toBe(true);
    expect(r.flags.spanYd).toBeCloseTo(10, 6);
  });

  it('applies rule A (zone hint) before the order and records a miss', () => {
    expect(snap(si, comps.comp, comps.sizes, X(105), Y(105), 17, 0).flags.hint).toBe('used');
    expect(snap(si, comps.comp, comps.sizes, X(105), Y(105), 99, 0).flags.hint).toBe('miss');
  });

  it('applies rule B (component size) and finds nothing beyond the radius', () => {
    const r = snap(si, comps.comp, comps.sizes, X(13), Y(5), 14, 3);
    expect(r.flags.ruleB).toBe(true);
    expect(r.containingComps).toEqual([0]);
    expect(r.flags.ambiguous).toBe(false);
    expect(snap(si, comps.comp, comps.sizes, X(200), Y(200), 14, 0).poly).toBe(-1);
  });
});

describe('the census, per component with anchors (§12, RC-02, RC-05)', () => {
  const c = runCensus(1, si, comps, spawns, hintOf, opt);

  it('classifies main, off-main, over-an-off-main-floor and unsnapped spawns of its map only', () => {
    expect(c.counts).toMatchObject({ spawns: 5, main: 2, offMain: 2, none: 1, overOffMainFloor: 1 });
    expect(c.offMain.map((r) => [r.anchor, r.spawns, r.polygons])).toEqual([[{ kind: 'npc', id: 20, index: 3 }, 2, 2]]);
    expect(c.overOffMainFloor.map((r) => [r.anchor, r.spawns, r.polygons])).toEqual([[{ kind: 'npc', id: 10, index: 1 }, 1, 2]]);
    expect(c.unsnapped).toEqual([{ kind: 'npc', id: 30, index: 0 }]);
    const z17 = c.zones.find((z) => z.zone === 17);
    expect(z17).toMatchObject({ spawns: 2, dominantSpawns: 2, dominantShare: 1, mainShare: 0 });
    expect(z17?.dominant).toBeGreaterThan(0);
  });

  it('has a hash that ignores component indices and changes with the result', () => {
    expect(censusHash(runCensus(1, si, comps, [...spawns].reverse(), hintOf, opt))).toBe(censusHash(c));
    expect(censusHash(runCensus(1, si, comps, spawns.slice(1), hintOf, opt))).not.toBe(censusHash(c));
  });

  const st = { ...readBuildConfig().stage2, census: { ...readBuildConfig().stage2.census, zoneMinSpawns: 2 } };
  const empty = parseReviewed({ schema: 1, kind: 'nav-census-reviewed', components: [], overOffMainFloor: [], unsnapped: [], zones: [], waterSplits: [], mustConnectExceptions: [] });

  it('fails on every unreviewed component, unsnapped spawn and zone', () => {
    const g = censusGate(c, [], empty, st);
    expect(g.failures).toHaveLength(4);
    expect(g.failures.join('\n')).toMatch(/unreviewed off-main component, anchor npc:20:3/);
    expect(g.failures.join('\n')).toMatch(/off-main floor under or over main spawns, anchor npc:10:1/);
    expect(g.failures.join('\n')).toMatch(/unsnapped spawn npc:30:0/);
    expect(g.failures.join('\n')).toMatch(/zone 17's dominant component is not main/);
  });

  it('passes with reviewed entries, fails on more than 10% growth, and warns on stale entries', () => {
    const anchor = { kind: 'npc' as const, id: 20, index: 3 };
    const reviewed = parseReviewed({
      schema: 1,
      kind: 'nav-census-reviewed',
      components: [{ map: 1, anchor, reason: 'island', spawns: 2 }],
      overOffMainFloor: [{ map: 1, anchor: { kind: 'npc', id: 10, index: 1 }, reason: 'upper-floor', spawns: 1 }],
      unsnapped: [
        { map: 1, kind: 'npc', id: 30, index: 0, reason: 'no-mesh' },
        { map: 1, kind: 'npc', id: 31, index: 0, reason: 'no-mesh' },
      ],
      zones: [{ map: 1, zone: 17, reason: 'island' }],
      waterSplits: [],
      mustConnectExceptions: [],
    });
    const ok = censusGate(c, [], reviewed, st);
    expect(ok.failures).toEqual([]);
    expect(ok.warnings).toEqual(['map 1: reviewed unsnapped spawn npc:31:0 now snaps']);
    const grown = censusGate(c, [], { ...reviewed, components: [{ map: 1, anchor, reason: 'island', spawns: 1 }] }, st);
    expect(grown.failures).toEqual(['map 1: reviewed off-main component npc:20:3 grew from 1 to 2 spawns (more than 10%)']);
    expect(() => parseReviewed({ ...reviewed, components: [...reviewed.components, ...reviewed.components] })).toThrow(/twice/);
  });

  it('tells apart two floors with the same anchor by their size (one spawn over two isolated floors)', () => {
    const anchor = { kind: 'npc' as const, id: 10, index: 1 };
    const floor = (polygons?: number): Record<string, unknown> => ({ map: 1, anchor, reason: 'upper-floor', spawns: 1, ...(polygons === undefined ? {} : { polygons }) });
    const file = (floors: Record<string, unknown>[]): unknown => ({ schema: 1, kind: 'nav-census-reviewed', components: [], overOffMainFloor: floors, unsnapped: [], zones: [], waterSplits: [], mustConnectExceptions: [] });
    expect(() => parseReviewed(file([floor(), floor(40)]))).toThrow(/needs "polygons"/);
    const two = parseReviewed(file([floor(614), floor(40)]));
    const row = c.overOffMainFloor[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(matchEntry(two.overOffMainFloor, 1, { ...row, polygons: 45 })?.polygons).toBe(40);
    expect(matchEntry(two.overOffMainFloor, 1, { ...row, polygons: 600 })?.polygons).toBe(614);
    // one entry cannot review two rows
    const g = censusGate({ ...c, overOffMainFloor: [row, { ...row, comp: 99, polygons: 40 }] }, [], parseReviewed(file([floor(2)])), st);
    expect(g.failures.join()).toMatch(/unreviewed off-main floor/);
  });

  it('matches water split parts by map, zone, size within 25% and 200 yd', () => {
    const e = { map: 1, zone: 141, polygons: 9241, centroid: [9993, 1018] as [number, number], reason: 'transport' as const };
    expect(splitMatches(e, 1, { polygons: 9000, zone: 141, centroid: [10100, 1100], zones: [] })).toBe(true);
    expect(splitMatches(e, 1, { polygons: 6000, zone: 141, centroid: [9993, 1018], zones: [] })).toBe(false);
    expect(splitMatches(e, 1, { polygons: 9241, zone: 141, centroid: [9993, 1300], zones: [] })).toBe(false);
    expect(splitMatches(e, 0, { polygons: 9241, zone: 141, centroid: [9993, 1018], zones: [] })).toBe(false);
  });
});

describe('pruning (§7.2)', () => {
  it('drops small components no spawn stands on or snaps into, keeps connector ends, and remaps ids', () => {
    const lone = tileOf(tx0, tz0 + 1, [square(50, 50, 60, 60)]);
    const b2 = blockOf(28, 36, [tile, lone], [14, 14, 14, 14, 14, 17, 17, 14]);
    const g = buildMapMesh([b2], PARAMS);
    const c = components(g);
    const census = runCensus(1, snapIndex(g), c, spawns.slice(0, 2), hintOf, opt);
    // the island (no spawn in this list) and the lone square are dropped; the upper floor is kept: a spawn stands under it
    const pk = pruneKeep(c, census, 3, []);
    expect([...pk.keep]).toEqual([1, 1, 1, 1, 1, 0, 0, 0]);
    expect(pk).toMatchObject({ droppedPolygons: 3, droppedComponents: 2 });
    const withLink = pruneKeep(c, census, 3, [{ connector: 0, from: 0, to: 7, costTenths: 1 }]);
    expect(withLink.keep[7]).toBe(1);
    const f = filterBlocks([b2], pk.keep);
    expect(f.blocks[0]?.tiles).toHaveLength(1);
    expect([...f.remap]).toEqual([0, 1, 2, 3, 4, -1, -1, -1]);
    expect([...(f.blocks[0]?.zones ?? [])]).toEqual([14, 14, 14, 14, 14]);
    expect(f.blocks[0]?.tiles[0]?.verts.length).toBe(14 * 3);
    expect(() => remapLinks([{ connector: 0, from: 0, to: 7, costTenths: 1 }], f.remap)).toThrow(/dropped/);
  });
});

describe('the open-water rule (§10)', () => {
  it('cuts swim polygons farther than N/2 from the shore and reports the split', () => {
    const polys = [square(0, 0, 10, 10)];
    for (let k = 1; k < 9; k += 1) polys.push(square(k * 10, 0, k * 10 + 10, 10));
    polys.push(square(90, 0, 100, 10));
    const swim = polys.map((_, i) => i > 0 && i < 9);
    const g = buildMapMesh([blockOf(28, 36, [tileOf(tx0, tz0, polys, swim)])], PARAMS);
    const d = shoreDistance(g);
    expect(d[0]).toBe(0);
    expect(d[1]).toBeCloseTo(5 * PARAMS.cs, 9);
    expect(d[2]).toBeCloseTo(15 * PARAMS.cs, 9);
    expect(d[8]).toBeCloseTo(5 * PARAMS.cs, 9);
    const keep = waterKeep(g, d, 20);
    expect([...keep]).toEqual([1, 1, 1, 0, 0, 0, 0, 1, 1, 1]);
    expect([...waterKeep(g, d, 0)].every((k) => k === 1)).toBe(true);
    const splits = waterSplits(g, components(g), keep, 1);
    expect(splits).toHaveLength(1);
    expect(splits[0]?.fullPolygons).toBe(10);
    expect(splits[0]?.parts.map((p) => p.polygons)).toEqual([3, 3]);
  });
});
