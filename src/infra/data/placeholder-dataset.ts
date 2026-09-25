import {
  type AreaId,
  areaId,
  type DatasetIdentity,
  type DatasetView,
  type EntityRef,
  HORDE_RACE_MASK,
  ALLIANCE_RACE_MASK,
  type ItemRecord,
  itemId,
  type NpcId,
  type NpcRecord,
  npcId,
  type ObjectiveDef,
  type ObjectRecord,
  objectId,
  type QuestId,
  type QuestPrerequisites,
  type QuestRecord,
  type QuestRequirements,
  questId,
  type RecordProvenance,
  type SpawnPoint,
  type UiMapId,
  uiMapId,
  type ZoneInfo,
  zoneSourcedPoint,
} from '../../domain';

/**
 * A tiny, in-memory DatasetView, now a TEST FIXTURE only: the Milestone 1 shell ran on it, and the
 * shell's editing tests (src/ui/App.test.tsx and the panel tests) still do, because their
 * assertions are about editing, not data. The running app loads the real dataset instead
 * (loader.ts, dataset-view.ts); tests/placeholder-usage.test.ts keeps this file out of it.
 *
 * Everything here is synthetic and says so: every name starts with "Placeholder", every id sits in
 * the reserved range 900001 and up (far above any real quest, NPC, object, item or UiMap id), the
 * zones are invented, and no record carries game text, XP or objective counts. Quest XP is null
 * (unknown), never a made-up number. The identity's `dataRevision` and `frameBuild` are both
 * `placeholder`: the UI uses the revision to label the data as a placeholder, and no real client
 * build is stamped on synthetic data.
 */

export const PLACEHOLDER_DATA_REVISION = 'placeholder';

export const PLACEHOLDER_DATASET_IDENTITY: DatasetIdentity = {
  dataRevision: PLACEHOLDER_DATA_REVISION,
  frameBuild: 'placeholder',
  upstreamCommit: 'none',
  foreverContentVerified: false,
};

/** First id of the reserved synthetic range. No dataset id reaches it. */
export const PLACEHOLDER_ID_MIN = 900_001;

/**
 * Placeholder records have no upstream. `RecordProvenance` has no placeholder value, so these
 * fields are nominal: `source: 'custom'` (not from QuestieDB) and `foreverStatus: 'unknown'`,
 * which the UI shows as "Forever status: unknown". `upstreamDiff` must be set; `era` makes no
 * Forever claim.
 */
const PROVENANCE: RecordProvenance = {
  upstreamDiff: 'era',
  foreverStatus: 'unknown',
  corrected: false,
  created: false,
  source: 'custom',
};

/** QuestieDB's Era `npcFlags` values (docs/research/questiedb-schema.md, NPC field 15). */
const NPC_FLAG = { questGiver: 2, vendor: 4, flightMaster: 8, trainer: 16, innkeeper: 128 } as const;

// Zones ---------------------------------------------------------------------------------------

const VALE_MAP = uiMapId(900_901);
const RIDGE_MAP = uiMapId(900_902);
const VALE_AREA = areaId(900_801);
const RIDGE_AREA = areaId(900_802);

export const PLACEHOLDER_ZONES = {
  vale: { uiMapId: VALE_MAP, areaId: VALE_AREA, name: 'Placeholder Vale' },
  ridge: { uiMapId: RIDGE_MAP, areaId: RIDGE_AREA, name: 'Placeholder Ridge' },
} as const;

export interface PlaceholderSpot {
  readonly uiMapId: UiMapId;
  readonly x: number;
  readonly y: number;
  readonly label: string;
}

const spot = (map: UiMapId, x: number, y: number, label: string): PlaceholderSpot => ({ uiMapId: map, x, y, label });

/** Named zone-percent points in the placeholder zones, shared by NPC spawns and the placeholder route. */
export const PLACEHOLDER_SPOTS = {
  camp: spot(VALE_MAP, 45.2, 52.8, 'Placeholder camp'),
  inn: spot(VALE_MAP, 46.4, 51.1, 'Placeholder inn'),
  meadow: spot(VALE_MAP, 38.0, 61.5, 'Placeholder meadow'),
  grove: spot(VALE_MAP, 52.4, 70.1, 'Placeholder grove'),
  ruins: spot(VALE_MAP, 61.3, 40.6, 'Placeholder ruins'),
  valeFlight: spot(VALE_MAP, 47.9, 49.3, 'Placeholder Vale flight point'),
  outpost: spot(RIDGE_MAP, 30.5, 44.4, 'Placeholder outpost'),
  ridgeFlight: spot(RIDGE_MAP, 29.1, 46.0, 'Placeholder Ridge flight point'),
  banditCamp: spot(RIDGE_MAP, 55.0, 28.3, 'Placeholder bandit camp'),
} as const satisfies Readonly<Record<string, PlaceholderSpot>>;

