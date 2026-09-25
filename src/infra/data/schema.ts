import type { ClassLayer, DataJsonFile, DungeonRow, FactionLayer, GeneratedMarker, ItemRow, NpcRow, ObjectiveHintRow, ObjectRow, QuestRow } from './rows';
import { AREA_LINKS, type DatasetFiles, type EventObjectiveRow, type ObjectiveRow, type OverlaysTable, type SpawnsTable, type ZonesTable } from './rows';
import { array, checkAscendingIds, checkValue, literal, map, nullable, object, partial, type ObjectSpec, type Spec, union } from './check';

/**
 * Specs of the shipped files (DATA_PROVENANCE §6), mirroring `tools/questiedb/lib/schema.ts`,
 * which validates them when they are written. Checking them again at load catches a data
 * directory from another tool version, or a deploy that mixed files, before any record is used.
 * The values the extractor never writes (a `user` XP basis, a declared Forever status, a custom
 * source) are refused here too: they can only come from a project, never from `public/data/`.
 *
 * Single ids where upstream writes 0 for "none" ship as null (DATA_PROVENANCE §6, "0 → null";
 * src/domain/dataset.ts), so those fields take `nullableId`: a 0 there means the file is not what
 * this extractor writes, and it is refused rather than read as id 0 (M2 review code-F8). The two
 * signed ids (`zoneOrSort`, `requirements.spell`) take `nullableSignedId`: any integer but 0.
 */

const generated = object<GeneratedMarker>({
  by: literal('tools/questiedb'),
  upstream: 'string',
  notice: literal('NOTICE.md'),
  manifest: literal('manifest.json'),
  edit: 'string',
});

const pointMap: Spec = map('uint', array('point'));

const provenance = object<QuestRow['provenance']>({
  upstreamDiff: literal('era', 'era-coords', 'forever-new', 'forever-changed'),
  foreverStatus: literal('unknown'),
  corrected: 'boolean',
  created: 'boolean',
  source: literal('questiedb'),
});

const entityRef = union('kind', {
  npc: object<{ kind: 'npc'; id: number }>({ kind: literal('npc'), id: 'id' }),
  object: object<{ kind: 'object'; id: number }>({ kind: literal('object'), id: 'id' }),
  item: object<{ kind: 'item'; id: number }>({ kind: literal('item'), id: 'id' }),
});

type Variant<K extends ObjectiveRow['kind']> = Extract<ObjectiveRow, { readonly kind: K }>;

const label = nullable('string');

const objective = union('kind', {
  kill: object<Variant<'kill'>>({ kind: literal('kill'), npcId: 'id', label, count: literal(null) }),
  object: object<Variant<'object'>>({ kind: literal('object'), objectId: 'id', label, count: literal(null) }),
  item: object<Variant<'item'>>({ kind: literal('item'), itemId: 'id', label, count: literal(null) }),
  reputation: object<Variant<'reputation'>>({ kind: literal('reputation'), factionId: 'int', value: 'number' }),
  killCredit: object<Variant<'killCredit'>>({ kind: literal('killCredit'), npcIds: array('id'), rootNpcId: 'id', label, count: literal(null) }),
  spell: object<Variant<'spell'>>({ kind: literal('spell'), spellId: 'int', itemId: nullable('id'), label }),
  event: object<EventObjectiveRow>({ kind: literal('event'), text: nullable('string'), points: pointMap }),
});

const hint = object<ObjectiveHintRow>({ text: nullable('string'), objectiveIndex: nullable('int'), points: pointMap, refs: array(entityRef) });

const nullableInt = nullable('int');
/** A positive single id, or null for none (upstream's 0 is normalised to null by the extractor). */
const nullableId = nullable('id');
/** A signed single id that is never 0 (`zoneOrSort`, `requirements.spell`), or null for none. */
const nullableSignedId = nullable('signedId');
const ints = array('int');

const prerequisites = object<QuestRow['prerequisites']>({
  preQuestSingle: ints,
  preQuestGroup: ints,
  exclusiveTo: ints,
  nextQuestInChain: nullableId,
  parentQuest: nullableId,
  childQuests: ints,
  inGroupWith: ints,
  breadcrumbForQuestId: nullableId,
  breadcrumbs: ints,
  availableUntilCompleted: nullableId,
  availableStartingWith: nullableId,
  disabledByQuest: nullableId,
});

