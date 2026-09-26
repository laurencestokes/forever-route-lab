import { describe, expect, it } from 'vitest';
import { spellId } from '../domain/ids';
import { ERA_GREEN_RANGE } from './difficulty';
import { isRidingTrainStep, ridingSpellTier } from './riding';
import { ERA_1_15, FOREVER_BETA, FOREVER_RIDING_SPELLS, RULE_KEYS, type RuleKey, rulesetById, RULESETS } from './ruleset';
import { bandValue, ERA_GROUP_XP_RATES, ERA_XP_TO_NEXT_LEVEL, ERA_ZERO_DIFFERENCE } from './tables';

describe('rulesets (docs/SIMULATION.md §1.2)', () => {
  it('has the two ids the project schema uses', () => {
    expect(Object.keys(RULESETS).sort()).toEqual(['era-1.15', 'forever-beta']);
    expect(rulesetById('forever-beta')).toBe(FOREVER_BETA);
    expect(rulesetById('era-1.15')).toBe(ERA_1_15);
  });

  it.each([FOREVER_BETA, ERA_1_15])('$id defines every key, each with a basis and a cited source', (ruleset) => {
    expect(Object.keys(ruleset.values).sort()).toEqual([...RULE_KEYS].sort());
    for (const key of RULE_KEYS) {
      const value = ruleset.values[key];
      expect(['client-data', 'official', 'reported', 'era-assumed', 'assumption']).toContain(value.basis);
      expect(value.source.trim(), key).not.toBe('');
      if (value.basis === 'client-data') expect(value.build, key).toMatch(/^1\.\d+\.\d+\.\d+$/);
    }
  });

  it('uses era-assumed only in forever-beta', () => {
    expect(RULE_KEYS.filter((key) => ERA_1_15.values[key].basis === 'era-assumed')).toEqual([]);
    expect(RULE_KEYS.filter((key) => FOREVER_BETA.values[key].basis === 'era-assumed')).toEqual([
      'xpToNextLevel',
      'questXpRounding',
      'killXpRounding',
      'eliteKillXpMultiplier',
      'dungeonEliteKillXpMultiplier',
      'zeroDifference',
      'groupXpRates',
      'greenRange',
      'difficultyYellowLowerBound',
      'runSpeed',
      'swimSpeed',
      'taxiSpeed',
    ]);
  });

  /** The §1.2 defaults and bases, key by key: [key, forever-beta value, basis, era-1.15 value, basis]. */
  const TABLE: readonly (readonly [RuleKey, unknown, string, unknown, string])[] = [
    ['maxLevel', 60, 'official', 60, 'official'],
    ['questXpRounding', 'trinity-steps', 'era-assumed', 'trinity-steps', 'reported'],
    ['questXpMultiplier', 1, 'assumption', 1, 'reported'],
    ['dungeonQuestXpMultiplier', 1, 'assumption', 1, 'reported'],
    ['maxLevelMoneyEstimate', false, 'assumption', false, 'assumption'],
    ['killXpRounding', 'half-even', 'era-assumed', 'half-even', 'reported'],
    ['eliteKillXpMultiplier', 2, 'era-assumed', 2, 'reported'],
    ['dungeonEliteKillXpMultiplier', 2.5, 'era-assumed', 2.5, 'reported'],
    ['dungeonMobXpMultiplier', 1, 'assumption', 1, 'reported'],
    ['mobLevelChoice', 'midpoint-floor', 'assumption', 'midpoint-floor', 'assumption'],
    ['groupXpEnabled', false, 'assumption', false, 'assumption'],
    ['restedEnabled', false, 'assumption', false, 'assumption'],
    ['difficultyYellowLowerBound', -2, 'era-assumed', -2, 'client-data'],
    ['questLogCapacity', 40, 'client-data', 20, 'client-data'],
    ['runSpeed', 7, 'era-assumed', 7, 'reported'],
    ['swimSpeed', 4.722, 'era-assumed', 4.722, 'reported'],
    ['groundDetourFactor', 1.25, 'assumption', 1.25, 'assumption'],
    ['mountLevels', [40, 60], 'client-data', [40, 60], 'client-data'],
    ['mountSpeedBonus', [0.6, 1], 'client-data', [0.6, 1], 'client-data'],
    ['hearthCastSeconds', 10, 'client-data', 10, 'client-data'],
    ['hearthCooldownSeconds', 3600, 'client-data', 3600, 'client-data'],
    ['taxiModel', 'auto', 'assumption', 'auto', 'assumption'],
    ['taxiSpeed', 32, 'era-assumed', 32, 'reported'],
    ['taxiDetourFactor', 1.4, 'assumption', 1.4, 'assumption'],
    ['taxiSpeedBonusPct', 0, 'assumption', 0, 'assumption'],
    ['transportWaitSeconds', 60, 'assumption', 60, 'assumption'],
    ['transportRideSeconds', 60, 'assumption', 60, 'assumption'],
    ['acceptSeconds', 3, 'assumption', 3, 'assumption'],
    ['acceptExtraSeconds', 2, 'assumption', 2, 'assumption'],
    ['turninSeconds', 3, 'assumption', 3, 'assumption'],
    ['rewardChoiceSeconds', 2, 'assumption', 2, 'assumption'],
    ['vendorSeconds', 10, 'assumption', 10, 'assumption'],
    ['repairSeconds', 5, 'assumption', 5, 'assumption'],
    ['trainerSeconds', 10, 'assumption', 10, 'assumption'],
    ['bindSeconds', 5, 'assumption', 5, 'assumption'],
    ['flightMasterSeconds', 3, 'assumption', 3, 'assumption'],
    ['lootSeconds', 2, 'assumption', 2, 'assumption'],
    ['objectUseSeconds', 5, 'client-data', 5, 'client-data'],
    ['skinSeconds', 2, 'client-data', 2, 'client-data'],
    ['killSeconds', 30, 'assumption', 30, 'assumption'],
    ['objectiveKillCount', 8, 'assumption', 8, 'assumption'],
    ['objectiveItemCount', 5, 'assumption', 5, 'assumption'],
    ['itemDropChance', 0.5, 'assumption', 0.5, 'assumption'],
    ['objectiveUseCount', 6, 'assumption', 6, 'assumption'],
    ['objectSearchSeconds', 15, 'assumption', 15, 'assumption'],
    ['eventObjectiveSeconds', 20, 'assumption', 20, 'assumption'],
    ['objectiveConcurrency', 0.5, 'assumption', 0.5, 'assumption'],
    ['grindWarnSeconds', 600, 'assumption', 600, 'assumption'],
    ['groupSize', 1, 'assumption', 1, 'assumption'],
    ['killXpMultiplier', 1, 'assumption', 1, 'assumption'],
  ];

  it.each(TABLE)('%s: forever-beta %j (%s), era-1.15 %j (%s)', (key, foreverValue, foreverBasis, eraValue, eraBasis) => {
    expect(FOREVER_BETA.values[key].value).toEqual(foreverValue);
    expect(FOREVER_BETA.values[key].basis).toBe(foreverBasis);
    expect(ERA_1_15.values[key].value).toEqual(eraValue);
    expect(ERA_1_15.values[key].basis).toBe(eraBasis);
  });

  it('shares the Era tables: XP-1, KXP-2, KXP-8 and COL-2', () => {
    for (const ruleset of [FOREVER_BETA, ERA_1_15]) {
      expect(ruleset.values.xpToNextLevel.value).toBe(ERA_XP_TO_NEXT_LEVEL);
      expect(ruleset.values.zeroDifference.value).toBe(ERA_ZERO_DIFFERENCE);
      expect(ruleset.values.groupXpRates.value).toBe(ERA_GROUP_XP_RATES);
      expect(ruleset.values.greenRange.value).toBe(ERA_GREEN_RANGE);
    }
  });

  it('forever-beta quest log capacity is the 70009 client constant with a launch-enforcement note (VAL-20)', () => {
    const capacity = FOREVER_BETA.values.questLogCapacity;
    expect(capacity).toMatchObject({ value: 40, basis: 'client-data', build: '1.60.1.70009' });
    expect(capacity.note).toMatch(/server enforces at launch is unknown/);
  });
});

