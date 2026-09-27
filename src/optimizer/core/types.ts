import type { Truth } from '../../domain/conditions';
import type { ItemRecord, NpcRecord, ObjectiveDef, SpawnPoint } from '../../domain/dataset';
import type { GroupId, QuestId, StepId } from '../../domain/ids';
import type { WorldPoint } from '../../domain/points';
import type { GrindStep, GrindTarget, RouteStep, TrainStep } from '../../domain/route';
import type { Places } from '../../engine/places';
import type { VisitKey } from '../../engine/state';
import type { EngineContext, ReadonlyCharacterState, StepRecord, TravelPair, WalkProject } from '../../engine/types';
import type { EntranceEdge } from '../../rules/travel-graph';
import type { EffectiveRules } from '../../rules/precedence';
import type { KillPlace } from '../../sim/kill-xp';

/**
 * The optimiser's pure types (docs/research/optimizer-m7.md §11): the compile input the app builds
 * from its private walks, the compiled search problem the worker receives, and the search's
 * results. `src/optimizer/types.ts` re-exports them (optimizer/core may not import optimizer/index,
 * even as types).
 *
 * The UI and every document say "best route found under these assumptions", never "optimal".
 */

// =============================================================================================
// Inputs from the app (§4.2, §5.1)

/**
 * What one quest's availability reads (§4.2, `availabilityDependencies` beside `check` in
 * `src/validate/availability.ts`). Declared here until the validator exports it: the two must stay
 * structurally equal, and the app's `compileAvailability` returns the validator's.
 */
export interface AvailabilityDependencies {
  /** VAL-8/9: each entry is one requirement met by any of its quests (exclusive alternatives). */
  readonly completed: readonly (readonly QuestId[])[];
  /** VAL-10: the parent must be in the log. */
  readonly inLog: readonly QuestId[];
  /** VAL-18 starting-with: taken (in the log) or done. */
  readonly takenOrDone: readonly QuestId[];
  /** VAL-11/12/13/14/18/21: quests whose state can block the accept. */
  readonly blockers: readonly QuestId[];
  readonly minLevel: number | null;
  readonly maxLevel: number | null;
  /** VAL-10's lift of the level requirement. */
  readonly parent: QuestId | null;
  readonly skills: readonly number[];
  readonly spells: readonly number[];
  /** Factions whose standing must reach a minimum (VAL-16). */
  readonly minReputation: readonly number[];
  /** Factions whose standing must stay below a maximum (VAL-16). */
  readonly maxReputation: readonly number[];
  /** A breadcrumb's target and the target's own dependencies (one level deep, as `check` is). */
  readonly breadcrumbTarget: { readonly questId: QuestId; readonly dependencies: Omit<AvailabilityDependencies, 'breadcrumbTarget'> } | null;
}

/**
 * The validator's availability, injected by the app (optimizer/core may import `validate` as types
 * only).
 */
export interface CompileAvailability {
  dependencies(questId: QuestId): AvailabilityDependencies;
  /**
   * The availability truth of findings with these codes (the validator's `acceptTruth`): `false` on
   * any error, `unknown` on a doubt, else `true`. Compile asks it for the static part of an
   * accept's original findings (the codes without the dynamic ones, §4.2).
   */
  truth(codes: readonly string[]): Truth;
}

/** What the baseline walk's probe visitor recorded at one section or suffix step (§4.2, §5.1). */
export interface StepProbe {
  readonly index: number;
  readonly active: boolean | 'unknown';
  readonly level: number;
  readonly xp: number;
  readonly knownTotal: number;
  readonly unknownXpEvents: number;
  readonly logCount: number;
  /** Accepts: the quest, then each any-of candidate, then each `available` predicate's quests. */
  readonly availability: readonly { readonly questId: QuestId; readonly truth: Truth; readonly codes: readonly string[] }[] | null;
  /** Conditional steps: each skip predicate's truth (the group's, then the step's). */
  readonly predicates: readonly Truth[] | null;
  /** Any-of steps: the quest the engine chose. */
  readonly chosen: QuestId | null;
}

export interface SectionProbe {
  readonly steps: ReadonlyMap<number, StepProbe>;
  /** A copy of the state after the last section step. */
  readonly endState: ReadonlyCharacterState;
}

