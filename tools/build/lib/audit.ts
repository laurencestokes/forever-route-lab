import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { compareStrings, formatBytes, listFiles } from './fs';
import { matchesAnyGlob } from './glob';
import {
  CACHE_DIRECTORY_REFERENCE,
  findPattern,
  findPrivacyLeaks,
  LOCAL_ONLY_MARKER,
  looksBinary,
  SAVED_VARIABLES_PATH,
  USER_PROFILE_PATH,
} from './patterns';

/**
 * dist/ audit rules (docs/ARCHITECTURE.md §14, §16; docs/MAPS.md §5.7; D-018, D-025). Every
 * rule is a function of file paths and bytes, so tests run it against temporary fixture trees.
 * The audit is a guard, not proof: inspect a release manually as well.
 */

export interface AuditViolation {
  readonly rule: string;
  /** dist-relative path, or null for a whole-build finding. */
  readonly path: string | null;
  readonly message: string;
}

export interface AllowedImage {
  readonly glob: string;
  readonly reason: string;
}

/** A gzip budget over a folder of dist/: every file within its baseline + tolerance, the folder within its total. */
export interface GzipBudget {
  readonly totalGzipBudgetBytes: number;
  /** A file may grow to baseline × (1 + tolerance) before the gate fails. */
  readonly baselineTolerance: number;
  /** dist-relative path → recorded gzip bytes. */
  readonly baselines: Readonly<Record<string, number>>;
}

/**
 * A committed map folder whose images are allowed in dist/ (D-032, D-033; terrain-navigation.md
 * §13.3, the one image allowlist): only when the folder's `NOTICE.md` and `manifest.json` ship with
 * it and the manifest lists the file (`files[].path`, relative to the folder) with its SHA-256.
 */
export interface MapFolder extends GzipBudget {
  /** Budget name in reports and messages (`art`, `terrain`). */
  readonly name: string;
  /** dist-relative folder, e.g. `maps/art`. */
  readonly dir: string;
  /** Repository folder it is built from; the folder is required in dist/ once `<source>/manifest.json` exists. */
  readonly source: string;
  readonly reason: string;
}

/**
 * The navigation data budget (D-030; terrain-navigation.md §14.3): a hard cap on the whole `nav/`
 * folder, a cap per file, and per-map totals within their recorded baselines + tolerance. Once the
 * repository has `activatedBy`, `required` must ship and every map folder needs a baseline.
 */
export interface NavBudget {
  readonly dir: string;
  readonly activatedBy: string;
  readonly required: readonly string[];
  readonly totalGzipBudgetBytes: number;
  /** D-030's target band; reported, not gated. */
  readonly targetGzipBytes: { readonly min: number; readonly max: number };
  readonly perFileGzipCapBytes: number;
  readonly baselineTolerance: number;
  /** Map ID → recorded gzip bytes of `nav/<mapId>/`. */
  readonly mapBaselines: Readonly<Record<string, number>>;
}

export interface DistRequirements {
  /** Files every build must contain (Milestone 1). */
  readonly required: readonly string[];
  /**
   * Files required once `activatedBy` (a repository-relative path, normally
   * public/data/manifest.json) exists. The dataset manifest's `outputs[].path` entries are then
   * required under data/ as well.
   */
  readonly milestone2: { readonly activatedBy: string; readonly required: readonly string[] };
  readonly allowedImages: readonly AllowedImage[];
  /** ARCHITECTURE §14: entry chunk plus its static imports, gzip. */
  readonly entryChunkGzipBudgetBytes: number;
  readonly data: GzipBudget;
  /** The committed map folders allowed to ship images (the art and the terrain byproducts). */
  readonly mapFolders: readonly MapFolder[];
  /** The navigation data budget, or null when none is configured. */
  readonly nav: NavBudget | null;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringList = (value: unknown, where: string): readonly string[] => {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new Error(`dist-requirements.json: ${where} must be an array of strings`);
  }
  return value;
};

const positiveNumber = (value: unknown, where: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`dist-requirements.json: ${where} must be a non-negative number`);
  }
  return value;
};

/** Validates dist-requirements.json; throws with the offending field on any other shape. */
export function parseDistRequirements(value: unknown): DistRequirements {
  if (!isRecord(value)) throw new Error('dist-requirements.json: expected an object');
  const m2 = value.milestone2;
  if (!isRecord(m2) || typeof m2.activatedBy !== 'string') {
    throw new Error('dist-requirements.json: milestone2 needs "activatedBy" and "required"');
  }
  if (!Array.isArray(value.allowedImages)) throw new Error('dist-requirements.json: allowedImages must be an array');
  const allowedImages = (value.allowedImages as readonly unknown[]).map((entry, index): AllowedImage => {
    if (!isRecord(entry) || typeof entry.glob !== 'string' || typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      throw new Error(`dist-requirements.json: allowedImages[${String(index)}] needs "glob" and a non-empty "reason"`);
    }
    return { glob: entry.glob, reason: entry.reason };
  });
  const data = value.data;
  if (!isRecord(data) || !isRecord(data.baselines)) throw new Error('dist-requirements.json: data needs "baselines"');
  const mapFolders = value.mapFolders === undefined ? [] : value.mapFolders;
  if (!Array.isArray(mapFolders)) throw new Error('dist-requirements.json: mapFolders must be an array');
  const folders = (mapFolders as readonly unknown[]).map((entry, index): MapFolder => {
    const where = `mapFolders[${String(index)}]`;
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.dir !== 'string' || typeof entry.source !== 'string' || typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      throw new Error(`dist-requirements.json: ${where} needs "name", "dir", "source" and a non-empty "reason"`);
    }
    if (!/^[a-z0-9]+(\/[a-z0-9]+)*$/.test(entry.dir)) throw new Error(`dist-requirements.json: ${where}.dir must be a plain relative folder`);
    return { name: entry.name, dir: entry.dir, source: entry.source, reason: entry.reason, ...readBudget(entry, where) };
  });
  return {
    required: stringList(value.required, 'required'),
    milestone2: { activatedBy: m2.activatedBy, required: stringList(m2.required, 'milestone2.required') },
    allowedImages,
    entryChunkGzipBudgetBytes: positiveNumber(value.entryChunkGzipBudgetBytes, 'entryChunkGzipBudgetBytes'),
    data: readBudget(data, 'data'),
    mapFolders: folders,
    nav: value.nav === undefined || value.nav === null ? null : readNav(value.nav),
  };
}