// Ids -----------------------------------------------------------------------------------------

export const PLACEHOLDER_QUEST_IDS = {
  kill: questId(900_001),
  item: questId(900_002),
  object: questId(900_003),
  followUp: questId(900_004),
  delivery: questId(900_005),
  secondZone: questId(900_006),
  hordeOnly: questId(900_007),
  allianceOnly: questId(900_008),
} as const;

export const PLACEHOLDER_NPC_IDS = {
  quartermaster: npcId(900_101),
  scout: npcId(900_102),
  herbalist: npcId(900_103),
  innkeeper: npcId(900_104),
  valeFlightKeeper: npcId(900_105),
  ridgeFlightKeeper: npcId(900_106),
  supplier: npcId(900_107),
  trainer: npcId(900_108),
  boar: npcId(900_111),
  wisp: npcId(900_112),
  sentinel: npcId(900_113),
  bandit: npcId(900_114),
} as const;

export const PLACEHOLDER_OBJECT_IDS = { crate: objectId(900_201) } as const;
export const PLACEHOLDER_ITEM_IDS = { token: itemId(900_301) } as const;

const Q = PLACEHOLDER_QUEST_IDS;
const N = PLACEHOLDER_NPC_IDS;

// Records -------------------------------------------------------------------------------------

const NO_PREREQUISITES: QuestPrerequisites = {
  preQuestSingle: [],
  preQuestGroup: [],
  exclusiveTo: [],
  nextQuestInChain: null,
  parentQuest: null,
  childQuests: [],
  inGroupWith: [],
  breadcrumbForQuestId: null,
  breadcrumbs: [],
  availableUntilCompleted: null,
  availableStartingWith: null,
  disabledByQuest: null,
};

const NO_REQUIREMENTS: QuestRequirements = {
  skill: null,
  minReputation: null,
  maxReputation: null,
  spell: null,
  specialization: null,
  sourceItemId: null,
  requiredSourceItems: [],
};

interface QuestSeed {
  readonly id: QuestId;
  readonly name: string;
  readonly level: number;
  readonly minLevel: number;
  readonly area: AreaId;
  readonly starter: NpcId;
  readonly finisher: NpcId;
  readonly objectives: readonly ObjectiveDef[];
  readonly races?: number;
  readonly preQuestSingle?: readonly QuestId[];
}

function quest(seed: QuestSeed): QuestRecord {
  return {
    id: seed.id,
    name: seed.name,
    level: seed.level,
    minLevel: seed.minLevel,
    maxLevel: null,
    races: seed.races ?? null,
    classes: null,
    zoneOrSort: seed.area,
    dungeonQuest: false,
    starters: [{ kind: 'npc', id: seed.starter }],
    finishers: [{ kind: 'npc', id: seed.finisher }],
    objectives: seed.objectives,
    objectiveHints: [],
    objectivesText: null,
    prerequisites: { ...NO_PREREQUISITES, preQuestSingle: seed.preQuestSingle ?? [] },
    requirements: NO_REQUIREMENTS,
    reputationReward: [],
    flags: { repeatable: false, needsEvent: false, questFlags: 0, specialFlags: 0 },
    xp: null,
    provenance: PROVENANCE,
  };
}

const kill = (id: NpcId): ObjectiveDef => ({ kind: 'kill', npcId: id, label: null, count: null });

