import { describe, expect, it } from 'vitest';
import type { QuestRecord } from '../../domain/dataset';
import type { RouteStep } from '../../domain/route';
import { type AnytimeHost, Meter } from './anytime';
import { createTransitions, evaluateSequence, solutionOf } from './evaluate';
import { KICK_MIN_UNITS, KICK_STALL_FLOOR, KICK_STALL_PER_UNIT, Kicks } from './kicks';
import { LocalSearch } from './local';
import { INSERTION_PER_UNIT, InsertionSeed, NearestNeighbourSeed } from './seeds';
import { coreFixtures, grid40 } from './test-fixtures';
import { engineSectionMs, harnessCompile, harnessDecode, hQuest, hScenario, hSteps, runSearch, type Scenario, spliceSection } from './test-helpers';
import type { Closed } from './transitions';
import type { CompiledProblem, SearchOptions, SearchProblem, SearchSolution } from './types';

/**
 * The anytime parts of the search (docs/research/optimizer-m7.md §19; M7 open item 1): the
 * nearest-neighbour and cheapest-insertion seeds, and the local pass (or-opt, exchange, 2-opt).
 * Every order they report must be one the search's own pricing accepts (so the section contract
 * holds), keep every precedence edge, and agree with the engine's re-walk (fixture 11); the search
 * must never end worse than its best seed.
 */

const H_OPTIONS: Partial<SearchOptions> = { beamWidth: 16, maxEvaluations: 100_000, divergencePenalty: 0 };

function compile(scenario: Scenario, goal: Parameters<typeof harnessCompile>[3] = {}): CompiledProblem {
  const compiled = harnessCompile(scenario.project, scenario.context, scenario.section, goal);
  if (!compiled.ok) throw new Error(`compile failed: ${compiled.reason}`);
  return compiled;
}

/** A host that keeps every reported solution, with an unlimited slice and the given budget. */
function host(problem: SearchProblem, max = Number.MAX_SAFE_INTEGER): AnytimeHost & { readonly solutions: SearchSolution[] } {
  const meter = new Meter(max);
  meter.left = Number.MAX_SAFE_INTEGER;
  const solutions: SearchSolution[] = [];
  return {
    problem,
    t: createTransitions(problem),
    meter,
    solutions,
    addSolution(units: ArrayLike<number>, closed: Closed) {
      solutions.push(solutionOf(units, closed));
    },
    noteRefusal() {
      // Not counted here.
    },
  };
}

function seedOf(problem: SearchProblem, kind: 'nearest' | 'insertion', max?: number): { readonly result: SearchSolution | null; readonly evaluations: number } {
  const h = host(problem, max);
  const seed = kind === 'nearest' ? new NearestNeighbourSeed(h) : new InsertionSeed(h);
  while (!seed.step()) {
    // Unlimited slice: one call.
  }
  return { result: seed.result, evaluations: h.meter.evaluations };
}

/** Every precedence edge between two listed units keeps its direction. */
function keepsEdges(problem: SearchProblem, units: Int32Array): boolean {
  const at = new Int32Array(problem.units.count).fill(-1);
  units.forEach((u, k) => {
    at[u] = k;
  });
  const { predStart, pred } = problem.edges;
  for (let k = 0; k < units.length; k += 1) {
    const u = units[k] ?? 0;
    for (let e = predStart[u] ?? 0; e < (predStart[u + 1] ?? 0); e += 1) {
      const p = at[pred[e] ?? 0] ?? -1;
      if (p > k) return false;
    }
  }
  return true;
}

/** The order re-priced from scratch by the search's own transitions and closing equals the reported figures. */
function expectFeasible(problem: SearchProblem, solution: SearchSolution): void {
  const again = evaluateSequence(problem, solution.units);
  if ('infeasible' in again) throw new Error(`reported order is infeasible: ${again.infeasible}`);
  expect(again.comparedMs).toBe(solution.comparedMs);
  expect(again.estimatedMs).toBe(solution.estimatedMs);
  expect(keepsEdges(problem, solution.units)).toBe(true);
}

