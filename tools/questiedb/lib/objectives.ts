import { idList, isDeleteIdiom } from './corrections';
import { describeValue, LuaTable, type LuaValue, sequence, ShapeError } from './lua-value';
import { pointMap } from './points';
import type { HintSet } from './sandbox';
import type { EntityRefRow, ObjectiveHintRow, ObjectiveRow } from './shapes';

/**
 * Objectives in Questie's `ObjectiveData` order (DATA_PROVENANCE §6.2.1; Questie
 * Database/QuestieDB.lua:1735-1864 at 40016145): creature, object, item, reputation, killCredit,
 * spell, then the triggerEnd event. An element of a kind whose `*ObjectiveFirst` hint names the
 * quest is inserted at position 1 as it is processed (`tinsert(ObjectiveData, 1, x)`), so several
 * hinted elements of one kind end up at the front in reverse order. Upstream iterates the lists
 * with `pairs`; they are read here as sequences 1..n, and anything else fails closed.
 */

export type HintLookup = (set: HintSet, questId: number) => boolean;

function keysWithin(table: LuaTable, max: number, where: string): void {
  for (const key of table.keys()) {
    if (typeof key !== 'number' || !Number.isInteger(key) || key < 1 || key > max) throw new ShapeError(where, `unexpected key ${String(key)}`);
  }
}

const optionalString = (value: LuaValue, where: string): string | null => {
  if (value === null) return null;
  if (typeof value !== 'string') throw new ShapeError(where, `expected text, got ${describeValue(value)}`);
  return value;
};

const requiredInt = (value: LuaValue, where: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new ShapeError(where, `expected an integer id, got ${describeValue(value)}`);
  return value;
};

const optionalInt = (value: LuaValue, where: string): number | null => (value === null ? null : requiredInt(value, where));

/** An optional id where upstream writes 0 for none (DATA_PROVENANCE §6, "0 → null"). */
const optionalId = (value: LuaValue, where: string): number | null => {
  const id = optionalInt(value, where);
  if (id !== null && id < 0) throw new ShapeError(where, `expected a positive id or 0 (none), got ${String(id)}`);
  return id === 0 ? null : id;
};

const optionalNumber = (value: LuaValue, where: string): number | null => {
  if (value === null) return null;
  if (typeof value !== 'number') throw new ShapeError(where, `expected a number, got ${describeValue(value)}`);
  return value;
};

/** A group of elements (objectives slot 1, 2, 3, 5 or 6): nil, `{}` or a sequence of tables. */
function elements(group: LuaValue, where: string): readonly LuaTable[] {
  if (group === null || isDeleteIdiom(group)) return [];
  if (!(group instanceof LuaTable)) throw new ShapeError(where, `expected a list, got ${describeValue(group)}`);
  return sequence(group, where).map((element, index) => {
    if (!(element instanceof LuaTable)) throw new ShapeError(`${where}[${String(index + 1)}]`, `expected a table, got ${describeValue(element)}`);
    return element;
  });
}

/**
 * Builds the objective list of one quest from its objectives (field 10) and triggerEnd (field 9).
 * Labels are the upstream text slots; counts are always null (QuestieDB stores none); icon types
 * are not shipped.
 */
