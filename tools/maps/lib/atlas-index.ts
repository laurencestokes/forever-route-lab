import { BASE_LEVEL, MAX_LEVEL, MIN_LEVEL, TILE } from './atlas-params';
import { bitmapBase64, bitmapKeys } from './atlas-pyramid';
import type { Rgb } from './atlas-raster';

/**
 * `public/maps/atlas/index.json`, the runtime index (docs/research/map-atlas.md §7.2, MA-10): what
 * the tile layer needs before its first request, and nothing it could derive a distance from.
 *
 * - `atlasHash` (src/geo/atlas.ts) of the layout the tiles were composed in; the runtime refuses an
 *   index whose value differs from its own (§8.6), and check T4 compares it offline.
 * - The tile size, levels, URL template, the deep-sea (container background) and coastal water
 *   colours, the extent, `seamE`, the placements and the inset cards.
 * - Per UiMap drawn, its top stored level and its art's yards per pixel (map-presentation
 *   `BaseMapLabels`).
 * - Per level, a bitmap of stored keys, and for levels −8 to −2 a bitmap of sea keys; a fine key
 *   (levels −1, 0) is sea when its level −2 ancestor is. Bit `k = y·nx + x` is bit `k mod 8` of byte
 *   `floor(k / 8)`, base64. A key neither stored nor sea is virtual: drawn from its nearest stored
 *   ancestor.
 */

export const ATLAS_INDEX_FILE = 'index.json';
export const ATLAS_TILE_TEMPLATE = 't/{z}/{x}/{y}.webp';

export interface IndexPlacement {
  readonly mapId: number;
  readonly kind: 'placed' | 'inset';
  readonly eOff: number;
  readonly sOff: number;
  readonly rect: { readonly xMin: number; readonly xMax: number; readonly yMin: number; readonly yMax: number };
}

export interface IndexLevel {
  readonly z: number;
  readonly nx: number;
  readonly ny: number;
  readonly stored: string;
  readonly sea?: string;
}

export interface AtlasIndex {
  readonly schema: 1;
  readonly kind: 'map-atlas-index';
  readonly layout: string;
  readonly atlasHash: string;
  readonly tileSize: number;
  readonly minLevel: number;
  readonly maxLevel: number;
  readonly baseLevel: number;
  readonly underlayLevel: number;
  readonly template: string;
  readonly seaColour: Rgb;
  readonly coastColour: Rgb;
  readonly extent: { readonly eMin: number; readonly eMax: number; readonly sMin: number; readonly sMax: number };
  readonly seamE: number;
  readonly placements: readonly IndexPlacement[];
  readonly insets: readonly { readonly mapId: number; readonly uiMapId: number; readonly eMin: number; readonly eMax: number; readonly sMin: number; readonly sMax: number }[];
  /** UiMap id → [top stored level, art yards per pixel rounded to 0.001]. */
  readonly uiMaps: Readonly<Record<string, readonly [number, number]>>;
  readonly levels: readonly IndexLevel[];
}

export interface IndexKeys {
  readonly z: number;
  readonly nx: number;
  readonly ny: number;
  readonly stored: readonly (readonly [number, number])[];
  readonly sea: readonly (readonly [number, number])[] | null;
}

export function levelBitmaps(keys: IndexKeys): IndexLevel {
  const n = keys.nx * keys.ny;
  const stored = bitmapBase64(n, keys.stored.map(([x, y]) => y * keys.nx + x));
  if (keys.sea === null) return { z: keys.z, nx: keys.nx, ny: keys.ny, stored };
  return { z: keys.z, nx: keys.nx, ny: keys.ny, stored, sea: bitmapBase64(n, keys.sea.map(([x, y]) => y * keys.nx + x)) };
}

/** The keys a level of the index lists: `[x, y]` pairs in bit order. */
export function indexKeys(level: IndexLevel): { readonly stored: readonly (readonly [number, number])[]; readonly sea: readonly (readonly [number, number])[] | null } {
  const n = level.nx * level.ny;
  const pair = (k: number): readonly [number, number] => [k % level.nx, Math.floor(k / level.nx)];
  return { stored: bitmapKeys(level.stored, n).map(pair), sea: level.sea === undefined ? null : bitmapKeys(level.sea, n).map(pair) };
}

type Json = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Checks the index's shape (T1, T3); `errors` is empty exactly when `index` is not null. */
export function parseAtlasIndex(value: unknown): { readonly index: AtlasIndex | null; readonly errors: readonly string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { index: null, errors: ['(root): must be an object'] };
  if (value['schema'] !== 1) errors.push('schema must be 1');
  if (value['kind'] !== 'map-atlas-index') errors.push('kind must be "map-atlas-index"');
  if (typeof value['atlasHash'] !== 'string' || !/^[0-9a-f]{32}$/.test(value['atlasHash'])) errors.push('atlasHash must be 32 lowercase hex digits');
  if (value['tileSize'] !== TILE) errors.push(`tileSize must be ${String(TILE)}`);
  if (value['minLevel'] !== MIN_LEVEL || value['maxLevel'] !== MAX_LEVEL || value['baseLevel'] !== BASE_LEVEL) errors.push('minLevel, maxLevel and baseLevel must be −8, 0 and −2');
  if (value['template'] !== ATLAS_TILE_TEMPLATE) errors.push(`template must be ${ATLAS_TILE_TEMPLATE}`);
  const levels = value['levels'];
  if (!Array.isArray(levels) || levels.length !== MAX_LEVEL - MIN_LEVEL + 1) errors.push('levels must list every level −8 … 0');
  else {
    levels.forEach((l: unknown, i: number) => {
      const z = MIN_LEVEL + i;
      if (!isRecord(l) || l['z'] !== z || typeof l['nx'] !== 'number' || typeof l['ny'] !== 'number' || typeof l['stored'] !== 'string') errors.push(`levels[${String(i)}]: needs z ${String(z)}, nx, ny and stored`);
      else if ((z <= BASE_LEVEL) !== (typeof l['sea'] === 'string')) errors.push(`levels[${String(i)}]: a sea bitmap is listed for levels −8 … −2 only`);
    });
  }
  if (errors.length > 0) return { index: null, errors };
  return { index: value as unknown as AtlasIndex, errors };
}
