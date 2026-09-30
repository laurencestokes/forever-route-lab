/**
 * tools/maps convert (docs/MAPS.md §5.4 (b); terrain-navigation.md §13.4, §15; D-033, D-042 O5).
 *
 * Extracts the painted world-map art of every UiMap with art from the local Forever client and
 * writes the committed `public/maps/art/`: one WebP per deployed UiMap and style layer (the fully
 * explored map: base tiles plus every explored-area overlay), `manifest.json` (pin, build, tool tree
 * hashes, encoder, and per file its SHA-256, pixel size, UiMap, world rectangle, tile FileDataIDs
 * and input hash) and `NOTICE.md` (Blizzard Entertainment as the owner, non-affiliation, D-033).
 *
 * Since step ATL.10 (docs/research/map-atlas.md §7.6; D-042 O5) only the images still drawn one at a
 * time are deployed (`DEPLOYED_ART_UIMAPS`: Alterac Valley, Warsong Gulch, Arathi Basin, Zephras Isle
 * and Darkspear Islands), within the 1.0 MB `art` budget; the other paintings reach the site as the
 * atlas tiles. `--all` writes every composed image to another folder, as before ATL.10 (for
 * `tools/maps/tints.ts --art <dir>` and local review; never deployed).
 *
 * The manifest also keeps a `sources` record for every UiMap it composes, deployed or not: the
 * pixel hash of the lossless fully explored image and of its explored-overlay union, and the input
 * hash (docs/research/map-atlas.md §7.4, §7.5 T5). The atlas build (`tools/maps/atlas.ts`) reads the
 * same rasters from the client and refuses to run unless they match these records; `--check`
 * recomputes them from the client like everything else.
 *
 * Client access: `tools/casc` only (read-only, `.build.info` and `Data/` under `WOW_INSTALL`),
 * pinned to `CLIENT_PIN`; nothing is fetched and no client file is written anywhere. The full
 * input lists (FileDataID, CKey), compose statistics and sizes go to the gitignored report.
 *
 * Usage: pnpm tsx tools/maps/convert.ts [--out <dir>] [--report <file>] [--check] [--all]
 *   --out     output folder (default public/maps/art)
 *   --report  report file (default generated/maps-art-report.json)
 *   --check   rebuild in memory and compare with the folder instead of writing (exit 1 on a
 *             difference; a file whose pixels match but whose bytes differ is an encoder difference)
 *   --all     every composed image, not only the deployed ones; needs --out naming a folder other
 *             than public/maps/art, and is not held to the art budget
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { LocalCasc } from '../casc/casc';
import { resolveInstall } from '../casc/paths';
import { formatBytes, REPO_ROOT } from '../build/lib/fs';
import { parseArgs } from './lib/args';
import { buildArtSet, type ArtBuild } from './lib/art-build';
import { ART_DIR, ART_FILE_NAME, ART_MANIFEST_FILE, ART_NOTICE_FILE, parseArtManifest } from './lib/art-manifest';
import { readClientMapTables } from './lib/client-tables';
import { ART_BUDGET_GZIP_BYTES, ART_TOOL_DIRS, CLIENT_PIN, DEPLOYED_ART_REASON, DEPLOYED_ART_UIMAPS } from './lib/constants';
import { DEFAULT_WEBP, encoderIdentity } from './lib/encode';
import { gzipSize } from '../build/lib/audit';
import { formatJson } from './lib/json';
import { toolTrees } from './lib/tool-tree';

const DEFAULT_REPORT = 'generated/maps-art-report.json';
const toPosix = (path: string): string => path.split('\\').join('/');

interface Output {
  readonly name: string;
  readonly bytes: Buffer;
}

function outputsOf(build: ArtBuild): readonly Output[] {
  return [
    ...build.files.map((f) => ({ name: f.entry.path, bytes: f.bytes })),
    { name: ART_MANIFEST_FILE, bytes: Buffer.from(build.manifestText) },
    { name: ART_NOTICE_FILE, bytes: Buffer.from(build.noticeText) },
  ];
}

/** Compares with the folder; returns the differences, each on one line. */
function check(outDir: string, build: ArtBuild): readonly string[] {
  const problems: string[] = [];
  const recorded = existsSync(join(outDir, ART_MANIFEST_FILE)) ? parseArtManifest(JSON.parse(readFileSync(join(outDir, ART_MANIFEST_FILE), 'utf8')) as unknown).manifest : null;
  for (const output of outputsOf(build)) {
    const path = join(outDir, output.name);
    if (!existsSync(path)) {
      problems.push(`${output.name}: missing`);
      continue;
    }
    if (readFileSync(path).equals(output.bytes)) continue;
    const file = build.files.find((f) => f.entry.path === output.name);
    const old = recorded?.files.find((f) => f.path === output.name);
    if (file !== undefined && old !== undefined && old.pixelsSha256 === file.entry.pixelsSha256) {
      problems.push(`${output.name}: same pixels (${file.entry.pixelsSha256.slice(0, 12)}…), different WebP bytes: an encoder difference (recorded ${JSON.stringify(recorded?.encoder)})`);
    } else problems.push(`${output.name}: differs`);
  }
  const expected = new Set(outputsOf(build).map((o) => o.name));
  for (const name of existsSync(outDir) ? readdirSync(outDir) : []) if (!expected.has(name)) problems.push(`${name}: not produced by this build`);
  return problems;
}

