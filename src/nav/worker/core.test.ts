import { describe, expect, it } from 'vitest';
import { fakeServer, inFlight, nodeSha256, type FakeServer } from '../../../tests/support/fake-fetch';
import { buildTestMap, gridEndpoint, gridWorld, referenceLegResult, seeded, shuffled, signedNavSite, square, testManifestJson, tileOf } from '../../../tests/support/nav-mesh';
import { blockTileOrigin } from '../grid';
import { SearchScratch } from '../legs';
import { parseNavManifest } from '../manifest';
import { hexOf, NavWorkerCore, type NavFetch, type NavWorkerCoreOptions } from './core';
import { joinNavUrl, NavWorkerError, type NavIndexedResult, type NavLegQuery, type NavLegResult } from './protocol';

/**
 * The worker core over synthetic meshes (terrain-navigation.md §9.6; RC-06, RC-07): a signed test
 * site served by a fake fetch, verification and its one retry, failing closed, `map.bin` first,
 * pinning, the LRU, cancellation, progress, priorities, and results equal to a fully loaded mesh
 * under seeded fetch orders and evictions.
 */

const BASE = 'https://nav.test/app/';
const P = parseNavManifest(testManifestJson(1, [{ row0: 28, col0: 36, polygons: 1 }])).params;
const { blocks, polygonsBefore } = gridWorld(P);
// a one-way connector from block 0 to block 3 (never linked by a seam) and a passage in block 1
const FROM = (polygonsBefore[0] ?? 0) + 40;
const TO = (polygonsBefore[3] ?? 0) + 900;
const T = buildTestMap(blocks, {
  links: [{ connector: 0, from: FROM, to: TO, costTenths: 300 }],
  passages: [{ passage: 0, polygons: Array.from({ length: 30 }, (_, i) => (polygonsBefore[1] ?? 0) + 200 + i) }],
});
/** A second, one-block map (id 0) for the tests that need two maps. */
const { tx0: SX, tz0: SZ } = blockTileOrigin(P, 28, 36);
const SMALL = buildTestMap([{ row0: 28, col0: 36, tiles: [tileOf(SX, SZ, [square(0, 0, 128, 128), square(128, 0, 256, 128)])] }], { mapId: 0 });
const SITE = signedNavSite([T, SMALL], { connectors: ['test-connector'], passages: ['test-passage'] });
const FULL = T.full();
const FULL_SCRATCH = new SearchScratch(FULL);

const reference = (q: NavLegQuery): NavLegResult => referenceLegResult(FULL, FULL_SCRATCH, q);

interface Setup {
  readonly core: NavWorkerCore;
  readonly server: FakeServer;
  readonly evicted: { readonly mapId: number; readonly block: number | null }[];
}

type SetupOptions = Partial<Omit<NavWorkerCoreOptions, 'fetch'>> & { readonly wrap?: (fetch: NavFetch) => NavFetch };

function setup(options: SetupOptions = {}): Setup {
  const server = fakeServer(SITE.files, BASE);
  const evicted: { mapId: number; block: number | null }[] = [];
  const { wrap, onEvict, ...rest } = options;
  const core = new NavWorkerCore({
    manifest: SITE.manifest,
    baseUrl: joinNavUrl(BASE, 'nav/'),
    fetch: wrap?.(server.fetch) ?? server.fetch,
    digest: nodeSha256,
    yieldToEventLoop: () => Promise.resolve(),
    ...rest,
    onEvict: (event) => {
      evicted.push({ ...event });
      onEvict?.(event);
    },
  });
  return { core, server, evicted };
}

/** Paths requested, relative to the base, in order. */
const requested = (server: FakeServer): string[] => server.requests.map((r) => r.url.slice(BASE.length));

/** Two points 10 yd apart in the middle of block `b`: a search that never leaves the block. */
function local(b: number): NavLegQuery {
  const e = gridEndpoint(P, () => 0.5, b);
  return { mapId: 1, from: { x: e.x, y: e.y, hint: 0 }, to: { x: e.x + 10, y: e.y, hint: 0 } };
}

