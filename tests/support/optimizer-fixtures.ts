import type { ItemRecord, NpcRecord, QuestRecord, SpawnPoint } from '../../src/domain/dataset';
import { type IdSource, questId, type QuestId, sequentialIdSource, type StepId } from '../../src/domain/ids';
import type { ValidationIssue } from '../../src/domain/issues';
import type { Location } from '../../src/domain/points';
import type { CharacterProfile, CustomQuest, ProjectV1 } from '../../src/domain/project';
import { createEmptyProject } from '../../src/domain/project-factory';
import type { AcceptStep, CompleteStep, GrindStep, NoteStep, RouteStep, TrainStep, TravelStep, TurnInStep } from '../../src/domain/route';
import { makeAcceptStep, makeCompleteStep, makeGrindStep, makeHearthStep, makeNoteStep, makeTrainStep, makeTravelStep, makeTurnInStep } from '../../src/domain/step-factory';
import type { EngineContext, ReadonlyCharacterState, WalkProject } from '../../src/engine/types';
import { at, fixtureContext, fixtureDataset, KALIMDOR, killObjective, npcRecord, questRecord } from '../../src/engine/test-helpers';
import { createRouteWalker } from '../../src/engine/walker';
import { fixedClock } from '../../src/app/clock';
import type { OptimizationHost } from '../../src/app/optimizer-host';
import { type OptimizationResult, startOptimization } from '../../src/app/optimizer-run';
import { createRunWalker, type RunWalker, walkSection, type WalkedSection } from '../../src/app/optimizer-walk';
import { createEditorStore } from '../../src/app/store';
import { createTypeScriptBeamSearchOptimizer, type Optimizer, type OptimizationOptions, type OptimizationRequest, type OptimizerTimers } from '../../src/optimizer';
import { analyseSection, compileProblem, createSearch, decodeSolution, evaluateSequence } from '../../src/optimizer/core';
import type {
  CompiledProblem,
  CompileFailure,
  OptimizationGoal,
  SearchOptions,
  SearchOutcome,
  SearchSolution,
  SectionAnalysis,
} from '../../src/optimizer/types';
import { inProcessOptimizerWorker, type InProcessOptions } from '../../src/optimizer/worker/test-helpers';
import { xpCurveOf } from '../../src/sim/xp';
import { validateRoute } from '../../src/validate/validator';

/**
 * Black-box support for the optimiser's fixture suite (ARCHITECTURE §11.7, docs/research/
 * optimizer-m7.md §13). Everything here is built from the plan's text and the engine, never from the
 * search's code: scenarios under harness H, compile inputs through the app's real validator (as
 * `startOptimization` builds them), the engine side of the §6.3 parity metric, a run through the
 * public `Optimizer` in an in-process worker, and the seeded instances and brute-force oracle of
 * fixture 9.
 *
 * Harness H: Kalimdor world yards, a level-10 Horde orc warrior at (0, 0), 10 yd/s on foot with
 * detour 1 (a leg takes yards / 10 s), quests at level 30 so their XP is exact up to level 35.
 */

// =============================================================================================
// Scenarios

export const H_ASSUMPTIONS = { runSpeedYps: 10, travelDetourFactor: 1 } as const;

export const DEFAULT_H_OPTIONS: OptimizationOptions = { beamWidth: 16, maxEvaluations: 100_000, maxMillis: null, divergencePenalty: 0 };

/** A harness quest: level 30, minimum level 1, no objectives, `xp` exact for levels up to 35. */
export function hQuest(id: number, xp: number | null, fields: Partial<QuestRecord> = {}): QuestRecord {
  return questRecord(id, {
    level: 30,
    minLevel: 1,
    objectives: [],
    xp: xp === null ? null : { questLevel: 30, baseXp: xp, basis: 'era-seed' },
    ...fields,
  });
}

