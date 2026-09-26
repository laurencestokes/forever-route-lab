import type { Truth } from '../domain/conditions';
import type { DatasetView, SpawnPoint } from '../domain/dataset';
import type { EstimateBasis, Estimated } from '../domain/estimate';
import type { QuestId } from '../domain/ids';
import type { SourcedPoint, WorldPoint } from '../domain/points';
import type { ProjectV1 } from '../domain/project';
import type { RouteGroup, RouteStep } from '../domain/route';
import type { TravelEndpoint, TravelMethod, TravelModel, TravelWarning } from '../domain/travel';
import type { MapGeometry } from '../geo/types';
import type { EffectiveRules } from '../rules/precedence';
import type { TaxiNodeKey, TravelGraph } from '../rules/travel-graph';
import type { StepEstimate } from '../sim/estimate';
import type { UnknownPositionCause } from '../sim/facts';
import type { LocalTaxiData } from '../sim/taxi';
import type { RidingState } from '../sim/travel';

/**
 * Types of the route walker (docs/ARCHITECTURE.md §9.2): the character state it mutates, the
 * dependencies it is given, and what it hands to visitors and callers. The engine never loads
 * anything: the dataset, geometry, rules, travel model and TravelGraph are injected.
 */

// =============================================================================================
// Character state (ARCHITECTURE §9.2, SIMULATION §7.1)

/** One objective of a quest in the log (Questie ObjectiveData order). */
export type ObjectiveProgress = 'open' | 'done';

export interface QuestLogEntry {
  /** One entry per objective of the quest record; empty for a quest the dataset does not know. */
  readonly objectives: ObjectiveProgress[];
  /** Nothing in the route model fails a quest yet, so this stays false (VAL-30 reads it). */
  failed: boolean;
  /**
   * Whether an `accept` step of the route put the quest in the log. Only then are its open
   * objectives known to be open, so a turn-in carries their work (TIME-11, D-040). False for an
   * entry from `priorQuestLog` or one assumed through an unknown history (their progress is unknown).
   */
  readonly routeAccepted: boolean;
}

/**
 * The walker's working state. One instance is mutated step by step; visitors see it through
 * `ReadonlyCharacterState`. `level` and `xp` are the known-XP lower bound while
 * `unknownXpEvents > 0` (XP-4).
 */
export interface CharacterState {
  timeSec: number;
  /** Null when the position is unknown (unresolved location, `.zone` travel, a death skip). */
  location: WorldPoint | null;
  /** The zone hint of `location` for travel endpoints (terrain-navigation.md §8.1), 0 for none. */
  locationHint: number;
  /** Why `location` is null (the `position-unknown` fact of the next move); null while it is known. */
  locationCause: UnknownPositionCause | null;
  level: number;
  /** XP into `level`. */
  xp: number;
  unknownXpEvents: number;
  /** Combined basis of every XP grant since the route start (SIMULATION §8). */
  xpBasis: EstimateBasis;
  xpEraFallback: boolean;
  questLog: Map<QuestId, QuestLogEntry>;
  completed: Set<QuestId>;
  abandoned: Set<QuestId>;
  /** Quests an `accept` step of the route has accepted so far (the "never accepted" test of §9.4). */
  acceptedInRoute: Set<QuestId>;
  /**
   * `item` objectives (0-based, ascending) a `complete` step priced while their quest was not in
   * the log (TIME-10, SIM-16): the items are in the bags, so the `accept` that next puts the quest
   * in the log marks them done, and nothing prices them again (TIME-11, D-040). The accept removes
   * the entry. The arrays are never mutated; an update replaces them.
   */
  itemsBeforeAccept: Map<QuestId, readonly number[]>;
  knownFlightPaths: Set<TaxiNodeKey>;
  hearth: WorldPoint | null;
  /** The zone hint of `hearth`. */
  hearthHint: number;
  hearthReadyAt: number;
  /**
   * The combined basis of the step durations since the last hearth cast ended (`unknown` once one
   * of them is unknown): the basis of a cooldown wait, and whether it is only an upper bound (TIME-4).
   */
  sinceCastBasis: EstimateBasis;
  sinceCastEraFallback: boolean;
  riding: RidingState;
  /** Skill line id to value: `character.professions`, plus lines learned by profession training. */
  skills: Map<number, number>;
  /** Skill lines a profession `train` step of the route taught; their values are lower bounds (VAL-15). */
  trainedSkills: Set<number>;
  reputationDelta: Map<number, number>;
  /** Spells taught by `train` steps (the base spellbook is unknown, VAL-17). */
  knownSpells: Set<number>;
}

