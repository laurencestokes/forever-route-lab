import { uiMapId, type UiMapId, type WorldMapId } from '../../domain/ids';
import { isFullUiRectangle, type MapGeometry } from '../../geo';
import { sha256Hex, type Sha256Digest } from '../hash';
import { type FetchLike, joinUrl } from '../http';
import type * as ImageHeaderModule from './image-header';
import { contentTypeOfName, type ImageContentType } from './image-types';

/**
 * Local map art at runtime (docs/MAPS.md §5.3 "Set manifest", §5.6 "Runtime behaviour" step 7;
 * ARCHITECTURE §7.3; D-018).
 *
 * `tools/maps validate --activate` lists each art image in the manifest's `art` section: the file
 * (relative to `local-maps/`), its content type, pixel size, SHA-256, and the world rectangle it
 * covers (the UiMap's single full-rectangle row in `geometry.local.json`). Here that section is
 * parsed and checked against the local geometry the loader has already verified and merged:
 *
 * - it is read only for a **compatible** local set; otherwise there is no art;
 * - every entry's bounds must equal its UiMap's row in the local geometry exactly (assignment ID,
 *   world map, all four edges), and that row must be the UiMap's only row, OrderIndex 0 with the
 *   full UI rectangle, so the image is one axis-aligned rectangle on one world surface
 *   (coordinates.md §4.1, §14.1; Azeroth 947 spans two world maps and has no art entry);
 * - one malformed or disagreeing entry refuses the whole section (fail closed): the manifest is
 *   written by one tool run, so a partial disagreement means it was edited or damaged.
 *
 * **Verification is lazy (when first drawn), for every set size.** Hashing all art at load would
 * put megabytes of image downloads and hashing into the startup budget (ARCHITECTURE §14:
 * dataset fetch to ready within 1 s), for surfaces that may never be shown, and one path for all
 * sizes is simpler to test than a size threshold. `load(uiMapId)` fetches the file once
 * (`no-store`), checks its SHA-256 against the manifest and its header against the recorded type
 * and size, and resolves to the verified bytes as a `Blob`, which the map draws through an object
 * URL, so the pixels drawn are exactly the bytes verified (the plain `url` is never drawn). The
 * result is memoised per UiMap; a file that could not be fetched is tried again at the next draw.
 */

