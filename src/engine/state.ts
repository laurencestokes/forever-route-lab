import type { Truth } from '../domain/conditions';
import type { EntityRef, QuestRecord } from '../domain/dataset';
import type { GroupId, QuestId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';
import type { CharacterProfile } from '../domain/project';
import type { EffectiveRules } from '../rules/precedence';
import { type EntranceEdge, resolveTaxiNodeRef, type TaxiNodeKey, type TravelGraph } from '../rules/travel-graph';
import { initialRiding } from '../sim/travel';
import { grantXp, xpCurveOf } from '../sim/xp';
import type { Places } from './places';
import type { CharacterState, EngineDataset, QuestLogEntry, ReadonlyCharacterState, ReadonlyQuestLogEntry } from './types';

/**
 * The walker's state (docs/ARCHITECTURE.md §9.2, docs/SIMULATION.md §7.1): the initial state from
 * the project's character, and clones for checkpoints.
 */

/** The place of an accept for TIME-8 visits: the entity talked to, or the resolved point. */
export type VisitKey = EntityRef | WorldPoint;

/** Walker bookkeeping that is not character state but must be restored with it at a checkpoint. */
export interface WalkMemo {
  /** Group skip decisions, made when the group's first step is reached (RXP.md §14 row 5). */
  readonly groupSkip: Map<GroupId, Truth>;
  /** Groups whose `leg` waypoints have been walked (before their first located step). */
  readonly waypointsDone: Set<GroupId>;
  /** Where the previous active step accepted a quest (TIME-8), else null. */
  visitKey: VisitKey | null;
  /** The entrance used to enter the instance the character is in (TIME-7), else null. */
  entrance: EntranceEdge | null;
}

/** A state and its bookkeeping, as saved at a checkpoint. */
export interface WalkerState {
  readonly state: CharacterState;
  readonly memo: WalkMemo;
}

/**
 * A log entry with every objective of the record open (a pre-route entry's progress is not
 * declared). `routeAccepted`: an `accept` step of the route put it there (D-040).
 */
export function newLogEntry(record: QuestRecord | undefined, routeAccepted: boolean): QuestLogEntry {
  const count = record?.objectives.length ?? 0;
  const objectives: QuestLogEntry['objectives'] = [];
  for (let i = 0; i < count; i += 1) objectives.push('open');
  return { objectives, failed: false, routeAccepted };
}

/** A copy of a log entry (checkpoints and clones). */
function copyEntry(entry: ReadonlyQuestLogEntry): QuestLogEntry {
  return { objectives: [...entry.objectives], failed: entry.failed, routeAccepted: entry.routeAccepted };
}

function parseIdKeys(record: Readonly<Record<string, number>> | null): Map<number, number> {
  const out = new Map<number, number>();
  if (record === null) return out;
  for (const key of Object.keys(record).sort((a, b) => Number(a) - Number(b))) {
    const id = Number(key);
    const value = record[key];
    if (Number.isSafeInteger(id) && value !== undefined) out.set(id, value);
  }
  return out;
}

/** The known flight paths of the character as TravelGraph node keys (refs that resolve to one node). */
export function knownNodeKeys(character: CharacterProfile, graph: TravelGraph): Set<TaxiNodeKey> {
  const keys = new Set<TaxiNodeKey>();
  for (const ref of character.knownFlightPaths) {
    const lookup = resolveTaxiNodeRef(graph, ref, character.faction);
    if (lookup.kind === 'node') keys.add(lookup.node.key);
  }
  return keys;
}

/**
 * The start level and XP. XP at or beyond the start level's span is not "XP into the start level"
 * (SIMULATION §7.1): it is carried over by XP-2 from 0 XP into the start level, so the walk starts
 * at the level that XP reaches (`xpBasis` `derived`, with the XP table's Era fallback; the
 * validator reports SIM-23). At or above the cap the XP is 0 (XP-2).
 */
export function startLevelAndXp(
  character: Pick<CharacterProfile, 'startLevel' | 'startXp'>,
  rules: EffectiveRules,
): { readonly level: number; readonly xp: number; readonly normalised: boolean; readonly eraFallback: boolean } {
  const curve = xpCurveOf(rules);
  const level = character.startLevel;
  const xp = character.startXp;
  const span = level >= curve.maxLevel ? 0 : curve.toNext[level - 1];
  if (span === undefined || !Number.isInteger(level) || level < 1 || xp < span || (span === 0 && xp === 0)) {
    return { level, xp, normalised: false, eraFallback: false };
  }
  if (span === 0) return { level, xp: 0, normalised: true, eraFallback: false };
  const carried = grantXp(curve, { level, xp: 0 }, xp);
  return { level: carried.level, xp: carried.xp, normalised: true, eraFallback: curve.basis.eraFallback };
}

/**
 * SIMULATION §7.1 initial state: level and XP as declared (`xpBasis` `source`; see
 * `startLevelAndXp` for XP beyond the start level), the resolved start
 * and bind points (null when unset or unresolvable), the hearthstone ready (TIME-4), riding from
 * `character.riding` (TIME-3), skills from `character.professions`, and the pre-route quest lists
 * seeding `completed` and the log (each pre-route entry with every objective open).
 */
export function createInitialState(
  character: CharacterProfile,
  context: { readonly dataset: EngineDataset; readonly rules: EffectiveRules; readonly graph: TravelGraph; readonly places: Places },
): WalkerState {
  const start = character.startLocation === null ? null : context.places.location(character.startLocation);
  const hearth = character.hearthLocation === null ? null : context.places.location(character.hearthLocation);
  const questLog = new Map<QuestId, QuestLogEntry>();
  for (const questId of character.priorQuestLog) questLog.set(questId, newLogEntry(context.dataset.quest(questId), false));
  const start0 = startLevelAndXp(character, context.rules);
  const state: CharacterState = {
    timeSec: 0,
    location: start?.point ?? null,
    locationHint: start?.zoneHint ?? 0,
    locationCause: start !== null ? null : character.startLocation === null ? 'start-unset' : 'start-unresolved',
    level: start0.level,
    xp: start0.xp,
    unknownXpEvents: 0,
    xpBasis: start0.normalised ? 'derived' : 'source',
    xpEraFallback: start0.eraFallback,
    questLog,
    completed: new Set(character.priorCompletedQuests),
    abandoned: new Set(),
    acceptedInRoute: new Set(),
    itemsBeforeAccept: new Map(),
    knownFlightPaths: knownNodeKeys(character, context.graph),
    hearth: hearth?.point ?? null,
    hearthHint: hearth?.zoneHint ?? 0,
    hearthReadyAt: 0,
    sinceCastBasis: 'source',
    sinceCastEraFallback: false,
    riding: initialRiding(character.riding, context.rules),
    skills: parseIdKeys(character.professions),
    trainedSkills: new Set(),
    reputationDelta: new Map(),
    knownSpells: new Set(),
  };
  return { state, memo: { groupSkip: new Map(), waypointsDone: new Set(), visitKey: null, entrance: null } };
}

/** A deep copy of a character state (log entries included): what a checkpoint keeps. */
export function cloneState(state: ReadonlyCharacterState): CharacterState {
  const questLog = new Map<QuestId, QuestLogEntry>();
  for (const [questId, entry] of state.questLog) questLog.set(questId, copyEntry(entry));
  return {
    timeSec: state.timeSec,
    location: state.location,
    locationHint: state.locationHint,
    locationCause: state.locationCause,
    level: state.level,
    xp: state.xp,
    unknownXpEvents: state.unknownXpEvents,
    xpBasis: state.xpBasis,
    xpEraFallback: state.xpEraFallback,
    questLog,
    completed: new Set(state.completed),
    abandoned: new Set(state.abandoned),
    acceptedInRoute: new Set(state.acceptedInRoute),
    itemsBeforeAccept: new Map(state.itemsBeforeAccept),
    knownFlightPaths: new Set(state.knownFlightPaths),
    hearth: state.hearth,
    hearthHint: state.hearthHint,
    hearthReadyAt: state.hearthReadyAt,
    sinceCastBasis: state.sinceCastBasis,
    sinceCastEraFallback: state.sinceCastEraFallback,
    riding: state.riding,
    skills: new Map(state.skills),
    trainedSkills: new Set(state.trainedSkills),
    reputationDelta: new Map(state.reputationDelta),
    knownSpells: new Set(state.knownSpells),
  };
}

/**
 * A checkpoint (ARCHITECTURE §9.2): a copy of the state before one step. The sets and maps that
 * only ever grow during a walk (completed, abandoned and accepted quests, known flight paths,
 * spells, trained skills, and the memo's group decisions and walked waypoints) keep their
 * insertion order, and every kept checkpoint's contents are a prefix of the working state's, so a
 * checkpoint stores only their sizes; the rest is copied. Restoring rebuilds the prefixes.
 */
/** The state's collections that only grow during a walk. */
type GrowOnlyKey = 'completed' | 'abandoned' | 'acceptedInRoute' | 'knownFlightPaths' | 'knownSpells' | 'trainedSkills';

export interface Checkpoint {
  readonly state: Omit<CharacterState, GrowOnlyKey>;
  readonly sizes: {
    readonly completed: number;
    readonly abandoned: number;
    readonly acceptedInRoute: number;
    readonly knownFlightPaths: number;
    readonly knownSpells: number;
    readonly trainedSkills: number;
    readonly groupSkip: number;
    readonly waypointsDone: number;
  };
  readonly visitKey: VisitKey | null;
  readonly entrance: EntranceEdge | null;
}

function prefixSet<T>(set: ReadonlySet<T>, size: number): Set<T> {
  const out = new Set<T>();
  if (size <= 0) return out;
  for (const value of set) {
    out.add(value);
    if (out.size >= size) break;
  }
  return out;
}

function prefixMap<K, V>(map: ReadonlyMap<K, V>, size: number): Map<K, V> {
  const out = new Map<K, V>();
  if (size <= 0) return out;
  for (const [key, value] of map) {
    out.set(key, value);
    if (out.size >= size) break;
  }
  return out;
}

/** Saves the working state as a checkpoint (the grow-only collections by size). */
export function checkpointOf(working: WalkerState): Checkpoint {
  const { state, memo } = working;
  const { completed, abandoned, acceptedInRoute, knownFlightPaths, knownSpells, trainedSkills, ...rest } = state;
  const questLog = new Map<QuestId, QuestLogEntry>();
  for (const [questId, entry] of state.questLog) questLog.set(questId, copyEntry(entry));
  return {
    state: { ...rest, questLog, itemsBeforeAccept: new Map(state.itemsBeforeAccept), skills: new Map(state.skills), reputationDelta: new Map(state.reputationDelta) },
    sizes: {
      completed: completed.size,
      abandoned: abandoned.size,
      acceptedInRoute: acceptedInRoute.size,
      knownFlightPaths: knownFlightPaths.size,
      knownSpells: knownSpells.size,
      trainedSkills: trainedSkills.size,
      groupSkip: memo.groupSkip.size,
      waypointsDone: memo.waypointsDone.size,
    },
    visitKey: memo.visitKey,
    entrance: memo.entrance,
  };
}

/**
 * A working state rebuilt from a checkpoint. `current` is the working state the checkpoint's
 * grow-only collections are a prefix of (the walker's latest working state).
 */
export function restoreCheckpoint(checkpoint: Checkpoint, current: WalkerState): WalkerState {
  const { state, sizes } = checkpoint;
  const live = current.state;
  const questLog = new Map<QuestId, QuestLogEntry>();
  for (const [questId, entry] of state.questLog) questLog.set(questId, copyEntry(entry));
  return {
    // The property order of createInitialState and cloneState, so every working state has one shape.
    state: {
      timeSec: state.timeSec,
      location: state.location,
      locationHint: state.locationHint,
      locationCause: state.locationCause,
      level: state.level,
      xp: state.xp,
      unknownXpEvents: state.unknownXpEvents,
      xpBasis: state.xpBasis,
      xpEraFallback: state.xpEraFallback,
      questLog,
      completed: prefixSet(live.completed, sizes.completed),
      abandoned: prefixSet(live.abandoned, sizes.abandoned),
      acceptedInRoute: prefixSet(live.acceptedInRoute, sizes.acceptedInRoute),
      itemsBeforeAccept: new Map(state.itemsBeforeAccept),
      knownFlightPaths: prefixSet(live.knownFlightPaths, sizes.knownFlightPaths),
      hearth: state.hearth,
      hearthHint: state.hearthHint,
      hearthReadyAt: state.hearthReadyAt,
      sinceCastBasis: state.sinceCastBasis,
      sinceCastEraFallback: state.sinceCastEraFallback,
      riding: state.riding,
      skills: new Map(state.skills),
      trainedSkills: prefixSet(live.trainedSkills, sizes.trainedSkills),
      reputationDelta: new Map(state.reputationDelta),
      knownSpells: prefixSet(live.knownSpells, sizes.knownSpells),
    },
    memo: {
      groupSkip: prefixMap(current.memo.groupSkip, sizes.groupSkip),
      waypointsDone: prefixSet(current.memo.waypointsDone, sizes.waypointsDone),
      visitKey: checkpoint.visitKey,
      entrance: checkpoint.entrance,
    },
  };
}
