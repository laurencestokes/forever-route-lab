import type { DatasetView, NpcId, PublishedPoint, QuestId, RouteStep, SourcedPoint, StepId, UiMapId, WorldMapId, WorldPoint } from '../domain';
import { attributeZone, zoneFramesContaining, type MapGeometry } from '../geo';
import type {
  ArtImage,
  ArtManifestLoad,
  AtlasIndexLoad,
  LocalArt,
  LocalArtEntry,
  LocalArtLoad,
  MapLayersSetting,
  MapResources,
  MapStyleSetting,
  TerrainArcKind,
  TerrainArcsLoad,
  TerrainManifestLoad,
} from '../infra/maps';
import {
  BAND_EDGES,
  BAND_HYSTERESIS_ZOOM,
  bandLevelOf,
  boundsCenter,
  boundsOfPoints,
  boundsOnMap,
  DEFAULT_MAP_STYLE,
  EMPTY_LAYER_STATS,
  isAtlasSurface,
  LAYER_IDS,
  labelOf,
  mapViewOf,
  nextBand,
  placementOn,
  pxPerYardAt,
  refsOf,
  shareCap,
  SPAWN_LAYER_IDS,
  STEP_TOKEN,
  stagePixelOf as stagePixelOnView,
  surfaceBoundsUnion,
  surfaceForMap,
  surfaceMapIds,
  subjectKeyOf,
  tileBandOf,
  viewBoundsOn,
  viewMapIds,
  type ArtInput,
  type AtlasSurfaceInfo,
  type HighlightTarget,
  type LabelDescriptor,
  type LayerContent,
  type LayerId,
  type LayerStats,
  type LineStyle,
  type MapAdapter,
  type MapAdapterFactory,
  type MapBand,
  type MapCategoryId,
  type MapContainer,
  type MapDescriptor,
  type MapEvent,
  type MapHit,
  type MapLabelProvider,
  type MapMask,
  type MapRef,
  type MapStepNumbers,
  type MapStyle,
  type MapView,
  type MapViewState,
  type MarkerBadge,
  type OutlineInput,
  type PlaceLayerInput,
  type ReliefInput,
  type RouteInput,
  type RouteStepInput,
  type RoutePathsInput,
  type StepPlacement,
  type SpawnLayerId,
  type SpawnLayerInput,
  type LogObjectivesInput,
  type SurfaceId,
  type SurfaceInfo,
  type TileBandDescriptor,
  type UnplacedReason,
  type WorldBounds,
  type ZoneFillDescriptor,
  zoomAtPxPerYard,
} from '../map/adapter';
import {
  bandOfView,
  createLayerCaches,
  createLayerJoin,
  createMapLayers,
  groupDigits,
  partBudgets,
  plainEqual,
  viewLodLevel,
  type ActiveSplit,
  type ClustersOf,
  type LayerCall,
  type LodOverrides,
  type MapLayers,
} from '../map/layers';
import { characterName } from './character-names';
import { DEFAULT_HIDDEN_CATEGORIES, maskOf, normaliseHidden, questRowsShown } from './map-categories';
import { type DatasetSource, datasetViewInputOf } from './dataset-source';
import type { DerivedStore } from './derived';
import type { RoutePathFeed } from './route-paths';
import {
  createDrawnRouteFilter,
  createPositions,
  createRouteInputBuilder,
  firstRouteMap,
  flightMasterModel,
  focusQuestIds,
  focusWithin,
  isDrawnStep,
  legUnknownAt,
  mapHasQuestPoints,
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
  type Positions,
  type RouteMapSummary,
  type ZoneGroup,
} from './map-model';
import { normaliseQuestIds, openQuestsInDetails, patchMapUi, type MapUiPatch } from './map-view';
import type { QuestStateModel } from './quest-state';
import type { PlacesModel } from './map-places';
import { searchDrawQuests, type SearchDrawQuests } from './map-search-draw';
import type { ArtNotesState, MapNotesSource, MapResourceFacts, MapWording } from './map-wording';
import { noStateText } from './quest-state-text';
import type { EditorState, EditorStore } from './store';
import { plainGuideText } from './ui-text';

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
 *   line, a transition or departure glyph selects the step; a click on a pin (a quest giver,
 *   objective, turn-in, flight point, dungeon, transport stop or service), on a stack of steps that do
 *   different things, or on empty map at the zone band or closer, opens the map popover
 *   (`getStatus().popover`, map-presentation.md §14.2; step MP.6), whose actions the UI builds and
 *   runs; a click on empty map at continent zoom jumps to the zone frame the point is most central
 *   in (`zoneFramesContaining`, coordinates.md §15).
 * - **Commands:** focus a step, fit the route, jump to a zone (at zone zoom or closer, so the zone
 *   shows its points), show a surface, highlight the markers of hovered route rows. The map follows
 *   the active step: when it changes, the map brings it into view (`focus`, which pans only when the
 *   point is not comfortably visible). The zone jumped to stays emphasised until it is panned out
 *   of view or the surface changes.
 * - **Art and terrain** (D-032, D-033): when the map first mounts it loads the committed art and
 *   terrain manifests (`MapResources`), never during startup. The art layer draws the map being
 *   viewed: the continent image zoomed out, the image of the zone being viewed zoomed in (one at a
 *   time: zone images have painted borders). The relief is the backdrop, faint under drawn art;
 *   the zone frames lose their fill over art. Zone outlines and the coastline are fetched and
 *   verified per world map when their layer is first shown there. A failed load never breaks the map: the layer says why,
 *   the status line says what the map shows instead, and the rest draws as before.
 * - **Local art** (dev/preview only, D-018): a compatible local set's art replaces the committed
 *   art. Only the images drawn at this level of detail are loaded and verified (`LocalArt.load`),
 *   and drawn from object URLs of the verified bytes, revoked on detach.
 * - **Walking paths** (MAPS §7.4): `setRoutePaths` takes the navigation model's paths; with the
 *   walking-paths toggle on, walked legs follow them, and legs without one are drawn straight as
 *   pending or fallback. New paths wait while the map moves (`movestart` holds the feed) and are
 *   drawn after it settles, in a task after the view's sync (D-050 item 5).
 * - **The atlas** (docs/research/map-atlas.md §8.2; D-042), on by default since ATL.10 (the `atlas`
 *   option, false only in tests): maps 0 and 1 and the Zephras Isle inset on one surface, with "Kalimdor"
 *   and "Eastern Kingdoms" as presets that fit it to one continent. Layers are built by one
 *   memoised builder per world map (`createMapLayers`, sharing the route caches), each for its own
 *   view: the atlas view translated into that map's yards, for every placed map that meets the
 *   view padded by 50 % (`MapView.visible`). Each layer's budget is shared across those maps in
 *   proportion to their candidates in view (`partBudgets`, `shareCap`), and their parts are joined,
 *   memoised on the parts' identities (`createLayerJoin`). A world surface has one builder and
 *   one part, so its layers are exactly what one builder gives.
 * - **The atlas tiles** (map-atlas.md §7.2, §8.6; step ATL.7): with the atlas on, the controller
 *   loads the tile index (`MapResources.atlas`) when the map first mounts, and refuses one whose
 *   `atlasHash` is not the surface's. The modes of §8.6:
 *   - tiles: the art layer is the one `tiles` descriptor, sent before any other layer is built, so
 *     the first view's images are asked for first (review MR-07); the relief is not drawn on the atlas;
 *     zone rectangles are kept but not painted, and the city cards and the inset's card are framed
 *     over the tiles;
 *   - "Painted art" off: the relief per placement as the backdrop, hidden above zoom 0, with
 *     outlines and frames (while the index loads, with the art on, neither relief nor art);
 *   - index refused (or none): as art off, plus the Zephras Isle image on its card, and the status
 *     line says why;
 *   - local maps (dev and preview): the tiles hidden, the local set's images drawn one at a time
 *     through the placements (each continent's at the continent band, clipped at the seam; the
 *     zone being viewed at the zone band). Not seamless.
 * - **Two styles** (map-atlas.md §21; step MM.1): the minimap and the painted atlas, one index each
 *   (`MapResources.atlas(hash, style)`), fetched only when that style is first shown. The chosen
 *   style (`setMapStyle`, read from the per-browser `mapStyle` setting at the first mount, else
 *   `DEFAULT_MAP_STYLE`) is drawn once its index has loaded; while it loads, the style drawn before
 *   stays. A style that cannot be drawn (its index refused or missing, or its first view's images
 *   all failed: a build without the minimap tile pack) gives way to the other, with the reason in
 *   the status line (§21.4); the fallback is never written to the setting. Neither: the relief.
 *   A painted build (`--mode painted`, D-053) has only the painted style (`styles`): the minimap
 *   is never chosen, fetched or fallen back to, and a kept choice of it is ignored, not overwritten.
 *   The adapter holds the old picture under the new one until the new first view has decoded.
 * - **Idle pre-build** (map-atlas.md §8.2; with `smoothWheel`): within half a level of the
 *   level-of-detail edge, the other band's spawn layers are collected in idle time, so crossing it
 *   finds them ready.
 * - **Zoom bands** (map-presentation.md §5.1; step MP.1): each settled view's band is chosen per
 *   placed map from the pixels per yard of its placement, with hysteresis (`nextBand`: a band
 *   changes only when the scale passes its edge by 0.125 zoom), and given to the builders as
 *   `MapView.band`, which chooses each layer's budget and the level of detail. A view the controller
 *   moves to itself (a jump, a fit, a focus) takes the plain band of its scale.
 * - **Quest state** (map-presentation.md §7; step MP.3): with the derived store (`derived`), the
 *   quest layers draw the published `QuestStateModel`: the givers of the quests drawn by default
 *   (available, may be available, needs a prerequisite) with their best state, every log quest's
 *   turn-in with its state, and the log quests' open objectives as counted marks and outlines at
 *   the zone and close bands (the focused quests' objectives stay raw). Quests in focus outside those
 *   rows keep their givers. Hover text adds "After step N" from the route order. Without a model
 *   (loading, failed, no active step) the givers are the quests open by race and class, and the
 *   notes and hovers say there is no route state yet.
 * - **Step numbers** (map-presentation.md §13.6): the controller numbers the steps for the labels
 *   canvas (`MapAdapterOptions.stepNumbers`) and asks the adapter to redraw that canvas alone
 *   (`refreshLabels`) after a sync in which the route or the active step changed.
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
  /** The local set's art; null or omitted for none. While it lists images it replaces the committed art. */
  readonly art?: LocalArt | null | undefined;
  /**
   * The committed painted art and terrain byproducts (`createMapResources` in infra/maps), loaded
   * when the map first mounts; null or omitted for none: the map then draws zone frames only.
   */
  readonly resources?: MapResources | null | undefined;
  /**
   * The walking paths of the navigation model (`createRoutePathFeed`, src/app/route-paths.ts):
   * while the map is mounted the controller follows the feed's current paths (as `setRoutePaths`
   * would) and tells it the view, so only legs being drawn ask for a path. Null or omitted: none,
   * or the caller uses `setRoutePaths` itself.
   */
  readonly paths?: RoutePathFeed | null | undefined;
  /**
   * A step's hover text from its current position, for example `12 · Accept: Your Place in the World`.
   * The label provider shows it as plain text: guide colour tokens and escapes are removed
   * (`plainGuideText`, docs/RXP.md §12 row 32).
   */
  readonly describeStep: (step: RouteStep, index: number, dataset: DatasetView) => string;
  readonly lod?: LodOverrides | undefined;
  /** Default: `URL.createObjectURL` / `revokeObjectURL` where they exist. */
  readonly objectUrls?: ObjectUrls | null | undefined;
  /** Where the `frl:map:sync` measures go; default the page's `performance`, null for none. */
  readonly timing?: MapTiming | null | undefined;
  /**
   * The atlas surface (docs/research/map-atlas.md; steps ATL.5, ATL.10): maps 0, 1 and the Zephras
   * Isle inset on one surface, which retires their world surfaces (`world:0`, `world:1`,
   * `world:2991`); "Kalimdor" and "Eastern Kingdoms" are presets on it. On by default since ATL.10
   * whenever the geometry places both continents (the committed 947 rows); `false` keeps one world
   * surface per world map, for tests of that path only (the app never passes it). Without the 947
   * rows there is no atlas and every world map keeps its world surface.
   */
  readonly atlas?: boolean | undefined;
  /**
   * The gesture work of map-atlas.md §8.4 (step ATL.8): passed to the adapter
   * (`MapAdapterOptions.smoothWheel`), and the other band built in idle time near the
   * level-of-detail edge. On by default since ATL.10; `false` keeps Leaflet's own wheel (tests only).
   */
  readonly smoothWheel?: boolean | undefined;
  /**
   * A deploy build (`pnpm build:deploy`, built with `--mode deploy`; default: this build's mode),
   * whose audit guarantees every minimap tile (map-atlas.md §24.3): a first view whose images all
   * fail is then a network failure, and its message names no developer command (review MD-03).
   */
  readonly deployBuild?: boolean | undefined;
  /**
   * Whether this build has the minimap style (default: true, except in a painted build, built with
   * `--mode painted` by `pnpm build:painted`, the Pages build while the minimap tile pack is not
   * published; D-053). Without it the painted style is the only one: it is drawn whatever this
   * browser chose, the minimap's index is never fetched or fallen back to, and `styles` leaves the
   * minimap out, so the drawer never offers it.
   */
  readonly minimap?: boolean | undefined;
  /** Runs a task in idle time and returns its cancel (default `requestIdleCallback`, else a short timeout). */
  readonly idle?: ((task: () => void) => () => void) | undefined;
  /** The map style chosen in this browser (map-atlas.md §21.3), read at the first mount; null or omitted: `DEFAULT_MAP_STYLE`, not kept. */
  readonly mapStyle?: MapStyleSetting | null | undefined;
  /**
   * The words of the layers' notes (`app/map-wording.ts`, a lazy part with the Map layers drawer,
   * which installs it with `setWording`); null or omitted: the notes are empty until then.
   */
  readonly wording?: MapWording | null | undefined;
  /** The derived results, for the quest state after the active step (MP.3); null or omitted: the quests open by race and class. */
  readonly derived?: DerivedStore | null | undefined;
  /**
   * The clusters below the zone band while the places model has none (tests; D-050 item 6): the app
   * takes them from the derived pipeline's places (`PlacesModel.clusters`), so the clustering stays
   * out of the entry chunk. Null or omitted: per-zone counts until the places arrive.
   */
  readonly clusters?: ClustersOf | null | undefined;
}

