import { describe, expect, it } from 'vitest';
import { poleOf, signedDistanceToRings } from './pole';
import { insideRings, ringArea, zoneRingsOf } from './zone-rings';

/**
 * Terrain zone rings and their poles of inaccessibility (docs/research/map-presentation.md §13.2,
 * §12.4; steps MP.7, MP.10): arcs chained into closed rings per area whichever way they run, an
 * enclave cut out by the even-odd rule, and the label anchor inside the land, away from the edges.
 */

const p = (x: number, y: number) => ({ x, y });

describe('zoneRingsOf', () => {
  it('chains the arcs that have an area on either side into closed rings, whichever way each runs', () => {
    // A 10 × 10 square of area 7 in three arcs, the middle one reversed; area 8 lies to the east.
    const lines = [
      [p(0, 0), p(10, 0)],
      [p(10, 10), p(10, 0)],
      [p(10, 10), p(0, 10), p(0, 0)],
    ];
    const sides: [number, number][] = [
      [7, 0],
      [8, 7],
      [7, 0],
    ];
    const rings = zoneRingsOf(lines, sides);
    expect(rings.map((entry) => entry.areaId)).toEqual([7]);
    const [ring] = rings[0]?.rings ?? [];
    expect(ring?.[0]).toEqual(ring?.[ring.length - 1]);
    expect(ringArea(ring ?? [])).toBe(100);
  });

  it('keeps an area with an enclave as two rings, so the even-odd fill leaves the enclave out', () => {
    const outer = [p(0, 0), p(10, 0), p(10, 10), p(0, 10), p(0, 0)];
    const hole = [p(4, 4), p(6, 4), p(6, 6), p(4, 6), p(4, 4)];
    const rings = zoneRingsOf([outer, hole], [
      [1, 0],
      [1, 2],
    ]);
    expect(rings.map((entry) => [entry.areaId, entry.rings.length])).toEqual([
      [1, 2],
      [2, 1],
    ]);
    const zone = rings[0]?.rings ?? [];
    expect(insideRings(zone, 2, 2)).toBe(true);
    expect(insideRings(zone, 5, 5)).toBe(false);
  });

  it('drops arcs that cannot be closed and never joins across a gap', () => {
    expect(zoneRingsOf([[p(0, 0), p(5, 0), p(5, 5)]], [[3, 0]])).toEqual([]);
  });
});

describe('poleOf', () => {
  it('finds the point farthest from every edge, inside the land and away from an enclave', () => {
    const square = [p(0, 0), p(100, 0), p(100, 100), p(0, 100), p(0, 0)];
    const pole = poleOf([square], 1);
    expect(pole?.distance).toBeGreaterThan(49);
    expect(pole?.x).toBeCloseTo(50, 0);
    expect(pole?.y).toBeCloseTo(50, 0);
    // An L shape: the pole is in the wide arm, never at the empty corner the bounding box's centre falls in.
    const ell = [p(0, 0), p(100, 0), p(100, 30), p(30, 30), p(30, 100), p(0, 100), p(0, 0)];
    const inL = poleOf([ell], 1);
    if (inL === null) throw new Error('no pole');
    expect(insideRings([ell], inL.x, inL.y)).toBe(true);
    expect(signedDistanceToRings([ell], inL.x, inL.y)).toBeGreaterThan(10);
    // With an enclave in the middle of the square, the pole moves off it.
    const hole = [p(40, 40), p(60, 40), p(60, 60), p(40, 60), p(40, 40)];
    const around = poleOf([square, hole], 1);
    if (around === null) throw new Error('no pole');
    expect(insideRings([square, hole], around.x, around.y)).toBe(true);
  });

  it('is deterministic, and says so when the rings have no room', () => {
    const ring = [p(0, 0), p(80, 10), p(60, 90), p(-10, 70), p(0, 0)];
    expect(poleOf([ring])).toEqual(poleOf([ring]));
    expect(poleOf([])).toBeNull();
    expect(poleOf([[p(3, 4), p(3, 4)]])).toEqual({ x: 3, y: 4, distance: 0 });
  });
});