/** Step builders sharing one id source. Every step is located in world yards unless said otherwise. */
export function builder(ids: IdSource = sequentialIdSource(1)) {
  return {
    ids,
    accept: (q: number, x: number | null, y = 0, fields: Partial<AcceptStep> = {}): AcceptStep => ({
      ...makeAcceptStep(ids, { questId: questId(q), location: x === null ? null : at(x, y) }),
      ...fields,
    }),
    turnin: (q: number, x: number | null, y = 0, fields: Partial<TurnInStep> = {}): TurnInStep => ({
      ...makeTurnInStep(ids, { questId: questId(q), location: x === null ? null : at(x, y) }),
      ...fields,
    }),
    complete: (q: number, x: number, y: number, fields: Partial<CompleteStep> = {}): CompleteStep => ({
      ...makeCompleteStep(ids, { targets: [{ questId: questId(q), objective: null }], location: at(x, y) }),
      ...fields,
    }),
    note: (text: string, x: number, y: number, fields: Partial<NoteStep> = {}): NoteStep => ({ ...makeNoteStep(ids, { text, location: at(x, y) }), ...fields }),
    train: (x: number, y: number, fields: Partial<TrainStep> = {}): TrainStep => ({ ...makeTrainStep(ids, { location: at(x, y), skill: 'riding', rank: 1 }), ...fields }),
    /** A travel step; `x` null is zone travel (the position becomes unknown). */
    travel: (x: number | null, y = 0, fields: Partial<TravelStep> = {}): TravelStep => ({ ...makeTravelStep(ids, { location: x === null ? null : at(x, y) }), ...fields }),
    /** Accept, then turn in at the same point. */
    pair: (q: number, x: number, y: number): RouteStep[] => [
      makeAcceptStep(ids, { questId: questId(q), location: at(x, y) }),
      makeTurnInStep(ids, { questId: questId(q), location: at(x, y) }),
    ],
  };
}

export interface Fixture {
  readonly project: ProjectV1;
  readonly context: EngineContext;
  readonly section: { readonly first: number; readonly last: number };
}

export interface FixtureSpec {
  readonly quests: readonly QuestRecord[];
  readonly npcs?: readonly NpcRecord[];
  readonly items?: readonly ItemRecord[];
  readonly spawns?: Readonly<Record<string, readonly SpawnPoint[]>>;
  readonly prefix?: readonly RouteStep[];
  readonly steps: readonly RouteStep[];
  /** The exit E: the suffix is one `note` there (text `exit`), unless `suffix` is given. */
  readonly exit?: readonly [number, number];
  readonly suffix?: readonly RouteStep[];
  readonly character?: Partial<CharacterProfile>;
  readonly customQuests?: readonly CustomQuest[];
}

/** Harness H (docs/research/optimizer-m7.md §13.0). */
export function hFixture(spec: FixtureSpec): Fixture {
  const exitIds = sequentialIdSource(90_000);
  const suffix = spec.suffix ?? (spec.exit === undefined ? [] : [makeNoteStep(exitIds, { text: 'exit', location: at(spec.exit[0], spec.exit[1]) })]);
  const prefix = spec.prefix ?? [];
  const base = createEmptyProject({
    ids: sequentialIdSource(1),
    nowIso: '2026-09-27T12:00:00.000Z',
    name: 'Optimiser fixtures',
    character: { faction: 'Horde', race: 'Orc', class: 'WARRIOR', startLevel: 10, startXp: 0, startLocation: at(0, 0), riding: 0, priorHistory: 'fresh', ...spec.character },
  });
  const project: ProjectV1 = {
    ...base,
    assumptions: { ...H_ASSUMPTIONS },
    customQuests: spec.customQuests ?? [],
    route: { ...base.route, steps: [...prefix, ...spec.steps, ...suffix] },
  };
  const context = fixtureContext(
    fixtureDataset({ quests: spec.quests, npcs: spec.npcs ?? [], items: spec.items ?? [], spawns: spec.spawns ?? {} }),
    { assumptions: H_ASSUMPTIONS },
  );
  return { project, context, section: { first: prefix.length, last: prefix.length + spec.steps.length - 1 } };
}

