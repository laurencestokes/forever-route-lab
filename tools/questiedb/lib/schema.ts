import { z } from 'zod';

/**
 * zod schemas of the shipped files (DATA_PROVENANCE §6; shapes.ts). Every object is strict, so an
 * unexpected key fails validation as surely as a missing one.
 */

const int = z.number().int();
const id = int.positive();
const finite = z.number().refine(Number.isFinite, 'finite number');
const nullableInt = int.nullable();
/** A single id where upstream's 0 ("none") was normalised to null (DATA_PROVENANCE §6). */
const nullableId = id.nullable();
/** A signed single id (zoneOrSort, requiredSpell) with 0 normalised to null. */
const nullableSignedId = int.refine((v) => v !== 0, 'a signed id is never 0 (0 ships as null)').nullable();

export const generatedSchema = z.strictObject({
  by: z.literal('tools/questiedb'),
  upstream: z.string().regex(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/),
  notice: z.literal('NOTICE.md'),
  manifest: z.literal('manifest.json'),
  edit: z.literal('do not edit; regenerate with pnpm data:extract'),
});

export const pointRowSchema = z.union([z.tuple([finite, finite]), z.tuple([finite, finite, int])]);
export const pointMapSchema = z.record(z.string().regex(/^\d+$/), z.array(pointRowSchema));

const provenanceSchema = z.strictObject({
  upstreamDiff: z.enum(['era', 'era-coords', 'forever-new', 'forever-changed']),
  foreverStatus: z.literal('unknown'),
  corrected: z.boolean(),
  created: z.boolean(),
  source: z.literal('questiedb'),
});

const entityRefSchema = z.strictObject({ kind: z.enum(['npc', 'object', 'item']), id });

const objectiveSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('kill'), npcId: id, label: z.string().nullable(), count: z.null() }),
  z.strictObject({ kind: z.literal('object'), objectId: id, label: z.string().nullable(), count: z.null() }),
  z.strictObject({ kind: z.literal('item'), itemId: id, label: z.string().nullable(), count: z.null() }),
  z.strictObject({ kind: z.literal('reputation'), factionId: int, value: finite }),
  z.strictObject({ kind: z.literal('killCredit'), npcIds: z.array(id), rootNpcId: id, label: z.string().nullable(), count: z.null() }),
  z.strictObject({ kind: z.literal('spell'), spellId: int, itemId: nullableId, label: z.string().nullable() }),
  z.strictObject({ kind: z.literal('event'), text: z.string().nullable(), points: pointMapSchema }),
]);

const hintSchema = z.strictObject({ text: z.string().nullable(), objectiveIndex: nullableInt, points: pointMapSchema, refs: z.array(entityRefSchema) });

const prerequisitesSchema = z.strictObject({
  preQuestSingle: z.array(int),
  preQuestGroup: z.array(int),
  exclusiveTo: z.array(int),
  nextQuestInChain: nullableId,
  parentQuest: nullableId,
  childQuests: z.array(int),
  inGroupWith: z.array(int),
  breadcrumbForQuestId: nullableId,
  breadcrumbs: z.array(int),
  availableUntilCompleted: nullableId,
  availableStartingWith: nullableId,
  disabledByQuest: nullableId,
});

const reputationPair = z.strictObject({ factionId: int, value: finite }).nullable();

const requirementsSchema = z.strictObject({
  skill: z.strictObject({ skillId: int, value: finite }).nullable(),
  minReputation: reputationPair,
  maxReputation: reputationPair,
  spell: nullableSignedId,
  specialization: nullableId,
  sourceItemId: nullableId,
  requiredSourceItems: z.array(id),
});

const questFields = {
  name: z.string(),
  level: nullableInt,
  minLevel: nullableInt,
  maxLevel: nullableInt,
  races: nullableInt,
  classes: nullableInt,
  zoneOrSort: nullableSignedId,
  dungeonQuest: z.boolean(),
  starters: z.array(entityRefSchema),
  finishers: z.array(entityRefSchema),
  objectives: z.array(objectiveSchema),
  objectiveHints: z.array(hintSchema),
  objectivesText: z.array(z.string()).nullable(),
  prerequisites: prerequisitesSchema,
  requirements: requirementsSchema,
  reputationReward: z.array(z.strictObject({ factionId: int, value: finite })),
  flags: z.strictObject({ repeatable: z.boolean(), needsEvent: z.boolean(), questFlags: int.nonnegative(), specialFlags: int.nonnegative() }),
  xp: z.strictObject({ questLevel: int, baseXp: finite, basis: z.literal('era-seed') }).nullable(),
};

export const questSchema = z.strictObject({ id, ...questFields, provenance: provenanceSchema });

const npcFields = {
  name: z.string(),
  subName: z.string().nullable(),
  minLevel: nullableInt,
  maxLevel: nullableInt,
  rank: nullableInt,
  zoneId: nullableId,
  npcFlags: int.nonnegative(),
  friendlyTo: z.enum(['A', 'H', 'AH']).nullable(),
  questStarts: z.array(int),
  questEnds: z.array(int),
};
export const npcSchema = z.strictObject({ id, ...npcFields, provenance: provenanceSchema });

