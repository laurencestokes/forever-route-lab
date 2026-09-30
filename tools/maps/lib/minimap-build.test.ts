/**
 * The whole minimap build on a synthetic world (docs/research/map-atlas.md §18, §24.4; steps MM.3
 * and MM.4): a double build is byte-identical, the keys, index and pack are as designed, the runtime
 * parser accepts the index, and the offline checks M1-M11 pass on the folder and each fails on a
 * tampered copy. No client bytes.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseAtlasIndex } from '../../../src/infra/maps/atlas-index';
import { resolveTile } from '../../../src/map/adapter';
import { reduce } from './atlas-pyramid';
import { SYNTH_LAYOUT, synthGeometry } from './atlas-test-support';
import type { CheckResult } from './checks';
import { DEFAULT_WEBP, encoderIdentity } from './encode';
import { buildMinimap, type MinimapBuild, type MinimapBuildInputs } from './minimap-build';
import { minimapChecks, type MinimapCheckInputs } from './minimap-checks';
import type { MinimapTileSource } from './minimap-inputs';
import { tarEntries } from './minimap-pack';
import { remanifestMinimap } from './minimap-remanifest';
import { MINIMAP_MAX_LEVEL, MINIMAP_MIN_LEVEL, NAVY } from './minimap-params';
import { resampleRect } from './minimap-stitch';
import { reliefOf, synthWorld } from './minimap-test-support';
import { tileKey } from './minimap-texels';

const ckey = (n: number): string => n.toString(16).padStart(32, '0');

function inputs(): MinimapBuildInputs {
  const world = synthWorld();
  let fdid = 1000;
  const maps = world.maps.map(({ texels, liquid }) => {
    const tiles: MinimapTileSource[] = texels.tiles.map((t) => {
      fdid += 2;
      return { row: t.row, col: t.col, minimap: { fileDataId: fdid, ckey: ckey(fdid) }, rootAdt: { fileDataId: fdid + 1, ckey: ckey(fdid + 1) } };
    });
    return {
      source: { mapId: texels.mapId, directory: `Synth${String(texels.mapId)}`, wdt: { fileDataId: 900 + texels.mapId, ckey: ckey(900 + texels.mapId) }, tiles },
      liquid,
      texels: (t: MinimapTileSource) => new Uint8Array(texels.rgb.get(tileKey(t.row, t.col)) ?? new Uint8Array(0)),
    };
  });
  const first = world.maps[0];
  if (first === undefined) throw new Error('no map 1');
  const relief1 = reliefOf(1, first.liquid);
  return {
    layout: SYNTH_LAYOUT,
    geometry: synthGeometry(),
    maps,
    reliefs: new Map([[1, { ...relief1, path: 'synthetic/1/relief.png', sha256: '0'.repeat(64) }]]),
    terrainManifestSha256: '1'.repeat(64),
    tables: [
      { table: 'Map', fileDataId: 1349477, ckey: ckey(1) },
      { table: 'LiquidType', fileDataId: 1371380, ckey: ckey(2), hazardIds: [3] },
    ],
  };
}

const options = { client: { product: 'wow_classic_beta', version: '1.60.1.70009', buildKey: '05215079e3905ef5922ae0b03ffefb73' }, tool: { hash: 'a'.repeat(64), files: 1 }, node: 'v22', encoder: encoderIdentity(), webp: DEFAULT_WEBP, encodeJobs: 4, keepForReview: true };

function writeFolder(dir: string, b: MinimapBuild): void {
  mkdirSync(dir, { recursive: true });
  for (const t of b.tiles) {
    mkdirSync(dirname(join(dir, t.path)), { recursive: true });
    writeFileSync(join(dir, t.path), t.bytes);
  }
  writeFileSync(join(dir, 'index.json'), b.indexText);
  writeFileSync(join(dir, 'manifest.json'), b.manifestText);
  writeFileSync(join(dir, 'NOTICE.md'), b.noticeText);
  writeFileSync(join(dir, 'pack.json'), b.pointerText);
}

let build: MinimapBuild;
let again: MinimapBuild;
let work: string;
let base: MinimapCheckInputs;

beforeAll(async () => {
  build = await buildMinimap(inputs(), options);
  again = await buildMinimap(inputs(), options);
  work = mkdtempSync(join(tmpdir(), 'frl-minimap-'));
  writeFolder(join(work, 'good'), build);
  writeFileSync(join(work, 'pack.tar'), build.pack);
  const inp = inputs();
  base = {
    dir: join(work, 'good'),
    layout: SYNTH_LAYOUT,
    geometry: synthGeometry(),
    paintedIndex: JSON.parse(build.indexText) as unknown,
    reliefs: inp.reliefs,
    packFile: join(work, 'pack.tar'),
    recordedCounts: { '1': 4, '0': 1, '2991': 1 },
  };
}, 120_000);

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('buildMinimap on a synthetic world', () => {
  it('is byte-identical when built twice: tiles, index, manifest, NOTICE, pointer and pack', () => {
    expect(again.tiles.map((t) => [t.path, t.sha256, t.rawSha256])).toEqual(build.tiles.map((t) => [t.path, t.sha256, t.rawSha256]));
    expect(again.indexText).toBe(build.indexText);
    expect(again.manifestText).toBe(build.manifestText);
    expect(again.noticeText).toBe(build.noticeText);
    expect(again.pointerText).toBe(build.pointerText);
    expect(again.pack.equals(build.pack)).toBe(true);
  });

  it('passes its gates and stores every level, with no flat tile other than the navy', () => {
    expect(build.failures).toEqual([]);
    expect(build.levels.map((l) => l.z)).toEqual(Array.from({ length: 9 }, (_, i) => MINIMAP_MIN_LEVEL + i));
    for (const l of build.levels) {
      expect(l.stored).toBeGreaterThan(0);
      expect(l.flatNonSea).toBe(0);
    }
    expect(build.levels.find((l) => l.z === 0)?.sea).toBeGreaterThan(0);
  });

  it('writes an index the runtime accepts, in which every key is stored or sea (no virtual keys)', () => {
    const parsed = parseAtlasIndex(JSON.parse(build.indexText) as unknown, '/', 'minimap');
    if (typeof parsed === 'string') throw new Error(parsed);
    expect(parsed.index.baseLevel).toBe(0);
    expect(parsed.index.underlayLevel).toBe(-6);
    expect(parsed.index.seaColour).toEqual(NAVY);
    for (const level of parsed.index.levels) {
      for (let y = 0; y < level.ny; y += 1) {
        for (let x = 0; x < level.nx; x += 1) expect(['stored', 'sea']).toContain(resolveTile(parsed.index, level.z, x, y).kind);
      }
    }
    const idx = JSON.parse(build.indexText) as { style: string; uiMaps: object; atlasHash: string };
    expect(idx.style).toBe('minimap');
    expect(idx.uiMaps).toEqual({});
    expect(idx.atlasHash).toBe(build.atlasHash);
  });

  it('reduces every level exactly from level 0', () => {
    const review = build.review;
    if (review === null) throw new Error('no review data');
    const l1 = review.levels.get(-1);
    const key = [...(l1?.keys() ?? [])][0] ?? '0,0';
    const [x, y] = key.split(',').map(Number) as [number, number];
    const level0 = resampleRect(x * 512, y * 512, 512, 512, review.stitch, review.owner, review.extentW, review.extentH);
    const reduced = reduce({ w: 512, h: 512, d: level0 });
    expect(Buffer.from(reduced.d).equals(Buffer.from(l1?.get(key) ?? new Uint8Array(0)))).toBe(true);
  });

  it('packs NOTICE.md, manifest.json and the tiles, in that order, and pins the pack by SHA-256', () => {
    const entries = tarEntries(build.pack);
    expect(entries.slice(0, 2).map((e) => e.path)).toEqual(['NOTICE.md', 'manifest.json']);
    expect(entries.slice(2).map((e) => e.path)).toEqual(build.tiles.map((t) => t.path));
    expect(build.pointer.bytes).toBe(build.pack.length);
    const manifest = JSON.parse(build.manifestText) as { pack: { treeHash: string }; census: Record<string, unknown>; files: { path: string }[] };
    expect(manifest.pack.treeHash).toBe(build.pointer.treeHash);
    expect(Object.keys(manifest.census)).toEqual(expect.arrayContaining(['maps', 'seams', 'seamsReliefMask', 'contrast', 'rampAgreement', 'landUnderSea', 'gates']));
    expect(manifest.files.map((f) => f.path)).not.toContain('pack.json');
    // MD-02: the manifest records no name or tag (they carry the pack's SHA-256); the pointer's do
    expect(Object.keys(manifest.pack).sort()).toEqual(['contents', 'treeHash']);
    expect(build.pointer.asset).toBe(`minimap-tiles-${build.pointer.treeHash.slice(0, 12)}-${build.pointer.sha256.slice(0, 12)}.tar`);
    expect(build.pointer.tag.endsWith(`-${build.pointer.treeHash.slice(0, 12)}-${build.pointer.sha256.slice(0, 12)}`)).toBe(true);
  });

  it('names Blizzard, the alterations and what is kept in the NOTICE, and draws no legal conclusion', () => {
    expect(build.noticeText).toMatch(/Blizzard Entertainment/);
    expect(build.noticeText).toMatch(/not affiliated with or endorsed by Blizzard Entertainment/);
    expect(build.noticeText).toMatch(/1\. Water is recoloured onto a navy ramp/);
    expect(build.noticeText).toMatch(/Swamp and brown water/);
    expect(build.noticeText).toMatch(/draw no\s+legal conclusion/);
  });

  it('states the owner decision plainly and how far the recolour reaches onto dry ground (MD-05)', () => {
    const text = build.noticeText.replace(/\s+/g, ' ');
    expect(text).toContain('The owner decided (docs/DECISIONS.md D-045, D-049) that the sea is recoloured to one navy and the maps are drawn as one. The tiles alter the textures as follows:');
    expect(text).not.toMatch(/are covered by/);
    expect(text).toContain('fading out by about 8 yd (4–8 yd)');
    expect(text).not.toMatch(/4-8 yd/);
    expect(text).toContain('water-coloured dry ground within about 8 yd of water (banks, and shallows the terrain data calls dry) may be darkened or shifted toward the navy, but is never brightened');
    // the census's own counts, per drawn map, with their basis
    expect(text).toMatch(/How far the recolour reaches onto dry ground, from the census in `manifest\.json` \(native texels, before the resample\): .* recoloured by half or more \(weight 0\.5 or over\): .*; texels brightened: 0\./);
  });
});

describe('the offline checks M1-M11', () => {
  const byId = (checks: readonly CheckResult[], id: string): CheckResult => {
    const c = checks.find((x) => x.id === id);
    if (c === undefined) throw new Error(`no ${id}`);
    return c;
  };

  it('all pass on the folder as built, and M6, M8 and M11 say they are skipped without the tiles', async () => {
    const report = await minimapChecks(base);
    for (const c of report.checks) expect([c.id, c.problems, c.skipped]).toEqual([c.id, [], null]);
    expect(report.checks.map((c) => c.id)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11']);
    const bare = join(work, 'bare');
    cpSync(base.dir, bare, { recursive: true });
    rmSync(join(bare, 't'), { recursive: true });
    const without = await minimapChecks({ ...base, dir: bare, packFile: null });
    expect(without.tilesPresent).toBe(0);
    for (const id of ['M6', 'M8', 'M11']) expect(byId(without.checks, id).skipped).not.toBeNull();
    for (const id of ['M1', 'M2', 'M3', 'M4', 'M5', 'M7', 'M9', 'M10']) expect(byId(without.checks, id).problems).toEqual([]);
  });

  /** A copy of the folder with one change; the named check must fail on it. */
  async function tampered(id: string, change: (dir: string) => void | Promise<void>, over: Partial<MinimapCheckInputs> = {}): Promise<void> {
    const dir = join(work, `bad-${id}`);
    rmSync(dir, { recursive: true, force: true });
    cpSync(base.dir, dir, { recursive: true });
    await change(dir);
    const report = await minimapChecks({ ...base, ...over, dir });
    expect(byId(report.checks, id).problems.length, `${id} should fail`).toBeGreaterThan(0);
  }
  const editJson = (dir: string, file: string, edit: (v: Record<string, unknown>) => void): void => {
    const v = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>;
    edit(v);
    writeFileSync(join(dir, file), `${JSON.stringify(v, null, 2)}\n`);
  };
  const census = (v: Record<string, unknown>): Record<string, Record<string, Record<string, unknown>>> => v['census'] as Record<string, Record<string, Record<string, unknown>>>;

  it('M1 fails on an edited NOTICE', () => tampered('M1', (d) => writeFileSync(join(d, 'NOTICE.md'), '# not the notice\n')));
  it('M2 fails on an index with another underlay level', () => tampered('M2', (d) => editJson(d, 'index.json', (v) => (v['underlayLevel'] = -5))));
  it('M3 fails on an index composed for other placements', () => tampered('M3', (d) => editJson(d, 'index.json', (v) => (v['atlasHash'] = '0'.repeat(32)))));
  it('M4 fails on a repeated FileDataID', () =>
    tampered('M4', (d) =>
      editJson(d, 'manifest.json', (v) => {
        const rows = ((v['sources'] as Record<string, Record<string, unknown[][]>>)['minimaps'] as Record<string, unknown[][]>)['rows'] as unknown[][];
        (rows[1] as unknown[])[3] = (rows[0] as unknown[])[3];
      }),
    ));
  it('M5 fails over the budget', () => tampered('M5', () => undefined, { budget: { totalGzipBytes: 1000, perTileGzipBytes: 32_000, tolerance: 0.1, levelBaselines: {} } }));
  it('M6 fails on a tile that is not the manifest\'s', () =>
    tampered('M6', async (d) => {
      const tile = build.tiles[0]?.path ?? '';
      writeFileSync(join(d, tile), await sharp({ create: { width: 256, height: 256, channels: 3, background: { r: 1, g: 2, b: 3 } } }).webp().toBuffer());
    }));
  it('M7 fails on a pointer with another SHA-256', () => tampered('M7', (d) => editJson(d, 'pack.json', (v) => (v['sha256'] = 'f'.repeat(64)))));
  it('M8 fails when the census\'s relief agreement is not the tiles\'', () =>
    tampered('M8', (d) =>
      editJson(d, 'manifest.json', (v) => {
        const r = census(v)['rampAgreement']?.['1'] as Record<string, number>;
        r['waterOnRamp'] = 0;
      }),
    ));
  it('M9 fails when a sea key covers land', () =>
    tampered('M9', (d) =>
      editJson(d, 'index.json', (v) => {
        const levels = v['levels'] as { z: number; stored: string; sea: string }[];
        const top = levels.find((l) => l.z === MINIMAP_MAX_LEVEL - 8);
        if (top !== undefined) top.sea = top.stored;
      }),
    ));
  it('M10 fails on a changed parameter', () =>
    tampered('M10', (d) =>
      editJson(d, 'manifest.json', (v) => {
        ((v['parameters'] as Record<string, Record<string, unknown>>)['recolour'] as Record<string, unknown>)['rampSpan'] = 61;
      }),
    ));
  it('M11 fails when the census\'s seams are not the tiles\'', () =>
    tampered('M11', (d) =>
      editJson(d, 'manifest.json', (v) => {
        const level = census(v)['seamsReliefMask']?.['-1'] as unknown as { perMap: Record<string, { edgesLong: { over4: number } }> };
        const m = level.perMap['1'];
        if (m !== undefined) m.edgesLong.over4 += 5;
      }),
    ));
});

