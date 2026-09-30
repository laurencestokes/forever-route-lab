// @vitest-environment happy-dom
import type * as L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiMapId, WorldMapId } from '../../domain/ids';
import type { WorldPoint } from '../../domain/points';
import { TILE_MEMORY_BUDGET, type AtlasSurfaceInfo, type LayerContent, type LayerId, type MapDescriptor, type MapEvent, type SurfaceInfo, type WorldBounds, type WorldSurfaceInfo } from '../adapter';
import { bandFor, MINIMAP_TEMPLATE, styleOfUrl, syntheticIndex } from '../../../tests/support/atlas-tiles';
import type { DecodeImage } from './atlas-decoded';
import { AtlasTiles } from './atlas-tile-layer';
import { LeafletMapAdapter, type LeafletMapAdapterOptions, type Timeouts } from './LeafletMapAdapter';

/*
 * The two map styles through the Leaflet adapter (docs/research/map-atlas.md §21.2, §24.5; step
 * MM.1), in happy-dom as LeafletMapAdapter.atlas.test.ts runs it: one band per style, decoded keys
 * per band, the old picture held under the new one until the new first view has decoded (never the
 * bare container), the old band's kept buffer pruned at the switch, the sea colour and
 * `data-map-style` following the picture shown, and the decoded-tile budgets. Images decode, and
 * timers fire, when a test says so.
 */

const uiMapId = (value: number): UiMapId => value as UiMapId;
const worldMapId = (value: number): WorldMapId => value as WorldMapId;
const KALIMDOR = worldMapId(1);
const DARKSPEAR = worldMapId(2997);
const EK = worldMapId(0);
const RECT_1: WorldBounds = { mapId: KALIMDOR, xMin: -12800, xMax: 12266.700195312, yMin: -9600, yMax: 6933.2998046875 };
const RECT_0: WorldBounds = { mapId: EK, xMin: -16000, xMax: 6933.2998046875, yMin: -7466.7001953125, yMax: 8000 };

const world = (id: WorldSurfaceInfo['id'], mapId: WorldMapId, name: string, extent: WorldBounds): WorldSurfaceInfo => ({
  id,
  mapId,
  name,
  extent,
  extentSource: 'zone-union',
  extentUiMapId: null,
  uiMapIds: [],
});

/** The atlas with both continents placed as in the compact layout (LeafletMapAdapter.atlas.test.ts adds the Zephras Isle inset). */
const ATLAS: AtlasSurfaceInfo = {
  kind: 'atlas',
  id: 'atlas',
  mapId: KALIMDOR,
  name: 'Azeroth',
  extent: { mapId: KALIMDOR, xMin: 12778 - 26112, xMax: 12778, yMin: 5652 - 30720, yMax: 5652 },
  extentSource: 'atlas',
  extentUiMapId: null,
  uiMapIds: [],
  mapIds: [KALIMDOR, EK],
  placements: [
    {
      mapId: KALIMDOR,
      kind: 'placed',
      scale: 1,
      eOff: 5652,
      sOff: 12778,
      rect: RECT_1,
      source: { kind: 'placed', table: 'UiMapAssignment', uiMapId: uiMapId(947), row: 46785, build: '1.60.1.70009', layoutShift: { e: 0, s: 0 } },
    },
    {
      mapId: EK,
      kind: 'placed',
      scale: 1,
      eOff: 22499,
      sOff: 7907,
      rect: RECT_0,
      source: { kind: 'placed', table: 'UiMapAssignment', uiMapId: uiMapId(947), row: 46784, build: '1.60.1.70009', layoutShift: { e: 0, s: 0 } },
    },
  ],
  layout: {
    name: 'compact',
    worldMap: { uiMapId: uiMapId(947), artWidth: 1002, artHeight: 668, scaleMapId: KALIMDOR, source: 'UiMapArtStyleLayer (test copy)' },
    placed: [
      { mapId: KALIMDOR, side: 'west', shift: { e: -3072, s: -2048 } },
      { mapId: EK, side: 'east', shift: { e: -10240, s: -2048 } },
    ],
    insets: [],
    seamE: 16617,
    extent: { eMin: 0, eMax: 30720, sMin: 0, sMax: 26112 },
    basis: 'test copy of the compact layout',
  },
  hash: 'test',
  members: [world('world:1', KALIMDOR, 'Kalimdor', RECT_1), world('world:0', EK, 'Eastern Kingdoms', RECT_0)],
};
const SURFACES: readonly SurfaceInfo[] = [ATLAS, world('world:2997', DARKSPEAR, 'Darkspear Islands', { mapId: DARKSPEAR, xMin: -100, xMax: 100, yMin: -100, yMax: 100 })];

