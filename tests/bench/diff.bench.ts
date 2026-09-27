/**
 * Route diff benchmark (docs/ARCHITECTURE.md §13, §14: a diff of two 10,000-step routes ≤ 50 ms;
 * docs/research/optimizer-m7.md §14). The committed script behind `diff10000` in
 * docs/measurements/optimizer-m7.json.
 *
 *   pnpm exec tsx tests/bench/diff.bench.ts [--runs 21] [--warm 3] [--steps 10000] [--case <name>]
 *   pnpm exec tsx tests/bench/diff.bench.ts --check docs/measurements/optimizer-m7.json [--repeat 3] [--runs 15]
 *
 * The base is tests/bench/bench-support.ts's realistic 10,000-step route (the committed dataset
 * through `loadWorkspace` and the test fake fetch; 620 quests, padded with travel waypoints), with
 * the dataset's quest relations injected as the optimiser's client would (`prerequisites`:
 * `preQuestSingle` and `preQuestGroup`; `exclusive`: `exclusiveTo`).
 *
 * Cases, each timed with `performance.now()` around the action (min / median / p90 in ms):
 * - `reversed` (gated): the route against its reverse: 9,999 moves, change-sets for every quest;
 * - `shuffled` (gated): against a seeded shuffle (seed 42) with 1% edits (33 removes, 33 inserts,
 *   34 modifies): about 9,800 moves;
 * - `identity`: against itself (every pair the same object);
 * - `copy`: against a JSON copy (every pair compared structurally, no op);
 * - `section`: a 315-step section in the middle shuffled (the size of an optimiser proposal);
 * - `reimported`: against a copy with every id changed, matched by `semanticStepKey`;
 * - `applyAll` and `applyHalf`: `applyChangeSets` of the shuffled diff with every set, and with
 *   every other set;
 * - `merged`: a chain of 10,000 two-target completes (quests k + 1 and k + 2, made up) against its
 *   reverse, without relations: 9,999 moves in one change-set of 10,001 quests, the worst case for
 *   collecting a set's quests (multi-target completes, exclusive groups and any-of candidates merge
 *   sets; realistic ones hold tens of quests).
 * `--check` runs the gated cases bundled, one process per case (bench-support.ts), and fails on a
 * probe-normalised median more than 25% over the stored one or over 50 ms.
 */
import { readFileSync } from 'node:fs';
import type { QuestId } from '../../src/domain/ids';
import { questId, stepId } from '../../src/domain/ids';
import type { RouteStep } from '../../src/domain/route';
import { applyChangeSets, type DiffRelations, diffRoutes, type RouteDiff, semanticStepKey } from '../../src/diff';
import { complete, editSteps, seeded, shuffled } from '../../src/diff/test-helpers';
import { bench, benchArgs, benchSetup, type CaseResult, cpuProbe, type GatedCase, round, runChecks, type Stats } from './bench-support';

const args = benchArgs(process.argv.slice(2), 'docs/measurements/optimizer-m7.json');

/** §14: a diff of two 10,000-step routes ≤ 50 ms. */
const BUDGET_MS = 50;
const GATED: readonly GatedCase[] = ['reversed', 'shuffled'].map((name) => ({ route: 'realistic', name, limit: BUDGET_MS }));

