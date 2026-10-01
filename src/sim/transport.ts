import type { Faction } from '../domain/character';
import { type EffectiveRules, markedKeys } from '../rules/precedence';
import type { RuleKey } from '../rules/ruleset';
import type { TransportEdge } from '../rules/travel-graph';
import type { TimePart } from './estimate';
import type { SimFact } from './facts';
import { ASSUMPTION, combine, mergeKeys, ruleInput, withBasis } from './provenance';
import type { GroundTravel } from './travel';

/**
 * Transports (docs/SIMULATION.md TIME-7): `seconds = ground(state → dock) + waitS + rideS`, plus
 * the steps between a client berth and its boarding point (`boardingSteps`, D-052 item 1). The
 * walker picks the edge (by `TransportRef.id`, or the quickest from the current map to the
 * destination's, ties by id), prices the walk to the dock with `groundTravel`, and after arriving
 * walks on to the step's location if it has one on the arrival map. Transports do not use the taxi
 * model.
 */

export interface TransportCrossing {
  /** `travel` (walk to the dock), `waiting` (wait), `travel` (ride), in that order. */
  readonly parts: readonly TimePart[];
  readonly used: readonly RuleKey[];
  readonly facts: readonly SimFact[];
}

/**
 * One crossing. With an edge its wait and ride come from the record (the assumed defaults, with
 * their provenance); without one (a user-entered dock and no record) the defaults apply directly.
 * A record whose known factions exclude the character records `transport-faction`; unknown
 * factions record nothing.
 */
export function transportCrossing(walk: GroundTravel, edge: TransportEdge | null, faction: Faction, rules: EffectiveRules): TransportCrossing {
  const wait = edge?.waitS ?? rules.values.transportWaitSeconds;
  const ride = edge?.rideS ?? rules.values.transportRideSeconds;
  const facts: SimFact[] = [...walk.facts];
  if (edge !== null && edge.factions !== null && !edge.factions.includes(faction)) {
    facts.push({ kind: 'transport-faction', transportId: edge.transportId });
  }
  return {
    parts: [
      { bucket: 'travel', seconds: walk.seconds },
      { bucket: 'waiting', seconds: withBasis(wait.value, ruleInput(wait)) },
      { bucket: 'travel', seconds: withBasis(ride.value, ruleInput(ride)) },
    ],
    used: mergeKeys(walk.used, markedKeys(rules, ['transportWaitSeconds', 'transportRideSeconds'])),
    facts,
  };
}

/** The steps between a client berth and its boarding point at both ends of a ride (TIME-7). */
export interface BoardingSteps {
  /** One `travel` part per end with a boarding point more than 0 yd from its berth: departure, then arrival. */
  readonly parts: readonly TimePart[];
  readonly used: readonly RuleKey[];
}

const NO_BOARDING_STEPS: BoardingSteps = { parts: [], used: [] };

/**
 * TIME-7 (D-052 item 1): the walks to and from an inferred dock end at its boarding point
 * (src/rules/berths.ts), and the step between the boarding point and the berth is priced at each
 * end of the ride as its straight-line yards (`boardingYd`) at the run speed. It is an assumption
 * (basis `assumption` whatever the run speed's basis): the real path along the pier is unknown and
 * at least that long. It is a travel part of its own, not part of the wait, which is a mean over an
 * unknown phase and does not shorten. A dock without a boarding point (a user dock, a dock NPC, a
 * berth on walkable ground at 0 yd) adds nothing.
 */
export function boardingSteps(edge: TransportEdge | null, rules: EffectiveRules): BoardingSteps {
  if (edge === null) return NO_BOARDING_STEPS;
  const ends = [edge.from.boarding?.fromBerthYd ?? 0, edge.to.boarding?.fromBerthYd ?? 0];
  const runSpeed = rules.values.runSpeed;
  const basis = combine([ruleInput(runSpeed), ASSUMPTION]);
  const parts: TimePart[] = [];
  for (const yards of ends) if (yards > 0) parts.push({ bucket: 'travel', seconds: withBasis(yards / runSpeed.value, basis) });
  if (parts.length === 0) return NO_BOARDING_STEPS;
  return { parts, used: markedKeys(rules, ['runSpeed']) };
}
