/**
 * Optimiser benchmark (docs/ARCHITECTURE.md §14: optimiser compile ≤ 30 ms; a pool of 100 quests
 * (~300 actions) at beam 256 gives a first improvement in < 2 s with the worker heap < 64 MB;
 * docs/research/optimizer-m7.md §14). The committed script behind the optimiser entries of
 * docs/measurements/optimizer-m7.json (`compile`, `firstImprovement`, `search`, `heap`).
 *
 *   pnpm exec tsx tests/bench/optimizer.bench.ts [--case compile|compileNav|firstImprovement|firstImprovementGuide|search|searchGuide|quality|walks|heap] [--runs 21] [--warm 3]
 *   pnpm exec tsx tests/bench/optimizer.bench.ts --check docs/measurements/optimizer-m7.json [--repeat 3] [--runs 15]
 *   pnpm exec tsx tests/bench/optimizer.bench.ts --reference   (prints the quality pools' references, minutes)
 *
 * **The pool** (generated, seeded; self-built, no guide text): 100 quests on Kalimdor, each an
 * accept at its giver, a located `complete` of one kill objective, and a turn-in at its finisher:
 * 300 actions. Givers and finishers stand at 12 quest hubs spread over 4,000 yd (70% of quests are
 * turned in where they were taken), and each objective lies within 600 yd of its giver. Quests are
 * level 30 with 400-1,000 XP (exact for the level-10 to level-35 character), and the kill NPCs are
 * level 12. The suffix is a note back at the start. Two incumbents (plan §14.1):
 * - **weak**: the quests in id order, each accept, complete and turn-in in a row (a guide nobody
 *   optimised);
 * - **guide**: a nearest-neighbour tour, by straight line from the start, taking at each step the
 *   nearest action whose quest's earlier actions are done (M7 review open item 1's tour).
 * The run goes through the app's own path (src/app/optimizer-host.ts, -walk.ts: the real
 * validator, the straight-line model at harness H's 10 yd/s and detour 1), with `keep-original` as
 * the target. Each search's exact block also prices the nearest-neighbour tour in its own problem
 * (`nearestNeighbourMs`, null when the tour breaks a rule of the search, as in pools 17 and 33).
 *
 * **Quality** (review M7Q Q-02): the search's own nearest-neighbour seed is that tour, so beating
 * the tour says little. The `quality` case runs the weak incumbent of `QUALITY_SEEDS` (eleven pools
 * of the same generator) to `SEARCH_EVALUATIONS` in process and compares each best with a stored,
 * independent **reference**: the best of two long iterated local searches from the
 * nearest-neighbour seed (`referenceRun`: 20,000,000 evaluations each, one with the local pass's
 * pre-screen and one without it, each with its own kick stream), computed by `--reference` and
 * stored in `quality.reference`. `--check` fails when the median gap to the reference exceeds
 * `QUALITY_MEDIAN_LIMIT_PCT` or any pool's exceeds `QUALITY_MAX_LIMIT_PCT`, and when a pool's exact
 * best changes. It reports the distribution of the gaps to the tour and to the reference.
 *
 * Cases, each timed with `performance.now()` (min / median / p90 in ms):
 * - `compile` (gated, ≤ 30 ms): `analyseSection` + `compileProblem`, fresh each run (no matrix
 *   cache), on the baseline walk; the walks themselves are `walks` (reported);
 * - `compileNav` (gated, ≤ 30 ms): one app run's main-thread analysis and compile on the navigation
 *   model with every leg already in the table (the leg service answers with walkable legs as long
 *   as the straight line): a new run walker each run, as each click makes one; the analysis walk,
 *   then timed `analyseSection` + "computing paths" (nothing to ask for) + the pending check +
 *   `compileProblem` on the baseline re-walk (review PRF-07: the run's walks share one place cache,
 *   so compile reuses the model's per-point cache and the leg table's keys);
 * - `firstImprovement` and `firstImprovementGuide` (gated, < 2,000 ms): from the client's `start`
 *   post (with the transfer) to the main thread receiving the first `best` below the incumbent, at
 *   beam 256, in a `worker_threads` worker running the real host (this file, bundled, is the worker
 *   too), from the weak and the guide incumbent; the run is then cancelled;
 * - `search` (gated against its baseline) and `searchGuide` (reported): a run to `maxEvaluations`
 *   2,000,000 (plan §14.1) at beam 256 in the worker, post to `done`, from the weak and the guide
 *   incumbent; it reports evaluations per second;
 * - `walks` (reported): the analysis walk and the baseline re-walk, on the pool (the route is the
 *   section) and on a 150-step section in the middle of bench-support's realistic 10,000-step route
 *   (plan §14.1: each walk within the 20 ms / 10,000-step budget; review RTD-05);
 * - `heap` (an absolute ceiling, < 64 MB): the largest `used_heap_size + external_memory`
 *   (`v8.getHeapStatistics()`) sampled in the worker after every slice (the host's `sample()` hook),
 *   each sample after a full collection (`--expose-gc` set in the worker at run time), over a
 *   first-improvement run and a search to 1,000,000 evaluations, in a worker whose old generation is
 *   capped at 64 MB (`resourceLimits`). Without the collection the peak includes garbage not yet
 *   collected; `firstImprovement` and `search` report that as `heapUncollectedMB`.
 * `--check` runs the timed gated cases bundled, one process per case (bench-support.ts), and fails
 * on a probe-normalised median more than 25% over the stored one or over its budget; then it runs
 * `heap` once and fails at 64 MB or more; it re-runs the pool's searches in process to compare the
 * machine-independent `exact` blocks of `firstImprovement` and `search` (weak and guide) for
 * equality (review PRF-09); and it runs `quality` against the stored references (above;
 * tests/optimizer-evaluations.test.ts gates the fixtures' exact counts in `pnpm test`).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHeapStatistics, setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { staticDatasetSource } from '../../src/app/dataset-source';
import { createNavigationRuntime, type DisposableNavLegService } from '../../src/app/navigation-runtime';
import { ManualTimers, testNavManifest, walkable } from '../../src/app/navigation-test-helpers';
import { stubDataset, stubNpc, stubQuest, worldSpawn } from '../../src/app/map-test-helpers';
import { createOptimizationHost } from '../../src/app/optimizer-host';
import { createRunWalker, type RunWalker, sectionStart, walkSection } from '../../src/app/optimizer-walk';
import type { QuestRecord } from '../../src/domain/dataset';
import { npcId, questId, sequentialIdSource, uiMapId, worldMapId } from '../../src/domain/ids';
import { type Location, worldSourcedPoint } from '../../src/domain/points';
import type { ProjectV1 } from '../../src/domain/project';
import { createEmptyProject } from '../../src/domain/project-factory';
import type { RouteStep } from '../../src/domain/route';
import { makeAcceptStep, makeCompleteStep, makeNoteStep, makeTurnInStep } from '../../src/domain/step-factory';
import { fixtureGeometry } from '../../src/geo/test-fixtures';
import type { NavLegsProgress } from '../../src/nav/worker/client';
import type { NavLegQuery, NavLegResult } from '../../src/nav/worker/protocol';
import { analyseSection, compileProblem, type CompiledProblem, createSearch, DEFAULT_SEARCH_OPTIONS, evaluateSequence, type SearchProblem, type SearchSolution, type SectionAnalysis, type SectionWalk } from '../../src/optimizer/core';
import { type AnytimeHost, Meter } from '../../src/optimizer/core/anytime';
import { createTransitions, solutionOf } from '../../src/optimizer/core/evaluate';
import { Kicks } from '../../src/optimizer/core/kicks';
import { LocalSearch } from '../../src/optimizer/core/local';
import { NearestNeighbourSeed } from '../../src/optimizer/core/seeds';
import type { Closed } from '../../src/optimizer/core/transitions';
import { createOptimizerWorkerClient, isStoppedRun, type OptimizerWorkerClient, type WorkerRunOptions } from '../../src/optimizer/worker/client';
import { createOptimizerWorkerHost } from '../../src/optimizer/worker/host';
import type { FromWorker, OptimizerWorkerPort, ToWorker } from '../../src/optimizer/worker/protocol';
import { REPO_ROOT } from '../support/fake-fetch';
import { bench, benchArgs, benchSetup, type CaseResult, cpuProbe, type GatedCase, round, runChecks, type Stats, stats } from './bench-support';

// =============================================================================================
// The worker side (this file, run as a worker_threads worker)

interface HeapMessage {
  readonly type: 'heap';
  /** The largest used heap plus external memory sampled after a slice since the last report, bytes. */
  readonly peak: number;
  readonly samples: number;
  /** The heap after a collection when the worker had loaded and run nothing yet (the heap case), bytes. */
  readonly idle: number | null;
}