/** Fixture 11 for an order: the estimate agrees with the engine's re-walk of the decoded route. */
function expectParity(scenario: Scenario, compiled: CompiledProblem, solution: SearchSolution): void {
  const decoded = harnessDecode(compiled, solution);
  const { first, last } = scenario.section;
  const project = spliceSection(scenario.project, first, last, decoded.steps);
  const engineMs = engineSectionMs(project, scenario.context, first, first + decoded.steps.length - 1, compiled.summary.exitChain.length);
  expect(Math.abs(solution.estimatedMs - engineMs)).toBeLessThanOrEqual(Math.max(1, 0.01 * engineMs));
}

/** Twenty quests at seeded points, taken in id order: a weak incumbent with accepts, completes and turn-ins. */
function scattered(seed: number): Scenario {
  let x = seed;
  const next = (): number => {
    x = (x * 48271) % 2147483647;
    return x;
  };
  const s = hSteps();
  const quests: QuestRecord[] = [];
  const steps: RouteStep[] = [];
  for (let k = 0; k < 20; k += 1) {
    const id = 4000 + k;
    quests.push(hQuest(id, 300 + 50 * (next() % 10)));
    steps.push(s.accept(id, next() % 1200, next() % 1200), s.turnin(id, next() % 1200, next() % 1200));
  }
  return hScenario({ quests, steps, exit: { x: 600, y: 600 } });
}

