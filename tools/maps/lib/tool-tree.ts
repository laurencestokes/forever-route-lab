import { isGitCheckout, workingTreeId } from '../../questiedb/lib/git';
import { inProcessTreeId } from '../../questiedb/lib/git-tree';

/**
 * The `toolTreeHash` of a derived-output manifest (DATA_PROVENANCE §8.1's rule, applied to the map
 * art and the terrain byproducts, D-032, D-033): for each tool directory, the git tree id a commit
 * of its current files would record, from git in a checkout (a temporary index; the real one is
 * untouched) or computed in-process in a copy without `.git`. Any change under the directory,
 * tests and README included, changes it. The tree ids come from tools/questiedb's helpers, so
 * all manifests use one definition.
 */

export interface ToolTrees {
  /** Repository-relative directory → git tree id (40 hex). */
  readonly trees: Readonly<Record<string, string>>;
  readonly method: 'git' | 'in-process';
}

export function toolTrees(repoRoot: string, dirs: readonly string[]): ToolTrees {
  const inGit = isGitCheckout(repoRoot);
  const trees: Record<string, string> = {};
  for (const dir of [...dirs].sort()) {
    const tree = inGit ? workingTreeId(repoRoot, dir) : inProcessTreeId(repoRoot, dir);
    if (tree === null) throw new Error(`${dir} holds no files git would commit`);
    trees[dir] = tree;
  }
  return { trees, method: inGit ? 'git' : 'in-process' };
}
