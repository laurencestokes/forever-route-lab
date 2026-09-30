/**
 * Edit-to-derived-results benchmark (ARCHITECTURE §12.1, §14: "edit to derived results published"
 * ≤ 50 ms): the app's derived-result pipeline (src/app/derived-pipeline.ts) on a 10,000-step
 * route, from a store command to the results being published in the derived store.
 *
 *   pnpm exec tsx tests/bench/derived.bench.ts [--runs 21] [--warm 3] [--steps 10000]
 *   pnpm exec tsx tests/bench/derived.bench.ts --budget      (exit 1 when an edit median is over 50 ms,
 *                                                             or a startup task's over 100 ms)
 *   pnpm exec tsx tests/bench/derived.bench.ts --check <file> (exit 1 on a regression over 25% of the
 *                                                             file's `derived10000` medians)
 *
 * The route is tests/bench/engine.bench.ts's (the same builder, so the numbers compare with
 * `route10000` and `validate10000` in docs/measurements/engine-m6.json): the sample character's
 * view of the committed dataset, accept, complete-all and turn-in cycles with a hearth every 25th
 * and a grind every 40th, 10,000 steps, straight-line travel (navigation "unavailable"), so the
 * validator reports many issues (a stress case).
 *
 * Each case dispatches one command to the editor store and runs the pipeline's scheduled walk at
 * once (`flush`, instead of the zero-delay timer the app waits for), then reads the published
 * results' `timing.sinceChangeMs` (store change to publish, `performance.now()`), which includes the
 * re-walk from the engine's checkpoint, validation, route metrics, the per-step issue lists and the
 * state at the selected step. Cases (min / median / p90 in ms):
 * - `firstWalk`: a new pipeline's first walk (a cold walker);
 * - `editStart`: step 10's note changed: a re-walk of every step from checkpoint 0 (the worst edit);
 * - `editMiddle`: step 5,000's note changed: from checkpoint 4,864;
 * - `editEnd`: the last step's note changed;
 * - `select`: the selection moved to another step (no walk: `stateBefore` twice);
 * - `classChange`: the character's class changed to one not seen lately (a settings edit that
 *   changes the context: a new dataset view, graph, walker and validator, so a cold walk; the
 *   classes rotate through three, more than the pipeline's four cached views hold);
 * - `classToggle`: the class switched back and forth between two (the pipeline keeps both pairs of
 *   views, so the simulation and availability caches keyed by them stay warm; PERF-06);
 * - `navigationArrives`: navigation becoming available on a live pipeline (the manifest loaded):
 *   a context change to the navigation model with every leg pending, walked cold. `sinceChangeMs`
 *   is the published timing; `taskMs` the whole synchronous task (the "computing paths" run starts
 *   in a task of its own, PERF-03), and `runTaskMs` that next task (enumerating the legs and the
 *   run's first round);
 * - `navEditStart`, `navEditMiddle`: the edits above with the navigation model and every leg
 *   computed (a worker stand-in that answers at once), which adds the leg-table lookups (PERF-02);
 * - `taxiArrives` (review TR-11): the committed client taxi file arriving on a live pipeline (a
 *   loader held until the first walk is published): the TravelGraph re-seeded with its nodes,
 *   flights and inferred docks, TIME-6's per-leg data, and the walk that follows, published.
 *   `sinceChangeMs` is the published timing; `taskMs` the whole synchronous task.
 *
 * `--budget`: the edit cases (editStart, editMiddle, editEnd, select, classChange, classToggle,
 * navEditStart, navEditMiddle) against §14's 50 ms edit to results; the startup cases (firstWalk,
 * navigationArrives' task and taxiArrives' task) against §14's rule of no long task over 100 ms.
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fixedClock } from '../../src/app/clock';
import { updateStepNote } from '../../src/app/commands';
import { createDerivedStore, type DerivedResults } from '../../src/app/derived';
import { type ClientTableLoaders, createDerivedPipeline, type DerivedPipeline } from '../../src/app/derived-pipeline';
import { createNavigationRuntime, type DisposableNavLegService, type NavigationState } from '../../src/app/navigation-runtime';
import type { NavTimers } from '../../src/app/navigation-scheduler';
import { testNavManifest } from '../../src/app/navigation-test-helpers';
import { updateSettings } from '../../src/app/project-commands';
import type { NavLegQuery, NavLegResult } from '../../src/nav/worker/protocol';
import { createEditorStore, type EditorStore } from '../../src/app/store';
import { loadWorkspace } from '../../src/app/workspace';
import type { DatasetView, QuestRecord } from '../../src/domain/dataset';
import { type NpcId, sequentialIdSource } from '../../src/domain/ids';
import type { Location } from '../../src/domain/points';
import { defaultCharacter } from '../../src/domain/project-factory';
import type { ProjectV1 } from '../../src/domain/project';
import type { RouteStep } from '../../src/domain/route';
import { makeAcceptStep, makeCompleteStep, makeGrindStep, makeHearthStep, makeTurnInStep } from '../../src/domain/step-factory';
import type { ClientTableLoad, ClientTaxi } from '../../src/infra/maps/client-tables';
import { fakeServer, nodeSha256, publicSite } from '../support/fake-fetch';
import { committedTaxi } from './bench-support';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const RUNS = Number(option('--runs', '21'));
const WARM = Number(option('--warm', '3'));
const STEPS = Number(option('--steps', '10000'));
const BUDGET = args.includes('--budget');
const CHECK = args.includes('--check') ? option('--check', 'docs/measurements/engine-m6.json') : null;
const NOW = '2026-09-26T00:00:00.000Z';
/** ARCHITECTURE §14: edit to derived results published. */
const BUDGET_MS = 50;
/** ARCHITECTURE §14: no long task over 100 ms (startup: the first walk, navigation arriving). */
const LONG_TASK_MS = 100;
/** §14: a stored baseline fails on a regression of more than 25%. */
const REGRESSION = 1.25;

