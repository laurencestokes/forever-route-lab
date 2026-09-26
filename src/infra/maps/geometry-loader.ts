import type { UiMapId } from '../../domain/ids';
import { canonicalFrameTuples, canonicalGeometryContent, frameSetOf, type MapGeometry, mergeLocalGeometry, parseGeometryFile } from '../../geo';
import { sha256Hex, type Sha256Digest } from '../hash';
import { decodeUtf8, type FetchLike, isAbortError, joinUrl } from '../http';
import { createLocalArt, type LocalArt, noLocalArt } from './local-art';

/**
 * Map geometry at runtime (ARCHITECTURE §6, §7.3; docs/MAPS.md §5.3, §5.6 "Runtime behaviour"):
 *
 * 1. `maps/placeholder/geometry.placeholder.json` is always required, and fetched revalidated
 *    (`no-cache`, like the data manifest: the file changes at every QuestieDB pin bump). It is
 *    parsed by `src/geo` (fails closed), and two hashes are recomputed with WebCrypto and must
 *    equal the ones the file records:
 *    - the frame hash (`canonicalFrameTuples`), which covers only the 49 QuestieDB zone frames the
 *      dataset's percentages are in;
 *    - the content hash (`canonicalGeometryContent`), which covers everything resolution reads:
 *      every row (the 12 `db2-csv` rows included) with its AreaID, OrderIndex, bounds, UI
 *      rectangle, source and build, every UiMap's name and parent, and the Era → Forever
 *      coefficients.
 *    A file damaged in transit, or edited by hand without recomputing both, is refused. A hand
 *    edit that also rewrote both hashes passes here; `tools/maps validate` (P8) catches that by
 *    comparing with a fresh import.
 * 2. `local-maps/maps.manifest.json` is probed. A 404 (every deployed site), a non-JSON body (an
 *    SPA fallback page served with status 200), a failed request or a manifest of the wrong shape
 *    all mean "no local set", never an error.
 * 3. Otherwise `local-maps/<geometry.file>` is fetched and its SHA-256 checked against the
 *    manifest (a file changed after activation makes the set count as absent), parsed, its content
 *    hash checked when it records one, and merged with `mergeLocalGeometry`, which compares frames
 *    from the rows themselves; the manifest's own `frameHash` is never trusted. A mismatch keeps
 *    the placeholder and reports the UiMaps.
 * 4. For a compatible set, the manifest's `art` section is parsed and checked against the local
 *    geometry (`local-art.ts`); each image's SHA-256 is verified lazily, when it is first drawn.
 */

export const PLACEHOLDER_GEOMETRY_PATH = 'maps/placeholder/geometry.placeholder.json';
export const LOCAL_MANIFEST_PATH = 'local-maps/maps.manifest.json';
const LOCAL_DIR = 'local-maps/';

export type LocalMapSetStatus =
  | {
      readonly kind: 'none';
      readonly reason: 'not-found' | 'unreachable' | 'not-json' | 'invalid-manifest' | 'geometry-unavailable' | 'geometry-changed' | 'invalid-geometry';
      readonly detail: string;
    }
  | {
      readonly kind: 'compatible';
      readonly set: string;
      readonly build: string;
      /** The local set's frame hash over the placeholder's frame set; null when it lacks a frame. */
      readonly frameHash: string | null;
      readonly added: readonly UiMapId[];
    }
  | {
      readonly kind: 'incompatible';
      readonly set: string;
      readonly build: string;
      readonly frameHash: string | null;
      readonly frameUiMapIds: readonly UiMapId[];
      readonly sharedRowUiMapIds: readonly UiMapId[];
    };

export interface LoadedGeometry {
  /** What resolution uses: the placeholder, or the placeholder merged with a compatible local set. */
  readonly geometry: MapGeometry;
  readonly placeholder: MapGeometry;
  /** The placeholder's frame hash, recomputed from its rows (equal to the one it records). */
  readonly frameHash: string;
  /** The placeholder's content hash, recomputed from everything it holds (equal to the one it records). */
  readonly contentHash: string;
  /**
   * The QuestieDB commit, build and `conversion.json` SHA-256 the placeholder's zone frames were
   * taken from (its `inputs.questiedb-conversion`), for the check that the data and the geometry
   * share one pin and one conversion file (M2 review COORD-10).
   */
  readonly frameSource: { readonly commit: string | null; readonly build: string | null; readonly sha256: string | null };
  readonly local: LocalMapSetStatus;
  /**
   * The compatible local set's art (MAPS.md §5.3, §5.6 step 7): entries for the map adapter's art
   * layer, each verified on its first `load`. No entries without a compatible set.
   */
  readonly art: LocalArt;
}