describe('riding spells (TIME-3)', () => {
  it('holds Apprentice 33388 = tier 1 and Journeyman 33391 = tier 2 in forever-beta, none in era-1.15', () => {
    expect(FOREVER_BETA.values.ridingSpells.value).toBe(FOREVER_RIDING_SPELLS);
    expect(FOREVER_RIDING_SPELLS.map((spell) => [spell.spellId, spell.tier])).toEqual([
      [33388, 1],
      [33391, 2],
    ]);
    expect(ERA_1_15.values.ridingSpells.value).toEqual([]);
  });

  it('recognises a train step by skill or by spell id', () => {
    const spells = FOREVER_RIDING_SPELLS;
    expect(ridingSpellTier(spells, spellId(33391))).toBe(2);
    expect(ridingSpellTier(spells, spellId(6673))).toBeNull();
    expect(ridingSpellTier(spells, null)).toBeNull();
    expect(isRidingTrainStep({ skill: null, spellId: spellId(33388) }, spells)).toBe(true);
    expect(isRidingTrainStep({ skill: 'riding', spellId: null }, [])).toBe(true);
    expect(isRidingTrainStep({ skill: null, spellId: spellId(33388) }, ERA_1_15.values.ridingSpells.value)).toBe(false);
    expect(isRidingTrainStep({ skill: 'class', spellId: spellId(6673) }, spells)).toBe(false);
  });
});