/** From deep in block 0 to deep in block 3: the search must load block 1 or 2. */
const DIAGONAL: NavLegQuery = (() => {
  const next = seeded(5);
  for (;;) {
    const q: NavLegQuery = { mapId: 1, from: gridEndpoint(P, next, 0), to: gridEndpoint(P, next, 3) };
    const r = reference(q);
    if (r.reachable && r.groundTenths + r.swimTenths > 4000) return q;
  }
})();

const corrupt = (bytes: Uint8Array | undefined): Uint8Array<ArrayBuffer> => {
  const out = Uint8Array.from(bytes ?? []);
  out[out.length - 1] = ((out[out.length - 1] ?? 0) + 1) % 256;
  return out;
};

async function failure(promise: Promise<unknown>): Promise<NavWorkerError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof NavWorkerError) return error;
    throw error;
  }
  throw new Error('expected the request to fail');
}

describe('NavWorkerCore: results (G12, RC-06)', () => {
  it('serves a world worth testing: four blocks, several components, a connector and a passage', () => {
    expect(FULL.n).toBeGreaterThan(3500);
    expect(FULL.sizes.length).toBeGreaterThan(5);
    expect(SITE.manifest.maps.map((m) => m.mapId)).toEqual([1, 0]);
    expect(reference(DIAGONAL).reachable).toBe(true);
  });

  let evictions = 0;
  let passageLegs = 0;
  for (const seed of [1, 7, 42, 1234, 99991, 314159]) {
    it(`seed ${String(seed)}: every leg and path equals the fully loaded mesh under seeded fetch orders, slices and evictions`, async () => {
      const next = seeded(seed);
      const { core, evicted } = setup({
        // 1 byte evicts every unpinned block after each load; the others keep one to three blocks
        maxBytes: [1, 400_000, 700_000, 5_000_000][Math.floor(next() * 4)] ?? 1,
        sliceSettled: 20 + Math.floor(next() * 400),
        // responses complete in a seeded order, so blocks decode and link in varying orders
        wrap: (fetch) => async (url, init) => {
          const response = await fetch(url, init);
          for (let i = Math.floor(next() * 8); i > 0; i -= 1) await Promise.resolve();
          return response;
        },
      });
      for (let round = 0; round < 5; round += 1) {
        const diagonal = round % 2 === 0;
        const sources = Array.from({ length: 2 }, () => gridEndpoint(P, next, diagonal ? 0 : -1));
        const queries: NavLegQuery[] = [];
        for (const from of sources) for (let k = 0; k < 3; k += 1) queries.push({ mapId: 1, from, to: gridEndpoint(P, next, diagonal ? 3 : -1) });
        const batch = shuffled(queries, next);
        const got = await core.legs(round, batch);
        expect(got).toEqual(batch.map(reference));
        passageLegs += got.filter((r) => r.passages.length > 0).length;
        const q = batch[0];
        if (q !== undefined) {
          const expected = referenceLegResult(FULL, FULL_SCRATCH, q, true);
          expect(await core.path(100 + round, q)).toEqual(expected.reachable ? (expected.path ?? null) : null);
        }
      }
      expect(core.stats().blocksPinned).toBe(0);
      evictions += evicted.length;
    });
  }

  it('the seeded runs evicted blocks and crossed the tagged passage', () => {
    expect(evictions).toBeGreaterThan(10);
    expect(passageLegs).toBeGreaterThan(0);
  });

  it('quantises endpoints itself: fractional points give the results of their 1-yd points', async () => {
    const { core } = setup();
    const q = DIAGONAL;
    const shifted: NavLegQuery = { ...q, from: { ...q.from, x: Math.round(q.from.x) + 0.3 }, to: { ...q.to, y: Math.round(q.to.y) - 0.4 } };
    const rounded: NavLegQuery = { ...q, from: { ...q.from, x: Math.round(q.from.x), y: Math.round(q.from.y) }, to: { ...q.to, x: Math.round(q.to.x), y: Math.round(q.to.y) } };
    const [a, b] = await core.legs(1, [shifted, rounded]);
    expect(a).toEqual(b);
  });

  it('takes the connector into a block no seam reaches, and names the tagged passage', async () => {
    const { core } = setup();
    const at = (p: number): { x: number; y: number; hint: number } => ({ x: Math.round(FULL.cx[p] ?? 0), y: Math.round(FULL.cy[p] ?? 0), hint: 0 });
    const viaConnector: NavLegQuery = { mapId: 1, from: at(FROM), to: at(TO) };
    const [leg] = await core.legs(1, [viaConnector]);
    expect(leg).toEqual(reference(viaConnector));
    expect(leg?.connectorTenthsSeconds).toBe(300);
  });
});