// Level −8 and every level −4 key stored in both styles; the painted style also stores level −5 (its
// underlay), the minimap level −6 (its underlay) and levels −3 and −2. The minimap's other keys are sea.
const allKeys = (nx: number, ny: number): (readonly [number, number])[] => Array.from({ length: nx * ny }, (_, k) => [k % nx, Math.floor(k / nx)] as const);
const PAINTED = bandFor(syntheticIndex({ hash: 'test', stored: { [-8]: [[0, 0]], [-5]: allKeys(4, 4), [-4]: allKeys(8, 7) } }));
const MINIMAP = bandFor(
  syntheticIndex({ hash: 'test', style: 'minimap', stored: { [-8]: [[0, 0]], [-6]: allKeys(2, 2), [-5]: allKeys(4, 4), [-4]: allKeys(8, 7), [-3]: allKeys(15, 13), [-2]: allKeys(30, 26) } }),
  MINIMAP_TEMPLATE,
  'minimap',
);
/** Atlas E 11,000, S 13,000 (inside Kalimdor's placement): x = sOff − S, y = eOff − E. */
const MIDDLE: WorldPoint = { mapId: KALIMDOR, x: 12778 - 13000, y: 5652 - 11000 };

const content = (layer: LayerId, items: readonly MapDescriptor[]): LayerContent => ({
  layer,
  items,
  stats: { drawn: items.length, notDrawn: 0, aggregated: 0, unresolved: 0, unresolvedBy: {}, otherSurfaces: 0 },
});

function fakeContext(): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = {};
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
      return () => undefined;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/** Images wait until the test decodes (or fails) them, by URL. */
function fakeDecoder() {
  const waiting = new Map<string, { resolve: () => void; reject: (error: Error) => void }[]>();
  const decode: DecodeImage = (image) =>
    new Promise<void>((resolve, reject) => {
      const url = image.getAttribute('src') ?? '';
      waiting.set(url, [...(waiting.get(url) ?? []), { resolve, reject }]);
    });
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  };
  /** Settles every waiting image of one style, in rounds (ancestors, then the underlay). */
  const settle = async (style: 'painted' | 'minimap', ok = true): Promise<void> => {
    for (let round = 0; round < 4; round += 1) {
      await flush();
      for (const [url, entries] of [...waiting]) {
        if (styleOfUrl(url) !== style) continue;
        waiting.delete(url);
        for (const entry of entries) {
          if (ok) entry.resolve();
          else entry.reject(new Error('404'));
        }
      }
      await flush();
    }
  };
  return { decode, settle, flush };
}

/** Timers the test fires. */
function fakeTimeouts() {
  let next = 1;
  const pending = new Map<number, { readonly callback: () => void; readonly ms: number }>();
  const timeouts: Timeouts = {
    set: (callback, ms) => {
      const handle = next;
      next += 1;
      pending.set(handle, { callback, ms });
      return handle;
    },
    clear: (handle) => {
      pending.delete(handle);
    },
  };
  /** Fires the timers set for exactly `ms`. */
  const fire = (ms: number): void => {
    for (const [handle, timer] of [...pending]) {
      if (timer.ms !== ms) continue;
      pending.delete(handle);
      timer.callback();
    }
  };
  return { timeouts, fire, delays: () => [...pending.values()].map((timer) => timer.ms).sort((a, b) => a - b) };
}

let sizes: { width: PropertyDescriptor | undefined; height: PropertyDescriptor | undefined };
let adapters: LeafletMapAdapter[];

const setSize = (width: number, height: number): void => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => height });
};

beforeEach(() => {
  adapters = [];
  const context = fakeContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context);
  sizes = {
    width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
    height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
  };
  setSize(800, 600);
});

afterEach(() => {
  for (const adapter of adapters) adapter.destroy();
  vi.restoreAllMocks();
  const restore = (key: 'clientWidth' | 'clientHeight', descriptor: PropertyDescriptor | undefined): void => {
    if (descriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, key);
    else Object.defineProperty(HTMLElement.prototype, key, descriptor);
  };
  restore('clientWidth', sizes.width);
  restore('clientHeight', sizes.height);
  document.body.innerHTML = '';
});

