import type { NpcRecord } from '../domain/dataset';
import type { EffectiveRules } from '../rules/precedence';
import type { MobLevelChoice, RuleKey } from '../rules/ruleset';
import { bandValue, type LevelBand } from '../rules/tables';
import { markedKeys } from '../rules/precedence';
import { type Basis, combine, ruleInput } from './provenance';

/**
 * Kill XP (docs/SIMULATION.md KXP-1..KXP-9), the Era emulator rules. Group XP and rested XP are
 * off by default (KXP-8, KXP-9); their helpers exist for the tests and a later option. Kill XP is
 * never unknown: without a mob level the caller assumes one (KXP-4).
 */

/** KXP-1: the highest mob level that is gray (0 XP) for player level `P`. */
export function grayLevel(playerLevel: number): number {
  if (playerLevel <= 5) return 0;
  if (playerLevel <= 39) return playerLevel - 5 - Math.floor(playerLevel / 10);
  return playerLevel - 1 - Math.floor(playerLevel / 5);
}

/** KXP-2: the zero difference for player level `P`. */
export function zeroDifference(playerLevel: number, table: readonly LevelBand[]): number {
  const value = bandValue(table, playerLevel);
  if (value === null || value <= 0) throw new RangeError(`No zero difference for level ${String(playerLevel)}`);
  return value;
}

/** KXP-6: round half to even (`std::nearbyint` in the default rounding mode). */
export function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const fraction = x - floor;
  if (fraction < 0.5) return floor;
  if (fraction > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Where a mob is killed (KXP-5): a mob counts as a dungeon mob when the step is on an instance map;
 * `raid` is an instance map of a raid, where elites take the open-world multiplier (the emulators'
 * `IsNonRaidDungeon`) and `dungeonMobXpMultiplier` still applies (Milestone 6 reading of KXP-5).
 */
export type KillPlace = 'open-world' | 'dungeon' | 'raid';

export interface KillXpInput {
  readonly playerLevel: number;
  readonly mobLevel: number;
  /** Creature rank: 0 normal, 1 elite, 2 rare elite, 3 boss, 4 rare; null counts as normal. */
  readonly rank: number | null;
  readonly place: KillPlace;
}

export interface KillXpResult {
  readonly xp: number;
  readonly basis: Basis;
  readonly used: readonly RuleKey[];
}

/** Ranks that count as elite (KXP-5: rank 4, rare, is not elite). */
const isElite = (rank: number | null): boolean => rank === 1 || rank === 2 || rank === 3;

/**
 * KXP-3, KXP-5, KXP-6 for one kill, solo and without rested XP. The base uses the **player** level;
 * above the player it rises 5% per level up to +4; below, it falls linearly to 0 at the gray level.
 * Elite and dungeon multipliers follow, and the float32 product is rounded half to even, as the
 * emulators do (`Math.fround` emulates float32). 0 at or above the cap.
 */
export function killXp(input: KillXpInput, rules: EffectiveRules): KillXpResult {
  const values = rules.values;
  const { playerLevel: player, mobLevel: mob } = input;
  const read: RuleKey[] = ['killXpRounding'];
  const inputs: Basis[] = [ruleInput(values.killXpRounding)];
  const maxLevel = Math.min(values.maxLevel.value, values.xpToNextLevel.value.length + 1);
  if (player >= maxLevel) {
    return { xp: 0, basis: combine([ruleInput(values.maxLevel)]), used: markedKeys(rules, ['maxLevel']) };
  }
  const base = 5 * player + 45;
  let factor: number;
  if (mob >= player) {
    factor = Math.fround(1 + Math.fround(Math.fround(0.05) * Math.min(mob - player, 4)));
  } else if (mob > grayLevel(player)) {
    const zd = zeroDifference(player, values.zeroDifference.value);
    read.push('zeroDifference');
    inputs.push(ruleInput(values.zeroDifference));
    factor = Math.fround((zd + mob - player) / zd);
  } else {
    return { xp: 0, basis: combine(inputs), used: markedKeys(rules, read) };
  }
  let xp = Math.fround(base * factor);
  if (isElite(input.rank)) {
    const elite = input.place === 'dungeon' ? values.dungeonEliteKillXpMultiplier : values.eliteKillXpMultiplier;
    read.push(input.place === 'dungeon' ? 'dungeonEliteKillXpMultiplier' : 'eliteKillXpMultiplier');
    inputs.push(ruleInput(elite));
    xp = Math.fround(xp * Math.fround(elite.value));
  }
  if (input.place !== 'open-world') {
    read.push('dungeonMobXpMultiplier');
    inputs.push(ruleInput(values.dungeonMobXpMultiplier));
    xp = Math.fround(xp * Math.fround(values.dungeonMobXpMultiplier.value));
  }
  return { xp: roundHalfEven(xp), basis: combine(inputs), used: markedKeys(rules, read) };
}

export interface MobLevel {
  readonly level: number;
  /** True when the NPC's level range is unknown and a same-level mob was assumed (KXP-4). */
  readonly assumed: boolean;
}

/**
 * KXP-4: the level that stands for an NPC's mobs, from its level range and `mobLevelChoice`. With
 * one end of the range missing the other is used; with none (or no record), a same-level mob
 * (`fallbackLevel`, the player level) is assumed, as TIME-12 does for grind steps.
 */
export function mobLevelOf(npc: Pick<NpcRecord, 'minLevel' | 'maxLevel'> | undefined, choice: MobLevelChoice, fallbackLevel: number): MobLevel {
  const min = npc?.minLevel ?? npc?.maxLevel ?? null;
  const max = npc?.maxLevel ?? npc?.minLevel ?? null;
  if (min === null || max === null) return { level: fallbackLevel, assumed: true };
  switch (choice) {
    case 'midpoint-floor':
      return { level: Math.floor((min + max) / 2), assumed: false };
    case 'min':
      return { level: min, assumed: false };
    case 'max':
      return { level: max, assumed: false };
  }
}

/** KXP-8: the group rate for `count` eligible members (1-5 from the table, then `max(1 − 0.05 × count, 0.01)`). */
export function groupXpRate(count: number, rates: readonly number[]): number {
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`Invalid group size ${String(count)}`);
  return rates[count - 1] ?? Math.max(1 - 0.05 * count, 0.01);
}

