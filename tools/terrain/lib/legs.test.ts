import { describe, expect, it } from 'vitest';
import { components } from './components';
import { MAP_ORIGIN_YD } from './formats/grid';
import { legsFrom, scratch, SWIM_FACTOR } from './legs';
import { buildMapMesh } from './link';
import { blockOf, firstTile, PARAMS, square, tileOf } from './nav-test-support';

const { tx0, tz0 } = firstTile(28, 36);
const X = (vx: number): number => -MAP_ORIGIN_YD + tx0 * PARAMS.tileYd + vx * PARAMS.cs;
const Y = (vz: number): number => MAP_ORIGIN_YD - tz0 * PARAMS.tileYd - vz * PARAMS.cs;

describe('legsFrom, the build-side reference for G10 (terrain-navigation.md §9.1)', () => {
  it('walks a straight corridor at its straight length and splits ground from swim', () => {
    const polys = [0, 1, 2, 3, 4].map((i) => square(i * 20, 0, i * 20 + 20, 20));
    const g = buildMapMesh([blockOf(28, 36, [tileOf(tx0, tz0, polys, [false, true, true, false, false])])], PARAMS);
    const c = components(g);
    const [leg] = legsFrom(g, c.comp, scratch(g), { x: X(10), y: Y(10), poly: 0 }, [{ x: X(90), y: Y(10), poly: 4 }]);
    expect(leg?.reachable).toBe(true);
    const total = 80 * PARAMS.cs;
    // each part is rounded to a tenth-yard
    expect(Math.abs(((leg?.groundTenths ?? 0) + (leg?.swimTenths ?? 0)) / 10 - total)).toBeLessThanOrEqual(0.1);
    expect((leg?.swimTenths ?? 0) / 10).toBeCloseTo(40 * PARAMS.cs, 1);
    expect(leg?.longestSwimYd).toBeCloseTo(40 * PARAMS.cs, 6);
    expect(leg?.corridor).toBe(5);
    expect(SWIM_FACTOR).toBeCloseTo(7 / 4.72, 12);
  });

  it('pulls the path tight around the inner corner of an L bend', () => {
    // squares 0..2 along x, then 3..4 up along z from the last one
    const polys = [square(0, 0, 20, 20), square(20, 0, 40, 20), square(40, 0, 60, 20), square(40, 20, 60, 40), square(40, 40, 60, 60)];
    const g = buildMapMesh([blockOf(28, 36, [tileOf(tx0, tz0, polys)])], PARAMS);
    const c = components(g);
    const [leg] = legsFrom(g, c.comp, scratch(g), { x: X(10), y: Y(10), poly: 0 }, [{ x: X(50), y: Y(50), poly: 4 }]);
    // corner at (40, 20): from (10, 10) and on to (50, 50)
    const d = (ax: number, az: number, bx: number, bz: number): number => Math.sqrt((bx - ax) ** 2 + (bz - az) ** 2) * PARAMS.cs;
    expect((leg?.groundTenths ?? 0) / 10).toBeCloseTo(d(10, 10, 40, 20) + d(40, 20, 50, 50), 1);
  });

  it('answers unreachable for another component without searching, and is deterministic', () => {
    const polys = [square(0, 0, 20, 20), square(100, 100, 120, 120)];
    const g = buildMapMesh([blockOf(28, 36, [tileOf(tx0, tz0, polys)])], PARAMS);
    const c = components(g);
    const s = scratch(g);
    const [leg] = legsFrom(g, c.comp, s, { x: X(10), y: Y(10), poly: 0 }, [{ x: X(110), y: Y(110), poly: 1 }]);
    expect(leg?.reachable).toBe(false);
    const again = legsFrom(g, c.comp, s, { x: X(10), y: Y(10), poly: 0 }, [{ x: X(15), y: Y(15), poly: 0 }]);
    expect(again).toEqual(legsFrom(g, c.comp, scratch(g), { x: X(10), y: Y(10), poly: 0 }, [{ x: X(15), y: Y(15), poly: 0 }]));
  });
});
