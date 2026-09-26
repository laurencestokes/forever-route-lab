import { describe, expect, it } from 'vitest';
import { type Location, type RouteStep, sequentialIdSource, worldMapId, worldSourcedPoint } from '../domain';
import { makeTravelStep } from '../domain/step-factory';
import type { NavLegsProgress } from '../nav/worker/client';
import { NavWorkerError, type NavLegQuery, type NavLegResult } from '../nav/worker/protocol';
import { fixedClock } from './clock';
import { type Command, insertNote, setStepLocation } from './commands';
import { createDerivedStore, type DerivedResults, pendingTravelReason, pendingTravelText, provisionalNote } from './derived';
import { createDerivedPipeline, type DerivedPipeline } from './derived-pipeline';
import { acceptStepsAt, MAP_TEST_DATASET, mapTestSteps, mapTestWorkspace } from './map-test-helpers';
import { createNavigationRuntime, type DisposableNavLegService, type NavigationRuntime, type NavigationState } from './navigation-runtime';
import { ManualTimers, testNavManifest, walkable } from './navigation-test-helpers';
import { exportProjectFile } from './persistence';
import { updateSettings } from './project-commands';
import { createRxpContext } from './rxp-context';
import { previewRxpExport } from './rxp-export';
import { createEditorStore, type EditorStore } from './store';

/**
 * The derived-result pipeline (ARCHITECTURE §12.1, §14; terrain-navigation.md §9.3-§9.4): one walk
 * per revision through the store, re-walks from engine checkpoints equal to full walks, pending
 * navigation legs filled in batches with one re-walk per batch, superseded revisions never walked,
 * and the straight-line fallback when navigation is unavailable.
 */

const T0 = '2026-09-25T12:00:00.000Z';

interface LegsCall {
  readonly queries: readonly NavLegQuery[];
  readonly priority: string | undefined;
  readonly onProgress: ((p: NavLegsProgress) => void) | undefined;
  resolve(): void;
  reject(error: unknown): void;
}

/** A worker stand-in whose answers the test releases by hand. */
class FakeService implements DisposableNavLegService {
  readonly legCalls: LegsCall[] = [];
  readonly pathCalls: { readonly query: NavLegQuery; readonly resolve: (p: readonly number[] | null) => void }[] = [];
  disposed = false;

  legs(queries: readonly NavLegQuery[], options: { signal?: AbortSignal; priority?: string; onProgress?: (p: NavLegsProgress) => void } = {}): Promise<readonly NavLegResult[]> {
    return new Promise((resolve, reject) => {
      options.signal?.addEventListener('abort', () => {
        reject(options.signal?.reason as Error);
      });
      this.legCalls.push({ queries, priority: options.priority, onProgress: options.onProgress, resolve: () => resolve([]), reject });
    });
  }

  path(query: NavLegQuery): Promise<readonly number[] | null> {
    return new Promise((resolve) => this.pathCalls.push({ query, resolve }));
  }

  dispose(): void {
    this.disposed = true;
  }
}

/** A walkable leg as long as the straight line, in tenth-yards. */
const straight = (q: NavLegQuery): NavLegResult => walkable(Math.round(Math.sqrt((q.to.x - q.from.x) ** 2 + (q.to.y - q.from.y) ** 2) * 10));

