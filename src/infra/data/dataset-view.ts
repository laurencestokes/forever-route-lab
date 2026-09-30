import type { ClassToken, Faction } from '../../domain/character';
import type {
  DatasetIdentity,
  DatasetView,
  EntityRef,
  ExtraObjective,
  ItemRecord,
  NpcRecord,
  ObjectiveDef,
  ObjectRecord,
  QuestRecord,
  SpawnPoint,
  ZoneInfo,
} from '../../domain/dataset';
import { type ItemId, itemId, type NpcId, npcId, type ObjectId, objectId, type QuestId, questId, type UiMapId, uiMapId } from '../../domain/ids';
import type { CustomQuest, QuestOverride } from '../../domain/project';
import { type MapGeometry, worldMapIdOf } from '../../geo';
import { publishedPoints, SpawnConverter, type DungeonTable } from './points';
import type { DatasetFiles, NpcPatch, ObjectPatch, ObjectiveRow, PointMap, QuestPatch, QuestRow, ZonesTable } from './rows';

/**
 * The synchronous `DatasetView` over the loaded files (ARCHITECTURE §5.2, §12.1; the interface is
 * in src/domain/dataset.ts). Two steps, both pure and deterministic:
 *
 * 1. `prepareDataset(files, identity, geometry)` does the expensive work once per load: quest rows
 *    become `QuestRecord`s (event and hint points turned into `PublishedPoint`s), every spawn is
 *    converted once to a `SpawnPoint` with its world point through `src/geo` and the geometry, and
 *    the overlay patches of both factions and every class are applied to their records.
 * 2. `createDatasetView(prepared, input)` is cheap (about a millisecond for 4,257 quests): it picks
 *    the persona's records (static → faction → class, DATA_PROVENANCE §6.7), lays the project's
 *    custom quests and quest overrides on top (ARCHITECTURE §5.5), and indexes the result.
 *    `createDatasetViewCache` memoises it on its inputs, as §12.1 asks.
 *
 * Iteration (`quests()`, `zones()`) is always in ascending id order, whatever the input order.
 */

export interface DatasetViewInput {
  readonly faction: Faction;
  readonly class: ClassToken;
  readonly customQuests: readonly CustomQuest[];
  /** Keyed by quest id as a decimal string (ProjectV1.questOverrides). */
  readonly questOverrides: Readonly<Record<string, QuestOverride>>;
}

/** Counts of the spawn conversion, for tests and the load report. */
export interface SpawnStats {
  /** Spawn rows converted (NPCs and objects, faction-invariant base). */
  readonly points: number;
  /** Zone points with a world position under the geometry. */
  readonly resolved: number;
  /** Zone points on a UiMap the geometry lacks (world null). */
  readonly zoneWithoutGeometry: number;
  /** `[-1, -1]` presence rows, and how many of them reached an entrance. */
  readonly presence: number;
  readonly presenceAtEntrance: number;
  readonly unmapped: { readonly suppressed: number; readonly 'instance-area': number; readonly 'no-uimap': number };
}

interface Layer {
  readonly quests: ReadonlyMap<QuestId, QuestRecord>;
  readonly npcs: ReadonlyMap<NpcId, NpcRecord>;
  readonly objects: ReadonlyMap<ObjectId, ObjectRecord>;
  readonly items: ReadonlyMap<ItemId, ItemRecord>;
  readonly npcSpawns: ReadonlyMap<NpcId, readonly SpawnPoint[]>;
  readonly objectSpawns: ReadonlyMap<ObjectId, readonly SpawnPoint[]>;
}

interface FactionPrepared extends Layer {
  /** Static → faction → class records, for the quests a class layer patches. */
  readonly classQuests: ReadonlyMap<string, ReadonlyMap<QuestId, QuestRecord>>;
}

export interface PreparedDataset {
  readonly identity: DatasetIdentity;
  readonly geometry: MapGeometry;
  /** Faction-invariant records and spawns. */
  readonly base: Layer;
  /** Quests ascending by id (the base records). */
  readonly questList: readonly QuestRecord[];
  /** Only the records a faction (and class) layer changes; everything else is `base`. */
  readonly factions: Readonly<Record<Faction, FactionPrepared>>;
  /** Ascending by UiMapId. */
  readonly zones: readonly ZoneInfo[];
  readonly zoneById: ReadonlyMap<UiMapId, ZoneInfo>;
  readonly spawnStats: SpawnStats;
  /**
   * `zones.json` and each faction's dungeon table (its whole-entry replacements laid on the
   * faction-invariant one), as loaded: the map's dungeon entrances read them (`datasetDungeons`,
   * map-presentation.md §8.2), converted only where they are drawn.
   */
  readonly dungeonTables: { readonly zones: ZonesTable; readonly byFaction: Readonly<Record<Faction, DungeonTable>> };
}

