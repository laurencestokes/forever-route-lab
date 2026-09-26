import { describe, expect, it } from 'vitest';
import { FormatError } from './formats/chunked';
import { CHUNK_YD, expandRect, tileRect } from './formats/grid';
import { adtRoot, chunkCorner, m2File, obj0File, wdtFile, wmoGroupFile, wmoRootFile, worldToPlacement } from './formats/test-support';
import { parseWdt } from './formats/wdt';
import { AREA_CLASS, blockGeometry, quantise, triangleOverlaps, type BlockGeometry, type FileSource, type GeometryOptions } from './geometry';
import { areaAt, areaParents, topZone, wmoAreaIndex, wmoGroupArea, wmoRootArea, zoneAt, zoneIndex } from './zones';

const ROW = 32;
const COL = 32;

function source(files: ReadonlyMap<number, Buffer>): FileSource & { readonly reads: number[] } {
  const reads: number[] = [];
  return {
    reads,
    read(id: number): Buffer {
      const f = files.get(id);
      if (f === undefined) throw new Error(`missing ${String(id)}`);
      reads.push(id);
      return f;
    },
  };
}

const counts = (g: BlockGeometry): Record<number, number> => {
  const out: Record<number, number> = {};
  for (const c of g.classes) out[c] = (out[c] ?? 0) + 1;
  return out;
};

const baseOptions = (clip: GeometryOptions['clip']): GeometryOptions => ({
  clip,
  swimDepth: 1.6,
  m2MinFootprint: 4,
  hazardLiquids: new Set([3, 19]),
  wmoAreas: wmoAreaIndex([
    { wmoId: 77, nameSet: 0, groupId: -1, areaId: 1497 },
    { wmoId: 77, nameSet: 0, groupId: 5, areaId: 1500 },
  ]),
});

describe('blockGeometry: terrain and MH2O liquid', () => {
  // Chunk (0, 0) of tile (32, 32), flat at z 0: quad 0 a hole; quad 1 under 5 yd of water; quad 2
  // under 1 yd (shallow); quad 3 under 0.5 yd of magma (hazard); quad 4 under 3 yd with the deep bit.
  const one = (x: number, type: number, max: number) => ({ type, objectOrFormat: 1000, min: max, max, x, y: 0, width: 1, height: 1 });
  const adt = adtRoot(ROW, COL, [{ ix: 0, iy: 0, areaId: 363, holes: [0] }], [{ index: 0, instances: [one(1, 2, 5), one(2, 2, 1), one(3, 3, 0.5), one(4, 2, 3)], deep: [4] }]);
  const files = new Map([
    [1000, adt],
    [2000, obj0File([], [])],
  ]);
  const wdt = parseWdt(wdtFile([{ row: ROW, col: COL, root: 1000, obj0: 2000 }]));
  const [north, west] = chunkCorner(ROW, COL, 0, 0);
  // chunk (0, 0), shrunk by 0.01 yd so that neighbouring chunks' triangles stay outside
  const clip = { xMin: north - CHUNK_YD + 0.01, xMax: north - 0.01, yMin: west - CHUNK_YD + 0.01, yMax: west - 0.01 };

  it('removes holes, replaces deep-water terrain by the liquid surface and keeps shallow terrain', () => {
    const g = blockGeometry(source(files), wdt, [{ row: ROW, col: COL }], baseOptions(clip));
    // 61 walked quads × 4, plus 2 water (quad 1), 2 hazard (quad 3) and 2 deep (quad 4)
    expect(counts(g)).toEqual({ [AREA_CLASS.ground]: 244, [AREA_CLASS.water]: 2, [AREA_CLASS.deep]: 2, [AREA_CLASS.hazard]: 2 });
    expect(g.triangleCount).toBe(250);
    // the other 255 chunks are culled by their own rectangle before any triangle is made
    expect(g.stats.clippedOut).toBe(0);
    expect([...new Set(g.tags)]).toEqual([363]);
    expect(g.inputs).toEqual([1000, 2000]);
    expect(g.chunkAreas.size).toBe(256);
    // every vertex is on the 1/256-yd grid, three fresh vertices per triangle
    expect(g.positions.length).toBe(250 * 9);
    expect([...g.positions].every((v) => Number.isInteger(v * 256))).toBe(true);
    const hazardZ = [...g.classes].flatMap((c, t) => (c === AREA_CLASS.hazard ? [g.positions[t * 9 + 2]] : []));
    expect(hazardZ).toEqual([0.5, 0.5]);
  });

  it('keeps every triangle whose 2D AABB touches the clip rectangle', () => {
    expect(triangleOverlaps({ xMin: 0, xMax: 1, yMin: 0, yMax: 1 }, 1, 1, 2, 1, 2, 2)).toBe(true); // corner touch
    expect(triangleOverlaps({ xMin: 0, xMax: 1, yMin: 0, yMax: 1 }, 1.01, 0, 2, 0, 2, 1)).toBe(false);
    expect(quantise(1 / 3)).toBe(85 / 256);
    // Math.round: halves go towards +∞ (−0.5 → −0, which compares equal to 0)
    expect(quantise(0.5 / 256)).toBe(1 / 256);
    expect(quantise(-0.5 / 256) === 0).toBe(true);
    expect(quantise(-0.6 / 256)).toBe(-1 / 256);
  });
});

