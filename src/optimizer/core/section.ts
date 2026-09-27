import type { StatePredicate, Truth } from '../../domain/conditions';
import type { EntityRef, QuestRecord } from '../../domain/dataset';
import type { GroupId, QuestId } from '../../domain/ids';
import type { Location, WorldPoint } from '../../domain/points';
import { QUEST_STEP_KINDS, type CompleteStep, type RouteGroup, type RouteStep, type TurnInStep } from '../../domain/route';
import { routeGroup } from '../../domain/route-ops';
import type { TravelEndpoint } from '../../domain/travel';
import { evaluateFilter, evaluatePredicate, evaluateStaticCondition, type ConditionSubject } from '../../engine/conditions';
import { cloneState, newLogEntry } from '../../engine/state';
import { isDeathSkip } from '../../engine/steps';
import type { CharacterState, ReadonlyCharacterState, StepRecord, TravelPair } from '../../engine/types';
import { instanceKindOf, isInstanceMap } from '../../rules/travel-graph';
import type { KillPlace } from '../../sim/kill-xp';
import { questXp } from '../../sim/quest-xp';
import { cumulativeXp, xpCurveOf } from '../../sim/xp';
import { collectGeometry, type Geometry } from './geometry';
import { endpointKey, SpawnChooser } from './locations';
import { copyMemo, type Replay, replayStep, startReplay } from './replay';
import type {
  CompileFailure,
  CompileInput,
  ContractSummary,
  ObjectiveWorkSpec,
  ReadonlyWalkMemo,
  SectionAnalysis,
  SectionWalk,
  WorkBlock,
} from './types';

/**
 * Section analysis (docs/research/optimizer-m7.md §3, §4, §5.1-§5.2): compile's structure of a
 * section, built from one walk of the run's private walker and a replay of the section with the
 * engine. `analyseSection` builds it on the analysis walk and lists the legs the matrix needs;
 * `compileProblem` builds it again on the baseline walk and checks that the two agree.
 *
 * Everything is ordered deterministically: units by original step index, quests by id, locations
 * by (mapId, x, y, zoneHint), spawn candidates in dataset order.
 */

/** The largest number of legs "computing paths" is asked for (§5.3, RC-07). */
export const MAX_REQUESTED_LEGS = 13_500;
/** The largest number of locations (4 MB of matrix per tier, §5.6). */
export const MAX_LOCATIONS = 1_024;

// =============================================================================================
// Structure types

export type Role = 'inert' | 'anchor' | 'host' | 'bound';

/** Where a step travels (§5.2), before location indices exist. */
export type DestDraft =
  | { readonly kind: 'none' }
  | { readonly kind: 'loc'; readonly end: TravelEndpoint | null; readonly radius: number }
  | { readonly kind: 'spawn'; readonly entity: EntityRef }
  | { readonly kind: 'lost' }
  | { readonly kind: 'hearth'; readonly end: TravelEndpoint | null }
  | { readonly kind: 'table' };

/** A group's `leg` waypoint chain (§3.3). */
export interface ChainDraft {
  readonly id: GroupId;
  readonly ends: readonly (TravelEndpoint | null)[];
  readonly radius: readonly number[];
  readonly prefixDone: boolean;
}

/** One flight or transport step, priced per from-location and tier with the engine (§5.4). */
export interface TableDraft {
  readonly index: number;
  readonly state: CharacterState;
  readonly memo: ReadonlyWalkMemo;
  readonly active: boolean | 'unknown';
}

/** What an accept's availability reads from the state before it, besides the level and the log size (§4.2). */
export interface AcceptInputs {
  readonly questId: QuestId;
  readonly inLog: boolean;
  readonly parentActive: boolean;
  readonly target: { readonly questId: QuestId; readonly takenOrDone: boolean; readonly parentActive: boolean } | null;
}

export interface PredicateDraft {
  readonly kind: 'fixed' | 'level' | 'available';
  readonly original: Truth;
  readonly level: number;
  readonly xp: number | null;
  readonly negate: boolean;
  readonly quests: readonly QuestId[];
  readonly match: 'any' | 'all';
  /** `available` predicates: each quest's accept inputs. */
  readonly inputs: readonly AcceptInputs[];
}

/** Everything compile needs about one step of the section or the exit chain. */
export interface StepInfo {
  readonly index: number;
  readonly step: RouteStep;
  readonly group: RouteGroup | null;
  readonly record: StepRecord;
  /** The walk ran it (`active !== false`). */
  readonly active: boolean;
  readonly role: Role;
  readonly reason: string;
  /** A position-unknown event (§3.6). */
  readonly event: boolean;
  readonly dest: DestDraft;
  readonly walk: boolean;
  /** The group whose waypoints a located active step walks when they are not done, or null. */
  readonly chain: GroupId | null;
  /** The original walked the chain at this step. */
  readonly walkedChain: boolean;
  /** Accept: the chosen quest; turn-in: the quest acted on; abandon: its quest. */
  readonly quest: QuestId | null;
  /** Accept: the chosen quest was not in the log before (the accept puts it there). */
  readonly entersLog: boolean;
  readonly block: WorkBlock | null;
  readonly carry: WorkBlock | null;
  /** Turn-in: whether it turns in (the quest in the log, or assumed); false for VAL-30. */
  readonly turnsIn: boolean;
  /** An unlocated bind: the original position (point) before it. */
  readonly bindBefore: TravelEndpoint | null;
  readonly riding: { readonly before: number; readonly after: number };
  readonly place: KillPlace;
  /** The group's skip predicates when this step decides them, else null. */
  readonly groupPredicates: readonly PredicateDraft[] | null;
  readonly stepPredicates: readonly PredicateDraft[];
  /** Any-of accept: the candidates, and the chosen one. */
  readonly candidates: readonly QuestId[] | null;
  /** Availability inputs of an accept (each any-of candidate's), from the state before it. */
  readonly accept: readonly AcceptInputs[] | null;
  readonly table: TableDraft | null;
}

