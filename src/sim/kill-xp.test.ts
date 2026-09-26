import { describe, expect, it } from 'vitest';
import { effectiveRules } from '../rules/precedence';
import { ERA_1_15, FOREVER_BETA } from '../rules/ruleset';
import { ERA_ZERO_DIFFERENCE } from '../rules/tables';
import { grayLevel, groupKillXpShares, groupXpRate, killXp, mobLevelOf, restedKillBonus, restedPoolCap, roundHalfEven, zeroDifference } from './kill-xp';

const forever = effectiveRules(FOREVER_BETA);

/** KXP-7: [P, M, kind, grayLevel(P), xp]. */
const KXP_7: readonly (readonly [number, number, 'normal' | 'elite, world' | 'elite, 5-player dungeon', number, number])[] = [
  [1, 1, 'normal', 0, 50],
  [5, 7, 'normal', 0, 77],
  [10, 10, 'normal', 4, 95],
  [10, 12, 'normal', 4, 104],
  [10, 14, 'normal', 4, 114],
  [10, 20, 'normal', 4, 114],
  [10, 9, 'normal', 4, 81],
  [10, 5, 'normal', 4, 27],
  [10, 4, 'normal', 4, 0],
  [20, 20, 'normal', 13, 145],
  [20, 15, 'normal', 13, 79],
  [20, 14, 'normal', 13, 66],
  [20, 13, 'normal', 13, 0],
  [20, 20, 'elite, world', 13, 290],
  [20, 20, 'elite, 5-player dungeon', 13, 362],
  [40, 35, 'normal', 31, 151],
  [40, 31, 'normal', 31, 0],
  [59, 60, 'normal', 47, 357],
  [59, 48, 'normal', 47, 106],
  [59, 47, 'normal', 47, 0],
  [60, 60, 'normal', 47, 0],
];

describe('KXP-7 kill-XP vectors (solo, no rested)', () => {
  it.each(KXP_7)('P %i, M %i, %s: gray level %i, %i XP', (player, mob, kind, gray, xp) => {
    expect(grayLevel(player)).toBe(gray);
    const rank = kind === 'normal' ? 0 : 1;
    const place = kind === 'elite, 5-player dungeon' ? 'dungeon' : 'open-world';
    expect(killXp({ playerLevel: player, mobLevel: mob, rank, place }, forever).xp).toBe(xp);
  });

  it('rounds the two .5 ties half to even: 104.5 → 104, 362.5 → 362', () => {
    expect(roundHalfEven(104.5)).toBe(104);
    expect(roundHalfEven(362.5)).toBe(362);
    expect(roundHalfEven(105.5)).toBe(106);
    expect(roundHalfEven(81.43)).toBe(81);
    expect(roundHalfEven(65.9)).toBe(66);
  });
});

describe('KXP-1 gray level boundaries', () => {
  it.each([
    [5, 0],
    [6, 1],
    [10, 4],
    [39, 31],
    [40, 31],
    [59, 47],
  ])('P %i: gray at M <= %i', (player, gray) => {
    expect(grayLevel(player)).toBe(gray);
    if (player < 60) {
      expect(killXp({ playerLevel: player, mobLevel: gray, rank: 0, place: 'open-world' }, forever).xp).toBe(0);
      expect(killXp({ playerLevel: player, mobLevel: gray + 1, rank: 0, place: 'open-world' }, forever).xp).toBeGreaterThan(0);
    }
  });

  it('equals P − greenRange(P) − 1 for every P from 5 to 59 (COL-2)', () => {
    const green = (level: number): number => (level < 10 ? 4 : level < 20 ? 5 : level < 30 ? 6 : level < 40 ? 7 : level < 45 ? 8 : level < 50 ? 9 : level < 55 ? 10 : 11);
    for (let level = 5; level <= 59; level += 1) expect(grayLevel(level)).toBe(level - green(level) - 1);
  });
});