const reputationPair = object<{ factionId: number; value: number }>({ factionId: 'int', value: 'number' });

const requirements = object<QuestRow['requirements']>({
  skill: nullable(object<{ skillId: number; value: number }>({ skillId: 'int', value: 'number' })),
  minReputation: nullable(reputationPair),
  maxReputation: nullable(reputationPair),
  spell: nullableSignedId,
  specialization: nullableId,
  sourceItemId: nullableId,
  requiredSourceItems: array('id'),
});

type QuestFields = Omit<QuestRow, 'id' | 'provenance'>;

const questFields = {
  name: 'string',
  level: nullableInt,
  minLevel: nullableInt,
  maxLevel: nullableInt,
  races: nullableInt,
  classes: nullableInt,
  zoneOrSort: nullableSignedId,
  dungeonQuest: 'boolean',
  starters: array(entityRef),
  finishers: array(entityRef),
  objectives: array(objective),
  objectiveHints: array(hint),
  objectivesText: nullable(array('string')),
  prerequisites,
  requirements,
  reputationReward: array(reputationPair),
  flags: object<QuestRow['flags']>({ repeatable: 'boolean', needsEvent: 'boolean', questFlags: 'uint', specialFlags: 'uint' }),
  xp: nullable(object<NonNullable<QuestRow['xp']>>({ questLevel: 'int', baseXp: 'number', basis: literal('era-seed') })),
} as const satisfies Readonly<Record<keyof QuestFields, Spec>>;

const quest = object<QuestRow>({ id: 'id', ...questFields, provenance });

type NpcFields = Omit<NpcRow, 'id' | 'provenance'>;
const npcFields = {
  name: 'string',
  subName: nullable('string'),
  minLevel: nullableInt,
  maxLevel: nullableInt,
  rank: nullableInt,
  zoneId: nullableId,
  npcFlags: 'uint',
  friendlyTo: literal('A', 'H', 'AH', null),
  questStarts: ints,
  questEnds: ints,
} as const satisfies Readonly<Record<keyof NpcFields, Spec>>;
const npc = object<NpcRow>({ id: 'id', ...npcFields, provenance });

type ObjectFields = Omit<ObjectRow, 'id' | 'provenance'>;
const objectFields = {
  name: 'string',
  zoneId: nullableId,
  factionId: nullableId,
  questStarts: ints,
  questEnds: ints,
} as const satisfies Readonly<Record<keyof ObjectFields, Spec>>;
const gameObject = object<ObjectRow>({ id: 'id', ...objectFields, provenance });

type ItemFields = Omit<ItemRow, 'id' | 'provenance'>;
const itemFields = {
  name: 'string',
  itemClass: nullableInt,
  dropNpcs: array('id'),
  dropObjects: array('id'),
  dropItems: array('id'),
  startsQuest: nullableId,
} as const satisfies Readonly<Record<keyof ItemFields, Spec>>;
const item = object<ItemRow>({ id: 'id', ...itemFields, provenance });

const dungeon = object<DungeonRow>({
  name: 'string',
  alternativeAreaIds: ints,
  parentZoneAreaId: 'int',
  entrances: array(object<DungeonRow['entrances'][number]>({ areaId: 'int', x: 'number', y: 'number', frameVerified: 'boolean' })),
});

const zonesFields = {
  areas: map('uint', object<ZonesTable['areas'][string]>({ uiMapId: 'uint', link: literal(...AREA_LINKS) })),
  uiMaps: map('uint', object<ZonesTable['uiMaps'][string]>({ name: nullable('string'), nameSource: nullable('string'), areaId: nullableInt })),
  dungeons: map('uint', dungeon),
  instanceAreas: map('uint', object<ZonesTable['instanceAreas'][string]>({ dungeonAreaId: nullableInt })),
} as const satisfies Readonly<Record<keyof ZonesTable, Spec>>;

const questPatch = partial<QuestFields>(questFields);

