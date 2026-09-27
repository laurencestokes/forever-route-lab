import { describe, expect, it } from 'vitest';
import type { QuestRecord } from '../../domain/dataset';
import { sequentialIdSource } from '../../domain/ids';
import type { RouteStep } from '../../domain/route';
import { makeGrindStep } from '../../domain/step-factory';
import { killObjective, npcRecord } from '../../engine/test-helpers';
import { createRouteWalker } from '../../engine/walker';
import { cumulativeXp, stateAtTotal, xpCurveOf } from '../../sim/xp';
import { createTransitions, evaluateSequence, runSequence } from './evaluate';
import { harnessCompile, hQuest, hScenario, hSteps, modelOracle, runSearch, type Scenario } from './test-helpers';
import type { CompiledProblem, OptimizationGoal } from './types';

/**
 * Fixture 9 (docs/research/optimizer-m7.md §13.1) at core level: 40 seeded instances, a brute-force
 * oracle that walks every allowed subset and order with the engine, and the beam at widths 5,040,
 * 1, 4 and 16, with dominance on and off. Then the model oracle (every sequence the transitions
 * allow, closed at every node) on numeric targets around a suffix threshold (review COR-03, COR-05).
 *
 * "Width 5,040 equals the optimum" holds for these families. It does not hold for a detour through
 * an optional unit whose arrival radius makes the engine's move shorter than a direct leg (review
 * COR-04, SIMULATION TIME-2): a node that closes with its target met is not expanded, by design, so
 * the optimiser never adds an optional quest to harvest that simplification.
 */

interface Instance {
  readonly scenario: Scenario;
  readonly goal: Partial<OptimizationGoal>;
  /** Each quest's steps: accept, [complete], turn-in. */
  readonly quests: readonly (readonly RouteStep[])[];
}

function instance(seed: number): Instance {
  let x = seed;
  const next = (): number => {
    x = (x * 48271) % 2147483647;
    return x;
  };
  const coordinate = (): number => (next() % 1001) - 500;
  const s = hSteps();
  const count = 2 + (next() % 2);
  const records: QuestRecord[] = [];
  const quests: RouteStep[][] = [];
  const withObjective = next() % 2 === 1;
  for (let k = 0; k < count; k += 1) {
    const id = 9000 + k;
    const xp = 50 * (10 + (next() % 31));
    const objective = withObjective && k === 0;
    records.push(hQuest(id, xp, objective ? { objectives: [killObjective(9900, 2)] } : {}));
    const steps: RouteStep[] = [s.accept(id, coordinate(), coordinate())];
    if (objective) steps.push(s.complete(id, coordinate(), coordinate()));
    steps.push(s.turnin(id, coordinate(), coordinate()));
    quests.push(steps);
  }
  const exit = { x: coordinate(), y: coordinate() };
  const scenario = hScenario({
    quests: records,
    data: { npcs: [npcRecord(9900, { minLevel: 10, maxLevel: 10 })] },
    steps: quests.flat(),
    exit,
  });
  // The target by seed mod 3: keep-original, a random non-empty subset's XP, keep-original + 300 (a fill).
  let goal: Partial<OptimizationGoal> = {};
  if (seed % 3 === 1) {
    const mask = 1 + (next() % (2 ** count - 1));
    let total = 0;
    for (let k = 0; k < count; k += 1) if (Math.floor(mask / 2 ** k) % 2 === 1) total += records[k]?.xp?.baseXp ?? 0;
    goal = { targetXp: total };
  }
  return { scenario, goal, quests };
}

