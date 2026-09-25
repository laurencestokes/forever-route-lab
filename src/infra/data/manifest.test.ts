import { describe, expect, it } from 'vitest';
import { jsonOf, nodeSha256, publicSite } from '../../../tests/support/fake-fetch';
import { SITE } from '../../../tests/support/fixture-dataset';
import { computeDataRevision, CONVERSION_INPUT_PATH, dataRevisionInput, identityOf, parseManifest } from './manifest';
import { DATA_OUTPUT_FILES } from './rows';

type Json = Record<string, unknown>;
const fixture = (): Json => structuredClone(jsonOf(SITE, 'data/manifest.json')) as Json;

/** conversion.json at the pinned QuestieDB commit (the placeholder geometry records the same). */
const CONVERSION_SHA256 = 'f4477d6c575575152225f2a9d40858029bf9d2d5fdf6b083c06557fce8b5984b';

const errorsOf = (json: unknown): readonly string[] => {
  const parsed = parseManifest(json);
  return parsed.ok ? [] : parsed.errors;
};

describe('parseManifest', () => {
  it('reads the fixture manifest: identity, the seven outputs in path order, and the slice', () => {
    const parsed = parseManifest(fixture());
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    const { manifest } = parsed;
    expect(manifest.outputs.map((o) => o.path)).toEqual([...DATA_OUTPUT_FILES]);
    expect(identityOf(manifest)).toEqual({
      dataRevision: '695c41df5635b456ca1b9698814e7a07fd40db2c83dd721181e1a46b8cec6cad',
      frameBuild: '1.60.1.69893',
      upstreamCommit: 'b6f5b07b0acf1c820993cbb0ce2521c912bb4c92',
      foreverContentVerified: false,
    });
    expect(manifest.slice).toEqual({ uiMapId: 1411, label: 'Durotar (UiMap 1411) and its subzones, including the Valley of Trials' });
    expect(manifest.conversionSha256).toBe(CONVERSION_SHA256);
  });

  it('reads the committed public/data manifest, which has no slice', () => {
    const parsed = parseManifest(jsonOf(publicSite(), 'data/manifest.json'));
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    expect(parsed.manifest.dataRevision).toBe('65c377bccf19f41759780b0d3052e1f972e317135d17ae763edd13b768866ab6');
    expect(parsed.manifest.slice).toBeNull();
    expect(parsed.manifest.conversionSha256).toBe(CONVERSION_SHA256);
  });

  it('needs exactly one conversion.json input with its SHA-256, to pair the data with the geometry (COORD-10)', () => {
    const inputs = (json: Json): Json[] => json['inputs'] as Json[];
    const missing = fixture();
    missing['inputs'] = inputs(missing).filter((i) => i['path'] !== CONVERSION_INPUT_PATH);
    expect(errorsOf(missing)).toEqual(["manifest.json.inputs: expected exactly one data/Forever/conversion.json entry (the data frame's source)"]);
    const twice = fixture();
    const conversion = inputs(twice).find((i) => i['path'] === CONVERSION_INPUT_PATH);
    twice['inputs'] = [...inputs(twice), { ...conversion }];
    expect(errorsOf(twice)).toHaveLength(1);
    const bad = fixture();
    const entry = inputs(bad).find((i) => i['path'] === CONVERSION_INPUT_PATH);
    if (entry !== undefined) entry['sha256'] = 'F4477D6C';
    expect(errorsOf(bad)).toEqual(['manifest.json.inputs[data/Forever/conversion.json].sha256: expected a SHA-256 hex digest']);
  });

  it('refuses outputs this app does not read, missing outputs and paths that leave data/', () => {
    const extra = fixture();
    (extra['outputs'] as Json[]).push({ path: 'zones2.json', sha256: 'a'.repeat(64), bytes: 1, records: 1, origins: [] });
    expect(errorsOf(extra)).toEqual([expect.stringMatching(/lists zones2\.json, which this version of the app does not read/)]);
    const missing = fixture();
    missing['outputs'] = (missing['outputs'] as Json[]).filter((o) => o['path'] !== 'spawns.json');
    expect(errorsOf(missing)).toEqual(['manifest.json.outputs: missing spawns.json']);
    const escape = fixture();
    const [first] = escape['outputs'] as Json[];
    if (first !== undefined) first['path'] = '../secrets.json';
    expect(errorsOf(escape)).toContain('manifest.json.outputs[0].path: expected a plain file name');
  });

  it('refuses another manifest version and a malformed identity', () => {
    expect(errorsOf({ ...fixture(), schemaVersion: 2 })).toEqual(['manifest.json.schemaVersion: expected 1 (this app reads manifest version 1)']);
    expect(errorsOf({ ...fixture(), dataRevision: 'abc' })).toEqual(['manifest.json.dataRevision: expected a SHA-256 hex digest']);
    expect(errorsOf({ ...fixture(), foreverContentVerified: 'no' })).toEqual(['manifest.json.foreverContentVerified: expected true or false']);
    expect(errorsOf('not a manifest')).toEqual(['manifest.json: expected an object']);
  });
});

describe('dataRevision', () => {
  it('recomputes the revision both committed manifests state (DATA_PROVENANCE §8.3)', async () => {
    for (const site of [SITE, publicSite()]) {
      const parsed = parseManifest(jsonOf(site, 'data/manifest.json'));
      if (!parsed.ok) throw new Error(parsed.errors.join('; '));
      expect(await computeDataRevision(nodeSha256, parsed.manifest.outputs)).toBe(parsed.manifest.dataRevision);
    }
  });

  it('hashes one tab-separated line per output, sorted by path, whatever the input order', () => {
    const lines = dataRevisionInput([
      { path: 'b.json', sha256: '2' },
      { path: 'NOTICE.md', sha256: '1' },
      { path: 'a.json', sha256: '3' },
    ]);
    expect(lines).toBe('NOTICE.md\t1\na.json\t3\nb.json\t2\n');
  });
});
