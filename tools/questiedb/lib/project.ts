import { idList, isDeleteIdiom } from './corrections';
import { describeValue, LuaTable, type LuaValue, sequence, ShapeError } from './lua-value';
import { buildObjectiveHints, buildObjectives, type HintLookup } from './objectives';
import { pointMap } from './points';
import type { QuestXpRow } from './questxp';
import type { Transcription } from './semantics';
import type { EntityRefRow, ItemRow, NpcRow, ObjectRow, PointMap, PrerequisitesRow, QuestRow, RequirementsRow } from './shapes';

/**
 * Projection of composed upstream rows onto the shipped fields (DATA_PROVENANCE §6). Absent
 * upstream values become null (or [] for lists), never QuestieDB's pad-to-0; `{}` (the delete
 * idiom) reads as absent; `{0,0}` pairs of fields 18-20 read as absent, as the read contract says.
 * A single-id field where upstream writes 0 for "none" becomes null too (DATA_PROVENANCE §6
 * "0 → null"; review findings code-F8, data-F13), so a shipped id is never 0. Masks are tested
 * arithmetically (D-012).
 */

export type Unprovenanced<T> = Omit<T, 'provenance'>;

/** Upstream behaviour transcribed here, with the blob it was written against (lib/semantics.ts). */
export const TRANSCRIBES: readonly Transcription[] = [
  {
    path: 'src/meta/normalize.lua',
    sha256: '9047cb03c21dd5f26e007d07ee0f700dab0b20149484e5ee5ba4504e266b131b',
    what: 'normalize.field ({} and {0, 0} pairs of fields 18-20 read as nil); its pad-to-0 is deliberately not reproduced',
  },
];

// Field indices (src/meta/*Meta.lua at the pin; the tool checks the key enums against them).
export const Q = {
  name: 1, startedBy: 2, finishedBy: 3, requiredLevel: 4, questLevel: 5, requiredRaces: 6, requiredClasses: 7, objectivesText: 8,
  triggerEnd: 9, objectives: 10, sourceItemId: 11, preQuestGroup: 12, preQuestSingle: 13, childQuests: 14, inGroupWith: 15,
  exclusiveTo: 16, zoneOrSort: 17, requiredSkill: 18, requiredMinRep: 19, requiredMaxRep: 20, requiredSourceItems: 21,
  nextQuestInChain: 22, questFlags: 23, specialFlags: 24, parentQuest: 25, reputationReward: 26, breadcrumbForQuestId: 27,
  breadcrumbs: 28, extraObjectives: 29, requiredSpell: 30, requiredSpecialization: 31, requiredMaxLevel: 32,
  availableUntilCompleted: 33, availableStartingWith: 34, requiredRanks: 35, disabledByQuest: 36,
} as const;
export const N = { name: 1, minLevel: 4, maxLevel: 5, rank: 6, spawns: 7, waypoints: 8, zoneID: 9, questStarts: 10, questEnds: 11, factionID: 12, friendlyToFaction: 13, subName: 14, npcFlags: 15 } as const;
export const O = { name: 1, questStarts: 2, questEnds: 3, spawns: 4, zoneID: 5, factionID: 6, waypoints: 7 } as const;
export const I = { name: 1, npcDrops: 2, objectDrops: 3, itemDrops: 4, startQuest: 5, class: 12 } as const;

/** The field-key names the projection relies on, checked against the schema meta at extraction. */
export const PROJECTED_KEYS = {
  quest: Q,
  npc: N,
  object: O,
  item: { name: 1, npcDrops: 2, objectDrops: 3, itemDrops: 4, startQuest: 5, class: 12 },
} as const;

/** D-012: `Math.floor(mask / 2 ** bit) % 2 === 1`, never `&` (masks exceed 32 bits). */
export const hasBit = (mask: number, bit: number): boolean => Math.floor(mask / 2 ** bit) % 2 === 1;

const at = (kind: string, id: number, field: number): string => `${kind} ${String(id)} field ${String(field)}`;

function value(row: LuaTable, field: number): LuaValue {
  const v = row.get(field);
  return isDeleteIdiom(v) ? null : v;
}

