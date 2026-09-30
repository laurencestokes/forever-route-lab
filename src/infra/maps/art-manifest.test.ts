import { describe, expect, it } from 'vitest';
import { jsonOf, readDirectory } from '../../../tests/support/fake-fetch';
import { ART_MANIFEST_PATH, parseArtManifest } from './art-manifest';

/*
 * The committed art manifest (public/maps/art/manifest.json; D-033) parses, and the guards refuse
 * the ways a damaged or edited manifest could go wrong. Only the manifest is read: no test decodes
 * the art. Since step ATL.10 (D-042 O5) it lists only the images still drawn one at a time.
 */

type Json = Record<string, unknown>;
const SITE = readDirectory('public/maps/art', 'maps/art/');
const committed = (): Json => structuredClone(jsonOf(SITE, ART_MANIFEST_PATH)) as Json;
const files = (json: Json): Json[] => json['files'] as Json[];

describe('parseArtManifest', () => {
  it('reads the committed manifest: the five images still drawn one at a time since ATL.10 (D-042 O5), each with its world rectangle', () => {
    const parsed = parseArtManifest(committed(), './');
    if (typeof parsed === 'string') throw new Error(parsed);
    expect(parsed.owner).toBe('Blizzard Entertainment');
    expect(parsed.build).toBe('1.60.1.70009');
    // The three battlegrounds and Darkspear Islands (their own surfaces), and Zephras Isle (the atlas card's picture when the tiles cannot be used).
    expect(parsed.images.map((image) => [image.uiMapId, image.name, image.bounds.mapId])).toEqual([
      [1459, 'Alterac Valley', 30],
      [1460, 'Warsong Gulch', 489],
      [1461, 'Arathi Basin', 529],
      [2521, 'Zephras Isle', 2991],
      [2524, 'Darkspear Islands', 2997],
    ]);
    // Azeroth (947), the only image with no single rectangle, is no longer deployed.
    expect(parsed.unplaced).toEqual([]);
    const zephras = parsed.images.find((image) => image.uiMapId === 2521);
    expect(zephras).toMatchObject({
      name: 'Zephras Isle',
      uiMapType: 3,
      styleId: 1,
      bounds: { mapId: 2991, xMin: 1247.9169921875, xMax: 4956.25, yMin: -1331.25, yMax: 4231.25 },
      url: './maps/art/2521.webp',
      contentType: 'image/webp',
      width: 1002,
      height: 668,
    });
    // Every image the manifest lists is in the folder, and nothing else is.
    for (const image of parsed.images) expect(SITE.has(image.url.replace('./', ''))).toBe(true);
    expect([...SITE.keys()].sort()).toEqual([...parsed.images.map((image) => image.url.replace('./', '')), 'maps/art/NOTICE.md', 'maps/art/manifest.json'].sort());
  });

  it('joins file URLs to the app’s base', () => {
    const parsed = parseArtManifest(committed(), '/forever-route-lab/');
    if (typeof parsed === 'string') throw new Error(parsed);
    expect(parsed.images[0]?.url).toBe('/forever-route-lab/maps/art/1459.webp');
  });

  const refusals: readonly (readonly [string, (json: Json) => void, RegExp])[] = [
    ['not version 1', (json) => (json['schema'] = 2), /schema is not 1/],
    ['not map art', (json) => (json['kind'] = 'terrain-byproducts'), /kind is not map-art/],
    ['no owner', (json) => (json['artwork'] = {}), /artwork\.owner/],
    ['a path outside the folder', (json) => ((files(json)[1] as Json)['path'] = '../1460.webp'), /files\[1\]\.path/],
    ['a path for another UiMap', (json) => ((files(json)[1] as Json)['uiMapId'] = 1461), /files\[1\]\.uiMapId/],
    ['a repeated file', (json) => files(json).push(files(json)[1] as Json), /repeats 1460\.webp/],
    ['the wrong content type', (json) => ((files(json)[1] as Json)['contentType'] = 'image/png'), /contentType/],
    ['a size of zero', (json) => ((files(json)[1] as Json)['width'] = 0), /width and height/],
    ['a malformed hash', (json) => ((files(json)[1] as Json)['sha256'] = 'abc'), /sha256/],
    ['an empty rectangle', (json) => (((files(json)[1] as Json)['bounds'] as Json)['xMax'] = ((files(json)[1] as Json)['bounds'] as Json)['xMin']), /files\[1\]\.bounds is empty/],
    ['a rectangle without a world map', (json) => (((files(json)[1] as Json)['bounds'] as Json)['mapId'] = -1), /world map id/],
  ];

  it.each(refusals)('refuses the whole manifest for %s', (_, damage, message) => {
    const json = committed();
    damage(json);
    expect(parseArtManifest(json, './')).toMatch(message);
  });
});
