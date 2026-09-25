import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { uiMapId, worldMapId } from '../../../src/domain/ids';
import { distanceYards } from '../../../src/geo/distance';
import { canonicalFrameTuples, frameSetOf, mergeLocalGeometry, type MergeResult } from '../../../src/geo/frame';
import { allAssignments, parseGeometryFile } from '../../../src/geo/geometry';
import { resolvePoint } from '../../../src/geo/resolve';
import { assignmentPercentToWorld, assignmentWorldToPercent, isFullUiRectangle } from '../../../src/geo/transforms';
import type { MapGeometry } from '../../../src/geo/types';
import { rowContainsWorldPoint } from '../../../src/geo/zones';
import { findPrivacyLeaks } from '../../build/lib/patterns';
import { isotropyProblems, passed, type CheckResult } from './checks';
import { parseCsv, recordColumns, requireColumns } from './csv';
import { decimal } from './db2-rows';
import { COMMIT_SHA, lfBytes, sha256Hex } from './hash';
import { formatJson } from './json';

/**
 * Local map-set validation and activation (docs/MAPS.md §5.2-§5.6; ARCHITECTURE §7.3).
 *
 * A local set lives in the gitignored `local-maps/` folder (outside `public/`):
 * `geometry.local.json` (rows `source: "local-db2"`, `"redistribution": "local-only"`), optionally
 * `art/` and `taxi.local.json`. `validate.ts --activate` runs the checks below and, only when all
 * of them pass, writes `maps.manifest.json`, whose presence activates the set. On any failure an
 * existing manifest is removed, so a changed set is never left active.
 *
 * Checks (MAPS.md §5.5): L1 primary rows, L2 isotropy, L3 art (fails closed while art decoding is
 * Milestone 3 work), L4 frame compatibility and shared rows (through `mergeLocalGeometry`), L5 and
 * L6 TaxiNodes (only with a local TaxiNodes CSV; otherwise recorded as not run), L7 round trips.
 */

export const LOCAL_GEOMETRY_FILE = 'geometry.local.json';
export const LOCAL_MANIFEST_FILE = 'maps.manifest.json';
export const LOCAL_TAXI_FILE = 'taxi.local.json';
export const LOCAL_ART_DIR = 'art';

/**
 * L6 landmarks (coordinates.md §9): QuestieDB Forever flight masters (`foreverNpcDB.lua` at the
 * pin) that must lie within 30 yards of their TaxiNodes row. The TaxiNodes values themselves come
 * from the developer's local CSV; `src/geo` tests pin the cited rows (D-022). Nodes 2, 5, 67 and 68
 * sit on three of the four changed frames (1453, 1433, 1423), where reading the percent in the Era
 * frame misses by 107-451 yd, so a stale frame cannot pass.
 */
export const TAXI_LANDMARKS: readonly { readonly taxiNode: number; readonly npc: number; readonly uiMapId: number; readonly x: number; readonly y: number }[] = [
  { taxiNode: 2, npc: 352, uiMapId: 1453, x: 70.95, y: 72.51 },
  { taxiNode: 23, npc: 3310, uiMapId: 1454, x: 45.12, y: 63.89 },
  { taxiNode: 22, npc: 2995, uiMapId: 1456, x: 47.0, y: 49.83 },
  { taxiNode: 5, npc: 931, uiMapId: 1433, x: 25.5, y: 59.41 },
  { taxiNode: 67, npc: 12617, uiMapId: 1423, x: 71.81, y: 49.6 },
  { taxiNode: 68, npc: 12636, uiMapId: 1423, x: 70.53, y: 47.55 },
];
export const LANDMARK_TOLERANCE_YARDS = 30;

/**
 * Checks that may be skipped without blocking activation: L5 and L6 need a local TaxiNodes CSV,
 * which a geometry-only set may not have. A skipped check is recorded under
 * `validation.notRun` in the manifest; it never counts as passed.
 */
export const OPTIONAL_CHECKS: readonly string[] = ['L5', 'L6'];

export interface LocalSetOptions {
  readonly dir: string;
  /** The committed placeholder, parsed. */
  readonly committed: MapGeometry;
  /** The committed placeholder's frame hash, verified by the placeholder checks. */
  readonly committedFrameHash: string;
  /** A local `TaxiNodes` CSV at the set's build, for L5/L6; null to skip them. */
  readonly taxiNodesCsv: string | null;
}

