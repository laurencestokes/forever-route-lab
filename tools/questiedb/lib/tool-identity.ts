import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isGitCheckout, sha256Hex, workingTreeId } from './git';
import { inProcessTreeId } from './git-tree';
import type { ToolIdentity } from './pipeline';
import { REPO_ROOT, TOOL_DIR } from './upstream';

/**
 * `toolTreeHash` and `runtime` of the manifest (DATA_PROVENANCE §8.1):
 *
 * - `tree`: the git tree id of tools/questiedb as a commit of the working files would record it;
 *   from git in a checkout, or computed in-process (lib/git-tree.ts) in a copy without `.git`;
 * - `lockfile`: the SHA-256 of the lockfile entries the tool runs with (review finding data-F6),
 *   not of the whole pnpm-lock.yaml, so an unrelated dependency change does not change it;
 * - `runtime.luaparse`: the luaparse version the lockfile pins.
 *
 * The Node version is not part of the manifest (the output bytes do not depend on it: ECMAScript
 * defines the shortest round-trip number format); the report records it (data-F5).
 */

/** The npm packages whose code runs when the tool extracts or validates: the parser, the schemas and the TypeScript runner. */
export const TOOL_PACKAGES = ['luaparse', 'tsx', 'zod'] as const;

export function lockfileText(repoRoot = REPO_ROOT): string {
  return readFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'utf8').replace(/\r\n/g, '\n');
}

interface ImporterEntry {
  readonly specifier: string;
  readonly version: string;
}

/** The `importers['.']` entry of one package in a pnpm v9 lockfile (dependencies or devDependencies). */
function importerEntry(lines: readonly string[], name: string): ImporterEntry {
  const start = lines.indexOf('importers:');
  const root = lines.indexOf('  .:', start);
  if (start < 0 || root < 0) throw new Error('pnpm-lock.yaml: no importers["."] section');
  for (let i = root + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^\S/.test(line) || /^ {2}\S/.test(line)) break; // the next section or importer
    if (line === `      ${name}:` || line === `      '${name}':`) {
      const specifier = /^ {8}specifier: (.+)$/.exec(lines[i + 1] ?? '')?.[1];
      const version = /^ {8}version: (.+)$/.exec(lines[i + 2] ?? '')?.[1];
      if (specifier === undefined || version === undefined) throw new Error(`pnpm-lock.yaml: importer entry for ${name} is not "specifier, version"`);
      return { specifier, version };
    }
  }
  throw new Error(`pnpm-lock.yaml: ${name} is not a direct dependency`);
}

/** The lines of one `packages:` or `snapshots:` entry, its key line included. */
function sectionEntry(lines: readonly string[], section: 'packages' | 'snapshots', key: string): readonly string[] {
  const start = lines.indexOf(`${section}:`);
  if (start < 0) throw new Error(`pnpm-lock.yaml: no ${section} section`);
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^\S/.test(line)) break;
    if (line === `  ${key}:` || line === `  '${key}':` || line === `  ${key}: {}` || line === `  '${key}': {}`) {
      const entry = [line.trim()];
      for (let j = i + 1; j < lines.length && /^ {4}/.test(lines[j] ?? ''); j += 1) entry.push(lines[j] ?? '');
      return entry;
    }
  }
  throw new Error(`pnpm-lock.yaml: no ${section} entry ${key}`);
}

/**
 * The canonical text of the lockfile entries {@link TOOL_PACKAGES} resolve to: the lockfile
 * version, and for each package its importer specifier and version, its `packages:` entry
 * (resolution integrity) and its `snapshots:` entry (the versions of its own dependencies).
 */
export function toolLockfileEntries(lockfile: string): string {
  const lines = lockfile.split('\n');
  const version = lines.find((line) => line.startsWith('lockfileVersion:'));
  if (version === undefined) throw new Error('pnpm-lock.yaml: no lockfileVersion');
  const out = [version];
  for (const name of TOOL_PACKAGES) {
    const entry = importerEntry(lines, name);
    out.push(`importer ${name} ${entry.specifier} ${entry.version}`);
    out.push(...sectionEntry(lines, 'packages', `${name}@${entry.version.replace(/\(.*$/, '')}`));
    out.push(...sectionEntry(lines, 'snapshots', `${name}@${entry.version}`));
  }
  return `${out.join('\n')}\n`;
}

export function luaparseVersion(lockfile: string): string {
  const { version } = importerEntry(lockfile.split('\n'), 'luaparse');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`pnpm-lock.yaml: unexpected luaparse version ${version}`);
  return version;
}

export function toolIdentity(repoRoot = REPO_ROOT): ToolIdentity {
  const lockfile = lockfileText(repoRoot);
  const inGit = isGitCheckout(repoRoot);
  const tree = inGit ? workingTreeId(repoRoot, TOOL_DIR) : inProcessTreeId(repoRoot, TOOL_DIR);
  if (tree === null) throw new Error(`${TOOL_DIR} holds no files git would commit`);
  return {
    toolTreeHash: { tree, lockfile: sha256Hex(toolLockfileEntries(lockfile)) },
    runtime: { luaparse: luaparseVersion(lockfile) },
    treeMethod: inGit ? 'git' : 'in-process',
  };
}