async function measure(only: string | null): Promise<Record<string, unknown>> {
  const { view, steps } = await benchSetup('realistic', args.steps);
  const relations: DiffRelations = {
    exclusive: (q: QuestId) => view.quest(q)?.prerequisites.exclusiveTo ?? [],
    prerequisites: (q: QuestId) => {
      const p = view.quest(q)?.prerequisites;
      return p === undefined ? [] : [...p.preQuestSingle, ...p.preQuestGroup.map((id) => questId(Math.abs(id)))];
    },
  };
  const run = (name: string, action: (i: number) => void): Stats | null => (only === null || only === name ? bench(args.runs, args.warm, action) : null);
  const shape = (diff: RouteDiff): Record<string, number> => {
    const out: Record<string, number> = { changeSets: diff.changeSets.length };
    for (const op of diff.ops) out[op.kind] = (out[op.kind] ?? 0) + 1;
    return out;
  };
  const shapes: Record<string, Record<string, number>> = {};
  const timed = (name: string, before: readonly RouteStep[], after: readonly RouteStep[], options: Parameters<typeof diffRoutes>[2]): Stats | null => {
    if (only !== null && only !== name) return null;
    shapes[name] = shape(diffRoutes(before, after, options));
    return run(name, () => {
      diffRoutes(before, after, options);
    });
  };

  const reversed = [...steps].reverse();
  const next = seeded(42);
  const shuffledAfter = editSteps(shuffled(steps, next), next, { removes: 33, inserts: 33, modifies: 34 });
  const middle = Math.floor(steps.length / 2);
  const section = [...steps.slice(0, middle), ...shuffled(steps.slice(middle, middle + 315), seeded(7)), ...steps.slice(middle + 315)];
  const copy = JSON.parse(JSON.stringify(steps)) as RouteStep[];
  const reimported = steps.map((step) => ({ ...step, id: stepId(`new-${step.id}`) }));
  const chain = steps.map((_, k) => complete(`m${String(k)}`, [k + 1, k + 2]));

  const results: Record<string, Stats | null> = {
    reversed: timed('reversed', steps, reversed, { relations }),
    shuffled: timed('shuffled', steps, shuffledAfter, { relations }),
    identity: timed('identity', steps, steps, { relations }),
    copy: timed('copy', steps, copy, { relations }),
    section: timed('section', steps, section, { relations }),
    reimported: timed('reimported', steps, reimported, { relations, semanticKey: semanticStepKey }),
    merged: timed('merged', chain, [...chain].reverse(), {}),
  };
  const shuffledDiff = diffRoutes(steps, shuffledAfter, { relations });
  const every = new Set(shuffledDiff.changeSets.map((set) => set.id));
  const half = new Set(shuffledDiff.changeSets.filter((_, k) => k % 2 === 0).map((set) => set.id));
  results.applyAll = run('applyAll', () => {
    applyChangeSets(steps, shuffledDiff, every);
  });
  results.applyHalf = run('applyHalf', () => {
    applyChangeSets(steps, shuffledDiff, half);
  });
  if (only === null) {
    const applied = applyChangeSets(steps, shuffledDiff, every);
    if (JSON.stringify(applied) !== JSON.stringify(shuffledAfter)) throw new Error('applying every set did not reproduce the shuffled route');
  }
  return { steps: steps.length, shapes, ...results };
}

if (args.check !== null) {
  if (args.steps !== 10_000) throw new Error('--check compares 10,000-step routes (--steps 10000)');
  const stored = JSON.parse(readFileSync(args.check, 'utf8')) as { diff10000?: Record<string, { normalised?: number } | undefined> };
  const { results, failures } = runChecks(import.meta.url, GATED, args, (_route, name) => stored.diff10000?.[name]?.normalised ?? null);
  console.log(JSON.stringify({ node: process.version, repeat: args.repeat, runs: args.runs, results }, null, 2));
  if (failures.length > 0) {
    console.error(`Over the stored baseline by more than 25%, or over the 50 ms budget (probe-normalised):\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.error('Within 25% of the stored baseline and within the 50 ms budget (probe-normalised).');
  }
} else if (args.case !== null) {
  const probeMs = cpuProbe();
  const measured = await measure(args.case);
  const stat = measured[args.case] as Stats | null | undefined;
  if (stat === null || stat === undefined) throw new Error(`unknown case ${args.case}`);
  const result: CaseResult = { route: 'realistic', case: args.case, probeMs, min: stat.min, median: stat.median, p90: stat.p90 };
  console.log(JSON.stringify(result));
} else {
  const probeMs = cpuProbe();
  const measured = await measure(null);
  console.log(JSON.stringify({ runs: args.runs, warm: args.warm, node: process.version, platform: `${process.platform} ${process.arch}`, probeMs, probeAfterMs: round(cpuProbe()), ...measured }, null, 2));
}
