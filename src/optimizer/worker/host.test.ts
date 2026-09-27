import { describe, expect, it } from 'vitest';
import { type CompiledProblem, createSearch, DEFAULT_SEARCH_OPTIONS, type SearchOptions, type SearchOutcome, type Stepper } from '../core';
import { coreFixtures, grid40 } from '../core/test-fixtures';
import { harnessCompile, runSearch, type Scenario } from '../core/test-helpers';
import { createOptimizerWorkerHost, MAX_SLICE, MIN_SLICE, nextSlice, type OptimizerWorkerHostDeps } from './host';
import type { FromWorker, ToWorker } from './protocol';

/**
 * The optimiser worker's host with injected ports (docs/research/optimizer-m7.md §8): slices sized
 * from the injected clock, yields between them, progress throttled to `progressMs`, `best` on each
 * improvement, cancel between slices acknowledged by `done`, a `start` replacing the running run,
 * `maxMillis`, failures as `error`, and outcomes identical to a direct `advance` loop whatever the
 * slices (fixture 10b).
 */

function compile(scenario: Scenario, goal: Parameters<typeof harnessCompile>[3] = {}): CompiledProblem {
  const compiled = harnessCompile(scenario.project, scenario.context, scenario.section, goal);
  if (!compiled.ok) throw new Error(`compile failed: ${compiled.reason}`);
  return compiled;
}

const signature = (outcome: SearchOutcome): string =>
  JSON.stringify({
    termination: outcome.termination,
    solutions: outcome.solutions.map((s) => [Array.from(s.units), s.estimatedMs, s.fillMs, s.exitMs, s.knownGain, s.unknownParts]),
    incumbent: outcome.incumbent.estimatedMs,
    stats: { ...outcome.stats, arrayBytes: 0 },
  });

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

interface Wired {
  readonly posted: FromWorker[];
  readonly slices: number[];
  host: ReturnType<typeof createOptimizerWorkerHost>;
  /** The fake clock: every advance call takes `msPerSlice`. */
  clock: number;
  start(runId: number, compiled: CompiledProblem, options: Partial<SearchOptions>, maxMillis?: number | null): void;
  send(message: ToWorker): void;
  doneOf(runId: number): Promise<SearchOutcome>;
}

/** A host whose clock advances `msPerSlice` per slice, recording the slice sizes it asked for. */
function wire(deps: Partial<OptimizerWorkerHostDeps> & { readonly msPerSlice?: number; readonly wrap?: (s: Stepper) => Stepper } = {}): Wired {
  const posted: FromWorker[] = [];
  const slices: number[] = [];
  const msPerSlice = deps.msPerSlice ?? 30;
  const wired: Wired = {
    posted,
    slices,
    clock: 0,
    host: null as unknown as ReturnType<typeof createOptimizerWorkerHost>,
    start(runId, compiled, options, maxMillis = null) {
      this.send({ type: 'start', runId, problem: compiled.problem, options: { ...DEFAULT_SEARCH_OPTIONS, ...options }, maxMillis });
    },
    send(message) {
      this.host.handle(message);
    },
    async doneOf(runId) {
      for (let i = 0; i < 1_000_000; i += 1) {
        const done = posted.find((m): m is Extract<FromWorker, { type: 'done' }> => m.type === 'done' && m.runId === runId);
        if (done !== undefined) return done.outcome;
        const error = posted.find((m) => m.type === 'error' && m.runId === runId);
        if (error !== undefined) throw new Error(`run ${String(runId)} failed`);
        await tick();
      }
      throw new Error('no done');
    },
  };
  const { wrap, ...rest } = deps;
  wired.host = createOptimizerWorkerHost({
    post: (message) => posted.push(message),
    now: () => wired.clock,
    yieldToEventLoop: tick,
    ...rest,
    createSearch: (problem, options) => {
      const inner = (deps.createSearch ?? createSearch)(problem, options);
      const timed: Stepper = {
        advance(n) {
          slices.push(n);
          wired.clock += msPerSlice;
          return inner.advance(n);
        },
        finish: (t) => inner.finish(t),
      };
      return wrap === undefined ? timed : wrap(timed);
    },
  });
  return wired;
}

