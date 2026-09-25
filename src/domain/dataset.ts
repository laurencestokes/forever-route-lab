import type { AreaId, FactionId, ItemId, NpcId, ObjectId, QuestId, SkillId, SpellId, UiMapId, WorldMapId } from './ids';
import type { InstancePresence, SourcedPoint, UnmappedAreaPoint, WorldPoint } from './points';

/**
 * Dataset record types (docs/ARCHITECTURE.md §5.3). Records are produced by tools/questiedb and
 * loaded by infra/data. Missing upstream values are `null`, never QuestieDB's pad-to-0.
 *
 * **Single ids are never 0.** Where upstream writes 0 for "none" in a single-id field, the
 * extractor ships `null` (DATA_PROVENANCE §6, "0 → null"): a non-null id below is a positive id,
 * or a non-zero signed id where the field says so (`zoneOrSort`, `requirements.spell`). Consumers
 * test `!== null` and never look up id 0. Masks (`races`, `classes`) and values (`rank`,
 * `itemClass`, levels) are not ids: their 0 is a real value.
 */

export type EntityRef =
  | { readonly kind: 'npc'; readonly id: NpcId }
  | { readonly kind: 'object'; readonly id: ObjectId }
  | { readonly kind: 'item'; readonly id: ItemId };

/**
 * Provenance vocabulary shared by quests, NPCs, objects and items (DATA_PROVENANCE §9.3).
 * `upstreamDiff` is a fact about QuestieDB; `foreverStatus` is a claim about the game.
 */
export interface RecordProvenance {
  readonly upstreamDiff: 'era' | 'era-coords' | 'forever-new' | 'forever-changed';
  readonly foreverStatus: 'unknown' | 'user-declared-new' | 'user-declared-changed';
  /** A static correction changed at least one field. */
  readonly corrected: boolean;
  /** A static correction created the record. */
  readonly created: boolean;
  readonly source: 'questiedb' | 'custom';
}

/**
 * One quest objective, in Questie's ObjectiveData order (§5.4). QuestieDB carries no required
 * counts, so `count` is null unless a user supplies one.
 */
export type ObjectiveDef =
  | { readonly kind: 'kill'; readonly npcId: NpcId; readonly label: string | null; readonly count: number | null }
  | { readonly kind: 'object'; readonly objectId: ObjectId; readonly label: string | null; readonly count: number | null }
  | { readonly kind: 'item'; readonly itemId: ItemId; readonly label: string | null; readonly count: number | null }
  | { readonly kind: 'reputation'; readonly factionId: FactionId; readonly value: number }
  | {
      readonly kind: 'killCredit';
      readonly npcIds: readonly NpcId[];
      readonly rootNpcId: NpcId;
      readonly label: string | null;
      readonly count: number | null;
    }
  | {
      readonly kind: 'spell';
      readonly spellId: SpellId;
      /** null when upstream has none (nil or 0). */
      readonly itemId: ItemId | null;
      readonly label: string | null;
    }
  | { readonly kind: 'event'; readonly text: string | null; readonly points: readonly PublishedPoint[] };

/** A point as QuestieDB publishes it, after AreaId → UiMap mapping at load. */
export type PublishedPoint = SourcedPoint | InstancePresence | UnmappedAreaPoint;

/** QuestieDB `extraObjectives`: hidden helper objectives. Never counted as objectives. */
export interface ExtraObjective {
  readonly text: string | null;
  readonly objectiveIndex: number | null;
  readonly points: readonly PublishedPoint[];
  readonly refs: readonly EntityRef[];
}

/**
 * Availability relations between quests, with QuestieDB semantics (SIMULATION.md VAL-8..18).
 * `preQuestGroup` entries are signed: a negative id must be completed exactly (no exclusive
 * substitution).
 */
export interface QuestPrerequisites {
  readonly preQuestSingle: readonly QuestId[];
  readonly preQuestGroup: readonly number[];
  readonly exclusiveTo: readonly QuestId[];
  /** A positive quest id, or null for none (upstream nil or 0; a faction layer may set it to null). */
  readonly nextQuestInChain: QuestId | null;
  /** A positive quest id, or null for none (upstream nil or 0). */
  readonly parentQuest: QuestId | null;
  readonly childQuests: readonly QuestId[];
  readonly inGroupWith: readonly QuestId[];
  /** A positive quest id, or null for none (upstream nil or 0). */
  readonly breadcrumbForQuestId: QuestId | null;
  readonly breadcrumbs: readonly QuestId[];
  /** A positive quest id, or null for none (upstream nil or 0). */
  readonly availableUntilCompleted: QuestId | null;
  /** A positive quest id, or null for none (upstream nil or 0). */
  readonly availableStartingWith: QuestId | null;
  /** A positive quest id, or null for none (upstream nil or 0). */
  readonly disabledByQuest: QuestId | null;
}

export interface QuestRequirements {
  readonly skill: { readonly skillId: SkillId; readonly value: number } | null;
  readonly minReputation: { readonly factionId: FactionId; readonly value: number } | null;
  readonly maxReputation: { readonly factionId: FactionId; readonly value: number } | null;
  /** Positive: must know the spell. Negative: must not know it. Never 0: none is null (upstream nil or 0). */
  readonly spell: number | null;
  /** A positive id, or null for none (upstream nil or 0). */
  readonly specialization: number | null;
  /** A positive item id, or null for none (upstream nil or 0). */
  readonly sourceItemId: ItemId | null;
  readonly requiredSourceItems: readonly ItemId[];
}

