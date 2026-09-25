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
 * Local-set checks (--local [dir], default local-maps/): L0-L7 (lib/local-set.ts). With
 * --activate, a passing set gets local-maps/maps.manifest.json (which activates it); a failing set
 * has any existing manifest removed.
 *
 * Usage: pnpm maps:validate [--skip-tracking]
 *        pnpm tsx tools/maps/validate.ts [--questiedb-repo <dir>] [--commit <sha>] [--rows <file>] [--placeholder-dir <dir>]
 *          [--skip-tracking] [--local [dir]] [--activate] [--taxi-nodes <TaxiNodes.csv>] [--source <source.json>]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseGeometryFile } from '../../src/geo/geometry';
import { REPO_ROOT } from '../build/lib/fs';
import { parseArgs } from './lib/args';
import { placeholderChecks, type CheckResult } from './lib/checks';
import { GEOMETRY_FILE, NOTICE_FILE, PLACEHOLDER_DIR, ROWS_FILE } from './lib/constants';
import { headCommit, isTracked } from './lib/git';
import { lfBytes } from './lib/hash';
import { optionalPath, runPlaceholderBuild, toPosix } from './lib/inputs';
import { activate, deactivate, parseSetSource, validateLocalSet } from './lib/local-set';

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

function main(argv: readonly string[]): number {
  const args = parseArgs(argv, {
    values: ['--questiedb-repo', '--commit', '--rows', '--placeholder-dir', '--taxi-nodes', '--source'],
    flags: ['--skip-tracking', '--activate'],
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

  const wantsLocal = args.flags.has('--local') || args.values.has('--local') || args.flags.has('--activate');
  if (!wantsLocal) return placeholderOk ? 0 : 1;

  const localDir = resolve(REPO_ROOT, args.values.get('--local') ?? 'local-maps');
  const parsed = parseGeometryFile(JSON.parse(geometryText) as unknown);
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
  });
  console.log(`\nmaps validate: local set ${toPosix(relative(REPO_ROOT, localDir))}/ (build ${local.build ?? 'unknown'})`);
  console.log(format(local.checks));
  if (local.merge?.kind === 'merged') console.log(`maps validate: compatible, ${String(local.merge.added.length)} UiMap(s) added: ${local.merge.added.join(', ') || 'none'}`);
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

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`maps validate: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

