import type { WorldPoint } from '../domain/points';

/**
 * Straight-line distance in yards between two world points (ARCHITECTURE §6, §9.3).
 *
 * Null across world maps: a move between maps needs a transport, a hearth or an instance
 * entrance edge, never a distance. Computed with a plain `Math.sqrt` of the squared sums
 * (correctly rounded in every engine), not `Math.hypot`, whose results may differ between engines
 * (ARCHITECTURE §11.4).
 */
export function distanceYards(a: WorldPoint, b: WorldPoint): number | null {
  if (a.mapId !== b.mapId) return null;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