const OPTIONS_10B: Partial<SearchOptions> = { beamWidth: 64, maxEvaluations: 50_000 };

describe('the optimiser worker host', () => {
  it('sizes slices to about sliceMs from the clock, clamped and growing at most fourfold', () => {
    expect(nextSlice(1000, 60, 30)).toBe(500);
    expect(nextSlice(1000, 10, 30)).toBe(3000);
    expect(nextSlice(1000, 1, 30)).toBe(4000);
    expect(nextSlice(1000, 0, 30)).toBe(4000);
    expect(nextSlice(300, 1000, 30)).toBe(MIN_SLICE);
    expect(nextSlice(900_000, 1, 30)).toBe(MAX_SLICE);
  });

  it('runs to the end with the outcome of a direct advance loop, whatever the slices (fixture 10b)', async () => {
    const reference = runSearch(compile(grid40()), OPTIONS_10B);
    expect(reference.termination).toBe('budget');
    for (const [msPerSlice, firstSlice] of [
      [30, 2048],
      [1, 7],
      [200, 1],
      [0, 1_000_000],
    ] as const) {
      const w = wire({ msPerSlice, firstSlice });
      w.start(1, compile(grid40()), OPTIONS_10B);
      expect(signature(await w.doneOf(1))).toBe(signature(reference));
      expect(w.host.activeRunId).toBeNull();
      // Every slice after the first is sized from the clock.
      for (let k = 1; k < w.slices.length; k += 1) expect(w.slices[k]).toBe(nextSlice(w.slices[k - 1] ?? 0, msPerSlice, 30));
    }
  });

  it('posts progress at most every progressMs, best on each new head, and done last', async () => {
    const w = wire({ msPerSlice: 30, firstSlice: 256, progressMs: 100 });
    w.start(7, compile(grid40()), { beamWidth: 64, maxEvaluations: 60_000 });
    const outcome = await w.doneOf(7);
    expect(w.posted.at(-1)?.type).toBe('done');
    expect(w.posted.every((m) => m.runId === 7)).toBe(true);
    const progress = w.posted.filter((m) => m.type === 'progress');
    // 30 ms per slice and 100 ms between progress messages: one progress per four slices at most.
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.length).toBeLessThanOrEqual(Math.ceil(w.slices.length / 4) + 1);
    const solutions = w.posted.flatMap((m) => (m.type === 'best' ? [m.solution] : []));
    const bests = solutions.map((s) => s.comparedMs);
    expect(bests.length).toBeGreaterThan(0);
    // Each best is a new head: a lower figure, or another order at the same figure (the tie rule).
    for (let k = 1; k < bests.length; k += 1) {
      expect(bests[k]).toBeLessThanOrEqual(bests[k - 1] ?? 0);
      expect(Array.from(solutions[k]?.units ?? [])).not.toEqual(Array.from(solutions[k - 1]?.units ?? []));
    }
    // The last best is the outcome's first solution.
    expect(bests.at(-1)).toBe(outcome.solutions[0]?.comparedMs);
    expect(Array.from(solutions.at(-1)?.units ?? [])).toEqual(Array.from(outcome.solutions[0]?.units ?? []));
    expect(bests[0]).toBeLessThan(outcome.incumbent.comparedMs);
  });

  it('sends the last slice\'s improvement as best before done', async () => {
    // One slice runs fixture 2 to exhaustion: its improvement is only in the outcome.
    const fixture = coreFixtures().find((f) => f.id === '2');
    if (fixture === undefined) throw new Error('missing');
    const w = wire({ firstSlice: 1_000_000 });
    w.start(1, compile(fixture.scenario, fixture.goal), { beamWidth: 16, maxEvaluations: 100_000 });
    const outcome = await w.doneOf(1);
    expect(w.slices).toHaveLength(1);
    expect(w.posted.map((m) => m.type)).toEqual(['best', 'done']);
    const best = w.posted[0];
    expect(best?.type === 'best' ? best.solution.estimatedMs : null).toBe(122_142);
    expect(outcome.solutions[0]?.estimatedMs).toBe(122_142);
  });

  it('cancels between slices and acknowledges with done { cancelled } (fixture 10a)', async () => {
    const w = wire({ msPerSlice: 30, firstSlice: 512, progressMs: 0 });
    w.start(3, compile(grid40()), { beamWidth: 256, maxEvaluations: 100_000_000 });
    for (let i = 0; i < 1000 && !w.posted.some((m) => m.type === 'progress'); i += 1) await tick();
    const slicesAtCancel = w.slices.length;
    w.send({ type: 'cancel', runId: 3 });
    const outcome = await w.doneOf(3);
    expect(outcome.termination).toBe('cancelled');
    expect(outcome.stats.evaluations).toBeGreaterThan(0);
    // Acknowledged within two slices of the cancel.
    expect(w.slices.length - slicesAtCancel).toBeLessThanOrEqual(2);
    expect(outcome.solutions.length).toBeGreaterThan(0);
    expect(w.host.activeRunId).toBeNull();
  });

  it('ignores a cancel for another run, and a start replaces the running run (its done comes first)', async () => {
    const w = wire({ msPerSlice: 30, firstSlice: 512 });
    w.start(1, compile(grid40()), { beamWidth: 256, maxEvaluations: 100_000_000 });
    await tick();
    w.send({ type: 'cancel', runId: 99 });
    await tick();
    expect(w.host.activeRunId).toBe(1);
    w.start(2, compile(grid40()), OPTIONS_10B);
    const replaced = w.posted.find((m) => m.type === 'done' && m.runId === 1);
    expect(replaced?.type === 'done' ? replaced.outcome.termination : null).toBe('cancelled');
    expect(w.host.activeRunId).toBe(2);
    const outcome = await w.doneOf(2);
    expect(signature(outcome)).toBe(signature(runSearch(compile(grid40()), OPTIONS_10B)));
    // Nothing more from run 1 after it was replaced.
    const afterReplace = w.posted.slice(w.posted.indexOf(replaced as FromWorker) + 1);
    expect(afterReplace.every((m) => m.runId === 2)).toBe(true);
  });

  it('ends a run at maxMillis between slices (termination timeout)', async () => {
    const w = wire({ msPerSlice: 30, firstSlice: 256 });
    w.start(5, compile(grid40()), { beamWidth: 256, maxEvaluations: 100_000_000 }, 100);
    const outcome = await w.doneOf(5);
    expect(outcome.termination).toBe('timeout');
    expect(w.slices.length).toBe(4);
    const z = wire();
    z.start(6, compile(grid40()), OPTIONS_10B, 0);
    expect((await z.doneOf(6)).termination).toBe('timeout');
    expect(z.slices).toHaveLength(0);
  });

  it('reports a run that throws, or a problem it cannot search, as error', async () => {
    const w = wire({
      wrap: (inner) => ({
        advance: (n) => {
          if (n > 0) throw new Error('slice exploded');
          return inner.advance(n);
        },
        finish: (t) => inner.finish(t),
      }),
    });
    w.start(8, compile(grid40()), OPTIONS_10B);
    await expect(w.doneOf(8)).rejects.toThrow('run 8 failed');
    expect(w.posted).toEqual([{ type: 'error', runId: 8, message: 'slice exploded' }]);
    expect(w.host.activeRunId).toBeNull();

    const v = wire();
    v.send({ type: 'start', runId: 9, problem: compile(grid40()).problem, options: { ...DEFAULT_SEARCH_OPTIONS, beamWidth: 0 }, maxMillis: null });
    expect(v.posted[0]?.type).toBe('error');
    expect(v.posted[0]?.type === 'error' ? v.posted[0].message : '').toMatch(/beamWidth/);
    expect(v.host.activeRunId).toBeNull();
  });

  it('calls sample() after every slice', async () => {
    let samples = 0;
    const w = wire({
      sample: () => {
        samples += 1;
      },
      firstSlice: 256,
    });
    w.start(1, compile(grid40()), OPTIONS_10B);
    await w.doneOf(1);
    expect(samples).toBe(w.slices.length);
  });
});
