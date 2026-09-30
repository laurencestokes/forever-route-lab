/**
 * tools/maps validate (docs/MAPS.md §5.5; ARCHITECTURE §6, §7.3; D-018).
 *
 * Placeholder checks (always; CI from Milestone 2). The placeholder is rebuilt in memory from the
 * pinned conversion.json LF blob and the committed rows file, then:
 *   R1  both committed files are byte-identical to a fresh import;
 *   P1  49 questiedb-conversion frames equal conversion.json target_bounds, ids and names;
 *   P2  12 db2-csv rows for 11 UiMaps equal the committed rows file and the MAPS.md §8.3 reference table;
 *   P3  every row records source and build; 60 UiMaps, 61 rows;
 *   P4  frameHash equals the recomputed canonical frame hash (and the §5.6 reference at its commit);
 *   P5  eraToForever is exactly 1412, 1423, 1433, 1453 with the conversion.json coefficients;
 *   P6  both files are tracked by git (skip with --skip-tracking before they are committed);
 *   P7  isotropy: (Ymax − Ymin)/(Xmax − Xmin) matches the art aspect within 0.2%;
 *   P8  contentHash equals the SHA-256 of canonicalGeometryContent (src/geo/content.ts), as infra/maps
 *       recomputes it at load.
 * No CSV and no network request is needed (D-011).
 *
 * Committed art checks (always; Milestone 3b, D-033): A1-A5 on public/maps/art/ (lib/art-checks.ts):
 * the manifest and NOTICE, every image's bytes, SHA-256 and WebP headers, the NOTICE regenerated
 * from the manifest, sizes and world rectangles against the placeholder, the deployed images (only
 * `DEPLOYED_ART_UIMAPS` since step ATL.10, D-042 O5; not checked for a folder named by --art-dir,
 * such as a `convert.ts --all` folder) and the 1.0 MB art budget. They need no client;
 * `convert.ts --check` is the rebuild from the client.
 *
 * Committed atlas checks (docs/research/map-atlas.md §7.5; D-042; step ATL.6): T1-T9 on
 * public/maps/atlas/ (lib/atlas-checks.ts): the manifest, index and NOTICE, every tile's bytes, hash
 * and header, index against manifest, atlasHash against src/geo, source hashes against the art
 * manifest's sources records, the atlas budget from tools/build/dist-requirements.json, the coverage
 * and lettering censuses, every placed zone and city at its top level, and the label list's pixel
 * hashes. They run once public/maps/atlas/manifest.json exists; `atlas.ts --check` is the rebuild.
 *
 * Committed minimap checks (docs/research/map-atlas.md Part II §24.4; D-049; step MM.6): M1-M11 on
 * public/maps/minimap/ (lib/minimap-checks.ts): the index, manifest, NOTICE and pack pointer; the
 * index against the manifest; the layout against the painted index and src/geo; the sources; the
 * budgets (from the manifest's records without the tiles); the pointer and tree hash (and, when the
 * pack is at hand, its SHA-256 and that its NOTICE and manifest are the committed ones); the relief
 * checks; the parameters and census gates. M6, M8 and M11 read the tiles: in a clone without the
 * pack (the tiles are never committed, D-049 O14) they are skipped, saying so, and do not fail. The
 * pack is looked for at .cache/minimap-pack/<asset> unless --minimap-pack names it. They run once
 * public/maps/minimap/manifest.json exists; `minimap.ts --check` is the rebuild from the client.
 * `--skip-minimap-tiles` does not read the tiles even when present (M6, M8 and M11 skipped, saying
 * so; the command-line test uses it, since minimap-files.test.ts runs them, MD-07). MT compares the
 * manifest's `tool.toolTreeHash` with the checkout's closure of tools/maps/minimap.ts (review finding
 * MD-01): a manifest the checkout's tool would not write fails until minimap.ts is rerun, before a
 * commit; `--skip-tool-tree` skips it (local work and tests only, as for data:validate and nav:validate).
 *
 * Local-set checks (--local [dir], default local-maps/): L0-L7 (lib/local-set.ts; L3 is the art,
 * lib/art.ts), plus L8 (an existing manifest still matches the files) in a report. With
 * --activate, a passing set gets local-maps/maps.manifest.json with its `art` section (which
 * activates it); a failing set has any existing manifest removed.
 *
 * Usage: pnpm maps:validate [--skip-tracking] [--skip-tool-tree] [--skip-minimap-tiles]
 *        pnpm tsx tools/maps/validate.ts [--questiedb-repo <dir>] [--commit <sha>] [--rows <file>] [--placeholder-dir <dir>]
 *          [--art-dir <dir>] [--atlas-dir <dir>] [--minimap-dir <dir>] [--minimap-pack <file>] [--skip-tracking] [--skip-tool-tree]
 *          [--skip-minimap-tiles] [--local [dir]] [--activate]
 *          [--taxi-nodes <TaxiNodes.csv>] [--source <source.json>]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseGeometryFile } from '../../src/geo/geometry';
import { REPO_ROOT } from '../build/lib/fs';
import { toolTreeHash } from '../terrain/lib/tool-tree';
import { parseArgs } from './lib/args';
import { committedArtChecks } from './lib/art-checks';
import { ART_DIR } from './lib/art-manifest';
import { atlasBudgetFrom, committedAtlasChecks } from './lib/atlas-checks';
import { readAtlasInputs } from './lib/atlas-inputs';
import { ATLAS_DIR, ATLAS_MANIFEST_FILE } from './lib/atlas-manifest';
import { placeholderChecks, type CheckResult } from './lib/checks';
import { DEPLOYED_ART_UIMAPS, GEOMETRY_FILE, NOTICE_FILE, PLACEHOLDER_DIR, ROWS_FILE } from './lib/constants';
import { headCommit, isTracked } from './lib/git';
import { lfBytes } from './lib/hash';
import { optionalPath, runPlaceholderBuild, toPosix } from './lib/inputs';
import { activate, deactivate, parseSetSource, validateLocalSet } from './lib/local-set';
import { minimapChecks } from './lib/minimap-checks';
import { readCommittedMinimapInputs } from './lib/minimap-inputs';
import { MINIMAP_DIR, MINIMAP_MANIFEST_FILE, MINIMAP_POINTER_FILE, MINIMAP_TILES_DIR, MINIMAP_TOOL_ENTRY } from './lib/minimap-params';

/** Where `tools/maps/minimap.ts --pack`, `pnpm maps:minimap:pack` and `pnpm maps:minimap:fetch` keep the pack. */
const MINIMAP_PACK_CACHE = '.cache/minimap-pack';

