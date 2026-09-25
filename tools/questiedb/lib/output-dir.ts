import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Comparing a generated directory with a fresh extraction (`extract --check`, DATA_PROVENANCE §5
 * step 2): every rendered file must exist with the same bytes, and no other file may be there
 * (review finding code-F11), as `validate` also requires.
 */

/** Files in `dir` that the extractor does not write (stale or stray), sorted. */
export function staleFiles(dir: string, rendered: ReadonlyMap<string, string>): readonly string[] {
  return existsSync(dir) ? readdirSync(dir).filter((name) => !rendered.has(name)).sort() : [];
}

/** Every difference between `dir` and the rendered files; paths are reported relative to `root`. */
export function compareDirectory(dir: string, rendered: ReadonlyMap<string, string>, root: string): readonly string[] {
  const problems: string[] = [];
  for (const [path, content] of rendered) {
    const target = join(dir, path);
    if (!existsSync(target)) problems.push(`${relative(root, target)}: missing`);
    else if (!readFileSync(target).equals(Buffer.from(content, 'utf8'))) problems.push(`${relative(root, target)}: differs from a fresh extraction`);
  }
  for (const name of staleFiles(dir, rendered)) problems.push(`${relative(root, join(dir, name))}: not a file the extractor writes (remove it)`);
  return problems;
}