export interface UnitDraft {
  /** Route indices, in order. */
  readonly steps: readonly number[];
  readonly anchor: boolean;
  readonly block: boolean;
  /** A block that holds the section start: scheduled first. */
  readonly first: boolean;
  /** A block that reaches the section end: scheduled last. */
  readonly last: boolean;
  /** Pool quest ids, ascending. */
  readonly quests: readonly QuestId[];
}

export interface QuestDraft {
  readonly id: QuestId;
  readonly record: QuestRecord | undefined;
  /** Unit indices, ascending. */
  readonly units: readonly number[];
  readonly startStatus: 0 | 1 | 2 | 3;
  readonly unknownXp: boolean;
}

export interface Structure {
  readonly input: CompileInput;
  readonly walk: SectionWalk;
  readonly first: number;
  readonly last: number;
  readonly steps: ReadonlyMap<number, StepInfo>;
  /** Route indices of the exit chain. */
  readonly chain: readonly number[];
  readonly units: readonly UnitDraft[];
  readonly quests: readonly QuestDraft[];
  readonly questIndex: ReadonlyMap<QuestId, number>;
  readonly qExt: ReadonlySet<QuestId>;
  readonly obligatory: ReadonlySet<QuestId>;
  readonly carried: readonly QuestId[];
  readonly barrierSteps: readonly number[];
  readonly chains: readonly ChainDraft[];
  readonly chainIndex: ReadonlyMap<GroupId, number>;
  /** The replay's state before the first section step and after the last one, and before the exit chain. */
  readonly startState: ReadonlyCharacterState;
  readonly endState: CharacterState;
  readonly endMemo: ReadonlyWalkMemo;
  readonly spawnChooser: SpawnChooser;
  readonly subject: ConditionSubject;
  readonly unknownHistory: boolean;
  readonly castWindowStart: number;
  readonly summary: ContractSummary;
}

const fail = (status: CompileFailure['status'], reason: string): CompileFailure => ({ ok: false, status, reason });

// =============================================================================================
// Helpers

/** The quests a step names (§3: `questId`, any-of candidates, complete targets). */
export function namedQuests(step: RouteStep): QuestId[] {
  switch (step.kind) {
    case 'accept':
    case 'turnin':
      return step.anyOf === null ? [step.questId] : [step.questId, ...step.anyOf.filter((id) => id !== step.questId)];
    case 'abandon':
      return [step.questId];
    case 'complete': {
      const out: QuestId[] = [];
      for (const target of step.targets) if (!out.includes(target.questId)) out.push(target.questId);
      return out;
    }
    case 'travel':
    case 'grind':
    case 'hearth':
    case 'flight':
    case 'train':
    case 'vendor':
    case 'note':
      return [];
  }
}

const untouched = (state: ReadonlyCharacterState, q: QuestId): boolean =>
  !state.questLog.has(q) && !state.completed.has(q) && !state.abandoned.has(q) && !state.acceptedInRoute.has(q);

const sameEnd = (a: { readonly mapId: number; readonly x: number; readonly y: number } | null, b: { readonly mapId: number; readonly x: number; readonly y: number } | null): boolean =>
  a === b || (a !== null && b !== null && a.mapId === b.mapId && a.x === b.x && a.y === b.y);

/** The engine's `questTarget` (engine/steps.ts): `via`, the only starter or finisher, else a custom quest's location. */
function questTarget(input: CompileInput, questId: QuestId, via: EntityRef | null, side: 'starters' | 'finishers'): EntityRef | Location | null {
  if (via !== null) return via;
  const refs = input.context.dataset.quest(questId)?.[side] ?? [];
  if (refs.length === 1) return refs[0] ?? null;
  if (refs.length === 0) {
    const custom = input.project.customQuests.find((quest) => quest.id === questId);
    const location = side === 'starters' ? custom?.starterLocation : custom?.finisherLocation;
    if (location !== undefined && location !== null) return location;
  }
  return null;
}

function killPlaceAt(input: CompileInput, end: TravelEndpoint | null): KillPlace {
  const kind = end === null ? null : instanceKindOf(input.context.graph, end.point.mapId);
  return kind ?? 'open-world';
}

/**
 * Whether every spawn of an entity with a world point lies at one point: the engine's nearest spawn
 * is then that point from anywhere, the section's end included (review PAR-07).
 */
function onePoint(input: CompileInput, ref: EntityRef): boolean {
  if (ref.kind === 'item') return false;
  let first: WorldPoint | null = null;
  for (const spawn of input.context.dataset.spawns(ref)) {
    const world = spawn.world;
    if (world === null) continue;
    if (first === null) first = world;
    else if (first.mapId !== world.mapId || first.x !== world.x || first.y !== world.y) return false;
  }
  return first !== null;
}

