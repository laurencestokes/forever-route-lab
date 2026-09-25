import { describe, expect, it } from 'vitest';
import {
  DIFFICULTIES,
  DIFFICULTY_COLORS,
  DIFFICULTY_LABELS,
  type Difficulty,
  ERA_GREEN_RANGE,
  type GreenRangeTable,
  greenRange,
  MAX_YELLOW_LOWER_BOUND,
  questDifficulty,
} from './difficulty';

type Colour = 'red' | 'orange' | 'yellow' | 'green' | 'grey';

const BY_COLOUR: Readonly<Record<Colour, Difficulty>> = {
  red: 'impossible',
  orange: 'verydifficult',
  yellow: 'difficult',
  green: 'standard',
  grey: 'trivial',
};

/** docs/SIMULATION.md COL-3, every row: [P, Q, greenRange, colour]. */
const COL_3: readonly (readonly [number, number, number, Colour])[] = [
  [1, 6, 4, 'red'],
  [1, 5, 4, 'orange'],
  [1, 4, 4, 'orange'],
  [1, 3, 4, 'yellow'],
  [1, 1, 4, 'yellow'],
  [5, 10, 4, 'red'],
  [5, 9, 4, 'orange'],
  [5, 8, 4, 'orange'],
  [5, 7, 4, 'yellow'],
  [5, 3, 4, 'yellow'],
  [5, 2, 4, 'green'],
  [5, 1, 4, 'green'],
  [10, 15, 5, 'red'],
  [10, 13, 5, 'orange'],
  [10, 12, 5, 'yellow'],
  [10, 8, 5, 'yellow'],
  [10, 7, 5, 'green'],
  [10, 5, 5, 'green'],
  [10, 4, 5, 'grey'],
  [20, 25, 6, 'red'],
  [20, 23, 6, 'orange'],
  [20, 22, 6, 'yellow'],
  [20, 18, 6, 'yellow'],
  [20, 17, 6, 'green'],
  [20, 14, 6, 'green'],
  [20, 13, 6, 'grey'],
  [39, 44, 7, 'red'],
  [39, 42, 7, 'orange'],
  [39, 41, 7, 'yellow'],
  [39, 37, 7, 'yellow'],
  [39, 36, 7, 'green'],
  [39, 32, 7, 'green'],
  [39, 31, 7, 'grey'],
  [40, 45, 8, 'red'],
  [40, 43, 8, 'orange'],
  [40, 42, 8, 'yellow'],
  [40, 38, 8, 'yellow'],
  [40, 37, 8, 'green'],
  [40, 32, 8, 'green'],
  [40, 31, 8, 'grey'],
  [50, 55, 10, 'red'],
  [50, 53, 10, 'orange'],
  [50, 52, 10, 'yellow'],
  [50, 48, 10, 'yellow'],
  [50, 47, 10, 'green'],
  [50, 40, 10, 'green'],
  [50, 39, 10, 'grey'],
  [59, 64, 11, 'red'],
  [59, 62, 11, 'orange'],
  [59, 61, 11, 'yellow'],
  [59, 57, 11, 'yellow'],
  [59, 56, 11, 'green'],
  [59, 48, 11, 'green'],
  [59, 47, 11, 'grey'],
  [60, 65, 12, 'red'],
  [60, 63, 12, 'orange'],
  [60, 62, 12, 'yellow'],
  [60, 58, 12, 'yellow'],
  [60, 57, 12, 'green'],
  [60, 48, 12, 'green'],
  [60, 47, 12, 'grey'],
];

describe('questDifficulty: COL-3', () => {
  it.each(COL_3)('P=%i Q=%i (green range %i) is %s', (p, q, range, colour) => {
    expect(greenRange(p)).toBe(range);
    expect(questDifficulty(p, q)).toBe(BY_COLOUR[colour]);
  });

  it('has no green or grey quest at level 1', () => {
    for (let q = 1; q <= 10; q += 1) {
      expect(['standard', 'trivial']).not.toContain(questDifficulty(1, q));
    }
  });

  it('makes Q = P - 5 grey for P 6-9 (the CONFLICT default of COL-2)', () => {
    for (let p = 6; p <= 9; p += 1) expect(questDifficulty(p, p - 5)).toBe('trivial');
  });
});

describe('questDifficulty: yellow lower bound', () => {
  it('defaults to -2', () => {
    expect(questDifficulty(20, 18)).toBe('difficult');
    expect(questDifficulty(20, 17)).toBe('standard');
    expect(questDifficulty(20, 17, {})).toBe('standard');
  });

  it('flips Q-P = -3 and -4 to yellow at -4 (the Forever Lua fallback)', () => {
    const opts = { yellowLowerBound: -4 };
    expect(questDifficulty(20, 17, opts)).toBe('difficult');
    expect(questDifficulty(20, 16, opts)).toBe('difficult');
    expect(questDifficulty(20, 15, opts)).toBe('standard');
    expect(questDifficulty(20, 13, opts)).toBe('trivial');
    // Only the -3 and -4 rows of COL-3 change.
    for (const [p, q, , colour] of COL_3) {
      const d = q - p;
      const expected = d === -3 || d === -4 ? 'difficult' : BY_COLOUR[colour];
      expect(questDifficulty(p, q, opts)).toBe(expected);
    }
  });
});

