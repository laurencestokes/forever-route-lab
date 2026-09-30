// @vitest-environment happy-dom
import type * as L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StepId, UiMapId, WorldMapId } from '../../domain/ids';
import type { WorldPoint } from '../../domain/points';
import type {
  AtlasLayout,
  AtlasPlacement,
  AtlasSurfaceInfo,
  ConnectorDescriptor,
  FrameDescriptor,
  LayerContent,
  LayerId,
  MapDescriptor,
  MapEvent,
  MarkerDescriptor,
  SurfaceInfo,
  WorldBounds,
  WorldSurfaceInfo,
} from '../adapter';
import { bandFor, syntheticIndex } from '../../../tests/support/atlas-tiles';
import type { DecodeImage } from './atlas-decoded';
import { AtlasTiles } from './atlas-tile-layer';
import { ConnectorArc, FrameRectangle, type GridLayer, type MeasuredCanvas } from './leaflet-layers';
import { LeafletMapAdapter, type LeafletMapAdapterOptions } from './LeafletMapAdapter';

/*
 * The atlas surface through the Leaflet adapter (docs/research/map-atlas.md §5, §8.1, §8.5; steps
 * ATL.3 and ATL.5), in happy-dom as LeafletMapAdapter.test.ts runs it (a recording canvas, a fixed
 * container size). map/leaflet may import only map/adapter values, so the compact layout's
 * placements are written out here as the plain data the controller passes (src/geo/atlas.test.ts
 * pins them from the committed rows).
 */

const stepId = (value: string): StepId => value as StepId;
const uiMapId = (value: number): UiMapId => value as UiMapId;
const worldMapId = (value: number): WorldMapId => value as WorldMapId;

const KALIMDOR = worldMapId(1);
const EK = worldMapId(0);
const ZEPHRAS = worldMapId(2991);
const DARKSPEAR = worldMapId(2997);

const RECT_1: WorldBounds = { mapId: KALIMDOR, xMin: -12800, xMax: 12266.700195312, yMin: -9600, yMax: 6933.2998046875 };
const RECT_0: WorldBounds = { mapId: EK, xMin: -16000, xMax: 6933.2998046875, yMin: -7466.7001953125, yMax: 8000 };
const RECT_2991: WorldBounds = { mapId: ZEPHRAS, xMin: 1247.9169921875, xMax: 4956.25, yMin: -1331.25, yMax: 4231.25 };

const LAYOUT: AtlasLayout = {
  name: 'compact',
  worldMap: { uiMapId: uiMapId(947), artWidth: 1002, artHeight: 668, scaleMapId: KALIMDOR, source: 'UiMapArtStyleLayer (test copy)' },
  placed: [
    { mapId: KALIMDOR, side: 'west', shift: { e: -3072, s: -2048 } },
    { mapId: EK, side: 'east', shift: { e: -10240, s: -2048 } },
  ],
  insets: [{ mapId: ZEPHRAS, uiMapId: uiMapId(2521), row: 69208, corner: { e: 13440, s: 512 }, reason: 'not placed by UiMap 947 (test copy)' }],
  seamE: 16617,
  extent: { eMin: 0, eMax: 30720, sMin: 0, sMax: 26112 },
  basis: 'test copy of the compact layout',
};

const placed = (mapId: WorldMapId, eOff: number, sOff: number, rect: WorldBounds, row: number): AtlasPlacement => ({
  mapId,
  kind: 'placed',
  scale: 1,
  eOff,
  sOff,
  rect,
  source: { kind: 'placed', table: 'UiMapAssignment', uiMapId: uiMapId(947), row, build: '1.60.1.70009', layoutShift: { e: 0, s: 0 } },
});

const PLACEMENTS: readonly AtlasPlacement[] = [
  placed(KALIMDOR, 5652, 12778, RECT_1, 46785),
  placed(EK, 22499, 7907, RECT_0, 46784),
  {
    mapId: ZEPHRAS,
    kind: 'inset',
    scale: 1,
    eOff: 17671.25,
    sOff: 5468.25,
    rect: RECT_2991,
    source: { kind: 'inset', table: 'UiMapAssignment', uiMapId: uiMapId(2521), row: 69208, build: '1.60.1.70009', reason: 'test' },
  },
];

