/**
 * Adjacency and the slab relinker (terrain-navigation.md §5 "Derived, not stored", §6.1). Both
 * are derived at load time, never stored in the blocks.
 *
 * - **Internal adjacency** is Recast's own `buildMeshAdjacency` pairing: forward edges (v0 < v1)
 *   are listed per v0, most recent first, in polygon order; each reverse edge takes the first
 *   unmatched forward edge with the same vertices. So it is symmetric even where more than two
 *   polygons meet at one edge.
 * - **Portal edges**: an edge without an internal neighbour whose two vertices both lie on one tile
 *   side (x = 0, z = tileVoxels, x = tileVoxels or z = 0) leads to the tile on that side.
 * - **Cross-tile links** follow Detour's `findConnectingPolys` / `overlapSlabs` rule,
 *   reimplemented (not copied): the two edges lie on one line within 0.01 yd; their along-side
 *   intervals, each shrunk by 0.01 yd, overlap; the heights interpolated at the overlap's ends
 *   cross, or differ by at most 2 × walkableClimb at either end; at most one link per target
 *   polygon for a given source edge; the portal is the overlap, kept in the source polygon's
 *   vertex order.
 *
 * The same algorithm, in the same order and with the same floating-point expressions as the
 * build's `tools/terrain/lib/link.ts`, links tiles inside a block when the block loads and tiles
 * across a block seam when the second of two neighbouring blocks loads, so the runtime mesh equals
 * the build's whatever the load order. `sqrt` only; no `hypot` or trigonometry.
 */

/**
 * Per polygon slot j (vertex j → j + 1), the local polygon across that edge in the same tile, or
 * −1. `polyFirst` (np + 1 slot offsets) and `slotVert` are one tile's, with vertex indices
 * relative to `vertBase`; `nv` is the tile's vertex count.
 */
export function recastAdjacency(polyFirst: Int32Array, slotVert: Int32Array, p0: number, p1: number, vertBase: number, nv: number, out: Int32Array, polyBase: number): void {
  const first = new Int32Array(Math.max(1, nv)).fill(-1);
  const next: number[] = [];
  const eV1: number[] = [];
  const eP0: number[] = [];
  const eS0: number[] = [];
  const eP1: number[] = [];
  const eS1: number[] = [];
  for (let p = p0; p < p1; p += 1) {
    const a = polyFirst[p] ?? 0;
    const b = polyFirst[p + 1] ?? 0;
    for (let s = a; s < b; s += 1) {
      const v0 = (slotVert[s] ?? 0) - vertBase;
      const v1 = (slotVert[s + 1 < b ? s + 1 : a] ?? 0) - vertBase;
      if (v0 < v1) {
        const e = eV1.length;
        eV1.push(v1);
        eP0.push(p);
        eS0.push(s);
        eP1.push(p);
        eS1.push(0);
        next.push(first[v0] ?? -1);
        first[v0] = e;
      }
    }
  }
  for (let p = p0; p < p1; p += 1) {
    const a = polyFirst[p] ?? 0;
    const b = polyFirst[p + 1] ?? 0;
    for (let s = a; s < b; s += 1) {
      const v0 = (slotVert[s] ?? 0) - vertBase;
      const v1 = (slotVert[s + 1 < b ? s + 1 : a] ?? 0) - vertBase;
      if (v0 <= v1) continue;
      for (let e = first[v1] ?? -1; e !== -1; e = next[e] ?? -1) {
        if (eV1[e] === v0 && eP0[e] === eP1[e]) {
          eP1[e] = p;
          eS1[e] = s;
          break;
        }
      }
    }
  }
  for (let e = 0; e < eV1.length; e += 1) {
    const q0 = eP0[e] ?? 0;
    const q1 = eP1[e] ?? 0;
    if (q0 === q1) continue;
    out[eS0[e] ?? 0] = q1 - polyBase;
    out[eS1[e] ?? 0] = q0 - polyBase;
  }
}

