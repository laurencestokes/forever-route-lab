import { recomputeComponents } from '../../src/nav/components';
import { ATTRIBUTE_MODE, BLOCK_MAGIC, BLOCK_VERSION } from '../../src/nav/format';
import { blockSpan, blockTileOrigin, TILE_YD, type NavParams } from '../../src/nav/grid';
import { parseNavManifest, type NavManifest } from '../../src/nav/manifest';
import { MAP_MAGIC, MAP_VERSION, type ConnectorLink, type MapFacts, type PassageTag } from '../../src/nav/mapfile';
import { NavMesh } from '../../src/nav/mesh';
import { loadBlock, openMap } from '../../src/nav/open';

/**
 * Synthetic navigation data for the `src/nav` tests (kept out of `src/nav`, like the seeded
 * generator below, terrain-navigation.md §9.6): an encoder for FRN3 v3 blocks and FRNM v1
 * map files (the tests' own, arithmetic only, the layouts of format.ts and mapfile.ts), a manifest
 * in the committed shape, and polygon builders in voxel coordinates on the chosen settings' grid
 * (4 Recast tiles of 256 voxels per ADT, 4×4-ADT blocks). No client bytes and no committed data.
 */

export class ByteWriter {
  private readonly out: number[] = [];

  byte(v: number): void {
    if (!Number.isInteger(v) || v < 0 || v > 255) throw new RangeError(`byte ${String(v)}`);
    this.out.push(v);
  }

  ascii(s: string): void {
    for (let i = 0; i < s.length; i += 1) this.byte(s.charCodeAt(i));
  }

