import type { AssumptionKey, AssumptionOverrides, AssumptionValues } from '../domain/assumptions';
import type { RulesetId } from '../domain/project';
import { compareRuleKeys, RULE_KEYS, type RuleBasis, type RuleKey, type Ruleset, type RuleValue, type RuleValueTypes } from './ruleset';

/**
 * Precedence (docs/ARCHITECTURE.md §9.1, docs/SIMULATION.md §1.2): the effective value of a key is
 * the project assumption when `project.assumptions` sets it, else the ruleset value, and it carries
 * the provenance of whichever supplied it. A project assumption is
 * `{ value, basis: 'assumption', source: 'project' }`.
 */

/** A rule value with the layer that supplied it. */
export type EffectiveValue<T> = RuleValue<T> & {
  readonly from: 'project' | 'ruleset';
};

export type EffectiveValues = { readonly [K in RuleKey]: EffectiveValue<RuleValueTypes[K]> };

export interface EffectiveRules {
  readonly rulesetId: RulesetId;
  readonly values: EffectiveValues;
}

/** Rule keys whose value type is exactly `V`. */
type RuleKeysOfType<V> = {
  [K in RuleKey]: [RuleValueTypes[K]] extends [V] ? ([V] extends [RuleValueTypes[K]] ? K : never) : never;
}[RuleKey];

/**
 * Which ruleset parameters each project assumption overrides (SIMULATION §1.2, "Project override"
 * column). `interactionSeconds` sets both `acceptSeconds` and `turninSeconds`; `secondsPerObjective`
 * has no rule yet (open question 10.14), so it overrides nothing.
 */
export const ASSUMPTION_RULE_KEYS: { readonly [K in AssumptionKey]: readonly RuleKeysOfType<AssumptionValues[K]>[] } = {
  groupSize: ['groupSize'],
  groupXp: ['groupXpEnabled'],
  maxLevel: ['maxLevel'],
  questLogCapacity: ['questLogCapacity'],
  runSpeedYps: ['runSpeed'],
  travelDetourFactor: ['groundDetourFactor'],
  taxiSpeedYps: ['taxiSpeed'],
  taxiDetourFactor: ['taxiDetourFactor'],
  transportWaitSeconds: ['transportWaitSeconds'],
  transportRideSeconds: ['transportRideSeconds'],
  interactionSeconds: ['acceptSeconds', 'turninSeconds'],
  lootSeconds: ['lootSeconds'],
  secondsPerKill: ['killSeconds'],
  killsPerObjective: ['objectiveKillCount'],
  secondsPerObjective: [],
  objectiveConcurrency: ['objectiveConcurrency'],
  questXpMultiplier: ['questXpMultiplier'],
  dungeonQuestXpMultiplier: ['dungeonQuestXpMultiplier'],
  killXpMultiplier: ['killXpMultiplier'],
};

/**
 * Project assumptions that no simulation rule reads yet (SIMULATION open question 10.14). They are
 * kept and exported but change no estimate; the UI can say so.
 */
export const UNRULED_ASSUMPTION_KEYS: readonly AssumptionKey[] = ['groupSize', 'secondsPerObjective', 'killXpMultiplier'];

const ASSUMPTION_KEYS = Object.keys(ASSUMPTION_RULE_KEYS) as AssumptionKey[];

/** The effective value of every ruleset parameter under a project's assumptions. */
export function effectiveRules(ruleset: Ruleset, assumptions: AssumptionOverrides = {}): EffectiveRules {
  const values: Record<string, EffectiveValue<unknown>> = {};
  for (const key of RULE_KEYS) values[key] = { ...ruleset.values[key], from: 'ruleset' };
  for (const assumptionKey of ASSUMPTION_KEYS) {
    if (!Object.hasOwn(assumptions, assumptionKey)) continue;
    const value = assumptions[assumptionKey];
    if (value === undefined) continue;
    for (const key of ASSUMPTION_RULE_KEYS[assumptionKey]) {
      values[key] = { value, basis: 'assumption', source: 'project', from: 'project' };
    }
  }
  return { rulesetId: ruleset.id, values: values as unknown as EffectiveValues };
}

/** One effective value (the same result as `effectiveRules(...).values[key]`). */
export function effectiveValue<K extends RuleKey>(
  ruleset: Ruleset,
  assumptions: AssumptionOverrides,
  key: K,
): EffectiveValue<RuleValueTypes[K]> {
  return effectiveRules(ruleset, assumptions).values[key];
}

/** Whether a number that depends on this basis must be marked in the UI (ARCHITECTURE §9.1). */
export function isMarkedBasis(basis: RuleBasis): boolean {
  return basis === 'assumption' || basis === 'era-assumed';
}

/**
 * The keys among `keys` whose effective basis is `assumption` or `era-assumed`, in RULE_KEYS order
 * without duplicates: what a step lists in `assumptionsUsed` (SIMULATION §8).
 */
export function markedKeys(rules: EffectiveRules, keys: Iterable<RuleKey>): RuleKey[] {
  const out: RuleKey[] = [];
  for (const key of keys) if (isMarkedBasis(rules.values[key].basis) && !out.includes(key)) out.push(key);
  return out.length > 1 ? out.sort(compareRuleKeys) : out;
}
