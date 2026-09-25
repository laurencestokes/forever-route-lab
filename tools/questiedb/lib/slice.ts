import type { Dataset, OverlaysBody } from './dataset';
import { FACTIONS } from './overlays';
import { isInstanceSentinel, pointsOf } from './points';
import { questEntityRefs, hasFlag } from './select';
import type { ClassLayer, DungeonRow, EntityRefRow, FactionLayer, ItemRow, NpcRow, ObjectRow, PointMap, QuestPatch, QuestRow } from './shapes';

/**
 * The test fixture slice (ARCHITECTURE §15; DATA_PROVENANCE §7): the same file formats restricted
 * to one region, cut from the full dataset so it is consistent with it by construction.
 *
 * Rule: the quests whose starters or finishers (NPCs or objects) have a spawn point in an AreaId
 * that links to the region's UiMap directly or as a routed subzone, then everything they reference (the closure the full
 * selection uses: refs, containers, drop sources), the NPCs and objects whose questStarts/questEnds
 * name a sliced quest, the items that start a sliced quest, and the flight masters, innkeepers and
 * trainers that spawn in the region. Entities keep their full records and spawns; their
 * questStarts/questEnds may name quests outside the slice.
 */

export interface SliceRegion {
  readonly uiMapId: number;
  readonly label: string;
}

/** Durotar (UiMap 1411) and its subzones, Valley of Trials included. */
export const FIXTURE_REGION: SliceRegion = { uiMapId: 1411, label: 'Durotar (UiMap 1411) and its subzones, including the Valley of Trials' };

export interface SliceResult {
  readonly dataset: Dataset;
  readonly regionAreas: readonly number[];
  readonly description: string;
}

const inRegion = (map: PointMap | undefined, areas: ReadonlySet<number>): boolean => {
  if (map === undefined) return false;
  for (const [area, row] of pointsOf(map)) if (areas.has(area) && !isInstanceSentinel(row)) return true;
  return false;
};

