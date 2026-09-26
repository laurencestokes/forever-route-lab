/**
 * Tables the rulesets carry (docs/SIMULATION.md XP-1, KXP-2). Each is the Era rule; the rulesets
 * say which basis it has in each profile (`era-assumed` in `forever-beta`, `reported` in
 * `era-1.15`).
 */

/**
 * XP-1: XP from level L to L + 1, for L = 1..59 (index L - 1). Three sources agree exactly
 * (cmangos-classic `player_xp_for_level` [E3], warcraft.wiki.gg [W1], and
 * `round100((8L + Diff(L)) x (45 + 5L))`). Total from 1 to 60: 4,084,700. There is no entry for
 * level 60: XP stops at the cap (XP-2).
 */
export const ERA_XP_TO_NEXT_LEVEL: readonly number[] = [
  400, 900, 1400, 2100, 2800, 3600, 4500, 5400, 6500, 7600, //  1-10
  8800, 10100, 11400, 12900, 14400, 16000, 17700, 19400, 21300, 23200, // 11-20
  25200, 27300, 29400, 31700, 34000, 36400, 38900, 41400, 44300, 47400, // 21-30
  50800, 54500, 58600, 62800, 67100, 71600, 76100, 80800, 85700, 90700, // 31-40
  95800, 101000, 106300, 111800, 117500, 123200, 129100, 135100, 141200, 147500, // 41-50
  153900, 160400, 167100, 173900, 180800, 187900, 195000, 202300, 209800, // 51-59
];

/** One band of a level-indexed table: from `fromLevel` (inclusive) up to the next band. */
export interface LevelBand {
  readonly fromLevel: number;
  readonly value: number;
}

/**
 * KXP-2: the "zero difference" by player level (vmangos Formulas.h:59-73, cmangos
 * Formulas.h:330-344 and warcraft.wiki.gg "Mob experience" [W2] agree). Bands ascend from level 1.
 */
export const ERA_ZERO_DIFFERENCE: readonly LevelBand[] = [
  { fromLevel: 1, value: 5 },
  { fromLevel: 8, value: 6 },
  { fromLevel: 10, value: 7 },
  { fromLevel: 12, value: 8 },
  { fromLevel: 16, value: 9 },
  { fromLevel: 20, value: 11 },
  { fromLevel: 30, value: 12 },
  { fromLevel: 40, value: 13 },
  { fromLevel: 45, value: 14 },
  { fromLevel: 50, value: 15 },
  { fromLevel: 55, value: 16 },
  { fromLevel: 60, value: 17 },
];

/**
 * KXP-8: the emulators' group XP rate for 1-5 eligible members (index = members - 1). Beyond 5
 * the rate is `max(1 - 0.05 x count, 0.01)`. The emulator comment calls the formula "completely
 * guesswork" (vmangos Formulas.h:160).
 */
export const ERA_GROUP_XP_RATES: readonly number[] = [1.0, 1.0, 1.166, 1.3, 1.4];

/** The value of the last band at or below `level`, or null when `level` is below the first band. */
export function bandValue(bands: readonly LevelBand[], level: number): number | null {
  let value: number | null = null;
  for (const band of bands) {
    if (band.fromLevel > level) break;
    value = band.value;
  }
  return value;
}
