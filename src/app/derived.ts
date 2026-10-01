import type { ProjectV1 } from '../domain';
import type { QuestId, StepId } from '../domain/ids';
import type { ValidationIssue } from '../domain/issues';
import type { ReadonlyCharacterState, StepRecord } from '../engine/types';
import type { EffectiveRules } from '../rules/precedence';
import type { RouteMetrics, StepEstimate } from '../sim/estimate';
import type { PlacesModel } from './map-places';
import type { QuestStateModel } from './quest-state';
import type { ZoneSpans } from './zone-levels';

/**
 * Derived results (docs/ARCHITECTURE.md §12.1): what one engine walk per project revision gives the
 * shell — step estimates, route metrics, validation issues and the character state at the
 * selected step — published as revisioned values through a small framework-agnostic store read
 * like the editor store (`getState`/`subscribe`, `useDerived` in src/app/react.ts).
 *
 * The walk itself (src/app/derived-pipeline.ts, with the engine, simulation and validator) loads
 * as its own chunk; until it is ready the store says `loading`. Results may lag the editor's
 * revision for a moment after an edit: compare `results.revision` with `EditorState.revision`.
 *
 * Types only from the pure modules, so this file stays small in the entry chunk.
 */

/** Which travel model the results were walked with, and why (ARCHITECTURE §9.1, D-028). */
export interface TravelStatus {
  /**
   * - `checking`: the navigation manifest is still loading; the straight-line model is used meanwhile;
   * - `navigation`: navmesh legs, with the labelled straight-line fallback;
   * - `straight-line`: no navigation data in this deploy or browser (`reason` says why).
   */
  readonly model: 'checking' | 'navigation' | 'straight-line';
  /** Why navigation is off (`straight-line`), or null. */
  readonly reason: string | null;
  /** The navigation revision, or `'straight-line'`. */
  readonly revision: string;
  /** World maps whose navigation files failed closed (their legs use the straight-line fallback for good), ascending. */
  readonly unavailableMaps: readonly number[];
  /** True when every map's navigation failed (the worker could not start). */
  readonly unavailableAll: boolean;
  /**
   * Why same-map boats and zeppelins (D-034 item 2) take no part in walking legs that have no
   * walking path, in words (`navigation` only), or null/absent when some can.
   */
  readonly transportNote?: string | null;
}

/**
 * The "computing paths" phase (terrain-navigation.md §9.4, RC-07): the walking legs of one revision
 * requested from the navigation worker, with progress, cancelled with `DerivedStore.cancelPaths`.
 */
export interface PathsProgress {
  /**
   * - `idle`: nothing to compute (no pending legs, or the straight-line model);
   * - `running`: legs are being computed; with a `failure`, the run is waiting to ask again after a
   *   failure that may pass (offline, a file that did not arrive in time);
   * - `paused`: the user cancelled; pending legs keep the straight-line fallback until
   *   `resumePaths` (or `computePaths`) is called;
   * - `failed`: computing stopped on an unexpected error (`failure` says why); navigation is then
   *   turned off, so the legs take the final straight-line fallback. `resumePaths` tries again.
   */
  readonly state: 'idle' | 'running' | 'paused' | 'failed';
  /**
   * The editor revision whose enumerated legs the run computes, or null. A later revision that
   * still has pending legs gets its own run when this one ends; superseded revisions are never
   * re-walked.
   */
  readonly revision: number | null;
  /**
   * Walking legs of the run no longer pending, of those pending since it started, counted as
   * `DerivedResults.pendingLegs` counts them (legs per step): `total - done` is the latest results'
   * `pendingLegs`, so progress and the pending note agree. Updated with each re-walk.
   */
  readonly done: number;
  readonly total: number;
  /** With `failed`, why computing stopped; with `running`, the failure it waits to retry after; else null. */
  readonly failure: string | null;
}

/** How long the published results took (ms, `performance.now` in the browser; 0 without a clock). */
export interface DerivedTiming {
  /** The walk, simulation and validation (a re-walk from a checkpoint after an edit). */
  readonly walkMs: number;
  /** Route metrics over the step estimates. */
  readonly metricsMs: number;
  /** From the first unpublished project change (the edit) to these results being published: ARCHITECTURE §14, ≤ 50 ms. */
  readonly sinceChangeMs: number;
}