const world = (id: WorldSurfaceInfo['id'], mapId: WorldMapId, name: string, extent: WorldBounds): WorldSurfaceInfo => ({
  id,
  mapId,
  name,
  extent,
  extentSource: 'zone-union',
  extentUiMapId: null,
  uiMapIds: [],
});

const ATLAS: AtlasSurfaceInfo = {
  kind: 'atlas',
  id: 'atlas',
  mapId: KALIMDOR,
  name: 'Azeroth',
  // The layout extent E 0–30,720, S 0–26,112 in Kalimdor's yards: x = sOff − S, y = eOff − E.
  extent: { mapId: KALIMDOR, xMin: 12778 - 26112, xMax: 12778, yMin: 5652 - 30720, yMax: 5652 },
  extentSource: 'atlas',
  extentUiMapId: null,
  uiMapIds: [],
  mapIds: [KALIMDOR, EK, ZEPHRAS],
  placements: PLACEMENTS,
  layout: LAYOUT,
  hash: 'test',
  members: [world('world:1', KALIMDOR, 'Kalimdor', RECT_1), world('world:0', EK, 'Eastern Kingdoms', RECT_0), world('world:2991', ZEPHRAS, 'Zephras Isle', RECT_2991)],
};

const DARKSPEAR_SURFACE = world('world:2997', DARKSPEAR, 'Darkspear Islands', { mapId: DARKSPEAR, xMin: -100, xMax: 100, yMin: -100, yMax: 100 });
const SURFACES: readonly SurfaceInfo[] = [ATLAS, DARKSPEAR_SURFACE];

// Durotar (Kalimdor), Stormwind (the Eastern Kingdoms) and a point on Zephras Isle.
const GORNEK: WorldPoint = { mapId: KALIMDOR, x: -600.2991646363, y: -4186.4222239014 };
const STORMWIND: WorldPoint = { mapId: EK, x: -8900, y: 500 };
const ISLE: WorldPoint = { mapId: ZEPHRAS, x: 3000, y: 1500 };

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

const content = (layer: LayerId, items: readonly MapDescriptor[]): LayerContent => ({
  layer,
  items,
  stats: { drawn: items.length, notDrawn: 0, aggregated: 0, unresolved: 0, unresolvedBy: {}, otherSurfaces: 0 },
});

const stepMarker = (id: string, point: WorldPoint): MarkerDescriptor => ({
  type: 'marker',
  id: `step:${id}`,
  point,
  kind: 'step',
  style: 'accent',
  emphasis: 'normal',
  label: `Step ${id}`,
  badges: [],
  ref: { kind: 'step', stepId: stepId(id) },
  count: 1,
  refs: [{ kind: 'step', stepId: stepId(id) }],
  labels: [`Step ${id}`],
});

const boat: ConnectorDescriptor = {
  type: 'connector',
  id: 'connector:a>b',
  from: GORNEK,
  to: STORMWIND,
  style: 'transport',
  emphasis: 'normal',
  label: 'Transport to Eastern Kingdoms',
  ref: { kind: 'connector', fromStepId: stepId('a'), toStepId: stepId('b'), fromMapId: KALIMDOR, toMapId: EK, leg: 'transport' },
};

let sizeDescriptors: { width: PropertyDescriptor | undefined; height: PropertyDescriptor | undefined };
let adapters: LeafletMapAdapter[];

beforeEach(() => {
  adapters = [];
  const context = fakeContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context);
  sizeDescriptors = {
    width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
    height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
  };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
});

afterEach(() => {
  for (const adapter of adapters) adapter.destroy();
  vi.restoreAllMocks();
  const restore = (key: 'clientWidth' | 'clientHeight', descriptor: PropertyDescriptor | undefined): void => {
    if (descriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, key);
    else Object.defineProperty(HTMLElement.prototype, key, descriptor);
  };
  restore('clientWidth', sizeDescriptors.width);
  restore('clientHeight', sizeDescriptors.height);
  document.body.innerHTML = '';
});

function setup(options: Partial<LeafletMapAdapterOptions> = {}): { readonly adapter: LeafletMapAdapter; readonly host: HTMLElement; readonly events: MapEvent[] } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const adapter = new LeafletMapAdapter({ surfaces: SURFACES, initialSurface: 'atlas', observeResize: false, performance: null, ...options });
  adapters.push(adapter);
  const events: MapEvent[] = [];
  for (const type of ['click', 'hover', 'move', 'zoom', 'surface'] as const) {
    adapter.on(type, (event) => {
      events.push(event);
    });
  }
  adapter.mount(host);
  return { adapter, host, events };
}