export function buildObjectives(questId: number, objectives: LuaValue, triggerEnd: LuaValue, hinted: HintLookup): readonly ObjectiveRow[] {
  const where = `quest ${String(questId)} objectives`;
  const list: ObjectiveRow[] = [];
  const add = (row: ObjectiveRow, first: boolean): void => {
    if (first) list.unshift(row);
    else list.push(row);
  };
  if (objectives !== null && !isDeleteIdiom(objectives)) {
    if (!(objectives instanceof LuaTable)) throw new ShapeError(where, `expected a table, got ${describeValue(objectives)}`);
    keysWithin(objectives, 6, where);
    for (const [index, element] of elements(objectives.get(1), `${where}[1]`).entries()) {
      const at = `${where}[1][${String(index + 1)}]`;
      keysWithin(element, 3, at);
      add({ kind: 'kill', npcId: requiredInt(element.get(1), at), label: optionalString(element.get(2), at), count: null }, false);
    }
    for (const [index, element] of elements(objectives.get(2), `${where}[2]`).entries()) {
      const at = `${where}[2][${String(index + 1)}]`;
      keysWithin(element, 3, at);
      add({ kind: 'object', objectId: requiredInt(element.get(1), at), label: optionalString(element.get(2), at), count: null }, hinted('objectObjectiveFirst', questId));
    }
    for (const [index, element] of elements(objectives.get(3), `${where}[3]`).entries()) {
      const at = `${where}[3][${String(index + 1)}]`;
      keysWithin(element, 3, at);
      add({ kind: 'item', itemId: requiredInt(element.get(1), at), label: optionalString(element.get(2), at), count: null }, hinted('itemObjectiveFirst', questId));
    }
    const reputation = objectives.get(4);
    if (reputation !== null && reputation !== false) {
      const at = `${where}[4]`;
      if (!(reputation instanceof LuaTable)) throw new ShapeError(at, `expected a {factionId, value} pair, got ${describeValue(reputation)}`);
      keysWithin(reputation, 2, at);
      const value = reputation.get(2);
      if (typeof value !== 'number') throw new ShapeError(at, 'reputation value must be a number');
      add({ kind: 'reputation', factionId: requiredInt(reputation.get(1), at), value }, false);
    }
    // `objectives[5] and type(...) == "table" and #objectives[5] > 0`
    for (const [index, element] of elements(objectives.get(5), `${where}[5]`).entries()) {
      const at = `${where}[5][${String(index + 1)}]`;
      keysWithin(element, 4, at);
      const npcIds = idList(element.get(1), `${at}[1]`);
      add(
        { kind: 'killCredit', npcIds, rootNpcId: requiredInt(element.get(2), `${at}[2]`), label: optionalString(element.get(3), at), count: null },
        hinted('killCreditObjectiveFirst', questId),
      );
    }
    for (const [index, element] of elements(objectives.get(6), `${where}[6]`).entries()) {
      const at = `${where}[6][${String(index + 1)}]`;
      keysWithin(element, 3, at);
      add(
        { kind: 'spell', spellId: requiredInt(element.get(1), at), itemId: optionalId(element.get(3), at), label: optionalString(element.get(2), at) },
        hinted('spellObjectiveFirst', questId),
      );
    }
  }
  if (triggerEnd !== null && !isDeleteIdiom(triggerEnd)) {
    const at = `quest ${String(questId)} triggerEnd`;
    if (!(triggerEnd instanceof LuaTable)) throw new ShapeError(at, `expected {text, spawns}, got ${describeValue(triggerEnd)}`);
    keysWithin(triggerEnd, 2, at);
    add({ kind: 'event', text: optionalString(triggerEnd.get(1), at), points: pointMap(triggerEnd.get(2), `${at} points`) ?? {} }, hinted('eventObjectiveFirst', questId));
  }
  return list;
}

const REF_KINDS: Readonly<Record<string, EntityRefRow['kind']>> = { monster: 'npc', object: 'object', item: 'item' };

/** extraObjectives (field 29): `{{spawnlist?, iconType, text?, objectiveIndex, refs?}, ...}`. Never counted. */
export function buildObjectiveHints(questId: number, extraObjectives: LuaValue): readonly ObjectiveHintRow[] {
  const where = `quest ${String(questId)} extraObjectives`;
  return elements(extraObjectives, where).map((row, index): ObjectiveHintRow => {
    const at = `${where}[${String(index + 1)}]`;
    keysWithin(row, 5, at);
    optionalNumber(row.get(2), `${at} icon`);
    const refs = elements(row.get(5), `${at} refs`).map((ref, refIndex): EntityRefRow => {
      const refAt = `${at} refs[${String(refIndex + 1)}]`;
      keysWithin(ref, 2, refAt);
      const kindName = ref.get(1);
      const kind = typeof kindName === 'string' ? REF_KINDS[kindName] : undefined;
      if (kind === undefined) throw new ShapeError(refAt, `unknown reference kind ${describeValue(kindName)}`);
      return { kind, id: requiredInt(ref.get(2), refAt) };
    });
    return {
      text: optionalString(row.get(3), at),
      objectiveIndex: optionalInt(row.get(4), `${at} objectiveIndex`),
      points: pointMap(row.get(1), `${at} points`) ?? {},
      refs,
    };
  });
}