export interface DerivedResults {
  /** The editor revision walked. */
  readonly revision: number;
  /** The project walked (the one of that revision). */
  readonly project: ProjectV1;
  /** One record per route step, in route order (estimate, delta, legs). */
  readonly records: readonly StepRecord[];
  readonly estimates: readonly StepEstimate[];
  readonly metrics: RouteMetrics;
  /** Route-level issues first, then by step (src/validate's stable order). */
  readonly issues: readonly ValidationIssue[];
  /** The issues of each step, by step index. */
  readonly stepIssues: readonly (readonly ValidationIssue[])[];
  /** The effective rules (ruleset plus project assumptions, with provenance): what marks assumed numbers. */
  readonly rules: EffectiveRules;
  readonly travelModel: 'straight-line' | 'navigation';
  /** Walking legs whose seconds are the straight-line fallback while the navigation leg is computed. */
  readonly pendingLegs: number;
  /** Steps with at least one pending leg. */
  readonly pendingSteps: number;
  /**
   * True while the committed client taxi file is still loading (SIMULATION TIME-5, TIME-6): flights
   * use the straight-line estimate, and a name only the file knows does not resolve yet, until the
   * walk that follows its arrival.
   */
  readonly taxiPending: boolean;
  /**
   * True when no number depends on something still arriving: no pending legs, the navigation
   * manifest no longer being checked, and the taxi file no longer loading (`taxiPending`). Metrics
   * shown as final must say they are pending otherwise (`provisionalNote`).
   */
  readonly final: boolean;
  /** The first step this walk re-computed (the checkpoint it re-walked from). */
  readonly walkedFrom: number;
  readonly timing: DerivedTiming;
  /**
   * A route row's short form of an issue at a step whose first quest is `stepQuest` (review UI-01;
   * `app/issue-short.ts`, in the pipeline's chunk); absent (results built elsewhere): the rows show
   * the message.
   */
  readonly shortIssue?: (issue: ValidationIssue, stepQuest: QuestId | null) => string;
}

/**
 * The character around the selection's focus step (route context, ARCHITECTURE §9.2), or, with no
 * step selected, around the last step: the panels and the map then show the state after the last
 * step, as the status bar does (D-050 item 2; review PR-13).
 */
export interface SelectedStepState {
  /** The editor revision of the results it was read from. */
  readonly revision: number;
  readonly stepId: StepId;
  readonly index: number;
  /** No step is selected: this is the last step, the state at the end of the route. */
  readonly atEnd: boolean;
  readonly record: StepRecord;
  /** The state before the step runs. */
  readonly before: ReadonlyCharacterState;
  /** The state after it. */
  readonly after: ReadonlyCharacterState;
  readonly issues: readonly ValidationIssue[];
}

export interface DerivedState {
  /** `loading` until the pipeline's chunk has loaded and walked once; `failed` when it could not start. */
  readonly status: 'loading' | 'ready' | 'failed';
  /** Why the pipeline failed to load or the last walk threw; null otherwise. */
  readonly failure: string | null;
  /** The latest results, or null before the first walk. */
  readonly results: DerivedResults | null;
  /**
   * The state at the selection's focus step, from `results`; without a focus, at the last step
   * (`atEnd`, D-050 item 2). Null before the first walk, for an empty route, or while the focus
   * step is not walked yet.
   */
  readonly selected: SelectedStepState | null;
  readonly travel: TravelStatus;
  readonly paths: PathsProgress;
  /**
   * The quest state after the selection's focus step (map-presentation.md §7.1, §7.2; step MP.3):
   * every quest open to the character classified with its reason, the Available tab's groups and
   * the map's quest layers. Built by the pipeline in a task of its own after `selected` is
   * published (so a selection change paints first), keyed by the walk and the step: it may name the
   * previous step for a moment (`questState.stepId`). Without a focus it is the state after the last
   * step (`questState.atEnd`, D-050 item 2), kept while an edit leaves that state as it was (its
   * `revision` then names the walk it was classified at; review F-01). Null before the first walk,
   * for an empty route, or after a failure: the shell then shows the quests open by race and class,
   * and says so.
   */
  readonly questState: QuestStateModel | null;
  /** The zones' level spans for the character (§12.5), once per dataset view and character; null until the pipeline has built them. */
  readonly zoneSpans: ZoneSpans | null;
  /**
   * The map's places (map-presentation.md §8 to §10; steps MP.5, MP.8, MP.9): dungeon entrances,
   * flight points with their state after the focus step and the flight network, and transport stops,
   * from the committed client tables (with how they loaded: the flights use TIME-6 once the taxi file
   * has, TIME-5 while it loads or when it failed). Built with the quest state, in its task. Null (or
   * absent) until the pipeline has built it.
   */
  readonly places?: PlacesModel | null;
}

