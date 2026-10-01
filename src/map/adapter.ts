import type { SpawnPoint } from '../domain/dataset';
import { worldMapId, type NpcId, type ObjectId, type QuestId, type StepId, type UiMapId, type WorldMapId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';
import { resolveAtlasPoint, type AtlasPlacement } from '../geo/atlas';
import type { AtlasLayout } from '../geo/atlas-layout';
import type { UnresolvedReason } from '../geo/resolve';
import type { Difficulty } from '../rules/difficulty';
import type { FlightSides, MarkDifficulty, MarkState } from './marks';

export type { AtlasPlacement } from '../geo/atlas';
export type { AtlasLayout, AtlasRect } from '../geo/atlas-layout';

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
 *
 * The atlas surface (docs/research/map-atlas.md §5, §8.1; D-042) shows several world maps at
 * once, each placed by a translation (`AtlasPlacement`, src/geo/atlas.ts). Descriptors stay in
 * world coordinates; only the adapter's funnel, and the surface's own placements and layout,
 * hold atlas units (D-017: display only, never a distance, never persisted).
 */

// =============================================================================================
// Surfaces

/**
 * A world surface per world map, `world:<mapId>` (ARCHITECTURE §7.1), and the atlas, `atlas`: maps
 * 0 and 1 and the Zephras Isle inset on one surface (map-atlas.md §5).
 */
export type SurfaceId = `world:${number}` | 'atlas';

/** The atlas surface's id. */
export const ATLAS_SURFACE_ID = 'atlas';

const SURFACE_ID = /^world:(0|[1-9]\d*)$/;

export function surfaceIdOf(mapId: WorldMapId): SurfaceId {
  return `world:${String(mapId)}` as SurfaceId;
}

/** The world map a world surface id names, or null unless the text is exactly `world:<non-negative integer>` (the atlas names several: null). */
export function parseSurfaceId(text: string): WorldMapId | null {
  const match = SURFACE_ID.exec(text);
  return match?.[1] === undefined ? null : worldMapId(Number(match[1]));
}

/** True for `atlas` and for a canonical `world:<mapId>`. */
export function isSurfaceId(text: string): text is SurfaceId {
  return text === ATLAS_SURFACE_ID || parseSurfaceId(text) !== null;
}

/** `parseSurfaceId` for a value typed as a world surface id; throws on a malformed one (`world:1.5`, `world:-1`) and on the atlas, which shows several maps. */
export function surfaceMapId(surface: SurfaceId): WorldMapId {
  const mapId = parseSurfaceId(surface);
  if (mapId === null) throw new RangeError(`not a world surface id: ${surface}`);
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
export interface WorldSurfaceInfo {
  /** Absent or `world`: one world map (`atlasSurfaceOf` builds the other kind). */
  readonly kind?: 'world';
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

/**
 * The atlas (docs/research/map-atlas.md §5, §8.1; D-042): maps 0 and 1 placed side by side and
 * Zephras Isle as an inset, each by a translation (`placements`, placed maps first). Built by
 * `atlasSurfaceOf` in map/layers. Its placements and layout are the only atlas units a surface
 * carries (D-017: display only).
 */
export interface AtlasSurfaceInfo {
  readonly kind: 'atlas';
  readonly id: 'atlas';
  /** The first placed map (Kalimdor): the map `extent` is expressed in. The atlas shows every map of `mapIds`. */
  readonly mapId: WorldMapId;
  /** `Azeroth`: the world map's UiMap name (947). */
  readonly name: string;
  /**
   * The layout's extent (map-atlas.md §5.6, the card included) expressed in the yards of `mapId`'s
   * placement: a translation of the atlas rectangle, so fitting it shows the whole atlas. For
   * fitting and bounding the view only, never a distance (D-017).
   */
  readonly extent: WorldBounds;
  readonly extentSource: 'atlas';
  readonly extentUiMapId: null;
  /** Every UiMap with a full-rectangle row on a placed map, ascending. */
  readonly uiMapIds: readonly UiMapId[];
  /** The placed maps, in placement order. */
  readonly mapIds: readonly WorldMapId[];
  readonly placements: readonly AtlasPlacement[];
  readonly layout: AtlasLayout;
  /** `atlasHash(placements, layout)` (src/geo/atlas.ts): the identity the tile index must carry (check T4). */
  readonly hash: string;
  /** Each placed map's own world surface (its name, continent frame and UiMaps), in placement order. */
  readonly members: readonly WorldSurfaceInfo[];
}

export type SurfaceInfo = WorldSurfaceInfo | AtlasSurfaceInfo;

export const isAtlasSurface = (info: SurfaceInfo): info is AtlasSurfaceInfo => info.kind === 'atlas';

/**
 * How one world map is drawn on a surface (map-atlas.md §5.1, §5.2): translated into the surface's
 * plane, `E = eOff − y`, `S = sOff − x`, with Leaflet's `latLng = (−S, E)`. A world surface draws
 * its map through the identity placement (`eOff = sOff = 0`, so `latLng = (x, −y)`); the atlas
 * through its `AtlasPlacement`s. `rect` is the world rectangle the placement covers.
 */
export interface SurfacePlacement {
  readonly mapId: WorldMapId;
  readonly kind: 'identity' | 'placed' | 'inset';
  /** Atlas units per world yard: 1 everywhere (translation only, D-042 A1). */
  readonly scale: 1;
  readonly eOff: number;
  readonly sOff: number;
  readonly rect: WorldBounds;
}

const identityPlacements = new WeakMap<WorldSurfaceInfo, readonly SurfacePlacement[]>();

/** The placements a surface draws through: the atlas's, or a world surface's one identity placement (over its extent). */
export function surfacePlacements(info: SurfaceInfo): readonly SurfacePlacement[] {
  if (isAtlasSurface(info)) return info.placements;
  const cached = identityPlacements.get(info);
  if (cached !== undefined) return cached;
  const placements: readonly SurfacePlacement[] = [{ mapId: info.mapId, kind: 'identity', scale: 1, eOff: 0, sOff: 0, rect: info.extent }];
  identityPlacements.set(info, placements);
  return placements;
}

/** The world maps a surface shows. */
export function surfaceMapIds(info: SurfaceInfo): readonly WorldMapId[] {
  return isAtlasSurface(info) ? info.mapIds : [info.mapId];
}

/** The placement of `mapId` on the surface, or null when the surface does not show that map. */
export function placementOn(info: SurfaceInfo, mapId: WorldMapId): SurfacePlacement | null {
  for (const placement of surfacePlacements(info)) if (placement.mapId === mapId) return placement;
  return null;
}

/**
 * The world point under an atlas position (`e` east, `s` south, atlas yards) on `info`: on the
 * atlas, the map the partition gives (map-atlas.md §5.4: inside an inset's card its map, else the
 * side of `seamE`) and that map's inverse, so every point resolves to a real world map (D-042 A5);
 * on a world surface, the identity's inverse. Null only for an atlas whose placements do not come
 * from its layout.
 */
export function surfacePointAt(info: SurfaceInfo, e: number, s: number): WorldPoint | null {
  if (isAtlasSurface(info)) return resolveAtlasPoint(info.placements, info.layout, e, s);
  return { mapId: info.mapId, x: 0 - s, y: 0 - e };
}

/**
 * A rectangle on one world map moved into the yards of another map placed on the same surface
 * (the translation between their placements), or null when either map is not on it. Display only
 * (D-017): for fitting several maps' bounds in one view, never for a distance.
 */
export function boundsOnMap(info: SurfaceInfo, bounds: WorldBounds, mapId: WorldMapId): WorldBounds | null {
  const from = placementOn(info, bounds.mapId);
  const to = placementOn(info, mapId);
  if (from === null || to === null) return null;
  // x' = sOff' − S = sOff' − (sOff − x); y' = eOff' − E = eOff' − (eOff − y).
  const dx = to.sOff - from.sOff;
  const dy = to.eOff - from.eOff;
  if (dx === 0 && dy === 0) return mapId === bounds.mapId ? bounds : { ...bounds, mapId };
  return { mapId, xMin: bounds.xMin + dx, xMax: bounds.xMax + dx, yMin: bounds.yMin + dy, yMax: bounds.yMax + dy };
}

/**
 * The surface to show a point of `mapId` on: `current` when it places that map, else the first of
 * `surfaces` that does; null when none does. With the atlas on, maps 0, 1 and 2991 have no world
 * surface of their own (map-atlas.md §5.6), so their points go to the atlas.
 */
export function surfaceForMap(surfaces: readonly SurfaceInfo[], current: SurfaceId | null, mapId: WorldMapId): SurfaceInfo | null {
  const shown = current === null ? undefined : surfaces.find((info) => info.id === current);
  if (shown !== undefined && surfaceMapIds(shown).includes(mapId)) return shown;
  return surfaces.find((info) => surfaceMapIds(info).includes(mapId)) ?? null;
}

/** The smallest rectangle around several maps' bounds on one surface, in the yards of the first one's map (display only, `boundsOnMap`); null when none is on the surface. */
export function surfaceBoundsUnion(info: SurfaceInfo, bounds: readonly WorldBounds[]): WorldBounds | null {
  let out: WorldBounds | null = null;
  for (const entry of bounds) {
    const moved: WorldBounds | null = out === null ? (placementOn(info, entry.mapId) === null ? null : entry) : boundsOnMap(info, entry, out.mapId);
    if (moved === null) continue;
    out =
      out === null
        ? moved
        : {
            mapId: out.mapId,
            xMin: Math.min(out.xMin, moved.xMin),
            xMax: Math.max(out.xMax, moved.xMax),
            yMin: Math.min(out.yMin, moved.yMin),
            yMax: Math.max(out.yMax, moved.yMax),
          };
  }
  return out;
}

/**
 * The cap split across a surface's active maps (map-atlas.md §8.1, §8.2): `cap` shared in
 * proportion to `counts` (each map's candidates in view) by the largest remainder, ties to the
 * earlier entry, so the shares always sum to `cap` when any count is positive (all zeros
 * otherwise). Deterministic; counts that are not positive and finite count as zero.
 */
export function shareCap(counts: readonly number[], cap: number): readonly number[] {
  const weights = counts.map((count) => (Number.isFinite(count) && count > 0 ? count : 0));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const whole = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : 0;
  if (total === 0 || whole === 0) return weights.map(() => 0);
  const quotas = weights.map((weight) => (weight * whole) / total);
  const shares = quotas.map((quota) => Math.floor(quota));
  let left = whole - shares.reduce((sum, share) => sum + share, 0);
  const order = quotas
    .map((quota, index) => ({ index, rest: quota - Math.floor(quota) }))
    .filter((entry) => (weights[entry.index] ?? 0) > 0)
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  // Rounding leaves at most one unit per positive entry; the loop also covers a floating-point surplus.
  for (let i = 0; left > 0 && order.length > 0; i = (i + 1) % order.length) {
    const index = order[i]?.index ?? 0;
    shares[index] = (shares[index] ?? 0) + 1;
    left -= 1;
  }
  return shares;
}

// =============================================================================================
// Zoom bands (docs/research/map-presentation.md §5.1; map-atlas.md §8.7 item 7)

/**
 * The presentation's four zoom bands, chosen from the pixels per world yard of the placement an
 * item is drawn through (`pxPerYardAt`): `world` below 0.022 (both continents on the atlas),
 * `continent` to 0.088, `zone` to 0.5, `close` above. They mean the same on every surface and
 * inside an inset. The controller turns the scale into `MapView.band` with hysteresis
 * (`nextBand`), so the stateless layer builders stay deterministic.
 */
export type MapBand = 'world' | 'continent' | 'zone' | 'close';

export const MAP_BANDS: readonly MapBand[] = ['world', 'continent', 'zone', 'close'];

/** Each band's lower edge in pixels per world yard (the world band starts at 0). */
export const BAND_EDGES: Readonly<Record<Exclude<MapBand, 'world'>, number>> = { continent: 0.022, zone: 0.088, close: 0.5 };

/**
 * A band changes only when the scale passes its edge by this much zoom (half a `zoomSnap` step of
 * 0.25; with the smooth wheel's `zoomSnap` 0, a fixed 0.125: map-atlas.md §8.7 item 7). Thresholds
 * inside the bands use the same rule (`aboveThreshold`).
 */
export const BAND_HYSTERESIS_ZOOM = 0.125;

const HYSTERESIS_FACTOR = 2 ** BAND_HYSTERESIS_ZOOM;

/** Pixels per world yard at a Leaflet `CRS.Simple` zoom through a placement of `scale` atlas units per yard (1 on every placement today, D-042 A1). */
export const pxPerYardAt = (zoom: number, scale = 1): number => 2 ** zoom * scale;

/** The zoom at which a placement of `scale` draws `pxPerYard`. */
export const zoomAtPxPerYard = (pxPerYard: number, scale = 1): number => Math.log2(pxPerYard / scale);

/** The band a scale falls in, without hysteresis (a non-finite or non-positive scale is the world band). */
export function bandAt(pxPerYard: number): MapBand {
  if (!(pxPerYard >= BAND_EDGES.continent) || !Number.isFinite(pxPerYard)) return pxPerYard === Infinity ? 'close' : 'world';
  if (pxPerYard < BAND_EDGES.zone) return 'continent';
  if (pxPerYard < BAND_EDGES.close) return 'zone';
  return 'close';
}

/** A band's range in pixels per yard: [lower edge, the next band's edge). */
function bandRange(band: MapBand): readonly [number, number] {
  switch (band) {
    case 'world':
      return [0, BAND_EDGES.continent];
    case 'continent':
      return [BAND_EDGES.continent, BAND_EDGES.zone];
    case 'zone':
      return [BAND_EDGES.zone, BAND_EDGES.close];
    case 'close':
      return [BAND_EDGES.close, Infinity];
  }
}

/**
 * The band after a move, with hysteresis (§5.1): the previous band is kept until the scale passes
 * one of its edges by `BAND_HYSTERESIS_ZOOM`, so a view resting at an edge never flickers between
 * two bands. Without a previous band (the first view, a jump), the plain band.
 */
export function nextBand(previous: MapBand | null, pxPerYard: number): MapBand {
  const plain = bandAt(pxPerYard);
  if (previous === null || plain === previous || !Number.isFinite(pxPerYard)) return plain;
  const [lower, upper] = bandRange(previous);
  return pxPerYard >= lower / HYSTERESIS_FACTOR && pxPerYard < upper * HYSTERESIS_FACTOR ? previous : plain;
}

/**
 * Whether a scale is at or above an in-band threshold (a label's `minPxPerYard`, "places from
 * 0.0325"), with the band's hysteresis: once above, it stays above until the scale falls below the
 * threshold by `BAND_HYSTERESIS_ZOOM`; once below, it stays below until it passes it by as much.
 * `previous` null: the plain comparison.
 */
export function aboveThreshold(previous: boolean | null, pxPerYard: number, threshold: number): boolean {
  if (previous === null) return pxPerYard >= threshold;
  return previous ? pxPerYard >= threshold / HYSTERESIS_FACTOR : pxPerYard >= threshold * HYSTERESIS_FACTOR;
}

/** The two-level detail today's layers use (`LodLevel` in map/layers): the world and continent bands fold spawn points into counts. */
export const bandLevelOf = (band: MapBand): 'zone' | 'continent' => (band === 'world' || band === 'continent' ? 'continent' : 'zone');

// =============================================================================================
// Layers

/**
 * Every layer, in draw order from bottom to top (ARCHITECTURE §7.2; MAPS §7.3, as
 * map-presentation.md §5.2 and §25.2.6 revise it). `relief` and `art` are image overlays under
 * everything (`IMAGE_LAYER_IDS`); `labels` is drawn on its own non-interactive canvas above every
 * path (`LABEL_LAYER_IDS`, pane `frl-labels`, §5.5); the rest share one canvas and are stacked in
 * this order, which is also the hit-testing order (the topmost wins).
 *
 * - Lines go under pins, and pins under the route's beads (§25.2.6): the zone colour and frames,
 *   the flight network and transports, then the route line, then the pin tiers (services, counted
 *   objectives, quest givers, turn-ins, places), then the step beads, the proposal and the
 *   selection. The route line moved below the spawn layers (revision 2 kept it above them); its
 *   segments stay clickable wherever no marker covers them.
 * - `zone-fill`, `flight-network`, `transports`, `dungeons` and `services` are the presentation
 *   design's new layers; their builders arrive with their steps (MP.5 to MP.11) and until then they
 *   are empty.
 */
export const LAYER_IDS = [
  'relief',
  'art',
  'coastline',
  'zone-outlines',
  'zone-fill',
  'zone-frames',
  'flight-network',
  'transports',
  'route-line',
  'services',
  'objectives',
  'available-quests',
  'turn-ins',
  'dungeons',
  'flight-masters',
  'route-steps',
  'proposal',
  'selection',
  'labels',
] as const;

export type LayerId = (typeof LAYER_IDS)[number];

/** The layers drawn as image overlays below the canvas: their budgets count images, not canvas paths. */
export type ImageLayerId = 'relief' | 'art';

export const IMAGE_LAYER_IDS: readonly ImageLayerId[] = ['relief', 'art'];

export const isImageLayer = (layer: LayerId): layer is ImageLayerId => layer === 'relief' || layer === 'art';

/**
 * The layers drawn on the labels canvas (map-presentation.md §5.5, §13): above every path, taking
 * no hits, redrawn on its own (a renumbering after an edit redraws only it). They count against the
 * path cap like canvas paths.
 */
export type LabelLayerId = 'labels';

export const LABEL_LAYER_IDS: readonly LabelLayerId[] = ['labels'];

export const isLabelLayer = (layer: LayerId): layer is LabelLayerId => layer === 'labels';

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
  'zone-fill': 'Zone colour and faction',
  'zone-frames': 'Zone frames',
  'flight-network': 'Flight network',
  transports: 'Transports',
  'route-line': 'Route line',
  services: 'Services',
  objectives: 'Objectives',
  'available-quests': 'Available quests',
  'turn-ins': 'Turn-ins',
  dungeons: 'Dungeons and raids',
  'flight-masters': 'Flight masters',
  'route-steps': 'Step markers',
  proposal: 'Proposal overlay',
  selection: 'Selection',
  labels: 'Zone names and levels',
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
export type LineStyle = LegStyle | 'route-pending' | 'route-fallback' | 'highlight' | 'proposal' | NetworkLineStyle;

/**
 * The travel network's lines (map-presentation.md §5.3, §9, §10, §25.4; steps MP.8, MP.9): a flight
 * of the client taxi graph, and a same-map transport ride between two stops. Thin and muted, under
 * every pin, so the route's own legs stay the strongest lines.
 */
export type NetworkLineStyle = 'network-flight' | 'network-transport';

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
   * A cross-map leg drawn as an arc between two world maps placed on the atlas (a boat, zeppelin or
   * portal between the continents; map-atlas.md §8.5): the leg into `toStepId`.
   */
  | {
      readonly kind: 'connector';
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
  /**
   * A cluster of quest givers or turn-ins below the zone band (map-presentation.md §25.2.5; step
   * MP.4a): a click zooms to its members' bounds, no further than the zone band.
   */
  | { readonly kind: 'cluster'; readonly layer: LayerId; readonly bounds: WorldBounds; readonly quests: number; readonly places: number }
  | { readonly kind: 'zone'; readonly uiMapId: UiMapId }
  | { readonly kind: 'surface'; readonly mapId: WorldMapId }
  | { readonly kind: 'art'; readonly uiMapId: UiMapId }
  /** A terrain-derived layer's one item on a world map: the relief image, the zone outlines or the coastline. */
  | { readonly kind: 'terrain'; readonly layer: TerrainLayerId; readonly mapId: WorldMapId }
  /** The atlas's tile raster (`TileBandDescriptor`): not interactive. */
  | { readonly kind: 'atlas-tiles' }
  /** A dungeon or raid entrance (map-presentation.md §8; step MP.5): the dataset dungeon's area id, and which of its entrances. */
  | { readonly kind: 'dungeon'; readonly dungeon: number; readonly entrance: number }
  /** A flight point with no dataset flight master, by its client TaxiNodes id (§9; step MP.8). */
  | { readonly kind: 'taxi-node'; readonly node: number }
  /** A flight of the client taxi graph between two TaxiNodes ids, the lower first (§9). */
  | { readonly kind: 'taxi-edge'; readonly from: number; readonly to: number }
  /** A transport stop or ride of the client taxi file (§10; step MP.9): its transport path id, and the stop's index or null for the ride. */
  | { readonly kind: 'transport'; readonly path: number; readonly stop: number | null }
  /** A service NPC at one of its spawns (§11; step MP.11): an innkeeper, a trainer of the character's class, or a vendor. */
  | { readonly kind: 'service'; readonly service: ServiceKind; readonly npc: NpcId; readonly spawnIndex: number };

/** What a service NPC offers the character (map-presentation.md §11): the services layer's pins and their popover actions. */
export type ServiceKind = 'innkeeper' | 'trainer' | 'vendor';

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
  /**
   * A quest mark's state after the active step (map-presentation.md §7, §25.2.3; step MP.3), from
   * the derived pipeline's `QuestStateModel`: absent while there is no route state (the givers are
   * then the quests open by race and class, and say so) and on every other kind of marker. Part of
   * the descriptor's data, so a state change restyles the marker in place. Pins draw it (MP.4a).
   */
  readonly mark?: MarkerMark;
  /**
   * The Map layers drawer's category the item belongs to (map-presentation.md §25.3.4; step MP.4a):
   * the adapter's mask hides a category by it, when drawing and hit-testing, without a rebuild.
   * Absent on items no drawer row hides (step beads, halos, transitions).
   */
  readonly category?: MapCategoryId;
  /**
   * A cluster below the zone band (map-presentation.md §25.2.5): its member quests, for the group
   * rule (`groupLook` in map/marks: colour only when every member shares one difficulty), the "×n"
   * (quests, not givers) and the mask. Absent on a single pin and on a stack at one point.
   */
  readonly cluster?: MarkerCluster;
  /**
   * A step bead after the active step (map-presentation.md §13.6, §25.4): drawn at 60 %. Absent on
   * every other marker, and on every bead while there is no active step.
   */
  readonly after?: true;
}

/**
 * One quest a pin stands for, with its own state after the active step (the pin shows its
 * best-ranked quest's, `MarkerDescriptor.mark`): what a cluster counts and colours by, and what the
 * drawer's mask and the map search filter by (map-presentation.md §25.2.5, §25.3.4, §25.3.5).
 */
export interface MarkerQuest {
  readonly questId: QuestId;
  /** Null without route state (the quests open by race and class carry no state). */
  readonly mark: MarkerMark | null;
}

/** A cluster member: one quest, with its drawer category and the places (`subjectKeyOf`) it has in the cluster. */
export interface ClusterMember extends MarkerQuest {
  readonly category: MapCategoryId;
  readonly subjects: readonly string[];
}

/** A cluster's members and extent (`MarkerDescriptor.cluster`). */
export interface MarkerCluster {
  /** One per quest, the best-ranked state first (the pin's glyph and badge are the first's), then by quest id. */
  readonly members: readonly ClusterMember[];
  /** Distinct givers or finishers (NPCs, objects) in it. */
  readonly places: number;
  /** Points (spawns) folded into it. */
  readonly points: number;
  /** The members' points' bounds on the marker's world map, for click-to-zoom. */
  readonly bounds: WorldBounds;
  /** The grid level the cluster was made at, in yards (512, 1,024, 2,048 or 4,096; §25.2.5). */
  readonly cellYards: number;
}

// =============================================================================================
// The Map layers drawer's categories (map-presentation.md §25.3.2, §25.3.4; step MP.4a)

/**
 * Every row of the Map layers drawer, in its groups' order (§25.3.2). The pin rows (Quests,
 * Instances, the travel pins, Services) are carried by descriptors (`MarkerDescriptor.category`)
 * and hidden by the adapter's mask (`MapAdapter.setMask`); the others show or hide a whole layer
 * or mode (the route line, step numbers, walking paths, labels, zone borders and faction, and the
 * painted style's relief and coastline, two rows here where §25.3.2 has one, so each keeps today's
 * default: the relief on, the coastline off).
 */
export type MapCategoryId =
  | 'available'
  | 'may-be-available'
  | 'needs-prerequisite'
  | 'unlocks-soon'
  | 'low-level'
  | 'turn-ins'
  | 'objectives'
  | 'dungeons'
  | 'raids'
  | 'unconfirmed-raids'
  | 'flight-points'
  | 'flight-network'
  | 'all-flights'
  | 'transport-stops'
  | 'portals'
  | 'other-faction-flights'
  | 'innkeepers'
  | 'trainers'
  | 'vendors'
  | 'route-line'
  | 'step-numbers'
  | 'walking-paths'
  | 'zone-labels'
  | 'zone-borders'
  | 'zone-faction'
  | 'relief'
  | 'coastline'
  | 'coordinate-grid';

export const MAP_CATEGORY_IDS: readonly MapCategoryId[] = [
  'available',
  'may-be-available',
  'needs-prerequisite',
  'unlocks-soon',
  'low-level',
  'turn-ins',
  'objectives',
  'dungeons',
  'raids',
  'unconfirmed-raids',
  'flight-points',
  'flight-network',
  'all-flights',
  'transport-stops',
  'portals',
  'other-faction-flights',
  'innkeepers',
  'trainers',
  'vendors',
  'route-line',
  'step-numbers',
  'walking-paths',
  'zone-labels',
  'zone-borders',
  'zone-faction',
  'relief',
  'coastline',
  'coordinate-grid',
];

export const isMapCategoryId = (value: unknown): value is MapCategoryId => typeof value === 'string' && (MAP_CATEGORY_IDS as readonly string[]).includes(value);

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

/** A quest mark's drawer row (§25.3.2): the "!" states by their row, every turn-in state under Turn-ins, a counted objective under Objectives. */
export function categoryOfMark(state: MarkState | null): MapCategoryId {
  return state === null ? 'available' : (MARK_CATEGORY[state] ?? 'available');
}

/** A dataset subject's key, as the mask and the search name it: `npc:3143`, `object:1619`, `event:<questId>:<objective>`. */
export function subjectKeyOf(subject: PointSubject): string {
  switch (subject.kind) {
    case 'npc':
      return `npc:${String(subject.id)}`;
    case 'object':
      return `object:${String(subject.id)}`;
    case 'event':
      return `event:${String(subject.questId)}:${String(subject.objective)}`;
  }
}

/**
 * What the adapter draws of the pin layers (map-presentation.md §25.3.4, §25.3.5): the drawer's
 * hidden categories, and while a map search is active only what it found. A mask costs a redraw,
 * never a rebuild; the caps apply when layers are built, so a hidden category frees no budget.
 */
export interface MapMask {
  /** Categories not drawn and not hit-tested. */
  readonly hidden: readonly MapCategoryId[];
  /**
   * While a query is active: only the pin layers' items whose place (`subjectKeyOf`) or quests are
   * among these are drawn (the route, the selection and the base map stay), and the places model's
   * pins found by id (`places`: dungeons, flight points, stops, services; review PR-05); null for
   * no search.
   */
  readonly only: { readonly subjects: readonly string[]; readonly quests: readonly QuestId[]; readonly places?: readonly string[] | undefined } | null;
}

export const NO_MAP_MASK: MapMask = { hidden: [], only: null };

/** The layers whose items are pins (§25.2.2), the ones the mask applies to. */
export const PIN_LAYER_IDS: readonly LayerId[] = ['services', 'objectives', 'available-quests', 'turn-ins', 'dungeons', 'flight-masters', 'transports'];

/** Whether a marker of a layer is drawn as a pin: every marker of a pin layer except a focused quest's raw objective points (§6.1's dots, §25.2.2). */
export function isPinMarker(layer: LayerId, descriptor: MarkerDescriptor): boolean {
  if (!PIN_LAYER_IDS.includes(layer)) return false;
  return layer !== 'objectives' || descriptor.mark?.state === 'objective';
}

/**
 * A quest mark's look inputs (the one state table, `src/map/marks.ts` §25.2.3): its state, the
 * quest's difficulty at the step (the colour, with the pips, where the shape is 11 px or more;
 * null: unknown or not one difficulty), whether its objectives are inside a dungeon (the TL arch),
 * and a turn-in's objectives done (the TR progress pie), or null.
 */
export interface MarkerMark {
  readonly state: MarkState;
  readonly difficulty: MarkDifficulty | null;
  readonly dungeonQuest: boolean;
  readonly progress: { readonly done: number; readonly total: number } | null;
  /** Unlocks soon: the level it unlocks at (the TR level pill, "16"); absent or null otherwise, or when unknown ("?"). */
  readonly unlockLevel?: number | null;
  /** A flight point's sides (§25.2.3): its own side (absent: the default), both factions (the double edge), or none set (the dashed edge). */
  readonly sides?: FlightSides;
  /** The other faction's flight point: its letter in the TR slot. */
  readonly faction?: 'A' | 'H';
  /** An entrance whose position the dataset's audit did not verify (`frameVerified` false): the BL dashed ring. */
  readonly positionUnverified?: boolean;
}

/**
 * Where a place's hover names the active step (steps MP.5, MP.8): descriptors never carry a step
 * number (it changes with every insert above the step), so the map's label provider puts the
 * number in at paint time, from the places model's step.
 */
export const STEP_TOKEN = '{step}';

/**
 * A place layer's items (dungeon entrances, flight points and flights, transport stops and rides;
 * map-presentation.md §8 to §10, steps MP.5, MP.8, MP.9), built outside the map from the committed
 * client tables and the dataset (`src/app/map-places.ts`, in the lazy derived pipeline) as plain
 * descriptors in world coordinates. The layer builder only keeps those of the view's map, applies
 * the zoomed-in rule of the flight network (§25.4) and the cap.
 */
export interface PlaceLayerInput {
  readonly items: readonly PlaceItem[];
  /** Places with no world point (not drawn), counted in the layer's stats. */
  readonly unplaced: number;
}

export interface PlaceItem {
  readonly descriptor: MarkerDescriptor | PolylineDescriptor | ConnectorDescriptor;
  /** A flight point's client TaxiNodes id (the flights it has are drawn when it is hovered or selected); absent otherwise. */
  readonly node?: number;
  /** A flight's two TaxiNodes ids: at the zone and close bands it is drawn only while one of them is in focus, or the route flies it (§25.4). */
  readonly nodes?: readonly [number, number];
  /** The route flies this flight: it is drawn at every band. */
  readonly route?: boolean;
  /** A place pin's name for the labels canvas (a dungeon, a flight point; step MP.7); absent for none. */
  readonly name?: string;
  /** A dungeon entrance's quests inside (its instances' dungeon quests), for the map popover (§8.5; step MP.6); absent for none. */
  readonly quests?: readonly QuestId[];
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
  /**
   * A route piece after the active step (map-presentation.md §13.6, §25.4; WoWF-QRP's idea): the
   * route line's pieces split at the active step, and those after it are drawn at 55 %, a solid leg
   * dashed 5-6 (the dash is the cue; the other legs keep their own dashes). Absent before it, and on
   * every piece while there is no active step.
   */
  readonly after?: true;
  /**
   * The drawer row that hides the line with its pins (map-presentation.md §25.3.4; review PR-11):
   * the travel network's transport rides go with Transport stops. Absent: no row hides it.
   */
  readonly category?: MapCategoryId;
}

/**
 * Route and proposal lines are cut into pieces of at most this many vertices (MAPS §7.4), so an
 * edit re-sets one short polyline rather than the whole route.
 */
export const MAX_POLYLINE_VERTICES = 256;

/**
 * A zone frame (outline and label), the surface extent, an inset's card on the atlas (a world map
 * shown in a box, not in position: map-atlas.md §5.5), or a city card on the atlas tiles (an
 * interior city map the tiles draw as a card at its rectangle, Ironforge and Undercity at tile
 * levels −1 and 0: map-atlas.md §6.1, §8.5). Frames are rectangles, not zone borders
 * (coordinates.md §5).
 */
export interface FrameDescriptor {
  readonly type: 'frame';
  readonly id: string;
  readonly bounds: WorldBounds;
  readonly kind: 'zone' | 'extent' | 'inset' | 'card';
  /**
   * Kept but not painted: a zone rectangle while the atlas tiles show (D-042 A8, map-atlas.md
   * §8.6). It still names the zones under a click (`MapEvent.zones`). Absent or false: painted.
   */
  readonly hidden?: boolean;
  /** Drawn over the atlas tiles (an inset's or a city's card): stroked and captioned in the atlas frame colour, which reads on the sea. */
  readonly overTiles?: boolean;
  /**
   * An underground city's frame in the minimap style (Ironforge, the Undercity; D-049 O19,
   * map-atlas.md §22): a dashed outline in the frame colour from the zone band, so the pins inside
   * have a visible context. Absent or false: solid.
   */
  readonly dashed?: boolean;
  /** Drawn inside the frame when it is large enough on screen (an inset's or a card's as a caption above it); null for none. */
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
  /**
   * The part of `bounds` the image shows, on the same map; absent or null for all of it. On the
   * atlas a continent painting is clipped to its side of the partition (map-atlas.md §5.4), so its
   * sea and parchment never cover the other continent (interim art, before the tiles).
   */
  readonly clip?: WorldBounds | null;
  readonly label: string | null;
  readonly ref: MapRef;
}

/**
 * A cross-map leg on the atlas (map-atlas.md §8.5): a boat, zeppelin or portal between two world
 * maps placed there, drawn as a dashed quadratic arc in the leg's style, bulging 12 % of the chord
 * to the left of travel, with a transition glyph at mid-arc. It is drawn only when both ends' maps
 * are placed on the surface (`descriptorOnSurface`), and its length is never used: the two ends are
 * on different world maps, so there is no distance between them (D-017).
 */
export interface ConnectorDescriptor {
  readonly type: 'connector';
  readonly id: string;
  readonly from: WorldPoint;
  readonly to: WorldPoint;
  /**
   * The leg's style; `proposal` in the proposal overlay; `network-transport` for a ride of the
   * travel network (map-presentation.md §10, §25.4; review PR-11): thin muted ink dashed 3-3 over its
   * halo, with a neutral transition glyph, so it never reads as the route's own transport leg.
   */
  readonly style: LegStyle | 'proposal' | 'network-transport';
  readonly emphasis: Emphasis;
  /** `Transport to Eastern Kingdoms`: without step numbers (the label provider adds them from `ref`). */
  readonly label: string | null;
  readonly ref: MapRef;
  /** The drawer row that hides it with its pins (a network ride: Transport stops); absent: none. */
  readonly category?: MapCategoryId;
}

/**
 * A zone card's content (map-presentation.md §13.4, §12.5): the name, the span with its basis, the
 * difficulty twin's computed input (from `src/app/zone-levels.ts`, step MP.7: the map only draws
 * it), and a width reserved for the widest content, so a card never moves when its text changes
 * (review MP-R26). The adapter widens it to the measured text, and always keeps room for the twin.
 */
export interface ZoneCard {
  readonly name: string;
  /** Line 2: "quests 13–25 (93)", "mid-30s to mid-40s (official)", "4 quests: too few for a span"; null for none. */
  readonly span: string | null;
  /**
   * The compact label's and the zone label's span after the name (§13.3, §13.5): "13–25", drawn with
   * the boxed E; null for none, and for a zone with cited text, whose compact label is its name alone.
   */
  readonly compact: string | null;
  /** The span's basis, for its marker (the boxed E for `derived`): never drawn without one. */
  readonly basis: 'derived' | 'official' | 'reported' | 'unknown' | 'client' | null;
  /** The difficulty twin: the rated key, the level text and whether the level is a lower bound (dashed edge); null when not rated. */
  readonly difficulty: { readonly key: Difficulty; readonly levelText: string; readonly lowerBound: boolean } | null;
  /** The card's reserved width in CSS pixels. */
  readonly widthPx: number;
}

/**
 * A name on the labels canvas (map-presentation.md §5.3, §13): a continent, an inset, a zone or a
 * place, anchored at a world point (a zone's pole of inaccessibility, a plate's right side, a
 * continent frame's centre, an inset's lower edge). Drawn only between `minPxPerYard` and
 * `maxPxPerYard` (with the bands' hysteresis), placed at `moveend` by static priority with the
 * collision rules of §13.2, and never hit-tested: it takes no hover or click from a mark or a route
 * segment. Its text never names a step (the label provider does that at paint time).
 */
export interface LabelDescriptor {
  readonly type: 'label';
  readonly id: string;
  readonly point: WorldPoint;
  readonly kind: 'continent' | 'inset' | 'zone' | 'place';
  /** The one-line text: the name (a compact zone label adds its card's span and basis after it). */
  readonly text: string;
  /** A zone's two-line card, drawn where it fits from 0.05 px per yard; else the compact one-line label. Null for a plain label. */
  readonly card: ZoneCard | null;
  /**
   * Static placement priority, higher first (§13.2: levelling zones by frame area, then cities,
   * then dungeon names, then flight-point names): it never depends on the selection or the route,
   * so an edit never moves a label.
   */
  readonly priority: number;
  /** Drawn at or above this scale (0: from the least zoom). */
  readonly minPxPerYard: number;
  /** Drawn below this scale; null for no upper limit. */
  readonly maxPxPerYard: number | null;
  /** Hover text, as every descriptor has: null, because a label takes no hover (it is not hit-tested). */
  readonly label: string | null;
  readonly ref: MapRef;
  /**
   * A place name's zone (the UiMap whose frame the place is most central in): where that zone's
   * painted art carries its place names legibly (`baseMapLabelsOf`), the name gives way to the
   * picture's own (map-presentation.md §13.5; review PR-12). Absent on other labels.
   */
  readonly uiMapId?: UiMapId;
}

/**
 * An objective outline of a log quest (map-presentation.md §7.4): a faint haloed ring round the
 * quest's objective points on one world map, labelled with the number of the step that completes
 * them (asked from the step numbers at paint time; null for none). Not interactive.
 */
export interface AreaDescriptor {
  readonly type: 'area';
  readonly id: string;
  readonly mapId: WorldMapId;
  /** At least three points, all on `mapId`; closed implicitly. */
  readonly ring: readonly WorldPoint[];
  readonly style: 'objective-area';
  readonly labelStep: StepId | null;
  /** The completing step is the quest's turn-in, which carries the work (D-040): its number is drawn as "t 22". Absent: false. */
  readonly labelTurnIn?: boolean;
  /** The key's and the pointer line's text ("Objectives of Plainstrider Menace"), without the step number; null for none. */
  readonly label: string | null;
  readonly ref: MapRef;
}

// =============================================================================================
// The atlas tiles (docs/research/map-atlas.md §7.1, §7.2, §8.1, §8.3)

/**
 * The base map's style (map-atlas.md §21; D-045, D-049): `minimap`, the client's minimap textures
 * with a navy sea (`maps/minimap/`), or `painted`, the atlas of painted zone maps (`maps/atlas/`).
 * Both are the same kind of tile set on the same surface: two indices of one shape (§21.1).
 */
export type MapStyle = 'minimap' | 'painted';

export const isMapStyle = (value: unknown): value is MapStyle => value === 'minimap' || value === 'painted';

/**
 * The style shown while the browser has no stored choice (map-atlas.md §21.3; D-045 item 2): the
 * minimap, since step MM.9. The minimap draws no names, so it became the default only once the
 * presentation's labels canvas and names (MP.1, MP.7) were in (§22, D-049 order MM-05); the painted
 * style is the other choice in the Map layers drawer, and the fallback when the minimap cannot be
 * shown (§21.4).
 */
export const DEFAULT_MAP_STYLE: MapStyle = 'minimap';

/**
 * Tile rows and columns a style's band keeps around the view after a pan (map-atlas.md §24.5, MM-09):
 * 1 in the minimap style, where every land key is stored, so 63 tiles at most (16.5 MB decoded) in a
 * 918 × 700 panel; Part I's 2 in the painted style, whose virtual keys share their ancestors' images.
 */
export const TILE_KEEP_BUFFER: Readonly<Record<MapStyle, number>> = { minimap: 1, painted: 2 };

/**
 * The decoded-tile memory budgets of map-atlas.md §24.5 (MM-09), per style, counted as live tile
 * images × `DECODED_TILE_BYTES` (a 256 px RGBA tile): in view (tiles meeting the view and the
 * underlay), all live tiles (with the kept buffer), and both styles during a switch, for at most
 * `holdMs` (the old band is held under the new one until the new first view has decoded).
 * The design's arithmetic against them is an ESTIMATE until MM.8 measures it (ATL.9's harness and
 * the owner's laptop).
 */
export const TILE_MEMORY_BUDGET = { inViewBytes: 12_000_000, liveBytes: 20_000_000, switchBytes: 26_000_000, holdMs: 2000 } as const;
export const DECODED_TILE_BYTES = 256 * 256 * 4;

/** An atlas rectangle: E east, S south, in atlas yards (display only, D-017). */
export interface AtlasExtent {
  readonly eMin: number;
  readonly eMax: number;
  readonly sMin: number;
  readonly sMax: number;
}

/**
 * One level of the tile index: an `nx` × `ny` grid of 256 px keys, key (x, y) covering atlas
 * pixels `[256·x, 256·(x + 1))` × `[256·y, 256·(y + 1))` at `2^z` pixels per yard. Bit
 * `k = y·nx + x` of a bitmap is bit `k mod 8` of byte `floor(k / 8)`.
 */
export interface AtlasTileLevel {
  readonly z: number;
  readonly nx: number;
  readonly ny: number;
  /** Keys with a file. */
  readonly stored: Uint8Array;
  /** Keys that are all deep sea (levels up to `baseLevel`); null for the fine levels, whose keys take their `baseLevel` ancestor's. */
  readonly sea: Uint8Array | null;
}

/**
 * The runtime tile index of one style (`public/maps/atlas/index.json` painted,
 * `public/maps/minimap/index.json` minimap; decoded by infra/maps `atlas-index.ts`; map-atlas.md
 * §7.2, §18.4, §21.1): what the tile layer needs before its first request. It describes the raster, which has no world
 * coordinates; nothing in it is a distance.
 */
export interface AtlasTileIndex {
  /** `atlasHash` of the placements the tiles were composed in: the surface's `hash` must equal it. */
  readonly hash: string;
  readonly tileSize: number;
  /** −8 and 0. */
  readonly minLevel: number;
  readonly maxLevel: number;
  /**
   * The finest level with a sea bitmap; a finer key is sea when its ancestor there is. −2 in the
   * painted style; 0 in the minimap style, where every level has one and no key is virtual (§18.4).
   */
  readonly baseLevel: number;
  /** The level the underlay holds (map-atlas.md §8.3, §24.5): −5 painted (13 tiles), −6 minimap (4 tiles). */
  readonly underlayLevel: number;
  /** The deep-sea colour (the container's background) and the coastal water colour, RGB. */
  readonly seaColour: readonly [number, number, number];
  readonly coastColour: readonly [number, number, number];
  readonly extent: AtlasExtent;
  /** `minLevel` … `maxLevel`, in order. */
  readonly levels: readonly AtlasTileLevel[];
  /** Per UiMap drawn: its top stored level and its art's yards per pixel (map-presentation `BaseMapLabels`). */
  readonly uiMaps: ReadonlyMap<UiMapId, { readonly topLevel: number; readonly ydPerPx: number }>;
}

/**
 * What a key of the raster is (map-atlas.md §7.1, §7.2): `stored` has its own file; `virtual` is
 * drawn from its nearest stored ancestor, at level `z` key (`x`, `y`), scaled `scale` = `2^(key's
 * level − z)` times, the key being the (`dx`, `dy`)-th of the ancestor's `scale` × `scale` children;
 * `sea` draws nothing (the container's deep-sea background shows), and so does a key outside the
 * index's grid or levels, for which nothing is ever requested.
 */
export type TileResolution =
  | { readonly kind: 'stored' }
  | { readonly kind: 'virtual'; readonly z: number; readonly x: number; readonly y: number; readonly scale: number; readonly dx: number; readonly dy: number }
  | { readonly kind: 'sea' };

const SEA_TILE: TileResolution = { kind: 'sea' };
const STORED_TILE: TileResolution = { kind: 'stored' };

/** Bit `k` of a bitmap (no bitwise operators, D-012). */
function bitOf(bitmap: Uint8Array, k: number): boolean {
  const byte = bitmap[Math.floor(k / 8)] ?? 0;
  return Math.floor(byte / 2 ** (k % 8)) % 2 === 1;
}

/** The index's level `z`, or null outside its levels. */
export function tileLevelOf(index: AtlasTileIndex, z: number): AtlasTileLevel | null {
  if (!Number.isInteger(z) || z < index.minLevel || z > index.maxLevel) return null;
  const level = index.levels[z - index.minLevel];
  return level?.z === z ? level : null;
}

const inGrid = (level: AtlasTileLevel, x: number, y: number): boolean =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < level.nx && y < level.ny;

/** True when key (x, y) of level `z` has a file. */
export function isStoredTile(index: AtlasTileIndex, z: number, x: number, y: number): boolean {
  const level = tileLevelOf(index, z);
  return level !== null && inGrid(level, x, y) && bitOf(level.stored, y * level.nx + x);
}

/** True when key (x, y) of level `z` is sea: its own sea bit up to `baseLevel`, its `baseLevel` ancestor's below (map-atlas.md §7.2, MA-10). */
function isSeaTile(index: AtlasTileIndex, z: number, x: number, y: number): boolean {
  const at = Math.min(z, index.baseLevel);
  const level = tileLevelOf(index, at);
  if (level === null) return false;
  const k = 2 ** (z - at);
  const ax = Math.floor(x / k);
  const ay = Math.floor(y / k);
  return level.sea !== null && inGrid(level, ax, ay) && bitOf(level.sea, ay * level.nx + ax);
}

/**
 * What key (x, y) of level `z` is (`TileResolution`): stored when the index lists it; sea when it is
 * all deep sea (below `baseLevel`, when its ancestor there is); otherwise virtual, drawn from its
 * nearest stored ancestor. Outside the index's levels or grid, or with no stored ancestor: sea.
 * Pure: the tile layer calls it for every key before creating an element or building a URL.
 */
export function resolveTile(index: AtlasTileIndex, z: number, x: number, y: number): TileResolution {
  const level = tileLevelOf(index, z);
  if (level === null || !inGrid(level, x, y)) return SEA_TILE;
  if (bitOf(level.stored, y * level.nx + x)) return STORED_TILE;
  if (isSeaTile(index, z, x, y)) return SEA_TILE;
  for (let az = z - 1; az >= index.minLevel; az -= 1) {
    const scale = 2 ** (z - az);
    const ax = Math.floor(x / scale);
    const ay = Math.floor(y / scale);
    if (isStoredTile(index, az, ax, ay)) return { kind: 'virtual', z: az, x: ax, y: ay, scale, dx: x - ax * scale, dy: y - ay * scale };
  }
  return SEA_TILE;
}

/** Every stored key of level `z`, row by row (the underlay's keys at `underlayLevel`). */
export function storedTilesAt(index: AtlasTileIndex, z: number): readonly (readonly [number, number])[] {
  const level = tileLevelOf(index, z);
  if (level === null) return [];
  const out: (readonly [number, number])[] = [];
  for (let y = 0; y < level.ny; y += 1) for (let x = 0; x < level.nx; x += 1) if (bitOf(level.stored, y * level.nx + x)) out.push([x, y]);
  return out;
}

/**
 * The atlas raster (map-atlas.md §8.1, §8.3, §21): one style's tiles on the atlas surface, drawn as
 * a tile layer over the underlay at the index's `underlayLevel`. **The one descriptor in atlas
 * units**: `bounds` and `index` describe the raster, which has no world coordinates; every other
 * descriptor is in world yards. It is drawn only on an atlas surface whose `hash` equals the
 * index's (`descriptorOnSurface`). Its id names its style (`atlas-tiles:minimap`,
 * `atlas-tiles:painted`), so a style switch replaces the band (holding the old picture under the
 * new one until the new first view has decoded, §21.2) instead of updating it in place.
 */
export interface TileBandDescriptor {
  readonly type: 'tiles';
  /** `atlas-tiles:<style>` (`tileBandId`). */
  readonly id: string;
  readonly style: MapStyle;
  /** `<base>maps/atlas/t/{z}/{x}/{y}.webp` (painted) or `<base>maps/minimap/t/…` (minimap): filled in only for stored keys (`tileUrl`). */
  readonly urlTemplate: string;
  readonly tileSize: number;
  readonly minNativeZoom: number;
  readonly maxNativeZoom: number;
  /** The raster's extent, atlas yards. */
  readonly bounds: AtlasExtent;
  readonly index: AtlasTileIndex;
  readonly underlayLevel: number;
  /** Tile rows and columns kept around the view after a pan (`TILE_KEEP_BUFFER`, map-atlas.md §24.5). */
  readonly keepBuffer: number;
  readonly label: string | null;
  readonly ref: MapRef;
}

/** A style's band id (map-atlas.md §21.2). */
export const tileBandId = (style: MapStyle): string => `atlas-tiles:${style}`;

/** The tile band of one style's index (plain data; `urlTemplate` as `tileUrl` fills it). */
export function tileBandOf(index: AtlasTileIndex, urlTemplate: string, style: MapStyle): TileBandDescriptor {
  return {
    type: 'tiles',
    id: tileBandId(style),
    style,
    urlTemplate,
    tileSize: index.tileSize,
    minNativeZoom: index.minLevel,
    maxNativeZoom: index.maxLevel,
    bounds: index.extent,
    index,
    underlayLevel: index.underlayLevel,
    keepBuffer: TILE_KEEP_BUFFER[style],
    label: null,
    ref: { kind: 'atlas-tiles' },
  };
}

/** A stored key's URL; null for a key the index does not list (the runtime never builds one, map-atlas.md §7.2). */
export function tileUrl(band: TileBandDescriptor, z: number, x: number, y: number): string | null {
  if (!isStoredTile(band.index, z, x, y)) return null;
  return band.urlTemplate.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

// =============================================================================================
// The atlas interface agreed with the presentation (map-presentation.md MP.0c; map-atlas.md §8.7)

/**
 * Which classes of names the base map's picture carries legibly in a view (map-presentation.md
 * §13.5; map-atlas.md §8.7 item 4, §22), so the presentation draws a name only where the picture
 * does not: the base map speaks first where it can be read, and our labels draw the same names
 * where the art is scaled down, cross-faded or absent.
 */
export interface BaseMapLabels {
  /** Continent names: never (no continent painting is drawn on the atlas). */
  readonly continents: boolean;
  /** Zone names: never (the zone paintings do not name their own zones), so zone labels and cards are always ours. */
  readonly zones: boolean;
  /** The UiMaps whose painted place names are legible now, ascending. */
  readonly places: readonly UiMapId[];
}

export const NO_BASE_MAP_LABELS: BaseMapLabels = { continents: false, zones: false, places: [] };

/** A painting's place names are legible when its art is drawn at this share of its native scale or more (§13.5, ASSUMPTION agreed in MP.0c). */
export const BASE_MAP_LABEL_SCALE = 0.75;

/**
 * `BaseMapLabels` for a tile band at a zoom: empty in the minimap style (the minimap has no names,
 * map-atlas.md §22; its index lists no UiMaps), without a band, while the art is not drawn at full
 * opacity (hidden, fading in, or held under a new style), and for any UiMap under the fallback tint
 * (`tinted`). In the painted style, a zone's places are legible where its art is drawn at
 * `BASE_MAP_LABEL_SCALE` of its native scale or more, the art being no sharper than the finest
 * level its tiles store: min(2^zoom, 2^topLevel) × yards per art pixel ≥ 0.75. The capitals'
 * banners are hidden at levels −1 and 0, where their city plans carry the names (map-atlas.md
 * §6.5), so their places stay legible there.
 */
export function baseMapLabelsOf(
  band: TileBandDescriptor | null,
  zoom: number,
  options: { readonly fullOpacity: boolean; readonly tinted?: ReadonlySet<UiMapId> },
): BaseMapLabels {
  if (band === null || band.style === 'minimap' || !options.fullOpacity || !Number.isFinite(zoom)) return NO_BASE_MAP_LABELS;
  const places: UiMapId[] = [];
  for (const [uiMapId, entry] of band.index.uiMaps) {
    if (options.tinted?.has(uiMapId) === true) continue;
    if (Math.min(2 ** zoom, 2 ** entry.topLevel) * entry.ydPerPx >= BASE_MAP_LABEL_SCALE) places.push(uiMapId);
  }
  return places.length === 0 ? NO_BASE_MAP_LABELS : { continents: false, zones: false, places: places.sort((a, b) => a - b) };
}

/**
 * Whether the presentation's fallback zone tint (map-presentation.md §12.4) may be drawn over this
 * base: never in the minimap style, whose own ground colours are the zone colour (§25.4); in the
 * painted style, and on per-image art or the relief (no tiles: `null`), where the art fails §12.3's
 * criteria. The tint is picture, never a signal.
 */
export const fallbackTintAllowed = (style: MapStyle | null): boolean => style !== 'minimap';

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
  /** The drawer category its points belong to (`MarkerDescriptor.category`); absent for none. */
  readonly category?: MapCategoryId;
}

/** A zone's faction overlay pattern (map-presentation.md §12.6; D-039 C): one per `FactionGroupMask` value and the sanctuary flag, never a hue. */
export type ZonePattern = 'alliance' | 'horde' | 'both' | 'none' | 'sanctuary';

/**
 * A zone's fill (map-presentation.md §5.3, §12.4, §12.6; step MP.10): the fallback tint (a picture
 * colour, only where the painted art fails the §12.3 criteria, never in the minimap style), or the
 * optional faction overlay's pattern (hatching and dots in `--frl-map-hatch`, off by default, with
 * its words in the hover). The rings are the zone's terrain rings (D-032), even-odd. Drawn at the
 * world and continent bands only (§5.2: the zone band's budget is 0).
 */
export interface ZoneFillDescriptor {
  readonly type: 'zone-fill';
  readonly id: string;
  readonly mapId: WorldMapId;
  readonly areaId: number;
  /** Closed rings, at least three points each, all on `mapId`. */
  readonly rings: readonly (readonly WorldPoint[])[];
  readonly fill: { readonly tint: string } | { readonly pattern: ZonePattern };
  /** The overlay's words ("Durotar: Horde territory …"); null for a tint, which says nothing. */
  readonly label: string | null;
  /** The zone (a faction fill's click jumps to it, as an empty click at continent zoom does); a fill of an area no UiMap frames is not interactive. */
  readonly ref: MapRef;
  /** A faction fill's short words for the zone's card ("Horde territory", §12.6; review PR-15); absent on a tint. */
  readonly words?: string;
  /**
   * The land a faction pattern is drawn on (map-presentation.md §12.6: "each zone's land"; review
   * PR-15, QA-15): the lines of its map's terrain coastline (land on their left), by reference. The
   * zone's rings run out over its coastal water; the adapter chains these lines into rings (land is
   * where their winding is not zero) and clips the pattern to those that meet the zone. Absent: not
   * clipped (the coastline not loaded).
   */
  readonly land?: readonly (readonly WorldPoint[])[];
}

export type MapDescriptor =
  | MarkerDescriptor
  | PolylineDescriptor
  | FrameDescriptor
  | ArtDescriptor
  | OutlineDescriptor
  | AggregateDescriptor
  | ConnectorDescriptor
  | TileBandDescriptor
  | LabelDescriptor
  | AreaDescriptor
  | ZoneFillDescriptor;

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

/** The world map a descriptor is drawn on (a connector's: the map it starts on); null for the atlas tiles, which are on no world map. */
export function descriptorMapId(descriptor: MapDescriptor): WorldMapId | null {
  switch (descriptor.type) {
    case 'marker':
    case 'aggregate':
    case 'label':
      return descriptor.point.mapId;
    case 'polyline':
    case 'outline':
    case 'area':
    case 'zone-fill':
      return descriptor.mapId;
    case 'frame':
    case 'art':
      return descriptor.bounds.mapId;
    case 'connector':
      return descriptor.from.mapId;
    case 'tiles':
      return null;
  }
}

/**
 * Whether a descriptor is drawn on a surface: its world map is placed there (map-atlas.md §8.1);
 * a connector needs both ends' maps placed, as maps (not insets), so it is never drawn on a world
 * surface; the atlas tiles only on an atlas whose placements they were composed in (the index's
 * hash equals the surface's, map-atlas.md §7.2, §8.6).
 */
export function descriptorOnSurface(descriptor: MapDescriptor, info: SurfaceInfo): boolean {
  if (descriptor.type === 'tiles') return isAtlasSurface(info) && info.hash === descriptor.index.hash;
  if (!isAtlasSurface(info)) return descriptor.type !== 'connector' && descriptorMapId(descriptor) === info.mapId;
  if (descriptor.type === 'connector') {
    return placementOn(info, descriptor.from.mapId)?.kind === 'placed' && placementOn(info, descriptor.to.mapId)?.kind === 'placed';
  }
  const mapId = descriptorMapId(descriptor);
  return mapId !== null && info.mapIds.includes(mapId);
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
 * steps, markers, lines) depends on the layer; `layerStatsNotes` in app/map-wording names the unit.
 */
export interface LayerStats {
  /** Descriptors in `items`. */
  readonly drawn: number;
  /** Descriptors that passed level of detail on this surface but fell beyond the path cap: "N more not drawn". */
  readonly notDrawn: number;
  /** Points folded into per-zone aggregate glyphs (continent zoom). */
  readonly aggregated: number;
  /**
   * Points folded into clusters below the zone band (map-presentation.md §25.2.5): every one is
   * counted in its cluster's "×n" and hover, so none is lost. Absent when the layer draws no cluster.
   */
  readonly clustered?: number;
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

/**
 * What part of the map a layer is built for: one world map. On the atlas, the view names the map
 * under its centre, and the controller builds each active map's layers with its own view (the
 * atlas view translated into that map's yards, map-atlas.md §8.2).
 */
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
  /** The surface the view is on; absent for `world:<mapId>` (map-atlas.md §8.1). */
  readonly surface?: SurfaceId;
  /**
   * The atlas only: the view rectangle in the yards of every placed map whose rectangle meets the
   * view padded by 50 %, in placement order (map-atlas.md §8.1): the maps whose layers are built.
   * Absent on a world surface.
   */
  readonly visible?: readonly WorldBounds[];
  /**
   * The zoom band this view's layers are built for (map-presentation.md §5.1): the controller's,
   * from the scale of the view's map's placement (`pxPerYardAt(zoom, placement.scale)`) with
   * hysteresis (`nextBand`), so the builders stay stateless. Absent: the plain band of `zoom` on a
   * placement of scale 1 (`bandAt(pxPerYardAt(zoom))`).
   */
  readonly band?: MapBand;
}

/** The band a view's layers are built for: its `band`, else the plain band of its zoom. */
export const viewBand = (view: Pick<MapView, 'zoom' | 'band'>): MapBand => view.band ?? bandAt(pxPerYardAt(view.zoom));

/** The world maps a view builds layers for: the atlas's active maps (the centre's map always among them), or the view's one map. */
export function viewMapIds(view: MapView): readonly WorldMapId[] {
  const visible = view.visible;
  if (visible === undefined) return [view.mapId];
  const ids = visible.map((bounds) => bounds.mapId);
  return ids.includes(view.mapId) ? ids : [...ids, view.mapId];
}

/** The view rectangle in `mapId`'s yards: its entry of `visible` on the atlas, or `bounds` when it is on that map; null otherwise. */
export function viewBoundsOn(view: MapView, mapId: WorldMapId): WorldBounds | null {
  const visible = view.visible?.find((bounds) => bounds.mapId === mapId);
  if (visible !== undefined) return visible;
  const bounds = view.bounds ?? null;
  return bounds !== null && bounds.mapId === mapId ? bounds : null;
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
  /** The group's quest-mark state after the active step (`MarkerDescriptor.mark`); absent without route state. */
  readonly mark?: MarkerMark;
  /**
   * Each of `questIds` with its own state (`MarkerQuest`), for the clusters' group rule and counts
   * (map-presentation.md §25.2.5) and the drawer's mask; absent: the quests carry the group's mark.
   */
  readonly quests?: readonly MarkerQuest[];
}

/** A spawn layer's input. Groups with the same subject are merged (quest ids united; the first group's label and spawns kept). */
export interface SpawnLayerInput {
  readonly groups: readonly PointGroupInput[];
}

/**
 * The objectives of the quests in the log other than the focused ones (map-presentation.md §7.4;
 * step MP.3), drawn at the zone and close bands: one counted mark per (quest, target, zone) at the
 * centroid of that target's points in the zone, and a faint outline round each group of a quest's
 * points in a zone (90 yd grid, 8-connected, 5 points or more; `src/geo` grid groups and hulls).
 * Built by the derived pipeline when the log or the state changes.
 */
export interface LogObjectivesInput {
  readonly counted: readonly CountedObjectiveInput[];
  readonly areas: readonly ObjectiveAreaInput[];
}

export interface CountedObjectiveInput {
  /** Stable: `count:<quest>:<subject>:<zone>`. */
  readonly id: string;
  readonly questId: QuestId;
  /** The centroid of the target's points in the zone, on one world map. */
  readonly point: WorldPoint;
  /** Its hover text: "Boar · kill for Cull · 12 spawns in Durotar". */
  readonly label: string;
  /** The first of the points it counts (a click opens its quest, as a raw point's does). */
  readonly ref: Extract<MapRef, { readonly kind: 'spawn' }>;
}

export interface ObjectiveAreaInput {
  /** Stable: `area:<quest>:<zone>:<n>`. */
  readonly id: string;
  readonly questId: QuestId;
  readonly mapId: WorldMapId;
  /** The convex hull, at least three points on `mapId`. */
  readonly ring: readonly WorldPoint[];
  /** The step that completes the quest's objectives, on its largest group only; null for none. */
  readonly labelStep: StepId | null;
  readonly labelTurnIn: boolean;
  readonly label: string;
  readonly uiMapId: UiMapId | null;
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

/**
 * What the map shows now. On the atlas, `mapId` and `center` name the world map and point under the
 * view centre (the partition, map-atlas.md §5.4), `bounds` is the view in that map's yards, and
 * `visible` has the view in the yards of every placed map that meets it (padded by 50 %).
 */
export interface MapViewState {
  readonly surface: SurfaceId;
  readonly mapId: WorldMapId;
  readonly center: WorldPoint;
  readonly zoom: number;
  /** The visible rectangle. */
  readonly bounds: WorldBounds;
  readonly widthPx: number;
  readonly heightPx: number;
  /** The atlas only (see `MapView.visible`); absent on a world surface. */
  readonly visible?: readonly WorldBounds[];
}

/** The layer view (`MapView`) of a view state; the atlas's also carries its surface and `visible`. */
export function mapViewOf(state: MapViewState): MapView {
  const view: MapView = { mapId: state.mapId, zoom: state.zoom, center: { x: state.center.x, y: state.center.y }, bounds: state.bounds };
  return state.visible === undefined ? view : { ...view, surface: state.surface, visible: state.visible };
}

/** A world point in stage pixels (x east from the left edge, y south from the top) of a view state, on any map the view shows; null for a degenerate view or a map it does not show. */
export function stagePixelOf(view: MapViewState, point: WorldPoint): { readonly x: number; readonly y: number } | null {
  const b = point.mapId === view.bounds.mapId ? view.bounds : (view.visible?.find((entry) => entry.mapId === point.mapId) ?? null);
  if (b === null || b.yMax <= b.yMin || b.xMax <= b.xMin) return null;
  // World y grows west and x north (coordinates.md §2): east is decreasing y, south decreasing x.
  return { x: ((b.yMax - point.y) / (b.yMax - b.yMin)) * view.widthPx, y: ((b.xMax - point.x) / (b.xMax - b.xMin)) * view.heightPx };
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
   * A click. `point` is always a world point of one real map (on the atlas, the map the partition
   * gives, map-atlas.md §5.4). `hit` is the topmost interactive item (every item of a merged marker is in
   * `hit.refs`), or null on empty map. `zones` lists the zone
   * frames of the zone-frames layer containing the point, smallest first (a city before its zone);
   * frames are map rectangles, so this is a display aid, not zone membership. Frames overlap
   * heavily, so the smallest is often the wrong zone to open: jump-to-zone uses the frame the
   * point is most central in (`geo` `zoneFramesContaining`, coordinates.md §15; M3 review MAP-UX-1).
   */
  | { readonly type: 'click'; readonly point: WorldPoint; readonly hit: MapHit | null; readonly zones: readonly UiMapId[] }
  /** The pointer entered an item (`hit`), or left the last one (`hit` null, `point` null). */
  | { readonly type: 'hover'; readonly point: WorldPoint | null; readonly hit: MapHit | null }
  /**
   * A pan or zoom began (Leaflet `movestart`): work that can wait for the view to settle waits, so no
   * long task lands in the gesture's frames (D-050 item 5). A `move` follows when it settles.
   */
  | { readonly type: 'movestart' }
  /** The view settled after a pan or zoom (Leaflet `moveend`). Rebuild view-dependent layers here. */
  | { readonly type: 'move'; readonly view: MapViewState }
  /** The zoom settled (Leaflet `zoomend`); a `move` follows. */
  | { readonly type: 'zoom'; readonly view: MapViewState }
  /** The surface changed: by `setSurface`, or because `focus`, `fitBounds` or `setViewport` targeted a world map the shown surface does not place. */
  | { readonly type: 'surface'; readonly surface: SurfaceId; readonly view: MapViewState }
  /**
   * A tile band's first view has settled (map-atlas.md §21.2, §21.4), once per band drawn: `ready`
   * when an image of it decoded (or the view needed none), `failed` when every image it asked for
   * failed (a clone or build without the minimap tile pack, §23.3): the controller then shows the
   * other style and says why.
   */
  | { readonly type: 'tiles'; readonly band: string; readonly style: MapStyle; readonly state: 'ready' | 'failed' };

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

/** What the labels canvas drew last (map-presentation.md §13.2, §13.6), for the layer notes, tests and the harness. */
export interface LabelRenderStats {
  /** The band the adapter drew in (`nextBand` of its own views), or null before the first draw. */
  readonly band: MapBand | null;
  /** Labels placed, and how many of them with a leader line. */
  readonly placed: number;
  readonly leaders: number;
  /** Labels in range and in view that found no room ("2 zone labels hidden for lack of room: …"), by text in priority order. */
  readonly skipped: readonly string[];
  /** Step numbers drawn, and those left out within 16 px of another or over the 150 in view. */
  readonly stepNumbers: number;
  readonly stepNumbersSkipped: number;
  /** Full draws of the labels canvas so far (a renumbering is one). */
  readonly draws: number;
}

export const EMPTY_LABEL_RENDER_STATS: LabelRenderStats = { band: null, placed: 0, leaders: 0, skipped: [], stepNumbers: 0, stepNumbersSkipped: 0, draws: 0 };

export interface MapRenderStats {
  readonly surface: SurfaceId | null;
  /** Canvas paths drawn on the current surface (images of the relief and art layers excluded; labels included, as they count against the cap). */
  readonly paths: number;
  readonly layers: Readonly<Record<LayerId, LayerRenderStats>>;
  /** The labels canvas. */
  readonly labels: LabelRenderStats;
  /**
   * The base style on screen (map-atlas.md §8.7 item 9, §21.2): the tile band's whose picture is
   * shown (the old one while it is held under a new one), else `MapAdapterOptions.style`. The
   * container carries it as `data-map-style` for the presentation's palette.
   */
  readonly style: MapStyle;
  /** The tile bands drawn: the current one, and the one held under it during a style switch; null for none. */
  readonly tiles: { readonly band: string | null; readonly held: string | null };
  /** The pins (map-presentation.md §25.2; step MP.4a); absent from an adapter that draws none. */
  readonly pins?: PinRenderStats;
}

/** What the pins drew last (`MapRenderStats.pins`), for tests, the layer notes and the harness. */
export interface PinRenderStats {
  /** Pins drawn now: singles, stack leaders and clusters (a hidden or merged-away pin is not drawn). */
  readonly drawn: number;
  /** Pins the mask hides, or drawn from a band they do not reach yet (places below 0.0325 px/yd, services below 0.149). */
  readonly hidden: number;
  /** Pins merged into a stack leader at the zone and close bands (spatial hash, §25.2.5). */
  readonly merged: number;
  /** Stack leaders drawn with "×n". */
  readonly stacks: number;
  /** Clusters drawn. */
  readonly clusters: number;
  /** The head's diameter at the current zoom (before the 0.8 of services and counted objectives). */
  readonly diameter: number;
  /** Bitmaps in the cache (at most 256). */
  readonly bitmaps: number;
}

/**
 * The map engine (ARCHITECTURE §7.1). One surface at a time; content is kept per layer, and only
 * descriptors on the current surface are drawn (`descriptorOnSurface`), so switching surfaces
 * redraws what each layer already holds for the new one. A command on a world point or rectangle
 * goes to the shown surface when it places that point's map, else to the first surface that does
 * (`surfaceForMap`).
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
  /** Replaces the step numbers given as `MapAdapterOptions.stepNumbers`; null for none (no numbers drawn). Optional, as above. */
  setStepNumbers?(provider: MapStepNumbers | null): void;
  /**
   * Shows or hides the yard grid (the drawer's Coordinate grid row; review PR-10). Shown by default;
   * it is drawn from the zone band only. Optional, as above.
   */
  setGrid?(shown: boolean): void;
  /**
   * Redraws the labels canvas alone (map-presentation.md §5.5, §13.6): after a route edit that may
   * have renumbered steps, the numbers are drawn again from the step numbers, at the latest on the
   * next animation frame, and nothing else is redrawn. Optional, as above.
   */
  refreshLabels?(): void;
  /**
   * The Map layers drawer's hidden categories and the map search's filter (map-presentation.md
   * §25.3.4, §25.3.5; step MP.4a): applied when drawing and hit-testing the pin layers, a redraw and
   * never a rebuild. Optional, as above.
   */
  setMask?(mask: MapMask): void;
  /**
   * Draws these pins selected (§25.2.3: 1.15× with a ring in the style's route colour on a halo),
   * as the active search result is; null clears. Optional, as above.
   */
  selectPins?(target: HighlightTarget | null): void;
  /** Zooms in (positive) or out by `delta` levels about the view's centre: the map's floating zoom buttons (§25.3.0). Optional, as above. */
  zoomBy?(delta: number): void;
  /**
   * The settled view's band, as the controller keeps it (map-presentation.md §5.1; review MR-03):
   * the pins' stacking, the cluster split and the step numbers follow it, so the adapter never
   * keeps a band of its own that disagrees with the one the layers were built for. Given after each
   * settled view's `move` or `surface` event. Optional, as above.
   */
  setBand?(band: MapBand): void;
  renderStats(): MapRenderStats;
}

/**
 * Step numbers for the labels canvas (map-presentation.md §5.3, §13.6), asked when it is drawn: the
 * route descriptors carry no numbers, so an insert above a step changes none of them, and a
 * renumbering redraws the labels canvas only (`MapAdapter.refreshLabels`).
 */
export interface MapStepNumbers {
  /** The step's number (its 1-based position in the route), or null for a step not in the route. */
  stepNumber(stepId: StepId): number | null;
  /** The active step, whose number is drawn first (then the selected steps, then route order); null for none. */
  activeStep(): StepId | null;
}

export interface MapAdapterOptions {
  /** The surfaces the map may show (`surfacesOf(geometry)` in map/layers). */
  readonly surfaces: readonly SurfaceInfo[];
  /** The first surface; null for the first of `surfaces`. */
  readonly initialSurface: SurfaceId | null;
  /** Hover text for route items (numbered steps), asked each time a label is shown (`labelOf`). Default: none. */
  readonly label?: MapLabelProvider | null;
  /** Step numbers beside the beads on the labels canvas, at the zone and close bands (map-presentation.md §13.6). Default: none. */
  readonly stepNumbers?: MapStepNumbers | null;
  /**
   * The gesture work of docs/research/map-atlas.md §8.4 (step ATL.8): the smooth wheel handler in
   * place of Leaflet's, any resting zoom (`zoomSnap` 0), the grid hidden and hover labels held back
   * during a gesture, a mid-gesture canvas refresh, the canvas at the real pixel ratio and markers
   * created in chunks. Default false for the adapter on its own; the map controller turns it on
   * (step ATL.10), and passes false only when asked to (`MapControllerOptions.smoothWheel`).
   */
  readonly smoothWheel?: boolean;
  /**
   * The base style the map opens in (map-atlas.md §8.7 item 9, §21.3: the per-browser choice), for
   * `data-map-style` and `renderStats().style` until a tile band is drawn; a band's own style then
   * takes over. Default `DEFAULT_MAP_STYLE`.
   */
  readonly style?: MapStyle;
}

/** How `ui` receives the Leaflet implementation from the composition root without importing map/leaflet. */
export type MapAdapterFactory = (options: MapAdapterOptions) => MapAdapter;