/** A short label per step: `a101` accept, `t101` turn in, `c101` complete, `n:L1` note, `grind`, `train`. */
export function label(step: RouteStep): string {
  if (step.kind === 'accept') return `a${String(step.questId)}`;
  if (step.kind === 'turnin') return `t${String(step.questId)}`;
  if (step.kind === 'complete') return `c${step.targets.map((t) => String(t.questId)).join('+')}`;
  if (step.kind === 'note') return `n:${step.text}`;
  if (step.kind === 'travel') return step.location === null ? 'zone' : 'travel';
  return step.kind;
}

export const labels = (steps: readonly RouteStep[]): string[] => steps.map(label);

// =============================================================================================
// The app's side: a host over the fixture's engine context, the run's walks and compile

/** An `OptimizationHost` on the straight-line model (no "computing paths"), with the fixture's context. */
export function fixtureHost(f: Fixture, revision: number): OptimizationHost {
  return {
    revision,
    project: f.project,
    engine: f.context,
    validator: { dataset: f.context.dataset, rules: f.context.rules, baseDataset: null, graph: f.context.graph },
    travelModel: 'straight-line',
    computeLegs(_pairs, options) {
      options.signal.throwIfAborted();
      options.onProgress({ done: 0, total: 0 });
      return Promise.resolve({ complete: true });
    },
    missingLegs: () => 0,
    cacheKey: () => 'straight-line',
  };
}

export interface Compiled {
  readonly run: RunWalker;
  readonly analysis: SectionAnalysis;
  readonly baseline: WalkedSection;
  readonly compiled: CompiledProblem;
}

export const goalOf = (goal: Partial<OptimizationGoal> = {}): OptimizationGoal => ({ targetXp: goal.targetXp ?? 'keep-original', grindFill: goal.grindFill ?? 'shortfall' });

/**
 * The compile input as the app builds it (§5.1, §9): the run's walker with the real validator, the
 * analysis walk, `analyseSection`, the baseline re-walk with the probe, then `compileProblem`.
 */
export function compileFixture(f: Fixture, goal: Partial<OptimizationGoal> = {}): Compiled | CompileFailure {
  const run = createRunWalker(fixtureHost(f, 1));
  const analysisWalk = walkSection(run, f.project, f.section, { probe: false });
  const analysis = analyseSection({ project: f.project, section: f.section, goal: goalOf(goal), context: run.engine, walk: analysisWalk.walk, availability: run.availability });
  if (!analysis.ok) return analysis;
  const baseline = walkSection(run, f.project, f.section, { probe: true, from: analysis.castWindowStart });
  const compiled = compileProblem(analysis, baseline.walk);
  if (!compiled.ok) return compiled;
  return { run, analysis, baseline, compiled };
}

export function mustCompile(f: Fixture, goal: Partial<OptimizationGoal> = {}): Compiled {
  const result = compileFixture(f, goal);
  if ('ok' in result && !result.ok) throw new Error(`compile refused: ${result.status}: ${result.reason}`);
  return result as Compiled;
}

export const SEARCH_DEFAULTS: SearchOptions = { beamWidth: 16, maxEvaluations: 100_000, divergencePenalty: 0, candidates: 4, rolloutEvery: 8, dominance: true };

/** Runs the core stepper to its end in slices of `slice` evaluations. */
export function searchToEnd(compiled: CompiledProblem, options: Partial<SearchOptions> = {}, slice = 1_000_000): SearchOutcome {
  const stepper = createSearch(compiled.problem, { ...SEARCH_DEFAULTS, ...options });
  for (let guard = 0; guard < 100_000_000; guard += 1) {
    const result = stepper.advance(slice);
    if (result.done) return result.outcome;
  }
  throw new Error('the search did not end');
}

/** The section's steps for a solution (decoded with deterministic ids for new steps). */
export function decode(compiled: CompiledProblem, solution: SearchSolution): readonly RouteStep[] {
  return decodeSolution(compiled.decode, solution, sequentialIdSource(70_000)).steps;
}