function write(outDir: string, build: ArtBuild): void {
  mkdirSync(outDir, { recursive: true });
  const expected = new Set(outputsOf(build).map((o) => o.name));
  for (const name of readdirSync(outDir)) {
    if (!expected.has(name) && ART_FILE_NAME.test(name)) {
      rmSync(join(outDir, name));
      console.log(`convert: removed stale ${name}`);
    }
  }
  for (const output of outputsOf(build)) writeFileSync(join(outDir, output.name), output.bytes);
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv, { values: ['--out', '--report'], flags: ['--check', '--all'] });
  if (args.positional.length > 0) throw new Error(`unexpected argument ${args.positional.join(' ')}`);
  const outDir = resolve(REPO_ROOT, args.values.get('--out') ?? ART_DIR);
  const all = args.flags.has('--all');
  if (all && outDir === resolve(REPO_ROOT, ART_DIR)) throw new Error(`--all writes every composed image, which ${ART_DIR} does not deploy (D-042 O5); name another folder with --out`);
  const reportPath = resolve(REPO_ROOT, args.values.get('--report') ?? DEFAULT_REPORT);
  const started = performance.now();
  const casc = LocalCasc.open({ install: resolveInstall(), product: CLIENT_PIN.product, pin: CLIENT_PIN });
  let build: ArtBuild;
  const opened = performance.now();
  try {
    const tables = readClientMapTables(casc);
    build = await buildArtSet(
      { tables, read: (id) => { const file = casc.file(id); return { data: file.data, ckey: file.ckey }; } },
      {
        client: { product: casc.build.product, version: casc.build.version, buildKey: casc.build.buildKey },
        toolTrees: toolTrees(REPO_ROOT, ART_TOOL_DIRS),
        encoder: encoderIdentity(),
        webp: DEFAULT_WEBP,
        deploy: all ? undefined : { uiMaps: DEPLOYED_ART_UIMAPS, reason: DEPLOYED_ART_REASON },
      },
    );
  } finally {
    casc.close();
  }
  const built = performance.now();
  const gzip = build.files.reduce((sum, f) => sum + f.gzipBytes, 0) + gzipSize(Buffer.from(build.manifestText)) + gzipSize(Buffer.from(build.noticeText));
  const bytes = build.files.reduce((sum, f) => sum + f.bytes.length, 0);
  const report = {
    tool: 'tools/maps convert',
    client: CLIENT_PIN,
    timingsMs: { open: Math.round(opened - started), build: Math.round(built - opened) },
    budget: { gzipBytes: ART_BUDGET_GZIP_BYTES, measuredGzipBytes: gzip, share: gzip / ART_BUDGET_GZIP_BYTES },
    manifestGzipBytes: gzipSize(Buffer.from(build.manifestText)),
    files: build.files.map((f) => ({ path: f.entry.path, name: f.entry.name, bytes: f.bytes.length, gzipBytes: f.gzipBytes, stats: f.stats, inputs: f.inputs.map((i) => [i.fileDataId, i.ckey]) })),
    skippedUiMaps: build.skippedUiMaps,
    skippedOverlays: build.skippedOverlays,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, formatJson(report));
  const summary = `${String(build.files.length)} images, ${formatBytes(bytes)} (${formatBytes(gzip)} gzip-6 with the manifest and NOTICE, ${(100 * gzip / ART_BUDGET_GZIP_BYTES).toFixed(1)}% of the ${formatBytes(ART_BUDGET_GZIP_BYTES)} art budget)`;
  if (args.flags.has('--check')) {
    const problems = check(outDir, build);
    for (const p of problems) console.error(`convert: ${p}`);
    if (problems.length === 0) console.log(`convert: ${toPosix(relative(REPO_ROOT, outDir))} is up to date: ${summary}`);
    return problems.length === 0 ? 0 : 1;
  }
  if (!all && gzip > ART_BUDGET_GZIP_BYTES) throw new Error(`the art is ${formatBytes(gzip)} gzip-6, over the ${formatBytes(ART_BUDGET_GZIP_BYTES)} budget (D-042 O5); nothing written`);
  write(outDir, build);
  console.log(`convert: wrote ${toPosix(relative(REPO_ROOT, outDir))}: ${summary}; built in ${((built - started) / 1000).toFixed(1)} s`);
  console.log(`convert: report ${toPosix(relative(REPO_ROOT, reportPath))}`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`convert: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
