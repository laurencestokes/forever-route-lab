import type { FilterAst, StepCondition } from './conditions';
import type { EntityRef } from './dataset';
import type { GroupId, NpcId, QuestId, RouteId, SkillId, SpellId, StepId } from './ids';
import type { Location, SourcedPoint } from './points';

/**
 * Canonical route model (docs/ARCHITECTURE.md §8.1, D-020). A route is a flat list of atomic
 * steps plus a `groups` sidecar holding what belongs to an imported RXP step as a whole.
 * RXP is an import/export format, never the internal representation.
 */

/** Points at the physical line range (1-based, inclusive) a step or group came from. */
export interface SourceLineRef {
  readonly importId: string;
  readonly firstLine: number;
  readonly lastLine: number;
}

export interface StepOrigin {
  readonly source: 'manual' | 'rxp' | 'optimizer' | 'duplicate' | 'paste';
  readonly ref: string | null;
}

/**
 * A flight node. New Forever flight masters have no NPC in the dataset, so a node can also be
 * named by its client TaxiNodes id (a cited value, D-022) or by the name text a guide used.
 */
export interface TaxiNodeRef {
  readonly npcId: NpcId | null;
  readonly taxiNodeId: number | null;
  readonly name: string | null;
}

export interface TransportRef {
  readonly id: string | null;
  readonly dock: Location | null;
}

/** Unsupported source text carried verbatim so export can reproduce it. */
export interface PreservedSource {
  readonly format: 'rxp';
  readonly lines: readonly string[];
}

interface StepBase {
  readonly id: StepId;
  /** Where the step happens; for travel, the destination. */
  readonly location: Location | null;
  readonly note: string | null;
  /** Locked steps are optimiser anchors: never removed, never reordered relative to each other. */
  readonly locked: boolean;
  readonly groupId: GroupId | null;
  /** Line-level condition. Group-level conditions live on the RouteGroup. */
  readonly condition: StepCondition | null;
  /** User override of the estimated duration, seconds. */
  readonly durationOverride: number | null;
  readonly origin: StepOrigin;
  /** The `>>` text and source line of the RXP line this step came from. */
  readonly rxp: { readonly text: string | null; readonly line: SourceLineRef | null } | null;
  /** Forward-compatible extension bag (for example future planned-vs-actual telemetry). */
  readonly ext: Readonly<Record<string, unknown>> | null;
}

export interface ObjectiveTarget {
  readonly questId: QuestId;
  /** Index into the quest's objectives (Questie ObjectiveData order); null means all. */
  readonly objective: number | null;
}

/**
 * How far to grind. Level targets carry an optional offset resolved by the engine with the
 * ruleset XP table: RXP `.xp 10+2500` is `xpInto 2500`, `.xp 10-300` is `xpShort 300`,
 * `.xp 10.5` is `fraction 0.5`.
 */
export type GrindTarget =
  | {
      readonly kind: 'level';
      readonly level: number;
      readonly offset:
        | { readonly kind: 'xpInto'; readonly xp: number }
        | { readonly kind: 'xpShort'; readonly xp: number }
        | { readonly kind: 'fraction'; readonly fraction: number }
        | null;
    }
  | { readonly kind: 'duration'; readonly seconds: number };