const EMPTY_SPAWNS: readonly SpawnPoint[] = [];
const FACTIONS: readonly Faction[] = ['Alliance', 'Horde'];

/** A decimal-keyed table's entries with numeric keys (integer keys iterate ascending). */
function entries<T>(table: Readonly<Record<string, T>>): [number, T][] {
  return Object.entries(table).map(([key, value]) => [Number(key), value]);
}

function questRecordOf(row: QuestRow, zones: ZonesTable): QuestRecord {
  const objective = (o: ObjectiveRow): ObjectiveDef => (o.kind === 'event' ? { kind: 'event', text: o.text, points: publishedPoints(o.points, zones) } : o);
  const hint = (h: QuestRow['objectiveHints'][number]): ExtraObjective => ({
    text: h.text,
    objectiveIndex: h.objectiveIndex,
    points: publishedPoints(h.points, zones),
    refs: h.refs,
  });
  return { ...row, objectives: row.objectives.map(objective), objectiveHints: row.objectiveHints.map(hint) };
}

const patchQuest = (row: QuestRow, patch: QuestPatch | undefined): QuestRow => (patch === undefined ? row : { ...row, ...patch });

function splitSpawns<P extends NpcPatch | ObjectPatch>(patch: P): { readonly fields: Omit<P, 'spawns'>; readonly spawns: PointMap | undefined } {
  const { spawns, ...fields } = patch;
  return { fields, spawns };
}

function statsOf(spawnLists: Iterable<readonly SpawnPoint[]>): SpawnStats {
  let points = 0;
  let resolved = 0;
  let zoneWithoutGeometry = 0;
  let presence = 0;
  let presenceAtEntrance = 0;
  const unmapped = { suppressed: 0, 'instance-area': 0, 'no-uimap': 0 };
  for (const list of spawnLists) {
    for (const spawn of list) {
      points += 1;
      const source = spawn.source;
      if ('space' in source) {
        if (spawn.world === null) zoneWithoutGeometry += 1;
        else resolved += 1;
      } else if (source.kind === 'instance') {
        presence += 1;
        if (spawn.world !== null) presenceAtEntrance += 1;
      } else unmapped[source.reason] += 1;
    }
  }
  return { points, resolved, zoneWithoutGeometry, presence, presenceAtEntrance, unmapped };
}

/** The zones a view lists: every UiMap `zones.json` names, plus every UiMap the geometry has. */
function zoneInfos(zones: ZonesTable, geometry: MapGeometry): readonly ZoneInfo[] {
  const ids = new Set<number>([...Object.keys(zones.uiMaps).map(Number), ...geometry.maps.keys()]);
  return [...ids]
    .sort((a, b) => a - b)
    .map((id): ZoneInfo => {
      const key = String(id);
      // A validated name comes only from zones.json (DATA_PROVENANCE §6.6); a UiMap that only the
      // geometry knows (1463, 1464, 2665 at the pin) has no validated name.
      const name = Object.hasOwn(zones.uiMaps, key) ? (zones.uiMaps[key]?.name ?? null) : null;
      return { uiMapId: uiMapId(id), name, worldMapId: worldMapIdOf(uiMapId(id), geometry) };
    });
}

/**
 * Converts and indexes the checked files once (step 1 above). `identity` comes from the manifest,
 * `geometry` from infra/maps (the committed placeholder, or it merged with a compatible local set).
 */