interface Stats {
  readonly min: number;
  readonly median: number;
  readonly p90: number;
}

const round = (value: number): number => Math.round(value * 100) / 100;

function stats(values: readonly number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] ?? 0;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return { min: round(sorted[0] ?? 0), median: round(median), p90: round(at(0.9)) };
}

// The route of tests/bench/engine.bench.ts.

function spawnLocation(view: DatasetView, id: NpcId): Location | null {
  const spawn = view.spawns({ kind: 'npc', id }).find((candidate) => candidate.world !== null && 'space' in candidate.source && candidate.source.space === 'zone');
  if (spawn === undefined || !('space' in spawn.source)) return null;
  return { source: spawn.source, label: null, radius: null };
}

function onlyNpc(view: DatasetView, refs: QuestRecord['starters']): NpcId | null {
  const [only, ...rest] = refs;
  if (only === undefined || rest.length > 0 || only.kind !== 'npc') return null;
  return view.spawns(only).some((spawn) => spawn.world !== null) ? only.id : null;
}

function buildRoute(view: DatasetView, count: number): RouteStep[] {
  const ids = sequentialIdSource();
  const cycles: { quest: QuestRecord; workAt: Location | null }[] = [];
  for (const quest of view.quests()) {
    if (onlyNpc(view, quest.starters) === null || onlyNpc(view, quest.finishers) === null) continue;
    if (quest.objectives.length === 0 || !quest.objectives.every((objective) => objective.kind === 'kill' || objective.kind === 'item')) continue;
    const first = quest.objectives[0];
    const workNpc = first?.kind === 'kill' ? first.npcId : null;
    cycles.push({ quest, workAt: workNpc === null ? null : spawnLocation(view, workNpc) });
  }
  if (cycles.length === 0) throw new Error('no quest fits the benchmark route');
  const steps: RouteStep[] = [];
  for (let k = 0; steps.length < count; k += 1) {
    const { quest, workAt } = cycles[k % cycles.length] ?? { quest: null, workAt: null };
    if (quest === null) break;
    steps.push(makeAcceptStep(ids, { questId: quest.id }));
    steps.push(makeCompleteStep(ids, { targets: [{ questId: quest.id, objective: null }], location: workAt }));
    steps.push(makeTurnInStep(ids, { questId: quest.id }));
    if (k % 25 === 24) steps.push(makeHearthStep(ids));
    if (k % 40 === 39) steps.push(makeGrindStep(ids, { until: { kind: 'level', level: Math.min(60, 2 + Math.floor(k / 40)), offset: null } }));
  }
  return steps.slice(0, count);
}

/** Timers that never fire by themselves: the benchmark runs the scheduled walk with `flush`. */
const manualTimers: NavTimers = { set: () => 0, clear: () => undefined };

