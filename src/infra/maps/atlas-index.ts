import { uiMapId, type UiMapId } from '../../domain/ids';
import type { AtlasExtent, AtlasTileIndex, AtlasTileLevel, MapStyle } from '../../map/adapter';
import { joinUrl } from '../http';

/**
 * The atlas tile index at runtime (`public/maps/atlas/index.json`; docs/research/map-atlas.md §7.2,
 * §8.6; D-042), checked by hand-written guards in the style of `art-manifest.ts` and decoded into
 * the plain `AtlasTileIndex` that `map/adapter`'s `resolveTile` reads.
 *
 * - The index is written by one tool run (`tools/maps/atlas.ts`), so any malformed field refuses
 *   the whole index (fail closed): the map then draws the terrain relief and says why.
 * - Its `atlasHash` must equal the atlas surface's (`atlasHash(placements, ATLAS_LAYOUT)` in
 *   src/geo/atlas.ts): tiles composed for other placements are refused (`atlasIndexRefusal`), never
 *   drawn out of place. `MapResources.atlas` applies both checks; it imports this module
 *   dynamically, so the reader stays out of the entry chunk.
 * - The tiles themselves are not fetched here: the tile layer draws them from URLs it builds only
 *   for keys the index lists (`tileUrl` in map/adapter).
 * - Bitmaps are decoded without bitwise operators (D-012): bit `k = y·nx + x` is bit `k mod 8` of
 *   byte `floor(k / 8)`, base64.
 * - **Two styles, one shape** (map-atlas.md §18.4, §21.1; D-049): the painted index
 *   (`maps/atlas/`, `baseLevel` −2, `underlayLevel` −5, no `style` field) and the minimap index
 *   (`maps/minimap/`, `style: "minimap"`, `baseLevel` 0, `underlayLevel` −6, `uiMaps` empty) are read
 *   by the same parser; only the directory differs, and an index whose `style` is not the one asked
 *   for is refused. The template is WebP only: AVIF would need the owner to override O13 (D-049 took
 *   WebP q80).
 */

/** Where each style's index and tiles are, under the app's base (map-atlas.md §21.1). */
export const ATLAS_STYLE_DIRS: Readonly<Record<MapStyle, string>> = { painted: 'maps/atlas/', minimap: 'maps/minimap/' };
/** The only tile template `tools/maps/atlas.ts` and `tools/maps/minimap.ts` write. */
const TILE_TEMPLATE = 't/{z}/{x}/{y}.webp';

/** A checked index: the decoded tile index, its style, the tiles' URL template under the app's base, and the layout's name. */
export interface AtlasIndexFile {
  readonly index: AtlasTileIndex;
  readonly style: MapStyle;
  /** `<base>maps/atlas/t/{z}/{x}/{y}.webp` (painted) or `<base>maps/minimap/t/{z}/{x}/{y}.webp` (minimap). */
  readonly urlTemplate: string;
  /** The layout the tiles were composed in (`compact`). */
  readonly layout: string;
}

type Json = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isInteger = (value: unknown): value is number => Number.isSafeInteger(value);
const isPositiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const HEX32 = /^[0-9a-f]{32}$/;

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 (with `=` padding) to bytes, by arithmetic; null for anything else. */
export function decodeBase64(text: string): Uint8Array | null {
  if (text.length % 4 !== 0) return null;
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  let at = 0;
  for (let i = 0; i < text.length; i += 4) {
    let value = 0;
    for (let j = 0; j < 4; j += 1) {
      const char = text.charAt(i + j);
      const digit = char === '=' && i + j >= text.length - padding ? 0 : BASE64.indexOf(char);
      if (digit < 0) return null;
      value = value * 64 + digit;
    }
    const bytes = [Math.floor(value / 65536) % 256, Math.floor(value / 256) % 256, value % 256];
    for (const byte of bytes) {
      if (at < out.length) out[at] = byte;
      at += 1;
    }
  }
  return out;
}

