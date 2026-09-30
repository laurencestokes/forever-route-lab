import { QUADS, TEX, tileKey, WATER_LAND, WATER_WET, type LiquidGrid, type MapTexels, type Rgb, type TilePosition } from './minimap-texels';

/**
 * Synthetic minimap maps for the tests (docs/research/map-atlas.md §25, MM.2-MM.4): 512 × 512 RGB
 * tiles drawn from functions, and liquid grids from a per-quad predicate. No client bytes.
 */

export type Painter = (x: number, y: number) => Rgb;

export function paintTile(paint: Painter): Uint8Array {
  const out = new Uint8Array(TEX * TEX * 3);
  for (let y = 0; y < TEX; y += 1) {
    for (let x = 0; x < TEX; x += 1) {
      const [r, g, b] = paint(x, y);
      const q = (y * TEX + x) * 3;
      out[q] = r;
      out[q + 1] = g;
      out[q + 2] = b;
    }
  }
  return out;
}

export interface SynthTile extends TilePosition {
  readonly paint: Painter;
}

/** A map of the given tiles, row-major. */
export function synthMap(mapId: number, tiles: readonly SynthTile[]): MapTexels {
  const sorted = [...tiles].sort((a, b) => a.row - b.row || a.col - b.col);
  return { mapId, tiles: sorted.map((t) => ({ row: t.row, col: t.col })), rgb: new Map(sorted.map((t) => [tileKey(t.row, t.col), paintTile(t.paint)])) };
}

/** The liquid grid over the tiles' rectangle: `wet(row, col, qx, qy)` per quad of a present tile, land otherwise within present tiles. */
export function synthLiquid(tiles: readonly TilePosition[], wet: (row: number, col: number, qx: number, qy: number) => boolean): LiquidGrid {
  const row0 = Math.min(...tiles.map((t) => t.row));
  const col0 = Math.min(...tiles.map((t) => t.col));
  const rows = Math.max(...tiles.map((t) => t.row)) - row0 + 1;
  const cols = Math.max(...tiles.map((t) => t.col)) - col0 + 1;
  const quadRows = rows * QUADS;
  const quadCols = cols * QUADS;
  const water = new Uint8Array(quadRows * quadCols);
  for (const t of tiles) {
    for (let qy = 0; qy < QUADS; qy += 1) {
      for (let qx = 0; qx < QUADS; qx += 1) {
        water[((t.row - row0) * QUADS + qy) * quadCols + (t.col - col0) * QUADS + qx] = wet(t.row, t.col, qx, qy) ? WATER_WET : WATER_LAND;
      }
    }
  }
  return { row0, col0, quadRows, quadCols, water };
}

export function texel(tile: Uint8Array | undefined, x: number, y: number): Rgb {
  if (tile === undefined) throw new Error('no tile');
  const q = (y * TEX + x) * 3;
  return [tile[q] ?? 0, tile[q + 1] ?? 0, tile[q + 2] ?? 0];
}

export const DARK_WATER: Rgb = [8, 16, 16];
export const NAVY_FAMILY_WATER: Rgb = [27, 51, 71];
export const TEAL_SHALLOW: Rgb = [50, 80, 80];

// ---------------------------------------------------------------------------------------------
// A synthetic minimap world on atlas-test-support's layout (maps 1 and 0, the 2991 card)

export const ISLAND_LAND: Rgb = [150, 120, 90];

/** Map 1: a 2 × 2 tile island in dark water; map 0: one tile of navy-family water with a rock; map 2991: an island on a black void. */
export function synthWorld(): { readonly maps: readonly { readonly texels: MapTexels; readonly liquid: LiquidGrid }[] } {
  // land in rectangles aligned to the 16-texel relief cells, so no cell is part land, part water
  const islandAt = (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number): boolean => x >= x0 && x < x1 && y >= y0 && y < y1;
  // map 1: an island across the four tiles of its 2 × 2 block
  const island1 = islandAt(160, 160, 864, 864);
  const t1: SynthTile[] = [];
  for (const [row, col] of [
    [31, 31],
    [31, 32],
    [32, 31],
    [32, 32],
  ] as const) {
    t1.push({ row, col, paint: (x, y) => (island1((col - 31) * TEX + x, (row - 31) * TEX + y) ? [ISLAND_LAND[0], ISLAND_LAND[1] + ((x + y) % 7), ISLAND_LAND[2]] : [DARK_WATER[0], DARK_WATER[1] + (col === 32 ? 3 : 0), DARK_WATER[2] + ((x * 3 + y) % 5)]) });
  }
  const m1 = synthMap(1, t1);
  const l1 = synthLiquid(m1.tiles, (row, col, qx, qy) => !island1((col - 31) * TEX + qx * 4 + 2, (row - 31) * TEX + qy * 4 + 2));
  const rock = islandAt(192, 192, 320, 320);
  const m0 = synthMap(0, [{ row: 31, col: 31, paint: (x, y) => (rock(x, y) ? [120, 110, 100] : [NAVY_FAMILY_WATER[0], NAVY_FAMILY_WATER[1] + (x % 3), NAVY_FAMILY_WATER[2]]) }]);
  const l0 = synthLiquid(m0.tiles, (_r, _c, qx, qy) => !rock(qx * 4 + 2, qy * 4 + 2));
  const isle = islandAt(336, 208, 432, 304);
  const m2 = synthMap(2991, [{ row: 31, col: 31, paint: (x, y) => (x < 200 ? [0, 0, 0] : isle(x, y) ? [90, 140, 60] : x < 260 ? [20, 20, 20] : DARK_WATER) }]);
  const l2 = synthLiquid(m2.tiles, (_r, _c, qx, qy) => qx * 4 >= 260 && !isle(qx * 4 + 2, qy * 4 + 2));
  return {
    maps: [
      { texels: m1, liquid: l1 },
      { texels: m0, liquid: l0 },
      { texels: m2, liquid: l2 },
    ],
  };
}

/** The relief classes a liquid grid reduces to by the relief's rule (water where wet quads outnumber land quads). */
export function reliefOf(mapId: number, l: LiquidGrid): { mapId: number; w: number; h: number; row0: number; col0: number; cls: Uint8Array } {
  const w = l.quadCols / 4;
  const h = l.quadRows / 4;
  const cls = new Uint8Array(w * h);
  for (let i = 0; i < h; i += 1) {
    for (let j = 0; j < w; j += 1) {
      let wet = 0;
      let dry = 0;
      for (let a = 0; a < 4; a += 1) {
        for (let b = 0; b < 4; b += 1) {
          const v = l.water[(i * 4 + a) * l.quadCols + j * 4 + b];
          if (v === WATER_WET) wet += 1;
          else if (v === WATER_LAND) dry += 1;
        }
      }
      cls[i * w + j] = wet + dry === 0 ? 0 : wet > dry ? 1 : 2;
    }
  }
  return { mapId, w, h, row0: l.row0, col0: l.col0, cls };
}
