import { RECOLOUR, type RecolourParams } from './minimap-params';
import { isWetTexel, luma, parseTileKey, smooth, TEX, tileKey, type LiquidGrid, type MapTexels } from './minimap-texels';

/**
 * The seam steps of the sea recolour (docs/research/map-atlas.md §19.2 steps 7-9; revision 3.1,
 * MM-03), ported from the signed-off prototype (`rule3.ts` `edgeFeather3` with the Gaussian coverage,
 * the corner term, the navy floor and the dry clamp) with the same arithmetic in the same order. The
 * corrections accumulate in single precision in tile order, as the prototype's did, so the rounding
 * of every texel is the same. Pure; no bitwise operators (D-012).
 *
 * 7. Edge feather: for every ADT edge, per row where both sides' 4 edge texels are water (weight ≥ 0.9),
 *    the mean colour step across the edge; a Gaussian along the edge (σ 8 rows over ±24) averages it
 *    over those rows and tapers it by their weighted share (full from 50 %, none below 5 %); half goes
 *    to each side, fading linearly over 128 texels and scaled by each texel's weight.
 * 8. Corner term: after the edge terms, the (up to) four tiles at an ADT corner move to the mean of
 *    their corrected 8 × 8 corner blocks, faded by lin(dx) · lin(dy) over 128 texels.
 * 9. Floors: a texel recoloured at weight ≥ 0.99 is never darker than the navy in any channel; a
 *    dry-quad texel is never brighter than its source (void and haze texels are exempt by rule).
 */

type Rec = Map<string, Uint8Array>;
type Weights = ReadonlyMap<string, Uint8Array>;

/** The texel index at position `j` along an edge and `d` texels from it, on side A (west or north) or B. */
const sideA = (vertical: boolean, j: number, d: number): number => (vertical ? j * TEX + TEX - 1 - d : (TEX - 1 - d) * TEX + j);
const sideB = (vertical: boolean, j: number, d: number): number => (vertical ? j * TEX + d : d * TEX + j);

/** Steps 7 and 8 over every tile of `rec` (modified in place); returns the edges touched. */
export function edgeFeather(rec: Rec, weights: Weights, p: RecolourParams = RECOLOUR): number {
  const F = p.edgeFeather;
  const band = p.edgeBand;
  const rows = p.edgeWindow;
  const sig = p.edgeSigma;
  const water = p.edgeWaterWeight;
  let touched = 0;
  const adds = new Map<string, Float32Array>();
  const addOf = (k: string): Float32Array => {
    let a = adds.get(k);
    if (a === undefined) {
      a = new Float32Array(TEX * TEX * 3);
      adds.set(k, a);
    }
    return a;
  };
  const gauss = new Float64Array(2 * rows + 1);
  for (let q = -rows; q <= rows; q += 1) gauss[q + rows] = Math.exp(-(q * q) / (2 * sig * sig));
  for (const k of rec.keys()) {
    const [r, c] = parseTileKey(k);
    for (const [dr, dc] of [
      [0, 1],
      [1, 0],
    ] as const) {
      const k2 = tileKey(r + dr, c + dc);
      const A = rec.get(k);
      const B = rec.get(k2);
      const WA = weights.get(k);
      const WB = weights.get(k2);
      if (A === undefined || B === undefined || WA === undefined || WB === undefined) continue;
      const vertical = dc === 1;
      const delta = new Float32Array(TEX * 3);
      const has = new Uint8Array(TEX);
      for (let j = 0; j < TEX; j += 1) {
        let ok = true;
        const sa = [0, 0, 0];
        const sb = [0, 0, 0];
        for (let o = 0; o < band && ok; o += 1) {
          const pa = sideA(vertical, j, o);
          const pb = sideB(vertical, j, o);
          if ((WA[pa] ?? 0) < water || (WB[pb] ?? 0) < water) {
            ok = false;
            break;
          }
          for (let ch = 0; ch < 3; ch += 1) {
            sa[ch] = (sa[ch] ?? 0) + (A[pa * 3 + ch] ?? 0);
            sb[ch] = (sb[ch] ?? 0) + (B[pb * 3 + ch] ?? 0);
          }
        }
        if (!ok) continue;
        has[j] = 1;
        for (let ch = 0; ch < 3; ch += 1) delta[j * 3 + ch] = ((sb[ch] ?? 0) - (sa[ch] ?? 0)) / band;
      }
      const sm = new Float32Array(TEX * 3);
      let any = false;
      for (let j = 0; j < TEX; j += 1) {
        let sw = 0;
        let swet = 0;
        const s = [0, 0, 0];
        for (let q = Math.max(0, j - rows); q <= Math.min(TEX - 1, j + rows); q += 1) {
          const g = gauss[q - j + rows] ?? 0;
          sw += g;
          if (has[q] === 1) {
            swet += g;
            for (let ch = 0; ch < 3; ch += 1) s[ch] = (s[ch] ?? 0) + g * (delta[q * 3 + ch] ?? 0);
          }
        }
        if (swet <= 0) continue;
        const taper = smooth(p.edgeTaper[0], p.edgeTaper[1], swet / sw);
        if (taper > 0) {
          any = true;
          for (let ch = 0; ch < 3; ch += 1) sm[j * 3 + ch] = ((s[ch] ?? 0) / swet) * taper;
        }
      }
      if (!any) continue;
      touched += 1;
      const aA = addOf(k);
      const aB = addOf(k2);
      for (let j = 0; j < TEX; j += 1) {
        for (let d = 0; d < F; d += 1) {
          const f = 0.5 * (1 - (d + 0.5) / F);
          const pa = sideA(vertical, j, d);
          const pb = sideB(vertical, j, d);
          const wa = (WA[pa] ?? 0) / 255;
          const wb = (WB[pb] ?? 0) / 255;
          for (let ch = 0; ch < 3; ch += 1) {
            const v = sm[j * 3 + ch] ?? 0;
            aA[pa * 3 + ch] = (aA[pa * 3 + ch] ?? 0) + v * f * wa;
            aB[pb * 3 + ch] = (aB[pb * 3 + ch] ?? 0) - v * f * wb;
          }
        }
      }
    }
  }
  cornerTerm(rec, weights, adds, addOf, p);
  for (const [k, a] of adds) {
    const t = rec.get(k);
    if (t === undefined) continue;
    for (let i = 0; i < a.length; i += 1) t[i] = Math.max(0, Math.min(255, Math.round((t[i] ?? 0) + (a[i] ?? 0))));
  }
  return touched;
}

