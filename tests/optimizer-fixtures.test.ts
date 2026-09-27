import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../src/app/clock';
import { createOptimizationHost } from '../src/app/optimizer-host';
import { startOptimization } from '../src/app/optimizer-run';
import { rxpImportContext, rxpImportProject } from '../src/app/rxp-import';
import { createEditorStore } from '../src/app/store';
import { loadWorkspace, type Workspace } from '../src/app/workspace';
import { factionId, questId, sequentialIdSource } from '../src/domain/ids';
import type { CustomQuest } from '../src/domain/project';
import type { RouteStep } from '../src/domain/route';
import { at, killObjective, npcRecord } from '../src/engine/test-helpers';
import type { OptimizationResult } from '../src/app/optimizer-run';
import type { OptimizationGoal, OptimizationOptions, SearchOptions, SearchOutcome, SearchSolution, Stepper } from '../src/optimizer';
import { ManualOptimizerTimers, until } from '../src/optimizer/worker/test-helpers';
import {
  builder,
  type Compiled,
  decode,
  engineSection,
  evaluateSteps,
  fillStep,
  type Fixture,
  grid40,
  hFixture,
  hQuest,
  inProcessOptimizer,
  interleavings,
  label,
  labels,
  mustCompile,
  newErrors,
  oracle,
  oracleInstance,
  parityBound,
  partsOf,
  requestOf,
  runApp,
  SEARCH_DEFAULTS,
  searchToEnd,
  unitsOf,
} from './support/optimizer-fixtures';
import { fakeServer, nodeSha256, publicSite, REPO_ROOT } from './support/fake-fetch';
import { validateRoute } from '../src/validate/validator';

/**
 * ARCHITECTURE §11.7's fixtures, written as a black-box test from the fixture specifications of
 * docs/research/optimizer-m7.md §13 (harness H, §13.0). The expected figures are the plan's CHECKED
 * engine figures, re-derived by hand here (legs in yards / 10 s, accept and turn-in 3 s each, notes
 * 0 s, 30 s and 95 XP per level-10 kill); nothing is taken from the search's code.
 *
 * Every fixture runs twice: through the core (`analyseSection`, `compileProblem`, `createSearch`,
 * `decodeSolution`, `evaluateSequence`) with the compile input the app builds from the real
 * validator, and through the app (`startOptimization` over the public `Optimizer` in an in-process
 * worker), whose verification re-walk must pass with no new error. The results are the best route
 * found under these assumptions, never "optimal".
 *
 * Beyond §13 (marked "extension"): 7h pins rule 2 through the suffix XP interval (§4.4); fixture 9
 * also runs on coarse-grid and arrival-radius instances, through the app, and across slice sizes.
 * 10b's exact evaluation count is compared with the stored baseline (docs/measurements/
 * optimizer-m7.json `fixtures`) by tests/optimizer-evaluations.test.ts.
 */

// =============================================================================================
// The fixtures (§13.1)

interface Case {
  readonly name: string;
  readonly make: () => Fixture;
  readonly goal: Partial<OptimizationGoal>;
  readonly options?: Partial<OptimizationOptions>;
  readonly status: 'improved' | 'no-improvement';
  /** The expected section, as step labels (`a` accept, `t` turn in, `c` complete, `n:` note). */
  readonly order: readonly string[];
  /** The engine's section plus exit chain for that order, seconds (CHECKED in the plan). */
  readonly seconds: number;
  readonly incumbentSeconds: number;
  /** The incumbent needs the terminal fill too (the target is above the original's XP): the XP into level 10 it grinds to. */
  readonly incumbentFill?: number;
}

/** A quest per [id, xp, x, y], accepted and turned in at one point, in the order given. */
function pairs(quests: readonly (readonly [number, number, number, number])[], exit: readonly [number, number]): Fixture {
  const b = builder();
  return hFixture({ quests: quests.map(([id, xp]) => hQuest(id, xp)), steps: quests.flatMap(([id, , x, y]) => b.pair(id, x, y)), exit });
}

const fixture1 = (exit: readonly [number, number] = [0, 200]): Fixture =>
  pairs(
    [
      [101, 3000, 3000, 0],
      [102, 1600, 100, 0],
      [103, 1600, 0, 100],
    ],
    exit,
  );

const fixture2 = (): Fixture =>
  pairs(
    [
      [201, 1000, -100, 0],
      [202, 1000, 900, 0],
      [203, 1000, 950, 50],
      [204, 1000, 1000, 0],
    ],
    [1000, 0],
  );

const fixture3 = (): Fixture =>
  pairs(
    [
      [301, 1000, -50, 0],
      [302, 1000, 600, 0],
      [303, 1000, 610, 0],
    ],
    [620, 0],
  );

const fixture4 = (): Fixture =>
  pairs(
    [
      [401, 1000, 100, 0],
      [402, 1000, -150, 0],
    ],
    [400, 0],
  );

function fixture5(): Fixture {
  const b = builder();
  return hFixture({
    quests: [hQuest(501, 4000), hQuest(502, 4000), hQuest(503, 1000, { minLevel: 11 })],
    steps: [...b.pair(501, 400, 300), ...b.pair(502, 800, 0), ...b.pair(503, -100, 0)],
    exit: [800, 0],
  });
}

function fixture6(): Fixture {
  const b = builder();
  return hFixture({
    quests: [hQuest(601, 2000, { objectives: [killObjective(6100)] }), hQuest(602, 1000)],
    npcs: [npcRecord(6100, { minLevel: 10, maxLevel: 10 })],
    steps: [b.accept(601, 100, 0), b.accept(602, 0, 150), b.turnin(602, 0, 150), b.complete(601, 1000, 0), b.turnin(601, 100, 0, { locked: true })],
    exit: [0, 200],
  });
}

function fixture7a(): Fixture {
  const b = builder();
  return hFixture({
    quests: [hQuest(701, 1000), hQuest(702, 1000)],
    steps: [b.accept(701, 500, 0), b.accept(702, -100, 0), b.turnin(702, -100, 0)],
    suffix: [b.turnin(701, 500, 0)],
  });
}

function fixture7b(): Fixture {
  const b = builder();
  return hFixture({
    quests: [hQuest(711, 1000), hQuest(712, 1000), hQuest(713, 1000, { prerequisites: { ...hQuest(713, 1000).prerequisites, preQuestSingle: [questId(711)] } })],
    steps: [...b.pair(711, -800, 0), ...b.pair(712, 100, 0)],
    suffix: [b.accept(713, 200, 0)],
  });
}

function fixture7c(): Fixture {
  const b = builder();
  return hFixture({
    quests: [hQuest(721, 1000), hQuest(722, 1000)],
    steps: [b.accept(721, 0, 0, { locked: true }), b.accept(722, 100, 0), b.turnin(722, 100, 0), b.turnin(721, 2000, 0)],
    exit: [100, 0],
  });
}

function fixture7d(): Fixture {
  const b = builder();
  const q60 = (id: number) => hQuest(id, 1000, { level: 60, xp: { questLevel: 60, baseXp: 1000, basis: 'era-seed' } });
  return hFixture({
    quests: [q60(731), q60(732)],
    steps: [b.accept(732, 1000, 0), b.turnin(732, 1000, 0), b.accept(731, 0, 50), b.train(0, 60), b.turnin(731, 0, 50)],
    exit: [1000, 0],
    character: { startLevel: 40 },
  });
}