function readBudget(value: Readonly<Record<string, unknown>>, where: string): GzipBudget {
  if (!isRecord(value.baselines)) throw new Error(`dist-requirements.json: ${where} needs "baselines"`);
  // fromEntries defines own properties, so no path (not even `__proto__`) reaches a setter.
  const baselines: Readonly<Record<string, number>> = Object.fromEntries(
    Object.entries(value.baselines)
      .filter(([path]) => !path.startsWith('$'))
      .map(([path, bytes]) => [path, positiveNumber(bytes, `${where}.baselines["${path}"]`)]),
  );
  return {
    totalGzipBudgetBytes: positiveNumber(value.totalGzipBudgetBytes, `${where}.totalGzipBudgetBytes`),
    baselineTolerance: positiveNumber(value.baselineTolerance, `${where}.baselineTolerance`),
    baselines,
  };
}

function readNav(value: unknown): NavBudget {
  if (!isRecord(value) || typeof value.dir !== 'string' || typeof value.activatedBy !== 'string' || !isRecord(value.targetGzipBytes) || !isRecord(value.mapBaselines)) {
    throw new Error('dist-requirements.json: nav needs "dir", "activatedBy", "targetGzipBytes" and "mapBaselines"');
  }
  const target = value.targetGzipBytes;
  const mapBaselines: Readonly<Record<string, number>> = Object.fromEntries(
    Object.entries(value.mapBaselines)
      .filter(([key]) => !key.startsWith('$'))
      .map(([key, bytes]) => {
        if (!/^(0|[1-9]\d*)$/.test(key)) throw new Error(`dist-requirements.json: nav.mapBaselines key "${key}" is not a map ID`);
        return [key, positiveNumber(bytes, `nav.mapBaselines["${key}"]`)];
      }),
  );
  return {
    dir: value.dir,
    activatedBy: value.activatedBy,
    required: stringList(value.required, 'nav.required'),
    totalGzipBudgetBytes: positiveNumber(value.totalGzipBudgetBytes, 'nav.totalGzipBudgetBytes'),
    targetGzipBytes: { min: positiveNumber(target.min, 'nav.targetGzipBytes.min'), max: positiveNumber(target.max, 'nav.targetGzipBytes.max') },
    perFileGzipCapBytes: positiveNumber(value.perFileGzipCapBytes, 'nav.perFileGzipCapBytes'),
    baselineTolerance: positiveNumber(value.baselineTolerance, 'nav.baselineTolerance'),
    mapBaselines,
  };
}

// ---------------------------------------------------------------------------------------------
// Path rules

/** Blizzard client formats, raw Lua and source maps never ship (ARCHITECTURE §16). */
/**
 * Raw Lua, source maps and raw Blizzard client files. The client types include the terrain,
 * object and model files `tools/terrain` reads (ADT, WDT, WDL, WMO, M2 and its skins; G13 of
 * terrain-navigation.md §16), not only the map-art inputs (BLP, DB2).
 */
export const FORBIDDEN_EXTENSIONS: readonly string[] = ['.lua', '.blp', '.m2', '.skin', '.anim', '.adt', '.wdt', '.wdl', '.wmo', '.db2', '.dbc', '.map'];

export const IMAGE_EXTENSIONS: readonly string[] = [
  '.apng', '.avif', '.bmp', '.gif', '.heic', '.heif', '.ico', '.jpeg', '.jpg', '.jxl', '.png', '.svg', '.tga',
  '.tif', '.tiff', '.webp',
];

const extensionOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
};

/** local-maps/, maps manifests, forbidden file types and tool or VCS folders. */
export function checkForbiddenPaths(files: readonly string[]): readonly AuditViolation[] {
  const out: AuditViolation[] = [];
  for (const path of files) {
    const segments = path.split('/');
    const base = segments[segments.length - 1] ?? '';
    if (segments.includes('local-maps')) {
      out.push({ rule: 'local-maps', path, message: 'local map sets must never be deployed (D-018)' });
    }
    if (base.toLowerCase() === 'maps.manifest.json') {
      out.push({ rule: 'local-maps', path, message: 'a local map-set manifest must never be deployed (docs/MAPS.md §5.7)' });
    }
    const extension = extensionOf(path);
    if (FORBIDDEN_EXTENSIONS.includes(extension)) {
      const what = extension === '.map' ? 'source maps' : extension === '.lua' ? 'raw Lua' : 'Blizzard client files';
      out.push({ rule: 'file-type', path, message: `${what} (${extension}) must not ship` });
    }
    if (segments.includes('.cache') || segments.includes('.git')) {
      out.push({ rule: 'file-type', path, message: 'tool caches and VCS folders must not ship' });
    }
    if (SAVED_VARIABLES_PATH.test(path)) {
      out.push({ rule: 'privacy', path, message: 'WTF/SavedVariables folders must never ship' });
    }
  }
  return out;
}