const readText = (path: string): string | null => (existsSync(path) ? lfBytes(readFileSync(path)).toString('utf8') : null);

function format(results: readonly CheckResult[]): string {
  const lines: string[] = [];
  for (const result of results) {
    const status = result.skipped !== null ? 'SKIP' : result.problems.length === 0 ? 'PASS' : 'FAIL';
    lines.push(`${status} ${result.id}  ${result.title}${result.skipped !== null ? ` (${result.skipped})` : ''}`);
    for (const problem of result.problems.slice(0, 20)) lines.push(`       - ${problem}`);
    if (result.problems.length > 20) lines.push(`       - … ${String(result.problems.length - 20)} more`);
  }
  return lines.join('\n');
}

/** The pack named by the folder's pointer, in the local cache, when it is there (M7 then checks it whole). */
function defaultPackFile(minimapDir: string): string | null {
  try {
    const pointer = JSON.parse(readFileSync(join(minimapDir, MINIMAP_POINTER_FILE), 'utf8')) as { readonly asset?: unknown };
    if (typeof pointer.asset !== 'string' || !/^[A-Za-z0-9._-]+$/.test(pointer.asset)) return null;
    const path = join(REPO_ROOT, MINIMAP_PACK_CACHE, pointer.asset);
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

/**
 * MT (review finding MD-01): the minimap manifest's tool tree hash is the checkout's closure of
 * `tools/maps/minimap.ts` (tools/terrain `toolTreeHash`), so the committed manifest, NOTICE, pointer
 * and pack are what the committed tool writes. It fails after any edit to a module in that closure
 * until `minimap.ts --pack` is rerun on the machine with the client (§23.4).
 */
function toolTreeCheck(manifest: Readonly<Record<string, unknown>> | null, skipped: boolean): CheckResult {
  const title = `the manifest's tool tree hash is the checkout's closure of ${MINIMAP_TOOL_ENTRY}`;
  if (skipped) return { id: 'MT', title, problems: [], skipped: '--skip-tool-tree' };
  const tool = manifest?.['tool'];
  const recorded = typeof tool === 'object' && tool !== null && !Array.isArray(tool) ? (tool as Readonly<Record<string, unknown>>)['toolTreeHash'] : undefined;
  if (typeof recorded !== 'string') return { id: 'MT', title, problems: ['the manifest records no tool.toolTreeHash'], skipped: null };
  const tree = toolTreeHash(REPO_ROOT, [join(REPO_ROOT, MINIMAP_TOOL_ENTRY)]);
  const problems = recorded === tree.hash ? [] : [`the manifest records ${recorded.slice(0, 12)}…, the checkout's is ${tree.hash.slice(0, 12)}…: rerun pnpm tsx tools/maps/minimap.ts --pack (needs the client), then --check --pack`];
  // a manifest re-derived without the client (minimap-remanifest.ts) names the checkout's tree but was not built by it
  const remanifest = typeof tool === 'object' && tool !== null && !Array.isArray(tool) ? (tool as Readonly<Record<string, unknown>>)['remanifest'] : undefined;
  if (remanifest !== undefined) {
    const from = typeof remanifest === 'object' && remanifest !== null && 'fromToolTreeHash' in remanifest ? String(remanifest.fromToolTreeHash).slice(0, 12) : '?';
    problems.push(`re-derived without the client (tool.remanifest, last client build ${from}…): run pnpm tsx tools/maps/minimap.ts --pack on the pinned client, then --check --pack (§23.4)`);
  }
  return { id: 'MT', title: `${title} (${String(tree.files.length)} files)`, problems, skipped: null };
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv, {
    values: ['--questiedb-repo', '--commit', '--rows', '--placeholder-dir', '--art-dir', '--atlas-dir', '--minimap-dir', '--minimap-pack', '--taxi-nodes', '--source'],
    flags: ['--skip-tracking', '--skip-tool-tree', '--skip-minimap-tiles', '--activate'],
    optionalValues: ['--local'],
  });
  if (args.positional.length > 0) throw new Error(`unexpected argument ${args.positional.join(' ')}`);
  const placeholderDir = resolve(REPO_ROOT, args.values.get('--placeholder-dir') ?? PLACEHOLDER_DIR);
  const expected = runPlaceholderBuild({
    questiedbRepo: optionalPath(args.values.get('--questiedb-repo')),
    commit: args.values.get('--commit') ?? null,
    rowsFile: resolve(REPO_ROOT, args.values.get('--rows') ?? ROWS_FILE),
  });
  const geometryPath = join(placeholderDir, GEOMETRY_FILE);
  const geometryText = readText(geometryPath);
  if (geometryText === null) throw new Error(`${toPosix(relative(REPO_ROOT, geometryPath))} is missing; run pnpm maps:placeholder`);
  const results: CheckResult[] = [...placeholderChecks({ geometryText, noticeText: readText(join(placeholderDir, NOTICE_FILE)), expected })];

  const tracked = [GEOMETRY_FILE, NOTICE_FILE].map((file) => toPosix(relative(REPO_ROOT, join(placeholderDir, file))));
  if (args.flags.has('--skip-tracking')) {
    results.push({ id: 'P6', title: 'both placeholder files are tracked by git', problems: [], skipped: '--skip-tracking' });
  } else {
    results.push({
      id: 'P6',
      title: 'both placeholder files are tracked by git (git ls-files --error-unmatch)',
      problems: tracked.filter((path) => !isTracked(REPO_ROOT, path)).map((path) => `${path} is not tracked`),
      skipped: null,
    });
  }
  const placeholderOk = results.every((result) => result.problems.length === 0);
  console.log(`maps validate: placeholder ${toPosix(relative(REPO_ROOT, placeholderDir))}/ (inputs: QuestieDB ${expected.conversion.targetBuild} frames, ${ROWS_FILE})`);
  console.log(format(results));

  const parsed = parseGeometryFile(JSON.parse(geometryText) as unknown);
  const artDir = resolve(REPO_ROOT, args.values.get('--art-dir') ?? ART_DIR);
  let artOk = false;
  if (parsed.ok) {
    const art = committedArtChecks(artDir, parsed.geometry, args.values.has('--art-dir') ? null : DEPLOYED_ART_UIMAPS);
    artOk = art.checks.every((result) => result.problems.length === 0 && result.skipped === null);
    console.log(`
maps validate: committed art ${toPosix(relative(REPO_ROOT, artDir))}/ (${String(art.manifest?.files.length ?? 0)} images)`);
    console.log(format(art.checks));
  } else console.error('maps validate: the committed art is checked against the placeholder, which does not parse');

  const atlasDir = resolve(REPO_ROOT, args.values.get('--atlas-dir') ?? ATLAS_DIR);
  let atlasOk = true;
  if (!existsSync(join(atlasDir, ATLAS_MANIFEST_FILE))) {
    console.log(`
maps validate: committed atlas ${toPosix(relative(REPO_ROOT, atlasDir))}/ not built yet (T1-T9 run once its manifest.json exists)`);
  } else if (parsed.ok) {
    const committed = readAtlasInputs(REPO_ROOT);
    const requirements = JSON.parse(readFileSync(join(REPO_ROOT, 'tools', 'build', 'dist-requirements.json'), 'utf8')) as unknown;
    const atlas = committedAtlasChecks({
      dir: atlasDir,
      geometry: parsed.geometry,
      layout: committed.layout,
      artSources: committed.artSources,
      labels: committed.labels,
      labelsSha256: committed.labelsFile.sha256,
      budget: atlasBudgetFrom(requirements),
    });
    atlasOk = atlas.checks.every((result) => result.problems.length === 0 && result.skipped === null);
    console.log(`
maps validate: committed atlas ${toPosix(relative(REPO_ROOT, atlasDir))}/ (${String(atlas.manifest?.files.length ?? 0)} files)`);
    console.log(format(atlas.checks));
  } else atlasOk = false;

  const minimapDir = resolve(REPO_ROOT, args.values.get('--minimap-dir') ?? MINIMAP_DIR);
  let minimapOk = true;
  if (!existsSync(join(minimapDir, MINIMAP_MANIFEST_FILE))) {
    console.log(`
maps validate: committed minimap ${toPosix(relative(REPO_ROOT, minimapDir))}/ not built (M1-M11 run once its manifest.json exists)`);
  } else {
    const started = performance.now();
    const committed = await readCommittedMinimapInputs(REPO_ROOT);
    const paintedIndex = join(resolve(REPO_ROOT, args.values.get('--atlas-dir') ?? ATLAS_DIR), 'index.json');
    const packArg = args.values.get('--minimap-pack');
    const packFile = packArg === undefined ? defaultPackFile(minimapDir) : resolve(REPO_ROOT, packArg);
    const minimap = await minimapChecks({
      dir: minimapDir,
      layout: committed.layout,
      geometry: committed.geometry,
      paintedIndex: existsSync(paintedIndex) ? (JSON.parse(lfBytes(readFileSync(paintedIndex)).toString('utf8')) as unknown) : null,
      reliefs: committed.reliefs,
      packFile,
      ...(args.flags.has('--skip-minimap-tiles') ? { skipTiles: '--skip-minimap-tiles (minimap-files.test.ts reads them)' } : {}),
    });
    const checks: CheckResult[] = [...minimap.checks, toolTreeCheck(minimap.manifest?.raw ?? null, args.flags.has('--skip-tool-tree'))];
    // a skipped check is reported, not failed: M6, M8 and M11 need the tiles, which a clone lacks (§23.4)
    minimapOk = checks.every((result) => result.problems.length === 0);
    const tiles = `${String(minimap.tilesPresent)} of ${String(minimap.manifest?.files.filter((f) => f.path.startsWith(`${MINIMAP_TILES_DIR}/`)).length ?? 0)} tiles present`;
    const pack = packFile === null ? 'the pack not at hand' : existsSync(packFile) ? `pack ${toPosix(relative(REPO_ROOT, packFile))}` : `pack ${toPosix(relative(REPO_ROOT, packFile))} missing`;
    console.log(`
maps validate: committed minimap ${toPosix(relative(REPO_ROOT, minimapDir))}/ (${tiles}; ${pack}; ${((performance.now() - started) / 1000).toFixed(1)} s)`);
    console.log(format(checks));
    if (packArg !== undefined && packFile !== null && !existsSync(packFile)) {
      console.error(`maps validate: --minimap-pack ${packArg} does not exist`);
      minimapOk = false;
    }
    if (minimap.tilesPresent === 0 && !args.flags.has('--skip-minimap-tiles')) {
      console.warn(`WARNING: maps validate: no minimap tiles under ${toPosix(relative(REPO_ROOT, minimapDir))}/${MINIMAP_TILES_DIR}/ (the pack is not fetched; pnpm maps:minimap:fetch): M6, M8 and M11 were skipped`);
    }
  }

  const wantsLocal = args.flags.has('--local') || args.values.has('--local') || args.flags.has('--activate');
  if (!wantsLocal) return placeholderOk && artOk && atlasOk && minimapOk ? 0 : 1;

  const localDir = resolve(REPO_ROOT, args.values.get('--local') ?? 'local-maps');
  if (!parsed.ok || !placeholderOk) {
    console.error('maps validate: the local set is checked against the committed placeholder, which must pass first');
    if (args.flags.has('--activate') && deactivate(localDir)) console.error('maps validate: removed the existing maps.manifest.json (set inactive)');
    return 1;
  }
  const taxiPath = args.values.get('--taxi-nodes');
  const local = validateLocalSet({
    dir: localDir,
    committed: parsed.geometry,
    committedFrameHash: expected.frameHash,
    taxiNodesCsv: taxiPath === undefined ? null : readFileSync(resolve(REPO_ROOT, taxiPath), 'utf8'),
    // Activation rewrites the manifest, so only a report compares the existing one (L8).
    activeManifest: args.flags.has('--activate') ? 'ignore' : 'check',
  });
  console.log(`\nmaps validate: local set ${toPosix(relative(REPO_ROOT, localDir))}/ (build ${local.build ?? 'unknown'})`);
  console.log(format(local.checks));
  if (local.merge?.kind === 'merged') console.log(`maps validate: compatible, ${String(local.merge.added.length)} UiMap(s) added: ${local.merge.added.join(', ') || 'none'}`);
  if (local.art !== null) console.log(`maps validate: art for ${String(Object.keys(local.art).length)} UiMap(s): ${Object.keys(local.art).join(', ') || 'none'}`);
  if (!args.flags.has('--activate')) return local.passed ? 0 : 1;

  if (!local.passed || local.build === null || local.product === null) {
    if (deactivate(localDir)) console.error('maps validate: removed the existing maps.manifest.json (set inactive)');
    console.error('maps validate: not activated');
    return 1;
  }
  const sourcePath = resolve(REPO_ROOT, args.values.get('--source') ?? join('assets-source', 'maps', local.product, local.build, 'source.json'));
  if (!existsSync(sourcePath)) throw new Error(`${toPosix(relative(REPO_ROOT, sourcePath))} is missing (docs/MAPS.md §5.2 source.json); not activated`);
  const manifest = activate(localDir, local, {
    source: parseSetSource(readFileSync(sourcePath, 'utf8')),
    repoCommit: headCommit(REPO_ROOT),
    nodeMajor: Number(process.versions.node.split('.')[0]),
  });
  console.log(`maps validate: activated, wrote ${toPosix(relative(REPO_ROOT, manifest))}`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`maps validate: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);