const server = fakeServer(publicSite());
const workspace = await loadWorkspace({
  fetch: server.fetch,
  baseUrl: './',
  sha256: nodeSha256,
  nowIso: NOW,
  now: () => performance.now(),
  yieldToRender: () => Promise.resolve(),
});
const sample = workspace.project;
const character = defaultCharacter({ ...sample.character, priorHistory: 'fresh', hearthLocation: sample.character.startLocation });
const view = workspace.data.view({ faction: character.faction, class: character.class, customQuests: [], questOverrides: {} });
const steps = buildRoute(view, STEPS);
const project: ProjectV1 = { ...sample, character, customQuests: [], questOverrides: {}, route: { ...sample.route, steps, groups: {} } };

interface Bench {
  readonly store: EditorStore;
  readonly pipeline: DerivedPipeline;
  readonly derived: ReturnType<typeof createDerivedStore>;
}

function start(navigation: NavigationState = { kind: 'unavailable', reason: 'benchmark: straight-line model' }, timers: NavTimers = manualTimers, clientTables: ClientTableLoaders | null = null): Bench {
  const store = createEditorStore({ project, ids: sequentialIdSource(1_000_000), clock: fixedClock(NOW), coalesceWindowMs: 0 });
  const derived = createDerivedStore();
  const pipeline = createDerivedPipeline({
    store,
    data: workspace.data,
    geometry: workspace.geometry.geometry,
    output: derived,
    navigation,
    timers,
    now: () => performance.now(),
    clientTables,
  });
  return { store, pipeline, derived };
}

/** A walkable result as long as the straight line × 1.1 (tenth-yards). */
function answerOf(q: NavLegQuery): NavLegResult {
  const d = Math.sqrt((q.to.x - q.from.x) ** 2 + (q.to.y - q.from.y) ** 2);
  return { reachable: true, reason: 'ok', groundTenths: Math.round(d * 11), swimTenths: 0, connectorTenthsSeconds: 0, longestSwimYd: 0, flags: [], passages: [], from: { snapped: true, ambiguous: false }, to: { snapped: true, ambiguous: false } };
}

/** Worker stand-ins: one that answers every leg at once, one that never answers. */
const answering: DisposableNavLegService = {
  legs: (queries, options) => {
    const results = queries.map(answerOf);
    options?.onProgress?.({ done: results.length, total: results.length, results: results.map((result, index) => ({ index, result })) });
    return Promise.resolve(results);
  },
  path: () => Promise.resolve(null),
  dispose: () => undefined,
};
const silent: DisposableNavLegService = { legs: () => new Promise<never>(() => undefined), path: () => new Promise<never>(() => undefined), dispose: () => undefined };
/** The committed manifest's maps (0 and 1) with a navRevision of its length; no files are read. */
const NAV_MANIFEST = testNavManifest([0, 1]);

/** Timers that run only when asked (`runAll`), whatever their delay. */
class QueuedTimers implements NavTimers {
  private readonly queue = new Map<number, () => void>();
  private next = 1;
  set(callback: () => void): unknown {
    const id = this.next;
    this.next += 1;
    this.queue.set(id, callback);
    return id;
  }
  clear(handle: unknown): void {
    this.queue.delete(handle as number);
  }
  runAll(): void {
    for (let round = 0; round < 20 && this.queue.size > 0; round += 1) {
      const due = [...this.queue.values()];
      this.queue.clear();
      for (const callback of due) callback();
    }
  }
}

const resultsOf = (b: Bench): DerivedResults => {
  const r = b.derived.store.getState().results;
  if (r === null) throw new Error(`no results: ${b.derived.store.getState().failure ?? 'not walked'}`);
  return r;
};

/** Runs `action` RUNS times after WARM warm-ups and collects the published `sinceChangeMs`. */
function bench(b: Bench, action: (i: number) => void, read: () => number = () => resultsOf(b).timing.sinceChangeMs): Stats {
  for (let i = 0; i < WARM; i += 1) {
    action(-1 - i);
    b.pipeline.flush();
  }
  const times: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    action(i);
    b.pipeline.flush();
    times.push(read());
  }
  return stats(times);
}

const firstTimes: number[] = [];
let issues = 0;
for (let i = 0; i < WARM + RUNS; i += 1) {
  const b = start();
  b.pipeline.flush();
  const r = resultsOf(b);
  if (i >= WARM) firstTimes.push(r.timing.sinceChangeMs);
  issues = r.issues.length;
  b.pipeline.dispose();
}
const firstWalk = stats(firstTimes);

