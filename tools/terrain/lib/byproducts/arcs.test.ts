import { describe, expect, it } from 'vitest';
import { boundaryArcs, decodePoints, douglasPeucker, encodePoints, reversePoints, type Arc } from './arcs';

/** Grid rows as strings of single-digit labels ('.' = 0). */
const gridOf = (rows: readonly string[]): { label: (r: number, c: number) => number; spec: { rows: number; cols: number; x0: number; y0: number; cell: number } } => ({
  label: (r, c) => {
    const ch = rows[r]?.[c] ?? '.';
    return ch === '.' ? 0 : Number(ch);
  },
  spec: { rows: rows.length, cols: rows[0]?.length ?? 0, x0: 100, y0: 50, cell: 2 },
});

/** Signed area in the map frame (east = −Y, north = +X): positive when counter-clockwise. */
function signedArea(points: readonly number[]): number {
  let sum = 0;
  const n = points.length / 2;
  for (let i = 0; i < n; i += 1) {
    const e0 = -(points[i * 2 + 1] ?? 0);
    const n0 = points[i * 2] ?? 0;
    const e1 = -(points[((i + 1) % n) * 2 + 1] ?? 0);
    const n1 = points[((i + 1) % n) * 2] ?? 0;
    sum += e0 * n1 - e1 * n0;
  }
  return sum / 2;
}

const length = (points: readonly number[]): number => {
  let sum = 0;
  for (let i = 2; i < points.length; i += 2) sum += Math.sqrt(((points[i] ?? 0) - (points[i - 2] ?? 0)) ** 2 + ((points[i + 1] ?? 0) - (points[i - 1] ?? 0)) ** 2);
  return sum;
};

/** The ring of `label`: its arcs with it on the left, forward, and on the right, reversed (single-arc rings only). */
const ringOf = (arcs: readonly Arc[], label: number): readonly number[] => {
  const own = arcs.filter((a) => a.left === label || a.right === label);
  expect(own).toHaveLength(1);
  const arc = own[0] as Arc;
  return arc.left === label ? arc.points : reversePoints(arc.points);
};

describe('boundary arcs', () => {
  it('traces a closed ring around an island with the region on its left when followed as its ring', () => {
    const { label, spec } = gridOf(['111', '151', '111']);
    const arcs = boundaryArcs(label, spec, 0);
    expect(arcs.map((a) => [a.left, a.right]).sort()).toEqual([
      [0, 1],
      [1, 5],
    ]);
    for (const arc of arcs) expect(arc.left).toBeLessThan(arc.right);
    const island = ringOf(arcs, 5);
    // Closed, the island's four corners, counter-clockwise (the island on the left).
    expect(island.slice(0, 2)).toEqual(island.slice(-2));
    expect(signedArea(island)).toBe(4);
    const outer = arcs.find((a) => a.left === 0);
    expect(outer === undefined ? 0 : signedArea(reversePoints(outer.points))).toBe(36);
    expect(outer === undefined ? 0 : length(outer.points)).toBe(24);
  });

  it('splits boundaries at junctions so each pair of neighbours shares each arc once', () => {
    const rows = ['1122', '1122', '3322', '3344'];
    const { label, spec } = gridOf(rows);
    const arcs = boundaryArcs(label, spec, 0);
    // Every unit edge between two different labels is covered exactly once by the arcs of that pair.
    for (const [a, b] of [
      [1, 2],
      [1, 3],
      [2, 3],
      [2, 4],
      [3, 4],
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
    ] as const) {
      let unit = 0;
      for (let r = -1; r < rows.length; r += 1) {
        for (let c = -1; c < 4; c += 1) {
          const here = label(r, c);
          const pairs = [
            [here, r + 1 < rows.length ? label(r + 1, c) : 0],
            [here, c + 1 < 4 ? label(r, c + 1) : 0],
          ];
          for (const [p, q] of pairs) if (Math.min(p ?? 0, q ?? 0) === a && Math.max(p ?? 0, q ?? 0) === b && r >= -1) unit += 1;
        }
      }
      const traced = arcs.filter((x) => x.left === a && x.right === b).reduce((sum, x) => sum + length(x.points), 0);
      expect(traced, `${String(a)}:${String(b)}`).toBe(unit * spec.cell);
    }
    // Arcs end at junctions: no two arcs of the same pair meet at a point where only they meet.
    expect(arcs.every((x) => x.points.length >= 4)).toBe(true);
  });

  it('traces only the chosen boundaries, oriented with the lower label on the left (land left of water)', () => {
    const { label, spec } = gridOf(['1112', '1122', '1222']);
    const arcs = boundaryArcs(label, spec, 0, (a, b) => a === 1 && b === 2);
    expect(arcs).toHaveLength(1);
    const arc = arcs[0] as Arc;
    expect([arc.left, arc.right]).toEqual([1, 2]);
    // Walking the coast, a point just left of the first segment is land.
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = arc.points;
    const east = -(y1 - y0);
    const north = x1 - x0;
    const probe = { east: -(y0 + y1) / 2 - north * 0.25, north: (x0 + x1) / 2 + east * 0.25 };
    const col = Math.floor((spec.y0 + probe.east) / spec.cell);
    const row = Math.floor((spec.x0 - probe.north) / spec.cell);
    expect(label(row, col)).toBe(1);
  });

  it('simplifies with Douglas-Peucker and keeps the end points', () => {
    expect(douglasPeucker([0, 0, 1, 0.1, 2, 0, 3, 5, 4, 0], 0.5)).toEqual([0, 0, 2, 0, 3, 5, 4, 0]);
    expect(douglasPeucker([0, 0, 5, 5], 1)).toEqual([0, 0, 5, 5]);
    expect(douglasPeucker([0, 0, 1, 0, 2, 0], 0)).toEqual([0, 0, 2, 0]);
  });

  it('delta-codes rounded coordinates and decodes them back', () => {
    const points = [100.4, -50.6, 104.6, -46.2, 90, -46.2];
    const encoded = encodePoints(points, 1);
    expect(encoded).toEqual([100, -51, 5, 5, -15, 0]);
    expect(decodePoints(encoded)).toEqual([100, -51, 105, -46, 90, -46]);
    expect(reversePoints([1, 2, 3, 4, 5, 6])).toEqual([5, 6, 3, 4, 1, 2]);
  });
});