/** The walker memo before a step (`RouteWalker.memoBefore`, M7.0), read-only. */
export interface ReadonlyWalkMemo {
  readonly groupSkip: ReadonlyMap<GroupId, Truth>;
  readonly waypointsDone: ReadonlySet<GroupId>;
  readonly visitKey: VisitKey | null;
  readonly entrance: EntranceEdge | null;
}

/** One walk of the run's private walker (§5.1). `probe` is null for the analysis walk. */
export interface SectionWalk {
  readonly records: readonly StepRecord[];
  /** `stateBefore(first)`. */
  readonly start: ReadonlyCharacterState;
  /** `memoBefore(first)`. */
  readonly memo: ReadonlyWalkMemo;
  /** The walker's own places (endpoint identities match the walk's legs). */
  readonly places: Places;
  readonly probe: SectionProbe | null;
}

export interface OptimizationGoal {
  readonly targetXp: 'keep-original' | number;
  readonly grindFill: 'shortfall' | 'replace-quests';
}

export interface CompileInput {
  readonly project: WalkProject;
  readonly section: { readonly first: number; readonly last: number };
  readonly goal: OptimizationGoal;
  /**
   * The run's engine context. `travel` is the quiet view (§5.3). `acceptPolicy` is the walker's
   * (the validator's): compile replays the section with the engine, and the replay must choose as
   * the walk did.
   */
  readonly context: Pick<EngineContext, 'dataset' | 'geometry' | 'rules' | 'travel' | 'graph' | 'zoneHints' | 'localTaxi' | 'acceptPolicy'>;
  readonly walk: SectionWalk;
  readonly availability: CompileAvailability;
}

export interface CompileFailure {
  readonly ok: false;
  readonly status: 'infeasible' | 'failed';
  readonly reason: string;
}

export interface ContractSummary {
  /** Quests named outside the section, by skip predicates, or by suffix availability readers. */
  readonly qExt: readonly QuestId[];
  readonly pool: readonly QuestId[];
  readonly obligatory: readonly QuestId[];
  readonly unknownXp: readonly QuestId[];
  /** Quests whose turn-in carries objective work, whose objective travel is not priced (D-040). */
  readonly carried: readonly QuestId[];
  /** Route indices of the steps that leave the position unknown (§3.6). */
  readonly barriers: readonly number[];
  readonly targetXp: number;
  readonly firstSuffixIndex: number;
  /** Route indices of the exit chain (§5.4). */
  readonly exitChain: readonly number[];
  readonly original: {
    /** The engine's section plus exit chain, milliseconds (§6.3). */
    readonly sectionPlusExitMs: number;
    /** `hearthReadyAt` (absolute seconds) after the last section step. */
    readonly readyAt: number;
  };
}

/** The result of `analyseSection` (§5.1 step 2). `internal` is compile's own structure. */
export interface SectionAnalysis {
  readonly ok: true;
  /** The legs the matrix needs; "computing paths" fills them before compile. */
  readonly pairs: readonly TravelPair[];
  /** The last hearth cast before the section (the baseline re-walks from here), else the section start. */
  readonly castWindowStart: number;
  readonly summary: ContractSummary;
  readonly internal: unknown;
}

/** A matrix cache the app keeps across runs (§5.3). It owns its buffers; compile copies them. */
export interface MatrixCache {
  readonly capacity: number;
  /** Entries held, most recently used first (tests). */
  size(): number;
  lookup(key: string, pairs: Float64Array): Int32Array | null;
  store(key: string, pairs: Float64Array, matrix: Int32Array): void;
}

export interface CompiledProblem {
  readonly ok: true;
  readonly problem: SearchProblem;
  /** The problem's typed-array buffers (copies), for `postMessage(message, transfer)`. */
  readonly transfer: readonly ArrayBuffer[];
  readonly decode: DecodeTable;
  readonly summary: ContractSummary;
  readonly stats: {
    readonly units: number;
    readonly anchors: number;
    readonly blocks: number;
    readonly locations: number;
    readonly pairs: number;
    readonly tiers: number;
    readonly incumbentMs: number;
  };
}

// =============================================================================================
// Search options and results (§7, §11)