  u(v: number): void {
    if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`varint ${String(v)}`);
    let x = v;
    while (x >= 128) {
      this.out.push((x % 128) + 128);
      x = Math.floor(x / 128);
    }
    this.out.push(x);
  }

  z(v: number): void {
    this.u(v >= 0 ? v * 2 : -v * 2 - 1);
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

/** The chosen settings (tools/terrain/build.json) as runtime parameters. */
export const TEST_SETTINGS = {
  voxelsPerAdt: 1024,
  tileVoxels: 256,
  blockAdts: 4,
  cellHeightYd: 0.25,
  mapOriginZ: 0,
  climbYd: 1.5,
} as const;

export type Voxel = readonly [number, number, number];

export interface TestTile {
  readonly tx: number;
  readonly tz: number;
  readonly originStep: number;
  /** x, y, z voxel triples. */
  readonly verts: readonly number[];
  readonly polys: readonly (readonly number[])[];
  readonly swim: readonly boolean[];
}

export interface TestBlock {
  readonly row0: number;
  readonly col0: number;
  readonly tiles: readonly TestTile[];
  /** Zone per polygon in tile then polygon order (default 14 everywhere). */
  readonly zones?: readonly number[];
}

/** A tile from polygons of voxel (x, y, z) vertices; equal vertices are shared, first use order. */
export function tileOf(tx: number, tz: number, polys: readonly (readonly Voxel[])[], swim: readonly boolean[] = [], originStep = 0): TestTile {
  const index = new Map<string, number>();
  const verts: number[] = [];
  const out = polys.map((vs) =>
    vs.map(([x, y, z]) => {
      const k = `${String(x)},${String(y)},${String(z)}`;
      let i = index.get(k);
      if (i === undefined) {
        i = verts.length / 3;
        index.set(k, i);
        verts.push(x, y, z);
      }
      return i;
    }),
  );
  return { tx, tz, originStep, verts, polys: out, swim: polys.map((_, i) => swim[i] === true) };
}

/** A square polygon over voxels [x0, x1] × [z0, z1] at height y, counter-clockwise in world X/Y. */
export const square = (x0: number, z0: number, x1: number, z1: number, y = 40): Voxel[] => [
  [x0, y, z0],
  [x0, y, z1],
  [x1, y, z1],
  [x1, y, z0],
];

export const polygonsOf = (b: TestBlock): number => b.tiles.reduce((s, t) => s + t.polys.length, 0);

export function encodeTestBlock(b: TestBlock, P: NavParams, mapId = 1): Uint8Array {
  const { tx0, tz0 } = blockTileOrigin(P, b.row0, b.col0);
  const span = blockSpan(P);
  const tiles = [...b.tiles].sort((x, y) => (x.tx - tx0) * span + (x.tz - tz0) - ((y.tx - tx0) * span + (y.tz - tz0)));
  if (tiles.some((t, i) => t !== b.tiles[i])) throw new RangeError('encodeTestBlock: give tiles in (tx, tz) order, the zones follow it');
  const total = polygonsOf(b);
  const zones = b.zones ?? new Array<number>(total).fill(14);
  if (zones.length !== total) throw new RangeError('encodeTestBlock: one zone per polygon');
  const w = new ByteWriter();
  w.ascii(BLOCK_MAGIC);
  w.byte(BLOCK_VERSION);
  w.u(mapId);
  w.u(b.row0);
  w.u(b.col0);
  w.z(0);
  w.u(tiles.length);
  for (const t of tiles) {
    w.u(t.tx - tx0);
    w.u(t.tz - tz0);
    w.z(t.originStep);
    w.u(t.verts.length / 3);
    w.u(t.polys.length);
    let px = 0;
    let py = 0;
    let pz = 0;
    for (let v = 0; v < t.verts.length; v += 3) {
      const x = t.verts[v] ?? 0;
      const y = t.verts[v + 1] ?? 0;
      const z = t.verts[v + 2] ?? 0;
      w.z(x - px);
      w.z(z - pz);
      w.z(y - py);
      px = x;
      py = y;
      pz = z;
    }
    let prev = 0;
    t.polys.forEach((vs, p) => {
      w.byte((vs.length - 3) * 2 + (t.swim[p] === true ? 1 : 0));
      for (const v of vs) {
        w.z(v - prev);
        prev = v;
      }
    });
  }
  w.byte(ATTRIBUTE_MODE);
  const ids = [...new Set(zones)].sort((x, y) => x - y);
  w.u(ids.length);
  for (const z of ids) w.u(z);
  let base = 0;
  for (const t of tiles) {
    const own = zones.slice(base, base + t.polys.length);
    const distinct = [...new Set(own)].sort((x, y) => x - y);
    w.u(distinct.length);
    for (const z of distinct) w.u(ids.indexOf(z));
    if (distinct.length > 1) for (const z of own) w.u(distinct.indexOf(z));
    base += t.polys.length;
  }
  return w.bytes();
}

export function encodeTestMapFile(f: MapFacts): Uint8Array {
  const w = new ByteWriter();
  w.ascii(MAP_MAGIC);
  w.byte(MAP_VERSION);
  w.u(f.mapId);
  w.u(f.blockCount);
  w.u(f.polygonCount);
  w.u(f.sizes.length);
  for (const s of f.sizes) w.u(s);
  const runs: [number, number][] = [];
  for (const c of f.comp) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last[0] === c) last[1] += 1;
    else runs.push([c, 1]);
  }
  w.u(runs.length);
  for (const [c, n] of runs) {
    w.u(c);
    w.u(n);
  }
  w.u(f.links.length);
  for (const l of f.links) {
    w.u(l.connector);
    w.u(l.from);
    w.u(l.to);
    w.u(l.costTenths);
  }
  w.u(f.passages.length);
  for (const t of f.passages) {
    w.u(t.passage);
    const r: [number, number][] = [];
    for (const id of t.polygons) {
      const last = r[r.length - 1];
      if (last !== undefined && last[0] + last[1] === id) last[1] += 1;
      else r.push([id, 1]);
    }
    w.u(r.length);
    let end = 0;
    for (const [start, n] of r) {
      w.z(start - end);
      w.u(n);
      end = start + n;
    }
  }
  return w.bytes();
}

const HEX64 = 'ab'.repeat(32);

