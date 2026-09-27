import { describe, expect, it } from 'vitest';
import { longestIncreasingSubsequence } from './lis';
import { pick, seeded, shuffled } from './test-helpers';

/**
 * The brute force: every subset of positions whose values strictly increase, the maximum weight,
 * and among those the one whose (value, position) pairs read from the end are lexicographically
 * smallest (the tie rule of lis.ts).
 */
function bruteForce(values: readonly number[], weights: readonly number[]): { readonly weight: number; readonly positions: number[] } {
  const n = values.length;
  let best: { weight: number; positions: number[] } = { weight: 0, positions: [] };
  const smallerFromEnd = (a: readonly number[], b: readonly number[]): boolean => {
    for (let k = 1; k <= Math.min(a.length, b.length); k += 1) {
      const pa = a[a.length - k] ?? 0;
      const pb = b[b.length - k] ?? 0;
      const va = values[pa] ?? 0;
      const vb = values[pb] ?? 0;
      if (va !== vb) return va < vb;
      if (pa !== pb) return pa < pb;
    }
    return a.length < b.length;
  };
  for (let mask = 1; mask < 2 ** n; mask += 1) {
    const positions: number[] = [];
    let rest = mask;
    for (let i = 0; i < n; i += 1) {
      if (rest % 2 === 1) positions.push(i);
      rest = Math.floor(rest / 2);
    }
    let increasing = true;
    for (let k = 1; k < positions.length && increasing; k += 1) increasing = (values[positions[k - 1] ?? 0] ?? 0) < (values[positions[k] ?? 0] ?? 0);
    if (!increasing) continue;
    const weight = positions.reduce((sum, p) => sum + (weights[p] ?? 0), 0);
    if (weight > best.weight || (weight === best.weight && smallerFromEnd(positions, best.positions))) best = { weight, positions };
  }
  return best;
}

function permutations(n: number): number[][] {
  if (n === 0) return [[]];
  const out: number[][] = [];
  for (const rest of permutations(n - 1)) {
    for (let at = 0; at <= rest.length; at += 1) out.push([...rest.slice(0, at), n - 1, ...rest.slice(at)]);
  }
  return out;
}

const weightOf = (positions: Int32Array, weights: readonly number[]): number => [...positions].reduce((sum, p) => sum + (weights[p] ?? 0), 0);

describe('longestIncreasingSubsequence', () => {
  it('handles the empty, single and classic cases', () => {
    expect([...longestIncreasingSubsequence([])]).toEqual([]);
    expect([...longestIncreasingSubsequence([7])]).toEqual([0]);
    expect([...longestIncreasingSubsequence([0, 1, 2, 3])]).toEqual([0, 1, 2, 3]);
    // Reversed: every single element has weight 1; the end with the smallest value wins.
    expect([...longestIncreasingSubsequence([3, 2, 1, 0])]).toEqual([3]);
    // 3 1 4 1 5 9 2 6: length 4, and the tie rule picks 1 4 5 6 read from the end (6 < 9).
    expect([...longestIncreasingSubsequence([3, 1, 4, 1, 5, 9, 2, 6])]).toEqual([1, 2, 4, 7]);
  });

  it('keeps heavy elements: fixture 7e keeps L1, C3 and L2', () => {
    // docs/research/optimizer-m7.md §10: the after-order's before-indices, with L1 (2) and L2 (6) locked.
    const values = [2, 3, 6, 4, 5, 0, 1];
    expect([...longestIncreasingSubsequence(values)]).toEqual([0, 1, 3, 4]);
    const heavy = values.length + 1;
    const weights = values.map((v) => (v === 2 || v === 6 ? heavy : 1));
    expect([...longestIncreasingSubsequence(values, weights)]).toEqual([0, 1, 2]);
  });

  it('equals the brute force on every permutation up to 7 elements, with unit and random weights', () => {
    const next = seeded(17);
    for (let n = 1; n <= 7; n += 1) {
      for (const values of permutations(n)) {
        for (const weights of [values.map(() => 1), values.map(() => 1 + pick(next, 3))]) {
          const expected = bruteForce(values, weights);
          const got = longestIncreasingSubsequence(values, weights);
          expect(weightOf(got, weights)).toBe(expected.weight);
          expect([...got]).toEqual(expected.positions);
        }
      }
    }
  });

  it('equals the brute force on seeded permutations of 8 and 9 elements', () => {
    const next = seeded(23);
    for (let trial = 0; trial < 400; trial += 1) {
      const n = 8 + (trial % 2);
      const values = shuffled(Array.from({ length: n }, (_, i) => i), next);
      const weights = values.map(() => (next() < 0.2 ? n + 1 : 1 + pick(next, 2)));
      const expected = bruteForce(values, weights);
      const got = longestIncreasingSubsequence(values, weights);
      expect(weightOf(got, weights)).toBe(expected.weight);
      expect([...got]).toEqual(expected.positions);
    }
  });

  it('is strict on repeated values, and ranks values that are not small integers', () => {
    const next = seeded(5);
    for (let trial = 0; trial < 300; trial += 1) {
      const n = 1 + pick(next, 8);
      const scale = trial % 3 === 0 ? 1 : trial % 3 === 1 ? -2.5 : 1e9;
      const values = Array.from({ length: n }, () => pick(next, 4) * scale);
      const weights = values.map(() => 1 + pick(next, 3));
      const expected = bruteForce(values, weights);
      const got = longestIncreasingSubsequence(values, weights);
      expect(weightOf(got, weights)).toBe(expected.weight);
      expect([...got]).toEqual(expected.positions);
    }
    expect([...longestIncreasingSubsequence([1, 1, 1])]).toEqual([0]);
  });

  it('refuses bad input', () => {
    expect(() => longestIncreasingSubsequence([1, 2], [1])).toThrow(RangeError);
    expect(() => longestIncreasingSubsequence([1, Number.NaN])).toThrow(RangeError);
    expect(() => longestIncreasingSubsequence([1, 2], [1, 0])).toThrow(RangeError);
    expect(() => longestIncreasingSubsequence([1, 2], [1, Number.POSITIVE_INFINITY])).toThrow(RangeError);
  });

  it('runs 10,000 elements sorted, reversed and shuffled', () => {
    const n = 10_000;
    const sorted = Array.from({ length: n }, (_, i) => i);
    expect(longestIncreasingSubsequence(sorted).length).toBe(n);
    expect([...longestIncreasingSubsequence([...sorted].reverse())]).toEqual([n - 1]);
    const values = shuffled(sorted, seeded(3));
    const got = longestIncreasingSubsequence(values);
    for (let k = 1; k < got.length; k += 1) expect(values[got[k] ?? 0] ?? 0).toBeGreaterThan(values[got[k - 1] ?? 0] ?? 0);
    // About 2√n for a random permutation.
    expect(got.length).toBeGreaterThan(150);
    expect(got.length).toBeLessThan(250);
  });
});
