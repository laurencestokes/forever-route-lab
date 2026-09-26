import { rectDistance } from './grid';
import type { BlockMesh, NavMesh, SnapBins } from './mesh';

/**
 * Snapping a 2D endpoint to the mesh (terrain-navigation.md §8.1; TN-07, TN-13, RC-06):
 *
 * 0. **Loading:** every block whose rectangle is within the snap radius (6 yd) of the point must
 *    be loaded first (`snapBlocks`, at most 4), so a snap never depends on which blocks happened
 *    to be loaded. `snap` throws `NavBlocksMissingError` naming the missing blocks otherwise.
 * 1. candidates: every polygon whose 2D distance to the point is ≤ the radius (0 when it contains
 *    the point);
 * 2. rule A (zone): if a candidate's zone equals the hint, keep only those, else record a miss;
 * 3. rule B (size): if some candidates lie in components of at least `ruleBMinPolygons`
 *    polygons, keep only those;
 * 4. order: containing first, then distance, then component size (largest first), then the
 *    lowest floor (centroid height), then polygon id;
 * 5. flags: `ambiguous` when the remaining containing candidates span components, `spanYd` the
 *    vertical spread of the containing floors; `poly` −1 when no candidate exists.
 *
 * The same rules and order as the build's `tools/terrain/lib/snap.ts`, so runtime snaps equal the
 * census's.
 */

export class NavBlocksMissingError extends Error {
  constructor(readonly blocks: readonly number[]) {
    super(`navigation blocks not loaded: ${blocks.join(', ')}`);
    this.name = 'NavBlocksMissingError';
  }
}

export interface SnapFlags {
  readonly hint: 'none' | 'used' | 'miss';
  /** Rule B removed candidates. */
  readonly ruleB: boolean;
  /** The rules changed the component the plain order would pick. */
  readonly reassigned: boolean;
  /** The containing candidates left after rules A and B span more than one component. */
  readonly ambiguous: boolean;
  /** Vertical spread of those containing floors (centroid heights), 0 for one floor. */
  readonly spanYd: number;
}

export interface Snap {
  /** Global polygon id; −1: no polygon within the radius. */
  readonly poly: number;
  readonly dist: number;
  readonly flags: SnapFlags;
  /** Components of the containing candidates left after rules A and B, ascending. */
  readonly containingComps: readonly number[];
  /** Every polygon containing the point, before the rules, ascending. */
  readonly floors: readonly number[];
}

export interface SnapOptions {
  /** Rule B threshold (default: the manifest's, 20); 0 turns rule B off. */
  readonly minComp?: number;
}

const BIN_CELL_YD = 32;
/** Bins are built with the radius plus this margin, so the exact distance test alone decides. */
const BIN_MARGIN_YD = 0.01;

/** Manifest indices of the blocks whose rectangle is within the snap radius of (x, y), ascending. */
export function snapBlocks(mesh: NavMesh, x: number, y: number): number[] {
  const out: number[] = [];
  mesh.rects.forEach((r, i) => {
    if (rectDistance(r, x, y) <= mesh.P.snapRadiusYd) out.push(i);
  });
  return out;
}

/** The blocks `snap` needs that are not loaded. */
export const snapMissing = (mesh: NavMesh, x: number, y: number): number[] => snapBlocks(mesh, x, y).filter((b) => !mesh.isLoaded(b));

/** 2D containment of (x, y) in polygon p of block m (edges included; either winding). */
export function containsXY(m: BlockMesh, p: number, x: number, y: number): boolean {
  let sign = 0;
  const a = m.polyFirst[p] ?? 0;
  const b = m.polyFirst[p + 1] ?? 0;
  for (let k = a; k < b; k += 1) {
    const v0 = m.slotVert[k] ?? 0;
    const v1 = m.slotVert[k + 1 < b ? k + 1 : a] ?? 0;
    const x0 = m.vx[v0] ?? 0;
    const y0 = m.vy[v0] ?? 0;
    const cr = ((m.vx[v1] ?? 0) - x0) * (y - y0) - ((m.vy[v1] ?? 0) - y0) * (x - x0);
    const sg = cr > 0 ? 1 : cr < 0 ? -1 : 0;
    if (sg !== 0) {
      if (sign === 0) sign = sg;
      else if (sg !== sign) return false;
    }
  }
  return true;
}

