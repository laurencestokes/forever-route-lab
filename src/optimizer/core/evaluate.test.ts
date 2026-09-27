import { describe, expect, it } from 'vitest';
import { evaluateSequence } from './evaluate';
import { coreFixtures } from './test-fixtures';
import { harnessCompile } from './test-helpers';
import type { CompiledProblem } from './types';

/** `evaluateSequence` (docs/research/optimizer-m7.md §5.6, §11). */

function compiled(id: string): CompiledProblem {
  const fixture = coreFixtures().find((f) => f.id === id);
  if (fixture === undefined) throw new Error(`no fixture ${id}`);
  const result = harnessCompile(fixture.scenario.project, fixture.scenario.context, fixture.scenario.section, fixture.goal);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe('evaluateSequence', () => {
  const one = compiled('1');
  const evaluate = (units: readonly number[]): ReturnType<typeof evaluateSequence> => evaluateSequence(one.problem, Int32Array.from(units));

  it('prices an order exactly as the search does (fixture 1)', () => {
    expect(evaluate([2, 3, 4, 5])).toMatchObject({ estimatedMs: 46_142, knownGain: 3200, fillMs: 0, exitMs: 10_000, unknownParts: 0 });
    expect(evaluate([4, 5, 2, 3])).toMatchObject({ estimatedMs: 58_503 });
    expect(evaluate([0, 1])).toMatchObject({ estimatedMs: 606_666, knownGain: 3000 });
    expect(evaluate([0, 1, 2, 3, 4, 5])).toMatchObject({ estimatedMs: 632_142 });
  });

  it('refuses unknown units, broken precedence, partly scheduled quests and a short target', () => {
    expect(evaluate([9])).toEqual({ infeasible: 'unit 9 does not exist' });
    expect(evaluate([1, 0])).toEqual({ infeasible: expect.stringMatching(/unit 1 .*not enabled/) as unknown });
    expect(evaluate([2, 3, 4])).toEqual({ infeasible: expect.stringMatching(/cannot close/) as unknown });
    expect(evaluate([2, 3])).toEqual({ infeasible: expect.stringMatching(/short of the target/) as unknown });
    expect(evaluate([2, 2])).toEqual({ infeasible: expect.stringMatching(/not enabled/) as unknown });
  });

  it('prices a barrier only inside its block (fixture 12)', () => {
    const twelve = compiled('12');
    // Units: 0 accept A, 1 block [turn in A, zone travel, accept B], 2 turn in B, 3 accept F, 4 turn in F.
    expect(evaluateSequence(twelve.problem, Int32Array.from([0, 1, 2, 3, 4]))).toMatchObject({ estimatedMs: 608_000, unknownParts: 2 });
    expect(evaluateSequence(twelve.problem, Int32Array.from([0, 1, 3, 4, 2]))).toMatchObject({ estimatedMs: 608_000 });
    expect(evaluateSequence(twelve.problem, Int32Array.from([3, 4, 0, 1, 2]))).toMatchObject({ estimatedMs: 628_000 });
    // The zone travel cannot come after F without A's turn-in and B's accept: its block keeps them together.
    expect(evaluateSequence(twelve.problem, Int32Array.from([3, 4, 1, 0, 2]))).toEqual({ infeasible: expect.stringMatching(/not enabled/) as unknown });
  });

  it('keeps an unknown-XP turn-in after the XP-granting units that preceded it (fixture 7f v2)', () => {
    const f = compiled('7f-v2');
    // Units: 0 accept A, 1 turn in A, 2 accept K, 3 turn in K (unknown XP).
    expect(evaluateSequence(f.problem, Int32Array.from([0, 1, 2, 3]))).toMatchObject({ estimatedMs: 442_000 });
    expect(evaluateSequence(f.problem, Int32Array.from([2, 3, 0, 1]))).toEqual({ infeasible: expect.stringMatching(/not enabled/) as unknown });
  });

  it('refuses newly blocking an accept (fixture 5: C before the level it needs)', () => {
    const five = compiled('5');
    expect(evaluateSequence(five.problem, Int32Array.from([4, 5, 0, 1, 2, 3]))).toEqual({ infeasible: expect.stringMatching(/less available/) as unknown });
  });

  it('refuses dropping a reputation reward a kept accept needs (fixture 13b)', () => {
    const thirteen = compiled('13b');
    expect(evaluateSequence(thirteen.problem, Int32Array.from([2, 3]))).toEqual({ infeasible: expect.stringMatching(/not enabled/) as unknown });
    expect(evaluateSequence(thirteen.problem, Int32Array.from([0, 1]))).toMatchObject({ estimatedMs: 106_000 });
  });
});
