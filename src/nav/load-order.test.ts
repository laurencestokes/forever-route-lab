import { describe, expect, it } from 'vitest';
import { buildTestMap, square, testManifestJson, tileOf, worldOf, type TestBlock, type TestTile, type Voxel } from '../../tests/support/nav-mesh';
import { recomputeComponents } from './components';
import { blockTileOrigin, quantise } from './grid';
import { legsFrom, SearchScratch, type LegEndpoint } from './legs';
import { parseNavManifest } from './manifest';
import { loadBlock } from './open';
import { snap, snapMissing } from './snap';

/**
 * RC-06 (terrain-navigation.md §9.6): snaps and legs under random block load orders equal those of
 * the fully loaded mesh. The mesh: 2 × 2 blocks of 16 × 16 tiles, each tile four squares at one of
 * three heights (a step of at most 2 yd links), with holes, cliffs (no link), swim tiles, a second
 * floor in some tiles, several zones, a one-way connector between the two diagonal blocks and a
 * tagged passage. The seeded generator lives here, never in `src/nav`.
 */

const BLOCKS = [
  { row0: 28, col0: 36 },
  { row0: 28, col0: 40 },
  { row0: 32, col0: 36 },
  { row0: 32, col0: 40 },
] as const;
const P = parseNavManifest(testManifestJson(1, [{ ...BLOCKS[0], polygons: 1 }])).params;

/** A Park-Miller generator (arithmetic only). */
function seeded(seed: number): () => number {
  let s = (seed % 2147483646) + 1;
  return () => {
    s = (s * 48271) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const t = out[i] as T;
    out[i] = out[j] as T;
    out[j] = t;
  }
  return out;
}

function world(): { blocks: TestBlock[]; polygonsBefore: number[] } {
  const blocks: TestBlock[] = [];
  const polygonsBefore: number[] = [];
  let total = 0;
  for (const b of BLOCKS) {
    const { tx0, tz0 } = blockTileOrigin(P, b.row0, b.col0);
    const tiles: TestTile[] = [];
    const zones: number[] = [];
    for (let dtx = 0; dtx < 16; dtx += 1) {
      for (let dtz = 0; dtz < 16; dtz += 1) {
        const tx = tx0 + dtx;
        const tz = tz0 + dtz;
        const h = (tx * 73 + tz * 151) % 97;
        if (h % 11 === 0) continue; // a hole
        const y = 40 + 4 * (h % 3) + (h % 13 === 0 ? 60 : 0); // up to 2 yd steps; a 15-yd cliff now and then
        const polys: Voxel[][] = [square(0, 0, 128, 128, y), square(128, 0, 256, 128, y), square(0, 128, 128, 256, y), square(128, 128, 256, 256, y)];
        const swimTile = h % 7 === 0;
        const swim = [swimTile, swimTile, swimTile, swimTile];
        if (h % 17 === 0) {
          polys.push(square(32, 32, 96, 96, y + 80)); // a small floor 20 yd up
          swim.push(false);
        }
        tiles.push(tileOf(tx, tz, polys, swim));
        const zone = h % 19 === 0 ? 215 : b.row0 === 28 ? 14 : 17;
        for (let i = 0; i < polys.length; i += 1) zones.push(zone);
      }
    }
    blocks.push({ ...b, tiles, zones });
    polygonsBefore.push(total);
    total += zones.length;
  }
  return { blocks, polygonsBefore };
}

const { blocks, polygonsBefore } = world();
// a one-way connector from block 0 to block 3 (diagonal: never linked by a seam), and a passage in block 1
const from = (polygonsBefore[0] ?? 0) + 40;
const to = (polygonsBefore[3] ?? 0) + 900;
const T = buildTestMap(blocks, {
  links: [{ connector: 0, from, to, costTenths: 300 }],
  passages: [{ passage: 0, polygons: Array.from({ length: 30 }, (_, i) => (polygonsBefore[1] ?? 0) + 200 + i) }],
});

