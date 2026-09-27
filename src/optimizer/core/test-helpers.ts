import type { Truth } from '../../domain/conditions';
import type { QuestRecord } from '../../domain/dataset';
import { type IdSource, type QuestId, questId, sequentialIdSource } from '../../domain/ids';
import type { Location } from '../../domain/points';
import type { CharacterProfile, RouteProfile } from '../../domain/project';
import type { AcceptStep, CompleteStep, GrindStep, HearthStep, NoteStep, RouteGroup, RouteStep, TrainStep, TravelStep, TurnInStep } from '../../domain/route';
import { routeGroup } from '../../domain/route-ops';
import { makeAcceptStep, makeCompleteStep, makeGrindStep, makeHearthStep, makeNoteStep, makeTrainStep, makeTravelStep, makeTurnInStep } from '../../domain/step-factory';
import { evaluatePredicate } from '../../engine/conditions';
import { createPlaces } from '../../engine/places';
import { cloneState, createInitialState } from '../../engine/state';
import { runStep, stepActivity } from '../../engine/steps';
import type { AcceptPolicy, EngineContext, ReadonlyCharacterState, RouteWalk, WalkProject, WalkVisitor } from '../../engine/types';
import { at, fixtureContext, type FixtureContextOptions, fixtureDataset, type FixtureData, fixtureProject, questRecord } from '../../engine/test-helpers';
import { createRouteWalker } from '../../engine/walker';
import { cumulativeXp, xpCurveOf } from '../../sim/xp';
import { decodeSolution, type DecodedSection } from './decode';
import { createTransitions } from './evaluate';
import { copyMemo, replayEnv } from './replay';
import { analyseSection } from './section';
import { compileProblem } from './problem';
import { createSearch } from './search';
import type { NodeState } from './transitions';
import type {
  AvailabilityDependencies,
  CompiledProblem,
  CompileAvailability,
  CompileFailure,
  CompileInput,
  OptimizationGoal,
  SearchOptions,
  SearchOutcome,
  SearchProblem,
  SectionWalk,
  StepProbe,
} from './types';
import { DEFAULT_SEARCH_OPTIONS } from './types';

/**
 * Test support for `optimizer/core` (not imported by application code): the compile input the app
 * builds (docs/research/optimizer-m7.md §5.1, §9) made with the engine alone. Availability is a
 * small stand-in for the validator's (`optimizer/core` may import `validate` as types only): the
 * checks the fixtures exercise (VAL-1, 2, 4, 5, 8, 10-14, 16, 18, 20), with the validator's codes
 * and severities. A caller with the real validator injects its `AcceptChecks` instead.
 */

// =============================================================================================
// Availability stand-in

const DOUBT: ReadonlySet<string> = new Set([
  'VAL004-min-level-uncertain',
  'VAL005-max-level-uncertain',
  'VAL008-prequest-single-unverifiable',
  'VAL009-prequest-group-unverifiable',
  'VAL010-parent-not-active-unverifiable',
  'VAL013-breadcrumb-target-unavailable',
  'VAL015-skill-unverifiable',
  'VAL016-reputation-unverifiable',
  'VAL017-spell-unverifiable',
  'VAL018-availability-window-unverifiable',
  'VAL019-specialization-unverifiable',
  'VAL021-previous-chain-active',
  'DATA002-unknown-quest',
]);
const INFO: ReadonlySet<string> = new Set(['VAL015-skill-unverifiable', 'VAL016-reputation-unverifiable', 'VAL017-spell-unverifiable', 'VAL019-specialization-unverifiable', 'VAL022-needs-event']);

/** The validator's `acceptTruth` over codes: `false` on an error, `unknown` on a doubt. */
export function harnessTruth(codes: readonly string[]): Truth {
  let truth: Truth = 'true';
  for (const code of codes) {
    if (INFO.has(code) && !DOUBT.has(code)) continue;
    if (!DOUBT.has(code)) return 'false';
    truth = 'unknown';
  }
  return truth;
}

export type AcceptFindings = (questId: QuestId, state: ReadonlyCharacterState) => readonly string[];

