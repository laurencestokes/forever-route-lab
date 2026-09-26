import { CONNECTOR_YD_PER_SECOND, SWIM_FACTOR } from './cost';
import { funnel, FunnelWork } from './funnel';
import { CostHeap } from './heap';
import { lowerBound } from './link';
import { hasSide, NavMeshError, type BlockMesh, type NavMesh } from './mesh';
import { NavBlocksMissingError } from './snap';

/**
 * `legsFrom(source, targets)` (terrain-navigation.md §9.1; TN-03, TN-04, TN-05): the one routine
 * behind both the engine's leg table and the optimiser's matrices.
 *
 * 1. Targets in another component return `unreachable` at once (O(1), `map.bin`).
 * 2. Dijkstra from the source polygon. The heap is ordered by (cost, polygon id); an equal-cost
 *    relaxation keeps the lower parent id. Edge cost: the half-edge distance from the centroid
 *    (the source point for the source polygon) to the portal midpoint and on to the next centroid,
 *    each half times its polygon's factor (ground 1, swim 7/4.72, the era-assumed run and swim
 *    speeds); a connector link costs the walk to its polygon's centroid plus its seconds × 7. The
 *    search stops when every same-component target polygon is settled.
 * 3. Per target: the tree corridor; the funnel from the exact source point to the exact target
 *    point (split into walking pieces at connector links, which attach at polygon centroids:
 *    `map.bin` stores polygons, not points); the ground/swim split; the longest contiguous swim.
 * 4. Result: integer tenth-yards (TN-18), connector tenth-seconds, flags.
 *
 * **Resumable (RC-06, §9.6).** `LegSearch.run()` pops polygons in (cost, id) order. Before it
 * relaxes a polygon with a portal edge or a connector link into a listed block that is not
 * loaded, it returns `{ kind: 'needs', blocks }` without popping; the caller loads those blocks
 * (the mesh links them) and calls `run()` again. The expansion order depends only on (cost, id)
 * and every relaxation sees all of its polygon's edges, so the legs equal those of a fully loaded
 * mesh whatever the load order. `run(budget)` also returns `{ kind: 'yield' }` after `budget`
 * settled polygons, for progress and cancellation.
 *
 * Pure: `sqrt` only, no `hypot`, trigonometry, clock or randomness; the heap parent is
 * `Math.floor((i − 1) / 2)`. Lengths are horizontal (2D, RC-13); the rider approximation is the
 * TravelModel's (§9.1).
 */

/** An endpoint after snapping: the exact (quantised) point and its polygon, −1 when unsnapped. */
export interface LegEndpoint {
  readonly x: number;
  readonly y: number;
  readonly poly: number;
}

export type LegFlag = 'long-swim' | 'unverified-passage';

export type LegReason = 'ok' | 'unsnapped' | 'other-component' | 'no-path';

export interface Leg {
  readonly reachable: boolean;
  /** Why the leg is unreachable (`ok` when reachable); `no-path` is a one-way connector's missing way back. */
  readonly reason: LegReason;
  /** Horizontal length on ground polygons, integer tenth-yards. */
  readonly groundTenths: number;
  /** Horizontal length on swim polygons, integer tenth-yards. */
  readonly swimTenths: number;
  /** Connector time along the corridor (wait plus ride or cast), tenth-seconds. */
  readonly connectorTenthsSeconds: number;
  /** The longest contiguous swim run, yards. */
  readonly longestSwimYd: number;
  /** `long-swim` over the manifest's threshold (200 yd); `unverified-passage` when the corridor crosses a tagged passage. */
  readonly flags: readonly LegFlag[];
  /** Tagged passages the corridor crosses (indices into the manifest's `passages`), ascending. */
  readonly passages: readonly number[];
  /** Polygons in the corridor (0 when unreachable). */
  readonly corridor: number;
  /** Straight-path corners (x, y, z triples), only with `withPath`; pieces joined at connectors. */
  readonly path?: readonly number[];
  /** The 3D length through the portal crossings (yards), only with `with3d` (RC-13 measurement). */
  readonly length3dYd?: number;
}

export interface LegOptions {
  readonly withPath?: boolean;
  readonly with3d?: boolean;
}

