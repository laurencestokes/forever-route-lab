import { describe, expect, it } from 'vitest';
import { questId, sequentialIdSource, worldMapId } from '../domain/ids';
import type { ProjectV1 } from '../domain/project';
import { applyChangeSets } from '../diff';
import type { NavLegsProgress } from '../nav/worker/client';
import type { NavLegQuery, NavLegResult } from '../nav/worker/protocol';
import { type ContractSummary, createMatrixCache, createTypeScriptBeamSearchOptimizer, type OptimizationProgress, type OptimizationRequest } from '../optimizer';
import { inProcessOptimizerWorker, until } from '../optimizer/worker/test-helpers';
import { fixedClock } from './clock';
import { createNavigationRuntime, type DisposableNavLegService, type NavigationState } from './navigation-runtime';
import { ManualTimers, testNavManifest, walkable } from './navigation-test-helpers';
import type { OptimizationHost } from './optimizer-host';
import { type OptimizationResult, startOptimization, unknownsNote, yieldMacrotask } from './optimizer-run';
import { appHost, appQuest, appRequest, type AppScenario, appScenario, appSteps, describeStep, questScenario, T0 } from './optimizer-test-helpers';
import { createEditorStore, type EditorStore } from './store';

/**
 * An optimiser run from the app (docs/research/optimizer-m7.md §9): the host built from the
 * pipeline's inputs, the phases ("computing paths", compiling, searching, finishing), the section's
 * legs pending and then complete through the navigation scheduler, the pending refusal, cancel,
 * the edit lock and its hand-over, verification, and the proposal's diff. The search runs in an
 * in-process worker.
 */

/** Fixture 1 (the greedy-XP trap): A 101 (3,000 XP) far at (3000, 0), B 102 and C 103 (1,600 each) near; the exit at (0, 200). */
const fixture1 = (): AppScenario =>
  questScenario(
    [
      [101, 3000, 3000, 0],
      [102, 1600, 100, 0],
      [103, 1600, 0, 100],
    ],
    [0, 200],
  );

function request(project: ProjectV1, revision: number, targetXp: 'keep-original' | number = 3000, scope: Partial<OptimizationRequest['scope']> = {}): OptimizationRequest {
  const steps = project.route.steps;
  return appRequest({ project, data: fixture1().data, section: { first: 0, last: steps.length - 2 } }, revision, targetXp, scope);
}

function inProcessOptimizer() {
  return createTypeScriptBeamSearchOptimizer({ createPort: () => inProcessOptimizerWorker({ sliceMs: 5, firstSlice: 256, progressMs: 0 }).port });
}

interface LegsCall {
  readonly queries: readonly NavLegQuery[];
  readonly onProgress: ((p: NavLegsProgress) => void) | undefined;
  readonly signal: AbortSignal | undefined;
  resolve(): void;
}

/** A navigation worker stand-in whose answers the test releases. */
class FakeService implements DisposableNavLegService {
  readonly calls: LegsCall[] = [];
  legs(queries: readonly NavLegQuery[], options: { signal?: AbortSignal; onProgress?: (p: NavLegsProgress) => void } = {}): Promise<readonly NavLegResult[]> {
    return new Promise((resolve, reject) => {
      options.signal?.addEventListener('abort', () => {
        reject(options.signal?.reason as Error);
      });
      this.calls.push({ queries, onProgress: options.onProgress, signal: options.signal, resolve: () => resolve([]) });
    });
  }
  path(): Promise<readonly number[] | null> {
    return Promise.resolve(null);
  }
  dispose(): void {
    // Nothing to stop.
  }
}

/** Answers a call with walkable legs as long as the straight line. */
function answer(call: LegsCall | undefined): void {
  if (call === undefined) throw new Error('no legs call');
  const results = call.queries.map((q, index) => ({ index, result: walkable(Math.round(Math.sqrt((q.to.x - q.from.x) ** 2 + (q.to.y - q.from.y) ** 2) * 10)) }));
  call.onProgress?.({ done: results.length, total: results.length, results });
  call.resolve();
}

