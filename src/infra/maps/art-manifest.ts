import { uiMapId, type UiMapId, worldMapId, type WorldMapId } from '../../domain/ids';
import { joinUrl } from '../http';
import { contentTypeOfName, type ImageContentType } from './image-types';

/**
 * The committed painted map art's manifest (`public/maps/art/manifest.json`; docs/MAPS.md §5,
 * terrain-navigation.md §13.4; D-033), checked by hand-written guards in the style of
 * `local-art.ts`: every listed image with its UiMap, world rectangle, pixel size and SHA-256.
 *
 * The manifest is written by one tool run (`tools/maps/convert.ts`), so one malformed entry refuses
 * the whole manifest (fail closed): the map then draws no painted art and says why. An image whose
 * UiMap spans several world maps (Azeroth 947, one rectangle per continent) has no rectangle
 * (`bounds: null`); it is listed apart (`unplaced`), because no world surface can show it whole.
 *
 * The images themselves are drawn from their deployed URLs: they ship with the app as its code does,
 * and an image element loads and decodes off the main thread. `tools/maps/validate.ts` and the dist
 * audit check their hashes at build time.
 */

export const ART_MANIFEST_PATH = 'maps/art/manifest.json';
/** Where the deployed art's notice is (D-033 rule 2), relative to the app's base. */
export const ART_NOTICE_PATH = 'maps/art/NOTICE.md';
const ART_DIR = 'maps/art/';

/** A world rectangle in yards on one world map: x north, y west. */
export interface ArtRect {
  readonly mapId: WorldMapId;
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

/** One committed image that a world surface can show. */
export interface ArtImage {
  readonly uiMapId: UiMapId;
  readonly name: string;
  /** The UiMap's type as the manifest records it (1 world, 2 continent, 3 zone, 4 dungeon, 5 micro, 6 orphan), or null. */
  readonly uiMapType: number | null;
  /** The art style the image was drawn from (UiMapArtStyleLayer); the default style is 1. */
  readonly styleId: number;
  /** The image's world rectangle (its UiMap's UiMapAssignment row at the art's build). */
  readonly bounds: ArtRect;
  /** The deployed file (`<base>maps/art/<uiMapId>.webp`). */
  readonly url: string;
  readonly contentType: ImageContentType;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

/** A committed image with no single world rectangle (Azeroth 947): not drawn on any world surface. */
export interface UnplacedArt {
  readonly uiMapId: UiMapId;
  readonly name: string;
}

export interface ArtManifest {
  /** The artwork's owner as the manifest names it (Blizzard Entertainment). */
  readonly owner: string;
  /** The client build the art was extracted from. */
  readonly build: string;
  /** Drawable images, ascending by UiMap. */
  readonly images: readonly ArtImage[];
  readonly unplaced: readonly UnplacedArt[];
}

type Json = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isPositiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const HEX64 = /^[0-9a-f]{64}$/;
/** `<uiMapId>.webp|png`: the only file names `tools/maps/convert.ts` writes. */
const ART_FILE = /^([1-9][0-9]*)\.(webp|png)$/;

function readRect(value: unknown, where: string): ArtRect | string {
  if (!isRecord(value)) return `${where} must be an object or null`;
  const { mapId, xMin, xMax, yMin, yMax } = value;
  if (!Number.isSafeInteger(mapId) || (mapId as number) < 0) return `${where}.mapId must be a world map id`;
  if (![xMin, xMax, yMin, yMax].every(isFiniteNumber)) return `${where} needs four finite edges`;
  const rect = { mapId: worldMapId(mapId as number), xMin: xMin as number, xMax: xMax as number, yMin: yMin as number, yMax: yMax as number };
  if (rect.xMax <= rect.xMin || rect.yMax <= rect.yMin) return `${where} is empty`;
  return rect;
}

/** The manifest's images, or why it cannot be used. */
export function parseArtManifest(json: unknown, baseUrl: string): ArtManifest | string {
  if (!isRecord(json)) return 'not an object';
  if (json['schema'] !== 1) return 'schema is not 1';
  if (json['kind'] !== 'map-art') return 'kind is not map-art';
  const artwork = json['artwork'];
  const owner = isRecord(artwork) ? artwork['owner'] : undefined;
  if (typeof owner !== 'string' || owner === '') return 'artwork.owner is missing';
  const client = json['client'];
  const build = isRecord(client) ? client['version'] : undefined;
  if (typeof build !== 'string') return 'client.version is missing';
  const files = json['files'];
  if (!Array.isArray(files)) return 'files must be an array';
  const images: ArtImage[] = [];
  const unplaced: UnplacedArt[] = [];
  const seen = new Set<string>();
  for (const [index, value] of files.entries()) {
    const where = `files[${String(index)}]`;
    if (!isRecord(value)) return `${where} must be an object`;
    const { path, uiMapId: id, name, uiMapType, styleId, contentType, width, height, sha256, bounds } = value;
    const match = typeof path === 'string' ? ART_FILE.exec(path) : null;
    if (typeof path !== 'string' || match === null) return `${where}.path must be <UiMapID>.webp or <UiMapID>.png`;
    if (seen.has(path)) return `${where}.path repeats ${path}`;
    seen.add(path);
    if (!isPositiveInteger(id) || String(id) !== match[1]) return `${where}.uiMapId must be the UiMapID its path names`;
    if (typeof name !== 'string') return `${where}.name must be a string`;
    if (uiMapType !== null && !Number.isSafeInteger(uiMapType)) return `${where}.uiMapType must be an integer or null`;
    if (!Number.isSafeInteger(styleId)) return `${where}.styleId must be an integer`;
    const expectedType = contentTypeOfName(path);
    if (expectedType === null || contentType !== expectedType) return `${where}.contentType must be ${expectedType ?? 'image/webp or image/png'}`;
    if (!isPositiveInteger(width) || !isPositiveInteger(height)) return `${where}: width and height must be positive integers`;
    if (typeof sha256 !== 'string' || !HEX64.test(sha256)) return `${where}.sha256 must be a SHA-256 hex digest`;
    if (bounds === null) {
      unplaced.push({ uiMapId: uiMapId(id), name });
      continue;
    }
    const rect = readRect(bounds, `${where}.bounds`);
    if (typeof rect === 'string') return rect;
    images.push({
      uiMapId: uiMapId(id),
      name,
      uiMapType: uiMapType as number | null,
      styleId: styleId as number,
      bounds: rect,
      url: joinUrl(baseUrl, `${ART_DIR}${path}`),
      contentType: expectedType,
      width,
      height,
      sha256,
    });
  }
  const ascending = <T extends { readonly uiMapId: UiMapId }>(list: T[]): T[] => list.sort((a, b) => a.uiMapId - b.uiMapId);
  return { owner, build, images: ascending(images), unplaced: ascending(unplaced) };
}
