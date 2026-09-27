import type { IdSource, QuestId, StepId } from '../domain/ids';
import type { RouteStep } from '../domain/route';
import { type RouteDiff, stepQuestIds } from '../diff';
import { analyseSection } from '../optimizer/core';
import type { AnalysisInternal } from '../optimizer/core/section';
import {
  type CompileInput,
  type ContractSummary,
  DEFAULT_OPTIMIZATION_OPTIONS,
  type MatrixCache,
  type OptimizationOptions,
  type OptimizationProgress,
  type OptimizationRequest,
  type Optimizer,
  type OptimizerRun,
  type SearchedSection,
  type SearchOutcome,
  type SearchStats,
  type SearchTermination,
  type StepDependency,
} from '../optimizer/types';

type SearchedUnknownXpBlocked = SearchOutcome['unknownXpBlocked'];
import type { OptimizationHost } from './optimizer-host';
import { keyedMatrixCache } from './optimizer-host';
import { proposalDiff } from './optimizer-proposal';
import { type BaselineWalk, verifyCandidate, type VerificationReport } from './optimizer-verify';
import { createRunWalker, sectionStart, walkSection } from './optimizer-walk';
import type { EditLockReason, EditorStore } from './store';

/**
 * An optimiser run from the app (docs/research/optimizer-m7.md §9; ARCHITECTURE §11.1, §12.1):
 *
 * 1. **Checks.** The host's revision and the editor's must both be the request's, no optimiser run
 *    or proposal may hold the edit lock, `allowNewQuests` is refused (stage 2), and the section
 *    must be in the route. The `'optimizer'` edit lock is taken for the run and released when it
 *    ends (or handed to `'proposal'` in the same task, `handOver`), even when a store subscriber
 *    throws (review RTD-03).
 * 2. **`paths` ("computing paths").** The run's own validator and walker walk the project once
 *    (the analysis walk), `analyseSection` lists the legs the section's matrix needs, and the host
 *    makes them complete through the navigation scheduler, with leg progress (in the scheduler's
 *    unit, legs still needed; 0 of 0 when none is) and cancel.
 * 3. **`compiling`.** The baseline re-walk from the cast window with the probe; a section whose
 *    legs are still pending is refused (SIMULATION §6); then the optimiser compiles.
 * 4. **`searching`.** The optimiser's worker; its progress and improvements are relayed.
 * 5. **`finishing`.** When a numeric target is above the original's known gain, the incumbent the
 *    search used (the original plus the grind fill the target needs) is re-walked first. Each
 *    candidate is re-walked and verified in order (`verifyCandidate`) against that incumbent; the
 *    first that passes is the result, with its diff against the route. None passing gives
 *    `no-improvement`: the incumbent, with the rejected reports (review PAR-05).
 *
 * The main-thread phases yield a macrotask between them (after the prefix replay, after the analysis
 * walk, after the baseline walk, between verifications), so progress paints and a cancel is read
 * (review RTD-05). The prefix replay is done once and shared by both walks.
 *
 * Nothing here is in the entry chunk: Milestone 8 imports this module with a dynamic `import()`, and
 * the optimiser (`src/optimizer/index.ts`) with its worker is a chunk of its own.
 *
 * The UI and every document say "best route found under these assumptions", never "optimal".
 */

export interface OptimizationTiming {
  readonly analysisWalkMs: number;
  /** `analyseSection`. */
  readonly analyseMs: number;
  /** "Computing paths". */
  readonly pathsMs: number;
  readonly baselineWalkMs: number;
  /** From the optimiser's start to its search starting: compile on the main thread and the transfer. */
  readonly compileMs: number;
  readonly searchMs: number;
  readonly verifyMs: number;
}

export interface OptimizationEstimate {
  /** The optimiser's estimate of the original section plus exit chain, ms. */
  readonly incumbentMs: number;
  /** Its estimate of the result. */
  readonly resultMs: number;
  /** The re-walk's section plus exit chain of the result (§6.3's engine side). */
  readonly engineMs: number;
  /** The baseline walk's, for the original. */
  readonly originalMs: number;
  /** Known XP the result's units gain (before a fill). */
  readonly knownGain: number;
  readonly targetXp: number;
}