function setup(navigation: 'unavailable' | 'available' = 'unavailable', made: AppScenario = fixture1()) {
  const store: EditorStore = createEditorStore({ project: made.project, ids: sequentialIdSource(1000), clock: fixedClock(T0) });
  const service = new FakeService();
  const runtime = createNavigationRuntime(testNavManifest([1]), service, new ManualTimers());
  const nav: NavigationState = navigation === 'available' ? { kind: 'available', runtime } : { kind: 'unavailable', reason: 'test' };
  const host = appHost({ ...made, project: store.getState().project }, nav, store.getState().revision);
  return { store, host, service, runtime, project: store.getState().project };
}

function improved(result: OptimizationResult): Extract<OptimizationResult, { status: 'improved' | 'no-improvement' }> {
  if (result.status !== 'improved') throw new Error(`not improved: ${result.status}${'reason' in result ? ` (${result.reason})` : ''}${result.status === 'no-improvement' ? ` ${JSON.stringify(result.rejected.map((r) => r.failures))}` : ''}`);
  return result;
}

describe('startOptimization', () => {
  it('runs the phases, verifies the best route found, and returns its steps and diff (straight-line model)', async () => {
    const { store, host, project } = setup();
    const optimizer = inProcessOptimizer();
    const run = startOptimization({ host, store, optimizer, ids: sequentialIdSource(5000) }, request(project, host.revision));
    // The edit lock is taken at once.
    expect(store.getState().locks.has('optimizer')).toBe(true);
    expect(store.getState().editingLocked).toBe(true);
    const phases: OptimizationProgress['phase'][] = [];
    run.onProgress((p) => {
      if (phases.at(-1) !== p.phase) phases.push(p.phase);
    });
    const result = improved(await run.result);
    expect(phases).toEqual(['paths', 'compiling', 'searching', 'finishing']);
    expect(result.steps.map(describeStep)).toEqual(['accept 102', 'turnin 102', 'accept 103', 'turnin 103']);
    expect(result.estimate.resultMs).toBe(46_142);
    expect(result.estimate.incumbentMs).toBe(632_142);
    expect(Math.abs(result.estimate.engineMs - 46_142)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.estimate.originalMs - 632_142)).toBeLessThanOrEqual(1);
    expect(result.verification?.ok).toBe(true);
    expect(result.verification?.newIssues.filter((i) => i.severity === 'error')).toEqual([]);
    // The route and its diff: A's two steps removed; applying every change-set gives the route, none the original.
    const before = project.route.steps;
    expect(result.route).toEqual([...result.steps, before[6]]);
    expect(result.diff.ops.filter((op) => op.kind === 'remove').map((op) => (op.kind === 'remove' ? op.stepId : null))).toEqual([before[0]?.id, before[1]?.id]);
    const all = new Set(result.diff.changeSets.map((set) => set.id));
    expect(applyChangeSets(before, result.diff, all)).toEqual(result.route);
    expect(applyChangeSets(before, result.diff, new Set())).toEqual(before);
    expect(result.diff.changeSets.map((set) => set.id)).toContain(`q:${String(101)}`);
    // Milestone 8's partial application: every set but the removal of A keeps A, re-walked and verified (parity skipped).
    const partial = applyChangeSets(before, result.diff, new Set([...all].filter((id) => id !== 'q:101')));
    const report = result.verifyRoute(partial);
    expect(report.estimatedMs).toBeNull();
    expect(report.steps).toEqual(partial);
    expect(result.verifyRoute(result.route).ok).toBe(true);
    expect(() => result.verifyRoute(before.slice(0, 6))).toThrow(RangeError);
    // The lock is released when the run ends.
    expect(store.getState().locks.size).toBe(0);
    expect(result.unknowns).toEqual({ quests: [], note: '' });
    expect(result.timing.analysisWalkMs).toBeGreaterThanOrEqual(0);
    optimizer.dispose();
  });

  it('optimises a section in the middle of the route (the prefix replayed for the start state)', async () => {
    const s = appSteps();
    const made = appScenario({
      quests: [appQuest(90, 500), appQuest(101, 3000), appQuest(102, 1600), appQuest(103, 1600), appQuest(91, 500)],
      prefix: [...s.pair(90, 50, 50), s.note(20, 20)],
      steps: [...s.pair(101, 3000, 0), ...s.pair(102, 100, 0), ...s.pair(103, 0, 100)],
      suffix: [...s.pair(91, 0, 200)],
    });
    const { store, host } = setup('unavailable', made);
    const optimizer = inProcessOptimizer();
    const result = improved(await startOptimization({ host, store, optimizer, ids: sequentialIdSource(5000) }, appRequest(made, host.revision, 3000)).result);
    expect(result.steps.map(describeStep)).toEqual(['accept 102', 'turnin 102', 'accept 103', 'turnin 103']);
    expect(result.route.slice(0, 3)).toEqual(made.project.route.steps.slice(0, 3));
    expect(result.route.slice(-2)).toEqual(made.project.route.steps.slice(-2));
    expect(Math.abs(result.estimate.resultMs - result.estimate.engineMs)).toBeLessThanOrEqual(2);
    expect(result.verification?.ok).toBe(true);
    optimizer.dispose();
  });

  it('hands the lock over to the proposal in the same task when asked', async () => {
    const { store, host, project } = setup();
    const optimizer = inProcessOptimizer();
    const seen: string[][] = [];
    store.subscribe(() => seen.push([...store.getState().locks].sort()));
    const result = await startOptimization({ host, store, optimizer, ids: sequentialIdSource(5000), handOver: 'proposal' }, request(project, host.revision)).result;
    expect(result.status).toBe('improved');
    expect([...store.getState().locks]).toEqual(['proposal']);
    // Editing never unlocked between the run and the proposal.
    expect(seen.every((locks) => locks.length > 0)).toBe(true);
    optimizer.dispose();
  });

  it('computes the section\'s walking legs first ("computing paths"), then compiles on complete legs (navigation model)', async () => {
    const { store, host, project, service, runtime } = setup('available');
    expect(host.travelModel).toBe('navigation');
    const optimizer = inProcessOptimizer();
    const cache = createMatrixCache();
    const run = startOptimization({ host, store, optimizer, ids: sequentialIdSource(5000), cache }, request(project, host.revision));
    const progress: OptimizationProgress[] = [];
    run.onProgress((p) => progress.push(p));
    await until(() => service.calls.length > 0);
    // Pending: the legs are asked of the worker, and nothing else has happened.
    expect(progress.every((p) => p.phase === 'paths')).toBe(true);
    const total = progress.at(-1)?.legs?.total ?? 0;
    expect(total).toBeGreaterThan(0);
    expect(progress.at(-1)?.legs?.done).toBe(0);
    // The analysis walk and the analysis recorded no missing leg (the quiet model).
    expect(runtime.table.missingCount).toBe(0);
    answer(service.calls[0]);
    const result = improved(await run.result);
    const paths = progress.filter((p) => p.phase === 'paths' && p.legs !== null);
    expect(paths.at(-1)?.legs?.done).toBe(paths.at(-1)?.legs?.total);
    expect(result.steps.map(describeStep)).toEqual(['accept 102', 'turnin 102', 'accept 103', 'turnin 103']);
    // Navigation legs as long as the straight line: the times agree within the tenth-yard rounding.
    expect(Math.abs(result.estimate.resultMs - 46_142)).toBeLessThanOrEqual(5);
    expect(Math.abs(result.estimate.resultMs - result.estimate.engineMs)).toBeLessThanOrEqual(4);
    expect(cache.size()).toBe(1);
    expect(runtime.table.missingCount).toBe(0);
    optimizer.dispose();
  });

  it('refuses a section whose legs are still pending after computing paths', async () => {
    const { store, host, project } = setup('available');
    const optimizer = inProcessOptimizer();
    const lazy: OptimizationHost = { ...host, computeLegs: () => Promise.resolve({ complete: false }) };
    const result = await startOptimization({ host: lazy, store, optimizer, ids: sequentialIdSource(5000) }, request(project, host.revision)).result;
    expect(result.status).toBe('failed');
    expect('reason' in result ? result.reason : '').toMatch(/^walking paths are not complete for this section \(\d+ legs\); try again when computing paths has finished$/);
    expect(store.getState().locks.size).toBe(0);
    optimizer.dispose();
  });

  it('cancels during computing paths: the legs request is aborted and the lock released', async () => {
    const { store, host, project, service } = setup('available');
    const optimizer = inProcessOptimizer();
    const run = startOptimization({ host, store, optimizer, ids: sequentialIdSource(5000) }, request(project, host.revision));
    await until(() => service.calls.length > 0);
    run.cancel();
    const result = await run.result;
    expect(result.status).toBe('cancelled');
    expect(service.calls[0]?.signal?.aborted).toBe(true);
    expect(store.getState().locks.size).toBe(0);
    optimizer.dispose();
  });

  it('cancels during the search', async () => {
    const { store, host, project } = setup();
    let searching = false;
    const optimizer = createTypeScriptBeamSearchOptimizer({
      createPort: () =>
        inProcessOptimizerWorker({
          firstSlice: 1,
          sliceMs: 0,
          wrapStepper: (inner) => ({ advance: (n) => inner.advance(Math.min(n, 1)), finish: (t) => inner.finish(t) }),
        }).port,
    });
    const run = startOptimization({ host, store, optimizer, ids: sequentialIdSource(5000) }, request(project, host.revision), { maxEvaluations: 100_000_000 });
    run.onProgress((p) => {
      if (p.phase === 'searching') searching = true;
    });
    await until(() => searching);
    run.cancel();
    const result = await run.result;
    expect(result.status).toBe('cancelled');
    expect(store.getState().locks.size).toBe(0);
    optimizer.dispose();
  });

  it('refuses another revision, a held lock, new quests and a section not in the route', async () => {
    const { store, host, project } = setup();
    const optimizer = inProcessOptimizer();
    const deps = { host, store, optimizer, ids: sequentialIdSource(5000) };
    const stale = await startOptimization(deps, request(project, host.revision + 1)).result;
    expect(stale).toMatchObject({ status: 'failed', reason: 'the route changed since the request was made; start again' });
    const added = await startOptimization(deps, request(project, host.revision, 3000, { allowNewQuests: true })).result;
    expect(added).toMatchObject({ status: 'failed', reason: 'adding quests is not available yet' });
    store.acquireLock('proposal');
    const locked = await startOptimization(deps, request(project, host.revision)).result;
    expect(locked).toMatchObject({ status: 'failed', reason: 'an optimiser run or a proposal is already open' });
    // A refused run never touches another holder's lock.
    expect([...store.getState().locks]).toEqual(['proposal']);
    store.releaseLock('proposal');
    const reversed = request(project, host.revision);
    const outside = await startOptimization(deps, { ...reversed, section: { firstStepId: reversed.section.lastStepId, lastStepId: reversed.section.firstStepId } }).result;
    expect(outside.status).toBe('failed');
    expect(store.getState().locks.size).toBe(0);
    optimizer.dispose();
  });

  it('keeps the original when no candidate beats it (fixture 7g with the exit at (-1000, 0))', async () => {
    const { store, host, project } = setup(
      'unavailable',
      questScenario(
        [
          [761, 1000, 100, 0],
          [762, 1000, -100, 0],
        ],
        [-1000, 0],
      ),
    );
    const optimizer = inProcessOptimizer();
    const result = await startOptimization({ host, store, optimizer, ids: sequentialIdSource(5000) }, request(project, host.revision, 'keep-original')).result;
    expect(result.status).toBe('no-improvement');
    if (result.status === 'no-improvement') {
      expect(result.steps).toEqual(project.route.steps.slice(0, 4));
      expect(result.estimate.incumbentMs).toBe(132_000);
      expect(result.diff.ops).toEqual([]);
      expect(result.verification).toBeNull();
      expect(result.estimate.resultMs).toBe(result.estimate.incumbentMs);
    }
    optimizer.dispose();
  });
});

