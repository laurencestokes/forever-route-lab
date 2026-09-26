import { describe, expect, it, vi } from 'vitest';
import { type Bytes, fakeServer, nodeSha256, readDirectory } from '../../tests/support/fake-fetch';
import { NavWorkerError } from '../nav/worker/protocol';
import { type NavigationState, startNavigation } from './navigation-runtime';
import { ManualTimers } from './navigation-test-helpers';

/**
 * Starting navigation (terrain-navigation.md §9.6): the committed manifest starts the worker and
 * the shared leg table; anything else is "unavailable" with a reason in words, never a rejection.
 */

const SITE = new Map<string, Bytes>([['nav/manifest.json', readDirectory('public/nav', 'nav/').get('nav/manifest.json') ?? new Uint8Array()]]);

const service = () => ({
  disposed: false,
  legs: () => Promise.resolve([]),
  path: () => Promise.resolve(null),
  dispose() {
    this.disposed = true;
  },
});

describe('startNavigation', () => {
  it('starts the worker for the committed manifest, with the table keyed by its navRevision', async () => {
    const started: { json: unknown; baseUrl: string }[] = [];
    const fake = service();
    const state = await startNavigation({
      fetch: fakeServer(SITE).fetch,
      baseUrl: './',
      sha256: nodeSha256,
      createService: (input) => {
        started.push(input);
        return fake;
      },
    });
    if (state.kind !== 'available') throw new Error(`not available: ${state.kind === 'unavailable' ? state.reason : state.kind}`);
    const { runtime } = state;
    expect(runtime.manifest.maps.map((m) => m.mapId)).toEqual([0, 1]);
    expect(runtime.table.revision).toBe(runtime.manifest.navRevision);
    expect(started).toHaveLength(1);
    expect(started[0]?.baseUrl).toBe('./');
    expect(started[0]?.json).toMatchObject({ navRevision: runtime.manifest.navRevision });
    runtime.dispose();
    expect(fake.disposed).toBe(true);
  });

  it('is unavailable, with the reason in words, for a deploy without navigation data', async () => {
    const state = await startNavigation({ fetch: fakeServer(new Map()).fetch, baseUrl: './', sha256: nodeSha256, createService: () => service() });
    expect(state).toEqual({ kind: 'unavailable', reason: 'this deploy has no navigation data' });
  });

  it('is unavailable without WebCrypto or without module workers', async () => {
    expect(await startNavigation({ fetch: fakeServer(SITE).fetch, baseUrl: './', sha256: null })).toEqual({
      kind: 'unavailable',
      reason: 'this browser cannot verify the navigation data (no WebCrypto: open the site over https)',
    });
    expect(await startNavigation({ fetch: fakeServer(SITE).fetch, baseUrl: './', sha256: nodeSha256, createService: () => null })).toEqual({
      kind: 'unavailable',
      reason: 'this browser cannot run the navigation worker',
    });
    const throwing = await startNavigation({
      fetch: fakeServer(SITE).fetch,
      baseUrl: './',
      sha256: nodeSha256,
      createService: () => {
        throw new Error('blocked by the page policy');
      },
    });
    expect(throwing).toEqual({ kind: 'unavailable', reason: 'the navigation worker could not start (blocked by the page policy)' });
  });

  it('waits for the worker to start, and is unavailable when it fails to, stopping it (NAV-01)', async () => {
    const fake = service();
    const state = await startNavigation({
      fetch: fakeServer(SITE).fetch,
      baseUrl: './',
      sha256: nodeSha256,
      // Rejected when the worker is created, as the client's `ready` is when its script fails to load.
      createService: () => Object.assign(fake, { ready: Promise.reject(new NavWorkerError('worker-failed', 'navigation worker: the navigation worker failed to start')) }),
    });
    expect(state).toEqual({ kind: 'unavailable', reason: 'the navigation worker could not start (navigation worker: the navigation worker failed to start)' });
    expect(fake.disposed).toBe(true);
  });

  it('is unavailable when the worker does not answer within the time limit (NAV-01)', async () => {
    const timers = new ManualTimers();
    const fake = { ...service(), ready: new Promise<string>(() => undefined) };
    let settled: NavigationState | null = null;
    void startNavigation({ fetch: fakeServer(SITE).fetch, baseUrl: './', sha256: nodeSha256, createService: () => fake, timers, startTimeoutMs: 20_000 }).then((s) => {
      settled = s;
    });
    for (let i = 0; i < 50 && timers.pending === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 1));
    timers.advance(19_999);
    await Promise.resolve();
    expect(settled).toBeNull();
    timers.advance(1);
    await vi.waitFor(() => {
      expect(settled).toEqual({ kind: 'unavailable', reason: 'the navigation worker did not start within 20 s' });
    });
    expect(fake.disposed).toBe(true);
  });

  it('is available once the worker has read the same manifest', async () => {
    const json = JSON.parse(new TextDecoder().decode(SITE.get('nav/manifest.json'))) as { navRevision: string };
    const fake = { ...service(), ready: Promise.resolve(json.navRevision) };
    const state = await startNavigation({ fetch: fakeServer(SITE).fetch, baseUrl: './', sha256: nodeSha256, createService: () => fake });
    expect(state.kind).toBe('available');
    const other = { ...service(), ready: Promise.resolve('0'.repeat(64)) };
    expect(await startNavigation({ fetch: fakeServer(SITE).fetch, baseUrl: './', sha256: nodeSha256, createService: () => other })).toEqual({
      kind: 'unavailable',
      reason: 'the navigation worker read different navigation data than the page',
    });
  });
});