export type SearchStatus = { readonly kind: 'done'; readonly legs: readonly Leg[] } | { readonly kind: 'needs'; readonly blocks: readonly number[] } | { readonly kind: 'yield' };

/** Corridor and funnel buffers, grown on demand. */
export class CorridorWork {
  path = new Int32Array(256);
  edges = new Int32Array(256);
  lx = new Float64Array(256);
  ly = new Float64Array(256);
  lz = new Float64Array(256);
  rx = new Float64Array(256);
  ry = new Float64Array(256);
  rz = new Float64Array(256);
  swim = new Uint8Array(256);
  readonly funnel = new FunnelWork();

  ensure(n: number): void {
    if (n <= this.path.length) return;
    let size = this.path.length;
    while (size < n) size *= 2;
    const grow = <T extends Int32Array | Float64Array | Uint8Array>(a: T, make: (k: number) => T): T => {
      const b = make(size);
      b.set(a);
      return b;
    };
    this.path = grow(this.path, (k) => new Int32Array(k));
    this.edges = grow(this.edges, (k) => new Int32Array(k));
    this.lx = new Float64Array(size);
    this.ly = new Float64Array(size);
    this.lz = new Float64Array(size);
    this.rx = new Float64Array(size);
    this.ry = new Float64Array(size);
    this.rz = new Float64Array(size);
    this.swim = new Uint8Array(size);
  }
}

/** Per-map search state: reused across searches, one active search at a time. */
export class SearchScratch {
  readonly dist: Float64Array;
  readonly par: Int32Array;
  /** Edge handle into the parent: index × 8 + kind (0 internal slot, 1 tile link, 2 seam link (index = k × 4 + side), 3 connector link). */
  readonly parEdge: Int32Array;
  readonly stamp: Int32Array;
  readonly done: Int32Array;
  /** Stamped with the run for every polygon a same-component target stands on. */
  readonly target: Int32Array;
  readonly heap = new CostHeap();
  /** Reused corridor and funnel buffers. */
  readonly work = new CorridorWork();
  run = 0;
  owner: object | null = null;

  constructor(readonly mesh: NavMesh) {
    this.dist = new Float64Array(mesh.n);
    this.par = new Int32Array(mesh.n);
    this.parEdge = new Int32Array(mesh.n);
    this.stamp = new Int32Array(mesh.n);
    this.done = new Int32Array(mesh.n);
    this.target = new Int32Array(mesh.n);
  }

  get bytes(): number {
    return this.dist.byteLength + this.par.byteLength + this.parEdge.byteLength + this.stamp.byteLength + this.done.byteLength + this.target.byteLength;
  }
}

const KIND_INTERNAL = 0;
const KIND_TILE = 1;
const KIND_SEAM = 2;
const KIND_CONNECTOR = 3;

const len = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
};

const unreachable = (reason: LegReason): Leg => ({ reachable: false, reason, groundTenths: 0, swimTenths: 0, connectorTenthsSeconds: 0, longestSwimYd: 0, flags: [], passages: [], corridor: 0 });

export class LegSearch {
  private readonly run0: number;
  private readonly removals0: number;
  private left = 0;
  private finished: readonly Leg[] | null = null;
  /** Polygons settled so far. */
  settled = 0;

  constructor(
    private readonly mesh: NavMesh,
    private readonly S: SearchScratch,
    private readonly source: LegEndpoint,
    private readonly targets: readonly LegEndpoint[],
    private readonly options: LegOptions = {},
  ) {
    if (S.mesh !== mesh) throw new NavMeshError('LegSearch: the scratch belongs to another mesh');
    S.run += 1;
    S.owner = this;
    S.heap.clear();
    this.run0 = S.run;
    this.removals0 = mesh.removals;
    if (source.poly >= 0) {
      if (!mesh.isLoaded(mesh.blockOf[source.poly] ?? -1)) throw new NavBlocksMissingError([mesh.blockOf[source.poly] ?? -1]);
      const sc = mesh.comp[source.poly] ?? -1;
      for (const t of targets) {
        if (t.poly >= 0 && (mesh.comp[t.poly] ?? -2) === sc && S.target[t.poly] !== this.run0) {
          S.target[t.poly] = this.run0;
          this.left += 1;
        }
      }
      S.dist[source.poly] = 0;
      S.stamp[source.poly] = this.run0;
      S.par[source.poly] = -1;
      S.parEdge[source.poly] = -1;
      S.heap.push(0, source.poly);
    }
  }