describe('blockGeometry: M2 and WMO objects', () => {
  const square = [0, 0, 0, 10, 0, 0, 0, 10, 0, 10, 10, 0];
  const small = [0, 0, 0, 2, 0, 0, 0, 2, 0];
  const at = (x: number, y: number, z: number) => worldToPlacement(x, y, z);
  const files = new Map<number, Buffer>([
    [1000, adtRoot(ROW, COL)],
    [1001, adtRoot(ROW, COL + 1)],
    [
      2000,
      obj0File(
        [
          { fileDataId: 500, uniqueId: 1, position: at(-100, -100, 10) },
          { fileDataId: 501, uniqueId: 2, position: at(-150, -150, 0) },
          { fileDataId: 501, uniqueId: 3, position: at(-160, -160, 0), scale: 3 },
        ],
        [{ fileDataId: 600, uniqueId: 1, position: at(-300, -300, 20), doodadSet: 1, nameSet: 2 }],
      ),
    ],
    // the neighbour tile repeats placement 1 (an object spanning both tiles): read once
    [2001, obj0File([{ fileDataId: 500, uniqueId: 1, position: at(-100, -100, 10) }], [])],
    [500, m2File(square, [0, 1, 2, 1, 3, 2])],
    [501, m2File(small, [0, 1, 2])],
    [
      600,
      wmoRootFile({
        wmoId: 77,
        groups: [601, 602],
        doodadSets: [
          { name: 'Set_$DefaultGlobal', start: 0, count: 1 },
          { name: 'Set_1', start: 1, count: 1 },
          { name: 'Set_2', start: 2, count: 1 },
        ],
        doodadIds: [500],
        doodads: [
          { nameIndex: 0, position: [0, 0, 0] },
          { nameIndex: 0, position: [20, 0, 0] },
          { nameIndex: 0, position: [40, 0, 0] },
        ],
      }),
    ],
    [
      601,
      wmoGroupFile({
        wmoGroupId: 5,
        groupLiquid: 15,
        vertices: [0, 0, 0, 5, 0, 0, 0, 5, 0],
        triangles: [
          [0, 1, 2, 0x08],
          [0, 2, 1, 0x04],
        ],
        liquid: { xTiles: 1, yTiles: 1, corner: [0, 0, 1], height: 1, tiles: [0x00] },
      }),
    ],
    [602, wmoGroupFile({ flags: 0x80, wmoGroupId: 6, vertices: [0, 0, 0, 5, 0, 0, 0, 5, 0], triangles: [[0, 1, 2, 0x08]] })],
  ]);
  const wdt = parseWdt(
    wdtFile([
      { row: ROW, col: COL, root: 1000, obj0: 2000 },
      { row: ROW, col: COL + 1, root: 1001, obj0: 2001 },
    ]),
  );
  const clip = expandRect(tileRect(ROW, COL), 8);

  it('adds M2 and WMO collision with dedup, the footprint filter, doodad sets, liquids and area tags', () => {
    const src = source(files);
    const g = blockGeometry(src, wdt, [{ row: ROW, col: COL }, { row: ROW, col: COL + 1 }], baseOptions(clip));
    expect(g.stats).toMatchObject({ adtTiles: 2, m2Placements: 3, m2SkippedSmall: 1, wmoPlacements: 1, wmoGroupsSkipped: 1, wmoDoodads: 2, wmoTriangles: 1, liquidTriangles: 2 });
    const objects = [...g.classes].flatMap((c, t) => (c === AREA_CLASS.object ? [g.tags[t]] : []));
    // M2 square (2) + scaled M2 (1) with tag 0; WMO group triangle (1) with its group area; doodads of sets 0 and 1 (2 × 2) with the root area
    expect(objects.sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([0, 0, 0, 1497, 1497, 1497, 1497, 1500]);
    const water = [...g.classes].flatMap((c, t) => (c === AREA_CLASS.water ? [g.tags[t]] : []));
    expect(water).toEqual([1500, 1500]); // groupLiquid 15 = none, so the MLIQ tile (legacy water) decides
    // the second tile's terrain is outside the clip except the triangles on the shared edge
    expect(g.inputs).toEqual([500, 501, 600, 601, 602, 1000, 1001, 2000, 2001]);
    expect(src.reads.filter((id) => id === 500)).toHaveLength(1);
    // the M2 square lies at z 10 over flat terrain at z 0, transformed with diag(−1, −1, 1)
    const m2Triangle = [...g.classes].findIndex((c, t) => c === AREA_CLASS.object && g.tags[t] === 0);
    expect([...g.positions.subarray(m2Triangle * 9, m2Triangle * 9 + 9)]).toEqual([-100, -100, 10, -110, -100, 10, -100, -110, 10]);
  });

  it('classes a WMO liquid as hazard when its resolved LiquidType is a hazard', () => {
    const hot = new Map(files);
    hot.set(601, wmoGroupFile({ wmoGroupId: 5, groupLiquid: 2, vertices: [], triangles: [], liquid: { xTiles: 1, yTiles: 1, corner: [0, 0, 1], height: 1 } }));
    const g = blockGeometry(source(hot), wdt, [{ row: ROW, col: COL }], baseOptions(clip));
    expect(counts(g)[AREA_CLASS.hazard]).toBe(2); // 2 + 1 = legacy magma = LiquidType 19
  });

  it('keeps small M2s with a zero footprint limit, and refuses legacy-named placements and missing files', () => {
    const keepAll = blockGeometry(source(files), wdt, [{ row: ROW, col: COL }], { ...baseOptions(clip), m2MinFootprint: 0 });
    expect(keepAll.stats.m2SkippedSmall).toBe(0);
    const legacy = new Map(files);
    legacy.set(2000, obj0File([{ fileDataId: 7, uniqueId: 9, position: at(-100, -100, 0), legacyName: true }], []));
    expect(() => blockGeometry(source(legacy), wdt, [{ row: ROW, col: COL }], baseOptions(clip))).toThrow(FormatError);
    const missing = new Map(files);
    missing.delete(601);
    expect(() => blockGeometry(source(missing), wdt, [{ row: ROW, col: COL }], baseOptions(clip))).toThrow(/missing 601/);
  });

  it('gives polygon areas from the source triangle nearest in height, else the chunk area, and rolls them up to zones', () => {
    const g = blockGeometry(source(files), wdt, [{ row: ROW, col: COL }], baseOptions(clip));
    const zi = zoneIndex(g);
    // on the WMO group triangle (model (1, 1, 0) → world (−301, −301, 20))
    expect(areaAt(zi, -301, -301, 20)).toEqual({ area: 1500, fromTriangle: true });
    // on terrain far from any object
    expect(areaAt(zi, -400, -50, 0.2)).toEqual({ area: 14, fromTriangle: true });
    // on the M2 square (tag 0): falls back to the chunk area
    expect(areaAt(zi, -105, -103, 10)).toEqual({ area: 14, fromTriangle: false });
    // nothing within 8 yd of the height
    expect(areaAt(zi, -400, -50, 30)).toEqual({ area: 14, fromTriangle: false });
    const parents = areaParents([
      { id: 1500, parent: 1497 },
      { id: 1497, parent: 0 },
      { id: 14, parent: 0 },
    ]);
    expect(zoneAt(parents, zi, -301, -301, 20)).toBe(1497);
  });
});

describe('zones', () => {
  it('rolls areas up through ParentAreaID and refuses cycles', () => {
    const parents = areaParents([
      { id: 363, parent: 14 },
      { id: 14, parent: 0 },
      { id: 1, parent: 2 },
      { id: 2, parent: 1 },
    ]);
    expect(topZone(parents, 363)).toBe(14);
    expect(topZone(parents, 14)).toBe(14);
    expect(topZone(parents, 99999)).toBe(99999);
    expect(() => topZone(parents, 1)).toThrow(/cycle/);
  });

  it('looks up WMOAreaTable by (WMO, name set, group) with the name-set-0 and root fallbacks; the last row wins', () => {
    const index = wmoAreaIndex([
      { wmoId: 1150, nameSet: 0, groupId: -1, areaId: 1497 },
      { wmoId: 1150, nameSet: 3, groupId: -1, areaId: 16611 },
      { wmoId: 1150, nameSet: 0, groupId: 42, areaId: 1500 },
      { wmoId: 1150, nameSet: 0, groupId: 42, areaId: 1501 },
    ]);
    expect(index.size).toBe(3);
    expect(wmoGroupArea(index, 1150, 0, 42)).toBe(1501);
    expect(wmoGroupArea(index, 1150, 7, 42)).toBe(1501); // name set 0
    expect(wmoGroupArea(index, 1150, 3, 9)).toBe(16611); // the root row of name set 3
    expect(wmoGroupArea(index, 1150, 7, 9)).toBe(1497); // the root row of name set 0
    expect(wmoRootArea(index, 9999, 0)).toBe(0);
  });
});