/** A switcher entry that fits the atlas to one continent (map-atlas.md §5.6, §8.5): the placed map's 947 rectangle. */
export interface MapPreset {
  /** `preset:<mapId>`. */
  readonly id: string;
  readonly surface: SurfaceId;
  readonly mapId: WorldMapId;
  readonly name: string;
  readonly bounds: WorldBounds;
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

/**
 * What a click asks the map popover to show (map-presentation.md §14.2; step MP.6): the items at the
 * clicked point (a pin's, a stack's or the steps' refs, with their hover texts), or an empty point.
 * The popover's content and actions are built from it in the UI's lazy part (`app/map-popover.ts`).
 */
export interface MapPopoverTarget {
  /** A new number for every click, so the popover resets (focus moves to its first action). */
  readonly key: number;
  /** The layer of the item clicked; null for empty map. */
  readonly layer: LayerId | null;
  /** Every item at the point, in the layer's order (none for empty map). */
  readonly refs: readonly MapRef[];
  /** Each item's hover text, parallel to `refs` (step numbers from the current route order). */
  readonly labels: readonly (string | null)[];
  /** The clicked point (world form, to 0.1 yd), with its zone hint; for a pin, the pin's point. */
  readonly point: SourcedPoint & { readonly space: 'world' };
  /** The place in stage pixels from the top left, with the stage's size; null when the map has no view. */
  readonly at: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
  /** Where the character is at the active step (its placed point), for "Fly from the nearest known flight point"; null when unknown. */
  readonly from: WorldPoint | null;
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
  /** Art images drawn on the shown surface (committed, or a local set's verified images). */
  readonly artDrawn: number;
  /**
   * What the map shows under its markers, for the notice: the committed painted art, a local set's
   * art, the shaded relief without art, or only the schematic zone frames.
   */
  readonly backdrop: MapBackdrop;
  /** The walking-paths toggle (not a layer of its own: it changes how the route line draws walked legs). */
  readonly walkingPaths: WalkingPathsStatus;
  /** Short, non-blocking sentences for the status line: map resources that could not be loaded, and what the map shows instead. */
  readonly problems: readonly string[];
  /**
   * The shown surface's insets (map-atlas.md §5.5, §8.8): on the atlas, each map shown in a box
   * rather than in position, for the status line, the key and the map's instructions
   * (`insetNote`, `atlasInstruction`). Empty on a world surface.
   */
  readonly insets: readonly MapInsetStatus[];
  /** Where the active step is (for "focus step"), or null when no step is active. */
  readonly activeStep: { readonly stepId: StepId; readonly number: number; readonly placement: ActivePlacement } | null;
  /** The map popover's target (a clicked pin, stack or point), or null when it is closed. */
  readonly popover: MapPopoverTarget | null;
  /** The pick in progress (the next click on the map is taken as a point), or null. */
  readonly pick: MapPickStatus | null;
  /** The base map's style (map-atlas.md §21): chosen, shown, and why the chosen one is not shown. */
  readonly style: MapStyleStatus;
  /** The Map layers drawer's counts (map-presentation.md §25.3.3; step MP.4b). */
  readonly counts: MapCategoryCounts;
  /** The drawer's hidden rows, as applied (`setCategories`). */
  readonly hidden: readonly MapCategoryId[];
  /** A map search's filter is applied (`setSearchFilter`): the pin layers draw only what it found. */
  readonly searching: boolean;
  /** The zone at the view centre from the zone band on, for the "Viewing" chip (map-presentation.md §13.5; step MP.7); null otherwise. */
  readonly viewing: UiMapId | null;
}

/**
 * The Map layers drawer's counts (map-presentation.md §25.3.3): totals over the whole map at the
 * active step, updated after each derived publish and never per pan; "k in view" at each settled
 * view. Plain numbers: the drawer (a lazy part) words them.
 */
export interface MapCategoryCounts {
  /** The step the quest counts are after (its number in the route), or null without route state. */
  readonly afterStep: number | null;
  /** The character, "Orc Warrior" (for "open to an Orc Warrior (no route state yet)"). */
  readonly who: string;
  /**
   * Quests per quest row the map draws, from the quest state (the level ceiling applied, D-050 item
   * 3); without it, the quests open by race and class, all under Available.
   */
  readonly quests: Readonly<Partial<Record<MapCategoryId, number>>>;
  /** Quests per quest row the level ceiling keeps off the map (an assumption; the lists still show them); absent or 0 when none. */
  readonly heldBack?: Readonly<Partial<Record<MapCategoryId, number>>>;
  /** Distinct givers of the available row's drawn quests (the second figure, "209 · 118 givers"); null without route state. */
  readonly availableGivers: number | null;
  /** Log quests ready to turn in ("8 · 4 ready"); null without route state. */
  readonly ready: number | null;
  /** Places per pin row that counts places: instances, flight points of the character's side, flights, stops (steps MP.5, MP.8, MP.9). */
  readonly places: Readonly<Partial<Record<MapCategoryId, number>>>;
  /** Flight points of the side known to the route after the step (the flight points' second figure, "34 · 2 known"); null or absent without route state. */
  readonly flightsKnown?: number | null;
  /** Per row, what the last settled view shows of it: quests for the quest rows, places for the others. */
  readonly inView: Readonly<Partial<Record<MapCategoryId, number>>>;
}

export interface MapStyleStatus {
  /** The style chosen (`setMapStyle`, the per-browser setting, else `DEFAULT_MAP_STYLE`). */
  readonly chosen: MapStyle;
  /** The style whose tiles the atlas draws; null when it draws none (loading, refused, or not the atlas). */
  readonly shown: MapStyle | null;
  /** Why the chosen style is not drawn (the §21.4 message); null when it is, or while it loads. */
  readonly unavailable: string | null;
}

/**
 * A request to take the next click on the map as a point ("pick on map"): for a step's location,
 * say, or a custom quest's starter.
 */
export interface MapPickRequest {
  /** What the point is for, in words ("the location of step 12"): the status line says it. */
  readonly label: string;
  /**
   * Receives the point: world form, where the click was (to 0.1 yd), with the zone hint (the zone
   * the map was jumped to when its frame holds the point, else the zone frame the point is most
   * central in, else null; `attributeZone`).
   */
  readonly onPick: (point: SourcedPoint) => void;
}

export interface MapPickStatus {
  readonly label: string;
}

export type MapBackdrop = 'art' | 'local-art' | 'relief' | 'schematic';

export interface WalkingPathsStatus {
  readonly visible: boolean;
  /** Why walking paths cannot be drawn (none are given); null when they can. */
  readonly unavailable: string | null;
  /** How the route line draws the walked legs on this surface. */
  readonly notes: readonly string[];
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
  /** The committed painted art and terrain (`createMapResources` in infra/maps), for the controller; null or omitted for none. */
  readonly resources?: MapResources | null | undefined;
  /** The walking paths for the route line (`createRoutePathFeed`), for the controller's `paths` option; null or omitted for none. */
  readonly paths?: RoutePathFeed | null | undefined;
  /** Loads the map engine (Leaflet, in its own chunk) and resolves to its adapter factory. */
  readonly loadAdapter: () => Promise<MapAdapterFactory>;
  /** The controller's `atlas` option (map-atlas.md; on unless false, since ATL.10; the app leaves it out). */
  readonly atlas?: boolean | undefined;
  /** The controller's `smoothWheel` option (map-atlas.md §8.4; on unless false, since ATL.10; the app leaves it out). */
  readonly smoothWheel?: boolean | undefined;
  /** The controller's `mapStyle` option: the style chosen in this browser (map-atlas.md §21.3). */
  readonly mapStyle?: MapStyleSetting | null | undefined;
  /**
   * The Map layers drawer's record kept in this browser (map-presentation.md §25.3.7; step MP.4b):
   * its hidden rows, whether it was left open, its collapsed groups (and the style, which
   * `mapStyle` reads and writes). Null or omitted: the defaults, not kept.
   */
  readonly mapLayers?: MapLayersSetting | null | undefined;
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
  /** Presets of the atlas ("Kalimdor", "Eastern Kingdoms"); empty without the atlas. */
  readonly presets: readonly MapPreset[];
  /** The base-map styles this build can draw, in the style control's order: both, or only `painted` in a painted build (D-053). */
  readonly styles: readonly MapStyle[];
  /** A world map's name ("Kalimdor"), whichever surface shows it; null for a map with no surface. */
  readonly mapName: (mapId: WorldMapId) => string | null;
  /** Jump-to-zone choices, grouped by world map. */
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
  /** Fits the atlas to a preset's continent (`presets`); false for an unknown preset. */
  readonly showPreset: (id: string) => boolean;
  /**
   * Chooses the base map's style (map-atlas.md §21) and keeps it in this browser; choosing a style
   * that failed tries it again. The atlas draws it once its index has loaded (`getStatus().style`).
   * A style this build cannot draw (not in `styles`, D-053) is ignored.
   */
  readonly setMapStyle: (style: MapStyle) => void;
  /** Installs the words of the layers' notes (the Map layers drawer does, once loaded); the status is published again with them. */
  readonly setWording: (wording: MapWording) => void;
  readonly focusStep: (id: StepId) => FocusStepResult;
  readonly fitRoute: () => FitRouteResult;
  /**
   * Shows the zone (switching surface when needed): its frame fitted, at the level of detail's zone
   * zoom or closer, so its quest points are drawn raw. False when it has no single frame.
   */
  readonly jumpToZone: (id: UiMapId) => boolean;
  /** Highlights the step markers of the route rows under the pointer; null or empty clears it. */
  readonly hoverSteps: (ids: readonly StepId[] | null) => void;
  /**
   * The walking paths the route line follows (the navigation model's; MAPS §7.4), or null for
   * none. Give a new object whenever an answer changes: the route layers are rebuilt only then.
   */
  readonly setRoutePaths: (paths: RoutePathsInput | null) => void;
  /** Closes the map popover (`getStatus().popover`); its actions are the UI's. */
  readonly closePopover: () => void;
  /**
   * Takes the next click on the map as a point for `request` (and nothing else: the click selects
   * nothing). False when the map is not mounted, so nothing can be clicked. A new pick replaces
   * the one in progress.
   */
  readonly startPick: (request: MapPickRequest) => boolean;
  /** Ends the pick in progress without a point; false when there was none. */
  readonly cancelPick: () => boolean;
  /** The adapter's label provider: numbered hover text for a ref, or null to keep the descriptor's own. */
  readonly labelFor: MapLabelProvider;
  readonly getStatus: () => MapStatus;
  /** Calls `listener` whenever `getStatus()` changes. */
  readonly subscribe: (listener: () => void) => () => void;
  /** What the pointer is over on the map, as the tooltip says it; null for nothing. */
  readonly getHover: () => string | null;
  /** Calls `listener` whenever `getHover()` changes (kept apart from the status: it changes on every marker crossed). */
  readonly subscribeHover: (listener: () => void) => () => void;
  /**
   * The Map layers drawer's hidden rows (map-presentation.md §25.3.4; step MP.4b): the pin rows go
   * to the adapter's mask (a redraw), Unlocks soon and Low level also into the givers' input while
   * shown, and the step numbers row to the labels canvas. The layer rows are the store's layer
   * visibility, which the drawer writes itself.
   */
  readonly setCategories: (hidden: readonly MapCategoryId[]) => void;
  /** A map search's filter (§25.3.5): only the pin layers' items it found are drawn; null ends it. */
  readonly setSearchFilter: (only: MapMask['only']) => void;
  /**
   * Shows a search result (§25.3.5): pans to its point (never zooming out past it), and rings the
   * pin of the place or quest it matches (`match`; null for none) while it is the chosen result,
   * whichever pin layer draws it. False when its map has no surface here.
   */
  readonly showResult: (point: WorldPoint, match: MapResultMatch | null) => boolean;
  /** Fits points on the map ("Fit results on the map"); false when none is on a surface here. */
  readonly fitPoints: (points: readonly WorldPoint[]) => boolean;
  /** Zooms in (positive) or out by `delta` levels: the map's floating zoom buttons (§25.3.0). */
  readonly zoomBy: (delta: number) => void;
  /** The dataset view the map draws, for the map search's index (a lazy part). */
  readonly dataset: () => DatasetView;
  /** The dataset's flight masters (the map search's flight points). */
  readonly flightMasterIds: () => readonly NpcId[];
  /** The quest state the map draws, or null without one, for the map search's state words. */
  readonly questState: () => QuestStateModel | null;
}

/** What a chosen search result rings on the map: the pin of a place (`subjectKeyOf`), of a quest's giver, or a places-model pin by id (review PR-05). */
export interface MapResultMatch {
  readonly subject?: string | undefined;
  readonly questId?: QuestId | undefined;
  /** The places model's pins (a dungeon's, a flight point's, a stop's, a service NPC's spawns), by id. */
  readonly pins?: readonly string[] | undefined;
}

/** A cluster's click zooms to its members, no further than the zone band (map-presentation.md §25.2.5): just past the band's edge and its hysteresis. */
export const CLUSTER_MAX_ZOOM = zoomAtPxPerYard(BAND_EDGES.zone) + 2 * BAND_HYSTERESIS_ZOOM;

/** "Show result" zooms in to at least this (the zone band: pins are separate there, §25.2.4). */
export const RESULT_MIN_ZOOM = CLUSTER_MAX_ZOOM;

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
  'route-pending': 'Route (walking path pending)',
  'route-fallback': 'Route (straight line: no walking path)',
  highlight: 'Selected leg',
  proposal: 'Proposed route',
  'network-flight': 'Flight',
  'network-transport': 'Transport route',
};

const NO_ART: readonly ArtInput[] = [];
const NO_RELIEF: readonly ReliefInput[] = [];
/** On the atlas the relief backdrop is hidden above zoom 0 (map-atlas.md §8.6): it would be laid out wider than 44,000 px. */
const RELIEF_MAX_ZOOM = 0;
/** With `smoothWheel`, the other band is built within this many levels of its edge (map-atlas.md §8.2). */
const PREBUILD_WITHIN = 0.5;

/** The band edges (`BAND_EDGES`) with the bands either side (map-presentation.md §5.1). */
const BAND_CROSSINGS: readonly { readonly below: MapBand; readonly above: Exclude<MapBand, 'world'> }[] = [
  { below: 'world', above: 'continent' },
  { below: 'continent', above: 'zone' },
  { below: 'zone', above: 'close' },
];

/** The layers the idle prebuild collects (review MR-01): the spawn layers first (the costliest), then every other but the images. */
const PREBUILD_LAYERS: readonly LayerId[] = [...SPAWN_LAYER_IDS, ...LAYER_IDS.filter((layer) => layer !== 'art' && layer !== 'relief' && !(SPAWN_LAYER_IDS as readonly LayerId[]).includes(layer))];

/** One part of a view (map-atlas.md §8.2) with its builder and its layers' calls. */
interface PlannedPart {
  readonly view: MapView;
  readonly builder: MapLayers;
  readonly calls: Readonly<Record<LayerId, LayerCall>>;
}

const NO_OUTLINES: readonly OutlineInput[] = [];





/** The terrain arc file each outline layer draws. */
const OUTLINE_KIND: Readonly<Record<'zone-outlines' | 'coastline', TerrainArcKind>> = { 'zone-outlines': 'zones', coastline: 'coast' };


