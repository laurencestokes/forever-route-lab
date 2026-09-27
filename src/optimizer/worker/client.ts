import type { CompiledProblem, SearchOptions, SearchOutcome, SearchProgress, SearchSolution, SearchStats } from '../types';
import { defaultOptimizerTimers, type FromWorker, type OptimizerTimers, OptimizerWorkerError, type OptimizerWorkerPort } from './protocol';

/**
 * The main-thread side of the optimiser worker (docs/research/optimizer-m7.md §8; ARCHITECTURE
 * §11.5). It starts `optimizer.worker.ts` as a module worker in its own chunk (the
 * `new Worker(new URL(...), { type: 'module' })` form Vite bundles) when the first run needs it,
 * and turns runs into promises:
 *
 * - `run` posts `start` under a fresh `runId`, transferring the problem's typed-array copies
 *   (`CompiledProblem.transfer`: after the post the main thread's problem is unusable; the decode
 *   table stays). One run at a time: a new run stops the previous one first.
 * - Messages of any run but the current one are ignored (stale runs).
 * - `cancel()` posts `cancel` and waits `cancelGraceMs` (1,000 ms) for the worker's `done`, which
 *   acknowledges it. Without it, the client terminates the worker, resolves the run as stopped
 *   with the last progress's counts, and starts a new worker for the next run. A new run while a
 *   cancel still waits for its acknowledgement terminates that worker first, so the new run never
 *   waits behind a stuck slice; a `start` that cannot be posted cancels the run it replaced.
 * - A worker that fails to load, stops on an error, or sends a message that cannot be read rejects
 *   the run with an `OptimizerWorkerError`, and the next run starts a new worker. A run the worker
 *   reports as failed (`error`) rejects the same way; that worker is kept.
 */

/** A run the client stopped without the worker's outcome. */
export interface StoppedRun {
  readonly termination: 'cancelled';
  /** `terminated`: the cancel was not acknowledged in time; `superseded`: a new run replaced it; `disposed`. */
  readonly stopped: 'terminated' | 'superseded' | 'disposed';
  /** Counts from the last progress message (the others are 0: the worker's own stats never arrived). */
  readonly stats: SearchStats;
  /** The best solution the worker had sent, if any. */
  readonly best: SearchSolution | null;
}

export type WorkerRunResult = SearchOutcome | StoppedRun;

export const isStoppedRun = (result: WorkerRunResult): result is StoppedRun => 'stopped' in result;

export type WorkerRunOptions = SearchOptions & { readonly maxMillis: number | null };

export interface WorkerRunHandlers {
  readonly onProgress?: (progress: SearchProgress) => void;
  readonly onBest?: (solution: SearchSolution) => void;
}

export interface OptimizerWorkerRun {
  readonly runId: number;
  readonly result: Promise<WorkerRunResult>;
  cancel(): void;
}

export interface OptimizerWorkerClient {
  run(compiled: Pick<CompiledProblem, 'problem' | 'transfer'>, options: WorkerRunOptions, handlers?: WorkerRunHandlers): OptimizerWorkerRun;
  /** Terminates the worker; a run in progress resolves as stopped (`disposed`), and later runs reject. */
  dispose(): void;
  /** Workers started so far (tests). */
  readonly workersStarted: number;
}

export interface OptimizerWorkerClientOptions {
  /** Starts a worker (default: `createModuleWorkerPort`). */
  readonly createPort?: () => OptimizerWorkerPort;
  /** How long a cancel may go unacknowledged before the worker is terminated (default 1,000 ms). */
  readonly cancelGraceMs?: number;
  readonly timers?: OptimizerTimers;
}

export const DEFAULT_CANCEL_GRACE_MS = 1_000;

/** An `OptimizerWorkerPort` over a new module worker running optimizer.worker.ts. */
export function createModuleWorkerPort(): OptimizerWorkerPort {
  const worker = new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module', name: 'optimizer' });
  return {
    postMessage(message, transfer) {
      worker.postMessage(message, [...transfer]);
    },
    listen(onMessage, onError) {
      worker.onmessage = (event: MessageEvent<FromWorker>) => {
        onMessage(event.data);
      };
      worker.onerror = (event: Event) => {
        // A script that fails to load fires a plain Event (no message); an uncaught error an ErrorEvent.
        const message: unknown = (event as Partial<ErrorEvent>).message;
        onError(typeof message === 'string' && message !== '' ? message : 'the optimiser worker failed to start');
      };
      worker.onmessageerror = () => {
        onError('a message from the optimiser worker could not be read');
      };
    },
    terminate() {
      worker.terminate();
    },
  };
}

interface Current {
  readonly runId: number;
  readonly handlers: WorkerRunHandlers;
  readonly resolve: (result: WorkerRunResult) => void;
  readonly reject: (error: unknown) => void;
  progress: SearchProgress | null;
  best: SearchSolution | null;
  cancelled: boolean;
  grace: unknown;
}