export interface ReadonlyQuestLogEntry {
  readonly objectives: readonly ObjectiveProgress[];
  readonly failed: boolean;
  readonly routeAccepted: boolean;
}

/** The read-only view of `CharacterState` given to visitors and callers. */
export interface ReadonlyCharacterState {
  readonly timeSec: number;
  readonly location: WorldPoint | null;
  readonly locationHint: number;
  readonly locationCause: UnknownPositionCause | null;
  readonly level: number;
  readonly xp: number;
  readonly unknownXpEvents: number;
  readonly xpBasis: EstimateBasis;
  readonly xpEraFallback: boolean;
  readonly questLog: ReadonlyMap<QuestId, ReadonlyQuestLogEntry>;
  readonly completed: ReadonlySet<QuestId>;
  readonly abandoned: ReadonlySet<QuestId>;
  readonly acceptedInRoute: ReadonlySet<QuestId>;
  readonly itemsBeforeAccept: ReadonlyMap<QuestId, readonly number[]>;
  readonly knownFlightPaths: ReadonlySet<TaxiNodeKey>;
  readonly hearth: WorldPoint | null;
  readonly hearthHint: number;
  readonly hearthReadyAt: number;
  readonly sinceCastBasis: EstimateBasis;
  readonly sinceCastEraFallback: boolean;
  readonly riding: RidingState;
  readonly skills: ReadonlyMap<number, number>;
  readonly trainedSkills: ReadonlySet<number>;
  readonly reputationDelta: ReadonlyMap<number, number>;
  readonly knownSpells: ReadonlySet<number>;
}

// =============================================================================================
// Injected dependencies

/**
 * What the walker reads from the dataset: the project's `DatasetView` (faction and class layers,
 * custom quests and quest overrides applied) satisfies it.
 */
export type EngineDataset = Pick<DatasetView, 'quest' | 'npc' | 'object' | 'item' | 'spawns'>;

/**
 * Zone hints for travel endpoints (terrain-navigation.md §8.1 rule A): the top-level zone
 * AreaTable id that picks an endpoint's floor in a multi-level place, 0 for none. The app supplies
 * them from the geometry and the navigation manifest (`src/app/navigation-hints.ts`).
 */
export interface ZoneHintResolver {
  /** A route point (a step location, a waypoint, the start or bind location) resolved to `world`. */
  routePoint(source: SourcedPoint, world: WorldPoint): number;
  /** A dataset spawn with a world point (quest givers, flight masters, dock NPCs). */
  spawn(spawn: SpawnPoint, world: WorldPoint): number;
}

/** Every hint 0: the straight-line model and tests need none. */
export const NO_ZONE_HINTS: ZoneHintResolver = { routePoint: () => 0, spawn: () => 0 };

/**
 * Whether a quest can be accepted without an error (SIMULATION §7.2): the walker asks it to pick
 * the candidate of an any-of accept and to evaluate `questState: 'available'` predicates. `unknown`
 * counts as acceptable (a warning, not an error). The validator injects its full availability
 * rules; `createBasicAcceptPolicy` is the engine's default.
 */
export interface AcceptPolicy {
  acceptable(questId: QuestId, state: ReadonlyCharacterState): Truth;
}

/** Everything the walker depends on besides the project. One walker serves one context. */
export interface EngineContext {
  readonly dataset: EngineDataset;
  /** Resolves authored points through `src/geo` (ARCHITECTURE §6, D-017). */
  readonly geometry: MapGeometry;
  /** The effective rules of the project (ruleset and assumptions, `effectiveRules`). */
  readonly rules: EffectiveRules;
  /** Ground legs on one world map (ARCHITECTURE §9.1, D-028, D-037). */
  readonly travel: TravelModel;
  /** Transports, taxi nodes and instance entrances (`seedTravelGraph`). */
  readonly graph: TravelGraph;
  readonly zoneHints?: ZoneHintResolver;
  /** Local per-leg taxi lengths (TIME-6, dev/preview only); null or absent uses TIME-5. */
  readonly localTaxi?: LocalTaxiData | null;
  readonly acceptPolicy?: AcceptPolicy;
}

/** The parts of a project the walk reads. */
export type WalkProject = Pick<ProjectV1, 'route' | 'character' | 'routeProfile' | 'customQuests'>;

// =============================================================================================
// Results

/** A directed pair of endpoints on one world map: a leg the travel model was asked for. */
export interface TravelPair {
  readonly from: TravelEndpoint;
  readonly to: TravelEndpoint;
}

