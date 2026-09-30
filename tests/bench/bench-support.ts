/**
 * Shared by tests/bench/engine.bench.ts and tests/bench/validate.bench.ts (docs/ARCHITECTURE.md
 * §14; docs/measurements/engine-m6.json): the two 10,000-step routes, the committed dataset's
 * engine context, a CPU probe, the timing helpers, and the `--check` runner.
 *
 * Routes (Milestone 6 review PERF-01):
 * - `stress`: every quest whose only starter and finisher are NPCs with a resolved spawn and whose
 *   objectives are all kills or items, as accept, complete-all and turn-in, with a hearth every 25th
 *   cycle and a grind every 40th, repeated to 10,000 steps. Prerequisites are ignored and the list
 *   repeats, so the validator reports about one issue per step: a regression guard for scaling,
 *   not the budget case.
 * - `realistic`: the quests the character can take (race and class masks, not repeatable, no event,
 *   no dungeon, no skill, reputation, spell or specialisation requirement, not a breadcrumb, every
 *   place resolving on one world map), ordered by level, written as a guide writes them (accept; for
 *   each objective a travel to its place and a complete there; a travel to the finisher; the
 *   turn-in; a note every 10 quests), then repaired with the validator: a quest whose accept is an
 *   error or LINT-3 is moved after the first accept at its required level (VAL-4) or dropped, for up
 *   to 8 rounds. Travel waypoints spread evenly between consecutive located steps pad it to 10,000
 *   steps (a guide's `.goto` lines). Self-built from the committed dataset; no guide text is used.
 *
 * `--check` (PERF-04): the script bundles itself with esbuild (as a production build is: no tsx
 * keepNames wrapper), then runs every gated case in a fresh process, `--repeat` times in rotating
 * order, each process timing a CPU probe (a 2e7 square-root loop, as docs/measurements/map-m3.json)
 * beside its case. A case's result is the median of the processes' medians, normalised to the
 * reference probe (`× PROBE_REFERENCE_MS / probe`), so a loaded machine slows the probe with the
 * case. It fails on a normalised median more than 25% over the stored one, or over its budget or
 * ceiling.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { loadWorkspace } from '../../src/app/workspace';
import type { DatasetView, EntityRef, ObjectiveDef, QuestRecord, SpawnPoint } from '../../src/domain/dataset';
import { type NpcId, type QuestId, sequentialIdSource } from '../../src/domain/ids';
import { classAllowed, raceAllowed } from '../../src/domain/masks';
import { type Location, type WorldPoint, worldSourcedPoint } from '../../src/domain/points';
import type { CharacterProfile } from '../../src/domain/project';
import { defaultCharacter } from '../../src/domain/project-factory';
import type { RouteStep } from '../../src/domain/route';
import { makeAcceptStep, makeCompleteStep, makeFlightStep, makeGrindStep, makeHearthStep, makeNoteStep, makeTravelStep, makeTurnInStep } from '../../src/domain/step-factory';
import type { EngineContext, WalkProject } from '../../src/engine';
import { resolve as resolvePoint } from '../../src/geo/resolve';
import type { MapGeometry } from '../../src/geo/types';
import { effectiveRules, FOREVER_BETA } from '../../src/rules';
import { createStraightLineTravelModel } from '../../src/rules/straight-line';
import { createClientTables, type ClientTaxi } from '../../src/infra/maps/client-tables';
import { seedTravelGraph, taxiNodeOpenTo } from '../../src/rules/travel-graph';
import { taxiLegDataOf } from '../../src/sim/taxi';
import { validateRoute } from '../../src/validate';
import { fakeServer, nodeSha256, publicSite, readDirectory, REPO_ROOT } from '../support/fake-fetch';

export type BenchRoute = 'stress' | 'realistic';
export const BENCH_ROUTES: readonly BenchRoute[] = ['stress', 'realistic'];

const NOW = '2026-09-26T00:00:00.000Z';
/** The CPU probe on this machine when calm (docs/measurements/map-m3.json: 38-40 ms). */
export const PROBE_REFERENCE_MS = 40;
/** §14: a stored baseline fails on a regression of more than 25%. */
export const REGRESSION = 1.25;

