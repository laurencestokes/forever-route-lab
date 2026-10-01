import { describe, expect, it } from 'vitest';
import { againstNote, median, ratioRow } from './ab-ratio';

/** The interleaved A/B's ratios (tests/bench/ab-derived.ts; review C-12). */
describe('ratioRow', () => {
  const labels = ['pre', 'main', 'cur'];

  it('compares every tree with the first label when its tree has the case', () => {
    const samples: Record<string, number[]> = { pre: [10, 12, 11], main: [11, 13, 12], cur: [22, 20, 24] };
    const row = ratioRow(labels, (label) => samples[label]);
    expect(row.against).toBe('pre');
    expect(row.cells.pre).toEqual({ median: 11, min: 10, max: 12, ratio: null });
    expect(row.cells.cur).toEqual({ median: 22, min: 20, max: 24, ratio: 2 });
  });

  it('compares with the next label that has the case when the first lacks it, and names it', () => {
    // taxiArrives is absent at 95e84cc: the critic's 81.81 / 97.09 had to be worked out by hand.
    const samples: Record<string, number[]> = { main: [97.09], cur: [81.81] };
    const row = ratioRow(labels, (label) => samples[label]);
    expect(row.against).toBe('main');
    expect(row.cells.pre).toBe('absent');
    expect(row.cells.main).toMatchObject({ ratio: null });
    const cur = row.cells.cur;
    expect(cur !== 'absent' && cur?.ratio !== null && cur !== undefined ? Number(cur.ratio?.toFixed(3)) : null).toBe(0.843);
  });

  it('says which tree a row is against, or that only one tree has the case', () => {
    expect(againstNote(ratioRow(labels, () => [1]), 'pre')).toBe('');
    expect(againstNote(ratioRow(labels, (label) => (label === 'pre' ? undefined : [1])), 'pre')).toBe(' (vs main: pre lacks the case)');
    expect(againstNote(ratioRow(labels, (label) => (label === 'cur' ? [1] : undefined)), 'pre')).toBe(' (only cur has the case: no ratio)');
    expect(againstNote(ratioRow(labels, () => undefined), 'pre')).toBe('');
  });

  it('gives no ratio when no tree has the case', () => {
    expect(ratioRow(labels, () => undefined)).toEqual({ against: null, cells: { pre: 'absent', main: 'absent', cur: 'absent' } });
  });

  it('takes the middle value, or the mean of the middle two', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
