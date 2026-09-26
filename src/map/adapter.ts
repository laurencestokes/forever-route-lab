import type { SpawnPoint } from '../domain/dataset';
import { worldMapId, type NpcId, type ObjectId, type QuestId, type StepId, type UiMapId, type WorldMapId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';
import type { UnresolvedReason } from '../geo/resolve';

/**
 * The map engine's contract (docs/ARCHITECTURE.md §7.1; docs/MAPS.md §7): the `MapAdapter`
 * interface, the plain-data descriptors it draws, and the view-model inputs `map/layers.ts` turns
 * into descriptors. Pure: no DOM, Leaflet, clock or randomness. This module compiles without the
 * DOM lib (tsconfig.pure.json), so the mount target is declared structurally (`MapContainer`).
 *
 * Who imports what (ARCHITECTURE §4): `ui` may import this module; `map/layers` only its types;
 * `map/leaflet` (the one Leaflet importer) implements `MapAdapter`, and `ui` reaches it only
 * through the composition root (`src/main.tsx`), which loads it lazily and hands a
 * `MapAdapterFactory` down.
 *
 * Coordinates are world yards on one world map (`WorldPoint`: `x` north, `y` west,
 * coordinates.md §2). Nothing here converts to pixels or lat/lng; that is the adapter's job.
 */

// =============================================================================================
// Surfaces

/** One surface per world map: `world:<mapId>` (ARCHITECTURE §7.1). The combined overview is deferred (MAPS §7.1). */
export type SurfaceId = `world:${number}`;

const SURFACE_ID = /^world:(0|[1-9]\d*)$/;

export function surfaceIdOf(mapId: WorldMapId): SurfaceId {
  return `world:${String(mapId)}` as SurfaceId;
}

/** The world map a surface id names, or null unless the text is exactly `world:<non-negative integer>`. */
export function parseSurfaceId(text: string): WorldMapId | null {
  const match = SURFACE_ID.exec(text);
  return match?.[1] === undefined ? null : worldMapId(Number(match[1]));
}

/** `parseSurfaceId` for a value typed as a surface id; throws on a malformed one (`world:1.5`, `world:-1`). */
export function surfaceMapId(surface: SurfaceId): WorldMapId {
  const mapId = parseSurfaceId(surface);
  if (mapId === null) throw new RangeError(`not a surface id: ${surface}`);
  return mapId;
}

/** An axis-aligned rectangle of world yards on one world map (x north, y west). */
export interface WorldBounds {
  readonly mapId: WorldMapId;
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

/** True when `point` is on the rectangle's world map and inside it, edges included. */
export function boundsContain(bounds: WorldBounds, point: WorldPoint): boolean {
  return (
    bounds.mapId === point.mapId && point.x >= bounds.xMin && point.x <= bounds.xMax && point.y >= bounds.yMin && point.y <= bounds.yMax
  );
}

/** The centre of a rectangle, as a world point on its map. */
export function boundsCenter(bounds: WorldBounds): WorldPoint {
  return { mapId: bounds.mapId, x: (bounds.xMin + bounds.xMax) / 2, y: (bounds.yMin + bounds.yMax) / 2 };
}

/**
 * The smallest rectangle around the points on `mapId`; null when none is on that map. Points on
 * other world maps are ignored, never folded in.
 */
export function boundsOfPoints(mapId: WorldMapId, points: readonly WorldPoint[]): WorldBounds | null {
  let bounds: { xMin: number; xMax: number; yMin: number; yMax: number } | null = null;
  for (const point of points) {
    if (point.mapId !== mapId) continue;
    if (bounds === null) bounds = { xMin: point.x, xMax: point.x, yMin: point.y, yMax: point.y };
    else {
      bounds.xMin = Math.min(bounds.xMin, point.x);
      bounds.xMax = Math.max(bounds.xMax, point.x);
      bounds.yMin = Math.min(bounds.yMin, point.y);
      bounds.yMax = Math.max(bounds.yMax, point.y);
    }
  }
  return bounds === null ? null : { mapId, ...bounds };
}

/** A world map the map can show, with the extent its view is fitted to (built by `surfacesOf` in map/layers). */
export interface SurfaceInfo {
  readonly id: SurfaceId;
  readonly mapId: WorldMapId;
  /** The continent's UiMap name, the one name every UiMap on the map shares, or `World map <id>`. */
  readonly name: string;
  readonly extent: WorldBounds;
  /**
   * `continent`: the committed continent frame (Kalimdor 1414 for map 1, Eastern Kingdoms 1415 for
   * map 0). `zone-union`: the union of the map's zone frames plus a margin (Zephras Isle 2991,
   * Darkspear Islands 2997, battlegrounds), MAPS §7.1, §8.1.
   */
  readonly extentSource: 'continent' | 'zone-union';
  /** The UiMap whose frame is the extent, for `continent`; null for `zone-union`. */
  readonly extentUiMapId: UiMapId | null;
  /** Every UiMap with a full-rectangle row on this world map, ascending. */
  readonly uiMapIds: readonly UiMapId[];
}

// =============================================================================================
// Layers

/**
 * Every layer, in draw order from bottom to top (ARCHITECTURE §7.2; MAPS §7.3). `relief` and `art`
 * are image overlays under everything (`IMAGE_LAYER_IDS`); the rest share one canvas and are
 * stacked in this order.
 */
export const LAYER_IDS = [
  'relief',
  'art',
  'coastline',
  'zone-outlines',
  'zone-frames',
  'available-quests',
  'objectives',
  'turn-ins',
  'flight-masters',
  'route-line',
  'route-steps',
  'proposal',
  'selection',
] as const;

export type LayerId = (typeof LAYER_IDS)[number];

/** The layers drawn as image overlays below the canvas: their budgets count images, not canvas paths. */
export type ImageLayerId = 'relief' | 'art';

export const IMAGE_LAYER_IDS: readonly ImageLayerId[] = ['relief', 'art'];

export const isImageLayer = (layer: LayerId): layer is ImageLayerId => layer === 'relief' || layer === 'art';

/** The terrain-derived layers (D-032; terrain-navigation.md §13.2). */
export type TerrainLayerId = 'relief' | 'coastline' | 'zone-outlines';

/** The four layers built from dataset spawns. They never depend on the route (ARCHITECTURE §7.1). */
export type SpawnLayerId = 'available-quests' | 'objectives' | 'turn-ins' | 'flight-masters';

export const SPAWN_LAYER_IDS: readonly SpawnLayerId[] = ['available-quests', 'objectives', 'turn-ins', 'flight-masters'];

/** Labels for a layer panel. */
export const LAYER_LABELS: Readonly<Record<LayerId, string>> = {
  relief: 'Relief',
  art: 'Painted map art',
  coastline: 'Coastline',
  'zone-outlines': 'Zone outlines',
  'zone-frames': 'Zone frames',
  'available-quests': 'Available quests',
  objectives: 'Objectives',
  'turn-ins': 'Turn-ins',
  'flight-masters': 'Flight masters',
  'route-line': 'Route line',
  'route-steps': 'Step markers',
  proposal: 'Proposal overlay',
  selection: 'Selection',
};

export const isLayerId = (value: string): value is LayerId => (LAYER_IDS as readonly string[]).includes(value);

// =============================================================================================
// Descriptors: plain data with stable ids

/** How strongly an item is drawn: `strong` for selected or hovered items, `dim` for de-emphasised ones. */
export type Emphasis = 'normal' | 'strong' | 'dim';

/**
 * What a marker stands for; the adapter draws each kind as its own simple, original glyph (shape
 * is the non-colour cue, UI.md §4): `step` a bead, `quest-start` a triangle, `quest-end` a square,
 * `objective` a small dot, `flight-master` a plus, `transition` a ring with a dot (the route leaves
 * or enters this world map, or leaves for a place the route does not give), `halo` a selection ring.
 */
export type MarkerKind = 'step' | 'quest-start' | 'quest-end' | 'objective' | 'flight-master' | 'transition' | 'halo';

/** The colour role of a marker. Never a difficulty colour and never the provenance cyan (UI.md §4). */
export type MarkerStyle = 'neutral' | 'accent' | 'muted' | 'proposal';

/**
 * Secondary cues drawn on a marker: `instance` (an instance-presence spawn drawn at its dungeon
 * entrance, MAPS §7.4), `off-frame` (a valid point outside its zone's 0..100 frame), `leg-unknown`
 * (the leg into this step is unknown: an earlier step could not be placed).
 */
export type MarkerBadge = 'instance' | 'off-frame' | 'leg-unknown';

/** Canonical badge order, so equal badge sets compare equal. */
export const MARKER_BADGES: readonly MarkerBadge[] = ['instance', 'off-frame', 'leg-unknown'];

/** How the character moves along a leg. */
export type LegStyle = 'route' | 'transport' | 'flight' | 'hearth';

/**
 * Polyline styles: the four leg styles, the selected-leg highlight and the proposal overlay, and,
 * while walking paths are drawn (`RoutePathsInput`), the two kinds of walked leg drawn as a
 * straight line: `route-pending` (its path is still being computed) and `route-fallback` (it has
 * no path, so the straight line stands in for one). A walked leg drawn along its path is `route`.
 */
export type LineStyle = LegStyle | 'route-pending' | 'route-fallback' | 'highlight' | 'proposal';

/** Something a dataset point belongs to. */
export type PointSubject =
  | { readonly kind: 'npc'; readonly id: NpcId }
  | { readonly kind: 'object'; readonly id: ObjectId }
  /** A quest's event objective area (QuestieDB `triggerEnd` points), `objective` in ObjectiveData order. */
  | { readonly kind: 'event'; readonly questId: QuestId; readonly objective: number };

/**
 * What a drawn item stands for; clicks and hovers report it (`MapHit.ref`). Route refs name steps
 * by id only, never by position: a position changes with every insert above it (the adapter's
 * label provider turns ids into numbered text when a label is shown, `MapLabelProvider`).
 */
export type MapRef =
  | { readonly kind: 'step'; readonly stepId: StepId }
  /** A route-line run: one step id per vertex, so a hit segment `i` is the leg into `stepIds[i + 1]`. */
  | { readonly kind: 'run'; readonly style: LineStyle; readonly stepIds: readonly StepId[] }
  | { readonly kind: 'leg'; readonly fromStepId: StepId; readonly toStepId: StepId }
  | {
      readonly kind: 'transition';
      readonly end: 'departure' | 'arrival';
      readonly fromStepId: StepId;
      readonly toStepId: StepId;
      readonly fromMapId: WorldMapId;
      readonly toMapId: WorldMapId;
      readonly leg: LegStyle;
    }
  /**
   * The character leaves this point for a place the route does not give: a hearth `use` without a
   * location, whose bind point is unknown until the simulation (Milestone 6). `stepId` is that step.
   */
  | { readonly kind: 'departure'; readonly stepId: StepId; readonly leg: LegStyle }
  | { readonly kind: 'spawn'; readonly subject: PointSubject; readonly spawnIndex: number; readonly questIds: readonly QuestId[] }
  | { readonly kind: 'aggregate'; readonly layer: LayerId; readonly mapId: WorldMapId; readonly uiMapId: UiMapId | null; readonly count: number }
  | { readonly kind: 'zone'; readonly uiMapId: UiMapId }
  | { readonly kind: 'surface'; readonly mapId: WorldMapId }
  | { readonly kind: 'art'; readonly uiMapId: UiMapId }
  /** A terrain-derived layer's one item on a world map: the relief image, the zone outlines or the coastline. */
  | { readonly kind: 'terrain'; readonly layer: TerrainLayerId; readonly mapId: WorldMapId };

/**
 * A glyph at one world point. Items of one layer at the identical point are merged into one
 * marker (`count` > 1, MAPS §7.3): only the topmost of a stack could otherwise be hovered or
 * clicked, so the marker carries every item's label and ref, and a click reports all of them
 * (`MapHit.refs`).
 */
export interface MarkerDescriptor {
  readonly type: 'marker';
  readonly id: string;
  readonly point: WorldPoint;
  readonly kind: MarkerKind;
  readonly style: MarkerStyle;
  readonly emphasis: Emphasis;
  /**
   * Shown on hover only (MAPS §7.2); null for none. For a merged marker, its first item's. Step
   * markers and halos carry their step id here, a label key rather than text: their text names the
   * step's position, which every insert above it changes, so the adapter's label provider resolves
   * it when the label is shown (`labelOf`).
   */
  readonly label: string | null;
  /** In `MARKER_BADGES` order, no repeats (the union of the merged items' badges). */
  readonly badges: readonly MarkerBadge[];
  /** The first item's ref (`refs[0]`). */
  readonly ref: MapRef;
  /** How many items the marker stands for: 1, or the size of a merged stack (drawn as a count badge). */
  readonly count: number;
  /** Every item's ref, in the layer's order (`count` entries). */
  readonly refs: readonly MapRef[];
  /** Every item's label or label key, parallel to `refs`. */
  readonly labels: readonly (string | null)[];
}

export interface PolylineDescriptor {
  readonly type: 'polyline';
  readonly id: string;
  readonly mapId: WorldMapId;
  /** At least two and at most `MAX_POLYLINE_VERTICES` points, all on `mapId`. */
  readonly points: readonly WorldPoint[];
  readonly style: LineStyle;
  readonly emphasis: Emphasis;
  /** Hover text without step numbers (`Route`, `Selected leg`); the label provider may add them from `ref`. */
  readonly label: string | null;
  readonly ref: MapRef;
}

/**
 * Route and proposal lines are cut into pieces of at most this many vertices (MAPS §7.4), so an
 * edit re-sets one short polyline rather than the whole route.
 */
export const MAX_POLYLINE_VERTICES = 256;

/** A zone frame (outline and label), or the surface extent. Frames are rectangles, not zone borders (coordinates.md §5). */
export interface FrameDescriptor {
  readonly type: 'frame';
  readonly id: string;
  readonly bounds: WorldBounds;
  readonly kind: 'zone' | 'extent';
  /** Drawn inside the frame when it is large enough on screen; null for none. */
  readonly label: string | null;
  readonly emphasis: Emphasis;
  /**
   * Whether a zone frame gets its faint fill. False over painted map art, which the fill would wash
   * out (every frame a city lies in adds another veil). The extent is never filled.
   */
  readonly filled: boolean;
  readonly ref: MapRef;
}

/**
 * An image over a world rectangle: painted map art (the `art` layer) or a world map's shaded
 * relief (the `relief` layer). Drawn as an image overlay below the canvas; not interactive.
 */
export interface ArtDescriptor {
  readonly type: 'art';
  readonly id: string;
  readonly bounds: WorldBounds;
  /**
   * The image to draw. Committed art and relief (`public/maps/art/`, `public/maps/terrain/`; D-032,
   * D-033): the deployed file's URL, which ships with the app as its code does. A local set's art
   * (D-018): an object URL of the verified bytes (`infra/maps` local art), never the file's URL.
   */
  readonly url: string;
  readonly opacity: number;
  readonly label: string | null;
  readonly ref: MapRef;
}

/**
 * Terrain-derived lines on one world map, drawn as one non-interactive canvas path
 * (terrain-navigation.md §13.2): the zone outlines (`zones`: borders between zones, from the
 * client's per-chunk areas) or the coastline (`coast`). They are a picture, not zone membership:
 * points are still attributed by their published UiMap and the zone frames.
 */
export interface OutlineDescriptor {
  readonly type: 'outline';
  readonly id: string;
  readonly mapId: WorldMapId;
  readonly kind: 'zones' | 'coast';
  /** Every line has at least two points, all on `mapId`. */
  readonly lines: readonly (readonly WorldPoint[])[];
  readonly label: string | null;
  readonly ref: MapRef;
}

/** One per-zone aggregate glyph at continent zoom: `count` points of `subjects` things, drawn at their centroid (MAPS §7.2). */
export interface AggregateDescriptor {
  readonly type: 'aggregate';
  readonly id: string;
  readonly point: WorldPoint;
  readonly layer: LayerId;
  /** Points folded into the glyph; the glyph shows this number. */
  readonly count: number;
  /** Distinct subjects (NPCs, objects, event areas) those points belong to. */
  readonly subjects: number;
  readonly emphasis: Emphasis;
  readonly label: string | null;
  readonly ref: MapRef;
}

export type MapDescriptor = MarkerDescriptor | PolylineDescriptor | FrameDescriptor | ArtDescriptor | OutlineDescriptor | AggregateDescriptor;

/** Every item a descriptor stands for: a marker's `refs`, otherwise its one `ref`. */
export function refsOf(descriptor: MapDescriptor): readonly MapRef[] {
  return descriptor.type === 'marker' ? descriptor.refs : [descriptor.ref];
}

/**
 * Turns a ref into hover text when a label is shown, for items whose text depends on the route
 * (step numbers); null keeps the descriptor's own label. Given to the adapter as
 * `MapAdapterOptions.label` or with `setLabelProvider`.
 */
export type MapLabelProvider = (ref: MapRef) => string | null;

/**
 * The hover text of a stack of `total` items: one label as it is; several as
 * `6 here: a; b; c and 3 more` (at most `shown` listed). `total` includes items without a label.
 */
export function combineLabels(labels: readonly string[], total: number = labels.length, shown = 3): string | null {
  const [first] = labels;
  if (first === undefined) return total > 1 ? `${String(total)} here` : null;
  if (total <= 1) return first;
  const listed = labels.slice(0, Math.max(1, shown));
  const rest = total - listed.length;
  return `${String(total)} here: ${listed.join('; ')}${rest > 0 ? ` and ${String(rest)} more` : ''}`;
}

/**
 * What a descriptor's hover label says: for each of its refs, the provider's text where it gives
 * one, otherwise the descriptor's own label; combined for a merged marker (`combineLabels`). Null
 * for no label. The adapter's tooltip uses it, and a UI's "pointer on" line should too, so they agree.
 */
export function labelOf(descriptor: MapDescriptor, provider: MapLabelProvider | null = null): string | null {
  const texts: string[] = [];
  const refs = refsOf(descriptor);
  refs.forEach((ref, index) => {
    const own = descriptor.type === 'marker' ? (descriptor.labels[index] ?? null) : descriptor.label;
    const text = provider?.(ref) ?? own;
    if (text !== null && text !== '') texts.push(text);
  });
  return combineLabels(texts, refs.length);
}

/** The world map a descriptor is drawn on. */
export function descriptorMapId(descriptor: MapDescriptor): WorldMapId {
  switch (descriptor.type) {
    case 'marker':
    case 'aggregate':
      return descriptor.point.mapId;
    case 'polyline':
    case 'outline':
      return descriptor.mapId;
    case 'frame':
    case 'art':
      return descriptor.bounds.mapId;
  }
}

/**
 * Why a point was not drawn. It is counted and reported, never guessed:
 * - the `geo` resolution reasons (`no-geometry`, `outside-ui-rectangles`, `no-era-coefficients`, `non-finite`);
 * - `instance-without-entrance`: inside an instance whose dungeon has no single verified entrance;
 * - `unmapped-area`: published on an AreaTable id no UiMap shows;
 * - `destination-unknown`: the step moves the character somewhere the route does not say (a
 *   travel step without a location, RXP `.zone`; a hearth `use` without one, until the
 *   simulation knows the bind point).
 */
export type UnplacedReason = UnresolvedReason | 'instance-without-entrance' | 'unmapped-area' | 'destination-unknown';

/**
 * Counts that make a layer honest about what it does not draw. What each count counts (points,
 * steps, markers, lines) depends on the layer; `layerStatsNotes` in map/layers names the unit.
 */
export interface LayerStats {
  /** Descriptors in `items`. */
  readonly drawn: number;
  /** Descriptors that passed level of detail on this surface but fell beyond the path cap: "N more not drawn". */
  readonly notDrawn: number;
  /** Points folded into per-zone aggregate glyphs (continent zoom). */
  readonly aggregated: number;
  /** Points or steps with no world position, never drawn. */
  readonly unresolved: number;
  /** `unresolved` by reason, keys in ascending order. */
  readonly unresolvedBy: Readonly<Partial<Record<UnplacedReason, number>>>;
  /** Points, steps or lines on other world maps (drawn on their own surfaces). */
  readonly otherSurfaces: number;
  /**
   * The route line only, while walking paths are drawn (`RoutePathsInput`): its walked legs on this
   * world map, by how they are drawn. Absent otherwise.
   */
  readonly paths?: LegPathCounts;
}

/** Walked legs by how the route line draws them (`LayerStats.paths`). */
export interface LegPathCounts {
  /** Along their walking path. */
  readonly along: number;
  /** As a straight line while their path is still being computed. */
  readonly pending: number;
  /** As a straight line because they have no path. */
  readonly fallback: number;
}

export const EMPTY_LAYER_STATS: LayerStats = {
  drawn: 0,
  notDrawn: 0,
  aggregated: 0,
  unresolved: 0,
  unresolvedBy: {},
  otherSurfaces: 0,
};

/**
 * What `setLayer` draws. The adapter skips a call whose `items` array is the one it already has
 * (by reference) and otherwise diffs by descriptor id (MAPS §7.3). Ids are unique within a layer.
 */
export interface LayerContent {
  readonly layer: LayerId;
  /** In draw order, bottom first. */
  readonly items: readonly MapDescriptor[];
  readonly stats: LayerStats;
}

const EMPTY_ITEMS: readonly MapDescriptor[] = [];

/** An empty layer (one shared `items` array, so repeated clears are skipped by reference). */
export function emptyLayerContent(layer: LayerId): LayerContent {
  return { layer, items: EMPTY_ITEMS, stats: EMPTY_LAYER_STATS };
}

// =============================================================================================
// View-model inputs for map/layers.ts

/** What part of the map a layer is built for. */
export interface MapView {
  readonly mapId: WorldMapId;
  /** Leaflet `L.CRS.Simple` zoom: `2^zoom` pixels per yard (continents about -5.2, zones about -2.4). */
  readonly zoom: number;
  /** The viewport centre in world yards. Only used to choose what survives the path cap; null ranks by id alone. */
  readonly center: { readonly x: number; readonly y: number } | null;
  /**
   * The visible rectangle, when known. Only used under the path cap: the memoised builders keep an
   * item they already draw while it stays inside this rectangle (padded), so a pan does not swap
   * it out (MAPS §7.2).
   */
  readonly bounds?: WorldBounds | null;
}

/**
 * One subject's dataset points for a spawn layer: a quest giver, a turn-in NPC or object, an
 * objective target or event area, or a flight master.
 */
export interface PointGroupInput {
  readonly subject: PointSubject;
  /** Hover text for every point of the subject, for example `Gornek (starts Your Place in the World)`. */
  readonly label: string;
  /** The quests this subject matters for in this layer; any of them in focus draws its points raw and strong. */
  readonly questIds: readonly QuestId[];
  /** As `DatasetView.spawns` returns them; a point without `world` is counted as unresolved, never guessed. */
  readonly spawns: readonly SpawnPoint[];
}

/** A spawn layer's input. Groups with the same subject are merged (quest ids united; the first group's label and spawns kept). */
export interface SpawnLayerInput {
  readonly groups: readonly PointGroupInput[];
}

/**
 * Where a step puts the character, for drawing:
 * - `point`: its location resolved to a world point;
 * - `none`: it has no location and does not move the character (the line continues through it);
 * - `unknown`: its location cannot be placed, or it moves the character somewhere unknown; the
 *   route line breaks here and the next placed step's leg is marked unknown (ARCHITECTURE §6).
 */
export type StepPlacement =
  | { readonly kind: 'point'; readonly world: WorldPoint; readonly uiMapId: UiMapId | null; readonly offFrame: boolean }
  | { readonly kind: 'none' }
  | { readonly kind: 'unknown'; readonly reason: UnplacedReason };

/**
 * One step's route-layer input. It holds neither the step's position nor its text: both change
 * with edits elsewhere in the route (an insert renumbers every later step), so an input stays valid
 * for as long as its step is unchanged, and step text is resolved by the adapter's label provider
 * when a label is shown (`MapLabelProvider`).
 */
export interface RouteStepInput {
  readonly stepId: StepId;
  readonly placement: StepPlacement;
  /** How the character reaches this step's own location. */
  readonly arrive: LegStyle;
  /**
   * How the character leaves this step for the next placed one (`flight` after taking a flight), or
   * null. A hearth `use` without a location has `hearth` here and an `unknown` placement: its bind
   * point is unknown until the simulation, so the line ends there with a departure glyph.
   */
  readonly departs: LegStyle | null;
  readonly questIds: readonly QuestId[];
}

export interface RouteInput {
  readonly steps: readonly RouteStepInput[];
}

/** Which steps are selected, hovered and active (the active step's leg is highlighted). */
export interface StepFocus {
  readonly selected: readonly StepId[];
  readonly hovered: StepId | null;
  readonly active: StepId | null;
}

export const NO_STEP_FOCUS: StepFocus = { selected: [], hovered: null, active: null };

/**
 * One map-art image: a committed one (`public/maps/art/`, D-033) or a local set's (MAPS §5.3).
 * Without `bounds`, its world rectangle is its UiMap's single full-rectangle row in the geometry
 * `map/layers` was built with (so build the layers over the merged geometry when a local set adds
 * UiMaps).
 */
export interface ArtInput {
  readonly uiMapId: UiMapId;
  /** The committed image's URL, or an object URL of a local image's verified bytes (`LocalArt.load` in infra/maps). */
  readonly url: string;
  /** 0..1. */
  readonly opacity: number;
  /** The image's world rectangle as its manifest records it (committed art); omitted to take the UiMap's row from the geometry. */
  readonly bounds?: WorldBounds | undefined;
}

/** One world map's shaded relief (terrain-navigation.md §13.1): the image and the world rectangle it covers. */
export interface ReliefInput {
  readonly mapId: WorldMapId;
  /** The deployed PNG's URL. */
  readonly url: string;
  readonly bounds: WorldBounds;
}

/** One world map's terrain lines (zone outline arcs or coastline arcs), decoded to world points. */
export interface OutlineInput {
  readonly mapId: WorldMapId;
  readonly lines: readonly (readonly WorldPoint[])[];
}

/**
 * A walked leg the route line can draw along a walking path (MAPS §7.4): from one placed step to
 * the next placed step on the same world map, reached on foot or mounted (`route` style: not a
 * flight, transport or hearth). Proposal lines never take paths.
 */
export interface RouteLeg {
  readonly fromStepId: StepId;
  readonly toStepId: StepId;
  /** The two steps' placed points, on one world map. */
  readonly from: WorldPoint;
  readonly to: WorldPoint;
}

/**
 * Walking paths for the route line, fed from the navigation model's `path(from, to)` (MAPS §7.4).
 * Give a new object whenever an answer changes (a batch of paths arrived, computing finished): the
 * route layers are rebuilt only when this object changes, and ask `pathOf` at most once per leg
 * while it stays the same.
 */
export interface RoutePathsInput {
  /**
   * The walking path of `leg`: its points in order, every one finite and on the leg's world map.
   * The line runs from `leg.from` through them to `leg.to`, so a path whose ends were snapped to
   * the walkable surface stays joined to the step markers. Null when the leg has no path: drawn as
   * a straight `route-pending` line while `pending`, as a `route-fallback` line otherwise. A path
   * that breaks those rules is drawn as a fallback too.
   */
  readonly pathOf: (leg: RouteLeg) => readonly WorldPoint[] | null;
  /** Paths are still being computed: a leg without one is pending, not a straight-line fallback. */
  readonly pending: boolean;
}

/** A leg's key for a caller's path cache: its world map and both end points, exactly (`1:-618.2,-4251.7>-601,-4225`). */
export function routeLegKey(leg: Pick<RouteLeg, 'from' | 'to'>): string {
  return `${String(leg.from.mapId)}:${String(leg.from.x)},${String(leg.from.y)}>${String(leg.to.x)},${String(leg.to.y)}`;
}

// =============================================================================================
// The adapter

/**
 * The element the map mounts into. Declared structurally because this module compiles without the
 * DOM lib; every `HTMLElement` satisfies it.
 */
export interface MapContainer {
  readonly nodeType: number;
  readonly ownerDocument: object | null;
}

/** A centre and zoom. A centre on another world map switches the surface first. */
export interface Viewport {
  readonly center: WorldPoint;
  readonly zoom: number;
}

export interface FitOptions {
  /** Pixels kept free around the bounds (default 24). */
  readonly paddingPx?: number;
  /** Never zoom in further than this (default: the adapter's maximum). */
  readonly maxZoom?: number;
  /**
   * Never zoom out further than this: when the bounds need a lower zoom to fit, the view is
   * centred on them at this zoom instead (for example the level-of-detail zone zoom for
   * jump-to-zone, so a zone that is wide for its stage still shows raw points). Default: no floor.
   */
  readonly minZoom?: number;
  readonly animate?: boolean;
}

export interface FocusOptions {
  /** Zoom to use; default the current zoom, raised to the adapter's focus zoom when it is lower. */
  readonly zoom?: number;
  readonly animate?: boolean;
  /** Recentre even when the point is already comfortably inside the view (default false). */
  readonly recenter?: boolean;
}

/**
 * Items to draw emphasised without rebuilding the layer, for example the marker of a hovered route
 * row. The emphasis is drawn on top of every layer; the items themselves keep their place.
 */
export interface HighlightTarget {
  readonly layer: LayerId;
  readonly ids: readonly string[];
}

/** What the map shows now. */
export interface MapViewState {
  readonly surface: SurfaceId;
  readonly mapId: WorldMapId;
  readonly center: WorldPoint;
  readonly zoom: number;
  /** The visible rectangle. */
  readonly bounds: WorldBounds;
  readonly widthPx: number;
  readonly heightPx: number;
}

/** The layer view (`MapView`) of a view state. */
export function mapViewOf(state: MapViewState): MapView {
  return { mapId: state.mapId, zoom: state.zoom, center: { x: state.center.x, y: state.center.y }, bounds: state.bounds };
}

/** The item under the pointer. */
export interface MapHit {
  readonly layer: LayerId;
  readonly id: string;
  /** The item's ref; for a merged marker, its first item's (`refs[0]`). */
  readonly ref: MapRef;
  /** Every item the hit descriptor stands for (`refsOf`): several for a merged marker, so a UI can offer a choice. */
  readonly refs: readonly MapRef[];
  /** For a polyline, the index of the segment nearest the pointer (between vertices `i` and `i + 1`); otherwise null. */
  readonly segment: number | null;
}

export type MapEvent =
  /**
   * A click. `hit` is the topmost interactive item (every item of a merged marker is in
   * `hit.refs`), or null on empty map. `zones` lists the zone
   * frames of the zone-frames layer containing the point, smallest first (a city before its zone);
   * frames are map rectangles, so this is a display aid, not zone membership. Frames overlap
   * heavily, so the smallest is often the wrong zone to open: jump-to-zone uses the frame the
   * point is most central in (`geo` `zoneFramesContaining`, coordinates.md §15; M3 review MAP-UX-1).
   */
  | { readonly type: 'click'; readonly point: WorldPoint; readonly hit: MapHit | null; readonly zones: readonly UiMapId[] }
  /** The pointer entered an item (`hit`), or left the last one (`hit` null, `point` null). */
  | { readonly type: 'hover'; readonly point: WorldPoint | null; readonly hit: MapHit | null }
  /** The view settled after a pan or zoom (Leaflet `moveend`). Rebuild view-dependent layers here. */
  | { readonly type: 'move'; readonly view: MapViewState }
  /** The zoom settled (Leaflet `zoomend`); a `move` follows. */
  | { readonly type: 'zoom'; readonly view: MapViewState }
  /** The surface changed: by `setSurface`, or because `focus`, `fitBounds` or `setViewport` targeted another world map. */
  | { readonly type: 'surface'; readonly surface: SurfaceId; readonly view: MapViewState };

export type MapEventType = MapEvent['type'];

/** Per-layer drawing counts the adapter reports (for tests and diagnostics). */
export interface LayerRenderStats {
  readonly visible: boolean;
  /** Items drawn on the current surface. */
  readonly drawn: number;
  /** Items of the last content on other surfaces (kept, not drawn). */
  readonly offSurface: number;
  /** Items dropped because another item of the layer had the same id. */
  readonly duplicates: number;
  /** Items dropped by the adapter's own hard path cap (zero when map/layers budgets are respected). */
  readonly truncated: number;
  /** `setLayer` calls skipped because `items` was unchanged by reference. */
  readonly skipped: number;
}

export interface MapRenderStats {
  readonly surface: SurfaceId | null;
  /** Canvas paths drawn on the current surface (images of the relief and art layers excluded). */
  readonly paths: number;
  readonly layers: Readonly<Record<LayerId, LayerRenderStats>>;
}

/**
 * The map engine (ARCHITECTURE §7.1). One surface at a time; content is kept per layer, and only
 * descriptors on the current surface are drawn, so switching surfaces redraws what each layer
 * already holds for the new one.
 */
export interface MapAdapter {
  /** Creates the map inside `el` (as a child element). Content set before mounting is drawn now. */
  mount(el: MapContainer): void;
  /** Removes the map and its listeners; content and event handlers are kept, so it can be mounted again. */
  destroy(): void;
  /** Shows a surface; false when it is not one of the adapter's surfaces. The previous surface's view is remembered. */
  setSurface(surface: SurfaceId): boolean;
  getSurface(): SurfaceId | null;
  /** False when the centre's world map is not a surface. */
  setViewport(viewport: Viewport): boolean;
  fitBounds(bounds: WorldBounds, options?: FitOptions): boolean;
  setLayer(layer: LayerId, content: LayerContent): void;
  toggleLayer(layer: LayerId, visible: boolean): void;
  isLayerVisible(layer: LayerId): boolean;
  highlight(target: HighlightTarget | null): void;
  /** Brings `point` into view (switching surface if needed); false when its world map is not a surface. */
  focus(point: WorldPoint, options?: FocusOptions): boolean;
  on<E extends MapEventType>(type: E, handler: (event: Extract<MapEvent, { readonly type: E }>) => void): () => void;
  /** The current view, or null before mounting. */
  getView(): MapViewState | null;
  /** Re-measures the container (the adapter also observes resizes where `ResizeObserver` exists). */
  resize(): void;
  /** Re-reads the palette from the container's CSS custom properties (after a theme change) and redraws. */
  refreshTheme(): void;
  /**
   * Replaces the label provider given as `MapAdapterOptions.label`; null for none. Optional, so an
   * implementation without hover labels (a test double) may leave it out.
   */
  setLabelProvider?(provider: MapLabelProvider | null): void;
  renderStats(): MapRenderStats;
}

export interface MapAdapterOptions {
  /** The surfaces the map may show (`surfacesOf(geometry)` in map/layers). */
  readonly surfaces: readonly SurfaceInfo[];
  /** The first surface; null for the first of `surfaces`. */
  readonly initialSurface: SurfaceId | null;
  /** Hover text for route items (numbered steps), asked each time a label is shown (`labelOf`). Default: none. */
  readonly label?: MapLabelProvider | null;
}

/** How `ui` receives the Leaflet implementation from the composition root without importing map/leaflet. */
export type MapAdapterFactory = (options: MapAdapterOptions) => MapAdapter;