describe('the constructive seeds (M7 open item 1)', () => {
  const cases: [string, Scenario, Parameters<typeof harnessCompile>[3]][] = [
    ['grid-40', grid40(), {}],
    ['scattered 1', scattered(1), {}],
    ['scattered 2', scattered(2), {}],
    ...coreFixtures().map((f): [string, Scenario, Parameters<typeof harnessCompile>[3]] => [`fixture ${f.id}`, f.scenario, f.goal]),
  ];

  it.each(cases)('%s: each seed is an order the search accepts, keeps every edge and agrees with the engine', (_name, scenario, goal) => {
    const compiled = compile(scenario, goal);
    for (const kind of ['nearest', 'insertion'] as const) {
      const { result } = seedOf(compiled.problem, kind);
      if (result === null) continue;
      expectFeasible(compiled.problem, result);
      expectParity(scenario, compiled, result);
    }
  });

  it('the insertion seed places every unit (it drops no quest)', () => {
    for (const scenario of [grid40(), scattered(3)]) {
      const compiled = compile(scenario);
      const { result } = seedOf(compiled.problem, 'insertion');
      expect(result?.units.length).toBe(compiled.problem.units.count);
    }
  });

  it('both seeds beat a weak incumbent on the grid and the scattered pools', () => {
    for (const scenario of [grid40(), scattered(1), scattered(2)]) {
      const compiled = compile(scenario);
      const nearest = seedOf(compiled.problem, 'nearest').result;
      const insertion = seedOf(compiled.problem, 'insertion').result;
      if (nearest === null || insertion === null) throw new Error('a seed did not close');
      expect(nearest.comparedMs).toBeLessThan(compiled.stats.incumbentMs);
      expect(insertion.comparedMs).toBeLessThan(compiled.stats.incumbentMs);
    }
  });

  it('the nearest-neighbour seed applies one transition per unit when none is refused', () => {
    const compiled = compile(grid40());
    expect(seedOf(compiled.problem, 'nearest').evaluations).toBe(compiled.problem.units.count);
  });

  it('the insertion seed finishes by nearest neighbour when its allowance is spent, so the spend yields a route (review M7Q Q-03)', () => {
    const compiled = compile(grid40());
    const units = compiled.problem.units.count;
    const full = seedOf(compiled.problem, 'insertion');
    expect(full.result).not.toBeNull();
    // The allowance is min(INSERTION_PER_UNIT × units, budget / 2): with the full cost as the
    // budget, it is half the full cost.
    expect(full.evaluations).toBeLessThan(INSERTION_PER_UNIT * units);
    const h = host(compiled.problem, full.evaluations);
    const seed = new InsertionSeed(h);
    while (!seed.step()) {
      // Unlimited slice.
    }
    expect(seed.finished).toBe(true);
    const result = seed.result;
    if (result === null) throw new Error('the capped insertion seed gave no route');
    // A whole order: every unit placed, no quest dropped, and the search's own pricing agrees.
    expect(result.units.length).toBe(units);
    expectFeasible(compiled.problem, result);
    // Half the budget, at most one sub-step past it (every position priced twice), then one
    // nearest-neighbour choice per unit left (at most every enabled unit tried).
    expect(h.meter.evaluations).toBeGreaterThanOrEqual(Math.floor(full.evaluations / 2));
    expect(h.meter.evaluations).toBeLessThan(full.evaluations);
    expect(h.meter.evaluations).toBeLessThanOrEqual(Math.floor(full.evaluations / 2) + 2 * (units + 1) + units * units);
  });

  it('the insertion seed ends without a result only at the budget of the run', () => {
    const compiled = compile(grid40());
    const spent = seedOf(compiled.problem, 'insertion', 40);
    expect(spent.result).toBeNull();
    expect(spent.evaluations).toBeGreaterThanOrEqual(40);
  });

  it('the search never ends worse than its best seed', () => {
    for (const scenario of [grid40(), scattered(1), scattered(2), scattered(3)]) {
      const compiled = compile(scenario);
      const seeds = [seedOf(compiled.problem, 'nearest').result, seedOf(compiled.problem, 'insertion').result].filter((s): s is SearchSolution => s !== null);
      const best = Math.min(...seeds.map((s) => s.comparedMs));
      for (const options of [H_OPTIONS, { ...H_OPTIONS, beamWidth: 1 }, { ...H_OPTIONS, localWindow: 0 }]) {
        const outcome = runSearch(compiled, options);
        expect(outcome.solutions[0]?.comparedMs).toBeLessThanOrEqual(best);
      }
    }
  });

  it('are off under a divergence penalty, with the local pass and the kicks: the beam alone (review M7Q Q-08, D-044 item 6)', () => {
    const compiled = compile(scattered(1));
    const penalised = runSearch(compiled, { ...H_OPTIONS, divergencePenalty: 5 });
    const plain = runSearch(compiled, { ...H_OPTIONS, divergencePenalty: 5, seeds: false, localWindow: 0 });
    const strip = (o: typeof plain) => ({ solutions: o.solutions.map((s) => [Array.from(s.units), s.comparedMs]), stats: { ...o.stats, arrayBytes: 0 } });
    expect(strip(penalised)).toEqual(strip(plain));
  });
});

