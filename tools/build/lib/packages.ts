import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { compareStrings } from './fs';

/**
 * One installed package as `pnpm licenses list --json` reports it. `directory` is an absolute
 * install path: use it to read files, never write it into an output (audit-dist rejects user
 * paths in dist/).
 */
export interface InstalledPackage {
  readonly name: string;
  readonly version: string;
  /** The declared licence, verbatim (an SPDX expression when the package is well behaved). */
  readonly licence: string;
  readonly directory: string;
}

/** Why a package's code ships in dist/. */
export type Inclusion = 'production' | 'bundled-dev';

export interface ShippedPackage extends InstalledPackage {
  readonly inclusion: Inclusion;
  /** For `bundled-dev`: why its code reaches dist/ (from bundled-dev-dependencies.json). */
  readonly reason: string | null;
  /** For `bundled-dev`: notices keep each licence file only up to this exact line. */
  readonly licenceTextUntil: string | null;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export function comparePackages(a: InstalledPackage, b: InstalledPackage): number {
  return compareStrings(a.name, b.name) || compareStrings(a.version, b.version);
}

/**
 * Flattens the pnpm 10 output shape, `{ [licence]: [{ name, versions[], paths[], license, ... }] }`
 * (checked against pnpm 10.33.0), into one sorted entry per name and version. `versions` and
 * `paths` are parallel arrays. Throws on any other shape, so a pnpm upgrade that changes the
 * format fails the gate instead of silently passing it.
 */
export function parsePnpmLicences(value: unknown): readonly InstalledPackage[] {
  if (!isRecord(value)) throw new Error('pnpm licenses output: expected a JSON object keyed by licence');
  const byKey = new Map<string, InstalledPackage>();
  for (const [groupLicence, group] of Object.entries(value)) {
    if (!Array.isArray(group)) throw new Error(`pnpm licenses output: group "${groupLicence}" is not an array`);
    for (const entry of group as readonly unknown[]) {
      if (!isRecord(entry)) throw new Error(`pnpm licenses output: malformed entry in group "${groupLicence}"`);
      const { name, versions, paths, license } = entry;
      if (typeof name !== 'string' || !isStringArray(versions) || !isStringArray(paths)) {
        throw new Error(`pnpm licenses output: malformed entry in group "${groupLicence}"`);
      }
      if (versions.length !== paths.length) {
        throw new Error(`pnpm licenses output: ${name} has ${String(versions.length)} versions but ${String(paths.length)} paths`);
      }
      const licence = typeof license === 'string' && license.trim() !== '' ? license.trim() : groupLicence;
      versions.forEach((version, index) => {
        byKey.set(`${name}@${version}`, { name, version, licence, directory: paths[index] ?? '' });
      });
    }
  }
  return [...byKey.values()].sort(comparePackages);
}

/**
 * Runs `pnpm licenses list --json` (with `--prod` for production dependencies only) in `cwd`.
 * The command line is a constant, so running it through the shell (needed for `pnpm.cmd` on
 * Windows) cannot inject anything.
 */
export function runPnpmLicences(cwd: string, scope: 'prod' | 'all'): unknown {
  const command = scope === 'prod' ? 'pnpm licenses list --prod --json' : 'pnpm licenses list --json';
  const result = spawnSync(command, { cwd, encoding: 'utf8', shell: true, maxBuffer: 256 * 1024 * 1024 });
  if (result.error !== undefined) throw new Error(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${String(result.status)}:\n${result.stderr.trim()}`);
  }
  const text = result.stdout.trim();
  // pnpm prints nothing (or "No licenses in packages found") when there are no dependencies.
  if (text === '' || !text.startsWith('{')) return {};
  return JSON.parse(text) as unknown;
}

export interface BundledDevDependency {
  readonly name: string;
  readonly reason: string;
  /**
   * Optional: the line at which the package's licence file stops describing the package itself
   * (for example where Vite's LICENSE.md starts listing its own bundled Node dependencies, none
   * of which reach dist/).
   */
  readonly licenceTextUntil: string | null;
}

/** Parses tools/build/bundled-dev-dependencies.json: `{ packages: [{ name, reason, licenceTextUntil? }] }`. */
export function parseBundledDevDependencies(value: unknown): readonly BundledDevDependency[] {
  if (!isRecord(value) || !Array.isArray(value.packages)) {
    throw new Error('bundled-dev-dependencies.json: expected { "packages": [...] }');
  }
  return (value.packages as readonly unknown[]).map((entry, index) => {
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      throw new Error(`bundled-dev-dependencies.json: packages[${String(index)}] needs a "name" and a non-empty "reason"`);
    }
    const until = entry.licenceTextUntil;
    if (until !== undefined && (typeof until !== 'string' || until === '')) {
      throw new Error(`bundled-dev-dependencies.json: packages[${String(index)}].licenceTextUntil must be a non-empty string`);
    }
    return { name: entry.name, reason: entry.reason.trim(), licenceTextUntil: until ?? null };
  });
}

/**
 * The packages whose code ships in dist/: every production dependency (transitively), plus the
 * listed development dependencies whose code the bundler injects (ARCHITECTURE §16). A listed
 * development dependency that is not installed is an error, so the list cannot go stale.
 */
export function selectShippedPackages(
  production: readonly InstalledPackage[],
  all: readonly InstalledPackage[],
  bundled: readonly BundledDevDependency[],
): readonly ShippedPackage[] {
  const out = new Map<string, ShippedPackage>();
  for (const pkg of production) out.set(`${pkg.name}@${pkg.version}`, { ...pkg, inclusion: 'production', reason: null, licenceTextUntil: null });
  for (const dep of bundled) {
    const matches = all.filter((pkg) => pkg.name === dep.name);
    if (matches.length === 0) throw new Error(`bundled-dev-dependencies.json lists ${dep.name}, which is not installed`);
    for (const pkg of matches) {
      const key = `${pkg.name}@${pkg.version}`;
      if (!out.has(key)) {
        out.set(key, { ...pkg, inclusion: 'bundled-dev', reason: dep.reason, licenceTextUntil: dep.licenceTextUntil });
      }
    }
  }
  return [...out.values()].sort(comparePackages);
}

/**
 * Every direct production dependency in package.json must appear in the listing, so an
 * uninstalled or partial node_modules cannot make the gate pass vacuously.
 */
export function assertDirectDependenciesListed(production: readonly InstalledPackage[], packageJson: unknown): void {
  const dependencies = isRecord(packageJson) && isRecord(packageJson.dependencies) ? Object.keys(packageJson.dependencies) : [];
  const listed = new Set(production.map((pkg) => pkg.name));
  const missing = dependencies.filter((name) => !listed.has(name)).sort(compareStrings);
  if (missing.length > 0) {
    throw new Error(`pnpm licenses list did not report ${missing.join(', ')}; run pnpm install first`);
  }
}

/** Reads the shipped package set for the repository at `repoRoot`. */
export function loadShippedPackages(repoRoot: string, bundledConfigPath: string): readonly ShippedPackage[] {
  const production = parsePnpmLicences(runPnpmLicences(repoRoot, 'prod'));
  assertDirectDependenciesListed(production, JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as unknown);
  const bundled = parseBundledDevDependencies(JSON.parse(readFileSync(bundledConfigPath, 'utf8')) as unknown);
  const all = bundled.length === 0 ? [] : parsePnpmLicences(runPnpmLicences(repoRoot, 'all'));
  return selectShippedPackages(production, all, bundled);
}

/**
 * Normalises a package.json `repository` field to a browsable URL where the form is recognised
 * (`git+https://…/x.git`, `git://…`, `git@host:owner/repo.git`, `github:owner/repo`,
 * `owner/repo`), appending a monorepo `directory` in parentheses. Returns null when absent.
 */
export function normaliseRepository(field: unknown): string | null {
  let url: string | null = null;
  let directory: string | null = null;
  if (typeof field === 'string') url = field;
  else if (isRecord(field) && typeof field.url === 'string') {
    url = field.url;
    if (typeof field.directory === 'string' && field.directory !== '') directory = field.directory;
  }
  if (url === null || url.trim() === '') return null;
  let normalised = url.trim();
  const shorthand = /^(?:(github|gitlab|bitbucket):)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/.exec(normalised);
  if (shorthand !== null) {
    const host = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org' }[
      (shorthand[1] ?? 'github') as 'github' | 'gitlab' | 'bitbucket'
    ];
    normalised = `https://${host}/${shorthand[2] ?? ''}`;
  } else {
    normalised = normalised
      .replace(/^git\+/, '')
      .replace(/^git@([^:]+):/, 'https://$1/')
      .replace(/^(?:git|ssh):\/\/(?:git@)?/, 'https://')
      .replace(/\.git$/, '');
  }
  return directory === null ? normalised : `${normalised} (${directory})`;
}

export interface PackageFileText {
  readonly file: string;
  readonly text: string;
}

const LICENCE_FILE = /^(?:licen[cs]e|copying)(?:[.-][A-Za-z0-9.-]*)?$/i;
const NOTICE_FILE = /^notice(?:\.[A-Za-z]+)?$/i;

/** Reads a package's top-level licence files and NOTICE files, sorted by name, LF endings. */
export function readPackageLegalFiles(directory: string): {
  readonly licences: readonly PackageFileText[];
  readonly notices: readonly PackageFileText[];
} {
  const names = existsSync(directory)
    ? readdirSync(directory)
        .filter((name) => statSync(join(directory, name)).isFile())
        .sort(compareStrings)
    : [];
  const read = (file: string): PackageFileText => ({
    file,
    text: readFileSync(join(directory, file), 'utf8').replace(/\r\n?/g, '\n').replace(/\s+$/, ''),
  });
  return {
    licences: names.filter((name) => LICENCE_FILE.test(name)).map(read),
    notices: names.filter((name) => NOTICE_FILE.test(name)).map(read),
  };
}

/** The `repository` field of the package.json in `directory`, normalised; null when absent. */
export function readPackageRepository(directory: string): string | null {
  const path = join(directory, 'package.json');
  if (!existsSync(path)) return null;
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  return isRecord(manifest) ? normaliseRepository(manifest.repository) : null;
}
