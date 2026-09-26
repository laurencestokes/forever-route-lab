import { describe, expect, it } from 'vitest';
import { type Bytes, fakeServer, fixtureSite, jsonOf, nodeSha256 } from '../../../tests/support/fake-fetch';
import { uiMapId } from '../../domain/ids';
import { parseGeometryFile, type MapGeometry } from '../../geo';
import { hexOf } from '../hash';
import { describeGeometry, loadGeometry, type LoadedGeometry } from './geometry-loader';
import { createLocalArt, parseArtSection, type LocalArtLoad } from './local-art';
import { pngImage, webpImage } from './test-images';

/*
 * Fixture local sets: the committed placeholder's rows re-labelled as a local extraction, one
 * added UiMap (9999), and tiny generated images (a decodable 6 × 4 PNG for Durotar 1411; a
 * header-valid 4 × 4 WebP container for 9999, whose bitstream is a placeholder). No real map art
 * is involved (D-018).
 */

type Json = Record<string, unknown>;
const SITE = fixtureSite();
const PLACEHOLDER = 'maps/placeholder/geometry.placeholder.json';
const encoder = new TextEncoder();
const sha = async (bytes: Bytes): Promise<string> => hexOf(await nodeSha256.digest('SHA-256', bytes));

/** Durotar's committed row (docs/MAPS.md §5.3). */
const DUROTAR = { assignment: 46721, mapId: 1, xMin: -1716.6666259766, xMax: 1808.3332519531, yMin: -7249.9995117188, yMax: -1962.4998779297 };
const ADDED = { assignment: 999_001, mapId: 1, xMin: 0, xMax: 100, yMin: 0, yMax: 100 };

function localGeometryJson(): Json {
  const json = structuredClone(jsonOf(SITE, PLACEHOLDER)) as Json;
  const maps = json['maps'] as Record<string, Json>;
  for (const map of Object.values(maps)) {
    map['nameSource'] = 'local-db2';
    for (const row of map['assignments'] as Json[]) {
      row['source'] = 'local-db2';
      row['build'] = '1.60.1.70009';
    }
  }
  maps['9999'] = {
    name: 'Test zone',
    nameSource: 'local-db2',
    type: 3,
    parent: 1414,
    assignments: [
      { id: ADDED.assignment, mapId: 1, areaId: 999, orderIndex: 0, xMin: 0, xMax: 100, yMin: 0, yMax: 100, uiMin: [0, 0], uiMax: [1, 1], source: 'local-db2', build: '1.60.1.70009' },
    ],
  };
  delete json['inputs'];
  return { ...json, kind: 'local', redistribution: 'local-only', build: '1.60.1.70009', frameHash: null, contentHash: null };
}

const LOCAL_GEOMETRY: MapGeometry = (() => {
  const parsed = parseGeometryFile(localGeometryJson());
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.geometry;
})();

const DUROTAR_PNG = pngImage(6, 4);
const ADDED_WEBP = webpImage(4, 4);

async function artSection(): Promise<Json> {
  return {
    '1411': { file: 'art/1411.png', contentType: 'image/png', width: 6, height: 4, sha256: await sha(DUROTAR_PNG), bounds: DUROTAR },
    '9999': { file: 'art/9999.webp', contentType: 'image/webp', width: 4, height: 4, sha256: await sha(ADDED_WEBP), bounds: ADDED },
  };
}

/** A site with an activated local set: geometry, both images and a manifest with `art` (or `manifestArt`). */
async function siteWithArt(manifestArt?: unknown) {
  const server = fakeServer(SITE);
  const geometry = encoder.encode(JSON.stringify(localGeometryJson()));
  server.set('local-maps/geometry.local.json', geometry);
  server.set('local-maps/art/1411.png', DUROTAR_PNG);
  server.set('local-maps/art/9999.webp', ADDED_WEBP);
  const manifest: Json = {
    schema: 1,
    redistribution: 'local-only',
    set: 'wow_classic_beta-1.60.1.70009',
    product: 'wow_classic_beta',
    build: '1.60.1.70009',
    geometry: { file: 'geometry.local.json', sha256: await sha(geometry) },
  };
  if (manifestArt !== null) manifest['art'] = manifestArt ?? (await artSection());
  server.set('local-maps/maps.manifest.json', JSON.stringify(manifest));
  return server;
}

