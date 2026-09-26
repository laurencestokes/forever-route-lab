import { describe, expect, it } from 'vitest';
import { innerIndex, outerIndex, parseAdtRoot } from './adt';
import { chunks, FormatError } from './chunked';
import { blockRect, blockTiles, CHUNK_YD, chunkKey, chunkKeyAt, MAP_ORIGIN_YD, TILE_YD, tileRect, UNIT_YD } from './grid';
import { hazardLiquidTypes, liquidAt, wmoLiquidType } from './liquid';
import { parseM2Collision } from './m2';
import { parseObj0 } from './obj0';
import { adtRoot, chunk, chunkCorner, m2File, mcnk, obj0File, wdtFile, wmoGroupFile, wmoRootFile, worldToPlacement } from './test-support';
import { apply, determinant, doodadTransform, eulerZYX, placementToWorld, placementTransform, quaternionMatrix } from './transform';
import { parseWdt, wdtTile } from './wdt';
import { groupName, isCollisionTriangle, parseWmoGroup, parseWmoRoot, skipGroup } from './wmo';

const close = (a: readonly number[], b: readonly number[], eps = 1e-4): boolean => a.length === b.length && a.every((v, i) => Math.abs(v - (b[i] ?? NaN)) < eps);

describe('chunked files', () => {
  it('reads ids stored reversed and fails closed on overruns and stray bytes', () => {
    const file = Buffer.concat([chunk('MVER', Buffer.alloc(4)), chunk('MAIN', Buffer.from('abc'))]);
    expect([...chunks(file)].map((c) => [c.id, c.size])).toEqual([
      ['MVER', 4],
      ['MAIN', 3],
    ]);
    expect(file.toString('latin1', 0, 4)).toBe('REVM');
    expect(() => [...chunks(file.subarray(0, file.length - 1))]).toThrow(FormatError);
    expect(() => [...chunks(Buffer.concat([file, Buffer.from([1, 2, 3])]))]).toThrow(/stray/);
  });
});

describe('grid', () => {
  it('places tile (row, col) with X north, Y west and row 0 in the north', () => {
    expect(tileRect(0, 0)).toEqual({ xMin: MAP_ORIGIN_YD - TILE_YD, xMax: MAP_ORIGIN_YD, yMin: MAP_ORIGIN_YD - TILE_YD, yMax: MAP_ORIGIN_YD });
    expect(tileRect(32, 32).xMax).toBeCloseTo(0, 9);
    expect(blockRect(28, 36).xMin).toBeCloseTo(MAP_ORIGIN_YD - 32 * TILE_YD, 9);
    expect(blockTiles(0, 60).length).toBe(5 * 5); // rows 0-4 and columns 59-63: the ring is clamped at row 0 and column 63
    expect(blockTiles(28, 36)).toHaveLength(36);
    const x = MAP_ORIGIN_YD - 29.5 * TILE_YD;
    const y = MAP_ORIGIN_YD - 36.2 * TILE_YD;
    expect(chunkKeyAt(x, y)).toBe(chunkKey(29, 36, 8, 3));
  });
});

describe('WDT', () => {
  it('lists present tiles with their MAID FileDataIDs, row-major [YY][XX]', () => {
    const wdt = parseWdt(wdtFile([{ row: 31, col: 40, root: 100, obj0: 200 }, { row: 2, col: 5, root: 101, obj0: 300 }]));
    expect(wdt.hasMaid).toBe(true);
    expect(wdt.mphdFlags).toBe(0x80);
    expect(wdt.tiles.map((t) => [t.row, t.col])).toEqual([
      [2, 5],
      [31, 40],
    ]);
    expect(wdtTile(wdt, 31, 40)).toMatchObject({ rootAdt: 100, obj0: 200, obj1: 201, tex0: 202, minimap: 9999 });
    expect(() => parseWdt(chunk('MVER', Buffer.alloc(4)))).toThrow(/MAIN/);
  });
});

