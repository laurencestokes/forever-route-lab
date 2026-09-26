/**
 * Validates the committed navigation data (terrain-navigation.md §14.2, §16).
 *
 * Usage: pnpm nav:validate [--skip-tool-tree] [--client] [--partition] [--parts N] [--json PATH]
 *
 * - Offline (always; CI runs this): the manifest, every file's size and SHA-256, the NOTICE and
 *   connectors.json, the stage-2 input hashes and the tool tree hash (G13); decoding (G11); sizes
 *   against D-030 (G11); link symmetry and seams (G5); the stored components against a
 *   recomputation (G12); the census against the build and the reviewed file (G6); the water
 *   splits (G9); the fixtures (G7, G7a, G7b, G7c, G8, G8b); the connector file (G15).
 * - `--client` (needs the pinned client at WOW_INSTALL): the pin (G1), every block's stage-1 input
 *   hash against the installed files, the derived adjacency against rcPolyMesh (G5b) and the
 *   implementation check against Detour on the shipped and the rebuilt blocks (G10, G10b).
 * - `--partition` (with the client; several minutes): rebuilds stage 1 of both maps with 8×8
 *   blocks and compares every Recast tile with the 4×4 build (G4).
 * - `--skip-tool-tree`: local work only; CI never skips the tool tree check.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cascSource, openClient, readMapWdt, readTables } from './lib/client';
import { adjacencyCheck, detourCheck, detourPass } from './lib/detour-check';
import { decodeBlock } from './lib/encode';
import { comparePartitions, readStage1Blocks } from './lib/partition';
import { runStage1 } from './lib/parallel';
import { ensureRecast, type RecastTile } from './lib/recast';
import { derive, readBuildConfig, REPO_ROOT } from './lib/settings';
import { buildStage1Block, gridOf, inputHash, stage1Inputs } from './lib/stage1';
import { loadSpawns } from './lib/spawns';
import { formatChecks, validateOffline, type Check } from './lib/validate-lib';
import type { BlockDone } from './lib/worker';

const STAGE1_DIR = join(REPO_ROOT, '.cache', 'terrain', 'stage1');
const STAGE1_B8_DIR = join(REPO_ROOT, '.cache', 'terrain', 'stage1-b8');

async function main(argv: readonly string[]): Promise<number> {
  const skipToolTree = argv.includes('--skip-tool-tree');
  const client = argv.includes('--client');
  const partition = argv.includes('--partition');
  const partsAt = argv.indexOf('--parts');
  const parts = partsAt >= 0 ? Number(argv[partsAt + 1]) : 6;
  const jsonAt = argv.indexOf('--json');
  const jsonPath = jsonAt >= 0 ? argv[jsonAt + 1] : undefined;
  const t0 = performance.now();
  const offline = validateOffline({ repoRoot: REPO_ROOT, skipToolTree });
  const checks: Check[] = [...offline.checks];
  const extra: Record<string, unknown> = {};
  if (client || partition) {
    const config = readBuildConfig();
    const d = derive(config.settings);
    const casc = openClient(config);
    checks.push({ gate: 'G1', name: 'client pin', status: 'pass', detail: `${casc.build.product} ${casc.build.version} ${casc.build.buildKey}` });
    const tables = readTables(casc);
    const presentAll = new Map(config.maps.map((m) => [m.id, readMapWdt(tables, m.id, m.wdtFileDataId).present]));
    const report = join(REPO_ROOT, 'generated', 'terrain-nav-report.json');
    if (existsSync(report)) {
      const r = JSON.parse(readFileSync(report, 'utf8')) as { stage1?: { mapId: number; block: string; inputHash: string; inputs: [number, string][] }[] };
      let same = 0;
      const changed: string[] = [];
      for (const b of r.stage1 ?? []) {
        const now = inputHash(b.inputs.map(([id]) => ({ fileDataId: id, ckey: casc.ckeyOf(id) ?? 'missing' })));
        const entry = offline.manifest.maps.find((m) => m.mapId === b.mapId)?.blocks.find((x) => x.path === `${String(b.mapId)}/${b.block}.bin`);
        if (now === b.inputHash && (entry === undefined || entry.inputHash === now)) same += 1;
        else changed.push(`${String(b.mapId)}/${b.block}`);
      }
      checks.push({ gate: 'G2', name: 'per-block stage-1 input hashes against the installed client', status: changed.length === 0 ? 'pass' : 'fail', detail: changed.length === 0 ? `${String(same)} blocks unchanged` : `inputs changed for ${changed.join(', ')}` });
    } else checks.push({ gate: 'G2', name: 'per-block stage-1 input hashes', status: 'skipped', detail: 'no generated/terrain-nav-report.json (run pnpm nav:extract)' });
    if (client) {
      await ensureRecast();
      const w = readMapWdt(tables, 1, config.maps.find((m) => m.id === 1)?.wdtFileDataId ?? 0);
      const inp = stage1Inputs(casc, tables, 1, w.wdt, w.present, d, w.input, cascSource(casc));
      const blocks: [number, number][] = [
        [28, 36],
        [28, 40],
      ];
      const grid = gridOf(d);
      const shipped = blocks.map(([r, c]) => decodeBlock(readFileSync(join(REPO_ROOT, 'public', 'nav', '1', `${String(r)}_${String(c)}.bin`)), grid));
      const spawns = loadSpawns(REPO_ROOT).spawns.filter((s) => s.mapId === 1);
      const dc = detourCheck(inp, config.settings, blocks, shipped, spawns);
      extra['detourCheck'] = dc;
      const chosenTiles: RecastTile[] = [];
      for (const [r, c] of blocks) buildStage1Block(inp, r, c, { keepRecastTiles: chosenTiles });
      const chosen = adjacencyCheck(chosenTiles, config.settings.tileVoxels);
      extra['adjacency'] = { chosen, sixVertices: dc.adjacency };
      for (const [label, a] of [[`${String(config.settings.vertsPerPoly)} vertices per polygon (the shipped settings)`, chosen], ['6 vertices per polygon (the Detour rebuild)', dc.adjacency]] as const) {
        checks.push({ gate: 'G5b', name: `derived adjacency and portals equal rcPolyMesh (Kalimdor 28_36, 28_40, ${label})`, status: a.internalAgree === a.internalRecast && a.portalsAgree === a.portalsRecast && a.portalsDerived === a.portalsRecast ? 'pass' : 'fail', detail: `${String(a.tiles)} tiles: internal ${String(a.internalAgree)} of ${String(a.internalRecast)}, portals ${String(a.portalsAgree)} of ${String(a.portalsRecast)} (derived ${String(a.portalsDerived)})` });
      }
      for (const which of ['g10', 'g10b'] as const) {
        const s = dc[which];
        checks.push({
          gate: which === 'g10' ? 'G10' : 'G10b',
          name: which === 'g10' ? 'TypeScript ÷ Detour on the 6-vertex rebuild' : 'TypeScript on the shipped 12-vertex blocks ÷ Detour at 6 vertices',
          status: detourPass(dc, which) ? 'pass' : 'fail',
          detail: `${String(s.pairs)} pairs over 20 yd of ${String(dc.points)} points: median ${s.p50.toFixed(3)}, p90 ${s.p90.toFixed(3)}, max ${s.max.toFixed(3)}; Detour no path ${String(dc.dtNoPath)}, partial ${String(dc.dtPartial)}; TS unreachable ${String(s.tsUnreachable)}; ${String(dc.dtTiles)} Detour tiles (${String(dc.dtFail)} failed)`,
        });
      }
    }
    casc.close();
    if (partition) {
      const maps = config.maps.map((m) => m.id);
      const cache = JSON.parse(readFileSync(join(STAGE1_DIR, 'stage1.json'), 'utf8')) as { settings: unknown; blocks: BlockDone[] };
      if (JSON.stringify(cache.settings) !== JSON.stringify(config.settings)) throw new Error('the 4×4 stage-1 cache was built with other settings: run pnpm nav:extract first');
      const t1 = performance.now();
      await runStage1(config, maps, presentAll, STAGE1_B8_DIR, parts, 8, true);
      const ms = performance.now() - t1;
      const results: Record<string, unknown> = {};
      for (const mapId of maps) {
        const a = readStage1Blocks(STAGE1_DIR, mapId, gridOf(d));
        const b = readStage1Blocks(STAGE1_B8_DIR, mapId, { ...gridOf(d), blockAdts: 8 });
        const r = comparePartitions(a, b, d.ch);
        results[String(mapId)] = r;
        checks.push({
          gate: 'G4',
          name: `map ${String(mapId)}: partition invariance, 4×4 against 8×8 blocks`,
          status: r.identical === r.tilesA && r.different.length === 0 ? 'pass' : 'fail',
          detail: `${String(r.identical)} of ${String(r.tilesA)} tiles identical (${String(r.tilesB)} in 8×8); zones differ on ${String(r.zonesDifferent)}; largest 8×8 block height span ${r.maxBlockSpanYd.toFixed(1)} yd (${r.maxBlockSpanBlock})${r.different.length > 0 ? `; ${r.different.slice(0, 5).join('; ')}` : ''}`,
        });
      }
      extra['partition'] = { ...results, stage1B8WallMs: Math.round(ms), parts };
    }
  }
  console.log(formatChecks(checks));
  const failed = checks.filter((c) => c.status === 'fail');
  const warned = checks.filter((c) => c.status === 'warn');
  console.log(`\n[nav] validate: ${String(checks.length)} checks, ${String(failed.length)} failed, ${String(warned.length)} warnings, nav gzip6 ${String(offline.totals.gzip6)} B (${String(Math.round((performance.now() - t0) / 1000))} s)`);
  if (jsonPath !== undefined) writeFileSync(jsonPath, JSON.stringify({ checks, totals: offline.totals, fixtures: offline.fixtures, censusGates: offline.censusGates, ...extra }, null, 1));
  return failed.length === 0 ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`[nav] validate: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exitCode = 1;
  },
);
