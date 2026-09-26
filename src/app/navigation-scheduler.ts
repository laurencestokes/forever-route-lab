import type { NavLegsProgress } from '../nav/worker/client';
import { isNavWorkerError, type NavErrorCode, type NavLegQuery, type NavLegResult, type NavPriority } from '../nav/worker/protocol';
import { navLegEntryOf, worldPathOf, type NavigationLegTable, type NavigationPathCache, type NavLegEntry, type NavLegRequest, type NavUnavailable } from './navigation-legs';
import type { NavigationTravelModel, TravelPair } from './navigation-model';

/**
 * Keeps the navigation leg table filled (terrain-navigation.md §9.3, §9.4; RC-07):
 *
 * - **Background:** the model records the legs and paths a walk needed but the table lacked; the
 *   scheduler drains them soon after, asks the worker (priority `interactive`), and applies the
 *   results to the table in batches at most every 100 ms, notifying subscribers once per batch, so
 *   the app re-walks once per batch instead of once per leg. The background drain also runs while a
 *   "computing paths" run is in flight, so the legs an edit adds go ahead of the run's bulk groups
 *   (the worker runs `interactive` requests first); a leg or path already asked of the worker is
 *   never asked again until it is answered or its request fails.
 * - **Computing paths:** `computeLegs` makes a given set of legs complete before the optimiser
 *   compiles or an export runs (§9.4, RC-07): it asks for every missing entry the model needs,
 *   including the walks of same-map transport compositions, as `bulk` requests, with progress
 *   (legs done of legs needed) and cancellation through an `AbortSignal`. A cancelled run keeps
 *   what arrived; the rest stays pending.
 * - **Failures:** a map whose files failed closed (`integrity`, `format`, `http`, `no-map`) is
 *   marked unavailable in the table, so its legs take the permanent fallback; a runtime that cannot
 *   start or has stopped (`unsupported`, `not-ready`, `worker-failed`) marks every map. Subscribers
 *   hear of it in the next batch. A `network` failure (offline, a file that did not arrive in time,
 *   a server error that may pass) puts the legs back and asks again after `retryMs`, in the
 *   background and in "computing paths" alike (the run reports what it waits to retry after). Any
 *   other failure (a bug: `internal`) is asked again the same way at most `maxInternalFailures`
 *   times per map in all, then that map is marked unavailable with the message.
 */

/** The worker client as the scheduler uses it (`NavWorkerClient` satisfies it). */
export interface NavLegService {
  legs(queries: readonly NavLegQuery[], options?: { readonly signal?: AbortSignal; readonly priority?: NavPriority; readonly onProgress?: (progress: NavLegsProgress) => void }): Promise<readonly NavLegResult[]>;
  path(query: NavLegQuery, options?: { readonly signal?: AbortSignal }): Promise<readonly number[] | null>;
}

export interface NavTimers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const defaultNavTimers: NavTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export interface NavigationSchedulerOptions {
  readonly service: NavLegService;
  readonly table: NavigationLegTable;
  readonly paths: NavigationPathCache;
  readonly timers?: NavTimers;
  /** Results are applied at most this often (default 100 ms, §9.3). */
  readonly batchMs?: number;
  /** Legs per background request (default 2,048). */
  readonly maxLegsPerRequest?: number;
  /** Paths requested at once (default 8). */
  readonly maxPathsInFlight?: number;
  /** Wait after a `network` failure before asking again (default 5,000 ms). */
  readonly retryMs?: number;
  /** Failures of any other kind (`internal`) a map may have before it is marked unavailable (default 3). */
  readonly maxInternalFailures?: number;
}

/** What one applied batch changed. */
export interface NavigationBatch {
  readonly legs: number;
  readonly paths: number;
  /** Maps newly marked unavailable ('all' when the runtime failed). */
  readonly unavailable: readonly (number | 'all')[];
}

export interface ComputeLegsProgress {
  readonly done: number;
  readonly total: number;
  /** The failure the run is waiting to retry after (`retryMs`), or null while it is computing. */
  readonly retrying: string | null;
}

export interface ComputeLegsOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ComputeLegsProgress) => void;
}

