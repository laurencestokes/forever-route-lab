import { uiMapId, type UiMapId } from '../domain/ids';
import type { MapGeometry, PercentPair } from './types';

/**
 * Era → Forever percent conversion (docs/research/coordinates.md §8, §10.2, §11.1).
 *
 * Only four zone frames changed between Era 1.15.9.69722 and Forever 1.60.1.69893: Mulgore 1412,
 * Eastern Plaguelands 1423, Redridge Mountains 1433 and Stormwind City 1453 (`conversion.json`
 * `geometry.transforms[].changed`). Everywhere else Era percent equals Forever percent. The
 * coefficients come from the geometry's `eraToForever` block (copied from `conversion.json`),
 * never from constants in code.
 *
 * QuestieDB Forever data is already in the Forever frame and must never be converted again; this
 * applies only to points explicitly authored in the Era frame (ARCHITECTURE §6, §10).
 */

/** The UiMaps whose frame differs between Era and Forever (ARCHITECTURE §6). */
export const ERA_CHANGED_UIMAP_IDS: readonly UiMapId[] = [uiMapId(1412), uiMapId(1423), uiMapId(1433), uiMapId(1453)];

/**
 * Converts an Era-frame percent point on `id` to the Forever frame. Identity on UiMaps whose
 * frame did not change. Null when `id` is one of the changed UiMaps but the geometry carries no
 * coefficients for it: the conversion is then unknown, and guessing identity would misplace the
 * point by about 100 yards (coordinates.md §9).
 */
export function eraToForever(id: UiMapId, x: number, y: number, geometry: MapGeometry): PercentPair | null {
  const coefficients = geometry.eraToForever.get(id);
  if (coefficients !== undefined) {
    return { x: coefficients.scaleX * x + coefficients.offsetX, y: coefficients.scaleY * y + coefficients.offsetY };
  }
  return ERA_CHANGED_UIMAP_IDS.includes(id) ? null : { x, y };
}