/** The unit indices, in order, whose steps include the given section steps (repeats collapsed). */
export function unitsOf(compiled: CompiledProblem, steps: readonly RouteStep[]): Int32Array {
  const d = compiled.decode;
  const unitOfStep = new Map<StepId, number>();
  const unitCount = d.unitStart.length - 1;
  for (let u = 0; u < unitCount; u += 1) {
    for (let k = d.unitStart[u] ?? 0; k < (d.unitStart[u + 1] ?? 0); k += 1) {
      const step = d.steps[d.unitSteps[k] ?? -1];
      if (step !== undefined) unitOfStep.set(step.id, u);
    }
  }
  const out: number[] = [];
  for (const step of steps) {
    const u = unitOfStep.get(step.id);
    if (u === undefined) throw new Error(`step ${label(step)} is in no unit`);
    if (out.at(-1) !== u) out.push(u);
  }
  return Int32Array.from(out);
}

/** `evaluateSequence` of the units holding these steps. */
export function evaluateSteps(compiled: CompiledProblem, steps: readonly RouteStep[]): SearchSolution | { readonly infeasible: string } {
  return evaluateSequence(compiled.problem, unitsOf(compiled, steps));
}

// =============================================================================================
// The engine side (§6.3)

export interface EngineSection {
  /** `(endSec(last) − startSec(first)) × 1000` plus the exit chain's travel and waiting, ms. */
  readonly ms: number;
  readonly issues: readonly ValidationIssue[];
  readonly project: WalkProject;
  /** The state before the first suffix step (when asked for). */
  readonly endState: ReadonlyCharacterState | null;
}

/** The fixture's route with its section replaced by `section`. */
export function withSection(f: Fixture, section: readonly RouteStep[]): ProjectV1 {
  const steps = f.project.route.steps;
  return { ...f.project, route: { ...f.project.route, steps: [...steps.slice(0, f.section.first), ...section, ...steps.slice(f.section.last + 1)] } };
}

/**
 * Walks the route with `section` in place of the fixture's through `validateRoute` (the validator's
 * accept policy), and measures the §6.3 engine side over the section and `chainLength` exit steps.
 */
export function engineSection(f: Fixture, section: readonly RouteStep[], chainLength: number, options: { readonly endState?: boolean } = {}): EngineSection {
  const project = withSection(f, section);
  const { walk, issues } = validateRoute(project, f.context);
  const first = f.section.first;
  const last = first + section.length - 1;
  const a = walk.records[first];
  const b = walk.records[last];
  if (a === undefined || b === undefined) throw new RangeError('the section is empty');
  let ms = (b.estimate.endSec - a.estimate.startSec) * 1000;
  for (let k = 1; k <= chainLength; k += 1) {
    const record = walk.records[last + k];
    if (record !== undefined) ms += (record.estimate.breakdown.travel + record.estimate.breakdown.waiting) * 1000;
  }
  let endState: ReadonlyCharacterState | null = null;
  if (options.endState === true) {
    const walker = createRouteWalker({ ...f.context, acceptPolicy: createRunWalker(fixtureHost(f, 1)).validator.acceptPolicy });
    walker.walk(project);
    endState = walker.stateBefore(last + 1);
  }
  return { ms, issues, project, endState };
}

/** Error-severity issues of `candidate` that `original` did not have, compared as (stepId, code, questId). */
export function newErrors(original: readonly ValidationIssue[], candidate: readonly ValidationIssue[]): ValidationIssue[] {
  const key = (i: ValidationIssue): string => `${String(i.stepId)}|${i.code}|${String(i.questId)}`;
  const before = new Set(original.filter((i) => i.severity === 'error').map(key));
  return candidate.filter((i) => i.severity === 'error' && !before.has(key(i)));
}

/** §6.3's bound, and a count of priced parts (two per section and exit step, plus a fill's). */
export const partsOf = (sectionSteps: number, chainLength: number): number => 2 * (sectionSteps + chainLength) + 2;
export const parityBound = (engineMs: number, parts: number): number => Math.max(0.01 * engineMs, parts);

// =============================================================================================
// The public optimiser, in an in-process worker, through the app's run

