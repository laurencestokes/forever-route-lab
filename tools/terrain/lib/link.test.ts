import { describe, expect, it } from 'vitest';
import { components } from './components';
import { buildMapMesh, containsXY, distToPoly, EDGE_CONNECTOR, EDGE_CROSS_BLOCK, EDGE_CROSS_TILE, EDGE_INTERNAL, linkSymmetry, recastAdjacency, unmatchedPct } from './link';
import { decodeMapFile, encodeMapFile, idRuns, runs } from './mapfile';
import { blockOf, firstTile, PARAMS, square, tileOf } from './nav-test-support';

const edgesOf = (g: ReturnType<typeof buildMapMesh>, p: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let k = g.eFirst[p] ?? 0; k < (g.eFirst[p + 1] ?? 0); k += 1) out.push([g.eTo[k] ?? -1, g.eKind[k] ?? -1]);
  return out;
};

describe('recastAdjacency (terrain-navigation.md §5 "Derived, not stored")', () => {
  it('pairs a shared edge given in opposite orders', () => {
    const nei = recastAdjacency(
      [
        [0, 1, 2],
        [2, 1, 3],
      ],
      4,
    );
    expect([...(nei[0] ?? [])]).toEqual([-1, 1, -1]);
    expect([...(nei[1] ?? [])]).toEqual([0, -1, -1]);
  });

  it('pairs each reverse edge with the first unmatched forward edge when three polygons share an edge', () => {
    // polygons 0 and 1 both have the forward edge 1→2; polygon 2 has the reverse 2→1 and takes polygon 1's,
    // because forward edges are listed most recent first (Recast's buildMeshAdjacency)
    const nei = recastAdjacency(
      [
        [0, 1, 2],
        [3, 1, 2],
        [2, 1, 4],
      ],
      5,
    );
    expect(nei[2]?.[0]).toBe(1);
    expect(nei[1]?.[1]).toBe(2);
    expect(nei[0]?.[1]).toBe(-1);
  });
});

describe('buildMapMesh: internal edges, the slab relinker and connectors (§6.1)', () => {
  const { tx0, tz0 } = firstTile(28, 36);
  it('links two tiles across their shared side, in both directions, with the overlap as the portal', () => {
    const left = tileOf(tx0, tz0, [square(236, 0, 256, 20), square(216, 0, 236, 20)]);
    const right = tileOf(tx0 + 1, tz0, [square(0, 10, 20, 30)]);
    const g = buildMapMesh([blockOf(28, 36, [left, right])], PARAMS);
    expect(g.n).toBe(3);
    expect(edgesOf(g, 0)).toEqual([
      [1, EDGE_INTERNAL],
      [2, EDGE_CROSS_TILE],
    ]);
    expect(edgesOf(g, 2)).toEqual([[0, EDGE_CROSS_TILE]]);
    const k = (g.eFirst[0] ?? 0) + 1;
    // the portal is the overlap z 10..20 voxels on x = 256 of the left tile
    const x = -17066.666666666668 + (tx0 + 1) * PARAMS.tileYd;
    expect(g.eAx[k]).toBeCloseTo(x, 6);
    expect(g.eBx[k]).toBeCloseTo(x, 6);
    expect(Math.abs((g.eAy[k] ?? 0) - (g.eBy[k] ?? 0))).toBeCloseTo(10 * PARAMS.cs, 6);
    expect(linkSymmetry(g)).toEqual({ internal: 2, internalWithoutReverse: 0, crossTile: 2, crossTileWithoutReverse: 0 });
    expect(unmatchedPct(g.seams.inner)).toBeGreaterThan(0);
  });

  it('does not link edges more than 2 × walkableClimb apart vertically, and marks block seams', () => {
    const low = tileOf(tx0, tz0, [square(236, 0, 256, 20, 40)]);
    const high = tileOf(tx0 + 1, tz0, [square(0, 0, 20, 20, 40 + 13)]); // 3.25 yd higher
    expect(linkSymmetry(buildMapMesh([blockOf(28, 36, [low, high])], PARAMS)).crossTile).toBe(0);
    const ok = tileOf(tx0 + 1, tz0, [square(0, 0, 20, 20, 40 + 12)]); // 3.0 yd: linked
    expect(linkSymmetry(buildMapMesh([blockOf(28, 36, [low, ok])], PARAMS)).crossTile).toBe(2);
    // the tile north of the block's first row is in block 24_36: a cross-block link
    const other = firstTile(24, 36);
    const edge = tileOf(tx0 + 15, tz0, [square(236, 0, 256, 20)]);
    const next = tileOf(other.tx0, other.tz0, [square(0, 0, 20, 20)]);
    const g = buildMapMesh([blockOf(24, 36, [next]), blockOf(28, 36, [edge])], PARAMS);
    expect(edgesOf(g, 1)).toEqual([[0, EDGE_CROSS_BLOCK]]);
    expect(g.seams.block.len).toBeGreaterThan(0);
    expect(g.blockBase[1]).toBe(1);
  });

  it('adds directed connector links with their cost', () => {
    const t = tileOf(tx0, tz0, [square(0, 0, 10, 10), square(100, 100, 110, 110, 80)]);
    const g = buildMapMesh([blockOf(28, 36, [t])], PARAMS, [{ connector: 3, from: 0, to: 1, costTenths: 250 }]);
    expect(edgesOf(g, 0)).toEqual([[1, EDGE_CONNECTOR]]);
    expect(edgesOf(g, 1)).toEqual([]);
    expect(g.eLink[g.eFirst[0] ?? 0]).toBe(3);
    expect(g.eCost[g.eFirst[0] ?? 0]).toBe(250);
    const c = components(g);
    expect(c.sizes).toEqual([2]);
    expect(() => buildMapMesh([blockOf(28, 36, [t])], PARAMS, [{ connector: 0, from: 0, to: 9, costTenths: 1 }])).toThrow(/outside/);
  });

  it('computes containment and 2D distance in world yards', () => {
    const g = buildMapMesh([blockOf(28, 36, [tileOf(tx0, tz0, [square(0, 0, 10, 10)])])], PARAMS);
    const cx = g.cx[0] ?? 0;
    const cy = g.cy[0] ?? 0;
    expect(containsXY(g, 0, cx, cy)).toBe(true);
    expect(distToPoly(g, 0, cx, cy)).toBe(0);
    expect(distToPoly(g, 0, cx + 5 * PARAMS.cs + 3, cy)).toBeCloseTo(3, 6);
  });
});