/** One portal edge on a tile side, in world yards (the build's `Portal`). */
export interface Portal {
  /** Global polygon id. */
  readonly poly: number;
  /** Edge index j inside the polygon (vertex j → j + 1). */
  readonly j: number;
  readonly ax: number;
  readonly ay: number;
  readonly az: number;
  readonly bx: number;
  readonly by: number;
  readonly bz: number;
  /** Position along the side in Recast space: −Y on sides 0 and 2, X on sides 1 and 3. */
  readonly along0: number;
  readonly along1: number;
  /** Position across the side: X on sides 0 and 2, −Y on sides 1 and 3. */
  readonly pos: number;
}

export function makePortal(side: number, poly: number, j: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): Portal {
  const even = side % 2 === 0;
  return { poly, j, ax, ay, az, bx, by, bz, along0: even ? -ay : ax, along1: even ? -by : bx, pos: even ? ax : -ay };
}

/** A directed cross-tile link with its portal (the overlap, in the source polygon's vertex order). */
export interface LinkSink {
  push(from: number, to: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void;
}

/** The squared height tolerance of the slab rule: (2 × walkableClimb rounded down to voxels)². */
export function climbThreshold(climbYd: number, ch: number): number {
  const climb = Math.floor(climbYd / ch) * ch;
  return climb * 2 * (climb * 2);
}

function overlap(a0: number, a1: number, ha0: number, ha1: number, b0: number, b1: number, hb0: number, hb1: number, threshold: number): readonly [number, number] | null {
  const minx = Math.max(a0 + 0.01, b0 + 0.01);
  const maxx = Math.min(a1 - 0.01, b1 - 0.01);
  if (minx > maxx) return null;
  const ad = (ha1 - ha0) / (a1 - a0);
  const ak = ha0 - ad * a0;
  const bd = (hb1 - hb0) / (b1 - b0);
  const bk = hb0 - bd * b0;
  const dmin = bd * minx + bk - (ad * minx + ak);
  const dmax = bd * maxx + bk - (ad * maxx + ak);
  if (dmin * dmax < 0) return [Math.max(a0, b0), Math.min(a1, b1)];
  if (dmin * dmin <= threshold || dmax * dmax <= threshold) return [Math.max(a0, b0), Math.min(a1, b1)];
  return null;
}

/**
 * Links every portal of `from` (one tile side) to the portals of `to` (the facing side of the
 * neighbouring tile), in the build's order: `from` in (polygon, edge) order, then `to` in its
 * order, at most one link per target polygon for a given source edge.
 */
export function linkPortals(from: readonly Portal[], to: readonly Portal[], threshold: number, out: LinkSink): void {
  for (const e of from) {
    const forward = e.along0 < e.along1;
    const a0 = forward ? e.along0 : e.along1;
    const a1 = forward ? e.along1 : e.along0;
    const ha0 = forward ? e.az : e.bz;
    const ha1 = forward ? e.bz : e.az;
    const seen = new Set<number>();
    for (const f of to) {
      if (Math.abs(f.pos - e.pos) > 0.01) continue;
      if (seen.has(f.poly)) continue;
      const ff = f.along0 < f.along1;
      const b0 = ff ? f.along0 : f.along1;
      const b1 = ff ? f.along1 : f.along0;
      const hb0 = ff ? f.az : f.bz;
      const hb1 = ff ? f.bz : f.az;
      const ov = overlap(a0, a1, ha0, ha1, b0, b1, hb0, hb1, threshold);
      if (ov === null) continue;
      seen.add(f.poly);
      const tA = (ov[0] - e.along0) / (e.along1 - e.along0);
      const tB = (ov[1] - e.along0) / (e.along1 - e.along0);
      const dx = e.bx - e.ax;
      const dy = e.by - e.ay;
      const dz = e.bz - e.az;
      const lo = Math.min(tA, tB);
      const hi = Math.max(tA, tB);
      out.push(e.poly, f.poly, e.ax + dx * lo, e.ay + dy * lo, e.az + dz * lo, e.ax + dx * hi, e.ay + dy * hi, e.az + dz * hi);
    }
  }
}

/** Growable link storage, sorted by source into a CSR once complete. */
export class LinkList implements LinkSink {
  from: number[] = [];
  to: number[] = [];
  ax: number[] = [];
  ay: number[] = [];
  az: number[] = [];
  bx: number[] = [];
  by: number[] = [];
  bz: number[] = [];

