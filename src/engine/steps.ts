import type { Truth } from '../domain/conditions';
import type { EntityRef, QuestRecord } from '../domain/dataset';
import type { Estimated } from '../domain/estimate';
import type { QuestId } from '../domain/ids';
import type { Location, WorldPoint } from '../domain/points';
import type {
  AbandonStep,
  AcceptStep,
  CompleteStep,
  FlightStep,
  GrindStep,
  HearthStep,
  NoteStep,
  RouteGroup,
  RouteStep,
  TrainStep,
  TravelStep,
  TurnInStep,
} from '../domain/route';
import type { TravelEndpoint } from '../domain/travel';
import {
  findTaxiNodes,
  instanceKindOf,
  nearestTaxiNode,
  resolveTaxiNodeRef,
  type TaxiNode,
  type TaxiNodeLookup,
  transportEdges,
  type TransportEdge,
  type TravelGraph,
  withDeparture,
} from '../rules/travel-graph';
import type { RuleKey } from '../rules/ruleset';
import { applyDurationOverride, type StepEstimate, stepDuration, type TimePart } from '../sim/estimate';
import type { SimFact, SimFactKind } from '../sim/facts';
import { grind } from '../sim/grind';
import { hearthUse } from '../sim/hearth';
import type { Interaction } from '../sim/interaction';
import type { KillPlace } from '../sim/kill-xp';
import { type ObjectiveWork, partialWork } from '../sim/objectives';
import { type Basis, sumEstimates } from '../sim/provenance';
import { flightTime, type LocalTaxiData, nearestLocalTaxiNode } from '../sim/taxi';
import { transportCrossing } from '../sim/transport';
import { type GroundTravel, groundTravel, type StepSpeeds, trainRiding } from '../sim/travel';
import { grantXp } from '../sim/xp';
import { evaluateFilter, evaluateSkipIf, or3 } from './conditions';
import { newStepWork, reportUnresolved, type StepWork, type WalkEnv, ZERO_XP } from './env';
import { here, reportUnknownPosition, setLocation, unknownTravel, walkTo } from './movement';
import { newLogEntry, type VisitKey, type WalkMemo } from './state';
import type { CharacterState, QuestLogEntry, StepDelta, StepRecord } from './types';

/**
 * One step of the walk (docs/ARCHITECTURE.md §9.2; docs/SIMULATION.md §6, §7.1): its activity
 * from its conditions, its travel, its work priced by `src/sim`, and its effect on the state.
 */

const NONE: readonly never[] = [];
const ACCEPT_FIRST: Interaction = { kind: 'accept', firstInVisit: true };
const ACCEPT_FURTHER: Interaction = { kind: 'accept', firstInVisit: false };
const TURNIN: Interaction = { kind: 'turnin', rewardChoice: false };
const TURNIN_REWARD: Interaction = { kind: 'turnin', rewardChoice: true };
const ABANDON: Interaction = { kind: 'abandon' };
const BIND: Interaction = { kind: 'bind' };
const TRAIN: Interaction = { kind: 'train' };
const FLIGHT_MASTER: Interaction = { kind: 'flight-master' };
const UNKNOWN_SECONDS: Estimated<number> = { value: null, basis: 'unknown', eraFallback: false };

// =============================================================================================
// Activity (ARCHITECTURE §9.2; RXP.md §14 rows 5-6)

/**
 * Whether the step runs: false when a filter or variant entry fails or a skip predicate holds,
 * `'unknown'` when something cannot be decided (the step runs, with SIM-13), else true. A group's
 * skip predicates are decided once, when the group's first step is reached, and apply to all of
 * its steps.
 */
export function stepActivity(env: WalkEnv, state: CharacterState, memo: WalkMemo, step: RouteStep, group: RouteGroup | null): boolean | 'unknown' {
  const groupCondition = group?.rxp?.condition ?? null;
  const groupStatic = env.staticTruth(groupCondition);
  if (groupStatic === 'false') return false;
  let skip: Truth = 'false';
  if (group !== null && groupCondition !== null && groupCondition.skipIf.length > 0) {
    // Decided when the group's first step is reached, even if that step's own line filter drops it.
    let decided = memo.groupSkip.get(group.id);
    if (decided === undefined) {
      decided = evaluateSkipIf(groupCondition.skipIf, state, env.predicates);
      memo.groupSkip.set(group.id, decided);
    }
    skip = decided;
  }
  const stepStatic = env.staticTruth(step.condition);
  if (stepStatic === 'false') return false;
  if (step.condition !== null && step.condition.skipIf.length > 0) skip = or3([skip, evaluateSkipIf(step.condition.skipIf, state, env.predicates)]);
  if (skip === 'true') return false;
  return groupStatic === 'unknown' || stepStatic === 'unknown' || skip === 'unknown' ? 'unknown' : true;
}

// =============================================================================================
// Places of a step

const DEATHSKIP = /^\s*\.deathskip\b/i;

/** A preserved RXP `.deathskip` line: the position becomes unknown (ARCHITECTURE §8.1). */
export function isDeathSkip(step: NoteStep): boolean {
  const preserved = step.preserved;
  if (preserved === null || preserved.format !== 'rxp') return false;
  return preserved.lines.some((line) => DEATHSKIP.test(line)) || DEATHSKIP.test(step.text);
}

const samePlace = (a: WorldPoint | null, b: WorldPoint | null): boolean =>
  a === b || (a !== null && b !== null && a.mapId === b.mapId && a.x === b.x && a.y === b.y);

/** Whether two accepts are at the same place (TIME-8): the same entity, or the same resolved point. */
function sameVisit(a: VisitKey | null, b: VisitKey | null): boolean {
  if (a === null || b === null) return false;
  if (a === b) return true;
  if ('mapId' in a) return 'mapId' in b && samePlace(a, b);
  return !('mapId' in b) && a.kind === b.kind && a.id === b.id;
}

/** Where a quest step goes when it has no location of its own (TIME-2): an entity, or a custom quest's location. */
type QuestTarget = EntityRef | Location | null;

/** The one entity a quest step names: `via`, or the quest's only starter (or finisher); else a custom quest's location. */
function questTarget(env: WalkEnv, questId: QuestId, via: EntityRef | null, side: 'starters' | 'finishers'): QuestTarget {
  if (via !== null) return via;
  const refs = env.dataset.quest(questId)?.[side] ?? NONE;
  if (refs.length === 1) return refs[0] ?? null;
  if (refs.length === 0) {
    const custom = env.customQuests.get(questId);
    const location = side === 'starters' ? custom?.starterLocation : custom?.finisherLocation;
    if (location !== undefined && location !== null) return location;
  }
  return null;
}

