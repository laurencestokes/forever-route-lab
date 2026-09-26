import type { DatasetView, PublishedPoint, QuestId, RouteStep, StepId, UiMapId, WorldMapId, WorldPoint } from '../domain';
import { zoneFramesContaining, type MapGeometry } from '../geo';
import type { LocalArt, LocalArtEntry, LocalArtLoad } from '../infra/maps';
import {
  EMPTY_LAYER_STATS,
  LAYER_IDS,
  labelOf,
  mapViewOf,
  SPAWN_LAYER_IDS,
  surfaceIdOf,
  surfaceMapId,
  type ArtInput,
  type HighlightTarget,
  type LayerContent,
  type LayerId,
  type LayerStats,
  type LineStyle,
  type MapAdapter,
  type MapAdapterFactory,
  type MapContainer,
  type MapDescriptor,
  type MapEvent,
  type MapHit,
  type MapLabelProvider,
  type MapRef,
  type MapView,
  type MapViewState,
  type MarkerBadge,
  type RouteInput,
  type StepPlacement,
  type SurfaceId,
  type SurfaceInfo,
  type UnplacedReason,
  type WorldBounds,
} from '../map/adapter';
import { createMapLayers, groupDigits, layerStatsNotes, plainEqual, type LodOverrides, type MapLayers } from '../map/layers';
import { type DatasetSource, datasetViewInputOf } from './dataset-source';
import {
  createDrawnRouteFilter,
  createRouteInputBuilder,
  firstRouteSurface,
  flightMasterModel,
  focusQuestIds,
  focusWithin,
  legUnknownAt,
  objectiveModel,
  questGiverModel,
  routeBoundsOn,
  routeMapSummary,
  routeStepIndex,
  routeStepOf,
  stepFocusOf,
  stepsWithoutSurface,
  turnInModel,
  zoneBounds,
  zoneGroups,
  type FlightMasterModel,
  type GiverLayerModel,
  type QuestPointsModel,
  type RouteMapSummary,
  type ZoneGroup,
} from './map-model';
import { normaliseQuestIds, openQuestsInDetails, patchMapUi, type MapUiPatch } from './map-view';
import type { EditorState, EditorStore } from './store';

/**
 * The map controller (docs/ARCHITECTURE.md §7, §12.1; docs/UI.md §12): framework-agnostic glue
 * between the editor store and one `MapAdapter`. React only mounts it (src/ui/app/MapPanel.tsx).
 *
 * - **Store → map.** On every store change it derives each layer's inputs (memoised on what they
 *   depend on: the route's steps, the dataset view, the character, the focused quests, the
 *   selection), builds the layers with `createMapLayers` (memoised per layer and view) and calls
 *   `setLayer` only for a layer whose content object changed. Layer visibility follows the store.
 *   A selection change also moves the active step to the new focus in the same sync, so the shell
 *   reporting that step afterwards (`setActiveStep`) syncs nothing more (M3 review PERF-6).
 * - **Labels.** Route descriptors carry step ids, never numbers (MAPS §7.3); the controller is the
 *   adapter's label provider (`MapAdapterOptions.label`) and numbers steps from the current route
 *   order when a label is shown, adding what a marker's badges mean (UI.md §4).
 * - **Map → store.** Surface and zoom band go to the store's map view state; hover stays here
 *   (`getHover`), out of the store every panel reads (PERF-14). A click on a step marker, a route
 *   line, a transition or departure glyph selects the step; a click on a quest giver, objective,
 *   turn-in or flight master opens its quests in Details; a merged marker (several items at one
 *   point) with different outcomes offers a choice (`getStatus().choice`); a click on empty map at
 *   continent zoom jumps to the zone frame the point is most central in (`zoneFramesContaining`,
 *   coordinates.md §15).
 * - **Commands:** focus a step, fit the route, jump to a zone (at zone zoom or closer, so the zone
 *   shows its points), show a surface, highlight the markers of hovered route rows. The map follows
 *   the active step: when it changes, the map brings it into view (`focus`, which pans only when the
 *   point is not comfortably visible). The zone jumped to stays emphasised until it is panned out
 *   of view or the surface changes.
 * - **Local art** (dev/preview only, D-018): only the images the art layer draws at this level of
 *   detail are loaded and verified (`LocalArt.load`): the continent image zoomed out, the zone
 *   images in view zoomed in. They are drawn from object URLs of the verified bytes, revoked on
 *   detach.
 * - **Timing:** `frl:map:sync` (User Timing) measures a store change or view change to the last
 *   `setLayer`, with the trigger and the layers set as its detail (ARCHITECTURE §14: one route
 *   edit applied ≤ 8 ms); at most `MAX_SYNC_MEASURES` are kept. The adapter measures its own diff,
 *   path update and redraw.
 */

/** The part of `Performance` the controller uses (User Timing). */
export interface MapTiming {
  mark(name: string): unknown;
  measure(name: string, options: { readonly start: string; readonly end: string; readonly detail?: unknown }): unknown;
  clearMarks(name?: string): void;
  clearMeasures(name?: string): void;
}

/** The `frl:map:sync` measures kept on the timeline; older ones are cleared (as the adapter's perf.ts does). */
export const MAX_SYNC_MEASURES = 500;

/** Object URLs for verified art bytes (`URL.createObjectURL` in the browser). */
export interface ObjectUrls {
  create(blob: Blob): string;
  revoke(url: string): void;
}

export interface MapControllerOptions {
  readonly store: EditorStore;
  readonly data: DatasetSource;
  /** The geometry resolution uses: the placeholder, or it merged with a compatible local set. */
  readonly geometry: MapGeometry;
  /** The local set's art; null or omitted for none. */
  readonly art?: LocalArt | null | undefined;
  /** A step's hover text from its current position, for example `12 · Accept: Your Place in the World`. */
  readonly describeStep: (step: RouteStep, index: number, dataset: DatasetView) => string;
  readonly lod?: LodOverrides | undefined;
  /** Default: `URL.createObjectURL` / `revokeObjectURL` where they exist. */
  readonly objectUrls?: ObjectUrls | null | undefined;
  /** Where the `frl:map:sync` measures go; default the page's `performance`, null for none. */
  readonly timing?: MapTiming | null | undefined;
}

/** What a layer panel says about one layer. */
export interface MapLayerStatus {
  readonly layer: LayerId;
  readonly visible: boolean;
  /** Why the layer cannot be shown (nothing can be in it here); null when it can. */
  readonly unavailable: string | null;
  /** The last content's counts on the shown surface. */
  readonly stats: LayerStats;
  /** Honest sentences: what is not drawn and why, and what the layer covers. */
  readonly notes: readonly string[];
}

/** One item of a merged marker the user can choose (`MapStatus.choice`). */
export interface MapChoiceOption {
  /** The item's hover text (step numbers from the current order, badge meanings included). */
  readonly label: string;
}

/**
 * Several items at one point whose clicks would do different things (a stack of steps, the quest
 * givers at a dungeon entrance): the UI lists them near the point and runs the one chosen
 * (`MapController.choose`, `chooseAll`, `dismissChoice`).
 */
