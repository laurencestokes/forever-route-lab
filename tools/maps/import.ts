/**
 * tools/maps import (docs/MAPS.md §5.2, §8; ARCHITECTURE §6; D-018).
 *
 * --placeholder (Milestone 2) builds the two committed files
 *   public/maps/placeholder/geometry.placeholder.json and public/maps/placeholder/NOTICE.md
 * from exactly two inputs, so any machine reproduces them byte for byte with no network request:
 *   - QuestieDB data/Forever/conversion.json, read as the LF git blob at the pinned commit from the
 *     checkout tools/questiedb/fetch.ts provides (default: upstream.json cachePath, .cache/questiedb),
 *     and checked against the SHA-256 tools/questiedb/upstream.json pins for it (lib/pin.ts); git
 *     runs with GIT_NO_LAZY_FETCH=1 (lib/git.ts);
 *   - the committed tools/maps/inputs/db2-rows-1.60.1.70009.json.
 * It reads no CSV and never contacts wago.tools (D-011). It writes under public/ only these two
 * files.
 *
 * --build <build> (the local pipeline from developer CSVs into local-maps/) is Milestone 3.
 *
 * Usage: pnpm maps:placeholder
 *        pnpm tsx tools/maps/import.ts --placeholder [--questiedb-repo <dir>] [--commit <sha>] [--rows <file>] [--out <dir>] [--check]
 *   --check  compare with the files on disk instead of writing them (exit 1 on a difference)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { REPO_ROOT } from '../build/lib/fs';
import { parseArgs } from './lib/args';
import { GEOMETRY_FILE, NOTICE_FILE, PLACEHOLDER_DIR, ROWS_FILE } from './lib/constants';
import { lfBytes } from './lib/hash';
import { optionalPath, runPlaceholderBuild, toPosix } from './lib/inputs';

function main(argv: readonly string[]): number {
  const args = parseArgs(argv, { values: ['--questiedb-repo', '--commit', '--rows', '--out', '--build'], flags: ['--placeholder', '--check'] });
  if (args.values.has('--build')) throw new Error('--build (local map sets from developer CSVs) arrives in Milestone 3; only --placeholder exists');
  if (!args.flags.has('--placeholder')) throw new Error('nothing to do: pass --placeholder');
  if (args.positional.length > 0) throw new Error(`unexpected argument ${args.positional.join(' ')}`);
  const started = performance.now();
  const build = runPlaceholderBuild({
    questiedbRepo: optionalPath(args.values.get('--questiedb-repo')),
    commit: args.values.get('--commit') ?? null,
    rowsFile: resolve(REPO_ROOT, args.values.get('--rows') ?? ROWS_FILE),
  });
  const outDir = resolve(REPO_ROOT, args.values.get('--out') ?? PLACEHOLDER_DIR);
  const files = [
    { path: join(outDir, GEOMETRY_FILE), text: build.geometryText },
    { path: join(outDir, NOTICE_FILE), text: build.noticeText },
  ];
  const elapsed = performance.now() - started;
  const rows = [...build.geometry.maps.values()].reduce((n, map) => n + map.assignments.length, 0);
  const summary = `${String(build.geometry.maps.size)} UiMaps, ${String(rows)} rows, frameHash ${build.frameHash}, contentHash ${build.contentHash}`;
  if (args.flags.has('--check')) {
    const stale = files.filter((file) => !existsSync(file.path) || lfBytes(readFileSync(file.path)).toString('utf8') !== file.text);
    for (const file of stale) console.error(`import: ${toPosix(relative(REPO_ROOT, file.path))} is not what the pinned inputs produce`);
    if (stale.length === 0) console.log(`import: placeholder up to date (${summary})`);
    return stale.length === 0 ? 0 : 1;
  }
  mkdirSync(outDir, { recursive: true });
  for (const file of files) {
    writeFileSync(file.path, file.text);
    console.log(`import: wrote ${toPosix(relative(REPO_ROOT, file.path))} (${String(Buffer.byteLength(file.text))} bytes)`);
  }
  console.log(`import: ${summary}; built in ${elapsed.toFixed(1)} ms`);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`import: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