  /** Advances the search; see the module comment. */
  run(budget = Infinity): SearchStatus {
    if (this.finished !== null) return { kind: 'done', legs: this.finished };
    const S = this.S;
    const mesh = this.mesh;
    if (S.owner !== this || S.run !== this.run0) throw new NavMeshError('LegSearch: another search has used this scratch since');
    if (mesh.removals !== this.removals0) throw new NavMeshError('LegSearch: a block was unloaded during the search (pin the blocks a query touches)');
    const run = this.run0;
    const H = S.heap;
    const done = S.done;
    const dist = S.dist;
    const target = S.target;
    const blockOf = mesh.blockOf;
    const blocks = mesh.blocks;
    const hasLinks = mesh.facts.links.length > 0;
    let steps = 0;
    let left = this.left;
    try {
      while (H.size > 0 && left > 0) {
        const c = H.topCost();
        const p = H.topId();
        if (done[p] === run || c > (dist[p] ?? 0)) {
          H.pop();
          continue;
        }
        const m = blocks[blockOf[p] ?? -1];
        if (m === null || m === undefined) throw new NavMeshError(`LegSearch: polygon ${String(p)} is in a block that is not loaded`);
        if (((m.outerSides[p - m.base] ?? 0) > 0 && mesh.sideBlockMissing(m, p)) || (hasLinks && mesh.connectorsFrom.has(p))) {
          const missing = mesh.missingFor(p);
          if (missing.length > 0) return { kind: 'needs', blocks: missing };
        }
        if (steps >= budget) return { kind: 'yield' };
        steps += 1;
        H.pop();
        done[p] = run;
        if (target[p] === run) left -= 1;
        this.relax(p, c, m);
      }
    } finally {
      this.left = left;
      this.settled += steps;
    }
    this.finished = this.targets.map((t) => this.legTo(t));
    return { kind: 'done', legs: this.finished };
  }

  private relaxTo(q: number, nd: number, p: number, handle: number): void {
    const S = this.S;
    const run = this.run0;
    if (S.stamp[q] !== run || nd < (S.dist[q] ?? 0) || (nd === S.dist[q] && p < (S.par[q] ?? 0))) {
      S.stamp[q] = run;
      S.dist[q] = nd;
      S.par[q] = p;
      S.parEdge[q] = handle;
      S.heap.push(nd, q);
    }
  }

