/**
 * A guard on `UNCLASSIFIED_FIELDS` (src/app/quest-state.ts; review C-10): the quest classification
 * is kept for a state that differs from the one it was built from only in these fields, which is
 * safe only while nothing that classifies reads them. Here the derived pipeline runs on the sample
 * project and the committed dataset with every state it hands the accept checks wrapped in a Proxy
 * that records a read of any of these fields, and every state it hands `questStateModel` wrapped in
 * one that records a read of any of them but `location` (the Available tab's groups follow the
 * place, and `reclassified` rebuilds them for the new one). Reads are recorded, not thrown, so a
 * failure names every field and where it was read, and the pipeline is never disturbed.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';
import { fixedClock } from '../src/app/clock';
import { createDerivedStore } from '../src/app/derived';
import { createDerivedPipeline } from '../src/app/derived-pipeline';
import type { NavTimers } from '../src/app/navigation-scheduler';
import type * as QuestStateModule from '../src/app/quest-state';
import { createEditorStore } from '../src/app/store';
import { loadWorkspace } from '../src/app/workspace';
import { sequentialIdSource } from '../src/domain/ids';
import type * as AvailabilityModule from '../src/validate/availability';
import { fakeServer, nodeSha256, publicSite } from './support/fake-fetch';

const guard = vi.hoisted(() => {
  const reads = new Map<string, number>();
  const fields = new Set<string>();
  const wrap = <T extends object>(state: T, where: string, allowed: ReadonlySet<string>): T =>
    new Proxy(state, {
      get(target, key, receiver) {
        if (typeof key === 'string' && fields.has(key) && !allowed.has(key)) reads.set(`${where}: ${key}`, (reads.get(`${where}: ${key}`) ?? 0) + 1);
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
  return { reads, fields, wrap, checks: 0, models: 0 };
});

vi.mock('../src/validate/availability', async (importOriginal) => {
  const actual = await importOriginal<typeof AvailabilityModule>();
  return {
    ...actual,
    createAcceptChecks: (options: Parameters<typeof actual.createAcceptChecks>[0]) => {
      const checks = actual.createAcceptChecks(options);
      return {
        ...checks,
        check: (...args: Parameters<typeof checks.check>) => {
          guard.checks += 1;
          const [id, state, subject, lint] = args;
          return checks.check(id, guard.wrap(state, 'accept checks', new Set()), subject, lint);
        },
      };
    },
  };
});

vi.mock('../src/app/quest-state', async (importOriginal) => {
  const actual = await importOriginal<typeof QuestStateModule>();
  for (const field of actual.UNCLASSIFIED_FIELDS) guard.fields.add(field);
  return {
    ...actual,
    questStateModel: (input: Parameters<typeof actual.questStateModel>[0]) => {
      guard.models += 1;
      return actual.questStateModel({ ...input, state: guard.wrap(input.state, 'questStateModel', new Set(['location'])) });
    },
  };
});

/** Timers that never fire by themselves: the test runs the scheduled work with `flush`. */
const manualTimers: NavTimers = { set: () => 0, clear: () => undefined };

describe('the fields the quest classification never reads (review C-10)', () => {
  it('are never read by the accept checks, nor by the quest state but for the groups’ place, over the sample route', { timeout: 120_000 }, async () => {
    const server = fakeServer(publicSite());
    const NOW = '2026-10-01T00:00:00.000Z';
    const workspace = await loadWorkspace({ fetch: server.fetch, baseUrl: './', sha256: nodeSha256, nowIso: NOW, now: () => performance.now(), yieldToRender: () => Promise.resolve() });
    const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(1_000_000), clock: fixedClock(NOW), coalesceWindowMs: 0 });
    const derived = createDerivedStore();
    const pipeline = createDerivedPipeline({
      store,
      data: workspace.data,
      geometry: workspace.geometry.geometry,
      output: derived,
      navigation: { kind: 'unavailable', reason: 'test: straight-line model' },
      timers: manualTimers,
      now: () => performance.now(),
      clientTables: null,
    });
    pipeline.flush();
    // Every step selected in turn: fresh classifications and kept ones (a step that only travels).
    const steps = store.getState().project.route.steps;
    for (const step of steps) {
      store.select({ kind: 'single', id: step.id });
      pipeline.flush();
    }
    store.select({ kind: 'none' });
    pipeline.flush();
    pipeline.dispose();
    expect(derived.store.getState().failure ?? null).toBeNull();
    expect(guard.fields.size).toBe(11);
    expect(guard.checks).toBeGreaterThan(1000);
    expect(guard.models).toBeGreaterThan(steps.length / 2);
    expect(Object.fromEntries(guard.reads)).toEqual({});
  });
});
