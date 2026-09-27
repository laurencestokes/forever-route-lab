import { compileProblem, decodeSolution, DEFAULT_SEARCH_OPTIONS } from './core';
import type {
  CompiledProblem,
  Optimizer,
  OptimizationOptions,
  OptimizationProgress,
  OptimizationRequest,
  OptimizerRun,
  SearchedSection,
  SearchOutcome,
  SearchProgress,
  SearchSolution,
  SearchStats,
  SearchTermination,
} from './types';
import { createOptimizerWorkerClient, isStoppedRun } from './worker/client';
import type { OptimizerTimers, OptimizerWorkerPort } from './worker/protocol';

/**
 * `src/optimizer` (docs/research/optimizer-m7.md §8, §11; ARCHITECTURE §11.1 as amended by the
 * plan's §17): the TypeScript beam-search optimiser behind the `Optimizer` interface. The app loads
 * this module lazily (a dynamic `import()`), and the worker is a module worker in a chunk of its own.
 *
 * `optimize` covers the phases `compiling` and `searching`: it compiles the section on the main
 * thread from the app's analysis and baseline walk (analyse + compile ≤ 30 ms, §14), transfers the
 * problem to the worker, relays its progress, and decodes up to four solutions better than the
 * incumbent into candidate steps with their step dependencies. The app runs `paths` before and
 * `finishing` (the engine and validator re-walk of each candidate) after.
 *
 * The results are the best route found under these assumptions, never "optimal".
 */

export * from './types';
export type { OptimizerTimers, OptimizerWorkerPort } from './worker/protocol';
export { createMatrixCache } from './core';

export interface TypeScriptBeamSearchOptimizerOptions {
  /** Starts a worker (default: a module worker running `optimizer.worker.ts`). */
  readonly createPort?: () => OptimizerWorkerPort;
  /** How long a cancel may go unacknowledged before the worker is terminated (default 1,000 ms). */
  readonly cancelGraceMs?: number;
  readonly timers?: OptimizerTimers;
  /** Monotonic ms for `OptimizationProgress.elapsedMs` and the progress throttle (default `performance.now`). */
  readonly now?: () => number;
  /**
   * The least time between two `searching` progress emits, ms (default 100: about 10 per second,
   * §11.5). The worker's `progress` and `best` are folded into one throttled stream; phase changes,
   * the first improvement and the final counts are emitted at once.
   */
  readonly progressMs?: number;
}

/** §11.5: progress about 10 times a second. */
export const DEFAULT_PROGRESS_MS = 100;

