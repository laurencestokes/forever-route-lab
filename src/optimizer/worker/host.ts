import { createSearch } from '../core';
import type { SearchOptions, SearchOutcome, SearchProblem, SearchSolution, Stepper } from '../types';
import type { FromWorker, ToWorker } from './protocol';

/**
 * The worker side of the optimiser protocol (protocol.ts; docs/research/optimizer-m7.md §8;
 * ARCHITECTURE §11.5), without the `Worker` global: `optimizer.worker.ts` binds it to `self`, and
 * the tests and the bench bind it to in-process or `worker_threads` ports.
 *
 * The worker owns the clock, and the clock only sizes slices:
 * - a run advances the core's stepper in slices of evaluations sized to about `sliceMs` (30 ms,
 *   within §11.5's 25-50 ms) from the injected `now()`, clamped to 256..1,000,000 evaluations and
 *   to four times the last slice;
 * - between slices it yields through `yieldToEventLoop` (a `MessageChannel` self-post in the
 *   worker: a nested `setTimeout` is clamped to 4 ms), so a `cancel` is read between two slices;
 * - `progress` goes at most every `progressMs` (100 ms: about 10 per second), `best` whenever the
 *   head of the solution list changes to another order at the same or a lower `comparedMs` (the
 *   figure solutions are ranked by, D-043 item 7), so the last `best` is the outcome's first
 *   solution, and `done` once with the outcome.
 *
 * The core's stepper resumes exactly where a slice stopped, so a run that ends by exhaustion or
 * `maxEvaluations` gives the same outcome whatever the slices were (§7.6). `maxMillis` and cancel
 * end a run between slices; a timed-out run is not reproducible.
 */

export interface OptimizerWorkerHostDeps {
  readonly post: (message: FromWorker) => void;
  /** Monotonic ms (`performance.now`); it sizes slices and enforces `maxMillis`, nothing else. */
  readonly now: () => number;
  readonly yieldToEventLoop: () => Promise<void>;
  /** The slice length aimed at, ms (default 30). */
  readonly sliceMs?: number;
  /** The least time between two `progress` messages, ms (default 100). */
  readonly progressMs?: number;
  /** Evaluations in a run's first slice (default 2,048). */
  readonly firstSlice?: number;
  /** Runs after every slice (the bench samples the worker heap here). */
  readonly sample?: () => void;
  /** The stepper factory (default: the core's `createSearch`). */
  readonly createSearch?: (problem: SearchProblem, options: SearchOptions) => Stepper;
}

export interface OptimizerWorkerHost {
  handle(message: ToWorker): void;
  /** The run in progress, or null (tests). */
  readonly activeRunId: number | null;
}

/** Slice bounds, in evaluations. */
export const MIN_SLICE = 256;
export const MAX_SLICE = 1_000_000;
export const DEFAULT_SLICE_MS = 30;
export const DEFAULT_PROGRESS_MS = 100;
export const DEFAULT_FIRST_SLICE = 2_048;

interface Run {
  readonly runId: number;
  readonly stepper: Stepper;
  readonly maxMillis: number | null;
  readonly startedAt: number;
  cancelled: boolean;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The next slice from the last one and how long it took: about `sliceMs`, growing at most fourfold. */
export function nextSlice(slice: number, elapsedMs: number, sliceMs: number): number {
  const target = elapsedMs > 0 ? Math.round((slice * sliceMs) / elapsedMs) : slice * 4;
  return Math.max(MIN_SLICE, Math.min(MAX_SLICE, slice * 4, target));
}

export function createOptimizerWorkerHost(deps: OptimizerWorkerHostDeps): OptimizerWorkerHost {
  const sliceMs = deps.sliceMs ?? DEFAULT_SLICE_MS;
  const progressMs = deps.progressMs ?? DEFAULT_PROGRESS_MS;
  const firstSlice = Math.max(1, Math.floor(deps.firstSlice ?? DEFAULT_FIRST_SLICE));
  const create = deps.createSearch ?? createSearch;
  let active: Run | null = null;

  const done = (run: Run, outcome: SearchOutcome): void => {
    if (active === run) active = null;
    deps.post({ type: 'done', runId: run.runId, outcome });
  };

  const fail = (run: Run, error: unknown): void => {
    if (active === run) active = null;
    deps.post({ type: 'error', runId: run.runId, message: messageOf(error) });
  };

  async function loop(run: Run): Promise<void> {
    let slice = firstSlice;
    let lastProgress = Number.NEGATIVE_INFINITY;
    let posted: SearchSolution | null = null;
    /** Whether `solution` is a new head: another order, at the same or a lower figure than the last posted. */
    const isNew = (solution: SearchSolution): boolean => {
      if (posted === null) return true;
      if (solution.comparedMs !== posted.comparedMs) return solution.comparedMs < posted.comparedMs;
      const a = solution.units;
      const b = posted.units;
      return a.length !== b.length || a.some((u, k) => u !== b[k]);
    };
    const postBest = (solution: SearchSolution): void => {
      posted = solution;
      deps.post({ type: 'best', runId: run.runId, solution });
    };
    for (;;) {
      // A later `start` replaced this run and has already answered for it.
      if (active !== run) return;
      if (run.cancelled) return done(run, run.stepper.finish('cancelled'));
      if (run.maxMillis !== null && deps.now() - run.startedAt >= run.maxMillis) return done(run, run.stepper.finish('timeout'));
      const before = deps.now();
      let result: ReturnType<Stepper['advance']>;
      try {
        result = run.stepper.advance(slice);
      } catch (error) {
        return fail(run, error);
      }
      const after = deps.now();
      deps.sample?.();
      if (result.done) {
        // The last slice's improvement is not in an advance result: send it before `done`.
        const head = result.outcome.solutions[0];
        if (head !== undefined && head.comparedMs < result.outcome.incumbent.comparedMs && isNew(head)) postBest(head);
        return done(run, result.outcome);
      }
      if (result.best !== null && isNew(result.best)) postBest(result.best);
      if (after - lastProgress >= progressMs) {
        lastProgress = after;
        deps.post({ type: 'progress', runId: run.runId, progress: result.progress });
      }
      slice = nextSlice(slice, after - before, sliceMs);
      await deps.yieldToEventLoop();
    }
  }

  function start(message: Extract<ToWorker, { type: 'start' }>): void {
    const previous = active;
    if (previous !== null) {
      // One run at a time: the replaced run is cancelled and answered now (its client ignores it).
      active = null;
      done(previous, previous.stepper.finish('cancelled'));
    }
    let stepper: Stepper;
    try {
      stepper = create(message.problem, message.options);
    } catch (error) {
      deps.post({ type: 'error', runId: message.runId, message: messageOf(error) });
      return;
    }
    const run: Run = { runId: message.runId, stepper, maxMillis: message.maxMillis, startedAt: deps.now(), cancelled: false };
    active = run;
    loop(run).catch((error: unknown) => {
      fail(run, error);
    });
  }

  return {
    get activeRunId() {
      return active?.runId ?? null;
    },
    handle(message) {
      switch (message.type) {
        case 'start':
          start(message);
          return;
        case 'cancel':
          // A cancel for a run that already ended (or never started) needs no answer: its `done` or `error` went.
          if (active !== null && active.runId === message.runId) active.cancelled = true;
          return;
      }
    },
  };
}