describe('the re-derivation without the client (minimap-remanifest.ts; MD-01, MD-02, MD-05)', () => {
  const legacy = (dir: string): void => {
    // the committed folder as the earlier tool wrote it: old wording, the pack record with a name and tag
    cpSync(base.dir, dir, { recursive: true });
    const v = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    const pack = v['pack'] as Record<string, unknown>;
    v['pack'] = { asset: 'minimap-tiles-000000000000.tar', tag: 'minimap-1.60.1.70009-000000000000', ...pack };
    v['alterations'] = [{ id: 1, what: 'old wording' }];
    writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(v, null, 2)}\n`);
  };

  it('carries every client-derived record over, recomputes only the code’s part, records that it did, and passes M1-M11', async () => {
    const dir = join(work, 'remanifest');
    rmSync(dir, { recursive: true, force: true });
    legacy(dir);
    const out = remanifestMinimap(dir, options.tool, 'test');
    const got = JSON.parse(out.manifestText) as { tool: Record<string, unknown> };
    expect(got.tool['remanifest']).toEqual({ fromToolTreeHash: options.tool.hash, fromPackSha256: build.pointer.sha256, why: 'test' });
    delete got.tool['remanifest'];
    // with the same tool tree the re-derived manifest and NOTICE are the client build's, byte for byte
    expect(`${JSON.stringify(got, null, 2)}\n`).toBe(`${JSON.stringify(JSON.parse(build.manifestText), null, 2)}\n`);
    expect(out.noticeText).toBe(build.noticeText);
    expect(out.pointer.treeHash).toBe(build.pointer.treeHash);
    expect(out.pointer.sha256).not.toBe(build.pointer.sha256);
    writeFileSync(join(dir, 'manifest.json'), out.manifestText);
    writeFileSync(join(dir, 'NOTICE.md'), out.noticeText);
    writeFileSync(join(dir, 'pack.json'), out.pointerText);
    writeFileSync(join(work, 'remanifest.tar'), out.pack);
    const report = await minimapChecks({ ...base, dir, packFile: join(work, 'remanifest.tar') });
    for (const c of report.checks) expect([c.id, c.problems]).toEqual([c.id, []]);
    // a second run keeps the last client build as its origin
    expect(remanifestMinimap(dir, { hash: 'b'.repeat(64), files: 2 }, 'again').record.fromToolTreeHash).toBe(options.tool.hash);
  }, 120_000);

  it('refuses a tile that is not the manifest’s, an unlisted file and a changed parameter', () => {
    const dir = join(work, 'remanifest-bad');
    const fresh = (): void => {
      rmSync(dir, { recursive: true, force: true });
      legacy(dir);
    };
    fresh();
    writeFileSync(join(dir, build.tiles[0]?.path ?? ''), Buffer.from('not the tile'));
    expect(() => remanifestMinimap(dir, options.tool, 'test')).toThrow(/size or SHA-256 differs from the manifest/);
    fresh();
    writeFileSync(join(dir, 't', '0', 'stray.webp'), Buffer.from('x'));
    expect(() => remanifestMinimap(dir, options.tool, 'test')).toThrow(/not in the manifest/);
    fresh();
    const v = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<string, Record<string, Record<string, unknown>>>;
    const params = v['parameters'];
    if (params?.['recolour'] !== undefined) params['recolour']['rampSpan'] = 61;
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(v));
    expect(() => remanifestMinimap(dir, options.tool, 'test')).toThrow(/parameters are not minimap-params\.ts's/);
  });
});
