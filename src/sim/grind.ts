import type { Estimated } from '../domain/estimate';
import type { GrindStep } from '../domain/route';
import { type EffectiveRules, markedKeys } from '../rules/precedence';
import type { RuleKey } from '../rules/ruleset';
import type { SimFact } from './facts';
import { type KillPlace, killXp } from './kill-xp';
import { ASSUMPTION, type Basis, combine, mergeKeys, ruleInput, UNKNOWN, withBasis } from './provenance';
import { cumulativeXp, grantXp, grindTargetTotal, totalXp, type XpCurve, xpToNext, type XpState } from './xp';

/**
 * Grind steps (docs/SIMULATION.md TIME-12, XP-4). A level target makes the level known again: the
 * walker resets `unknownXpEvents` when `resetsUnknownXp` is true. Grind time is combat
 * (`breakdown.combat`), basis `assumption`; rested XP is off (KXP-9).
 */

export interface GrindInput {
  readonly until: GrindStep['until'];
  readonly mobLevel: number | null;
  readonly xpPerHour: number | null;
  /** The state before the step (the known-XP lower bound while `unknownXpEvents > 0`). */
  readonly state: XpState;
  readonly unknownXpEvents: number;
  /** Where the kills happen (KXP-5: an instance map makes them dungeon or raid kills); default open world. */
  readonly place?: KillPlace;
}

export interface GrindResult {
  /** Unknown when the target cannot be reached (above the cap, or a gray mob). */
  readonly seconds: Estimated<number>;
  /** XP granted by the step (0 when the target is already reached). */
  readonly xpGained: Estimated<number>;
  /** The state after the step (unchanged when unreachable). */
  readonly state: XpState;
  readonly kills: number | null;
  /** True when the step made the level known again (level target above the lower bound, XP-4). */
  readonly resetsUnknownXp: boolean;
  /** True when the duration is an upper bound (the target was above an uncertain level). */
  readonly upperBound: boolean;
  readonly used: readonly RuleKey[];
  readonly facts: readonly SimFact[];
}

interface Progress {
  readonly state: XpState;
  readonly seconds: number;
  readonly kills: number;
  readonly granted: number;
  readonly basis: Basis;
  readonly used: readonly RuleKey[];
}

/**
 * The level-by-level kill loop: at each level `x = killXp(P, mobLevel ?? P, normal)`. With
 * `target` it kills until the total reaches it (`kills = ceil(need / x)`, overshoot carries over);
 * with `killBudget` it spends that many kills. Null when a gray mob (`x = 0`) stops progress
 * before the target.
 */
function killLoop(
  curve: XpCurve,
  start: XpState,
  mobLevel: number | null,
  place: KillPlace,
  rules: EffectiveRules,
  limit: { readonly target: number } | { readonly killBudget: number },
): Progress | null {
  let state = start;
  let kills = 0;
  let granted = 0;
  const bases: Basis[] = [ruleInput(rules.values.killSeconds)];
  let used: RuleKey[] = markedKeys(rules, ['killSeconds']);
  for (;;) {
    const total = totalXp(curve, state);
    const remainingKills = 'killBudget' in limit ? limit.killBudget - kills : Number.POSITIVE_INFINITY;
    if ('target' in limit ? total >= limit.target : remainingKills <= 0) break;
    const toNext = xpToNext(curve, state.level);
    if (toNext === null) break; // at the cap: kills give nothing more (XP-2)
    const each = killXp({ playerLevel: state.level, mobLevel: mobLevel ?? state.level, rank: 0, place }, rules);
    bases.push(each.basis);
    used = mergeKeys(used, each.used);
    if (each.xp === 0) {
      if ('target' in limit) return null;
      kills += remainingKills; // gray mobs: the time passes, no XP
      break;
    }
    const levelEnd = cumulativeXp(curve, state.level) + toNext;
    const need = ('target' in limit ? Math.min(limit.target, levelEnd) : levelEnd) - total;
    const count = Math.min(Math.ceil(need / each.xp), remainingKills);
    const grant = grantXp(curve, state, count * each.xp);
    kills += count;
    granted += grant.granted;
    state = grant;
  }
  const seconds = kills * rules.values.killSeconds.value;
  return { state, seconds, kills, granted, basis: combine([ASSUMPTION, ...bases]), used };
}

function unreachable(input: GrindInput, reason: 'above-max-level' | 'gray-mob' | 'zero-rate', used: readonly RuleKey[]): GrindResult {
  return {
    seconds: withBasis<number>(null, UNKNOWN),
    xpGained: withBasis(0, ASSUMPTION),
    state: input.state,
    kills: null,
    resetsUnknownXp: false,
    upperBound: false,
    used,
    facts: [reason === 'zero-rate' ? { kind: 'grind-zero-rate' } : { kind: 'time-unknown', part: 'grind', reason, questId: null, objective: null }],
  };
}

