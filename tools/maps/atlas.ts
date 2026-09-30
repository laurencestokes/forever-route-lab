/**
 * tools/maps atlas (docs/research/map-atlas.md §6, §7; D-033, D-042; step ATL.6).
 *
 * Builds the committed `public/maps/atlas/`: the tile pyramid of one continuous map of Kalimdor and
 * the Eastern Kingdoms with Zephras Isle's card (`t/<z>/<x>/<y>.webp`, levels −8 to 0), the runtime
 * index `index.json`, `manifest.json` (every file's SHA-256, every source's pixel hashes, every
 * parameter, the coverage and lettering censuses, the D-042 O11 alterations) and `NOTICE.md`.
 *
 * Inputs (A6): the lossless composed rasters and explored-overlay unions of the paintings, read from
 * the client through `tools/casc` exactly as `convert.ts` composes them and checked against the art
 * manifest's `sources` records (T5); the terrain byproducts, checked against the terrain manifest's
 * SHA-256s; the committed placeholder geometry's UiMap 947 rows with `src/geo/atlas-layout.ts`
 * (`ATLAS_LAYOUT`, pinned by `atlasHash`); and the reviewed label list
 * `tools/maps/inputs/atlas-labels.json`. Client access is read-only, `.build.info` and `Data/` under
 * `WOW_INSTALL`, pinned to `CLIENT_PIN`; nothing is fetched.
 *
 * Usage: pnpm tsx tools/maps/atlas.ts [--out <dir>] [--report <file>] [--check] [--review [dir]] [--jobs <n>]
 *   --out     output folder (default public/maps/atlas)
 *   --report  report file (default generated/maps-atlas-report.json)
 *   --check   rebuild in memory and compare every byte with the folder instead of writing (exit 1 on a difference)
 *   --review  also write the contact sheet (default .cache/map-build/contact-sheet/) for the owner's sign-off (D-042 O8)
 *   --jobs    parallel WebP encodes (default 8)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { formatBytes, REPO_ROOT } from '../build/lib/fs';
import { LocalCasc } from '../casc/casc';
import { resolveInstall } from '../casc/paths';
import { parseArgs } from './lib/args';
import { buildAtlas, type AtlasBuild } from './lib/atlas-build';
import { ATLAS_INDEX_FILE } from './lib/atlas-index';
import { readAtlasClient, readAtlasInputs } from './lib/atlas-inputs';
import { ATLAS_DIR, ATLAS_MANIFEST_FILE, ATLAS_NOTICE_FILE } from './lib/atlas-manifest';
import { ATLAS_BUDGET_GZIP_BYTES, ATLAS_FILE_CAP_GZIP_BYTES, ATLAS_TOOL_DIRS } from './lib/atlas-params';
import { writeContactSheet } from './lib/atlas-review';
import { CLIENT_PIN } from './lib/constants';
import { DEFAULT_WEBP, encoderIdentity } from './lib/encode';
import { formatJson } from './lib/json';
import { toolTrees } from './lib/tool-tree';

const DEFAULT_REPORT = 'generated/maps-atlas-report.json';
const DEFAULT_REVIEW = '.cache/map-build/contact-sheet';
const toPosix = (path: string): string => path.split('\\').join('/');

interface Output {
  readonly name: string;
  readonly bytes: Buffer;
}

function outputsOf(build: AtlasBuild): readonly Output[] {
  return [
    ...build.tiles.map((t) => ({ name: t.path, bytes: t.bytes })),
    { name: ATLAS_INDEX_FILE, bytes: Buffer.from(build.indexText) },
    { name: ATLAS_MANIFEST_FILE, bytes: Buffer.from(build.manifestText) },
    { name: ATLAS_NOTICE_FILE, bytes: Buffer.from(build.noticeText) },
  ];
}

/** Every file under `dir`, relative, `/`-separated. */
function listTree(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    if (statSync(path).isDirectory()) out.push(...listTree(path, rel));
    else out.push(rel);
  }
  return out;
}

function check(outDir: string, build: AtlasBuild): readonly string[] {
  const problems: string[] = [];
  const expected = new Set<string>();
  for (const output of outputsOf(build)) {
    expected.add(output.name);
    const path = join(outDir, output.name);
    if (!existsSync(path)) problems.push(`${output.name}: missing`);
    else if (!readFileSync(path).equals(output.bytes)) problems.push(`${output.name}: differs`);
  }
  for (const name of listTree(outDir)) if (!expected.has(name)) problems.push(`${name}: not produced by this build`);
  return problems;
}

