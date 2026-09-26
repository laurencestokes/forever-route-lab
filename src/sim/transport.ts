import type { Faction } from '../domain/character';
import { type EffectiveRules, markedKeys } from '../rules/precedence';
import type { RuleKey } from '../rules/ruleset';
import type { TransportEdge } from '../rules/travel-graph';
import type { TimePart } from './estimate';
import type { SimFact } from './facts';
import { mergeKeys, ruleInput, withBasis } from './provenance';
import type { GroundTravel } from './travel';

/**
 * Transports (docs/SIMULATION.md TIME-7): `seconds = ground(state → dock) + waitS + rideS`. The
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
