/**
 * The Lua value model of the whitelisted evaluator (D-009). Lua tables are one key space: an
 * integer key written positionally (`{a, b}`) and one written as `[1] = a` are the same key,
 * `nil` is never stored, and an empty table is distinct from `nil` (QuestieDB's `{}` delete idiom
 * relies on that until projection).
 */

export type LuaKey = number | string | boolean;

/** A callable value. Script functions and host functions share this one shape. */
export interface LuaFunction {
  readonly kind: 'function';
  readonly name: string;
  readonly invoke: (args: readonly LuaValue[]) => LuaValue;
  /**
   * True only when the upstream function it stands in for returns exactly one value, so a call in a
   * position where Lua expands every return value (last table field, last argument) is safe.
   */
  readonly singleValued: boolean;
}

export type LuaValue = null | boolean | number | string | LuaTable | LuaFunction;

export class LuaTable {
  readonly #entries = new Map<LuaKey, Exclude<LuaValue, null>>();

  /** Lua semantics: reading an absent key gives nil. */
  get(key: LuaKey): LuaValue {
    return this.#entries.get(normaliseKey(key)) ?? null;
  }

  has(key: LuaKey): boolean {
    return this.#entries.has(normaliseKey(key));
  }

  /** Lua semantics: assigning nil removes the key. */
  set(key: LuaKey, value: LuaValue): void {
    const k = normaliseKey(key);
    if (value === null) this.#entries.delete(k);
    else this.#entries.set(k, value);
  }

  get size(): number {
    return this.#entries.size;
  }

  isEmpty(): boolean {
    return this.#entries.size === 0;
  }

  /** Keys in a deterministic order: numbers ascending, then strings (code-unit order), then booleans. */
  keys(): readonly LuaKey[] {
    return [...this.#entries.keys()].sort(compareKeys);
  }

  entries(): readonly (readonly [LuaKey, Exclude<LuaValue, null>])[] {
    return this.keys().map((key) => [key, this.#entries.get(key) as Exclude<LuaValue, null>] as const);
  }

  /** Entries in insertion order; only for order-independent work such as equality tests. */
  unorderedEntries(): IterableIterator<[LuaKey, Exclude<LuaValue, null>]> {
    return this.#entries.entries();
  }

  /** A shallow copy (field values are shared, as Lua assignment shares them). */
  clone(): LuaTable {
    const copy = new LuaTable();
    for (const [key, value] of this.#entries) copy.#entries.set(key, value);
    return copy;
  }

  static from(entries: Iterable<readonly [LuaKey, LuaValue]>): LuaTable {
    const table = new LuaTable();
    for (const [key, value] of entries) table.set(key, value);
    return table;
  }

  /** Positional table `{v1, v2, ...}`; nulls become holes. */
  static list(values: readonly LuaValue[]): LuaTable {
    const table = new LuaTable();
    values.forEach((value, index) => table.set(index + 1, value));
    return table;
  }
}

function normaliseKey(key: LuaKey): LuaKey {
  if (typeof key === 'number') {
    if (Number.isNaN(key)) throw new Error('table index is NaN');
    if (Object.is(key, -0)) return 0;
  }
  return key;
}

const KEY_RANK = { number: 0, string: 1, boolean: 2 } as const;

export function compareKeys(a: LuaKey, b: LuaKey): number {
  const ra = KEY_RANK[typeof a as 'number' | 'string' | 'boolean'];
  const rb = KEY_RANK[typeof b as 'number' | 'string' | 'boolean'];
  if (ra !== rb) return ra - rb;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = String(a);
  const sb = String(b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

export const isTable = (value: LuaValue): value is LuaTable => value instanceof LuaTable;

export function describeValue(value: LuaValue): string {
  if (value === null) return 'nil';
  if (value instanceof LuaTable) return value.isEmpty() ? 'empty table' : 'table';
  if (typeof value === 'object') return 'function';
  return typeof value;
}

/** Thrown whenever data does not have the shape the extractor was written for (fail closed). */
export class ShapeError extends Error {
  constructor(where: string, message: string) {
    super(`${where}: ${message}`);
    this.name = 'ShapeError';
  }
}

/**
 * The values of a Lua sequence `1..n`. Fails closed on any other key (a hole, a string key, a
 * non-integer key), because `pairs` order over such a table is unspecified in Lua.
 */
export function sequence(table: LuaTable, where: string): readonly Exclude<LuaValue, null>[] {
  const out: Exclude<LuaValue, null>[] = [];
  const n = table.size;
  for (let i = 1; i <= n; i += 1) {
    const value = table.get(i);
    if (value === null) throw new ShapeError(where, `expected a sequence 1..${String(n)}, but key ${String(i)} is missing`);
    out.push(value);
  }
  return out;
}

/** Deep structural equality of Lua values (tables compared by content, functions by identity). */
export function luaEqual(a: LuaValue, b: LuaValue): boolean {
  if (a === b) return true;
  if (!(a instanceof LuaTable) || !(b instanceof LuaTable)) return false;
  if (a.size !== b.size) return false;
  for (const [key, value] of a.unorderedEntries()) {
    if (!b.has(key)) return false;
    if (!luaEqual(value, b.get(key))) return false;
  }
  return true;
}

/** A plain JSON-able rendering for reports and error messages (tables as `{ "k": v }`). */
export function toPlain(value: LuaValue): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof LuaTable) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of value.entries()) out[String(key)] = toPlain(v);
    return out;
  }
  return `<function ${value.name}>`;
}
