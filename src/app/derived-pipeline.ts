import type { DatasetView } from '../domain/dataset';
import { createIssueShortener } from './issue-short';
import type { StepId, UiMapId } from '../domain/ids';
import type { ValidationIssue } from '../domain/issues';
import type { ProjectV1 } from '../domain/project';
import type { RouteStep } from '../domain/route';
import type { TravelModel } from '../domain/travel';
import type { WalkVisitor, ZoneHintResolver } from '../engine/types';
import { createRouteWalker, type RouteWalker, walkMetrics } from '../engine/walker';
import type { MapGeometry } from '../geo/types';
import { datasetDungeons } from '../infra/data/dungeons';
import { createClientTables, type ClientDungeons, type ClientTables, type ClientTaxi, type ClientZones } from '../infra/maps/client-tables';
import { createMapResources, type MapResources, type MapResourcesOptions } from '../infra/maps/map-resources';
import type { TerrainArcs } from '../infra/maps/terrain';
import { createZoneTints, type ZoneTintsLoad } from '../infra/maps/tints';
import type { WorldMapId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';
import { surfacesOf } from '../map/layers';
import type { EffectiveRules } from '../rules/precedence';
import type { TravelGraph, UserDock } from '../rules/travel-graph';
import { type TaxiLegData, taxiLegDataOf } from '../sim/taxi';
import { createAcceptChecks } from '../validate/availability';
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
import { type ClientTableState, createPlacesBuilder, type PlacesModel } from './map-places';
import { buildMapLabels, zoneShapesOf, type ZoneShapes } from './map-labels';
import { buildZoneFill } from './map-zone-fill';
import { zoneOfPoint } from './map-viewing';
import type { NavigationTravelModel } from './navigation-model';
import { NAVIGATION_CHECKING, type NavigationRuntime, type NavigationState } from './navigation-runtime';
import { defaultNavTimers, type NavigationBatch, type NavTimers } from './navigation-scheduler';
import { type QuestStateModel, questStateModel } from './quest-state';
import { knownNodeKeys } from '../engine/state';
import { questsForCharacter } from './shell-support';
import type { EditorStore } from './store';
import { zoneSpans, type ZoneSpans } from './zone-levels';

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
 * - **Quest state** (map-presentation.md §7.1; step MP.3): after each publish of a new walk or a
 *   new focus, a task of its own classifies every quest open to the character at the state after
 *   the focus step (`questStateModel`) and publishes it with the zones' level spans, so the
 *   selection paints first and the map's sync never waits for it. It is rebuilt only for a new
 *   project walked or a new focus step: a re-walk for navigation results changes times, not quests.
 * - **Client tables** (D-039 B, E; map-presentation.md §8 to §10; steps MP.5, MP.8, MP.9): the
 *   committed taxi file and dungeon table load once, lazily and never fatally, beside the first
 *   walk. Once the taxi file has loaded, the TravelGraph is seeded with it (its nodes, its flights
 *   with their path lengths, the seeded transports' inferred docks) and flights are timed by TIME-6
 *   from its lengths, so the project is walked again; while it loads, and for good if it fails,
 *   flights use TIME-5. With the quest state, the same task builds the map's places
 *   (`createPlacesBuilder`): dungeon entrances, flight points with their state after the focus step
 *   and the flights, and transport stops.
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
  /**
   * How long after the selection last moved the quest state, places and labels are rebuilt for it
   * (review UI-04): arrowing through the list rebuilds them once, for the step it stops on, and a
   * single change paints its selection before the rebuild. The app passes `SELECTION_SETTLE_MS`;
   * default 0 (the next task).
   */
  readonly selectionSettleMs?: number;
  /** Called after each publish of new results (the composition root measures them). */
  readonly onPublished?: (results: DerivedResults) => void;
  /** Called whenever the navigation model changes (null: none), with the runtime and hints (the map's walking paths). */
  readonly onNavigationModel?: (model: NavigationTravelModel | null, runtime: NavigationRuntime | null, hints: ZoneHintResolver) => void;
  /**
   * The committed client tables (`public/maps/client/`): a loader (tests), or where to fetch them
   * from (`createClientTables` over these options, in this chunk). Omitted: none, so flights stay on
   * TIME-5 and the map's places have no taxi file or dungeon table.
   */
  readonly clientTables?: ClientTableLoaders | { readonly resources: MapResourcesOptions } | null;
}

/**
 * The committed map tables the pipeline loads (tests pass their own): the client taxi file and
 * dungeon table, and each world map's terrain zone arcs (`public/maps/terrain/<map>/zones.json`,
 * D-032), whose rings anchor the zone labels (map-presentation.md §13.2; step MP.7).
 */
export interface ClientTableLoaders extends Pick<ClientTables, 'taxi' | 'dungeons'> {
  /** The zone arcs of every world map that has them; omitted: none (the labels sit at their frames' centres). */
  readonly zoneArcs?: () => Promise<readonly TerrainArcs[]>;
  /** The client zone table (the faction overlay, MP.10); omitted: none. */
  readonly zones?: ClientTables['zones'];
  /** The committed zone tints (`public/maps/tint/`, MP.10); omitted: none. */
  readonly tints?: () => Promise<ZoneTintsLoad>;
}

/** Every world map's zone arcs that load and verify; a map whose file fails is left out (its labels sit at their frames' centres). */
async function loadZoneArcs(resources: MapResources): Promise<readonly TerrainArcs[]> {
  const manifest = await resources.terrain();
  if (manifest.kind !== 'loaded') return [];
  const loads = await Promise.all(manifest.manifest.maps.filter((map) => map.zones !== null).map((map) => resources.arcs(map.mapId, 'zones')));
  return loads.flatMap((load) => (load.kind === 'loaded' ? [load.arcs] : []));
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
  /** TIME-6's per-leg data (the committed taxi file), or null for TIME-5. */
  readonly legs: TaxiLegData | null;
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

/**
 * The quest state's wait after a selection change (review UI-04; ASSUMPTION: under the 100 ms at
 * which a delay starts to be noticed, and longer than a held arrow key's repeat of about 33 ms).
 */
export const SELECTION_SETTLE_MS = 60;

/** One issue shortener per dataset view (review UI-01): the rows' line 2. */
const shorteners = new WeakMap<object, ReturnType<typeof createIssueShortener>>();
function shortenerOf(view: DatasetView): ReturnType<typeof createIssueShortener> {
  let shortener = shorteners.get(view);
  if (shortener === undefined) {
    shortener = createIssueShortener(view);
    shorteners.set(view, shortener);
  }
  return shortener;
}

export function createDerivedPipeline(options: DerivedPipelineOptions): DerivedPipeline {
  const { store, geometry, output } = options;
  // Two views per context (the project's and the one without its custom quests, DATA001): four
  // keep the previous character's pair too, so switching back reuses its views and the simulation
  // and availability caches keyed by them (review PERF-06).
  const source = cachedDatasetSource(options.data, 4);
  const timers = options.timers ?? defaultNavTimers;
  const now = options.now ?? (() => 0);
  const selectionSettleMs = options.selectionSettleMs ?? 0;
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
  /** The quest state's own task, and what the published model was built from. */
  let questTimer: unknown = null;
  let lastSelected: SelectedStepState | null = null;
  let publishedQuestState: QuestStateModel | null = null;
  let questKey: { readonly project: ProjectV1; readonly stepId: StepId; readonly view: DatasetView; readonly rules: EffectiveRules } | null = null;
  let changeAt: number | null = null;
  let rewalkFrom = Number.POSITIVE_INFINITY;
  let lastWalkEnd = Number.NEGATIVE_INFINITY;
  let walks = 0;
  let disposed = false;
  let lastModel: NavigationTravelModel | null | undefined;
  /** The committed client tables as loaded so far (checking until each resolves). */
  let taxiState: ClientTableState<ClientTaxi> = { kind: 'checking' };
  let dungeonState: ClientTableState<ClientDungeons> = { kind: 'checking' };
  const placesOf = createPlacesBuilder();
  /** The zone rings and label anchors per world map, once the terrain zone arcs are in (MP.7). */
  let zoneShapes: ReadonlyMap<WorldMapId, ZoneShapes> = new Map();
  let anchors: ReadonlyMap<WorldMapId, ReadonlyMap<number, WorldPoint>> = new Map();
  /** The client zone table and the zone tints (MP.10), as loaded so far. */
  let zonesState: ClientTableState<ClientZones> = { kind: 'checking' };
  let tintsState: ZoneTintsLoad | null = null;
  const zoneFillOf = lastOf((shapes: ReadonlyMap<WorldMapId, ZoneShapes>, zones: ClientTableState<ClientZones>, tints: ZoneTintsLoad | null) =>
    buildZoneFill({
      geometry,
      shapes,
      zones: zones.kind === 'loaded' ? zones.table : null,
      zonesFailure: zones.kind === 'failed' ? zones.reason : null,
      tints: tints?.kind === 'loaded' ? tints.tints : null,
      tintsFailure: tints?.kind === 'failed' ? tints.detail : null,
    }),
  );
  /** The "Viewing" chip's zone lookup over the rings loaded so far (`zoneOfPoint`; the frames where no ring holds a point), once per rings object. */
  const zoneAtOf = lastOf((shapes: ReadonlyMap<WorldMapId, ZoneShapes>) => (point: WorldPoint): UiMapId | null => zoneOfPoint(point, shapes, geometry));
  const labelsOf = lastOf(
    (spans: ZoneSpans, level: number | null, lowerBound: boolean, rules: EffectiveRules, at: typeof anchors, dungeons: PlacesModel['dungeons'], flightPoints: PlacesModel['flightPoints']) =>
      buildMapLabels({ geometry, spans, level: level === null ? null : { level, lowerBound }, rules, anchors: at, dungeons, flightPoints }),
  );

  const rulesOf = lastOf(projectRules);
  const graphOf = lastOf((view: DatasetView, rules: EffectiveRules, docks: readonly UserDock[], taxi: ClientTaxi | null) => projectTravelGraph(view, source.flightMasterIds, rules, docks, taxi));
  /** TIME-6's per-leg data from the loaded taxi file (null: TIME-5). */
  const legsOf = lastOf((taxi: ClientTaxi | null): TaxiLegData | null => (taxi === null ? null : taxiLegDataOf(taxi)));
  const loadedTaxi = (): ClientTaxi | null => (taxiState.kind === 'loaded' ? taxiState.table : null);
  const dungeonsOf = lastOf((faction: ProjectV1['character']['faction']) => {
    const rows = options.data.dungeonRows?.(faction);
    return rows === undefined ? [] : datasetDungeons(rows.zones, rows.dungeons, rows.geometry);
  });
  const mapNames = new Map(surfacesOf(geometry).map((surface) => [surface.mapId as number, surface.name]));
  const mapName = (mapId: number): string => mapNames.get(mapId) ?? `World map ${String(mapId)}`;
  const startKnownOf = lastOf((character: ProjectV1['character'], graph: TravelGraph) => knownNodeKeys(character, graph));
  // Keyed on the runtime only when navigation is available: "checking" and "unavailable" both
  // give the straight-line model, so learning that navigation is unavailable re-walks nothing.
  const travelOf = lastOf((nav: NavigationRuntime | null, detour: number, graph: TravelGraph, faction: ProjectV1['character']['faction'], view: DatasetView) =>
    selectTravelModel({ navigation: nav === null ? NAVIGATION_CHECKING : { kind: 'available', runtime: nav }, detourFactor: detour, graph, faction, dataset: view, geometry }),
  );
  const checksOf = lastOf((view: DatasetView, rules: EffectiveRules) => createAcceptChecks({ dataset: view, rules }));
  const openOf = lastOf((view: DatasetView, race: ProjectV1['character']['race'], cls: ProjectV1['character']['class']) => questsForCharacter(view, { race, class: cls }).open);
  // A subzone's quests count for the zone its area is routed to (the Valley of Trials for Durotar; QA-02).
  let areaZones: ReadonlyMap<number, UiMapId> | undefined;
  const spansOf = lastOf((view: DatasetView, race: ProjectV1['character']['race'], cls: ProjectV1['character']['class']) =>
    zoneSpans(view, geometry, { race, class: cls }, (areaZones ??= options.data.areaZones?.())),
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
    const graph = graphOf(view, rules, docksOf(project), loadedTaxi());
    const legs = legsOf(loadedTaxi());
    const travel = travelOf(runtime(), rules.values.groundDetourFactor.value, graph, project.character.faction, view);
    const c = context;
    if (c !== null && c.view === view && c.baseView === baseView && c.rules === rules && c.graph === graph && c.travel === travel && c.legs === legs) return c;
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
      localTaxi: legs,
    });
    return { view, baseView, rules, graph, legs, travel, walker, validator, tracker };
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

  /**
   * The quest state for the published walk and focus, in a task of its own (after the selection has
   * painted). `delay` > 0 (a selection change) restarts a timer already set, so a moving selection
   * rebuilds once it stops (review UI-04); a 0 ms request keeps whichever timer is set.
   */
  function scheduleQuestState(delay = 0): void {
    if (disposed) return;
    if (questTimer !== null) {
      if (delay === 0) return;
      timers.clear(questTimer);
    }
    questTimer = timers.set(runQuestState, delay);
  }

  function runQuestState(): void {
    if (questTimer !== null) timers.clear(questTimer);
    questTimer = null;
    const c = context;
    const r = results;
    const project = walkedProject;
    if (disposed || c === null || r === null || project === null) return;
    const character = project.character;
    try {
      const spans = spansOf(c.view, character.race, character.class);
      const selected = lastSelected;
      if (selected === null) {
        questKey = null;
        output.publish({ questState: null, zoneSpans: spans, places: buildPlaces(c, r, null, null, spans) });
        return;
      }
      const key = questKey;
      if (key !== null && key.project === r.project && key.stepId === selected.stepId && key.view === c.view && key.rules === c.rules) {
        output.publish({ zoneSpans: spans, places: buildPlaces(c, r, selected, publishedQuestState, spans) });
        return;
      }
      const questState = questStateModel({
        revision: r.revision,
        stepId: selected.stepId,
        stepIndex: selected.index,
        state: selected.after,
        records: r.records,
        dataset: c.view,
        geometry,
        rules: c.rules,
        character,
        checks: checksOf(c.view, c.rules),
        open: openOf(c.view, character.race, character.class),
        spans,
        previous: publishedQuestState,
      });
      publishedQuestState = questState;
      questKey = { project: r.project, stepId: selected.stepId, view: c.view, rules: c.rules };
      output.publish({ questState, zoneSpans: spans, places: buildPlaces(c, r, selected, questState, spans) });
    } catch {
      // The quests stay "open by race and class" (the shell says there is no route state), never a guess.
      questKey = null;
      output.publish({ questState: null });
    }
  }

  /**
   * The map's places and names for the published walk and focus (steps MP.5, MP.7, MP.8, MP.9): the
   * places model, with the labels canvas's names (their cards rated at the character's level after
   * the step); null when they cannot be built (the map then draws none).
   */
  function buildPlaces(c: Context, r: DerivedResults, selected: SelectedStepState | null, questState: QuestStateModel | null, spans: ZoneSpans): PlacesModel | null {
    const project = r.project;
    try {
      const model = placesOf({
        // Until the walk has taken up the loaded file (a new graph), the places say it is loading, so they never mix the two.
        taxi: taxiState.kind === 'loaded' && c.legs === null ? { kind: 'checking' } : taxiState,
        dungeons: dungeonState,
        graph: c.graph,
        legs: c.legs,
        view: c.view,
        datasetDungeons: dungeonsOf(project.character.faction),
        character: project.character,
        rules: c.rules,
        mapName,
        selected: selected === null ? null : { stepId: selected.stepId, after: selected.after },
        records: r.records,
        startKnown: startKnownOf(project.character, c.graph),
        questState,
        serviceNpcIds: options.data.serviceNpcIds?.() ?? [],
      });
      const labels = labelsOf(spans, questState?.level ?? null, questState?.levelLowerBound ?? false, c.rules, anchors, model.dungeons, model.flightPoints);
      // The zone lookup too: the rings name the zone the view is on (review QA-01).
      return { ...model, labels, zoneFill: zoneFillOf(zoneShapes, zonesState, tintsState), zoneAt: zoneAtOf(zoneShapes) };
    } catch {
      return null;
    }
  }

  /** Loads the committed client tables once (never fatally); the taxi file re-seeds the graph and re-walks, the dungeon table rebuilds the places. */
  function loadClientTables(): void {
    const given = options.clientTables ?? null;
    if (given === null) {
      taxiState = { kind: 'failed', reason: 'this build loads no client tables' };
      dungeonState = { kind: 'failed', reason: 'this build loads no client tables' };
      return;
    }
    const tables: ClientTableLoaders =
      'resources' in given
        ? { ...createClientTables(given.resources), zoneArcs: () => loadZoneArcs(createMapResources(given.resources)), tints: createZoneTints(given.resources) }
        : given;
    void tables.zones?.().then(
      (load) => {
        if (disposed) return;
        zonesState = load.kind === 'loaded' ? { kind: 'loaded', table: load.table } : { kind: 'failed', reason: load.detail };
        scheduleQuestState();
      },
      (error: unknown) => {
        if (disposed) return;
        zonesState = { kind: 'failed', reason: messageOf(error) };
        scheduleQuestState();
      },
    );
    void tables.tints?.().then(
      (load) => {
        if (disposed) return;
        tintsState = load;
        scheduleQuestState();
      },
      () => undefined,
    );
    void tables.zoneArcs?.().then(
      (files) => {
        if (disposed || files.length === 0) return;
        zoneShapes = new Map(files.map((file) => [file.mapId, zoneShapesOf(file.mapId, file.lines, file.sides)]));
        anchors = new Map([...zoneShapes].map(([mapId, shapes]) => [mapId, shapes.anchors]));
        scheduleQuestState();
      },
      () => undefined,
    );
    void tables.taxi().then(
      (load) => {
        if (disposed) return;
        taxiState = load.kind === 'loaded' ? { kind: 'loaded', table: load.table } : { kind: 'failed', reason: load.detail };
        // A new graph and TIME-6 (or the final TIME-5): the next walk starts a new walker; the places follow it.
        changeAt ??= now();
        scheduleWalk();
      },
      (error: unknown) => {
        if (disposed) return;
        taxiState = { kind: 'failed', reason: messageOf(error) };
        // TIME-5 is now final: walk again so the results say so (`final`, `taxiPending`).
        changeAt ??= now();
        scheduleWalk();
      },
    );
    void tables.dungeons().then(
      (load) => {
        if (disposed) return;
        dungeonState = load.kind === 'loaded' ? { kind: 'loaded', table: load.table } : { kind: 'failed', reason: load.detail };
        scheduleQuestState();
      },
      (error: unknown) => {
        if (disposed) return;
        dungeonState = { kind: 'failed', reason: messageOf(error) };
        scheduleQuestState();
      },
    );
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
        // TIME-5, TIME-6: while the taxi file loads, flights are straight lines until the walk after it (TR-07).
        taxiPending: taxiState.kind === 'checking',
        final: pendingSteps === 0 && metrics.pendingLegs === 0 && travel.model !== 'checking' && taxiState.kind !== 'checking',
        walkedFrom: walk.fromIndex,
        timing: { walkMs: walked - start, metricsMs: measured - walked, sinceChangeMs: 0 },
        shortIssue: shortenerOf(c.view),
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
      lastSelected = selected;
      scheduleQuestState();
      lastWalkEnd = now();
      options.onPublished?.(published);
      notifyModel(c);
      afterWalk(c, published);
    } catch (error) {
      // Start the next walk afresh: the walker's state may be half-way through a step.
      context = null;
      changeAt = null;
      lastWalkEnd = now();
      lastSelected = null;
      questKey = null;
      output.publish({ status: 'failed', failure: `The route could not be simulated: ${messageOf(error)}`, questState: null });
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
      lastSelected = selectedOf(selectedFocus);
      output.publish({ selected: lastSelected });
      scheduleQuestState(selectionSettleMs);
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
  loadClientTables();
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
      if (questTimer !== null) runQuestState();
    },
    checkpointIndices: () => context?.walker.checkpointIndices() ?? [],
    get walks() {
      return walks;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimers();
      if (questTimer !== null) timers.clear(questTimer);
      questTimer = null;
      cancelStart();
      unsubscribeStore();
      unsubscribeBatches?.();
      run?.controller.abort(new DOMException('The pipeline was disposed', 'AbortError'));
      run = null;
    },
  };
}