/** Step 8: at every ADT corner, the (up to) four tiles' corrected corner blocks meet at their mean. */
function cornerTerm(rec: Rec, weights: Weights, adds: ReadonlyMap<string, Float32Array>, addOf: (k: string) => Float32Array, p: RecolourParams): void {
  const C = p.cornerBlock;
  const F = p.edgeFeather;
  const water = p.edgeWaterWeight;
  const lin = (d: number): number => Math.max(0, 1 - (d + 0.5) / F);
  const vertices = new Set<string>();
  for (const k of rec.keys()) {
    const [r, c] = parseTileKey(k);
    for (const [dr, dc] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ] as const) {
      vertices.add(tileKey(r + dr, c + dc));
    }
  }
  for (const vk of vertices) {
    const [R, Cc] = parseTileKey(vk);
    const around: readonly (readonly [string, number, number])[] = [
      [tileKey(R - 1, Cc - 1), TEX - 1, TEX - 1],
      [tileKey(R - 1, Cc), 0, TEX - 1],
      [tileKey(R, Cc - 1), TEX - 1, 0],
      [tileKey(R, Cc), 0, 0],
    ];
    const vals: (readonly [string, number, number, readonly number[]])[] = [];
    for (const [k, cx, cy] of around) {
      const t = rec.get(k);
      const W = weights.get(k);
      if (t === undefined || W === undefined) continue;
      const a = adds.get(k);
      let n = 0;
      const s = [0, 0, 0];
      for (let dy = 0; dy < C; dy += 1) {
        for (let dx = 0; dx < C; dx += 1) {
          const x = cx === 0 ? dx : TEX - 1 - dx;
          const y = cy === 0 ? dy : TEX - 1 - dy;
          const i = y * TEX + x;
          if ((W[i] ?? 0) < water) continue;
          n += 1;
          // the texel and its correction are added first, then to the sum (the prototype's order)
          for (let ch = 0; ch < 3; ch += 1) s[ch] = (s[ch] ?? 0) + ((t[i * 3 + ch] ?? 0) + (a === undefined ? 0 : (a[i * 3 + ch] ?? 0)));
        }
      }
      if (n >= (C * C) / 2) vals.push([k, cx, cy, s.map((v) => v / n)]);
    }
    if (vals.length < 2) continue;
    const M = [0, 1, 2].map((ch) => vals.reduce((sum, v) => sum + (v[3][ch] ?? 0), 0) / vals.length);
    for (const [k, cx, cy, V] of vals) {
      const corr = [0, 1, 2].map((ch) => (M[ch] ?? 0) - (V[ch] ?? 0));
      if (Math.abs(corr[0] ?? 0) + Math.abs(corr[1] ?? 0) + Math.abs(corr[2] ?? 0) < p.cornerMinCorrection) continue;
      const a = addOf(k);
      const W = weights.get(k);
      if (W === undefined) continue;
      for (let dy = 0; dy < F; dy += 1) {
        const fy = lin(dy);
        for (let dx = 0; dx < F; dx += 1) {
          const f = fy * lin(dx);
          if (f <= 0) continue;
          const x = cx === 0 ? dx : TEX - 1 - dx;
          const y = cy === 0 ? dy : TEX - 1 - dy;
          const i = y * TEX + x;
          const w = (W[i] ?? 0) / 255;
          for (let ch = 0; ch < 3; ch += 1) a[i * 3 + ch] = (a[i * 3 + ch] ?? 0) + (corr[ch] ?? 0) * f * w;
        }
      }
    }
  }
}