export type GeometryLoadErrorCode =
  /** The browser cannot verify the geometry (no WebCrypto: not a secure context). */
  | 'unsupported'
  /** The request, or reading its body, failed (offline, a dropped connection). */
  | 'network'
  /** The server answered with an error status. */
  | 'http'
  /** Not UTF-8 JSON, not a placeholder, or not the shape this app reads. */
  | 'format'
  /** The frame or content hash differs from the one the file records. */
  | 'integrity';

export class GeometryLoadError extends Error {
  override readonly name = 'GeometryLoadError';

  constructor(
    readonly code: GeometryLoadErrorCode,
    message: string,
    readonly details: readonly string[] = [],
  ) {
    super(message);
  }
}

export interface GeometryLoaderOptions {
  readonly fetch: FetchLike;
  readonly baseUrl: string;
  readonly sha256: Sha256Digest | null;
  /** Aborts the load (also when already aborted on entry); the load then rejects with its reason. */
  readonly signal?: AbortSignal | undefined;
  /**
   * How the placeholder is fetched: `no-cache` (revalidated) by default. `reload` bypasses the
   * HTTP cache, for the one retry when a copy cached from an earlier deploy does not pair with the
   * data (src/app/workspace.ts; M2 review COORD-1).
   */
  readonly cache?: RequestCache | undefined;
}

type Json = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const HEX64 = /^[0-9a-f]{64}$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const short = (hash: string | null): string => (hash === null ? 'nothing' : `${hash.slice(0, 12)}…`);

/** The frame hash of `geometry` over `frameSet` (MAPS.md §5.6), or null when it lacks a frame. */
export async function frameHashOf(sha256: Sha256Digest, geometry: MapGeometry, frameSet: readonly UiMapId[] = frameSetOf(geometry)): Promise<string | null> {
  const tuples = canonicalFrameTuples(geometry, frameSet);
  return tuples.ok ? sha256Hex(sha256, tuples.canonical) : null;
}

/** The content hash of `geometry` (MAPS.md §5.3): the SHA-256 of `canonicalGeometryContent`. */
export function contentHashOf(sha256: Sha256Digest, geometry: MapGeometry): Promise<string> {
  return sha256Hex(sha256, canonicalGeometryContent(geometry));
}

function frameSourceOf(json: unknown): LoadedGeometry['frameSource'] {
  const inputs = isRecord(json) && isRecord(json['inputs']) ? json['inputs'] : {};
  const conversion = isRecord(inputs['questiedb-conversion']) ? inputs['questiedb-conversion'] : {};
  const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
  return { commit: text(conversion['commit']), build: text(conversion['build']), sha256: text(conversion['sha256']) };
}

type Probe = { readonly kind: 'ok'; readonly bytes: ArrayBuffer } | { readonly kind: 'missing'; readonly reason: 'not-found' | 'unreachable'; readonly detail: string };

