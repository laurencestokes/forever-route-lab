/**
 * Boundary arcs of a labelled grid (terrain-navigation.md §13.1; D-032), ported from the m3b
 * prototype `byproducts.ts` (our own research code), with an orientation rule added so rings can
 * be assembled from the arcs.
 *
 * - The grid has `rows × cols` cells; cell (r, c) covers world X in [x0 − (r+1)·s, x0 − r·s] and
 *   Y in [y0 − (c+1)·s, y0 − c·s] (row 0 is the northernmost, column 0 the westernmost, as the ADT
 *   grid). Lattice vertex (r, c) is at (x0 − r·s, y0 − c·s). Cells outside the grid have label 0.
 * - An arc is a maximal chain of lattice edges that separate the same two labels. Chains break at
 *   junctions (a vertex where the boundary is not a simple continuation of one pair), so two
 *   neighbouring regions share each arc exactly once. A boundary loop without junctions is one
 *   closed arc (first point = last point).
 * - Orientation: seen on a map with east to the right and north up (east = −Y, north = +X), label
 *   `left` lies to the left of the arc's direction and `right` to its right; every arc is stored
 *   with `left < right`. A region's ring is its arcs with it on the left, followed forward, and its
 *   arcs with it on the right, followed backward.
 * - Each arc is simplified by Douglas-Peucker (square roots only) with fixed end points.
 *
 * Deterministic: edges are numbered in a fixed scan order and walked in that order. No bitwise
 * operators (D-012).
 */

export interface Arc {
  readonly left: number;
  readonly right: number;
  /** World yards: x0, y0, x1, y1, … */
  readonly points: readonly number[];
}

export interface GridSpec {
  readonly rows: number;
  readonly cols: number;
  /** World X of lattice row 0 (the north edge). */
  readonly x0: number;
  /** World Y of lattice column 0 (the west edge). */
  readonly y0: number;
  /** Cell side in yards. */
  readonly cell: number;
}

/** Douglas-Peucker on a flat [x, y, …] list; keeps the end points. */
export function douglasPeucker(points: readonly number[], tolerance: number): number[] {
  const n = points.length / 2;
  if (n <= 2) return [...points];
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const [a, b] = item;
    const ax = points[a * 2] ?? 0;
    const ay = points[a * 2 + 1] ?? 0;
    const dx = (points[b * 2] ?? 0) - ax;
    const dy = (points[b * 2 + 1] ?? 0) - ay;
    const length = Math.sqrt(dx * dx + dy * dy);
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i += 1) {
      const px = (points[i * 2] ?? 0) - ax;
      const py = (points[i * 2 + 1] ?? 0) - ay;
      const d = length > 0 ? Math.abs(px * dy - py * dx) / length : Math.sqrt(px * px + py * py);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) if (keep[i] === 1) out.push(points[i * 2] ?? 0, points[i * 2 + 1] ?? 0);
  return out;
}

/**
 * The arcs between differently labelled cells. `keep(a, b)` (unordered labels) chooses which
 * boundaries to trace; by default all of them.
 */
export function boundaryArcs(
  label: (row: number, col: number) => number,
  grid: GridSpec,
  tolerance: number,
  keep: (a: number, b: number) => boolean = () => true,
): Arc[] {
  const { rows: R, cols: C, x0, y0, cell: s } = grid;
  const at = (r: number, c: number): number => (r < 0 || c < 0 || r >= R || c >= C ? 0 : label(r, c));
  // Directed edges: from, to, left label, right label (see the orientation rule above).
  const from: number[] = [];
  const to: number[] = [];
  const leftOf: number[] = [];
  const rightOf: number[] = [];
  const adjacency = new Map<number, number[]>();
  const vertex = (r: number, c: number): number => r * (C + 1) + c;
  const add = (v0: number, v1: number, left: number, right: number): void => {
    if (left === right || !keep(Math.min(left, right), Math.max(left, right))) return;
    const id = from.length;
    from.push(v0);
    to.push(v1);
    leftOf.push(left);
    rightOf.push(right);
    for (const v of [v0, v1]) {
      const list = adjacency.get(v);
      if (list === undefined) adjacency.set(v, [id]);
      else list.push(id);
    }
  };
  // Eastward edges along lattice rows: north cell on the left, south cell on the right.
  for (let r = 0; r <= R; r += 1) for (let c = 0; c < C; c += 1) add(vertex(r, c), vertex(r, c + 1), at(r - 1, c), at(r, c));
  // Southward edges along lattice columns: east cell on the left, west cell on the right.
  for (let r = 0; r < R; r += 1) for (let c = 0; c <= C; c += 1) add(vertex(r, c), vertex(r + 1, c), at(r, c), at(r, c - 1));

  const used = new Uint8Array(from.length);
  const pairKey = (e: number): string => `${String(Math.min(leftOf[e] ?? 0, rightOf[e] ?? 0))}:${String(Math.max(leftOf[e] ?? 0, rightOf[e] ?? 0))}`;
  const isJunction = (v: number): boolean => {
    const list = adjacency.get(v) ?? [];
    if (list.length !== 2) return true;
    return pairKey(list[0] ?? 0) !== pairKey(list[1] ?? 0);
  };
  const xy = (v: number): [number, number] => [x0 - Math.floor(v / (C + 1)) * s, y0 - (v % (C + 1)) * s];
  const out: Arc[] = [];
  const walk = (first: number, start: number): void => {
    const points: number[] = [...xy(start)];
    // Oriented labels of the chain as walked from `start`.
    const forward = from[first] === start;
    const left = forward ? (leftOf[first] ?? 0) : (rightOf[first] ?? 0);
    const right = forward ? (rightOf[first] ?? 0) : (leftOf[first] ?? 0);
    let v = start;
    let e = first;
    for (;;) {
      used[e] = 1;
      const next = from[e] === v ? (to[e] ?? 0) : (from[e] ?? 0);
      points.push(...xy(next));
      v = next;
      if (isJunction(v)) break;
      const candidate = (adjacency.get(v) ?? []).find((k) => used[k] !== 1);
      if (candidate === undefined) break;
      e = candidate;
    }
    const simplified = douglasPeucker(points, tolerance);
    if (left < right) out.push({ left, right, points: simplified });
    else out.push({ left: right, right: left, points: reversePoints(simplified) });
  };
  for (const [v, list] of adjacency) if (isJunction(v)) for (const e of list) if (used[e] !== 1) walk(e, v);
  for (let e = 0; e < from.length; e += 1) if (used[e] !== 1) walk(e, from[e] ?? 0);
  return out;
}

/** The same polyline in the opposite direction. */
export function reversePoints(points: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = points.length - 2; i >= 0; i -= 2) out.push(points[i] ?? 0, points[i + 1] ?? 0);
  return out;
}

/**
 * Integer delta coding in units of `quantum` yards: `[x0, y0, dx1, dy1, …]` of the rounded
 * coordinates. Lattice points are at least one cell (4.17 yd or more) apart, so 1-yd rounding
 * never merges two of them.
 */
export function encodePoints(points: readonly number[], quantum: number): number[] {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = Math.round((points[i] ?? 0) / quantum);
    const y = Math.round((points[i + 1] ?? 0) / quantum);
    out.push(x - px, y - py);
    px = x;
    py = y;
  }
  return out;
}

/** Inverse of `encodePoints` (in quanta; multiply by the quantum for yards). */
export function decodePoints(deltas: readonly number[]): number[] {
  const out: number[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < deltas.length; i += 2) {
    x += deltas[i] ?? 0;
    y += deltas[i + 1] ?? 0;
    out.push(x, y);
  }
  return out;
}
