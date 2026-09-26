/**
 * Map route-edit benchmark with walking paths (ARCHITECTURE §14: one route edit applied ≤ 8 ms;
 * PERF-2), the companion of tests/bench/map-edit.bench.ts: the same long route over Durotar, the
 * real map controller and map/layers over the fake adapter, and the app's walking-path feed
 * (src/app/route-paths.ts) wired into the controller with a navigation model whose worker stand-in
 * answers every path at once (three points per leg).
 *
 *   pnpm exec tsx tests/bench/map-paths.bench.ts [--runs 21] [--warm 3] [--steps 10000]
 *   pnpm exec tsx tests/bench/map-paths.bench.ts --budget          (exit 1 when an edit median is over 8 ms)
 *   pnpm exec tsx tests/bench/map-paths.bench.ts --check <file>    (exit 1 on a regression over 25% of the
 *                                                                   file's `paths10000` medians)
 *
 * Cases (min / median / p90 in ms, `performance.now()` around the action), after the paths of the
 * legs in view have arrived:
 * - `moveStep`, `insertNote`, `editNote`: as map-edit.bench.ts;
 * - `newPaths`: a new paths object (what a batch of arrived paths costs the map: every walked
 *   leg on the shown world map asked again, and the route layers rebuilt);
 * - `pan`: a view change (the feed requests the legs coming into view; no rebuild).
 * `requested` counts the path requests the feed made on the whole run: only legs in view.
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createEditorStore, fixedClock, insertNote, moveSelected, updateStepNote } from '../../src/app';
import { projectRules, projectTravelGraph, selectTravelModel } from '../../src/app/derived-context';
import { createMapController } from '../../src/app/map-controller';
import { fakeAdapterFactory } from '../../src/app/map-test-helpers';
import { createNavigationRuntime } from '../../src/app/navigation-runtime';
import type { NavTimers } from '../../src/app/navigation-scheduler';
import { createRoutePathFeed } from '../../src/app/route-paths';
import { sequentialIdSource } from '../../src/app/shell-support';
import { loadWorkspace } from '../../src/app/workspace';
import { type StepId, uiMapId } from '../../src/domain/ids';
import type { ProjectV1 } from '../../src/domain/project';
import type { RouteStep } from '../../src/domain/route';
import { testNavManifest } from '../../src/app/navigation-test-helpers';
import type { NavLegQuery } from '../../src/nav/worker/protocol';
import { fakeServer, nodeSha256, publicSite } from '../support/fake-fetch';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const RUNS = Number(option('--runs', '21'));
const WARM = Number(option('--warm', '3'));
const STEPS = Number(option('--steps', '10000'));
const CHECK = args.includes('--check') ? option('--check', 'docs/measurements/map-m3.json') : null;
const BUDGET = args.includes('--budget');
const NOW = '2026-09-26T00:00:00.000Z';
const DUROTAR = uiMapId(1411);
/** ARCHITECTURE §14: one route edit applied ≤ 8 ms (median, Node: the browser adds the adapter and redraw). */
const EDIT_BUDGET_MS = 8;
/** §14: a stored baseline fails on a regression of more than 25%. */
const REGRESSION = 1.25;

const round = (value: number): number => Math.round(value * 100) / 100;

function stats(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] ?? 0;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return { min: round(sorted[0] ?? 0), median: round(median), p90: round(at(0.9)) };
}

function bench(action: (i: number) => void) {
  for (let i = 0; i < WARM; i += 1) action(-1 - i);
  const times: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const start = performance.now();
    action(i);
    times.push(performance.now() - start);
  }
  return stats(times);
}

/** The route of map-edit.bench.ts: the sample's steps repeated, each repeat's zone points shifted by up to 1.5 percent. */
function longRoute(sample: ProjectV1, count: number): ProjectV1 {
  const ids = sequentialIdSource(1_000_000);
  const steps: RouteStep[] = [];
  for (let k = 0; steps.length < count; k += 1) {
    for (const step of sample.route.steps) {
      if (steps.length >= count) break;
      const location = step.location;
      const shifted =
        location === null || location.source.space !== 'zone'
          ? location
          : {
              ...location,
              source: {
                ...location.source,
                x: Math.min(99, location.source.x + ((k * 37) % 30) / 20),
                y: Math.min(99, location.source.y + ((k * 53) % 30) / 20),
                lexemes: null,
              },
            };
      steps.push({ ...step, id: ids.next('step') as StepId, groupId: null, location: shifted });
    }
    if (sample.route.steps.length === 0) break;
  }
  return { ...sample, route: { ...sample.route, steps, groups: {} } };
}

/** Timers the benchmark runs by hand (`runDue`), so every batch lands between measured actions. */
class Timers implements NavTimers {
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
  /** Runs every queued timer (and those they queue), whatever its delay. */
  async runDue(): Promise<void> {
    for (let round = 0; round < 50 && this.queue.size > 0; round += 1) {
      const due = [...this.queue];
      this.queue.clear();
      for (const [, callback] of due) callback();
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    }
  }
}

