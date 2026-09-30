import { describe, expect, it } from 'vitest';
import { type Bytes, fakeServer, nodeSha256, readDirectory } from '../../../tests/support/fake-fetch';
import {
  CLIENT_TABLES_MANIFEST_PATH,
  createClientTables,
  parseClientDungeons,
  parseClientTablesManifest,
  parseClientTaxi,
  parseClientZones,
  type ClientTableFile,
} from './client-tables';

/*
 * The committed client tables at runtime (D-039 B, C and E; map-presentation.md §9, §16): lazily
 * loaded, verified against the manifest's SHA-256, memoised, and never fatal, so that a failure
 * leaves the caller its fallback (flights on TIME-5, no network lines).
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const site = (): Map<string, Bytes> => readDirectory('public/maps/client', 'maps/client/');

const setup = (sha256: typeof nodeSha256 | null = nodeSha256) => {
  const server = fakeServer(site());
  const tables = createClientTables({ fetch: server.fetch, baseUrl: './', sha256 });
  const requested = (path: string) => server.requests.filter((request) => request.url === `./${path}`);
  return { server, tables, requested };
};

const committed = (name: string): unknown => JSON.parse(decoder.decode(site().get(`maps/client/${name}`))) as unknown;

describe('createClientTables', () => {
  it('loads the manifest once, revalidated, and each table once, verified', async () => {
    const s = setup();
    const [taxi, zones, dungeons] = await Promise.all([s.tables.taxi(), s.tables.zones(), s.tables.dungeons()]);
    expect(taxi.kind === 'loaded' ? [taxi.table.nodes.length, taxi.table.flights.length, taxi.table.transports.length] : null).toEqual([65, 286, 14]);
    expect(zones.kind === 'loaded' ? zones.table.zones.length : null).toBe(54);
    expect(dungeons.kind === 'loaded' ? dungeons.table.lfg.length : null).toBe(30);
    expect(await s.tables.taxi()).toBe(taxi);
    expect(s.requested(CLIENT_TABLES_MANIFEST_PATH)).toEqual([{ url: './maps/client/manifest.json', cache: 'no-cache' }]);
    expect(s.requested('maps/client/taxi.json')).toEqual([{ url: './maps/client/taxi.json', cache: 'default' }]);
    expect(s.server.requests.some((request) => request.url.endsWith('NOTICE.md'))).toBe(false);
  });

  it('gives world points on the node’s world map, never atlas coordinates (D-017)', async () => {
    const taxi = await setup().tables.taxi();
    if (taxi.kind !== 'loaded') throw new Error(taxi.detail);
    const stormwind = taxi.table.nodes.find((n) => n.id === 2);
    expect(stormwind?.point).toEqual({ mapId: 0, x: -8833, y: 479 });
    const flight = taxi.table.flights.find((f) => f.from === 2);
    expect(flight?.shape.every((p) => p.mapId === 0)).toBe(true);
    const zephras = taxi.table.transports.find((t) => t.pathId === 11398);
    expect(zephras?.maps).toEqual([0, 2991]);
    expect(zephras?.stops.map((stop) => stop.point.mapId)).toEqual([0, 2991]);
  });

  it('fetches a mismatching file once more past the cache, then refuses it for good', async () => {
    const s = setup();
    s.server.set('maps/client/taxi.json', '{"schema":1}');
    const result = await s.tables.taxi();
    expect(result).toMatchObject({ kind: 'failed', reason: 'invalid' });
    expect(result.kind === 'failed' ? result.detail : '').toMatch(/^maps\/client\/taxi\.json failed its integrity check: its SHA-256 is/);
    expect(s.requested('maps/client/taxi.json').map((request) => request.cache)).toEqual(['default', 'reload']);
    await s.tables.taxi();
    expect(s.requested('maps/client/taxi.json')).toHaveLength(2);
    // A stale copy from an earlier deploy is replaced by the second fetch.
    const t = setup();
    t.server.route((path, init) => (path === 'maps/client/zones.json' && init?.cache !== 'reload' ? new Response(encoder.encode('stale')) : undefined));
    expect((await t.tables.zones()).kind).toBe('loaded');
  });

  it('says a file it could not fetch is unavailable, and tries it again on the next call', async () => {
    const s = setup();
    s.server.route((path, _init, attempt) => (path === 'maps/client/dungeons.json' && attempt === 1 ? new TypeError('offline') : undefined));
    expect(await s.tables.dungeons()).toMatchObject({ kind: 'failed', reason: 'unavailable', detail: 'maps/client/dungeons.json: offline' });
    expect((await s.tables.dungeons()).kind).toBe('loaded');
    const m = setup();
    m.server.route((path, _init, attempt) => (path === CLIENT_TABLES_MANIFEST_PATH && attempt === 1 ? new Response('down', { status: 503 }) : undefined));
    expect(await m.tables.taxi()).toMatchObject({ kind: 'failed', reason: 'unavailable', detail: 'maps/client/manifest.json: HTTP 503' });
    expect((await m.tables.taxi()).kind).toBe('loaded');
  });

  it('refuses a manifest that is not one, and cannot verify without WebCrypto', async () => {
    const s = setup();
    s.server.set(CLIENT_TABLES_MANIFEST_PATH, '<!doctype html>');
    expect(await s.tables.zones()).toMatchObject({ kind: 'failed', reason: 'invalid', detail: 'maps/client/manifest.json is not JSON' });
    const n = setup(null);
    expect(await n.tables.zones()).toMatchObject({ kind: 'failed', reason: 'invalid', detail: expect.stringMatching(/WebCrypto needs a secure page/) as unknown });
    expect(n.requested('maps/client/zones.json')).toEqual([]);
  });
});

describe('guards', () => {
  const manifestJson = committed('manifest.json') as Record<string, unknown>;
  const manifest = parseClientTablesManifest(manifestJson, 'base/');
  if (typeof manifest === 'string') throw new Error(manifest);
  const file = (kind: 'taxi' | 'zones' | 'dungeons'): ClientTableFile => manifest.files[kind];
  const edit = (name: string, change: (json: Record<string, unknown>) => void): unknown => {
    const json = structuredClone(committed(name)) as Record<string, unknown>;
    change(json);
    return json;
  };

  it('reads the manifest’s three files with their URLs and counts', () => {
    expect(manifest.build).toBe('1.60.1.70009');
    expect(manifest.files.taxi).toMatchObject({ path: 'maps/client/taxi.json', url: 'base/maps/client/taxi.json', counts: { nodes: 65, flights: 286, transports: 14 } });
    expect(parseClientTablesManifest({ ...manifestJson, kind: 'art' }, '')).toBe('kind is not client-tables');
    const files = manifestJson['files'] as readonly Record<string, unknown>[];
    expect(parseClientTablesManifest({ ...manifestJson, files: files.slice(1) }, '')).toMatch(/must list taxi\.json, zones\.json and dungeons\.json/);
    expect(parseClientTablesManifest({ ...manifestJson, files: [{ ...files[0], path: '../x.json' }, ...files.slice(1)] }, '')).toMatch(/path must be taxi\.json/);
    expect(parseClientTablesManifest({ ...manifestJson, files: [...files, files[0]] }, '')).toMatch(/repeats taxi/);
  });

  it('refuses a taxi file with a dangling node, a bad shape, stops off the path’s maps or counts other than the manifest’s', () => {
    expect(typeof parseClientTaxi(committed('taxi.json'), file('taxi'), '1.60.1.70009')).toBe('object');
    expect(parseClientTaxi(committed('taxi.json'), file('taxi'), '1.60.1.99999')).toMatch(/is not the manifest's 1\.60\.1\.99999/);
    const flight = (json: Record<string, unknown>) => (json['flights'] as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(parseClientTaxi(edit('taxi.json', (j) => { flight(j)['from'] = 99999; }), file('taxi'))).toMatch(/names a node the file does not list/);
    expect(parseClientTaxi(edit('taxi.json', (j) => { flight(j)['shape'] = [1, 2, 3]; }), file('taxi'))).toMatch(/shape must hold at least two integer points/);
    expect(parseClientTaxi(edit('taxi.json', (j) => { flight(j)['l3d'] = 0; }), file('taxi'))).toMatch(/positive l3d/);
    const transport = (json: Record<string, unknown>) => (json['transports'] as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(parseClientTaxi(edit('taxi.json', (j) => { transport(j)['stops'] = [[5, 0, 0, 60]]; }), file('taxi'))).toMatch(/must lie on the path's maps/);
    expect(parseClientTaxi(edit('taxi.json', (j) => { (j['nodes'] as unknown[]).pop(); }), file('taxi'))).toMatch(/names a node the file does not list|64 nodes, the manifest records 65/);
    expect(parseClientTaxi(edit('taxi.json', (j) => { (j['transports'] as unknown[]).pop(); }), file('taxi'))).toBe('13 transport paths, the manifest records 14');
    expect(parseClientTaxi(edit('taxi.json', (j) => { j['units'] = 'm'; }), file('taxi'))).toBe('units are not yd');
  });

  it('refuses malformed zone and dungeon rows', () => {
    expect(typeof parseClientZones(committed('zones.json'), file('zones'))).toBe('object');
    expect(parseClientZones(edit('zones.json', (j) => { ((j['zones'] as Record<string, unknown>[])[0] as Record<string, unknown>)['sanctuary'] = 1; }), file('zones'))).toMatch(/sanctuary flag/);
    expect(parseClientZones(edit('zones.json', (j) => { (j['zones'] as unknown[]).reverse(); }), file('zones'))).toMatch(/ascending/);
    expect(parseClientZones(edit('zones.json', (j) => { j['kind'] = 'client-taxi'; }), file('zones'))).toBe('not a schema 1 client-zones file');
    const dungeons = parseClientDungeons(committed('dungeons.json'), file('dungeons'));
    expect(typeof dungeons === 'string' ? dungeons : dungeons.undecodedRows).toEqual({ AreaTable: 46, LFGDungeons: 5, Map: 8 });
    expect(parseClientDungeons(edit('dungeons.json', (j) => { ((j['lfg'] as Record<string, unknown>[])[0] as Record<string, unknown>)['minLevelSquish'] = -1; }), file('dungeons'))).toMatch(/four non-negative levels/);
    expect(parseClientDungeons(edit('dungeons.json', (j) => { ((j['instanceMaps'] as Record<string, unknown>[])[0] as Record<string, unknown>)['instanceType'] = 3; }), file('dungeons'))).toMatch(/instanceType 1 or 2/);
    expect(parseClientDungeons(edit('dungeons.json', (j) => { (j['lfg'] as unknown[]).pop(); }), file('dungeons'))).toBe('29 LFG rows, the manifest records 30');
    expect(parseClientDungeons(edit('dungeons.json', (j) => { delete j['undecoded']; }), file('dungeons'))).toBe('undecoded.tables must be an object');
  });
});
