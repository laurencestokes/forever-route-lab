/**
 * A small declarative checker for the shipped JSON files. zod stays in `src/project` (ARCHITECTURE
 * §4), and a hand-rolled walker is fast enough to check every record of `public/data/` at load
 * (docs/measurements/data-m2.json, `loader`).
 *
 * Objects are strict: a missing key fails as surely as an unexpected one, because every key of a
 * shipped record is always present (DATA_PROVENANCE §6). Checking stops after `MAX_ERRORS`
 * problems; each problem names its JSON path.
 */

export type Spec =
  /** Any integer (a safe integer). */
  | 'int'
  /** An integer >= 0. */
  | 'uint'
  /** An integer >= 1: a single id where the extractor normalised upstream's 0 ("none") to null. */
  | 'id'
  /** A non-zero integer: a signed id (`zoneOrSort`, `requirements.spell`) whose 0 ships as null. */
  | 'signedId'
  /** A finite number. */
  | 'number'
  | 'string'
  | 'boolean'
  /** A published point row: `[x, y]`, `[x, y, phase]` or exactly `[-1, -1]` (see `Checker.point`). */
  | 'point'
  | { readonly kind: 'nullable'; readonly of: Spec }
  | { readonly kind: 'array'; readonly of: Spec }
  | { readonly kind: 'literal'; readonly values: readonly (string | number | boolean | null)[] }
  | ObjectSpec
  | { readonly kind: 'map'; readonly key: 'uint' | 'token'; readonly of: Spec }
  | { readonly kind: 'union'; readonly tag: string; readonly variants: Readonly<Record<string, ObjectSpec>> };

export interface ObjectSpec {
  readonly kind: 'object';
  readonly fields: Readonly<Record<string, Spec>>;
  /** Every field optional (overlay patches); unknown keys still fail. */
  readonly partial: boolean;
}

/** One spec per key of `T`, no more and no fewer (the compiler checks both directions). */
export type FieldSpecs<T> = { readonly [K in keyof T]-?: Spec };

export const object = <T>(fields: FieldSpecs<T>): ObjectSpec => ({ kind: 'object', fields, partial: false });
export const partial = <T>(fields: FieldSpecs<T>): ObjectSpec => ({ kind: 'object', fields, partial: true });
export const nullable = (of: Spec): Spec => ({ kind: 'nullable', of });
export const array = (of: Spec): Spec => ({ kind: 'array', of });
export const literal = (...values: readonly (string | number | boolean | null)[]): Spec => ({ kind: 'literal', values });
/** An object used as a map: decimal id keys (`uint`) or upper-case tokens (`token`, class names). */
export const map = (key: 'uint' | 'token', of: Spec): Spec => ({ kind: 'map', key, of });
export const union = (tag: string, variants: Readonly<Record<string, ObjectSpec>>): Spec => ({ kind: 'union', tag, variants });

export const MAX_ERRORS = 20;

const UINT_KEY = /^(?:0|[1-9]\d*)$/;
const TOKEN_KEY = /^[A-Z]+$/;

type Json = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

const describe = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return `the string ${JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value)}`;
  if (typeof value === 'object') return 'an object';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return typeof value;
};

class Checker {
  readonly errors: string[] = [];

  get full(): boolean {
    return this.errors.length >= MAX_ERRORS;
  }

  fail(path: string, message: string): void {
    if (!this.full) this.errors.push(`${path}: ${message}`);
  }

  check(spec: Spec, value: unknown, path: string): void {
    if (this.full) return;
    if (typeof spec === 'string') {
      this.primitive(spec, value, path);
      return;
    }
    switch (spec.kind) {
      case 'nullable':
        if (value !== null) this.check(spec.of, value, path);
        return;
      case 'array':
        if (!Array.isArray(value)) {
          this.fail(path, `expected an array, got ${describe(value)}`);
          return;
        }
        for (let i = 0; i < value.length && !this.full; i += 1) this.check(spec.of, value[i], `${path}[${String(i)}]`);
        return;
      case 'literal':
        if (!spec.values.includes(value as string | number | boolean | null)) {
          this.fail(path, `expected one of ${spec.values.map((v) => JSON.stringify(v)).join(', ')}, got ${describe(value)}`);
        }
        return;
      case 'object':
        this.object(spec, value, path);
        return;
      case 'map': {
        if (!isRecord(value)) {
          this.fail(path, `expected an object, got ${describe(value)}`);
          return;
        }
        const pattern = spec.key === 'uint' ? UINT_KEY : TOKEN_KEY;
        for (const key of Object.keys(value)) {
          if (this.full) return;
          if (!pattern.test(key)) this.fail(`${path}.${key}`, spec.key === 'uint' ? 'key is not a decimal id' : 'key is not an upper-case token');
          else this.check(spec.of, value[key], `${path}.${key}`);
        }
        return;
      }
      case 'union': {
        if (!isRecord(value)) {
          this.fail(path, `expected an object, got ${describe(value)}`);
          return;
        }
        const tag = value[spec.tag];
        const variant = typeof tag === 'string' && Object.hasOwn(spec.variants, tag) ? spec.variants[tag] : undefined;
        if (variant === undefined) this.fail(`${path}.${spec.tag}`, `expected one of ${Object.keys(spec.variants).join(', ')}, got ${describe(tag)}`);
        else this.object(variant, value, path);
        return;
      }
    }
  }

