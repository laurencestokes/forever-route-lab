import type { DatasetView } from '../domain/dataset';
import type { StepId } from '../domain/ids';
import type { ValidationIssue } from '../domain/issues';
import type { ProjectV1 } from '../domain/project';
import type { RouteStep } from '../domain/route';
import type { TravelModel } from '../domain/travel';
import type { WalkVisitor, ZoneHintResolver } from '../engine/types';
import { createRouteWalker, type RouteWalker, walkMetrics } from '../engine/walker';
import type { MapGeometry } from '../geo/types';
import type { EffectiveRules } from '../rules/precedence';
import type { TravelGraph, UserDock } from '../rules/travel-graph';
import { createRouteValidator, type RouteValidator } from '../validate/validator';
import {
  type ComputePathsResult,
  type DerivedActions,
  type DerivedResults,
  type DerivedStoreHandle,
  type PathsProgress,
  type SelectedStepState,
  type TravelStatus,
  CHECKING_TRAVEL,
  IDLE_PATHS,
} from './derived';
import { projectRules, projectTravelGraph, sameMapTransportNote, selectTravelModel, type TravelSelection, userDocksKey, userDocksOf } from './derived-context';
import { type DatasetSource, datasetViewInputOf } from './dataset-source';
import { cachedDatasetSource, datasetBaseView } from './dataset-views';
import type { NavUnavailable } from './navigation-legs';
import type { NavigationTravelModel } from './navigation-model';
import { NAVIGATION_CHECKING, type NavigationRuntime, type NavigationState } from './navigation-runtime';
import { defaultNavTimers, type NavigationBatch, type NavTimers } from './navigation-scheduler';
import type { EditorStore } from './store';

/**
 * The derived-result pipeline (docs/ARCHITECTURE.md §12.1, §9.2-§9.4; terrain-navigation.md §9.3,
 * §9.4): one engine walk per project revision feeds simulation, validation and route context, and
 * the results are published through the derived store (src/app/derived.ts).
 *
 * - **Walker per context.** The context is the project's dataset view, its effective rules, the
 *   TravelGraph seeded from the dataset (with the dock positions the project's transport steps
 *   give, TIME-7) and the travel model (src/app/derived-context.ts). While it stays the same, one
 *   walker and one validator are kept, so an edit re-walks from the engine's last checkpoint before
 *   the first changed step and re-validates only the steps it visits.
 * - **Edits.** A project change schedules one walk (a zero-delay timer, so rapid edits coalesce and
 *   the edit renders first); the walk always reads the store's current project, so a superseded
 *   revision is never walked.
 * - **Navigation.** Legs the navigation model has not computed yet take the straight-line fallback,
 *   marked pending. After a walk with pending legs and no "computing paths" run, a run starts in a
 *   task of its own (so the published results paint first): the revision's legs are enumerated
 *   through the engine (`walker.legs()`) and requested through the scheduler (`computeLegs`, with
 *   progress and cancel). While a run is in flight, legs a newer walk needs that the run does not
 *   carry (an edit's) go out at once through the scheduler's background drain, ahead of the run's
 *   bulk groups; the newer revision gets a run of its own when this one ends. Each batch of results
 *   the scheduler applies triggers one re-walk, from the first step with a pending leg, at most
 *   every `rewalkMs` (100 ms), of the current revision only. A failure that may pass is retried by
 *   the scheduler (the run shows what it waits to retry after); an unexpected one turns navigation
 *   off for every map, so the times become final straight-line estimates (`resumePaths` tries
 *   again).
 * - **Selection.** The state before and after the selection's focus step comes from the walker's
 *   checkpoints (`stateBefore`) and is republished when the focus changes.
 *
 * Exports never wait for any of this: they contain no times.
 */

