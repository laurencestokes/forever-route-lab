import { describe, expect, it } from 'vitest';
import { sequentialIdSource } from '../../domain/ids';
import { decodeSolution, keptInPlace } from './decode';
import { coreFixtures } from './test-fixtures';
import { harnessCompile, runSearch } from './test-helpers';
import type { CompiledProblem, SearchSolution } from './types';

/** Decoding solutions to steps (docs/research/optimizer-m7.md §9 step 5, §10). */

function solve(id: string): { readonly compiled: CompiledProblem; readonly best: SearchSolution } {
  const fixture = coreFixtures().find((f) => f.id === id);
  if (fixture === undefined) throw new Error(`no fixture ${id}`);
  const compiled = harnessCompile(fixture.scenario.project, fixture.scenario.context, fixture.scenario.section, fixture.goal);
  if (!compiled.ok) throw new Error(compiled.reason);
  const best = runSearch(compiled, { beamWidth: 16, maxEvaluations: 100_000 }).solutions[0];
  if (best === undefined) throw new Error('no solution');
  return { compiled, best };
}

describe('decodeSolution', () => {
  it('returns the original step objects in the new order, without the dropped quest’s steps (fixture 1)', () => {
    const { compiled, best } = solve('1');
    const decoded = decodeSolution(compiled.decode, best, sequentialIdSource(1));
    const steps = compiled.decode.steps;
    expect(decoded.steps).toEqual([steps[2], steps[3], steps[4], steps[5]]);
    expect(decoded.steps[0]).toBe(steps[2]);
    expect(decoded.sourceStepIds).toEqual(decoded.steps.map((step) => step.id));
    expect(decoded.dependencies).toEqual([]);
  });

  it('keeps anchors in their chain (fixture 7e)', () => {
    const { compiled, best } = solve('7e');
    const decoded = decodeSolution(compiled.decode, best, sequentialIdSource(1));
    const offsets = decoded.steps.map((step) => compiled.decode.steps.indexOf(step));
    expect(offsets).toEqual([2, 3, 6, 4, 5, 0, 1]);
    expect(Array.from(compiled.decode.fixed)).toEqual([0, 0, 1, 1, 0, 0, 1]);
  });

  it('appends the grind fill, and makes it depend on the moved XP-granting steps (fixture 8)', () => {
    const { compiled, best } = solve('8');
    const decoded = decodeSolution(compiled.decode, best, sequentialIdSource(500));
    const fill = decoded.steps.at(-1);
    expect(fill).toEqual({
      id: 'step-500',
      kind: 'grind',
      until: { kind: 'level', level: 10, offset: { kind: 'xpInto', xp: 2500 } },
      mobLevel: null,
      xpPerHour: null,
      location: null,
      note: null,
      locked: false,
      groupId: null,
      condition: null,
      durationOverride: null,
      origin: { source: 'optimizer', ref: null },
      rxp: null,
      ext: null,
    });
    expect(decoded.sourceStepIds.at(-1)).toBeNull();
    // Original B, A; new A, B: the tie rule keeps the steps with the smaller before-indices (B's) in
    // place, so A's turn-in is the moved XP-granting step.
    const aTurnIn = compiled.decode.steps[3];
    expect(decoded.dependencies).toEqual([{ stepId: 'step-500', requires: [aTurnIn?.id] }]);
  });

  it('makes the fill depend on the removed steps when it replaces a quest (fixture 8b)', () => {
    const { compiled, best } = solve('8b-replace-quests');
    const decoded = decodeSolution(compiled.decode, best, sequentialIdSource(500));
    const removed = [compiled.decode.steps[2]?.id, compiled.decode.steps[3]?.id];
    expect(decoded.dependencies).toEqual([{ stepId: 'step-500', requires: removed }]);
  });
});

describe('keptInPlace (the weighted increasing subsequence)', () => {
  /** Brute force: every increasing subsequence's weight. */
  function brute(values: readonly number[], fixed: readonly boolean[]): number {
    const n = values.length;
    let best = 0;
    for (let mask = 0; mask < 2 ** n; mask += 1) {
      let last = -Infinity;
      let weight = 0;
      let ok = true;
      for (let i = 0; i < n; i += 1) {
        if (Math.floor(mask / 2 ** i) % 2 === 0) continue;
        if ((values[i] ?? 0) <= last) {
          ok = false;
          break;
        }
        last = values[i] ?? 0;
        weight += fixed[i] === true ? n + 1 : 1;
      }
      if (ok) best = Math.max(best, weight);
    }
    return best;
  }

  it('finds a maximum-weight increasing subsequence (brute force, n ≤ 8)', () => {
    let x = 99;
    const next = (): number => {
      x = (x * 48271) % 2147483647;
      return x;
    };
    for (let trial = 0; trial < 200; trial += 1) {
      const n = 1 + (next() % 8);
      const values = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i -= 1) {
        const j = next() % (i + 1);
        [values[i], values[j]] = [values[j] ?? 0, values[i] ?? 0];
      }
      const fixed = values.map(() => next() % 4 === 0);
      const kept = keptInPlace(values, fixed);
      const picked = [...kept].sort((a, b) => a - b);
      for (let k = 1; k < picked.length; k += 1) expect(values[picked[k] ?? 0] ?? 0).toBeGreaterThan(values[picked[k - 1] ?? 0] ?? 0);
      const weight = picked.reduce((w, i) => w + (fixed[i] === true ? n + 1 : 1), 0);
      expect(weight).toBe(brute(values, fixed));
    }
  });

  it('keeps fixed steps and prefers smaller values on ties (fixture 7e’s diff)', () => {
    // After-order before-indices [2, 3, 6, 4, 5, 0, 1] with L1 = 2, C3 = 3, L2 = 6 fixed.
    const values = [2, 3, 6, 4, 5, 0, 1];
    expect([...keptInPlace(values, [true, true, true, false, false, false, false])].sort((a, b) => a - b)).toEqual([0, 1, 2]);
    // Between [2, 3] and [0, 1] (equal weight) the end with the smaller value wins.
    expect([...keptInPlace([2, 3, 0, 1], [false, false, false, false])].sort((a, b) => a - b)).toEqual([2, 3]);
  });
});
