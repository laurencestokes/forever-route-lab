/**
 * Steps MM.2-MM.4 against the local Forever client (docs/research/map-atlas.md §18, §19.5, §25):
 *
 * - MAID discovery finds the recorded tiles (988, 736, 72), and the liquid grids equal the committed
 *   reliefs' water class;
 * - the whole minimap build, rebuilt in memory, equals `public/maps/minimap/` byte for byte, which an
 *   earlier, separate run of `tools/maps/minimap.ts` wrote: a double build (tiles, index, NOTICE; the
 *   manifest and pointer apart from the tool's tree hash, which any later edit of the tool changes);
 * - its census is within ±10 % of the signed-off build's (§19.5, `b5`) and passes every gate.
 *
 * It needs the pinned build at WOW_INSTALL and the tiles under `public/maps/minimap/t/` (built by the
 * tool, or fetched from the pack), and skips with a banner otherwise. The rebuild takes about five
 * minutes and 3 GB of memory, so it is opt-in (review finding MD-07): it runs only with
 * `FRL_MINIMAP_REBUILD=1`. It is not the gate: `pnpm tsx tools/maps/minimap.ts --check --pack` compares
 * every byte, the tool tree hash and the pack's SHA-256 included (§23.4), and `pnpm maps:validate`
 * compares the manifest's tool tree hash with the checkout. Read-only; nothing is written.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../build/lib/fs';
import { LocalCasc } from '../casc/casc';
import { announceSkip, FOREVER_TEST_PIN, pinnedClientStatus } from '../casc/test-support';
import { toolTreeHash } from '../terrain/lib/tool-tree';
import { DEFAULT_WEBP, encoderIdentity } from './lib/encode';
import { buildMinimap, type MinimapBuild } from './lib/minimap-build';
import type { NativeCensus, SeamLevelCensus } from './lib/minimap-census';
import { decodeMinimapTexture } from './lib/minimap-decode';
import { readChecked, readClientMinimapTables, readCommittedMinimapInputs } from './lib/minimap-inputs';
import { buildLiquidGrid, reliefEquality } from './lib/minimap-liquid';
import { MINIMAP_DIR, MINIMAP_TOOL_ENTRY, RECORDED_TILE_COUNTS } from './lib/minimap-params';

const status = pinnedClientStatus();
const dir = join(REPO_ROOT, MINIMAP_DIR);
const built = existsSync(join(dir, 'manifest.json')) && existsSync(join(dir, 't')) && readdirSync(join(dir, 't')).length > 0;
const NAME = 'tools/maps minimap on the client (minimap.client.test.ts)';
/** The whole rebuild runs only when asked (MD-07): `FRL_MINIMAP_REBUILD=1 pnpm test tools/maps/minimap.client.test.ts`. */
const rebuild = process.env['FRL_MINIMAP_REBUILD'] === '1';

it('finds the pinned client and the built minimap tiles, or says loudly why the minimap client test is skipped', () => {
  if (!status.available) announceSkip(NAME, status.reason);
  else if (!built) announceSkip(NAME, `${MINIMAP_DIR}/t/ has no tiles (run pnpm tsx tools/maps/minimap.ts)`);
  else if (!rebuild) process.stderr.write(`\n${'='.repeat(96)}\nSKIPPED: ${NAME}, the whole rebuild (opt-in, MD-07)\n  Set FRL_MINIMAP_REBUILD=1 to run it (about five minutes and 3 GB). The gate is pnpm tsx tools/maps/minimap.ts --check --pack.\n${'='.repeat(96)}\n`);
  expect(status.available || status.reason.length > 0).toBe(true);
});

/** The signed-off build's census (§19.5, `b5`), per map. */
const B5 = {
  '0': { amplified: 253, inversions: 117, shoreDryBluer8: 8, landRecoloured: 117, waterRecoloured: 376_855, seamsOver8: [8, 5, 3] },
  '1': { amplified: 322, inversions: 15, shoreDryBluer8: 2, landRecoloured: 93, waterRecoloured: 484_482, seamsOver8: [9, 4, 3] },
} as const;
const within = (got: number, want: number): boolean => Math.abs(got - want) <= Math.max(1, 0.1 * want);

describe.skipIf(!status.available)('the minimap inputs on the pinned Forever client', () => {
  it('discovers 988, 736 and 72 minimap tiles through MAID, and the liquid grids equal the committed reliefs', async () => {
    if (!status.available) return;
    const committed = await readCommittedMinimapInputs(REPO_ROOT);
    const casc = LocalCasc.open({ install: status.install, product: FOREVER_TEST_PIN.product, pin: FOREVER_TEST_PIN });
    try {
      const tables = readClientMinimapTables(casc, committed.layout);
      expect(Object.fromEntries(tables.maps.map((m) => [String(m.mapId), m.tiles.length]))).toEqual(RECORDED_TILE_COUNTS);
      const hazard = new Set(tables.liquidType.hazardIds);
      for (const m of tables.maps) {
        const relief = committed.reliefs.get(m.mapId);
        if (relief === undefined) continue;
        const grid = buildLiquidGrid(m.tiles, (t) => readChecked(casc, t.rootAdt, 'root ADT'), hazard);
        const eq = reliefEquality(grid, relief);
        expect(eq.originOk && eq.sizeOk).toBe(true);
        expect(eq.compared).toBeGreaterThan(700_000);
        expect(eq.same).toBe(eq.compared);
      }
    } finally {
      casc.close();
    }
  }, 120_000);
});

