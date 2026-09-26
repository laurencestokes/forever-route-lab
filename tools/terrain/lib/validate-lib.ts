import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { censusHash, runCensus, type Census } from './census';
import { components } from './components';
import { connectorProblems, observedRows, parseConnectors } from './connectors';
import { decodeBlock, polygonCount, type NavBlock } from './encode';
import { runFixtures, type FixtureResult } from './fixtures';
import { buildMapMesh, linkSymmetry, type MapMesh } from './link';
import { jsonText, navRevision, revisionFiles, seamEntry, sha256, type MapEntry, type NavManifest } from './manifest';
import { decodeMapFile, type MapFile } from './mapfile';
import { navNotice } from './notice';
import { parsePassages } from './passages';
import { censusGate, parseReviewed, type GateResult as CensusGateResult } from './review';
import { derive, readBuildConfig, type BuildConfig } from './settings';
import { snapIndex } from './snap';
import { lfSha256, loadSpawns, type Spawn } from './spawns';
import { gridOf } from './stage1';
import { meshParams } from './stage2';
import { toolTreeHash } from './tool-tree';

/**
 * The offline validation of `public/nav/` (terrain-navigation.md §14.2, §16): everything that
 * needs no client, so CI runs it. `validate.ts --client` adds the client gates.
 */

export type Status = 'pass' | 'fail' | 'warn' | 'reviewed' | 'skipped';

export interface Check {
  readonly gate: string;
  readonly name: string;
  readonly status: Status;
  readonly detail: string;
}

export interface OfflineOptions {
  readonly repoRoot: string;
  /** Skip the tool tree comparison (local work only; CI never skips it). */
  readonly skipToolTree?: boolean;
  /** Treat changed stage-2 inputs as warnings instead of failures (local review work). */
  readonly staleInputsWarn?: boolean;
}

export interface MapValidation {
  readonly mapId: number;
  readonly mesh: MapMesh;
  readonly mapFile: MapFile;
  readonly census: Census;
  readonly blocks: readonly NavBlock[];
  readonly gzip6: number;
  readonly maxBlockGzip6: number;
}

export interface OfflineResult {
  readonly checks: Check[];
  readonly maps: MapValidation[];
  readonly manifest: NavManifest;
  readonly totals: { readonly gzip6: number; readonly blocks: number; readonly maxBlockGzip6: number };
  readonly censusGates: Record<string, CensusGateResult>;
  readonly fixtures: FixtureResult[];
}

export const NAV_CAP_BYTES = 7_000_000;
export const NAV_TARGET_BYTES: readonly [number, number] = [5_000_000, 6_000_000];
export const NAV_BLOCK_CAP_BYTES = 300_000;

