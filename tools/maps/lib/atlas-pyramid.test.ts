import { describe, expect, it } from 'vitest';
import { indexKeys, levelBitmaps, parseAtlasIndex } from './atlas-index';
import { SEA_DEEP, TILE } from './atlas-params';
import { topLevels } from './atlas-plan';
import {
  ancestorSampler,
  bitmapBase64,
  bitmapKeys,
  classifyTile,
  extractTile,
  isSeaTile,
  nearestAncestor,
  reduce,
  reductions,
  shiftDown,
  tilesOfRect,
  tileTopLevel,
  type Rgb8,
} from './atlas-pyramid';

/** The pyramid rules of docs/research/map-atlas.md §6.3, §6.4, §7.1 and §7.2 on synthetic rasters. */

const raster = (w: number, h: number, f: (x: number, y: number) => readonly number[]): Rgb8 => {
  const d = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) d.set(f(x, y), (y * w + x) * 3);
  return { w, h, d };
};

describe('reductions (§6.3)', () => {
  it('is an exact 2×2 box, rounded half up', () => {
    const src = raster(4, 2, (x) => [x, 10 * x, 255 - x]);
    const r = reduce(src);
    expect([r.w, r.h]).toEqual([2, 1]);
    // (0 + 1 + 0 + 1 + 2) / 4 = 1 (floor of 1.0); (2 + 3 + 2 + 3 + 2) / 4 = 3
    expect([...r.d]).toEqual([1, 5, 255, 3, 25, 253]);
  });

  it('builds levels −3 … −8 from level −2, each half the size of the one above', () => {
    const levels = reductions(raster(512, 256, () => [9, 9, 9]));
    expect([...levels.keys()]).toEqual([-2, -3, -4, -5, -6, -7, -8]);
    expect(levels.get(-3)?.w).toBe(256);
    expect(levels.get(-8)?.w).toBe(8);
    expect([...(levels.get(-8)?.d.subarray(0, 3) ?? [])]).toEqual([9, 9, 9]);
  });
});

describe('the sparse rule (§7.1, MA-10)', () => {
  it('a tile of the deep-sea colour only is a sea key; padding beyond the level is sea', () => {
    const level = raster(300, 256, (x) => (x < 280 ? [...SEA_DEEP] : [1, 2, 3]));
    expect(isSeaTile(extractTile(level, 0, 0, SEA_DEEP), SEA_DEEP)).toBe(true);
    const edge = extractTile(level, 1, 0, SEA_DEEP);
    expect(isSeaTile(edge, SEA_DEEP)).toBe(false);
    expect([...edge.subarray(0, 3)]).toEqual([...SEA_DEEP]);
    expect([...edge.subarray(24 * 3, 25 * 3)]).toEqual([1, 2, 3]);
    expect([...edge.subarray((TILE - 1) * 3, TILE * 3)]).toEqual([...SEA_DEEP]);
  });

  it('stores a tile whose content reaches the level, and draws the rest from an ancestor', () => {
    const land = new Uint8Array(TILE * TILE * 3).fill(100);
    expect(classifyTile(land, SEA_DEEP, -2, -2)).toBe('stored');
    expect(classifyTile(land, SEA_DEEP, -4, -3)).toBe('virtual');
    expect(classifyTile(land, SEA_DEEP, -4, -4)).toBe('stored');
    expect(classifyTile(new Uint8Array(TILE * TILE * 3).map((_, i) => SEA_DEEP[i % 3] ?? 0), SEA_DEEP, 0, -2)).toBe('sea');
  });

  it('takes a coarse tile\'s top level from the level −2 tiles it covers', () => {
    // a 4 × 4 grid of level −2 tiles; one reaches level 0
    const tileMax = new Int8Array(16).fill(-4);
    tileMax[1 * 4 + 3] = 0;
    expect(tileTopLevel(tileMax, 4, 4, -3, 1, 0)).toBe(0);
    expect(tileTopLevel(tileMax, 4, 4, -3, 0, 0)).toBe(-4);
    expect(tileTopLevel(tileMax, 4, 4, -4, 0, 0)).toBe(0);
    expect(tileTopLevel(tileMax, 4, 4, -2, 3, 1)).toBe(0);
  });
});

