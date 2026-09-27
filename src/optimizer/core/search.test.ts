import { describe, expect, it } from 'vitest';
import type { QuestRecord } from '../../domain/dataset';
import type { RouteStep } from '../../domain/route';
import { createTransitions, runSequence } from './evaluate';
import { createSearch, DuplicateTable, ENTRIES_PER_KEY } from './search';
import { coreFixtures, grid40 } from './test-fixtures';
import { engineSectionMs, harnessCompile, harnessDecode, hQuest, hScenario, hSteps, runSearch, type Scenario, spliceSection } from './test-helpers';
import { type CompiledProblem, DEFAULT_SEARCH_OPTIONS, type SearchOptions, type SearchOutcome, type SearchSolution } from './types';

/** Harness H's options (§13.0): beam 16, 100,000 evaluations, no divergence penalty. */
const H_OPTIONS: Partial<SearchOptions> = { beamWidth: 16, maxEvaluations: 100_000, divergencePenalty: 0 };

function compile(scenario: Scenario, goal: Parameters<typeof harnessCompile>[3]): CompiledProblem {
  const compiled = harnessCompile(scenario.project, scenario.context, scenario.section, goal);
  if (!compiled.ok) throw new Error(`compile failed: ${compiled.reason}`);
  return compiled;
}

/** §6.3: |estimate − engine| ≤ max(1% of the engine's, 1 ms per priced part). */
function parityBound(compiled: CompiledProblem, solution: SearchSolution, engineMs: number): number {
  const transitions = createTransitions(compiled.problem);
  runSequence(transitions, solution.units, false);
  return Math.max(0.01 * engineMs, transitions.pricedParts);
}

/** The engine's section plus exit chain for a decoded solution spliced into the route. */
function engineMsOf(scenario: Scenario, compiled: CompiledProblem, solution: SearchSolution): number {
  const decoded = harnessDecode(compiled, solution);
  const { first, last } = scenario.section;
  const project = spliceSection(scenario.project, first, last, decoded.steps);
  return engineSectionMs(project, scenario.context, first, first + decoded.steps.length - 1, compiled.summary.exitChain.length);
}

/**
 * A deep copy that accepts only what structured clone carries: primitives, plain objects, arrays,
 * typed arrays, maps and sets. It throws on anything else (functions, class instances), so the
 * problem is proved clonable without the `structuredClone` global (the pure set may not name it).
 */
function deepCopy(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol') throw new Error(`not clonable: ${typeof value}`);
    return value;
  }
  if (ArrayBuffer.isView(value)) return (value as unknown as { slice(): unknown }).slice();
  if (Array.isArray(value)) return value.map(deepCopy);
  if (value instanceof Map) return new Map([...value].map(([k, v]) => [deepCopy(k), deepCopy(v)]));
  if (value instanceof Set) return new Set([...value].map(deepCopy));
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new Error('not clonable: a class instance');
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepCopy(v)]));
}

const signature = (outcome: SearchOutcome): string =>
  JSON.stringify({
    termination: outcome.termination,
    solutions: outcome.solutions.map((s) => [Array.from(s.units), s.estimatedMs, s.fillMs, s.exitMs, s.knownGain, s.unknownParts]),
    stats: { ...outcome.stats, arrayBytes: 0 },
  });

