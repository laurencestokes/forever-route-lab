import { describe, expect, it } from 'vitest';
import { effectiveRules } from '../rules/precedence';
import { ERA_1_15, FOREVER_BETA } from '../rules/ruleset';
import { ERA_XP_TO_NEXT_LEVEL } from '../rules/tables';
import { cumulativeXp, grantXp, grindTargetTotal, stateAtTotal, totalXp, xpCurve, xpCurveOf, xpToNext } from './xp';

const curve = xpCurveOf(effectiveRules(FOREVER_BETA));

describe('XP curve (XP-1)', () => {
  it('totals 4,084,700 from level 1 to 60, with the cumulative column of XP-1', () => {
    expect(cumulativeXp(curve, 60)).toBe(4_084_700);
    expect(cumulativeXp(curve, 1)).toBe(0);
    expect(cumulativeXp(curve, 10)).toBe(27_600);
    expect(cumulativeXp(curve, 20)).toBe(167_200);
    expect(cumulativeXp(curve, 41)).toBe(1_245_100);
  });

  it('gives xpToNext for levels below the cap and null at it', () => {
    expect(xpToNext(curve, 1)).toBe(400);
    expect(xpToNext(curve, 59)).toBe(209_800);
    expect(xpToNext(curve, 60)).toBeNull();
  });

  it('carries the table provenance: era-assumed in forever-beta, reported in era-1.15', () => {
    expect(curve.basis).toEqual({ basis: 'source', eraFallback: true });
    expect(xpCurveOf(effectiveRules(ERA_1_15)).basis).toEqual({ basis: 'source', eraFallback: false });
  });

  it('caps at min(maxLevel, table length + 1)', () => {
    expect(xpCurveOf(effectiveRules(FOREVER_BETA, { maxLevel: 20 })).maxLevel).toBe(20);
    expect(xpCurveOf(effectiveRules(FOREVER_BETA, { maxLevel: 70 })).maxLevel).toBe(60);
    expect(xpToNext(xpCurveOf(effectiveRules(FOREVER_BETA, { maxLevel: 20 })), 20)).toBeNull();
  });

  it('refuses a malformed table or cap', () => {
    expect(() => xpCurve([400, 0], 60)).toThrow(RangeError);
    expect(() => xpCurve(ERA_XP_TO_NEXT_LEVEL, 0)).toThrow(RangeError);
    expect(() => cumulativeXp(curve, 61)).toThrow(RangeError);
  });
});

describe('level-ups (XP-2)', () => {
  it('P=9 with 6,000/6,500 XP + 1,000 XP gives level 10 with 500/7,600 (SIMULATION §9)', () => {
    expect(grantXp(curve, { level: 9, xp: 6000 }, 1000)).toEqual({ level: 10, xp: 500, granted: 1000, discarded: 0, levelsGained: 1 });
  });

  it('crosses several levels in one grant and carries the excess', () => {
    expect(grantXp(curve, { level: 1, xp: 0 }, 5000)).toEqual({ level: 5, xp: 200, granted: 5000, discarded: 0, levelsGained: 4 });
  });

  it('discards the excess at the cap and grants nothing at or above it', () => {
    expect(grantXp(curve, { level: 59, xp: 209_000 }, 1000)).toEqual({ level: 60, xp: 0, granted: 800, discarded: 200, levelsGained: 1 });
    expect(grantXp(curve, { level: 60, xp: 0 }, 1000)).toEqual({ level: 60, xp: 0, granted: 0, discarded: 1000, levelsGained: 0 });
    const beta = xpCurveOf(effectiveRules(FOREVER_BETA, { maxLevel: 20 }));
    expect(grantXp(beta, { level: 19, xp: 21_000 }, 1000)).toMatchObject({ level: 20, xp: 0, granted: 300, discarded: 700 });
    // A character already above a lowered cap keeps its level and gains nothing.
    expect(grantXp(beta, { level: 25, xp: 10 }, 1000)).toMatchObject({ level: 25, xp: 10, granted: 0 });
  });

  it('normalises an XP value past the level end', () => {
    expect(stateAtTotal(curve, totalXp(curve, { level: 2, xp: 1000 }))).toEqual({ level: 3, xp: 100 });
  });
});

describe('grind targets (TIME-12 offsets)', () => {
  it.each([
    [{ kind: 'level' as const, level: 10, offset: null }, 27_600],
    [{ kind: 'level' as const, level: 10, offset: { kind: 'xpShort' as const, xp: 300 } }, 27_300],
    [{ kind: 'level' as const, level: 10, offset: { kind: 'fraction' as const, fraction: 0.5 } }, 31_400],
    [{ kind: 'level' as const, level: 9, offset: { kind: 'xpInto' as const, xp: 9000 } }, 21_100 + 9000],
    [{ kind: 'level' as const, level: 1, offset: { kind: 'xpShort' as const, xp: 50 } }, 0],
    [{ kind: 'level' as const, level: 60, offset: { kind: 'xpInto' as const, xp: 1 } }, 4_084_701],
  ])('%j resolves to %i', (target, total) => {
    expect(grindTargetTotal(curve, target)).toBe(total);
  });

  it('takes the smallest XP at which a fraction is reached, without float noise', () => {
    expect(grindTargetTotal(curve, { kind: 'level', level: 2, offset: { kind: 'fraction', fraction: 0.07 } })).toBe(400 + 63);
    const hundred = xpCurve([100, 100], 3);
    expect(grindTargetTotal(hundred, { kind: 'level', level: 2, offset: { kind: 'fraction', fraction: 0.07 } })).toBe(107);
  });

  it('cannot resolve a level beyond the table', () => {
    expect(grindTargetTotal(curve, { kind: 'level', level: 61, offset: null })).toBeNull();
    expect(grindTargetTotal(curve, { kind: 'level', level: 60, offset: { kind: 'fraction', fraction: 0.5 } })).toBeNull();
  });
});