const QUESTS: readonly QuestRecord[] = [
  quest({
    id: Q.kill,
    name: 'Placeholder Quest 1: kill objective',
    level: 1,
    minLevel: 1,
    area: VALE_AREA,
    starter: N.quartermaster,
    finisher: N.quartermaster,
    objectives: [kill(N.boar)],
  }),
  quest({
    id: Q.item,
    name: 'Placeholder Quest 2: item objective',
    level: 2,
    minLevel: 1,
    area: VALE_AREA,
    starter: N.quartermaster,
    finisher: N.quartermaster,
    objectives: [{ kind: 'item', itemId: PLACEHOLDER_ITEM_IDS.token, label: null, count: null }],
  }),
  quest({
    id: Q.object,
    name: 'Placeholder Quest 3: object objective',
    level: 3,
    minLevel: 2,
    area: VALE_AREA,
    starter: N.scout,
    finisher: N.scout,
    objectives: [{ kind: 'object', objectId: PLACEHOLDER_OBJECT_IDS.crate, label: null, count: null }],
  }),
  quest({
    id: Q.followUp,
    name: 'Placeholder Quest 4: follow-up to Quest 1',
    level: 3,
    minLevel: 2,
    area: VALE_AREA,
    starter: N.quartermaster,
    finisher: N.quartermaster,
    objectives: [kill(N.sentinel)],
    preQuestSingle: [Q.kill],
  }),
  quest({
    id: Q.delivery,
    name: 'Placeholder Quest 5: delivery',
    level: 3,
    minLevel: 2,
    area: RIDGE_AREA,
    starter: N.quartermaster,
    finisher: N.herbalist,
    objectives: [],
  }),
  quest({
    id: Q.secondZone,
    name: 'Placeholder Quest 6: second zone',
    level: 4,
    minLevel: 3,
    area: RIDGE_AREA,
    starter: N.herbalist,
    finisher: N.herbalist,
    objectives: [kill(N.bandit)],
  }),
  quest({
    id: Q.hordeOnly,
    name: 'Placeholder Quest 7: Horde only',
    level: 4,
    minLevel: 3,
    area: RIDGE_AREA,
    starter: N.herbalist,
    finisher: N.quartermaster,
    objectives: [kill(N.bandit)],
    races: HORDE_RACE_MASK,
  }),
  quest({
    id: Q.allianceOnly,
    name: 'Placeholder Quest 8: Alliance only',
    level: 4,
    minLevel: 3,
    area: RIDGE_AREA,
    starter: N.herbalist,
    finisher: N.herbalist,
    objectives: [],
    races: ALLIANCE_RACE_MASK,
  }),
];

interface NpcSeed {
  readonly id: NpcId;
  readonly name: string;
  readonly subName?: string;
  readonly level: readonly [number, number];
  readonly area: AreaId;
  readonly flags?: number;
  /** Null: hostile to both factions (a mob). */
  readonly friendlyTo: NpcRecord['friendlyTo'];
  readonly spots: readonly PlaceholderSpot[];
}

/** A friendly NPC offering a service (`flags`) at one spot. */
const friendly = (id: NpcId, name: string, level: number, flags: number, where: PlaceholderSpot, subName?: string): NpcSeed => ({
  id,
  name,
  ...(subName === undefined ? {} : { subName }),
  level: [level, level],
  area: where.uiMapId === VALE_MAP ? VALE_AREA : RIDGE_AREA,
  flags,
  friendlyTo: 'AH',
  spots: [where],
});

const mob = (id: NpcId, name: string, minLevel: number, maxLevel: number, where: PlaceholderSpot): NpcSeed => ({
  id,
  name,
  level: [minLevel, maxLevel],
  area: where.uiMapId === VALE_MAP ? VALE_AREA : RIDGE_AREA,
  friendlyTo: null,
  spots: [where],
});

const S = PLACEHOLDER_SPOTS;
const GIVER = 'Placeholder quest giver';

const NPC_SEEDS: readonly NpcSeed[] = [
  friendly(N.quartermaster, 'Placeholder Quartermaster', 5, NPC_FLAG.questGiver, S.camp, GIVER),
  friendly(N.scout, 'Placeholder Scout', 5, NPC_FLAG.questGiver, S.camp, GIVER),
  friendly(N.herbalist, 'Placeholder Herbalist', 8, NPC_FLAG.questGiver, S.outpost, GIVER),
  friendly(N.innkeeper, 'Placeholder Innkeeper', 10, NPC_FLAG.innkeeper, S.inn),
  friendly(N.valeFlightKeeper, 'Placeholder Vale Flight Keeper', 10, NPC_FLAG.flightMaster, S.valeFlight),
  friendly(N.ridgeFlightKeeper, 'Placeholder Ridge Flight Keeper', 10, NPC_FLAG.flightMaster, S.ridgeFlight),
  friendly(N.supplier, 'Placeholder Supplier', 8, NPC_FLAG.vendor, S.outpost),
  friendly(N.trainer, 'Placeholder Trainer', 10, NPC_FLAG.trainer, S.outpost),
  mob(N.boar, 'Placeholder Boar', 1, 2, S.meadow),
  mob(N.wisp, 'Placeholder Wisp', 2, 3, S.grove),
  mob(N.sentinel, 'Placeholder Sentinel', 3, 4, S.ruins),
  mob(N.bandit, 'Placeholder Bandit', 4, 5, S.banditCamp),
];