describe.skipIf(!status.available || !built || !rebuild)('the minimap tiles on the pinned Forever client', () => {
  it('rebuilds public/maps/minimap byte for byte (a second, independent build) with the census of the signed-off build', async () => {
    if (!status.available) return;
    const committed = await readCommittedMinimapInputs(REPO_ROOT);
    const casc = LocalCasc.open({ install: status.install, product: FOREVER_TEST_PIN.product, pin: FOREVER_TEST_PIN });
    let build: MinimapBuild | undefined;
    try {
      const tables = readClientMinimapTables(casc, committed.layout);
      const hazard = new Set(tables.liquidType.hazardIds);
      const maps = tables.maps.map((source) => ({
        source,
        liquid: buildLiquidGrid(source.tiles, (t) => readChecked(casc, t.rootAdt, 'root ADT'), hazard),
        texels: (t: (typeof source.tiles)[number]) => decodeMinimapTexture(readChecked(casc, t.minimap, 'minimap'), 'minimap'),
      }));
      const tree = toolTreeHash(REPO_ROOT, [join(REPO_ROOT, MINIMAP_TOOL_ENTRY)]);
      build = await buildMinimap(
        { layout: committed.layout, geometry: committed.geometry, maps, reliefs: committed.reliefs, terrainManifestSha256: committed.terrainManifestSha256, tables: [{ table: 'Map', ...tables.mapTable }, { table: 'LiquidType', ...tables.liquidType }] },
        { client: { product: casc.build.product, version: casc.build.version, buildKey: casc.build.buildKey }, tool: { hash: tree.hash, files: tree.files.length }, node: process.version, encoder: encoderIdentity(), webp: DEFAULT_WEBP, encodeJobs: 8 },
      );
    } finally {
      casc.close();
    }
    if (build === undefined) throw new Error('no build');
    expect(build.failures).toEqual([]);
    // every tile, the index and the NOTICE, byte for byte
    const differs = build.tiles.filter((t) => !existsSync(join(dir, t.path)) || !readFileSync(join(dir, t.path)).equals(t.bytes)).map((t) => t.path);
    expect(differs).toEqual([]);
    expect(readFileSync(join(dir, 'index.json'), 'utf8')).toBe(build.indexText);
    expect(readFileSync(join(dir, 'NOTICE.md'), 'utf8')).toBe(build.noticeText);
    // the manifest and pointer, apart from what the tool's own tree hash changes: the manifest's
    // hash and file count, and with them the pack's SHA-256 and so its asset name and tag (MD-02);
    // minimap.ts --check --pack compares those too
    const withoutTool = (text: string): unknown => {
      const v = JSON.parse(text) as { tool: Record<string, unknown> };
      delete v.tool['toolTreeHash'];
      delete v.tool['toolFiles'];
      return v;
    };
    expect(withoutTool(readFileSync(join(dir, 'manifest.json'), 'utf8'))).toEqual(withoutTool(build.manifestText));
    const pointer = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')) as Record<string, unknown>;
    const rebuilt = JSON.parse(build.pointerText) as Record<string, unknown>;
    expect({ ...pointer, sha256: null, asset: null, tag: null }).toEqual({ ...rebuilt, sha256: null, asset: null, tag: null });
    // the census of the signed-off build b5 (§19.5), within ±10 %
    const census = build.census as { maps: Record<string, NativeCensus>; seams: Record<string, SeamLevelCensus>; contrast: { partI: { ratio: number } } };
    for (const [id, want] of Object.entries(B5)) {
      const m = census.maps[id];
      if (m === undefined || m.relief === null) throw new Error(`no census for map ${id}`);
      expect(within(m.texture.amplified, want.amplified), `map ${id} amplified ${String(m.texture.amplified)}`).toBe(true);
      expect(within(m.order.inversions, want.inversions), `map ${id} inversions ${String(m.order.inversions)}`).toBe(true);
      expect(m.dry.brightened).toBe(0);
      expect(within(m.relief.shoreDryBluer8, want.shoreDryBluer8), `map ${id} dry shore ${String(m.relief.shoreDryBluer8)}`).toBe(true);
      expect(within(m.relief.landRecoloured, want.landRecoloured), `map ${id} land ${String(m.relief.landRecoloured)}`).toBe(true);
      expect(within(m.relief.waterRecoloured, want.waterRecoloured)).toBe(true);
      want.seamsOver8.forEach((n, i) => {
        const got = census.seams[String(-1 - i)]?.perMap[id]?.edgesLong.over8 ?? -1;
        expect(within(got, n), `map ${id} level ${String(-1 - i)} seams over 8: ${String(got)}`).toBe(true);
      });
    }
    expect(census.contrast.partI.ratio).toBeGreaterThanOrEqual(2.0);
    const skirts = build.maps.flatMap((m) => m.skirts.map((s) => `${String(m.mapId)} ${s.tile} ${s.side}`));
    expect(skirts).toEqual(['1 20_45 N', '1 20_46 N', '1 20_47 N', '1 20_47 E']);
    expect(build.levels.every((l) => l.flatNonSea === 0)).toBe(true);
  }, 1_800_000);
});
