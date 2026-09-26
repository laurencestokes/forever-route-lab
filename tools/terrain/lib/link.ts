import { MAP_ORIGIN_YD } from './formats/grid';
import type { NavBlock } from './encode';

/**
 * The linked map mesh of stage 2 (terrain-navigation.md §5 "Derived, not stored", §6.1). Ported
 * from the m3b prototype `mesh3.ts` (our own research code).
 *
 * - **Internal adjacency** is derived exactly as Recast's `buildMeshAdjacency` pairs edges
 *   (`recastAdjacency`), so it is symmetric even where more than two polygons meet at an edge.
 * - **Portal edges**: an edge without an internal neighbour whose two vertices lie on the same
 *   tile side (x = 0, z = tileVoxels, x = tileVoxels or z = 0) leads to the tile on that side.
 * - **Cross-tile links** follow Detour's `findConnectingPolys` / `overlapSlabs` rule,
 *   reimplemented (not copied): the two edges lie on one line within 0.01 yd; their along-side
 *   intervals, each shrunk by 0.01 yd, overlap; heights interpolated at the overlap's ends cross
 *   or differ by at most 2 × walkableClimb at either end; one link per target polygon for a given
 *   source edge; the portal is the overlap, kept in the source polygon's vertex order.
 * - Global polygon ids follow the block order given (the manifest's canonical order), then tile
 *   and polygon order. `sqrt` only; no `hypot` or trigonometry.
 */

export interface MeshParams {
  readonly cs: number;
  readonly ch: number;
  readonly tileVoxels: number;
  readonly tileYd: number;
  readonly perAdt: number;
  readonly blockAdts: number;
  readonly mapOriginZ: number;
  readonly climbYd: number;
}

export const EDGE_INTERNAL = 0;
export const EDGE_CROSS_TILE = 1;
export const EDGE_CROSS_BLOCK = 2;
export const EDGE_CONNECTOR = 3;

/** A directed off-mesh link (a connector, §11.2). */
export interface OffMeshLink {
  readonly connector: number;
  readonly from: number;
  readonly to: number;
  /** Cost in tenth-seconds (wait plus ride or cast). */
  readonly costTenths: number;
}

export interface SeamStats {
  len: number;
  matched: number;
}

export interface MapMesh {
  readonly n: number;
  readonly swim: Uint8Array;
  readonly zone: Int32Array;
  /** Vertex slots per polygon: vFirst[p] .. vFirst[p + 1] − 1 index vx, vy, vz (world yards). */
  readonly vFirst: Int32Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly vz: Float64Array;
  readonly cx: Float64Array;
  readonly cy: Float64Array;
  readonly cz: Float64Array;
  /** CSR edges sorted by (from, to, kind): portal (ax, ay) → (bx, by) in the source polygon's vertex order. */
  readonly eFirst: Int32Array;
  readonly eTo: Int32Array;
  readonly eAx: Float64Array;
  readonly eAy: Float64Array;
  readonly eBx: Float64Array;
  readonly eBy: Float64Array;
  readonly eKind: Uint8Array;
  /** Connector index of a connector edge, else −1. */
  readonly eLink: Int32Array;
  /** Connector cost in tenth-seconds of a connector edge, else 0. */
  readonly eCost: Int32Array;
  readonly blockOfPoly: Int32Array;
  readonly tileOfPoly: Int32Array;
  /** First global polygon id of each block, plus the total. */
  readonly blockBase: Int32Array;
  readonly seams: { readonly inner: SeamStats; readonly block: SeamStats; readonly mid: SeamStats };
  readonly stats: { readonly tiles: number; readonly crossTileLinks: number; readonly internalEdges: number; readonly connectorLinks: number };
}

/**
 * Internal adjacency exactly as Recast's `rcBuildPolyMesh` pairs it (`buildMeshAdjacency`):
 * forward edges (v0 < v1) are listed per v0, most recent first, in polygon order; each reverse
 * edge takes the first unmatched forward edge with the same vertices. Returns, per polygon, the
 * neighbour of each edge j (vertex j → j + 1), −1 for none.
 */