describe('NavWorkerCore: files and verification', () => {
  it('fetches and verifies map.bin before any block of the map', async () => {
    const { core, server } = setup();
    await core.legs(1, [DIAGONAL]);
    const paths = requested(server);
    expect(paths[0]).toBe('nav/1/map.bin');
    expect(paths.slice(1).every((p) => /^nav\/1\/\d+_\d+\.bin$/.test(p))).toBe(true);
    expect(new Set(paths).size).toBe(paths.length); // nothing fetched twice
    const stats = core.stats();
    expect(stats.filesVerified).toBe(paths.length);
    expect(stats.refetches).toBe(0);
  });

  it('refetches a block that fails its SHA-256 once with cache: reload, then uses it', async () => {
    const { core, server } = setup();
    const path = 'nav/1/28_36.bin';
    server.route((p, init, attempt) => (p === path && attempt === 1 && init?.cache === undefined ? new Response(corrupt(SITE.files.get(path))) : undefined));
    expect(await core.legs(1, [DIAGONAL])).toEqual([reference(DIAGONAL)]);
    const tries = server.requests.filter((r) => r.url.endsWith(path));
    expect(tries.map((r) => r.cache)).toEqual([undefined, 'reload']);
    expect(core.stats().refetches).toBe(1);
  });

  it('refetches a block whose size differs from the manifest', async () => {
    const { core, server } = setup();
    const path = 'nav/1/28_36.bin';
    server.route((p, _init, attempt) => (p === path && attempt === 1 ? new Response(Uint8Array.from([1, 2, 3])) : undefined));
    expect(await core.legs(1, [DIAGONAL])).toEqual([reference(DIAGONAL)]);
    expect(core.stats().refetches).toBe(1);
  });

  it('fails closed after the retry: a typed integrity error that stays for the file, without refetching', async () => {
    const { core, server } = setup();
    const path = 'nav/1/28_36.bin';
    server.route((p) => (p === path ? new Response(corrupt(SITE.files.get(path))) : undefined));
    const error = await failure(core.legs(1, [DIAGONAL]));
    expect(error.code).toBe('integrity');
    expect(error.path).toBe('1/28_36.bin');
    expect(error.mapId).toBe(1);
    const count = server.requests.filter((r) => r.url.endsWith(path)).length;
    expect(count).toBe(2);
    expect((await failure(core.legs(2, [DIAGONAL]))).code).toBe('integrity');
    expect(server.requests.filter((r) => r.url.endsWith(path)).length).toBe(count);
    expect(core.stats().blocksPinned).toBe(0);
    // other maps are unaffected
    const small = { mapId: 0, from: { x: SMALL.full().cx[0] ?? 0, y: SMALL.full().cy[0] ?? 0, hint: 0 }, to: { x: SMALL.full().cx[1] ?? 0, y: SMALL.full().cy[1] ?? 0, hint: 0 } };
    expect((await core.legs(3, [small]))[0]?.reachable).toBe(true);
  });

  it('fails closed on a damaged map.bin before fetching any block', async () => {
    const { core, server } = setup();
    server.route((p) => (p === 'nav/1/map.bin' ? new Response(corrupt(SITE.files.get('nav/1/map.bin'))) : undefined));
    const error = await failure(core.legs(1, [DIAGONAL]));
    expect(error.code).toBe('integrity');
    expect(error.path).toBe('1/map.bin');
    expect(requested(server)).toEqual(['nav/1/map.bin', 'nav/1/map.bin']);
  });

  it('reports HTTP errors and network failures with their map; a network failure is retried by the next request', async () => {
    const { core, server } = setup();
    let fail = true;
    server.route((p) => {
      if (p === 'nav/1/map.bin' && fail) {
        fail = false;
        return new TypeError('Failed to fetch');
      }
      return p === 'nav/0/map.bin' ? new Response('Not found', { status: 404 }) : undefined;
    });
    const network = await failure(core.legs(1, [DIAGONAL]));
    expect([network.code, network.mapId]).toEqual(['network', 1]);
    expect(await core.legs(2, [DIAGONAL])).toEqual([reference(DIAGONAL)]);
    const http = await failure(core.legs(3, [{ mapId: 0, from: { x: 0, y: 0, hint: 0 }, to: { x: 1, y: 1, hint: 0 } }]));
    expect([http.code, http.mapId, http.message]).toEqual(['http', 0, '0/map.bin could not be loaded: the server answered HTTP 404']);
  });

  it('refuses a map the manifest does not list', async () => {
    const { core, server } = setup();
    const error = await failure(core.legs(1, [{ mapId: 530, from: { x: 0, y: 0, hint: 0 }, to: { x: 1, y: 1, hint: 0 } }]));
    expect([error.code, error.mapId]).toEqual(['no-map', 530]);
    expect(server.requests).toEqual([]);
  });

  it('fails closed on a verified block that does not decode (a manifest listing bytes of another format)', async () => {
    const bad = new Uint8Array([70, 82, 78, 57, 3, 0]);
    const site = signedNavSite([SMALL]);
    const files = new Map(site.files);
    files.set('nav/0/28_36.bin', bad);
    const json = structuredClone(site.manifestJson) as { maps: { blocks: { bytes: number; sha256: string }[] }[] };
    const block = json.maps[0]?.blocks[0];
    if (block === undefined) throw new Error('no block');
    block.bytes = bad.byteLength;
    block.sha256 = hexOf(await nodeSha256.digest('SHA-256', bad));
    const server = fakeServer(files, BASE);
    const core = new NavWorkerCore({ manifest: parseNavManifest(json), baseUrl: `${BASE}nav/`, fetch: server.fetch, digest: nodeSha256 });
    const error = await failure(core.legs(1, [{ mapId: 0, from: { x: SMALL.full().cx[0] ?? 0, y: SMALL.full().cy[0] ?? 0, hint: 0 }, to: { x: 0, y: 0, hint: 0 } }]));
    expect([error.code, error.path]).toEqual(['format', '0/28_36.bin']);
  });
});