const leafletMap = (adapter: LeafletMapAdapter): L.Map => {
  const map = (adapter as unknown as { map: L.Map | null }).map;
  if (map === null) throw new Error('not mounted');
  return map;
};

/** The Leaflet layer the adapter drew for a descriptor. */
const drawnLayer = (adapter: LeafletMapAdapter, layer: LayerId, id: string): unknown =>
  (adapter as unknown as { layers: Record<LayerId, { drawn: Map<string, { leaflet: unknown }> }> }).layers[layer].drawn.get(id)?.leaflet;

function click(host: HTMLElement, at: { readonly x: number; readonly y: number }): void {
  const target = host.querySelector('.leaflet-container') ?? host;
  target.dispatchEvent(new MouseEvent('click', { clientX: at.x, clientY: at.y, bubbles: true, cancelable: true }));
}

describe('LeafletMapAdapter on the atlas (docs/research/map-atlas.md §5, §8.1; ATL.3, ATL.5)', () => {
  it('fits the whole atlas, card included, and names every placed map in view', () => {
    const { adapter } = setup();
    const view = adapter.getView();
    expect(view?.surface).toBe('atlas');
    // The extent (30,720 × 26,112 yd) in 800 × 600 px less padding: about −5.56, snapped to quarters.
    expect(view?.zoom).toBeGreaterThanOrEqual(-6);
    expect(view?.zoom).toBeLessThan(-5.25);
    expect(view?.visible?.map((bounds) => bounds.mapId)).toEqual([KALIMDOR, EK, ZEPHRAS]);
    // Every entry is the same view in another map's yards: a translation, the same size.
    const [a, b] = view?.visible ?? [];
    expect((a?.xMax ?? 0) - (a?.xMin ?? 0)).toBeCloseTo((b?.xMax ?? 0) - (b?.xMin ?? 1), 6);
    expect((b?.yMin ?? 0) - (a?.yMin ?? 0)).toBeCloseTo(22499 - 5652, 6);
  });

  it('draws each map through its placement: latLng = (x − sOff, eOff − y)', () => {
    const { adapter } = setup();
    adapter.setLayer('route-steps', content('route-steps', [stepMarker('a', GORNEK), stepMarker('b', STORMWIND), stepMarker('c', ISLE), stepMarker('d', { mapId: DARKSPEAR, x: 0, y: 0 })]));
    expect(adapter.renderStats().layers['route-steps']).toMatchObject({ drawn: 3, offSurface: 1 });
    const at = (id: string): L.LatLng => (drawnLayer(adapter, 'route-steps', id) as L.CircleMarker).getLatLng();
    expect([at('step:a').lat, at('step:a').lng]).toEqual([GORNEK.x - 12778, 5652 - GORNEK.y]);
    expect([at('step:b').lat, at('step:b').lng]).toEqual([STORMWIND.x - 7907, 22499 - STORMWIND.y]);
    expect([at('step:c').lat, at('step:c').lng]).toEqual([ISLE.x - 5468.25, 17671.25 - ISLE.y]);
  });

  it('resolves clicks through the partition: each continent on its side of the seam, the card to Zephras Isle', () => {
    const { adapter, host, events } = setup();
    for (const point of [GORNEK, STORMWIND, ISLE]) {
      adapter.setViewport({ center: point, zoom: 0 });
      // One pixel is one yard at zoom 0: the centre of the stage is the point, to rounding.
      click(host, { x: 400, y: 300 });
      const last = events.filter((event) => event.type === 'click').at(-1);
      expect(last?.type === 'click' ? last.point.mapId : null).toBe(point.mapId);
      if (last?.type === 'click') {
        expect(Math.abs(last.point.x - point.x)).toBeLessThan(1);
        expect(Math.abs(last.point.y - point.y)).toBeLessThan(1);
      }
      expect(adapter.getSurface()).toBe('atlas');
    }
    // No surface event: every one of these maps is on the atlas.
    expect(events.some((event) => event.type === 'surface')).toBe(false);
  });

  it('reports the map under the view centre, its point, and only the placed maps near the view', () => {
    const { adapter } = setup();
    adapter.setViewport({ center: STORMWIND, zoom: -2 });
    const view = adapter.getView();
    expect(view?.mapId).toBe(EK);
    expect(Math.abs((view?.center.x ?? 0) - STORMWIND.x)).toBeLessThan(1e-6);
    expect(Math.abs((view?.center.y ?? 0) - STORMWIND.y)).toBeLessThan(1e-6);
    expect(view?.bounds.mapId).toBe(EK);
    // 800 × 600 px at 4 yd per px, padded by half on every side, reaches no other placed rectangle.
    expect(view?.visible?.map((bounds) => bounds.mapId)).toEqual([EK]);
    // A point on another placed map keeps the atlas; a separate map switches surface.
    expect(adapter.focus(GORNEK, { zoom: -2 })).toBe(true);
    expect(adapter.getView()?.mapId).toBe(KALIMDOR);
    expect(adapter.getSurface()).toBe('atlas');
    expect(adapter.focus({ mapId: DARKSPEAR, x: 0, y: 0 })).toBe(true);
    expect(adapter.getSurface()).toBe('world:2997');
    expect(adapter.getView()?.visible).toBeUndefined();
    expect(adapter.focus({ mapId: worldMapId(36), x: 0, y: 0 })).toBe(false);
  });

  it('bounds the view by the atlas extent, padded by half, and fits a rectangle through its map’s placement', () => {
    const { adapter } = setup();
    const map = leafletMap(adapter);
    const max = (map.options as { maxBounds?: L.LatLngBounds }).maxBounds;
    // The extent E 0–30,720, S 0–26,112 is latLng [[−26,112, 0], [0, 30,720]], padded by 50 %.
    expect(max?.getSouth()).toBeCloseTo(-26112 - 13056, 6);
    expect(max?.getEast()).toBeCloseTo(30720 + 15360, 6);
    const stormwind: WorldBounds = { mapId: EK, xMin: -9154, xMax: -7995, yMin: -14, yMax: 1722 };
    adapter.fitBounds(stormwind, { animate: false });
    const view = adapter.getView();
    expect(view?.mapId).toBe(EK);
    expect(view?.bounds.xMin).toBeLessThanOrEqual(stormwind.xMin);
    expect(view?.bounds.yMax).toBeGreaterThanOrEqual(stormwind.yMax);
  });

  it('draws a connector as an arc between the continents, and never on a world surface', () => {
    const { adapter } = setup();
    adapter.setLayer('route-line', content('route-line', [boat]));
    const arc = drawnLayer(adapter, 'route-line', boat.id);
    expect(arc).toBeInstanceOf(ConnectorArc);
    const points = (arc as ConnectorArc).getLatLngs() as L.LatLng[];
    expect(points).toHaveLength(25);
    expect([points[0]?.lat, points[0]?.lng]).toEqual([GORNEK.x - 12778, 5652 - GORNEK.y]);
    expect([points[24]?.lat, points[24]?.lng]).toEqual([STORMWIND.x - 7907, 22499 - STORMWIND.y]);
    expect(adapter.drawOrder()).toContain(`route-line/${boat.id}`);
    // Its glyph is the transition ring; its line keeps the transport dash.
    expect((arc as ConnectorArc).glyph.shape).toBe('transition');
    expect((arc as ConnectorArc).options.dashArray).toBe('10 6');
    // Moving an end moves the arc in place.
    const moved: ConnectorDescriptor = { ...boat, to: { ...STORMWIND, x: -8800 } };
    adapter.setLayer('route-line', content('route-line', [moved]));
    expect(drawnLayer(adapter, 'route-line', boat.id)).toBe(arc);
    expect(((arc as ConnectorArc).getLatLngs() as L.LatLng[])[24]?.lat).toBe(-8800 - 7907);
    adapter.setSurface('world:2997');
    expect(adapter.renderStats().layers['route-line']).toMatchObject({ drawn: 0, offSurface: 1 });
  });

  it('clips an image to the part its descriptor shows, and draws an inset card with a caption above it', () => {
    const { adapter } = setup();
    const continent: MapDescriptor = {
      type: 'art',
      id: 'art:1414',
      bounds: { mapId: KALIMDOR, xMin: -11733.3, xMax: 12799.9, yMin: -19733.2, yMax: 17066.6 },
      clip: { mapId: KALIMDOR, xMin: -11733.3, xMax: 12799.9, yMin: 5652 - 16617, yMax: 17066.6 },
      url: 'maps/art/1414.webp',
      opacity: 1,
      label: 'Kalimdor',
      ref: { kind: 'art', uiMapId: uiMapId(1414) },
    };
    adapter.setLayer('art', content('art', [continent]));
    const image = (drawnLayer(adapter, 'art', 'art:1414') as L.ImageOverlay).getElement();
    // The seam lies at y = 5,652 − 16,617 = −10,965 in Kalimdor's yards: (−10,965 + 19,733.2) / 36,799.8
    // = 23.83 % of the image from its east edge is cut away.
    expect(image?.style.clipPath).toBe('inset(0% 23.8268% 0% 0%)');
    const card: FrameDescriptor = {
      type: 'frame',
      id: 'inset:2991',
      bounds: RECT_2991,
      kind: 'inset',
      label: 'Zephras Isle: separate map, not in position',
      emphasis: 'normal',
      filled: false,
      ref: { kind: 'surface', mapId: ZEPHRAS },
    };
    adapter.setLayer('zone-frames', content('zone-frames', [card]));
    const frame = drawnLayer(adapter, 'zone-frames', 'inset:2991');
    expect(frame).toBeInstanceOf(FrameRectangle);
    expect((frame as FrameRectangle).options.weight).toBe(2);
    expect((frame as FrameRectangle).options.dashArray).toBeUndefined();
  });

  it('draws the grid per placement and names the map under the centre on the scale bar', () => {
    const { adapter, host } = setup();
    const grid = (adapter as unknown as { grid: GridLayer }).grid;
    expect((grid as unknown as { frlPlacements: readonly { mapId: number }[] }).frlPlacements.map((entry) => entry.mapId)).toEqual([KALIMDOR, EK, ZEPHRAS]);
    adapter.setViewport({ center: STORMWIND, zoom: -2 });
    expect(host.querySelector('.frl-map__scale-text')?.textContent).toMatch(/ yd · Eastern Kingdoms$/);
    adapter.setSurface('world:2997');
    expect(host.querySelector('.frl-map__scale-text')?.textContent).toMatch(/ yd$/);
  });
});

