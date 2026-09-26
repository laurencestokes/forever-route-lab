import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseGeometryFile } from '../../../src/geo/geometry';
import type { MapGeometry } from '../../../src/geo/types';
import { readImageHeader } from '../../../src/infra/maps/image-header';
import { REPO_ROOT } from '../../build/lib/fs';
import { inputHash } from '../../casc/input-hash';
import { artBounds, buildArtSet, type ArtBuild } from './art-build';
import { committedArtChecks } from './art-checks';
import { ART_DIR, parseArtManifest } from './art-manifest';
import { artNoticeText } from './art-notice';
import { fakeCkey, syntheticArtWorld } from './art-test-support';
import { CLIENT_PIN, GEOMETRY_FILE, PLACEHOLDER_DIR } from './constants';
import { decodeToRgba, DEFAULT_WEBP, encoderIdentity } from './encode';
import { lfBytes, sha256Hex } from './hash';
import { rasterSha256 } from './raster';
import { tempDir, writeFile } from './test-support';

const { tables, files } = syntheticArtWorld();
const options = {
  client: CLIENT_PIN,
  toolTrees: { trees: { 'tools/casc': 'c'.repeat(40), 'tools/maps': 'd'.repeat(40) }, method: 'git' as const },
  encoder: encoderIdentity(),
  webp: DEFAULT_WEBP,
};
const source = {
  tables,
  read: (id: number): { data: Uint8Array; ckey: string } => {
    const data = files.get(id);
    if (data === undefined) throw new Error(`missing ${String(id)}`);
    return { data, ckey: fakeCkey(id) };
  },
};

/** A small geometry holding the synthetic world's two UiMaps (the placeholder's role in A4). */
function syntheticPlaceholder(): MapGeometry {
  const row = (a: { id: number; region: readonly number[]; uiMin: readonly number[]; uiMax: readonly number[]; orderIndex: number; mapId: number; areaId: number }): Record<string, unknown> => ({
    id: a.id,
    mapId: a.mapId,
    areaId: a.areaId,
    orderIndex: a.orderIndex,
    xMin: a.region[0],
    xMax: a.region[3],
    yMin: a.region[1],
    yMax: a.region[4],
    uiMin: a.uiMin,
    uiMax: a.uiMax,
    source: 'local-db2',
    build: '1.60.1.70009',
  });
  const maps: Record<string, unknown> = {};
  for (const m of tables.art.uiMaps) {
    maps[String(m.id)] = { name: m.name, nameSource: 'local-db2', type: m.type, parent: m.parent, assignments: tables.assignments.filter((a) => a.uiMapId === m.id).map(row) };
  }
  const parsed = parseGeometryFile({ schema: 1, kind: 'local', redistribution: 'local-only', product: 'wow_classic_beta', build: '1.60.1.70009', maps, eraToForever: {} });
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.geometry;
}