/** What `computePaths` resolves to. */
export interface ComputePathsResult {
  /** The editor revision whose legs were computed. */
  readonly revision: number;
  /** Table entries requested. */
  readonly requested: number;
  /** True when that revision has no pending leg any more. */
  readonly complete: boolean;
}

/** What the pipeline (or a test double) does for the store's actions. */
export interface DerivedActions {
  cancelPaths(): void;
  resumePaths(): void;
  computePaths(options?: { readonly signal?: AbortSignal }): Promise<ComputePathsResult>;
  stateBefore(index: number): ReadonlyCharacterState | null;
}

/**
 * The derived-results store. Members are function-typed properties (no `this`), like
 * `EditorStore`'s, so they can be passed around unbound.
 */
export interface DerivedStore {
  /** The same object until something changes. */
  readonly getState: () => DerivedState;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Stops the "computing paths" run (legs computed so far are kept) and pauses automatic path
   * computing: pending legs keep their straight-line fallback, labelled pending, until
   * `resumePaths` or `computePaths`. Nothing happens before the pipeline has loaded.
   */
  readonly cancelPaths: () => void;
  /** Resumes automatic path computing after `cancelPaths`. */
  readonly resumePaths: () => void;
  /**
   * Computes every pending leg of the current revision (the "computing paths" phase before an
   * optimiser compile, §9.4), with progress in `paths`. Resolves once they are in the table and
   * the revision has been re-walked; rejects when the signal aborts. Exports never need it: they
   * contain no times.
   */
  readonly computePaths: (options?: { readonly signal?: AbortSignal }) => Promise<ComputePathsResult>;
  /**
   * The character state before step `index` of the latest results' walk (`index` = step count: after
   * the last step), from the nearest engine checkpoint (at most 255 steps re-run). Null before the
   * first walk, or for an index out of range. For route context at a row other than the focus
   * (`selected` already has the focus step's).
   */
  readonly stateBefore: (index: number) => ReadonlyCharacterState | null;
}

/** The store plus what the pipeline uses to publish and to take over the actions. */
export interface DerivedStoreHandle {
  readonly store: DerivedStore;
  /** Merges `patch` into the state and notifies, unless every field is the same value. */
  readonly publish: (patch: Partial<DerivedState>) => void;
  /** Routes the store's actions to the pipeline once it is ready. */
  readonly attach: (actions: DerivedActions) => void;
}

export const IDLE_PATHS: PathsProgress = { state: 'idle', revision: null, done: 0, total: 0, failure: null };

export const CHECKING_TRAVEL: TravelStatus = { model: 'checking', reason: null, revision: 'straight-line', unavailableMaps: [], unavailableAll: false };

export const INITIAL_DERIVED_STATE: DerivedState = {
  status: 'loading',
  failure: null,
  results: null,
  selected: null,
  travel: CHECKING_TRAVEL,
  paths: IDLE_PATHS,
  questState: null,
  zoneSpans: null,
  places: null,
};

const STATE_KEYS = Object.keys({
  status: true,
  failure: true,
  results: true,
  selected: true,
  travel: true,
  paths: true,
  questState: true,
  zoneSpans: true,
  places: true,
} satisfies Record<keyof DerivedState, true>) as readonly (keyof DerivedState)[];

