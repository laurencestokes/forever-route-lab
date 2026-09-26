import { createHash } from 'node:crypto';

/**
 * A straight-alpha RGBA8 raster and the two drawing operations map-art assembly needs
 * (docs/MAPS.md §5.4 (b)): placing a tile at a pixel offset, cut to a clip rectangle, with
 * source-over blending. Integer results, deterministic on every platform (plain double
 * arithmetic and `Math.round`), no bitwise operators (D-012).
 */

export interface Rgba {
  readonly width: number;
  readonly height: number;
  /** width × height × 4 bytes, row-major, R G B A, not premultiplied. */
  readonly data: Uint8Array;
}

export interface PixelRect {
  readonly x0: number;
  readonly y0: number;
  /** Exclusive. */
  readonly x1: number;
  /** Exclusive. */
  readonly y1: number;
}

/** A fully transparent raster. */
export function createRaster(width: number, height: number): Rgba {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`raster size ${String(width)} × ${String(height)} is not a positive integer size`);
  }
  return { width, height, data: new Uint8Array(width * height * 4) };
}

const intersect = (a: PixelRect, b: PixelRect): PixelRect => ({
  x0: Math.max(a.x0, b.x0),
  y0: Math.max(a.y0, b.y0),
  x1: Math.min(a.x1, b.x1),
  y1: Math.min(a.y1, b.y1),
});

/**
 * Source-over of one straight-alpha pixel onto another, rounded to 8 bits:
 * a = sa + da·(1 − sa), c = (sc·sa + dc·da·(1 − sa)) / a. A transparent destination takes the
 * source unchanged, an opaque source replaces the destination, and a transparent source leaves it.
 */
export function blendOver(dst: Uint8Array, d: number, src: Uint8Array, s: number): void {
  const sa = src[s + 3] ?? 0;
  if (sa === 0) return;
  const da = dst[d + 3] ?? 0;
  if (sa === 255 || da === 0) {
    dst[d] = src[s] ?? 0;
    dst[d + 1] = src[s + 1] ?? 0;
    dst[d + 2] = src[s + 2] ?? 0;
    dst[d + 3] = sa;
    return;
  }
  const keep = (da * (255 - sa)) / 255;
  const a = sa + keep;
  for (let k = 0; k < 3; k += 1) dst[d + k] = Math.round(((src[s + k] ?? 0) * sa + (dst[d + k] ?? 0) * keep) / a);
  dst[d + 3] = Math.round(a);
}

/**
 * Draws `src` with its top-left corner at (x, y) of `dst`, source-over, only where the pixel lies
 * inside `clip` (default: the whole destination) and inside the destination. Returns the number
 * of source pixels drawn.
 */
export function drawOver(dst: Rgba, src: Rgba, x: number, y: number, clip?: PixelRect): number {
  const bounds: PixelRect = { x0: 0, y0: 0, x1: dst.width, y1: dst.height };
  const area = intersect(intersect(bounds, clip ?? bounds), { x0: x, y0: y, x1: x + src.width, y1: y + src.height });
  let drawn = 0;
  for (let py = area.y0; py < area.y1; py += 1) {
    for (let px = area.x0; px < area.x1; px += 1) {
      blendOver(dst.data, (py * dst.width + px) * 4, src.data, ((py - y) * src.width + (px - x)) * 4);
      drawn += 1;
    }
  }
  return drawn;
}

/** Whether every pixel is fully opaque. */
export function isOpaque(image: Rgba): boolean {
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] !== 255) return false;
  return true;
}

/** Pixels whose alpha is 0. */
export function transparentPixels(image: Rgba): number {
  let n = 0;
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] === 0) n += 1;
  return n;
}

/**
 * SHA-256 of the raster as `frl-rgba8 <width> <height>\n` followed by its RGBA bytes: the
 * encoder-independent identity of an image (the same on every machine, unlike encoded bytes).
 */
export function rasterSha256(image: Rgba): string {
  return createHash('sha256').update(`frl-rgba8 ${String(image.width)} ${String(image.height)}\n`).update(image.data).digest('hex');
}
