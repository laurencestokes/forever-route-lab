import { beforeAll, describe, expect, it } from 'vitest';
import { keepTile } from './encode';
import { MAP_ORIGIN_YD } from './formats/grid';
import { AREA_CLASS, type BlockGeometry } from './geometry';
import { DERIVED } from './nav-test-support';
import { binTriangles, buildBlockTiles, canonicalOrder, ensureRecast, recastModuleInfo, tileHeightVoxels, tileOriginStep, triangleKeys, type RecastTile } from './recast';

/** A synthetic triangle soup: a flat ground square over ADT (31, 31), a water sheet over part of it, and a raised platform. */
function soup(order: (n: number) => number[] = (n) => [...Array(n).keys()]): BlockGeometry {
  const tris: [number, number, number][][] = [];
  const cls: number[] = [];
  const quad = (x0: number, y0: number, x1: number, y1: number, z: number, c: number): void => {
    tris.push([[x0, y0, z], [x1, y0, z], [x1, y1, z]], [[x0, y0, z], [x1, y1, z], [x0, y1, z]]);
    cls.push(c, c);
  };
  quad(2, 2, 530, 530, 10, AREA_CLASS.ground);
  quad(100, 100, 300, 180, 10.5, AREA_CLASS.water);
  quad(350, 350, 420, 420, 14, AREA_CLASS.object);
  const idx = order(tris.length);
  const positions = new Float64Array(idx.length * 9);
  idx.forEach((t, i) => {
    tris[t]?.forEach((v, k) => positions.set(v, i * 9 + k * 3));
  });
  return {
    positions,
    triangles: Int32Array.from({ length: idx.length * 3 }, (_, i) => i),
    classes: Uint8Array.from(idx.map((t) => cls[t] ?? 0)),
    tags: new Int32Array(idx.length),
    triangleCount: idx.length,
    chunkAreas: new Map(),
    inputs: [],
    stats: { adtTiles: 1, terrainTriangles: 0, liquidTriangles: 0, wmoPlacements: 0, wmoTriangles: 0, wmoGroupsSkipped: 0, m2Placements: 0, m2Triangles: 0, m2SkippedSmall: 0, wmoDoodads: 0, clippedOut: 0, bytesRead: 0 },
  };
}

const tileKey = (t: RecastTile): string => `${String(t.tx)},${String(t.tz)}`;
const summary = (tiles: readonly RecastTile[]): Map<string, string> =>
  new Map(tiles.map((t) => [tileKey(t), JSON.stringify([t.originStep, [...t.verts], [...t.polys], [...t.areas]])]));

describe('Recast per tile (terrain-navigation.md §3.1 step 2, §6)', () => {
  beforeAll(async () => {
    await ensureRecast();
  });

  it('records the pinned recast-navigation and hashes its WASM module', () => {
    const info = recastModuleInfo();
    expect(info.version).toBe('0.43.1');
    expect(info.wasmSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('puts each tile on the map grid with its own vertical origin', () => {
    expect(tileOriginStep(DERIVED, 10)).toBe(36);
    expect(tileOriginStep(DERIVED, -24)).toBe(-100);
    expect(tileHeightVoxels(DERIVED, 36, 14)).toBe(Math.ceil((14 + 4 - 9) / 0.25));
    expect(tileHeightVoxels(DERIVED, 0, 5000)).toBe(8191);
    const g = soup();
    const bins = binTriangles(g, DERIVED, 128, 124, 4);
    expect(bins.every((b) => b.length > 0)).toBe(true);
  });

  it('sorts triangles into one canonical order whatever their input order and vertex rotation', () => {
    const g = soup();
    const r = soup((n) => [...Array(n).keys()].reverse());
    const kg = triangleKeys(g);
    const kr = triangleKeys(r);
    const a = canonicalOrder(kg, [...Array(g.triangleCount).keys()]).map((t) => [...kg.subarray(t * 10, t * 10 + 10)]);
    const b = canonicalOrder(kr, [...Array(r.triangleCount).keys()]).map((t) => [...kr.subarray(t * 10, t * 10 + 10)]);
    expect(b).toEqual(a);
    // a triangle with rotated vertices gets the same key
    const rot: BlockGeometry = { ...g, positions: Float64Array.from([...g.positions.subarray(3, 9), ...g.positions.subarray(0, 3), ...g.positions.subarray(9)]) };
    expect([...triangleKeys(rot).subarray(0, 10)]).toEqual([...kg.subarray(0, 10)]);
  });

  it('gives identical tiles for a shuffled soup and for another block partition (partition invariance, G4)', () => {
    const g = soup();
    const whole = buildBlockTiles(g, DERIVED, 28, 28).tiles.filter((t) => t.tx >= 128 && t.tx < 132 && t.tz >= 124 && t.tz < 128);
    expect(whole).toHaveLength(16);
    const shuffled = buildBlockTiles(soup((n) => [3, 0, 5, 1, 4, 2].slice(0, n)), DERIVED, 28, 28).tiles.filter((t) => t.tx >= 128 && t.tx < 132 && t.tz >= 124 && t.tz < 128);
    expect(summary(shuffled)).toEqual(summary(whole));
    const single = buildBlockTiles(g, DERIVED, 31, 31, 1);
    expect(summary(single.tiles)).toEqual(summary(whole));
    expect(single.stats.polygons).toBeGreaterThan(0);
    // every tile has walkable ground, the water sheet makes swim polygons, nothing is hazard or deep
    const areas = new Set(whole.flatMap((t) => [...t.areas]));
    expect([...areas].sort()).toEqual([1, 3]);
    const kept = whole.map(keepTile);
    expect(kept.every((t) => t !== null)).toBe(true);
  });

  it('keeps world coordinates: vertices lie inside the tile, heights on the tile origin', () => {
    const t = buildBlockTiles(soup(), DERIVED, 31, 31, 1).tiles[0];
    expect(t).toBeDefined();
    if (t === undefined) return;
    for (let v = 0; v < t.nv; v += 1) {
      expect(t.verts[v * 3]).toBeLessThanOrEqual(256);
      expect(t.verts[v * 3 + 2]).toBeLessThanOrEqual(256);
      const z = (t.originStep + (t.verts[v * 3 + 1] ?? 0)) * DERIVED.ch;
      expect(Math.abs(z - 10)).toBeLessThan(1);
    }
    expect(-MAP_ORIGIN_YD + t.tx * DERIVED.tileYd).toBeCloseTo(0, 6);
  });
});
