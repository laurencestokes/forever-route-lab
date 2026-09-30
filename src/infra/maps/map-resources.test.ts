import { describe, expect, it } from 'vitest';
import { indexJson, syntheticIndex } from '../../../tests/support/atlas-tiles';
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
  const index = readDirectory('public/maps/atlas', 'maps/atlas/').get('maps/atlas/index.json');
  if (index !== undefined) files.set('maps/atlas/index.json', index);
  for (const name of [...files.keys()]) if (name.endsWith('.png')) files.delete(name);
  return files;
}

const COMMITTED_HASH = '748eef8d5584ac4e092fd5f625cdff76';

const setup = (sha256: typeof nodeSha256 | null = nodeSha256, extra: ReadonlyMap<string, Bytes> = new Map()) => {
  const server = fakeServer(new Map([...site(), ...extra]));
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

  it('loads the committed atlas tile index once, revalidated, decoded, and never a tile (map-atlas.md §7.2)', async () => {
    const s = setup();
    const hash = '748eef8d5584ac4e092fd5f625cdff76';
    const load = s.resources.atlas === undefined ? null : await s.resources.atlas(hash);
    expect(load?.kind).toBe('loaded');
    if (load?.kind !== 'loaded') return;
    expect(load.file.index.hash).toBe(hash);
    expect(load.file.urlTemplate).toBe('./maps/atlas/t/{z}/{x}/{y}.webp');
    expect(load.file.index.levels.map((level) => level.z)).toEqual([-8, -7, -6, -5, -4, -3, -2, -1, 0]);
    expect(await s.resources.atlas?.(hash)).toBe(load);
    expect(s.requested('maps/atlas/index.json')).toEqual([{ url: './maps/atlas/index.json', cache: 'no-cache' }]);
    expect(s.server.requests.some((request) => request.url.endsWith('.webp'))).toBe(false);
  });

  it('loads each style’s index from its own directory, once, and the painted one only when asked for (map-atlas.md §21.2)', async () => {
    // A synthetic minimap index (the committed one comes with step MM.6).
    const minimap = syntheticIndex({ style: 'minimap', hash: COMMITTED_HASH, stored: { [-8]: [[0, 0]], [-6]: [[0, 0]] } });
    const s = setup(nodeSha256, new Map([['maps/minimap/index.json', encoder.encode(JSON.stringify(indexJson(minimap, 'minimap')))]]));
    const load = await s.resources.atlas?.(COMMITTED_HASH, 'minimap');
    expect(load?.kind).toBe('loaded');
    if (load?.kind !== 'loaded') return;
    expect([load.file.style, load.file.urlTemplate, load.file.index.baseLevel, load.file.index.underlayLevel]).toEqual(['minimap', './maps/minimap/t/{z}/{x}/{y}.webp', 0, -6]);
    expect(await s.resources.atlas?.(COMMITTED_HASH, 'minimap')).toBe(load);
    expect(s.requested('maps/minimap/index.json')).toHaveLength(1);
    expect(s.requested('maps/atlas/index.json')).toEqual([]);
    const painted = await s.resources.atlas?.(COMMITTED_HASH);
    expect(painted?.kind === 'loaded' ? painted.file.style : null).toBe('painted');
    expect(s.requested('maps/atlas/index.json')).toHaveLength(1);
  });

  it('says why the minimap style has no index: missing (a build without it) or another style’s', async () => {
    const missing = await setup().resources.atlas?.(COMMITTED_HASH, 'minimap');
    expect(missing).toMatchObject({ kind: 'failed' });
    expect(missing?.kind === 'failed' ? missing.detail : '').toContain('maps/minimap/index.json');
    const wrong = setup(nodeSha256, new Map([['maps/minimap/index.json', readDirectory('public/maps/atlas', 'maps/atlas/').get('maps/atlas/index.json') ?? new Uint8Array()]]));
    const refused = await wrong.resources.atlas?.(COMMITTED_HASH, 'minimap');
    expect(refused).toMatchObject({ kind: 'failed', reason: 'invalid' });
    expect(refused?.kind === 'failed' ? refused.detail : '').toBe('maps/minimap/index.json: it is the painted style’s index, not the minimap style’s');
  });

  it('refuses the atlas tile index for other placements, saying why (map-atlas.md §8.6)', async () => {
    const s = setup();
    const load = await s.resources.atlas?.('fedcba9876543210fedcba9876543210');
    expect(load).toMatchObject({ kind: 'failed', reason: 'invalid' });
    expect(load?.kind === 'failed' ? load.detail : '').toContain('maps/atlas/index.json: its atlasHash 748eef8d5584… is not this build’s fedcba987654…');
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
