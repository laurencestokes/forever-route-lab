import type { AtlasPlacement } from '../../../src/geo/atlas';
import type { AtlasLayout } from '../../../src/geo/atlas-layout';
import { NAVY, RESAMPLE, STITCH_BLOCK } from './minimap-params';
import { ORIGIN_YD, TEX, TEXEL_YD, tileKey, type Rgb } from './minimap-texels';

/**
 * Stitching and resampling onto the atlas grid (docs/research/map-atlas.md §18.2 step 6, §18.3,
 * A13). Each level-0 pixel (1 yd) belongs to the map `partition` gives it (the Zephras Isle card's
 * rectangle → 2991; E ≤ seamE → the west map, 1; otherwise the east map, 0), and its value is a
 * separable Lanczos-3 sample of that map's recoloured texels at
 * `u = (E + 0.5 − eOff + 17,066.67) / K − 0.5` (and `v` with S and `sOff`), K = 25/24 yd. Taps on an
 * absent ADT read the navy; pixels outside the extent are the navy. Pure; no bitwise operators.
 *
 * The weights are computed once per map and axis for every pixel of the extent (the same
 * expression the prototype evaluated per block, so the same doubles). Because 24 texels span
 * exactly 25 pixels they repeat every 25 pixels (`minimap-stitch.test.ts` checks it).
 */

/** Lanczos-3. */
export function lanczos3(x: number): number {
  if (x === 0) return 1;
  if (Math.abs(x) >= 3) return 0;
  const a = Math.PI * x;
  return (3 * Math.sin(a) * Math.sin(a / 3)) / (a * a);
}

const R = RESAMPLE.radius;
export const TAPS = 2 * R;

/** Per output pixel: the first source texel and its six normalised weights. */
export interface AxisTaps {
  readonly first: Int32Array;
  readonly w: Float64Array;
}

/**
 * The taps of pixels `0 … n−1` of one axis for a map whose texel 0 starts at atlas `off`
 * (`eOff − origin`): pixel centre `i + 0.5` is texel coordinate `c = (i + 0.5 − off) / K − 0.5`.
 */
export function axisTaps(n: number, off: number): AxisTaps {
  const first = new Int32Array(n);
  const w = new Float64Array(n * TAPS);
  const ws = new Float64Array(TAPS);
  for (let i = 0; i < n; i += 1) {
    const c = (i + 0.5 - off) / TEXEL_YD - 0.5;
    const f = Math.floor(c);
    let s = 0;
    for (let j = 0; j < TAPS; j += 1) {
      const t = f - R + 1 + j;
      ws[j] = lanczos3(c - t);
      s += ws[j] ?? 0;
    }
    for (let j = 0; j < TAPS; j += 1) w[i * TAPS + j] = (ws[j] ?? 0) / s;
    first[i] = f - R + 1;
  }
  return { first, w };
}

/**
 * The map each level-0 pixel belongs to, by `partition`'s rule (src/geo/atlas.ts) at the pixel's
 * centre: inside an inset's card (edges included) the inset's map, else the west map when
 * `E ≤ seamE`, else the east map.
 */
export interface PixelOwner {
  (e: number, s: number): number;
}

export function pixelOwner(placements: readonly AtlasPlacement[], layout: AtlasLayout): PixelOwner {
  const cards = placements
    .filter((p) => p.kind === 'inset')
    .map((p) => ({ mapId: Number(p.mapId), eMin: p.eOff - p.rect.yMax, eMax: p.eOff - p.rect.yMin, sMin: p.sOff - p.rect.xMax, sMax: p.sOff - p.rect.xMin }));
  const west = layout.placed.find((p) => p.side === 'west');
  const east = layout.placed.find((p) => p.side === 'east');
  if (west === undefined || east === undefined) throw new Error(`the ${layout.name} layout has no west or east map`);
  const w = Number(west.mapId);
  const eMap = Number(east.mapId);
  return (e, s) => {
    for (const c of cards) if (e >= c.eMin && e <= c.eMax && s >= c.sMin && s <= c.sMax) return c.mapId;
    return e <= layout.seamE ? w : eMap;
  };
}