export interface LocalSetResult {
  readonly checks: readonly CheckResult[];
  readonly passed: boolean;
  readonly build: string | null;
  readonly product: string | null;
  readonly geometrySha256: string | null;
  readonly frameHash: string | null;
  /** `inputs.tables` of geometry.local.json when it has them, otherwise null (unknown). */
  readonly tables: unknown;
  readonly merge: MergeResult | null;
}

const check = (id: string, title: string, problems: readonly string[]): CheckResult => ({ id, title, problems, skipped: null });
const skip = (id: string, title: string, reason: string): CheckResult => ({ id, title, problems: [], skipped: reason });

type Json = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

function filesUnder(dir: string): readonly string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((path) => statSync(join(dir, path)).isFile());
}

export function validateLocalSet(options: LocalSetOptions): LocalSetResult {
  const empty = { build: null, product: null, geometrySha256: null, frameHash: null, tables: null, merge: null };
  const path = join(options.dir, LOCAL_GEOMETRY_FILE);
  if (!existsSync(path)) {
    return { ...empty, checks: [check('L0', `${LOCAL_GEOMETRY_FILE} exists and parses`, [`no ${LOCAL_GEOMETRY_FILE} in the local set`])], passed: false };
  }
  const bytes = lfBytes(readFileSync(path));
  const geometrySha256 = sha256Hex(bytes);
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    return { ...empty, geometrySha256, checks: [check('L0', `${LOCAL_GEOMETRY_FILE} parses`, [error instanceof Error ? error.message : String(error)])], passed: false };
  }
  const parsed = parseGeometryFile(raw);
  const header: string[] = [];
  const build = isRecord(raw) && typeof raw['build'] === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(raw['build']) ? raw['build'] : null;
  if (build === null) header.push('top-level "build" (the set\'s client build) is missing or malformed');
  if (!parsed.ok) header.push(...parsed.errors);
  else {
    if (parsed.geometry.kind !== 'local') header.push('kind must be "local"');
    if (parsed.geometry.product !== options.committed.product) header.push(`product ${parsed.geometry.product} differs from the placeholder's ${options.committed.product}`);
  }
  const checks: CheckResult[] = [check('L0', `${LOCAL_GEOMETRY_FILE} parses as a local geometry (local-db2 rows, "redistribution": "local-only", build)`, header)];
  if (!parsed.ok || header.length > 0) return { ...empty, geometrySha256, build, checks, passed: false };
  const local = parsed.geometry;
  const tables = isRecord(raw) && isRecord(raw['inputs']) && isRecord(raw['inputs']['tables']) ? raw['inputs']['tables'] : null;

  // L1: every zone-type UiMap (Type 3 or 6) has exactly one full-rectangle OrderIndex 0 row
  const l1: string[] = [];
  for (const map of local.maps.values()) {
    if (map.type !== 3 && map.type !== 6) continue;
    const primary = map.assignments.filter((row) => row.orderIndex === 0);
    const [row] = primary;
    if (primary.length !== 1 || row === undefined) l1.push(`UiMap ${String(map.uiMapId)}: ${String(primary.length)} OrderIndex 0 rows`);
    else if (!isFullUiRectangle(row)) l1.push(`UiMap ${String(map.uiMapId)}: OrderIndex 0 row has a partial UI rectangle`);
  }
  checks.push(check('L1', 'every Type 3/6 UiMap has exactly one OrderIndex 0 row with UiMin (0,0), UiMax (1,1) (WMO and Z are checked when import --build reads the CSVs)', l1));

  checks.push(check('L2', 'isotropy of every local row against the art aspect (within 0.2%)', isotropyProblems(local)));

  const art = filesUnder(join(options.dir, LOCAL_ART_DIR));
  checks.push(
    check(
      'L3',
      'art images match LayerWidth × LayerHeight and every listed tile decoded',
      art.length === 0 ? [] : [`${String(art.length)} art file(s) present, but art verification (convert.ts) is Milestone 3: refusing to activate unverified art`],
    ),
  );

  // L4: frame hash and shared rows
  const frame = canonicalFrameTuples(local, frameSetOf(options.committed));
  const frameHash = frame.ok ? sha256Hex(frame.canonical) : null;
  const merge = mergeLocalGeometry(options.committed, local);
  const l4: string[] = [];
  if (frameHash === null) l4.push(`frame set incompatible at UiMaps ${frame.ok ? '' : frame.incompatible.join(', ')}`);
  else if (frameHash !== options.committedFrameHash) l4.push(`frame hash ${frameHash} differs from the committed ${options.committedFrameHash}`);
  if (merge.kind === 'mismatch') {
    if (merge.frameUiMapIds.length > 0) l4.push(`frames differ at UiMaps ${merge.frameUiMapIds.join(', ')}`);
    if (merge.sharedRowUiMapIds.length > 0) l4.push(`rows differ from the committed rows at UiMaps ${merge.sharedRowUiMapIds.join(', ')} (local sets may only add UiMaps)`);
  }
  checks.push(check('L4', 'frame compatibility: frame hash equals the committed one, and every shared UiMap has identical rows', l4));
  const merged = merge.kind === 'merged' ? merge.geometry : null;

  // L5 / L6: TaxiNodes
  if (options.taxiNodesCsv === null || merged === null) {
    const reason = merged === null ? 'needs a frame-compatible set (L4)' : 'no local TaxiNodes CSV given (--taxi-nodes <csv>)';
    checks.push(skip('L5', 'every TaxiNodes position lies inside a zone frame on its world map', reason));
    checks.push(skip('L6', `flight-master landmarks within ${String(LANDMARK_TOLERANCE_YARDS)} yd of their TaxiNodes`, reason));
  } else {
    const table = parseCsv(options.taxiNodesCsv.replace(/\r\n/g, '\n'));
    requireColumns(table, ['ID', 'ContinentID', 'Pos_0', 'Pos_1'], 'TaxiNodes CSV');
    const nodes = table.records.map((record) => {
      const c = recordColumns(table, record);
      return { id: decimal(c['ID'] ?? '', 'ID'), point: { mapId: worldMapId(decimal(c['ContinentID'] ?? '', 'ContinentID')), x: decimal(c['Pos_0'] ?? '', 'Pos_0'), y: decimal(c['Pos_1'] ?? '', 'Pos_1') } };
    });
    const zones = allAssignments(merged).filter(({ row }) => row.areaId > 0);
    const outside = nodes.filter((node) => !zones.some(({ row }) => rowContainsWorldPoint(row, node.point))).map((node) => `TaxiNode ${String(node.id)} (map ${String(node.point.mapId)})`);
    checks.push(check('L5', 'every TaxiNodes position lies inside a zone frame on its world map', outside.length === 0 ? [] : [`outside every zone frame: ${outside.join(', ')}`]));
    const l6: string[] = [];
    for (const landmark of TAXI_LANDMARKS) {
      const node = nodes.find((n) => n.id === landmark.taxiNode);
      const master = resolvePoint({ space: 'zone', uiMapId: uiMapId(landmark.uiMapId), x: landmark.x, y: landmark.y, frame: 'forever', lexemes: null }, merged);
      const yards = node === undefined || master === null ? null : distanceYards(master, node.point);
      if (yards === null) l6.push(`TaxiNode ${String(landmark.taxiNode)} / NPC ${String(landmark.npc)}: not comparable (missing node or frame)`);
      else if (yards > LANDMARK_TOLERANCE_YARDS) l6.push(`TaxiNode ${String(landmark.taxiNode)} is ${yards.toFixed(1)} yd from NPC ${String(landmark.npc)}`);
    }
    checks.push(check('L6', `flight-master landmarks within ${String(LANDMARK_TOLERANCE_YARDS)} yd of their TaxiNodes`, l6));
  }

  // L7: round trips on every row of the merged geometry
  if (merged === null) checks.push(skip('L7', 'world ↔ percent round trip below 1e-9', 'needs a frame-compatible set (L4)'));
  else {
    let worst = 0;
    for (const { row } of allAssignments(merged)) {
      for (const x of [-25, 0, 37.5, 100, 125]) {
        for (const y of [-25, 0, 62.5, 100, 125]) {
          const world = assignmentPercentToWorld(row, x, y);
          const back = assignmentWorldToPercent(row, world.x, world.y);
          worst = Math.max(worst, Math.abs(back.x - x), Math.abs(back.y - y));
        }
      }
    }
    checks.push(check('L7', 'world ↔ percent round trip below 1e-9 (sample grid on every row, inside and outside 0..100)', worst < 1e-9 ? [] : [`worst round-trip error ${String(worst)}`]));
  }
  const blocking = checks.filter((c) => c.problems.length > 0 || (c.skipped !== null && !OPTIONAL_CHECKS.includes(c.id)));
  return { checks, passed: blocking.length === 0, build, product: local.product, geometrySha256, frameHash, tables, merge };
}