export interface MapChoice {
  /** `6 steps here`, `7 quest givers here`. */
  readonly title: string;
  /** What choosing does: `Choose one to select its step.` */
  readonly hint: string;
  readonly options: readonly MapChoiceOption[];
  /** `Select all 6 steps`, `Open all 9 quests in Details`; null when there is no single "all" action. */
  readonly allLabel: string | null;
  /** The stack's place in stage pixels from the top left, with the stage's size; null when the map has no view. */
  readonly at: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
}

export interface MapStatus {
  /** A mounted adapter is attached. */
  readonly attached: boolean;
  /** Why the last `attach` failed (the engine threw while starting), or null. */
  readonly failure: string | null;
  readonly surface: SurfaceId | null;
  /** Layers in `LAYER_IDS` order. */
  readonly layers: readonly MapLayerStatus[];
  readonly route: RouteMapSummary & {
    /** Placed steps on the shown surface. */
    readonly onSurface: number;
    /** Placed steps on world maps no surface shows (they cannot be drawn anywhere here). */
    readonly noSurface: number;
    /** Whether "fit route" has anything to fit (a placed step on a surface). */
    readonly canFit: boolean;
  };
  /** Local art drawn on the shown surface (verified images). */
  readonly artDrawn: number;
  /** Where the active step is (for "focus step"), or null when no step is active. */
  readonly activeStep: { readonly stepId: StepId; readonly number: number; readonly placement: ActivePlacement } | null;
  /** A merged marker's items waiting for the user's choice, or null. */
  readonly choice: MapChoice | null;
}

/** An active step's placement, without its point. */
export type ActivePlacement =
  | { readonly kind: 'point'; readonly surface: SurfaceId }
  /** Placed, but on a world map with no surface here (MAP-UX-9). */
  | { readonly kind: 'no-surface'; readonly mapId: WorldMapId }
  | { readonly kind: 'none' }
  | { readonly kind: 'unknown'; readonly reason: UnplacedReason };

/** What the composition root hands the shell for the map. */
export interface MapEngineSetup {
  /** The geometry resolution uses (`LoadedGeometry.geometry`: the placeholder, or it merged with a compatible local set). */
  readonly geometry: MapGeometry;
  /** The compatible local set's art (`LoadedGeometry.art`), or null. */
  readonly art: LocalArt | null;
  /** Loads the map engine (Leaflet, in its own chunk) and resolves to its adapter factory. */
  readonly loadAdapter: () => Promise<MapAdapterFactory>;
}

export type FocusStepResult =
  | { readonly kind: 'focused'; readonly surface: SurfaceId }
  | { readonly kind: 'not-in-route' }
  /** The step has no location and does not move the character (a note, a quest step without one). */
  | { readonly kind: 'no-location' }
  /** The step's location cannot be placed (or it moves the character somewhere unknown). */
  | { readonly kind: 'not-placed'; readonly reason: UnplacedReason }
  /** Its world map has no surface. */
  | { readonly kind: 'no-surface'; readonly mapId: WorldMapId };

export type FitRouteResult =
  | { readonly kind: 'fitted'; readonly surface: SurfaceId; readonly steps: number }
  | { readonly kind: 'nothing-to-fit' };

export interface MapController {
  readonly surfaces: readonly SurfaceInfo[];
  /** Jump-to-zone choices, grouped by surface. */
  readonly zoneGroups: readonly ZoneGroup[];
  /**
   * Mounts the map into `el`: the first call creates the adapter with `factory` (later calls
   * mount the same adapter again, so views and content survive a remount). Subscribes to the store.
   * False when the engine threw while starting; `getStatus().failure` says what happened.
   */
  readonly attach: (factory: MapAdapterFactory, el: MapContainer) => boolean;
  /** Unmounts the adapter, unsubscribes from the store and revokes art object URLs. */
  readonly detach: () => void;
  /** The step the rest of the shell shows as active (the route list's active row); the map follows it. */
  readonly setActiveStep: (id: StepId | null) => void;
  readonly showSurface: (surface: SurfaceId) => boolean;
  readonly focusStep: (id: StepId) => FocusStepResult;
  readonly fitRoute: () => FitRouteResult;
  /**
   * Shows the zone (switching surface when needed): its frame fitted, at the level of detail's zone
   * zoom or closer, so its quest points are drawn raw. False when it has no single frame.
   */
  readonly jumpToZone: (id: UiMapId) => boolean;
  /** Highlights the step markers of the route rows under the pointer; null or empty clears it. */
  readonly hoverSteps: (ids: readonly StepId[] | null) => void;
  /** Runs one option of the pending choice (`getStatus().choice`) and closes it. */
  readonly choose: (index: number) => void;
  /** Runs the pending choice's "all" action and closes it. */
  readonly chooseAll: () => void;
  readonly dismissChoice: () => void;
  /** The adapter's label provider: numbered hover text for a ref, or null to keep the descriptor's own. */
  readonly labelFor: MapLabelProvider;
  readonly getStatus: () => MapStatus;
  /** Calls `listener` whenever `getStatus()` changes. */
  readonly subscribe: (listener: () => void) => () => void;
  /** What the pointer is over on the map, as the tooltip says it; null for nothing. */
  readonly getHover: () => string | null;
  /** Calls `listener` whenever `getHover()` changes (kept apart from the status: it changes on every marker crossed). */
  readonly subscribeHover: (listener: () => void) => () => void;
}

/** "Fit route" never zooms in past this (a route of one step would otherwise fill the view at the maximum zoom). */
export const FIT_ROUTE_MAX_ZOOM = -1.5;
/** A click on an aggregate glyph outside any known zone zooms in to this (zone zoom, MAPS §7.2). */
export const AGGREGATE_ZOOM = -2.5;

/** What a marker's badges mean, appended to its hover text (MAP-A11Y-10). */
export const BADGE_TEXT: Readonly<Record<MarkerBadge, string>> = {
  instance: 'inside an instance: drawn at its entrance',
  'off-frame': 'outside its zone’s map frame',
  'leg-unknown': 'leg unknown: an earlier step could not be placed',
};

/** Line and glyph words in hover text (as map/layers labels them, without step numbers). */
const LINE_WORDS: Readonly<Record<LineStyle, string>> = {
  route: 'Route',
  transport: 'Transport',
  flight: 'Flight',
  hearth: 'Hearthstone',
  highlight: 'Selected leg',
  proposal: 'Proposed route',
};

/** How the items of a merged marker are called in its choice. */
const CHOICE_NOUNS: Readonly<Record<LayerId, readonly [string, string]>> = {
  art: ['image', 'images'],
  'zone-frames': ['frame', 'frames'],
  'available-quests': ['quest giver', 'quest givers'],
  objectives: ['objective target', 'objective targets'],
  'turn-ins': ['turn-in', 'turn-ins'],
  'flight-masters': ['flight master', 'flight masters'],
  'route-line': ['route glyph', 'route glyphs'],
  'route-steps': ['step', 'steps'],
  proposal: ['proposal glyph', 'proposal glyphs'],
  selection: ['selected step', 'selected steps'],
};

const NO_ART: readonly ArtInput[] = [];

