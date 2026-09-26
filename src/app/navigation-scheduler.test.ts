import { describe, expect, it } from 'vitest';
import { estimate } from '../domain/estimate';
import type { TravelEndpoint, TravelSpeeds } from '../domain/travel';
import type { NavLegsProgress } from '../nav/worker/client';
import { NavWorkerError, type NavLegQuery, type NavLegResult } from '../nav/worker/protocol';
import { navLegRequest, NavigationLegTable, NavigationPathCache } from './navigation-legs';
import { createNavigationTravelModel, type NavigationTravelModel, type SameMapTransport, type TravelPair } from './navigation-model';
import { createNavigationScheduler, type NavigationBatch, type NavigationScheduler, type NavLegService } from './navigation-scheduler';
import { endpoint, ManualTimers, otherComponent, straightLineModel, TEST_NAV_REVISION, testNavManifest, walkable } from './navigation-test-helpers';

/**
 * The navigation scheduler (terrain-navigation.md §9.3, §9.4; RC-07): background drains, results
 * applied in batches at most every 100 ms with one notification per batch, failures, and the
 * "computing paths" phase with progress and cancellation.
 */

const SPEEDS: TravelSpeeds = { groundYps: 7, swimYps: 4.72 };

interface LegsCall {
  readonly queries: readonly NavLegQuery[];
  readonly priority: string | undefined;
  readonly signal: AbortSignal | undefined;
  readonly onProgress: ((p: NavLegsProgress) => void) | undefined;
  resolve(): void;
  reject(error: unknown): void;
}

/** A worker stand-in whose answers the test releases by hand. */
class FakeService implements NavLegService {
  readonly legCalls: LegsCall[] = [];
  readonly pathCalls: { query: NavLegQuery; resolve: (p: readonly number[] | null) => void; reject: (e: unknown) => void }[] = [];

  legs(queries: readonly NavLegQuery[], options: { signal?: AbortSignal; priority?: string; onProgress?: (p: NavLegsProgress) => void } = {}): Promise<readonly NavLegResult[]> {
    return new Promise((resolve, reject) => {
      const call: LegsCall = {
        queries,
        priority: options.priority,
        signal: options.signal,
        onProgress: options.onProgress,
        resolve: () => {
          resolve([]);
        },
        reject,
      };
      options.signal?.addEventListener('abort', () => {
        reject(options.signal?.reason as Error);
      });
      this.legCalls.push(call);
    });
  }

  path(query: NavLegQuery): Promise<readonly number[] | null> {
    return new Promise((resolve, reject) => this.pathCalls.push({ query, resolve, reject }));
  }
}

/** Answers `call` with `result(query)` in `chunks` progress steps, then resolves it. */
function answer(call: LegsCall | undefined, result: (q: NavLegQuery) => NavLegResult, chunks = 1, resolve = true): void {
  if (call === undefined) throw new Error('no call');
  const n = call.queries.length;
  const size = Math.ceil(n / chunks);
  for (let start = 0, done = 0; start < n; start += size) {
    const results = call.queries.slice(start, start + size).map((q, k) => ({ index: start + k, result: result(q) }));
    done += results.length;
    call.onProgress?.({ done, total: n, results });
  }
  if (resolve) call.resolve();
}

/** Lets promise callbacks run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

/** A walkable leg whose length is the straight distance (tenth-yards). */
const straight = (q: NavLegQuery): NavLegResult => walkable(Math.round(Math.sqrt((q.to.x - q.from.x) ** 2 + (q.to.y - q.from.y) ** 2) * 10));

interface Setup {
  readonly service: FakeService;
  readonly timers: ManualTimers;
  readonly model: NavigationTravelModel;
  readonly table: NavigationLegTable;
  readonly scheduler: NavigationScheduler;
  readonly batches: NavigationBatch[];
}

function setup(transports: readonly SameMapTransport[] = []): Setup {
  const service = new FakeService();
  const timers = new ManualTimers();
  const table = new NavigationLegTable(TEST_NAV_REVISION);
  const paths = new NavigationPathCache(16);
  const model = createNavigationTravelModel({ manifest: testNavManifest([0, 1]), fallback: straightLineModel(), table, paths, transports: () => transports });
  const scheduler = createNavigationScheduler({ service, table, paths, timers, retryMs: 5000 });
  const batches: NavigationBatch[] = [];
  scheduler.subscribe((b) => batches.push(b));
  return { service, timers, model, table, scheduler, batches };
}