function fixture7e(): Fixture {
  const b = builder();
  return hFixture({
    quests: [hQuest(741, 1000), hQuest(742, 1000)],
    steps: [
      ...b.pair(741, 200, 100),
      b.note('L1', 300, -200, { locked: true }),
      b.note('C3', 0, -100, { condition: { filter: null, variant: null, skipIf: [{ kind: 'levelAtLeast', level: 60, xp: null, negate: false }] } }),
      ...b.pair(742, -200, 100),
      b.note('L2', -300, -200, { locked: true }),
    ],
    exit: [400, 0],
  });
}

/** Custom quest K −751 (XP null, located only by its custom starter and finisher at (−2000, 0)) and A 752. */
function fixture7f(variant: 'v1' | 'v2'): Fixture {
  const b = builder();
  const kRecord = hQuest(-751, null, { starters: [], finishers: [] });
  const { provenance, xp: _xp, ...rest } = kRecord;
  const custom: CustomQuest = { ...rest, xp: null, provenance: { ...provenance, source: 'custom', created: true }, starterLocation: at(-2000, 0), finisherLocation: at(-2000, 0) };
  const k = [b.accept(-751, null), b.turnin(-751, null)];
  const a = b.pair(752, 100, 0);
  return hFixture({
    quests: [kRecord, hQuest(752, 1000)],
    customQuests: [custom],
    steps: variant === 'v1' ? [...k, ...a] : [...a, ...k],
    exit: variant === 'v1' ? [-1000, 0] : [100, 0],
  });
}

const fixture7g = (exitX: number): Fixture =>
  pairs(
    [
      [761, 1000, 100, 0],
      [762, 1000, -100, 0],
    ],
    [exitX, 0],
  );

const fixture8 = (): Fixture =>
  pairs(
    [
      [802, 1000, 200, 0],
      [801, 1000, 100, 0],
    ],
    [200, 0],
  );

const fixture8b = (): Fixture =>
  pairs(
    [
      [811, 1000, 100, 0],
      [812, 1000, 2000, 0],
    ],
    [0, 0],
  );

/**
 * 7h (an extension beyond §13, rule 2 through §4.4's suffix XP interval): from 7,000 XP at level 10,
 * N (100, 0) and F (3000, 0) give 500 XP each; only both reach level 11 (7,600). The exit note at
 * (0, 0) is skipped at level 11, so dropping either quest would change a suffix step's activity
 * (and N alone, 26 s with the note active, would look far cheaper than the original's 312 s).
 */
function fixture7h(): Fixture {
  const b = builder();
  return hFixture({
    quests: [hQuest(781, 500), hQuest(782, 500)],
    steps: [...b.pair(781, 100, 0), ...b.pair(782, 3000, 0)],
    suffix: [b.note('exit', 0, 0, { condition: { filter: null, variant: null, skipIf: [{ kind: 'levelAtLeast', level: 11, xp: null, negate: false }] } })],
    character: { startXp: 7000 },
  });
}

/** Fixture 12: a zone travel Z between turn in A and accept B (bound to accept B); F far east; E at the start. */
function fixture12(): Fixture {
  const b = builder();
  return hFixture({
    quests: [hQuest(1201, 1000), hQuest(1202, 1000), hQuest(1203, 1000)],
    steps: [b.accept(1201, 100, 0), b.turnin(1201, 100, 0), b.travel(null), b.accept(1202, 200, 0), b.turnin(1202, 200, 0), ...b.pair(1203, 3000, 0)],
    exit: [0, 0],
  });
}

/** Fixture 13a: an any-of accept S (1302 needs level 11, else 1303) after G; the suffix turns 1302 in. */
function fixture13a(): Fixture {
  const b = builder();
  return hFixture({
    quests: [hQuest(1301, 1000), hQuest(1302, 1000, { minLevel: 11 }), hQuest(1303, 1000)],
    steps: [...b.pair(1301, 1000, 0), b.accept(1302, 0, 50, { anyOf: [questId(1302), questId(1303)] })],
    suffix: [b.turnin(1302, 1000, 50)],
    character: { startXp: 7000 },
  });
}

/** Fixture 13b: R raises faction 76 by 250; M needs 250. */
function fixture13b(): Fixture {
  const b = builder();
  const base = hQuest(1312, 1000);
  return hFixture({
    quests: [
      hQuest(1311, 1000, { reputationReward: [{ factionId: factionId(76), value: 250 }] }),
      hQuest(1312, 1000, { requirements: { ...base.requirements, minReputation: { factionId: factionId(76), value: 250 } } }),
    ],
    steps: [...b.pair(1311, -500, 0), ...b.pair(1312, 100, 0)],
    exit: [0, 0],
    character: { reputation: { '76': 0 } },
  });
}

/** Fixture 13c: B 1322 is a breadcrumb for T 1323 (level 11); the suffix turns B in. */
function fixture13c(): Fixture {
  const b = builder();
  const base = hQuest(1322, 500);
  return hFixture({
    quests: [
      hQuest(1321, 1000),
      hQuest(1322, 500, { prerequisites: { ...base.prerequisites, breadcrumbForQuestId: questId(1323) } }),
      hQuest(1323, 1000, { minLevel: 11, prerequisites: { ...base.prerequisites, breadcrumbs: [questId(1322)] } }),
    ],
    steps: [...b.pair(1321, 1000, 0), b.accept(1322, 0, 50)],
    suffix: [b.turnin(1322, 1000, 50)],
    character: { startXp: 7000 },
  });
}

