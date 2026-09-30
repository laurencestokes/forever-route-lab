import { describe, expect, it } from 'vitest';
import { buildDungeons, buildTaxi, buildZones, deltaCode, hasBit, segmentDistance, simplifyIndices } from './build';
import type { AreaRow, TaxiNodeRow, TaxiPathPointRow, TaxiPathRow } from './read';

/*
 * The pure builders of the committed client tables (map-presentation.md §16; D-039 B, C and E),
 * on synthetic rows. The committed files themselves are checked in tools/maps/client-tables.test.ts.
 */

describe('hasBit (no bitwise operators, D-012)', () => {
  it('tests bits of 32-bit column values, negative values as their two’s-complement bits', () => {
    expect(hasBit(1025, 1)).toBe(true);
    expect(hasBit(1025, 2)).toBe(false);
    expect(hasBit(1027, 2)).toBe(true);
    expect(hasBit(18496, 0x800)).toBe(true);
    expect(hasBit(312, 0x800)).toBe(false);
    expect(hasBit(-1, 0x800)).toBe(true);
    expect(hasBit(-2, 1)).toBe(false);
  });
});

describe('Douglas-Peucker and delta coding', () => {
  it('measures distance to the segment, not to the infinite line', () => {
    expect(segmentDistance([5, 3], [0, 0], [10, 0])).toBe(3);
    expect(segmentDistance([14, 3], [0, 0], [10, 0])).toBe(5);
    expect(segmentDistance([3, 4], [0, 0], [0, 0])).toBe(5);
  });

  it('keeps the ends and every point beyond the tolerance, and nothing else', () => {
    const line: [number, number][] = [[0, 0], [10, 1], [20, -1], [30, 0]];
    expect(simplifyIndices(line, 25)).toEqual([0, 3]);
    const bend: [number, number][] = [[0, 0], [100, 10], [200, 100], [300, 110], [400, 0]];
    // (300, 110) lies 110 yd from the chord 0-4; the two before it lie about 25 yd from the chord 0-3.
    expect(simplifyIndices(bend, 150)).toEqual([0, 4]);
    expect(simplifyIndices(bend, 60)).toEqual([0, 3, 4]);
    expect(simplifyIndices(bend, 10)).toEqual([0, 1, 2, 3, 4]);
    // A path that doubles back: every point is within 25 yd of the infinite line, but not of the segment.
    const back: [number, number][] = [[0, 0], [100, 0], [50, 0]];
    expect(simplifyIndices(back, 25)).toEqual([0, 1, 2]);
    expect(simplifyIndices([[1, 1]], 25)).toEqual([0]);
    expect(simplifyIndices([], 25)).toEqual([]);
  });

  it('rounds to 1 yd and codes each point after the first as a difference', () => {
    expect(deltaCode([[10.4, -3.6], [12.5, -3.4], [7, 0]])).toEqual([10, -4, 3, 1, -6, 3]);
  });
});

const node = (id: number, mapId: number, x: number, y: number, flags = 1024): TaxiNodeRow => ({ id, name: `Node ${String(id)}`, mapId, x, y, flags });
const path = (id: number, from: number, to: number, cost: number): TaxiPathRow => ({ id, from, to, cost });
let nextPointId = 1;
const points = (pathId: number, mapId: number | readonly number[], coords: readonly (readonly [number, number, number])[], delays: readonly number[] = []): TaxiPathPointRow[] =>
  coords.map(([x, y, z], index) => {
    nextPointId += 1;
    return { id: nextPointId, pathId, index, mapId: typeof mapId === 'number' ? mapId : (mapId[index] ?? 0), x, y, z, flags: 0, delay: delays[index] ?? 0 };
  });

describe('buildTaxi (D-039 B)', () => {
  const nodes = [node(2, 0, 0, 0, 1025), node(4, 0, 300, 400, 1026), node(8, 0, 0, 1000, 1027), node(9, 30, 0, 0, 1025), node(12, 1, 5, 5, 1024), node(13, 0, 9, 9, 1024)];
  const paths = [
    path(6, 2, 4, 110),
    path(7, 4, 2, 110),
    path(10, 2, 9, 500), // to map 30
    path(11, 2, 8, 0), // free, no stop: not carried
    path(20, 12, 13, 0), // a transport: stops, map change
  ];
  const rows = {
    taxiNodes: nodes,
    taxiPaths: paths,
    taxiPathPoints: [
      // Given out of NodeIndex order on purpose; the legs are 5 and 495 yd long, and (3, 4) lies on the line.
      ...points(6, 0, [[0, 0, 0], [3, 4, 0], [300, 400, 0]]).reverse(),
      ...points(7, 0, [[300, 400, 10], [0, 0, 10]]),
      ...points(10, 0, [[0, 0, 0], [0, 0, 0]]),
      ...points(11, 0, [[0, 0, 0], [0, 1000, 0]]),
      ...points(20, [1, 1, 0, 0], [[5.4, 5.6, 0], [100, 100, 0], [200, 200, 0], [9, 9, 0]], [60, 0, 0, 30]),
    ],
  };

  it('carries paid flights on maps 0 and 1 with their 3D length and simplified shape, and only their nodes', () => {
    const built = buildTaxi(rows);
    expect(built.flights).toEqual([
      { pathId: 6, from: 2, to: 4, l3d: 500, shape: [0, 0, 300, 400] },
      { pathId: 7, from: 4, to: 2, l3d: 500, shape: [300, 400, -300, -400] },
    ]);
    expect(built.nodes).toEqual([
      { id: 2, name: 'Node 2', mapId: 0, x: 0, y: 0, alliance: true, horde: false },
      { id: 4, name: 'Node 4', mapId: 0, x: 300, y: 400, alliance: false, horde: true },
    ]);
    expect(built.counts).toMatchObject({ nodes: 2, flights: 2, pairs: 1, paidPaths: 3, excludedPaidPaths: [{ pathId: 10, reason: 'its nodes are on maps 0 and 30' }], unpaidPathsWithoutStops: [11] });
  });

  it('lists transport paths with their maps in order and their stops', () => {
    expect(buildTaxi(rows).transports).toEqual([{ pathId: 20, maps: [1, 0], stops: [[1, 5, 6, 60], [0, 9, 9, 30]] }]);
    expect(buildTaxi(rows).counts).toMatchObject({ transports: 1, stops: 2 });
  });

  it('refuses a repeated NodeIndex and a paid path with a stop, and skips a path that leaves its map', () => {
    const repeated = { ...rows, taxiPathPoints: [...rows.taxiPathPoints, { ...(rows.taxiPathPoints[0] as TaxiPathPointRow), id: 999 }] };
    expect(() => buildTaxi(repeated)).toThrow(/repeats NodeIndex/);
    const stopping = { ...rows, taxiPathPoints: rows.taxiPathPoints.map((p) => (p.pathId === 7 && p.index === 0 ? { ...p, delay: 30 } : p)) };
    expect(() => buildTaxi(stopping)).toThrow(/Cost > 0 and a stop/);
    const leaving = { ...rows, taxiPathPoints: rows.taxiPathPoints.map((p) => (p.pathId === 7 && p.index === 1 ? { ...p, mapId: 1 } : p)) };
    expect(buildTaxi(leaving).counts.excludedPaidPaths).toContainEqual({ pathId: 7, reason: 'its TaxiPathNode points leave map 0' });
  });
});

