import type { SpawnPoint } from '../domain/dataset';
import type { QuestId, StepId, UiMapId, WorldMapId } from '../domain/ids';
import type { SourcedPoint, WorldPoint } from '../domain/points';
import type { RouteStep } from '../domain/route';
import { assignmentForWorld, isFullUiRectangle, resolveDetailed, worldMapIds, type GeometryAssignment, type MapGeometry } from '../geo';
import { atlasHash, atlasPlacements } from '../geo/atlas';
import { ATLAS_LAYOUT, type AtlasLayout } from '../geo/atlas-layout';
import type {
  AggregateDescriptor,
  AreaDescriptor,
  ArtDescriptor,
  ArtInput,
  AtlasSurfaceInfo,
  ConnectorDescriptor,
  Emphasis,
  FrameDescriptor,
  ImageLayerId,
  LayerContent,
  LayerId,
  LayerStats,
  LabelDescriptor,
  LegPathCounts,
  LegStyle,
  LogObjectivesInput,
  LineStyle,
  MapBand,
  MapCategoryId,
  MapDescriptor,
  MapRef,
  MapView,
  ClusterMember,
  MarkerBadge,
  MarkerDescriptor,
  MarkerKind,
  MarkerMark,
  MarkerQuest,
  MAX_POLYLINE_VERTICES,
  OutlineDescriptor,
  OutlineInput,
  PlaceItem,
  PlaceLayerInput,
  PointGroupInput,
  PointSubject,
  PolylineDescriptor,
  ReliefInput,
  RouteInput,
  RouteLeg,
  RoutePathsInput,
  RouteStepInput,
  SpawnLayerId,
  SpawnLayerInput,
  StepFocus,
  StepPlacement,
  SurfaceId,
  SurfaceInfo,
  UnplacedReason,
  WorldBounds,
  WorldSurfaceInfo,
  ZoneFillDescriptor,
} from './adapter';
import { CLUSTER_LEVELS, clusterLevelAt, type MarkDifficulty, type MarkState } from './marks';

export { CLUSTER_LEVELS, clusterLevelAt } from './marks';

/**
 * View models → map descriptors (docs/ARCHITECTURE.md §7; docs/MAPS.md §7.2-§7.4). Pure and
 * deterministic: no DOM, Leaflet, clock or randomness, and the same inputs always give the same
 * items in the same order.
 *
 * - **Memoised per layer on its own inputs** (`createMapLayers`): spawn layers never see the
 *   route, route layers never see spawns. A layer whose inputs are unchanged returns the same
 *   `LayerContent` object; a rebuilt layer keeps the object identity of every descriptor whose
 *   content is unchanged and returns the previous `items` array when nothing changed, so the
 *   adapter can skip it by reference and otherwise diff by id (MAPS §7.3).
 * - **Zoom bands** (map-presentation.md §5.1, §5.2): a view's band (`MapView.band`, set by the
 *   controller with hysteresis; else the plain band of its zoom, `bandOfView`) chooses each
 *   layer's budget (`LodSettings.budgets` per band) and the level of detail.
 * - **Level of detail** (MAPS §7.2): at the world and continent bands (below `zoneZoom` without a
 *   band), spawn layers fold their points into one aggregate glyph per (layer, zone) at the points'
 *   centroid; the points of focused (selected or hovered) quests stay raw at any zoom. Layers
 *   listed in `rawAtAnyZoom` never aggregate.
 * - **Hard path cap per surface**: every canvas layer has a budget in each band and each band's
 *   budgets sum to at most `pathCapPerSurface`. Over budget, focused items are kept first, then those nearest the viewport
 *   centre (ties by id), and `stats.notDrawn` says how many were left out. The memoised builders
 *   rank from a centre snapped to a coarse grid and keep what they already draw while it stays in
 *   view, so a pan does not swap markers in and out.
 * - **Stacks**: markers of one layer at the identical world point are merged into one marker that
 *   carries every item's ref and label (`count` > 1), so none is hidden under another.
 * - **Only points with a world position are drawn.** Unresolved points are counted by reason in
 *   `stats.unresolved`/`unresolvedBy`, never guessed; points on other world maps are counted in
 *   `stats.otherSurfaces`.
 * - **Route lines** are split into (world map, style) runs, and long runs into pieces of at most
 *   256 vertices; a world-map change ends the run and puts a transition glyph at both ends; an
 *   unplaceable step breaks the line. With walking paths (`RoutePathsInput`), a walked leg follows
 *   its path, and a leg without one is drawn straight in its own style (pending or fallback); the
 *   256-vertex pieces and the path cap hold with paths too.
 * - **Terrain and art** (D-032, D-033): the relief image, painted art images, and the zone
 *   outlines and coastline as one canvas path each per world map.
 * - **No step numbers.** Route descriptors name steps by id (labels are label keys or number-free
 *   text), so an insert changes only the descriptors next to it; the adapter's label provider
 *   numbers them when a label is shown.
 * - **The atlas** (docs/research/map-atlas.md §5, §8.2; D-042): `atlasSurfaceOf` places maps 1
 *   and 0 and the Zephras Isle inset on one surface. Layers are still built per world map, each with
 *   its own view (`MapView.surface` names the atlas); the controller joins the active maps' parts
 *   (`LayerPart`, `partBudgets`, `createLayerJoin`), sharing each layer's budget. On the atlas an
 *   item on another placed map is that map's part's, never counted as elsewhere; a leg between the
 *   two continents is a `connector`, and legs to the inset or an instance keep their transition
 *   glyphs; the inset gets a captioned card frame instead of an extent, and continent paintings
 *   are clipped to their side of the partition (interim art, until the tiles).
 *
 * `map/layers` may import only `domain` and `geo` values (ARCHITECTURE §4), so it takes nothing but
 * types from `./adapter`. `ui` may not import this module: the app layer re-exports what the UI
 * needs.
 */

// =============================================================================================
// Level of detail

export interface LodSettings {
  /**
   * Spawn points are drawn raw at or above this zoom on a world surface, below it they aggregate
   * (MAPS §7.2): the zone band's lower edge (map-presentation.md §5.1: 0.088 px per yard, zoom
   * −3.506, rounded to −3.5). With a `MapView.band` the band decides (`viewLodLevel`); this zoom
   * remains for views without one, `lodLevelAt` and the jump-to-zone floor.
   */
  readonly zoneZoom: number;
  /**
   * Hard cap on canvas paths per surface: 2,500 until a CPU-throttled measurement supports more
   * (MAPS §7.2 first proposed 5,000, which the M3 review measured over the moveend budget; M9/M10
   * measure it). The labels canvas counts against it too (map-presentation.md §5.2).
   */
  readonly pathCapPerSurface: number;
  /**
   * Each layer's share of the cap in each zoom band (map-presentation.md §5.2, with §25.7's pin
   * budgets; D-047): not every layer draws at every band, so each band's canvas layers (all but the
   * image layers `relief` and `art`) sum to at most `pathCapPerSurface`, and the image layers cap
   * images. On the atlas the active maps share each budget (`partBudgets`). A cluster of quest
   * givers (step MP.4a) will count as one item, and a cluster is never trimmed by the cap.
   */
  readonly budgets: Readonly<Record<MapBand, Readonly<Record<LayerId, number>>>>;
  /** Spawn layers drawn raw at every zoom (flight masters: a few hundred at most, and useful at continent zoom). */
  readonly rawAtAnyZoom: readonly SpawnLayerId[];
}

/** The four bands (`MAP_BANDS` in adapter.ts, which this module may import only types from). */
const BANDS: readonly MapBand[] = ['world', 'continent', 'zone', 'close'];

/**
 * The budgets of map-presentation.md §5.2 as §25.7 revises them (at most 300 drawn pins per band;
 * clusters count as pins), per band: world, continent, zone, close. The bases are in the design's
 * tables. `zone-frames` is §5.2's 60 less the two terrain paths of a world map (the atlas's other
 * maps take theirs from it, `partBudgets`): the committed geometry has 51 frames on the atlas and
 * at most 27 on a world surface.
 */
const BUDGET_TABLE: Readonly<Record<LayerId, readonly [world: number, continent: number, zone: number, close: number]>> = {
  relief: [1, 1, 1, 1],
  art: [16, 16, 16, 16],
  coastline: [1, 1, 1, 1],
  'zone-outlines': [1, 1, 1, 1],
  'zone-fill': [100, 100, 0, 0],
  'zone-frames': [58, 58, 58, 58],
  'flight-network': [0, 150, 100, 100],
  transports: [0, 27, 27, 27],
  'route-line': [150, 150, 150, 150],
  services: [0, 0, 18, 18],
  objectives: [80, 80, 500, 500],
  'available-quests': [120, 120, 100, 100],
  'turn-ins': [40, 40, 40, 40],
  dungeons: [0, 30, 30, 30],
  'flight-masters': [0, 35, 35, 35],
  'route-steps': [700, 700, 700, 700],
  proposal: [100, 100, 100, 100],
  selection: [100, 100, 100, 100],
  labels: [60, 120, 60, 40],
};

function budgetsFromTable(table: Readonly<Record<LayerId, readonly number[]>>): Readonly<Record<MapBand, Readonly<Record<LayerId, number>>>> {
  const out: Partial<Record<MapBand, Readonly<Record<LayerId, number>>>> = {};
  BANDS.forEach((band, i) => {
    out[band] = Object.fromEntries(Object.entries(table).map(([layer, values]) => [layer, values[i] ?? 0])) as Record<LayerId, number>;
  });
  return out as Record<MapBand, Readonly<Record<LayerId, number>>>;
}

export const DEFAULT_LOD: LodSettings = {
  zoneZoom: -3.5,
  pathCapPerSurface: 2500,
  budgets: budgetsFromTable(BUDGET_TABLE),
  rawAtAnyZoom: ['flight-masters'],
};

/** A layer's budget in a band. */
export const budgetOf = (lod: LodSettings, layer: LayerId, band: MapBand): number => lod.budgets[band][layer];

export type LodLevel = 'zone' | 'continent';

export function lodLevelAt(zoom: number, lod: LodSettings = DEFAULT_LOD): LodLevel {
  return zoom >= lod.zoneZoom ? 'zone' : 'continent';
}

/**
 * The band edges of adapter.ts `BAND_EDGES` (px per yard), repeated because this module may import
 * only types from there; layers.test.ts checks they are the same.
 */
export const LAYER_BAND_EDGES = { continent: 0.022, zone: 0.088, close: 0.5 } as const;

/** The band a view's layers are built for: its `band` (the controller's, with hysteresis), else the plain band of its zoom (`viewBand` in adapter.ts). */
export function bandOfView(view: Pick<MapView, 'zoom' | 'band'>): MapBand {
  if (view.band !== undefined) return view.band;
  const px = 2 ** view.zoom;
  if (!(px >= LAYER_BAND_EDGES.continent)) return 'world';
  if (px < LAYER_BAND_EDGES.zone) return 'continent';
  return px < LAYER_BAND_EDGES.close ? 'zone' : 'close';
}

/**
 * A view's detail level: from its band when it has one (spawn points fold into counts at the world
 * and continent bands), else from its zoom (`lodLevelAt`).
 */
export function viewLodLevel(view: Pick<MapView, 'zoom' | 'band'>, lod: LodSettings = DEFAULT_LOD): LodLevel {
  if (view.band === undefined) return lodLevelAt(view.zoom, lod);
  return view.band === 'world' || view.band === 'continent' ? 'continent' : 'zone';
}

const isCount = (n: number): boolean => Number.isInteger(n) && n >= 0;

/** `IMAGE_LAYER_IDS` in adapter.ts, which this module may import only types from. */
const IMAGE_LAYERS: readonly ImageLayerId[] = ['relief', 'art'];

const isImageLayer = (layer: string): boolean => (IMAGE_LAYERS as readonly string[]).includes(layer);

/** Why a `LodSettings` is unusable; empty when it is fine. Every band is checked on its own. */
export function lodProblems(lod: LodSettings): readonly string[] {
  const problems: string[] = [];
  if (!Number.isFinite(lod.zoneZoom)) problems.push('zoneZoom must be finite');
  if (!isCount(lod.pathCapPerSurface)) problems.push('pathCapPerSurface must be a non-negative integer');
  for (const band of BANDS) {
    let canvas = 0;
    for (const [layer, budget] of Object.entries(lod.budgets[band])) {
      if (!isCount(budget)) problems.push(`budget of ${layer} in the ${band} band must be a non-negative integer`);
      if (!isImageLayer(layer)) canvas += budget;
    }
    if (canvas > lod.pathCapPerSurface) {
      problems.push(`canvas layer budgets of the ${band} band sum to ${String(canvas)}, above the cap of ${String(lod.pathCapPerSurface)} paths per surface`);
    }
  }
  return problems;
}

export interface LodOverrides {
  readonly zoneZoom?: number;
  readonly pathCapPerSurface?: number;
  /** A layer's budget in every band. */
  readonly budgets?: Readonly<Partial<Record<LayerId, number>>>;
  /** A layer's budget in one band (applied after `budgets`). */
  readonly bandBudgets?: Readonly<Partial<Record<MapBand, Readonly<Partial<Record<LayerId, number>>>>>>;
  readonly rawAtAnyZoom?: readonly SpawnLayerId[];
}

/** `DEFAULT_LOD` with overrides; throws when the result breaks `lodProblems`. */
export function createLod(overrides: LodOverrides = {}): LodSettings {
  const budgets: Partial<Record<MapBand, Readonly<Record<LayerId, number>>>> = {};
  for (const band of BANDS) budgets[band] = { ...DEFAULT_LOD.budgets[band], ...overrides.budgets, ...overrides.bandBudgets?.[band] };
  const lod: LodSettings = {
    zoneZoom: overrides.zoneZoom ?? DEFAULT_LOD.zoneZoom,
    pathCapPerSurface: overrides.pathCapPerSurface ?? DEFAULT_LOD.pathCapPerSurface,
    budgets: budgets as Record<MapBand, Readonly<Record<LayerId, number>>>,
    rawAtAnyZoom: overrides.rawAtAnyZoom ?? DEFAULT_LOD.rawAtAnyZoom,
  };
  const problems = lodProblems(lod);
  if (problems.length > 0) throw new RangeError(`invalid level-of-detail settings: ${problems.join('; ')}`);
  return lod;
}

// =============================================================================================
// Small deterministic helpers

/** Code-unit order (never locale order, which depends on the host). */
const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Structural equality of plain data (objects, arrays, primitives), as descriptors are. */
export function plainEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!plainEqual(a[i], b[i])) return false;
    return true;
  }
  const left = a as Readonly<Record<string, unknown>>;
  const right = b as Readonly<Record<string, unknown>>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) if (!Object.hasOwn(right, key) || !plainEqual(left[key], right[key])) return false;
  return true;
}

/** `1234567` → `1,234,567` (fixed separators: no host locale). */
export function groupDigits(n: number): string {
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.trunc(Math.abs(n)));
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return sign + out;
}

const plural = (n: number, one: string, many: string): string => `${groupDigits(n)} ${n === 1 ? one : many}`;

/** A stable key for a subject: `npc:3143`, `object:1619`, `event:<questId>:<objective>`. */
export function subjectKey(subject: PointSubject): string {
  switch (subject.kind) {
    case 'npc':
      return `npc:${String(subject.id)}`;
    case 'object':
      return `object:${String(subject.id)}`;
    case 'event':
      return `event:${String(subject.questId)}:${String(subject.objective)}`;
  }
}

const sortedUniqueNumbers = <T extends number>(values: readonly T[]): readonly T[] => [...new Set(values)].sort((a, b) => a - b);
const sortedUniqueStrings = <T extends string>(values: readonly T[]): readonly T[] => [...new Set(values)].sort(compareStrings);

/** Hands out ids unique within one layer: a repeated base id gets `~2`, `~3`, ... in order of appearance. */
class IdAllocator {
  private readonly seen = new Map<string, number>();

  take(base: string): string {
    const count = (this.seen.get(base) ?? 0) + 1;
    this.seen.set(base, count);
    return count === 1 ? base : `${base}~${String(count)}`;
  }
}

class ReasonTally {
  private readonly counts = new Map<UnplacedReason, number>();
  total = 0;

  add(reason: UnplacedReason): void {
    this.counts.set(reason, (this.counts.get(reason) ?? 0) + 1);
    this.total += 1;
  }

  toRecord(): Readonly<Partial<Record<UnplacedReason, number>>> {
    const out: Partial<Record<UnplacedReason, number>> = {};
    for (const reason of [...this.counts.keys()].sort(compareStrings)) out[reason] = this.counts.get(reason) ?? 0;
    return out;
  }
}

/** The canonical badge order (`MARKER_BADGES` in adapter.ts, which this module may import only types from). */
const BADGE_ORDER: readonly MarkerBadge[] = ['instance', 'off-frame', 'leg-unknown'];

/** A marker that stands for one item. */
function singleMarker(fields: Omit<MarkerDescriptor, 'type' | 'count' | 'refs' | 'labels'>): MarkerDescriptor {
  return { type: 'marker', ...fields, count: 1, refs: [fields.ref], labels: [fields.label] };
}

const areaOf = (b: { readonly xMin: number; readonly xMax: number; readonly yMin: number; readonly yMax: number }): number =>
  (b.xMax - b.xMin) * (b.yMax - b.yMin);

const rowBounds = (row: GeometryAssignment): WorldBounds => ({ mapId: row.mapId, xMin: row.xMin, xMax: row.xMax, yMin: row.yMin, yMax: row.yMax });

/** A UiMap's single full-rectangle row, the only kind that places a whole map on one world rectangle; null otherwise. */
function wholeMapRow(geometry: MapGeometry, uiMapId: UiMapId): GeometryAssignment | null {
  const rows = geometry.maps.get(uiMapId)?.assignments ?? [];
  const [only] = rows;
  return rows.length === 1 && only !== undefined && isFullUiRectangle(only) ? only : null;
}

/** Zone-level UiMaps (a single full-rectangle row with an AreaID, as zone frames are) by their world map, per geometry. */
const zoneMapsByGeometry = new WeakMap<MapGeometry, ReadonlyMap<UiMapId, WorldMapId>>();

/**
 * The UiMaps that name a zone: those drawn as zone frames (one full-rectangle row with AreaID > 0),
 * with their world map. The world map (Azeroth 947, one row per continent) and the continents
 * (AreaID 0) are not zones.
 */
function zoneMapsOf(geometry: MapGeometry): ReadonlyMap<UiMapId, WorldMapId> {
  const cached = zoneMapsByGeometry.get(geometry);
  if (cached !== undefined) return cached;
  const zones = new Map<UiMapId, WorldMapId>();
  for (const map of geometry.maps.values()) {
    const row = wholeMapRow(geometry, map.uiMapId);
    if (row !== null && row.areaId > 0) zones.set(map.uiMapId, row.mapId);
  }
  zoneMapsByGeometry.set(geometry, zones);
  return zones;
}

// =============================================================================================
// Surfaces

/**
 * One surface per world map of the geometry (ARCHITECTURE §7.2), ascending by map id. The extent
 * is the continent frame where the map has exactly one continent UiMap (type 2 with a parent other
 * than the root, which rules out the alternative continents 1463 and 1464); otherwise the union of
 * the map's zone frames plus `margin` of its size on every side (MAPS §7.1, §8.1). A world map with
 * neither has no surface.
 */
export function surfacesOf(geometry: MapGeometry, margin = 0.05): readonly WorldSurfaceInfo[] {
  const out: WorldSurfaceInfo[] = [];
  for (const mapId of worldMapIds(geometry)) {
    const uiMapIds: UiMapId[] = [];
    const continents: { readonly uiMapId: UiMapId; readonly name: string; readonly row: GeometryAssignment }[] = [];
    const zones: { readonly name: string; readonly row: GeometryAssignment }[] = [];
    for (const map of geometry.maps.values()) {
      const row = wholeMapRow(geometry, map.uiMapId);
      if (row?.mapId !== mapId) continue;
      uiMapIds.push(map.uiMapId);
      if (map.type === 2 && map.parent !== null && map.parent > 0) continents.push({ uiMapId: map.uiMapId, name: map.name, row });
      if (row.areaId > 0) zones.push({ name: map.name, row });
    }
    const [continent] = continents;
    let extent: WorldBounds | null = null;
    if (continents.length === 1 && continent !== undefined) extent = rowBounds(continent.row);
    else if (zones.length > 0) {
      const xMin = Math.min(...zones.map((z) => z.row.xMin));
      const xMax = Math.max(...zones.map((z) => z.row.xMax));
      const yMin = Math.min(...zones.map((z) => z.row.yMin));
      const yMax = Math.max(...zones.map((z) => z.row.yMax));
      const dx = (xMax - xMin) * margin;
      const dy = (yMax - yMin) * margin;
      extent = { mapId, xMin: xMin - dx, xMax: xMax + dx, yMin: yMin - dy, yMax: yMax + dy };
    }
    if (extent === null) continue;
    const zoneNames = [...new Set(zones.map((z) => z.name))];
    const [onlyZoneName] = zoneNames;
    const name =
      continents.length === 1 && continent !== undefined
        ? continent.name
        : zoneNames.length === 1 && onlyZoneName !== undefined
          ? onlyZoneName
          : `World map ${String(mapId)}`;
    out.push({
      id: `world:${String(mapId)}` as SurfaceId,
      mapId,
      name,
      extent,
      extentSource: continents.length === 1 ? 'continent' : 'zone-union',
      extentUiMapId: continents.length === 1 && continent !== undefined ? continent.uiMapId : null,
      uiMapIds,
    });
  }
  return out;
}

