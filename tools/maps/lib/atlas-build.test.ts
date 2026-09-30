import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { atlasHash, atlasPlacements } from '../../../src/geo/atlas';
import { readImageHeader } from '../../../src/infra/maps/image-header';
import { buildAtlas, type AtlasBuild, type AtlasBuildInputs } from './atlas-build';
import { committedAtlasChecks, type AtlasCensusRecorded } from './atlas-checks';
import { indexKeys, parseAtlasIndex } from './atlas-index';
import { parseAtlasManifest } from './atlas-manifest';
import { atlasNoticeText } from './atlas-notice';
import { SEA_DEEP } from './atlas-params';
import { LABEL_COLOUR, flatRaster, synthBuildInputs, synthGeometry, SYNTH_LAYOUT, ZONE_COLOUR } from './atlas-test-support';
import { CLIENT_PIN } from './constants';
import { DEFAULT_WEBP, decodeToRgba, encoderIdentity } from './encode';
import { tempDir, writeFile } from './test-support';

/**
 * The whole atlas build in memory on the synthetic world (atlas-test-support.ts), its determinism,
 * its index, manifest and NOTICE, and the offline checks T1-T9 on the written folder
 * (docs/research/map-atlas.md §7).
 */

const options = {
  client: CLIENT_PIN,
  toolTrees: { trees: { 'tools/casc': 'c'.repeat(40), 'tools/maps': 'd'.repeat(40) }, method: 'git' as const },
  encoder: encoderIdentity(),
  webp: DEFAULT_WEBP,
  encodeJobs: 4,
};