/**
 * Images ship only when an allowlisted app-asset glob matches them, or when a committed map folder's
 * manifest lists them (`mapImages`, from {@link checkMapFolders}; D-033's one image allowlist).
 * Every other image, map art under any other path included, is refused.
 */
export function checkImages(files: readonly string[], allowed: readonly AllowedImage[], mapImages: ReadonlySet<string> = new Set()): readonly AuditViolation[] {
  const globs = allowed.map((entry) => entry.glob);
  return files
    .filter((path) => IMAGE_EXTENSIONS.includes(extensionOf(path)) && !matchesAnyGlob(path, globs) && !mapImages.has(path))
    .map((path) => ({
      rule: 'image',
      path,
      message: 'image is not an allowlisted app asset (tools/build/dist-requirements.json allowedImages) nor listed by a map folder manifest (mapFolders)',
    }));
}

export const MAP_FOLDER_NOTICE = 'NOTICE.md';
export const MAP_FOLDER_MANIFEST = 'manifest.json';

export interface MapFolderReport {
  readonly name: string;
  readonly dir: string;
  readonly files: readonly SizedFile[];
  readonly totalGzipBytes: number;
  readonly budgetBytes: number;
}

/**
 * The committed map folders (D-032, D-033; terrain-navigation.md §13.3). For each configured
 * folder with files in dist/: its `NOTICE.md` and `manifest.json` must be there; the manifest's
 * `files` array must list every other file of the folder with its SHA-256 (`path` relative to the
 * folder), and every listed file must be present with that hash. Returns the image paths this
 * allows. Once the repository has `<source>/manifest.json`, the folder must ship.
 */
