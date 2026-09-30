import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseGeometryFile } from '../src/geo';
import { atlasHash, atlasPlacements } from '../src/geo/atlas';
import { ATLAS_LAYOUT } from '../src/geo/atlas-layout';
import { atlasIndexRefusal, parseAtlasIndex } from '../src/infra/maps/atlas-index';
import { resolveTile, storedTilesAt, tileLevelOf, type AtlasTileIndex } from '../src/map/adapter';
import { REPO_ROOT } from './support/fake-fetch';

/*
 * The committed atlas tiles as the runtime reads them (docs/research/map-atlas.md §7.2, §8.3, §9.1;
 * step ATL.7): the index parses, is accepted for the committed geometry's placements, agrees with
 * the manifest key for key, and the first view costs at most 100 kB (ATL.7's budget).
 *
 * The minimap style's folder (§18.4, §21.1, §24.2; steps MM.1 and MM.6) is checked the same way once
 * its index is committed: it parses as the minimap style's, every key is stored or sea, its underlay
 * is level −6, and, where the tile pack has been fetched, its first view is at most 100 kB too. A
 * clone without the folder or the pack skips those checks, as `pnpm check` must pass without the
 * tiles (§23.4).
 */

const ATLAS = join(REPO_ROOT, 'public/maps/atlas');
const MINIMAP = join(REPO_ROOT, 'public/maps/minimap');
const json = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8')) as unknown;

interface ManifestFile {
  readonly path: string;
  readonly bytes: number;
}
const manifest = json(join(ATLAS, 'manifest.json')) as { readonly files: readonly ManifestFile[]; readonly seaKeys: Readonly<Record<string, readonly (readonly [number, number])[]>> };

function committedIndex(): AtlasTileIndex {
  const file = parseAtlasIndex(json(join(ATLAS, 'index.json')), './');
  if (typeof file === 'string') throw new Error(file);
  return file.index;
}

/** The committed geometry's atlas hash (check T4, M3). */
function committedHash(): string {
  const geometry = parseGeometryFile(json(join(REPO_ROOT, 'public/maps/placeholder/geometry.placeholder.json')));
  if (!geometry.ok) throw new Error(geometry.errors.join('; '));
  const placements = atlasPlacements(geometry.geometry, ATLAS_LAYOUT);
  if (placements === null) throw new Error('no placements');
  return atlasHash(placements, ATLAS_LAYOUT);
}

/** The fit of the whole extent in a panel, as the adapter fits it (24 px padding), and its tile level. */
function fitOf(index: AtlasTileIndex, width: number, height: number): { readonly zoom: number; readonly level: number } {
  const { eMin, eMax, sMin, sMax } = index.extent;
  const zoom = Math.log2(Math.min((width - 48) / (eMax - eMin), (height - 48) / (sMax - sMin)));
  return { zoom, level: Math.max(index.minLevel, Math.min(index.maxLevel, Math.round(zoom))) };
}

/** The files the tile layer draws for the fitted view (stored keys, and virtual keys' ancestors), as `t/z/x/y.webp`. */
function firstViewFiles(index: AtlasTileIndex, width: number, height: number): readonly string[] {
  const { zoom, level } = fitOf(index, width, height);
  const { eMin, eMax, sMin, sMax } = index.extent;
  const yards = 256 * 2 ** -level;
  const halfE = width / 2 / 2 ** zoom;
  const halfS = height / 2 / 2 ** zoom;
  const cE = (eMin + eMax) / 2;
  const cS = (sMin + sMax) / 2;
  const files = new Set<string>();
  const grid = tileLevelOf(index, level);
  if (grid === null) return [];
  for (let y = Math.floor((cS - halfS) / yards); y <= Math.floor((cS + halfS) / yards); y += 1) {
    for (let x = Math.floor((cE - halfE) / yards); x <= Math.floor((cE + halfE) / yards); x += 1) {
      const resolved = resolveTile(index, level, x, y);
      if (resolved.kind === 'stored') files.add(`t/${String(level)}/${String(x)}/${String(y)}.webp`);
      if (resolved.kind === 'virtual') files.add(`t/${String(resolved.z)}/${String(resolved.x)}/${String(resolved.y)}.webp`);
    }
  }
  return [...files].sort();
}

