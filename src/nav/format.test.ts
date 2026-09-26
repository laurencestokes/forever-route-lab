import { describe, expect, it } from 'vitest';
import { ByteWriter, buildTestMap, encodeTestBlock, encodeTestMapFile, square, testManifestJson, tileOf, type TestBlock } from '../../tests/support/nav-mesh';
import { ByteReader, NavFormatError } from './bytes';
import { decodeBlock } from './format';
import { blockTileOrigin, MAP_ORIGIN_YD, TILE_YD } from './grid';
import { NavManifestError, parseNavManifest, spawnHint } from './manifest';
import { decodeMapFile } from './mapfile';

const manifest = parseNavManifest(testManifestJson(1, [{ row0: 28, col0: 36, polygons: 3 }]));
const P = manifest.params;
const { tx0, tz0 } = blockTileOrigin(P, 28, 36);

const block: TestBlock = {
  row0: 28,
  col0: 36,
  tiles: [tileOf(tx0, tz0, [square(0, 0, 20, 20), square(20, 0, 40, 20)], [false, true], 3), tileOf(tx0 + 1, tz0 + 2, [square(0, 0, 256, 256, 1000)])],
  zones: [14, 17, 14],
};

describe('bytes (terrain-navigation.md §5 encoding)', () => {
  it('reads LEB128 and zigzag values the writer produces, up to 2^53', () => {
    const w = new ByteWriter();
    const values = [0, 1, 127, 128, 16383, 16384, 2 ** 31, 2 ** 53 - 1];
    for (const v of values) w.u(v);
    for (const v of [0, -1, 1, -2, 1000, -1000]) w.z(v);
    const r = new ByteReader(w.bytes(), 'test');
    expect(values.map(() => r.u())).toEqual(values);
    expect([0, 0, 0, 0, 0, 0].map(() => r.z())).toEqual([0, -1, 1, -2, 1000, -1000]);
    r.end();
  });

  it('refuses non-canonical and over-long varints, and reads past the end', () => {
    expect(() => new ByteReader(Uint8Array.of(0x80, 0x00), 't').u()).toThrow(/non-canonical/);
    expect(() => new ByteReader(new Uint8Array(9).fill(0x80), 't').u()).toThrow(/longer than 8 bytes/);
    expect(() => new ByteReader(Uint8Array.of(0x80), 't').u()).toThrow(NavFormatError);
    expect(() => new ByteReader(Uint8Array.of(5), 't').bounded(4, 'x')).toThrow(/x 5 exceeds 4/);
  });
});

describe('decodeBlock (FRN3 v3)', () => {
  it('decodes tiles, vertices, polygons, swim flags and per-polygon zones', () => {
    const d = decodeBlock(encodeTestBlock(block, P), P);
    expect([d.mapId, d.row0, d.col0, d.blockStep, d.tileCount, d.polygons]).toEqual([1, 28, 36, 0, 2, 3]);
    expect([...d.tileTx]).toEqual([tx0, tx0 + 1]);
    expect([...d.tileTz]).toEqual([tz0, tz0 + 2]);
    expect([...d.tileOriginStep]).toEqual([3, 0]);
    expect([...d.tileVertBase]).toEqual([0, 6, 10]);
    expect([...d.tilePolyBase]).toEqual([0, 2, 3]);
    expect([...d.polyFirst]).toEqual([0, 4, 8, 12]);
    // shared vertices of the two squares: (20, 40, 0) and (20, 40, 20) are used by both
    expect([...d.slotVert.subarray(0, 8)]).toEqual([0, 1, 2, 3, 3, 2, 4, 5]);
    expect([...d.verts.subarray(0, 6)]).toEqual([0, 40, 0, 0, 40, 20]);
    expect([...d.swim]).toEqual([0, 1, 0]);
    expect([...d.zones]).toEqual([14, 17, 14]);
  });

  it('matches the design world coordinates', () => {
    expect(TILE_YD).toBeCloseTo(533.3333, 4);
    expect(MAP_ORIGIN_YD).toBeCloseTo(17066.667, 3);
    expect(P.cs).toBeCloseTo(0.520833, 6);
    expect(P.tileYd).toBeCloseTo(133.333, 3);
  });

  it('is strict: magic, version, grid, order, bounds, attributes and trailing bytes', () => {
    const good = encodeTestBlock(block, P);
    const with_ = (i: number, v: number): Uint8Array => {
      const b = Uint8Array.from(good);
      b[i] = v;
      return b;
    };
    expect(() => decodeBlock(with_(0, 0x58), P)).toThrow(/not a FRN3 block/);
    expect(() => decodeBlock(with_(4, 2), P)).toThrow(/version 2/);
    expect(() => decodeBlock(Uint8Array.from([...good, 0]), P)).toThrow(/1 trailing bytes/);
    expect(() => decodeBlock(good.subarray(0, good.length - 1), P)).toThrow(/unexpected end/);
    expect(() => decodeBlock(encodeTestBlock({ ...block, row0: 29 }, P), P)).toThrow(/not on the 4-ADT grid/);
    // a vertex outside the tile
    expect(() => decodeBlock(encodeTestBlock({ row0: 28, col0: 36, tiles: [tileOf(tx0, tz0, [square(0, 0, 257, 20)])] }, P), P)).toThrow(/outside the tile/);
    // a polygon of 13 vertices
    const big = Array.from({ length: 13 }, (_, i) => [i, 40, i % 2 === 0 ? 0 : 5] as const);
    expect(() => decodeBlock(encodeTestBlock({ row0: 28, col0: 36, tiles: [tileOf(tx0, tz0, [big])] }, P), P)).toThrow(/13 vertices/);
    // attribute mode: 10 bytes follow it (zone table 3, tile 0: 1 + 2 + 2 local indices, tile 1: 1 + 1)
    const modeAt = good.length - 11;
    expect(good[modeAt]).toBe(3);
    expect(() => decodeBlock(with_(modeAt, 2), P)).toThrow(/attribute mode 2/);
  });
});