export function recastAdjacency(polys: readonly (readonly number[])[], nv: number): Int32Array[] {
  const nei = polys.map((vs) => new Int32Array(vs.length).fill(-1));
  const first = new Int32Array(Math.max(1, nv)).fill(-1);
  const next: number[] = [];
  const eV1: number[] = [];
  const eP0: number[] = [];
  const eJ0: number[] = [];
  const eP1: number[] = [];
  const eJ1: number[] = [];
  polys.forEach((vs, p) => {
    vs.forEach((v0, j) => {
      const v1 = vs[(j + 1) % vs.length] ?? 0;
      if (v0 < v1) {
        const e = eV1.length;
        eV1.push(v1);
        eP0.push(p);
        eJ0.push(j);
        eP1.push(p);
        eJ1.push(0);
        next.push(first[v0] ?? -1);
        first[v0] = e;
      }
    });
  });
  polys.forEach((vs, p) => {
    vs.forEach((v0, j) => {
      const v1 = vs[(j + 1) % vs.length] ?? 0;
      if (v0 <= v1) return;
      for (let e = first[v1] ?? -1; e !== -1; e = next[e] ?? -1) {
        if (eV1[e] === v0 && eP0[e] === eP1[e]) {
          eP1[e] = p;
          eJ1[e] = j;
          break;
        }
      }
    });
  });
  for (let e = 0; e < eV1.length; e += 1) {
    const p0 = eP0[e] ?? 0;
    const p1 = eP1[e] ?? 0;
    if (p0 === p1) continue;
    const n0 = nei[p0];
    const n1 = nei[p1];
    if (n0 !== undefined) n0[eJ0[e] ?? 0] = p1;
    if (n1 !== undefined) n1[eJ1[e] ?? 0] = p0;
  }
  return nei;
}

interface TileRec {
  readonly block: number;
  readonly tx: number;
  readonly tz: number;
  readonly base: number;
  readonly wx: Float64Array;
  readonly wy: Float64Array;
  readonly wz: Float64Array;
  readonly vox: Int32Array;
}

interface Portal {
  readonly tile: TileRec;
  readonly poly: number;
  readonly a: number;
  readonly b: number;
  readonly ha: number;
  readonly hb: number;
  readonly along0: number;
  readonly along1: number;
  readonly pos: number;
}

const SIDE_STEP: readonly (readonly [number, number])[] = [
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1],
];

class EdgeList {
  from: number[] = [];
  to: number[] = [];
  ax: number[] = [];
  ay: number[] = [];
  bx: number[] = [];
  by: number[] = [];
  kind: number[] = [];
  link: number[] = [];
  cost: number[] = [];
  push(from: number, to: number, ax: number, ay: number, bx: number, by: number, kind: number, link = -1, cost = 0): void {
    this.from.push(from);
    this.to.push(to);
    this.ax.push(ax);
    this.ay.push(ay);
    this.bx.push(bx);
    this.by.push(by);
    this.kind.push(kind);
    this.link.push(link);
    this.cost.push(cost);
  }
}

/**
 * The linked mesh of `blocks` (decoded, in canonical order) plus directed off-mesh `links`
 * (polygon ids refer to this block order). Deterministic: the result depends only on the blocks
 * and their order.
 */