describe('startOptimization: the incumbent with a fill (review PAR-05)', () => {
  it('judges candidates against the original plus the fill a numeric target needs, and returns the improvement', async () => {
    // Fixture 8 in the app's terms: B 802 at (200, 0) before A 801 at (100, 0), the exit at (200, 0); target 2,500.
    const made = questScenario(
      [
        [802, 1000, 200, 0],
        [801, 1000, 100, 0],
      ],
      [200, 0],
    );
    const { store, host } = setup('unavailable', made);
    const optimizer = inProcessOptimizer();
    const result = improved(await startOptimization({ host, store, optimizer, ids: sequentialIdSource(5000) }, appRequest(made, host.revision, 2500)).result);
    expect(result.steps.map(describeStep)).toEqual(['accept 801', 'turnin 801', 'accept 802', 'turnin 802', 'grind']);
    // Judged against the incumbent's re-walk (the original plus its fill), not the original alone.
    expect(result.verification?.incumbentMs).toBeGreaterThan(result.estimate.originalMs);
    expect(Math.abs((result.verification?.incumbentMs ?? 0) - result.estimate.incumbentMs)).toBeLessThanOrEqual(20);
    expect(result.estimate.engineMs).toBeGreaterThan(result.estimate.originalMs);
    expect(Math.abs(result.estimate.resultMs - result.estimate.engineMs)).toBeLessThanOrEqual(20);
    optimizer.dispose();
  });

  it('returns the incumbent with its fill when nothing beats it: steps, estimate and re-walk describe one route', async () => {
    // Fixture 7g, exit west: the original order is the best found; the target is 500 XP above its gain.
    const made = questScenario(
      [
        [761, 1000, 100, 0],
        [762, 1000, -100, 0],
      ],
      [-1000, 0],
    );
    const { store, host, project } = setup('unavailable', made);
    const optimizer = inProcessOptimizer();
    const result = await startOptimization({ host, store, optimizer, ids: sequentialIdSource(5000) }, appRequest(made, host.revision, 2500)).result;
    expect(result.status).toBe('no-improvement');
    if (result.status !== 'no-improvement') return;
    expect(result.steps.map(describeStep)).toEqual(['accept 761', 'turnin 761', 'accept 762', 'turnin 762', 'grind']);
    expect(result.steps.slice(0, 4)).toEqual(project.route.steps.slice(0, 4));
    expect(result.estimate.resultMs).toBe(result.estimate.incumbentMs);
    expect(Math.abs(result.estimate.resultMs - result.estimate.engineMs)).toBeLessThanOrEqual(20);
    expect(result.estimate.engineMs).toBeGreaterThan(result.estimate.originalMs);
    expect(result.estimate.knownGain).toBe(2000);
    expect(result.verification?.ok).toBe(true);
    expect(result.verification?.metrics.xpGained.value).toBeGreaterThanOrEqual(2500);
    // The diff adds the fill; applying it gives the route.
    expect(result.diff.ops.map((op) => op.kind)).toEqual(['insert']);
    expect(applyChangeSets(project.route.steps, result.diff, new Set(result.diff.changeSets.map((set) => set.id)))).toEqual(result.route);
    expect(result.route).toEqual([...result.steps, project.route.steps[4]]);
    expect(store.getState().locks.size).toBe(0);
    optimizer.dispose();
  });
});

