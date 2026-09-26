/**
 * Route walker benchmark (ARCHITECTURE §9.2, §14: walk + simulate + validate of a 10,000-step
 * route ≤ 20 ms). The committed script behind `route10000` in docs/measurements/engine-m6.json. It
 * measures the walk only (the walker with `src/sim` pricing every step); tests/bench/validate.bench.ts
 * adds the validator.
 *
 *   pnpm exec tsx tests/bench/engine.bench.ts [--route stress|realistic|both] [--runs 21] [--warm 3] [--steps 10000]
 *   pnpm exec tsx tests/bench/engine.bench.ts --check docs/measurements/engine-m6.json [--repeat 3] [--runs 15]
 *
 * Loads the committed dataset through `loadWorkspace` and the test fake fetch (no network or disk).
 * The two routes, `stress` and `realistic`, are tests/bench/bench-support.ts's: the budget applies to
 * the realistic one, and the stress one guards against pathological scaling (Milestone 6 review
 * PERF-01). Straight-line travel model, zone hints 0 (the navigation model's cost sits in the app's
 * leg table and the nav worker, not here).
 *
 * Cases, each timed with `performance.now()` around the action (min / median / p90 in ms):
 * - `fullWalkCold`: a new walker on a fresh copy of the effective rules, so every cache starts
 *   empty (a context change that replaces the rules or the dataset);
 * - `newWalker`: a new walker on the same rules and dataset: the location caches start empty but
 *   the shared simulation caches are warm (a context change that keeps both, such as a new travel
 *   model);
 * - `fullWalkWarm`: the same walker again after `invalidate(0)` (the app's case when navigation legs
 *   arrive);
 * - `editMiddle`: the middle step replaced by an equal copy: a re-walk from the checkpoint before it;
 * - `editEndPublish`: the last step replaced, re-walked and its route metrics taken (`walkMetrics`,
 *   which continues from the stored prefix sums): an edit near the end as the app publishes it;
 * - `stateBefore5000`: the state at step 5,000 from its checkpoint;
 * - `legs` and `metrics`: leg enumeration and the full route metrics (`aggregateRouteMetrics`).
 * `--check` runs `fullWalkCold`, `fullWalkWarm` and `editMiddle` of both routes bundled, one process
 * per case (bench-support.ts), and fails on a probe-normalised median more than 25% over the
 * stored one.
 */
import { stepId } from '../../src/domain/ids';
import { createRouteWalker, enumerateLegs, type RouteWalk, type WalkProject, walkMetrics } from '../../src/engine';
import { aggregateRouteMetrics } from '../../src/sim/estimate';
import { bench, benchArgs, type BenchRoute, benchSetup, type CaseResult, cpuProbe, type GatedCase, round, runChecks, type Stats, storedBaseline } from './bench-support';

const args = benchArgs(process.argv.slice(2), 'docs/measurements/engine-m6.json');

/** The cases `--check` gates, per route. */
const GATED: readonly GatedCase[] = (['stress', 'realistic'] as const).flatMap((route) =>
  ['fullWalkCold', 'fullWalkWarm', 'editMiddle'].map((name) => ({ route, name, limit: null })),
);