export function inProcessOptimizer(options: InProcessOptions & { readonly cancelGraceMs?: number; readonly timers?: OptimizerTimers } = {}): {
  readonly optimizer: Optimizer;
  readonly workers: ReturnType<typeof inProcessOptimizerWorker>[];
} {
  const workers: ReturnType<typeof inProcessOptimizerWorker>[] = [];
  const { cancelGraceMs, timers, ...worker } = options;
  const optimizer = createTypeScriptBeamSearchOptimizer({
    createPort: () => {
      const made = inProcessOptimizerWorker({ sliceMs: 5, firstSlice: 256, progressMs: 0, ...worker });
      workers.push(made);
      return made.port;
    },
    ...(cancelGraceMs === undefined ? {} : { cancelGraceMs }),
    ...(timers === undefined ? {} : { timers }),
  });
  return { optimizer, workers };
}

export function requestOf(f: Fixture, revision: number, goal: Partial<OptimizationGoal> = {}): OptimizationRequest {
  const steps = f.project.route.steps;
  const first = steps[f.section.first];
  const last = steps[f.section.last];
  if (first === undefined || last === undefined) throw new Error('no section');
  const g = goalOf(goal);
  return {
    project: f.project,
    baseRevision: revision,
    section: { firstStepId: first.id, lastStepId: last.id },
    scope: { allowNewQuests: false, zones: null, levelWindow: null },
    goal: { kind: 'min-time', targetXp: g.targetXp, grindFill: g.grindFill },
  };
}

/** A whole app run (`startOptimization`: paths, compiling, searching, finishing) on the straight-line model. */
export async function runApp(f: Fixture, goal: Partial<OptimizationGoal> = {}, options: Partial<OptimizationOptions> = {}): Promise<OptimizationResult> {
  const store = createEditorStore({ project: f.project, ids: sequentialIdSource(50_000), clock: fixedClock('2026-09-27T12:00:00.000Z') });
  const revision = store.getState().revision;
  const { optimizer } = inProcessOptimizer();
  try {
    return await startOptimization({ host: fixtureHost(f, revision), store, optimizer, ids: sequentialIdSource(60_000) }, requestOf(f, revision, goal), { ...DEFAULT_H_OPTIONS, ...options }).result;
  } finally {
    optimizer.dispose();
  }
}

// =============================================================================================
// Grid-40 (fixtures 10a and 10b)

/** Quests 1000+k: accept at (150 × (k mod 8), 150 × floor(k / 8)), turn-in at quest ((k + 13) mod 40)'s accept point; E (1050, 600). */
export function grid40(): Fixture {
  const b = builder();
  const point = (k: number): [number, number] => [150 * (k % 8), 150 * Math.floor(k / 8)];
  const quests: QuestRecord[] = [];
  const steps: RouteStep[] = [];
  for (let k = 0; k < 40; k += 1) {
    quests.push(hQuest(1000 + k, 1000));
    const [ax, ay] = point(k);
    const [tx, ty] = point((k + 13) % 40);
    steps.push(b.accept(1000 + k, ax, ay), b.turnin(1000 + k, tx, ty));
  }
  return hFixture({ quests, steps, exit: [1050, 600] });
}

// =============================================================================================
// Fixture 9: seeded instances and the brute-force oracle

/** Lehmer (Park-Miller) generator: x ← x × 48271 mod 2^31 − 1. Exact in doubles (x × 48271 < 2^53). */
export function lehmer(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 48271) % 2147483647;
    return x;
  };
}

export interface OracleQuest {
  readonly id: number;
  readonly xp: number;
  readonly accept: RouteStep;
  readonly complete: RouteStep | null;
  readonly turnin: RouteStep;
  /** Kill XP granted by the complete (2 kills at 95 XP), else 0. */
  readonly killXp: number;
}

export interface OracleInstance {
  readonly seed: number;
  readonly fixture: Fixture;
  readonly quests: readonly OracleQuest[];
  readonly goal: OptimizationGoal;
  /** The known XP gain the target asks for. */
  readonly target: number;
  readonly units: number;
}

const KILL_NPC = 9900;
const KILL_XP_EACH = 95;