/** Every order of the kept quests' steps that keeps each quest's own order. */
function orders(quests: readonly (readonly RouteStep[])[]): RouteStep[][] {
  const out: RouteStep[][] = [];
  const cursor = quests.map(() => 0);
  const path: RouteStep[] = [];
  const total = quests.reduce((n, q) => n + q.length, 0);
  const visit = (): void => {
    if (path.length === total) {
      out.push([...path]);
      return;
    }
    quests.forEach((q, k) => {
      const at = cursor[k] ?? 0;
      const step = q[at];
      if (step === undefined) return;
      cursor[k] = at + 1;
      path.push(step);
      visit();
      path.pop();
      cursor[k] = at;
    });
  };
  visit();
  return out;
}

/** The oracle: the least engine time over every allowed subset and order (§13.1 fixture 9). */
function oracle(inst: Instance, target: number, fillAllowed: (keptAll: boolean) => boolean): number {
  const { scenario } = inst;
  const context = scenario.context;
  const curve = xpCurveOf(context.rules);
  const walker = createRouteWalker(context);
  const exit = scenario.project.route.steps.slice(scenario.section.last + 1);
  const startTotal = cumulativeXp(curve, 10);
  const ids = sequentialIdSource(50_000);
  const fillStep = (): RouteStep => {
    const at = stateAtTotal(curve, startTotal + target);
    return makeGrindStep(ids, { until: { kind: 'level', level: at.level, offset: at.xp > 0 ? { kind: 'xpInto', xp: at.xp } : null }, origin: { source: 'optimizer', ref: null } });
  };
  let best = Number.POSITIVE_INFINITY;
  const count = inst.quests.length;
  for (let mask = 0; mask < 2 ** count; mask += 1) {
    const kept = inst.quests.filter((_, k) => Math.floor(mask / 2 ** k) % 2 === 1);
    for (const order of orders(kept)) {
      const measure = (section: readonly RouteStep[]): { readonly ms: number; readonly gain: number } | null => {
        const project = { ...scenario.project, route: { ...scenario.project.route, steps: [...section, ...exit] } };
        const records = walker.walk(project).records;
        if (section.length === 0) {
          const e = records[0];
          return e === undefined ? null : { ms: (e.estimate.breakdown.travel + e.estimate.breakdown.waiting) * 1000, gain: 0 };
        }
        const first = records[0];
        const last = records[section.length - 1];
        const exitRecord = records[section.length];
        if (first === undefined || last === undefined || exitRecord === undefined) return null;
        if (records.some((r) => r.estimate.facts.some((f) => f.kind === 'complete-not-in-log'))) return null;
        const gain = cumulativeXp(curve, last.estimate.levelAfter.value ?? 1) + last.estimate.xpAfter - startTotal;
        return { ms: (last.estimate.endSec - first.estimate.startSec) * 1000 + (exitRecord.estimate.breakdown.travel + exitRecord.estimate.breakdown.waiting) * 1000, gain };
      };
      const plain = measure(order);
      if (plain === null) continue;
      if (plain.gain >= target) best = Math.min(best, plain.ms);
      else if (fillAllowed(kept.length === count)) {
        const filled = measure([...order, fillStep()]);
        if (filled !== null) best = Math.min(best, filled.ms);
      }
    }
  }
  return best;
}

function compile(inst: Instance): CompiledProblem {
  const compiled = harnessCompile(inst.scenario.project, inst.scenario.context, inst.scenario.section, inst.goal);
  if (!compiled.ok) throw new Error(compiled.reason);
  return compiled;
}