function setup(options: Partial<LeafletMapAdapterOptions> = {}) {
  const decoder = fakeDecoder();
  const clock = fakeTimeouts();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const adapter = new LeafletMapAdapter({ surfaces: SURFACES, initialSurface: 'atlas', observeResize: false, performance: null, decodeImage: decoder.decode, timeouts: clock.timeouts, ...options });
  adapters.push(adapter);
  const events: MapEvent[] = [];
  adapter.on('tiles', (event) => {
    events.push(event);
  });
  adapter.mount(host);
  adapter.setViewport({ center: MIDDLE, zoom: -4 });
  const map = (adapter as unknown as { map: L.Map | null }).map;
  if (map === null) throw new Error('not mounted');
  return { adapter, host, events, decoder, clock, map, container: host.querySelector<HTMLElement>('.frl-map') };
}

const tilesOf = (adapter: LeafletMapAdapter, id: string): AtlasTiles => {
  const found = (adapter as unknown as { layers: Record<LayerId, { drawn: Map<string, { leaflet: unknown }> }> }).layers.art.drawn.get(id)?.leaflet;
  if (!(found instanceof AtlasTiles)) throw new Error(`no band ${id}`);
  return found;
};
const elementsOf = (tiles: AtlasTiles): HTMLElement[] => [...(tiles.tiles.getContainer()?.querySelectorAll<HTMLElement>('.frl-atlas-tile') ?? [])];
const keysOf = (tiles: AtlasTiles): string[] => elementsOf(tiles).map((element) => element.dataset['key'] ?? '');
/** Keys whose element shows its decoded image (faded in, or shown at once). */
const shownKeys = (tiles: AtlasTiles): string[] =>
  elementsOf(tiles)
    .filter((element) => element.querySelector('img')?.classList.contains('frl-atlas-tile__img--in') === true)
    .map((element) => element.dataset['key'] ?? '')
    .sort();
const panes = (map: L.Map): Element[] => [...(map.getPane('frl-atlas')?.children ?? [])];

/** The keys of level `z` the view meets (Leaflet's `_pxBoundsToTileRange` over the pixel bounds). */
function viewKeys(map: L.Map, z: number): string[] {
  const bounds = map.getPixelBounds();
  const scale = 2 ** (z - map.getZoom());
  const [x0, y0] = [Math.floor(((bounds.min?.x ?? 0) * scale) / 256), Math.floor(((bounds.min?.y ?? 0) * scale) / 256)];
  const [x1, y1] = [Math.ceil(((bounds.max?.x ?? 0) * scale) / 256) - 1, Math.ceil(((bounds.max?.y ?? 0) * scale) / 256) - 1];
  const keys: string[] = [];
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) keys.push(`${String(z)}/${String(x)}/${String(y)}`);
  return keys.sort();
}