/** Whether a suffix step fixes the position (§5.4): the exit chain ends at it. */
function fixesPosition(input: CompileInput, step: RouteStep, record: StepRecord): boolean {
  if (record.delta.locationAfter === null) return true;
  switch (step.kind) {
    case 'hearth':
      return step.mode === 'use' || step.location !== null;
    case 'flight':
      return true;
    case 'travel':
      return step.mode === 'transport' || step.location !== null;
    case 'accept':
    case 'turnin': {
      if (step.location !== null) return true;
      const chosen = record.delta.questId ?? step.questId;
      const target = questTarget(input, chosen, step.via, step.kind === 'accept' ? 'starters' : 'finishers');
      if (target === null) return false;
      return 'source' in target || onePoint(input, target);
    }
    case 'note':
      return isDeathSkip(step) || step.location !== null;
    case 'complete':
    case 'abandon':
    case 'grind':
    case 'train':
    case 'vendor':
      return step.location !== null;
  }
}

/** A step's destination (§5.2) and whether its travel goes through its group's waypoints. */
function destinationOf(input: CompileInput, walk: SectionWalk, step: RouteStep, record: StepRecord): { readonly dest: DestDraft; readonly located: boolean; readonly walk: boolean } {
  const places = walk.places;
  const located = (location: Location): DestDraft => ({ kind: 'loc', end: places.location(location), radius: Math.max(0, location.radius ?? 0) });
  const fixedOrNone = (): { dest: DestDraft; located: boolean; walk: boolean } =>
    step.location === null ? { dest: { kind: 'none' }, located: false, walk: false } : { dest: located(step.location), located: true, walk: false };
  switch (step.kind) {
    case 'accept':
    case 'turnin': {
      if (step.location !== null) return { dest: located(step.location), located: true, walk: false };
      const chosen = record.delta.questId ?? step.questId;
      const target = questTarget(input, chosen, step.via, step.kind === 'accept' ? 'starters' : 'finishers');
      if (target === null) return { dest: { kind: 'none' }, located: false, walk: false };
      if ('source' in target) return { dest: located(target), located: false, walk: false };
      if (target.kind === 'item') return { dest: { kind: 'none' }, located: false, walk: false };
      return { dest: { kind: 'spawn', entity: target }, located: false, walk: false };
    }
    case 'travel':
      if (step.mode === 'transport') return { dest: { kind: 'table' }, located: false, walk: false };
      if (step.location === null) return { dest: { kind: 'lost' }, located: false, walk: false };
      return { dest: located(step.location), located: true, walk: step.mode === 'walk' };
    case 'note':
      if (isDeathSkip(step)) return { dest: { kind: 'lost' }, located: false, walk: false };
      return fixedOrNone();
    case 'hearth':
      if (step.mode === 'use') return { dest: { kind: 'hearth', end: null }, located: false, walk: false };
      return fixedOrNone();
    case 'flight':
      return { dest: { kind: 'table' }, located: false, walk: false };
    case 'complete':
    case 'abandon':
    case 'grind':
    case 'train':
    case 'vendor':
      return fixedOrNone();
  }
}

/** TIME-10 inputs of a `complete` step from the state before it (engine/steps.ts `complete`). */
function completeBlock(input: CompileInput, state: ReadonlyCharacterState, step: CompleteStep, unknownHistory: boolean, at: TravelEndpoint | null, place: KillPlace): WorkBlock {
  const dataset = input.context.dataset;
  const inLog = new Set<QuestId>();
  for (const q of namedQuests(step)) if (state.questLog.has(q) || (unknownHistory && untouched(state, q))) inLog.add(q);
  const works: ObjectiveWorkSpec[] = [];
  let unknowns = 0;
  const point = at?.point ?? null;
  const add = (record: QuestRecord, index: number): void => {
    const objective = record.objectives[index];
    if (objective === undefined) return;
    if (works.some((work) => work.questId === record.id && work.index === index)) return;
    works.push({ questId: record.id, index, objective, at: point, place });
  };
  for (const target of step.targets) {
    const record = dataset.quest(target.questId);
    const entry = inLog.has(target.questId) ? (state.questLog.get(target.questId) ?? newLogEntry(record, false)) : undefined;
    if (record === undefined) {
      unknowns += 1;
      continue;
    }
    const count = record.objectives.length;
    if (target.objective === null) {
      for (let index = 0; index < count; index += 1) if (entry?.objectives[index] !== 'done') add(record, index);
    } else if (!Number.isInteger(target.objective) || target.objective < 0 || target.objective >= count) {
      unknowns += 1;
    } else if (entry?.objectives[target.objective] !== 'done') {
      add(record, target.objective);
    }
  }
  return { works, unknowns };
}

/** The turn-in the engine would make (engine/steps.ts `turnInChoice`), and its carried block (D-040). */
function turnInCapture(input: CompileInput, state: ReadonlyCharacterState, step: TurnInStep, unknownHistory: boolean): { readonly quest: QuestId; readonly turnsIn: boolean; readonly carry: WorkBlock | null } {
  const candidates = step.anyOf === null ? [step.questId] : [step.questId, ...step.anyOf.filter((id) => id !== step.questId)];
  let chosen: QuestId | null = candidates.find((id) => state.questLog.get(id)?.failed === false) ?? null;
  if (chosen === null && unknownHistory) chosen = candidates.find((id) => untouched(state, id)) ?? null;
  if (chosen === null) return { quest: step.questId, turnsIn: false, carry: null };
  const record = input.context.dataset.quest(chosen);
  const entry = state.questLog.get(chosen) ?? newLogEntry(record, false);
  if (entry.failed) return { quest: chosen, turnsIn: false, carry: null };
  if (!entry.routeAccepted || record === undefined) return { quest: chosen, turnsIn: true, carry: null };
  const works: ObjectiveWorkSpec[] = [];
  let unknowns = 0;
  let open = 0;
  entry.objectives.forEach((progress, index) => {
    if (progress !== 'open') return;
    open += 1;
    const objective = record.objectives[index];
    if (objective === undefined) unknowns += 1;
    else works.push({ questId: chosen, index, objective, at: null, place: 'open-world' });
  });
  return { quest: chosen, turnsIn: true, carry: open === 0 ? null : { works, unknowns } };
}

