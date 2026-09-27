import { describe, expect, it } from 'vitest';
import { grid40 } from '../core/test-fixtures';
import { harnessCompile, runSearch } from '../core/test-helpers';
import { type CompiledProblem, DEFAULT_SEARCH_OPTIONS, type SearchOutcome, type SearchProgress, type SearchSolution } from '../core';
import { createOptimizerWorkerClient, isStoppedRun, type WorkerRunOptions, type WorkerRunResult } from './client';
import { type FromWorker, OptimizerWorkerError, type OptimizerWorkerPort } from './protocol';
import { inProcessOptimizerWorker, type InProcessOptimizerWorker, ManualOptimizerTimers, until } from './test-helpers';

/**
 * The client and the worker host wired in-process (messages structured-cloned, the problem's
 * buffers transferred, delivery a task later, as between threads): a run to its end, cancel
 * acknowledged, stale runs ignored, an unacknowledged cancel terminating the worker (fixture 10a),
 * worker failures, and dispose.
 */

function compileGrid(): CompiledProblem {
  const s = grid40();
  const compiled = harnessCompile(s.project, s.context, s.section);
  if (!compiled.ok) throw new Error(`compile failed: ${compiled.reason}`);
  return compiled;
}

const OPTIONS_10B: WorkerRunOptions = { ...DEFAULT_SEARCH_OPTIONS, beamWidth: 64, maxEvaluations: 50_000, maxMillis: null };
const LONG: WorkerRunOptions = { ...DEFAULT_SEARCH_OPTIONS, beamWidth: 256, maxEvaluations: 100_000_000, maxMillis: null };

const signature = (outcome: SearchOutcome): string =>
  JSON.stringify({
    termination: outcome.termination,
    solutions: outcome.solutions.map((s) => [Array.from(s.units), s.estimatedMs, s.fillMs, s.exitMs, s.knownGain, s.unknownParts]),
    stats: { ...outcome.stats, arrayBytes: 0 },
  });

const outcomeOf = (result: WorkerRunResult): SearchOutcome => {
  if (isStoppedRun(result)) throw new Error(`the run was stopped (${result.stopped})`);
  return result;
};

/** A client over in-process workers; `workers` lists every worker it started. */
function setup(options: { readonly ignoreCancel?: boolean; readonly cancelGraceMs?: number } = {}) {
  const workers: InProcessOptimizerWorker[] = [];
  const timers = new ManualOptimizerTimers();
  const client = createOptimizerWorkerClient({
    createPort: () => {
      const w = inProcessOptimizerWorker({ sliceMs: 5, firstSlice: 256, progressMs: 0, ...(options.ignoreCancel === true ? { ignoreCancel: true } : {}) });
      workers.push(w);
      return w.port;
    },
    timers,
    ...(options.cancelGraceMs === undefined ? {} : { cancelGraceMs: options.cancelGraceMs }),
  });
  return { client, workers, timers };
}