  private relax(p: number, c: number, m: BlockMesh): void {
    const mesh = this.mesh;
    const S = this.S;
    const run = this.run0;
    const lp = p - m.base;
    const cx = mesh.cx;
    const cy = mesh.cy;
    const swim = mesh.swim;
    const fp = swim[p] === 1 ? SWIM_FACTOR : 1;
    const isSource = p === this.source.poly;
    const px = isSource ? this.source.x : (cx[p] ?? 0);
    const py = isSource ? this.source.y : (cy[p] ?? 0);
    // internal edges, slot order (the hot loop: relaxTo inlined)
    const done = S.done;
    const stamp = S.stamp;
    const dist = S.dist;
    const par = S.par;
    const a = m.polyFirst[lp] ?? 0;
    const b = m.polyFirst[lp + 1] ?? 0;
    const nei = m.nei;
    const base = m.base;
    const slotVert = m.slotVert;
    const vx = m.vx;
    const vy = m.vy;
    const parEdge = S.parEdge;
    const heap = S.heap;
    for (let s = a; s < b; s += 1) {
      const ql = nei[s] ?? -1;
      if (ql < 0) continue;
      const q = base + ql;
      if (done[q] === run) continue;
      const va = slotVert[s] ?? 0;
      const vb = slotVert[s + 1 < b ? s + 1 : a] ?? 0;
      const mx = ((vx[va] ?? 0) + (vx[vb] ?? 0)) / 2;
      const my = ((vy[va] ?? 0) + (vy[vb] ?? 0)) / 2;
      const nd = c + len(px, py, mx, my) * fp + len(mx, my, cx[q] ?? 0, cy[q] ?? 0) * (swim[q] === 1 ? SWIM_FACTOR : 1);
      if (stamp[q] !== run || nd < (dist[q] ?? 0) || (nd === dist[q] && p < (par[q] ?? 0))) {
        stamp[q] = run;
        dist[q] = nd;
        par[q] = p;
        parEdge[q] = s * 8 + KIND_INTERNAL;
        heap.push(nd, q);
      }
    }
    // links between tiles of the block
    const x = m.cross;
    for (let k = x.first[lp] ?? 0; k < (x.first[lp + 1] ?? 0); k += 1) {
      const q = x.to[k] ?? 0;
      if (done[q] === run) continue;
      const mx = ((x.ax[k] ?? 0) + (x.bx[k] ?? 0)) / 2;
      const my = ((x.ay[k] ?? 0) + (x.by[k] ?? 0)) / 2;
      this.relaxTo(q, c + len(px, py, mx, my) * fp + len(mx, my, cx[q] ?? 0, cy[q] ?? 0) * (swim[q] === 1 ? SWIM_FACTOR : 1), p, k * 8 + KIND_TILE);
    }
    // links across the block's seams
    const sides = m.outerSides[lp] ?? 0;
    if (sides > 0) {
      for (let side = 0; side < 4; side += 1) {
        if (!hasSide(sides, side)) continue;
        const t = m.sides[side];
        if (t === null || t === undefined) continue;
        for (let k = lowerBound(t.from, p); k < t.from.length && t.from[k] === p; k += 1) {
          const q = t.to[k] ?? 0;
          if (done[q] === run) continue;
          const mx = ((t.ax[k] ?? 0) + (t.bx[k] ?? 0)) / 2;
          const my = ((t.ay[k] ?? 0) + (t.by[k] ?? 0)) / 2;
          this.relaxTo(q, c + len(px, py, mx, my) * fp + len(mx, my, cx[q] ?? 0, cy[q] ?? 0) * (swim[q] === 1 ? SWIM_FACTOR : 1), p, (k * 4 + side) * 8 + KIND_SEAM);
        }
      }
    }
    // connector links (off-mesh, §11.2): walk to the polygon's centroid, then the connector's time
    if (mesh.facts.links.length > 0) {
      const links = mesh.connectorsFrom.get(p);
      if (links !== undefined) {
        const walk = len(px, py, cx[p] ?? 0, cy[p] ?? 0) * fp;
        for (const li of links) {
          const l = mesh.facts.links[li];
          if (l === undefined || done[l.to] === run) continue;
          this.relaxTo(l.to, c + walk + (l.costTenths / 10) * CONNECTOR_YD_PER_SECOND, p, li * 8 + KIND_CONNECTOR);
        }
      }
    }
  }