/** The labels layer's input until the places model has built the names (map-presentation.md §13; step MP.7). */
const NO_LABELS: readonly LabelDescriptor[] = [];

/** A layer's notes until the wording is installed (`setWording`). */
const NO_NOTES: readonly string[] = [];

/** The drawer's counts until the wording is installed. */
const NO_COUNTS: MapCategoryCounts = { afterStep: null, who: '', quests: {}, availableGivers: null, ready: null, places: {}, inView: {} };

const NO_ITEMS: readonly MapDescriptor[] = [];
const NO_FILLS: readonly ZoneFillDescriptor[] = [];

const withBadges = (text: string, badges: readonly string[]): string => (badges.length === 0 ? text : `${text} (${badges.join('; ')})`);

/** Remembers the last result of `compute` and returns it while every argument is the same (`Object.is`). */
/**
 * The underground cities (Ironforge 1455, the Undercity 1458: `UNDERGROUND_CITIES` in zone-levels.ts,
 * kept out of the entry chunk) and the closest zoom a jump to one lands at in the minimap style.
 */
const UNDERGROUND_JUMP = { cities: [1455, 1458] as readonly number[], maxZoom: -2 } as const;

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

/** `requestIdleCallback` where it exists (with a 200 ms deadline), else a 50 ms timeout. */
function defaultIdle(task: () => void): () => void {
  const scope = globalThis as { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (handle: number) => void };
  if (typeof scope.requestIdleCallback === 'function' && typeof scope.cancelIdleCallback === 'function') {
    const cancelIdle = scope.cancelIdleCallback;
    const handle = scope.requestIdleCallback(task, { timeout: 200 });
    return () => {
      cancelIdle(handle);
    };
  }
  const handle = setTimeout(task, 50);
  return () => {
    clearTimeout(handle);
  };
}

/** Whether this build is a deploy build (`vite build --mode deploy`, review MD-03); false in development, tests and plain builds. */
function isDeployBuild(): boolean {
  try {
    return import.meta.env.MODE === 'deploy';
  } catch {
    return false;
  }
}

/** Whether this build is a painted build (`vite build --mode painted`, D-053), which has no minimap tiles; false in development, tests and other builds. */
function isPaintedBuild(): boolean {
  try {
    return import.meta.env.MODE === 'painted';
  } catch {
    return false;
  }
}

/** The base-map styles in the style control's order (map-atlas.md §21.6), and a painted build's one style (D-053). */
const BOTH_STYLES: readonly MapStyle[] = ['minimap', 'painted'];
const PAINTED_ONLY: readonly MapStyle[] = ['painted'];

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

/**
 * The view a band crossing lands in (review MR-01): `at` scaled about its centre to `zoom`, with
 * `band`, and on the atlas (`info`) its `visible` maps found again as the adapter finds them (every
 * placed map whose rectangle meets the view padded by 50 %, map-atlas.md §8.1), so the maps a
 * zoom-out brings in are built ahead too. Display only (D-017): a view rectangle, never a distance.
 */
export function viewAtZoom(info: AtlasSurfaceInfo | null, at: MapView, zoom: number, band: MapBand): MapView {
  const bounds = at.bounds ?? null;
  if (bounds === null) return { ...at, zoom, band };
  const center = boundsCenter(bounds);
  const scale = 2 ** (at.zoom - zoom);
  const halfX = ((bounds.xMax - bounds.xMin) / 2) * scale;
  const halfY = ((bounds.yMax - bounds.yMin) / 2) * scale;
  const around = (grow: number): WorldBounds => ({ mapId: at.mapId, xMin: center.x - halfX * grow, xMax: center.x + halfX * grow, yMin: center.y - halfY * grow, yMax: center.y + halfY * grow });
  const scaled = around(1);
  if (at.visible === undefined || info === null) return { ...at, zoom, band, bounds: scaled };
  // Padded by half the view's size on every side: twice the half-size.
  const padded = around(2);
  const visible = info.placements.flatMap((placement): WorldBounds[] => {
    const reach = boundsOnMap(info, padded, placement.mapId);
    const on = boundsOnMap(info, scaled, placement.mapId);
    return reach !== null && on !== null && rectsMeet(reach, placement.rect) ? [on] : [];
  });
  return { ...at, zoom, band, bounds: scaled, visible };
}

/** A world point in stage pixels (x east from the left edge, y south from the top), or null for a degenerate view or a map it does not show (`stagePixelOf` in map/adapter). */
export function stagePixelOf(view: MapViewState, point: WorldPoint): { readonly x: number; readonly y: number } | null {
  return stagePixelOnView(view, point);
}

/** A world map the atlas shows in a box (map-atlas.md §5.5). */
export interface MapInsetStatus {
  readonly mapId: WorldMapId;
  readonly name: string;
  /** Whether the dataset has a quest giver or turn-in with a spawn on it; "no quest data yet" is said only while it has none. */
  readonly questData: boolean;
}

/** An inset's note for the status line and the key (map-atlas.md §8.8): `Zephras Isle: shown in a box, not in position; no quest data yet`. */
export function insetNote(inset: MapInsetStatus): string {
  return `${inset.name}: shown in a box, not in position${inset.questData ? '' : '; no quest data yet'}`;
}

/**
 * The atlas's sentence for the map's instructions (map-atlas.md §8.8): `Both continents; Zephras
 * Isle is shown in a box between them, because the game does not place it; it has no quest data yet.`
 */
export function atlasInstruction(insets: readonly MapInsetStatus[]): string {
  const parts = insets.map(
    (inset) => `; ${inset.name} is shown in a box between them, because the game does not place it${inset.questData ? '' : '; it has no quest data yet'}`,
  );
  return `Both continents${parts.join('')}.`;
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
  | { readonly kind: 'focus'; readonly point: WorldPoint }
  /** A cluster's click (map-presentation.md §25.2.5): its members' bounds, no further than the zone band. */
  | { readonly kind: 'fit'; readonly bounds: WorldBounds };

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
    case 'fit':
      return `fit:${String(action.bounds.mapId)}:${String(action.bounds.xMin)}:${String(action.bounds.xMax)}:${String(action.bounds.yMin)}:${String(action.bounds.yMax)}`;
  }
};

type Pending =
  | { readonly kind: 'focus'; readonly stepId: StepId }
  | { readonly kind: 'fit'; readonly bounds: WorldBounds; readonly maxZoom: number | undefined; readonly minZoom: number | undefined; readonly zone: UiMapId | null }
  | { readonly kind: 'surface'; readonly surface: SurfaceId };