export interface SearchOptions {
  readonly beamWidth: number;
  readonly maxEvaluations: number;
  /** Seconds per unit scheduled out of original order (default 0). */
  readonly divergencePenalty: number;
  /** Distinct solutions kept (default 4). */
  readonly candidates: number;
  /** A greedy rollout before layer 0 and after every this many layers (default 8). */
  readonly rolloutEvery: number;
  /** Tests only: false turns duplicate detection and dominance pruning off. */
  readonly dominance: boolean;
  /** Tests only: every hash lane constant, so every insertion probes one chain (§7.2). */
  readonly testHash?: 'constant';
  /**
   * The local pass (after the seeds and after each rollout; reviews PRF-08 and M7 open item 1)
   * tries or-opt, exchange and 2-opt moves reaching at most this many places either way; 0 turns
   * it off, as does a divergence penalty above 0. Default 24 (`DEFAULT_LOCAL_WINDOW`).
   */
  readonly localWindow?: number;
  /**
   * The constructive seeds before the first rollout (nearest neighbour and cheapest insertion;
   * M7 open item 1). Default true; false turns them off (tests of the beam alone), as does a
   * divergence penalty above 0.
   */
  readonly seeds?: boolean;
  /**
   * The iterated local search after the seeds (review M7Q Q-01): kicks of the best order, each
   * followed by the local pass, when the beam cannot reach a closing depth within the budget or
   * after it is exhausted. Default true; false turns it off (tests of the beam), as do a divergence
   * penalty above 0, `localWindow: 0` and a section of fewer than `KICK_MIN_UNITS` units.
   */
  readonly kicks?: boolean;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  beamWidth: 256,
  maxEvaluations: 4_000_000,
  divergencePenalty: 0,
  candidates: 4,
  rolloutEvery: 8,
  dominance: true,
};

export interface SearchSolution {
  /** Unit indices in schedule order; units not listed are dropped. */
  readonly units: Int32Array;
  /**
   * `elapsedMs + fillMs + exitMs`: known time, with a hearth wait whose length is uncertain (TIME-4)
   * at 0, as the engine prices it. It is the figure the engine's re-walk must agree with (§6.3).
   */
  readonly estimatedMs: number;
  /**
   * The figure solutions are ranked and compared by (review COR-01/02): `estimatedMs` plus, at each
   * hearth use whose wait is uncertain, how far that wait's upper bound exceeds the incumbent's
   * there. `incumbent.estimatedMs − comparedMs` is the saving that holds however long the unknown
   * time was. It equals `estimatedMs` when no wait is uncertain, and for the incumbent.
   */
  readonly comparedMs: number;
  /** Known XP gained by the section's units (before the fill). */
  readonly knownGain: number;
  readonly fillXp: number;
  readonly fillMs: number;
  readonly exitMs: number;
  /** Parts with unknown time (times are lower bounds when above 0), uncertain hearth waits included. */
  readonly unknownParts: number;
  /** The uncertain hearth waits among `unknownParts`. */
  readonly uncertainWaits: number;
}

export interface SearchProgress {
  readonly layer: number;
  readonly evaluations: number;
  readonly beamSize: number;
  readonly incumbentMs: number;
  /** The best solution's `comparedMs`. */
  readonly bestMs: number | null;
}

export interface SearchStats {
  readonly evaluations: number;
  readonly layers: number;
  readonly duplicates: number;
  readonly dominated: number;
  readonly rollouts: number;
  readonly firstImprovementEvaluations: number | null;
  readonly arrayBytes: number;
}

/**
 * Why a search ended: `exhausted` (a beam layer produced no children), `converged` (the iterated
 * local search found no better order for its stall allowance; review M7Q Q-07), `budget`
 * (`maxEvaluations`), `timeout` (`maxMillis`, not reproducible) or `cancelled`.
 */
export type SearchTermination = 'exhausted' | 'converged' | 'budget' | 'timeout' | 'cancelled';

export interface SearchOutcome {
  readonly termination: SearchTermination;
  readonly incumbent: SearchSolution;
  /**
   * Up to `candidates` distinct solutions, best first by `comparedMs`; the incumbent is among them
   * unless beaten. A solution whose `estimatedMs` beats the incumbent's while its `comparedMs` does
   * not is never listed: its saving could be time an uncertain hearth wait absorbs.
   */
  readonly solutions: readonly SearchSolution[];
  readonly stats: SearchStats;
  /**
   * Closes refused only because a grind fill cannot follow unknown XP (XP-4, review PAR-04): each
   * would have closed with the target lowered by its known-XP shortfall. Null when there were none.
   */
  readonly unknownXpBlocked: { readonly closes: number; readonly smallestShortfall: number } | null;
}

