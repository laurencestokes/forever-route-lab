/**
 * Interleaved A/B of the derived-pipeline benchmark (tests/bench/derived.bench.ts) across source
 * trees: the cloud gate for `derived` when no stored baseline can be trusted on the machine (D-050
 * item 5; rework-followup F-01, F-02).
 *
 *   pnpm exec tsx tests/bench/ab-derived.ts [--rounds 5] [--runs 11] [--warm 2] [--steps 10000]
 *     [--out <dir>] <label>=<tree> <label>=<tree> ...
 *
 * Each tree is a checkout with its own `pnpm install --frozen-lockfile` (a `git worktree add
 * --detach`; never a linked node_modules). Each round runs every tree's own copy of the bench, in a
 * fresh process with that tree as its working directory, and the order rotates from round to round,
 * so a load spike or a warming machine falls on every tree alike. The script reads each run's JSON
 * (`derived<steps>`: every case's `median`, nested ones such as `navigationArrives.taskMs` too) and
 * prints, per case and tree, the median of the runs' medians, their min-max spread, and the ratio of
 * that median to the first label's (or, for a case the first label's tree lacks, to the next label
 * that has it, named in the row; `ab-ratio.ts`, review C-12). A case a tree's bench does not have is
 * reported as absent, never filled in. `--out` keeps every run's raw JSON (`<label>-r<round>.json`) and the summary
 * (`summary.json`).
 *
 * The gate (D-052 item 2): ratio ≤ 1.25 against the pre-rework tree for each case
 * that `--check` checks, over at least 5 rounds. Timings are noisy on a shared machine: read the
 * spread beside the ratio. Its edits are note edits with nothing selected that keep the end state,
 * and a class change (a cold walk); the quick-walk path with a step selected and an edit that
 * changes the end state are in the reported cases `editSelected` and `editEndLocation` (review
 * C-06), which are not part of it.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { againstNote, ratioRow, type RatioRow } from './ab-ratio';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const ROUNDS = Number(option('--rounds', '5'));
const RUNS = option('--runs', '11');
const WARM = option('--warm', '2');
const STEPS = option('--steps', '10000');
const OUT = args.includes('--out') ? resolve(option('--out', '.')) : null;
/** The cases `derived.bench.ts --check` checks (marked in the table). */
const CHECKED = new Set(['firstWalk', 'editStart', 'editMiddle', 'classChange', 'navEditStart', 'taxiArrives.sinceChangeMs']);

const valued = new Set(['--rounds', '--runs', '--warm', '--steps', '--out']);
const trees = args
  .filter((arg, i) => !arg.startsWith('--') && !valued.has(args[i - 1] ?? ''))
  .map((arg) => {
    const at = arg.indexOf('=');
    if (at <= 0) throw new Error(`expected <label>=<tree>, got "${arg}"`);
    return { label: arg.slice(0, at), dir: resolve(arg.slice(at + 1)) };
  });
if (trees.length < 2) throw new Error('give at least two <label>=<tree> pairs; the first is the reference');
if (OUT !== null) mkdirSync(OUT, { recursive: true });

/** Every case's median, flattened (`editStart`, `navigationArrives.taskMs`, ...). */
function mediansOf(json: unknown): Map<string, number> {
  const found = new Map<string, number>();
  const route = (json as Record<string, unknown>)[`derived${STEPS}`];
  const visit = (prefix: string, value: unknown): void => {
    if (typeof value !== 'object' || value === null) return;
    const median = (value as { median?: unknown }).median;
    if (typeof median === 'number') {
      found.set(prefix, median);
      return;
    }
    for (const [key, inner] of Object.entries(value)) visit(prefix === '' ? key : `${prefix}.${key}`, inner);
  };
  visit('', route);
  const probe = (json as { probeMs?: { mean?: unknown } }).probeMs?.mean;
  if (typeof probe === 'number') found.set('(probe)', probe);
  return found;
}

/** One run of a tree's own bench, in a fresh process. */
function runOnce(tree: { label: string; dir: string }, round: number): Map<string, number> {
  const cli = join(tree.dir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const run = spawnSync(process.execPath, [cli, 'tests/bench/derived.bench.ts', '--runs', RUNS, '--warm', WARM, '--steps', STEPS], {
    cwd: tree.dir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(`${tree.label} round ${String(round)} failed (${String(run.status)}):\n${run.stderr}`);
  const text = run.stdout.slice(run.stdout.indexOf('{'));
  if (OUT !== null) writeFileSync(join(OUT, `${tree.label}-r${String(round)}.json`), text);
  return mediansOf(JSON.parse(text));
}

const samples = new Map<string, Map<string, number[]>>(trees.map((tree) => [tree.label, new Map()]));
for (let round = 1; round <= ROUNDS; round += 1) {
  // Rotate the order: round 1 starts with the first tree, round 2 with the second, and so on.
  const order = trees.map((_, i) => trees[(i + round - 1) % trees.length] ?? trees[0]!);
  for (const tree of order) {
    const started = Date.now();
    const medians = runOnce(tree, round);
    const byCase = samples.get(tree.label)!;
    for (const [name, value] of medians) byCase.set(name, [...(byCase.get(name) ?? []), value]);
    console.error(`round ${String(round)}/${String(ROUNDS)} ${tree.label}: editStart ${String(medians.get('editStart') ?? 'absent')} ms (${String(Math.round((Date.now() - started) / 1000))} s)`);
  }
}

const fixed = (value: number): string => value.toFixed(2);

const cases = [...new Set(trees.flatMap((tree) => [...samples.get(tree.label)!.keys()]))];
const summary: Record<string, { against: string | null; cells: RatioRow['cells'] }> = {};
const reference = trees[0]!.label;
const labels = trees.map((tree) => tree.label);
const lines = [
  `Interleaved A/B, ${String(ROUNDS)} rounds, --runs ${RUNS} --warm ${WARM} --steps ${STEPS}; median of the runs' medians [min-max] ×ratio to ${reference}, or to the next tree that has the case where ${reference} does not ("vs <label>"). * = checked by --check.`,
];
for (const name of cases) {
  const row = ratioRow(labels, (label) => samples.get(label)?.get(name));
  summary[name] = row;
  const cells = labels.map((label) => {
    const cell = row.cells[label];
    if (cell === undefined || cell === 'absent') return `${label} absent`;
    return `${label} ${fixed(cell.median)} [${fixed(cell.min)}-${fixed(cell.max)}]${cell.ratio === null ? '' : ` ×${cell.ratio.toFixed(3)}`}`;
  });
  lines.push(`${CHECKED.has(name) ? '*' : ' '} ${name}: ${cells.join(' | ')}${againstNote(row, reference)}`);
}
console.log(lines.join('\n'));
if (OUT !== null) writeFileSync(join(OUT, 'summary.json'), `${JSON.stringify({ rounds: ROUNDS, runs: Number(RUNS), warm: Number(WARM), steps: Number(STEPS), trees, summary }, null, 2)}\n`);
