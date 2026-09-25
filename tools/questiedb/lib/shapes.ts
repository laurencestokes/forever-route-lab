import type { QuestXp, RecordProvenance } from '../../../src/domain/dataset';

/**
 * The shipped JSON shapes of public/data (DATA_PROVENANCE §6). They follow the domain records in
 * src/domain/dataset.ts field for field, with plain numbers for ids, and differ from them in one
 * way: published points stay as published, a {@link PointMap} (AreaTable id → `[x, y]` rows),
 * which infra/data turns into `PublishedPoint`s at load (D-017, ARCHITECTURE §5.2).
 */

/** Every generated JSON file starts with this key (DATA_PROVENANCE §7 item 3). */
export interface GeneratedMarker {
  readonly by: string;
  readonly upstream: string;
  readonly notice: string;
  readonly manifest: string;
  readonly edit: string;
}

/**
 * Points as published, keyed by AreaTable id (ascending). A row is `[x, y]` (0-100 zone percent,
 * never rounded or re-projected), `[x, y, phase]` when upstream gives a non-zero phase, or
 * `[-1, -1]`, the instance-presence sentinel (never a point).
 */
export type PointRow = readonly [number, number] | readonly [number, number, number];
export type PointMap = Readonly<Record<string, readonly PointRow[]>>;

export type EntityRefRow =
  | { readonly kind: 'npc'; readonly id: number }
  | { readonly kind: 'object'; readonly id: number }
  | { readonly kind: 'item'; readonly id: number };

export type ObjectiveRow =
  | { readonly kind: 'kill'; readonly npcId: number; readonly label: string | null; readonly count: null }
  | { readonly kind: 'object'; readonly objectId: number; readonly label: string | null; readonly count: null }
  | { readonly kind: 'item'; readonly itemId: number; readonly label: string | null; readonly count: null }
  | { readonly kind: 'reputation'; readonly factionId: number; readonly value: number }
  | { readonly kind: 'killCredit'; readonly npcIds: readonly number[]; readonly rootNpcId: number; readonly label: string | null; readonly count: null }
  | { readonly kind: 'spell'; readonly spellId: number; readonly itemId: number | null; readonly label: string | null }
  | { readonly kind: 'event'; readonly text: string | null; readonly points: PointMap };

export interface ObjectiveHintRow {
  readonly text: string | null;
  /** As published (Questie's objective index this hint belongs to), or null. */
  readonly objectiveIndex: number | null;
  readonly points: PointMap;
  readonly refs: readonly EntityRefRow[];
}

/** `QuestPrerequisites` (src/domain/dataset.ts) with plain numbers. */
export interface PrerequisitesRow {
  readonly preQuestSingle: readonly number[];
  readonly preQuestGroup: readonly number[];
  readonly exclusiveTo: readonly number[];
  readonly nextQuestInChain: number | null;
  readonly parentQuest: number | null;
  readonly childQuests: readonly number[];
  readonly inGroupWith: readonly number[];
  readonly breadcrumbForQuestId: number | null;
  readonly breadcrumbs: readonly number[];
  readonly availableUntilCompleted: number | null;
  readonly availableStartingWith: number | null;
  readonly disabledByQuest: number | null;
}

/** `QuestRequirements` (src/domain/dataset.ts) with plain numbers. */
export interface RequirementsRow {
  readonly skill: { readonly skillId: number; readonly value: number } | null;
  readonly minReputation: { readonly factionId: number; readonly value: number } | null;
  readonly maxReputation: { readonly factionId: number; readonly value: number } | null;
  readonly spell: number | null;
  readonly specialization: number | null;
  readonly sourceItemId: number | null;
  readonly requiredSourceItems: readonly number[];
}

export interface QuestRow {
  readonly id: number;
  readonly name: string;
  readonly level: number | null;
  readonly minLevel: number | null;
  readonly maxLevel: number | null;
  readonly races: number | null;
  readonly classes: number | null;
  readonly zoneOrSort: number | null;
  readonly dungeonQuest: boolean;
  readonly starters: readonly EntityRefRow[];
  readonly finishers: readonly EntityRefRow[];
  readonly objectives: readonly ObjectiveRow[];
  readonly objectiveHints: readonly ObjectiveHintRow[];
  readonly objectivesText: readonly string[] | null;
  readonly prerequisites: PrerequisitesRow;
  readonly requirements: RequirementsRow;
  readonly reputationReward: readonly { readonly factionId: number; readonly value: number }[];
  readonly flags: { readonly repeatable: boolean; readonly needsEvent: boolean; readonly questFlags: number; readonly specialFlags: number };
  readonly xp: QuestXp | null;
  readonly provenance: RecordProvenance;
}

export interface NpcRow {
  readonly id: number;
  readonly name: string;
  readonly subName: string | null;
  readonly minLevel: number | null;
  readonly maxLevel: number | null;
  readonly rank: number | null;
  readonly zoneId: number | null;
  readonly npcFlags: number;
  readonly friendlyTo: 'A' | 'H' | 'AH' | null;
  readonly questStarts: readonly number[];
  readonly questEnds: readonly number[];
  readonly provenance: RecordProvenance;
}

export interface ObjectRow {
  readonly id: number;
  readonly name: string;
  readonly zoneId: number | null;
  readonly factionId: number | null;
  readonly questStarts: readonly number[];
  readonly questEnds: readonly number[];
  readonly provenance: RecordProvenance;
}

