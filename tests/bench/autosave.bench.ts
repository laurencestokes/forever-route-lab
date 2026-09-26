/**
 * Autosave benchmark (ARCHITECTURE §14: autosave of a 10,000-step project on the main thread
 * ≤ 50 ms; M4 review CR-06).
 *
 *   pnpm exec tsx tests/bench/autosave.bench.ts [--runs 21] [--steps 10000]
 *       [--baseline docs/measurements/storage-m4.json]   (exit 1 on a median > 25% and > 1 ms over it)
 *       [--write-project <file>]                          (the benchmark project, for a browser run)
 *
 * The project: the committed dataset's sample route repeated, with its points shifted, to
 * `--steps` steps (the M4 critic's construction). What is timed, in Node:
 *
 * - the parts of a save: the drift fingerprints (`dataPrintsOf`), and a structured clone of the
 *   project, which is what an IndexedDB `put()` does synchronously on the main thread;
 * - a whole save through the session, as the page's hide handler runs it: `hideMs` is the
 *   handler's own synchronous time (the main-thread cost the budget is about) and `totalMs` the
 *   time to the stored answer, once over memory storage (the private-window fallback) and once
 *   over fake-indexeddb (whose clone stands in for the browser's);
 * - export and import of the same project (serializeProject, parseProject), for scale.
 *
 * Node's structured clone stands in for the browser's; the throttled browser figure comes with the
 * Playwright gauntlet (§14). Prints one JSON object: median, minimum, p90 and maximum per measure.
 */
import 'fake-indexeddb/auto';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { IDBFactory } from 'fake-indexeddb';
import { manualClock } from '../../src/app/clock';
import { updateStepNote } from '../../src/app/commands';
import { datasetViewInputOf } from '../../src/app/dataset-source';
import { dataPrintsOf } from '../../src/app/drift';
import { randomIdSource } from '../../src/app/ids';
import { createProjectSession, type LifecycleSource, restoreStartupProject } from '../../src/app/persistence';
import { createProjectLibrary } from '../../src/app/project-library';
import { createEditorStore } from '../../src/app/store';
import { loadWorkspace } from '../../src/app/workspace';
import { type ProjectV1, type RouteStep, stepId } from '../../src/domain';
import { createIdbProjectStorage, createMemoryProjectStorage, deepFreeze, openProjectDb, type ProjectStorage } from '../../src/infra/persistence';
import { parseProject, serializeProject } from '../../src/project';
import { fakeServer, nodeSha256, publicSite } from '../support/fake-fetch';

const args = process.argv.slice(2);
const option = (name: string, fallback: string | null): string | null => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const runs = Number(option('--runs', '21'));
const stepTarget = Number(option('--steps', '10000'));
const baselinePath = option('--baseline', null);
const projectOut = option('--write-project', null);
const WARM = 3;

interface Stats {
  readonly median: number;
  readonly min: number;
  readonly p90: number;
  readonly max: number;
}

const round = (value: number): number => Math.round(value * 100) / 100;
function stats(values: readonly number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] ?? 0;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return { median: round(median), min: round(sorted[0] ?? 0), p90: round(at(0.9)), max: round(sorted.at(-1) ?? 0) };
}

function timeSync(body: (run: number) => void): Stats {
  for (let i = 0; i < WARM; i += 1) body(-1 - i);
  const values: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    body(i);
    values.push(performance.now() - start);
  }
  return stats(values);
}

// The project -------------------------------------------------------------------------------------

const workspace = await loadWorkspace({
  fetch: fakeServer(publicSite()).fetch,
  baseUrl: './',
  sha256: nodeSha256,
  nowIso: '2026-09-25T12:00:00.000Z',
  yieldToRender: () => Promise.resolve(),
});
const sample = workspace.project;
let serial = 0;
/** A copy of `step` with a fresh id, its point moved a little (round `k`), and no group. */
function shifted(step: RouteStep, k: number): RouteStep {
  serial += 1;
  const location = step.location;
  const id = stepId(`step-bench-${String(serial)}`);
  if (location === null || location.source.space !== 'zone') return { ...step, id, groupId: null };
  const dx = ((k * 37) % 30) / 20;
  const dy = ((k * 53) % 30) / 20;
  return { ...step, id, groupId: null, location: { ...location, source: { ...location.source, x: Math.min(99, location.source.x + dx), y: Math.min(99, location.source.y + dy) } } };
}
const steps: RouteStep[] = [];
for (let k = 0; steps.length < stepTarget; k += 1) {
  for (const step of sample.route.steps) {
    if (steps.length >= stepTarget) break;
    steps.push(shifted(step, k));
  }
}
const big: ProjectV1 = { ...sample, route: { ...sample.route, steps, groups: {} } };
const text = serializeProject(big);
if (projectOut !== null) writeFileSync(projectOut, text);
const view = () => workspace.data.view(datasetViewInputOf(big));

