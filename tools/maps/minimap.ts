/**
 * tools/maps minimap (docs/research/map-atlas.md Part II §18; D-045, D-049; steps MM.2-MM.4).
 *
 * Builds the minimap style's tiles: the client's minimap textures of Kalimdor, the Eastern Kingdoms
 * and Zephras Isle, with the sea recoloured to one navy (§19), stitched onto the atlas grid in the
 * compact layout with Zephras Isle's card, resampled to 1 yd per pixel (Lanczos-3), reduced to level
 * −8 and encoded as WebP q80, with:
 *
 * - `public/maps/minimap/index.json`, `manifest.json`, `NOTICE.md` and `pack.json` (committed);
 * - the tiles `public/maps/minimap/t/<z>/<x>/<y>.webp` (gitignored: they ship as a release-asset tile
 *   pack, D-049 O14, and are never committed);
 * - with `--pack`, the pack itself: an uncompressed tar of `NOTICE.md`, `manifest.json` and `t/`.
 *
 * Inputs: the pinned client, read-only (`.build.info` and `Data/` under `WOW_INSTALL`, `CLIENT_PIN`):
 * the Map and LiquidType tables, each map's WDT and its MAID entries, the minimap textures and the
 * root ADTs; the committed geometry (`ATLAS_LAYOUT`'s placements) and the terrain reliefs. Nothing is
 * fetched. The census gates of §19.5 and the budgets of §24.1 fail the build: nothing is written but
 * the report (and the contact sheets when asked).
 *
 * Usage: pnpm tsx tools/maps/minimap.ts [--out <dir>] [--report <file>] [--check] [--review [dir]]
 *        [--previous <dir>] [--jobs <n>] [--pack [file]]
 *   --out       output folder (default public/maps/minimap)
 *   --report    report file (default generated/maps-minimap-report.json)
 *   --check     rebuild in memory and compare index, manifest, NOTICE, pointer and every tile present
 *               under <out>/t (and, with --pack, the pack's SHA-256) instead of writing
 *   --review    also write the contact sheets (default .cache/map-ui-build/minimap-sheets/) for the
 *               owner's sign-off (D-049 O18)
 *   --previous  a raw pyramid of the previous signed-off build, drawn as the sheets' middle panel
 *   --jobs      parallel WebP encodes (default 16)
 *   --pack      write the tile pack (default .cache/minimap-pack/<asset>)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { formatBytes, REPO_ROOT } from '../build/lib/fs';
import { LocalCasc } from '../casc/casc';
import { resolveInstall } from '../casc/paths';
import { toolTreeHash } from '../terrain/lib/tool-tree';
import { parseArgs } from './lib/args';
import { CLIENT_PIN } from './lib/shared';
import { DEFAULT_WEBP, encoderIdentity } from './lib/encode';
import { sha256Hex } from './lib/hash';
import { formatJson } from './lib/json';
import { buildMinimap, type MinimapBuild, type MinimapMapInput } from './lib/minimap-build';
import { decodeMinimapTexture } from './lib/minimap-decode';
import { readChecked, readClientMinimapTables, readCommittedMinimapInputs } from './lib/minimap-inputs';
import { buildLiquidGrid } from './lib/minimap-liquid';
import { MINIMAP_DIR, MINIMAP_INDEX_FILE, MINIMAP_MANIFEST_FILE, MINIMAP_NOTICE_FILE, MINIMAP_POINTER_FILE, MINIMAP_TILES_DIR, MINIMAP_TOOL_ENTRY } from './lib/minimap-params';
import { buildReader, censusSheets, r31Sheets, rawPyramidReader, sourceReader, writeMinimapSheets, type Panel } from './lib/minimap-review';

const DEFAULT_REPORT = 'generated/maps-minimap-report.json';
const DEFAULT_REVIEW = '.cache/map-ui-build/minimap-sheets';
const DEFAULT_PACK_DIR = '.cache/minimap-pack';
const toPosix = (path: string): string => path.split('\\').join('/');

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

function committedFiles(build: MinimapBuild): readonly { readonly name: string; readonly bytes: Buffer }[] {
  return [
    { name: MINIMAP_INDEX_FILE, bytes: Buffer.from(build.indexText) },
    { name: MINIMAP_MANIFEST_FILE, bytes: Buffer.from(build.manifestText) },
    { name: MINIMAP_NOTICE_FILE, bytes: Buffer.from(build.noticeText) },
    { name: MINIMAP_POINTER_FILE, bytes: Buffer.from(build.pointerText) },
  ];
}

function check(outDir: string, build: MinimapBuild, packFile: string | null): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  for (const f of committedFiles(build)) {
    const path = join(outDir, f.name);
    if (!existsSync(path)) problems.push(`${f.name}: missing`);
    else if (!readFileSync(path).equals(f.bytes)) problems.push(`${f.name}: differs`);
  }
  const present = listTree(join(outDir, MINIMAP_TILES_DIR)).map((p) => `${MINIMAP_TILES_DIR}/${p}`);
  const produced = new Map(build.tiles.map((t) => [t.path, t.bytes]));
  if (present.length === 0) notes.push(`no tiles under ${MINIMAP_TILES_DIR}/: compared the index, manifest, NOTICE and pointer only`);
  else {
    for (const p of present) {
      const want = produced.get(p);
      if (want === undefined) problems.push(`${p}: not produced by this build`);
      else if (!readFileSync(join(outDir, p)).equals(want)) problems.push(`${p}: differs`);
    }
    const missing = build.tiles.filter((t) => !existsSync(join(outDir, t.path))).length;
    if (missing > 0) problems.push(`${String(missing)} of ${String(build.tiles.length)} tiles are missing under ${MINIMAP_TILES_DIR}/`);
    else notes.push(`all ${String(build.tiles.length)} tiles compared byte for byte`);
  }
  if (packFile !== null) {
    if (!existsSync(packFile)) problems.push(`${toPosix(packFile)}: no pack to compare`);
    else if (sha256Hex(readFileSync(packFile)) !== build.pointer.sha256) problems.push(`${toPosix(packFile)}: its SHA-256 is not the rebuilt pack's`);
    else notes.push(`the pack's SHA-256 matches (${build.pointer.sha256.slice(0, 12)}…)`);
  }
  return { problems, notes };
}

function write(outDir: string, build: MinimapBuild): number {
  const tilesDir = join(outDir, MINIMAP_TILES_DIR);
  const produced = new Set(build.tiles.map((t) => t.path));
  let removed = 0;
  for (const p of listTree(tilesDir)) {
    if (!produced.has(`${MINIMAP_TILES_DIR}/${p}`)) {
      rmSync(join(tilesDir, p));
      removed += 1;
    }
  }
  for (const t of build.tiles) {
    const path = join(outDir, t.path);
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path) || !readFileSync(path).equals(t.bytes)) writeFileSync(path, t.bytes);
  }
  for (const f of committedFiles(build)) writeFileSync(join(outDir, f.name), f.bytes);
  const prune = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (!statSync(path).isDirectory()) continue;
      prune(path);
      if (readdirSync(path).length === 0) rmSync(path, { recursive: true });
    }
  };
  prune(tilesDir);
  return removed;
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv, { values: ['--out', '--report', '--jobs', '--previous'], flags: ['--check'], optionalValues: ['--review', '--pack'] });
  if (args.positional.length > 0) throw new Error(`unexpected argument ${args.positional.join(' ')}`);
  const outDir = resolve(REPO_ROOT, args.values.get('--out') ?? MINIMAP_DIR);
  const reportPath = resolve(REPO_ROOT, args.values.get('--report') ?? DEFAULT_REPORT);
  const jobs = Number(args.values.get('--jobs') ?? '16');
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error('--jobs must be a positive integer');
  // sharp encodes on libuv's thread pool: size it for the jobs before anything uses it
  process.env['UV_THREADPOOL_SIZE'] ??= String(Math.max(4, jobs));
  const wantPack = args.flags.has('--pack') || args.values.has('--pack');
  const wantReview = args.flags.has('--review') || args.values.has('--review');
  const started = performance.now();

  const committed = await readCommittedMinimapInputs(REPO_ROOT);
  const casc = LocalCasc.open({ install: resolveInstall(), product: CLIENT_PIN.product, pin: CLIENT_PIN });
  let build: MinimapBuild;
  let loadMs = 0;
  try {
    const tables = readClientMinimapTables(casc, committed.layout);
    const hazard = new Set(tables.liquidType.hazardIds);
    const maps: MinimapMapInput[] = tables.maps.map((source) => {
      const t0 = performance.now();
      const liquid = buildLiquidGrid(source.tiles, (t) => readChecked(casc, t.rootAdt, `map ${String(source.mapId)} root ADT ${String(t.row)}_${String(t.col)}`), hazard);
      loadMs += performance.now() - t0;
      console.log(`minimap: map ${String(source.mapId)} (${source.directory}): ${String(source.tiles.length)} minimap tiles; liquid grid in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
      return { source, liquid, texels: (t) => decodeMinimapTexture(readChecked(casc, t.minimap, `map ${String(source.mapId)} minimap ${String(t.row)}_${String(t.col)}`), `map ${String(source.mapId)} minimap ${String(t.row)}_${String(t.col)} (FileDataID ${String(t.minimap.fileDataId)})`) };
    });
    const tree = toolTreeHash(REPO_ROOT, [join(REPO_ROOT, MINIMAP_TOOL_ENTRY)]);
    build = await buildMinimap(
      { layout: committed.layout, geometry: committed.geometry, maps, reliefs: committed.reliefs, terrainManifestSha256: committed.terrainManifestSha256, tables: [{ table: 'Map', ...tables.mapTable }, { table: 'LiquidType', ...tables.liquidType }] },
      {
        client: { product: casc.build.product, version: casc.build.version, buildKey: casc.build.buildKey },
        tool: { hash: tree.hash, files: tree.files.length },
        node: process.version,
        encoder: encoderIdentity(),
        webp: DEFAULT_WEBP,
        encodeJobs: jobs,
        keepForReview: wantReview,
        log: (line) => console.log(`minimap: ${line}`),
      },
    );
    const builtMs = Math.round(performance.now() - started);
    const report = { tool: 'tools/maps minimap', client: CLIENT_PIN, totalMs: builtMs, liquidGridMs: Math.round(loadMs), uvThreadpool: process.env['UV_THREADPOOL_SIZE'], jobs, ...build.report, census: build.census };
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, formatJson(report));
    const summary = `${String(build.tiles.length)} tiles, ${formatBytes(Number(build.report['folderGzipBytes']))} gzip-6 with the index, manifest, NOTICE and pointer; pack ${build.pointer.asset} (${formatBytes(build.pack.length)}); built in ${(builtMs / 1000).toFixed(1)} s`;
    let failed = build.failures.length > 0;
    for (const f of build.failures) console.error(`minimap: gate failed: ${f}`);
    const packPath = wantPack ? resolve(REPO_ROOT, args.values.get('--pack') ?? join(DEFAULT_PACK_DIR, build.pointer.asset)) : null;
    if (args.flags.has('--check')) {
      const { problems, notes } = check(outDir, build, packPath);
      for (const p of problems.slice(0, 40)) console.error(`minimap: ${p}`);
      if (problems.length > 40) console.error(`minimap: … ${String(problems.length - 40)} more`);
      for (const n of notes) console.log(`minimap: ${n}`);
      if (problems.length > 0) failed = true;
      else if (!failed) console.log(`minimap: ${toPosix(relative(REPO_ROOT, outDir))} is up to date, byte for byte: ${summary}`);
    } else if (!failed) {
      const removed = write(outDir, build);
      console.log(`minimap: wrote ${toPosix(relative(REPO_ROOT, outDir))}${removed > 0 ? ` (removed ${String(removed)} stale tiles)` : ''}: ${summary}`);
      if (packPath !== null) {
        mkdirSync(dirname(packPath), { recursive: true });
        writeFileSync(packPath, build.pack);
        console.log(`minimap: pack ${toPosix(relative(REPO_ROOT, packPath))} (SHA-256 ${build.pointer.sha256}); release tag ${build.pointer.tag}, release text ${MINIMAP_NOTICE_FILE}`);
      }
    } else console.error('minimap: nothing written');
    console.log(`minimap: report ${toPosix(relative(REPO_ROOT, reportPath))}`);
    if (wantReview && build.review !== null) {
      const dir = resolve(REPO_ROOT, args.values.get('--review') ?? DEFAULT_REVIEW);
      const review = build.review;
      const panels: Panel[] = [{ caption: 'source (same resample)', read: sourceReader(review, tables.maps, (mapId, row, col) => {
        const src = tables.maps.find((m) => m.mapId === mapId)?.tiles.find((t) => t.row === row && t.col === col);
        if (src === undefined) throw new Error(`no minimap tile ${String(row)}_${String(col)} on map ${String(mapId)}`);
        return decodeMinimapTexture(readChecked(casc, src.minimap, 'review'), 'review');
      }) }];
      const previousDir = args.values.get('--previous');
      const previous = previousDir === undefined ? null : rawPyramidReader(resolve(REPO_ROOT, previousDir));
      if (previousDir !== undefined && previous === null) console.error(`minimap: --previous ${previousDir} holds no raw pyramid; drawing without it`);
      if (previous !== null && previousDir !== undefined) panels.push({ caption: `signed-off build (${toPosix(previousDir).split('/').filter((x) => x !== '').pop() ?? previousDir})`, read: previous });
      panels.push({ caption: 'this build', read: buildReader(review) });
      const sheets = [...r31Sheets(), ...censusSheets(build, review, committed.geometry)];
      const names = await writeMinimapSheets(dir, sheets, panels);
      console.log(`minimap: contact sheets ${toPosix(relative(REPO_ROOT, dir))}/ (${String(names.length)} images)`);
    }
    return failed ? 1 : 0;
  } finally {
    casc.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`minimap: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exitCode = 1;
  },
);