export interface DerivedPipelineOptions {
  readonly store: EditorStore;
  readonly data: DatasetSource;
  /** The map geometry resolution uses (`LoadedGeometry.geometry`). */
  readonly geometry: MapGeometry;
  /** Where results go (`createDerivedStore()`); the store's actions are routed to the pipeline. */
  readonly output: Pick<DerivedStoreHandle, 'publish' | 'attach'>;
  /** Navigation as known at the start; `setNavigation` changes it. Default: checking. */
  readonly navigation?: NavigationState;
  /** The walk and re-walk timers; default `setTimeout`. */
  readonly timers?: NavTimers;
  /** Monotonic ms (`performance.now`); default 0 (every timing is then 0). */
  readonly now?: () => number;
  /** The least time between the end of one walk and a re-walk for navigation results (default 100 ms, §9.3). */
  readonly rewalkMs?: number;
  /** Called after each publish of new results (the composition root measures them). */
  readonly onPublished?: (results: DerivedResults) => void;
  /** Called whenever the navigation model changes (null: none), with the runtime and hints (the map's walking paths). */
  readonly onNavigationModel?: (model: NavigationTravelModel | null, runtime: NavigationRuntime | null, hints: ZoneHintResolver) => void;
}

export interface DerivedPipeline extends DerivedActions {
  /** Navigation became known (the manifest loaded or failed). */
  setNavigation(state: NavigationState): void;
  /** Runs a scheduled walk now, if any (tests and benchmarks; the app waits for the timer). */
  flush(): void;
  /** The walker's checkpoint indices (tests). */
  checkpointIndices(): number[];
  /** How many walks ran (tests and benchmarks). */
  readonly walks: number;
  dispose(): void;
}

/** Tracks which steps asked the travel model for a pending leg (including compared transport walks). */
interface PendingTracker {
  readonly visitor: WalkVisitor;
  wrap(model: TravelModel): TravelModel;
  /** The first step of the last walk with a pending leg, or null. */
  firstPending(): number | null;
  /** Steps of the last walk with a pending leg. */
  count(): number;
}

function createPendingTracker(): PendingTracker {
  const flags: boolean[] = [];
  let asked = false;
  return {
    visitor: {
      begin({ fromIndex }) {
        flags.length = Math.min(flags.length, fromIndex);
      },
      enter() {
        asked = false;
      },
      leave(_visit, record) {
        flags[record.index] = asked || record.legs.some((leg) => leg.pending);
      },
      end(walk) {
        flags.length = walk.records.length;
      },
    },
    wrap(model) {
      return {
        id: model.id,
        revision: model.revision,
        leg(from, to, speeds) {
          const leg = model.leg(from, to, speeds);
          if (leg.pending) asked = true;
          return leg;
        },
        path: (from, to) => model.path(from, to),
      };
    },
    firstPending() {
      const i = flags.indexOf(true);
      return i < 0 ? null : i;
    },
    count() {
      let n = 0;
      for (const flag of flags) if (flag) n += 1;
      return n;
    },
  };
}

interface Context {
  readonly view: DatasetView;
  readonly baseView: DatasetView;
  readonly rules: EffectiveRules;
  readonly graph: TravelGraph;
  readonly travel: TravelSelection;
  readonly walker: RouteWalker;
  readonly validator: RouteValidator;
  readonly tracker: PendingTracker;
}