/** 2D distance from (x, y) to local polygon p of block m, 0 when it contains the point. */
export function distToPoly(m: BlockMesh, p: number, x: number, y: number): number {
  if (containsXY(m, p, x, y)) return 0;
  let best = Infinity;
  const a = m.polyFirst[p] ?? 0;
  const b = m.polyFirst[p + 1] ?? 0;
  for (let k = a; k < b; k += 1) {
    const v0 = m.slotVert[k] ?? 0;
    const v1 = m.slotVert[k + 1 < b ? k + 1 : a] ?? 0;
    const x0 = m.vx[v0] ?? 0;
    const y0 = m.vy[v0] ?? 0;
    const ex = (m.vx[v1] ?? 0) - x0;
    const ey = (m.vy[v1] ?? 0) - y0;
    const len2 = ex * ex + ey * ey;
    let t = len2 > 0 ? ((x - x0) * ex + (y - y0) * ey) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x0 + t * ex - x;
    const dy = y0 + t * ey - y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < best) best = d;
  }
  return best;
}

/** Uniform bins over the block rectangle grown by the radius; each polygon in every bin its grown box touches. */
export function snapBins(m: BlockMesh, radius: number): SnapBins {
  const grow = radius + BIN_MARGIN_YD;
  const x0 = m.rect.xMin - grow;
  const y0 = m.rect.yMin - grow;
  const cell = BIN_CELL_YD;
  const nx = Math.floor((m.rect.xMax + grow - x0) / cell) + 1;
  const ny = Math.floor((m.rect.yMax + grow - y0) / cell) + 1;
  const clampX = (v: number): number => (v < 0 ? 0 : v >= nx ? nx - 1 : v);
  const clampY = (v: number): number => (v < 0 ? 0 : v >= ny ? ny - 1 : v);
  const boxes = new Int32Array(m.np * 4);
  const count = new Int32Array(nx * ny + 1);
  for (let p = 0; p < m.np; p += 1) {
    let xa = Infinity;
    let xb = -Infinity;
    let ya = Infinity;
    let yb = -Infinity;
    for (let s = m.polyFirst[p] ?? 0; s < (m.polyFirst[p + 1] ?? 0); s += 1) {
      const v = m.slotVert[s] ?? 0;
      const x = m.vx[v] ?? 0;
      const y = m.vy[v] ?? 0;
      if (x < xa) xa = x;
      if (x > xb) xb = x;
      if (y < ya) ya = y;
      if (y > yb) yb = y;
    }
    const i0 = clampX(Math.floor((xa - grow - x0) / cell));
    const i1 = clampX(Math.floor((xb + grow - x0) / cell));
    const j0 = clampY(Math.floor((ya - grow - y0) / cell));
    const j1 = clampY(Math.floor((yb + grow - y0) / cell));
    boxes[p * 4] = i0;
    boxes[p * 4 + 1] = i1;
    boxes[p * 4 + 2] = j0;
    boxes[p * 4 + 3] = j1;
    for (let i = i0; i <= i1; i += 1) for (let j = j0; j <= j1; j += 1) count[i * ny + j + 1] = (count[i * ny + j + 1] ?? 0) + 1;
  }
  for (let c = 0; c < nx * ny; c += 1) count[c + 1] = (count[c + 1] ?? 0) + (count[c] ?? 0);
  const first = count;
  const fill = first.slice(0, nx * ny);
  const items = new Int32Array(first[nx * ny] ?? 0);
  for (let p = 0; p < m.np; p += 1) {
    for (let i = boxes[p * 4] ?? 0; i <= (boxes[p * 4 + 1] ?? 0); i += 1) {
      for (let j = boxes[p * 4 + 2] ?? 0; j <= (boxes[p * 4 + 3] ?? 0); j += 1) {
        const c = i * ny + j;
        const k = fill[c] ?? 0;
        fill[c] = k + 1;
        items[k] = m.base + p;
      }
    }
  }
  return { x0, y0, cell, nx, ny, first, items };
}

