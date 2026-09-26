import { NavManifestError, parseNavManifest, type NavManifest } from '../../nav/manifest';
import { sha256Hex, type Sha256Digest } from '../hash';
import { decodeUtf8, type FetchLike, isAbortError, joinUrl } from '../http';

/**
 * Locates and loads `nav/manifest.json` (terrain-navigation.md §5 "Manifest", §9.6): fetched
 * relative to the app's base URL and revalidated (`no-cache`, since it changes with every
 * navigation build), decoded as strict UTF-8 JSON, parsed by `src/nav`'s `parseNavManifest`, and
 * checked against itself: its `navRevision` must equal the SHA-256 over the sorted
 * `path sha256` lines of every block and `map.bin` it lists (the build's definition,
 * `tools/terrain/lib/manifest.ts`). A copy that fails the parse or that check is fetched once more
 * past the HTTP cache, as the geometry is.
 *
 * Navigation is optional: a missing, unreachable, malformed or inconsistent manifest means
 * "navigation unavailable", returned as a typed state, and the app keeps the straight-line model
 * (§9.3). Only an abort rejects. The worker fetches and verifies the blocks themselves.
 */

export const NAV_MANIFEST_PATH = 'nav/manifest.json';

export type NavUnavailableReason =
  /** No WebCrypto (not a secure context): nothing can be verified. */
  | 'unsupported'
  /** The server answered with an error status (a deploy without navigation data answers 404). */
  | 'not-found'
  /** The request failed (offline). */
  | 'unreachable'
  /** Not UTF-8 JSON (a site's fallback page served with status 200). */
  | 'not-json'
  /** JSON, but not a navigation manifest this app reads. */
  | 'invalid'
  /** Its navRevision does not match the files it lists. */
  | 'integrity';

export type NavManifestState =
  | {
      readonly kind: 'available';
      readonly manifest: NavManifest;
      /** The manifest JSON as fetched, for the worker's `init` message. */
      readonly json: unknown;
    }
  | { readonly kind: 'unavailable'; readonly reason: NavUnavailableReason; readonly detail: string };

export interface NavManifestLoaderOptions {
  readonly fetch: FetchLike;
  readonly baseUrl: string;
  readonly sha256: Sha256Digest | null;
  /** Aborts the load; the load then rejects with the abort. */
  readonly signal?: AbortSignal | undefined;
  /** `no-cache` by default; `reload` bypasses the HTTP cache (the retry uses it). */
  readonly cache?: RequestCache | undefined;
}

/** The text navRevision hashes: one `path sha256` line per block and `map.bin`, sorted. */
export function navRevisionInput(manifest: NavManifest): string {
  const lines = manifest.maps.flatMap((m) => [...m.blocks, m.mapFile].map((f) => `${f.path} ${f.sha256}\n`));
  return lines.sort().join('');
}

const unavailable = (reason: NavUnavailableReason, detail: string): NavManifestState => ({ kind: 'unavailable', reason, detail });

async function loadOnce(opts: NavManifestLoaderOptions, sha256: Sha256Digest): Promise<NavManifestState> {
  const path = NAV_MANIFEST_PATH;
  const rethrowAbort = (error: unknown): void => {
    if (isAbortError(error) || opts.signal?.aborted === true) throw error;
  };
  let bytes: ArrayBuffer;
  try {
    const response = await opts.fetch(joinUrl(opts.baseUrl, path), { cache: opts.cache ?? 'no-cache', ...(opts.signal === undefined ? {} : { signal: opts.signal }) });
    if (!response.ok) return unavailable('not-found', `${path}: HTTP ${String(response.status)}`);
    bytes = await response.arrayBuffer();
  } catch (error) {
    rethrowAbort(error);
    return unavailable('unreachable', `${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(decodeUtf8(bytes)) as unknown;
  } catch {
    return unavailable('not-json', `${path} is not UTF-8 JSON`);
  }
  let manifest: NavManifest;
  try {
    manifest = parseNavManifest(json);
  } catch (error) {
    if (error instanceof NavManifestError) return unavailable('invalid', `${path}: ${error.message}`);
    throw error;
  }
  const revision = await sha256Hex(sha256, navRevisionInput(manifest));
  if (revision !== manifest.navRevision) {
    return unavailable('integrity', `${path}: its files hash to navRevision ${revision.slice(0, 12)}…, the manifest records ${manifest.navRevision.slice(0, 12)}…`);
  }
  return { kind: 'available', manifest, json };
}

/** Loads the navigation manifest; never rejects except on abort. */
export async function loadNavManifest(opts: NavManifestLoaderOptions): Promise<NavManifestState> {
  opts.signal?.throwIfAborted();
  const sha256 = opts.sha256;
  if (sha256 === null) return unavailable('unsupported', 'WebCrypto is only available on secure pages (https, or http on localhost), so the navigation data cannot be verified');
  const first = await loadOnce(opts, sha256);
  const retry = first.kind === 'unavailable' && (first.reason === 'not-json' || first.reason === 'invalid' || first.reason === 'integrity');
  if (!retry || opts.cache === 'reload' || opts.signal?.aborted === true) return first;
  return loadOnce({ ...opts, cache: 'reload' }, sha256);
}

/** One line for the UI: which navigation data is in use, or why none is (the app then uses straight lines). */
export function describeNavManifest(state: NavManifestState): string {
  if (state.kind === 'available') {
    const maps = state.manifest.maps.map((m) => `${m.name} (${String(m.mapId)})`).join(', ');
    return `navigation ${state.manifest.navRevision.slice(0, 12)}: ${maps}`;
  }
  const why: Record<NavUnavailableReason, string> = {
    unsupported: 'this page cannot verify it',
    'not-found': 'not deployed',
    unreachable: 'could not be fetched',
    'not-json': 'not deployed',
    invalid: 'refused',
    integrity: 'refused',
  };
  return `navigation: unavailable, ${why[state.reason]} (${state.detail}); walking times use straight lines`;
}