/**
 * `uniform` is the plan's generator. The two extensions (beyond §13) stress what uniform points
 * almost never hit: `coarse` draws every point from a 3 × 3 grid of 500-yard steps (the start
 * included), so steps share points (TIME-8's further-accept discount, zero-length legs, a step at
 * the start); `radius` gives each location an arrival radius of none, 15 or 40 yards (TIME-2's
 * (d − r) / d).
 */
export type OracleVariant = 'uniform' | 'coarse' | 'radius';

/**
 * One seeded instance (§13 fixture 9): 2 or 3 quests with accept and turn-in at separate uniform
 * integer points in [−500, 500]²; XP 50 × (10 + x mod 31); on odd draws one quest gets a kill
 * objective (count 2: 60 s and 190 XP at level 10) with a located `complete`; E random. The target
 * by seed mod 3: keep-original, a random non-empty subset's XP, or keep-original + 300 (a fill).
 */
export function oracleInstance(seed: number, variant: OracleVariant = 'uniform'): OracleInstance {
  const next = lehmer(variant === 'uniform' ? seed : seed + 1000 * (variant === 'coarse' ? 1 : 2));
  const coord = variant === 'coarse' ? (): number => 500 * (next() % 3) - 500 : (): number => (next() % 1001) - 500;
  const radius = (): number | null => (variant === 'radius' ? ([null, 15, 40] as const)[next() % 3] ?? null : null);
  const where = (): Location => {
    const x = coord();
    const y = coord();
    return at(x, y, KALIMDOR, radius());
  };
  const b0 = builder(sequentialIdSource(seed * 100));
  const b = {
    accept: (id: number): RouteStep => ({ ...b0.accept(id, 0, 0), location: where() }),
    turnin: (id: number): RouteStep => ({ ...b0.turnin(id, 0, 0), location: where() }),
    complete: (id: number): RouteStep => ({ ...b0.complete(id, 0, 0), location: where() }),
  };
  const n = 2 + (next() % 2);
  const kill = next() % 2 === 1 ? next() % n : -1;
  const records: QuestRecord[] = [];
  const quests: OracleQuest[] = [];
  for (let k = 0; k < n; k += 1) {
    const id = 2000 + k;
    const xp = 50 * (10 + (next() % 31));
    const accept = b.accept(id);
    const turnin = b.turnin(id);
    const complete = k === kill ? b.complete(id) : null;
    records.push(hQuest(id, xp, k === kill ? { objectives: [killObjective(KILL_NPC, 2)] } : {}));
    quests.push({ id, xp, accept, complete, turnin, killXp: k === kill ? 2 * KILL_XP_EACH : 0 });
  }
  const exit: [number, number] = [coord(), coord()];
  // The original: quest by quest, each accept, complete, turn-in.
  const steps = quests.flatMap((q) => (q.complete === null ? [q.accept, q.turnin] : [q.accept, q.complete, q.turnin]));
  const full = quests.reduce((sum, q) => sum + q.xp + q.killXp, 0);
  let goal: OptimizationGoal;
  let target: number;
  switch (seed % 3) {
    case 0:
      goal = { targetXp: 'keep-original', grindFill: 'shortfall' };
      target = full;
      break;
    case 1: {
      const chosen = quests.filter(() => next() % 2 === 1);
      const subset = chosen.length === 0 ? [quests[next() % n] as OracleQuest] : chosen;
      target = subset.reduce((sum, q) => sum + q.xp + q.killXp, 0);
      goal = { targetXp: target, grindFill: 'shortfall' };
      break;
    }
    default:
      target = full + 300;
      goal = { targetXp: target, grindFill: 'shortfall' };
  }
  const fixture = hFixture({ quests: records, npcs: [npcRecord(KILL_NPC, { minLevel: 10, maxLevel: 10 })], steps, exit });
  return { seed, fixture, quests, goal, target, units: steps.length };
}