  private legTo(t: LegEndpoint): Leg {
    const mesh = this.mesh;
    const S = this.S;
    const src = this.source;
    if (src.poly < 0 || t.poly < 0) return unreachable('unsnapped');
    if ((mesh.comp[t.poly] ?? -2) !== (mesh.comp[src.poly] ?? -1)) return unreachable('other-component');
    if (S.done[t.poly] !== this.run0) return unreachable('no-path');
    // the corridor, source first, from the parent chain
    let n = 0;
    for (let c = t.poly; c >= 0; c = S.par[c] ?? -1) n += 1;
    const W = S.work;
    W.ensure(n + 1);
    const path = W.path;
    const edges = W.edges;
    let k = n;
    for (let c = t.poly; c >= 0; c = S.par[c] ?? -1) {
      k -= 1;
      path[k] = c;
      edges[k] = S.parEdge[c] ?? -1;
    }
    // walking pieces between connector links
    const withPath = this.options.withPath === true;
    const heights = withPath || this.options.with3d === true;
    let ground = 0;
    let swim = 0;
    let longest = 0;
    let connector = 0;
    let length3d = 0;
    const corners: number[] = [];
    let start = 0;
    let startX = src.x;
    let startY = src.y;
    for (let i = 1; i <= n; i += 1) {
      const h = i < n ? (edges[i] ?? -1) : -1;
      const isConnector = i < n && h % 8 === KIND_CONNECTOR;
      if (i < n && !isConnector) continue;
      const last = path[i - 1] ?? 0;
      const endX = i < n ? (mesh.cx[last] ?? 0) : t.x;
      const endY = i < n ? (mesh.cy[last] ?? 0) : t.y;
      const piece = this.piece(start, i, startX, startY, endX, endY, heights);
      ground += piece.ground;
      swim += piece.swim;
      if (piece.longestSwim > longest) longest = piece.longestSwim;
      length3d += piece.length3d;
      if (withPath) for (const v of piece.corners) corners.push(v);
      if (isConnector) {
        const l = mesh.facts.links[(h - KIND_CONNECTOR) / 8];
        connector += l?.costTenths ?? 0;
        const next = path[i] ?? 0;
        startX = mesh.cx[next] ?? 0;
        startY = mesh.cy[next] ?? 0;
        start = i;
      }
    }
    let passages: number[] = [];
    if (mesh.passagesOf.size > 0) {
      const found = new Set<number>();
      for (let i = 0; i < n; i += 1) for (const q of mesh.passagesOf.get(path[i] ?? 0) ?? []) found.add(q);
      passages = [...found].sort((x, y) => x - y);
    }
    const flags: LegFlag[] = [];
    if (longest > mesh.P.longSwimYd) flags.push('long-swim');
    if (passages.length > 0) flags.push('unverified-passage');
    return {
      reachable: true,
      reason: 'ok',
      groundTenths: Math.round(ground * 10),
      swimTenths: Math.round(swim * 10),
      connectorTenthsSeconds: connector,
      longestSwimYd: longest,
      flags,
      passages,
      corridor: n,
      ...(withPath ? { path: corners } : {}),
      ...(this.options.with3d === true ? { length3dYd: length3d } : {}),
    };
  }

  /** Funnel of corridor polygons path[i0 .. i1 − 1] (in the scratch) from (sx, sy) to (ex, ey). */
  private piece(i0: number, i1: number, sx: number, sy: number, ex: number, ey: number, heights: boolean): ReturnType<typeof funnel> {
    const mesh = this.mesh;
    const W = this.S.work;
    const path = W.path;
    const edges = W.edges;
    const m = i1 - i0;
    W.ensure(m + 1);
    const { lx, ly, lz, rx, ry, rz, swim } = W;
    lx[0] = sx;
    ly[0] = sy;
    rx[0] = sx;
    ry[0] = sy;
    lx[m] = ex;
    ly[m] = ey;
    rx[m] = ex;
    ry[m] = ey;
    if (heights) {
      lz[0] = pointHeight(mesh, path[i0] ?? 0, sx, sy);
      rz[0] = lz[0];
      lz[m] = pointHeight(mesh, path[i1 - 1] ?? 0, ex, ey);
      rz[m] = lz[m];
    }
    for (let k = 0; k < m; k += 1) swim[k] = mesh.swim[path[i0 + k] ?? 0] ?? 0;
    for (let k = 1; k < m; k += 1) {
      const p = path[i0 + k - 1] ?? 0;
      const h = edges[i0 + k] ?? 0;
      const kind = h % 8;
      const idx = (h - kind) / 8;
      const blk = mesh.blockOfPoly(p);
      let ax: number;
      let ay: number;
      let az: number;
      let bx: number;
      let by: number;
      let bz: number;
      if (kind === KIND_INTERNAL) {
        const lp = p - blk.base;
        const a = blk.polyFirst[lp] ?? 0;
        const b = blk.polyFirst[lp + 1] ?? 0;
        const va = blk.slotVert[idx] ?? 0;
        const vb = blk.slotVert[idx + 1 < b ? idx + 1 : a] ?? 0;
        ax = blk.vx[va] ?? 0;
        ay = blk.vy[va] ?? 0;
        az = blk.vz[va] ?? 0;
        bx = blk.vx[vb] ?? 0;
        by = blk.vy[vb] ?? 0;
        bz = blk.vz[vb] ?? 0;
      } else {
        const side = kind === KIND_SEAM ? idx % 4 : 0;
        const table = kind === KIND_SEAM ? blk.sides[side] : blk.cross;
        const k2 = kind === KIND_SEAM ? (idx - side) / 4 : idx;
        if (table === null || table === undefined) throw new NavMeshError('LegSearch: a seam link of the corridor is gone');
        ax = table.ax[k2] ?? 0;
        ay = table.ay[k2] ?? 0;
        az = table.az[k2] ?? 0;
        bx = table.bx[k2] ?? 0;
        by = table.by[k2] ?? 0;
        bz = table.bz[k2] ?? 0;
      }
      // the portal is in p's vertex order (a → b): for a counter-clockwise polygon left = b, right = a
      if (mesh.ccw[p] === 1) {
        lx[k] = bx;
        ly[k] = by;
        lz[k] = bz;
        rx[k] = ax;
        ry[k] = ay;
        rz[k] = az;
      } else {
        lx[k] = ax;
        ly[k] = ay;
        lz[k] = az;
        rx[k] = bx;
        ry[k] = by;
        rz[k] = bz;
      }
    }
    return funnel({ m, lx, ly, lz, rx, ry, rz, swim, heights }, W.funnel);
  }
}

