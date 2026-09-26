import { describe, expect, it } from 'vitest';
import { buildTestMap, square, tileOf, worldOf, type TestBlock, type Voxel } from '../../tests/support/nav-mesh';
import { componentOf, recomputeComponents, sameComponent } from './components';
import { decodeBlock } from './format';
import { blockTileOrigin, neighbourBlock } from './grid';
import { climbThreshold, recastAdjacency } from './link';
import { hasSide, NavMeshError } from './mesh';
import { loadBlock } from './open';

const A = { row0: 28, col0: 36 };
const B = { row0: 28, col0: 40 };
/** Tile origin of block A and B. */
const oa = { tx0: (63 - (A.row0 + 3)) * 4, tz0: A.col0 * 4 };
const ob = { tx0: (63 - (B.row0 + 3)) * 4, tz0: B.col0 * 4 };

describe('recastAdjacency (Recast buildMeshAdjacency pairing, §5)', () => {
  it('pairs each reverse edge with the most recent unmatched forward edge, symmetrically', () => {
    // two polygons (0 and 2) share the forward edge 1→2, two (1 and 3) the reverse edge 2→1
    const polys = [
      [0, 1, 2], // slots 0-2: 0→1, 1→2 (forward), 2→0
      [2, 1, 3], // slots 3-5: 2→1 (reverse), 1→3, 3→2
      [4, 1, 2], // slots 6-8: 4→1, 1→2 (forward, the most recent), 2→4
      [5, 2, 1], // slots 9-11: 5→2, 2→1 (reverse), 1→5
    ];
    const nei = new Int32Array(12).fill(-1);
    recastAdjacency(Int32Array.of(0, 3, 6, 9, 12), Int32Array.from(polys.flat()), 0, 4, 0, 6, nei, 0);
    // polygon 1's reverse edge takes polygon 2's forward edge (most recent), polygon 3's the one left
    const expected = new Int32Array(12).fill(-1);
    expected[3] = 2;
    expected[7] = 1;
    expected[10] = 0;
    expected[1] = 3;
    expect([...nei]).toEqual([...expected]);
  });
});

function twoTiles(second: readonly Voxel[]): TestBlock {
  return { ...A, tiles: [tileOf(oa.tx0, oa.tz0, [square(200, 0, 256, 40)]), tileOf(oa.tx0 + 1, oa.tz0, [second])] };
}

describe('the slab relinker inside a block (§6.1)', () => {
  it('links facing portal edges over their overlap, in both directions, with the portal in the source order', () => {
    const t = buildTestMap([twoTiles(square(0, 20, 60, 80))]);
    const mesh = t.full();
    const m = mesh.block(0);
    expect(m).not.toBeNull();
    if (m === null) return;
    expect([...m.cross.first]).toEqual([0, 1, 2]);
    expect([...m.cross.to]).toEqual([1, 0]);
    // the overlap is z 20..40 on the line x = tile edge
    const w20 = worldOf(mesh.P, oa.tx0 + 1, oa.tz0, 0, 20);
    const w40 = worldOf(mesh.P, oa.tx0 + 1, oa.tz0, 0, 40);
    const ys = [m.cross.ay[0] ?? 0, m.cross.by[0] ?? 0].sort((p, q) => p - q);
    expect(ys[0]).toBeCloseTo(Math.min(w20.y, w40.y), 9);
    expect(ys[1]).toBeCloseTo(Math.max(w20.y, w40.y), 9);
    expect(m.cross.ax[0]).toBeCloseTo(w20.x, 9);
    expect(sameComponent(mesh, 0, 1)).toBe(true);
  });

  it('links across a height step of 2 × walkableClimb and not beyond', () => {
    expect(climbThreshold(1.5, 0.25)).toBe(9);
    const at = (dy: number): number => buildTestMap([twoTiles(square(0, 0, 60, 40, 40 + dy))]).full().block(0)?.cross.to.length ?? -1;
    expect(at(12)).toBe(2); // 3.00 yd
    expect(at(13)).toBe(0); // 3.25 yd
  });

  it('does not link edges that are not on one line', () => {
    const t = buildTestMap([{ ...A, tiles: [tileOf(oa.tx0, oa.tz0, [square(200, 0, 255, 40)]), tileOf(oa.tx0 + 1, oa.tz0, [square(0, 0, 60, 40)])] }]);
    const mesh = t.full();
    expect(mesh.block(0)?.cross.to.length).toBe(0);
    expect(recomputeComponents(mesh).sizes.length).toBe(2);
  });
});

