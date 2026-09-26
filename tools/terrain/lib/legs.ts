import type { MapMesh } from './link';

/**
 * A build-side reference of `legsFrom` (terrain-navigation.md §9.1) for the implementation check
 * against Detour (detour-check.ts, gates G10 and G10b). Ported from the m3b prototype `query3.ts`
 * (our own research code); the runtime version belongs to `src/nav` (step 3b.5).
 *
 * Dijkstra over polygons from the source point, heap ordered by (cost, polygon id), stopping once
 * every same-component target is settled; then per target the simple stupid funnel (the
 * algorithm of Detour's `findStraightPath`, reimplemented) from the exact source point to the
 * exact target point through the tree corridor, with the ground/swim split. Edge cost: half-edge
 * distances centroid → portal midpoint → centroid, times the polygon's factor (ground 1, swim
 * 7/4.72, era-assumed run and swim speeds). Lengths are horizontal (2D), a labelled assumption
 * (RC-13). `sqrt` only; the heap parent is `Math.floor((i − 1) / 2)`.
 */

export const SWIM_FACTOR = 7 / 4.72;

export interface Endpoint {
  readonly x: number;
  readonly y: number;
  readonly poly: number;
}

export interface Leg {
  readonly reachable: boolean;
  /** Integer tenth-yards. */
  readonly groundTenths: number;
  readonly swimTenths: number;
  readonly longestSwimYd: number;
  readonly corridor: number;
}

class Heap {
  cost = new Float64Array(1024);
  id = new Int32Array(1024);
  n = 0;

  private less(i: number, j: number): boolean {
    const a = this.cost[i] ?? 0;
    const b = this.cost[j] ?? 0;
    return a < b || (a === b && (this.id[i] ?? 0) < (this.id[j] ?? 0));
  }

  private swap(i: number, j: number): void {
    const c = this.cost[i] ?? 0;
    this.cost[i] = this.cost[j] ?? 0;
    this.cost[j] = c;
    const d = this.id[i] ?? 0;
    this.id[i] = this.id[j] ?? 0;
    this.id[j] = d;
  }

