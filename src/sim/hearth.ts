import { type EffectiveRules, markedKeys } from '../rules/precedence';
import type { RuleKey } from '../rules/ruleset';
import type { TimePart } from './estimate';
import type { SimFact } from './facts';
import { type Basis, combine, ruleInput, UNKNOWN, withBasis } from './provenance';

/**
 * Hearthstone (docs/SIMULATION.md TIME-4). The destination is the bind point in the walker's
 * state, so moving a bind step changes every later hearth automatically. At route start the
 * hearthstone is ready (`hearthReadyAt = 0`, an assumption). Binding is an interaction
 * (`interactionTime({ kind: 'bind' })`) after the walk to the innkeeper.
 */

export interface HearthUseInput {
  /** The time the step starts. */
  readonly timeSec: number;
  readonly hearthReadyAt: number;
  /** Whether a bind point is known (`state.hearth !== null`). */
  readonly bound: boolean;
  /**
   * The combined basis of the step durations since the last cast ended (`unknown` when one of them
   * was unknown): the wait `hearthReadyAt − timeSec` is the cooldown less that time, so it takes
   * their basis. Omitted: no step since the cast (the cooldown alone).
   */
  readonly sinceCast?: Basis;
}

export interface HearthUse {
  /** `waiting` (cooldown) then `travel` (the cast); one unknown `travel` part when unbound. */
  readonly parts: readonly TimePart[];
  /** `hearthReadyAt` after the step: cast end + cooldown (unchanged when unbound). */
  readonly readyAt: number;
  /** When the cast ends and the character stands at the bind point (null when unbound). */
  readonly arrivesAt: number | null;
  readonly used: readonly RuleKey[];
  readonly facts: readonly SimFact[];
}

/**
 * `hearth use`: with no bind point, `hearth-unbound` and unknown travel (the walker sets the
 * location to null). On cooldown the walker waits `hearthReadyAt − timeSec` and records
 * `hearth-cooldown`; it never errors. Then the cast (`hearthCastSeconds`), and the cooldown starts
 * when the cast ends.
 *
 * The wait is the cooldown less the time since the cast, so its basis combines the cooldown's with
 * `sinceCast` (SIMULATION §8, TIME-4). When a step since the cast has unknown time, the clock is a
 * lower bound (TIME-13) and the true wait lies anywhere from 0 to the computed one: the wait is then
 * unknown time, contributing 0 s, and `hearth-cooldown` carries the computed value as an upper
 * bound. The unknown offset cancels at the next cast, so the wait after it is exact again.
 */
export function hearthUse(input: HearthUseInput, rules: EffectiveRules): HearthUse {
  const { hearthCastSeconds: cast, hearthCooldownSeconds: cooldown } = rules.values;
  if (!input.bound) {
    return {
      parts: [{ bucket: 'travel', seconds: withBasis<number>(null, UNKNOWN) }],
      readyAt: input.hearthReadyAt,
      arrivesAt: null,
      used: [],
      facts: [{ kind: 'hearth-unbound' }],
    };
  }
  const wait = Math.max(0, input.hearthReadyAt - input.timeSec);
  const parts: TimePart[] = [];
  const facts: SimFact[] = [];
  const read: RuleKey[] = ['hearthCastSeconds', 'hearthCooldownSeconds'];
  let waited = 0;
  if (wait > 0) {
    const clock = input.sinceCast;
    const upperBound = clock?.basis === 'unknown';
    const basis = clock === undefined ? combine([ruleInput(cooldown)]) : combine([ruleInput(cooldown), clock]);
    parts.push({ bucket: 'waiting', seconds: withBasis(upperBound ? null : wait, basis) });
    facts.push({ kind: 'hearth-cooldown', waitSeconds: wait, upperBound });
    if (!upperBound) waited = wait;
  }
  parts.push({ bucket: 'travel', seconds: withBasis(cast.value, combine([ruleInput(cast)], false)) });
  const arrivesAt = input.timeSec + waited + cast.value;
  return { parts, readyAt: arrivesAt + cooldown.value, arrivesAt, used: markedKeys(rules, read), facts };
}