const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function validateOffline(opt: OfflineOptions): OfflineResult {
  const root = opt.repoRoot;
  const navDir = join(root, 'public', 'nav');
  const terrain = join(root, 'tools', 'terrain');
  const checks: Check[] = [];
  const add = (gate: string, name: string, ok: boolean, detail: string, soft: Status = 'fail'): void => {
    checks.push({ gate, name, status: ok ? 'pass' : soft, detail });
  };
  const config: BuildConfig = readBuildConfig(join(terrain, 'build.json'));
  const d = derive(config.settings);
  const grid = gridOf(d);
  const manifestText = readFileSync(join(navDir, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestText) as NavManifest;
  add('G13', 'manifest kind and schema', manifest.kind === 'nav-manifest' && manifest.schema === 1, `${manifest.kind} schema ${String(manifest.schema)}`);
  add('G1', 'manifest pin equals build.json', deepEqual(manifest.pin, config.pin), `${manifest.pin.product} ${manifest.pin.version} ${manifest.pin.buildKey}`);
  add('G13', 'settings equal build.json', deepEqual(manifest.settings, config.settings) && deepEqual(manifest.stage2.settings, config.stage2), config.settings.name);
  add('G13', 'recast-navigation version equals build.json', manifest.tool.recastNavigation.version === config.recastNavigation, manifest.tool.recastNavigation.version);
  // files, hashes and the revision
  const listed = new Set<string>(['manifest.json', 'NOTICE.md', 'connectors.json']);
  let fileProblems = 0;
  const fileDetail: string[] = [];
  for (const f of revisionFiles(manifest.maps)) {
    listed.add(f.path);
    const path = join(navDir, f.path);
    if (!existsSync(path)) {
      fileProblems += 1;
      fileDetail.push(`${f.path} missing`);
      continue;
    }
    const bytes = readFileSync(path);
    if (bytes.length !== f.bytes || sha256(bytes) !== f.sha256) {
      fileProblems += 1;
      fileDetail.push(`${f.path} differs from the manifest`);
    }
  }
  const extras: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === '' ? e.name : `${prefix}/${e.name}`;
      if (e.isDirectory()) walk(join(dir, e.name), rel);
      else if (!listed.has(rel)) extras.push(rel);
    }
  };
  walk(navDir, '');
  add('G13', 'every listed file present with its size and SHA-256, and no other file', fileProblems === 0 && extras.length === 0, fileProblems === 0 && extras.length === 0 ? `${String(listed.size)} files` : [...fileDetail, ...extras.map((e) => `${e} not in the manifest`)].slice(0, 20).join('; '));
  add('G13', 'navRevision', navRevision(revisionFiles(manifest.maps)) === manifest.navRevision, manifest.navRevision);
  add('G13', 'NOTICE.md is the generated notice', existsSync(join(navDir, 'NOTICE.md')) && readFileSync(join(navDir, 'NOTICE.md'), 'utf8') === navNotice(config, manifest.tool.recastNavigation.version), 'derived-data notice with the pin, D-028, D-030, the carve-out and non-affiliation');
  // stage-2 inputs (RC-03)
  const connectorsBytes = readFileSync(join(terrain, 'inputs', 'connectors.json'));
  const passagesBytes = readFileSync(join(terrain, 'inputs', 'passages.json'));
  const reviewedBytes = readFileSync(join(terrain, 'inputs', 'census-reviewed.json'));
  const connectors = parseConnectors(JSON.parse(connectorsBytes.toString('utf8')) as unknown);
  const passages = parsePassages(JSON.parse(passagesBytes.toString('utf8')) as unknown);
  const reviewed = parseReviewed(JSON.parse(reviewedBytes.toString('utf8')) as unknown);
  const dataset = loadSpawns(root);
  const stale: [string, boolean][] = [
    ['dataset revision', manifest.stage2.dataset.dataRevision === dataset.inputs.dataRevision],
    ['spawns.json', manifest.stage2.dataset.spawnsSha256 === dataset.inputs.spawnsSha256],
    ['placeholder geometry', manifest.stage2.dataset.geometrySha256 === dataset.inputs.geometrySha256],
    ['census-reviewed.json', manifest.stage2.censusReviewedSha256 === lfSha256(reviewedBytes)],
    ['connectors.json', manifest.stage2.connectorsSha256 === lfSha256(connectorsBytes)],
    ['passages.json', manifest.stage2.passagesSha256 === lfSha256(passagesBytes)],
  ];
  for (const [name, ok] of stale) add('G13', `stage-2 input ${name} unchanged since the build`, ok, ok ? 'hash equal' : 'changed: rebuild with pnpm nav:extract (stage 2 can reuse stage 1)', opt.staleInputsWarn === true ? 'warn' : 'fail');
  // with changed inputs the census and fixtures describe another build: soft when asked
  const softCensus = opt.staleInputsWarn === true && stale.some(([, ok]) => !ok);
  const observed = jsonText({ schema: 1, kind: 'nav-connectors-observed', source: 'tools/terrain/inputs/connectors.json', connectors: observedRows(connectors) });
  const shipped = existsSync(join(navDir, 'connectors.json')) ? readFileSync(join(navDir, 'connectors.json'), 'utf8') : '';
  add('G13', 'public/nav/connectors.json holds the observed rows', shipped === observed && sha256(shipped) === manifest.connectorsFile.sha256, `${String(observedRows(connectors).length)} observed rows`);
  // tool tree
  if (opt.skipToolTree === true) checks.push({ gate: 'G13', name: 'tool tree hash', status: 'skipped', detail: 'skipped (--skip-tool-tree)' });
  else {
    const tree = toolTreeHash(root, [join(terrain, 'extract.ts'), join(terrain, 'lib', 'worker.ts')]);
    add('G13', 'tool tree hash equals the checkout', tree.hash === manifest.tool.toolTreeHash, tree.hash === manifest.tool.toolTreeHash ? tree.hash : `checkout ${tree.hash}, manifest ${manifest.tool.toolTreeHash}: rebuild`);
  }
  // G15 connectors
  const cp = connectorProblems(connectors, dataset.geometry);
  add('G15', 'connector file', cp.length === 0, cp.length === 0 ? `${String(connectors.connectors.length)} rows (${String(observedRows(connectors).length)} observed)` : cp.join('; '));
  // per map
  const maps: MapValidation[] = [];
  const censusGates: Record<string, CensusGateResult> = {};
  const fixtures: FixtureResult[] = [];
  let totalGzip = 0;
  let totalBlocks = 0;
  let maxBlock = 0;
  const names = (zone: number): string => {
    for (const m of dataset.geometry.maps.values()) if (m.assignments.some((a) => Number(a.areaId) === zone)) return `${m.name} (${String(zone)})`;
    return String(zone);
  };
  for (const entry of manifest.maps) {
    const before = checks.length;
    const mv = validateMap(entry, navDir, grid, d, config, dataset.spawns, reviewed, connectors, passages, names, checks, fixtures, censusGates);
    if (softCensus) {
      for (let i = before; i < checks.length; i += 1) {
        const c = checks[i];
        if (c !== undefined && c.status === 'fail' && /^G(6|7|8|9)/.test(c.gate)) checks[i] = { ...c, status: 'warn', detail: `(stage-2 inputs changed since the build) ${c.detail}` };
      }
    }
    maps.push(mv);
    totalGzip += mv.gzip6;
    totalBlocks += mv.blocks.length;
    maxBlock = Math.max(maxBlock, mv.maxBlockGzip6);
  }
  add('G11', `nav total ≤ ${String(NAV_CAP_BYTES)} B gzip6 (D-030 cap)`, totalGzip <= NAV_CAP_BYTES, `${String(totalGzip)} B in ${String(totalBlocks)} blocks and ${String(maps.length)} map.bin files`);
  add('G11', `nav total within the ${String(NAV_TARGET_BYTES[0])}-${String(NAV_TARGET_BYTES[1])} B target (D-030)`, totalGzip >= NAV_TARGET_BYTES[0] && totalGzip <= NAV_TARGET_BYTES[1], `${String(totalGzip)} B`, 'warn');
  add('G11', `every block ≤ ${String(NAV_BLOCK_CAP_BYTES)} B gzip6`, maxBlock <= NAV_BLOCK_CAP_BYTES, `largest ${String(maxBlock)} B`);
  return { checks, maps, manifest, totals: { gzip6: totalGzip, blocks: totalBlocks, maxBlockGzip6: maxBlock }, censusGates, fixtures };
}

