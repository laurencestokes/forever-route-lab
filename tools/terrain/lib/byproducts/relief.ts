import { createHash } from 'node:crypto';
import { HEIGHT_SAMPLE_YD, QUADS_PER_CHUNK, HEIGHT_SAMPLES_PER_CHUNK, type MapGrids } from './grids';
import type { Rgb } from './png';

/**
 * The shaded relief raster (terrain-navigation.md §13.1), ported from the m3b prototype:
 *
 * - heights box-averaged over `factor × factor` samples of 8.33 yd (factor 2: 16.7 yd per pixel);
 * - a hillshade lit from the north-west at 45° with ×2 vertical exaggeration, from central
 *   differences of the averaged heights (edge pixels reuse their own height);
 * - palette indices: 0 transparent (no terrain), 1 water (more water quads than land quads under
 *   the pixel), 2-15 fourteen grey levels from dark to light.
 *
 * Row 0 of the raster is the north edge of the grid and column 0 its west edge, so on a map drawn
 * with north up the image needs no flip. Only `Math.sqrt` is used (no trigonometry).
 */

export const RELIEF_FACTOR = 2;
export const RELIEF_EXAGGERATION = 2;
export const RELIEF_LEVELS = 14;
/** Unit light vector (east, north, up) from the north-west, 45° above the horizon. */
export const RELIEF_LIGHT = { east: -0.5, north: 0.5, up: Math.SQRT1_2 } as const;

export const RELIEF_PALETTE: readonly Rgb[] = [
  [0, 0, 0],
  [96, 128, 160],
  ...Array.from({ length: RELIEF_LEVELS }, (_, i): Rgb => {
    const g = 40 + Math.round((i / (RELIEF_LEVELS - 1)) * 200);
    return [g, g, g];
  }),
];

export interface Relief {
  readonly width: number;
  readonly height: number;
  /** Yards per pixel. */
  readonly pixelYd: number;
  readonly indices: Uint8Array;
}

export function shadedRelief(grids: MapGrids, factor = RELIEF_FACTOR): Relief {
  const HC = grids.heightCols;
  const width = grids.heightCols / factor;
  const height = grids.heightRows / factor;
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error(`relief factor ${String(factor)} does not divide the height grid`);
  const d = HEIGHT_SAMPLE_YD * factor;
  const averaged = new Float32Array(width * height).fill(Number.NaN);
  for (let i = 0; i < height; i += 1) {
    for (let j = 0; j < width; j += 1) {
      let sum = 0;
      let n = 0;
      for (let a = 0; a < factor; a += 1) {
        for (let b = 0; b < factor; b += 1) {
          const v = grids.height[(i * factor + a) * HC + j * factor + b] ?? Number.NaN;
          if (!Number.isNaN(v)) {
            sum += v;
            n += 1;
          }
        }
      }
      if (n > 0) averaged[i * width + j] = sum / n;
    }
  }
  const quadsPerPixel = (QUADS_PER_CHUNK / HEIGHT_SAMPLES_PER_CHUNK) * factor;
  const indices = new Uint8Array(width * height);
  for (let i = 0; i < height; i += 1) {
    for (let j = 0; j < width; j += 1) {
      const centre = averaged[i * width + j] ?? Number.NaN;
      let wet = 0;
      let dry = 0;
      for (let a = 0; a < quadsPerPixel; a += 1) {
        for (let b = 0; b < quadsPerPixel; b += 1) {
          const v = grids.water[(i * quadsPerPixel + a) * grids.quadCols + j * quadsPerPixel + b];
          if (v === 2) wet += 1;
          else if (v === 1) dry += 1;
        }
      }
      if (Number.isNaN(centre) || wet + dry === 0) continue;
      if (wet > dry) {
        indices[i * width + j] = 1;
        continue;
      }
      const at = (ii: number, jj: number): number => {
        const v = averaged[Math.min(height - 1, Math.max(0, ii)) * width + Math.min(width - 1, Math.max(0, jj))] ?? Number.NaN;
        return Number.isNaN(v) ? centre : v;
      };
      const dzEast = ((at(i, j + 1) - at(i, j - 1)) / (2 * d)) * RELIEF_EXAGGERATION;
      const dzNorth = ((at(i - 1, j) - at(i + 1, j)) / (2 * d)) * RELIEF_EXAGGERATION;
      const length = Math.sqrt(dzEast * dzEast + dzNorth * dzNorth + 1);
      const shade = Math.max(0, (-dzEast * RELIEF_LIGHT.east - dzNorth * RELIEF_LIGHT.north + RELIEF_LIGHT.up) / length);
      indices[i * width + j] = 2 + Math.min(RELIEF_LEVELS - 1, Math.floor(shade * RELIEF_LEVELS));
    }
  }
  return { width, height, pixelYd: d, indices };
}

/** SHA-256 of `frl-indices <width> <height>\n` followed by the palette indices: the compressor-independent identity of the raster. */
export function indicesSha256(relief: Relief): string {
  return createHash('sha256').update(`frl-indices ${String(relief.width)} ${String(relief.height)}\n`).update(relief.indices).digest('hex');
}