describe('decodeMapFile (FRNM v1)', () => {
  it('round-trips components, connector links and passage tags', () => {
    const t = buildTestMap([block], { links: [{ connector: 0, from: 0, to: 2, costTenths: 125 }], passages: [{ passage: 0, polygons: [0, 1] }] });
    const f = decodeMapFile(t.mapBin);
    expect([f.mapId, f.blockCount, f.polygonCount]).toEqual([1, 1, 3]);
    // 0 and 1 share an edge; the connector joins 0 to polygon 2, alone in its tile
    expect([...f.sizes]).toEqual([3]);
    expect([...f.comp]).toEqual([0, 0, 0]);
    expect(f.links).toEqual([{ connector: 0, from: 0, to: 2, costTenths: 125 }]);
    expect(f.passages).toEqual([{ passage: 0, polygons: [0, 1] }]);
  });

  it('is strict about sizes, runs and passages', () => {
    const base = { mapId: 1, blockCount: 1, polygonCount: 3, links: [], passages: [] };
    expect(() => decodeMapFile(encodeTestMapFile({ ...base, sizes: Int32Array.of(1, 2), comp: Int32Array.of(1, 0, 0) }))).toThrow(/not ordered by size/);
    expect(() => decodeMapFile(encodeTestMapFile({ ...base, sizes: Int32Array.of(2, 2), comp: Int32Array.of(0, 0, 1) }))).toThrow(/sum to 4/);
    expect(() => decodeMapFile(encodeTestMapFile({ ...base, sizes: Int32Array.of(2, 1), comp: Int32Array.of(0, 1, 1) }))).toThrow(/component 0 has 1 polygons/);
    expect(() => decodeMapFile(encodeTestMapFile({ ...base, sizes: Int32Array.of(3), comp: Int32Array.of(0, 0, 0), links: [{ connector: 0, from: 0, to: 3, costTenths: 1 }] }))).toThrow(/link target 3 exceeds 2/);
    expect(() => decodeMapFile(encodeTestMapFile({ ...base, sizes: Int32Array.of(3), comp: Int32Array.of(0, 0, 0), passages: [{ passage: 0, polygons: [2, 3] }] }))).toThrow(/bad passage run/);
  });
});

describe('parseNavManifest', () => {
  it('reads the grid, the snap settings and the canonical block order', () => {
    expect(P.cs).toBe(1600 / 3 / 1024);
    expect(P.tileYd).toBe((1600 / 3 / 1024) * 256);
    expect([P.perAdt, P.blockAdts, P.ch, P.climbYd, P.snapRadiusYd, P.ruleBMinPolygons, P.longSwimYd]).toEqual([4, 4, 0.25, 1.5, 6, 20, 200]);
    const map = manifest.maps[0];
    expect(map?.blocks.map((b) => b.path)).toEqual(['1/28_36.bin']);
    expect(map === undefined ? -1 : spawnHint(map, 215)).toBe(215);
  });

  it('refuses a manifest whose blocks, paths or derived sizes disagree', () => {
    const json = testManifestJson(1, [{ row0: 28, col0: 36, polygons: 3 }]) as Record<string, unknown>;
    const maps = json['maps'] as Record<string, unknown>[];
    const map0 = maps[0] ?? {};
    const change = (patch: Record<string, unknown>): unknown => ({ ...json, ...patch });
    expect(() => parseNavManifest(change({ kind: 'other' }))).toThrow(NavManifestError);
    expect(() => parseNavManifest(change({ derived: { cellYd: 0.5, tileYd: 128 } }))).toThrow(/derived cell or tile size/);
    expect(() => parseNavManifest(change({ maps: [{ ...map0, polygons: 4 }] }))).toThrow(/do not sum to 4/);
    expect(() => parseNavManifest(change({ maps: [{ ...map0, blocks: [{ path: '1/28_40.bin', row0: 28, col0: 36, polygons: 3, bytes: 0, sha256: 'ab'.repeat(32) }] }] }))).toThrow(/does not name block 28_36/);
    expect(() => parseNavManifest(change({ maps: [{ ...map0, blocks: [{ path: '1/29_36.bin', row0: 29, col0: 36, polygons: 3, bytes: 0, sha256: 'ab'.repeat(32) }] }] }))).toThrow(/row0/);
    expect(() => parseNavManifest(change({ format: { block: 'FRN2', mapFile: 'FRNM v1' } }))).toThrow(/unsupported format/);
  });
});
