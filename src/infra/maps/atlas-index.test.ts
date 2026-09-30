import { describe, expect, it } from 'vitest';
import { indexJson, MINIMAP_NAVY, syntheticIndex, TEST_HASH } from '../../../tests/support/atlas-tiles';
import { resolveTile } from '../../map/adapter';
import { ATLAS_STYLE_DIRS, atlasIndexRefusal, decodeBase64, parseAtlasIndex, type AtlasIndexFile } from './atlas-index';

/*
 * The atlas tile index loader (docs/research/map-atlas.md §7.2, §8.6; step ATL.7): the shape
 * checks that refuse a malformed index as a whole, the arithmetic base64 and bitmap decoding, and
 * the refusal of an index composed for other placements.
 */

const INDEX = syntheticIndex({ stored: { [-8]: [[0, 0]], [-5]: [[1, 1]], [-2]: [[5, 5]] }, sea: { [-2]: [[12, 12]] } });

const parsed = (json: unknown): AtlasIndexFile => {
  const result = parseAtlasIndex(json, '/app/');
  if (typeof result === 'string') throw new Error(result);
  return result;
};

describe('decodeBase64', () => {
  it('decodes standard base64 with and without padding, as Buffer does', () => {
    for (const bytes of [[], [0], [255, 1], [1, 2, 3], [0, 208], [127, 255, 127, 247, 119, 119, 0], Array.from({ length: 97 }, (_, i) => (i * 37) % 256)]) {
      const text = Buffer.from(bytes).toString('base64');
      expect([...(decodeBase64(text) ?? [])], text).toEqual(bytes);
    }
  });

  it('refuses text that is not base64', () => {
    expect(decodeBase64('abc')).toBeNull();
    expect(decodeBase64('ab=c')).toBeNull();
    expect(decodeBase64('a$cd')).toBeNull();
  });
});

describe('parseAtlasIndex', () => {
  it('decodes the index the tool writes: levels, bitmaps, colours, extent and UiMaps', () => {
    const file = parsed(indexJson(INDEX));
    expect(file.urlTemplate).toBe('/app/maps/atlas/t/{z}/{x}/{y}.webp');
    expect(file.layout).toBe('compact');
    expect(file.index.hash).toBe(TEST_HASH);
    expect(file.index.levels.map((level) => [level.z, level.nx, level.ny, level.sea === null])).toEqual(INDEX.levels.map((level) => [level.z, level.nx, level.ny, level.sea === null]));
    expect(file.index.seaColour).toEqual([61, 55, 41]);
    expect(file.index.coastColour).toEqual([131, 118, 88]);
    expect(file.index.extent).toEqual(INDEX.extent);
    expect([...file.index.uiMaps]).toEqual([[1411, { topLevel: -2, ydPerPx: 5.277 }]]);
    // The decoded bitmaps resolve every key as the synthetic index does.
    for (const [z, x, y] of [[-8, 0, 0], [-5, 1, 1], [-2, 5, 5], [-2, 12, 12], [-1, 24, 25], [0, 21, 22], [-3, 7, 7]] as const) {
      expect(resolveTile(file.index, z, x, y)).toEqual(resolveTile(INDEX, z, x, y));
    }
  });

  it('refuses the whole index for any malformed field (fail closed)', () => {
    const good = indexJson(INDEX);
    const levels = good['levels'] as Record<string, unknown>[];
    const cases: readonly [string, unknown][] = [
      ['not an object', []],
      ['schema', { ...good, schema: 2 }],
      ['kind', { ...good, kind: 'map-art' }],
      ['atlasHash', { ...good, atlasHash: 'ABC' }],
      ['tileSize', { ...good, tileSize: 0 }],
      ['template', { ...good, template: '../t/{z}/{x}/{y}.webp' }],
      ['levels', { ...good, baseLevel: 3 }],
      ['seaColour', { ...good, seaColour: [61, 55] }],
      ['extent', { ...good, extent: { eMin: 0, eMax: 0, sMin: 0, sMax: 1 } }],
      ['levels', { ...good, levels: levels.slice(1) }],
      ['stored', { ...good, levels: levels.map((level, i) => (i === 6 ? { ...level, stored: 'AA==' } : level)) }],
      ['sea', { ...good, levels: levels.map((level, i) => (i === 6 ? { z: level['z'], nx: level['nx'], ny: level['ny'], stored: level['stored'] } : level)) }],
      ['sea', { ...good, levels: levels.map((level, i) => (i === 7 ? { ...level, sea: 'AA==' } : level)) }],
      ['uiMaps', { ...good, uiMaps: { '1411': [-9, 5] } }],
    ];
    for (const [what, json] of cases) {
      const result = parseAtlasIndex(json, '/app/');
      expect(typeof result, what).toBe('string');
      if (what !== 'not an object' && what !== 'levels') expect(result, what).toContain(what);
    }
  });
});