/** A manifest JSON value in the committed shape for `blocks` of one map. */
export function testManifestJson(mapId: number, blocks: readonly { readonly row0: number; readonly col0: number; readonly polygons: number }[], ids: { readonly connectors?: readonly string[]; readonly passages?: readonly string[] } = {}): unknown {
  const cs = TILE_YD / TEST_SETTINGS.voxelsPerAdt;
  const polygons = blocks.reduce((s, b) => s + b.polygons, 0);
  return {
    schema: 1,
    kind: 'nav-manifest',
    notice: 'NOTICE.md',
    navRevision: HEX64,
    format: { block: 'FRN3 v3 (attributes mode 3)', mapFile: 'FRNM v1' },
    settings: { name: 'test', ...TEST_SETTINGS, radiusVoxels: 1, heightYd: 2, slopeDeg: 60, vertsPerPoly: 12 },
    derived: { cellYd: cs, tileYd: cs * TEST_SETTINGS.tileVoxels, perAdt: TEST_SETTINGS.voxelsPerAdt / TEST_SETTINGS.tileVoxels },
    stage2: { settings: { snap: { radiusYd: 6, ruleBMinPolygons: 20 }, longSwimWarningYd: 200 } },
    connectors: ids.connectors ?? ['test-connector'],
    passages: ids.passages ?? ['test-passage'],
    maps: [
      {
        mapId,
        name: 'Test',
        polygons,
        components: 0,
        mapFile: { path: `${String(mapId)}/map.bin`, bytes: 0, sha256: HEX64 },
        blocks: blocks.map((b) => ({ path: `${String(mapId)}/${String(b.row0)}_${String(b.col0)}.bin`, row0: b.row0, col0: b.col0, polygons: b.polygons, bytes: 0, sha256: HEX64 })),
        hintRollup: {},
      },
    ],
  };
}

export interface TestMap {
  readonly manifest: NavManifest;
  readonly mapId: number;
  /** Encoded blocks, in manifest order. */
  readonly blockBytes: readonly Uint8Array[];
  readonly mapBin: Uint8Array;
  readonly facts: MapFacts;
  /** A fresh mesh with nothing loaded. */
  open(): NavMesh;
  /** A fresh mesh with every block loaded in manifest order. */
  full(): NavMesh;
}

/**
 * Encodes `blocks` (manifest order) and a `map.bin` whose components are recomputed over the fully
 * loaded mesh with the given connector links and passage tags, as stage 2 would.
 */
export function buildTestMap(blocks: readonly TestBlock[], extra: { readonly links?: readonly ConnectorLink[]; readonly passages?: readonly PassageTag[]; readonly mapId?: number } = {}): TestMap {
  const mapId = extra.mapId ?? 1;
  const manifest = parseNavManifest(testManifestJson(mapId, blocks.map((b) => ({ row0: b.row0, col0: b.col0, polygons: polygonsOf(b) }))));
  const P = manifest.params;
  const blockBytes = blocks.map((b) => encodeTestBlock(b, P, mapId));
  const n = blocks.reduce((s, b) => s + polygonsOf(b), 0);
  const draft: MapFacts = { mapId, blockCount: blocks.length, polygonCount: n, sizes: Int32Array.of(n), comp: new Int32Array(n), links: extra.links ?? [], passages: extra.passages ?? [] };
  const probe = new NavMesh(manifest, mapId, draft);
  blockBytes.forEach((bytes, i) => loadBlock(probe, i, bytes));
  const labels = recomputeComponents(probe);
  const facts: MapFacts = { ...draft, sizes: labels.sizes, comp: labels.comp };
  const mapBin = encodeTestMapFile(facts);
  const open = (): NavMesh => openMap(manifest, mapId, mapBin);
  return {
    manifest,
    mapId,
    blockBytes,
    mapBin,
    facts,
    open,
    full: () => {
      const mesh = open();
      blockBytes.forEach((bytes, i) => loadBlock(mesh, i, bytes));
      return mesh;
    },
  };
}

/** World X and Y of voxel (vx, vz) in tile (tx, tz), for placing endpoints. */
export const worldOf = (P: NavParams, tx: number, tz: number, vx: number, vz: number): { readonly x: number; readonly y: number } => ({
  x: -(32 * TILE_YD) + tx * P.tileYd + vx * P.cs,
  y: 32 * TILE_YD - tz * P.tileYd - vz * P.cs,
});

/** A deterministic generator for the tests (a Park-Miller LCG, arithmetic only; never in src/nav proper). */
export function seeded(seed: number): () => number {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => {
    s = (s * 48271) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** A seeded shuffle of `items` (Fisher-Yates). */
export function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const t = out[i] as T;
    out[i] = out[j] as T;
    out[j] = t;
  }
  return out;
}
