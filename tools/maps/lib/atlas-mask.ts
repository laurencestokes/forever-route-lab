import { RELIEF_WATER } from './atlas-params';

/**
 * Masks and distances for the atlas composition (docs/research/map-atlas.md §6.2): the 3-4
 * chamfer distance, the terrain relief's classes (none, sea, land, inland water) and area raster
 * from the committed byproducts (D-032), polygon rasters from the zone arcs, and bilinear lookups
 * on the relief grid. Pure, deterministic, no bitwise operators; the formulas are the revision-2
 * prototype's (`.cache/map-atlas/revise/proto2.mjs`).
 */

/** Relief classes: 0 outside the terrain, 1 sea water, 2 land, 3 inland water. */
export const CLASS_NONE = 0;
export const CLASS_SEA = 1;
export const CLASS_LAND = 2;
export const CLASS_INLAND = 3;

/**
 * Chamfer 3-4 distance (in pixels, divided by 3) from every pixel to the nearest pixel whose mask
 * value equals `target`, capped at `cap`. Two raster passes; Float32 storage.
 */
export function chamfer(mask: Uint8Array, w: number, h: number, target: number, cap: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i += 1) d[i] = mask[i] === target ? 0 : INF;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      let v = d[i] ?? INF;
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, (d[i - 1] ?? INF) + 3);
      if (y > 0) {
        v = Math.min(v, (d[i - w] ?? INF) + 3);
        if (x > 0) v = Math.min(v, (d[i - w - 1] ?? INF) + 4);
        if (x < w - 1) v = Math.min(v, (d[i - w + 1] ?? INF) + 4);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y -= 1) {
    for (let x = w - 1; x >= 0; x -= 1) {
      const i = y * w + x;
      let v = d[i] ?? INF;
      if (v === 0) continue;
      if (x < w - 1) v = Math.min(v, (d[i + 1] ?? INF) + 3);
      if (y < h - 1) {
        v = Math.min(v, (d[i + w] ?? INF) + 3);
        if (x < w - 1) v = Math.min(v, (d[i + w + 1] ?? INF) + 4);
        if (x > 0) v = Math.min(v, (d[i + w - 1] ?? INF) + 4);
      }
      d[i] = v;
    }
  }
  for (let i = 0; i < d.length; i += 1) d[i] = Math.min(cap, (d[i] ?? INF) / 3);
  return d;
}

/** A line segment of world yards `[xa, ya, xb, yb]` (x north, y west). */
export type Segment = readonly [number, number, number, number];

/** A zone arc of the terrain byproducts: `[leftArea, rightArea, x0, y0, dx1, dy1, …]` (deltas in yards). */
export type ZoneArc = readonly number[];

/** Every segment of the arcs, keyed by each side's area id, in arc order (map insertion order is first appearance). */
export function segmentsByArea(arcs: readonly ZoneArc[]): Map<number, Segment[]> {
  const by = new Map<number, Segment[]>();
  for (const a of arcs) {
    let x = a[2] ?? 0;
    let y = a[3] ?? 0;
    for (let i = 4; i < a.length; i += 2) {
      const nx = x + (a[i] ?? 0);
      const ny = y + (a[i + 1] ?? 0);
      for (const id of [a[0] ?? 0, a[1] ?? 0]) {
        const list = by.get(id);
        if (list === undefined) by.set(id, [[x, y, nx, ny]]);
        else list.push([x, y, nx, ny]);
      }
      x = nx;
      y = ny;
    }
  }
  return by;
}

/** The boundary of a set of areas: the segments of every arc with exactly one side in the set. */
export function boundaryOf(arcs: readonly ZoneArc[], areas: ReadonlySet<number>): Segment[] {
  const segs: Segment[] = [];
  for (const a of arcs) {
    if (areas.has(a[0] ?? 0) === areas.has(a[1] ?? 0)) continue;
    let x = a[2] ?? 0;
    let y = a[3] ?? 0;
    for (let i = 4; i < a.length; i += 2) {
      const nx = x + (a[i] ?? 0);
      const ny = y + (a[i + 1] ?? 0);
      segs.push([x, y, nx, ny]);
      x = nx;
      y = ny;
    }
  }
  return segs;
}

