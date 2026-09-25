/**
 * Regenerates tools/maps/inputs/db2-rows-1.60.1.70009.json from the two research CSVs
 * (docs/MAPS.md §8.3 "Writing the rows file"). The committed file was written once with this
 * script in Milestone 2; nothing else needs the CSVs, and the placeholder is reproducible without
 * them (import.ts reads only the committed rows file and the pinned conversion.json).
 *
 * The CSVs are local research files (UiMapAssignment_1.60.1.70009.csv and UiMap_1.60.1.70009.csv,
 * fetched from wago.tools on 2026-09-25 as individual requests during research). This script never
 * downloads anything (D-011). If they are missing, use a developer-local extraction at the same
 * build instead (MAPS.md §8.3 step 3); its bytes differ, so it needs a new inventory entry and
 * owner review, not this script.
 *
 * Checks: both CSV SHA-256 values against the MAPS.md §8.3 inventory, row counts, columns by name,
 * the 12 assignment IDs, the 12 raw lines' hash, the §8.3 reference table, and (when the pinned
 * QuestieDB checkout is available) that the other 49 rows are exactly the conversion.json UiMaps.
 *
 * Usage: pnpm tsx tools/maps/lib/make-db2-rows.ts [--csv-dir <dir>] [--questiedb-repo <dir>] [--commit <sha>] [--check]
 *   --check  compare with the committed file instead of writing it (exit 1 on a difference)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO_ROOT } from '../../build/lib/fs';
import { parseArgs } from './args';
import { CONVERSION_PATH, DEFAULT_RESEARCH_CSV_DIR, RESEARCH_CSVS, ROWS_FILE } from './constants';
import { parseConversion } from './conversion';
import { buildDb2RowsFile, rowsFileJson } from './db2-rows';
import { readGitBlob, resolveCommit } from './git';
import { lfBytes } from './hash';
import { formatJson } from './json';
import { resolvePin } from './pin';

function frameUiMapIds(repoOption: string | undefined, commit: string | null): { readonly repo: string; readonly ids: readonly number[] | null } {
  const pin = resolvePin(REPO_ROOT, commit);
  const repo = resolve(REPO_ROOT, repoOption ?? pin.cachePath);
  if (!existsSync(repo)) return { repo, ids: null };
  const sha = resolveCommit(repo, pin.commit);
  return { repo, ids: parseConversion(JSON.parse(readGitBlob(repo, sha, CONVERSION_PATH).toString('utf8')) as unknown).transforms.map((t) => t.uiMapId) };
}

function main(argv: readonly string[]): number {
  const args = parseArgs(argv, { values: ['--csv-dir', '--questiedb-repo', '--commit'], flags: ['--check'] });
  const csvDir = resolve(REPO_ROOT, args.values.get('--csv-dir') ?? DEFAULT_RESEARCH_CSV_DIR);
  const read = (file: string): Buffer => {
    const path = join(csvDir, file);
    if (!existsSync(path)) throw new Error(`${file} not found in ${csvDir}; see docs/MAPS.md §8.3 step 3 (this script never downloads it, D-011)`);
    return readFileSync(path);
  };
  const { repo, ids: frame } = frameUiMapIds(args.values.get('--questiedb-repo'), args.values.get('--commit') ?? null);
  const file = buildDb2RowsFile({ UiMapAssignment: read(RESEARCH_CSVS.UiMapAssignment.file), UiMap: read(RESEARCH_CSVS.UiMap.file) }, frame);
  const text = formatJson(rowsFileJson(file));
  const out = join(REPO_ROOT, ROWS_FILE);
  if (frame === null) console.warn(`make-db2-rows: ${repo} not found; skipped the check that the other 49 rows are the conversion.json UiMaps`);
  if (args.flags.has('--check')) {
    const same = existsSync(out) && lfBytes(readFileSync(out)).toString('utf8') === text;
    console.log(same ? `make-db2-rows: ${ROWS_FILE} is up to date` : `make-db2-rows: ${ROWS_FILE} differs from the CSVs`);
    return same ? 0 : 1;
  }
  writeFileSync(out, text);
  console.log(`make-db2-rows: wrote ${ROWS_FILE} (${String(file.assignments.length)} rows, ${String(file.uiMaps.length)} UiMaps, ${String(Buffer.byteLength(text))} bytes)`);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`make-db2-rows: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
