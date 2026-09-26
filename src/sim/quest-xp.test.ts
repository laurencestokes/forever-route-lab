import { describe, expect, it } from 'vitest';
import type { QuestXp } from '../domain/dataset';
import { questId } from '../domain/ids';
import { effectiveRules } from '../rules/precedence';
import { ERA_1_15, FOREVER_BETA, type QuestXpRounding } from '../rules/ruleset';
import { floorProduct, type QuestXpInput, questXp, reduceQuestXp, roundXpValue } from './quest-xp';

const forever = effectiveRules(FOREVER_BETA);
const withRounding = (rounding: QuestXpRounding) => ({
  ...forever,
  values: { ...forever.values, questXpRounding: { ...forever.values.questXpRounding, value: rounding } },
});

const input = (baseXp: number | null, questLevel: number, playerLevel: number, basis: QuestXp['basis'] = 'era-seed', dungeonQuest = false): QuestXpInput => ({
  questId: questId(100),
  xp: baseXp === null ? null : { questLevel, baseXp, basis },
  requiredLevel: null,
  dungeonQuest,
  playerLevel,
});

describe('RoundXPValue (QXP-4)', () => {
  it.each([
    [2, 0],
    [3, 5],
    [87, 85],
    [88, 90],
    [100, 100],
    [101, 100],
    [104, 100],
    [105, 110],
    [495, 500],
    [512, 500],
    [513, 525],
    [1024, 1000],
    [1025, 1050],
    [2449, 2450],
  ])('%i → %i', (x, rounded) => {
    expect(roundXpValue(x)).toBe(rounded);
  });
});

/** QXP-T: [B, Q, P, trinity-steps, vmangos-ceil]. */
const QXP_T: readonly (readonly [number, number, number, number, number])[] = [
  [1000, 20, 18, 1000, 1000],
  [1000, 20, 20, 1000, 1000],
  [1000, 20, 25, 1000, 1000],
  [1000, 20, 26, 800, 800],
  [1000, 20, 27, 600, 600],
  [1000, 20, 28, 400, 400],
  [1000, 20, 29, 200, 200],
  [1000, 20, 30, 100, 100],
  [1000, 20, 45, 100, 100],
  [335, 5, 5, 340, 335],
  [840, 10, 10, 850, 840],
  [910, 12, 12, 900, 910],
  [980, 13, 19, 775, 784],
  [335, 5, 12, 200, 202],
  [2450, 30, 36, 1950, 1960],
  [85, 10, 16, 70, 68],
  [4400, 48, 58, 440, 440],
  [6600, 60, 59, 6600, 6600],
  [6600, 60, 60, 0, 0],
];

describe('QXP-T vectors (default ruleset; both rounding variants)', () => {
  it.each(QXP_T)('B %i, Q %i, P %i → %i (trinity-steps), %i (vmangos-ceil)', (base, quest, player, trinity, vmangos) => {
    expect(questXp(input(base, quest, player), withRounding('trinity-steps')).xp.value).toBe(trinity);
    expect(questXp(input(base, quest, player), withRounding('vmangos-ceil')).xp.value).toBe(vmangos);
  });

  it('reduces by 100/80/60/40/20/10 percent', () => {
    expect([18, 25, 26, 27, 28, 29, 30, 45].map((player) => questXp(input(1000, 20, player), forever).percent)).toEqual([
      100, 100, 80, 60, 40, 20, 10, 10,
    ]);
  });

  it('at the cap gives 0 and says so (QXP-6)', () => {
    const capped = questXp(input(6600, 60, 60), forever);
    expect(capped).toMatchObject({ atCap: true, xp: { value: 0, basis: 'derived' }, facts: [] });
  });

  it('agrees with the Questie unit test: {20, 1000} at P = 27 gives 600', () => {
    expect(reduceQuestXp(1000, 6, 'trinity-steps')).toBe(600);
  });
});

