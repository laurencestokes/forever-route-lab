/**
 * Quest state benchmark (docs/research/map-presentation.md §7.1, §7.4, §17.3; step MP.3): the cost
 * of the derived pipeline's `QuestStateModel` (classification of every quest open to the character,
 * the Available tab's groups and the map's quest inputs, `src/app/quest-state.ts`) and of the
 * objectives layer built from it, on the committed dataset.
 *
 *   pnpm exec tsx tests/bench/map-state.bench.ts [--runs 21] [--warm 3]
 *   pnpm exec tsx tests/bench/map-state.bench.ts --budget   (exit 1 when a gated median is over its budget)
 *
 * Cases (min / median / p90 in ms, `performance.now()` around each action, Node, unthrottled):
 * - **The log fixture** (§7.4's table, the design's `rev2/log-objectives.ts` method): logs of the
 *   first 10 or 20 quests of a zone's levelling band open to the character, sorted by level, each
 *   in the log with every objective open, the character at the log's median quest level, standing
 *   at the median of the zone's objective points:
 *   - `model`: `questStateModel` with warm accept checks (a selection change);
 *   - `modelCold`: the same with new accept checks (the first build after a context change);
 *   - `modelNoLog`: the same state with an empty log, so `model - modelNoLog` is the log's own
 *     share (turn-ins, counted marks, grid groups and hulls; §17.3: at most 5 ms for a 20-quest log,
 *     an ASSUMPTION the `--budget` run gates);
 *   - `layer`: the objectives layer of a new builder at the zone band (zoom -2, a 918 × 720 px view
 *     at the character), with the log's heaviest quest in focus (its points raw) and the log's
 *     counted marks and outlines: the map sync's share when the state changes (ARCHITECTURE §14,
 *     at most 8 ms, gated);
 *   - in view: the focused quest's raw points, the counted marks and the outlines the layer draws,
 *     and the counted marks and outlines over the whole log.
 * - **The realistic route** (tests/bench/bench-support.ts, 10,000 steps, Orc Warrior): the model at
 *   the states before steps 2,000, 5,000, 8,000 and 10,000, with the classes and the drawn givers'
 *   distinct points (compare §7.3's census: 131 to 373 on both continents).
 *
 * The script bundles itself with esbuild and runs the bundle (as tests/bench/bench-support.ts's
 * `--check` does), so the numbers are a production build's, without tsx's keepNames wrapper; a CPU
 * probe (bench-support's) is printed beside them. Prints one JSON object
 * (docs/measurements/map-presentation.json `mp3` records a run).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { objectiveModel } from '../../src/app/map-model';
import { questStateModel, type QuestStateInput, type QuestStateModel } from '../../src/app/quest-state';
import { questsForCharacter } from '../../src/app/shell-support';
import { loadWorkspace } from '../../src/app/workspace';
import { zoneSpans } from '../../src/app/zone-levels';
import type { ClassToken, RaceToken } from '../../src/domain/character';
import type { QuestRecord } from '../../src/domain/dataset';
import { questId, stepId, uiMapId, worldMapId, type QuestId, type UiMapId } from '../../src/domain/ids';
import type { CharacterState } from '../../src/engine/types';
import { createMapLayers } from '../../src/map/layers';
import type { MapView } from '../../src/map/adapter';
import { effectiveRules, FOREVER_BETA } from '../../src/rules';
import { createAcceptChecks } from '../../src/validate/availability';
import { stateWith } from '../../src/validate/test-helpers';
import { createRouteWalker } from '../../src/engine';
import { fakeServer, nodeSha256, publicSite, REPO_ROOT } from '../support/fake-fetch';
import { bench, benchSetup, cpuProbe, round, type Stats } from './bench-support';

const args = process.argv.slice(2);
if (!args.includes('--bundled')) {
  // Two levels below the repository root, as tests/support/fake-fetch.ts finds the data from its bundle.
  const outDir = join(REPO_ROOT, '.cache', 'bench');
  mkdirSync(outDir, { recursive: true });
  const bundle = join(outDir, 'map-state.bench.mjs');
  const esbuild = createRequire(createRequire(import.meta.url).resolve('tsx/package.json'))('esbuild') as { buildSync(options: Record<string, unknown>): unknown };
  esbuild.buildSync({ entryPoints: [fileURLToPath(import.meta.url)], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: bundle, logLevel: 'warning' });
  const child = spawnSync(process.execPath, [bundle, ...args, '--bundled'], { cwd: REPO_ROOT, stdio: 'inherit' });
  process.exit(child.status ?? 1);
}
const option = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const RUNS = Number(option('--runs', '21'));
const WARM = Number(option('--warm', '3'));
const BUDGET = args.includes('--budget');
const NOW = '2026-09-27T00:00:00.000Z';
/** ARCHITECTURE §14: the map's sync for a change at most 8 ms (the objectives layer's share of it). */
const LAYER_BUDGET_MS = 8;
/** map-presentation.md §17.3 (ASSUMPTION): the log's outlines at most 5 ms for a 20-quest log. */
const LOG_BUDGET_MS = 5;
/** The view the design's census took: the map panel at 1600 × 1000 (918 px wide), 720 px tall. */
const VIEW_W = 918;
const VIEW_H = 720;
const ZONE_ZOOM = -2;