describe('parseAtlasIndex for the minimap style (map-atlas.md §18.4, §21.1; MM.1)', () => {
  // Levels −8 … 0 all stored in part, every other key sea, as the minimap tool writes them.
  const MINIMAP = syntheticIndex({
    style: 'minimap',
    stored: {
      [-8]: [[0, 0]],
      [-6]: [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ],
      [-2]: [[5, 5]],
      [0]: [[20, 20]],
    },
  });

  it('accepts a base level 0 index with its level −6 underlay, in the minimap directory, and resolves every key as stored or sea', () => {
    const result = parseAtlasIndex(indexJson(MINIMAP, 'minimap'), '/app/', 'minimap');
    if (typeof result === 'string') throw new Error(result);
    expect(result.style).toBe('minimap');
    expect(result.urlTemplate).toBe('/app/maps/minimap/t/{z}/{x}/{y}.webp');
    expect([result.index.baseLevel, result.index.underlayLevel, result.index.uiMaps.size]).toEqual([0, -6, 0]);
    expect([result.index.seaColour, result.index.coastColour]).toEqual([MINIMAP_NAVY, MINIMAP_NAVY]);
    expect(result.index.levels.every((level) => level.sea !== null)).toBe(true);
    for (const level of result.index.levels) {
      for (let y = 0; y < level.ny; y += 1) {
        for (let x = 0; x < level.nx; x += 1) {
          const kind = resolveTile(result.index, level.z, x, y).kind;
          expect(kind === 'stored' || kind === 'sea', `${String(level.z)}/${String(x)}/${String(y)}`).toBe(true);
          expect(kind).toBe(resolveTile(MINIMAP, level.z, x, y).kind);
        }
      }
    }
  });

  it('refuses another style’s index, and a style it does not know', () => {
    expect(parseAtlasIndex(indexJson(MINIMAP, 'minimap'), '/app/', 'painted')).toBe('it is the minimap style’s index, not the painted style’s');
    // The painted index predates the field: without it, an index is the painted style's.
    expect(parseAtlasIndex(indexJson(INDEX), '/app/', 'minimap')).toBe('it is the painted style’s index, not the minimap style’s');
    expect(parseAtlasIndex({ ...indexJson(MINIMAP, 'minimap'), style: 'satellite' }, '/app/', 'minimap')).toBe('style must be minimap or painted');
    expect(parsed(indexJson(INDEX)).style).toBe('painted');
    expect(ATLAS_STYLE_DIRS).toEqual({ painted: 'maps/atlas/', minimap: 'maps/minimap/' });
  });

  it('accepts only the WebP template (D-049 O13)', () => {
    expect(parseAtlasIndex({ ...indexJson(MINIMAP, 'minimap'), template: 't/{z}/{x}/{y}.avif' }, '/app/', 'minimap')).toBe('template must be t/{z}/{x}/{y}.webp');
  });
});

describe('atlasIndexRefusal (map-atlas.md §7.2, §8.6)', () => {
  it('accepts an index composed for the surface’s placements and refuses any other, saying why', () => {
    const file = parsed(indexJson(INDEX));
    expect(atlasIndexRefusal(file, TEST_HASH)).toBeNull();
    const refusal = atlasIndexRefusal(file, 'fedcba9876543210fedcba9876543210');
    expect(refusal).toContain('0123456789ab');
    expect(refusal).toContain('fedcba987654');
    expect(refusal).toContain('other placements');
  });
});
