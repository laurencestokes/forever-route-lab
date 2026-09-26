import type { SpawnPoint } from '../domain/dataset';
import type { UiMapId } from '../domain/ids';
import type { SourcedPoint, WorldPoint } from '../domain/points';
import type { TravelEndpoint } from '../domain/travel';
import type { MapGeometry } from '../geo/types';
import { rowContainsWorldPoint } from '../geo/zones';
import { spawnHint, type NavManifest } from '../nav/manifest';

/**
 * Zone hints for navigation endpoints (terrain-navigation.md §8.1 rule A): the top-level zone
 * AreaTable id that picks an endpoint's floor in a multi-level place, 0 for none.
 *
 * - **A route point:** the zone of its UiMap row, the `UiMapAssignment` row of the UiMap it was
 *   authored on (a zone point's UiMap, or the UiMap an RXP world point names) on the point's world
 *   map, preferring the row that contains the point. Continent and world rows name no zone (AreaID
 *   0), so they give 0, as does a point without a UiMap. Zone frames are never guessed by
 *   containment here (coordinates.md §5: that heuristic is for display only).
 * - **A dataset spawn:** `spawnHint()`, its QuestieDB area key rolled up through the manifest's
 *   ParentAreaID roll-up, when the caller has the area key (as the build's census does); otherwise
 *   the zone of the UiMap row it was published on, which is the same zone for every link the
 *   dataset uses (`direct` keys name the UiMap's own zone; `routed` subzones roll up to it).
 *
 * Both roll the AreaTable id up with the manifest's per-map roll-up (empty in the committed build:
 * every dataset key is already top-level). Unknown gives 0.
 */

/** `areaId` rolled up to its top-level zone with the manifest's roll-up for `mapId` (unchanged without one). */
export function rolledUpZone(nav: NavManifest | null, mapId: number, areaId: number): number {
  if (!Number.isSafeInteger(areaId) || areaId <= 0) return 0;
  const entry = nav?.maps.find((m) => m.mapId === mapId);
  return entry === undefined ? areaId : spawnHint(entry, areaId);
}

/** The zone of `uiMapId`'s row on `point`'s world map (the containing row first), rolled up; 0 when unknown. */
export function uiMapZoneHint(geometry: MapGeometry, uiMapId: UiMapId | null, point: WorldPoint, nav: NavManifest | null): number {
  if (uiMapId === null) return 0;
  const rows = geometry.maps.get(uiMapId)?.assignments.filter((row) => row.mapId === point.mapId) ?? [];
  const row = rows.find((r) => rowContainsWorldPoint(r, point)) ?? rows[0];
  return row === undefined ? 0 : rolledUpZone(nav, point.mapId, row.areaId);
}

/** A route point's endpoint: its world point and the zone of the UiMap it was authored on. */
export function routePointEndpoint(source: SourcedPoint, world: WorldPoint, geometry: MapGeometry, nav: NavManifest | null): TravelEndpoint {
  return { point: world, zoneHint: uiMapZoneHint(geometry, source.uiMapId, world, nav) };
}

/**
 * A dataset spawn's endpoint, or null when it has no world point. `areaKey` is the spawn's
 * QuestieDB AreaTable key when the caller knows it (then `spawnHint()` decides, as in the census).
 */
export function spawnEndpoint(spawn: Pick<SpawnPoint, 'world' | 'uiMapId'>, geometry: MapGeometry, nav: NavManifest | null, areaKey: number | null = null): TravelEndpoint | null {
  const world = spawn.world;
  if (world === null) return null;
  const hint = areaKey !== null ? rolledUpZone(nav, world.mapId, areaKey) : uiMapZoneHint(geometry, spawn.uiMapId, world, nav);
  return { point: world, zoneHint: hint };
}