/** A world rectangle (yards). */
export interface WorldRectYd {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

/**
 * The relief grid of one world map (terrain byproducts, D-032): `w × h` cells of `s` yards, row 0 at
 * `r.xMax` (north), column 0 at `r.yMax` (west).
 */
export interface ReliefGrid {
  readonly mapId: number;
  readonly w: number;
  readonly h: number;
  readonly s: number;
  readonly r: WorldRectYd;
  /** 0 none, 1 sea, 2 land, 3 inland water. */
  readonly cls: Uint8Array;
  /** Relief grey 0-255 on land, 128 elsewhere. */
  readonly grey: Uint8Array;
  /** Terrain area id per cell (−1 where no zone polygon covers it). */
  readonly area: Int32Array;
  /** Inland water cells (water not connected to the map edge or the terrain's outside). */
  readonly inland: number;
}

/**
 * Classes, grey and area raster from the decoded relief (RGBA, palette 0 transparent, 1 water, 2-15
 * grey) and the zone arcs. Water reachable from the grid's edge or from a cell outside the terrain is
 * sea; the rest is inland water. Areas are filled by scanlines at each row's centre.
 */
export function reliefGrid(mapId: number, rgba: Uint8Array, w: number, h: number, s: number, r: WorldRectYd, arcs: readonly ZoneArc[]): ReliefGrid {
  const n = w * h;
  const cls = new Uint8Array(n);
  const grey = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const a = rgba[i * 4 + 3] ?? 0;
    const water = rgba[i * 4] === RELIEF_WATER[0] && rgba[i * 4 + 1] === RELIEF_WATER[1] && rgba[i * 4 + 2] === RELIEF_WATER[2];
    cls[i] = a === 0 ? CLASS_NONE : water ? CLASS_SEA : CLASS_LAND;
    grey[i] = a === 0 || water ? 128 : (rgba[i * 4] ?? 0);
  }
  const seen = new Uint8Array(n);
  const q: number[] = [];
  const neighbours = (i: number): number[] => {
    const x = i % w;
    const out: number[] = [];
    for (const j of [i - 1, i + 1, i - w, i + w]) {
      if (j < 0 || j >= n) continue;
      if ((j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) continue;
      out.push(j);
    }
    return out;
  };
  for (let i = 0; i < n; i += 1) {
    const x = i % w;
    const y = Math.floor(i / w);
    if (cls[i] === CLASS_SEA && (x === 0 || y === 0 || x === w - 1 || y === h - 1)) {
      seen[i] = 1;
      q.push(i);
    }
  }
  for (let i = 0; i < n; i += 1) {
    if (cls[i] !== CLASS_NONE) continue;
    for (const j of neighbours(i)) {
      if (cls[j] === CLASS_SEA && seen[j] === 0) {
        seen[j] = 1;
        q.push(j);
      }
    }
  }
  for (let k = 0; k < q.length; k += 1) {
    for (const j of neighbours(q[k] ?? 0)) {
      if (cls[j] === CLASS_SEA && seen[j] === 0) {
        seen[j] = 1;
        q.push(j);
      }
    }
  }
  let inland = 0;
  for (let i = 0; i < n; i += 1) {
    if (cls[i] === CLASS_SEA && seen[i] === 0) {
      cls[i] = CLASS_INLAND;
      inland += 1;
    }
  }
  const area = new Int32Array(n).fill(-1);
  const by = segmentsByArea(arcs);
  for (let row = 0; row < h; row += 1) {
    const X = r.xMax - (row + 0.5) * s;
    for (const [id, segs] of by) {
      if (id === 0) continue;
      const xs: number[] = [];
      for (const [xa, ya, xb, yb] of segs) {
        if ((xa > X) === (xb > X)) continue;
        xs.push(ya + ((X - xa) * (yb - ya)) / (xb - xa));
      }
      xs.sort((p, p2) => p - p2);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.ceil((r.yMax - (xs[k + 1] ?? 0)) / s - 0.5);
        const c1 = Math.floor((r.yMax - (xs[k] ?? 0)) / s - 0.5);
        for (let c = Math.max(0, c0); c <= Math.min(w - 1, c1); c += 1) area[row * w + c] = id;
      }
    }
  }
  return { mapId, w, h, s, r, cls, grey, area, inland };
}

