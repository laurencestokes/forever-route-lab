import { beforeAll, describe, expect, it } from 'vitest';
import { fakeServer, nodeSha256, publicSite } from '../../tests/support/fake-fetch';
import { sequentialIdSource } from '../domain/ids';
import type { OptimizationRequest } from '../optimizer';
import { createTypeScriptBeamSearchOptimizer } from '../optimizer';
import { inProcessOptimizerWorker } from '../optimizer/worker/test-helpers';
import { fixedClock } from './clock';
import { createOptimizationHost } from './optimizer-host';
import { type OptimizationResult, startOptimization } from './optimizer-run';
import { sectionPlusExitMs } from './optimizer-verify';
import { createRunWalker, spliceSection, walkRoute } from './optimizer-walk';
import { createEditorStore } from './store';
import { loadWorkspace, type Workspace } from './workspace';

/**
 * The optimiser on real data (review PAR-05): the committed sample route, section [5..30], whose
 * original gains 10,249 known XP, with a numeric target of 11,749. The search's incumbent is the
 * original plus a 600 s grind fill; a faster route that reaches the target must be judged against
 * that incumbent, not the original without its fill, and whatever comes back, its steps, its
 * estimate and its engine re-walk must describe one route that reaches the target. The results are
 * the best route found under these assumptions, never "optimal".
 */

const NOW = '2026-09-27T12:00:00.000Z';
const TARGET = 11_749;

let workspace: Workspace;

beforeAll(async () => {
  const server = fakeServer(publicSite());
  workspace = await loadWorkspace({ fetch: server.fetch, baseUrl: './', sha256: nodeSha256, nowIso: NOW, now: () => performance.now(), yieldToRender: () => Promise.resolve() });
}, 60_000);

async function run(grindFill: 'shortfall' | 'replace-quests'): Promise<Extract<OptimizationResult, { status: 'improved' | 'no-improvement' }>> {
  const project = workspace.project;
  const store = createEditorStore({ project, ids: sequentialIdSource(700_000), clock: fixedClock(NOW) });
  const revision = store.getState().revision;
  const host = createOptimizationHost({ project, revision, data: workspace.data, geometry: workspace.geometry.geometry, navigation: { kind: 'unavailable', reason: 'test' }, taxi: null });
  const optimizer = createTypeScriptBeamSearchOptimizer({ createPort: () => inProcessOptimizerWorker({ sliceMs: 20, firstSlice: 256, progressMs: 0 }).port });
  const steps = project.route.steps;
  const first = steps[5];
  const last = steps[30];
  if (first === undefined || last === undefined) throw new Error('the sample route is shorter than 31 steps');
  const request: OptimizationRequest = {
    project,
    baseRevision: revision,
    section: { firstStepId: first.id, lastStepId: last.id },
    scope: { allowNewQuests: false, zones: null, levelWindow: null },
    goal: { kind: 'min-time', targetXp: TARGET, grindFill },
  };
  try {
    const result = await startOptimization({ host, store, optimizer, ids: sequentialIdSource(600_000) }, request, { beamWidth: 256, maxEvaluations: 400_000 }).result;
    if (result.status !== 'improved' && result.status !== 'no-improvement') throw new Error(`run ended ${result.status}: ${'reason' in result ? result.reason : ''}`);
    return result;
  } finally {
    optimizer.dispose();
  }
}

/** An independent re-walk of the result's route on a fresh run walker: its section plus exit chain, ms. */
function rewalkMs(result: Extract<OptimizationResult, { status: 'improved' | 'no-improvement' }>): number {
  const project = workspace.project;
  const host = createOptimizationHost({ project, revision: 0, data: workspace.data, geometry: workspace.geometry.geometry, navigation: { kind: 'unavailable', reason: 'test' }, taxi: null });
  const spliced = spliceSection(project, 5, 30, result.steps);
  const newLast = 5 + result.steps.length - 1;
  const walked = walkRoute(createRunWalker(host), spliced, { first: 5, last: newLast }, { probe: false });
  const delta = result.steps.length - 26;
  return sectionPlusExitMs(walked.route.records, 5, newLast, result.summary.exitChain.map((i) => i + delta));
}

describe('the optimiser on the sample route, section [5..30] at 11,749 XP (review PAR-05)', () => {
  it("'replace-quests': the faster route that reaches the target is judged against the original plus its fill, and returned", async () => {
    const result = await run('replace-quests');
    expect(result.summary.targetXp).toBe(TARGET);
    expect(result.status).toBe('improved');
    const verification = result.verification;
    if (verification === null) throw new Error('no verification');
    // Slower than the original, which misses the target; faster than the original plus the fill.
    expect(verification.incumbentMs).toBeGreaterThan(verification.originalMs + 500_000);
    expect(result.estimate.engineMs).toBeGreaterThan(result.estimate.originalMs);
    expect(result.estimate.engineMs).toBeLessThan(verification.incumbentMs - 1);
    expect(result.rejected.flatMap((r) => r.failures).filter((f) => f.rule === 'improvement')).toEqual([]);
    // Every rule holds, the section's known gain at least the target among them.
    expect(verification.failures).toEqual([]);
    expect(Math.abs(result.estimate.resultMs - result.estimate.engineMs)).toBeLessThanOrEqual(verification.parityBound ?? 0);
    expect(Math.abs(rewalkMs(result) - result.estimate.engineMs)).toBeLessThanOrEqual(0.001);
  }, 120_000);

  it("'shortfall': the steps, the estimate and the re-walk describe one route, which reaches the target", async () => {
    const result = await run('shortfall');
    const verification = result.verification;
    if (verification === null) throw new Error('no verification: the result must be re-walked');
    // The original misses the target, so whatever comes back carries a fill, and passes every rule
    // the result is judged by (the incumbent's re-walk is not judged on improvement against itself).
    expect(result.steps.some((step) => step.kind === 'grind')).toBe(true);
    expect(verification.failures).toEqual([]);
    expect(Math.abs(result.estimate.resultMs - result.estimate.engineMs)).toBeLessThanOrEqual(verification.parityBound ?? 0);
    expect(Math.abs(rewalkMs(result) - result.estimate.engineMs)).toBeLessThanOrEqual(0.001);
    if (result.status === 'no-improvement') expect(result.estimate.resultMs).toBe(result.estimate.incumbentMs);
  }, 120_000);
});