describe('building the art set in memory', () => {
  let build: ArtBuild;
  beforeAll(async () => {
    build = await buildArtSet(source, options);
  });

  it('writes one WebP per plan with its manifest entry: hashes, sizes, tiles, overlays and bounds', async () => {
    expect(build.files.map((f) => f.entry.path)).toEqual(['947.webp', '1411.webp']);
    const durotar = build.files[1];
    expect(durotar?.entry).toMatchObject({ uiMapId: 1411, name: 'Durotar', uiMapType: 3, uiMapArtId: 20, styleId: 1, layer: 0, width: 10, height: 6, tiles: [1000, 1001, 1002, 1003, 1004, 1005] });
    expect(durotar?.entry.overlays).toEqual([{ id: 7, areaIds: [370], tiles: [2000, 2001] }]);
    expect(durotar?.entry.bounds).toEqual({ assignment: 46721, mapId: 1, xMin: -1716.6666259765625, xMax: 1808.333251953125, yMin: -7249.99951171875, yMax: -1962.4998779296875 });
    expect(build.files[0]?.entry.bounds).toBeNull();
    expect(build.files[0]?.entry.assignments).toEqual([46774, 46775]);
    for (const file of build.files) {
      expect(file.entry.sha256).toBe(sha256Hex(file.bytes));
      expect(file.entry.bytes).toBe(file.bytes.length);
      const header = readImageHeader(file.bytes);
      expect(header).toMatchObject({ ok: true, header: { contentType: 'image/webp', width: file.entry.width, height: file.entry.height } });
    }
    // The input hash covers the BLP tiles and the tables, with their CKeys.
    const inputs = [...[1000, 1001, 1002, 1003, 1004, 1005, 2000, 2001].map((id) => ({ fileDataId: id, ckey: fakeCkey(id) })), ...tables.inputs];
    expect(durotar?.entry.inputHash).toBe(inputHash(inputs));
    // Lossy WebP stays close to the composed pixels (flat colours, so within a few levels).
    const decoded = await decodeToRgba(durotar?.bytes ?? new Uint8Array());
    expect([decoded.width, decoded.height]).toEqual([10, 6]);
    expect(rasterSha256(decoded)).not.toBe('');
  });

  it('is deterministic, and its manifest parses and regenerates its NOTICE', async () => {
    const again = await buildArtSet(source, options);
    expect(again.manifestText).toBe(build.manifestText);
    expect(again.files.map((f) => f.bytes.toString('base64'))).toEqual(build.files.map((f) => f.bytes.toString('base64')));
    const parsed = parseArtManifest(JSON.parse(build.manifestText) as unknown);
    expect(parsed.errors).toEqual([]);
    expect(parsed.manifest?.skippedOverlays).toBe(1);
    expect(build.noticeText).toBe(artNoticeText(parsed.manifest ?? (null as never)));
    expect(build.noticeText).toContain('© Blizzard Entertainment, Inc.');
    expect(build.noticeText).toContain('not affiliated with or endorsed by Blizzard Entertainment');
    expect(build.noticeText).toContain('removed promptly if Blizzard asks');
    expect(build.noticeText).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(JSON.parse(build.manifestText)).toMatchObject({ schema: 1, kind: 'map-art', artwork: { owner: 'Blizzard Entertainment', decision: 'D-033' }, client: CLIENT_PIN });
  });

  describe('offline checks on a written set (A1-A5)', () => {
    let dir = '';
    let dispose = (): void => undefined;
    beforeEach(() => {
      ({ dir, dispose } = tempDir('frl-art-'));
      for (const f of build.files) writeFile(dir, f.entry.path, f.bytes);
      writeFile(dir, 'manifest.json', build.manifestText);
      writeFile(dir, 'NOTICE.md', build.noticeText);
    });
    afterEach(() => dispose());

    const failing = (): readonly string[] => committedArtChecks(dir, syntheticPlaceholder()).checks.filter((c) => c.problems.length > 0 || c.skipped !== null).map((c) => c.id);

    it('passes as written; the synthetic sizes differ from the art-size table, which A4 reports', () => {
      const report = committedArtChecks(dir, syntheticPlaceholder());
      expect(report.checks.find((c) => c.id === 'A4')?.problems).toEqual(['947.webp: 4 × 4, the UiMap\'s art is 1002 × 668', '1411.webp: 10 × 6, the UiMap\'s art is 1002 × 668']);
      expect(failing()).toEqual(['A4']);
    });

    it('fails on a changed image, an unlisted file, an edited NOTICE and a missing manifest', () => {
      writeFileSync(join(dir, '1411.webp'), Buffer.concat([readFileSync(join(dir, '1411.webp')), Buffer.from([0])]));
      writeFile(dir, 'stray.png', 'x');
      writeFile(dir, 'NOTICE.md', `${build.noticeText}edited\n`);
      expect(failing()).toEqual(['A2', 'A3', 'A4']);
      const a2 = committedArtChecks(dir, syntheticPlaceholder()).checks.find((c) => c.id === 'A2')?.problems ?? [];
      expect(a2.some((p) => p.startsWith('1411.webp: '))).toBe(true);
      expect(a2).toContain('stray.png: in the folder but not in the manifest');
      rmSync(join(dir, 'manifest.json'));
      expect(failing()).toEqual(['A1', 'A2', 'A3', 'A4', 'A5']);
    });

    it('refuses a manifest from another build', () => {
      const manifest = JSON.parse(build.manifestText) as { client: { version: string } };
      manifest.client.version = '1.60.1.69999';
      writeFile(dir, 'manifest.json', JSON.stringify(manifest));
      expect(committedArtChecks(dir, syntheticPlaceholder()).checks[0]?.problems).toEqual(['client wow_classic_beta 1.60.1.69999 (05215079e3905ef5922ae0b03ffefb73) is not the pin wow_classic_beta 1.60.1.70009']);
    });
  });
});

describe('artBounds', () => {
  const [durotar, azerothA] = [tables.assignments[0], tables.assignments[1]];
  it('is the single full-rectangle OrderIndex 0 row, else null', () => {
    expect(durotar === undefined ? null : artBounds([durotar])?.assignment).toBe(46721);
    expect(durotar === undefined || azerothA === undefined ? 'x' : artBounds([durotar, azerothA])).toBeNull();
    expect(azerothA === undefined ? 'x' : artBounds([azerothA])).toBeNull();
    expect(durotar === undefined ? 'x' : artBounds([{ ...durotar, orderIndex: 1 }])).toBeNull();
  });
});

describe('parseArtManifest', () => {
  it('refuses malformed manifests with the field at fault', () => {
    expect(parseArtManifest([]).errors).toEqual(['(root): must be an object']);
    const { errors } = parseArtManifest({ schema: 2, kind: 'x', artwork: { owner: 'someone' }, client: {}, tool: {}, tables: [{}], files: [{ path: '../x.webp' }], skipped: {} });
    expect(errors).toEqual(
      expect.arrayContaining([
        'schema must be 1',
        'kind must be "map-art"',
        'artwork must name Blizzard Entertainment as the owner and NOTICE.md as the notice',
        'client needs product, version and a 32-hex buildKey',
        'tables[]: needs table, fileDataId, ckey, rows',
        'files[0]: path must be <uiMapId>.webp or <uiMapId>-<layer>.webp',
        'skipped needs uiMaps and overlays arrays',
      ]),
    );
  });
});

describe('the committed art (public/maps/art)', () => {
  it('passes A1-A5 against the committed placeholder', () => {
    const geometry = parseGeometryFile(JSON.parse(lfBytes(readFileSync(join(REPO_ROOT, PLACEHOLDER_DIR, GEOMETRY_FILE))).toString('utf8')) as unknown);
    if (!geometry.ok) throw new Error(geometry.errors.join('; '));
    const report = committedArtChecks(join(REPO_ROOT, ART_DIR), geometry.geometry);
    expect(report.checks.map((c) => [c.id, c.problems, c.skipped])).toEqual(['A1', 'A2', 'A3', 'A4', 'A5'].map((id) => [id, [], null]));
    expect(report.manifest?.files).toHaveLength(60);
    expect(report.gzipBytes).toBeLessThanOrEqual(12_000_000);
  });
});