describe('the §13 fixtures at core level', () => {
  for (const fixture of coreFixtures()) {
    it(`fixture ${fixture.id}: ${String(fixture.bestMs)} ms, incumbent ${String(fixture.incumbentMs)} ms`, () => {
      const compiled = compile(fixture.scenario, fixture.goal);
      const outcome = runSearch(compiled, { ...H_OPTIONS, ...fixture.options });
      const best = outcome.solutions[0];
      if (best === undefined) throw new Error('no solution');
      expect(Math.abs(best.estimatedMs - fixture.bestMs)).toBeLessThanOrEqual(2);
      expect(Math.abs(outcome.incumbent.estimatedMs - fixture.incumbentMs)).toBeLessThanOrEqual(2);
      if (fixture.units !== undefined) expect(Array.from(best.units)).toEqual(fixture.units);
      // Fixture 11: the estimate agrees with the engine's re-walk of the decoded route, for the best and the incumbent.
      for (const solution of [best, outcome.incumbent]) {
        const engineMs = engineMsOf(fixture.scenario, compiled, solution);
        expect(Math.abs(solution.estimatedMs - engineMs)).toBeLessThanOrEqual(parityBound(compiled, solution, engineMs));
        expect(Math.abs(solution.estimatedMs - engineMs)).toBeLessThanOrEqual(0.01 * engineMs);
      }
      // Pruning removes no solution a wider search keeps: at full width, with and without duplicate
      // detection and dominance. Both runs share the rule that a node closing with its target met is
      // not expanded, so this does not cover detours through optional units with arrival radii
      // (review COR-04); the model oracle tests (hearth-waits, oracle) check against every sequence.
      if (compiled.problem.units.count <= 8 && fixture.options?.beamWidth === undefined) {
        const wide = { ...H_OPTIONS, beamWidth: 5040, maxEvaluations: 10_000_000 };
        const pruned = runSearch(compiled, wide);
        const unpruned = runSearch(compiled, { ...wide, dominance: false });
        expect(unpruned.solutions[0]?.estimatedMs).toBe(pruned.solutions[0]?.estimatedMs);
        expect(pruned.solutions[0]?.estimatedMs).toBe(best.estimatedMs);
      }
    });
  }

  it('fixture 4 ends by exhaustion at width 4', () => {
    const fixture = coreFixtures().find((f) => f.id === '4-beam4');
    if (fixture === undefined) throw new Error('missing');
    expect(runSearch(compile(fixture.scenario, fixture.goal), { ...H_OPTIONS, beamWidth: 4 }).termination).toBe('exhausted');
  });

  it('fixture 10c: B, C before C, B at exactly the same cost', () => {
    const fixture = coreFixtures().find((f) => f.id === '10c');
    if (fixture === undefined) throw new Error('missing');
    const outcome = runSearch(compile(fixture.scenario, fixture.goal), H_OPTIONS);
    expect(Array.from(outcome.solutions[0]?.units ?? [])).toEqual([2, 3, 4, 5]);
    expect(Array.from(outcome.solutions[1]?.units ?? [])).toEqual([4, 5, 2, 3]);
    expect(outcome.solutions[1]?.estimatedMs).toBe(outcome.solutions[0]?.estimatedMs);
  });

  it('fixture 8b lists the fill only when quests may be replaced', () => {
    const fixtures = coreFixtures();
    const short = fixtures.find((f) => f.id === '8b-shortfall');
    const replace = fixtures.find((f) => f.id === '8b-replace-quests');
    if (short === undefined || replace === undefined) throw new Error('missing');
    const a = runSearch(compile(short.scenario, short.goal), H_OPTIONS);
    expect(a.solutions.every((s) => s.fillMs === 0)).toBe(true);
    const b = runSearch(compile(replace.scenario, replace.goal), H_OPTIONS);
    expect(b.solutions[0]?.fillXp).toBe(1045);
    expect(b.solutions[0]?.fillMs).toBe(330_000);
  });

  it('fixture 8: the fill covers the shortfall with 6 kills', () => {
    const fixture = coreFixtures().find((f) => f.id === '8');
    if (fixture === undefined) throw new Error('missing');
    const outcome = runSearch(compile(fixture.scenario, fixture.goal), H_OPTIONS);
    expect(outcome.solutions[0]?.fillXp).toBe(570);
    expect(outcome.solutions[0]?.fillMs).toBe(180_000);
    expect(outcome.solutions[0]?.knownGain).toBe(2000);
  });
});

