import type { AdtRoot, Mcnk } from '../formats/adt';
import { outerIndex } from '../formats/adt';
import { CHUNK_YD, MAP_ORIGIN_YD, TILE_YD, UNIT_YD } from '../formats/grid';
import { topZone } from '../zones';

/**
 * The per-map rasters the byproducts are traced from (terrain-navigation.md §13.1), ported from
 * the m3b prototype: one pass over the map's root ADTs fills
 *
 * - `zone`: per MCNK chunk (33.3 yd), the top-level zone of its AreaTable id (0 for area 0);
 * - `height`: per 8.33-yd sample, the MCVT outer-vertex height (rows and columns 0, 2, 4, 6 of each
 *   chunk), NaN where there is no terrain;
 * - `water`: per quad (4.17 yd), 0 no terrain, 1 land (holes count as land), 2 water: a non-hazard
 *   liquid whose surface is more than 0.3 yd above the quad's ground (the mean of two opposite
 *   corners).
 *
 * The grid's origin is the north-west corner of the smallest tile rectangle holding every tile
 * with a root ADT; cells outside present tiles stay 0 / NaN.
 */

export const HEIGHT_SAMPLES_PER_CHUNK = 4;
export const QUADS_PER_CHUNK = 8;
export const MIN_WATER_DEPTH_YD = 0.3;

export interface TileBounds {
  readonly row0: number;
  readonly row1: number;
  readonly col0: number;
  readonly col1: number;
}

export interface MapGrids {
  readonly bounds: TileBounds;
  readonly chunkRows: number;
  readonly chunkCols: number;
  /** World X of the grid's north edge, world Y of its west edge. */
  readonly x0: number;
  readonly y0: number;
  readonly zone: Int32Array;
  readonly heightRows: number;
  readonly heightCols: number;
  readonly height: Float32Array;
  readonly quadRows: number;
  readonly quadCols: number;
  readonly water: Uint8Array;
}

/** The rectangle of the given tiles (rows and columns inclusive). */
export function tileBounds(tiles: readonly { readonly row: number; readonly col: number }[]): TileBounds {
  if (tiles.length === 0) throw new Error('a map needs at least one tile with a root ADT');
  return {
    row0: Math.min(...tiles.map((t) => t.row)),
    row1: Math.max(...tiles.map((t) => t.row)),
    col0: Math.min(...tiles.map((t) => t.col)),
    col1: Math.max(...tiles.map((t) => t.col)),
  };
}

/** The world rectangle of a tile rectangle. */
export function boundsRect(b: TileBounds): { readonly xMin: number; readonly xMax: number; readonly yMin: number; readonly yMax: number } {
  return { xMin: MAP_ORIGIN_YD - (b.row1 + 1) * TILE_YD, xMax: MAP_ORIGIN_YD - b.row0 * TILE_YD, yMin: MAP_ORIGIN_YD - (b.col1 + 1) * TILE_YD, yMax: MAP_ORIGIN_YD - b.col0 * TILE_YD };
}

export function createGrids(bounds: TileBounds): MapGrids {
  const chunkRows = (bounds.row1 - bounds.row0 + 1) * 16;
  const chunkCols = (bounds.col1 - bounds.col0 + 1) * 16;
  const heightRows = chunkRows * HEIGHT_SAMPLES_PER_CHUNK;
  const heightCols = chunkCols * HEIGHT_SAMPLES_PER_CHUNK;
  const quadRows = chunkRows * QUADS_PER_CHUNK;
  const quadCols = chunkCols * QUADS_PER_CHUNK;
  return {
    bounds,
    chunkRows,
    chunkCols,
    x0: MAP_ORIGIN_YD - bounds.row0 * TILE_YD,
    y0: MAP_ORIGIN_YD - bounds.col0 * TILE_YD,
    zone: new Int32Array(chunkRows * chunkCols),
    heightRows,
    heightCols,
    height: new Float32Array(heightRows * heightCols).fill(Number.NaN),
    quadRows,
    quadCols,
    water: new Uint8Array(quadRows * quadCols),
  };
}

/** Whether quad (row, col) of a chunk lies under a non-hazard liquid deeper than 0.3 yd. */
export function isWetQuad(m: Mcnk, row: number, col: number, hazard: ReadonlySet<number>): boolean {
  if (m.liquid === null || m.heights === null) return false;
  const ground = m.position[2] + ((m.heights[outerIndex(row, col)] ?? 0) + (m.heights[outerIndex(row + 1, col + 1)] ?? 0)) / 2;
  for (const l of m.liquid.instances) {
    if (row < l.y || row >= l.y + l.height || col < l.x || col >= l.x + l.width) continue;
    const lr = row - l.y;
    const lc = col - l.x;
    if (l.exists !== null && l.exists[lr * l.width + lc] !== true) continue;
    if (hazard.has(l.type)) continue;
    let surface = l.maxHeight;
    if (l.heights !== null) {
      const w = l.width + 1;
      surface = ((l.heights[lr * w + lc] ?? 0) + (l.heights[lr * w + lc + 1] ?? 0) + (l.heights[(lr + 1) * w + lc] ?? 0) + (l.heights[(lr + 1) * w + lc + 1] ?? 0)) / 4;
    }
    if (surface - ground > MIN_WATER_DEPTH_YD) return true;
  }
  return false;
}

/** Adds one tile's root ADT to the grids. */
export function addTile(grids: MapGrids, tile: { readonly row: number; readonly col: number }, root: AdtRoot, parents: ReadonlyMap<number, number>, hazard: ReadonlySet<number>): void {
  const { bounds, chunkCols, heightCols, quadCols } = grids;
  if (tile.row < bounds.row0 || tile.row > bounds.row1 || tile.col < bounds.col0 || tile.col > bounds.col1) throw new Error(`tile ${String(tile.row)}_${String(tile.col)} is outside the map's tile rectangle`);
  const P = HEIGHT_SAMPLES_PER_CHUNK;
  const Q = QUADS_PER_CHUNK;
  const step = Q / P;
  for (const m of root.chunks) {
    const cr = (tile.row - bounds.row0) * 16 + m.iy;
    const cc = (tile.col - bounds.col0) * 16 + m.ix;
    grids.zone[cr * chunkCols + cc] = m.areaId === 0 ? 0 : topZone(parents, m.areaId);
    if (m.heights === null) continue;
    for (let i = 0; i < P; i += 1) {
      for (let j = 0; j < P; j += 1) grids.height[(cr * P + i) * heightCols + cc * P + j] = m.position[2] + (m.heights[outerIndex(i * step, j * step)] ?? 0);
    }
    for (let r = 0; r < Q; r += 1) {
      for (let c = 0; c < Q; c += 1) {
        const q = (cr * Q + r) * quadCols + cc * Q + c;
        grids.water[q] = m.holes[r * 8 + c] === true ? 1 : isWetQuad(m, r, c, hazard) ? 2 : 1;
      }
    }
  }
}

export const ZONE_CELL_YD = CHUNK_YD;
export const COAST_CELL_YD = UNIT_YD;
export const HEIGHT_SAMPLE_YD = CHUNK_YD / HEIGHT_SAMPLES_PER_CHUNK;
