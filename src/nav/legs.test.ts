import { describe, expect, it } from 'vitest';
import { buildTestMap, square, testManifestJson, tileOf, worldOf, type TestBlock, type TestMap } from '../../tests/support/nav-mesh';
import { blockTileOrigin } from './grid';
import { parseNavManifest } from './manifest';
import { CONNECTOR_YD_PER_SECOND, SWIM_FACTOR } from './cost';
import { legsFrom, LegSearch, navPath, pointHeight, SearchScratch, type Leg, type LegEndpoint } from './legs';
import { type NavMesh } from './mesh';
import { loadBlock } from './open';
import { NavBlocksMissingError, snap } from './snap';

const A = { row0: 28, col0: 36 };
const C = { row0: 28, col0: 44 };
const P0 = parseNavManifest(testManifestJson(1, [{ ...A, polygons: 1 }])).params;
const { tx0, tz0 } = blockTileOrigin(P0, A.row0, A.col0);
const cs = P0.cs;

/** An endpoint at voxel (vx, vz) of tile (tx0 + dtx, tz0 + dtz) on polygon `poly`. */
const at = (poly: number, vx: number, vz: number, dtx = 0, dtz = 0): LegEndpoint => ({ ...worldOf(P0, tx0 + dtx, tz0 + dtz, vx, vz), poly });

const one = (mesh: NavMesh, from: LegEndpoint, to: LegEndpoint, options = {}): Leg => {
  const [leg] = legsFrom(mesh, new SearchScratch(mesh), from, [to], options);
  if (leg === undefined) throw new Error('no leg');
  return leg;
};

/** Length of a corner polyline (x, y, z triples) in 2D. */
const polyline2d = (pts: readonly number[]): number => {
  let s = 0;
  for (let i = 3; i < pts.length; i += 3) s += Math.sqrt(((pts[i] ?? 0) - (pts[i - 3] ?? 0)) ** 2 + ((pts[i + 1] ?? 0) - (pts[i - 2] ?? 0)) ** 2);
  return s;
};