export interface ComputeLegsResult {
  /** Table entries requested. */
  readonly requested: number;
  /** True when no pair's leg is pending any more. */
  readonly complete: boolean;
}

export interface NavigationScheduler {
  /** Called once per applied batch; returns the unsubscribe. */
  subscribe(listener: (batch: NavigationBatch) => void): () => void;
  /** Drains the recorded missing legs and paths soon (the table and path cache call it). */
  wake(): void;
  /** Applies buffered results now (one notification when anything changed). */
  flush(): void;
  /** Makes the legs of `pairs` complete in the table ("computing paths"); see the module comment. */
  computeLegs(model: NavigationTravelModel, pairs: readonly TravelPair[], options?: ComputeLegsOptions): Promise<ComputeLegsResult>;
  /**
   * Holds the background drain's legs (paths still go) until the returned release is called: the
   * pipeline holds them between a walk and the "computing paths" run that claims the same legs, so
   * they are not asked for twice.
   */
  holdLegs(): () => void;
  /** Marks a map (or 'all') unavailable for `why`, as a failed request would; subscribers hear of it in the next batch. */
  markUnavailable(mapId: number | 'all', why: NavUnavailable): void;
  /** True while requests are in flight or results wait to be applied. */
  readonly busy: boolean;
  dispose(): void;
}

/** Failures that end navigation for their map: the files will not get better by asking again. */
const MAP_FAILURES: readonly NavErrorCode[] = ['integrity', 'format', 'http', 'no-map'];
/** Failures that end navigation for every map: the worker cannot answer anything. */
const RUNTIME_FAILURES: readonly NavErrorCode[] = ['unsupported', 'not-ready', 'worker-failed'];

type Outcome = 'handled' | 'retry' | 'abort';

