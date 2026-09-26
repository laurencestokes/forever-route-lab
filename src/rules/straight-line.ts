import { estimate, unknownEstimate } from '../domain/estimate';
import type { TravelEndpoint, TravelLeg, TravelModel, TravelSpeeds } from '../domain/travel';
import { planarYards } from './travel-graph';

/**
 * The straight-line travel model (docs/ARCHITECTURE.md §9.1, D-028, D-037): distance ×
 * `travelDetourFactor` / ground speed, basis `assumption`, method `straight-line`, never pending,
 * no warnings and no path to draw. Clean deploys, tests and maps without navigation data use it,
 * and the navigation model uses `straightLineLeg` as its labelled fallback.
 *
 * The seconds carry the detour factor's basis only; the caller combines them with the provenance
 * of the speeds it passed (src/sim `groundTravel`).
 */

function assertSpeeds(speeds: TravelSpeeds): void {
  if (!Number.isFinite(speeds.groundYps) || speeds.groundYps <= 0) {
    throw new RangeError(`Invalid ground speed ${String(speeds.groundYps)}: expected a finite number > 0`);
  }
}

function assertDetour(detourFactor: number): void {
  if (!Number.isFinite(detourFactor) || detourFactor <= 0) {
    throw new RangeError(`Invalid travel detour factor ${String(detourFactor)}: expected a finite number > 0`);
  }
}

/**
 * The straight-line leg between two endpoints. On one world map its seconds are
 * `distance × detourFactor / groundYps` (Math.sqrt, never hypot); across world maps there is no
 * leg, so the seconds are unknown (the caller routes through the TravelGraph).
 */
export function straightLineLeg(from: TravelEndpoint, to: TravelEndpoint, speeds: TravelSpeeds, detourFactor: number): TravelLeg {
  assertSpeeds(speeds);
  assertDetour(detourFactor);
  const yards = planarYards(from.point, to.point);
  if (yards === null) return { seconds: unknownEstimate(), method: 'straight-line', pending: false, warnings: [] };
  return { seconds: estimate((yards * detourFactor) / speeds.groundYps, 'assumption'), method: 'straight-line', pending: false, warnings: [] };
}

/**
 * A `TravelModel` for the effective `travelDetourFactor` (SIMULATION §1.2 `groundDetourFactor`).
 * Its revision is always `'straight-line'` (src/domain/travel.ts), so a cache keyed on the revision
 * alone must also key on the detour factor.
 */
export function createStraightLineTravelModel(detourFactor: number): TravelModel {
  assertDetour(detourFactor);
  return {
    id: 'straight-line',
    revision: 'straight-line',
    leg: (from, to, speeds) => straightLineLeg(from, to, speeds, detourFactor),
    path: () => null,
  };
}