describe('legsFrom on synthetic meshes with exact lengths (terrain-navigation.md §9.1)', () => {
  it('walks a straight corridor at its straight length and splits ground from swim; the parts sum to the path', () => {
    const polys = [0, 1, 2, 3, 4].map((i) => square(i * 20, 0, i * 20 + 20, 20));
    const mesh = buildTestMap([{ ...A, tiles: [tileOf(tx0, tz0, polys, [false, true, true, false, false])] }]).full();
    const leg = one(mesh, at(0, 10, 10), at(4, 90, 10), { withPath: true, with3d: true });
    expect(leg.reachable).toBe(true);
    expect(leg.groundTenths).toBe(Math.round(40 * cs * 10));
    expect(leg.swimTenths).toBe(Math.round(40 * cs * 10));
    expect(leg.longestSwimYd).toBeCloseTo(40 * cs, 9);
    expect(leg.corridor).toBe(5);
    expect(leg.flags).toEqual([]);
    // split sums: each part rounded to a tenth-yard
    expect(Math.abs((leg.groundTenths + leg.swimTenths) / 10 - polyline2d(leg.path ?? []))).toBeLessThanOrEqual(0.1);
    expect(leg.path?.length).toBe(6); // a straight line: two corners
    expect(leg.length3dYd).toBeCloseTo(80 * cs, 9); // flat
  });

  it('pulls the path tight around the inner corner of an L bend', () => {
    const polys = [square(0, 0, 20, 20), square(20, 0, 40, 20), square(40, 0, 60, 20), square(40, 20, 60, 40), square(40, 40, 60, 60)];
    const mesh = buildTestMap([{ ...A, tiles: [tileOf(tx0, tz0, polys)] }]).full();
    const leg = one(mesh, at(0, 10, 10), at(4, 50, 50), { withPath: true });
    const d = (ax: number, az: number, bx: number, bz: number): number => Math.sqrt((bx - ax) ** 2 + (bz - az) ** 2) * cs;
    expect(leg.groundTenths).toBe(Math.round((d(10, 10, 40, 20) + d(40, 20, 50, 50)) * 10));
    // the corner (40, 20) is a path vertex
    const corner = worldOf(P0, tx0, tz0, 40, 20);
    expect(leg.path?.[3]).toBeCloseTo(corner.x, 9);
    expect(leg.path?.[4]).toBeCloseTo(corner.y, 9);
    expect(navPath(mesh, new SearchScratch(mesh), at(0, 10, 10), at(4, 50, 50))).toEqual(leg.path);
    expect(navPath(mesh, new SearchScratch(mesh), at(0, 10, 10), { x: 0, y: 0, poly: -1 })).toBeNull();
  });

  it('swims across a lake only when the dry way round costs more than 7/4.72 of the swim', () => {
    // a 200-voxel lake between the start and the end, and a dry U round it whose sides are h long
    const lake = (h: number): TestMap =>
      buildTestMap([
        {
          ...A,
          tiles: [
            tileOf(
              tx0,
              tz0,
              [
                square(0, 0, 20, 20), // 0 start
                square(20, 0, 220, 20), // 1 lake
                square(220, 0, 240, 20), // 2 end
                square(0, 20, 20, 20 + h), // 3 left side
                square(0, 20 + h, 20, 40 + h), // 4
                square(20, 20 + h, 220, 40 + h), // 5 top
                square(220, 20 + h, 240, 40 + h), // 6
                square(220, 20, 240, 20 + h), // 7 right side
              ],
              [false, true],
            ),
          ],
        },
      ]);
    // dry way round: about 270 cost units against 10 + 200 × 7/4.72 + 10 = 317 for the swim
    const near = one(lake(5).full(), at(0, 10, 10), at(2, 230, 10));
    expect(near.swimTenths).toBe(0);
    expect(near.groundTenths).toBe(Math.round((2 * Math.sqrt(10 ** 2 + 15 ** 2) + 200) * cs * 10));
    expect(near.corridor).toBe(7);
    // with sides of 100 the dry way costs about 460: swim
    const far = one(lake(100).full(), at(0, 10, 10), at(2, 230, 10));
    expect(far.swimTenths).toBe(Math.round(200 * cs * 10));
    expect(far.groundTenths).toBe(Math.round(20 * cs * 10));
    expect(far.corridor).toBe(3);
    expect(SWIM_FACTOR).toBe(7 / 4.72);
  });

  it('flags a swim over 200 yd across three tiles as long-swim', () => {
    const mesh = buildTestMap([
      {
        ...A,
        tiles: [
          tileOf(tx0, tz0, [square(0, 0, 20, 20), square(20, 0, 256, 20)], [false, true]),
          tileOf(tx0 + 1, tz0, [square(0, 0, 256, 20)], [true]),
          tileOf(tx0 + 2, tz0, [square(0, 0, 236, 20), square(236, 0, 256, 20)], [true, false]),
        ],
      },
    ]).full();
    const leg = one(mesh, at(0, 10, 10), at(4, 246, 10, 2));
    expect(leg.swimTenths).toBe(Math.round((236 + 256 + 236) * cs * 10));
    expect(leg.longestSwimYd).toBeGreaterThan(200);
    expect(leg.flags).toEqual(['long-swim']);
  });

  it('passes a partial portal overlap at its end, never outside it', () => {
    const mesh = buildTestMap([{ ...A, tiles: [tileOf(tx0, tz0, [square(200, 0, 256, 40)]), tileOf(tx0 + 1, tz0, [square(0, 30, 60, 90)])] }]).full();
    const leg = one(mesh, at(0, 210, 5), at(1, 50, 80, 1), { withPath: true });
    // the straight line crosses the tile edge at z 40.9, outside the overlap 30..40: it bends at (256, 40)
    expect(leg.groundTenths).toBe(Math.round((Math.sqrt(46 ** 2 + 35 ** 2) + Math.sqrt(50 ** 2 + 40 ** 2)) * cs * 10));
    const bend = worldOf(P0, tx0 + 1, tz0, 0, 40);
    expect(leg.path?.[3]).toBeCloseTo(bend.x, 9);
    expect(leg.path?.[4]).toBeCloseTo(bend.y, 9);
  });

  it('answers unreachable without searching for another component, an unsnapped end, or a missing way back', () => {
    const t = buildTestMap([{ ...A, tiles: [tileOf(tx0, tz0, [square(0, 0, 20, 20), square(100, 100, 120, 120)])] }], { links: [] });
    const mesh = t.full();
    const S = new SearchScratch(mesh);
    const search = new LegSearch(mesh, S, at(0, 10, 10), [at(1, 110, 110), { x: 0, y: 0, poly: -1 }]);
    const status = search.run();
    expect(status.kind).toBe('done');
    if (status.kind === 'done') expect(status.legs.map((l) => l.reason)).toEqual(['other-component', 'unsnapped']);
    expect(search.settled).toBe(0);
    expect(one(mesh, { x: 0, y: 0, poly: -1 }, at(0, 10, 10)).reason).toBe('unsnapped');
  });
});

