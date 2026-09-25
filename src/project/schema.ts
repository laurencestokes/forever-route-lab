import { z } from 'zod';
import {
  CLASS_TOKENS,
  type FilterAst,
  PROJECT_SCHEMA_VERSION,
  RACE_TOKENS,
  areaId,
  factionId,
  groupId,
  itemId,
  npcId,
  objectId,
  projectId,
  questId,
  routeId,
  skillId,
  spellId,
  stepId,
  uiMapId,
  worldMapId,
} from '../domain';

/**
 * zod schemas for the native project format, schema version 1 (docs/ARCHITECTURE.md §8.2).
 * The domain types in src/domain are authoritative: `z.infer<typeof projectSchema>` must equal
 * `ProjectV1`, which schema.test.ts checks at compile time. Objects are strict (an unknown key is
 * an error, never dropped) and parsed values are frozen, matching the readonly domain types.
 * Version 1 is unstable until the end of Milestone 6.
 */

// ---------------------------------------------------------------------------------------------
// Building blocks

const obj = <S extends z.core.$ZodLooseShape>(shape: S) => z.strictObject(shape).readonly();
const arr = <T extends z.core.SomeType>(item: T) => z.array(item).readonly();

const int = () => z.number().int();
const nonNegInt = () => z.number().int().nonnegative();
const posInt = () => z.number().int().positive();
const nonNeg = () => z.number().nonnegative();
const positive = () => z.number().positive();

/** A decimal integer as `String(id)` writes it, for record keys that stand for numeric ids. */
const DECIMAL_ID_KEY = /^(0|-?[1-9][0-9]*)$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

const decimalKey = () => z.string().regex(DECIMAL_ID_KEY, 'Expected a decimal integer key');

/**
 * Names of Object.prototype members (ES2023 plus Annex B). A plain object keyed by such an id
 * resolves `groups[id]` to the inherited member when the key is absent, and assigning
 * `groups.__proto__` replaces the prototype, so ids used as object keys may not take these names.
 * Listed rather than read from Object.prototype, so the accepted set is the same in every engine;
 * schema.test.ts checks the list covers the runtime's.
 */
export const RESERVED_ID_KEYS: ReadonlySet<string> = new Set([
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  '__proto__',
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'toString',
  'valueOf',
]);

const notReserved = (id: string): boolean => !RESERVED_ID_KEYS.has(id);
const RESERVED_ID_MESSAGE = 'Reserved id: the name of an Object.prototype member';

/** A non-empty string id that is also used as an object key. */
const keyableId = () => nonEmpty().refine(notReserved, RESERVED_ID_MESSAGE);
const nonEmpty = () => z.string().min(1);
const sha256 = () => z.string().regex(SHA256_HEX, 'Expected a lowercase SHA-256 hex digest');
const isoTimestamp = () => z.iso.datetime({ offset: true });

const questIdSchema = int().transform(questId);
const npcIdSchema = int().transform(npcId);
const objectIdSchema = int().transform(objectId);
const itemIdSchema = int().transform(itemId);
const spellIdSchema = int().transform(spellId);
const factionIdSchema = int().transform(factionId);
const skillIdSchema = int().transform(skillId);
const areaIdSchema = int().transform(areaId);
const uiMapIdSchema = int().transform(uiMapId);
const worldMapIdSchema = int().transform(worldMapId);
const stepIdSchema = nonEmpty().transform(stepId);
const groupIdSchema = keyableId().transform(groupId);
const routeIdSchema = nonEmpty().transform(routeId);
const projectIdSchema = nonEmpty().transform(projectId);