describe('NavWorkerCore: pinning and the LRU (§9.6)', () => {
  it('never evicts a block pinned by a running request, even with a budget of one byte', async () => {
    const pinnedEvictions: string[] = [];
    let core: NavWorkerCore | null = null;
    const s = setup({
      maxBytes: 1,
      sliceSettled: 25,
      onEvict: ({ mapId, block }) => {
        if (block !== null && core?.isPinned(mapId, block) === true) pinnedEvictions.push(`${String(mapId)}:${String(block)}`);
      },
    });
    core = s.core;
    const next = seeded(3);
    const queries = [DIAGONAL, ...Array.from({ length: 8 }, () => ({ mapId: 1, from: gridEndpoint(P, next), to: gridEndpoint(P, next) }))];
    // one request per query: blocks are pinned per request, and evicted between them
    for (const [i, q] of queries.entries()) expect(await s.core.legs(i, [q])).toEqual([reference(q)]);
    expect(s.evicted.length).toBeGreaterThan(0);
    expect(pinnedEvictions).toEqual([]);
    expect(s.core.stats().blocksPinned).toBe(0);
  });

  it('evicts the least recently used unpinned block first, by bytes', async () => {
    // measure the bytes held after one, two and three single-block requests
    const probe = setup();
    const sizes: number[] = [];
    for (const b of [0, 1, 2]) {
      await probe.core.legs(b, [local(b)]);
      sizes.push(probe.core.bytes());
    }
    expect(probe.core.stats().blocksLoaded).toBe(3);
    const [, two = 0, three = 0] = sizes;
    // a budget between two and three blocks
    const { core, evicted } = setup({ maxBytes: Math.floor((two + three) / 2) });
    await core.legs(1, [local(0)]);
    await core.legs(2, [local(1)]);
    expect(evicted).toEqual([]);
    await core.legs(3, [local(2)]); // block 0 is the least recently used
    expect(evicted).toEqual([{ mapId: 1, block: 0 }]);
    await core.legs(4, [local(1)]); // block 1 is used again: now block 2 is the oldest
    await core.legs(5, [local(0)]);
    expect(evicted).toEqual([
      { mapId: 1, block: 0 },
      { mapId: 1, block: 2 },
    ]);
    expect(core.bytes()).toBeLessThanOrEqual(core.maxBytes);
    expect(await core.legs(6, [local(2)])).toEqual([reference(local(2))]);
  });

  it('trims to the budget when a request ends, dropping a whole idle map when its blocks are not enough', async () => {
    const { core, evicted } = setup({ maxBytes: 1 });
    await core.legs(1, [local(0)]);
    expect(evicted).toEqual([
      { mapId: 1, block: 0 },
      { mapId: 1, block: null },
    ]);
    expect(core.stats().maps).toBe(0);
    expect(core.bytes()).toBe(0);
    // map 1 opens again when asked
    expect(await core.legs(2, [DIAGONAL])).toEqual([reference(DIAGONAL)]);
  });
});