interface Fixture {
  readonly name: string;
  readonly race: RaceToken;
  readonly cls: ClassToken;
  readonly faction: 'Horde' | 'Alliance';
  readonly area: number;
  readonly uiMap: number;
  readonly lo: number;
  readonly hi: number;
}

/** §7.4's fixtures (the design's `rev2/log-objectives.ts`). */
const FIXTURES: readonly Fixture[] = [
  { name: 'Durotar 1-12 (Orc Warrior)', race: 'Orc', cls: 'WARRIOR', faction: 'Horde', area: 14, uiMap: 1411, lo: 1, hi: 12 },
  { name: 'The Barrens 10-20 (Orc Warrior)', race: 'Orc', cls: 'WARRIOR', faction: 'Horde', area: 17, uiMap: 1413, lo: 10, hi: 20 },
  { name: 'Elwynn Forest 1-12 (Human Warrior)', race: 'Human', cls: 'WARRIOR', faction: 'Alliance', area: 12, uiMap: 1429, lo: 1, hi: 12 },
  { name: 'Westfall 9-18 (Human Warrior)', race: 'Human', cls: 'WARRIOR', faction: 'Alliance', area: 40, uiMap: 1436, lo: 9, hi: 18 },
  { name: 'Stranglethorn Vale 30-45 (Orc Warrior)', race: 'Orc', cls: 'WARRIOR', faction: 'Horde', area: 33, uiMap: 1434, lo: 30, hi: 45 },
  { name: 'Tanaris 40-50 (Orc Warrior)', race: 'Orc', cls: 'WARRIOR', faction: 'Horde', area: 440, uiMap: 1446, lo: 40, hi: 50 },
];

const server = fakeServer(publicSite());
const workspace = await loadWorkspace({ fetch: server.fetch, baseUrl: './', sha256: nodeSha256, nowIso: NOW, now: () => performance.now(), yieldToRender: () => Promise.resolve() });
const geometry = workspace.geometry.geometry;
const rules = effectiveRules(FOREVER_BETA);

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** A 918 × 720 px view at `zoom` round `center` (world x runs north, y west). */
function viewAt(mapId: number, center: { readonly x: number; readonly y: number }, zoom: number): MapView {
  const px = 2 ** zoom;
  const halfX = VIEW_H / 2 / px;
  const halfY = VIEW_W / 2 / px;
  return {
    mapId: worldMapId(mapId),
    zoom,
    center,
    bounds: { mapId: worldMapId(mapId), xMin: center.x - halfX, xMax: center.x + halfX, yMin: center.y - halfY, yMax: center.y + halfY },
    band: 'zone',
  };
}

const failures: string[] = [];
const logResults: unknown[] = [];

