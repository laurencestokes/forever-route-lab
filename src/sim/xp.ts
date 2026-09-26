import type { GrindTarget } from '../domain/route';
import type { EffectiveRules } from '../rules/precedence';
import { type Basis, combine, ruleInput } from './provenance';

/**
 * Levels and XP (docs/SIMULATION.md XP-1..XP-4). The state is `(level, xp)`, where `xp` is the XP
 * into the current level, never a float total (XP-2). While `unknownXpEvents > 0` both are the
 * known-XP lower bound (XP-4); the walker keeps that count, these functions only do arithmetic.
 */

export interface XpCurve {
  /** The effective cap: `min(maxLevel, xpToNextLevel.length + 1)`. */
  readonly maxLevel: number;
  /** Index L - 1: the XP from level L to L + 1. */
  readonly toNext: readonly number[];
  /** Index L - 1: the total XP at 0 XP into level L, for L = 1..toNext.length + 1. */
  readonly cumulative: readonly number[];
  /** The provenance of the table (`era-assumed` in `forever-beta`). */
  readonly basis: Basis;
}

export interface XpState {
  readonly level: number;
  /** XP into `level`. */
  readonly xp: number;
}

export interface XpGrant extends XpState {
  /** XP actually added (0 at the cap). */
  readonly granted: number;
  /** XP lost to the cap (XP-2: at the cap XP stays 0). */
  readonly discarded: number;
  readonly levelsGained: number;
}

function assertLevel(level: number, max: number): void {
  if (!Number.isInteger(level) || level < 1 || level > max) {
    throw new RangeError(`Invalid level ${String(level)}: expected an integer from 1 to ${String(max)}`);
  }
}

function assertXp(name: string, xp: number): void {
  if (!Number.isFinite(xp) || xp < 0) throw new RangeError(`Invalid ${name} ${String(xp)}: expected a finite number >= 0`);
}

/** A curve from an XP-to-next table and a level cap. */
export function xpCurve(toNext: readonly number[], maxLevel: number, basis: Basis = { basis: 'source', eraFallback: false }): XpCurve {
  if (!Number.isInteger(maxLevel) || maxLevel < 1) throw new RangeError(`Invalid maxLevel ${String(maxLevel)}: expected an integer >= 1`);
  const cumulative = [0];
  let total = 0;
  for (const [index, xp] of toNext.entries()) {
    if (!Number.isInteger(xp) || xp <= 0) throw new RangeError(`Invalid XP to level ${String(index + 2)}: ${String(xp)}`);
    total += xp;
    cumulative.push(total);
  }
  return { maxLevel: Math.min(maxLevel, toNext.length + 1), toNext, cumulative, basis };
}

/** The curve of the effective rules: `xpToNextLevel` capped at `maxLevel`. */
export function xpCurveOf(rules: EffectiveRules): XpCurve {
  const { xpToNextLevel, maxLevel } = rules.values;
  return xpCurve(xpToNextLevel.value, maxLevel.value, combine([ruleInput(xpToNextLevel)], false));
}

/** XP from `level` to the next, or null at or above the cap (XP-2). */
export function xpToNext(curve: XpCurve, level: number): number | null {
  if (level >= curve.maxLevel) return null;
  return curve.toNext[level - 1] ?? null;
}

/** `cumulative(L)`: the total XP at 0 XP into `level` (XP-1). */
export function cumulativeXp(curve: XpCurve, level: number): number {
  assertLevel(level, curve.cumulative.length);
  return curve.cumulative[level - 1] ?? 0;
}

/** The total XP of a state. */
export function totalXp(curve: XpCurve, state: XpState): number {
  assertXp('xp', state.xp);
  return cumulativeXp(curve, state.level) + state.xp;
}

/** The state at a total XP, capped: at the cap the XP into the level is 0 (XP-2). */
export function stateAtTotal(curve: XpCurve, total: number): XpState {
  assertXp('total XP', total);
  const capTotal = cumulativeXp(curve, curve.maxLevel);
  if (total >= capTotal) return { level: curve.maxLevel, xp: 0 };
  let level = 1;
  while (level + 1 < curve.maxLevel && (curve.cumulative[level] ?? Number.POSITIVE_INFINITY) <= total) level += 1;
  return { level, xp: total - cumulativeXp(curve, level) };
}

/**
 * XP-2: adds `amount` to a state. One grant can cross several levels; the excess carries over. At
 * or above the cap nothing is added; reaching the cap discards the rest.
 */
export function grantXp(curve: XpCurve, state: XpState, amount: number): XpGrant {
  assertXp('XP amount', amount);
  if (state.level >= curve.maxLevel) return { level: state.level, xp: state.xp, granted: 0, discarded: amount, levelsGained: 0 };
  const before = totalXp(curve, state);
  const capTotal = cumulativeXp(curve, curve.maxLevel);
  const after = Math.min(before + amount, capTotal);
  const next = stateAtTotal(curve, after);
  return { ...next, granted: after - before, discarded: before + amount - after, levelsGained: next.level - state.level };
}

/**
 * TIME-12: a level target as a cumulative XP total `T`, or null when the level is beyond the
 * table. `xpShort` counts back from `cumulative(L)`, `xpInto` forward, `fraction` adds
 * `ceil(F × xpToNext(L))`; a negative total counts as 0. Whether `T` is reachable under the cap is
 * the caller's check (`T > cumulative(maxLevel)` is unreachable).
 */
export function grindTargetTotal(curve: XpCurve, target: Extract<GrindTarget, { kind: 'level' }>): number | null {
  const level = Math.max(1, target.level);
  if (!Number.isInteger(level)) throw new RangeError(`Invalid grind target level ${String(target.level)}: expected an integer`);
  if (level > curve.cumulative.length) return null;
  const base = cumulativeXp(curve, level);
  const offset = target.offset;
  if (offset === null) return base;
  switch (offset.kind) {
    case 'xpInto':
      return Math.max(0, base + offset.xp);
    case 'xpShort':
      return Math.max(0, base - offset.xp);
    case 'fraction': {
      const span = curve.toNext[level - 1];
      if (span === undefined) return offset.fraction > 0 ? null : base;
      // The smallest XP at which the fraction is reached (INFERRED). The epsilon absorbs float noise
      // above an integer product, such as 0.07 × 100 = 7.000000000000001.
      return Math.max(0, base + Math.ceil(offset.fraction * span - 1e-9));
    }
  }
}