describe('the optimiser worker client', () => {
  it('runs a problem in the worker to its end: the outcome of a direct loop, with progress and best (fixture 10b)', async () => {
    const { client, workers } = setup();
    const compiled = compileGrid();
    const progress: SearchProgress[] = [];
    const bests: SearchSolution[] = [];
    const run = client.run(compiled, OPTIONS_10B, { onProgress: (p) => progress.push(p), onBest: (s) => bests.push(s) });
    // The problem's buffers were transferred: the main thread's copy is detached.
    expect(compiled.problem.matrix.byteLength).toBe(0);
    const outcome = outcomeOf(await run.result);
    expect(outcome.termination).toBe('budget');
    expect(signature(outcome)).toBe(signature(runSearch(compileGrid(), OPTIONS_10B)));
    expect(progress.length).toBeGreaterThan(0);
    expect(bests.at(-1)?.estimatedMs).toBe(outcome.solutions[0]?.estimatedMs);
    expect(Array.from(bests.at(-1)?.units ?? [])).toEqual(Array.from(outcome.solutions[0]?.units ?? []));
    expect(workers).toHaveLength(1);
    expect(workers[0]?.sent).toEqual([{ type: 'start', runId: run.runId }]);
    // A second run reuses the worker, under a new run id.
    const again = client.run(compileGrid(), OPTIONS_10B);
    expect(again.runId).toBe(run.runId + 1);
    expect(signature(outcomeOf(await again.result))).toBe(signature(outcome));
    expect(client.workersStarted).toBe(1);
  });

  it('cancels a run: the worker acknowledges with done { cancelled }, and the grace timer is cleared (fixture 10a)', async () => {
    const { client, workers, timers } = setup();
    let progressSeen = 0;
    const run = client.run(compileGrid(), LONG, { onProgress: () => (progressSeen += 1) });
    await until(() => progressSeen > 0);
    run.cancel();
    run.cancel();
    expect(timers.pending).toEqual([1000]);
    const outcome = outcomeOf(await run.result);
    expect(outcome.termination).toBe('cancelled');
    expect(outcome.stats.evaluations).toBeGreaterThan(0);
    expect(timers.pending).toEqual([]);
    expect(workers[0]?.sent.map((m) => m.type)).toEqual(['start', 'cancel']);
    expect(workers[0]?.terminated()).toBe(false);
  });

  it('ignores messages of stale runs; a new run stops the previous one first', async () => {
    const { client, workers } = setup();
    let firstProgress = 0;
    const first = client.run(compileGrid(), LONG, { onProgress: () => (firstProgress += 1) });
    await until(() => firstProgress > 0);
    const seen = firstProgress;
    const second = client.run(compileGrid(), OPTIONS_10B);
    const stopped = await first.result;
    expect(isStoppedRun(stopped) ? stopped.stopped : null).toBe('superseded');
    expect(stopped.stats.evaluations).toBeGreaterThan(0);
    const outcome = outcomeOf(await second.result);
    expect(signature(outcome)).toBe(signature(runSearch(compileGrid(), OPTIONS_10B)));
    // The worker answered run 1 with done { cancelled }; the client dropped it and everything else of run 1.
    const worker = workers[0];
    expect(worker?.received.some((m) => m.type === 'done' && m.runId === first.runId && m.outcome.termination === 'cancelled')).toBe(true);
    expect(firstProgress).toBe(seen);
    expect(client.workersStarted).toBe(1);
  });

  it('drops a message of an old run id sent by the worker', async () => {
    let deliver: ((m: FromWorker) => void) | null = null;
    const posted: string[] = [];
    const port: OptimizerWorkerPort = {
      postMessage: (message) => posted.push(message.type),
      listen: (onMessage) => {
        deliver = onMessage;
      },
      terminate: () => undefined,
    };
    const client = createOptimizerWorkerClient({ createPort: () => port });
    const compiled = compileGrid();
    const reference = runSearch(compileGrid(), OPTIONS_10B);
    const run = client.run(compiled, OPTIONS_10B);
    const send = (m: FromWorker): void => {
      if (deliver === null) throw new Error('not listening');
      deliver(m);
    };
    let settled: WorkerRunResult | null = null;
    void run.result.then((r) => (settled = r));
    send({ type: 'done', runId: run.runId - 1, outcome: { ...reference, termination: 'exhausted' } });
    send({ type: 'error', runId: run.runId + 5, message: 'not mine' });
    await Promise.resolve();
    expect(settled).toBeNull();
    send({ type: 'done', runId: run.runId, outcome: reference });
    expect(signature(outcomeOf(await run.result))).toBe(signature(reference));
    expect(posted).toEqual(['start']);
  });

  it('terminates a worker that does not acknowledge a cancel within the grace period, and starts a new one for the next run (fixture 10a)', async () => {
    const { client, workers, timers } = setup({ ignoreCancel: true, cancelGraceMs: 1000 });
    let progress: SearchProgress | null = null;
    const run = client.run(compileGrid(), LONG, { onProgress: (p) => (progress = p) });
    await until(() => progress !== null);
    run.cancel();
    expect(timers.pending).toEqual([1000]);
    await until(() => (progress?.evaluations ?? 0) > 1000);
    timers.fireAll();
    const stopped = await run.result;
    expect(isStoppedRun(stopped) ? stopped.stopped : null).toBe('terminated');
    expect(stopped.termination).toBe('cancelled');
    expect(stopped.stats.evaluations).toBe((progress as SearchProgress | null)?.evaluations);
    expect(workers[0]?.terminated()).toBe(true);
    const next = client.run(compileGrid(), OPTIONS_10B);
    expect(signature(outcomeOf(await next.result))).toBe(signature(runSearch(compileGrid(), OPTIONS_10B)));
    expect(client.workersStarted).toBe(2);
    expect(workers[1]?.terminated()).toBe(false);
  });

  it('rejects a run when the worker crashes, and starts a new worker next time', async () => {
    const { client, workers } = setup();
    const run = client.run(compileGrid(), LONG);
    await until(() => (workers[0]?.received.length ?? 0) > 0);
    workers[0]?.crash('script error');
    await expect(run.result).rejects.toThrow(OptimizerWorkerError);
    await expect(run.result).rejects.toThrow('optimiser worker: script error');
    expect(workers[0]?.terminated()).toBe(true);
    const next = client.run(compileGrid(), OPTIONS_10B);
    expect(outcomeOf(await next.result).termination).toBe('budget');
    expect(client.workersStarted).toBe(2);
  });

  it('rejects a run the worker reports as failed, and keeps that worker', async () => {
    const { client } = setup();
    const run = client.run(compileGrid(), { ...OPTIONS_10B, beamWidth: 0 });
    await expect(run.result).rejects.toThrow(/the optimiser failed: .*beamWidth/);
    const next = client.run(compileGrid(), OPTIONS_10B);
    expect(outcomeOf(await next.result).termination).toBe('budget');
    expect(client.workersStarted).toBe(1);
  });

  it('dispose stops the run in progress, terminates the worker, and refuses later runs', async () => {
    const { client, workers } = setup();
    let progressSeen = 0;
    const run = client.run(compileGrid(), LONG, { onProgress: () => (progressSeen += 1) });
    await until(() => progressSeen > 0);
    client.dispose();
    const stopped = await run.result;
    expect(isStoppedRun(stopped) ? stopped.stopped : null).toBe('disposed');
    expect(workers[0]?.terminated()).toBe(true);
    await expect(client.run(compileGrid(), OPTIONS_10B).result).rejects.toThrow('disposed');
  });

  it('a new run while a cancel waits for its acknowledgement terminates the stuck worker and starts on a fresh one (review RTD-02)', async () => {
    // Worker 1 takes messages and never answers (stuck in a slice); worker 2 is a real in-process worker.
    const sent: string[] = [];
    let stuckTerminated = false;
    const stuck: OptimizerWorkerPort = {
      postMessage: (message) => sent.push(`${message.type} ${String(message.runId)}`),
      listen: () => undefined,
      terminate: () => {
        stuckTerminated = true;
      },
    };
    const fresh = inProcessOptimizerWorker({ sliceMs: 5, firstSlice: 256, progressMs: 0 });
    const ports = [stuck, fresh.port];
    const timers = new ManualOptimizerTimers();
    const client = createOptimizerWorkerClient({ createPort: () => ports.shift() ?? fresh.port, timers });
    const first = client.run(compileGrid(), LONG);
    first.cancel();
    expect(timers.pending).toEqual([1000]);
    const second = client.run(compileGrid(), OPTIONS_10B);
    const stopped = await first.result;
    expect(isStoppedRun(stopped) ? stopped.stopped : null).toBe('superseded');
    // The stuck worker is gone, and the new run went to a new worker, not behind the stuck slice.
    expect(stuckTerminated).toBe(true);
    expect(sent).toEqual([`start ${String(first.runId)}`, `cancel ${String(first.runId)}`]);
    expect(client.workersStarted).toBe(2);
    expect(fresh.sent).toEqual([{ type: 'start', runId: second.runId }]);
    expect(signature(outcomeOf(await second.result))).toBe(signature(runSearch(compileGrid(), OPTIONS_10B)));
    expect(timers.pending).toEqual([]);
  });

  it('cancels the replaced run in the worker when the new start cannot be posted (review RTD-02)', async () => {
    const sent: string[] = [];
    let refuseStart = false;
    const port: OptimizerWorkerPort = {
      postMessage: (message) => {
        sent.push(`${message.type} ${String(message.runId)}`);
        if (refuseStart && message.type === 'start') throw new Error('DataCloneError');
      },
      listen: () => undefined,
      terminate: () => undefined,
    };
    const client = createOptimizerWorkerClient({ createPort: () => port });
    const first = client.run(compileGrid(), LONG);
    refuseStart = true;
    const second = client.run(compileGrid(), OPTIONS_10B);
    await expect(second.result).rejects.toThrow('could not start: DataCloneError');
    expect(isStoppedRun(await first.result)).toBe(true);
    // Nothing else stops run 1 in the worker: the client cancels it there.
    expect(sent).toEqual([`start ${String(first.runId)}`, `start ${String(second.runId)}`, `cancel ${String(first.runId)}`]);
    expect(client.workersStarted).toBe(1);
  });

  it('rejects a start that cannot be posted', async () => {
    const port: OptimizerWorkerPort = {
      postMessage: () => {
        throw new Error('DataCloneError');
      },
      listen: () => undefined,
      terminate: () => undefined,
    };
    const client = createOptimizerWorkerClient({ createPort: () => port });
    await expect(client.run(compileGrid(), OPTIONS_10B).result).rejects.toThrow('could not start: DataCloneError');
  });
});
