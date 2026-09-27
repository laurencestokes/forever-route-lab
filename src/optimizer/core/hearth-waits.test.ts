import { describe, expect, it } from 'vitest';
import type { QuestRecord } from '../../domain/dataset';
import type { RouteStep } from '../../domain/route';
import { at, killObjective, npcRecord } from '../../engine/test-helpers';
import { evaluateSequence } from './evaluate';
import { harnessCompile, hQuest, hScenario, hSteps, modelOracle, runSearch, type Scenario } from './test-helpers';
import type { CompiledProblem, OptimizationGoal, SearchSolution } from './types';

/**
 * Hearth waits after unknown time (TIME-4; review COR-01, COR-02 and COR-05). When a step since the
 * last cast has unknown time, the wait at the next hearth use lies anywhere from 0 to its computed
 * bound. The engine prices it at 0 and reports the bound. A saving before such a wait may be time
 * the wait absorbs, so solutions are compared on `comparedMs`: each uncertain wait's excess over the
 * incumbent's bound at the same hearth is added. The model oracle and the search must agree on it.
 */

function compile(scenario: Scenario, goal: Partial<OptimizationGoal> = {}): CompiledProblem {
  const compiled = harnessCompile(scenario.project, scenario.context, scenario.section, goal);
  if (!compiled.ok) throw new Error(`compile failed: ${compiled.reason}`);
  return compiled;
}

function priced(compiled: CompiledProblem, units: readonly number[]): SearchSolution {
  const result = evaluateSequence(compiled.problem, Int32Array.from(units));
  if ('infeasible' in result) throw new Error(result.infeasible);
  return result;
}

const WIDE = { beamWidth: 5040, maxEvaluations: 20_000_000 };

/** A prefix that casts at 0 s, spends `shift` known seconds, then unknown time (zone travel and back). */
function unknownPrefix(s: ReturnType<typeof hSteps>, shift: number): RouteStep[] {
  return [s.hearth('use', null, 0), s.note(null, 0, { durationOverride: shift }), s.travel(null, 0), s.travel(0, 0)];
}

/** The review's hearth family: 3 or 4 quests at seeded points, the hearth in the section or in the exit chain. */
function hearthCase(seed: number, shift: number, inSection: boolean): Scenario {
  let x = seed;
  const next = (): number => {
    x = (x * 48271) % 2147483647;
    return x;
  };
  const coordinate = (): number => (next() % 801) - 400;
  const s = hSteps();
  const count = 3 + (next() % 2);
  const quests: QuestRecord[] = [];
  const steps: RouteStep[] = [];
  for (let k = 0; k < count; k += 1) {
    const id = 7000 + k;
    quests.push(hQuest(id, 500));
    const px = coordinate();
    const py = coordinate();
    steps.push(s.accept(id, px, py), s.turnin(id, px, py));
  }
  if (inSection) steps.push(s.hearth('use', null, 0));
  const suffix = inSection ? [s.note(10, 0)] : [s.hearth('use', null, 0), s.note(10, 0)];
  return hScenario({ quests, steps, prefix: unknownPrefix(s, shift), suffix, character: { hearthLocation: at(0, 0) } });
}