const server = fakeServer(publicSite());
const workspace = await loadWorkspace({ fetch: server.fetch, baseUrl: './', sha256: nodeSha256, nowIso: NOW, yieldToRender: () => Promise.resolve() });
const project = longRoute(workspace.project, STEPS);
const geometry = workspace.geometry.geometry;
const store = createEditorStore({ project, ids: sequentialIdSource(5_000_000), clock: fixedClock(NOW) });
const timers = new Timers();
let requested = 0;
const service = {
  legs: () => Promise.resolve([]),
  path: (query: NavLegQuery) => {
    requested += 1;
    const { from, to } = query;
    return Promise.resolve([from.x, from.y, 0, (from.x + to.x) / 2 + 3, (from.y + to.y) / 2, 0, to.x, to.y, 0]);
  },
  dispose: () => undefined,
};
const runtime = createNavigationRuntime(testNavManifest([0, 1]), service, timers);
const rules = projectRules(project.rulesetId, project.assumptions);
const view = workspace.data.view({ faction: project.character.faction, class: project.character.class, customQuests: project.customQuests, questOverrides: project.questOverrides });
const graph = projectTravelGraph(view, workspace.data.flightMasterIds, rules);
const selection = selectTravelModel({ navigation: { kind: 'available', runtime }, detourFactor: rules.values.groundDetourFactor.value, graph, faction: project.character.faction, dataset: view, geometry });
const feed = createRoutePathFeed({ store, geometry, timers, now: () => performance.now(), minIntervalMs: 0 });
const { factory, adapters } = fakeAdapterFactory();
const controller = createMapController({ store, data: workspace.data, geometry, describeStep: (step, index) => `${String(index + 1)} · ${step.kind}`, paths: feed, timing: null, objectUrls: null });
controller.attach(factory, { nodeType: 1, ownerDocument: null });
controller.jumpToZone(DUROTAR);
feed.setModel(selection.navigation, runtime, selection.hints);
await timers.runDue();
const adapter = adapters[0];
if (adapter === undefined) throw new Error('no adapter');
const pathStats = adapter.contents.get('route-line')?.stats.paths ?? null;

const placed = project.route.steps.filter((step) => step.location !== null);
const target = placed[Math.floor(placed.length / 2)];
if (target === undefined) throw new Error('no placed step');
const spread = (i: number) => (Math.abs(i) * 331 + 50) % Math.max(1, project.route.steps.length - 1);
store.select({ kind: 'single', id: target.id });
controller.setActiveStep(target.id);
const moveStep = bench((i) => {
  store.dispatch(moveSelected({ by: i % 2 === 0 ? 1 : -1 }));
});
const insert = bench((i) => {
  store.dispatch(insertNote({ text: 'Bench note' }, spread(i)));
});
const editNote = bench((i) => {
  store.dispatch(updateStepNote(target.id, `Bench ${String(i)}`));
});
const newPaths = bench(() => {
  controller.setRoutePaths({ ...(feed.current() ?? { pending: false, pathOf: () => null }) });
});
const pan = bench((i) => {
  adapter.pan({ x: (adapter.getView()?.center.x ?? 0) + (i % 2 === 0 ? 150 : -150) });
});
controller.detach();

const route = { steps: STEPS, requested, pathStats, moveStep, insertNote: insert, editNote, newPaths, pan };
console.log(
  JSON.stringify(
    {
      runs: RUNS,
      warm: WARM,
      node: process.version,
      [`paths${String(STEPS)}`]: route,
    },
    null,
    2,
  ),
);

type Case = 'moveStep' | 'insertNote' | 'editNote' | 'newPaths';
const CASES: readonly Case[] = ['moveStep', 'insertNote', 'editNote', 'newPaths'];
if (BUDGET) {
  const over = (['moveStep', 'insertNote', 'editNote'] as const).filter((name) => route[name].median > EDIT_BUDGET_MS);
  if (over.length > 0) {
    console.error(`Over the ${String(EDIT_BUDGET_MS)} ms route-edit budget: ${over.map((name) => `${name} ${String(route[name].median)} ms`).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.error(`Every route edit with walking paths is within the ${String(EDIT_BUDGET_MS)} ms budget (median).`);
  }
}
if (CHECK !== null) {
  if (STEPS !== 10_000) throw new Error('--check compares a 10,000-step route (--steps 10000)');
  const stored = JSON.parse(readFileSync(CHECK, 'utf8')) as { paths10000?: Partial<Record<Case, { median: number }>> };
  const baseline = stored.paths10000;
  if (baseline === undefined) {
    console.error(`${CHECK} has no paths10000 baseline`);
    process.exitCode = 1;
  } else {
    const found: string[] = [];
    for (const name of CASES) {
      const was = baseline[name]?.median;
      const now = route[name].median;
      if (was !== undefined && now > was * REGRESSION) found.push(`${name}: ${String(now)} ms median, baseline ${String(was)} ms (+${String(Math.round((now / was - 1) * 100))}%)`);
    }
    if (found.length > 0) {
      console.error(`Slower than the stored baseline by more than 25%:\n  ${found.join('\n  ')}`);
      process.exitCode = 1;
    } else {
      console.error('Within 25% of the stored baseline.');
    }
  }
}