const UNAVAILABLE: Partial<Readonly<Record<LayerId, string>>> = {
  proposal: 'No proposal is open (proposals arrive with the optimiser, Milestones 7 and 8)',
};

const plural = (n: number, one: string, many: string): string => `${groupDigits(n)} ${n === 1 ? one : many}`;

const withBadges = (text: string, badges: readonly string[]): string => (badges.length === 0 ? text : `${text} (${badges.join('; ')})`);

/** Remembers the last result of `compute` and returns it while every argument is the same (`Object.is`). */
function lastOf<A extends readonly unknown[], R>(compute: (...args: A) => R): (...args: A) => R {
  let last: { readonly args: A; readonly result: R } | null = null;
  return (...args) => {
    if (last !== null && last.args.length === args.length && last.args.every((value, i) => Object.is(value, args[i]))) return last.result;
    const result = compute(...args);
    last = { args, result };
    return result;
  };
}

function defaultObjectUrls(): ObjectUrls | null {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  return { create: (blob) => URL.createObjectURL(blob), revoke: (url) => URL.revokeObjectURL(url) };
}

function defaultTiming(): MapTiming | null {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function' || typeof performance.measure !== 'function') return null;
  return performance;
}

const ART_REFUSED_TEXT: Readonly<Record<Extract<LocalArtLoad, { kind: 'refused' }>['reason'], string>> = {
  'not-listed': 'not listed by the local set',
  unavailable: 'could not be fetched (tried again on the next visit to this map)',
  changed: 'changed after the set was activated',
  malformed: 'not the image the manifest describes',
};

type Rect = { readonly xMin: number; readonly xMax: number; readonly yMin: number; readonly yMax: number };

const rectsMeet = (a: Rect, b: Rect): boolean => a.xMin <= b.xMax && a.xMax >= b.xMin && a.yMin <= b.yMax && a.yMax >= b.yMin;

/** Squared distance from a point to a rectangle (0 inside). */
function distanceSqTo(rect: Rect, x: number, y: number): number {
  const dx = x < rect.xMin ? rect.xMin - x : x > rect.xMax ? x - rect.xMax : 0;
  const dy = y < rect.yMin ? rect.yMin - y : y > rect.yMax ? y - rect.yMax : 0;
  return dx * dx + dy * dy;
}

/** A world point in stage pixels (x east from the left edge, y south from the top), or null for a degenerate view. */
export function stagePixelOf(view: MapViewState, point: WorldPoint): { readonly x: number; readonly y: number } | null {
  const b = view.bounds;
  if (b.yMax <= b.yMin || b.xMax <= b.xMin) return null;
  // World y grows west and x north (coordinates.md §2): east is decreasing y, south decreasing x.
  return { x: ((b.yMax - point.y) / (b.yMax - b.yMin)) * view.widthPx, y: ((b.xMax - point.x) / (b.xMax - b.xMin)) * view.heightPx };
}

/** Where a spawn marker's point came from, for its badges (as map/layers derives them). */
function spawnBadges(source: PublishedPoint | null): readonly MarkerBadge[] {
  if (source === null) return [];
  if (!('space' in source)) return source.kind === 'instance' ? ['instance'] : [];
  if (source.space === 'zone' && (source.x < 0 || source.x > 100 || source.y < 0 || source.y > 100)) return ['off-frame'];
  return [];
}

/** What a click on one ref does. */
type RefAction =
  | { readonly kind: 'select'; readonly stepId: StepId }
  | { readonly kind: 'open'; readonly questIds: readonly QuestId[] }
  | { readonly kind: 'zone'; readonly uiMapId: UiMapId }
  | { readonly kind: 'focus'; readonly point: WorldPoint };

const actionKey = (action: RefAction): string => {
  switch (action.kind) {
    case 'select':
      return `select:${action.stepId}`;
    case 'open':
      return `open:${normaliseQuestIds(action.questIds).join(',')}`;
    case 'zone':
      return `zone:${String(action.uiMapId)}`;
    case 'focus':
      return `focus:${String(action.point.mapId)}:${String(action.point.x)}:${String(action.point.y)}`;
  }
};

type Pending =
  | { readonly kind: 'focus'; readonly stepId: StepId }
  | { readonly kind: 'fit'; readonly bounds: WorldBounds; readonly maxZoom: number | undefined; readonly minZoom: number | undefined; readonly zone: UiMapId | null }
  | { readonly kind: 'surface'; readonly surface: SurfaceId };

interface OpenChoice {
  readonly choice: MapChoice;
  readonly actions: readonly RefAction[];
  /** Select every step of the stack, or one action for all its items; null for none. */
  readonly all: { readonly kind: 'steps'; readonly ids: readonly StepId[] } | { readonly kind: 'action'; readonly action: RefAction } | null;
}

