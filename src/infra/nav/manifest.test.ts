import { describe, expect, it } from 'vitest';
import { fakeServer, jsonOf, nodeSha256, readDirectory, type Bytes } from '../../../tests/support/fake-fetch';
import { sha256Hex } from '../hash';
import { describeNavManifest, loadNavManifest, NAV_MANIFEST_PATH, navRevisionInput, type NavManifestState } from './manifest';

/**
 * The navigation manifest loader (terrain-navigation.md §5, §9.6) on the committed
 * `public/nav/manifest.json`: navigation is optional, so every failure is a typed "unavailable"
 * state, never an exception (except an abort).
 */

const SITE = new Map<string, Bytes>([['nav/manifest.json', readDirectory('public/nav', 'nav/').get('nav/manifest.json') ?? new Uint8Array()]]);
type Json = Record<string, unknown>;
const committed = (): Json => structuredClone(jsonOf(SITE, NAV_MANIFEST_PATH)) as Json;
const encoder = new TextEncoder();

const load = (server = fakeServer(SITE), extra: Partial<Parameters<typeof loadNavManifest>[0]> = {}): Promise<NavManifestState> =>
  loadNavManifest({ fetch: server.fetch, baseUrl: './', sha256: nodeSha256, ...extra });

const reason = (state: NavManifestState): string => (state.kind === 'unavailable' ? state.reason : 'available');

/** The committed manifest with the first block's SHA-256 changed and its navRevision left as it was. */
function tampered(): string {
  const json = committed();
  const [map] = json['maps'] as Json[];
  const [block] = (map?.['blocks'] ?? []) as Json[];
  if (block === undefined) throw new Error('no block');
  block['sha256'] = '0'.repeat(64);
  return JSON.stringify(json);
}

describe('loadNavManifest', () => {
  it('loads the committed manifest, whose navRevision is the SHA-256 of its sorted file lines', async () => {
    const server = fakeServer(SITE);
    const state = await load(server);
    if (state.kind !== 'available') throw new Error(`unavailable: ${state.detail}`);
    expect(state.manifest.maps.map((m) => m.mapId)).toEqual([0, 1]);
    expect(await sha256Hex(nodeSha256, navRevisionInput(state.manifest))).toBe(state.manifest.navRevision);
    expect(state.json).toEqual(committed());
    expect(server.requests).toEqual([{ url: './nav/manifest.json', cache: 'no-cache' }]);
    expect(describeNavManifest(state)).toBe(`navigation ${state.manifest.navRevision.slice(0, 12)}: Eastern Kingdoms (0), Kalimdor (1)`);
  });

  it('reports a deploy without navigation data as not found, without a retry', async () => {
    const server = fakeServer(new Map());
    const state = await load(server);
    expect(reason(state)).toBe('not-found');
    expect(server.requests).toHaveLength(1);
    expect(describeNavManifest(state)).toBe('navigation: unavailable, not deployed (nav/manifest.json: HTTP 404); walking times use straight lines');
  });

  it('reports a failed request as unreachable', async () => {
    const server = fakeServer(SITE);
    server.route(() => new TypeError('Failed to fetch'));
    expect(reason(await load(server))).toBe('unreachable');
  });

  it('refuses a fallback page, a wrong shape and an inconsistent navRevision, each after one reload', async () => {
    for (const [body, expected] of [
      ['<!doctype html><title>app</title>', 'not-json'],
      [JSON.stringify({ ...committed(), schema: 2 }), 'invalid'],
      [tampered(), 'integrity'],
    ] as const) {
      const server = fakeServer(SITE);
      server.route(() => new Response(encoder.encode(body)));
      const state = await load(server);
      expect(reason(state)).toBe(expected);
      expect(server.requests.map((r) => r.cache)).toEqual(['no-cache', 'reload']);
    }
  });

  it('uses the reloaded copy when only the cached one was stale', async () => {
    const server = fakeServer(SITE);
    server.route((_path, init) => (init?.cache === 'no-cache' ? new Response(encoder.encode(tampered())) : undefined));
    expect(reason(await load(server))).toBe('available');
  });

  it('is unavailable without WebCrypto, and asks for nothing', async () => {
    const server = fakeServer(SITE);
    const state = await load(server, { sha256: null });
    expect(reason(state)).toBe('unsupported');
    expect(server.requests).toEqual([]);
  });

  it('rejects only on abort', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('stop', 'AbortError'));
    await expect(load(fakeServer(SITE), { signal: controller.signal })).rejects.toThrow('stop');
  });
});