describe('determinism and slices (§7.6, fixture 10b)', () => {
  const compiled = compile(grid40(), {});
  const options: SearchOptions = { ...DEFAULT_SEARCH_OPTIONS, beamWidth: 64, maxEvaluations: 50_000 };

  it('ends by the budget with identical results for slices of 1, 7, 1,000 and 10^6', () => {
    const outcomes = [1, 7, 1000, 1_000_000].map((slice) => runSearch(compiled, options, slice));
    expect(outcomes[0]?.termination).toBe('budget');
    const reference = signature(outcomes[0] as SearchOutcome);
    for (const outcome of outcomes) expect(signature(outcome)).toBe(reference);
    // The budget stops the run after the work item that reached it, never inside one.
    expect(outcomes[0]?.stats.evaluations).toBeGreaterThanOrEqual(50_000);
  });

  it('gives the same output on two runs and with every hash lane constant', () => {
    const a = runSearch(compiled, options);
    const b = runSearch(compiled, options);
    const c = runSearch(compiled, { ...options, testHash: 'constant' });
    expect(signature(b)).toBe(signature(a));
    expect(signature(c)).toBe(signature(a));
  });

  it('is structured-clonable, and a deep copy searches alike (the worker receives a copy)', () => {
    const copy = deepCopy(compiled.problem) as typeof compiled.problem;
    expect(copy).not.toBe(compiled.problem);
    expect(copy.matrix).not.toBe(compiled.problem.matrix);
    const a = runSearch(compiled, options);
    const stepper = createSearch(copy, options);
    let result = stepper.advance(1_000_000);
    while (!result.done) result = stepper.advance(1_000_000);
    expect(signature(result.outcome)).toBe(signature(a));
  });

  it('improves on the grid-40 incumbent', () => {
    const outcome = runSearch(compiled, options);
    expect(outcome.solutions[0]?.estimatedMs).toBeLessThan(outcome.incumbent.estimatedMs);
    expect(outcome.stats.firstImprovementEvaluations).not.toBeNull();
    // A beam of 64 over 120 units cannot reach a closing depth in 50,000 evaluations (about
    // 64 × 120 × 40 / 2 = 153,600): no layer runs, and the budget after the seeds goes to kicks
    // (review M7Q Q-01).
    expect(outcome.stats.layers).toBe(0);
    expect(outcome.stats.rollouts).toBe(0);
    // With the beam alone (no seeds, pass or kicks), the same budget runs layers and rollouts.
    const beamOnly = runSearch(compiled, { ...options, seeds: false, localWindow: 0 });
    expect(beamOnly.stats.layers).toBeGreaterThan(0);
    expect(beamOnly.stats.rollouts).toBeGreaterThan(0);
    expect(outcome.solutions[0]?.estimatedMs).toBeLessThan(beamOnly.solutions[0]?.estimatedMs ?? 0);
  });
});

