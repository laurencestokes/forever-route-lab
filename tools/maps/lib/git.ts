import { execFileSync } from 'node:child_process';
import { isPartialClone, listTree, localObjects } from '../../questiedb/lib/git';

/**
 * Reading pinned upstream files as git blobs (ARCHITECTURE §5.1). `git cat-file blob` prints the
 * stored bytes with no end-of-line conversion or filters, so the hash is that of the LF blob even
 * in a Windows clone with `core.autocrlf=true`, whose working files are CRLF.
 *
 * Every call sets `GIT_NO_LAZY_FETCH=1`, as tools/questiedb/lib/git.ts does: in a partial
 * (blob-filtered) clone that lacks `conversion.json`, git then fails instead of fetching the blob
 * over the network, and the importer stays offline (`pnpm data:fetch` is the only step that
 * fetches). Git versions that predate the variable ignore it (2.44.0 does, M2 review data-F4), so
 * in a partial clone `readGitBlob` first checks that the blob is in the local object store, with
 * the listings tools/questiedb uses that never fetch (`localObjects`), and refuses otherwise.
 * `windowsHide` keeps a console window from flashing up on Windows.
 */

/** The environment every git call runs with. */
export const gitEnv = (): NodeJS.ProcessEnv => ({ ...process.env, GIT_NO_LAZY_FETCH: '1' });

function git(repo: string, args: readonly string[]): Buffer {
  return execFileSync('git', ['-C', repo, ...args], { env: gitEnv(), maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

/** The full commit id `rev` names in `repo`; throws when it does not name a commit there. */
export function resolveCommit(repo: string, rev: string): string {
  try {
    return git(repo, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]).toString('utf8').trim();
  } catch {
    throw new Error(`commit ${rev} is not available in ${repo} (fetch it first, for example with pnpm data:fetch)`);
  }
}

/**
 * Whether the blob of `path` at `commit` can be read without the network: always outside a
 * partial (promisor) clone, which cannot fetch lazily; in one, only when the blob is already in
 * the local object store (found without fetching, whatever the git version). A path the commit
 * does not have is left to `cat-file`, which fails on it without fetching.
 */
export function blobAvailableOffline(repo: string, commit: string, path: string): boolean {
  if (!isPartialClone(repo)) return true;
  const entry = listTree(repo, commit).get(path);
  return entry === undefined || localObjects(repo).has(entry.blob);
}

/** The bytes of `path` at `commit`, exactly as stored in the repository. Never fetches (see above). */
export function readGitBlob(repo: string, commit: string, path: string): Buffer {
  if (!blobAvailableOffline(repo, commit, path)) {
    throw new Error(`${path} at ${commit} is not in the local object store of the partial clone ${repo}; the importer never fetches (run pnpm data:fetch)`);
  }
  try {
    return git(repo, ['cat-file', 'blob', `${commit}:${path}`]);
  } catch {
    throw new Error(`cannot read ${path} at ${commit} from ${repo}`);
  }
}

/** True when `path` (relative to the repository root) is tracked by git: `git ls-files --error-unmatch`. */
export function isTracked(repo: string, path: string): boolean {
  try {
    git(repo, ['ls-files', '--error-unmatch', '--', path]);
    return true;
  } catch {
    return false;
  }
}

/** `git rev-parse HEAD` of `repo`, or null outside a repository. */
export function headCommit(repo: string): string | null {
  try {
    return git(repo, ['rev-parse', 'HEAD']).toString('utf8').trim();
  } catch {
    return null;
  }
}
