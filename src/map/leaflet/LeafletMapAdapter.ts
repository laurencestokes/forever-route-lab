import * as L from 'leaflet';
import './leaflet-core.css';
import './map.css';
import type { UiMapId, WorldMapId } from '../../domain/ids';
import type { WorldPoint } from '../../domain/points';
import {
  aboveThreshold,
  baseMapLabelsOf,
  combineLabels,
  DECODED_TILE_BYTES,
  DEFAULT_MAP_STYLE,
  descriptorOnSurface,
  EMPTY_LABEL_RENDER_STATS,
  isAtlasSurface,
  isImageLayer,
  isLabelLayer,
  isPinMarker,
  LAYER_IDS,
  labelOf,
  nextBand,
  NO_MAP_MASK,
  PIN_LAYER_IDS,
  pxPerYardAt,
  refsOf,
  subjectKeyOf,
  surfaceForMap,
  surfacePlacements,
  surfacePointAt,
  type AreaDescriptor,
  type ConnectorDescriptor,
  type Emphasis,
  type FitOptions,
  type FocusOptions,
  type FrameDescriptor,
  type HighlightTarget,
  type LabelDescriptor,
  type LabelRenderStats,
  type LayerContent,
  type LayerId,
  type LayerRenderStats,
  type MapAdapter,
  type MapAdapterOptions,
  type MapBand,
  type MapContainer,
  type MapDescriptor,
  type MapEvent,
  type MapEventType,
  type MapHit,
  type MapLabelProvider,
  type MapMask,
  type MapRef,
  type MapRenderStats,
  type MarkerDescriptor,
  type MarkerMark,
  type PinRenderStats,
  type MapStepNumbers,
  type MapStyle,
  type MapViewState,
  type SurfaceId,
  type SurfaceInfo,
  type SurfacePlacement,
  TILE_MEMORY_BUDGET,
  type TileBandDescriptor,
  type Viewport,
  type WorldBounds,
  type ZoneFillDescriptor,
} from '../adapter';
import { DecodedTiles, type DecodeImage } from './atlas-decoded';
import { AtlasTiles } from './atlas-tile-layer';
import { capItems, diffById, sameData } from './diff';
import {
  AreaOutline,
  ConnectorArc,
  drawOrder,
  FrameRectangle,
  GlyphMarker,
  GridLayer,
  HaloPolyline,
  hatchPattern,
  landRingsNear,
  MeasuredCanvas,
  PinMarker,
  placeAfter,
  ScaleBarControl,
  ZoneFillShape,
  type FrameLabelStyle,
  type GridPlacement,
  type PinDrawing,
} from './leaflet-layers';
import { clusterLevelAt } from '../marks';
import {
  DEFAULT_PIN_PALETTE,
  forcedPinPalette,
  PIN_FROM_PX,
  PinBitmaps,
  PinHitIndex,
  pinDiameterFor,
  pinPaletteFrom,
  pinSpecOf,
  specExtent,
  stackPins,
  VENDORS_FROM_PX,
  type BitmapCanvas,
  type PinPalette,
  type PinSpec,
  type PinState,
  type PinTarget,
} from './pins';
import type { ChipInk } from './glyphs';
import { crossFadeOut, LabelsRenderer } from './labels-canvas';
import {
  CROSS_FADE_MS,
  drawPlacedLabel,
  drawStepNumbers,
  fontOf,
  haloText,
  labelForms,
  labelInRange,
  pinBoxes,
  placeLabels,
  placeStepNumbers,
  STEP_NUMBERS,
  type BeadInput,
  type Box,
  type LabelInk,
  type Measure,
  type PlacementInput,
} from './labels';
import { createMapPerf, pagePerformance, type MapPerf, type PerformanceLike } from './perf';
import { SmoothWheel, type SmoothWheelOptions } from './smooth-wheel';
import {
  aggregateGlyph,
  areaStyle,
  connectorGlyph,
  connectorHalo,
  connectorStyle,
  frameStyle,
  glyphExtent,
  lineHalo,
  markerGlyph,
  outlineStyle,
  polylineStyle,
  readMapPalette,
  zoneFillStyle,
  type GlyphSpec,
  type MapPalette,
  type PathStyle,
} from './style';
import {
  clipInset,
  connectorArc,
  connectorMidpoint,
  IDENTITY,
  latLngBoundsMeet,
  latLngBoundsOnMap,
  latLngBoundsToWorld,
  latLngOnMap,
  latLngToAtlas,
  latLngToWorld,
  minZoomFor,
  nearestSegment,
  padLatLngBounds,
  placedLatLng,
  placedLatLngBounds,
  placementLatLngBounds,
  zonesAt,
  type LatLngBoundsPair,
  type Translation,
} from './transform';

/**
 * The Leaflet 1.9.4 implementation of `MapAdapter` (docs/ARCHITECTURE.md §7.2; docs/MAPS.md §7).
 * This directory is the only Leaflet importer; react-leaflet is not used (D-005).
 *
 * - `L.CRS.Simple`, `latLng = (x, −y)` in yards on a world surface (transform.ts has the transform
 *   and its inverse). The surface extent bounds the view (with slack), and the least zoom follows
 *   the container, so the largest surface always fits (`minZoomFor`).
 * - **The funnel** (docs/research/map-atlas.md §8.1, §8.5; step ATL.3): every world point and
 *   rectangle reaches Leaflet through its map's placement on the shown surface (`toLatLng`,
 *   `toBounds`): the identity on a world surface, a translation on the atlas, where one surface
 *   shows maps 0 and 1 and the Zephras Isle inset. Clicks and views come back through the
 *   partition (`surfacePointAt`), so they always name a real world map; nothing outside this
 *   funnel sees atlas units, and none is ever used for a distance (D-017). A cross-map leg on the
 *   atlas is a `connector` arc.
 * - One canvas renderer (`L.canvas`, padding 0.1, with User Timing measures, perf.ts) draws every
 *   path. Markers are small original canvas glyphs (glyphs.ts), route and proposal lines polylines,
 *   zone frames rectangles with labels, the terrain zone outlines and coastline one multi-line path
 *   each. The image layers are image overlays in panes below the canvas: the shaded relief (D-032)
 *   lowest, then the painted map art (committed, D-033, or a local set's, D-018). The procedural
 *   yard grid has its own canvas above them, and a yard scale bar sits bottom left. Images load
 *   asynchronously (`<img>` elements), so switching art never waits for one.
 * - Layers are stacked in `LAYER_IDS` order in the renderer's draw list, which is also the
 *   hit-testing order (the topmost path wins). A created path, or one whose place in its layer's
 *   order changed, is moved to its place in the list (`placeAfter`), which redraws only its own
 *   area; an update in place moves nothing (M3 review PERF-1).
 * - `setLayer` skips content whose `items` array is unchanged by reference, and otherwise diffs by
 *   id (diff.ts): new ids are created, missing ids removed, and changed descriptors updated in
 *   place, calling Leaflet only for what changed: the position (`setLatLng`, `setLatLngs`,
 *   `setBounds`), the glyph or the style. A descriptor whose label or ref alone changed costs
 *   nothing on the canvas.
 * - Hover emphasis (`highlight`) is drawn as a copy of the glyph on top of the `selection` layer;
 *   a highlighted line is restyled in place. Nothing else moves.
 * - Only descriptors on the current surface are drawn; each layer keeps its last content, so a
 *   surface switch redraws what the layers already hold for the new world map.
 * - Clicks and hovers come from the canvas renderer's hit-testing; the adapter maps the hit path
 *   back to its layer and descriptor and emits plain events (with every ref of a merged marker).
 *   Hover labels use one shared tooltip whose text is set as text, never as HTML, from `labelOf`
 *   and the label provider.
 * - **The atlas tiles** (map-atlas.md §8.3, §8.6; step ATL.7): the art layer's `tiles` descriptor is
 *   drawn as the tile layer over its underlay (`AtlasTiles`), in panes `frl-atlas` (245) and
 *   `frl-underlay` (244); while it is shown the container's background is the index's deep sea.
 *   The map's `fadeAnimation` is off: the tiles fade their own images. Panes `frl-tint` (255) and
 *   `frl-labels` (450) are reserved for the presentation layer (map-atlas.md §8.7).
 * - **Two styles** (map-atlas.md §21.2, §24.5; step MM.1): each band's id names its style, and its
 *   decoded keys are its own (a minimap tile never starts from a painted key). When a band replaces
 *   another, the new one is added above the old, the old one's tiles outside the view are pruned,
 *   and the old one stays under the new until the new first view has decoded and faded in, or for
 *   2 s at most (`TILE_MEMORY_BUDGET.holdMs`), so a switch never shows the bare container. The sea
 *   colour and the container's `data-map-style` (the presentation's palette, §8.7 item 9) follow the
 *   picture shown: the held band's until it goes. Each band's first view is reported as a `tiles`
 *   event (`failed` when every image failed: a build without the minimap tile pack, §21.4).
 * - **The labels canvas** (map-presentation.md §5.5, §13; step MP.1): the `labels` layer and the step
 *   numbers are drawn on their own non-interactive canvas (`LabelsRenderer`, pane `frl-labels`),
 *   placed at each settled view and drawn in the next frame; a renumbering (`refreshLabels`) or a
 *   change of the route's beads redraws that canvas alone. The adapter keeps its own zoom band from
 *   each settled view (`nextBand`, the controller's rule); at a band change the outgoing pictures of
 *   the path canvas and the labels canvas fade out over 140 ms while the new ones are drawn at full
 *   opacity (none under reduced motion). Objective outlines (`area`) are haloed polygons on the path
 *   canvas, with their completing step's number on the labels canvas.
 * - **Gestures** (map-atlas.md §8.4; step ATL.8), behind `smoothWheel` (the map controller turns it on
 *   since ATL.10; off by default for the adapter on its own):
 *   our own wheel handler (`SmoothWheel`) instead of Leaflet's, any resting zoom (`zoomSnap` 0), the
 *   grid canvas hidden and hover labels held back from a gesture's first event to its settle, the
 *   path canvas re-rendered mid-gesture (`_reset()`) when the zoom has drifted more than 0.5 levels
 *   since it was drawn and that draw took under 8 ms, the canvas backing store at the device's
 *   pixel ratio (capped at 2) instead of Leaflet's fixed 2×, and new paths created at most 150 per
 *   animation frame.
 */

export interface LeafletMapAdapterOptions extends MapAdapterOptions {
  /**
   * The least zoom on a stage large enough to show every surface at it (default -6: continents are
   * about -5.2 at native art size, MAPS §7.1). A smaller stage gets the zoom that fits the largest
   * surface extent instead, down to `minZoomFloor`.
   */
  readonly minZoom?: number;
  /** Never allow zooming out below this, however small the stage (default -7.5). */
  readonly minZoomFloor?: number;
  /** Default 2. */
  readonly maxZoom?: number;
  /** `focus` zooms in to at least this (default -2, a little closer than a zone's native -2.4). */
  readonly focusZoom?: number;
  /** The adapter's own hard cap on canvas paths per surface (default 2,500, as map/layers' default budgets). */
  readonly maxPathsPerSurface?: number;
  /** Hover labels (default true). */
  readonly tooltips?: boolean;
  /** Leaflet's zoom buttons (default true). */
  readonly zoomControl?: boolean;
  /** The yard scale bar (default true). */
  readonly scaleBar?: boolean;
  /** Where User Timing measures go (default the page's `performance`; null for none). */
  readonly performance?: PerformanceLike | null;
  /** A fixed palette; default: read from the container's CSS custom properties (style.ts). */
  readonly palette?: MapPalette;
  /** Observe the container's size with `ResizeObserver` where it exists (default true). */
  readonly observeResize?: boolean;
  /**
   * How far the canvas extends beyond the view on every side, as a fraction of its size (default
   * 0.1, Leaflet's own). It is redrawn in full on every `moveend`: 0.25 redraws 2.25 times the
   * view's area, 0.1 1.44 times (docs/MAPS.md §7.2 has the measured difference).
   */
  readonly rendererPadding?: number;
  /** How the atlas tiles decode their images (default `HTMLImageElement.decode()`; tests pass a fake). */
  readonly decodeImage?: DecodeImage;
  /** The smooth wheel's rates, clock and frames (with `smoothWheel`; tests pass fakes). */
  readonly wheel?: SmoothWheelOptions;
  /** Timers for the style switch's hold (default the page's `setTimeout`; tests pass fakes). */
  readonly timeouts?: Timeouts;
  /** Animation frames for chunked path creation (with `smoothWheel`; default the page's). */
  readonly frames?: { readonly request: (callback: () => void) => number; readonly cancel: (handle: number) => void };
  /**
   * With `smoothWheel`, where a gesture's settle reports its view (review MR-02): the `move` event,
   * and with it the controller's sync, runs in a task of its own after Leaflet's settle (default a
   * `MessageChannel` message; null reports at once, as without `smoothWheel`). A view the adapter
   * is asked to move to (a fit, a focus, a surface, a resize) is always reported at once.
   */
  readonly settleTasks?: SettleTasks | null;
}

/** Posts a task (a macrotask of its own) and returns its cancel. */
export interface SettleTasks {
  readonly post: (task: () => void) => () => void;
}

/** A task of its own after the current one: a `MessageChannel` message (not throttled as a timeout is), or null where there is none. */
function pageTasks(view: (Window & typeof globalThis) | null): SettleTasks | null {
  const Channel = view?.MessageChannel;
  if (typeof Channel !== 'function') return null;
  return {
    post: (task) => {
      const channel = new Channel();
      let live = true;
      channel.port1.onmessage = () => {
        channel.port1.close();
        if (live) task();
      };
      channel.port2.postMessage(0);
      return () => {
        live = false;
        channel.port1.close();
      };
    },
  };
}

/** `setTimeout` and `clearTimeout`, as the adapter uses them. */
export interface Timeouts {
  readonly set: (callback: () => void, ms: number) => number;
  readonly clear: (handle: number) => void;
}

export function createLeafletMapAdapter(options: LeafletMapAdapterOptions): MapAdapter {
  return new LeafletMapAdapter(options);
}

/** Pixels kept free around fitted bounds by default, and around the largest extent when choosing the least zoom. */
const FIT_PADDING_PX = 24;
const ZOOM_SNAP = 0.25;
/**
 * Wheel and ± steps (docs/research/map-atlas.md §8.4, step ATL.0). Leaflet 1.9.4 drops wheel input
 * during its 250 ms zoom animation, so a slow rate caps the wheel: at 120 px per level, world to
 * zone (−6 → −2) took 43-46 wheel events of 100 px and 5.2-5.6 s in the production app; at
 * Leaflet's default of 60 it takes 22 and 2.7 s (MEASURED, map-atlas.md §3.2 and
 * docs/measurements/map-atlas.json). The ± buttons and keys move one whole level. The smooth wheel
 * of step ATL.8 replaces the wheel handler.
 */
const WHEEL_PX_PER_ZOOM_LEVEL = 60;
const ZOOM_DELTA = 1;
/** The default `rendererPadding`: Leaflet's own (0.25 before the M3 review, PERF-3). */
const RENDERER_PADDING = 0.1;
/** With `smoothWheel`: at most this many paths are created per animation frame (map-atlas.md §8.2). */
const PATHS_PER_FRAME = 150;
/** With `smoothWheel`: the path canvas is re-rendered mid-gesture after this much zoom drift, when its last draw took under `REFRESH_MS` (map-atlas.md §8.4). */
const REFRESH_DRIFT = 0.5;
const REFRESH_MS = 8;
/** The canvas backing store's greatest pixel ratio (map-atlas.md §8.4). */
const MAX_PIXEL_RATIO = 2;

/** A glyph marker, polyline, outline, frame rectangle, connector arc or area outline (all canvas paths), an image overlay, or the atlas tiles. */
type DrawnLayer = L.Path | L.ImageOverlay | AtlasTiles;

/** How far around the view (as a fraction of its size) a placed map counts as visible (map-atlas.md §8.1). */
const VISIBLE_PADDING = 0.5;

/** Each image layer's pane: below the grid pane (350) and the canvas in the overlay pane (400). */
const IMAGE_PANES = {
  relief: { name: 'frl-relief', zIndex: '240', className: 'frl-map__relief' },
  art: { name: 'frl-art', zIndex: '250', className: 'frl-map__art' },
} as const;