/** Answers `call` in `chunks` progress steps with `result`, optionally resolving it. */
function answer(call: LegsCall | undefined, result: (q: NavLegQuery) => NavLegResult = straight, chunks = 1, resolve = true): void {
  if (call === undefined) throw new Error('no legs call');
  const n = call.queries.length;
  const size = Math.max(1, Math.ceil(n / chunks));
  for (let start = 0, done = 0; start < n; start += size) {
    const results = call.queries.slice(start, start + size).map((q, k) => ({ index: start + k, result: result(q) }));
    done += results.length;
    call.onProgress?.({ done, total: n, results });
  }
  if (resolve) call.resolve();
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

const worldLocation = (x: number, y: number): Location => ({ source: worldSourcedPoint(worldMapId(1), x, y), label: null, radius: null });

interface Setup {
  readonly store: EditorStore;
  readonly timers: ManualTimers;
  readonly handle: ReturnType<typeof createDerivedStore>;
  readonly pipeline: DerivedPipeline;
  readonly published: DerivedResults[];
  /** When each of `published` was published (manual time). */
  readonly publishedAt: number[];
  readonly steps: readonly RouteStep[];
  readonly service: FakeService;
  readonly runtime: NavigationRuntime;
}

function setup(opts: { readonly steps?: RouteStep[]; readonly navigation?: 'checking' | 'available' | NavigationState; readonly rewalkMs?: number } = {}): Setup {
  const workspace = mapTestWorkspace(opts.steps ?? mapTestSteps(), T0);
  const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(1000), clock: fixedClock(T0) });
  const timers = new ManualTimers();
  const service = new FakeService();
  const runtime = createNavigationRuntime(testNavManifest([1]), service, timers);
  const nav = opts.navigation ?? 'checking';
  const navigation: NavigationState = nav === 'checking' ? { kind: 'checking' } : nav === 'available' ? { kind: 'available', runtime } : nav;
  const handle = createDerivedStore();
  const published: DerivedResults[] = [];
  const publishedAt: number[] = [];
  const pipeline = createDerivedPipeline({
    store,
    data: workspace.data,
    geometry: workspace.geometry,
    output: handle,
    navigation,
    timers,
    now: () => timers.now,
    ...(opts.rewalkMs === undefined ? {} : { rewalkMs: opts.rewalkMs }),
    onPublished: (r) => {
      published.push(r);
      publishedAt.push(timers.now);
    },
  });
  return { store, timers, handle, pipeline, published, publishedAt, steps: workspace.steps, service, runtime };
}

/** What a walk's results say, without the parts that differ between two walks of equal inputs. */
const comparable = (r: DerivedResults | null) =>
  r === null ? null : { estimates: r.estimates, issues: r.issues, stepIssues: r.stepIssues, metrics: r.metrics, pendingLegs: r.pendingLegs, pendingSteps: r.pendingSteps };

/** `n` accept steps along a line on Kalimdor. */
const longRoute = (n: number): RouteStep[] => acceptStepsAt(Array.from({ length: n }, (_, i) => ({ mapId: 1, x: (i % 50) * 40, y: -4000 - Math.floor(i / 50) * 40 })));

