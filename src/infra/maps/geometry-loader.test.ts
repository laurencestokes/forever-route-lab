import { describe, expect, it } from 'vitest';
import { type Bytes, droppedBody, fakeServer, fixtureSite, jsonOf, nodeSha256 } from '../../../tests/support/fake-fetch';
import { uiMapId } from '../../domain/ids';
import { parseGeometryFile } from '../../geo';
import { hexOf } from '../hash';
import { contentHashOf, describeGeometry, frameHashOf, GeometryLoadError, loadGeometry, type LoadedGeometry } from './geometry-loader';

const SITE = fixtureSite();
const PLACEHOLDER = 'maps/placeholder/geometry.placeholder.json';
/** docs/MAPS.md §5.6: the frame hash of the 49 QuestieDB frames at the pinned inputs. */
const REFERENCE_FRAME_HASH = '2cb10551b1502b652e4d54922e8b3a1ecb48057fbfb7cf9c77863edd7efea78f';
/** The committed placeholder's content hash (tools/maps writes it; MAPS.md §5.3). */
const PLACEHOLDER_CONTENT_HASH = 'c05a47a276295348a5b40a98dbe13c39ddc6fb4a899c21c821714ebf51c4e6ca';

type Json = Record<string, unknown>;
const encoder = new TextEncoder();
const placeholderJson = (): Json => structuredClone(jsonOf(SITE, PLACEHOLDER)) as Json;

const load = (server = fakeServer(SITE), extra: Partial<Parameters<typeof loadGeometry>[0]> = {}): Promise<LoadedGeometry> =>
  loadGeometry({ fetch: server.fetch, baseUrl: './', sha256: nodeSha256, ...extra });

/** The load's rejection, which must be a GeometryLoadError. */
async function failure(promise: Promise<unknown>): Promise<GeometryLoadError> {
  const error = await promise.then(
    () => {
      throw new Error('the load did not fail');
    },
    (e: unknown) => e,
  );
  if (error instanceof GeometryLoadError) return error;
  throw error;
}

/** The placeholder with `edit` applied, and its recorded hashes left as they were. */
function editedPlaceholder(edit: (json: Json) => void): string {
  const json = placeholderJson();
  edit(json);
  return JSON.stringify(json);
}

const mapsOf = (json: Json): Record<string, Json> => json['maps'] as Record<string, Json>;
const firstRow = (json: Json, id: string): Json => {
  const [row] = (mapsOf(json)[id]?.['assignments'] ?? []) as Json[];
  if (row === undefined) throw new Error(`no row for UiMap ${id}`);
  return row;
};

/** A local geometry with the placeholder's rows (as `local-db2`) and no recorded hashes, optionally edited. */
function localGeometryJson(edit: (maps: Record<string, Json>) => void = () => undefined): Json {
  const json = placeholderJson();
  const maps = mapsOf(json);
  for (const map of Object.values(maps)) {
    map['nameSource'] = 'local-db2';
    for (const row of map['assignments'] as Json[]) {
      row['source'] = 'local-db2';
      row['build'] = '1.60.1.70009';
    }
  }
  edit(maps);
  delete json['inputs'];
  return { ...json, kind: 'local', redistribution: 'local-only', build: '1.60.1.70009', frameHash: null, contentHash: null };
}

const localGeometry = (edit?: (maps: Record<string, Json>) => void): Bytes => encoder.encode(JSON.stringify(localGeometryJson(edit)));

async function withLocalSet(geometry: Bytes, manifest: Partial<Json> = {}) {
  const server = fakeServer(SITE);
  server.set('local-maps/geometry.local.json', geometry);
  const sha256 = hexOf(await nodeSha256.digest('SHA-256', geometry));
  server.set(
    'local-maps/maps.manifest.json',
    JSON.stringify({
      schema: 1,
      redistribution: 'local-only',
      set: 'wow_classic_beta-1.60.1.70009',
      product: 'wow_classic_beta',
      build: '1.60.1.70009',
      geometry: { file: 'geometry.local.json', sha256 },
      ...manifest,
    }),
  );
  return server;
}