/**
 * The atlas's panes (map-atlas.md §8.3, §8.7): the underlay and the tiles between the relief and the
 * per-image art; `frl-tint` and `frl-labels` reserved for the presentation layer's zone fill and
 * labels. None takes pointer events.
 */
const ATLAS_PANES = [
  { name: 'frl-underlay', zIndex: '244' },
  { name: 'frl-atlas', zIndex: '245' },
  { name: 'frl-tint', zIndex: '255' },
  { name: 'frl-labels', zIndex: '450' },
] as const;

/** The container class while a wheel gesture runs (map.css hides the grid canvas under it). */
const GESTURE_CLASS = 'frl-map--gesture';
/** A tile image's fade-in (map.css `.frl-atlas-tile__img`): a held band goes once the new images are in. */
const TILE_FADE_MS = 150;

/** A band held under the one replacing it during a style switch (map-atlas.md §21.2). */
interface HeldBand {
  readonly layer: LayerId;
  readonly descriptor: TileBandDescriptor;
  readonly tiles: AtlasTiles;
  /** The 2 s limit, then the fade's wait once the new first view has decoded. */
  readonly timers: number[];
}

interface Entry {
  descriptor: MapDescriptor;
  readonly leaflet: DrawnLayer;
  /** The path style last applied (polylines and frames), so an unchanged restyle calls nothing. */
  applied: PathStyle | null;
}

interface LayerState {
  /** The last content's items (every surface). */
  items: readonly MapDescriptor[];
  /** Drawn on the current surface. */
  readonly drawn: Map<string, Entry>;
  /** Ids in draw order (bottom first). */
  order: readonly string[];
  visible: boolean;
  group: L.LayerGroup | null;
  offSurface: number;
  duplicates: number;
  truncated: number;
  skipped: number;
}

interface Owner {
  readonly layer: LayerId;
  readonly id: string;
}

/**
 * The emphasis of one highlighted or selected marker, on top of the selection layer: a strong copy
 * of its glyph, or for a pin a copy with the hover keyline or drawn selected (map-presentation.md
 * §25.2.3: 1.15× with the ring on its halo).
 */
interface Overlay {
  source: MapDescriptor;
  readonly layer: LayerId;
  readonly path: GlyphMarker | PinMarker;
  readonly state: PinState;
}

/** A pin the mask and its band let through, before the stacks. */
interface VisiblePin {
  readonly id: string;
  readonly leaflet: PinMarker;
  readonly descriptor: MarkerDescriptor;
  /** A masked cluster's members still drawn, or undefined for all of them. */
  readonly members: readonly (MarkerMark | null)[] | undefined;
  readonly count: number | undefined;
}

/** A pin's key in the adapter's pin bookkeeping: `layer/id`. */
const pinKey = (layer: LayerId, id: string): string => `${layer}/${id}`;

/** The layers whose pins stack at the zone and close bands and whose items the mask applies to. */
const PIN_LAYERS: readonly LayerId[] = PIN_LAYER_IDS;

/** Whether a mask hides a category or filters by a search. */
interface MaskSets {
  readonly hidden: ReadonlySet<string>;
  readonly subjects: ReadonlySet<string> | null;
  readonly quests: ReadonlySet<number> | null;
  /** The places model's pins a search found, by id (review PR-05); null for no search. */
  readonly places: ReadonlySet<string> | null;
}

const NO_MASK_SETS: MaskSets = { hidden: new Set(), subjects: null, quests: null, places: null };

/** Where a stack's or cluster's refs are merged for a hit (§25.2.7: a list). */
const unionRefs = (lists: readonly (readonly MapRef[])[]): readonly MapRef[] => {
  const out: MapRef[] = [];
  const seen = new Set<MapRef>();
  for (const list of lists) for (const ref of list) if (!seen.has(ref)) {
    seen.add(ref);
    out.push(ref);
  }
  return out;
};

interface SavedView {
  readonly center: WorldPoint;
  readonly zoom: number;
}

interface PendingFit {
  readonly bounds: WorldBounds;
  readonly options: FitOptions;
}

type Handler = (event: MapEvent) => void;

const NO_UI_MAPS: ReadonlySet<UiMapId> = new Set();

/** The layers on the path canvas: every layer but the image layers and the labels canvas's. */
const CANVAS_LAYERS: readonly LayerId[] = LAYER_IDS.filter((layer) => !isImageLayer(layer) && !isLabelLayer(layer));

/** The place pins a label keeps clear of (map-presentation.md §13.2), with focused marks and the active and selected beads. */
const PLACE_LAYERS: readonly LayerId[] = ['dungeons', 'flight-masters', 'transports'];
const SPAWN_MARK_LAYERS: readonly LayerId[] = ['available-quests', 'objectives', 'turn-ins', 'services'];

const leafletBoundsOf = ([[south, west], [north, east]]: LatLngBoundsPair): L.LatLngBounds => L.latLngBounds([south, west], [north, east]);

/** A CSS `clip-path` for an image whose `clip` is part of its `bounds` (null for none). */
function clipPathOf(bounds: WorldBounds, clip: WorldBounds | null | undefined): string {
  const inset = clip === null || clip === undefined ? null : clipInset(bounds, clip);
  if (inset === null) return '';
  const pct = (fraction: number): string => `${String(Math.round(fraction * 1e6) / 1e4)}%`;
  return `inset(${pct(inset.top)} ${pct(inset.right)} ${pct(inset.bottom)} ${pct(inset.left)})`;
}

function pathOptions(style: PathStyle): L.PathOptions {
  return {
    stroke: style.stroke,
    color: style.color,
    weight: style.weight,
    opacity: style.opacity,
    fill: style.fill,
    fillColor: style.fillColor,
    fillOpacity: style.fillOpacity,
    dashArray: style.dashArray ?? undefined,
    lineCap: style.lineCap,
    lineJoin: style.lineJoin,
  };
}

/** The glyph of a marker or an aggregate. */
function glyphOf(descriptor: MapDescriptor, palette: MapPalette, emphasis?: Emphasis): GlyphSpec | null {
  if (descriptor.type === 'marker') return markerGlyph(descriptor, palette, emphasis);
  if (descriptor.type === 'aggregate') return aggregateGlyph(descriptor, palette, emphasis);
  return null;
}

/** How a frame looks: kept but not painted (a zone rectangle over the atlas tiles), or drawn over the tiles (map-atlas.md §8.5, §8.6). */
const frameLook = (descriptor: FrameDescriptor): { readonly hidden: boolean; readonly overTiles: boolean; readonly dashed: boolean } => ({
  hidden: descriptor.hidden === true,
  overTiles: descriptor.overTiles === true,
  dashed: descriptor.dashed === true,
});

/** A frame's label colours: over the atlas tiles, the atlas frame colour with a deep-sea halo, so a caption reads over sea and painting alike. */
const frameLabelStyle = (descriptor: FrameDescriptor, palette: MapPalette): FrameLabelStyle =>
  descriptor.overTiles === true ? { color: palette.frameAtlas, font: palette.font, halo: palette.frameAtlasHalo } : { color: palette.frameLabel, font: palette.font };

const pointOf = (descriptor: MapDescriptor): WorldPoint | null =>
  descriptor.type === 'marker' || descriptor.type === 'aggregate' ? descriptor.point : null;

