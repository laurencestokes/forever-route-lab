import type { EstimateBasis, Estimated } from '../domain/estimate';
import type { NpcId, QuestId, WorldMapId } from '../domain/ids';
import type { TravelWarning } from '../domain/travel';

/**
 * Structured facts the simulation and the engine record while estimating a step. They are data,
 * not issues: src/validate owns the code registry and turns each fact into a `ValidationIssue`
 * (docs/SIMULATION.md §7.7; D-037). The comment on each kind names the SIMULATION rule it
 * serves; kinds marked "engine" are recorded by the walker, which knows the route state.
 */
export type SimFact =
  /** SIM-1 (XP-4): a turn-in whose quest XP is unknown; nothing is granted. */
  | {
      readonly kind: 'unknown-xp';
      readonly questId: QuestId;
      /** `no-record`: no XP record (dataset or custom); `unknown-level`: quest level null, 0 or below -1. */
      readonly reason: 'no-record' | 'unknown-level';
    }
  /** SIM-2 (TIME-12): a grind to a level after unknown XP; the level is known again, the time an upper bound. */
  | { readonly kind: 'grind-upper-bound' }
  /** SIM-3 (TIME-2), engine: a location, or every spawn of the step's entity, resolves to nothing. */
  | { readonly kind: 'unresolved-location' }
  /** SIM-4 (TIME-7), engine: a move between world maps without a transport, hearth or entrance edge. */
  | { readonly kind: 'cross-world-no-transport'; readonly fromMapId: WorldMapId; readonly toMapId: WorldMapId }
  /**
   * SIM-5 (TIME-4): the hearthstone was on cooldown; the walker waited. `upperBound` when a step
   * since the last cast has unknown time: the clock is then a lower bound, so the true wait is
   * anywhere from 0 to `waitSeconds` and the wait counts as unknown time (TIME-13).
   */
  | { readonly kind: 'hearth-cooldown'; readonly waitSeconds: number; readonly upperBound: boolean }
  /** SIM-6 (TIME-4): `hearth use` with no bind point. */
  | { readonly kind: 'hearth-unbound' }
  /** SIM-7 (TIME-5), engine: a flight from or to a node not in `knownFlightPaths`. */
  | { readonly kind: 'flight-unknown-path'; readonly end: 'from' | 'to'; readonly node: string }
  /** SIM-8 (TIME-5), engine: a node ref or query that resolves to no node, several, or one without a position. */
  | { readonly kind: 'flight-unresolved'; readonly end: 'from' | 'to'; readonly reason: 'no-node' | 'several-nodes' | 'no-position' }
  /** SIM-9 (TIME-2): travel mode `'mount'` before riding is trained. */
  | { readonly kind: 'mount-untrained' }
  /** SIM-10 (TIME-3): a riding `train` step below the tier's mount level; `uncertain` after unknown XP. */
  | {
      readonly kind: 'riding-too-low';
      readonly tier: 1 | 2;
      readonly requiredLevel: number;
      readonly level: number;
      readonly uncertain: boolean;
    }
  /** SIM-11 (TIME-12): a grind to a level needing more than `grindWarnSeconds`; `uncertain` when an upper bound. */
  | { readonly kind: 'target-level-late'; readonly seconds: number; readonly uncertain: boolean }
  /** SIM-12 (TIME-10), engine: a `finish` target that is already done. */
  | { readonly kind: 'objective-already-done'; readonly questId: QuestId; readonly objective: number | null }
  /** SIM-13, engine: a step or group condition evaluates to `unknown`; the step stays active. */
  | { readonly kind: 'condition-unknown' }
  /** SIM-14 (TIME-7): a transport whose known factions exclude the character. */
  | { readonly kind: 'transport-faction'; readonly transportId: string }
  /** SIM-15 (TIME-9, TIME-12): objective or grind time that cannot be estimated. */
  | {
      readonly kind: 'time-unknown';
      readonly part: 'objective' | 'grind';
      readonly reason: 'reputation-objective' | 'item-without-source' | 'above-max-level' | 'gray-mob';
      readonly questId: QuestId | null;
      readonly objective: number | null;
    }
  /** SIM-16 (TIME-10), engine: a `complete` target whose quest is not in the log. */
  | { readonly kind: 'complete-not-in-log'; readonly questId: QuestId }
  /**
   * TIME-11 (VAL-30), engine: a turn-in's unfinished objectives were assumed completed incidentally,
   * at 0 s and 0 kill XP: the quest was in the log before the route (`priorQuestLog`) or assumed to
   * be (unknown history), so their progress is unknown.
   */
  | { readonly kind: 'objectives-incidental'; readonly questId: QuestId; readonly objectives: readonly number[] }
  /**
   * TIME-11 (VAL-30, D-040), engine: a turn-in of a quest an accept step of the route put in the log
   * carried the work of its unfinished objectives (0-based indices): their TIME-9 time and kill XP,
   * combined as TIME-10, at no point (as a `complete` step without a location), without the travel
   * to them.
   * - `time`: whether the turn-in's time counts that work (`counted`), a `durationOverride` stands
   *   in for it (`overridden`, TIME-8), or it cannot be estimated (`unknown`, TIME-13).
   * - `killXp`: the carried kill XP (never unknown), granted even when the quest XP is unknown; route
   *   metrics count it then, as the level does.
   * - `level` (with its basis): the level the quest XP is taken at, after the kill XP, which LINT-4 reads.
   */
  | {
      readonly kind: 'objectives-carried';
      readonly questId: QuestId;
      readonly objectives: readonly number[];
      readonly time: 'counted' | 'overridden' | 'unknown';
      readonly killXp: Estimated<number>;
      readonly level: number;
      readonly levelBasis: EstimateBasis;
      readonly levelEraFallback: boolean;
    }
  /**
   * TIME-10, TIME-11 (D-040), engine: an accept marked these `item` objectives (0-based) done,
   * because a `complete` step collected their items while the quest was not in the log (SIM-16).
   * Not an issue: that step's SIM-16 is the warning.
   */
  | { readonly kind: 'objectives-before-accept'; readonly questId: QuestId; readonly objectives: readonly number[] }
  /** TIME-2 (SIM-17..21): a travel leg's warning, passed through from the TravelModel unchanged. */
  | { readonly kind: 'travel-warning'; readonly warning: TravelWarning }
  /** TIME-2: a navigation leg is not computed yet and its seconds are the fallback. Not an issue. */
  | { readonly kind: 'pending-leg' }
  /** KXP-4: an NPC's level range is unknown, so a same-level mob was assumed. Not an issue. */
  | { readonly kind: 'mob-level-assumed'; readonly npcId: NpcId | null }
  /**
   * SIM-15 (TIME-12): a grind to a level at 0 XP per hour never reaches it; its time is unknown.
   * (A kind of its own rather than a `time-unknown` reason, so the reasons' exhaustive UI table
   * does not change with it.)
   */
  | { readonly kind: 'grind-zero-rate' }
  /**
   * TIME-2, engine: the step moved from an unknown position, so its travel time is unknown. Not an
   * issue: TIME-2 raises none for it, and `cause` says why the position was unknown.
   */
  | { readonly kind: 'position-unknown'; readonly cause: UnknownPositionCause };

/**
 * Why the position is unknown (TIME-2, TIME-4, TIME-5, TIME-7):
 * - `start-unset`, `start-unresolved`: the character's start location is not set, or does not resolve;
 * - `zone-travel`: a `travel` step without a location (RXP `.zone`, `.subzone`, `.explore`);
 * - `death-skip`: a preserved RXP `.deathskip`;
 * - `unresolved`: an earlier location did not resolve (SIM-3);
 * - `several-spawns`: the step went to an entity with several spawns from an unknown position, so
 *   which spawn it reached is unknown;
 * - `hearth-unbound`: a hearth with no bind point (SIM-6);
 * - `flight-unresolved`: a flight whose destination has no node or position (SIM-8);
 * - `transport-arrival`: a transport whose arrival is unknown (no step location, or a dock without
 *   a position).
 */
export type UnknownPositionCause =
  | 'start-unset'
  | 'start-unresolved'
  | 'zone-travel'
  | 'death-skip'
  | 'unresolved'
  | 'several-spawns'
  | 'hearth-unbound'
  | 'flight-unresolved'
  | 'transport-arrival';

export type SimFactKind = SimFact['kind'];
