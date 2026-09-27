import { describe, expect, it } from 'vitest';
import { worldMapId } from '../../domain/ids';
import type { RouteStep } from '../../domain/route';
import type { TravelModel } from '../../domain/travel';
import { at } from '../../engine/test-helpers';
import { evaluateSequence } from './evaluate';
import { createMatrixCache } from './matrix';
import { compileProblem, isDynamicCode, transferList } from './problem';
import { analyseSection, MAX_LOCATIONS } from './section';
import { coreFixtures } from './test-fixtures';
import { harnessInput, harnessWalk, hQuest, hScenario, hSteps, runSearch, type Scenario } from './test-helpers';
import type { CompiledProblem, CompileFailure } from './types';

/** `compileProblem` (docs/research/optimizer-m7.md §5). */

function fixture(id: string): { readonly scenario: Scenario; readonly goal: Parameters<typeof harnessInput>[3] } {
  const found = coreFixtures().find((f) => f.id === id);
  if (found === undefined) throw new Error(`no fixture ${id}`);
  return found;
}

function compile(scenario: Scenario, goal: Parameters<typeof harnessInput>[3] = {}, options: Parameters<typeof compileProblem>[2] = {}): CompiledProblem | CompileFailure {
  const input = harnessInput(scenario.project, scenario.context, scenario.section, goal);
  const analysis = analyseSection(input);
  if (!analysis.ok) return analysis;
  return compileProblem(analysis, input.walk, options);
}

