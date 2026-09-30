/**
 * The minimap tool's inputs on synthetic files (docs/research/map-atlas.md §18.2 steps 1-4, step
 * MM.2): MAID discovery from a WDT, the texture checks and DXT1 decode, missing and encrypted files,
 * the liquid grid from root ADTs (hazard liquids excluded) and its equality with the relief. No
 * client bytes.
 */
import { describe, expect, it } from 'vitest';
import { CascError } from '../../casc/errors';
import { adtRoot, chunk } from '../../terrain/lib/formats/test-support';
import { blpFile, dxtColourBlock, rgb565 } from './art-test-support';
import { decodeMinimapTexture, MinimapInputError } from './minimap-decode';
import { discoverMinimaps, layoutMapIds, readChecked, type ClientFileSource } from './minimap-inputs';
import { buildLiquidGrid, RELIEF_LAND, RELIEF_WATER, reliefClasses, reliefEquality, reliefRefusal, type ReliefClasses } from './minimap-liquid';
import { ATLAS_LAYOUT } from '../../../src/geo/atlas-layout';
import { WATER_LAND, WATER_WET } from './minimap-texels';

const u32 = (v: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v, 0);
  return b;
};

/** A WDT whose MAID lists, per tile, a root ADT and a minimap FileDataID. */
function wdt(tiles: readonly { row: number; col: number; root: number; minimap: number }[]): Buffer {
  const main = Buffer.alloc(4096 * 8);
  const maid = Buffer.alloc(4096 * 32);
  for (const t of tiles) {
    const i = t.row * 64 + t.col;
    main.writeUInt32LE(1, i * 8);
    maid.writeUInt32LE(t.root, i * 32);
    maid.writeUInt32LE(t.minimap, i * 32 + 28);
  }
  return Buffer.concat([chunk('MVER', u32(18)), chunk('MPHD', Buffer.alloc(32)), chunk('MAIN', main), chunk('MAID', maid)]);
}

/** A 512 × 512 opaque DXT1 texture of one colour. */
function dxt1(r: number, g: number, b: number, override: Partial<{ alphaBits: number; width: number; height: number; colourEncoding: number; magic: string }> = {}): Uint8Array {
  const width = override.width ?? 512;
  const height = override.height ?? 512;
  const c = rgb565(r, g, b);
  const block = dxtColourBlock(c, c, new Array<number>(16).fill(0));
  const blocks = (width / 4) * (height / 4);
  const mip0 = new Uint8Array(blocks * 8);
  for (let i = 0; i < blocks; i += 1) mip0.set(block, i * 8);
  return blpFile({ colourEncoding: override.colourEncoding ?? 2, alphaBits: override.alphaBits ?? 0, width, height, mip0, ...(override.magic === undefined ? {} : { magic: override.magic }) });
}

const ckey = (id: number): string => id.toString(16).padStart(32, '0');

function source(files: ReadonlyMap<number, Buffer | CascError>): ClientFileSource {
  return {
    file(id) {
      const f = files.get(id);
      if (f === undefined) throw new CascError('missing', `FileDataID ${String(id)} is not in the root manifest (enUS)`);
      if (f instanceof CascError) throw f;
      return { data: f, ckey: ckey(id) };
    },
    ckeyOf: (id) => (files.has(id) ? ckey(id) : null),
  };
}

