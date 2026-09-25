import type { Chunk, Expression } from 'luaparse';
import { Evaluator, type Lint } from './evaluator';
import { bytesToLuaText, parseLua } from './lua-source';
import { describeValue, LuaTable, type LuaValue, ShapeError } from './lua-value';
import { runFile } from './sandbox';

/**
 * Reading QuestieDB's own Lua files: the enum constants (run), the schema meta files (run), and
 * literal tables inside files that are never run (config.lua, registry.lua, manifest.lua,
 * compat.lua), which are located by their assignment target and evaluated as pure literals.
 */

export type ReadInput = (path: string) => Buffer;

/** `config.enumFiles` order; `constants.lua` is the initializer and is emulated, not run. */
export const ENUM_INITIALIZER = 'src/corrections/enum/constants.lua';

/**
 * Runs the enum subject files (DATA_PROVENANCE §4.1) the way the addon loads them: each receives
 * `...` = ("QuestieDB", LibQuestieDB) with `LibQuestieDB.Enum = constants`, the table the
 * initializer `constants.lua` creates in its addon branch.
 */
export function evaluateEnums(read: ReadInput, enumFiles: readonly string[], lints: Lint[]): LuaTable {
  if (enumFiles[0] !== ENUM_INITIALIZER) throw new ShapeError('config.enumFiles', `must start with ${ENUM_INITIALIZER}`);
  const constants = new LuaTable();
  const lib = LuaTable.from([['Enum', constants]]);
  for (const file of enumFiles.slice(1)) {
    const result = runFile(file, read(file), new Map(), { varargs: ['QuestieDB', lib], locations: true });
    lints.push(...result.lints);
  }
  return constants;
}

/** Finds the value expression assigned to `target` (e.g. `config.ownedCorrections`) at top level. */
export function findTopLevelValue(chunk: Chunk, target: string, file: string): Expression {
  const matches: Expression[] = [];
  for (const statement of chunk.body) {
    if (statement.type === 'AssignmentStatement') {
      statement.variables.forEach((variable, index) => {
        const init = statement.init[index];
        if (init !== undefined && dotted(variable) === target) matches.push(init);
      });
    } else if (statement.type === 'LocalStatement') {
      statement.variables.forEach((variable, index) => {
        const init = statement.init[index];
        if (init !== undefined && variable.name === target) matches.push(init);
      });
    }
  }
  if (matches.length !== 1) throw new ShapeError(file, `expected exactly one top-level assignment to ${target}, found ${String(matches.length)}`);
  const [match] = matches;
  if (match === undefined) throw new ShapeError(file, `no assignment to ${target}`);
  return match;
}

function dotted(node: Expression): string | null {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && node.indexer === '.') {
    const base = dotted(node.base);
    return base === null ? null : `${base}.${node.identifier.name}`;
  }
  return null;
}

/** Evaluates `target`'s value in a file that is not run; any name or call in it fails closed. */
export function literalAssignment(read: ReadInput, file: string, target: string): LuaValue {
  const chunk = parseLua(bytesToLuaText(read(file), file), file, { locations: true });
  const lints: Lint[] = [];
  const value = new Evaluator({ file, globals: new Map(), varargs: [], lints }).expression(findTopLevelValue(chunk, target, file));
  if (lints.length > 0) throw new ShapeError(file, `duplicate keys in ${target}: ${lints.map((lint) => lint.detail).join('; ')}`);
  return value;
}

// ---------------------------------------------------------------------------------------------
// Schema meta files (src/meta/*Meta.lua)

export type StorageType = 'number' | 'string' | 'table';

export interface EntityMeta {
  readonly entity: string;
  readonly fieldCount: number;
  /** field name → index */
  readonly keys: ReadonlyMap<string, number>;
  /** index → storage type */
  readonly types: ReadonlyMap<number, StorageType>;
  /** index → structure name (questgivers, spawnlist, ...) */
  readonly structures: ReadonlyMap<number, string>;
  /** Deprecated constant fields (NPC 2/3): index → placeholder value. */
  readonly constantValues: ReadonlyMap<number, LuaValue>;
  /** Fields whose `{0, 0}` pair reads back as nil (quest 18-20). */
  readonly zeroPairIsNil: ReadonlySet<number>;
}

function numberMap(table: LuaValue, where: string): Map<number, LuaValue> {
  if (!(table instanceof LuaTable)) throw new ShapeError(where, 'expected a table');
  const out = new Map<number, LuaValue>();
  for (const [key, value] of table.entries()) {
    if (typeof key !== 'number') throw new ShapeError(where, `non-numeric key ${String(key)}`);
    out.set(key, value);
  }
  return out;
}

export function evaluateMeta(read: ReadInput, file: string): EntityMeta {
  const { value } = runFile(file, read(file), new Map(), { varargs: [], locations: true });
  if (!(value instanceof LuaTable)) throw new ShapeError(file, 'did not return the meta table');
  const entity = value.get('entity');
  const fieldCount = value.get('fieldCount');
  if (typeof entity !== 'string' || typeof fieldCount !== 'number') throw new ShapeError(file, 'meta.entity / meta.fieldCount missing');
  const keysTable = value.get('keys');
  if (!(keysTable instanceof LuaTable)) throw new ShapeError(file, 'meta.keys missing');
  const keys = new Map<string, number>();
  for (const [name, index] of keysTable.entries()) {
    if (typeof name !== 'string' || typeof index !== 'number') throw new ShapeError(file, 'meta.keys must map names to indices');
    keys.set(name, index);
  }
  const types = new Map<number, StorageType>();
  for (const [index, type] of numberMap(value.get('types'), `${file} meta.types`)) {
    if (type !== 'number' && type !== 'string' && type !== 'table') throw new ShapeError(file, `field ${String(index)} has storage type ${describeValue(type)}`);
    types.set(index, type);
  }
  const structures = new Map<number, string>();
  for (const [index, name] of numberMap(value.get('structures'), `${file} meta.structures`)) {
    if (typeof name !== 'string') throw new ShapeError(file, `structure of field ${String(index)} is not a name`);
    structures.set(index, name);
  }
  const constants = value.get('constantValues');
  const constantValues = constants === null ? new Map<number, LuaValue>() : numberMap(constants, `${file} meta.constantValues`);
  for (let index = 1; index <= fieldCount; index += 1) {
    if (!types.has(index)) throw new ShapeError(file, `field ${String(index)} has no storage type`);
  }
  const zeroPairs = value.get('zeroPairIsNil');
  const zeroPairIsNil = new Set<number>();
  if (zeroPairs !== null) {
    for (const [index, flag] of numberMap(zeroPairs, `${file} meta.zeroPairIsNil`)) if (flag === true) zeroPairIsNil.add(index);
  }
  return { entity, fieldCount, keys, types, structures, constantValues, zeroPairIsNil };
}

/** The key enum a data file or the enum constants declare must equal the schema meta's. */
export function assertKeysMatch(meta: EntityMeta, keys: LuaTable, where: string, allowMissing: boolean): void {
  const seen = new Set<string>();
  for (const [name, index] of keys.entries()) {
    if (typeof name !== 'string' || typeof index !== 'number') throw new ShapeError(where, 'key enum must map names to indices');
    const expected = meta.keys.get(name);
    if (expected !== index) throw new ShapeError(where, `key ${name} = ${String(index)}, schema says ${String(expected)}`);
    seen.add(name);
  }
  if (!allowMissing) {
    for (const name of meta.keys.keys()) if (!seen.has(name)) throw new ShapeError(where, `key ${name} missing from the key enum`);
  }
}