const factionLayer = object<FactionLayer>({
  quests: map('uint', questPatch),
  npcs: map('uint', partial<NpcFields & { spawns: unknown }>({ ...npcFields, spawns: pointMap })),
  objects: map('uint', partial<ObjectFields & { spawns: unknown }>({ ...objectFields, spawns: pointMap })),
  items: map('uint', partial<ItemFields>(itemFields)),
  dungeons: map('uint', dungeon),
});

const classLayers = map('token', object<ClassLayer>({ quests: map('uint', questPatch) }));

/** The spec of each file, with its `_generated` marker (DATA_PROVENANCE §7 item 3). */
const FILE_SPECS: Readonly<Record<DataJsonFile, ObjectSpec>> = {
  'quests.json': object<{ _generated: unknown; rows: unknown }>({ _generated: generated, rows: array(quest) }),
  'entities.json': object<{ _generated: unknown; npcs: unknown; objects: unknown }>({
    _generated: generated,
    npcs: array(npc),
    objects: array(gameObject),
  }),
  'items.json': object<{ _generated: unknown; rows: unknown }>({ _generated: generated, rows: array(item) }),
  'spawns.json': object<{ _generated: unknown } & SpawnsTable>({
    _generated: generated,
    npc: map('uint', pointMap),
    object: map('uint', pointMap),
  }),
  'zones.json': object<{ _generated: unknown } & ZonesTable>({ _generated: generated, ...zonesFields }),
  'overlays.json': object<{ _generated: unknown; faction: unknown; class: unknown }>({
    _generated: generated,
    faction: object<OverlaysTable['faction']>({ Alliance: factionLayer, Horde: factionLayer }),
    class: object<OverlaysTable['class']>({ Alliance: classLayers, Horde: classLayers }),
  }),
};

/** One checked file, `_generated` stripped. */
export type FileContent = {
  readonly 'quests.json': { readonly rows: readonly QuestRow[] };
  readonly 'entities.json': { readonly npcs: readonly NpcRow[]; readonly objects: readonly ObjectRow[] };
  readonly 'items.json': { readonly rows: readonly ItemRow[] };
  readonly 'spawns.json': SpawnsTable;
  readonly 'zones.json': ZonesTable;
  readonly 'overlays.json': OverlaysTable;
};

export type FileReadResult<F extends DataJsonFile> =
  | { readonly ok: true; readonly content: FileContent[F] }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Record lists that must be in ascending id order, per file. */
const ORDERED_LISTS: Readonly<Record<DataJsonFile, readonly string[]>> = {
  'quests.json': ['rows'],
  'entities.json': ['npcs', 'objects'],
  'items.json': ['rows'],
  'spawns.json': [],
  'zones.json': [],
  'overlays.json': [],
};

/**
 * Checks one parsed file against its spec and strips `_generated`. The cast at the end is the one
 * place where unknown JSON becomes typed rows, and it is sound because the spec covers every field
 * of the row types (FieldSpecs makes the compiler check that each key has a spec).
 */
export function readDataFile<F extends DataJsonFile>(file: F, json: unknown): FileReadResult<F> {
  const errors = [...checkValue(FILE_SPECS[file], json, file)];
  if (errors.length === 0) {
    const value = json as Readonly<Record<string, readonly { readonly id: number }[]>>;
    for (const list of ORDERED_LISTS[file]) errors.push(...checkAscendingIds(value[list] ?? [], `${file}.${list}`));
  }
  if (errors.length > 0) return { ok: false, errors };
  const { _generated: _marker, ...content } = json as Readonly<Record<string, unknown>>;
  return { ok: true, content: content as FileContent[F] };
}

/** Assembles the six checked files into the loader's `DatasetFiles`. */
export function datasetFilesOf(files: { readonly [F in DataJsonFile]: FileContent[F] }): DatasetFiles {
  return {
    quests: files['quests.json'].rows,
    npcs: files['entities.json'].npcs,
    objects: files['entities.json'].objects,
    items: files['items.json'].rows,
    spawns: files['spawns.json'],
    zones: files['zones.json'],
    overlays: files['overlays.json'],
  };
}
