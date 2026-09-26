import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { uiMapId } from '../../../src/domain/ids';
import { isFullUiRectangle } from '../../../src/geo/transforms';
import type { MapGeometry } from '../../../src/geo/types';
import { contentTypeOfName, type ImageContentType, readImageHeader } from '../../../src/infra/maps/image-header';
import { compareStrings } from '../../build/lib/fs';
import { expectedAspect } from './checks';
import { ART_SIZE_EXCEPTIONS, ASPECT_TOLERANCE, DEFAULT_ART_SIZE } from './constants';
import { sha256Hex } from './hash';

/**
 * Local map art checks and the manifest's `art` section (docs/MAPS.md §5.2, §5.3, §5.5 L3).
 *
 * A local set's art is `local-maps/art/<uiMapId>.png` or `.webp`: one still image per UiMap,
 * written by the Milestone 3b pipeline (`convert.ts`, which needs the CASC reader) or, until then,
 * placed there by hand (the wow.export Zones tab fallback, MAPS.md §5.4 (c)). Nothing is extracted
 * here. Each file must:
 *
 * - have that exact name, directly in `art/` (no subfolders, links or other files; the OS
 *   thumbnail files in `IGNORED_ART_FILES` are skipped);
 * - be a PNG or WebP whose headers parse and match its extension (`readImageHeader`, shared with
 *   `infra/maps`; no decoding and no new dependency);
 * - belong to a UiMap of `geometry.local.json` with exactly one row, OrderIndex 0 with the full UI
 *   rectangle, so the image covers exactly that world rectangle on one world surface (Azeroth
 *   947, with a row per continent, cannot be drawn this way);
 * - have its UiMap's art size (`LayerWidth × LayerHeight`: 1002 × 668, or 512 × 512 for 1463, 1464
 *   and 2665), and an aspect equal to its world rectangle's within 0.2% (2665 is exempt: a
 *   1.5-aspect region on square art), so the image lines up with the geometry.
 *
 * The section `--activate` writes lists each file with its type, size, SHA-256 (of the file's
 * bytes as they are; images are never LF-normalised) and the row it covers.
 */

export const LOCAL_ART_DIR = 'art';
/** Operating-system thumbnail and folder files that may appear next to images; never art. */
export const IGNORED_ART_FILES: readonly string[] = ['Thumbs.db', 'desktop.ini', '.DS_Store'];

const ART_NAME = /^([1-9][0-9]*)\.(png|webp)$/;

