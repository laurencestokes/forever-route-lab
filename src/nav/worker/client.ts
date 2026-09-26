import { joinNavUrl, NavWorkerError, type NavIndexedResult, type NavLegQuery, type NavLegResult, type NavPriority, type NavRequest, type NavResponse, type NavWorkerStats } from './protocol';

/**
 * The main-thread side of the navigation worker (terrain-navigation.md §9.6; RC-07). It starts
 * `nav.worker.ts` as a module worker (the `new Worker(new URL(...), { type: 'module' })` form Vite
 * bundles; `worker.format` is `es` in vite.config.ts), sends `init` with the manifest JSON and the
 * base URL made absolute (a worker resolves relative URLs against its own script, not the page),
 * and turns requests into promises:
 *
 * - `legs(queries)` sends the whole batch as one request; `onProgress` receives each source
 *   group's results as they arrive, and the promise resolves with every result in query order;
 * - `path(query)` resolves with one leg's polyline (x, y, z triples) or null;
 * - an `AbortSignal` cancels a request in the worker (between search slices) and rejects it with
 *   the signal's reason at once.
 *
 * Failures reject with a `NavWorkerError`, whose `code` tells the app whether to fall back for a
 * map (`integrity`, `format`, `http`, `no-map`), for everything (`unsupported`, `not-ready`,
 * `worker-failed`: the worker's script did not load or the worker stopped on an error), or to try
 * again later (`network`).
 */

/** The folder of the navigation files under the app's base URL (the manifest's paths are relative to it). */
export const NAV_DIRECTORY = 'nav/';

/** The worker as the client uses it; `createModuleWorkerPort` wraps a real one, tests pass a fake. */
export interface NavWorkerPort {
  postMessage(message: NavRequest): void;
  listen(onMessage: (message: NavResponse) => void, onError: (message: string) => void): void;
  terminate(): void;
}

export interface NavWorkerClientOptions {
  /**
   * The app's base URL (`import.meta.env.BASE_URL`); made absolute against the page when a document
   * exists, and the worker fetches `<base>nav/<path>`.
   */
  readonly baseUrl: string;
  /** The manifest JSON as `src/infra/nav` loaded it; the worker parses it again. */
  readonly manifest: unknown;
  /** The worker's typed-array budget (default: the core's). */
  readonly maxBytes?: number;
  /** The worker to talk to (default: a new module worker). */
  readonly port?: NavWorkerPort;
}

export interface NavLegsProgress {
  readonly done: number;
  readonly total: number;
  /** The results that arrived with this step (one source group). */
  readonly results: readonly NavIndexedResult[];
}

export interface NavLegsRequestOptions {
  readonly signal?: AbortSignal;
  readonly priority?: NavPriority;
  readonly onProgress?: (progress: NavLegsProgress) => void;
}

export interface NavWorkerClient {
  /** Resolves with the navRevision once the worker has parsed the manifest; rejects with its `init-failed` error. */
  readonly ready: Promise<string>;
  legs(queries: readonly NavLegQuery[], options?: NavLegsRequestOptions): Promise<readonly NavLegResult[]>;
  path(query: NavLegQuery, options?: { readonly signal?: AbortSignal }): Promise<readonly number[] | null>;
  stats(): Promise<NavWorkerStats>;
  /** Terminates the worker; pending requests reject with `cancelled`. */
  dispose(): void;
}

/** A `NavWorkerPort` over a new module worker running nav.worker.ts. */
export function createModuleWorkerPort(): NavWorkerPort {
  const worker = new Worker(new URL('./nav.worker.ts', import.meta.url), { type: 'module', name: 'navigation' });
  return {
    postMessage(message) {
      worker.postMessage(message);
    },
    listen(onMessage, onError) {
      worker.onmessage = (event: MessageEvent<NavResponse>) => {
        onMessage(event.data);
      };
      worker.onerror = (event: Event) => {
        // A script that fails to load fires a plain Event (no message); an uncaught error an ErrorEvent.
        const message: unknown = (event as Partial<ErrorEvent>).message;
        onError(typeof message === 'string' && message !== '' ? message : 'the navigation worker failed to start');
      };
      worker.onmessageerror = () => {
        onError('a message from the navigation worker could not be read');
      };
    },
    terminate() {
      worker.terminate();
    },
  };
}

/** `base` made absolute against the page, where there is one (a worker has no page to resolve against). */
function absoluteBase(base: string): string {
  if (typeof document === 'undefined') return base;
  try {
    return new URL(base, document.baseURI).href;
  } catch {
    return base;
  }
}

type Pending =
  | {
      readonly kind: 'legs';
      readonly results: (NavLegResult | undefined)[];
      readonly onProgress: ((progress: NavLegsProgress) => void) | undefined;
      readonly resolve: (results: readonly NavLegResult[]) => void;
      readonly reject: (error: unknown) => void;
      readonly cleanup: () => void;
    }
  | { readonly kind: 'path'; readonly resolve: (path: readonly number[] | null) => void; readonly reject: (error: unknown) => void; readonly cleanup: () => void }
  | { readonly kind: 'stats'; readonly resolve: (stats: NavWorkerStats) => void; readonly reject: (error: unknown) => void; readonly cleanup: () => void };