/** Race and class masks: non-negative safe integers, tested arithmetically (D-012). */
const maskSchema = nonNegInt().nullable();

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === 'object') {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

/** Extension bags hold arbitrary JSON, so serialisation stays exact and deterministic. */
const extSchema = z
  .record(
    z.string(),
    z.unknown().superRefine((value, ctx) => {
      if (!isJsonValue(value)) ctx.addIssue({ code: 'custom', message: 'Expected a JSON value' });
    }),
  )
  .readonly();

// ---------------------------------------------------------------------------------------------
// Points (src/domain/points.ts)

const lexemesSchema = z.tuple([z.string(), z.string()]).readonly().nullable();

export const sourcedPointSchema = z.discriminatedUnion('space', [
  obj({
    space: z.literal('world'),
    mapId: worldMapIdSchema,
    x: z.number(),
    y: z.number(),
    uiMapId: uiMapIdSchema.nullable(),
    lexemes: lexemesSchema,
  }),
  obj({
    space: z.literal('zone'),
    uiMapId: uiMapIdSchema,
    x: z.number(),
    y: z.number(),
    frame: z.enum(['forever', 'era']),
    lexemes: lexemesSchema,
  }),
]);

const instancePresenceSchema = obj({ kind: z.literal('instance'), areaId: areaIdSchema });

const unmappedAreaPointSchema = obj({
  kind: z.literal('unmapped'),
  areaId: areaIdSchema,
  x: z.number(),
  y: z.number(),
  reason: z.enum(['suppressed', 'no-uimap', 'instance-area']),
});

/** SourcedPoint is keyed by `space`, the other two by `kind`, so this is a plain union. */
export const publishedPointSchema = z.union(
  [sourcedPointSchema, z.discriminatedUnion('kind', [instancePresenceSchema, unmappedAreaPointSchema])],
  'Expected a point with space "world" or "zone", or kind "instance" or "unmapped"',
);

export const locationSchema = obj({
  source: sourcedPointSchema,
  label: z.string().nullable(),
  /** Only a positive radius is an arrival radius (docs/RXP.md §12.4 rule 7). */
  radius: positive().nullable(),
});

// ---------------------------------------------------------------------------------------------
// Conditions (src/domain/conditions.ts)

export const filterAstSchema = z.discriminatedUnion('kind', [
  obj({ kind: z.literal('word'), word: z.string() }),
  obj({ kind: z.literal('minLevel'), level: z.number() }),
  obj({
    kind: z.literal('not'),
    get expr(): z.ZodType<FilterAst> {
      return filterAstSchema;
    },
  }),
  obj({
    kind: z.literal('and'),
    get exprs(): z.ZodType<readonly FilterAst[]> {
      return arr(filterAstSchema);
    },
  }),
  obj({
    kind: z.literal('or'),
    get exprs(): z.ZodType<readonly FilterAst[]> {
      return arr(filterAstSchema);
    },
  }),
]);

const variantTagSchema = obj({
  name: z.string(),
  value: z.string().nullable(),
  filter: filterAstSchema.nullable(),
});

const statePredicateSchema = z.discriminatedUnion('kind', [
  obj({
    kind: z.literal('questState'),
    state: z.enum(['onQuest', 'complete', 'turnedIn', 'available']),
    questIds: arr(questIdSchema),
    match: z.enum(['any', 'all']),
    negate: z.boolean(),
  }),
  obj({ kind: z.literal('levelAtLeast'), level: z.number(), xp: z.number().nullable(), negate: z.boolean() }),
  obj({ kind: z.literal('opaque'), raw: z.string() }),
]);

export const stepConditionSchema = obj({
  filter: filterAstSchema.nullable(),
  variant: arr(variantTagSchema).nullable(),
  skipIf: arr(statePredicateSchema),
});

// ---------------------------------------------------------------------------------------------
// Dataset shapes used by custom quests (src/domain/dataset.ts)

export const entityRefSchema = z.discriminatedUnion('kind', [
  obj({ kind: z.literal('npc'), id: npcIdSchema }),
  obj({ kind: z.literal('object'), id: objectIdSchema }),
  obj({ kind: z.literal('item'), id: itemIdSchema }),
]);

const countSchema = posInt().nullable();

const objectiveDefSchema = z.discriminatedUnion('kind', [
  obj({ kind: z.literal('kill'), npcId: npcIdSchema, label: z.string().nullable(), count: countSchema }),
  obj({ kind: z.literal('object'), objectId: objectIdSchema, label: z.string().nullable(), count: countSchema }),
  obj({ kind: z.literal('item'), itemId: itemIdSchema, label: z.string().nullable(), count: countSchema }),
  obj({ kind: z.literal('reputation'), factionId: factionIdSchema, value: int() }),
  obj({
    kind: z.literal('killCredit'),
    npcIds: arr(npcIdSchema),
    rootNpcId: npcIdSchema,
    label: z.string().nullable(),
    count: countSchema,
  }),
  obj({
    kind: z.literal('spell'),
    spellId: spellIdSchema,
    itemId: itemIdSchema.nullable(),
    label: z.string().nullable(),
  }),
  obj({ kind: z.literal('event'), text: z.string().nullable(), points: arr(publishedPointSchema) }),
]);

const extraObjectiveSchema = obj({
  text: z.string().nullable(),
  objectiveIndex: nonNegInt().nullable(),
  points: arr(publishedPointSchema),
  refs: arr(entityRefSchema),
});

const questPrerequisitesSchema = obj({
  preQuestSingle: arr(questIdSchema),
  /** Signed quest ids (VAL-9), so plain integers rather than QuestIds. */
  preQuestGroup: arr(int()),
  exclusiveTo: arr(questIdSchema),
  nextQuestInChain: questIdSchema.nullable(),
  parentQuest: questIdSchema.nullable(),
  childQuests: arr(questIdSchema),
  inGroupWith: arr(questIdSchema),
  breadcrumbForQuestId: questIdSchema.nullable(),
  breadcrumbs: arr(questIdSchema),
  availableUntilCompleted: questIdSchema.nullable(),
  availableStartingWith: questIdSchema.nullable(),
  disabledByQuest: questIdSchema.nullable(),
});

const factionValueSchema = obj({ factionId: factionIdSchema, value: int() });

const questRequirementsSchema = obj({
  skill: obj({ skillId: skillIdSchema, value: int() }).nullable(),
  minReputation: factionValueSchema.nullable(),
  maxReputation: factionValueSchema.nullable(),
  spell: int().nullable(),
  specialization: int().nullable(),
  sourceItemId: itemIdSchema.nullable(),
  requiredSourceItems: arr(itemIdSchema),
});

export const questXpSchema = obj({
  questLevel: int(),
  baseXp: nonNeg(),
  basis: z.enum(['era-seed', 'user', 'forever-observed']),
});

export const customQuestSchema = obj({
  id: questIdSchema,
  name: z.string(),
  level: int().nullable(),
  minLevel: int().nullable(),
  maxLevel: int().nullable(),
  races: maskSchema,
  classes: maskSchema,
  zoneOrSort: int().nullable(),
  dungeonQuest: z.boolean(),
  starters: arr(entityRefSchema),
  finishers: arr(entityRefSchema),
  objectives: arr(objectiveDefSchema),
  objectiveHints: arr(extraObjectiveSchema),
  objectivesText: arr(z.string()).nullable(),
  prerequisites: questPrerequisitesSchema,
  requirements: questRequirementsSchema,
  reputationReward: arr(factionValueSchema),
  flags: obj({
    repeatable: z.boolean(),
    needsEvent: z.boolean(),
    questFlags: nonNegInt(),
    specialFlags: nonNegInt(),
  }),
  xp: questXpSchema.nullable(),
  provenance: obj({
    upstreamDiff: z.enum(['era', 'era-coords', 'forever-new', 'forever-changed']),
    foreverStatus: z.enum(['unknown', 'user-declared-new', 'user-declared-changed']),
    corrected: z.boolean(),
    created: z.boolean(),
    source: z.literal('custom'),
  }),
  starterLocation: locationSchema.nullable(),
  finisherLocation: locationSchema.nullable(),
});

export const questOverrideSchema = obj({
  xp: questXpSchema.nullable(),
  objectiveCounts: arr(nonNegInt().nullable()).nullable(),
  foreverStatus: z.enum(['user-declared-new', 'user-declared-changed']).nullable(),
});

// ---------------------------------------------------------------------------------------------
// Route (src/domain/route.ts)

const sourceLineRefSchema = obj({ importId: nonEmpty(), firstLine: posInt(), lastLine: posInt() });

const taxiNodeRefSchema = obj({
  npcId: npcIdSchema.nullable(),
  taxiNodeId: int().nullable(),
  name: z.string().nullable(),
});

const stepBaseShape = {
  id: stepIdSchema,
  location: locationSchema.nullable(),
  note: z.string().nullable(),
  locked: z.boolean(),
  groupId: groupIdSchema.nullable(),
  condition: stepConditionSchema.nullable(),
  durationOverride: nonNeg().nullable(),
  origin: obj({
    source: z.enum(['manual', 'rxp', 'optimizer', 'duplicate', 'paste']),
    ref: z.string().nullable(),
  }),
  rxp: obj({ text: z.string().nullable(), line: sourceLineRefSchema.nullable() }).nullable(),
  ext: extSchema.nullable(),
};

const questIdsOrNull = arr(questIdSchema).nullable();

const grindTargetSchema = z.discriminatedUnion('kind', [
  obj({
    kind: z.literal('level'),
    level: posInt(),
    offset: z
      .discriminatedUnion('kind', [
        obj({ kind: z.literal('xpInto'), xp: nonNeg() }),
        obj({ kind: z.literal('xpShort'), xp: nonNeg() }),
        obj({ kind: z.literal('fraction'), fraction: z.number().min(0).lt(1) }),
      ])
      .nullable(),
  }),
  obj({ kind: z.literal('duration'), seconds: nonNeg() }),
]);

export const routeStepSchema = z.discriminatedUnion('kind', [
  obj({ ...stepBaseShape, kind: z.literal('accept'), questId: questIdSchema, anyOf: questIdsOrNull, via: entityRefSchema.nullable() }),
  obj({
    ...stepBaseShape,
    kind: z.literal('complete'),
    targets: arr(obj({ questId: questIdSchema, objective: nonNegInt().nullable() })),
    progress: z.enum(['finish', 'partial']),
  }),
  obj({
    ...stepBaseShape,
    kind: z.literal('turnin'),
    questId: questIdSchema,
    anyOf: questIdsOrNull,
    rewardIndex: posInt().nullable(),
    skipIfMissing: z.boolean(),
    via: entityRefSchema.nullable(),
  }),
  obj({ ...stepBaseShape, kind: z.literal('abandon'), questId: questIdSchema }),
  obj({
    ...stepBaseShape,
    kind: z.literal('travel'),
    mode: z.enum(['auto', 'walk', 'mount', 'transport']),
    transport: obj({ id: z.string().nullable(), dock: locationSchema.nullable() }).nullable(),
  }),
  obj({
    ...stepBaseShape,
    kind: z.literal('grind'),
    until: grindTargetSchema,
    mobLevel: posInt().nullable(),
    xpPerHour: nonNeg().nullable(),
  }),
  obj({ ...stepBaseShape, kind: z.literal('hearth'), mode: z.enum(['use', 'bind']) }),
  obj({
    ...stepBaseShape,
    kind: z.literal('flight'),
    mode: z.enum(['take', 'discover']),
    from: taxiNodeRefSchema.nullable(),
    to: taxiNodeRefSchema.nullable(),
    nodeQuery: z.string().nullable(),
  }),
  obj({
    ...stepBaseShape,
    kind: z.literal('train'),
    spellId: spellIdSchema.nullable(),
    skill: z.enum(['riding', 'class', 'profession']).nullable(),
    skillId: skillIdSchema.nullable(),
    rank: posInt().nullable(),
    what: z.string().nullable(),
    cost: nonNeg().nullable(),
  }),
  obj({ ...stepBaseShape, kind: z.literal('vendor'), what: z.string().nullable() }),
  obj({
    ...stepBaseShape,
    kind: z.literal('note'),
    text: z.string(),
    preserved: obj({ format: z.literal('rxp'), lines: arr(z.string()) }).nullable(),
  }),
]);

const rxpGroupDataSchema = obj({
  importId: nonEmpty(),
  stepIndex: nonNegInt(),
  tags: arr(
    obj({
      name: z.string(),
      value: z.string().nullable(),
      assignment: z.boolean(),
      line: sourceLineRefSchema.nullable(),
    }),
  ),
  condition: stepConditionSchema.nullable(),
  waypoints: arr(
    obj({
      point: sourcedPointSchema,
      role: z.enum(['leg', 'pin', 'closest']),
      /** As written: positive, 0 or negative (docs/RXP.md §12.2). */
      radius: z.number().nullable(),
      filter: filterAstSchema.nullable(),
      line: sourceLineRefSchema.nullable(),
    }),
  ),
  annotations: arr(
    obj({
      command: z.string(),
      args: arr(z.string()),
      text: z.string().nullable(),
      filter: filterAstSchema.nullable(),
      line: sourceLineRefSchema.nullable(),
    }),
  ),
  fingerprint: sha256(),
});

export const routeGroupSchema = obj({ id: groupIdSchema, rxp: rxpGroupDataSchema.nullable() });

export const routeSchema = obj({
  id: routeIdSchema,
  name: z.string(),
  description: z.string(),
  steps: arr(routeStepSchema),
  groups: z.record(z.string().refine(notReserved, RESERVED_ID_MESSAGE), routeGroupSchema).readonly(),
});

// ---------------------------------------------------------------------------------------------
// Project (src/domain/project.ts, assumptions.ts)

export const characterProfileSchema = obj({
  faction: z.enum(['Alliance', 'Horde']),
  race: z.enum(RACE_TOKENS),
  class: z.enum(CLASS_TOKENS),
  sex: z.enum(['male', 'female']).nullable(),
  startLevel: posInt(),
  startXp: nonNegInt(),
  startLocation: locationSchema.nullable(),
  hearthLocation: locationSchema.nullable(),
  knownFlightPaths: arr(taxiNodeRefSchema),
  priorHistory: z.enum(['fresh', 'listed', 'unknown']),
  priorCompletedQuests: arr(questIdSchema),
  priorQuestLog: arr(questIdSchema),
  riding: z.literal([0, 1, 2]),
  professions: z.record(decimalKey(), nonNegInt()).readonly(),
  reputation: z.record(decimalKey(), int()).readonly().nullable(),
});

export const routeProfileSchema = obj({
  xpRate: positive(),
  season: int().nullable(),
  phase: int().nullable(),
  hardcore: z.boolean(),
  ssf: z.boolean(),
  dungeons: arr(z.string()),
  groupQuests: z.boolean(),
  xpStepSkipping: z.boolean(),
  locale: nonEmpty(),
});

/** Only overridden values are stored; an absent key means the ruleset value (§9.1). */
export const assumptionOverridesSchema = obj({
  groupSize: int().min(1).max(5).exactOptional(),
  groupXp: z.boolean().exactOptional(),
  maxLevel: posInt().exactOptional(),
  questLogCapacity: posInt().exactOptional(),
  runSpeedYps: positive().exactOptional(),
  travelDetourFactor: positive().exactOptional(),
  taxiSpeedYps: positive().exactOptional(),
  taxiDetourFactor: positive().exactOptional(),
  transportWaitSeconds: nonNeg().exactOptional(),
  transportRideSeconds: nonNeg().exactOptional(),
  interactionSeconds: nonNeg().exactOptional(),
  lootSeconds: nonNeg().exactOptional(),
  secondsPerKill: nonNeg().exactOptional(),
  killsPerObjective: nonNeg().exactOptional(),
  secondsPerObjective: nonNeg().exactOptional(),
  objectiveConcurrency: z.number().min(0).max(1).exactOptional(),
  questXpMultiplier: nonNeg().exactOptional(),
  dungeonQuestXpMultiplier: nonNeg().exactOptional(),
  killXpMultiplier: nonNeg().exactOptional(),
});

export const rxpImportSchema = obj({
  id: nonEmpty(),
  name: z.string(),
  sourceHash: sha256(),
  text: z.string(),
  options: obj({
    changedZoneFrame: z.enum(['forever', 'era']),
    lua: obj({ groupArg: z.string().nullable(), defaultFor: z.string().nullable() }).nullable(),
  }),
});

type Path = (string | number)[];

/** Reports every repeat of an id after its first occurrence. */
function reportDuplicates(
  ctx: z.core.$RefinementCtx,
  ids: readonly string[],
  path: (index: number) => Path,
  what: string,
): void {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) ctx.addIssue({ code: 'custom', message: `Duplicate ${what} "${id}"`, path: path(index) });
    seen.add(id);
  });
}

