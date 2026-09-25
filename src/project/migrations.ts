import { PROJECT_SCHEMA_VERSION } from '../domain';
import type { ProjectIssue } from './issues';

/**
 * Project schema migrations (docs/ARCHITECTURE.md §8.2). Version 1 is unstable until the end of
 * Milestone 6, so the registry is empty; from Milestone 7 every schema change adds a step here.
 * A migration takes the document at version `from` and returns a new document at version `to`
 * (with `schemaVersion: to`); it must not mutate its input and must not repair anything the
 * validator would reject.
 */
export interface Migration {
  readonly from: number;
  readonly to: number;
  migrate(input: unknown): unknown;
}

export type MigrationRegistry = readonly Migration[];

export const MIGRATIONS: MigrationRegistry = [];

export type MigrationResult =
  | {
      readonly ok: true;
      readonly value: unknown;
      /** The version the input declared. */
      readonly fromVersion: number;
      /** The steps applied, in order; empty when the input was already current. */
      readonly applied: readonly { readonly from: number; readonly to: number }[];
    }
  | { readonly ok: false; readonly errors: ProjectIssue[] };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function fail(path: string, message: string): MigrationResult {
  return { ok: false, errors: [{ path, message }] };
}

/**
 * Reads the declared schema version: a positive integer `schemaVersion` on a JSON object.
 * Anything else is reported, never coerced.
 */
export function detectSchemaVersion(input: unknown): { ok: true; version: number } | { ok: false; errors: ProjectIssue[] } {
  if (!isRecord(input)) {
    return { ok: false, errors: [{ path: '', message: `Expected a project object, received ${typeName(input)}` }] };
  }
  const version = input['schemaVersion'];
  if (version === undefined) {
    return { ok: false, errors: [{ path: 'schemaVersion', message: 'Missing schemaVersion' }] };
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    const shown = typeof version === 'string' ? JSON.stringify(version) : typeName(version);
    return {
      ok: false,
      errors: [{ path: 'schemaVersion', message: `Expected schemaVersion to be a positive integer, received ${shown}` }],
    };
  }
  return { ok: true, version };
}

/**
 * Brings a project document to version `latest` by applying `registry` one step at a time.
 * A document newer than `latest`, a gap or ambiguity in the registry, a migration that throws,
 * or one that returns the wrong version is an error; the result is never partially migrated.
 */
export function migrateToLatest(
  input: unknown,
  registry: MigrationRegistry = MIGRATIONS,
  latest: number = PROJECT_SCHEMA_VERSION,
): MigrationResult {
  const detected = detectSchemaVersion(input);
  if (!detected.ok) return detected;
  const fromVersion = detected.version;
  if (fromVersion > latest) {
    return fail(
      'schemaVersion',
      `Project schemaVersion ${String(fromVersion)} is newer than this app supports (${String(latest)})`,
    );
  }

  const applied: { from: number; to: number }[] = [];
  let value: unknown = input;
  let version = fromVersion;
  while (version < latest) {
    const current = version;
    const candidates = registry.filter((m) => m.from === current);
    const step = candidates[0];
    if (step === undefined) {
      return fail('schemaVersion', `No migration from schemaVersion ${String(current)} to ${String(latest)}`);
    }
    if (candidates.length > 1) {
      return fail('schemaVersion', `Ambiguous migrations from schemaVersion ${String(current)}`);
    }
    if (!Number.isInteger(step.to) || step.to <= current || step.to > latest) {
      return fail('schemaVersion', `Invalid migration ${String(current)} -> ${String(step.to)}`);
    }
    try {
      value = step.migrate(value);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      return fail('', `Migration ${String(current)} -> ${String(step.to)} failed: ${reason}`);
    }
    const produced = isRecord(value) ? value['schemaVersion'] : undefined;
    if (produced !== step.to) {
      return fail(
        'schemaVersion',
        `Migration ${String(current)} -> ${String(step.to)} produced schemaVersion ${String(produced)}`,
      );
    }
    applied.push({ from: current, to: step.to });
    version = step.to;
  }
  return { ok: true, value, fromVersion, applied };
}