const b = start();
b.pipeline.flush();
const noteEdit = (index: number) => (i: number) => {
  const step = b.store.getState().project.route.steps[index];
  if (step === undefined) throw new Error(`no step ${String(index)}`);
  b.store.dispatch(updateStepNote(step.id, `bench ${String(i)}`));
};
const walkedFrom: Record<string, number> = {};
const phases = (name: string, stat: Stats): Stats & { readonly walkMs: number; readonly metricsMs: number; readonly walkedFrom: number } => {
  const r = resultsOf(b);
  walkedFrom[name] = r.walkedFrom;
  return { ...stat, walkMs: round(r.timing.walkMs), metricsMs: round(r.timing.metricsMs), walkedFrom: r.walkedFrom };
};
const editStart = phases('editStart', bench(b, noteEdit(10)));
const editMiddle = phases('editMiddle', bench(b, noteEdit(Math.floor(STEPS / 2))));
const editEnd = phases('editEnd', bench(b, noteEdit(STEPS - 1)));

let selectMs = 0;
const select = bench(
  b,
  (i) => {
    const step = b.store.getState().project.route.steps[(i + 20) * 397 % STEPS];
    if (step === undefined) return;
    const t0 = performance.now();
    b.store.select({ kind: 'single', id: step.id });
    selectMs = performance.now() - t0;
  },
  () => selectMs,
);

// A settings edit that changes the context (class, so the dataset view): a new view, graph, walker.
const ROTATION = ['SHAMAN', 'WARRIOR', 'HUNTER'] as const;
let rotation = 0;
const classChange = phases(
  'classChange',
  bench(b, () => {
    rotation += 1;
    b.store.dispatch(updateSettings({ character: { class: ROTATION[rotation % ROTATION.length] ?? 'SHAMAN' } }));
  }),
);
// Back and forth between two classes: both pairs of views stay cached.
const classToggle = phases(
  'classToggle',
  bench(b, (i) => {
    b.store.dispatch(updateSettings({ character: { class: i % 2 === 0 ? 'SHAMAN' : 'WARRIOR' } }));
  }),
);
b.pipeline.dispose();

// Navigation arriving on a live pipeline: the cold walk with every leg pending, published, then the
// "computing paths" run in its own task.
const arrivals: { since: number[]; task: number[]; run: number[] } = { since: [], task: [], run: [] };
for (let i = 0; i < WARM + RUNS; i += 1) {
  const timers = new QueuedTimers();
  const n = start({ kind: 'unavailable', reason: 'not yet' }, timers);
  n.pipeline.flush();
  const runtime = createNavigationRuntime(NAV_MANIFEST, silent, timers);
  const t0 = performance.now();
  n.pipeline.setNavigation({ kind: 'available', runtime });
  n.pipeline.flush();
  const t1 = performance.now();
  timers.runAll();
  const t2 = performance.now();
  if (i >= WARM) {
    arrivals.since.push(resultsOf(n).timing.sinceChangeMs);
    arrivals.task.push(t1 - t0);
    arrivals.run.push(t2 - t1);
  }
  n.pipeline.dispose();
  runtime.dispose();
}
const navigationArrives = { sinceChangeMs: stats(arrivals.since), taskMs: stats(arrivals.task), runTaskMs: stats(arrivals.run) };

// Edits with the navigation model and every leg computed.
const navRuntime = createNavigationRuntime(NAV_MANIFEST, answering, manualTimers);
const nb = start({ kind: 'available', runtime: navRuntime });
nb.pipeline.flush();
const computed = await nb.derived.store.computePaths();
if (!computed.complete || resultsOf(nb).travelModel !== 'navigation') throw new Error('the navigation legs were not computed');
const navEdit = (index: number) => (i: number) => {
  const step = nb.store.getState().project.route.steps[index];
  if (step === undefined) throw new Error(`no step ${String(index)}`);
  nb.store.dispatch(updateStepNote(step.id, `bench ${String(i)}`));
};
const navStats = (stat: Stats): Stats & { readonly walkMs: number; readonly pendingLegs: number } => {
  const r = resultsOf(nb);
  return { ...stat, walkMs: round(r.timing.walkMs), pendingLegs: r.pendingLegs };
};
const navEditStart = navStats(bench(nb, navEdit(10)));
const navEditMiddle = navStats(bench(nb, navEdit(Math.floor(STEPS / 2))));
nb.pipeline.dispose();
navRuntime.dispose();

