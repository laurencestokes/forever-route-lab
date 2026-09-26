/**
 * Steps 3b.3 and 3b.4 against the local Forever client (terrain-navigation.md §16): the stage-1
 * build of one block (determinism, its input hash, the golden bytes), the derived adjacency
 * against rcPolyMesh (G5b) and partition invariance on a small region (G4). The full-map G4 and
 * the Detour check (G10, G10b) run in `pnpm nav:validate --client --partition`. Read-only; without
 * the pinned client at WOW_INSTALL it prints a SKIPPED banner and passes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LocalCasc } from '../casc/casc';
import { announceSkip, pinnedClientStatus } from '../casc/test-support';
import { cascSource, openClient, readMapWdt, readTables } from './lib/client';
import { adjacencyCheck } from './lib/detour-check';
import { decodeBlock } from './lib/encode';
import type { NavManifest } from './lib/manifest';
import { comparePartitions } from './lib/partition';
import { ensureRecast, type RecastTile } from './lib/recast';
import { derive, readBuildConfig, REPO_ROOT } from './lib/settings';
import { buildStage1Block, gridOf, stage1Inputs, type Stage1Inputs } from './lib/stage1';
import { sha256 } from './lib/manifest';

const status = pinnedClientStatus();

it('finds the pinned client, or says loudly why the navigation build client tests are skipped', () => {
  if (!status.available) announceSkip('tools/terrain navigation build on the client (nav.client.test.ts)', status.reason);
  expect(status.available || status.reason.length > 0).toBe(true);
});

describe.skipIf(!status.available)('the navigation build on the pinned Forever client', () => {
  const config = readBuildConfig();
  const d = derive(config.settings);
  let casc: LocalCasc;
  let inp: Stage1Inputs;

  beforeAll(async () => {
    casc = openClient(config, { ...process.env, WOW_INSTALL: status.available ? status.install : '' });
    const tables = readTables(casc);
    const w = readMapWdt(tables, 1, 782779);
    inp = stage1Inputs(casc, tables, 1, w.wdt, w.present, d, w.input, cascSource(casc));
    await ensureRecast();
  }, 60_000);

  afterAll(() => {
    casc.close();
  });

  it('builds Kalimdor block 28_36 byte-identically twice, with the input hash the manifest records (G3)', () => {
    const tiles: RecastTile[] = [];
    const a = buildStage1Block(inp, 28, 36, { keepRecastTiles: tiles });
    const b = buildStage1Block(inp, 28, 36);
    expect(a.bytes?.equals(b.bytes ?? Buffer.alloc(0))).toBe(true);
    expect(a.stats.triangles).toBe(1_327_993);
    expect(a.stats.polygonsKept).toBe(14_511);
    expect(a.inputs).toHaveLength(1_427); // the 1,422 geometry inputs, the WDT and four DB2 tables
    expect(sha256(a.bytes ?? Buffer.alloc(0))).toBe('dadfeed03b51ae1e649e46d80a41852dc8a0b98008e662d9df930cca47a58946');
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'public', 'nav', 'manifest.json'), 'utf8')) as NavManifest;
    const entry = manifest.maps.find((m) => m.mapId === 1)?.blocks.find((x) => x.row0 === 28 && x.col0 === 36);
    expect(entry?.inputHash).toBe(a.inputHash);
    // G5b: the derived internal adjacency and portals are rcPolyMesh's own
    const adj = adjacencyCheck(tiles, config.settings.tileVoxels);
    expect(adj.tiles).toBe(256);
    expect(adj.internalAgree).toBe(adj.internalRecast);
    expect(adj.portalsAgree).toBe(adj.portalsRecast);
    expect(adj.portalsDerived).toBe(adj.portalsRecast);
  }, 120_000);

  it('gives identical Recast tiles in a 2×2 block and a 1×1 block (partition invariance, G4)', () => {
    const grid = gridOf(d);
    const two = buildStage1Block(inp, 28, 36, { blockAdts: 2 });
    const one = buildStage1Block(inp, 29, 37, { blockAdts: 1 });
    const a = decodeBlock(two.bytes ?? Buffer.alloc(0), { ...grid, blockAdts: 2 });
    const b = decodeBlock(one.bytes ?? Buffer.alloc(0), { ...grid, blockAdts: 1 });
    const inB = new Set(b.tiles.map((t) => `${String(t.tx)},${String(t.tz)}`));
    // the 2×2 block's tiles of ADT (29, 37), with their zones, against the 1×1 block of that ADT
    const subset = { ...a, tiles: a.tiles.filter((t) => inB.has(`${String(t.tx)},${String(t.tz)}`)), zones: zonesOf(a, inB) };
    const r = comparePartitions([subset], [b], d.ch);
    expect(r.tilesA).toBe(16);
    expect(r.identical).toBe(16);
    expect(r.different).toEqual([]);
    expect(r.zonesDifferent).toBe(0);
  }, 120_000);
});

/** The zones of the tiles of `blk` whose key is in `keep`, in order. */
function zonesOf(blk: ReturnType<typeof decodeBlock>, keep: ReadonlySet<string>): Int32Array {
  const out: number[] = [];
  let base = 0;
  for (const t of blk.tiles) {
    if (keep.has(`${String(t.tx)},${String(t.tz)}`)) for (let p = 0; p < t.polys.length; p += 1) out.push(blk.zones[base + p] ?? 0);
    base += t.polys.length;
  }
  return Int32Array.from(out);
}