function num(row: LuaTable, field: number, where: string): number | null {
  const v = value(row, field);
  if (v === null) return null;
  if (typeof v !== 'number') throw new ShapeError(where, `expected a number, got ${describeValue(v)}`);
  return v;
}

function int(row: LuaTable, field: number, where: string): number | null {
  const v = num(row, field, where);
  if (v !== null && !Number.isInteger(v)) throw new ShapeError(where, `expected an integer, got ${String(v)}`);
  return v;
}

function text(row: LuaTable, field: number, where: string): string | null {
  const v = value(row, field);
  if (v === null) return null;
  if (typeof v !== 'string') throw new ShapeError(where, `expected a string, got ${describeValue(v)}`);
  return v;
}

function name(row: LuaTable, field: number, where: string): string {
  const v = text(row, field, where);
  if (v === null) throw new ShapeError(where, 'record has no name');
  return v;
}

/**
 * A single id where upstream writes 0 for none (DATA_PROVENANCE §6, "0 → null"): nil, `{}` and 0
 * read as null; a negative value fails closed, since these fields hold positive ids only.
 */
function idOrNull(row: LuaTable, field: number, where: string): number | null {
  const v = int(row, field, where);
  if (v === null || v === 0) return null;
  if (v < 0) throw new ShapeError(where, `expected a positive id or 0 (none), got ${String(v)}`);
  return v;
}

/** A signed single id (the sign carries meaning) where upstream writes 0 for none: 0 reads as null. */
function signedIdOrNull(row: LuaTable, field: number, where: string): number | null {
  const v = int(row, field, where);
  return v === 0 ? null : v;
}

const ids = (row: LuaTable, field: number, where: string): readonly number[] => idList(value(row, field), where);

function stringList(row: LuaTable, field: number, where: string): readonly string[] | null {
  const v = value(row, field);
  if (v === null) return null;
  if (!(v instanceof LuaTable)) throw new ShapeError(where, `expected a list of strings, got ${describeValue(v)}`);
  return sequence(v, where).map((item) => {
    if (typeof item !== 'string') throw new ShapeError(where, `list element ${describeValue(item)} is not a string`);
    return item;
  });
}

/** A `{a, b}` pair of fields 18-20; nil, `{}` and `{0, 0}` read as absent. */
function pair(row: LuaTable, field: number, where: string): readonly [number, number] | null {
  const v = value(row, field);
  if (v === null) return null;
  if (!(v instanceof LuaTable)) throw new ShapeError(where, `expected a pair, got ${describeValue(v)}`);
  const a = v.get(1);
  const b = v.get(2);
  if ((a === null || a === 0) && (b === null || b === 0)) return null;
  for (const key of v.keys()) if (key !== 1 && key !== 2) throw new ShapeError(where, `pair has key ${String(key)}`);
  if (typeof a !== 'number' || typeof b !== 'number') throw new ShapeError(where, 'pair must hold two numbers');
  return [a, b];
}

function pairList(row: LuaTable, field: number, where: string): readonly { readonly factionId: number; readonly value: number }[] {
  const v = value(row, field);
  if (v === null) return [];
  if (!(v instanceof LuaTable)) throw new ShapeError(where, `expected a list of pairs, got ${describeValue(v)}`);
  return sequence(v, where).map((entry) => {
    if (!(entry instanceof LuaTable) || entry.size !== 2) throw new ShapeError(where, 'expected {factionId, value}');
    const [factionId, amount] = sequence(entry, where);
    if (typeof factionId !== 'number' || !Number.isInteger(factionId) || typeof amount !== 'number') throw new ShapeError(where, 'expected {factionId, value} numbers');
    return { factionId, value: amount };
  });
}