/** Walks a group's `leg` waypoints, in order, before its first located step (ARCHITECTURE §9.2). */
function walkWaypoints(env: WalkEnv, state: CharacterState, memo: WalkMemo, work: StepWork, group: RouteGroup | null, speeds: StepSpeeds): void {
  const rxp = group?.rxp ?? null;
  if (group === null || rxp === null || rxp.waypoints.length === 0 || memo.waypointsDone.has(group.id)) return;
  memo.waypointsDone.add(group.id);
  let unknownFilter = false;
  for (const waypoint of rxp.waypoints) {
    if (waypoint.role !== 'leg') continue;
    if (waypoint.filter !== null) {
      const truth = evaluateFilter(waypoint.filter, env.subject);
      if (truth === 'false') continue;
      if (truth === 'unknown') unknownFilter = true;
    }
    const endpoint = env.places.point(waypoint.point);
    if (endpoint === null) reportUnresolved(work);
    walkTo(env, state, memo, work, endpoint, waypoint.radius !== null && waypoint.radius > 0 ? waypoint.radius : null, speeds, 'waypoint');
  }
  if (unknownFilter) work.facts.push({ kind: 'condition-unknown' });
}

/** Moves to the step's own location, through its group's leg waypoints first; no-op without a location. */
function goToLocation(env: WalkEnv, state: CharacterState, memo: WalkMemo, work: StepWork, step: RouteStep, group: RouteGroup | null, speeds: StepSpeeds): boolean {
  if (step.location === null) return false;
  walkWaypoints(env, state, memo, work, group, speeds);
  const endpoint = env.places.location(step.location);
  if (endpoint === null) reportUnresolved(work);
  walkTo(env, state, memo, work, endpoint, step.location.radius, speeds, 'step');
  return true;
}

/**
 * Moves to where a quest step happens: its location, else its entity's nearest spawn (SIM-3 when
 * no spawn resolves), else a custom quest's location. Returns the visit key (TIME-8).
 */
function goToQuestPlace(
  env: WalkEnv,
  state: CharacterState,
  memo: WalkMemo,
  work: StepWork,
  step: RouteStep,
  group: RouteGroup | null,
  speeds: StepSpeeds,
  target: QuestTarget,
): VisitKey | null {
  if (goToLocation(env, state, memo, work, step, group, speeds)) return state.location;
  if (target === null) return null;
  if ('source' in target) {
    const endpoint = env.places.location(target);
    if (endpoint === null) reportUnresolved(work);
    walkTo(env, state, memo, work, endpoint, target.radius, speeds, 'step');
    return state.location;
  }
  const choice = env.places.nearestSpawn(target, state.location);
  if (choice.kind === 'none') return target;
  if (choice.kind === 'several') {
    // From an unknown position the nearest spawn is undefined: where the step happens stays unknown (TIME-2).
    reportUnknownPosition(state, work);
    unknownTravel(work);
    setLocation(state, memo, null, 'several-spawns');
    return target;
  }
  if (choice.kind === 'unresolved') reportUnresolved(work);
  walkTo(env, state, memo, work, choice.kind === 'spawn' ? choice.endpoint : null, null, speeds, 'step');
  return target;
}

// =============================================================================================
// XP and quest state

/**
 * A grant of known XP (XP-2). The level after it also reads the XP table, and the cap when the cap
 * bounded the grant (SIMULATION §8, XP-1..3): see `levelRead`.
 */
function grant(env: WalkEnv, state: CharacterState, work: StepWork, amount: Estimated<number>): void {
  if (amount.value === null || amount.value <= 0) return;
  const result = grantXp(env.curve, state, amount.value);
  state.level = result.level;
  state.xp = result.xp;
  combineXpBasis(state, amount);
  levelRead(env, state, work, result.discarded > 0);
}

/**
 * The level after a grant reads the XP table (`xpToNextLevel`, `era-assumed` in `forever-beta`) and,
 * when the cap bounded the grant, `maxLevel` (an assumption when the project sets it): their
 * provenance joins the level's, and their marked keys the step's `assumptionsUsed` (SIMULATION §8).
 */
function levelRead(env: WalkEnv, state: CharacterState, work: StepWork, capped: boolean): void {
  const inputs = env.levelInputs;
  foldLevelBasis(state, inputs.table);
  if (inputs.tableKeys.length > 0) work.used.push(inputs.tableKeys);
  if (!capped) return;
  foldLevelBasis(state, inputs.cap);
  if (inputs.capKeys.length > 0) work.used.push(inputs.capKeys);
}

function foldLevelBasis(state: CharacterState, input: Basis): void {
  if (input.basis === 'assumption') state.xpBasis = 'assumption';
  if (input.eraFallback) state.xpEraFallback = true;
}

/**
 * Folds one XP grant's provenance into the state's (SIMULATION §8): `combine` of the two, computed,
 * so `assumption` if either is one, else `derived`; `eraFallback` if either has it. Inlined for the
 * walk's hot path; `combine` gives the same result.
 */
function combineXpBasis(state: CharacterState, amount: Estimated<number>): void {
  state.xpBasis = state.xpBasis === 'assumption' || amount.basis === 'assumption' ? 'assumption' : 'derived';
  if (amount.eraFallback) state.xpEraFallback = true;
}

/** Whether the route has never touched a quest (the "quests the route never accepted" of ARCHITECTURE §9.4). */
function untouched(state: CharacterState, questId: QuestId): boolean {
  return !state.questLog.has(questId) && !state.completed.has(questId) && !state.abandoned.has(questId) && !state.acceptedInRoute.has(questId);
}

/**
 * With `priorHistory: 'unknown'`, a quest the route never touched is assumed to have been in the
 * log before the route (ARCHITECTURE §9.4): it is put in the log and recorded in the delta.
 */
function assumeInLog(env: WalkEnv, state: CharacterState, work: StepWork, questId: QuestId): boolean {
  if (env.project.character.priorHistory !== 'unknown' || !untouched(state, questId)) return false;
  state.questLog.set(questId, newLogEntry(env.dataset.quest(questId), false));
  (work.assumedInLog ??= []).push(questId);
  return true;
}

function markDone(work: StepWork, questId: QuestId, objective: number): void {
  (work.objectivesDone ??= []).push({ questId, objective });
}

function interaction(env: WalkEnv, work: StepWork, kind: Interaction): void {
  const time = env.sim.interaction(kind);
  work.parts.push(time.part);
  if (time.used.length > 0) work.used.push(time.used);
}

