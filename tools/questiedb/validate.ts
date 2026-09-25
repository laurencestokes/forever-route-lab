/**
 * Validates the generated dataset (docs/DATA_PROVENANCE.md §5 step 3): public/data and the fixture
 * slice tests/fixtures/data. Schema, `_generated` marking, NOTICE.md, manifest hashes and the
 * recomputed dataRevision, the pin and input checksums, toolTreeHash against the checkout, golden
 * counts, referential integrity, coordinate ranges and sentinels, zone tables and names, derived
 * flags. Needs no QuestieDB clone. Exits non-zero on any finding.
 *
 * Usage: tsx tools/questiedb/validate.ts [--dir <dir> [--slice]] [--skip-tool-tree]
 *   (default: public/data, then tests/fixtures/data as a slice)
 *   --skip-tool-tree  do not compare toolTreeHash with the checkout (local work only, never CI)
 */
import { relative, resolve } from 'node:path';
import { toolIdentity } from './lib/tool-identity';
import { FIXTURE_DATA_DIR, loadUpstream, PUBLIC_DATA_DIR, REPO_ROOT } from './lib/upstream';
import { validateDirectory } from './lib/validate-lib';

function main(argv: readonly string[]): number {
  const known = new Set(['--dir', '--slice', '--skip-tool-tree']);
  const targets: { dir: string; slice: boolean }[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (!known.has(arg)) throw new Error(`unknown argument ${arg}`);
    if (arg === '--dir') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--dir needs a directory');
      targets.push({ dir: resolve(value), slice: argv.includes('--slice') });
      i += 1;
    }
  }
  if (targets.length === 0) targets.push({ dir: PUBLIC_DATA_DIR, slice: false }, { dir: FIXTURE_DATA_DIR, slice: true });
  const pin = loadUpstream();
  const tool = argv.includes('--skip-tool-tree') ? null : toolIdentity().toolTreeHash;
  let failed = false;
  for (const target of targets) {
    const result = validateDirectory({ dir: target.dir, pin, slice: target.slice, toolTreeHash: tool });
    const label = relative(REPO_ROOT, target.dir) || target.dir;
    if (result.findings.length === 0) {
      console.log(`validate: ${label} passed ${JSON.stringify(result.summary)}`);
    } else {
      failed = true;
      console.error(`validate: ${label} FAILED with ${String(result.findings.length)} finding(s):`);
      for (const finding of result.findings) console.error(`  [${finding.check}] ${finding.message}`);
    }
  }
  if (tool === null) console.warn('validate: toolTreeHash was not compared with the checkout (--skip-tool-tree)');
  return failed ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`validate: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