describe('startOptimization: the edit lock and the revision (reviews RTD-03, RTD-04)', () => {
  it('fails, and holds no lock, when a store subscriber throws as the lock is taken', async () => {
    const { store, host, project } = setup();
    const optimizer = inProcessOptimizer();
    const unsubscribe = store.subscribe(() => {
      throw new Error('subscriber failed');
    });
    const run = startOptimization({ host, store, optimizer, ids: sequentialIdSource(5000) }, request(project, host.revision));
    unsubscribe();
    const result = await run.result;
    expect(result).toMatchObject({ status: 'failed', reason: 'the edit lock could not be taken: subscriber failed' });
    expect(store.getState().locks.size).toBe(0);
    optimizer.dispose();
  });

  it("keeps the outcome and releases the run's lock when a subscriber throws during the hand-over", async () => {
    const { store, host, project } = setup();
    const optimizer = inProcessOptimizer();
    store.subscribe(() => {
      if (store.getState().locks.has('proposal')) throw new Error('subscriber failed on the proposal lock');
    });
    const result = await startOptimization({ host, store, optimizer, ids: sequentialIdSource(5000), handOver: 'proposal' }, request(project, host.revision)).result;
    expect(result.status).toBe('improved');
    expect([...store.getState().locks]).toEqual(['proposal']);
    optimizer.dispose();
  });

  it('refuses a host one revision behind the editor, before taking the lock', async () => {
    const { store, host, project } = setup();
    const optimizer = inProcessOptimizer();
    // The editor moves on; the host is still the snapshot of the old revision, and so is the request.
    store.replaceProject({ ...store.getState().project, route: { ...project.route, steps: project.route.steps.slice(2) } });
    expect(store.getState().revision).toBe(host.revision + 1);
    const locks: number[] = [];
    store.subscribe(() => locks.push(store.getState().locks.size));
    const result = await startOptimization({ host, store, optimizer, ids: sequentialIdSource(5000) }, request(project, host.revision)).result;
    expect(result).toMatchObject({ status: 'failed', reason: 'the route changed since the request was made; start again' });
    expect(locks).toEqual([]);
    expect(store.getState().locks.size).toBe(0);
    optimizer.dispose();
  });
});