function candidatesOf(step: AcceptStep | TurnInStep): readonly QuestId[] {
  if (step.anyOf === null) return [step.questId];
  return [step.questId, ...step.anyOf.filter((id) => id !== step.questId)];
}

// =============================================================================================
// Step kinds

function accept(env: WalkEnv, state: CharacterState, memo: WalkMemo, work: StepWork, step: AcceptStep, group: RouteGroup | null, speeds: StepSpeeds): void {
  // SIMULATION §7.2: the first candidate that raises no error; if none, the step is a single accept of questId.
  let chosen = step.questId;
  if (step.anyOf !== null) {
    for (const candidate of candidatesOf(step)) {
      if (env.acceptPolicy.acceptable(candidate, state) === 'false') continue;
      chosen = candidate;
      break;
    }
  }
  work.questId = chosen;
  const before = state.location;
  const key = goToQuestPlace(env, state, memo, work, step, group, speeds, questTarget(env, chosen, step.via, 'starters'));
  const moved = !samePlace(before, state.location) || work.legs.length > 0;
  interaction(env, work, moved || !sameVisit(memo.visitKey, key) ? ACCEPT_FIRST : ACCEPT_FURTHER);
  memo.visitKey = key;
  if (!state.questLog.has(chosen)) {
    const entry = newLogEntry(env.dataset.quest(chosen), true);
    state.questLog.set(chosen, entry);
    work.accepted = chosen;
    countItemsBeforeAccept(state, work, chosen, entry);
  }
  state.acceptedInRoute.add(chosen);
}

/**
 * TIME-10, TIME-11 (D-040): the items a `complete` step collected while the quest was not in the
 * log are in the bags, so the accept marks those `item` objectives done: neither a later step nor
 * the turn-in prices them again. Kill, use and event work before the accept does not count toward
 * the quest, so it stays open.
 */
function countItemsBeforeAccept(state: CharacterState, work: StepWork, questId: QuestId, entry: QuestLogEntry): void {
  const items = state.itemsBeforeAccept.get(questId);
  if (items === undefined) return;
  state.itemsBeforeAccept.delete(questId);
  const counted: number[] = [];
  for (const index of items) {
    if (entry.objectives[index] !== 'open') continue;
    entry.objectives[index] = 'done';
    markDone(work, questId, index);
    counted.push(index);
  }
  if (counted.length > 0) work.facts.push({ kind: 'objectives-before-accept', questId, objectives: counted });
}

/** Remembers an `item` objective a `complete` step priced while its quest was not in the log. */
function rememberItems(state: CharacterState, questId: QuestId, index: number): void {
  const known = state.itemsBeforeAccept.get(questId) ?? NONE;
  if (known.includes(index)) return;
  state.itemsBeforeAccept.set(questId, [...known, index].sort((a, b) => a - b));
}

/** The turn-in candidate: the first in the log and not failed, else (unknown history) the first the route never touched. */
function turnInChoice(env: WalkEnv, state: CharacterState, step: TurnInStep): QuestId | null {
  if (step.anyOf === null) {
    if (state.questLog.get(step.questId)?.failed === false) return step.questId;
    return env.project.character.priorHistory === 'unknown' && untouched(state, step.questId) ? step.questId : null;
  }
  const candidates = candidatesOf(step);
  const inLog = candidates.find((id) => state.questLog.get(id)?.failed === false);
  if (inLog !== undefined) return inLog;
  if (env.project.character.priorHistory !== 'unknown') return null;
  return candidates.find((id) => untouched(state, id)) ?? null;
}

function turnIn(env: WalkEnv, state: CharacterState, memo: WalkMemo, work: StepWork, step: TurnInStep, group: RouteGroup | null, speeds: StepSpeeds): void {
  const chosen = turnInChoice(env, state, step);
  const questId = chosen ?? step.questId;
  work.questId = questId;
  goToQuestPlace(env, state, memo, work, step, group, speeds, questTarget(env, questId, step.via, 'finishers'));
  interaction(env, work, step.rewardIndex !== null ? TURNIN_REWARD : TURNIN);
  if (chosen === null) return; // not in the log: VAL-30 is the validator's; nothing changes
  if (!state.questLog.has(chosen)) assumeInLog(env, state, work, chosen);
  const entry = state.questLog.get(chosen);
  if (entry === undefined || entry.failed) return;
  const record = env.dataset.quest(chosen);
  let open: number[] | null = null;
  for (let index = 0; index < entry.objectives.length; index += 1) {
    if (entry.objectives[index] !== 'open') continue;
    (open ??= []).push(index);
    markDone(work, chosen, index);
  }
  // TIME-11 (D-040): the work of objectives no step finished is carried by the turn-in when an
  // accept step of the route put the quest in the log; otherwise (a pre-route or assumed entry,
  // whose progress is unknown) they are assumed completed incidentally, at 0 s and 0 kill XP.
  // Items collected before the accept were marked done by it, so they are not open here.
  let killXp: Estimated<number> | null = null;
  if (open !== null && entry.routeAccepted && record !== undefined) {
    const carried = carryWork(env, state, work, record, open);
    killXp = carried.killXp;
    // TIME-8: a valid override replaces the carried time, as runStep applies it.
    const time = overrides(step.durationOverride) ? 'overridden' : carried.seconds.value === null ? 'unknown' : 'counted';
    work.facts.push({
      kind: 'objectives-carried',
      questId: chosen,
      objectives: open,
      time,
      killXp,
      level: state.level,
      levelBasis: state.xpBasis,
      levelEraFallback: state.xpEraFallback,
    });
  } else if (open !== null) work.facts.push({ kind: 'objectives-incidental', questId: chosen, objectives: open });
  const xp = env.sim.questXp({
    questId: chosen,
    xp: record?.xp ?? null,
    requiredLevel: record?.minLevel ?? null,
    dungeonQuest: record?.dungeonQuest ?? false,
    playerLevel: state.level,
  });
  if (xp.used.length > 0) work.used.push(xp.used);
  for (const fact of xp.facts) work.facts.push(fact);
  if (xp.xp.value === null) state.unknownXpEvents += 1;
  else grant(env, state, work, xp.xp);
  // The step's XP is its kill XP and its quest XP; unknown quest XP makes the sum unknown (the known
  // kill XP is still granted, as TIME-13 keeps a step's known seconds).
  work.xpGained = killXp === null ? xp.xp : sumEstimates([killXp, xp.xp]);
  state.questLog.delete(chosen);
  state.completed.add(chosen);
  work.turnedIn = chosen;
  for (const reward of record?.reputationReward ?? NONE) {
    state.reputationDelta.set(reward.factionId, (state.reputationDelta.get(reward.factionId) ?? 0) + reward.value);
  }
}