  private object(spec: ObjectSpec, value: unknown, path: string): void {
    if (!isRecord(value)) {
      this.fail(path, `expected an object, got ${describe(value)}`);
      return;
    }
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(spec.fields, key)) this.fail(`${path}.${key}`, 'unexpected key');
    }
    for (const [key, fieldSpec] of Object.entries(spec.fields)) {
      if (this.full) return;
      if (!Object.hasOwn(value, key)) {
        if (!spec.partial) this.fail(`${path}.${key}`, 'missing');
        continue;
      }
      this.check(fieldSpec, value[key], `${path}.${key}`);
    }
  }

  private primitive(spec: Exclude<Spec, object>, value: unknown, path: string): void {
    switch (spec) {
      case 'int':
      case 'uint':
      case 'id': {
        const min = spec === 'int' ? Number.MIN_SAFE_INTEGER : spec === 'uint' ? 0 : 1;
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
          this.fail(path, `expected ${spec === 'int' ? 'an integer' : spec === 'uint' ? 'an integer >= 0' : 'an integer >= 1'}, got ${describe(value)}`);
        }
        return;
      }
      case 'signedId':
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value === 0) this.fail(path, `expected a non-zero integer, got ${describe(value)}`);
        return;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) this.fail(path, `expected a finite number, got ${describe(value)}`);
        return;
      case 'string':
        if (typeof value !== 'string') this.fail(path, `expected a string, got ${describe(value)}`);
        return;
      case 'boolean':
        if (typeof value !== 'boolean') this.fail(path, `expected true or false, got ${describe(value)}`);
        return;
      case 'point':
        this.point(value, path);
        return;
    }
  }

  /**
   * The dataset contract for a published point (DATA_PROVENANCE §6.5; `validate`'s range rule) is
   * a 0-100 zone percent pair, or exactly `[-1, -1]`, the instance-presence sentinel. Off-frame
   * percentages are legal for points in general (coordinates.md §4), but the extractor never
   * publishes one, so the loader checks only what can be told apart without the geometry: finite
   * numbers, an integer phase, and a sentinel that is exact. A row with one coordinate of -1 (such
   * as `[-1, 55.2]`) is refused as a malformed sentinel, deliberately: under the contract it can
   * only be a damaged `[-1, -1]`, never an off-frame point (M2 review COORD-11).
   */
  private point(value: unknown, path: string): void {
    if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) {
      this.fail(path, 'expected a point row [x, y] or [x, y, phase]');
      return;
    }
    const [x, y, phase] = value as readonly unknown[];
    if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
      this.fail(path, 'point coordinates must be finite numbers');
      return;
    }
    if (value.length === 3 && (typeof phase !== 'number' || !Number.isSafeInteger(phase))) this.fail(path, 'a point phase must be an integer');
    // The presence sentinel is exactly [-1, -1]: a partial or phased sentinel is malformed.
    const sentinelParts = (x === -1 ? 1 : 0) + (y === -1 ? 1 : 0);
    if (sentinelParts === 1 || (sentinelParts === 2 && value.length === 3)) this.fail(path, 'malformed instance-presence sentinel (must be exactly [-1, -1])');
  }
}

/** Checks `value` against `spec`; the result lists up to `MAX_ERRORS` problems, each with its path. */
export function checkValue(spec: Spec, value: unknown, path: string): readonly string[] {
  const checker = new Checker();
  checker.check(spec, value, path);
  return checker.errors;
}

/** Problems with a record list whose ids must be unique and ascending (DATA_PROVENANCE §6.1). */
export function checkAscendingIds(rows: readonly { readonly id: number }[], path: string): readonly string[] {
  for (let i = 1; i < rows.length; i += 1) {
    const previous = rows[i - 1];
    const current = rows[i];
    if (previous !== undefined && current !== undefined && current.id <= previous.id) {
      return [`${path}[${String(i)}].id: ids must be unique and ascending (${String(previous.id)} then ${String(current.id)})`];
    }
  }
  return [];
}
