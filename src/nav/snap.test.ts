import { describe, expect, it } from 'vitest';
import { buildTestMap, square, testManifestJson, tileOf, worldOf, type Voxel } from '../../tests/support/nav-mesh';
import { blockTileOrigin } from './grid';
import { parseNavManifest } from './manifest';
import { loadBlock } from './open';
import { NavBlocksMissingError, snap, snapBlocks, snapMissing } from './snap';

const A = { row0: 28, col0: 36 };
const B = { row0: 28, col0: 40 };
const P = parseNavManifest(testManifestJson(1, [{ ...A, polygons: 1 }])).params;
const { tx0, tz0 } = blockTileOrigin(P, A.row0, A.col0);
const w = (vx: number, vz: number, dtz = 0): { x: number; y: number } => worldOf(P, tx0, tz0 + dtz, vx, vz);

// polygons 0-19: a strip of 20 (one component of 20); 20: a floor over strip polygon 0, 20 yd up;
// 21 and 22: two stacked single floors (zones 14 and 1497); 23: a small floor near strip polygon 3
const polys: Voxel[][] = [
  ...Array.from({ length: 20 }, (_, i) => square(i * 10, 0, i * 10 + 10, 10)),
  square(0, 0, 10, 10, 120),
  square(100, 100, 120, 120, 120),
  square(100, 100, 120, 120, 200),
  square(30, 12, 40, 22),
];
const zones = [...new Array<number>(22).fill(14), 1497, 14];
const mesh = buildTestMap([{ ...A, tiles: [tileOf(tx0, tz0, polys)], zones }]).full();

describe('snap rules (terrain-navigation.md §8.1)', () => {
  it('rule B keeps components of at least 20 polygons; without it the floors are ambiguous', () => {
    const p = w(5, 5);
    const s = snap(mesh, p.x, p.y, 0);
    expect(s.poly).toBe(0);
    expect(s.dist).toBe(0);
    expect(s.floors).toEqual([0, 20]);
    expect(s.flags).toEqual({ hint: 'none', ruleB: true, reassigned: false, ambiguous: false, spanYd: 0 });
    expect(s.containingComps).toEqual([mesh.comp[0]]);
    const all = snap(mesh, p.x, p.y, 0, { minComp: 0 });
    expect(all.poly).toBe(0); // component size before height
    expect(all.flags.ambiguous).toBe(true);
    expect(all.flags.spanYd).toBe(20);
  });

  it('orders equal candidates by the lowest floor, and rule A picks the hinted zone', () => {
    const p = w(110, 110);
    const plain = snap(mesh, p.x, p.y, 0);
    expect(plain.poly).toBe(21);
    expect(plain.flags.ambiguous).toBe(true);
    expect(plain.flags.spanYd).toBe(20);
    const hinted = snap(mesh, p.x, p.y, 1497);
    expect(hinted.poly).toBe(22);
    expect(hinted.flags.hint).toBe('used');
    expect(hinted.flags.ambiguous).toBe(false);
    const miss = snap(mesh, p.x, p.y, 999);
    expect(miss.poly).toBe(21);
    expect(miss.flags.hint).toBe('miss');
  });

  it('prefers containing polygons, then distance, and records a rule-B reassignment', () => {
    const near = w(205, 5);
    const s = snap(mesh, near.x, near.y, 0);
    expect(s.poly).toBe(19);
    expect(s.dist).toBeCloseTo(5 * P.cs, 9);
    const small = w(35, 17);
    const r = snap(mesh, small.x, small.y, 0);
    expect(r.floors).toEqual([23]);
    expect(r.poly).toBe(3);
    expect(r.flags.ruleB).toBe(true);
    expect(r.flags.reassigned).toBe(true);
    expect(snap(mesh, small.x, small.y, 0, { minComp: 0 }).poly).toBe(23);
  });

  it('answers none beyond the radius', () => {
    const far = w(240, 240);
    const s = snap(mesh, far.x, far.y, 0);
    expect(s.poly).toBe(-1);
    expect(s.dist).toBe(Infinity);
    expect(s.floors).toEqual([]);
  });
});

describe('snap loading (RC-06)', () => {
  // A's last tile column meets B's first; B has a polygon at its edge, A has nothing near
  const t = buildTestMap([
    { ...A, tiles: [tileOf(tx0, tz0, [square(0, 0, 20, 20)])] },
    { ...B, tiles: [tileOf(tx0, tz0 + 16, [square(0, 0, 20, 20)])] },
  ]);

  it('needs every block within 6 yd, and finds the candidate across the seam', () => {
    // 2 yd inside A from the seam (voxel z 256 − 2 / cs of A's last tile)
    const p = worldOf(P, tx0, tz0 + 15, 10, 256 - 2 / P.cs);
    const mesh2 = t.open();
    expect(snapBlocks(mesh2, p.x, p.y)).toEqual([0, 1]);
    loadBlock(mesh2, 0, t.blockBytes[0] ?? new Uint8Array());
    expect(snapMissing(mesh2, p.x, p.y)).toEqual([1]);
    expect(() => snap(mesh2, p.x, p.y, 0)).toThrow(NavBlocksMissingError);
    loadBlock(mesh2, 1, t.blockBytes[1] ?? new Uint8Array());
    const s = snap(mesh2, p.x, p.y, 0);
    expect(s.poly).toBe(1);
    expect(s.dist).toBeCloseTo(2, 9);
    // 7 yd from the seam: only A
    const q = worldOf(P, tx0, tz0 + 15, 10, 256 - 7 / P.cs);
    expect(snapBlocks(mesh2, q.x, q.y)).toEqual([0]);
  });
});