describe('compileProblem', () => {
  it('compiles fixture 6 and prices the incumbent within parity of the engine', () => {
    const { scenario, goal } = fixture('6');
    const compiled = compile(scenario, goal);
    if (!compiled.ok) throw new Error(compiled.reason);
    expect(compiled.stats).toMatchObject({ units: 5, anchors: 1, blocks: 0, tiers: 1 });
    expect(Math.abs(compiled.stats.incumbentMs - compiled.summary.original.sectionPlusExitMs)).toBeLessThanOrEqual(0.01 * compiled.summary.original.sectionPlusExitMs);
    expect(compiled.summary).toMatchObject({ pool: [601, 602], obligatory: [601], carried: [], firstSuffixIndex: 5, exitChain: [5] });
    expect(compiled.problem.targetXp).toBe(3760);
    // The kill objective's block is priced lazily in the worker from the slice.
    expect(compiled.problem.pricing.blocks).toHaveLength(1);
    expect(compiled.problem.pricing.npcs.map((npc) => npc.id)).toEqual([6100]);
  });

  it('lists every typed-array buffer once, for the transfer to the worker', () => {
    const { scenario, goal } = fixture('7e');
    const compiled = compile(scenario, goal);
    if (!compiled.ok) throw new Error(compiled.reason);
    const buffers = transferList(compiled.problem);
    expect(new Set(buffers).size).toBe(buffers.length);
    expect(buffers).toContain(compiled.problem.matrix.buffer);
    expect(compiled.transfer).toEqual(buffers);
  });

  it('copies a cached matrix, so a transfer never detaches the cache’s own buffer', () => {
    const { scenario, goal } = fixture('2');
    const cache = createMatrixCache();
    const first = compile(scenario, goal, { cache });
    const second = compile(scenario, goal, { cache });
    if (!first.ok || !second.ok) throw new Error('compile failed');
    expect(cache.size()).toBe(1);
    expect(Array.from(second.problem.matrix)).toEqual(Array.from(first.problem.matrix));
    expect(second.problem.matrix.buffer).not.toBe(first.problem.matrix.buffer);
    second.problem.matrix.fill(0);
    const third = compile(scenario, goal, { cache });
    if (!third.ok) throw new Error('compile failed');
    expect(Array.from(third.problem.matrix)).toEqual(Array.from(first.problem.matrix));
  });

  it('refuses a baseline whose structure differs from the analysis', () => {
    const { scenario } = fixture('2');
    const input = harnessInput(scenario.project, scenario.context, scenario.section);
    const analysis = analyseSection(input);
    if (!analysis.ok) throw new Error(analysis.reason);
    const s = hSteps();
    const other = hScenario({ quests: [hQuest(201, 1000), hQuest(202, 1000), hQuest(203, 1000), hQuest(204, 1000)], steps: [...s.quest(201, -100, 0), ...s.quest(202, 900, 0), s.travel(null, 0), ...s.quest(203, 950, 50), s.accept(204, 1000, 0)], exit: { x: 1000, y: 0 } });
    const baseline = harnessWalk(other.project, other.context, other.section).walk;
    expect(compileProblem(analysis, baseline)).toMatchObject({ ok: false, status: 'failed' });
  });

  it('refuses a baseline without the probe’s availability findings', () => {
    const { scenario } = fixture('5');
    const input = harnessInput(scenario.project, scenario.context, scenario.section);
    const analysis = analyseSection(input);
    if (!analysis.ok) throw new Error(analysis.reason);
    expect(compileProblem(analysis, { ...input.walk, probe: null })).toMatchObject({ ok: false, status: 'failed', reason: expect.stringMatching(/probe/) as unknown });
  });

  it('refuses a section with more locations than the limit', () => {
    const s = hSteps();
    const steps = Array.from({ length: MAX_LOCATIONS + 5 }, (_, k) => s.note(k + 1, 0));
    const scenario = hScenario({ quests: [hQuest(1, 1000)], steps: [...s.quest(1, 5, 5), ...steps], exit: { x: 0, y: 0 } });
    expect(analyseSection(harnessInput(scenario.project, scenario.context, scenario.section))).toMatchObject({ ok: false, status: 'failed', reason: expect.stringMatching(/section too large/) as unknown });
  });

  it('refuses more legs than "computing paths" may be asked for, with the navigation model', () => {
    const s = hSteps();
    const quests = Array.from({ length: 70 }, (_, k) => hQuest(100 + k, 100));
    const steps = quests.flatMap((_, k) => [s.accept(100 + k, 10 * k, 3 * k), s.turnin(100 + k, -7 * k, 11 * k)]);
    const scenario = hScenario({ quests, steps, exit: { x: 0, y: 0 } });
    const straight = scenario.context.travel;
    const navigation: TravelModel = { ...straight, id: 'navigation', revision: 'test', leg: (from, to, speeds) => straight.leg(from, to, speeds) };
    const input = harnessInput(scenario.project, { ...scenario.context, travel: navigation }, scenario.section);
    expect(analyseSection(input)).toMatchObject({ ok: false, status: 'failed', reason: expect.stringMatching(/legs of 13,500|legs of 13500/) as unknown });
    // The straight-line model has no "computing paths": the same section compiles.
    expect(compile(scenario).ok).toBe(true);
  });

  it('marks VAL-4, VAL-5, VAL-20 and a breadcrumb target’s availability as the dynamic codes', () => {
    expect(['VAL004-min-level', 'VAL004-min-level-uncertain', 'VAL005-max-level', 'VAL020-quest-log-full', 'VAL013-breadcrumb-target-unavailable'].every(isDynamicCode)).toBe(true);
    expect(['VAL013-breadcrumb-target-taken', 'VAL008-prequest-single', 'VAL001-already-in-log', 'DATA002-unknown-quest'].some(isDynamicCode)).toBe(false);
  });

  it('never needs a location it did not collect: every requested pair is readable', () => {
    for (const f of coreFixtures()) {
      const compiled = compile(f.scenario, f.goal);
      if (!compiled.ok) throw new Error(`${f.id}: ${compiled.reason}`);
      expect(compiled.problem.locations.count).toBeGreaterThan(0);
      expect(compiled.problem.neighbourStart.length).toBe(compiled.problem.locations.count + 1);
    }
    expect(at(0, 0).radius).toBeNull();
  });
});