// =============================================================================================
// Arguments, timing, probe

export interface BenchArgs {
  readonly runs: number;
  readonly warm: number;
  readonly steps: number;
  readonly routes: readonly BenchRoute[];
  /** Run one case only (a `--check` child). */
  readonly case: string | null;
  readonly check: string | null;
  readonly repeat: number;
  /** Print one JSON line (a `--check` child). */
  readonly json: boolean;
}

export function benchArgs(argv: readonly string[], defaultCheck: string): BenchArgs {
  const option = (name: string, fallback: string): string => {
    const i = argv.indexOf(name);
    return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
  };
  const route = option('--route', 'both');
  // `--check` compares with baselines taken at 15 runs per process (docs/measurements/engine-m6.json).
  return {
    runs: Number(option('--runs', argv.includes('--check') ? '15' : '21')),
    warm: Number(option('--warm', '3')),
    steps: Number(option('--steps', '10000')),
    routes: route === 'both' ? BENCH_ROUTES : route === 'realistic' ? ['realistic'] : ['stress'],
    case: argv.includes('--case') ? option('--case', '') : null,
    check: argv.includes('--check') ? option('--check', defaultCheck) : null,
    repeat: Number(option('--repeat', '3')),
    json: argv.includes('--json'),
  };
}

export interface Stats {
  readonly min: number;
  readonly median: number;
  readonly p90: number;
}

export const round = (value: number): number => Math.round(value * 100) / 100;

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function stats(values: readonly number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] ?? 0;
  return { min: round(sorted[0] ?? 0), median: round(median(sorted)), p90: round(at(0.9)) };
}

/** Times `action(i)` `runs` times after `warm` warm-ups (their indices are negative). */
export function bench(runs: number, warm: number, action: (i: number) => void): Stats {
  for (let i = 0; i < warm; i += 1) action(-1 - i);
  const times: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    action(i);
    times.push(performance.now() - start);
  }
  return stats(times);
}

/** The CPU probe: a 2e7 square-root loop, median of 5 (as docs/measurements/map-m3.json). */
export function cpuProbe(): number {
  const times: number[] = [];
  let sink = 0;
  for (let r = 0; r < 5; r += 1) {
    const start = performance.now();
    for (let i = 0; i < 2e7; i += 1) sink += Math.sqrt(i);
    times.push(performance.now() - start);
  }
  if (sink < 0) throw new Error('unreachable');
  return round(median(times));
}

// =============================================================================================
// The context and the routes

export interface BenchSetup {
  readonly route: BenchRoute;
  readonly view: DatasetView;
  readonly character: CharacterProfile;
  readonly context: EngineContext;
  readonly project: WalkProject;
  readonly steps: readonly RouteStep[];
  /** What the route is made of. */
  readonly composition: Readonly<Record<string, number>>;
}

export async function benchSetup(route: BenchRoute, count: number): Promise<BenchSetup> {
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
  const rules = effectiveRules(FOREVER_BETA);
  const graph = seedTravelGraph(
    { npc: (id) => view.npc(id), spawns: (ref) => view.spawns(ref), zone: (id) => view.zone(id), flightMasterIds: workspace.data.flightMasterIds, dungeons: [] },
    rules,
  );
  const geometry = workspace.geometry.geometry;
  const context: EngineContext = { dataset: view, geometry, rules, travel: createStraightLineTravelModel(rules.values.groundDetourFactor.value), graph };
  const base: WalkProject = { route: { ...sample.route, steps: [], groups: {} }, character, routeProfile: sample.routeProfile, customQuests: [] };
  const built = route === 'stress' ? { steps: buildStressRoute(view, count), composition: {} } : buildRealisticRoute(view, character, context, base, geometry, count);
  const project: WalkProject = { ...base, route: { ...base.route, steps: built.steps } };
  const byKind: Record<string, number> = {};
  for (const step of built.steps) byKind[step.kind] = (byKind[step.kind] ?? 0) + 1;
  return { route, view, character, context, project, steps: built.steps, composition: { ...byKind, ...built.composition } };
}