const points = (n: number, mapId = 1): TravelEndpoint[] => Array.from({ length: n }, (_, i) => endpoint(mapId, i * 100, i * 37));
const consecutive = (ps: readonly TravelEndpoint[]): TravelPair[] => ps.slice(1).map((to, i) => ({ from: ps[i] ?? to, to }));

describe('navigation scheduler: background legs', () => {
  it('drains the legs a walk missed in one request and applies them in one batch, one notification', async () => {
    const { service, timers, model, scheduler, batches } = setup();
    const pairs = consecutive(points(11));
    const walk = (): boolean[] => pairs.map((p) => model.leg(p.from, p.to, SPEEDS).pending);
    expect(walk().every(Boolean)).toBe(true);
    expect(service.legCalls).toHaveLength(0); // nothing is sent during the walk
    timers.advance(0);
    expect(service.legCalls).toHaveLength(1);
    expect(service.legCalls[0]?.queries).toHaveLength(10);
    expect(service.legCalls[0]?.priority).toBe('interactive');
    // results arrive in three steps within 100 ms
    answer(service.legCalls[0], straight, 3, false);
    timers.advance(40);
    expect(batches).toEqual([]);
    expect(scheduler.busy).toBe(true);
    service.legCalls[0]?.resolve();
    await settle();
    timers.advance(60);
    expect(batches).toEqual([{ legs: 10, paths: 0, unavailable: [] }]);
    expect(walk().some(Boolean)).toBe(false);
    expect(model.leg(pairs[0]?.from ?? endpoint(1, 0, 0), pairs[0]?.to ?? endpoint(1, 0, 0), SPEEDS).method).toBe('navigation');
    expect(scheduler.busy).toBe(false);
  });

  it('applies results at most every 100 ms: a slow request gives batches at least 100 ms apart', async () => {
    const { service, timers, model, scheduler } = setup();
    const at: [number, number][] = [];
    scheduler.subscribe((b) => at.push([timers.now, b.legs]));
    const pairs = consecutive(points(7));
    for (const p of pairs) model.leg(p.from, p.to, SPEEDS);
    timers.advance(0);
    const call = service.legCalls[0];
    if (call === undefined) throw new Error('no call');
    // one result every 30 ms, at 0, 30, ..., 150 ms
    call.queries.forEach((q, i) => {
      call.onProgress?.({ done: i + 1, total: 6, results: [{ index: i, result: straight(q) }] });
      timers.advance(30);
    });
    call.resolve();
    await settle();
    timers.advance(200);
    expect(at).toEqual([
      [100, 4],
      [220, 2],
    ]);
  });

  it('asks again for legs recorded while a request is in flight, after it finishes', async () => {
    const { service, timers, model } = setup();
    const ps = points(4);
    model.leg(ps[0] ?? endpoint(1, 0, 0), ps[1] ?? endpoint(1, 0, 0), SPEEDS);
    timers.advance(0);
    model.leg(ps[2] ?? endpoint(1, 0, 0), ps[3] ?? endpoint(1, 0, 0), SPEEDS);
    timers.advance(0);
    expect(service.legCalls).toHaveLength(1);
    answer(service.legCalls[0], straight);
    await settle();
    timers.advance(0);
    expect(service.legCalls).toHaveLength(2);
  });

  it('marks a map whose files failed closed unavailable: its legs take the permanent fallback', async () => {
    const { service, timers, model, table, batches } = setup();
    const [a, b] = points(2);
    if (a === undefined || b === undefined) throw new Error('points');
    expect(model.leg(a, b, SPEEDS).pending).toBe(true);
    timers.advance(0);
    service.legCalls[0]?.reject(new NavWorkerError('integrity', '1/28_36.bin failed its SHA-256 check', '1/28_36.bin', 1));
    await settle();
    timers.advance(100);
    expect(batches).toEqual([{ legs: 0, paths: 0, unavailable: [1] }]);
    expect(table.unavailable(1)?.code).toBe('integrity');
    expect(model.leg(a, b, SPEEDS)).toEqual(straightLineModel().leg(a, b, SPEEDS));
    expect(model.hasNavigation(0)).toBe(true);
  });

  it('turns navigation off everywhere when the worker cannot run', async () => {
    const { service, timers, model, table } = setup();
    const [a, b] = points(2);
    if (a === undefined || b === undefined) throw new Error('points');
    model.leg(a, b, SPEEDS);
    timers.advance(0);
    service.legCalls[0]?.reject(new NavWorkerError('unsupported', 'no WebCrypto'));
    await settle();
    expect(table.unavailable(0)?.code).toBe('unsupported');
    expect(model.hasNavigation(1)).toBe(false);
  });

  it('turns navigation off everywhere when the worker itself fails (its script did not load, or it crashed) (NAV-01)', async () => {
    const { service, timers, model, table, batches } = setup();
    const [a, b] = points(2);
    if (a === undefined || b === undefined) throw new Error('points');
    model.leg(a, b, SPEEDS);
    timers.advance(0);
    service.legCalls[0]?.reject(new NavWorkerError('worker-failed', 'navigation worker: the navigation worker failed to start'));
    await settle();
    timers.advance(100);
    expect(batches).toEqual([{ legs: 0, paths: 0, unavailable: ['all'] }]);
    expect(table.unavailable(1)?.code).toBe('worker-failed');
    expect(model.leg(a, b, SPEEDS)).toEqual(straightLineModel().leg(a, b, SPEEDS));
    // Nothing is asked again, however long it waits.
    timers.advance(600_000);
    expect(service.legCalls).toHaveLength(1);
  });

  it('asks again after an unexpected failure only a few times, then marks the map unavailable (NAV-01)', async () => {
    const { service, timers, model, table } = setup();
    const [a, b] = points(2);
    if (a === undefined || b === undefined) throw new Error('points');
    model.leg(a, b, SPEEDS);
    timers.advance(0);
    for (let i = 0; i < 20; i += 1) {
      service.legCalls.at(-1)?.reject(new NavWorkerError('internal', 'request 1: a leg has no result'));
      await settle();
      timers.advance(5000);
      await settle();
    }
    expect(service.legCalls).toHaveLength(3);
    expect(table.unavailable(1)?.code).toBe('internal');
    expect(model.leg(a, b, SPEEDS).pending).toBe(false);
  });

  it('asks for the legs a walk records during a "computing paths" run at once, as interactive, beside the bulk request (NAV-03)', async () => {
    const { service, timers, model, scheduler } = setup();
    const run = scheduler.computeLegs(model, consecutive(points(6)));
    await settle();
    expect(service.legCalls.map((c) => c.priority)).toEqual(['bulk']);
    // An edit's walk needs a leg the run does not carry, and legs the run carries.
    const edit = { from: endpoint(1, 7000, 7000), to: endpoint(1, 7100, 7000) };
    model.leg(edit.from, edit.to, SPEEDS);
    for (const p of consecutive(points(6))) model.leg(p.from, p.to, SPEEDS);
    timers.advance(0);
    expect(service.legCalls.map((c) => c.priority)).toEqual(['bulk', 'interactive']);
    // Only the new leg: the run's own legs are in flight and not asked twice.
    expect(service.legCalls[1]?.queries).toEqual([navLegRequest(TEST_NAV_REVISION, edit.from, edit.to).query]);
    answer(service.legCalls[1], straight);
    answer(service.legCalls[0], straight);
    expect(await run).toMatchObject({ complete: true });
    expect(model.leg(edit.from, edit.to, SPEEDS).pending).toBe(false);
  });

  it('holds the legs of the background drain until released (the pipeline does, until its run has claimed its legs)', async () => {
    const { service, timers, model, table, scheduler } = setup();
    const hold = scheduler.holdLegs();
    const run = scheduler.computeLegs(model, consecutive(points(3)));
    await settle();
    const extra = { from: endpoint(1, 7000, 7000), to: endpoint(1, 7100, 7000) };
    model.leg(extra.from, extra.to, SPEEDS);
    timers.advance(0);
    // Held: nothing but the run.
    expect(service.legCalls).toHaveLength(1);
    hold();
    timers.advance(0);
    expect(service.legCalls).toHaveLength(2);
    answer(service.legCalls[0], straight);
    answer(service.legCalls[1], straight);
    await run;
    expect(table.missingCount).toBe(0);
  });

  it('retries after a network failure, not before', async () => {
    const { service, timers, model } = setup();
    const [a, b] = points(2);
    if (a === undefined || b === undefined) throw new Error('points');
    model.leg(a, b, SPEEDS);
    timers.advance(0);
    service.legCalls[0]?.reject(new NavWorkerError('network', 'offline', '1/map.bin', 1));
    await settle();
    timers.advance(4000);
    expect(service.legCalls).toHaveLength(1);
    timers.advance(1000);
    expect(service.legCalls).toHaveLength(2);
    expect(service.legCalls[1]?.queries).toEqual([navLegRequest(TEST_NAV_REVISION, a, b).query]);
  });

  it('fetches the paths the map asks for and applies them in the batch', async () => {
    const { service, timers, model, batches } = setup();
    const [a, b] = points(2);
    if (a === undefined || b === undefined) throw new Error('points');
    expect(model.path(a, b)).toBeNull();
    timers.advance(0);
    expect(service.pathCalls).toHaveLength(1);
    service.pathCalls[0]?.resolve([a.point.x, a.point.y, 0, b.point.x, b.point.y, 0]);
    await settle();
    timers.advance(100);
    expect(batches).toEqual([{ legs: 0, paths: 1, unavailable: [] }]);
    expect(model.path(a, b)).toEqual([a.point, b.point]);
  });

  it('does not ask for a path again while it is in flight (NAV-09)', async () => {
    const { service, timers, model } = setup();
    const [a, b] = points(2);
    if (a === undefined || b === undefined) throw new Error('points');
    expect(model.path(a, b)).toBeNull();
    timers.advance(0);
    expect(service.pathCalls).toHaveLength(1);
    // The map asks again (a new paths object) while the first request is still running.
    for (let i = 0; i < 5; i += 1) {
      expect(model.path(a, b)).toBeNull();
      timers.advance(0);
    }
    expect(service.pathCalls).toHaveLength(1);
    service.pathCalls[0]?.resolve([a.point.x, a.point.y, 0, b.point.x, b.point.y, 0]);
    await settle();
    timers.advance(100);
    expect(model.path(a, b)).toEqual([a.point, b.point]);
    expect(service.pathCalls).toHaveLength(1);
  });

  it('asks for a path again after its request failed with a network error', async () => {
    const { service, timers, model } = setup();
    const [a, b] = points(2);
    if (a === undefined || b === undefined) throw new Error('points');
    model.path(a, b);
    timers.advance(0);
    service.pathCalls[0]?.reject(new NavWorkerError('network', 'offline', '1/map.bin', 1));
    await settle();
    timers.advance(5000);
    expect(service.pathCalls).toHaveLength(2);
  });

  it('stops everything on dispose', () => {
    const { service, timers, model, scheduler } = setup();
    const [a, b] = points(2);
    if (a === undefined || b === undefined) throw new Error('points');
    model.leg(a, b, SPEEDS);
    scheduler.dispose();
    timers.advance(1000);
    expect(service.legCalls).toHaveLength(0);
    expect(timers.pending).toBe(0);
  });
});