describe('the incumbent and the suffix (review COR-03, PAR-01, PAR-06)', () => {
  /** Two quests, then a suffix accept gated at level 11 (a threshold at +7,600 known XP; the original gains 2,000). */
  function gated(): Scenario {
    const s = hSteps();
    const steps = [s.accept(901, 100, 0), s.turnin(901, 100, 0), s.accept(902, 0, 100), s.turnin(902, 0, 100)];
    return hScenario({ quests: [hQuest(901, 1000), hQuest(902, 1000), hQuest(903, 500, { minLevel: 11 })], steps, suffix: [s.note(50, 50), s.accept(903, 60, 60)] });
  }

  it('refuses a target whose fill would take the section end across a suffix threshold', () => {
    const refused = compile(gated(), { targetXp: 7600 });
    expect(refused).toMatchObject({ ok: false, status: 'infeasible', reason: expect.stringMatching(/target of 7600 known XP cannot be met without changing the rest of the route: .*suffix threshold/) as unknown });
    // Below the threshold the incumbent, with its fill, passes every closing rule, not only the reference pricing.
    const kept = compile(gated(), { targetXp: 5000 });
    if (!kept.ok) throw new Error(kept.reason);
    // The fill's kills overshoot the 3,000 XP it needs by 40.
    expect(evaluateSequence(kept.problem, Int32Array.from([0, 1, 2, 3]))).toMatchObject({ fillXp: 3040, knownGain: 2000 });
  });

  it('prices a move between world maps at the start of the exit chain as unknown travel, as the engine does', () => {
    const s = hSteps();
    const scenario = hScenario({
      quests: [hQuest(801, 1000), hQuest(802, 1000)],
      steps: [...s.quest(801, 300, 0), ...s.quest(802, -100, 0)],
      // No transport joins Kalimdor and the Eastern Kingdoms here: the engine's SIM-4 fact.
      suffix: [s.travel(0, 0, { location: at(100, 100, worldMapId(0)) })],
    });
    const compiled = compile(scenario);
    if (!compiled.ok) throw new Error(compiled.reason);
    expect(compiled.summary.exitChain).toEqual([4]);
    const outcome = runSearch(compiled, { beamWidth: 16 });
    expect(outcome.incumbent).toMatchObject({ estimatedMs: 82_000, unknownParts: 1 });
    expect(outcome.solutions[0]).toMatchObject({ estimatedMs: 62_000, unknownParts: 1 });
    expect(Array.from(outcome.solutions[0]?.units ?? [])).toEqual([2, 3, 0, 1]);
  });

  it('fills up to the suffix floor when a lower target leaves a reorder below a threshold the original crossed', () => {
    // Quest 603 (level 5) gives 500 XP at level 10 and 400 at level 11; quest 602 levels to 11. The
    // faster order turns 602 in first and gains 100 XP less. A suffix skip reads level 11 + 500 XP,
    // exactly the original's end, so the section must end there or above (ΔLo = 0).
    const s = hSteps();
    const steps: RouteStep[] = [...s.quest(603, 500, 0), ...s.quest(602, 0, 50)];
    const skip = { filter: null, variant: null, skipIf: [{ kind: 'levelAtLeast' as const, level: 11, xp: 500, negate: false }] };
    const scenario = hScenario({
      quests: [hQuest(603, 500, { level: 5, xp: { questLevel: 5, baseXp: 500, basis: 'era-seed' } }), hQuest(602, 7600)],
      steps,
      suffix: [s.note(500, 10, { condition: skip })],
    });
    const results = [{}, { targetXp: 8000 }].map((goal) => {
      const compiled = compile(scenario, goal);
      if (!compiled.ok) throw new Error(compiled.reason);
      expect(compiled.problem.closing.deltaLo).toBe(0);
      return runSearch(compiled, { beamWidth: 16 });
    });
    const [original, lower] = results;
    expect(original?.solutions[0]).toMatchObject({ estimatedMs: 97_249, knownGain: 8000, fillXp: 100 });
    // The lower target used to refuse that order (Δ = −100) and keep the 112,249 ms incumbent.
    expect(lower?.solutions[0]).toMatchObject({ estimatedMs: 97_249, knownGain: 8000, fillXp: 100 });
    expect(Array.from(lower?.solutions[0]?.units ?? [])).toEqual([2, 3, 0, 1]);
  });
});