describe('XP-1 table', () => {
  it('has 59 rows summing to 4,084,700 from level 1 to 60', () => {
    expect(ERA_XP_TO_NEXT_LEVEL).toHaveLength(59);
    expect(ERA_XP_TO_NEXT_LEVEL.reduce((sum, xp) => sum + xp, 0)).toBe(4_084_700);
  });

  it('matches the cumulative column at every tenth level', () => {
    const cumulative = (level: number): number => ERA_XP_TO_NEXT_LEVEL.slice(0, level - 1).reduce((sum, xp) => sum + xp, 0);
    expect([cumulative(11), cumulative(21), cumulative(31), cumulative(41), cumulative(51), cumulative(60)]).toEqual([
      35_200, 190_400, 546_400, 1_245_100, 2_453_600, 4_084_700,
    ]);
  });

  it('is reproduced by round100((8L + Diff(L)) × (45 + 5L)) with rounding to nearest (Source C)', () => {
    const diff = (level: number): number => {
      if (level <= 28) return 0;
      if (level === 29) return 1;
      if (level === 30) return 3;
      if (level === 31) return 6;
      return 5 * (level - 30);
    };
    const formula = ERA_XP_TO_NEXT_LEVEL.map((_, index) => {
      const level = index + 1;
      return Math.round(((8 * level + diff(level)) * (45 + 5 * level)) / 100) * 100;
    });
    expect(formula).toEqual(ERA_XP_TO_NEXT_LEVEL);
  });
});

describe('KXP-2 zero difference', () => {
  it.each([
    [1, 5],
    [7, 5],
    [8, 6],
    [9, 6],
    [10, 7],
    [11, 7],
    [12, 8],
    [15, 8],
    [16, 9],
    [19, 9],
    [20, 11],
    [29, 11],
    [30, 12],
    [39, 12],
    [40, 13],
    [44, 13],
    [45, 14],
    [50, 15],
    [55, 16],
    [59, 16],
    [60, 17],
  ])('level %i has ZD %i', (level, zd) => {
    expect(bandValue(ERA_ZERO_DIFFERENCE, level)).toBe(zd);
  });

  it('has no value below the first band', () => {
    expect(bandValue(ERA_ZERO_DIFFERENCE, 0)).toBeNull();
  });
});