export function sliceDataset(full: Dataset, region: SliceRegion, flagValues: { readonly flightMaster: number; readonly trainer: number; readonly innkeeper: number }): SliceResult {
  const regionAreas = new Set([...full.zones.areas].filter(([, row]) => (row.link === 'direct' || row.link === 'routed') && row.uiMapId === region.uiMapId).map(([id]) => id));
  const npcById = new Map(full.npcs.map((npc) => [npc.id, npc]));
  const objectById = new Map(full.objects.map((object) => [object.id, object]));
  const itemById = new Map(full.items.map((item) => [item.id, item]));

  const quests = full.quests.filter((quest) =>
    [...quest.starters, ...quest.finishers].some((ref) => (ref.kind === 'npc' ? inRegion(full.spawns.npc.get(ref.id), regionAreas) : ref.kind === 'object' ? inRegion(full.spawns.object.get(ref.id), regionAreas) : false)),
  );
  const questIds = new Set(quests.map((quest) => quest.id));

  // Quest variants from the overlays: their references must resolve too.
  const patches: QuestPatch[] = [];
  for (const faction of FACTIONS) {
    for (const [id, patch] of Object.entries(full.overlays.faction[faction].quests)) if (questIds.has(Number(id))) patches.push(patch);
    for (const layer of Object.values(full.overlays.class[faction])) for (const [id, patch] of Object.entries(layer.quests)) if (questIds.has(Number(id))) patches.push(patch);
  }
  const refs: EntityRefRow[] = [];
  for (const quest of quests) refs.push(...questEntityRefs(quest));
  for (const patch of patches) {
    refs.push(
      ...questEntityRefs({
        starters: patch.starters ?? [],
        finishers: patch.finishers ?? [],
        objectives: patch.objectives ?? [],
        objectiveHints: patch.objectiveHints ?? [],
        requirements: patch.requirements ?? { skill: null, minReputation: null, maxReputation: null, spell: null, specialization: null, sourceItemId: null, requiredSourceItems: [] },
      }),
    );
  }
  const npcs = new Set<number>();
  const objects = new Set<number>();
  const items = new Set<number>();
  const add = (ref: EntityRefRow): void => {
    const set = ref.kind === 'npc' ? npcs : ref.kind === 'object' ? objects : items;
    const known = ref.kind === 'npc' ? npcById : ref.kind === 'object' ? objectById : itemById;
    if (known.has(ref.id)) set.add(ref.id);
  };
  for (const ref of refs) add(ref);
  for (const item of full.items) if (item.startsQuest !== null && questIds.has(item.startsQuest)) items.add(item.id);
  const queue = [...items];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined) break;
    for (const container of itemById.get(id)?.dropItems ?? []) {
      if (itemById.has(container) && !items.has(container)) {
        items.add(container);
        queue.push(container);
      }
    }
  }
  for (const id of items) {
    const item = itemById.get(id);
    for (const npc of item?.dropNpcs ?? []) add({ kind: 'npc', id: npc });
    for (const object of item?.dropObjects ?? []) add({ kind: 'object', id: object });
  }
  const namesSliced = (row: { readonly questStarts: readonly number[]; readonly questEnds: readonly number[] }): boolean =>
    row.questStarts.some((id) => questIds.has(id)) || row.questEnds.some((id) => questIds.has(id));
  for (const npc of full.npcs) {
    if (namesSliced(npc)) npcs.add(npc.id);
    const flagged = hasFlag(npc.npcFlags, flagValues.flightMaster) || hasFlag(npc.npcFlags, flagValues.trainer) || hasFlag(npc.npcFlags, flagValues.innkeeper);
    if (flagged && inRegion(full.spawns.npc.get(npc.id), regionAreas)) npcs.add(npc.id);
  }
  for (const object of full.objects) if (namesSliced(object)) objects.add(object.id);

  const pick = <T extends { readonly id: number }>(rows: readonly T[], keep: ReadonlySet<number>): readonly T[] => rows.filter((row) => keep.has(row.id));
  const spawns = {
    npc: new Map([...full.spawns.npc].filter(([id]) => npcs.has(id))),
    object: new Map([...full.spawns.object].filter(([id]) => objects.has(id))),
  };
  const keepRecord = <T>(record: Readonly<Record<string, T>>, keep: ReadonlySet<number>): Readonly<Record<string, T>> =>
    Object.fromEntries(Object.entries(record).filter(([id]) => keep.has(Number(id))));
  const slicedQuests = pick<QuestRow>(full.quests, questIds);

  // Points used by the slice decide which areas, instance areas and dungeons it needs.
  const usedAreas = new Set(regionAreas);
  const presence = new Set<number>();
  const note = (map: PointMap): void => {
    for (const [area, row] of pointsOf(map)) {
      usedAreas.add(area);
      if (isInstanceSentinel(row)) presence.add(area);
    }
  };
  for (const map of [...spawns.npc.values(), ...spawns.object.values()]) note(map);
  for (const quest of slicedQuests) {
    for (const objective of quest.objectives) if (objective.kind === 'event') note(objective.points);
    for (const hint of quest.objectiveHints) note(hint.points);
  }
  for (const faction of FACTIONS) {
    const layer = full.overlays.faction[faction];
    for (const patch of [...Object.values(keepRecord(layer.npcs, npcs)), ...Object.values(keepRecord(layer.objects, objects))]) {
      if (patch.spawns !== undefined) note(patch.spawns);
    }
  }
  const overlayLayer = (layer: FactionLayer, dungeonsKept: ReadonlySet<number>): FactionLayer => ({
    quests: keepRecord(layer.quests, questIds),
    npcs: keepRecord(layer.npcs, npcs),
    objects: keepRecord(layer.objects, objects),
    items: keepRecord(layer.items, items),
    dungeons: keepRecord(layer.dungeons, dungeonsKept),
  });
  const instanceAreas = new Map([...full.zones.instanceAreas].filter(([area]) => presence.has(area)));
  const dungeonsKept = new Set<number>();
  for (const row of instanceAreas.values()) if (row.dungeonAreaId !== null) dungeonsKept.add(row.dungeonAreaId);
  // Faction-dependent dungeon entries (battlegrounds) are kept when the slice's points name them.
  for (const faction of FACTIONS) for (const id of Object.keys(full.overlays.faction[faction].dungeons)) if (presence.has(Number(id))) dungeonsKept.add(Number(id));
  const overlays: OverlaysBody = {
    faction: { Alliance: overlayLayer(full.overlays.faction.Alliance, dungeonsKept), Horde: overlayLayer(full.overlays.faction.Horde, dungeonsKept) },
    class: {
      Alliance: Object.fromEntries(Object.entries(full.overlays.class.Alliance).map(([token, layer]): [string, ClassLayer] => [token, { quests: keepRecord(layer.quests, questIds) }])),
      Horde: Object.fromEntries(Object.entries(full.overlays.class.Horde).map(([token, layer]): [string, ClassLayer] => [token, { quests: keepRecord(layer.quests, questIds) }])),
    },
  };
  const dungeons = new Map<number, DungeonRow>([...full.zones.dungeons].filter(([id]) => dungeonsKept.has(id)));
  const entranceAreas = (row: DungeonRow): void => {
    for (const entrance of row.entrances) usedAreas.add(entrance.areaId);
  };
  for (const row of dungeons.values()) entranceAreas(row);
  for (const faction of FACTIONS) for (const row of Object.values(overlays.faction[faction].dungeons)) entranceAreas(row);
  const areas = new Map([...full.zones.areas].filter(([id]) => usedAreas.has(id)));
  const usedUiMaps = new Set([...areas.values()].map((row) => row.uiMapId));
  const uiMaps = new Map([...full.zones.uiMaps].filter(([id]) => usedUiMaps.has(id)));

  const dataset: Dataset = {
    quests: slicedQuests,
    npcs: pick<NpcRow>(full.npcs, npcs),
    objects: pick<ObjectRow>(full.objects, objects),
    items: pick<ItemRow>(full.items, items),
    spawns,
    zones: { areas, uiMaps, dungeons, instanceAreas },
    overlays,
    detail: full.detail,
  };
  const description = [
    `Region: ${region.label}; AreaIds ${[...regionAreas].sort((a, b) => a - b).join(', ')}.`,
    'Quests: those whose starters or finishers (NPCs or objects) have a spawn point in the region.',
    'Entities: everything those quests reference (starters, finishers, objective targets, hint',
    'references, source items, item containers and drop sources, also under the faction and class',
    'overlays), the NPCs and objects whose questStarts/questEnds name a sliced quest, the items that',
    'start one, and the flight masters, innkeepers and trainers that spawn in the region. Records and',
    'spawns are complete; questStarts/questEnds may name quests outside the slice. zones.json keeps',
    'only the areas, UiMaps, instance areas and dungeons the slice uses.',
  ].join('\n');
  return { dataset, regionAreas: [...regionAreas].sort((a, b) => a - b), description };
}
