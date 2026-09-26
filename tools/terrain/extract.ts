/**
 * Builds the committed navigation data (terrain-navigation.md §3, §5, §14; D-028, D-030):
 * stage 1 per block in parallel worker processes, stage 2 per map, then `public/nav/`.
 *
 * Usage: pnpm nav:extract [--check] [--parts N] [--reuse-stage1] [--maps 0,1 --out DIR]
 *
 * - The client comes from WOW_INSTALL (default: the Battle.net path); only `.build.info` and
 *   `Data/` are read, read-only, and any build other than the pin in build.json is refused (G1).
 *   Every input is MD5-checked and a missing or encrypted one stops the build (G2).
 * - `--check` rebuilds everything and compares every output byte with `public/nav/` without
 *   writing it (G3; a manual gate like `data:check`).
 * - `--parts N`: worker processes for stage 1 (default: available cores − 2, at most 8).
 * - `--reuse-stage1`: reuse `.cache/terrain/stage1/` when it was built from the same pin, settings
 *   and stage-1 code (for stage-2 work: connectors, passages, the dataset). A full build never
 *   uses it.
 * - `--maps` builds a subset; it needs `--out` (public/nav always holds every map).
 * - Timings, per-block statistics, the full input lists and the census rows go to
 *   `generated/terrain-nav-report.json` (gitignored).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { censusHash, type Census } from './lib/census';
import { openClient, readMapWdt, readTables } from './lib/client';
import { observedRows, parseConnectors } from './lib/connectors';
import { decodeBlock, encodeBlock, polygonCount, type NavBlock } from './lib/encode';
import { linkSymmetry, unmatchedPct } from './lib/link';
import { jsonText, navRevision, revisionFiles, seamEntry, sha256, type BlockEntry, type MapEntry, type NavManifest } from './lib/manifest';
import { encodeMapFile } from './lib/mapfile';
import { navNotice } from './lib/notice';
import { parsePassages } from './lib/passages';
import { recastModuleInfo } from './lib/recast';
import { blockName, derive, readBuildConfig, REPO_ROOT, TERRAIN_DIR, type BuildConfig, type Derived } from './lib/settings';
import { gridOf } from './lib/stage1';
import { runStage2, type Stage2Output } from './lib/stage2';
import { lfSha256, loadSpawns, type Spawn } from './lib/spawns';
import { toolTreeHash } from './lib/tool-tree';
import type { BlockDone } from './lib/worker';
import { runStage1, WORKER } from './lib/parallel';
import { topZone } from './lib/zones';
import { DB2 } from '../casc/layouts';

const EXTRACT = join(TERRAIN_DIR, 'extract.ts');
const INPUTS = join(TERRAIN_DIR, 'inputs');
const NAV_DIR = join(REPO_ROOT, 'public', 'nav');
const STAGE1_DIR = join(REPO_ROOT, '.cache', 'terrain', 'stage1');
const CHECK_STAGE1_DIR = join(REPO_ROOT, '.cache', 'terrain', 'check-stage1');
const REPORT = join(REPO_ROOT, 'generated', 'terrain-nav-report.json');

interface Options {
  check: boolean;
  parts: number;
  reuseStage1: boolean;
  maps: number[] | null;
  out: string | null;
}

function parseArgs(argv: readonly string[]): Options {
  const o: Options = { check: false, parts: Math.max(1, Math.min(8, availableParallelism() - 2)), reuseStage1: false, maps: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const value = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${String(a)} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--check') o.check = true;
    else if (a === '--reuse-stage1') o.reuseStage1 = true;
    else if (a === '--parts') o.parts = Number(value());
    else if (a === '--maps') o.maps = value().split(',').map(Number);
    else if (a === '--out') o.out = value();
    else throw new Error(`unknown option ${String(a)}`);
  }
  if (!Number.isInteger(o.parts) || o.parts < 1) throw new Error('--parts needs a positive integer');
  if (o.maps !== null && o.out === null && !o.check) throw new Error('--maps needs --out: public/nav always holds every map');
  return o;
}

const log = (msg: string): void => {
  console.log(`[nav] ${msg}`);
};

interface Stage1Cache {
  readonly pin: BuildConfig['pin'];
  readonly settings: BuildConfig['settings'];
  readonly stage1ToolHash: string;
  readonly blocks: readonly BlockDone[];
}

function readJson(path: string): { value: unknown; sha256: string } {
  const bytes = readFileSync(path);
  return { value: JSON.parse(bytes.toString('utf8')) as unknown, sha256: lfSha256(bytes) };
}

const round = (v: number, digits = 3): number => Number(v.toFixed(digits));

async function main(argv: readonly string[]): Promise<number> {
  const opt = parseArgs(argv);
  const t0 = performance.now();
  const config = readBuildConfig();
  const d: Derived = derive(config.settings);
  const grid = gridOf(d);
  const maps = opt.maps ?? config.maps.map((m) => m.id);
  for (const id of maps) if (!config.maps.some((m) => m.id === id)) throw new Error(`map ${String(id)} is not in build.json`);
  const recast = recastModuleInfo();
  if (recast.version !== config.recastNavigation) throw new Error(`recast-navigation ${recast.version} is installed, build.json pins ${config.recastNavigation}`);
  const tool = toolTreeHash(REPO_ROOT, [EXTRACT, WORKER]);
  const stage1Tool = toolTreeHash(REPO_ROOT, [WORKER]);

  // the client: pin (G1), tables, WDTs
  const casc = openClient(config);
  const tables = readTables(casc);
  const wdts = new Map<number, ReturnType<typeof readMapWdt>>();
  for (const id of maps) wdts.set(id, readMapWdt(tables, id, config.maps.find((m) => m.id === id)?.wdtFileDataId ?? 0));
  log(`client ${casc.build.product} ${casc.build.version} (${casc.build.buildKey}), tool tree ${tool.hash.slice(0, 12)} (${String(tool.files.length)} files)`);

  // stage-2 inputs
  const connectorsIn = readJson(join(INPUTS, 'connectors.json'));
  const passagesIn = readJson(join(INPUTS, 'passages.json'));
  const reviewedIn = readJson(join(INPUTS, 'census-reviewed.json'));
  const connectors = parseConnectors(connectorsIn.value);
  const passages = parsePassages(passagesIn.value);
  const dataset = loadSpawns(REPO_ROOT);
  const hintOf = (s: Spawn): number => topZone(tables.parents, s.areaKey);

  // stage 1
  const stage1Dir = opt.check ? CHECK_STAGE1_DIR : STAGE1_DIR;
  let stage1: BlockDone[];
  const cachePath = join(stage1Dir, 'stage1.json');
  const t1 = performance.now();
  if (opt.reuseStage1 && !opt.check) {
    const cache = JSON.parse(readFileSync(cachePath, 'utf8')) as Stage1Cache;
    if (JSON.stringify(cache.pin) !== JSON.stringify(config.pin) || JSON.stringify(cache.settings) !== JSON.stringify(config.settings) || cache.stage1ToolHash !== stage1Tool.hash) {
      throw new Error('the stage-1 cache was built from another pin, settings or stage-1 code; run without --reuse-stage1');
    }
    stage1 = cache.blocks.filter((b) => maps.includes(b.mapId));
    log(`stage 1 reused from ${relative(REPO_ROOT, stage1Dir)} (${String(stage1.length)} blocks)`);
  } else {
    const present = new Map([...wdts].map(([id, w]) => [id, w.present]));
    stage1 = await runStage1(config, maps, present, stage1Dir, opt.parts);
    writeFileSync(cachePath, JSON.stringify({ pin: config.pin, settings: config.settings, stage1ToolHash: stage1Tool.hash, blocks: stage1 } satisfies Stage1Cache));
  }
  const stage1Ms = performance.now() - t1;

  // stage 2 per map
  const outputs = new Map<string, Buffer>();
  const mapEntries: MapEntry[] = [];
  const report: Record<string, unknown> = {};
  const mapReports: Record<string, unknown>[] = [];
  const allCensus: Census[] = [];
  const stage2Ms: Record<string, number> = {};
  for (const mapId of maps) {
    const t2 = performance.now();
    const name = config.maps.find((m) => m.id === mapId)?.name ?? String(mapId);
    const done = stage1.filter((b) => b.mapId === mapId && b.sha256 !== null);
    const blocks: NavBlock[] = done.map((b) => {
      const bytes = readFileSync(join(stage1Dir, String(mapId), `${blockName(b.row0, b.col0)}.bin`));
      if (sha256(bytes) !== b.sha256) throw new Error(`stage-1 block ${String(mapId)}/${blockName(b.row0, b.col0)} does not match its record`);
      return decodeBlock(bytes, grid, `stage-1 ${String(mapId)}/${blockName(b.row0, b.col0)}`);
    });
    const out: Stage2Output = runStage2({ mapId, derived: d, stage2: config.stage2, blocks, spawns: dataset.spawns, hintOf, connectors, passages, geometry: dataset.geometry });
    const inputOf = new Map(done.map((b) => [blockName(b.row0, b.col0), b]));
    const blockEntries: BlockEntry[] = [];
    let gzip = 0;
    let raw = 0;
    const gzips: number[] = [];
    for (const b of out.blocks) {
      const bytes = encodeBlock(b, grid);
      const path = `${String(mapId)}/${blockName(b.row0, b.col0)}.bin`;
      outputs.set(path, bytes);
      const g = gzipSync(bytes, { level: 6 }).length;
      gzip += g;
      raw += bytes.length;
      gzips.push(g);
      const s1 = inputOf.get(blockName(b.row0, b.col0));
      if (s1 === undefined) throw new Error(`no stage-1 record for ${path}`);
      blockEntries.push({ path, row0: b.row0, col0: b.col0, polygons: polygonCount(b), bytes: bytes.length, sha256: sha256(bytes), inputHash: s1.inputHash });
    }
    const mapBytes = encodeMapFile(out.mapFile);
    const mapPath = `${String(mapId)}/map.bin`;
    outputs.set(mapPath, mapBytes);
    const hintRollup: Record<string, number> = {};
    for (const s of dataset.spawns) {
      if (s.mapId !== mapId) continue;
      const z = hintOf(s);
      if (z !== s.areaKey) hintRollup[String(s.areaKey)] = z;
    }
    const c = out.census;
    allCensus.push(c);
    mapEntries.push({
      mapId,
      name,
      wdt: wdts.get(mapId)?.input ?? { fileDataId: 0, ckey: '' },
      polygons: out.mesh.n,
      components: out.comps.sizes.length,
      mainPolygons: out.comps.sizes[0] ?? 0,
      mapFile: { path: mapPath, bytes: mapBytes.length, sha256: sha256(mapBytes) },
      blocks: blockEntries,
      connectorsApplied: out.connectors.map((x) => x.id),
      passagesTagged: out.passageTags.map((t) => ({ id: passages.passages[t.passage]?.id ?? String(t.passage), polygons: t.polygons.length })),
      hintRollup,
      census: {
        spawns: c.counts.spawns,
        main: c.counts.main,
        offMain: c.counts.offMain,
        none: c.counts.none,
        ambiguous: c.counts.ambiguous,
        overOffMainFloor: c.counts.overOffMainFloor,
        offMainComponents: c.offMain.length,
        overOffMainFloorComponents: c.overOffMainFloor.length,
        sha256: censusHash(c),
      },
      seams: { stage1: seamEntry(out.pre.seams), final: seamEntry(out.mesh.seams) },
      waterSplits: out.water.splits.map((x) => ({ fullPolygons: x.fullPolygons, parts: x.parts.map((q) => ({ polygons: q.polygons, zone: q.zone, centroid: q.centroid })) })),
    });
    const sym = linkSymmetry(out.mesh);
    gzips.sort((a, b) => a - b);
    const mapGzip = gzipSync(mapBytes, { level: 6 }).length;
    stage2Ms[String(mapId)] = performance.now() - t2;
    mapReports.push({
      mapId,
      name,
      blocks: out.blocks.length,
      stage1Blocks: stage1.filter((b) => b.mapId === mapId).length,
      polygons: out.mesh.n,
      components: out.comps.sizes.length,
      largestComponents: out.comps.sizes.slice(0, 8),
      raw,
      gzip6: gzip,
      gzip6MaxBlock: gzips[gzips.length - 1] ?? 0,
      gzip6MedianBlock: gzips[Math.floor(gzips.length / 2)] ?? 0,
      mapBin: { bytes: mapBytes.length, gzip6: mapGzip },
      pre: out.pre,
      water: { swimPolygons: out.water.swimPolygons, droppedSwimPolygons: out.water.droppedSwimPolygons, splits: out.water.splits },
      prune: out.prune,
      seams: {
        innerUnmatchedPct: round(unmatchedPct(out.mesh.seams.inner), 4),
        blockUnmatchedPct: round(unmatchedPct(out.mesh.seams.block), 4),
        midUnmatchedPct: round(unmatchedPct(out.mesh.seams.mid), 4),
        innerLenYd: round(out.mesh.seams.inner.len, 1),
        blockLenYd: round(out.mesh.seams.block.len, 1),
      },
      symmetry: sym,
      census: { counts: c.counts, offMain: c.offMain, overOffMainFloor: c.overOffMainFloor, unsnapped: c.unsnapped, zones: c.zones },
      stage2Ms: out.ms,
    });
    log(`stage 2 map ${String(mapId)} ${name}: ${String(out.blocks.length)} blocks, ${String(out.mesh.n)} polygons, ${String(out.comps.sizes.length)} components, gzip6 ${String(gzip)} B + map.bin ${String(mapGzip)} B; census main ${String(c.counts.main)}, off-main ${String(c.counts.offMain)} in ${String(c.offMain.length)} components, none ${String(c.counts.none)} (${String(Math.round(stage2Ms[String(mapId)] ?? 0))} ms)`);
  }

  // connectors.json (observed rows), NOTICE, manifest
  const observed = jsonText({ schema: 1, kind: 'nav-connectors-observed', source: 'tools/terrain/inputs/connectors.json', connectors: observedRows(connectors) });
  outputs.set('connectors.json', Buffer.from(observed, 'utf8'));
  outputs.set('NOTICE.md', Buffer.from(navNotice(config, recast.version), 'utf8'));
  const tableNames = new Map<number, string>(Object.entries(DB2).map(([k, v]) => [v.fileDataId, k]));
  const manifest: NavManifest = {
    schema: 1,
    kind: 'nav-manifest',
    notice: 'NOTICE.md',
    navRevision: navRevision(revisionFiles(mapEntries)),
    format: { block: 'FRN3 v3 (attributes mode 3)', mapFile: 'FRNM v1' },
    pin: config.pin,
    client: {
      rootCKey: casc.buildConfig.rootCKey,
      encodingCKey: casc.buildConfig.encodingCKey,
      tables: tables.tableInputs.map((t) => ({ table: tableNames.get(t.fileDataId) ?? String(t.fileDataId), ...t })),
    },
    tool: { toolTreeHash: tool.hash, toolFiles: tool.files.length, nodeMajor: Number(process.versions.node.split('.')[0]), recastNavigation: recast },
    settings: config.settings,
    derived: { cellYd: d.cs, tileYd: d.tileYd, perAdt: d.perAdt, walkableHeightVoxels: d.walkableHeight, walkableClimbVoxels: d.walkableClimb, borderVoxels: d.border, minRegionAreaVoxels: d.minRegionArea, mergeRegionAreaVoxels: d.mergeRegionArea, maxErrorVoxels: d.maxError, maxEdgeLenVoxels: d.maxEdgeLen },
    stage2: {
      settings: config.stage2,
      dataset: dataset.inputs,
      censusReviewedSha256: reviewedIn.sha256,
      connectorsSha256: connectorsIn.sha256,
      passagesSha256: passagesIn.sha256,
    },
    connectors: connectors.connectors.map((c) => c.id),
    passages: passages.passages.map((p) => p.id),
    connectorsFile: { path: 'connectors.json', bytes: Buffer.byteLength(observed), sha256: sha256(observed) },
    maps: mapEntries,
  };
  outputs.set('manifest.json', Buffer.from(jsonText(manifest), 'utf8'));
  casc.close();

  // write or check
  const root = opt.out ?? NAV_DIR;
  let exit = 0;
  if (opt.check) {
    const problems: string[] = [];
    for (const [path, bytes] of [...outputs].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const file = join(NAV_DIR, path);
      if (!existsSync(file)) problems.push(`${path}: missing in public/nav`);
      else if (!readFileSync(file).equals(bytes)) problems.push(`${path}: differs`);
    }
    for (const mapId of maps) {
      const dir = join(NAV_DIR, String(mapId));
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) if (!outputs.has(`${String(mapId)}/${f}`)) problems.push(`${String(mapId)}/${f}: not produced by this build`);
    }
    if (problems.length > 0) {
      console.error(`[nav] --check: ${String(problems.length)} difference(s):\n  ${problems.slice(0, 50).join('\n  ')}`);
      exit = 1;
    } else log(`--check: ${String(outputs.size)} files identical to public/nav (navRevision ${manifest.navRevision})`);
  } else {
    for (const mapId of maps) {
      const dir = join(root, String(mapId));
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) if (f.endsWith('.bin') && !outputs.has(`${String(mapId)}/${f}`)) rmSync(join(dir, f));
    }
    for (const [path, bytes] of outputs) {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
    }
    log(`wrote ${String(outputs.size)} files to ${relative(REPO_ROOT, root) || root} (navRevision ${manifest.navRevision})`);
  }

  // report (gitignored)
  const totalGzip = [...outputs].filter(([p]) => p.endsWith('.bin')).reduce((s, [, b]) => s + gzipSync(b, { level: 6 }).length, 0);
  Object.assign(report, {
    $comment: 'Local build report of tools/terrain/extract.ts (gitignored): timings, per-block statistics, input lists, census rows.',
    client: casc.build,
    node: process.versions.node,
    parts: opt.parts,
    check: opt.check,
    reusedStage1: opt.reuseStage1 && !opt.check,
    wallMs: { stage1: Math.round(stage1Ms), stage2: Object.fromEntries(Object.entries(stage2Ms).map(([k, v]) => [k, Math.round(v)])), total: Math.round(performance.now() - t0) },
    stage1Cpu: {
      geometryMs: Math.round(stage1.reduce((s, b) => s + b.stats.geometryMs, 0)),
      recastMs: Math.round(stage1.reduce((s, b) => s + b.stats.recastMs, 0)),
      exportMs: Math.round(stage1.reduce((s, b) => s + b.stats.exportMs, 0)),
      slowestBlock: stage1.reduce((best, b) => (b.stats.geometryMs + b.stats.recastMs + b.stats.exportMs > best.ms ? { ms: Math.round(b.stats.geometryMs + b.stats.recastMs + b.stats.exportMs), block: `${String(b.mapId)}/${blockName(b.row0, b.col0)}` } : best), { ms: 0, block: '' }),
      maxRssMb: stage1.reduce((m, b) => Math.max(m, b.rssMb), 0),
      zoneFromTriangle: stage1.reduce((s, b) => s + b.stats.zoneFromTriangle, 0),
      polygonsKept: stage1.reduce((s, b) => s + b.stats.polygonsKept, 0),
      clampedTiles: stage1.reduce((s, b) => s + b.stats.recast.clampedTiles, 0),
    },
    sizes: { navGzip6: totalGzip, files: outputs.size },
    navRevision: manifest.navRevision,
    toolFiles: tool.files,
    maps: mapReports,
    stage1: stage1.map((b) => ({ mapId: b.mapId, block: blockName(b.row0, b.col0), polygons: b.polygons, bytes: b.bytes, inputHash: b.inputHash, zMin: b.stats.recast.zMin, zMax: b.stats.recast.zMax, stats: { ...b.stats, geometry: b.stats.geometry }, inputs: b.inputs.map((f) => [f.fileDataId, f.ckey]) })),
  });
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(opt.check ? REPORT.replace(/\.json$/, '.check.json') : REPORT, JSON.stringify(report));
  log(`nav total gzip6 ${String(totalGzip)} B (blocks and map.bin), ${String(Math.round((performance.now() - t0) / 1000))} s`);
  return exit;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`[nav] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exitCode = 1;
  },
);