describe('connectors (§9.1, §11.2) and the resumable search (RC-06)', () => {
  // block A holds polygons 0 (the connector's departure) and 1; block C (not A's neighbour) polygons 2 and 3
  const blocks: TestBlock[] = [
    { ...A, tiles: [tileOf(tx0, tz0, [square(0, 0, 20, 20), square(20, 0, 40, 20)])] },
    { ...C, tiles: [tileOf(tx0, tz0 + 32, [square(0, 0, 20, 20), square(20, 0, 60, 20)])] },
  ];
  const t = buildTestMap(blocks, { links: [{ connector: 0, from: 0, to: 2, costTenths: 125 }] });
  const target: LegEndpoint = { ...worldOf(P0, tx0, tz0 + 32, 50, 10), poly: 3 };

  it('pauses before relaxing a polygon whose connector leads into an unloaded block, then equals the fully loaded answer', () => {
    const mesh = t.open();
    loadBlock(mesh, 0, t.blockBytes[0] ?? new Uint8Array());
    const S = new SearchScratch(mesh);
    const search = new LegSearch(mesh, S, at(1, 32, 10), [target], { withPath: true });
    const first = search.run();
    expect(first).toEqual({ kind: 'needs', blocks: [1] });
    expect(search.settled).toBe(1); // the source settled; polygon 0 waits
    loadBlock(mesh, 1, t.blockBytes[1] ?? new Uint8Array());
    const done = search.run();
    expect(done.kind).toBe('done');
    const full = t.full();
    const expected = one(full, at(1, 32, 10), target, { withPath: true });
    if (done.kind === 'done') expect(done.legs[0]).toEqual(expected);
    // walk to polygon 0's centroid (22 voxels), ride 12.5 s, walk on from polygon 2's centroid (40 voxels)
    expect(expected.connectorTenthsSeconds).toBe(125);
    expect(expected.groundTenths).toBe(Math.round(62 * cs * 10));
    expect(expected.corridor).toBe(4);
    expect(CONNECTOR_YD_PER_SECOND).toBe(7);
  });

  it('keeps a one-way connector one-way: the way back is no-path within one component', () => {
    const mesh = t.full();
    expect(mesh.comp[0]).toBe(mesh.comp[3]);
    expect(one(mesh, target, at(1, 30, 10)).reason).toBe('no-path');
  });

  it('refuses to continue after another search took the scratch or a block was unloaded', () => {
    const mesh = t.full();
    const S = new SearchScratch(mesh);
    const a = new LegSearch(mesh, S, at(1, 30, 10), [target]);
    expect(a.run(1).kind).toBe('yield');
    const b = new LegSearch(mesh, S, at(1, 30, 10), [target]);
    expect(() => a.run()).toThrow(/another search/);
    expect(b.run(1).kind).toBe('yield');
    mesh.removeBlock(0);
    expect(() => b.run()).toThrow(/unloaded during the search/);
    expect(() => new LegSearch(mesh, S, at(1, 30, 10), [target])).toThrow(NavBlocksMissingError);
  });

  it('yields after the budget and ends with the same legs', () => {
    const mesh = t.full();
    const S = new SearchScratch(mesh);
    const search = new LegSearch(mesh, S, at(1, 30, 10), [target, at(0, 5, 5)]);
    let yields = 0;
    for (;;) {
      const status = search.run(1);
      if (status.kind === 'yield') yields += 1;
      else {
        expect(status.kind).toBe('done');
        if (status.kind === 'done') expect(status.legs).toEqual(legsFrom(mesh, new SearchScratch(mesh), at(1, 30, 10), [target, at(0, 5, 5)]));
        break;
      }
    }
    // one polygon per call: the source, polygon 0, then 2 (over the connector) and 3, the last in the final call
    expect(yields).toBe(3);
  });
});

