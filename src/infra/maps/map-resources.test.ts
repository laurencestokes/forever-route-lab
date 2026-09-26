import { describe, expect, it } from 'vitest';
import { type Bytes, fakeServer, nodeSha256, readDirectory } from '../../../tests/support/fake-fetch';
import { worldMapId } from '../../domain/ids';
import { createMapResources } from './map-resources';

/*
 * The committed map resources at runtime (D-032, D-033): lazily loaded, verified, memoised, and
 * never fatal. The fake server holds the committed manifests and arc files; the images are left
 * out on purpose, because the loader never fetches them (the adapter draws them from their URLs).
 */

const encoder = new TextEncoder();
const EK = worldMapId(0);
const KALIMDOR = worldMapId(1);

function site(): Map<string, Bytes> {
  const files = new Map<string, Bytes>([
    ...readDirectory('public/maps/terrain', 'maps/terrain/'),
    ...readDirectory('public/maps/terrain/0', 'maps/terrain/0/'),
    ...readDirectory('public/maps/terrain/1', 'maps/terrain/1/'),
  ]);
  const art = readDirectory('public/maps/art', 'maps/art/');
  for (const name of ['maps/art/manifest.json', 'maps/art/NOTICE.md']) {
    const bytes = art.get(name);
    if (bytes !== undefined) files.set(name, bytes);
  }
  for (const name of [...files.keys()]) if (name.endsWith('.png')) files.delete(name);
  return files;
}

const setup = (sha256: typeof nodeSha256 | null = nodeSha256) => {
  const server = fakeServer(site());
  const resources = createMapResources({ fetch: server.fetch, baseUrl: './', sha256 });
  const requested = (path: string) => server.requests.filter((request) => request.url === `./${path}`);
  return { server, resources, requested };
};

describe('createMapResources', () => {
  it('loads each manifest once, revalidated, and never an image', async () => {
    const s = setup();
    const [art, terrain] = await Promise.all([s.resources.art(), s.resources.terrain()]);
    expect(art).toMatchObject({ kind: 'loaded', manifest: { owner: 'Blizzard Entertainment' } });
    expect(terrain.kind === 'loaded' ? terrain.manifest.maps.map((map) => map.mapId) : []).toEqual([0, 1]);
    await s.resources.art();
    await s.resources.terrain();
    expect(s.requested('maps/art/manifest.json')).toEqual([{ url: './maps/art/manifest.json', cache: 'no-cache' }]);
    expect(s.requested('maps/terrain/manifest.json')).toHaveLength(1);
    expect(s.server.requests.some((request) => /\.(webp|png)$/.test(request.url))).toBe(false);
  });

  it('verifies an arc file against the manifest’s SHA-256, decodes it, and loads it once', async () => {
    const s = setup();
    const zones = await s.resources.arcs(KALIMDOR, 'zones');
    expect(zones.kind === 'loaded' ? zones.arcs.lines.length : 0).toBe(127);
    const again = await s.resources.arcs(KALIMDOR, 'zones');
    expect(again).toBe(zones);
    expect(s.requested('maps/terrain/1/zones.json')).toEqual([{ url: './maps/terrain/1/zones.json', cache: 'default' }]);
    expect((await s.resources.arcs(EK, 'coast')).kind).toBe('loaded');
  });

  it('fetches a mismatching file once more past the cache, then refuses it for good', async () => {
    const s = setup();
    s.server.set('maps/terrain/1/zones.json', '{"schema":1}');
    const result = await s.resources.arcs(KALIMDOR, 'zones');
    expect(result).toMatchObject({ kind: 'failed', reason: 'invalid' });
    expect(result.kind === 'failed' ? result.detail : '').toMatch(/^maps\/terrain\/1\/zones\.json failed its integrity check: its SHA-256 is/);
    expect(s.requested('maps/terrain/1/zones.json').map((request) => request.cache)).toEqual(['default', 'reload']);
    // A copy cached from an earlier deploy is replaced by the second fetch.
    const t = setup();
    t.server.route((path, init) => (path === 'maps/terrain/0/zones.json' && init?.cache !== 'reload' ? new Response(encoder.encode('stale')) : undefined));
    expect((await t.resources.arcs(EK, 'zones')).kind).toBe('loaded');
    // A refusal is kept: asking again fetches nothing.
    await s.resources.arcs(KALIMDOR, 'zones');
    expect(s.requested('maps/terrain/1/zones.json')).toHaveLength(2);
  });

  it('says a file it could not fetch is unavailable, and tries it again on the next call', async () => {
    const s = setup();
    s.server.route((path, _init, attempt) => (path === 'maps/terrain/1/coast.json' && attempt === 1 ? new TypeError('offline') : undefined));
    expect(await s.resources.arcs(KALIMDOR, 'coast')).toMatchObject({ kind: 'failed', reason: 'unavailable', detail: 'maps/terrain/1/coast.json: offline' });
    expect((await s.resources.arcs(KALIMDOR, 'coast')).kind).toBe('loaded');
  });

  it('never rejects: a missing manifest is unavailable, a fallback page is not JSON, a world map without terrain says so', async () => {
    const s = setup();
    s.server.set('maps/art/manifest.json', null);
    s.server.set('maps/terrain/manifest.json', '<!doctype html><title>App</title>');
    expect(await s.resources.art()).toEqual({ kind: 'failed', reason: 'unavailable', detail: 'maps/art/manifest.json: HTTP 404' });
    expect(await s.resources.terrain()).toEqual({ kind: 'failed', reason: 'invalid', detail: 'maps/terrain/manifest.json is not JSON' });
    // Without a terrain manifest no arc file is fetched.
    expect(await s.resources.arcs(KALIMDOR, 'zones')).toMatchObject({ kind: 'failed', reason: 'invalid' });
    const t = setup();
    expect(await t.resources.arcs(worldMapId(2991), 'zones')).toEqual({ kind: 'failed', reason: 'invalid', detail: 'no zone outlines for world map 2991' });
  });

  it('refuses arc files it cannot verify (no WebCrypto on an insecure page)', async () => {
    const s = setup(null);
    expect(await s.resources.arcs(KALIMDOR, 'zones')).toMatchObject({ kind: 'failed', reason: 'invalid', detail: expect.stringMatching(/WebCrypto/) as unknown });
    expect(s.requested('maps/terrain/1/zones.json')).toEqual([]);
  });
});