describe('derived pipeline: walks and publishing', () => {
  it('walks once per revision and publishes estimates, metrics, issues and the travel model', () => {
    const s = setup();
    expect(s.handle.store.getState().status).toBe('loading');
    s.timers.advance(0);
    const state = s.handle.store.getState();
    expect(state.status).toBe('ready');
    const r = state.results;
    if (r === null) throw new Error('no results');
    expect(r.revision).toBe(0);
    expect(r.estimates).toHaveLength(s.steps.length);
    expect(r.records.map((record) => record.step.id)).toEqual(s.steps.map((step) => step.id));
    expect(r.stepIssues).toHaveLength(s.steps.length);
    expect(r.metrics.duration.value).toBeGreaterThan(0);
    expect(r.travelModel).toBe('straight-line');
    expect(r.rules.rulesetId).toBe('forever-beta');
    // Still checking for navigation: the numbers are not final and say so.
    expect(state.travel.model).toBe('checking');
    expect(r.final).toBe(false);
    expect(provisionalNote(state)).toBe('Pending: checking for navigation data; times use the straight-line estimate.');
    expect(s.pipeline.walks).toBe(1);
  });

  it('coalesces edits made in one task into one walk of the latest revision', () => {
    const s = setup();
    s.timers.advance(0);
    s.store.dispatch(insertNote({ text: 'a' }));
    s.store.dispatch(insertNote({ text: 'b' }));
    s.store.dispatch(insertNote({ text: 'c' }));
    expect(s.pipeline.walks).toBe(1);
    s.timers.advance(0);
    expect(s.pipeline.walks).toBe(2);
    expect(s.published.map((r) => r.revision)).toEqual([0, 3]);
    expect(s.handle.store.getState().results?.estimates).toHaveLength(s.steps.length + 3);
  });

  it('re-walks an edit from the checkpoint before it, and the results equal a full walk', () => {
    const steps = longRoute(700);
    const s = setup({ steps });
    s.timers.advance(0);
    expect(s.pipeline.checkpointIndices()).toEqual([0, 256, 512]);
    const edited = steps[600];
    if (edited === undefined) throw new Error('no step 600');
    s.store.dispatch(setStepLocation(edited.id, worldLocation(123, -4567)));
    s.timers.advance(0);
    const after = s.handle.store.getState().results;
    expect(after?.revision).toBe(1);
    expect(after?.walkedFrom).toBe(512);
    expect(after?.timing.sinceChangeMs).toBe(0);
    // A new pipeline over the edited project walks it from the start.
    const fresh = setup({ steps: [...s.store.getState().project.route.steps] });
    fresh.timers.advance(0);
    expect(fresh.handle.store.getState().results?.walkedFrom).toBe(0);
    expect(comparable(after ?? null)).toEqual(comparable(fresh.handle.store.getState().results));
  });

  it('starts a new walker when the rules change (assumptions, character), and uses the project assumptions', () => {
    const s = setup();
    s.timers.advance(0);
    const before = s.handle.store.getState().results;
    const setDetour: Command = { label: 'Set detour', apply: (p) => ({ ...p, assumptions: { ...p.assumptions, travelDetourFactor: 2 } }) };
    s.store.dispatch(setDetour);
    s.timers.advance(0);
    const after = s.handle.store.getState().results;
    expect(after?.walkedFrom).toBe(0);
    expect(after?.rules.values.groundDetourFactor).toEqual({ value: 2, basis: 'assumption', source: 'project', from: 'project' });
    expect(after?.metrics.duration.value ?? 0).toBeGreaterThan(before?.metrics.duration.value ?? 0);
    s.store.dispatch(updateSettings({ character: { startLevel: 5 } }));
    s.timers.advance(0);
    expect(s.handle.store.getState().results?.walkedFrom).toBe(0);
  });

  it('publishes the state before and after the selection focus, and follows the focus without walking', () => {
    const s = setup();
    s.timers.advance(0);
    const step = s.steps[2];
    if (step === undefined) throw new Error('no step');
    s.store.select({ kind: 'single', id: step.id });
    const selected = s.handle.store.getState().selected;
    expect(selected).toMatchObject({ revision: 0, stepId: step.id, index: 2 });
    expect(selected?.record.step).toBe(step);
    // Step 3 accepts quest 2: in the log after it, not before.
    expect(selected?.before.questLog.has(2 as never)).toBe(false);
    expect(selected?.after.questLog.has(2 as never)).toBe(true);
    expect(s.pipeline.walks).toBe(1);
    s.store.select({ kind: 'none' });
    expect(s.handle.store.getState().selected).toBeNull();
    // Any other step's state, from the store's action.
    expect(s.handle.store.stateBefore(3)?.questLog.has(2 as never)).toBe(true);
    expect(s.handle.store.stateBefore(s.steps.length + 1)).toBeNull();
  });

  it('reports a walk that throws as failed and starts afresh on the next change', () => {
    const s = setup();
    const broken: Command = { label: 'Break', apply: (p) => ({ ...p, rulesetId: 'no-such-ruleset' as never }) };
    s.store.dispatch(broken);
    s.timers.advance(0);
    expect(s.handle.store.getState()).toMatchObject({ status: 'failed' });
    expect(s.handle.store.getState().failure).toMatch(/^The route could not be simulated: /);
    s.store.undo();
    s.timers.advance(0);
    expect(s.handle.store.getState()).toMatchObject({ status: 'ready', failure: null });
  });
});

