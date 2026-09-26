import type { WorldPoint } from '../domain/points';
import type { TravelEndpoint } from '../domain/travel';
import { worldMapId } from '../domain/ids';
import { quantise } from '../nav/grid';
import type { NavErrorCode, NavLegQuery, NavLegResult, NavPoint } from '../nav/worker/protocol';

/**
 * The navigation leg table (terrain-navigation.md §9.2; TN-04, TN-17, TN-18): one directed table
 * of navmesh legs, owned by the app and keyed by the navigation revision, which the travel model
 * reads synchronously while the worker fills it.
 *
 * - **Key:** `navRevision|mapId|qx,qy,hint|qx,qy,hint`, the endpoints quantised to 1 yd. A leg is
 *   computed from exactly those quantised points and hints (the worker quantises again), so an
 *   entry never depends on which requester asked first.
 * - **Value:** ground and swim tenth-yards (horizontal, RC-13), connector tenth-seconds, flags, the
 *   tagged passages the corridor crosses, and the longest swim run in tenth-yards (the `long-swim`
 *   warning names it).
 * - **Flags** are a sum of distinct powers of two, tested arithmetically (no bitwise operators,
 *   D-012).
 * - **Missing legs** the model asked for are recorded here; the scheduler drains them. A leg the
 *   scheduler has taken (or claimed for "computing paths") is in flight until its answer is set or
 *   it is released, and is not recorded again meanwhile, so no leg is asked twice at once.
 * - **Unavailable maps:** a map whose navigation files failed closed (or the whole runtime, when the
 *   worker cannot start) is recorded so the model gives the permanent fallback, not "pending".
 *
 * IndexedDB persistence stays deferred until a measured first-walk time needs it (§9.2).
 */

export const NAV_LEG_FLAGS = {
  /** No walking path: the endpoints lie in different components, or a one-way connector has no way back. */
  crossComponent: 1,
  /** An endpoint's containing floors span components (§8.3). */
  ambiguousFloor: 2,
  /** The longest contiguous swim is over the manifest's threshold (200 yd). */
  longSwim: 4,
  /** The start has no walkable polygon within 6 yd. */
  unsnappedFrom: 8,
  /** The end has no walkable polygon within 6 yd. */
  unsnappedTo: 16,
  /** The corridor crosses a passage nobody has verified in game (D-034 item 5). */
  unverifiedPassage: 32,
} as const;

export type NavLegFlagName = keyof typeof NAV_LEG_FLAGS;

/** Whether `flags` (a sum of distinct `NAV_LEG_FLAGS` values) includes `name`. */
export const hasNavLegFlag = (flags: number, name: NavLegFlagName): boolean => Math.floor(flags / NAV_LEG_FLAGS[name]) % 2 === 1;

/** The flag sum of distinct names. */
export function navLegFlags(names: readonly NavLegFlagName[]): number {
  return [...new Set(names)].reduce((sum, name) => sum + NAV_LEG_FLAGS[name], 0);
}

export interface NavLegEntry {
  /** Ground length, horizontal tenth-yards. */
  readonly g: number;
  /** Swim length, horizontal tenth-yards. */
  readonly s: number;
  /** Connector time (wait plus ride or cast), tenth-seconds. */
  readonly c: number;
  /** Sum of `NAV_LEG_FLAGS`. */
  readonly flags: number;
  /** Ids of the unverified passages the corridor crosses, ascending by manifest order. */
  readonly passages: readonly string[];
  /** The longest contiguous swim run, tenth-yards. */
  readonly swimRun: number;
}

/** A leg is walkable when both ends snapped and one component holds them. */
export const isWalkable = (e: NavLegEntry): boolean => !hasNavLegFlag(e.flags, 'crossComponent') && !hasNavLegFlag(e.flags, 'unsnappedFrom') && !hasNavLegFlag(e.flags, 'unsnappedTo');

/** The table entry for a worker result. */
export function navLegEntryOf(r: NavLegResult): NavLegEntry {
  const names: NavLegFlagName[] = [];
  if (!r.from.snapped) names.push('unsnappedFrom');
  if (!r.to.snapped) names.push('unsnappedTo');
  if (r.reachable) {
    if (r.from.ambiguous || r.to.ambiguous) names.push('ambiguousFloor');
    if (r.flags.includes('long-swim')) names.push('longSwim');
    if (r.flags.includes('unverified-passage')) names.push('unverifiedPassage');
  } else if (r.reason === 'other-component' || r.reason === 'no-path') {
    names.push('crossComponent');
  }
  return {
    g: r.reachable ? r.groundTenths : 0,
    s: r.reachable ? r.swimTenths : 0,
    c: r.reachable ? r.connectorTenthsSeconds : 0,
    flags: navLegFlags(names),
    passages: r.reachable ? r.passages : [],
    swimRun: r.reachable ? Math.round(r.longestSwimYd * 10) : 0,
  };
}