/** The review's mixed family: grid points (shared), kills, notes, targets and fills, with an exit-chain hearth. */
function mixedCase(seed: number): { readonly scenario: Scenario; readonly goal: Partial<OptimizationGoal> } {
  let x = seed * 7919 + 13;
  const next = (): number => {
    x = (x * 48271) % 2147483647;
    return x;
  };
  const pick = (values: readonly number[]): number => values[next() % values.length] ?? 0;
  const grid = (): number => ((next() % 5) - 2) * 100;
  const s = hSteps();
  const count = 2 + (next() % 3);
  const records: QuestRecord[] = [];
  const steps: RouteStep[] = [];
  let units = 0;
  for (let k = 0; k < count; k += 1) {
    const id = 5000 + k;
    const xp = pick([0, 250, 500, 1000, 2400, 3000]);
    const withKill = units < 6 && next() % 3 === 0;
    records.push(hQuest(id, xp, withKill ? { objectives: [killObjective(5900, 1 + (next() % 3))] } : {}));
    const accept = at(grid(), grid());
    const turnin = next() % 2 === 0 ? accept : at(grid(), grid());
    if (next() % 4 === 0) steps.push(s.note(null, 0, { location: at(grid(), grid()) }));
    steps.push(s.accept(id, 0, 0, { location: accept }));
    if (withKill) steps.push(s.complete(id, 0, 0, { location: at(grid(), grid()) }));
    steps.push(s.turnin(id, 0, 0, { location: turnin }));
    units += withKill ? 3 : 2;
  }
  const exit = { x: grid(), y: grid() };
  const scenario = hScenario({
    quests: records,
    data: { npcs: [npcRecord(5900, { minLevel: 10, maxLevel: 10 })] },
    steps,
    prefix: unknownPrefix(s, pick([3500, 3530, 3560])),
    suffix: [s.hearth('use', null, 0), s.note(exit.x, exit.y)],
    character: { hearthLocation: at(0, 0) },
  });
  const known = records.map((r) => r.xp?.baseXp ?? 0).filter((v) => v > 0);
  const some = (): number => (known.length === 0 ? 0 : (known[next() % known.length] ?? 0));
  const mode = next() % 4;
  const goal: Partial<OptimizationGoal> =
    mode === 1 ? { targetXp: some() } : mode === 2 ? { targetXp: records.reduce((n, r) => n + (r.xp?.baseXp ?? 0), 0) + 300 } : mode === 3 ? { targetXp: some() + 200, grindFill: 'replace-quests' } : {};
  return { scenario, goal };
}

describe('uncertain hearth waits (review COR-02)', () => {
  it('a saving an uncertain wait may absorb is no saving: the incumbent stays best', () => {
    // The prefix casts at 0 s (ready at 3,610 s), then 3,300 s of known time and unknown travel.
    // The section's three quests are in a poor order; the exit chain uses the hearth.
    const s = hSteps();
    const steps: RouteStep[] = [...s.quest(6001, 300, 0), ...s.quest(6002, -300, 0), ...s.quest(6003, 300, 50)];
    const scenario = hScenario({
      quests: [hQuest(6001, 500), hQuest(6002, 500), hQuest(6003, 500)],
      steps,
      prefix: unknownPrefix(s, 3300),
      suffix: [s.hearth('use', null, 0), s.note(10, 0)],
      character: { hearthLocation: at(0, 0) },
    });
    const compiled = compile(scenario);
    const incumbent = priced(compiled, [0, 1, 2, 3, 4, 5]);
    const reorder = priced(compiled, [2, 3, 0, 1, 4, 5]);
    // The engine's figure is 55.2 s lower, but with no unknown time both routes cast at 3,610 s.
    expect(incumbent.estimatedMs).toBe(178_208);
    expect(reorder.estimatedMs).toBe(123_000);
    expect(reorder.comparedMs).toBe(incumbent.estimatedMs);
    expect(reorder.uncertainWaits).toBe(1);
    const outcome = runSearch(compiled, WIDE);
    expect(Array.from(outcome.solutions[0]?.units ?? [])).toEqual([0, 1, 2, 3, 4, 5]);
    // No listed solution has a lower engine figure without a lower compared figure.
    for (const solution of outcome.solutions) expect(solution.estimatedMs < incumbent.estimatedMs && solution.comparedMs >= incumbent.estimatedMs).toBe(false);
    expect(modelOracle(compiled.problem).best).toBe(incumbent.estimatedMs);
  });

  it('work moved past an in-section hearth whose wait is uncertain can be slower: it is not proposed', () => {
    const s = hSteps();
    const steps: RouteStep[] = [s.accept(6001, 300, 0), s.turnin(6001, 300, 0), s.accept(6002, -600, 0), s.turnin(6002, -600, 0), s.hearth('use', null, 0)];
    const scenario = hScenario({
      quests: [hQuest(6001, 500), hQuest(6002, 500)],
      steps,
      prefix: unknownPrefix(s, 3300),
      suffix: [s.note(-600, 0)],
      character: { hearthLocation: at(0, 0) },
    });
    const compiled = compile(scenario);
    const incumbent = priced(compiled, [0, 1, 2, 3, 4]);
    const moved = priced(compiled, [0, 1, 4, 2, 3]);
    // 90 s lower by the engine's figure, 6 s slower (quest 6002's interactions) with no unknown time.
    expect(incumbent.estimatedMs - moved.estimatedMs).toBe(90_000);
    expect(moved.comparedMs - incumbent.estimatedMs).toBe(6000);
    const outcome = runSearch(compiled, { beamWidth: 256 });
    expect(Array.from(outcome.solutions[0]?.units ?? [])).toEqual([0, 1, 2, 3, 4]);
    expect(outcome.solutions.some((solution) => solution.estimatedMs < incumbent.estimatedMs)).toBe(false);
  });
});