/** The grid cell holding world point (X, Y), or −1 outside the grid. */
export function cellOf(g: ReliefGrid, X: number, Y: number): number {
  const c = Math.floor((g.r.yMax - Y) / g.s);
  const r = Math.floor((g.r.xMax - X) / g.s);
  return c < 0 || r < 0 || c >= g.w || r >= g.h ? -1 : r * g.w + c;
}

export function classAt(g: ReliefGrid, X: number, Y: number): number {
  const i = cellOf(g, X, Y);
  return i < 0 ? CLASS_NONE : (g.cls[i] ?? CLASS_NONE);
}

/** Bilinear interpolation of `fn(cell)` at (X, Y) between cell centres; `fn(−1)` outside the grid. */
export function bilin(g: ReliefGrid, X: number, Y: number, fn: (cell: number) => number): number {
  const fu = (g.r.yMax - Y) / g.s - 0.5;
  const fv = (g.r.xMax - X) / g.s - 0.5;
  const x0 = Math.floor(fu);
  const y0 = Math.floor(fv);
  const ax = fu - x0;
  const ay = fv - y0;
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const inX0 = x0 >= 0 && x0 < g.w;
  const inX1 = x1 >= 0 && x1 < g.w;
  const inY0 = y0 >= 0 && y0 < g.h;
  const inY1 = y1 >= 0 && y1 < g.h;
  const v00 = inX0 && inY0 ? fn(y0 * g.w + x0) : fn(-1);
  const v10 = inX1 && inY0 ? fn(y0 * g.w + x1) : fn(-1);
  const v01 = inX0 && inY1 ? fn(y1 * g.w + x0) : fn(-1);
  const v11 = inX1 && inY1 ? fn(y1 * g.w + x1) : fn(-1);
  return (v00 * (1 - ax) + v10 * ax) * (1 - ay) + (v01 * (1 - ax) + v11 * ax) * ay;
}

/**
 * A polygon raster over a pixel window: row `j` covers world `X = sOff − (j0 + j + 0.5)·p`, column
 * `i` covers `E = (i0 + i + 0.5)·p` with `Y = eOff − E`. A pixel is inside when its centre lies
 * between a pair of sorted crossings (even-odd rule).
 */
export function polygonRaster(segs: readonly Segment[], eOff: number, sOff: number, p: number, i0: number, j0: number, w: number, h: number): Uint8Array {
  const P = new Uint8Array(w * h);
  for (let j = 0; j < h; j += 1) {
    const X = sOff - (j0 + j + 0.5) * p;
    const xs: number[] = [];
    for (const [xa, ya, xb, yb] of segs) {
      if ((xa > X) === (xb > X)) continue;
      xs.push((eOff - (ya + ((X - xa) * (yb - ya)) / (xb - xa))) / p - 0.5 - i0);
    }
    xs.sort((a, c) => a - c);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k] ?? 0));
      const c1 = Math.min(w - 1, Math.floor(xs[k + 1] ?? 0));
      for (let c = c0; c <= c1; c += 1) P[j * w + c] = 1;
    }
  }
  return P;
}

/** Signed distance (pixels, capped): positive inside the polygon raster, negative outside. */
export function signedDistance(P: Uint8Array, w: number, h: number, cap: number): Float32Array {
  const din = chamfer(P, w, h, 0, cap);
  const dout = chamfer(P, w, h, 1, cap);
  const sd = new Float32Array(w * h);
  for (let k = 0; k < w * h; k += 1) sd[k] = P[k] === 1 ? (din[k] ?? 0) : -(dout[k] ?? 0);
  return sd;
}