export type AdvanceResult =
  | { readonly done: false; readonly progress: SearchProgress; readonly best: SearchSolution | null }
  | { readonly done: true; readonly outcome: SearchOutcome };

export interface Stepper {
  /**
   * Evaluates about `maxEvaluations` candidates: it pauses at the first point after that where it
   * can, and an atomic step (a seed's sub-step, a local move, the pass's prefix states) may overrun
   * it. The next call resumes exactly where this one stopped, so results never depend on the slices.
   */
  advance(maxEvaluations: number): AdvanceResult;
  finish(termination: 'timeout' | 'cancelled'): SearchOutcome;
}

/** A step that needs others applied first (§10, review OP-18). */
export interface StepDependency {
  readonly stepId: StepId;
  readonly requires: readonly StepId[];
}

// =============================================================================================
// The compiled problem (§5, §7). Plain data and typed arrays: structured-clonable, and the typed
// arrays are copies the client transfers.

/** Where an op travels to (§5.2). */
export type OpDest =
  /** No travel (a `complete` without a location, an item target). */
  | { readonly kind: 'none' }
  /** A location; `loc` −1 when it does not resolve (unknown travel, position unknown: SIM-3). */
  | { readonly kind: 'loc'; readonly loc: number; readonly radius: number }
  /** The entity's spawn nearest the from-location: `spawnTables[table]`. */
  | { readonly kind: 'spawn'; readonly table: number }
  /** Zone travel or a death skip: unknown travel, and the position becomes unknown. */
  | { readonly kind: 'lost' };

export interface OpTravel {
  /** A `walk`-mode travel step walks at tier 0 speeds. */
  readonly walk: boolean;
  /** The group whose `leg` waypoints this op walks when they are not done yet, else −1. */
  readonly group: number;
  readonly dest: OpDest;
}

interface OpCommon {
  /** Route index of the step. */
  readonly step: number;
  /** Condition check (`ProblemChecks.conditions`), or −1. */
  readonly cond: number;
  /** A valid `durationOverride` in ms (it replaces interaction, objective and combat parts), else −1. */
  readonly overrideMs: number;
}

/** A step the original walk did not run (inert, skipped by a predicate, or a skip-if-missing turn-in). */
export interface SkipOp extends OpCommon {
  readonly kind: 'skip';
  /** A skip-if-missing turn-in's quest (pool index), which must still be missing; else −1. */
  readonly missing: number;
}

export interface AcceptOp extends OpCommon {
  readonly kind: 'accept';
  readonly travel: OpTravel;
  /** Visit key (TIME-8): the entity's key, −1 for the point reached, −2 for none (no target). */
  readonly entityKey: number;
  /** Pool index of the chosen quest. */
  readonly quest: number;
  /** `ProblemChecks.accepts` index, or −1. */
  readonly availability: number;
  /** `ProblemChecks.anyOf` index, or −1. */
  readonly anyOf: number;
  readonly firstMs: number;
  readonly furtherMs: number;
}

export interface CompleteOp extends OpCommon {
  readonly kind: 'complete';
  readonly travel: OpTravel;
  /** Pool indices of the target quests, first-target order. */
  readonly quests: readonly number[];
  readonly partial: boolean;
  /** A partial step's objective ms (its override or 0). */
  readonly partialMs: number;
  /** `PricingSlice.blocks` index (finish), or −1. */
  readonly block: number;
}

export interface TurnInOp extends OpCommon {
  readonly kind: 'turnin';
  readonly travel: OpTravel;
  readonly quest: number;
  readonly interactionMs: number;
  /** The carried block (D-040) when the quest's log entry is route-accepted, else −1. */
  readonly carry: number;
  /** Whether the original turned the quest in (its quest in the log, or assumed); false for VAL-30. */
  readonly turnsIn: boolean;
  /** A skip-if-missing turn-in the original ran: its quest must still be there. */
  readonly requirePresent: boolean;
}

export interface AbandonOp extends OpCommon {
  readonly kind: 'abandon';
  readonly travel: OpTravel;
  readonly quest: number;
}

