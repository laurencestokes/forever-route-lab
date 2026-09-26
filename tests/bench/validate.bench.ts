/**
 * Walk + simulate + validate benchmark (ARCHITECTURE §9.4, §14: a 10,000-step route in 20 ms or
 * less). The committed script behind `validate10000` in docs/measurements/engine-m6.json; the
 * walk alone is tests/bench/engine.bench.ts (`route10000` there), on the same routes.
 *
 *   pnpm exec tsx tests/bench/validate.bench.ts [--route stress|realistic|both] [--runs 21] [--warm 3] [--steps 10000]
 *   pnpm exec tsx tests/bench/validate.bench.ts --check docs/measurements/engine-m6.json [--repeat 3] [--runs 15]
 *
 * The routes are tests/bench/bench-support.ts's. `realistic` is a route written for its character
 * and repaired with the validator (a few hundred issues): the §14 budget applies to it. `stress`
 * ignores prerequisites and repeats its quest list, so the validator reports about one issue per
 * step (its time grows with the issues): a regression guard with a ceiling of twice the budget
 * (Milestone 6 review PERF-01). Straight-line travel model, zone hints 0.
 *
 * Cases (min / median / p90 in ms, `performance.now()` around the action):
 * - `walkValidateCold`: `validateRoute` on a fresh copy of the effective rules: a new walker and
 *   validator with every cache empty, and the issue list built;
 * - `walkValidateNew`: `validateRoute` on the same context: a new walker and validator whose shared
 *   simulation and availability caches are warm (a context change that keeps rules and dataset);
 * - `walkValidateWarm`: the same walker and validator after `invalidate(0)`, issue list built;
 * - `walkWarm`: the same, on a walker without the validator (the default accept policy): the
 *   validator's share is `walkValidateWarm - walkWarm`;
 * - `editMiddle`: the middle step replaced by an equal copy: a re-walk and re-validation from the
 *   checkpoint before it;
 * - `noChangeWalk`: a walk with nothing changed (the route-level issues and the flat list rebuilt).
 * `--check` runs `walkValidateCold`, `walkValidateWarm` and `editMiddle` of both routes bundled, one
 * process per case (bench-support.ts), and fails on a probe-normalised median more than 25% over
 * the stored one, or over the budget (realistic, 20 ms warm and edit) or the ceiling (stress, 40 ms).
 */
import { stepId } from '../../src/domain/ids';
import type { RouteStep } from '../../src/domain/route';
import { createRouteWalker, type WalkProject } from '../../src/engine';
import { createRouteValidator, validateRoute } from '../../src/validate';
import { bench, benchArgs, type BenchRoute, benchSetup, type CaseResult, cpuProbe, type GatedCase, round, runChecks, type Stats, storedBaseline } from './bench-support';

const args = benchArgs(process.argv.slice(2), 'docs/measurements/engine-m6.json');

/** §14: walk + simulate + validate of a 10,000-step route (the realistic one). */
const BUDGET_MS = 20;
/** The stress route's ceiling: twice the budget, against pathological scaling (PERF-01). */
const STRESS_CEILING_MS = 40;

const GATED: readonly GatedCase[] = [
  { route: 'stress', name: 'walkValidateCold', limit: null },
  { route: 'stress', name: 'walkValidateWarm', limit: STRESS_CEILING_MS },
  { route: 'stress', name: 'editMiddle', limit: STRESS_CEILING_MS },
  { route: 'realistic', name: 'walkValidateCold', limit: null },
  { route: 'realistic', name: 'walkValidateWarm', limit: BUDGET_MS },
  { route: 'realistic', name: 'editMiddle', limit: BUDGET_MS },
];

async function measure(route: BenchRoute, only: string | null): Promise<Record<string, unknown>> {
  const { view, context, project, steps, composition } = await benchSetup(route, args.steps);
  const run = (name: string, action: (i: number) => void): Stats | null => (only === null || only === name ? bench(args.runs, args.warm, action) : null);
  const rules = context.rules;
  let issueCount = 0;
  const walkValidateCold = run('walkValidateCold', () => {
    issueCount = validateRoute(project, { ...context, rules: { ...rules } }).issues.length;
  });
  const walkValidateNew = run('walkValidateNew', () => {
    issueCount = validateRoute(project, context).issues.length;
  });

  const validator = createRouteValidator({ dataset: view, rules });
  const walker = createRouteWalker({ ...context, acceptPolicy: validator.acceptPolicy });
  walker.walk(project, [validator.visitor]);
  const walkValidateWarm = run('walkValidateWarm', () => {
    walker.invalidate(0);
    walker.walk(project, [validator.visitor]);
    validator.issues();
  });

  const plain = createRouteWalker(context);
  plain.walk(project);
  const walkWarm = run('walkWarm', () => {
    plain.invalidate(0);
    plain.walk(project);
  });

  const middle = Math.floor(steps.length / 2);
  const edited: RouteStep[] = [...steps];
  const original = steps[middle];
  if (original !== undefined) edited[middle] = { ...original, id: stepId(`${original.id}-copy`) };
  const middleEdited: WalkProject = { ...project, route: { ...project.route, steps: edited } };
  let flip = false;
  let reWalkedFrom = -1;
  walker.walk(project, [validator.visitor]);
  const editMiddle = run('editMiddle', () => {
    flip = !flip;
    reWalkedFrom = walker.walk(flip ? middleEdited : project, [validator.visitor]).fromIndex;
    validator.issues();
  });

  walker.invalidate(0);
  walker.walk(project, [validator.visitor]);
  const noChangeWalk = run('noChangeWalk', () => {
    walker.walk(project, [validator.visitor]);
    validator.issues();
  });

  const all = validator.issues();
  const bySeverity = { error: 0, warning: 0, info: 0 };
  const byCode = new Map<string, number>();
  for (const issue of all) {
    bySeverity[issue.severity] += 1;
    byCode.set(issue.code, (byCode.get(issue.code) ?? 0) + 1);
  }
  return {
    steps: steps.length,
    composition,
    issues: all.length,
    lastIssueCount: issueCount,
    bySeverity,
    commonestCodes: Object.fromEntries([...byCode].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 8)),
    walkValidateCold,
    walkValidateNew,
    walkValidateWarm,
    walkWarm,
    validatorShareWarm: walkValidateWarm === null || walkWarm === null ? null : round(walkValidateWarm.median - walkWarm.median),
    editMiddle: editMiddle === null ? null : { ...editMiddle, reWalkedFrom },
    noChangeWalk,
  };
}

if (args.check !== null) {
  if (args.steps !== 10_000) throw new Error('--check compares a 10,000-step route (--steps 10000)');
  const { results, failures } = runChecks(import.meta.url, GATED, args, storedBaseline(args.check, 'validate10000'));
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
  const stat = measured[args.case] as Stats | null | undefined;
  if (stat === null || stat === undefined) throw new Error(`unknown case ${args.case}`);
  const result: CaseResult = { route, case: args.case, probeMs, min: stat.min, median: stat.median, p90: stat.p90 };
  console.log(JSON.stringify(result));
} else {
  const probeMs = cpuProbe();
  const routes: Record<string, unknown> = {};
  for (const route of args.routes) routes[route] = await measure(route, null);
  console.log(JSON.stringify({ runs: args.runs, warm: args.warm, node: process.version, platform: `${process.platform} ${process.arch}`, probeMs, probeAfterMs: round(cpuProbe()), routes }, null, 2));
}