/**
 * TIME-11 (D-040): a turn-in carries the work of its quest's open objectives, priced as a
 * multi-target `complete` (TIME-9, TIME-10) at the character's level at the turn-in and, as a
 * `complete` step without a location, at no point: the open world for kill XP (KXP-5) and the
 * lowest drop NPC id for items. Where the work was done is not known; the turn-in's place is not it.
 * The kill XP is granted before the quest XP, as a `complete` step before the turn-in would be.
 * Travel to the objectives is not priced. Returns the block's time and kill XP.
 */
function carryWork(env: WalkEnv, state: CharacterState, work: StepWork, record: QuestRecord, open: readonly number[]): { readonly seconds: Estimated<number>; readonly killXp: Estimated<number> } {
  const at = null;
  const place = killPlace(env.graph, at);
  const works: ObjectiveWork[] = [];
  for (const index of open) {
    const objective = record.objectives[index];
    works.push(
      objective === undefined
        ? unpriceable(record.id, index)
        : env.sim.objective({ questId: record.id, index, objective, countOverride: null, playerLevel: state.level, at, place }),
    );
  }
  const block = env.sim.complete(works);
  if (block.used.length > 0) work.used.push(block.used);
  for (const fact of block.facts) work.facts.push(fact);
  work.parts.push({ bucket: 'objective', seconds: block.seconds });
  grant(env, state, work, block.killXp);
  return { seconds: block.seconds, killXp: block.killXp };
}

function abandon(env: WalkEnv, state: CharacterState, memo: WalkMemo, work: StepWork, step: AbandonStep, group: RouteGroup | null, speeds: StepSpeeds): void {
  work.questId = step.questId;
  goToLocation(env, state, memo, work, step, group, speeds);
  interaction(env, work, ABANDON);
  if (!state.questLog.has(step.questId) && !assumeInLog(env, state, work, step.questId)) return;
  state.questLog.delete(step.questId);
  state.abandoned.add(step.questId);
  work.abandoned = step.questId;
}

/** The index of the first target of `step` naming `questId`. */
function firstTargetOf(step: CompleteStep, questId: QuestId): number {
  for (let i = 0; i < step.targets.length; i += 1) if (step.targets[i]?.questId === questId) return i;
  return -1;
}

/**
 * A target whose work cannot be priced (a quest the dataset does not know, or an objective index
 * its record lacks): unknown time and no kill XP, so the block's time is unknown and its kill XP is
 * taken over the known targets with `f = 1` (TIME-10). DATA002 or DATA003 says why.
 */
function unpriceable(questId: QuestId, index: number): ObjectiveWork {
  return { questId, index, seconds: UNKNOWN_SECONDS, killXp: ZERO_XP, workCount: null, npcId: null, used: NONE, facts: NONE };
}

/** KXP-5: where kills at `at` happen (the open world without a location, or off instance maps). */
function killPlace(graph: TravelGraph, at: WorldPoint | null): KillPlace {
  const kind = at === null ? null : instanceKindOf(graph, at.mapId);
  return kind ?? 'open-world';
}

/** TIME-9: one objective's work, added once per quest and objective. */
function addWork(env: WalkEnv, works: ObjectiveWork[], record: QuestRecord, index: number, playerLevel: number, at: WorldPoint | null, place: KillPlace): void {
  const objective = record.objectives[index];
  if (objective === undefined) return;
  for (const work of works) if (work.questId === record.id && work.index === index) return;
  works.push(env.sim.objective({ questId: record.id, index, objective, countOverride: null, playerLevel, at, place }));
}

/** TIME-9, TIME-10, TIME-11: a `complete` step's objective work. */
function complete(env: WalkEnv, state: CharacterState, memo: WalkMemo, work: StepWork, step: CompleteStep, group: RouteGroup | null, speeds: StepSpeeds): void {
  const playerLevel = state.level;
  goToLocation(env, state, memo, work, step, group, speeds);
  const at = step.location === null ? null : state.location;
  const place = killPlace(env.graph, at);
  // Quests the step works on that are in the log (or, with an unknown history, assumed to be).
  const inLog: QuestId[] = [];
  for (let i = 0; i < step.targets.length; i += 1) {
    const questId = step.targets[i]?.questId;
    if (questId === undefined || firstTargetOf(step, questId) !== i) continue;
    if (state.questLog.has(questId) || assumeInLog(env, state, work, questId)) inLog.push(questId);
    else work.facts.push({ kind: 'complete-not-in-log', questId });
  }
  if (step.progress === 'partial') {
    const partial = partialWork(step.durationOverride);
    work.parts.push({ bucket: 'objective', seconds: partial.seconds });
    return;
  }
  const works: ObjectiveWork[] = [];
  let unknowns: ObjectiveWork[] | null = null;
  for (const target of step.targets) {
    const record = env.dataset.quest(target.questId);
    const entry = inLog.includes(target.questId) ? state.questLog.get(target.questId) : undefined;
    if (record === undefined) {
      // A quest the dataset does not know: its objectives, and so their work, are unknown.
      (unknowns ??= []).push(unpriceable(target.questId, target.objective ?? -1));
      continue;
    }
    const count = record.objectives.length;
    if (target.objective === null) {
      let open = 0;
      for (let index = 0; index < count; index += 1) {
        if (entry?.objectives[index] === 'done') continue;
        open += 1;
        addWork(env, works, record, index, playerLevel, at, place);
      }
      if (count > 0 && open === 0) work.facts.push({ kind: 'objective-already-done', questId: target.questId, objective: null });
    } else if (!Number.isInteger(target.objective) || target.objective < 0 || target.objective >= count) {
      // An objective the quest record does not have: its work cannot be priced.
      (unknowns ??= []).push(unpriceable(target.questId, target.objective));
    } else if (entry?.objectives[target.objective] === 'done') {
      work.facts.push({ kind: 'objective-already-done', questId: target.questId, objective: target.objective });
    } else {
      addWork(env, works, record, target.objective, playerLevel, at, place);
    }
  }
  const block = env.sim.complete(unknowns === null ? works : [...works, ...unknowns]);
  if (block.used.length > 0) work.used.push(block.used);
  for (const fact of block.facts) work.facts.push(fact);
  work.parts.push({ bucket: 'objective', seconds: block.seconds });
  for (const done of works) {
    const entry = inLog.includes(done.questId) ? state.questLog.get(done.questId) : undefined;
    if (entry === undefined) {
      // SIM-16: nothing is marked, but collected items stay in the bags until the accept (D-040).
      if (env.dataset.quest(done.questId)?.objectives[done.index]?.kind === 'item') rememberItems(state, done.questId, done.index);
      continue;
    }
    entry.objectives[done.index] = 'done';
    markDone(work, done.questId, done.index);
  }
  grant(env, state, work, block.killXp);
  work.xpGained = block.killXp;
}

