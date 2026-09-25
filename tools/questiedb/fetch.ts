/**
 * Ensures a QuestieDB clone with the pinned commit in .cache (docs/DATA_PROVENANCE.md §5 step 1)
 * and verifies every pinned input: the LF blob SHA-256 against tools/questiedb/upstream.json, and
 * conversion.json's recorded output/source hashes against the blobs. An existing clone that
 * already has the commit and the input blobs is used as it is, with no network access.
 *
 * A new clone is a shallow fetch of the pinned commit alone (`--depth 1`, every blob of that
 * commit, `core.autocrlf=false`), not a partial clone, so nothing can be fetched lazily later. An
 * older partial clone that lacks input blobs gets them in one batched request, never one round trip
 * per blob (review finding data-F4). Inputs are always read as committed blobs, never from a
 * working tree.
 *
 * Usage: tsx tools/questiedb/fetch.ts [--commit <sha>]
 *   --commit  fetch another commit and print its input hashes for a reviewed pin bump
 *             (DATA_PROVENANCE §12); upstream.json is not modified
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { commitDate, fetchObjects, git, gitCapabilities, gitText, hasCommit, isPartialClone, listTree, localObjects, readBlobs, sha256Hex } from './lib/git';
import { cacheDir, InputHashError, loadUpstream, openPinnedSource } from './lib/upstream';

type How = 'cached' | 'fetched' | 'cloned';

function ensureCommit(repository: string, dir: string, commit: string): How {
  if (existsSync(dir)) {
    if (hasCommit(dir, commit)) return 'cached';
    console.log(`fetch: fetching commit ${commit} into ${dir} (network)`);
    git(['-C', dir, 'fetch', '--depth', '1', '--no-tags', 'origin', commit], { allowLazyFetch: true });
    return 'fetched';
  }
  mkdirSync(dirname(dir), { recursive: true });
  console.log(`fetch: cloning commit ${commit} of ${repository} into ${dir} (network; depth 1, every blob of the commit, core.autocrlf=false)`);
  git(['init', '--quiet', dir]);
  git(['-C', dir, 'config', 'core.autocrlf', 'false']);
  git(['-C', dir, 'remote', 'add', 'origin', repository]);
  git(['-C', dir, 'fetch', '--depth', '1', '--no-tags', 'origin', commit], { allowLazyFetch: true });
  return 'cloned';
}

/** Input blobs the clone lacks, found without fetching; fetched in one request. Returns how many. */
function ensureBlobs(dir: string, blobs: readonly string[]): number {
  const present = localObjects(dir);
  const missing = [...new Set(blobs.filter((oid) => !present.has(oid)))].sort();
  if (missing.length === 0) return 0;
  if (!isPartialClone(dir)) throw new Error(`${dir} lacks ${String(missing.length)} input blob(s) and is not a partial clone; delete it and run pnpm data:fetch again`);
  console.log(`fetch: fetching ${String(missing.length)} missing input blob(s) in one request (network)`);
  fetchObjects(dir, missing);
  const after = localObjects(dir);
  const still = missing.filter((oid) => !after.has(oid));
  if (still.length > 0) throw new Error(`the remote did not send ${String(still.length)} input blob(s): ${still.join(', ')}`);
  return missing.length;
}

function main(argv: readonly string[]): number {
  const started = performance.now();
  const pin = loadUpstream();
  const dir = cacheDir(pin);
  const override = argv.indexOf('--commit');
  if (argv.some((arg) => arg.startsWith('--') && arg !== '--commit') || (override >= 0 && argv[override + 1] === undefined)) {
    throw new Error('usage: fetch.ts [--commit <sha>]');
  }
  const commit = override >= 0 ? (argv[override + 1] ?? '') : pin.commit;
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`commit must be a full 40-character SHA, got ${commit}`);
  const caps = gitCapabilities();
  console.log(`fetch: ${caps.version}${caps.noLazyFetch ? '' : ' (no GIT_NO_LAZY_FETCH support; the extractor checks blob presence without fetching instead)'}`);
  const how = ensureCommit(pin.repository, dir, commit);
  const tree = listTree(dir, commit);
  const paths = pin.inputs.map((input) => input.path).filter((path) => tree.has(path));
  const fetchedBlobs = ensureBlobs(dir, paths.map((path) => tree.get(path)?.blob ?? ''));
  const network = how !== 'cached' || fetchedBlobs > 0;
  const what = { cached: 'already in the clone', fetched: 'fetched', cloned: 'cloned' }[how];
  console.log(
    `fetch: commit ${commit} ${what}; ${fetchedBlobs > 0 ? `${String(fetchedBlobs)} input blob(s) fetched` : 'every input blob present'}; ` +
      `${network ? 'network used' : 'no network access'} (${String(Math.round(performance.now() - started))} ms)`,
  );

  if (commit !== pin.commit) {
    // Pin bump: report the hashes a reviewer copies into upstream.json after reading the changes.
    const blobs = readBlobs(dir, commit, paths);
    const rows = pin.inputs.map((input) => {
      const bytes = blobs.get(input.path) ?? null;
      return { path: input.path, role: input.role, sha256: bytes === null ? null : sha256Hex(bytes), changed: bytes === null ? 'missing' : sha256Hex(bytes) !== input.sha256 };
    });
    console.log(JSON.stringify({ commit, commitDate: commitDate(dir, commit), inputs: rows }, null, 2));
    return 0;
  }

  try {
    const source = openPinnedSource(pin, dir, commitDate);
    const conversion = JSON.parse(source.read('data/Forever/conversion.json').toString('utf8')) as {
      readonly files?: Readonly<Record<string, { readonly source?: unknown; readonly source_sha256?: unknown; readonly output_sha256?: unknown }>>;
    };
    const hashOf = new Map(source.inputs.map((input) => [input.path, input.sha256]));
    const problems: string[] = [];
    for (const [output, entry] of Object.entries(conversion.files ?? {})) {
      if (hashOf.get(output) !== entry.output_sha256) problems.push(`${output}: blob hash differs from conversion.json output_sha256`);
      if (typeof entry.source !== 'string' || hashOf.get(entry.source) !== entry.source_sha256) problems.push(`${String(entry.source)}: blob hash differs from conversion.json source_sha256`);
    }
    if (problems.length > 0) {
      console.error(`fetch: conversion.json check failed:\n  ${problems.join('\n  ')}`);
      return 1;
    }
    let head: string | null;
    try {
      head = gitText(['-C', dir, 'rev-parse', '--verify', '--quiet', 'HEAD']);
    } catch {
      head = null; // a fetch-only clone has no checkout
    }
    const where = head === pin.commit ? 'the clone HEAD is at the pin' : `${head === null ? 'the clone has no checkout' : `the clone HEAD is ${head}`}; inputs are read from the pinned commit's blobs`;
    console.log(`fetch: ${String(source.inputs.length)} inputs match upstream.json; conversion.json's ${String(Object.keys(conversion.files ?? {}).length)} output and source hashes match; ${where}.`);
    return 0;
  } catch (error) {
    if (error instanceof InputHashError) {
      console.error(`fetch: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`fetch: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