describe('the atlas build on a synthetic world', () => {
  let inputs: AtlasBuildInputs;
  let build: AtlasBuild;
  beforeAll(async () => {
    inputs = await synthBuildInputs({
      zone: flatRaster(ZONE_COLOUR, [{ box: [300, 250, 340, 260], colour: LABEL_COLOUR }]),
      labels: [],
    });
    build = await buildAtlas(inputs, options);
  }, 120_000);

  it('builds the same bytes twice (tiles, index, manifest, NOTICE)', async () => {
    const again = await buildAtlas(inputs, options);
    expect(again.tiles.map((t) => [t.path, t.bytes.toString('base64')])).toEqual(build.tiles.map((t) => [t.path, t.bytes.toString('base64')]));
    expect(again.indexText).toBe(build.indexText);
    expect(again.manifestText).toBe(build.manifestText);
    expect(again.noticeText).toBe(build.noticeText);
  }, 120_000);

  it('stores the zone at its top level and every coarser level it shows at, the card at every level, and nothing over open sea', async () => {
    const levels = new Set(build.tiles.map((t) => t.z));
    expect(levels.has(-2)).toBe(true);
    expect(levels.has(-8)).toBe(true);
    expect(levels.has(-1)).toBe(false);
    for (const t of build.tiles) {
      const header = readImageHeader(t.bytes);
      expect(header).toMatchObject({ ok: true, header: { contentType: 'image/webp', width: 256, height: 256 } });
    }
    // world X 300, Y 600 (area 10): E 1,404, S 1,036, level −2 pixel (351, 259) in stored tile (1, 1)
    const tile = build.tiles.find((t) => t.path === 't/-2/1/1.webp');
    expect(tile).toBeDefined();
    const img = await decodeToRgba(tile?.bytes ?? new Uint8Array());
    const q = ((259 - 256) * 256 + (351 - 256)) * 4;
    expect(Math.abs((img.data[q] ?? 0) - ZONE_COLOUR[0])).toBeLessThan(12);
  });

  it('lists sea keys in the index, and never a stored key as sea', () => {
    const parsed = parseAtlasIndex(JSON.parse(build.indexText) as unknown);
    expect(parsed.errors).toEqual([]);
    const index = parsed.index;
    if (index === null) throw new Error('index');
    const placements = atlasPlacements(synthGeometry(), SYNTH_LAYOUT);
    expect(index.atlasHash).toBe(atlasHash(placements ?? [], SYNTH_LAYOUT));
    expect(index.seaColour).toEqual([...SEA_DEEP]);
    const l2 = index.levels.find((l) => l.z === -2);
    if (l2 === undefined) throw new Error('level −2');
    const keys = indexKeys(l2);
    expect(keys.sea?.length).toBeGreaterThan(0);
    const stored = new Set(keys.stored.map(([x, y]) => `${String(x)},${String(y)}`));
    for (const [x, y] of keys.sea ?? []) expect(stored.has(`${String(x)},${String(y)}`)).toBe(false);
    // map 0 is all sea: its level −2 tiles far from the card are sea keys
    expect(keys.sea?.some(([x, y]) => x === 8 && y === 1)).toBe(true);
    expect(index.levels.find((l) => l.z === 0)?.sea).toBeUndefined();
  });

  it('writes a manifest that parses, lists the five O11 alterations, and regenerates its NOTICE', () => {
    const parsed = parseAtlasManifest(JSON.parse(build.manifestText) as unknown);
    expect(parsed.errors).toEqual([]);
    const m = parsed.manifest;
    if (m === null) throw new Error('manifest');
    expect(m.alterations).toHaveLength(5);
    expect(build.noticeText).toBe(atlasNoticeText(m));
    expect(build.noticeText).toContain('© Blizzard Entertainment, Inc.');
    expect(build.noticeText).toContain('not affiliated with or endorsed by Blizzard Entertainment');
    expect(build.noticeText).toContain('How the tiles alter the art (D-042 O11)');
    expect(build.noticeText).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(m.sources.map((s) => [s.uiMapId, s.role])).toEqual([
      [5000, 'read'],
      [5001, 'polygon'],
      [5002, 'inset'],
    ]);
    expect(m.files[0]?.path).toBe('index.json');
  });

  it('refuses rasters that differ from the art manifest\'s sources records (T5 at build time) and a changed listed painting (T9)', async () => {
    const changed = await synthBuildInputs();
    const stale = { ...changed, artSources: changed.artSources.map((s) => (s.uiMapId === 5001 ? { ...s, pixelsSha256: 'f'.repeat(64) } : s)) };
    await expect(buildAtlas(stale, options)).rejects.toThrow(/differs from the art manifest's sources record/);
    const label = { uiMapId: 5001, name: 'Test Zone', label: 'X', box: [300, 250, 340, 260] as const, rule: 'hide' as const, levels: 'all' as const, reason: 'test', origin: 'hand' as const, pixelsSha256: 'e'.repeat(64) };
    const listed = { ...changed, labels: { labels: [label] } };
    await expect(buildAtlas(listed, options)).rejects.toThrow(/pixels changed/);
  });

  describe('offline checks on the written folder (T1-T9)', () => {
    let dir = '';
    let dispose = (): void => undefined;
    const recorded = (): AtlasCensusRecorded => {
      const census = (JSON.parse(build.manifestText) as { census: { coverage: { byMap: Record<string, Record<string, number>> }; lettering: { candidates: number } } }).census;
      return {
        coverage: Object.fromEntries(Object.entries(census.coverage.byMap).map(([m, c]) => [m, { ownPct: c['ownPct'] ?? 0, tintPct: c['tintPct'] ?? 0, droppedPct: c['droppedPct'] ?? 0 }])),
        letteringCandidates: census.lettering.candidates,
      };
    };
    const run = (overrides: Partial<Parameters<typeof committedAtlasChecks>[0]> = {}): Record<string, readonly string[]> => {
      const report = committedAtlasChecks({
        dir,
        geometry: synthGeometry(),
        layout: SYNTH_LAYOUT,
        artSources: inputs.artSources,
        labels: inputs.labels,
        labelsSha256: inputs.labelsFile.sha256,
        budget: { totalGzipBytes: 8_000_000, perFileGzipCapBytes: 32_000, tolerance: 0.1, levelBaselines: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i - 8), 1_000_000])) },
        recorded: recorded(),
        ...overrides,
      });
      return Object.fromEntries(report.checks.map((c) => [c.id, c.skipped !== null ? [`skipped: ${c.skipped}`] : c.problems]));
    };
    beforeEach(() => {
      ({ dir, dispose } = tempDir('frl-atlas-'));
      for (const t of build.tiles) writeFile(dir, t.path, t.bytes);
      writeFile(dir, 'index.json', build.indexText);
      writeFile(dir, 'manifest.json', build.manifestText);
      writeFile(dir, 'NOTICE.md', build.noticeText);
    });
    afterEach(() => dispose());

    it('passes as written', () => {
      const results = run();
      expect(Object.values(results).flat()).toEqual([]);
      expect(Object.keys(results)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9']);
    });

    it('T1: an edited NOTICE; T2: a changed tile and an unlisted file', () => {
      writeFileSync(join(dir, 'NOTICE.md'), 'edited\n');
      const first = build.tiles[0];
      if (first === undefined) throw new Error('tiles');
      writeFileSync(join(dir, first.path), Buffer.concat([first.bytes, Buffer.from([0])]));
      writeFile(dir, 't/-2/99/99.webp', first.bytes);
      const r = run();
      expect(r['T1']?.join()).toMatch(/NOTICE\.md differs/);
      expect(r['T2']?.join()).toMatch(/SHA-256 differs/);
      expect(r['T2']?.join()).toMatch(/t\/-2\/99\/99\.webp: in the folder but not in the manifest/);
    });

    it('T3: a tile removed from the manifest; T6: over a level baseline', () => {
      const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { files: { path: string }[] };
      const removed = m.files.pop();
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m));
      rmSync(join(dir, removed?.path ?? ''));
      const r = run({ budget: { totalGzipBytes: 8_000_000, perFileGzipCapBytes: 32_000, tolerance: 0.1, levelBaselines: { '-2': 10 } } });
      expect(r['T3']?.join()).toMatch(/stored in the index but not listed in the manifest/);
      expect(r['T6']?.join()).toMatch(/exceeds its baseline|no baseline/);
    });

    it('T4: another layout; T5: another source hash; T7: a census off its recorded value; T9: a changed label list', () => {
      const moved = { ...SYNTH_LAYOUT, seamE: SYNTH_LAYOUT.seamE + 1 };
      const r = run({
        layout: moved,
        artSources: inputs.artSources.map((s) => (s.uiMapId === 5002 ? { ...s, inputHash: '0'.repeat(64) } : s)),
        recorded: { ...recorded(), letteringCandidates: recorded().letteringCandidates + 1 },
        labelsSha256: '1'.repeat(64),
      });
      expect(r['T4']?.join()).toMatch(/atlasHash/);
      expect(r['T5']?.join()).toMatch(/UiMap 5002/);
      expect(r['T7']?.join()).toMatch(/candidates, recorded/);
      expect(r['T9']?.join()).toMatch(/changed after the atlas was built/);
    });

    it('T8: a zone with no stored tile at its top level', () => {
      const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { sources: { uiMapId: number; topLevel: number }[] };
      for (const s of m.sources) if (s.uiMapId === 5001) s.topLevel = -1;
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m));
      expect(run()['T8']?.join()).toMatch(/UiMap 5001 .*no stored tile at its top level -1/);
    });
  });
});