/** A full garbage collection, when the worker was started for the heap case (`--expose-gc` set at run time). */
function exposedGc(): (() => void) | null {
  if ((workerData as { gc?: boolean } | null)?.gc !== true) return null;
  setFlagsFromString('--expose-gc');
  return runInNewContext('gc') as () => void;
}

function workerMain(): void {
  const port = parentPort;
  if (port === null) throw new Error('no parent port');
  const gc = exposedGc();
  const heapNow = (): number => {
    const heap = getHeapStatistics();
    return heap.used_heap_size + heap.external_memory;
  };
  let idle: number | null = null;
  if (gc !== null) {
    gc();
    idle = heapNow();
  }
  let peak = 0;
  let samples = 0;
  const host = createOptimizerWorkerHost({
    post: (message: FromWorker) => {
      port.postMessage(message);
      if (message.type === 'done' || message.type === 'error') {
        const report: HeapMessage = { type: 'heap', peak, samples, idle };
        port.postMessage(report);
        peak = 0;
        samples = 0;
      }
    },
    now: () => performance.now(),
    yieldToEventLoop: () => new Promise<void>((resolve) => setImmediate(resolve)),
    sample: () => {
      // The heap case collects first, so the sample is what the search holds, not garbage not yet collected.
      gc?.();
      peak = Math.max(peak, heapNow());
      samples += 1;
    },
  });
  port.on('message', (message: ToWorker) => {
    host.handle(message);
  });
}

if (!isMainThread && (workerData as { role?: string } | null)?.role === 'optimizer-bench-worker') workerMain();

// =============================================================================================
// The pool

const T0 = '2026-09-27T00:00:00.000Z';
const KALIMDOR = worldMapId(1);
const at = (x: number, y: number): Location => ({ source: worldSourcedPoint(KALIMDOR, x, y), label: null, radius: null });

/** Lehmer PRNG (as fixture 9). */
function lehmer(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 48271) % 2147483647;
    return x;
  };
}

export interface Pool {
  readonly project: ProjectV1;
  readonly data: ReturnType<typeof staticDatasetSource>;
  readonly section: { readonly first: number; readonly last: number };
  readonly quests: number;
  readonly actions: number;
}

/** The generated pool (see the file comment). */
export function generatedPool(count = 100, seed = 7): Pool {
  const next = lehmer(seed);
  const uniform = (lo: number, hi: number): number => lo + (next() % (hi - lo + 1));
  const hubs = Array.from({ length: 12 }, () => ({ x: uniform(0, 4000), y: uniform(0, 4000) }));
  const quests: QuestRecord[] = [];
  const steps: RouteStep[] = [];
  const ids = sequentialIdSource();
  const killNpc = npcId(90_000);
  for (let k = 0; k < count; k += 1) {
    const id = questId(20_000 + k);
    const giver = hubs[next() % hubs.length] ?? { x: 0, y: 0 };
    const finisher = next() % 10 < 7 ? giver : (hubs[next() % hubs.length] ?? giver);
    const work = { x: Math.max(0, Math.min(4000, giver.x + uniform(-600, 600))), y: Math.max(0, Math.min(4000, giver.y + uniform(-600, 600))) };
    quests.push(
      stubQuest({
        id,
        name: `Pool quest ${String(k + 1)}`,
        level: 30,
        minLevel: 1,
        objectives: [{ kind: 'kill', npcId: killNpc, label: null, count: 2 }],
        xp: { questLevel: 30, baseXp: 50 * (8 + (next() % 13)), basis: 'era-seed' },
      }),
    );
    steps.push(
      makeAcceptStep(ids, { questId: id, location: at(giver.x, giver.y) }),
      makeCompleteStep(ids, { targets: [{ questId: id, objective: null }], location: at(work.x, work.y) }),
      makeTurnInStep(ids, { questId: id, location: at(finisher.x, finisher.y) }),
    );
  }
  const start = { x: 2000, y: 2000 };
  steps.push(makeNoteStep(ids, { text: 'Back at the start', location: at(start.x, start.y) }));
  const base = createEmptyProject({
    ids: sequentialIdSource(100),
    nowIso: T0,
    name: 'Optimiser bench',
    character: { faction: 'Horde', race: 'Orc', class: 'WARRIOR', startLevel: 10, startLocation: at(start.x, start.y) },
  });
  const project: ProjectV1 = { ...base, assumptions: { runSpeedYps: 10, travelDetourFactor: 1 }, route: { ...base.route, steps } };
  const dataset = stubDataset({
    quests,
    npcs: [stubNpc({ id: killNpc, name: 'Pool boar', minLevel: 12, maxLevel: 12, rank: 0 })],
    spawns: { [`npc:${String(killNpc)}`]: [worldSpawn(KALIMDOR, 2000, 2000, uiMapId(1411))] },
  });
  return { project, data: staticDatasetSource(dataset), section: { first: 0, last: steps.length - 2 }, quests: count, actions: count * 3 };
}

