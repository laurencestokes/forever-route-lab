/**
 * RXPGuides line-overlap check (D-019, D-006, docs/ARCHITECTURE.md §17, docs/RXP.md §19.2).
 *
 * Fails when a trimmed line of 24 or more characters in `src/`, `public/`, `tests/` or
 * `docs/research/rxp-samples/` equals a line of RestedXP's guides (`Guides/**` of RXPGuides at the
 * pinned commit), unless a reviewed entry in `tools/build/rxp-overlap-allowlist.json` names that
 * file and line text. Stale allowlist entries (that no longer overlap) fail too, so the list stays
 * reviewed.
 *
 * The comparison is generic: it builds a set of the reference lines and looks our lines up in it.
 * Nothing from the reference is printed except our own lines that equal one of its lines.
 *
 * Lines are compared as written (trimmed) and, for RXP guide text, also in canonical form
 * (docs/RXP.md §13.4, §19.2): every reference line, and every line of our RXP fixtures
 * (`RXP_TEXT_ROOTS`), is parsed with `src/rxp` and printed canonically without indentation. So a
 * spacing-only difference around RXP's separators (`>>text` against `>> text`) cannot hide an
 * overlap.
 *
 * Network, opt-in, not part of `pnpm check`: without `--reference`, the pinned commit is fetched
 * (depth 1, core.autocrlf=false) into a fresh OS temporary directory, which is deleted afterwards
 * unless `--keep` is given.
 *
 * Usage: pnpm rxp:overlap [--reference <existing RXPGuides clone at the pinned commit>] [--keep]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalCstContent } from '../../src/rxp/canonical';
import { parseRxpCst } from '../../src/rxp/cst';
import { REPO_ROOT, compareStrings, listFiles } from './lib/fs';
import { looksBinary } from './lib/patterns';

/** The RXPGuides commit docs/RXP.md was written against (§2). Bumping it is a reviewed change. */
export const RXPGUIDES_PIN = {
  repository: 'https://github.com/RestedXP/RXPGuides',
  commit: 'c3429e065c06271827e9e412306fb1cede5ae852',
} as const;

/** Lines shorter than this (after trimming, in code points) are vocabulary or minimal syntax (§19.2). */
export const MIN_LINE_LENGTH = 24;

/** Our directories that are checked (ARCHITECTURE §17). */
export const SCANNED_ROOTS: readonly string[] = ['src', 'public', 'tests', 'docs/research/rxp-samples'];

/** Our directories that hold RXP guide text, whose lines are also compared in canonical form (docs/RXP.md §19.2). */
export const RXP_TEXT_ROOTS: readonly string[] = ['docs/research/rxp-samples', 'tests/fixtures/rxp'];

/** The part of the RXPGuides tree that holds guides. */
export const REFERENCE_ROOT = 'Guides';

export const ALLOWLIST_FILE = 'tools/build/rxp-overlap-allowlist.json';

export interface TextFile {
  /** `/`-separated, relative to the tree it was read from. */
  readonly path: string;
  readonly text: string;
}

export interface AllowlistEntry {
  /** Repository-relative path of our file. */
  readonly file: string;
  /** The trimmed line, exactly. */
  readonly text: string;
  readonly reason: string;
}

export interface Allowlist {
  /** The RXPGuides commit the entries were reviewed against. */
  readonly commit: string;
  readonly minLength: number;
  readonly entries: readonly AllowlistEntry[];
}

export interface Overlap {
  readonly file: string;
  /** 1-based line number in our file. */
  readonly line: number;
  /** Our line, trimmed (the allowlist key). */
  readonly text: string;
  /** `line`: the line as written matched; `canonical`: only its canonical form did. */
  readonly form: 'line' | 'canonical';
}

export interface OverlapReport {
  readonly overlaps: readonly Overlap[];
  readonly allowed: readonly Overlap[];
  readonly staleEntries: readonly AllowlistEntry[];
  readonly scannedFiles: number;
}

/** The trimmed line when it is long enough to compare, else null. */
export function comparableLine(line: string): string | null {
  const trimmed = line.trim();
  return [...trimmed].length >= MIN_LINE_LENGTH ? trimmed : null;
}

const linesOf = (text: string): string[] => text.split(/\r\n|\r|\n/);