const CASES: readonly Case[] = [
  {
    name: '1 greedy-XP trap',
    make: () => fixture1(),
    goal: { targetXp: 3000 },
    status: 'improved',
    order: ['a102', 't102', 'a103', 't103'],
    seconds: 46.142,
    incumbentSeconds: 632.142,
  },
  {
    name: '2 nearest-neighbour trap',
    make: fixture2,
    goal: { targetXp: 3000 },
    status: 'improved',
    order: ['a202', 't202', 'a203', 't203', 'a204', 't204'],
    seconds: 122.142,
    incumbentSeconds: 148.142,
  },
  { name: '3 ratio trap', make: fixture3, goal: { targetXp: 2000 }, status: 'improved', order: ['a302', 't302', 'a303', 't303'], seconds: 74, incumbentSeconds: 90 },
  {
    name: '4 beam width 4 succeeds',
    make: fixture4,
    goal: {},
    options: { beamWidth: 4 },
    status: 'improved',
    order: ['a402', 't402', 'a401', 't401'],
    seconds: 82,
    incumbentSeconds: 102,
  },
  {
    name: '4 beam width 1 fails',
    make: fixture4,
    goal: {},
    options: { beamWidth: 1 },
    status: 'no-improvement',
    order: ['a401', 't401', 'a402', 't402'],
    seconds: 102,
    incumbentSeconds: 102,
  },
  {
    name: '5 level gate',
    make: fixture5,
    goal: {},
    status: 'improved',
    order: ['a502', 't502', 'a501', 't501', 'a503', 't503'],
    seconds: 296.31,
    incumbentSeconds: 298,
  },
  {
    name: '6 locked turn-in anchor',
    make: fixture6,
    goal: {},
    status: 'improved',
    order: ['a601', 'c601', 't601', 'a602', 't602'],
    seconds: 465.028,
    incumbentSeconds: 493.507,
  },
  { name: '7a rule 1, end state', make: fixture7a, goal: {}, status: 'improved', order: ['a702', 't702', 'a701'], seconds: 79, incumbentSeconds: 179 },
  { name: '7b rule 2, no new blocking', make: fixture7b, goal: { targetXp: 1000 }, status: 'improved', order: ['a711', 't711'], seconds: 186, incumbentSeconds: 192 },
  { name: '7c rule 3, no loose ends', make: fixture7c, goal: { targetXp: 1000 }, status: 'improved', order: ['a721', 't721'], seconds: 396, incumbentSeconds: 402 },
  {
    name: '7d rule 4, travel state',
    make: fixture7d,
    goal: {},
    status: 'improved',
    order: ['a731', 'train', 't731', 'a732', 't732'],
    seconds: 91.203,
    incumbentSeconds: 286.328,
  },
  {
    name: '7d with a 1,000 XP target (U dropped)',
    make: fixture7d,
    goal: { targetXp: 1000 },
    status: 'improved',
    order: ['a731', 'train', 't731'],
    seconds: 85.203,
    incumbentSeconds: 286.328,
  },
  {
    name: '7e rule 5, anchors',
    make: fixture7e,
    goal: {},
    status: 'improved',
    order: ['n:L1', 'n:C3', 'n:L2', 'a742', 't742', 'a741', 't741'],
    seconds: 205.285,
    incumbentSeconds: 230.314,
  },
  {
    name: '7f rule 6, unknown XP (v1)',
    make: () => fixture7f('v1'),
    goal: {},
    status: 'improved',
    order: ['a752', 't752', 'a-751', 't-751'],
    seconds: 332,
    incumbentSeconds: 532,
  },
  {
    name: '7f rule 6, unknown XP (v2)',
    make: () => fixture7f('v2'),
    goal: {},
    status: 'no-improvement',
    order: ['a752', 't752', 'a-751', 't-751'],
    seconds: 442,
    incumbentSeconds: 442,
  },
  { name: '7g rule 7, exit east', make: () => fixture7g(1000), goal: {}, status: 'improved', order: ['a762', 't762', 'a761', 't761'], seconds: 132, incumbentSeconds: 152 },
  { name: '7g rule 7, exit west', make: () => fixture7g(-1000), goal: {}, status: 'no-improvement', order: ['a761', 't761', 'a762', 't762'], seconds: 132, incumbentSeconds: 132 },
  {
    name: '8 grind fill',
    make: fixture8,
    goal: { targetXp: 2500 },
    status: 'improved',
    order: ['a801', 't801', 'a802', 't802', 'grind'],
    seconds: 212,
    incumbentSeconds: 232,
    incumbentFill: 2500,
  },
  { name: '8b shortfall keeps quests', make: fixture8b, goal: { grindFill: 'shortfall' }, status: 'no-improvement', order: ['a811', 't811', 'a812', 't812'], seconds: 412, incumbentSeconds: 412 },
  {
    name: '7h rule 2, the suffix XP interval (extension)',
    make: fixture7h,
    goal: { targetXp: 500 },
    status: 'no-improvement',
    order: ['a781', 't781', 'a782', 't782'],
    // The exit note is skipped at level 11, so nothing travels to it: 10 + 6 + 290 + 6 s.
    seconds: 312,
    incumbentSeconds: 312,
  },
  {
    name: '12 position-unknown barrier',
    make: fixture12,
    goal: {},
    status: 'no-improvement',
    order: ['a1201', 't1201', 'zone', 'a1202', 't1202', 'a1203', 't1203'],
    seconds: 608,
    incumbentSeconds: 608,
  },
  { name: '13a any-of choice', make: fixture13a, goal: {}, status: 'no-improvement', order: ['a1301', 't1301', 'a1302'], seconds: 309.125, incumbentSeconds: 309.125 },
  { name: '13b minimum reputation', make: fixture13b, goal: { targetXp: 1000 }, status: 'improved', order: ['a1311', 't1311'], seconds: 106, incumbentSeconds: 132 },
  { name: '13c breadcrumb target', make: fixture13c, goal: {}, status: 'no-improvement', order: ['a1321', 't1321', 'a1322'], seconds: 309.125, incumbentSeconds: 309.125 },
  {
    name: '8b replace-quests',
    make: fixture8b,
    goal: { grindFill: 'replace-quests' },
    status: 'improved',
    order: ['a811', 't811', 'grind'],
    seconds: 356,
    incumbentSeconds: 412,
  },
];

// =============================================================================================
// Helpers

interface CoreRun {
  readonly made: Compiled;
  readonly outcome: SearchOutcome;
  readonly best: SearchSolution;
  readonly bestSteps: readonly RouteStep[];
  readonly chain: number;
}

function core(c: Pick<Case, 'make' | 'goal' | 'options'>, search: Partial<SearchOptions> = {}): CoreRun {
  const made = mustCompile(c.make(), c.goal);
  const outcome = searchToEnd(made.compiled, { ...SEARCH_DEFAULTS, ...(c.options?.beamWidth === undefined ? {} : { beamWidth: c.options.beamWidth }), ...search });
  const best = outcome.solutions[0];
  if (best === undefined) throw new Error('no solution at all (the incumbent is always feasible)');
  return { made, outcome, best, bestSteps: decode(made.compiled, best), chain: made.compiled.summary.exitChain.length };
}

const originalSection = (f: Fixture): readonly RouteStep[] => f.project.route.steps.slice(f.section.first, f.section.last + 1);

function improvedOrNot(result: OptimizationResult): Extract<OptimizationResult, { status: 'improved' | 'no-improvement' }> {
  if (result.status !== 'improved' && result.status !== 'no-improvement') throw new Error(`run ended ${result.status}: ${'reason' in result ? result.reason : ''}`);
  return result;
}

function feasible(result: SearchSolution | { readonly infeasible: string }): SearchSolution {
  if ('infeasible' in result) throw new Error(`infeasible: ${result.infeasible}`);
  return result;
}

const SLOW = 60_000;

// =============================================================================================
// Fixtures 1-8b, 12 and 13 (and the extension 7h): the core and the app

describe('§11.7 fixtures through the core (harness H, beam 16 unless stated)', () => {
  it.each(CASES)('$name', (c) => {
    const f = c.make();
    const run = core(c);
    const expectedMs = c.seconds * 1000;
    const tol = partsOf(c.order.length, run.chain);

    // The best route found: its steps, its estimate, and the engine's walk of it.
    expect(labels(run.bestSteps)).toEqual(c.order);
    expect(Math.abs(run.best.estimatedMs - expectedMs)).toBeLessThanOrEqual(tol);
    const walked = engineSection(f, run.bestSteps, run.chain);
    expect(Math.abs(walked.ms - expectedMs)).toBeLessThanOrEqual(1);

    // The incumbent is the original section, feasible and priced as the engine prices it.
    const original = originalSection(f);
    expect(labels(decode(run.made.compiled, run.outcome.incumbent))).toEqual([...labels(original), ...(c.incumbentFill === undefined ? [] : ['grind'])]);
    expect(Math.abs(run.outcome.incumbent.estimatedMs - c.incumbentSeconds * 1000)).toBeLessThanOrEqual(partsOf(original.length, run.chain));
    // The baseline's own figure is the engine's walk of the original (without a fill).
    expect(Math.abs(run.made.compiled.summary.original.sectionPlusExitMs - engineSection(f, original, run.chain).ms)).toBeLessThanOrEqual(0.001);
    if (c.incumbentFill === undefined) expect(Math.abs(run.made.compiled.summary.original.sectionPlusExitMs - c.incumbentSeconds * 1000)).toBeLessThanOrEqual(1);
    const incumbentAgain = feasible(evaluateSteps(run.made.compiled, original));
    expect(incumbentAgain.estimatedMs).toBe(run.outcome.incumbent.estimatedMs);

    if (c.status === 'improved') expect(run.best.estimatedMs).toBeLessThan(run.outcome.incumbent.estimatedMs);
    else expect(Array.from(run.best.units)).toEqual(Array.from(run.outcome.incumbent.units));

    // No new error on the engine's re-walk.
    const originalIssues = validateRoute(f.project, f.context).issues;
    expect(newErrors(originalIssues, walked.issues)).toEqual([]);
  });

  it.each(CASES.filter((c) => c.options?.beamWidth === undefined))('$name: the same answer at beam 5,040, with pruning on and off', (c) => {
    const on = core(c, { beamWidth: 5040, maxEvaluations: 10_000_000 });
    const off = core(c, { beamWidth: 5040, maxEvaluations: 10_000_000, dominance: false });
    expect(labels(on.bestSteps)).toEqual(c.order);
    expect(labels(off.bestSteps)).toEqual(c.order);
    expect(on.best.estimatedMs).toBe(off.best.estimatedMs);
    expect(on.outcome.termination).toBe('exhausted');
    expect(off.outcome.termination).toBe('exhausted');
  });
});