export type OptimizationResult =
  | {
      readonly status: 'improved' | 'no-improvement';
      readonly termination: Exclude<SearchTermination, 'cancelled'>;
      /** False when `maxMillis` ended the search. */
      readonly reproducible: boolean;
      /**
       * The section's steps: the verified candidate's when improved; else the incumbent's, which is
       * the original, plus the grind fill a numeric target needs when the original misses it.
       * `estimate.resultMs` and `estimate.engineMs` describe these steps.
       */
      readonly steps: readonly RouteStep[];
      /** The whole route with them. */
      readonly route: readonly RouteStep[];
      /** The route diff (no ops for `no-improvement`, unless the incumbent has a fill: then its addition). */
      readonly diff: RouteDiff;
      readonly dependencies: readonly StepDependency[];
      /**
       * Quests with unknown XP (kept), and what the result's unknowns mean: unknown XP turned in,
       * unknown time, and objective work carried to a turn-in whose travel is not priced (D-040).
       */
      readonly unknowns: { readonly quests: readonly QuestId[]; readonly note: string };
      readonly estimate: OptimizationEstimate;
      /**
       * The passing candidate's report (improved); for `no-improvement` with a fill, the incumbent's
       * re-walk (every rule but `improvement`); otherwise null.
       */
      readonly verification: VerificationReport | null;
      /** Reports of the candidates that failed verification, in order. */
      readonly rejected: readonly VerificationReport[];
      readonly summary: ContractSummary;
      /** The section's anchors (locked and implicit): the diff's fixed steps. */
      readonly anchors: ReadonlySet<StepId>;
      /**
       * Re-walks and verifies a whole route that differs from the original only inside the section
       * (Milestone 8's "Apply selected changes": `applyChangeSets(route, diff, selected)`), on the
       * run's private walker against its baseline, with the parity rule skipped.
       */
      readonly verifyRoute: (route: readonly RouteStep[]) => VerificationReport;
      readonly stats: SearchStats;
      readonly timing: OptimizationTiming;
    }
  | { readonly status: 'cancelled'; readonly stats: SearchStats; readonly timing: OptimizationTiming }
  | { readonly status: 'infeasible' | 'failed'; readonly reason: string; readonly stats: SearchStats; readonly timing: OptimizationTiming };

/** What the proposal UI subscribes to (Milestone 8). */
export type OptimizerUiState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly runId: number; readonly progress: OptimizationProgress }
  | { readonly status: 'finished'; readonly runId: number; readonly result: OptimizationResult };

export interface OptimizationRunDeps {
  readonly host: OptimizationHost;
  readonly store: Pick<EditorStore, 'getState' | 'acquireLock' | 'releaseLock'>;
  readonly optimizer: Optimizer;
  /** Ids for new steps (the grind fill). */
  readonly ids: IdSource;
  /** A matrix cache the app keeps across runs (§5.3); keyed with the host's `cacheKey`. */
  readonly cache?: MatrixCache;
  /** `'proposal'`: an improved run takes the proposal lock before it releases its own (review OP-19). */
  readonly handOver?: 'proposal';
  /** Monotonic ms for timings and progress (default `performance.now`). */
  readonly now?: () => number;
  /** Yields a macrotask between the long main-thread phases (default `yieldMacrotask`). */
  readonly yieldToEventLoop?: () => Promise<void>;
}

/**
 * Yields to the event loop for one macrotask, so a paint and a click can happen: a `MessageChannel`
 * post (a nested `setTimeout` is clamped to 4 ms), or `setTimeout` where there is none.
 */