  push(cost: number, id: number): void {
    if (this.n === this.cost.length) {
      const c = new Float64Array(this.n * 2);
      c.set(this.cost);
      this.cost = c;
      const d = new Int32Array(this.n * 2);
      d.set(this.id);
      this.id = d;
    }
    let i = this.n;
    this.n += 1;
    this.cost[i] = cost;
    this.id[i] = id;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.id[0] ?? 0;
    this.n -= 1;
    if (this.n > 0) {
      this.cost[0] = this.cost[this.n] ?? 0;
      this.id[0] = this.id[this.n] ?? 0;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.n && this.less(l, m)) m = l;
        if (r < this.n && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

export interface Scratch {
  readonly dist: Float64Array;
  readonly par: Int32Array;
  readonly parEdge: Int32Array;
  readonly stamp: Int32Array;
  readonly done: Int32Array;
  readonly ccw: Uint8Array;
  readonly heap: Heap;
  run: number;
}

export function scratch(g: MapMesh): Scratch {
  const ccw = new Uint8Array(g.n);
  for (let p = 0; p < g.n; p += 1) {
    let a2 = 0;
    const a = g.vFirst[p] ?? 0;
    const b = g.vFirst[p + 1] ?? 0;
    for (let k = a; k < b; k += 1) {
      const k1 = k + 1 < b ? k + 1 : a;
      a2 += (g.vx[k] ?? 0) * (g.vy[k1] ?? 0) - (g.vx[k1] ?? 0) * (g.vy[k] ?? 0);
    }
    ccw[p] = a2 > 0 ? 1 : 0;
  }
  return { dist: new Float64Array(g.n), par: new Int32Array(g.n), parEdge: new Int32Array(g.n), stamp: new Int32Array(g.n), done: new Int32Array(g.n), ccw, heap: new Heap(), run: 0 };
}

const len = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
};

export function legsFrom(g: MapMesh, comp: Int32Array, S: Scratch, src: Endpoint, targets: readonly Endpoint[]): Leg[] {
  S.run += 1;
  const run = S.run;
  const H = S.heap;
  H.n = 0;
  const want = new Set<number>();
  const sc = comp[src.poly] ?? -1;
  for (const t of targets) if ((comp[t.poly] ?? -2) === sc) want.add(t.poly);
  let left = want.size;
  S.dist[src.poly] = 0;
  S.stamp[src.poly] = run;
  S.par[src.poly] = -1;
  S.parEdge[src.poly] = -1;
  H.push(0, src.poly);
  while (H.n > 0 && left > 0) {
    const c = H.cost[0] ?? 0;
    const p = H.pop();
    if (S.done[p] === run || c > (S.dist[p] ?? 0)) continue;
    S.done[p] = run;
    if (want.has(p)) left -= 1;
    const fp = g.swim[p] === 1 ? SWIM_FACTOR : 1;
    const px = p === src.poly ? src.x : (g.cx[p] ?? 0);
    const py = p === src.poly ? src.y : (g.cy[p] ?? 0);
    for (let k = g.eFirst[p] ?? 0; k < (g.eFirst[p + 1] ?? 0); k += 1) {
      const q = g.eTo[k] ?? 0;
      if (S.done[q] === run) continue;
      const mx = ((g.eAx[k] ?? 0) + (g.eBx[k] ?? 0)) / 2;
      const my = ((g.eAy[k] ?? 0) + (g.eBy[k] ?? 0)) / 2;
      const nd = c + len(px, py, mx, my) * fp + len(mx, my, g.cx[q] ?? 0, g.cy[q] ?? 0) * (g.swim[q] === 1 ? SWIM_FACTOR : 1);
      if (S.stamp[q] !== run || nd < (S.dist[q] ?? 0) || (nd === S.dist[q] && p < (S.par[q] ?? 0))) {
        S.stamp[q] = run;
        S.dist[q] = nd;
        S.par[q] = p;
        S.parEdge[q] = k;
        H.push(nd, q);
      }
    }
  }
  return targets.map((t) => {
    if ((comp[t.poly] ?? -2) !== sc || S.done[t.poly] !== run) return { reachable: false, groundTenths: 0, swimTenths: 0, longestSwimYd: 0, corridor: 0 };
    const path: number[] = [];
    const edges: number[] = [];
    for (let c = t.poly; c >= 0; c = S.par[c] ?? -1) {
      path.push(c);
      edges.push(S.parEdge[c] ?? -1);
    }
    path.reverse();
    edges.reverse();
    const f = funnel(g, S, path, edges, src.x, src.y, t.x, t.y);
    return { reachable: true, groundTenths: Math.round(f.ground * 10), swimTenths: Math.round(f.swim * 10), longestSwimYd: f.longestSwim, corridor: path.length };
  });
}

/**
 * The simple stupid funnel over the corridor's portals, then the ground/swim split: the path
 * crosses portal i at one point, and between consecutive crossings it is straight inside
 * corridor polygon i.
 */
export function funnel(g: MapMesh, S: Scratch, path: readonly number[], edges: readonly number[], sx: number, sy: number, ex: number, ey: number): { ground: number; swim: number; longestSwim: number; points: number[] } {
  const m = path.length;
  const L = new Float64Array((m + 1) * 2);
  const R = new Float64Array((m + 1) * 2);
  L[0] = sx;
  L[1] = sy;
  R[0] = sx;
  R[1] = sy;
  for (let i = 1; i < m; i += 1) {
    const k = edges[i] ?? 0;
    const p = path[i - 1] ?? 0;
    // the portal is stored in p's vertex order (a → b): for a counter-clockwise polygon left = b, right = a
    if (S.ccw[p] === 1) {
      L[i * 2] = g.eBx[k] ?? 0;
      L[i * 2 + 1] = g.eBy[k] ?? 0;
      R[i * 2] = g.eAx[k] ?? 0;
      R[i * 2 + 1] = g.eAy[k] ?? 0;
    } else {
      L[i * 2] = g.eAx[k] ?? 0;
      L[i * 2 + 1] = g.eAy[k] ?? 0;
      R[i * 2] = g.eBx[k] ?? 0;
      R[i * 2 + 1] = g.eBy[k] ?? 0;
    }
  }
  L[m * 2] = ex;
  L[m * 2 + 1] = ey;
  R[m * 2] = ex;
  R[m * 2 + 1] = ey;
  const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number => (cx - ax) * (by - ay) - (cy - ay) * (bx - ax);
  const pts: number[] = [sx, sy];
  const ptPortal: number[] = [0];
  let ax = sx;
  let ay = sy;
  let lx = sx;
  let ly = sy;
  let rx = sx;
  let ry = sy;
  let li = 0;
  let ri = 0;
  for (let i = 1; i <= m; i += 1) {
    const plx = L[i * 2] ?? 0;
    const ply = L[i * 2 + 1] ?? 0;
    const prx = R[i * 2] ?? 0;
    const pry = R[i * 2 + 1] ?? 0;
    if (tri(ax, ay, rx, ry, prx, pry) <= 0) {
      if ((ax === rx && ay === ry) || tri(ax, ay, lx, ly, prx, pry) > 0) {
        rx = prx;
        ry = pry;
        ri = i;
      } else {
        pts.push(lx, ly);
        ptPortal.push(li);
        ax = lx;
        ay = ly;
        const ai = li;
        rx = ax;
        ry = ay;
        ri = ai;
        i = ai;
        lx = ax;
        ly = ay;
        li = ai;
        continue;
      }
    }
    if (tri(ax, ay, lx, ly, plx, ply) >= 0) {
      if ((ax === lx && ay === ly) || tri(ax, ay, rx, ry, plx, ply) < 0) {
        lx = plx;
        ly = ply;
        li = i;
      } else {
        pts.push(rx, ry);
        ptPortal.push(ri);
        ax = rx;
        ay = ry;
        const ai = ri;
        lx = ax;
        ly = ay;
        li = ai;
        i = ai;
        rx = ax;
        ry = ay;
        ri = ai;
        continue;
      }
    }
  }
  if (pts[pts.length - 2] !== ex || pts[pts.length - 1] !== ey || ptPortal[ptPortal.length - 1] !== m) {
    pts.push(ex, ey);
    ptPortal.push(m);
  }
  const cxs = new Float64Array((m + 1) * 2);
  cxs[0] = sx;
  cxs[1] = sy;
  cxs[m * 2] = ex;
  cxs[m * 2 + 1] = ey;
  let seg = 0;
  for (let i = 1; i < m; i += 1) {
    while (seg + 1 < ptPortal.length && (ptPortal[seg + 1] ?? 0) < i) seg += 1;
    const x0 = pts[seg * 2] ?? 0;
    const y0 = pts[seg * 2 + 1] ?? 0;
    if (ptPortal[seg] === i) {
      cxs[i * 2] = x0;
      cxs[i * 2 + 1] = y0;
      continue;
    }
    const x1 = pts[seg * 2 + 2] ?? 0;
    const y1 = pts[seg * 2 + 3] ?? 0;
    if (ptPortal[seg + 1] === i) {
      cxs[i * 2] = x1;
      cxs[i * 2 + 1] = y1;
      continue;
    }
    const qx = L[i * 2] ?? 0;
    const qy = L[i * 2 + 1] ?? 0;
    const ux = (R[i * 2] ?? 0) - qx;
    const uy = (R[i * 2 + 1] ?? 0) - qy;
    const vx = x1 - x0;
    const vy = y1 - y0;
    const den = vx * uy - vy * ux;
    let s = den !== 0 ? ((qx - x0) * uy - (qy - y0) * ux) / den : 0;
    s = s < 0 ? 0 : s > 1 ? 1 : s;
    cxs[i * 2] = x0 + s * vx;
    cxs[i * 2 + 1] = y0 + s * vy;
  }
  let ground = 0;
  let swim = 0;
  let runLen = 0;
  let longest = 0;
  for (let i = 0; i < m; i += 1) {
    const d = len(cxs[i * 2] ?? 0, cxs[i * 2 + 1] ?? 0, cxs[i * 2 + 2] ?? 0, cxs[i * 2 + 3] ?? 0);
    if (g.swim[path[i] ?? 0] === 1) {
      swim += d;
      runLen += d;
      if (runLen > longest) longest = runLen;
    } else {
      ground += d;
      runLen = 0;
    }
  }
  return { ground, swim, longestSwim: longest, points: pts };
}