describe('root ADT', () => {
  it('reads 256 chunks: index, area, position, MCVT and both hole encodings', () => {
    const heights = Array.from({ length: 145 }, (_, i) => i / 10);
    const file = adtRoot(31, 40, [
      { ix: 3, iy: 5, areaId: 363, heights, holes: [0, 9, 63], baseZ: 12 },
      { ix: 4, iy: 5, areaId: 14, lowResHoles: 0b0000_0000_0010_0001 },
    ]);
    const adt = parseAdtRoot(file);
    expect(adt.chunks).toHaveLength(256);
    expect(adt.hasMh2o).toBe(false);
    const c = adt.chunks.find((m) => m.ix === 3 && m.iy === 5);
    expect(c?.areaId).toBe(363);
    expect(close([...(c?.position ?? [])], [...chunkCorner(31, 40, 5, 3), 12], 1e-2)).toBe(true); // stored as float32
    expect(c?.heights?.[outerIndex(8, 8)]).toBeCloseTo(144 / 10, 5);
    expect(c?.heights?.[innerIndex(0, 0)]).toBeCloseTo(0.9, 5);
    expect(c?.holes.flatMap((h, i) => (h ? [i] : []))).toEqual([0, 9, 63]);
    // low-resolution bit k covers the 2 × 2 quads of cell (k div 4, k mod 4)
    const low = adt.chunks.find((m) => m.ix === 4 && m.iy === 5);
    expect(low?.holes.flatMap((h, i) => (h ? [i] : []))).toEqual([0, 1, 8, 9, 18, 19, 26, 27]);
  });

  it('fails closed on a missing or repeated chunk', () => {
    const one = mcnk(1, 1, { ix: 0, iy: 0, areaId: 1 });
    expect(() => parseAdtRoot(Buffer.concat([chunk('MVER', Buffer.alloc(4)), one]))).toThrow(/256/);
    const full = adtRoot(1, 1);
    const repeated = Buffer.concat([full.subarray(0, full.length - one.length), one]);
    expect(() => parseAdtRoot(repeated)).toThrow(/repeated/);
  });

  it('reads MH2O instances: existence bitmap, deep bits, LVF heights and flat LiquidObject surfaces', () => {
    const file = adtRoot(10, 10, [], [
      {
        index: 5 * 16 + 3,
        instances: [
          { type: 2, objectOrFormat: 0, min: 1, max: 3, x: 1, y: 2, width: 2, height: 1, exists: [true, false], heights: [1, 2, 3, 4, 5, 6] },
          { type: 3, objectOrFormat: 1001, min: 5, max: 7, x: 0, y: 0, width: 8, height: 8 },
        ],
        deep: [2 * 8 + 1, 63],
      },
    ]);
    const adt = parseAdtRoot(file);
    expect(adt.hasMh2o).toBe(true);
    const liquid = adt.chunks.find((m) => m.ix === 3 && m.iy === 5)?.liquid ?? null;
    expect(liquid?.instances).toHaveLength(2);
    // quad (2, 1): first instance, corners 1, 2 (row 0) and 4, 5 (row 1) → mean 3; deep
    expect(liquidAt(liquid, 2, 1)).toEqual({ height: 3, type: 2, deep: true });
    // quad (2, 2) is outside the first instance's bitmap → the LiquidObject layer, flat at its max
    expect(liquidAt(liquid, 2, 2)).toEqual({ height: 7, type: 3, deep: false });
    expect(liquidAt(liquid, 7, 7)).toEqual({ height: 7, type: 3, deep: true });
    expect(liquidAt(adt.chunks[0]?.liquid ?? null, 0, 0)).toBeNull();
    expect(hazardLiquidTypes([{ id: 3, soundBank: 2 }, { id: 4, soundBank: 3 }, { id: 1, soundBank: 0 }])).toEqual(new Set([3, 4]));
  });
});

describe('obj0 placements', () => {
  it('converts MDDF and MODF from placement space to world, with name set, doodad set, scale and extents', () => {
    const file = obj0File(
      [{ fileDataId: 189077, uniqueId: 7, position: worldToPlacement(100, 200, 30), rotation: [1, 2, 3], scale: 1.5 }, { fileDataId: 5, uniqueId: 8, position: [0, 0, 0], legacyName: true }],
      [{ fileDataId: 106686, uniqueId: 9, position: worldToPlacement(-50, 60, 5), doodadSet: 2, nameSet: 3, extentsMin: worldToPlacement(-40, 70, 0), extentsMax: worldToPlacement(-60, 50, 10) }],
    );
    const [m2, legacy, wmo] = parseObj0(file);
    expect(m2).toMatchObject({ kind: 'm2', name: 189077, nameIsFileDataId: true, uniqueId: 7, scale: 1.5, rotation: [1, 2, 3] });
    expect(close([...(m2?.position ?? [])], [100, 200, 30], 1e-3)).toBe(true);
    expect(legacy?.nameIsFileDataId).toBe(false);
    expect(wmo).toMatchObject({ kind: 'wmo', name: 106686, doodadSet: 2, nameSet: 3, scale: 1 });
    expect(close([...(wmo?.extents ?? [])], [-60, 50, 0, -40, 70, 10], 1e-3)).toBe(true);
    expect(() => parseObj0(chunk('MDDF', Buffer.alloc(35)))).toThrow(FormatError);
  });
});