function questLinks(npc: NpcId): { readonly questStarts: QuestId[]; readonly questEnds: QuestId[] } {
  const has = (refs: readonly EntityRef[]) => refs.some((ref) => ref.kind === 'npc' && ref.id === npc);
  return {
    questStarts: QUESTS.filter((q) => has(q.starters)).map((q) => q.id),
    questEnds: QUESTS.filter((q) => has(q.finishers)).map((q) => q.id),
  };
}

const NPCS: readonly NpcRecord[] = NPC_SEEDS.map((seed) => ({
  id: seed.id,
  name: seed.name,
  subName: seed.subName ?? null,
  minLevel: seed.level[0],
  maxLevel: seed.level[1],
  rank: 0,
  zoneId: seed.area,
  npcFlags: seed.flags ?? 0,
  friendlyTo: seed.friendlyTo,
  ...questLinks(seed.id),
  provenance: PROVENANCE,
}));

const OBJECTS: readonly ObjectRecord[] = [
  { id: PLACEHOLDER_OBJECT_IDS.crate, name: 'Placeholder Crate', zoneId: VALE_AREA, factionId: null, questStarts: [], questEnds: [], provenance: PROVENANCE },
];

const ITEMS: readonly ItemRecord[] = [
  {
    id: PLACEHOLDER_ITEM_IDS.token,
    name: 'Placeholder Token',
    itemClass: null,
    dropNpcs: [N.wisp],
    dropObjects: [],
    dropItems: [],
    startsQuest: null,
    provenance: PROVENANCE,
  },
];

const ZONES: readonly ZoneInfo[] = [
  { uiMapId: VALE_MAP, name: PLACEHOLDER_ZONES.vale.name, worldMapId: null },
  { uiMapId: RIDGE_MAP, name: PLACEHOLDER_ZONES.ridge.name, worldMapId: null },
];

/** Placeholder zones have no geometry, so spawns carry their published point only (`world: null`). */
const toSpawn = (s: PlaceholderSpot): SpawnPoint => ({
  source: zoneSourcedPoint(s.uiMapId, s.x, s.y),
  world: null,
  uiMapId: s.uiMapId,
});

const OBJECT_SPAWNS: Readonly<Record<number, readonly PlaceholderSpot[]>> = {
  [PLACEHOLDER_OBJECT_IDS.crate]: [PLACEHOLDER_SPOTS.ruins],
};

// View ----------------------------------------------------------------------------------------

function byId<T extends { readonly id: number }>(records: readonly T[]): ReadonlyMap<number, T> {
  return new Map(records.map((r) => [r.id, r]));
}

const ascending = <T extends { readonly id: number }>(records: readonly T[]): readonly T[] =>
  [...records].sort((a, b) => a.id - b.id);

/** The placeholder dataset. Records are shared between calls; they are never mutated. */
export function createPlaceholderDataset(): DatasetView {
  const quests = byId(QUESTS);
  const npcs = byId(NPCS);
  const objects = byId(OBJECTS);
  const items = byId(ITEMS);
  const zones = new Map(ZONES.map((z) => [z.uiMapId, z]));
  const sortedQuests = ascending(QUESTS);
  const sortedZones = [...ZONES].sort((a, b) => a.uiMapId - b.uiMapId);
  const npcSpawns = new Map(NPC_SEEDS.map((seed) => [seed.id, seed.spots.map(toSpawn)]));

  return {
    identity: PLACEHOLDER_DATASET_IDENTITY,
    quest: (id) => quests.get(id),
    npc: (id) => npcs.get(id),
    object: (id) => objects.get(id),
    item: (id) => items.get(id),
    quests: () => sortedQuests,
    spawns(ref) {
      switch (ref.kind) {
        case 'npc':
          return npcSpawns.get(ref.id) ?? [];
        case 'object':
          return (OBJECT_SPAWNS[ref.id] ?? []).map(toSpawn);
        case 'item':
          return [];
      }
    },
    zone: (id) => zones.get(id),
    zones: () => sortedZones,
  };
}