/** A zone hint as the table keys it: a positive safe integer, else 0 (none). */
const hintOf = (hint: number): number => (Number.isSafeInteger(hint) && hint > 0 ? hint : 0);

/** An endpoint quantised to 1 yd, with its hint (§8.1, §9.2). */
export const navPointOf = (e: TravelEndpoint): NavPoint => ({ x: quantise(e.point.x), y: quantise(e.point.y), hint: hintOf(e.zoneHint) });

export function navLegKey(revision: string, mapId: number, from: NavPoint, to: NavPoint): string {
  return `${revision}|${String(mapId)}|${String(from.x)},${String(from.y)},${String(from.hint)}|${String(to.x)},${String(to.y)},${String(to.hint)}`;
}

/** One leg to compute: its table key and the worker query. */
export interface NavLegRequest {
  readonly key: string;
  readonly query: NavLegQuery;
}

/** The request for the leg `from` → `to` (same world map; the caller checks). */
export function navLegRequest(revision: string, from: TravelEndpoint, to: TravelEndpoint): NavLegRequest {
  const a = navPointOf(from);
  const b = navPointOf(to);
  const mapId = from.point.mapId;
  return { key: navLegKey(revision, mapId, a, b), query: { mapId, from: a, to: b } };
}

/** Why navigation is off for a map (or for every map). */
export interface NavUnavailable {
  readonly code: NavErrorCode;
  readonly message: string;
}

export class NavigationLegTable {
  private readonly entries = new Map<string, NavLegEntry>();
  private readonly missing = new Map<string, NavLegRequest>();
  /** Legs asked of the worker and not answered yet, with how many requests carry each. */
  private readonly inFlight = new Map<string, number>();
  private readonly failedMaps = new Map<number, NavUnavailable>();
  private failedAll: NavUnavailable | null = null;
  private listener: (() => void) | null = null;

  constructor(readonly revision: string) {}

  get size(): number {
    return this.entries.size;
  }

  get missingCount(): number {
    return this.missing.size;
  }

  /** Legs asked of the worker and not answered or released yet. */
  get inFlightCount(): number {
    return this.inFlight.size;
  }

  get(key: string): NavLegEntry | undefined {
    return this.entries.get(key);
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** True while the leg has been asked of the worker and not answered or released. */
  isInFlight(key: string): boolean {
    return this.inFlight.has(key);
  }

  set(key: string, entry: NavLegEntry): void {
    this.entries.set(key, entry);
    this.missing.delete(key);
    this.inFlight.delete(key);
  }

  /** Records a leg the model needed but the table lacks (and nobody is computing), and wakes the listener. */
  recordMissing(request: NavLegRequest): void {
    if (this.entries.has(request.key) || this.missing.has(request.key) || this.inFlight.has(request.key) || this.unavailable(request.query.mapId) !== null) return;
    this.missing.set(request.key, request);
    this.listener?.();
  }

  /** Removes and returns up to `max` recorded missing legs, oldest first; they are in flight until answered or released. */
  takeMissing(max = Number.POSITIVE_INFINITY): NavLegRequest[] {
    const out: NavLegRequest[] = [];
    for (const [key, request] of this.missing) {
      if (out.length >= max) break;
      this.missing.delete(key);
      this.inFlight.set(key, (this.inFlight.get(key) ?? 0) + 1);
      out.push(request);
    }
    return out;
  }

  /** Drops every recorded missing leg without asking for it (paused, or a run that will ask for them itself). */
  clearMissing(): void {
    this.missing.clear();
  }

  /**
   * Claims `requests` for a request about to be sent ("computing paths"): they leave the missing
   * list and are in flight. Returns those not answered yet, including any another request already
   * carries (a run must know when every one of its legs is answered; the duplicate is bounded by
   * what the background drain had in flight).
   */
  claim(requests: Iterable<NavLegRequest>): NavLegRequest[] {
    const out: NavLegRequest[] = [];
    for (const r of requests) {
      this.missing.delete(r.key);
      if (this.entries.has(r.key)) continue;
      this.inFlight.set(r.key, (this.inFlight.get(r.key) ?? 0) + 1);
      out.push(r);
    }
    return out;
  }

  /** Ends one request's flight of `requests` without an answer (it failed or was cancelled). */
  release(requests: Iterable<NavLegRequest>): void {
    for (const r of requests) {
      const n = (this.inFlight.get(r.key) ?? 0) - 1;
      if (n > 0) this.inFlight.set(r.key, n);
      else this.inFlight.delete(r.key);
    }
  }

  /** Forgets recorded missing legs that another request is computing. */
  forgetMissing(keys: Iterable<string>): void {
    for (const key of keys) this.missing.delete(key);
  }

  /** The one listener told about newly recorded missing legs (the scheduler); returns its removal. */
  onMissing(listener: () => void): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }

  /** Navigation for `mapId` failed closed ('all' for every map); its legs fall back for good. */
  markUnavailable(mapId: number | 'all', why: NavUnavailable): void {
    if (mapId === 'all') this.failedAll ??= why;
    else if (!this.failedMaps.has(mapId)) this.failedMaps.set(mapId, why);
    for (const [key, request] of this.missing) if (mapId === 'all' || request.query.mapId === mapId) this.missing.delete(key);
  }

  /** Why navigation is off for `mapId`, or null. */
  unavailable(mapId: number): NavUnavailable | null {
    return this.failedAll ?? this.failedMaps.get(mapId) ?? null;
  }

  /**
   * Clears failures: every one (a retry after the app restarts the worker), or with `only`, the
   * every-map failure when it is that one (a retry of what the caller itself marked).
   */
  clearUnavailable(only?: NavUnavailable): void {
    if (only !== undefined) {
      if (this.failedAll === only) this.failedAll = null;
      return;
    }
    this.failedMaps.clear();
    this.failedAll = null;
  }
}

/** A path as world points (the heights the worker estimates are dropped: `WorldPoint` is 2D). */
export function worldPathOf(mapId: number, triples: readonly number[]): readonly WorldPoint[] {
  const out: WorldPoint[] = [];
  const map = worldMapId(mapId);
  for (let i = 0; i + 2 < triples.length; i += 3) out.push({ mapId: map, x: triples[i] ?? 0, y: triples[i + 1] ?? 0 });
  return out;
}

/**
 * The small LRU of drawn paths (§9.3 `path()`), separate from the leg table: only the legs the
 * map draws are kept, keyed like the table. Null records a leg known to have no path.
 */
export class NavigationPathCache {
  private readonly paths = new Map<string, readonly WorldPoint[] | null>();
  private readonly missing = new Map<string, NavLegRequest>();
  /** Paths asked of the worker and not answered yet (never recorded twice at once). */
  private readonly inFlight = new Set<string>();
  private listener: (() => void) | null = null;

  constructor(readonly capacity = 256) {
    if (!(capacity > 0)) throw new RangeError('NavigationPathCache: capacity must be positive');
  }

  get size(): number {
    return this.paths.size;
  }

  get missingCount(): number {
    return this.missing.size;
  }

  /** The cached path (refreshing its recency), null for a leg without one, undefined when not cached. */
  get(key: string): readonly WorldPoint[] | null | undefined {
    const path = this.paths.get(key);
    if (path === undefined) return undefined;
    this.paths.delete(key);
    this.paths.set(key, path);
    return path;
  }

  set(key: string, path: readonly WorldPoint[] | null): void {
    this.paths.delete(key);
    this.paths.set(key, path);
    this.missing.delete(key);
    this.inFlight.delete(key);
    while (this.paths.size > this.capacity) {
      const oldest = this.paths.keys().next();
      if (oldest.done === true) break;
      this.paths.delete(oldest.value);
    }
  }

  /** True while the path has been asked of the worker and not answered or released. */
  isInFlight(key: string): boolean {
    return this.inFlight.has(key);
  }

  /** True while the path is recorded or asked, and not answered yet (a request for it is not lost). */
  isWaiting(key: string): boolean {
    return this.inFlight.has(key) || this.missing.has(key);
  }

  /** Ends a path's flight without an answer (a failed or cancelled request). */
  release(key: string): void {
    this.inFlight.delete(key);
  }

  /** Records a path the map asked for; at most `capacity` requests wait (the newest win). One already asked is not recorded again. */
  recordMissing(request: NavLegRequest): void {
    if (this.paths.has(request.key) || this.missing.has(request.key) || this.inFlight.has(request.key)) return;
    this.missing.set(request.key, request);
    while (this.missing.size > this.capacity) {
      const oldest = this.missing.keys().next();
      if (oldest.done === true) break;
      this.missing.delete(oldest.value);
    }
    this.listener?.();
  }

  /** Removes and returns up to `max` recorded paths, oldest first; they are in flight until answered or released. */
  takeMissing(max = Number.POSITIVE_INFINITY): NavLegRequest[] {
    const out: NavLegRequest[] = [];
    for (const [key, request] of this.missing) {
      if (out.length >= max) break;
      this.missing.delete(key);
      this.inFlight.add(key);
      out.push(request);
    }
    return out;
  }

  onMissing(listener: () => void): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }
}