const objectFields = { name: z.string(), zoneId: nullableId, factionId: nullableId, questStarts: z.array(int), questEnds: z.array(int) };
export const objectSchema = z.strictObject({ id, ...objectFields, provenance: provenanceSchema });

const itemFields = { name: z.string(), itemClass: nullableInt, dropNpcs: z.array(id), dropObjects: z.array(id), dropItems: z.array(id), startsQuest: nullableId };
export const itemSchema = z.strictObject({ id, ...itemFields, provenance: provenanceSchema });

const idKey = z.string().regex(/^\d+$/);

export const questsFileSchema = z.strictObject({ _generated: generatedSchema, rows: z.array(questSchema) });
export const entitiesFileSchema = z.strictObject({ _generated: generatedSchema, npcs: z.array(npcSchema), objects: z.array(objectSchema) });
export const itemsFileSchema = z.strictObject({ _generated: generatedSchema, rows: z.array(itemSchema) });
export const spawnsFileSchema = z.strictObject({ _generated: generatedSchema, npc: z.record(idKey, pointMapSchema), object: z.record(idKey, pointMapSchema) });

const dungeonSchema = z.strictObject({
  name: z.string().min(1),
  alternativeAreaIds: z.array(int),
  parentZoneAreaId: int,
  entrances: z.array(z.strictObject({ areaId: int, x: finite, y: finite, frameVerified: z.boolean() })),
});

export const zonesFileSchema = z.strictObject({
  _generated: generatedSchema,
  areas: z.record(idKey, z.strictObject({ uiMapId: int.nonnegative(), link: z.enum(['direct', 'routed', 'synthetic-alias', 'legacy-compat', 'suppressed']) })),
  uiMaps: z.record(
    idKey,
    z.strictObject({ name: z.string().min(1).nullable(), nameSource: z.string().regex(/^questiedb:support\/Forever\/Zones\/uiMapIdToAreaId\.lua:\d+$/).nullable(), areaId: nullableInt }),
  ),
  dungeons: z.record(idKey, dungeonSchema),
  instanceAreas: z.record(idKey, z.strictObject({ dungeonAreaId: nullableInt })),
});

const partial = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape).partial();

export const overlaysFileSchema = z.strictObject({
  _generated: generatedSchema,
  faction: z.strictObject({
    Alliance: z.lazy(() => factionLayerSchema),
    Horde: z.lazy(() => factionLayerSchema),
  }),
  class: z.strictObject({
    Alliance: z.record(z.string().regex(/^[A-Z]+$/), z.strictObject({ quests: z.record(idKey, partial(questFields)) })),
    Horde: z.record(z.string().regex(/^[A-Z]+$/), z.strictObject({ quests: z.record(idKey, partial(questFields)) })),
  }),
});

const factionLayerSchema = z.strictObject({
  quests: z.record(idKey, partial(questFields)),
  npcs: z.record(idKey, partial({ ...npcFields, spawns: pointMapSchema })),
  objects: z.record(idKey, partial({ ...objectFields, spawns: pointMapSchema })),
  items: z.record(idKey, partial(itemFields)),
  dungeons: z.record(idKey, dungeonSchema),
});

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const counts4 = z.strictObject({ quests: int, npcs: int, objects: int, items: int });

export const manifestSchema = z.looseObject({
  _generated: generatedSchema,
  schemaVersion: z.literal(1),
  dataRevision: sha256,
  dataset: z.literal('questiedb-forever'),
  flavour: z.literal('Forever'),
  upstream: z.strictObject({ repository: z.url(), branchObserved: z.string(), commit: z.string().regex(/^[0-9a-f]{40}$/), commitDate: z.string() }),
  licence: z.strictObject({
    upstreamLicenceFile: z.null(),
    checked: z.iso.date(),
    finding: z.string(),
    projectLicence: z.literal('GPL-3.0-or-later'),
    scope: z.string(),
    notice: z.literal('NOTICE.md'),
  }),
  sourceGameBuilds: z.strictObject({ dbcTarget: z.string(), conversionSource: z.string(), uiSourceResearched: z.string(), tocInterface: int }),
  toolTreeHash: z.strictObject({ tree: z.string().regex(/^[0-9a-f]{40}$/), lockfile: sha256 }),
  runtime: z.strictObject({ luaparse: z.string() }),
  inputs: z.array(
    z.strictObject({ path: z.string(), sha256, gitBlob: z.string().regex(/^[0-9a-f]{40}$/), bytes: int, role: z.enum(['data', 'correction', 'schema', 'support', 'semantics', 'provenance-only']) }),
  ),
  upstreamManifestCheck: z.looseObject({ allMatch: z.literal(true) }),
  layers: z.array(z.string()),
  dynamicLayers: z.array(z.looseObject({ key: z.string(), file: z.literal('overlays.json') })),
  outputs: z.array(
    z.strictObject({
      path: z.string(),
      sha256,
      bytes: int,
      records: int.nullable(),
      origins: z.array(z.strictObject({ fields: z.array(z.string()), origin: z.string(), evidence: z.string() })),
    }),
  ),
  counts: z.looseObject({ raw: counts4, composed: counts4, shipped: counts4, spawnEntities: z.strictObject({ npc: int, object: int }) }),
  provenance: z.looseObject({ threeWayClassifier: z.literal('stub') }),
  foreverContentVerified: z.literal(false),
});
