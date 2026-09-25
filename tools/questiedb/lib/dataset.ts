import { performance } from 'node:perf_hooks';
import { beforeDerived, type Composition, KIND_OF, type PerKind } from './compose';
import type { EntityKind } from './entities';
import { dungeonQuestAreas } from './dungeon-areas';
import { compact } from './json';
import { LuaTable, ShapeError } from './lua-value';
import { type Faction, FACTIONS, CLASS_TOKENS, evaluateDynamicLayers, personaRow, topLevelPatch, touchedIds } from './overlays';
import { isInstanceSentinel, pointsOf } from './points';
import { projectItem, projectNpc, projectObject, projectQuest, type QuestContext, type Unprovenanced } from './project';
import { classifyRow, type Coefficients, type UpstreamDiff } from './provenance';
import type { QuestXpRow } from './questxp';
import type { Datatype, HintSet } from './sandbox';
import { hasFlag, type Selection, selectEntities } from './select';
import type {
  AreaRow,
  ClassLayer,
  DungeonRow,
  FactionLayer,
  InstanceAreaRow,
  ItemPatch,
  ItemRow,
  NpcPatch,
  NpcRow,
  ObjectPatch,
  ObjectRow,
  PointMap,
  QuestPatch,
  QuestRow,
  UiMapRow,
} from './shapes';
import type { ZoneTables } from './zones';

/**
 * The shipped dataset in memory (DATA_PROVENANCE §6): records, spawns, zones and overlays, plus
 * the counts and review detail the manifest and the report need. Everything is ordered by id.
 */

const DATATYPE_OF: Readonly<Record<EntityKind, Datatype>> = { quest: 'Quest', npc: 'Npc', object: 'Object', item: 'Item' };

/** npcFlags values (powers of two) that select an NPC on their own (Era `byExpansion.Classic.npcFlags`). */
export interface NpcFlagValues {
  readonly flightMaster: number;
  readonly trainer: number;
  readonly innkeeper: number;
}

export interface DatasetInput {
  readonly forever: Composition;
  readonly era: Composition;
  readonly zones: ZoneTables;
  readonly xp: ReadonlyMap<number, QuestXpRow>;
  readonly coefficients: ReadonlyMap<number, Coefficients>;
}

export interface SpawnSet {
  readonly npc: ReadonlyMap<number, PointMap>;
  readonly object: ReadonlyMap<number, PointMap>;
}

export interface ZonesBody {
  readonly areas: ReadonlyMap<number, AreaRow>;
  readonly uiMaps: ReadonlyMap<number, UiMapRow>;
  readonly dungeons: ReadonlyMap<number, DungeonRow>;
  readonly instanceAreas: ReadonlyMap<number, InstanceAreaRow>;
}

export interface OverlaysBody {
  readonly faction: Readonly<Record<Faction, FactionLayer>>;
  readonly class: Readonly<Record<Faction, Readonly<Record<string, ClassLayer>>>>;
}

export interface Dataset {
  readonly quests: readonly QuestRow[];
  readonly npcs: readonly NpcRow[];
  readonly objects: readonly ObjectRow[];
  readonly items: readonly ItemRow[];
  readonly spawns: SpawnSet;
  readonly zones: ZonesBody;
  readonly overlays: OverlaysBody;
  readonly detail: DatasetDetail;
}

export interface DatasetDetail {
  readonly selection: Selection;
  readonly upstreamDiff: PerKind<Readonly<Record<UpstreamDiff, number>>>;
  readonly convertedPairs: PerKind<number>;
  /** Ids whose tag comes from a persona layer that differs from the fork base's (static rows equal). */
  readonly upstreamDiffFromDynamic: PerKind<ReadonlySet<number>>;
  readonly corrected: PerKind<number>;
  readonly createdShipped: PerKind<number>;
  readonly dungeonQuestAreas: readonly number[];
  /** Shipped items whose startsQuest was last written by itemStartFixes (ascending ids). */
  readonly itemStartFixesOnly: readonly number[];
  /** The checked npcFlags values the selection (and the fixture slice) use. */
  readonly flagValues: NpcFlagValues;
  readonly overlayEntries: Readonly<Record<string, number>>;
  readonly droppedOverlayIds: readonly string[];
  readonly coverage: Readonly<Record<string, number>>;
  readonly timingsMs: Readonly<Record<string, number>>;
}

type Provenanced<T> = T & { readonly provenance: QuestRow['provenance'] };

function provenance(tag: UpstreamDiff, corrected: boolean, created: boolean): QuestRow['provenance'] {
  return { upstreamDiff: tag, foreverStatus: 'unknown', corrected, created, source: 'questiedb' };
}