/**
 * The canonical form of each line of `text` read as RXP guide text (docs/RXP.md §13.4, without
 * indentation), when it is long enough to compare; null for a line that has none (a blank line, or
 * one canonical output refuses). Index = line − 1, as in `linesOf`.
 */
export function canonicalLines(text: string): (string | null)[] {
  return parseRxpCst(text).lines.map((line) => {
    try {
      const content = canonicalCstContent(line);
      return content === null ? null : comparableLine(content);
    } catch {
      return null;
    }
  });
}

/** Every comparable line of the reference files, as written and in canonical form. */
export function referenceLineSet(files: Iterable<TextFile>): Set<string> {
  const out = new Set<string>();
  for (const file of files) {
    for (const line of linesOf(file.text)) {
      const comparable = comparableLine(line);
      if (comparable !== null) out.add(comparable);
    }
    for (const canonical of canonicalLines(file.text)) if (canonical !== null) out.add(canonical);
  }
  return out;
}

const isRxpText = (path: string): boolean => RXP_TEXT_ROOTS.some((root) => path.startsWith(`${root}/`));

/** Our comparable lines that occur in the reference set, split into allowlisted and not. */
export function findOverlaps(ours: readonly TextFile[], reference: ReadonlySet<string>, allowlist: readonly AllowlistEntry[]): OverlapReport {
  const allowedKeys = new Set(allowlist.map((entry) => `${entry.file}\u0000${entry.text}`));
  const used = new Set<string>();
  const overlaps: Overlap[] = [];
  const allowed: Overlap[] = [];
  for (const file of [...ours].sort((a, b) => compareStrings(a.path, b.path))) {
    const canonical = isRxpText(file.path) ? canonicalLines(file.text) : [];
    linesOf(file.text).forEach((line, index) => {
      const comparable = comparableLine(line);
      const canonicalForm = canonical[index] ?? null;
      let form: Overlap['form'];
      if (comparable !== null && reference.has(comparable)) form = 'line';
      else if (canonicalForm !== null && reference.has(canonicalForm)) form = 'canonical';
      else return;
      const text = line.trim();
      const key = `${file.path}\u0000${text}`;
      const hit: Overlap = { file: file.path, line: index + 1, text, form };
      if (allowedKeys.has(key)) {
        allowed.push(hit);
        used.add(key);
      } else overlaps.push(hit);
    });
  }
  const staleEntries = allowlist.filter((entry) => !used.has(`${entry.file}\u0000${entry.text}`));
  return { overlaps, allowed, staleEntries, scannedFiles: ours.length };
}

/** Text files below `dirs` of `root` (binary files skipped), with repository-style paths. */
export function readTextFiles(root: string, dirs: readonly string[]): TextFile[] {
  const out: TextFile[] = [];
  for (const dir of dirs) {
    const absolute = join(root, dir);
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) continue;
    for (const relative of listFiles(absolute)) {
      const path = `${dir}/${relative}`;
      const bytes = readFileSync(join(root, path));
      if (looksBinary(bytes)) continue;
      out.push({ path, text: bytes.toString('utf8') });
    }
  }
  return out.sort((a, b) => compareStrings(a.path, b.path));
}

export function parseAllowlist(json: unknown): Allowlist {
  const fail = (message: string): never => {
    throw new Error(`${ALLOWLIST_FILE}: ${message}`);
  };
  if (typeof json !== 'object' || json === null) return fail('expected an object');
  const record = json as Record<string, unknown>;
  const { commit, minLength, entries } = record;
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) return fail('"commit" must be a full 40-character SHA');
  if (minLength !== MIN_LINE_LENGTH) return fail(`"minLength" must be ${String(MIN_LINE_LENGTH)}`);
  if (!Array.isArray(entries)) return fail('"entries" must be an array');
  const parsed = entries.map((entry: unknown, index): AllowlistEntry => {
    if (typeof entry !== 'object' || entry === null) return fail(`entries[${String(index)}] must be an object`);
    const { file, text, reason, ...rest } = entry as Record<string, unknown>;
    if (Object.keys(rest).length > 0) return fail(`entries[${String(index)}] has unknown keys ${Object.keys(rest).join(', ')}`);
    if (typeof file !== 'string' || !SCANNED_ROOTS.some((root) => file.startsWith(`${root}/`))) return fail(`entries[${String(index)}].file must be a path under a scanned root`);
    if (typeof text !== 'string' || comparableLine(text) !== text) return fail(`entries[${String(index)}].text must be a trimmed line of at least ${String(MIN_LINE_LENGTH)} characters`);
    if (typeof reason !== 'string' || reason.trim() === '') return fail(`entries[${String(index)}].reason must say why the line may stay`);
    return { file, text, reason };
  });
  return { commit, minLength, entries: parsed };
}

