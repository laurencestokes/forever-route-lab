import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseGeometryFile } from '../../../src/geo/geometry';
import type { MapGeometry } from '../../../src/geo/types';
import { readImageHeader } from '../../../src/infra/maps/image-header';
import { gzipSize } from '../../build/lib/audit';
import { REPO_ROOT } from '../../build/lib/fs';
import { inputHash } from '../../casc/input-hash';
import { artBounds, buildArtSet, type ArtBuild } from './art-build';
import { committedArtChecks } from './art-checks';
import { ART_DIR, parseArtManifest } from './art-manifest';
import { artNoticeText } from './art-notice';
import { fakeCkey, syntheticArtWorld } from './art-test-support';
import { ART_BUDGET_GZIP_BYTES, CLIENT_PIN, DEPLOYED_ART_REASON, DEPLOYED_ART_UIMAPS, GEOMETRY_FILE, PLACEHOLDER_DIR } from './constants';
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

    it('A5 counts the files of subfolders too (map-atlas.md §7.5), and A2 reports them as unlisted', () => {
      const before = committedArtChecks(dir, syntheticPlaceholder()).gzipBytes ?? 0;
      writeFile(dir, 'sub/deeper/stray.bin', Buffer.alloc(5000, 7));
      const after = committedArtChecks(dir, syntheticPlaceholder());
      expect((after.gzipBytes ?? 0) - before).toBe(gzipSize(Buffer.alloc(5000, 7)));
      expect(after.checks.find((c) => c.id === 'A2')?.problems).toContain('sub: in the folder but not in the manifest');
    });

    it('keeps a sources record for every composed UiMap, deployed or not, matching its file', () => {
      const manifest = parseArtManifest(JSON.parse(build.manifestText) as unknown).manifest;
      expect(manifest?.sources.map((s) => [s.uiMapId, s.layer])).toEqual([
        [947, 0],
        [1411, 0],
      ]);
      const durotar = manifest?.sources.find((s) => s.uiMapId === 1411);
      expect(durotar?.pixelsSha256).toBe(build.files[1]?.entry.pixelsSha256);
      expect(durotar?.overlaysSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(manifest?.sources.find((s) => s.uiMapId === 947)?.overlaysSha256).toBeNull();
      const broken = JSON.parse(build.manifestText) as { sources: { pixelsSha256: string }[] };
      const first = broken.sources[1];
      if (first !== undefined) first.pixelsSha256 = '0'.repeat(64);
      expect(parseArtManifest(broken).errors).toContain('1411.webp: its sources record disagrees with its pixelsSha256 or inputHash');
    });

    it('deploys only the listed UiMaps (D-042 O5; ATL.10), keeping every composed UiMap\'s sources record, and A4 accepts the others as composed', async () => {
      const deployed = await buildArtSet(source, { ...options, deploy: { uiMaps: [1411], reason: 'Only Durotar, for this test.' } });
      expect(deployed.files.map((f) => f.entry.path)).toEqual(['1411.webp']);
      // The deployed image is byte for byte the one the full build writes.
      expect(deployed.files[0]?.bytes.equals(build.files[1]?.bytes ?? Buffer.alloc(0))).toBe(true);
      const manifest = parseArtManifest(JSON.parse(deployed.manifestText) as unknown);
      expect(manifest.errors).toEqual([]);
      expect(manifest.manifest?.deployment).toEqual({ uiMaps: [1411], reason: 'Only Durotar, for this test.' });
      expect(manifest.manifest?.sources.map((s) => s.uiMapId)).toEqual([947, 1411]);
      const notice = deployed.noticeText.replace(/\s+/g, ' ');
      expect(notice).toContain('1 WebP images of the World of Warcraft world map\'s painted art (1 zone or city map), of the 2 UiMaps that have art');
      expect(notice).toContain('Only Durotar, for this test.');
      // A listed UiMap that is not written, or a written one that is not listed, is refused.
      const edited = JSON.parse(deployed.manifestText) as { deployment: { uiMaps: number[] } };
      edited.deployment.uiMaps = [947, 1411];
      expect(parseArtManifest(edited).errors.join('\n')).toMatch(/files must be exactly the images of deployment\.uiMaps that were composed \(947, 1411\), not 1411/);
      // On disk: A4 counts 947 as composed but not deployed; with an expected list, the manifest must deploy exactly it.
      rmSync(join(dir, '947.webp'));
      writeFile(dir, '1411.webp', deployed.files[0]?.bytes ?? '');
      writeFile(dir, 'manifest.json', deployed.manifestText);
      writeFile(dir, 'NOTICE.md', deployed.noticeText);
      const a4 = (expected: readonly number[] | null): readonly string[] => committedArtChecks(dir, syntheticPlaceholder(), expected).checks.find((c) => c.id === 'A4')?.problems ?? [];
      expect(a4(null)).toEqual(['1411.webp: 10 × 6, the UiMap\'s art is 1002 × 668']);
      expect(a4([1411]).filter((p) => p.includes('deploy'))).toEqual([]);
      expect(a4([947, 1411])).toContain('the manifest deploys UiMaps 1411; D-042 O5 deploys 947, 1411');
      // The full build (no deployment) is refused where a deployment is expected.
      writeFile(dir, 'manifest.json', build.manifestText);
      expect(committedArtChecks(dir, syntheticPlaceholder(), [1411]).checks.find((c) => c.id === 'A4')?.problems).toContain(
        'the manifest deploys every composed image; D-042 O5 deploys only UiMaps 1411 (regenerate with convert.ts)',
      );
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
  it('passes A1-A5 against the committed placeholder: five images since ATL.10 (D-042 O5), every composed UiMap\'s sources kept, within 1.0 MB', () => {
    const geometry = parseGeometryFile(JSON.parse(lfBytes(readFileSync(join(REPO_ROOT, PLACEHOLDER_DIR, GEOMETRY_FILE))).toString('utf8')) as unknown);
    if (!geometry.ok) throw new Error(geometry.errors.join('; '));
    const report = committedArtChecks(join(REPO_ROOT, ART_DIR), geometry.geometry, DEPLOYED_ART_UIMAPS);
    expect(report.checks.map((c) => [c.id, c.problems, c.skipped])).toEqual(['A1', 'A2', 'A3', 'A4', 'A5'].map((id) => [id, [], null]));
    expect(report.manifest?.files.map((f) => f.uiMapId)).toEqual([1459, 1460, 1461, 2521, 2524]);
    expect(report.manifest?.deployment).toEqual({ uiMaps: [1459, 1460, 1461, 2521, 2524], reason: DEPLOYED_ART_REASON });
    // The atlas build checks its client rasters against these (map-atlas.md §7.5 T5): all 60 composed UiMaps.
    expect(report.manifest?.sources).toHaveLength(60);
    expect(ART_BUDGET_GZIP_BYTES).toBe(1_000_000);
    expect(report.gzipBytes).toBeLessThanOrEqual(ART_BUDGET_GZIP_BYTES);
  });
});