/** Base quest XP. `era-seed` values are QuestieDB's Era table; the Forever values are unknown. */
export interface QuestXp {
  readonly questLevel: number;
  readonly baseXp: number;
  readonly basis: 'era-seed' | 'user' | 'forever-observed';
}

export interface QuestRecord {
  readonly id: QuestId;
  readonly name: string;
  readonly level: number | null;
  readonly minLevel: number | null;
  readonly maxLevel: number | null;
  /** Race mask; test bits arithmetically, never with `&` (D-012). null = any race. */
  readonly races: number | null;
  /** Class mask; bit (classId - 1). null = any class. */
  readonly classes: number | null;
  /** >0 AreaTable id, <0 QuestSort id; never 0: none is null (upstream nil or 0). */
  readonly zoneOrSort: number | null;
  readonly dungeonQuest: boolean;
  readonly starters: readonly EntityRef[];
  readonly finishers: readonly EntityRef[];
  readonly objectives: readonly ObjectiveDef[];
  readonly objectiveHints: readonly ExtraObjective[];
  readonly objectivesText: readonly string[] | null;
  readonly prerequisites: QuestPrerequisites;
  readonly requirements: QuestRequirements;
  readonly reputationReward: readonly { readonly factionId: FactionId; readonly value: number }[];
  readonly flags: {
    readonly repeatable: boolean;
    readonly needsEvent: boolean;
    readonly questFlags: number;
    readonly specialFlags: number;
  };
  readonly xp: QuestXp | null;
  readonly provenance: RecordProvenance;
}

export interface NpcRecord {
  readonly id: NpcId;
  readonly name: string;
  readonly subName: string | null;
  readonly minLevel: number | null;
  readonly maxLevel: number | null;
  /** Creature rank: 0 normal, 1 elite, 2 rare elite, 3 boss, 4 rare; null when unknown. */
  readonly rank: number | null;
  /** A positive AreaTable id, or null when upstream gives none or 0 ("unknown or varies"). */
  readonly zoneId: AreaId | null;
  readonly npcFlags: number;
  /** Which factions can interact: 'A', 'H', 'AH', or null when unknown. */
  readonly friendlyTo: 'A' | 'H' | 'AH' | null;
  readonly questStarts: readonly QuestId[];
  readonly questEnds: readonly QuestId[];
  readonly provenance: RecordProvenance;
}

export interface ObjectRecord {
  readonly id: ObjectId;
  readonly name: string;
  /** A positive AreaTable id, or null when upstream gives none or 0 ("unknown or varies"). */
  readonly zoneId: AreaId | null;
  /** A positive faction template id, or null for none (upstream nil or 0). */
  readonly factionId: FactionId | null;
  readonly questStarts: readonly QuestId[];
  readonly questEnds: readonly QuestId[];
  readonly provenance: RecordProvenance;
}

export interface ItemRecord {
  readonly id: ItemId;
  readonly name: string;
  readonly itemClass: number | null;
  readonly dropNpcs: readonly NpcId[];
  readonly dropObjects: readonly ObjectId[];
  readonly dropItems: readonly ItemId[];
  /** A positive quest id, or null for none (upstream nil or 0). */
  readonly startsQuest: QuestId | null;
  readonly provenance: RecordProvenance;
}

/** A spawn with its published source point and, when geometry allows, its resolved world point. */
export interface SpawnPoint {
  readonly source: PublishedPoint;
  readonly world: WorldPoint | null;
  /**
   * The UiMap its `world` point is on, not the zone the entity is in: for a zone point the UiMap
   * it was published on, for instance presence (`source.kind === 'instance'`) the UiMap of its
   * dungeon's entrance, and null when there is no world point. Name a presence spawn's place from
   * `source`, e.g. "an instance (entrance in Westfall)" (M2 review COORD-2).
   */
  readonly uiMapId: UiMapId | null;
}

export interface ZoneInfo {
  readonly uiMapId: UiMapId;
  /** Null where no validated name exists (for example UiMaps 1463, 1464, 2665). */
  readonly name: string | null;
  readonly worldMapId: WorldMapId | null;
}

/** What the loaded dataset says about itself (from public/data/manifest.json). */
export interface DatasetIdentity {
  readonly dataRevision: string;
  readonly frameBuild: string;
  readonly upstreamCommit: string;
  readonly foreverContentVerified: boolean;
}

/**
 * The synchronous read interface the engine, validator and optimiser compiler see: the dataset
 * overlaid with the project's custom quests, quest overrides and character overlays. Iteration is
 * always in ascending id order, so consumers are deterministic regardless of load order.
 */
export interface DatasetView {
  readonly identity: DatasetIdentity;
  quest(id: QuestId): QuestRecord | undefined;
  npc(id: NpcId): NpcRecord | undefined;
  object(id: ObjectId): ObjectRecord | undefined;
  item(id: ItemId): ItemRecord | undefined;
  quests(): readonly QuestRecord[];
  spawns(ref: EntityRef): readonly SpawnPoint[];
  zone(id: UiMapId): ZoneInfo | undefined;
  zones(): readonly ZoneInfo[];
}