for (const fixture of FIXTURES) {
  const view = workspace.data.view({ faction: fixture.faction, class: fixture.cls, customQuests: [], questOverrides: {} });
  const character = { race: fixture.race, class: fixture.cls, priorHistory: 'fresh', reputation: null } as const;
  const open = questsForCharacter(view, character).open;
  const spans = zoneSpans(view, geometry, character);
  const pool = open
    .filter((q) => q.zoneOrSort === fixture.area && !q.dungeonQuest && !q.flags.repeatable && (q.level ?? 0) >= fixture.lo && (q.level ?? 0) <= fixture.hi && q.objectives.length > 0)
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.id - b.id);
  for (const n of [10, 20]) {
    if (pool.length < n) continue;
    const log: readonly QuestRecord[] = pool.slice(0, n);
    // The zone's objective points of the log, for the character's place and the view.
    const points = objectiveModel(view, geometry, log.map((q) => q.id)).input.groups.flatMap((group) => group.spawns.filter((spawn) => spawn.uiMapId === uiMapId(fixture.uiMap) && spawn.world !== null).map((spawn) => spawn.world));
    const mapId = points[0]?.mapId ?? worldMapId(1);
    const center = { x: median(points.map((p) => p?.x ?? 0)), y: median(points.map((p) => p?.y ?? 0)) };
    const level = median(log.map((q) => q.level ?? 1));
    const withLog = (entries: readonly QuestRecord[]): CharacterState => {
      const state = stateWith({ level });
      for (const q of entries) state.questLog.set(q.id, { objectives: q.objectives.map(() => 'open' as const), failed: false, routeAccepted: true });
      state.location = { mapId, x: center.x, y: center.y };
      return state;
    };
    const checks = createAcceptChecks({ dataset: view, rules });
    const input: QuestStateInput = {
      revision: 0,
      stepId: stepId('bench'),
      stepIndex: 0,
      state: withLog(log),
      records: [],
      dataset: view,
      geometry,
      rules,
      character,
      checks,
      open,
      spans,
    };
    let model: QuestStateModel | null = null;
    const modelStats = bench(RUNS, WARM, () => {
      model = questStateModel(input);
    });
    const modelCold = bench(RUNS, WARM, () => questStateModel({ ...input, checks: createAcceptChecks({ dataset: view, rules }) }));
    const noLog = { ...input, state: withLog([]) };
    const modelNoLog = bench(RUNS, WARM, () => questStateModel(noLog));
    const built = model as QuestStateModel | null;
    if (built === null) throw new Error('no model');
    // The heaviest quest (most placed objective points) in focus, raw; the rest counted.
    const perQuest = new Map<QuestId, number>();
    for (const group of objectiveModel(view, geometry, log.map((q) => q.id)).input.groups) {
      const id = group.questIds[0];
      if (id !== undefined) perQuest.set(id, (perQuest.get(id) ?? 0) + group.spawns.filter((s) => s.world !== null).length);
    }
    const heaviest = [...perQuest.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? questId(0);
    const focusInput = objectiveModel(view, geometry, [heaviest]).input;
    const at = viewAt(mapId, center, ZONE_ZOOM);
    const call = { layer: 'objectives' as const, input: focusInput, focusQuests: [heaviest], rawZone: null as UiMapId | null, log: built.map.log };
    let items = 0;
    let kinds = { raw: 0, counted: 0, areas: 0 };
    const layerStats: Stats = bench(RUNS, WARM, () => {
      const content = createMapLayers({ geometry }).part(call, at).finish();
      items = content.items.length;
      kinds = { raw: 0, counted: 0, areas: 0 };
      for (const item of content.items) {
        const b = at.bounds;
        if (b === null || b === undefined) continue;
        if (item.type === 'area') {
          if (item.ring.some((p) => p.x >= b.xMin && p.x <= b.xMax && p.y >= b.yMin && p.y <= b.yMax)) kinds.areas += 1;
        } else if (item.type === 'marker' && item.point.x >= b.xMin && item.point.x <= b.xMax && item.point.y >= b.yMin && item.point.y <= b.yMax) {
          if (item.id.startsWith('count:')) kinds.counted += 1;
          else kinds.raw += 1;
        }
      }
    });
    const logShare = round(modelStats.median - modelNoLog.median);
    const row = {
      fixture: fixture.name,
      logSize: n,
      level,
      model: modelStats,
      modelCold,
      modelNoLog,
      logShareMs: logShare,
      layer: layerStats,
      layerItems: items,
      inView: kinds,
      wholeLog: { counted: built.map.log.counted.length, areas: built.map.log.areas.length, turnInGroups: built.map.turnIns.groups.length },
      drawnGivers: built.map.givers.groups.length,
    };
    logResults.push(row);
    if (layerStats.median > LAYER_BUDGET_MS) failures.push(`${fixture.name} ${String(n)}: objectives layer ${String(layerStats.median)} ms, over ${String(LAYER_BUDGET_MS)} ms`);
    if (n === 20 && logShare > LOG_BUDGET_MS) failures.push(`${fixture.name} 20: the log's share ${String(logShare)} ms, over ${String(LOG_BUDGET_MS)} ms`);
  }
}

// The realistic route: the model at four states.
const setup = await benchSetup('realistic', 10000);
const walker = createRouteWalker(setup.context);
walker.walk(setup.project);
const character = setup.character;
const routeOpen = questsForCharacter(setup.view, character).open;
const routeSpans = zoneSpans(setup.view, setup.context.geometry, character);
const routeChecks = createAcceptChecks({ dataset: setup.view, rules: setup.context.rules });
const routeResults: unknown[] = [];
for (const index of [2000, 5000, 8000, 10000]) {
  const state = walker.stateBefore(index);
  const input: QuestStateInput = {
    revision: 0,
    stepId: setup.steps[Math.max(0, index - 1)]?.id ?? stepId('bench'),
    stepIndex: index - 1,
    state,
    records: [],
    dataset: setup.view,
    geometry: setup.context.geometry,
    rules: setup.context.rules,
    character,
    checks: routeChecks,
    open: routeOpen,
    spans: routeSpans,
  };
  let model: QuestStateModel | null = null;
  const stats = bench(RUNS, WARM, () => {
    model = questStateModel(input);
  });
  const built = model as QuestStateModel | null;
  if (built === null) throw new Error('no model');
  const points = new Set<string>();
  for (const group of built.map.givers.groups) for (const spawn of group.spawns) if (spawn.world !== null) points.add(`${String(spawn.world.mapId)}:${String(Math.round(spawn.world.x))}:${String(Math.round(spawn.world.y))}`);
  routeResults.push({
    beforeStep: index,
    level: state.level,
    levelLowerBound: state.unknownXpEvents > 0,
    model: stats,
    rows: built.counts.rows,
    outside: built.counts.outside,
    drawnGiverPoints: points.size,
  });
}

const out = { when: NOW, node: process.version, probeMs: cpuProbe(), runs: RUNS, warm: WARM, budgets: { layerMs: LAYER_BUDGET_MS, logShare20Ms: LOG_BUDGET_MS }, logFixture: logResults, realistic: routeResults };
console.log(JSON.stringify(out, null, 1));
if (BUDGET && failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
