import { describe, expect, it } from 'vitest';
import { fakeServer, nodeSha256 } from '../../../tests/support/fake-fetch';
import { buildTestMap, gridEndpoint, gridWorld, inProcessNavWorker, referenceLegResult, seeded, signedNavSite, testManifestJson, type InProcessNavWorker } from '../../../tests/support/nav-mesh';
import { SearchScratch } from '../legs';
import { parseNavManifest } from '../manifest';
import { createNavWorkerClient, type NavLegsProgress } from './client';
import { NavWorkerError, type NavLegQuery } from './protocol';

/**
 * The client and the worker host wired together in-process (messages structured-cloned and
 * delivered asynchronously, as between threads): init and the base URL, batched legs with
 * progress, paths, cancellation through an AbortSignal, and the typed failures.
 */

const BASE = 'https://nav.test/app/';
const P = parseNavManifest(testManifestJson(1, [{ row0: 28, col0: 36, polygons: 1 }])).params;
const T = buildTestMap(gridWorld(P).blocks);
const SITE = signedNavSite([T]);
const FULL = T.full();
const FULL_SCRATCH = new SearchScratch(FULL);
const reference = (q: NavLegQuery): ReturnType<typeof referenceLegResult> => referenceLegResult(FULL, FULL_SCRATCH, q);

const wire = (options: { readonly digest?: typeof nodeSha256 | null } = {}): InProcessNavWorker =>
  inProcessNavWorker({
    fetch: fakeServer(SITE.files, BASE).fetch,
    digest: options.digest === undefined ? nodeSha256 : options.digest,
    sliceSettled: 2000,
    yieldToEventLoop: () => new Promise((resolve) => setTimeout(resolve, 0)),
  });

const failure = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a failure');
};

const queries = (seed: number, sources: number, targets: number): NavLegQuery[] => {
  const next = seeded(seed);
  return Array.from({ length: sources }, () => gridEndpoint(P, next)).flatMap((from) => Array.from({ length: targets }, (): NavLegQuery => ({ mapId: 1, from, to: gridEndpoint(P, next) })));
};

describe('navigation worker client', () => {
  it('initialises the worker with the manifest and the nav folder under the base URL', async () => {
    const w = wire();
    const client = createNavWorkerClient({ baseUrl: BASE, manifest: SITE.manifestJson, maxBytes: 50_000_000, port: w.port });
    expect(await client.ready).toBe(SITE.manifest.navRevision);
    expect(w.sent[0]).toEqual({ type: 'init', baseUrl: `${BASE}nav/`, manifest: SITE.manifestJson, maxBytes: 50_000_000 });
    expect(w.host.core?.maxBytes).toBe(50_000_000);
  });

  it('sends a batch as one request, streams progress, and resolves with every result in order', async () => {
    const w = wire();
    const client = createNavWorkerClient({ baseUrl: BASE, manifest: SITE.manifestJson, port: w.port });
    const batch = queries(3, 3, 4);
    const steps: NavLegsProgress[] = [];
    const got = await client.legs(batch, { onProgress: (p) => steps.push(p) });
    expect(got).toEqual(batch.map(reference));
    expect(w.sent.filter((m) => m.type === 'legs')).toHaveLength(1);
    expect(steps.map((s) => [s.done, s.total])).toEqual([
      [4, 12],
      [8, 12],
      [12, 12],
    ]);
    expect(await client.legs([])).toEqual([]);
    const stats = await client.stats();
    expect(stats.blocksLoaded).toBeGreaterThan(0);
    expect(stats.blocksPinned).toBe(0);
  });

  it('returns a leg\'s path', async () => {
    const w = wire();
    const client = createNavWorkerClient({ baseUrl: BASE, manifest: SITE.manifestJson, port: w.port });
    const [q] = queries(9, 1, 1);
    if (q === undefined) throw new Error('no query');
    const expected = referenceLegResult(FULL, FULL_SCRATCH, q, true);
    expect(await client.path(q)).toEqual(expected.reachable ? (expected.path ?? null) : null);
  });

  it('cancels through an AbortSignal: rejects at once with the reason and tells the worker', async () => {
    const w = wire();
    const client = createNavWorkerClient({ baseUrl: BASE, manifest: SITE.manifestJson, port: w.port });
    const controller = new AbortController();
    const batch = queries(4, 6, 3);
    const pending = client.legs(batch, {
      signal: controller.signal,
      onProgress: () => {
        controller.abort(new Error('user cancelled'));
      },
    });
    expect(((await failure(pending)) as Error).message).toBe('user cancelled');
    const cancel = w.sent.find((m) => m.type === 'cancel');
    expect(cancel).toBeDefined();
    // an aborted signal rejects before anything is sent
    const count = w.sent.length;
    await expect(client.legs(batch, { signal: controller.signal })).rejects.toThrow('user cancelled');
    expect(w.sent.length).toBe(count);
    // the worker keeps working
    expect(await client.legs(batch.slice(0, 2))).toEqual(batch.slice(0, 2).map(reference));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await client.stats()).blocksPinned).toBe(0);
  });

  it('reports a manifest the worker refuses as a typed init failure, and fails every request', async () => {
    const w = wire();
    const client = createNavWorkerClient({ baseUrl: BASE, manifest: { schema: 2 }, port: w.port });
    const init = await failure(client.ready);
    expect(init).toBeInstanceOf(NavWorkerError);
    expect((init as NavWorkerError).code).toBe('format');
    const legs = await failure(client.legs(queries(1, 1, 1)));
    expect((legs as NavWorkerError).code).toBe('format');
  });

  it('reports a worker without WebCrypto as unsupported', async () => {
    const w = wire({ digest: null });
    const client = createNavWorkerClient({ baseUrl: BASE, manifest: SITE.manifestJson, port: w.port });
    expect(((await failure(client.ready)) as NavWorkerError).code).toBe('unsupported');
    const legs = await failure(client.legs(queries(1, 1, 1)));
    expect((legs as NavWorkerError).code).toBe('unsupported');
  });

  it('fails pending and later requests with a runtime failure when the worker crashes, and on dispose', async () => {
    const w = wire();
    const client = createNavWorkerClient({ baseUrl: BASE, manifest: SITE.manifestJson, port: w.port });
    const pending = client.legs(queries(2, 2, 2));
    w.crash('script error');
    const error = (await failure(pending)) as NavWorkerError;
    // Not 'internal' (a bug, retried): the worker answers nothing more, so the app falls back for every map.
    expect([error.code, error.message]).toEqual(['worker-failed', 'navigation worker: script error']);
    expect(((await failure(client.path({ mapId: 1, from: { x: 0, y: 0, hint: 0 }, to: { x: 0, y: 0, hint: 0 } }))) as NavWorkerError).code).toBe('worker-failed');
    expect(((await failure(client.ready)) as NavWorkerError).code).toBe('worker-failed');

    const v = wire();
    const other = createNavWorkerClient({ baseUrl: BASE, manifest: SITE.manifestJson, port: v.port });
    const waiting = other.legs(queries(2, 2, 2));
    other.dispose();
    expect(((await failure(waiting)) as NavWorkerError).code).toBe('cancelled');
    expect(v.terminated()).toBe(true);
  });
});
