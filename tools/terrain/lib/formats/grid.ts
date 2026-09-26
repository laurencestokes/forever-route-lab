/**
 * The world grid of a continent (wowdev.wiki ADT/v18; docs/research/coordinates.md §2):
 *
 * - 64 × 64 ADT tiles of 1600/3 yd; tile (row, col) = WDT `[YY][XX]`;
 * - 16 × 16 chunks (MCNK) per tile, 8 × 8 quads per chunk;
 * - world X points north, Y west, Z up; tile row 0 is the northernmost, col 0 the westernmost:
 *   tile (row, col) covers X in [ORIGIN − (row+1)·T, ORIGIN − row·T] and
 *   Y in [ORIGIN − (col+1)·T, ORIGIN − col·T].
 */

export const TILE_YD = 1600 / 3;
export const CHUNK_YD = TILE_YD / 16;
export const UNIT_YD = CHUNK_YD / 8;
export const MAP_ORIGIN_YD = 32 * TILE_YD;

export interface Rect {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

export interface TileRef {
  readonly row: number;
  readonly col: number;
}

export function tileRect(row: number, col: number): Rect {
  return {
    xMin: MAP_ORIGIN_YD - (row + 1) * TILE_YD,
    xMax: MAP_ORIGIN_YD - row * TILE_YD,
    yMin: MAP_ORIGIN_YD - (col + 1) * TILE_YD,
    yMax: MAP_ORIGIN_YD - col * TILE_YD,
  };
}

/** The rectangle of a `size` × `size` block of tiles whose first tile is (row0, col0). */
export function blockRect(row0: number, col0: number, size = 4): Rect {
  return {
    xMin: MAP_ORIGIN_YD - (row0 + size) * TILE_YD,
    xMax: MAP_ORIGIN_YD - row0 * TILE_YD,
    yMin: MAP_ORIGIN_YD - (col0 + size) * TILE_YD,
    yMax: MAP_ORIGIN_YD - col0 * TILE_YD,
  };
}

export function expandRect(rect: Rect, margin: number): Rect {
  return { xMin: rect.xMin - margin, xMax: rect.xMax + margin, yMin: rect.yMin - margin, yMax: rect.yMax + margin };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.xMax >= b.xMin && a.xMin <= b.xMax && a.yMax >= b.yMin && a.yMin <= b.yMax;
}

/**
 * The tiles a block reads: its `size` × `size` tiles plus a `ring` of neighbours (objects placed
 * on a neighbouring tile can reach into the block), clamped to the 64 × 64 grid, row-major.
 */
export function blockTiles(row0: number, col0: number, size = 4, ring = 1): TileRef[] {
  const out: TileRef[] = [];
  for (let row = Math.max(0, row0 - ring); row <= Math.min(63, row0 + size - 1 + ring); row += 1) {
    for (let col = Math.max(0, col0 - ring); col <= Math.min(63, col0 + size - 1 + ring); col += 1) out.push({ row, col });
  }
  return out;
}

/** The global chunk key used for per-chunk areas: (tile row · 16 + chunk row) · 1024 + (tile col · 16 + chunk col). */
export function chunkKey(tileRow: number, tileCol: number, chunkRow: number, chunkCol: number): number {
  return (tileRow * 16 + chunkRow) * 1024 + (tileCol * 16 + chunkCol);
}

/** The global chunk key of the chunk under world (x, y). */
export function chunkKeyAt(x: number, y: number): number {
  return Math.floor((MAP_ORIGIN_YD - x) / CHUNK_YD) * 1024 + Math.floor((MAP_ORIGIN_YD - y) / CHUNK_YD);
}
