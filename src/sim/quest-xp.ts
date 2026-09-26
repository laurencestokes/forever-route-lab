import type { Estimated } from '../domain/estimate';
import type { QuestXp } from '../domain/dataset';
import type { QuestId } from '../domain/ids';
import { type EffectiveRules, markedKeys } from '../rules/precedence';
import type { QuestXpRounding, RuleKey } from '../rules/ruleset';
import type { SimFact } from './facts';
import { type Basis, ASSUMPTION, combine, eraSeedInput, ruleInput, SOURCE, withBasis } from './provenance';

/**
 * Quest XP (docs/SIMULATION.md QXP-1..QXP-7): the full XP reduced by the level difference at the
 * turn-in and rounded, with the Forever multipliers applied only to `era-seed` XP.
 */

/** QXP-4 `RoundXPValue` (TrinityCore QuestDef.cpp:499-509; Questie QuestieXP.lua:75-83). */
export function roundXpValue(x: number): number {
  if (x <= 100) return 5 * Math.floor((x + 2) / 5);
  if (x <= 500) return 10 * Math.floor((x + 5) / 10);
  if (x <= 1000) return 25 * Math.floor((x + 12) / 25);
  return 50 * Math.floor((x + 25) / 50);
}

/** QXP-3: the level-difference multiplier in tenths, `clamp(2 × (Q − P) + 20, 1, 10)`. */
export function questXpTenths(playerLevel: number, questLevel: number): number {
  return Math.min(10, Math.max(1, 2 * (questLevel - playerLevel) + 20));
}

/** QXP-3/QXP-4: the full XP `B` reduced at `tenths` of 10 with the rounding variant. */
export function reduceQuestXp(baseXp: number, tenths: number, rounding: QuestXpRounding): number {
  switch (rounding) {
    case 'trinity-steps':
      return roundXpValue(Math.floor((baseXp * tenths) / 10));
    case 'vmangos-ceil':
      // vmangos multiplies in float32 (why 335 at 60% gives 202, QXP-4).
      return Math.ceil(Math.fround(Math.fround(baseXp) * Math.fround(tenths / 10)));
  }
}

export interface QuestXpInput {
  readonly questId: QuestId;
  /** The effective XP record: a quest override's, else the custom quest's or the dataset's. */
  readonly xp: QuestXp | null;
  /** `QuestRecord.minLevel`, for scaling quests (`questLevel` -1, QXP-7). */
  readonly requiredLevel: number | null;
  readonly dungeonQuest: boolean;
  /** The level at the turn-in: the lower bound `P_lb` while `unknownXpEvents > 0` (XP-4). */
  readonly playerLevel: number;
}

export interface QuestXpResult {
  /** Unknown (value null) when the XP cannot be known (XP-4); never 0 for unknown. */
  readonly xp: Estimated<number>;
  /** The effective quest level, or null when unknown. */
  readonly questLevel: number | null;
  /** Percent of the full XP after the level difference (100, 80, 60, 40, 20 or 10), or null. */
  readonly percent: number | null;
  /** True when the player is at the cap and the quest gives no XP (QXP-6). */
  readonly atCap: boolean;
  readonly used: readonly RuleKey[];
  readonly facts: readonly SimFact[];
}

function unknownXp(input: QuestXpInput, reason: 'no-record' | 'unknown-level'): QuestXpResult {
  return {
    xp: { value: null, basis: 'unknown', eraFallback: false },
    questLevel: null,
    percent: null,
    atCap: false,
    used: [],
    facts: [{ kind: 'unknown-xp', questId: input.questId, reason }],
  };
}

/**
 * `floor(x × m)` for an integer `x` and a decimal multiplier `m`, exactly as QXP-3 writes it: the
 * double product of a decimal such as 1.4 can fall just below an integer (45 × 1.4 is
 * 62.99999999999999), so an epsilon absorbs the float noise, as `grindTargetTotal` does. It is not
 * Questie's double floor (SIMULATION QXP-3).
 */
export function floorProduct(x: number, m: number): number {
  return Math.floor(x * m + 1e-9);
}

/**
 * QXP-3 in full. 0 at or above the cap, checked first: XP-2's `GiveXP` returns at the cap, so a
 * missing record there changes nothing and is not unknown XP (SIMULATION QXP-3, XP-4). Otherwise
 * unknown when there is no XP record or the quest level is 0 or below -1 (XP-4, QXP-7); else
 * `reduce(B)` with the rounding variant, then for `era-seed` XP `floor(reduce(B) × m)` with the
 * open-world or dungeon multiplier. A `user` or `forever-observed` value is the full XP as the game
 * showed it: used as entered at 100%, reduced and rounded otherwise, never multiplied.
 *
 * Basis (SIMULATION §8): `era-seed` is `assumption` in `forever-beta` (the multipliers are
 * assumptions) and `derived` in `era-1.15`; `user` XP is `assumption`; `forever-observed` is `source`
 * at 100% and `derived` when reduced.
 */
export function questXp(input: QuestXpInput, rules: EffectiveRules): QuestXpResult {
  const record = input.xp;
  const values = rules.values;
  const player = input.playerLevel;
  const maxLevel = Math.min(values.maxLevel.value, values.xpToNextLevel.value.length + 1);
  const knownLevel = record !== null && record.questLevel !== 0 && record.questLevel >= -1;
  const questLevel = record === null || !knownLevel ? null : record.questLevel === -1 ? Math.max(input.requiredLevel ?? 1, player) : record.questLevel;
  if (player >= maxLevel) {
    return { xp: withBasis(0, combine([ruleInput(values.maxLevel)])), questLevel, percent: null, atCap: true, used: markedKeys(rules, ['maxLevel']), facts: [] };
  }
  if (record === null) return unknownXp(input, 'no-record');
  if (questLevel === null) return unknownXp(input, 'unknown-level');
  if (!Number.isFinite(record.baseXp) || record.baseXp < 0) {
    throw new RangeError(`Invalid base XP ${String(record.baseXp)} for quest ${String(input.questId)}`);
  }
  const tenths = questXpTenths(player, questLevel);
  const percent = tenths * 10;
  const rounding = values.questXpRounding;
  const read: RuleKey[] = [];
  let value: number;
  let basis: Basis;
  switch (record.basis) {
    case 'era-seed': {
      const multiplier = input.dungeonQuest ? values.dungeonQuestXpMultiplier : values.questXpMultiplier;
      read.push('questXpRounding', input.dungeonQuest ? 'dungeonQuestXpMultiplier' : 'questXpMultiplier');
      value = floorProduct(reduceQuestXp(record.baseXp, tenths, rounding.value), multiplier.value);
      basis = combine([eraSeedInput(rules.rulesetId), ruleInput(rounding), ruleInput(multiplier)]);
      break;
    }
    case 'user':
    case 'forever-observed': {
      const entered = record.basis === 'user' ? ASSUMPTION : SOURCE;
      if (tenths === 10) {
        value = record.baseXp;
        basis = combine([entered], false);
      } else {
        read.push('questXpRounding');
        value = reduceQuestXp(record.baseXp, tenths, rounding.value);
        basis = combine([entered, ruleInput(rounding)]);
      }
      break;
    }
  }
  return { xp: withBasis(value, basis), questLevel, percent, atCap: false, used: markedKeys(rules, read), facts: [] };
}