describe('random block load orders (RC-06, G12)', () => {
  const full = T.full();
  const fullScratch = new SearchScratch(full);

  it('builds a mesh worth testing: seams, cliffs, swim, floors, a connector and a passage', () => {
    expect(full.n).toBeGreaterThan(3500);
    expect(full.sizes.length).toBeGreaterThan(5);
    expect(recomputeComponents(full).sizes).toEqual(full.sizes);
    const seams = [0, 1, 2, 3].map((b) => full.block(b)?.sides.filter((s) => s !== null).length);
    expect(seams).toEqual([2, 2, 2, 2]);
    expect([...full.swim].some((s) => s === 1)).toBe(true);
    expect(full.comp[from]).toBe(full.comp[to]);
  });

  /** A random endpoint in block `b` (0-3) or anywhere (−1), a third of them within 8 yd of the row seam. */
  const endpoint = (next: () => number, b = -1): { x: number; y: number; hint: number } => {
    const { tx0, tz0 } = blockTileOrigin(P, 32, 36);
    const hints = [0, 14, 17, 215];
    let vx: number;
    let vz: number;
    if (b >= 0) {
      vx = (b < 2 ? 16 : 0) * 256 + next() * 16 * 256;
      vz = (b % 2 === 1 ? 16 : 0) * 256 + next() * 16 * 256;
    } else {
      vx = next() < 0.33 ? 16 * 256 + (next() - 0.5) * 30 : next() * 32 * 256;
      vz = next() * 32 * 256;
    }
    const p = worldOf(P, tx0, tz0, vx, vz);
    return { x: quantise(p.x), y: quantise(p.y), hint: hints[Math.floor(next() * 4)] ?? 0 };
  };

  let searchLoads = 0;
  let crossBlockLegs = 0;

  for (const seed of [1, 7, 42, 1234, 99991, 314159]) {
    it(`seed ${String(seed)}: every snap and leg equals the fully loaded mesh`, () => {
      const next = seeded(seed);
      const mesh = T.open();
      const S = new SearchScratch(mesh);
      const loader = (need: readonly number[]): void => {
        // the needed blocks in a random order, sometimes with an extra one
        const extra = [0, 1, 2, 3].filter((b) => !mesh.isLoaded(b) && !need.includes(b));
        for (const b of shuffled([...need, ...(next() < 0.3 ? extra.slice(0, 1) : [])], next)) {
          loadBlock(mesh, b, T.blockBytes[b] ?? new Uint8Array());
          searchLoads += 1;
        }
      };
      for (let query = 0; query < 12; query += 1) {
        // unload at random between queries (never during one: a running query pins its blocks)
        for (const b of mesh.loadedBlocks()) if (next() < 0.6) mesh.removeBlock(b);
        // every third query runs from block 0 to block 3, so the search must load block 1 or 2
        const diagonal = query % 3 === 0;
        const pts = [endpoint(next, diagonal ? 0 : -1), ...Array.from({ length: 3 }, () => endpoint(next, diagonal ? 3 : -1))];
        const lazy: LegEndpoint[] = [];
        const eager: LegEndpoint[] = [];
        for (const e of pts) {
          for (const b of shuffled(snapMissing(mesh, e.x, e.y), next)) loadBlock(mesh, b, T.blockBytes[b] ?? new Uint8Array());
          const a = snap(mesh, e.x, e.y, e.hint);
          expect(a).toEqual(snap(full, e.x, e.y, e.hint));
          lazy.push({ x: e.x, y: e.y, poly: a.poly });
          eager.push({ x: e.x, y: e.y, poly: a.poly });
        }
        const [src, ...targets] = lazy;
        const [srcFull, ...targetsFull] = eager;
        if (src === undefined || srcFull === undefined) continue;
        const got = legsFrom(mesh, S, src, targets, { withPath: true, with3d: true }, loader);
        expect(got).toEqual(legsFrom(full, fullScratch, srcFull, targetsFull, { withPath: true, with3d: true }));
        if (diagonal) crossBlockLegs += got.filter((l) => l.reachable).length;
      }
    });
  }

  it('the searches above loaded blocks themselves and reached across blocks', () => {
    expect(searchLoads).toBeGreaterThan(10);
    expect(crossBlockLegs).toBeGreaterThan(10);
  });

  it('the connector leg is found from a lazily loaded block 0 and waits for block 3', () => {
    const mesh = T.open();
    loadBlock(mesh, 0, T.blockBytes[0] ?? new Uint8Array());
    const S = new SearchScratch(mesh);
    const src = { x: full.cx[from] ?? 0, y: full.cy[from] ?? 0, poly: from };
    const dst = { x: full.cx[to] ?? 0, y: full.cy[to] ?? 0, poly: to };
    const requested: number[][] = [];
    const legs = legsFrom(mesh, S, src, [dst], {}, (need) => {
      requested.push([...need]);
      for (const b of need) loadBlock(mesh, b, T.blockBytes[b] ?? new Uint8Array());
    });
    expect(legs).toEqual(legsFrom(full, fullScratch, src, [dst]));
    expect(requested.flat()).toContain(3);
    expect(legs[0]?.reachable).toBe(true);
  });
});