describe('fine levels and virtual keys (§6.4)', () => {
  const level2 = raster(512, 512, (x, y) => [x % 256, y % 256, 7]);
  const levels = new Map([[-2, level2]]);

  it('finds the nearest stored ancestor, a stored level −1 tile first', () => {
    const fine = new Map([['3,1', new Uint8Array(TILE * TILE * 3)]]);
    const stored = (z: number, x: number, y: number): boolean => z === -2 && x === 1 && y === 0;
    expect(nearestAncestor(0, 7, 3, fine, stored, levels)).toMatchObject({ kind: 'fine', z: -1 });
    expect(nearestAncestor(-1, 3, 1, new Map(), stored, levels)).toMatchObject({ kind: 'level', z: -2, ox: 256, oy: 0 });
    expect(nearestAncestor(-1, 0, 0, new Map(), stored, levels)).toBeNull();
    expect(shiftDown(7, 2)).toBe(1);
  });

  it('upscales the ancestor bilinearly, clamped at the ancestor tile\'s edge as the runtime draws it', () => {
    const anc = nearestAncestor(-1, 2, 0, new Map(), (z, x, y) => z === -2 && x === 1 && y === 0, levels);
    if (anc === null) throw new Error('ancestor');
    const col = [0, 0, 0];
    const up = ancestorSampler(anc, -1, 2, 0, SEA_DEEP);
    // the first pixel of fine tile (2, 0) at level −1 is (512, 0): ancestor pixel (0, 0) of tile (1, 0), clamped
    up(512, 0, col);
    expect(col).toEqual([0, 0, 7]);
    // pixel (515, 3): halfway between ancestor pixels 1 and 2 in both axes
    up(515, 3, col);
    expect(col[0]).toBeCloseTo(1.25, 10);
    expect(col[1]).toBeCloseTo(1.25, 10);
    // the far edge of the ancestor tile is clamped, not taken from its neighbour
    up(1023, 0, col);
    expect(col[0]).toBe(255);
  });

  it('lists the fine tiles a rectangle touches', () => {
    const tiles = new Set<string>();
    tilesOfRect(-1, 0, 1024, 0, 512, tiles);
    expect([...tiles].sort()).toEqual(['0,0', '1,0']);
  });
});

describe('the runtime index (§7.2)', () => {
  it('stores keys as bitmaps that round-trip', () => {
    const keys = [0, 7, 8, 63, 64, 99];
    expect(bitmapKeys(bitmapBase64(100, keys), 100)).toEqual(keys);
    const level = levelBitmaps({ z: -2, nx: 5, ny: 3, stored: [[0, 0], [4, 2]], sea: [[1, 1]] });
    expect(indexKeys(level)).toEqual({ stored: [[0, 0], [4, 2]], sea: [[1, 1]] });
    expect(indexKeys(levelBitmaps({ z: 0, nx: 2, ny: 2, stored: [[1, 1]], sea: null })).sea).toBeNull();
  });

  it('refuses an index with a wrong shape', () => {
    expect(parseAtlasIndex({}).errors.length).toBeGreaterThan(0);
    expect(parseAtlasIndex(null).index).toBeNull();
  });
});

describe('top stored levels (§7.1, D-042 O10)', () => {
  it('rounds to the nearest level and one finer when that is more than 1.2× coarser than the art', () => {
    expect(topLevels(4, 1.2)).toMatchObject({ tNearest: -2, t: -2 });
    // 5.76 yd/px (Ashenvale): nearest level −3 is 8 yd/px, 1.39× coarser: stored at −2
    expect(topLevels(5.755, 1.2)).toMatchObject({ tNearest: -3, t: -2 });
    // 3.34 yd/px (Blasted Lands): 4 / 3.34 = 1.197, within 1.2: stays at −2
    expect(topLevels(3.343, 1.2)).toMatchObject({ tNearest: -2, t: -2 });
    // never finer than level 0 (Ironforge, 0.79 yd/px)
    expect(topLevels(0.789, 1.2)).toMatchObject({ tNearest: 0, t: 0 });
    expect(Object.is(topLevels(0.789, 1.2).t, 0)).toBe(true);
  });
});
