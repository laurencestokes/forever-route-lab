import { createHash } from 'node:crypto';
import { recomputeComponents } from '../../src/nav/components';
import { ATTRIBUTE_MODE, BLOCK_MAGIC, BLOCK_VERSION } from '../../src/nav/format';
import { blockSpan, blockTileOrigin, quantise, TILE_YD, type NavParams } from '../../src/nav/grid';
import { legsFrom, type LegEndpoint, type SearchScratch } from '../../src/nav/legs';
import { parseNavManifest, type NavManifest } from '../../src/nav/manifest';
import { MAP_MAGIC, MAP_VERSION, type ConnectorLink, type MapFacts, type PassageTag } from '../../src/nav/mapfile';
import { NavMesh } from '../../src/nav/mesh';
import { loadBlock, openMap } from '../../src/nav/open';
import { snap } from '../../src/nav/snap';
import type { NavWorkerPort } from '../../src/nav/worker/client';
import { createNavWorkerHost, type NavWorkerHost, type NavWorkerHostDeps } from '../../src/nav/worker/host';
import type { NavLegQuery, NavLegResult, NavRequest, NavResponse } from '../../src/nav/worker/protocol';

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

// ---------------------------------------------------------------------------------------------
// Worker fixtures (step 3b.6): a multi-block world and a deployable, signed site of test maps.

/** The four blocks of `gridWorld`: 2 × 2, so block 0 and block 3 meet only at a corner. */
export const GRID_BLOCKS: readonly { readonly row0: number; readonly col0: number }[] = [
  { row0: 28, col0: 36 },
  { row0: 28, col0: 40 },
  { row0: 32, col0: 36 },
  { row0: 32, col0: 40 },
];

export interface GridWorld {
  readonly blocks: readonly TestBlock[];
  /** Global id of each block's first polygon. */
  readonly polygonsBefore: readonly number[];
}

/**
 * 2 × 2 blocks of 16 × 16 tiles (the world of `src/nav/load-order.test.ts`): each tile four
 * squares at one of three heights (steps of at most 2 yd link), with holes, 15-yd cliffs (no
 * link), swim tiles, a small second floor 20 yd up in some tiles, and zones 14, 17 and 215.
 */