export type AcceptStep = StepBase & {
  readonly kind: 'accept';
  readonly questId: QuestId;
  /** RXP `.acceptmultiple`-style any-of alternatives, or null. */
  readonly anyOf: readonly QuestId[] | null;
  readonly via: EntityRef | null;
};
export type CompleteStep = StepBase & {
  readonly kind: 'complete';
  /** One work block; several targets share kill targets, drops or an area. */
  readonly targets: readonly ObjectiveTarget[];
  /** `partial`: work continues in a later step (RXP sticky / #completewith windows). */
  readonly progress: 'finish' | 'partial';
};
export type TurnInStep = StepBase & {
  readonly kind: 'turnin';
  readonly questId: QuestId;
  /** Any-of alternatives (RXP `.turninmultiple`), or null. */
  readonly anyOf: readonly QuestId[] | null;
  /** 1-based reward choice as RXP writes it, or null. */
  readonly rewardIndex: number | null;
  /** RXP negative-id idiom: skip silently when the quest is not in the log. */
  readonly skipIfMissing: boolean;
  readonly via: EntityRef | null;
};
export type AbandonStep = StepBase & { readonly kind: 'abandon'; readonly questId: QuestId };
export type TravelStep = StepBase & {
  readonly kind: 'travel';
  readonly mode: 'auto' | 'walk' | 'mount' | 'transport';
  readonly transport: TransportRef | null;
};
export type GrindStep = StepBase & {
  readonly kind: 'grind';
  readonly until: GrindTarget;
  readonly mobLevel: number | null;
  readonly xpPerHour: number | null;
};
/** `use` teleports to the character's bind point (from engine state); `bind` sets it here. */
export type HearthStep = StepBase & { readonly kind: 'hearth'; readonly mode: 'use' | 'bind' };
export type FlightStep = StepBase & {
  readonly kind: 'flight';
  readonly mode: 'take' | 'discover';
  readonly from: TaxiNodeRef | null;
  readonly to: TaxiNodeRef | null;
  /** Node-name text as written in an RXP guide (`.fly`, `.fp`), for later resolution. */
  readonly nodeQuery: string | null;
};
/**
 * Riding is recognised from `skill: 'riding'` or from a ruleset table of riding spell ids, so an
 * imported `.train <riding spell>` enables mounted travel.
 */
export type TrainStep = StepBase & {
  readonly kind: 'train';
  readonly spellId: SpellId | null;
  readonly skill: 'riding' | 'class' | 'profession' | null;
  /** Skill line for profession training, so the engine can raise the skill. */
  readonly skillId: SkillId | null;
  readonly rank: number | null;
  readonly what: string | null;
  readonly cost: number | null;
};
export type VendorStep = StepBase & { readonly kind: 'vendor'; readonly what: string | null };
export type NoteStep = StepBase & {
  readonly kind: 'note';
  readonly text: string;
  readonly preserved: PreservedSource | null;
};

export type RouteStep =
  | AcceptStep
  | CompleteStep
  | TurnInStep
  | AbandonStep
  | TravelStep
  | GrindStep
  | HearthStep
  | FlightStep
  | TrainStep
  | VendorStep
  | NoteStep;

export type StepKind = RouteStep['kind'];

export const STEP_KINDS: readonly StepKind[] = [
  'accept',
  'complete',
  'turnin',
  'abandon',
  'travel',
  'grind',
  'hearth',
  'flight',
  'train',
  'vendor',
  'note',
];

/** Steps that change quest state; everything else is a non-quest step for the optimiser. */
export const QUEST_STEP_KINDS: ReadonlySet<StepKind> = new Set(['accept', 'complete', 'turnin', 'abandon']);

/** An RXP `#tag`, kept verbatim (name without `#`). */
export interface RxpTag {
  readonly name: string;
  readonly value: string | null;
  /** `#key = value` assignment form (stored, never evaluated). */
  readonly assignment: boolean;
  readonly line: SourceLineRef | null;
}

/** An RXP command kept as an annotation (for example `.target`, `.mob`, `.use`). */
export interface RxpCommandNode {
  readonly command: string;
  readonly args: readonly string[];
  readonly text: string | null;
  readonly filter: FilterAst | null;
  readonly line: SourceLineRef | null;
}

export interface Waypoint {
  readonly point: SourcedPoint;
  /** `leg`: a route leg to walk through; `pin`: shown only; `closest`: nearest of a set. */
  readonly role: 'leg' | 'pin' | 'closest';
  readonly radius: number | null;
  readonly filter: FilterAst | null;
  readonly line: SourceLineRef | null;
}

export interface RxpGroupData {
  readonly importId: string;
  readonly stepIndex: number;
  readonly tags: readonly RxpTag[];
  readonly condition: StepCondition | null;
  readonly waypoints: readonly Waypoint[];
  readonly annotations: readonly RxpCommandNode[];
  /** Hash of the group's canonical lowering at import; equal means unedited (lossless export). */
  readonly fingerprint: string;
}

export interface RouteGroup {
  readonly id: GroupId;
  readonly rxp: RxpGroupData | null;
}

export interface Route {
  readonly id: RouteId;
  readonly name: string;
  readonly description: string;
  readonly steps: readonly RouteStep[];
  /** Keyed by GroupId. */
  readonly groups: Readonly<Record<string, RouteGroup>>;
}