describe('§11.7 fixtures through the app (startOptimization, in-process worker)', () => {
  it.each(CASES)(
    '$name',
    async (c) => {
      const f = c.make();
      const result = improvedOrNot(await runApp(f, c.goal, c.options ?? {}));
      expect(result.status).toBe(c.status);
      expect(labels(result.steps)).toEqual(c.order);
      const chain = result.summary.exitChain.length;
      const tol = partsOf(c.order.length, chain);
      expect(Math.abs(result.estimate.resultMs - c.seconds * 1000)).toBeLessThanOrEqual(tol);
      expect(Math.abs(result.estimate.incumbentMs - c.incumbentSeconds * 1000)).toBeLessThanOrEqual(partsOf(originalSection(f).length, chain));
      if (c.incumbentFill === undefined) expect(Math.abs(result.estimate.originalMs - c.incumbentSeconds * 1000)).toBeLessThanOrEqual(1);
      if (c.status === 'improved') {
        expect(result.verification?.ok, JSON.stringify(result.verification?.failures)).toBe(true);
        expect(result.verification?.newIssues.filter((i) => i.severity === 'error')).toEqual([]);
        expect(Math.abs(result.estimate.engineMs - c.seconds * 1000)).toBeLessThanOrEqual(1);
      } else {
        expect(result.steps).toEqual(originalSection(f));
        expect(result.diff.ops).toEqual([]);
      }
      // The route is the prefix, the steps and the suffix.
      const steps = f.project.route.steps;
      expect(result.route).toEqual([...steps.slice(0, f.section.first), ...result.steps, ...steps.slice(f.section.last + 1)]);
    },
    SLOW,
  );
});

// =============================================================================================
// Fixture-specific checks