/** The committed client taxi file (`public/maps/client/taxi.json`), loaded and checked as the app does. */
export async function committedTaxi(): Promise<ClientTaxi> {
  const server = fakeServer(readDirectory('public/maps/client', 'maps/client/'));
  const load = await createClientTables({ fetch: server.fetch, baseUrl: './', sha256: nodeSha256 }).taxi();
  if (load.kind !== 'loaded') throw new Error(`the committed taxi file: ${load.detail}`);
  return load.table;
}

/** A route with flights and transports, and the context that prices them by TIME-6 and TIME-7. */
export interface TravelVariant {
  readonly context: EngineContext;
  readonly project: WalkProject;
  readonly flights: number;
  readonly transports: number;
}

/**
 * TIME-6 and TIME-7 on a bench route (review TR-11): the TravelGraph seeded with the committed taxi
 * file (its nodes, flights and inferred docks), `localTaxi` from it, and the route with a flight
 * every 21st step between flight masters of the character's side on the route's world map (all of
 * them known), and every 500th step a round trip on the Rut'theran - Auberdine boat by record, whose
 * docks are the file's inferred berths. Deterministic: the flights pair the nodes in graph order.
 */
export function travelVariant(setup: BenchSetup, taxi: ClientTaxi): TravelVariant {
  const { view, character, context, project } = setup;
  const graph = seedTravelGraph(
    { npc: (id) => view.npc(id), spawns: (ref) => view.spawns(ref), zone: (id) => view.zone(id), flightMasterIds: context.graph.taxiNodes.flatMap((node) => (node.npcId === null ? [] : [node.npcId])), dungeons: [] },
    context.rules,
    { taxi },
  );
  const start = resolvePoint(project.character.startLocation?.source ?? worldSourcedPoint(1 as never, 0, 0), context.geometry);
  const mapId = start?.mapId ?? null;
  const own = graph.taxiNodes.filter((node) => node.npcId !== null && node.taxiNodeId !== null && node.point?.mapId === mapId && taxiNodeOpenTo(node, character.faction));
  if (own.length < 2) throw new Error('the travel variant needs two flight points of the side');
  const ref = (node: (typeof own)[number]) => ({ npcId: node.npcId, taxiNodeId: null, name: null });
  const ids = sequentialIdSource(900_000);
  const steps = [...project.route.steps];
  let flights = 0;
  let transports = 0;
  for (let i = 20, k = 0; i < steps.length; i += 21, k += 1) {
    const from = own[k % own.length];
    const to = own[(k * 7 + 3) % own.length];
    if (from === undefined || to === undefined || from === to) continue;
    steps.splice(i, 0, makeFlightStep(ids, { from: ref(from), to: ref(to) }));
    flights += 1;
  }
  for (let i = 499; i < steps.length; i += 500) {
    steps.splice(i, 0, makeTravelStep(ids, { mode: 'transport', transport: { id: 'rutheran-auberdine', dock: null } }), makeTravelStep(ids, { mode: 'transport', transport: { id: 'rutheran-auberdine', dock: null } }));
    transports += 2;
  }
  return {
    context: { ...context, graph, localTaxi: taxiLegDataOf(taxi) },
    project: { ...project, character: { ...project.character, knownFlightPaths: own.map(ref) }, route: { ...project.route, steps } },
    flights,
    transports,
  };
}

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