describe('dominance with uncertain hearth waits (review COR-01)', () => {
  it('seed 42: a faster prefix no longer prunes the order that improves', () => {
    const compiled = compile(hearthCase(42, 3450, false));
    const outcome = runSearch(compiled, WIDE);
    expect(outcome.termination).toBe('exhausted');
    expect(outcome.incumbent.estimatedMs).toBe(197_235);
    // [0, 4, 5, 1, 2, 3] reaches the hearth after it is ready (160,366 ms); [0, 1, 4, 5, 2, 3] reaches
    // it earlier and is priced as if it waited the whole bound: 160,000 ms whatever the unknown time.
    expect(priced(compiled, [0, 4, 5, 1, 2, 3]).comparedMs).toBe(160_366);
    expect(outcome.solutions[0]?.comparedMs).toBe(160_000);
    expect(Array.from(outcome.solutions[0]?.units ?? [])).toEqual([0, 1, 4, 5, 2, 3]);
  });
});

describe('the model oracle on hearth families (review COR-05)', () => {
  for (const inSection of [false, true]) {
    it(`the hearth ${inSection ? 'in the section' : 'in the exit chain'}: width 5,040 equals the oracle, pruning on and off`, () => {
      const misses: string[] = [];
      for (let seed = 1; seed <= 24; seed += 1) {
        for (const shift of [3450, 3520, 3560]) {
          const compiled = compile(hearthCase(seed, shift, inSection));
          const want = modelOracle(compiled.problem).best;
          const pruned = runSearch(compiled, WIDE).solutions[0]?.comparedMs;
          const unpruned = runSearch(compiled, { ...WIDE, dominance: false }).solutions[0]?.comparedMs;
          if (pruned !== want || unpruned !== want) misses.push(`seed ${String(seed)} shift ${String(shift)}: oracle ${String(want)}, pruned ${String(pruned)}, unpruned ${String(unpruned)}`);
        }
      }
      expect(misses).toEqual([]);
    }, 60_000);
  }

  it('the mixed family (kills, shared points, targets, fills): width 5,040 with pruning equals the oracle', () => {
    const misses: string[] = [];
    for (let seed = 1; seed <= 120; seed += 1) {
      const { scenario, goal } = mixedCase(seed);
      const compiled = compile(scenario, goal);
      const want = modelOracle(compiled.problem).best;
      const outcome = runSearch(compiled, WIDE);
      if (outcome.solutions[0]?.comparedMs !== want) misses.push(`seed ${String(seed)}: oracle ${String(want)}, search ${String(outcome.solutions[0]?.comparedMs)}`);
      // Without duplicate detection the layers outgrow the width, so only soundness holds there.
      const unpruned = runSearch(compiled, { ...WIDE, dominance: false }).solutions[0]?.comparedMs ?? Number.POSITIVE_INFINITY;
      if (unpruned < want) misses.push(`seed ${String(seed)}: unpruned ${String(unpruned)} beats the oracle ${String(want)}`);
    }
    expect(misses).toEqual([]);
  }, 60_000);
});