describe('QXP-T2 multiplier and basis vectors (trinity-steps)', () => {
  const multipliers = (open: number, dungeon: number) => effectiveRules(FOREVER_BETA, { questXpMultiplier: open, dungeonQuestXpMultiplier: dungeon });

  it('1000, Q20, P20, era-seed, open world, 2.0 → 2000', () => {
    expect(questXp(input(1000, 20, 20), multipliers(2, 1)).xp.value).toBe(2000);
  });

  it('335, Q5, P5, era-seed, 1.5 → floor(340 × 1.5) = 510', () => {
    expect(questXp(input(335, 5, 5), multipliers(1.5, 1)).xp.value).toBe(510);
  });

  it('2450, Q30, P30, era-seed dungeon quest, 2.0 / 3.0 → 7350', () => {
    expect(questXp(input(2450, 30, 30, 'era-seed', true), multipliers(2, 3)).xp.value).toBe(7350);
  });

  it('1234, Q20, P20, user → 1234 as entered, no multiplier', () => {
    expect(questXp(input(1234, 20, 20, 'user'), multipliers(2, 1)).xp).toEqual({ value: 1234, basis: 'assumption', eraFallback: false });
  });

  it('1234, Q20, P26, user → RoundXPValue(987) = 975, whatever the multiplier', () => {
    expect(questXp(input(1234, 20, 26, 'user'), multipliers(2, 1)).xp.value).toBe(975);
    expect(questXp(input(1234, 20, 26, 'user'), multipliers(7, 9)).xp.value).toBe(975);
  });

  it('no record → unknown, never 0, with an unknown-xp fact (SIM-1)', () => {
    const result = questXp(input(null, 20, 20), forever);
    expect(result.xp).toEqual({ value: null, basis: 'unknown', eraFallback: false });
    expect(result.facts).toEqual([{ kind: 'unknown-xp', questId: 100, reason: 'no-record' }]);
  });

  it('floors the multiplied XP exactly, not the float product: 45 × 1.4 = 63, 100 × 1.15 = 115 (QXP-3)', () => {
    expect(questXp(input(45, 10, 10), multipliers(1.4, 1)).xp.value).toBe(63);
    expect(questXp(input(100, 10, 10), multipliers(1.15, 1)).xp.value).toBe(115);
    expect(questXp(input(50, 10, 10), multipliers(2.3, 1)).xp.value).toBe(115);
    expect(questXp(input(90, 10, 10), multipliers(0.7, 1)).xp.value).toBe(63);
    expect(questXp(input(100, 10, 10, 'era-seed', true), multipliers(1, 1.15)).xp.value).toBe(115);
    // A product that is not an integer still floors down.
    expect(questXp(input(45, 10, 10), multipliers(1.39, 1)).xp.value).toBe(62);
  });

  it('floors exactly for every reduced value 5..20,000 and the common decimal multipliers', () => {
    for (const m of [0.7, 1.15, 1.4, 2.3, 2.8]) {
      const tenths = Math.round(m * 100);
      for (let x = 5; x <= 20000; x += 5) expect(floorProduct(x, m), `${String(x)} × ${String(m)}`).toBe(Math.floor((x * tenths) / 100));
    }
  });
});

describe('QXP-7 edge cases', () => {
  it.each([0, -2, -10])('quest level %i → unknown XP', (level) => {
    const result = questXp(input(500, level, 10), forever);
    expect(result.xp.value).toBeNull();
    expect(result.facts).toEqual([{ kind: 'unknown-xp', questId: 100, reason: 'unknown-level' }]);
  });

  it('scaling quest (level -1): effective level max(requiredLevel, P), so never reduced', () => {
    const result = questXp({ ...input(1000, -1, 30), requiredLevel: 12 }, forever);
    expect(result).toMatchObject({ questLevel: 30, percent: 100, xp: { value: 1000 } });
    expect(questXp({ ...input(1000, -1, 3), requiredLevel: 12 }, forever).questLevel).toBe(12);
  });

  it('a zero base XP is a real zero', () => {
    expect(questXp(input(0, 20, 20), forever).xp).toMatchObject({ value: 0, basis: 'assumption' });
  });

  it('refuses a negative base XP', () => {
    expect(() => questXp(input(-1, 20, 20), forever)).toThrow(RangeError);
  });
});

describe('quest XP provenance (SIMULATION §8)', () => {
  it('era-seed is assumption with the Era fallback in forever-beta, derived in era-1.15', () => {
    expect(questXp(input(840, 10, 10), forever)).toMatchObject({
      xp: { value: 850, basis: 'assumption', eraFallback: true },
      used: ['questXpRounding', 'questXpMultiplier'],
    });
    expect(questXp(input(840, 10, 10), effectiveRules(ERA_1_15))).toMatchObject({
      xp: { value: 850, basis: 'derived', eraFallback: false },
      used: [],
    });
    expect(questXp(input(840, 10, 10, 'era-seed', true), forever).used).toEqual(['questXpRounding', 'dungeonQuestXpMultiplier']);
  });

  it('forever-observed is source at 100% and derived (with the rounding fallback) when reduced', () => {
    expect(questXp(input(1234, 20, 20, 'forever-observed'), forever).xp).toEqual({ value: 1234, basis: 'source', eraFallback: false });
    expect(questXp(input(1234, 20, 26, 'forever-observed'), forever).xp).toEqual({ value: 975, basis: 'derived', eraFallback: true });
    expect(questXp(input(1234, 20, 26, 'forever-observed'), effectiveRules(ERA_1_15)).xp).toEqual({ value: 975, basis: 'derived', eraFallback: false });
  });

  it('at the cap a missing record or an unknown quest level is a known 0, not unknown XP (XP-2 before XP-4)', () => {
    const beta = effectiveRules(FOREVER_BETA, { maxLevel: 20 });
    expect(questXp(input(null, 20, 20), beta)).toMatchObject({ atCap: true, xp: { value: 0, basis: 'assumption' }, used: ['maxLevel'], facts: [] });
    expect(questXp(input(500, 0, 20), beta)).toMatchObject({ atCap: true, xp: { value: 0 }, questLevel: null, facts: [] });
    expect(questXp(input(null, 60, 60), forever)).toMatchObject({ atCap: true, xp: { value: 0, basis: 'derived' }, facts: [] });
    expect(questXp(input(null, 20, 19), beta).xp.value).toBeNull();
  });

  it('the cap under a project maxLevel is an assumption (TIME-T 22)', () => {
    const beta = effectiveRules(FOREVER_BETA, { maxLevel: 20 });
    expect(beta.values.maxLevel).toMatchObject({ value: 20, basis: 'assumption', source: 'project' });
    expect(questXp(input(1000, 20, 20), beta)).toMatchObject({ atCap: true, xp: { value: 0, basis: 'assumption' }, used: ['maxLevel'] });
    expect(questXp(input(1000, 20, 19), beta).xp.value).toBe(1000);
  });
});