/** An accept's availability inputs from the state before it (§4.2). */
function acceptInputsOf(input: CompileInput, state: ReadonlyCharacterState, questId: QuestId): AcceptInputs {
  const dataset = input.context.dataset;
  const pre = dataset.quest(questId)?.prerequisites;
  const parent = pre?.parentQuest ?? null;
  const targetId = pre?.breadcrumbForQuestId ?? null;
  const targetParent = targetId === null ? null : (dataset.quest(targetId)?.prerequisites.parentQuest ?? null);
  return {
    questId,
    inLog: state.questLog.has(questId),
    parentActive: parent !== null && state.questLog.has(parent),
    target:
      targetId === null
        ? null
        : { questId: targetId, takenOrDone: state.completed.has(targetId) || state.questLog.has(targetId), parentActive: targetParent !== null && state.questLog.has(targetParent) },
  };
}

function predicateDrafts(input: CompileInput, predicates: readonly StatePredicate[], state: ReadonlyCharacterState, replay: Replay): PredicateDraft[] {
  return predicates.map((predicate): PredicateDraft => {
    const original = evaluatePredicate(predicate, state, replay.env.predicates);
    switch (predicate.kind) {
      case 'levelAtLeast':
        return { kind: 'level', original, level: predicate.level, xp: predicate.xp, negate: predicate.negate, quests: [], match: 'any', inputs: [] };
      case 'questState':
        return predicate.state === 'available'
          ? {
              kind: 'available',
              original,
              level: 0,
              xp: null,
              negate: predicate.negate,
              quests: predicate.questIds,
              match: predicate.match,
              inputs: predicate.questIds.map((q) => acceptInputsOf(input, state, q)),
            }
          : { kind: 'fixed', original, level: 0, xp: null, negate: false, quests: predicate.questIds, match: predicate.match, inputs: [] };
      case 'opaque':
        return { kind: 'fixed', original, level: 0, xp: null, negate: false, quests: [], match: 'any', inputs: [] };
    }
  });
}

const sameSeconds = (a: number | null, b: number | null): boolean => (a === null ? b === null : b !== null && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a)));

// =============================================================================================
// The structure