describe('tie-breaks (§9.1: heap by (cost, polygon id), equal-cost relaxations keep the lower parent)', () => {
  // two floors with the same outline, 1 yd apart, between S and T: both routes cost exactly the same
  const make = (upperFirst: boolean): TestMap => {
    const lower = square(0, 0, 256, 40, 40);
    const upper = square(0, 0, 256, 40, 44);
    return buildTestMap(
      [
        {
          ...A,
          tiles: [
            tileOf(tx0, tz0, [square(200, 0, 256, 40, 40)]), // 0: S
            tileOf(tx0 + 1, tz0, upperFirst ? [upper, lower] : [lower, upper]), // 1, 2
            tileOf(tx0 + 2, tz0, [square(0, 0, 56, 40, 42)]), // 3: T
          ],
        },
      ],
      // the upper floor is a tagged passage
      { passages: [{ passage: 0, polygons: [upperFirst ? 1 : 2] }] },
    );
  };

  it('takes the lower polygon id through an exact tie, deterministically', () => {
    const lowerIsLow = make(false).full();
    const upperIsLow = make(true).full();
    const s = at(0, 210, 20);
    const e = at(3, 30, 20, 2);
    const a = one(lowerIsLow, s, e, { withPath: true, with3d: true });
    const b = one(upperIsLow, s, e, { withPath: true, with3d: true });
    // same lengths (the floors have the same outline), different floor: polygon 1 in both
    expect(a.groundTenths).toBe(b.groundTenths);
    expect(a.passages).toEqual([]);
    expect(a.flags).toEqual([]);
    expect(b.passages).toEqual([0]);
    expect(b.flags).toEqual(['unverified-passage']);
    for (let i = 0; i < 5; i += 1) expect(one(upperIsLow, s, e, { withPath: true, with3d: true })).toEqual(b);
  });
});

describe('snap feeds legs; heights for drawing', () => {
  it('snaps with the manifest radius, then legs run from the snapped polygon', () => {
    const mesh = buildTestMap([{ ...A, tiles: [tileOf(tx0, tz0, [square(0, 0, 20, 20), square(20, 0, 40, 20, 48)])] }]).full();
    const w = worldOf(P0, tx0, tz0, 10, 10);
    const s = snap(mesh, w.x, w.y, 0);
    expect(s.poly).toBe(0);
    expect(pointHeight(mesh, 0, w.x, w.y)).toBe(10);
    const w1 = worldOf(P0, tx0, tz0, 30, 10);
    expect(pointHeight(mesh, 1, w1.x, w1.y)).toBe(12);
  });
});
