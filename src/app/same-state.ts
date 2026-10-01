import type { ReadonlyCharacterState } from '../engine/types';

/**
 * Whether two character states are the same value (review F-01): every field equal, the maps and
 * sets with the same entries in the same order, and nested records compared field by field. The
 * pipeline uses it to keep the quest state at the end of the route when an edit leaves that state
 * as it was (a note, a step's own text), so the classification is not redone for nothing.
 *
 * Conservative by construction: anything it cannot compare as a value (a function, a class
 * instance other than Map, Set or Array, an object with another prototype) counts as different, so
 * a doubt only costs a rebuild, never a stale state. Order matters too, as the quest log's order is
 * what the panels list.
 */
export function sameCharacterState(a: ReadonlyCharacterState, b: ReadonlyCharacterState): boolean {
  return a === b || sameValue(a, b);
}

/**
 * Whether two character states are the same value in every field but `ignored` (follow-up F-03:
 * the quest classification never reads where the character is, or when). Each compared field is
 * compared as `sameCharacterState` compares it; a field present in one state only differs.
 */
export function sameCharacterStateExcept(a: ReadonlyCharacterState, b: ReadonlyCharacterState, ignored: ReadonlySet<string>): boolean {
  if (a === b) return true;
  const left = a as unknown as Readonly<Record<string, unknown>>;
  const right = b as unknown as Readonly<Record<string, unknown>>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => ignored.has(key) || (Object.prototype.hasOwnProperty.call(right, key) && sameValue(left[key], right[key])));
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (a instanceof Map) return b instanceof Map && sameEntries(a, b);
  if (a instanceof Set) return b instanceof Set && sameMembers(a, b);
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((value, i) => sameValue(value, b[i]));
  if (!isPlain(a) || !isPlain(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && sameValue(left[key], right[key]));
}

function isPlain(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sameEntries(a: ReadonlyMap<unknown, unknown>, b: ReadonlyMap<unknown, unknown>): boolean {
  if (a.size !== b.size) return false;
  const other = b.entries();
  for (const [key, value] of a) {
    const next = other.next();
    if (next.done === true) return false;
    const [otherKey, otherValue] = next.value;
    if (!Object.is(key, otherKey) || !sameValue(value, otherValue)) return false;
  }
  return true;
}

function sameMembers(a: ReadonlySet<unknown>, b: ReadonlySet<unknown>): boolean {
  if (a.size !== b.size) return false;
  const other = b.values();
  for (const value of a) {
    const next = other.next();
    if (next.done === true || !sameValue(value, next.value)) return false;
  }
  return true;
}