describe('NavWorkerCore: progress, cancellation and priorities (RC-07)', () => {
  it('reports progress once per source group with that group\'s results', async () => {
    const { core } = setup();
    const next = seeded(11);
    const sources = Array.from({ length: 3 }, () => gridEndpoint(P, next));
    const queries = sources.flatMap((from) => Array.from({ length: 4 }, (): NavLegQuery => ({ mapId: 1, from, to: gridEndpoint(P, next) })));
    const steps: { done: number; total: number; results: readonly NavIndexedResult[] }[] = [];
    const got = await core.legs(1, shuffled(queries, next), { onProgress: (done, total, results) => steps.push({ done, total, results }) });
    expect(steps.map((s) => [s.done, s.total])).toEqual([
      [4, 12],
      [8, 12],
      [12, 12],
    ]);
    const streamed = new Array<NavLegResult | undefined>(12);
    for (const s of steps) for (const r of s.results) streamed[r.index] = r.result;
    expect(streamed).toEqual(got);
  });

  it('cancels a running search at its next yield, releases its pins, and keeps working', async () => {
    let yields = 0;
    let core: NavWorkerCore | null = null;
    const s = setup({
      sliceSettled: 20,
      yieldToEventLoop: () => {
        yields += 1;
        if (yields === 3) core?.cancel(7);
        return Promise.resolve();
      },
    });
    core = s.core;
    const error = await failure(s.core.legs(7, [DIAGONAL]));
    expect(error.code).toBe('cancelled');
    expect(yields).toBe(3);
    expect(s.core.stats().blocksPinned).toBe(0);
    expect(await s.core.legs(8, [DIAGONAL])).toEqual([reference(DIAGONAL)]);
  });

  it('cancels a queued request before it fetches anything', async () => {
    const { core, server } = setup();
    const first = core.legs(1, [local(0)]);
    const second = core.legs(2, [local(3)]);
    core.cancel(2);
    expect((await failure(second)).code).toBe('cancelled');
    expect(await first).toEqual([reference(local(0))]);
    expect(requested(server)).toEqual(['nav/1/map.bin', 'nav/1/28_36.bin']);
  });

  it('runs an interactive request before the rest of a bulk one, at the next source group', async () => {
    const { core } = setup();
    const next = seeded(21);
    const bulk = Array.from({ length: 4 }, (): NavLegQuery => ({ mapId: 1, from: gridEndpoint(P, next), to: gridEndpoint(P, next) }));
    const order: string[] = [];
    let interactive: Promise<readonly NavLegResult[]> | null = null;
    const done = core.legs(1, bulk, {
      priority: 'bulk',
      onProgress: (d) => {
        order.push(`bulk ${String(d)}`);
        interactive ??= core.legs(2, [local(0)], { onProgress: () => order.push('interactive') });
      },
    });
    expect(await done).toEqual(bulk.map(reference));
    expect(order).toEqual(['bulk 1', 'interactive', 'bulk 2', 'bulk 3', 'bulk 4']);
  });
});

