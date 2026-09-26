/**
 * tools/terrain byproducts (terrain-navigation.md §13; D-032; step 3b.7).
 *
 * Builds the committed terrain map byproducts of both continents from the local Forever client:
 * `public/maps/terrain/<mapId>/zones.json` (zone outline arcs), `coast.json` (coastline arcs) and
 * `relief.png` (4-bit shaded relief at 16.7 yd per pixel), with `manifest.json` (pin, build, tool
 * tree hash, parameters, per-map input hashes, per-file SHA-256 and world rectangle) and
 * `NOTICE.md`. The full per-map input lists (FileDataID, CKey) and timings go to the gitignored
 * `generated/terrain-report.json`.
 *
 * Client access: tools/casc only (read-only, `.build.info` and `Data/` under WOW_INSTALL), pinned
 * to `tools/terrain/build.json` `pin`; the maps and their WDTs are build.json's `maps`, checked
 * against `Map.WdtFileDataID`. Nothing is fetched, and no client file is written anywhere.
 *
 * Usage: pnpm tsx tools/terrain/byproducts.ts [--out <dir>] [--report <file>] [--check]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { LocalCasc } from '../casc/casc';
import { readDb2 } from '../casc/db2';
import { DB2, type Db2Table } from '../casc/layouts';
import { resolveInstall } from '../casc/paths';
import { gzipSize } from '../build/lib/audit';
import { formatBytes } from '../build/lib/fs';
import { buildTerrain, TERRAIN_BUDGET_GZIP_BYTES, TERRAIN_DIR, TERRAIN_MANIFEST_FILE, TERRAIN_NOTICE_FILE, type TableInput, type TerrainBuild, type WorldMap } from './lib/byproducts/build';
import { hazardLiquidTypes } from './lib/formats/liquid';
import { toolTreeHash } from './lib/tool-tree';
import { areaParents } from './lib/zones';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ENTRY = fileURLToPath(import.meta.url);
const DEFAULT_REPORT = 'generated/terrain-report.json';
const toPosix = (path: string): string => path.split('\\').join('/');

type Json = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The pin and the world maps from tools/terrain/build.json (owned by the navigation build, read here only). */
function readBuildJson(): { readonly pin: { product: string; version: string; buildKey: string }; readonly maps: readonly WorldMap[] } {
  const raw = JSON.parse(readFileSync(join(REPO_ROOT, 'tools', 'terrain', 'build.json'), 'utf8')) as unknown;
  const pin = isRecord(raw) ? raw['pin'] : undefined;
  const maps = isRecord(raw) ? raw['maps'] : undefined;
  if (!isRecord(pin) || typeof pin['product'] !== 'string' || typeof pin['version'] !== 'string' || typeof pin['buildKey'] !== 'string' || !Array.isArray(maps)) {
    throw new Error('tools/terrain/build.json needs "pin" { product, version, buildKey } and "maps"');
  }
  return {
    pin: { product: pin['product'], version: pin['version'], buildKey: pin['buildKey'] },
    maps: maps.map((m: unknown) => {
      if (!isRecord(m) || typeof m['id'] !== 'number' || typeof m['name'] !== 'string' || typeof m['wdtFileDataId'] !== 'number') throw new Error('build.json maps[] needs id, name, wdtFileDataId');
      return { mapId: m['id'], name: m['name'], wdtFileDataId: m['wdtFileDataId'] };
    }),
  };
}

function tableInput(casc: LocalCasc, name: string, table: Db2Table, rows: number): TableInput {
  const ckey = casc.ckeyOf(table.fileDataId);
  if (ckey === null) throw new Error(`${name} is not in the root manifest`);
  return { table: name, fileDataId: table.fileDataId, ckey, rows };
}

function outputs(build: TerrainBuild): readonly { readonly name: string; readonly bytes: Buffer }[] {
  return [
    ...build.maps.flatMap((m) => m.files.map((f) => ({ name: f.path, bytes: f.bytes }))),
    { name: TERRAIN_MANIFEST_FILE, bytes: Buffer.from(build.manifestText) },
    { name: TERRAIN_NOTICE_FILE, bytes: Buffer.from(build.noticeText) },
  ];
}

