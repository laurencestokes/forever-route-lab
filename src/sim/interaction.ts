import { type EffectiveRules, markedKeys } from '../rules/precedence';
import type { RuleKey } from '../rules/ruleset';
import type { TimePart } from './estimate';
import { ASSUMPTION, combine, ruleInput, withBasis } from './provenance';

/**
 * Interaction times (docs/SIMULATION.md TIME-8, §6.5). All are assumptions. A visit is a run of
 * consecutive accept (or turn-in) steps with the same `via` entity or the same resolved location and
 * no travel between them; the walker decides whether a step is the first of its visit.
 */
export type Interaction =
  /** An accept (one quest, even with `anyOf`): `acceptSeconds` first in a visit, else `acceptExtraSeconds`. */
  | { readonly kind: 'accept'; readonly firstInVisit: boolean }
  /** A turn-in: `turninSeconds`, plus `rewardChoiceSeconds` when the step has a `rewardIndex`. */
  | { readonly kind: 'turnin'; readonly rewardChoice: boolean }
  | { readonly kind: 'vendor' }
  | { readonly kind: 'train' }
  /** Setting the bind point with an innkeeper (TIME-4). */
  | { readonly kind: 'bind' }
  /** Talking to a flight master to take or discover a flight (TIME-5). */
  | { readonly kind: 'flight-master' }
  /** `note` and `abandon` cost 0 s. */
  | { readonly kind: 'note' }
  | { readonly kind: 'abandon' };

export interface InteractionTime {
  readonly part: TimePart;
  readonly used: readonly RuleKey[];
}

type SecondsKey =
  | 'acceptSeconds'
  | 'acceptExtraSeconds'
  | 'turninSeconds'
  | 'rewardChoiceSeconds'
  | 'vendorSeconds'
  | 'trainerSeconds'
  | 'bindSeconds'
  | 'flightMasterSeconds';

function keysOf(interaction: Interaction): SecondsKey[] {
  switch (interaction.kind) {
    case 'accept':
      return [interaction.firstInVisit ? 'acceptSeconds' : 'acceptExtraSeconds'];
    case 'turnin':
      return interaction.rewardChoice ? ['turninSeconds', 'rewardChoiceSeconds'] : ['turninSeconds'];
    case 'vendor':
      return ['vendorSeconds'];
    case 'train':
      return ['trainerSeconds'];
    case 'bind':
      return ['bindSeconds'];
    case 'flight-master':
      return ['flightMasterSeconds'];
    case 'note':
    case 'abandon':
      return [];
  }
}

/** TIME-8: the interaction part of a step (`breakdown.interaction`). */
export function interactionTime(interaction: Interaction, rules: EffectiveRules): InteractionTime {
  const keys = keysOf(interaction);
  const seconds = keys.reduce((sum, key) => sum + rules.values[key].value, 0);
  // `note` and `abandon` read no key: their 0 s is itself TIME-8's assumption.
  const basis = keys.length === 0 ? ASSUMPTION : combine(keys.map((key) => ruleInput(rules.values[key])), keys.length > 1);
  return { part: { bucket: 'interaction', seconds: withBasis(seconds, basis) }, used: markedKeys(rules, keys) };
}
