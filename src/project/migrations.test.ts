import { describe, expect, it } from 'vitest';
import { type Migration, MIGRATIONS, detectSchemaVersion, migrateToLatest } from './migrations';

/** A synthetic three-version history, for tests only: v1 renames a field in v2, v2 adds one in v3. */
const SYNTHETIC: readonly Migration[] = [
  {
    from: 2,
    to: 3,
    migrate: (input) => ({ ...(input as Record<string, unknown>), schemaVersion: 3, added: 'v3 default' }),
  },
  {
    from: 1,
    to: 2,
    migrate: (input) => {
      const { oldName, ...rest } = input as Record<string, unknown>;
      return { ...rest, schemaVersion: 2, newName: oldName };
    },
  },
];

describe('MIGRATIONS', () => {
  it('is empty while schema version 1 is unstable', () => {
    expect(MIGRATIONS).toEqual([]);
  });

  it('passes a current document through unchanged', () => {
    const doc = { schemaVersion: 1, other: 'x' };
    const result = migrateToLatest(doc);
    expect(result).toEqual({ ok: true, value: doc, fromVersion: 1, applied: [] });
    if (result.ok) expect(result.value).toBe(doc);
  });
});

describe('migrateToLatest with a synthetic registry', () => {
  it('applies every step in order, whatever the registry order', () => {
    const input = Object.freeze({ schemaVersion: 1, oldName: 'kept' });
    const result = migrateToLatest(input, SYNTHETIC, 3);
    expect(result).toEqual({
      ok: true,
      value: { schemaVersion: 3, newName: 'kept', added: 'v3 default' },
      fromVersion: 1,
      applied: [
        { from: 1, to: 2 },
        { from: 2, to: 3 },
      ],
    });
    expect(input).toEqual({ schemaVersion: 1, oldName: 'kept' });
  });

  it('starts from the declared version', () => {
    const result = migrateToLatest({ schemaVersion: 2, newName: 'n' }, SYNTHETIC, 3);
    expect(result).toMatchObject({ ok: true, fromVersion: 2, applied: [{ from: 2, to: 3 }] });
  });

  it('stops at the requested latest version', () => {
    const result = migrateToLatest({ schemaVersion: 1, oldName: 'x' }, SYNTHETIC, 2);
    expect(result).toMatchObject({ ok: true, value: { schemaVersion: 2, newName: 'x' } });
  });

  it('rejects a document newer than latest', () => {
    expect(migrateToLatest({ schemaVersion: 4 }, SYNTHETIC, 3)).toEqual({
      ok: false,
      errors: [{ path: 'schemaVersion', message: 'Project schemaVersion 4 is newer than this app supports (3)' }],
    });
  });

  it('reports a gap in the registry', () => {
    const gap = SYNTHETIC.filter((m) => m.from !== 2);
    expect(migrateToLatest({ schemaVersion: 1 }, gap, 3)).toEqual({
      ok: false,
      errors: [{ path: 'schemaVersion', message: 'No migration from schemaVersion 2 to 3' }],
    });
  });

  it('reports an ambiguous registry', () => {
    const twice = [...SYNTHETIC, { from: 1, to: 2, migrate: (x: unknown) => x }];
    expect(migrateToLatest({ schemaVersion: 1 }, twice, 3)).toMatchObject({
      ok: false,
      errors: [{ path: 'schemaVersion', message: 'Ambiguous migrations from schemaVersion 1' }],
    });
  });

  it('refuses a migration that goes backwards or past latest', () => {
    const backwards: Migration[] = [{ from: 1, to: 1, migrate: (x) => x }];
    expect(migrateToLatest({ schemaVersion: 1 }, backwards, 2)).toMatchObject({ ok: false });
    const tooFar: Migration[] = [{ from: 1, to: 5, migrate: () => ({ schemaVersion: 5 }) }];
    expect(migrateToLatest({ schemaVersion: 1 }, tooFar, 3)).toMatchObject({
      ok: false,
      errors: [{ path: 'schemaVersion', message: 'Invalid migration 1 -> 5' }],
    });
  });

  it('reports a migration that throws', () => {
    const throwing: Migration[] = [
      {
        from: 1,
        to: 2,
        migrate: () => {
          throw new Error('placeholder failure');
        },
      },
    ];
    expect(migrateToLatest({ schemaVersion: 1 }, throwing, 2)).toEqual({
      ok: false,
      errors: [{ path: '', message: 'Migration 1 -> 2 failed: placeholder failure' }],
    });
  });

  it('reports a migration that produces the wrong version', () => {
    const wrong: Migration[] = [{ from: 1, to: 2, migrate: (x) => x }];
    expect(migrateToLatest({ schemaVersion: 1 }, wrong, 2)).toEqual({
      ok: false,
      errors: [{ path: 'schemaVersion', message: 'Migration 1 -> 2 produced schemaVersion 1' }],
    });
    const notObject: Migration[] = [{ from: 1, to: 2, migrate: () => 'nope' }];
    expect(migrateToLatest({ schemaVersion: 1 }, notObject, 2)).toMatchObject({ ok: false });
  });
});

describe('detectSchemaVersion', () => {
  it('reads a positive integer version', () => {
    expect(detectSchemaVersion({ schemaVersion: 7 })).toEqual({ ok: true, version: 7 });
  });

  it.each([
    [null, '', 'Expected a project object, received null'],
    [[], '', 'Expected a project object, received array'],
    ['text', '', 'Expected a project object, received string'],
    [{}, 'schemaVersion', 'Missing schemaVersion'],
    [{ schemaVersion: '1' }, 'schemaVersion', 'Expected schemaVersion to be a positive integer, received "1"'],
    [{ schemaVersion: 1.5 }, 'schemaVersion', 'Expected schemaVersion to be a positive integer, received number'],
    [{ schemaVersion: 0 }, 'schemaVersion', 'Expected schemaVersion to be a positive integer, received number'],
    [{ schemaVersion: null }, 'schemaVersion', 'Expected schemaVersion to be a positive integer, received null'],
  ])('rejects %j', (input, path, message) => {
    expect(detectSchemaVersion(input)).toEqual({ ok: false, errors: [{ path, message }] });
  });
});