/** A straight-line point of a located step (the pool's steps are all located). */
function pointOf(step: RouteStep): { readonly x: number; readonly y: number } {
  const source = (step as { readonly location?: { readonly source?: { readonly x?: number; readonly y?: number } } | null }).location?.source;
  return { x: source?.x ?? 0, y: source?.y ?? 0 };
}

/**
 * The nearest-neighbour tour of the weak pool's section (M7 review open item 1): from the start,
 * the nearest step by straight line whose quest's earlier actions are done (accept, complete,
 * turn-in: the id-order section holds each quest's three steps in a row), ties to the earlier step.
 * The steps in tour order.
 */
export function nearestNeighbourTour(pool: Pool): RouteStep[] {
  const section = pool.project.route.steps.slice(pool.section.first, pool.section.last + 1);
  const done = new Set<number>();
  const tour: RouteStep[] = [];
  let here = pointOf(pool.project.route.steps[pool.section.last + 1] as RouteStep);
  while (tour.length < section.length) {
    let pick = -1;
    let best = Number.POSITIVE_INFINITY;
    section.forEach((step, k) => {
      if (done.has(k) || (k % 3 !== 0 && !done.has(k - 1))) return;
      const p = pointOf(step);
      const d = Math.sqrt((p.x - here.x) * (p.x - here.x) + (p.y - here.y) * (p.y - here.y));
      if (d < best) {
        best = d;
        pick = k;
      }
    });
    done.add(pick);
    tour.push(section[pick] as RouteStep);
    here = pointOf(section[pick] as RouteStep);
  }
  return tour;
}

/** The weak pool with its section in nearest-neighbour order: the guide incumbent (plan §14.1). */
export function guidePool(pool: Pool): Pool {
  const steps = pool.project.route.steps;
  const route = { ...pool.project.route, steps: [...steps.slice(0, pool.section.first), ...nearestNeighbourTour(pool), ...steps.slice(pool.section.last + 1)] };
  return { ...pool, project: { ...pool.project, route } };
}

/**
 * The nearest-neighbour tour (`tour`: its steps) priced in a compiled problem by the search's own
 * evaluation; null when the tour breaks one of the search's rules (it ignores the log capacity and
 * the closing rules; review M7Q Q-02: pools 17 and 33).
 */
function nearestNeighbourMs(tour: readonly RouteStep[], compiled: CompiledProblem): number | null {
  const offsetOf = new Map(compiled.decode.steps.map((step, k) => [step.id, k]));
  const unitOf = new Map<number, number>();
  for (let u = 0; u + 1 < compiled.decode.unitStart.length; u += 1) {
    for (let k = compiled.decode.unitStart[u] ?? 0; k < (compiled.decode.unitStart[u + 1] ?? 0); k += 1) unitOf.set(compiled.decode.unitSteps[k] ?? -1, u);
  }
  const units: number[] = [];
  for (const step of tour) {
    const u = unitOf.get(offsetOf.get(step.id) ?? -1);
    if (u !== undefined && !units.includes(u)) units.push(u);
  }
  const priced = evaluateSequence(compiled.problem, Int32Array.from(units));
  return 'infeasible' in priced ? null : priced.estimatedMs;
}

/** 100 × (a − b) / b, rounded; null when either is missing. */
const gapPct = (a: number, b: number | null | undefined): number | null => (b === null || b === undefined ? null : round((100 * (a - b)) / b));

interface Prepared {
  readonly pool: Pool;
  readonly run: RunWalker;
  readonly analysis: SectionAnalysis;
  readonly baseline: SectionWalk;
}

function prepare(pool: Pool): Prepared {
  const host = createOptimizationHost({ project: pool.project, revision: 1, data: pool.data, geometry: fixtureGeometry(), navigation: { kind: 'unavailable', reason: 'bench' }, taxi: null });
  const run = createRunWalker(host);
  const walked = walkSection(run, pool.project, pool.section, { probe: false });
  const analysis = analyse(run, pool, walked.walk);
  const baseline = walkSection(run, pool.project, pool.section, { probe: true, from: analysis.castWindowStart }).walk;
  return { pool, run, analysis, baseline };
}

function analyse(run: RunWalker, pool: Pool, walk: SectionWalk): SectionAnalysis {
  const analysis = analyseSection({ project: pool.project, section: pool.section, goal: { targetXp: 'keep-original', grindFill: 'shortfall' }, context: run.engine, walk, availability: run.availability });
  if (!analysis.ok) throw new Error(`the pool does not analyse: ${analysis.reason}`);
  return analysis;
}

function compile(prepared: Prepared): CompiledProblem {
  const compiled = compileProblem(analyse(prepared.run, prepared.pool, prepared.baseline), prepared.baseline);
  if (!compiled.ok) throw new Error(`the pool does not compile: ${compiled.reason}`);
  return compiled;
}

// =============================================================================================
// The worker from the main thread