describe('navigation scheduler: computing paths (RC-07)', () => {
  it('makes a set of legs complete, dock walks of same-map transports included, with progress', async () => {
    const dockA = endpoint(1, 5000, 5000);
    const dockB = endpoint(1, 9000, 5000);
    const island = endpoint(1, 9500, 5500);
    const boat: SameMapTransport = { id: 'boat', from: dockA, to: dockB, seconds: estimate(90, 'assumption') };
    const { service, timers, model, scheduler, batches } = setup([boat]);
    const ps = points(4);
    const pairs = [...consecutive(ps), { from: ps[3] ?? dockA, to: island }];
    const progress: [number, number][] = [];
    const run = scheduler.computeLegs(model, pairs, { onProgress: (p) => progress.push([p.done, p.total]) });
    await settle();
    // round 1: the four direct legs, as a bulk request; the last has no walking path
    expect(service.legCalls[0]?.priority).toBe('bulk');
    answer(service.legCalls[0], (q) => (q.to.x === 9500 ? otherComponent() : straight(q)), 2);
    await settle();
    // round 2: the walks to and from the docks
    expect(service.legCalls[1]?.queries).toHaveLength(2);
    answer(service.legCalls[1], straight);
    expect(await run).toEqual({ requested: 6, complete: true });
    expect(progress).toEqual([
      [0, 4],
      [2, 4],
      [4, 4],
      [4, 6],
      [6, 6],
    ]);
    expect(batches.length).toBeGreaterThanOrEqual(2);
    for (const p of pairs) expect(model.leg(p.from, p.to, SPEEDS).pending).toBe(false);
    expect(model.leg(ps[3] ?? dockA, island, SPEEDS).method).toBe('same-map-transport');
    expect(timers.pending).toBe(0);
  });

  it('keeps what arrived when cancelled; the rest stays pending', async () => {
    const { service, model, scheduler } = setup();
    const pairs = consecutive(points(5));
    const controller = new AbortController();
    const run = scheduler.computeLegs(model, pairs, { signal: controller.signal });
    await settle();
    const call = service.legCalls[0];
    if (call === undefined) throw new Error('no call');
    call.onProgress?.({ done: 2, total: 4, results: call.queries.slice(0, 2).map((q, index) => ({ index, result: straight(q) })) });
    controller.abort(new Error('cancelled by the user'));
    await expect(run).rejects.toThrow('cancelled by the user');
    expect(pairs.map((p) => model.leg(p.from, p.to, SPEEDS).pending)).toEqual([false, false, true, true]);
  });

  it('counts a map that failed closed as complete (its fallback is final)', async () => {
    const { service, model, scheduler } = setup();
    const pairs = consecutive(points(3, 0));
    const run = scheduler.computeLegs(model, pairs);
    await settle();
    service.legCalls[0]?.reject(new NavWorkerError('http', '0/map.bin: HTTP 404', '0/map.bin', 0));
    expect(await run).toEqual({ requested: 2, complete: true });
    expect(model.leg(pairs[0]?.from ?? endpoint(0, 0, 0), pairs[0]?.to ?? endpoint(0, 0, 0), SPEEDS).pending).toBe(false);
  });

  it('retries the legs a network failure left unanswered after retryMs, saying what it waits for (NAV-05)', async () => {
    const { service, timers, model, scheduler } = setup();
    const pairs = consecutive(points(4));
    const progress: [number, number, string | null][] = [];
    const run = scheduler.computeLegs(model, pairs, { onProgress: (p) => progress.push([p.done, p.total, p.retrying]) });
    await settle();
    // One group answered, then the network went.
    const first = service.legCalls[0];
    if (first === undefined) throw new Error('no call');
    const q0 = first.queries[0];
    if (q0 === undefined) throw new Error('no query');
    first.onProgress?.({ done: 1, total: 3, results: [{ index: 0, result: straight(q0) }] });
    first.reject(new NavWorkerError('network', '1/map.bin could not be fetched (Failed to fetch)', '1/map.bin', 1));
    await settle();
    expect(progress.at(-1)).toEqual([1, 3, '1/map.bin could not be fetched (Failed to fetch)']);
    timers.advance(4999);
    await settle();
    expect(service.legCalls).toHaveLength(1);
    timers.advance(1);
    await settle();
    // Only the two legs not answered are asked again, as bulk.
    expect(service.legCalls).toHaveLength(2);
    expect(service.legCalls[1]?.queries).toEqual(first.queries.slice(1));
    expect(service.legCalls[1]?.priority).toBe('bulk');
    expect(progress.at(-1)).toEqual([1, 3, null]);
    answer(service.legCalls[1], straight);
    expect(await run).toEqual({ requested: 3, complete: true });
    expect(pairs.every((p) => !model.leg(p.from, p.to, SPEEDS).pending)).toBe(true);
  });

  it('stops asking after a few failures of an unexpected kind: the map is marked unavailable with the message (NAV-01)', async () => {
    const { service, timers, model, table, scheduler } = setup();
    const pairs = consecutive(points(3));
    const run = scheduler.computeLegs(model, pairs);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await settle();
      expect(service.legCalls).toHaveLength(attempt);
      service.legCalls[attempt - 1]?.reject(new NavWorkerError('internal', 'request 1: a leg has no result'));
      await settle();
      timers.advance(5000);
    }
    expect(await run).toEqual({ requested: 2, complete: true });
    expect(service.legCalls).toHaveLength(3);
    expect(table.unavailable(1)).toEqual({ code: 'internal', message: 'request 1: a leg has no result' });
    expect(table.unavailable(0)).toBeNull();
    // Its legs take the final fallback now, not "pending" for good.
    expect(model.leg(pairs[0]?.from ?? endpoint(1, 0, 0), pairs[0]?.to ?? endpoint(1, 0, 0), SPEEDS).pending).toBe(false);
  });

  it('asks for nothing when the table is already complete', async () => {
    const { service, model, scheduler } = setup();
    expect(await scheduler.computeLegs(model, [{ from: endpoint(530, 0, 0), to: endpoint(530, 10, 0) }])).toEqual({ requested: 0, complete: true });
    expect(service.legCalls).toHaveLength(0);
  });
});
