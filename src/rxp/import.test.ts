import { describe, expect, it } from 'vitest';
import fixture01 from '../../tests/fixtures/rxp/01-basic-durotar.txt?raw';
import fixture03 from '../../tests/fixtures/rxp/03-lua-wrapped.txt?raw';
import { sequentialIdSource, uiMapId } from '../domain/ids';
import { importRxp, relowerImport } from './import';
import { sha256Hex } from './sha256';
import { FULL_CONTEXT, ZONES_ONLY } from './test-fixtures';
import { zoneKeyLookup } from './zone-keys';

describe('importRxp (ARCHITECTURE §10 steps 1-4)', () => {
  it('imports raw text as one RxpImport that keeps the text verbatim', () => {
    const result = importRxp(fixture01, sequentialIdSource(), ZONES_ONLY);
    if (result.status !== 'ok') throw new Error('refused');
    expect(result.source).toBe('raw');
    const [guide] = result.guides;
    expect(guide?.import).toEqual({
      id: 'import-1',
      name: '1-4 Valley of Trials (fixture)',
      sourceHash: sha256Hex(fixture01),
      text: fixture01,
      options: { changedZoneFrame: 'forever', lua: null },
    });
    expect(Object.keys(guide?.groups ?? {})).toHaveLength(18);
    expect(guide?.steps.every((step) => step.groupId !== null && Object.hasOwn(guide.groups, step.groupId))).toBe(true);
  });

  it('keeps the Lua call arguments and reports guide diagnostics with Lua-file lines (§3.2 rule 5)', () => {
    const result = importRxp(fixture03, sequentialIdSource(), ZONES_ONLY, { changedZoneFrame: 'era' });
    if (result.status !== 'ok') throw new Error('refused');
    expect(result.source).toBe('lua');
    expect(result.guides.map((guide) => [guide.import.name, guide.import.options])).toEqual([
      ['6-8 Fixture Three', { changedZoneFrame: 'era', lua: { groupArg: null, defaultFor: null } }],
      ['6-8 Fixture Three (Alt)', { changedZoneFrame: 'era', lua: { groupArg: null, defaultFor: null } }],
      ['8-9 Fixture Four', { changedZoneFrame: 'era', lua: { groupArg: 'Forever Route Lab Fixtures', defaultFor: 'Orc/Troll' } }],
      ['9-10 Fixture Quoted', { changedZoneFrame: 'era', lua: { groupArg: null, defaultFor: null } }],
    ]);
    expect(result.diagnostics.map((d) => [d.code, d.importId])).toEqual([
      ['RXP021-lua-guard-ignored', ''],
      ['RXP021-lua-guard-ignored', ''],
      ['RXP020-lua-dynamic', ''],
    ]);
    const lua = 'local x = 1\n\nRXPGuides.RegisterGuide([[\n#name A\n#group G\nstep\n    .frobnicate\n]])\nRXPGuides.RegisterGuide([[#name B\n#group G\nstep\n    .frobnicate]])\n';
    const mapped = importRxp(lua, sequentialIdSource(), ZONES_ONLY);
    if (mapped.status !== 'ok') throw new Error('refused');
    expect(mapped.guides.map((guide) => guide.diagnostics.map((d) => `${String(d.line)}:${String(d.column)} ${d.code}`))).toEqual([
      ['7:6 RXP001-unknown-command'],
      ['12:6 RXP001-unknown-command'],
    ]);
    expect(mapped.guides[1]?.steps[0]?.rxp?.line).toEqual({ importId: mapped.guides[1]?.import.id, firstLine: 4, lastLine: 4 });
  });

  it('refuses a protected import string without creating an import', () => {
    const result = importRxp('3|-12345:abcdef', sequentialIdSource(), ZONES_ONLY);
    expect(result).toEqual({ status: 'refused', guides: [], diagnostics: [expect.objectContaining({ code: 'RXP019-protected-format', importId: '', severity: 'error' })] });
  });

  it('names a guide without #name from the fallback, and reports it (RXP025)', () => {
    const result = importRxp('step\n    .accept 1\n', sequentialIdSource(), ZONES_ONLY, { fallbackName: 'my-file.txt' });
    if (result.status !== 'ok') throw new Error('refused');
    expect(result.guides[0]?.import.name).toBe('my-file.txt');
    expect(result.guides[0]?.diagnostics.map((d) => d.code)).toEqual(['RXP025-missing-name-or-group']);
  });

  it('lowers a stored import again with the same ids and dataset diagnostics', () => {
    const first = importRxp(fixture01, sequentialIdSource(), FULL_CONTEXT);
    if (first.status !== 'ok') throw new Error('refused');
    const [guide] = first.guides;
    if (guide === undefined) throw new Error('no guide');
    const ids = sequentialIdSource();
    ids.next('import');
    const again = relowerImport(guide.import, ids, FULL_CONTEXT);
    expect(again.steps).toEqual(guide.steps);
    expect(again.groups).toEqual(guide.groups);
    expect(again.diagnostics).toEqual(guide.diagnostics);
  });
});

describe('zoneKeyLookup (docs/RXP.md §10.3)', () => {
  it('matches English names exactly and treats a shared name as unknown', () => {
    const lookup = zoneKeyLookup([
      { uiMapId: uiMapId(1411), name: 'Durotar' },
      { uiMapId: uiMapId(1), name: 'Twice' },
      { uiMapId: uiMapId(2), name: 'Twice' },
      { uiMapId: uiMapId(3), name: null },
    ]);
    expect(lookup('Durotar')).toBe(1411);
    expect(lookup('durotar')).toBeNull();
    expect(lookup('Twice')).toBeNull();
    expect(lookup('toString')).toBeNull();
  });
});
