import type { SpawnPoint } from '../domain/dataset';
import type { QuestId, StepId, UiMapId, WorldMapId } from '../domain/ids';
import type { SourcedPoint, WorldPoint } from '../domain/points';
import type { RouteStep } from '../domain/route';
import { assignmentForWorld, isFullUiRectangle, resolveDetailed, worldMapIds, type GeometryAssignment, type MapGeometry } from '../geo';
import type {
  AggregateDescriptor,
  ArtDescriptor,
  ArtInput,
  Emphasis,
  FrameDescriptor,
  ImageLayerId,
  LayerContent,
  LayerId,
  LayerStats,
  LegPathCounts,
  LegStyle,
  LineStyle,
  MapDescriptor,
  MapRef,
  MapView,
  MarkerBadge,
  MarkerDescriptor,
  MarkerKind,
  MAX_POLYLINE_VERTICES,
  OutlineDescriptor,
  OutlineInput,
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
} from './adapter';

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
 * - **Level of detail** (MAPS §7.2): below `zoneZoom`, spawn layers fold their points into one
 *   aggregate glyph per (layer, zone) at the points' centroid; the points of focused (selected or
 *   hovered) quests stay raw at any zoom. Layers listed in `rawAtAnyZoom` never aggregate.
 * - **Hard path cap per surface**: every canvas layer has a budget and the budgets sum to at most
 *   `pathCapPerSurface`. Over budget, focused items are kept first, then those nearest the viewport
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
 *
 * `map/layers` may import only `domain` and `geo` values (ARCHITECTURE §4), so it takes nothing but
 * types from `./adapter`. `ui` may not import this module: the app layer re-exports what the UI
 * needs.
 */

// =============================================================================================
// Level of detail

export interface LodSettings {
  /** Spawn points are drawn raw at or above this zoom; below it they aggregate (MAPS §7.2 proposes -3.5; M10 measures it). */
  readonly zoneZoom: number;
  /**
   * Hard cap on canvas paths per surface: 2,500 until a CPU-throttled measurement supports more
   * (MAPS §7.2 first proposed 5,000, which the M3 review measured over the moveend budget; M9/M10
   * measure it).
   */
  readonly pathCapPerSurface: number;
  /**
   * Each layer's share of the cap. The canvas layers (all but the image layers `relief` and `art`)
   * sum to at most `pathCapPerSurface`; the image layers cap images.
   */
  readonly budgets: Readonly<Record<LayerId, number>>;
  /** Spawn layers drawn raw at every zoom (flight masters: a few hundred at most, and useful at continent zoom). */
  readonly rawAtAnyZoom: readonly SpawnLayerId[];
}

export const DEFAULT_LOD: LodSettings = {
  zoneZoom: -3.5,
  pathCapPerSurface: 2500,
  budgets: {
    relief: 1,
    art: 16,
    // One path each per world map (terrain-navigation.md §13.2), taken from the zone frames' 100:
    // a world map has at most about 40 frames.
    coastline: 1,
    'zone-outlines': 1,
    'zone-frames': 98,
    'available-quests': 600,
    objectives: 500,
    'turn-ins': 150,
    'flight-masters': 100,
    'route-line': 150,
    'route-steps': 700,
    proposal: 100,
    selection: 100,
  },
  rawAtAnyZoom: ['flight-masters'],
};

export type LodLevel = 'zone' | 'continent';

export function lodLevelAt(zoom: number, lod: LodSettings = DEFAULT_LOD): LodLevel {
  return zoom >= lod.zoneZoom ? 'zone' : 'continent';
}

const isCount = (n: number): boolean => Number.isInteger(n) && n >= 0;

/** `IMAGE_LAYER_IDS` in adapter.ts, which this module may import only types from. */
const IMAGE_LAYERS: readonly ImageLayerId[] = ['relief', 'art'];

const isImageLayer = (layer: string): boolean => (IMAGE_LAYERS as readonly string[]).includes(layer);