export function buildMapMesh(blocks: readonly NavBlock[], P: MeshParams, links: readonly OffMeshLink[] = []): MapMesh {
  const tiles: TileRec[] = [];
  const zoneList: number[] = [];
  const swimList: number[] = [];
  const blockOfPolyList: number[] = [];
  const tileOfPolyList: number[] = [];
  const polyLists: (readonly (readonly number[])[])[] = [];
  const blockBase: number[] = [];
  let n = 0;
  blocks.forEach((b, bi) => {
    blockBase.push(n);
    let pi = 0;
    for (const t of b.tiles) {
      const nv = t.verts.length / 3;
      const wx = new Float64Array(nv);
      const wy = new Float64Array(nv);
      const wz = new Float64Array(nv);
      for (let v = 0; v < nv; v += 1) {
        wx[v] = -MAP_ORIGIN_YD + t.tx * P.tileYd + (t.verts[v * 3] ?? 0) * P.cs;
        wy[v] = MAP_ORIGIN_YD - t.tz * P.tileYd - (t.verts[v * 3 + 2] ?? 0) * P.cs;
        wz[v] = P.mapOriginZ + (b.blockStep + t.originStep + (t.verts[v * 3 + 1] ?? 0)) * P.ch;
      }
      const ti = tiles.length;
      tiles.push({ block: bi, tx: t.tx, tz: t.tz, base: n, wx, wy, wz, vox: t.verts });
      polyLists.push(t.polys);
      t.polys.forEach((_, p) => {
        zoneList.push(b.zones[pi + p] ?? 0);
        swimList.push(t.swim[p] === true ? 1 : 0);
        blockOfPolyList.push(bi);
        tileOfPolyList.push(ti);
      });
      pi += t.polys.length;
      n += t.polys.length;
    }
  });
  blockBase.push(n);
  let slots = 0;
  for (const polys of polyLists) for (const vs of polys) slots += vs.length;
  const vFirst = new Int32Array(n + 1);
  const vx = new Float64Array(slots);
  const vy = new Float64Array(slots);
  const vz = new Float64Array(slots);
  const cx = new Float64Array(n);
  const cy = new Float64Array(n);
  const cz = new Float64Array(n);
  const edges = new EdgeList();
  const portals = new Map<string, Portal[]>();
  let s = 0;
  let internalEdges = 0;
  tiles.forEach((t, ti) => {
    const polys = polyLists[ti] ?? [];
    const nei = recastAdjacency(polys, t.wx.length);
    polys.forEach((vs, p) => {
      const g = t.base + p;
      vFirst[g] = s;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (const v of vs) {
        const x = t.wx[v] ?? 0;
        const y = t.wy[v] ?? 0;
        const z = t.wz[v] ?? 0;
        vx[s] = x;
        vy[s] = y;
        vz[s] = z;
        sx += x;
        sy += y;
        sz += z;
        s += 1;
      }
      cx[g] = sx / vs.length;
      cy[g] = sy / vs.length;
      cz[g] = sz / vs.length;
      vs.forEach((a, j) => {
        const b = vs[(j + 1) % vs.length] ?? 0;
        const q = nei[p]?.[j] ?? -1;
        if (q >= 0) {
          edges.push(g, t.base + q, t.wx[a] ?? 0, t.wy[a] ?? 0, t.wx[b] ?? 0, t.wy[b] ?? 0, EDGE_INTERNAL);
          internalEdges += 1;
          return;
        }
        const ax = t.vox[a * 3] ?? -1;
        const az = t.vox[a * 3 + 2] ?? -1;
        const bx = t.vox[b * 3] ?? -1;
        const bz = t.vox[b * 3 + 2] ?? -1;
        let side = -1;
        if (ax === 0 && bx === 0) side = 0;
        else if (az === P.tileVoxels && bz === P.tileVoxels) side = 1;
        else if (ax === P.tileVoxels && bx === P.tileVoxels) side = 2;
        else if (az === 0 && bz === 0) side = 3;
        if (side < 0) return;
        // slab coordinates in recast space: sides 0 and 2 run along z (−world Y), sides 1 and 3 along x
        const alongA = side % 2 === 0 ? -(t.wy[a] ?? 0) : (t.wx[a] ?? 0);
        const alongB = side % 2 === 0 ? -(t.wy[b] ?? 0) : (t.wx[b] ?? 0);
        const pos = side % 2 === 0 ? (t.wx[a] ?? 0) : -(t.wy[a] ?? 0);
        const key = `${String(t.tx)},${String(t.tz)},${String(side)}`;
        const list = portals.get(key);
        const portal: Portal = { tile: t, poly: g, a, b, ha: t.wz[a] ?? 0, hb: t.wz[b] ?? 0, along0: alongA, along1: alongB, pos };
        if (list === undefined) portals.set(key, [portal]);
        else list.push(portal);
      });
    });
  });
  vFirst[n] = s;
  const climb = Math.floor(P.climbYd / P.ch) * P.ch;
  const threshold = climb * 2 * (climb * 2);
  const seams = { inner: { len: 0, matched: 0 }, block: { len: 0, matched: 0 }, mid: { len: 0, matched: 0 } };
  const byKey = new Map<string, TileRec>();
  for (const t of tiles) byKey.set(`${String(t.tx)},${String(t.tz)}`, t);
  const overlap = (a0: number, a1: number, ha0: number, ha1: number, b0: number, b1: number, hb0: number, hb1: number): readonly [number, number] | null => {
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
  };
  let crossTileLinks = 0;
  const blockSpan = P.blockAdts * P.perAdt;
  for (const [key, list] of [...portals].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const [tx, tz, side] = key.split(',').map(Number) as [number, number, number];
    const step = SIDE_STEP[side] ?? [0, 0];
    const other = byKey.get(`${String(tx + step[0])},${String(tz + step[1])}`);
    const opposite = portals.get(`${String(tx + step[0])},${String(tz + step[1])},${String((side + 2) % 4)}`) ?? [];
    const first = list[0];
    const cross = other !== undefined && first !== undefined && other.block !== first.tile.block;
    for (const e of list) {
      const forward = e.along0 < e.along1;
      const a0 = forward ? e.along0 : e.along1;
      const a1 = forward ? e.along1 : e.along0;
      const ha0 = forward ? e.ha : e.hb;
      const ha1 = forward ? e.hb : e.ha;
      let matched = 0;
      const seen = new Set<number>();
      for (const f of opposite) {
        if (Math.abs(f.pos - e.pos) > 0.01) continue;
        if (seen.has(f.poly)) continue;
        const ff = f.along0 < f.along1;
        const b0 = ff ? f.along0 : f.along1;
        const b1 = ff ? f.along1 : f.along0;
        const hb0 = ff ? f.ha : f.hb;
        const hb1 = ff ? f.hb : f.ha;
        const ov = overlap(a0, a1, ha0, ha1, b0, b1, hb0, hb1);
        if (ov === null) continue;
        seen.add(f.poly);
        const t = e.tile;
        const tA = (ov[0] - e.along0) / (e.along1 - e.along0);
        const tB = (ov[1] - e.along0) / (e.along1 - e.along0);
        const ex = t.wx[e.a] ?? 0;
        const ey = t.wy[e.a] ?? 0;
        const dx = (t.wx[e.b] ?? 0) - ex;
        const dy = (t.wy[e.b] ?? 0) - ey;
        const lo = Math.min(tA, tB);
        const hi = Math.max(tA, tB);
        edges.push(e.poly, f.poly, ex + dx * lo, ey + dy * lo, ex + dx * hi, ey + dy * hi, cross ? EDGE_CROSS_BLOCK : EDGE_CROSS_TILE);
        matched += ov[1] - ov[0];
        crossTileLinks += 1;
      }
      if (other !== undefined) {
        const covered = Math.min(a1 - a0, matched);
        const st = cross ? seams.block : seams.inner;
        st.len += a1 - a0;
        st.matched += covered;
        const line = side === 0 ? tx : side === 2 ? tx + 1 : side === 1 ? tz + 1 : tz;
        if (((line % blockSpan) + blockSpan) % blockSpan === blockSpan / 2) {
          seams.mid.len += a1 - a0;
          seams.mid.matched += covered;
        }
      }
    }
  }
  for (const l of links) {
    if (l.from < 0 || l.from >= n || l.to < 0 || l.to >= n) throw new RangeError(`buildMapMesh: connector ${String(l.connector)} link ${String(l.from)} → ${String(l.to)} outside 0..${String(n - 1)}`);
    edges.push(l.from, l.to, cx[l.from] ?? 0, cy[l.from] ?? 0, cx[l.to] ?? 0, cy[l.to] ?? 0, EDGE_CONNECTOR, l.connector, l.costTenths);
  }
  const m = edges.from.length;
  const order = new Int32Array(m);
  for (let i = 0; i < m; i += 1) order[i] = i;
  order.sort((i, j) => (edges.from[i] ?? 0) - (edges.from[j] ?? 0) || (edges.to[i] ?? 0) - (edges.to[j] ?? 0) || (edges.kind[i] ?? 0) - (edges.kind[j] ?? 0) || i - j);
  const eFirst = new Int32Array(n + 1);
  const eTo = new Int32Array(m);
  const eAx = new Float64Array(m);
  const eAy = new Float64Array(m);
  const eBx = new Float64Array(m);
  const eBy = new Float64Array(m);
  const eKind = new Uint8Array(m);
  const eLink = new Int32Array(m);
  const eCost = new Int32Array(m);
  let k = 0;
  for (let g = 0; g < n; g += 1) {
    eFirst[g] = k;
    while (k < m && edges.from[order[k] ?? 0] === g) {
      const i = order[k] ?? 0;
      eTo[k] = edges.to[i] ?? 0;
      eAx[k] = edges.ax[i] ?? 0;
      eAy[k] = edges.ay[i] ?? 0;
      eBx[k] = edges.bx[i] ?? 0;
      eBy[k] = edges.by[i] ?? 0;
      eKind[k] = edges.kind[i] ?? 0;
      eLink[k] = edges.link[i] ?? -1;
      eCost[k] = edges.cost[i] ?? 0;
      k += 1;
    }
  }
  eFirst[n] = m;
  return {
    n,
    swim: Uint8Array.from(swimList),
    zone: Int32Array.from(zoneList),
    vFirst,
    vx,
    vy,
    vz,
    cx,
    cy,
    cz,
    eFirst,
    eTo,
    eAx,
    eAy,
    eBx,
    eBy,
    eKind,
    eLink,
    eCost,
    blockOfPoly: Int32Array.from(blockOfPolyList),
    tileOfPoly: Int32Array.from(tileOfPolyList),
    blockBase: Int32Array.from(blockBase),
    seams,
    stats: { tiles: tiles.length, crossTileLinks, internalEdges, connectorLinks: links.length },
  };
}