/**
 * The atlas surface (docs/research/map-atlas.md §5, §8.1; D-042): `layout`'s placements over the
 * geometry's UiMap 947 rows (`atlasPlacements`), with each placed map's own world surface as a
 * member (its name, continent frame and UiMaps). Its extent is the layout's, card included, in the
 * yards of the first placed map (Kalimdor). Null when the geometry cannot place the layout (a
 * missing or duplicate 947 row, the inset's row missing): nothing is guessed.
 */
export function atlasSurfaceOf(geometry: MapGeometry, layout: AtlasLayout = ATLAS_LAYOUT, worlds: readonly WorldSurfaceInfo[] = surfacesOf(geometry)): AtlasSurfaceInfo | null {
  const placements = atlasPlacements(geometry, layout);
  const [first] = placements ?? [];
  if (placements === null || first === undefined) return null;
  const members = placements.map(
    (placement): WorldSurfaceInfo =>
      worlds.find((surface) => surface.mapId === placement.mapId) ?? {
        id: `world:${String(placement.mapId)}` as SurfaceId,
        mapId: placement.mapId,
        name: `World map ${String(placement.mapId)}`,
        extent: placement.rect,
        extentSource: 'zone-union',
        extentUiMapId: null,
        uiMapIds: [],
      },
  );
  const { extent } = layout;
  return {
    kind: 'atlas',
    id: 'atlas',
    mapId: first.mapId,
    name: geometry.maps.get(layout.worldMap.uiMapId)?.name ?? `UiMap ${String(layout.worldMap.uiMapId)}`,
    // x = sOff − S, y = eOff − E (map-atlas.md §5.2): the atlas rectangle in the first map's yards.
    extent: { mapId: first.mapId, xMin: first.sOff - extent.sMax, xMax: first.sOff - extent.sMin, yMin: first.eOff - extent.eMax, yMax: first.eOff - extent.eMin },
    extentSource: 'atlas',
    extentUiMapId: null,
    uiMapIds: sortedUniqueNumbers(members.flatMap((member) => member.uiMapIds)),
    mapIds: placements.map((placement) => placement.mapId),
    placements,
    layout,
    hash: atlasHash(placements, layout),
    members,
  };
}

/**
 * The surfaces with the atlas on (map-atlas.md §5.6, §8.5): the atlas first, then the world surfaces
 * of the maps it does not place (Darkspear Islands, instances, battlegrounds: "separate maps").
 * Without an atlas (the geometry cannot place it), the world surfaces alone.
 */
export function atlasSurfacesOf(geometry: MapGeometry, layout: AtlasLayout = ATLAS_LAYOUT): readonly SurfaceInfo[] {
  const worlds = surfacesOf(geometry);
  const atlas = atlasSurfaceOf(geometry, layout, worlds);
  return atlas === null ? worlds : [atlas, ...worlds.filter((surface) => !atlas.mapIds.includes(surface.mapId))];
}

const surfaceName = (surfaces: readonly SurfaceInfo[], mapId: WorldMapId): string =>
  surfaces.find((surface) => surface.mapId === mapId)?.name ?? `World map ${String(mapId)}`;

// =============================================================================================
// Route steps → placements (until the engine walk provides positions, Milestone 6)

const hintOf = (source: SourcedPoint): UiMapId | null => source.uiMapId;

function isOffFrame(source: SourcedPoint, world: WorldPoint, geometry: MapGeometry): boolean {
  if (source.space === 'zone') return source.x < 0 || source.x > 100 || source.y < 0 || source.y > 100;
  if (source.uiMapId === null) return false;
  const row = assignmentForWorld(geometry, source.uiMapId, world.mapId);
  if (row === null) return false;
  return world.x < row.xMin || world.x > row.xMax || world.y < row.yMin || world.y > row.yMax;
}

/**
 * Where a step puts the character, from its authored location (ARCHITECTURE §6, §8.1):
 * - a location that resolves is a `point` (with the UiMap it names and whether it lies outside
 *   that zone's frame);
 * - a location that does not resolve is `unknown` with the resolution reason;
 * - a travel step without a location (RXP `.zone`, `.subzone`, `.explore`) is `unknown`
 *   (`destination-unknown`): the character went somewhere the route does not say;
 * - so is a hearth `use` without a location: the character lands at its bind point, which is
 *   unknown until the engine walk knows it (Milestone 6), so the line ends there and the next
 *   placed step's leg is unknown, rather than a teleport drawn to the next step;
 * - any other step without a location is `none`: it does not move the character. A flight `take`
 *   without a location is also `none` here; `legOf` styles the next leg instead.
 *
 * This is a drawing approximation until the engine walk exists (Milestone 6): for example it does
 * not detect death skips (preserved notes).
 */
export function placeStep(step: RouteStep, geometry: MapGeometry): StepPlacement {
  if (step.location !== null) {
    const resolution = resolveDetailed(step.location, geometry);
    if (resolution.kind === 'unresolved') return { kind: 'unknown', reason: resolution.reason };
    const source = step.location.source;
    return { kind: 'point', world: resolution.point, uiMapId: hintOf(source), offFrame: isOffFrame(source, resolution.point, geometry) };
  }
  if (step.kind === 'travel' || (step.kind === 'hearth' && step.mode === 'use')) return { kind: 'unknown', reason: 'destination-unknown' };
  return { kind: 'none' };
}

/**
 * How the character reaches a step and leaves it:
 * - `travel` in `transport` mode arrives by transport (its location is the destination dock);
 * - a flight `take` is walked to (its location is where the flight is taken) and departs by flight;
 * - a hearth `use` with a location arrives by hearth (the location is the destination); without
 *   one it departs by hearth: its placement is `unknown`, so the route line ends at the point it
 *   leaves from, with a departure glyph;
 * - everything else arrives on foot or mounted (`route`) and departs normally.
 */
export function legOf(step: RouteStep): { readonly arrive: LegStyle; readonly departs: LegStyle | null } {
  switch (step.kind) {
    case 'travel':
      return { arrive: step.mode === 'transport' ? 'transport' : 'route', departs: null };
    case 'flight':
      return { arrive: 'route', departs: step.mode === 'take' ? 'flight' : null };
    case 'hearth':
      if (step.mode === 'bind') return { arrive: 'route', departs: null };
      return step.location === null ? { arrive: 'route', departs: 'hearth' } : { arrive: 'hearth', departs: null };
    case 'accept':
    case 'complete':
    case 'turnin':
    case 'abandon':
    case 'grind':
    case 'train':
    case 'vendor':
    case 'note':
      return { arrive: 'route', departs: null };
  }
}

/** One step's route-layer input: `placeStep` and `legOf`, with the caller's quest ids. No position and no text (see `RouteStepInput`). */
export function routeStepInputOf(step: RouteStep, geometry: MapGeometry, questIds: readonly QuestId[]): RouteStepInput {
  const leg = legOf(step);
  return { stepId: step.id, placement: placeStep(step, geometry), arrive: leg.arrive, departs: leg.departs, questIds };
}

/** The route-layer input for a route: `routeStepInputOf` per step, with the caller's quest ids. */
export function routeInputOf(
  steps: readonly RouteStep[],
  geometry: MapGeometry,
  questIdsOf: (step: RouteStep) => readonly QuestId[] = () => [],
): RouteInput {
  return { steps: steps.map((step) => routeStepInputOf(step, geometry, questIdsOf(step))) };
}

// =============================================================================================
// Candidates, the cap and finishing a layer

type Anchor =
  | { readonly kind: 'point'; readonly x: number; readonly y: number }
  | { readonly kind: 'box'; readonly xMin: number; readonly xMax: number; readonly yMin: number; readonly yMax: number };

interface Candidate {
  readonly descriptor: MapDescriptor;
  /** 0: focused, kept first under the cap. */
  readonly tier: 0 | 1;
  readonly anchor: Anchor;
}

/** What a layer would draw before the cap: candidates in draw order (bottom first) and the counts. */
interface Collected {
  readonly candidates: readonly Candidate[];
  readonly aggregated: number;
  /** Points folded into clusters (map-presentation.md §25.2.5); absent when the layer clusters nothing. */
  readonly clustered?: number;
  readonly unresolved: ReasonTally;
  readonly otherSurfaces: number;
  /** The route line with walking paths: its walked legs on this world map by path state. */
  readonly paths?: LegPathCounts;
  /**
   * A share of the budget some candidates may take at most (map-presentation.md §25.7: the counted
   * objective marks, at most 50 of the objectives' 500): over it, those nearest the centre are kept.
   */
  readonly limited?: { readonly ids: ReadonlySet<string>; readonly max: number };
  /**
   * Candidates kept before any other under the budget (§7.4: the log's outlines and counted marks,
   * so a focused quest's hundreds of raw points never crowd them out; "the outline still shows the
   * whole area").
   */
  readonly reserved?: ReadonlySet<string>;
}

type Center = { readonly x: number; readonly y: number } | null;

const pointAnchor = (p: { readonly x: number; readonly y: number }): Anchor => ({ kind: 'point', x: p.x, y: p.y });

function boxAnchor(points: readonly { readonly x: number; readonly y: number }[]): Anchor {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of points) {
    xMin = Math.min(xMin, p.x);
    xMax = Math.max(xMax, p.x);
    yMin = Math.min(yMin, p.y);
    yMax = Math.max(yMax, p.y);
  }
  return { kind: 'box', xMin, xMax, yMin, yMax };
}

/** Squared distance from the centre to the anchor (0 inside a box). Squares only: no rounding-sensitive functions. */
function distanceSq(anchor: Anchor, center: { readonly x: number; readonly y: number }): number {
  if (anchor.kind === 'point') {
    const dx = anchor.x - center.x;
    const dy = anchor.y - center.y;
    return dx * dx + dy * dy;
  }
  const dx = center.x < anchor.xMin ? anchor.xMin - center.x : center.x > anchor.xMax ? center.x - anchor.xMax : 0;
  const dy = center.y < anchor.yMin ? anchor.yMin - center.y : center.y > anchor.yMax ? center.y - anchor.yMax : 0;
  return dx * dx + dy * dy;
}

const usableCenter = (center: Center): Center =>
  center !== null && Number.isFinite(center.x) && Number.isFinite(center.y) ? { x: center.x, y: center.y } : null;

/** Whether an anchor lies in (a point) or overlaps (a box) the rectangle. */
function anchorMeets(anchor: Anchor, bounds: WorldBounds): boolean {
  if (anchor.kind === 'point') return anchor.x >= bounds.xMin && anchor.x <= bounds.xMax && anchor.y >= bounds.yMin && anchor.y <= bounds.yMax;
  return anchor.xMin <= bounds.xMax && anchor.xMax >= bounds.xMin && anchor.yMin <= bounds.yMax && anchor.yMax >= bounds.yMin;
}

/**
 * The `count` candidates of `indices` nearest the centre, ties (and no centre) by id: the same
 * order a full sort by (distance, id) gives, without sorting everything (a 10,000-step route is
 * ranked on every edit while the cap bites).
 */
function nearest(candidates: readonly Candidate[], indices: readonly number[], center: Center, count: number): readonly number[] {
  const idOf = (index: number): string => candidates[index]?.descriptor.id ?? '';
  const byId = (a: number, b: number): number => compareStrings(idOf(a), idOf(b));
  if (center === null) return [...indices].sort(byId).slice(0, count);
  const distances = indices.map((index) => {
    const candidate = candidates[index];
    return candidate === undefined ? Infinity : distanceSq(candidate.anchor, center);
  });
  // The count-th smallest distance: everything nearer is kept, and ties at it go by id.
  const threshold = Float64Array.from(distances).sort()[count - 1] ?? Infinity;
  const out: number[] = [];
  const ties: number[] = [];
  indices.forEach((index, i) => {
    const distance = distances[i] ?? Infinity;
    if (distance < threshold) out.push(index);
    else if (distance === threshold) ties.push(index);
  });
  out.push(...ties.sort(byId).slice(0, count - out.length));
  return out;
}

/**
 * Applies the budget: all candidates when they fit; otherwise focused first, then those `held`
 * (already drawn and still in view, memoised builders only), then nearest the centre, ties by id,
 * keeping the survivors in draw order.
 */
function finish(
  collected: Collected,
  center: Center,
  budget: number,
  held: ((candidate: Candidate) => boolean) | null = null,
): { readonly items: readonly MapDescriptor[]; readonly stats: LayerStats } {
  let candidates = collected.candidates;
  const limited = collected.limited;
  if (limited !== undefined) {
    const indices = candidates.flatMap((candidate, index) => (limited.ids.has(candidate.descriptor.id) ? [index] : []));
    if (indices.length > limited.max) {
      const keep = new Set(nearest(candidates, indices, center, limited.max));
      candidates = candidates.filter((candidate, index) => !limited.ids.has(candidate.descriptor.id) || keep.has(index));
    }
  }
  let kept: readonly Candidate[] = candidates;
  if (candidates.length > budget) {
    // By rank group (reserved, focused, held, the rest), each filled nearest first while the budget lasts.
    const reserved = collected.reserved;
    const groups: number[][] = [[], [], [], []];
    candidates.forEach((candidate, index) => {
      const group = reserved?.has(candidate.descriptor.id) === true ? 0 : candidate.tier === 0 ? 1 : held?.(candidate) === true ? 2 : 3;
      groups[group]?.push(index);
    });
    const keep = new Set<number>();
    for (const group of groups) {
      const room = budget - keep.size;
      if (room <= 0) break;
      for (const index of group.length <= room ? group : nearest(candidates, group, center, room)) keep.add(index);
    }
    kept = candidates.filter((_, index) => keep.has(index));
  }
  const items = kept.map((candidate) => candidate.descriptor);
  const stats: LayerStats = {
    drawn: items.length,
    notDrawn: collected.candidates.length - items.length,
    aggregated: collected.aggregated,
    ...(collected.clustered === undefined ? {} : { clustered: collected.clustered }),
    unresolved: collected.unresolved.total,
    unresolvedBy: collected.unresolved.toRecord(),
    otherSurfaces: collected.otherSurfaces,
  };
  return { items, stats: collected.paths === undefined ? stats : { ...stats, paths: collected.paths } };
}

const byDescriptorId = (a: Candidate, b: Candidate): number => compareStrings(a.descriptor.id, b.descriptor.id);

/** Focused candidates (tier 0) after the rest, each part in its own order: focused items draw on top. */
const focusedLast = (candidates: readonly Candidate[]): Candidate[] => [
  ...candidates.filter((candidate) => candidate.tier !== 0),
  ...candidates.filter((candidate) => candidate.tier === 0),
];

// ---- Stacks

const EMPHASIS_RANK: Readonly<Record<Emphasis, number>> = { dim: 0, normal: 1, strong: 2 };

/** Markers merge when they are the same kind and style at the identical world point. */
const sameStack = (a: MarkerDescriptor, b: MarkerDescriptor): boolean =>
  a.point.x === b.point.x && a.point.y === b.point.y && a.point.mapId === b.point.mapId && a.kind === b.kind && a.style === b.style;

function mergedStack(stack: readonly Candidate[]): Candidate {
  const markers = stack.map((candidate) => candidate.descriptor as MarkerDescriptor);
  const [first] = markers;
  const [head] = stack;
  if (first === undefined || head === undefined) throw new Error('mergedStack: empty stack');
  let emphasis: Emphasis = first.emphasis;
  for (const marker of markers) if (EMPHASIS_RANK[marker.emphasis] > EMPHASIS_RANK[emphasis]) emphasis = marker.emphasis;
  const badges = new Set(markers.flatMap((marker) => marker.badges));
  const refs: MapRef[] = markers.flatMap((marker) => marker.refs);
  const mark = bestMark(markers);
  const { mark: _firstMark, category: firstCategory, ...rest } = first;
  // A stack's drawer row is its best member's (a quest giver's by its state).
  const category = firstCategory === undefined ? undefined : mark === undefined ? firstCategory : categoryOfMarkState(mark.state);
  const descriptor: MarkerDescriptor = {
    ...rest,
    emphasis,
    badges: BADGE_ORDER.filter((badge) => badges.has(badge)),
    count: markers.reduce((sum, marker) => sum + marker.count, 0),
    refs,
    labels: markers.flatMap((marker) => marker.labels),
    ...(mark === undefined ? {} : { mark }),
    ...(category === undefined ? {} : { category }),
  };
  return { descriptor, tier: stack.some((candidate) => candidate.tier === 0) ? 0 : 1, anchor: head.anchor };
}

/**
 * A stack's quest-mark state (map-presentation.md §7.2, §25.2.3): the best-ranked member's state
 * (available, may be available, needs a prerequisite, unlocks soon, low level; for turn-ins ready,
 * in progress, record unknown), with a difficulty only when every member of that rank shares it.
 * The pins' group rule (`groupLook`, step MP.4a) draws it.
 */
const MARK_RANK: Readonly<Partial<Record<MarkerMark['state'], number>>> = {
  available: 0,
  uncertain: 1,
  locked: 2,
  'unlocks-soon': 3,
  'low-level': 4,
  ready: 0,
  'in-progress': 1,
  'record-unknown': 2,
};

function bestMark(markers: readonly MarkerDescriptor[]): MarkerMark | undefined {
  let best: MarkerMark[] = [];
  let bestRank = Infinity;
  for (const marker of markers) {
    const mark = marker.mark;
    if (mark === undefined) continue;
    const rank = MARK_RANK[mark.state] ?? 9;
    if (rank < bestRank) {
      best = [mark];
      bestRank = rank;
    } else if (rank === bestRank) best.push(mark);
  }
  const [first] = best;
  if (first === undefined) return undefined;
  if (best.length === 1) return first;
  const difficulty = best.every((mark) => mark.difficulty === first.difficulty) ? first.difficulty : null;
  return { state: first.state, difficulty, dungeonQuest: best.some((mark) => mark.dungeonQuest), progress: null };
}

/**
 * Merged stacks by their first member, for a builder that sees the same candidate objects again
 * (the route's step markers): a stack whose members are the same objects in the same order keeps
 * its merged candidate, so a route edit merges only the stacks it touched (M3 review PERF-2).
 */
type StackCache = WeakMap<Candidate, { readonly members: readonly Candidate[]; readonly merged: Candidate }>;

function cachedStack(members: readonly Candidate[], cache: StackCache | null): Candidate {
  const [head] = members;
  if (cache === null || head === undefined) return mergedStack(members);
  const hit = cache.get(head);
  if (hit !== undefined && hit.members.length === members.length && hit.members.every((member, i) => member === members[i])) return hit.merged;
  const merged = mergedStack(members);
  cache.set(head, { members, merged });
  return merged;
}

/**
 * Merges markers at the identical world point (same kind and style) into one marker (MAPS §7.3):
 * the first item's id, label and ref, every item's refs and labels in order, the union of the
 * badges, the strongest emphasis and the focused tier if any item has it. A stack takes the place
 * of its last item, so it draws where its topmost item would. Other candidates pass through, and
 * nothing changes when no two markers share a point.
 */
function mergeStacks(candidates: readonly Candidate[], cache: StackCache | null = null): readonly Candidate[] {
  // Only markers that share an x coordinate can stack, and few do: one numeric map finds them, and
  // only those are compared in full (10,000 steps cost about a millisecond).
  const firstAtX = new Map<number, number>();
  const sharingX = new Map<number, number[]>();
  candidates.forEach((candidate, index) => {
    if (candidate.descriptor.type !== 'marker') return;
    const x = candidate.descriptor.point.x;
    const first = firstAtX.get(x);
    if (first === undefined) firstAtX.set(x, index);
    else {
      const indices = sharingX.get(x);
      if (indices === undefined) sharingX.set(x, [first, index]);
      else indices.push(index);
    }
  });
  if (sharingX.size === 0) return candidates;
  const markerAt = (index: number): MarkerDescriptor | null => {
    const descriptor = candidates[index]?.descriptor;
    return descriptor?.type === 'marker' ? descriptor : null;
  };
  /** Stack members (ascending indices) by the index of their last member, where the stack is drawn. */
  const stackAt = new Map<number, number[]>();
  const inStack = new Set<number>();
  for (const indices of sharingX.values()) {
    for (let position = 0; position < indices.length; position += 1) {
      const head = indices[position];
      if (head === undefined) continue;
      const lead = markerAt(head);
      if (lead === null || inStack.has(head)) continue;
      const members = [head];
      for (let next = position + 1; next < indices.length; next += 1) {
        const other = indices[next];
        if (other === undefined) continue;
        const candidate = markerAt(other);
        if (candidate !== null && !inStack.has(other) && sameStack(lead, candidate)) members.push(other);
      }
      if (members.length < 2) continue;
      for (const member of members) inStack.add(member);
      stackAt.set(members[members.length - 1] ?? head, members);
    }
  }
  if (stackAt.size === 0) return candidates;
  const out: Candidate[] = [];
  candidates.forEach((candidate, index) => {
    if (!inStack.has(index)) {
      out.push(candidate);
      return;
    }
    const members = stackAt.get(index);
    if (members !== undefined) out.push(cachedStack(members.flatMap((member) => candidates[member] ?? []), cache));
  });
  return out;
}