describe('MAID discovery (§18.2 step 2)', () => {
  const files = new Map<number, Buffer | CascError>([
    [100, wdt([
      { row: 30, col: 31, root: 201, minimap: 301 },
      { row: 30, col: 30, root: 200, minimap: 300 },
      { row: 31, col: 30, root: 202, minimap: 0 },
    ])],
    [200, Buffer.alloc(1)],
    [201, Buffer.alloc(1)],
    [202, Buffer.alloc(1)],
    [300, Buffer.from(dxt1(8, 16, 16))],
    [301, Buffer.from(dxt1(8, 16, 16))],
  ]);

  it('lists every tile with a minimap FileDataID, row-major, with its root ADT and the CKeys', () => {
    const m = discoverMinimaps(source(files), 1, 'Kalimdor', 100);
    expect(m.wdt).toEqual({ fileDataId: 100, ckey: ckey(100) });
    expect(m.tiles.map((t) => [t.row, t.col, t.minimap.fileDataId, t.rootAdt.fileDataId])).toEqual([
      [30, 30, 300, 200],
      [30, 31, 301, 201],
    ]);
    expect(m.tiles[0]?.minimap.ckey).toBe(ckey(300));
  });

  it('refuses a minimap tile without a root ADT, and a minimap missing from the root manifest', () => {
    const noRoot = new Map(files);
    noRoot.set(100, wdt([{ row: 1, col: 1, root: 0, minimap: 300 }]));
    expect(() => discoverMinimaps(source(noRoot), 1, 'K', 100)).toThrow(/no root ADT/);
    const notListed = new Map(files);
    notListed.delete(301);
    expect(() => discoverMinimaps(source(notListed), 1, 'K', 100)).toThrow(/not in the client's root manifest/);
  });

  it('stops on a missing or encrypted file, and on a CKey other than the one discovered', () => {
    const m = discoverMinimaps(source(files), 1, 'K', 100);
    const t = m.tiles[0];
    if (t === undefined) throw new Error('no tile');
    const gone = new Map(files);
    gone.delete(300);
    expect(() => readChecked(source(gone), t.minimap, 'minimap')).toThrow(/missing/);
    const locked = new Map(files);
    locked.set(300, new CascError('encrypted', 'FileDataID 300 has 1 encrypted chunk(s)'));
    expect(() => readChecked(source(locked), t.minimap, 'minimap')).toThrow(/encrypted/);
    expect(() => readChecked(source(files), { fileDataId: 300, ckey: ckey(999) }, 'minimap')).toThrow(/discovery recorded/);
  });

  it('reads the layout\'s maps: placed west first, then the inset (1, 0, 2991)', () => {
    expect(layoutMapIds(ATLAS_LAYOUT)).toEqual([1, 0, 2991]);
  });
});

describe('the minimap textures (§18.2 step 3)', () => {
  it('decodes an opaque 512 × 512 DXT1 texture to RGB', () => {
    const rgb = decodeMinimapTexture(dxt1(8, 16, 16), 'tile');
    expect(rgb.length).toBe(512 * 512 * 3);
    // 5-6-5 with bit replication: 8 → 8, 16 → 16, 16 → 16
    expect([...rgb.subarray(0, 3)]).toEqual([8, 16, 16]);
    expect([...rgb.subarray(rgb.length - 3)]).toEqual([8, 16, 16]);
  });

  it('refuses anything but BLP2 DXT1 without alpha at 512 × 512', () => {
    expect(() => decodeMinimapTexture(dxt1(8, 16, 16, { alphaBits: 1 }), 'tile')).toThrow(MinimapInputError);
    expect(() => decodeMinimapTexture(dxt1(8, 16, 16, { alphaBits: 1 }), 'tile')).toThrow(/alpha depth 1/);
    expect(() => decodeMinimapTexture(dxt1(8, 16, 16, { width: 256, height: 256 }), 'tile')).toThrow(/256 × 256/);
    expect(() => decodeMinimapTexture(dxt1(8, 16, 16, { magic: 'BLP1' }), 'tile')).toThrow(/BLP1/);
    const dxt5 = blpFile({ colourEncoding: 2, alphaBits: 8, preferredFormat: 7, width: 512, height: 512, mip0: new Uint8Array(128 * 128 * 16) });
    expect(() => decodeMinimapTexture(dxt5, 'tile')).toThrow(/dxt5 texture/);
    const bgra = blpFile({ colourEncoding: 3, alphaBits: 8, width: 512, height: 512, mip0: new Uint8Array(512 * 512 * 4) });
    expect(() => decodeMinimapTexture(bgra, 'tile')).toThrow(/bgra texture/);
  });
});

describe('the liquid grid (§18.2 step 4)', () => {
  // tile 30_30: chunk (0, 0) has water 5 yd deep; chunk (1, 0) has magma (a hazard); the rest is land
  const HAZARD = 3;
  const root = adtRoot(30, 30, [], [
    { index: 0, instances: [{ type: 1, objectOrFormat: 42, min: 5, max: 5, x: 0, y: 0, width: 8, height: 8 }] },
    { index: 1, instances: [{ type: HAZARD, objectOrFormat: 42, min: 5, max: 5, x: 0, y: 0, width: 8, height: 8 }] },
  ]);
  const grid = buildLiquidGrid([{ row: 30, col: 30 }], () => root, new Set([HAZARD]));

  it('marks quads under non-hazard liquid deeper than 0.3 yd wet, and hazard liquids and land dry', () => {
    expect(grid.row0).toBe(30);
    expect(grid.quadCols).toBe(128);
    expect(grid.water[0]).toBe(WATER_WET);
    expect(grid.water[7 * 128 + 7]).toBe(WATER_WET);
    expect(grid.water[8]).toBe(WATER_LAND); // chunk (ix 1, iy 0): magma
    expect(grid.water[64 * 128 + 64]).toBe(WATER_LAND);
  });

  it('equals the relief\'s water class by the relief\'s rule, and refuses to build when it does not', () => {
    // relief pixel (0, 0) and (0, 1) cover the wet chunk's 8 × 8 quads: water; the rest land
    const cls = new Uint8Array(32 * 32).fill(RELIEF_LAND);
    cls[0] = RELIEF_WATER;
    cls[1] = RELIEF_WATER;
    cls[32] = RELIEF_WATER;
    cls[33] = RELIEF_WATER;
    const relief: ReliefClasses = { mapId: 1, w: 32, h: 32, row0: 30, col0: 30, cls };
    const same = reliefEquality(grid, relief);
    expect(same).toEqual({ originOk: true, sizeOk: true, compared: 1024, same: 1024, reliefWaterOnly: 0, gridWaterOnly: 0 });
    expect(reliefRefusal(1, same)).toBeNull();
    const wrong = { ...relief, cls: new Uint8Array(cls).fill(RELIEF_LAND) };
    expect(reliefRefusal(1, reliefEquality(grid, wrong))).toMatch(/differs from the committed relief's water class on 4 of 1024 pixels/);
    expect(reliefRefusal(1, reliefEquality(grid, { ...relief, row0: 29 }))).toMatch(/tile rectangle/);
  });

  it('reads relief classes from the relief image\'s colours', () => {
    const rgba = new Uint8Array([0, 0, 0, 0, 96, 128, 160, 255, 120, 120, 120, 255]);
    expect([...reliefClasses(0, rgba, 3, 1, 0, 0).cls]).toEqual([0, RELIEF_WATER, RELIEF_LAND]);
  });
});
