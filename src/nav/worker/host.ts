import { NavManifestError, parseNavManifest } from '../manifest';
import { NavWorkerCore, type NavDigest, type NavFetch } from './core';
import { NavWorkerError, type NavErrorInfo, type NavRequest, type NavResponse } from './protocol';

/**
 * The worker side of the protocol (protocol.ts) around one `NavWorkerCore`, without the `Worker`
 * global: `nav.worker.ts` wires it to `self`, and the client tests wire it to an in-process fake.
 */

export interface NavWorkerHostDeps {
  readonly post: (message: NavResponse) => void;
  readonly fetch: NavFetch;
  /** `crypto.subtle`, or null where the worker has none (then nothing is loaded: `unsupported`). */
  readonly digest: NavDigest | null;
  readonly yieldToEventLoop?: () => Promise<void>;
  readonly sliceSettled?: number;
}

export interface NavWorkerHost {
  handle(message: NavRequest): void;
  /** The runtime after a successful `init` (tests). */
  readonly core: NavWorkerCore | null;
}

const infoOf = (error: unknown): NavErrorInfo =>
  error instanceof NavWorkerError ? error.toInfo() : { code: 'internal', message: error instanceof Error ? error.message : String(error) };

export function createNavWorkerHost(deps: NavWorkerHostDeps): NavWorkerHost {
  let core: NavWorkerCore | null = null;
  let initError: NavErrorInfo = { code: 'not-ready', message: 'the navigation worker has not been initialised' };

  const init = (message: Extract<NavRequest, { type: 'init' }>): void => {
    if (core !== null) {
      deps.post({ type: 'init-failed', error: { code: 'internal', message: 'the navigation worker is already initialised' } });
      return;
    }
    if (deps.digest === null) {
      initError = { code: 'unsupported', message: 'This browser cannot verify the navigation data: WebCrypto is only available on secure pages (https, or http on localhost).' };
      deps.post({ type: 'init-failed', error: initError });
      return;
    }
    try {
      const manifest = parseNavManifest(message.manifest);
      core = new NavWorkerCore({
        manifest,
        baseUrl: message.baseUrl,
        fetch: deps.fetch,
        digest: deps.digest,
        ...(message.maxBytes === undefined ? {} : { maxBytes: message.maxBytes }),
        ...(deps.sliceSettled === undefined ? {} : { sliceSettled: deps.sliceSettled }),
        ...(deps.yieldToEventLoop === undefined ? {} : { yieldToEventLoop: deps.yieldToEventLoop }),
      });
      deps.post({ type: 'ready', navRevision: manifest.navRevision });
    } catch (error) {
      initError = error instanceof NavManifestError ? { code: 'format', message: error.message } : infoOf(error);
      deps.post({ type: 'init-failed', error: initError });
    }
  };

  /** A request before a successful init fails with the init's error (`not-ready` when none came). */
  const notReady = (id: number): void => {
    deps.post({ type: 'failed', id, error: initError });
  };

  return {
    get core() {
      return core;
    },
    handle(message) {
      switch (message.type) {
        case 'init':
          init(message);
          return;
        case 'legs': {
          if (core === null) return notReady(message.id);
          const id = message.id;
          core
            .legs(id, message.queries, {
              priority: message.priority,
              onProgress: (done, total, results) => {
                deps.post({ type: 'progress', id, done, total, results });
              },
            })
            .then(
              () => {
                deps.post({ type: 'done', id });
              },
              (error: unknown) => {
                deps.post({ type: 'failed', id, error: infoOf(error) });
              },
            );
          return;
        }
        case 'path': {
          if (core === null) return notReady(message.id);
          const id = message.id;
          core.path(id, message.query).then(
            (path) => {
              deps.post({ type: 'path-done', id, path });
            },
            (error: unknown) => {
              deps.post({ type: 'failed', id, error: infoOf(error) });
            },
          );
          return;
        }
        case 'cancel':
          core?.cancel(message.id);
          return;
        case 'stats':
          if (core === null) return notReady(message.id);
          deps.post({ type: 'stats', id: message.id, stats: core.stats() });
          return;
      }
    },
  };
}