describe('fixture details', () => {
  it('1: the far 3,000-XP quest alone would take 606.666 s, and is not what the search keeps', () => {
    const made = mustCompile(fixture1(), { targetXp: 3000 });
    const original = originalSection(fixture1());
    const aAlone = feasible(evaluateSteps(made.compiled, [original[0] as RouteStep, original[1] as RouteStep]));
    expect(Math.abs(aAlone.estimatedMs - 606_666)).toBeLessThanOrEqual(partsOf(2, 1));
    expect(aAlone.knownGain).toBe(3000);
  });

  it('2: nearest-first (N, K1, K2) is 142.142 s, dearer than K1, K2, K3', () => {
    const f = fixture2();
    const made = mustCompile(f, { targetXp: 3000 });
    const s = originalSection(f);
    const nearest = feasible(evaluateSteps(made.compiled, s.slice(0, 6)));
    expect(Math.abs(nearest.estimatedMs - 142_142)).toBeLessThanOrEqual(partsOf(6, 1));
  });

  it('3: ratio-greedy (R, P1) is 84.000 s, dearer than P1, P2', () => {
    const f = fixture3();
    const made = mustCompile(f, { targetXp: 2000 });
    const s = originalSection(f);
    const greedy = feasible(evaluateSteps(made.compiled, s.slice(0, 4)));
    expect(Math.abs(greedy.estimatedMs - 84_000)).toBeLessThanOrEqual(partsOf(4, 1));
  });

  it('4: beam 4 ends by exhaustion; beam 1 keeps the original', () => {
    const four = core({ make: fixture4, goal: {} }, { beamWidth: 4 });
    expect(four.outcome.termination).toBe('exhausted');
    expect(labels(four.bestSteps)).toEqual(['a402', 't402', 'a401', 't401']);
    const one = core({ make: fixture4, goal: {} }, { beamWidth: 1 });
    expect(labels(one.bestSteps)).toEqual(['a401', 't401', 'a402', 't402']);
    expect(one.outcome.solutions.every((s) => s.estimatedMs >= one.outcome.incumbent.estimatedMs)).toBe(true);
  });

  it('5: any order with C before A or B is refused (VAL-4); C after both turn-ins is at level 11', () => {
    const f = fixture5();
    const made = mustCompile(f);
    const [aA, tA, aB, tB, aC, tC] = originalSection(f) as [RouteStep, RouteStep, RouteStep, RouteStep, RouteStep, RouteStep];
    for (const order of [
      [aC, tC, aA, tA, aB, tB],
      [aA, tA, aC, tC, aB, tB],
      [aB, tB, aC, tC, aA, tA],
    ]) {
      expect(evaluateSteps(made.compiled, order)).toHaveProperty('infeasible');
    }
    // The engine agrees: C, A, B would be 136.310 s but with a VAL-4 error.
    const walked = engineSection(f, [aC, tC, aA, tA, aB, tB], 1);
    expect(Math.abs(walked.ms - 136_310)).toBeLessThanOrEqual(1);
    expect(walked.issues.some((i) => i.code.startsWith('VAL004') && i.severity === 'error')).toBe(true);
    const best = feasible(evaluateSteps(made.compiled, [aB, tB, aA, tA, aC, tC]));
    expect(best.knownGain).toBe(9000);
  });

  it('6: the complete is not dropped (D-040 would carry the work without travel); kill XP 760 comes with it', () => {
    const f = fixture6();
    const made = mustCompile(f);
    const [aQ, aR, tR, cQ, tQ] = originalSection(f) as [RouteStep, RouteStep, RouteStep, RouteStep, RouteStep];
    expect(evaluateSteps(made.compiled, [aQ, tQ, aR, tR])).toHaveProperty('infeasible');
    const best = feasible(evaluateSteps(made.compiled, [aQ, cQ, tQ, aR, tR]));
    expect(best.knownGain).toBe(3760);
    expect(made.compiled.summary.targetXp).toBe(3760);
  });

  it('7a: at the section end X is in the log, accepted by the route', () => {
    const f = fixture7a();
    const run = core({ make: fixture7a, goal: {} });
    const walked = engineSection(f, run.bestSteps, run.chain, { endState: true });
    const entry = walked.endState?.questLog.get(questId(701));
    expect(entry?.routeAccepted).toBe(true);
    expect(entry?.objectives.every((o) => o === 'open')).toBe(true);
  });

  it('7b: N alone (26 s) is refused, because the suffix accept of F needs P (VAL-8)', () => {
    const f = fixture7b();
    const made = mustCompile(f, { targetXp: 1000 });
    const s = originalSection(f);
    expect(made.compiled.summary.obligatory).toContain(questId(711));
    expect(evaluateSteps(made.compiled, s.slice(2, 4))).toHaveProperty('infeasible');
    const walked = engineSection(f, s.slice(2, 4), 1);
    expect(Math.abs(walked.ms - 26_000)).toBeLessThanOrEqual(1);
  });

  it("7c: dropping only L's turn-in (13 s) is refused: L would stay in the log", () => {
    const f = fixture7c();
    const made = mustCompile(f, { targetXp: 1000 });
    const [aL, aM, tM] = originalSection(f) as [RouteStep, RouteStep, RouteStep, RouteStep];
    expect(evaluateSteps(made.compiled, [aL, aM, tM])).toHaveProperty('infeasible');
  });

  it('7d: the train stays with T, and riding at the section end is tier 1', () => {
    const f = fixture7d();
    const run = core({ make: fixture7d, goal: {} });
    expect(run.made.compiled.summary.obligatory).toContain(questId(731));
    const walked = engineSection(f, run.bestSteps, run.chain, { endState: true });
    expect(walked.endState?.riding.trained).toBe(1);
  });

  it('7e: the anchor chain L1 < C3 < L2 holds in every solution kept, and the diff moves only A and B', async () => {
    const f = fixture7e();
    const run = core({ make: fixture7e, goal: {} }, { beamWidth: 5040, maxEvaluations: 10_000_000 });
    for (const solution of run.outcome.solutions) {
      const notes = labels(decode(run.made.compiled, solution)).filter((l) => l.startsWith('n:'));
      expect(notes).toEqual(['n:L1', 'n:C3', 'n:L2']);
    }
    const result = improvedOrNot(await runApp(f, {}));
    const s = originalSection(f);
    expect(result.diff.ops.every((op) => op.kind === 'move')).toBe(true);
    const moved = result.diff.ops.flatMap((op) => (op.kind === 'move' ? [label(s.find((step) => step.id === op.stepId) as RouteStep)] : []));
    expect(moved.length).toBeGreaterThan(0);
    // Only A's and B's steps are reported as moved; no anchor is.
    for (const what of moved) expect(['a741', 't741', 'a742', 't742']).toContain(what);
  });

  it('7f: the null-XP custom quest survives both variants and is listed as unknown; K, A is refused in v2', async () => {
    for (const variant of ['v1', 'v2'] as const) {
      const f = fixture7f(variant);
      const made = mustCompile(f);
      expect(made.compiled.summary.unknownXp).toEqual([questId(-751)]);
      expect(made.compiled.summary.obligatory).toContain(questId(-751));
      const result = improvedOrNot(await runApp(f, {}));
      expect(result.unknowns.quests).toEqual([questId(-751)]);
      expect(result.steps.filter((step) => label(step).endsWith('-751')).length).toBe(2);
      if (variant === 'v2') {
        const [aA, tA, aK, tK] = originalSection(f) as [RouteStep, RouteStep, RouteStep, RouteStep];
        expect(evaluateSteps(made.compiled, [aK, tK, aA, tA])).toHaveProperty('infeasible');
      }
    }
    // v1: dropping K would save 206 s (A alone is 126.000 s), and is refused.
    const v1 = fixture7f('v1');
    const made = mustCompile(v1);
    const s = originalSection(v1);
    expect(evaluateSteps(made.compiled, s.slice(2, 4))).toHaveProperty('infeasible');
  }, SLOW);

  it('8: the fill is a new unlocated grind to level 10 with 2,500 XP into it: 6 kills, 570 XP, 180 s', async () => {
    const run = core({ make: fixture8, goal: { targetXp: 2500 } });
    expect(run.best.fillXp).toBe(570);
    expect(run.best.fillMs).toBe(180_000);
    expect(run.best.knownGain).toBe(2000);
    const result = improvedOrNot(await runApp(fixture8(), { targetXp: 2500 }));
    const grind = result.steps.at(-1);
    expect(grind?.kind).toBe('grind');
    if (grind?.kind !== 'grind') return;
    expect(grind.until).toEqual({ kind: 'level', level: 10, offset: { kind: 'xpInto', xp: 2500 } });
    expect(grind.location).toBeNull();
    expect(grind.mobLevel).toBeNull();
    expect(grind.xpPerHour).toBeNull();
    expect(grind.origin.source).toBe('optimizer');
  }, SLOW);

  it("8b: 'replace-quests' fills 11 kills (1,045 XP, 330 s) in F's place, and the diff removes F", async () => {
    const run = core({ make: fixture8b, goal: { grindFill: 'replace-quests' } });
    expect(run.best.fillXp).toBe(1045);
    expect(run.best.fillMs).toBe(330_000);
    const f = fixture8b();
    const result = improvedOrNot(await runApp(f, { grindFill: 'replace-quests' }));
    const s = originalSection(f);
    const removed = result.diff.ops.filter((op) => op.kind === 'remove').map((op) => (op.kind === 'remove' ? op.stepId : null));
    expect(removed).toEqual([s[2]?.id, s[3]?.id]);
    // 'shortfall' never lets the fill replace F: F, A ties at 412 s and the original order stays.
    const short = core({ make: fixture8b, goal: { grindFill: 'shortfall' } });
    expect(labels(short.bestSteps)).toEqual(['a811', 't811', 'a812', 't812']);
    const [aA, tA, aF, tF] = s as [RouteStep, RouteStep, RouteStep, RouteStep];
    const swapped = feasible(evaluateSteps(short.made.compiled, [aF, tF, aA, tA]));
    expect(swapped.estimatedMs).toBe(short.outcome.incumbent.estimatedMs);
  }, SLOW);
});