describe('startOptimization: yields and leg progress (reviews RTD-05, RTD-09)', () => {
  it('yields a macrotask after the analysis walk, and a cancel from another task there stops the run before compiling', async () => {
    const { store, host, project } = setup();
    const optimizer = inProcessOptimizer();
    const order: string[] = [];
    let yields = 0;
    let cancel = (): void => undefined;
    const run = startOptimization(
      {
        host,
        store,
        optimizer,
        ids: sequentialIdSource(5000),
        yieldToEventLoop: () => {
          yields += 1;
          // After the analysis walk: a click queued before the run's own task gets to cancel it.
          if (yields === 3)
            setTimeout(() => {
              order.push('click');
              cancel();
            }, 0);
          return new Promise((resolve) => setTimeout(resolve, 0));
        },
      },
      request(project, host.revision),
    );
    cancel = () => {
      run.cancel();
    };
    run.onProgress((p) => {
      if (order.at(-1) !== p.phase) order.push(p.phase);
    });
    const result = await run.result;
    expect(result.status).toBe('cancelled');
    expect(order).toEqual(['paths', 'click']);
    expect(result.timing.analysisWalkMs).toBeGreaterThan(0);
    expect(result.timing.baselineWalkMs).toBe(0);
    expect(store.getState().locks.size).toBe(0);
    optimizer.dispose();
  });

  it('the default yield is a macrotask, not a microtask', async () => {
    let done = false;
    const yielded = yieldMacrotask().then(() => {
      done = true;
    });
    for (let k = 0; k < 10; k += 1) await Promise.resolve();
    expect(done).toBe(false);
    await yielded;
    expect(done).toBe(true);
  });

  it('yields through the injected yield before and after the prefix replay, after the analysis walk, after the baseline walk and between verifications', async () => {
    const { store, host, project } = setup();
    const optimizer = inProcessOptimizer();
    const at: string[] = [];
    let phase = '';
    const run = startOptimization(
      {
        host,
        store,
        optimizer,
        ids: sequentialIdSource(5000),
        yieldToEventLoop: () => {
          at.push(phase);
          return new Promise((resolve) => setTimeout(resolve, 0));
        },
      },
      request(project, host.revision),
    );
    run.onProgress((p) => {
      phase = p.phase;
    });
    const result = await run.result;
    expect(result.status).toBe('improved');
    // Before the prefix replay, after it, after the analysis walk, after the baseline walk.
    expect(at.slice(0, 4)).toEqual(['paths', 'paths', 'paths', 'compiling']);
    expect(at.slice(4).every((p) => p === 'finishing')).toBe(true);
    optimizer.dispose();
  });

  it("reports leg progress in the scheduler's unit: 0 of 0 when every leg is already in the table, never the pair count", async () => {
    const { store, host, project, service } = setup('available');
    const optimizer = inProcessOptimizer();
    const first = startOptimization({ host, store, optimizer, ids: sequentialIdSource(5000) }, request(project, host.revision));
    await until(() => service.calls.length > 0);
    answer(service.calls[0]);
    expect((await first.result).status).toBe('improved');
    // Every leg is in the table now: the scheduler has nothing to ask for, so it never reports.
    const again = startOptimization({ host, store, optimizer, ids: sequentialIdSource(6000) }, request(project, host.revision));
    const legs: string[] = [];
    again.onProgress((p) => {
      if (p.legs !== null) legs.push(`${String(p.legs.done)}/${String(p.legs.total)}`);
    });
    expect((await again.result).status).toBe('improved');
    expect(service.calls).toHaveLength(1);
    expect([...new Set(legs)]).toEqual(['0/0']);
    optimizer.dispose();
  });
});