function readColour(value: unknown, where: string): readonly [number, number, number] | string {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((channel) => isInteger(channel) && channel >= 0 && channel <= 255)) {
    return `${where} must be three integers 0–255`;
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

function readExtent(value: unknown): AtlasExtent | string {
  if (!isRecord(value)) return 'extent must be an object';
  const { eMin, eMax, sMin, sMax } = value;
  if (![eMin, eMax, sMin, sMax].every(isFiniteNumber)) return 'extent needs four finite edges';
  const extent = { eMin: eMin as number, eMax: eMax as number, sMin: sMin as number, sMax: sMax as number };
  return extent.eMax > extent.eMin && extent.sMax > extent.sMin ? extent : 'extent is empty';
}

/** A bitmap of `n` keys: exactly `ceil(n / 8)` bytes. */
function readBitmap(value: unknown, n: number, where: string): Uint8Array | string {
  const bytes = typeof value === 'string' ? decodeBase64(value) : null;
  if (bytes === null) return `${where} must be base64`;
  return bytes.length === Math.ceil(n / 8) ? bytes : `${where} must hold ${String(n)} keys`;
}

function readLevels(value: unknown, minLevel: number, maxLevel: number, baseLevel: number): AtlasTileLevel[] | string {
  if (!Array.isArray(value) || value.length !== maxLevel - minLevel + 1) return 'levels must list every level from minLevel to maxLevel';
  const levels: AtlasTileLevel[] = [];
  for (const [i, entry] of value.entries()) {
    const z = minLevel + i;
    const where = `levels[${String(i)}]`;
    if (!isRecord(entry) || entry['z'] !== z) return `${where}.z must be ${String(z)}`;
    const { nx, ny } = entry;
    if (!isPositiveInteger(nx) || !isPositiveInteger(ny)) return `${where}: nx and ny must be positive integers`;
    const stored = readBitmap(entry['stored'], nx * ny, `${where}.stored`);
    if (typeof stored === 'string') return stored;
    const hasSea = entry['sea'] !== undefined;
    if (hasSea !== z <= baseLevel) return `${where}: a sea bitmap is listed for levels up to baseLevel only`;
    const sea = hasSea ? readBitmap(entry['sea'], nx * ny, `${where}.sea`) : null;
    if (typeof sea === 'string') return sea;
    levels.push({ z, nx, ny, stored, sea });
  }
  return levels;
}

function readUiMaps(value: unknown, minLevel: number, maxLevel: number): Map<UiMapId, { readonly topLevel: number; readonly ydPerPx: number }> | string {
  if (!isRecord(value)) return 'uiMaps must be an object';
  const out = new Map<UiMapId, { readonly topLevel: number; readonly ydPerPx: number }>();
  for (const [key, entry] of Object.entries(value)) {
    const id = Number(key);
    if (!isPositiveInteger(id) || String(id) !== key) return `uiMaps: ${key} is not a UiMap id`;
    if (!Array.isArray(entry) || entry.length !== 2) return `uiMaps.${key} must be [top level, yards per pixel]`;
    const [topLevel, ydPerPx] = entry as unknown[];
    if (!isInteger(topLevel) || topLevel < minLevel || topLevel > maxLevel || !isFiniteNumber(ydPerPx) || ydPerPx <= 0) {
      return `uiMaps.${key} must be [top level, yards per pixel]`;
    }
    out.set(uiMapId(id), { topLevel, ydPerPx });
  }
  return out;
}

/**
 * One style's index, its shape checked and decoded; or why it cannot be used (map-atlas.md §7.2,
 * §8.6, §21.1). `style` is the style asked for: its directory builds the URL template, and the
 * index's own `style` (absent in the painted index, which predates it) must be the same.
 */
export function parseAtlasIndex(json: unknown, baseUrl: string, style: MapStyle = 'painted'): AtlasIndexFile | string {
  if (!isRecord(json)) return 'not an object';
  if (json['schema'] !== 1) return 'schema is not 1';
  if (json['kind'] !== 'map-atlas-index') return 'kind is not map-atlas-index';
  const declared = json['style'] ?? 'painted';
  if (declared !== 'painted' && declared !== 'minimap') return 'style must be minimap or painted';
  if (declared !== style) return `it is the ${declared} style’s index, not the ${style} style’s`;
  const { layout, atlasHash, tileSize, minLevel, maxLevel, baseLevel, underlayLevel, template } = json;
  if (typeof layout !== 'string' || layout === '') return 'layout is missing';
  if (typeof atlasHash !== 'string' || !HEX32.test(atlasHash)) return 'atlasHash must be 32 lowercase hex digits';
  if (!isPositiveInteger(tileSize)) return 'tileSize must be a positive integer';
  if (!isInteger(minLevel) || !isInteger(maxLevel) || !isInteger(baseLevel) || !isInteger(underlayLevel)) return 'levels must be integers';
  if (!(minLevel <= baseLevel && baseLevel <= maxLevel && minLevel <= underlayLevel && underlayLevel <= maxLevel)) return 'baseLevel and underlayLevel must lie within minLevel … maxLevel';
  if (template !== TILE_TEMPLATE) return `template must be ${TILE_TEMPLATE}`;
  const seaColour = readColour(json['seaColour'], 'seaColour');
  if (typeof seaColour === 'string') return seaColour;
  const coastColour = readColour(json['coastColour'], 'coastColour');
  if (typeof coastColour === 'string') return coastColour;
  const extent = readExtent(json['extent']);
  if (typeof extent === 'string') return extent;
  const levels = readLevels(json['levels'], minLevel, maxLevel, baseLevel);
  if (typeof levels === 'string') return levels;
  const uiMaps = readUiMaps(json['uiMaps'], minLevel, maxLevel);
  if (typeof uiMaps === 'string') return uiMaps;
  const index: AtlasTileIndex = { hash: atlasHash, tileSize, minLevel, maxLevel, baseLevel, underlayLevel, seaColour, coastColour, extent, levels, uiMaps };
  return { index, style, urlTemplate: joinUrl(baseUrl, `${ATLAS_STYLE_DIRS[style]}${TILE_TEMPLATE}`), layout };
}

/**
 * Why a checked index cannot be drawn on the atlas whose `atlasHash` is `expected`: tiles composed
 * for other placements (map-atlas.md §7.2, §8.6); null when it can.
 */
export function atlasIndexRefusal(file: AtlasIndexFile, expected: string): string | null {
  if (file.index.hash === expected) return null;
  return `its atlasHash ${file.index.hash.slice(0, 12)}… is not this build’s ${expected.slice(0, 12)}… (the tiles were composed for other placements)`;
}
