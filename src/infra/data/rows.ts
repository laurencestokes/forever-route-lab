import type { ClassToken, Faction } from '../../domain/character';
import type { EntityRef, ItemRecord, NpcRecord, ObjectiveDef, ObjectRecord, QuestRecord } from '../../domain/dataset';

/**
 * The shipped JSON shapes of `public/data/` as the loader reads them (DATA_PROVENANCE §6;
 * `tools/questiedb/lib/shapes.ts` states the same shapes for the writer).
 *
 * A JSON record equals its domain record (src/domain/dataset.ts) field for field, so NPC, object
 * and item rows *are* domain records once `schema.ts` has checked them, and ids carry their
 * brands from the start. The one difference is published points: they stay a {@link PointMap}
 * (AreaTable id → rows) in the files, and `points.ts` turns them into `PublishedPoint`s at load
 * (D-017). Quest rows therefore differ from `QuestRecord` in their event objectives and hints.
 */

/**
 * One published row: `[x, y]` (0-100 zone percent as published), `[x, y, phase]` when upstream
 * gives a non-zero phase, or exactly `[-1, -1]`, the instance-presence sentinel.
 */
export type PointRow = readonly [number, number] | readonly [number, number, number];

/** Points keyed by AreaTable id (a decimal string); keys iterate in ascending numeric order. */
export type PointMap = Readonly<Record<string, readonly PointRow[]>>;

/** The `_generated` marker every generated file starts with (DATA_PROVENANCE §7 item 3). */
export interface GeneratedMarker {
  readonly by: string;
  readonly upstream: string;
  readonly notice: string;
  readonly manifest: string;
  readonly edit: string;
}

type NonEventObjective = Exclude<ObjectiveDef, { readonly kind: 'event' }>;

export interface EventObjectiveRow {
  readonly kind: 'event';
  readonly text: string | null;
  readonly points: PointMap;
}

export type ObjectiveRow = NonEventObjective | EventObjectiveRow;

export interface ObjectiveHintRow {
  readonly text: string | null;
  readonly objectiveIndex: number | null;
  readonly points: PointMap;
  readonly refs: readonly EntityRef[];
}

export type QuestRow = Omit<QuestRecord, 'objectives' | 'objectiveHints'> & {
  readonly objectives: readonly ObjectiveRow[];
  readonly objectiveHints: readonly ObjectiveHintRow[];
};

export type NpcRow = NpcRecord;
export type ObjectRow = ObjectRecord;
export type ItemRow = ItemRecord;

/**
 * How an AreaTable id reaches a UiMap (DATA_PROVENANCE §6.5-§6.6):
 *
 * - `direct`: the AreaId is the UiMap's own AreaId, the UiMapAssignment AreaID that defines the
 *   zone frame (54 at the pin);
 * - `routed`: a subzone that QuestieDB routes to its parent zone's UiMap. It defines no frame of
 *   its own; its points are read in the mapped UiMap's frame, as Questie does. `validate` fails if
 *   a drawable published point uses one (none at the pin), so a pin bump that ships one is reviewed
 *   first (M2 review COORD-3);
 * - `synthetic-alias`: a synthetic continent or world AreaId (10073, 10074, 10089);
 * - `legacy-compat` (a legacy dungeon pair) and `suppressed` (UiMap 0) give no map position.
 *
 * `direct`, `routed` and `synthetic-alias` give zone points in the mapped UiMap's frame. An AreaId
 * missing from `areas` has no UiMap at all.
 */
export type AreaLink = 'direct' | 'routed' | 'synthetic-alias' | 'legacy-compat' | 'suppressed';

/** Every `AreaLink`, in the order `zones.json` documents them. */
export const AREA_LINKS: readonly AreaLink[] = ['direct', 'routed', 'synthetic-alias', 'legacy-compat', 'suppressed'];

export interface AreaRow {
  readonly uiMapId: number;
  readonly link: AreaLink;
}

export interface UiMapRow {
  readonly name: string | null;
  readonly nameSource: string | null;
  readonly areaId: number | null;
}

export interface EntranceRow {
  readonly areaId: number;
  readonly x: number;
  readonly y: number;
  /**
   * False for an entrance on a changed Era→Forever frame that QuestieDB's own audit leaves
   * unverified (docs/forever-coordinate-audit.md at the pin; three at the pin): which frame its
   * percentages are in is unknown, so it is never used as a Forever position (M2 review COORD-4).
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
  readonly dungeonAreaId: number | null;
}

export interface ZonesTable {
  readonly areas: Readonly<Record<string, AreaRow>>;
  readonly uiMaps: Readonly<Record<string, UiMapRow>>;
  /** Faction-invariant `dungeons.lua` entries; the faction-dependent ones are in the overlays. */
  readonly dungeons: Readonly<Record<string, DungeonRow>>;
  /** Every AreaId used as a `[-1, -1]` presence key, with the dungeon it belongs to. */
  readonly instanceAreas: Readonly<Record<string, InstanceAreaRow>>;
}

export interface SpawnsTable {
  /** NPC id → its published spawns; an entity without spawns has no key. */
  readonly npc: Readonly<Record<string, PointMap>>;
  readonly object: Readonly<Record<string, PointMap>>;
}

/** A patch holds whole top-level fields (never `id` or `provenance`), merged shallowly. */
export type QuestPatch = Partial<Omit<QuestRow, 'id' | 'provenance'>>;
export type NpcPatch = Partial<Omit<NpcRow, 'id' | 'provenance'>> & { readonly spawns?: PointMap };
export type ObjectPatch = Partial<Omit<ObjectRow, 'id' | 'provenance'>> & { readonly spawns?: PointMap };
export type ItemPatch = Partial<Omit<ItemRow, 'id' | 'provenance'>>;

export interface FactionLayer {
  readonly quests: Readonly<Record<string, QuestPatch>>;
  readonly npcs: Readonly<Record<string, NpcPatch>>;
  readonly objects: Readonly<Record<string, ObjectPatch>>;
  readonly items: Readonly<Record<string, ItemPatch>>;
  /** Whole replacement entries for the faction-dependent `dungeons.lua` entries. */
  readonly dungeons: Readonly<Record<string, DungeonRow>>;
}

export interface ClassLayer {
  readonly quests: Readonly<Record<string, QuestPatch>>;
}

/** Applied in order: static record → `faction[F]` → `class[F][C]` (DATA_PROVENANCE §6.7). */
export interface OverlaysTable {
  readonly faction: Readonly<Record<Faction, FactionLayer>>;
  readonly class: Readonly<Record<Faction, Readonly<Partial<Record<ClassToken, ClassLayer>>>>>;
}

/** The six data files, checked and with their `_generated` wrappers stripped. */
export interface DatasetFiles {
  readonly quests: readonly QuestRow[];
  readonly npcs: readonly NpcRow[];
  readonly objects: readonly ObjectRow[];
  readonly items: readonly ItemRow[];
  readonly spawns: SpawnsTable;
  readonly zones: ZonesTable;
  readonly overlays: OverlaysTable;
}

/** The JSON files `manifest.json` lists besides `NOTICE.md`, in path order. */
export const DATA_JSON_FILES = ['entities.json', 'items.json', 'overlays.json', 'quests.json', 'spawns.json', 'zones.json'] as const;
export type DataJsonFile = (typeof DATA_JSON_FILES)[number];

export const DATA_NOTICE_FILE = 'NOTICE.md';

/** Every output a manifest must list, exactly (sorted by path, as the manifest writes them). */
export const DATA_OUTPUT_FILES: readonly string[] = [DATA_NOTICE_FILE, ...DATA_JSON_FILES];
