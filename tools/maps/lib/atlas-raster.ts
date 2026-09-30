import { ART_H, ART_W } from './atlas-params';

/**
 * Raster arithmetic for the atlas composition (docs/research/map-atlas.md §6): mip chains, bilinear
 * sampling with mip selection, the smoothstep ramps, the frame-interior and card weights, label
 * boxes, and the colour conversions of the tint. Pure and deterministic: plain IEEE double
 * arithmetic in a fixed order, integer rounding with `Math.round`/`Math.floor`, no bitwise
 * operators (D-012). Every formula is the revision-2 prototype's (`.cache/map-atlas/revise/proto2.mjs`),
 * operation for operation, so the same inputs give the same bytes.
 */

/** A 4-channel (RGBA) 8-bit raster, row-major. */
export interface Rgba8 {
  readonly w: number;
  readonly h: number;
  readonly d: Uint8Array;
}

/** A mip chain: level 0 is the source; each level halves it by a 2×2 box, rounded (at most 8 levels). */
export type MipChain = readonly Rgba8[];

export type Rgb = readonly [number, number, number];

/** Hermite smoothstep of `x` between `e0` and `e1` (0 below, 1 above). */
export function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function mipChain(img: Rgba8): MipChain {
  const chain: Rgba8[] = [img];
  let cur = img;
  while (cur.w >= 4 && cur.h >= 4 && chain.length < 8) {
    const w = Math.floor(cur.w / 2);
    const h = Math.floor(cur.h / 2);
    const d = new Uint8Array(w * h * 4);
    const src = cur.d;
    const row = cur.w * 4;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        for (let c = 0; c < 4; c += 1) {
          const i = (2 * y * cur.w + 2 * x) * 4 + c;
          d[(y * w + x) * 4 + c] = Math.floor(((src[i] ?? 0) + (src[i + 4] ?? 0) + (src[i + row] ?? 0) + (src[i + row + 4] ?? 0) + 2) / 4);
        }
      }
    }
    cur = { w, h, d };
    chain.push(cur);
  }
  return chain;
}

/**
 * Bilinear sample of channels `c0 … c0 + nc − 1` at source-pixel position (u, v) of level 0, from
 * the mip level whose scale is at most `scale` (source pixels per output pixel), edges clamped.
 */
export function sample(chain: MipChain, u: number, v: number, scale: number, out: number[], c0 = 0, nc = 3): void {
  let m = 0;
  while (m + 1 < chain.length && scale >= 2 ** (m + 1)) m += 1;
  const img = chain[m] as Rgba8;
  const base = chain[0] as Rgba8;
  const fu = (u * img.w) / base.w - 0.5;
  const fv = (v * img.h) / base.h - 0.5;
  const x0 = Math.floor(fu);
  const y0 = Math.floor(fv);
  const ax = fu - x0;
  const ay = fv - y0;
  // clamped to the image (no inner closures: this is the hottest function of the build)
  const xa = x0 < 0 ? 0 : x0 >= img.w ? img.w - 1 : x0;
  const xb = x0 + 1 < 0 ? 0 : x0 + 1 >= img.w ? img.w - 1 : x0 + 1;
  const ya = y0 < 0 ? 0 : y0 >= img.h ? img.h - 1 : y0;
  const yb = y0 + 1 < 0 ? 0 : y0 + 1 >= img.h ? img.h - 1 : y0 + 1;
  const d = img.d;
  for (let c = c0; c < c0 + nc; c += 1) {
    const v00 = d[(ya * img.w + xa) * 4 + c] ?? 0;
    const v10 = d[(ya * img.w + xb) * 4 + c] ?? 0;
    const v01 = d[(yb * img.w + xa) * 4 + c] ?? 0;
    const v11 = d[(yb * img.w + xb) * 4 + c] ?? 0;
    out[c - c0] = (v00 * (1 - ax) + v10 * ax) * (1 - ay) + (v01 * (1 - ax) + v11 * ax) * ay;
  }
}

/**
 * A painting's frame-interior weight at source position (u, v): `smoothstep(e0, e1, e) ·
 * smoothstep(corner, corner + 12, c)`, `e` the distance to the nearest edge and `c` the larger of the
 * two axis distances (so the corner ornaments are cut off). §6.2 step 4.
 */
export function interiorWeight(u: number, v: number, e0: number, e1: number, corner: number): number {
  const e = Math.min(u, ART_W - u, v, ART_H - v);
  const c = Math.max(Math.min(u, ART_W - u), Math.min(v, ART_H - v));
  return smooth(e0, e1, e) * smooth(corner, corner + 12, c);
}

/** The Ironforge and Undercity cards' weight: a linear ramp inside the torn edge, cut diagonally at the corners (§6.4). */
export function cardWeight(u: number, v: number, torn: number, ramp: number, corner: number): number {
  const eu = Math.min(u, ART_W - u);
  const ev = Math.min(v, ART_H - v);
  let f = (Math.min(eu, ev) - torn) / ramp;
  if (eu < corner && ev < corner) f = Math.min(f, (Math.max(eu, ev) - corner) / ramp);
  return f <= 0 ? 0 : f >= 1 ? 1 : f;
}

/** A box `[x0, y0, x1, y1]` feathered outwards by `f`: 1 inside, 0 beyond the feather. */
export function boxMask(u: number, v: number, box: readonly [number, number, number, number], f: number): number {
  const [x0, y0, x1, y1] = box;
  return Math.min(smooth(x0 - f, x0, u), 1 - smooth(x1, x1 + f, u), smooth(y0 - f, y0, v), 1 - smooth(y1, y1 + f, v));
}

export function rgbToHsl(r0: number, g0: number, b0: number): [number, number, number] {
  const r = r0 / 255;
  const g = g0 / 255;
  const b = b0 / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** map-presentation §12.4's fallback tint of a mean colour: saturation capped, lightness clamped. */
export function tintOf(rgb: readonly number[], maxSaturation: number, lightness: readonly [number, number]): [number, number, number] {
  const [h, s, l] = rgbToHsl(rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0);
  return hslToRgb(h, Math.min(s, maxSaturation), Math.min(lightness[1], Math.max(lightness[0], l)));
}

/** sRGB channel to linear light, and relative luminance (WCAG). */
export function linear(c0: number): number {
  const c = c0 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
