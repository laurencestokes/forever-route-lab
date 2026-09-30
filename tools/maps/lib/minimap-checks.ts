import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { atlasHash, atlasPlacements } from '../../../src/geo/atlas';
import type { AtlasLayout } from '../../../src/geo/atlas-layout';
import type { MapGeometry } from '../../../src/geo/types';
import { indexKeys, type IndexLevel } from './atlas-index';
import type { CheckResult } from './checks';
import { lfBytes, sha256Hex } from './hash';
import {
  censusFailures,
  independentSeams,
  landUnderSea,
  rampAgreement,
  reliefWetMask,
  skirtReliefCells,
  type Contrast,
  type NativeCensus,
  type RampAgreement,
  type SeamLevelCensus,
  type SeamMap,
} from './minimap-census';
import { layoutMapIds } from './minimap-inputs';
import type { ReliefClasses } from './minimap-liquid';
import { minimapParameters, parseMinimapManifest, type ParsedMinimapManifest } from './minimap-manifest';
import { minimapNoticeText } from './minimap-notice';
import { pointerNameProblems, tarEntries, tilesTreeHash, type PackPointer } from './minimap-pack';
import {
  MINIMAP_BUDGET,
  type MinimapBudget,
  MINIMAP_INDEX_FILE,
  MINIMAP_MANIFEST_FILE,
  MINIMAP_MAX_LEVEL,
  MINIMAP_MIN_LEVEL,
  MINIMAP_NOTICE_FILE,
  MINIMAP_POINTER_FILE,
  MINIMAP_TILE,
  MINIMAP_TILE_PATH,
  MINIMAP_TILE_TEMPLATE,
  MINIMAP_TILES_DIR,
  MINIMAP_UNDERLAY_LEVEL,
  NAVY,
  PACK_CONTENTS,
  PHASE_MAPS_NOT_DRAWN,
  RECORDED_TILE_COUNTS,
  SEAM_MEASURE,
} from './minimap-params';
import { decodeMinimapTile } from './minimap-build';
import { pixelOwner } from './minimap-stitch';

/**
 * The offline checks of the minimap folder (docs/research/map-atlas.md §24.4, M1-M11): no client is
 * needed, and the checks that read tiles (M6, M8, M11) are skipped, and say so, when the tiles are not
 * present (a clone without the pack, §23.4). `validate.ts` runs them once the folder's manifest
 * exists (MM.6); `minimap-checks.test.ts` shows each failing on a tampered folder.
 */

export interface MinimapCheckInputs {
  readonly dir: string;
  readonly layout: AtlasLayout;
  readonly geometry: MapGeometry;
  /** The painted atlas's index (M3), parsed JSON; null when it is not built. */
  readonly paintedIndex: unknown;
  readonly reliefs: ReadonlyMap<number, ReliefClasses>;
  /** The tile pack, when it is at hand (M7). */
  readonly packFile: string | null;
  /** The minimap tiles per map (M4); default the pinned build's. */
  readonly recordedCounts?: Readonly<Record<string, number>>;
  /** The budget (M5); default §24.1's. */
  readonly budget?: MinimapBudget;
  /** M8's tolerance on each share (the raw pyramid against the WebP tiles; calibrated on the real build). */
  readonly rampTolerance?: number;
  /**
   * Why the tiles are not read even when present (M5 then budgets from the manifest's records and
   * M6, M8 and M11 are skipped, saying this): `validate.ts --skip-minimap-tiles`, for the command-line
   * test, whose tile checks `minimap-files.test.ts` already runs (review finding MD-07).
   */
  readonly skipTiles?: string;
}

/**
 * M8: the largest difference allowed between the manifest's and the re-derived share of each class.
 * The build takes the census from its own encoded tiles, decoded, so the two agree exactly with the
 * same decoder (MEASURED on the build of 2026-09-27); the tolerance absorbs another libwebp's decoder.
 */
export const M8_TOLERANCE = 0.001;
/** M11: the difference allowed per level and map in the counts of long edges over 4 and over 8 levels. */
export const M11_TOLERANCE = 2;

