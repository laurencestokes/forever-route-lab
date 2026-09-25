import type { z } from 'zod';
import type { ProjectV1 } from '../domain';
import { formatPath, type ProjectIssue } from './issues';
import { migrateToLatest } from './migrations';
import { projectSchema } from './schema';

/**
 * Native project import and export (docs/ARCHITECTURE.md §8.2): unknown → detect version →
 * migrate step by step → validate → latest. Malformed input is rejected with path-level errors;
 * nothing is silently repaired.
 */

export type ParseProjectResult = { ok: true; project: ProjectV1 } | { ok: false; errors: ProjectIssue[] };

type ZodIssue = z.core.$ZodIssue;

/** A union branch that failed on its discriminator is not the branch the author meant. */
function failedOnDiscriminator(branch: readonly ZodIssue[]): boolean {
  return branch.some(
    (issue) =>
      issue.code === 'invalid_union' &&
      issue.errors.length === 0 &&
      issue.discriminator !== undefined &&
      issue.path.length <= 1,
  );
}

function collect(issue: ZodIssue, prefix: readonly PropertyKey[], out: ProjectIssue[]): void {
  const path = [...prefix, ...issue.path];
  if (issue.code === 'unrecognized_keys') {
    for (const key of issue.keys) out.push({ path: formatPath([...path, key]), message: 'Unrecognized key' });
    return;
  }
  if (issue.code === 'invalid_union') {
    // Descend into the one branch the input was plausibly written for; otherwise report the union.
    const plausible = issue.errors.filter((branch) => !failedOnDiscriminator(branch));
    const [only] = plausible;
    if (plausible.length === 1 && only !== undefined) {
      for (const inner of only) collect(inner, path, out);
      return;
    }
  }
  if (issue.code === 'invalid_key') {
    const detail = issue.issues.map((i) => i.message).join('; ');
    out.push({ path: formatPath(path), message: `Invalid key ${JSON.stringify(String(path.at(-1)))}: ${detail}` });
    return;
  }
  out.push({ path: formatPath(path), message: issue.message });
}

/** Flattens zod issues into path-level errors, in schema traversal order. */
export function toProjectIssues(issues: readonly ZodIssue[]): ProjectIssue[] {
  const out: ProjectIssue[] = [];
  for (const issue of issues) collect(issue, [], out);
  return out;
}

/**
 * Structural problems zod cannot see: an own `__proto__` key (zod drops it from records, a silent
 * change) and cycles (possible only in values handed over from code, never from JSON text).
 */
function structuralIssues(value: unknown, path: PropertyKey[], ancestors: Set<object>, out: ProjectIssue[]): void {
  if (value === null || typeof value !== 'object') return;
  if (ancestors.has(value)) {
    out.push({ path: formatPath(path), message: 'Cyclic reference' });
    return;
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    items.forEach((item, i) => {
      structuralIssues(item, [...path, i], ancestors, out);
    });
  } else {
    const record = value as Readonly<Record<string, unknown>>;
    for (const key of Object.keys(record)) {
      if (key === '__proto__') out.push({ path: formatPath([...path, key]), message: 'Reserved key "__proto__"' });
      else structuralIssues(record[key], [...path, key], ancestors, out);
    }
  }
  ancestors.delete(value);
}

export function parseProject(json: unknown): ParseProjectResult {
  const structural: ProjectIssue[] = [];
  structuralIssues(json, [], new Set(), structural);
  if (structural.length > 0) return { ok: false, errors: structural };
  const migrated = migrateToLatest(json);
  if (!migrated.ok) return { ok: false, errors: migrated.errors };
  const result = projectSchema.safeParse(migrated.value);
  if (!result.success) return { ok: false, errors: toProjectIssues(result.error.issues) };
  return { ok: true, project: result.data };
}

/** Parses project JSON text. A leading byte-order mark is an encoding detail and is skipped. */
export function parseProjectText(text: string): ParseProjectResult {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [{ path: '', message: `Invalid JSON: ${reason}` }] };
  }
  return parseProject(json);
}

/** Keys written first, in this order, when present; all others follow in code-unit order. */
const LEADING_KEYS: readonly string[] = ['schemaVersion', 'id', 'kind'];

function compareKeys(a: string, b: string): number {
  const ia = LEADING_KEYS.indexOf(a);
  const ib = LEADING_KEYS.indexOf(b);
  if (ia !== -1 || ib !== -1) {
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Serialisation state: the current path (a stack, for error messages) and the open objects. */
interface Writer {
  readonly path: PropertyKey[];
  readonly open: Set<object>;
}

function refuse(w: Writer, what: string): never {
  throw new TypeError(`Cannot serialise ${what} at "${formatPath(w.path)}"`);
}

function writeChild(w: Writer, key: PropertyKey, value: unknown, indent: string): string {
  w.path.push(key);
  const out = write(w, value, indent);
  w.path.pop();
  return out;
}

function write(w: Writer, value: unknown, indent: string): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) refuse(w, String(value));
    // JSON.stringify writes -0 as 0; "-0" is valid JSON and parses back to -0.
    return Object.is(value, -0) ? '-0' : JSON.stringify(value);
  }
  if (typeof value !== 'object') return refuse(w, `a ${typeof value}`);
  if (w.open.has(value)) refuse(w, 'a cyclic reference');
  const inner = `${indent}  `;
  let out: string;
  w.open.add(value);
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    const parts = items.map((item, i) => {
      if (item === undefined) refuse({ ...w, path: [...w.path, i] }, 'undefined');
      return inner + writeChild(w, i, item, inner);
    });
    out = parts.length === 0 ? '[]' : `[\n${parts.join(',\n')}\n${indent}]`;
  } else {
    if (!isPlainObject(value)) refuse(w, 'a non-plain object');
    const record = value as Readonly<Record<string, unknown>>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(compareKeys);
    const parts = keys.map((key) => `${inner}${JSON.stringify(key)}: ${writeChild(w, key, record[key], inner)}`);
    out = parts.length === 0 ? '{}' : `{\n${parts.join(',\n')}\n${indent}}`;
  }
  w.open.delete(value);
  return out;
}

/**
 * Deterministic JSON: `schemaVersion`, `id` and `kind` first, other keys in code-unit order,
 * 2-space indent, LF line endings and a trailing newline. The same project always gives the same
 * bytes, whatever order its objects were built in. Absent optional keys are omitted; values JSON
 * cannot hold exactly (NaN, Infinity, undefined array entries, cycles) throw a TypeError.
 */
export function serializeProject(p: ProjectV1): string {
  return `${write({ path: [], open: new Set() }, p, '')}\n`;
}
