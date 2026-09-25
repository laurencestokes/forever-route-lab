import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, resolved from this file's location (tools/build/lib/). */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Code-unit order: locale-independent, so every generated listing is byte-stable. */
export function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Every regular file below `root`, as sorted `/`-separated paths relative to `root`. Symbolic
 * links are listed but never followed, so a link cannot pull files from outside `root`.
 */
export function listFiles(root: string): readonly string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir)) {
      const absolute = join(dir, name);
      const relative = prefix === '' ? name : `${prefix}/${name}`;
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) walk(absolute, relative);
      else out.push(relative);
    }
  };
  walk(root, '');
  return out.sort(compareStrings);
}

/** Human-readable size with 1000-byte kB, as Vite reports it. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${String(bytes)} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(2)} kB`;
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}