describe('questDifficulty: yellow lower bound validation', () => {
  it('accepts integers up to 2, where Q-P = 2 is still yellow', () => {
    expect(MAX_YELLOW_LOWER_BOUND).toBe(2);
    expect(questDifficulty(20, 22, { yellowLowerBound: 2 })).toBe('difficult');
    expect(questDifficulty(20, 21, { yellowLowerBound: 2 })).toBe('standard');
    expect(questDifficulty(20, 23, { yellowLowerBound: 2 })).toBe('verydifficult');
  });

  it('rejects a bound above 2 (no quest could be yellow) and non-integers', () => {
    for (const bound of [3, 10, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => questDifficulty(20, 20, { yellowLowerBound: bound }), String(bound)).toThrow(RangeError);
    }
    expect(() => questDifficulty(20, 20, { yellowLowerBound: Number.NEGATIVE_INFINITY })).toThrow(RangeError);
  });
});

describe('questDifficulty: injected green range', () => {
  // COL-2 CONFLICT: one wiki example gives 5 at level 9 instead of 4.
  const wikiTable: GreenRangeTable = [{ fromLevel: 1, range: 4 }, { fromLevel: 5, range: 5 }, ...ERA_GREEN_RANGE.slice(1)];

  it('takes a band table', () => {
    expect(questDifficulty(9, 4)).toBe('trivial');
    expect(questDifficulty(9, 4, { greenRange: wikiTable })).toBe('standard');
    expect(questDifficulty(9, 3, { greenRange: wikiTable })).toBe('trivial');
    expect(greenRange(4, wikiTable)).toBe(4);
    expect(greenRange(60, wikiTable)).toBe(12);
  });

  it('takes a function of the player level', () => {
    const wide = (p: number): number => (p < 10 ? 5 : greenRange(p));
    expect(questDifficulty(9, 4, { greenRange: wide })).toBe('standard');
    expect(questDifficulty(20, 13, { greenRange: wide })).toBe('trivial');
    // Both options together.
    expect(questDifficulty(9, 5, { greenRange: wide, yellowLowerBound: -4 })).toBe('difficult');
  });

  it('matches the default when given the Era table', () => {
    for (const [p, q, range, colour] of COL_3) {
      expect(greenRange(p, ERA_GREEN_RANGE)).toBe(range);
      expect(questDifficulty(p, q, { greenRange: ERA_GREEN_RANGE })).toBe(BY_COLOUR[colour]);
    }
  });

  it('rejects malformed tables and bad function results', () => {
    const bad: readonly GreenRangeTable[] = [
      [],
      [{ fromLevel: 2, range: 4 }],
      [{ fromLevel: 1, range: 4 }, { fromLevel: 1, range: 5 }],
      [{ fromLevel: 1, range: 4 }, { fromLevel: 20, range: 6 }, { fromLevel: 10, range: 5 }],
      [{ fromLevel: 1, range: 4 }, { fromLevel: 10.5, range: 5 }],
      [{ fromLevel: 1, range: -1 }],
      // A bad band above the player's level is still reported.
      [{ fromLevel: 1, range: 4 }, { fromLevel: 50, range: 2.5 }],
    ];
    for (const table of bad) expect(() => greenRange(5, table), JSON.stringify(table)).toThrow(RangeError);
    expect(() => questDifficulty(9, 1, { greenRange: () => -1 })).toThrow(RangeError);
    expect(() => questDifficulty(9, 1, { greenRange: () => 4.5 })).toThrow(RangeError);
    expect(() => questDifficulty(9, 1, { greenRange: () => Number.NaN })).toThrow(RangeError);
  });
});

describe('greenRange: COL-2 bands', () => {
  it.each([
    [1, 4],
    [9, 4],
    [10, 5],
    [19, 5],
    [20, 6],
    [29, 6],
    [30, 7],
    [39, 7],
    [40, 8],
    [44, 8],
    [45, 9],
    [49, 9],
    [50, 10],
    [54, 10],
    [55, 11],
    [59, 11],
    [60, 12],
    [70, 12],
  ])('level %i has green range %i', (p, range) => {
    expect(greenRange(p)).toBe(range);
  });

  it('rejects invalid levels', () => {
    expect(() => greenRange(0)).toThrow(RangeError);
    expect(() => greenRange(10.5)).toThrow(RangeError);
    expect(() => questDifficulty(0, 1)).toThrow(RangeError);
    expect(() => questDifficulty(10, 1.5)).toThrow(RangeError);
  });

  it('takes quest levels literally (0 and -1 are not special here)', () => {
    expect(questDifficulty(10, 0)).toBe('trivial');
    expect(questDifficulty(1, -1)).toBe('difficult');
  });
});

describe('DIFFICULTY_COLORS', () => {
  const hex = (r: number, g: number, b: number): string =>
    `#${[r, g, b].map((c) => Math.round(c * 255).toString(16).padStart(2, '0').toUpperCase()).join('')}`;

  it('are the client colours from COL-1', () => {
    expect(DIFFICULTY_COLORS.trivial).toBe(hex(0.5, 0.5, 0.5));
    expect(DIFFICULTY_COLORS.standard).toBe(hex(0.25, 0.75, 0.25));
    expect(DIFFICULTY_COLORS.difficult).toBe(hex(1, 1, 0));
    expect(DIFFICULTY_COLORS.verydifficult).toBe(hex(1, 0.5, 0.25));
    expect(DIFFICULTY_COLORS.impossible).toBe(hex(1, 0.1, 0.1));
    expect(DIFFICULTY_COLORS).toEqual({
      trivial: '#808080',
      standard: '#40BF40',
      difficult: '#FFFF00',
      verydifficult: '#FF8040',
      impossible: '#FF1A1A',
    });
  });

  it('cover every difficulty, each with a text label', () => {
    for (const d of DIFFICULTIES) {
      expect(DIFFICULTY_COLORS[d]).toMatch(/^#[0-9A-F]{6}$/);
      expect(DIFFICULTY_LABELS[d].length).toBeGreaterThan(0);
    }
  });
});