/** questgivers: `{npcIds?, objectIds?, itemIds?}` → refs in kind order, then upstream order. */
function givers(row: LuaTable, field: number, kinds: readonly EntityRefRow['kind'][], where: string): readonly EntityRefRow[] {
  const v = value(row, field);
  if (v === null) return [];
  if (!(v instanceof LuaTable)) throw new ShapeError(where, `expected {npcs, objects, items}, got ${describeValue(v)}`);
  for (const key of v.keys()) {
    if (typeof key !== 'number' || !Number.isInteger(key) || key < 1 || key > kinds.length) throw new ShapeError(where, `unexpected slot ${String(key)}`);
  }
  const out: EntityRefRow[] = [];
  kinds.forEach((kind, index) => {
    for (const id of idList(v.get(index + 1), `${where}[${String(index + 1)}]`)) out.push({ kind, id });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------

export interface QuestContext {
  readonly hinted: HintLookup;
  readonly xp: ReadonlyMap<number, QuestXpRow>;
  /** dungeons.lua keys and alternative AreaIds, minus the non-dungeon exclusions (§6.2). */
  readonly dungeonAreas: ReadonlySet<number>;
}

export function projectQuest(id: number, row: LuaTable, ctx: QuestContext): Unprovenanced<QuestRow> {
  const w = (field: number): string => at('quest', id, field);
  const zoneOrSort = signedIdOrNull(row, Q.zoneOrSort, w(Q.zoneOrSort));
  const specialFlags = int(row, Q.specialFlags, w(Q.specialFlags)) ?? 0;
  const skill = pair(row, Q.requiredSkill, w(Q.requiredSkill));
  const minRep = pair(row, Q.requiredMinRep, w(Q.requiredMinRep));
  const maxRep = pair(row, Q.requiredMaxRep, w(Q.requiredMaxRep));
  const prerequisites: PrerequisitesRow = {
    preQuestSingle: ids(row, Q.preQuestSingle, w(Q.preQuestSingle)),
    preQuestGroup: ids(row, Q.preQuestGroup, w(Q.preQuestGroup)),
    exclusiveTo: ids(row, Q.exclusiveTo, w(Q.exclusiveTo)),
    nextQuestInChain: idOrNull(row, Q.nextQuestInChain, w(Q.nextQuestInChain)),
    parentQuest: idOrNull(row, Q.parentQuest, w(Q.parentQuest)),
    childQuests: ids(row, Q.childQuests, w(Q.childQuests)),
    inGroupWith: ids(row, Q.inGroupWith, w(Q.inGroupWith)),
    breadcrumbForQuestId: idOrNull(row, Q.breadcrumbForQuestId, w(Q.breadcrumbForQuestId)),
    breadcrumbs: ids(row, Q.breadcrumbs, w(Q.breadcrumbs)),
    availableUntilCompleted: idOrNull(row, Q.availableUntilCompleted, w(Q.availableUntilCompleted)),
    availableStartingWith: idOrNull(row, Q.availableStartingWith, w(Q.availableStartingWith)),
    disabledByQuest: idOrNull(row, Q.disabledByQuest, w(Q.disabledByQuest)),
  };
  const requirements: RequirementsRow = {
    skill: skill === null ? null : { skillId: skill[0], value: skill[1] },
    minReputation: minRep === null ? null : { factionId: minRep[0], value: minRep[1] },
    maxReputation: maxRep === null ? null : { factionId: maxRep[0], value: maxRep[1] },
    spell: signedIdOrNull(row, Q.requiredSpell, w(Q.requiredSpell)),
    specialization: idOrNull(row, Q.requiredSpecialization, w(Q.requiredSpecialization)),
    sourceItemId: idOrNull(row, Q.sourceItemId, w(Q.sourceItemId)),
    requiredSourceItems: ids(row, Q.requiredSourceItems, w(Q.requiredSourceItems)),
  };
  const xp = ctx.xp.get(id);
  return {
    id,
    name: name(row, Q.name, w(Q.name)),
    level: int(row, Q.questLevel, w(Q.questLevel)),
    minLevel: int(row, Q.requiredLevel, w(Q.requiredLevel)),
    maxLevel: int(row, Q.requiredMaxLevel, w(Q.requiredMaxLevel)),
    races: int(row, Q.requiredRaces, w(Q.requiredRaces)),
    classes: int(row, Q.requiredClasses, w(Q.requiredClasses)),
    zoneOrSort,
    dungeonQuest: zoneOrSort !== null && zoneOrSort > 0 && ctx.dungeonAreas.has(zoneOrSort),
    starters: givers(row, Q.startedBy, ['npc', 'object', 'item'], w(Q.startedBy)),
    finishers: givers(row, Q.finishedBy, ['npc', 'object'], w(Q.finishedBy)),
    objectives: buildObjectives(id, row.get(Q.objectives), row.get(Q.triggerEnd), ctx.hinted),
    objectiveHints: buildObjectiveHints(id, row.get(Q.extraObjectives)),
    objectivesText: stringList(row, Q.objectivesText, w(Q.objectivesText)),
    prerequisites,
    requirements,
    reputationReward: pairList(row, Q.reputationReward, w(Q.reputationReward)),
    flags: {
      repeatable: hasBit(specialFlags, 0),
      needsEvent: hasBit(specialFlags, 1),
      questFlags: int(row, Q.questFlags, w(Q.questFlags)) ?? 0,
      specialFlags,
    },
    xp: xp === undefined ? null : { questLevel: xp.questLevel, baseXp: xp.baseXp, basis: 'era-seed' },
  };
}

function friendly(row: LuaTable, id: number): NpcRow['friendlyTo'] {
  const v = text(row, N.friendlyToFaction, at('npc', id, N.friendlyToFaction));
  if (v === null || v === '') return null;
  if (v === 'A' || v === 'H' || v === 'AH') return v;
  throw new ShapeError(at('npc', id, N.friendlyToFaction), `unknown faction value ${JSON.stringify(v)}`);
}

export interface WithSpawns<T> {
  readonly record: Unprovenanced<T>;
  readonly spawns: PointMap | null;
}

export function projectNpc(id: number, row: LuaTable): WithSpawns<NpcRow> {
  const w = (field: number): string => at('npc', id, field);
  return {
    record: {
      id,
      name: name(row, N.name, w(N.name)),
      subName: text(row, N.subName, w(N.subName)),
      minLevel: int(row, N.minLevel, w(N.minLevel)),
      maxLevel: int(row, N.maxLevel, w(N.maxLevel)),
      rank: int(row, N.rank, w(N.rank)),
      zoneId: idOrNull(row, N.zoneID, w(N.zoneID)),
      npcFlags: int(row, N.npcFlags, w(N.npcFlags)) ?? 0,
      friendlyTo: friendly(row, id),
      questStarts: ids(row, N.questStarts, w(N.questStarts)),
      questEnds: ids(row, N.questEnds, w(N.questEnds)),
    },
    spawns: pointMap(row.get(N.spawns), w(N.spawns)),
  };
}

export function projectObject(id: number, row: LuaTable): WithSpawns<ObjectRow> {
  const w = (field: number): string => at('object', id, field);
  return {
    record: {
      id,
      name: name(row, O.name, w(O.name)),
      zoneId: idOrNull(row, O.zoneID, w(O.zoneID)),
      factionId: idOrNull(row, O.factionID, w(O.factionID)),
      questStarts: ids(row, O.questStarts, w(O.questStarts)),
      questEnds: ids(row, O.questEnds, w(O.questEnds)),
    },
    spawns: pointMap(row.get(O.spawns), w(O.spawns)),
  };
}

export function projectItem(id: number, row: LuaTable): Unprovenanced<ItemRow> {
  const w = (field: number): string => at('item', id, field);
  return {
    id,
    name: name(row, I.name, w(I.name)),
    itemClass: int(row, I.class, w(I.class)),
    dropNpcs: ids(row, I.npcDrops, w(I.npcDrops)),
    dropObjects: ids(row, I.objectDrops, w(I.objectDrops)),
    dropItems: ids(row, I.itemDrops, w(I.itemDrops)),
    startsQuest: idOrNull(row, I.startQuest, w(I.startQuest)),
  };
}

/** NPC flag bits that select an NPC for entities.json on their own (§6.3; Era npcFlags). */
export const NPC_FLAG_BITS = { flightMaster: 3, trainer: 4, innkeeper: 7 } as const;
