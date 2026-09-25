import { bytesToLuaText } from './lua-source';
import { describeValue, LuaTable, type LuaValue, ShapeError } from './lua-value';
import { runFile, supportEnvironment } from './sandbox';
import { assertKeysMatch, type EntityMeta } from './upstream-lua';

/**
 * Raw entity rows (DATA_PROVENANCE §4.1; research/questiedb-schema.md §2). Each data file assigns a
 * key enum and one long string `QuestieDB.<type>Data = [[return { [id] = {...}, ... }]]`. The file
 * is run in the support environment; the string is then parsed and run as its own chunk, which
 * the whitelist restricts to one `return` of literal tables.
 */

export type EntityKind = 'quest' | 'npc' | 'object' | 'item';

export const ENTITY_TYPES: Readonly<Record<EntityKind, { readonly datatype: 'Quest' | 'Npc' | 'Object' | 'Item'; readonly keysField: string; readonly dataField: string; readonly fileSuffix: string }>> = {
  quest: { datatype: 'Quest', keysField: 'questKeys', dataField: 'questData', fileSuffix: 'QuestDB' },
  npc: { datatype: 'Npc', keysField: 'npcKeys', dataField: 'npcData', fileSuffix: 'NpcDB' },
  object: { datatype: 'Object', keysField: 'objectKeys', dataField: 'objectData', fileSuffix: 'ObjectDB' },
  item: { datatype: 'Item', keysField: 'itemKeys', dataField: 'itemData', fileSuffix: 'ItemDB' },
};

export const ENTITY_KINDS: readonly EntityKind[] = ['quest', 'npc', 'object', 'item'];

/** id → row (field index → value) */
export type Rows = Map<number, LuaTable>;

export function dataFilePath(expansionDir: string, prefix: string, kind: EntityKind): string {
  return `data/${expansionDir}/${prefix}${ENTITY_TYPES[kind].fileSuffix}.lua`;
}

/** Checks one field value against the schema's storage type (fails closed on a mismatch). */
export function assertFieldType(meta: EntityMeta, where: string, index: number, value: LuaValue): void {
  const type = meta.types.get(index);
  if (type === undefined) throw new ShapeError(where, `field ${String(index)} is outside the ${meta.entity} schema (1..${String(meta.fieldCount)})`);
  const actual = value instanceof LuaTable ? 'table' : typeof value;
  if (actual !== type) throw new ShapeError(where, `field ${String(index)} is ${describeValue(value)}, schema says ${type}`);
}

export function readEntityFile(file: string, bytes: Uint8Array, kind: EntityKind, meta: EntityMeta, rules: string): Rows {
  const type = ENTITY_TYPES[kind];
  const env = supportEnvironment(rules);
  runFile(file, bytes, env.globals, { locations: true });
  const module = env.module('QuestieDB');
  const keys = module.get(type.keysField);
  if (!(keys instanceof LuaTable)) throw new ShapeError(file, `no ${type.keysField} table`);
  // The item file's enum omits teachesSpell (16), which only corrections write (schema.lua:15).
  assertKeysMatch(meta, keys, `${file} ${type.keysField}`, true);
  const payload = module.get(type.dataField);
  if (typeof payload !== 'string') throw new ShapeError(file, `${type.dataField} is not a deferred string`);
  // The payload was decoded as UTF-8 by the evaluator; its Lua source is the UTF-8 bytes again.
  const result = runFile(`${file} (${type.dataField})`, bytesToLuaText(Buffer.from(payload, 'utf8'), file), new Map(), {});
  if (result.lints.length > 0) throw new ShapeError(file, `duplicate row ids: ${result.lints.map((lint) => lint.detail).join('; ')}`);
  const table = result.value;
  if (!(table instanceof LuaTable)) throw new ShapeError(file, `${type.dataField} does not return a table`);
  const declared = new Set<number>();
  for (const [, index] of keys.entries()) if (typeof index === 'number') declared.add(index);
  const rows: Rows = new Map();
  for (const [id, row] of table.entries()) {
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) throw new ShapeError(file, `row key ${String(id)} is not a positive integer id`);
    if (!(row instanceof LuaTable)) throw new ShapeError(file, `row ${String(id)} is not a table`);
    for (const [index, value] of row.entries()) {
      if (typeof index !== 'number' || !declared.has(index)) throw new ShapeError(`${file} row ${String(id)}`, `field ${String(index)} is not in the file's key enum`);
      assertFieldType(meta, `${file} row ${String(id)}`, index, value);
    }
    rows.set(id, row);
  }
  return rows;
}
