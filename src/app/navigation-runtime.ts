import type { Sha256Digest } from '../infra/hash';
import type { FetchLike } from '../infra/http';
import { loadNavManifest, type NavManifestState, type NavUnavailableReason } from '../infra/nav';
import type { NavManifest } from '../nav/manifest';
import { createNavWorkerClient } from '../nav/worker/client';
import { NavigationLegTable, NavigationPathCache } from './navigation-legs';
import { createNavigationScheduler, defaultNavTimers, type NavigationScheduler, type NavLegService, type NavTimers } from './navigation-scheduler';

/**
 * Starts terrain navigation for the app (terrain-navigation.md §9.2, §9.6; ARCHITECTURE §9.1):
 * loads and checks `nav/manifest.json` through `src/infra/nav`, and when it is available starts the
 * navigation worker (its own chunk) and creates the leg table, the path cache and the scheduler
 * that keeps them filled. Navigation is optional: every failure to start is a typed "unavailable"
 * state with a reason in words, and the app then keeps the straight-line model.
 */

/** The parts of navigation shared by every travel model the app builds (one per rules and graph). */
export interface NavigationRuntime {
  readonly manifest: NavManifest;
  readonly table: NavigationLegTable;
  readonly paths: NavigationPathCache;
  readonly scheduler: NavigationScheduler;
  /** Stops the scheduler and the worker. */
  dispose(): void;
}

export type NavigationState =
  /** The manifest is still loading: the straight-line model is used meanwhile, and results are not final. */
  | { readonly kind: 'checking' }
  | { readonly kind: 'available'; readonly runtime: NavigationRuntime }
  /** No navigation (the reason in words): the straight-line model, for good. */
  | { readonly kind: 'unavailable'; readonly reason: string };

export const NAVIGATION_CHECKING: NavigationState = { kind: 'checking' };

/** A leg service the runtime can stop (the worker client). */
export interface DisposableNavLegService extends NavLegService {
  /**
   * Resolves with the navRevision the worker read once it has started; rejects when it could not
   * start (the worker client's `ready`). A service without one counts as started.
   */
  readonly ready?: Promise<string>;
  dispose(): void;
}

/** How long the worker may take to start before navigation is given up for the session (default). */
export const NAV_WORKER_START_TIMEOUT_MS = 20_000;

export interface StartNavigationOptions {
  readonly fetch: FetchLike;
  /** `import.meta.env.BASE_URL`. */
  readonly baseUrl: string;
  readonly sha256: Sha256Digest | null;
  readonly signal?: AbortSignal | undefined;
  /**
   * Starts the worker for a loaded manifest; default: `createNavWorkerClient` (a module worker).
   * Tests pass a fake. Returning null means workers are unavailable.
   */
  readonly createService?: ((manifest: { readonly json: unknown; readonly baseUrl: string }) => DisposableNavLegService | null) | undefined;
  readonly timers?: NavTimers | undefined;
  /** How long the worker may take to answer `ready` (default `NAV_WORKER_START_TIMEOUT_MS`). */
  readonly startTimeoutMs?: number | undefined;
}

const REASONS: Readonly<Record<NavUnavailableReason, string>> = {
  unsupported: 'this browser cannot verify the navigation data (no WebCrypto: open the site over https)',
  'not-found': 'this deploy has no navigation data',
  unreachable: 'the navigation data could not be loaded',
  'not-json': 'the navigation data is not in the expected format',
  invalid: 'the navigation data is not in the expected format',
  integrity: 'the navigation data failed its integrity check',
};

/** Why navigation is off, in words, for an unavailable manifest state. */
export function describeNavUnavailable(state: Extract<NavManifestState, { kind: 'unavailable' }>): string {
  return REASONS[state.reason];
}

const defaultService: NonNullable<StartNavigationOptions['createService']> = ({ json, baseUrl }) => {
  if (typeof Worker === 'undefined') return null;
  return createNavWorkerClient({ baseUrl, manifest: json });
};

/** The runtime over a service; exported for tests that drive a fake worker. */
export function createNavigationRuntime(manifest: NavManifest, service: DisposableNavLegService, timers?: NavTimers): NavigationRuntime {
  const table = new NavigationLegTable(manifest.navRevision);
  const paths = new NavigationPathCache();
  const scheduler = createNavigationScheduler({ service, table, paths, ...(timers === undefined ? {} : { timers }) });
  return {
    manifest,
    table,
    paths,
    scheduler,
    dispose() {
      scheduler.dispose();
      service.dispose();
    },
  };
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Waits for the service's `ready` within `ms`: null when it started, else why not in words.
 * Rejects only when `signal` aborts.
 */
function awaitStarted(service: DisposableNavLegService, navRevision: string, ms: number, timers: NavTimers, signal: AbortSignal | undefined): Promise<string | null> {
  const ready = service.ready;
  if (ready === undefined) return Promise.resolve(null);
  return new Promise<string | null>((resolve, reject) => {
    let settled = false;
    const finish = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      timers.clear(timer);
      signal?.removeEventListener('abort', onAbort);
      outcome();
    };
    const onAbort = (): void => {
      finish(() => {
        reject(signal?.reason as Error);
      });
    };
    const timer = timers.set(() => {
      finish(() => {
        resolve(`the navigation worker did not start within ${String(Math.round(ms / 1000))} s`);
      });
    }, ms);
    if (signal?.aborted === true) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    ready.then(
      (revision) => {
        finish(() => {
          resolve(revision === navRevision ? null : 'the navigation worker read different navigation data than the page');
        });
      },
      (error: unknown) => {
        finish(() => {
          resolve(`the navigation worker could not start (${messageOf(error)})`);
        });
      },
    );
  });
}

/**
 * Loads the manifest and starts the runtime once the worker has answered that it is ready. Never
 * rejects except on abort: an unavailable manifest, a browser without module workers, and a worker
 * that fails to start or does not start within `startTimeoutMs` resolve to `unavailable` with the
 * reason (the worker is then stopped).
 */
export async function startNavigation(options: StartNavigationOptions): Promise<NavigationState> {
  const state = await loadNavManifest({ fetch: options.fetch, baseUrl: options.baseUrl, sha256: options.sha256, signal: options.signal });
  if (state.kind === 'unavailable') return { kind: 'unavailable', reason: describeNavUnavailable(state) };
  let service: DisposableNavLegService | null;
  try {
    service = (options.createService ?? defaultService)({ json: state.json, baseUrl: options.baseUrl });
  } catch (error) {
    return { kind: 'unavailable', reason: `the navigation worker could not start (${messageOf(error)})` };
  }
  if (service === null) return { kind: 'unavailable', reason: 'this browser cannot run the navigation worker' };
  let failure: string | null;
  try {
    failure = await awaitStarted(service, state.manifest.navRevision, options.startTimeoutMs ?? NAV_WORKER_START_TIMEOUT_MS, options.timers ?? defaultNavTimers, options.signal);
  } catch (error) {
    service.dispose();
    throw error;
  }
  if (failure !== null) {
    service.dispose();
    return { kind: 'unavailable', reason: failure };
  }
  return { kind: 'available', runtime: createNavigationRuntime(state.manifest, service, options.timers) };
}