describe('kill XP details', () => {
  it('a rare (rank 4) is not elite; ranks 1-3 are', () => {
    expect(killXp({ playerLevel: 20, mobLevel: 20, rank: 4, place: 'open-world' }, forever).xp).toBe(145);
    expect(killXp({ playerLevel: 20, mobLevel: 20, rank: 3, place: 'open-world' }, forever).xp).toBe(290);
    expect(killXp({ playerLevel: 20, mobLevel: 20, rank: null, place: 'open-world' }, forever).xp).toBe(145);
  });

  it('applies dungeonMobXpMultiplier to dungeon mobs (reported far lower in Forever)', () => {
    const lowered = effectiveRules(FOREVER_BETA);
    const rules = { ...lowered, values: { ...lowered.values, dungeonMobXpMultiplier: { ...lowered.values.dungeonMobXpMultiplier, value: 0.1 } } };
    expect(killXp({ playerLevel: 20, mobLevel: 20, rank: 0, place: 'dungeon' }, rules).xp).toBe(14);
    expect(killXp({ playerLevel: 20, mobLevel: 20, rank: 0, place: 'open-world' }, rules).xp).toBe(145);
    // A raid is an instance map too: its mobs are dungeon mobs.
    expect(killXp({ playerLevel: 20, mobLevel: 20, rank: 0, place: 'raid' }, rules).xp).toBe(14);
  });

  it('raid elites take the open-world elite multiplier; only non-raid dungeons use ×2.5 (KXP-5)', () => {
    expect(killXp({ playerLevel: 20, mobLevel: 20, rank: 1, place: 'raid' }, forever)).toMatchObject({
      xp: 290,
      used: ['killXpRounding', 'eliteKillXpMultiplier', 'dungeonMobXpMultiplier'],
    });
    expect(killXp({ playerLevel: 20, mobLevel: 20, rank: 1, place: 'dungeon' }, forever)).toMatchObject({
      xp: 362,
      used: ['killXpRounding', 'dungeonEliteKillXpMultiplier', 'dungeonMobXpMultiplier'],
    });
  });

  it('carries the Era fallback in forever-beta and lists the assumed keys read', () => {
    expect(killXp({ playerLevel: 10, mobLevel: 9, rank: 0, place: 'open-world' }, forever)).toEqual({
      xp: 81,
      basis: { basis: 'derived', eraFallback: true },
      used: ['killXpRounding', 'zeroDifference'],
    });
    expect(killXp({ playerLevel: 10, mobLevel: 9, rank: 0, place: 'open-world' }, effectiveRules(ERA_1_15)).basis).toEqual({
      basis: 'derived',
      eraFallback: false,
    });
    expect(killXp({ playerLevel: 20, mobLevel: 20, rank: 1, place: 'dungeon' }, forever).used).toEqual([
      'killXpRounding',
      'dungeonEliteKillXpMultiplier',
      'dungeonMobXpMultiplier',
    ]);
  });

  it('gives 0 at a lowered cap', () => {
    const beta = effectiveRules(FOREVER_BETA, { maxLevel: 20 });
    expect(killXp({ playerLevel: 20, mobLevel: 20, rank: 0, place: 'open-world' }, beta)).toMatchObject({ xp: 0, basis: { basis: 'assumption' } });
  });

  it('has the zero difference of KXP-2 and none below level 1', () => {
    expect(zeroDifference(10, ERA_ZERO_DIFFERENCE)).toBe(7);
    expect(() => zeroDifference(0, ERA_ZERO_DIFFERENCE)).toThrow(RangeError);
  });
});

describe('mob level choice (KXP-4)', () => {
  it('uses the midpoint rounded down by default, or an end of the range', () => {
    expect(mobLevelOf({ minLevel: 10, maxLevel: 13 }, 'midpoint-floor', 5)).toEqual({ level: 11, assumed: false });
    expect(mobLevelOf({ minLevel: 10, maxLevel: 13 }, 'min', 5)).toEqual({ level: 10, assumed: false });
    expect(mobLevelOf({ minLevel: 10, maxLevel: 13 }, 'max', 5)).toEqual({ level: 13, assumed: false });
    expect(mobLevelOf({ minLevel: null, maxLevel: 13 }, 'midpoint-floor', 5)).toEqual({ level: 13, assumed: false });
  });

  it('assumes a same-level mob when the range is unknown', () => {
    expect(mobLevelOf({ minLevel: null, maxLevel: null }, 'midpoint-floor', 7)).toEqual({ level: 7, assumed: true });
    expect(mobLevelOf(undefined, 'max', 7)).toEqual({ level: 7, assumed: true });
  });
});

describe('group XP (KXP-8; off by default)', () => {
  it('is off in both rulesets', () => {
    expect(forever.values.groupXpEnabled.value).toBe(false);
    expect(effectiveRules(ERA_1_15).values.groupXpEnabled.value).toBe(false);
  });

  it.each([
    [[20, 20], 20, [72, 72]],
    [[20, 20, 20], 20, [56, 56, 56]],
    [[20, 20, 20, 20], 20, [47, 47, 47, 47]],
    [[20, 20, 20, 20, 20], 20, [40, 40, 40, 40, 40]],
    [[20, 30], 25, [45, 68]],
    [[10, 30], 12, [14, 0]],
  ])('levels %j, mob %i → %j', (levels, mob, shares) => {
    expect(groupKillXpShares(levels, { mobLevel: mob, rank: 0, place: 'open-world' }, forever)).toEqual(shares);
  });

  it('computes in float32 as vmangos and the research reference do (review SIM-12)', () => {
    expect(groupKillXpShares([7, 39], { mobLevel: 10, rank: 0, place: 'open-world' }, forever)).toEqual([7, 0]);
    expect(groupKillXpShares([28, 48], { mobLevel: 52, rank: 0, place: 'open-world' }, forever)).toEqual([126, 215]);
    expect(groupKillXpShares([22, 50], { mobLevel: 52, rank: 0, place: 'open-world' }, forever)).toEqual([99, 224]);
  });

  it('beyond five members the rate is max(1 − 0.05 × count, 0.01)', () => {
    expect(groupXpRate(6, forever.values.groupXpRates.value)).toBeCloseTo(0.7);
    expect(groupXpRate(40, forever.values.groupXpRates.value)).toBeCloseTo(0.01);
    expect(groupKillXpShares([], { mobLevel: 20, rank: 0, place: 'open-world' }, forever)).toEqual([]);
    expect(groupKillXpShares([30], { mobLevel: 12, rank: 0, place: 'open-world' }, forever)).toEqual([0]);
  });
});

describe('rested XP (KXP-9; off by default)', () => {
  it('P = 10: the pool caps at 5,700; a 95 XP kill with R = 5,700 gives 190 XP and leaves 5,605', () => {
    expect(restedPoolCap(7600)).toBe(5700);
    const { bonus, pool } = restedKillBonus(95, 5700);
    expect(95 + bonus).toBe(190);
    expect(pool).toBe(5605);
    expect(restedKillBonus(95, 40)).toEqual({ bonus: 40, pool: 0 });
    expect(forever.values.restedEnabled.value).toBe(false);
  });
});