/** Travel, note, vendor and train steps: travel then a fixed interaction. */
export interface PlainOp extends OpCommon {
  readonly kind: 'plain';
  readonly travel: OpTravel;
  readonly interactionMs: number;
  /** `PricingSlice.trains` index for a riding train, else −1. */
  readonly train: number;
}

export interface GrindOp extends OpCommon {
  readonly kind: 'grind';
  readonly travel: OpTravel;
  readonly grind: number;
}

export interface HearthUseOp extends OpCommon {
  readonly kind: 'hearth-use';
  /** The bind point's location, or −1 when unbound (unknown travel). */
  readonly bindLoc: number;
}

export interface HearthBindOp extends OpCommon {
  readonly kind: 'hearth-bind';
  readonly travel: OpTravel;
  readonly interactionMs: number;
  /** An unlocated bind: the point id the original stood at (−1 unknown); −2 for a located bind. */
  readonly checkPoint: number;
}

/** Flight and transport steps: priced per from-location and tier with the engine (§5.4). */
export interface TableOp extends OpCommon {
  readonly kind: 'table';
  readonly table: number;
}

export type Op = SkipOp | AcceptOp | CompleteOp | TurnInOp | AbandonOp | PlainOp | GrindOp | HearthUseOp | HearthBindOp | TableOp;

export interface LocationTable {
  readonly count: number;
  readonly mapId: Int32Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** Interned by (mapId, x, y) alone: "moved" and zero-length legs compare point ids (OP-13). */
  readonly pointId: Int32Array;
  readonly pointCount: number;
}

export interface UnitTable {
  readonly count: number;
  /** CSR into `ops`. */
  readonly opStart: Int32Array;
  readonly anchor: Uint8Array;
  /** 1 when the unit must be scheduled (an anchor, or a unit of an obligatory quest). */
  readonly obligatory: Uint8Array;
  /** CSR: the pool quests a unit touches. */
  readonly questStart: Int32Array;
  readonly quests: Int32Array;
  /** The first location the unit travels to from each location (heuristic, §7.4); see `firstDest`. */
  readonly firstDestKind: Uint8Array;
  /** Fixed first destination, or the spawn table (per `firstDestKind`). */
  readonly firstDest: Int32Array;
  /** 1 when the unit grants known XP (turn-ins, completes with kill XP, grind anchors). */
  readonly grantsXp: Uint8Array;
}

export interface QuestTable {
  readonly count: number;
  readonly ids: Float64Array;
  readonly obligatory: Uint8Array;
  /** 0 untouched, 1 in the log, 2 turned in, 3 abandoned (the section start). */
  readonly startStatus: Uint8Array;
  readonly unitStart: Int32Array;
  readonly units: Int32Array;
  /** `PricingSlice.questXp` index. */
  readonly xp: Int32Array;
}

export interface EdgeTable {
  /** CSR of predecessors: `pred[k]` must come before the unit; `kind[k]` 0 require, 1 order. */
  readonly predStart: Int32Array;
  readonly pred: Int32Array;
  readonly kind: Uint8Array;
  /** CSR of `require` successors (drop cascades). */
  readonly succStart: Int32Array;
  readonly succ: Int32Array;
}

export interface GroupTable {
  readonly count: number;
  /** CSR: the waypoint locations of each group's `leg` chain (−1 for one that does not resolve). */
  readonly chainStart: Int32Array;
  readonly chainLoc: Int32Array;
  readonly chainRadius: Float64Array;
  /** 1 when the prefix walked the chain. */
  readonly prefixDone: Uint8Array;
  /** CSR: the units holding an active located step of the group. */
  readonly unitStart: Int32Array;
  readonly units: Int32Array;
}

/** Nearest-spawn tables (§5.2): `data[table × (N + 1) + from + 1]` is the chosen location. */
export interface SpawnTables {
  readonly count: number;
  readonly data: Int32Array;
}

/** Codes of a spawn-table entry that is not a location. */
export const SPAWN_NONE = -2;
/** Unresolved (SIM-3) or several spawns from an unknown position: unknown travel, position unknown. */
export const SPAWN_LOST = -3;

