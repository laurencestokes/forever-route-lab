import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { uiMapId } from '../../../src/domain/ids';
import { isFullUiRectangle } from '../../../src/geo/transforms';
import type { MapGeometry } from '../../../src/geo/types';
import { readImageHeader } from '../../../src/infra/maps/image-header';
import { gzipSize } from '../../build/lib/audit';
import { formatBytes } from '../../build/lib/fs';
import { expectedArtSize } from './art';
import { ART_MANIFEST_FILE, ART_NOTICE_FILE, parseArtManifest, type ParsedArtManifest } from './art-manifest';
import { artNoticeText } from './art-notice';
import type { CheckResult } from './checks';
import { ART_BUDGET_GZIP_BYTES, CLIENT_PIN } from './constants';
import { lfBytes, sha256Hex } from './hash';

/**
 * Offline checks of the committed painted art `public/maps/art/` (docs/MAPS.md §5.5 A1-A5;
 * terrain-navigation.md §13.4, G13; D-033). They need no client, so CI runs them in
 * `pnpm maps:validate`; `convert.ts --check` is the with-client rebuild.
 *
 * - A1 `manifest.json` and `NOTICE.md` exist, and the manifest parses (Blizzard Entertainment as
 *   the owner, the client build equal to the pin, tool tree hashes, every file entry well formed).
 * - A2 every listed image exists with its recorded byte count and SHA-256 and is a still WebP of
 *   its recorded size (headers only), and nothing unlisted is in the folder.
 * - A3 `NOTICE.md` is exactly the text regenerated from the manifest.
 * - A4 against the committed placeholder geometry: every placeholder UiMap has an image, a `sources`
 *   record (composed but not deployed, D-042 O5) or a recorded reason; every image's UiMap is in the
 *   placeholder, has its UiMap's art size, and its `bounds` equal the UiMap's single full-rectangle
 *   row after `Math.fround` (null exactly when there is no such single row, like Azeroth 947 with a
 *   row per continent); with `expectedDeployment` (validate.ts passes `DEPLOYED_ART_UIMAPS`), the
 *   manifest's deployment lists exactly those UiMaps (docs/research/map-atlas.md §7.6, step ATL.10).
 * - A5 the folder is within the `art` budget: gzip-6 of every file, subfolders included,
 *   ≤ 1,000,000 B (D-042 O5, which superseded D-034 item 4's 12 MB; the dist audit also gates
 *   per-file baselines).
 */

const check = (id: string, title: string, problems: readonly string[]): CheckResult => ({ id, title, problems, skipped: null });
const skip = (id: string, title: string, reason: string): CheckResult => ({ id, title, problems: [], skipped: reason });

export interface ArtCheckReport {
  readonly checks: readonly CheckResult[];
  readonly manifest: ParsedArtManifest | null;
  readonly gzipBytes: number | null;
}