/** TIME-7: the priced crossing of one transport edge, from the current position. */
interface PricedCrossing {
  readonly edge: TransportEdge | null;
  readonly walk: GroundTravel;
  readonly dock: TravelEndpoint | null;
  readonly arrival: TravelEndpoint | null;
  /** The walk from the arrival dock to the step's location, when both are on one map. */
  readonly onward: GroundTravel | null;
  readonly parts: readonly TimePart[];
  readonly used: readonly (readonly RuleKey[])[];
  readonly facts: readonly SimFact[];
  /** Known seconds, or null when a part is unknown. */
  readonly total: number | null;
}

function priceCrossing(
  env: WalkEnv,
  state: CharacterState,
  edge: TransportEdge | null,
  dock: TravelEndpoint | null,
  target: TravelEndpoint | null,
  radius: number | null,
  speeds: StepSpeeds,
): PricedCrossing {
  const walk = groundTravel(here(state), dock, null, speeds, env.model, env.rules);
  const crossing = transportCrossing(walk, edge, env.project.character.faction, env.rules);
  const facts: SimFact[] = [...crossing.facts];
  if (walk.outcome === 'cross-map' && state.location !== null && dock !== null) {
    // The dock is on another world map than the character (TIME-7).
    facts.push({ kind: 'cross-world-no-transport', fromMapId: state.location.mapId, toMapId: dock.point.mapId });
  }
  const arrival = edge === null ? null : env.places.dock(edge.to);
  const onward = arrival !== null && target !== null && arrival.point.mapId === target.point.mapId ? groundTravel(arrival, target, radius, speeds, env.model, env.rules) : null;
  const parts: TimePart[] = [...crossing.parts];
  const used: (readonly RuleKey[])[] = [crossing.used];
  if (onward !== null) {
    parts.push({ bucket: 'travel', seconds: onward.seconds });
    used.push(onward.used);
    facts.push(...onward.facts);
  }
  let total: number | null = 0;
  for (const part of parts) total = total === null || part.seconds.value === null ? null : total + part.seconds.value;
  return { edge, walk, dock, arrival, onward, parts, used, facts, total };
}

/** The better of two crossings: known before unknown, then the least total, then the lower edge id. */
function better(a: PricedCrossing, b: PricedCrossing): boolean {
  if ((a.total === null) !== (b.total === null)) return a.total !== null;
  if (a.total !== null && b.total !== null && a.total !== b.total) return a.total < b.total;
  return (a.edge?.id ?? '') < (b.edge?.id ?? '');
}

/** TIME-7: a `travel` step with mode `'transport'`. */
function transport(env: WalkEnv, state: CharacterState, memo: WalkMemo, work: StepWork, step: TravelStep): void {
  const speeds = env.sim.speeds('transport', state.riding);
  const ref = step.transport;
  const target = step.location === null ? null : env.places.location(step.location);
  if (step.location !== null && target === null) reportUnresolved(work);
  const radius = step.location?.radius ?? null;
  let dock: TravelEndpoint | null = null;
  if (ref?.dock !== undefined && ref.dock !== null) {
    dock = env.places.location(ref.dock);
    if (dock === null) reportUnresolved(work);
  }
  const fromMap = dock?.point.mapId ?? state.location?.mapId ?? null;
  const toMap = target?.point.mapId ?? null;
  let best: PricedCrossing | null = null;
  const id = ref?.id ?? null;
  if (id !== null || dock === null) {
    const edges = id === null ? env.graph.transports : transportEdges(env.graph, id);
    for (const candidate of edges) {
      if (fromMap !== null && candidate.from.mapId !== fromMap) continue;
      if (toMap !== null && candidate.to.mapId !== toMap) continue;
      const edge = dock === null ? candidate : withDeparture(candidate, dock.point);
      if (edge === null) continue;
      const priced = priceCrossing(env, state, edge, dock ?? env.places.dock(edge.from), target, radius, speeds);
      if (best === null || better(priced, best)) best = priced;
    }
  }
  const chosen: PricedCrossing | null = best ?? (id === null && dock !== null ? priceCrossing(env, state, null, dock, target, radius, speeds) : null);
  if (chosen === null) {
    // No transport joins the two maps (TIME-7).
    if (state.location !== null && target !== null && state.location.mapId !== target.point.mapId) {
      work.facts.push({ kind: 'cross-world-no-transport', fromMapId: state.location.mapId, toMapId: target.point.mapId });
    }
    reportUnknownPosition(state, work);
    unknownTravel(work);
    setLocation(state, memo, target, 'transport-arrival');
    return;
  }
  const from = here(state);
  for (const part of chosen.parts) work.parts.push(part);
  for (const keys of chosen.used) if (keys.length > 0) work.used.push(keys);
  for (const fact of chosen.facts) work.facts.push(fact);
  if (chosen.walk.outcome === 'from-unknown') reportUnknownPosition(state, work);
  // A seeded dock without a position (TIME-7: none until a dock NPC or the user gives one) is an
  // unresolved place: SIM-3 says why the walk to it is unknown.
  if (chosen.dock === null) reportUnresolved(work);
  if (from !== null && chosen.dock !== null && chosen.walk.outcome === 'leg' && chosen.walk.method !== null) {
    work.legs.push({ from, to: chosen.dock, purpose: 'dock', seconds: chosen.walk.seconds, method: chosen.walk.method, pending: chosen.walk.pending, warnings: chosen.walk.warnings });
  }
  if (chosen.edge === null) {
    // A user-entered dock without a record: the arrival is the step's location (TIME-7); without
    // one it is unknown, and the next located step's move says so (`position-unknown`).
    setLocation(state, memo, target, 'transport-arrival');
    return;
  }
  if (chosen.onward !== null && chosen.arrival !== null && target !== null) {
    if (chosen.onward.outcome === 'leg' && chosen.onward.method !== null) {
      work.legs.push({ from: chosen.arrival, to: target, purpose: 'step', seconds: chosen.onward.seconds, method: chosen.onward.method, pending: chosen.onward.pending, warnings: chosen.onward.warnings });
    }
    setLocation(state, memo, target, 'transport-arrival');
    return;
  }
  // The arrival dock without a position makes the walk on to the step's location unknown (SIM-3).
  if (chosen.arrival === null && target !== null) reportUnresolved(work);
  setLocation(state, memo, chosen.arrival, 'transport-arrival');
  if (target !== null) walkTo(env, state, memo, work, target, radius, speeds, 'step');
}