/** A UiMap the placeholder lacks, with one full-rectangle row on Kalimdor. */
const addedMap = (): Json => ({
  name: 'Test zone',
  nameSource: 'local-db2',
  type: 3,
  parent: 1414,
  assignments: [
    {
      id: 999_001,
      mapId: 1,
      areaId: 999,
      orderIndex: 0,
      xMin: 0,
      xMax: 100,
      yMin: 0,
      yMax: 100,
      uiMin: [0, 0],
      uiMax: [1, 1],
      source: 'local-db2',
      build: '1.60.1.70009',
    },
  ],
});

describe('loadGeometry: the committed placeholder', () => {
  it('loads it revalidated, recomputes both hashes and records its source pin and conversion file', async () => {
    const server = fakeServer(SITE);
    const loaded = await load(server);
    expect(loaded.frameHash).toBe(REFERENCE_FRAME_HASH);
    expect(loaded.contentHash).toBe(PLACEHOLDER_CONTENT_HASH);
    expect(loaded.placeholder.kind).toBe('placeholder');
    expect(loaded.placeholder.maps.size).toBe(60);
    expect(loaded.geometry).toBe(loaded.placeholder);
    expect(loaded.frameSource).toEqual({
      commit: 'b6f5b07b0acf1c820993cbb0ce2521c912bb4c92',
      build: '1.60.1.69893',
      sha256: 'f4477d6c575575152225f2a9d40858029bf9d2d5fdf6b083c06557fce8b5984b',
    });
    expect(await frameHashOf(nodeSha256, loaded.placeholder)).toBe(REFERENCE_FRAME_HASH);
    expect(await contentHashOf(nodeSha256, loaded.placeholder)).toBe(PLACEHOLDER_CONTENT_HASH);
    // Revalidated like the data manifest (COORD-1): the file changes at every pin bump.
    expect(server.requests.find((r) => r.url === `./${PLACEHOLDER}`)?.cache).toBe('no-cache');
  });

  it('fetches past the HTTP cache when asked (the pairing retry)', async () => {
    const server = fakeServer(SITE);
    await load(server, { cache: 'reload' });
    expect(server.requests.find((r) => r.url === `./${PLACEHOLDER}`)?.cache).toBe('reload');
  });

  it('fetches a damaged copy once more past the cache before failing, like data files', async () => {
    const server = fakeServer(SITE);
    const damaged = editedPlaceholder((json) => {
      firstRow(json, '1411')['xMax'] = 1900;
    });
    // The first (revalidated) answer is damaged; the second, past the cache, is the real file.
    server.route((path, _init, attempt) => (path === PLACEHOLDER && attempt === 1 ? new Response(damaged) : undefined));
    const loaded = await load(server);
    expect(loaded.frameHash).toBe(REFERENCE_FRAME_HASH);
    expect(server.requests.filter((r) => r.url === `./${PLACEHOLDER}`).map((r) => r.cache)).toEqual(['no-cache', 'reload']);
  });

  it('refuses a placeholder whose rows no longer give the frame hash it records', async () => {
    const server = fakeServer(SITE);
    server.set(
      PLACEHOLDER,
      editedPlaceholder((json) => {
        firstRow(json, '1411')['xMax'] = 1900;
      }),
    );
    const error = await failure(load(server));
    expect(error.code).toBe('integrity');
    expect(error.message).toMatch(/failed its frame check/);
  });

  it('refuses edits the frame hash cannot see: coefficients, AreaIDs, continent rows, names (code-F2)', async () => {
    const edits: readonly ((json: Json) => void)[] = [
      (json) => {
        const era = (json['eraToForever'] as Record<string, Json>)['1453'];
        if (era !== undefined) era['scaleX'] = Number(era['scaleX']) * 1.5;
      },
      (json) => {
        firstRow(json, '1411')['areaId'] = 1;
      },
      (json) => {
        firstRow(json, '1414')['xMin'] = -5000;
      },
      (json) => {
        const map = mapsOf(json)['1414'];
        if (map !== undefined) map['name'] = 'Somewhere else';
      },
    ];
    for (const edit of edits) {
      const server = fakeServer(SITE);
      server.set(PLACEHOLDER, editedPlaceholder(edit));
      const error = await failure(load(server));
      expect(error.code).toBe('integrity');
      expect(error.message).toMatch(/^maps\/placeholder\/geometry\.placeholder\.json failed its content check: .* the file records c05a47a27629…/);
    }
  });

  it('refuses a missing or malformed placeholder, and runs only with WebCrypto, each with its code', async () => {
    const missing = fakeServer(SITE);
    missing.set(PLACEHOLDER, null);
    const http = await failure(load(missing));
    expect([http.code, http.message]).toEqual(['http', `${PLACEHOLDER} could not be loaded: the server answered HTTP 404.`]);
    const broken = fakeServer(SITE);
    broken.set(PLACEHOLDER, JSON.stringify({ ...placeholderJson(), schema: 2 }));
    const format = await failure(load(broken));
    expect([format.code, format.details]).toEqual(['format', ['schema: must be 1']]);
    const noContentHash = fakeServer(SITE);
    noContentHash.set(PLACEHOLDER, JSON.stringify({ ...placeholderJson(), contentHash: null }));
    expect((await failure(load(noContentHash))).details).toEqual(['contentHash: the placeholder must record its content hash']);
    const unsupported = await failure(loadGeometry({ fetch: fakeServer(SITE).fetch, baseUrl: './', sha256: null }));
    expect(unsupported.code).toBe('unsupported');
    expect(unsupported.message).toMatch(/WebCrypto/);
  });

  it('reports a body that fails part-way as a network error (code-F6)', async () => {
    const server = fakeServer(SITE);
    server.route((path) => (path === PLACEHOLDER ? droppedBody('connection reset') : undefined));
    const error = await failure(load(server));
    expect([error.code, error.message]).toEqual(['network', `${PLACEHOLDER} could not be read to the end (connection reset).`]);
  });

  it('honours a signal that is already aborted: no request is made', async () => {
    const server = fakeServer(SITE);
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);
    await expect(load(server, { signal: controller.signal })).rejects.toBe(reason);
    expect(server.requests).toEqual([]);
  });
});