describe('the local pass: or-opt, exchange and 2-opt (M7 open item 1)', () => {
  /** A seeded shuffle of the incumbent that keeps each quest's accept before its turn-in. */
  function shuffled(problem: SearchProblem, seed: number): Int32Array | null {
    let x = seed;
    const next = (): number => {
      x = (x * 48271) % 2147483647;
      return x;
    };
    const t = createTransitions(problem);
    const s = t.createState();
    const order: number[] = [];
    for (;;) {
      const enabled: number[] = [];
      for (let u = 0; u < t.units; u += 1) if (t.enabled(s, u)) enabled.push(u);
      if (enabled.length === 0) break;
      const u = enabled[next() % enabled.length] ?? 0;
      if (!t.apply(s, u)) return null;
      t.logSize = 0;
      order.push(u);
    }
    return Int32Array.from(order);
  }

  it.each([1, 2, 3, 4, 5])('from a random order (seed %i), every order it reports is accepted, keeps the edges, agrees with the engine and improves', (seed) => {
    const scenario = scattered(seed);
    const compiled = compile(scenario);
    const units = shuffled(compiled.problem, seed);
    if (units === null) throw new Error('the shuffle broke');
    const start = evaluateSequence(compiled.problem, units);
    if ('infeasible' in start) throw new Error(start.infeasible);
    const h = host(compiled.problem);
    const pass = new LocalSearch(h, 24);
    expect(pass.wants(start)).toBe(true);
    while (!pass.step(start)) {
      // Unlimited slice.
    }
    expect(h.solutions.length).toBeGreaterThan(0);
    let previous = start.comparedMs;
    for (const solution of h.solutions) {
      expectFeasible(compiled.problem, solution);
      // Each kept move lowers the time.
      expect(solution.comparedMs).toBeLessThan(previous);
      previous = solution.comparedMs;
    }
    const last = h.solutions[h.solutions.length - 1];
    if (last === undefined) throw new Error('no solution');
    expectParity(scenario, compiled, last);
    // A pass is not repeated on its own start or its result.
    expect(pass.wants(start)).toBe(false);
    expect(pass.wants(last)).toBe(false);
  });

  it('never moves a unit across its own precedence edges, even when the reversal would be cheaper', () => {
    // A quest whose turn-in lies at the start and accept far away: a reversal of accept … turn-in
    // would save travel but put the turn-in first.
    const s = hSteps();
    const quests = [hQuest(5000, 500), hQuest(5001, 500), hQuest(5002, 500)];
    const steps = [s.accept(5000, 900, 0), s.accept(5001, 450, 0), s.turnin(5001, 300, 0), s.turnin(5000, 0, 0), s.accept(5002, 100, 0), s.turnin(5002, 100, 0)];
    const scenario = hScenario({ quests, steps, exit: { x: 0, y: 0 } });
    const compiled = compile(scenario);
    const outcome = runSearch(compiled, H_OPTIONS);
    for (const solution of outcome.solutions) expectFeasible(compiled.problem, solution);
  });

  it('is off with a window of 0', () => {
    const compiled = compile(scattered(1));
    const h = host(compiled.problem);
    const pass = new LocalSearch(h, 0);
    expect(pass.wants(compiled.problem.units.count > 0 ? runSearch(compiled, { ...H_OPTIONS, localWindow: 0 }).incumbent : undefined)).toBe(false);
  });
});


describe('the drop move (D-044, review M7Q Q-05)', () => {
  const fixture2 = (): { readonly scenario: Scenario; readonly goal: Parameters<typeof harnessCompile>[3] } => {
    const f = coreFixtures().find((x) => x.id === '2');
    if (f === undefined) throw new Error('missing');
    return { scenario: f.scenario, goal: f.goal };
  };

  it('is on for a numeric target or replace-quests, and off under keep-original with the shortfall fill', () => {
    const { scenario } = fixture2();
    expect(compile(scenario, { targetXp: 3000 }).problem.dropMove).toBe(true);
    expect(compile(scenario, { targetXp: 3000, grindFill: 'replace-quests' }).problem.dropMove).toBe(true);
    expect(compile(scenario, {}).problem.dropMove).toBe(false);
    expect(compile(scenario, { grindFill: 'replace-quests' }).problem.dropMove).toBe(true);
  });

  it('drops a quest only when the problem allows it: the pass over the same order keeps every unit otherwise', () => {
    const { scenario, goal } = fixture2();
    const compiled = compile(scenario, goal);
    const start = runSearch(compiled, { ...H_OPTIONS, localWindow: 0, seeds: false }).incumbent;
    const passOver = (problem: SearchProblem): SearchSolution => {
      const h = host(problem);
      const pass = new LocalSearch(h, 24);
      while (!pass.step(start)) {
        // Unlimited slice.
      }
      return h.solutions.reduce((best, x) => (x.comparedMs < best.comparedMs ? x : best), start);
    };
    // Fixture 2 at 3,000 XP: dropping N (the first quest) is the improvement.
    const dropping = passOver(compiled.problem);
    expect(dropping.units.length).toBeLessThan(start.units.length);
    // The same problem with the move off: only reorders, so every unit stays.
    const keeping = passOver({ ...compiled.problem, dropMove: false });
    expect(keeping.units.length).toBe(start.units.length);
  });
});