export function createMapController(options: MapControllerOptions): MapController {
  const { store, data, geometry } = options;
  const art = options.art ?? null;
  const resources = options.resources ?? null;
  const pathFeed = options.paths ?? null;
  /** A compatible local set's art replaces the committed art (D-018; dev and preview only). */
  const localArt = art !== null && art.status.kind === 'listed';
  // One memoised builder per world map (map-atlas.md §8.2), sharing the route caches; the first is
  // also where the geometry's surfaces, atlas and level of detail come from.
  const caches = createLayerCaches();
  const layerOptions = options.lod === undefined ? { geometry, caches } : { geometry, lod: options.lod, caches };
  const layers: MapLayers = createMapLayers(layerOptions);
  const builders = new Map<WorldMapId, MapLayers>();
  const builderFor = (mapId: WorldMapId): MapLayers => {
    const existing = builders.get(mapId);
    if (existing !== undefined) return existing;
    const created = builders.size === 0 ? layers : createMapLayers(layerOptions);
    builders.set(mapId, created);
    return created;
  };
  const join = createLayerJoin();
  /** One world surface per world map: names, continent frames, UiMaps. */
  const worldSurfaces = layers.surfaces;
  const atlasWanted = options.atlas !== false;
  const atlasInfo: AtlasSurfaceInfo | null = atlasWanted ? layers.atlas : null;
  const surfaces: readonly SurfaceInfo[] =
    atlasInfo === null ? worldSurfaces : [atlasInfo, ...worldSurfaces.filter((info) => !atlasInfo.mapIds.includes(info.mapId))];
  const nameOfMap = (mapId: WorldMapId): string | null => worldSurfaces.find((surface) => surface.mapId === mapId)?.name ?? null;
  const presets: readonly MapPreset[] =
    atlasInfo === null
      ? []
      : atlasInfo.placements
          .filter((placement) => placement.kind === 'placed')
          .map((placement) => ({
            id: `preset:${String(placement.mapId)}`,
            surface: atlasInfo.id,
            mapId: placement.mapId,
            name: nameOfMap(placement.mapId) ?? `World map ${String(placement.mapId)}`,
            bounds: placement.rect,
          }));
  const zones = zoneGroups(geometry, surfaces);
  const smoothWheel = options.smoothWheel !== false;
  const deployBuild = options.deployBuild ?? isDeployBuild();
  /** The styles this build can draw (D-053): a painted build has no minimap tiles. */
  const styles = (options.minimap ?? !isPaintedBuild()) ? BOTH_STYLES : PAINTED_ONLY;
  const idle = options.idle ?? defaultIdle;
  let cancelPrebuild: (() => void) | null = null;
  const objectUrls = options.objectUrls === undefined ? defaultObjectUrls() : options.objectUrls;
  const timing = options.timing === undefined ? defaultTiming() : options.timing;

  let adapter: MapAdapter | null = null;
  let mounted = false;
  let failure: string | null = null;
  let everMounted = false;
  /** Whether the style chosen in this browser has been read (`readStyle`). */
  let styleRead = false;
  let unsubscribeStore: (() => void) | null = null;
  let unsubscribeDerived: (() => void) | null = null;
  const derived = options.derived ?? null;
  /** The quest state the layers were last built from (a new model object is a new state). */
  let questState: QuestStateModel | null = derived?.getState().questState ?? null;
  /** The places model (steps MP.5, MP.8, MP.9: dungeons, flight points and flights, transports), from the derived pipeline. */
  let places: PlacesModel | null = derived?.getState().places ?? null;
  /** The hovered flight point's client node (§25.4: its flights are drawn when zoomed in); null for none. */
  let hoverNode: number | null = null;
  let unsubscribeFeed: (() => void) | null = null;
  let view: MapView | null = null;
  /**
   * The view's band (map-presentation.md §5.1), kept between views for the hysteresis: one band for
   * the whole view, from the scale of its centre map's placement (review MR-03). Every shown map of
   * that scale is built for it, a map entering the view inside the hysteresis window included, and
   * the adapter is given the same band (`MapAdapter.setBand`). `bandFresh`: the controller is moving
   * the view itself (a jump, a fit, a focus), so the band starts afresh.
   */
  let viewBand: MapBand | null = null;
  let bandFresh = false;
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
  let popover: MapPopoverTarget | null = null;
  /** The pin the open popover is on (its stack or its lead), drawn selected while it is open (§25.2.3; review PR-06). */
  let popoverPin: HighlightTarget | null = null;
  let popovers = 0;
  let pick: MapPickRequest | null = null;
  /** The Map layers drawer's hidden rows (`setCategories`; map-presentation.md §25.3.4). */
  let hidden: readonly MapCategoryId[] = DEFAULT_HIDDEN_CATEGORIES;
  let hiddenSet: ReadonlySet<MapCategoryId> = new Set(hidden);
  /** A map search's filter (`setSearchFilter`), and the pin its chosen result rings (`showResult`). */
  let searchOnly: MapMask['only'] = null;
  let selectedMatch: MapResultMatch | null = null;
  /** What the adapter was last given of these: sent again to a new adapter. */
  let sentMask: MapMask | null = null;
  let sentSelected: HighlightTarget | null | undefined;
  let sentNumbers: boolean | null = null;
  let sentGrid: boolean | null = null;
  /** Per drawer row, what the last settled view shows of it (§25.3.3's "k in view"). */
  let inView: Partial<Record<MapCategoryId, number>> = {};
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
  /** The art inputs each world map's part last drew, with their key. */
  const artInputs = new Map<WorldMapId, { readonly key: string; readonly inputs: readonly ArtInput[] }>();
  let artGeneration = 0;

  // Committed art and terrain (D-032, D-033): the manifests once (null while loading), the arc
  // files per world map and kind, each decoded once into an input that keeps its identity.
  let artManifest: ArtManifestLoad | null = null;
  let terrainManifest: TerrainManifestLoad | null = null;
  /** Each style's tile index (map-atlas.md §7.2, §21.1), once loaded; a refused one (its hash is not the surface's) is a failure. */
  const atlasIndexes = new Map<MapStyle, AtlasIndexLoad>();
  const atlasLoading = new Set<MapStyle>();
  /** Styles whose first view's images all failed (map-atlas.md §21.4: no tile pack), until chosen again. */
  const tilesFailed = new Set<MapStyle>();
  const styleSetting = options.mapStyle ?? null;
  /** The words of the layers' notes, once installed (`setWording`). */
  let wording: MapWording | null = options.wording ?? null;
  let chosenStyle: MapStyle = styles.includes(DEFAULT_MAP_STYLE) ? DEFAULT_MAP_STYLE : 'painted';
  /** The style whose band was last drawn: it stays while the chosen style's index loads. */
  let lastStyle: MapStyle | null = null;
  let artLoading = false;
  let terrainLoading = false;
  const arcLoads = new Map<string, TerrainArcsLoad | 'loading'>();
  const arcInputs = new Map<string, OutlineInput>();
  let arcVersion = 0;
  /** Committed images per world map, for the loaded manifest. */
  const imagesByMap = new Map<WorldMapId, readonly ArtImage[]>();

  // Walking paths (MAPS §7.4): null until the navigation model gives some.
  let routePaths: RoutePathsInput | null = null;

  // Memoised view models ---------------------------------------------------------------------

  /**
   * The views layers are built for (map-atlas.md §8.2): on a world surface the view itself; on the
   * atlas one per active map, the view translated into that map's yards (its `visible` rectangle,
   * centred there; the centre's own map keeps the view's centre).
   */
  function partViewsFor(at: MapView): readonly MapView[] {
    const visible = at.visible;
    if (visible === undefined) return [at];
    return viewMapIds(at).map((mapId): MapView => {
      const bounds = viewBoundsOn(at, mapId);
      const center = mapId === at.mapId ? at.center : bounds === null ? null : boundsCenter(bounds);
      const band = mapBandOf(at, mapId);
      return {
        mapId,
        zoom: at.zoom,
        center: center === null ? null : { x: center.x, y: center.y },
        bounds,
        surface: at.surface ?? 'atlas',
        visible,
        ...(band === undefined ? {} : { band }),
      };
    });
  }
  const partViewsOf = lastOf(partViewsFor);

  /** A shown map's placement scale on the view's surface (1 for every placement today, D-042 A1). */
  function scaleOn(surface: SurfaceId, mapId: WorldMapId): number {
    const info = surfaces.find((entry) => entry.id === surface);
    return info === undefined ? 1 : (placementOn(info, mapId)?.scale ?? 1);
  }

  /**
   * A shown map's band in a view (review MR-03): the view's own band for a map placed at the scale
   * of the view's centre map (every map today, D-042 A1), so two maps in one view are never built for
   * different bands; at another scale, derived from the view's band (`nextBand` with it as the
   * previous one, so the same hysteresis applies).
   */
  function mapBandOf(at: MapView, mapId: WorldMapId): MapBand | undefined {
    const band = at.band;
    if (band === undefined || mapId === at.mapId) return band;
    const surface = at.surface ?? 'atlas';
    const scale = scaleOn(surface, mapId);
    return scale === scaleOn(surface, at.mapId) ? band : nextBand(band, pxPerYardAt(at.zoom, scale));
  }

  /**
   * A settled view with its band (map-presentation.md §5.1): from the pixels per yard of its centre
   * map's placement, after the view's previous band (`nextBand`, with hysteresis) unless the
   * controller moved the view itself. The band is the view's, shared by every map it shows.
   */
  function bandedView(state: MapViewState): MapView {
    const base = mapViewOf(state);
    const band = bandNow(state);
    viewBand = band;
    return { ...base, band };
  }

  /** The band a view state would take now, without keeping it (the `zoom` event, before its `move`). */
  function bandNow(state: MapViewState): MapBand {
    // A move of the controller's own starts afresh only when it changes the zoom: a pan that follows
    // the active step keeps the band a view resting at an edge has.
    const fresh = bandFresh && (view === null || view.zoom !== state.zoom);
    return nextBand(fresh ? null : viewBand, pxPerYardAt(state.zoom, scaleOn(state.surface, state.mapId)));
  }

  /** Runs a view change the controller asks for itself: when it changes the zoom, its bands start afresh (no hysteresis across a jump). */
  function freshly<T>(run: () => T): T {
    const previous = bandFresh;
    bandFresh = true;
    try {
      return run();
    } finally {
      bandFresh = previous;
    }
  }

  const datasetOf = (state: EditorState): DatasetView => data.view(datasetViewInputOf(state.project));
  const routeOf = createRouteInputBuilder(geometry);
  /** What the route layers draw from: the route without steps they skip, so a note edit rebuilds none of them. */
  const drawnOf = createDrawnRouteFilter();
  /**
   * Whether the route layers draw step `id`: asked only for the focused steps, so a route edit
   * builds no set of every drawn id (M3 review PERF-2). The builder has just built the route.
   */
  const drawnStep = {
    has: (id: StepId): boolean => {
      const input = routeOf.inputOf(id);
      return input !== null && isDrawnStep(input);
    },
  };
  /** Each step's position in the route (`createPositions`: renumbered in place, only where the steps changed). */
  const stepPositions = createPositions((step: RouteStep) => step.id);
  const positionsOf = (steps: readonly RouteStep[]): ReadonlyMap<StepId, number> => stepPositions(steps).positions;
  /** The drawn route's order by step id, the same way; a note's text edit keeps the drawn route, so it renumbers nothing (M3 review PERF-2). */
  const drawnPositions = createPositions((step: RouteStepInput) => step.stepId);
  const drawnOrderOf = lastOf((route: RouteInput): Positions<StepId> => drawnPositions(route.steps));
  /**
   * Where the route line and beads split at the active step (map-presentation.md §13.6; review PR-02):
   * at the active step's place in the drawn route, or, for a step the route layers do not draw (a
   * note), at the last drawn step before it; null without an active step.
   */
  const splitOf = lastOf((route: RouteInput, steps: readonly RouteStep[], active: StepId | null): ActiveSplit | null => {
    if (active === null) return null;
    const { positions, version } = drawnOrderOf(route);
    const own = positions.get(active);
    if (own !== undefined) return { at: own, positions, version };
    const index = positionsOf(steps).get(active) ?? -1;
    if (index < 0) return null;
    for (let i = index - 1; i >= 0; i -= 1) {
      const at = positions.get(steps[i]?.id ?? active);
      if (at !== undefined) return { at, positions, version };
    }
    return { at: -1, positions, version };
  });
  type Character = EditorState['project']['character'];
  const giversOf = lastOf((dataset: DatasetView, race: Character['race'], cls: Character['class']): GiverLayerModel =>
    questGiverModel(dataset, { race, class: cls }),
  );
  const focusKeyOf = lastOf((ids: readonly QuestId[]): string => [...new Set(ids)].sort((a, b) => a - b).join(','));
  const questIdsOfKey = (key: string): readonly QuestId[] => (key === '' ? [] : key.split(',').map((id) => Number(id) as QuestId));
  const objectivesOf = lastOf((dataset: DatasetView, key: string): QuestPointsModel => objectiveModel(dataset, geometry, questIdsOfKey(key)));
  const turnInsOf = lastOf((dataset: DatasetView, key: string): QuestPointsModel => turnInModel(dataset, questIdsOfKey(key)));
  /**
   * With route state: the givers of the quest rows the drawer shows (the three drawn by default, and
   * Unlocks soon and Low level while shown), plus those of the focused quests outside them.
   */
  const rowsShownOf = lastOf((set: ReadonlySet<MapCategoryId>) => questRowsShown(set));
  const stateGiversOf = lastOf((model: QuestStateModel, key: string, rows: ReturnType<typeof questRowsShown>): SpawnLayerInput => model.giversFor(rows, questIdsOfKey(key)));
  /**
   * With route state: every log quest's turn-in, plus the focused quests' that are neither in the log
   * (as without state) nor done by the step: a quest turned in has no turn-in left, and the state
   * table has no row for one (§25.2.3; review PR-19).
   */
  const stateTurnInsOf = lastOf((model: QuestStateModel, dataset: DatasetView, key: string): SpawnLayerInput => {
    const others = questIdsOfKey(key).filter((id) => {
      const cls = model.quests.get(id)?.cls;
      return cls !== 'in-log' && cls !== 'done';
    });
    return others.length === 0 ? model.map.turnIns : { groups: [...model.map.turnIns.groups, ...turnInsOf(dataset, focusKeyOf(others)).input.groups] };
  });
  /** The quest layers' inputs: from the quest state when there is one, else the race-and-class rule. */
  function questInputs(
    state: EditorState,
    dataset: DatasetView,
    focusKey: string,
  ): { readonly givers: SpawnLayerInput; readonly objectives: SpawnLayerInput; readonly turnIns: SpawnLayerInput; readonly log: LogObjectivesInput | null } {
    const model = questState;
    const character = state.project.character;
    // While a search lasts, its results' quests join the inputs (not the focus: they are drawn with
    // their state, not emphasised), so a found place or quest has a pin of its own (review QA-09).
    const search = searchOnly === null ? null : searchDrawOf(dataset, searchOnly, selectedMatch);
    const objectives = objectivesOf(dataset, withQuests(focusKey, search?.targets)).input;
    const turnInKey = withQuests(focusKey, search?.finishers);
    if (model === null) return { givers: giversOf(dataset, character.race, character.class).input, objectives, turnIns: turnInsOf(dataset, turnInKey).input, log: null };
    return { givers: stateGiversOf(model, withQuests(focusKey, search?.givers), rowsShownOf(hiddenSet)), objectives, turnIns: stateTurnInsOf(model, dataset, turnInKey), log: model.map.log };
  }
  /** The quests that draw a search's results (`searchDrawQuests`), once per result set and chosen result. */
  const searchDrawOf = lastOf((dataset: DatasetView, only: NonNullable<MapMask['only']>, chosen: MapResultMatch | null): SearchDrawQuests => searchDrawQuests(dataset, only, chosen));
  /** A quest key (`focusKeyOf`'s form) with more quests. */
  const withQuests = (key: string, ids: readonly QuestId[] | undefined): string =>
    ids === undefined || ids.length === 0 ? key : [...new Set([...questIdsOfKey(key), ...ids])].sort((a, b) => a - b).join(',');
  const flightMastersOf = lastOf(
    (dataset: DatasetView, faction: Character['faction'], race: Character['race'], cls: Character['class']): FlightMasterModel =>
      flightMasterModel(dataset, data.flightMasterIds, { faction, race, class: cls }),
  );
  const summaryOf = lastOf((route: RouteInput) => routeMapSummary(route));
  /** The zone fills a part draws (tints under the faction patterns), one array while they are the same. */
  const fillsOf = lastOf((tint: readonly ZoneFillDescriptor[] | null, faction: readonly ZoneFillDescriptor[] | null): readonly ZoneFillDescriptor[] =>
    tint !== null && faction !== null ? [...tint, ...faction] : (tint ?? faction ?? NO_FILLS),
  );
  const reliefOf = lastOf((manifest: TerrainManifestLoad | null): readonly ReliefInput[] =>
    manifest?.kind !== 'loaded'
      ? NO_RELIEF
      : manifest.manifest.maps.flatMap((map) => (map.relief === null ? [] : [{ mapId: map.mapId, url: map.relief.url, bounds: map.relief.bounds }])),
  );
  /** Each style's band, one object per loaded index, so the adapter keeps its tile layer. */
  const bands = new Map<MapStyle, { readonly load: AtlasIndexLoad; readonly band: TileBandDescriptor }>();
  function bandOf(style: MapStyle): TileBandDescriptor | null {
    const load = atlasIndexes.get(style);
    if (load?.kind !== 'loaded') return null;
    const kept = bands.get(style);
    if (kept?.load === load) return kept.band;
    const band = tileBandOf(load.file.index, load.file.urlTemplate, style);
    bands.set(style, { load, band });
    return band;
  }
  /** The art layer's content while the tiles are drawn: the band alone. */
  const tilesContentOf = lastOf(
    (band: TileBandDescriptor): LayerContent => ({ layer: 'art', items: [band], stats: { ...EMPTY_LAYER_STATS, drawn: 1 } }),
  );
  const outlinesOf = {
    zones: lastOf((_version: number): readonly OutlineInput[] => outlineList('zones')),
    coast: lastOf((_version: number): readonly OutlineInput[] => outlineList('coast')),
  };

  const findStep = lastOf((steps: readonly RouteStep[], id: StepId | null): RouteStep | null => (id === null ? null : (steps.find((step) => step.id === id) ?? null)));
  const activeStepOf = (state: EditorState): RouteStep | null => findStep(state.project.route.steps, activeStep);

  // Labels -----------------------------------------------------------------------------------

  const surfaceName = (mapId: WorldMapId): string => nameOfMap(mapId) ?? `World map ${String(mapId)}`;

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

  /** Which layer drew a spawn ref (for its hover's state words). */
  const spawnLayers = new WeakMap<MapRef, SpawnLayerId>();

  function spawnText(ref: Extract<MapRef, { readonly kind: 'spawn' }>): string | null {
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
        spawnLayers.set(ref, layer);
        return text;
      }
    }
    return null;
  }

  /**
   * A spawn's hover text. The quest layers say whose state it is (map-presentation.md §7.1): "After
   * step N" from the route order now, or, for the givers, that there is no route state yet.
   */
  function spawnLabel(ref: Extract<MapRef, { readonly kind: 'spawn' }>): string | null {
    const text = spawnText(ref);
    const layer = spawnLayers.get(ref);
    if (text !== null && layer === 'flight-masters') return withStepNumber(text);
    if (text === null || (layer !== 'available-quests' && layer !== 'turn-ins')) return text;
    const model = questState;
    if (model !== null) return `${afterStep(model)}${text}`;
    return layer === 'available-quests' ? `${text} · ${noStateText(characterName(store.getState().project.character)).replace(/^Q/, 'q')}` : text;
  }

  /** A cluster's hover (map-presentation.md §25.2.5): its own words after "After step N: ", or what the quest layers say without route state. */
  function clusterHover(ref: Extract<MapRef, { readonly kind: 'cluster' }>): string | null {
    const item = contents.get(ref.layer)?.items.find((entry) => entry.type === 'marker' && entry.ref === ref);
    const text = item?.label ?? null;
    if (text === null) return null;
    const model = questState;
    if (model !== null) return `${afterStep(model)}${text}`;
    return ref.layer === 'available-quests' ? `${text} · ${noStateText(characterName(store.getState().project.character)).replace(/^Q/, 'q')}` : text;
  }

  /** A step's number in the route; null when it has left the route. */
  function stepNumberOf(state: EditorState, id: StepId): number | null {
    const index = positionsOf(state.project.route.steps).get(id);
    return index === undefined ? null : index + 1;
  }

  /** A place's hover with the active step's number in place of its token (`STEP_TOKEN`), or without the step when it left the route. */
  function withStepNumber(text: string): string {
    if (!text.includes(STEP_TOKEN)) return text;
    const stepId = places?.stepId ?? null;
    const index = stepId === null ? undefined : positionsOf(store.getState().project.route.steps).get(stepId);
    return index === undefined ? text.split(` after step ${STEP_TOKEN}`).join('').split(STEP_TOKEN).join('?') : text.split(STEP_TOKEN).join(groupDigits(index + 1));
  }

  /** A place ref's hover (a dungeon, a flight point with no flight master, a flight, a transport): its item's words with the step's number. */
  function placeLabel(ref: MapRef, layer: LayerId): string | null {
    for (const item of contents.get(layer)?.items ?? []) {
      const index = refsOf(item).indexOf(ref);
      if (index < 0) continue;
      const own = item.type === 'marker' ? (item.labels[index] ?? null) : item.label;
      return own === null ? null : withStepNumber(own);
    }
    return null;
  }

  /** "After step 14: " from the route order; empty when the model's step has left the route. */
  function afterStep(model: QuestStateModel): string {
    const index = positionsOf(store.getState().project.route.steps).get(model.stepId);
    return index === undefined ? '' : `After step ${groupDigits(index + 1)}: `;
  }


  /**
   * Step numbers for the labels canvas (map-presentation.md §13.6): a step's position in the route
   * and the active step, asked when the canvas is drawn, never stored in a descriptor.
   */
  const stepNumbers: MapStepNumbers = {
    stepNumber: (id) => {
      const index = positionsOf(store.getState().project.route.steps).get(id);
      return index === undefined ? null : index + 1;
    },
    activeStep: () => activeStep,
  };
  /** The route and active step the labels canvas was last asked to number (`refreshLabels`). */
  let numbered: { readonly steps: readonly RouteStep[]; readonly active: StepId | null } | null = null;

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
        return withBadges(plainGuideText(options.describeStep(step, index, datasetOf(state))), badges);
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
      case 'connector': {
        const span = fromTo(ref.fromStepId, ref.toStepId);
        return span === null ? null : `${LINE_WORDS[ref.leg]} to ${surfaceName(ref.toMapId)}: ${span}`;
      }
      case 'departure': {
        const n = numberOf(ref.stepId);
        return n === null ? null : `Step ${n}: ${LINE_WORDS[ref.leg]} (destination unknown until simulation)`;
      }
      case 'spawn':
        return spawnLabel(ref);
      case 'cluster':
        return clusterHover(ref);
      case 'dungeon':
        return placeLabel(ref, 'dungeons');
      case 'taxi-node':
        return placeLabel(ref, 'flight-masters');
      case 'taxi-edge':
        return placeLabel(ref, 'flight-network');
      case 'transport':
        return placeLabel(ref, 'transports');
      case 'service':
        return placeLabel(ref, 'services');
      case 'aggregate':
      case 'zone':
      case 'surface':
      case 'art':
      case 'terrain':
      case 'atlas-tiles':
        return null;
    }
  }

  const descriptorOf = (layer: LayerId, id: string): MapDescriptor | undefined => contents.get(layer)?.items.find((item) => item.id === id);

  // Status -----------------------------------------------------------------------------------

  let status: MapStatus = buildStatus(store.getState());

  /** The surface the adapter shows, or null. */
  function shownInfo(): SurfaceInfo | null {
    const surface = adapter?.getSurface() ?? null;
    return surface === null ? null : (surfaces.find((info) => info.id === surface) ?? null);
  }

  /** The world maps shown now: the view's (on the atlas, its active maps), else the shown surface's. */
  function shownMapIds(): readonly WorldMapId[] {
    const info = shownInfo();
    if (info === null) return [];
    const maps = surfaceMapIds(info);
    return view === null ? maps : viewMapIds(view).filter((mapId) => maps.includes(mapId));
  }

  /** The dataset has quest points on an inset's map (for its note), per dataset view. */
  const insetHasQuests = lastOf((dataset: DatasetView, mapId: WorldMapId): boolean => mapHasQuestPoints(dataset, mapId));

  /** The shown surface's insets (map-atlas.md §8.8): the atlas's, each with whether the dataset has quest points there. */
  function insetsOf(state: EditorState): readonly MapInsetStatus[] {
    const info = shownInfo();
    if (info === null || !isAtlasSurface(info)) return [];
    const dataset = datasetOf(state);
    return info.placements
      .filter((placement) => placement.kind === 'inset')
      .map((placement) => ({
        mapId: placement.mapId,
        name: nameOfMap(placement.mapId) ?? `World map ${String(placement.mapId)}`,
        questData: insetHasQuests(dataset, placement.mapId),
      }));
  }

  /** The facts a layer's notes are worded from (`MapNotesSource`), for the installed wording. */
  function notesSourceOf(state: EditorState): MapNotesSource {
    const dataset = datasetOf(state);
    const character = state.project.character;
    const model = questState;
    return {
      character,
      questState: model,
      afterStep: model === null ? '' : afterStep(model),
      afterStepNumber: model === null ? null : stepNumberOf(state, model.stepId),
      givers: () => giversOf(dataset, character.race, character.class),
      focusWork: (layer) => {
        const key = focusKeyOf(focusQuestIds(state.view.openedQuests, state.selection, activeStepOf(state)));
        return layer === 'objectives' ? objectivesOf(dataset, key) : turnInsOf(dataset, key);
      },
      flightMasters: () => flightMastersOf(dataset, character.faction, character.race, character.class),
      places,
      questName: (id) => dataset.quest(id)?.name ?? null,
      art: artNotesState(),
      artUnder: state.view.map.layers.art && (contents.get('art')?.stats.drawn ?? 0) > 0,
      terrainLoading: resources !== null && terrainManifest === null,
      arcsLoading: (layer) => shownMapIds().some((mapId) => arcLoads.get(`${String(mapId)}/${OUTLINE_KIND[layer]}`) === 'loading'),
    };
  }

  /** The map's resources, for the drawer's reasons and notices (`MapResourceFacts`). */
  function resourceFactsOf(state: EditorState): MapResourceFacts {
    return {
      resources: resources !== null,
      localArt: art?.status ?? null,
      artManifest,
      terrainManifest,
      shownMapIds: shownMapIds(),
      committedArtOn: (mapId) => committedImagesOn(mapId).length,
      arcLoad: (mapId, kind) => arcLoads.get(`${String(mapId)}/${kind}`),
      onAtlas: onAtlas(),
      atlasMode: atlasMode(),
      atlasUnplaced: atlasWanted && atlasInfo === null,
      styleFailure: styleFailure(chosenStyle),
      styleUnavailable: styleUnavailable(),
      layers: state.view.map.layers,
      reliefDrawn: (contents.get('relief')?.stats.drawn ?? 0) > 0,
      places,
    };
  }

  /** What the art layer draws, for its notes. */
  function artNotesState(): ArtNotesState {
    if (art !== null && art.status.kind === 'listed') return { kind: 'local', count: art.status.count, refused: [...artRefused] };
    if (onAtlas() && atlasMode() === 'tiles') return { kind: 'tiles', style: drawnStyle() };
    if (onAtlas() && atlasMode() === 'loading') return { kind: 'tiles-loading' };
    if (artManifest?.kind === 'loaded') return { kind: 'committed', onAtlas: onAtlas(), unplaced: artManifest.manifest.unplaced.map((entry) => entry.name) };
    return resources !== null && artManifest === null ? { kind: 'loading' } : { kind: 'none' };
  }

  /** The atlas is the surface shown. */
  function onAtlas(): boolean {
    const shown = shownInfo();
    return shown !== null && isAtlasSurface(shown);
  }

  /** What the route line does with walking paths on this surface (`LayerStats.paths`). */
  function walkingPathsStatus(state: EditorState): WalkingPathsStatus {
    const visible = state.view.map.walkingPaths;
    if (routePaths === null) return { visible, unavailable: 'No walking paths are available yet: every leg is drawn as a straight line', notes: [] };
    if (wording === null) return { visible, unavailable: null, notes: NO_NOTES };
    const counts = contents.get('route-line')?.stats.paths;
    if (!visible || counts === undefined) return { visible, unavailable: null, notes: wording.walkingPathNotes(null) };
    // Legs outside the view that were never asked for are drawn like the rest of the object's
    // unanswered legs, but are neither being computed nor known to have no path: said apart.
    const outside = pathFeed !== null && routePaths === pathFeed.current() ? pathFeed.outOfView() : 0;
    const pending = routePaths.pending ? Math.max(0, counts.pending - outside) : counts.pending;
    const fallback = routePaths.pending ? counts.fallback : Math.max(0, counts.fallback - outside);
    return { visible, unavailable: null, notes: wording.walkingPathNotes({ along: counts.along, pending, fallback, outside }) };
  }

  function activePlacementOf(placement: StepPlacement): ActivePlacement {
    switch (placement.kind) {
      case 'point': {
        const info = surfaceForMap(surfaces, adapter?.getSurface() ?? null, placement.world.mapId);
        return info === null ? { kind: 'no-surface', mapId: placement.world.mapId } : { kind: 'point', surface: info.id };
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
    const info = shownInfo();
    const onMaps = info === null ? [] : surfaceMapIds(info);
    const onSurface = summary.maps.reduce((sum, entry) => sum + (onMaps.includes(entry.mapId) ? entry.steps : 0), 0);
    const noSurface = stepsWithoutSurface(summary, surfaces);
    const source = wording === null ? null : notesSourceOf(state);
    const facts = wording === null ? null : resourceFactsOf(state);
    const layerStatus = LAYER_IDS.map((layer): MapLayerStatus => {
      const stats = contents.get(layer)?.stats ?? EMPTY_LAYER_STATS;
      return {
        layer,
        visible: state.view.map.layers[layer],
        unavailable: wording === null || facts === null ? null : wording.layerUnavailable(layer, facts),
        stats,
        notes: wording === null || source === null ? NO_NOTES : wording.layerNotes(layer, stats, source),
      };
    });
    const artDrawn = contents.get('art')?.stats.drawn ?? 0;
    const reliefDrawn = contents.get('relief')?.stats.drawn ?? 0;
    const shown = state.view.map.layers;
    const backdrop: MapBackdrop = shown.art && artDrawn > 0 ? (localArt ? 'local-art' : 'art') : shown.relief && reliefDrawn > 0 ? 'relief' : 'schematic';
    const index = activeStep === null ? null : routeStepIndex(route, activeStep);
    const active = index === null ? undefined : route.steps[index];
    return {
      attached: mounted,
      failure,
      surface: adapter?.getSurface() ?? null,
      layers: layerStatus,
      route: { ...summary, onSurface, noSurface, canFit: summary.placed - noSurface > 0 },
      artDrawn,
      backdrop,
      walkingPaths: walkingPathsStatus(state),
      problems: wording === null || facts === null ? NO_NOTES : wording.problems(facts),
      insets: insetsOf(state),
      activeStep: index === null || active === undefined ? null : { stepId: active.stepId, number: index + 1, placement: activePlacementOf(active.placement) },
      popover,
      pick: pick === null ? null : { label: pick.label },
      style: { chosen: chosenStyle, shown: onAtlas() && atlasMode() === 'tiles' ? drawnStyle() : null, unavailable: styleUnavailable() },
      counts: wording === null || source === null ? NO_COUNTS : wording.counts(source, inView),
      hidden,
      searching: searchOnly !== null,
      viewing: viewingZone(),
    };
  }

  /**
   * The zone the view centre is in, at the zone band or closer (review QA-01): by the terrain zone
   * rings (`zoneOfPoint`, which the derived pipeline publishes as the places' `zoneAt`, keeping it out
   * of the entry chunk), not the overlapping zone frames, which named The Barrens for the Valley of
   * Trials; the frame the centre is most central in only where no ring holds it, or until the places
   * are built.
   */
  const zoneAtCentre = lastOf((mapId: WorldMapId, x: number, y: number, zoneAt: PlacesModel['zoneAt']): UiMapId | null =>
    zoneAt === undefined || zoneAt === null ? (zoneFramesContaining({ mapId, x, y }, geometry)[0] ?? null) : zoneAt({ mapId, x, y }),
  );
  function viewingZone(): UiMapId | null {
    const at = view;
    const band = at === null ? null : bandOfView(at);
    if (at === null || at.center === null || (band !== 'zone' && band !== 'close')) return null;
    return zoneAtCentre(at.mapId, at.center.x, at.center.y, places?.zoneAt);
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

  function viewPatch(state: MapViewState, band: MapBand | undefined): MapUiPatch {
    return { surface: state.surface, zoomBand: band === undefined ? layers.lodLevel(state.zoom) : bandLevelOf(band) };
  }

  /** Whether the zone jumped to is still worth emphasising in this view: on its surface and (for a settled view) in sight. */
  function zoneShown(zone: UiMapId, shown: MapViewState, settled: boolean): boolean {
    const bounds = zoneBounds(geometry, zone);
    const info = surfaces.find((entry) => entry.id === shown.surface);
    if (bounds === null || info === undefined || !surfaceMapIds(info).includes(bounds.mapId)) return false;
    if (!settled) return true;
    const seen = bounds.mapId === shown.mapId ? shown.bounds : (shown.visible?.find((entry) => entry.mapId === bounds.mapId) ?? null);
    return seen !== null && rectsMeet(bounds, seen);
  }

  // Art --------------------------------------------------------------------------------------

  /**
   * The committed images a world map can draw: its continent image and its zone images. Other
   * continent-type images (the alternative continents 1463 and 1464) are left out, and of two
   * images of one rectangle (Zephras Isle 2521 and 2665) the one with more pixels is kept.
   */
  function committedImagesOn(mapId: WorldMapId): readonly ArtImage[] {
    if (artManifest?.kind !== 'loaded') return [];
    const cached = imagesByMap.get(mapId);
    if (cached !== undefined) return cached;
    const extentUiMapId = worldSurfaces.find((surface) => surface.mapId === mapId)?.extentUiMapId ?? null;
    const byRect = new Map<string, ArtImage>();
    for (const image of artManifest.manifest.images) {
      if (image.bounds.mapId !== mapId || (image.uiMapType === 2 && image.uiMapId !== extentUiMapId)) continue;
      const b = image.bounds;
      const key = `${String(b.xMin)},${String(b.xMax)},${String(b.yMin)},${String(b.yMax)}`;
      const other = byRect.get(key);
      if (other === undefined || image.width * image.height > other.width * other.height) byRect.set(key, image);
    }
    const images = [...byRect.values()].sort((a, b) => a.uiMapId - b.uiMapId);
    imagesByMap.set(mapId, images);
    return images;
  }

  /**
   * The images the art layer draws in this view (M3 review PERF-9), from `onMap` (one world map's):
   * the map being viewed, one image at a time as the game's world map shows it. Zone images carry
   * painted borders, so neighbours drawn together would cover each other.
   * - Zoomed out: the continent image.
   * - Zoomed in, or on a world map without a continent image: the image of the zone being viewed,
   *   the zone jumped to while the view centre is in its rectangle, else the zone frame the centre
   *   is most central in that has an image (`zoneFramesContaining`, coordinates.md §15).
   * - Zoomed in outside every zone image, none: the continent image is too coarse there, and the
   *   relief is the backdrop (terrain-navigation.md §13.2).
   */
  function chooseArt<T extends { readonly uiMapId: UiMapId; readonly bounds: Rect }>(onMap: readonly T[], at: MapView, jumped: UiMapId | null): readonly T[] {
    const extentUiMapId = worldSurfaces.find((surface) => surface.mapId === at.mapId)?.extentUiMapId ?? null;
    const continent = onMap.find((entry) => entry.uiMapId === extentUiMapId) ?? null;
    if (continent !== null && viewLodLevel(at, layers.lod) === 'continent') return [continent];
    const center = at.center;
    if (center === null) return [];
    const byId = new Map(onMap.filter((entry) => entry !== continent).map((entry) => [entry.uiMapId, entry]));
    const viewed = jumped === null ? undefined : byId.get(jumped);
    if (viewed !== undefined && distanceSqTo(viewed.bounds, center.x, center.y) === 0) return [viewed];
    for (const id of zoneFramesContaining({ mapId: at.mapId, x: center.x, y: center.y }, geometry)) {
      const entry = byId.get(id);
      if (entry !== undefined) return [entry];
    }
    return [];
  }

  /**
   * `chooseArt` for one map's part of a view. On the atlas (interim art, map-atlas.md §8.6): an
   * inset's card shows its whole painting; a placed map shows its continent painting at the
   * continent band (clipped to its side of the partition by map/layers), and at the zone band only
   * the map under the view centre shows the zone being viewed, one at a time.
   */
  function chooseArtFor<T extends { readonly uiMapId: UiMapId; readonly bounds: Rect }>(onMap: readonly T[], at: MapView, jumped: UiMapId | null): readonly T[] {
    const placement = at.surface === 'atlas' && atlasInfo !== null ? placementOn(atlasInfo, at.mapId) : null;
    if (placement?.kind === 'inset') return onMap;
    if (placement?.kind === 'placed' && viewLodLevel(at, layers.lod) !== 'continent' && at.mapId !== view?.mapId) return [];
    return chooseArt(onMap, at, jumped);
  }

  /**
   * The committed images one map's part draws. On the atlas the tiles are the painted art
   * (map-atlas.md §8.6): no per-image art is drawn for a placed map; with the index refused, an
   * inset's card shows its own painting (Zephras Isle has no relief).
   */
  function committedArtFor(at: MapView, state: EditorState): readonly ArtImage[] {
    const placement = at.surface === 'atlas' && atlasInfo !== null ? placementOn(atlasInfo, at.mapId) : null;
    if (placement !== null && (placement.kind !== 'inset' || atlasMode() !== 'refused')) return [];
    return chooseArtFor(committedImagesOn(at.mapId), at, state.view.map.zone);
  }

  /**
   * What the atlas draws for its painted art (map-atlas.md §8.6): `tiles`; `loading` the index;
   * `refused` (it could not be loaded, its hash is not the surface's, or this build has none);
   * `local` art in its place (dev and preview); `none` without the atlas or committed resources
   * (placeholder mode: frames and data only).
   */
  function atlasMode(): 'tiles' | 'loading' | 'refused' | 'local' | 'none' {
    if (atlasInfo === null || resources === null) return 'none';
    if (localArt) return 'local';
    if (resources.atlas === undefined) return 'refused';
    if (drawnStyle() !== null) return 'tiles';
    if (styleState(chosenStyle) !== 'failed') return 'loading';
    const fallback = fallbackStyle();
    return fallback === null || styleState(fallback) === 'failed' ? 'refused' : 'loading';
  }

  // Styles (map-atlas.md §21) -----------------------------------------------------------------

  /** The style drawn in the chosen one's place when it fails: the other one, if this build has it (a painted build has one style, D-053); else null. */
  function fallbackStyle(): MapStyle | null {
    const other: MapStyle = chosenStyle === 'minimap' ? 'painted' : 'minimap';
    return styles.includes(other) ? other : null;
  }

  function styleState(style: MapStyle): 'idle' | 'loading' | 'ready' | 'failed' {
    if (tilesFailed.has(style)) return 'failed';
    const load = atlasIndexes.get(style);
    if (load === undefined) return atlasLoading.has(style) ? 'loading' : 'idle';
    return load.kind === 'loaded' ? 'ready' : 'failed';
  }

  /**
   * The style the atlas draws (§21.2, §21.4): the chosen one when its index has loaded; while it
   * loads, the style drawn before; when it fails, the other one once that has loaded (if this build
   * has it); else none.
   */
  function drawnStyle(): MapStyle | null {
    const state = styleState(chosenStyle);
    if (state === 'ready') return chosenStyle;
    if (state === 'failed') {
      const fallback = fallbackStyle();
      return fallback !== null && styleState(fallback) === 'ready' ? fallback : null;
    }
    return lastStyle !== null && styleState(lastStyle) === 'ready' ? lastStyle : null;
  }

  /** The styles whose index is wanted now: the chosen one, and the other (if this build has it) once the chosen one has failed. */
  function wantedStyles(): readonly MapStyle[] {
    const fallback = styleState(chosenStyle) === 'failed' ? fallbackStyle() : null;
    return fallback === null ? [chosenStyle] : [chosenStyle, fallback];
  }

  /** Why `style` cannot be drawn; null when it can (or has not failed). */
  function styleFailure(style: MapStyle): string | null {
    if (tilesFailed.has(style)) {
      if (style !== 'minimap') return 'Painted map tiles could not be loaded';
      // A deploy build has every tile (§24.3): a failure there is the network's, not a missing pack (review MD-03).
      return deployBuild ? 'Minimap tiles could not be loaded' : 'Minimap tiles not downloaded (run `pnpm maps:minimap:fetch`)';
    }
    const load = atlasIndexes.get(style);
    return load?.kind === 'failed' ? load.detail : null;
  }

  /** The §21.4 message when the other style is drawn in the chosen one's place; null otherwise (and in a build with one style, D-053). */
  function styleUnavailable(): string | null {
    const why = styleFailure(chosenStyle);
    if (why === null || fallbackStyle() === null) return null;
    const instead = chosenStyle === 'minimap' ? 'showing the painted map' : 'showing the minimap';
    if (tilesFailed.has(chosenStyle)) return `${why}; ${instead}`;
    return `${chosenStyle === 'minimap' ? 'Minimap' : 'Painted map'} tiles unavailable: ${why}; ${instead}`;
  }

  /** The local set's images to load and draw in this view (one map's part). */
  function wantedArt(at: MapView, state: EditorState): readonly LocalArtEntry[] {
    if (art === null || art.status.kind !== 'listed') return [];
    return chooseArtFor(
      art.entries.filter((entry) => entry.mapId === at.mapId),
      at,
      state.view.map.zone,
    );
  }

  /** The art one map's part draws, keeping its previous array while the images are the same. */
  function artFor(at: MapView, state: EditorState): readonly ArtInput[] {
    const previous = artInputs.get(at.mapId);
    if (!state.view.map.layers.art) return previous?.inputs ?? NO_ART;
    const drawable: readonly ArtInput[] = localArt
      ? wantedArt(at, state).flatMap((entry) => {
          const url = artUrls.get(entry.uiMapId);
          return url === undefined ? [] : [{ uiMapId: entry.uiMapId, url, opacity: 1 }];
        })
      : committedArtFor(at, state).map((image) => ({ uiMapId: image.uiMapId, url: image.url, opacity: 1, bounds: image.bounds }));
    const key = drawable.map((input) => `${String(input.uiMapId)}=${input.url}`).join(' ');
    if (previous !== undefined && previous.key === key) return previous.inputs;
    const inputs = drawable.length === 0 ? NO_ART : drawable;
    artInputs.set(at.mapId, { key, inputs });
    return inputs;
  }

  function requestArt(at: MapView, state: EditorState): void {
    if (art === null || art.status.kind !== 'listed' || objectUrls === null || !state.view.map.layers.art) return;
    const generation = artGeneration;
    for (const entry of partViewsOf(at).flatMap((part) => wantedArt(part, state))) {
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

  // Committed resources ----------------------------------------------------------------------

  /** The loaded outlines of one kind, each world map's input object kept from its load. */
  function outlineList(kind: TerrainArcKind): readonly OutlineInput[] {
    const list: OutlineInput[] = [];
    for (const [key, input] of arcInputs) if (key.endsWith(`/${kind}`)) list.push(input);
    return list.length === 0 ? NO_OUTLINES : list.sort((a, b) => a.mapId - b.mapId);
  }

  /**
   * Loads the art and terrain manifests (once; again at the next attach after a failed request).
   * Each result syncs the map; a failure is kept and said, never thrown.
   */
  function requestResources(): void {
    if (resources === null) return;
    if (!artLoading && (artManifest === null || (artManifest.kind === 'failed' && artManifest.reason === 'unavailable'))) {
      artLoading = true;
      void resources.art().then((result) => {
        artLoading = false;
        artManifest = result;
        imagesByMap.clear();
        sync('art-manifest');
      });
    }
    requestAtlasIndexes();
    if (!terrainLoading && (terrainManifest === null || (terrainManifest.kind === 'failed' && terrainManifest.reason === 'unavailable'))) {
      terrainLoading = true;
      void resources.terrain().then((result) => {
        terrainLoading = false;
        terrainManifest = result;
        sync('terrain-manifest');
      });
    }
    // Arc files that could not be fetched are tried again.
    for (const [key, load] of arcLoads) if (load !== 'loading' && load.kind === 'failed' && load.reason === 'unavailable') arcLoads.delete(key);
  }

  /**
   * Loads the tile index of every wanted style (map-atlas.md §21.2): each once, again after an
   * `unavailable` failure at the next request (a mount, a style chosen, a failed band). Called as a
   * load ends (`afterLoad`), it asks only for styles never asked for, so indexes that keep failing
   * (HTTP 404) are not fetched in a loop, one style's failure asking for the other's.
   */
  function requestAtlasIndexes(afterLoad = false): void {
    const source = resources;
    if (atlasInfo === null || localArt || source?.atlas === undefined || !styleRead) return;
    for (const style of wantedStyles()) {
      const load = atlasIndexes.get(style);
      if (atlasLoading.has(style) || (load !== undefined && (afterLoad || load.kind === 'loaded' || load.reason !== 'unavailable'))) continue;
      atlasLoading.add(style);
      // Tiles composed for other placements are refused, never drawn out of place (map-atlas.md §7.2, §8.6).
      void source.atlas(atlasInfo.hash, style).then((result) => {
        atlasLoading.delete(style);
        atlasIndexes.set(style, result);
        // A failed style wants the other one.
        requestAtlasIndexes(true);
        sync('atlas-index');
      });
    }
  }

  /** Loads the zone outlines and coastline of the shown world map, for the layers that are visible (the coastline is off by default). */
  function requestArcs(at: MapView, state: EditorState): void {
    for (const part of partViewsOf(at)) requestMapArcs(part.mapId, state);
  }

  function requestMapArcs(mapId: WorldMapId, state: EditorState): void {
    const source = resources;
    if (source === null || terrainManifest?.kind !== 'loaded') return;
    const map = terrainManifest.manifest.maps.find((entry) => entry.mapId === mapId);
    if (map === undefined) return;
    for (const layer of ['zone-outlines', 'coastline'] as const) {
      const kind = OUTLINE_KIND[layer];
      const key = `${String(mapId)}/${kind}`;
      // The coastline is also the faction overlay's land (review PR-15): loaded while either is shown.
      const wanted = state.view.map.layers[layer] || (layer === 'coastline' && !hiddenSet.has('zone-faction'));
      if (!wanted || map[kind] === null || arcLoads.has(key)) continue;
      arcLoads.set(key, 'loading');
      void source.arcs(mapId, kind).then((result) => {
        arcLoads.set(key, result);
        if (result.kind === 'loaded') {
          arcInputs.set(key, { mapId: result.arcs.mapId, lines: result.arcs.lines });
          arcVersion += 1;
        }
        sync('terrain');
      });
    }
  }

  function revokeArt(): void {
    artGeneration += 1;
    if (objectUrls !== null) for (const url of artUrls.values()) objectUrls.revoke(url);
    artUrls.clear();
    artRequested.clear();
    artInputs.clear();
  }

  // Sync -------------------------------------------------------------------------------------

  /**
   * Every layer for the view (map-atlas.md §8.2): each part view's builder collects its part of each
   * layer; one part is finished with the layer's budget (a world surface: exactly one builder's
   * layers), several share it (`partBudgets`) and are joined (`join`).
   */
  /**
   * Each part of view `at` with its builder and its layers' calls. `ahead`: for the idle prebuild of
   * a view not shown yet (review MR-01), which reads the art inputs kept for each map and changes no
   * state of the controller's.
   */
  function planParts(state: EditorState, at: MapView, ahead: boolean): { readonly parts: readonly PlannedPart[]; readonly band: TileBandDescriptor | null } {
    const dataset = datasetOf(state);
    const character = state.project.character;
    const route = drawnOf(routeOf(state.project.route.steps));
    const focusKey = focusKeyOf(focusQuestIds(state.view.openedQuests, state.selection, activeStepOf(state)));
    const focusQuests = questIdsOfKey(focusKey);
    const stepFocus = focusWithin(stepFocusOf(state.selection, activeStep), drawnStep);
    const zone = state.view.map.zone;
    const shown = state.view.map.layers;
    const paths = state.view.map.walkingPaths ? routePaths : null;
    const after = splitOf(route, state.project.route.steps, activeStep);
    const relief = reliefOf(terrainManifest);
    const coast = outlinesOf.coast(arcVersion);
    const zoneLines = outlinesOf.zones(arcVersion);
    const { givers, objectives, turnIns, log } = questInputs(state, dataset, focusKey);
    const flightMasters = flightMastersOf(dataset, character.faction, character.race, character.class).input;
    const focusNodes = flightFocus();
    const allFlights = !hiddenSet.has('all-flights');
    // The clusters below the zone band, made in the derived publish (D-050 item 6); none before the places arrive.
    const clusters = places?.clusters ?? options.clusters ?? null;
    // The atlas's painted art (map-atlas.md §8.6): the tiles when the index is loaded, else the relief backdrop.
    const atlasView = at.surface === 'atlas' && atlasInfo !== null;
    const mode = atlasView ? atlasMode() : 'none';
    const style = mode === 'tiles' ? drawnStyle() : null;
    const band = style === null ? null : bandOf(style);
    if (style !== null && !ahead) lastStyle = style;
    const tilesShown = band !== null && shown.art;
    // No relief while the tiles are shown, nor while their index (about 5 kB) loads: the relief
    // image is not fetched only to be replaced a moment later.
    const atlasRelief = tilesShown || (mode === 'loading' && shown.art) || at.zoom > RELIEF_MAX_ZOOM ? NO_RELIEF : relief;
    const parts = (ahead ? partViewsFor(at) : partViewsOf(at)).map((part): PlannedPart => {
      const artInput = band !== null ? NO_ART : ahead ? (artInputs.get(part.mapId)?.inputs ?? NO_ART) : artFor(part, state);
      // Art drawn on this world map: the relief goes faint under it, and the zone frames lose their fill.
      const overArt = shown.art && artInput.some((input) => input.bounds === undefined || input.bounds.mapId === part.mapId);
      const calls: Readonly<Record<LayerId, LayerCall>> = {
        relief: { layer: 'relief', relief: atlasView ? atlasRelief : relief, underArt: overArt },
        art: { layer: 'art', art: artInput },
        // No terrain outline over the minimap tiles (D-047, §25.4 R24; review PR-01): its zone borders wait for the zone-borders byproduct.
        coastline: { layer: 'coastline', outlines: coast, minimap: style === 'minimap' },
        'zone-outlines': { layer: 'zone-outlines', outlines: zoneLines, minimap: style === 'minimap' },
        'zone-frames': { layer: 'zone-frames', focusZone: zone, filled: !overArt, ...(tilesShown ? { overTiles: true, minimap: style === 'minimap' } : {}) },
        'available-quests': { layer: 'available-quests', input: givers, focusQuests, rawZone: zone, clusters },
        objectives: { layer: 'objectives', input: objectives, focusQuests, rawZone: zone, log },
        'turn-ins': { layer: 'turn-ins', input: turnIns, focusQuests, rawZone: zone, clusters },
        'flight-masters': { layer: 'flight-masters', input: flightMasters, focusQuests: [], rawZone: zone, places: flightPointsOf(places) },
        'route-line': { layer: 'route-line', route, paths, after },
        'route-steps': { layer: 'route-steps', route, after },
        proposal: { layer: 'proposal', route: null },
        selection: { layer: 'selection', route, focus: stepFocus, paths },
        labels: { layer: 'labels', labels: (style === 'minimap' ? places?.labels?.minimap : places?.labels?.painted) ?? NO_LABELS },
        // The fallback tint where no painted art is drawn on this map (§12.3, §12.4), the faction overlay while shown.
        // The faction patterns on land only (§12.6; review PR-15, QA-15): clipped to the coastline's land.
        'zone-fill': {
          layer: 'zone-fill',
          fills: fillsOf(tilesShown || overArt ? null : (places?.zoneFill?.tint ?? null), hiddenSet.has('zone-faction') ? null : (places?.zoneFill?.faction ?? null)),
          land: coast,
        },
        'flight-network': { layer: 'flight-network', places: places?.flights ?? null, focusNodes, allFlights },
        transports: { layer: 'transports', places: places?.transports ?? null },
        dungeons: { layer: 'dungeons', places: places?.dungeons ?? null },
        services: { layer: 'services', places: places?.services ?? null },
      };
      return { view: part, builder: builderFor(part.mapId), calls };
    });
    return { parts, band };
  }

  /**
   * `early`: given the tile band's content before any other layer is built, so its first images are
   * asked for while the rest of the sync runs (review MR-07: at 4× the first view's tiles waited for
   * every layer to be built first).
   */
  function build(state: EditorState, at: MapView, early: ((layer: LayerId, content: LayerContent) => void) | null = null): Map<LayerId, LayerContent> {
    const { parts, band } = planParts(state, at, false);
    const out = new Map<LayerId, LayerContent>();
    if (band !== null) {
      const tiles = tilesContentOf(band);
      out.set('art', tiles);
      early?.('art', tiles);
    }
    for (const layer of LAYER_IDS) {
      if (layer === 'art' && band !== null) continue;
      const layerParts = parts.map(({ view: part, builder, calls }) => builder.part(calls[layer], part));
      const [only] = layerParts;
      if (layerParts.length === 1 && only !== undefined) {
        out.set(layer, only.finish());
        continue;
      }
      const budgets = partBudgets(
        layer,
        // Counted in view only when the parts' candidates overflow the budget (`partBudgets` reads it then): a pan recounts no layer that fits (D-050 item 5).
        layerParts.map((part) => ({
          candidates: part.candidates,
          get inView() {
            return part.inView();
          },
        })),
        layers.lod,
        shareCap,
        bandOfView(at),
      );
      out.set(
        layer,
        join(
          layer,
          layerParts.map((part, index) => part.finish(budgets[index])),
        ),
      );
    }
    return out;
  }

  /**
   * The band crossing a settled view is near (review MR-01): the band edge within half a level of
   * its zoom, at the scale of its centre map's placement, and the band on its other side; null when
   * none is near. Every edge counts (world | continent, continent | zone, zone | close): the labels,
   * the zone frames and the flight network change at each, the spawn layers at the middle one.
   */
  function crossingNear(at: MapView): { readonly edge: number; readonly band: MapBand; readonly finer: boolean } | null {
    const band = at.band;
    if (band === undefined) return null;
    const scale = scaleOn(at.surface ?? 'atlas', at.mapId);
    let best: { readonly edge: number; readonly band: MapBand; readonly finer: boolean; readonly distance: number } | null = null;
    for (const crossing of BAND_CROSSINGS) {
      const edge = zoomAtPxPerYard(BAND_EDGES[crossing.above], scale);
      const distance = Math.abs(at.zoom - edge);
      const finer = band === crossing.below;
      if (distance > PREBUILD_WITHIN || (!finer && band !== crossing.above)) continue;
      if (best === null || distance < best.distance) best = { edge, band: finer ? crossing.above : crossing.below, finer, distance };
    }
    return best === null ? null : { edge: best.edge, band: best.band, finer: best.finer };
  }

  /**
   * With `smoothWheel`, within half a level of a band edge (`crossingNear`), every layer of the view
   * the crossing lands in is collected in idle time (map-atlas.md §8.2; review MR-01), so the
   * crossing finds them ready: the target view's own parts, so a map the zoom-out brings in is
   * ready too. A layer whose key the crossing does not change is skipped at no cost; each one that
   * collects gets an idle period of its own. A new view, an edit or a detach stops it.
   */
  function schedulePrebuild(at: MapView): void {
    cancelPrebuild?.();
    cancelPrebuild = null;
    if (!smoothWheel) return;
    const crossing = crossingNear(at);
    if (crossing === null) return;
    const from = store.getState();
    let queue: (() => boolean)[] | null = null;
    const step = (): void => {
      cancelPrebuild = null;
      if (!mounted || view !== at || store.getState() !== from) return;
      if (queue === null) {
        // Zooming in, the view lands just past the edge; zooming out, a button's whole level away.
        const zoom = crossing.finer ? Math.max(crossing.edge, at.zoom) + 2 * BAND_HYSTERESIS_ZOOM : Math.min(crossing.edge - 2 * BAND_HYSTERESIS_ZOOM, at.zoom - 1);
        queue = prebuildQueue(from, viewAtZoom(atlasInfo, at, zoom, crossing.band));
      }
      for (let task = queue.shift(); task !== undefined; task = queue.shift()) if (task()) break;
      if (queue.length > 0) cancelPrebuild = idle(step);
    };
    cancelPrebuild = idle(step);
  }

  /** The prebuild's tasks for a target view: per part, the spawn layers first, then the rest; each returns whether it collected. */
  function prebuildQueue(state: EditorState, target: MapView): (() => boolean)[] {
    const { parts } = planParts(state, target, true);
    return parts.flatMap(({ view: part, builder, calls }) => PREBUILD_LAYERS.map((layer) => () => builder.prebuild(calls[layer], part)));
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
      const set: LayerId[] = [];
      const send = (layer: LayerId, content: LayerContent): void => {
        contents.set(layer, content);
        if (sent.get(layer) === content) return;
        target.setLayer(layer, content);
        sent.set(layer, content);
        set.push(layer);
      };
      const built = build(state, view, send);
      for (const layer of LAYER_IDS) {
        const content = built.get(layer);
        if (content !== undefined) send(layer, content);
      }
      for (const layer of LAYER_IDS) {
        const visible = state.view.map.layers[layer];
        if (target.isLayerVisible(layer) !== visible) target.toggleLayer(layer, visible);
      }
      applyMask(target);
      if (wording !== null && (set.length > 0 || trigger === 'move' || trigger === 'surface' || trigger === 'wording')) inView = wording.inView(view, (layer) => contents.get(layer)?.items ?? NO_ITEMS);
      if (set.length > 0) measureSync(start, end, trigger, set);
      // A renumbering redraws the labels canvas alone, after the edit is applied and measured
      // (map-presentation.md §13.6): the adapter draws it at the latest on the next frame.
      const steps = state.project.route.steps;
      if (numbered === null || numbered.steps !== steps || numbered.active !== activeStep) {
        numbered = { steps, active: activeStep };
        target.refreshLabels?.();
      }
      safely(() => {
        timing?.clearMarks(start);
        timing?.clearMarks(end);
      });
      requestArt(view, state);
      requestArcs(view, state);
      schedulePrebuild(view);
      if (set.includes('route-steps')) applyRowHighlight();
    }
    publish(state);
  }

  /**
   * The flight points the layer is built from: without the other faction's while their row is
   * hidden (by default), so they take none of the layer's budget (35, one side's nodes; §25.7), as
   * the hidden quest rows take none of the givers'. The same object for the same model.
   */
  const ownSideOnly = new WeakMap<PlaceLayerInput, PlaceLayerInput>();
  function flightPointsOf(model: PlacesModel | null): PlaceLayerInput | null {
    if (model === null) return null;
    const all = model.flightPoints;
    if (!hiddenSet.has('other-faction-flights')) return all;
    let own = ownSideOnly.get(all);
    if (own === undefined) {
      own = { items: all.items.filter((item) => item.descriptor.type !== 'marker' || item.descriptor.category !== 'other-faction-flights'), unplaced: all.unplaced };
      ownSideOnly.set(all, own);
    }
    return own;
  }

  /** Each flight point pin's client node, by the places model's flight points (`PlaceItem.node`). */
  const pinNodes = new WeakMap<PlacesModel, ReadonlyMap<string, number>>();
  function flightNodeOf(id: string): number | null {
    const model = places;
    if (model === null) return null;
    let nodes = pinNodes.get(model);
    if (nodes === undefined) {
      nodes = new Map(model.flightPoints.items.flatMap((item) => (item.node === undefined ? [] : [[item.descriptor.id, item.node] as const])));
      pinNodes.set(model, nodes);
    }
    return nodes.get(id) ?? null;
  }

  /** The flight points whose flights the zoomed-in network draws (§25.4): the hovered one and the chosen search result's. */
  function flightFocus(): readonly number[] {
    const out: number[] = [];
    if (hoverNode !== null) out.push(hoverNode);
    const chosen = matchedPin(selectedMatch);
    if (chosen?.layer === 'flight-masters') for (const id of chosen.ids) {
      const node = flightNodeOf(id);
      if (node !== null && !out.includes(node)) out.push(node);
    }
    return out;
  }

  /** The pin a chosen result rings: the first marker of a pin layer whose place or quests match. */
  function matchedPin(match: MapResultMatch | null): HighlightTarget | null {
    if (match === null) return null;
    for (const layer of ['available-quests', 'turn-ins', 'flight-masters', 'objectives', 'dungeons', 'transports', 'services'] as const) {
      for (const item of contents.get(layer)?.items ?? []) {
        if (item.type !== 'marker') continue;
        const hit =
          match.pins?.includes(item.id) === true ||
          item.refs.some(
            (ref) =>
              ref.kind === 'spawn' &&
              ((match.subject !== undefined && subjectKeyOf(ref.subject) === match.subject) || (match.questId !== undefined && ref.questIds.includes(match.questId))),
          );
        if (hit) return { layer, ids: [item.id] };
      }
    }
    return null;
  }

  /** Sends the drawer's mask, the chosen result's ring and the step numbers' toggle when they changed (map-presentation.md §25.3.4, §25.3.5). */
  function applyMask(target: MapAdapter): void {
    // While a search lasts, its results show whatever their category (§25.3.5: marked "(hidden category)").
    const mask = maskOf(searchOnly === null ? hidden : [], searchOnly);
    // A selected pin (§25.2.3): the one whose popover is open, else the chosen search result.
    const selectedPin = popoverPin ?? matchedPin(selectedMatch);
    if (sentMask === null || !plainEqual(mask, sentMask)) {
      target.setMask?.(mask);
      sentMask = mask;
    }
    if (sentSelected === undefined || !plainEqual(selectedPin, sentSelected)) {
      target.selectPins?.(selectedPin);
      sentSelected = selectedPin;
    }
    const numbers = !hiddenSet.has('step-numbers');
    if (sentNumbers !== numbers) {
      target.setStepNumbers?.(numbers ? stepNumbers : null);
      sentNumbers = numbers;
    }
    const grid = !hiddenSet.has('coordinate-grid');
    if (sentGrid !== grid) {
      target.setGrid?.(grid);
      sentGrid = grid;
    }
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
    // A scan, not the positions: an insert selects its new step, and renumbering every step after it
    // here (O(n) map writes) would come before the edit is drawn (D-050 item 5).
    const next = focus !== null && state.project.route.steps.some((step) => step.id === focus) ? focus : null;
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
      case 'connector':
        // The arc is the leg into its arrival step, as a route segment is.
        return { kind: 'select', stepId: ref.toStepId };
      case 'departure':
        return { kind: 'select', stepId: ref.stepId };
      case 'spawn':
        return ref.questIds.length === 0 ? null : { kind: 'open', questIds: ref.questIds };
      case 'cluster':
        return { kind: 'fit', bounds: ref.bounds };
      // A place's pin opens the popover before this is asked (`POPOVER_REFS`, MP.6); a flight line has no action of its own: its hover says what it is.
      case 'dungeon':
      case 'taxi-node':
      case 'taxi-edge':
      case 'transport':
      case 'service':
        return null;
      case 'aggregate':
        if (ref.uiMapId !== null && zoneBounds(geometry, ref.uiMapId) !== null) return { kind: 'zone', uiMapId: ref.uiMapId };
        return descriptor?.type === 'aggregate' ? { kind: 'focus', point: descriptor.point } : null;
      // A zone's faction fill (MP.10): jump to the zone, as an empty click at continent zoom does.
      case 'zone':
        return zoneBounds(geometry, ref.uiMapId) === null ? null : { kind: 'zone', uiMapId: ref.uiMapId };
      case 'surface':
      case 'art':
      case 'terrain':
      case 'atlas-tiles':
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
      case 'fit':
        fitBounds(action.bounds, { maxZoom: CLUSTER_MAX_ZOOM });
        return;
    }
  }

  /** The items that open the map popover (map-presentation.md §14.2): the pins (not clusters, which zoom in, or zone counts). */
  const POPOVER_REFS: readonly MapRef['kind'][] = ['spawn', 'dungeon', 'taxi-node', 'transport', 'service'];

  /** Opens the popover on the items at a point (their hover texts from the label provider), or on an empty point; `pin`: the pin clicked, drawn selected while it is open. */
  function openPopover(layer: LayerId | null, refs: readonly MapRef[], labels: readonly (string | null)[], point: WorldPoint, pin: HighlightTarget | null = null): void {
    const shown = adapter?.getView() ?? null;
    const pixel = shown === null ? null : stagePixelOf(shown, point);
    const route = routeOf(store.getState().project.route.steps);
    const index = activeStep === null ? null : routeStepIndex(route, activeStep);
    const placement = index === null ? undefined : route.steps[index]?.placement;
    popovers += 1;
    popover = {
      key: popovers,
      layer,
      refs,
      labels: refs.map((ref, i) => labelFor(ref) ?? labels[i] ?? null),
      point: pickedPoint(point) as MapPopoverTarget['point'],
      at: shown === null || pixel === null ? null : { x: pixel.x, y: pixel.y, width: shown.widthPx, height: shown.heightPx },
      from: placement?.kind === 'point' ? placement.world : null,
    };
    popoverPin = pin;
    if (adapter !== null && mounted) applyMask(adapter);
  }

  function closePopover(): boolean {
    if (popover === null) return false;
    popover = null;
    popoverPin = null;
    if (adapter !== null && mounted) applyMask(adapter);
    return true;
  }

  /** A clicked point as a world-form SourcedPoint with its zone hint (`MapPickRequest.onPick`). */
  function pickedPoint(point: WorldPoint): SourcedPoint {
    const round = (value: number): number => {
      const rounded = Math.round(value * 10) / 10;
      return rounded === 0 ? 0 : rounded;
    };
    const world: WorldPoint = { mapId: point.mapId, x: round(point.x), y: round(point.y) };
    const zone = attributeZone(world, store.getState().view.map.zone, geometry)?.uiMapId ?? null;
    return { space: 'world', mapId: world.mapId, x: world.x, y: world.y, uiMapId: zone, lexemes: null };
  }

  function onClick(hit: MapHit | null, point: WorldPoint): void {
    // A click while the popover is open closes it; on empty map it does nothing more (a press to dismiss).
    const wasOpen = closePopover();
    const picking = pick;
    if (picking !== null) {
      pick = null;
      publish(store.getState());
      picking.onPick(pickedPoint(point));
      return;
    }
    if (hit === null) {
      if (!wasOpen && store.getState().view.map.zoomBand !== 'continent') openPopover(null, [], [], point);
      publish(store.getState());
      if (wasOpen || store.getState().view.map.zoomBand !== 'continent') return;
      // The frame the point is most central in, not the smallest: frames overlap heavily, and a
      // click on The Barrens at the Crossroads lies in Durotar's frame too (coordinates.md §15).
      for (const id of zoneFramesContaining(point, geometry)) if (jumpToZone(id)) return;
      return;
    }
    const descriptor = descriptorOf(hit.layer, hit.id);
    const at = descriptor?.type === 'marker' || descriptor?.type === 'aggregate' ? descriptor.point : point;
    const labels = descriptor?.type === 'marker' ? descriptor.labels : [];
    // A pin (not a cluster) opens the popover: its actions build the route (§14.2), and it is drawn selected (§25.2.3).
    if (hit.refs.every((ref) => POPOVER_REFS.includes(ref.kind))) {
      openPopover(hit.layer, hit.refs, labels, at, descriptor?.type === 'marker' ? { layer: hit.layer, ids: [hit.id] } : null);
      publish(store.getState());
      return;
    }
    const actions = hit.refs.length <= 1 ? [actionOf(hit.ref, hit.segment, descriptor)] : hit.refs.map((ref) => actionOf(ref, null, descriptor));
    const distinct = new Set(actions.flatMap((action) => (action === null ? [] : [actionKey(action)])));
    // Several items that do different things (a stack of steps): the popover lists them.
    if (distinct.size > 1) openPopover(hit.layer, hit.refs, labels, at);
    else {
      const action = actions.find((entry) => entry !== null) ?? null;
      if (action !== null) run(action);
    }
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

  /** A band whose first view's images all failed gives way to the other style (map-atlas.md §21.4). */
  function onTiles(event: Extract<MapEvent, { readonly type: 'tiles' }>): void {
    if (event.state !== 'failed' || tilesFailed.has(event.style)) return;
    tilesFailed.add(event.style);
    requestAtlasIndexes();
    sync('tiles');
  }

  function onEvent(event: MapEvent): void {
    switch (event.type) {
      case 'movestart':
        // New walking paths wait for the view to settle: none is drawn in the gesture's frames (D-050 item 5).
        pathFeed?.hold(true);
        return;
      case 'move':
      case 'surface': {
        view = bandedView(event.view);
        // The adapter's band is the controller's (review MR-03).
        if (view.band !== undefined) adapter?.setBand?.(view.band);
        pathFeed?.setView(view);
        pathFeed?.hold(false);
        const zone = store.getState().view.map.zone;
        // The zone jumped to stops being "the zone" once it is panned out of view or left behind.
        const leftZone = zone !== null && zone !== zoneFit && !zoneShown(zone, event.view, event.type === 'move');
        const patch = viewPatch(event.view, view.band);
        patchUi(leftZone ? { ...patch, zone: null } : patch);
        closePopover();
        sync(event.type);
        return;
      }
      case 'zoom':
        patchUi({ zoomBand: bandLevelOf(bandNow(event.view)) });
        return;
      case 'hover': {
        const hit = event.hit;
        // A flight point in focus draws its flights when zoomed in (§25.4); moving onto one of its lines keeps it.
        const node = hit === null ? null : hit.layer === 'flight-masters' ? flightNodeOf(hit.id) : hit.layer === 'flight-network' ? hoverNode : null;
        if (node !== hoverNode) {
          hoverNode = node;
          const band = view === null ? null : bandOfView(view);
          if (band === 'zone' || band === 'close') sync('hover');
        }
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
      case 'tiles':
        onTiles(event);
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
    const info = surfaceForMap(surfaces, adapter?.getSurface() ?? null, placement.world.mapId);
    if (info === null) return { kind: 'no-surface', mapId: placement.world.mapId };
    if (adapter === null) pending = { kind: 'focus', stepId: id };
    else {
      const target = adapter;
      freshly(() => target.focus(placement.world, { recenter }));
    }
    return { kind: 'focused', surface: info.id };
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
      const target = adapter;
      freshly(() => target.fitBounds(bounds, fitOptionsOf(fit.maxZoom, fit.minZoom)));
    } finally {
      zoneFit = previous;
    }
  }

  /**
   * Fits the route's steps on the shown surface (on the atlas, every placed map's steps at once),
   * or, when none is there, on the surface of the first map the route reaches that has one.
   */
  function fitRoute(): FitRouteResult {
    const state = store.getState();
    const route = routeOf(state.project.route.steps);
    const summary = summaryOf(route);
    const here = shownInfo();
    const onHere = here === null ? [] : summary.maps.filter((entry) => surfaceMapIds(here).includes(entry.mapId));
    const first = summary.maps.find((entry) => surfaceForMap(surfaces, null, entry.mapId) !== null);
    const target = onHere.length > 0 ? here : first === undefined ? null : surfaceForMap(surfaces, null, first.mapId);
    if (target === null) return { kind: 'nothing-to-fit' };
    const entries = summary.maps.filter((entry) => surfaceMapIds(target).includes(entry.mapId));
    const bounds = surfaceBoundsUnion(
      target,
      entries.flatMap((entry) => routeBoundsOn(route, entry.mapId) ?? []),
    );
    if (bounds === null) return { kind: 'nothing-to-fit' };
    fitBounds(bounds, { maxZoom: FIT_ROUTE_MAX_ZOOM });
    return { kind: 'fitted', surface: target.id, steps: entries.reduce((sum, entry) => sum + entry.steps, 0) };
  }

  function jumpToZone(id: UiMapId): boolean {
    const bounds = zoneBounds(geometry, id);
    if (bounds === null || surfaceForMap(surfaces, null, bounds.mapId) === null) return false;
    patchUi({ zone: id });
    // At the zone zoom or closer: a zone wider than the stage allows at that zoom is centred at it
    // rather than fitted below it, where its points would stay folded into counts (PERF-4, MAP-UX-2).
    // In the minimap style an underground city lands where its "(underground city)" label is drawn
    // (review PR-17): zone labels go at about zoom −1.75, so no closer than −2.
    const underground = UNDERGROUND_JUMP.cities.includes(id) && lastStyle === 'minimap';
    fitBounds(bounds, { minZoom: layers.lod.zoneZoom, zone: id, ...(underground ? { maxZoom: UNDERGROUND_JUMP.maxZoom } : {}) });
    sync('zone');
    return true;
  }

  function initialSurface(state: EditorState): SurfaceId | null {
    const stored = state.view.map.surface;
    if (stored !== null && surfaces.some((info) => info.id === stored)) return stored;
    if (pending?.kind === 'surface') return pending.surface;
    const route = routeOf(state.project.route.steps);
    const first = firstRouteMap(route);
    return first === null ? null : (surfaceForMap(surfaces, null, first)?.id ?? null);
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
          return freshly(() => target.fitBounds(intent.bounds, fitOptionsOf(intent.maxZoom, intent.minZoom)));
        } finally {
          zoneFit = previous;
        }
      }
      case 'surface':
        return target.setSurface(intent.surface);
    }
  }

  /** The style chosen in this browser (map-atlas.md §21.3), read once: when the controller is made, before the map's first mount. */
  function readStyle(): void {
    if (styleRead) return;
    styleRead = true;
    const kept = styleSetting?.read() ?? null;
    // A kept style this build cannot draw (a painted build's minimap, D-053) is not taken; it stays in the setting for a build that can.
    if (kept !== null && styles.includes(kept)) chosenStyle = kept;
  }

  // Review MR-07: the chosen style's tile index (2.5 kB) is asked for as soon as the controller has
  // the geometry (the workspace is ready), not at the map's mount after the map engine's chunk: at
  // 4× the index waited about 500 ms for the mount. Its hash is checked against the surface's as before.
  if (resources?.atlas !== undefined && atlasInfo !== null && !localArt) {
    readStyle();
    requestAtlasIndexes();
  }

  return {
    surfaces,
    presets,
    styles,
    mapName: nameOfMap,
    zoneGroups: zones,
    labelFor,

    attach(factory, el) {
      if (mounted) throw new Error('MapController.attach: already attached; call detach() first');
      const state = store.getState();
      let target = adapter;
      // The style chosen in this browser, read at the first mount (map-atlas.md §21.3).
      readStyle();
      try {
        if (target === null) {
          target = factory({
            surfaces,
            initialSurface: initialSurface(state),
            label: labelFor,
            stepNumbers,
            style: chosenStyle,
            ...(smoothWheel ? { smoothWheel: true } : {}),
          });
          adapter = target;
          sentMask = null;
          sentSelected = undefined;
          sentNumbers = null;
          sentGrid = null;
          for (const type of ['click', 'hover', 'movestart', 'move', 'zoom', 'surface', 'tiles'] as const) target.on(type, onEvent);
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
      questState = derived?.getState().questState ?? null;
      places = derived?.getState().places ?? null;
      unsubscribeDerived =
        derived?.subscribe(() => {
          const next = derived.getState().questState;
          const nextPlaces = derived.getState().places ?? null;
          if (next === questState && nextPlaces === places) return;
          questState = next;
          places = nextPlaces;
          if (quiet === 0) sync('quest-state');
        }) ?? null;
      if (pathFeed !== null) {
        routePaths = pathFeed.current();
        unsubscribeFeed = pathFeed.subscribe(() => {
          const next = pathFeed.current();
          if (next === routePaths) return;
          routePaths = next;
          sync('paths');
        });
      }
      const first = !everMounted;
      everMounted = true;
      requestResources();
      lastFocus = state.selection.focus;
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
        const banded = freshly(() => bandedView(current));
        view = banded;
        if (banded.band !== undefined) target.setBand?.(banded.band);
        patchUi(viewPatch(current, banded.band));
      }
      pathFeed?.setView(view);
      sync('attach');
      return true;
    },

    detach() {
      if (!mounted) return;
      unsubscribeStore?.();
      unsubscribeStore = null;
      unsubscribeDerived?.();
      unsubscribeDerived = null;
      unsubscribeFeed?.();
      unsubscribeFeed = null;
      cancelPrebuild?.();
      cancelPrebuild = null;
      pathFeed?.setView(null);
      // A gesture the unmount cut short holds nothing.
      pathFeed?.hold(false);
      adapter?.destroy();
      mounted = false;
      mapHovering = false;
      rowTarget = null;
      closePopover();
      pick = null;
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
      const info = surfaces.find((entry) => entry.id === surface);
      if (info === undefined) return false;
      if (adapter === null) {
        pending = { kind: 'surface', surface };
        return true;
      }
      // "Both continents" (review QA-03): the atlas fitted whole, both continents and the inset
      // card (its extent), on every choice, also when it is already shown: switching alone kept
      // the zone view, while the announcement said both continents were shown.
      if (info.kind === 'atlas') {
        if (!adapter.setSurface(surface)) return false;
        fitBounds(info.extent);
        return true;
      }
      return adapter.setSurface(surface);
    },

    showPreset(id) {
      const preset = presets.find((entry) => entry.id === id);
      if (preset === undefined) return false;
      fitBounds(preset.bounds);
      return true;
    },

    setMapStyle(style) {
      // A style this build cannot draw is never chosen (D-053); the drawer does not offer it.
      if (!styles.includes(style) || (style === chosenStyle && !tilesFailed.has(style))) return;
      chosenStyle = style;
      tilesFailed.delete(style);
      styleSetting?.write(style);
      if (mounted) requestResources();
      sync('style');
    },

    setWording(next) {
      if (next === wording) return;
      wording = next;
      sync('wording');
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

    setRoutePaths(paths) {
      if (paths === routePaths) return;
      routePaths = paths;
      sync('paths');
    },

    closePopover() {
      if (closePopover()) publish(store.getState());
    },

    startPick(request) {
      if (!mounted || adapter === null) return false;
      closePopover();
      pick = request;
      publish(store.getState());
      return true;
    },

    cancelPick() {
      if (pick === null) return false;
      pick = null;
      publish(store.getState());
      return true;
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

    setCategories(next) {
      const normalised = normaliseHidden(next);
      if (plainEqual(normalised, hidden)) return;
      hidden = normalised;
      hiddenSet = new Set(normalised);
      sync('categories');
    },

    setSearchFilter(only) {
      if (plainEqual(only, searchOnly)) return;
      searchOnly = only;
      if (only === null) selectedMatch = null;
      sync('search');
    },

    showResult(point, match) {
      if (surfaceForMap(surfaces, adapter?.getSurface() ?? null, point.mapId) === null) return false;
      selectedMatch = match;
      const shown = adapter;
      if (shown === null) {
        pending = { kind: 'fit', bounds: { mapId: point.mapId, xMin: point.x, xMax: point.x, yMin: point.y, yMax: point.y }, maxZoom: RESULT_MIN_ZOOM, minZoom: undefined, zone: null };
        return true;
      }
      // Never zooms out past it: at least the zone band, where pins are separate (§25.2.4).
      const zoom = Math.max(shown.getView()?.zoom ?? RESULT_MIN_ZOOM, RESULT_MIN_ZOOM);
      freshly(() => shown.focus(point, { zoom, recenter: true }));
      sync('result');
      // §25.3.5: the chosen result's popover opens on its ringed pin, and takes focus (review PR-05).
      const pin = match === null ? null : matchedPin(match);
      const id = pin?.ids[0];
      const descriptor = pin === null || id === undefined ? undefined : descriptorOf(pin.layer, id);
      if (pin !== null && descriptor?.type === 'marker') {
        closePopover();
        openPopover(pin.layer, descriptor.refs, descriptor.labels, descriptor.point, pin);
        publish(store.getState());
      }
      return true;
    },

    fitPoints(points) {
      const here = shownInfo();
      const onHere = here === null ? [] : points.filter((point) => surfaceMapIds(here).includes(point.mapId));
      const first = points.find((point) => surfaceForMap(surfaces, null, point.mapId) !== null);
      const target = onHere.length > 0 ? here : first === undefined ? null : surfaceForMap(surfaces, null, first.mapId);
      if (target === null) return false;
      const mapIds = [...new Set(points.map((point) => point.mapId))].filter((mapId) => surfaceMapIds(target).includes(mapId));
      const bounds = surfaceBoundsUnion(
        target,
        mapIds.flatMap((mapId) => boundsOfPoints(mapId, points) ?? []),
      );
      if (bounds === null) return false;
      fitBounds(bounds, { maxZoom: FIT_ROUTE_MAX_ZOOM });
      return true;
    },

    zoomBy(delta) {
      adapter?.zoomBy?.(delta);
    },

    dataset: () => datasetOf(store.getState()),
    flightMasterIds: () => data.flightMasterIds,
    questState: () => questState,
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