describe('fixture details: the anchors, barriers and availability (7e, 12, 13)', () => {
  it('7e: a brute force over every order that keeps the anchor chain confirms L1, C3, L2, B, A; the unconstrained best is refused', () => {
    const f = fixture7e();
    const [aA, tA, l1, c3, aB, tB, l2] = originalSection(f) as [RouteStep, RouteStep, RouteStep, RouteStep, RouteStep, RouteStep, RouteStep];
    const made = mustCompile(f);
    let best: { ms: number; order: readonly RouteStep[] } | null = null;
    for (const order of interleavings([[aA, tA], [aB, tB], [l1, c3, l2]])) {
      const walked = engineSection(f, order, 1);
      if (best === null || walked.ms < best.ms) best = { ms: walked.ms, order };
      // The optimiser's price of every such order agrees with the engine.
      const priced = feasible(evaluateSteps(made.compiled, order));
      expect(Math.abs(priced.estimatedMs - walked.ms)).toBeLessThanOrEqual(partsOf(7, 1));
    }
    expect(labels(best?.order ?? [])).toEqual(['n:L1', 'n:C3', 'n:L2', 'a742', 't742', 'a741', 't741']);
    expect(Math.abs((best?.ms ?? 0) - 205_285)).toBeLessThanOrEqual(1);
    expect(evaluateSteps(made.compiled, [c3, l2, aB, tB, aA, tA, l1])).toHaveProperty('infeasible');
  });

  it('7h: N alone (26 s) would turn the skipped exit note active, and is refused', () => {
    const f = fixture7h();
    const made = mustCompile(f, { targetXp: 500 });
    const [aN, tN] = originalSection(f) as [RouteStep, RouteStep, RouteStep, RouteStep];
    expect(evaluateSteps(made.compiled, [aN, tN])).toHaveProperty('infeasible');
    const walked = engineSection(f, [aN, tN], 1);
    expect(walked.project.route.steps.length).toBe(3);
    const original = validateRoute(f.project, f.context).walk.records.at(-1)?.estimate.active;
    const alone = validateRoute(walked.project, f.context).walk.records.at(-1)?.estimate.active;
    expect(original).toBe(false);
    expect(alone).toBe(true);
  });

  it('12: the barrier keeps its block; F inside the quest B ties at 608 s, F before the block costs 628 s; two unknown parts', () => {
    const f = fixture12();
    const made = mustCompile(f);
    const [aA, tA, z, aB, tB, aF, tF] = originalSection(f) as [RouteStep, RouteStep, RouteStep, RouteStep, RouteStep, RouteStep, RouteStep];
    expect(made.compiled.summary.barriers.length).toBeGreaterThan(0);
    const incumbent = feasible(evaluateSteps(made.compiled, [aA, tA, z, aB, tB, aF, tF]));
    expect(incumbent.unknownParts).toBe(2);
    const inside = feasible(evaluateSteps(made.compiled, [aA, tA, z, aB, aF, tF, tB]));
    expect(inside.estimatedMs).toBe(incumbent.estimatedMs);
    const before = feasible(evaluateSteps(made.compiled, [aF, tF, aA, tA, z, aB, tB]));
    expect(Math.abs(before.estimatedMs - 628_000)).toBeLessThanOrEqual(partsOf(7, 1));
    // The block [turn in A, Z, accept B] is one unit: splitting it asks for that unit twice, which is refused.
    const units = Array.from(unitsOf(made.compiled, [aA, tA, aF, tF, z, aB, tB]));
    expect(new Set(units).size).toBeLessThan(units.length);
    expect(evaluateSteps(made.compiled, [aA, tA, aF, tF, z, aB, tB])).toHaveProperty('infeasible');
  });

  it('13a: S before G would choose 1303 at level 10, and is refused', () => {
    const f = fixture13a();
    const made = mustCompile(f);
    const [aG, tG, s] = originalSection(f) as [RouteStep, RouteStep, RouteStep];
    expect(evaluateSteps(made.compiled, [s, aG, tG])).toHaveProperty('infeasible');
    const walked = engineSection(f, [s, aG, tG], 1);
    expect(Math.abs(walked.ms - 119_125)).toBeLessThanOrEqual(1);
  });

  it('13b: M alone (26 s) would newly block M (VAL-16), and is refused', () => {
    const f = fixture13b();
    const made = mustCompile(f, { targetXp: 1000 });
    const [, , aM, tM] = originalSection(f) as [RouteStep, RouteStep, RouteStep, RouteStep];
    expect(evaluateSteps(made.compiled, [aM, tM])).toHaveProperty('infeasible');
    const walked = engineSection(f, [aM, tM], 1);
    expect(Math.abs(walked.ms - 26_000)).toBeLessThanOrEqual(1);
    expect(walked.issues.some((i) => i.code.startsWith('VAL016') && i.severity === 'error')).toBe(true);
  });

  it("13c: accepting B before G lowers B's availability to a doubt, and is refused", () => {
    const f = fixture13c();
    const made = mustCompile(f);
    const [aG, tG, aB] = originalSection(f) as [RouteStep, RouteStep, RouteStep];
    expect(evaluateSteps(made.compiled, [aB, aG, tG])).toHaveProperty('infeasible');
    const walked = engineSection(f, [aB, aG, tG], 1);
    expect(Math.abs(walked.ms - 119_125)).toBeLessThanOrEqual(1);
    expect(walked.issues.some((i) => i.code === 'VAL013-breadcrumb-target-unavailable')).toBe(true);
  });
});

// =============================================================================================
// Fixture 9: the brute-force oracle

describe.each(['uniform', 'coarse', 'radius'] as const)('fixture 9: brute-force oracle over every order of at most 7 units (%s points)', (variant) => {
  const SEEDS = Array.from({ length: 40 }, (_, k) => k + 1);

  it.each(SEEDS)(
    'seed %i',
    (seed) => {
      const instance = oracleInstance(seed, variant);
      expect(instance.units).toBeLessThanOrEqual(7);
      const truth = oracle(instance);
      const f = instance.fixture;
      const results = new Map<string, { best: SearchSolution; steps: readonly RouteStep[]; outcome: SearchOutcome; chain: number }>();
      for (const [key, options] of [
        ['5040', { beamWidth: 5040 }],
        ['5040-off', { beamWidth: 5040, dominance: false }],
        ['1', { beamWidth: 1 }],
        ['4', { beamWidth: 4 }],
        ['16', { beamWidth: 16 }],
        ['16-off', { beamWidth: 16, dominance: false }],
      ] as const) {
        const made = mustCompile(f, instance.goal);
        const outcome = searchToEnd(made.compiled, { ...options, maxEvaluations: 10_000_000 });
        const best = outcome.solutions[0];
        if (best === undefined) throw new Error('no solution');
        results.set(key, { best, steps: decode(made.compiled, best), outcome, chain: made.compiled.summary.exitChain.length });
      }
      const parts = partsOf(truth.best.length, 1);
      const originalIssues = validateRoute(f.project, f.context).issues;
      const context = `seed ${String(seed)}: oracle ${truth.minMs.toFixed(3)} ms over ${String(truth.orders)} orders, best ${labels(truth.best).join(' ')}`;
      for (const [key, r] of results) {
        // Never beats the optimum (beyond §6.3's rounding).
        expect(r.best.estimatedMs, `${context}; beam ${key} estimate`).toBeGreaterThanOrEqual(truth.minMs - parts);
        const walked = engineSection(f, r.steps, r.chain);
        expect(walked.ms, `${context}; beam ${key} (${labels(r.steps).join(' ')}) engine`).toBeGreaterThanOrEqual(truth.minMs - 0.001);
        expect(newErrors(originalIssues, walked.issues), `${context}; beam ${key}`).toEqual([]);
        // Its estimate is the engine's figure for its own order.
        expect(Math.abs(r.best.estimatedMs - walked.ms), `${context}; beam ${key} parity`).toBeLessThanOrEqual(partsOf(r.steps.length, r.chain));
      }
      for (const key of ['5040', '5040-off']) {
        const r = results.get(key);
        if (r === undefined) throw new Error(key);
        // At sufficient width the beam finds the oracle's minimum, with pruning on and off. This holds
        // for these instances, not in general: a node that closes with its target met is not
        // expanded, so a detour through an optional unit whose arrival radius shortens the engine's
        // move (SIMULATION TIME-2) is never taken (review COR-04).
        expect(r.outcome.termination, `${context}; beam ${key}`).toBe('exhausted');
        expect(Math.abs(r.best.estimatedMs - truth.minMs), `${context}; beam ${key} (${labels(r.steps).join(' ')})`).toBeLessThanOrEqual(parts);
      }
      expect(results.get('5040')?.best.estimatedMs).toBe(results.get('5040-off')?.best.estimatedMs);
    },
    SLOW,
  );
});

