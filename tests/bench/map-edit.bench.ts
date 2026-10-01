/**
 * Map route-edit benchmark (ARCHITECTURE §14: one route edit applied ≤ 8 ms; M3 review PERF-2,
 * M4 review CR-07). The committed script behind docs/measurements/map-m3.json `milestone4Perf2`.
 *
 *   pnpm exec tsx tests/bench/map-edit.bench.ts [--runs 21] [--warm 3] [--steps 10000]
 *   pnpm exec tsx tests/bench/map-edit.bench.ts --check docs/measurements/map-m3.json
 *
 * Loads the committed dataset through `loadWorkspace` and the test fake fetch (no network or
 * disk), builds a long route from the sample's steps (each repeat's zone percentages shifted by up
 * to 1.5, so markers do not all stack; all of it in Durotar and the Valley of Trials, the densest
 * case for the step-marker cap), and times, with `performance.now()` around each action:
 *
 * - a selection change as the shell makes it: `store.select` of a placed step, then the map
 *   controller's `setActiveStep` with it (one sync);
 * - a move: `moveSelected` by one of a placed, selected and active step (alternately down and up);
 * - inserting a note at spread positions, and editing a step's note.
 *
 * Each runs on a store with the real map controller and map/layers and the fake adapter of
 * src/app/map-test-helpers.ts (records calls, no Leaflet, no canvas), at zone zoom (-2) over
 * Durotar with the cap biting, and on a store without a map (`storeOnly`), so the map's share is
 * the difference. It isolates the app and map/layers cost in Node: the browser adds the adapter's
 * `setLayer` and the canvas redraw on top (docs/measurements/map-m3.json `browser`), so these
 * figures alone do not show the budget is met.
 *
 * **The continent band** (D-050 items 5 and 6): selection changes with the view zoomed out to the
 * continent band over Durotar (−4.2), where the quest givers and turn-ins are clusters (their index
 * made once, as the derived pipeline makes it in its publish, `app/map-clusters.ts`), and a focused
 * quest's giver leaves its cell: `selectionChangeContinent`, reported, not checked.
 *
 * **The two-builder atlas case** (docs/research/map-atlas.md §8.2, §9.2; step ATL.4): the same
 * route and actions on the atlas surface (the controller's `atlas` option), with the view on
 * Durotar's east coast at zone zoom, where Kalimdor's and the Eastern Kingdoms' builders are both
 * active and their parts are joined, the cap shared between them.
 *
 * Prints one JSON object: min / median / p90 per case, for the route, for the sample route and for
 * the route on the atlas. With `--check <file>`, compares the route's medians, and the atlas case's,
 * with the file's `milestone4Perf2` baseline and exits with 1 when one is more than 25% slower
 * (the §14 regression rule), or when an atlas median is over 8 ms (ARCHITECTURE §14, the ATL.4 gate).
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createEditorStore, type EditorStore, fixedClock, insertNote, moveSelected, updateStepNote } from '../../src/app';
import { createMapClusterer } from '../../src/app/map-clusters';
import { createMapController } from '../../src/app/map-controller';
import { fakeAdapterFactory } from '../../src/app/map-test-helpers';
import { sequentialIdSource } from '../../src/app/shell-support';
import { loadWorkspace, type Workspace } from '../../src/app/workspace';
import type { ProjectV1 } from '../../src/domain/project';
import type { RouteStep } from '../../src/domain/route';
import { uiMapId, worldMapId, type StepId } from '../../src/domain/ids';
import { fakeServer, nodeSha256, publicSite } from '../support/fake-fetch';
import { MAP_WORDING } from '../../src/app/map-wording';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const RUNS = Number(option('--runs', '21'));
const WARM = Number(option('--warm', '3'));
const STEPS = Number(option('--steps', '10000'));
const CHECK = args.includes('--check') ? option('--check', 'docs/measurements/map-m3.json') : null;
const NOW = '2026-09-26T00:00:00.000Z';
const DUROTAR = uiMapId(1411);
/** §14: a stored baseline fails on a regression of more than 25%. */
const REGRESSION = 1.25;
/** ARCHITECTURE §14: one route edit applied ≤ 8 ms (the ATL.4 gate for the two-builder atlas case). */
const EDIT_BUDGET_MS = 8;
/**
 * The atlas view of the two-builder case: Durotar's east coast (atlas E 13,000, S 12,700; in
 * Kalimdor's yards x = 12,778 − 12,700, y = 5,652 − 13,000) at zoom −2. The fake stage's 800 × 600
 * px, padded by half, reaches the Eastern Kingdoms' rectangle (from E 14,499) and not the card.
 */
