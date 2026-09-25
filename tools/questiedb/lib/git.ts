import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Git access for tools/questiedb. Inputs are always read as **committed blobs** of the pinned
 * commit (`git cat-file blob <commit>:<path>`), never from a working tree: the development machine
 * checks QuestieDB out with core.autocrlf, so its working files are CRLF and hash differently
 * (DATA_PROVENANCE §4).
 *
 * Only `fetch.ts` may reach the network. `fetch.ts` makes a shallow clone with every blob of the
 * pinned commit (not a partial clone), so nothing can be fetched lazily later. For an older partial
 * clone, `GIT_NO_LAZY_FETCH` stops lazy fetching, but git only knows it from 2.45; with an older
 * git, the extractor first checks that every input blob is present with a listing that never
 * fetches ({@link localObjects}), and refuses otherwise (review finding data-F4).
 */

const MAX_BUFFER = 512 * 1024 * 1024;

export function git(
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv; readonly allowLazyFetch?: boolean; readonly input?: string } = {},
): Buffer {
  const env = { ...process.env, ...options.env };
  if (options.allowLazyFetch !== true) env.GIT_NO_LAZY_FETCH = '1';
  return execFileSync('git', [...args], {
    cwd: options.cwd,
    env,
    input: options.input,
    maxBuffer: MAX_BUFFER,
    stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

export const gitText = (args: readonly string[], options: Parameters<typeof git>[1] = {}): string => git(args, options).toString('utf8').trim();

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface GitCapabilities {
  /** `git version` output, e.g. "git version 2.44.0.windows.1". */
  readonly version: string;
  /** Whether this git honours `--no-lazy-fetch` / `GIT_NO_LAZY_FETCH` (git 2.45 and later). */
  readonly noLazyFetch: boolean;
}

/** Feature-detects `--no-lazy-fetch` (introduced together with GIT_NO_LAZY_FETCH) rather than parsing version numbers. */
export function gitCapabilities(): GitCapabilities {
  const version = gitText(['version']);
  let noLazyFetch = true;
  try {
    git(['--no-lazy-fetch', 'version']);
  } catch {
    noLazyFetch = false;
  }
  return { version, noLazyFetch };
}

/**
 * A partial (promisor) clone can fetch missing objects lazily; a normal clone cannot. Git marks
 * one with `remote.<name>.promisor = true` (and, in older versions, `extensions.partialClone`).
 */
export function isPartialClone(repo: string): boolean {
  const config = (args: readonly string[]): string => {
    try {
      return gitText(['-C', repo, 'config', ...args]);
    } catch {
      return ''; // not set
    }
  };
  if (config(['--get', 'extensions.partialclone']) !== '') return true;
  return config(['--get-regexp', '^remote\\..*\\.promisor$'])
    .split('\n')
    .some((line) => /\s(true|yes|on|1)$/i.test(line.trim()));
}

export interface TreeEntry {
  readonly blob: string;
}

/**
 * Every blob of `commit`, keyed by its `/`-separated path (`git ls-tree -r`). Sizes are not asked
 * for: `-l` reads every blob's header, which a partial clone would fetch.
 */
export function listTree(repo: string, commit: string): ReadonlyMap<string, TreeEntry> {
  const out = new Map<string, TreeEntry>();
  const text = git(['-C', repo, 'ls-tree', '-r', '-z', '--full-tree', commit]).toString('utf8');
  for (const record of text.split('\0')) {
    if (record === '') continue;
    const tab = record.indexOf('\t');
    const [, type, object] = record.slice(0, tab).split(/\s+/);
    if (type !== 'blob' || object === undefined) continue;
    out.set(record.slice(tab + 1), { blob: object });
  }
  return out;
}

/**
 * The object ids present in the local object store, from a listing that only enumerates what is
 * there (`cat-file --batch-all-objects`), so it never fetches, whatever the git version.
 */
export function localObjects(repo: string): ReadonlySet<string> {
  const text = git(['-C', repo, 'cat-file', '--batch-all-objects', '--batch-check=%(objectname)', '--unordered']).toString('utf8');
  return new Set(text.split('\n').filter((line) => line !== ''));
}

/**
 * Parses `git cat-file --batch` output for `paths`, in order: `<oid> <type> <size>\n<bytes>\n`, or
 * `<name> missing\n` for an object that is not available locally (mapped to null).
 */
export function parseCatFileBatch(out: Buffer, paths: readonly string[]): ReadonlyMap<string, Buffer | null> {
  const result = new Map<string, Buffer | null>();
  let offset = 0;
  for (const path of paths) {
    const newline = out.indexOf(0x0a, offset);
    if (newline < 0) throw new Error('git cat-file --batch: truncated output');
    const header = out.subarray(offset, newline).toString('utf8');
    offset = newline + 1;
    if (header.endsWith(' missing')) {
      result.set(path, null);
      continue;
    }
    const [, type, size] = header.split(' ');
    const bytes = Number(size);
    if (type !== 'blob' || size === undefined || !Number.isInteger(bytes) || bytes < 0) throw new Error(`git cat-file --batch: ${path} is ${header}`);
    if (offset + bytes >= out.length || out[offset + bytes] !== 0x0a) throw new Error(`git cat-file --batch: ${path} is truncated`);
    result.set(path, Buffer.from(out.subarray(offset, offset + bytes)));
    offset += bytes + 1;
  }
  if (offset !== out.length) throw new Error('git cat-file --batch: unexpected trailing output');
  return result;
}

/**
 * Several blobs of `commit` in one `git cat-file --batch` process. A path whose blob is missing
 * locally maps to null. Callers make sure nothing can be fetched here (see the module comment).
 */
export function readBlobs(repo: string, commit: string, paths: readonly string[]): ReadonlyMap<string, Buffer | null> {
  for (const path of paths) if (/[\r\n]/.test(path)) throw new Error(`path ${JSON.stringify(path)} contains a newline`);
  const input = paths.map((path) => `${commit}:${path}\n`).join('');
  return parseCatFileBatch(git(['-C', repo, 'cat-file', '--batch'], { input }), paths);
}

/**
 * Fetches `oids` from the promisor remote in **one** request, the way git's own lazy fetch does
 * (promisor-remote.c), instead of one round trip per object.
 */
export function fetchObjects(repo: string, oids: readonly string[]): void {
  if (oids.length === 0) return;
  git(['-C', repo, '-c', 'fetch.negotiationAlgorithm=noop', 'fetch', 'origin', '--no-tags', '--no-write-fetch-head', '--recurse-submodules=no', '--filter=blob:none', '--stdin'], {
    allowLazyFetch: true,
    input: `${oids.join('\n')}\n`,
  });
}

export function hasCommit(repo: string, commit: string): boolean {
  try {
    git(['-C', repo, 'cat-file', '-e', `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** Committer date in strict ISO 8601, as recorded by git (for the manifest). */
export const commitDate = (repo: string, commit: string): string => gitText(['-C', repo, 'show', '-s', '--format=%cI', commit]);

/** Whether `repoRoot` is the top level of a git working tree that git can read. */
export function isGitCheckout(repoRoot: string): boolean {
  try {
    const top = gitText(['rev-parse', '--show-toplevel'], { cwd: repoRoot });
    return realpathSync(resolve(top)).toLowerCase() === realpathSync(resolve(repoRoot)).toLowerCase();
  } catch {
    return false;
  }
}

/**
 * The git tree id of `dir` in the working tree, as a commit containing the current files would
 * record it (DATA_PROVENANCE §8.1 `toolTreeHash.tree`). A temporary index is used, so the real
 * index is untouched; `.gitignore` and `.gitattributes` (LF normalisation) apply as for a commit.
 * Outside a git checkout, lib/git-tree.ts computes the same id in-process.
 */
export function workingTreeId(repoRoot: string, dir: string): string {
  const temp = mkdtempSync(join(tmpdir(), 'questiedb-tree-'));
  const env = { GIT_INDEX_FILE: join(temp, 'index') };
  try {
    git(['add', '-A', '--', dir], { cwd: repoRoot, env });
    return gitText(['write-tree', `--prefix=${dir}/`], { cwd: repoRoot, env });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