// =============================================================================================
// The atlas tiles in the adapter (map-atlas.md §8.3, §8.6; step ATL.7)

describe('LeafletMapAdapter: the atlas tiles (map-atlas.md §8.3, §8.6; ATL.7)', () => {
  const TILE_INDEX = syntheticIndex({ hash: 'test', stored: { [-8]: [[0, 0]], [-5]: [[1, 1]] }, sea: { [-5]: [[3, 3]] } });
  const BAND = bandFor(TILE_INDEX);
  const never: DecodeImage = () => new Promise<void>(() => undefined);

  it('draws the band as the tile layer over the underlay, in their panes, with the deep sea behind it', () => {
    const { adapter, host } = setup({ decodeImage: never });
    const map = leafletMap(adapter);
    expect(map.options.fadeAnimation).toBe(false);
    for (const [pane, z] of [
      ['frl-underlay', '244'],
      ['frl-atlas', '245'],
      ['frl-tint', '255'],
      ['frl-labels', '450'],
    ] as const) {
      expect(map.getPane(pane)?.style.zIndex, pane).toBe(z);
      expect(map.getPane(pane)?.style.pointerEvents, pane).toBe('none');
    }
    const container = host.querySelector<HTMLElement>('.frl-map');
    const before = container?.style.backgroundColor ?? '';
    adapter.setLayer('art', content('art', [BAND]));
    const drawn = drawnLayer(adapter, 'art', 'atlas-tiles:painted');
    expect(drawn).toBeInstanceOf(AtlasTiles);
    expect(map.getPane('frl-atlas')?.querySelector('.frl-atlas')).not.toBeNull();
    expect(map.getPane('frl-underlay')?.querySelector('.frl-atlas-underlay')).not.toBeNull();
    expect(container?.style.backgroundColor).toBe('rgb(61, 55, 41)');
    // Hiding the art layer hides the tiles and the sea; showing it brings both back.
    adapter.toggleLayer('art', false);
    expect(container?.style.backgroundColor).toBe(before);
    expect(map.getPane('frl-atlas')?.querySelector('.frl-atlas')).toBeNull();
    adapter.toggleLayer('art', true);
    expect(container?.style.backgroundColor).toBe('rgb(61, 55, 41)');
    // Removing the band removes both.
    adapter.setLayer('art', content('art', []));
    expect(container?.style.backgroundColor).toBe(before);
    expect(map.getPane('frl-underlay')?.querySelector('.frl-atlas-underlay')).toBeNull();
  });

  it('keeps the tile layer while the band is the same object, and draws a band composed for other placements nowhere', () => {
    const { adapter } = setup({ decodeImage: never });
    adapter.setLayer('art', content('art', [BAND]));
    const drawn = drawnLayer(adapter, 'art', 'atlas-tiles:painted');
    adapter.setLayer('art', content('art', [BAND]));
    expect(drawnLayer(adapter, 'art', 'atlas-tiles:painted')).toBe(drawn);
    const foreign = bandFor(syntheticIndex({ hash: '0123456789abcdef0123456789abcdef', stored: { [-8]: [[0, 0]] } }));
    adapter.setLayer('art', content('art', [foreign]));
    expect(adapter.renderStats().layers.art).toMatchObject({ drawn: 0, offSurface: 1 });
    // Nor on a world surface.
    adapter.setLayer('art', content('art', [BAND]));
    adapter.setSurface('world:2997');
    expect(adapter.renderStats().layers.art).toMatchObject({ drawn: 0, offSurface: 1 });
  });

  it('keeps hidden zone frames unpainted, and strokes cards over the tiles in the atlas frame colour, captioned with a halo', () => {
    const { adapter, events, host } = setup();
    const zone: FrameDescriptor = {
      type: 'frame',
      id: 'frame:1411',
      bounds: { mapId: KALIMDOR, xMin: -1716.67, xMax: 1808.33, yMin: -7250, yMax: -1962.5 },
      kind: 'zone',
      hidden: true,
      label: 'Durotar',
      emphasis: 'normal',
      filled: false,
      ref: { kind: 'zone', uiMapId: uiMapId(1411) },
    };
    const card: FrameDescriptor = {
      type: 'frame',
      id: 'inset:2991',
      bounds: RECT_2991,
      kind: 'inset',
      overTiles: true,
      label: 'Zephras Isle: separate map, not in position',
      emphasis: 'normal',
      filled: false,
      ref: { kind: 'surface', mapId: ZEPHRAS },
    };
    const city: FrameDescriptor = { ...zone, id: 'frame:1455', kind: 'card', hidden: false, overTiles: true, label: 'Ironforge', ref: { kind: 'zone', uiMapId: uiMapId(1455) } };
    adapter.setLayer('zone-frames', content('zone-frames', [zone, card, city]));
    const hidden = drawnLayer(adapter, 'zone-frames', 'frame:1411') as FrameRectangle;
    expect(hidden.options.stroke).toBe(false);
    expect(hidden.options.fill).toBe(false);
    const inset = drawnLayer(adapter, 'zone-frames', 'inset:2991') as FrameRectangle;
    expect(inset.options.color).toBe('#e8dfc8');
    expect(inset.options.weight).toBe(2);
    const cityCard = drawnLayer(adapter, 'zone-frames', 'frame:1455') as FrameRectangle;
    expect(cityCard.options.color).toBe('#e8dfc8');
    expect((cityCard as unknown as { frlLabelStyle: { halo?: string } }).frlLabelStyle.halo).toBe('#3d3729');
    expect((cityCard as unknown as { frlPlacement: string }).frlPlacement).toBe('above');
    // The hidden frame still names its zone under a click.
    adapter.setViewport({ center: GORNEK, zoom: 0 });
    click(host, { x: 400, y: 300 });
    const last = events.filter((event) => event.type === 'click').at(-1);
    expect(last?.type === 'click' ? last.zones : null).toContain(1411);
  });
});