const statsOf = (progress: SearchProgress | null): SearchStats => ({
  evaluations: progress?.evaluations ?? 0,
  layers: progress?.layer ?? 0,
  duplicates: 0,
  dominated: 0,
  rollouts: 0,
  firstImprovementEvaluations: null,
  arrayBytes: 0,
});

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createOptimizerWorkerClient(options: OptimizerWorkerClientOptions = {}): OptimizerWorkerClient {
  const createPort = options.createPort ?? createModuleWorkerPort;
  const cancelGraceMs = options.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS;
  const timers = options.timers ?? defaultOptimizerTimers;
  let port: OptimizerWorkerPort | null = null;
  let current: Current | null = null;
  let nextRunId = 1;
  let started = 0;
  let disposed = false;

  const settle = (run: Current): void => {
    if (current === run) current = null;
    if (run.grace !== null) timers.clear(run.grace);
    run.grace = null;
  };

  const stop = (run: Current, why: StoppedRun['stopped']): void => {
    settle(run);
    run.resolve({ termination: 'cancelled', stopped: why, stats: statsOf(run.progress), best: run.best });
  };

  /** Forgets a worker that failed or was terminated; the next run starts a new one. */
  const drop = (which: OptimizerWorkerPort): void => {
    if (port !== which) return;
    port = null;
    try {
      which.terminate();
    } catch {
      // A worker that cannot be terminated is gone anyway.
    }
  };

  const onMessage = (which: OptimizerWorkerPort, message: FromWorker): void => {
    const run = current;
    // A worker already replaced, or a run no longer waited for: stale.
    if (port !== which || run?.runId !== message.runId) return;
    switch (message.type) {
      case 'progress':
        run.progress = message.progress;
        run.handlers.onProgress?.(message.progress);
        return;
      case 'best':
        run.best = message.solution;
        run.handlers.onBest?.(message.solution);
        return;
      case 'done':
        settle(run);
        run.resolve(message.outcome);
        return;
      case 'error':
        settle(run);
        run.reject(new OptimizerWorkerError(`the optimiser failed: ${message.message}`));
        return;
    }
  };

  const onError = (which: OptimizerWorkerPort, text: string): void => {
    if (port !== which) return;
    drop(which);
    const run = current;
    if (run === null) return;
    settle(run);
    run.reject(new OptimizerWorkerError(`optimiser worker: ${text}`));
  };

  const ensurePort = (): OptimizerWorkerPort => {
    if (port !== null) return port;
    const made = createPort();
    started += 1;
    port = made;
    made.listen(
      (message) => {
        onMessage(made, message);
      },
      (text) => {
        onError(made, text);
      },
    );
    return made;
  };

  return {
    get workersStarted() {
      return started;
    },

    run(compiled, runOptions, handlers = {}) {
      const runId = nextRunId;
      nextRunId += 1;
      if (disposed) return { runId, result: Promise.reject(new OptimizerWorkerError('the optimiser worker was disposed')), cancel: () => undefined };
      const superseded = current;
      /** The worker the superseded run was on, while it still has it. */
      let supersededPort: OptimizerWorkerPort | null = null;
      if (superseded !== null) {
        // One run at a time: the worker cancels the old run on `start`, and its answer is stale. A
        // cancel still unacknowledged means the worker may be stuck in a slice: stopping the run
        // clears its grace timer, so the worker is terminated now and the new run gets a fresh one
        // (§11.5; review RTD-02).
        if (superseded.cancelled && superseded.grace !== null && port !== null) drop(port);
        supersededPort = port;
        stop(superseded, 'superseded');
      }
      let resolveRun: (value: WorkerRunResult) => void = () => undefined;
      let rejectRun: (error: unknown) => void = () => undefined;
      const result = new Promise<WorkerRunResult>((resolve, reject) => {
        resolveRun = resolve;
        rejectRun = reject;
      });
      const state: Current = { runId, handlers, resolve: resolveRun, reject: rejectRun, progress: null, best: null, cancelled: false, grace: null };
      current = state;
      const { maxMillis, ...search } = runOptions;
      try {
        ensurePort().postMessage({ type: 'start', runId, problem: compiled.problem, options: search, maxMillis }, compiled.transfer);
      } catch (error) {
        settle(state);
        state.reject(new OptimizerWorkerError(`the optimiser run could not start: ${messageOf(error)}`));
        // That worker never saw this `start`, so nothing stopped the run it replaced: cancel that run
        // there, or drop the worker if it cannot take even that (review RTD-02).
        if (superseded !== null && supersededPort !== null && port === supersededPort) {
          try {
            supersededPort.postMessage({ type: 'cancel', runId: superseded.runId }, []);
          } catch {
            drop(supersededPort);
          }
        }
      }
      return {
        runId,
        result,
        cancel() {
          if (current !== state || state.cancelled) return;
          state.cancelled = true;
          const which = port;
          if (which === null) return stop(state, 'terminated');
          try {
            which.postMessage({ type: 'cancel', runId }, []);
          } catch {
            drop(which);
            return stop(state, 'terminated');
          }
          state.grace = timers.set(() => {
            state.grace = null;
            if (current !== state) return;
            // Not acknowledged in time: the worker is stuck in a slice (or gone). Stop it and start afresh next run.
            drop(which);
            stop(state, 'terminated');
          }, cancelGraceMs);
        },
      };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (current !== null) stop(current, 'disposed');
      if (port !== null) drop(port);
    },
  };
}