export function gridWorld(P: NavParams): GridWorld {
  const blocks: TestBlock[] = [];
  const polygonsBefore: number[] = [];
  let total = 0;
  for (const b of GRID_BLOCKS) {
    const { tx0, tz0 } = blockTileOrigin(P, b.row0, b.col0);
    const tiles: TestTile[] = [];
    const zones: number[] = [];
    for (let dtx = 0; dtx < 16; dtx += 1) {
      for (let dtz = 0; dtz < 16; dtz += 1) {
        const tx = tx0 + dtx;
        const tz = tz0 + dtz;
        const h = (tx * 73 + tz * 151) % 97;
        if (h % 11 === 0) continue;
        const y = 40 + 4 * (h % 3) + (h % 13 === 0 ? 60 : 0);
        const polys: Voxel[][] = [square(0, 0, 128, 128, y), square(128, 0, 256, 128, y), square(0, 128, 128, 256, y), square(128, 128, 256, 256, y)];
        const swimTile = h % 7 === 0;
        const swim = [swimTile, swimTile, swimTile, swimTile];
        if (h % 17 === 0) {
          polys.push(square(32, 32, 96, 96, y + 80));
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

/** File bytes as a `Response` body needs them. */
export type SiteBytes = Uint8Array<ArrayBuffer>;

export interface SignedNavSite {
  /** The manifest JSON with real sizes, SHA-256s and navRevision. */
  readonly manifestJson: Record<string, unknown>;
  readonly manifest: NavManifest;
  /** Every file under the base URL: `nav/manifest.json`, `nav/<mapId>/map.bin` and the blocks. */
  readonly files: Map<string, SiteBytes>;
}

const sha256Of = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/**
 * A deployable navigation site of test maps (one map each, distinct map ids): the committed
 * layout under `nav/`, a manifest whose file sizes and SHA-256s are real and whose navRevision is
 * the build's (SHA-256 over the sorted `path sha256` lines).
 */
export function signedNavSite(maps: readonly TestMap[], ids: { readonly connectors?: readonly string[]; readonly passages?: readonly string[] } = {}): SignedNavSite {
  const files = new Map<string, SiteBytes>();
  const entries: Record<string, unknown>[] = [];
  const lines: string[] = [];
  for (const map of maps) {
    const entry = map.manifest.maps.find((m) => m.mapId === map.mapId);
    if (entry === undefined) throw new RangeError(`signedNavSite: map ${String(map.mapId)} is not in its own manifest`);
    const file = (path: string, bytes: Uint8Array): { path: string; bytes: number; sha256: string } => {
      files.set(`nav/${path}`, Uint8Array.from(bytes));
      const sha256 = sha256Of(bytes);
      lines.push(`${path} ${sha256}\n`);
      return { path, bytes: bytes.byteLength, sha256 };
    };
    entries.push({
      mapId: map.mapId,
      name: entry.name,
      polygons: entry.polygons,
      components: map.facts.sizes.length,
      mapFile: file(entry.mapFile.path, map.mapBin),
      blocks: entry.blocks.map((b, i) => ({ ...file(b.path, map.blockBytes[i] ?? new Uint8Array()), row0: b.row0, col0: b.col0, polygons: b.polygons })),
      hintRollup: {},
    });
  }
  const base = testManifestJson(maps[0]?.mapId ?? 1, [], ids) as Record<string, unknown>;
  const manifestJson = { ...base, navRevision: sha256Of(lines.sort().join('')), maps: entries };
  files.set('nav/manifest.json', Uint8Array.from(new TextEncoder().encode(JSON.stringify(manifestJson))));
  return { manifestJson, manifest: parseNavManifest(manifestJson), files };
}

/**
 * The worker's answer for one query, computed directly on a fully loaded mesh: both endpoints
 * quantised and snapped (rules A and B), one single-target `legsFrom`. The worker runs one search
 * per source over all its targets; a settled polygon's parent never changes, so the legs agree.
 */
export function referenceLegResult(full: NavMesh, scratch: SearchScratch, q: NavLegQuery, withPath = false): NavLegResult & { readonly path?: readonly number[] } {
  const end = (p: NavLegQuery['from']): { readonly e: LegEndpoint; readonly ambiguous: boolean } => {
    const x = quantise(p.x);
    const y = quantise(p.y);
    const s = snap(full, x, y, p.hint);
    return { e: { x, y, poly: s.poly }, ambiguous: s.flags.ambiguous };
  };
  const a = end(q.from);
  const b = end(q.to);
  const [leg] = legsFrom(full, scratch, a.e, [b.e], withPath ? { withPath: true } : {});
  if (leg === undefined) throw new Error('referenceLegResult: no leg');
  return {
    reachable: leg.reachable,
    reason: leg.reason,
    groundTenths: leg.groundTenths,
    swimTenths: leg.swimTenths,
    connectorTenthsSeconds: leg.connectorTenthsSeconds,
    longestSwimYd: leg.longestSwimYd,
    flags: leg.flags,
    passages: leg.passages.map((i) => full.passageIds[i] ?? ''),
    from: { snapped: a.e.poly >= 0, ambiguous: a.ambiguous },
    to: { snapped: b.e.poly >= 0, ambiguous: b.ambiguous },
    ...(withPath && leg.path !== undefined ? { path: leg.path } : {}),
  };
}

/** A seeded endpoint in the grid world: in block `block` (0-3), or anywhere (−1), a third of them near the row seam. */
export function gridEndpoint(P: NavParams, next: () => number, block = -1): { readonly x: number; readonly y: number; readonly hint: number } {
  const { tx0, tz0 } = blockTileOrigin(P, 32, 36);
  const hints = [0, 14, 17, 215];
  let vx: number;
  let vz: number;
  if (block >= 0) {
    vx = (block < 2 ? 16 : 0) * 256 + next() * 16 * 256;
    vz = (block % 2 === 1 ? 16 : 0) * 256 + next() * 16 * 256;
  } else {
    vx = next() < 0.33 ? 16 * 256 + (next() - 0.5) * 30 : next() * 32 * 256;
    vz = next() * 32 * 256;
  }
  const p = worldOf(P, tx0, tz0, vx, vz);
  // not quantised: the worker must quantise
  return { x: p.x, y: p.y, hint: hints[Math.floor(next() * 4)] ?? 0 };
}

/** A navigation worker host behind a `NavWorkerPort`, in-process: messages are structured-cloned and delivered on later tasks, as between threads. */
export interface InProcessNavWorker {
  readonly port: NavWorkerPort;
  readonly host: NavWorkerHost;
  /** Every request the client sent. */
  readonly sent: NavRequest[];
  readonly terminated: () => boolean;
  /** Simulates the worker script failing. */
  crash(message: string): void;
}

export function inProcessNavWorker(deps: Omit<NavWorkerHostDeps, 'post'>): InProcessNavWorker {
  let onMessage: ((message: NavResponse) => void) | null = null;
  let onError: ((message: string) => void) | null = null;
  let terminated = false;
  const sent: NavRequest[] = [];
  const host = createNavWorkerHost({
    ...deps,
    post: (message) => {
      const copy = structuredClone(message);
      setTimeout(() => onMessage?.(copy), 0);
    },
  });
  const port: NavWorkerPort = {
    postMessage(message) {
      sent.push(message);
      const copy = structuredClone(message);
      setTimeout(() => {
        host.handle(copy);
      }, 0);
    },
    listen(message, error) {
      onMessage = message;
      onError = error;
    },
    terminate() {
      terminated = true;
    },
  };
  return { port, host, sent, terminated: () => terminated, crash: (m) => onError?.(m) };
}