/** Flight and transport prices (§5.4): index `(table × tiers + tier) × (N + 1) + from + 1`. */
export interface AnchorTables {
  readonly count: number;
  /** The step's known ms (`NOT_REQUESTED` for a from-location no candidate can have). */
  readonly ms: Int32Array;
  /** Its `travel` and `waiting` buckets only, for the exit chain (§6.3). */
  readonly exitMs: Int32Array;
  readonly unknown: Uint8Array;
  /** The position after, or −1 unknown. */
  readonly arrival: Int32Array;
}

export interface ObjectiveWorkSpec {
  readonly questId: number;
  readonly index: number;
  readonly objective: ObjectiveDef;
  readonly at: WorldPoint | null;
  readonly place: KillPlace;
}

/** One TIME-10 work block, priced lazily per level (§5.5). */
export interface WorkBlock {
  readonly works: readonly ObjectiveWorkSpec[];
  /** Targets whose work cannot be priced (unknown quest or objective index): the block's time is unknown. */
  readonly unknowns: number;
}

export interface QuestXpSpec {
  readonly questId: number;
  readonly xp: { readonly questLevel: number; readonly baseXp: number; readonly basis: 'era-seed' | 'user' | 'forever-observed' } | null;
  readonly requiredLevel: number | null;
  readonly dungeonQuest: boolean;
}

export interface TrainSpec {
  readonly step: Pick<TrainStep, 'skill' | 'spellId' | 'rank'>;
  /** The riding tier after the step in the original walk (§4.1 rule 4). */
  readonly original: number;
}

export interface GrindSpec {
  readonly until: GrindTarget;
  readonly mobLevel: GrindStep['mobLevel'];
  readonly xpPerHour: GrindStep['xpPerHour'];
  readonly place: KillPlace;
}

/** What the worker needs to price level-dependent work with `src/sim` (§5.5). */
export interface PricingSlice {
  readonly blocks: readonly WorkBlock[];
  readonly questXp: readonly QuestXpSpec[];
  readonly trains: readonly TrainSpec[];
  readonly grinds: readonly GrindSpec[];
  readonly npcs: readonly NpcRecord[];
  readonly items: readonly ItemRecord[];
  /** Spawns of drop NPCs, keyed `npc:<id>`. */
  readonly spawns: readonly { readonly key: string; readonly spawns: readonly SpawnPoint[] }[];
}

/** An accept's availability (§4.2): the static part from the original findings, the dynamic part per state. */
export interface AvailabilityCheck {
  /** Pool index, or −1 for a quest outside the pool (its log membership is then `inLog`). */
  readonly quest: number;
  readonly questId: number;
  readonly inLog: boolean;
  readonly original: Truth;
  /** The truth of the original findings without the dynamic codes. */
  readonly static: Truth;
  readonly minLevel: number | null;
  readonly maxLevel: number | null;
  /** VAL-10: an active parent lifts the level requirement (the relation is held by edges). */
  readonly levelLifted: boolean;
  /** VAL-13 target-unavailable: the target's level and log checks, when the target is neither taken nor done. */
  readonly target: { readonly quest: number; readonly minLevel: number | null; readonly maxLevel: number | null; readonly levelLifted: boolean; readonly inLog: boolean } | null;
}

export type PredicateCheck =
  | { readonly kind: 'fixed'; readonly original: Truth }
  | { readonly kind: 'level'; readonly level: number; readonly xp: number | null; readonly negate: boolean; readonly original: Truth }
  | { readonly kind: 'available'; readonly checks: readonly number[]; readonly match: 'any' | 'all'; readonly negate: boolean; readonly original: Truth };

export interface ConditionCheck {
  /** The group's predicates when this op decides the group (its first step reached), else null. */
  readonly group: readonly PredicateCheck[] | null;
  readonly step: readonly PredicateCheck[];
}

export interface AnyOfCheck {
  /** Candidates in order, as availability checks. */
  readonly candidates: readonly number[];
  /** Position of the original choice among the candidates. */
  readonly chosen: number;
}

export interface ProblemChecks {
  readonly accepts: readonly AvailabilityCheck[];
  readonly conditions: readonly ConditionCheck[];
  readonly anyOf: readonly AnyOfCheck[];
  readonly capacity: number;
  readonly xpStepSkipping: boolean;
  readonly unknownHistory: boolean;
}

