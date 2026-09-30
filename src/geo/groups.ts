/**
 * Grid groups and convex hulls (docs/research/map-presentation.md §7.4; step MP.3): the faint
 * outlines round the objective points of the quests in the log. Pure and deterministic: no DOM,
 * clock, randomness or bitwise operator, and the same points always give the same groups in the
 * same order.
 *
 * The points are world yards on one world map (D-017): the outlines are drawn, never measured, and
 * nothing here converts between maps.
 */

/** What the groups and hulls read of a point. */
export interface PlanePoint {
  readonly x: number;
  readonly y: number;
}

/** The objective outlines' grid (§7.4): 90 yd cells. */
export const OUTLINE_CELL_YARDS = 90;

/** A group needs this many points for an outline (§7.4). */
export const OUTLINE_MIN_POINTS = 5;

const cellOf = (value: number, cell: number): number => Math.floor(value / cell);

/**
 * The points binned on a grid of `cell` yards, with touching cells (8-connected) joined into one
 * group. Groups come in the order of their first cell (by row, then column), and each group's
 * points in input order. Points with a non-finite coordinate are left out. `cell` must be positive.
 */
export function gridGroups<P extends PlanePoint>(points: readonly P[], cell: number): readonly (readonly P[])[] {
  if (!(cell > 0) || !Number.isFinite(cell)) throw new RangeError(`gridGroups: the cell must be a positive number of yards, not ${String(cell)}`);
  const cells = new Map<string, { readonly cx: number; readonly cy: number; readonly members: number[] }>();
  points.forEach((point, index) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const cx = cellOf(point.x, cell);
    const cy = cellOf(point.y, cell);
    const key = `${String(cx)},${String(cy)}`;
    const entry = cells.get(key);
    if (entry === undefined) cells.set(key, { cx, cy, members: [index] });
    else entry.members.push(index);
  });
  const order = [...cells.values()].sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const seen = new Set<string>();
  const groups: P[][] = [];
  for (const start of order) {
    const startKey = `${String(start.cx)},${String(start.cy)}`;
    if (seen.has(startKey)) continue;
    seen.add(startKey);
    const members: number[] = [];
    const queue = [start];
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      if (current === undefined) continue;
      members.push(...current.members);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const key = `${String(current.cx + dx)},${String(current.cy + dy)}`;
          const next = cells.get(key);
          if (next === undefined || seen.has(key)) continue;
          seen.add(key);
          queue.push(next);
        }
      }
    }
    members.sort((a, b) => a - b);
    groups.push(members.flatMap((index) => points[index] ?? []));
  }
  return groups;
}

/** Twice the signed area of the triangle o, a, b: positive when a to b turns anticlockwise about o. */
const cross = (o: PlanePoint, a: PlanePoint, b: PlanePoint): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/**
 * The convex hull of the points (Andrew's monotone chain), anticlockwise in (x, y) from the point
 * with the least x (then the least y), without repeated or collinear points. Fewer than three
 * distinct points, or points all on one line, give the distinct extreme points only (fewer than
 * three), so a caller can tell there is no area to outline.
 */
export function convexHull<P extends PlanePoint>(points: readonly P[]): readonly P[] {
  const sorted = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.x - b.x || a.y - b.y);
  const unique: P[] = [];
  for (const point of sorted) {
    const last = unique.at(-1);
    if (last === undefined || last.x !== point.x || last.y !== point.y) unique.push(point);
  }
  if (unique.length < 3) return unique;
  const lower: P[] = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2] as P, lower[lower.length - 1] as P, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: P[] = [];
  for (let i = unique.length - 1; i >= 0; i -= 1) {
    const point = unique[i] as P;
    while (upper.length >= 2 && cross(upper[upper.length - 2] as P, upper[upper.length - 1] as P, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  const hull = [...lower, ...upper];
  // Collinear input collapses to its two ends.
  return hull.length < 3 ? hull.slice(0, 2) : hull;
}