function travel(env: WalkEnv, state: CharacterState, memo: WalkMemo, work: StepWork, step: TravelStep, group: RouteGroup | null): void {
  if (step.mode === 'transport') {
    transport(env, state, memo, work, step);
    return;
  }
  const speeds = env.sim.speeds(step.mode, state.riding);
  for (const fact of speeds.facts) work.facts.push(fact);
  if (step.location === null) {
    // `.zone`, `.subzone`, `.explore`: somewhere unknown, without an issue (TIME-2).
    unknownTravel(work);
    setLocation(state, memo, null, 'zone-travel');
    return;
  }
  goToLocation(env, state, memo, work, step, group, speeds);
}

function grindStep(env: WalkEnv, state: CharacterState, memo: WalkMemo, work: StepWork, step: GrindStep, group: RouteGroup | null, speeds: StepSpeeds): void {
  goToLocation(env, state, memo, work, step, group, speeds);
  // KXP-5: a grind on an instance map kills dungeon (or raid) mobs.
  const place = killPlace(env.graph, step.location === null ? null : state.location);
  if (state.level > env.curve.cumulative.length) {
    // A level beyond the XP table: nothing about the grind can be computed (XP-3).
    work.parts.push({ bucket: 'combat', seconds: UNKNOWN_SECONDS });
    work.facts.push({ kind: 'time-unknown', part: 'grind', reason: 'above-max-level', questId: null, objective: null });
    return;
  }
  const result = grind({ until: step.until, mobLevel: step.mobLevel, xpPerHour: step.xpPerHour, state, unknownXpEvents: state.unknownXpEvents, place }, env.curve, env.rules);
  if (result.used.length > 0) work.used.push(result.used);
  for (const fact of result.facts) work.facts.push(fact);
  work.parts.push({ bucket: 'combat', seconds: result.seconds });
  if (result.xpGained.value !== null && result.xpGained.value > 0) {
    const levelBefore = state.level;
    state.level = result.state.level;
    state.xp = result.state.xp;
    combineXpBasis(state, result.xpGained);
    levelRead(env, state, work, state.level >= env.curve.maxLevel && levelBefore < env.curve.maxLevel);
  }
  if (result.resetsUnknownXp) {
    state.unknownXpEvents = 0;
    work.unknownXpReset = true;
  }
  work.xpGained = result.xpGained;
}

function hearth(env: WalkEnv, state: CharacterState, memo: WalkMemo, work: StepWork, step: HearthStep, group: RouteGroup | null, speeds: StepSpeeds): void {
  if (step.mode === 'bind') {
    // TIME-4: at the step's location (unresolved: no bind point, SIM-3), or where the character stands.
    goToLocation(env, state, memo, work, step, group, speeds);
    interaction(env, work, BIND);
    state.hearth = state.location;
    state.hearthHint = state.hearth === null ? 0 : state.locationHint;
    work.hearthChanged = true;
    return;
  }
  // TIME-4 use: the destination is the bind point in the state; the step's own location is display-only.
  const bound = state.hearth !== null;
  const sinceCast: Basis = { basis: state.sinceCastBasis, eraFallback: state.sinceCastEraFallback };
  const use = hearthUse({ timeSec: state.timeSec, hearthReadyAt: state.hearthReadyAt, bound, sinceCast }, env.rules);
  for (const part of use.parts) work.parts.push(part);
  if (use.used.length > 0) work.used.push(use.used);
  for (const fact of use.facts) work.facts.push(fact);
  state.hearthReadyAt = use.readyAt;
  work.hearthCast = bound;
  setLocation(state, memo, state.hearth === null ? null : { point: state.hearth, zoneHint: state.hearthHint }, 'hearth-unbound');
}

/** A taxi lookup as one node, recording SIM-8 for the given end when it is none or several. */
function oneNode(work: StepWork, lookup: TaxiNodeLookup, end: 'from' | 'to'): TaxiNode | null {
  if (lookup.kind === 'node') return lookup.node;
  work.facts.push({ kind: 'flight-unresolved', end, reason: lookup.kind === 'none' ? 'no-node' : 'several-nodes' });
  return null;
}

function queryLookup(env: WalkEnv, query: string | null): TaxiNodeLookup {
  if (query === null) return { kind: 'none' };
  const nodes = findTaxiNodes(env.graph, query, env.project.character.faction);
  const [first, ...rest] = nodes;
  if (first === undefined) return { kind: 'none' };
  return rest.length === 0 ? { kind: 'node', node: first } : { kind: 'several', nodes };
}

function refLookup(env: WalkEnv, ref: FlightStep['from']): TaxiNodeLookup | null {
  return ref === null ? null : resolveTaxiNodeRef(env.graph, ref, env.project.character.faction);
}