export function yieldMacrotask(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

const EMPTY_STATS: SearchStats = { evaluations: 0, layers: 0, duplicates: 0, dominated: 0, rollouts: 0, firstImprovementEvaluations: null, arrayBytes: 0 };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The section's anchor steps (locked and implicit), from compile's structure (the decode table's `fixed`). */
export function sectionAnchors(analysis: { readonly internal: unknown }, steps: readonly RouteStep[]): ReadonlySet<StepId> {
  const internal = analysis.internal as AnalysisInternal;
  const out = new Set<StepId>();
  for (const unit of internal.structure.units) {
    if (!unit.anchor) continue;
    for (const index of unit.steps) {
      const step = steps[index];
      if (step !== undefined) out.add(step.id);
    }
  }
  return out;
}

/**
 * What the result's unknowns mean, in British English (reviews COR-06, PAR-08, PAR-10):
 * - unknown XP, only when the result turns in a quest whose XP is unknown (the engine counts
 *   unknown XP at a turn-in; a partial complete gains nothing);
 * - unknown time, the verb agreeing with the count, and "of the section or the travel out of it"
 *   when the count can include the exit chain's parts;
 * - carried objective work (D-040, plan §3.4 item 8): turn-ins whose objective travel is not priced.
 */
export function unknownsNote(
  summary: ContractSummary,
  unknownParts: number,
  steps: readonly RouteStep[],
  unknownXpBlocked: SearchedUnknownXpBlocked = null,
): string {
  const parts: string[] = [];
  const unknownXp = new Set(summary.unknownXp);
  if (unknownXp.size > 0 && steps.some((step) => step.kind === 'turnin' && stepQuestIds(step).some((q) => unknownXp.has(q)))) {
    parts.push('Quests whose XP is unknown are turned in, so the level and XP after them are lower bounds.');
  }
  if (unknownParts > 0) {
    const where = summary.exitChain.length > 0 ? 'of the section or the travel out of it' : 'of the section';
    const count = unknownParts === 1 ? `1 part ${where} has` : `${String(unknownParts)} parts ${where} have`;
    parts.push(`${count} unknown time, counted as nothing, so the times shown are lower bounds and the saving there is uncertain.`);
  }
  const carried = summary.carried.length;
  if (carried > 0) {
    const count = carried === 1 ? '1 turn-in carries' : `${String(carried)} turn-ins carry`;
    parts.push(`${count} objective work whose travel is not priced, so the times there are lower bounds (D-040).`);
  }
  if (unknownXpBlocked !== null) {
    // Review PAR-04: say why orders that lose known XP were refused, and what would allow them.
    const xp = String(unknownXpBlocked.smallestShortfall);
    parts.push(
      `Some orders were refused because they gain at least ${xp} known XP less than the target, and no grind fill may follow a turn-in whose XP is unknown (XP-4); a target ${xp} XP lower would allow them.`,
    );
  }
  return parts.join(' ');
}

class Cancelled extends Error {
  constructor() {
    super('The optimiser run was cancelled');
    this.name = 'AbortError';
  }
}

export function startOptimization(deps: OptimizationRunDeps, request: OptimizationRequest, overrides: Partial<OptimizationOptions> = {}): OptimizerRun<OptimizationResult> {
  const { host, store } = deps;
  const now = deps.now ?? (() => performance.now());
  const yieldToEventLoop = deps.yieldToEventLoop ?? yieldMacrotask;
  const options: OptimizationOptions = { ...DEFAULT_OPTIMIZATION_OPTIONS, ...overrides };
  const started = now();
  const controller = new AbortController();
  const listeners = new Set<(progress: OptimizationProgress) => void>();
  const timing = { analysisWalkMs: 0, analyseMs: 0, pathsMs: 0, baselineWalkMs: 0, compileMs: 0, searchMs: 0, verifyMs: 0 };
  let search: OptimizerRun<SearchedSection> | null = null;
  let last: OptimizationProgress = { phase: 'paths', depth: 0, evaluations: 0, beamSize: 0, incumbentSeconds: 0, bestSeconds: null, elapsedMs: 0, legs: null };
  const emit = (patch: Partial<OptimizationProgress>): void => {
    last = { ...last, ...patch, elapsedMs: now() - started };
    for (const listener of [...listeners]) listener(last);
  };
  const timed = <T>(key: keyof typeof timing, action: () => T): T => {
    const at = now();
    try {
      return action();
    } finally {
      timing[key] += now() - at;
    }
  };
  const failed = (status: 'infeasible' | 'failed', reason: string, stats: SearchStats = EMPTY_STATS): OptimizationResult => ({ status, reason, stats, timing: { ...timing } });
  const cancelledResult = (stats: SearchStats = EMPTY_STATS): OptimizationResult => ({ status: 'cancelled', stats, timing: { ...timing } });
  const checkCancel = (): void => {
    if (controller.signal.aborted) throw new Cancelled();
  };
  /** A macrotask between two long main-thread phases, then the cancel check (review RTD-05). */
  const pause = async (): Promise<void> => {
    await yieldToEventLoop();
    checkCancel();
  };
  /** Releases a lock of this run's; the store commits before it notifies, so a throwing subscriber cannot keep it held (review RTD-03). */
  const release = (reason: EditLockReason): void => {
    try {
      store.releaseLock(reason);
    } catch {
      // A subscriber threw after the release was committed: the lock is released all the same.
    }
  };

  // ---- 1. Checks and the lock (synchronously, so the caller sees editing locked at once).
  const refusal = ((): string | null => {
    const state = store.getState();
    if (state.locks.has('optimizer') || state.locks.has('proposal')) return 'an optimiser run or a proposal is already open';
    // The host is a snapshot that can lag the editor (review RTD-04): both must be the request's revision.
    if (host.revision !== request.baseRevision || state.revision !== request.baseRevision) return 'the route changed since the request was made; start again';
    if (request.scope.allowNewQuests) return 'adding quests is not available yet';
    return null;
  })();
  let locked = false;
  let lockFailure: string | null = null;
  if (refusal === null) {
    try {
      store.acquireLock('optimizer');
      locked = true;
    } catch (error) {
      // A subscriber threw after the lock was committed: release it and fail the run (review RTD-03).
      if (store.getState().locks.has('optimizer')) release('optimizer');
      lockFailure = `the edit lock could not be taken: ${messageOf(error)}`;
    }
  }

  const execute = async (): Promise<OptimizationResult> => {
    // Let the caller subscribe first: nothing but the lock happens in the `startOptimization` call.
    await Promise.resolve();
    if (refusal !== null) return failed('failed', refusal);
    if (lockFailure !== null) return failed('failed', lockFailure);
    checkCancel();
    const project = host.project;
    const steps = project.route.steps;
    const first = steps.findIndex((step) => step.id === request.section.firstStepId);
    const lastIndex = steps.findIndex((step) => step.id === request.section.lastStepId);
    if (first < 0 || lastIndex < 0 || lastIndex < first) return failed('failed', "the section's first and last steps are not in the route in that order");
    const section = { first, last: lastIndex };

    // ---- 2. paths: the analysis walk, the analysis, "computing paths". The legs progress is the
    // scheduler's (legs still needed), so it starts at 0 of 0, not at the matrix's pair count (review RTD-09).
    emit({ phase: 'paths', legs: { done: 0, total: 0 } });
    await pause();
    const run = createRunWalker(host);
    // The state before the section (a replay of the prefix), once for both walks, in a task of its own.
    const start = timed('analysisWalkMs', () => sectionStart(run, project, first));
    await pause();
    const analysisWalk = timed('analysisWalkMs', () => walkSection(run, project, section, { probe: false, start }));
    await pause();
    const input: CompileInput = {
      project,
      section,
      goal: { targetXp: request.goal.targetXp, grindFill: request.goal.grindFill ?? 'shortfall' },
      context: run.engine,
      walk: analysisWalk.walk,
      availability: run.availability,
    };
    const analysis = timed('analyseMs', () => analyseSection(input));
    if (!analysis.ok) return failed(analysis.status, analysis.reason);
    emit({ incumbentSeconds: analysis.summary.original.sectionPlusExitMs / 1000 });
    const pathsAt = now();
    try {
      await host.computeLegs(analysis.pairs, {
        signal: controller.signal,
        onProgress: (p) => {
          emit({ phase: 'paths', legs: { done: p.done, total: p.total } });
        },
      });
    } finally {
      timing.pathsMs = now() - pathsAt;
    }
    checkCancel();

    // ---- 3. compiling: the baseline re-walk with the probe, the pending check.
    emit({ phase: 'compiling' });
    const baselineWalk = timed('baselineWalkMs', () => walkSection(run, project, section, { probe: true, from: analysis.castWindowStart, start }));
    await pause();
    const missing = host.missingLegs(analysis.pairs);
    if (missing > 0) {
      return failed('failed', `walking paths are not complete for this section (${String(missing)} ${missing === 1 ? 'leg' : 'legs'}); try again when computing paths has finished`);
    }

    // ---- 4. searching (compile is the optimiser's first phase).
    const cache = deps.cache === undefined ? undefined : keyedMatrixCache(deps.cache, () => host.cacheKey());
    const searchAt = now();
    let searchingAt: number | null = null;
    search = deps.optimizer.optimize(request, options, { analysis, baseline: baselineWalk.walk, ...(cache === undefined ? {} : { cache }) }, deps.ids);
    const unsubscribe = search.onProgress((p) => {
      if (p.phase === 'searching' && searchingAt === null) searchingAt = now();
      emit({ ...p, legs: last.legs });
    });
    let searched: SearchedSection;
    try {
      searched = await search.result;
    } finally {
      unsubscribe();
      const end = now();
      timing.compileMs = (searchingAt ?? end) - searchAt;
      timing.searchMs = searchingAt === null ? 0 : end - searchingAt;
      search = null;
    }
    if (searched.status === 'cancelled' || controller.signal.aborted) return cancelledResult(searched.stats);
    if (searched.status !== 'searched') return failed(searched.status, searched.reason, searched.stats);

    // ---- 5. finishing: re-walk the incumbent when it has a fill, then verify the candidates in order.
    emit({ phase: 'finishing' });
    const anchors = sectionAnchors(analysis, steps);
    const original = steps.slice(first, lastIndex + 1);
    const originalBaseline: BaselineWalk = { project, section, walk: baselineWalk.walk, issues: baselineWalk.issues, summary: searched.summary, anchors };
    const incumbent = searched.incumbentSection;
    // The search's incumbent is the original plus the fill the target needs when the original misses
    // it (§7.5): candidates are judged against its re-walk, not the original's (review PAR-05).
    const incumbentHasFill = incumbent.steps.length !== original.length || incumbent.steps.some((step, i) => step !== original[i]);
    let incumbentReport: VerificationReport | null = null;
    if (incumbentHasFill) {
      incumbentReport = timed('verifyMs', () =>
        verifyCandidate({ run, baseline: originalBaseline, steps: incumbent.steps, estimatedMs: searched.incumbent.estimatedMs, judgeImprovement: false }),
      );
      await pause();
    }
    const baseline: BaselineWalk = incumbentReport === null ? originalBaseline : { ...originalBaseline, incumbentMs: incumbentReport.engineMs };
    const rejected: VerificationReport[] = [];
    const suffixLength = steps.length - lastIndex - 1;
    const verifyRoute = (route: readonly RouteStep[]): VerificationReport => {
      const sectionSteps = route.slice(first, route.length - suffixLength);
      if (route.length < first + suffixLength || route.slice(0, first).some((step, i) => step !== steps[i]) || route.slice(route.length - suffixLength).some((step, i) => step !== steps[lastIndex + 1 + i])) {
        throw new RangeError('verifyRoute: the route differs from the original outside the section');
      }
      return verifyCandidate({ run, baseline, steps: sectionSteps, estimatedMs: null });
    };
    const shared = { termination: searched.termination, reproducible: searched.reproducible, summary: searched.summary, anchors, verifyRoute, stats: searched.stats } as const;
    for (const [k, candidate] of searched.candidates.entries()) {
      if (k > 0) await pause();
      else checkCancel();
      const report = timed('verifyMs', () => verifyCandidate({ run, baseline, steps: candidate.steps, estimatedMs: candidate.solution.estimatedMs }));
      if (!report.ok) {
        rejected.push(report);
        continue;
      }
      const { route, diff } = proposalDiff({ before: steps, section, steps: candidate.steps, anchors, dependencies: candidate.dependencies, dataset: host.validator.dataset });
      return {
        ...shared,
        status: 'improved',
        steps: candidate.steps,
        route,
        diff,
        dependencies: candidate.dependencies,
        unknowns: { quests: searched.summary.unknownXp, note: unknownsNote(searched.summary, candidate.solution.unknownParts, candidate.steps, searched.unknownXpBlocked) },
        estimate: {
          incumbentMs: searched.incumbent.estimatedMs,
          resultMs: candidate.solution.estimatedMs,
          engineMs: report.engineMs,
          originalMs: report.originalMs,
          knownGain: candidate.solution.knownGain,
          targetXp: searched.summary.targetXp,
        },
        verification: report,
        rejected,
        timing: { ...timing },
      };
    }
    const originalMs = incumbentReport?.originalMs ?? rejected[0]?.originalMs ?? searched.summary.original.sectionPlusExitMs;
    if (incumbentReport !== null && !incumbentReport.ok) {
      const why = incumbentReport.failures.map((f) => `${f.rule}: ${f.detail}`).join('; ');
      return failed(
        'infeasible',
        `the section gains ${String(searched.incumbent.knownGain)} known XP, below the target of ${String(searched.summary.targetXp)}, and the original with the grind fill the target needs does not pass verification (${why})`,
        searched.stats,
      );
    }
    // No candidate passed: the incumbent, whose steps, estimate and re-walk describe one route.
    const { route, diff } =
      incumbentReport === null
        ? { route: steps, diff: { ops: [], changeSets: [] } }
        : proposalDiff({ before: steps, section, steps: incumbent.steps, anchors, dependencies: incumbent.dependencies, dataset: host.validator.dataset });
    return {
      ...shared,
      status: 'no-improvement',
      steps: incumbentReport === null ? original : incumbent.steps,
      route,
      diff,
      dependencies: incumbentReport === null ? [] : incumbent.dependencies,
      unknowns: { quests: searched.summary.unknownXp, note: unknownsNote(searched.summary, searched.incumbent.unknownParts, incumbentReport === null ? original : incumbent.steps, searched.unknownXpBlocked) },
      estimate: {
        incumbentMs: searched.incumbent.estimatedMs,
        resultMs: searched.incumbent.estimatedMs,
        engineMs: incumbentReport?.engineMs ?? originalMs,
        originalMs,
        knownGain: searched.incumbent.knownGain,
        targetXp: searched.summary.targetXp,
      },
      verification: incumbentReport,
      rejected,
      timing: { ...timing },
    };
  };

  const result = execute()
    .catch((error: unknown): OptimizationResult => {
      if (error instanceof Cancelled || controller.signal.aborted) return cancelledResult();
      return failed('failed', `the optimiser run failed: ${messageOf(error)}`);
    })
    .then((outcome) => {
      if (!locked) return outcome;
      // Hand-over (review OP-19): the proposal lock is taken before the run's is released, in one
      // task. A subscriber that throws cannot keep the run's lock held or lose the outcome (review RTD-03).
      try {
        if (outcome.status === 'improved' && deps.handOver === 'proposal') store.acquireLock('proposal');
      } catch {
        // The store commits before it notifies: the proposal lock is held all the same.
      } finally {
        release('optimizer');
      }
      return outcome;
    });

  return {
    result,
    cancel() {
      if (controller.signal.aborted) return;
      controller.abort(new Cancelled());
      search?.cancel();
    },
    onProgress(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