export function createDerivedStore(initial: DerivedState = INITIAL_DERIVED_STATE): DerivedStoreHandle {
  let state = initial;
  const listeners = new Set<() => void>();
  let actions: DerivedActions | null = null;
  const notReady = (): Promise<never> => Promise.reject(new Error('The route simulation is still loading'));

  const store: DerivedStore = {
    getState: () => state,
    subscribe(listener) {
      const entry = () => listener();
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
    cancelPaths: () => actions?.cancelPaths(),
    resumePaths: () => actions?.resumePaths(),
    computePaths: (options) => (actions === null ? notReady() : actions.computePaths(options)),
    stateBefore: (index) => actions?.stateBefore(index) ?? null,
  };

  return {
    store,
    publish(patch) {
      const next = { ...state, ...patch };
      if (STATE_KEYS.every((key) => Object.is(next[key], state[key]))) return;
      state = next;
      for (const listener of [...listeners]) listener();
    },
    attach(next) {
      actions = next;
    },
  };
}

// Selectors ---------------------------------------------------------------------------------

/** The latest results, or null. */
export const selectDerivedResults = (state: DerivedState): DerivedResults | null => state.results;

export const selectRouteMetrics = (state: DerivedState): RouteMetrics | null => state.results?.metrics ?? null;

export const selectIssues = (state: DerivedState): readonly ValidationIssue[] | null => state.results?.issues ?? null;

export const selectSelectedStep = (state: DerivedState): SelectedStepState | null => state.selected;

export const selectPathsProgress = (state: DerivedState): PathsProgress => state.paths;

export const selectTravelStatus = (state: DerivedState): TravelStatus => state.travel;

/** The quest state after the focus step, or null (no route state yet). */
export const selectQuestState = (state: DerivedState | null): QuestStateModel | null => state?.questState ?? null;

/** The zones' level spans, or null while they are not built. */
export const selectZoneSpans = (state: DerivedState | null): ZoneSpans | null => state?.zoneSpans ?? null;

/** Whether the results are for `revision` (the editor's): false while a re-walk after an edit is on its way. */
export const isCurrent = (state: DerivedState, revision: number): boolean => state.results?.revision === revision;

/** The estimate of step `index` of the latest results, or null. */
export function stepEstimateAt(state: DerivedState, index: number): StepEstimate | null {
  return state.results?.estimates[index] ?? null;
}

const count = (n: number, one: string, many: string): string => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/**
 * Why the results' times are not final yet, in a sentence for the UI, or null when they are final
 * (`DerivedResults.final`). Metrics shown as final (route duration, XP per hour, the travel share)
 * must carry it while legs are pending (ARCHITECTURE §14 note; terrain-navigation.md §9.3).
 */
export function provisionalNote(state: Pick<DerivedState, 'results' | 'travel' | 'paths'>): string | null {
  const results = state.results;
  if (results === null) return 'Not simulated yet.';
  if (results.final) return null;
  if (results.pendingLegs > 0 || results.pendingSteps > 0) {
    // A step can wait only on legs it compared (a transport's dock walks) without walking them.
    const legs = results.pendingLegs > 0 ? count(results.pendingLegs, 'walking leg is', 'walking legs are') : 'some walking legs are';
    const paths = state.paths;
    const how =
      paths.state === 'paused'
        ? 'not being computed (paused)'
        : paths.state === 'failed'
          ? `not computed: computing them failed${paths.failure === null ? '' : ` (${paths.failure})`}`
          : paths.state === 'running' && paths.failure !== null
            ? `waiting to be computed again after a failure that may pass (${paths.failure})`
            : 'still being computed';
    return `Pending: ${legs} ${how}; ${results.pendingLegs === 1 ? 'its time uses' : 'their times use'} the straight-line estimate.`;
  }
  if (state.travel.model === 'checking') return 'Pending: checking for navigation data; times use the straight-line estimate.';
  if (results.taxiPending) return 'Pending: loading the client taxi file; flight times use the straight-line estimate.';
  return null;
}

/**
 * Why a pending travel time is pending, for a step's marker, its row name and Details (one reason
 * for the whole route, from the derived state; UI.md §16):
 * - `checking`: the navigation data is still being checked;
 * - `computing`: its walking path is being computed (or about to be);
 * - `retrying`: computing failed in a way that may pass, and is asked again shortly;
 * - `paused`: the user paused computing;
 * - `failed`: computing stopped on an unexpected error (navigation is then turned off, and the
 *   times become final straight-line estimates at the next walk).
 */
export type PendingTravelReason = 'checking' | 'computing' | 'retrying' | 'paused' | 'failed';

export function pendingTravelReason(state: {
  readonly travel: Pick<TravelStatus, 'model'>;
  readonly paths: Pick<PathsProgress, 'state' | 'failure'>;
}): PendingTravelReason {
  if (state.travel.model === 'checking') return 'checking';
  switch (state.paths.state) {
    case 'paused':
      return 'paused';
    case 'failed':
      return 'failed';
    case 'running':
      return state.paths.failure === null ? 'computing' : 'retrying';
    case 'idle':
      return 'computing';
  }
}

/** The sentence for a pending travel time (`pendingTravelReason`), with the failure where there is one. */
export function pendingTravelText(state: Pick<DerivedState, 'travel' | 'paths'>): string {
  const failure = state.paths.failure;
  switch (pendingTravelReason(state)) {
    case 'checking':
      return 'Pending: the navigation data is still being checked, so the travel time is a straight-line estimate for now';
    case 'computing':
      return 'Pending: the walking path is still being computed, so the travel time is a straight-line estimate for now';
    case 'retrying':
      return `Pending: computing the walking path failed${failure === null ? '' : ` (${failure})`} and will be tried again shortly, so the travel time is a straight-line estimate for now`;
    case 'paused':
      return 'Pending: computing walking paths is paused, so the travel time is a straight-line estimate until you resume';
    case 'failed':
      return `Pending: the walking path could not be computed${failure === null ? '' : ` (${failure})`}, so the travel time is a straight-line estimate`;
  }
}