/** A world rectangle in yards on one world map: x north (`xMin` south edge), y west (`yMin` east edge). */
export interface LocalArtBounds {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

/** One art image of the active local set, for the map adapter's art layer. */
export interface LocalArtEntry {
  readonly uiMapId: UiMapId;
  /** The world map (surface `world:<mapId>`) the image is drawn on. */
  readonly mapId: WorldMapId;
  /** The world rectangle the whole image covers: its UiMap's single full-rectangle row. */
  readonly bounds: LocalArtBounds;
  /** Where the file is (`<base>local-maps/art/<uiMapId>.<ext>`): what `load` fetches, never drawn as is. */
  readonly url: string;
  /** Pixel size, as recorded at activation and checked against the file's header at `load`. */
  readonly width: number;
  readonly height: number;
  readonly contentType: ImageContentType;
  readonly sha256: string;
}

export type LocalArtStatus =
  /** No compatible local set, or a set whose manifest lists no art. */
  | { readonly kind: 'none'; readonly detail: string }
  /** The manifest's art section is malformed or disagrees with the local geometry: no art is used. */
  | { readonly kind: 'refused'; readonly detail: string }
  /** `count` images are listed; each is verified when first drawn. */
  | { readonly kind: 'listed'; readonly count: number };

export type LocalArtLoad =
  | { readonly kind: 'verified'; readonly entry: LocalArtEntry; readonly blob: Blob }
  | {
      readonly kind: 'refused';
      readonly uiMapId: UiMapId;
      /**
       * - `not-listed`: the active set has no art for this UiMap;
       * - `unavailable`: the request failed or the server answered an error (tried again next time);
       * - `changed`: the file's SHA-256 differs from the manifest (edited after activation);
       * - `malformed`: the file matches its hash but is not the image the manifest describes.
       */
      readonly reason: 'not-listed' | 'unavailable' | 'changed' | 'malformed';
      readonly detail: string;
    };

export interface LocalArt {
  readonly status: LocalArtStatus;
  /** Every listed image, ascending by UiMapId; empty unless `status.kind` is `listed`. */
  readonly entries: readonly LocalArtEntry[];
  /** Fetches and verifies one UiMap's image (once; memoised). Never rejects. */
  load(id: UiMapId): Promise<LocalArtLoad>;
}

export interface LocalArtOptions {
  readonly fetch: FetchLike;
  readonly baseUrl: string;
  readonly sha256: Sha256Digest;
}

const LOCAL_DIR = 'local-maps/';
const HEX64 = /^[0-9a-f]{64}$/;
/** `art/<uiMapId>.png|webp`: the only art paths `tools/maps` writes (MAPS.md §5.2). */
const ART_FILE = /^art\/([1-9][0-9]*)\.(png|webp)$/;

type Json = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isPositiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

/** The art section's entries, or why it cannot be used. `local` is the verified `geometry.local.json`. */
export function parseArtSection(section: unknown, local: MapGeometry, baseUrl: string): readonly LocalArtEntry[] | string {
  if (!isRecord(section)) return 'art must be an object keyed by UiMapID';
  const entries: LocalArtEntry[] = [];
  for (const [key, value] of Object.entries(section)) {
    const where = `art["${key}"]`;
    if (!/^[1-9][0-9]*$/.test(key) || !Number.isSafeInteger(Number(key))) return `${where}: the key must be a UiMapID`;
    const id = uiMapId(Number(key));
    if (!isRecord(value)) return `${where}: must be an object`;
    const { file, contentType, width, height, sha256, bounds } = value;
    const match = typeof file === 'string' ? ART_FILE.exec(file) : null;
    if (typeof file !== 'string' || match?.[1] !== key) return `${where}.file must be art/${key}.png or art/${key}.webp`;
    const expectedType = contentTypeOfName(file);
    if (contentType !== expectedType || expectedType === null) return `${where}.contentType must be ${expectedType ?? 'image/png or image/webp'} for ${file}`;
    if (!isPositiveInteger(width) || !isPositiveInteger(height)) return `${where}: width and height must be positive integers`;
    if (typeof sha256 !== 'string' || !HEX64.test(sha256)) return `${where}.sha256 must be a SHA-256 hex digest`;
    if (!isRecord(bounds)) return `${where}.bounds must be an object`;
    const { assignment, mapId, xMin, xMax, yMin, yMax } = bounds;
    if (!Number.isSafeInteger(assignment) || !Number.isSafeInteger(mapId) || ![xMin, xMax, yMin, yMax].every(isFiniteNumber)) {
      return `${where}.bounds needs integer assignment and mapId and four finite edges`;
    }
    const map = local.maps.get(id);
    if (map === undefined) return `${where}: UiMap ${key} is not in the local geometry`;
    const [row, ...others] = map.assignments;
    if (row === undefined || others.length > 0 || row.orderIndex !== 0 || !isFullUiRectangle(row)) {
      return `${where}: UiMap ${key} is not a single full-rectangle row, so its art cannot be placed on one world surface`;
    }
    if (assignment !== row.id || mapId !== row.mapId || xMin !== row.xMin || xMax !== row.xMax || yMin !== row.yMin || yMax !== row.yMax) {
      return `${where}.bounds differ from UiMap ${key}'s row ${String(row.id)} in the local geometry`;
    }
    entries.push({
      uiMapId: id,
      mapId: row.mapId,
      bounds: { xMin: row.xMin, xMax: row.xMax, yMin: row.yMin, yMax: row.yMax },
      url: joinUrl(baseUrl, `${LOCAL_DIR}${file}`),
      width,
      height,
      contentType: expectedType,
      sha256,
    });
  }
  return entries.sort((a, b) => a.uiMapId - b.uiMapId);
}

const short = (hash: string): string => `${hash.slice(0, 12)}…`;

/** A `LocalArt` without images. */
export function noLocalArt(status: Extract<LocalArtStatus, { kind: 'none' | 'refused' }>): LocalArt {
  return {
    status,
    entries: [],
    load: (id) => Promise.resolve({ kind: 'refused', uiMapId: id, reason: 'not-listed', detail: `UiMap ${String(id)} has no local art (${status.detail})` }),
  };
}

/** The art of a compatible local set: the parsed section, or a refusal. `section` undefined means the manifest lists none. */
export function createLocalArt(section: unknown, local: MapGeometry, opts: LocalArtOptions): LocalArt {
  if (section === undefined) return noLocalArt({ kind: 'none', detail: 'the local set lists no art' });
  const parsed = parseArtSection(section, local, opts.baseUrl);
  if (typeof parsed === 'string') return noLocalArt({ kind: 'refused', detail: `maps.manifest.json ${parsed}` });
  if (parsed.length === 0) return noLocalArt({ kind: 'none', detail: 'the local set lists no art' });
  const byId = new Map(parsed.map((entry) => [entry.uiMapId, entry]));
  const cache = new Map<UiMapId, Promise<LocalArtLoad>>();

  const verify = async (entry: LocalArtEntry): Promise<LocalArtLoad> => {
    const refused = (reason: 'unavailable' | 'changed' | 'malformed', detail: string): LocalArtLoad => ({ kind: 'refused', uiMapId: entry.uiMapId, reason, detail });
    let bytes: ArrayBuffer;
    try {
      const response = await opts.fetch(entry.url, { cache: 'no-store' });
      if (!response.ok) return refused('unavailable', `${entry.url}: HTTP ${String(response.status)}`);
      bytes = await response.arrayBuffer();
    } catch (error) {
      return refused('unavailable', `${entry.url}: ${error instanceof Error ? error.message : String(error)}`);
    }
    let hash: string;
    try {
      hash = await sha256Hex(opts.sha256, bytes);
    } catch (error) {
      return refused('unavailable', `${entry.url} could not be hashed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (hash !== entry.sha256) {
      return refused('changed', `${entry.url} changed after the set was activated (SHA-256 ${short(hash)}, the manifest records ${short(entry.sha256)}); run tools/maps validate --activate again`);
    }
    // The header reader loads with the first image verified: local art only (dev and preview), so not in the entry chunk.
    let reader: typeof ImageHeaderModule;
    try {
      reader = await import('./image-header');
    } catch (error) {
      return refused('unavailable', `${entry.url}: its reader could not be loaded (${error instanceof Error ? error.message : String(error)})`);
    }
    const header = reader.readImageHeader(new Uint8Array(bytes));
    if (!header.ok) return refused('malformed', `${entry.url}: ${header.error}`);
    const { contentType, width, height } = header.header;
    if (contentType !== entry.contentType || width !== entry.width || height !== entry.height) {
      return refused('malformed', `${entry.url} is a ${String(width)} × ${String(height)} ${contentType}, the manifest records ${String(entry.width)} × ${String(entry.height)} ${entry.contentType}`);
    }
    return { kind: 'verified', entry, blob: new Blob([bytes], { type: entry.contentType }) };
  };

  return {
    status: { kind: 'listed', count: parsed.length },
    entries: parsed,
    load(id) {
      const cached = cache.get(id);
      if (cached !== undefined) return cached;
      const entry = byId.get(id);
      if (entry === undefined) return Promise.resolve({ kind: 'refused', uiMapId: id, reason: 'not-listed', detail: `UiMap ${String(id)} has no local art` });
      const pending = verify(entry).then((result) => {
        // A failed request may succeed later (the file is being written, the server restarted).
        if (result.kind === 'refused' && result.reason === 'unavailable') cache.delete(id);
        return result;
      });
      cache.set(id, pending);
      return pending;
    },
  };
}