/** Edges without a reverse edge, internal and cross-tile (gate G5; connectors may be one-way and are not counted). */
export function linkSymmetry(g: MapMesh): { internal: number; internalWithoutReverse: number; crossTile: number; crossTileWithoutReverse: number } {
  const has = (p: number, q: number): boolean => {
    for (let k = g.eFirst[q] ?? 0; k < (g.eFirst[q + 1] ?? 0); k += 1) if (g.eTo[k] === p && g.eKind[k] !== EDGE_CONNECTOR) return true;
    return false;
  };
  const out = { internal: 0, internalWithoutReverse: 0, crossTile: 0, crossTileWithoutReverse: 0 };
  for (let p = 0; p < g.n; p += 1) {
    for (let k = g.eFirst[p] ?? 0; k < (g.eFirst[p + 1] ?? 0); k += 1) {
      const kind = g.eKind[k] ?? 0;
      if (kind === EDGE_CONNECTOR) continue;
      const rev = has(p, g.eTo[k] ?? 0);
      if (kind === EDGE_INTERNAL) {
        out.internal += 1;
        if (!rev) out.internalWithoutReverse += 1;
      } else {
        out.crossTile += 1;
        if (!rev) out.crossTileWithoutReverse += 1;
      }
    }
  }
  return out;
}