/** Builds the section's structure on one walk (§3, §4, §5.1). */
export function buildStructure(input: CompileInput, walk: SectionWalk): Structure | CompileFailure {
  const { project, context } = input;
  const route = project.route;
  const steps = route.steps;
  const records = walk.records;
  const { first, last } = input.section;
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first || last >= steps.length) {
    return fail('failed', `the section ${String(first)}-${String(last)} is not a range of the route's ${String(steps.length)} steps`);
  }
  if (records.length !== steps.length) return fail('failed', 'the walk does not match the project');
  if (typeof input.goal.targetXp === 'number' && (!Number.isFinite(input.goal.targetXp) || input.goal.targetXp < 0)) {
    return fail('failed', `the target XP ${String(input.goal.targetXp)} is not a number of 0 or more`);
  }
  for (let i = first; i <= last; i += 1) {
    const facts = records[i]?.estimate.facts ?? [];
    if (facts.some((fact) => fact.kind === 'cross-world-no-transport')) {
      return fail('infeasible', 'the section moves between world maps without a transport step (SIM-4)');
    }
  }
  const subject: ConditionSubject = { character: project.character, routeProfile: project.routeProfile };
  const unknownHistory = project.character.priorHistory === 'unknown';

  // ---- The exit chain (§5.4): suffix steps the walk ran, up to the first that fixes the position.
  const chain: number[] = [];
  for (let i = last + 1; i < steps.length; i += 1) {
    const step = steps[i];
    const record = records[i];
    if (step === undefined || record === undefined || record.estimate.active === false) continue;
    chain.push(i);
    if (fixesPosition(input, step, record)) break;
  }
  const replayEnd = chain.at(-1) ?? last;

  // ---- Group waypoint chains (§3.3).
  const chains: ChainDraft[] = [];
  const chainIndex = new Map<GroupId, number>();
  const chainOf = (group: RouteGroup | null): GroupId | null => {
    if (group === null || group.rxp === null || group.rxp.waypoints.length === 0) return null;
    const known = chainIndex.get(group.id);
    if (known !== undefined) return group.id;
    const ends: (TravelEndpoint | null)[] = [];
    const radius: number[] = [];
    for (const waypoint of group.rxp.waypoints) {
      if (waypoint.role !== 'leg') continue;
      if (waypoint.filter !== null && evaluateFilter(waypoint.filter, subject) === 'false') continue;
      ends.push(walk.places.point(waypoint.point));
      radius.push(waypoint.radius !== null && waypoint.radius > 0 ? waypoint.radius : 0);
    }
    if (ends.length === 0) return null;
    chainIndex.set(group.id, chains.length);
    chains.push({ id: group.id, ends, radius, prefixDone: walk.memo.waypointsDone.has(group.id) });
    return group.id;
  };

  // ---- Replay the section and the exit chain, capturing what compile reads before each step.
  const replay = startReplay(input, walk);
  const infos = new Map<number, StepInfo>();
  let endState: CharacterState | null = null;
  let endMemo: ReadonlyWalkMemo | null = null;
  for (let i = first; i <= replayEnd; i += 1) {
    const step = steps[i];
    const record = records[i];
    if (step === undefined || record === undefined) return fail('failed', `step ${String(i)} is missing`);
    const inSection = i <= last;
    const inChain = chain.includes(i);
    const group = step.groupId === null ? null : routeGroup(route, step.groupId);
    const state = replay.state;
    const memo = replay.memo;
    let info: StepInfo | null = null;
    if (inSection || inChain) {
      const active = record.estimate.active !== false;
      const { dest, located, walk: walkMode } = destinationOf(input, walk, step, record);
      const groupId = located && active ? chainOf(group) : null;
      const walkedChain = groupId !== null && !memo.waypointsDone.has(groupId);
      // Conditions: the group's predicates are decided at its first step reached (RXP.md §14 row 5).
      const groupCondition = group?.rxp?.condition ?? null;
      const groupStatic = evaluateStaticCondition(groupCondition, subject);
      const stepStatic = evaluateStaticCondition(step.condition, subject);
      let groupPredicates: PredicateDraft[] | null = null;
      if (group !== null && groupCondition !== null && groupCondition.skipIf.length > 0 && groupStatic !== 'false' && !memo.groupSkip.has(group.id)) {
        groupPredicates = predicateDrafts(input, groupCondition.skipIf, state, replay);
      }
      const stepPredicates = groupStatic !== 'false' && stepStatic !== 'false' && step.condition !== null ? predicateDrafts(input, step.condition.skipIf, state, replay) : [];
      // Quest captures.
      let quest: QuestId | null = null;
      let entersLog = false;
      let block: WorkBlock | null = null;
      let carry: WorkBlock | null = null;
      let turnsIn = false;
      let candidates: QuestId[] | null = null;
      let accept: StepInfo['accept'] = null;
      let place: KillPlace = 'open-world';
      const endOf = (d: DestDraft): TravelEndpoint | null => (d.kind === 'loc' ? d.end : null);
      if (step.kind === 'accept') {
        quest = record.delta.questId ?? step.questId;
        entersLog = !state.questLog.has(quest);
        candidates = step.anyOf === null ? null : namedQuests(step);
        accept = (candidates ?? [quest]).map((q) => acceptInputsOf(input, state, q));
      } else if (step.kind === 'turnin') {
        const captured = turnInCapture(input, state, step, unknownHistory);
        quest = captured.quest;
        turnsIn = captured.turnsIn;
        carry = captured.carry;
        if (step.anyOf !== null) candidates = namedQuests(step);
      } else if (step.kind === 'abandon') {
        quest = step.questId;
      } else if (step.kind === 'complete') {
        place = killPlaceAt(input, endOf(dest));
        if (step.progress === 'finish') block = completeBlock(input, state, step, unknownHistory, endOf(dest), place);
      } else if (step.kind === 'grind') {
        place = killPlaceAt(input, endOf(dest));
      }
      let finalDest = dest;
      if (dest.kind === 'hearth') {
        finalDest = { kind: 'hearth', end: state.hearth === null ? null : { point: state.hearth, zoneHint: state.hearthHint } };
      }
      const bindBefore = step.kind === 'hearth' && step.mode === 'bind' && step.location === null && state.location !== null ? { point: state.location, zoneHint: state.locationHint } : null;
      const table: TableDraft | null = dest.kind === 'table' ? { index: i, state: cloneState(state), memo: copyMemo(memo), active: record.estimate.active } : null;
      const ridingBefore = state.riding.trained;
      info = {
        index: i,
        step,
        group,
        record,
        active,
        role: 'bound',
        reason: '',
        event: false,
        dest: finalDest,
        walk: walkMode,
        chain: groupId,
        walkedChain,
        quest,
        entersLog,
        block,
        carry,
        turnsIn,
        bindBefore,
        riding: { before: ridingBefore, after: ridingBefore },
        place,
        groupPredicates,
        stepPredicates,
        candidates,
        accept,
        table,
      };
    }
    const replayed = replayStep(replay, i);
    // The replay must agree with the walk (the same engine, context and accept policy).
    if (
      replayed.estimate.active !== record.estimate.active ||
      !sameSeconds(replayed.estimate.duration.value, record.estimate.duration.value) ||
      !sameEnd(replayed.delta.locationAfter, record.delta.locationAfter) ||
      replayed.delta.questId !== record.delta.questId
    ) {
      return fail('failed', `compile's replay of step ${String(i)} disagrees with the walk (is the walk's accept policy in the context?)`);
    }
    if (info !== null) infos.set(i, { ...info, riding: { before: info.riding.before, after: replay.state.riding.trained } });
    if (i === last) {
      endState = cloneState(replay.state);
      endMemo = copyMemo(replay.memo);
    }
  }
  if (endState === null || endMemo === null) return fail('failed', 'the replay did not reach the section end');

  // ---- Classification (§3.1).
  for (let i = first; i <= last; i += 1) {
    const info = infos.get(i);
    if (info === undefined) continue;
    const { step, group } = info;
    const staticFalse = evaluateStaticCondition(group?.rxp?.condition ?? null, subject) === 'false' || evaluateStaticCondition(step.condition, subject) === 'false';
    const skipIf = (step.condition?.skipIf.length ?? 0) > 0 || (group?.rxp?.condition?.skipIf.length ?? 0) > 0;
    let role: Role;
    let reason: string;
    if (staticFalse) [role, reason] = ['inert', 'inert'];
    else if (step.locked) [role, reason] = ['anchor', 'locked'];
    else if (skipIf) [role, reason] = ['anchor', 'conditional'];
    else if ((step.kind === 'accept' || step.kind === 'turnin') && step.anyOf !== null) [role, reason] = ['anchor', 'any-of'];
    else if (step.kind === 'turnin' && step.skipIfMissing) [role, reason] = ['anchor', 'skip-if-missing'];
    else if (step.kind === 'complete' && info.record.estimate.facts.some((fact) => fact.kind === 'complete-not-in-log')) [role, reason] = ['anchor', 'SIM-16'];
    else if (step.kind === 'hearth' || step.kind === 'flight' || step.kind === 'abandon' || step.kind === 'grind') [role, reason] = ['anchor', step.kind];
    else if (step.kind === 'travel' && step.mode === 'transport') [role, reason] = ['anchor', 'transport'];
    else if (step.kind === 'accept' || step.kind === 'complete' || step.kind === 'turnin') [role, reason] = ['host', 'host'];
    else [role, reason] = ['bound', 'bound'];
    const facts = info.record.estimate.facts;
    const event =
      info.active &&
      (info.record.delta.locationAfter === null || facts.some((fact) => fact.kind === 'position-unknown' || fact.kind === 'unresolved-location'));
    infos.set(i, { ...info, role, reason, event });
  }

  // ---- Units (§3.2): each quest step and each non-quest anchor ends a unit; bound steps join the next.
  interface BaseUnit {
    readonly steps: number[];
    readonly anchor: boolean;
  }
  const base: BaseUnit[] = [];
  let pending: number[] = [];
  for (let i = first; i <= last; i += 1) {
    const info = infos.get(i);
    if (info === undefined) continue;
    pending.push(i);
    const head = QUEST_STEP_KINDS.has(info.step.kind) || info.role === 'anchor' || info.role === 'inert';
    if (head) {
      base.push({ steps: pending, anchor: info.role === 'anchor' || info.role === 'inert' });
      pending = [];
    }
  }
  if (pending.length > 0) base.push({ steps: pending, anchor: true });

  // ---- Barriers and blocks (§3.6).
  const stepInfo = (i: number): StepInfo => {
    const info = infos.get(i);
    if (info === undefined) throw new Error(`No step info for ${String(i)}`);
    return info;
  };
  const travelsTo = (unit: BaseUnit): boolean =>
    unit.steps.some((i) => {
      const info = stepInfo(i);
      if (!info.active) return false;
      const d = info.dest;
      return (d.kind === 'loc' && d.end !== null) || d.kind === 'spawn' || (d.kind === 'hearth' && d.end !== null) || d.kind === 'table';
    });
  const endsUnknown = (unit: BaseUnit): boolean => {
    const lastStep = unit.steps.at(-1);
    return lastStep === undefined ? false : records[lastStep]?.delta.locationAfter === null;
  };
  const isBarrier = (unit: BaseUnit): boolean => unit.steps.some((i) => stepInfo(i).event);
  interface Range {
    lo: number;
    hi: number;
    first: boolean;
  }
  const ranges: Range[] = [];
  const count = base.length;
  if (walk.start.location === null && count > 0) {
    let hi = 0;
    while (hi < count - 1 && endsUnknown(base[hi] as BaseUnit)) hi += 1;
    ranges.push({ lo: 0, hi, first: true });
  }
  base.forEach((unit, u) => {
    if (!isBarrier(unit)) return;
    let lo = u;
    let reachedStart = true;
    for (let j = u - 1; j >= 0; j -= 1) {
      lo = j;
      if (travelsTo(base[j] as BaseUnit)) {
        reachedStart = false;
        break;
      }
    }
    if (u === 0) reachedStart = true;
    let hi = u;
    while (hi < count - 1 && endsUnknown(base[hi] as BaseUnit)) hi += 1;
    ranges.push({ lo, hi, first: reachedStart });
  });
  ranges.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  const merged: Range[] = [];
  for (const range of ranges) {
    const top = merged.at(-1);
    if (top !== undefined && range.lo <= top.hi) {
      top.hi = Math.max(top.hi, range.hi);
      top.first = top.first || range.first;
    } else merged.push({ ...range });
  }

  // ---- Pool quests and the final units.
  const poolSet = new Set<QuestId>();
  for (let i = first; i <= last; i += 1) for (const q of namedQuests(stepInfo(i).step)) poolSet.add(q);
  const pool = [...poolSet].sort((a, b) => a - b);
  const questIndex = new Map<QuestId, number>(pool.map((q, k) => [q, k]));
  const unitQuests = (unitSteps: readonly number[]): QuestId[] => {
    const set = new Set<QuestId>();
    for (const i of unitSteps) for (const q of namedQuests(stepInfo(i).step)) set.add(q);
    return [...set].sort((a, b) => a - b);
  };
  const units: UnitDraft[] = [];
  let r = 0;
  for (let u = 0; u < count; ) {
    const range = merged[r];
    if (range !== undefined && range.lo === u) {
      const blockSteps: number[] = [];
      for (let k = range.lo; k <= range.hi; k += 1) blockSteps.push(...(base[k]?.steps ?? []));
      const lastUnit = base[range.hi] as BaseUnit;
      units.push({ steps: blockSteps, anchor: true, block: true, first: range.first, last: range.hi === count - 1 && endsUnknown(lastUnit), quests: unitQuests(blockSteps) });
      u = range.hi + 1;
      r += 1;
      continue;
    }
    const unit = base[u] as BaseUnit;
    units.push({ steps: unit.steps, anchor: unit.anchor, block: false, first: false, last: false, quests: unitQuests(unit.steps) });
    u += 1;
  }

  // ---- Q_ext (§3.4 item 1, §4.4).
  const qExt = new Set<QuestId>();
  const suffixReaders: QuestId[] = [];
  const addPredicateQuests = (condition: RouteStep['condition'], inSuffix: boolean): void => {
    for (const predicate of condition?.skipIf ?? []) {
      if (predicate.kind !== 'questState') continue;
      for (const q of predicate.questIds) qExt.add(q);
      if (inSuffix && predicate.state === 'available') suffixReaders.push(...predicate.questIds);
    }
  };
  steps.forEach((step, i) => {
    const inSuffix = i > last;
    if (i < first || inSuffix) {
      for (const q of namedQuests(step)) qExt.add(q);
      if (inSuffix && (step.kind === 'accept' || step.kind === 'turnin') && step.anyOf !== null) suffixReaders.push(...namedQuests(step));
    }
    addPredicateQuests(step.condition, inSuffix);
  });
  for (const [key, group] of Object.entries(route.groups)) {
    if (!Object.hasOwn(route.groups, key)) continue;
    const condition = group.rxp?.condition ?? null;
    if (condition === null) continue;
    const inSuffix = steps.some((step, i) => i > last && step.groupId === group.id);
    addPredicateQuests(condition, inSuffix);
  }
  const depsOf = (q: QuestId): QuestId[] => {
    const deps = input.availability.dependencies(q);
    const out: QuestId[] = [...deps.completed.flat(), ...deps.inLog, ...deps.takenOrDone, ...deps.blockers];
    if (deps.parent !== null) out.push(deps.parent);
    const target = deps.breadcrumbTarget;
    if (target !== null) out.push(target.questId, ...target.dependencies.completed.flat(), ...target.dependencies.inLog, ...target.dependencies.takenOrDone, ...target.dependencies.blockers);
    return out;
  };
  for (const q of suffixReaders) for (const d of depsOf(q)) qExt.add(d);

  // ---- Obligations (§3.4).
  const obligatory = new Set<QuestId>();
  const startState = walk.start;
  const records0 = (i: number): StepRecord => records[i] as StepRecord;
  const curve = xpCurveOf(context.rules);
  const quests: QuestDraft[] = pool.map((id) => {
    const record = context.dataset.quest(id);
    const xp = questXp({ questId: id, xp: record?.xp ?? null, requiredLevel: record?.minLevel ?? null, dungeonQuest: record?.dungeonQuest ?? false, playerLevel: startState.level }, context.rules);
    const startStatus: 0 | 1 | 2 | 3 = startState.questLog.has(id) ? 1 : startState.completed.has(id) ? 2 : startState.abandoned.has(id) ? 3 : startState.acceptedInRoute.has(id) ? 2 : 0;
    const questUnits: number[] = [];
    units.forEach((unit, u) => {
      if (unit.quests.includes(id)) questUnits.push(u);
    });
    return { id, record, units: questUnits, startStatus, unknownXp: record === undefined || xp.xp.value === null };
  });
  const carried: QuestId[] = [];
  for (let i = first; i <= last; i += 1) {
    for (const fact of records0(i).estimate.facts) if (fact.kind === 'objectives-carried' && !carried.includes(fact.questId)) carried.push(fact.questId);
  }
  carried.sort((a, b) => a - b);
  // Item 6: suffix accepts that depend on a pool quest positively (and minimum-reputation rewards).
  const suffixPositive = new Set<QuestId>();
  const suffixFactions = new Set<number>();
  for (let i = last + 1; i < steps.length; i += 1) {
    const step = steps[i];
    if (step === undefined || step.kind !== 'accept') continue;
    for (const q of namedQuests(step)) {
      const deps = input.availability.dependencies(q);
      for (const d of [...deps.completed.flat(), ...deps.inLog, ...deps.takenOrDone]) suffixPositive.add(d);
      if (deps.parent !== null) suffixPositive.add(deps.parent);
      for (const f of deps.minReputation) suffixFactions.add(f);
      const target = deps.breadcrumbTarget;
      if (target !== null) {
        for (const d of [...target.dependencies.completed.flat(), ...target.dependencies.inLog, ...target.dependencies.takenOrDone]) suffixPositive.add(d);
        for (const f of target.dependencies.minReputation) suffixFactions.add(f);
      }
    }
  }
  // Item 9: the unit that walked a group's waypoints, when the group continues into the suffix.
  const walkedUnits = new Set<number>();
  units.forEach((unit, u) => {
    for (const i of unit.steps) {
      const info = stepInfo(i);
      if (!info.walkedChain || info.chain === null) continue;
      const continues = steps.some((step, k) => k > last && step.groupId === info.chain);
      if (continues) walkedUnits.add(u);
    }
  });
  for (const quest of quests) {
    const q = quest.id;
    const reasons: boolean[] = [
      qExt.has(q),
      quest.units.some((u) => units[u]?.anchor === true),
      quest.units.some((u) => (units[u]?.steps ?? []).some((i) => stepInfo(i).role === 'bound' && (stepInfo(i).step.kind === 'train' || stepInfo(i).step.kind === 'vendor'))),
      quest.unknownXp || quest.record?.flags.repeatable === true,
      quest.units.some((u) => (units[u]?.steps ?? []).some((i) => stepInfo(i).active && records0(i).estimate.duration.value === null)),
      suffixPositive.has(q) || (quest.record?.reputationReward.some((reward) => reward.value > 0 && suffixFactions.has(reward.factionId)) ?? false),
      !untouched(startState, q) || !quest.units.some((u) => (units[u]?.steps ?? []).some((i) => stepInfo(i).step.kind === 'accept' && stepInfo(i).quest === q)),
      carried.includes(q),
      quest.units.some((u) => walkedUnits.has(u)),
    ];
    if (reasons.some(Boolean)) obligatory.add(q);
  }
  // All or none: a unit shared by an obligatory quest makes its other quests obligatory too.
  for (let changed = true; changed; ) {
    changed = false;
    for (const unit of units) {
      if (!unit.quests.some((q) => obligatory.has(q))) continue;
      for (const q of unit.quests) {
        if (!obligatory.has(q)) {
          obligatory.add(q);
          changed = true;
        }
      }
    }
  }

  // ---- Summary figures.
  const barrierSteps: number[] = [];
  for (let i = first; i <= last; i += 1) if (stepInfo(i).event) barrierSteps.push(i);
  const firstRecord = records0(first);
  const lastRecord = records0(last);
  let sectionMs = (lastRecord.estimate.endSec - firstRecord.estimate.startSec) * 1000;
  for (const i of chain) sectionMs += (records0(i).estimate.breakdown.travel + records0(i).estimate.breakdown.waiting) * 1000;
  const total = (state: ReadonlyCharacterState): number => cumulativeXp(curve, Math.min(state.level, curve.cumulative.length)) + state.xp;
  const originalGain = total(endState) - total(startState);
  const targetXp = input.goal.targetXp === 'keep-original' ? originalGain : input.goal.targetXp;
  let castWindowStart = first;
  for (let i = first - 1; i >= 0; i -= 1) {
    const step = steps[i];
    const record = records[i];
    if (step?.kind === 'hearth' && step.mode === 'use' && record !== undefined && record.estimate.active !== false && !record.estimate.facts.some((fact) => fact.kind === 'hearth-unbound')) {
      castWindowStart = i;
      break;
    }
  }
  const unknownXpQuests = quests.filter((quest) => quest.unknownXp).map((quest) => quest.id);
  const summary: ContractSummary = {
    qExt: [...qExt].filter((q) => poolSet.has(q)).sort((a, b) => a - b),
    pool,
    obligatory: [...obligatory].sort((a, b) => a - b),
    unknownXp: unknownXpQuests,
    carried,
    barriers: barrierSteps,
    targetXp,
    firstSuffixIndex: last + 1,
    exitChain: chain,
    original: { sectionPlusExitMs: sectionMs, readyAt: endState.hearthReadyAt },
  };

  // ---- ENG-01 guard (§5.3): instance entrances are not priced by the optimiser yet.
  if (context.graph.entrances.length > 0) {
    for (const info of infos.values()) {
      const d = info.dest;
      const end = d.kind === 'loc' || d.kind === 'hearth' ? d.end : null;
      if (end !== null && isInstanceMap(context.graph, end.point.mapId)) return fail('failed', 'instance entrances are not priced by the optimiser yet (ENG-01)');
    }
  }

  return {
    input,
    walk,
    first,
    last,
    steps: infos,
    chain,
    units,
    quests,
    questIndex,
    qExt,
    obligatory,
    carried,
    barrierSteps,
    chains,
    chainIndex,
    startState,
    endState,
    endMemo,
    spawnChooser: new SpawnChooser(walk.places),
    subject,
    unknownHistory,
    castWindowStart,
    summary,
  };
}