/** The world rectangle an image covers: its UiMap's single row (assignment ID, world map, edges). */
export interface ArtBounds {
  readonly assignment: number;
  readonly mapId: number;
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

/** One entry of the manifest's `art` section (MAPS.md §5.3). */
export interface ArtManifestEntry {
  /** Relative to `local-maps/`: `art/<uiMapId>.png|webp`. */
  readonly file: string;
  readonly contentType: ImageContentType;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly bounds: ArtBounds;
}

/** Keyed by UiMapID as a decimal string; integer-like keys iterate (and are written) ascending. */
export type ArtSection = Readonly<Record<string, ArtManifestEntry>>;

export interface ArtScan {
  readonly problems: readonly string[];
  /** The files that passed every check; the manifest's section when `problems` is empty. */
  readonly art: ArtSection;
}

/** The art size L3 expects for a UiMap (`UiMapArtStyleLayer` at 1.60.1.70009, lib/constants.ts). */
export function expectedArtSize(id: number): { readonly width: number; readonly height: number } {
  return ART_SIZE_EXCEPTIONS[id] ?? DEFAULT_ART_SIZE;
}

/** Checks every file under `<dir>/art/` against `local` (the set's `geometry.local.json`). */
export function scanArt(dir: string, local: MapGeometry): ArtScan {
  const artDir = join(dir, LOCAL_ART_DIR);
  if (!existsSync(artDir)) return { problems: [], art: {} };
  if (!lstatSync(artDir).isDirectory()) return { problems: [`${LOCAL_ART_DIR} is not a folder (a link to one is not followed)`], art: {} };
  const problems: string[] = [];
  const art: Record<string, ArtManifestEntry> = {};
  const seen = new Map<string, string>();
  const entries = readdirSync(artDir, { withFileTypes: true }).sort((a, b) => compareStrings(a.name, b.name));
  for (const entry of entries) {
    const file = `${LOCAL_ART_DIR}/${entry.name}`;
    if (IGNORED_ART_FILES.includes(entry.name)) continue;
    if (entry.isSymbolicLink()) {
      problems.push(`${file}: a link, which is not followed; put the image itself there`);
      continue;
    }
    if (entry.isDirectory()) {
      problems.push(`${file}/: art must sit directly in ${LOCAL_ART_DIR}/ as <uiMapId>.png or <uiMapId>.webp`);
      continue;
    }
    const name = ART_NAME.exec(entry.name);
    const key = name?.[1];
    if (!entry.isFile() || name === null || key === undefined || !Number.isSafeInteger(Number(key))) {
      problems.push(`${file}: not an art file name (expected <uiMapId>.png or <uiMapId>.webp)`);
      continue;
    }
    const other = seen.get(key);
    if (other !== undefined) {
      problems.push(`${file}: UiMap ${key} already has ${other}`);
      continue;
    }
    seen.set(key, file);
    const bytes = readFileSync(join(artDir, entry.name));
    const header = readImageHeader(bytes);
    if (!header.ok) {
      problems.push(`${file}: ${header.error}`);
      continue;
    }
    const { contentType, width, height } = header.header;
    if (contentType !== contentTypeOfName(entry.name)) {
      problems.push(`${file}: the file is a ${contentType}, its name says otherwise`);
      continue;
    }
    const id = Number(key);
    const map = local.maps.get(uiMapId(id));
    if (map === undefined) {
      problems.push(`${file}: UiMap ${key} is not in geometry.local.json`);
      continue;
    }
    const [row, ...others] = map.assignments;
    if (row === undefined || others.length > 0 || row.orderIndex !== 0 || !isFullUiRectangle(row)) {
      const maps = [...new Set(map.assignments.map((r) => r.mapId))].join(', ');
      problems.push(`${file}: UiMap ${key} has ${String(map.assignments.length)} row(s) on world map(s) ${maps}, not one full-rectangle row, so its art cannot be placed on one world surface`);
      continue;
    }
    const size = expectedArtSize(id);
    if (width !== size.width || height !== size.height) {
      problems.push(`${file}: ${String(width)} × ${String(height)} pixels, UiMap ${key}'s art is ${String(size.width)} × ${String(size.height)} (LayerWidth × LayerHeight)`);
      continue;
    }
    if (expectedAspect(id) !== null) {
      const worldAspect = (row.yMax - row.yMin) / (row.xMax - row.xMin);
      const error = Math.abs(width / height / worldAspect - 1);
      if (error > ASPECT_TOLERANCE) {
        problems.push(`${file}: the image aspect is ${(100 * error).toFixed(3)}% off its world rectangle's (row ${String(row.id)}; tolerance ${String(100 * ASPECT_TOLERANCE)}%)`);
        continue;
      }
    }
    art[key] = {
      file,
      contentType,
      width,
      height,
      sha256: sha256Hex(bytes),
      bounds: { assignment: row.id, mapId: row.mapId, xMin: row.xMin, xMax: row.xMax, yMin: row.yMin, yMax: row.yMax },
    };
  }
  return { problems, art };
}

type Json = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * How a manifest's recorded `art` section differs from the set on disk (`actual`, from
 * `scanArt`): unlisted or missing files, changed hashes, sizes, types and bounds. A manifest
 * without an `art` key (written before art support) counts as listing none.
 */
export function artSectionDrift(recorded: unknown, actual: ArtSection): readonly string[] {
  if (recorded !== undefined && !isRecord(recorded)) return ['its art section is not an object'];
  const listed: Json = recorded ?? {};
  const problems: string[] = [];
  const keys = [...new Set([...Object.keys(listed), ...Object.keys(actual)])].sort((a, b) => Number(a) - Number(b));
  for (const key of keys) {
    const want = actual[key];
    const got = listed[key];
    if (want === undefined) {
      problems.push(`art for UiMap ${key} is listed, but its file is missing or fails L3`);
      continue;
    }
    if (!isRecord(got)) {
      problems.push(`${want.file} is not listed`);
      continue;
    }
    if (got['sha256'] !== want.sha256) {
      problems.push(`${want.file} changed after activation (SHA-256 ${want.sha256.slice(0, 12)}…, the manifest records ${String(got['sha256']).slice(0, 12)}…)`);
      continue;
    }
    for (const field of ['file', 'contentType', 'width', 'height', 'bounds'] as const) {
      if (JSON.stringify(got[field]) !== JSON.stringify(want[field])) {
        problems.push(`${want.file}: ${field} is ${JSON.stringify(want[field])}, the manifest records ${JSON.stringify(got[field]) ?? 'nothing'}`);
      }
    }
  }
  return problems;
}