export function createMapController(options: MapControllerOptions): MapController {
  const { store, data, geometry } = options;
  const art = options.art ?? null;
  const layers: MapLayers = createMapLayers(options.lod === undefined ? { geometry } : { geometry, lod: options.lod });
  const surfaces = layers.surfaces;
  const zones = zoneGroups(geometry, surfaces);
  const objectUrls = options.objectUrls === undefined ? defaultObjectUrls() : options.objectUrls;
  const timing = options.timing === undefined ? defaultTiming() : options.timing;

  let adapter: MapAdapter | null = null;
  let mounted = false;
  let failure: string | null = null;
  let everMounted = false;
  let unsubscribeStore: (() => void) | null = null;
  let view: MapView | null = null;
  let activeStep: StepId | null = null;
  let followed: StepId | null = null;
  /** The selection focus the last store change had: a new one moves the active step with it. */
  let lastFocus: StepId | null = store.getState().selection.focus;
  let quiet = 0;
  let serial = 0;
  let syncMeasures = 0;
  /** A command given before the adapter exists (the map engine is still loading), applied once it does. */
  let pending: Pending | null = null;
  /** The zone whose fit is being applied: the views passed on the way do not clear it. */
  let zoneFit: UiMapId | null = null;
  let choice: OpenChoice | null = null;
  const sent = new Map<LayerId, LayerContent>();
  const contents = new Map<LayerId, LayerContent>();
  const listeners = new Set<() => void>();

  // Hover: text for the status line; highlights for the map pointer and hovered route rows.
  let hoverText: string | null = null;
  const hoverListeners = new Set<() => void>();
  let mapHovering = false;
  let rowSteps: ReadonlySet<StepId> | null = null;
  let rowTarget: HighlightTarget | null = null;

  // Local art: requested loads, verified object URLs, refusals.
  const artRequested = new Set<UiMapId>();
  const artUrls = new Map<UiMapId, string>();
  const artRefused = new Map<UiMapId, string>();
  let artInputs: readonly ArtInput[] = NO_ART;
  let artInputsKey = '';
  let artGeneration = 0;

  // Memoised view models ---------------------------------------------------------------------

  const datasetOf = (state: EditorState): DatasetView => data.view(datasetViewInputOf(state.project));
  const routeOf = createRouteInputBuilder(geometry);
  /** What the route layers draw from: the route without steps they skip, so a note edit rebuilds none of them. */
  const drawnOf = createDrawnRouteFilter();
  const drawnIdsOf = lastOf((route: RouteInput): ReadonlySet<StepId> => new Set(route.steps.map((step) => step.stepId)));
  const positionsOf = lastOf((steps: readonly RouteStep[]): ReadonlyMap<StepId, number> => new Map(steps.map((step, index) => [step.id, index])));
  type Character = EditorState['project']['character'];
  const giversOf = lastOf((dataset: DatasetView, race: Character['race'], cls: Character['class']): GiverLayerModel =>
    questGiverModel(dataset, { race, class: cls }),
  );
  const focusKeyOf = lastOf((ids: readonly QuestId[]): string => [...new Set(ids)].sort((a, b) => a - b).join(','));
  const questIdsOfKey = (key: string): readonly QuestId[] => (key === '' ? [] : key.split(',').map((id) => Number(id) as QuestId));
  const objectivesOf = lastOf((dataset: DatasetView, key: string): QuestPointsModel => objectiveModel(dataset, geometry, questIdsOfKey(key)));
  const turnInsOf = lastOf((dataset: DatasetView, key: string): QuestPointsModel => turnInModel(dataset, questIdsOfKey(key)));
  const flightMastersOf = lastOf(
    (dataset: DatasetView, faction: Character['faction'], race: Character['race'], cls: Character['class']): FlightMasterModel =>
      flightMasterModel(dataset, data.flightMasterIds, { faction, race, class: cls }),
  );
  const summaryOf = lastOf((route: RouteInput) => routeMapSummary(route));

  const activeStepOf = (state: EditorState): RouteStep | null =>
    activeStep === null ? null : (state.project.route.steps.find((step) => step.id === activeStep) ?? null);

  // Labels -----------------------------------------------------------------------------------

  const surfaceName = (mapId: WorldMapId): string => surfaces.find((surface) => surface.mapId === mapId)?.name ?? `World map ${String(mapId)}`;

  /** Spawn hover text by ref object: a descriptor's refs keep their identity while its content is unchanged. */
  const spawnLabels = new WeakMap<MapRef, string | null>();

  function spawnSource(ref: Extract<MapRef, { readonly kind: 'spawn' }>, dataset: DatasetView): PublishedPoint | null {
    const subject = ref.subject;
    if (subject.kind === 'event') {
      const objective = dataset.quest(subject.questId)?.objectives[subject.objective];
      return objective?.kind === 'event' ? (objective.points[ref.spawnIndex] ?? null) : null;
    }
    const spawns = subject.kind === 'npc' ? dataset.spawns({ kind: 'npc', id: subject.id }) : dataset.spawns({ kind: 'object', id: subject.id });
    return spawns[ref.spawnIndex]?.source ?? null;
  }

  function spawnLabel(ref: Extract<MapRef, { readonly kind: 'spawn' }>): string | null {
    const cached = spawnLabels.get(ref);
    if (cached !== undefined) return cached;
    for (const layer of SPAWN_LAYER_IDS) {
      for (const item of contents.get(layer)?.items ?? []) {
        if (item.type !== 'marker') continue;
        const index = item.refs.indexOf(ref);
        if (index < 0) continue;
        const own = item.labels[index] ?? null;
        const badges = spawnBadges(spawnSource(ref, datasetOf(store.getState()))).map((badge) => BADGE_TEXT[badge]);
        const text = own === null ? null : withBadges(own, badges);
        spawnLabels.set(ref, text);
        return text;
      }
    }
    return null;
  }

  function labelFor(ref: MapRef): string | null {
    const state = store.getState();
    const steps = state.project.route.steps;
    const positions = positionsOf(steps);
    const numberOf = (id: StepId): string | null => {
      const index = positions.get(id);
      return index === undefined ? null : groupDigits(index + 1);
    };
    const fromTo = (from: StepId, to: StepId): string | null => {
      const a = numberOf(from);
      const b = numberOf(to);
      return a === null || b === null ? null : `step ${a} to step ${b}`;
    };
    switch (ref.kind) {
      case 'step': {
        const index = positions.get(ref.stepId);
        const step = index === undefined ? undefined : steps[index];
        if (index === undefined || step === undefined) return null;
        const route = routeOf(steps);
        const placement = route.steps[index]?.placement;
        const badges: string[] = [];
        if (placement?.kind === 'point' && placement.offFrame) badges.push(BADGE_TEXT['off-frame']);
        if (legUnknownAt(route, index)) badges.push(BADGE_TEXT['leg-unknown']);
        return withBadges(options.describeStep(step, index, datasetOf(state)), badges);
      }
      case 'run': {
        const first = ref.stepIds[0];
        const last = ref.stepIds.at(-1);
        const a = first === undefined ? null : numberOf(first);
        const b = last === undefined ? null : numberOf(last);
        if (a === null || b === null) return null;
        return `${LINE_WORDS[ref.style]}: ${a === b ? `step ${a}` : `steps ${a}–${b}`}`;
      }
      case 'leg': {
        const span = fromTo(ref.fromStepId, ref.toStepId);
        return span === null ? null : `${LINE_WORDS.highlight}: ${span}`;
      }
      case 'transition': {
        const span = fromTo(ref.fromStepId, ref.toStepId);
        if (span === null) return null;
        const where = ref.end === 'departure' ? `to ${surfaceName(ref.toMapId)}` : `from ${surfaceName(ref.fromMapId)}`;
        return `${LINE_WORDS[ref.leg]} ${where}: ${span}`;
      }
      case 'departure': {
        const n = numberOf(ref.stepId);
        return n === null ? null : `Step ${n}: ${LINE_WORDS[ref.leg]} (destination unknown until simulation)`;
      }
      case 'spawn':
        return spawnLabel(ref);
      case 'aggregate':
      case 'zone':
      case 'surface':
      case 'art':
        return null;
    }
  }

  const descriptorOf = (layer: LayerId, id: string): MapDescriptor | undefined => contents.get(layer)?.items.find((item) => item.id === id);

  // Status -----------------------------------------------------------------------------------

  let status: MapStatus = buildStatus(store.getState());

  function currentMapId(): WorldMapId | null {
    const surface = adapter?.getSurface() ?? null;
    return surface === null ? null : surfaceMapId(surface);
  }

  function layerNotes(layer: LayerId, state: EditorState, stats: LayerStats): readonly string[] {
    const dataset = datasetOf(state);
    const character = state.project.character;
    const notes: string[] = [];
    switch (layer) {
      case 'available-quests': {
        const givers = giversOf(dataset, character.race, character.class);
        notes.push(`Givers of the ${groupDigits(givers.openQuests)} quests open to the character by race and class (as in the Available tab).`);
        if (givers.itemStarted > 0) notes.push(`${groupDigits(givers.itemStarted)} start from an item: no map position.`);
        if (givers.noStarter > 0) notes.push(`${groupDigits(givers.noStarter)} have no starter in the dataset.`);
        if (givers.spawnlessGivers > 0) {
          const quests = givers.spawnlessQuests > 0 ? `: ${plural(givers.spawnlessQuests, 'quest has', 'quests have')} no giver marker` : '';
          notes.push(`${plural(givers.spawnlessGivers, 'quest giver has', 'quest givers have')} no spawn in the dataset${quests}.`);
        }
        break;
      }
      case 'objectives':
      case 'turn-ins': {
        const key = focusKeyOf(focusQuestIds(state.view.openedQuests, state.selection, activeStepOf(state)));
        const model = layer === 'objectives' ? objectivesOf(dataset, key) : turnInsOf(dataset, key);
        if (model.questIds.length === 0) notes.push('Select a quest step, or open a quest in Details, to see where its work is done.');
        else {
          const names = model.questIds.map((id) => dataset.quest(id)?.name ?? `Quest ${String(id)}`);
          notes.push(`For ${names.length === 1 ? (names[0] ?? '') : `${groupDigits(names.length)} quests`}.`);
        }
        const [one, many] = layer === 'objectives' ? ['objective', 'objectives'] : ['turn-in', 'turn-ins'];
        if (model.noPosition > 0) notes.push(`${plural(model.noPosition, one, many)} ${model.noPosition === 1 ? 'has' : 'have'} no map position (reputation, spells, items without a listed source).`);
        if (model.spawnless > 0) notes.push(`${plural(model.spawnless, one, many)} ${model.spawnless === 1 ? 'has' : 'have'} no spawn in the dataset: not drawn.`);
        if (model.missingQuests > 0) notes.push(`${groupDigits(model.missingQuests)} quests are not in the dataset.`);
        break;
      }
      case 'flight-masters': {
        const model = flightMastersOf(dataset, character.faction, character.race, character.class);
        if (model.otherFaction > 0) notes.push(`${groupDigits(model.otherFaction)} of the other faction not shown.`);
        if (model.factionUnknown > 0) notes.push(`${groupDigits(model.factionUnknown)} with an unknown faction are shown and say so.`);
        if (model.spawnless > 0) notes.push(`${plural(model.spawnless, 'flight master has', 'flight masters have')} no spawn in the dataset.`);
        break;
      }
      case 'art': {
        if (art !== null && art.status.kind === 'listed') {
          notes.push(`${groupDigits(art.status.count)} images in the local set; only those drawn at this level of detail are loaded and verified; never deployed.`);
          for (const [uiMapId, reason] of artRefused) notes.push(`UiMap ${String(uiMapId)} art ${reason}.`);
        }
        break;
      }
      case 'zone-frames':
        notes.push('Schematic: zone rectangles from the committed geometry, not zone borders or terrain.');
        break;
      case 'route-line':
      case 'route-steps':
      case 'proposal':
      case 'selection':
        break;
    }
    notes.push(...layerStatsNotes(stats, layer));
    return notes;
  }

  function artUnavailable(): string | null {
    if (art === null) return 'No local map set: the map shows zone frames, not terrain';
    switch (art.status.kind) {
      case 'none':
        return `No local map art (${art.status.detail})`;
      case 'refused':
        return `Local map art refused: ${art.status.detail}`;
      case 'listed':
        return null;
    }
  }

  function activePlacementOf(placement: StepPlacement): ActivePlacement {
    switch (placement.kind) {
      case 'point': {
        const surface = surfaceIdOf(placement.world.mapId);
        return surfaces.some((info) => info.id === surface) ? { kind: 'point', surface } : { kind: 'no-surface', mapId: placement.world.mapId };
      }
      case 'none':
        return { kind: 'none' };
      case 'unknown':
        return { kind: 'unknown', reason: placement.reason };
    }
  }

  function buildStatus(state: EditorState): MapStatus {
    const route = routeOf(state.project.route.steps);
    const summary = summaryOf(route);
    const mapId = currentMapId();
    const onSurface = mapId === null ? 0 : (summary.maps.find((entry) => entry.mapId === mapId)?.steps ?? 0);
    const noSurface = stepsWithoutSurface(summary, surfaces);
    const layerStatus = LAYER_IDS.map((layer): MapLayerStatus => {
      const stats = contents.get(layer)?.stats ?? EMPTY_LAYER_STATS;
      return {
        layer,
        visible: state.view.map.layers[layer],
        unavailable: layer === 'art' ? artUnavailable() : (UNAVAILABLE[layer] ?? null),
        stats,
        notes: layerNotes(layer, state, stats),
      };
    });
    const artDrawn = contents.get('art')?.stats.drawn ?? 0;
    const index = activeStep === null ? null : routeStepIndex(route, activeStep);
    const active = index === null ? undefined : route.steps[index];
    return {
      attached: mounted,
      failure,
      surface: adapter?.getSurface() ?? null,
      layers: layerStatus,
      route: { ...summary, onSurface, noSurface, canFit: summary.placed - noSurface > 0 },
      artDrawn,
      activeStep: index === null || active === undefined ? null : { stepId: active.stepId, number: index + 1, placement: activePlacementOf(active.placement) },
      choice: choice?.choice ?? null,
    };
  }

  function publish(state: EditorState): void {
    const next = buildStatus(state);
    if (plainEqual(next, status)) return;
    status = next;
    for (const listener of [...listeners]) listener();
  }

  function setHover(text: string | null): void {
    if (text === hoverText) return;
    hoverText = text;
    for (const listener of [...hoverListeners]) listener();
  }

  // Store writes -----------------------------------------------------------------------------

  /** Writes to the store without the store listener's own sync; the caller syncs once afterwards. */
  function quietly(run: () => void): void {
    quiet += 1;
    try {
      run();
    } finally {
      quiet -= 1;
    }
  }

  function patchUi(patch: MapUiPatch): void {
    const current = store.getState().view.map;
    const next = patchMapUi(current, patch);
    if (next !== current) quietly(() => store.setView({ map: next }));
  }

  function viewPatch(state: MapViewState): MapUiPatch {
    return { surface: state.surface, zoomBand: layers.lodLevel(state.zoom) };
  }

  /** Whether the zone jumped to is still worth emphasising in this view: on its surface and (for a settled view) in sight. */
  function zoneShown(zone: UiMapId, shown: MapViewState, settled: boolean): boolean {
    const bounds = zoneBounds(geometry, zone);
    if (bounds === null || bounds.mapId !== shown.mapId) return false;
    return !settled || rectsMeet(bounds, shown.bounds);
  }

  // Art --------------------------------------------------------------------------------------

  /**
   * The local images the art layer draws in this view (M3 review PERF-9): zoomed out, the
   * continent image (else the zone images in view); zoomed in, the zone images in view, nearest the
   * centre first up to the art budget (else the continent image).
   */
  function wantedArt(at: MapView): readonly LocalArtEntry[] {
    if (art === null || art.status.kind !== 'listed') return [];
    const extentUiMapId = surfaces.find((surface) => surface.mapId === at.mapId)?.extentUiMapId ?? null;
    const onMap = art.entries.filter((entry) => entry.mapId === at.mapId);
    const continent = onMap.find((entry) => entry.uiMapId === extentUiMapId) ?? null;
    const bounds = at.bounds ?? null;
    const center = at.center;
    const zoneArt = onMap
      .filter((entry) => entry !== continent && (bounds === null || rectsMeet(entry.bounds, bounds)))
      .map((entry) => ({ entry, distance: center === null ? 0 : distanceSqTo(entry.bounds, center.x, center.y) }))
      .sort((a, b) => a.distance - b.distance || a.entry.uiMapId - b.entry.uiMapId)
      .slice(0, layers.lod.budgets.art)
      .map(({ entry }) => entry);
    if (layers.lodLevel(at.zoom) === 'continent') return continent !== null ? [continent] : zoneArt;
    return zoneArt.length > 0 ? zoneArt : continent !== null ? [continent] : [];
  }

  function artFor(at: MapView, state: EditorState): readonly ArtInput[] {
    if (!state.view.map.layers.art) return artInputs;
    const drawable = wantedArt(at).flatMap((entry) => {
      const url = artUrls.get(entry.uiMapId);
      return url === undefined ? [] : [{ uiMapId: entry.uiMapId, url, opacity: 1 }];
    });
    const key = drawable.map((input) => `${String(input.uiMapId)}=${input.url}`).join(' ');
    if (key !== artInputsKey) {
      artInputsKey = key;
      artInputs = drawable.length === 0 ? NO_ART : drawable;
    }
    return artInputs;
  }

  function requestArt(at: MapView, state: EditorState): void {
    if (art === null || art.status.kind !== 'listed' || objectUrls === null || !state.view.map.layers.art) return;
    const generation = artGeneration;
    for (const entry of wantedArt(at)) {
      if (artRequested.has(entry.uiMapId)) continue;
      artRequested.add(entry.uiMapId);
      void art.load(entry.uiMapId).then((result) => {
        if (generation !== artGeneration) return;
        if (result.kind === 'verified') {
          artRefused.delete(entry.uiMapId);
          artUrls.set(entry.uiMapId, objectUrls.create(result.blob));
        } else {
          artRefused.set(entry.uiMapId, ART_REFUSED_TEXT[result.reason]);
          // A failed request is tried again on the next visit to this map.
          if (result.reason === 'unavailable') artRequested.delete(entry.uiMapId);
        }
        sync('art');
      });
    }
  }

  function revokeArt(): void {
    artGeneration += 1;
    if (objectUrls !== null) for (const url of artUrls.values()) objectUrls.revoke(url);
    artUrls.clear();
    artRequested.clear();
    artInputs = NO_ART;
    artInputsKey = '';
  }

  // Sync -------------------------------------------------------------------------------------

  function build(state: EditorState, at: MapView): Map<LayerId, LayerContent> {
    const dataset = datasetOf(state);
    const character = state.project.character;
    const route = drawnOf(routeOf(state.project.route.steps));
    const focusKey = focusKeyOf(focusQuestIds(state.view.openedQuests, state.selection, activeStepOf(state)));
    const focusQuests = questIdsOfKey(focusKey);
    const stepFocus = focusWithin(stepFocusOf(state.selection, activeStep), drawnIdsOf(route));
    const zone = state.view.map.zone;
    const out = new Map<LayerId, LayerContent>();
    out.set('art', layers.art(artFor(at, state), at));
    out.set('zone-frames', layers.zoneFrames(at, zone));
    out.set('available-quests', layers.spawns('available-quests', giversOf(dataset, character.race, character.class).input, at, focusQuests, zone));
    out.set('objectives', layers.spawns('objectives', objectivesOf(dataset, focusKey).input, at, focusQuests, zone));
    out.set('turn-ins', layers.spawns('turn-ins', turnInsOf(dataset, focusKey).input, at, focusQuests, zone));
    out.set('flight-masters', layers.spawns('flight-masters', flightMastersOf(dataset, character.faction, character.race, character.class).input, at, [], zone));
    out.set('route-line', layers.routeLine(route, at));
    out.set('route-steps', layers.routeSteps(route, at, stepFocus));
    out.set('proposal', layers.proposal(null, at));
    out.set('selection', layers.selection(route, at, stepFocus));
    return out;
  }

  function measureSync(start: string, end: string, trigger: string, set: readonly LayerId[]): void {
    safely(() => {
      if (timing === null) return;
      timing.mark(end);
      syncMeasures += 1;
      if (syncMeasures > MAX_SYNC_MEASURES) {
        timing.clearMeasures('frl:map:sync');
        syncMeasures = 1;
      }
      timing.measure('frl:map:sync', { start, end, detail: { trigger, layers: set } });
    });
  }

  function sync(trigger: string): void {
    const state = store.getState();
    const target = adapter;
    if (target !== null && mounted && view !== null) {
      serial += 1;
      const start = `frl:map:sync:start:${String(serial)}`;
      const end = `frl:map:sync:end:${String(serial)}`;
      safely(() => timing?.mark(start));
      const built = build(state, view);
      const set: LayerId[] = [];
      for (const layer of LAYER_IDS) {
        const content = built.get(layer);
        if (content === undefined) continue;
        contents.set(layer, content);
        if (sent.get(layer) === content) continue;
        target.setLayer(layer, content);
        sent.set(layer, content);
        set.push(layer);
      }
      for (const layer of LAYER_IDS) {
        const visible = state.view.map.layers[layer];
        if (target.isLayerVisible(layer) !== visible) target.toggleLayer(layer, visible);
      }
      if (set.length > 0) measureSync(start, end, trigger, set);
      safely(() => {
        timing?.clearMarks(start);
        timing?.clearMarks(end);
      });
      requestArt(view, state);
      if (set.includes('route-steps')) applyRowHighlight();
    }
    publish(state);
  }

  /**
   * A new selection focus becomes the active step at once (the route list makes it its active row),
   * so the store's sync already draws its quests and follows it; the shell's `setActiveStep` that
   * comes after it then changes nothing (M3 review PERF-6).
   */
  function followFocus(state: EditorState): void {
    const focus = state.selection.focus;
    if (focus === lastFocus) return;
    lastFocus = focus;
    const next = focus !== null && positionsOf(state.project.route.steps).has(focus) ? focus : null;
    if (next === activeStep) return;
    activeStep = next;
    follow(next);
  }

  function follow(id: StepId | null): void {
    if (id !== null && id !== followed && mounted) {
      followed = id;
      focusStep(id, false);
    } else if (id === null) followed = null;
  }

  function onStoreChange(): void {
    if (quiet > 0) return;
    followFocus(store.getState());
    sync('store');
  }

  // Events -----------------------------------------------------------------------------------

  function select(id: StepId): void {
    store.select({ kind: 'single', id });
  }

  function actionOf(ref: MapRef, segment: number | null, descriptor: MapDescriptor | undefined): RefAction | null {
    switch (ref.kind) {
      case 'step':
        return { kind: 'select', stepId: ref.stepId };
      case 'run': {
        // Segment i runs from vertex i to i + 1: the leg into the step at i + 1.
        const id = segment === null ? ref.stepIds[0] : ref.stepIds[segment + 1];
        return id === undefined ? null : { kind: 'select', stepId: id };
      }
      case 'leg':
        return { kind: 'select', stepId: ref.toStepId };
      case 'transition':
        // Follow the route across: the glyph's other end is on the other surface.
        return { kind: 'select', stepId: ref.end === 'departure' ? ref.toStepId : ref.fromStepId };
      case 'departure':
        return { kind: 'select', stepId: ref.stepId };
      case 'spawn':
        return ref.questIds.length === 0 ? null : { kind: 'open', questIds: ref.questIds };
      case 'aggregate':
        if (ref.uiMapId !== null && zoneBounds(geometry, ref.uiMapId) !== null) return { kind: 'zone', uiMapId: ref.uiMapId };
        return descriptor?.type === 'aggregate' ? { kind: 'focus', point: descriptor.point } : null;
      case 'zone':
      case 'surface':
      case 'art':
        return null;
    }
  }

  function run(action: RefAction): void {
    switch (action.kind) {
      case 'select':
        select(action.stepId);
        return;
      case 'open':
        openQuestsInDetails(store, action.questIds);
        return;
      case 'zone':
        jumpToZone(action.uiMapId);
        return;
      case 'focus':
        adapter?.focus(action.point, { zoom: AGGREGATE_ZOOM, recenter: true });
        return;
    }
  }

  /** The choice for a merged marker whose items do different things; null when one action (or none) covers them. */
  function choiceFor(hit: MapHit, descriptor: MapDescriptor | undefined): OpenChoice | RefAction | null {
    const entries = hit.refs.flatMap((ref, index) => {
      const action = actionOf(ref, null, descriptor);
      return action === null ? [] : [{ ref, index, action, key: actionKey(action) }];
    });
    const distinct = new Set(entries.map((entry) => entry.key));
    const [first] = entries;
    if (first === undefined) return null;
    if (distinct.size === 1) return first.action;
    const labels = descriptor?.type === 'marker' ? descriptor.labels : [];
    const [one, many] = CHOICE_NOUNS[hit.layer];
    const options = entries.map((entry) => ({ label: labelFor(entry.ref) ?? labels[entry.index] ?? `${one} ${String(entry.index + 1)}` }));
    const selects = entries.flatMap((entry) => (entry.action.kind === 'select' ? [entry.action.stepId] : []));
    const opens = entries.flatMap((entry) => (entry.action.kind === 'open' ? entry.action.questIds : []));
    let all: OpenChoice['all'] = null;
    let allLabel: string | null = null;
    if (selects.length === entries.length) {
      const ids = [...new Set(selects)];
      all = { kind: 'steps', ids };
      allLabel = `Select all ${plural(ids.length, 'step', 'steps')}`;
    } else if (opens.length > 0 && entries.every((entry) => entry.action.kind === 'open')) {
      const quests = normaliseQuestIds(opens);
      all = { kind: 'action', action: { kind: 'open', questIds: quests } };
      allLabel = `Open all ${plural(quests.length, 'quest', 'quests')} in Details`;
    }
    const shown = adapter?.getView() ?? null;
    const point = descriptor?.type === 'marker' || descriptor?.type === 'aggregate' ? descriptor.point : null;
    const pixel = shown === null || point === null ? null : stagePixelOf(shown, point);
    const kinds = new Set(entries.map((entry) => entry.action.kind));
    const hint = kinds.size === 1 && kinds.has('select') ? 'Choose one to select its step.' : kinds.size === 1 && kinds.has('open') ? 'Choose one to open its quests in Details.' : 'Choose one.';
    return {
      choice: {
        title: `${plural(hit.refs.length, one, many)} here`,
        hint,
        options,
        allLabel,
        at: shown === null || pixel === null ? null : { x: pixel.x, y: pixel.y, width: shown.widthPx, height: shown.heightPx },
      },
      actions: entries.map((entry) => entry.action),
      all,
    };
  }

  function closeChoice(): boolean {
    if (choice === null) return false;
    choice = null;
    return true;
  }

  function onClick(hit: MapHit | null, point: WorldPoint): void {
    closeChoice();
    if (hit === null) {
      publish(store.getState());
      if (store.getState().view.map.zoomBand !== 'continent') return;
      // The frame the point is most central in, not the smallest: frames overlap heavily, and a
      // click on The Barrens at the Crossroads lies in Durotar's frame too (coordinates.md §15).
      for (const id of zoneFramesContaining(point, geometry)) if (jumpToZone(id)) return;
      return;
    }
    const descriptor = descriptorOf(hit.layer, hit.id);
    if (hit.refs.length <= 1) {
      const action = actionOf(hit.ref, hit.segment, descriptor);
      if (action !== null) run(action);
      publish(store.getState());
      return;
    }
    const outcome = choiceFor(hit, descriptor);
    if (outcome !== null && 'kind' in outcome) run(outcome);
    else if (outcome !== null) choice = outcome;
    publish(store.getState());
  }

  // Row hover -------------------------------------------------------------------------------

  function rowHighlightTarget(): HighlightTarget | null {
    const wanted = rowSteps;
    if (wanted === null) return null;
    const ids = (contents.get('route-steps')?.items ?? [])
      .filter((item) => item.type === 'marker' && item.refs.some((ref) => ref.kind === 'step' && wanted.has(ref.stepId)))
      .map((item) => item.id);
    return ids.length === 0 ? null : { layer: 'route-steps', ids };
  }

  /** Sends the hovered rows' highlight when it changed (the map pointer's own highlight wins while it lasts). */
  function applyRowHighlight(force = false): void {
    if (adapter === null || !mounted || mapHovering) return;
    const next = rowHighlightTarget();
    if (!force && plainEqual(next, rowTarget)) return;
    rowTarget = next;
    adapter.highlight(next);
  }

  function onEvent(event: MapEvent): void {
    switch (event.type) {
      case 'move':
      case 'surface': {
        view = mapViewOf(event.view);
        const zone = store.getState().view.map.zone;
        // The zone jumped to stops being "the zone" once it is panned out of view or left behind.
        const leftZone = zone !== null && zone !== zoneFit && !zoneShown(zone, event.view, event.type === 'move');
        patchUi(leftZone ? { ...viewPatch(event.view), zone: null } : viewPatch(event.view));
        closeChoice();
        sync(event.type);
        return;
      }
      case 'zoom':
        patchUi({ zoomBand: layers.lodLevel(event.view.zoom) });
        return;
      case 'hover': {
        const hit = event.hit;
        if (hit === null) {
          mapHovering = false;
          setHover(null);
          applyRowHighlight(true);
          return;
        }
        mapHovering = true;
        const target: HighlightTarget = { layer: hit.layer, ids: [hit.id] };
        rowTarget = target;
        adapter?.highlight(target);
        const descriptor = descriptorOf(hit.layer, hit.id);
        setHover(descriptor === undefined ? null : labelOf(descriptor, labelFor));
        return;
      }
      case 'click':
        onClick(event.hit, event.point);
        return;
    }
  }

  // Commands ---------------------------------------------------------------------------------

  function placementOf(id: StepId): StepPlacement | null {
    const state = store.getState();
    return routeStepOf(routeOf(state.project.route.steps), id)?.placement ?? null;
  }

  function focusStep(id: StepId, recenter = true): FocusStepResult {
    const placement = placementOf(id);
    if (placement === null) return { kind: 'not-in-route' };
    if (placement.kind === 'none') return { kind: 'no-location' };
    if (placement.kind === 'unknown') return { kind: 'not-placed', reason: placement.reason };
    const surface = surfaceIdOf(placement.world.mapId);
    if (!surfaces.some((info) => info.id === surface)) return { kind: 'no-surface', mapId: placement.world.mapId };
    if (adapter === null) pending = { kind: 'focus', stepId: id };
    else adapter.focus(placement.world, { recenter });
    return { kind: 'focused', surface };
  }

  const fitOptionsOf = (maxZoom: number | undefined, minZoom: number | undefined) => ({
    ...(maxZoom === undefined ? {} : { maxZoom }),
    ...(minZoom === undefined ? {} : { minZoom }),
  });

  function fitBounds(bounds: WorldBounds, fit: { readonly maxZoom?: number; readonly minZoom?: number; readonly zone?: UiMapId | null } = {}): void {
    if (adapter === null) {
      pending = { kind: 'fit', bounds, maxZoom: fit.maxZoom, minZoom: fit.minZoom, zone: fit.zone ?? null };
      return;
    }
    const previous = zoneFit;
    zoneFit = fit.zone ?? null;
    try {
      adapter.fitBounds(bounds, fitOptionsOf(fit.maxZoom, fit.minZoom));
    } finally {
      zoneFit = previous;
    }
  }

  function fitRoute(): FitRouteResult {
    const state = store.getState();
    const route = routeOf(state.project.route.steps);
    const summary = summaryOf(route);
    const shown = new Set<number>(surfaces.map((info) => info.mapId));
    const here = currentMapId();
    const onHere = here === null ? undefined : summary.maps.find((entry) => entry.mapId === here);
    const target = onHere ?? summary.maps.find((entry) => shown.has(entry.mapId));
    if (target === undefined) return { kind: 'nothing-to-fit' };
    const bounds = routeBoundsOn(route, target.mapId);
    if (bounds === null) return { kind: 'nothing-to-fit' };
    fitBounds(bounds, { maxZoom: FIT_ROUTE_MAX_ZOOM });
    return { kind: 'fitted', surface: surfaceIdOf(target.mapId), steps: target.steps };
  }

  function jumpToZone(id: UiMapId): boolean {
    const bounds = zoneBounds(geometry, id);
    if (bounds === null || !surfaces.some((info) => info.mapId === bounds.mapId)) return false;
    patchUi({ zone: id });
    // At the zone zoom or closer: a zone wider than the stage allows at that zoom is centred at it
    // rather than fitted below it, where its points would stay folded into counts (PERF-4, MAP-UX-2).
    fitBounds(bounds, { minZoom: layers.lod.zoneZoom, zone: id });
    sync('zone');
    return true;
  }

  function initialSurface(state: EditorState): SurfaceId | null {
    const stored = state.view.map.surface;
    if (stored !== null && surfaces.some((info) => info.id === stored)) return stored;
    if (pending?.kind === 'surface') return pending.surface;
    const route = routeOf(state.project.route.steps);
    const first = firstRouteSurface(route);
    return first !== null && surfaces.some((info) => info.id === first) ? first : null;
  }

  function applyPending(target: MapAdapter): boolean {
    const intent = pending;
    pending = null;
    if (intent === null) return false;
    switch (intent.kind) {
      case 'focus':
        return focusStep(intent.stepId).kind === 'focused';
      case 'fit': {
        const previous = zoneFit;
        zoneFit = intent.zone;
        try {
          return target.fitBounds(intent.bounds, fitOptionsOf(intent.maxZoom, intent.minZoom));
        } finally {
          zoneFit = previous;
        }
      }
      case 'surface':
        return target.setSurface(intent.surface);
    }
  }

  function resolveChoice(pick: (open: OpenChoice) => void): void {
    const open = choice;
    if (open === null) return;
    choice = null;
    pick(open);
    publish(store.getState());
  }

  return {
    surfaces,
    zoneGroups: zones,
    labelFor,

    attach(factory, el) {
      if (mounted) throw new Error('MapController.attach: already attached; call detach() first');
      const state = store.getState();
      let target = adapter;
      try {
        if (target === null) {
          target = factory({ surfaces, initialSurface: initialSurface(state), label: labelFor });
          adapter = target;
          for (const type of ['click', 'hover', 'move', 'zoom', 'surface'] as const) target.on(type, onEvent);
        }
        // Content kept from an earlier mount is redrawn by the adapter; a layer is sent again only
        // when it changed (`sent` survives the remount).
        target.mount(el);
      } catch (error) {
        // Drop the engine that failed: the next attach (the panel's "Try again") starts a new one.
        adapter = null;
        failure = error instanceof Error ? error.message : String(error);
        publish(state);
        return false;
      }
      failure = null;
      mounted = true;
      unsubscribeStore = store.subscribe(onStoreChange);
      lastFocus = state.selection.focus;
      const first = !everMounted;
      everMounted = true;
      let moved = applyPending(target);
      if (!moved && first) {
        const active = activeStep;
        if (active !== null && focusStep(active, false).kind === 'focused') {
          followed = active;
          moved = true;
        }
        if (!moved) fitRoute();
      }
      const current = target.getView();
      if (current !== null) {
        view = mapViewOf(current);
        patchUi(viewPatch(current));
      }
      sync('attach');
      return true;
    },

    detach() {
      if (!mounted) return;
      unsubscribeStore?.();
      unsubscribeStore = null;
      adapter?.destroy();
      mounted = false;
      mapHovering = false;
      rowTarget = null;
      closeChoice();
      setHover(null);
      revokeArt();
      publish(store.getState());
    },

    setActiveStep(id) {
      if (id === activeStep) return;
      activeStep = id;
      follow(id);
      sync('active');
    },

    showSurface(surface) {
      if (!surfaces.some((info) => info.id === surface)) return false;
      if (adapter === null) {
        pending = { kind: 'surface', surface };
        return true;
      }
      return adapter.setSurface(surface);
    },

    focusStep: (id) => focusStep(id, true),
    fitRoute,
    jumpToZone,

    hoverSteps(ids) {
      const next = ids === null || ids.length === 0 ? null : new Set(ids);
      if (next === null && rowSteps === null) return;
      rowSteps = next;
      applyRowHighlight();
    },

    choose(index) {
      resolveChoice((open) => {
        const action = open.actions[index];
        if (action !== undefined) run(action);
      });
    },

    chooseAll() {
      resolveChoice((open) => {
        const all = open.all;
        if (all === null) return;
        if (all.kind === 'steps') store.select({ kind: 'set', ids: all.ids });
        else run(all.action);
      });
    },

    dismissChoice() {
      if (closeChoice()) publish(store.getState());
    },

    getStatus: () => status,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getHover: () => hoverText,

    subscribeHover(listener) {
      hoverListeners.add(listener);
      return () => {
        hoverListeners.delete(listener);
      };
    },
  };
}

/** A timeline that refuses a mark or measure (an old engine, a full buffer) must not break the map. */
function safely(run: () => unknown): void {
  try {
    run();
  } catch {
    // ignored on purpose
  }
}