/** A subset of `createAcceptChecks().check` (validate/availability.ts), returning codes. */
export function harnessFindings(project: WalkProject, context: Pick<EngineContext, 'dataset' | 'rules'>): AcceptFindings {
  const capacity = context.rules.values.questLogCapacity.value;
  const unknownHistory = project.character.priorHistory === 'unknown';
  const untouched = (state: ReadonlyCharacterState, q: QuestId): boolean =>
    !state.questLog.has(q) && !state.completed.has(q) && !state.abandoned.has(q) && !state.acceptedInRoute.has(q);
  const takenOrDone = (state: ReadonlyCharacterState, q: QuestId): boolean => state.completed.has(q) || state.questLog.has(q);
  const check = (questId: QuestId, state: ReadonlyCharacterState, depth: number): string[] => {
    const codes: string[] = [];
    const inLog = state.questLog.has(questId);
    const logFull = !inLog && state.questLog.size >= capacity;
    const record = context.dataset.quest(questId);
    if (inLog) codes.push('VAL001-already-in-log');
    if (record === undefined) {
      if (logFull) codes.push('VAL020-quest-log-full');
      if (depth === 0) codes.push('DATA002-unknown-quest');
      return codes;
    }
    const pre = record.prerequisites;
    if (state.completed.has(questId) && !record.flags.repeatable) codes.push('VAL002-already-completed');
    let parentActive = false;
    if (pre.parentQuest !== null) {
      parentActive = state.questLog.has(pre.parentQuest);
      if (!parentActive) codes.push(unknownHistory && untouched(state, pre.parentQuest) ? 'VAL010-parent-not-active-unverifiable' : 'VAL010-parent-not-active');
    }
    const uncertain = state.unknownXpEvents > 0;
    if (!parentActive) {
      if (record.minLevel !== null && state.level < record.minLevel) codes.push(uncertain ? 'VAL004-min-level-uncertain' : 'VAL004-min-level');
      if (record.maxLevel !== null && record.maxLevel > 0) {
        if (state.level > record.maxLevel) codes.push('VAL005-max-level');
        else if (uncertain) codes.push('VAL005-max-level-uncertain');
      }
    }
    if (pre.preQuestSingle.length > 0 && !pre.preQuestSingle.some((id) => state.completed.has(id))) {
      codes.push(unknownHistory && pre.preQuestSingle.some((id) => untouched(state, id)) ? 'VAL008-prequest-single-unverifiable' : 'VAL008-prequest-single');
    }
    if (pre.nextQuestInChain !== null && takenOrDone(state, pre.nextQuestInChain)) codes.push('VAL011-later-chain-step');
    if (pre.exclusiveTo.some((id) => id !== questId && takenOrDone(state, id))) codes.push('VAL012-exclusive');
    if (pre.breadcrumbForQuestId !== null) {
      const target = pre.breadcrumbForQuestId;
      if (takenOrDone(state, target)) codes.push('VAL013-breadcrumb-target-taken');
      else if (depth === 0 && check(target, state, 1).some((code) => harnessTruth([code]) === 'false')) codes.push('VAL013-breadcrumb-target-unavailable');
    }
    if (pre.breadcrumbs.some((id) => state.questLog.has(id))) codes.push('VAL014-breadcrumb-active');
    const req = record.requirements;
    for (const requirement of [req.minReputation, req.maxReputation]) {
      if (requirement === null) continue;
      const base = project.character.reputation?.[String(requirement.factionId)];
      if (base === undefined) {
        codes.push('VAL016-reputation-unverifiable');
        continue;
      }
      const value = base + (state.reputationDelta.get(requirement.factionId) ?? 0);
      if ((requirement === req.minReputation && value < requirement.value) || (requirement === req.maxReputation && value >= requirement.value)) codes.push('VAL016-reputation');
    }
    if (pre.availableUntilCompleted !== null && state.completed.has(pre.availableUntilCompleted)) codes.push('VAL018-availability-window');
    if (pre.availableStartingWith !== null && !takenOrDone(state, pre.availableStartingWith)) codes.push('VAL018-availability-window');
    if (pre.disabledByQuest !== null && state.questLog.has(pre.disabledByQuest)) codes.push('VAL018-availability-window');
    if (logFull) codes.push('VAL020-quest-log-full');
    return codes;
  };
  return (questId, state) => check(questId, state, 0);
}

