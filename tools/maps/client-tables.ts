/**
 * tools/maps client-tables (docs/research/map-presentation.md §8, §9, §10, §12.6, §16; D-039 B, C
 * and E; step MP.5a).
 *
 * Reads the client's taxi, zone and dungeon tables and writes the committed
 * `public/maps/client/`: `taxi.json` (flight nodes, directed flights with their 3D path lengths and
 * 25 yd shapes, transport stops), `zones.json` (zone faction group and sanctuary flag),
 * `dungeons.json` (dungeon-finder tuning levels and the dungeon and raid maps), `manifest.json`
 * (pin, build, WoWDBDefs commit, tool tree hash, per table its FileDataID, CKey and the columns
 * used, per file its SHA-256, input hash and counts) and `NOTICE.md` (Blizzard Entertainment as the
 * owner, D-039, non-affiliation).
 *
 * Client access: `tools/casc` only (read-only, `.build.info` and `Data/` under `WOW_INSTALL`),
 * pinned; nothing is fetched and no client file is written anywhere.
 *
 * Usage: pnpm tsx tools/maps/client-tables.ts [--out <dir>] [--check]
 *        pnpm tsx tools/maps/client-tables.ts --layouts [--check]
 *   --out      output folder (default public/maps/client)
 *   --check    rebuild in memory and compare with the folder byte for byte instead of writing
 *              (exit 1 on any difference)
 *   --layouts  regenerate tools/maps/lib/client-data/layouts.ts from the WoWDBDefs research copies
 *              (with --check: fail when the committed file differs); does not open the client
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from './lib/args';
import { CLIENT_TABLES_BUDGET_GZIP_BYTES, CLIENT_TABLES_DIR } from './lib/client-data/constants';
import { CLIENT_LAYOUTS_FILE, readClientLayoutSources, renderClientLayoutsModule } from './lib/client-data/layout-source';
import { buildFromClient, checkFolder, CLIENT_TABLES_REPO_ROOT as REPO_ROOT } from './lib/client-data/run';

const toPosix = (path: string): string => path.split('\\').join('/');
const kB = (bytes: number): string => `${(bytes / 1000).toFixed(1)} kB`;

function layouts(check: boolean): number {
  const text = renderClientLayoutsModule(readClientLayoutSources(REPO_ROOT));
  const out = join(REPO_ROOT, CLIENT_LAYOUTS_FILE);
  if (check) {
    const same = existsSync(out) && readFileSync(out, 'utf8').replace(/\r\n/g, '\n') === text;
    console.log(same ? `client-tables: ${CLIENT_LAYOUTS_FILE} is up to date` : `client-tables: ${CLIENT_LAYOUTS_FILE} differs from the WoWDBDefs copies`);
    return same ? 0 : 1;
  }
  writeFileSync(out, text);
  console.log(`client-tables: wrote ${CLIENT_LAYOUTS_FILE}`);
  return 0;
}

function main(argv: readonly string[]): number {
  const args = parseArgs(argv, { values: ['--out'], flags: ['--check', '--layouts'] });
  if (args.positional.length > 0) throw new Error(`unexpected argument ${args.positional.join(' ')}`);
  const check = args.flags.has('--check');
  if (args.flags.has('--layouts')) {
    if (args.values.has('--out')) throw new Error('--layouts writes only the layouts module; --out does not apply');
    return layouts(check);
  }
  const outDir = resolve(REPO_ROOT, args.values.get('--out') ?? CLIENT_TABLES_DIR);
  const started = performance.now();
  const build = buildFromClient();
  const elapsed = performance.now() - started;
  const t = build.taxi.counts;
  const summary =
    `${String(t.nodes)} nodes, ${String(t.flights)} flights (${String(t.pairs)} pairs), ${String(t.transports)} transport paths (${String(t.stops)} stops); ` +
    `${String(build.zones.counts.zones)} zones; ${String(build.dungeons.counts.lfgRows)} LFG rows, ${String(build.dungeons.counts.instanceMaps)} instance maps; ` +
    `${kB(build.totalGzipBytes)} gzip-6 (${(100 * build.totalGzipBytes / CLIENT_TABLES_BUDGET_GZIP_BYTES).toFixed(1)}% of the ${kB(CLIENT_TABLES_BUDGET_GZIP_BYTES)} budget)`;
  const where = toPosix(relative(REPO_ROOT, outDir));
  if (check) {
    const problems = checkFolder(outDir, build);
    for (const p of problems) console.error(`client-tables: ${p}`);
    if (problems.length === 0) console.log(`client-tables: ${where} is up to date: ${summary}`);
    return problems.length === 0 ? 0 : 1;
  }
  if (build.totalGzipBytes > CLIENT_TABLES_BUDGET_GZIP_BYTES) throw new Error(`the tables are ${kB(build.totalGzipBytes)} gzip-6, over the ${kB(CLIENT_TABLES_BUDGET_GZIP_BYTES)} budget; nothing written`);
  mkdirSync(outDir, { recursive: true });
  for (const output of build.outputs) writeFileSync(join(outDir, output.name), output.bytes);
  console.log(`client-tables: wrote ${where}: ${summary}; built in ${(elapsed / 1000).toFixed(1)} s`);
  for (const e of t.excludedPaidPaths) console.log(`client-tables: paid path ${String(e.pathId)} not carried: ${e.reason}`);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`client-tables: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