/** A query on the one-block map 0, between its first two polygons. */
function smallQuery(): NavLegQuery {
  const m = SMALL.full();
  return { mapId: 0, from: { x: m.cx[0] ?? 0, y: m.cy[0] ?? 0, hint: 0 }, to: { x: m.cx[1] ?? 0, y: m.cy[1] ?? 0, hint: 0 } };
}

/** Lets pending promise callbacks run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

type Outcome<T> = { readonly value: T } | { readonly error: unknown } | 'pending';

/** `promise`'s outcome within `ms` of real time, or 'pending'. */
async function within<T>(promise: Promise<T>, ms: number): Promise<Outcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'pending'>((resolve) => {
    timer = setTimeout(() => {
      resolve('pending');
    }, ms);
  });
  try {
    return await Promise.race([promise.then((value): Outcome<T> => ({ value }), (error: unknown): Outcome<T> => ({ error })), late]);
  } finally {
    clearTimeout(timer);
  }
}

const codeOf = <T>(outcome: Outcome<T>): string => (outcome === 'pending' ? 'pending' : 'error' in outcome ? (outcome.error instanceof NavWorkerError ? outcome.error.code : 'other') : 'resolved');

describe('NavWorkerCore: pins per search, not per request (NAV-02, §9.6)', () => {
  it('keeps the typed bytes within the budget between the groups of one bulk request spanning both maps', async () => {
    // The bytes held after one, two and three single-block requests on map 1.
    const probe = setup();
    const sizes: number[] = [];
    for (const b of [0, 1, 2]) {
      await probe.core.legs(b, [local(b)]);
      sizes.push(probe.core.bytes());
    }
    const [, two = 0, three = 0] = sizes;
    const maxBytes = Math.floor((two + three) / 2);
    // Sampled as each group starts loading a block: the groups before it have released their pins.
    const seen: number[] = [];
    let core: NavWorkerCore | null = null;
    const s = setup({
      maxBytes,
      wrap: (fetch) => (url, init) => {
        if (core !== null && /[0-9]+_[0-9]+\.bin$/.test(url)) seen.push(core.bytes());
        return fetch(url, init);
      },
    });
    core = s.core;
    const queries = [local(0), local(1), smallQuery(), local(2), local(3)];
    const got = await s.core.legs(1, queries, { priority: 'bulk' });
    expect(got.map((r) => r.reachable)).toEqual([true, true, true, true, true]);
    expect(got.filter((_, i) => i !== 2)).toEqual([local(0), local(1), local(2), local(3)].map(reference));
    expect(seen.length).toBeGreaterThanOrEqual(5);
    expect(Math.max(...seen)).toBeLessThanOrEqual(maxBytes);
    expect(s.core.bytes()).toBeLessThanOrEqual(maxBytes);
    expect(s.core.stats().blocksPinned).toBe(0);
  });
});

describe('NavWorkerCore: a stalled fetch (NAV-04)', () => {
  it('fails a cancelled request at once, releases its pins, aborts the fetch, and goes on with other requests', async () => {
    const { core, server } = setup();
    const stalled = 'nav/1/28_36.bin';
    let stall = true;
    let aborted = false;
    server.route((path, init) => {
      if (path !== stalled || !stall) return undefined;
      init?.signal?.addEventListener('abort', () => {
        aborted = true;
      });
      return inFlight(init);
    });
    const first = core.legs(1, [local(0)], { priority: 'bulk' });
    for (let i = 0; i < 200 && !server.requests.some((r) => r.url.endsWith(stalled)); i += 1) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(server.requests.some((r) => r.url.endsWith(stalled))).toBe(true);
    expect(core.stats().blocksPinned).toBeGreaterThan(0);
    core.cancel(1);
    expect(codeOf(await within(first, 1000))).toBe('cancelled');
    expect(core.stats().blocksPinned).toBe(0);
    await settle();
    expect(aborted).toBe(true);
    // Another map, and an interactive path, are not held behind the stalled file.
    const small = await within(core.legs(2, [smallQuery()]), 2000);
    expect(small !== 'pending' && 'value' in small ? small.value[0]?.reachable : codeOf(small)).toBe(true);
    expect(codeOf(await within(core.path(3, smallQuery()), 2000))).toBe('resolved');
    // The stalled file is asked afresh by a later request.
    stall = false;
    expect(await core.legs(4, [local(0)])).toEqual([reference(local(0))]);
  });

  it('fails a file that does not arrive within the time limit as a network error, which a later request retries', async () => {
    const { core, server } = setup({ fetchTimeoutMs: 40 });
    const stalled = 'nav/1/28_36.bin';
    let stall = true;
    // A fetch that ignores its signal: only the time limit ends it.
    server.route((path) => (path === stalled && stall ? new Promise<Response>(() => undefined) : undefined));
    const error = await failure(core.legs(1, [local(0)]));
    expect([error.code, error.path, error.mapId]).toEqual(['network', '1/28_36.bin', 1]);
    expect(error.message).toBe('1/28_36.bin did not arrive within 0.04 s');
    expect(core.stats().blocksPinned).toBe(0);
    stall = false;
    expect(await core.legs(2, [local(0)])).toEqual([reference(local(0))]);
  });
});