export function formatReport(report: OverlapReport, referenceLines: number): string {
  const lines = [
    `rxp-overlap: ${String(report.scannedFiles)} files scanned against ${String(referenceLines)} RXPGuides guide lines (${RXPGUIDES_PIN.commit.slice(0, 7)}); ` +
      `${String(report.overlaps.length)} overlap(s), ${String(report.allowed.length)} allowlisted, ${String(report.staleEntries.length)} stale allowlist entr${report.staleEntries.length === 1 ? 'y' : 'ies'}.`,
  ];
  for (const hit of report.overlaps) lines.push(`  ${hit.file}:${String(hit.line)}: equals an RXPGuides guide line${hit.form === 'canonical' ? ' in canonical form' : ''}: ${hit.text}`);
  for (const entry of report.staleEntries) lines.push(`  stale allowlist entry (no longer overlaps): ${entry.file}: ${entry.text}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// CLI

function git(args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

/** Fetches exactly the pinned commit into `dir` (network) and checks it out without line-ending conversion. */
function clonePinned(dir: string): void {
  git(['init', '--quiet', dir]);
  git(['-C', dir, 'config', 'core.autocrlf', 'false']);
  git(['-C', dir, 'remote', 'add', 'origin', RXPGUIDES_PIN.repository]);
  git(['-C', dir, 'fetch', '--quiet', '--depth', '1', '--no-tags', 'origin', RXPGUIDES_PIN.commit]);
  git(['-C', dir, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', 'FETCH_HEAD']);
}

function main(argv: readonly string[]): number {
  const keep = argv.includes('--keep');
  const referenceAt = argv.indexOf('--reference');
  const reference = referenceAt >= 0 ? argv[referenceAt + 1] : undefined;
  if (argv.some((arg, index) => arg.startsWith('--') && arg !== '--keep' && arg !== '--reference' && index !== referenceAt + 1) || (referenceAt >= 0 && reference === undefined)) {
    throw new Error('usage: rxp-overlap.ts [--reference <RXPGuides clone>] [--keep]');
  }
  const allowlist = parseAllowlist(JSON.parse(readFileSync(join(REPO_ROOT, ALLOWLIST_FILE), 'utf8')) as unknown);
  if (allowlist.commit !== RXPGUIDES_PIN.commit) throw new Error(`${ALLOWLIST_FILE} was reviewed against ${allowlist.commit}, but the pin is ${RXPGUIDES_PIN.commit}; review it again`);
  const dir = reference ?? mkdtempSync(join(tmpdir(), 'rxp-overlap-'));
  try {
    if (reference === undefined) {
      console.log(`rxp-overlap: fetching ${RXPGUIDES_PIN.repository} at ${RXPGUIDES_PIN.commit} into a temporary directory (network)`);
      clonePinned(dir);
    }
    const head = git(['-C', dir, 'rev-parse', 'HEAD']);
    if (head !== RXPGUIDES_PIN.commit) throw new Error(`the clone is at ${head}, not at the pinned ${RXPGUIDES_PIN.commit}`);
    const referenceLines = referenceLineSet(readTextFiles(dir, [REFERENCE_ROOT]));
    if (referenceLines.size === 0) throw new Error(`no ${REFERENCE_ROOT}/ lines found in the clone`);
    const report = findOverlaps(readTextFiles(REPO_ROOT, SCANNED_ROOTS), referenceLines, allowlist.entries);
    const passed = report.overlaps.length === 0 && report.staleEntries.length === 0;
    (passed ? console.log : console.error)(formatReport(report, referenceLines.size));
    return passed ? 0 : 1;
  } finally {
    if (reference === undefined && !keep) rmSync(dir, { recursive: true, force: true });
    else if (reference === undefined) console.log(`rxp-overlap: kept the clone at ${dir}`);
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`rxp-overlap: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
