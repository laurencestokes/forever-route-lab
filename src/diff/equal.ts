/**
 * Structural equality of plain data (steps and groups), with the project file's semantics
 * (src/project/io.ts `serializeProject`): a key whose value is `undefined` counts as absent, array
 * order matters, and numbers compare with `Object.is` (so `-0` differs from `0`, as the file writes
 * `-0`). Identical references are equal at once, so unchanged steps cost nothing.
 */
export function structurallyEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') return Object.is(a, b);
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const aArray = Array.isArray(a);
  if (aArray !== Array.isArray(b)) return false;
  if (aArray) {
    const left = a as readonly unknown[];
    const right = b as readonly unknown[];
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) if (!structurallyEqual(left[i], right[i])) return false;
    return true;
  }
  const left = a as Readonly<Record<string, unknown>>;
  const right = b as Readonly<Record<string, unknown>>;
  let count = 0;
  for (const key of Object.keys(left)) {
    const value = left[key];
    if (value === undefined) continue;
    count += 1;
    if (!Object.hasOwn(right, key) || !structurallyEqual(value, right[key])) return false;
  }
  for (const key of Object.keys(right)) if (right[key] !== undefined) count -= 1;
  return count === 0;
}