const load = (server: ReturnType<typeof fakeServer>): Promise<LoadedGeometry> => loadGeometry({ fetch: server.fetch, baseUrl: './', sha256: nodeSha256 });
const artRequests = (server: ReturnType<typeof fakeServer>): readonly string[] => server.requests.map((r) => r.url).filter((url) => url.includes('local-maps/art/'));

async function verified(result: LocalArtLoad): Promise<Uint8Array> {
  if (result.kind !== 'verified') throw new Error(`not verified: ${result.reason} ${result.detail}`);
  return new Uint8Array(await result.blob.arrayBuffer());
}

describe('parseArtSection', () => {
  it('turns the manifest section into entries placed by their rows, ascending by UiMap', async () => {
    const entries = parseArtSection(await artSection(), LOCAL_GEOMETRY, './');
    expect(entries).toEqual([
      {
        uiMapId: 1411,
        mapId: 1,
        bounds: { xMin: DUROTAR.xMin, xMax: DUROTAR.xMax, yMin: DUROTAR.yMin, yMax: DUROTAR.yMax },
        url: './local-maps/art/1411.png',
        width: 6,
        height: 4,
        contentType: 'image/png',
        sha256: await sha(DUROTAR_PNG),
      },
      expect.objectContaining({ uiMapId: 9999, mapId: 1, url: './local-maps/art/9999.webp', contentType: 'image/webp' }) as unknown,
    ]);
    expect(parseArtSection({}, LOCAL_GEOMETRY, './')).toEqual([]);
  });

  it('refuses the section for any malformed or disagreeing entry, naming it', async () => {
    const base = await artSection();
    const durotar = base['1411'] as Json;
    const edits: readonly [Json | string, RegExp][] = [
      [[] as unknown as Json, /^art must be an object keyed by UiMapID$/],
      [{ abc: durotar }, /^art\["abc"\]: the key must be a UiMapID$/],
      [{ '1411': { ...durotar, file: 'art/1412.png' } }, /^art\["1411"\]\.file must be art\/1411\.png or art\/1411\.webp$/],
      [{ '1411': { ...durotar, file: '../../etc/1411.png' } }, /\.file must be art\/1411\.png/],
      [{ '1411': { ...durotar, file: 'art/1411.jpg', contentType: 'image/jpeg' } }, /\.file must be/],
      [{ '1411': { ...durotar, contentType: 'image/webp' } }, /^art\["1411"\]\.contentType must be image\/png for art\/1411\.png$/],
      [{ '1411': { ...durotar, width: 6.5 } }, /width and height must be positive integers$/],
      [{ '1411': { ...durotar, sha256: 'x' } }, /\.sha256 must be a SHA-256 hex digest$/],
      [{ '1411': { ...durotar, bounds: { ...DUROTAR, xMin: '0' } } }, /\.bounds needs integer assignment and mapId and four finite edges$/],
      [{ '1411': { ...durotar, bounds: { ...DUROTAR, xMax: DUROTAR.xMax + 1e-9 } } }, /^art\["1411"\]\.bounds differ from UiMap 1411's row 46721 in the local geometry$/],
      [{ '1411': { ...durotar, bounds: { ...DUROTAR, mapId: 0 } } }, /bounds differ/],
      [{ '4242': { ...durotar, file: 'art/4242.png' } }, /^art\["4242"\]: UiMap 4242 is not in the local geometry$/],
      // Azeroth 947 has one row per continent: no single world rectangle to draw it on.
      [{ '947': { ...durotar, file: 'art/947.png' } }, /^art\["947"\]: UiMap 947 is not a single full-rectangle row/],
    ];
    for (const [section, message] of edits) expect(parseArtSection(section, LOCAL_GEOMETRY, './')).toMatch(message);
  });
});

describe('local art through loadGeometry', () => {
  it('lists the art of a compatible set without fetching any image at load', async () => {
    const server = await siteWithArt();
    const loaded = await load(server);
    expect(loaded.local.kind).toBe('compatible');
    expect(loaded.art.status).toEqual({ kind: 'listed', count: 2 });
    expect(loaded.art.entries.map((e) => [e.uiMapId, e.mapId, e.width, e.height])).toEqual([
      [1411, 1, 6, 4],
      [9999, 1, 4, 4],
    ]);
    expect(artRequests(server)).toEqual([]);
    expect(describeGeometry(loaded)).toMatch(/local set 1\.60\.1\.70009: compatible, 1 UiMaps added, art for 2 UiMaps \(verified when drawn\)$/);
  });

  it('verifies an image when it is first loaded, once, and hands over exactly the verified bytes', async () => {
    const server = await siteWithArt();
    const loaded = await load(server);
    const first = loaded.art.load(uiMapId(1411));
    expect(loaded.art.load(uiMapId(1411))).toBe(first);
    expect(await verified(await first)).toEqual(DUROTAR_PNG);
    const result = await first;
    expect(result.kind === 'verified' ? [result.blob.type, result.entry.uiMapId] : null).toEqual(['image/png', 1411]);
    expect(await verified(await loaded.art.load(uiMapId(9999)))).toEqual(ADDED_WEBP);
    await loaded.art.load(uiMapId(1411));
    expect(artRequests(server)).toEqual(['./local-maps/art/1411.png', './local-maps/art/9999.webp']);
    expect(server.requests.filter((r) => r.url.includes('local-maps/art/')).every((r) => r.cache === 'no-store')).toBe(true);
  });

  it('refuses an image changed after activation, and one that is not the image the manifest describes', async () => {
    const server = await siteWithArt();
    server.set('local-maps/art/1411.png', pngImage(6, 4, 1));
    const loaded = await load(server);
    expect(await loaded.art.load(uiMapId(1411))).toMatchObject({
      kind: 'refused',
      uiMapId: 1411,
      reason: 'changed',
      detail: expect.stringMatching(/^\.\/local-maps\/art\/1411\.png changed after the set was activated .*run tools\/maps validate --activate again$/) as unknown,
    });

    // The hash matches, but the manifest records another size: the manifest is wrong, so is the draw.
    const section = await artSection();
    const wrongSize = await load(await siteWithArt({ ...section, '1411': { ...(section['1411'] as Json), width: 7 } }));
    expect(await wrongSize.art.load(uiMapId(1411))).toMatchObject({
      reason: 'malformed',
      detail: './local-maps/art/1411.png is a 6 × 4 image/png, the manifest records 7 × 4 image/png',
    });
    const notAnImage = encoder.encode('not really an image');
    const junk = await siteWithArt({ ...section, '1411': { ...(section['1411'] as Json), sha256: await sha(notAnImage) } });
    junk.set('local-maps/art/1411.png', notAnImage);
    expect(await (await load(junk)).art.load(uiMapId(1411))).toMatchObject({ reason: 'malformed', detail: './local-maps/art/1411.png: not a PNG or WebP file' });
  });

  it('tries a missing or unreachable image again at the next load, and refuses a UiMap without art', async () => {
    const server = await siteWithArt();
    server.set('local-maps/art/9999.webp', null);
    const loaded = await load(server);
    expect(await loaded.art.load(uiMapId(9999))).toMatchObject({ kind: 'refused', reason: 'unavailable', detail: './local-maps/art/9999.webp: HTTP 404' });
    server.set('local-maps/art/9999.webp', ADDED_WEBP);
    expect(await verified(await loaded.art.load(uiMapId(9999)))).toEqual(ADDED_WEBP);
    expect(artRequests(server)).toEqual(['./local-maps/art/9999.webp', './local-maps/art/9999.webp']);

    const offline = await siteWithArt();
    offline.route((path) => (path.startsWith('local-maps/art/') ? new TypeError('Failed to fetch') : undefined));
    expect(await (await load(offline)).art.load(uiMapId(1411))).toMatchObject({ reason: 'unavailable', detail: './local-maps/art/1411.png: Failed to fetch' });
    expect(await loaded.art.load(uiMapId(1412))).toEqual({ kind: 'refused', uiMapId: 1412, reason: 'not-listed', detail: 'UiMap 1412 has no local art' });
  });

  it('refuses the whole art section when an entry disagrees with the geometry, and keeps the geometry', async () => {
    const section = await artSection();
    const server = await siteWithArt({ ...section, '9999': { ...(section['9999'] as Json), bounds: { ...ADDED, yMax: 150 } } });
    const loaded = await load(server);
    expect(loaded.local.kind).toBe('compatible');
    expect(loaded.geometry.maps.has(uiMapId(9999))).toBe(true);
    expect(loaded.art.status).toEqual({ kind: 'refused', detail: 'maps.manifest.json art["9999"].bounds differ from UiMap 9999\'s row 999001 in the local geometry' });
    expect(loaded.art.entries).toEqual([]);
    expect((await loaded.art.load(uiMapId(1411))).kind).toBe('refused');
    expect(describeGeometry(loaded)).toMatch(/compatible, 1 UiMaps added; local art refused \(maps\.manifest\.json art\["9999"\]\.bounds differ .*\)$/);
  });

  it('has no art without a compatible set, or when the manifest lists none', async () => {
    const plain = await load(fakeServer(SITE));
    expect(plain.art.status).toEqual({ kind: 'none', detail: 'no compatible local set' });
    expect(plain.art.entries).toEqual([]);
    expect(await plain.art.load(uiMapId(1411))).toMatchObject({ kind: 'refused', reason: 'not-listed' });

    // A frame mismatch keeps the placeholder: the listed art is not used either.
    const incompatible = await siteWithArt();
    const moved = localGeometryJson();
    const [row] = ((moved['maps'] as Record<string, Json>)['1412']?.['assignments'] ?? []) as Json[];
    if (row !== undefined) row['xMin'] = Number(row['xMin']) - 100;
    const movedBytes = encoder.encode(JSON.stringify(moved));
    incompatible.set('local-maps/geometry.local.json', movedBytes);
    incompatible.set(
      'local-maps/maps.manifest.json',
      JSON.stringify({ schema: 1, redistribution: 'local-only', set: 's', build: '1.60.1.70009', geometry: { file: 'geometry.local.json', sha256: await sha(movedBytes) }, art: await artSection() }),
    );
    const refused = await load(incompatible);
    expect(refused.local.kind).toBe('incompatible');
    expect(refused.art.status.kind).toBe('none');

    // A manifest written before art support (no `art`), or with an empty section.
    for (const art of [null, {}]) {
      const loaded = await load(await siteWithArt(art));
      expect(loaded.local.kind).toBe('compatible');
      expect(loaded.art.status).toEqual({ kind: 'none', detail: 'the local set lists no art' });
      expect(describeGeometry(loaded)).toMatch(/compatible, 1 UiMaps added$/);
    }
  });

  it('builds entry URLs from the app base', async () => {
    const art = createLocalArt(await artSection(), LOCAL_GEOMETRY, { fetch: fakeServer(SITE).fetch, baseUrl: '/forever', sha256: nodeSha256 });
    expect(art.entries.map((e) => e.url)).toEqual(['/forever/local-maps/art/1411.png', '/forever/local-maps/art/9999.webp']);
  });
});
