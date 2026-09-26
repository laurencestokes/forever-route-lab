import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { inputHash } from '../../../casc/input-hash';
import { parseAdtRoot } from '../formats/adt';
import { UNIT_YD } from '../formats/grid';
import { adtRoot, wdtFile, type SynthMcnk } from '../formats/test-support';
import { decodePoints } from './arcs';
import { buildTerrain, mapByproducts, type ByproductSource } from './build';
import { addTile, boundsRect, createGrids, isWetQuad, tileBounds } from './grids';
import { indicesSha256, shadedRelief } from './relief';

const WDT = 500;
const ckey = (id: number): string => createHash('md5').update(String(id)).digest('hex');

/**
 * Two tiles, (30, 30) and (30, 31). Tile 30_30: area 363 (a subzone of 14) everywhere; chunk
 * (1, 1) holds a 4 × 4-quad lake 5 yd deep in its north-west corner; chunk (3, 1) a magma pool;
 * chunk (5, 1) water only 0.2 yd deep; chunk (7, 1) four holes. Tile 30_31: area 17, flat.
 */
function syntheticSource(): ByproductSource {
  const lake = { type: 1, objectOrFormat: 42, min: 5, max: 5, x: 0, y: 0, width: 4, height: 4 };
  const liquids = [
    { index: 1 * 16 + 1, instances: [lake] },
    { index: 1 * 16 + 3, instances: [{ ...lake, type: 19 }] },
    { index: 1 * 16 + 5, instances: [{ ...lake, min: 0.2, max: 0.2 }] },
  ];
  const holes: SynthMcnk = { ix: 7, iy: 1, areaId: 363, holes: [0, 1, 8, 9] };
  const files = new Map<number, Buffer>([
    [WDT, wdtFile([{ row: 30, col: 30, root: 600, obj0: 700 }, { row: 30, col: 31, root: 601, obj0: 710 }])],
    [600, adtRoot(30, 30, [holes], liquids, 363)],
    [601, adtRoot(30, 31, [], null, 17)],
  ]);
  return {
    parents: new Map([
      [363, 14],
      [14, 0],
      [17, 0],
    ]),
    hazard: new Set([19]),
    tables: [{ table: 'AreaTable', fileDataId: 1353545, ckey: ckey(1353545), rows: 3 }],
    read: (id) => {
      const data = files.get(id);
      if (data === undefined) throw new Error(`missing ${String(id)}`);
      return { data, ckey: ckey(id) };
    },
  };
}

const options = { client: { product: 'wow_classic_beta', version: '1.60.1.70009', buildKey: '05215079e3905ef5922ae0b03ffefb73' }, toolTrees: { trees: { 'tools/terrain/byproducts.ts': 'e'.repeat(64) }, method: 'test' }, zlib: 'test' };

describe('terrain grids', () => {
  const source = syntheticSource();
  const bounds = tileBounds([{ row: 30, col: 31 }, { row: 30, col: 30 }]);
  const grids = createGrids(bounds);
  addTile(grids, { row: 30, col: 30 }, parseAdtRoot(source.read(600).data), source.parents, source.hazard);
  addTile(grids, { row: 30, col: 31 }, parseAdtRoot(source.read(601).data), source.parents, source.hazard);

  it('covers the tile rectangle: zones per chunk, heights per 8.33 yd, water per quad', () => {
    expect(bounds).toEqual({ row0: 30, row1: 30, col0: 30, col1: 31 });
    const rect = boundsRect(bounds);
    expect([rect.xMin, rect.xMax, rect.yMin, rect.yMax].map((v) => Math.round(v * 1000) / 1000)).toEqual([533.333, 1066.667, 0, 1066.667]);
    expect([grids.chunkRows, grids.chunkCols, grids.heightCols, grids.quadCols]).toEqual([16, 32, 128, 256]);
    expect(new Set(grids.zone)).toEqual(new Set([14, 17]));
    expect(grids.zone[0]).toBe(14);
    expect(grids.zone[16]).toBe(17);
    expect(grids.height.every((h) => h === 0)).toBe(true);
    expect(grids.water.filter((w) => w === 2)).toHaveLength(16);
    expect(grids.water.every((w) => w === 1 || w === 2)).toBe(true);
    // The lake's quads, chunk (1, 1): quad rows 8-11, columns 8-11.
    expect(grids.water[8 * 256 + 8]).toBe(2);
    expect(grids.water[11 * 256 + 11]).toBe(2);
    expect(grids.water[12 * 256 + 8]).toBe(1);
  });

  it('counts a quad as water only under non-hazard liquid over 0.3 yd deep', () => {
    const root = parseAdtRoot(source.read(600).data);
    const chunk = (ix: number, iy: number) => root.chunks.find((m) => m.ix === ix && m.iy === iy);
    const lake = chunk(1, 1);
    const magma = chunk(3, 1);
    const shallow = chunk(5, 1);
    expect(lake === undefined ? null : [isWetQuad(lake, 0, 0, source.hazard), isWetQuad(lake, 4, 4, source.hazard)]).toEqual([true, false]);
    expect(magma === undefined ? null : isWetQuad(magma, 0, 0, source.hazard)).toBe(false);
    expect(shallow === undefined ? null : isWetQuad(shallow, 0, 0, source.hazard)).toBe(false);
  });

  it('shades flat ground evenly and marks the lake pixel as water', () => {
    const relief = shadedRelief(grids);
    expect([relief.width, relief.height]).toEqual([64, 32]);
    expect(relief.pixelYd).toBeCloseTo(50 / 3, 12);
    expect(relief.indices[2 * 64 + 2]).toBe(1);
    // Flat ground: shade = 0.7071 (the light's height), level 2 + floor(0.7071 × 14) = 11.
    expect(relief.indices[0]).toBe(11);
    expect([...new Set(relief.indices)].sort()).toEqual([1, 11]);
    expect(indicesSha256(relief)).toBe(indicesSha256(shadedRelief(grids)));
  });
});