async function measure(route: BenchRoute, only: string | null): Promise<Record<string, unknown>> {
  const { context, project, steps, composition } = await benchSetup(route, args.steps);
  const run = (name: string, action: (i: number) => void): Stats | null => (only === null || only === name ? bench(args.runs, args.warm, action) : null);
  let last: RouteWalk | null = null;
  const fullWalkCold = run('fullWalkCold', () => {
    last = createRouteWalker({ ...context, rules: { ...context.rules } }).walk(project);
  });
  const newWalker = run('newWalker', () => {
    last = createRouteWalker(context).walk(project);
  });
  const walker = createRouteWalker(context);
  walker.walk(project);
  const fullWalkWarm = run('fullWalkWarm', () => {
    walker.invalidate(0);
    last = walker.walk(project);
  });
  const withCopy = (index: number): WalkProject => {
    const edited = [...steps];
    const original = steps[index];
    if (original !== undefined) edited[index] = { ...original, id: stepId(`${original.id}-copy`) };
    return { ...project, route: { ...project.route, steps: edited } };
  };
  const middleEdited = withCopy(Math.floor(steps.length / 2));
  const endEdited = withCopy(steps.length - 1);
  let flip = false;
  walker.walk(project);
  const editMiddle = run('editMiddle', () => {
    flip = !flip;
    walker.walk(flip ? middleEdited : project);
  });
  walker.walk(project);
  walkMetrics(walker.walk(project));
  const editEndPublish = run('editEndPublish', () => {
    flip = !flip;
    walkMetrics(walker.walk(flip ? endEdited : project));
  });
  walker.walk(project);
  const stateBefore5000 = run('stateBefore5000', () => {
    walker.stateBefore(Math.min(5000, steps.length));
  });
  const walked = walker.walk(project);
  const legs = run('legs', () => {
    enumerateLegs(walked.records);
  });
  const metrics = run('metrics', () => {
    aggregateRouteMetrics(walked.estimates, { level: project.character.startLevel });
  });
  if (last === null && (only === null || only === 'fullWalkCold' || only === 'newWalker' || only === 'fullWalkWarm')) throw new Error('no walk');
  const reWalkedFrom = (edited: WalkProject): number => {
    walker.walk(project);
    return walker.walk(edited).fromIndex;
  };
  const final = walkMetrics(walked);
  return {
    steps: steps.length,
    composition,
    quests: new Set(steps.map((step) => (step.kind === 'accept' ? step.questId : null)).filter((id) => id !== null)).size,
    legsAsked: enumerateLegs(walked.records).length,
    levelReached: final.levelReached.value,
    unknownTimeSteps: final.stepsWithUnknownTime,
    checkpoints: walker.checkpointIndices().length,
    fullWalkCold,
    newWalker,
    fullWalkWarm,
    editMiddle: editMiddle === null ? null : { ...editMiddle, reWalkedFrom: reWalkedFrom(middleEdited) },
    editEndPublish: editEndPublish === null ? null : { ...editEndPublish, reWalkedFrom: reWalkedFrom(endEdited) },
    stateBefore5000,
    legs,
    metrics,
  };
}

if (args.check !== null) {
  if (args.steps !== 10_000) throw new Error('--check compares a 10,000-step route (--steps 10000)');
  const { results, failures } = runChecks(import.meta.url, GATED, args, storedBaseline(args.check, 'route10000'));
  console.log(JSON.stringify({ node: process.version, repeat: args.repeat, runs: args.runs, results }, null, 2));
  if (failures.length > 0) {
    console.error(`Over the stored baseline by more than 25%, or over a limit (probe-normalised):\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.error('Within 25% of the stored baseline and within the limits (probe-normalised).');
  }
} else if (args.case !== null) {
  const route = args.routes[0] ?? 'stress';
  const probeMs = cpuProbe();
  const measured = await measure(route, args.case);
  const stat = measured[args.case] as Stats | { readonly median: number } | null | undefined;
  if (stat === null || stat === undefined) throw new Error(`unknown case ${args.case}`);
  const result: CaseResult = { route, case: args.case, probeMs, min: (stat as Stats).min, median: stat.median, p90: (stat as Stats).p90 };
  console.log(JSON.stringify(result));
} else {
  const probeMs = cpuProbe();
  const routes: Record<string, unknown> = {};
  for (const route of args.routes) routes[route] = await measure(route, null);
  console.log(JSON.stringify({ runs: args.runs, warm: args.warm, node: process.version, platform: `${process.platform} ${process.arch}`, probeMs, probeAfterMs: round(cpuProbe()), routes }, null, 2));
}