// =============================================================================================
// Activation

export interface SetSource {
  readonly product: string;
  readonly build: string;
  readonly buildKey: string;
  readonly method: 'tacttool-local' | 'tacttool-cdn' | 'wow.export-gui';
  readonly tools: Readonly<Record<string, string>>;
  readonly wowdbdefs: string;
}

const METHODS: readonly SetSource['method'][] = ['tacttool-local', 'tacttool-cdn', 'wow.export-gui'];

/** Reads the developer-written `source.json` (MAPS.md §5.2): no local paths, pinned tool versions. */
export function parseSetSource(text: string): SetSource {
  const leaks = findPrivacyLeaks(text);
  if (leaks.length > 0) throw new Error(`source.json must not contain local paths (${leaks.map((hit) => `line ${String(hit.line)}`).join(', ')})`);
  const value = JSON.parse(text) as unknown;
  if (!isRecord(value)) throw new Error('source.json: expected an object');
  const tools = value['tools'];
  const method = METHODS.find((m) => m === value['method']);
  const out = {
    product: value['product'],
    build: value['build'],
    buildKey: value['buildKey'],
    wowdbdefs: value['wowdbdefs'],
  };
  if (typeof out.product !== 'string' || typeof out.build !== 'string') throw new Error('source.json: product and build are required');
  if (typeof out.buildKey !== 'string' || !/^[0-9a-f]{32}$/.test(out.buildKey)) throw new Error('source.json: buildKey must be 32 lowercase hex characters');
  if (typeof out.wowdbdefs !== 'string' || !COMMIT_SHA.test(out.wowdbdefs)) throw new Error('source.json: wowdbdefs must be a full commit SHA');
  if (method === undefined) throw new Error(`source.json: method must be one of ${METHODS.join(', ')}`);
  if (!isRecord(tools) || !Object.values(tools).every((v) => typeof v === 'string' && v !== '')) throw new Error('source.json: tools must map tool names to versions');
  return { product: out.product, build: out.build, buildKey: out.buildKey, method, tools: tools as Readonly<Record<string, string>>, wowdbdefs: out.wowdbdefs };
}