const BEAM = 256;
/** §14: first improvement < 2 s; worker heap < 64 MB. */
const FIRST_IMPROVEMENT_LIMIT_MS = 2000;
const HEAP_LIMIT_BYTES = 64 * 1024 * 1024;
const COMPILE_LIMIT_MS = 30;
/** Plan §14.1: the search case runs to 2,000,000 evaluations (review PRF-10). */
const SEARCH_EVALUATIONS = 2_000_000;

interface WorkerHarness {
  readonly client: OptimizerWorkerClient;
  /** The largest worker heap of any run so far, bytes, and the last run's. */
  heapPeak: number;
  lastHeap: number;
  idleHeap: number | null;
  dispose(): void;
}

function workerHarness(options: { readonly gc?: boolean } = {}): WorkerHarness {
  const workers: Worker[] = [];
  const harness: WorkerHarness = {
    client: null as unknown as OptimizerWorkerClient,
    heapPeak: 0,
    lastHeap: 0,
    idleHeap: null,
    dispose() {
      harness.client.dispose();
      for (const w of workers) void w.terminate();
    },
  };
  const createPort = (): OptimizerWorkerPort => {
    // The heap case caps the worker's old generation at the §14 budget: a search that needed more would fail.
    const worker = new Worker(workerScript(), {
      workerData: { role: 'optimizer-bench-worker', gc: options.gc === true },
      ...(options.gc === true ? { resourceLimits: { maxOldGenerationSizeMb: HEAP_LIMIT_BYTES / (1024 * 1024) } } : {}),
    });
    workers.push(worker);
    return {
      postMessage(message, transfer) {
        worker.postMessage(message, [...transfer]);
      },
      listen(onMessage, onError) {
        worker.on('message', (message: FromWorker | HeapMessage) => {
          if (message.type === 'heap') {
            harness.lastHeap = message.peak;
            harness.idleHeap = message.idle;
            harness.heapPeak = Math.max(harness.heapPeak, message.peak);
            return;
          }
          onMessage(message);
        });
        worker.on('error', (error) => {
          onError(error.message);
        });
      },
      terminate() {
        void worker.terminate();
      },
    };
  };
  (harness as { client: OptimizerWorkerClient }).client = createOptimizerWorkerClient({ createPort });
  return harness;
}

/**
 * The worker's script: this file itself when it runs bundled (`--check`); under tsx (whose loader a
 * worker thread does not inherit) a bundle of it, built with esbuild as `--check` builds its own.
 */
let bundled: string | null = null;
function workerScript(): string {
  const script = fileURLToPath(import.meta.url);
  if (!script.endsWith('.ts')) return script;
  if (bundled !== null) return bundled;
  const out = join(REPO_ROOT, '.cache', 'bench', 'optimizer.bench.worker.mjs');
  mkdirSync(dirname(out), { recursive: true });
  const fromTsx = createRequire(createRequire(import.meta.url).resolve('tsx/package.json'));
  const esbuild = fromTsx('esbuild') as { buildSync(options: Record<string, unknown>): unknown };
  esbuild.buildSync({ entryPoints: [script], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: out, logLevel: 'warning' });
  bundled = out;
  return out;
}

const runOptions = (maxEvaluations: number): WorkerRunOptions => ({ ...DEFAULT_SEARCH_OPTIONS, beamWidth: BEAM, maxEvaluations, maxMillis: null });

interface FirstImprovement {
  readonly ms: number;
  readonly bestMs: number;
  readonly incumbentMs: number;
  readonly evaluations: number | null;
}

/** One run until the first improvement reaches the main thread, then cancelled. */
async function firstImprovementRun(harness: WorkerHarness, compiled: CompiledProblem): Promise<FirstImprovement> {
  const incumbentMs = compiled.stats.incumbentMs;
  let improvedAt: number | null = null;
  let bestMs = Number.NaN;
  let cancel = (): void => undefined;
  const started = performance.now();
  const run = harness.client.run(compiled, runOptions(4_000_000), {
    onBest: (solution) => {
      if (improvedAt !== null || solution.comparedMs >= incumbentMs) return;
      improvedAt = performance.now();
      bestMs = solution.estimatedMs;
      cancel();
    },
  });
  cancel = () => {
    run.cancel();
  };
  const result = await run.result;
  if (improvedAt === null) throw new Error('no improvement was found');
  // Wait for the heap report that follows `done`.
  await new Promise<void>((resolve) => setImmediate(resolve));
  return { ms: (improvedAt as number) - started, bestMs, incumbentMs, evaluations: isStoppedRun(result) ? null : result.stats.firstImprovementEvaluations };
}

interface SearchRun {
  readonly ms: number;
  readonly evaluations: number;
  readonly layers: number;
  readonly duplicates: number;
  readonly dominated: number;
  readonly bestMs: number;
  readonly incumbentMs: number;
  readonly termination: string;
  readonly arrayBytes: number;
  readonly firstImprovementEvaluations: number | null;
}

async function searchRun(harness: WorkerHarness, compiled: CompiledProblem): Promise<SearchRun> {
  const started = performance.now();
  const result = await harness.client.run(compiled, runOptions(SEARCH_EVALUATIONS)).result;
  const ms = performance.now() - started;
  if (isStoppedRun(result)) throw new Error('the search was stopped');
  return {
    ms,
    evaluations: result.stats.evaluations,
    layers: result.stats.layers,
    duplicates: result.stats.duplicates,
    dominated: result.stats.dominated,
    bestMs: result.solutions[0]?.estimatedMs ?? Number.NaN,
    incumbentMs: result.incumbent.estimatedMs,
    termination: result.termination,
    arrayBytes: result.stats.arrayBytes,
    firstImprovementEvaluations: result.stats.firstImprovementEvaluations,
  };
}

/** Times an async action `runs` times after `warm` warm-ups. */
async function benchAsync<T>(runs: number, warm: number, action: () => Promise<T>, time: (value: T) => number): Promise<{ readonly stats: Stats; readonly last: T }> {
  let last: T | null = null;
  for (let i = 0; i < warm; i += 1) last = await action();
  const times: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    last = await action();
    times.push(time(last));
  }
  if (last === null) throw new Error('no run');
  return { stats: stats(times), last };
}

