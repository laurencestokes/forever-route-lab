import type { LegFlag, LegReason } from '../legs';

/**
 * The messages between the app and the navigation worker (terrain-navigation.md §9.2, §9.6;
 * RC-06, RC-07). Plain data only: every message survives structured cloning.
 *
 * - The app sends `init` first, with the absolute base URL the navigation files are relative to
 *   and the manifest JSON `src/infra/nav` loaded. The worker parses the manifest itself and
 *   answers `ready` or `init-failed`.
 * - `legs` carries a batch of directed legs. The worker answers with `progress` messages that
 *   carry the results of the legs finished since the last one (one per source point), then
 *   `done`, or `failed`.
 * - `path` asks for one leg's drawn polyline: `path-done` or `failed`.
 * - `cancel` fails the request with `cancelled` at once (even while one of its files is still
 *   arriving) and releases what it pinned.
 *
 * Endpoints are quantised to 1 yd by the worker whatever the caller sends (§9.2), so a result
 * depends only on the quantised points and the zone hints.
 */

/** One endpoint: world X and Y in yards (quantised to 1 yd by the worker) and its zone hint (§8.1). */
export interface NavPoint {
  readonly x: number;
  readonly y: number;
  /** Top-level zone AreaTable id for snap rule A; 0 means none. */
  readonly hint: number;
}

/** A directed leg on one world map. */
export interface NavLegQuery {
  readonly mapId: number;
  readonly from: NavPoint;
  readonly to: NavPoint;
}

/** How one endpoint snapped (§8.1). */
export interface NavSnapInfo {
  /** False when no walkable polygon lies within the snap radius (6 yd). */
  readonly snapped: boolean;
  /** The containing floors left after rules A and B lie in more than one component (§8.3). */
  readonly ambiguous: boolean;
}

/**
 * One leg as `legsFrom` computed it (§9.1), with the snap facts of both ends. Lengths are
 * horizontal tenth-yards (RC-13); `passages` names the tagged passages the corridor crosses by
 * their manifest ids (RC-09).
 */
export interface NavLegResult {
  readonly reachable: boolean;
  readonly reason: LegReason;
  readonly groundTenths: number;
  readonly swimTenths: number;
  readonly connectorTenthsSeconds: number;
  readonly longestSwimYd: number;
  readonly flags: readonly LegFlag[];
  readonly passages: readonly string[];
  readonly from: NavSnapInfo;
  readonly to: NavSnapInfo;
}

/** A result and the index of its query in the request. */
export interface NavIndexedResult {
  readonly index: number;
  readonly result: NavLegResult;
}

/**
 * `interactive` requests (the legs and paths of the current walk) run before `bulk` ones
 * ("computing paths") at the next source boundary.
 */
export type NavPriority = 'interactive' | 'bulk';

export type NavErrorCode =
  /** No WebCrypto in the worker: nothing can be verified, so nothing is loaded. */
  | 'unsupported'
  /**
   * May succeed later: the request or its body failed (offline, a dropped connection), a file did
   * not arrive within the time limit, or the server answered with a status that may pass (HTTP
   * 408, 425, 429 or 5xx).
   */
  | 'network'
  /** The server answered with an error status that will not pass by asking again (404, 403, …). */
  | 'http'
  /** A file's size or SHA-256 differs from the manifest's, also after one refetch past the HTTP cache. */
  | 'integrity'
  /** A verified file, or the manifest, does not decode as the format this app reads. */
  | 'format'
  /** The map has no navigation data in the manifest. */
  | 'no-map'
  /** The request was cancelled. */
  | 'cancelled'
  /** The worker was not initialised, or its initialisation failed. */
  | 'not-ready'
  /**
   * The worker itself failed (its script did not load, or it stopped on an uncaught error), or it
   * did not start in time: nothing more will be answered.
   */
  | 'worker-failed'
  /** Anything else (a bug); the message says what. */
  | 'internal';

export interface NavErrorInfo {
  readonly code: NavErrorCode;
  readonly message: string;
  /** The navigation file concerned, relative to the base URL, when one is. */
  readonly path?: string;
  /** The world map concerned, when one is. */
  readonly mapId?: number;
}

/** A typed failure of the navigation runtime; the app falls back to the straight-line model. */
export class NavWorkerError extends Error {
  override readonly name = 'NavWorkerError';

  constructor(
    readonly code: NavErrorCode,
    message: string,
    readonly path?: string,
    readonly mapId?: number,
  ) {
    super(message);
  }

  toInfo(): NavErrorInfo {
    return { code: this.code, message: this.message, ...(this.path === undefined ? {} : { path: this.path }), ...(this.mapId === undefined ? {} : { mapId: this.mapId }) };
  }

  static fromInfo(info: NavErrorInfo): NavWorkerError {
    return new NavWorkerError(info.code, info.message, info.path, info.mapId);
  }
}

/** `base` + `path` with exactly one slash between them ('' stays relative). */
export function joinNavUrl(base: string, path: string): string {
  if (base === '') return path;
  return base.endsWith('/') ? `${base}${path}` : `${base}/${path}`;
}

export const isNavWorkerError = (error: unknown): error is NavWorkerError => error instanceof NavWorkerError;

/** What the runtime holds, for diagnostics and the heap budget (§14.3). */
export interface NavWorkerStats {
  /** Maps whose `map.bin` is open. */
  readonly maps: number;
  readonly blocksLoaded: number;
  /** Blocks pinned by running requests. */
  readonly blocksPinned: number;
  /** Bytes of the typed arrays held: map-wide arrays, blocks and search scratch. */
  readonly bytes: number;
  /** The LRU's byte budget. */
  readonly maxBytes: number;
  /** Files fetched and verified (map.bin files and blocks). */
  readonly filesVerified: number;
  /** Bytes of those files. */
  readonly bytesVerified: number;
  /** Refetches with `cache: 'reload'` after a failed check. */
  readonly refetches: number;
  readonly blocksEvicted: number;
  readonly mapsDropped: number;
}

export type NavRequest =
  | { readonly type: 'init'; readonly baseUrl: string; readonly manifest: unknown; readonly maxBytes?: number }
  | { readonly type: 'legs'; readonly id: number; readonly queries: readonly NavLegQuery[]; readonly priority: NavPriority }
  | { readonly type: 'path'; readonly id: number; readonly query: NavLegQuery }
  | { readonly type: 'cancel'; readonly id: number }
  | { readonly type: 'stats'; readonly id: number };

export type NavResponse =
  | { readonly type: 'ready'; readonly navRevision: string }
  | { readonly type: 'init-failed'; readonly error: NavErrorInfo }
  | { readonly type: 'progress'; readonly id: number; readonly done: number; readonly total: number; readonly results: readonly NavIndexedResult[] }
  | { readonly type: 'done'; readonly id: number }
  | { readonly type: 'path-done'; readonly id: number; readonly path: readonly number[] | null }
  | { readonly type: 'failed'; readonly id: number; readonly error: NavErrorInfo }
  | { readonly type: 'stats'; readonly id: number; readonly stats: NavWorkerStats };