export function checkMapFolders(
  distDir: string,
  files: readonly string[],
  folders: readonly MapFolder[],
  repoRoot: string,
): { readonly allowedImages: ReadonlySet<string>; readonly violations: readonly AuditViolation[] } {
  const allowed = new Set<string>();
  const violations: AuditViolation[] = [];
  for (const folder of folders) {
    const prefix = `${folder.dir}/`;
    const inside = files.filter((path) => path.startsWith(prefix));
    const active = existsSync(join(repoRoot, folder.source, MAP_FOLDER_MANIFEST));
    if (inside.length === 0) {
      if (active) violations.push({ rule: 'map-folder', path: folder.dir, message: `${folder.source}/manifest.json exists, but dist/ has no ${folder.dir}/ (${folder.name})` });
      continue;
    }
    const noticePath = `${prefix}${MAP_FOLDER_NOTICE}`;
    const manifestPath = `${prefix}${MAP_FOLDER_MANIFEST}`;
    const problems: AuditViolation[] = [];
    if (!inside.includes(noticePath)) problems.push({ rule: 'map-folder', path: noticePath, message: `${folder.name}: the folder's NOTICE.md is missing (D-033)` });
    const listed = new Map<string, string>();
    if (!inside.includes(manifestPath)) problems.push({ rule: 'map-folder', path: manifestPath, message: `${folder.name}: the folder's manifest.json is missing` });
    else {
      try {
        const manifest = JSON.parse(readFileSync(join(distDir, manifestPath), 'utf8')) as unknown;
        const entries = isRecord(manifest) && Array.isArray(manifest.files) ? (manifest.files as readonly unknown[]) : null;
        if (entries === null) throw new Error('no "files" array');
        for (const entry of entries) {
          const path = isRecord(entry) ? entry.path : undefined;
          const sha256 = isRecord(entry) ? entry.sha256 : undefined;
          if (typeof path !== 'string' || path === '' || path.startsWith('/') || path.split('/').includes('..') || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
            throw new Error(`invalid files[] entry ${JSON.stringify(entry)}`);
          }
          listed.set(`${prefix}${path}`, sha256);
        }
      } catch (error) {
        problems.push({ rule: 'map-folder', path: manifestPath, message: `${folder.name}: cannot read the manifest: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
    for (const path of inside) {
      if (path === noticePath || path === manifestPath) continue;
      const sha256 = listed.get(path);
      if (sha256 === undefined) problems.push({ rule: 'map-folder', path, message: `${folder.name}: not listed in ${manifestPath}` });
      else if (createHash('sha256').update(readFileSync(join(distDir, path))).digest('hex') !== sha256) {
        problems.push({ rule: 'map-folder', path, message: `${folder.name}: SHA-256 differs from ${manifestPath}` });
      }
    }
    for (const path of listed.keys()) if (!inside.includes(path)) problems.push({ rule: 'map-folder', path, message: `${folder.name}: listed in ${manifestPath} but missing` });
    violations.push(...problems);
    if (problems.length === 0) for (const path of listed.keys()) allowed.add(path);
  }
  return { allowedImages: allowed, violations };
}

/**
 * File signatures of raster images and raw Blizzard client files, with the extensions each may
 * carry (a client file's own extension is already refused by {@link checkForbiddenPaths}). The
 * image rule above goes by extension; this catches map art that reaches dist/ under another name
 * (`assets/tile-abc.bin`, a PNG saved as `.svg`), docs/MAPS.md §5.7, D-018, and client files under
 * any name (terrain-navigation.md §16 G13).
 */
const SIGNATURES: readonly { readonly name: string; readonly client: boolean; readonly extensions: readonly string[]; readonly matches: (bytes: Uint8Array) => boolean }[] = [
  { name: 'PNG image', client: false, extensions: ['.png', '.apng'], matches: (b) => startsWith(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { name: 'JPEG image', client: false, extensions: ['.jpg', '.jpeg'], matches: (b) => startsWith(b, 0, [0xff, 0xd8, 0xff]) },
  { name: 'GIF image', client: false, extensions: ['.gif'], matches: (b) => ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a' },
  { name: 'WebP image', client: false, extensions: ['.webp'], matches: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP' },
  { name: 'AVIF/HEIF image', client: false, extensions: ['.avif', '.heic', '.heif'], matches: (b) => ascii(b, 4, 4) === 'ftyp' && ['avif', 'avis', 'heic', 'heix', 'mif1', 'msf1'].includes(ascii(b, 8, 4)) },
  { name: 'BLP texture', client: true, extensions: ['.blp'], matches: (b) => ascii(b, 0, 4) === 'BLP1' || ascii(b, 0, 4) === 'BLP2' },
  // Chunked client files store the MVER id reversed: ADT, WDT, WDL and WMO all begin "REVM".
  { name: 'ADT, WDT, WDL or WMO', client: true, extensions: ['.adt', '.wdt', '.wdl', '.wmo'], matches: (b) => ascii(b, 0, 4) === 'REVM' },
  { name: 'M2 model', client: true, extensions: ['.m2'], matches: (b) => ascii(b, 0, 4) === 'MD21' || ascii(b, 0, 4) === 'MD20' },
  { name: 'DB2 table', client: true, extensions: ['.db2', '.dbc'], matches: (b) => ['WDBC', 'WDB2', 'WDC3', 'WDC4', 'WDC5'].includes(ascii(b, 0, 4)) },
  { name: 'BLTE-encoded CASC data', client: true, extensions: [], matches: (b) => ascii(b, 0, 4) === 'BLTE' },
];

function startsWith(bytes: Uint8Array, at: number, prefix: readonly number[]): boolean {
  return bytes.length >= at + prefix.length && prefix.every((byte, i) => bytes[at + i] === byte);
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return bytes.length < at + length ? '' : String.fromCharCode(...bytes.subarray(at, at + length));
}

/** Image or BLP content under a name whose extension does not declare it. */
export function checkFileSignature(path: string, bytes: Uint8Array): readonly AuditViolation[] {
  const signature = SIGNATURES.find((candidate) => candidate.matches(bytes));
  if (signature === undefined || signature.extensions.includes(extensionOf(path))) return [];
  return [
    {
      rule: signature.client ? 'file-type' : 'image',
      path,
      message: signature.client
        ? `Blizzard client files (${signature.name} content) must not ship, whatever the name`
        : `${signature.name} content under a name that is not an allowlisted image (no map art, D-018)`,
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Content rules

/**
 * Local paths, `.cache` references, local-only map data and SavedVariables content. Binary files
 * are decoded as Latin-1 and checked for user-profile paths only (debug paths hide in binaries).
 */
export function checkFileContent(path: string, bytes: Uint8Array): readonly AuditViolation[] {
  const out: AuditViolation[] = [];
  const at = (line: number, excerpt: string): string => `line ${String(line)}: "${excerpt}"`;
  if (looksBinary(bytes)) {
    const hit = findPattern(Buffer.from(bytes).toString('latin1'), USER_PROFILE_PATH, 'absolute user-profile path');
    if (hit !== null) out.push({ rule: 'privacy', path, message: `binary file contains an absolute user-profile path` });
    return out;
  }
  const text = Buffer.from(bytes).toString('utf8');
  for (const hit of findPrivacyLeaks(text)) {
    out.push({ rule: 'privacy', path, message: `${hit.pattern}, ${at(hit.line, hit.excerpt)}` });
  }
  const cache = findPattern(text, CACHE_DIRECTORY_REFERENCE, '.cache reference');
  if (cache !== null) out.push({ rule: 'cache-reference', path, message: `.cache path reference, ${at(cache.line, cache.excerpt)}` });
  const localOnly = findPattern(text, LOCAL_ONLY_MARKER, 'local-only marker');
  if (localOnly !== null) {
    out.push({ rule: 'local-maps', path, message: `file is marked "redistribution": "local-only" (D-018), line ${String(localOnly.line)}` });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Required files

export interface RequiredSet {
  readonly files: readonly string[];
  readonly milestone2Active: boolean;
  readonly violations: readonly AuditViolation[];
}

/**
 * The files dist/ must contain. The Milestone 2 list (dataset and placeholder-map notices)
 * activates once the repository has public/data/manifest.json; every `outputs[].path` in the
 * shipped dist/data/manifest.json is then required under data/ too.
 */
export function resolveRequiredFiles(requirements: DistRequirements, repoRoot: string, distDir: string): RequiredSet {
  const milestone2Active = existsSync(join(repoRoot, requirements.milestone2.activatedBy));
  const files = new Set(requirements.required);
  const violations: AuditViolation[] = [];
  if (milestone2Active) {
    for (const path of requirements.milestone2.required) files.add(path);
    const manifestPath = join(distDir, 'data', 'manifest.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
        const outputs = isRecord(manifest) && Array.isArray(manifest.outputs) ? (manifest.outputs as readonly unknown[]) : null;
        if (outputs === null) throw new Error('no "outputs" array');
        for (const output of outputs) {
          const path = isRecord(output) ? output.path : undefined;
          if (typeof path !== 'string' || path === '' || path.startsWith('/') || path.split('/').includes('..')) {
            throw new Error(`invalid outputs[].path ${JSON.stringify(path)}`);
          }
          files.add(`data/${path}`);
        }
      } catch (error) {
        violations.push({
          rule: 'required',
          path: 'data/manifest.json',
          message: `cannot read the dataset manifest's outputs: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }
  return { files: [...files].sort(compareStrings), milestone2Active, violations };
}

export function checkRequiredFiles(files: readonly string[], required: readonly string[]): readonly AuditViolation[] {
  const present = new Set(files);
  return required
    .filter((path) => !present.has(path))
    .map((path) => ({ rule: 'required', path, message: 'required file is missing' }));
}

// ---------------------------------------------------------------------------------------------
// Size gates

export interface SizedFile {
  readonly file: string;
  readonly bytes: number;
  readonly gzipBytes: number;
}

export interface EntryChunkReport {
  /** The manifest key of the entry, e.g. `index.html`. */
  readonly entry: string;
  /** The entry chunk and its transitive static imports; dynamic imports are excluded. */
  readonly chunks: readonly SizedFile[];
  readonly totalGzipBytes: number;
  /** CSS the entry loads statically; reported, not gated. */
  readonly css: readonly SizedFile[];
  /** What the entry loads with dynamic `import()` (the map engine, M3 review PERF-11); reported, not gated. */
  readonly lazy: LazyChunksReport;
}

export interface LazyChunksReport {
  /** Chunks reached through `dynamicImports` (and their static imports) that are not in the entry's static set. */
  readonly chunks: readonly SizedFile[];
  readonly totalGzipBytes: number;
  /** CSS those chunks load. */
  readonly css: readonly SizedFile[];
}

/**
 * gzip at zlib level 6 (Node's default), the measure every budget here uses. Vite's own report
 * after a build compresses differently, so its gzip figure differs slightly (about 1% on the
 * entry chunk); the gate trusts this one.
 */
export function gzipSize(bytes: Uint8Array): number {
  return gzipSync(bytes, { level: 6 }).length;
}

const sizeOf = (distDir: string, file: string): SizedFile => {
  const bytes = readFileSync(join(distDir, file));
  return { file, bytes: bytes.length, gzipBytes: gzipSize(bytes) };
};

/** The sizes of the files that exist, sorted by path. */
const sizedIfPresent = (distDir: string, files: Iterable<string>): readonly SizedFile[] =>
  [...files].sort(compareStrings).filter((file) => existsSync(join(distDir, file))).map((file) => sizeOf(distDir, file));

interface ManifestChunk {
  readonly file: string;
  readonly isEntry: boolean;
  readonly imports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly css: readonly string[];
}

function parseViteManifest(value: unknown): ReadonlyMap<string, ManifestChunk> {
  if (!isRecord(value)) throw new Error('expected an object keyed by source path');
  const chunks = new Map<string, ManifestChunk>();
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw) || typeof raw.file !== 'string') throw new Error(`entry "${key}" has no "file"`);
    const list = (field: unknown): readonly string[] =>
      Array.isArray(field) ? field.filter((item): item is string => typeof item === 'string') : [];
    chunks.set(key, {
      file: raw.file,
      isEntry: raw.isEntry === true,
      imports: list(raw.imports),
      dynamicImports: list(raw.dynamicImports),
      css: list(raw.css),
    });
  }
  return chunks;
}

/**
 * ARCHITECTURE §14: for every entry in dist/.vite/manifest.json, the gzip size of the entry
 * chunk plus its transitive static `imports` (never `dynamicImports`) must stay within budget.
 * The chunks it loads lazily (`dynamicImports`, transitively) are sized and reported, not gated,
 * so a lazy chunk cannot grow unnoticed (M3 review PERF-11).
 */
export function checkEntryChunks(
  distDir: string,
  budgetBytes: number,
): { readonly reports: readonly EntryChunkReport[]; readonly violations: readonly AuditViolation[] } {
  const manifestFile = '.vite/manifest.json';
  const manifestPath = join(distDir, '.vite', 'manifest.json');
  if (!existsSync(manifestPath)) {
    return {
      reports: [],
      violations: [{ rule: 'entry-chunk', path: manifestFile, message: 'Vite build manifest is missing (keep build.manifest: true in vite.config.ts)' }],
    };
  }
  let chunks: ReadonlyMap<string, ManifestChunk>;
  try {
    chunks = parseViteManifest(JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown);
  } catch (error) {
    return {
      reports: [],
      violations: [{ rule: 'entry-chunk', path: manifestFile, message: `unreadable manifest: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }
  const entries = [...chunks.entries()].filter(([, chunk]) => chunk.isEntry).map(([key]) => key).sort(compareStrings);
  const violations: AuditViolation[] = [];
  if (entries.length === 0) violations.push({ rule: 'entry-chunk', path: manifestFile, message: 'manifest has no entry chunk' });
  const reports = entries.map((entry): EntryChunkReport => {
    const seen = new Set<string>();
    const files = new Set<string>();
    const css = new Set<string>();
    const visit = (key: string): void => {
      if (seen.has(key)) return;
      seen.add(key);
      const chunk = chunks.get(key);
      if (chunk === undefined) {
        violations.push({ rule: 'entry-chunk', path: manifestFile, message: `"${entry}" statically imports unknown manifest key "${key}"` });
        return;
      }
      files.add(chunk.file);
      for (const sheet of chunk.css) css.add(sheet);
      for (const imported of chunk.imports) visit(imported);
    };
    visit(entry);
    // Everything reached through a dynamic import, with its own static and dynamic imports, minus
    // what the entry already loads statically.
    const lazyFiles = new Set<string>();
    const lazyCss = new Set<string>();
    const lazySeen = new Set<string>();
    const queue = [...seen].flatMap((key) => chunks.get(key)?.dynamicImports ?? []);
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
      if (seen.has(key) || lazySeen.has(key)) continue;
      lazySeen.add(key);
      const chunk = chunks.get(key);
      if (chunk === undefined) continue;
      if (!files.has(chunk.file)) lazyFiles.add(chunk.file);
      for (const sheet of chunk.css) if (!css.has(sheet)) lazyCss.add(sheet);
      queue.push(...chunk.imports, ...chunk.dynamicImports);
    }
    const sized = [...files].sort(compareStrings).flatMap((file) => {
      if (existsSync(join(distDir, file))) return [sizeOf(distDir, file)];
      violations.push({ rule: 'entry-chunk', path: file, message: 'chunk listed in the manifest is missing' });
      return [];
    });
    const sheets = sizedIfPresent(distDir, css);
    const lazyChunks = sizedIfPresent(distDir, lazyFiles);
    const lazy: LazyChunksReport = {
      chunks: lazyChunks,
      totalGzipBytes: lazyChunks.reduce((sum, file) => sum + file.gzipBytes, 0),
      css: sizedIfPresent(distDir, lazyCss),
    };
    const totalGzipBytes = sized.reduce((sum, file) => sum + file.gzipBytes, 0);
    if (totalGzipBytes > budgetBytes) {
      violations.push({
        rule: 'entry-chunk',
        path: null,
        message: `entry "${entry}" plus static imports is ${formatBytes(totalGzipBytes)} gzip, over the ${formatBytes(budgetBytes)} budget (ARCHITECTURE §14)`,
      });
    }
    return { entry, chunks: sized, totalGzipBytes, css: sheets, lazy };
  });
  return { reports, violations };
}

export interface DataReport {
  readonly files: readonly SizedFile[];
  readonly totalGzipBytes: number;
}

/**
 * ARCHITECTURE §14: each data/ file within its recorded baseline + tolerance; the total within
 * budget. Once Milestone 2 is active (`requireBaselines`), a data/ file with no recorded baseline
 * is a violation too, so a new or renamed file cannot grow unchecked: its baseline has to be
 * recorded in dist-requirements.json deliberately.
 */
export function checkDataBudgets(
  distDir: string,
  files: readonly string[],
  data: DistRequirements['data'],
  requireBaselines: boolean,
): { readonly report: DataReport; readonly violations: readonly AuditViolation[] } {
  return checkGzipBudget(distDir, files, { prefix: 'data/', section: 'data', rule: 'data-budget', why: 'ARCHITECTURE §14' }, data, requireBaselines);
}

/**
 * Every file under `prefix` within its recorded baseline + tolerance, the folder within the total
 * budget; with `requireBaselines`, a file without a baseline fails too (it must be recorded in
 * dist-requirements.json deliberately).
 */
export function checkGzipBudget(
  distDir: string,
  files: readonly string[],
  where: { readonly prefix: string; readonly section: string; readonly rule: string; readonly why: string },
  budget: GzipBudget,
  requireBaselines: boolean,
): { readonly report: DataReport; readonly violations: readonly AuditViolation[] } {
  const sized = files.filter((path) => path.startsWith(where.prefix)).map((path) => sizeOf(distDir, path));
  const violations: AuditViolation[] = [];
  for (const file of sized) {
    const baseline = Object.hasOwn(budget.baselines, file.file) ? budget.baselines[file.file] : undefined;
    if (baseline === undefined) {
      if (requireBaselines) {
        violations.push({
          rule: where.rule,
          path: file.file,
          message: `no gzip baseline recorded (${formatBytes(file.gzipBytes)} gzip now); add it to tools/build/dist-requirements.json ${where.section}.baselines`,
        });
      }
      continue;
    }
    const limit = Math.floor(baseline * (1 + budget.baselineTolerance));
    if (file.gzipBytes > limit) {
      violations.push({
        rule: where.rule,
        path: file.file,
        message: `${formatBytes(file.gzipBytes)} gzip exceeds the recorded baseline ${formatBytes(baseline)} + ${String(Math.round(budget.baselineTolerance * 100))}%`,
      });
    }
  }
  const totalGzipBytes = sized.reduce((sum, file) => sum + file.gzipBytes, 0);
  if (totalGzipBytes > budget.totalGzipBudgetBytes) {
    violations.push({
      rule: where.rule,
      path: null,
      message: `${where.prefix} totals ${formatBytes(totalGzipBytes)} gzip, over the ${formatBytes(budget.totalGzipBudgetBytes)} budget (${where.why})`,
    });
  }
  return { report: { files: sized, totalGzipBytes }, violations };
}

export interface NavReport {
  readonly active: boolean;
  readonly maps: readonly { readonly mapId: string; readonly files: number; readonly gzipBytes: number; readonly baseline: number | null }[];
  readonly totalGzipBytes: number;
  readonly largestFile: SizedFile | null;
  readonly budget: NavBudget;
}

/**
 * D-030 and terrain-navigation.md §14.3: `nav/` within the 7 MB cap, every file within the per-file
 * cap, and every `nav/<mapId>/` folder within its recorded baseline + tolerance. Once the
 * repository has `activatedBy`, the `required` files must ship and every map folder needs a
 * baseline. The 5-6 MB target is reported, not gated.
 */
export function checkNavBudget(
  distDir: string,
  files: readonly string[],
  nav: NavBudget,
  repoRoot: string,
): { readonly report: NavReport; readonly violations: readonly AuditViolation[] } {
  const prefix = `${nav.dir}/`;
  const active = existsSync(join(repoRoot, nav.activatedBy));
  const sized = files.filter((path) => path.startsWith(prefix)).map((path) => sizeOf(distDir, path));
  const violations: AuditViolation[] = [];
  if (active) {
    const present = new Set(files);
    for (const path of nav.required) if (!present.has(path)) violations.push({ rule: 'nav-budget', path, message: `required once ${nav.activatedBy} exists` });
  }
  const byMap = new Map<string, SizedFile[]>();
  let largest: SizedFile | null = null;
  for (const file of sized) {
    if (largest === null || file.gzipBytes > largest.gzipBytes) largest = file;
    if (file.gzipBytes > nav.perFileGzipCapBytes) {
      violations.push({ rule: 'nav-budget', path: file.file, message: `${formatBytes(file.gzipBytes)} gzip is over the ${formatBytes(nav.perFileGzipCapBytes)} per-file cap (terrain-navigation.md §14.3)` });
    }
    const segments = file.file.slice(prefix.length).split('/');
    if (segments.length < 2) continue;
    const mapId = segments[0] ?? '';
    const list = byMap.get(mapId);
    if (list === undefined) byMap.set(mapId, [file]);
    else list.push(file);
  }
  const maps = [...byMap.entries()]
    .sort((a, b) => compareStrings(a[0], b[0]))
    .map(([mapId, list]) => {
      const gzipBytes = list.reduce((sum, f) => sum + f.gzipBytes, 0);
      const baseline = Object.hasOwn(nav.mapBaselines, mapId) ? (nav.mapBaselines[mapId] ?? null) : null;
      if (baseline === null) {
        if (active) violations.push({ rule: 'nav-budget', path: `${prefix}${mapId}`, message: `no gzip baseline recorded for map ${mapId} (${formatBytes(gzipBytes)} now); add it to nav.mapBaselines` });
      } else if (gzipBytes > Math.floor(baseline * (1 + nav.baselineTolerance))) {
        violations.push({
          rule: 'nav-budget',
          path: `${prefix}${mapId}`,
          message: `${formatBytes(gzipBytes)} gzip exceeds the map's baseline ${formatBytes(baseline)} + ${String(Math.round(nav.baselineTolerance * 100))}%`,
        });
      }
      return { mapId, files: list.length, gzipBytes, baseline };
    });
  const totalGzipBytes = sized.reduce((sum, file) => sum + file.gzipBytes, 0);
  if (totalGzipBytes > nav.totalGzipBudgetBytes) {
    violations.push({ rule: 'nav-budget', path: null, message: `${prefix} totals ${formatBytes(totalGzipBytes)} gzip, over the ${formatBytes(nav.totalGzipBudgetBytes)} cap (D-030)` });
  }
  return { report: { active, maps, totalGzipBytes, largestFile: largest, budget: nav }, violations };
}

// ---------------------------------------------------------------------------------------------
// Whole audit

export interface AuditResult {
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly required: RequiredSet;
  readonly entryChunks: readonly EntryChunkReport[];
  readonly entryChunkBudgetBytes: number;
  readonly data: DataReport;
  readonly mapFolders: readonly MapFolderReport[];
  readonly nav: NavReport | null;
  readonly violations: readonly AuditViolation[];
}

export function auditDist(options: {
  readonly distDir: string;
  readonly repoRoot: string;
  readonly requirements: DistRequirements;
}): AuditResult {
  const { distDir, repoRoot, requirements } = options;
  if (!existsSync(distDir)) throw new Error(`${distDir} does not exist; run vite build first`);
  const files = listFiles(distDir);
  const violations: AuditViolation[] = [];
  let totalBytes = 0;
  const folders = checkMapFolders(distDir, files, requirements.mapFolders, repoRoot);
  violations.push(...checkForbiddenPaths(files), ...folders.violations, ...checkImages(files, requirements.allowedImages, folders.allowedImages));
  for (const path of files) {
    const bytes = readFileSync(join(distDir, path));
    totalBytes += bytes.length;
    violations.push(...checkFileContent(path, bytes), ...checkFileSignature(path, bytes));
  }
  const required = resolveRequiredFiles(requirements, repoRoot, distDir);
  violations.push(...required.violations, ...checkRequiredFiles(files, required.files));
  const entry = checkEntryChunks(distDir, requirements.entryChunkGzipBudgetBytes);
  violations.push(...entry.violations);
  const data = checkDataBudgets(distDir, files, requirements.data, required.milestone2Active);
  violations.push(...data.violations);
  const mapFolders = requirements.mapFolders.map((folder): MapFolderReport => {
    const active = existsSync(join(repoRoot, folder.source, MAP_FOLDER_MANIFEST));
    const where = { prefix: `${folder.dir}/`, section: `mapFolders "${folder.name}"`, rule: `${folder.name}-budget`, why: 'D-034 item 4' };
    const result = checkGzipBudget(distDir, files, where, folder, active);
    violations.push(...result.violations);
    return { name: folder.name, dir: folder.dir, files: result.report.files, totalGzipBytes: result.report.totalGzipBytes, budgetBytes: folder.totalGzipBudgetBytes };
  });
  let nav: NavReport | null = null;
  if (requirements.nav !== null) {
    const result = checkNavBudget(distDir, files, requirements.nav, repoRoot);
    violations.push(...result.violations);
    nav = result.report;
  }
  return {
    fileCount: files.length,
    totalBytes,
    required,
    entryChunks: entry.reports,
    entryChunkBudgetBytes: requirements.entryChunkGzipBudgetBytes,
    data: data.report,
    mapFolders,
    nav,
    violations,
  };
}

/**
 * Deletes dist/.vite (the build manifest) once the audit has read it: it has no runtime use and
 * would publish the build graph. Returns whether there was anything to delete.
 */
export function removeBuildManifest(distDir: string): boolean {
  const dir = join(distDir, '.vite');
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

export function formatAuditReport(result: AuditResult): string {
  const lines: string[] = [`dist audit: ${String(result.fileCount)} files, ${formatBytes(result.totalBytes)}`];
  lines.push(
    `Required files (${result.required.milestone2Active ? 'Milestone 1 + Milestone 2 lists' : 'Milestone 1 list'}): ${result.required.files.join(', ')}`,
  );
  const row = (file: SizedFile): string =>
    `    ${file.file.padEnd(48)} ${formatBytes(file.bytes).padStart(10)}  gzip ${formatBytes(file.gzipBytes).padStart(10)}`;
  for (const report of result.entryChunks) {
    lines.push('', `Entry "${report.entry}" + static imports (budget ${formatBytes(result.entryChunkBudgetBytes)} gzip):`);
    lines.push(...report.chunks.map(row), `    ${'total'.padEnd(48)} ${''.padStart(10)}  gzip ${formatBytes(report.totalGzipBytes).padStart(10)}`);
    if (report.css.length > 0) lines.push('  CSS loaded by the entry (not gated):', ...report.css.map(row));
    const lazy = report.lazy;
    if (lazy.chunks.length > 0) {
      lines.push(
        '  Loaded lazily by dynamic import() (not gated):',
        ...lazy.chunks.map(row),
        `    ${'total'.padEnd(48)} ${''.padStart(10)}  gzip ${formatBytes(lazy.totalGzipBytes).padStart(10)}`,
      );
    }
    if (lazy.css.length > 0) lines.push('  CSS loaded by those chunks (not gated):', ...lazy.css.map(row));
  }
  if (result.data.files.length > 0) {
    lines.push('', 'data/ files:', ...result.data.files.map(row), `    ${'total'.padEnd(48)} ${''.padStart(10)}  gzip ${formatBytes(result.data.totalGzipBytes).padStart(10)}`);
  }
  for (const folder of result.mapFolders) {
    if (folder.files.length === 0) continue;
    const largest = [...folder.files].sort((a, b) => b.gzipBytes - a.gzipBytes)[0];
    lines.push(
      '',
      `${folder.dir}/ (${folder.name} budget ${formatBytes(folder.budgetBytes)} gzip): ${String(folder.files.length)} files, gzip ${formatBytes(folder.totalGzipBytes)} ` +
        `(${(100 * folder.totalGzipBytes / folder.budgetBytes).toFixed(1)}%)${largest === undefined ? '' : `; largest ${largest.file} ${formatBytes(largest.gzipBytes)}`}`,
    );
    if (folder.files.length <= 12) lines.push(...folder.files.map(row));
  }
  const nav = result.nav;
  if (nav !== null && nav.largestFile !== null) {
    lines.push('', `${nav.budget.dir}/ (cap ${formatBytes(nav.budget.totalGzipBudgetBytes)}, target ${formatBytes(nav.budget.targetGzipBytes.min)}-${formatBytes(nav.budget.targetGzipBytes.max)} gzip): gzip ${formatBytes(nav.totalGzipBytes)}`);
    for (const map of nav.maps) {
      lines.push(`    map ${map.mapId.padEnd(6)} ${String(map.files).padStart(5)} files  gzip ${formatBytes(map.gzipBytes).padStart(10)}  baseline ${map.baseline === null ? 'none' : formatBytes(map.baseline)}`);
    }
  }
  if (result.violations.length === 0) {
    lines.push('', 'dist audit passed. (A guard, not proof: inspect release builds manually as well.)');
  } else {
    lines.push('', `dist audit FAILED with ${String(result.violations.length)} problem(s):`);
    for (const violation of result.violations) {
      lines.push(`  [${violation.rule}] ${violation.path ?? '(build)'}: ${violation.message}`);
    }
  }
  return lines.join('\n');
}
