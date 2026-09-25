import type { UiMapId, WorldMapId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';
import type { GeometryAssignment, MapGeometry } from './types';

/**
 * Zone attribution and world-map lookup (docs/research/coordinates.md §5, §13).
 *
 * Zone frames are map rectangles with margins, not zone borders: they overlap (Durotar and The
 * Barrens share a strip), and cities sit inside their parent zone's frame. Which zone a point
 * really belongs to comes from AreaTable and terrain, which the geometry does not have. So the
 * authored or published UiMap (the hint) always wins when its frame contains the point, and
 * rectangle containment is only a labelled display fallback (`attributeZone`).
 */

/** How a zone was chosen: the caller's UiMap, or the containing zone frame the point is most central in. */
export type ZoneAttributionBasis = 'hint' | 'containment';

export interface ZoneAttribution {
  readonly uiMapId: UiMapId;
  readonly basis: ZoneAttributionBasis;
}

/** True when `point` is on the row's world map and inside its world rectangle, edges included. */
export function rowContainsWorldPoint(row: GeometryAssignment, point: WorldPoint): boolean {
  return row.mapId === point.mapId && point.x >= row.xMin && point.x <= row.xMax && point.y >= row.yMin && point.y <= row.yMax;
}

/**
 * How deep inside a row's world rectangle `point` lies: `min(fu, 1 − fu, fv, 1 − fv)` with
 * `fu = (yMax − y)/(yMax − yMin)` and `fv = (xMax − x)/(xMax − xMin)` (coordinates.md §4). 0.5 at
 * the centre, 0 on an edge, negative outside. Ignores the world map; callers check containment.
 */
export function frameCentrality(row: GeometryAssignment, point: WorldPoint): number {
  const fu = (row.yMax - point.y) / (row.yMax - row.yMin);
  const fv = (row.xMax - point.x) / (row.xMax - row.xMin);
  return Math.min(fu, 1 - fu, fv, 1 - fv);
}

const areaOf = (row: GeometryAssignment): number => (row.xMax - row.xMin) * (row.yMax - row.yMin);

/**
 * Every zone frame containing `point`, in attribution order: the frame the point is most central
 * in first (`frameCentrality`), ties by the smaller frame (a city before its zone), then by
 * ascending UiMapId. A zone frame is a row with an AreaTable zone (`areaId > 0`); continent, world
 * and alternative-continent rows (AreaID 0) are never zones.
 */
export function zoneFramesContaining(point: WorldPoint, geometry: MapGeometry): readonly UiMapId[] {
  const hits: { readonly uiMapId: UiMapId; readonly centrality: number; readonly area: number }[] = [];
  for (const map of geometry.maps.values()) {
    const row = map.assignments.find((candidate) => candidate.areaId > 0 && rowContainsWorldPoint(candidate, point));
    if (row !== undefined) hits.push({ uiMapId: map.uiMapId, centrality: frameCentrality(row, point), area: areaOf(row) });
  }
  return hits.sort((a, b) => b.centrality - a.centrality || a.area - b.area || a.uiMapId - b.uiMapId).map((hit) => hit.uiMapId);
}

/**
 * The zone to show a world point under.
 *
 * - `hint` (the UiMap a point was authored or published on) wins when the geometry has it and one
 *   of its rows on the point's world map contains the point (basis `hint`). A continent hint is
 *   accepted the same way.
 * - Otherwise the first of `zoneFramesContaining`: the containing zone frame the point is most
 *   central in (basis `containment`). This is a display heuristic. Measured on the 76,294 shipped
 *   zone spawns with their published UiMap as truth, it agrees 87.6% of the time (NPCs 87.2%,
 *   objects 88.6%); the smallest containing frame agreed 73.3%. It still misses: Gornek (Durotar
 *   42.06, 68.33, Valley of Trials) is more central in The Barrens' frame. So grouping and anything
 *   stored use the hint, never this fallback (coordinates.md §5, §15).
 * - Null when no zone frame contains the point: the zone is unknown and is not guessed.
 */
export function attributeZone(point: WorldPoint, hint: UiMapId | null, geometry: MapGeometry): ZoneAttribution | null {
  if (hint !== null) {
    const map = geometry.maps.get(hint);
    if (map !== undefined && map.assignments.some((row) => rowContainsWorldPoint(row, point))) return { uiMapId: hint, basis: 'hint' };
  }
  const [best] = zoneFramesContaining(point, geometry);
  return best === undefined ? null : { uiMapId: best, basis: 'containment' };
}

/**
 * The world map a UiMap shows: the `mapId` shared by all its rows. Null when the geometry lacks
 * the UiMap or its rows span several world maps (Azeroth 947 shows both 0 and 1).
 */
export function worldMapIdOf(id: UiMapId, geometry: MapGeometry): WorldMapId | null {
  const rows = geometry.maps.get(id)?.assignments ?? [];
  const [first] = rows;
  if (first === undefined) return null;
  return rows.every((row) => row.mapId === first.mapId) ? first.mapId : null;
}

/** Every world map that has at least one row, ascending (0, 1, 30, 489, 529, 2991, 2997 in the placeholder). */
export function worldMapIds(geometry: MapGeometry): readonly WorldMapId[] {
  const ids = new Set<WorldMapId>();
  for (const map of geometry.maps.values()) for (const row of map.assignments) ids.add(row.mapId);
  return [...ids].sort((a, b) => a - b);
}