function validateMap(
  entry: MapEntry,
  navDir: string,
  grid: ReturnType<typeof gridOf>,
  d: ReturnType<typeof derive>,
  config: BuildConfig,
  spawns: readonly Spawn[],
  reviewed: ReturnType<typeof parseReviewed>,
  connectors: ReturnType<typeof parseConnectors>,
  passages: ReturnType<typeof parsePassages>,
  names: (zone: number) => string,
  checks: Check[],
  fixtures: FixtureResult[],
  censusGates: Record<string, CensusGateResult>,
): MapValidation {
  const add = (gate: string, name: string, ok: boolean, detail: string, soft: Status = 'fail'): void => {
    checks.push({ gate, name: `map ${String(entry.mapId)}: ${name}`, status: ok ? 'pass' : soft, detail });
  };
  const blocks: NavBlock[] = [];
  let decodeErrors = 0;
  let gzip = 0;
  let maxBlock = 0;
  const order = entry.blocks.every((b, i) => i === 0 || (entry.blocks[i - 1]?.row0 ?? 0) * 64 + (entry.blocks[i - 1]?.col0 ?? 0) < b.row0 * 64 + b.col0);
  add('G13', 'blocks in canonical (row0, col0) order', order, `${String(entry.blocks.length)} blocks`);
  for (const b of entry.blocks) {
    const bytes = readFileSync(join(navDir, b.path));
    const g = gzipSync(bytes, { level: 6 }).length;
    gzip += g;
    maxBlock = Math.max(maxBlock, g);
    try {
      const block = decodeBlock(bytes, grid, b.path);
      if (block.mapId !== entry.mapId || block.row0 !== b.row0 || block.col0 !== b.col0 || polygonCount(block) !== b.polygons) throw new Error(`${b.path}: header or polygon count disagrees with the manifest`);
      blocks.push(block);
    } catch (error) {
      decodeErrors += 1;
      checks.push({ gate: 'G11', name: `map ${String(entry.mapId)}: decode ${b.path}`, status: 'fail', detail: error instanceof Error ? error.message : String(error) });
    }
  }
  add('G11', 'every block decodes', decodeErrors === 0, `${String(blocks.length)} blocks`);
  const mapBytes = readFileSync(join(navDir, entry.mapFile.path));
  gzip += gzipSync(mapBytes, { level: 6 }).length;
  const mapFile = decodeMapFile(mapBytes, entry.mapFile.path);
  const polygons = blocks.reduce((s, b) => s + polygonCount(b), 0);
  add('G13', 'map.bin agrees with the block list', mapFile.mapId === entry.mapId && mapFile.blockCount === blocks.length && mapFile.polygonCount === polygons && polygons === entry.polygons, `${String(polygons)} polygons, ${String(mapFile.sizes.length)} components, ${String(mapFile.links.length)} connector links, ${String(mapFile.passages.length)} passages`);
  const mesh = buildMapMesh(blocks, meshParams(d), mapFile.links);
  const sym = linkSymmetry(mesh);
  add('G5', 'every link has its reverse', sym.internalWithoutReverse === 0 && sym.crossTileWithoutReverse === 0, `${String(sym.internal)} internal edges, ${String(sym.crossTile)} cross-tile links; ${String(sym.internalWithoutReverse + sym.crossTileWithoutReverse)} without a reverse`);
  const finalSeams = seamEntry(mesh.seams);
  const maxPp = config.stage2.seams.maxBlockOverInnerPp;
  add('G5', `block seams unmatched ≤ inner + ${String(maxPp)} pp (final mesh)`, finalSeams.deltaPp <= maxPp, `block ${String(finalSeams.blockPct)}%, inner ${String(finalSeams.innerPct)}%, Δ ${String(finalSeams.deltaPp)} pp`);
  add('G5', `block seams unmatched ≤ inner + ${String(maxPp)} pp (stage 1, from the build)`, entry.seams.stage1.deltaPp <= maxPp, `block ${String(entry.seams.stage1.blockPct)}%, inner ${String(entry.seams.stage1.innerPct)}%, Δ ${String(entry.seams.stage1.deltaPp)} pp`);
  add('G5', 'final seams equal the manifest', deepEqual(finalSeams, entry.seams.final), JSON.stringify(finalSeams));
  const comps = components(mesh);
  let mismatch = 0;
  for (let p = 0; p < mesh.n; p += 1) if (comps.comp[p] !== mapFile.comp[p]) mismatch += 1;
  add('G12', 'stored components equal a recomputation', mismatch === 0 && deepEqual(comps.sizes, mapFile.sizes), `${String(mismatch)} polygons differ; main ${String(comps.sizes[0] ?? 0)} polygons`);
  const si = snapIndex(mesh, config.stage2.snap.radiusYd);
  const hintOf = (s: Spawn): number => entry.hintRollup[String(s.areaKey)] ?? s.areaKey;
  const census = runCensus(entry.mapId, si, comps, spawns, hintOf, { minComp: config.stage2.snap.ruleBMinPolygons, floorMin: config.stage2.census.floorMinPolygons });
  add('G6', 'census equals the build’s', censusHash(census) === entry.census.sha256, `main ${String(census.counts.main)}, off-main ${String(census.counts.offMain)} in ${String(census.offMain.length)} components, unsnapped ${String(census.counts.none)}, over an off-main floor ${String(census.counts.overOffMainFloor)} in ${String(census.overOffMainFloor.length)} components`);
  const splits = entry.waterSplits.map((s) => ({ fullPolygons: s.fullPolygons, parts: s.parts.map((p) => ({ ...p, zones: [] })) }));
  const gate = censusGate(census, splits, reviewed, config.stage2, names);
  censusGates[String(entry.mapId)] = gate;
  const splitFailures = gate.failures.filter((f) => f.includes('water split'));
  const censusFailures = gate.failures.filter((f) => !f.includes('water split'));
  add('G6', 'spawn census gate (every off-main, unsnapped and over-a-floor component reviewed; zone shares)', censusFailures.length === 0, censusFailures.length === 0 ? `${String(census.offMain.length + census.overOffMainFloor.length)} components and ${String(census.unsnapped.length)} unsnapped spawns reviewed` : `${String(censusFailures.length)} failures: ${censusFailures.slice(0, 5).join(' | ')}${censusFailures.length > 5 ? ' …' : ''}`);
  for (const w of gate.warnings) checks.push({ gate: 'G6', name: `map ${String(entry.mapId)}: review note`, status: 'warn', detail: w });
  add('G9', 'water splits reviewed', splitFailures.length === 0, splitFailures.length === 0 ? `${String(entry.waterSplits.reduce((s, x) => s + x.parts.length - 1, 0))} split parts reviewed` : splitFailures.join(' | '));
  for (const f of runFixtures({ mapId: entry.mapId, si, comps, census, spawns, hintOf, reviewed, connectors, passages, mapFile })) {
    fixtures.push(f);
    checks.push({ gate: f.gate, name: `map ${String(entry.mapId)}: ${f.name}`, status: f.pass ? (f.reviewed ? 'reviewed' : 'pass') : 'fail', detail: f.detail });
  }
  return { mapId: entry.mapId, mesh, mapFile, census, blocks, gzip6: gzip, maxBlockGzip6: maxBlock };
}

export function formatChecks(checks: readonly Check[]): string {
  return checks.map((c) => `${c.status.toUpperCase().padEnd(8)} ${c.gate.padEnd(4)} ${c.name}: ${c.detail}`).join('\n');
}