// Parts of a save -------------------------------------------------------------------------------------

const dataPrintsMs = timeSync(() => {
  dataPrintsOf(big, view());
});
const structuredCloneMs = timeSync(() => {
  structuredClone(big);
});
const serializeProjectMs = timeSync(() => {
  serializeProject(big);
});
const parseProjectMs = timeSync(() => {
  parseProject(JSON.parse(text));
});
// The memory fallback freezes each project it keeps: in full the first time, then only what changed.
const freezeFirstMs = (() => {
  const fresh = JSON.parse(text) as ProjectV1;
  const start = performance.now();
  deepFreeze(fresh);
  return round(performance.now() - start);
})();

// A whole save, as the hide handler runs it ---------------------------------------------------------

async function sessionSave(kind: 'memory' | 'indexeddb'): Promise<{ readonly hideMs: Stats; readonly totalMs: Stats; readonly status: string }> {
  const storage: ProjectStorage = kind === 'memory' ? createMemoryProjectStorage() : createIdbProjectStorage(await openProjectDb({ factory: new IDBFactory() }));
  const clock = manualClock('2026-09-25T12:00:00.000Z');
  const ids = randomIdSource();
  const library = createProjectLibrary({ storage, clock, ids });
  const written = await library.write({ name: 'Benchmark', sample: false, writeSeq: null }, big, null);
  if (!written.ok) throw new Error('the benchmark project could not be stored');
  await library.setLastProjectId(big.id);
  const startup = await restoreStartupProject({ library, data: workspace.data, clock, ids, createSample: () => sample, sampleName: 'Sample' });
  const store = createEditorStore({ project: startup.project, ids, clock });
  let hide: () => void = () => undefined;
  const lifecycle: LifecycleSource = {
    onHide(flush) {
      hide = flush;
      return () => undefined;
    },
  };
  // Timers that never fire: only the hide handler saves.
  const host = { setTimer: () => () => undefined, requestIdle: () => () => undefined, now: () => 0 };
  const session = createProjectSession({ store, library, data: workspace.data, startup, clock, ids, unavailable: null, createSample: () => sample, sampleName: 'Sample', host, lifecycle });
  const target = store.getState().project.route.steps[5]?.id;
  if (target === undefined) throw new Error('no step to edit');
  const hideMs: number[] = [];
  const totalMs: number[] = [];
  for (let i = 0; i < runs + WARM; i += 1) {
    store.dispatch(updateStepNote(target, `note ${String(i)}`));
    const start = performance.now();
    hide();
    const handled = performance.now();
    await session.flush();
    const done = performance.now();
    if (i >= WARM) {
      hideMs.push(handled - start);
      totalMs.push(done - start);
    }
  }
  const status = session.getState().save.kind;
  session.dispose();
  storage.close();
  return { hideMs: stats(hideMs), totalMs: stats(totalMs), status };
}

const memory = await sessionSave('memory');
const indexeddb = await sessionSave('indexeddb');

const result = {
  runs,
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  steps: big.route.steps.length,
  projectJsonBytes: text.length,
  medians: {
    dataPrintsMs: dataPrintsMs.median,
    structuredCloneMs: structuredCloneMs.median,
    memoryHideMs: memory.hideMs.median,
    indexeddbHideMs: indexeddb.hideMs.median,
  },
  dataPrintsMs,
  structuredCloneMs,
  freezeFirstMs,
  memorySave: memory,
  indexeddbSave: indexeddb,
  serializeProjectMs,
  parseProjectMs,
};
console.log(JSON.stringify(result, null, 2));

// The regression gate (§14): a median more than 25% over the stored baseline fails. Sub-millisecond
// medians jitter by more than that on a shared machine, so a regression must also exceed 1 ms.
if (baselinePath !== null) {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as { readonly node?: { readonly medians?: Readonly<Record<string, number>> } };
  const stored = baseline.node?.medians ?? {};
  const regressions = Object.entries(result.medians)
    .map(([name, value]) => ({ name, value, limit: Math.max((stored[name] ?? Number.POSITIVE_INFINITY) * 1.25, (stored[name] ?? 0) + 1) }))
    .filter(({ value, limit }) => value > limit);
  for (const { name, value, limit } of regressions) console.error(`regression: ${name} ${String(value)} ms > ${String(round(limit))} ms (baseline + 25%)`);
  if (regressions.length > 0) process.exitCode = 1;
}
