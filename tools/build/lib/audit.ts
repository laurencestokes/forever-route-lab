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
  readonly data: {
    readonly totalGzipBudgetBytes: number;
    /** A data file may grow to baseline × (1 + tolerance) before the gate fails. */
    readonly baselineTolerance: number;
    /** dist-relative path → recorded gzip bytes. */
    readonly baselines: Readonly<Record<string, number>>;
  };
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
  // fromEntries defines own properties, so no path (not even `__proto__`) reaches a setter.
  const baselines: Readonly<Record<string, number>> = Object.fromEntries(
    Object.entries(data.baselines)
      .filter(([path]) => !path.startsWith('$'))
      .map(([path, bytes]) => [path, positiveNumber(bytes, `data.baselines["${path}"]`)]),
  );
  return {
    required: stringList(value.required, 'required'),
    milestone2: { activatedBy: m2.activatedBy, required: stringList(m2.required, 'milestone2.required') },
    allowedImages,
    entryChunkGzipBudgetBytes: positiveNumber(value.entryChunkGzipBudgetBytes, 'entryChunkGzipBudgetBytes'),
    data: {
      totalGzipBudgetBytes: positiveNumber(data.totalGzipBudgetBytes, 'data.totalGzipBudgetBytes'),
      baselineTolerance: positiveNumber(data.baselineTolerance, 'data.baselineTolerance'),
      baselines,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Path rules

/** Blizzard client formats, raw Lua and source maps never ship (ARCHITECTURE §16). */
export const FORBIDDEN_EXTENSIONS: readonly string[] = ['.lua', '.blp', '.m2', '.db2', '.dbc', '.map'];

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

/** Images ship only when an allowlisted app-asset glob matches them (no map art, D-018). */
export function checkImages(files: readonly string[], allowed: readonly AllowedImage[]): readonly AuditViolation[] {
  const globs = allowed.map((entry) => entry.glob);
  return files
    .filter((path) => IMAGE_EXTENSIONS.includes(extensionOf(path)) && !matchesAnyGlob(path, globs))
    .map((path) => ({
      rule: 'image',
      path,
      message: 'image is not an allowlisted app asset (tools/build/dist-requirements.json allowedImages)',
    }));
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

interface ManifestChunk {
  readonly file: string;
  readonly isEntry: boolean;
  readonly imports: readonly string[];
  readonly css: readonly string[];
}

function parseViteManifest(value: unknown): ReadonlyMap<string, ManifestChunk> {
  if (!isRecord(value)) throw new Error('expected an object keyed by source path');
  const chunks = new Map<string, ManifestChunk>();
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw) || typeof raw.file !== 'string') throw new Error(`entry "${key}" has no "file"`);
    const list = (field: unknown): readonly string[] =>
      Array.isArray(field) ? field.filter((item): item is string => typeof item === 'string') : [];
    chunks.set(key, { file: raw.file, isEntry: raw.isEntry === true, imports: list(raw.imports), css: list(raw.css) });
  }
  return chunks;
}

/**
 * ARCHITECTURE §14: for every entry in dist/.vite/manifest.json, the gzip size of the entry
 * chunk plus its transitive static `imports` (never `dynamicImports`) must stay within budget.
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
    const sized = [...files].sort(compareStrings).flatMap((file) => {
      if (existsSync(join(distDir, file))) return [sizeOf(distDir, file)];
      violations.push({ rule: 'entry-chunk', path: file, message: 'chunk listed in the manifest is missing' });
      return [];
    });
    const sheets = [...css].sort(compareStrings).filter((file) => existsSync(join(distDir, file))).map((file) => sizeOf(distDir, file));
    const totalGzipBytes = sized.reduce((sum, file) => sum + file.gzipBytes, 0);
    if (totalGzipBytes > budgetBytes) {
      violations.push({
        rule: 'entry-chunk',
        path: null,
        message: `entry "${entry}" plus static imports is ${formatBytes(totalGzipBytes)} gzip, over the ${formatBytes(budgetBytes)} budget (ARCHITECTURE §14)`,
      });
    }
    return { entry, chunks: sized, totalGzipBytes, css: sheets };
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
  const sized = files.filter((path) => path.startsWith('data/')).map((path) => sizeOf(distDir, path));
  const violations: AuditViolation[] = [];
  for (const file of sized) {
    const baseline = Object.hasOwn(data.baselines, file.file) ? data.baselines[file.file] : undefined;
    if (baseline === undefined) {
      if (requireBaselines) {
        violations.push({
          rule: 'data-budget',
          path: file.file,
          message: `no gzip baseline recorded (${formatBytes(file.gzipBytes)} gzip now); add it to tools/build/dist-requirements.json data.baselines`,
        });
      }
      continue;
    }
    const limit = Math.floor(baseline * (1 + data.baselineTolerance));
    if (file.gzipBytes > limit) {
      violations.push({
        rule: 'data-budget',
        path: file.file,
        message: `${formatBytes(file.gzipBytes)} gzip exceeds the recorded baseline ${formatBytes(baseline)} + ${String(Math.round(data.baselineTolerance * 100))}%`,
      });
    }
  }
  const totalGzipBytes = sized.reduce((sum, file) => sum + file.gzipBytes, 0);
  if (totalGzipBytes > data.totalGzipBudgetBytes) {
    violations.push({
      rule: 'data-budget',
      path: null,
      message: `data/ totals ${formatBytes(totalGzipBytes)} gzip, over the ${formatBytes(data.totalGzipBudgetBytes)} budget (ARCHITECTURE §14)`,
    });
  }
  return { report: { files: sized, totalGzipBytes }, violations };
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
  violations.push(...checkForbiddenPaths(files), ...checkImages(files, requirements.allowedImages));
  for (const path of files) {
    const bytes = readFileSync(join(distDir, path));
    totalBytes += bytes.length;
    violations.push(...checkFileContent(path, bytes));
  }
  const required = resolveRequiredFiles(requirements, repoRoot, distDir);
  violations.push(...required.violations, ...checkRequiredFiles(files, required.files));
  const entry = checkEntryChunks(distDir, requirements.entryChunkGzipBudgetBytes);
  violations.push(...entry.violations);
  const data = checkDataBudgets(distDir, files, requirements.data, required.milestone2Active);
  violations.push(...data.violations);
  return {
    fileCount: files.length,
    totalBytes,
    required,
    entryChunks: entry.reports,
    entryChunkBudgetBytes: requirements.entryChunkGzipBudgetBytes,
    data: data.report,
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
  }
  if (result.data.files.length > 0) {
    lines.push('', 'data/ files:', ...result.data.files.map(row), `    ${'total'.padEnd(48)} ${''.padStart(10)}  gzip ${formatBytes(result.data.totalGzipBytes).padStart(10)}`);
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