describe('fixture 9 through the app (an extension): startOptimization at beam 5,040 on the 40 uniform instances', () => {
  it(
    'improves exactly when the oracle beats the incumbent, to the optimum, and verification accepts it',
    async () => {
      const failures: string[] = [];
      for (let seed = 1; seed <= 40; seed += 1) {
        const instance = oracleInstance(seed);
        const truth = oracle(instance);
        const f = instance.fixture;
        const original = originalSection(f);
        const needsFill = instance.quests.reduce((sum, q) => sum + q.xp + q.killXp, 0) < instance.target;
        const incumbentMs = engineSection(f, needsFill ? [...original, fillStep(sequentialIdSource(1), instance.target)] : original, 1).ms;
        const result = await runApp(f, instance.goal, { beamWidth: 5040, maxEvaluations: 10_000_000 });
        const where = `seed ${String(seed)} (target ${String(instance.goal.targetXp)}${needsFill ? ', fill' : ''})`;
        if (result.status !== 'improved' && result.status !== 'no-improvement') {
          failures.push(`${where}: ${result.status} ${'reason' in result ? result.reason : ''}`);
          continue;
        }
        const shouldImprove = truth.minMs < incumbentMs - 1;
        if (shouldImprove !== (result.status === 'improved')) {
          const why = result.rejected.flatMap((r) => r.failures.map((x) => `${x.rule}: ${x.detail}`)).join('; ');
          failures.push(`${where}: ${result.status}, oracle ${truth.minMs.toFixed(0)} ms against the incumbent's ${incumbentMs.toFixed(0)} ms${why === '' ? '' : ` (rejected: ${why})`}`);
          continue;
        }
        if (result.status === 'improved') {
          const parts = partsOf(result.steps.length, 1);
          if (Math.abs(result.estimate.engineMs - truth.minMs) > 2 * parts) failures.push(`${where}: engine ${result.estimate.engineMs.toFixed(0)} ms, oracle ${truth.minMs.toFixed(0)} ms`);
          if (result.verification?.ok !== true) failures.push(`${where}: verification ${JSON.stringify(result.verification?.failures)}`);
        }
      }
      expect(failures).toEqual([]);
    },
    SLOW,
  );
});

describe('fixture 9 determinism (an extension): runs that end by exhaustion do not depend on the slices', () => {
  it.each([13, 15, 23, 39])('uniform seed %i', (seed) => {
    const instance = oracleInstance(seed);
    for (const beamWidth of [4, 16, 5040]) {
      const runs = [1, 7, 1_000_000].map((slice) => normal(searchToEnd(mustCompile(instance.fixture, instance.goal).compiled, { beamWidth, maxEvaluations: 10_000_000 }, slice)));
      const [reference, ...others] = runs as [Normal, ...Normal[]];
      expect(reference.termination).toBe('exhausted');
      for (const other of others) expect(other).toEqual(reference);
    }
  });
});

// =============================================================================================
// Fixture 10: cancellation, the evaluation budget, determinism and tie-breaking

type Normal = ReturnType<typeof normal>;
const solutionOf = (s: SearchSolution) => ({ ...s, units: Array.from(s.units) });
function normal(outcome: SearchOutcome) {
  return { termination: outcome.termination, incumbent: solutionOf(outcome.incumbent), solutions: outcome.solutions.map(solutionOf), stats: outcome.stats };
}

describe('fixture 10: cancellation, budget, determinism, tie-breaking', () => {
  it(
    '10a: a cancel after the first progress ends the run cancelled, with evaluations, within two slices',
    async () => {
      const f = grid40();
      const made = mustCompile(f);
      let cancelledAt: number | null = null;
      let advances = 0;
      const wrapStepper = (stepper: Stepper): Stepper => ({
        advance(n) {
          advances += 1;
          return stepper.advance(n);
        },
        finish: (t) => stepper.finish(t),
      });
      const { optimizer } = inProcessOptimizer({ wrapStepper });
      const options: OptimizationOptions = { beamWidth: 256, maxEvaluations: 100_000_000, maxMillis: null, divergencePenalty: 0 };
      const run = optimizer.optimize(requestOf(f, 1), options, { analysis: made.analysis, baseline: made.baseline.walk }, sequentialIdSource(1));
      run.onProgress((p) => {
        if (cancelledAt === null && p.phase === 'searching' && p.evaluations > 0) {
          cancelledAt = advances;
          run.cancel();
        }
      });
      const result = await run.result;
      expect(result.status).toBe('cancelled');
      expect(result.stats.evaluations).toBeGreaterThan(0);
      expect(cancelledAt).not.toBeNull();
      expect(advances - (cancelledAt ?? 0)).toBeLessThanOrEqual(2);
      optimizer.dispose();
    },
    SLOW,
  );

  it(
    '10a: a worker that ignores the cancel is terminated after the grace period, and the next run gets a new worker',
    async () => {
      const f = grid40();
      const made = mustCompile(f);
      const timers = new ManualOptimizerTimers();
      // The stuck worker's stepper is halted once the test has seen it terminated, so its host stops
      // spinning in the background; a later run's stepper is not.
      const halts: (() => void)[] = [];
      const wrapStepper = (stepper: Stepper): Stepper => {
        let halted = false;
        halts.push(() => {
          halted = true;
        });
        return {
          advance: (n) => (halted ? { done: true, outcome: stepper.finish('cancelled') } : stepper.advance(n)),
          finish: (t) => stepper.finish(t),
        };
      };
      const { optimizer, workers } = inProcessOptimizer({ ignoreCancel: true, cancelGraceMs: 1000, timers, wrapStepper });
      const options: OptimizationOptions = { beamWidth: 256, maxEvaluations: 100_000_000, maxMillis: null, divergencePenalty: 0 };
      const context = { analysis: made.analysis, baseline: made.baseline.walk };
      const run = optimizer.optimize(requestOf(f, 1), options, context, sequentialIdSource(1));
      let searching = false;
      run.onProgress((p) => {
        if (p.phase === 'searching' && p.evaluations > 0) searching = true;
      });
      await until(() => searching);
      run.cancel();
      await until(() => timers.pending.length > 0);
      expect(timers.pending).toEqual([1000]);
      timers.fireAll();
      const result = await run.result;
      expect(result.status).toBe('cancelled');
      expect(workers[0]?.terminated()).toBe(true);
      for (const halt of halts) halt();
      const again = optimizer.optimize(requestOf(f, 1), { ...options, maxEvaluations: 2_000 }, context, sequentialIdSource(1));
      const second = await again.result;
      expect(second.status).toBe('searched');
      expect(workers.length).toBe(2);
      optimizer.dispose();
    },
    SLOW,
  );

  it(
    '10b: the evaluation budget ends the run reproducibly, whatever the slices, the hash and the host',
    async () => {
      const f = grid40();
      const search: Partial<SearchOptions> = { beamWidth: 64, maxEvaluations: 50_000 };
      const runs: Normal[] = [];
      for (const slice of [1, 7, 1000, 1_000_000]) runs.push(normal(searchToEnd(mustCompile(f).compiled, search, slice)));
      runs.push(normal(searchToEnd(mustCompile(f).compiled, search, 1_000_000)));
      runs.push(normal(searchToEnd(mustCompile(f).compiled, { ...search, testHash: 'constant' }, 1000)));
      const [reference, ...others] = runs as [Normal, ...Normal[]];
      expect(reference.termination).toBe('budget');
      expect(reference.stats.evaluations).toBeGreaterThanOrEqual(50_000);
      for (const other of others) expect(other).toEqual(reference);

      // The public optimiser in its (in-process) worker gives the same run.
      const made = mustCompile(f);
      const { optimizer } = inProcessOptimizer();
      const options: OptimizationOptions = { beamWidth: 64, maxEvaluations: 50_000, maxMillis: null, divergencePenalty: 0 };
      const searched = await optimizer.optimize(requestOf(f, 1), options, { analysis: made.analysis, baseline: made.baseline.walk }, sequentialIdSource(1)).result;
      optimizer.dispose();
      if (searched.status !== 'searched') throw new Error(`not searched: ${searched.status}`);
      expect(searched.termination).toBe('budget');
      expect(searched.reproducible).toBe(true);
      expect(searched.stats).toEqual(reference.stats);
      expect(solutionOf(searched.incumbent)).toEqual(reference.incumbent);
      const better = reference.solutions.filter((s) => s.estimatedMs < reference.incumbent.estimatedMs);
      expect(searched.candidates.map((c) => solutionOf(c.solution))).toEqual(better);
    },
    SLOW,
  );

  it('10c: fixture 1 with E at the start: B, C and C, B cost the same integer ms, and B, C wins in every run', () => {
    const make = () => fixture1([0, 0]);
    const f = make();
    const made = mustCompile(f, { targetXp: 3000 });
    const [, , aB, tB, aC, tC] = originalSection(f) as [RouteStep, RouteStep, RouteStep, RouteStep, RouteStep, RouteStep];
    const bc = feasible(evaluateSteps(made.compiled, [aB, tB, aC, tC]));
    const cb = feasible(evaluateSteps(made.compiled, [aC, tC, aB, tB]));
    expect(bc.estimatedMs).toBe(cb.estimatedMs);
    expect(Math.abs(bc.estimatedMs - 46_142)).toBeLessThanOrEqual(partsOf(4, 1));
    for (const dominance of [true, false]) {
      for (const beamWidth of [1, 4, 16, 5040]) {
        const run = core({ make, goal: { targetXp: 3000 } }, { beamWidth, dominance, maxEvaluations: 10_000_000 });
        expect(labels(run.bestSteps), `dominance ${String(dominance)}, beam ${String(beamWidth)}`).toEqual(['a102', 't102', 'a103', 't103']);
      }
    }
    for (const slice of [1, 7, 1000, 1_000_000]) {
      for (let repeat = 0; repeat < 2; repeat += 1) {
        const again = mustCompile(make(), { targetXp: 3000 });
        const outcome = searchToEnd(again.compiled, {}, slice);
        const best = outcome.solutions[0];
        if (best === undefined) throw new Error('no solution');
        expect(labels(decode(again.compiled, best)), `slice ${String(slice)}`).toEqual(['a102', 't102', 'a103', 't103']);
      }
    }
  }, SLOW);
});