/** One map's recoloured texels and where they sit. */
export interface StitchMap {
  readonly mapId: number;
  readonly tiles: ReadonlyMap<string, Uint8Array>;
  /** The atlas position of texel 0: `eOff − origin`, `sOff − origin`. */
  readonly e0: number;
  readonly s0: number;
  /** Its taps over the whole extent (`axisTaps(extentW, e0)` and `axisTaps(extentH, s0)`). */
  readonly tapsE: AxisTaps;
  readonly tapsS: AxisTaps;
  /** The atlas rectangle it may own (its placement's, or the card), to skip blocks it cannot touch. */
  readonly owns: { readonly eMin: number; readonly eMax: number; readonly sMin: number; readonly sMax: number };
}

export function stitchMap(mapId: number, tiles: ReadonlyMap<string, Uint8Array>, placement: AtlasPlacement, extentW: number, extentH: number, owns: StitchMap['owns']): StitchMap {
  const e0 = placement.eOff - ORIGIN_YD;
  const s0 = placement.sOff - ORIGIN_YD;
  return { mapId, tiles, e0, s0, tapsE: axisTaps(extentW, e0), tapsS: axisTaps(extentH, s0), owns };
}

/**
 * Block (bx, by) of level 0: `BLOCK × BLOCK` RGB pixels at atlas (bx·BLOCK, by·BLOCK). A horizontal
 * pass into single precision rows, then a vertical pass for the pixels the map owns, rounded.
 */
export function stitchBlock(bx: number, by: number, maps: readonly StitchMap[], owner: PixelOwner, extentW: number, extentH: number, navy: Rgb = NAVY, block: number = STITCH_BLOCK): Uint8Array {
  const [NR, NG, NB] = navy;
  const e0 = bx * block;
  const s0 = by * block;
  const raster = new Uint8Array(block * block * 3);
  for (let i = 0; i < block * block; i += 1) {
    raster[i * 3] = NR;
    raster[i * 3 + 1] = NG;
    raster[i * 3 + 2] = NB;
  }
  for (const M of maps) {
    if (M.owns.eMax < e0 || M.owns.eMin > e0 + block || M.owns.sMax < s0 || M.owns.sMin > s0 + block) continue;
    const nx = Math.min(block, extentW - e0);
    const ny = Math.min(block, extentH - s0);
    if (nx <= 0 || ny <= 0) continue;
    const u0 = M.tapsE.first[e0] ?? 0;
    const u1 = (M.tapsE.first[e0 + nx - 1] ?? 0) + TAPS - 1;
    const v0 = M.tapsS.first[s0] ?? 0;
    const v1 = (M.tapsS.first[s0 + ny - 1] ?? 0) + TAPS - 1;
    const cA = Math.floor(u0 / TEX);
    const cB = Math.floor(u1 / TEX);
    let any = false;
    for (let r = Math.floor(v0 / TEX); r <= Math.floor(v1 / TEX) && !any; r += 1) {
      for (let c = cA; c <= cB && !any; c += 1) if (M.tiles.has(tileKey(r, c))) any = true;
    }
    if (!any) continue;
    // horizontal pass: rows v0..v1 → single-precision rows of `nx` pixels
    const nRows = v1 - v0 + 1;
    const hp = new Float32Array(nRows * nx * 3);
    const rowTiles: (Uint8Array | undefined)[] = new Array<Uint8Array | undefined>(cB - cA + 1);
    for (let v = v0; v <= v1; v += 1) {
      const row = Math.floor(v / TEX);
      const ty0 = v - row * TEX;
      const base = (v - v0) * nx * 3;
      let allVoid = true;
      for (let c = cA; c <= cB; c += 1) {
        const t = M.tiles.get(tileKey(row, c));
        rowTiles[c - cA] = t;
        if (t !== undefined) allVoid = false;
      }
      if (allVoid) {
        for (let i = 0; i < nx; i += 1) {
          hp[base + i * 3] = NR;
          hp[base + i * 3 + 1] = NG;
          hp[base + i * 3 + 2] = NB;
        }
        continue;
      }
      const rowOff = ty0 * TEX;
      for (let i = 0; i < nx; i += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        const f = M.tapsE.first[e0 + i] ?? 0;
        const wo = (e0 + i) * TAPS;
        for (let j = 0; j < TAPS; j += 1) {
          const u = f + j;
          const col = Math.floor(u / TEX);
          const t = rowTiles[col - cA];
          const wj = M.tapsE.w[wo + j] ?? 0;
          if (t === undefined) {
            r += wj * NR;
            g += wj * NG;
            b += wj * NB;
            continue;
          }
          const p = (rowOff + (u - col * TEX)) * 3;
          r += wj * (t[p] ?? 0);
          g += wj * (t[p + 1] ?? 0);
          b += wj * (t[p + 2] ?? 0);
        }
        hp[base + i * 3] = r;
        hp[base + i * 3 + 1] = g;
        hp[base + i * 3 + 2] = b;
      }
    }
    // vertical pass, for the pixels this map owns
    for (let y = 0; y < ny; y += 1) {
      const f = (M.tapsS.first[s0 + y] ?? 0) - v0;
      const wo = (s0 + y) * TAPS;
      const sc = s0 + y + 0.5;
      for (let x = 0; x < nx; x += 1) {
        if (owner(e0 + x + 0.5, sc) !== M.mapId) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let j = 0; j < TAPS; j += 1) {
          const p = ((f + j) * nx + x) * 3;
          const wj = M.tapsS.w[wo + j] ?? 0;
          r += wj * (hp[p] ?? 0);
          g += wj * (hp[p + 1] ?? 0);
          b += wj * (hp[p + 2] ?? 0);
        }
        const q = (y * block + x) * 3;
        raster[q] = Math.max(0, Math.min(255, Math.round(r)));
        raster[q + 1] = Math.max(0, Math.min(255, Math.round(g)));
        raster[q + 2] = Math.max(0, Math.min(255, Math.round(b)));
      }
    }
  }
  return raster;
}