export function prepareDataset(files: DatasetFiles, identity: DatasetIdentity, geometry: MapGeometry): PreparedDataset {
  const { zones, overlays } = files;

  // Quests: base records, ascending (the files are checked to be ascending and unique).
  const questRows = new Map<QuestId, QuestRow>(files.quests.map((row) => [row.id, row]));
  const questList = files.quests.map((row) => questRecordOf(row, zones));
  const baseQuests = new Map<QuestId, QuestRecord>(questList.map((q) => [q.id, q]));

  const baseNpcs = new Map<NpcId, NpcRecord>(files.npcs.map((n) => [n.id, n]));
  const baseObjects = new Map<ObjectId, ObjectRecord>(files.objects.map((o) => [o.id, o]));
  const baseItems = new Map<ItemId, ItemRecord>(files.items.map((i) => [i.id, i]));

  // Spawns, converted once with the faction-invariant dungeon table. The three battleground
  // entries that differ by faction are absent from it, so their presence rows stay unresolved
  // here and are converted again per faction below.
  const factionDungeonIds = new Set<number>(FACTIONS.flatMap((f) => Object.keys(overlays.faction[f].dungeons).map(Number)));
  const baseConverter = new SpawnConverter(zones, zones.dungeons, geometry, factionDungeonIds);
  const npcSpawns = new Map<NpcId, readonly SpawnPoint[]>();
  const objectSpawns = new Map<ObjectId, readonly SpawnPoint[]>();
  const sensitiveNpcs: [NpcId, PointMap][] = [];
  const sensitiveObjects: [ObjectId, PointMap][] = [];
  for (const [id, points] of entries(files.spawns.npc)) {
    npcSpawns.set(npcId(id), baseConverter.spawns(points));
    if (baseConverter.dependsOnFaction(points)) sensitiveNpcs.push([npcId(id), points]);
  }
  for (const [id, points] of entries(files.spawns.object)) {
    objectSpawns.set(objectId(id), baseConverter.spawns(points));
    if (baseConverter.dependsOnFaction(points)) sensitiveObjects.push([objectId(id), points]);
  }

  const prepareFaction = (faction: Faction): FactionPrepared => {
    const layer = overlays.faction[faction];
    const dungeons: DungeonTable = { ...zones.dungeons, ...layer.dungeons };
    const converter = new SpawnConverter(zones, dungeons, geometry, factionDungeonIds);

    const factionRows = new Map<QuestId, QuestRow>();
    const quests = new Map<QuestId, QuestRecord>();
    for (const [id, patch] of entries(layer.quests)) {
      const row = questRows.get(questId(id));
      if (row === undefined) continue; // a patch for a quest that is not shipped (none at the pin)
      const patched = patchQuest(row, patch);
      factionRows.set(row.id, patched);
      quests.set(row.id, questRecordOf(patched, zones));
    }

    const classQuests = new Map<string, ReadonlyMap<QuestId, QuestRecord>>();
    for (const [token, classLayer] of Object.entries(overlays.class[faction])) {
      if (classLayer === undefined) continue;
      const byId = new Map<QuestId, QuestRecord>();
      for (const [id, patch] of entries(classLayer.quests)) {
        const row = factionRows.get(questId(id)) ?? questRows.get(questId(id));
        if (row !== undefined) byId.set(row.id, questRecordOf(patchQuest(row, patch), zones));
      }
      classQuests.set(token, byId);
    }

    const npcs = new Map<NpcId, NpcRecord>();
    const factionNpcSpawns = new Map<NpcId, readonly SpawnPoint[]>();
    for (const [id, points] of sensitiveNpcs) factionNpcSpawns.set(id, converter.spawns(points));
    for (const [id, patch] of entries(layer.npcs)) {
      const base = baseNpcs.get(npcId(id));
      if (base === undefined) continue;
      const { fields, spawns } = splitSpawns(patch);
      npcs.set(base.id, { ...base, ...fields });
      if (spawns !== undefined) factionNpcSpawns.set(base.id, converter.spawns(spawns));
    }

    const objects = new Map<ObjectId, ObjectRecord>();
    const factionObjectSpawns = new Map<ObjectId, readonly SpawnPoint[]>();
    for (const [id, points] of sensitiveObjects) factionObjectSpawns.set(id, converter.spawns(points));
    for (const [id, patch] of entries(layer.objects)) {
      const base = baseObjects.get(objectId(id));
      if (base === undefined) continue;
      const { fields, spawns } = splitSpawns(patch);
      objects.set(base.id, { ...base, ...fields });
      if (spawns !== undefined) factionObjectSpawns.set(base.id, converter.spawns(spawns));
    }

    const items = new Map<ItemId, ItemRecord>();
    for (const [id, patch] of entries(layer.items)) {
      const base = baseItems.get(itemId(id));
      if (base !== undefined) items.set(base.id, { ...base, ...patch });
    }

    return { quests, classQuests, npcs, objects, items, npcSpawns: factionNpcSpawns, objectSpawns: factionObjectSpawns };
  };
  const factions: Readonly<Record<Faction, FactionPrepared>> = { Alliance: prepareFaction('Alliance'), Horde: prepareFaction('Horde') };

  const zoneList = zoneInfos(zones, geometry);
  return {
    identity,
    geometry,
    base: { quests: baseQuests, npcs: baseNpcs, objects: baseObjects, items: baseItems, npcSpawns, objectSpawns },
    questList,
    factions,
    zones: zoneList,
    zoneById: new Map(zoneList.map((z) => [z.uiMapId, z])),
    spawnStats: statsOf([...npcSpawns.values(), ...objectSpawns.values()]),
    dungeonTables: {
      zones,
      byFaction: { Alliance: { ...zones.dungeons, ...overlays.faction.Alliance.dungeons }, Horde: { ...zones.dungeons, ...overlays.faction.Horde.dungeons } },
    },
  };
}