// =============================================================================================
// Gestures (map-atlas.md §8.4; step ATL.8, behind smoothWheel)

describe('LeafletMapAdapter with smoothWheel (map-atlas.md §8.4; ATL.8)', () => {
  /** Frames and a clock the test drives, for the wheel and the chunked paths. */
  function frames() {
    let now = 0;
    let next = 1;
    const queue = new Map<number, () => void>();
    const request = (callback: () => void): number => {
      const handle = next;
      next += 1;
      queue.set(handle, callback);
      return handle;
    };
    const cancel = (handle: number): void => {
      queue.delete(handle);
    };
    const frame = (ms = 16): void => {
      now += ms;
      const due = [...queue.values()];
      queue.clear();
      for (const callback of due) callback();
    };
    return { request, cancel, frame, now: () => now, pending: () => queue.size };
  }

  function wheelOn(host: HTMLElement, deltaY: number): void {
    const target = host.querySelector('.frl-map') ?? host;
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true });
    for (const [key, value] of [
      ['deltaY', deltaY],
      ['deltaMode', 0],
      ['clientX', 400],
      ['clientY', 300],
      ['ctrlKey', false],
    ] as const) {
      Object.defineProperty(event, key, { value });
    }
    target.dispatchEvent(event);
  }

  function smoothSetup(extra: Partial<LeafletMapAdapterOptions> = {}) {
    const clock = frames();
    const s = setup({
      smoothWheel: true,
      frames: { request: clock.request, cancel: clock.cancel },
      wheel: { environment: { requestFrame: clock.request, cancelFrame: clock.cancel, now: clock.now }, reducedMotion: false },
      // The settle's report at once (its own task is tested below).
      settleTasks: null,
      ...extra,
    });
    return { ...s, clock };
  }

  const settleAll = (clock: ReturnType<typeof frames>): void => {
    for (let i = 0; i < 400 && clock.pending() > 0; i += 1) clock.frame();
  };

  it('replaces Leaflet’s wheel handler and allows any resting zoom; the default keeps both', () => {
    const plain = setup();
    expect(leafletMap(plain.adapter).options.zoomSnap).toBe(0.25);
    expect(leafletMap(plain.adapter).scrollWheelZoom.enabled()).toBe(true);
    const s = smoothSetup();
    const map = leafletMap(s.adapter);
    expect(map.options.zoomSnap).toBe(0);
    expect(map.scrollWheelZoom.enabled()).toBe(false);
    const before = map.getZoom();
    wheelOn(s.host, -100);
    settleAll(s.clock);
    expect(map.getZoom()).toBeCloseTo(before + 0.5, 12);
  });

  it('hides the grid from a gesture’s first event to its settle, emitting one move at the settle', () => {
    const s = smoothSetup();
    const container = s.host.querySelector('.frl-map');
    const moves = (): number => s.events.filter((event) => event.type === 'move').length;
    const movesBefore = moves();
    wheelOn(s.host, -100);
    expect(container?.classList.contains('frl-map--gesture')).toBe(true);
    s.clock.frame();
    wheelOn(s.host, -100);
    for (let i = 0; i < 10; i += 1) s.clock.frame();
    expect(container?.classList.contains('frl-map--gesture')).toBe(true);
    expect(moves()).toBe(movesBefore);
    settleAll(s.clock);
    expect(container?.classList.contains('frl-map--gesture')).toBe(false);
    expect(moves()).toBe(movesBefore + 1);
  });

  // Review MR-02: Leaflet's settle and the controller's sync were one task of 52–73 ms at 4×.
  it('reports a gesture’s settle in a task of its own, the labels drawn once after it; a view it is asked for at once', () => {
    const posted: (() => void)[] = [];
    const tasks = {
      post: (task: () => void) => {
        posted.push(task);
        return () => {
          const at = posted.indexOf(task);
          if (at >= 0) posted.splice(at, 1);
        };
      },
    };
    const s = smoothSetup({ settleTasks: tasks });
    const moves = (): number => s.events.filter((event) => event.type === 'move').length;
    const labels = (s.adapter as unknown as { labels: { draws: number } }).labels;
    const before = moves();
    wheelOn(s.host, -100);
    settleAll(s.clock);
    // Leaflet has settled (zoomend, moveend); the view is not reported yet, and the labels wait.
    expect(moves()).toBe(before);
    expect(posted).toHaveLength(1);
    const draws = labels.draws;
    s.clock.frame();
    expect(labels.draws).toBe(draws);
    posted.splice(0).forEach((task) => {
      task();
    });
    expect(moves()).toBe(before + 1);
    // The labels draw once, in a task after the frame that redraws the paths.
    s.clock.frame();
    expect(labels.draws).toBe(draws);
    expect(posted).toHaveLength(1);
    posted.splice(0).forEach((task) => {
      task();
    });
    expect(labels.draws).toBe(draws + 1);
    // A fit the controller asks for is reported at once, and replaces a report still waiting.
    wheelOn(s.host, 100);
    settleAll(s.clock);
    expect(posted).toHaveLength(1);
    s.adapter.fitBounds({ mapId: worldMapId(1), xMin: -1000, xMax: 1000, yMin: -5000, yMax: -3000 });
    expect(moves()).toBe(before + 2);
    expect(posted).toHaveLength(0);
  });

  it('re-renders the path canvas mid-gesture once the zoom has drifted more than half a level', () => {
    const s = smoothSetup();
    // The canvas joins the map with its first path.
    s.adapter.setLayer('route-steps', content('route-steps', [stepMarker('a', GORNEK)]));
    const canvas = (s.adapter as unknown as { canvas: MeasuredCanvas }).canvas;
    const refresh = vi.spyOn(canvas, 'frlRefresh');
    const drawnAt = canvas.frlDrawnZoom() ?? 0;
    wheelOn(s.host, -100);
    wheelOn(s.host, -100);
    let refreshedAt: number | null = null;
    for (let i = 0; i < 400 && s.clock.pending() > 0 && refreshedAt === null; i += 1) {
      s.clock.frame();
      if (refresh.mock.calls.length > 0) refreshedAt = leafletMap(s.adapter).getZoom();
    }
    expect(refreshedAt).not.toBeNull();
    expect((refreshedAt ?? 0) - drawnAt).toBeGreaterThan(0.5);
    expect(canvas.frlDrawnZoom()).toBe(refreshedAt);
    settleAll(s.clock);
    // Not when its last draw took 8 ms or more.
    refresh.mockClear();
    canvas.frlLastDrawMs = 8;
    wheelOn(s.host, -100);
    wheelOn(s.host, -100);
    for (let i = 0; i < 20; i += 1) s.clock.frame();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('sizes the canvas backing store by the device pixel ratio, capped at 2', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    try {
      for (const [ratio, expected] of [
        [1.5, 1.5],
        [3, 2],
        [1, 1],
      ] as const) {
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: ratio });
        const s = smoothSetup();
        s.adapter.setLayer('route-steps', content('route-steps', [stepMarker('a', GORNEK)]));
        const element = s.host.querySelector<HTMLCanvasElement>('.leaflet-overlay-pane canvas');
        const cssWidth = Number.parseFloat(element?.style.width ?? '0');
        expect(cssWidth).toBeGreaterThan(0);
        expect(element?.width, String(ratio)).toBe(Math.round(cssWidth * expected));
      }
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(window, 'devicePixelRatio');
      else Object.defineProperty(window, 'devicePixelRatio', descriptor);
    }
  });

  it('creates new paths at most 150 per animation frame', () => {
    const s = smoothSetup();
    const markers = Array.from({ length: 400 }, (_, i) => stepMarker(String(i), { mapId: KALIMDOR, x: GORNEK.x + i, y: GORNEK.y }));
    s.adapter.setLayer('route-steps', content('route-steps', markers));
    expect(s.adapter.renderStats().layers['route-steps'].drawn).toBe(150);
    s.clock.frame();
    expect(s.adapter.renderStats().layers['route-steps'].drawn).toBe(300);
    s.clock.frame();
    expect(s.adapter.renderStats().layers['route-steps'].drawn).toBe(400);
    // In their layer's order, bottom first.
    expect(s.adapter.drawOrder().filter((entry) => entry.startsWith('route-steps/'))).toEqual(markers.map((marker) => `route-steps/${marker.id}`));
    // Without smoothWheel, all at once.
    const plain = setup();
    plain.adapter.setLayer('route-steps', content('route-steps', markers));
    expect(plain.adapter.renderStats().layers['route-steps'].drawn).toBe(400);
  });

  it('holds hover labels back during a gesture', () => {
    const s = smoothSetup();
    s.adapter.setLayer('route-steps', content('route-steps', [stepMarker('a', GORNEK)]));
    s.adapter.setViewport({ center: GORNEK, zoom: -2 });
    const marker = drawnLayer(s.adapter, 'route-steps', 'step:a') as L.CircleMarker;
    wheelOn(s.host, -100);
    marker.fire('mouseover', { latlng: marker.getLatLng() }, true);
    expect(s.events.filter((event) => event.type === 'hover')).toEqual([]);
    settleAll(s.clock);
    marker.fire('mouseover', { latlng: marker.getLatLng() }, true);
    expect(s.events.filter((event) => event.type === 'hover')).toHaveLength(1);
  });
});
