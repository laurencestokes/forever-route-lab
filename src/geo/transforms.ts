import type { UiMapId, WorldMapId } from '../domain/ids';
import type { MapPoint, WorldPoint } from '../domain/points';
import type { GeometryAssignment, MapGeometry, PercentPair } from './types';

/**
 * Zone percent ⇄ world yards (docs/research/coordinates.md §4; docs/MAPS.md §6).
 *
 * Percent `(x, y)` is Questie/RXP's 0-100 form of Blizzard's normalised `(u, v)`: `x` runs west →
 * east, `y` runs north → south. World `x` is north and `y` is west. With `W = yMax − yMin` and
 * `H = xMax − xMin`:
 *
 *   u = uiMin_u + (yMax − Y)/W · (uiMax_u − uiMin_u)        Y = yMax − (u − uiMin_u)/(uiMax_u − uiMin_u) · W
 *   v = uiMin_v + (xMax − X)/H · (uiMax_v − uiMin_v)        X = xMax − (v − uiMin_v)/(uiMax_v − uiMin_v) · H
 *
 * which for every zone row (`uiMin = (0,0)`, `uiMax = (1,1)`) reduces to
 * `x% = 100·(yMax − Y)/W` and `y% = 100·(xMax − X)/H`. Percent values outside 0..100 are legal
 * ("outside this frame") and are never clamped.
 */

/** Percent on the row's UiMap → world point on the row's world map. Exact inverse of `assignmentWorldToPercent`. */
export function assignmentPercentToWorld(row: GeometryAssignment, x: number, y: number): WorldPoint {
  const fu = (x / 100 - row.uiMin[0]) / (row.uiMax[0] - row.uiMin[0]);
  const fv = (y / 100 - row.uiMin[1]) / (row.uiMax[1] - row.uiMin[1]);
  return { mapId: row.mapId, x: row.xMax - fv * (row.xMax - row.xMin), y: row.yMax - fu * (row.yMax - row.yMin) };
}

/** World yards → percent on the row's UiMap. Does not check the world map; callers match `mapId` first. */
export function assignmentWorldToPercent(row: GeometryAssignment, worldX: number, worldY: number): PercentPair {
  const fu = (row.yMax - worldY) / (row.yMax - row.yMin);
  const fv = (row.xMax - worldX) / (row.xMax - row.xMin);
  return {
    x: 100 * (row.uiMin[0] + fu * (row.uiMax[0] - row.uiMin[0])),
    y: 100 * (row.uiMin[1] + fv * (row.uiMax[1] - row.uiMin[1])),
  };
}

/** True when the row's UI rectangle is the whole map, `(0,0)-(1,1)`: every zone frame. */
export function isFullUiRectangle(row: GeometryAssignment): boolean {
  return row.uiMin[0] === 0 && row.uiMin[1] === 0 && row.uiMax[0] === 1 && row.uiMax[1] === 1;
}

/** True when percent `(x, y)` lies inside the row's UI sub-rectangle, edges included. */
export function uiRectangleContains(row: GeometryAssignment, x: number, y: number): boolean {
  const u = x / 100;
  const v = y / 100;
  return u >= row.uiMin[0] && u <= row.uiMax[0] && v >= row.uiMin[1] && v <= row.uiMax[1];
}

/**
 * The row a percent point on `uiMapId` belongs to, or null.
 *
 * - A UiMap with a single full-rectangle row (every zone, continent and new map) always uses it,
 *   so points outside 0..100 extrapolate in that frame.
 * - Otherwise (Azeroth 947's two sub-rectangles) the point must lie inside a row's UI
 *   sub-rectangle; the lowest OrderIndex wins if several contain it. A point in no sub-rectangle
 *   (open ocean on the world map) has no world position (coordinates.md §4).
 */
export function assignmentForPercent(geometry: MapGeometry, uiMapId: UiMapId, x: number, y: number): GeometryAssignment | null {
  const map = geometry.maps.get(uiMapId);
  if (map === undefined) return null;
  const [only] = map.assignments;
  if (map.assignments.length === 1 && only !== undefined && isFullUiRectangle(only)) return only;
  return map.assignments.find((row) => uiRectangleContains(row, x, y)) ?? null;
}

/**
 * The row that places world map `mapId` on `uiMapId`: the lowest OrderIndex row with that world
 * map, or null when the UiMap shows no part of it (or is missing from the geometry).
 */
export function assignmentForWorld(geometry: MapGeometry, uiMapId: UiMapId, mapId: WorldMapId): GeometryAssignment | null {
  return geometry.maps.get(uiMapId)?.assignments.find((row) => row.mapId === mapId) ?? null;
}

/** Zone percent → world yards; null when the geometry lacks the UiMap or the point is on no sub-rectangle. */
export function mapToWorld(point: MapPoint, geometry: MapGeometry): WorldPoint | null {
  const row = assignmentForPercent(geometry, point.uiMapId, point.x, point.y);
  return row === null ? null : assignmentPercentToWorld(row, point.x, point.y);
}

/**
 * World yards → percent on `uiMapId`; null when that UiMap shows no part of the point's world map.
 * The result may lie outside 0..100 (the point is outside that frame).
 */
export function worldToMap(point: WorldPoint, uiMapId: UiMapId, geometry: MapGeometry): MapPoint | null {
  const row = assignmentForWorld(geometry, uiMapId, point.mapId);
  if (row === null) return null;
  const percent = assignmentWorldToPercent(row, point.x, point.y);
  return { uiMapId, x: percent.x, y: percent.y };
}