/** Remembers the last result of `compute` while every argument is the same (`Object.is`). */
function lastOf<A extends readonly unknown[], R>(compute: (...args: A) => R): (...args: A) => R {
  let last: { readonly args: A; readonly result: R } | null = null;
  return (...args) => {
    if (last !== null && last.args.length === args.length && last.args.every((value, i) => Object.is(value, args[i]))) return last.result;
    const result = compute(...args);
    last = { args, result };
    return result;
  };
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function sameTravel(a: TravelStatus, b: TravelStatus): boolean {
  return (
    a.model === b.model &&
    a.reason === b.reason &&
    a.revision === b.revision &&
    a.unavailableAll === b.unavailableAll &&
    (a.transportNote ?? null) === (b.transportNote ?? null) &&
    a.unavailableMaps.length === b.unavailableMaps.length &&
    a.unavailableMaps.every((id, i) => id === b.unavailableMaps[i])
  );
}

/** Progress in the unit of `DerivedResults.pendingLegs`: `total - done` is what is still pending. */
function progressOf(paths: PathsProgress, pendingLegs: number): PathsProgress {
  const total = Math.max(paths.total, paths.done + pendingLegs);
  const done = total - pendingLegs;
  return done === paths.done && total === paths.total ? paths : { ...paths, done, total };
}

interface Run {
  readonly controller: AbortController;
  revision: number;
  /** Start another run when this one ends (a later revision still has pending legs). */
  again: boolean;
  readonly promise: Promise<{ readonly requested: number }>;
}

export function createDerivedPipeline(options: DerivedPipelineOptions): DerivedPipeline {
  const { store, geometry, output } = options;
  // Two views per context (the project's and the one without its custom quests, DATA001): four
  // keep the previous character's pair too, so switching back reuses its views and the simulation
  // and availability caches keyed by them (review PERF-06).
  const source = cachedDatasetSource(options.data, 4);
  const timers = options.timers ?? defaultNavTimers;
  const now = options.now ?? (() => 0);
  const rewalkMs = options.rewalkMs ?? 100;

  let navigation: NavigationState = options.navigation ?? NAVIGATION_CHECKING;
  let unsubscribeBatches: (() => void) | null = null;
  let context: Context | null = null;
  let walkedProject: ProjectV1 | null = null;
  let walkedRevision = -1;
  let results: DerivedResults | null = null;
  let selectedFocus: StepId | null = null;
  let stepIndex: { readonly steps: readonly unknown[]; readonly index: Map<StepId, number> } | null = null;
  let travelStatus: TravelStatus = CHECKING_TRAVEL;
  let transportNote: string | null = null;
  let paths: PathsProgress = IDLE_PATHS;
  let paused = false;
  let run: Run | null = null;
  /** A run about to start in its own task, and the hold on the background drain until it has claimed its legs. */
  let startTimer: unknown = null;
  let releaseHold: (() => void) | null = null;
  /** The every-map failure this pipeline set after an unexpected run failure (`resumePaths` clears it). */
  let runFailure: NavUnavailable | null = null;
  let editTimer: unknown = null;
  let rewalkTimer: unknown = null;
  let changeAt: number | null = null;
  let rewalkFrom = Number.POSITIVE_INFINITY;
  let lastWalkEnd = Number.NEGATIVE_INFINITY;
  let walks = 0;
  let disposed = false;
  let lastModel: NavigationTravelModel | null | undefined;

  const rulesOf = lastOf(projectRules);
  const graphOf = lastOf((view: DatasetView, rules: EffectiveRules, docks: readonly UserDock[]) => projectTravelGraph(view, source.flightMasterIds, rules, docks));
  // Keyed on the runtime only when navigation is available: "checking" and "unavailable" both
  // give the straight-line model, so learning that navigation is unavailable re-walks nothing.
  const travelOf = lastOf((nav: NavigationRuntime | null, detour: number, graph: TravelGraph, faction: ProjectV1['character']['faction'], view: DatasetView) =>
    selectTravelModel({ navigation: nav === null ? NAVIGATION_CHECKING : { kind: 'available', runtime: nav }, detourFactor: detour, graph, faction, dataset: view, geometry }),
  );
  const noteOf = lastOf((graph: TravelGraph, rt: NavigationRuntime) =>
    sameMapTransportNote(
      graph,
      rt.manifest.maps.map((m) => m.mapId),
    ),
  );

  // The user docks of the route's transport steps: the same array while they do not change, so the
  // graph (and the walker) is kept across edits that do not touch a dock.
  let docksSteps: readonly RouteStep[] | null = null;
  let docks: { readonly key: string; readonly list: readonly UserDock[] } = { key: '', list: [] };
  function docksOf(project: ProjectV1): readonly UserDock[] {
    const steps = project.route.steps;
    if (steps === docksSteps) return docks.list;
    docksSteps = steps;
    const list = userDocksOf(steps, geometry);
    const key = userDocksKey(list);
    if (key !== docks.key) docks = { key, list };
    return docks.list;
  }

  const runtime = (): NavigationRuntime | null => (navigation.kind === 'available' ? navigation.runtime : null);

  function contextFor(project: ProjectV1): Context {
    const input = datasetViewInputOf(project);
    const view = source.view(input);
    const baseView = datasetBaseView(source, { faction: input.faction, class: input.class, questOverrides: input.questOverrides });
    const rules = rulesOf(project.rulesetId, project.assumptions);
    const graph = graphOf(view, rules, docksOf(project));
    const travel = travelOf(runtime(), rules.values.groundDetourFactor.value, graph, project.character.faction, view);
    const c = context;
    if (c !== null && c.view === view && c.baseView === baseView && c.rules === rules && c.graph === graph && c.travel === travel) return c;
    const tracker = createPendingTracker();
    const validator = createRouteValidator({ dataset: view, rules, baseDataset: baseView, graph });
    const walker = createRouteWalker({
      dataset: view,
      geometry,
      rules,
      travel: tracker.wrap(travel.model),
      graph,
      zoneHints: travel.hints,
      acceptPolicy: validator.acceptPolicy,
    });
    return { view, baseView, rules, graph, travel, walker, validator, tracker };
  }

  function computeTravelStatus(): TravelStatus {
    switch (navigation.kind) {
      case 'checking':
        return CHECKING_TRAVEL;
      case 'unavailable':
        return { model: 'straight-line', reason: navigation.reason, revision: 'straight-line', unavailableMaps: [], unavailableAll: false };
      case 'available': {
        const { manifest, table } = navigation.runtime;
        // No map has id -1: the table answers it only when every map failed.
        const all = table.unavailable(-1) !== null;
        const maps = all ? [] : manifest.maps.map((m) => m.mapId).filter((id) => table.unavailable(id) !== null).sort((a, b) => a - b);
        return { model: 'navigation', reason: null, revision: manifest.navRevision, unavailableMaps: maps, unavailableAll: all, transportNote: all ? null : transportNote };
      }
    }
  }

  function refreshTravel(): TravelStatus {
    const next = computeTravelStatus();
    if (!sameTravel(next, travelStatus)) travelStatus = next;
    return travelStatus;
  }

  function setPaths(patch: Partial<PathsProgress>): void {
    paths = { ...paths, ...patch };
    output.publish({ paths });
  }

  function indexOf(project: ProjectV1, id: StepId): number {
    const steps = project.route.steps;
    if (stepIndex?.steps !== steps) stepIndex = { steps, index: new Map(steps.map((step, i) => [step.id, i])) };
    return stepIndex.index.get(id) ?? -1;
  }

  function selectedOf(focus: StepId | null): SelectedStepState | null {
    const c = context;
    const r = results;
    if (focus === null || c === null || r === null || walkedProject === null) return null;
    const index = indexOf(walkedProject, focus);
    const record = r.records[index];
    if (index < 0 || record === undefined) return null;
    return {
      revision: r.revision,
      stepId: focus,
      index,
      record,
      before: c.walker.stateBefore(index),
      after: c.walker.stateBefore(index + 1),
      issues: r.stepIssues[index] ?? [],
    };
  }

  function clearTimers(): void {
    if (editTimer !== null) timers.clear(editTimer);
    if (rewalkTimer !== null) timers.clear(rewalkTimer);
    editTimer = null;
    rewalkTimer = null;
  }

  function scheduleWalk(): void {
    if (disposed || editTimer !== null) return;
    if (rewalkTimer !== null) {
      timers.clear(rewalkTimer);
      rewalkTimer = null;
    }
    editTimer = timers.set(walkNow, 0);
  }

  /** A re-walk for navigation results, from step `from`, at most every `rewalkMs`. */
  function requestRewalk(from: number): void {
    rewalkFrom = Math.min(rewalkFrom, from);
    if (disposed || editTimer !== null || rewalkTimer !== null) return;
    const wait = Math.max(0, lastWalkEnd + rewalkMs - now());
    rewalkTimer = timers.set(walkNow, wait);
  }

  function notifyModel(c: Context): void {
    const model = c.travel.navigation;
    if (model === lastModel) return;
    lastModel = model;
    options.onNavigationModel?.(model, model === null ? null : runtime(), c.travel.hints);
  }

  function walkNow(): void {
    clearTimers();
    if (disposed) return;
    const state = store.getState();
    const start = now();
    try {
      const c = contextFor(state.project);
      if (c !== context) {
        context = c;
        rewalkFrom = Number.POSITIVE_INFINITY;
      } else if (Number.isFinite(rewalkFrom)) c.walker.invalidate(rewalkFrom);
      rewalkFrom = Number.POSITIVE_INFINITY;
      const walk = c.walker.walk(state.project, [c.validator.visitor, c.tracker.visitor]);
      walks += 1;
      const walked = now();
      const metrics = walkMetrics(walk);
      const measured = now();
      const records = walk.records;
      const stepIssues: (readonly ValidationIssue[])[] = new Array<readonly ValidationIssue[]>(records.length);
      for (let i = 0; i < records.length; i += 1) stepIssues[i] = c.validator.stepIssues(i);
      const pendingSteps = c.tracker.count();
      const rt = runtime();
      transportNote = rt === null ? null : noteOf(c.graph, rt);
      const travel = refreshTravel();
      walkedProject = state.project;
      walkedRevision = state.revision;
      const walkedResults: DerivedResults = {
        revision: state.revision,
        project: state.project,
        records,
        estimates: walk.estimates,
        metrics,
        issues: c.validator.issues(),
        stepIssues,
        rules: c.rules,
        travelModel: c.travel.model.id,
        pendingLegs: metrics.pendingLegs,
        pendingSteps,
        final: pendingSteps === 0 && metrics.pendingLegs === 0 && travel.model !== 'checking',
        walkedFrom: walk.fromIndex,
        timing: { walkMs: walked - start, metricsMs: measured - walked, sinceChangeMs: 0 },
      };
      results = walkedResults;
      selectedFocus = state.selection.focus;
      const selected = selectedOf(selectedFocus);
      // A run's progress follows the walks, in the pending note's unit (the walk after it ends too).
      if ((paths.state === 'running' || paths.state === 'idle') && paths.revision !== null) paths = progressOf(paths, metrics.pendingLegs);
      // The edit-to-results time covers everything published (ARCHITECTURE §14: ≤ 50 ms).
      results = { ...walkedResults, timing: { ...walkedResults.timing, sinceChangeMs: now() - (changeAt ?? start) } };
      const published = results;
      changeAt = null;
      output.publish({ status: 'ready', failure: null, results: published, selected, travel, paths });
      lastWalkEnd = now();
      options.onPublished?.(published);
      notifyModel(c);
      afterWalk(c, published);
    } catch (error) {
      // Start the next walk afresh: the walker's state may be half-way through a step.
      context = null;
      changeAt = null;
      lastWalkEnd = now();
      output.publish({ status: 'failed', failure: `The route could not be simulated: ${messageOf(error)}` });
    }
  }

  /** Stops a run about to start, and lets the background drain go. */
  function cancelStart(): void {
    if (startTimer !== null) timers.clear(startTimer);
    startTimer = null;
    releaseHold?.();
    releaseHold = null;
  }

  /** After a walk that left legs pending: a run in a task of its own, unless one is in flight. */
  function afterWalk(c: Context, r: DerivedResults): void {
    const rt = runtime();
    const model = c.travel.navigation;
    if (rt === null || model === null) return;
    if (paused) {
      // Keep the pending legs pending: nothing asks for them until computing resumes.
      rt.table.clearMissing();
      return;
    }
    if (r.pendingSteps === 0) return;
    if (run !== null) {
      // The legs this walk recorded that the run does not carry (an edit's) went to the scheduler's
      // background drain, which asks for them now, ahead of the run's bulk groups.
      if (run.revision !== r.revision) run.again = true;
      return;
    }
    if (startTimer !== null) return;
    // The run claims this walk's legs itself: hold the background drain until it has.
    releaseHold ??= rt.scheduler.holdLegs();
    startTimer = timers.set(() => {
      startTimer = null;
      const latest = context;
      const rtNow = runtime();
      try {
        if (!disposed && !paused && run === null && latest !== null && latest.travel.navigation !== null && rtNow !== null && results !== null && results.pendingSteps > 0) {
          tryStartRun(latest, latest.travel.navigation, rtNow);
        }
      } finally {
        releaseHold?.();
        releaseHold = null;
      }
    }, 0);
  }

  function startRun(c: Context, model: NavigationTravelModel, rt: NavigationRuntime): Run {
    const controller = new AbortController();
    const revision = walkedRevision;
    const pairs = c.walker.legs();
    const pending = results?.pendingLegs ?? 0;
    setPaths({ state: 'running', revision, done: 0, total: pending, failure: null });
    const promise = rt.scheduler.computeLegs(model, pairs, {
      signal: controller.signal,
      onProgress: (p) => {
        // Progress itself follows the re-walks (`progressOf`); a retry after a failure shows at once.
        if (run?.controller === controller && p.retrying !== paths.failure) setPaths({ failure: p.retrying });
      },
    });
    const current: Run = { controller, revision, again: false, promise };
    run = current;
    promise.then(
      () => {
        if (run !== current) return;
        run = null;
        if (disposed) return;
        const latest = context;
        const rtNow = runtime();
        if (current.again && !paused && latest !== null && latest.travel.navigation !== null && rtNow !== null && results !== null && results.pendingSteps > 0) {
          tryStartRun(latest, latest.travel.navigation, rtNow);
          return;
        }
        setPaths({ state: 'idle', failure: null });
      },
      (error: unknown) => {
        if (run !== current) return;
        run = null;
        if (disposed) return;
        if (controller.signal.aborted) {
          // Cancelled by the user (`cancelPaths`: paused) or by a change of navigation.
          setPaths({ state: paused ? 'paused' : 'idle', failure: null });
          return;
        }
        failRun(rt, error);
      },
    );
    return current;
  }

  /**
   * An unexpected failure of "computing paths" (the scheduler retries every failure that may pass):
   * the legs cannot be trusted to arrive, so navigation is turned off and their fallback is final.
   */
  function failRun(rt: NavigationRuntime, error: unknown): void {
    const why: NavUnavailable = { code: 'internal', message: `computing walking paths failed: ${messageOf(error)}` };
    runFailure = why;
    rt.scheduler.markUnavailable('all', why);
    setPaths({ state: 'failed', failure: messageOf(error) });
  }

  /** Starts a run, or fails it when it cannot start (the enumeration threw). */
  function tryStartRun(c: Context, model: NavigationTravelModel, rt: NavigationRuntime): void {
    try {
      startRun(c, model, rt);
    } catch (error) {
      run = null;
      failRun(rt, error);
    }
  }

  function onBatch(batch: NavigationBatch): void {
    if (disposed) return;
    const before = travelStatus;
    const travel = refreshTravel();
    if (travel !== before) output.publish({ travel });
    if (batch.unavailable.length > 0) {
      requestRewalk(0);
      return;
    }
    if (batch.legs === 0) return;
    const first = context?.tracker.firstPending() ?? null;
    if (first !== null) requestRewalk(first);
  }

  function onStoreChange(): void {
    if (disposed) return;
    const state = store.getState();
    if (state.project !== walkedProject || state.revision !== walkedRevision) {
      changeAt ??= now();
      scheduleWalk();
      return;
    }
    if (state.selection.focus !== selectedFocus) {
      selectedFocus = state.selection.focus;
      output.publish({ selected: selectedOf(selectedFocus) });
    }
  }

  function subscribeBatches(): void {
    unsubscribeBatches?.();
    unsubscribeBatches = runtime()?.scheduler.subscribe(onBatch) ?? null;
  }

  const unsubscribeStore = store.subscribe(onStoreChange);
  subscribeBatches();
  travelStatus = computeTravelStatus();
  output.publish({ travel: travelStatus });

  /** Walks now when the store is ahead of the results (explicit computing needs a current walk). */
  function ensureWalked(): void {
    const state = store.getState();
    if (editTimer !== null || rewalkTimer !== null || state.project !== walkedProject || state.revision !== walkedRevision) walkNow();
  }

  /** Resolves with `promise`, or rejects with the signal's reason as soon as it aborts. */
  function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    if (signal === undefined) return promise;
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        reject(signal.reason as Error);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      void promise.then(resolve, reject).finally(() => {
        signal.removeEventListener('abort', onAbort);
      });
    });
  }

  const actions: DerivedActions = {
    cancelPaths() {
      if (disposed) return;
      paused = true;
      cancelStart();
      runtime()?.table.clearMissing();
      if (run !== null) run.controller.abort(new DOMException('Computing paths was cancelled', 'AbortError'));
      else setPaths({ state: 'paused', failure: null });
    },

    resumePaths() {
      if (disposed || (!paused && paths.state !== 'failed')) return;
      paused = false;
      // After an unexpected failure: take back the every-map failure this pipeline set, and walk
      // every step again (their legs took the final fallback).
      const rt = runtime();
      const retry = paths.state === 'failed' && rt !== null && runFailure !== null;
      if (retry) {
        rt.table.clearUnavailable(runFailure ?? undefined);
        runFailure = null;
        output.publish({ travel: refreshTravel() });
      }
      setPaths({ state: 'idle', failure: null });
      // The legs dropped while paused are asked for again by a walk from the first pending step.
      const first = retry ? 0 : (context?.tracker.firstPending() ?? null);
      if (first !== null) requestRewalk(first);
    },

    async computePaths(opts = {}) {
      if (disposed) throw new Error('The derived-result pipeline was disposed');
      opts.signal?.throwIfAborted();
      paused = false;
      ensureWalked();
      const c = context;
      const rt = runtime();
      const r = results;
      if (c === null || r === null) throw new Error('The route could not be simulated');
      const model = c.travel.navigation;
      if (rt === null || model === null) return { revision: r.revision, requested: 0, complete: r.pendingSteps === 0 };
      const revision = r.revision;
      let active = run !== null && run.revision === revision ? run : null;
      if (active === null) {
        cancelStart();
        active = startRun(c, model, rt);
      }
      // A caller's abort stops only its own wait: the run is automatic computing's too, and goes on.
      const { requested } = await untilAborted(active.promise, opts.signal);
      // Apply the last results and re-walk now, so the published results reflect the table.
      rt.scheduler.flush();
      const first = context?.tracker.firstPending() ?? null;
      if (first !== null) rewalkFrom = Math.min(rewalkFrom, first);
      walkNow();
      const after = results;
      return { revision: after?.revision ?? revision, requested, complete: after !== null && after.pendingSteps === 0 } satisfies ComputePathsResult;
    },

    stateBefore(index) {
      const c = context;
      if (c === null || results === null || !Number.isInteger(index) || index < 0 || index > results.records.length) return null;
      return c.walker.stateBefore(index);
    },
  };
  output.attach(actions);
  // The first walk.
  changeAt = now();
  scheduleWalk();

  return {
    ...actions,
    setNavigation(state) {
      if (disposed || state === navigation) return;
      cancelStart();
      run?.controller.abort(new DOMException('Navigation changed', 'AbortError'));
      run = null;
      runFailure = null;
      navigation = state;
      subscribeBatches();
      transportNote = null;
      output.publish({ travel: refreshTravel(), paths: (paths = IDLE_PATHS) });
      // The context changes with the travel model: the next walk starts a new walker.
      scheduleWalk();
    },
    flush() {
      if (editTimer !== null || rewalkTimer !== null) walkNow();
    },
    checkpointIndices: () => context?.walker.checkpointIndices() ?? [],
    get walks() {
      return walks;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimers();
      cancelStart();
      unsubscribeStore();
      unsubscribeBatches?.();
      run?.controller.abort(new DOMException('The pipeline was disposed', 'AbortError'));
      run = null;
    },
  };
}