/** Why a ground leg was walked. */
export type LegPurpose =
  /** A group's `leg` waypoint (ARCHITECTURE §9.2). */
  | 'waypoint'
  /** The step's own place: its location, its entity's nearest spawn, or the arrival after a crossing. */
  | 'step'
  /** A dungeon entrance on the way into an instance (TIME-7). */
  | 'entrance'
  /** A transport's departure dock (TIME-7). */
  | 'dock'
  /** The flight master of a flight's departure node (TIME-5). */
  | 'flight-master';

/** One ground leg a step used, as the travel model priced it. */
export interface LegUse {
  readonly from: TravelEndpoint;
  readonly to: TravelEndpoint;
  readonly purpose: LegPurpose;
  /** The leg's seconds after the arrival radius, combined with the speeds' provenance (TIME-2). */
  readonly seconds: Estimated<number>;
  readonly method: TravelMethod;
  readonly pending: boolean;
  readonly warnings: readonly TravelWarning[];
}

export interface ObjectiveMark {
  readonly questId: QuestId;
  readonly objective: number;
}

/** What one step changed. Absent changes are null, false or empty, never missing keys. */
export interface StepDelta {
  /** Why an inactive step did nothing: its condition, or a missing quest on a skip-if-missing turn-in. */
  readonly skipped: 'condition' | 'skip-if-missing' | null;
  /** The quest an accept, turn-in or abandon acted on: for an any-of step the chosen candidate (SIMULATION §7.2, VAL-30). */
  readonly questId: QuestId | null;
  /** The quest put in the log (for an any-of accept, the chosen candidate). */
  readonly accepted: QuestId | null;
  /** The quest turned in (for an any-of turn-in, the chosen candidate). */
  readonly turnedIn: QuestId | null;
  readonly abandoned: QuestId | null;
  /**
   * Quests the step assumed were in the log before the route (`priorHistory: 'unknown'`, a quest
   * the route never accepted): the validator's `-unverifiable` cases (ARCHITECTURE §9.4).
   */
  readonly assumedInLog: readonly QuestId[];
  /** Objectives the step marked done: its work, or a turn-in's carried or incidental completion (TIME-11). */
  readonly objectivesDone: readonly ObjectiveMark[];
  readonly flightPathsLearned: readonly TaxiNodeKey[];
  readonly spellsLearned: readonly number[];
  /** Skill lines added by profession training. */
  readonly skillsLearned: readonly number[];
  readonly hearthChanged: boolean;
  readonly ridingChanged: boolean;
  /** The unknown-XP count was reset: by a grind to a level, or by reaching the level cap (XP-4). */
  readonly unknownXpReset: boolean;
  readonly locationBefore: WorldPoint | null;
  readonly locationAfter: WorldPoint | null;
  readonly levelBefore: number;
  readonly xpBefore: number;
}

/** Everything the walk recorded about one step. */
export interface StepRecord {
  readonly index: number;
  readonly step: RouteStep;
  readonly group: RouteGroup | null;
  readonly estimate: StepEstimate;
  readonly delta: StepDelta;
  /** The ground legs the step walked, in order. */
  readonly legs: readonly LegUse[];
  /** Every leg the step asked the travel model for, walked or only compared (leg enumeration). */
  readonly legsAsked: readonly TravelPair[];
}

/** What a visitor sees of one step. `state` is the live working state: read it, never keep it. */
export interface StepVisit {
  readonly index: number;
  readonly step: RouteStep;
  readonly group: RouteGroup | null;
  readonly active: boolean | 'unknown';
  readonly state: ReadonlyCharacterState;
}

/**
 * A visitor of a walk (the validator, route context). `enter` runs before the step changes the
 * state, `leave` after it, with the step's record. A re-walk from a checkpoint visits only the
 * steps from `fromIndex`; a visitor that keeps per-step results drops those from `fromIndex` on.
 */
export interface WalkVisitor {
  begin?(start: { readonly fromIndex: number; readonly state: ReadonlyCharacterState; readonly project: WalkProject }): void;
  enter?(visit: StepVisit): void;
  leave?(visit: StepVisit, record: StepRecord): void;
  end?(walk: RouteWalk): void;
}

/** The result of a walk. */
export interface RouteWalk {
  readonly project: WalkProject;
  /** One record per route step, in route order. */
  readonly records: readonly StepRecord[];
  readonly estimates: readonly StepEstimate[];
  /** The first step this walk re-computed; records before it were kept from the previous walk. */
  readonly fromIndex: number;
  /** The state after the last step: the live working state, valid until the next walk. */
  readonly final: ReadonlyCharacterState;
}