export interface ItemRow {
  readonly id: number;
  readonly name: string;
  readonly itemClass: number | null;
  readonly dropNpcs: readonly number[];
  readonly dropObjects: readonly number[];
  readonly dropItems: readonly number[];
  readonly startsQuest: number | null;
  readonly provenance: RecordProvenance;
}

export interface QuestsFile {
  readonly _generated: GeneratedMarker;
  readonly rows: readonly QuestRow[];
}

export interface EntitiesFile {
  readonly _generated: GeneratedMarker;
  readonly npcs: readonly NpcRow[];
  readonly objects: readonly ObjectRow[];
}

export interface ItemsFile {
  readonly _generated: GeneratedMarker;
  readonly rows: readonly ItemRow[];
}

export interface SpawnsFile {
  readonly _generated: GeneratedMarker;
  /** npc id → its spawns; an entity without spawns has no key. */
  readonly npc: Readonly<Record<string, PointMap>>;
  readonly object: Readonly<Record<string, PointMap>>;
}

/**
 * How an AreaTable id reaches a UiMap (DATA_PROVENANCE §6.5-6.6):
 * - `direct`: a base row of areaIdToUiMapId whose AreaId is the UiMap's own AreaId (the
 *   UiMapAssignment AreaID that defines the zone frame; 54 at the pin);
 * - `routed`: any other base row, a subzone routed to its parent zone's UiMap. It defines no frame
 *   of its own; a loader reads its points in the mapped UiMap's frame, as Questie does, and
 *   `validate` fails if a drawable published point uses one (none at the pin; COORD-3);
 * - `synthetic-alias`: an override for a synthetic continent/world AreaId (10073, 10074, 10089);
 * - `legacy-compat`: one of the legacy dungeon compatibility pairs (not a native Forever map; a
 *   point there is `UnmappedAreaPoint` reason `instance-area`);
 * - `suppressed`: UiMap 0, display suppressed (reason `suppressed`).
 * An AreaId absent from `areas` has no UiMap (reason `no-uimap`).
 */
export type AreaLink = 'direct' | 'routed' | 'synthetic-alias' | 'legacy-compat' | 'suppressed';

export interface AreaRow {
  readonly uiMapId: number;
  readonly link: AreaLink;
}

export interface UiMapRow {
  readonly name: string | null;
  /** `questiedb:support/Forever/Zones/uiMapIdToAreaId.lua:<line>`, or null with the name. */
  readonly nameSource: string | null;
  /** The canonical AreaId of uiMapIdToAreaId, or null when the file does not list the UiMap. */
  readonly areaId: number | null;
}

export interface EntranceRow {
  readonly areaId: number;
  readonly x: number;
  readonly y: number;
  /**
   * False for the entrances on a changed Era→Forever frame that QuestieDB's own audit leaves
   * unverified (docs/forever-coordinate-audit.md; `FRAME_UNVERIFIED_ENTRANCES` in lib/zones.ts):
   * their frame is unknown, so they are not usable as Forever positions. True otherwise.
   */
  readonly frameVerified: boolean;
}

export interface DungeonRow {
  readonly name: string;
  readonly alternativeAreaIds: readonly number[];
  readonly parentZoneAreaId: number;
  readonly entrances: readonly EntranceRow[];
}

export interface InstanceAreaRow {
  /** The dungeons.lua entry this presence resolves to (by key, else by alternative id), or null. */
  readonly dungeonAreaId: number | null;
}

export interface ZonesFile {
  readonly _generated: GeneratedMarker;
  readonly areas: Readonly<Record<string, AreaRow>>;
  readonly uiMaps: Readonly<Record<string, UiMapRow>>;
  /** Faction-invariant dungeons.lua entries; faction-dependent ones are in overlays.json. */
  readonly dungeons: Readonly<Record<string, DungeonRow>>;
  /** AreaIds used as `[-1, -1]` presence keys in the shipped points. */
  readonly instanceAreas: Readonly<Record<string, InstanceAreaRow>>;
}

export type QuestPatch = Partial<Omit<QuestRow, 'id' | 'provenance'>>;
export type NpcPatch = Partial<Omit<NpcRow, 'id' | 'provenance'>> & { readonly spawns?: PointMap };
export type ObjectPatch = Partial<Omit<ObjectRow, 'id' | 'provenance'>> & { readonly spawns?: PointMap };
export type ItemPatch = Partial<Omit<ItemRow, 'id' | 'provenance'>>;

export interface FactionLayer {
  readonly quests: Readonly<Record<string, QuestPatch>>;
  readonly npcs: Readonly<Record<string, NpcPatch>>;
  readonly objects: Readonly<Record<string, ObjectPatch>>;
  readonly items: Readonly<Record<string, ItemPatch>>;
  /** Whole replacement entries for faction-dependent dungeons.lua entries. */
  readonly dungeons: Readonly<Record<string, DungeonRow>>;
}

export interface ClassLayer {
  readonly quests: Readonly<Record<string, QuestPatch>>;
}

export interface OverlaysFile {
  readonly _generated: GeneratedMarker;
  readonly faction: { readonly Alliance: FactionLayer; readonly Horde: FactionLayer };
  /** Applied after the faction layer: faction → class token (UnitClassBase) → patches. */
  readonly class: { readonly Alliance: Readonly<Record<string, ClassLayer>>; readonly Horde: Readonly<Record<string, ClassLayer>> };
}