describe('work items and termination (§7.6)', () => {
  const fixture = coreFixtures().find((f) => f.id === '2');
  if (fixture === undefined) throw new Error('missing');
  const compiled = compile(fixture.scenario, fixture.goal);

  it('never cuts the first item short: a budget reached inside the nearest-neighbour seed stops the run when it ends', () => {
    const one = runSearch(compiled, { ...H_OPTIONS, maxEvaluations: 1 });
    const two = runSearch(compiled, { ...H_OPTIONS, maxEvaluations: 2 });
    expect(one.termination).toBe('budget');
    expect(one.stats.rollouts).toBe(0);
    expect(one.stats.layers).toBe(0);
    expect(one.stats.evaluations).toBeGreaterThan(2);
    expect(signature(two)).toBe(signature(one));
    // The nearest-neighbour seed falls into fixture 2's trap (142.142 s), still better than the incumbent.
    expect(one.solutions[0]?.estimatedMs).toBe(142_142);
  });

  it('ends the insertion seed and the local pass at the budget, at their own boundaries, whatever the slices', () => {
    const nearest = runSearch(compiled, { ...H_OPTIONS, maxEvaluations: 1 }).stats.evaluations;
    for (const extra of [1, 5, 20]) {
      const maxEvaluations = nearest + extra;
      const runs = [1, 3, 1_000_000].map((slice) => runSearch(compiled, { ...H_OPTIONS, maxEvaluations }, slice));
      const [reference, ...others] = runs as [SearchOutcome, ...SearchOutcome[]];
      expect(reference.termination).toBe('budget');
      expect(reference.stats.evaluations).toBeGreaterThanOrEqual(maxEvaluations);
      expect(reference.stats.rollouts).toBe(0);
      for (const other of others) expect(signature(other)).toBe(signature(reference));
    }
  });

  it('pauses mid-item and resumes exactly there', () => {
    const stepper = createSearch(compiled.problem, { ...DEFAULT_SEARCH_OPTIONS, ...H_OPTIONS });
    const first = stepper.advance(3);
    expect(first.done).toBe(false);
    // Inside the nearest-neighbour seed: one transition per evaluation, a pause after each.
    if (!first.done) expect(first.progress.evaluations).toBe(3);
    let result = stepper.advance(5);
    // A local move, or the pass's prefix states, is atomic and may overrun a slice.
    if (!result.done) expect(result.progress.evaluations).toBeGreaterThanOrEqual(8);
    while (!result.done) result = stepper.advance(5);
    expect(signature(result.outcome)).toBe(signature(runSearch(compiled, H_OPTIONS)));
  });

  it('finishes with a timeout or a cancel, keeping the solutions found so far', () => {
    const stepper = createSearch(compiled.problem, { ...DEFAULT_SEARCH_OPTIONS, ...H_OPTIONS });
    stepper.advance(10);
    const outcome = stepper.finish('cancelled');
    expect(outcome.termination).toBe('cancelled');
    expect(outcome.solutions.length).toBeGreaterThan(0);
    expect(stepper.advance(10).done).toBe(true);
  });

  it('reports the head improving through `best`', () => {
    const stepper = createSearch(compiled.problem, { ...DEFAULT_SEARCH_OPTIONS, ...H_OPTIONS });
    const bests: number[] = [];
    for (;;) {
      const result = stepper.advance(1);
      if (result.done) break;
      if (result.best !== null) bests.push(result.best.estimatedMs);
    }
    expect(bests.length).toBeGreaterThan(0);
    for (let k = 1; k < bests.length; k += 1) expect(bests[k]).toBeLessThan(bests[k - 1] ?? 0);
  });

  it('refuses invalid options', () => {
    expect(() => createSearch(compiled.problem, { ...DEFAULT_SEARCH_OPTIONS, beamWidth: 0 })).toThrow(/beamWidth/);
    expect(() => createSearch(compiled.problem, { ...DEFAULT_SEARCH_OPTIONS, candidates: 1.5 })).toThrow(/candidates/);
    expect(() => createSearch(compiled.problem, { ...DEFAULT_SEARCH_OPTIONS, maxEvaluations: -1 })).toThrow(/maxEvaluations/);
    expect(() => createSearch(compiled.problem, { ...DEFAULT_SEARCH_OPTIONS, divergencePenalty: Number.NaN })).toThrow(/divergencePenalty/);
  });

  it('keeps at most `candidates` distinct solutions, best first', () => {
    const outcome = runSearch(compiled, { ...H_OPTIONS, candidates: 2 });
    expect(outcome.solutions.length).toBeLessThanOrEqual(2);
    const keys = outcome.solutions.map((s) => Array.from(s.units).join(','));
    expect(new Set(keys).size).toBe(keys.length);
    expect(outcome.solutions[0]?.estimatedMs).toBeLessThanOrEqual(outcome.solutions[1]?.estimatedMs ?? Number.POSITIVE_INFINITY);
  });

  it('penalises divergence when asked: with a large penalty the original order wins', () => {
    const outcome = runSearch(compiled, { ...H_OPTIONS, divergencePenalty: 1_000_000 });
    expect(outcome.solutions[0]?.estimatedMs).toBeLessThanOrEqual(outcome.incumbent.estimatedMs);
  });
});