export const EMPTY_SEARCH_STATS: SearchStats = {
  evaluations: 0,
  layers: 0,
  duplicates: 0,
  dominated: 0,
  rollouts: 0,
  firstImprovementEvaluations: null,
  arrayBytes: 0,
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const sameUnits = (a: Int32Array, b: Int32Array): boolean => a.length === b.length && a.every((u, k) => u === b[k]);

/** Checks the run options before anything is compiled. */
function optionsProblem(options: OptimizationOptions): string | null {
  if (!Number.isInteger(options.beamWidth) || options.beamWidth < 1) return `beam width ${String(options.beamWidth)} is not a whole number of at least 1`;
  if (!Number.isInteger(options.maxEvaluations) || options.maxEvaluations < 0) return `maxEvaluations ${String(options.maxEvaluations)} is not a whole number of at least 0`;
  if (options.maxMillis !== null && !(Number.isFinite(options.maxMillis) && options.maxMillis >= 0)) return `maxMillis ${String(options.maxMillis)} is not a number of at least 0`;
  if (!(Number.isFinite(options.divergencePenalty) && options.divergencePenalty >= 0)) return `the divergence penalty ${String(options.divergencePenalty)} is not a number of at least 0`;
  return null;
}

export function createTypeScriptBeamSearchOptimizer(options: TypeScriptBeamSearchOptimizerOptions = {}): Optimizer {
  const client = createOptimizerWorkerClient({
    ...(options.createPort === undefined ? {} : { createPort: options.createPort }),
    ...(options.cancelGraceMs === undefined ? {} : { cancelGraceMs: options.cancelGraceMs }),
    ...(options.timers === undefined ? {} : { timers: options.timers }),
  });
  const now = options.now ?? (() => performance.now());
  const progressMs = options.progressMs ?? DEFAULT_PROGRESS_MS;

  return {
    optimize(request: OptimizationRequest, runOptions: OptimizationOptions, context, ids): OptimizerRun<SearchedSection> {
      const listeners = new Set<(progress: OptimizationProgress) => void>();
      const started = now();
      const incumbentSeconds = context.analysis.summary.original.sectionPlusExitMs / 1000;
      let cancelled = false;
      let cancelSearch: (() => void) | null = null;
      let last: OptimizationProgress = {
        phase: 'compiling',
        depth: 0,
        evaluations: 0,
        beamSize: 0,
        incumbentSeconds,
        bestSeconds: null,
        elapsedMs: 0,
        legs: null,
      };
      let lastEmitAt = Number.NEGATIVE_INFINITY;
      /** A patch held back by the throttle; the next emit carries it. */
      let held: Partial<OptimizationProgress> | null = null;
      const emit = (patch: Partial<OptimizationProgress>): void => {
        const at = now();
        last = { ...last, ...held, ...patch, elapsedMs: at - started };
        held = null;
        lastEmitAt = at;
        for (const listener of [...listeners]) listener(last);
      };
      /** The worker's `progress` and `best` (review RTD-08): at most one emit every `progressMs`, the rest folded into the next. */
      const emitThrottled = (patch: Partial<OptimizationProgress>, immediate = false): void => {
        if (!immediate && now() - lastEmitAt < progressMs) {
          held = { ...held, ...patch };
          return;
        }
        emit(patch);
      };
      const fromSearch = (p: SearchProgress): Partial<OptimizationProgress> => ({
        phase: 'searching',
        depth: p.layer,
        evaluations: p.evaluations,
        beamSize: p.beamSize,
        incumbentSeconds: p.incumbentMs / 1000,
        bestSeconds: p.bestMs === null || p.bestMs >= p.incumbentMs ? null : p.bestMs / 1000,
      });

      const decode = (compiled: CompiledProblem, outcome: SearchOutcome, termination: Exclude<SearchTermination, 'cancelled'>): SearchedSection => {
        const incumbent = outcome.incumbent;
        const better = outcome.solutions.filter((s: SearchSolution) => s.estimatedMs < incumbent.estimatedMs && !sameUnits(s.units, incumbent.units));
        const candidates = better.map((solution) => {
          const decoded = decodeSolution(compiled.decode, solution, ids);
          return { steps: decoded.steps, dependencies: decoded.dependencies, solution };
        });
        // After the candidates, so a fill in the incumbent never shifts their new steps' ids.
        const decodedIncumbent = decodeSolution(compiled.decode, incumbent, ids);
        return {
          status: 'searched',
          termination,
          reproducible: termination !== 'timeout',
          candidates,
          incumbent,
          incumbentSection: { steps: decodedIncumbent.steps, dependencies: decodedIncumbent.dependencies },
          unknownXpBlocked: outcome.unknownXpBlocked,
          summary: compiled.summary,
          stats: outcome.stats,
        };
      };

      const search = async (): Promise<SearchedSection> => {
        // Let the caller subscribe to progress first: nothing runs in the `optimize` call itself.
        await Promise.resolve();
        if (cancelled) return { status: 'cancelled', stats: EMPTY_SEARCH_STATS };
        if (request.scope.allowNewQuests) return { status: 'failed', reason: 'adding quests is not available yet', stats: EMPTY_SEARCH_STATS };
        const invalid = optionsProblem(runOptions);
        if (invalid !== null) return { status: 'failed', reason: invalid, stats: EMPTY_SEARCH_STATS };
        emit({ phase: 'compiling' });
        let compiled: ReturnType<typeof compileProblem>;
        try {
          compiled = compileProblem(context.analysis, context.baseline, context.cache === undefined ? {} : { cache: context.cache });
        } catch (error) {
          return { status: 'failed', reason: `the section could not be compiled: ${messageOf(error)}`, stats: EMPTY_SEARCH_STATS };
        }
        if (!compiled.ok) return { status: compiled.status, reason: compiled.reason, stats: EMPTY_SEARCH_STATS };
        const problem = compiled;
        emit({ phase: 'searching', incumbentSeconds: problem.stats.incumbentMs / 1000 });
        if (cancelled) return { status: 'cancelled', stats: EMPTY_SEARCH_STATS };
        const run = client.run(
          problem,
          { ...DEFAULT_SEARCH_OPTIONS, beamWidth: runOptions.beamWidth, maxEvaluations: runOptions.maxEvaluations, divergencePenalty: runOptions.divergencePenalty, maxMillis: runOptions.maxMillis },
          {
            onProgress: (p) => {
              emitThrottled(fromSearch(p));
            },
            onBest: (solution) => {
              // The first improvement is shown at once; later ones ride the throttled stream.
              if (solution.estimatedMs < problem.stats.incumbentMs) emitThrottled({ phase: 'searching', bestSeconds: solution.estimatedMs / 1000 }, (held?.bestSeconds ?? last.bestSeconds) === null);
            },
          },
        );
        cancelSearch = () => {
          run.cancel();
        };
        let result: Awaited<typeof run.result>;
        try {
          result = await run.result;
        } catch (error) {
          return { status: 'failed', reason: messageOf(error), stats: EMPTY_SEARCH_STATS };
        } finally {
          cancelSearch = null;
        }
        if (isStoppedRun(result)) return { status: 'cancelled', stats: result.stats };
        // A cancel asked for is honoured even when the run ended first.
        const termination = result.termination;
        if (cancelled || termination === 'cancelled') return { status: 'cancelled', stats: result.stats };
        emit({ phase: 'searching', evaluations: result.stats.evaluations, depth: result.stats.layers });
        return decode(problem, result, termination);
      };

      const result = search();
      return {
        result,
        cancel() {
          cancelled = true;
          cancelSearch?.();
        },
        onProgress(cb) {
          listeners.add(cb);
          return () => {
            listeners.delete(cb);
          };
        },
      };
    },
    dispose() {
      client.dispose();
    },
  };
}