const ATLAS_VIEW = { mapId: worldMapId(1), x: 12778 - 12700, y: 5652 - 13000, zoom: -2 } as const;

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

/** Times `action(i)` RUNS times after WARM warm-ups (their indices are negative). */
function bench(action: (i: number) => void): Stats {
  for (let i = 0; i < WARM; i += 1) action(-1 - i);
  const times: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const start = performance.now();
    action(i);
    times.push(performance.now() - start);
  }
  return stats(times);
}

/**
 * The sample's steps repeated up to `count`, each repeat with fresh ids, no groups, and its zone
 * points shifted by up to 1.5 percent (k·37 mod 30 and k·53 mod 30, over 20).
 */
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

const newStore = (project: ProjectV1): EditorStore => createEditorStore({ project, ids: sequentialIdSource(5_000_000), clock: fixedClock(NOW) });

function run(workspace: Workspace, project: ProjectV1, atlas = false) {
  const placed = project.route.steps.filter((step) => step.location !== null);
  const target = placed[Math.floor(placed.length / 2)];
  if (target === undefined) throw new Error('the route has no placed step');
  const spread = (i: number) => (Math.abs(i) * 331 + 50) % Math.max(1, project.route.steps.length - 1);

  // The store without a map: the store's own share.
  const bare = newStore(project);
  bare.select({ kind: 'single', id: target.id });
  const storeOnly = {
    selectionChange: bench((i) => {
      const step = placed[(Math.abs(i) * 97 + 10) % placed.length];
      if (step !== undefined) bare.select({ kind: 'single', id: step.id });
    }),
    moveStep: (() => {
      bare.select({ kind: 'single', id: target.id });
      return bench((i) => {
        bare.dispatch(moveSelected({ by: i % 2 === 0 ? 1 : -1 }));
      });
    })(),
    insertNote: bench((i) => {
      bare.dispatch(insertNote({ text: 'Bench note' }, spread(i)));
    }),
    editNote: bench((i) => {
      bare.dispatch(updateStepNote(target.id, `Bench ${String(i)}`));
    }),
  };

  // The store with the real map controller over the fake adapter, at zone zoom over Durotar.
  const store = newStore(project);
  const { factory, adapters } = fakeAdapterFactory();
  const controller = createMapController({
    wording: MAP_WORDING,
    store,
    data: workspace.data,
    geometry: workspace.geometry.geometry,
    describeStep: (step, index) => `${String(index + 1)} · ${step.kind}`,
    timing: null,
    objectUrls: null,
    atlas,
    // The app's clusters come with the pipeline's places model; here the same clusterer, without one.
    clusters: createMapClusterer().of,
  });
  const attachStart = performance.now();
  controller.attach(factory, { nodeType: 1, ownerDocument: null });
  const attachMs = round(performance.now() - attachStart);
  controller.jumpToZone(DUROTAR);
  const adapter = adapters[0];
  if (adapter === undefined) throw new Error('no adapter');
  let builders = 1;
  if (atlas) {
    adapter.pan(ATLAS_VIEW);
    builders = adapter.getView()?.visible?.length ?? 0;
    if (builders !== 2) throw new Error(`the atlas case needs two active builders, the view has ${String(builders)}`);
  }
  const routeSteps = adapter.contents.get('route-steps')?.stats;

  const selectionChange = bench((i) => {
    const step = placed[(Math.abs(i) * 97 + 1000) % placed.length];
    if (step === undefined) return;
    store.select({ kind: 'single', id: step.id });
    controller.setActiveStep(step.id);
  });
  // Zoomed out to the continent band (clusters), then back to the zone view for the edits.
  const zoneView = adapter.getView();
  adapter.pan({ zoom: -4.2 });
  const continentBand = store.getState().view.map.zoomBand;
  const selectionChangeContinent = bench((i) => {
    const step = placed[(Math.abs(i) * 97 + 2000) % placed.length];
    if (step === undefined) return;
    store.select({ kind: 'single', id: step.id });
    controller.setActiveStep(step.id);
  });
  if (zoneView !== null) adapter.pan({ x: zoneView.center.x, y: zoneView.center.y, zoom: zoneView.zoom, mapId: zoneView.mapId });
  store.select({ kind: 'single', id: target.id });
  controller.setActiveStep(target.id);
  const setsBefore = adapter.callsOf('setLayer').length;
  const moveStep = bench((i) => {
    store.dispatch(moveSelected({ by: i % 2 === 0 ? 1 : -1 }));
  });
  const moveLayers = [...new Set(adapter.callsOf('setLayer').slice(setsBefore).map((call) => call.layer))].sort();
  const insert = bench((i) => {
    store.dispatch(insertNote({ text: 'Bench note' }, spread(i)));
  });
  const editNote = bench((i) => {
    store.dispatch(updateStepNote(target.id, `Bench ${String(i)}`));
  });
  controller.detach();

  return {
    steps: project.route.steps.length,
    builders,
    routeStepsDrawn: routeSteps === undefined ? null : { drawn: routeSteps.drawn, notDrawn: routeSteps.notDrawn },
    attachMs,
    selectionChange: { totalMs: selectionChange, storeOnlyMs: { median: storeOnly.selectionChange.median } },
    selectionChangeContinent: { band: continentBand, totalMs: selectionChangeContinent },
    moveStep: {
      totalMs: moveStep,
      storeOnlyMs: { median: storeOnly.moveStep.median },
      mapShareMedianMs: round(moveStep.median - storeOnly.moveStep.median),
      layersSet: moveLayers,
    },
    insertNote: { totalMs: insert, storeOnlyMs: { median: storeOnly.insertNote.median } },
    editNote: { totalMs: editNote, storeOnlyMs: { median: storeOnly.editNote.median } },
  };
}

