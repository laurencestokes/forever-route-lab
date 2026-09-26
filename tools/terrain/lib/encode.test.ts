import { describe, expect, it } from 'vitest';
import { compactTile, decodeBlock, encodeBlock, keepTile, polygonCount } from './encode';
import { blockOf, firstTile, GRID, square, tileOf } from './nav-test-support';
import type { RecastTile } from './recast';
import { ByteReader, ByteWriter } from './varint';

describe('varints (terrain-navigation.md §5)', () => {
  it('round-trips unsigned and zigzag values with LEB128', () => {
    const w = new ByteWriter();
    const u = [0, 1, 127, 128, 255, 16383, 16384, 2 ** 31, 2 ** 40 + 5];
    const z = [0, -1, 1, -64, 64, -65, 12345, -12345];
    for (const v of u) w.u(v);
    for (const v of z) w.z(v);
    const r = new ByteReader(w.bytes(), 'test');
    expect(u.map(() => r.u())).toEqual(u);
    expect(z.map(() => r.z())).toEqual(z);
    r.end();
  });

  it('writes 128 as 0x80 0x01 and zigzags −1 to 1', () => {
    const w = new ByteWriter();
    w.u(128);
    w.z(-1);
    expect([...w.bytes()]).toEqual([0x80, 0x01, 0x01]);
  });

  it('refuses non-canonical and overlong varints, negative input and trailing bytes', () => {
    expect(() => new ByteReader(Uint8Array.from([0x80, 0x00]), 't').u()).toThrow(/non-canonical/);
    expect(() => new ByteReader(Uint8Array.from(new Array<number>(9).fill(0x81)), 't').u()).toThrow(/longer than 8/);
    expect(() => new ByteWriter().u(-1)).toThrow(RangeError);
    const r = new ByteReader(Uint8Array.from([1, 2]), 't');
    r.u();
    expect(() => r.end()).toThrow(/trailing/);
  });
});

describe('block format v3', () => {
  const { tx0, tz0 } = firstTile(28, 36);
  const a = tileOf(tx0, tz0, [square(0, 0, 10, 10), square(10, 0, 20, 10), square(0, 10, 10, 20, 44)], [false, true, false], -3);
  const b = tileOf(tx0 + 5, tz0 + 2, [square(100, 100, 256, 110)], [], 7);
  const block = blockOf(28, 36, [a, b], [14, 14, 17, 14]);

  it('round-trips tiles, origin steps, swim flags and zones', () => {
    const bytes = encodeBlock(block, GRID);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('FRN3\u0003');
    const back = decodeBlock(bytes, GRID);
    expect(back.mapId).toBe(1);
    expect([back.row0, back.col0, back.blockStep]).toEqual([28, 36, 0]);
    expect(back.tiles.map((t) => [t.tx, t.tz, t.originStep])).toEqual([
      [tx0, tz0, -3],
      [tx0 + 5, tz0 + 2, 7],
    ]);
    expect(back.tiles[0]?.polys).toEqual(a.polys);
    expect(back.tiles[0]?.swim).toEqual([false, true, false]);
    expect([...(back.tiles[1]?.verts ?? [])]).toEqual([...b.verts]);
    expect([...back.zones]).toEqual([14, 14, 17, 14]);
    expect(encodeBlock(back, GRID).equals(bytes)).toBe(true);
    expect(polygonCount(back)).toBe(4);
  });

  it('stores one zone table per block and no per-polygon index in single-zone tiles', () => {
    const one = encodeBlock(blockOf(28, 36, [a], [14, 14, 14]), GRID);
    const two = encodeBlock(blockOf(28, 36, [a], [14, 14, 17]), GRID);
    // one more zone id in the block table, one more index in the tile table, then 3 per-polygon local indices
    expect(two.length - one.length).toBe(5);
    expect([...decodeBlock(two, GRID).zones]).toEqual([14, 14, 17]);
  });

  it('refuses tiles out of order, tiles outside the block, bad indices and zone counts', () => {
    expect(() => encodeBlock(blockOf(28, 36, [b, a], [14, 14, 14, 14]), GRID)).toThrow(/increasing/);
    expect(() => encodeBlock(blockOf(28, 36, [tileOf(tx0 + 16, tz0, [square(0, 0, 5, 5)])]), GRID)).toThrow(/outside block/);
    expect(() => encodeBlock({ ...block, zones: Int32Array.from([1]) }, GRID)).toThrow(/zones/);
    expect(() => encodeBlock(blockOf(28, 36, [{ ...a, polys: [[0, 1, 99]], swim: [false] }], [1]), GRID)).toThrow(/vertex index/);
  });

  it('refuses corrupt input: magic, version, attribute mode, truncation, trailing bytes', () => {
    const bytes = encodeBlock(block, GRID);
    const with_ = (i: number, v: number): Buffer => {
      const c = Buffer.from(bytes);
      c[i] = v;
      return c;
    };
    expect(() => decodeBlock(with_(0, 0x58), GRID)).toThrow(/FRN3/);
    expect(() => decodeBlock(with_(4, 2), GRID)).toThrow(/version/);
    expect(() => decodeBlock(bytes.subarray(0, bytes.length - 3), GRID)).toThrow(/end of data|zone/);
    expect(() => decodeBlock(Buffer.concat([bytes, Buffer.from([0])]), GRID)).toThrow(/trailing/);
    // the attribute mode byte follows the last polygon; mode 2 (the retired component stream) is refused
    // attributes: mode, 2 zones, then tile a (n, 2 indices, 3 locals) and tile b (n, 1 index): 12 bytes
    const mode = bytes.length - 12;
    expect(bytes[mode]).toBe(3);
    expect(() => decodeBlock(with_(mode, 2), GRID)).toThrow();
  });
});

describe('keepTile and compactTile', () => {
  it('drops deep, hazard and unwalkable polygons and unused vertices, keeping rcPolyMesh order', () => {
    const nvp = 6;
    const polys = new Uint16Array(4 * nvp * 2).fill(0xffff);
    const set = (p: number, vs: number[]): void => vs.forEach((v, j) => (polys[p * nvp * 2 + j] = v));
    set(0, [0, 1, 2]);
    set(1, [2, 3, 4]);
    set(2, [4, 5, 6]);
    set(3, [6, 7, 0]);
    const verts = new Uint16Array(8 * 3);
    for (let v = 0; v < 8; v += 1) verts.set([v * 10, 5, v], v * 3);
    const t: RecastTile = { tx: 1, tz: 2, originStep: 4, nv: 8, verts, np: 4, nvp, polys, areas: Uint8Array.from([1, 4, 3, 5]) };
    const k = keepTile(t);
    expect(k?.polys).toEqual([
      [0, 1, 2],
      [3, 4, 5],
    ]);
    expect(k?.swim).toEqual([false, true]);
    expect([...(k?.verts ?? [])]).toEqual([0, 5, 0, 10, 5, 1, 20, 5, 2, 40, 5, 4, 50, 5, 5, 60, 5, 6]);
    expect(keepTile({ ...t, areas: Uint8Array.from([0, 4, 5, 0]) })).toBeNull();
  });

  it('returns the same tile when every vertex is used', () => {
    const t = tileOf(0, 0, [square(0, 0, 1, 1)]);
    expect(compactTile(t)).toBe(t);
  });
});