describe('map byproducts', () => {
  const source = syntheticSource();
  const map = { mapId: 7, name: 'Synthetic', wdtFileDataId: WDT };

  it('traces zone arcs between the two zones and a closed coast ring around the lake', () => {
    const out = mapByproducts(map, source);
    const pairs = out.zoneArcs.map((a) => `${String(a.left)}:${String(a.right)}`).sort();
    expect(pairs).toEqual(['0:14', '0:17', '14:17']);
    expect(out.coastArcs).toHaveLength(1);
    const ring = out.coastArcs[0]?.points ?? [];
    expect(ring.slice(0, 2)).toEqual(ring.slice(-2));
    let perimeter = 0;
    for (let i = 2; i < ring.length; i += 2) perimeter += Math.abs((ring[i] ?? 0) - (ring[i - 2] ?? 0)) + Math.abs((ring[i + 1] ?? 0) - (ring[i - 1] ?? 0));
    expect(perimeter).toBeCloseTo(16 * UNIT_YD, 9);
    expect(out.entry).toMatchObject({ mapId: 7, name: 'Synthetic', wdt: WDT, tiles: 2, tileRows: [30, 30], tileCols: [30, 31], inputFiles: 4 });
    expect(out.entry['inputHash']).toBe(inputHash([WDT, 600, 601, 1353545].map((id) => ({ fileDataId: id, ckey: ckey(id) }))));
  });

  it('writes compact JSON with integer yards, a 4-bit relief PNG, a manifest listing every file and a NOTICE', () => {
    const build = buildTerrain([map], source, options);
    const files = build.maps[0]?.files ?? [];
    expect(files.map((f) => f.path)).toEqual(['7/zones.json', '7/coast.json', '7/relief.png']);
    const zones = JSON.parse(files[0]?.bytes.toString('utf8') ?? '{}') as { kind: string; mapId: number; zones: number[]; arcs: number[][] };
    expect([zones.kind, zones.mapId, zones.zones]).toEqual(['terrain-zones', 7, [14, 17]]);
    expect(zones.arcs.every((a) => a.every(Number.isInteger))).toBe(true);
    const border = zones.arcs.find((a) => a[0] === 14 && a[1] === 17) ?? [];
    // The tile border at Y = 533.3, walked south to north so that zone 14 (the western tile) is on the left.
    expect(decodePoints(border.slice(2))).toEqual([533, 533, 1067, 533]);
    const coast = JSON.parse(files[1]?.bytes.toString('utf8') ?? '{}') as { kind: string; arcs: number[][] };
    expect(coast.kind).toBe('terrain-coast');
    expect(files[2]?.meta).toMatchObject({ kind: 'relief', contentType: 'image/png', width: 64, height: 32 });
    const manifest = JSON.parse(build.manifestText) as { files: { path: string; sha256: string }[]; maps: unknown[]; kind: string };
    expect(manifest.kind).toBe('terrain-byproducts');
    expect(manifest.files.map((f) => f.path)).toEqual(files.map((f) => f.path));
    for (const [i, f] of files.entries()) expect(manifest.files[i]?.sha256).toBe(createHash('sha256').update(f.bytes).digest('hex'));
    expect(build.noticeText).toContain('not affiliated with or endorsed by Blizzard Entertainment');
    expect(build.noticeText).toContain('D-032');
    expect(build.noticeText.replace(/\s+/g, ' ')).toContain("not copies of game files and not the game's painted map art");
    const again = buildTerrain([map], source, options);
    expect(again.manifestText).toBe(build.manifestText);
    expect(again.noticeText).toBe(build.noticeText);
  });
});