/** Everything a stateless builder needs besides its inputs. */
export interface LayerContext {
  readonly geometry: MapGeometry;
  /** One world surface per world map (`surfacesOf`): names, continent frames. */
  readonly surfaces: readonly SurfaceInfo[];
  readonly lod: LodSettings;
  /** The atlas over this geometry (`atlasSurfaceOf`), for views on it; null when the geometry cannot place it. */
  readonly atlas?: AtlasSurfaceInfo | null;
}

export function layerContextOf(geometry: MapGeometry, lod: LodSettings = DEFAULT_LOD): LayerContext {
  const surfaces = surfacesOf(geometry);
  return { geometry, surfaces, lod, atlas: atlasSurfaceOf(geometry, ATLAS_LAYOUT, surfaces) };
}

/** The atlas a view is on, or null for a world surface's view (or an atlas the geometry cannot place). */
const atlasOfView = (ctx: LayerContext, view: MapView): AtlasSurfaceInfo | null => (view.surface === 'atlas' ? (ctx.atlas ?? null) : null);

/**
 * Where an item on world map `mapId` belongs for a builder of `mapId`'s view: `here` (drawn by this
 * builder), `placed` (on another map the view's surface places: that map's builder draws it, so it
 * is neither drawn nor counted here), or `elsewhere` (a map the surface does not show:
 * `otherSurfaces`). On a world surface only the view's own map is placed.
 */
type Whereabouts = (mapId: WorldMapId) => 'here' | 'placed' | 'elsewhere';

function whereaboutsOf(ctx: LayerContext, view: MapView): Whereabouts {
  const own = view.mapId;
  const atlas = atlasOfView(ctx, view);
  if (atlas === null) return (mapId) => (mapId === own ? 'here' : 'elsewhere');
  const placed = new Set<number>(atlas.mapIds);
  return (mapId) => (mapId === own ? 'here' : placed.has(mapId) ? 'placed' : 'elsewhere');
}

/** The world maps the view builds layers for (`viewMapIds` in adapter.ts, which this module may import only types from). */
function activeMapsOf(view: MapView): readonly WorldMapId[] {
  const visible = view.visible;
  if (visible === undefined) return [view.mapId];
  const ids = visible.map((bounds) => bounds.mapId);
  return ids.includes(view.mapId) ? ids : [...ids, view.mapId];
}

/**
 * The part of a connector layer's memo key its surface decides: nothing on a world surface; on the
 * atlas, the surface and its active maps (a connector is drawn by its `from` map while that map is
 * active, else by its `to` map: `collectRouteLine`, `collectPlaces`).
 */
const surfaceKeyOf = (ctx: LayerContext, view: MapView): string | null => {
  const atlas = atlasOfView(ctx, view);
  if (atlas === null) return null;
  // Only a map placed as a map (not an inset) can emit a connector (`isConnector`).
  const emitters = activeMapsOf(view).filter((mapId) => atlas.placements.some((placement) => placement.mapId === mapId && placement.kind === 'placed'));
  return `atlas:${[...emitters].sort((a, b) => a - b).join(',')}`;
};

/**
 * The part of every other layer's memo key its surface decides (review MR-01): only whether the
 * view is on the atlas. Their items depend on the builder's own map and on the maps the atlas
 * places (`whereaboutsOf`), never on which maps the padded view meets, so a pan or zoom that brings
 * a map into the view collects nothing again, and a band crossing finds the idle prebuild.
 */
const placedKeyOf = (ctx: LayerContext, view: MapView): string | null => (atlasOfView(ctx, view) === null ? null : 'atlas');

/** Whether a place layer's input has a connector (a ride between the continents), whose builder depends on the active maps. */
const placeConnectors = new WeakMap<PlaceLayerInput, boolean>();
function hasConnector(input: PlaceLayerInput): boolean {
  const known = placeConnectors.get(input);
  if (known !== undefined) return known;
  const found = input.items.some((item) => item.descriptor.type === 'connector');
  placeConnectors.set(input, found);
  return found;
}

/** A place layer's surface key: the active maps only when its input has a connector. */
const placesKeyOf = (ctx: LayerContext, view: MapView, input: PlaceLayerInput): string | null => (hasConnector(input) ? surfaceKeyOf(ctx, view) : placedKeyOf(ctx, view));

const contentOf = (layer: LayerId, collected: Collected, view: MapView, ctx: LayerContext): LayerContent => ({
  layer,
  ...finish(collected, usableCenter(view.center), budgetOf(ctx.lod, layer, bandOfView(view))),
});

// =============================================================================================
// Zone frames

/** An inset card's caption on the atlas (map-atlas.md §5.5; the full note is in the legend and status line). */
export const insetCaption = (name: string): string => `${name}: separate map, not in position`;

/**
 * The interior city maps the atlas tiles draw as cards at their rectangle, at tile levels −1 and 0
 * (map-atlas.md §6.1, §8.5: Ironforge 1455 and Undercity 1458, the cities with no terrain polygon;
 * the design's list, which tools/maps/lib/atlas-params.ts `CITY_UIMAPS` composes).
 */
export const ATLAS_CITY_CARDS: readonly UiMapId[] = [1455 as UiMapId, 1458 as UiMapId];

/** The finest tile level the atlas draws at a zoom (Leaflet's `Math.round`, capped at the finest native level 0). */
export const atlasTileLevelAt = (zoom: number): number => Math.min(0, Math.round(zoom));

/**
 * How the zone frames sit over the atlas tiles (map-atlas.md §8.5, §8.6; D-042 A8): the zone
 * rectangles are kept but not painted (`hidden`), and at tile levels −1 and 0 the city cards get a
 * frame and a caption (`cards`); an inset's card is drawn over the tiles either way.
 */
interface OverTiles {
  readonly cards: boolean;
  /**
   * The minimap style at the zone band or closer (D-049 O19; map-atlas.md §22): the underground
   * cities' frames (`ATLAS_CITY_CARDS`, whose minimap shows only Ironforge's gate and the ruins of
   * Lordaeron) are drawn as dashed outlines in the frame colour, uncaptioned (the labels canvas names
   * them "… (underground city)").
   */
  readonly underground?: boolean;
}

function collectZoneFrames(
  ctx: LayerContext,
  mapId: WorldMapId,
  focusZone: UiMapId | null,
  filled: boolean,
  atlas: AtlasSurfaceInfo | null = null,
  overTiles: OverTiles | null = null,
): Collected {
  const surface = ctx.surfaces.find((candidate) => candidate.mapId === mapId);
  const frames: { readonly candidate: Candidate; readonly area: number; readonly uiMapId: UiMapId }[] = [];
  for (const map of ctx.geometry.maps.values()) {
    const rows = map.assignments.filter((row) => row.mapId === mapId && row.areaId > 0 && isFullUiRectangle(row));
    for (const row of rows) {
      const bounds = rowBounds(row);
      const focused = map.uiMapId === focusZone;
      const card = overTiles !== null && overTiles.cards && ATLAS_CITY_CARDS.includes(map.uiMapId);
      const base: FrameDescriptor = {
        type: 'frame',
        id: rows.length === 1 ? `frame:${String(map.uiMapId)}` : `frame:${String(map.uiMapId)}:${String(row.orderIndex)}`,
        bounds,
        kind: 'zone',
        label: map.name,
        emphasis: focused ? 'strong' : 'normal',
        filled,
        ref: { kind: 'zone', uiMapId: map.uiMapId },
      };
      const underground = overTiles?.underground === true && ATLAS_CITY_CARDS.includes(map.uiMapId);
      const descriptor: FrameDescriptor =
        overTiles === null
          ? base
          : card
            ? { ...base, kind: 'card', emphasis: 'normal', filled: false, overTiles: true }
            : underground
              ? { ...base, label: null, filled: false, dashed: true }
              : { ...base, filled: false, hidden: true };
      frames.push({ candidate: { descriptor, tier: focused ? 0 : 1, anchor: { kind: 'box', ...bounds } }, area: areaOf(bounds), uiMapId: map.uiMapId });
    }
  }
  // Large frames first so cities draw over their zones; the focused frame last, on top.
  frames.sort((a, b) => b.candidate.tier - a.candidate.tier || b.area - a.area || a.uiMapId - b.uiMapId || byDescriptorId(a.candidate, b.candidate));
  const candidates: Candidate[] = [];
  if (atlas !== null) {
    // The atlas draws no continent extents (they overlap each other there); an inset gets its card:
    // a vector frame round its placed rectangle, captioned (map-atlas.md §5.5, §8.5).
    const placement = atlas.placements.find((candidate) => candidate.mapId === mapId);
    if (placement?.kind === 'inset') {
      const bounds: WorldBounds = { mapId, xMin: placement.rect.xMin, xMax: placement.rect.xMax, yMin: placement.rect.yMin, yMax: placement.rect.yMax };
      const card: FrameDescriptor = {
        type: 'frame',
        id: `inset:${String(mapId)}`,
        bounds,
        kind: 'inset',
        label: insetCaption(surface?.name ?? `World map ${String(mapId)}`),
        emphasis: 'normal',
        filled: false,
        ...(overTiles === null ? {} : { overTiles: true }),
        ref: { kind: 'surface', mapId },
      };
      candidates.push({ descriptor: card, tier: 0, anchor: { kind: 'box', ...bounds } });
    }
  } else if (surface !== undefined) {
    const extent: FrameDescriptor = {
      type: 'frame',
      id: `extent:${String(mapId)}`,
      bounds: surface.extent,
      kind: 'extent',
      label: null,
      emphasis: 'normal',
      filled: false,
      ref: { kind: 'surface', mapId },
    };
    candidates.push({ descriptor: extent, tier: 0, anchor: { kind: 'box', ...surface.extent } });
  }
  candidates.push(...frames.map((frame) => frame.candidate));
  return { candidates, aggregated: 0, unresolved: new ReasonTally(), otherSurfaces: 0 };
}

/**
 * Zone frames (outlines with labels) of the view's world map, plus its extent frame. `filled`
 * false leaves out the zone frames' faint fill (over painted map art).
 */
export function buildZoneFrames(ctx: LayerContext, view: MapView, focusZone: UiMapId | null = null, filled = true): LayerContent {
  return contentOf('zone-frames', collectZoneFrames(ctx, view.mapId, focusZone, filled, atlasOfView(ctx, view)), view, ctx);
}

// =============================================================================================
// Art (committed, D-033; or a local set's, D-018)

/** A usable image rectangle: finite edges, not empty. */
const isImageRect = (b: WorldBounds): boolean =>
  [b.xMin, b.xMax, b.yMin, b.yMax].every((v) => Number.isFinite(v)) && b.xMax > b.xMin && b.yMax > b.yMin;

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1);

/**
 * On the atlas, the part of an image of a placed map on that map's side of the partition
 * (map-atlas.md §5.4: `E ≤ seamE` west, beyond it east), in the map's yards (`E = eOff − y`); null
 * when the image lies wholly on its side, or the map is an inset (its card is its image). Interim
 * art only: a continent painting's sea and parchment then never cover the other continent.
 */
function partitionClip(atlas: AtlasSurfaceInfo, bounds: WorldBounds): WorldBounds | null {
  const placement = atlas.placements.find((candidate) => candidate.mapId === bounds.mapId);
  const side = atlas.layout.placed.find((spec) => spec.mapId === bounds.mapId)?.side;
  if (placement?.kind !== 'placed' || side === undefined) return null;
  // E ≤ seamE ⇔ y ≥ eOff − seamE.
  const edge = placement.eOff - atlas.layout.seamE;
  if (side === 'west') return bounds.yMin >= edge ? null : { ...bounds, yMin: Math.min(bounds.yMax, edge) };
  return bounds.yMax <= edge ? null : { ...bounds, yMax: Math.max(bounds.yMin, edge) };
}

function collectArt(ctx: LayerContext, art: readonly ArtInput[], mapId: WorldMapId, atlas: AtlasSurfaceInfo | null = null, where: Whereabouts | null = null): Collected {
  const unresolved = new ReasonTally();
  let otherSurfaces = 0;
  const seen = new Set<number>();
  const drawable: { readonly candidate: Candidate; readonly area: number; readonly uiMapId: UiMapId }[] = [];
  for (const entry of [...art].sort((a, b) => a.uiMapId - b.uiMapId)) {
    if (seen.has(entry.uiMapId)) continue;
    seen.add(entry.uiMapId);
    // The manifest's own rectangle when it gives one (committed art), else the UiMap's row.
    const row = entry.bounds === undefined ? wholeMapRow(ctx.geometry, entry.uiMapId) : null;
    const bounds = entry.bounds ?? (row === null ? null : rowBounds(row));
    if (bounds === null || !isImageRect(bounds)) {
      unresolved.add('no-geometry');
      continue;
    }
    if (bounds.mapId !== mapId) {
      if ((where?.(bounds.mapId) ?? 'elsewhere') === 'elsewhere') otherSurfaces += 1;
      continue;
    }
    const rect: WorldBounds = { mapId: bounds.mapId, xMin: bounds.xMin, xMax: bounds.xMax, yMin: bounds.yMin, yMax: bounds.yMax };
    const clip = atlas === null ? null : partitionClip(atlas, rect);
    const descriptor: ArtDescriptor = {
      type: 'art',
      id: `art:${String(entry.uiMapId)}`,
      bounds: rect,
      url: entry.url,
      opacity: clamp01(entry.opacity),
      ...(clip === null ? {} : { clip }),
      label: ctx.geometry.maps.get(entry.uiMapId)?.name ?? null,
      ref: { kind: 'art', uiMapId: entry.uiMapId },
    };
    drawable.push({ candidate: { descriptor, tier: 1, anchor: { kind: 'box', ...bounds } }, area: areaOf(bounds), uiMapId: entry.uiMapId });
  }
  // Real continent art wins where it exists (coordinates.md §14.3): zone art, with its painted
  // edges, is not drawn over it. Otherwise zone art is drawn largest first.
  const extentUiMapId = ctx.surfaces.find((surface) => surface.mapId === mapId)?.extentUiMapId ?? null;
  const continent = drawable.find((entry) => entry.uiMapId === extentUiMapId);
  const chosen = continent === undefined ? [...drawable].sort((a, b) => b.area - a.area || a.uiMapId - b.uiMapId) : [continent];
  return { candidates: chosen.map((entry) => entry.candidate), aggregated: 0, unresolved, otherSurfaces };
}

/**
 * Map-art images for the view's world map: the continent image alone where it is given, otherwise
 * the zone images, largest first. An image with no usable rectangle is counted as not placed.
 */
export function buildArt(ctx: LayerContext, art: readonly ArtInput[], view: MapView): LayerContent {
  return contentOf('art', collectArt(ctx, art, view.mapId, atlasOfView(ctx, view), whereaboutsOf(ctx, view)), view, ctx);
}

// =============================================================================================
// Terrain: relief, zone outlines and coastline (D-032; terrain-navigation.md §13.2)

/**
 * The relief's opacity: a full backdrop where no painted art is drawn (none exists, it is hidden,
 * or it failed to load), and faint under the art, which covers it where it exists (§13.2).
 */
export const RELIEF_OPACITY = { backdrop: 0.85, underArt: 0.4 } as const;

/** The first input on the view's world map; the other world maps' inputs are theirs, not counted as items elsewhere. */
function collectRelief(relief: readonly ReliefInput[], mapId: WorldMapId, underArt: boolean): Collected {
  const unresolved = new ReasonTally();
  const candidates: Candidate[] = [];
  for (const entry of relief) {
    if (entry.mapId !== mapId || candidates.length > 0) continue;
    if (entry.bounds.mapId !== mapId || !isImageRect(entry.bounds)) {
      unresolved.add('no-geometry');
      continue;
    }
    const descriptor: ArtDescriptor = {
      type: 'art',
      id: `relief:${String(mapId)}`,
      bounds: { mapId, xMin: entry.bounds.xMin, xMax: entry.bounds.xMax, yMin: entry.bounds.yMin, yMax: entry.bounds.yMax },
      url: entry.url,
      opacity: underArt ? RELIEF_OPACITY.underArt : RELIEF_OPACITY.backdrop,
      label: 'Shaded relief',
      ref: { kind: 'terrain', layer: 'relief', mapId },
    };
    candidates.push({ descriptor, tier: 1, anchor: { kind: 'box', ...entry.bounds } });
  }
  return { candidates, aggregated: 0, unresolved, otherSurfaces: 0 };
}

/**
 * The view's world map's shaded relief image, under every other layer: a backdrop at
 * `RELIEF_OPACITY.backdrop`, or faint (`underArt`) when painted art is drawn over it.
 */
export function buildRelief(ctx: LayerContext, relief: readonly ReliefInput[], view: MapView, underArt = false): LayerContent {
  return contentOf('relief', collectRelief(relief, view.mapId, underArt), view, ctx);
}

type OutlineLayerId = 'zone-outlines' | 'coastline';

const OUTLINE_KIND: Readonly<Record<OutlineLayerId, OutlineDescriptor['kind']>> = { 'zone-outlines': 'zones', coastline: 'coast' };
const OUTLINE_LABEL: Readonly<Record<OutlineLayerId, string>> = { 'zone-outlines': 'Zone outlines', coastline: 'Coastline' };

/** Outline descriptors by input, layer and extent, so an unchanged input keeps its descriptor object (and a rebuild compares nothing). */
const outlineDescriptors = new WeakMap<OutlineInput, Map<string, OutlineDescriptor | null>>();

/** Whether a line has a point inside `extent` (none: every line has). */
const meetsExtent = (line: readonly WorldPoint[], extent: WorldBounds | null): boolean =>
  extent === null || line.some((p) => p.x >= extent.xMin && p.x <= extent.xMax && p.y >= extent.yMin && p.y <= extent.yMax);

/**
 * The extent a world map's terrain outlines are drawn in (review QA-10): its placed rectangle on the
 * atlas, else its world surface's extent; null when the map has neither (every line is kept). A line
 * with no point inside is left out: the client's terrain areas include GM Island (AreaTable 876), a
 * square far outside Kalimdor's placed extent, which no view places.
 */
function outlineExtentOf(ctx: LayerContext, view: MapView, mapId: WorldMapId): WorldBounds | null {
  const atlas = atlasOfView(ctx, view);
  if (atlas !== null) return atlas.placements.find((placement) => placement.mapId === mapId)?.rect ?? null;
  return ctx.surfaces.find((surface): surface is WorldSurfaceInfo => surface.kind !== 'atlas' && surface.mapId === mapId)?.extent ?? null;
}

const extentKey = (extent: WorldBounds | null): string => (extent === null ? '' : `${String(extent.xMin)},${String(extent.xMax)},${String(extent.yMin)},${String(extent.yMax)}`);

function outlineOf(layer: OutlineLayerId, input: OutlineInput, extent: WorldBounds | null = null): OutlineDescriptor | null {
  let byLayer = outlineDescriptors.get(input);
  if (byLayer === undefined) {
    byLayer = new Map();
    outlineDescriptors.set(input, byLayer);
  }
  const key = `${layer}|${extentKey(extent)}`;
  const cached = byLayer.get(key);
  if (cached !== undefined) return cached;
  const mapId = input.mapId;
  const lines = input.lines.filter((line) => line.length >= 2 && line.every((p) => p.mapId === mapId && Number.isFinite(p.x) && Number.isFinite(p.y)) && meetsExtent(line, extent));
  const descriptor: OutlineDescriptor | null =
    lines.length === 0
      ? null
      : {
          type: 'outline',
          id: `outline:${OUTLINE_KIND[layer]}:${String(mapId)}`,
          mapId,
          kind: OUTLINE_KIND[layer],
          lines,
          label: OUTLINE_LABEL[layer],
          ref: { kind: 'terrain', layer, mapId },
        };
  byLayer.set(key, descriptor);
  return descriptor;
}

/**
 * The first input on the view's world map, as one path (see `collectRelief` on other world maps),
 * without the lines that lie wholly outside `extent` (`outlineExtentOf`).
 */
function collectOutline(layer: OutlineLayerId, outlines: readonly OutlineInput[], mapId: WorldMapId, extent: WorldBounds | null = null): Collected {
  const candidates: Candidate[] = [];
  for (const input of outlines) {
    if (input.mapId !== mapId || candidates.length > 0) continue;
    const descriptor = outlineOf(layer, input, extent);
    if (descriptor !== null) candidates.push({ descriptor, tier: 1, anchor: boxAnchor(descriptor.lines.flat()) });
  }
  return { candidates, aggregated: 0, unresolved: new ReasonTally(), otherSurfaces: 0 };
}

/** The view's world map's zone outlines (terrain arcs), as one canvas path. */
export function buildZoneOutlines(ctx: LayerContext, outlines: readonly OutlineInput[], view: MapView): LayerContent {
  return contentOf('zone-outlines', collectOutline('zone-outlines', outlines, view.mapId, outlineExtentOf(ctx, view, view.mapId)), view, ctx);
}

/** The view's world map's coastline (terrain arcs), as one canvas path. */
export function buildCoastline(ctx: LayerContext, outlines: readonly OutlineInput[], view: MapView): LayerContent {
  return contentOf('coastline', collectOutline('coastline', outlines, view.mapId, outlineExtentOf(ctx, view, view.mapId)), view, ctx);
}

/**
 * Whether the terrain outlines are drawn at all (D-047; map-presentation.md §25.4, §25.12 R24;
 * review PR-01): never in the minimap style, whose zone borders wait for the `zone-borders`
 * byproduct (shared land edges clipped to land), and whose picture has no painted coastline; and
 * the zone outlines not at the world band. The painted style keeps them as an option below it.
 */