describe('loadGeometry: probing local-maps/', () => {
  it('treats a 404 as "no local set" (every deployed site)', async () => {
    const server = fakeServer(SITE);
    const loaded = await load(server);
    expect(loaded.local).toMatchObject({ kind: 'none', reason: 'not-found' });
    expect(server.requests.find((r) => r.url === './local-maps/maps.manifest.json')?.cache).toBe('no-store');
    expect(describeGeometry(loaded)).toBe('placeholder: 49 frames @ 1.60.1.69893, 12 rows @ 1.60.1.70009; local set: none');
  });

  it('treats an HTML fallback page, a failed request and a malformed manifest as absent, and says why (code-F14)', async () => {
    const html = fakeServer(SITE);
    html.set('local-maps/maps.manifest.json', '<!doctype html><div id="root"></div>');
    const fallback = await load(html);
    expect(fallback.local).toMatchObject({ kind: 'none', reason: 'not-json' });
    expect(describeGeometry(fallback)).toMatch(/; local set: none \(local-maps\/maps\.manifest\.json is not JSON/);
    const offline = fakeServer(SITE);
    offline.route((path) => (path.startsWith('local-maps/') ? new TypeError('Failed to fetch') : undefined));
    const unreachable = await load(offline);
    expect(unreachable.local).toMatchObject({ kind: 'none', reason: 'unreachable' });
    expect(describeGeometry(unreachable)).toMatch(/; local set: none \(local-maps\/maps\.manifest\.json: Failed to fetch\)$/);
    const shared = fakeServer(SITE);
    shared.set('local-maps/maps.manifest.json', JSON.stringify({ schema: 1, redistribution: 'public' }));
    const invalid = await load(shared);
    expect(invalid.local).toMatchObject({ kind: 'none', reason: 'invalid-manifest' });
    expect(describeGeometry(invalid)).toMatch(/; local set: refused \(local-maps\/maps\.manifest\.json: not marked local-only\)$/);
    const escape = await withLocalSet(localGeometry(), { geometry: { file: '../../etc/passwd', sha256: 'a'.repeat(64) } });
    expect((await load(escape)).local).toMatchObject({ kind: 'none', reason: 'invalid-manifest' });
  });

  it('treats a geometry changed after activation as absent, and says so', async () => {
    const server = await withLocalSet(localGeometry());
    server.set('local-maps/geometry.local.json', localGeometry((maps) => (maps['9999'] = addedMap())));
    const loaded = await load(server);
    expect(loaded.local).toMatchObject({ kind: 'none', reason: 'geometry-changed' });
    expect(loaded.geometry).toBe(loaded.placeholder);
    expect(describeGeometry(loaded)).toMatch(/; local set: refused \(local-maps\/geometry\.local\.json changed after the set was activated .*run tools\/maps validate --activate again\)$/);
  });

  it('checks a content hash a local set records, and refuses the set when it does not hold', async () => {
    const json = localGeometryJson((maps) => (maps['9999'] = addedMap()));
    const parsed = parseGeometryFile(json);
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    const right = await contentHashOf(nodeSha256, parsed.geometry);
    const good = await load(await withLocalSet(encoder.encode(JSON.stringify({ ...json, contentHash: right }))));
    expect(good.local.kind).toBe('compatible');
    const bad = await load(await withLocalSet(encoder.encode(JSON.stringify({ ...json, contentHash: '0'.repeat(64) }))));
    expect(bad.local).toMatchObject({ kind: 'none', reason: 'invalid-geometry' });
    expect(describeGeometry(bad)).toMatch(/local set: refused \(local-maps\/geometry\.local\.json: its content hashes to [0-9a-f]{12}…, the file records 000000000000…\)$/);
    expect(bad.geometry).toBe(bad.placeholder);
  });

  it('merges a compatible local set, adding the UiMaps the placeholder lacks', async () => {
    const loaded = await load(await withLocalSet(localGeometry((maps) => (maps['9999'] = addedMap()))));
    expect(loaded.local).toEqual({ kind: 'compatible', set: 'wow_classic_beta-1.60.1.70009', build: '1.60.1.70009', frameHash: REFERENCE_FRAME_HASH, added: [9999] });
    expect(loaded.geometry.kind).toBe('merged');
    expect(loaded.geometry.maps.has(uiMapId(9999))).toBe(true);
    // Everything the placeholder has is kept as it is.
    expect(loaded.geometry.maps.get(uiMapId(1411))).toEqual(loaded.placeholder.maps.get(uiMapId(1411)));
    expect(describeGeometry(loaded)).toMatch(/local set 1\.60\.1\.70009: compatible, 1 UiMaps added$/);
  });

  it('keeps the placeholder and names the UiMaps when a local frame differs', async () => {
    const geometry = localGeometry((maps) => {
      const [row] = (maps['1412']?.['assignments'] ?? []) as Json[];
      if (row !== undefined) row['xMin'] = Number(row['xMin']) - 100;
    });
    const loaded = await load(await withLocalSet(geometry));
    expect(loaded.local).toMatchObject({ kind: 'incompatible', frameUiMapIds: [1412], sharedRowUiMapIds: [] });
    expect(loaded.local.kind === 'incompatible' ? loaded.local.frameHash : null).not.toBe(REFERENCE_FRAME_HASH);
    expect(loaded.geometry).toBe(loaded.placeholder);
    expect(describeGeometry(loaded)).toMatch(/incompatible, using the placeholder$/);
  });
});