/** Every interleaving of the given chains that keeps each chain's order. */
export function interleavings<T>(chains: readonly (readonly T[])[]): T[][] {
  const out: T[][] = [];
  const cursor = chains.map(() => 0);
  const current: T[] = [];
  const total = chains.reduce((sum, c) => sum + c.length, 0);
  const walk = (): void => {
    if (current.length === total) {
      out.push([...current]);
      return;
    }
    chains.forEach((chain, c) => {
      const at = cursor[c] ?? 0;
      const item = chain[at];
      if (item === undefined) return;
      cursor[c] = at + 1;
      current.push(item);
      walk();
      current.pop();
      cursor[c] = at;
    });
  };
  walk();
  return out;
}

export interface OracleResult {
  readonly minMs: number;
  readonly best: readonly RouteStep[];
  readonly orders: number;
}

/**
 * The brute-force oracle: every subset of quests the fill rule allows (with the default
 * `'shortfall'`, a fill only when every quest is kept), every order consistent with accept <
 * complete < turn-in, each walked by the engine (with the fill step when the target needs one),
 * error-free orders only. The minimum of the §6.3 engine side.
 */
export function oracle(instance: OracleInstance): OracleResult {
  const { quests, target, fixture } = instance;
  const n = quests.length;
  const fillIds = sequentialIdSource(80_000);
  const originalIssues = validateRoute(fixture.project, fixture.context).issues;
  let best: { ms: number; steps: readonly RouteStep[] } | null = null;
  let orders = 0;
  for (let mask = 1; mask < 2 ** n; mask += 1) {
    const kept = quests.filter((_, k) => Math.floor(mask / 2 ** k) % 2 === 1);
    const gain = kept.reduce((sum, q) => sum + q.xp + q.killXp, 0);
    const all = kept.length === n;
    const fill = gain < target;
    if (fill && !all) continue;
    const chains = kept.map((q) => (q.complete === null ? [q.accept, q.turnin] : [q.accept, q.complete, q.turnin]));
    for (const order of interleavings(chains)) {
      const section: RouteStep[] = fill ? [...order, fillStep(fillIds, target)] : order;
      const walked = engineSection(fixture, section, 1);
      if (newErrors(originalIssues, walked.issues).length > 0) continue;
      orders += 1;
      if (best === null || walked.ms < best.ms) best = { ms: walked.ms, steps: section };
    }
  }
  if (best === null) throw new Error(`seed ${String(instance.seed)}: no feasible order`);
  return { minMs: best.ms, best: best.steps, orders };
}

/** The terminal fill as §2 describes it: grind until level 10 with `xp` into it, unlocated, origin optimizer. */
export function fillStep(ids: IdSource, xpInto: number): GrindStep {
  return makeGrindStep(ids, { until: { kind: 'level', level: 10, offset: { kind: 'xpInto', xp: xpInto } }, origin: { source: 'optimizer', ref: null } });
}

export const questIds = (ids: readonly number[]): QuestId[] => ids.map(questId);


// =============================================================================================
// Adversarial instances (review M7Q Q-04 and Q-06)

export interface AdversarialInstance {
  readonly seed: number;
  readonly fixture: Fixture;
  readonly goal: Partial<OptimizationGoal>;
  /** What the instance exercises: gated, prereq, hearth, unknownXp, subset, fill, replace. */
  readonly tags: readonly string[];
}

/**
 * The search-quality review's adversarial instances (review M7Q, the critic's generator): four quests
 * at uniform points in [−800, 800]² with arrival radii of none, 15 or 40 yards; each quest with
 * probability 1/7 of unknown XP, 1/2 of a kill objective (with a located complete), 1/4 of a
 * level-11 gate (the character then starts 400 XP short of level 11) and, after the first, 1/4 of
 * its predecessor as a prerequisite. The chains are interleaved at random, keeping every
 * prerequisite's turn-in before its dependant's accept; with probability 1/3 an unlocated hearth
 * use is inserted (bind point random). The target by `seed mod 4`: keep-original, half the known
 * XP, the known XP + 300 (a fill), or half the known XP with `'replace-quests'`. Up to 12 units.
 * Seeds 11, 56, 123 and 131 are the ones the review found the local pass's pre-screen missing.
 */
