import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { atlasHash, atlasPlacements } from '../../../src/geo/atlas';
import type { AtlasLayout } from '../../../src/geo/atlas-layout';
import type { MapGeometry } from '../../../src/geo/types';
import { readImageHeader } from '../../../src/infra/maps/image-header';
import { gzipSize } from '../../build/lib/audit';
import { formatBytes } from '../../build/lib/fs';
import type { ArtSourceEntry } from './art-manifest';
import { ATLAS_INDEX_FILE, indexKeys, parseAtlasIndex, type AtlasIndex } from './atlas-index';
import type { AtlasLabelList } from './atlas-labels';
import { ATLAS_MANIFEST_FILE, ATLAS_NOTICE_FILE, ATLAS_TILE_PATH, parseAtlasManifest, type ParsedAtlasManifest } from './atlas-manifest';
import { atlasNoticeText } from './atlas-notice';
import { ATLAS_CENSUS_RECORDED, TILE } from './atlas-params';
import type { CheckResult } from './checks';
import { CLIENT_PIN } from './constants';
import { lfBytes, sha256Hex } from './hash';

/**
 * Offline checks of the committed atlas `public/maps/atlas/` (docs/research/map-atlas.md §7.5,
 * T1-T9). They need no client, so CI runs them in `pnpm maps:validate`; `atlas.ts --check` is the
 * with-client rebuild. A1-A5 (art-checks.ts) keep checking `public/maps/art/`.
 *
 * - T1 `manifest.json`, `index.json` and `NOTICE.md` parse; the NOTICE is the text regenerated
 *   from the manifest.
 * - T2 every file is listed with its byte count and SHA-256, every tile is a 256 px still WebP, and
 *   nothing unlisted is in the folder (subfolders included).
 * - T3 the index's stored keys equal the manifest's tiles, and its sea keys the manifest's sea list.
 * - T4 `atlasHash` (manifest and index) equals `src/geo`'s value for the committed geometry and
 *   `ATLAS_LAYOUT`.
 * - T5 each source's `pixelsSha256`, `overlaysSha256` and `inputHash` equal the art manifest's
 *   `sources` records (which `convert.ts --check` recomputes from the client).
 * - T6 the budget: the folder, each file, and each level within its baseline + tolerance.
 * - T7 the censuses: the coverage census within the recorded values + 0.5 percentage points; the
 *   lettering census has no cut label at any level, every listed label is whole or hidden as its
 *   rule says, and the candidate count is the recorded one.
 * - T8 every placed zone and city appears at its top level (a stored tile of that level meets its
 *   rectangle).
 * - T9 every entry of `atlas-labels.json` carries its painting's current `pixelsSha256`, and the
 *   manifest was built from the list as it is now.
 */

export interface AtlasBudget {
  readonly totalGzipBytes: number;
  readonly perFileGzipCapBytes: number;
  readonly tolerance: number;
  /** Level (as a string, `-8` … `0`) → recorded gzip bytes of its tiles. */
  readonly levelBaselines: Readonly<Record<string, number>>;
}

export interface AtlasCheckInputs {
  readonly dir: string;
  readonly geometry: MapGeometry;
  readonly layout: AtlasLayout;
  /** The committed art manifest's `sources` records. */
  readonly artSources: readonly ArtSourceEntry[];
  readonly labels: AtlasLabelList;
  readonly labelsSha256: string;
  readonly budget: AtlasBudget | null;
  /** The census values T7 compares with (default: the recorded values of atlas-params.ts). */
  readonly recorded?: AtlasCensusRecorded;
}

export interface AtlasCensusRecorded {
  readonly coverage: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly letteringCandidates: number;
}

export interface AtlasCheckReport {
  readonly checks: readonly CheckResult[];
  readonly manifest: ParsedAtlasManifest | null;
  readonly gzipBytes: number | null;
}

const check = (id: string, title: string, problems: readonly string[]): CheckResult => ({ id, title, problems, skipped: null });
const skip = (id: string, title: string, reason: string): CheckResult => ({ id, title, problems: [], skipped: reason });