/** The stress route (see the file comment). */
export function buildStressRoute(view: DatasetView, count: number): RouteStep[] {
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

/** A quest of the realistic route: its starter, finisher and objective places (null: worked where the character stands). */
interface QuestPlan {
  readonly quest: QuestRecord;
  readonly finisher: SpawnPoint;
  readonly places: readonly (SpawnPoint | null)[];
}

const planarDistance = (a: WorldPoint, b: WorldPoint): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

/** The zone-point spawn nearest `near` on its map (the first one without `near`). */
function zoneSpawn(spawns: readonly SpawnPoint[], near: WorldPoint | null): SpawnPoint | null {
  let best: SpawnPoint | null = null;
  let bestYards = Number.POSITIVE_INFINITY;
  for (const spawn of spawns) {
    if (spawn.world === null || !('space' in spawn.source) || spawn.source.space !== 'zone') continue;
    if (near === null) return spawn;
    if (spawn.world.mapId !== near.mapId) continue;
    const yards = planarDistance(spawn.world, near);
    if (yards < bestYards) {
      best = spawn;
      bestYards = yards;
    }
  }
  return best;
}

function entitySpawn(view: DatasetView, refs: readonly EntityRef[], near: WorldPoint | null): SpawnPoint | null {
  for (const ref of refs) {
    if (ref.kind === 'item') continue;
    const spawn = zoneSpawn(view.spawns(ref), near);
    if (spawn !== null) return spawn;
  }
  return null;
}

/** Where an objective is worked: undefined when it cannot be placed at all (the quest is left out). */
function objectivePlace(view: DatasetView, def: ObjectiveDef, near: WorldPoint): SpawnPoint | null | undefined {
  switch (def.kind) {
    case 'kill':
      return zoneSpawn(view.spawns({ kind: 'npc', id: def.npcId }), near);
    case 'killCredit':
      return zoneSpawn(view.spawns({ kind: 'npc', id: def.rootNpcId }), near);
    case 'object':
      return zoneSpawn(view.spawns({ kind: 'object', id: def.objectId }), near);
    case 'item': {
      const item = view.item(def.itemId);
      if (item === undefined) return undefined;
      for (const id of item.dropNpcs) {
        const spawn = zoneSpawn(view.spawns({ kind: 'npc', id }), near);
        if (spawn !== null) return spawn;
      }
      for (const id of item.dropObjects) {
        const spawn = zoneSpawn(view.spawns({ kind: 'object', id }), near);
        if (spawn !== null) return spawn;
      }
      return undefined;
    }
    case 'spell':
    case 'event':
      return null;
    case 'reputation':
      return undefined;
  }
}

function questPlans(view: DatasetView, character: CharacterProfile): QuestPlan[] {
  const out: QuestPlan[] = [];
  for (const quest of view.quests()) {
    if (!raceAllowed(quest.races, character.race) || !classAllowed(quest.classes, character.class)) continue;
    if (quest.flags.repeatable || quest.flags.needsEvent || quest.dungeonQuest) continue;
    const req = quest.requirements;
    if (req.skill !== null || req.minReputation !== null || req.maxReputation !== null || req.spell !== null || req.specialization !== null) continue;
    if (quest.prerequisites.breadcrumbForQuestId !== null || (quest.minLevel ?? quest.level ?? 1) > 60) continue;
    const starter = entitySpawn(view, quest.starters, null);
    if (starter === null || starter.world === null) continue;
    const finisher = entitySpawn(view, quest.finishers, starter.world);
    if (finisher === null || finisher.world === null) continue;
    const places: (SpawnPoint | null)[] = [];
    let placed = true;
    for (const def of quest.objectives) {
      const place = objectivePlace(view, def, starter.world);
      if (place === undefined) {
        placed = false;
        break;
      }
      places.push(place);
    }
    if (placed) out.push({ quest, finisher, places });
  }
  const levelOf = (quest: QuestRecord): number => quest.minLevel ?? quest.level ?? 1;
  return out.sort((a, b) => levelOf(a.quest) - levelOf(b.quest) || (a.quest.level ?? 0) - (b.quest.level ?? 0) || a.quest.id - b.quest.id);
}

const locationAt = (spawn: SpawnPoint): Location => ({ source: spawn.source as Location['source'], label: null, radius: null });

function guideSteps(plans: readonly QuestPlan[]): { readonly steps: RouteStep[]; readonly acceptAt: ReadonlyMap<QuestId, number> } {
  const ids = sequentialIdSource();
  const steps: RouteStep[] = [];
  const acceptAt = new Map<QuestId, number>();
  plans.forEach((plan, k) => {
    const id = plan.quest.id;
    acceptAt.set(id, steps.length);
    steps.push(makeAcceptStep(ids, { questId: id }));
    plan.places.forEach((place, objective) => {
      if (place === null) {
        steps.push(makeCompleteStep(ids, { targets: [{ questId: id, objective }] }));
        return;
      }
      steps.push(makeTravelStep(ids, { location: locationAt(place) }));
      steps.push(makeCompleteStep(ids, { targets: [{ questId: id, objective }], location: locationAt(place) }));
    });
    steps.push(makeTravelStep(ids, { location: locationAt(plan.finisher) }));
    steps.push(makeTurnInStep(ids, { questId: id }));
    if (k % 10 === 9) steps.push(makeNoteStep(ids, { text: `Section ${String(k + 1)}` }));
  });
  return { steps, acceptAt };
}

/** The realistic route (see the file comment). */
export function buildRealisticRoute(
  view: DatasetView,
  character: CharacterProfile,
  context: EngineContext,
  base: WalkProject,
  geometry: MapGeometry,
  count: number,
): { readonly steps: RouteStep[]; readonly composition: Readonly<Record<string, number>> } {
  let plans = questPlans(view, character);
  const eligible = plans.length;
  for (let round = 0; round < 8; round += 1) {
    const { steps, acceptAt } = guideSteps(plans);
    const { walk, issues } = validateRoute({ ...base, route: { ...base.route, steps } }, context);
    const indexOf = new Map(steps.map((step, i) => [step.id, i]));
    const refused = new Map<QuestId, number | null>();
    for (const issue of issues) {
      if (issue.stepId === null || issue.questId === null || refused.has(issue.questId)) continue;
      if (acceptAt.get(issue.questId) !== indexOf.get(issue.stepId)) continue;
      if (issue.severity !== 'error' && !issue.code.startsWith('LINT003')) continue;
      const required = issue.code === 'VAL004-min-level' && typeof issue.data?.requiredLevel === 'number' ? issue.data.requiredLevel : null;
      refused.set(issue.questId, required);
    }
    if (refused.size === 0) break;
    const levelAt = new Map(plans.map((plan) => [plan.quest.id, walk.estimates[acceptAt.get(plan.quest.id) ?? 0]?.levelAfter.value ?? 0]));
    const kept: QuestPlan[] = [];
    const later: { readonly plan: QuestPlan; readonly level: number }[] = [];
    for (const plan of plans) {
      const required = refused.get(plan.quest.id);
      if (required === undefined) kept.push(plan);
      else if (required !== null && round < 6) later.push({ plan, level: required });
    }
    for (const { plan, level } of later) {
      const at = kept.findIndex((other) => (levelAt.get(other.quest.id) ?? 0) >= level);
      if (at < 0) kept.push(plan);
      else kept.splice(at, 0, plan);
    }
    plans = kept;
  }
  const guide = guideSteps(plans).steps;
  const need = Math.max(0, count - guide.length);
  // Waypoints on the segments between consecutive located steps on one world map, spread evenly.
  const points = guide.map((step) => (step.location === null ? null : resolvePoint(step.location.source, geometry)));
  const gaps: number[] = [];
  let previous: WorldPoint | null = null;
  points.forEach((point, i) => {
    if (point !== null && previous !== null && point.mapId === previous.mapId && (point.x !== previous.x || point.y !== previous.y)) gaps.push(i);
    if (point !== null) previous = point;
  });
  const perGap = new Map<number, number>();
  for (let k = 0; k < need && gaps.length > 0; k += 1) {
    const gap = gaps[Math.floor((k * gaps.length) / need) % gaps.length] ?? -1;
    perGap.set(gap, (perGap.get(gap) ?? 0) + 1);
  }
  const ids = sequentialIdSource(5_000_000);
  const steps: RouteStep[] = [];
  let padded = 0;
  previous = null;
  guide.forEach((step, i) => {
    const point = points[i] ?? null;
    const n = perGap.get(i) ?? 0;
    const from: WorldPoint | null = previous;
    if (n > 0 && point !== null && from !== null) {
      for (let j = 1; j <= n; j += 1) {
        const t = j / (n + 1);
        steps.push(makeTravelStep(ids, { location: { source: worldSourcedPoint(point.mapId, from.x + (point.x - from.x) * t, from.y + (point.y - from.y) * t), label: null, radius: null } }));
        padded += 1;
      }
    }
    steps.push(step);
    if (point !== null) previous = point;
  });
  return { steps: steps.slice(0, count), composition: { eligibleQuests: eligible, quests: plans.length, paddingWaypoints: padded } };
}

// =============================================================================================
// --check: bundled, one process per case, probe-normalised

/** One gated case: its route and name, and the absolute limit its normalised median must stay under, if any. */
export interface GatedCase {
  readonly route: BenchRoute;
  readonly name: string;
  /** §14 budget (realistic route) or the stress route's ceiling (PERF-01), in normalised ms. */
  readonly limit: number | null;
}

/** What a child process prints for one case. */
export interface CaseResult extends Stats {
  readonly route: BenchRoute;
  readonly case: string;
  readonly probeMs: number;
}

interface EsbuildApi {
  buildSync(options: Record<string, unknown>): unknown;
}

/** esbuild, as tsx (a dev dependency) resolves it: bundles as `vite build` does, without the keepNames wrapper. */
function esbuild(): EsbuildApi {
  const fromTsx = createRequire(createRequire(import.meta.url).resolve('tsx/package.json'));
  return fromTsx('esbuild') as EsbuildApi;
}

/**
 * Runs the gated cases of `script` (this bench's own source) as a bundle, one process per case and
 * repetition, and compares them with `baselines` (the stored normalised medians by route and case).
 * Returns the per-case summaries and the failures.
 */
export function runChecks(
  scriptUrl: string,
  cases: readonly GatedCase[],
  args: BenchArgs,
  baselines: (route: BenchRoute, name: string) => number | null,
): { readonly results: Record<string, unknown>; readonly failures: readonly string[] } {
  const script = fileURLToPath(scriptUrl);
  // Two levels below the repository root, as tests/support/fake-fetch.ts finds the data from its bundle.
  const outDir = join(REPO_ROOT, '.cache', 'bench');
  mkdirSync(outDir, { recursive: true });
  const bundle = join(outDir, `${basename(script, '.ts')}.mjs`);
  esbuild().buildSync({ entryPoints: [script], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: bundle, logLevel: 'warning' });
  const byCase = new Map<string, CaseResult[]>();
  for (let repetition = 0; repetition < args.repeat; repetition += 1) {
    // Rotate the order each repetition, so no case always follows the same one.
    for (let k = 0; k < cases.length; k += 1) {
      const gated = cases[(k + repetition) % cases.length];
      if (gated === undefined) continue;
      const child = spawnSync(process.execPath, [bundle, '--case', gated.name, '--route', gated.route, '--runs', String(args.runs), '--warm', String(args.warm), '--steps', String(args.steps), '--json'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      if (child.status !== 0) throw new Error(`${gated.route}/${gated.name} failed: ${child.stderr}`);
      const line = child.stdout.trim().split('\n').at(-1) ?? '';
      const result = JSON.parse(line) as CaseResult;
      const key = `${gated.route}/${gated.name}`;
      byCase.set(key, [...(byCase.get(key) ?? []), result]);
    }
  }
  const results: Record<string, unknown> = {};
  const failures: string[] = [];
  for (const gated of cases) {
    const key = `${gated.route}/${gated.name}`;
    const runs = byCase.get(key) ?? [];
    const medianMs = round(median(runs.map((run) => run.median)));
    const probeMs = round(median(runs.map((run) => run.probeMs)));
    const normalised = round((medianMs * PROBE_REFERENCE_MS) / probeMs);
    const baseline = baselines(gated.route, gated.name);
    results[key] = { medians: runs.map((run) => run.median), medianMs, probeMs, normalised, baseline, limit: gated.limit };
    if (baseline !== null && normalised > baseline * REGRESSION) {
      failures.push(`${key}: ${String(normalised)} ms normalised, baseline ${String(baseline)} ms (+${String(Math.round((normalised / baseline - 1) * 100))}%)`);
    }
    if (gated.limit !== null && normalised > gated.limit) failures.push(`${key}: ${String(normalised)} ms normalised, over its limit of ${String(gated.limit)} ms`);
  }
  return { results, failures };
}

/** The stored normalised median of a case in a measurements file entry (`<entry>[route].<case>.normalised`). */
export function storedBaseline(file: string, entry: string): (route: BenchRoute, name: string) => number | null {
  const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, Record<string, { normalised?: number }> | undefined> | undefined>;
  return (route, name) => stored[entry]?.[route]?.[name]?.normalised ?? null;
}
