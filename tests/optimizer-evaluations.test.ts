import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SearchOptions, SearchOutcome } from '../src/optimizer';
import { coreFixtures, grid40 } from '../src/optimizer/core/test-fixtures';
import { harnessCompile, runSearch } from '../src/optimizer/core/test-helpers';
import { REPO_ROOT } from './support/fake-fetch';
import { mustCompile, oracleInstance, searchToEnd } from './support/optimizer-fixtures';

/**
 * ARCHITECTURE §14's machine-independent gate "optimiser evaluations on fixed fixtures: recorded
 * baseline, exact" (docs/research/optimizer-m7.md §14.1; review PRF-09). Every §11.7 fixture of the
 * core's harness (src/optimizer/core/test-fixtures.ts), fixture 10b's 40-quest grid and fixture 9's
 * first 12 uniform instances (through the app's compile path) are searched to their end, and the
 * search's exact counts must equal the `fixtures` entry of docs/measurements/optimizer-m7.json:
 * evaluations, layers, duplicates, dominated, rollouts, the evaluations to the first improvement,
 * the termination, the incumbent's and the best estimate, and a hash of every solution's unit
 * sequence and estimate. A change to pruning, ordering, hashing or pricing that alters what the
 * search does fails here even when no fixture's best order changes.
 *
 * A change that is meant to alter the search re-records the entry, and says why in its review:
 *
 *   UPDATE_OPTIMIZER_EVALUATIONS=1 pnpm exec vitest run tests/optimizer-evaluations.test.ts
 *
 * The results are the best route found under these assumptions, never "optimal".
 */

const STORE = join(REPO_ROOT, 'docs/measurements/optimizer-m7.json');

/** Harness H's search (tests/support/optimizer-fixtures.ts SEARCH_DEFAULTS). */
const H: Partial<SearchOptions> = { beamWidth: 16, maxEvaluations: 100_000, divergencePenalty: 0, candidates: 4, rolloutEvery: 8, dominance: true };

interface Exact {
  readonly beamWidth: number;
  readonly termination: string;
  readonly evaluations: number;
  readonly layers: number;
  readonly duplicates: number;
  readonly dominated: number;
  readonly rollouts: number;
  readonly firstImprovementEvaluations: number | null;
  readonly incumbentMs: number;
  readonly bestMs: number | null;
  /** SHA-256 (16 hex digits) of every solution's units, estimate, fill and exit, in order. */
  readonly solutions: string;
}

function exactOf(outcome: SearchOutcome, beamWidth: number): Exact {
  const solutions = outcome.solutions.map((s) => [Array.from(s.units), s.estimatedMs, s.fillMs, s.fillXp, s.exitMs, s.knownGain, s.unknownParts]);
  return {
    beamWidth,
    termination: outcome.termination,
    evaluations: outcome.stats.evaluations,
    layers: outcome.stats.layers,
    duplicates: outcome.stats.duplicates,
    dominated: outcome.stats.dominated,
    rollouts: outcome.stats.rollouts,
    firstImprovementEvaluations: outcome.stats.firstImprovementEvaluations,
    incumbentMs: outcome.incumbent.estimatedMs,
    bestMs: outcome.solutions[0]?.estimatedMs ?? null,
    solutions: createHash('sha256').update(JSON.stringify(solutions)).digest('hex').slice(0, 16),
  };
}

/** Every case, searched to its end: the core's §11.7 fixtures, 10b's grid, and fixture 9's first uniform instances. */
function measure(): Record<string, Exact> {
  const out: Record<string, Exact> = {};
  for (const fixture of coreFixtures()) {
    const { scenario } = fixture;
    const compiled = harnessCompile(scenario.project, scenario.context, scenario.section, fixture.goal);
    if (!compiled.ok) throw new Error(`fixture ${fixture.id} does not compile: ${compiled.reason}`);
    const options = { ...H, ...fixture.options };
    out[`core-${fixture.id}`] = exactOf(runSearch(compiled, options), options.beamWidth ?? 16);
  }
  {
    // Fixture 10b's run (src/optimizer/worker/client.test.ts OPTIONS_10B).
    const s = grid40();
    const compiled = harnessCompile(s.project, s.context, s.section);
    if (!compiled.ok) throw new Error(`grid40 does not compile: ${compiled.reason}`);
    out['10b-grid40'] = exactOf(runSearch(compiled, { beamWidth: 64, maxEvaluations: 50_000 }), 64);
  }
  for (let seed = 0; seed < 12; seed += 1) {
    const instance = oracleInstance(seed);
    const made = mustCompile(instance.fixture, instance.goal);
    out[`9-uniform-${String(seed)}`] = exactOf(searchToEnd(made.compiled, { beamWidth: 256, maxEvaluations: 1_000_000 }), 256);
  }
  return out;
}

interface Stored {
  readonly fixtures?: { readonly cases?: Readonly<Record<string, Exact>> };
}

const readStore = (): Record<string, unknown> & Stored => JSON.parse(readFileSync(STORE, 'utf8')) as Record<string, unknown> & Stored;

describe('optimiser evaluations on fixed fixtures (ARCHITECTURE §14: recorded baseline, exact)', () => {
  const measured = measure();

  if (process.env.UPDATE_OPTIMIZER_EVALUATIONS === '1') {
    const store = readStore();
    (store as Record<string, unknown>).fixtures = {
      $comment: [
        'Optimiser evaluations on fixed fixtures (docs/ARCHITECTURE.md §14: recorded baseline, exact; docs/research/optimizer-m7.md §14.1; review PRF-09). Owned by tests/optimizer-evaluations.test.ts, which fails the build on any difference.',
        "Cases: core-<id> are the §11.7 fixtures of src/optimizer/core/test-fixtures.ts (harness H: beam 16, 100,000 evaluations, unless the fixture sets its own options); 10b-grid40 is fixture 10b's 40-quest grid at beam 64 and 50,000 evaluations; 9-uniform-<seed> are fixture 9's uniform instances (tests/support/optimizer-fixtures.ts oracleInstance) through the app's compile path at beam 256. Each is searched to its end in one slice (the stepper's results do not depend on slicing).",
        'solutions is the first 16 hex digits of the SHA-256 of every solution\'s [units, estimatedMs, fillMs, fillXp, exitMs, knownGain, unknownParts], in order. Machine-independent: the search has no clock and no randomness.',
        'Re-record only for a change meant to alter the search, and say why in its review: UPDATE_OPTIMIZER_EVALUATIONS=1 pnpm exec vitest run tests/optimizer-evaluations.test.ts',
      ],
      cases: measured,
    };
    writeFileSync(STORE, `${JSON.stringify(store, null, 2)}\n`);
  }

  const stored = readStore().fixtures?.cases ?? {};

  it('has a stored baseline for exactly these cases', () => {
    expect(Object.keys(stored).sort()).toEqual(Object.keys(measured).sort());
  });

  it.each(Object.keys(measured))('%s: the exact counts equal the stored baseline', (name) => {
    expect(measured[name]).toEqual(stored[name]);
  });
});
