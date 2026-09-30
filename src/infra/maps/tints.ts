import { sha256Hex } from '../hash';
import { decodeUtf8, joinUrl } from '../http';
import type { MapResourceFailure, MapResourcesOptions } from './map-resources';

/**
 * The committed fallback zone tints (`public/maps/tint/`; docs/research/map-presentation.md §12.4;
 * step MP.10), written by `tools/maps/tints.ts` from the committed painted art and terrain outlines.
 * Loaded lazily and never fatally, as the client tables are (`client-tables.ts`): the manifest is
 * fetched revalidated and read by a hand-written guard; `tints.json`'s bytes must hash to the
 * manifest's SHA-256 (fetched once more past the HTTP cache before it fails). A failure resolves to
 * a `failed` result that says why; the map then draws no tint.
 */

export const TINTS_MANIFEST_PATH = 'maps/tint/manifest.json';
const TINTS_FILE = 'maps/tint/tints.json';

/** Each zone's tint, `#rrggbb`, by `<mapId>:<areaId>` (the terrain's AreaTable id on its world map). */
export interface ZoneTints {
  readonly byArea: ReadonlyMap<string, string>;
}

export type ZoneTintsLoad = { readonly kind: 'loaded'; readonly tints: ZoneTints } | MapResourceFailure;

type Json = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const HEX64 = /^[0-9a-f]{64}$/;
const COLOUR = /^#[0-9a-f]{6}$/;
const isMapId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isAreaId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

function parseJson(bytes: ArrayBuffer): unknown {
  try {
    return JSON.parse(decodeUtf8(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

/** The manifest's SHA-256 of `tints.json`, or why the manifest cannot be used. */
export function parseTintsManifest(json: unknown): string | { readonly sha256: string } {
  if (!isRecord(json) || json['schema'] !== 1 || json['kind'] !== 'zone-tints-manifest') return 'not a schema 1 zone-tints manifest';
  const files = json['files'];
  if (!Array.isArray(files)) return 'files must be an array';
  const entry = (files as readonly unknown[]).find((file) => isRecord(file) && file['path'] === 'tints.json');
  if (!isRecord(entry) || typeof entry['sha256'] !== 'string' || !HEX64.test(entry['sha256'])) return 'files must list tints.json with its SHA-256';
  return { sha256: entry['sha256'] };
}

/** The tints of a `tints.json` (already hash-checked), or why they cannot be used. */
export function parseZoneTints(json: unknown): ZoneTints | string {
  if (!isRecord(json) || json['schema'] !== 1 || json['kind'] !== 'zone-tints') return 'not a schema 1 zone-tints file';
  const tints = json['tints'];
  if (!Array.isArray(tints)) return 'tints must be an array';
  const byArea = new Map<string, string>();
  for (const [index, entry] of (tints as readonly unknown[]).entries()) {
    if (!isRecord(entry) || !isMapId(entry['mapId']) || !isAreaId(entry['areaId']) || typeof entry['tint'] !== 'string' || !COLOUR.test(entry['tint'])) {
      return `tints[${String(index)}] must have a world map, an area and a #rrggbb tint`;
    }
    byArea.set(`${String(entry['mapId'])}:${String(entry['areaId'])}`, entry['tint']);
  }
  return { byArea };
}

/** The tints' loader: one attempt at a time; a result that may succeed later (`unavailable`) is forgotten. */
export function createZoneTints(opts: MapResourcesOptions): () => Promise<ZoneTintsLoad> {
  const unavailable = (detail: string): MapResourceFailure => ({ kind: 'failed', reason: 'unavailable', detail });
  const invalid = (detail: string): MapResourceFailure => ({ kind: 'failed', reason: 'invalid', detail });
  async function get(path: string, cache: RequestCache): Promise<{ readonly kind: 'ok'; readonly bytes: ArrayBuffer } | MapResourceFailure> {
    try {
      const response = await opts.fetch(joinUrl(opts.baseUrl, path), { cache });
      if (!response.ok) return unavailable(`${path}: HTTP ${String(response.status)}`);
      return { kind: 'ok', bytes: await response.arrayBuffer() };
    } catch (error) {
      return unavailable(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async function load(): Promise<ZoneTintsLoad> {
    const index = await get(TINTS_MANIFEST_PATH, 'no-cache');
    if (index.kind === 'failed') return index;
    const manifest = parseTintsManifest(parseJson(index.bytes));
    if (typeof manifest === 'string') return invalid(`${TINTS_MANIFEST_PATH}: ${manifest}`);
    const digest = opts.sha256;
    if (digest === null) return invalid('this page cannot verify the zone tints: WebCrypto needs a secure page (https, or http on localhost)');
    let fetched = await get(TINTS_FILE, 'default');
    if (fetched.kind === 'ok' && (await sha256Hex(digest, fetched.bytes)) !== manifest.sha256) fetched = await get(TINTS_FILE, 'reload');
    if (fetched.kind === 'failed') return fetched;
    if ((await sha256Hex(digest, fetched.bytes)) !== manifest.sha256) return invalid(`${TINTS_FILE} failed its integrity check`);
    const tints = parseZoneTints(parseJson(fetched.bytes));
    return typeof tints === 'string' ? invalid(`${TINTS_FILE}: ${tints}`) : { kind: 'loaded', tints };
  }
  let pending: Promise<ZoneTintsLoad> | null = null;
  return () => {
    pending ??= load().then((result) => {
      if (result.kind === 'failed' && result.reason === 'unavailable') pending = null;
      return result;
    });
    return pending;
  };
}
