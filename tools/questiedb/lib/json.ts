/**
 * Deterministic JSON for the generated files (DATA_PROVENANCE §8.3): object keys in the order the
 * extractor built them (records) or ascending numeric order (id maps, which JavaScript already
 * orders that way for canonical integer keys, checked here), shortest round-trip numbers (the
 * ECMAScript algorithm, identical on every platform), UTF-8, LF, a final newline, no BOM.
 *
 * Layout: the top-level object has one key per line; a list or map marked "lines" puts one element
 * per line, so a changed record is a changed line in review.
 */

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

function assertJson(value: unknown, path: string): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path}: non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertJson(item, `${path}[${String(index)}]`);
    });
    return;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) throw new Error(`${path}.${key}: undefined (use null)`);
      assertJson(item, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`${path}: ${typeof value} is not JSON`);
}

/** Compact JSON of one value (checked: no undefined, NaN or Infinity anywhere). */
export function compact(value: unknown, path = '$'): string {
  assertJson(value, path);
  return JSON.stringify(value);
}

export type Layout = 'inline' | 'lines';

/**
 * A generated document: `{"_generated": ..., key: value, ...}` with one top-level key per line;
 * values marked `lines` (arrays or objects) get one element per line.
 */
export function document(entries: readonly (readonly [string, unknown, Layout])[]): string {
  const parts: string[] = [];
  for (const [key, value, layout] of entries) {
    const head = `${JSON.stringify(key)}:`;
    if (layout === 'inline') {
      parts.push(`${head}${compact(value, key)}`);
    } else if (Array.isArray(value)) {
      const items = (value as readonly unknown[]).map((item, index) => compact(item, `${key}[${String(index)}]`));
      parts.push(items.length === 0 ? `${head}[]` : `${head}[\n${items.join(',\n')}\n]`);
    } else if (typeof value === 'object' && value !== null) {
      const items = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}:${compact(v, `${key}.${k}`)}`);
      parts.push(items.length === 0 ? `${head}{}` : `${head}{\n${items.join(',\n')}\n}`);
    } else {
      throw new Error(`${key}: "lines" layout needs an array or object`);
    }
  }
  return `{\n${parts.join(',\n')}\n}\n`;
}

/** Pretty JSON (two-space indent) for small human-read files such as the manifest. */
export function pretty(value: unknown): string {
  assertJson(value, '$');
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** An object keyed by numeric ids in ascending order; throws on a key JavaScript would reorder. */
export function idMap<T>(entries: Iterable<readonly [number, T]>): Record<string, T> {
  const sorted = [...entries].sort((a, b) => a[0] - b[0]);
  const out: Record<string, T> = {};
  for (const [id, value] of sorted) {
    if (!Number.isInteger(id) || id < 0 || id > 4294967294) throw new Error(`id ${String(id)} cannot be an ordered JSON key`);
    out[String(id)] = value;
  }
  return out;
}