async function probe(opts: GeometryLoaderOptions, path: string): Promise<Probe> {
  try {
    const response = await opts.fetch(joinUrl(opts.baseUrl, path), { cache: 'no-store', ...(opts.signal === undefined ? {} : { signal: opts.signal }) });
    if (!response.ok) return { kind: 'missing', reason: 'not-found', detail: `${path}: HTTP ${String(response.status)}` };
    return { kind: 'ok', bytes: await response.arrayBuffer() };
  } catch (error) {
    if (isAbortError(error) || opts.signal?.aborted === true) throw error;
    return { kind: 'missing', reason: 'unreachable', detail: `${path}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function parseJson(bytes: ArrayBuffer): unknown {
  try {
    return JSON.parse(decodeUtf8(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

interface Placeholder {
  readonly geometry: MapGeometry;
  readonly frameHash: string;
  readonly contentHash: string;
  readonly frameSource: LoadedGeometry['frameSource'];
}

async function loadPlaceholder(opts: GeometryLoaderOptions, sha256: Sha256Digest): Promise<Placeholder> {
  const path = PLACEHOLDER_GEOMETRY_PATH;
  // An aborted load rejects with the abort, whatever the browser rejected the request with.
  const network = (error: unknown, what: string): unknown =>
    isAbortError(error) || opts.signal?.aborted === true ? error : new GeometryLoadError('network', `${path} could not be ${what} (${error instanceof Error ? error.message : String(error)}).`);
  let response;
  try {
    response = await opts.fetch(joinUrl(opts.baseUrl, path), { cache: opts.cache ?? 'no-cache', ...(opts.signal === undefined ? {} : { signal: opts.signal }) });
  } catch (error) {
    throw network(error, 'fetched');
  }
  if (!response.ok) throw new GeometryLoadError('http', `${path} could not be loaded: the server answered HTTP ${String(response.status)}.`);
  // The body arrives after the headers: a connection dropped mid-download fails here.
  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch (error) {
    throw network(error, 'read to the end');
  }
  const json = parseJson(bytes);
  if (json === undefined) throw new GeometryLoadError('format', `${path} is not valid UTF-8 JSON.`);
  const parsed = parseGeometryFile(json);
  if (!parsed.ok) throw new GeometryLoadError('format', `${path} does not have the shape this version of the app reads.`, parsed.errors.slice(0, 8));
  const geometry = parsed.geometry;
  if (geometry.kind !== 'placeholder') throw new GeometryLoadError('format', `${path} is not a placeholder geometry.`);
  const frameHash = await frameHashOf(sha256, geometry);
  if (frameHash === null || frameHash !== geometry.recordedFrameHash) {
    throw new GeometryLoadError(
      'integrity',
      `${path} failed its frame check: its rows hash to ${frameHash === null ? 'nothing (a frame is missing)' : short(frameHash)}, the file records ${short(geometry.recordedFrameHash)}. Regenerate it with pnpm maps:placeholder.`,
    );
  }
  const contentHash = await contentHashOf(sha256, geometry);
  if (contentHash !== geometry.recordedContentHash) {
    throw new GeometryLoadError(
      'integrity',
      `${path} failed its content check: its rows, names and coefficients hash to ${short(contentHash)}, the file records ${short(geometry.recordedContentHash)}. It was edited or damaged; regenerate it with pnpm maps:placeholder.`,
    );
  }
  return { geometry, frameHash, contentHash, frameSource: frameSourceOf(json) };
}

interface LocalManifest {
  readonly set: string;
  readonly build: string;
  readonly geometryFile: string;
  readonly geometrySha256: string;
  /** The `art` section as written (checked by `local-art.ts`); undefined when the manifest has none. */
  readonly art: unknown;
}

function readLocalManifest(json: unknown): LocalManifest | string {
  if (!isRecord(json)) return 'not an object';
  if (json['schema'] !== 1) return 'schema is not 1';
  if (json['redistribution'] !== 'local-only') return 'not marked local-only';
  const set = json['set'];
  const build = json['build'];
  const geometry = isRecord(json['geometry']) ? json['geometry'] : null;
  const file = geometry?.['file'];
  const hash = geometry?.['sha256'];
  if (typeof set !== 'string' || typeof build !== 'string') return 'set or build missing';
  if (typeof file !== 'string' || !FILE_NAME.test(file)) return 'geometry.file must be a file name inside local-maps/';
  if (typeof hash !== 'string' || !HEX64.test(hash)) return 'geometry.sha256 must be a SHA-256 hex digest';
  return { set, build, geometryFile: file, geometrySha256: hash, art: json['art'] };
}

interface LocalResult {
  readonly status: LocalMapSetStatus;
  readonly geometry: MapGeometry;
  readonly art: LocalArt;
}

const NO_SET_ART = noLocalArt({ kind: 'none', detail: 'no compatible local set' });

async function loadLocal(opts: GeometryLoaderOptions, sha256: Sha256Digest, placeholder: MapGeometry): Promise<LocalResult> {
  const none = (reason: Extract<LocalMapSetStatus, { kind: 'none' }>['reason'], detail: string): LocalResult => ({
    status: { kind: 'none', reason, detail },
    geometry: placeholder,
    art: NO_SET_ART,
  });
  const found = await probe(opts, LOCAL_MANIFEST_PATH);
  if (found.kind === 'missing') return none(found.reason, found.detail);
  const json = parseJson(found.bytes);
  if (json === undefined) return none('not-json', `${LOCAL_MANIFEST_PATH} is not JSON (a deployed site serves its fallback page there)`);
  const manifest = readLocalManifest(json);
  if (typeof manifest === 'string') return none('invalid-manifest', `${LOCAL_MANIFEST_PATH}: ${manifest}`);

  const path = `${LOCAL_DIR}${manifest.geometryFile}`;
  const geometryFile = await probe(opts, path);
  if (geometryFile.kind === 'missing') return none('geometry-unavailable', geometryFile.detail);
  const hash = await sha256Hex(sha256, geometryFile.bytes);
  if (hash !== manifest.geometrySha256) {
    return none('geometry-changed', `${path} changed after the set was activated (SHA-256 ${short(hash)}); run tools/maps validate --activate again`);
  }
  const parsed = parseGeometryFile(parseJson(geometryFile.bytes));
  if (!parsed.ok) return none('invalid-geometry', `${path}: ${parsed.errors.slice(0, 3).join('; ')}`);
  // A local set's content hash is optional; one it records must hold, like the placeholder's.
  const recordedContent = parsed.geometry.recordedContentHash;
  if (recordedContent !== null) {
    const content = await contentHashOf(sha256, parsed.geometry);
    if (content !== recordedContent) return none('invalid-geometry', `${path}: its content hashes to ${short(content)}, the file records ${short(recordedContent)}`);
  }

  const localHash = await frameHashOf(sha256, parsed.geometry, frameSetOf(placeholder));
  const merged = mergeLocalGeometry(placeholder, parsed.geometry);
  if (merged.kind === 'mismatch') {
    return {
      status: {
        kind: 'incompatible',
        set: manifest.set,
        build: manifest.build,
        frameHash: localHash,
        frameUiMapIds: merged.frameUiMapIds,
        sharedRowUiMapIds: merged.sharedRowUiMapIds,
      },
      geometry: placeholder,
      art: NO_SET_ART,
    };
  }
  return {
    status: { kind: 'compatible', set: manifest.set, build: manifest.build, frameHash: localHash, added: merged.added },
    geometry: merged.geometry,
    // Art is read only now: its bounds are checked against the verified, frame-compatible rows.
    art: createLocalArt(manifest.art, parsed.geometry, { fetch: opts.fetch, baseUrl: opts.baseUrl, sha256 }),
  };
}

/**
 * A copy that fails its format or integrity check may have been damaged in transit or cached from
 * an earlier deploy, so it is fetched once more past the HTTP cache before the failure is final,
 * as data files are. A caller that already asked for `reload` gets no second attempt.
 */
async function loadPlaceholderWithRetry(opts: GeometryLoaderOptions, sha256: Sha256Digest): Promise<Placeholder> {
  try {
    return await loadPlaceholder(opts, sha256);
  } catch (error) {
    const retryable = error instanceof GeometryLoadError && (error.code === 'format' || error.code === 'integrity');
    if (!retryable || opts.cache === 'reload' || opts.signal?.aborted === true) throw error;
    return loadPlaceholder({ ...opts, cache: 'reload' }, sha256);
  }
}

/** Loads the placeholder geometry and, when present and compatible, a local set on top. */
export async function loadGeometry(opts: GeometryLoaderOptions): Promise<LoadedGeometry> {
  opts.signal?.throwIfAborted();
  const sha256 = opts.sha256;
  if (sha256 === null) {
    throw new GeometryLoadError('unsupported', 'This browser cannot verify the map geometry: WebCrypto is only available on secure pages (https, or http on localhost). Open the site over https.');
  }
  const placeholder = await loadPlaceholderWithRetry(opts, sha256);
  const local = await loadLocal(opts, sha256, placeholder.geometry);
  return {
    geometry: local.geometry,
    placeholder: placeholder.geometry,
    frameHash: placeholder.frameHash,
    contentHash: placeholder.contentHash,
    frameSource: placeholder.frameSource,
    local: local.status,
    art: local.art,
  };
}

/** How the map panel words a local set that is not used (MAPS.md §5.6 steps 5-6; M2 review code-F14). */
function localNoneText(local: Extract<LocalMapSetStatus, { kind: 'none' }>): string {
  switch (local.reason) {
    case 'not-found':
      return 'local set: none';
    case 'unreachable':
    case 'not-json':
      // Nothing that could be a local set answered (an offline probe, a site's fallback page).
      return `local set: none (${local.detail})`;
    case 'invalid-manifest':
    case 'geometry-unavailable':
    case 'geometry-changed':
    case 'invalid-geometry':
      return `local set: refused (${local.detail})`;
  }
}

/** The art part of a compatible set's line: nothing when it lists none. */
function localArtText(art: LocalArt): string {
  switch (art.status.kind) {
    case 'none':
      return '';
    case 'listed':
      return `, art for ${String(art.status.count)} UiMaps (verified when drawn)`;
    case 'refused':
      return `; local art refused (${art.status.detail})`;
  }
}

/** One line for the UI: which geometry is in use, and why a local set is not (MAPS.md §5.6 step 6). */
export function describeGeometry(loaded: LoadedGeometry): string {
  const rows = [...loaded.placeholder.maps.values()].flatMap((m) => m.assignments);
  const bySource = (source: string) => rows.filter((r) => r.source === source);
  const frames = bySource('questiedb-conversion');
  const db2 = bySource('db2-csv');
  const build = (list: typeof rows) => (list[0]?.build ?? 'unknown build');
  const placeholder = `placeholder: ${String(frames.length)} frames @ ${build(frames)}, ${String(db2.length)} rows @ ${build(db2)}`;
  switch (loaded.local.kind) {
    case 'none':
      return `${placeholder}; ${localNoneText(loaded.local)}`;
    case 'compatible':
      return `${placeholder}; local set ${loaded.local.build}: compatible, ${String(loaded.local.added.length)} UiMaps added${localArtText(loaded.art)}`;
    case 'incompatible':
      return `${placeholder}; local set ${loaded.local.build}: incompatible, using the placeholder`;
  }
}