export const MINIMAP_CHECK_TITLES = {
  M1: `${MINIMAP_INDEX_FILE}, ${MINIMAP_MANIFEST_FILE}, ${MINIMAP_NOTICE_FILE} and ${MINIMAP_POINTER_FILE} parse; the NOTICE is regenerated from the manifest; the alterations are listed; the pack holds NOTICE.md, manifest.json and t/`,
  M2: "the index's stored keys are the manifest's tiles and its sea keys the manifest's sea list; base level 0, underlay −6 stored, every level, the navy",
  M3: "atlasHash, placements, insets, extent and seamE equal the painted index's and src/geo's for ATLAS_LAYOUT",
  M4: 'the sources: a minimap and a root-ADT row per tile, unique FileDataIDs, 32-hex CKeys, exactly the layout\'s maps, the recorded counts',
  M5: 'the budgets: folder total, per tile, per level (from the manifest, or from the tiles when present)',
  M6: 'every tile is listed with its bytes and SHA-256, is a 256 px still WebP, and nothing unlisted is under t/',
  M7: "the pointer names the pack and its release by the tiles' tree hash and the pack's SHA-256; the pack's SHA-256, NOTICE and manifest match",
  M8: 'the relief agreement at level −2 (water, land and shore land on the navy ramp) re-derived from the tiles matches the census',
  M9: 'no sea key at any level covers a committed relief land cell',
  M10: "the manifest's parameters are minimap-params.ts's, and its census is present and passes the §19.5 gates",
  M11: 'the independent seam measure at levels −1 to −3, re-derived from the tiles with the relief mask, matches the census within ±2 edges',
} as const;

type Id = keyof typeof MINIMAP_CHECK_TITLES;
const check = (id: Id, problems: readonly string[]): CheckResult => ({ id, title: MINIMAP_CHECK_TITLES[id], problems, skipped: null });
const skip = (id: Id, reason: string): CheckResult => ({ id, title: MINIMAP_CHECK_TITLES[id], problems: [], skipped: reason });

type Json = Readonly<Record<string, unknown>>;
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const readJson = (path: string): unknown => JSON.parse(lfBytes(readFileSync(path)).toString('utf8')) as unknown;
const gz = (b: Uint8Array): number => gzipSync(b, { level: 6 }).length;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

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

export interface MinimapCheckReport {
  readonly checks: readonly CheckResult[];
  readonly manifest: ParsedMinimapManifest | null;
  /** Tiles present under t/ (0 in a clone without the pack). */
  readonly tilesPresent: number;
}

const decodeRgb = (path: string): Promise<Uint8Array> => decodeMinimapTile(readFileSync(path));