// =============================================================================================
// The navigation model's compile (review PRF-07) and the realistic route's walks (review RTD-05)

/** A navigation worker stand-in answering every leg at once, walkable and as long as the straight line. */
class StraightLegService implements DisposableNavLegService {
  legs(queries: readonly NavLegQuery[], options: { readonly onProgress?: (progress: NavLegsProgress) => void } = {}): Promise<readonly NavLegResult[]> {
    const results = queries.map((q, index) => ({ index, result: walkable(Math.round(Math.sqrt((q.to.x - q.from.x) * (q.to.x - q.from.x) + (q.to.y - q.from.y) * (q.to.y - q.from.y)) * 10)) }));
    options.onProgress?.({ done: results.length, total: results.length, results });
    return Promise.resolve([]);
  }
  path(): Promise<readonly number[] | null> {
    return Promise.resolve(null);
  }
  dispose(): void {
    // Nothing to stop.
  }
}

const NO_SIGNAL = new AbortController().signal;

/**
 * `compileNav`: the pool on the navigation model with a complete leg table. Each run is one click:
 * a new run walker, the analysis walk and the baseline re-walk (not timed: `walks`), and, timed,
 * what the click does on the main thread between them and the worker: `analyseSection`, "computing
 * paths" (nothing left to ask for), the pending check and `compileProblem` without a matrix cache.
 */
async function compileNavCase(pool: Pool): Promise<Stats> {
  const runtime = createNavigationRuntime(testNavManifest([1]), new StraightLegService(), new ManualTimers());
  const host = createOptimizationHost({ project: pool.project, revision: 1, data: pool.data, geometry: fixtureGeometry(), navigation: { kind: 'available', runtime }, taxi: null });
  const click = async (): Promise<number> => {
    const run = createRunWalker(host);
    const analysisWalk = walkSection(run, pool.project, pool.section, { probe: false });
    const started = performance.now();
    const analysis = analyse(run, pool, analysisWalk.walk);
    await host.computeLegs(analysis.pairs, { signal: NO_SIGNAL, onProgress: () => undefined });
    let ms = performance.now() - started;
    const baseline = walkSection(run, pool.project, pool.section, { probe: true, from: analysis.castWindowStart });
    const resumed = performance.now();
    if (host.missingLegs(analysis.pairs) > 0) throw new Error('the leg table is not complete');
    const compiled = compileProblem(analysis, baseline.walk);
    ms += performance.now() - resumed;
    if (!compiled.ok) throw new Error(`the pool does not compile on the navigation model: ${compiled.reason}`);
    return ms;
  };
  // The first click fills the leg table ("computing paths" asks for every leg once).
  await click();
  if (host.travelModel !== 'navigation') throw new Error('not the navigation model');
  const times: number[] = [];
  for (let i = 0; i < args.warm; i += 1) await click();
  for (let i = 0; i < args.runs; i += 1) times.push(await click());
  return stats(times);
}

/** The walks of a 150-step section in the middle of the realistic 10,000-step route (plan §14.1). */
async function realisticWalks(): Promise<Record<string, unknown>> {
  const setup = await benchSetup('realistic', 10_000);
  const host = { engine: setup.context, validator: { dataset: setup.view, rules: setup.context.rules, baseDataset: null, graph: setup.context.graph } };
  // Steps 4,900-5,049: the middle of the route, and a section that analyses (most 150-step windows
  // there cross between world maps without a transport step, SIM-4).
  const first = 4_900;
  const section = { first, last: first + 149 };
  const project = setup.project;
  const probe = createRunWalker(host);
  const analysis = analyseSection({ project, section, goal: { targetXp: 'keep-original', grindFill: 'shortfall' }, context: probe.engine, walk: walkSection(probe, project, section, { probe: false }).walk, availability: probe.availability });
  const from = analysis.ok ? analysis.castWindowStart : section.first;
  // As in a run, each a main-thread task of its own: the prefix replay (the state before the
  // section, once per run), a new walker's walk of the whole route, and the baseline re-walk from
  // the cast window.
  const run = createRunWalker(host);
  const start = sectionStart(run, project, first);
  const replay = bench(args.runs, args.warm, () => {
    sectionStart(run, project, first);
  });
  const analysisWalk = bench(args.runs, args.warm, () => {
    walkSection(createRunWalker(host), project, section, { probe: false, start });
  });
  walkSection(run, project, section, { probe: false, start });
  const baselineWalk = bench(args.runs, args.warm, () => {
    walkSection(run, project, section, { probe: true, from, start });
  });
  return { steps: project.route.steps.length, section: [section.first, section.last], castWindowStart: from, analysed: analysis.ok, replay, analysis: analysisWalk, baseline: baselineWalk };
}

/**
 * The pool's first improvement in process (no worker, no clock), one evaluation per slice so the
 * first improvement is exactly the first (a worker's slices can fold several into one `best`).
 */
function exactFirstImprovement(prepared: Prepared): Record<string, unknown> {
  const compiled = compile(prepared);
  const stepper = createSearch(compiled.problem, { ...DEFAULT_SEARCH_OPTIONS, beamWidth: BEAM, maxEvaluations: SEARCH_EVALUATIONS });
  const incumbentMs = compiled.stats.incumbentMs;
  for (;;) {
    const result = stepper.advance(1);
    if (result.done) throw new Error('the pool search ended without an improvement');
    if (result.best !== null && result.best.comparedMs < incumbentMs) {
      const outcome = stepper.finish('cancelled');
      return { evaluationsToFirstImprovement: outcome.stats.firstImprovementEvaluations, incumbentMs, firstBestMs: result.best.estimatedMs };
    }
  }
}

/**
 * The pool's search in process to `SEARCH_EVALUATIONS`: the machine-independent figures of `search`,
 * with the nearest-neighbour tour (`tour`) priced in the same problem.
 */
