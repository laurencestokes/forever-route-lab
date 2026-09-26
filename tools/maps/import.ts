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
 * --build <build> (Milestone 3b, docs/MAPS.md §5.4 (a); terrain-navigation.md §15) reads `UiMap` and
 *   `UiMapAssignment` straight from the local Forever client through tools/casc (read-only,
 *   `.build.info` and `Data/` under WOW_INSTALL, pinned to CLIENT_PIN; <build> must be the pin's
 *   version) and writes the developer-local `local-maps/geometry.local.json` (rows
 *   `source: "local-db2"`, `"redistribution": "local-only"`). It first removes
 *   `local-maps/maps.manifest.json`, so the rebuilt set stays inactive until
 *   `validate.ts --activate` passes. It never writes under public/ (D-018). TACTTool and DBC2CSV
 *   are no longer needed for this step.
 *
 * Usage: pnpm maps:placeholder
 *        pnpm tsx tools/maps/import.ts --placeholder [--questiedb-repo <dir>] [--commit <sha>] [--rows <file>] [--out <dir>] [--check]
 *        pnpm tsx tools/maps/import.ts --build 1.60.1.70009 [--out <dir>] [--check]
 *   --check  compare with the files on disk instead of writing them (exit 1 on a difference)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { LocalCasc } from '../casc/casc';
import { resolveInstall } from '../casc/paths';
import { REPO_ROOT } from '../build/lib/fs';
import { parseArgs } from './lib/args';
import { readClientMapTables } from './lib/client-tables';
import { CLIENT_PIN, GEOMETRY_FILE, NOTICE_FILE, PLACEHOLDER_DIR, ROWS_FILE } from './lib/constants';
import { lfBytes } from './lib/hash';
import { optionalPath, runPlaceholderBuild, toPosix } from './lib/inputs';
import { formatJson } from './lib/json';
import { localGeometryFromClient } from './lib/local-build';
import { LOCAL_GEOMETRY_FILE, LOCAL_MANIFEST_FILE } from './lib/local-set';

const DEFAULT_LOCAL_DIR = 'local-maps';

/** --build: the local geometry from the client (never under public/, D-018). */
function localBuild(build: string, outOption: string | undefined, checkOnly: boolean): number {
  if (build !== CLIENT_PIN.version) throw new Error(`--build ${build}: the tool is pinned to ${CLIENT_PIN.product} ${CLIENT_PIN.version}`);
  const outDir = resolve(REPO_ROOT, outOption ?? DEFAULT_LOCAL_DIR);
  const publicDir = resolve(REPO_ROOT, 'public');
  if (outDir === publicDir || outDir.startsWith(publicDir + sep)) throw new Error('--build never writes under public/ (D-018): local sets live in local-maps/');
  const started = performance.now();
  const casc = LocalCasc.open({ install: resolveInstall(), product: CLIENT_PIN.product, pin: CLIENT_PIN });
  let text: string;
  let summary: string;
  try {
    const tables = readClientMapTables(casc);
    const geometry = localGeometryFromClient(tables, { product: casc.build.product, version: casc.build.version });
    text = formatJson(geometry);
    const maps = Object.keys(geometry['maps'] as object).length;
    summary = `${String(maps)} UiMaps, ${String(tables.assignments.length)} rows from ${casc.build.product} ${casc.build.version}`;
  } finally {
    casc.close();
  }
  const path = join(outDir, LOCAL_GEOMETRY_FILE);
  if (checkOnly) {
    const same = existsSync(path) && lfBytes(readFileSync(path)).toString('utf8') === text;
    if (same) console.log(`import: ${toPosix(relative(REPO_ROOT, path))} up to date (${summary})`);
    else console.error(`import: ${toPosix(relative(REPO_ROOT, path))} is not what the client produces`);
    return same ? 0 : 1;
  }
  mkdirSync(outDir, { recursive: true });
  const manifest = join(outDir, LOCAL_MANIFEST_FILE);
  if (existsSync(manifest)) {
    rmSync(manifest);
    console.log(`import: removed ${toPosix(relative(REPO_ROOT, manifest))}; the set is inactive until validate.ts --activate passes`);
  }
  writeFileSync(path, text);
  console.log(`import: wrote ${toPosix(relative(REPO_ROOT, path))} (${summary}; ${String(Buffer.byteLength(text))} bytes) in ${(performance.now() - started).toFixed(0)} ms`);
  return 0;
}

function main(argv: readonly string[]): number {
  const args = parseArgs(argv, { values: ['--questiedb-repo', '--commit', '--rows', '--out', '--build'], flags: ['--placeholder', '--check'] });
  if (args.positional.length > 0) throw new Error(`unexpected argument ${args.positional.join(' ')}`);
  const clientBuild = args.values.get('--build');
  if (clientBuild !== undefined) {
    if (args.flags.has('--placeholder')) throw new Error('--build and --placeholder are separate runs');
    for (const option of ['--questiedb-repo', '--commit', '--rows']) if (args.values.has(option)) throw new Error(`${option} applies to --placeholder only`);
    return localBuild(clientBuild, args.values.get('--out'), args.flags.has('--check'));
  }
  if (!args.flags.has('--placeholder')) throw new Error('nothing to do: pass --placeholder or --build <build>');
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