export async function minimapChecks(inputs: MinimapCheckInputs): Promise<MinimapCheckReport> {
  const { dir } = inputs;
  const budget = inputs.budget ?? MINIMAP_BUDGET;
  const out: CheckResult[] = [];

  // ---- M1
  const m1: string[] = [];
  const read = (name: string): unknown => {
    const path = join(dir, name);
    if (!existsSync(path)) {
      m1.push(`${name}: missing`);
      return null;
    }
    try {
      return readJson(path);
    } catch (error) {
      m1.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };
  const indexJson = read(MINIMAP_INDEX_FILE);
  const manifestJson = read(MINIMAP_MANIFEST_FILE);
  const pointerJson = read(MINIMAP_POINTER_FILE);
  const parsed = manifestJson === null ? null : parseMinimapManifest(manifestJson);
  if (parsed !== null) m1.push(...parsed.errors.map((e) => `${MINIMAP_MANIFEST_FILE}: ${e}`));
  const manifest = parsed?.manifest ?? null;
  const noticePath = join(dir, MINIMAP_NOTICE_FILE);
  if (!existsSync(noticePath)) m1.push(`${MINIMAP_NOTICE_FILE}: missing`);
  else if (manifest !== null && lfBytes(readFileSync(noticePath)).toString('utf8') !== minimapNoticeText(manifest)) m1.push(`${MINIMAP_NOTICE_FILE}: differs from the text regenerated from the manifest`);
  if (manifest !== null) {
    if (!manifest.alterations.every((a, i) => a.id === i + 1 && a.what.length > 0)) m1.push('the alterations must be numbered from 1');
    if (!same(manifest.pack.contents, PACK_CONTENTS)) m1.push(`the manifest's pack contents must be ${PACK_CONTENTS.join(', ')}`);
  }
  const pointer = isRecord(pointerJson) ? (pointerJson as unknown as PackPointer) : null;
  if (pointerJson !== null && (pointer === null || typeof pointer.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(pointer.sha256) || typeof pointer.treeHash !== 'string' || typeof pointer.bytes !== 'number')) m1.push(`${MINIMAP_POINTER_FILE}: needs asset, tag, bytes, sha256 and treeHash`);
  else if (pointer !== null && !same(pointer.contents, PACK_CONTENTS)) m1.push(`${MINIMAP_POINTER_FILE}: contents must be ${PACK_CONTENTS.join(', ')}`);
  if (!isRecord(indexJson)) m1.push(`${MINIMAP_INDEX_FILE}: must be an object`);
  out.push(check('M1', m1));
  const index = isRecord(indexJson) ? indexJson : null;
  const levels = index !== null && Array.isArray(index['levels']) ? (index['levels'] as IndexLevel[]) : [];

  // ---- M2
  const m2: string[] = [];
  const storedPaths = new Set<string>();
  const seaByLevel = new Map<number, { nx: number; keys: Set<number> }>();
  if (index === null || manifest === null) m2.push('needs the index and the manifest');
  else {
    if (index['kind'] !== 'map-atlas-index' || index['style'] !== 'minimap' || index['schema'] !== 1) m2.push('kind must be map-atlas-index, style minimap, schema 1');
    if (index['template'] !== MINIMAP_TILE_TEMPLATE || index['tileSize'] !== MINIMAP_TILE) m2.push(`template must be ${MINIMAP_TILE_TEMPLATE}, tileSize ${String(MINIMAP_TILE)}`);
    if (index['baseLevel'] !== 0 || index['minLevel'] !== MINIMAP_MIN_LEVEL || index['maxLevel'] !== MINIMAP_MAX_LEVEL) m2.push('levels must be −8 … 0 with baseLevel 0');
    if (index['underlayLevel'] !== MINIMAP_UNDERLAY_LEVEL) m2.push(`underlayLevel must be ${String(MINIMAP_UNDERLAY_LEVEL)}`);
    if (!same(index['seaColour'], NAVY) || !same(index['coastColour'], NAVY)) m2.push('seaColour and coastColour must be the navy #0d1b30');
    if (levels.length !== MINIMAP_MAX_LEVEL - MINIMAP_MIN_LEVEL + 1) m2.push('every level −8 … 0 must be listed');
    for (const [i, L] of levels.entries()) {
      const z = MINIMAP_MIN_LEVEL + i;
      if (L.z !== z || typeof L.sea !== 'string') {
        m2.push(`levels[${String(i)}]: needs z ${String(z)} and a sea bitmap`);
        continue;
      }
      const keys = indexKeys(L);
      const sea = new Set((keys.sea ?? []).map(([x, y]) => y * L.nx + x));
      for (const [x, y] of keys.stored) {
        if (sea.has(y * L.nx + x)) m2.push(`level ${String(z)}: key ${String(x)},${String(y)} is both stored and sea`);
        storedPaths.add(`t/${String(z)}/${String(x)}/${String(y)}.webp`);
      }
      seaByLevel.set(z, { nx: L.nx, keys: sea });
      const listed = (manifest.seaKeys[String(z)] ?? []).map(([x, y]) => y * L.nx + x).sort((a, b) => a - b);
      if (!same(listed, [...sea].sort((a, b) => a - b))) m2.push(`level ${String(z)}: the sea keys differ from the manifest's sea list`);
      if (z === MINIMAP_UNDERLAY_LEVEL && keys.stored.length === 0) m2.push(`the underlay level ${String(z)} has no stored key`);
    }
    const tilesListed = new Set(manifest.files.map((f) => f.path).filter((p) => MINIMAP_TILE_PATH.test(p)));
    const missing = [...storedPaths].filter((p) => !tilesListed.has(p));
    const extra = [...tilesListed].filter((p) => !storedPaths.has(p));
    if (missing.length > 0) m2.push(`${String(missing.length)} stored keys have no file in the manifest (first ${missing[0] ?? ''})`);
    if (extra.length > 0) m2.push(`${String(extra.length)} manifest tiles are not stored keys of the index (first ${extra[0] ?? ''})`);
    const indexEntry = manifest.files.find((f) => f.path === MINIMAP_INDEX_FILE);
    const indexBytes = existsSync(join(dir, MINIMAP_INDEX_FILE)) ? readFileSync(join(dir, MINIMAP_INDEX_FILE)) : null;
    if (indexEntry === undefined || indexBytes === null || indexEntry.sha256 !== sha256Hex(indexBytes)) m2.push(`the manifest's ${MINIMAP_INDEX_FILE} record is not the file's SHA-256`);
  }
  out.push(check('M2', m2));

  // ---- M3
  const m3: string[] = [];
  const placements = atlasPlacements(inputs.geometry, inputs.layout);
  if (placements === null) m3.push('the committed geometry does not place the layout');
  else if (index !== null) {
    const hash = atlasHash(placements, inputs.layout);
    if (index['atlasHash'] !== hash) m3.push(`the index's atlasHash ${String(index['atlasHash'])} is not src/geo's ${hash}`);
    if (manifest !== null && manifest.atlasHash !== hash) m3.push(`the manifest's atlasHash is not src/geo's ${hash}`);
    if (!same(index['extent'], inputs.layout.extent) || index['seamE'] !== inputs.layout.seamE || index['layout'] !== inputs.layout.name) m3.push('extent, seamE or layout name differ from ATLAS_LAYOUT');
    const painted = isRecord(inputs.paintedIndex) ? inputs.paintedIndex : null;
    if (painted === null) m3.push('the painted index is not available to compare with');
    else for (const key of ['atlasHash', 'layout', 'extent', 'seamE', 'placements', 'insets']) if (!same(index[key], painted[key])) m3.push(`${key} differs from the painted index's`);
  }
  out.push(check('M3', m3));

  // ---- M4
  const m4: string[] = [];
  const recorded = inputs.recordedCounts ?? RECORDED_TILE_COUNTS;
  const sources = manifest !== null && isRecord(manifest.raw['sources']) ? manifest.raw['sources'] : null;
  const mapTiles = new Map<number, { row: number; col: number }[]>();
  if (manifest === null || sources === null) m4.push('needs the manifest');
  else {
    const rowsOf = (key: string): unknown[][] => {
      const t = sources[key];
      return isRecord(t) && Array.isArray(t['rows']) ? (t['rows'] as unknown[][]) : [];
    };
    const minimaps = rowsOf('minimaps');
    const roots = rowsOf('rootAdts');
    const want = layoutMapIds(inputs.layout);
    const drawn = manifest.maps.map((m) => m.mapId);
    if (!same(drawn, want)) m4.push(`the maps drawn are ${drawn.join(', ')}, the layout's are ${want.join(', ')}`);
    for (const p of PHASE_MAPS_NOT_DRAWN) if (drawn.includes(p.mapId)) m4.push(`phase map ${String(p.mapId)} is drawn`);
    if (!same(manifest.notDrawn.map((p) => p.mapId), PHASE_MAPS_NOT_DRAWN.map((p) => p.mapId))) m4.push('the phase maps not drawn are not listed');
    for (const [name, rows] of [
      ['minimaps', minimaps],
      ['rootAdts', roots],
    ] as const) {
      const ids = new Set<number>();
      for (const r of rows) {
        const [mapId, row, col, fdid, ckey] = r as [number, number, number, number, string];
        if (!want.includes(mapId)) m4.push(`${name}: map ${String(mapId)} is not drawn`);
        if (!Number.isInteger(fdid) || fdid <= 0 || ids.has(fdid)) m4.push(`${name}: FileDataID ${String(fdid)} is not a unique positive id`);
        ids.add(fdid);
        if (typeof ckey !== 'string' || !/^[0-9a-f]{32}$/.test(ckey)) m4.push(`${name}: map ${String(mapId)} tile ${String(row)}_${String(col)} has no 32-hex CKey`);
        if (name === 'minimaps') {
          const list = mapTiles.get(mapId) ?? [];
          list.push({ row, col });
          mapTiles.set(mapId, list);
        }
      }
    }
    if (minimaps.length !== roots.length) m4.push(`${String(minimaps.length)} minimap rows against ${String(roots.length)} root-ADT rows`);
    for (const m of manifest.maps) {
      const n = mapTiles.get(m.mapId)?.length ?? 0;
      if (n !== m.tiles) m4.push(`map ${String(m.mapId)}: ${String(n)} minimap rows, the manifest says ${String(m.tiles)} tiles`);
      const r = recorded[String(m.mapId)];
      if (r !== undefined && r !== n) m4.push(`map ${String(m.mapId)}: ${String(n)} minimap tiles at this build, ${String(r)} recorded (a changed client: review the build and update RECORDED_TILE_COUNTS)`);
    }
  }
  out.push(check('M4', m4.slice(0, 20)));

  // ---- M5 and M6
  const tilesDir = join(dir, MINIMAP_TILES_DIR);
  const present = inputs.skipTiles === undefined ? listTree(tilesDir).map((p) => `${MINIMAP_TILES_DIR}/${p}`) : [];
  const m5: string[] = [];
  const perLevel = new Map<string, number>();
  let largest = 0;
  if (manifest === null) m5.push('needs the manifest');
  else if (present.length === 0) {
    for (const l of manifest.levels) {
      perLevel.set(String(l.z), l.gzipBytes);
      largest = Math.max(largest, l.largestGzipBytes);
    }
  } else {
    for (const p of present) {
      if (!MINIMAP_TILE_PATH.test(p)) continue;
      const g = gz(readFileSync(join(dir, p)));
      const z = p.split('/')[1] ?? '';
      perLevel.set(z, (perLevel.get(z) ?? 0) + g);
      largest = Math.max(largest, g);
    }
  }
  if (manifest !== null) {
    let total = [...perLevel.values()].reduce((a, b) => a + b, 0);
    for (const name of [MINIMAP_INDEX_FILE, MINIMAP_MANIFEST_FILE, MINIMAP_NOTICE_FILE, MINIMAP_POINTER_FILE]) if (existsSync(join(dir, name))) total += gz(readFileSync(join(dir, name)));
    if (total > budget.totalGzipBytes) m5.push(`the folder is ${String(total)} B gzip-6, over ${String(budget.totalGzipBytes)} B`);
    if (largest > budget.perTileGzipBytes) m5.push(`a tile is ${String(largest)} B gzip-6, over the ${String(budget.perTileGzipBytes)} B cap`);
    for (const [z, bytes] of perLevel) {
      const base = budget.levelBaselines[z];
      if (base !== undefined && bytes > base * (1 + budget.tolerance)) m5.push(`level ${z}: ${String(bytes)} B gzip-6, over its baseline ${String(base)} B + ${String(100 * budget.tolerance)} %`);
    }
  }
  out.push(check('M5', m5));
  if (present.length === 0) out.push(skip('M6', inputs.skipTiles ?? `no tiles under ${MINIMAP_TILES_DIR}/ (the pack is not fetched)`));
  else if (manifest === null) out.push(check('M6', ['needs the manifest']));
  else {
    const m6: string[] = [];
    const listed = new Map(manifest.files.filter((f) => MINIMAP_TILE_PATH.test(f.path)).map((f) => [f.path, f]));
    for (const p of present) {
      const f = listed.get(p);
      if (f === undefined) {
        m6.push(`${p}: not listed in the manifest`);
        continue;
      }
      const bytes = readFileSync(join(dir, p));
      if (bytes.length !== f.bytes || sha256Hex(bytes) !== f.sha256) m6.push(`${p}: bytes or SHA-256 differ from the manifest`);
      else {
        const meta = await sharp(bytes).metadata();
        if (meta.format !== 'webp' || meta.width !== MINIMAP_TILE || meta.height !== MINIMAP_TILE || (meta.pages ?? 1) !== 1) m6.push(`${p}: not a ${String(MINIMAP_TILE)} px still WebP`);
      }
    }
    const missing = [...listed.keys()].filter((p) => !present.includes(p));
    if (missing.length > 0) m6.push(`${String(missing.length)} of ${String(listed.size)} listed tiles are missing (a partial set; first ${missing[0] ?? ''})`);
    out.push(check('M6', m6.slice(0, 20)));
  }

  // ---- M7
  const m7: string[] = [];
  if (manifest === null || pointer === null) m7.push('needs the manifest and the pointer');
  else {
    const tree = tilesTreeHash(manifest.files.filter((f) => MINIMAP_TILE_PATH.test(f.path)));
    if (tree !== manifest.pack.treeHash || tree !== pointer.treeHash) m7.push("the tree hash over the manifest's tiles is not the manifest's and the pointer's");
    m7.push(...pointerNameProblems(pointer));
    if (pointer.client !== manifest.client.version) m7.push(`the pointer's client ${pointer.client} is not the manifest's ${manifest.client.version}`);
    if (JSON.stringify(manifest.pack.contents) !== JSON.stringify(pointer.contents)) m7.push("the manifest's pack contents are not the pointer's");
    if (inputs.packFile !== null && existsSync(inputs.packFile)) {
      const tar = readFileSync(inputs.packFile);
      if (tar.length !== pointer.bytes || sha256Hex(tar) !== pointer.sha256) m7.push("the pack's bytes or SHA-256 are not the pointer's");
      else {
        const entries = tarEntries(tar);
        const at = (name: string): Buffer | null => {
          const e = entries.find((x) => x.path === name);
          return e === undefined ? null : tar.subarray(e.offset, e.offset + e.size);
        };
        if (entries[0]?.path !== MINIMAP_NOTICE_FILE || entries[1]?.path !== MINIMAP_MANIFEST_FILE) m7.push('the pack must hold NOTICE.md first, then manifest.json');
        const n = at(MINIMAP_NOTICE_FILE);
        const m = at(MINIMAP_MANIFEST_FILE);
        if (n === null || !n.equals(lfBytes(readFileSync(noticePath)))) m7.push("the pack's NOTICE.md is not the committed one");
        if (m === null || !m.equals(lfBytes(readFileSync(join(dir, MINIMAP_MANIFEST_FILE))))) m7.push("the pack's manifest.json is not the committed one");
        const tiles = entries.slice(2).map((e) => e.path);
        if (!same(tiles, manifest.files.map((f) => f.path).filter((p) => MINIMAP_TILE_PATH.test(p)).sort())) m7.push("the pack's tiles are not the manifest's, in path order");
      }
    }
  }
  out.push(inputs.packFile === null || !existsSync(inputs.packFile) ? (m7.length > 0 ? check('M7', m7) : { ...check('M7', m7), title: `${MINIMAP_CHECK_TITLES.M7} (the pack is not at hand: pointer and tree hash only)` }) : check('M7', m7));

  // ---- the tiles of levels −1 … −3, decoded (M8, M11)
  const census = manifest !== null && isRecord(manifest.raw['census']) ? manifest.raw['census'] : null;
  const seamMaps: SeamMap[] = placements === null ? [] : [...mapTiles].map(([mapId, tiles]) => {
    const p = placements.find((x) => Number(x.mapId) === mapId);
    return { mapId, eOff: p?.eOff ?? 0, sOff: p?.sOff ?? 0, tiles: [...tiles].sort((a, b) => a.row - b.row || a.col - b.col) };
  });
  const reliefMaps = seamMaps.filter((m) => inputs.reliefs.has(m.mapId));
  const owner = placements === null ? null : pixelOwner(placements, inputs.layout);
  const decoded = new Map<number, Map<string, Uint8Array>>();
  const tilesAvailable = present.length > 0 && manifest !== null && owner !== null && out.find((c) => c.id === 'M6')?.problems.length === 0;
  if (tilesAvailable) {
    for (const z of [-1, -2, -3]) {
      const m = new Map<string, Uint8Array>();
      for (const p of present) {
        const parts = p.split('/');
        if (parts[1] !== String(z)) continue;
        m.set(`${parts[2] ?? ''},${(parts[3] ?? '').replace('.webp', '')}`, await decodeRgb(join(dir, p)));
      }
      decoded.set(z, m);
    }
  }
  const levelTiles = (z: number) => (x: number, y: number): Uint8Array | undefined => decoded.get(z)?.get(`${String(x)},${String(y)}`);

  // ---- M8
  if (!tilesAvailable || owner === null) out.push(skip('M8', inputs.skipTiles ?? 'needs the tiles (the pack is not fetched) and the checks above'));
  else if (census === null || !isRecord(census['rampAgreement'])) out.push(check('M8', ['the manifest has no rampAgreement census']));
  else {
    const m8: string[] = [];
    const L2 = levels.find((l) => l.z === -2);
    const got = rampAgreement(-2, levelTiles(-2), L2?.nx ?? 0, L2?.ny ?? 0, reliefMaps, inputs.reliefs, owner);
    const want = census['rampAgreement'] as Readonly<Record<string, RampAgreement>>;
    const tol = inputs.rampTolerance ?? M8_TOLERANCE;
    for (const [id, g] of Object.entries(got)) {
      const w = want[id];
      if (w === undefined) {
        m8.push(`map ${id}: no census to compare`);
        continue;
      }
      for (const [cls, a, b] of [
        ['water', 'waterOnRamp', 'waterPx'],
        ['land', 'landOnRamp', 'landPx'],
        ['shore land', 'shoreOnRamp', 'shorePx'],
      ] as const) {
        const sg = g[a] / Math.max(1, g[b]);
        const sw = w[a] / Math.max(1, w[b]);
        if (Math.abs(sg - sw) > tol) m8.push(`map ${id}: ${cls} on the navy ramp ${(100 * sg).toFixed(2)} % in the tiles, ${(100 * sw).toFixed(2)} % in the census (tolerance ${String(100 * tol)} points)`);
      }
    }
    const notChecked = seamMaps.filter((m) => !inputs.reliefs.has(m.mapId)).map((m) => m.mapId);
    out.push({ ...check('M8', m8), title: `${MINIMAP_CHECK_TITLES.M8}${notChecked.length > 0 ? `; map ${notChecked.join(', ')} not checked offline (no committed terrain)` : ''}` });
  }

  // ---- M9
  if (owner === null || manifest === null || census === null) out.push(check('M9', ['needs the manifest and the placements']));
  else {
    const maps = isRecord(census['maps']) ? census['maps'] : {};
    const exempt = new Map<number, ReadonlySet<number>>();
    for (const [id, R] of inputs.reliefs) {
      const m = maps[String(id)];
      const skirts = isRecord(m) && Array.isArray(m['skirts']) ? (m['skirts'] as { tile: string; side: 'N' | 'S' | 'W' | 'E' }[]) : [];
      exempt.set(id, skirtReliefCells(skirts, R));
    }
    const under = landUnderSea(inputs.reliefs, seamMaps, owner, seaByLevel, exempt);
    out.push(check('M9', Object.entries(under).filter(([, n]) => n > 0).map(([k, n]) => `${String(n)} relief land cells under sea keys (map:level ${k})`)));
  }

  // ---- M10
  const m10: string[] = [];
  if (manifest === null || census === null) m10.push('needs the manifest and its census');
  else {
    if (!same(manifest.raw['parameters'], minimapParameters())) m10.push("the manifest's parameters are not minimap-params.ts's (rebuild, and have the owner sign off the sheets again)");
    for (const key of ['maps', 'seams', 'seamsReliefMask', 'contrast', 'rampAgreement', 'landUnderSea']) if (!isRecord(census[key])) m10.push(`the census has no ${key}`);
    if (m10.length === 0) {
      const maps = census['maps'] as Readonly<Record<string, NativeCensus & { skirts?: unknown; black?: unknown }>>;
      for (const [id, m] of Object.entries(maps)) {
        if (!Array.isArray(m.skirts)) m10.push(`map ${id}: the census has no edge skirts`);
        if (!isRecord(m.black)) m10.push(`map ${id}: the census has no black components`);
      }
      m10.push(...censusFailures({ maps, seams: census['seams'] as Record<string, SeamLevelCensus>, contrast: census['contrast'] as Contrast, landUnderSea: census['landUnderSea'] as Record<string, number> }));
      if (census['gates'] !== 'pass') m10.push('the census does not record its gates as passed');
    }
  }
  out.push(check('M10', m10));

  // ---- M11
  if (!tilesAvailable || owner === null) out.push(skip('M11', inputs.skipTiles ?? 'needs the tiles (the pack is not fetched) and the checks above'));
  else if (census === null || !isRecord(census['seamsReliefMask'])) out.push(check('M11', ['the manifest has no relief-mask seam census']));
  else {
    const m11: string[] = [];
    const want = census['seamsReliefMask'] as Readonly<Record<string, SeamLevelCensus>>;
    const mask = reliefWetMask(reliefMaps, inputs.reliefs, owner);
    for (const z of SEAM_MEASURE.levels) {
      const got = independentSeams(z, levelTiles(z), reliefMaps, mask);
      for (const [id, g] of Object.entries(got.perMap)) {
        const w = want[String(z)]?.perMap[id];
        if (w === undefined) {
          m11.push(`level ${String(z)}, map ${id}: no census to compare`);
          continue;
        }
        for (const k of ['over4', 'over8'] as const) {
          if (Math.abs(g.edgesLong[k] - w.edgesLong[k]) > M11_TOLERANCE) m11.push(`level ${String(z)}, map ${id}: ${String(g.edgesLong[k])} long edges ${k} in the tiles, ${String(w.edgesLong[k])} in the census`);
        }
      }
    }
    out.push(check('M11', m11));
  }
  return { checks: out, manifest, tilesPresent: present.length };
}
