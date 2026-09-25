import { describe, expect, it } from 'vitest';
import { type Bytes, droppedBody, fakeServer, fixtureSite, jsonOf, nodeSha256, text, withSignedFile } from '../../../tests/support/fake-fetch';
import { DatasetLoadError, type DatasetLoadProgress, loadDataset, type LoadedDataset } from './loader';

const SITE = fixtureSite();

/** The fixture is the slice, which only tests may load (`allowSlice`, M2 review code-F7). */
const load = (server = fakeServer(SITE), extra: Partial<Parameters<typeof loadDataset>[0]> = {}): Promise<LoadedDataset> =>
  loadDataset({ fetch: server.fetch, baseUrl: './', sha256: nodeSha256, allowSlice: true, ...extra });

/** The load's rejection, which must be a DatasetLoadError. */
async function failure(promise: Promise<unknown>): Promise<DatasetLoadError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DatasetLoadError) return error;
    throw error;
  }
  throw new Error('the load did not fail');
}

/** The file's bytes with one byte changed, same length (so only the hash can tell). */
function flipped(path: string): Bytes {
  const bytes = SITE.get(path)?.slice();
  if (bytes === undefined) throw new Error(`no ${path}`);
  const i = bytes.length - 3;
  bytes[i] = bytes[i] === 0x31 ? 0x32 : 0x31;
  return bytes;
}

interface ManifestJson {
  dataRevision: string;
  slice?: unknown;
  outputs: { path: string; sha256: string; bytes: number }[];
}
const fixtureManifest = (): ManifestJson => structuredClone(jsonOf(SITE, 'data/manifest.json')) as ManifestJson;
const output = (path: string) => {
  const entry = fixtureManifest().outputs.find((o) => o.path === path);
  if (entry === undefined) throw new Error(`the manifest lists no ${path}`);
  return entry;
};