/**
 * TIME-12. Level target: resolved to a total `T` (`grindTargetTotal`); at or above it, 0 s and no
 * change (and no reset); above the cap, unreachable. With `xpPerHour` the deficit takes
 * `deficit × 3600 / xpPerHour` s and exactly the deficit is granted (at 0 XP per hour the target is
 * unreachable, `grind-zero-rate`); without it (null) the kill loop runs.
 * After unknown XP the step resets the uncertainty and records `grind-upper-bound`; a duration over
 * `grindWarnSeconds` records `target-level-late` (`uncertain` when an upper bound).
 *
 * Duration target: `floor(S × xpPerHour / 3600)` XP, else `floor(S / killSeconds)` kills of the
 * loop; it never resets `unknownXpEvents`.
 */
export function grind(input: GrindInput, curve: XpCurve, rules: EffectiveRules): GrindResult {
  const values = rules.values;
  const until = input.until;
  const place = input.place ?? 'open-world';
  if (until.kind === 'duration') {
    const seconds = Math.max(0, until.seconds);
    if (input.xpPerHour !== null) {
      const grant = grantXp(curve, input.state, Math.floor((seconds * input.xpPerHour) / 3600));
      const basis = combine([ASSUMPTION, curve.basis]);
      return {
        seconds: withBasis(seconds, ASSUMPTION),
        xpGained: withBasis(grant.granted, basis),
        state: grant,
        kills: null,
        resetsUnknownXp: false,
        upperBound: false,
        used: markedKeys(rules, ['xpToNextLevel']),
        facts: [],
      };
    }
    const budget = values.killSeconds.value > 0 ? Math.floor(seconds / values.killSeconds.value) : 0;
    const progress = killLoop(curve, input.state, input.mobLevel, place, rules, { killBudget: budget });
    const done = progress ?? { state: input.state, kills: budget, granted: 0, basis: ASSUMPTION, used: markedKeys(rules, ['killSeconds']) };
    return {
      seconds: withBasis(seconds, ASSUMPTION),
      xpGained: withBasis(done.granted, combine([done.basis, curve.basis])),
      state: done.state,
      kills: done.kills,
      resetsUnknownXp: false,
      upperBound: false,
      used: mergeKeys(done.used, markedKeys(rules, ['xpToNextLevel'])),
      facts: [],
    };
  }

  const target = grindTargetTotal(curve, until);
  const tableKeys = markedKeys(rules, ['xpToNextLevel', 'maxLevel']);
  if (target === null || target > cumulativeXp(curve, curve.maxLevel)) return unreachable(input, 'above-max-level', tableKeys);
  const before = totalXp(curve, input.state);
  if (before >= target) {
    return {
      seconds: withBasis(0, ASSUMPTION),
      xpGained: withBasis(0, ASSUMPTION),
      state: input.state,
      kills: 0,
      resetsUnknownXp: false,
      upperBound: false,
      used: tableKeys,
      facts: [],
    };
  }
  const upperBound = input.unknownXpEvents > 0;
  let seconds: number;
  let state: XpState;
  let kills: number | null;
  let granted: number;
  let basis: Basis;
  let used: RuleKey[];
  if (input.xpPerHour !== null && input.xpPerHour <= 0) return unreachable(input, 'zero-rate', tableKeys);
  if (input.xpPerHour !== null) {
    const deficit = target - before;
    const grant = grantXp(curve, input.state, deficit);
    seconds = (deficit * 3600) / input.xpPerHour;
    state = grant;
    kills = null;
    granted = grant.granted;
    basis = combine([ASSUMPTION, curve.basis]);
    used = tableKeys;
  } else {
    const progress = killLoop(curve, input.state, input.mobLevel, place, rules, { target });
    if (progress === null) return unreachable(input, 'gray-mob', tableKeys);
    ({ seconds, state, kills, granted } = progress);
    basis = combine([progress.basis, curve.basis]);
    used = mergeKeys(progress.used, tableKeys);
  }
  const facts: SimFact[] = [];
  if (upperBound) facts.push({ kind: 'grind-upper-bound' });
  if (seconds > values.grindWarnSeconds.value) {
    facts.push({ kind: 'target-level-late', seconds, uncertain: upperBound });
    used = mergeKeys(used, markedKeys(rules, ['grindWarnSeconds']));
  }
  return {
    seconds: withBasis(seconds, basis),
    xpGained: withBasis(granted, basis),
    state,
    kills,
    resetsUnknownXp: upperBound,
    upperBound,
    used,
    facts,
  };
}