// =============================================================================================
// Fixture 11: parity with the engine

describe('fixture 11: parity (the estimate against the engine walk of the resulting route)', () => {
  it.each(CASES)('$name: every candidate and the incumbent, through the core', (c) => {
    const f = c.make();
    const run = core(c);
    for (const solution of [run.outcome.incumbent, ...run.outcome.solutions]) {
      const steps = decode(run.made.compiled, solution);
      const walked = engineSection(f, steps, run.chain);
      const parts = partsOf(steps.length, run.chain);
      const diff = Math.abs(solution.estimatedMs - walked.ms);
      expect(diff, `${labels(steps).join(' ')}: estimate ${String(solution.estimatedMs)}, engine ${walked.ms.toFixed(3)}`).toBeLessThanOrEqual(0.01 * walked.ms);
      expect(diff, `${labels(steps).join(' ')}: estimate ${String(solution.estimatedMs)}, engine ${walked.ms.toFixed(3)}`).toBeLessThanOrEqual(parityBound(walked.ms, parts));
      expect(diff).toBeLessThanOrEqual(parts);
    }
  });

  it.each(CASES)(
    '$name: the proposal through the app',
    async (c) => {
      const f = c.make();
      const result = improvedOrNot(await runApp(f, c.goal, c.options ?? {}));
      const chain = result.summary.exitChain.length;
      // An engine walk of the resulting whole route, independent of the app's verification.
      const steps = result.steps;
      const walked = engineSection(f, steps, chain);
      expect(Math.abs(walked.ms - result.estimate.engineMs)).toBeLessThanOrEqual(0.001);
      const diff = Math.abs(result.estimate.resultMs - walked.ms);
      expect(diff).toBeLessThanOrEqual(0.01 * walked.ms);
      expect(diff).toBeLessThanOrEqual(partsOf(steps.length, chain));
      // The incumbent: the original (with the fill the target needs) against its engine walk.
      const original = originalSection(f);
      const incumbentEngineMs =
        c.incumbentFill === undefined ? result.estimate.originalMs : engineSection(f, [...original, fillStep(sequentialIdSource(1), c.incumbentFill)], chain).ms;
      const incumbentDiff = Math.abs(result.estimate.incumbentMs - incumbentEngineMs);
      expect(incumbentDiff).toBeLessThanOrEqual(0.01 * incumbentEngineMs);
      expect(incumbentDiff).toBeLessThanOrEqual(partsOf(original.length + 1, chain));
      if (result.verification !== null) {
        expect(result.verification.parity).not.toBeNull();
        expect(result.verification.failures.filter((failure) => failure.rule === 'parity')).toEqual([]);
      }
    },
    SLOW,
  );
});

// =============================================================================================
// Real data (review PAR-01)

describe('real data: a move between world maps at the start of the exit chain (review PAR-01)', () => {
  const NOW = '2026-09-27T12:00:00.000Z';
  let workspace: Workspace;

  beforeAll(async () => {
    const server = fakeServer(publicSite());
    workspace = await loadWorkspace({ fetch: server.fetch, baseUrl: './', sha256: nodeSha256, nowIso: NOW, now: () => performance.now(), yieldToRender: () => Promise.resolve() });
  }, 60_000);

  /** An RXP fixture imported as a new project (boats and zeppelins written as notes: the engine's SIM-4 moves). */
  function imported(file: string) {
    const input = readFileSync(join(REPO_ROOT, 'tests/fixtures/rxp', file), 'utf8');
    const view = workspace.data.view({ faction: workspace.project.character.faction, class: workspace.project.character.class, customQuests: [], questOverrides: {} });
    const ctx = rxpImportContext('new-project', { dataset: view, data: workspace.data, geometry: workspace.geometry.geometry });
    const made = rxpImportProject({ input, fileName: file, frame: 'forever' }, { guides: 'all', unknownQuests: 'placeholder' }, ctx, { identity: workspace.data.identity, ids: sequentialIdSource(1), nowIso: NOW });
    if (made === null) throw new Error(`the import of ${file} was refused`);
    return made.project;
  }

  // Each section ends just before a suffix step that the engine walks between world maps. The
  // original is feasible, so compile may not report that the model disagrees with the engine.
  it.each([
    ['04-edge-cases-crlf.txt', 6, 6],
    ['04-edge-cases-crlf.txt', 0, 6],
    ['06-lowering-and-export.txt', 0, 1],
    ['06-lowering-and-export.txt', 3, 3],
  ] as const)(
    '%s [%i..%i] is optimised, not failed',
    async (file, first, last) => {
      const project = imported(file);
      const steps = project.route.steps;
      const firstStep = steps[first];
      const lastStep = steps[last];
      if (firstStep === undefined || lastStep === undefined) throw new Error('the route is too short');
      const store = createEditorStore({ project, ids: sequentialIdSource(700_000), clock: fixedClock(NOW) });
      const revision = store.getState().revision;
      const host = createOptimizationHost({ project, revision, data: workspace.data, geometry: workspace.geometry.geometry, navigation: { kind: 'unavailable', reason: 'test' } });
      const { optimizer } = inProcessOptimizer();
      try {
        const result = await startOptimization(
          { host, store, optimizer, ids: sequentialIdSource(600_000) },
          {
            project,
            baseRevision: revision,
            section: { firstStepId: firstStep.id, lastStepId: lastStep.id },
            scope: { allowNewQuests: false, zones: null, levelWindow: null },
            goal: { kind: 'min-time', targetXp: 'keep-original', grindFill: 'shortfall' },
          },
          { beamWidth: 64, maxEvaluations: 50_000 },
        ).result;
        expect('reason' in result ? `${result.status}: ${result.reason}` : result.status).toMatch(/^(improved|no-improvement)$/);
      } finally {
        optimizer.dispose();
      }
    },
    SLOW,
  );
});
