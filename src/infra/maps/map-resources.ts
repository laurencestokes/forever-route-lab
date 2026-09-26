import type { WorldMapId } from '../../domain/ids';
import { sha256Hex, type Sha256Digest } from '../hash';
import { decodeUtf8, type FetchLike, joinUrl } from '../http';
import { ART_MANIFEST_PATH, parseArtManifest, type ArtManifest } from './art-manifest';
import { parseTerrainArcs, parseTerrainManifest, TERRAIN_MANIFEST_PATH, type TerrainArcKind, type TerrainArcs, type TerrainManifest } from './terrain';

/**
 * The committed map resources at runtime (D-032, D-033; terrain-navigation.md §13): the painted
 * art's manifest, the terrain manifest and the terrain arc files. Loaded lazily, when the map
 * first asks for them, never during startup, and never fatally: every call resolves (it never
 * rejects) to the content or to a `failed` result that says why, and the map then draws what it
 * has (the relief without the art, the zone frames without either) and shows the reason.
 *
 * - The two manifests are fetched revalidated (`no-cache`), like the data manifest, and parsed by
 *   hand-written guards (`art-manifest.ts`, `terrain.ts`).
 * - An arc file is fetched, its bytes hashed with WebCrypto and compared with the terrain
 *   manifest's SHA-256 before it is parsed. A mismatch is fetched once more past the HTTP cache
 *   (a copy cached from an earlier deploy), as data files are, before it fails.
 * - Results are memoised per file. A failed request (offline, a server error) is forgotten, so
 *   the next call tries again; a malformed or mismatching file is not.
 * - Images (the art and the relief) are not fetched here: the adapter draws them from their URLs.
 */

export interface MapResourcesOptions {
  readonly fetch: FetchLike;
  readonly baseUrl: string;
  /** WebCrypto's digest; null where it is missing (an insecure page): arc files then cannot be verified and are refused. */
  readonly sha256: Sha256Digest | null;
}

/** Why a resource is not available: it could not be fetched (tried again next time), or it is not what the app reads. */
export type MapResourceFailure = { readonly kind: 'failed'; readonly reason: 'unavailable' | 'invalid'; readonly detail: string };

export type ArtManifestLoad = { readonly kind: 'loaded'; readonly manifest: ArtManifest } | MapResourceFailure;
export type TerrainManifestLoad = { readonly kind: 'loaded'; readonly manifest: TerrainManifest } | MapResourceFailure;
export type TerrainArcsLoad = { readonly kind: 'loaded'; readonly arcs: TerrainArcs } | MapResourceFailure;

export interface MapResources {
  /** The committed art manifest (once; memoised). */
  art(): Promise<ArtManifestLoad>;
  /** The terrain manifest (once; memoised). */
  terrain(): Promise<TerrainManifestLoad>;
  /** One world map's zone-outline or coastline arcs, verified and decoded (once per file; memoised). */
  arcs(mapId: WorldMapId, kind: TerrainArcKind): Promise<TerrainArcsLoad>;
}

const short = (hash: string): string => `${hash.slice(0, 12)}…`;

type Fetched = { readonly kind: 'ok'; readonly bytes: ArrayBuffer } | MapResourceFailure;

function parseJson(bytes: ArrayBuffer): unknown {
  try {
    return JSON.parse(decodeUtf8(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

export function createMapResources(opts: MapResourcesOptions): MapResources {
  const unavailable = (detail: string): MapResourceFailure => ({ kind: 'failed', reason: 'unavailable', detail });
  const invalid = (detail: string): MapResourceFailure => ({ kind: 'failed', reason: 'invalid', detail });

  async function get(path: string, cache: RequestCache): Promise<Fetched> {
    try {
      const response = await opts.fetch(joinUrl(opts.baseUrl, path), { cache });
      if (!response.ok) return unavailable(`${path}: HTTP ${String(response.status)}`);
      return { kind: 'ok', bytes: await response.arrayBuffer() };
    } catch (error) {
      return unavailable(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Memoises one promise per key, forgetting a result that may succeed later (`unavailable`). */
  function memo<T extends { readonly kind: string }>(): (key: string, load: () => Promise<T>) => Promise<T> {
    const cache = new Map<string, Promise<T>>();
    return (key, load) => {
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const pending = load().then((result) => {
        if ('reason' in result && result.reason === 'unavailable') cache.delete(key);
        return result;
      });
      cache.set(key, pending);
      return pending;
    };
  }

  async function manifest<M>(path: string, parse: (json: unknown, baseUrl: string) => M | string): Promise<{ readonly kind: 'loaded'; readonly manifest: M } | MapResourceFailure> {
    const fetched = await get(path, 'no-cache');
    if (fetched.kind === 'failed') return fetched;
    const json = parseJson(fetched.bytes);
    // A deployed site without the file may answer with its fallback page.
    if (json === undefined) return invalid(`${path} is not JSON`);
    const parsed = parse(json, opts.baseUrl);
    return typeof parsed === 'string' ? invalid(`${path}: ${parsed}`) : { kind: 'loaded', manifest: parsed };
  }

  const artMemo = memo<ArtManifestLoad>();
  const terrainMemo = memo<TerrainManifestLoad>();
  const arcsMemo = memo<TerrainArcsLoad>();

  const terrain = (): Promise<TerrainManifestLoad> => terrainMemo(TERRAIN_MANIFEST_PATH, () => manifest(TERRAIN_MANIFEST_PATH, parseTerrainManifest));

  async function loadArcs(mapId: WorldMapId, kind: TerrainArcKind): Promise<TerrainArcsLoad> {
    const index = await terrain();
    if (index.kind === 'failed') return index;
    const file = index.manifest.maps.find((map) => map.mapId === mapId)?.[kind] ?? null;
    if (file === null) return invalid(`no ${kind === 'zones' ? 'zone outlines' : 'coastline'} for world map ${String(mapId)}`);
    const sha256 = opts.sha256;
    if (sha256 === null) return invalid('this page cannot verify terrain files: WebCrypto needs a secure page (https, or http on localhost)');
    const path = file.path;
    const attempt = async (cache: RequestCache): Promise<{ readonly bytes: ArrayBuffer; readonly problem: string | null } | MapResourceFailure> => {
      const fetched = await get(path, cache);
      if (fetched.kind === 'failed') return fetched;
      const hash = await sha256Hex(sha256, fetched.bytes);
      return { bytes: fetched.bytes, problem: hash === file.sha256 ? null : `its SHA-256 is ${short(hash)}, the manifest records ${short(file.sha256)}` };
    };
    let result = await attempt('default');
    if ('problem' in result && result.problem !== null) result = await attempt('reload');
    if (!('problem' in result)) return result;
    if (result.problem !== null) return invalid(`${path} failed its integrity check: ${result.problem}`);
    const json = parseJson(result.bytes);
    if (json === undefined) return invalid(`${path} is not UTF-8 JSON`);
    const arcs = parseTerrainArcs(json, file);
    return typeof arcs === 'string' ? invalid(`${path}: ${arcs}`) : { kind: 'loaded', arcs };
  }

  return {
    art: () => artMemo(ART_MANIFEST_PATH, () => manifest(ART_MANIFEST_PATH, parseArtManifest)),
    terrain,
    arcs: (mapId, kind) => arcsMemo(`${String(mapId)}/${kind}`, () => loadArcs(mapId, kind)),
  };
}