describe('derived pipeline: navigation', () => {
  it('selects the navigation model, walks with pending fallback legs, computes the revision\'s legs and re-walks once per batch', async () => {
    const s = setup({ navigation: 'available' });
    s.timers.advance(0);
    const first = s.handle.store.getState();
    expect(first.travel).toMatchObject({ model: 'navigation', revision: s.runtime.manifest.navRevision, unavailableMaps: [], unavailableAll: false });
    expect(first.results?.travelModel).toBe('navigation');
    expect(first.results?.pendingLegs).toBeGreaterThan(0);
    expect(first.results?.final).toBe(false);
    expect(provisionalNote(first)).toMatch(/^Pending: \d+ walking legs? (is|are) still being computed; /);
    // The revision's legs were enumerated and requested in one bulk "computing paths" request.
    expect(s.service.legCalls).toHaveLength(1);
    expect(s.service.legCalls[0]?.priority).toBe('bulk');
    expect(first.paths).toMatchObject({ state: 'running', revision: 0 });
    const walks = s.pipeline.walks;
    const pending = first.results?.pendingLegs ?? 0;
    expect(first.paths).toMatchObject({ done: 0, total: pending });
    // Results in two parts, 50 ms apart: one scheduler batch, then one re-walk.
    answer(s.service.legCalls[0], straight, 2, false);
    s.timers.advance(50);
    expect(s.pipeline.walks).toBe(walks);
    s.service.legCalls[0]?.resolve();
    await settle();
    s.timers.advance(100);
    expect(s.pipeline.walks).toBe(walks + 1);
    const done = s.handle.store.getState();
    expect(done.results?.pendingLegs).toBe(0);
    expect(done.results?.final).toBe(true);
    expect(provisionalNote(done)).toBeNull();
    expect(done.paths.state).toBe('idle');
    // Progress is counted as the pending note counts legs: all of them done.
    expect(done.paths).toMatchObject({ done: pending, total: pending });
    expect(done.results?.records.flatMap((r) => r.legs).some((leg) => leg.method === 'navigation')).toBe(true);
    // Nothing more to do: no further walks.
    s.timers.advance(1000);
    expect(s.pipeline.walks).toBe(walks + 1);
  });

  it('re-walks at most every 100 ms however many batches arrive', async () => {
    const s = setup({ navigation: 'available', steps: longRoute(40) });
    s.timers.advance(0);
    const call = s.service.legCalls[0];
    if (call === undefined) throw new Error('no call');
    // One result every 20 ms: the scheduler applies them every 100 ms, and each batch re-walks once.
    for (const [i, q] of call.queries.entries()) {
      call.onProgress?.({ done: i + 1, total: call.queries.length, results: [{ index: i, result: straight(q) }] });
      s.timers.advance(20);
    }
    call.resolve();
    await settle();
    s.timers.advance(200);
    const walkTimes = s.publishedAt;
    expect(walkTimes.length).toBeGreaterThan(3);
    const gaps = walkTimes.slice(1).map((t, i) => t - (walkTimes[i] ?? 0));
    expect(gaps.every((gap) => gap >= 100)).toBe(true);
    expect(s.handle.store.getState().results?.pendingLegs).toBe(0);
  });

  it('never walks a superseded revision: a batch after an edit re-walks only the latest', async () => {
    const s = setup({ navigation: 'available' });
    s.timers.advance(0);
    const from = s.published.length;
    const walks = s.pipeline.walks;
    answer(s.service.legCalls[0]);
    await settle();
    // The batch is applied (computing paths flushed it); an edit lands before its re-walk is due.
    s.store.dispatch(insertNote({ text: 'edit' }));
    s.timers.advance(100);
    s.timers.advance(200);
    // One walk, of revision 1: the batch's re-walk merged into the edit's walk.
    expect(s.published.slice(from).map((r) => r.revision)).toEqual([1]);
    expect(s.pipeline.walks).toBe(walks + 1);
    expect(s.handle.store.getState().results?.pendingLegs).toBe(0);
  });

  it('cancelling "computing paths" keeps the legs pending until resumed', async () => {
    const s = setup({ navigation: 'available' });
    s.timers.advance(0);
    s.handle.store.cancelPaths();
    await settle();
    expect(s.handle.store.getState().paths.state).toBe('paused');
    // The background drain gets nothing to ask for, and later walks keep their legs pending.
    s.store.dispatch(insertNote({ text: 'edit' }));
    s.timers.advance(0);
    s.timers.advance(1000);
    expect(s.service.legCalls).toHaveLength(1);
    const paused = s.handle.store.getState();
    expect(paused.results?.pendingLegs).toBeGreaterThan(0);
    expect(provisionalNote(paused)).toMatch(/not being computed \(paused\)/);
    s.handle.store.resumePaths();
    s.timers.advance(100);
    expect(s.service.legCalls).toHaveLength(2);
    answer(s.service.legCalls[1]);
    await settle();
    s.timers.advance(200);
    expect(s.handle.store.getState().results?.pendingLegs).toBe(0);
  });

  it('computePaths resolves once the revision is re-walked with complete legs', async () => {
    const s = setup({ navigation: 'available' });
    s.timers.advance(0);
    const computed = s.handle.store.computePaths();
    answer(s.service.legCalls[0]);
    await expect(computed).resolves.toMatchObject({ revision: 0, complete: true });
    expect(s.handle.store.getState().results?.final).toBe(true);
  });

  it('computePaths rejects when its caller aborts, and automatic computing carries on (NAV-05)', async () => {
    const s = setup({ navigation: 'available' });
    s.timers.advance(0);
    const controller = new AbortController();
    const computed = s.handle.store.computePaths({ signal: controller.signal });
    controller.abort(new DOMException('optimiser cancelled', 'AbortError'));
    await expect(computed).rejects.toThrow('optimiser cancelled');
    await settle();
    // The caller stopped waiting; the run it joined is automatic computing's too, and goes on.
    expect(s.handle.store.getState().paths.state).toBe('running');
    expect(s.service.legCalls).toHaveLength(1);
    answer(s.service.legCalls[0]);
    await settle();
    s.timers.advance(200);
    const state = s.handle.store.getState();
    expect(state.results?.final).toBe(true);
    expect(state.paths.state).toBe('idle');
    expect(provisionalNote(state)).toBeNull();
  });

  it('exports without waiting for legs: the RXP and JSON exports are the same while legs are pending and after', async () => {
    const s = setup({ navigation: 'available' });
    s.timers.advance(0);
    expect(s.handle.store.getState().results?.final).toBe(false);
    const project = s.store.getState().project;
    const exportNow = () => ({ rxp: previewRxpExport(project, createRxpContext(MAP_TEST_DATASET, null), 'Test').txt.text, json: exportProjectFile(project, 'Test') });
    const pending = exportNow();
    answer(s.service.legCalls[0]);
    await settle();
    s.timers.advance(200);
    expect(s.handle.store.getState().results?.final).toBe(true);
    expect(exportNow()).toEqual(pending);
  });

  it('keeps the straight-line model when navigation is unavailable, and final results', () => {
    const s = setup();
    s.timers.advance(0);
    s.pipeline.setNavigation({ kind: 'unavailable', reason: 'this deploy has no navigation data' });
    s.timers.advance(0);
    const state = s.handle.store.getState();
    expect(state.travel).toMatchObject({ model: 'straight-line', reason: 'this deploy has no navigation data' });
    expect(state.results?.travelModel).toBe('straight-line');
    expect(state.results?.final).toBe(true);
    expect(state.results?.pendingLegs).toBe(0);
    // Checking and unavailable use the same model: nothing was re-walked.
    expect(state.results?.walkedFrom).toBe(s.steps.length);
    expect(s.service.legCalls).toHaveLength(0);
  });

  it('falls back for good when the worker cannot start, and says so in the travel status', async () => {
    const s = setup({ navigation: 'available' });
    s.timers.advance(0);
    s.service.legCalls[0]?.reject(new NavWorkerError('unsupported', 'no module workers'));
    await settle();
    s.timers.advance(100);
    s.timers.advance(100);
    const state = s.handle.store.getState();
    expect(state.travel.unavailableAll).toBe(true);
    expect(state.results?.pendingLegs).toBe(0);
    expect(state.results?.final).toBe(true);
    expect(state.results?.records.flatMap((r) => r.legs).every((leg) => leg.method === 'straight-line')).toBe(true);
  });

  it('switches from the straight-line model to navigation when the manifest arrives', () => {
    const s = setup();
    s.timers.advance(0);
    expect(s.handle.store.getState().results?.travelModel).toBe('straight-line');
    s.pipeline.setNavigation({ kind: 'available', runtime: s.runtime });
    s.timers.advance(0);
    expect(s.handle.store.getState().results).toMatchObject({ travelModel: 'navigation', walkedFrom: 0 });
    expect(s.handle.store.getState().travel.model).toBe('navigation');
  });

  it('starts "computing paths" in a task of its own, after the results are published (PERF-03)', () => {
    const s = setup();
    s.timers.advance(0);
    s.pipeline.setNavigation({ kind: 'available', runtime: s.runtime });
    // The walk's own task: results published, no legs enumerated or sent yet.
    s.pipeline.flush();
    expect(s.handle.store.getState().results).toMatchObject({ travelModel: 'navigation', final: false });
    expect(s.service.legCalls).toHaveLength(0);
    // The next task: one bulk run for the revision's legs, and the background drain asked for none
    // of them (it was held until the run had claimed them).
    s.timers.advance(0);
    expect(s.service.legCalls.map((c) => c.priority)).toEqual(['bulk']);
    expect(s.handle.store.getState().paths.state).toBe('running');
    s.timers.advance(1000);
    expect(s.service.legCalls).toHaveLength(1);
  });

  it('asks for the legs of an edit made during a long run at once, as interactive, before the run ends (NAV-03)', async () => {
    const steps = longRoute(40);
    const s = setup({ navigation: 'available', steps });
    s.timers.advance(0);
    expect(s.service.legCalls.map((c) => c.priority)).toEqual(['bulk']);
    const bulk = s.service.legCalls[0];
    if (bulk === undefined) throw new Error('no run');
    const moved = steps[20];
    if (moved === undefined) throw new Error('no step 20');
    s.store.dispatch(setStepLocation(moved.id, worldLocation(777, -4777)));
    s.timers.advance(0);
    // The edit's legs went out beside the run, ahead of its bulk groups.
    expect(s.service.legCalls.map((c) => c.priority)).toEqual(['bulk', 'interactive']);
    const edit = s.service.legCalls[1];
    if (edit === undefined) throw new Error('no edit request');
    const inBulk = new Set(bulk.queries.map((q) => JSON.stringify(q)));
    expect(edit.queries.length).toBeGreaterThan(0);
    expect(edit.queries.every((q) => !inBulk.has(JSON.stringify(q)))).toBe(true);
    answer(edit);
    await settle();
    s.timers.advance(200);
    // The edited step is priced from the navmesh while the superseded run is still out.
    const state = s.handle.store.getState();
    expect(state.paths.state).toBe('running');
    expect(state.results?.revision).toBe(1);
    expect(state.results?.records[20]?.legs.every((leg) => !leg.pending)).toBe(true);
    expect(state.results?.records[21]?.legs.every((leg) => !leg.pending)).toBe(true);
    answer(bulk);
    await settle();
    s.timers.advance(200);
    await settle();
    s.timers.advance(200);
    expect(s.handle.store.getState().results?.final).toBe(true);
  });

  it('retries a run after a network failure, saying so, and finishes when the network is back (NAV-05, UI-04)', async () => {
    const s = setup({ navigation: 'available' });
    s.timers.advance(0);
    s.service.legCalls[0]?.reject(new NavWorkerError('network', '1/map.bin could not be fetched (Failed to fetch)', '1/map.bin', 1));
    await settle();
    const waiting = s.handle.store.getState();
    expect(waiting.paths).toMatchObject({ state: 'running', failure: '1/map.bin could not be fetched (Failed to fetch)' });
    expect(provisionalNote(waiting)).toMatch(/^Pending: \d+ walking legs? (is|are) waiting to be computed again after a failure that may pass \(1\/map\.bin could not be fetched \(Failed to fetch\)\); /);
    expect(pendingTravelReason(waiting)).toBe('retrying');
    expect(pendingTravelText(waiting)).toBe(
      'Pending: computing the walking path failed (1/map.bin could not be fetched (Failed to fetch)) and will be tried again shortly, so the travel time is a straight-line estimate for now',
    );
    s.timers.advance(5000);
    await settle();
    expect(s.service.legCalls).toHaveLength(2);
    expect(s.handle.store.getState().paths).toMatchObject({ state: 'running', failure: null });
    answer(s.service.legCalls[1]);
    await settle();
    s.timers.advance(200);
    const done = s.handle.store.getState();
    expect(done.results?.final).toBe(true);
    expect(done.paths.state).toBe('idle');
  });

  it('falls back for good, with final results, when the worker fails (its script did not load) (NAV-01)', async () => {
    const s = setup({ navigation: 'available' });
    s.timers.advance(0);
    s.service.legCalls[0]?.reject(new NavWorkerError('worker-failed', 'navigation worker: the navigation worker failed to start'));
    await settle();
    s.timers.advance(100);
    s.timers.advance(100);
    const state = s.handle.store.getState();
    expect(state.travel.unavailableAll).toBe(true);
    expect(state.results?.final).toBe(true);
    expect(provisionalNote(state)).toBeNull();
    s.timers.advance(600_000);
    expect(s.service.legCalls).toHaveLength(1);
  });

  it('turns navigation off after an unexpected run failure, final with straight-line legs, and resumePaths tries again (NAV-05, UI-04)', async () => {
    const s = setup({ navigation: 'available' });
    const real = s.runtime.scheduler.computeLegs.bind(s.runtime.scheduler);
    s.runtime.scheduler.computeLegs = () => Promise.reject(new Error('the model broke'));
    s.timers.advance(0);
    await settle();
    expect(s.handle.store.getState().paths).toMatchObject({ state: 'failed', failure: 'the model broke' });
    expect(pendingTravelReason(s.handle.store.getState())).toBe('failed');
    s.timers.advance(100);
    s.timers.advance(100);
    const failed = s.handle.store.getState();
    expect(failed.travel.unavailableAll).toBe(true);
    expect(failed.results?.final).toBe(true);
    expect(provisionalNote(failed)).toBeNull();
    s.runtime.scheduler.computeLegs = real;
    s.handle.store.resumePaths();
    expect(s.handle.store.getState().travel.unavailableAll).toBe(false);
    s.timers.advance(200);
    // A new run (the stand-in failed before claiming anything, so the background drain may have
    // asked for the first walk's legs meanwhile).
    expect(s.service.legCalls.at(-1)?.priority).toBe('bulk');
    expect(s.handle.store.getState().paths.state).toBe('running');
    for (const call of s.service.legCalls) answer(call);
    await settle();
    s.timers.advance(200);
    expect(s.handle.store.getState().results?.final).toBe(true);
  });

  it('counts progress in the pending note\'s unit: total minus done is the pending legs (UI-09)', () => {
    const s = setup({ navigation: 'available', steps: longRoute(12) });
    s.timers.advance(0);
    const call = s.service.legCalls[0];
    if (call === undefined) throw new Error('no call');
    const pending = s.handle.store.getState().results?.pendingLegs ?? 0;
    expect(pending).toBeGreaterThan(4);
    expect(s.handle.store.getState().paths).toMatchObject({ done: 0, total: pending });
    // Half of the legs arrive; one batch and one re-walk later the two counts still agree.
    call.onProgress?.({ done: 5, total: call.queries.length, results: call.queries.slice(0, 5).map((q, index) => ({ index, result: straight(q) })) });
    s.timers.advance(100);
    s.timers.advance(100);
    const state = s.handle.store.getState();
    expect(state.paths.state).toBe('running');
    expect(state.paths.done).toBeGreaterThan(0);
    expect(state.paths.total - state.paths.done).toBe(state.results?.pendingLegs);
  });

  it('seeds the TravelGraph with the docks the route\'s transport steps give (TIME-7, NAV-08)', () => {
    const ids = sequentialIdSource(500);
    const at = (mapId: number, x: number, y: number): Location => ({ source: worldSourcedPoint(worldMapId(mapId), x, y), label: null, radius: null });
    const steps = [
      makeTravelStep(ids, { mode: 'walk', location: at(1, 100, -4000) }),
      // Boards the ship without saying where: the graph's Auberdine dock is used.
      makeTravelStep(ids, { mode: 'transport', transport: { id: 'stormwind-auberdine', dock: null }, location: at(0, -8000, 500) }),
      // A later step gives the Auberdine dock's position (a test position).
      makeTravelStep(ids, { mode: 'transport', transport: { id: 'stormwind-auberdine', dock: at(1, 300, -4000) }, location: at(0, -8000, 600) }),
    ];
    const s = setup({ steps });
    s.timers.advance(0);
    const legs = s.handle.store.getState().results?.records[1]?.legs ?? [];
    expect(legs.find((leg) => leg.purpose === 'dock')?.to.point).toEqual({ mapId: 1, x: 300, y: -4000 });
  });

  it('says when same-map transports cannot apply: no dock has a position (NAV-08)', () => {
    const s = setup({ navigation: 'available' });
    s.timers.advance(0);
    expect(s.handle.store.getState().travel.transportNote).toMatch(/^Boats and zeppelins between two docks on one continent are not used/);
  });
});
