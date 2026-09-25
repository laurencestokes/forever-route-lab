/**
 * Extracts the Forever dataset from the pinned QuestieDB commit (docs/DATA_PROVENANCE.md §5 step
 * 2): writes public/data/** and the fixture slice tests/fixtures/data/**, then the gitignored
 * report generated/questiedb-report.json. Reads only committed blobs of the pin from the local
 * clone; run `pnpm data:fetch` first. Output is byte-deterministic.
 *
 * Usage: tsx tools/questiedb/extract.ts [--check] [--slice] [--out <dir>] [--slice-out <dir>] [--no-report]
 *   --check      extract in memory and fail unless every committed file is byte-identical and no
 *                other file is in the directory (CI)
 *   --slice      write only the fixture slice
 *   --out        write public/data to another directory (for pnpm data:diff)
 *   --slice-out  write the fixture slice to another directory
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { commitDate } from './lib/git';
import { compareDirectory, staleFiles } from './lib/output-dir';
import { runExtraction, type RenderedDirectory } from './lib/pipeline';
import { toolIdentity } from './lib/tool-identity';
import { cacheDir, FIXTURE_DATA_DIR, loadUpstream, openPinnedSource, PUBLIC_DATA_DIR, REPO_ROOT, REPORT_PATH } from './lib/upstream';

interface Options {
  readonly check: boolean;
  readonly sliceOnly: boolean;
  readonly out: string;
  readonly sliceOut: string;
  readonly report: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const known = new Set(['--check', '--slice', '--out', '--slice-out', '--no-report']);
  let out = PUBLIC_DATA_DIR;
  let sliceOut = FIXTURE_DATA_DIR;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (!known.has(arg)) throw new Error(`unknown argument ${arg}`);
    if (arg === '--out' || arg === '--slice-out') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a directory`);
      if (arg === '--out') out = resolve(value);
      else sliceOut = resolve(value);
      i += 1;
    }
  }
  return { check: argv.includes('--check'), sliceOnly: argv.includes('--slice'), out, sliceOut, report: !argv.includes('--no-report') };
}

function writeDirectory(dir: string, rendered: RenderedDirectory): void {
  mkdirSync(dir, { recursive: true });
  for (const [path, content] of rendered.files) {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
  const stale = staleFiles(dir, rendered.files);
  if (stale.length > 0) console.warn(`extract: ${relative(REPO_ROOT, dir)} also holds files the extractor did not write: ${stale.join(', ')}`);
}

function main(argv: readonly string[]): number {
  const options = parseArgs(argv);
  const start = performance.now();
  const pin = loadUpstream();
  const source = openPinnedSource(pin, cacheDir(pin), commitDate);
  const readMs = performance.now() - start;
  const extraction = runExtraction(pin, source, toolIdentity());
  const extractMs = performance.now() - start - readMs;
  if (options.check) {
    const problems = [
      ...(options.sliceOnly ? [] : compareDirectory(options.out, extraction.full.files, REPO_ROOT)),
      ...compareDirectory(options.sliceOut, extraction.slice.files, REPO_ROOT),
    ];
    if (problems.length > 0) {
      console.error(`extract --check: the committed dataset is not reproducible:\n  ${problems.join('\n  ')}\nRun pnpm data:extract and commit the result with the tool change.`);
      return 1;
    }
    console.log(`extract --check: public/data and the fixture slice are byte-identical to a fresh extraction (dataRevision ${String(extraction.full.manifest.dataRevision)}).`);
    return 0;
  }
  if (!options.sliceOnly) writeDirectory(options.out, extraction.full);
  writeDirectory(options.sliceOut, extraction.slice);
  const totalMs = performance.now() - start;
  if (options.report) {
    mkdirSync(dirname(REPORT_PATH), { recursive: true });
    const report = { ...extraction.report, cliTimingsMs: { readInputs: Math.round(readMs), extract: Math.round(extractMs), total: Math.round(totalMs) } };
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  const counts = extraction.full.manifest.counts as { readonly shipped: Readonly<Record<string, number>> };
  console.log(
    `extract: ${options.sliceOnly ? 'fixture slice' : `${relative(REPO_ROOT, options.out)} and the fixture slice`} written in ${String(Math.round(totalMs))} ms; ` +
      `dataRevision ${String(extraction.full.manifest.dataRevision)}; shipped ${JSON.stringify(counts.shipped)}`,
  );
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`extract: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
