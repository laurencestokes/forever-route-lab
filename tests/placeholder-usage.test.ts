/**
 * Milestone 2 removed the Milestone 1 placeholder route and dataset from the running app: they
 * remain only as fixtures for the shell's editing tests. This test keeps it that way. No shipped
 * source file (anything under src/ that is not a test) may import them, except the placeholder
 * project, which is built on the placeholder dataset.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './support/fake-fetch';

const PLACEHOLDER_IMPORTS = /from\s+['"][^'"]*\/(placeholder-dataset|placeholder-project)['"]/g;
const imports = (file: string): string[] => [...readFileSync(join(REPO_ROOT, file), 'utf8').matchAll(PLACEHOLDER_IMPORTS)].map((m) => m[1] ?? '');
const TEST_FILE = /\.test\.tsx?$/;
const ALLOWED: ReadonlySet<string> = new Set(['src/app/placeholder-project.ts']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(REPO_ROOT, dir))) {
    const path = `${dir}/${name}`;
    if (statSync(join(REPO_ROOT, path)).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe('placeholder fixtures stay out of the running app', () => {
  it('are imported only by tests (and the placeholder project itself)', () => {
    const offenders = sourceFiles('src')
      .filter((file) => !TEST_FILE.test(file) && !ALLOWED.has(file))
      .flatMap((file) => imports(file).map((module) => `${file} imports ${module}`));
    expect(offenders).toEqual([]);
  });

  it('are still used by the shell tests, so keeping them is justified', () => {
    const users = sourceFiles('src').filter((file) => TEST_FILE.test(file) && imports(file).length > 0);
    expect(users.length).toBeGreaterThan(0);
  });
});