// View ------------------------------------------------------------------------------------------

/** A custom quest as a dataset record: the same fields without its own location slots. */
function customQuestRecord(quest: CustomQuest): QuestRecord {
  const { starterLocation: _starter, finisherLocation: _finisher, ...record } = quest;
  return record;
}

/**
 * A quest with the project's override applied (ARCHITECTURE §5.5): a user XP value, objective
 * counts (an objective without a count slot, or a null entry, keeps its own), and a declared
 * Forever status. Null fields leave the record's value alone.
 */
export function applyQuestOverride(quest: QuestRecord, override: QuestOverride): QuestRecord {
  let result = quest;
  if (override.xp !== null) result = { ...result, xp: override.xp };
  const counts = override.objectiveCounts;
  if (counts !== null) {
    const objectives = result.objectives.map((objective, i): ObjectiveDef => {
      const count = counts[i];
      if (count === undefined || count === null || !('count' in objective)) return objective;
      return { ...objective, count };
    });
    if (objectives.some((o, i) => o !== result.objectives[i])) result = { ...result, objectives };
  }
  if (override.foreverStatus !== null) result = { ...result, provenance: { ...result.provenance, foreverStatus: override.foreverStatus } };
  return result;
}

function overrideFor(overrides: Readonly<Record<string, QuestOverride>>, id: QuestId): QuestOverride | undefined {
  const key = String(id);
  return Object.hasOwn(overrides, key) ? overrides[key] : undefined;
}

/** The view for one persona and project (step 2 above). */
export function createDatasetView(prepared: PreparedDataset, input: DatasetViewInput): DatasetView {
  const layer = prepared.factions[input.faction];
  const classLayer = layer.classQuests.get(input.class);
  // A custom quest replaces the dataset quest with its id (ARCHITECTURE §5.5); if a project lists
  // one id twice, the later entry wins, as it would in a Map built from the list.
  const custom = new Map<QuestId, QuestRecord>(input.customQuests.map((q) => [q.id, customQuestRecord(q)]));
  const effective = (base: QuestRecord): QuestRecord => {
    const chosen = custom.get(base.id) ?? classLayer?.get(base.id) ?? layer.quests.get(base.id) ?? base;
    const override = overrideFor(input.questOverrides, base.id);
    return override === undefined ? chosen : applyQuestOverride(chosen, override);
  };
  const list: QuestRecord[] = prepared.questList.map(effective);
  const extra = [...custom.values()].filter((q) => !prepared.base.quests.has(q.id)).map(effective);
  if (extra.length > 0) {
    list.push(...extra);
    list.sort((a, b) => a.id - b.id);
  }
  const quests = new Map<QuestId, QuestRecord>(list.map((q) => [q.id, q]));
  const { base } = prepared;

  return {
    identity: prepared.identity,
    quest: (id) => quests.get(id),
    npc: (id) => layer.npcs.get(id) ?? base.npcs.get(id),
    object: (id) => layer.objects.get(id) ?? base.objects.get(id),
    item: (id) => layer.items.get(id) ?? base.items.get(id),
    quests: () => list,
    spawns(ref: EntityRef) {
      switch (ref.kind) {
        case 'npc':
          return layer.npcSpawns.get(ref.id) ?? base.npcSpawns.get(ref.id) ?? EMPTY_SPAWNS;
        case 'object':
          return layer.objectSpawns.get(ref.id) ?? base.objectSpawns.get(ref.id) ?? EMPTY_SPAWNS;
        case 'item':
          return EMPTY_SPAWNS;
      }
    },
    zone: (id) => prepared.zoneById.get(id),
    zones: () => prepared.zones,
  };
}

const sameInput = (a: DatasetViewInput, b: DatasetViewInput): boolean =>
  a.faction === b.faction && a.class === b.class && a.customQuests === b.customQuests && a.questOverrides === b.questOverrides;

/**
 * `createDatasetView` memoised on its inputs (by identity for the custom quests and overrides,
 * which the store keeps while they are unchanged): the same inputs return the same view object.
 */
export function createDatasetViewCache(prepared: PreparedDataset): (input: DatasetViewInput) => DatasetView {
  let last: { readonly input: DatasetViewInput; readonly view: DatasetView } | null = null;
  return (input) => {
    if (last !== null && sameInput(last.input, input)) return last.view;
    const view = createDatasetView(prepared, input);
    last = { input, view };
    return view;
  };
}
