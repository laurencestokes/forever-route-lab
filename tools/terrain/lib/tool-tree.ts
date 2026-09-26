import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * The tool tree hash of the navigation build (manifest `tool.toolTreeHash`, TN-16): the SHA-256
 * over the sorted `path sha256` lines of every repository module the build loads, found by
 * following relative imports from its entry points (`extract.ts` and the stage-1 worker), with
 * each file's bytes normalised to LF. That is the part of `tools/terrain` and `tools/casc` the
 * outputs depend on, plus the `src/` modules it reads the dataset and geometry through; tests,
 * READMEs, the byproduct tool and the committed inputs (hashed separately) are not in it.
 */

const IMPORT = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)|new URL\(\s*['"](\.[^'"]+\.ts)['"]/g;

function resolveModule(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (candidate.endsWith('.ts') && existsSync(candidate)) return candidate;
  }
  return null;
}

export function moduleClosure(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const stack = entries.map((e) => resolve(e));
  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec === undefined) continue;
      const target = resolveModule(file, spec);
      if (target === null) throw new Error(`tool-tree: cannot resolve ${spec} from ${file}`);
      if (!seen.has(target)) stack.push(target);
    }
  }
  return [...seen].sort();
}

export function toolTreeHash(repoRoot: string, entries: readonly string[]): { hash: string; files: string[] } {
  const files = moduleClosure(entries).map((f) => relative(repoRoot, f).split('\\').join('/')).sort();
  const h = createHash('sha256');
  for (const f of files) {
    const text = readFileSync(join(repoRoot, f), 'utf8').replace(/\r\n/g, '\n');
    h.update(`${f} ${createHash('sha256').update(text, 'utf8').digest('hex')}\n`);
  }
  return { hash: h.digest('hex'), files };
}