export interface ActivationFacts {
  readonly source: SetSource;
  /** `git rev-parse HEAD` of this repository, or null outside git. */
  readonly repoCommit: string | null;
  /** Node's major version, recorded as `<major>.x`. */
  readonly nodeMajor: number;
}

/** The `maps.manifest.json` object for a passing set (MAPS.md §5.3). No timestamps. */
export function activationManifest(dir: string, result: LocalSetResult, facts: ActivationFacts): Readonly<Record<string, unknown>> {
  if (!result.passed || result.build === null || result.product === null || result.frameHash === null || result.geometrySha256 === null) {
    throw new Error('refusing to write a manifest for a set that did not pass');
  }
  if (facts.source.product !== result.product || facts.source.build !== result.build) {
    throw new Error(`source.json describes ${facts.source.product} ${facts.source.build}, the geometry ${result.product} ${result.build}`);
  }
  const taxiPath = join(dir, LOCAL_TAXI_FILE);
  return {
    schema: 1,
    redistribution: 'local-only',
    set: `${result.product}-${result.build}`,
    product: result.product,
    build: result.build,
    buildKey: facts.source.buildKey,
    source: { method: facts.source.method, tools: facts.source.tools, wowdbdefs: facts.source.wowdbdefs },
    generator: { repoCommit: facts.repoCommit, node: `${String(facts.nodeMajor)}.x` },
    tables: result.tables,
    frameHash: result.frameHash,
    geometry: { file: LOCAL_GEOMETRY_FILE, sha256: result.geometrySha256 },
    images: {},
    ...(existsSync(taxiPath) ? { taxi: { file: LOCAL_TAXI_FILE, sha256: sha256Hex(lfBytes(readFileSync(taxiPath))) } } : {}),
    validation: {
      passed: true,
      checks: result.checks.filter(passed).map((c) => c.id),
      notRun: Object.fromEntries(result.checks.filter((c) => c.skipped !== null).map((c) => [c.id, c.skipped])),
    },
  };
}

/** Writes the manifest (activating the set) and returns its path. */
export function activate(dir: string, result: LocalSetResult, facts: ActivationFacts): string {
  const path = join(dir, LOCAL_MANIFEST_FILE);
  writeFileSync(path, formatJson(activationManifest(dir, result, facts)));
  return path;
}

/** Removes an existing manifest, so a set that no longer passes is inactive. Returns whether one was removed. */
export function deactivate(dir: string): boolean {
  const path = join(dir, LOCAL_MANIFEST_FILE);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}