describe('NavWorkerCore: HTTP answers that may pass (NAV-10)', () => {
  for (const status of [503, 500, 429, 408]) {
    it(`reports HTTP ${String(status)} as a network failure (asked again later), not as the map failing`, async () => {
      const { core, server } = setup();
      let fail = true;
      server.route((path) => (path === 'nav/0/map.bin' && fail ? new Response('busy', { status }) : undefined));
      const error = await failure(core.legs(1, [smallQuery()]));
      expect([error.code, error.mapId]).toEqual(['network', 0]);
      expect(error.message).toBe(`0/map.bin could not be loaded: the server answered HTTP ${String(status)}, which may pass`);
      fail = false;
      expect((await core.legs(2, [smallQuery()]))[0]?.reachable).toBe(true);
    });
  }

  it('keeps definite answers (404, 403, 410) permanent for the map', async () => {
    for (const status of [404, 403, 410]) {
      const { core, server } = setup();
      server.route((path) => (path === 'nav/0/map.bin' ? new Response('no', { status }) : undefined));
      expect((await failure(core.legs(1, [smallQuery()]))).code).toBe('http');
    }
  });
});

describe('NavWorkerCore: yielding across small searches', () => {
  it('yields to the event loop every slice of settled polygons, counted across searches, so messages can arrive', async () => {
    let yields = 0;
    const { core } = setup({
      sliceSettled: 8,
      yieldToEventLoop: () => {
        yields += 1;
        return Promise.resolve();
      },
    });
    await core.legs(1, [local(0)]); // blocks loaded: the searches below need no fetch
    const next = seeded(8);
    const queries = Array.from({ length: 60 }, (): NavLegQuery => {
      const e = gridEndpoint(P, next, 0);
      return { mapId: 1, from: { x: e.x, y: e.y, hint: 0 }, to: { x: e.x + 3, y: e.y, hint: 0 } };
    });
    yields = 0;
    const got = await core.legs(2, queries, { priority: 'bulk' });
    expect(got).toEqual(queries.map(reference));
    // Each search settles fewer polygons than a slice; together they settle many slices.
    expect(yields).toBeGreaterThanOrEqual(2);
  });
});

describe('NavWorkerCore: a failing group fails only its own legs (NAV-01)', () => {
  it('runs and reports the other groups of the request, then fails with the first error', async () => {
    const { core, server } = setup();
    server.route((path) => (path === 'nav/0/map.bin' ? new Response('Not found', { status: 404 }) : undefined));
    const progress: NavIndexedResult[] = [];
    // Map 0 comes first: its failure must not drop the map-1 groups after it.
    const queries = [smallQuery(), local(1), local(2)];
    const error = await failure(core.legs(1, queries, { onProgress: (_d, _t, results) => progress.push(...results) }));
    expect([error.code, error.mapId]).toEqual(['http', 0]);
    expect(progress.map((r) => r.index).sort()).toEqual([1, 2]);
    expect(progress.map((r) => r.result)).toEqual([reference(local(1)), reference(local(2))]);
    expect(server.requests.filter((r) => r.url.endsWith('nav/0/map.bin'))).toHaveLength(1);
    expect(core.stats().blocksPinned).toBe(0);
  });
});