export interface StartState {
  readonly loc: number;
  readonly tier: number;
  readonly unknownXp: number;
  readonly sinceCastUnknown: number;
  readonly level: number;
  readonly xpInto: number;
  readonly knownTotal: number;
  readonly readyAtMs: number;
  readonly lastVisit: number;
  /** Log entries at the section start whose quests have no unit in the section. */
  readonly externalActive: number;
}

export interface ClosingRules {
  /** The suffix XP interval `[deltaLo, deltaHi)` on the end known total minus the original's (§4.4). */
  readonly deltaLo: number;
  readonly deltaHi: number;
  readonly originalEndTotal: number;
  /** When a suffix availability reader exists, the end log count must equal the original's. */
  readonly logRule: 'equal' | 'at-most';
  readonly originalLogCount: number;
}

export interface FillRule {
  /** The fill may follow drops (`grindFill: 'replace-quests'`). */
  readonly replaceQuests: boolean;
  /**
   * The known total the fill reaches: the target total, or the suffix XP interval's floor
   * (`closing.originalEndTotal + closing.deltaLo`) when that is higher (review PAR-06).
   */
  readonly total: number;
  /** The fill step's target (`total` as a level and XP); null when it is beyond the XP table. */
  readonly until: Extract<GrindTarget, { kind: 'level' }> | null;
}

export interface SearchProblem {
  readonly rules: EffectiveRules;
  readonly locations: LocationTable;
  /** `tierIndex[t]` is the matrix index of riding tier t, or −1. */
  readonly tierIndex: Int32Array;
  readonly tierCount: number;
  /** `matrix[(tier × N + from) × N + to]`, integer ms or a sentinel. */
  readonly matrix: Int32Array;
  /** Allowed `UNKNOWN_MS` pairs (`from × N + to`, sorted): those the original walk used. */
  readonly unknownPairs: Int32Array;
  /** CSR per location: requested targets by (tier-0 ms, index), at most 48 (§7.4). */
  readonly neighbourStart: Int32Array;
  readonly neighbours: Int32Array;
  readonly units: UnitTable;
  readonly ops: readonly Op[];
  readonly quests: QuestTable;
  readonly edges: EdgeTable;
  readonly groups: GroupTable;
  readonly spawnTables: SpawnTables;
  readonly anchorTables: AnchorTables;
  readonly pricing: PricingSlice;
  readonly checks: ProblemChecks;
  readonly start: StartState;
  readonly closing: ClosingRules;
  /** Op indices of the exit chain, travel and waiting counted only (§5.4). */
  readonly exitOps: Int32Array;
  readonly fill: FillRule;
  /** Target known XP gain. */
  readonly targetXp: number;
  /**
   * Whether the local pass tries its drop move (D-044, review M7Q Q-05): false under
   * `'keep-original'` with the `'shortfall'` fill, where the target is the original's own XP and a
   * drop would rest on thin, estimated kill-XP margins; true for a numeric target or
   * `'replace-quests'`. Closing still drops the optional quests an order leaves unscheduled.
   */
  readonly dropMove: boolean;
  /** Visit keys: point ids, then entity keys (§3.3). */
  readonly visitKeyCount: number;
  /**
   * The incumbent's figures, computed at compile (limits of §7.5 and the heuristic of §7.4).
   * `unknownParts` counts its parts with unknown time other than uncertain hearth waits: the closing
   * limit (§4.3), which the clock cannot change.
   */
  readonly incumbent: { readonly ms: number; readonly gain: number; readonly readyAtMs: number; readonly unknownParts: number; readonly tier: number };
  /**
   * By op index: the upper bound (ms) of the incumbent's uncertain hearth wait at that hearth use
   * (TIME-4), else 0. A candidate's excess over it is priced into `comparedMs` (review COR-01/02).
   */
  readonly incumbentWaits: Float64Array;
}

/** The main thread's decode table (§5.6): unit → steps, and what the fill's dependencies need. */
export interface DecodeTable {
  readonly first: number;
  readonly last: number;
  /** The section's steps, in original order. */
  readonly steps: readonly RouteStep[];
  /** CSR: unit → section-relative step offsets. */
  readonly unitStart: Int32Array;
  readonly unitSteps: Int32Array;
  /** 1 for anchors (locked and implicit), whose relative order is fixed. */
  readonly fixed: Uint8Array;
  readonly fillUntil: Extract<GrindTarget, { kind: 'level' }> | null;
}
