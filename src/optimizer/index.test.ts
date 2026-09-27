import { describe, expect, it } from 'vitest';
import { sequentialIdSource } from '../domain/ids';
import type { RouteStep } from '../domain/route';
import { analyseSection } from './core';
import { coreFixtures, grid40 } from './core/test-fixtures';
import { harnessInput, hQuest, hScenario, hSteps, type Scenario } from './core/test-helpers';
import {
  createTypeScriptBeamSearchOptimizer,
  DEFAULT_OPTIMIZATION_OPTIONS,
  type OptimizationContext,
  type OptimizationGoal,
  type OptimizationOptions,
  type OptimizationProgress,
  type OptimizationRequest,
  type SearchedSection,
} from './index';
import { inProcessOptimizerWorker, type InProcessOptimizerWorker, until } from './worker/test-helpers';

/**
 * `createTypeScriptBeamSearchOptimizer` end to end through the worker client and an in-process
 * worker (docs/research/optimizer-m7.md §8, §11): compile on the main thread, the search in the
 * "worker", candidates decoded to route steps, the phases in progress, cancel, and the refusals.
 */

const H_OPTIONS: OptimizationOptions = { ...DEFAULT_OPTIMIZATION_OPTIONS, beamWidth: 16, maxEvaluations: 100_000 };

function contextOf(scenario: Scenario, goal: Partial<OptimizationGoal>): OptimizationContext {
  const input = harnessInput(scenario.project, scenario.context, scenario.section, goal);
  const analysis = analyseSection(input);
  if (!analysis.ok) throw new Error(`analysis failed: ${analysis.reason}`);
  return { analysis, baseline: input.walk };
}

function requestOf(scenario: Scenario, goal: Partial<OptimizationGoal>, scope: Partial<OptimizationRequest['scope']> = {}): OptimizationRequest {
  const steps = scenario.project.route.steps;
  const first = steps[scenario.section.first];
  const last = steps[scenario.section.last];
  if (first === undefined || last === undefined) throw new Error('no section');
  return {
    project: { ...(scenario.project as unknown as OptimizationRequest['project']) },
    baseRevision: 1,
    section: { firstStepId: first.id, lastStepId: last.id },
    scope: { allowNewQuests: false, zones: null, levelWindow: null, ...scope },
    goal: { kind: 'min-time', targetXp: goal.targetXp ?? 'keep-original', grindFill: goal.grindFill ?? 'shortfall' },
  };
}

function optimizer(workers: InProcessOptimizerWorker[] = []) {
  return createTypeScriptBeamSearchOptimizer({
    createPort: () => {
      const w = inProcessOptimizerWorker({ sliceMs: 5, firstSlice: 256, progressMs: 0 });
      workers.push(w);
      return w.port;
    },
  });
}

const describeStep = (step: RouteStep): string => (step.kind === 'accept' || step.kind === 'turnin' ? `${step.kind} ${String(step.questId)}` : step.kind);