describe('the duplicate table (§7.2, §7.3)', () => {
  /** Candidates as (key, elapsed, readyAt, selection rank); lanes from the key, or constant. */
  function table(entries: readonly (readonly [number, number, number, number])[], constant = false) {
    const alive = entries.map(() => true);
    const t = new DuplicateTable(64, {
      lanes: (c) => ({ h1: constant ? 0 : (entries[c]?.[0] ?? 0), h2: 0 }),
      sameKey: (a, b) => entries[a]?.[0] === entries[b]?.[0],
      dominance: (a, b) => {
        const x = entries[a];
        const y = entries[b];
        if (x === undefined || y === undefined) return 0;
        const aBetter = x[1] < y[1] || x[2] < y[2];
        const bBetter = x[1] > y[1] || x[2] > y[2];
        if (aBetter && !bBetter) return -1;
        if (bBetter && !aBetter) return 1;
        return aBetter ? 0 : 2;
      },
      before: (a, b) => (entries[a]?.[3] ?? 0) - (entries[b]?.[3] ?? 0),
    }, (c, value) => {
      alive[c] = value;
    });
    entries.forEach((_, c) => t.insert(c));
    return { alive, t };
  }

  for (const constant of [false, true]) {
    it(`keeps at most ${String(ENTRIES_PER_KEY)} non-dominated entries per key, dropping the last in selection order${constant ? ' (constant lanes)' : ''}`, () => {
      // Five mutually non-dominated entries of key 1 (elapsed falls as readyAt rises); ranks 4, 0, 3, 1, 2.
      const { alive, t } = table([
        [1, 10, 50, 4],
        [1, 20, 40, 0],
        [1, 30, 30, 3],
        [1, 40, 20, 1],
        [1, 50, 10, 2],
        [2, 99, 99, 5],
      ], constant);
      expect(alive).toEqual([false, true, true, true, true, true]);
      expect(t.duplicates).toBe(1);
    });
  }

  it('drops a dominated newcomer, replaces dominated entries, and keeps the first of exact ties', () => {
    const { alive, t } = table([
      [1, 10, 10, 0],
      [1, 20, 10, 1],
      [1, 10, 10, 2],
      [1, 5, 5, 3],
    ]);
    expect(alive).toEqual([false, false, false, true]);
    expect(t.dominated).toBe(2);
    expect(t.duplicates).toBe(1);
  });

  it('clears between layers', () => {
    const { t } = table([[1, 10, 10, 0]]);
    t.clear();
    expect(Array.from(t.slots).every((slot) => slot === -1)).toBe(true);
  });
});

describe('closes refused only by the XP-4 fill rule (review PAR-04)', () => {
  /** Quest 603 (level 5) gives 100 XP less after quest 602 levels to 11; quest 604's XP is unknown. */
  function scenario(): Scenario {
    const s = hSteps();
    return hScenario({
      quests: [hQuest(604, null), hQuest(603, 500, { level: 5, xp: { questLevel: 5, baseXp: 500, basis: 'era-seed' } }), hQuest(602, 7600)],
      steps: [...s.quest(604, 0, 0), ...s.quest(603, 500, 0), ...s.quest(602, 0, 50)],
      exit: { x: 500, y: 10 },
    });
  }

  it('are reported with the smallest known-XP shortfall, and the target lowered by it lets the order close', () => {
    const outcome = runSearch(compile(scenario(), {}), H_OPTIONS);
    // The faster order gains 8,000 known XP against 8,100, and no fill may follow quest 604's unknown XP.
    expect(Array.from(outcome.solutions[0]?.units ?? [])).toEqual([0, 1, 2, 3, 4, 5]);
    expect(outcome.unknownXpBlocked?.smallestShortfall).toBe(100);
    expect(outcome.unknownXpBlocked?.closes).toBeGreaterThan(0);
    const lowered = runSearch(compile(scenario(), { targetXp: 8000 }), H_OPTIONS);
    expect(Array.from(lowered.solutions[0]?.units ?? [])).toEqual([0, 1, 4, 5, 2, 3]);
    expect(lowered.solutions[0]?.estimatedMs).toBeLessThan(outcome.incumbent.estimatedMs);
  });

  it('are null when no close was refused for that reason', () => {
    const fixture = coreFixtures().find((f) => f.id === '1');
    if (fixture === undefined) throw new Error('missing');
    expect(runSearch(compile(fixture.scenario, fixture.goal), H_OPTIONS).unknownXpBlocked).toBeNull();
  });
});