function exactSearch(prepared: Prepared, tour: readonly RouteStep[]): Record<string, unknown> {
  const compiled = compile(prepared);
  const stepper = createSearch(compiled.problem, { ...DEFAULT_SEARCH_OPTIONS, beamWidth: BEAM, maxEvaluations: SEARCH_EVALUATIONS });
  for (;;) {
    const result = stepper.advance(65_536);
    if (!result.done) continue;
    const { outcome } = result;
    const stats = outcome.stats;
    const best = outcome.solutions[0];
    const bestMs = best?.estimatedMs ?? Number.NaN;
    const nearest = nearestNeighbourMs(tour, compiled);
    return {
      evaluations: stats.evaluations,
      layers: stats.layers,
      duplicates: stats.duplicates,
      dominated: stats.dominated,
      rollouts: stats.rollouts,
      termination: outcome.termination,
      incumbentMs: outcome.incumbent.estimatedMs,
      bestMs,
      bestUnits: best?.units.length ?? 0,
      firstImprovementEvaluations: stats.firstImprovementEvaluations,
      nearestNeighbourMs: nearest,
      gapToNearestNeighbourPct: gapPct(bestMs, nearest),
    };
  }
}

// =============================================================================================
// Quality against an independent reference (review M7Q Q-02)

/** The quality pools: the bench generator's seeds 1-10 and 17 (whose nearest-neighbour tour is infeasible). */
const QUALITY_SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17];
/** `--check` fails when the median gap to the reference is above this, or any pool's above the next. */
const QUALITY_MEDIAN_LIMIT_PCT = 3;
const QUALITY_MAX_LIMIT_PCT = 7;
/** Each reference run's evaluations, and the kick seeds of its two runs (not the search's). */
const REFERENCE_EVALUATIONS = 20_000_000;
const REFERENCE_KICK_SEEDS = [424_242, 515_151] as const;

/** A host for the reference runs: keeps the best order, never pauses. */
class ReferenceHost implements AnytimeHost {
  readonly t;
  readonly meter: Meter;
  best: SearchSolution | null = null;
  constructor(
    readonly problem: SearchProblem,
    max: number,
  ) {
    this.t = createTransitions(problem);
    this.meter = new Meter(max);
    this.meter.left = Number.POSITIVE_INFINITY;
  }
  addSolution(units: ArrayLike<number>, closed: Closed): void {
    if (this.best === null || closed.comparedMs < this.best.comparedMs) this.best = solutionOf(units, closed);
  }
  noteRefusal(): void {
    // Not counted.
  }
}

/**
 * One reference run: the nearest-neighbour seed, the local pass over it, then kicks with no stall
 * stop to `REFERENCE_EVALUATIONS`, from the core's own parts but with another kick stream and, when
 * `prescreen` is false, a pass that prices every move exactly. Ten times the search's budget and no
 * beam, so it is independent of the search's budget, its work items and its kick sequence.
 */
function referenceRun(problem: SearchProblem, kickSeed: number, prescreen: boolean): SearchSolution {
  const host = new ReferenceHost(problem, REFERENCE_EVALUATIONS);
  const resume = (): void => {
    host.meter.left = Number.POSITIVE_INFINITY;
  };
  const seed = new NearestNeighbourSeed(host);
  while (!seed.step()) resume();
  const local = prescreen ? new LocalSearch(host, 24) : new LocalSearch(host, 24, Number.POSITIVE_INFINITY);
  if (seed.result !== null) while (!local.step(seed.result)) resume();
  const kicks = new Kicks(host, local, kickSeed);
  while (!host.meter.spent) {
    const before = host.meter.evaluations;
    while (!kicks.step(host.best ?? undefined)) resume();
    // An order too short to kick spends nothing: stop.
    if (host.meter.evaluations === before) break;
  }
  if (host.best === null) throw new Error('the reference run found no order');
  return host.best;
}

interface QualityPool {
  readonly seed: number;
  readonly bestMs: number;
  readonly bestUnits: number;
  readonly evaluations: number;
  readonly termination: string;
  readonly nearestNeighbourMs: number | null;
  readonly gapToNearestNeighbourPct: number | null;
  readonly referenceMs: number | null;
  readonly gapToReferencePct: number | null;
}

const medianOrNull = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? null) : round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
};

const distribution = (values: readonly (number | null)[]): { readonly median: number | null; readonly min: number | null; readonly max: number | null; readonly pools: number } => {
  const known = values.filter((v): v is number => v !== null);
  return { median: medianOrNull(known), min: known.length === 0 ? null : Math.min(...known), max: known.length === 0 ? null : Math.max(...known), pools: known.length };
};

/**
 * `quality`: each quality pool's weak incumbent searched in process to `SEARCH_EVALUATIONS` at beam
 * 256, against its nearest-neighbour tour and its stored reference (`references`: seed → ms).
 */
function qualityCase(references: Readonly<Record<string, number>>): { readonly pools: readonly QualityPool[]; readonly gapToNearestNeighbourPct: ReturnType<typeof distribution>; readonly gapToReferencePct: ReturnType<typeof distribution> } {
  const pools = QUALITY_SEEDS.map((seed): QualityPool => {
    const pool = generatedPool(100, seed);
    const compiled = compile(prepare(pool));
    const stepper = createSearch(compiled.problem, { ...DEFAULT_SEARCH_OPTIONS, beamWidth: BEAM, maxEvaluations: SEARCH_EVALUATIONS });
    let result = stepper.advance(1_000_000);
    while (!result.done) result = stepper.advance(1_000_000);
    const best = result.outcome.solutions[0];
    if (best === undefined) throw new Error('no solution');
    const nearest = nearestNeighbourMs(nearestNeighbourTour(pool), compiled);
    const referenceMs = references[String(seed)] ?? null;
    return {
      seed,
      bestMs: best.comparedMs,
      bestUnits: best.units.length,
      evaluations: result.outcome.stats.evaluations,
      termination: result.outcome.termination,
      nearestNeighbourMs: nearest,
      gapToNearestNeighbourPct: gapPct(best.comparedMs, nearest),
      referenceMs,
      gapToReferencePct: gapPct(best.comparedMs, referenceMs),
    };
  });
  return { pools, gapToNearestNeighbourPct: distribution(pools.map((p) => p.gapToNearestNeighbourPct)), gapToReferencePct: distribution(pools.map((p) => p.gapToReferencePct)) };
}