export function createNavWorkerClient(options: NavWorkerClientOptions): NavWorkerClient {
  const port = options.port ?? createModuleWorkerPort();
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let broken: NavWorkerError | null = null;
  let resolveReady: (revision: string) => void = () => undefined;
  let rejectReady: (error: unknown) => void = () => undefined;
  const ready = new Promise<string>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // The app may never await `ready`; its failure also reaches every request.
  ready.catch(() => undefined);

  const failAll = (error: NavWorkerError): void => {
    broken ??= error;
    rejectReady(error);
    for (const [id, p] of pending) {
      pending.delete(id);
      p.cleanup();
      p.reject(error);
    }
  };

  const onMessage = (message: NavResponse): void => {
    if (message.type === 'ready') {
      resolveReady(message.navRevision);
      return;
    }
    if (message.type === 'init-failed') {
      // Requests already sent fail in the worker; later ones fail here at once.
      broken ??= NavWorkerError.fromInfo(message.error);
      rejectReady(broken);
      return;
    }
    const p = pending.get(message.id);
    if (p === undefined) return; // cancelled, or already settled
    switch (message.type) {
      case 'progress':
        if (p.kind !== 'legs') return;
        for (const r of message.results) p.results[r.index] = r.result;
        p.onProgress?.({ done: message.done, total: message.total, results: message.results });
        return;
      case 'done': {
        if (p.kind !== 'legs') return;
        pending.delete(message.id);
        p.cleanup();
        const out: NavLegResult[] = [];
        for (const r of p.results) {
          if (r === undefined) {
            p.reject(new NavWorkerError('internal', `request ${String(message.id)} finished without every result`));
            return;
          }
          out.push(r);
        }
        p.resolve(out);
        return;
      }
      case 'path-done':
        if (p.kind !== 'path') return;
        pending.delete(message.id);
        p.cleanup();
        p.resolve(message.path);
        return;
      case 'stats':
        if (p.kind !== 'stats') return;
        pending.delete(message.id);
        p.cleanup();
        p.resolve(message.stats);
        return;
      case 'failed':
        pending.delete(message.id);
        p.cleanup();
        p.reject(NavWorkerError.fromInfo(message.error));
        return;
    }
  };

  // The worker failed (it did not load, or it stopped on an uncaught error): it answers nothing
  // more, so every request fails with a runtime failure and the app falls back for every map.
  port.listen(onMessage, (text) => {
    failAll(new NavWorkerError('worker-failed', `navigation worker: ${text}`));
  });
  port.postMessage({ type: 'init', baseUrl: joinNavUrl(absoluteBase(options.baseUrl), NAV_DIRECTORY), manifest: options.manifest, ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }) });

  /** Registers a request, wires its signal, and posts it. */
  const start = <T>(signal: AbortSignal | undefined, make: (id: number, resolve: (value: T) => void, reject: (error: unknown) => void, cleanup: () => void) => Pending, request: (id: number) => NavRequest): Promise<T> => {
    if (broken !== null) return Promise.reject(broken);
    if (signal?.aborted === true) return Promise.reject(signal.reason as Error);
    const id = nextId;
    nextId += 1;
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        if (!pending.delete(id)) return;
        port.postMessage({ type: 'cancel', id });
        reject(signal?.reason as Error);
      };
      const cleanup = (): void => {
        signal?.removeEventListener('abort', onAbort);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      pending.set(id, make(id, resolve, reject, cleanup));
      port.postMessage(request(id));
    });
  };

  return {
    ready,
    legs(queries, opts = {}) {
      if (queries.length === 0 && broken === null) return Promise.resolve([]);
      return start<readonly NavLegResult[]>(
        opts.signal,
        (_id, resolve, reject, cleanup) => ({ kind: 'legs', results: new Array<NavLegResult | undefined>(queries.length).fill(undefined), onProgress: opts.onProgress, resolve, reject, cleanup }),
        (id) => ({ type: 'legs', id, queries, priority: opts.priority ?? 'interactive' }),
      );
    },
    path(query, opts = {}) {
      return start<readonly number[] | null>(
        opts.signal,
        (_id, resolve, reject, cleanup) => ({ kind: 'path', resolve, reject, cleanup }),
        (id) => ({ type: 'path', id, query }),
      );
    },
    stats() {
      return start<NavWorkerStats>(
        undefined,
        (_id, resolve, reject, cleanup) => ({ kind: 'stats', resolve, reject, cleanup }),
        (id) => ({ type: 'stats', id }),
      );
    },
    dispose() {
      failAll(new NavWorkerError('cancelled', 'the navigation worker was disposed'));
      port.terminate();
    },
  };
}