type RouteResult = ReturnType<typeof run>;

/** The route cases whose medians `--check` compares with the stored baseline. */
const CHECKED = ['selectionChange', 'moveStep', 'insertNote', 'editNote'] as const;

function regressions(result: RouteResult, file: string, label = ''): string[] {
  const stored = JSON.parse(readFileSync(file, 'utf8')) as { milestone4Perf2?: { route10000?: Record<string, { totalMs?: { median?: number } }> } };
  const baseline = stored.milestone4Perf2?.route10000;
  if (baseline === undefined) return [`${file} has no milestone4Perf2.route10000 baseline`];
  const found: string[] = [];
  for (const name of CHECKED) {
    const was = baseline[name]?.totalMs?.median;
    const now = result[name].totalMs.median;
    if (was !== undefined && now > was * REGRESSION) found.push(`${label}${name}: ${String(now)} ms median, baseline ${String(was)} ms (+${String(Math.round((now / was - 1) * 100))}%)`);
  }
  return found;
}

/** The two-builder atlas case's medians over the ARCHITECTURE §14 edit budget. */
function overBudget(result: RouteResult): string[] {
  return CHECKED.filter((name) => result[name].totalMs.median > EDIT_BUDGET_MS).map((name) => `atlas ${name}: ${String(result[name].totalMs.median)} ms median, over ${String(EDIT_BUDGET_MS)} ms`);
}

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
const long = longRoute(sample, STEPS);
const route = run(workspace, long);
const sampleRoute = run(workspace, sample);
const atlasRoute = run(workspace, long, true);
const report = {
  runs: RUNS,
  warm: WARM,
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  [`route${String(STEPS)}`]: route,
  [`sampleRoute${String(sample.route.steps.length)}`]: sampleRoute,
  [`atlasTwoBuilders${String(STEPS)}`]: atlasRoute,
};
console.log(JSON.stringify(report, null, 2));
if (CHECK !== null) {
  if (STEPS !== 10_000) throw new Error('--check compares a 10,000-step route (--steps 10000)');
  const found = [...regressions(route, CHECK), ...regressions(atlasRoute, CHECK, 'atlas '), ...overBudget(atlasRoute)];
  if (found.length > 0) {
    console.error(`Slower than the stored baseline by more than 25%, or over the edit budget:\n  ${found.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.error('Within 25% of the stored baseline; the two-builder atlas case within it and within 8 ms.');
  }
}