/**
 * Height of polygon p at (x, y): the triangle of its fan from slot 0 containing the point,
 * interpolated; the nearest fan triangle's plane when the point lies outside (a snapped point may
 * be up to 6 yd off). The mesh stores no detail heights, so this is an estimate for drawing and
 * for the 3D length only; lengths and costs never use it.
 */
export function pointHeight(mesh: NavMesh, p: number, x: number, y: number): number {
  const m = mesh.blockOfPoly(p);
  const lp = p - m.base;
  const a = m.polyFirst[lp] ?? 0;
  const b = m.polyFirst[lp + 1] ?? 0;
  const v0 = m.slotVert[a] ?? 0;
  const x0 = m.vx[v0] ?? 0;
  const y0 = m.vy[v0] ?? 0;
  const z0 = m.vz[v0] ?? 0;
  let best = mesh.cz[p] ?? 0;
  let bestOut = Infinity;
  for (let s = a + 1; s + 1 < b; s += 1) {
    const v1 = m.slotVert[s] ?? 0;
    const v2 = m.slotVert[s + 1] ?? 0;
    const x1 = m.vx[v1] ?? 0;
    const y1 = m.vy[v1] ?? 0;
    const x2 = m.vx[v2] ?? 0;
    const y2 = m.vy[v2] ?? 0;
    const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (den === 0) continue;
    const w0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / den;
    const w1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / den;
    const w2 = 1 - w0 - w1;
    const z = w0 * z0 + w1 * (m.vz[v1] ?? 0) + w2 * (m.vz[v2] ?? 0);
    const out = Math.max(0, -w0) + Math.max(0, -w1) + Math.max(0, -w2);
    if (out === 0) return z;
    if (out < bestOut) {
      bestOut = out;
      best = z;
    }
  }
  return best;
}

/**
 * Runs a search to completion, loading missing blocks through `load` (synchronous; tests,
 * benchmarks and tools). Without `load`, a missing block throws `NavBlocksMissingError`.
 */
export function legsFrom(mesh: NavMesh, scratch: SearchScratch, source: LegEndpoint, targets: readonly LegEndpoint[], options: LegOptions = {}, load?: (blocks: readonly number[]) => void): readonly Leg[] {
  const search = new LegSearch(mesh, scratch, source, targets, options);
  for (;;) {
    const status = search.run();
    if (status.kind === 'done') return status.legs;
    if (status.kind === 'needs') {
      if (load === undefined) throw new NavBlocksMissingError(status.blocks);
      load(status.blocks);
      for (const b of status.blocks) if (!mesh.isLoaded(b)) throw new NavBlocksMissingError([b]);
    }
  }
}

/**
 * The drawn route of one leg (§9.3 `path()`): the funnel's corners from `from` to `to` as x, y, z
 * triples (heights estimated, §9.1), pieces joined at connectors; null when the leg is not
 * reachable. `map/layers` applies its own vertex cap.
 */
export function navPath(mesh: NavMesh, scratch: SearchScratch, from: LegEndpoint, to: LegEndpoint, load?: (blocks: readonly number[]) => void): readonly number[] | null {
  const [leg] = legsFrom(mesh, scratch, from, [to], { withPath: true }, load);
  return leg?.reachable === true ? (leg.path ?? null) : null;
}