/** Unmatched share of a seam class in percent. */
export const unmatchedPct = (s: SeamStats): number => (s.len > 0 ? 100 * (1 - s.matched / s.len) : 0);

/** 2D containment of (x, y) in polygon p (edges included; either winding). */
export function containsXY(g: MapMesh, p: number, x: number, y: number): boolean {
  let sign = 0;
  const a = g.vFirst[p] ?? 0;
  const b = g.vFirst[p + 1] ?? 0;
  for (let k = a; k < b; k += 1) {
    const k1 = k + 1 < b ? k + 1 : a;
    const x0 = g.vx[k] ?? 0;
    const y0 = g.vy[k] ?? 0;
    const cr = ((g.vx[k1] ?? 0) - x0) * (y - y0) - ((g.vy[k1] ?? 0) - y0) * (x - x0);
    const sg = cr > 0 ? 1 : cr < 0 ? -1 : 0;
    if (sg !== 0) {
      if (sign === 0) sign = sg;
      else if (sg !== sign) return false;
    }
  }
  return true;
}

/** 2D distance from (x, y) to polygon p, 0 when it contains the point. */
export function distToPoly(g: MapMesh, p: number, x: number, y: number): number {
  if (containsXY(g, p, x, y)) return 0;
  let best = Infinity;
  const a = g.vFirst[p] ?? 0;
  const b = g.vFirst[p + 1] ?? 0;
  for (let k = a; k < b; k += 1) {
    const k1 = k + 1 < b ? k + 1 : a;
    const x0 = g.vx[k] ?? 0;
    const y0 = g.vy[k] ?? 0;
    const ex = (g.vx[k1] ?? 0) - x0;
    const ey = (g.vy[k1] ?? 0) - y0;
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

/** The height of polygon p at (x, y): its centroid height (the mesh stores no detail heights). */
export const heightAt = (g: MapMesh, p: number): number => g.cz[p] ?? 0;