describe('fixture 9: the brute-force oracle', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    it(`seed ${String(seed)}`, () => {
      const inst = instance(seed);
      let compiled = compile(inst);
      if (seed % 3 === 2) {
        // keep-original + 300: the fill covers it.
        const target = compiled.problem.targetXp + 300;
        compiled = compile({ ...inst, goal: { targetXp: target } });
      }
      const target = compiled.problem.targetXp;
      const expected = oracle(inst, target, (keptAll) => keptAll);
      const wide = runSearch(compiled, { beamWidth: 5040, maxEvaluations: 10_000_000 });
      const wideUnpruned = runSearch(compiled, { beamWidth: 5040, maxEvaluations: 10_000_000, dominance: false });
      const best = wide.solutions[0];
      if (best === undefined) throw new Error('no solution');
      const transitions = createTransitions(compiled.problem);
      runSequence(transitions, best.units, false);
      const tolerance = Math.max(0.01 * expected, transitions.pricedParts);
      expect(Math.abs(best.estimatedMs - expected)).toBeLessThanOrEqual(tolerance);
      expect(wideUnpruned.solutions[0]?.estimatedMs).toBe(best.estimatedMs);
      for (const beamWidth of [1, 4, 16]) {
        const narrow = runSearch(compiled, { beamWidth, maxEvaluations: 10_000_000 });
        expect(narrow.solutions[0]?.estimatedMs ?? Number.POSITIVE_INFINITY).toBeGreaterThanOrEqual(expected - tolerance);
      }
    });
  }
});

/** Quests at seeded points, then a suffix accept gated at level 11: a threshold 7,600 known XP above the start. */
function gatedInstance(seed: number): { readonly scenario: Scenario; readonly goal: Partial<OptimizationGoal>; readonly gain: number } {
  let x = seed * 104_729 + 7;
  const next = (): number => {
    x = (x * 48271) % 2147483647;
    return x;
  };
  const coordinate = (): number => (next() % 801) - 400;
  const s = hSteps();
  const count = 2 + (next() % 2);
  const records: QuestRecord[] = [];
  const steps: RouteStep[] = [];
  let gain = 0;
  for (let k = 0; k < count; k += 1) {
    const xp = 50 * (10 + (next() % 31));
    gain += xp;
    records.push(hQuest(9100 + k, xp));
    steps.push(s.accept(9100 + k, coordinate(), coordinate()), s.turnin(9100 + k, coordinate(), coordinate()));
  }
  records.push(hQuest(9199, 500, { minLevel: 11 }));
  const scenario = hScenario({ quests: records, steps, suffix: [s.note(coordinate(), coordinate()), s.accept(9199, coordinate(), coordinate())] });
  // Targets from well below the original's gain to past the threshold, some with quests replaceable.
  const target = gain - 1500 + 250 * (next() % 41);
  const goal: Partial<OptimizationGoal> = next() % 3 === 0 ? { targetXp: Math.max(0, target), grindFill: 'replace-quests' } : { targetXp: Math.max(0, target) };
  return { scenario, goal, gain };
}

describe('the model oracle on numeric targets around a suffix threshold (review COR-03, COR-05)', () => {
  it('compile refuses a target the fill cannot meet on the same side; otherwise the incumbent closes and the search equals the oracle', () => {
    const problems: string[] = [];
    let refused = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const { scenario, goal } = gatedInstance(seed);
      const compiled = harnessCompile(scenario.project, scenario.context, scenario.section, goal);
      if (!compiled.ok) {
        refused += 1;
        if (compiled.status !== 'infeasible' || !/suffix threshold/.test(compiled.reason)) problems.push(`seed ${String(seed)}: ${compiled.status} ${compiled.reason}`);
        continue;
      }
      const incumbent = evaluateSequence(compiled.problem, Int32Array.from({ length: compiled.problem.units.count }, (_, u) => u));
      if ('infeasible' in incumbent) {
        problems.push(`seed ${String(seed)}: the incumbent cannot close: ${incumbent.infeasible}`);
        continue;
      }
      const want = modelOracle(compiled.problem).best;
      const got = runSearch(compiled, { beamWidth: 5040, maxEvaluations: 10_000_000 }).solutions[0]?.comparedMs;
      if (got !== want) problems.push(`seed ${String(seed)}: oracle ${String(want)}, search ${String(got)}`);
    }
    expect(problems).toEqual([]);
    // The family reaches both sides of the threshold.
    expect(refused).toBeGreaterThan(5);
    expect(refused).toBeLessThan(55);
  }, 60_000);
});
