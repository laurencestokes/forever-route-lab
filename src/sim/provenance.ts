import type { Estimated, EstimateBasis } from '../domain/estimate';
import type { RulesetId } from '../domain/project';
import type { EffectiveValue } from '../rules/precedence';
import { RULE_KEYS, type RuleKey } from '../rules/ruleset';

/**
 * The combination rule of docs/SIMULATION.md §8. A value is `unknown` when a required input is
 * unknown. Otherwise its basis is `assumption` if any input is an assumption (an effective value
 * with basis `assumption`, user-entered XP, a user override, an assumed count or level), else
 * `derived` if it was computed, else `source`. Ruleset values with basis `client-data`, `official`
 * or `reported`, dataset values and the route's own points are source inputs. `eraFallback` is true
 * when any input is `era-assumed` or `era-seed` XP in `forever-beta`; in `era-1.15` it is always
 * false.
 */

/** The provenance of one number: its estimate basis and whether an Era value stood in for Forever. */
export interface Basis {
  readonly basis: EstimateBasis;
  readonly eraFallback: boolean;
}

export const SOURCE: Basis = { basis: 'source', eraFallback: false };
export const DERIVED: Basis = { basis: 'derived', eraFallback: false };
export const ASSUMPTION: Basis = { basis: 'assumption', eraFallback: false };
export const UNKNOWN: Basis = { basis: 'unknown', eraFallback: false };

/**
 * An effective rule value as an input: `assumption` stays an assumption; `era-assumed` is a source
 * input with the Era-fallback flag; `client-data`, `official` and `reported` are source inputs.
 */
export function ruleInput(value: Pick<EffectiveValue<unknown>, 'basis'>): Basis {
  switch (value.basis) {
    case 'assumption':
      return ASSUMPTION;
    case 'era-assumed':
      return { basis: 'source', eraFallback: true };
    case 'client-data':
    case 'official':
    case 'reported':
      return SOURCE;
  }
}

/** `era-seed` quest XP as an input: a dataset value, and an Era stand-in when the ruleset is `forever-beta`. */
export function eraSeedInput(rulesetId: RulesetId): Basis {
  return { basis: 'source', eraFallback: rulesetId === 'forever-beta' };
}

/** Combines inputs by the §8 rule. `computed` says whether the value was computed from them. */
export function combine(inputs: readonly Basis[], computed = true): Basis {
  let basis: EstimateBasis = computed ? 'derived' : 'source';
  let assumed = false;
  let eraFallback = false;
  for (const input of inputs) {
    if (input.basis === 'unknown') return UNKNOWN;
    if (input.basis === 'assumption') assumed = true;
    if (input.basis === 'derived') basis = 'derived';
    if (input.eraFallback) eraFallback = true;
  }
  return { basis: assumed ? 'assumption' : basis, eraFallback };
}

/** The basis part of an estimate. */
export function basisOf(value: Estimated<unknown>): Basis {
  return { basis: value.basis, eraFallback: value.eraFallback };
}

/** An estimate with the given provenance; an `unknown` basis always has a null value. */
export function withBasis<T>(value: T | null, basis: Basis): Estimated<T> {
  if (value === null || basis.basis === 'unknown') return { value: null, basis: 'unknown', eraFallback: false };
  return { value, basis: basis.basis, eraFallback: basis.eraFallback };
}

/**
 * The sum of several estimates: unknown when any is unknown, otherwise the combined basis. A single
 * addend keeps its basis unchanged; an empty sum is 0 with basis `derived`.
 */
export function sumEstimates(values: readonly Estimated<number>[]): Estimated<number> {
  const [only, ...rest] = values;
  if (only !== undefined && rest.length === 0) return only;
  let total = 0;
  for (const value of values) {
    if (value.value === null) return { value: null, basis: 'unknown', eraFallback: false };
    total += value.value;
  }
  return withBasis(total, combine(values.map(basisOf)));
}

/** Each rule key's index in RULE_KEYS. */
export const RULE_KEY_INDEX: ReadonlyMap<RuleKey, number> = new Map(RULE_KEYS.map((key, index) => [key, index]));

/** Scratch marks by RULE_KEYS index for `mergeKeys`; all 0 between calls (the module is single-threaded). */
const MARKS = new Uint8Array(RULE_KEYS.length);

/**
 * Several `assumptionsUsed` lists as one, without duplicates, in RULE_KEYS order: a mark per key
 * index, then one pass in index order (no Set, no sort; it runs for every leg and objective).
 */
export function mergeKeys(...lists: readonly (readonly RuleKey[])[]): RuleKey[] {
  let low = MARKS.length;
  let high = -1;
  for (const list of lists) {
    for (const key of list) {
      const index = RULE_KEY_INDEX.get(key);
      if (index === undefined) continue;
      MARKS[index] = 1;
      if (index < low) low = index;
      if (index > high) high = index;
    }
  }
  const out: RuleKey[] = [];
  for (let index = low; index <= high; index += 1) {
    if (MARKS[index] !== 1) continue;
    MARKS[index] = 0;
    const key = RULE_KEYS[index];
    if (key !== undefined) out.push(key);
  }
  return out;
}