export function committedArtChecks(dir: string, placeholder: MapGeometry, expectedDeployment: readonly number[] | null = null): ArtCheckReport {
  const titles = {
    A1: `${ART_MANIFEST_FILE} and ${ART_NOTICE_FILE} exist; the manifest parses, names Blizzard Entertainment and records the pinned build`,
    A2: 'every listed image exists with its byte count and SHA-256, is a still WebP of its recorded size, and nothing else is in the folder',
    A3: `${ART_NOTICE_FILE} is the text regenerated from the manifest`,
    A4: `every placeholder UiMap has an image, a sources record or a recorded reason; sizes and world rectangles equal the committed placeholder${expectedDeployment === null ? '' : `; the deployed images are UiMaps ${expectedDeployment.join(', ')} (D-042 O5)`}`,
    A5: `the folder is within the art budget (${formatBytes(ART_BUDGET_GZIP_BYTES)} gzip-6)`,
  } as const;
  const a1: string[] = [];
  const manifestPath = join(dir, ART_MANIFEST_FILE);
  const noticePath = join(dir, ART_NOTICE_FILE);
  if (!existsSync(dir)) a1.push(`${dir} does not exist; run pnpm tsx tools/maps/convert.ts with the pinned client`);
  if (!existsSync(noticePath)) a1.push(`${ART_NOTICE_FILE} is missing`);
  let manifest: ParsedArtManifest | null = null;
  if (!existsSync(manifestPath)) a1.push(`${ART_MANIFEST_FILE} is missing`);
  else {
    try {
      const parsed = parseArtManifest(JSON.parse(lfBytes(readFileSync(manifestPath)).toString('utf8')) as unknown);
      a1.push(...parsed.errors);
      manifest = parsed.manifest;
    } catch (error) {
      a1.push(`${ART_MANIFEST_FILE}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (manifest !== null) {
    const { client } = manifest;
    if (client.product !== CLIENT_PIN.product || client.version !== CLIENT_PIN.version || client.buildKey !== CLIENT_PIN.buildKey) {
      a1.push(`client ${client.product} ${client.version} (${client.buildKey}) is not the pin ${CLIENT_PIN.product} ${CLIENT_PIN.version}`);
    }
  }
  const checks: CheckResult[] = [check('A1', titles.A1, a1)];
  if (manifest === null) {
    for (const id of ['A2', 'A3', 'A4', 'A5'] as const) checks.push(skip(id, titles[id], 'needs a parsed manifest (A1)'));
    return { checks, manifest, gzipBytes: null };
  }

  const a2: string[] = [];
  const listed = new Set(manifest.files.map((f) => f.path));
  for (const file of manifest.files) {
    const path = join(dir, file.path);
    if (!existsSync(path)) {
      a2.push(`${file.path}: missing`);
      continue;
    }
    const bytes = readFileSync(path);
    if (bytes.length !== file.bytes) a2.push(`${file.path}: ${String(bytes.length)} bytes, the manifest says ${String(file.bytes)}`);
    if (sha256Hex(bytes) !== file.sha256) a2.push(`${file.path}: SHA-256 differs from the manifest`);
    const header = readImageHeader(bytes);
    if (!header.ok) a2.push(`${file.path}: ${header.error}`);
    else if (header.header.contentType !== file.contentType || header.header.width !== file.width || header.header.height !== file.height) {
      a2.push(`${file.path}: headers say ${header.header.contentType} ${String(header.header.width)} × ${String(header.header.height)}, the manifest ${file.contentType} ${String(file.width)} × ${String(file.height)}`);
    }
  }
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    if (name !== ART_MANIFEST_FILE && name !== ART_NOTICE_FILE && !listed.has(name)) a2.push(`${name}: in the folder but not in the manifest`);
  }
  checks.push(check('A2', titles.A2, a2));

  const notice = existsSync(noticePath) ? lfBytes(readFileSync(noticePath)).toString('utf8') : null;
  checks.push(check('A3', titles.A3, notice === null ? [`${ART_NOTICE_FILE} is missing`] : notice === artNoticeText(manifest) ? [] : [`${ART_NOTICE_FILE} differs; regenerate with convert.ts`]));

  const a4: string[] = [];
  const imaged = new Set(manifest.files.map((f) => f.uiMapId));
  const composed = new Set(manifest.sources.map((s) => s.uiMapId));
  const skipped = new Set(manifest.skippedUiMaps);
  for (const id of placeholder.maps.keys()) if (!imaged.has(id) && !composed.has(id) && !skipped.has(id)) a4.push(`UiMap ${String(id)} has no image, no sources record and no recorded reason`);
  if (expectedDeployment !== null) {
    const listed = manifest.deployment?.uiMaps ?? null;
    const want = [...expectedDeployment].sort((a, b) => a - b);
    if (listed === null) a4.push(`the manifest deploys every composed image; D-042 O5 deploys only UiMaps ${want.join(', ')} (regenerate with convert.ts)`);
    else if (listed.length !== want.length || listed.some((id, i) => id !== want[i])) a4.push(`the manifest deploys UiMaps ${listed.join(', ')}; D-042 O5 deploys ${want.join(', ')}`);
  }
  for (const file of manifest.files) {
    const map = placeholder.maps.get(uiMapId(file.uiMapId));
    if (map === undefined) {
      a4.push(`${file.path}: UiMap ${String(file.uiMapId)} is not in the committed placeholder`);
      continue;
    }
    const size = expectedArtSize(file.uiMapId);
    if (file.width !== size.width || file.height !== size.height) a4.push(`${file.path}: ${String(file.width)} × ${String(file.height)}, the UiMap's art is ${String(size.width)} × ${String(size.height)}`);
    const [only] = map.assignments;
    const single = map.assignments.length === 1 && only !== undefined && only.orderIndex === 0 && isFullUiRectangle(only) ? only : null;
    if (single === null) {
      if (file.bounds !== null) a4.push(`${file.path}: records bounds, but its UiMap has no single full-rectangle row`);
      continue;
    }
    const b = file.bounds;
    const f = Math.fround;
    if (b === null) a4.push(`${file.path}: no bounds, but its UiMap has one full-rectangle row`);
    else if (b.assignment !== single.id || b.mapId !== single.mapId || f(b.xMin) !== f(single.xMin) || f(b.xMax) !== f(single.xMax) || f(b.yMin) !== f(single.yMin) || f(b.yMax) !== f(single.yMax)) {
      a4.push(`${file.path}: bounds differ from the committed row ${String(single.id)}`);
    }
  }
  checks.push(check('A4', titles.A4, a4));

  // A5 counts every file under the folder, subfolders included (docs/research/map-atlas.md §7.5)
  let gzipBytes = 0;
  const sum = (folder: string): void => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      const stat = lstatSync(path);
      if (stat.isDirectory()) sum(path);
      else if (stat.isFile()) gzipBytes += gzipSize(readFileSync(path));
    }
  };
  if (existsSync(dir)) sum(dir);
  checks.push(check('A5', `${titles.A5}: ${formatBytes(gzipBytes)}`, gzipBytes <= ART_BUDGET_GZIP_BYTES ? [] : [`${formatBytes(gzipBytes)} gzip-6 is over the budget`]));
  return { checks, manifest, gzipBytes };
}