function prefersReducedMotion(container: HTMLElement): boolean {
  const view = container.ownerDocument.defaultView;
  return view !== null && typeof view.matchMedia === 'function' && view.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class LeafletMapAdapter implements MapAdapter {
  private readonly surfaces: ReadonlyMap<SurfaceId, SurfaceInfo>;
  private readonly surfaceOrder: readonly SurfaceId[];
  private readonly preferredMinZoom: number;
  private readonly minZoomFloor: number;
  private readonly maxZoom: number;
  private readonly focusZoom: number;
  private readonly maxPaths: number;
  private readonly tooltips: boolean;
  private readonly zoomControl: boolean;
  private readonly scaleBar: boolean;
  private readonly fixedPalette: MapPalette | null;
  private readonly observeResize: boolean;
  private readonly rendererPadding: number;
  private readonly smooth: boolean;
  private readonly decodeImage: DecodeImage | undefined;
  private readonly wheelOptions: SmoothWheelOptions;
  private readonly frameSource: { readonly request: (callback: () => void) => number; readonly cancel: (handle: number) => void } | null;
  /**
   * The atlas keys decoded in this session, per band (map-atlas.md §21.2): tiles start from them
   * after a surface switch, a remount or a switch back to a style, and never from another style's.
   */
  private readonly decodedTiles = new Map<string, DecodedTiles>();
  private readonly initialStyle: MapStyle;
  private readonly timeouts: Timeouts | null;
  /** Where a gesture's settle reports its view (`settleTasks`), once mounted; null reports at once. */
  private settleTasks: SettleTasks | null = null;
  private readonly settleTasksOption: SettleTasks | null | undefined;
  /** The settle's report waiting for its task, as its cancel. */
  private pendingSettle: (() => void) | null = null;
  /** Inside a move the adapter was asked for (a fit, a focus, a surface, a resize): its settle is reported at once. */
  private ownMoves = 0;
  /** The band held under a new one while the new first view decodes (map-atlas.md §21.2); null for none. */
  private held: HeldBand | null = null;
  private readonly perf: MapPerf;
  private readonly layers: Record<LayerId, LayerState>;
  private readonly handlers = new Map<MapEventType, Set<Handler>>();
  private readonly owners = new Map<object, Owner>();
  private readonly savedViews = new Map<SurfaceId, SavedView>();
  private readonly pendingFits = new Map<SurfaceId, PendingFit>();
  private readonly overlays = new Map<string, Overlay>();

  private surface: SurfaceId | null;
  private labelProvider: MapLabelProvider | null;
  private stepNumbers: MapStepNumbers | null;
  /** The labels canvas (map-presentation.md §5.5), or null before mounting. */
  private labels: LabelsRenderer | null = null;
  /** The label layer's descriptors on the shown surface, within the adapter's cap. */
  private labelItems: readonly LabelDescriptor[] = [];
  /** Whether each label was in range at the last draw, for the range hysteresis. */
  private labelShown: ReadonlyMap<string, boolean> = new Map();
  private labelStats: LabelRenderStats = EMPTY_LABEL_RENDER_STATS;
  /** The zoom band of the last settled view (`nextBand`, as the controller keeps it); null before mounting. */
  private band: MapBand | null = null;
  private map: L.Map | null = null;
  private container: HTMLElement | null = null;
  private canvas: MeasuredCanvas | null = null;
  private grid: GridLayer | null = null;
  private gridShown = true;
  private tooltip: L.Tooltip | null = null;
  private resizeObserver: ResizeObserver | null = null;
  /** Where the container was on the page at the last resize, so the content can stay still when an edge moves (review QA-16). */
  private containerAt: { readonly left: number; readonly top: number } | null = null;
  private themeObserver: MutationObserver | null = null;
  private stopColorSchemeListener: (() => void) | null = null;
  private palette: MapPalette | null = null;
  private highlighted: { readonly layer: LayerId; readonly ids: ReadonlySet<string> } | null = null;
  /** A fit requested while the container had no size, applied once it has one. */
  private deferredFit: PendingFit | null = null;
  /** The shown surface's placements by world map (the funnel's translations). */
  private places: ReadonlyMap<WorldMapId, SurfacePlacement> = new Map();
  private scaleControl: ScaleBarControl | null = null;
  /** Animations allowed (no reduced motion), read at mount. */
  private animate = true;
  private wheel: SmoothWheel | null = null;
  /** Paths the current animation frame may still create (`smoothWheel`), the frame that resets it, and the layers waiting for it. */
  private chunkLeft = PATHS_PER_FRAME;
  private chunkFrame: number | null = null;
  private readonly chunkLayers = new Set<LayerId>();
  // Pins (map-presentation.md §25.2; step MP.4a) --------------------------------------------
  private pinPalette: PinPalette = DEFAULT_PIN_PALETTE;
  private pinBitmaps: PinBitmaps | null = null;
  private readonly pinDrawing: PinDrawing;
  private readonly glyphPaths = new Map<string, unknown>();
  /** The drawer's mask and the search filter (`setMask`). */
  private mask: MapMask = NO_MAP_MASK;
  private maskSets: MaskSets = NO_MASK_SETS;
  /** The pins drawn selected (`selectPins`: the chosen search result). */
  private selectedPins: HighlightTarget | null = null;
  /** The band's head diameter at the drawn zoom. */
  private pinDiameter = pinDiameterFor(0);
  /** Per threshold key (a layer, `vendors`), whether its pins are drawn now, with hysteresis. */
  private readonly pinsShown = new Map<string, boolean>();
  /** Stack leaders (`layer/id`) and their members, the leader first, at the zone and close bands. */
  private stacks: ReadonlyMap<string, readonly string[]> = new Map();
  /** Pins merged into a leader. */
  private mergedAway: ReadonlySet<string> = new Set();
  /** The hit index over the drawn pins (built off the `moveend` frame), or null when it must be rebuilt. */
  private hitIndex: PinHitIndex | null = null;
  private cancelHitBuild: (() => void) | null = null;
  /** The pin the pointer is resolved to now (`layer/id`), for hover changes between overlapping pins. */
  private hoveredPin: string | null = null;
  /** The cluster level drawn (`clusterLevelAt`), for the split's cross-fade. */
  private clusterLevel: number | null = null;
  private forcedQuery: MediaQueryList | null = null;
  private stopForcedListener: (() => void) | null = null;
  private probe: HTMLElement | null = null;

  constructor(options: LeafletMapAdapterOptions) {
    this.surfaces = new Map(options.surfaces.map((surface) => [surface.id, surface]));
    this.surfaceOrder = options.surfaces.map((surface) => surface.id);
    this.surface = options.initialSurface !== null && this.surfaces.has(options.initialSurface) ? options.initialSurface : (this.surfaceOrder[0] ?? null);
    this.labelProvider = options.label ?? null;
    this.stepNumbers = options.stepNumbers ?? null;
    this.preferredMinZoom = options.minZoom ?? -6;
    this.minZoomFloor = Math.min(options.minZoomFloor ?? -7.5, this.preferredMinZoom);
    this.maxZoom = options.maxZoom ?? 2;
    this.focusZoom = options.focusZoom ?? -2;
    this.maxPaths = options.maxPathsPerSurface ?? 2500;
    this.tooltips = options.tooltips ?? true;
    this.zoomControl = options.zoomControl ?? true;
    this.scaleBar = options.scaleBar ?? true;
    this.fixedPalette = options.palette ?? null;
    this.observeResize = options.observeResize ?? true;
    this.rendererPadding = options.rendererPadding ?? RENDERER_PADDING;
    this.smooth = options.smoothWheel ?? false;
    this.decodeImage = options.decodeImage;
    this.wheelOptions = options.wheel ?? {};
    this.frameSource = options.frames ?? null;
    this.initialStyle = options.style ?? DEFAULT_MAP_STYLE;
    this.timeouts = options.timeouts ?? null;
    this.settleTasksOption = options.settleTasks;
    this.perf = createMapPerf(options.performance === undefined ? pagePerformance() : options.performance);
    const layers: Partial<Record<LayerId, LayerState>> = {};
    for (const layer of LAYER_IDS) {
      layers[layer] = {
        items: [],
        drawn: new Map(),
        order: [],
        visible: true,
        group: null,
        offSurface: 0,
        duplicates: 0,
        truncated: 0,
        skipped: 0,
      };
    }
    this.layers = layers as Record<LayerId, LayerState>;
    this.places = this.placesOf(this.surface);
    this.pinDrawing = {
      bitmap: (spec) => this.pinBitmaps?.get(spec, this.pinPalette, this.canvasRatio()) ?? null,
      palette: () => this.pinPalette,
      path: (d) => this.glyphPath(d),
    };
  }

  // ===========================================================================================
  // The funnel (map-atlas.md §8.1): world points in, Leaflet coordinates out, through placements

  private placesOf(surface: SurfaceId | null): ReadonlyMap<WorldMapId, SurfacePlacement> {
    const info = surface === null ? undefined : this.surfaces.get(surface);
    return new Map(info === undefined ? [] : surfacePlacements(info).map((placement) => [placement.mapId, placement]));
  }

  /** The translation `mapId` is drawn through on the shown surface (the identity for a map it does not place, which is never drawn). */
  private translationOf(mapId: WorldMapId): Translation {
    return this.places.get(mapId) ?? IDENTITY;
  }

  private toLatLng(point: WorldPoint): L.LatLng {
    const [lat, lng] = placedLatLng(this.translationOf(point.mapId), point.x, point.y);
    return L.latLng(lat, lng);
  }

  /** Points of one world map (a polyline's, an outline's line), with one placement lookup. */
  private toLatLngs(mapId: WorldMapId, points: readonly WorldPoint[]): L.LatLng[] {
    const placement = this.translationOf(mapId);
    return points.map((point) => {
      const [lat, lng] = placedLatLng(placement, point.x, point.y);
      return L.latLng(lat, lng);
    });
  }

  private toBounds(bounds: WorldBounds): L.LatLngBounds {
    return leafletBoundsOf(placedLatLngBounds(this.translationOf(bounds.mapId), bounds));
  }

  /** The world point under a Leaflet point: through the partition on the atlas (map-atlas.md §5.4), else the world surface's inverse. */
  private worldAt(info: SurfaceInfo, latlng: L.LatLng): WorldPoint | null {
    if (!isAtlasSurface(info)) return latLngToWorld(latlng.lat, latlng.lng, info.mapId);
    const at = latLngToAtlas(latlng.lat, latlng.lng);
    return surfacePointAt(info, at.e, at.s);
  }

  /** The grid's placements: each placed map's, clipped to its rectangle (map-atlas.md §8.5), or the world surface's, clipped to its extent. */
  private gridPlacementsOf(info: SurfaceInfo | undefined): readonly GridPlacement[] {
    if (info === undefined) return [];
    if (!isAtlasSurface(info)) return [{ mapId: info.mapId, translation: IDENTITY, clip: info.extent }];
    return info.placements.map((placement) => ({ mapId: placement.mapId, translation: placement, clip: placement.rect }));
  }

  /** The scale bar's map name on the atlas (the map under the view centre, map-atlas.md §8.5); null on a world surface. */
  private scaleName(): string | null {
    const info = this.surface === null ? undefined : this.surfaces.get(this.surface);
    if (info === undefined || !isAtlasSurface(info)) return null;
    const mapId = this.getView()?.mapId;
    return info.members.find((member) => member.mapId === mapId)?.name ?? null;
  }

  // ===========================================================================================
  // Lifecycle

  mount(el: MapContainer): void {
    if (this.map !== null) throw new Error('LeafletMapAdapter.mount: already mounted; call destroy() first');
    const host = el as unknown as HTMLElement;
    const container = host.ownerDocument.createElement('div');
    container.className = 'frl-map';
    // The base style, for the presentation's palette (map-atlas.md §8.7 item 9), before it is read.
    container.dataset['mapStyle'] = this.initialStyle;
    host.appendChild(container);
    this.container = container;
    this.palette = this.fixedPalette ?? readMapPalette(container);
    // Pins (map-presentation.md §25.2.9): the forced-colours probe, the palette, the bitmap cache.
    const probe = host.ownerDocument.createElement('span');
    probe.className = 'frl-map__probe';
    probe.setAttribute('aria-hidden', 'true');
    container.appendChild(probe);
    this.probe = probe;
    this.pinBitmaps = new PinBitmaps((width, height) => this.createCanvas(width, height), (d) => this.glyphPath(d));
    this.pinPalette = this.readPinPalette();

    const view = host.ownerDocument.defaultView;
    const pixelRatio = this.smooth ? (): number => Math.min(MAX_PIXEL_RATIO, Math.max(1, view?.devicePixelRatio ?? 1)) : null;
    const canvas = new MeasuredCanvas({ padding: this.rendererPadding, tolerance: 2 }, this.perf, pixelRatio);
    const animate = !prefersReducedMotion(container);
    this.animate = animate;
    const map = L.map(container, {
      crs: L.CRS.Simple,
      minZoom: this.preferredMinZoom,
      maxZoom: this.maxZoom,
      // Any resting zoom with the smooth wheel (map-atlas.md §8.4); the buttons and keys keep whole levels.
      zoomSnap: this.smooth ? 0 : ZOOM_SNAP,
      zoomDelta: ZOOM_DELTA,
      wheelPxPerZoomLevel: WHEEL_PX_PER_ZOOM_LEVEL,
      scrollWheelZoom: !this.smooth,
      attributionControl: false,
      zoomControl: this.zoomControl,
      preferCanvas: true,
      renderer: canvas,
      maxBoundsViscosity: 0.9,
      zoomAnimation: animate,
      // The atlas tiles fade their own images (map-atlas.md §8.3, A10); nothing else uses Leaflet's fade.
      fadeAnimation: false,
      markerZoomAnimation: animate,
      inertia: animate,
    });
    this.map = map;
    this.canvas = canvas;
    for (const pane of [...Object.values(IMAGE_PANES), ...ATLAS_PANES]) {
      const element = map.createPane(pane.name);
      element.style.zIndex = pane.zIndex;
      element.style.pointerEvents = 'none';
    }
    const gridPane = map.createPane('frl-grid');
    gridPane.style.zIndex = '350';
    gridPane.style.pointerEvents = 'none';
    this.updateMinZoom();

    // A view first, so every layer below is added to a loaded map in layer order.
    const info = this.surface === null ? undefined : this.surfaces.get(this.surface);
    if (info === undefined) map.setView([0, 0], -3, { animate: false });
    else this.applySurfaceView(info);

    for (const layer of LAYER_IDS) {
      const group = isImageLayer(layer) ? L.layerGroup() : L.featureGroup();
      if (group instanceof L.FeatureGroup) this.wireGroup(layer, group);
      const state = this.layers[layer];
      state.group = group;
      if (state.visible) group.addTo(map);
    }
    this.grid = new GridLayer({ pane: 'frl-grid' }, this.palette);
    this.grid.setShown(this.gridShown);
    this.grid.addTo(map);
    this.grid.setPlacements(this.gridPlacementsOf(info));
    this.band = nextBand(null, pxPerYardAt(map.getZoom()));
    this.labels = new LabelsRenderer(
      { pane: 'frl-labels', padding: this.rendererPadding },
      {
        draw: (ctx, area) => {
          this.drawLabels(ctx, area);
        },
        pixelRatio: () => Math.min(MAX_PIXEL_RATIO, Math.max(1, view?.devicePixelRatio ?? 1)),
        perf: this.perf,
        frames: { request: (callback) => this.requestFrame(callback), cancel: (handle) => this.cancelFrame(handle) },
        tasks: { post: (task) => this.settleTasks?.post(task) ?? (task(), () => undefined) },
      },
    );
    this.settleTasks = this.settleTasksOption !== undefined ? this.settleTasksOption : this.smooth ? pageTasks(view ?? null) : null;
    this.labels.addTo(map);
    if (this.scaleBar) {
      // Bottom right, above the map's floating Map view toolbar; the caption has the bottom left (map-presentation.md §25.3.0).
      this.scaleControl = new ScaleBarControl({ position: 'bottomright' }, 120, () => this.scaleName());
      this.scaleControl.addTo(map);
    }
    if (this.tooltips) this.tooltip = L.tooltip({ className: 'frl-map__tooltip', direction: 'top', offset: [0, -10], opacity: 1 });
    if (info !== undefined) map.setMaxBounds(this.toBounds(info.extent).pad(0.5));

    map.on('click', (event: L.LeafletMouseEvent) => {
      const point = this.worldOf(event.latlng);
      if (point !== null) this.emit({ type: 'click', point, hit: null, zones: this.zonesAt(point) });
    });
    map.on('moveend', () => {
      this.rememberView();
      this.settleBand();
      // Review MR-02: a gesture's settle (the wheel's, a drag's, a zoom animation's end) reports its
      // view in a task of its own, so Leaflet's re-projection and redraw and the controller's sync
      // are two tasks, not one; the labels canvas draws after the report, once.
      if (this.settleTasks !== null && this.ownMoves === 0) {
        this.deferSettle(this.settleTasks);
        return;
      }
      this.reportSettled();
    });
    map.on('zoomend', () => {
      // Pin sizes, thresholds and stacks for the new zoom, before the settle's redraw (§25.2.4, §25.2.5).
      this.refreshPins(PIN_LAYERS, false);
      const view = this.getView();
      if (view !== null) this.emit({ type: 'zoom', view });
    });
    map.on('viewreset', () => {
      this.hitIndex = null;
    });

    if (this.smooth) {
      this.wheel = new SmoothWheel(map, {
        ...this.wheelOptions,
        onGestureStart: () => {
          container.classList.add(GESTURE_CLASS);
          this.closeTooltip();
          this.wheelOptions.onGestureStart?.();
        },
        onFrame: () => {
          this.refreshMidGesture();
          this.wheelOptions.onFrame?.();
        },
        onGestureEnd: () => {
          container.classList.remove(GESTURE_CLASS);
          this.wheelOptions.onGestureEnd?.();
        },
      });
      this.wheel.enable();
    }

    for (const layer of LAYER_IDS) this.apply(layer);

    const Observer = view?.ResizeObserver;
    if (this.observeResize && Observer !== undefined) {
      this.resizeObserver = new Observer(() => {
        this.onObservedResize();
      });
      this.resizeObserver.observe(container);
    }
    if (this.fixedPalette === null && view !== null) this.watchTheme(view, host.ownerDocument.documentElement);
    if (view !== null) this.watchForcedColours(view);
    this.refreshPins(PIN_LAYERS, true);
  }

  /** The forced-colours query (§25.2.9): a change re-reads the pin palette from the probe and redraws the pins. */
  private watchForcedColours(view: Window & typeof globalThis): void {
    if (typeof view.matchMedia !== 'function') return;
    const query = view.matchMedia('(forced-colors: active)');
    this.forcedQuery = query;
    const refresh = (): void => {
      this.refreshPinPalette();
    };
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', refresh);
      this.stopForcedListener = () => {
        query.removeEventListener('change', refresh);
      };
    }
    this.refreshPinPalette();
  }

  /**
   * Canvas colours come from CSS custom properties, which change with the theme: re-read them when
   * the root's `data-theme` changes (the kit's theme toggle, UI.md §2) or the system colour scheme
   * does. A theme set on some other subtree needs an explicit `refreshTheme()`.
   */
  private watchTheme(view: Window & typeof globalThis, root: HTMLElement): void {
    const refresh = (): void => {
      this.refreshTheme();
    };
    if (typeof view.MutationObserver === 'function') {
      this.themeObserver = new view.MutationObserver(refresh);
      this.themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    }
    const scheme = typeof view.matchMedia === 'function' ? view.matchMedia('(prefers-color-scheme: dark)') : null;
    if (scheme !== null && typeof scheme.addEventListener === 'function') {
      scheme.addEventListener('change', refresh);
      this.stopColorSchemeListener = () => {
        scheme.removeEventListener('change', refresh);
      };
    }
  }

  destroy(): void {
    const map = this.map;
    if (map === null) return;
    this.rememberView();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    this.stopColorSchemeListener?.();
    this.stopColorSchemeListener = null;
    this.stopForcedListener?.();
    this.stopForcedListener = null;
    this.forcedQuery = null;
    this.pendingSettle?.();
    this.pendingSettle = null;
    this.cancelHitBuild?.();
    this.cancelHitBuild = null;
    this.hitIndex = null;
    this.hoveredPin = null;
    this.stacks = new Map();
    this.mergedAway = new Set();
    this.pinsShown.clear();
    this.probe = null;
    // A debounced resize's moveend (Leaflet 1.9.4 `_sizeTimer`) must not fire on a removed map.
    clearTimeout((map as unknown as { _sizeTimer?: ReturnType<typeof setTimeout> })._sizeTimer);
    this.wheel?.disable();
    this.wheel = null;
    this.releaseHeld();
    if (this.chunkFrame !== null) this.cancelFrame(this.chunkFrame);
    this.chunkFrame = null;
    this.chunkLayers.clear();
    this.chunkLeft = PATHS_PER_FRAME;
    map.remove();
    this.container?.remove();
    for (const layer of LAYER_IDS) {
      const state = this.layers[layer];
      state.drawn.clear();
      state.order = [];
      state.group = null;
    }
    this.owners.clear();
    this.overlays.clear();
    this.map = null;
    this.container = null;
    this.containerAt = null;
    this.canvas = null;
    this.labels = null;
    this.labelItems = [];
    this.labelShown = new Map();
    this.band = null;
    this.grid = null;
    this.scaleControl = null;
    this.tooltip = null;
    this.deferredFit = null;
  }

  /** Re-measures the container now: the view settles (`moveend`, a `move` event) at once. */
  resize(): void {
    const map = this.map;
    if (map === null) return;
    this.ownMove(() => {
      map.invalidateSize({ pan: false });
      this.afterResize();
    });
  }

  /**
   * A resize seen by the `ResizeObserver` (at most once a frame while a splitter is dragged): the
   * view settles 200 ms after the last one, so the renderer redraws and the controller syncs once
   * rather than every frame (M3 review PERF-5). The canvas padding covers the gap meanwhile.
   */
  private onObservedResize(): void {
    const map = this.map;
    if (map === null) return;
    map.invalidateSize({ pan: false, debounceMoveend: true });
    this.keepContentStill(map);
    this.afterResize();
  }

  /**
   * A panel collapsed or restored beside the map moves the container's left (or top) edge: the view
   * is panned by as much, so what is on the map stays where it was on the screen and the new room
   * shows more map, rather than the content sliding with the edge (review QA-16).
   */
  private keepContentStill(map: L.Map): void {
    const container = map.getContainer();
    const rect = container.getBoundingClientRect();
    // Page coordinates: a scrolled page (at 720px and below) moves the viewport, not the edge.
    const page = container.ownerDocument.defaultView;
    const was = this.containerAt;
    this.containerAt = { left: rect.left + (page?.scrollX ?? 0), top: rect.top + (page?.scrollY ?? 0) };
    if (was === null) return;
    const dx = Math.round(this.containerAt.left - was.left);
    const dy = Math.round(this.containerAt.top - was.top);
    if (dx !== 0 || dy !== 0) map.panBy([dx, dy], { animate: false });
  }

  private afterResize(): void {
    const map = this.map;
    if (map === null) return;
    this.updateMinZoom();
    const fit = this.deferredFit;
    const size = map.getSize();
    if (fit !== null && size.x > 0 && size.y > 0) {
      this.deferredFit = null;
      this.fitNow(fit.bounds, fit.options);
    }
  }

  /** The least zoom that still shows the largest surface extent in this container (`minZoomFor`). */
  private updateMinZoom(): void {
    const map = this.map;
    if (map === null) return;
    const size = map.getSize();
    const zoom = minZoomFor(
      [...this.surfaces.values()].map((surface) => surface.extent),
      size.x,
      size.y,
      { paddingPx: FIT_PADDING_PX, preferred: this.preferredMinZoom, floor: this.minZoomFloor, snap: this.smooth ? 0 : ZOOM_SNAP },
    );
    if (zoom !== map.getMinZoom()) map.setMinZoom(zoom);
  }

  /** The zoom range the map allows now, or null before mounting (for tests and diagnostics). */
  zoomLimits(): { readonly min: number; readonly max: number } | null {
    const map = this.map;
    return map === null ? null : { min: map.getMinZoom(), max: map.getMaxZoom() };
  }

  refreshTheme(): void {
    if (this.container === null) return;
    this.palette = this.fixedPalette ?? readMapPalette(this.container);
    for (const layer of LAYER_IDS) for (const entry of this.layers[layer].drawn.values()) this.restyle(layer, entry);
    for (const overlay of this.overlays.values()) this.refreshOverlay(overlay, overlay.source);
    this.grid?.setPalette(this.palette);
    this.refreshPinPalette();
    this.labels?.requestDraw();
  }

  setLabelProvider(provider: MapLabelProvider | null): void {
    this.labelProvider = provider;
  }

  setStepNumbers(provider: MapStepNumbers | null): void {
    this.stepNumbers = provider;
    this.labels?.requestDraw();
  }

  /** The drawer's Coordinate grid row (review PR-10): kept for a later mount. */
  setGrid(shown: boolean): void {
    this.gridShown = shown;
    this.grid?.setShown(shown);
  }

  refreshLabels(): void {
    this.labels?.requestDraw();
  }

  /** Reports the settled view in its own task (review MR-02); the labels canvas waits for it. */
  private deferSettle(tasks: SettleTasks): void {
    this.labels?.hold();
    this.canvas?.frlHold();
    if (this.pendingSettle !== null) return;
    this.pendingSettle = tasks.post(() => {
      this.pendingSettle = null;
      this.reportSettled();
    });
  }

  /** Emits the settled view's `move` (a waiting report is sent now instead), then lets the labels canvas draw. */
  private reportSettled(): void {
    const pending = this.pendingSettle;
    this.pendingSettle = null;
    pending?.();
    const view = this.getView();
    if (view !== null) this.emit({ type: 'move', view });
    // The paths' update and full redraw in the next frame, then the labels in a task after it.
    this.canvas?.frlRelease((callback) => {
      this.requestFrame(callback);
    });
    this.labels?.release();
  }

  /** Runs a view change the adapter was asked for: its settle is reported at once (a fit, a focus, a surface, a resize). */
  private ownMove<T>(run: () => T): T {
    this.ownMoves += 1;
    try {
      return run();
    } finally {
      this.ownMoves -= 1;
    }
  }

  /**
   * The controller's band for the settled view (review MR-03): it replaces the one `settleBand`
   * reckoned from the zoom (which cannot know that a view the controller moved itself starts
   * afresh), so the pins' stacking, the cluster split and the step numbers follow the band the
   * layers were built for. Nothing happens when the two agree, as they do after every gesture.
   */
  setBand(band: MapBand): void {
    const map = this.map;
    if (map === null || band === this.band) return;
    this.band = band;
    this.clusterLevel = band === 'world' || band === 'continent' ? clusterLevelAt(map.getZoom()) : null;
    this.refreshPins(PIN_LAYERS, true);
    this.labels?.requestDraw();
  }

  /**
   * A settled view's band (map-presentation.md §5.1, §5.5): `nextBand` from the last one, as the
   * controller keeps it (and corrects with `setBand`). At a band change the outgoing pictures of the path canvas and the labels
   * canvas fade out over 140 ms (none under reduced motion) while the new ones draw at full opacity:
   * this runs before the view is reported, so the copies hold the old content in place.
   */
  private settleBand(): void {
    const map = this.map;
    if (map === null) return;
    const next = nextBand(this.band, pxPerYardAt(map.getZoom()));
    // A cluster split cross-fades like a band change (map-presentation.md §25.2.5), below the zone band.
    const level = next === 'world' || next === 'continent' ? clusterLevelAt(map.getZoom()) : null;
    const split = this.clusterLevel !== null && level !== null && level !== this.clusterLevel;
    this.clusterLevel = level;
    const changed = (this.band !== null && next !== this.band) || split;
    this.band = next;
    if (!changed || !this.animate) return;
    // The fade's own timer (not the style switch's injectable `timeouts`): it only removes the copy.
    const view = this.container?.ownerDocument.defaultView ?? null;
    if (view === null) return;
    const timers = { set: (callback: () => void, ms: number): number => view.setTimeout(callback, ms) };
    const pathCanvas = (this.canvas as unknown as { readonly _container?: HTMLCanvasElement } | null)?._container;
    if (pathCanvas !== undefined) crossFadeOut(pathCanvas, CROSS_FADE_MS, timers);
    const labelCanvas = this.labels?.element ?? null;
    if (labelCanvas !== null) crossFadeOut(labelCanvas, CROSS_FADE_MS, timers);
  }

  // ===========================================================================================
  // Surfaces and views

  getSurface(): SurfaceId | null {
    return this.surface;
  }

  setSurface(surface: SurfaceId): boolean {
    const info = this.surfaces.get(surface);
    if (info === undefined) return false;
    if (surface === this.surface) return true;
    this.rememberView();
    this.surface = surface;
    this.places = this.placesOf(surface);
    const map = this.map;
    if (map === null) return true;
    this.closeTooltip();
    this.highlighted = null;
    this.syncHighlight();
    for (const layer of LAYER_IDS) this.clearLayer(layer);
    this.grid?.setPlacements(this.gridPlacementsOf(info));
    // The bounds of the previous surface would pull the new view back; lift them while moving.
    map.setMaxBounds();
    this.applySurfaceView(info);
    map.setMaxBounds(this.toBounds(info.extent).pad(0.5));
    for (const layer of LAYER_IDS) this.apply(layer);
    const view = this.getView();
    if (view !== null) this.emit({ type: 'surface', surface, view });
    return true;
  }

  /** The surface a command on a point of `mapId` goes to (`surfaceForMap`), shown first; null when none places the map. */
  private showSurfaceFor(mapId: WorldMapId): SurfaceId | null {
    const info = surfaceForMap([...this.surfaces.values()], this.surface, mapId);
    if (info === null || !this.setSurface(info.id)) return null;
    return info.id;
  }

  setViewport(viewport: Viewport): boolean {
    const surface = this.showSurfaceFor(viewport.center.mapId);
    if (surface === null) return false;
    if (this.map === null) {
      this.pendingFits.delete(surface);
      this.savedViews.set(surface, { center: viewport.center, zoom: viewport.zoom });
      return true;
    }
    const map = this.map;
    this.ownMove(() => map.setView(this.toLatLng(viewport.center), viewport.zoom, { animate: false }));
    return true;
  }

  fitBounds(bounds: WorldBounds, options: FitOptions = {}): boolean {
    const surface = this.showSurfaceFor(bounds.mapId);
    if (surface === null) return false;
    if (this.map === null) {
      this.pendingFits.set(surface, { bounds, options });
      return true;
    }
    this.fitNow(bounds, options);
    return true;
  }

  focus(point: WorldPoint, options: FocusOptions = {}): boolean {
    const surface = this.showSurfaceFor(point.mapId);
    if (surface === null) return false;
    const map = this.map;
    if (map === null) {
      this.pendingFits.delete(surface);
      this.savedViews.set(surface, { center: point, zoom: options.zoom ?? this.focusZoom });
      return true;
    }
    const current = map.getZoom();
    const zoom = options.zoom ?? Math.max(current, this.focusZoom);
    const target = this.toLatLng(point);
    if (options.recenter !== true && zoom === current && map.getBounds().pad(-0.2).contains(target)) return true;
    this.ownMove(() => map.setView(target, zoom, { animate: options.animate ?? false }));
    return true;
  }

  getView(): MapViewState | null {
    const map = this.map;
    const surface = this.surface;
    const info = surface === null ? undefined : this.surfaces.get(surface);
    if (map === null || surface === null || info === undefined) return null;
    const center = map.getCenter();
    const bounds = map.getBounds();
    const size = map.getSize();
    const [south, west, north, east] = [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()];
    if (!isAtlasSurface(info)) {
      const mapId = info.mapId;
      return {
        surface,
        mapId,
        center: latLngToWorld(center.lat, center.lng, mapId),
        zoom: map.getZoom(),
        bounds: latLngBoundsToWorld(south, west, north, east, mapId),
        widthPx: size.x,
        heightPx: size.y,
      };
    }
    // The atlas: the map under the centre (the partition), the view in its yards, and the view in
    // the yards of every placed map that meets it padded by 50 % (map-atlas.md §8.1).
    const point = this.worldAt(info, center) ?? latLngOnMap(this.translationOf(info.mapId), center.lat, center.lng, info.mapId);
    const padded = padLatLngBounds(
      [
        [south, west],
        [north, east],
      ],
      VISIBLE_PADDING,
    );
    const visible = info.placements
      .filter((placement) => latLngBoundsMeet(padded, placementLatLngBounds(placement)))
      .map((placement) => latLngBoundsOnMap(placement, south, west, north, east, placement.mapId));
    return {
      surface,
      mapId: point.mapId,
      center: point,
      zoom: map.getZoom(),
      bounds: latLngBoundsOnMap(this.translationOf(point.mapId), south, west, north, east, point.mapId),
      widthPx: size.x,
      heightPx: size.y,
      visible,
    };
  }

  private applySurfaceView(info: SurfaceInfo): void {
    this.ownMove(() => {
      this.applySurfaceViewNow(info);
    });
  }

  private applySurfaceViewNow(info: SurfaceInfo): void {
    const map = this.map;
    if (map === null) return;
    const fit = this.pendingFits.get(info.id);
    const saved = this.savedViews.get(info.id);
    this.pendingFits.delete(info.id);
    if (fit !== undefined) this.fitNow(fit.bounds, fit.options);
    else if (saved !== undefined) map.setView(this.toLatLng(saved.center), saved.zoom, { animate: false });
    else this.fitNow(info.extent, {});
  }

  private fitNow(bounds: WorldBounds, options: FitOptions): void {
    this.ownMove(() => {
      this.fitNowInside(bounds, options);
    });
  }

  private fitNowInside(bounds: WorldBounds, options: FitOptions): void {
    const map = this.map;
    if (map === null) return;
    const padding = options.paddingPx ?? FIT_PADDING_PX;
    const size = map.getSize();
    // With no size yet (a hidden or unlaid-out container) Leaflet would pick the minimum zoom;
    // fit again once the container has a size (resize()).
    this.deferredFit = size.x === 0 || size.y === 0 ? { bounds, options } : null;
    const target = this.toBounds(bounds);
    const maxZoom = options.maxZoom ?? this.maxZoom;
    const animate = options.animate ?? false;
    const floor = options.minZoom;
    if (floor !== undefined && this.deferredFit === null) {
      const fitted = Math.min(maxZoom, map.getBoundsZoom(target, false, L.point(2 * padding, 2 * padding)));
      if (fitted < floor) {
        // The bounds need more room than the floor allows: centre on them at the floor instead.
        map.setView(target.getCenter(), Math.min(floor, maxZoom), { animate });
        return;
      }
    }
    map.fitBounds(target, { padding: [padding, padding], maxZoom, animate });
  }

  private rememberView(): void {
    const view = this.getView();
    if (view !== null) this.savedViews.set(view.surface, { center: view.center, zoom: view.zoom });
  }

  private currentInfo(): SurfaceInfo | null {
    return this.surface === null ? null : (this.surfaces.get(this.surface) ?? null);
  }

  /** The world point under a Leaflet point on the shown surface (clicks, hovers); null before a surface is shown. */
  private worldOf(latlng: L.LatLng): WorldPoint | null {
    const info = this.currentInfo();
    return info === null ? null : this.worldAt(info, latlng);
  }

  // ===========================================================================================
  // Layers

  setLayer(layer: LayerId, content: LayerContent): void {
    const state = this.layers[layer];
    if (content.items === state.items) {
      state.skipped += 1;
      return;
    }
    state.items = content.items;
    if (this.map === null) return;
    this.perf.time(
      'frl:map:set-layer',
      () => this.apply(layer),
      (counts) => ({ layer, ...counts }),
    );
  }

  toggleLayer(layer: LayerId, visible: boolean): void {
    const state = this.layers[layer];
    if (state.visible === visible) return;
    state.visible = visible;
    const map = this.map;
    if (map === null || state.group === null) return;
    if (visible) {
      // Its paths join the draw list at the end; move them to their place.
      state.group.addTo(map);
      this.place(layer);
    } else {
      this.closeTooltip();
      if (this.held?.layer === layer) this.releaseHeld();
      map.removeLayer(state.group);
    }
    if (layer === 'art') this.syncSeaBackground();
    if (this.feedsLabels(layer)) this.labels?.requestDraw();
    this.syncHighlight();
  }

  isLayerVisible(layer: LayerId): boolean {
    return this.layers[layer].visible;
  }

  highlight(target: HighlightTarget | null): void {
    const previous = this.highlighted;
    const next = target === null || target.ids.length === 0 ? null : { layer: target.layer, ids: new Set(target.ids) };
    if (previous === next || (previous !== null && next !== null && previous.layer === next.layer && sameData([...previous.ids], [...next.ids]))) return;
    this.highlighted = next;
    // Lines are restyled in place (thicker) and keep their place in the stack.
    for (const current of [previous, next]) {
      if (current === null) continue;
      const state = this.layers[current.layer];
      for (const id of current.ids) {
        const entry = state.drawn.get(id);
        if (entry?.descriptor.type === 'polyline') this.restyle(current.layer, entry);
      }
    }
    this.syncHighlight();
  }

  renderStats(): MapRenderStats {
    const layers: Partial<Record<LayerId, LayerRenderStats>> = {};
    let paths = 0;
    for (const layer of LAYER_IDS) {
      const state = this.layers[layer];
      const drawn = isLabelLayer(layer) ? this.labelItems.length : state.drawn.size;
      if (!isImageLayer(layer) && state.visible) paths += drawn;
      layers[layer] = {
        visible: state.visible,
        drawn,
        offSurface: state.offSurface,
        duplicates: state.duplicates,
        truncated: state.truncated,
        skipped: state.skipped,
      };
    }
    const band = this.drawnBand();
    return {
      surface: this.surface,
      paths,
      layers: layers as Record<LayerId, LayerRenderStats>,
      labels: { ...this.labelStats, draws: this.labels?.draws ?? this.labelStats.draws },
      style: this.shownStyle(),
      tiles: { band: band?.id ?? null, held: this.held?.descriptor.id ?? null },
      pins: this.pinRenderStats(),
    };
  }

  /**
   * The atlas tile images holding a picture now, in the tile and underlay panes, and what they take
   * decoded at `DECODED_TILE_BYTES` each: the measure of map-atlas.md §24.5 (MM-09), for the ATL.9
   * harness and diagnostics. `budget` is the style's budget for all live tiles, or during a switch.
   */
  tileMemory(): { readonly images: number; readonly bytes: number; readonly budget: number } {
    let images = 0;
    for (const entry of this.layers.art.drawn.values()) if (entry.leaflet instanceof AtlasTiles) images += entry.leaflet.liveImages();
    if (this.held !== null) images += this.held.tiles.liveImages();
    return { images, bytes: images * DECODED_TILE_BYTES, budget: this.held === null ? TILE_MEMORY_BUDGET.liveBytes : TILE_MEMORY_BUDGET.switchBytes };
  }

  /**
   * The canvas paths in draw order, bottom first, as `layer/id` (a highlight overlay as
   * `highlight/<layer>/<id>`): the order the renderer draws and hit-tests in. For tests and diagnostics.
   */
  drawOrder(): readonly string[] {
    const renderer = this.canvas;
    if (renderer === null) return [];
    const overlayNames = new Map<object, string>();
    for (const [key, overlay] of this.overlays) overlayNames.set(overlay.path, `highlight/${key}`);
    return drawOrder(renderer).map((path) => {
      if (typeof path !== 'object' || path === null) return '?';
      const owner = this.owners.get(path);
      return owner === undefined ? (overlayNames.get(path) ?? '?') : `${owner.layer}/${owner.id}`;
    });
  }

  /** Diffs the layer's stored items for the current surface against what is drawn, and applies the difference. */
  private apply(layer: LayerId): { added: number; removed: number; changed: number; moved: number } {
    const state = this.layers[layer];
    const group = state.group;
    const info = this.currentInfo();
    if (group === null) return { added: 0, removed: 0, changed: 0, moved: 0 };
    const onSurface = info === null ? [] : state.items.filter((descriptor) => descriptorOnSurface(descriptor, info));
    state.offSurface = state.items.length - onSurface.length;
    if (isLabelLayer(layer)) return this.applyLabels(state, onSurface);
    const capacity = isImageLayer(layer) ? Infinity : this.maxPaths - this.pathsOutside(layer);
    const { kept, dropped } = capItems(onSurface, capacity);
    state.truncated = dropped;
    const previous = new Map<string, MapDescriptor>();
    for (const [id, entry] of state.drawn) previous.set(id, entry.descriptor);
    const diff = diffById(previous, kept);
    state.duplicates = diff.duplicates.length;
    // A tile band replaced by another (a style switch, map-atlas.md §21.2) is held under the new one.
    const newBand = diff.added.some((descriptor) => descriptor.type === 'tiles') || diff.changed.some(({ next }) => next.type === 'tiles');
    for (const id of diff.removed) {
      if (newBand && state.drawn.get(id)?.leaflet instanceof AtlasTiles) this.holdBand(layer, id);
      else this.removeEntry(layer, id);
    }
    for (const { previous: old, next } of diff.changed) {
      const entry = state.drawn.get(next.id);
      if (entry === undefined) continue;
      const sameClass = next.type !== 'marker' || entry.leaflet instanceof PinMarker === isPinMarker(layer, next);
      if (old.type === next.type && next.type !== 'tiles' && sameClass) this.update(layer, entry, next);
      else {
        if (entry.leaflet instanceof AtlasTiles && next.type === 'tiles') this.holdBand(layer, next.id);
        else this.removeEntry(layer, next.id);
        this.create(layer, next);
      }
    }
    // With `smoothWheel`, new paths are created at most PATHS_PER_FRAME per animation frame
    // (map-atlas.md §8.2): the rest wait for the next frame, which applies the layer again.
    const room = this.smooth && !isImageLayer(layer) ? this.chunkLeft : Infinity;
    let created = 0;
    for (const descriptor of diff.added) {
      if (created >= room) break;
      this.create(layer, descriptor);
      created += 1;
    }
    if (room !== Infinity) this.spendChunk(layer, created, created < diff.added.length);
    state.order = PIN_LAYERS.includes(layer) ? this.pinOrder(diff.order) : diff.order.map((descriptor) => descriptor.id);
    // A held band goes at once when nothing replaces it here (another surface, no band).
    if (this.held?.layer === layer && ![...state.drawn.values()].some((entry) => entry.leaflet instanceof AtlasTiles)) this.releaseHeld();
    const moved = this.place(layer);
    if (PIN_LAYERS.includes(layer)) this.refreshPins([layer], true);
    if (this.highlighted?.layer === layer || this.selectedPins?.layer === layer) this.syncHighlight();
    if (this.feedsLabels(layer)) this.labels?.requestDraw();
    return { added: created, removed: diff.removed.length, changed: diff.changed.length, moved };
  }

  /** The label layer's items for the labels canvas: its labels on the surface, within what the path cap leaves (labels count against it). */
  private applyLabels(state: LayerState, onSurface: readonly MapDescriptor[]): { added: number; removed: number; changed: number; moved: number } {
    const labels = onSurface.filter((descriptor): descriptor is LabelDescriptor => descriptor.type === 'label');
    const { kept, dropped } = capItems(labels, this.maxPaths - this.pathsOutside('labels'));
    state.truncated = dropped;
    const before = this.labelItems.length;
    this.labelItems = kept;
    this.labels?.requestDraw();
    return { added: kept.length, removed: before, changed: 0, moved: 0 };
  }

  /** Layers whose content the labels canvas reads: its own, the step beads and the selection (numbers), the places and marks (obstacles), any with objective outlines, and the zone fills (the cards' faction words). */
  private feedsLabels(layer: LayerId): boolean {
    return isLabelLayer(layer) || layer === 'route-steps' || layer === 'selection' || layer === 'zone-fill' || PLACE_LAYERS.includes(layer) || SPAWN_MARK_LAYERS.includes(layer);
  }

  /** Counts `created` paths against this frame's allowance; a layer with more to create is applied again next frame. */
  private spendChunk(layer: LayerId, created: number, more: boolean): void {
    this.chunkLeft = Math.max(0, this.chunkLeft - created);
    if (more) this.chunkLayers.add(layer);
    if (this.chunkFrame !== null || (!more && created === 0)) return;
    this.chunkFrame = this.requestFrame(() => {
      this.chunkFrame = null;
      this.chunkLeft = PATHS_PER_FRAME;
      const waiting = LAYER_IDS.filter((id) => this.chunkLayers.has(id));
      this.chunkLayers.clear();
      if (this.map === null) return;
      for (const id of waiting) {
        this.perf.time(
          'frl:map:set-layer',
          () => this.apply(id),
          (counts) => ({ layer: id, chunk: true, ...counts }),
        );
      }
    });
  }

  private requestFrame(callback: () => void): number {
    if (this.frameSource !== null) return this.frameSource.request(callback);
    const view = this.container?.ownerDocument.defaultView ?? null;
    return view === null ? 0 : view.requestAnimationFrame(() => {
      callback();
    });
  }

  private cancelFrame(handle: number): void {
    if (this.frameSource !== null) this.frameSource.cancel(handle);
    else this.container?.ownerDocument.defaultView?.cancelAnimationFrame(handle);
  }

  /**
   * Mid-gesture (map-atlas.md §8.4): the path canvas is scaled by CSS while the zoom moves; once it
   * has drifted more than half a level from the zoom it was drawn at, and its last draw took under
   * 8 ms, it is drawn again at the current view.
   */
  private refreshMidGesture(): void {
    const map = this.map;
    const canvas = this.canvas;
    if (map === null || canvas === null) return;
    const drawnAt = canvas.frlDrawnZoom();
    if (drawnAt === null || Math.abs(map.getZoom() - drawnAt) <= REFRESH_DRIFT || canvas.frlLastDrawMs >= REFRESH_MS) return;
    canvas.frlRefresh();
  }

  /** The art layer's current tile band, or null. */
  private drawnBand(): TileBandDescriptor | null {
    let band: TileBandDescriptor | null = null;
    for (const entry of this.layers.art.drawn.values()) if (entry.descriptor.type === 'tiles') band = entry.descriptor;
    return band;
  }

  /** The band whose picture is on screen: the held one while it is held (map-atlas.md §21.2), else the drawn one; null while the art layer is hidden. */
  private shownBand(): TileBandDescriptor | null {
    if (!this.layers.art.visible) return null;
    return this.held?.descriptor ?? this.drawnBand();
  }

  private shownStyle(): MapStyle {
    return this.shownBand()?.style ?? this.initialStyle;
  }

  /**
   * While the atlas tiles are drawn and the art layer shown, the container's background is the
   * shown band's deep sea (map-atlas.md §8.3, §21.2: the held band's until it goes), and its
   * `data-map-style` is that band's style (§8.7 item 9); a new style re-reads the palette.
   */
  private syncSeaBackground(): void {
    const container = this.container;
    if (container === null) return;
    const band = this.shownBand();
    const colour = band === null ? '' : `rgb(${band.index.seaColour.join(', ')})`;
    if (container.style.backgroundColor !== colour) container.style.backgroundColor = colour;
    const style = band?.style ?? this.initialStyle;
    if (container.dataset['mapStyle'] !== style) {
      container.dataset['mapStyle'] = style;
      if (this.fixedPalette === null) this.refreshTheme();
    }
  }

  /** The decoded keys of one band (map-atlas.md §21.2): its own, kept for the adapter's lifetime. */
  private decodedFor(band: string): DecodedTiles {
    const existing = this.decodedTiles.get(band);
    if (existing !== undefined) return existing;
    const created = new DecodedTiles();
    this.decodedTiles.set(band, created);
    return created;
  }

  /**
   * Holds a band that is being replaced under its replacement (map-atlas.md §21.2, §24.5): its tiles
   * outside the view are pruned at once and it keeps no buffer; it goes when the new band's first
   * view has decoded and faded in, or after 2 s. If a band is already held (a second switch before
   * the first finished), the picture that is complete stays: the outgoing band is kept only when its
   * own first view has decoded, and otherwise dropped at once.
   */
  private holdBand(layer: LayerId, id: string): void {
    const state = this.layers[layer];
    const entry = state.drawn.get(id);
    if (entry === undefined || !(entry.leaflet instanceof AtlasTiles) || entry.descriptor.type !== 'tiles') {
      this.removeEntry(layer, id);
      return;
    }
    const tiles = entry.leaflet;
    state.drawn.delete(id);
    this.owners.delete(tiles);
    if (this.held !== null) {
      if (tiles.firstView !== 'ready') {
        state.group?.removeLayer(tiles);
        return;
      }
      this.releaseHeld();
    }
    tiles.tiles.pruneOffView();
    const timers: number[] = [];
    const held: HeldBand = { layer, descriptor: entry.descriptor, tiles, timers };
    this.held = held;
    const timer = this.setTimer(() => {
      if (this.held === held) this.releaseHeld();
    }, TILE_MEMORY_BUDGET.holdMs);
    if (timer !== null) timers.push(timer);
  }

  /** Removes the held band (if any) and its timers; the sea and style follow the band left. */
  private releaseHeld(): void {
    const held = this.held;
    if (held === null) return;
    this.held = null;
    for (const timer of held.timers) this.clearTimer(timer);
    this.layers[held.layer].group?.removeLayer(held.tiles);
    this.syncSeaBackground();
    this.labels?.requestDraw();
  }

  /** A band's first view (map-atlas.md §21.2, §21.4): report it, and let a band held under it go once the new images have faded in. */
  private onFirstView(tiles: AtlasTiles, first: 'ready' | 'failed'): void {
    if (!this.owners.has(tiles)) return;
    const held = this.held;
    // A failed first view shows nothing of its own: the old picture stays, for 2 s at most.
    if (held !== null && first === 'ready') {
      const release = (): void => {
        if (this.held === held) this.releaseHeld();
      };
      const timer = this.animate ? this.setTimer(release, TILE_FADE_MS) : null;
      if (timer === null) release();
      else held.timers.push(timer);
    }
    // The painted art's own place names are legible from now (§13.5): the labels give way to them.
    if (first === 'ready') this.labels?.requestDraw();
    this.emit({ type: 'tiles', band: tiles.band.id, style: tiles.band.style, state: first });
  }

  private setTimer(callback: () => void, ms: number): number | null {
    if (this.timeouts !== null) return this.timeouts.set(callback, ms);
    const view = this.container?.ownerDocument.defaultView ?? null;
    return view === null ? null : view.setTimeout(callback, ms);
  }

  private clearTimer(handle: number): void {
    if (this.timeouts !== null) this.timeouts.clear(handle);
    else this.container?.ownerDocument.defaultView?.clearTimeout(handle);
  }

  /**
   * Puts the layer's paths in its order, just after the topmost path of the visible layers below:
   * a created path (appended at the top by Leaflet) or one whose place changed is moved, redrawing
   * only its own area; paths already in place are not touched. Returns how many moved.
   */
  private place(layer: LayerId): number {
    const renderer = this.canvas;
    const state = this.layers[layer];
    if (renderer === null || isImageLayer(layer) || !state.visible) return 0;
    let previous = this.topPathBelow(layer);
    let moved = 0;
    for (const id of state.order) {
      const leaflet = state.drawn.get(id)?.leaflet;
      if (!(leaflet instanceof L.Path)) continue;
      if (placeAfter(renderer, leaflet, previous)) moved += 1;
      previous = leaflet;
    }
    return moved;
  }

  /** The topmost path of the visible canvas layers below `layer`, or null when there is none. */
  private topPathBelow(layer: LayerId): L.Path | null {
    for (let i = CANVAS_LAYERS.indexOf(layer) - 1; i >= 0; i -= 1) {
      const below = CANVAS_LAYERS[i];
      if (below === undefined) continue;
      const state = this.layers[below];
      if (!state.visible) continue;
      for (let j = state.order.length - 1; j >= 0; j -= 1) {
        const leaflet = state.drawn.get(state.order[j] ?? '')?.leaflet;
        if (leaflet instanceof L.Path) return leaflet;
      }
    }
    return null;
  }

  private pathsOutside(layer: LayerId): number {
    let total = 0;
    for (const other of CANVAS_LAYERS) if (other !== layer) total += this.layers[other].drawn.size;
    if (!isLabelLayer(layer)) total += this.labelItems.length;
    return total;
  }

  private clearLayer(layer: LayerId): void {
    const state = this.layers[layer];
    for (const id of [...state.drawn.keys()]) this.removeEntry(layer, id);
    state.order = [];
  }

  private removeEntry(layer: LayerId, id: string): void {
    const state = this.layers[layer];
    const entry = state.drawn.get(id);
    if (entry === undefined) return;
    state.group?.removeLayer(entry.leaflet);
    this.owners.delete(entry.leaflet);
    state.drawn.delete(id);
    if (entry.descriptor.type === 'tiles') this.syncSeaBackground();
  }

  private isHighlighted(layer: LayerId, id: string): boolean {
    return this.highlighted !== null && this.highlighted.layer === layer && this.highlighted.ids.has(id);
  }

  /** A highlighted line is drawn strong in place; markers keep their own emphasis (their highlight is an overlay). */
  private emphasisOf(layer: LayerId, descriptor: MapDescriptor): Emphasis {
    if (descriptor.type === 'art' || descriptor.type === 'outline' || descriptor.type === 'tiles' || descriptor.type === 'label' || descriptor.type === 'area' || descriptor.type === 'zone-fill') return 'normal';
    if (descriptor.type === 'polyline' && this.isHighlighted(layer, descriptor.id)) return 'strong';
    return descriptor.emphasis;
  }

  private create(layer: LayerId, descriptor: MapDescriptor): void {
    const state = this.layers[layer];
    const palette = this.palette;
    const renderer = this.canvas;
    if (state.group === null || palette === null || renderer === null) return;
    const interactive = { renderer, interactive: true, bubblingMouseEvents: false };
    let leaflet: DrawnLayer;
    let applied: PathStyle | null = null;
    switch (descriptor.type) {
      case 'marker':
        leaflet = isPinMarker(layer, descriptor)
          ? new PinMarker(this.toLatLng(descriptor.point), this.pinSpecFor(layer, descriptor), this.pinDrawing, interactive)
          : new GlyphMarker(this.toLatLng(descriptor.point), markerGlyph(descriptor, palette), interactive);
        break;
      case 'aggregate':
        leaflet = new GlyphMarker(this.toLatLng(descriptor.point), aggregateGlyph(descriptor, palette), interactive);
        break;
      case 'polyline': {
        // Every line over its halo (map-presentation.md §25.4; review PR-03); a piece after the active step dashed and faded (§13.6; PR-02).
        const emphasis = this.emphasisOf(layer, descriptor);
        applied = polylineStyle(descriptor.style, emphasis, palette, descriptor.after === true);
        leaflet = new HaloPolyline(this.toLatLngs(descriptor.mapId, descriptor.points), lineHalo(descriptor.style, emphasis, palette), { ...interactive, ...pathOptions(applied), smoothFactor: 1 });
        break;
      }
      case 'outline':
        applied = outlineStyle(descriptor.kind, palette);
        leaflet = L.polyline(
          descriptor.lines.map((line) => this.toLatLngs(descriptor.mapId, line)),
          { renderer, interactive: false, ...pathOptions(applied), smoothFactor: 1 },
        );
        break;
      case 'frame':
        applied = frameStyle(descriptor.kind, descriptor.emphasis, palette, descriptor.filled, frameLook(descriptor));
        leaflet = new FrameRectangle(
          this.toBounds(descriptor.bounds),
          descriptor.hidden === true ? null : descriptor.label,
          frameLabelStyle(descriptor, palette),
          { renderer, interactive: false, ...pathOptions(applied) },
          descriptor.kind === 'inset' || descriptor.kind === 'card' ? 'above' : 'centre',
        );
        break;
      case 'art': {
        const pane = layer === 'relief' ? IMAGE_PANES.relief : IMAGE_PANES.art;
        leaflet = L.imageOverlay(descriptor.url, this.toBounds(descriptor.bounds), {
          pane: pane.name,
          opacity: descriptor.opacity,
          interactive: false,
          alt: '',
          className: pane.className,
        });
        break;
      }
      case 'connector': {
        applied = connectorStyle(descriptor.style, descriptor.emphasis, palette);
        const arc = this.connectorLatLngs(descriptor);
        leaflet = new ConnectorArc(arc.points, arc.mid, connectorGlyph(descriptor, palette), { ...interactive, ...pathOptions(applied), smoothFactor: 1 }, connectorHalo(descriptor.style, descriptor.emphasis, palette));
        break;
      }
      case 'area':
        applied = areaStyle(palette);
        leaflet = new AreaOutline(this.toLatLngs(descriptor.mapId, descriptor.ring), palette.labelHalo, { renderer, interactive: false, ...pathOptions(applied), smoothFactor: 1 });
        break;
      case 'label':
        // Labels are drawn by the labels canvas from the `labels` layer; in any other layer they are not drawn.
        return;
      case 'zone-fill': {
        applied = zoneFillStyle(descriptor.fill, palette);
        // The faction overlay's fills take the hover (their words) and a click (the zone); a tint takes neither.
        const hover = 'pattern' in descriptor.fill && descriptor.ref.kind === 'zone';
        const shape = new ZoneFillShape(
          descriptor.rings.map((ring) => this.toLatLngs(descriptor.mapId, ring)),
          { renderer, interactive: hover, bubblingMouseEvents: false, ...pathOptions(applied), smoothFactor: 1 },
        );
        if ('pattern' in descriptor.fill) shape.setPattern(this.hatchFor(descriptor.fill.pattern, palette.hatch));
        // The pattern on the zone's land only (§12.6; review PR-15, QA-15).
        shape.setLand(this.landOf(descriptor));
        leaflet = shape;
        break;
      }
      case 'tiles': {
        const tiles = new AtlasTiles(descriptor, {
          decoded: this.decodedFor(descriptor.id),
          fade: this.animate,
          maxZoom: this.maxZoom,
          ...(this.decodeImage === undefined ? {} : { decodeImage: this.decodeImage }),
        });
        tiles.onFirstView((first) => {
          this.onFirstView(tiles, first);
        });
        leaflet = tiles;
        break;
      }
    }
    state.drawn.set(descriptor.id, { descriptor, leaflet, applied });
    this.owners.set(leaflet, { layer, id: descriptor.id });
    state.group.addLayer(leaflet);
    if (descriptor.type === 'art' && leaflet instanceof L.ImageOverlay) this.clipImage(leaflet, descriptor.bounds, descriptor.clip);
    if (descriptor.type === 'tiles') this.syncSeaBackground();
  }

  /** A connector's arc and mid-arc point on the shown surface (map-atlas.md §8.5). */
  private connectorLatLngs(descriptor: ConnectorDescriptor): { readonly points: L.LatLng[]; readonly mid: L.LatLng } {
    const from = placedLatLng(this.translationOf(descriptor.from.mapId), descriptor.from.x, descriptor.from.y);
    const to = placedLatLng(this.translationOf(descriptor.to.mapId), descriptor.to.x, descriptor.to.y);
    const [midLat, midLng] = connectorMidpoint(from, to);
    return { points: connectorArc(from, to).map(([lat, lng]) => L.latLng(lat, lng)), mid: L.latLng(midLat, midLng) };
  }

  /** Clips an image to the part of it its descriptor shows (a CSS `clip-path`; none for the whole image). */
  private clipImage(overlay: L.ImageOverlay, bounds: WorldBounds, clip: WorldBounds | null | undefined): void {
    const element = overlay.getElement();
    if (element === undefined) return;
    const value = clipPathOf(bounds, clip);
    if (element.style.clipPath !== value) element.style.clipPath = value;
  }

  /**
   * Updates a drawn item in place, calling Leaflet only for what changed: its position or shape,
   * then its glyph or style. A descriptor whose label or ref alone changed (a step renumbered by an
   * insert elsewhere) costs no canvas work.
   */
  private update(layer: LayerId, entry: Entry, next: MapDescriptor): void {
    const leaflet = entry.leaflet;
    const previous = entry.descriptor;
    entry.descriptor = next;
    switch (next.type) {
      case 'marker':
      case 'aggregate': {
        const palette = this.palette;
        const before = pointOf(previous);
        const moved = before === null || !sameData(before, next.point);
        if (leaflet instanceof PinMarker && next.type === 'marker') {
          // The look is settled with the layer's stacks and mask (`refreshPins`, after the diff).
          const spec = this.pinSpecFor(layer, next);
          if (!sameData(spec, leaflet.spec)) leaflet.setSpec(spec, !moved);
          if (moved) leaflet.setLatLng(this.toLatLng(next.point));
          return;
        }
        if (!(leaflet instanceof GlyphMarker) || palette === null) return;
        const spec = glyphOf(next, palette);
        if (spec !== null && !sameData(spec, leaflet.spec)) leaflet.setSpec(spec, !moved);
        if (moved) leaflet.setLatLng(this.toLatLng(next.point));
        return;
      }
      case 'polyline':
        if (leaflet instanceof L.Polyline && (previous.type !== 'polyline' || !sameData(previous.points, next.points))) {
          leaflet.setLatLngs(this.toLatLngs(next.mapId, next.points));
        }
        break;
      case 'outline':
        if (leaflet instanceof L.Polyline && (previous.type !== 'outline' || !sameData(previous.lines, next.lines))) {
          leaflet.setLatLngs(next.lines.map((line) => this.toLatLngs(next.mapId, line)));
        }
        break;
      case 'frame':
        if (leaflet instanceof FrameRectangle && (previous.type !== 'frame' || !sameData(previous.bounds, next.bounds))) {
          leaflet.setBounds(this.toBounds(next.bounds));
        }
        break;
      case 'tiles':
        // A changed band is re-created (apply); nothing to update in place.
        return;
      case 'label':
        return;
      case 'area':
        if (leaflet instanceof AreaOutline && (previous.type !== 'area' || !sameData(previous.ring, next.ring))) {
          leaflet.setLatLngs(this.toLatLngs(next.mapId, next.ring));
        }
        break;
      case 'zone-fill':
        if (leaflet instanceof ZoneFillShape && (previous.type !== 'zone-fill' || !sameData(previous.rings, next.rings))) {
          leaflet.setLatLngs(next.rings.map((ring) => this.toLatLngs(next.mapId, ring)));
        }
        if (leaflet instanceof ZoneFillShape && (previous.type !== 'zone-fill' || previous.land !== next.land)) leaflet.setLand(this.landOf(next));
        break;
      case 'art':
        if (leaflet instanceof L.ImageOverlay) {
          const old = previous.type === 'art' ? previous : null;
          if (old?.url !== next.url) leaflet.setUrl(next.url);
          if (old === null || !sameData(old.bounds, next.bounds)) leaflet.setBounds(this.toBounds(next.bounds));
          if (old?.opacity !== next.opacity) leaflet.setOpacity(next.opacity);
          if (old === null || !sameData(old.bounds, next.bounds) || !sameData(old.clip ?? null, next.clip ?? null)) this.clipImage(leaflet, next.bounds, next.clip);
        }
        return;
      case 'connector':
        if (leaflet instanceof ConnectorArc && (previous.type !== 'connector' || !sameData(previous.from, next.from) || !sameData(previous.to, next.to))) {
          const arc = this.connectorLatLngs(next);
          leaflet.setArc(arc.points, arc.mid);
        }
        break;
    }
    this.restyle(layer, entry);
  }

  /** Applies the item's current glyph or style (palette, emphasis, highlight) when it differs from what is drawn. */
  private restyle(layer: LayerId, entry: Entry): void {
    const palette = this.palette;
    if (palette === null) return;
    const descriptor = entry.descriptor;
    const leaflet = entry.leaflet;
    switch (descriptor.type) {
      case 'marker':
      case 'aggregate': {
        // Pins take their look from `refreshPins` (their palette is the pin palette's, `refreshPinPalette`).
        if (leaflet instanceof PinMarker) return;
        const spec = glyphOf(descriptor, palette);
        if (leaflet instanceof GlyphMarker && spec !== null && !sameData(spec, leaflet.spec)) leaflet.setSpec(spec);
        return;
      }
      case 'polyline': {
        const emphasis = this.emphasisOf(layer, descriptor);
        const style = polylineStyle(descriptor.style, emphasis, palette, descriptor.after === true);
        if (leaflet instanceof HaloPolyline) leaflet.setHalo(lineHalo(descriptor.style, emphasis, palette));
        if (leaflet instanceof L.Polyline && !sameData(style, entry.applied)) {
          leaflet.setStyle(pathOptions(style));
          entry.applied = style;
        }
        return;
      }
      case 'outline': {
        const style = outlineStyle(descriptor.kind, palette);
        if (leaflet instanceof L.Polyline && !sameData(style, entry.applied)) {
          leaflet.setStyle(pathOptions(style));
          entry.applied = style;
        }
        return;
      }
      case 'frame': {
        if (!(leaflet instanceof FrameRectangle)) return;
        const style = frameStyle(descriptor.kind, descriptor.emphasis, palette, descriptor.filled, frameLook(descriptor));
        if (!sameData(style, entry.applied)) {
          leaflet.setStyle(pathOptions(style));
          entry.applied = style;
        }
        leaflet.setLabel(descriptor.hidden === true ? null : descriptor.label, frameLabelStyle(descriptor, palette));
        return;
      }
      case 'art':
      case 'tiles':
      case 'label':
        return;
      case 'zone-fill': {
        if (!(leaflet instanceof ZoneFillShape)) return;
        const style = zoneFillStyle(descriptor.fill, palette);
        if ('pattern' in descriptor.fill) leaflet.setPattern(this.hatchFor(descriptor.fill.pattern, palette.hatch));
        if (!sameData(style, entry.applied)) {
          leaflet.setStyle(pathOptions(style));
          entry.applied = style;
        }
        return;
      }
      case 'area': {
        if (!(leaflet instanceof AreaOutline)) return;
        const style = areaStyle(palette);
        leaflet.setHalo(palette.labelHalo);
        if (!sameData(style, entry.applied)) {
          leaflet.setStyle(pathOptions(style));
          entry.applied = style;
        }
        return;
      }
      case 'connector': {
        if (!(leaflet instanceof ConnectorArc)) return;
        const style = connectorStyle(descriptor.style, descriptor.emphasis, palette);
        const glyph = connectorGlyph(descriptor, palette);
        if (!sameData(glyph, leaflet.glyph)) leaflet.setGlyph(glyph);
        leaflet.setHalo(connectorHalo(descriptor.style, descriptor.emphasis, palette));
        if (!sameData(style, entry.applied)) {
          leaflet.setStyle(pathOptions(style));
          entry.applied = style;
        }
        return;
      }
    }
  }

  /** The faction overlay's patterns, one per pattern and hatch colour (a palette change makes new ones). */
  private readonly hatches = new Map<string, CanvasPattern | null>();

  private hatchFor(pattern: 'alliance' | 'horde' | 'both' | 'none' | 'sanctuary', colour: string): CanvasPattern | null {
    const key = `${pattern}|${colour}`;
    if (this.hatches.has(key)) return this.hatches.get(key) ?? null;
    const doc = this.container?.ownerDocument ?? null;
    let made: CanvasPattern | null;
    try {
      made = doc === null ? null : hatchPattern(doc, pattern, colour);
    } catch {
      made = null;
    }
    this.hatches.set(key, made);
    return made;
  }

  // ===========================================================================================
  // Pins (map-presentation.md §25.2; step MP.4a)

  /** The canvas backing store's pixel ratio, which the pin bitmaps are drawn at: the device's, capped at 2, with the smooth wheel; Leaflet's own 2 on any ratio above 1 without it. */
  private canvasRatio(): number {
    const dpr = this.container?.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    if (this.smooth) return Math.min(MAX_PIXEL_RATIO, Math.max(1, dpr));
    return dpr > 1 ? 2 : 1;
  }

  /** A canvas for a pin bitmap: an `OffscreenCanvas` where one gives a 2D context, else a `<canvas>`; null without either. */
  private createCanvas(width: number, height: number): BitmapCanvas | null {
    const scope = this.container?.ownerDocument.defaultView ?? null;
    const Offscreen = (scope as { OffscreenCanvas?: new (w: number, h: number) => BitmapCanvas } | null)?.OffscreenCanvas;
    if (typeof Offscreen === 'function') {
      const offscreen = new Offscreen(width, height);
      if (offscreen.getContext('2d') !== null) return offscreen;
    }
    const doc = this.container?.ownerDocument ?? null;
    if (doc === null) return null;
    const canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  /** A glyph's `Path2D`, made once per path string; null where there is none (the glyph is skipped). */
  private glyphPath(d: string): unknown {
    const kept = this.glyphPaths.get(d);
    if (kept !== undefined) return kept;
    const scope = this.container?.ownerDocument.defaultView ?? null;
    const Path = (scope as { Path2D?: new (d: string) => unknown } | null)?.Path2D;
    const made = Path === undefined ? null : new Path(d);
    this.glyphPaths.set(d, made);
    return made;
  }

  /** The pin palette from the container's tokens, under forced colours from the probe (§25.2.9). */
  private readPinPalette(): PinPalette {
    const container = this.container;
    const palette = this.palette;
    const view = container?.ownerDocument.defaultView ?? null;
    if (container === null || view === null || palette === null) return DEFAULT_PIN_PALETTE;
    const style = view.getComputedStyle(container);
    const normal = pinPaletteFrom((property) => style.getPropertyValue(property), palette.route, palette.labelHalo, palette.font);
    const probe = this.probe;
    if (this.forcedQuery?.matches !== true || probe === null) return normal;
    const system = view.getComputedStyle(probe);
    return forcedPinPalette(normal, { canvas: system.backgroundColor, canvasText: system.color, highlight: system.borderTopColor });
  }

  /** Re-reads the pin palette (a theme, style or forced-colours change) and redraws the pins when it changed; the bitmaps are keyed by it. */
  private refreshPinPalette(): void {
    const next = this.readPinPalette();
    if (next.key === this.pinPalette.key) return;
    this.pinPalette = next;
    for (const layer of PIN_LAYERS) {
      for (const entry of this.layers[layer].drawn.values()) if (entry.leaflet instanceof PinMarker) entry.leaflet.redraw();
    }
    for (const overlay of this.overlays.values()) if (overlay.path instanceof PinMarker) overlay.path.redraw();
  }

  /** A pin's look at the drawn size, alone (no stack, no mask): `refreshPins` settles the rest. */
  private pinSpecFor(layer: LayerId, descriptor: MarkerDescriptor, state: PinState = 'normal'): PinSpec {
    return pinSpecOf(layer, descriptor, { diameter: this.pinDiameter, state });
  }

  /** A point's pixel position at a zoom in the surface's plane (pan-invariant: Leaflet's layer pixels up to a translation). */
  private pixelOf(point: WorldPoint, zoom: number): { readonly x: number; readonly y: number } {
    const [lat, lng] = placedLatLng(this.translationOf(point.mapId), point.x, point.y);
    const scale = 2 ** zoom;
    return { x: lng * scale, y: -lat * scale };
  }

  /**
   * A pin layer's draw order (§25.2.6): items without a point first as they came, then the pins by
   * screen y (north first), so southern pins overlap northern ones; ties by id.
   */
  private pinOrder(order: readonly MapDescriptor[]): readonly string[] {
    const flat = order.filter((descriptor) => pointOf(descriptor) === null).map((descriptor) => descriptor.id);
    const pointed = order
      .flatMap((descriptor) => {
        const point = pointOf(descriptor);
        return point === null ? [] : [{ id: descriptor.id, y: -placedLatLng(this.translationOf(point.mapId), point.x, point.y)[0] }];
      })
      .sort((a, b) => a.y - b.y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((entry) => entry.id);
    return [...flat, ...pointed];
  }

  /** Whether a threshold's pins are drawn at this scale, with the bands' hysteresis (`aboveThreshold`). */
  private thresholdShown(key: string, px: number, threshold: number): boolean {
    const shown = aboveThreshold(this.pinsShown.get(key) ?? null, px, threshold);
    this.pinsShown.set(key, shown);
    return shown;
  }

  /** Whether the search filter lets an item through: one of its places or quests was found. */
  private matchesSearch(descriptor: MapDescriptor): boolean {
    const { subjects, quests, places } = this.maskSets;
    if (subjects === null && quests === null) return true;
    if (places?.has(descriptor.id) === true) return true;
    for (const ref of refsOf(descriptor)) {
      if (ref.kind !== 'spawn') continue;
      if (subjects?.has(subjectKeyOf(ref.subject)) === true) return true;
      if (quests !== null && ref.questIds.some((id) => quests.has(id))) return true;
    }
    return false;
  }

  /** Whether the mask hides an item: its category, or a search that did not find it. */
  private masked(descriptor: MapDescriptor): boolean {
    const category = descriptor.type === 'marker' || descriptor.type === 'aggregate' || descriptor.type === 'polyline' || descriptor.type === 'connector' ? descriptor.category : undefined;
    if (category !== undefined && this.maskSets.hidden.has(category)) return true;
    return !this.matchesSearch(descriptor);
  }

  /** Whether a cluster member is drawn: its category shown, and found by the search when there is one. */
  private memberShown(member: NonNullable<MarkerDescriptor['cluster']>['members'][number]): boolean {
    const { hidden, subjects, quests } = this.maskSets;
    if (hidden.has(member.category)) return false;
    if (subjects === null && quests === null) return true;
    return quests?.has(member.questId) === true || member.subjects.some((subject) => subjects?.has(subject) === true);
  }

  /**
   * Settles the pins of `layers` for the current zoom and mask (§25.2.4, §25.2.5, §25.3.4): their
   * size, whether their band draws them yet, the mask (a cluster counts only its members still
   * drawn), the stacks by spatial hash at the zone and close bands, and each one's look. `redraw`
   * false at a zoom's settle, which redraws everything next. The hit index is rebuilt off the frame.
   */
  private refreshPins(layers: readonly LayerId[], redraw: boolean): void {
    const map = this.map;
    if (map === null) return;
    const zoom = map.getZoom();
    const px = pxPerYardAt(zoom);
    const diameter = pinDiameterFor(px);
    this.pinDiameter = diameter;
    const band = nextBand(this.band, px);
    const stacking = band === 'zone' || band === 'close';
    const touched = new Set<string>(layers);
    const layerOfKey = (key: string): string => key.slice(0, key.indexOf('/'));
    const stacks = new Map([...this.stacks].filter(([key]) => !touched.has(layerOfKey(key))));
    const merged = new Set([...this.mergedAway].filter((key) => !touched.has(layerOfKey(key))));
    const vendors = this.thresholdShown('vendors', px, VENDORS_FROM_PX);
    const searching = this.maskSets.subjects !== null || this.maskSets.quests !== null;
    for (const layer of layers) {
      const state = this.layers[layer];
      const threshold = PIN_FROM_PX[layer];
      const layerShown = threshold === undefined ? true : this.thresholdShown(layer, px, threshold);
      const visible: VisiblePin[] = [];
      for (const id of state.order) {
        const entry = state.drawn.get(id);
        if (entry === undefined) continue;
        const descriptor = entry.descriptor;
        const leaflet = entry.leaflet;
        if (leaflet instanceof GlyphMarker) {
          leaflet.setHidden(this.masked(descriptor), redraw);
          continue;
        }
        if (leaflet instanceof AreaOutline) {
          leaflet.setHidden(this.maskSets.hidden.has('objectives') || searching, redraw);
          continue;
        }
        // A pin layer's lines with a drawer row (the transport rides with Transport stops, PR-11): hidden with it.
        if ((leaflet instanceof HaloPolyline || leaflet instanceof ConnectorArc) && (descriptor.type === 'polyline' || descriptor.type === 'connector') && descriptor.category !== undefined) {
          leaflet.setHidden(this.maskSets.hidden.has(descriptor.category), redraw);
          continue;
        }
        if (!(leaflet instanceof PinMarker) || descriptor.type !== 'marker') continue;
        let hidden = !layerShown || (descriptor.category === 'vendors' && !vendors);
        let members: readonly (MarkerMark | null)[] | undefined;
        let count: number | undefined;
        const cluster = descriptor.cluster;
        if (cluster !== undefined) {
          const shown = cluster.members.filter((member) => this.memberShown(member));
          hidden = hidden || shown.length === 0;
          if (shown.length !== cluster.members.length) {
            members = shown.map((member) => member.mark);
            count = shown.length;
          }
        } else hidden = hidden || this.masked(descriptor);
        if (hidden) {
          leaflet.setHidden(true, redraw);
          continue;
        }
        visible.push({ id, leaflet, descriptor, members, count });
      }
      // Stacks (§25.2.5): pins of one kind whose heads overlap by more than about 60 %.
      const groups: ReadonlyMap<string, readonly string[]> =
        stacking && visible.length > 1
          ? stackPins(
              [...visible]
                .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
                .map((pin) => {
                  const p = this.pixelOf(pin.descriptor.point, zoom);
                  return { id: pin.id, kind: pin.leaflet.spec.glyph, x: p.x, y: p.y, diameter: pin.leaflet.spec.diameter };
                }),
            )
          : new Map<string, readonly string[]>();
      const memberOf = new Set<string>();
      for (const [leader, ids] of groups) for (const id of ids) if (id !== leader) memberOf.add(id);
      const byId = new Map(visible.map((pin) => [pin.id, pin]));
      for (const pin of visible) {
        const key = pinKey(layer, pin.id);
        if (memberOf.has(pin.id)) {
          pin.leaflet.setHidden(true, redraw);
          merged.add(key);
          continue;
        }
        let members = pin.members;
        let count = pin.count;
        const group = groups.get(pin.id);
        if (group !== undefined) {
          const parts = group.flatMap((id) => {
            const other = byId.get(id);
            return other === undefined ? [] : [other];
          });
          members = parts.flatMap((other) => other.members ?? other.descriptor.cluster?.members.map((member) => member.mark) ?? [other.descriptor.mark ?? null]);
          count = parts.reduce((sum, other) => sum + (other.count ?? other.descriptor.cluster?.members.length ?? other.descriptor.count), 0);
          stacks.set(key, group.map((id) => pinKey(layer, id)));
        }
        const spec = pinSpecOf(layer, pin.descriptor, { diameter, ...(members === undefined ? {} : { members }), ...(count === undefined ? {} : { count }) });
        pin.leaflet.setHidden(false, redraw);
        if (!sameData(spec, pin.leaflet.spec)) pin.leaflet.setSpec(spec, redraw);
      }
    }
    this.stacks = stacks;
    this.mergedAway = merged;
    this.hitIndex = null;
    this.scheduleHitBuild();
    if (redraw) {
      this.syncHighlight();
      this.labels?.requestDraw();
    }
  }

  /** Builds the hit index in idle time after a settle (§25.2.7), unless a pointer event builds it first. */
  private scheduleHitBuild(): void {
    this.cancelHitBuild?.();
    this.cancelHitBuild = null;
    const view = this.container?.ownerDocument.defaultView ?? null;
    if (view === null) return;
    const build = (): void => {
      this.cancelHitBuild = null;
      if (this.map !== null) this.ensureHitIndex();
    };
    const idle = view as unknown as { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (handle: number) => void };
    const request = idle.requestIdleCallback;
    const cancel = idle.cancelIdleCallback;
    if (typeof request === 'function' && typeof cancel === 'function') {
      const handle = request.call(view, build, { timeout: 500 });
      this.cancelHitBuild = () => {
        cancel.call(view, handle);
      };
      return;
    }
    const handle = view.setTimeout(build, 50);
    this.cancelHitBuild = () => {
      view.clearTimeout(handle);
    };
  }

  /** The hit index over the pins drawn now, in layer pixels (§25.2.7), built when first needed after a change. */
  private ensureHitIndex(): PinHitIndex {
    const kept = this.hitIndex;
    if (kept !== null) return kept;
    const targets: PinTarget[] = [];
    for (const layer of PIN_LAYERS) {
      const state = this.layers[layer];
      if (!state.visible) continue;
      for (const [id, entry] of state.drawn) {
        const leaflet = entry.leaflet;
        if (!(leaflet instanceof PinMarker) || leaflet.frlHidden) continue;
        const point = leaflet.layerPoint;
        if (point === null) continue;
        const key = pinKey(layer, id);
        targets.push({ id: key, x: point.x, y: point.y, diameter: leaflet.spec.diameter, list: this.stacks.has(key) });
      }
    }
    const index = new PinHitIndex(targets);
    this.hitIndex = index;
    return index;
  }

  /** Every ref a pin stands for: a stack leader's members' too. */
  private pinRefs(key: string): readonly MapRef[] {
    const members = this.stacks.get(key) ?? [key];
    return unionRefs(
      members.flatMap((member) => {
        const slash = member.indexOf('/');
        const descriptor = this.layers[member.slice(0, slash) as LayerId].drawn.get(member.slice(slash + 1))?.descriptor;
        return descriptor === undefined ? [] : [refsOf(descriptor)];
      }),
    );
  }

  /**
   * The pin under a layer point (§25.2.7): the head centre nearest the pointer among the pins whose
   * targets hold it; a tie within 3 px, or a stack, is a list (every ref in `refs`). Null for none.
   */
  private pinHitAt(point: L.Point): Omit<MapHit, 'segment'> | null {
    const found = this.ensureHitIndex().hit(point.x, point.y);
    if (found === null) return null;
    const slash = found.nearest.indexOf('/');
    const layer = found.nearest.slice(0, slash) as LayerId;
    const id = found.nearest.slice(slash + 1);
    const refs = found.ties.length > 1 ? unionRefs(found.ties.map((key) => this.pinRefs(key))) : this.pinRefs(found.nearest);
    const [ref] = refs;
    if (ref === undefined) return null;
    return { layer, id, ref, refs };
  }

  /** A pin's hover text: its own label, or a stack's or a tie's combined ("6 here: a; b; c and 3 more"). */
  private pinLabel(hit: Omit<MapHit, 'segment'>): string | null {
    const descriptor = this.layers[hit.layer].drawn.get(hit.id)?.descriptor;
    if (descriptor === undefined) return null;
    if (hit.refs.length <= refsOf(descriptor).length) return labelOf(descriptor, this.labelProvider);
    const texts: string[] = [];
    for (const ref of hit.refs) {
      const text = this.labelProvider?.(ref) ?? this.ownLabelOf(ref);
      if (text !== null && text !== '') texts.push(text);
    }
    return combineLabels(texts, hit.refs.length);
  }

  /** The label a ref's descriptor carries for it, in the pin layers. */
  private ownLabelOf(ref: MapRef): string | null {
    for (const layer of PIN_LAYERS) {
      for (const entry of this.layers[layer].drawn.values()) {
        const descriptor = entry.descriptor;
        if (descriptor.type !== 'marker') continue;
        const index = descriptor.refs.indexOf(ref);
        if (index >= 0) return descriptor.labels[index] ?? null;
      }
    }
    return null;
  }

  setMask(mask: MapMask): void {
    if (sameData(mask, this.mask)) return;
    this.mask = mask;
    this.maskSets = {
      hidden: new Set(mask.hidden),
      subjects: mask.only === null ? null : new Set(mask.only.subjects),
      quests: mask.only === null ? null : new Set(mask.only.quests),
      places: mask.only === null ? null : new Set(mask.only.places ?? []),
    };
    this.closeTooltip();
    this.refreshPins(PIN_LAYERS, true);
  }

  selectPins(target: HighlightTarget | null): void {
    const next = target === null || target.ids.length === 0 ? null : target;
    if (sameData(next, this.selectedPins)) return;
    this.selectedPins = next;
    this.syncHighlight();
  }

  zoomBy(delta: number): void {
    const map = this.map;
    if (map === null || !Number.isFinite(delta) || delta === 0) return;
    if (delta > 0) map.zoomIn(delta);
    else map.zoomOut(-delta);
  }

  /** What the pins drew last (`MapRenderStats.pins`). */
  private pinRenderStats(): PinRenderStats {
    let drawn = 0;
    let hidden = 0;
    let clusters = 0;
    for (const layer of PIN_LAYERS) {
      const state = this.layers[layer];
      for (const [id, entry] of state.drawn) {
        const leaflet = entry.leaflet;
        if (!(leaflet instanceof PinMarker)) continue;
        if (leaflet.frlHidden || !state.visible) {
          if (!this.mergedAway.has(pinKey(layer, id))) hidden += 1;
          continue;
        }
        drawn += 1;
        if (entry.descriptor.type === 'marker' && entry.descriptor.cluster !== undefined) clusters += 1;
      }
    }
    return { drawn, hidden, merged: this.mergedAway.size, stacks: this.stacks.size, clusters, diameter: this.pinDiameter, bitmaps: this.pinBitmaps?.size ?? 0 };
  }

  // ===========================================================================================
  // Highlight overlays

  /**
   * Brings the overlays in line with `highlighted` and `selectedPins`, drawn on top of the
   * `selection` layer (created last, so above every layer's paths): one strong copy of each
   * highlighted marker or aggregate of a visible layer, a pin's copy with the hover keyline
   * (map-presentation.md §25.2.3: 2.5 px), and each selected pin drawn selected (1.15× with the ring
   * on its halo). Lines are restyled in place instead (`highlight`).
   */
  private syncHighlight(): void {
    const wanted = new Map<string, { readonly descriptor: MapDescriptor; readonly layer: LayerId; readonly state: PinState }>();
    const target = this.highlighted;
    if (target !== null && this.layers[target.layer].visible) {
      for (const id of target.ids) {
        const entry = this.layers[target.layer].drawn.get(id);
        const descriptor = entry?.descriptor;
        if (descriptor?.type !== 'marker' && descriptor?.type !== 'aggregate') continue;
        if (entry?.leaflet instanceof PinMarker && entry.leaflet.frlHidden) continue;
        wanted.set(`${target.layer}/${id}`, { descriptor, layer: target.layer, state: 'hover' });
      }
    }
    const selected = this.selectedPins;
    if (selected !== null && this.layers[selected.layer].visible) {
      for (const id of selected.ids) {
        const entry = this.layers[selected.layer].drawn.get(id);
        if (entry?.leaflet instanceof PinMarker && entry.descriptor.type === 'marker') {
          wanted.set(`selected:${selected.layer}/${id}`, { descriptor: entry.descriptor, layer: selected.layer, state: 'selected' });
        }
      }
    }
    const group = this.layers.selection.group;
    for (const [key, overlay] of this.overlays) {
      if (wanted.has(key)) continue;
      group?.removeLayer(overlay.path);
      this.overlays.delete(key);
    }
    const palette = this.palette;
    const renderer = this.canvas;
    if (group === null || palette === null || renderer === null) return;
    for (const [key, want] of wanted) {
      const existing = this.overlays.get(key);
      if (existing !== undefined) {
        this.refreshOverlay(existing, want.descriptor);
        continue;
      }
      const point = pointOf(want.descriptor);
      if (point === null) continue;
      const source = this.layers[want.layer].drawn.get(want.descriptor.id)?.leaflet;
      let path: GlyphMarker | PinMarker;
      if (source instanceof PinMarker) {
        path = new PinMarker(this.toLatLng(point), { ...source.spec, state: want.state }, this.pinDrawing, { renderer, interactive: false });
      } else {
        const spec = glyphOf(want.descriptor, palette, 'strong');
        if (spec === null) continue;
        path = new GlyphMarker(this.toLatLng(point), spec, { renderer, interactive: false });
      }
      group.addLayer(path);
      this.overlays.set(key, { source: want.descriptor, layer: want.layer, path, state: want.state });
    }
  }

  private refreshOverlay(overlay: Overlay, descriptor: MapDescriptor): void {
    const palette = this.palette;
    const point = pointOf(descriptor);
    if (palette === null || point === null) return;
    const before = pointOf(overlay.source);
    overlay.source = descriptor;
    const moved = before === null || !sameData(before, point);
    const path = overlay.path;
    if (path instanceof PinMarker) {
      const source = this.layers[overlay.layer].drawn.get(descriptor.id)?.leaflet;
      const spec = source instanceof PinMarker ? { ...source.spec, state: overlay.state } : path.spec;
      if (!sameData(spec, path.spec)) path.setSpec(spec, !moved);
    } else {
      const spec = glyphOf(descriptor, palette, 'strong');
      if (spec !== null && !sameData(spec, path.spec)) path.setSpec(spec, !moved);
    }
    if (moved) path.setLatLng(this.toLatLng(point));
  }

  // ===========================================================================================
  // The labels canvas (map-presentation.md §5.5, §13)

  /** A world point's layer point on the shown surface (the labels canvas draws in layer points). */
  private layerPointOf(point: WorldPoint): L.Point | null {
    return this.map?.latLngToLayerPoint(this.toLatLng(point)) ?? null;
  }

  /**
   * Boxes the labels keep clear of (§13.2): `hard`, the place pins, focused marks, and the active and
   * selected step beads; `soft`, every other drawn pin's head and pills (review PR-16), which a label
   * avoids where it has room and covers only where it has none (`placeLabels`), so no zone name is
   * lost to them. With `numbers`, the step numbers' obstacles: the pins' pills alone (as `hard`),
   * never the pin at their own step, which a number sits beside.
   */
  private labelObstacles(numbers = false): { readonly hard: Box[]; readonly soft: Box[] } {
    const hard: Box[] = [];
    const soft: Box[] = [];
    const add = (descriptor: MapDescriptor, leaflet: DrawnLayer): void => {
      if (descriptor.type !== 'marker' && descriptor.type !== 'aggregate') return;
      const p = this.layerPointOf(descriptor.point);
      if (p === null) return;
      if (leaflet instanceof PinMarker) {
        if (leaflet.frlHidden) return;
        // A pin's own extent: its head and point, above the item's point (§25.2.1).
        const e = specExtent(leaflet.spec);
        hard.push({ x0: p.x - e.left, y0: p.y - e.up, x1: p.x + e.right, y1: p.y + e.down });
        return;
      }
      const r = leaflet instanceof GlyphMarker ? glyphExtent(leaflet.spec) : 8;
      hard.push({ x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r });
    };
    const addPin = (descriptor: MapDescriptor, leaflet: DrawnLayer): void => {
      if (descriptor.type !== 'marker' || !(leaflet instanceof PinMarker) || leaflet.frlHidden) return;
      const p = this.layerPointOf(descriptor.point);
      if (p === null) return;
      for (const b of pinBoxes(leaflet.spec.diameter, leaflet.spec, !numbers)) (numbers ? hard : soft).push({ x0: p.x + b.x0, y0: p.y + b.y0, x1: p.x + b.x1, y1: p.y + b.y1 });
    };
    for (const layer of PLACE_LAYERS) {
      const state = this.layers[layer];
      if (state.visible) for (const entry of state.drawn.values()) (numbers ? addPin : add)(entry.descriptor, entry.leaflet);
    }
    for (const layer of SPAWN_MARK_LAYERS) {
      const state = this.layers[layer];
      if (!state.visible) continue;
      for (const entry of state.drawn.values()) {
        if (!numbers && entry.descriptor.type === 'marker' && entry.descriptor.emphasis === 'strong') add(entry.descriptor, entry.leaflet);
        else addPin(entry.descriptor, entry.leaflet);
      }
    }
    const selection = this.layers.selection;
    if (!numbers && selection.visible) for (const entry of selection.drawn.values()) add(entry.descriptor, entry.leaflet);
    return { hard, soft };
  }

  /**
   * Draws the labels canvas (`LabelsRenderer`): the labels in range, placed by static priority
   * round the obstacles; the objective outlines' step numbers; and the step numbers beside the beads
   * in view at the zone and close bands. Records what it drew for `renderStats().labels`.
   */
  private drawLabels(ctx: CanvasRenderingContext2D, area: Box): void {
    const map = this.map;
    const palette = this.palette;
    if (map === null || palette === null) return;
    const px = pxPerYardAt(map.getZoom());
    const band = this.band ?? nextBand(null, px);
    const ink: LabelInk = { ink: palette.labelInk, halo: palette.labelHalo, font: palette.font };
    // The zone cards' difficulty twin (§12.5): the difficulty tokens, on the pins' well with their light keyline.
    const pins = this.pinPalette;
    const chip: ChipInk = { well: pins.body, pipOff: pins.pipOff, difficulty: pins.difficulty, keyline: pins.forced ? pins.keyline : pins.glyph, font: palette.font };
    const measure: Measure = (text, font) => {
      ctx.font = font;
      return ctx.measureText(text).width;
    };
    // Labels: in range (with hysteresis), anchored in view, placed by priority.
    let placed = 0;
    let leaders = 0;
    let skipped: readonly string[] = [];
    const shown = new Map<string, boolean>();
    if (this.layers.labels.visible && this.labelItems.length > 0) {
      const byId = new Map<string, LabelDescriptor>();
      const inputs: PlacementInput[] = [];
      const legible = this.legiblePlaces(map.getZoom());
      const factions = this.factionWords();
      const wordsOf = (label: LabelDescriptor): string | null => (label.kind === 'zone' && label.ref.kind === 'zone' ? (factions.get(label.ref.uiMapId) ?? null) : null);
      for (const label of this.labelItems) {
        const inRange = labelInRange(label, px, this.labelShown.get(label.id) ?? null);
        shown.set(label.id, inRange);
        if (!inRange) continue;
        // The base map speaks first where it can be read (§13.5; review PR-12): a place its painting names legibly is not named again.
        if (label.kind === 'place' && label.uiMapId !== undefined && legible.has(label.uiMapId)) continue;
        const p = this.layerPointOf(label.point);
        if (p === null || p.x < area.x0 || p.x > area.x1 || p.y < area.y0 || p.y > area.y1) continue;
        byId.set(label.id, label);
        inputs.push({ id: label.id, name: label.text, priority: label.priority, x: p.x, y: p.y, forms: labelForms(label, px, measure, palette.font, wordsOf(label)) });
      }
      const obstacles = this.labelObstacles();
      const result = placeLabels(inputs, obstacles.hard, area, obstacles.soft);
      ctx.save();
      for (const entry of result.placed) {
        const label = byId.get(entry.id);
        if (label !== undefined) drawPlacedLabel(ctx, label, entry, ink, measure, chip, wordsOf(label));
      }
      ctx.restore();
      placed = result.placed.length;
      leaders = result.leaders;
      skipped = result.skipped;
    }
    this.labelShown = shown;
    // Objective outlines: the number of the step that completes them, above the ring.
    const provider = this.stepNumbers;
    if (provider !== null) {
      ctx.save();
      for (const layer of CANVAS_LAYERS) {
        const state = this.layers[layer];
        if (!state.visible) continue;
        for (const entry of state.drawn.values()) {
          const descriptor = entry.descriptor;
          if (descriptor.type === 'area') this.drawAreaNumber(ctx, descriptor, provider, ink);
        }
      }
      ctx.restore();
    }
    // Step numbers beside the beads (§13.6): the zone and close bands only.
    let numbers = 0;
    let numbersSkipped = 0;
    const steps = this.layers['route-steps'];
    if (provider !== null && steps.visible && (band === 'zone' || band === 'close')) {
      const active = provider.activeStep();
      const selected = new Set<string>();
      for (const entry of this.layers.selection.drawn.values()) {
        const descriptor = entry.descriptor;
        if (descriptor.type === 'marker' && descriptor.kind === 'step' && descriptor.ref.kind === 'step') selected.add(descriptor.ref.stepId);
      }
      const beads: BeadInput[] = [];
      for (const entry of steps.drawn.values()) {
        const descriptor = entry.descriptor;
        // A stack carries its count, never a number that could read as a step (§13.6).
        if (descriptor.type !== 'marker' || descriptor.kind !== 'step' || descriptor.count !== 1 || descriptor.ref.kind !== 'step') continue;
        const p = this.layerPointOf(descriptor.point);
        if (p === null || p.x < area.x0 || p.x > area.x1 || p.y < area.y0 || p.y > area.y1) continue;
        const stepId = descriptor.ref.stepId;
        const number = provider.stepNumber(stepId);
        if (number === null) continue;
        beads.push({ stepId, x: p.x, y: p.y, number, rank: stepId === active ? 0 : selected.has(stepId) ? 1 : 2 });
      }
      // The numbers keep clear of the pins' heads and pills (review PR-16), moving round their bead first.
      const result = placeStepNumbers(beads, { obstacles: this.labelObstacles(true).hard });
      ctx.save();
      drawStepNumbers(ctx, result.drawn, ink);
      ctx.restore();
      numbers = result.drawn.length;
      numbersSkipped = result.skipped;
    }
    this.labelStats = { band, placed, leaders, skipped, stepNumbers: numbers, stepNumbersSkipped: numbersSkipped, draws: this.labels?.draws ?? 0 };
  }

  /** Each zone's faction words while the overlay draws it (§12.6; review PR-15): for its card's third line. */
  private factionWords(): ReadonlyMap<UiMapId, string> {
    const fills = this.layers['zone-fill'];
    const out = new Map<UiMapId, string>();
    if (!fills.visible) return out;
    for (const entry of fills.drawn.values()) {
      const descriptor = entry.descriptor;
      if (descriptor.type === 'zone-fill' && 'pattern' in descriptor.fill && descriptor.words !== undefined && descriptor.ref.kind === 'zone') out.set(descriptor.ref.uiMapId, descriptor.words);
    }
    return out;
  }

  /** A zone fill's land rings on the shown surface: its coastline's rings that meet it (`ZoneFillDescriptor.land`, `landRingsNear`), or null for none. */
  private landOf(descriptor: ZoneFillDescriptor): L.LatLng[][] | null {
    const land = descriptor.land;
    return land === undefined ? null : landRingsNear(land, descriptor.rings.flat()).map((ring) => this.toLatLngs(descriptor.mapId, ring));
  }

  /**
   * The zones whose painted place names are legible now (`baseMapLabelsOf`, map-presentation.md
   * §13.5): the painted band shown, its first view in, no band held under it (a style change still
   * fading), and the art layer visible; none otherwise (the minimap has no names).
   */
  private legiblePlaces(zoom: number): ReadonlySet<UiMapId> {
    const art = this.layers.art;
    if (!art.visible || this.held !== null) return NO_UI_MAPS;
    for (const entry of art.drawn.values()) {
      if (entry.descriptor.type !== 'tiles' || !(entry.leaflet instanceof AtlasTiles) || entry.leaflet.firstView !== 'ready') continue;
      const places = baseMapLabelsOf(entry.descriptor, zoom, { fullOpacity: true }).places;
      return places.length === 0 ? NO_UI_MAPS : new Set(places);
    }
    return NO_UI_MAPS;
  }

  /** An objective outline's completing step number ("t 22" for a turn-in), centred above the ring's top. */
  private drawAreaNumber(ctx: CanvasRenderingContext2D, area: AreaDescriptor, provider: MapStepNumbers, ink: LabelInk): void {
    if (area.labelStep === null) return;
    const number = provider.stepNumber(area.labelStep);
    if (number === null) return;
    let top: L.Point | null = null;
    let left = Infinity;
    let right = -Infinity;
    for (const point of area.ring) {
      const p = this.layerPointOf(point);
      if (p === null) continue;
      left = Math.min(left, p.x);
      right = Math.max(right, p.x);
      if (top === null || p.y < top.y) top = p;
    }
    if (top === null) return;
    // A turn-in that carries the objectives' work (D-040) is marked "t 22" (map-presentation.md §7.4).
    const text = area.labelTurnIn === true ? `t ${String(number)}` : String(number);
    haloText(ctx, text, (left + right) / 2, top.y - STEP_NUMBERS.size, fontOf(STEP_NUMBERS.size, 600, ink.font), ink, 'center');
  }

  // ===========================================================================================
  // Events

  on<E extends MapEventType>(type: E, handler: (event: Extract<MapEvent, { readonly type: E }>) => void): () => void {
    const set = this.handlers.get(type) ?? new Set<Handler>();
    this.handlers.set(type, set);
    const wrapped = handler as Handler;
    set.add(wrapped);
    return () => {
      set.delete(wrapped);
    };
  }

  private emit(event: MapEvent): void {
    const set = this.handlers.get(event.type);
    if (set === undefined) return;
    for (const handler of [...set]) handler(event);
  }

  private wireGroup(layer: LayerId, group: L.FeatureGroup): void {
    group.on('click', (event: L.LeafletMouseEvent) => {
      const hit = this.eventHit(event);
      const point = this.worldOf(event.latlng);
      if (hit === null || point === null) return;
      this.emit({ type: 'click', point, hit: { ...hit, segment: this.segmentOf(hit, event.latlng) }, zones: this.zonesAt(point) });
    });
    group.on('mouseover', (event: L.LeafletMouseEvent) => {
      // Hover labels are held back during a wheel gesture (map-atlas.md §8.4).
      if (this.wheel?.gesturing === true) return;
      this.hoverAt(layer, event);
    });
    if (PIN_LAYERS.includes(layer)) {
      // Between overlapping pins the renderer keeps its topmost, while the nearest head centre may change (§25.2.7).
      group.on('mousemove', (event: L.LeafletMouseEvent) => {
        if (this.wheel?.gesturing === true || this.hoveredPin === null) return;
        const hit = this.eventHit(event);
        if (hit !== null && pinKey(hit.layer, hit.id) !== this.hoveredPin) this.hoverAt(layer, event);
      });
    }
    group.on('mouseout', () => {
      this.hoveredPin = null;
      this.closeTooltip();
      this.emit({ type: 'hover', point: null, hit: null });
    });
  }

  /** The item under a pointer event: the renderer's hit, or for a pin the pin whose head centre is nearest (§25.2.7). */
  private eventHit(event: L.LeafletMouseEvent): Omit<MapHit, 'segment'> | null {
    const hit = this.hitOf(event);
    if (hit === null) return null;
    const source = this.layers[hit.layer].drawn.get(hit.id)?.leaflet;
    if (!(source instanceof PinMarker)) return hit;
    return this.pinHitAt(event.layerPoint) ?? hit;
  }

  private hoverAt(layer: LayerId, event: L.LeafletMouseEvent): void {
    const hit = this.eventHit(event);
    const point = this.worldOf(event.latlng);
    if (hit === null || point === null) return;
    const full: MapHit = { ...hit, segment: this.segmentOf(hit, event.latlng) };
    const source = this.layers[hit.layer].drawn.get(hit.id)?.leaflet;
    if (source instanceof PinMarker) {
      this.hoveredPin = pinKey(hit.layer, hit.id);
      this.showPinTooltip(hit, source);
    } else {
      this.hoveredPin = null;
      this.showTooltip(layer, full.id, event.latlng);
    }
    this.emit({ type: 'hover', point, hit: full });
  }

  /** A pin's tooltip, above its head (§25.2.1), with a stack's or a tie's combined text. */
  private showPinTooltip(hit: Omit<MapHit, 'segment'>, pin: PinMarker): void {
    const map = this.map;
    const tooltip = this.tooltip;
    const descriptor = this.layers[hit.layer].drawn.get(hit.id)?.descriptor;
    if (map === null || tooltip === null || descriptor?.type !== 'marker') return;
    const label = this.pinLabel(hit);
    if (label === null) {
      this.closeTooltip();
      return;
    }
    const text = map.getContainer().ownerDocument.createElement('span');
    text.textContent = label;
    const e = specExtent(pin.spec);
    tooltip.options.offset = L.point(0, 4 - e.up);
    tooltip.setContent(text).setLatLng(this.toLatLng(descriptor.point));
    map.openTooltip(tooltip);
  }

  private hitOf(event: L.LeafletEvent): Omit<MapHit, 'segment'> | null {
    const source: unknown = event.propagatedFrom;
    if (typeof source !== 'object' || source === null) return null;
    const owner = this.owners.get(source);
    if (owner === undefined) return null;
    const entry = this.layers[owner.layer].drawn.get(owner.id);
    if (entry === undefined) return null;
    return { layer: owner.layer, id: owner.id, ref: entry.descriptor.ref, refs: refsOf(entry.descriptor) };
  }

  /** The polyline segment nearest the pointer, measured in the polyline's own map's yards (the partition may name another map near a seam). */
  private segmentOf(hit: Omit<MapHit, 'segment'>, latlng: L.LatLng): number | null {
    const descriptor = this.layers[hit.layer].drawn.get(hit.id)?.descriptor;
    if (descriptor?.type !== 'polyline') return null;
    return nearestSegment(descriptor.points, latLngOnMap(this.translationOf(descriptor.mapId), latlng.lat, latlng.lng, descriptor.mapId));
  }

  private zonesAt(point: WorldPoint): readonly UiMapId[] {
    const frames: FrameDescriptor[] = [];
    for (const entry of this.layers['zone-frames'].drawn.values()) if (entry.descriptor.type === 'frame') frames.push(entry.descriptor);
    return zonesAt(frames, point);
  }

  private showTooltip(layer: LayerId, id: string, at: L.LatLng): void {
    const map = this.map;
    const tooltip = this.tooltip;
    const descriptor = this.layers[layer].drawn.get(id)?.descriptor;
    if (map === null || tooltip === null || descriptor === undefined) return;
    const label =
      descriptor.type === 'art' || descriptor.type === 'outline' || descriptor.type === 'tiles' || descriptor.type === 'label' || descriptor.type === 'area'
        ? null
        : labelOf(descriptor, this.labelProvider);
    if (label === null) {
      this.closeTooltip();
      return;
    }
    const text = map.getContainer().ownerDocument.createElement('span');
    text.textContent = label;
    const point = pointOf(descriptor);
    tooltip.options.offset = L.point(0, -10);
    tooltip.setContent(text).setLatLng(point === null ? at : this.toLatLng(point));
    map.openTooltip(tooltip);
  }

  private closeTooltip(): void {
    if (this.map !== null && this.tooltip !== null) this.map.closeTooltip(this.tooltip);
  }
}