export function outlinesDrawn(layer: OutlineLayerId, band: MapBand, minimap: boolean): boolean {
  if (minimap) return false;
  return layer === 'coastline' || band !== 'world';
}

// =============================================================================================
// Spawn layers (available quests, objectives, turn-ins, flight masters)

const SPAWN_MARKER: Readonly<Record<SpawnLayerId, MarkerKind>> = {
  'available-quests': 'quest-start',
  objectives: 'objective',
  'turn-ins': 'quest-end',
  'flight-masters': 'flight-master',
};

const SPAWN_NOUNS: Readonly<Record<SpawnLayerId, readonly [string, string]>> = {
  'available-quests': ['quest giver', 'quest givers'],
  objectives: ['objective target', 'objective targets'],
  'turn-ins': ['turn-in', 'turn-ins'],
  'flight-masters': ['flight master', 'flight masters'],
};

interface MergedGroup {
  readonly key: string;
  readonly subject: PointSubject;
  readonly label: string;
  readonly questIds: readonly QuestId[];
  readonly spawns: readonly SpawnPoint[];
  readonly mark: MarkerMark | undefined;
  /** Each quest with its own state (`PointGroupInput.quests`), or the group's mark for each. */
  readonly quests: readonly MarkerQuest[];
}

/** Groups by subject, ascending by key; the first group's label and spawns are kept and quest ids united. */
function mergeGroups(groups: readonly PointGroupInput[]): readonly MergedGroup[] {
  const byKey = new Map<string, { readonly group: PointGroupInput; readonly quests: QuestId[]; readonly marks: Map<QuestId, MarkerMark | null> }>();
  for (const group of groups) {
    const key = subjectKey(group.subject);
    const existing = byKey.get(key) ?? { group, quests: [], marks: new Map<QuestId, MarkerMark | null>() };
    byKey.set(key, existing);
    existing.quests.push(...group.questIds);
    const own = new Map((group.quests ?? []).map((quest) => [quest.questId, quest.mark]));
    for (const id of group.questIds) if (!existing.marks.has(id)) existing.marks.set(id, own.get(id) ?? group.mark ?? null);
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([key, { group, quests, marks }]) => {
      const questIds = sortedUniqueNumbers(quests);
      return { key, subject: group.subject, label: group.label, questIds, spawns: group.spawns, mark: group.mark, quests: questIds.map((questId) => ({ questId, mark: marks.get(questId) ?? null })) };
    });
}

function spawnUnplacedReason(spawn: SpawnPoint, geometry: MapGeometry): UnplacedReason {
  const source = spawn.source;
  if ('space' in source) {
    const resolution = resolveDetailed(source, geometry);
    return resolution.kind === 'unresolved' ? resolution.reason : 'no-geometry';
  }
  return source.kind === 'instance' ? 'instance-without-entrance' : 'unmapped-area';
}

function spawnBadges(spawn: SpawnPoint): readonly MarkerBadge[] {
  const source = spawn.source;
  if (!('space' in source)) return source.kind === 'instance' ? ['instance'] : [];
  if (source.space === 'zone' && (source.x < 0 || source.x > 100 || source.y < 0 || source.y > 100)) return ['off-frame'];
  return [];
}

interface Bucket {
  readonly uiMapId: UiMapId | null;
  sumX: number;
  sumY: number;
  count: number;
  readonly subjects: Set<string>;
}

/** The counted objective marks may take at most this many of the objectives' budget at the zone and close bands (map-presentation.md §25.7). */
export const COUNTED_OBJECTIVES_MAX = 50;

const COUNTED_MARK: MarkerMark = { state: 'objective', difficulty: null, dungeonQuest: false, progress: null };

// ---- Drawer categories (map-presentation.md §25.3.2, §25.3.4; step MP.4a)

const MARK_CATEGORY: Readonly<Partial<Record<MarkState, MapCategoryId>>> = {
  uncertain: 'may-be-available',
  locked: 'needs-prerequisite',
  'unlocks-soon': 'unlocks-soon',
  'low-level': 'low-level',
  ready: 'turn-ins',
  'in-progress': 'turn-ins',
  'record-unknown': 'turn-ins',
  objective: 'objectives',
};

/**
 * A quest mark's drawer row (`categoryOfMark` in adapter.ts, which this module may import only
 * types from; layers.test.ts checks they agree): the "!" states by their row, every turn-in state
 * under Turn-ins, a counted objective under Objectives, and no state (no route state yet) Available.
 */
export function categoryOfMarkState(state: MarkState | null): MapCategoryId {
  return state === null ? 'available' : (MARK_CATEGORY[state] ?? 'available');
}

/** A spawn layer's item's category: quest givers by their state, then each layer's own row. */
function spawnCategory(layer: SpawnLayerId, mark: MarkerMark | undefined | null): MapCategoryId {
  switch (layer) {
    case 'available-quests':
      return categoryOfMarkState(mark?.state ?? null);
    case 'turn-ins':
      return 'turn-ins';
    case 'objectives':
      return 'objectives';
    case 'flight-masters':
      return 'flight-points';
  }
}

// ---- Clusters (map-presentation.md §25.2.5; step MP.4a)

/**
 * The layers clustered below the zone band: quest givers and turn-ins, each kind apart. The other
 * spawn layers keep their per-zone counts (objectives) or draw raw (flight masters, `rawAtAnyZoom`).
 */
export const CLUSTERED_LAYERS: readonly SpawnLayerId[] = ['available-quests', 'turn-ins'];

/** One point a cluster may fold: a placed spawn of a quest giver or finisher that is not in focus. */
interface ClusterPoint {
  readonly group: MergedGroup;
  readonly spawn: SpawnPoint;
  readonly spawnIndex: number;
  readonly world: WorldPoint;
  /** The raw marker the point is drawn as when its cell holds it alone. */
  readonly single: Candidate;
}

/** Quest-mark rank for a cluster's members and a stack's state: the best first (available, may be, needs; ready, in progress, record unknown). */
const MEMBER_RANK: Readonly<Partial<Record<MarkState, number>>> = {
  available: 0,
  uncertain: 1,
  locked: 2,
  'unlocks-soon': 3,
  'low-level': 4,
  ready: 0,
  'in-progress': 1,
  'record-unknown': 2,
};

const memberRank = (member: ClusterMember): number => (member.mark === null ? 9 : (MEMBER_RANK[member.mark.state] ?? 9));

const STATE_WORDS: Readonly<Partial<Record<MarkState, readonly [one: string, many: string]>>> = {
  available: ['available', 'available'],
  uncertain: ['may be available', 'may be available'],
  locked: ['needs a prerequisite', 'need a prerequisite'],
  'unlocks-soon': ['unlocks soon', 'unlock soon'],
  'low-level': ['low level', 'low level'],
  ready: ['ready', 'ready'],
  'in-progress': ['in progress', 'in progress'],
  'record-unknown': ['record unknown', 'record unknown'],
};

const DIFFICULTY_WORDS: Readonly<Record<MarkDifficulty, string>> = {
  trivial: 'trivial',
  standard: 'standard',
  difficult: 'difficult',
  verydifficult: 'very difficult',
  impossible: 'impossible',
};

const DIFFICULTY_ORDER: readonly MarkDifficulty[] = ['trivial', 'standard', 'difficult', 'verydifficult', 'impossible'];

/**
 * A cluster's hover (§25.2.5), without a step number (the label provider adds "After step N: "):
 * "12 quests at 7 givers near here: 9 available, 2 may be available, 1 needs a prerequisite; 7
 * standard, 5 difficult. Zoom in to separate them."
 */
export function clusterLabel(layer: SpawnLayerId, members: readonly ClusterMember[], places: number): string {
  const quests = plural(members.length, 'quest', 'quests');
  const where = layer === 'turn-ins' ? `to turn in at ${plural(places, 'place', 'places')}` : `at ${plural(places, 'giver', 'givers')}`;
  const byState = new Map<MarkState, number>();
  const byDifficulty = new Map<MarkDifficulty, number>();
  let unknownDifficulty = 0;
  let stated = 0;
  for (const member of members) {
    const mark = member.mark;
    if (mark === null) continue;
    stated += 1;
    byState.set(mark.state, (byState.get(mark.state) ?? 0) + 1);
    if (mark.difficulty === null) unknownDifficulty += 1;
    else byDifficulty.set(mark.difficulty, (byDifficulty.get(mark.difficulty) ?? 0) + 1);
  }
  const states = [...byState.entries()]
    .sort(([a], [b]) => (MEMBER_RANK[a] ?? 9) - (MEMBER_RANK[b] ?? 9))
    .map(([state, n]) => {
      const words = STATE_WORDS[state] ?? [state, state];
      return `${groupDigits(n)} ${n === 1 ? words[0] : words[1]}`;
    });
  const difficulties = DIFFICULTY_ORDER.filter((key) => (byDifficulty.get(key) ?? 0) > 0).map((key) => `${groupDigits(byDifficulty.get(key) ?? 0)} ${DIFFICULTY_WORDS[key]}`);
  if (unknownDifficulty > 0 && difficulties.length > 0) difficulties.push(`${groupDigits(unknownDifficulty)} of unknown difficulty`);
  const detail = stated === 0 ? '' : `: ${states.join(', ')}${difficulties.length > 0 ? `; ${difficulties.join(', ')}` : ''}`;
  return `${quests} ${where} near here${detail}. Zoom in to separate them.`;
}

/** The members' best mark (the pin's glyph and badge), with a difficulty only when every member of that rank shares it. */
function clusterMark(members: readonly ClusterMember[]): MarkerMark | undefined {
  const [first] = members;
  if (first?.mark === null || first === undefined) return undefined;
  const rank = memberRank(first);
  const top = members.filter((member) => memberRank(member) === rank);
  const difficulty = top.every((member) => member.mark?.difficulty === first.mark?.difficulty) ? first.mark.difficulty : null;
  return { state: first.mark.state, difficulty, dungeonQuest: top.some((member) => member.mark?.dungeonQuest === true), progress: null };
}

const minDistanceSqIndex = (points: readonly WorldPoint[], x: number, y: number): number => {
  let best = 0;
  let bestSq = Infinity;
  points.forEach((point, index) => {
    const dx = point.x - x;
    const dy = point.y - y;
    const sq = dx * dx + dy * dy;
    if (sq < bestSq) {
      bestSq = sq;
      best = index;
    }
  });
  return best;
};

/**
 * The clusters of one grid level (§25.2.5): the points of each cell of `level` yards on the view's
 * world map, a cell with one point drawn as that point's own pin, a cell with more as one cluster
 * pin anchored at the member point nearest the cell's centroid (so its point is always a real giver).
 * The cluster counts quests (one member per quest, best state first), its places and its points.
 */
function clustersAt(layer: SpawnLayerId, points: readonly ClusterPoint[], mapId: WorldMapId, level: number, kind: MarkerKind): { readonly candidates: readonly Candidate[]; readonly clustered: number } {
  const cells = new Map<string, { readonly cx: number; readonly cy: number; readonly members: ClusterPoint[] }>();
  for (const point of points) {
    const cx = Math.floor(point.world.x / level);
    const cy = Math.floor(point.world.y / level);
    const key = `${String(cx)}:${String(cy)}`;
    const cell = cells.get(key) ?? { cx, cy, members: [] };
    cell.members.push(point);
    cells.set(key, cell);
  }
  const candidates: Candidate[] = [];
  let clustered = 0;
  for (const cell of [...cells.values()].sort((a, b) => a.cx - b.cx || a.cy - b.cy)) {
    const members = cell.members;
    const [only] = members;
    if (members.length === 1 && only !== undefined) {
      candidates.push(only.single);
      continue;
    }
    clustered += members.length;
    const worlds = members.map((member) => member.world);
    const n = worlds.length;
    const centroidX = worlds.reduce((sum, p) => sum + p.x, 0) / n;
    const centroidY = worlds.reduce((sum, p) => sum + p.y, 0) / n;
    const anchor = worlds[minDistanceSqIndex(worlds, centroidX, centroidY)] ?? { mapId, x: centroidX, y: centroidY };
    const quests = new Map<QuestId, { readonly quest: MarkerQuest; readonly subjects: Set<string> }>();
    const places = new Set<string>();
    for (const member of members) {
      places.add(member.group.key);
      for (const quest of member.group.quests) {
        const entry = quests.get(quest.questId) ?? { quest, subjects: new Set<string>() };
        entry.subjects.add(member.group.key);
        quests.set(quest.questId, entry);
      }
    }
    const clusterMembers: ClusterMember[] = [...quests.values()]
      .map(({ quest, subjects }) => ({ questId: quest.questId, mark: quest.mark, category: spawnCategory(layer, quest.mark), subjects: [...subjects].sort(compareStrings) }))
      .sort((a, b) => memberRank(a) - memberRank(b) || a.questId - b.questId);
    const bounds: WorldBounds = {
      mapId,
      xMin: Math.min(...worlds.map((p) => p.x)),
      xMax: Math.max(...worlds.map((p) => p.x)),
      yMin: Math.min(...worlds.map((p) => p.y)),
      yMax: Math.max(...worlds.map((p) => p.y)),
    };
    const ref: MapRef = { kind: 'cluster', layer, bounds, quests: clusterMembers.length, places: places.size };
    const label = clusterLabel(layer, clusterMembers, places.size);
    const mark = clusterMark(clusterMembers);
    const descriptor: MarkerDescriptor = {
      type: 'marker',
      id: `cluster:${layer}:${String(level)}:${String(cell.cx)}:${String(cell.cy)}`,
      point: { mapId: anchor.mapId, x: anchor.x, y: anchor.y },
      kind,
      style: 'neutral',
      emphasis: 'normal',
      label,
      badges: [],
      ref,
      count: 1,
      refs: [ref],
      labels: [label],
      ...(mark === undefined ? {} : { mark }),
      category: clusterMembers[0]?.category ?? spawnCategory(layer, null),
      cluster: { members: clusterMembers, places: places.size, points: n, bounds, cellYards: level },
    };
    candidates.push({ descriptor, tier: 1, anchor: pointAnchor(anchor) });
  }
  return { candidates, clustered };
}

/**
 * The log quests' objectives (map-presentation.md §7.4) on `mapId`: their outlines (a focused
 * quest's in the focused tier) and the counted marks of the quests not in focus (a focused quest's
 * points are drawn raw instead), each part by id.
 */
function collectLog(log: LogObjectivesInput, mapId: WorldMapId, focusQuests: ReadonlySet<number>): { readonly areas: readonly Candidate[]; readonly counted: readonly Candidate[] } {
  const areas: Candidate[] = [];
  const counted: Candidate[] = [];
  for (const area of log.areas) {
    if (area.mapId !== mapId) continue;
    const descriptor: AreaDescriptor = {
      type: 'area',
      id: area.id,
      mapId,
      ring: area.ring,
      style: 'objective-area',
      labelStep: area.labelStep,
      ...(area.labelTurnIn ? { labelTurnIn: true } : {}),
      label: area.label,
      ref: area.uiMapId === null ? { kind: 'surface', mapId } : { kind: 'zone', uiMapId: area.uiMapId },
    };
    areas.push({ descriptor, tier: focusQuests.has(area.questId) ? 0 : 1, anchor: boxAnchor(area.ring) });
  }
  for (const mark of log.counted) {
    if (mark.point.mapId !== mapId || focusQuests.has(mark.questId)) continue;
    const descriptor = singleMarker({
      id: mark.id,
      point: mark.point,
      kind: 'objective',
      style: 'muted',
      emphasis: 'normal',
      label: mark.label,
      badges: [],
      ref: mark.ref,
      mark: COUNTED_MARK,
      category: 'objectives',
    });
    counted.push({ descriptor, tier: 1, anchor: pointAnchor(mark.point) });
  }
  return { areas: areas.sort(byDescriptorId), counted: counted.sort(byDescriptorId) };
}

/** A spawn layer's points before the level of detail: the raw markers, the points that fold (by zone, or into clusters), the counts. */
interface SpawnPoints {
  readonly raw: readonly Candidate[];
  /** Points that fold into a zone count or a cluster, in group and spawn order. */
  readonly folding: readonly ClusterPoint[];
  readonly unresolved: ReasonTally;
  readonly otherSurfaces: number;
}

function spawnPoints(
  ctx: LayerContext,
  layer: SpawnLayerId,
  input: SpawnLayerInput,
  mapId: WorldMapId,
  aggregate: boolean,
  focusQuests: ReadonlySet<number>,
  rawZone: UiMapId | null,
  where: Whereabouts | null,
): SpawnPoints {
  const unresolved = new ReasonTally();
  let otherSurfaces = 0;
  const raw: Candidate[] = [];
  const folding: ClusterPoint[] = [];
  const kind = SPAWN_MARKER[layer];
  for (const group of mergeGroups(input.groups)) {
    const isFocused = group.questIds.some((id) => focusQuests.has(id));
    const category = spawnCategory(layer, group.mark);
    group.spawns.forEach((spawn, spawnIndex) => {
      const world = spawn.world;
      if (world === null) {
        unresolved.add(spawnUnplacedReason(spawn, ctx.geometry));
        return;
      }
      if (world.mapId !== mapId) {
        if (where === null || where(world.mapId) === 'elsewhere') otherSurfaces += 1;
        return;
      }
      const descriptor = singleMarker({
        id: `spawn:${group.key}:${String(spawnIndex)}`,
        point: world,
        kind,
        style: 'neutral',
        emphasis: isFocused ? 'strong' : 'normal',
        label: group.label,
        badges: spawnBadges(spawn),
        ref: { kind: 'spawn', subject: group.subject, spawnIndex, questIds: group.questIds },
        ...(group.mark === undefined ? {} : { mark: group.mark }),
        category,
      });
      const candidate: Candidate = { descriptor, tier: isFocused ? 0 : 1, anchor: pointAnchor(world) };
      // The zone the user jumped to is drawn raw at any zoom, like a focused quest's points.
      if (aggregate && !isFocused && (rawZone === null || spawn.uiMapId !== rawZone)) folding.push({ group, spawn, spawnIndex, world, single: candidate });
      else raw.push(candidate);
    });
  }
  return { raw, folding, unresolved, otherSurfaces };
}

function collectSpawns(
  ctx: LayerContext,
  layer: SpawnLayerId,
  input: SpawnLayerInput,
  mapId: WorldMapId,
  aggregate: boolean,
  focusQuests: ReadonlySet<number>,
  rawZone: UiMapId | null,
  where: Whereabouts | null = null,
  log: LogObjectivesInput | null = null,
  points: SpawnPoints = spawnPoints(ctx, layer, input, mapId, aggregate, focusQuests, rawZone, where),
  level: number | null = null,
): Collected {
  const { raw, unresolved, otherSurfaces } = points;
  // Raw markers by id, stacks merged, focused ones on top.
  const markers = focusedLast(mergeStacks([...raw].sort(byDescriptorId)));
  if (level !== null) {
    // Quest givers and turn-ins cluster below the zone band (§25.2.5): each level's cells; the cap
    // applies to the clusters, never trimming one.
    const { candidates, clustered } = clustersAt(layer, points.folding, mapId, level, SPAWN_MARKER[layer]);
    return { candidates: [...candidates, ...markers], aggregated: 0, clustered, unresolved, otherSurfaces };
  }
  let aggregated = 0;
  const buckets = new Map<number, Bucket>();
  const zoneMaps = zoneMapsOf(ctx.geometry);
  for (const { group, spawn, world } of points.folding) {
    // By the published hint, when it names a zone on this world map; a point published on the
    // world map (Azeroth 947) or a continent is in no zone, so it joins the world map's bucket.
    const zone = spawn.uiMapId !== null && zoneMaps.get(spawn.uiMapId) === mapId ? spawn.uiMapId : null;
    const key = zone ?? -1;
    const bucket = buckets.get(key) ?? { uiMapId: zone, sumX: 0, sumY: 0, count: 0, subjects: new Set<string>() };
    bucket.sumX += world.x;
    bucket.sumY += world.y;
    bucket.count += 1;
    bucket.subjects.add(group.key);
    buckets.set(key, bucket);
    aggregated += 1;
  }
  const [one, many] = SPAWN_NOUNS[layer];
  const category = spawnCategory(layer, null);
  const aggregates = [...buckets.values()]
    .sort((a, b) => (a.uiMapId ?? Infinity) - (b.uiMapId ?? Infinity))
    .map((bucket): Candidate => {
      const point: WorldPoint = { mapId, x: bucket.sumX / bucket.count, y: bucket.sumY / bucket.count };
      const zone = bucket.uiMapId === null ? 'No zone' : (ctx.geometry.maps.get(bucket.uiMapId)?.name ?? `UiMap ${String(bucket.uiMapId)}`);
      const descriptor: AggregateDescriptor = {
        type: 'aggregate',
        id: bucket.uiMapId === null ? `agg:${layer}:map-${String(mapId)}` : `agg:${layer}:${String(bucket.uiMapId)}`,
        point,
        layer,
        count: bucket.count,
        subjects: bucket.subjects.size,
        emphasis: 'normal',
        label: `${zone}: ${plural(bucket.subjects.size, one, many)} at ${plural(bucket.count, 'point', 'points')}; zoom in to see them`,
        ref: { kind: 'aggregate', layer, mapId, uiMapId: bucket.uiMapId, count: bucket.count },
        category,
      };
      return { descriptor, tier: 1, anchor: pointAnchor(point) };
    });
  // The log's outlines and counted marks, at the zone and close bands only (§7.4).
  const extra = aggregate || log === null ? null : collectLog(log, mapId, focusQuests);
  if (extra === null || (extra.areas.length === 0 && extra.counted.length === 0)) return { candidates: [...aggregates, ...markers], aggregated, unresolved, otherSurfaces };
  const countedIds = new Set(extra.counted.map((candidate) => candidate.descriptor.id));
  return {
    candidates: [...aggregates, ...extra.areas, ...extra.counted, ...markers],
    aggregated,
    unresolved,
    otherSurfaces,
    reserved: new Set([...extra.areas.map((candidate) => candidate.descriptor.id), ...countedIds]),
    ...(extra.counted.length > COUNTED_OBJECTIVES_MAX ? { limited: { ids: countedIds, max: COUNTED_OBJECTIVES_MAX } } : {}),
  };
}