describe('the committed atlas tiles at runtime (map-atlas.md §7.2)', () => {
  it('parses, and is accepted for the committed geometry’s placements in the compact layout', () => {
    const index = committedIndex();
    const geometry = parseGeometryFile(json(join(REPO_ROOT, 'public/maps/placeholder/geometry.placeholder.json')));
    if (!geometry.ok) throw new Error(geometry.errors.join('; '));
    const placements = atlasPlacements(geometry.geometry, ATLAS_LAYOUT);
    if (placements === null) throw new Error('no placements');
    const hash = atlasHash(placements, ATLAS_LAYOUT);
    const file = parseAtlasIndex(json(join(ATLAS, 'index.json')), './');
    if (typeof file === 'string') throw new Error(file);
    expect(atlasIndexRefusal(file, hash)).toBeNull();
    expect(index.hash).toBe(hash);
  });

  it('lists exactly the manifest’s tiles as stored and its sea keys as sea', () => {
    const index = committedIndex();
    const tiles = manifest.files.map((entry) => entry.path).filter((path) => path.startsWith('t/'));
    const stored = index.levels.flatMap((level) => storedTilesAt(index, level.z).map(([x, y]) => `t/${String(level.z)}/${String(x)}/${String(y)}.webp`));
    expect(stored.sort()).toEqual([...tiles].sort());
    for (const level of index.levels) {
      if (level.z > index.baseLevel) continue;
      const sea: string[] = [];
      for (let y = 0; y < level.ny; y += 1) for (let x = 0; x < level.nx; x += 1) if (resolveTile(index, level.z, x, y).kind === 'sea') sea.push(`${String(x)},${String(y)}`);
      expect(sea.sort(), String(level.z)).toEqual((manifest.seaKeys[String(level.z)] ?? []).map(([x, y]) => `${String(x)},${String(y)}`).sort());
    }
  });

  it('gives the underlay every stored level −5 key: 13 files', () => {
    const index = committedIndex();
    expect(index.underlayLevel).toBe(-5);
    expect(storedTilesAt(index, -5)).toHaveLength(13);
  });

  it('keeps the first view at or under 100 kB (ATL.7), index included, in the panels of §5.6', () => {
    const index = committedIndex();
    const indexBytes = readFileSync(join(ATLAS, 'index.json'));
    const report: Record<string, unknown> = {};
    for (const [width, height] of [
      [918, 700],
      [1366, 768],
      [700, 500],
    ] as const) {
      const files = firstViewFiles(index, width, height);
      const raw = files.reduce((sum, path) => sum + readFileSync(join(ATLAS, path)).length, indexBytes.length);
      const gzip = files.reduce((sum, path) => sum + gzipSync(readFileSync(join(ATLAS, path)), { level: 6 }).length, gzipSync(indexBytes, { level: 6 }).length);
      report[`${String(width)}x${String(height)}`] = { zoom: Number(fitOf(index, width, height).zoom.toFixed(3)), level: fitOf(index, width, height).level, files: files.length, raw, gzip };
      expect(raw, `${String(width)}×${String(height)}`).toBeLessThanOrEqual(100_000);
    }
    // The measured figures (docs/measurements/map-atlas.json, atl7.firstView).
    expect(report).toMatchObject({ '918x700': { level: -5, files: 13 }, '1366x768': { level: -5, files: 13 }, '700x500': { level: -6, files: 4 } });
  });
});

describe.skipIf(!existsSync(join(MINIMAP, 'index.json')))('the committed minimap index at runtime (map-atlas.md §18.4, §21.1, §24.2)', () => {
  const minimapIndex = (): AtlasTileIndex => {
    const file = parseAtlasIndex(json(join(MINIMAP, 'index.json')), './', 'minimap');
    if (typeof file === 'string') throw new Error(file);
    expect(file.urlTemplate).toBe('./maps/minimap/t/{z}/{x}/{y}.webp');
    expect(atlasIndexRefusal(file, committedHash())).toBeNull();
    return file.index;
  };

  it('parses as the minimap style’s, for the committed placements, with every key stored or sea and a level −6 underlay', () => {
    const index = minimapIndex();
    expect([index.baseLevel, index.underlayLevel, index.uiMaps.size]).toEqual([0, -6, 0]);
    for (const level of index.levels) {
      for (let y = 0; y < level.ny; y += 1) {
        for (let x = 0; x < level.nx; x += 1) expect(resolveTile(index, level.z, x, y).kind, `${String(level.z)}/${String(x)}/${String(y)}`).not.toBe('virtual');
      }
    }
    expect(storedTilesAt(index, -6)).toHaveLength(4);
  });

  it.skipIf(!existsSync(join(MINIMAP, 't')))('keeps the first view at or under 100 kB, index included, where the tile pack is present (§24.2)', () => {
    const index = minimapIndex();
    const indexBytes = readFileSync(join(MINIMAP, 'index.json')).length;
    for (const [width, height] of [
      [918, 700],
      [1366, 768],
      [700, 500],
    ] as const) {
      const raw = firstViewFiles(index, width, height).reduce((sum, path) => sum + readFileSync(join(MINIMAP, path)).length, indexBytes);
      expect(raw, `${String(width)}×${String(height)}`).toBeLessThanOrEqual(100_000);
    }
  });
});
