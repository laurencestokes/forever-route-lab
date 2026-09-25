import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { REPO_ROOT } from '../../build/lib/fs';
import { CONVERSION_PATH } from './constants';
import { readGitBlob, resolveCommit } from './git';
import { resolvePin } from './pin';
import { buildPlaceholder, type PlaceholderBuild } from './placeholder';

/** Where the placeholder's two inputs are read from (import.ts and validate.ts share this). */
export interface PlaceholderRunOptions {
  /** A clone of QuestieDB containing the pinned commit; null for the pin's `cachePath` (.cache/questiedb). */
  readonly questiedbRepo: string | null;
  /** --commit, or null for the pin (lib/pin.ts). */
  readonly commit: string | null;
  /** The committed rows file (absolute path). */
  readonly rowsFile: string;
}

export const toPosix = (path: string): string => path.split('\\').join('/');

/** A repository-relative command-line path made absolute, or null when the option was not given. */
export const optionalPath = (path: string | undefined): string | null => (path === undefined ? null : resolve(REPO_ROOT, path));

/**
 * Reads conversion.json as the LF git blob at the pinned commit and the committed rows file, and
 * builds the placeholder in memory. Throws when the checkout is missing, the commit is absent, or
 * the blob does not hash to the pinned SHA-256.
 */
export function runPlaceholderBuild(options: PlaceholderRunOptions): PlaceholderBuild {
  const pin = resolvePin(REPO_ROOT, options.commit);
  const repo = options.questiedbRepo ?? resolve(REPO_ROOT, pin.cachePath);
  if (!existsSync(repo)) {
    throw new Error(`QuestieDB checkout ${repo} not found; fetch the pinned commit first (pnpm data:fetch)`);
  }
  const commit = resolveCommit(repo, pin.commit);
  if (commit !== pin.commit) throw new Error(`${pin.commit} resolved to ${commit}`);
  return buildPlaceholder({
    conversion: {
      bytes: readGitBlob(repo, commit, CONVERSION_PATH),
      repoUrl: pin.repository,
      commit,
      path: CONVERSION_PATH,
      expectedSha256: pin.conversionSha256,
    },
    rows: { bytes: readFileSync(options.rowsFile), path: toPosix(relative(REPO_ROOT, options.rowsFile)) },
    licenceCheckDate: pin.licenceCheckDate,
  });
}