/** TIME-5, TIME-6: flight steps. */
function flight(env: WalkEnv, state: CharacterState, memo: WalkMemo, work: StepWork, step: FlightStep, group: RouteGroup | null, speeds: StepSpeeds): void {
  const faction = env.project.character.faction;
  if (step.mode === 'discover') {
    const node = oneNode(work, refLookup(env, step.to) ?? refLookup(env, step.from) ?? queryLookup(env, step.nodeQuery), 'to');
    if (!goToLocation(env, state, memo, work, step, group, speeds)) {
      const endpoint = node === null ? null : env.places.taxiNode(node);
      if (node !== null && endpoint === null) work.facts.push({ kind: 'flight-unresolved', end: 'to', reason: 'no-position' });
      if (endpoint !== null) walkTo(env, state, memo, work, endpoint, null, speeds, 'flight-master');
      else if (node !== null) unknownTravel(work);
    }
    interaction(env, work, FLIGHT_MASTER);
    if (node !== null && !state.knownFlightPaths.has(node.key)) {
      state.knownFlightPaths.add(node.key);
      (work.flightPathsLearned ??= []).push(node.key);
    }
    return;
  }
  const to = oneNode(work, refLookup(env, step.to) ?? queryLookup(env, step.nodeQuery), 'to');
  // A located flight step (an RXP `.fly` with its `.goto`) happens at its location, the flight
  // master: the character walks there first, through the group's leg waypoints.
  goToLocation(env, state, memo, work, step, group, speeds);
  const usable = (node: TaxiNode): boolean => node.point !== null && (node.factions === null || node.factions.includes(faction));
  let from: TaxiNode | null;
  if (step.from !== null) from = oneNode(work, resolveTaxiNodeRef(env.graph, step.from, faction), 'from');
  else {
    // The known node nearest to the character on its world map; else the nearest one (SIM-7 below).
    const near = state.location;
    from = near === null ? null : (nearestTaxiNode(env.graph, near, (node) => usable(node) && state.knownFlightPaths.has(node.key)) ?? nearestTaxiNode(env.graph, near, usable));
    if (near === null) reportUnknownPosition(state, work);
    if (from === null) work.facts.push({ kind: 'flight-unresolved', end: 'from', reason: 'no-node' });
  }
  for (const [end, node] of [['from', from], ['to', to]] as const) {
    if (node === null) continue;
    if (node.point === null) work.facts.push({ kind: 'flight-unresolved', end, reason: 'no-position' });
    else if (!state.knownFlightPaths.has(node.key)) work.facts.push({ kind: 'flight-unknown-path', end, node: node.key });
  }
  const fromEnd = from === null ? null : env.places.taxiNode(from);
  const toEnd = to === null ? null : env.places.taxiNode(to);
  if (fromEnd !== null) walkTo(env, state, memo, work, fromEnd, null, speeds, 'flight-master');
  else unknownTravel(work);
  if (fromEnd !== null && toEnd !== null) {
    const data = env.context.localTaxi ?? null;
    const index = data === null ? null : localTaxiIndex(data, env.graph);
    const local =
      data === null || index === null
        ? null
        : {
            data,
            // TIME-6 multi-hop: a TaxiNodes row is usable when a node the character knows (under
            // either key form) maps to it and serves the character's faction.
            usable: (taxiNodeId: number) =>
              (index.byRow.get(taxiNodeId) ?? NONE).some((node) => state.knownFlightPaths.has(node.key) && (node.factions === null || node.factions.includes(faction))),
          };
    const fromRow = from === null || index === null ? null : (index.byNode.get(from) ?? null);
    const toRow = to === null || index === null ? null : (index.byNode.get(to) ?? null);
    const flown = flightTime({ from: fromEnd.point, to: toEnd.point, fromTaxiNodeId: fromRow, toTaxiNodeId: toRow }, env.rules, local);
    for (const part of flown.parts) work.parts.push(part);
    if (flown.used.length > 0) work.used.push(flown.used);
    for (const fact of flown.facts) work.facts.push(fact);
  } else {
    interaction(env, work, FLIGHT_MASTER);
    unknownTravel(work);
  }
  setLocation(state, memo, toEnd, 'flight-unresolved');
}

/** TIME-6: which TaxiNodes row of a local extraction each graph node is, and the reverse. */
interface LocalTaxiIndex {
  readonly byNode: ReadonlyMap<TaxiNode, number | null>;
  readonly byRow: ReadonlyMap<number, readonly TaxiNode[]>;
}

const LOCAL_TAXI_INDEX = new WeakMap<LocalTaxiData, WeakMap<TravelGraph, LocalTaxiIndex>>();

/**
 * TIME-6: a node's row is its `taxiNodeId`, else (a dataset flight master) the row nearest its
 * position on its map (`nearestLocalTaxiNode`, INFERRED, local). Built once per extraction and graph.
 */
function localTaxiIndex(data: LocalTaxiData, graph: TravelGraph): LocalTaxiIndex {
  let byGraph = LOCAL_TAXI_INDEX.get(data);
  if (byGraph === undefined) {
    byGraph = new WeakMap();
    LOCAL_TAXI_INDEX.set(data, byGraph);
  }
  let index = byGraph.get(graph);
  if (index === undefined) {
    const byNode = new Map<TaxiNode, number | null>();
    const byRow = new Map<number, TaxiNode[]>();
    for (const node of graph.taxiNodes) {
      const row = node.taxiNodeId ?? (node.point === null ? null : nearestLocalTaxiNode(data, node.point));
      byNode.set(node, row);
      if (row === null) continue;
      const nodes = byRow.get(row);
      if (nodes === undefined) byRow.set(row, [node]);
      else nodes.push(node);
    }
    index = { byNode, byRow };
    byGraph.set(graph, index);
  }
  return index;
}

function train(env: WalkEnv, state: CharacterState, memo: WalkMemo, work: StepWork, step: TrainStep, group: RouteGroup | null, speeds: StepSpeeds): void {
  goToLocation(env, state, memo, work, step, group, speeds);
  interaction(env, work, TRAIN);
  const riding = trainRiding(step, state, env.rules);
  if (riding.recognised) {
    if (riding.used.length > 0) work.used.push(riding.used);
    for (const fact of riding.facts) work.facts.push(fact);
    if (riding.riding.trained !== state.riding.trained || riding.riding.speedBonus !== state.riding.speedBonus) work.ridingChanged = true;
    state.riding = riding.riding;
  }
  if (step.spellId !== null && !state.knownSpells.has(step.spellId)) {
    state.knownSpells.add(step.spellId);
    (work.spellsLearned ??= []).push(step.spellId);
  }
  if (step.skill === 'profession' && step.skillId !== null) {
    // TIME-3: a newly learned profession starts at 1 (ASSUMPTION); a known one keeps its value.
    if (!state.skills.has(step.skillId)) {
      state.skills.set(step.skillId, 1);
      (work.skillsLearned ??= []).push(step.skillId);
    }
    state.trainedSkills.add(step.skillId);
  }
}

// =============================================================================================
// One step

/** The step's duration override bucket (TIME-8): objective work, combat, or interaction. */
function overrideBucket(step: RouteStep): 'interaction' | 'objective' | 'combat' {
  if (step.kind === 'complete') return 'objective';
  if (step.kind === 'grind') return 'combat';
  return 'interaction';
}

function deltaOf(work: StepWork, skipped: StepDelta['skipped'], locationBefore: WorldPoint | null, levelBefore: number, xpBefore: number, state: CharacterState): StepDelta {
  return {
    skipped,
    questId: work.questId,
    accepted: work.accepted,
    turnedIn: work.turnedIn,
    abandoned: work.abandoned,
    assumedInLog: work.assumedInLog ?? NONE,
    objectivesDone: work.objectivesDone ?? NONE,
    flightPathsLearned: work.flightPathsLearned ?? NONE,
    spellsLearned: work.spellsLearned ?? NONE,
    skillsLearned: work.skillsLearned ?? NONE,
    hearthChanged: work.hearthChanged,
    ridingChanged: work.ridingChanged,
    unknownXpReset: work.unknownXpReset,
    locationBefore,
    locationAfter: state.location,
    levelBefore,
    xpBefore,
  };
}

const ZERO_DURATION: Estimated<number> = { value: 0, basis: 'derived', eraFallback: false };