/** The walker's accept policy from the findings (`createAvailabilityPolicy`). */
export function harnessPolicy(findings: AcceptFindings): AcceptPolicy {
  return { acceptable: (questId, state) => harnessTruth(findings(questId, state)) };
}

function dependenciesOf(record: QuestRecord | undefined, dataset: EngineContext['dataset']): Omit<AvailabilityDependencies, 'breadcrumbTarget'> {
  if (record === undefined) {
    return { completed: [], inLog: [], takenOrDone: [], blockers: [], minLevel: null, maxLevel: null, parent: null, skills: [], spells: [], minReputation: [], maxReputation: [] };
  }
  const pre = record.prerequisites;
  const req = record.requirements;
  const completed: QuestId[][] = [];
  if (pre.preQuestSingle.length > 0) completed.push([...pre.preQuestSingle]);
  else {
    for (const entry of pre.preQuestGroup) {
      const id = Math.abs(entry) as QuestId;
      completed.push(entry > 0 ? [id, ...(dataset.quest(id)?.prerequisites.exclusiveTo ?? [])] : [id]);
    }
  }
  const blockers: QuestId[] = [...pre.exclusiveTo.filter((id) => id !== record.id), ...pre.breadcrumbs];
  for (const id of [pre.nextQuestInChain, pre.breadcrumbForQuestId, pre.availableUntilCompleted, pre.disabledByQuest]) if (id !== null) blockers.push(id);
  return {
    completed,
    inLog: pre.parentQuest === null ? [] : [pre.parentQuest],
    takenOrDone: pre.availableStartingWith === null ? [] : [pre.availableStartingWith],
    blockers,
    minLevel: record.minLevel,
    maxLevel: record.maxLevel,
    parent: pre.parentQuest,
    skills: req.skill === null ? [] : [req.skill.skillId],
    spells: req.spell === null ? [] : [Math.abs(req.spell)],
    minReputation: req.minReputation === null ? [] : [req.minReputation.factionId],
    maxReputation: req.maxReputation === null ? [] : [req.maxReputation.factionId],
  };
}

/** A stand-in for `compileAvailability` (the validator's `availabilityDependencies`). */
export function harnessAvailability(dataset: EngineContext['dataset']): CompileAvailability {
  return {
    dependencies(questId) {
      const record = dataset.quest(questId);
      const target = record?.prerequisites.breadcrumbForQuestId ?? null;
      return {
        ...dependenciesOf(record, dataset),
        breadcrumbTarget: target === null ? null : { questId: target, dependencies: dependenciesOf(dataset.quest(target), dataset) },
      };
    },
    truth: harnessTruth,
  };
}

// =============================================================================================
// Walks, probes and the compile input

const namedByStep = (step: RouteStep): QuestId[] =>
  step.kind !== 'accept' ? [] : step.anyOf === null ? [step.questId] : [step.questId, ...step.anyOf.filter((id) => id !== step.questId)];