describe('the kicks: the iterated local search after the seeds (review M7Q Q-01, Q-07)', () => {
  it('improve on the seeds and their passes, with orders the search accepts, the same whatever the slices', () => {
    let strictlyBetter = 0;
    for (const scenario of [scattered(1), scattered(2), scattered(3), grid40()]) {
      const compiled = compile(scenario);
      expect(compiled.problem.units.count).toBeGreaterThanOrEqual(KICK_MIN_UNITS);
      const options = { ...H_OPTIONS, maxEvaluations: 200_000 };
      const withKicks = runSearch(compiled, options);
      const without = runSearch(compiled, { ...options, kicks: false });
      const best = withKicks.solutions[0];
      if (best === undefined) throw new Error('no solution');
      expect(best.comparedMs).toBeLessThanOrEqual(without.solutions[0]?.comparedMs ?? 0);
      if (best.comparedMs < (without.solutions[0]?.comparedMs ?? 0)) strictlyBetter += 1;
      for (const solution of withKicks.solutions) expectFeasible(compiled.problem, solution);
      expectParity(scenario, compiled, best);
      for (const slice of [7, 977]) expect(JSON.stringify(runSearch(compiled, options, slice))).toBe(JSON.stringify(withKicks));
    }
    expect(strictlyBetter).toBeGreaterThan(0);
  }, 60_000);

  it('stop when the best has not improved for the stall allowance: termination converged, before the budget', { timeout: 60_000 }, () => {
    const compiled = compile(scattered(2));
    const units = compiled.problem.units.count;
    const outcome = runSearch(compiled, { ...H_OPTIONS, maxEvaluations: 50_000_000 });
    expect(outcome.termination).toBe('converged');
    expect(outcome.stats.evaluations).toBeLessThan(50_000_000);
    // The allowance: max(floor, per unit × units); the run went at least that far past its last improvement.
    const allowance = Math.max(KICK_STALL_FLOOR, KICK_STALL_PER_UNIT * units);
    const h = host(compiled.problem);
    expect(new Kicks(h, new LocalSearch(h, 24)).stallAllowance).toBe(allowance);
    expect(outcome.stats.evaluations).toBeGreaterThanOrEqual(allowance);
  });

  it('a larger budget only continues the same run: the best never gets worse as the budget grows', { timeout: 60_000 }, () => {
    const compiled = compile(scattered(3));
    let previous = Number.POSITIVE_INFINITY;
    for (const maxEvaluations of [20_000, 60_000, 150_000, 400_000]) {
      const best = runSearch(compiled, { ...H_OPTIONS, maxEvaluations }).solutions[0]?.comparedMs ?? Number.POSITIVE_INFINITY;
      expect(best).toBeLessThanOrEqual(previous);
      previous = best;
    }
  });

  it('are off below KICK_MIN_UNITS units, with the pass off, under a divergence penalty and with kicks: false', () => {
    const small = coreFixtures().find((f) => f.id === '1');
    if (small === undefined) throw new Error('missing');
    const compiledSmall = compile(small.scenario, small.goal);
    expect(compiledSmall.problem.units.count).toBeLessThan(KICK_MIN_UNITS);
    expect(runSearch(compiledSmall, H_OPTIONS).termination).toBe('exhausted');
    const compiled = compile(scattered(1));
    for (const options of [{ localWindow: 0 }, { divergencePenalty: 5 }, { kicks: false }]) {
      expect(runSearch(compiled, { ...H_OPTIONS, maxEvaluations: 400_000, ...options }).termination).not.toBe('converged');
    }
  });
});