function main(argv: readonly string[]): number {
  const known = new Set(['--out', '--report', '--check']);
  for (const arg of argv) if (arg.startsWith('--') && !known.has(arg)) throw new Error(`unknown option ${arg}`);
  const valueOf = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    if (i < 0) return undefined;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`);
    return value;
  };
  const outDir = resolve(REPO_ROOT, valueOf('--out') ?? TERRAIN_DIR);
  const reportPath = resolve(REPO_ROOT, valueOf('--report') ?? DEFAULT_REPORT);
  const checkOnly = argv.includes('--check');
  const config = readBuildJson();
  const started = performance.now();
  const casc = LocalCasc.open({ install: resolveInstall(), product: config.pin.product, pin: config.pin });
  let build: TerrainBuild;
  try {
    const areas = readDb2(casc, DB2.AreaTable);
    const liquids = readDb2(casc, DB2.LiquidType, { requireComplete: true });
    const mapTable = readDb2(casc, DB2.Map);
    for (const m of config.maps) {
      const wdt = mapTable.byId.get(m.mapId)?.num('WdtFileDataID');
      if (wdt !== m.wdtFileDataId) throw new Error(`build.json names WDT ${String(m.wdtFileDataId)} for map ${String(m.mapId)}, Map.WdtFileDataID says ${String(wdt)}`);
    }
    const tables = [tableInput(casc, 'AreaTable', DB2.AreaTable, areas.rows.length), tableInput(casc, 'LiquidType', DB2.LiquidType, liquids.rows.length), tableInput(casc, 'Map', DB2.Map, mapTable.rows.length)].sort(
      (a, b) => a.fileDataId - b.fileDataId,
    );
    const tree = toolTreeHash(REPO_ROOT, [ENTRY]);
    build = buildTerrain(
      config.maps,
      {
        parents: areaParents(areas.rows.map((r) => ({ id: r.id, parent: r.num('ParentAreaID') }))),
        hazard: hazardLiquidTypes(liquids.rows.map((r) => ({ id: r.id, soundBank: r.num('SoundBank') }))),
        tables,
        read: (id) => {
          const file = casc.file(id);
          return { data: file.data, ckey: file.ckey };
        },
      },
      {
        client: { product: casc.build.product, version: casc.build.version, buildKey: casc.build.buildKey },
        toolTrees: { trees: { 'tools/terrain/byproducts.ts': tree.hash }, method: `module closure of tools/terrain/byproducts.ts (${String(tree.files.length)} files, tools/terrain/lib/tool-tree.ts)` },
        zlib: process.versions.zlib,
      },
    );
  } finally {
    casc.close();
  }
  const elapsed = performance.now() - started;
  const all = outputs(build);
  const gzip = all.reduce((sum, o) => sum + gzipSize(o.bytes), 0);
  const report = {
    tool: 'tools/terrain byproducts',
    client: config.pin,
    elapsedMs: Math.round(elapsed),
    budget: { gzipBytes: TERRAIN_BUDGET_GZIP_BYTES, measuredGzipBytes: gzip },
    files: all.map((o) => ({ path: o.name, bytes: o.bytes.length, gzipBytes: gzipSize(o.bytes) })),
    maps: build.maps.map((m) => ({ ...m.entry, inputs: m.inputs.map((i) => [i.fileDataId, i.ckey]) })),
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 1)}\n`);
  const summary = `${String(all.length)} files, ${formatBytes(gzip)} gzip-6 (${(100 * gzip / TERRAIN_BUDGET_GZIP_BYTES).toFixed(1)}% of the ${formatBytes(TERRAIN_BUDGET_GZIP_BYTES)} terrain budget)`;
  if (checkOnly) {
    const problems: string[] = [];
    for (const o of all) {
      const path = join(outDir, o.name);
      if (!existsSync(path)) problems.push(`${o.name}: missing`);
      else if (!readFileSync(path).equals(o.bytes)) problems.push(`${o.name}: differs`);
    }
    for (const p of problems) console.error(`byproducts: ${p}`);
    if (problems.length === 0) console.log(`byproducts: ${toPosix(relative(REPO_ROOT, outDir))} is up to date: ${summary}`);
    return problems.length === 0 ? 0 : 1;
  }
  if (gzip > TERRAIN_BUDGET_GZIP_BYTES) throw new Error(`the byproducts are ${formatBytes(gzip)} gzip-6, over the terrain budget (D-034 item 4); nothing written`);
  for (const o of all) {
    mkdirSync(dirname(join(outDir, o.name)), { recursive: true });
    writeFileSync(join(outDir, o.name), o.bytes);
  }
  const expected = new Set(all.map((o) => toPosix(o.name)));
  const stray: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === '' ? name.name : `${prefix}/${name.name}`;
      if (name.isDirectory()) walk(join(dir, name.name), rel);
      else if (!expected.has(rel)) stray.push(rel);
    }
  };
  walk(outDir, '');
  for (const s of stray) console.warn(`byproducts: ${s} is not a byproduct of this build; remove it`);
  console.log(`byproducts: wrote ${toPosix(relative(REPO_ROOT, outDir))}: ${summary}; built in ${(elapsed / 1000).toFixed(1)} s`);
  for (const o of all) console.log(`  ${o.name.padEnd(18)} ${formatBytes(o.bytes.length).padStart(10)}  gzip ${formatBytes(gzipSize(o.bytes)).padStart(10)}`);
  return stray.length === 0 ? 0 : 1;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`byproducts: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