describe('the local pass (reviews PRF-08 and M7 open item 1)', () => {
  /** Twelve quests at seeded points, in the nearest-ready-action order from the start: a good incumbent. */
  function nearestNeighbour(): Scenario {
    let x = 2;
    const next = (): number => {
      x = (x * 48271) % 2147483647;
      return x;
    };
    const s = hSteps();
    const quests: QuestRecord[] = [];
    const points: { readonly a: { readonly x: number; readonly y: number }; readonly t: { readonly x: number; readonly y: number } }[] = [];
    for (let k = 0; k < 12; k += 1) {
      quests.push(hQuest(3000 + k, 500));
      const a = { x: next() % 1500, y: next() % 1500 };
      points.push({ a, t: next() % 3 === 0 ? a : { x: next() % 1500, y: next() % 1500 } });
    }
    const steps: RouteStep[] = [];
    const accepted = new Set<number>();
    const done = new Set<number>();
    let here = { x: 0, y: 0 };
    while (done.size < 12) {
      let pick = -1;
      let best = Number.POSITIVE_INFINITY;
      points.forEach((point, k) => {
        if (done.has(k)) return;
        const p = accepted.has(k) ? point.t : point.a;
        const d = Math.sqrt((p.x - here.x) * (p.x - here.x) + (p.y - here.y) * (p.y - here.y));
        if (d < best) {
          best = d;
          pick = k;
        }
      });
      const point = points[pick];
      if (point === undefined) throw new Error('no pick');
      const turnin = accepted.has(pick);
      const p = turnin ? point.t : point.a;
      steps.push(turnin ? s.turnin(3000 + pick, p.x, p.y) : s.accept(3000 + pick, p.x, p.y));
      if (turnin) done.add(pick);
      else accepted.add(pick);
      here = p;
    }
    return hScenario({ quests, steps, exit: { x: 0, y: 0 } });
  }

  it('improves a nearest-neighbour incumbent the beam alone cannot, the same whatever the slices', () => {
    const compiled = compile(nearestNeighbour(), {});
    const beamOnly = runSearch(compiled, { ...H_OPTIONS, localWindow: 0, seeds: false });
    expect(beamOnly.termination).toBe('exhausted');
    expect(beamOnly.solutions[0]?.estimatedMs).toBe(beamOnly.incumbent.estimatedMs);
    // The seeds alone: the nearest-neighbour seed is the incumbent's own order, and insertion is no better.
    const seedsOnly = runSearch(compiled, { ...H_OPTIONS, localWindow: 0 });
    expect(seedsOnly.solutions[0]?.estimatedMs).toBe(seedsOnly.incumbent.estimatedMs);
    const outcome = runSearch(compiled, H_OPTIONS);
    expect(outcome.incumbent.estimatedMs).toBe(935_936);
    // The single-unit pass of the first build reached 839,818 ms; the four neighbourhoods, polishing
    // each rollout's order too, reach the same as a beam of 1,024 (a beam of 5,040 without the pass: 735,144 ms).
    expect(outcome.solutions[0]?.estimatedMs).toBe(716_708);
    expect(runSearch(compiled, { ...H_OPTIONS, localWindow: 0, seeds: false, beamWidth: 5040, maxEvaluations: 10_000_000 }).solutions[0]?.estimatedMs).toBe(735_144);
    expect(outcome.stats.firstImprovementEvaluations).not.toBeNull();
    for (const slice of [1, 7, 1000]) expect(signature(runSearch(compiled, H_OPTIONS, slice))).toBe(signature(outcome));
  });

  it('rejects a negative window', () => {
    const fixture = coreFixtures().find((f) => f.id === '1');
    if (fixture === undefined) throw new Error('missing');
    expect(() => createSearch(compile(fixture.scenario, fixture.goal).problem, { ...DEFAULT_SEARCH_OPTIONS, localWindow: -1 })).toThrow(RangeError);
  });
});