/**
 * Facts about the work a `durationOverride` replaces (the objective or combat part): unknown
 * objective or grind time (SIM-15), a long grind (SIM-11) and a grind's upper-bound time (SIM-2).
 */
const OVERRIDDEN: ReadonlySet<SimFactKind> = new Set<SimFactKind>(['time-unknown', 'grind-zero-rate', 'target-level-late', 'grind-upper-bound']);

/** TIME-8: whether a `durationOverride` replaces the step's own work (a finite number, 0 or more). */
function overrides(override: number | null): override is number {
  return override !== null && Number.isFinite(override) && override >= 0;
}

/**
 * Folds a step's duration into the route clock since the last hearth cast (TIME-4): `unknown` once
 * a duration is unknown, else the combined basis of the durations (SIMULATION §8).
 */
function foldClock(state: CharacterState, duration: Estimated<number>): void {
  if (state.sinceCastBasis === 'unknown') return;
  if (duration.value === null) {
    state.sinceCastBasis = 'unknown';
    return;
  }
  if (duration.basis === 'assumption') state.sinceCastBasis = 'assumption';
  else if (duration.basis === 'derived' && state.sinceCastBasis === 'source') state.sinceCastBasis = 'derived';
  if (duration.eraFallback) state.sinceCastEraFallback = true;
}
const ZERO_BREAKDOWN: StepEstimate['breakdown'] = { travel: 0, combat: 0, interaction: 0, objective: 0, waiting: 0 };
const VENDOR: Interaction = { kind: 'vendor' };
const NOTE: Interaction = { kind: 'note' };

/**
 * Runs one step on the working state: its travel and work, priced by `src/sim`, and its effect on
 * the state. An inactive step (condition false, or a skip-if-missing turn-in without its quest)
 * takes no time and changes nothing. `timeSec` advances by the known parts only (TIME-13).
 */
export function runStep(
  env: WalkEnv,
  state: CharacterState,
  memo: WalkMemo,
  step: RouteStep,
  index: number,
  group: RouteGroup | null,
  active: boolean | 'unknown',
): StepRecord {
  env.recorder.current = null;
  const locationBefore = state.location;
  const levelBefore = state.level;
  const xpBefore = state.xp;
  const start = state.timeSec;
  const work = newStepWork();
  let skipped: StepDelta['skipped'] = active === false ? 'condition' : null;
  if (skipped === null && step.kind === 'turnin' && step.skipIfMissing && turnInChoice(env, state, step) === null) skipped = 'skip-if-missing';
  if (skipped !== null) {
    const estimate: StepEstimate = {
      stepId: step.id,
      index,
      active: false,
      startSec: start,
      endSec: start,
      duration: ZERO_DURATION,
      xpGained: ZERO_XP,
      xpAfter: state.xp,
      levelAfter: env.sim.levelAfter(state.level, state.xpBasis, state.xpEraFallback),
      levelIsLowerBound: state.unknownXpEvents > 0,
      breakdown: ZERO_BREAKDOWN,
      assumptionsUsed: NONE,
      facts: NONE,
    };
    return { index, step, group, estimate, delta: deltaOf(work, skipped, locationBefore, levelBefore, xpBefore, state), legs: NONE, legsAsked: NONE };
  }
  if (active === 'unknown') work.facts.push({ kind: 'condition-unknown' });
  const speeds = env.sim.speeds('auto', state.riding);
  switch (step.kind) {
    case 'accept':
      accept(env, state, memo, work, step, group, speeds);
      break;
    case 'turnin':
      turnIn(env, state, memo, work, step, group, speeds);
      break;
    case 'abandon':
      abandon(env, state, memo, work, step, group, speeds);
      break;
    case 'complete':
      complete(env, state, memo, work, step, group, speeds);
      break;
    case 'travel':
      travel(env, state, memo, work, step, group);
      break;
    case 'grind':
      grindStep(env, state, memo, work, step, group, speeds);
      break;
    case 'hearth':
      hearth(env, state, memo, work, step, group, speeds);
      break;
    case 'flight':
      flight(env, state, memo, work, step, group, speeds);
      break;
    case 'train':
      train(env, state, memo, work, step, group, speeds);
      break;
    case 'vendor':
      goToLocation(env, state, memo, work, step, group, speeds);
      interaction(env, work, VENDOR);
      break;
    case 'note':
      if (isDeathSkip(step)) {
        // A death skip moves the character somewhere unknown, without an issue (ARCHITECTURE §8.1).
        unknownTravel(work);
        setLocation(state, memo, null, 'death-skip');
      } else goToLocation(env, state, memo, work, step, group, speeds);
      interaction(env, work, NOTE);
      break;
  }
  if (step.kind !== 'accept') memo.visitKey = null;
  if (state.unknownXpEvents > 0 && state.level >= env.curve.maxLevel) {
    // XP-2: no XP is granted at the cap, so a lower bound at the effective cap is the true level (XP-4).
    state.unknownXpEvents = 0;
    work.unknownXpReset = true;
  }
  let parts: readonly TimePart[] = work.parts;
  let facts: readonly SimFact[] = work.facts;
  const override = step.durationOverride;
  const partial = step.kind === 'complete' && step.progress === 'partial';
  if (override !== null && !partial && overrides(override)) {
    parts = applyDurationOverride(parts, override, overrideBucket(step));
    // The override replaces the work those facts describe (TIME-8; TIME-9: "unless overridden").
    if (facts.some((fact) => OVERRIDDEN.has(fact.kind))) facts = facts.filter((fact) => !OVERRIDDEN.has(fact.kind));
  }
  const duration = stepDuration(parts);
  state.timeSec = start + duration.knownSeconds;
  if (work.hearthCast) {
    state.sinceCastBasis = 'source';
    state.sinceCastEraFallback = false;
  } else foldClock(state, duration.duration);
  const estimate: StepEstimate = {
    stepId: step.id,
    index,
    active,
    startSec: start,
    endSec: state.timeSec,
    duration: duration.duration,
    xpGained: work.xpGained,
    xpAfter: state.xp,
    levelAfter: env.sim.levelAfter(state.level, state.xpBasis, state.xpEraFallback),
    levelIsLowerBound: state.unknownXpEvents > 0,
    breakdown: duration.breakdown,
    assumptionsUsed: env.sim.mergeUsed(work.used),
    facts: facts.length === 0 ? NONE : facts,
  };
  return {
    index,
    step,
    group,
    estimate,
    delta: deltaOf(work, null, locationBefore, levelBefore, xpBefore, state),
    legs: work.legs.length === 0 ? NONE : work.legs,
    legsAsked: env.recorder.current ?? NONE,
  };
}