function seamPair(): ReturnType<typeof buildTestMap> {
  // A's last tile column (tz0 + 15) meets B's first (tz0 + 16) on A's side 1
  return buildTestMap([
    { ...A, tiles: [tileOf(oa.tx0 + 3, oa.tz0 + 15, [square(0, 100, 50, 256), square(50, 100, 100, 256)])] },
    { ...B, tiles: [tileOf(ob.tx0 + 3, ob.tz0, [square(20, 0, 80, 60)])] },
  ]);
}

describe('links across block seams (§6.1, §9.6)', () => {
  it('appear when the second block loads, whatever the order, and go when either unloads', () => {
    const t = seamPair();
    expect(neighbourBlock(t.manifest.params, A.row0, A.col0, 1)).toEqual(B);
    const ab = t.open();
    loadBlock(ab, 0, t.blockBytes[0] ?? new Uint8Array());
    expect(ab.block(0)?.sides[1]).toBeNull();
    expect(ab.missingFor(0)).toEqual([1]);
    loadBlock(ab, 1, t.blockBytes[1] ?? new Uint8Array());
    expect(ab.missingFor(0)).toEqual([]);
    const ba = t.open();
    loadBlock(ba, 1, t.blockBytes[1] ?? new Uint8Array());
    expect(ba.missingFor(2)).toEqual([0]);
    loadBlock(ba, 0, t.blockBytes[0] ?? new Uint8Array());
    for (const [b, side] of [
      [0, 1],
      [1, 3],
    ] as const) {
      const x = ab.block(b)?.sides[side];
      const y = ba.block(b)?.sides[side];
      expect(x).toBeTruthy();
      expect(y).toEqual(x);
    }
    // polygon 0 (A) and 1 (A) both overlap B's polygon 2; each gets one link each way
    expect([...(ab.block(0)?.sides[1]?.from ?? [])]).toEqual([0, 1]);
    expect([...(ab.block(0)?.sides[1]?.to ?? [])]).toEqual([2, 2]);
    expect([...(ab.block(1)?.sides[3]?.to ?? [])]).toEqual([0, 1]);
    expect(hasSide(ab.block(0)?.outerSides[0] ?? 0, 1)).toBe(true);
    ab.removeBlock(1);
    expect(ab.block(0)?.sides[1]).toBeNull();
    expect(ab.removals).toBe(1);
    expect(ab.missingFor(0)).toEqual([1]);
  });

  it('never asks for a neighbour the manifest does not list', () => {
    const t = buildTestMap([{ ...A, tiles: [tileOf(oa.tx0, oa.tz0, [square(0, 0, 40, 40)])] }]);
    const mesh = t.full();
    // portal edges on sides 0 and 3 lead to blocks that do not exist
    expect(mesh.block(0)?.outerSides[0]).toBe(1 + 8);
    expect(mesh.missingFor(0)).toEqual([]);
    expect(mesh.mayNeedBlocks(0)).toBe(true);
  });
});

describe('NavMesh bookkeeping', () => {
  it('numbers polygons by the manifest order, refuses mismatched or repeated blocks, and counts its typed bytes', () => {
    const t = seamPair();
    const mesh = t.open();
    expect([...mesh.blockBase]).toEqual([0, 2, 3]);
    expect([...mesh.blockOf]).toEqual([0, 0, 1]);
    expect(mesh.blockIndex(28, 40)).toBe(1);
    expect(mesh.blockIndex(28, 44)).toBe(-1);
    expect(() => loadBlock(mesh, 1, t.blockBytes[0] ?? new Uint8Array())).toThrow(NavMeshError);
    loadBlock(mesh, 0, t.blockBytes[0] ?? new Uint8Array());
    expect(() => loadBlock(mesh, 0, t.blockBytes[0] ?? new Uint8Array())).toThrow(/already loaded/);
    expect(() => mesh.blockOfPoly(2)).toThrow(/not loaded/);
    expect(mesh.loadedBlocks()).toEqual([0]);
    expect(mesh.typedBytes().blocks).toBeGreaterThan(0);
    expect(componentOf(mesh, 2)).toBe(0);
    // a decoded block's origin follows the manifest grid
    const d = decodeBlock(t.blockBytes[1] ?? new Uint8Array(), mesh.P);
    expect(blockTileOrigin(mesh.P, d.row0, d.col0)).toEqual(ob);
  });

  it('refuses a map.bin that does not match the manifest', () => {
    const t = seamPair();
    const other = buildTestMap([{ ...A, tiles: [tileOf(oa.tx0, oa.tz0, [square(0, 0, 40, 40)])] }]);
    expect(() => new (t.open().constructor as new (...a: unknown[]) => unknown)(t.manifest, 1, other.facts)).toThrow(/does not match the manifest/);
    expect(() => new (t.open().constructor as new (...a: unknown[]) => unknown)(t.manifest, 7, t.facts)).toThrow(/no navigation data/);
  });
});
