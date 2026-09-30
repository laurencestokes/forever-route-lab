import { describe, expect, it } from 'vitest';
import { bilin, boundaryOf, cellOf, chamfer, CLASS_INLAND, CLASS_LAND, CLASS_NONE, CLASS_SEA, polygonRaster, reliefGrid, signedDistance } from './atlas-mask';
import { RELIEF_WATER } from './atlas-params';
import { continentLand } from './atlas-scene';
import { islandGrid, ISLAND_ARCS } from './atlas-test-support';

/** Masks and distances of docs/research/map-atlas.md §6.2 on synthetic rasters. */

describe('the chamfer distance', () => {
  it('is 0 on the target, 1 per axis step and 4/3 per diagonal step, capped', () => {
    const mask = new Uint8Array(25);
    mask[12] = 1;
    const d = chamfer(mask, 5, 5, 1, 100);
    expect(d[12]).toBe(0);
    expect(d[13]).toBe(1);
    expect(d[18]).toBeCloseTo(4 / 3, 6);
    expect(d[14]).toBe(2);
    expect(chamfer(mask, 5, 5, 1, 1.5)[14]).toBe(1.5);
  });
});

describe('polygons', () => {
  it('rasterises a polygon by scanlines and signs the distance to it', () => {
    // area 10 of the synthetic island: X −800 … 800, Y 0 … 1,200; placed with eOff 2,004, sOff 1,336
    const segs = boundaryOf(ISLAND_ARCS, new Set([10]));
    expect(segs).toHaveLength(4);
    const p = 4;
    const P = polygonRaster(segs, 2004, 1336, p, 0, 0, 1002, 668);
    const px = (X: number, Y: number): number => P[Math.floor((1336 - X) / p) * 1002 + Math.floor((2004 - Y) / p)] ?? -1;
    expect(px(0, 600)).toBe(1);
    expect(px(0, -600)).toBe(0);
    expect(px(1000, 600)).toBe(0);
    const sd = signedDistance(P, 1002, 668, 200);
    const at = (X: number, Y: number): number => sd[Math.floor((1336 - X) / p) * 1002 + Math.floor((2004 - Y) / p)] ?? 0;
    expect(at(0, 600)).toBeGreaterThan(0);
    expect(at(0, -600)).toBeLessThan(0);
    // 600 yd = 150 px from the edge at 4 yd/px, within a pixel
    expect(Math.abs(at(0, -600) + 150)).toBeLessThanOrEqual(1);
  });
});

describe('the relief grid', () => {
  it('classes sea, land, inland water and outside, and fills the areas', () => {
    const g = islandGrid();
    expect(g.cls[cellOf(g, 0, 0)]).toBe(CLASS_LAND);
    expect(g.cls[cellOf(g, 1500, 0)]).toBe(CLASS_SEA);
    expect(g.area[cellOf(g, 0, 600)]).toBe(10);
    expect(g.area[cellOf(g, 0, -600)]).toBe(20);
    expect(g.area[cellOf(g, 1500, 0)]).toBe(-1);
    expect(cellOf(g, 5000, 0)).toBe(-1);
    expect(bilin(g, 0, 0, (k) => (k >= 0 ? 1 : 0))).toBe(1);
  });

  it('calls water enclosed by land inland water', () => {
    // 5 × 5 cells: land ring, one water cell in the middle; water outside the ring at the edge
    const w = 7;
    const d = new Uint8Array(w * w * 4);
    for (let y = 0; y < w; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const ring = x >= 1 && x <= 5 && y >= 1 && y <= 5 && !(x === 3 && y === 3);
        const px = ring ? [150, 150, 150] : RELIEF_WATER;
        d.set([...px, 255], (y * w + x) * 4);
      }
    }
    d[3] = 0; // cell (0, 0) lies outside the terrain
    const g = reliefGrid(1, d, w, w, 10, { xMin: 0, xMax: 70, yMin: 0, yMax: 70 }, []);
    expect(g.cls[3 * w + 3]).toBe(CLASS_INLAND);
    expect(g.cls[0]).toBe(CLASS_NONE);
    expect(g.cls[1]).toBe(CLASS_SEA);
    expect(g.inland).toBe(1);
  });
});

describe('the continent land test mask', () => {
  it('is land where R − B > 95, dilated by 4 source pixels', () => {
    const w = 20;
    const h = 5;
    const d = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i += 1) d.set(i % w < 10 ? [200, 100, 50, 255] : [50, 80, 160, 255], i * 4);
    const land = continentLand({ w, h, d }, 95, 4);
    expect(land[2 * w + 9]).toBe(1);
    expect(land[2 * w + 13]).toBe(1);
    expect(land[2 * w + 14]).toBe(0);
  });
});