/** The probe visitor (§4.2): the state scalars and availability findings at every section and suffix step. */
export function harnessProbe(
  project: WalkProject,
  context: EngineContext,
  section: { readonly first: number; readonly last: number },
  findings: AcceptFindings,
): { readonly visitor: WalkVisitor; result(): { readonly steps: ReadonlyMap<number, StepProbe>; readonly endState: ReadonlyCharacterState } } {
  const steps = new Map<number, StepProbe>();
  let endState: ReadonlyCharacterState | null = null;
  const curve = xpCurveOf(context.rules);
  const predicateContext = {
    priorHistory: project.character.priorHistory,
    xpStepSkipping: project.routeProfile.xpStepSkipping,
    acceptPolicy: context.acceptPolicy ?? harnessPolicy(findings),
  };
  const visitor: WalkVisitor = {
    enter(visit) {
      if (visit.index < section.first) return;
      const state = visit.state;
      const group = visit.step.groupId === null ? null : routeGroup(project.route, visit.step.groupId);
      const predicates = [...(group?.rxp?.condition?.skipIf ?? []), ...(visit.step.condition?.skipIf ?? [])];
      const quests = [...namedByStep(visit.step)];
      for (const predicate of predicates) if (predicate.kind === 'questState' && predicate.state === 'available') quests.push(...predicate.questIds);
      steps.set(visit.index, {
        index: visit.index,
        active: visit.active,
        level: state.level,
        xp: state.xp,
        knownTotal: cumulativeXp(curve, Math.min(state.level, curve.cumulative.length)) + state.xp,
        unknownXpEvents: state.unknownXpEvents,
        logCount: state.questLog.size,
        availability: quests.length === 0 ? null : quests.map((questId) => {
          const codes = findings(questId, state);
          return { questId, truth: harnessTruth(codes), codes };
        }),
        predicates: predicates.length === 0 ? null : predicates.map((predicate) => evaluatePredicate(predicate, state, predicateContext)),
        chosen: null,
      });
    },
    leave(visit, record) {
      const known = steps.get(visit.index);
      if (known !== undefined && (visit.step.kind === 'accept' || visit.step.kind === 'turnin') && visit.step.anyOf !== null) steps.set(visit.index, { ...known, chosen: record.delta.questId });
      if (visit.index === section.last) endState = cloneState(visit.state);
    },
  };
  return {
    visitor,
    result() {
      if (endState === null) throw new Error('The walk did not reach the section end');
      return { steps, endState };
    },
  };
}

export interface HarnessWalk {
  readonly walk: SectionWalk;
  readonly route: RouteWalk;
  readonly context: EngineContext;
}

/**
 * The run's walk (§5.1) with the engine alone: the context gets the stand-in accept policy, the
 * walker walks with the probe, and the memo before the section comes from replaying the prefix
 * (`RouteWalker.memoBefore` is M7.0's).
 */
export function harnessWalk(project: WalkProject, baseContext: EngineContext, section: { readonly first: number; readonly last: number }, findings?: AcceptFindings): HarnessWalk {
  const accept = findings ?? harnessFindings(project, baseContext);
  const context: EngineContext = { ...baseContext, acceptPolicy: baseContext.acceptPolicy ?? harnessPolicy(accept) };
  const walker = createRouteWalker(context);
  const probe = harnessProbe(project, context, section, accept);
  const route = walker.walk(project, [probe.visitor]);
  const places = createPlaces(context);
  const env = replayEnv(context, project, places);
  const initial = createInitialState(project.character, { dataset: context.dataset, rules: context.rules, graph: context.graph, places });
  const steps = project.route.steps;
  for (let i = 0; i < section.first; i += 1) {
    const step = steps[i];
    if (step === undefined) continue;
    const group = step.groupId === null ? null : routeGroup(project.route, step.groupId);
    runStep(env, initial.state, initial.memo, step, i, group, stepActivity(env, initial.state, initial.memo, step, group));
  }
  const probed = probe.result();
  return {
    walk: { records: route.records, start: cloneState(initial.state), memo: copyMemo(initial.memo), places, probe: { steps: probed.steps, endState: probed.endState } },
    route,
    context,
  };
}

export function harnessInput(project: WalkProject, baseContext: EngineContext, section: { readonly first: number; readonly last: number }, goal: Partial<OptimizationGoal> = {}): CompileInput {
  const { walk, context } = harnessWalk(project, baseContext, section);
  return {
    project,
    section,
    goal: { targetXp: goal.targetXp ?? 'keep-original', grindFill: goal.grindFill ?? 'shortfall' },
    context,
    walk,
    availability: harnessAvailability(context.dataset),
  };
}

/** Analyse and compile on the same walk (the straight-line model has no "computing paths"). */
export function harnessCompile(project: WalkProject, context: EngineContext, section: { readonly first: number; readonly last: number }, goal: Partial<OptimizationGoal> = {}): CompiledProblem | CompileFailure {
  const input = harnessInput(project, context, section, goal);
  const analysis = analyseSection(input);
  if (!analysis.ok) return analysis;
  return compileProblem(analysis, input.walk);
}