export const projectSchema = z
  .strictObject({
    schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
    game: z.literal('wow-forever'),
    gameBuild: nonEmpty(),
    dataRevision: nonEmpty(),
    rulesetId: z.enum(['forever-beta', 'era-1.15']),
    id: projectIdSchema,
    createdAt: isoTimestamp(),
    updatedAt: isoTimestamp(),
    route: routeSchema,
    character: characterProfileSchema,
    routeProfile: routeProfileSchema,
    assumptions: assumptionOverridesSchema,
    customQuests: arr(customQuestSchema),
    questOverrides: z.record(decimalKey(), questOverrideSchema).readonly(),
    imports: arr(rxpImportSchema),
    ext: extSchema,
  })
  .superRefine((project, ctx) => {
    // Referential integrity the types cannot express. A step's groupId naming a missing group
    // is allowed: cut, prune and paste can produce it, and validation reports it instead.
    const { steps, groups } = project.route;
    reportDuplicates(ctx, steps.map((s) => s.id), (i) => ['route', 'steps', i, 'id'], 'step id');
    for (const [key, group] of Object.entries(groups)) {
      if (group.id !== key) {
        ctx.addIssue({
          code: 'custom',
          message: `Group id "${group.id}" does not match its key "${key}"`,
          path: ['route', 'groups', key, 'id'],
        });
      }
    }
    reportDuplicates(
      ctx,
      project.customQuests.map((q) => String(q.id)),
      (i) => ['customQuests', i, 'id'],
      'custom quest id',
    );
    reportDuplicates(ctx, project.imports.map((imp) => imp.id), (i) => ['imports', i, 'id'], 'import id');
  })
  .readonly();