/** Why a `LodSettings` is unusable; empty when it is fine. */
export function lodProblems(lod: LodSettings): readonly string[] {
  const problems: string[] = [];
  if (!Number.isFinite(lod.zoneZoom)) problems.push('zoneZoom must be finite');
  if (!isCount(lod.pathCapPerSurface)) problems.push('pathCapPerSurface must be a non-negative integer');
  let canvas = 0;
  for (const [layer, budget] of Object.entries(lod.budgets)) {
    if (!isCount(budget)) problems.push(`budget of ${layer} must be a non-negative integer`);
    if (!isImageLayer(layer)) canvas += budget;
  }
  if (canvas > lod.pathCapPerSurface) {
    problems.push(`canvas layer budgets sum to ${String(canvas)}, above the cap of ${String(lod.pathCapPerSurface)} paths per surface`);
  }
  return problems;
}

export interface LodOverrides {
  readonly zoneZoom?: number;
  readonly pathCapPerSurface?: number;
  readonly budgets?: Readonly<Partial<Record<LayerId, number>>>;
  readonly rawAtAnyZoom?: readonly SpawnLayerId[];
}

/** `DEFAULT_LOD` with overrides; throws when the result breaks `lodProblems`. */
export function createLod(overrides: LodOverrides = {}): LodSettings {
  const lod: LodSettings = {
    zoneZoom: overrides.zoneZoom ?? DEFAULT_LOD.zoneZoom,
    pathCapPerSurface: overrides.pathCapPerSurface ?? DEFAULT_LOD.pathCapPerSurface,
    budgets: { ...DEFAULT_LOD.budgets, ...overrides.budgets },
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
export function surfacesOf(geometry: MapGeometry, margin = 0.05): readonly SurfaceInfo[] {
  const out: SurfaceInfo[] = [];
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
  readonly unresolved: ReasonTally;
  readonly otherSurfaces: number;
  /** The route line with walking paths: its walked legs on this world map by path state. */
  readonly paths?: LegPathCounts;
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
  const { candidates } = collected;
  let kept: readonly Candidate[] = candidates;
  if (candidates.length > budget) {
    // By rank group (focused, held, the rest), each filled nearest first while the budget lasts.
    const groups: number[][] = [[], [], []];
    candidates.forEach((candidate, index) => {
      const group = candidate.tier === 0 ? 0 : held?.(candidate) === true ? 1 : 2;
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
    notDrawn: candidates.length - items.length,
    aggregated: collected.aggregated,
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
  const descriptor: MarkerDescriptor = {
    ...first,
    emphasis,
    badges: BADGE_ORDER.filter((badge) => badges.has(badge)),
    count: markers.reduce((sum, marker) => sum + marker.count, 0),
    refs,
    labels: markers.flatMap((marker) => marker.labels),
  };
  return { descriptor, tier: stack.some((candidate) => candidate.tier === 0) ? 0 : 1, anchor: head.anchor };
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
  readonly surfaces: readonly SurfaceInfo[];
  readonly lod: LodSettings;
}

export function layerContextOf(geometry: MapGeometry, lod: LodSettings = DEFAULT_LOD): LayerContext {
  return { geometry, surfaces: surfacesOf(geometry), lod };
}

const contentOf = (layer: LayerId, collected: Collected, view: MapView, ctx: LayerContext): LayerContent => ({
  layer,
  ...finish(collected, usableCenter(view.center), ctx.lod.budgets[layer]),
});

// =============================================================================================
// Zone frames

function collectZoneFrames(ctx: LayerContext, mapId: WorldMapId, focusZone: UiMapId | null, filled: boolean): Collected {
  const surface = ctx.surfaces.find((candidate) => candidate.mapId === mapId);
  const frames: { readonly candidate: Candidate; readonly area: number; readonly uiMapId: UiMapId }[] = [];
  for (const map of ctx.geometry.maps.values()) {
    const rows = map.assignments.filter((row) => row.mapId === mapId && row.areaId > 0 && isFullUiRectangle(row));
    for (const row of rows) {
      const bounds = rowBounds(row);
      const focused = map.uiMapId === focusZone;
      const descriptor: FrameDescriptor = {
        type: 'frame',
        id: rows.length === 1 ? `frame:${String(map.uiMapId)}` : `frame:${String(map.uiMapId)}:${String(row.orderIndex)}`,
        bounds,
        kind: 'zone',
        label: map.name,
        emphasis: focused ? 'strong' : 'normal',
        filled,
        ref: { kind: 'zone', uiMapId: map.uiMapId },
      };
      frames.push({ candidate: { descriptor, tier: focused ? 0 : 1, anchor: { kind: 'box', ...bounds } }, area: areaOf(bounds), uiMapId: map.uiMapId });
    }
  }
  // Large frames first so cities draw over their zones; the focused frame last, on top.
  frames.sort((a, b) => b.candidate.tier - a.candidate.tier || b.area - a.area || a.uiMapId - b.uiMapId || byDescriptorId(a.candidate, b.candidate));
  const candidates: Candidate[] = [];
  if (surface !== undefined) {
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
  return contentOf('zone-frames', collectZoneFrames(ctx, view.mapId, focusZone, filled), view, ctx);
}

// =============================================================================================
// Art (committed, D-033; or a local set's, D-018)

/** A usable image rectangle: finite edges, not empty. */
const isImageRect = (b: WorldBounds): boolean =>
  [b.xMin, b.xMax, b.yMin, b.yMax].every((v) => Number.isFinite(v)) && b.xMax > b.xMin && b.yMax > b.yMin;

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1);

function collectArt(ctx: LayerContext, art: readonly ArtInput[], mapId: WorldMapId): Collected {
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
      otherSurfaces += 1;
      continue;
    }
    const descriptor: ArtDescriptor = {
      type: 'art',
      id: `art:${String(entry.uiMapId)}`,
      bounds: { mapId: bounds.mapId, xMin: bounds.xMin, xMax: bounds.xMax, yMin: bounds.yMin, yMax: bounds.yMax },
      url: entry.url,
      opacity: clamp01(entry.opacity),
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
  return contentOf('art', collectArt(ctx, art, view.mapId), view, ctx);
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

/** Outline descriptors by input, so an unchanged input keeps its descriptor object (and a rebuild compares nothing). */
const outlineDescriptors = new WeakMap<OutlineInput, Map<OutlineLayerId, OutlineDescriptor | null>>();

function outlineOf(layer: OutlineLayerId, input: OutlineInput): OutlineDescriptor | null {
  let byLayer = outlineDescriptors.get(input);
  if (byLayer === undefined) {
    byLayer = new Map();
    outlineDescriptors.set(input, byLayer);
  }
  const cached = byLayer.get(layer);
  if (cached !== undefined) return cached;
  const mapId = input.mapId;
  const lines = input.lines.filter((line) => line.length >= 2 && line.every((p) => p.mapId === mapId && Number.isFinite(p.x) && Number.isFinite(p.y)));
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
  byLayer.set(layer, descriptor);
  return descriptor;
}

/** The first input on the view's world map, as one path (see `collectRelief` on other world maps). */
function collectOutline(layer: OutlineLayerId, outlines: readonly OutlineInput[], mapId: WorldMapId): Collected {
  const candidates: Candidate[] = [];
  for (const input of outlines) {
    if (input.mapId !== mapId || candidates.length > 0) continue;
    const descriptor = outlineOf(layer, input);
    if (descriptor !== null) candidates.push({ descriptor, tier: 1, anchor: boxAnchor(descriptor.lines.flat()) });
  }
  return { candidates, aggregated: 0, unresolved: new ReasonTally(), otherSurfaces: 0 };
}

/** The view's world map's zone outlines (terrain arcs), as one canvas path. */
export function buildZoneOutlines(ctx: LayerContext, outlines: readonly OutlineInput[], view: MapView): LayerContent {
  return contentOf('zone-outlines', collectOutline('zone-outlines', outlines, view.mapId), view, ctx);
}

/** The view's world map's coastline (terrain arcs), as one canvas path. */
export function buildCoastline(ctx: LayerContext, outlines: readonly OutlineInput[], view: MapView): LayerContent {
  return contentOf('coastline', collectOutline('coastline', outlines, view.mapId), view, ctx);
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
}

/** Groups by subject, ascending by key; the first group's label and spawns are kept and quest ids united. */
function mergeGroups(groups: readonly PointGroupInput[]): readonly MergedGroup[] {
  const byKey = new Map<string, { readonly group: PointGroupInput; readonly quests: QuestId[] }>();
  for (const group of groups) {
    const key = subjectKey(group.subject);
    const existing = byKey.get(key);
    if (existing === undefined) byKey.set(key, { group, quests: [...group.questIds] });
    else existing.quests.push(...group.questIds);
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([key, { group, quests }]) => ({ key, subject: group.subject, label: group.label, questIds: sortedUniqueNumbers(quests), spawns: group.spawns }));
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

function collectSpawns(
  ctx: LayerContext,
  layer: SpawnLayerId,
  input: SpawnLayerInput,
  mapId: WorldMapId,
  aggregate: boolean,
  focusQuests: ReadonlySet<number>,
  rawZone: UiMapId | null,
): Collected {
  const unresolved = new ReasonTally();
  let otherSurfaces = 0;
  let aggregated = 0;
  const raw: Candidate[] = [];
  const buckets = new Map<number, Bucket>();
  const kind = SPAWN_MARKER[layer];
  const zoneMaps = zoneMapsOf(ctx.geometry);
  for (const group of mergeGroups(input.groups)) {
    const isFocused = group.questIds.some((id) => focusQuests.has(id));
    group.spawns.forEach((spawn, spawnIndex) => {
      const world = spawn.world;
      if (world === null) {
        unresolved.add(spawnUnplacedReason(spawn, ctx.geometry));
        return;
      }
      if (world.mapId !== mapId) {
        otherSurfaces += 1;
        return;
      }
      // The zone the user jumped to is drawn raw at any zoom, like a focused quest's points.
      if (aggregate && !isFocused && (rawZone === null || spawn.uiMapId !== rawZone)) {
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
      });
      raw.push({ descriptor, tier: isFocused ? 0 : 1, anchor: pointAnchor(world) });
    });
  }
  const [one, many] = SPAWN_NOUNS[layer];
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
      };
      return { descriptor, tier: 1, anchor: pointAnchor(point) };
    });
  // Raw markers by id, stacks merged, focused ones on top.
  const markers = focusedLast(mergeStacks(raw.sort(byDescriptorId)));
  return { candidates: [...aggregates, ...markers], aggregated, unresolved, otherSurfaces };
}

/** Whether a spawn layer aggregates at this zoom. */
export function spawnLayerAggregates(layer: SpawnLayerId, zoom: number, lod: LodSettings = DEFAULT_LOD): boolean {
  return lodLevelAt(zoom, lod) === 'continent' && !lod.rawAtAnyZoom.includes(layer);
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
  const collected = collectSpawns(ctx, layer, input, view.mapId, spawnLayerAggregates(layer, view.zoom, ctx.lod), new Set(focusQuests), rawZone);
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

/**
 * A run's polylines, each of at most `max` vertices, by step range. The steps are cut into pieces
 * as without paths (`routePieces`, content-defined boundaries). A piece whose legs' path points
 * take it over `max` vertices is cut again at the last step that fits, or inside a leg longer than
 * `max` on its own; an edit therefore re-cuts only the pieces of the steps it touched. Without
 * path points this is exactly `routePieces`.
 */
function runPieces(run: OpenRun, max: number = ROUTE_PIECE_MAX_VERTICES): readonly StepPiece[] {
  const out: StepPiece[] = [];
  const stepAt = (index: number): string => run.steps[index]?.stepId ?? '';
  const vertexOf = (index: number): number => run.stepVertex[index] ?? 0;
  for (const [a, b] of routePieces(run.steps.map((step) => step.stepId))) {
    const end = vertexOf(b);
    let start = vertexOf(a);
    if (end - start + 1 <= max) {
      out.push({ a, b, pieces: [{ first: start, last: end, from: a, base: stepAt(a) }] });
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
        for (let j = k + 1; j <= b && vertexOf(j) <= limit; j += 1) best = j;
        cut = best > k ? vertexOf(best) : limit;
      }
      const base = start === vertexOf(k) ? stepAt(k) : `${stepAt(k + 1)}@${String(start - vertexOf(k))}`;
      pieces.push({ first: start, last: cut, from: k, base });
      while (k + 1 <= b && vertexOf(k + 1) <= cut) k += 1;
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

function collectRouteLine(
  ctx: LayerContext,
  route: RouteInput,
  mapId: WorldMapId,
  override: 'proposal' | null,
  paths: RoutePathsInput | null = null,
  cache: LegCache | null = null,
  pieceCache: PieceCache | null = null,
): Collected {
  const walk = walkRoute(route, override, paths, cache);
  const ids = new IdAllocator();
  let otherSurfaces = 0;
  const lines: Candidate[] = [];
  for (const run of walk.runs) {
    const style: LineStyle = run.style ?? override ?? 'route';
    const onMap = run.mapId === mapId;
    if (!onMap) otherSurfaces += 1;
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
        otherSurfaces += 1;
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
      otherSurfaces += 1;
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
  const collected: Collected = { candidates: [...lines, ...mergeStacks(glyphs)], aggregated: 0, unresolved: walk.unresolved, otherSurfaces };
  return paths === null ? collected : { ...collected, paths: walk.paths.get(mapId) ?? { along: 0, pending: 0, fallback: 0 } };
}

/**
 * The route line on the view's world map: one polyline per (world map, style) run, cut into pieces
 * of at most 256 vertices, with transition glyphs at world-map changes and a departure glyph where
 * a hearth without a location leaves. With `paths`, walked legs follow their walking paths, and
 * legs without one are drawn straight as pending or fallback (`LayerStats.paths` counts them).
 */
export function buildRouteLine(ctx: LayerContext, route: RouteInput, view: MapView, paths: RoutePathsInput | null = null): LayerContent {
  return contentOf('route-line', collectRouteLine(ctx, route, view.mapId, null, paths), view, ctx);
}

/** The proposal overlay (ARCHITECTURE §12.5): the proposed route's line in the `proposal` style, never along paths; empty for null. */
export function buildProposal(ctx: LayerContext, route: RouteInput | null, view: MapView): LayerContent {
  const collected: Collected =
    route === null ? { candidates: [], aggregated: 0, unresolved: new ReasonTally(), otherSurfaces: 0 } : collectRouteLine(ctx, route, view.mapId, 'proposal');
  return contentOf('proposal', collected, view, ctx);
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
function collectRouteSteps(route: RouteInput, mapId: WorldMapId, candidates: StepCandidates = UNCACHED_STEP_CANDIDATES): Collected {
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
      otherSurfaces += 1;
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
  return contentOf('route-steps', collectRouteSteps(route, view.mapId), view, ctx);
}

/**
 * The focused steps (selected, hovered, active) on this world map: the leg into the active step,
 * a halo round each, and each one's own marker again, strong, above the route's markers, so a
 * focused step shows even where the route-steps cap left it out. The active step's items are kept
 * first under the cap. Stacks are merged per kind.
 */
function collectSelection(route: RouteInput, mapId: WorldMapId, focus: StepFocus, paths: RoutePathsInput | null = null, cache: LegCache | null = null): Collected {
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
      otherSurfaces += 1;
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
  return contentOf('selection', collectSelection(route, view.mapId, focus, paths), view, ctx);
}

// =============================================================================================
// Memoised builders

class Slot {
  collectKey: readonly unknown[] | null = null;
  collected: Collected | null = null;
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

function computeSlot(slot: Slot, layer: LayerId, ctx: LayerContext, collectKey: readonly unknown[], collect: () => Collected, view: MapView): LayerContent {
  if (slot.collected === null || !sameKey(slot.collectKey, collectKey)) {
    slot.collected = collect();
    slot.collectKey = collectKey;
  }
  const collected = slot.collected;
  const budget = ctx.lod.budgets[layer];
  // The centre only matters when the cap bites, and then only its grid cell: a small pan changes nothing.
  const over = collected.candidates.length > budget;
  const center = over ? rankingCenter(view) : null;
  const finishKey = [collected, center?.x ?? null, center?.y ?? null, center?.grid ?? null];
  if (slot.content !== null && sameKey(slot.finishKey, finishKey)) return slot.content;
  const { items, stats } = finish(collected, center, budget, over ? heldBy(slot, view) : null);
  slot.held = over ? new Set(items.map((item) => item.id)) : new Set();
  slot.content = stabilize(slot, layer, items, stats);
  slot.finishKey = finishKey;
  return slot.content;
}

const questFocusKey = (quests: readonly QuestId[]): string => sortedUniqueNumbers(quests).join(',');
const stepFocusKey = (focus: StepFocus): string => JSON.stringify([sortedUniqueStrings(focus.selected), focus.hovered, focus.active]);

/**
 * Per-layer memoised builders over one geometry. Each method recomputes only when its own inputs
 * change (inputs by reference, focus by content, the view by world map and level of detail, and
 * the centre only while the cap bites, by grid cell), and returns the previous `LayerContent`
 * object otherwise. Under the cap they also keep what they already draw while it stays in view
 * (MAPS §7.2), so their output depends on the calls before; the stateless `build*` functions rank
 * from the exact centre alone.
 */
export interface MapLayers {
  readonly geometry: MapGeometry;
  readonly surfaces: readonly SurfaceInfo[];
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
}

export interface MapLayersOptions {
  readonly geometry: MapGeometry;
  readonly lod?: LodOverrides;
}

export function createMapLayers(options: MapLayersOptions): MapLayers {
  const lod = createLod(options.lod);
  const ctx = layerContextOf(options.geometry, lod);
  const slots = new Map<LayerId, Slot>();
  const stepCandidates = createStepCandidates();
  // One leg cache for the route line and the selection's leg: both draw the same legs.
  const legs: LegCache = new WeakMap();
  const pieces: PieceCache = new WeakMap();
  const slot = (layer: LayerId): Slot => {
    const existing = slots.get(layer);
    if (existing !== undefined) return existing;
    const created = new Slot();
    slots.set(layer, created);
    return created;
  };
  return {
    geometry: options.geometry,
    surfaces: ctx.surfaces,
    lod,
    lodLevel: (zoom) => lodLevelAt(zoom, lod),
    zoneFrames: (view, focusZone = null, filled = true) =>
      computeSlot(slot('zone-frames'), 'zone-frames', ctx, [view.mapId, focusZone, filled], () => collectZoneFrames(ctx, view.mapId, focusZone, filled), view),
    art: (art, view) => computeSlot(slot('art'), 'art', ctx, [art, view.mapId], () => collectArt(ctx, art, view.mapId), view),
    relief: (relief, view, underArt = false) =>
      computeSlot(slot('relief'), 'relief', ctx, [relief, view.mapId, underArt], () => collectRelief(relief, view.mapId, underArt), view),
    zoneOutlines: (outlines, view) =>
      computeSlot(slot('zone-outlines'), 'zone-outlines', ctx, [outlines, view.mapId], () => collectOutline('zone-outlines', outlines, view.mapId), view),
    coastline: (outlines, view) =>
      computeSlot(slot('coastline'), 'coastline', ctx, [outlines, view.mapId], () => collectOutline('coastline', outlines, view.mapId), view),
    spawns: (layer, input, view, focusQuests = [], rawZone = null) => {
      const aggregate = spawnLayerAggregates(layer, view.zoom, lod);
      const focusKey = questFocusKey(focusQuests);
      // The raw zone matters only while the layer aggregates.
      const zone = aggregate ? rawZone : null;
      return computeSlot(
        slot(layer),
        layer,
        ctx,
        [input, view.mapId, aggregate, focusKey, zone],
        () => collectSpawns(ctx, layer, input, view.mapId, aggregate, new Set(focusQuests), zone),
        view,
      );
    },
    routeLine: (route, view, paths = null) =>
      computeSlot(slot('route-line'), 'route-line', ctx, [route, view.mapId, paths], () => collectRouteLine(ctx, route, view.mapId, null, paths, legs, pieces), view),
    routeSteps: (route, view) => computeSlot(slot('route-steps'), 'route-steps', ctx, [route, view.mapId], () => collectRouteSteps(route, view.mapId, stepCandidates), view),
    proposal: (route, view) =>
      computeSlot(
        slot('proposal'),
        'proposal',
        ctx,
        [route, view.mapId],
        () =>
          route === null
            ? { candidates: [], aggregated: 0, unresolved: new ReasonTally(), otherSurfaces: 0 }
            : collectRouteLine(ctx, route, view.mapId, 'proposal'),
        view,
      ),
    selection: (route, view, focus, paths = null) =>
      computeSlot(
        slot('selection'),
        'selection',
        ctx,
        [route, view.mapId, stepFocusKey(focus), paths],
        () => collectSelection(route, view.mapId, focus, paths, legs),
        view,
      ),
  };
}

// =============================================================================================
// Honest notes for a layer panel

const REASON_TEXT: Readonly<Record<UnplacedReason, string>> = {
  'no-geometry': 'on a map with no geometry',
  'outside-ui-rectangles': 'outside every map rectangle',
  'no-era-coefficients': 'in an Era frame with no conversion',
  'non-finite': 'with invalid coordinates',
  'instance-without-entrance': 'inside an instance with no known entrance',
  'unmapped-area': 'in an area no map shows',
  'destination-unknown': 'moving somewhere the route does not say',
};

/** A unit noun, singular and plural: `['point', 'points']`. */
export type StatsNoun = readonly [one: string, many: string];

/** What each `LayerStats` count of a layer counts. `aggregated` always counts points. */
export interface StatsUnits {
  /** `notDrawn`: descriptors cut by the cap. */
  readonly items: StatsNoun;
  /** `unresolved`. */
  readonly unplaced: StatsNoun;
  /** `otherSurfaces`. */
  readonly elsewhere: StatsNoun;
}

const SPAWN_UNITS: StatsUnits = { items: ['marker', 'markers'], unplaced: ['point', 'points'], elsewhere: ['point', 'points'] };
const LINE_UNITS: StatsUnits = {
  items: ['line piece or glyph', 'line pieces and glyphs'],
  unplaced: ['step', 'steps'],
  elsewhere: ['line or glyph', 'lines and glyphs'],
};
const uniform = (noun: StatsNoun): StatsUnits => ({ items: noun, unplaced: noun, elsewhere: noun });

/** The units of every layer's stats. */
export const LAYER_STATS_UNITS: Readonly<Record<LayerId, StatsUnits>> = {
  relief: uniform(['image', 'images']),
  art: uniform(['image', 'images']),
  coastline: uniform(['outline', 'outlines']),
  'zone-outlines': uniform(['outline', 'outlines']),
  'zone-frames': uniform(['frame', 'frames']),
  'available-quests': SPAWN_UNITS,
  objectives: SPAWN_UNITS,
  'turn-ins': SPAWN_UNITS,
  'flight-masters': SPAWN_UNITS,
  'route-line': LINE_UNITS,
  'route-steps': { items: ['step marker', 'step markers'], unplaced: ['step', 'steps'], elsewhere: ['step', 'steps'] },
  proposal: LINE_UNITS,
  selection: { items: ['halo or leg', 'halos and legs'], unplaced: ['step', 'steps'], elsewhere: ['step', 'steps'] },
};

const nounFor = (n: number, noun: StatsNoun): string => (n === 1 ? noun[0] : noun[1]);

/**
 * Short sentences for a layer panel: what the layer leaves out and why, always with the unit, for
 * example `1,234 more markers not drawn: zoom in or pan to see them` or
 * `12 points not placed: 10 inside an instance with no known entrance, 2 in an area no map shows`.
 * `unit` is the layer (its `LAYER_STATS_UNITS`) or one noun for every count.
 */
export function layerStatsNotes(stats: LayerStats, unit: LayerId | StatsNoun): readonly string[] {
  const units = typeof unit === 'string' ? LAYER_STATS_UNITS[unit] : uniform(unit);
  const notes: string[] = [];
  if (stats.notDrawn > 0) notes.push(`${groupDigits(stats.notDrawn)} more ${nounFor(stats.notDrawn, units.items)} not drawn: zoom in or pan to see them`);
  if (stats.aggregated > 0) notes.push(`${plural(stats.aggregated, 'point', 'points')} shown as zone counts: zoom in to see them`);
  if (stats.unresolved > 0) {
    const parts = Object.entries(stats.unresolvedBy).map(([reason, count]) => `${groupDigits(count ?? 0)} ${REASON_TEXT[reason as UnplacedReason]}`);
    notes.push(`${plural(stats.unresolved, ...units.unplaced)} not placed: ${parts.join(', ')}`);
  }
  if (stats.otherSurfaces > 0) notes.push(`${plural(stats.otherSurfaces, ...units.elsewhere)} on other world maps`);
  return notes;
}