/**
 * The same resample for an arbitrary level-0 rectangle of one texel provider (the contact sheets'
 * "source" panel: the unrecoloured texels through the same stitch). `texels` returns a tile or
 * undefined (absent: the navy).
 */
export function resampleRect(e0: number, s0: number, w: number, h: number, maps: readonly StitchMap[], owner: PixelOwner, extentW: number, extentH: number, navy: Rgb = NAVY): Uint8Array {
  const out = new Uint8Array(w * h * 3);
  const [NR, NG, NB] = navy;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const E = e0 + x;
      const S = s0 + y;
      const q = (y * w + x) * 3;
      out[q] = NR;
      out[q + 1] = NG;
      out[q + 2] = NB;
      if (E < 0 || S < 0 || E >= extentW || S >= extentH) continue;
      const id = owner(E + 0.5, S + 0.5);
      const M = maps.find((m) => m.mapId === id);
      if (M === undefined) continue;
      const fS = M.tapsS.first[S] ?? 0;
      const fE = M.tapsE.first[E] ?? 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let jy = 0; jy < TAPS; jy += 1) {
        const v = fS + jy;
        const row = Math.floor(v / TEX);
        // the horizontal pass's single-precision row value, as stitchBlock stores it
        let hr = 0;
        let hg = 0;
        let hb = 0;
        for (let jx = 0; jx < TAPS; jx += 1) {
          const u = fE + jx;
          const col = Math.floor(u / TEX);
          const t = M.tiles.get(tileKey(row, col));
          const wj = M.tapsE.w[E * TAPS + jx] ?? 0;
          if (t === undefined) {
            hr += wj * NR;
            hg += wj * NG;
            hb += wj * NB;
          } else {
            const p = ((v - row * TEX) * TEX + (u - col * TEX)) * 3;
            hr += wj * (t[p] ?? 0);
            hg += wj * (t[p + 1] ?? 0);
            hb += wj * (t[p + 2] ?? 0);
          }
        }
        const wv = M.tapsS.w[S * TAPS + jy] ?? 0;
        r += wv * Math.fround(hr);
        g += wv * Math.fround(hg);
        b += wv * Math.fround(hb);
      }
      out[q] = Math.max(0, Math.min(255, Math.round(r)));
      out[q + 1] = Math.max(0, Math.min(255, Math.round(g)));
      out[q + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }
  return out;
}