describe('the result note (reviews COR-06, PAR-08, PAR-10)', () => {
  const summary = (fields: Partial<ContractSummary>): ContractSummary => ({ unknownXp: [], carried: [], exitChain: [], ...fields }) as unknown as ContractSummary;
  const s = appSteps();

  it('agrees the verb with the count, and names the travel out of the section when the exit chain is counted', () => {
    expect(unknownsNote(summary({}), 1, [])).toBe('1 part of the section has unknown time, counted as nothing, so the times shown are lower bounds and the saving there is uncertain.');
    expect(unknownsNote(summary({}), 2, [])).toBe('2 parts of the section have unknown time, counted as nothing, so the times shown are lower bounds and the saving there is uncertain.');
    expect(unknownsNote(summary({ exitChain: [7] }), 1, [])).toBe(
      '1 part of the section or the travel out of it has unknown time, counted as nothing, so the times shown are lower bounds and the saving there is uncertain.',
    );
    expect(unknownsNote(summary({}), 0, [])).toBe('');
  });

  it('mentions unknown XP only when such a quest is turned in, and carried objective work (D-040)', () => {
    const unknown = summary({ unknownXp: [questId(900001)] });
    expect(unknownsNote(unknown, 0, [s.accept(900001, 0, 0)])).toBe('');
    expect(unknownsNote(unknown, 0, [s.accept(900001, 0, 0), s.turnin(900001, 0, 0)])).toBe('Quests whose XP is unknown are turned in, so the level and XP after them are lower bounds.');
    expect(unknownsNote(summary({ carried: [questId(784)] }), 0, [])).toBe('1 turn-in carries objective work whose travel is not priced, so the times there are lower bounds (D-040).');
    expect(unknownsNote(summary({ carried: [questId(784), questId(788)] }), 0, [])).toBe('2 turn-ins carry objective work whose travel is not priced, so the times there are lower bounds (D-040).');
  });

  it('says why orders that lose known XP were refused after an unknown-XP turn-in (review PAR-04)', () => {
    expect(unknownsNote(summary({}), 0, [], null)).toBe('');
    expect(unknownsNote(summary({}), 0, [], { closes: 3, smallestShortfall: 100 })).toBe(
      'Some orders were refused because they gain at least 100 known XP less than the target, and no grind fill may follow a turn-in whose XP is unknown (XP-4); a target 100 XP lower would allow them.',
    );
  });
});