// =============================================================================================
// Analysis entry point

/** What `analyseSection` keeps for `compileProblem` (opaque to callers). */
export interface AnalysisInternal {
  readonly structure: Structure;
  readonly geometry: Geometry;
}

/**
 * `analyseSection` (§5.1 step 2): classifies the section's steps, builds units, blocks, quests and
 * edges, interns locations and lists the legs the matrix needs. Navigation changes only seconds, so
 * this structure does not depend on the legs.
 */
export function analyseSection(input: CompileInput): SectionAnalysis | CompileFailure {
  const structure = buildStructure(input, input.walk);
  if (!('input' in structure)) return structure;
  const geometry = collectGeometry(structure);
  if (!('pairs' in geometry)) return geometry;
  const pairs: TravelPair[] = [...geometry.pairs];
  // The cast window's legs (§5.1 step 3): the time since the last cast is priced from complete legs.
  if (structure.castWindowStart < structure.first) {
    const { index, table } = geometry.locations;
    const n = table.count;
    const matrixPairs = new Set(geometry.matrixPairs);
    const seen = new Set<string>();
    for (let i = structure.castWindowStart; i < structure.first; i += 1) {
      for (const pair of input.walk.records[i]?.legsAsked ?? []) {
        const fromKey = endpointKey(pair.from);
        const toKey = endpointKey(pair.to);
        const from = index.get(fromKey);
        const to = index.get(toKey);
        if (from !== undefined && to !== undefined && matrixPairs.has(from * n + to)) continue;
        const key = `${fromKey}>${toKey}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push(pair);
      }
    }
  }
  const internal: AnalysisInternal = { structure, geometry };
  return { ok: true, pairs, castWindowStart: structure.castWindowStart, summary: structure.summary, internal };
}