describe('WMO root and group', () => {
  it('reads MOHD, the LOD-0 part of GFID, doodad sets, doodads and group names', () => {
    const root = parseWmoRoot(
      wmoRootFile({
        wmoId: 1150,
        groups: [11, 0, 13],
        lodExtra: [21, 22, 23],
        flags: 0x4,
        groupNames: 'hall\0antiportal\0',
        doodadSets: [
          { name: 'Set_$DefaultGlobal', start: 0, count: 1 },
          { name: 'Set_Extra', start: 1, count: 1 },
        ],
        doodadIds: [0, 189077],
        doodads: [{ nameIndex: 1, position: [1, 2, 3], rotation: [0, 0, 0.7071068, 0.7071068], scale: 2 }, { nameIndex: 0, position: [0, 0, 0] }],
      }),
    );
    expect(root).toMatchObject({ wmoId: 1150, groupCount: 3, flags: 0x4, groupFileDataIds: [11, 0, 13], doodadFileDataIds: [0, 189077] });
    expect(root.doodadSets.map((s) => s.name)).toEqual(['Set_$DefaultGlobal', 'Set_Extra']);
    expect(root.doodads[0]).toMatchObject({ nameIndex: 1, scale: 2 });
    expect(groupName(root, 0)).toBe('hall');
    expect(groupName(root, 5)).toBe('antiportal');
    expect(groupName(root, 99)).toBe('');
    expect(() => parseWmoRoot(wmoRootFile({ wmoId: 1, groups: [] }).subarray(0, 20))).toThrow(FormatError);
  });

  it('keeps only collision triangles (COLLISION, or RENDER without DETAIL) and reads MLIQ', () => {
    const vertices = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0];
    const triangles: [number, number, number, number][] = [
      [0, 1, 2, 0x08], // collision
      [1, 3, 2, 0x20], // render, not detail
      [0, 2, 3, 0x24], // render + detail: no
      [0, 1, 3, 0x00], // nothing: no
    ];
    for (const wide of [false, true]) {
      const g = parseWmoGroup(wmoGroupFile({ wmoGroupId: 87344, groupLiquid: 3, vertices, triangles, wide, liquid: { xTiles: 2, yTiles: 1, corner: [5, 6, 7], height: 9, tiles: [0x0f, 0x01] } }));
      expect(g.triangleCount).toBe(4);
      expect([...g.collision]).toEqual([0, 1, 2, 1, 3, 2]);
      expect(g.wmoGroupId).toBe(87344);
      expect(g.groupLiquid).toBe(3);
      expect(g.liquid).toMatchObject({ xVerts: 3, yVerts: 2, xTiles: 2, yTiles: 1, corner: [5, 6, 7] });
      expect([...(g.liquid?.heights ?? [])]).toEqual([9, 9, 9, 9, 9, 9]);
      expect([...(g.liquid?.tiles ?? [])]).toEqual([0x0f, 0x01]);
    }
    expect(isCollisionTriangle(0x28)).toBe(true);
    expect(isCollisionTriangle(0x04)).toBe(false);
  });

  it('skips groups flagged unreachable or antiportal, or named "antiportal"', () => {
    const root = parseWmoRoot(wmoRootFile({ wmoId: 1, groups: [1, 2, 3], groupNames: 'hall\0antiportal\0' }));
    const base = { wmoGroupId: 1, vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], triangles: [[0, 1, 2, 0x08]] as [number, number, number, number][] };
    const unreachable = parseWmoGroup(wmoGroupFile({ ...base, flags: 0x80 }));
    expect(unreachable.skippedByFlags).toBe(true);
    expect(unreachable.collision.length).toBe(0);
    expect(skipGroup(root, parseWmoGroup(wmoGroupFile({ ...base, flags: 0x4000000 })))).toBe(true);
    expect(skipGroup(root, parseWmoGroup(wmoGroupFile({ ...base, nameOffset: 5 })))).toBe(true);
    expect(skipGroup(root, parseWmoGroup(wmoGroupFile({ ...base, nameOffset: 0 })))).toBe(false);
  });

  it('fails closed on a material count that differs from the triangle count, and on bad indices', () => {
    const file = wmoGroupFile({ wmoGroupId: 1, vertices: [0, 0, 0], triangles: [[0, 0, 5, 0x08]] });
    expect(() => parseWmoGroup(file)).toThrow(/past the vertex list/);
    // two triangle materials (MOPY) for one triangle (MOVI)
    const mogp = chunk('MOGP', Buffer.concat([Buffer.alloc(0x44), chunk('MOPY', Buffer.from([8, 0, 8, 0])), chunk('MOVI', Buffer.from([0, 0, 1, 0, 2, 0])), chunk('MOVT', Buffer.alloc(36))]));
    expect(() => parseWmoGroup(Buffer.concat([chunk('MVER', Buffer.alloc(4)), mogp]))).toThrow(/2 triangle materials for 1 triangles/);
  });
});