describe('createTypeScriptBeamSearchOptimizer', () => {
  it('fixture 1 end to end: compiles, searches in the worker, and decodes the best route found', async () => {
    const fixture = coreFixtures().find((f) => f.id === '1');
    if (fixture === undefined) throw new Error('missing');
    const workers: InProcessOptimizerWorker[] = [];
    const o = optimizer(workers);
    const phases: OptimizationProgress['phase'][] = [];
    const run = o.optimize(requestOf(fixture.scenario, fixture.goal), H_OPTIONS, contextOf(fixture.scenario, fixture.goal), sequentialIdSource(5000));
    run.onProgress((p) => {
      if (phases.at(-1) !== p.phase) phases.push(p.phase);
    });
    const result = await run.result;
    if (result.status !== 'searched') throw new Error(`not searched: ${result.status}`);
    expect(phases).toEqual(['compiling', 'searching']);
    expect(result.termination).toBe('exhausted');
    expect(result.reproducible).toBe(true);
    expect(result.incumbent.estimatedMs).toBe(632_142);
    const best = result.candidates[0];
    expect(best?.solution.estimatedMs).toBe(46_142);
    // Accept 102, turn in 102, accept 103, turn in 103; A's two steps removed; the original step objects.
    expect(best?.steps.map(describeStep)).toEqual(['accept 102', 'turnin 102', 'accept 103', 'turnin 103']);
    const original = fixture.scenario.project.route.steps;
    for (const step of best?.steps ?? []) expect(original).toContain(step);
    expect(best?.dependencies).toEqual([]);
    // Every candidate beats the incumbent, best first.
    for (const candidate of result.candidates) expect(candidate.solution.estimatedMs).toBeLessThan(result.incumbent.estimatedMs);
    for (let k = 1; k < result.candidates.length; k += 1) expect(result.candidates[k]?.solution.estimatedMs).toBeGreaterThanOrEqual(result.candidates[k - 1]?.solution.estimatedMs ?? 0);
    expect(result.summary.targetXp).toBe(3000);
    expect(workers).toHaveLength(1);
    o.dispose();
    expect(workers[0]?.terminated()).toBe(true);
  });

  it('fixture 8: the grind fill is a new step with its step dependency', async () => {
    const fixture = coreFixtures().find((f) => f.id === '8');
    if (fixture === undefined) throw new Error('missing');
    const o = optimizer();
    const result = await o.optimize(requestOf(fixture.scenario, fixture.goal), H_OPTIONS, contextOf(fixture.scenario, fixture.goal), sequentialIdSource(5000)).result;
    if (result.status !== 'searched') throw new Error(`not searched: ${result.status}`);
    const best = result.candidates[0];
    expect(best?.solution.estimatedMs).toBe(212_000);
    const fill = best?.steps.at(-1);
    expect(fill?.kind).toBe('grind');
    expect(fill?.origin).toEqual({ source: 'optimizer', ref: null });
    expect(fill?.kind === 'grind' ? fill.until : null).toEqual({ kind: 'level', level: 10, offset: { kind: 'xpInto', xp: 2500 } });
    expect(best?.dependencies.map((d) => d.stepId)).toEqual([fill?.id]);
    // The incumbent decoded: the original section plus the fill the target needs (review PAR-05).
    const original = fixture.scenario.project.route.steps.slice(fixture.scenario.section.first, fixture.scenario.section.last + 1);
    expect(result.incumbentSection.steps.slice(0, original.length)).toEqual(original);
    expect(result.incumbentSection.steps.map((step) => step.kind).at(-1)).toBe('grind');
    expect(result.incumbentSection.steps).toHaveLength(original.length + 1);
    o.dispose();
  });

  it('throttles the searching progress to one emit per progressMs, the first improvement and the final counts at once (review RTD-08)', async () => {
    // The worker posts progress after every slice and best on every improvement; the clock never moves.
    const o = createTypeScriptBeamSearchOptimizer({
      createPort: () => inProcessOptimizerWorker({ sliceMs: 1, firstSlice: 256, progressMs: 0 }).port,
      now: () => 0,
    });
    const scenario = grid40();
    const seen: OptimizationProgress[] = [];
    const run = o.optimize(requestOf(scenario, {}), { ...H_OPTIONS, beamWidth: 64, maxEvaluations: 60_000 }, contextOf(scenario, {}), sequentialIdSource(5000));
    run.onProgress((p) => seen.push(p));
    const result = await run.result;
    if (result.status !== 'searched') throw new Error(`not searched: ${result.status}`);
    const searching = seen.filter((p) => p.phase === 'searching');
    // The phase change, the first improvement, and the final counts: nothing else within 100 ms.
    expect(searching.length).toBeLessThanOrEqual(3);
    expect(searching.at(-1)?.evaluations).toBe(result.stats.evaluations);
    expect(searching.some((p) => p.bestSeconds !== null)).toBe(true);
    // The best folded into the final emit is the run's best.
    expect(searching.at(-1)?.bestSeconds).toBe((result.candidates[0]?.solution.estimatedMs ?? 0) / 1000);
    o.dispose();
  });

  it('reports no candidate when the original order is the best found (fixture 4 with the exit on the other side)', async () => {
    // Fixture 4's two quests with the exit at (−400, 0): X then Y is already the shortest order, so
    // neither the seeds, the passes nor the beam find anything better.
    const s = hSteps();
    const scenario = hScenario({ quests: [hQuest(401, 1000), hQuest(402, 1000)], steps: [...s.quest(401, 100, 0), ...s.quest(402, -150, 0)], exit: { x: -400, y: 0 } });
    const o = optimizer();
    const result = await o.optimize(requestOf(scenario, {}), { ...H_OPTIONS, beamWidth: 1 }, contextOf(scenario, {}), sequentialIdSource(5000)).result;
    expect(result.status).toBe('searched');
    if (result.status === 'searched') {
      expect(result.candidates).toEqual([]);
      expect(result.incumbent.estimatedMs).toBe(72_000);
      expect(result.unknownXpBlocked).toBeNull();
    }
    o.dispose();
  });

  it('passes on the closes refused because no fill may follow unknown XP (review PAR-04)', async () => {
    // Quest 603 (level 5) gives 100 XP less after quest 602 levels to 11; quest 604's XP is unknown.
    const s = hSteps();
    const scenario = hScenario({
      quests: [hQuest(604, null), hQuest(603, 500, { level: 5, xp: { questLevel: 5, baseXp: 500, basis: 'era-seed' } }), hQuest(602, 7600)],
      steps: [...s.quest(604, 0, 0), ...s.quest(603, 500, 0), ...s.quest(602, 0, 50)],
      exit: { x: 500, y: 10 },
    });
    const o = optimizer();
    const result = await o.optimize(requestOf(scenario, {}), H_OPTIONS, contextOf(scenario, {}), sequentialIdSource(5000)).result;
    if (result.status !== 'searched') throw new Error(`not searched: ${result.status}`);
    expect(result.candidates).toEqual([]);
    expect(result.unknownXpBlocked?.smallestShortfall).toBe(100);
    expect(result.unknownXpBlocked?.closes).toBeGreaterThan(0);
    o.dispose();
  });

  it('cancels a search in progress', async () => {
    const o = optimizer();
    const scenario = grid40();
    let searching = 0;
    const run = o.optimize(requestOf(scenario, {}), { ...H_OPTIONS, beamWidth: 256, maxEvaluations: 100_000_000 }, contextOf(scenario, {}), sequentialIdSource(5000));
    run.onProgress((p) => {
      if (p.phase === 'searching' && p.evaluations > 0) searching += 1;
    });
    await until(() => searching > 0);
    run.cancel();
    const result: SearchedSection = await run.result;
    expect(result.status).toBe('cancelled');
    expect(result.stats.evaluations).toBeGreaterThan(0);
    o.dispose();
  });

  it('cancels before the search starts, and refuses new quests, bad options and a failed compile', async () => {
    const fixture = coreFixtures().find((f) => f.id === '1');
    if (fixture === undefined) throw new Error('missing');
    const o = optimizer();
    const ids = sequentialIdSource(5000);
    const early = o.optimize(requestOf(fixture.scenario, fixture.goal), H_OPTIONS, contextOf(fixture.scenario, fixture.goal), ids);
    early.cancel();
    expect((await early.result).status).toBe('cancelled');
    const added = await o.optimize(requestOf(fixture.scenario, fixture.goal, { allowNewQuests: true }), H_OPTIONS, contextOf(fixture.scenario, fixture.goal), ids).result;
    expect(added).toMatchObject({ status: 'failed', reason: 'adding quests is not available yet' });
    const bad = await o.optimize(requestOf(fixture.scenario, fixture.goal), { ...H_OPTIONS, beamWidth: 0 }, contextOf(fixture.scenario, fixture.goal), ids).result;
    expect(bad.status).toBe('failed');
    // A baseline whose structure differs from the analysis's (compileProblem's structure check).
    const context = contextOf(fixture.scenario, fixture.goal);
    const other = contextOf(coreFixtures().find((f) => f.id === '2')?.scenario ?? fixture.scenario, {});
    const failed = await o.optimize(requestOf(fixture.scenario, fixture.goal), H_OPTIONS, { analysis: context.analysis, baseline: other.baseline }, ids).result;
    expect(failed.status).toBe('failed');
    o.dispose();
  });
});