const same = (a: unknown, b: unknown): boolean => compact(a) === compact(b);

export function buildDataset(input: DatasetInput): Dataset {
  const { forever, era, zones } = input;
  const timings: Record<string, number> = {};
  const time = <T>(label: string, fn: () => T): T => {
    const start = performance.now();
    try {
      return fn();
    } finally {
      timings[label] = Math.round((performance.now() - start) * 10) / 10;
    }
  };

  // dungeonQuest: the dungeon keys of dungeons.lua (either faction) and their alternative ids; an
  // unclassified key fails closed (lib/dungeon-areas.ts).
  const dungeonAreas = dungeonQuestAreas([...zones.dungeonsByFaction.Alliance.values(), ...zones.dungeonsByFaction.Horde.values()]);
  const hints = forever.corrections.hints;
  const hinted = (set: HintSet, questId: number): boolean => (hints.get(set) ?? []).includes(questId);
  const questContext: QuestContext = { hinted, xp: input.xp, dungeonAreas };

  const project = {
    quest: (id: number, row: LuaTable) => ({ record: projectQuest(id, row, questContext), spawns: null }),
    npc: projectNpc,
    object: projectObject,
    item: (id: number, row: LuaTable) => ({ record: projectItem(id, row), spawns: null }),
  } as const;
  type Projected = { readonly record: { readonly id: number }; readonly spawns: PointMap | null };
  const projectAny = (kind: EntityKind, id: number, row: LuaTable): Projected => project[kind](id, row);

  // Persona layers of both flavours (Forever ships them; the fork base's are compared for upstreamDiff).
  const layers = time('dynamic layers', () => evaluateDynamicLayers(forever));
  const eraLayers = time('dynamic layers (fork base)', () => evaluateDynamicLayers(era));
  const RANK: Readonly<Record<UpstreamDiff, number>> = { era: 0, 'era-coords': 1, 'forever-changed': 2, 'forever-new': 3 };

  // Static records of every composed entity, with provenance.
  const upstreamDiff = {} as Record<EntityKind, Record<UpstreamDiff, number>>;
  const convertedPairs = {} as Record<EntityKind, number>;
  const dynamicOnly = {} as Record<EntityKind, ReadonlySet<number>>;
  const correctedCount = {} as Record<EntityKind, number>;
  const records = {} as Record<EntityKind, Map<number, Provenanced<{ readonly id: number }>>>;
  const staticSpawns = { npc: new Map<number, PointMap>(), object: new Map<number, PointMap>() };
  time('project + provenance', () => {
    for (const kind of ['quest', 'npc', 'object', 'item'] as const) {
      const datatype = DATATYPE_OF[kind];
      const tags: Record<UpstreamDiff, number> = { era: 0, 'era-coords': 0, 'forever-new': 0, 'forever-changed': 0 };
      const touched = new Set<number>();
      for (const faction of FACTIONS) {
        for (const id of touchedIds(layers, datatype, faction)) touched.add(id);
        for (const id of touchedIds(eraLayers, datatype, faction)) touched.add(id);
      }
      let converted = 0;
      const fromDynamic = new Set<number>();
      let corrected = 0;
      const out = new Map<number, Provenanced<{ readonly id: number }>>();
      for (const id of [...forever.composed[kind].keys()].sort((a, b) => a - b)) {
        const row = forever.composed[kind].get(id);
        if (row === undefined) continue;
        const projected = projectAny(kind, id, row);
        const eraRow = era.composed[kind].get(id);
        const diff = classifyRow(kind, row, eraRow, input.coefficients);
        let tag = diff.tag;
        let raisedByDynamic = false;
        converted += diff.convertedPairs;
        // A record whose persona layers differ from the fork base's is tagged by the worst case.
        if (touched.has(id) && eraRow !== undefined) {
          for (const faction of FACTIONS) {
            for (const classFile of kind === 'quest' ? CLASS_TOKENS : [null]) {
              const persona = classifyRow(
                kind,
                personaRow(forever, layers, kind, datatype, id, faction, classFile),
                personaRow(era, eraLayers, kind, datatype, id, faction, classFile),
                input.coefficients,
              );
              if (RANK[persona.tag] > RANK[tag]) {
                tag = persona.tag;
                raisedByDynamic = true;
              }
            }
          }
        }
        tags[tag] += 1;
        if (raisedByDynamic) fromDynamic.add(id);
        const created = forever.created[kind].has(id);
        let isCorrected = created;
        if (!created && forever.writes[kind].has(id)) {
          const rawRow = forever.raw[kind].get(id);
          const staticRow = kind === 'quest' ? beforeDerived(forever, id) : row;
          if (rawRow === undefined || staticRow === undefined) throw new ShapeError('provenance', `${kind} ${String(id)} lost its raw row`);
          isCorrected = !same(projectAny(kind, id, rawRow), projectAny(kind, id, staticRow));
        }
        if (isCorrected) corrected += 1;
        out.set(id, { ...projected.record, provenance: provenance(tag, isCorrected, created) });
        if (projected.spawns !== null && (kind === 'npc' || kind === 'object')) staticSpawns[kind].set(id, projected.spawns);
      }
      upstreamDiff[kind] = tags;
      convertedPairs[kind] = converted;
      dynamicOnly[kind] = fromDynamic;
      correctedCount[kind] = corrected;
      records[kind] = out;
    }
  });

  // Persona patches: faction, then class within the faction.
  const variants = { quest: new Map<number, unknown[]>(), npc: new Map<number, unknown[]>(), object: new Map<number, unknown[]>(), item: new Map<number, unknown[]>() };
  const factionPatches = new Map<Faction, Record<EntityKind, Map<number, Record<string, unknown>>>>();
  const classPatches = new Map<Faction, Map<string, Map<number, Record<string, unknown>>>>();
  // NPC and object patches may replace the entity's spawns (spawns.json shape) as well.
  const withSpawns = (kind: EntityKind, projected: Projected): Record<string, unknown> =>
    kind === 'npc' || kind === 'object' ? { ...projected.record, spawns: projected.spawns ?? {} } : { ...projected.record };
  time('overlay patches', () => {
    for (const faction of FACTIONS) {
      const perKind = { quest: new Map(), npc: new Map(), object: new Map(), item: new Map() } as Record<EntityKind, Map<number, Record<string, unknown>>>;
      const perClass = new Map<string, Map<number, Record<string, unknown>>>(CLASS_TOKENS.map((token) => [token, new Map()]));
      for (const datatype of ['Quest', 'Npc', 'Object', 'Item'] as const satisfies readonly Datatype[]) {
        const kind = KIND_OF[datatype];
        for (const id of touchedIds(layers, datatype, faction)) {
          const base = forever.composed[kind].get(id);
          if (base === undefined) continue;
          const staticView = withSpawns(kind, projectAny(kind, id, base));
          const factionProjected = projectAny(kind, id, personaRow(forever, layers, kind, datatype, id, faction, null));
          const factionView = withSpawns(kind, factionProjected);
          (variants[kind].get(id) ?? variants[kind].set(id, []).get(id))?.push(factionProjected.record);
          const patch = topLevelPatch(staticView, factionView);
          if (Object.keys(patch).length > 0) perKind[kind].set(id, patch);
          if (kind !== 'quest') {
            for (const classFile of CLASS_TOKENS) {
              if (layers.class.get(faction)?.get(classFile)?.get(datatype)?.has(id) === true) {
                throw new ShapeError('overlays', `${kind} ${String(id)} varies by class; only quests have a class layer`);
              }
            }
            continue;
          }
          for (const classFile of CLASS_TOKENS) {
            if (layers.class.get(faction)?.get(classFile)?.get(datatype)?.has(id) !== true) continue;
            const classProjected = projectAny(kind, id, personaRow(forever, layers, kind, datatype, id, faction, classFile));
            variants.quest.get(id)?.push(classProjected.record);
            const classPatch = topLevelPatch(factionView, withSpawns(kind, classProjected));
            if (Object.keys(classPatch).length > 0) perClass.get(classFile)?.set(id, classPatch);
          }
        }
      }
      factionPatches.set(faction, perKind);
      classPatches.set(faction, perClass);
    }
  });

  // Selection over static records and every persona variant.
  const variantsOf = <T>(kind: EntityKind): Map<number, readonly T[]> =>
    new Map([...records[kind]].map(([id, record]) => [id, [record, ...(variants[kind].get(id) ?? [])] as unknown as readonly T[]]));
  const flag = (name: string): number => {
    const byExpansion = forever.constants.get('byExpansion');
    const scoped = byExpansion instanceof LuaTable ? byExpansion.get(forever.flavour.rules) : null;
    const flags = scoped instanceof LuaTable ? scoped.get('npcFlags') : null;
    const value = flags instanceof LuaTable ? flags.get(name) : null;
    if (typeof value !== 'number') throw new ShapeError('enum/expansions.lua', `npcFlags.${name} is missing`);
    return value;
  };
  const flagValues: NpcFlagValues = { flightMaster: flag('FLIGHT_MASTER'), trainer: flag('TRAINER'), innkeeper: flag('INNKEEPER') };
  const selection = time('selection', () =>
    selectEntities({
      quests: [...records.quest.values(), ...[...variants.quest.values()].flat()] as unknown as readonly QuestRow[],
      npcs: variantsOf<NpcRow>('npc'),
      objects: variantsOf<ObjectRow>('object'),
      items: variantsOf<ItemRow>('item'),
      flagValues,
    }),
  );
  // Referential integrity of quest ids named by entities (questStarts/questEnds/startsQuest).
  const questIds = new Set(records.quest.keys());
  const quests = [...records.quest.values()] as unknown as QuestRow[];
  const npcs = [...records.npc.values()].filter((npc) => selection.npcs.has(npc.id)) as unknown as NpcRow[];
  const objects = [...records.object.values()].filter((object) => selection.objects.has(object.id)) as unknown as ObjectRow[];
  const items = [...records.item.values()].filter((item) => selection.items.has(item.id)) as unknown as ItemRow[];
  const spawns: SpawnSet = {
    npc: new Map([...staticSpawns.npc].filter(([id]) => selection.npcs.has(id))),
    object: new Map([...staticSpawns.object].filter(([id]) => selection.objects.has(id))),
  };

  // Overlays restricted to shipped entities.
  const shipped: Record<EntityKind, ReadonlySet<number>> = { quest: questIds, npc: selection.npcs, object: selection.objects, item: selection.items };
  const droppedOverlayIds: string[] = [];
  const restrict = <T>(faction: Faction, kind: EntityKind): Readonly<Record<string, T>> => {
    const out: Record<string, T> = {};
    for (const [id, patch] of [...(factionPatches.get(faction)?.[kind] ?? new Map<number, Record<string, unknown>>())].sort((a, b) => a[0] - b[0])) {
      if (!shipped[kind].has(id)) {
        droppedOverlayIds.push(`${faction}:${kind}:${String(id)}`);
        continue;
      }
      out[String(id)] = patch as T;
    }
    return out;
  };
  const dungeonsOf = (faction: Faction): Readonly<Record<string, DungeonRow>> => {
    const out: Record<string, DungeonRow> = {};
    for (const [id, entry] of zones.dungeonsByFaction[faction]) {
      const other = zones.dungeonsByFaction[faction === 'Alliance' ? 'Horde' : 'Alliance'].get(id);
      if (other === undefined || !same(entry, other)) out[String(id)] = dungeonRow(entry);
    }
    return out;
  };
  const factionLayer = (faction: Faction): FactionLayer => ({
    quests: restrict<QuestPatch>(faction, 'quest'),
    npcs: restrict<NpcPatch>(faction, 'npc'),
    objects: restrict<ObjectPatch>(faction, 'object'),
    items: restrict<ItemPatch>(faction, 'item'),
    dungeons: dungeonsOf(faction),
  });
  const classLayer = (faction: Faction): Readonly<Record<string, ClassLayer>> => {
    const out: Record<string, ClassLayer> = {};
    for (const token of CLASS_TOKENS) {
      const questsOut: Record<string, QuestPatch> = {};
      for (const [id, patch] of [...(classPatches.get(faction)?.get(token) ?? new Map<number, Record<string, unknown>>())].sort((a, b) => a[0] - b[0])) questsOut[String(id)] = patch;
      out[token] = { quests: questsOut };
    }
    return out;
  };
  const overlays: OverlaysBody = {
    faction: { Alliance: factionLayer('Alliance'), Horde: factionLayer('Horde') },
    class: { Alliance: classLayer('Alliance'), Horde: classLayer('Horde') },
  };

  // Zones: faction-invariant dungeons, and the presence keys actually used.
  const invariantDungeons = new Map<number, DungeonRow>();
  for (const [id, entry] of zones.dungeonsByFaction.Alliance) {
    const other = zones.dungeonsByFaction.Horde.get(id);
    if (other !== undefined && same(entry, other)) invariantDungeons.set(id, dungeonRow(entry));
  }
  const presenceAreas = new Set<number>();
  const collect = (map: PointMap): void => {
    for (const [area, row] of pointsOf(map)) if (isInstanceSentinel(row)) presenceAreas.add(area);
  };
  for (const map of [...spawns.npc.values(), ...spawns.object.values()]) collect(map);
  for (const quest of quests) {
    for (const objective of quest.objectives) if (objective.kind === 'event') collect(objective.points);
    for (const hint of quest.objectiveHints) collect(hint.points);
  }
  for (const faction of FACTIONS) {
    const patches: readonly (NpcPatch | ObjectPatch)[] = [...Object.values(overlays.faction[faction].npcs), ...Object.values(overlays.faction[faction].objects)];
    for (const patch of patches) if (patch.spawns !== undefined) collect(patch.spawns);
  }
  const alternativeOf = new Map<number, number[]>();
  for (const dungeons of [zones.dungeonsByFaction.Alliance, zones.dungeonsByFaction.Horde]) {
    for (const entry of dungeons.values()) {
      for (const alt of entry.alternativeAreaIds) {
        const list = alternativeOf.get(alt) ?? [];
        if (!list.includes(entry.areaId)) list.push(entry.areaId);
        alternativeOf.set(alt, list);
      }
    }
  }
  const instanceAreas = new Map<number, InstanceAreaRow>();
  for (const area of [...presenceAreas].sort((a, b) => a - b)) {
    const isKey = zones.dungeonsByFaction.Alliance.has(area) || zones.dungeonsByFaction.Horde.has(area);
    const parents = alternativeOf.get(area) ?? [];
    instanceAreas.set(area, { dungeonAreaId: isKey ? area : parents.length === 1 ? (parents[0] ?? null) : null });
  }
  const zonesBody: ZonesBody = {
    areas: new Map([...zones.areas].map(([id, entry]) => [id, { uiMapId: entry.uiMapId, link: entry.link }])),
    uiMaps: new Map([...zones.uiMaps].map(([id, entry]) => [id, { name: entry.name, nameSource: entry.nameSource, areaId: entry.areaId }])),
    dungeons: invariantDungeons,
    instanceAreas,
  };

  // Review detail.
  const itemWrites = forever.writes.item;
  const itemStartFixesOnly = items
    .filter((item) => item.startsQuest !== null && (itemWrites.get(item.id)?.get(5) ?? '').startsWith('legacy/itemStartFixes.lua'))
    .map((item) => item.id);
  const createdShipped = {
    quest: quests.filter((q) => q.provenance.created).length,
    npc: npcs.filter((n) => n.provenance.created).length,
    object: objects.filter((o) => o.provenance.created).length,
    item: items.filter((i) => i.provenance.created).length,
  };
  const coverage: Record<string, number> = {
    questsWithoutStarters: quests.filter((q) => q.starters.length === 0).length,
    questsWithoutFinishers: quests.filter((q) => q.finishers.length === 0).length,
    questsWithNullLevel: quests.filter((q) => q.level === null).length,
    questsWithNullXp: quests.filter((q) => q.xp === null).length,
    questsMixingObjectiveKinds: quests.filter((q) => new Set(q.objectives.filter((o) => o.kind !== 'event').map((o) => o.kind)).size > 1).length,
    questsWithEventAndOtherObjectives: quests.filter((q) => q.objectives.some((o) => o.kind === 'event') && q.objectives.some((o) => o.kind !== 'event')).length,
    questsWithObjectiveHints: quests.filter((q) => q.objectiveHints.length > 0).length,
    dungeonQuests: quests.filter((q) => q.dungeonQuest).length,
    npcsWithoutSpawns: npcs.filter((n) => !spawns.npc.has(n.id)).length,
    objectsWithoutSpawns: objects.filter((o) => !spawns.object.has(o.id)).length,
    flightMastersShipped: npcs.filter((n) => hasFlag(n.npcFlags, flagValues.flightMaster)).length,
  };
  for (const kind of ['kill', 'object', 'item', 'reputation', 'killCredit', 'spell', 'event']) {
    coverage[`objectives:${kind}`] = quests.reduce((sum, q) => sum + q.objectives.filter((o) => o.kind === kind).length, 0);
  }
  return {
    quests,
    npcs,
    objects,
    items,
    spawns,
    zones: zonesBody,
    overlays,
    detail: {
      selection,
      upstreamDiff,
      convertedPairs,
      upstreamDiffFromDynamic: dynamicOnly,
      corrected: correctedCount,
      createdShipped,
      dungeonQuestAreas: [...dungeonAreas].sort((a, b) => a - b),
      itemStartFixesOnly,
      flagValues,
      overlayEntries: layers.entryCounts,
      droppedOverlayIds,
      coverage,
      timingsMs: timings,
    },
  };
}

function dungeonRow(entry: DungeonRow): DungeonRow {
  return { name: entry.name, alternativeAreaIds: entry.alternativeAreaIds, parentZoneAreaId: entry.parentZoneAreaId, entrances: entry.entrances };
}

export type { Unprovenanced };