describe('WMO liquid type', () => {
  const liquid = (tiles: readonly number[]) => parseWmoGroup(wmoGroupFile({ wmoGroupId: 0, vertices: [], triangles: [], liquid: { xTiles: tiles.length, yTiles: 1, corner: [0, 0, 0], height: 0, tiles } })).liquid;

  it('follows the wowdev rule: LiquidType IDs with root flag 0x4, else legacy value + 1, 15 = none, then the MLIQ tiles', () => {
    expect(wmoLiquidType(3, 0x4, 0, null)).toBe(19); // legacy magma
    expect(wmoLiquidType(1, 0x4, 0x80000, null)).toBe(14); // legacy water marked ocean
    expect(wmoLiquidType(1, 0x4, 0, null)).toBe(13);
    expect(wmoLiquidType(100, 0x4, 0, null)).toBe(100); // a LiquidType ID
    expect(wmoLiquidType(2, 0, 0, null)).toBe(19); // 2 + 1 = legacy magma
    expect(wmoLiquidType(3, 0, 0, null)).toBe(20); // 3 + 1 = legacy slime
    expect(wmoLiquidType(4, 0, 0, null)).toBe(13); // 4 + 1 = legacy water
    expect(wmoLiquidType(15, 0, 0, null)).toBe(0);
    expect(wmoLiquidType(15, 0, 0, liquid([0x0f, 0x02]))).toBe(19); // tile liquid 2 + 1 = magma
    expect(wmoLiquidType(0, 0, 0, liquid([0x40]))).toBe(13); // 0 + 1 = water; high bits are flags
  });
});

describe('M2 collision', () => {
  it('reads the collision arrays of chunked (MD21) and legacy (MD20) files', () => {
    const vertices = [0, 0, 0, 2, 0, 0, 0, 3, 1];
    for (const chunked of [true, false]) {
      const c = parseM2Collision(m2File(vertices, [0, 1, 2], { chunked }));
      expect([...c.triangles]).toEqual([0, 1, 2]);
      expect([...c.vertices]).toEqual(vertices);
      expect(c.radius).toBe(3);
    }
    expect(parseM2Collision(m2File([], [])).triangles.length).toBe(0);
    expect(() => parseM2Collision(m2File(vertices, [0, 1]))).toThrow(/whole number/);
    expect(() => parseM2Collision(m2File(vertices, [0, 1, 7]))).toThrow(/past the position list/);
    expect(() => parseM2Collision(Buffer.from('MD22xxxxxxxx'))).toThrow(/no MD20/);
  });
});

describe('placement transform', () => {
  it('maps placement space to world and applies Rz(b)·Ry(a)·Rx(c) with diag(−1, −1, 1)', () => {
    expect(close([...placementToWorld(MAP_ORIGIN_YD - 10, 5, MAP_ORIGIN_YD - 20)], [20, 10, 5])).toBe(true);
    const identity = placementTransform([100, 200, 30], [0, 0, 0], 2);
    expect(close([...apply(identity, 1, 2, 3)], [98, 196, 36])).toBe(true);
    // heading b = 90°: model +x turns to +y before the flip, i.e. world −Y (east)
    const turned = placementTransform([0, 0, 0], [0, 90, 0], 1);
    expect(close([...apply(turned, 1, 0, 0)], [0, -1, 0])).toBe(true);
    for (const [a, b, c] of [
      [10, 20, 30],
      [-45, 170, 5],
      [89, -3, 60],
    ] as const) {
      const r = eulerZYX((b * Math.PI) / 180, (a * Math.PI) / 180, (c * Math.PI) / 180);
      expect(determinant(r)).toBeCloseTo(1, 12);
    }
  });

  it('composes a doodad transform equal to placing the doodad in the WMO, then the WMO in the world', () => {
    const wmo = placementTransform([500, -300, 40], [5, 30, -10], 1.25);
    const q: [number, number, number, number] = [0.1, 0.2, 0.3, Math.sqrt(1 - 0.14)];
    const doodad = { position: [3, -4, 5] as const, rotation: q, scale: 0.5 };
    const composed = doodadTransform(wmo, doodad);
    const r = quaternionMatrix(q);
    const v = [1, 2, 3] as const;
    const inWmo = [0, 1, 2].map((i) => ((r[i * 3] ?? 0) * v[0] + (r[i * 3 + 1] ?? 0) * v[1] + (r[i * 3 + 2] ?? 0) * v[2]) * 0.5 + (doodad.position[i] ?? 0));
    expect(close([...apply(composed, ...v)], [...apply(wmo, inWmo[0] ?? 0, inWmo[1] ?? 0, inWmo[2] ?? 0)], 1e-9)).toBe(true);
    expect(UNIT_YD * 8).toBeCloseTo(CHUNK_YD, 12);
  });
});
