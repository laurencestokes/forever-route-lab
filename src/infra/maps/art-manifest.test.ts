import { describe, expect, it } from 'vitest';
import { jsonOf, readDirectory } from '../../../tests/support/fake-fetch';
import { ART_MANIFEST_PATH, parseArtManifest } from './art-manifest';

/*
 * The committed art manifest (public/maps/art/manifest.json; D-033) parses, and the guards refuse
 * the ways a damaged or edited manifest could go wrong. Only the manifest is read: no test decodes
 * the art.
 */

type Json = Record<string, unknown>;
const SITE = readDirectory('public/maps/art', 'maps/art/');
const committed = (): Json => structuredClone(jsonOf(SITE, ART_MANIFEST_PATH)) as Json;
const files = (json: Json): Json[] => json['files'] as Json[];

describe('parseArtManifest', () => {
  it('reads the committed manifest: 59 placeable images and Azeroth, which spans two world maps', () => {
    const parsed = parseArtManifest(committed(), './');
    if (typeof parsed === 'string') throw new Error(parsed);
    expect(parsed.owner).toBe('Blizzard Entertainment');
    expect(parsed.build).toBe('1.60.1.70009');
    expect(parsed.images).toHaveLength(59);
    expect(parsed.unplaced).toEqual([{ uiMapId: 947, name: 'Azeroth' }]);
    const durotar = parsed.images.find((image) => image.uiMapId === 1411);
    expect(durotar).toEqual({
      uiMapId: 1411,
      name: 'Durotar',
      uiMapType: 3,
      styleId: 1,
      bounds: { mapId: 1, xMin: -1716.6666259765625, xMax: 1808.333251953125, yMin: -7249.99951171875, yMax: -1962.4998779296875 },
      url: './maps/art/1411.webp',
      contentType: 'image/webp',
      width: 1002,
      height: 668,
      sha256: 'cbe6679f289e09a24b1c700766f38d85f81d33d6ab77d04ee813bd18e58b1756',
    });
    expect(parsed.images.map((image) => image.uiMapId)).toEqual([...parsed.images.map((image) => image.uiMapId)].sort((a, b) => a - b));
    // The continents and the alternative continents are type 2; the art layer tells them apart by the surface's extent.
    expect(parsed.images.filter((image) => image.uiMapType === 2).map((image) => image.uiMapId)).toEqual([1414, 1415, 1463, 1464]);
    // Every image the manifest lists is in the folder.
    for (const image of parsed.images) expect(SITE.has(image.url.replace('./', ''))).toBe(true);
  });

  it('joins file URLs to the app’s base', () => {
    const parsed = parseArtManifest(committed(), '/forever-route-lab/');
    if (typeof parsed === 'string') throw new Error(parsed);
    expect(parsed.images[0]?.url).toBe('/forever-route-lab/maps/art/1411.webp');
  });

  const refusals: readonly (readonly [string, (json: Json) => void, RegExp])[] = [
    ['not version 1', (json) => (json['schema'] = 2), /schema is not 1/],
    ['not map art', (json) => (json['kind'] = 'terrain-byproducts'), /kind is not map-art/],
    ['no owner', (json) => (json['artwork'] = {}), /artwork\.owner/],
    ['a path outside the folder', (json) => ((files(json)[1] as Json)['path'] = '../1411.webp'), /files\[1\]\.path/],
    ['a path for another UiMap', (json) => ((files(json)[1] as Json)['uiMapId'] = 1412), /files\[1\]\.uiMapId/],
    ['a repeated file', (json) => files(json).push(files(json)[1] as Json), /repeats 1411\.webp/],
    ['the wrong content type', (json) => ((files(json)[1] as Json)['contentType'] = 'image/png'), /contentType/],
    ['a size of zero', (json) => ((files(json)[1] as Json)['width'] = 0), /width and height/],
    ['a malformed hash', (json) => ((files(json)[1] as Json)['sha256'] = 'abc'), /sha256/],
    ['an empty rectangle', (json) => (((files(json)[1] as Json)['bounds'] as Json)['xMax'] = -1716.6666259765625), /files\[1\]\.bounds is empty/],
    ['a rectangle without a world map', (json) => (((files(json)[1] as Json)['bounds'] as Json)['mapId'] = -1), /world map id/],
  ];

  it.each(refusals)('refuses the whole manifest for %s', (_, damage, message) => {
    const json = committed();
    damage(json);
    expect(parseArtManifest(json, './')).toMatch(message);
  });
});
