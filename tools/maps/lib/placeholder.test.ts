import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { uiMapId } from '../../../src/domain/ids';
import { canonicalGeometryContent } from '../../../src/geo/content';
import { canonicalFrameTuples } from '../../../src/geo/frame';
import { parseGeometryFile } from '../../../src/geo/geometry';
import { REPO_ROOT } from '../../build/lib/fs';
import { ROWS_FILE } from './constants';
import { sha256Hex } from './hash';
import { runPlaceholderBuild } from './inputs';
import { CARVE_OUT } from './notice';
import { buildPlaceholder } from './placeholder';
import { hasPinnedCheckout, inputsFrom, readRepoText, syntheticConversion, syntheticRowsBytes } from './test-support';

const DUROTAR = { id: 1411, name: 'Durotar', mapId: 1, areaId: 14, assignmentId: 46721, xMin: -1716.6666259766, xMax: 1808.3332519531, yMin: -7249.9995117188, yMax: -1962.4998779297 };
const MULGORE = {
  id: 1412, name: 'Mulgore', mapId: 1, areaId: 215, assignmentId: 46722, xMin: -3835.416015625, xMax: 266.666015625, yMin: -3675, yMax: 2479.1669921875,
  coefficients: { scaleX: 0.8348002068275978, offsetX: 7.007453108736848, scaleY: 0.8349418225477033, offsetY: 13.15387327724201 },
};

const synthetic = () => buildPlaceholder(inputsFrom(syntheticConversion([DUROTAR, MULGORE]), syntheticRowsBytes()));