/** Whether a spawn layer aggregates at this zoom (a view without a band). */
export function spawnLayerAggregates(layer: SpawnLayerId, zoom: number, lod: LodSettings = DEFAULT_LOD): boolean {
  return lodLevelAt(zoom, lod) === 'continent' && !lod.rawAtAnyZoom.includes(layer);
}

/** Whether a spawn layer aggregates in a view: at the world and continent bands when the view has a band (`viewLodLevel`), else by its zoom. */
export function spawnLayerAggregatesIn(layer: SpawnLayerId, view: Pick<MapView, 'zoom' | 'band'>, lod: LodSettings = DEFAULT_LOD): boolean {
  return viewLodLevel(view, lod) === 'continent' && !lod.rawAtAnyZoom.includes(layer);
}

/**
 * A spawn layer for the view: raw markers at zone zoom, per-zone aggregates at continent zoom
 * (except `rawAtAnyZoom` layers), the points of `focusQuests` raw and `strong` at any zoom, and
 * the points of `rawZone` (the zone the user jumped to, by the points' published UiMap) raw at any
 * zoom. Markers at the identical point are merged.
 */
export function buildSpawnLayer(
  ctx: LayerContext,
  layer: SpawnLayerId,
  input: SpawnLayerInput,
  view: MapView,
  focusQuests: readonly QuestId[] = [],
  rawZone: UiMapId | null = null,
): LayerContent {
  const aggregate = spawnLayerAggregatesIn(layer, view, ctx.lod);
  const level = aggregate && CLUSTERED_LAYERS.includes(layer) ? clusterLevelAt(view.zoom) : null;
  const focus = new Set<number>(focusQuests);
  const where = whereaboutsOf(ctx, view);
  const points = spawnPoints(ctx, layer, input, view.mapId, aggregate, focus, rawZone, where);
  const collected = collectSpawns(ctx, layer, input, view.mapId, aggregate, focus, rawZone, where, null, points, level);
  return contentOf(layer, collected, view, ctx);
}

// =============================================================================================
// Route line and proposal