/** `--reference`: each quality pool's reference, the better of its two runs (printed, then stored by hand). */
function referenceCase(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const seed of QUALITY_SEEDS) {
    const compiled = compile(prepare(generatedPool(100, seed)));
    const started = performance.now();
    const [a, b] = [referenceRun(compiled.problem, REFERENCE_KICK_SEEDS[0] + seed, true), referenceRun(compiled.problem, REFERENCE_KICK_SEEDS[1] + seed, false)];
    const best = a.comparedMs <= b.comparedMs ? a : b;
    out[String(seed)] = { referenceMs: best.comparedMs, units: best.units.length, withPrescreenMs: a.comparedMs, exactPassMs: b.comparedMs, seconds: round((performance.now() - started) / 1000) };
    console.error(`pool ${String(seed)}: ${JSON.stringify(out[String(seed)])}`);
  }
  return out;
}

// =============================================================================================
// Cases

const args = benchArgs(process.argv.slice(2), 'docs/measurements/optimizer-m7.json');
const GATED: readonly GatedCase[] = [
  { route: 'realistic', name: 'compile', limit: COMPILE_LIMIT_MS },
  { route: 'realistic', name: 'compileNav', limit: COMPILE_LIMIT_MS },
  { route: 'realistic', name: 'firstImprovement', limit: FIRST_IMPROVEMENT_LIMIT_MS },
  { route: 'realistic', name: 'firstImprovementGuide', limit: FIRST_IMPROVEMENT_LIMIT_MS },
  { route: 'realistic', name: 'search', limit: null },
];

/** Where each gated case's baseline is stored: `<entry>.<variant>` of optimizer-m7.json. */
const STORED: Readonly<Record<string, readonly [string, string]>> = {
  compile: ['compile', 'pool'],
  compileNav: ['compileNav', 'pool'],
  firstImprovement: ['firstImprovement', 'weak'],
  firstImprovementGuide: ['firstImprovement', 'guide'],
  search: ['search', 'weak'],
  searchGuide: ['search', 'guide'],
};

async function measure(only: string | null): Promise<Record<string, unknown>> {
  const pool = generatedPool();
  const prepared = prepare(pool);
  const tour = nearestNeighbourTour(pool);
  let guide: Prepared | null = null;
  const guided = (): Prepared => (guide ??= prepare(guidePool(pool)));
  const out: Record<string, unknown> = { pool: { quests: pool.quests, actions: pool.actions, steps: pool.project.route.steps.length } };
  const wants = (name: string): boolean => only === null || only === name;
  const sample = compile(prepared);
  out.problem = { ...sample.stats, targetXp: sample.summary.targetXp, pool: sample.summary.pool.length, obligatory: sample.summary.obligatory.length };

  if (wants('walks')) {
    const analysisWalk = bench(args.runs, args.warm, () => {
      const run = createRunWalker(createOptimizationHost({ project: pool.project, revision: 1, data: pool.data, geometry: fixtureGeometry(), navigation: { kind: 'unavailable', reason: 'bench' }, taxi: null }));
      walkSection(run, pool.project, pool.section, { probe: false });
    });
    const baselineWalk = bench(args.runs, args.warm, () => {
      walkSection(prepared.run, pool.project, pool.section, { probe: true, from: 0 });
    });
    out.walks = { analysis: analysisWalk, baseline: baselineWalk, realistic: await realisticWalks() };
  }
  if (wants('compile')) {
    out.compile = bench(args.runs, args.warm, () => {
      compile(prepared);
    });
    out.analyse = bench(args.runs, args.warm, () => {
      analyse(prepared.run, pool, prepared.baseline);
    });
  }
  if (wants('compileNav')) out.compileNav = await compileNavCase(pool);
  const firsts = [
    ['firstImprovement', (): Prepared => prepared],
    ['firstImprovementGuide', guided],
  ] as const;
  const searches = [
    ['search', (): Prepared => prepared],
    ['searchGuide', guided],
  ] as const;
  if ([...firsts, ...searches].some(([name]) => wants(name))) {
    const harness = workerHarness();
    try {
      for (const [name, which] of firsts) {
        if (!wants(name)) continue;
        const target = which();
        const measured = await benchAsync(args.runs, args.warm, () => firstImprovementRun(harness, compile(target)), (r) => r.ms);
        const exact = exactFirstImprovement(target);
        if (exact.evaluationsToFirstImprovement !== measured.last.evaluations) throw new Error('the worker and the in-process search disagree on the first improvement');
        out[name] = { ...measured.stats, exact };
      }
      for (const [name, which] of searches) {
        if (!wants(name)) continue;
        const target = which();
        const runs = Math.min(args.runs, 7);
        const measured = await benchAsync(runs, Math.min(args.warm, 1), () => searchRun(harness, compile(target)), (r) => r.ms);
        const last = measured.last;
        const exact = exactSearch(target, tour);
        if (exact.evaluations !== last.evaluations || exact.bestMs !== last.bestMs) throw new Error('the worker and the in-process search disagree on the search');
        out[name] = {
          ...measured.stats,
          runs,
          evaluationsPerSecond: Math.round(last.evaluations / (measured.stats.median / 1000)),
          exact,
          arrayBytes: last.arrayBytes,
        };
      }
      // Without a collection before each sample: what the worker's heap reached, garbage included.
      out.heapUncollectedMB = round(harness.heapPeak / (1024 * 1024));
    } finally {
      harness.dispose();
    }
  }
  if (wants('heap')) out.heap = await heapCase(prepared);
  return out;
}

/** The stored quality references (`quality.reference`: seed → { referenceMs }), or none. */
function storedReferences(path: string): Record<string, number> {
  try {
    const stored = JSON.parse(readFileSync(path, 'utf8')) as { quality?: { reference?: Record<string, { referenceMs?: number } | string | string[]> } };
    const out: Record<string, number> = {};
    for (const [seed, entry] of Object.entries(stored.quality?.reference ?? {})) {
      if (typeof entry === 'object' && !Array.isArray(entry) && typeof entry.referenceMs === 'number') out[seed] = entry.referenceMs;
    }
    return out;
  } catch {
    return {};
  }
}

const MB = 1024 * 1024;

/**
 * The worker heap (§14: < 64 MB at beam 256): a first-improvement run and a search to 1,000,000
 * evaluations in a worker whose old generation is capped at 64 MB, collecting garbage before every
 * sample, so the peak is what the search holds. Throws at or over the limit.
 */
