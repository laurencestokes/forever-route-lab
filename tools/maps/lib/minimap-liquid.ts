import { parseAdtRoot } from '../../terrain/lib/formats/adt';
import { addTile, createGrids, tileBounds } from '../../terrain/lib/byproducts/grids';
import { MinimapInputError } from './minimap-decode';
import { WATER_LAND, WATER_WET, type LiquidGrid, type TilePosition } from './minimap-texels';
import { sha256Hex } from './hash';

/**
 * The liquid grid the recolour's gate reads (docs/research/map-atlas.md §18.2 step 4, A16): the
 * root ADTs through tools/terrain `grids.ts` `addTile`, so a 4.17-yd quad is wet under a non-hazard
 * liquid deeper than 0.3 yd, exactly as the committed terrain byproducts compute it. For maps 0 and
 * 1 the tool reduces the grid by the relief's rule (a 16.7-yd pixel is water when its wet quads
 * outnumber its land quads) and refuses to build unless the result equals the committed
 * `public/maps/terrain/<map>/relief.png` water class, so the gate and the offline checks (M8, M9,
 * M11) use the same terrain. Zephras Isle has no committed terrain; its grid is recorded by hash.
 */

/** Relief classes per pixel: 0 no terrain, 1 water, 2 land (`relief.png` palette index 0, 1, 2-15). */
export const RELIEF_NONE = 0;
export const RELIEF_WATER = 1;
export const RELIEF_LAND = 2;
/** The relief's water colour (tools/terrain `RELIEF_PALETTE[1]`). */
export const RELIEF_WATER_RGB: readonly [number, number, number] = [96, 128, 160];
/** Liquid-grid quads per relief pixel side (16.7 yd over 4.17 yd). */
export const QUADS_PER_RELIEF_PIXEL = 4;

export interface ReliefClasses {
  readonly mapId: number;
  readonly w: number;
  readonly h: number;
  /** The tile rectangle's north-west ADT (terrain manifest `tileRows[0]`, `tileCols[0]`). */
  readonly row0: number;
  readonly col0: number;
  readonly cls: Uint8Array;
}


/** The map's liquid grid from its root ADTs (every tile given must have one). */
export function buildLiquidGrid<T extends TilePosition>(tiles: readonly T[], readRoot: (tile: T) => Buffer, hazard: ReadonlySet<number>): LiquidGrid {
  if (tiles.length === 0) throw new MinimapInputError('a map without minimap tiles has no liquid grid');
  const grids = createGrids(tileBounds(tiles));
  for (const t of tiles) addTile(grids, t, parseAdtRoot(readRoot(t)), new Map(), hazard);
  return { row0: grids.bounds.row0, col0: grids.bounds.col0, quadRows: grids.quadRows, quadCols: grids.quadCols, water: grids.water };
}

/** The classes of a decoded relief image (RGBA): transparent → none, the water colour → water, any other → land. */
export function reliefClasses(mapId: number, rgba: Uint8Array, w: number, h: number, row0: number, col0: number): ReliefClasses {
  const cls = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    if ((rgba[i * 4 + 3] ?? 0) === 0) cls[i] = RELIEF_NONE;
    else if (rgba[i * 4] === RELIEF_WATER_RGB[0] && rgba[i * 4 + 1] === RELIEF_WATER_RGB[1] && rgba[i * 4 + 2] === RELIEF_WATER_RGB[2]) cls[i] = RELIEF_WATER;
    else cls[i] = RELIEF_LAND;
  }
  return { mapId, w, h, row0, col0, cls };
}

export interface ReliefEquality {
  readonly originOk: boolean;
  readonly sizeOk: boolean;
  /** Relief pixels with terrain, compared. */
  readonly compared: number;
  readonly same: number;
  /** Water in the relief, land in the reduced grid; and the reverse. */
  readonly reliefWaterOnly: number;
  readonly gridWaterOnly: number;
}

/** The grid reduced by the relief's rule, against the relief's water class, on every pixel with terrain. */
export function reliefEquality(grid: LiquidGrid, relief: ReliefClasses): ReliefEquality {
  const originOk = grid.row0 === relief.row0 && grid.col0 === relief.col0;
  const sizeOk = grid.quadCols === relief.w * QUADS_PER_RELIEF_PIXEL && grid.quadRows === relief.h * QUADS_PER_RELIEF_PIXEL;
  let compared = 0;
  let same = 0;
  let reliefWaterOnly = 0;
  let gridWaterOnly = 0;
  if (originOk && sizeOk) {
    const P = QUADS_PER_RELIEF_PIXEL;
    for (let i = 0; i < relief.h; i += 1) {
      for (let j = 0; j < relief.w; j += 1) {
        const c = relief.cls[i * relief.w + j] ?? RELIEF_NONE;
        if (c === RELIEF_NONE) continue;
        let wet = 0;
        let dry = 0;
        for (let a = 0; a < P; a += 1) {
          for (let b = 0; b < P; b += 1) {
            const v = grid.water[(i * P + a) * grid.quadCols + j * P + b];
            if (v === WATER_WET) wet += 1;
            else if (v === WATER_LAND) dry += 1;
          }
        }
        compared += 1;
        const gw = wet > dry;
        const rw = c === RELIEF_WATER;
        if (gw === rw) same += 1;
        else if (rw) reliefWaterOnly += 1;
        else gridWaterOnly += 1;
      }
    }
  }
  return { originOk, sizeOk, compared, same, reliefWaterOnly, gridWaterOnly };
}

/** Why the grid may not be used as the gate for a map with committed terrain, or null. */
export function reliefRefusal(mapId: number, e: ReliefEquality): string | null {
  if (!e.originOk || !e.sizeOk) return `map ${String(mapId)}: the liquid grid's tile rectangle is not the committed relief's`;
  if (e.compared === 0) return `map ${String(mapId)}: no relief pixel was compared`;
  if (e.same !== e.compared) {
    return `map ${String(mapId)}: the liquid grid reduced by the relief's rule differs from the committed relief's water class on ${String(e.compared - e.same)} of ${String(e.compared)} pixels (${String(e.reliefWaterOnly)} water only in the relief, ${String(e.gridWaterOnly)} only in the grid); rebuild the terrain byproducts or check the client`;
  }
  return null;
}

export interface LiquidGridRecord {
  readonly row0: number;
  readonly col0: number;
  readonly quadRows: number;
  readonly quadCols: number;
  readonly wetQuads: number;
  readonly landQuads: number;
  /** SHA-256 of `frl-liquid-grid <rows> <cols> <row0> <col0>\n` and the class bytes (0 none, 1 land, 2 wet). */
  readonly sha256: string;
}

export function liquidGridRecord(grid: LiquidGrid): LiquidGridRecord {
  let wetQuads = 0;
  let landQuads = 0;
  for (const v of grid.water) {
    if (v === WATER_WET) wetQuads += 1;
    else if (v === WATER_LAND) landQuads += 1;
  }
  const header = Buffer.from(`frl-liquid-grid ${String(grid.quadRows)} ${String(grid.quadCols)} ${String(grid.row0)} ${String(grid.col0)}\n`);
  return { row0: grid.row0, col0: grid.col0, quadRows: grid.quadRows, quadCols: grid.quadCols, wetQuads, landQuads, sha256: sha256Hex(Buffer.concat([header, grid.water])) };
}
