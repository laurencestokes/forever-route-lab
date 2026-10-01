import type { Estimated } from '../domain/estimate';
import type { WorldMapId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';
import type { TravelEndpoint } from '../domain/travel';
import { type EntranceEdge, entrancesOf, isInstanceMap, nearestEntrance, type TravelGraph } from '../rules/travel-graph';
import type { TimePart } from '../sim/estimate';
import type { UnknownPositionCause } from '../sim/facts';
import { type GroundTravel, groundTravel, type StepSpeeds } from '../sim/travel';
import type { StepWork, WalkEnv } from './env';
import type { WalkMemo } from './state';
import type { CharacterState, LegPurpose } from './types';

/**
 * Moving the character (docs/SIMULATION.md TIME-2, TIME-7): ground legs on one world map through
 * the travel model, the zero-wait instance entrance edges between an outdoor map and an instance,
 * and SIM-4 for any other move between world maps. An unknown start or destination makes the move
 * unknown, never zero (TIME-13); the position then follows the destination.
 */

const UNKNOWN_SECONDS: Estimated<number> = { value: null, basis: 'unknown', eraFallback: false };

/** Entering or leaving an instance: 0 s, and 0 s inside it to the step (ASSUMPTION, TIME-7). */
const ENTRANCE_PART: TimePart = { bucket: 'travel', seconds: { value: 0, basis: 'assumption', eraFallback: false } };

export function unknownTravel(work: StepWork): void {
  work.parts.push({ bucket: 'travel', seconds: UNKNOWN_SECONDS });
}

/** The current position as a travel endpoint, or null when unknown. */
export function here(state: CharacterState): TravelEndpoint | null {
  return state.location === null ? null : { point: state.location, zoneHint: state.locationHint };
}

/**
 * Sets the position; `cause` says why when `place` is null (the `position-unknown` fact of the next
 * move). The remembered entrance is kept only while the character stays on that entrance's
 * instance map.
 */
export function setLocation(state: CharacterState, memo: WalkMemo, place: TravelEndpoint | null, cause: UnknownPositionCause): void {
  state.location = place?.point ?? null;
  state.locationHint = place?.zoneHint ?? 0;
  state.locationCause = place === null ? cause : null;
  if (memo.entrance !== null && (place === null || place.point.mapId !== memo.entrance.instanceMapId)) memo.entrance = null;
}

/**
 * TIME-2: the step moves from an unknown position, so its travel is unknown. Records, once per
 * step, why the position is unknown (`position-unknown`, not an issue).
 */
export function reportUnknownPosition(state: CharacterState, work: StepWork): void {
  if (work.positionReported || state.location !== null) return;
  work.positionReported = true;
  work.facts.push({ kind: 'position-unknown', cause: state.locationCause ?? 'unresolved' });
}

/** Adds a priced ground move to the step: its time part, rule keys and facts, and the leg when one was walked. */
export function commitGround(work: StepWork, move: GroundTravel, from: TravelEndpoint, to: TravelEndpoint, purpose: LegPurpose): void {
  work.parts.push({ bucket: 'travel', seconds: move.seconds });
  if (move.used.length > 0) work.used.push(move.used);
  for (const fact of move.facts) work.facts.push(fact);
  if (move.outcome === 'leg' && move.method !== null) {
    work.legs.push({ from, to, purpose, seconds: move.seconds, method: move.method, pending: move.pending, warnings: move.warnings });
  }
}

/**
 * A ground move priced by the travel model (TIME-2). A walk to or from a client berth ends at the
 * dock's boarding point on walkable ground (`Places.dock`, TIME-7), so it needs no rule of its own.
 */
export function groundMove(env: WalkEnv, from: TravelEndpoint | null, to: TravelEndpoint | null, radius: number | null, speeds: StepSpeeds): GroundTravel {
  return groundTravel(from, to, radius, speeds, env.model, env.rules);
}

/** One ground leg on one world map (TIME-2), `radius` yards short of `to`. */
export function groundLeg(
  env: WalkEnv,
  work: StepWork,
  from: TravelEndpoint,
  to: TravelEndpoint,
  radius: number | null,
  speeds: StepSpeeds,
  purpose: LegPurpose,
): void {
  commitGround(work, groundMove(env, from, to, radius, speeds), from, to, purpose);
}

/**
 * The entrance to leave instance `instance` by, towards `target` (TIME-7): the entrance used to
 * enter when it is on the target's map, else the entrance nearest the target on its map; towards
 * another instance, an entrance on a map where that instance has an entrance too.
 */
function exitFor(graph: TravelGraph, remembered: EntranceEdge | null, instance: WorldMapId, target: WorldPoint): EntranceEdge | null {
  const known = remembered !== null && remembered.instanceMapId === instance ? remembered : null;
  if (known !== null && known.outdoor.mapId === target.mapId) return known;
  const direct = nearestEntrance(graph, instance, target);
  if (direct !== null) return direct;
  if (!isInstanceMap(graph, target.mapId)) return null;
  const onward = new Set(entrancesOf(graph, target.mapId).map((edge) => edge.outdoor.mapId));
  if (known !== null && onward.has(known.outdoor.mapId)) return known;
  return entrancesOf(graph, instance).find((edge) => onward.has(edge.outdoor.mapId)) ?? null;
}

/**
 * TIME-2 and TIME-7: moves the character to `target`.
 *
 * - `target` null (unresolved): unknown; the position becomes unknown. The caller reports SIM-3.
 * - From an unknown position: unknown, without an issue (`position-unknown` says why); the
 *   position becomes `target`.
 * - Same world map: one ground leg, `radius` yards short.
 * - Between an outdoor map and an instance whose entrance is on it (either way, or instance to
 *   instance through one outdoor map): the walks to and from the entrances, and 0 s through them.
 * - Any other move between world maps: unknown with SIM-4.
 */
export function walkTo(
  env: WalkEnv,
  state: CharacterState,
  memo: WalkMemo,
  work: StepWork,
  target: TravelEndpoint | null,
  radius: number | null,
  speeds: StepSpeeds,
  purpose: LegPurpose,
): void {
  const from = here(state);
  if (target === null || from === null) {
    if (target !== null) reportUnknownPosition(state, work);
    unknownTravel(work);
    setLocation(state, memo, target, 'unresolved');
    return;
  }
  if (from.point.mapId === target.point.mapId) {
    groundLeg(env, work, from, target, radius, speeds, purpose);
    setLocation(state, memo, target, 'unresolved');
    return;
  }
  const graph = env.graph;
  let at = from;
  if (isInstanceMap(graph, at.point.mapId)) {
    const exit = exitFor(graph, memo.entrance, at.point.mapId, target.point);
    if (exit !== null) {
      work.parts.push(ENTRANCE_PART);
      at = env.places.world(exit.outdoor);
    }
  }
  if (at.point.mapId === target.point.mapId) {
    groundLeg(env, work, at, target, radius, speeds, purpose);
    setLocation(state, memo, target, 'unresolved');
    return;
  }
  if (isInstanceMap(graph, target.point.mapId)) {
    const entry = nearestEntrance(graph, target.point.mapId, at.point);
    if (entry !== null) {
      groundLeg(env, work, at, env.places.world(entry.outdoor), null, speeds, 'entrance');
      work.parts.push(ENTRANCE_PART);
      setLocation(state, memo, target, 'unresolved');
      memo.entrance = entry;
      return;
    }
  }
  work.facts.push({ kind: 'cross-world-no-transport', fromMapId: from.point.mapId, toMapId: target.point.mapId });
  unknownTravel(work);
  setLocation(state, memo, target, 'unresolved');
}