async function heapCase(prepared: Prepared): Promise<Record<string, unknown>> {
  const harness = workerHarness({ gc: true });
  try {
    await firstImprovementRun(harness, compile(prepared));
    const firstMB = round(harness.lastHeap / MB);
    const search = await searchRun(harness, compile(prepared));
    const peakMB = round(harness.heapPeak / MB);
    if (harness.heapPeak >= HEAP_LIMIT_BYTES) throw new Error(`the worker heap reached ${String(peakMB)} MB (limit 64 MB)`);
    return {
      peakMB,
      firstImprovementMB: firstMB,
      searchMB: round(harness.lastHeap / MB),
      idleMB: harness.idleHeap === null ? null : round(harness.idleHeap / MB),
      limitMB: HEAP_LIMIT_BYTES / MB,
      arrayBytes: search.arrayBytes,
      evaluations: search.evaluations,
    };
  } finally {
    harness.dispose();
  }
}

async function main(): Promise<void> {
  if (args.check !== null) {
    const stored = JSON.parse(readFileSync(args.check, 'utf8')) as Record<string, Record<string, { normalised?: number; exact?: unknown } | undefined> | undefined>;
    const at = (name: string): { normalised?: number; exact?: unknown } | undefined => {
      const where = STORED[name];
      return where === undefined ? undefined : stored[where[0]]?.[where[1]];
    };
    const { results, failures: timed } = runChecks(import.meta.url, GATED, args, (_route, name) => at(name)?.normalised ?? null);
    const failures = [...timed];
    const pool = generatedPool();
    const prepared = prepare(pool);
    const guided = prepare(guidePool(pool));
    const tour = nearestNeighbourTour(pool);
    // The worker heap is an absolute ceiling, not a time: measured once, and a failure throws.
    const heap = await heapCase(prepared);
    // The machine-independent figures must equal the stored ones exactly (review PRF-09).
    const exact: Record<string, Record<string, unknown>> = {
      firstImprovement: exactFirstImprovement(prepared),
      firstImprovementGuide: exactFirstImprovement(guided),
      search: exactSearch(prepared, tour),
      searchGuide: exactSearch(guided, tour),
    };
    for (const [name, got] of Object.entries(exact)) {
      const want = JSON.stringify(at(name)?.exact ?? null);
      if (want !== JSON.stringify(got)) failures.push(`${name} exact: ${JSON.stringify(got)}, stored ${want}`);
    }
    // Review M7Q Q-02: the quality pools against their stored, independent references (the
    // nearest-neighbour tour is the search's own first seed, so it is reported, not gated).
    const references = storedReferences(args.check);
    const quality = qualityCase(references);
    const storedPools = (stored.quality as { exact?: unknown } | undefined)?.exact ?? null;
    const exactPools = quality.pools.map((p) => ({ seed: p.seed, bestMs: p.bestMs, bestUnits: p.bestUnits, evaluations: p.evaluations, termination: p.termination }));
    if (JSON.stringify(exactPools) !== JSON.stringify(storedPools)) failures.push(`quality exact: ${JSON.stringify(exactPools)}, stored ${JSON.stringify(storedPools)}`);
    const missing = quality.pools.filter((p) => p.referenceMs === null).map((p) => p.seed);
    if (missing.length > 0) failures.push(`quality: no stored reference for pools ${missing.join(', ')} (run --reference)`);
    const gaps = quality.gapToReferencePct;
    if (gaps.median !== null && gaps.median > QUALITY_MEDIAN_LIMIT_PCT) failures.push(`quality: the median gap to the reference is ${String(gaps.median)}% (limit ${String(QUALITY_MEDIAN_LIMIT_PCT)}%)`);
    for (const p of quality.pools) {
      if (p.gapToReferencePct !== null && p.gapToReferencePct > QUALITY_MAX_LIMIT_PCT) failures.push(`quality: pool ${String(p.seed)} is ${String(p.gapToReferencePct)}% above its reference (limit ${String(QUALITY_MAX_LIMIT_PCT)}%)`);
    }
    console.log(JSON.stringify({ node: process.version, repeat: args.repeat, runs: args.runs, results, heap, exact, quality }, null, 2));
    if (failures.length > 0) {
      console.error(`Over the stored baseline by more than 25%, over a budget (probe-normalised), or an exact figure changed:\n  ${failures.join('\n  ')}`);
      process.exitCode = 1;
    } else {
      console.error(
        `Within 25% of the stored baselines and within the budgets (probe-normalised); exact figures equal; quality: median ${String(quality.gapToReferencePct.median)}% and at most ${String(quality.gapToReferencePct.max)}% above the references (limits ${String(QUALITY_MEDIAN_LIMIT_PCT)}% and ${String(QUALITY_MAX_LIMIT_PCT)}%), median ${String(quality.gapToNearestNeighbourPct.median)}% against the nearest-neighbour tours; worker heap ${String(heap.peakMB)} MB of 64 MB.`,
      );
    }
    return;
  }
  if (process.argv.includes('--reference')) {
    console.log(JSON.stringify(referenceCase(), null, 2));
    return;
  }
  if (args.case === 'quality') {
    console.log(JSON.stringify(qualityCase(storedReferences('docs/measurements/optimizer-m7.json')), null, 2));
    return;
  }
  if (args.case !== null) {
    const probeMs = cpuProbe();
    const measured = await measure(args.case);
    const stat = measured[args.case] as Stats | null | undefined;
    if (stat === null || stat === undefined) throw new Error(`unknown case ${args.case}`);
    // A reported case whose entry is not one timing (`walks`) prints the entry itself.
    const reported = typeof stat.median === 'number' ? {} : { entry: stat };
    const result: CaseResult & Record<string, unknown> = { route: 'realistic', case: args.case, probeMs, min: stat.min, median: stat.median, p90: stat.p90, ...reported, heap: measured.heap ?? null };
    console.log(JSON.stringify(result));
    return;
  }
  const probeMs = cpuProbe();
  const measured = await measure(null);
  console.log(JSON.stringify({ runs: args.runs, warm: args.warm, node: process.version, platform: `${process.platform} ${process.arch}`, probeMs, probeAfterMs: round(cpuProbe()), ...measured }, null, 2));
}

if (isMainThread) await main();