function write(outDir: string, build: AtlasBuild): void {
  const expected = new Set(outputsOf(build).map((o) => o.name));
  for (const name of listTree(outDir)) {
    if (!expected.has(name)) {
      rmSync(join(outDir, name));
      console.log(`atlas: removed stale ${name}`);
    }
  }
  for (const output of outputsOf(build)) {
    const path = join(outDir, output.name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, output.bytes);
  }
  // remove folders the stale tiles leave empty
  const prune = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (!statSync(path).isDirectory()) continue;
      prune(path);
      if (readdirSync(path).length === 0) rmSync(path, { recursive: true });
    }
  };
  prune(outDir);
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv, { values: ['--out', '--report', '--jobs'], flags: ['--check'], optionalValues: ['--review'] });
  if (args.positional.length > 0) throw new Error(`unexpected argument ${args.positional.join(' ')}`);
  const outDir = resolve(REPO_ROOT, args.values.get('--out') ?? ATLAS_DIR);
  const reportPath = resolve(REPO_ROOT, args.values.get('--report') ?? DEFAULT_REPORT);
  const jobs = Number(args.values.get('--jobs') ?? '8');
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error('--jobs must be a positive integer');
  const started = performance.now();

  const committed = readAtlasInputs(REPO_ROOT);
  const casc = LocalCasc.open({ install: resolveInstall(), product: CLIENT_PIN.product, pin: CLIENT_PIN });
  let build: AtlasBuild;
  let loadMs: number;
  try {
    const client = readAtlasClient(casc, committed);
    loadMs = Math.round(performance.now() - started);
    console.log(`atlas: read ${String(client.rasters.size)} paintings from the client in ${(loadMs / 1000).toFixed(1)} s`);
    build = await buildAtlas(
      { ...committed, ...client },
      {
        client: { product: casc.build.product, version: casc.build.version, buildKey: casc.build.buildKey },
        toolTrees: toolTrees(REPO_ROOT, ATLAS_TOOL_DIRS),
        encoder: encoderIdentity(),
        webp: DEFAULT_WEBP,
        encodeJobs: jobs,
        log: (line) => {
          if (!line.startsWith('level −2: row')) console.log(`atlas: ${line}`);
        },
      },
    );
  } finally {
    casc.close();
  }
  const builtMs = Math.round(performance.now() - started);
  const report = { tool: 'tools/maps atlas', client: CLIENT_PIN, totalMs: builtMs, loadMs, budget: { gzipBytes: ATLAS_BUDGET_GZIP_BYTES, fileCapGzipBytes: ATLAS_FILE_CAP_GZIP_BYTES }, ...build.report, lettering: build.lettering };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, formatJson(report));
  const gzip = build.report['folderGzipBytes'] as number;
  const largest = Math.max(...build.tiles.map((t) => t.gzipBytes));
  const summary = `${String(build.tiles.length)} tiles, ${formatBytes(gzip)} gzip-6 with the index, manifest and NOTICE (${(100 * gzip / ATLAS_BUDGET_GZIP_BYTES).toFixed(1)}% of the ${formatBytes(ATLAS_BUDGET_GZIP_BYTES)} atlas budget), largest tile ${formatBytes(largest)}`;
  const problems: string[] = [];
  if (gzip > ATLAS_BUDGET_GZIP_BYTES) problems.push(`the atlas is ${formatBytes(gzip)} gzip-6, over the ${formatBytes(ATLAS_BUDGET_GZIP_BYTES)} budget (D-042 O5)`);
  if (largest > ATLAS_FILE_CAP_GZIP_BYTES) problems.push(`a tile is ${formatBytes(largest)} gzip-6, over the ${formatBytes(ATLAS_FILE_CAP_GZIP_BYTES)} per-file cap`);
  if (args.flags.has('--check')) {
    problems.push(...check(outDir, build));
    for (const p of problems.slice(0, 40)) console.error(`atlas: ${p}`);
    if (problems.length > 40) console.error(`atlas: … ${String(problems.length - 40)} more`);
    if (problems.length === 0) console.log(`atlas: ${toPosix(relative(REPO_ROOT, outDir))} is up to date, byte for byte: ${summary}; built in ${(builtMs / 1000).toFixed(1)} s`);
  } else if (problems.length === 0) {
    write(outDir, build);
    console.log(`atlas: wrote ${toPosix(relative(REPO_ROOT, outDir))}: ${summary}; built in ${(builtMs / 1000).toFixed(1)} s`);
  } else for (const p of problems) console.error(`atlas: ${p}; nothing written`);
  console.log(`atlas: report ${toPosix(relative(REPO_ROOT, reportPath))}`);
  if (args.flags.has('--review') || args.values.has('--review')) {
    const dir = resolve(REPO_ROOT, args.values.get('--review') ?? DEFAULT_REVIEW);
    const sheets = await writeContactSheet(build, dir);
    console.log(`atlas: contact sheet ${toPosix(relative(REPO_ROOT, dir))}/ (${String(sheets.length)} images)`);
  }
  return problems.length === 0 ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`atlas: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exitCode = 1;
  },
);
