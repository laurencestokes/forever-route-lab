import { describe, expect, it } from 'vitest';
import { convexHull, gridGroups, OUTLINE_CELL_YARDS, OUTLINE_MIN_POINTS } from './groups';

/** Grid groups and hulls for the objective outlines (map-presentation.md §7.4; step MP.3). */

const p = (x: number, y: number) => ({ x, y });

describe('gridGroups', () => {
  it('joins points in touching cells, diagonals included, and keeps apart the ones a cell away', () => {
    const points = [p(10, 10), p(95, 95), p(300, 10), p(185, 185), p(-5, -5)];
    // 10,10 and 95,95 and 185,185 touch diagonally (cells 0,0 / 1,1 / 2,2); -5,-5 is in cell -1,-1, which touches 0,0.
    const groups = gridGroups(points, 90);
    expect(groups.map((group) => group.map((point) => `${String(point.x)},${String(point.y)}`))).toEqual([['10,10', '95,95', '185,185', '-5,-5'], ['300,10']]);
  });

  it('is deterministic: groups by their first cell (row, then column), points in input order', () => {
    const points = [p(500, 500), p(0, 0), p(10, 5)];
    expect(gridGroups(points, OUTLINE_CELL_YARDS)).toEqual([[p(0, 0), p(10, 5)], [p(500, 500)]]);
    expect(gridGroups([...points].reverse(), OUTLINE_CELL_YARDS)).toEqual([[p(10, 5), p(0, 0)], [p(500, 500)]]);
  });

  it('leaves out points that are not finite and refuses a cell that is not a positive number', () => {
    expect(gridGroups([p(Number.NaN, 0), p(1, 1)], 90)).toEqual([[p(1, 1)]]);
    expect(() => gridGroups([p(0, 0)], 0)).toThrow(RangeError);
    expect(gridGroups([], 90)).toEqual([]);
  });

  it('uses the design’s outline constants', () => {
    expect(OUTLINE_CELL_YARDS).toBe(90);
    expect(OUTLINE_MIN_POINTS).toBe(5);
  });
});

describe('convexHull', () => {
  it('gives the corners anticlockwise from the least x, without inner or repeated points', () => {
    const hull = convexHull([p(0, 0), p(10, 0), p(10, 10), p(0, 10), p(5, 5), p(10, 10), p(5, 0)]);
    expect(hull).toEqual([p(0, 0), p(10, 0), p(10, 10), p(0, 10)]);
  });

  it('has no area for collinear or too few points, which it says by returning fewer than three', () => {
    expect(convexHull([p(0, 0), p(1, 1), p(2, 2), p(3, 3)])).toHaveLength(2);
    expect(convexHull([p(4, 4), p(4, 4)])).toEqual([p(4, 4)]);
    expect(convexHull([])).toEqual([]);
  });
});