describe('the optimiser host', () => {
  it('uses the quiet view: a pending leg is the labelled fallback and records nothing', () => {
    const { host, runtime } = setup('available');
    const from = { point: { mapId: worldMapId(1), x: 0, y: 0 }, zoneHint: 0 };
    const to = { point: { mapId: worldMapId(1), x: 30, y: 40 }, zoneHint: 0 };
    const speeds = { groundYps: 10, swimYps: 5 };
    const leg = host.engine.travel.leg(from, to, speeds);
    expect(leg.pending).toBe(true);
    expect(leg.seconds.value).toBeCloseTo(5, 9);
    expect(runtime.table.missingCount).toBe(0);
    expect(host.missingLegs([{ from, to }])).toBe(1);
    expect(host.cacheKey()).toBe('unavailable:');
  });

  it('is the straight-line model without navigation, with nothing to compute', async () => {
    const { host } = setup();
    expect(host.travelModel).toBe('straight-line');
    expect(host.missingLegs([{ from: { point: { mapId: worldMapId(1), x: 0, y: 0 }, zoneHint: 0 }, to: { point: { mapId: worldMapId(1), x: 3, y: 4 }, zoneHint: 0 } }])).toBe(0);
    expect(await host.computeLegs([], { signal: new AbortController().signal, onProgress: () => undefined })).toEqual({ complete: true });
    expect(host.cacheKey()).toBe('straight-line');
  });
});