/** Step 9, the navy floor: a texel recoloured at weight ≥ 0.99 (not void) is raised to the navy in each channel; returns the texels raised. */
export function navyFloor(rec: Rec, weights: Weights, voids: ReadonlyMap<string, Uint8Array>, p: RecolourParams = RECOLOUR): number {
  const [nr, ng, nb] = p.navy;
  let floored = 0;
  for (const [k, out] of rec) {
    const wv = weights.get(k);
    if (wv === undefined) continue;
    const vm = voids.get(k);
    for (let i = 0; i < TEX * TEX; i += 1) {
      if ((wv[i] ?? 0) < p.floorWeight || (vm !== undefined && vm[i] === 1)) continue;
      const q = i * 3;
      const r = out[q] ?? 0;
      const g = out[q + 1] ?? 0;
      const b = out[q + 2] ?? 0;
      if (r < nr || g < ng || b < nb) {
        out[q] = Math.max(r, nr);
        out[q + 1] = Math.max(g, ng);
        out[q + 2] = Math.max(b, nb);
        floored += 1;
      }
    }
  }
  return floored;
}

/**
 * Step 9, the dry clamp: the feathers move texels by offsets scaled by their weight, so a dry-quad
 * texel could end brighter than its source; the excess luma is taken off all three channels
 * equally. Void and haze texels are exempt. Returns the texels clamped.
 */
export function dryClamp(m: MapTexels, l: LiquidGrid, rec: Rec, weights: Weights, voids: ReadonlyMap<string, Uint8Array>, haze: ReadonlyMap<string, Float32Array>): number {
  let clamped = 0;
  for (const [k, out] of rec) {
    const [row, col] = parseTileKey(k);
    const src = m.rgb.get(k);
    const wv = weights.get(k);
    if (src === undefined || wv === undefined) continue;
    const vm = voids.get(k);
    const hz = haze.get(k);
    for (let y = 0; y < TEX; y += 1) {
      for (let x = 0; x < TEX; x += 1) {
        const i = y * TEX + x;
        if (wv[i] === 0 || isWetTexel(l, row, col, x, y)) continue;
        if (vm !== undefined && vm[i] === 1) continue;
        if (hz !== undefined && (hz[i] ?? 0) > 0) continue;
        const q = i * 3;
        const d = luma(out[q] ?? 0, out[q + 1] ?? 0, out[q + 2] ?? 0) - luma(src[q] ?? 0, src[q + 1] ?? 0, src[q + 2] ?? 0);
        if (d > 0.5) {
          const s = Math.ceil(d - 0.5);
          for (let ch = 0; ch < 3; ch += 1) out[q + ch] = Math.max(0, (out[q + ch] ?? 0) - s);
          clamped += 1;
        }
      }
    }
  }
  return clamped;
}
