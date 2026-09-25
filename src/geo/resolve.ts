import type { UiMapId } from '../domain/ids';
import type { Location, SourcedPoint, WorldPoint } from '../domain/points';
import { eraToForever } from './era';
import { assignmentForPercent, assignmentPercentToWorld } from './transforms';
import type { MapGeometry } from './types';

/**
 * Runtime resolution of authored points (ARCHITECTURE §6, D-017; coordinates.md §15).
 *
 * A `Location` stores the point as authored. Its world position is derived here, per geometry,
 * and never persisted, so a project does not depend on which geometry a machine has. A null or
 * `unresolved` result means unknown travel plus an info issue; it is never zero distance.
 */

/** Why a point has no world position under this geometry. */
export type UnresolvedReason =
  /** The geometry has no row for the point's UiMap (for example a new zone before geometry exists). */
  | 'no-geometry'
  /** The UiMap has only partial sub-rectangles (Azeroth 947) and the point lies on none of them. */
  | 'outside-ui-rectangles'
  /** An Era-frame point on a changed UiMap, but the geometry carries no Era → Forever coefficients for it. */
  | 'no-era-coefficients'
  /** A coordinate is NaN or infinite. */
  | 'non-finite';

export type Resolution =
  | { readonly kind: 'resolved'; readonly point: WorldPoint }
  | { readonly kind: 'unresolved'; readonly reason: UnresolvedReason; readonly uiMapId: UiMapId | null };

const unresolved = (reason: UnresolvedReason, uiMapId: UiMapId | null): Resolution => ({ kind: 'unresolved', reason, uiMapId });

/**
 * Resolves one authored point, with the reason when it cannot be placed.
 *
 * - `space: 'world'` passes through unchanged (a new `{ mapId, x, y }`). The `uiMapId` hint is not
 *   used for resolution; it matters only for display and RXP export.
 * - `space: 'zone'` needs a row for its UiMap. `frame: 'era'` is first converted with the
 *   geometry's `eraToForever` block (identity outside 1412, 1423, 1433 and 1453).
 */
export function resolvePointDetailed(point: SourcedPoint, geometry: MapGeometry): Resolution {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return unresolved('non-finite', point.uiMapId);
  }
  if (point.space === 'world') return { kind: 'resolved', point: { mapId: point.mapId, x: point.x, y: point.y } };
  const forever = point.frame === 'era' ? eraToForever(point.uiMapId, point.x, point.y, geometry) : { x: point.x, y: point.y };
  if (forever === null) return unresolved('no-era-coefficients', point.uiMapId);
  if (!geometry.maps.has(point.uiMapId)) return unresolved('no-geometry', point.uiMapId);
  const row = assignmentForPercent(geometry, point.uiMapId, forever.x, forever.y);
  if (row === null) return unresolved('outside-ui-rectangles', point.uiMapId);
  return { kind: 'resolved', point: assignmentPercentToWorld(row, forever.x, forever.y) };
}

/** `resolvePointDetailed` without the reason. */
export function resolvePoint(point: SourcedPoint, geometry: MapGeometry): WorldPoint | null {
  const result = resolvePointDetailed(point, geometry);
  return result.kind === 'resolved' ? result.point : null;
}

const sourceOf = (input: Location | SourcedPoint): SourcedPoint => ('space' in input ? input : input.source);

/** Resolves a `Location` (its authored `source`) or a bare `SourcedPoint`, with the reason on failure. */
export function resolveDetailed(input: Location | SourcedPoint, geometry: MapGeometry): Resolution {
  return resolvePointDetailed(sourceOf(input), geometry);
}

/** `resolve(location, geometry) → WorldPoint | null` (ARCHITECTURE §6). */
export function resolve(input: Location | SourcedPoint, geometry: MapGeometry): WorldPoint | null {
  return resolvePoint(sourceOf(input), geometry);
}