export function adversarialInstance(seed: number): AdversarialInstance {
  const next = lehmer(seed * 7919 + 17);
  const b = builder(sequentialIdSource(seed * 1000));
  const n = 4;
  const tags: string[] = [];
  const coord = (): number => (next() % 1601) - 800;
  const where = (): Location => at(coord(), coord(), KALIMDOR, ([null, null, 15, 40] as const)[next() % 4] ?? null);
  const records: QuestRecord[] = [];
  const chains: RouteStep[][] = [];
  const prereq: (number | null)[] = [];
  let gated = false;
  for (let k = 0; k < n; k += 1) {
    const id = 3000 + k;
    const xp = next() % 7 === 0 ? null : 50 * (10 + (next() % 31));
    const kill = next() % 2 === 0;
    const minLevel = next() % 4 === 0 ? 11 : 1;
    const pre = k > 0 && next() % 4 === 0 ? 3000 + k - 1 : null;
    if (minLevel > 1) gated = true;
    if (xp === null) tags.push('unknownXp');
    prereq.push(pre);
    records.push(hQuest(id, xp, { minLevel, ...(kill ? { objectives: [killObjective(KILL_NPC, 2)] } : {}), ...(pre === null ? {} : { preQuestSingle: [questId(pre)] }) }));
    const chain: RouteStep[] = [{ ...b.accept(id, 0, 0), location: where() }];
    if (kill) chain.push({ ...b.complete(id, 0, 0), location: where() });
    chain.push({ ...b.turnin(id, 0, 0), location: where() });
    chains.push(chain);
  }
  if (gated) tags.push('gated');
  if (prereq.some((p) => p !== null)) tags.push('prereq');
  const cursor = chains.map(() => 0);
  const turnedIn = new Set<number>();
  const steps: RouteStep[] = [];
  for (;;) {
    const ready = chains.flatMap((chain, k) => {
      const step = chain[cursor[k] ?? 0];
      if (step === undefined) return [];
      const pre = prereq[k] ?? null;
      if (step.kind === 'accept' && pre !== null && !turnedIn.has(pre)) return [];
      return [k];
    });
    if (ready.length === 0) break;
    const k = ready[next() % ready.length] ?? 0;
    const step = chains[k]?.[cursor[k] ?? 0] as RouteStep;
    cursor[k] = (cursor[k] ?? 0) + 1;
    if (step.kind === 'turnin') turnedIn.add(step.questId);
    steps.push(step);
  }
  const ids = sequentialIdSource(seed * 1000 + 900);
  let character: Partial<CharacterProfile> = {};
  if (next() % 3 === 0) {
    tags.push('hearth');
    const pos = 1 + (next() % (steps.length - 1));
    steps.splice(pos, 0, makeHearthStep(ids, { mode: 'use', location: null }));
    character = { hearthLocation: at(coord(), coord()) };
  }
  if (gated) {
    const curve = xpCurveOf(fixtureContext(fixtureDataset({ quests: [] }), { assumptions: H_ASSUMPTIONS }).rules);
    character = { ...character, startXp: (curve.cumulative[10] ?? 0) - (curve.cumulative[9] ?? 0) - 400 };
  }
  const exit: [number, number] = [coord(), coord()];
  const fixture = hFixture({ quests: records, npcs: [npcRecord(KILL_NPC, { minLevel: 10, maxLevel: 12 })], steps, exit, character });
  const known = records.reduce((sum, r) => sum + (r.xp?.baseXp ?? 0), 0);
  let goal: Partial<OptimizationGoal> = {};
  switch (seed % 4) {
    case 0:
      break;
    case 1:
      goal = { targetXp: Math.max(0, Math.floor(known / 2)) };
      tags.push('subset');
      break;
    case 2:
      goal = { targetXp: known + 300 };
      tags.push('fill');
      break;
    default:
      goal = { targetXp: Math.floor(known / 2), grindFill: 'replace-quests' };
      tags.push('replace');
  }
  return { seed, fixture, goal, tags };
}