/** A legs request that failed, with the legs it did not answer. */
class LegsRequestFailure extends Error {
  constructor(
    readonly error: unknown,
    readonly unanswered: readonly NavLegRequest[],
  ) {
    super(error instanceof Error ? error.message : String(error));
  }
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createNavigationScheduler(options: NavigationSchedulerOptions): NavigationScheduler {
  const { service, table, paths } = options;
  const timers = options.timers ?? defaultNavTimers;
  const batchMs = options.batchMs ?? 100;
  const maxLegs = options.maxLegsPerRequest ?? 2048;
  const maxPaths = options.maxPathsInFlight ?? 8;
  const retryMs = options.retryMs ?? 5000;
  const maxInternalFailures = options.maxInternalFailures ?? 3;
  const listeners = new Set<(batch: NavigationBatch) => void>();
  const background = new AbortController();
  const bufferedLegs: [string, NavLegEntry][] = [];
  const bufferedPaths: [string, NavLegRequest, readonly number[] | null][] = [];
  const bufferedUnavailable: (number | 'all')[] = [];
  /** Failures of other kinds so far, per map. */
  const internalFailures = new Map<number, number>();
  let flushTimer: unknown = null;
  let drainTimer: unknown = null;
  let retryTimer: unknown = null;
  let legsInFlight = 0;
  let backgroundLegsInFlight = 0;
  let pathsInFlight = 0;
  let holds = 0;
  let disposed = false;

  const scheduleFlush = (): void => {
    if (flushTimer === null && !disposed) flushTimer = timers.set(flush, batchMs);
  };

  function flush(): void {
    if (flushTimer !== null) {
      timers.clear(flushTimer);
      flushTimer = null;
    }
    const legs = bufferedLegs.splice(0);
    const drawn = bufferedPaths.splice(0);
    const unavailable = bufferedUnavailable.splice(0);
    for (const [key, entry] of legs) table.set(key, entry);
    for (const [key, request, triples] of drawn) paths.set(key, triples === null ? null : worldPathOf(request.query.mapId, triples));
    if (legs.length === 0 && drawn.length === 0 && unavailable.length === 0) return;
    const batch: NavigationBatch = { legs: legs.length, paths: drawn.length, unavailable };
    for (const listener of [...listeners]) listener(batch);
  }

  const markUnavailable = (mapId: number | 'all', why: NavUnavailable): void => {
    if (mapId !== 'all' && table.unavailable(mapId) !== null) return;
    table.markUnavailable(mapId, why);
    bufferedUnavailable.push(mapId);
    scheduleFlush();
  };

  /** Classifies a failed request of `batch` and records map failures. */
  const handleFailure = (error: unknown, batch: readonly NavLegRequest[]): Outcome => {
    if (!isNavWorkerError(error) && error instanceof Error && error.name === 'AbortError') return 'abort';
    if (isNavWorkerError(error) && error.code === 'cancelled') return 'abort';
    const code: NavErrorCode = isNavWorkerError(error) ? error.code : 'internal';
    const why: NavUnavailable = { code, message: messageOf(error) };
    const errorMap = isNavWorkerError(error) ? error.mapId : undefined;
    const maps = errorMap === undefined ? [...new Set(batch.map((r) => r.query.mapId))] : [errorMap];
    if (RUNTIME_FAILURES.includes(code)) {
      markUnavailable('all', why);
      return 'handled';
    }
    if (MAP_FAILURES.includes(code)) {
      for (const mapId of maps) markUnavailable(mapId, why);
      return 'handled';
    }
    if (code === 'network') return 'retry';
    // A bug: ask again a few times, then stop asking for that map.
    for (const mapId of maps) {
      const n = (internalFailures.get(mapId) ?? 0) + 1;
      internalFailures.set(mapId, n);
      if (n >= maxInternalFailures) markUnavailable(mapId, why);
    }
    return maps.every((mapId) => table.unavailable(mapId) !== null) ? 'handled' : 'retry';
  };

  const retryLater = (batch: readonly NavLegRequest[], record: (r: NavLegRequest) => void): void => {
    if (disposed) return;
    for (const r of batch) record(r);
    if (retryTimer === null) {
      retryTimer = timers.set(() => {
        retryTimer = null;
        wake();
      }, retryMs);
    }
  };

  /**
   * Asks the worker for `batch` (claimed in the table) and buffers the results as they arrive.
   * Rejects with a `LegsRequestFailure` naming the legs it did not answer, released in the table.
   */
  const requestLegs = (batch: readonly NavLegRequest[], priority: NavPriority, signal: AbortSignal, onStep?: (count: number) => void): Promise<void> => {
    legsInFlight += 1;
    if (priority === 'interactive') backgroundLegsInFlight += 1;
    const answered = new Array<boolean>(batch.length).fill(false);
    let sent: Promise<readonly NavLegResult[]>;
    try {
      sent = service.legs(
        batch.map((r) => r.query),
        {
          signal,
          priority,
          onProgress: (p) => {
            for (const { index, result } of p.results) {
              const r = batch[index];
              if (r === undefined || answered[index] === true) continue;
              answered[index] = true;
              bufferedLegs.push([r.key, navLegEntryOf(result)]);
            }
            scheduleFlush();
            onStep?.(p.results.length);
          },
        },
      );
    } catch (error) {
      sent = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return sent
      .then(
        () => undefined,
        (error: unknown) => {
          const unanswered = batch.filter((_, i) => answered[i] !== true);
          table.release(unanswered);
          throw new LegsRequestFailure(error, unanswered);
        },
      )
      .finally(() => {
        legsInFlight -= 1;
        if (priority === 'interactive') backgroundLegsInFlight -= 1;
      });
  };

  /** Resolves after `ms`, or rejects with the signal's reason when it aborts first. */
  const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason as Error);
        return;
      }
      const onAbort = (): void => {
        timers.clear(handle);
        reject(signal.reason as Error);
      };
      const handle = timers.set(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });

  function drain(): void {
    drainTimer = null;
    if (disposed || retryTimer !== null) return;
    // Beside a "computing paths" run too: the legs recorded now are not in it (it claimed its own).
    if (backgroundLegsInFlight === 0 && holds === 0) {
      const batch = table.takeMissing(maxLegs);
      if (batch.length > 0) {
        requestLegs(batch, 'interactive', background.signal).then(
          () => {
            if (table.missingCount > 0) wake();
          },
          (failure: unknown) => {
            const { error, unanswered } = failure instanceof LegsRequestFailure ? failure : new LegsRequestFailure(failure, []);
            if (handleFailure(error, unanswered) === 'retry') retryLater(unanswered, (r) => table.recordMissing(r));
            else if (table.missingCount > 0) wake();
          },
        );
      }
    }
    while (pathsInFlight < maxPaths) {
      const [r] = paths.takeMissing(1);
      if (r === undefined) break;
      pathsInFlight += 1;
      service
        .path(r.query, { signal: background.signal })
        .then(
          (triples) => {
            bufferedPaths.push([r.key, r, triples]);
            scheduleFlush();
          },
          (error: unknown) => {
            paths.release(r.key);
            if (handleFailure(error, [r]) === 'retry') retryLater([r], (q) => paths.recordMissing(q));
          },
        )
        .finally(() => {
          pathsInFlight -= 1;
          if (paths.missingCount > 0) wake();
        });
    }
  }

  function wake(): void {
    if (drainTimer === null && !disposed) drainTimer = timers.set(drain, 0);
  }

  const unsubscribeTable = table.onMissing(wake);
  const unsubscribePaths = paths.onMissing(wake);

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    wake,
    flush,
    get busy() {
      return legsInFlight > 0 || pathsInFlight > 0 || bufferedLegs.length > 0 || bufferedPaths.length > 0;
    },

    async computeLegs(model, pairs, opts = {}) {
      if (model.table !== table) throw new RangeError('computeLegs: the model reads another leg table');
      const signal = opts.signal ?? new AbortController().signal;
      const asked = new Set<string>();
      let done = 0;
      let total = 0;
      const report = (retrying: string | null): void => {
        opts.onProgress?.({ done, total, retrying });
      };
      try {
        // Round 1 asks for the direct legs; round 2 for the dock walks of the pairs found to have no
        // walking path (same-map transports); a third round only if a composition needs more.
        for (let round = 0; round < 3; round += 1) {
          signal.throwIfAborted();
          const needed = new Map<string, NavLegRequest>();
          for (const p of pairs) for (const r of model.legsNeeded(p.from, p.to)) if (!asked.has(r.key)) needed.set(r.key, r);
          if (needed.size === 0) break;
          for (const key of needed.keys()) asked.add(key);
          total += needed.size;
          let batch = table.claim(needed.values());
          report(null);
          while (batch.length > 0) {
            try {
              await requestLegs(batch, 'bulk', signal, (count) => {
                done += count;
                report(null);
              });
              batch = [];
            } catch (failure) {
              const { error, unanswered } = failure instanceof LegsRequestFailure ? failure : new LegsRequestFailure(failure, batch);
              flush();
              if (signal.aborted) throw error;
              const outcome = handleFailure(error, unanswered);
              if (outcome === 'abort') throw error;
              // What is left on maps that still have navigation is asked again: at once after a
              // map failure (the rest were other maps' legs), after `retryMs` otherwise.
              const rest = unanswered.filter((r) => table.unavailable(r.query.mapId) === null && !table.has(r.key));
              if (rest.length === 0) break;
              if (outcome === 'retry') {
                report(messageOf(error));
                await sleep(retryMs, signal);
                report(null);
              }
              batch = table.claim(rest);
            }
          }
          flush();
        }
      } finally {
        // Legs recorded while this run was in flight go out now.
        if (table.missingCount > 0 || paths.missingCount > 0) wake();
      }
      flush();
      return { requested: total, complete: pairs.every((p) => model.legsNeeded(p.from, p.to).length === 0) };
    },

    holdLegs() {
      holds += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds -= 1;
        if (holds === 0 && table.missingCount > 0) wake();
      };
    },

    markUnavailable,

    dispose() {
      if (disposed) return;
      disposed = true;
      background.abort();
      for (const handle of [flushTimer, drainTimer, retryTimer]) if (handle !== null) timers.clear(handle);
      flushTimer = null;
      drainTimer = null;
      retryTimer = null;
      listeners.clear();
      unsubscribeTable();
      unsubscribePaths();
    },
  };
}
