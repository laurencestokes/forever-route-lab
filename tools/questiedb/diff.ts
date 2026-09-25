/**
 * Pin-to-pin dataset diff (docs/DATA_PROVENANCE.md §9.4, §12): compares two extractions (or two
 * manifests) and prints added, removed and changed records by id and field, upstreamDiff and
 * corrected changes, count deltas and spawn/zone/overlay changes. The three-way Forever classifier
 * is a stub that returns `unknown` (D-026).
 *
 * Usage: tsx tools/questiedb/diff.ts --from <source> [--to <source>] [--json <file>]
 *   <source> is a data directory, a manifest.json path, or git:<rev> (public/data at that
 *   revision of this repository). --to defaults to public/data.
 *
 * Pin bump: `pnpm data:diff --from git:HEAD` after re-extracting compares the committed dataset
 * with the new one; put the summary in the commit message.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { diffDatasets, summarise } from './lib/diff-lib';
import { readerFor, snapshot } from './lib/diff-source';
import { PUBLIC_DATA_DIR, REPO_ROOT } from './lib/upstream';

function main(argv: readonly string[]): number {
  const value = (flag: string): string | null => {
    const index = argv.indexOf(flag);
    if (index < 0) return null;
    const next = argv[index + 1];
    if (next === undefined) throw new Error(`${flag} needs a value`);
    return next;
  };
  for (const arg of argv) if (arg.startsWith('--') && !['--from', '--to', '--json'].includes(arg)) throw new Error(`unknown argument ${arg}`);
  const from = value('--from');
  if (from === null) throw new Error('usage: diff.ts --from <dir|manifest.json|git:rev> [--to <...>] [--json <file>]');
  const diff = diffDatasets(snapshot(readerFor(from, REPO_ROOT)), snapshot(readerFor(value('--to') ?? PUBLIC_DATA_DIR, REPO_ROOT)));
  console.log(summarise(diff));
  const jsonPath = value('--json');
  if (jsonPath !== null) writeFileSync(resolve(jsonPath), `${JSON.stringify(diff, null, 2)}\n`, 'utf8');
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`diff: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
