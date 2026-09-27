import type { SearchOptions, SearchOutcome, SearchProblem, SearchProgress, SearchSolution } from '../types';

/**
 * The messages between the app and the optimiser worker (docs/research/optimizer-m7.md §8;
 * ARCHITECTURE §11.5 as amended by the plan's §17). Plain data and typed arrays only: every message
 * survives structured cloning, and `start` transfers the problem's typed-array buffers (copies the
 * compile made for the purpose, `CompiledProblem.transfer`).
 *
 * - `start` begins a run under a fresh `runId`. A `start` while another run is active cancels that
 *   run first (one run at a time; its `done` still comes, and the client ignores it as stale).
 * - `cancel` stops the run between two slices. The worker answers `done` with termination
 *   `cancelled`, which is the acknowledgement the client waits for (`cancelGraceMs`).
 * - `progress` comes at most every `progressMs` (about 10 per second), `best` whenever the head of
 *   the solution list improves, and `done` once, with the outcome. `error` ends a run that threw.
 *
 * Every message names its run, so the client can drop messages of runs it no longer waits for.
 */

export type ToWorker =
  | {
      readonly type: 'start';
      readonly runId: number;
      readonly problem: SearchProblem;
      readonly options: SearchOptions;
      /** A wall-clock limit the worker enforces between slices; a run it ends is not reproducible. */
      readonly maxMillis: number | null;
    }
  | { readonly type: 'cancel'; readonly runId: number };

export type FromWorker =
  | { readonly type: 'progress'; readonly runId: number; readonly progress: SearchProgress }
  | { readonly type: 'best'; readonly runId: number; readonly solution: SearchSolution }
  /** Termination `cancelled` acknowledges a `cancel` (or a `start` that replaced the run). */
  | { readonly type: 'done'; readonly runId: number; readonly outcome: SearchOutcome }
  | { readonly type: 'error'; readonly runId: number; readonly message: string };

/** The worker thread as the client uses it: `createModuleWorkerPort` wraps a real one, tests pass a fake. */
export interface OptimizerWorkerPort {
  postMessage(message: ToWorker, transfer: readonly ArrayBuffer[]): void;
  /** `onError` reports a worker that failed to load, stopped on an uncaught error, or sent an unreadable message. */
  listen(onMessage: (message: FromWorker) => void, onError: (message: string) => void): void;
  terminate(): void;
}

/** Timers for the client's cancel grace period (`setTimeout` by default; tests use manual ones). */
export interface OptimizerTimers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const defaultOptimizerTimers: OptimizerTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/** A failure of the worker itself, or of a run inside it (the message says which). */
export class OptimizerWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptimizerWorkerError';
  }
}
