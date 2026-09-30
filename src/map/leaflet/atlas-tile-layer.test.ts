// @vitest-environment happy-dom
import * as L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bandFor, keyOfUrl, MINIMAP_TEMPLATE, syntheticIndex } from '../../../tests/support/atlas-tiles';
import { isStoredTile, type AtlasTileIndex, type TileBandDescriptor } from '../adapter';
import { DecodedTiles, tileKey, type DecodeImage } from './atlas-decoded';
import { AtlasTiles } from './atlas-tile-layer';

/*
 * The atlas tile layer and underlay in happy-dom (docs/research/map-atlas.md §7.2, §8.3; step
 * ATL.7): which keys make elements and requests, the ancestor-first crops, the fades, and the
 * underlay's keys and transforms. Images are "decoded" when a test says so (a fake `decode`).
 */

// Level −8: its one key. Level −5 (4 × 4): six stored keys, three sea keys (the bottom row, as the
// committed build has them), the rest virtual. Level −4: one stored key, (2, 3). Level −2 (30 × 26):
// (11, 7) sea, (10, 6) stored.
const INDEX: AtlasTileIndex = syntheticIndex({
  stored: {
    [-8]: [[0, 0]],
    [-5]: [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    [-4]: [[2, 3]],
    [-2]: [[10, 6]],
  },
  sea: { [-5]: [[0, 3], [2, 3], [3, 3]], [-2]: [[11, 7]] },
});
const BAND: TileBandDescriptor = bandFor(INDEX);

/** A fake decoder: every image waits until the test decodes (or fails) its URL. */
function fakeDecoder() {
  const waiting = new Map<string, { resolve: () => void; reject: (error: Error) => void }[]>();
  const requested: string[] = [];
  const decode: DecodeImage = (image) =>
    new Promise<void>((resolve, reject) => {
      const url = image.getAttribute('src') ?? '';
      requested.push(url);
      waiting.set(url, [...(waiting.get(url) ?? []), { resolve, reject }]);
    });
  const settle = async (key: string, ok = true): Promise<void> => {
    for (const [url, entries] of waiting) {
      if (keyOfUrl(url) !== key) continue;
      waiting.delete(url);
      for (const entry of entries) {
        if (ok) entry.resolve();
        else entry.reject(new Error('failed'));
      }
    }
    await flush();
  };
  const settleAll = async (): Promise<void> => {
    for (const url of [...waiting.keys()]) await settle(keyOfUrl(url) ?? '');
  };
  return { decode, requested, settle, settleAll, pending: () => [...waiting.keys()].map((url) => keyOfUrl(url)) };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

let sizes: { width: PropertyDescriptor | undefined; height: PropertyDescriptor | undefined };
let maps: L.Map[];

beforeEach(() => {
  maps = [];
  sizes = {
    width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
    height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
  };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
});

afterEach(() => {
  for (const map of maps) map.remove();
  const restore = (key: 'clientWidth' | 'clientHeight', descriptor: PropertyDescriptor | undefined): void => {
    if (descriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, key);
    else Object.defineProperty(HTMLElement.prototype, key, descriptor);
  };
  restore('clientWidth', sizes.width);
  restore('clientHeight', sizes.height);
  document.body.innerHTML = '';
});

/** A CRS.Simple map (atlas `latLng = (−S, E)`) with the tiles' panes, at (E, S) and a zoom. */
function mapAt(e: number, s: number, zoom: number): L.Map {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const map = L.map(element, { crs: L.CRS.Simple, minZoom: -8, maxZoom: 2, zoomSnap: 0, fadeAnimation: false, zoomAnimation: false });
  for (const [name, z] of [
    ['frl-underlay', '244'],
    ['frl-atlas', '245'],
  ] as const) {
    map.createPane(name).style.zIndex = z;
  }
  map.setView([0 - s, e], zoom, { animate: false });
  maps.push(map);
  return map;
}

function addTiles(map: L.Map, options: { readonly fade?: boolean; readonly decoded?: DecodedTiles } = {}) {
  const decoder = fakeDecoder();
  const tiles = new AtlasTiles(BAND, { decoded: options.decoded ?? new DecodedTiles(), fade: options.fade ?? true, maxZoom: 2, decodeImage: decoder.decode });
  tiles.addTo(map);
  return { tiles, decoder };
}

const tileElements = (map: L.Map): HTMLElement[] => [...map.getContainer().querySelectorAll<HTMLElement>('.frl-atlas-tile')];
const tileOf = (map: L.Map, key: string): HTMLElement | undefined => tileElements(map).find((element) => element.dataset['key'] === key);
const keysOf = (map: L.Map): string[] => tileElements(map).map((element) => element.dataset['key'] ?? '').sort();

/** Every URL the layer put in the page: image sources and background crops. */
function urlsIn(map: L.Map): string[] {
  const container = map.getContainer();
  const sources = [...container.querySelectorAll('img')].map((image) => image.getAttribute('src') ?? '').filter((src) => src !== '');
  const backgrounds = tileElements(map)
    .map((element) => /url\("?([^")]+)"?\)/.exec(element.style.backgroundImage)?.[1] ?? '')
    .filter((url) => url !== '');
  return [...sources, ...backgrounds];
}

const isStoredKey = (key: string | null): boolean => {
  if (key === null) return false;
  const [z, x, y] = key.split('/').map(Number);
  return z !== undefined && x !== undefined && y !== undefined && isStoredTile(INDEX, z, x, y);
};

describe('AtlasTileLayer (map-atlas.md §7.2, §8.3)', () => {
  it('makes no element for a sea key and no request for a key the index does not list', async () => {
    // Zoom −5 over the lower half of the extent: the level −5 sea keys (0, 3), (2, 3) and (3, 3) are in view.
    const map = mapAt(15360, 20000, -5);
    const { tiles, decoder } = addTiles(map);
    await flush();
    const keys = keysOf(map);
    expect(keys.length).toBeGreaterThan(0);
    for (const sea of ['-5/0/3', '-5/2/3', '-5/3/3']) expect(keys).not.toContain(sea);
    // Every key with an element is stored or virtual; every URL built names a stored key.
    for (const url of [...urlsIn(map), ...decoder.requested]) expect(isStoredKey(keyOfUrl(url)), url).toBe(true);
    expect(tiles.tiles.counts().created).toBe(keys.length);
    // (1, 3) is virtual (from level −8): an element, but no request of its own.
    expect(keys).toContain('-5/1/3');
    expect(decoder.requested.map(keyOfUrl)).not.toContain('-5/1/3');
  });

  it('makes no element for a fine key over a level −2 sea key', async () => {
    // Level −2 key (11, 7) is sea: its level −1 children (22…23, 14…15) make no element.
    const map = mapAt(11 * 1024 + 512, 7 * 1024 + 512, -1);
    addTiles(map);
    await flush();
    const keys = keysOf(map);
    for (const key of ['-1/22/14', '-1/23/14', '-1/22/15', '-1/23/15']) expect(keys).not.toContain(key);
    // Its neighbour over the stored level −2 key (10, 6) is virtual and drawn.
    expect(keys).toContain('-1/21/13');
  });

  it('draws a virtual key from its nearest stored ancestor once that has decoded', async () => {
    // Level −4 key (2, 2): not stored; its level −5 ancestor (1, 1) is: a 2× crop, the (0, 0)-th child.
    const map = mapAt(2 * 4096 + 2048, 2 * 4096 + 2048, -4);
    const { decoder } = addTiles(map);
    await flush();
    const tile = tileOf(map, '-4/2/2');
    expect(tile?.style.backgroundImage ?? '').toBe('');
    expect(decoder.pending()).toContain('-5/1/1');
    await decoder.settle('-5/1/1');
    expect(tile?.style.backgroundImage).toContain('/t/-5/1/1.webp');
    expect(tile?.style.backgroundSize).toBe('512px 512px');
    expect(tile?.style.backgroundPosition).toBe('0px 0px');
    // Key (3, 2) is the (1, 0)-th child of the same ancestor.
    expect(tileOf(map, '-4/3/2')?.style.backgroundPosition).toBe('-256px 0px');
  });

  it('starts a stored key as the crop of its nearest ancestor already decoded, then fades its own image in', async () => {
    const decoded = new DecodedTiles();
    decoded.add(tileKey(-5, 1, 1));
    decoded.add(tileKey(-8, 0, 0));
    // Level −4 key (2, 3) is stored; its level −5 ancestor (1, 1) is decoded, so it starts as that crop.
    const map = mapAt(2 * 4096 + 2048, 3 * 4096 + 2048, -4);
    const { decoder } = addTiles(map, { decoded });
    await flush();
    const tile = tileOf(map, '-4/2/3');
    expect(tile?.style.backgroundImage).toContain('/t/-5/1/1.webp');
    expect(tile?.style.backgroundPosition).toBe('0px -256px');
    const image = tile?.querySelector('img');
    expect(image?.getAttribute('alt')).toBe('');
    expect(image?.getAttribute('src')).toContain('/t/-4/2/3.webp');
    expect(image?.classList.contains('frl-atlas-tile__img--in')).toBe(false);
    await decoder.settle('-4/2/3');
    expect(image?.classList.contains('frl-atlas-tile__img--in')).toBe(true);
    expect(decoded.has('-4/2/3')).toBe(true);
    // The crop stays under the fading image; tiles are hidden from assistive technology.
    expect(tile?.style.backgroundImage).toContain('/t/-5/1/1.webp');
    expect(tile?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows an image already decoded at once, without a fade', async () => {
    const decoded = new DecodedTiles();
    decoded.add(tileKey(-4, 2, 3));
    const map = mapAt(2 * 4096 + 2048, 3 * 4096 + 2048, -4);
    addTiles(map, { decoded });
    await flush();
    const image = tileOf(map, '-4/2/3')?.querySelector('img');
    expect(image?.classList.contains('frl-atlas-tile__img--in')).toBe(true);
    expect(image?.classList.contains('frl-atlas-tile__img--now')).toBe(true);
  });

  it('disables the fade under reduced motion', async () => {
    const map = mapAt(2 * 4096 + 2048, 3 * 4096 + 2048, -4);
    const { tiles, decoder } = addTiles(map, { fade: false });
    await flush();
    expect(tiles.tiles.getContainer()?.classList.contains('frl-atlas--still')).toBe(true);
    await decoder.settle('-4/2/3');
    const tile = tileOf(map, '-4/2/3');
    expect(tile?.querySelector('img')?.classList.contains('frl-atlas-tile__img--in')).toBe(true);
    // No fade: the crop under the image is dropped at once.
    expect(tile?.style.backgroundImage).toBe('');
    const faded = mapAt(2 * 4096 + 2048, 3 * 4096 + 2048, -4);
    const withFade = addTiles(faded, { fade: true });
    expect(withFade.tiles.tiles.getContainer()?.classList.contains('frl-atlas--still')).toBe(false);
  });

  it('keeps the crop when a stored image fails, and counts the failure', async () => {
    const decoded = new DecodedTiles();
    decoded.add(tileKey(-5, 1, 1));
    const map = mapAt(2 * 4096 + 2048, 3 * 4096 + 2048, -4);
    const { tiles, decoder } = addTiles(map, { decoded });
    await flush();
    await decoder.settle('-4/2/3', false);
    const tile = tileOf(map, '-4/2/3');
    expect(tile?.style.backgroundImage).toContain('/t/-5/1/1.webp');
    expect(tile?.querySelector('img')?.classList.contains('frl-atlas-tile__img--in')).toBe(false);
    expect(tiles.tiles.counts().failed).toBe(1);
    expect(decoded.has('-4/2/3')).toBe(false);
  });
});

describe('AtlasUnderlay (map-atlas.md §8.3, MA-01)', () => {
  it('holds an image for every stored level −5 key, at its level −5 pixel position, loaded after the first view has decoded', async () => {
    const map = mapAt(15360, 13056, -5.2);
    const { tiles, decoder } = addTiles(map);
    await flush();
    const underlay = tiles.underlay;
    expect(underlay.keys()).toEqual(['-5/0/0', '-5/1/0', '-5/2/0', '-5/0/1', '-5/1/1', '-5/2/1']);
    const images = [...map.getContainer().querySelectorAll<HTMLImageElement>('.frl-atlas-underlay__img')];
    expect(images).toHaveLength(6);
    // In its own pane, under the tile layer's.
    expect(map.getPane('frl-underlay')?.querySelectorAll('.frl-atlas-underlay__img')).toHaveLength(6);
    expect(map.getPane('frl-atlas')?.querySelector('.frl-atlas')).not.toBeNull();
    expect(images.map((image) => [image.style.left, image.style.top])).toEqual([
      ['0px', '0px'],
      ['256px', '0px'],
      ['512px', '0px'],
      ['0px', '256px'],
      ['256px', '256px'],
      ['512px', '256px'],
    ]);
    expect(images.every((image) => image.getAttribute('alt') === '')).toBe(true);
    // Not loaded while the first view's images decode.
    expect(underlay.loaded).toBe(false);
    expect(images.some((image) => image.getAttribute('src') !== null)).toBe(false);
    await decoder.settleAll();
    await flush();
    expect(underlay.loaded).toBe(true);
    expect(images.map((image) => keyOfUrl(image.getAttribute('src') ?? ''))).toEqual(underlay.keys());
  });

  it('sets one transform per zoom, viewreset and zoomanim event: translate by the pixel origin, scale 2^(zoom + 5)', async () => {
    const map = mapAt(15360, 13056, -5);
    const { tiles } = addTiles(map);
    await flush();
    const underlay = tiles.underlay;
    const container = map.getContainer().querySelector<HTMLElement>('.frl-atlas-underlay');
    const before = underlay.transforms();
    map.fire('zoom');
    expect(underlay.transforms()).toBe(before + 1);
    map.fire('viewreset');
    expect(underlay.transforms()).toBe(before + 2);
    map.fire('zoomanim', { center: map.getCenter(), zoom: -3, noUpdate: false });
    expect(underlay.transforms()).toBe(before + 3);
    expect(container?.style.transform).toContain('scale(4)');
    // A move without a zoom sets none.
    map.fire('move');
    expect(underlay.transforms()).toBe(before + 3);
    // A view reset that changes the zoom fires `zoom` and `viewreset`: one transform each, at scale 2^(−4 + 5).
    const reset = underlay.transforms();
    map.setView(map.getCenter(), -4, { animate: false });
    expect(underlay.transforms()).toBe(reset + 2);
    const origin = map.getPixelOrigin();
    expect(container?.style.transform).toBe(`translate3d(${String(-origin.x)}px,${String(-origin.y)}px,0) scale(2)`);
  });

  it('registers its decoded images, so tiles can start as their crops', async () => {
    const decoded = new DecodedTiles();
    const map = mapAt(15360, 13056, -5.2);
    const { tiles, decoder } = addTiles(map, { decoded });
    await flush();
    await decoder.settleAll();
    await flush();
    expect(tiles.underlay.loaded).toBe(true);
    await decoder.settleAll();
    for (const key of tiles.underlay.keys()) expect(decoded.has(key), key).toBe(true);
  });
});

// Review MR-05: a first view that asks for no image (all sea) was counted as ready, so a clone
// without the minimap pack showed navy and broken images with no fallback.
describe('a first view over the sea (review MR-05)', () => {
  // The minimap's shape: every key not stored is sea. Level −6 (the underlay) and one level −2 key in the north-west corner.
  const SEA_INDEX = syntheticIndex({ style: 'minimap', stored: { [-6]: [[0, 0], [1, 0]], [-2]: [[0, 0]] } });
  const SEA_BAND = bandFor(SEA_INDEX, MINIMAP_TEMPLATE, 'minimap');

  function overSea() {
    // Level −2 over the south-east of the extent: every key there is sea.
    const map = mapAt(25000, 20000, -2);
    const decoder = fakeDecoder();
    const tiles = new AtlasTiles(SEA_BAND, { decoded: new DecodedTiles(), fade: true, maxZoom: 2, decodeImage: decoder.decode });
    tiles.addTo(map);
    const firsts: string[] = [];
    tiles.onFirstView((first) => firsts.push(first));
    return { map, tiles, decoder, firsts };
  }

  it('is decided by the underlay: failed when every underlay image fails (no pack)', async () => {
    const s = overSea();
    await flush();
    expect(tileElements(s.map)).toHaveLength(0);
    expect(s.tiles.tiles.counts().asked).toBe(0);
    // Not ready yet: the underlay is asked instead.
    expect(s.tiles.firstView).toBeNull();
    expect(s.decoder.pending().sort()).toEqual(['-6/0/0', '-6/1/0']);
    await s.decoder.settle('-6/0/0', false);
    expect(s.tiles.firstView).toBeNull();
    await s.decoder.settle('-6/1/0', false);
    await flush();
    expect(s.tiles.firstView).toBe('failed');
    expect(s.firsts).toEqual(['failed']);
    expect(s.tiles.underlay.counts()).toEqual({ asked: 2, decoded: 0, failed: 2 });
  });

  it('is ready once an underlay image decodes', async () => {
    const s = overSea();
    await flush();
    await s.decoder.settle('-6/0/0');
    await s.decoder.settle('-6/1/0', false);
    await flush();
    expect(s.tiles.firstView).toBe('ready');
    expect(s.firsts).toEqual(['ready']);
  });

  it('is decided by the tiles as before when the view asks for some', async () => {
    const map = mapAt(128, 128, -2);
    const decoder = fakeDecoder();
    const tiles = new AtlasTiles(SEA_BAND, { decoded: new DecodedTiles(), fade: true, maxZoom: 2, decodeImage: decoder.decode });
    tiles.addTo(map);
    await flush();
    expect(tiles.tiles.counts().asked).toBe(1);
    await decoder.settle('-2/0/0', false);
    await flush();
    expect(tiles.firstView).toBe('failed');
  });
});

// Review MR-08 and MR-09: the memory measure counted only `<img>` elements, crops stayed under
// every faded-in image, and a key already decoded started with no crop at all.
describe('crops and the memory measure (reviews MR-08, MR-09)', () => {
  it('counts the ancestors held only as crops, one picture per file', async () => {
    // Level −4 over the level −5 ancestor (1, 1): every in-view key is virtual or stored below it.
    const map = mapAt(2 * 4096 + 2048, 2 * 4096 + 2048, -4);
    const { tiles, decoder } = addTiles(map);
    await flush();
    await decoder.settle('-5/1/1');
    const crops = new Set(tileElements(map).flatMap((tile) => (tile.dataset['crop'] === undefined ? [] : [tile.dataset['crop']])));
    expect(crops.size).toBeGreaterThan(0);
    // No `<img>` holds the ancestor: it was decoded off screen.
    const sources = new Set([...map.getContainer().querySelectorAll('img')].map((image) => image.getAttribute('src') ?? '').filter((src) => src !== ''));
    for (const crop of crops) expect(sources.has(crop)).toBe(false);
    expect(tiles.liveImages()).toBe(new Set([...sources, ...crops]).size);
  });

  it('drops a crop once the image over it has faded in', async () => {
    const decoded = new DecodedTiles();
    decoded.add(tileKey(-5, 1, 1));
    const map = mapAt(2 * 4096 + 2048, 3 * 4096 + 2048, -4);
    const { decoder } = addTiles(map, { decoded });
    await flush();
    const tile = tileOf(map, '-4/2/3');
    await decoder.settle('-4/2/3');
    // During the fade the crop stays under the image…
    expect(tile?.style.backgroundImage).toContain('/t/-5/1/1.webp');
    expect(tile?.dataset['crop']).toContain('/t/-5/1/1.webp');
    // …and goes when its transition ends.
    tile?.querySelector('img')?.dispatchEvent(new Event('transitionend'));
    expect(tile?.style.backgroundImage).toBe('');
    expect(tile?.dataset['crop']).toBeUndefined();
  });

  it('starts a key already decoded from its nearest crop too, until its own image has loaded', async () => {
    const decoded = new DecodedTiles();
    decoded.add(tileKey(-5, 1, 1));
    decoded.add(tileKey(-4, 2, 3));
    const map = mapAt(2 * 4096 + 2048, 3 * 4096 + 2048, -4);
    addTiles(map, { decoded });
    await flush();
    const tile = tileOf(map, '-4/2/3');
    const image = tile?.querySelector('img');
    expect(image?.classList.contains('frl-atlas-tile__img--now')).toBe(true);
    expect(tile?.style.backgroundImage).toContain('/t/-5/1/1.webp');
    image?.dispatchEvent(new Event('load'));
    expect(tile?.style.backgroundImage).toBe('');
  });
});
