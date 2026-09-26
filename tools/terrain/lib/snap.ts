import { distToPoly, type MapMesh } from './link';

/**
 * Snapping a 2D point to the mesh (terrain-navigation.md §8.1; TN-07, TN-13), ported from the m3b
 * prototype `snap.ts` (our own research code):
 *
 * 1. candidates: every polygon whose 2D distance to the point is ≤ the radius (6 yd; 0 when it
 *    contains the point);
 * 2. rule A (zone): if a candidate's zone equals the hint, keep only those, else record a miss;
 * 3. rule B (size): if some candidates lie in components of at least `minComp` polygons, keep
 *    only those;
 * 4. order: containing first, then distance, then component size (largest first), then the
 *    lowest floor (centroid height), then polygon id;
 * 5. flags: `ambiguous` when the remaining containing candidates span components, `spanYd` the
 *    vertical spread of the containing floors, `none` when no candidate exists.
 *
 * `floors` lists every containing polygon before the rules, for pruning (a floor a spawn stands
 * on is never pruned) and the every-floor checks of RC-05.
 */

export interface SnapIndex {
  readonly g: MapMesh;
  readonly cell: number;
  readonly radius: number;
  readonly bins: ReadonlyMap<number, readonly number[]>;
}

const binKey = (i: number, j: number): number => (i + 1024) * 4096 + (j + 1024);

export function snapIndex(g: MapMesh, radius = 6, cell = 32): SnapIndex {
  const bins = new Map<number, number[]>();
  for (let p = 0; p < g.n; p += 1) {
    let xa = Infinity;
    let xb = -Infinity;
    let ya = Infinity;
    let yb = -Infinity;
    for (let k = g.vFirst[p] ?? 0; k < (g.vFirst[p + 1] ?? 0); k += 1) {
      const x = g.vx[k] ?? 0;
      const y = g.vy[k] ?? 0;
      if (x < xa) xa = x;
      if (x > xb) xb = x;
      if (y < ya) ya = y;
      if (y > yb) yb = y;
    }
    for (let i = Math.floor((xa - radius) / cell); i <= Math.floor((xb + radius) / cell); i += 1) {
      for (let j = Math.floor((ya - radius) / cell); j <= Math.floor((yb + radius) / cell); j += 1) {
        const k = binKey(i, j);
        const list = bins.get(k);
        if (list === undefined) bins.set(k, [p]);
        else list.push(p);
      }
    }
  }
  return { g, cell, radius, bins };
}

export interface SnapFlags {
  hint: 'none' | 'used' | 'miss';
  /** Rule B removed candidates. */
  ruleB: boolean;
  /** The rules changed the component the plain order would pick. */
  reassigned: boolean;
  ambiguous: boolean;
  spanYd: number;
}

export interface SnapResult {
  /** −1: no polygon within the radius. */
  readonly poly: number;
  readonly dist: number;
  readonly flags: SnapFlags;
  /** Components of the containing candidates left after rules A and B, ascending. */
  readonly containingComps: readonly number[];
  /** Every polygon containing the point, before the rules, ascending. */
  readonly floors: readonly number[];
}

interface Candidate {
  readonly p: number;
  readonly d: number;
}

/**
 * Snaps (x, y) with zone hint `hint` (0 = none) against components `comp` and `sizes`. Rule B
 * applies when `minComp > 0`.
 */
export function snap(si: SnapIndex, comp: Int32Array, sizes: readonly number[], x: number, y: number, hint: number, minComp: number): SnapResult {
  const g = si.g;
  const cand: Candidate[] = [];
  for (const p of si.bins.get(binKey(Math.floor(x / si.cell), Math.floor(y / si.cell))) ?? []) {
    const d = distToPoly(g, p, x, y);
    if (d <= si.radius) cand.push({ p, d });
  }
  const flags: SnapFlags = { hint: 'none', ruleB: false, reassigned: false, ambiguous: false, spanYd: 0 };
  if (cand.length === 0) return { poly: -1, dist: Infinity, flags, containingComps: [], floors: [] };
  const sizeOf = (p: number): number => sizes[comp[p] ?? 0] ?? 0;
  const order = (a: Candidate, b: Candidate): number =>
    (a.d === 0 ? 0 : 1) - (b.d === 0 ? 0 : 1) || a.d - b.d || sizeOf(b.p) - sizeOf(a.p) || (g.cz[a.p] ?? 0) - (g.cz[b.p] ?? 0) || a.p - b.p;
  const floors = cand.filter((e) => e.d === 0).map((e) => e.p).sort((a, b) => a - b);
  const plain = [...cand].sort(order)[0];
  let c = cand;
  if (hint !== 0) {
    const h = c.filter((e) => g.zone[e.p] === hint);
    if (h.length > 0) {
      flags.hint = 'used';
      c = h;
    } else flags.hint = 'miss';
  }
  if (minComp > 0) {
    const big = c.filter((e) => sizeOf(e.p) >= minComp);
    if (big.length > 0 && big.length < c.length) {
      flags.ruleB = true;
      c = big;
    }
  }
  c = [...c].sort(order);
  const best = c[0] ?? cand[0];
  if (best === undefined) return { poly: -1, dist: Infinity, flags, containingComps: [], floors: [] };
  const containing = c.filter((e) => e.d === 0);
  const comps = [...new Set(containing.map((e) => comp[e.p] ?? 0))].sort((a, b) => a - b);
  flags.ambiguous = comps.length > 1;
  if (containing.length > 1) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const e of containing) {
      const z = g.cz[e.p] ?? 0;
      if (z < lo) lo = z;
      if (z > hi) hi = z;
    }
    flags.spanYd = hi - lo;
  }
  flags.reassigned = plain !== undefined && comp[best.p] !== comp[plain.p];
  return { poly: best.p, dist: best.d, flags, containingComps: comps, floors };
}