  push(from: number, to: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    this.from.push(from);
    this.to.push(to);
    this.ax.push(ax);
    this.ay.push(ay);
    this.az.push(az);
    this.bx.push(bx);
    this.by.push(by);
    this.bz.push(bz);
  }

  get length(): number {
    return this.from.length;
  }
}

/**
 * Directed links grouped by source polygon, in generation order within one source (a stable
 * counting sort): `first[p − base] .. first[p − base + 1] − 1` are the links from global polygon
 * p. Portal endpoints in world yards, heights included.
 */
export interface LinkTable {
  readonly first: Int32Array;
  /** Global target polygon ids. */
  readonly to: Int32Array;
  readonly ax: Float64Array;
  readonly ay: Float64Array;
  readonly az: Float64Array;
  readonly bx: Float64Array;
  readonly by: Float64Array;
  readonly bz: Float64Array;
}

/**
 * Directed links of one block side, sorted by source polygon (stable): the links from global
 * polygon p are `lowerBound(from, p)` onwards while `from` equals p. Used for the links across a
 * block seam, which appear and disappear with the neighbour block; a side's table never changes
 * while it exists, so edge references into it stay valid for a whole query.
 */
export interface SideLinks {
  readonly from: Int32Array;
  readonly to: Int32Array;
  readonly ax: Float64Array;
  readonly ay: Float64Array;
  readonly az: Float64Array;
  readonly bx: Float64Array;
  readonly by: Float64Array;
  readonly bz: Float64Array;
}

export function sideLinks(list: LinkList): SideLinks {
  const m = list.length;
  const order = Array.from({ length: m }, (_, i) => i).sort((i, j) => (list.from[i] ?? 0) - (list.from[j] ?? 0) || i - j);
  const t = { from: new Int32Array(m), to: new Int32Array(m), ax: new Float64Array(m), ay: new Float64Array(m), az: new Float64Array(m), bx: new Float64Array(m), by: new Float64Array(m), bz: new Float64Array(m) };
  order.forEach((i, k) => {
    t.from[k] = list.from[i] ?? 0;
    t.to[k] = list.to[i] ?? 0;
    t.ax[k] = list.ax[i] ?? 0;
    t.ay[k] = list.ay[i] ?? 0;
    t.az[k] = list.az[i] ?? 0;
    t.bx[k] = list.bx[i] ?? 0;
    t.by[k] = list.by[i] ?? 0;
    t.bz[k] = list.bz[i] ?? 0;
  });
  return t;
}

/** The first index of `a` (ascending) whose value is ≥ v. */
export function lowerBound(a: Int32Array, v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((a[mid] ?? 0) < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function linkTable(list: LinkList, base: number, np: number): LinkTable {
  const m = list.length;
  const first = new Int32Array(np + 1);
  for (let i = 0; i < m; i += 1) {
    const p = (list.from[i] ?? 0) - base;
    first[p + 1] = (first[p + 1] ?? 0) + 1;
  }
  for (let p = 0; p < np; p += 1) first[p + 1] = (first[p + 1] ?? 0) + (first[p] ?? 0);
  const fill = first.slice(0, np);
  const t = { first, to: new Int32Array(m), ax: new Float64Array(m), ay: new Float64Array(m), az: new Float64Array(m), bx: new Float64Array(m), by: new Float64Array(m), bz: new Float64Array(m) };
  for (let i = 0; i < m; i += 1) {
    const p = (list.from[i] ?? 0) - base;
    const k = fill[p] ?? 0;
    fill[p] = k + 1;
    t.to[k] = list.to[i] ?? 0;
    t.ax[k] = list.ax[i] ?? 0;
    t.ay[k] = list.ay[i] ?? 0;
    t.az[k] = list.az[i] ?? 0;
    t.bx[k] = list.bx[i] ?? 0;
    t.by[k] = list.by[i] ?? 0;
    t.bz[k] = list.bz[i] ?? 0;
  }
  return t;
}