describe('LeafletMapAdapter: two styles and the switch (map-atlas.md §21.2, §24.5; MM.1)', () => {
  it('holds the old picture under the new one until the new first view has decoded and faded in: never the bare container', async () => {
    const s = setup();
    s.adapter.setLayer('art', content('art', [PAINTED]));
    await s.decoder.settle('painted');
    const painted = tilesOf(s.adapter, PAINTED.id);
    const inView = viewKeys(s.map, -4);
    expect(inView.length).toBeGreaterThan(0);
    expect(shownKeys(painted)).toEqual(expect.arrayContaining(inView));
    expect(s.container?.style.backgroundColor).toBe('rgb(61, 55, 41)');
    expect(s.container?.dataset['mapStyle']).toBe('painted');
    expect(s.events).toEqual([{ type: 'tiles', band: 'atlas-tiles:painted', style: 'painted', state: 'ready' }]);

    s.adapter.setLayer('art', content('art', [MINIMAP]));
    const minimap = tilesOf(s.adapter, MINIMAP.id);
    await s.decoder.flush();
    // Both bands are up, the new one above the old; the old one still shows every key in view, and
    // the sea and the palette's style are still its own.
    expect(panes(s.map)).toEqual([painted.tiles.getContainer(), minimap.tiles.getContainer()]);
    expect(s.adapter.renderStats().tiles).toEqual({ band: 'atlas-tiles:minimap', held: 'atlas-tiles:painted' });
    expect(shownKeys(painted)).toEqual(expect.arrayContaining(inView));
    expect(shownKeys(minimap)).toEqual([]);
    expect(s.container?.style.backgroundColor).toBe('rgb(61, 55, 41)');
    expect(s.adapter.renderStats().style).toBe('painted');

    // The new first view decodes; its images fade in (150 ms) over the old picture, which then goes.
    await s.decoder.settle('minimap');
    expect(shownKeys(minimap)).toEqual(expect.arrayContaining(inView));
    expect(s.map.hasLayer(painted)).toBe(true);
    expect(s.clock.delays()).toEqual([150, 2000]);
    s.clock.fire(150);
    expect(s.map.hasLayer(painted)).toBe(false);
    expect(panes(s.map)).toEqual([minimap.tiles.getContainer()]);
    expect(s.clock.delays()).toEqual([]);
    expect(s.container?.style.backgroundColor).toBe('rgb(13, 27, 48)');
    expect(s.container?.dataset['mapStyle']).toBe('minimap');
    expect(s.adapter.renderStats()).toMatchObject({ style: 'minimap', tiles: { band: 'atlas-tiles:minimap', held: null } });
    expect(s.events.at(-1)).toEqual({ type: 'tiles', band: 'atlas-tiles:minimap', style: 'minimap', state: 'ready' });
    // Its own underlay, level −6, loaded after its own first view: 4 images.
    expect(minimap.underlay.keys()).toEqual(['-6/0/0', '-6/1/0', '-6/0/1', '-6/1/1']);
    expect(minimap.underlay.loaded).toBe(true);
  });

  it('never starts a tile from the other style’s decoded key', async () => {
    const s = setup();
    s.adapter.setLayer('art', content('art', [PAINTED]));
    await s.decoder.settle('painted');
    s.adapter.setLayer('art', content('art', [MINIMAP]));
    await s.decoder.flush();
    const minimap = tilesOf(s.adapter, MINIMAP.id);
    // The painted keys at levels −8, −5 and −4 have decoded; no minimap tile starts as their crop,
    // nor as a minimap ancestor's (none has decoded yet).
    expect(elementsOf(minimap).length).toBeGreaterThan(0);
    for (const element of elementsOf(minimap)) expect(element.style.backgroundImage, element.dataset['key']).toBe('');
    // Once the minimap's own keys have decoded, a finer tile starts from them.
    await s.decoder.settle('minimap');
    s.clock.fire(150);
    s.adapter.setViewport({ center: MIDDLE, zoom: -3 });
    await s.decoder.flush();
    const crops = elementsOf(minimap)
      .filter((element) => element.dataset['key']?.startsWith('-3/') === true)
      .map((element) => element.style.backgroundImage);
    expect(crops.length).toBeGreaterThan(0);
    for (const crop of crops) {
      expect(crop).toContain('/maps/minimap/t/-4/');
      expect(crop).not.toContain('/maps/atlas/');
    }
  });

  it('removes the old band’s tiles outside the view when the switch starts, and it keeps none while held', async () => {
    const s = setup();
    s.adapter.setLayer('art', content('art', [PAINTED]));
    await s.decoder.settle('painted');
    // Two tiles east: the tiles left behind are kept (the painted band's keepBuffer 2, Leaflet's default).
    s.map.panBy([512, 0], { animate: false });
    await s.decoder.settle('painted');
    const painted = tilesOf(s.adapter, PAINTED.id);
    const inView = viewKeys(s.map, -4);
    expect(keysOf(painted).filter((key) => !inView.includes(key)).length).toBeGreaterThan(0);
    s.adapter.setLayer('art', content('art', [MINIMAP]));
    expect(keysOf(painted).sort()).toEqual(inView);
    expect((painted.tiles.options as L.GridLayerOptions).keepBuffer).toBe(0);
    // The minimap band keeps one row and column around the view (§24.5).
    expect((tilesOf(s.adapter, MINIMAP.id).tiles.options as L.GridLayerOptions).keepBuffer).toBe(1);
  });

  it('lets the old band go after 2 s when the new first view has not decoded, and at once when nothing replaces it', async () => {
    const s = setup();
    s.adapter.setLayer('art', content('art', [PAINTED]));
    await s.decoder.settle('painted');
    const painted = tilesOf(s.adapter, PAINTED.id);
    s.adapter.setLayer('art', content('art', [MINIMAP]));
    expect(s.map.hasLayer(painted)).toBe(true);
    s.clock.fire(2000);
    expect(s.map.hasLayer(painted)).toBe(false);
    expect(s.adapter.renderStats().tiles.held).toBeNull();
    // Another switch, then the atlas left for a world surface: the held band goes with it.
    await s.decoder.settle('minimap');
    s.adapter.setLayer('art', content('art', [PAINTED]));
    expect(s.adapter.renderStats().tiles.held).toBe('atlas-tiles:minimap');
    s.adapter.setSurface('world:2997');
    expect(s.adapter.renderStats().tiles).toEqual({ band: null, held: null });
    expect(s.clock.delays()).toEqual([]);
    expect(s.container?.style.backgroundColor).toBe('');
    // Hiding the art layer drops a held band too.
    s.adapter.setSurface('atlas');
    await s.decoder.settle('painted');
    s.adapter.setLayer('art', content('art', [MINIMAP]));
    expect(s.adapter.renderStats().tiles.held).toBe('atlas-tiles:painted');
    s.adapter.toggleLayer('art', false);
    expect(s.adapter.renderStats().tiles.held).toBeNull();
  });

  it('reports a band whose first view failed, keeps the old picture meanwhile, and takes the old style back without a hole', async () => {
    const s = setup();
    s.adapter.setLayer('art', content('art', [PAINTED]));
    await s.decoder.settle('painted');
    const painted = tilesOf(s.adapter, PAINTED.id);
    s.adapter.setLayer('art', content('art', [MINIMAP]));
    // A build without the minimap tile pack: every image of the first view fails.
    await s.decoder.settle('minimap', false);
    expect(s.events.at(-1)).toEqual({ type: 'tiles', band: 'atlas-tiles:minimap', style: 'minimap', state: 'failed' });
    expect(s.map.hasLayer(painted)).toBe(true);
    expect(s.clock.delays()).toEqual([2000]);
    // The controller then draws the painted band again: the failed band goes at once; the held one
    // stays until the new painted band's first view is up (its keys decoded already: at once).
    s.adapter.setLayer('art', content('art', [PAINTED]));
    const again = tilesOf(s.adapter, PAINTED.id);
    expect(again).not.toBe(painted);
    expect(s.map.hasLayer(painted)).toBe(true);
    await s.decoder.flush();
    expect(shownKeys(again)).toEqual(expect.arrayContaining(viewKeys(s.map, -4)));
    s.clock.fire(150);
    expect(s.map.hasLayer(painted)).toBe(false);
    expect(panes(s.map)).toEqual([again.tiles.getContainer()]);
    expect(s.container?.dataset['mapStyle']).toBe('painted');
  });

  it('opens with the chosen style on the container, before any band is drawn (the minimap by default since MM.9)', () => {
    const s = setup({ style: 'painted' });
    expect(s.container?.dataset['mapStyle']).toBe('painted');
    expect(s.adapter.renderStats()).toMatchObject({ style: 'painted', tiles: { band: null, held: null } });
    expect(setup().container?.dataset['mapStyle']).toBe('minimap');
  });

  it('keeps the minimap’s decoded tiles within the budgets of §24.5 in a 918 × 700 panel, panned and switched', async () => {
    // The worst view of §24.5: a 918 × 700 panel just above a half level, where Leaflet draws level −2
    // at 0.71×, spans 1,298 × 990 px of that level. Leaflet snaps to whole levels without 3D
    // transforms (happy-dom), so the same span is set up as a 1,298 × 990 stage at level −2.
    setSize(1298, 990);
    const s = setup();
    s.adapter.setViewport({ center: MIDDLE, zoom: -2 });
    s.adapter.setLayer('art', content('art', [MINIMAP]));
    await s.decoder.settle('minimap');
    const minimap = tilesOf(s.adapter, MINIMAP.id);
    const levelKeys = (): string[] => keysOf(minimap).filter((key) => key.startsWith('-2/'));
    expect(levelKeys().length).toBeLessThanOrEqual(35);
    let most = 0;
    for (const [dx, dy] of [
      [300, 0],
      [0, 300],
      [-300, 0],
      [-300, 0],
      [0, -300],
      [0, -300],
    ] as const) {
      s.map.panBy([dx, dy], { animate: false });
      await s.decoder.settle('minimap');
      most = Math.max(most, levelKeys().length);
      const memory = s.adapter.tileMemory();
      expect(memory.budget).toBe(TILE_MEMORY_BUDGET.liveBytes);
      expect(memory.bytes).toBeLessThanOrEqual(TILE_MEMORY_BUDGET.liveBytes);
    }
    // keepBuffer 1: more than one view after pans, at most 9 × 7 tiles (plus the underlay's 4).
    expect(most).toBeGreaterThan(35);
    expect(most).toBeLessThanOrEqual(63);
    // A switch to the painted style prunes the minimap's buffer: at most two views and both underlays.
    s.adapter.setLayer('art', content('art', [PAINTED]));
    const during = s.adapter.tileMemory();
    expect(during.budget).toBe(TILE_MEMORY_BUDGET.switchBytes);
    expect(during.bytes).toBeLessThanOrEqual(TILE_MEMORY_BUDGET.switchBytes);
    expect(levelKeys().length).toBeLessThanOrEqual(35);
  });
});