const STYLE_WORDS: Readonly<Record<LineStyle, string>> = {
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

// ---- Walking paths

/** How one leg is drawn: its line style, the path points between its two step points, and its path state. */
interface LegDrawing {
  readonly style: LineStyle;
  /** Path points between the leg's two step points; empty for a straight leg. */
  readonly interior: readonly WorldPoint[];
  /** A walked leg's path state (`LayerStats.paths`); null for a leg that takes no path. */
  readonly path: keyof LegPathCounts | null;
}

const NO_POINTS: readonly WorldPoint[] = [];

/** Straight legs by style: shared objects, so a route without paths allocates nothing per leg. */
const STRAIGHT: Readonly<Record<LineStyle, LegDrawing>> = {
  route: { style: 'route', interior: NO_POINTS, path: null },
  transport: { style: 'transport', interior: NO_POINTS, path: null },
  flight: { style: 'flight', interior: NO_POINTS, path: null },
  hearth: { style: 'hearth', interior: NO_POINTS, path: null },
  'route-pending': { style: 'route-pending', interior: NO_POINTS, path: 'pending' },
  'route-fallback': { style: 'route-fallback', interior: NO_POINTS, path: 'fallback' },
  highlight: { style: 'highlight', interior: NO_POINTS, path: null },
  proposal: { style: 'proposal', interior: NO_POINTS, path: null },
  'network-flight': { style: 'network-flight', interior: NO_POINTS, path: null },
  'network-transport': { style: 'network-transport', interior: NO_POINTS, path: null },
};

/**
 * A walked leg's drawing by the input of the step it leads into, with what it was computed from:
 * the step it leaves, the leg style, the paths object, and the provider's answer (the array it
 * returned, or null while pending or not). A route edit recomputes only the legs it touched; a new
 * paths object asks every leg again but keeps the drawing of a leg whose answer is the same array
 * (or null in the same state), so a batch of new paths rebuilds only the pieces it changed (the
 * memoised builders; the stateless ones use none).
 */
type LegCache = WeakMap<
  RouteStepInput,
  {
    readonly from: RouteStepInput;
    readonly leg: LegStyle;
    readonly paths: RoutePathsInput;
    readonly answer: readonly WorldPoint[] | null;
    readonly drawing: LegDrawing;
  }
>;

/**
 * The points between a leg's two step points along `path`, or null when the path is unusable (no
 * points, a point off the leg's world map or not finite). A path that starts or ends at the step
 * points has those ends dropped: the line already has them.
 */
function pathInterior(leg: RouteLeg, path: readonly WorldPoint[] | null): readonly WorldPoint[] | null {
  if (path === null || path.length === 0) return null;
  const mapId = leg.from.mapId;
  const points: WorldPoint[] = [];
  for (const point of path) {
    if (point.mapId !== mapId || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    points.push({ mapId, x: point.x, y: point.y });
  }
  const first = points[0];
  if (first !== undefined && first.x === leg.from.x && first.y === leg.from.y) points.shift();
  const last = points.at(-1);
  if (last !== undefined && last.x === leg.to.x && last.y === leg.to.y) points.pop();
  return points;
}

function askPath(paths: RoutePathsInput, leg: RouteLeg): readonly WorldPoint[] | null {
  try {
    return paths.pathOf(leg);
  } catch {
    // A failing provider must not break the map: the leg is drawn as a straight-line fallback.
    return null;
  }
}

/**
 * How the leg from `from` to `to` is drawn. Without paths, or for a leg that is not walked
 * (transport, flight, hearth, the proposal), it is straight in its own style. A walked leg with
 * paths follows its path (`route`), or is straight as `route-pending` while paths are still being
 * computed, else as `route-fallback`. A leg that does not move takes no path.
 */
function drawLeg(
  from: { readonly step: RouteStepInput; readonly point: WorldPoint },
  to: { readonly step: RouteStepInput; readonly point: WorldPoint },
  leg: LegStyle,
  override: LineStyle | null,
  paths: RoutePathsInput | null,
  cache: LegCache | null,
): LegDrawing {
  if (override !== null) return STRAIGHT[override];
  if (paths === null || leg !== 'route') return STRAIGHT[leg];
  if (from.point.x === to.point.x && from.point.y === to.point.y) return STRAIGHT.route;
  const hit = cache?.get(to.step);
  const same = hit !== undefined && hit.from === from.step && hit.leg === leg;
  if (same && hit.paths === paths) return hit.drawing;
  const query: RouteLeg = { fromStepId: from.step.stepId, toStepId: to.step.stepId, from: from.point, to: to.point };
  const answer = askPath(paths, query);
  let drawing: LegDrawing;
  if (same && answer === hit.answer && (answer !== null || hit.drawing.path === (paths.pending ? 'pending' : 'fallback'))) {
    drawing = hit.drawing;
  } else {
    const interior = pathInterior(query, answer);
    drawing = interior !== null ? { style: 'route', interior, path: 'along' } : paths.pending ? STRAIGHT['route-pending'] : STRAIGHT['route-fallback'];
  }
  cache?.set(to.step, { from: from.step, leg, paths, answer, drawing });
  return drawing;
}

/**
 * The walked legs of a route (`RouteLeg`), in route order: what the route line asks
 * `RoutePathsInput.pathOf` for. Consecutive placed steps on one world map whose leg is `route`
 * (not after a flight `take`, not by transport or hearth), leaving out legs that do not move.
 * A navigation model can compute exactly these.
 */
export function routeLegsOf(route: RouteInput): readonly RouteLeg[] {
  const legs: RouteLeg[] = [];
  let previous: { readonly step: RouteStepInput; readonly point: WorldPoint } | null = null;
  let departure: LegStyle | null = null;
  for (const step of route.steps) {
    const placement = step.placement;
    if (placement.kind === 'none') {
      if (step.departs !== null) departure = step.departs;
      continue;
    }
    if (placement.kind === 'unknown') {
      previous = null;
      departure = null;
      continue;
    }
    const point = placement.world;
    const leg = departure ?? step.arrive;
    if (previous !== null && previous.point.mapId === point.mapId && leg === 'route' && (previous.point.x !== point.x || previous.point.y !== point.y)) {
      legs.push({ fromStepId: previous.step.stepId, toStepId: step.stepId, from: previous.point, to: point });
    }
    previous = { step, point };
    departure = step.departs;
  }
  return legs;
}

// ---- Runs

/**
 * A run of one world map and one line style. Its vertices are the steps' points with each leg's
 * path points before the step it leads into; they are listed only when a piece is built
 * (`runVertices`), so an edit that changes no piece builds no vertex list.
 */
interface OpenRun {
  readonly mapId: WorldMapId;
  style: LineStyle | null;
  /** The steps whose points are vertices, in order, and their points. */
  readonly steps: RouteStepInput[];
  readonly points: WorldPoint[];
  /** How the leg into each step is drawn (null for the first step): its path points come just before the step's vertex. */
  readonly legs: (LegDrawing | null)[];
  /** The vertex index of each step. */
  readonly stepVertex: number[];
}

interface Transition {
  readonly from: RouteStepInput;
  readonly fromPoint: WorldPoint;
  readonly to: RouteStepInput;
  readonly toPoint: WorldPoint;
  readonly leg: LegStyle;
}

/** A step that leaves the last known position for a place the route does not give (a hearth without a location). */
interface Departure {
  readonly step: RouteStepInput;
  readonly point: WorldPoint;
  readonly leg: LegStyle;
}

interface RouteWalk {
  readonly runs: readonly OpenRun[];
  readonly transitions: readonly Transition[];
  readonly departures: readonly Departure[];
  readonly unresolved: ReasonTally;
  /** Walked legs by path state, per world map (only with paths). */
  readonly paths: ReadonlyMap<WorldMapId, LegPathCounts>;
}

function openRun(mapId: WorldMapId, style: LineStyle | null, step: RouteStepInput, point: WorldPoint): OpenRun {
  return { mapId, style, steps: [step], points: [point], legs: [null], stepVertex: [0] };
}

/** Appends a leg to a run: its path points, then the step's own point. */
function extendRun(run: OpenRun, drawing: LegDrawing, step: RouteStepInput, point: WorldPoint): void {
  run.stepVertex.push((run.stepVertex.at(-1) ?? 0) + drawing.interior.length + 1);
  run.steps.push(step);
  run.points.push(point);
  run.legs.push(drawing);
}

/** A run's vertex count. */
const vertexCount = (run: OpenRun): number => (run.stepVertex.at(-1) ?? 0) + 1;

/**
 * The run's vertices `first` to `last` and the step each stands for: a step's own point its step,
 * a path point the step its leg leads into (so a hit segment `i` is the leg into `stepIds[i + 1]`).
 * `from` is the last step whose vertex is at or before `first`.
 */
function runVertices(run: OpenRun, first: number, last: number, from: number): { readonly points: WorldPoint[]; readonly stepIds: StepId[] } {
  const points: WorldPoint[] = [];
  const stepIds: StepId[] = [];
  let k = from;
  for (let v = first; v <= last; v += 1) {
    while (k + 1 < run.steps.length && (run.stepVertex[k + 1] ?? Infinity) <= v) k += 1;
    const at = run.stepVertex[k] ?? 0;
    if (v === at) {
      const point = run.points[k];
      const step = run.steps[k];
      if (point === undefined || step === undefined) break;
      points.push(point);
      stepIds.push(step.stepId);
    } else {
      const point = run.legs[k + 1]?.interior[v - at - 1];
      const step = run.steps[k + 1];
      if (point === undefined || step === undefined) break;
      points.push(point);
      stepIds.push(step.stepId);
    }
  }
  return { points, stepIds };
}

/**
 * Walks the placed steps: consecutive points on one world map with one line style form a run; a
 * style change starts a new run at the shared point; a world-map change ends the run and records a
 * transition; an `unknown` placement ends the run and forgets the position (recording a departure
 * when the step leaves by a known means, a hearth). `override` (the proposal) draws every leg in
 * one style. With `paths`, walked legs follow their paths (`drawLeg`), and a pending or fallback
 * leg is its own style, so it gets its own run.
 */
function walkRoute(route: RouteInput, override: LineStyle | null, paths: RoutePathsInput | null = null, cache: LegCache | null = null): RouteWalk {
  const runs: OpenRun[] = [];
  const transitions: Transition[] = [];
  const departures: Departure[] = [];
  const unresolved = new ReasonTally();
  const counts = new Map<WorldMapId, { along: number; pending: number; fallback: number }>();
  let run: OpenRun | null = null;
  let previous: { readonly step: RouteStepInput; readonly point: WorldPoint } | null = null;
  let departure: LegStyle | null = null;
  const close = (): void => {
    if (run !== null && run.steps.length >= 2) runs.push(run);
    run = null;
  };
  for (const step of route.steps) {
    const placement = step.placement;
    if (placement.kind === 'none') {
      if (step.departs !== null) departure = step.departs;
      continue;
    }
    if (placement.kind === 'unknown') {
      unresolved.add(placement.reason);
      if (step.departs !== null && previous !== null) departures.push({ step, point: previous.point, leg: step.departs });
      close();
      previous = null;
      departure = null;
      continue;
    }
    const point = placement.world;
    const leg = departure ?? step.arrive;
    if (previous === null || run === null) {
      close();
      run = openRun(point.mapId, null, step, point);
    } else if (previous.point.mapId !== point.mapId) {
      close();
      transitions.push({ from: previous.step, fromPoint: previous.point, to: step, toPoint: point, leg });
      run = openRun(point.mapId, null, step, point);
    } else {
      const drawing = drawLeg(previous, { step, point }, leg, override, paths, cache);
      if (drawing.path !== null) {
        const tally = counts.get(point.mapId) ?? { along: 0, pending: 0, fallback: 0 };
        tally[drawing.path] += 1;
        counts.set(point.mapId, tally);
      }
      // A walked leg that does not move draws nothing: inside a run of pending or fallback legs it
      // keeps the run's style, so the run is not cut at every stationary step (PERF-2 with walking
      // paths: cut runs made several times the pieces).
      const stationary = previous.point.x === point.x && previous.point.y === point.y;
      const style = paths !== null && stationary && drawing.style === 'route' && (run.style === 'route-pending' || run.style === 'route-fallback') ? run.style : drawing.style;
      if (run.style !== null && run.style !== style) {
        close();
        run = openRun(point.mapId, style, previous.step, previous.point);
      }
      run.style = style;
      extendRun(run, drawing, step, point);
    }
    previous = { step, point };
    departure = step.departs;
  }
  close();
  return { runs, transitions, departures, unresolved, paths: counts };
}

// ---- Pieces of long runs

/** At most this many vertices per route polyline: `MAX_POLYLINE_VERTICES` in adapter.ts (a type-only import ties the two). */
export const ROUTE_PIECE_MAX_VERTICES: typeof MAX_POLYLINE_VERTICES = 256;
/** A piece ends at a boundary step only once it has at least this many vertices. */
export const ROUTE_PIECE_MIN_VERTICES = 64;
/** A step is a boundary step when its id hashes to a multiple of this (about one step in 64). */
const ROUTE_PIECE_MODULUS = 64;

/** A small deterministic string hash (arithmetic only: no bitwise operators, D-012). */
function stepHash(id: string): number {
  let hash = 7;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 2147483647;
  return hash;
}

/**
 * Cuts a run of `stepIds.length` vertices into pieces of 2 to `max` vertices, as inclusive
 * `[first, last]` vertex ranges; consecutive pieces share their end vertex, so the line stays
 * continuous. Boundaries are content-defined: a piece ends at a step whose id hashes to a boundary
 * once the piece has `min` vertices (or at `max`), so an insert or a delete moves at most the
 * boundaries next to it and every other piece keeps its first step, hence its id.
 */
export function routePieces(
  stepIds: readonly string[],
  max: number = ROUTE_PIECE_MAX_VERTICES,
  min: number = ROUTE_PIECE_MIN_VERTICES,
): readonly (readonly [number, number])[] {
  const pieces: (readonly [number, number])[] = [];
  let start = 0;
  for (let i = 1; i < stepIds.length; i += 1) {
    const length = i - start + 1;
    const boundary = length >= min && stepHash(stepIds[i] ?? '') % ROUTE_PIECE_MODULUS === 0;
    if (i === stepIds.length - 1 || length >= max || boundary) {
      pieces.push([start, i]);
      start = i;
    }
  }
  return pieces;
}

/** One polyline of a run: an inclusive vertex range, the last step at or before its first vertex, and the base of its id. */
interface RunPiece {
  readonly first: number;
  readonly last: number;
  readonly from: number;
  /** The id of the step at its first vertex, or `<step>@<n>` for a piece that starts `n` vertices into the leg into that step. */
  readonly base: string;
}

/** The polylines of the steps `a` to `b` of a run (one `routePieces` range). */
interface StepPiece {
  readonly a: number;
  readonly b: number;
  readonly pieces: readonly RunPiece[];
}

/** A run's step id at `index` ('' past the end). Top-level, like `runVertexOf`, so a route edit creates no closure per run. */
function runStepAt(run: OpenRun, index: number): string {
  return run.steps[index]?.stepId ?? '';
}

/** A run's vertex index of its step `index`. */
function runVertexOf(run: OpenRun, index: number): number {
  return run.stepVertex[index] ?? 0;
}

const stepIdOf = (step: RouteStepInput): string => step.stepId;

/**
 * A run's polylines, each of at most `max` vertices, by step range. The steps are cut into pieces
 * as without paths (`routePieces`, content-defined boundaries). A piece whose legs' path points
 * take it over `max` vertices is cut again at the last step that fits, or inside a leg longer than
 * `max` on its own; an edit therefore re-cuts only the pieces of the steps it touched. Without
 * path points this is exactly `routePieces`.
 */
function runPieces(run: OpenRun, max: number = ROUTE_PIECE_MAX_VERTICES): readonly StepPiece[] {
  const out: StepPiece[] = [];
  for (const [a, b] of routePieces(run.steps.map(stepIdOf))) {
    const end = runVertexOf(run, b);
    let start = runVertexOf(run, a);
    if (end - start + 1 <= max) {
      out.push({ a, b, pieces: [{ first: start, last: end, from: a, base: runStepAt(run, a) }] });
      continue;
    }
    const pieces: RunPiece[] = [];
    // `k`: the last step whose vertex is at or before `start`.
    let k = a;
    while (start < end) {
      const limit = start + max - 1;
      let cut = end;
      if (limit < end) {
        let best = -1;
        for (let j = k + 1; j <= b && runVertexOf(run, j) <= limit; j += 1) best = j;
        cut = best > k ? runVertexOf(run, best) : limit;
      }
      const base = start === runVertexOf(run, k) ? runStepAt(run, k) : `${runStepAt(run, k + 1)}@${String(start - runVertexOf(run, k))}`;
      pieces.push({ first: start, last: cut, from: k, base });
      while (k + 1 <= b && runVertexOf(run, k + 1) <= cut) k += 1;
      start = cut;
    }
    out.push({ a, b, pieces });
  }
  return out;
}

/**
 * The route line's built polylines by the first step input of their step range, with what they
 * were built from (memoised builders): a range whose steps and leg drawings are the same objects,
 * in the same style and with the same ids, keeps its descriptors, so a route edit builds only the
 * pieces it touched and the rest compare by identity.
 */
type PieceCache = WeakMap<
  RouteStepInput,
  {
    readonly mapId: WorldMapId;
    readonly style: LineStyle;
    readonly steps: readonly RouteStepInput[];
    readonly legs: readonly (LegDrawing | null)[];
    readonly ids: readonly string[];
    readonly candidates: readonly Candidate[];
  }
>;

/** Whether the cached range still describes steps `a` to `b` of `run` (the leg into `a` belongs to the piece before). */
function sameRange(run: OpenRun, a: number, b: number, steps: readonly RouteStepInput[], legs: readonly (LegDrawing | null)[]): boolean {
  if (steps.length !== b - a + 1) return false;
  for (let i = a; i <= b; i += 1) {
    if (run.steps[i] !== steps[i - a]) return false;
    if (i > a && run.legs[i] !== legs[i - a]) return false;
  }
  return true;
}

/**
 * The last route walk, shared by the builders of one surface's maps (the atlas builds the route
 * line once per active map; the walk does not depend on the map).
 */
export interface WalkMemo {
  last: {
    readonly route: RouteInput;
    readonly override: LineStyle | null;
    readonly paths: RoutePathsInput | null;
    readonly cache: LegCache | null;
    readonly walk: RouteWalk;
  } | null;
}

function memoWalk(memo: WalkMemo | null, route: RouteInput, override: LineStyle | null, paths: RoutePathsInput | null, cache: LegCache | null): RouteWalk {
  const last = memo?.last ?? null;
  if (last !== null && last.route === route && last.override === override && last.paths === paths && last.cache === cache) return last.walk;
  const walk = walkRoute(route, override, paths, cache);
  if (memo !== null) memo.last = { route, override, paths, cache, walk };
  return walk;
}

/** What a route layer needs to know of the view's surface: which maps are placed there, the atlas, and the maps being built (connectors are drawn by one of them). */
interface RouteSurface {
  readonly where: Whereabouts;
  readonly atlas: AtlasSurfaceInfo | null;
  readonly active: readonly WorldMapId[];
}

const routeSurfaceOf = (ctx: LayerContext, view: MapView): RouteSurface => ({ where: whereaboutsOf(ctx, view), atlas: atlasOfView(ctx, view), active: activeMapsOf(view) });

/** Whether a leg between two maps is a connector on the atlas: both are placed there as maps (not insets), map-atlas.md §8.5. */
function isConnector(atlas: AtlasSurfaceInfo | null, from: WorldMapId, to: WorldMapId): boolean {
  if (atlas === null || from === to) return false;
  const kindOf = (mapId: WorldMapId): string | null => atlas.placements.find((placement) => placement.mapId === mapId)?.kind ?? null;
  return kindOf(from) === 'placed' && kindOf(to) === 'placed';
}

function collectRouteLine(
  ctx: LayerContext,
  route: RouteInput,
  mapId: WorldMapId,
  override: 'proposal' | null,
  paths: RoutePathsInput | null = null,
  cache: LegCache | null = null,
  pieceCache: PieceCache | null = null,
  surface: RouteSurface | null = null,
  walks: WalkMemo | null = null,
): Collected {
  const walk = memoWalk(walks, route, override, paths, cache);
  const where: Whereabouts = surface?.where ?? ((other) => (other === mapId ? 'here' : 'elsewhere'));
  const ids = new IdAllocator();
  let otherSurfaces = 0;
  const lines: Candidate[] = [];
  for (const run of walk.runs) {
    const style: LineStyle = run.style ?? override ?? 'route';
    const onMap = run.mapId === mapId;
    if (!onMap && where(run.mapId) === 'elsewhere') otherSurfaces += 1;
    if (vertexCount(run) < 2) continue;
    for (const range of runPieces(run)) {
      // Ids are taken on every surface, so a piece keeps its id whichever world map is shown.
      const pieceIds = range.pieces.map((piece) => ids.take(`run:${String(run.mapId)}:${style}:${piece.base}`));
      if (!onMap) continue;
      const head = run.steps[range.a];
      const hit = head === undefined ? undefined : pieceCache?.get(head);
      if (
        hit !== undefined &&
        hit.mapId === run.mapId &&
        hit.style === style &&
        plainEqual(hit.ids, pieceIds) &&
        sameRange(run, range.a, range.b, hit.steps, hit.legs)
      ) {
        lines.push(...hit.candidates);
        continue;
      }
      const candidates = range.pieces.map((piece, index): Candidate => {
        const { points, stepIds } = runVertices(run, piece.first, piece.last, piece.from);
        const descriptor: PolylineDescriptor = {
          type: 'polyline',
          id: pieceIds[index] ?? '',
          mapId: run.mapId,
          points,
          style,
          emphasis: 'normal',
          label: STYLE_WORDS[style],
          ref: { kind: 'run', style, stepIds },
        };
        return { descriptor, tier: 1, anchor: boxAnchor(points) };
      });
      if (head !== undefined && pieceCache !== null) {
        pieceCache.set(head, {
          mapId: run.mapId,
          style,
          steps: run.steps.slice(range.a, range.b + 1),
          legs: run.legs.slice(range.a, range.b + 1),
          ids: pieceIds,
          candidates,
        });
      }
      lines.push(...candidates);
    }
  }
  const glyphs: Candidate[] = [];
  const connectors: Candidate[] = [];
  const glyphStyle = override === null ? 'accent' : 'proposal';
  for (const transition of walk.transitions) {
    const legWord = STYLE_WORDS[override ?? transition.leg];
    const ref = {
      fromStepId: transition.from.stepId,
      toStepId: transition.to.stepId,
      fromMapId: transition.fromPoint.mapId,
      toMapId: transition.toPoint.mapId,
      leg: transition.leg,
    };
    if (isConnector(surface?.atlas ?? null, ref.fromMapId, ref.toMapId)) {
      // One arc between the continents (map-atlas.md §8.5), drawn by the builder of the map it
      // leaves when that map is being built, else by the one it reaches.
      const id = ids.take(`connector:${transition.from.stepId}>${transition.to.stepId}`);
      const emitter = (surface?.active ?? []).includes(ref.fromMapId) ? ref.fromMapId : ref.toMapId;
      if (emitter !== mapId) continue;
      const descriptor: ConnectorDescriptor = {
        type: 'connector',
        id,
        from: transition.fromPoint,
        to: transition.toPoint,
        style: override ?? transition.leg,
        emphasis: 'normal',
        label: `${legWord} to ${surfaceName(ctx.surfaces, ref.toMapId)}`,
        ref: { kind: 'connector', ...ref },
      };
      connectors.push({ descriptor, tier: 1, anchor: pointAnchor(emitter === ref.fromMapId ? transition.fromPoint : transition.toPoint) });
      continue;
    }
    const ends = [
      {
        id: ids.take(`transition:out:${transition.from.stepId}`),
        point: transition.fromPoint,
        end: 'departure' as const,
        label: `${legWord} to ${surfaceName(ctx.surfaces, transition.toPoint.mapId)}`,
      },
      {
        id: ids.take(`transition:in:${transition.to.stepId}`),
        point: transition.toPoint,
        end: 'arrival' as const,
        label: `${legWord} from ${surfaceName(ctx.surfaces, transition.fromPoint.mapId)}`,
      },
    ];
    for (const end of ends) {
      if (end.point.mapId !== mapId) {
        if (where(end.point.mapId) === 'elsewhere') otherSurfaces += 1;
        continue;
      }
      const descriptor = singleMarker({
        id: end.id,
        point: end.point,
        kind: 'transition',
        style: glyphStyle,
        emphasis: 'normal',
        label: end.label,
        badges: [],
        ref: { kind: 'transition', end: end.end, ...ref },
      });
      glyphs.push({ descriptor, tier: 1, anchor: pointAnchor(end.point) });
    }
  }
  for (const departure of walk.departures) {
    const id = ids.take(`departure:${departure.step.stepId}`);
    if (departure.point.mapId !== mapId) {
      if (where(departure.point.mapId) === 'elsewhere') otherSurfaces += 1;
      continue;
    }
    const descriptor = singleMarker({
      id,
      point: departure.point,
      kind: 'transition',
      style: glyphStyle,
      emphasis: 'normal',
      label: `${STYLE_WORDS[departure.leg]} (destination unknown until simulation)`,
      badges: [],
      ref: { kind: 'departure', stepId: departure.step.stepId, leg: departure.leg },
    });
    glyphs.push({ descriptor, tier: 1, anchor: pointAnchor(departure.point) });
  }
  const collected: Collected = { candidates: [...lines, ...connectors, ...mergeStacks(glyphs)], aggregated: 0, unresolved: walk.unresolved, otherSurfaces };
  return paths === null ? collected : { ...collected, paths: walk.paths.get(mapId) ?? { along: 0, pending: 0, fallback: 0 } };
}

/**
 * The route line on the view's world map: one polyline per (world map, style) run, cut into pieces
 * of at most 256 vertices, with transition glyphs at world-map changes and a departure glyph where
 * a hearth without a location leaves. With `paths`, walked legs follow their walking paths, and
 * legs without one are drawn straight as pending or fallback (`LayerStats.paths` counts them).
 */
export function buildRouteLine(ctx: LayerContext, route: RouteInput, view: MapView, paths: RoutePathsInput | null = null): LayerContent {
  return contentOf('route-line', collectRouteLine(ctx, route, view.mapId, null, paths, null, null, routeSurfaceOf(ctx, view)), view, ctx);
}

/** The proposal overlay (ARCHITECTURE §12.5): the proposed route's line in the `proposal` style, never along paths; empty for null. */
export function buildProposal(ctx: LayerContext, route: RouteInput | null, view: MapView): LayerContent {
  const collected: Collected =
    route === null
      ? { candidates: [], aggregated: 0, unresolved: new ReasonTally(), otherSurfaces: 0 }
      : collectRouteLine(ctx, route, view.mapId, 'proposal', null, null, null, routeSurfaceOf(ctx, view));
  return contentOf('proposal', collected, view, ctx);
}

// =============================================================================================
// The route after the active step (map-presentation.md §13.6, §25.4; review PR-02)

/**
 * Where the route splits at the active step: every drawn step's position in the drawn route, and
 * `at`, the active step's, or for a step the route layers do not draw (a note) the last drawn step's
 * before it (−1 for none): every drawn step after `at` is after the split.
 */
export interface ActiveSplit {
  readonly at: number;
  readonly positions: ReadonlyMap<StepId, number>;
}

const sameSplit = (a: ActiveSplit | null, b: ActiveSplit | null): boolean => a === b || (a !== null && b !== null && a.at === b.at && a.positions === b.positions);

const isAfter = (split: ActiveSplit, stepId: StepId): boolean => {
  const position = split.positions.get(stepId);
  return position !== undefined && position > split.at;
};

/** Each piece's split forms by the vertex it splits at (0: all of it after), so a split that returns gives the same objects. */
const splitPieces = new WeakMap<PolylineDescriptor, Map<number, readonly PolylineDescriptor[]>>();

/**
 * A route piece as drawn with the split (null: all of it before, the piece itself). A run's vertex
 * `i` stands for `stepIds[i]` and its segment `i` is the leg into `stepIds[i + 1]`, so the piece
 * splits at the vertex before the first leg into a step after the active one: the leg into the
 * active step stays solid. The part before keeps the piece's id; the part after is `<id>>after`,
 * and a piece wholly after keeps its id, restyled in place.
 */
function splitPiece(piece: PolylineDescriptor, split: ActiveSplit): readonly PolylineDescriptor[] | null {
  if (piece.ref.kind !== 'run' || piece.style === 'proposal') return null;
  const ref = piece.ref;
  const ids = ref.stepIds;
  let at = -1;
  for (let i = 0; i + 1 < ids.length; i += 1) {
    const next = ids[i + 1];
    if (next !== undefined && isAfter(split, next)) {
      at = i;
      break;
    }
  }
  if (at < 0) return null;
  let byVertex = splitPieces.get(piece);
  if (byVertex === undefined) {
    byVertex = new Map();
    splitPieces.set(piece, byVertex);
  }
  const kept = byVertex.get(at);
  if (kept !== undefined) return kept;
  const made: readonly PolylineDescriptor[] =
    at === 0
      ? [{ ...piece, after: true }]
      : [
          { ...piece, points: piece.points.slice(0, at + 1), ref: { ...ref, stepIds: ids.slice(0, at + 1) } },
          { ...piece, id: `${piece.id}>after`, points: piece.points.slice(at), ref: { ...ref, stepIds: ids.slice(at) }, after: true },
        ];
  byVertex.set(at, made);
  return made;
}

/** Beads after the active step, by the bead they fade. */
const afterBeads = new WeakMap<MarkerDescriptor, MarkerDescriptor>();

/** A step bead after the active step, at 60 % (a stack only when every step in it is after); any other marker as it is. */
function splitBead(bead: MarkerDescriptor, split: ActiveSplit): MarkerDescriptor {
  if (bead.kind !== 'step' || !bead.refs.every((ref) => ref.kind === 'step' && isAfter(split, ref.stepId))) return bead;
  let faded = afterBeads.get(bead);
  if (faded === undefined) {
    faded = { ...bead, after: true };
    afterBeads.set(bead, faded);
  }
  return faded;
}

/**
 * A route layer's content as drawn with the split: the route line's pieces split at the active step
 * and the step beads after it faded (`splitPiece`, `splitBead`); the content itself when nothing is
 * after it or there is no split. The counts stay the layer's own: a split piece is one piece drawn
 * in two styles.
 */
export function splitContent(content: LayerContent, split: ActiveSplit | null): LayerContent {
  if (split === null) return content;
  let changed = false;
  const items: MapDescriptor[] = [];
  for (const item of content.items) {
    if (item.type === 'polyline') {
      const pieces = splitPiece(item, split);
      if (pieces === null) items.push(item);
      else {
        changed = true;
        items.push(...pieces);
      }
    } else if (item.type === 'marker') {
      const bead = splitBead(item, split);
      if (bead !== item) changed = true;
      items.push(bead);
    } else items.push(item);
  }
  return changed ? { ...content, items } : content;
}

// =============================================================================================
// Step markers and selection

const focusedSteps = (focus: StepFocus): ReadonlySet<StepId> => {
  const ids = new Set<StepId>(focus.selected);
  if (focus.hovered !== null) ids.add(focus.hovered);
  if (focus.active !== null) ids.add(focus.active);
  return ids;
};

type PlacedStep = Extract<StepPlacement, { readonly kind: 'point' }>;

/** A step marker's badges: its point outside its zone's frame, and an unknown leg into it. */
function stepBadges(placement: PlacedStep, legUnknown: boolean): MarkerBadge[] {
  const badges: MarkerBadge[] = [];
  if (placement.offFrame) badges.push('off-frame');
  if (legUnknown) badges.push('leg-unknown');
  return badges;
}

/** A step's own marker (the route layer's `normal`, the selection layer's `strong` copy). */
function stepMarker(id: string, step: RouteStepInput, placement: PlacedStep, legUnknown: boolean, emphasis: Emphasis): MarkerDescriptor {
  return singleMarker({
    id,
    point: placement.world,
    kind: 'step',
    style: 'accent',
    emphasis,
    // A label key: the adapter's label provider numbers the step when the label is shown.
    label: step.stepId,
    badges: stepBadges(placement, legUnknown),
    ref: { kind: 'step', stepId: step.stepId },
  });
}

/**
 * The route-steps builder's caches (M3 review PERF-2), so a route edit (a move, an insert, a
 * delete) builds candidates and stacks only for the steps it touched:
 * - step-marker candidates by input object, occurrence (a repeated step id's `~2`) and leg flag;
 * - each candidate's point as a small integer (interned `mapId|x|y`), so stacks are found with a
 *   typed-array count instead of a map keyed by coordinates (every step marker has one kind and
 *   style, so steps at the identical point form one stack, as `mergeStacks` would merge them);
 * - merged stacks by their members.
 * WeakMaps: inputs that leave the route are dropped with them. The point table is started afresh
 * (with the candidates) once it holds far more points than the route has steps.
 */
interface StepCandidates {
  /** Called once per collection with the route's length, before any `candidate`. */
  readonly begin: (steps: number) => void;
  readonly candidate: (step: RouteStepInput, placement: PlacedStep, occurrence: number, legUnknown: boolean) => StepCandidate;
  /** Merges the stacks of candidates from `candidate`, in order. */
  readonly merge: (candidates: readonly StepCandidate[]) => readonly Candidate[];
}

interface StepCandidate {
  readonly candidate: Candidate;
  /** The interned point (cached builders), or -1. */
  readonly point: number;
}

/** `step:<id>`, and `step:<id>~<n>` for the n-th step with a repeated id (as `IdAllocator` numbers them). */
const stepMarkerId = (step: RouteStepInput, occurrence: number): string =>
  occurrence === 1 ? `step:${step.stepId}` : `step:${step.stepId}~${String(occurrence)}`;

function stepCandidate(step: RouteStepInput, placement: PlacedStep, occurrence: number, legUnknown: boolean): Candidate {
  return { descriptor: stepMarker(stepMarkerId(step, occurrence), step, placement, legUnknown, 'normal'), tier: 1, anchor: pointAnchor(placement.world) };
}

const UNCACHED_STEP_CANDIDATES: StepCandidates = {
  begin: () => undefined,
  candidate: (step, placement, occurrence, legUnknown) => ({ candidate: stepCandidate(step, placement, occurrence, legUnknown), point: -1 }),
  merge: (candidates) => mergeStacks(candidates.map((entry) => entry.candidate)),
};

/** The point table starts afresh when it holds more than this many points per route step (plus a floor). */
const POINT_TABLE_SLACK = 4;
const POINT_TABLE_FLOOR = 4096;

interface StepEntry extends StepCandidate {
  readonly occurrence: number;
  readonly legUnknown: boolean;
}

function createStepCandidates(): StepCandidates {
  let entries = new WeakMap<RouteStepInput, StepEntry>();
  let points = new Map<string, number>();
  let stacks: StackCache = new WeakMap();
  const pointOf = (world: WorldPoint): number => {
    const key = `${String(world.mapId)}|${String(world.x)}|${String(world.y)}`;
    const known = points.get(key);
    if (known !== undefined) return known;
    const id = points.size;
    points.set(key, id);
    return id;
  };
  return {
    begin(steps) {
      if (points.size <= POINT_TABLE_SLACK * steps + POINT_TABLE_FLOOR) return;
      entries = new WeakMap();
      points = new Map();
      stacks = new WeakMap();
    },
    candidate(step, placement, occurrence, legUnknown) {
      const hit = entries.get(step);
      if (hit !== undefined && hit.occurrence === occurrence && hit.legUnknown === legUnknown) return hit;
      const entry: StepEntry = { candidate: stepCandidate(step, placement, occurrence, legUnknown), point: pointOf(placement.world), occurrence, legUnknown };
      entries.set(step, entry);
      return entry;
    },
    merge(candidates) {
      const counts = new Int32Array(points.size);
      let shared = false;
      for (const entry of candidates) {
        const count = (counts[entry.point] ?? 0) + 1;
        counts[entry.point] = count;
        if (count > 1) shared = true;
      }
      if (!shared) return candidates.map((entry) => entry.candidate);
      const out: Candidate[] = [];
      const open = new Map<number, Candidate[]>();
      for (const entry of candidates) {
        const total = counts[entry.point] ?? 1;
        if (total === 1) {
          out.push(entry.candidate);
          continue;
        }
        let members = open.get(entry.point);
        if (members === undefined) {
          members = [];
          open.set(entry.point, members);
        }
        members.push(entry.candidate);
        // A stack takes the place of its last member.
        if (members.length === total) out.push(cachedStack(members, stacks));
      }
      return out;
    },
  };
}

/**
 * Every placed step on this world map, in route order (later steps on top), stacks merged. The
 * layer does not see the focus: the selection layer draws the selected, hovered and active steps
 * strong on top, so a selection change never rebuilds this one (M3 review PERF-2).
 */
function collectRouteSteps(route: RouteInput, mapId: WorldMapId, candidates: StepCandidates = UNCACHED_STEP_CANDIDATES, where: Whereabouts | null = null): Collected {
  const unresolved = new ReasonTally();
  // Occurrences by step id, so a repeated id gets `~2` (IdAllocator's numbering, keyed without building a string per step).
  const seen = new Map<StepId, number>();
  let otherSurfaces = 0;
  let broken = false;
  const markers: StepCandidate[] = [];
  candidates.begin(route.steps.length);
  for (const step of route.steps) {
    const placement = step.placement;
    if (placement.kind === 'none') continue;
    if (placement.kind === 'unknown') {
      unresolved.add(placement.reason);
      broken = true;
      continue;
    }
    const legUnknown = broken;
    broken = false;
    const occurrence = (seen.get(step.stepId) ?? 0) + 1;
    seen.set(step.stepId, occurrence);
    if (placement.world.mapId !== mapId) {
      if (where === null || where(placement.world.mapId) === 'elsewhere') otherSurfaces += 1;
      continue;
    }
    markers.push(candidates.candidate(step, placement, occurrence, legUnknown));
  }
  return { candidates: candidates.merge(markers), aggregated: 0, unresolved, otherSurfaces };
}

/**
 * Step markers on the view's world map, every one `normal`: the selection layer draws the focused
 * steps strong on top (`buildSelection`). Steps at the identical point are merged into one marker
 * with a count.
 */
export function buildRouteSteps(ctx: LayerContext, route: RouteInput, view: MapView): LayerContent {
  return contentOf('route-steps', collectRouteSteps(route, view.mapId, UNCACHED_STEP_CANDIDATES, whereaboutsOf(ctx, view)), view, ctx);
}

/**
 * The focused steps (selected, hovered, active) on this world map: the leg into the active step,
 * a halo round each, and each one's own marker again, strong, above the route's markers, so a
 * focused step shows even where the route-steps cap left it out. The active step's items are kept
 * first under the cap. Stacks are merged per kind.
 */
function collectSelection(
  route: RouteInput,
  mapId: WorldMapId,
  focus: StepFocus,
  paths: RoutePathsInput | null = null,
  cache: LegCache | null = null,
  where: Whereabouts | null = null,
): Collected {
  const unresolved = new ReasonTally();
  const inFocus = focusedSteps(focus);
  let otherSurfaces = 0;
  if (inFocus.size === 0) return { candidates: [], aggregated: 0, unresolved, otherSurfaces };
  const leg: Candidate[] = [];
  const halos: Candidate[] = [];
  const marks: Candidate[] = [];
  const done = new Set<StepId>();
  let broken = false;
  route.steps.forEach((step, position) => {
    const placement = step.placement;
    const legUnknown = broken;
    if (placement.kind === 'unknown') broken = true;
    else if (placement.kind === 'point') broken = false;
    if (!inFocus.has(step.stepId) || done.has(step.stepId)) return;
    done.add(step.stepId);
    if (placement.kind === 'none') return;
    if (placement.kind === 'unknown') {
      unresolved.add(placement.reason);
      return;
    }
    if (placement.world.mapId !== mapId) {
      if (where === null || where(placement.world.mapId) === 'elsewhere') otherSurfaces += 1;
      return;
    }
    const active = step.stepId === focus.active;
    const tier = active ? 0 : 1;
    const anchor = pointAnchor(placement.world);
    halos.push({
      descriptor: singleMarker({
        id: `halo:${step.stepId}`,
        point: placement.world,
        kind: 'halo',
        style: 'accent',
        emphasis: 'strong',
        label: step.stepId,
        badges: [],
        ref: { kind: 'step', stepId: step.stepId },
      }),
      tier,
      anchor,
    });
    marks.push({ descriptor: stepMarker(`focus:${step.stepId}`, step, placement, legUnknown, 'strong'), tier, anchor });
    if (!active) return;
    // The leg into the active step: back to the previous placed step, unless something unplaceable
    // is in between. It follows the leg's walking path where the route line does.
    let departure: LegStyle | null = null;
    for (let i = position - 1; i >= 0; i -= 1) {
      const before = route.steps[i];
      if (before === undefined) continue;
      if (before.placement.kind === 'none') {
        // The nearest step without a location that leaves by a special means sets the leg (walkRoute's rule).
        departure ??= before.departs;
        continue;
      }
      if (before.placement.kind === 'unknown' || before.placement.world.mapId !== mapId) break;
      const drawing = drawLeg(
        { step: before, point: before.placement.world },
        { step, point: placement.world },
        departure ?? before.departs ?? step.arrive,
        null,
        paths,
        cache,
      );
      const points = [before.placement.world, ...drawing.interior, placement.world];
      const ids = new IdAllocator();
      for (let first = 0; first < points.length - 1; first += ROUTE_PIECE_MAX_VERTICES - 1) {
        const piece = points.slice(first, first + ROUTE_PIECE_MAX_VERTICES);
        const descriptor: PolylineDescriptor = {
          type: 'polyline',
          id: ids.take(`leg:${step.stepId}`),
          mapId,
          points: piece,
          style: 'highlight',
          emphasis: 'strong',
          label: STYLE_WORDS.highlight,
          ref: { kind: 'leg', fromStepId: before.stepId, toStepId: step.stepId },
        };
        leg.push({ descriptor, tier: 0, anchor: boxAnchor(piece) });
      }
      break;
    }
  });
  return { candidates: [...leg, ...mergeStacks(halos), ...mergeStacks(marks)], aggregated: 0, unresolved, otherSurfaces };
}

/**
 * The focused steps: a highlight polyline for the leg into the active step (along its walking path
 * where `paths` has one, in pieces of at most 256 vertices), then a halo and a strong step marker
 * for each selected, hovered and active step (the active step's kept first under the cap).
 */
export function buildSelection(ctx: LayerContext, route: RouteInput, view: MapView, focus: StepFocus, paths: RoutePathsInput | null = null): LayerContent {
  return contentOf('selection', collectSelection(route, view.mapId, focus, paths, null, whereaboutsOf(ctx, view)), view, ctx);
}

// =============================================================================================
// Labels (map-presentation.md §5.3, §13)

/** A band's range in px per yard, widened by the bands' hysteresis (0.125 zoom each way), so a label about to show is already built. */
function bandReach(band: MapBand): readonly [number, number] {
  const widen = 2 ** 0.125;
  switch (band) {
    case 'world':
      return [0, LAYER_BAND_EDGES.continent * widen];
    case 'continent':
      return [LAYER_BAND_EDGES.continent / widen, LAYER_BAND_EDGES.zone * widen];
    case 'zone':
      return [LAYER_BAND_EDGES.zone / widen, LAYER_BAND_EDGES.close * widen];
    case 'close':
      return [LAYER_BAND_EDGES.close / widen, Infinity];
  }
}

/** Whether a label's scale range meets a band's (widened) range. */
export function labelInBand(label: Pick<LabelDescriptor, 'minPxPerYard' | 'maxPxPerYard'>, band: MapBand): boolean {
  const [lower, upper] = bandReach(band);
  return label.minPxPerYard < upper && (label.maxPxPerYard === null || label.maxPxPerYard > lower);
}

/** Static priority first (higher first), then id: the order the labels canvas places them in, which no selection or edit changes. */
const byLabelPriority = (a: LabelDescriptor, b: LabelDescriptor): number => b.priority - a.priority || compareStrings(a.id, b.id);

/**
 * The labels on this world map whose scale range meets the band's: in static priority order,
 * anchored at their point. Labels on another map the surface places are that map's builder's;
 * those on a map it does not show are counted in `otherSurfaces`. The adapter applies each label's
 * exact range (with hysteresis) and the collision rules when it draws.
 */
function collectLabels(labels: readonly LabelDescriptor[], mapId: WorldMapId, band: MapBand, where: Whereabouts | null): Collected {
  let otherSurfaces = 0;
  const here: LabelDescriptor[] = [];
  for (const label of labels) {
    if (label.point.mapId !== mapId) {
      if (where === null || where(label.point.mapId) === 'elsewhere') otherSurfaces += 1;
      continue;
    }
    if (labelInBand(label, band)) here.push(label);
  }
  const candidates = here.sort(byLabelPriority).map((descriptor): Candidate => ({ descriptor, tier: 1, anchor: pointAnchor(descriptor.point) }));
  return { candidates, aggregated: 0, unresolved: new ReasonTally(), otherSurfaces };
}

/** The labels of the view's world map in range of its band, capped by the band's `labels` budget (nearest the centre first). */
export function buildLabels(ctx: LayerContext, labels: readonly LabelDescriptor[], view: MapView): LayerContent {
  return contentOf('labels', collectLabels(labels, view.mapId, bandOfView(view), whereaboutsOf(ctx, view)), view, ctx);
}

/** One shared empty collection (a place layer before its model is built). */
const NOTHING_COLLECTED: Collected = { candidates: [], aggregated: 0, unresolved: new ReasonTally(), otherSurfaces: 0 };

// =============================================================================================
// Zone fills (map-presentation.md §12.4, §12.6; step MP.10)

/**
 * The zone fills of this world map, in their order (the tints under the faction patterns); a fill on
 * a map the surface does not show counts as elsewhere. Anchored at their rings' box, so a cap keeps
 * those nearest the view's centre.
 */
function collectZoneFill(fills: readonly ZoneFillDescriptor[], mapId: WorldMapId, where: Whereabouts | null, land: readonly OutlineInput[] = []): Collected {
  let otherSurfaces = 0;
  const candidates: Candidate[] = [];
  const coast = land.find((input) => input.mapId === mapId) ?? null;
  for (const fill of fills) {
    if (fill.mapId !== mapId) {
      if (where === null || where(fill.mapId) === 'elsewhere') otherSurfaces += 1;
      continue;
    }
    const descriptor = coast !== null && 'pattern' in fill.fill ? onLand(fill, coast) : fill;
    candidates.push({ descriptor, tier: 1, anchor: boxAnchor(fill.rings.flat()) });
  }
  return { candidates, aggregated: 0, unresolved: new ReasonTally(), otherSurfaces };
}

/** Faction fills with their map's coastline, by fill, for the coastline they were given. */
const landFills = new WeakMap<ZoneFillDescriptor, { readonly coast: OutlineInput; readonly out: ZoneFillDescriptor }>();

/**
 * A faction fill with its map's terrain coastline (`ZoneFillDescriptor.land`, review PR-15, QA-15),
 * memoised per fill and coastline; the adapter chains the lines into rings and clips the pattern to
 * them (in the lazy map chunk, `landRingsOf` in map/leaflet).
 */
function onLand(fill: ZoneFillDescriptor, coast: OutlineInput): ZoneFillDescriptor {
  const kept = landFills.get(fill);
  if (kept?.coast === coast) return kept.out;
  const out: ZoneFillDescriptor = { ...fill, land: coast.lines };
  landFills.set(fill, { coast, out });
  return out;
}

// =============================================================================================
// Places: dungeons, flight points, the flight network, transports (map-presentation.md §8 to §10,
// §25.4; steps MP.5, MP.8, MP.9)

/**
 * A place layer's candidates for the builder of `mapId` (`PlaceLayerInput`, built by the derived
 * pipeline's places model): its items on that map; on the atlas an item on another placed map is
 * that map's part's, and an item on a map the surface does not show counts as elsewhere. A
 * connector (a ride between the continents) is drawn only where both its maps are placed (not an
 * inset), by the builder of the map it leaves when that map is active, else by the one it reaches.
 * `keep` filters the items first (the flight network's zoomed-in rule). Pins, and the route's own
 * flights, are kept first under the cap: the rides of the transports layer take what its budget
 * leaves after the stops.
 */
function collectPlaces(input: PlaceLayerInput, mapId: WorldMapId, surface: RouteSurface, keep: ((item: PlaceItem) => boolean) | null): Collected {
  const candidates: Candidate[] = [];
  let otherSurfaces = 0;
  for (const item of input.items) {
    if (keep !== null && !keep(item)) continue;
    const descriptor = item.descriptor;
    if (descriptor.type === 'connector') {
      if (!isConnector(surface.atlas, descriptor.from.mapId, descriptor.to.mapId)) continue;
      const emitter = surface.active.includes(descriptor.from.mapId) ? descriptor.from.mapId : descriptor.to.mapId;
      if (emitter === mapId) candidates.push({ descriptor, tier: 1, anchor: pointAnchor(emitter === descriptor.from.mapId ? descriptor.from : descriptor.to) });
      continue;
    }
    const on = descriptor.type === 'marker' ? descriptor.point.mapId : descriptor.mapId;
    if (on !== mapId) {
      if (surface.where(on) === 'elsewhere') otherSurfaces += 1;
      continue;
    }
    // Pins before lines, and the route's flights first: a transport stop is never cut for a ride (§25.7 budgets 27 stops).
    const first = descriptor.type === 'marker' || item.route === true;
    candidates.push({ descriptor, tier: first ? 0 : 1, anchor: descriptor.type === 'marker' ? pointAnchor(descriptor.point) : boxAnchor(descriptor.points) });
  }
  return { candidates, aggregated: 0, unresolved: new ReasonTally(), otherSurfaces };
}

/**
 * The flight network's rule at a band (§25.4, D-047): the whole network at the world and continent
 * bands; at the zone and close bands only the flights of the nodes in focus (the hovered or
 * selected flight point) and the route's own, unless "All flights when zoomed in" is on. Null keeps
 * every flight.
 */
export function flightsKept(band: MapBand, focusNodes: readonly number[], allFlights: boolean): ((item: PlaceItem) => boolean) | null {
  if (allFlights || (band !== 'zone' && band !== 'close')) return null;
  const focus = new Set(focusNodes);
  return (item) => item.route === true || (item.nodes !== undefined && (focus.has(item.nodes[0]) || focus.has(item.nodes[1])));
}

// =============================================================================================
// Memoised builders

class Slot {
  collectKey: readonly unknown[] | null = null;
  collected: Collected | null = null;
  /**
   * The candidates of the key before (or ones built ahead, `MapLayers.prebuild`): a return across a
   * level-of-detail edge, or a band built in idle time, finds them here (map-atlas.md §8.2).
   */
  spareKey: readonly unknown[] | null = null;
  spare: Collected | null = null;
  finishKey: readonly unknown[] | null = null;
  content: LayerContent | null = null;
  byId: ReadonlyMap<string, MapDescriptor> = new Map();
  /** Ids kept the last time the cap bit (empty when everything fitted). */
  held: ReadonlySet<string> = new Set();
}

const sameKey = (a: readonly unknown[] | null, b: readonly unknown[]): boolean =>
  a !== null && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

/**
 * Keeps object identity where content is unchanged: each descriptor equal to the previous one with
 * its id is replaced by that previous object, the previous `items` array is returned when every
 * element is the same object in the same order, and the previous content when the stats match too.
 */
function stabilize(slot: Slot, layer: LayerId, items: readonly MapDescriptor[], stats: LayerStats): LayerContent {
  const previous = slot.content;
  const interned = items.map((descriptor) => {
    const old = slot.byId.get(descriptor.id);
    return old !== undefined && plainEqual(old, descriptor) ? old : descriptor;
  });
  const sameItems = previous !== null && previous.items.length === interned.length && interned.every((descriptor, i) => descriptor === previous.items[i]);
  const sameStats = previous !== null && plainEqual(previous.stats, stats);
  if (previous !== null && sameItems && sameStats) return previous;
  const finalItems = previous !== null && sameItems ? previous.items : interned;
  slot.byId = new Map(finalItems.map((descriptor) => [descriptor.id, descriptor]));
  return { layer, items: finalItems, stats: previous !== null && sameStats ? previous.stats : stats };
}

/** Under the cap, the memoised builders rank from a centre snapped to a grid this many pixels wide (about a quarter of a view) at the zoom's whole level. */
export const RANK_GRID_PX = 256;
/** An item already drawn is kept first while it stays inside the view grown by this fraction of its size on every side. */
const HOLD_MARGIN = 0.25;

/** The ranking centre of a view, snapped to the `RANK_GRID_PX` grid; null without a usable centre. */
export function rankingCenter(view: MapView): { readonly x: number; readonly y: number; readonly grid: number } | null {
  const center = usableCenter(view.center);
  if (center === null) return null;
  const grid = 2 ** (0 - (Number.isFinite(view.zoom) ? Math.round(view.zoom) : 0)) * RANK_GRID_PX;
  // Never -0, so equal centres compare equal (Object.is) in the memo key.
  const snap = (value: number): number => {
    const snapped = Math.round(value / grid) * grid;
    return snapped === 0 ? 0 : snapped;
  };
  return { x: snap(center.x), y: snap(center.y), grid };
}

function heldBy(slot: Slot, view: MapView): ((candidate: Candidate) => boolean) | null {
  const bounds = view.bounds;
  if (bounds === undefined || bounds === null || bounds.mapId !== view.mapId || slot.held.size === 0) return null;
  const dx = (bounds.xMax - bounds.xMin) * HOLD_MARGIN;
  const dy = (bounds.yMax - bounds.yMin) * HOLD_MARGIN;
  const padded: WorldBounds = { mapId: bounds.mapId, xMin: bounds.xMin - dx, xMax: bounds.xMax + dx, yMin: bounds.yMin - dy, yMax: bounds.yMax + dy };
  const held = slot.held;
  return (candidate) => held.has(candidate.descriptor.id) && anchorMeets(candidate.anchor, padded);
}

/** A slot's collected candidates, recollected only when the collect key changes; the previous ones are kept as the spare. */
function collectSlot(slot: Slot, collectKey: readonly unknown[], collect: () => Collected): Collected {
  if (slot.collected !== null && sameKey(slot.collectKey, collectKey)) return slot.collected;
  const next = slot.spare !== null && sameKey(slot.spareKey, collectKey) ? slot.spare : collect();
  slot.spare = slot.collected;
  slot.spareKey = slot.collectKey;
  slot.collected = next;
  slot.collectKey = collectKey;
  return next;
}

/** Collects `collectKey`'s candidates into the spare ahead of need; false when they are already there or current. */
function prebuildSlot(slot: Slot, collectKey: readonly unknown[], collect: () => Collected): boolean {
  if ((slot.collected !== null && sameKey(slot.collectKey, collectKey)) || (slot.spare !== null && sameKey(slot.spareKey, collectKey))) return false;
  slot.spare = collect();
  slot.spareKey = collectKey;
  return true;
}

/** A slot's content for `budget`, recomputed only when the candidates, the budget or (under the cap) the ranking cell change. */
function finishSlot(slot: Slot, layer: LayerId, collected: Collected, view: MapView, budget: number): LayerContent {
  // The centre only matters when a cap bites, and then only its grid cell: a small pan changes nothing.
  const over = collected.candidates.length > budget || collected.limited !== undefined;
  const center = over ? rankingCenter(view) : null;
  const finishKey = [collected, center?.x ?? null, center?.y ?? null, center?.grid ?? null, budget];
  if (slot.content !== null && sameKey(slot.finishKey, finishKey)) return slot.content;
  const { items, stats } = finish(collected, center, budget, over ? heldBy(slot, view) : null);
  slot.held = over ? new Set(items.map((item) => item.id)) : new Set();
  slot.content = stabilize(slot, layer, items, stats);
  slot.finishKey = finishKey;
  return slot.content;
}

/** Candidates whose anchor meets `bounds` (every candidate without bounds), counted once per candidates and bounds. */
const inViewCounts = new WeakMap<Collected, { readonly key: string; readonly count: number }>();

function countInView(collected: Collected, bounds: WorldBounds | null | undefined): number {
  if (bounds === null || bounds === undefined) return collected.candidates.length;
  const key = `${String(bounds.mapId)}:${String(bounds.xMin)}:${String(bounds.xMax)}:${String(bounds.yMin)}:${String(bounds.yMax)}`;
  const cached = inViewCounts.get(collected);
  if (cached?.key === key) return cached.count;
  let count = 0;
  for (const candidate of collected.candidates) if (anchorMeets(candidate.anchor, bounds)) count += 1;
  inViewCounts.set(collected, { key, count });
  return count;
}

const questFocusKey = (quests: readonly QuestId[]): string => sortedUniqueNumbers(quests).join(',');
const stepFocusKey = (focus: StepFocus): string => JSON.stringify([sortedUniqueStrings(focus.selected), focus.hovered, focus.active]);

/**
 * One layer's inputs, apart from the view (the `MapLayers` methods take the same arguments one by
 * one). The atlas controller builds a layer as a `LayerCall` for each active map.
 */
export type LayerCall =
  /**
   * `overTiles`: the atlas tiles are drawn under the frames (map-atlas.md §8.6): zone rectangles are
   * kept but not painted, city cards are framed. `minimap`: the tiles are the minimap style's, which
   * has no city cards: the underground cities' frames are dashed from the zone band (D-049 O19).
   */
  | { readonly layer: 'zone-frames'; readonly focusZone: UiMapId | null; readonly filled: boolean; readonly overTiles?: boolean; readonly minimap?: boolean }
  | { readonly layer: 'art'; readonly art: readonly ArtInput[] }
  | { readonly layer: 'relief'; readonly relief: readonly ReliefInput[]; readonly underArt: boolean }
  /** `minimap`: the minimap style's tiles are drawn, over which no terrain outline is (`outlinesDrawn`). */
  | { readonly layer: 'zone-outlines' | 'coastline'; readonly outlines: readonly OutlineInput[]; readonly minimap?: boolean }
  /** `log`: the objectives layer's counted marks and outlines of the log quests (map-presentation.md §7.4), drawn at the zone and close bands. */
  | {
      readonly layer: SpawnLayerId;
      readonly input: SpawnLayerInput;
      readonly focusQuests: readonly QuestId[];
      readonly rawZone: UiMapId | null;
      readonly log?: LogObjectivesInput | null;
      /**
       * The flight points from the places model (step MP.8: the TravelGraph's nodes with their state
       * after the active step), drawn instead of `input`'s flight masters; `flight-masters` only.
       */
      readonly places?: PlaceLayerInput | null;
    }
  /** `after`: the active step's split (`ActiveSplit`); the pieces and beads after it are drawn as such. Absent or null: none. */
  | { readonly layer: 'route-line'; readonly route: RouteInput; readonly paths: RoutePathsInput | null; readonly after?: ActiveSplit | null }
  | { readonly layer: 'route-steps'; readonly route: RouteInput; readonly after?: ActiveSplit | null }
  | { readonly layer: 'proposal'; readonly route: RouteInput | null }
  | { readonly layer: 'selection'; readonly route: RouteInput; readonly focus: StepFocus; readonly paths: RoutePathsInput | null }
  /** Names for the labels canvas (map-presentation.md §13): built from their inputs in step MP.7; the builder keeps those on this map and in range of the view's band. */
  | { readonly layer: 'labels'; readonly labels: readonly LabelDescriptor[] }
  /** Dungeon entrances (MP.5), transport stops and rides (MP.9) and services (MP.11), from the places model; null while it is not built (nothing drawn). */
  | { readonly layer: 'dungeons' | 'transports' | 'services'; readonly places: PlaceLayerInput | null }
  /**
   * The flight network (MP.8) from the places model, with the zoomed-in rule's inputs (§25.4): the
   * client TaxiNodes ids in focus (the hovered or selected flight point) and whether "All flights when
   * zoomed in" is on.
   */
  | { readonly layer: 'flight-network'; readonly places: PlaceLayerInput | null; readonly focusNodes: readonly number[]; readonly allFlights: boolean }
  /**
   * The zone fills (MP.10; §12.4, §12.6): the fallback tint where the painted art fails the §12.3
   * criteria, and the faction overlay while it is shown, in draw order (tints first); the builder keeps
   * those of this map. The zone and close bands' budget is 0 (§5.2), so they draw only zoomed out.
   */
  | {
      readonly layer: 'zone-fill';
      readonly fills: readonly ZoneFillDescriptor[];
      /** The terrain coastlines (`OutlineInput` per world map): the faction patterns are drawn on their land only (`landRingsOf`). Absent: not clipped. */
      readonly land?: readonly OutlineInput[];
    };

/**
 * One layer of one world map, collected but not yet cut to a budget (docs/research/map-atlas.md
 * §8.2): the atlas controller asks each active map's builder for its part, shares the layer's
 * budget across the parts (`partBudgets`, from `inView`), finishes each with its share and joins
 * them (`createLayerJoin`). A world surface has one part, finished with the layer's own budget.
 */
export interface LayerPart {
  readonly layer: LayerId;
  /** Candidates before the cap. */
  readonly candidates: number;
  /** Candidates whose anchor meets the view's rectangle (every one when the view has none). */
  inView(): number;
  /** The layer cut to `budget` (default: the layer's own), memoised as the layer methods are. */
  finish(budget?: number): LayerContent;
}

/**
 * Per-layer memoised builders over one geometry, for one world map at a time. Each method
 * recomputes only when its own inputs change (inputs by reference, focus by content, the view by
 * world map, surface and level of detail, and the centre only while the cap bites, by grid cell),
 * and returns the previous `LayerContent` object otherwise. Under the cap they also keep what they
 * already draw while it stays in view (MAPS §7.2), so their output depends on the calls before;
 * the stateless `build*` functions rank from the exact centre alone. The atlas uses one builder per
 * placed map (map-atlas.md §8.2), sharing their route caches (`LayerCaches`).
 */
export interface MapLayers {
  readonly geometry: MapGeometry;
  /** One world surface per world map (`surfacesOf`). */
  readonly surfaces: readonly SurfaceInfo[];
  /** The atlas over this geometry, or null when the geometry cannot place it. */
  readonly atlas: AtlasSurfaceInfo | null;
  readonly lod: LodSettings;
  lodLevel(zoom: number): LodLevel;
  /** `filled` false (over painted art) leaves out the zone frames' fill. */
  zoneFrames(view: MapView, focusZone?: UiMapId | null, filled?: boolean): LayerContent;
  art(art: readonly ArtInput[], view: MapView): LayerContent;
  /** `underArt`: painted art is drawn over the relief, which is then faint (`RELIEF_OPACITY`). */
  relief(relief: readonly ReliefInput[], view: MapView, underArt?: boolean): LayerContent;
  zoneOutlines(outlines: readonly OutlineInput[], view: MapView): LayerContent;
  coastline(outlines: readonly OutlineInput[], view: MapView): LayerContent;
  /** `rawZone`: the zone the user jumped to (`view.map.zone`), drawn raw at any zoom. */
  spawns(layer: SpawnLayerId, input: SpawnLayerInput, view: MapView, focusQuests?: readonly QuestId[], rawZone?: UiMapId | null): LayerContent;
  /** `paths`: walking paths for walked legs (MAPS §7.4), or null to draw every leg straight. */
  routeLine(route: RouteInput, view: MapView, paths?: RoutePathsInput | null): LayerContent;
  /** The route's step markers. Independent of the focus, which `selection` draws (M3 review PERF-2). */
  routeSteps(route: RouteInput, view: MapView): LayerContent;
  proposal(route: RouteInput | null, view: MapView): LayerContent;
  selection(route: RouteInput, view: MapView, focus: StepFocus, paths?: RoutePathsInput | null): LayerContent;
  /** The labels on the view's map in range of its band (`buildLabels`). */
  labels(labels: readonly LabelDescriptor[], view: MapView): LayerContent;
  /** Any layer as a part not yet cut to a budget (`LayerPart`); `part(call, view).finish()` is the method's result. */
  part(call: LayerCall, view: MapView): LayerPart;
  /**
   * Collects a layer for `view` ahead of need (map-atlas.md §8.2: the other level-of-detail band,
   * in idle time), without touching what is drawn now: a later `part` for that view finds it.
   * True when it collected anything.
   */
  prebuild(call: LayerCall, view: MapView): boolean;
}

/**
 * Caches the builders of one surface's maps share (map-atlas.md §8.2): the route walk, the leg
 * drawings, the route-line pieces and the step-marker candidates depend on steps, not on the map
 * being built, so the atlas walks a route edit once, not once per map.
 */
export interface LayerCaches {
  readonly legs: LegCache;
  readonly pieces: PieceCache;
  readonly stepCandidates: StepCandidates;
  readonly walks: WalkMemo;
}

export function createLayerCaches(): LayerCaches {
  return { legs: new WeakMap(), pieces: new WeakMap(), stepCandidates: createStepCandidates(), walks: { last: null } };
}

export interface MapLayersOptions {
  readonly geometry: MapGeometry;
  readonly lod?: LodOverrides;
  /** Caches to share with the other builders of a surface; default: this builder's own. */
  readonly caches?: LayerCaches;
}

export function createMapLayers(options: MapLayersOptions): MapLayers {
  const lod = createLod(options.lod);
  const ctx = layerContextOf(options.geometry, lod);
  const slots = new Map<LayerId, Slot>();
  // One leg cache for the route line and the selection's leg: both draw the same legs.
  const { legs, pieces, stepCandidates, walks } = options.caches ?? createLayerCaches();
  const slot = (layer: LayerId): Slot => {
    const existing = slots.get(layer);
    if (existing !== undefined) return existing;
    const created = new Slot();
    slots.set(layer, created);
    return created;
  };

  /** A layer's collect key and collector for a view. */
  function plan(call: LayerCall, view: MapView): { readonly key: readonly unknown[]; readonly collect: () => Collected } {
    const mapId = view.mapId;
    // Review MR-01: only the connector layers are keyed on the active maps.
    const placedKey = placedKeyOf(ctx, view);
    switch (call.layer) {
      case 'zone-frames': {
        const { focusZone, filled } = call;
        const atlas = atlasOfView(ctx, view);
        // Over the atlas tiles: rectangles kept, not painted; the city cards framed at tile levels −1 and 0.
        const band = bandOfView(view);
        const minimap = call.minimap === true;
        const overTiles: OverTiles | null =
          atlas !== null && call.overTiles === true ? { cards: !minimap && atlasTileLevelAt(view.zoom) >= -1, underground: minimap && (band === 'zone' || band === 'close') } : null;
        return {
          key: [mapId, focusZone, filled, placedKey, overTiles?.cards ?? null, overTiles?.underground ?? null],
          collect: () => collectZoneFrames(ctx, mapId, focusZone, filled, atlas, overTiles),
        };
      }
      case 'art':
        return { key: [call.art, mapId, placedKey], collect: () => collectArt(ctx, call.art, mapId, atlasOfView(ctx, view), whereaboutsOf(ctx, view)) };
      case 'relief':
        return { key: [call.relief, mapId, call.underArt], collect: () => collectRelief(call.relief, mapId, call.underArt) };
      case 'zone-outlines':
      case 'coastline': {
        const layer = call.layer;
        const drawn = outlinesDrawn(layer, bandOfView(view), call.minimap === true);
        const extent = outlineExtentOf(ctx, view, mapId);
        return {
          key: [call.outlines, mapId, drawn, extentKey(extent)],
          collect: () => (drawn ? collectOutline(layer, call.outlines, mapId, extent) : NOTHING_COLLECTED),
        };
      }
      case 'available-quests':
      case 'objectives':
      case 'turn-ins':
      case 'flight-masters': {
        const { layer, input, focusQuests } = call;
        const places = layer === 'flight-masters' ? (call.places ?? null) : null;
        if (places !== null) return { key: [places, mapId, placesKeyOf(ctx, view, places)], collect: () => collectPlaces(places, mapId, routeSurfaceOf(ctx, view), null) };
        const aggregate = spawnLayerAggregatesIn(layer, view, lod);
        const focusKey = questFocusKey(focusQuests);
        // The raw zone matters only while the layer aggregates.
        const zone = aggregate ? call.rawZone : null;
        const log = layer === 'objectives' ? (call.log ?? null) : null;
        // Quest givers and turn-ins cluster below the zone band: the level is a lookup by zoom, and
        // every level is made once per input (map-presentation.md §25.2.5), in `clusterLevels`.
        const level = aggregate && CLUSTERED_LAYERS.includes(layer) ? clusterLevelAt(view.zoom) : null;
        const key = [input, mapId, aggregate, focusKey, zone, placedKey, log];
        return {
          key: [...key, level],
          collect: () => {
            if (level === null) return collectSpawns(ctx, layer, input, mapId, aggregate, new Set(focusQuests), zone, whereaboutsOf(ctx, view), log);
            return clusterLevels(layer, key, () => spawnPoints(ctx, layer, input, mapId, aggregate, new Set(focusQuests), zone, whereaboutsOf(ctx, view)), (points, at) =>
              collectSpawns(ctx, layer, input, mapId, aggregate, new Set(focusQuests), zone, null, null, points, at),
            ).get(level) ?? NOTHING_COLLECTED;
          },
        };
      }
      case 'route-line': {
        const { route, paths } = call;
        return { key: [route, mapId, paths, surfaceKeyOf(ctx, view)], collect: () => collectRouteLine(ctx, route, mapId, null, paths, legs, pieces, routeSurfaceOf(ctx, view), walks) };
      }
      case 'route-steps':
        return { key: [call.route, mapId, placedKey], collect: () => collectRouteSteps(call.route, mapId, stepCandidates, whereaboutsOf(ctx, view)) };
      case 'proposal': {
        const route = call.route;
        return {
          key: [route, mapId, surfaceKeyOf(ctx, view)],
          collect: () =>
            route === null
              ? { candidates: [], aggregated: 0, unresolved: new ReasonTally(), otherSurfaces: 0 }
              : collectRouteLine(ctx, route, mapId, 'proposal', null, null, null, routeSurfaceOf(ctx, view), walks),
        };
      }
      case 'selection': {
        const { route, focus, paths } = call;
        return { key: [route, mapId, stepFocusKey(focus), paths, placedKey], collect: () => collectSelection(route, mapId, focus, paths, legs, whereaboutsOf(ctx, view)) };
      }
      case 'labels': {
        const band = bandOfView(view);
        return { key: [call.labels, mapId, band, placedKey], collect: () => collectLabels(call.labels, mapId, band, whereaboutsOf(ctx, view)) };
      }
      case 'dungeons':
      case 'transports':
      case 'services': {
        const places = call.places;
        return { key: [places, mapId, places === null ? placedKey : placesKeyOf(ctx, view, places)], collect: () => (places === null ? NOTHING_COLLECTED : collectPlaces(places, mapId, routeSurfaceOf(ctx, view), null)) };
      }
      case 'flight-network': {
        const places = call.places;
        const keep = flightsKept(bandOfView(view), call.focusNodes, call.allFlights);
        // The kept flights depend on the focus only while the zoomed-in rule applies.
        const focus = keep === null ? null : [...new Set(call.focusNodes)].sort((a, b) => a - b).join(',');
        return { key: [places, mapId, places === null ? placedKey : placesKeyOf(ctx, view, places), focus], collect: () => (places === null ? NOTHING_COLLECTED : collectPlaces(places, mapId, routeSurfaceOf(ctx, view), keep)) };
      }
      case 'zone-fill': {
        const fills = call.fills;
        const land = call.land ?? [];
        return { key: [fills, mapId, placedKey, land], collect: () => collectZoneFill(fills, mapId, whereaboutsOf(ctx, view), land) };
      }
    }
  }

  /**
   * Every cluster level of one clustered layer's input (map-presentation.md §25.2.5, review UR-06):
   * made together, once per input (the givers and their states change only at a derived publish),
   * and kept while the input is the same, so a zoom across levels is a lookup, never a rebuild.
   */
  const clusterMemo = new Map<SpawnLayerId, { readonly key: readonly unknown[]; readonly levels: ReadonlyMap<number, Collected> }>();
  function clusterLevels(
    layer: SpawnLayerId,
    key: readonly unknown[],
    points: () => SpawnPoints,
    collect: (points: SpawnPoints, level: number) => Collected,
  ): ReadonlyMap<number, Collected> {
    const kept = clusterMemo.get(layer);
    if (kept !== undefined && sameKey(kept.key, key)) return kept.levels;
    const shared = points();
    const levels = new Map(CLUSTER_LEVELS.map((level) => [level, collect(shared, level)] as const));
    clusterMemo.set(layer, { key, levels });
    return levels;
  }

  function prebuild(call: LayerCall, view: MapView): boolean {
    const { key, collect } = plan(call, view);
    return prebuildSlot(slot(call.layer), key, collect);
  }

  /** Each route layer's last split (`splitContent`), so an unchanged content and split give the same object. */
  const splits = new Map<LayerId, { readonly content: LayerContent; readonly split: ActiveSplit | null; readonly out: LayerContent }>();
  function splitOnce(layer: LayerId, content: LayerContent, split: ActiveSplit | null): LayerContent {
    const last = splits.get(layer);
    if (last !== undefined && last.content === content && sameSplit(last.split, split)) return last.out;
    let out = splitContent(content, split);
    // The same items as the last output (a selection change that moves no piece's style): its object.
    if (last !== undefined && out !== last.out && out.items.length === last.out.items.length && out.items.every((item, i) => item === last.out.items[i]) && plainEqual(out.stats, last.out.stats)) out = last.out;
    splits.set(layer, { content, split, out });
    return out;
  }

  function part(call: LayerCall, view: MapView): LayerPart {
    const layer = call.layer;
    const target = slot(layer);
    const { key, collect } = plan(call, view);
    const collected = collectSlot(target, key, collect);
    const split = call.layer === 'route-line' || call.layer === 'route-steps' ? (call.after ?? null) : null;
    return {
      layer,
      candidates: collected.candidates.length,
      inView: () => countInView(collected, view.bounds),
      finish: (budget = budgetOf(lod, layer, bandOfView(view))) => {
        const content = finishSlot(target, layer, collected, view, budget);
        return split === null && !splits.has(layer) ? content : splitOnce(layer, content, split);
      },
    };
  }

  return {
    geometry: options.geometry,
    surfaces: ctx.surfaces,
    atlas: ctx.atlas ?? null,
    lod,
    lodLevel: (zoom) => lodLevelAt(zoom, lod),
    zoneFrames: (view, focusZone = null, filled = true) => part({ layer: 'zone-frames', focusZone, filled }, view).finish(),
    art: (art, view) => part({ layer: 'art', art }, view).finish(),
    relief: (relief, view, underArt = false) => part({ layer: 'relief', relief, underArt }, view).finish(),
    zoneOutlines: (outlines, view) => part({ layer: 'zone-outlines', outlines }, view).finish(),
    coastline: (outlines, view) => part({ layer: 'coastline', outlines }, view).finish(),
    spawns: (layer, input, view, focusQuests = [], rawZone = null) => part({ layer, input, focusQuests, rawZone }, view).finish(),
    routeLine: (route, view, paths = null) => part({ layer: 'route-line', route, paths }, view).finish(),
    routeSteps: (route, view) => part({ layer: 'route-steps', route }, view).finish(),
    proposal: (route, view) => part({ layer: 'proposal', route }, view).finish(),
    selection: (route, view, focus, paths = null) => part({ layer: 'selection', route, focus, paths }, view).finish(),
    labels: (labels, view) => part({ layer: 'labels', labels }, view).finish(),
    part,
    prebuild,
  };
}

// =============================================================================================
// Joining the active maps' parts on the atlas (map-atlas.md §8.2)

/** Layers with one item per world map (terrain-navigation.md §13.2): each map keeps its own, never shared. */
const PER_MAP_LAYERS: readonly LayerId[] = ['relief', 'coastline', 'zone-outlines'];

/**
 * Each part's budget when a layer's parts share its budget (map-atlas.md §8.2): all of it to each
 * when every candidate fits; otherwise the budget split in proportion to the candidates in view
 * (`shareCap` in adapter.ts, here as `share`: largest remainder, deterministic), each part capped
 * at its candidates and the room it leaves given to the others, then what is still left to the
 * parts with nothing in view, by their candidates. The per-map layers (relief, outlines) keep
 * their budget per part; the zone frames give up the outlines' extra paths, so the canvas layers
 * of an atlas view still sum to at most the cap. One part: the layer's budget.
 */
export function partBudgets(
  layer: LayerId,
  parts: readonly { readonly candidates: number; readonly inView: number }[],
  lod: LodSettings,
  share: (counts: readonly number[], cap: number) => readonly number[],
  band: MapBand = 'zone',
): readonly number[] {
  const budgets = lod.budgets[band];
  const own = budgets[layer];
  if (parts.length <= 1 || PER_MAP_LAYERS.includes(layer)) return parts.map(() => own);
  const budget =
    layer === 'zone-frames' ? Math.max(0, own - (parts.length - 1) * PER_MAP_LAYERS.filter((id) => !isImageLayer(id)).reduce((sum, id) => sum + budgets[id], 0)) : own;
  if (parts.reduce((sum, entry) => sum + entry.candidates, 0) <= budget) return parts.map(() => budget);
  const shares = parts.map(() => 0);
  const settled = parts.map(() => false);
  let remaining = budget;
  const fill = (weightOf: (index: number) => number): void => {
    for (;;) {
      const open = parts.map((_, index) => index).filter((index) => !settled[index] && weightOf(index) > 0);
      if (open.length === 0 || remaining <= 0) return;
      const split = share(
        open.map((index) => weightOf(index)),
        remaining,
      );
      // A part whose share covers all its candidates takes just those, and the rest is shared again.
      const full = open.filter((index, i) => (split[i] ?? 0) >= (parts[index]?.candidates ?? 0));
      if (full.length === 0) {
        open.forEach((index, i) => {
          shares[index] = split[i] ?? 0;
          settled[index] = true;
        });
        remaining -= split.reduce((sum, value) => sum + value, 0);
        return;
      }
      for (const index of full) {
        shares[index] = parts[index]?.candidates ?? 0;
        settled[index] = true;
        remaining -= shares[index] ?? 0;
      }
    }
  };
  const inView = parts.reduce((sum, entry) => sum + entry.inView, 0);
  if (inView > 0) fill((index) => parts[index]?.inView ?? 0);
  fill((index) => parts[index]?.candidates ?? 0);
  return shares;
}

/**
 * The joined content of one layer's parts (one per active map, in placement order): their items
 * concatenated, their counts summed. `unresolved` and `otherSurfaces` do not depend on the map a
 * part is built for (items on the surface's other maps are theirs, never counted), so the first
 * part's are the layer's; the relief counts its own map's images, so its are summed. One part is
 * returned as it is.
 */
export function joinLayerParts(layer: LayerId, parts: readonly LayerContent[]): LayerContent {
  const [first] = parts;
  if (first === undefined) return { layer, items: [], stats: { drawn: 0, notDrawn: 0, aggregated: 0, unresolved: 0, unresolvedBy: {}, otherSurfaces: 0 } };
  if (parts.length === 1) return first;
  const sum = (pick: (stats: LayerStats) => number): number => parts.reduce((total, part) => total + pick(part.stats), 0);
  let unresolved = first.stats.unresolved;
  let unresolvedBy = first.stats.unresolvedBy;
  if (layer === 'relief') {
    const tally = new ReasonTally();
    for (const part of parts) {
      for (const [reason, count] of Object.entries(part.stats.unresolvedBy)) for (let i = 0; i < (count ?? 0); i += 1) tally.add(reason as UnplacedReason);
    }
    unresolved = tally.total;
    unresolvedBy = tally.toRecord();
  }
  const withPaths = parts.filter((part) => part.stats.paths !== undefined);
  const clustered = parts.some((part) => part.stats.clustered !== undefined);
  const stats: LayerStats = {
    drawn: sum((stats) => stats.drawn),
    notDrawn: sum((stats) => stats.notDrawn),
    aggregated: sum((stats) => stats.aggregated),
    ...(clustered ? { clustered: sum((stats) => stats.clustered ?? 0) } : {}),
    unresolved,
    unresolvedBy,
    otherSurfaces: first.stats.otherSurfaces,
    ...(withPaths.length === 0
      ? {}
      : {
          paths: {
            along: withPaths.reduce((total, part) => total + (part.stats.paths?.along ?? 0), 0),
            pending: withPaths.reduce((total, part) => total + (part.stats.paths?.pending ?? 0), 0),
            fallback: withPaths.reduce((total, part) => total + (part.stats.paths?.fallback ?? 0), 0),
          },
        }),
  };
  const withItems = parts.filter((part) => part.items.length > 0);
  // Only one part draws anything and the counts are its own: the join is that part, identity kept.
  const [only] = withItems;
  if (withItems.length === 1 && only !== undefined && plainEqual(only.stats, stats)) return only;
  return { layer, items: parts.flatMap((part) => part.items), stats };
}

/**
 * `joinLayerParts` memoised per layer on the parts' identities (map-atlas.md §8.2): the same parts
 * in the same order give the previous joined object, so the adapter skips it by reference; new
 * parts whose joined items and counts equal the previous ones also give it back.
 */
export function createLayerJoin(): (layer: LayerId, parts: readonly LayerContent[]) => LayerContent {
  const last = new Map<LayerId, { readonly parts: readonly LayerContent[]; readonly joined: LayerContent }>();
  return (layer, parts) => {
    const previous = last.get(layer);
    if (previous !== undefined && previous.parts.length === parts.length && previous.parts.every((part, i) => part === parts[i])) return previous.joined;
    let joined = joinLayerParts(layer, parts);
    if (previous !== undefined && joined !== previous.joined) {
      const before = previous.joined;
      const sameItems = before.items.length === joined.items.length && joined.items.every((item, i) => item === before.items[i]);
      if (sameItems && plainEqual(before.stats, joined.stats)) joined = before;
      else if (sameItems) joined = { ...joined, items: before.items };
    }
    last.set(layer, { parts, joined });
    return joined;
  };
}

