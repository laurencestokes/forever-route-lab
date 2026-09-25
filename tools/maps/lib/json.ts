/**
 * Deterministic JSON formatting for the files tools/maps writes (docs/MAPS.md §5.3, §8.3;
 * DATA_PROVENANCE §8.3: fixed key order, LF, final newline).
 *
 * - Keys keep insertion order (JavaScript orders integer-like keys such as "1411" ascending
 *   first, which is the order the geometry wants anyway).
 * - Numbers use ECMAScript's shortest round-trip form (`JSON.stringify`), so a value parsed from a
 *   decimal string is written back as the same decimal whenever that string was already minimal.
 * - Arrays of primitives are written on one line when that line stays within
 *   `INLINE_ARRAY_WIDTH` characters, otherwise one item per line. Objects inside arrays whose
 *   values are all primitives or arrays of primitives (geometry rows) are always written on one
 *   line. Everything else is indented by two spaces.
 */

export const INLINE_ARRAY_WIDTH = 120;

type JsonPrimitive = string | number | boolean | null;

const isPrimitive = (value: unknown): value is JsonPrimitive =>
  value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFlat = (value: unknown): boolean =>
  isPrimitive(value) || (Array.isArray(value) && value.every(isPrimitive));

function primitive(value: JsonPrimitive): string {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`cannot write non-finite number ${String(value)}`);
  return JSON.stringify(value);
}

function inline(value: unknown): string {
  if (isPrimitive(value)) return primitive(value);
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  if (isRecord(value)) {
    const entries = Object.entries(value);
    return entries.length === 0 ? '{}' : `{ ${entries.map(([key, entry]) => `${JSON.stringify(key)}: ${inline(entry)}`).join(', ')} }`;
  }
  throw new Error(`cannot write ${typeof value} as JSON`);
}

function block(value: unknown, indent: string): string {
  if (isPrimitive(value)) return primitive(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every(isPrimitive) && inline(value).length <= INLINE_ARRAY_WIDTH) return inline(value);
    const items = value.map((item) => (isRecord(item) && Object.values(item).every(isFlat) ? inline(item) : block(item, inner)));
    return `[\n${items.map((item) => `${inner}${item}`).join(',\n')}\n${indent}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    return `{\n${entries.map(([key, entry]) => `${inner}${JSON.stringify(key)}: ${block(entry, inner)}`).join(',\n')}\n${indent}}`;
  }
  throw new Error(`cannot write ${typeof value} as JSON`);
}

/** The file text: formatted JSON plus a final LF. */
export function formatJson(value: unknown): string {
  return `${block(value, '')}\n`;
}