interface Candidate {
  readonly p: number;
  readonly d: number;
}

/** The candidates (global id, distance) within the radius, from the loaded blocks near the point. */
function candidates(mesh: NavMesh, blocks: readonly number[], x: number, y: number): Candidate[] {
  const radius = mesh.P.snapRadiusYd;
  const out: Candidate[] = [];
  for (const b of blocks) {
    const m = mesh.block(b);
    if (m === null) continue;
    if (m.bins === null) m.bins = snapBins(m, radius);
    const bins = m.bins;
    const i = Math.floor((x - bins.x0) / bins.cell);
    const j = Math.floor((y - bins.y0) / bins.cell);
    if (i < 0 || i >= bins.nx || j < 0 || j >= bins.ny) continue;
    const c = i * bins.ny + j;
    for (let k = bins.first[c] ?? 0; k < (bins.first[c + 1] ?? 0); k += 1) {
      const g = bins.items[k] ?? 0;
      const d = distToPoly(m, g - m.base, x, y);
      if (d <= radius) out.push({ p: g, d });
    }
  }
  return out;
}

const NO_FLAGS: SnapFlags = { hint: 'none', ruleB: false, reassigned: false, ambiguous: false, spanYd: 0 };

/**
 * Snaps (x, y) (already quantised to 1 yd) with zone hint `hint` (a top-level AreaTable id, 0 for
 * none). Throws `NavBlocksMissingError` when a block within the radius is not loaded.
 */
export function snap(mesh: NavMesh, x: number, y: number, hint: number, options: SnapOptions = {}): Snap {
  const blocks = snapBlocks(mesh, x, y);
  const missing = blocks.filter((b) => !mesh.isLoaded(b));
  if (missing.length > 0) throw new NavBlocksMissingError(missing);
  const minComp = options.minComp ?? mesh.P.ruleBMinPolygons;
  const cand = candidates(mesh, blocks, x, y);
  if (cand.length === 0) return { poly: -1, dist: Infinity, flags: NO_FLAGS, containingComps: [], floors: [] };
  const comp = mesh.comp;
  const sizeOf = (p: number): number => mesh.sizes[comp[p] ?? 0] ?? 0;
  const order = (a: Candidate, b: Candidate): number =>
    (a.d === 0 ? 0 : 1) - (b.d === 0 ? 0 : 1) || a.d - b.d || sizeOf(b.p) - sizeOf(a.p) || (mesh.cz[a.p] ?? 0) - (mesh.cz[b.p] ?? 0) || a.p - b.p;
  const floors = cand.filter((e) => e.d === 0).map((e) => e.p).sort((a, b) => a - b);
  const plain = [...cand].sort(order)[0];
  let hintFlag: SnapFlags['hint'] = 'none';
  let ruleB = false;
  let c = cand;
  if (hint !== 0) {
    const h = c.filter((e) => mesh.zoneOf(e.p) === hint);
    if (h.length > 0) {
      hintFlag = 'used';
      c = h;
    } else hintFlag = 'miss';
  }
  if (minComp > 0) {
    const big = c.filter((e) => sizeOf(e.p) >= minComp);
    if (big.length > 0 && big.length < c.length) {
      ruleB = true;
      c = big;
    }
  }
  c = [...c].sort(order);
  const best = c[0] ?? cand[0];
  if (best === undefined) return { poly: -1, dist: Infinity, flags: NO_FLAGS, containingComps: [], floors: [] };
  const containing = c.filter((e) => e.d === 0);
  const comps = [...new Set(containing.map((e) => comp[e.p] ?? 0))].sort((a, b) => a - b);
  let spanYd = 0;
  if (containing.length > 1) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const e of containing) {
      const z = mesh.cz[e.p] ?? 0;
      if (z < lo) lo = z;
      if (z > hi) hi = z;
    }
    spanYd = hi - lo;
  }
  const reassigned = plain !== undefined && comp[best.p] !== comp[plain.p];
  return { poly: best.p, dist: best.d, flags: { hint: hintFlag, ruleB, reassigned, ambiguous: comps.length > 1, spanYd }, containingComps: comps, floors };
}