describe('components (§7.1)', () => {
  const { tx0, tz0 } = firstTile(28, 36);
  it('orders components by size, then lowest polygon id, main = 0', () => {
    const t = tileOf(tx0, tz0, [square(200, 200, 210, 210), square(0, 0, 10, 10), square(10, 0, 20, 10), square(100, 100, 110, 110), square(110, 100, 120, 110)]);
    const c = components(buildMapMesh([blockOf(28, 36, [t])], PARAMS));
    expect(c.sizes).toEqual([2, 2, 1]);
    expect([...c.comp]).toEqual([2, 0, 0, 1, 1]);
  });

  it('can leave polygons out (the water rule) and cut edges', () => {
    const t = tileOf(tx0, tz0, [square(0, 0, 10, 10), square(10, 0, 20, 10), square(20, 0, 30, 10)]);
    const g = buildMapMesh([blockOf(28, 36, [t])], PARAMS);
    const kept = components(g, undefined, (p) => p !== 1);
    expect([...kept.comp]).toEqual([0, -1, 1]);
    expect(components(g, (_k, p, q) => !(p === 0 && q === 1) && !(p === 1 && q === 0)).sizes).toEqual([2, 1]);
  });
});

describe('map.bin (RC-03)', () => {
  it('round-trips components, connector links and passage tags', () => {
    const m = { mapId: 1, blockCount: 2, polygonCount: 7, sizes: [4, 2, 1], comp: Int32Array.from([0, 0, 1, 1, 0, 0, 2]), links: [{ connector: 1, from: 0, to: 6, costTenths: 305 }], passages: [{ passage: 0, polygons: [1, 2, 3, 6] }] };
    const bytes = encodeMapFile(m);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('FRNM\u0001');
    const back = decodeMapFile(bytes);
    expect([...back.comp]).toEqual([...m.comp]);
    expect(back.sizes).toEqual(m.sizes);
    expect(back.links).toEqual(m.links);
    expect(back.passages).toEqual(m.passages);
  });

  it('refuses sizes that disagree with the runs, unordered sizes and truncation', () => {
    const good = encodeMapFile({ mapId: 0, blockCount: 1, polygonCount: 3, sizes: [2, 1], comp: Int32Array.from([0, 1, 0]), links: [], passages: [] });
    expect(() => decodeMapFile(good.subarray(0, good.length - 1))).toThrow();
    const bad = encodeMapFile({ mapId: 0, blockCount: 1, polygonCount: 3, sizes: [2, 1], comp: Int32Array.from([0, 1, 1]), links: [], passages: [] });
    expect(() => decodeMapFile(bad)).toThrow(/component 0 has 1 polygons/);
    expect(() => decodeMapFile(encodeMapFile({ mapId: 0, blockCount: 1, polygonCount: 3, sizes: [1, 2], comp: Int32Array.from([0, 1, 1]), links: [], passages: [] }))).toThrow(/ordered/);
  });

  it('builds runs of equal values and of consecutive ids', () => {
    expect(runs([0, 0, 1, 1, 1, 0])).toEqual([
      [0, 2],
      [1, 3],
      [0, 1],
    ]);
    expect(idRuns([1, 2, 3, 7, 9, 10])).toEqual([
      [1, 3],
      [7, 1],
      [9, 2],
    ]);
  });
});