/** Runs a search to its end with one slice size. */
export function runSearch(compiled: CompiledProblem, options: Partial<SearchOptions> = {}, slice = 1_000_000): SearchOutcome {
  const stepper = createSearch(compiled.problem, { ...DEFAULT_SEARCH_OPTIONS, ...options });
  for (;;) {
    const result = stepper.advance(slice);
    if (result.done) return result.outcome;
  }
}

/**
 * The model oracle (review COR-05): every sequence the transitions allow, closed at every node with
 * the search's own closing rules, and closable nodes expanded too (no beam, no dominance, no early
 * stop). Returns the least `comparedMs` (the figure the search ranks by) and its first sequence.
 */
export function modelOracle(problem: SearchProblem, limit = 2_000_000): { readonly best: number; readonly units: readonly number[]; readonly nodes: number } {
  const t = createTransitions(problem);
  let best = Number.POSITIVE_INFINITY;
  let bestUnits: number[] = [];
  let nodes = 0;
  const path: number[] = [];
  const visit = (s: NodeState): void => {
    nodes += 1;
    if (nodes > limit) throw new Error(`The model oracle visited more than ${String(limit)} nodes`);
    const closed = t.close(s);
    if (closed !== null && closed.comparedMs < best) {
      best = closed.comparedMs;
      bestUnits = [...path];
    }
    for (let u = 0; u < t.units; u += 1) {
      if (!t.enabled(s, u)) continue;
      const child: NodeState = { ...s, scheduled: s.scheduled.slice(), status: s.status.slice() };
      t.logSize = 0;
      const ok = t.applyEnabled(child, u);
      t.logSize = 0;
      if (!ok) continue;
      path.push(u);
      visit(child);
      path.pop();
    }
  };
  visit(t.createState());
  return { best, units: bestUnits, nodes };
}

/** The route with the section replaced by a decoded solution. */
export function spliceSection(project: WalkProject, first: number, last: number, section: readonly RouteStep[]): WalkProject {
  const steps = project.route.steps;
  return { ...project, route: { ...project.route, steps: [...steps.slice(0, first), ...section, ...steps.slice(last + 1)] } };
}

/**
 * The engine's section plus exit chain, in ms (§6.3), for a route whose section spans `first` to
 * `last` and whose exit chain is the given suffix steps (by offset after the section).
 */
export function engineSectionMs(project: WalkProject, context: EngineContext, first: number, last: number, chainLength: number): number {
  const records = createRouteWalker(context).walk(project).records;
  const a = records[first];
  const b = records[last];
  if (a === undefined || b === undefined) throw new RangeError('No such steps');
  let ms = (b.estimate.endSec - a.estimate.startSec) * 1000;
  for (let k = 1; k <= chainLength; k += 1) {
    const record = records[last + k];
    if (record !== undefined) ms += (record.estimate.breakdown.travel + record.estimate.breakdown.waiting) * 1000;
  }
  return ms;
}

/** Decodes a solution with deterministic ids. */
export function harnessDecode(compiled: CompiledProblem, solution: SearchOutcome['solutions'][number], ids: IdSource = sequentialIdSource(1000)): DecodedSection {
  return decodeSolution(compiled.decode, solution, ids);
}

// =============================================================================================
// Harness H (docs/research/optimizer-m7.md §13.0)

/** Harness H's assumptions: 10 yd/s on foot, detour 1 (a leg takes yards / 10 s). */
export const H_ASSUMPTIONS = { runSpeedYps: 10, travelDetourFactor: 1 } as const;

/** A harness quest: level 30, min level 1, no objectives, `xp` exactly at levels up to 35. */
export function hQuest(id: number, xp: number | null, fields: Partial<QuestRecord> = {}): QuestRecord {
  return questRecord(id, {
    level: 30,
    minLevel: 1,
    objectives: [],
    xp: xp === null ? null : { questLevel: 30, baseXp: xp, basis: 'era-seed' },
    ...fields,
  });
}