describe('loadDataset over the fixture slice', () => {
  it('fetches the manifest, then every listed file, and returns checked files without _generated', async () => {
    const server = fakeServer(SITE);
    const loaded = await load(server);
    expect(loaded.identity).toEqual({
      dataRevision: '695c41df5635b456ca1b9698814e7a07fd40db2c83dd721181e1a46b8cec6cad',
      frameBuild: '1.60.1.69893',
      upstreamCommit: 'b6f5b07b0acf1c820993cbb0ce2521c912bb4c92',
      foreverContentVerified: false,
    });
    const { files } = loaded;
    expect([files.quests.length, files.npcs.length, files.objects.length, files.items.length]).toEqual([96, 149, 13, 56]);
    expect(Object.keys(files.spawns.npc)).toHaveLength(149);
    expect(files.zones.uiMaps['1411']?.name).toBe('Durotar');
    expect('_generated' in files.zones).toBe(false);
    expect(loaded.notice).toBe(text(SITE.get('data/NOTICE.md')));
    // The manifest first, revalidated; then the seven outputs, relative to the base.
    expect(server.requests[0]).toEqual({ url: './data/manifest.json', cache: 'no-cache' });
    expect(server.requests.slice(1).map((r) => r.url).sort()).toEqual(
      ['NOTICE.md', 'entities.json', 'items.json', 'overlays.json', 'quests.json', 'spawns.json', 'zones.json'].map((f) => `./data/${f}`),
    );
    expect(Object.keys(loaded.timings.files)).toEqual(['NOTICE.md', 'entities.json', 'items.json', 'overlays.json', 'quests.json', 'spawns.json', 'zones.json']);
  });

  it('builds URLs from the base it is given', async () => {
    const server = fakeServer(SITE, '/app/');
    await load(server, { baseUrl: '/app' });
    expect(server.requests.every((r) => r.url.startsWith('/app/data/'))).toBe(true);
  });

  it('is deterministic: two loads give equal files in the same order', async () => {
    const [a, b] = await Promise.all([load(), load()]);
    expect(JSON.stringify(b.files)).toBe(JSON.stringify(a.files));
    expect(a.files.quests.map((q) => q.id)).toEqual([...a.files.quests.map((q) => q.id)].sort((x, y) => x - y));
  });

  it('reports progress from the manifest to the last file', async () => {
    const seen: DatasetLoadProgress[] = [];
    await load(fakeServer(SITE), { onProgress: (p) => seen.push(p) });
    expect(seen[0]).toEqual({ phase: 'manifest', filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 });
    const done = seen.at(-1);
    expect(done?.phase).toBe('done');
    expect(done?.filesDone).toBe(7);
    expect(done?.bytesDone).toBe(done?.bytesTotal);
    const counts = seen.filter((p) => p.phase === 'files').map((p) => p.filesDone);
    expect(counts).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('loadDataset and the fixture slice (M2 review code-F7)', () => {
  it('refuses a slice manifest unless asked to load one, before fetching any other file', async () => {
    const server = fakeServer(SITE);
    const error = await failure(load(server, { allowSlice: false }));
    expect([error.code, error.file]).toEqual(['slice', 'manifest.json']);
    expect(error.message).toMatch(/^data\/manifest\.json describes the test fixture slice \(Durotar \(UiMap 1411\)[^)]*\), not the Forever dataset: the site was deployed with test data/);
    expect(server.requests.map((r) => r.url)).toEqual(['./data/manifest.json']);
    await expect(loadDataset({ fetch: fakeServer(SITE).fetch, baseUrl: './', sha256: nodeSha256 })).rejects.toThrow(/test fixture slice/);
  });

  it('loads the same files once the manifest says it is not a slice', async () => {
    // `slice` is not part of the dataRevision, so the edited manifest stays consistent.
    const manifest = fixtureManifest();
    delete manifest.slice;
    const server = fakeServer(SITE);
    server.set('data/manifest.json', JSON.stringify(manifest));
    const loaded = await load(server, { allowSlice: false });
    expect(loaded.manifest.slice).toBeNull();
  });
});

describe('loadDataset integrity', () => {
  it('fails a file whose SHA-256 differs from the manifest, after one retry past the cache', async () => {
    const server = fakeServer(SITE);
    server.set('data/quests.json', flipped('data/quests.json'));
    const error = await failure(load(server));
    expect(error.code).toBe('integrity');
    expect(error.file).toBe('quests.json');
    expect(error.message).toMatch(new RegExp(`^data/quests\\.json failed its integrity check: its SHA-256 is [0-9a-f]{12}…, the manifest says ${output('quests.json').sha256.slice(0, 12)}…`));
    expect(server.requests.filter((r) => r.url.endsWith('quests.json')).map((r) => r.cache)).toEqual(['default', 'reload']);
  });

  it('recovers when the retry past the cache returns the right bytes (a stale copy)', async () => {
    const server = fakeServer(SITE);
    const stale = flipped('data/spawns.json');
    server.route((path, _init, attempt) => (path === 'data/spawns.json' && attempt === 1 ? new Response(stale) : undefined));
    const loaded = await load(server);
    expect(loaded.timings.files['spawns.json']?.retried).toBe(true);
    expect(loaded.timings.files['quests.json']?.retried).toBe(false);
  });

  it('fails a file of the wrong size before hashing it', async () => {
    const server = fakeServer(SITE);
    server.set('data/zones.json', `${text(SITE.get('data/zones.json'))}\n`);
    const error = await failure(load(server));
    expect(error.code).toBe('integrity');
    const bytes = output('zones.json').bytes;
    expect(error.message).toContain(`it is ${String(bytes + 1)} bytes, the manifest says ${String(bytes)}`);
  });

  it('fails a manifest whose outputs do not hash to its dataRevision', async () => {
    const server = fakeServer(SITE);
    const manifest = fixtureManifest();
    const [notice] = manifest.outputs;
    if (notice !== undefined) notice.sha256 = '0'.repeat(64);
    server.set('data/manifest.json', JSON.stringify(manifest));
    const error = await failure(load(server));
    expect(error.code).toBe('integrity');
    expect(error.file).toBe('manifest.json');
    expect(error.message).toMatch(/^data\/manifest\.json is inconsistent/);
  });

  it('refuses to run without WebCrypto instead of trusting unverified files', async () => {
    const server = fakeServer(SITE);
    const error = await failure(load(server, { sha256: null }));
    expect(error.code).toBe('unsupported');
    expect(server.requests).toEqual([]);
  });
});

describe('loadDataset failures', () => {
  it('names a missing file and its HTTP status', async () => {
    const server = fakeServer(SITE);
    server.set('data/items.json', null);
    const error = await failure(load(server));
    expect([error.code, error.file]).toEqual(['http', 'items.json']);
    expect(error.message).toMatch(/HTTP 404/);
  });

  it('reports a network failure', async () => {
    const server = fakeServer(SITE);
    server.route((path) => (path === 'data/manifest.json' ? new TypeError('Failed to fetch') : undefined));
    const error = await failure(load(server));
    expect([error.code, error.file]).toEqual(['network', 'manifest.json']);
    expect(error.message).toMatch(/Failed to fetch/);
  });

  it('reports a body that fails part-way (a dropped connection) as a network error, not a crash (code-F6)', async () => {
    const server = fakeServer(SITE);
    server.route((path) => (path === 'data/spawns.json' ? droppedBody('connection reset') : undefined));
    const error = await failure(load(server));
    expect([error.code, error.file]).toEqual(['network', 'spawns.json']);
    expect(error.message).toBe('data/spawns.json could not be read to the end (connection reset). Check the connection and reload.');
  });

  it('reports a manifest that is not JSON (an SPA fallback page) as a format error', async () => {
    const server = fakeServer(SITE);
    server.set('data/manifest.json', '<!doctype html><title>app</title>');
    const error = await failure(load(server));
    expect([error.code, error.file]).toEqual(['format', 'manifest.json']);
    expect(error.message).toMatch(/is not valid JSON/);
  });

  it('reports a verified file of the wrong shape with its paths', async () => {
    // A consistent site whose zones.json lacks a key: every hash matches, the shape does not.
    const zones = jsonOf(SITE, 'data/zones.json') as Record<string, unknown>;
    delete zones['instanceAreas'];
    const site = await withSignedFile(SITE, 'data/zones.json', JSON.stringify(zones));
    const error = await failure(load(fakeServer(site)));
    expect([error.code, error.file]).toEqual(['format', 'zones.json']);
    expect(error.details).toEqual(['zones.json.instanceAreas: missing']);
  });

  it('aborts the other requests after the first failure', async () => {
    const server = fakeServer(SITE);
    server.set('data/NOTICE.md', null);
    const signals: AbortSignal[] = [];
    server.route((_path, init) => {
      if (init?.signal !== undefined) signals.push(init.signal);
      return undefined;
    });
    await failure(load(server));
    expect(signals.length).toBeGreaterThan(1);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it('honours a signal that is already aborted: no request is made (code-F6)', async () => {
    const server = fakeServer(SITE);
    const controller = new AbortController();
    const reason = new Error('the page is closing');
    controller.abort(reason);
    await expect(load(server, { signal: controller.signal })).rejects.toBe(reason);
    expect(server.requests).toEqual([]);
  });

  it('rejects with the abort reason when the signal aborts during the load', async () => {
    const server = fakeServer(SITE);
    const controller = new AbortController();
    const reason = new Error('cancelled');
    const signals: AbortSignal[] = [];
    server.route((path, init) => {
      if (init?.signal !== undefined) signals.push(init.signal);
      if (path !== 'data/quests.json') return undefined;
      controller.abort(reason);
      // A browser rejects a request on an aborted signal with the signal's reason.
      return init?.signal?.aborted === true ? (init.signal.reason as Error) : undefined;
    });
    await expect(load(server, { signal: controller.signal })).rejects.toBe(reason);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