/**
 * KXP-8 (vmangos `Group::RewardGroupAtKill`, cmangos `RewardGroupAtKill_helper`): each member's
 * share of one kill. `ng` is the highest-level member for whom the mob is not gray; its kill XP is
 * split by level share at the group rate. When the group's highest-level member is gray to the mob,
 * each member up to `ng` gets `trunc(xp × rate × level / sumLevels / 2 + 1)` instead; members above
 * `ng` get 0. The arithmetic is float32 as in vmangos (`Math.fround` at each step, as `killXp` and
 * the research reference `vectors.mjs` do). Off by default (`groupXpEnabled`); the rates are
 * guesswork by the emulators' own account.
 */
export function groupKillXpShares(memberLevels: readonly number[], mob: Omit<KillXpInput, 'playerLevel'>, rules: EffectiveRules): number[] {
  if (memberLevels.length === 0) return [];
  const sumLevels = memberLevels.reduce((sum, level) => sum + level, 0);
  const highest = Math.max(...memberLevels);
  const eligible = memberLevels.filter((level) => mob.mobLevel > grayLevel(level));
  if (eligible.length === 0) return memberLevels.map(() => 0);
  const ng = Math.max(...eligible);
  const xp = killXp({ ...mob, playerLevel: ng }, rules).xp;
  const groupRate = Math.fround(groupXpRate(memberLevels.length, rules.values.groupXpRates.value));
  return memberLevels.map((level) => {
    if (level > ng) return 0;
    const rate = Math.fround(Math.fround(groupRate * level) / sumLevels);
    const share = Math.fround(xp * rate);
    return Math.trunc(highest === ng ? share : Math.fround(Math.fround(share / 2) + 1));
  });
}

/**
 * KXP-9 (off by default): the rested bonus of one kill, `min(R, xp)`, and the pool left. Quest XP
 * never gets a rested bonus.
 */
export function restedKillBonus(killXpValue: number, restedPool: number): { readonly bonus: number; readonly pool: number } {
  const bonus = Math.max(0, Math.min(restedPool, killXpValue));
  return { bonus, pool: restedPool - bonus };
}

/** KXP-9: the rested pool cap, `0.75 × xpToNext(L)` (displayed as 1.5 levels). */
export function restedPoolCap(xpToNextLevel: number): number {
  return 0.75 * xpToNextLevel;
}
