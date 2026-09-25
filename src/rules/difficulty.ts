/**
 * Quest difficulty colour (docs/SIMULATION.md §5). Display only: colour never gates availability
 * (VAL-4), and it is computed on the lower-bound level while XP is uncertain.
 *
 * The thresholds are the Era client's (COL-1). Forever's are unknown (COL-4): its quest log asks a
 * C API, and its Lua fallback puts yellow at -4 instead of -2. The ruleset values
 * `difficultyYellowLowerBound` and `greenRange` (SIMULATION §1.2) are passed through `opts`.
 */
export type Difficulty = 'trivial' | 'standard' | 'difficult' | 'verydifficult' | 'impossible';

export const DIFFICULTIES: readonly Difficulty[] = ['trivial', 'standard', 'difficult', 'verydifficult', 'impossible'];

/**
 * WoW client colours (`QuestDifficultyColors`, Classic Constants.lua; COL-1): trivial
 * 0.50/0.50/0.50, standard 0.25/0.75/0.25, difficult 1.00/1.00/0.00, verydifficult
 * 1.00/0.50/0.25, impossible 1.00/0.10/0.10, each channel rounded to the nearest byte.
 */
export const DIFFICULTY_COLORS: Readonly<Record<Difficulty, string>> = {
  trivial: '#808080',
  standard: '#40BF40',
  difficult: '#FFFF00',
  verydifficult: '#FF8040',
  impossible: '#FF1A1A',
};

/** Text for each difficulty, so the UI never conveys difficulty by colour alone. */
export const DIFFICULTY_LABELS: Readonly<Record<Difficulty, string>> = {
  trivial: 'Trivial',
  standard: 'Standard',
  difficult: 'Difficult',
  verydifficult: 'Very difficult',
  impossible: 'Impossible',
};

/** The Era yellow threshold (`era-assumed` for Forever; COL-4). */
export const DEFAULT_YELLOW_LOWER_BOUND = -2;

/**
 * The highest usable yellow threshold: `Q - P >= 3` is already orange, so at 3 or more no quest
 * could be yellow.
 */
export const MAX_YELLOW_LOWER_BOUND = 2;

/** One band of a green-range table: from `fromLevel` (inclusive) up to the next band, `range`. */
export interface GreenRangeBand {
  readonly fromLevel: number;
  readonly range: number;
}

/** Bands in strictly ascending `fromLevel` order, the first starting at level 1. */
export type GreenRangeTable = readonly GreenRangeBand[];

/** A ruleset's green range (SIMULATION §1.2 `greenRange`): a band table, or a function of the player level. */
export type GreenRange = GreenRangeTable | ((playerLevel: number) => number);

/**
 * `GetQuestGreenRange()` by player level (COL-2, the emulator table). Levels 5-9 are CONFLICT:
 * one wiki example gives 5 at level 9; the emulators and the gray-level formula give 4, which is
 * the default.
 */
export const ERA_GREEN_RANGE: GreenRangeTable = [
  { fromLevel: 1, range: 4 },
  { fromLevel: 10, range: 5 },
  { fromLevel: 20, range: 6 },
  { fromLevel: 30, range: 7 },
  { fromLevel: 40, range: 8 },
  { fromLevel: 45, range: 9 },
  { fromLevel: 50, range: 10 },
  { fromLevel: 55, range: 11 },
  { fromLevel: 60, range: 12 },
];

export interface DifficultyOptions {
  /** Ruleset `difficultyYellowLowerBound`: an integer <= 2. Default -2 (the Era value). */
  readonly yellowLowerBound?: number;
  /** Ruleset `greenRange`. Default ERA_GREEN_RANGE. */
  readonly greenRange?: GreenRange;
}

function assertLevel(name: string, level: number, min: number): void {
  if (!Number.isInteger(level) || level < min) {
    throw new RangeError(`Invalid ${name} ${String(level)}: expected an integer >= ${String(min)}`);
  }
}

function assertRange(range: number, where: string): number {
  if (!Number.isInteger(range) || range < 0) {
    throw new RangeError(`Invalid green range ${String(range)} ${where}: expected an integer >= 0`);
  }
  return range;
}

/** The last band at or below `playerLevel`. The whole table is checked, whatever the level. */
function rangeFromTable(table: GreenRangeTable, playerLevel: number): number {
  let range: number | null = null;
  let previous = 0;
  for (const band of table) {
    const ascending = previous === 0 ? band.fromLevel === 1 : Number.isInteger(band.fromLevel) && band.fromLevel > previous;
    if (!ascending) throw new RangeError('Invalid green range table: bands must start at level 1 and ascend strictly');
    assertRange(band.range, `from level ${String(band.fromLevel)}`);
    previous = band.fromLevel;
    if (band.fromLevel <= playerLevel) range = band.range;
  }
  if (range === null) throw new RangeError('Invalid green range table: no bands');
  return range;
}

/**
 * `GetQuestGreenRange()` for `playerLevel`: from `source`, a band table or a function (default
 * ERA_GREEN_RANGE). Throws a RangeError for an invalid level, a malformed table, or a function
 * that returns anything but a non-negative integer.
 */
export function greenRange(playerLevel: number, source: GreenRange = ERA_GREEN_RANGE): number {
  assertLevel('player level', playerLevel, 1);
  if (typeof source === 'function') return assertRange(source(playerLevel), `at level ${String(playerLevel)}`);
  return rangeFromTable(source, playerLevel);
}

/**
 * The difficulty of a quest of level `questLevel` for a player of level `playerLevel` (COL-1).
 * Scaling quests (`level` -1 in QuestieDB) must be passed their effective level; this function
 * takes levels literally. Throws a RangeError for a yellowLowerBound that is not an integer <= 2
 * (above 2, no quest could be yellow) and for an invalid green range.
 */
export function questDifficulty(playerLevel: number, questLevel: number, opts?: DifficultyOptions): Difficulty {
  assertLevel('player level', playerLevel, 1);
  if (!Number.isInteger(questLevel)) {
    throw new RangeError(`Invalid quest level ${String(questLevel)}: expected an integer`);
  }
  const yellowLowerBound = opts?.yellowLowerBound ?? DEFAULT_YELLOW_LOWER_BOUND;
  if (!Number.isInteger(yellowLowerBound) || yellowLowerBound > MAX_YELLOW_LOWER_BOUND) {
    throw new RangeError(
      `Invalid yellowLowerBound ${String(yellowLowerBound)}: expected an integer <= ${String(MAX_YELLOW_LOWER_BOUND)}`,
    );
  }
  const levelDiff = questLevel - playerLevel;
  if (levelDiff >= 5) return 'impossible';
  if (levelDiff >= 3) return 'verydifficult';
  if (levelDiff >= yellowLowerBound) return 'difficult';
  if (-levelDiff <= greenRange(playerLevel, opts?.greenRange)) return 'standard';
  return 'trivial';
}
