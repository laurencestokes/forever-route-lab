/**
 * The texel space of the minimap tool (docs/research/map-atlas.md §17, §18.2): shared types and
 * small helpers for the decode, recolour, census and stitch modules. Pure: no file system, no
 * clock, no randomness, no bitwise operators (D-012).
 *
 * - A minimap tile is one ADT: 512 × 512 texels of 1600/3 ÷ 512 = 25/24 yd (1.0417 yd), RGB, row 0
 *   the ADT's north edge, column 0 its west edge (world X points north, Y west).
 * - The liquid grid has 128 × 128 quads (4.17 yd) per ADT; `water` is 0 without terrain, 1 land,
 *   2 wet (a non-hazard liquid deeper than 0.3 yd; tools/terrain `grids.ts`).
 * - Tiles are keyed `row_col`, and every map-wide loop walks them in row-major order, the order the
 *   WDT lists them. Floating-point sums (the feathers) depend on that order, so it is fixed here.
 */

/** Texels per ADT side. */
export const TEX = 512;
/** Liquid-grid quads per ADT side (4 texels each). */
export const QUADS = 128;
/** Texels per quad side. */
export const TEXELS_PER_QUAD = 4;
/** The map origin, 32 ADTs of 1600/3 yd (docs/research/coordinates.md §2.1). */
export const ORIGIN_YD = 51200 / 3;
/** One ADT, 1600/3 yd. */
export const ADT_YD = 51200 / 3 / 32;
/** Yards per minimap texel: 25/24. */
export const TEXEL_YD = ADT_YD / TEX;

export type Rgb = readonly [number, number, number];

export const tileKey = (row: number, col: number): string => `${String(row)}_${String(col)}`;

export function parseTileKey(key: string): readonly [number, number] {
  const [row, col] = key.split('_').map(Number);
  return [row ?? 0, col ?? 0];
}

export interface TilePosition {
  readonly row: number;
  readonly col: number;
}

/** A map's decoded minimap tiles: `tiles` in row-major order, `rgb` 512 × 512 × 3 bytes per tile. */
export interface MapTexels {
  readonly mapId: number;
  readonly tiles: readonly TilePosition[];
  readonly rgb: ReadonlyMap<string, Uint8Array>;
}

/** A map's liquid grid (tools/terrain `MapGrids.water`), with the tile rectangle's origin. */
export interface LiquidGrid {
  readonly row0: number;
  readonly col0: number;
  readonly quadRows: number;
  readonly quadCols: number;
  readonly water: Uint8Array;
}

export const WATER_NONE = 0;
export const WATER_LAND = 1;
export const WATER_WET = 2;

/** Whether texel (x, y) of tile (row, col) lies on a wet quad. */
export function isWetTexel(l: LiquidGrid, row: number, col: number, x: number, y: number): boolean {
  const qy = (row - l.row0) * QUADS + Math.floor(y / TEXELS_PER_QUAD);
  const qx = (col - l.col0) * QUADS + Math.floor(x / TEXELS_PER_QUAD);
  return qx >= 0 && qy >= 0 && qx < l.quadCols && qy < l.quadRows && l.water[qy * l.quadCols + qx] === WATER_WET;
}

/** Rec. 709 luma of sRGB values (not linearised), as the design measures it (§19.2). */
export const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Hermite smoothstep from `a` to `b`. */
export function smooth(a: number, b: number, x: number): number {
  if (x <= a) return 0;
  if (x >= b) return 1;
  const t = (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

export const clampByte = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

/** A new 512 × 512 RGB tile filled with one colour. */
export function flatTile(c: Rgb): Uint8Array {
  const out = new Uint8Array(TEX * TEX * 3);
  for (let i = 0; i < TEX * TEX; i += 1) {
    out[i * 3] = c[0];
    out[i * 3 + 1] = c[1];
    out[i * 3 + 2] = c[2];
  }
  return out;
}