/** Step builders with one sequential id source. */
export function hSteps(ids: IdSource = sequentialIdSource()) {
  const where = (x: number, y: number): Location => at(x, y);
  return {
    ids,
    accept: (q: number, x: number, y: number, fields: Partial<AcceptStep> = {}): AcceptStep => ({ ...makeAcceptStep(ids, { questId: questId(q), location: where(x, y) }), ...fields }),
    turnin: (q: number, x: number, y: number, fields: Partial<TurnInStep> = {}): TurnInStep => ({ ...makeTurnInStep(ids, { questId: questId(q), location: where(x, y) }), ...fields }),
    complete: (q: number, x: number, y: number, fields: Partial<CompleteStep> = {}): CompleteStep => ({
      ...makeCompleteStep(ids, { targets: [{ questId: questId(q), objective: null }], location: where(x, y) }),
      ...fields,
    }),
    note: (x: number | null, y: number, fields: Partial<NoteStep> = {}): NoteStep => ({ ...makeNoteStep(ids, { text: 'note', location: x === null ? null : where(x, y) }), ...fields }),
    travel: (x: number | null, y: number, fields: Partial<TravelStep> = {}): TravelStep => ({ ...makeTravelStep(ids, { location: x === null ? null : where(x, y) }), ...fields }),
    train: (x: number, y: number, fields: Partial<TrainStep> = {}): TrainStep => ({ ...makeTrainStep(ids, { location: where(x, y) }), ...fields }),
    hearth: (mode: 'use' | 'bind', x: number | null, y: number, fields: Partial<HearthStep> = {}): HearthStep => ({
      ...makeHearthStep(ids, { mode, location: x === null ? null : where(x, y) }),
      ...fields,
    }),
    grind: (fields: Partial<GrindStep> & Pick<GrindStep, 'until'>): GrindStep => ({ ...makeGrindStep(ids, { until: fields.until }), ...fields }),
    /** Accept then turn in at the same point. */
    quest: (q: number, x: number, y: number): RouteStep[] => [
      { ...makeAcceptStep(ids, { questId: questId(q), location: where(x, y) }) },
      { ...makeTurnInStep(ids, { questId: questId(q), location: where(x, y) }) },
    ],
  };
}

export interface Scenario {
  readonly project: WalkProject;
  readonly context: EngineContext;
  readonly section: { readonly first: number; readonly last: number };
}

/**
 * Harness H: Kalimdor, a level-10 Horde orc warrior at (0, 0), the section is every step but the
 * suffix, and the suffix is one `note` at the exit E (or `suffix` when given).
 */
export function hScenario(options: {
  readonly quests: readonly QuestRecord[];
  readonly data?: Omit<FixtureData, 'quests'>;
  readonly steps: readonly RouteStep[];
  readonly exit?: { readonly x: number; readonly y: number } | null;
  readonly suffix?: readonly RouteStep[];
  readonly prefix?: readonly RouteStep[];
  readonly character?: Partial<CharacterProfile>;
  readonly routeProfile?: Partial<RouteProfile>;
  readonly groups?: readonly RouteGroup[];
  readonly customQuests?: WalkProject['customQuests'];
  readonly ids?: IdSource;
  /** Flight masters, transports and dungeons for the TravelGraph (the assumptions stay harness H's). */
  readonly contextOptions?: Omit<FixtureContextOptions, 'assumptions'>;
}): Scenario {
  const ids = options.ids ?? sequentialIdSource(9000);
  const exit = options.exit === undefined ? null : options.exit;
  const suffix = options.suffix ?? (exit === null ? [] : [makeNoteStep(ids, { text: 'exit', location: at(exit.x, exit.y) })]);
  const prefix = options.prefix ?? [];
  const project0 = fixtureProject([...prefix, ...options.steps, ...suffix], {
    character: { startLevel: 10, startXp: 0, startLocation: at(0, 0), ...options.character },
    ...(options.routeProfile === undefined ? {} : { routeProfile: options.routeProfile }),
    ...(options.groups === undefined ? {} : { groups: options.groups }),
  });
  const project: WalkProject = { ...project0, customQuests: options.customQuests ?? [] };
  const context = fixtureContext(fixtureDataset({ quests: options.quests, ...options.data }), { ...options.contextOptions, assumptions: H_ASSUMPTIONS });
  return { project, context, section: { first: prefix.length, last: prefix.length + options.steps.length - 1 } };
}