/** Every file under `dir`, relative, `/`-separated. */
export function listAtlasTree(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    if (statSync(path).isDirectory()) out.push(...listAtlasTree(path, rel));
    else out.push(rel);
  }
  return out;
}

const readJson = (path: string): unknown => JSON.parse(lfBytes(readFileSync(path)).toString('utf8')) as unknown;

export function committedAtlasChecks(inputs: AtlasCheckInputs): AtlasCheckReport {
  const { dir } = inputs;
  const titles = {
    T1: `${ATLAS_MANIFEST_FILE}, ${ATLAS_INDEX_FILE} and ${ATLAS_NOTICE_FILE} parse; the NOTICE is the text regenerated from the manifest`,
    T2: 'every file is listed with its bytes and SHA-256, every tile is a 256 px still WebP, and nothing unlisted is in the folder',
    T3: "the index's stored and sea keys equal the manifest's tiles and sea list",
    T4: "atlasHash equals src/geo's value for the committed geometry and ATLAS_LAYOUT",
    T5: "every source's pixel, overlay and input hashes equal the art manifest's sources records",
    T6: 'the atlas budget: folder total, per-file cap and per-level baselines',
    T7: 'coverage census within the recorded values + 0.5 points; lettering census: no cut label, every listed label as its rule says',
    T8: 'every placed zone and city appears at its top level',
    T9: 'every atlas-labels.json entry carries its painting\'s current pixelsSha256; the manifest was built from the list as it is',
  } as const;
  const t1: string[] = [];
  let manifest: ParsedAtlasManifest | null = null;
  let index: AtlasIndex | null = null;
  if (!existsSync(dir)) t1.push(`${dir} does not exist; run pnpm tsx tools/maps/atlas.ts with the pinned client`);
  const manifestPath = join(dir, ATLAS_MANIFEST_FILE);
  const indexPath = join(dir, ATLAS_INDEX_FILE);
  const noticePath = join(dir, ATLAS_NOTICE_FILE);
  if (!existsSync(manifestPath)) t1.push(`${ATLAS_MANIFEST_FILE} is missing`);
  else {
    try {
      const parsed = parseAtlasManifest(readJson(manifestPath));
      t1.push(...parsed.errors.map((e) => `${ATLAS_MANIFEST_FILE}: ${e}`));
      manifest = parsed.manifest;
    } catch (error) {
      t1.push(`${ATLAS_MANIFEST_FILE}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!existsSync(indexPath)) t1.push(`${ATLAS_INDEX_FILE} is missing`);
  else {
    try {
      const parsed = parseAtlasIndex(readJson(indexPath));
      t1.push(...parsed.errors.map((e) => `${ATLAS_INDEX_FILE}: ${e}`));
      index = parsed.index;
    } catch (error) {
      t1.push(`${ATLAS_INDEX_FILE}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!existsSync(noticePath)) t1.push(`${ATLAS_NOTICE_FILE} is missing`);
  else if (manifest !== null && lfBytes(readFileSync(noticePath)).toString('utf8') !== atlasNoticeText(manifest)) t1.push(`${ATLAS_NOTICE_FILE} differs from the text regenerated from the manifest; rebuild with atlas.ts`);
  if (manifest !== null) {
    const c = manifest.client;
    if (c.product !== CLIENT_PIN.product || c.version !== CLIENT_PIN.version || c.buildKey !== CLIENT_PIN.buildKey) t1.push(`client ${c.product} ${c.version} is not the pin ${CLIENT_PIN.product} ${CLIENT_PIN.version}`);
  }
  const checks: CheckResult[] = [check('T1', titles.T1, t1)];
  if (manifest === null || index === null) {
    for (const id of ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9'] as const) checks.push(skip(id, titles[id], 'needs a parsed manifest and index (T1)'));
    return { checks, manifest, gzipBytes: null };
  }
  const m = manifest;

  // T2
  const t2: string[] = [];
  const listed = new Map(m.files.map((f) => [f.path, f]));
  let gzipBytes = 0;
  const perLevel = new Map<string, number>();
  let largest = { path: '', gzip: 0 };
  for (const f of m.files) {
    const path = join(dir, f.path);
    if (!existsSync(path)) {
      t2.push(`${f.path}: missing`);
      continue;
    }
    const bytes = readFileSync(path);
    if (bytes.length !== f.bytes) t2.push(`${f.path}: ${String(bytes.length)} bytes, the manifest says ${String(f.bytes)}`);
    if (sha256Hex(bytes) !== f.sha256) t2.push(`${f.path}: SHA-256 differs from the manifest`);
    if (ATLAS_TILE_PATH.test(f.path)) {
      const header = readImageHeader(bytes);
      if (!header.ok) t2.push(`${f.path}: ${header.error}`);
      else if (header.header.contentType !== 'image/webp' || header.header.width !== TILE || header.header.height !== TILE) t2.push(`${f.path}: not a ${String(TILE)} px WebP`);
      const g = gzipSize(bytes);
      const z = f.path.split('/')[1] ?? '';
      perLevel.set(z, (perLevel.get(z) ?? 0) + g);
      if (g > largest.gzip) largest = { path: f.path, gzip: g };
    }
  }
  for (const name of listAtlasTree(dir)) {
    const path = join(dir, name);
    if (name !== ATLAS_MANIFEST_FILE && name !== ATLAS_NOTICE_FILE && !listed.has(name)) t2.push(`${name}: in the folder but not in the manifest`);
    gzipBytes += gzipSize(readFileSync(path));
  }
  checks.push(check('T2', titles.T2, t2));

  // T3
  const t3: string[] = [];
  const tileKeys = new Set(m.files.filter((f) => ATLAS_TILE_PATH.test(f.path)).map((f) => f.path));
  const indexed = new Set<string>();
  for (const level of index.levels) {
    const keys = indexKeys(level);
    for (const [x, y] of keys.stored) indexed.add(`t/${String(level.z)}/${String(x)}/${String(y)}.webp`);
    const want = (m.seaKeys[String(level.z)] ?? []).map(([x, y]) => `${String(x)},${String(y)}`).sort();
    const got = (keys.sea ?? []).map(([x, y]) => `${String(x)},${String(y)}`).sort();
    if (keys.sea !== null && want.join(' ') !== got.join(' ')) t3.push(`level ${String(level.z)}: the index's sea keys differ from the manifest's (${String(got.length)} against ${String(want.length)})`);
    if (keys.sea === null && m.seaKeys[String(level.z)] !== undefined) t3.push(`level ${String(level.z)}: the manifest lists sea keys the index has no bitmap for`);
    for (const [x, y] of keys.sea ?? []) if (indexed.has(`t/${String(level.z)}/${String(x)}/${String(y)}.webp`)) t3.push(`level ${String(level.z)}: key ${String(x)},${String(y)} is both stored and sea`);
  }
  for (const k of tileKeys) if (!indexed.has(k)) t3.push(`${k}: listed in the manifest but not stored in the index`);
  for (const k of indexed) if (!tileKeys.has(k)) t3.push(`${k}: stored in the index but not listed in the manifest`);
  checks.push(check('T3', titles.T3, t3));

  // T4
  const t4: string[] = [];
  const placements = atlasPlacements(inputs.geometry, inputs.layout);
  if (placements === null) t4.push(`the committed geometry cannot place the ${inputs.layout.name} layout`);
  else {
    const want = atlasHash(placements, inputs.layout);
    if (m.atlasHash !== want) t4.push(`manifest atlasHash ${m.atlasHash}, src/geo gives ${want}: the layout or the 947 rows changed; rebuild the atlas`);
    if (index.atlasHash !== want) t4.push(`index atlasHash ${index.atlasHash}, src/geo gives ${want}`);
    if (index.layout !== inputs.layout.name || m.layout !== inputs.layout.name) t4.push(`built for the ${index.layout} layout, ATLAS_LAYOUT is ${inputs.layout.name}`);
  }
  checks.push(check('T4', titles.T4, t4));

  // T5
  const t5: string[] = [];
  const art = new Map(inputs.artSources.map((s) => [s.uiMapId, s]));
  for (const s of m.sources) {
    const a = art.get(s.uiMapId);
    if (a === undefined) t5.push(`UiMap ${String(s.uiMapId)} (${s.name}): the art manifest has no sources record`);
    else if (a.pixelsSha256 !== s.pixelsSha256 || a.overlaysSha256 !== s.overlaysSha256 || a.inputHash !== s.inputHash) t5.push(`UiMap ${String(s.uiMapId)} (${s.name}): hashes differ from the art manifest's sources record`);
  }
  checks.push(check('T5', titles.T5, t5));

  // T6
  if (inputs.budget === null) checks.push(skip('T6', titles.T6, 'no atlas budget in tools/build/dist-requirements.json'));
  else {
    const b = inputs.budget;
    const t6: string[] = [];
    if (gzipBytes > b.totalGzipBytes) t6.push(`${formatBytes(gzipBytes)} gzip-6 is over the ${formatBytes(b.totalGzipBytes)} budget (D-042 O5)`);
    if (largest.gzip > b.perFileGzipCapBytes) t6.push(`${largest.path}: ${formatBytes(largest.gzip)} gzip-6 is over the ${formatBytes(b.perFileGzipCapBytes)} per-file cap`);
    for (const [z, g] of perLevel) {
      const base = b.levelBaselines[z];
      if (base === undefined) t6.push(`level ${z}: no baseline recorded`);
      else if (g > Math.floor(base * (1 + b.tolerance))) t6.push(`level ${z}: ${formatBytes(g)} gzip-6 exceeds its baseline ${formatBytes(base)} + ${String(Math.round(b.tolerance * 100))}%`);
    }
    checks.push(check('T6', `${titles.T6}: ${formatBytes(gzipBytes)} of ${formatBytes(b.totalGzipBytes)}, largest tile ${formatBytes(largest.gzip)}`, t6));
  }

  // T7
  const t7: string[] = [];
  const census = m.census as { coverage?: { byMap?: Record<string, Record<string, number>> }; lettering?: { candidates?: number; atBaseLevel?: Record<string, number>; atFineLevels?: Record<string, number>; entries?: { index: number; state: string; fineState: string; label?: string }[] } };
  const cov = census.coverage?.byMap ?? {};
  const recorded: AtlasCensusRecorded = inputs.recorded ?? ATLAS_CENSUS_RECORDED;
  for (const [mapId, rec] of Object.entries(recorded.coverage)) {
    const got = cov[mapId];
    if (got === undefined) {
      t7.push(`coverage census: map ${mapId} missing`);
      continue;
    }
    for (const [key, want] of Object.entries(rec)) {
      const v = got[key];
      if (typeof v !== 'number' || Math.abs(v - want) > 0.5) t7.push(`coverage census map ${mapId} ${key}: ${String(v)} %, recorded ${String(want)} % (± 0.5)`);
    }
  }
  const lettering = census.lettering;
  if (lettering === undefined) t7.push('the lettering census is missing');
  else {
    if ((lettering.atBaseLevel?.['cut'] ?? 1) !== 0) t7.push(`lettering census: ${String(lettering.atBaseLevel?.['cut'])} label(s) cut at level −2`);
    if ((lettering.atFineLevels?.['cut'] ?? 1) !== 0) t7.push(`lettering census: ${String(lettering.atFineLevels?.['cut'])} label(s) cut at levels −1 and 0`);
    if (lettering.candidates !== recorded.letteringCandidates) t7.push(`lettering census: ${String(lettering.candidates)} candidates, recorded ${String(recorded.letteringCandidates)}: a painting or the detector changed; review the contact sheet`);
    const entries = lettering.entries ?? [];
    if (entries.length !== inputs.labels.labels.length) t7.push(`the lettering census tests ${String(entries.length)} list entries, atlas-labels.json has ${String(inputs.labels.labels.length)}`);
    for (const e of entries) {
      const entry = inputs.labels.labels[e.index];
      if (entry === undefined) continue;
      // A whole rule: whole at −2, and whole at −1/0 unless a banner's hide rule covers it there.
      // A hide rule at every level: hidden everywhere. A banner's hide rule (levels −1 and 0): hidden
      // there; its letters are tested at −2 through the detector's candidates (a banner box also
      // holds the scroll's ends, which may fade at a frame or coast), so its own box is not gated at −2.
      const ok =
        entry.rule === 'whole'
          ? e.state === 'whole-by-rule' && (e.fineState === 'whole-by-rule' || e.fineState === 'hidden-by-rule')
          : entry.levels === 'all'
            ? e.state === 'hidden-by-rule' && e.fineState === 'hidden-by-rule'
            : e.fineState === 'hidden-by-rule';
      if (!ok) t7.push(`atlas-labels.json labels[${String(e.index)}] (${entry.label}): found ${e.state} at −2 and ${e.fineState} at −1/0, the rule says ${entry.rule} (${entry.levels})`);
    }
  }
  checks.push(check('T7', titles.T7, t7));

  // T8
  const t8: string[] = [];
  const stored = new Map<number, [number, number][]>();
  for (const k of tileKeys) {
    const [, z, x, y] = k.replace('.webp', '').split('/');
    const list = stored.get(Number(z)) ?? [];
    list.push([Number(x), Number(y)]);
    stored.set(Number(z), list);
  }
  for (const s of m.sources) {
    if (s.role === 'read') continue;
    const z = s.topLevel;
    const size = TILE * 2 ** -z;
    const r = s.atlasRect;
    const hit = (stored.get(z) ?? []).some(([x, y]) => x * size < r.eMax && (x + 1) * size > r.eMin && y * size < r.sMax && (y + 1) * size > r.sMin);
    if (!hit) t8.push(`UiMap ${String(s.uiMapId)} (${s.name}): no stored tile at its top level ${String(z)}`);
  }
  checks.push(check('T8', titles.T8, t8));

  // T9
  const t9: string[] = [];
  for (const [i, e] of inputs.labels.labels.entries()) {
    const a = art.get(e.uiMapId);
    if (a === undefined) t9.push(`labels[${String(i)}] (${e.label}): UiMap ${String(e.uiMapId)} has no art sources record`);
    else if (a.pixelsSha256 !== e.pixelsSha256) t9.push(`labels[${String(i)}] (${e.label}): the painting's pixels changed; review the entry on the contact sheet`);
  }
  if (m.labelsSha256 !== inputs.labelsSha256) t9.push('atlas-labels.json changed after the atlas was built; rebuild with atlas.ts and review the contact sheet');
  checks.push(check('T9', titles.T9, t9));
  return { checks, manifest, gzipBytes };
}

/** The atlas folder's budget from tools/build/dist-requirements.json (its `mapFolders` entry with a `tiled` section), or null. */
export function atlasBudgetFrom(requirements: unknown, dir = 'maps/atlas'): AtlasBudget | null {
  if (typeof requirements !== 'object' || requirements === null) return null;
  const folders = (requirements as { mapFolders?: unknown }).mapFolders;
  if (!Array.isArray(folders)) return null;
  const entry = folders.find((f: unknown): f is Record<string, unknown> => typeof f === 'object' && f !== null && (f as Record<string, unknown>)['dir'] === dir);
  const tiled = entry?.['tiled'];
  if (entry === undefined || typeof tiled !== 'object' || tiled === null) return null;
  const t = tiled as Record<string, unknown>;
  const levels = t['levelBaselines'];
  return {
    totalGzipBytes: Number(entry['totalGzipBudgetBytes']),
    perFileGzipCapBytes: Number(t['perFileGzipCapBytes']),
    tolerance: Number(entry['baselineTolerance']),
    levelBaselines: typeof levels === 'object' && levels !== null ? Object.fromEntries(Object.entries(levels).filter(([k]) => !k.startsWith('$')).map(([k, v]) => [k, Number(v)])) : {},
  };
}