const area = (id: number, mapId: number, parentId: number, factionGroupMask: number, flags0 = 64): AreaRow => ({ id, name: `Area ${String(id)}`, mapId, parentId, factionGroupMask, flags0 });

describe('buildZones (D-039 C)', () => {
  const areas = [area(14, 1, 0, 4), area(12, 0, 0, 2), area(16593, 2991, 0, 0, 18496), area(279, 0, 36, 0, 0x800), area(99, 0, 0, 2)];
  const assignments = [{ id: 1, areaId: 14 }, { id: 2, areaId: 12 }, { id: 3, areaId: 16593 }, { id: 4, areaId: 0 }, { id: 5, areaId: 14 }];

  it('takes the areas UiMapAssignment names, once each, with their mask and sanctuary bit', () => {
    const built = buildZones({ areas, assignments });
    expect(built.zones).toEqual([
      { areaId: 12, mapId: 0, name: 'Area 12', factionGroupMask: 2, sanctuary: false },
      { areaId: 14, mapId: 1, name: 'Area 14', factionGroupMask: 4, sanctuary: false },
      { areaId: 16593, mapId: 2991, name: 'Area 16593', factionGroupMask: 0, sanctuary: true },
    ]);
    expect(built.counts).toEqual({ zones: 3, factionGroupMask: { '0': 1, '2': 1, '4': 1 }, sanctuary: 1 });
  });

  it('refuses an assigned area it cannot read, or a subzone', () => {
    expect(() => buildZones({ areas, assignments: [{ id: 1, areaId: 77 }] })).toThrow(/not decoded/);
    expect(() => buildZones({ areas, assignments: [{ id: 1, areaId: 279 }] })).toThrow(/a subzone of 36/);
  });
});

describe('buildDungeons (D-039 E)', () => {
  const input = {
    lfg: [
      { id: 3272, name: 'Ruins', typeId: 0, contentTuningId: 5256 },
      { id: 1, name: 'Caverns', typeId: 0, contentTuningId: 5254 },
      { id: 57, name: 'Zone row', typeId: 4, contentTuningId: 5146 },
      { id: 51, name: 'Battleground row', typeId: 5, contentTuningId: 5146 },
    ],
    contentTuning: [
      { id: 5254, minLevelSquish: 17, maxLevelSquish: 17, lfgMinLevel: 0, lfgMaxLevel: 0 },
      { id: 5256, minLevelSquish: 15, maxLevelSquish: 15, lfgMinLevel: 27, lfgMaxLevel: 27 },
    ],
    maps: [{ id: 43, name: 'Caverns', instanceType: 1 }, { id: 1, name: 'Kalimdor', instanceType: 0 }, { id: 509, name: 'Ruins raid', instanceType: 2 }, { id: 30, name: 'Valley', instanceType: 3 }],
    areas: [area(718, 43, 0, 4), area(719, 43, 718, 0), area(3429, 509, 0, 0), area(14, 1, 0, 4)],
  };

  it('keeps the TypeID 0 rows with their ContentTuning columns as they are, and the dungeon and raid maps', () => {
    const built = buildDungeons(input);
    expect(built.lfg).toEqual([
      { id: 1, name: 'Caverns', contentTuningId: 5254, minLevelSquish: 17, maxLevelSquish: 17, lfgMinLevel: 0, lfgMaxLevel: 0 },
      { id: 3272, name: 'Ruins', contentTuningId: 5256, minLevelSquish: 15, maxLevelSquish: 15, lfgMinLevel: 27, lfgMaxLevel: 27 },
    ]);
    expect(built.instanceMaps).toEqual([
      { id: 43, name: 'Caverns', instanceType: 1, areaIds: [718] },
      { id: 509, name: 'Ruins raid', instanceType: 2, areaIds: [3429] },
    ]);
    expect(built.counts).toEqual({ lfgRows: 2, instanceMaps: 2, dungeonMaps: 1, raidMaps: 1 });
  });

  it('refuses a row whose ContentTuning row is missing', () => {
    expect(() => buildDungeons({ ...input, contentTuning: [] })).toThrow(/names ContentTuning 5254/);
  });
});