describe('buildPlaceholder (synthetic inputs)', () => {
  it('writes the questiedb-conversion rows from target_bounds and the db2-csv rows from the rows file', () => {
    const build = synthetic();
    const parsed = parseGeometryFile(JSON.parse(build.geometryText) as unknown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.geometry).toEqual(build.geometry);
    expect([...parsed.geometry.maps.keys()]).toEqual([1411, 1412, 1414]);
    expect(parsed.geometry.maps.get(uiMapId(1411))).toEqual({
      uiMapId: 1411,
      name: 'Durotar',
      nameSource: 'questiedb-conversion',
      type: null,
      parent: null,
      assignments: [
        {
          id: 46721, mapId: 1, areaId: 14, orderIndex: 0, xMin: -1716.6666259766, xMax: 1808.3332519531, yMin: -7249.9995117188, yMax: -1962.4998779297,
          uiMin: [0, 0], uiMax: [1, 1], source: 'questiedb-conversion', build: '1.60.1.69893',
        },
      ],
    });
    expect(parsed.geometry.maps.get(uiMapId(1414))).toMatchObject({ name: 'Kalimdor', nameSource: 'db2-csv', type: 2, parent: 947 });
    expect(parsed.geometry.maps.get(uiMapId(1414))?.assignments[0]).toMatchObject({ source: 'db2-csv', build: '1.60.1.70009' });
    expect([...parsed.geometry.eraToForever]).toEqual([[1412, { ...MULGORE.coefficients, fromBuild: '1.15.9.69722', toBuild: '1.60.1.69893', source: 'questiedb-conversion' }]]);
  });

  it('records the frame hash of the conversion.json frames only, and the input identities', () => {
    const build = synthetic();
    const frame = canonicalFrameTuples(build.geometry, [uiMapId(1411), uiMapId(1412)]);
    expect(frame.ok && sha256Hex(frame.canonical)).toBe(build.frameHash);
    const json = JSON.parse(build.geometryText) as { frameHash: string; inputs: Record<string, Record<string, unknown>> };
    expect(json.frameHash).toBe(build.frameHash);
    expect(json.inputs['questiedb-conversion']).toMatchObject({ sha256: build.conversionSha256, build: '1.60.1.69893', eraBuild: '1.15.9.69722', path: 'data/Forever/conversion.json' });
    expect(json.inputs['db2-csv']).toMatchObject({ path: ROWS_FILE, sha256: build.rowsSha256, build: '1.60.1.70009' });
  });

  it('records the content hash, which a reader recomputes from the written file (MAPS.md §5.3)', () => {
    const build = synthetic();
    const json = JSON.parse(build.geometryText) as { frameHash: string; contentHash: string };
    expect(Object.keys(json).slice(0, 6)).toEqual(['_generated', 'schema', 'kind', 'product', 'frameHash', 'contentHash']);
    expect(json.contentHash).toBe(build.contentHash);
    expect(build.contentHash).toBe(sha256Hex(canonicalGeometryContent(build.geometry)));
    const parsed = parseGeometryFile(json);
    expect(parsed.ok && parsed.geometry.recordedContentHash).toBe(build.contentHash);
    expect(parsed.ok && sha256Hex(canonicalGeometryContent(parsed.geometry))).toBe(build.contentHash);
    expect(build.noticeText).toContain(build.contentHash);
    // Other coefficients give another content hash but the same frame hash (the frames did not move).
    const other = buildPlaceholder(inputsFrom(syntheticConversion([DUROTAR, { ...MULGORE, coefficients: { ...MULGORE.coefficients, offsetY: 13 } }]), syntheticRowsBytes()));
    expect(other.frameHash).toBe(build.frameHash);
    expect(other.contentHash).not.toBe(build.contentHash);
  });

  it('is deterministic: _generated first, LF only, final newline, same bytes every time', () => {
    const a = synthetic();
    const b = synthetic();
    expect(a.geometryText).toBe(b.geometryText);
    expect(a.noticeText).toBe(b.noticeText);
    expect(a.geometryText.startsWith('{\n  "_generated": {')).toBe(true);
    expect(a.geometryText.endsWith('}\n')).toBe(true);
    expect(a.geometryText + a.noticeText).not.toContain('\r');
  });

  it('hashes the rows file as LF bytes, so a CRLF checkout gives the same output', () => {
    const crlf = Buffer.from(syntheticRowsBytes().toString('utf8').replace(/\n/g, '\r\n'));
    const fromCrlf = buildPlaceholder(inputsFrom(syntheticConversion([DUROTAR, MULGORE]), crlf));
    expect(fromCrlf.geometryText).toBe(synthetic().geometryText);
  });

  it('refuses a conversion.json that does not hash to the pin', () => {
    const inputs = inputsFrom(syntheticConversion([DUROTAR]), syntheticRowsBytes());
    expect(() => buildPlaceholder({ ...inputs, conversion: { ...inputs.conversion, expectedSha256: '0'.repeat(64) } })).toThrow(/hashes to .* expected 0{64}/);
  });

  it('refuses a UiMap in both inputs, and an unchanged transform with non-identity coefficients', () => {
    const kalimdorFrame = { ...DUROTAR, id: 1414, name: 'Kalimdor' };
    expect(() => buildPlaceholder(inputsFrom(syntheticConversion([DUROTAR, kalimdorFrame]), syntheticRowsBytes()))).toThrow(/in both conversion.json and the rows file/);
    const lying = syntheticConversion([MULGORE]);
    const [transform] = (lying['geometry'] as { transforms: Record<string, unknown>[] }).transforms;
    if (transform === undefined) throw new Error('fixture');
    transform['changed'] = false;
    expect(() => buildPlaceholder(inputsFrom(lying, syntheticRowsBytes()))).toThrow(/unchanged but has non-identity coefficients/);
  });

  it('writes a NOTICE naming both inputs, the decisions and the carve-out verbatim, with no local paths', () => {
    const { noticeText, conversionSha256, rowsSha256 } = synthetic();
    for (const text of [conversionSha256, rowsSha256, 'b6f5b07b0acf1c820993cbb0ce2521c912bb4c92', CARVE_OUT, 'D-016', 'D-018', 'D-022', 'D-026', 'This is not a legal conclusion.']) {
      expect(noticeText).toContain(text);
    }
    expect(noticeText).toContain('pnpm maps:placeholder');
    expect(noticeText).not.toMatch(/\.cache[\\/]/);
  });

  it("states the licence finding as of upstream.json's licenceCheck.date, not a date fixed in code (data-F9)", () => {
    const inputs = inputsFrom(syntheticConversion([DUROTAR, MULGORE]), syntheticRowsBytes());
    const text = buildPlaceholder({ ...inputs, licenceCheckDate: '2027-01-31' }).noticeText.replace(/\n\s*/g, ' ');
    expect(text).toContain('(full-history check, 2027-01-31)');
    expect(text).not.toContain('(full-history check, 2026-09-25)');
    expect(text).toContain("no root licence file (none covering Questie's own code or data)");
  });
});

describe.skipIf(!hasPinnedCheckout())('buildPlaceholder (the pinned inputs; runs where the QuestieDB checkout exists)', () => {
  it('reproduces both committed files byte for byte', () => {
    const build = runPlaceholderBuild({ questiedbRepo: null, commit: null, rowsFile: join(REPO_ROOT, ROWS_FILE) });
    expect(build.conversionSha256).toBe('f4477d6c575575152225f2a9d40858029bf9d2d5fdf6b083c06557fce8b5984b');
    expect(build.frameHash).toBe('2cb10551b1502b652e4d54922e8b3a1ecb48057fbfb7cf9c77863edd7efea78f');
    expect(build.contentHash).toBe('c05a47a276295348a5b40a98dbe13c39ddc6fb4a899c21c821714ebf51c4e6ca');
    expect(build.geometryText).toBe(readRepoText('public/maps/placeholder/geometry.placeholder.json'));
    expect(build.noticeText).toBe(readRepoText('public/maps/placeholder/NOTICE.md'));
  });
});