// The committed taxi file arriving on a live pipeline (TR-11): held until the first walk is published.
const taxiTable = await committedTaxi();
const taxiArrivals: { since: number[]; task: number[] } = { since: [], task: [] };
for (let i = 0; i < WARM + RUNS; i += 1) {
  let release: (load: ClientTableLoad<ClientTaxi>) => void = () => undefined;
  const held = new Promise<ClientTableLoad<ClientTaxi>>((resolve) => {
    release = resolve;
  });
  const t = start(undefined, manualTimers, { taxi: () => held, dungeons: () => new Promise<never>(() => undefined) });
  t.pipeline.flush();
  const before = resultsOf(t);
  release({ kind: 'loaded', table: taxiTable });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const t0 = performance.now();
  t.pipeline.flush();
  const t1 = performance.now();
  const after = resultsOf(t);
  if (after === before || after.taxiPending) throw new Error('no walk after the taxi file arrived');
  if (i >= WARM) {
    taxiArrivals.since.push(after.timing.sinceChangeMs);
    taxiArrivals.task.push(t1 - t0);
  }
  t.pipeline.dispose();
}
const taxiArrives = { sinceChangeMs: stats(taxiArrivals.since), taskMs: stats(taxiArrivals.task) };

const route = { steps: STEPS, issues, firstWalk, editStart, editMiddle, editEnd, select, classChange, classToggle, navigationArrives, navEditStart, navEditMiddle, taxiArrives };
console.log(JSON.stringify({ runs: RUNS, warm: WARM, node: process.version, platform: `${process.platform} ${process.arch}`, [`derived${String(STEPS)}`]: route }, null, 2));
if (BUDGET) {
  const edits = (['editStart', 'editMiddle', 'editEnd', 'select', 'classChange', 'classToggle', 'navEditStart', 'navEditMiddle'] as const).filter((name) => route[name].median > BUDGET_MS);
  const startup = [
    ['firstWalk', firstWalk.median],
    ['navigationArrives task', navigationArrives.taskMs.median],
    ['navigationArrives run task', navigationArrives.runTaskMs.median],
    ['taxiArrives task', taxiArrives.taskMs.median],
  ].filter(([, median]) => (median as number) > LONG_TASK_MS);
  if (edits.length > 0) console.error(`Over the ${String(BUDGET_MS)} ms edit-to-results budget: ${edits.map((name) => `${name} ${String(route[name].median)} ms`).join(', ')}`);
  if (startup.length > 0) console.error(`A startup task over ${String(LONG_TASK_MS)} ms: ${startup.map(([name, median]) => `${String(name)} ${String(median)} ms`).join(', ')}`);
  if (edits.length > 0 || startup.length > 0) process.exitCode = 1;
  else console.error(`Every edit case is within the ${String(BUDGET_MS)} ms budget and every startup task within ${String(LONG_TASK_MS)} ms (median).`);
}
if (CHECK !== null) {
  if (STEPS !== 10_000) throw new Error('--check compares a 10,000-step route (--steps 10000)');
  const stored = JSON.parse(readFileSync(CHECK, 'utf8')) as { derived10000?: Partial<Record<string, { median: number }>> };
  const baseline = stored.derived10000;
  if (baseline === undefined) {
    console.error(`${CHECK} has no derived10000 baseline`);
    process.exitCode = 1;
  } else {
    const current: Record<string, number> = {
      firstWalk: firstWalk.median,
      editStart: editStart.median,
      editMiddle: editMiddle.median,
      classChange: classChange.median,
      navEditStart: navEditStart.median,
      taxiArrives: taxiArrives.sinceChangeMs.median,
    };
    const found = Object.entries(current).flatMap(([name, now]) => {
      const was = baseline[name]?.median;
      return was !== undefined && now > was * REGRESSION ? [`${name}: ${String(now)} ms median, baseline ${String(was)} ms (+${String(Math.round((now / was - 1) * 100))}%)`] : [];
    });
    if (found.length > 0) {
      console.error(`Slower than the stored baseline by more than 25%:\n  ${found.join('\n  ')}`);
      process.exitCode = 1;
    } else {
      console.error('Within 25% of the stored baseline.');
    }
  }
}
