// @vitest-environment happy-dom
import * as L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NpcId, StepId, UiMapId, WorldMapId } from '../../domain/ids';
import type { WorldPoint } from '../../domain/points';
import type {
  AggregateDescriptor,
  FrameDescriptor,
  LayerContent,
  LayerId,
  MapDescriptor,
  MapEvent,
  MapRef,
  MarkerDescriptor,
  OutlineDescriptor,
  PolylineDescriptor,
  SurfaceInfo,
  WorldBounds,
} from '../adapter';
import { GlyphMarker, type GridLayer } from './leaflet-layers';
import { createLeafletMapAdapter, LeafletMapAdapter, type LeafletMapAdapterOptions } from './LeafletMapAdapter';
import type { PerformanceLike } from './perf';

// map/leaflet may import only map/adapter values (ARCHITECTURE §4), so the tests brand ids themselves.
const npcId = (value: number): NpcId => value as NpcId;
const stepId = (value: string): StepId => value as StepId;
const uiMapId = (value: number): UiMapId => value as UiMapId;
const worldMapId = (value: number): WorldMapId => value as WorldMapId;

/**
 * A smoke test of the Leaflet adapter in happy-dom. happy-dom has no canvas, so `getContext`
 * returns a recording stand-in, and it lays nothing out, so the container reports a fixed size.
 * Leaflet itself runs unmodified: projection, the canvas renderer's draw loop and hit-testing.
 */

const KALIMDOR = worldMapId(1);
const EK = worldMapId(0);
// Committed continent frames (UiMapAssignment at 1.60.1.70009, docs/MAPS.md §8.3).
const KALIMDOR_EXTENT: WorldBounds = { mapId: KALIMDOR, xMin: -11733.299804688, xMax: 12799.900390625, yMin: -19733.2109375, yMax: 17066.599609375 };
const EK_EXTENT: WorldBounds = { mapId: EK, xMin: -16000, xMax: 7466.6000976562, yMin: -19199.900390625, yMax: 16000 };
const SURFACES: readonly SurfaceInfo[] = [
  { id: 'world:0', mapId: EK, name: 'Eastern Kingdoms', extent: EK_EXTENT, extentSource: 'continent', extentUiMapId: uiMapId(1415), uiMapIds: [] },
  { id: 'world:1', mapId: KALIMDOR, name: 'Kalimdor', extent: KALIMDOR_EXTENT, extentSource: 'continent', extentUiMapId: uiMapId(1414), uiMapIds: [] },
];
// Durotar 1411 (conversion.json target_bounds at b6f5b07b).
const DUROTAR: WorldBounds = { mapId: KALIMDOR, xMin: -1716.6666259766, xMax: 1808.3332519531, yMin: -7249.9995117188, yMax: -1962.4998779297 };
const GORNEK: WorldPoint = { mapId: KALIMDOR, x: -600.2991646363, y: -4186.4222239014 };

interface Recorded {
  readonly name: string;
  readonly args: readonly unknown[];
}

function fakeContext(calls: Recorded[]): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = {};
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
      return (...args: readonly unknown[]) => {
        calls.push({ name: String(key), args });
      };
    },
    set(target, key, value) {
      target[key] = value;
      calls.push({ name: `set:${String(key)}`, args: [value] });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function fakePerformance(): PerformanceLike & { readonly measures: { name: string; detail: unknown }[] } {
  const measures: { name: string; detail: unknown }[] = [];
  return {
    measures,
    mark: () => undefined,
    measure: (name, options) => {
      measures.push({ name, detail: options.detail });
    },
    clearMarks: () => undefined,
    clearMeasures: () => undefined,
  };
}

const content = (layer: LayerId, items: readonly MapDescriptor[]): LayerContent => ({
  layer,
  items,
  stats: { drawn: items.length, notDrawn: 0, aggregated: 0, unresolved: 0, unresolvedBy: {}, otherSurfaces: 0 },
});

const single = (fields: Omit<MarkerDescriptor, 'type' | 'count' | 'refs' | 'labels'>): MarkerDescriptor => ({
  type: 'marker',
  ...fields,
  count: 1,
  refs: [fields.ref],
  labels: [fields.label],
});

const stepMarker = (id: string, point: WorldPoint, label: string | null = `Step ${id}`): MarkerDescriptor =>
  single({ id: `step:${id}`, point, kind: 'step', style: 'accent', emphasis: 'normal', label, badges: [], ref: { kind: 'step', stepId: stepId(id) } });

const giver = (id: number, point: WorldPoint, label = 'A quest giver'): MarkerDescriptor =>
  single({
    id: `spawn:npc:${String(id)}:0`,
    point,
    kind: 'quest-start',
    style: 'neutral',
    emphasis: 'normal',
    label,
    badges: [],
    ref: { kind: 'spawn', subject: { kind: 'npc', id: npcId(id) }, spawnIndex: 0, questIds: [] },
  });

/** Steps merged into one marker at one point, as map/layers builds a stack. */
const stack = (ids: readonly string[], point: WorldPoint): MarkerDescriptor => {
  const refs: MapRef[] = ids.map((id) => ({ kind: 'step', stepId: stepId(id) }));
  return { ...stepMarker(ids[0] ?? '', point, ids[0] ?? null), count: ids.length, refs, labels: [...ids] };
};

const durotarFrame: FrameDescriptor = {
  type: 'frame',
  id: 'frame:1411',
  bounds: DUROTAR,
  filled: true,
  kind: 'zone',
  label: 'Durotar',
  emphasis: 'normal',
  ref: { kind: 'zone', uiMapId: uiMapId(1411) },
};

let sizeDescriptors: { width: PropertyDescriptor | undefined; height: PropertyDescriptor | undefined };
let calls: Recorded[];
let adapters: LeafletMapAdapter[];
/** The size every element reports (happy-dom lays nothing out). */
let stage: { width: number; height: number };

beforeEach(() => {
  calls = [];
  adapters = [];
  const context = fakeContext(calls);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context);
  sizeDescriptors = {
    width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
    height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
  };
  stage = { width: 800, height: 600 };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => stage.width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => stage.height });
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
  const adapter = new LeafletMapAdapter({ surfaces: SURFACES, initialSurface: 'world:1', observeResize: false, performance: null, ...options });
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

/** Where a world point is in the container, from the adapter's own view: CRS.Simple has 2^zoom px per yard. */
function screenOf(adapter: LeafletMapAdapter, point: WorldPoint): { readonly x: number; readonly y: number } {
  const view = adapter.getView();
  if (view === null) throw new Error('not mounted');
  const scale = 2 ** view.zoom;
  return { x: (view.bounds.yMax - point.y) * scale, y: (view.bounds.xMax - point.x) * scale };
}

function pathCanvas(host: HTMLElement): HTMLCanvasElement {
  const canvas = host.querySelector<HTMLCanvasElement>('.leaflet-overlay-pane canvas:not(.frl-map__grid)');
  if (canvas === null) throw new Error('no path canvas yet');
  return canvas;
}

function pointer(host: HTMLElement, type: 'click' | 'mousemove', at: { readonly x: number; readonly y: number }): void {
  pathCanvas(host).dispatchEvent(new MouseEvent(type, { clientX: at.x, clientY: at.y, bubbles: true, cancelable: true }));
}

describe('LeafletMapAdapter (happy-dom smoke test)', () => {
  it('mounts a CRS.Simple map fitted to the surface extent', () => {
    const { adapter, host } = setup();
    expect(host.querySelector('.frl-map.leaflet-container')).not.toBeNull();
    expect(host.querySelector('.frl-map__scale')).not.toBeNull();
    // The grid has its own canvas in its own pane, below the path canvas, and never takes pointer events.
    const grid = host.querySelector<HTMLCanvasElement>('.leaflet-frl-grid-pane canvas.frl-map__grid');
    expect(grid?.style.pointerEvents).toBe('none');
    expect(host.querySelector('.leaflet-overlay-pane .frl-map__grid')).toBeNull();
    const view = adapter.getView();
    expect(view).toMatchObject({ surface: 'world:1', mapId: 1, widthPx: 800, heightPx: 600 });
    // 36,800 yards of Y across 800 px (minus padding): about -5.6, snapped to quarters.
    expect(view?.zoom).toBeGreaterThanOrEqual(-6);
    expect(view?.zoom).toBeLessThan(-5);
    expect(view?.bounds.yMax).toBeGreaterThanOrEqual(KALIMDOR_EXTENT.yMax);
    expect(adapter.getSurface()).toBe('world:1');
    expect(createLeafletMapAdapter({ surfaces: SURFACES, initialSurface: null }).getSurface()).toBe('world:0');
  });

  it('draws only the current surface, skips unchanged content by reference and diffs by id', () => {
    const { adapter } = setup();
    const a = stepMarker('a', GORNEK);
    const b = stepMarker('b', { mapId: KALIMDOR, x: 0, y: -3000 });
    const elsewhere = stepMarker('c', { mapId: EK, x: -8900, y: 500 });
    const items = [a, b, elsewhere];
    adapter.setLayer('route-steps', content('route-steps', items));
    expect(adapter.renderStats().layers['route-steps']).toMatchObject({ drawn: 2, offSurface: 1, skipped: 0 });
    expect(adapter.renderStats().paths).toBe(2);
    adapter.setLayer('route-steps', content('route-steps', items));
    expect(adapter.renderStats().layers['route-steps'].skipped).toBe(1);
    const moved = { ...b, point: { mapId: KALIMDOR, x: 10, y: -3000 } };
    adapter.setLayer('route-steps', content('route-steps', [a, moved, stepMarker('d', GORNEK), stepMarker('d', GORNEK)]));
    expect(adapter.renderStats().layers['route-steps']).toMatchObject({ drawn: 3, offSurface: 0, duplicates: 1 });
    adapter.setLayer('route-steps', content('route-steps', []));
    expect(adapter.renderStats().paths).toBe(0);
  });

  it('keeps content set before mounting and after a remount', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const adapter = new LeafletMapAdapter({ surfaces: SURFACES, initialSurface: 'world:1', observeResize: false, performance: null });
    adapters.push(adapter);
    adapter.setLayer('zone-frames', content('zone-frames', [durotarFrame]));
    expect(adapter.getView()).toBeNull();
    adapter.mount(host);
    expect(adapter.renderStats().layers['zone-frames'].drawn).toBe(1);
    expect(() => {
      adapter.mount(host);
    }).toThrow(/already mounted/);
    adapter.destroy();
    expect(host.children).toHaveLength(0);
    expect(adapter.getView()).toBeNull();
    adapter.mount(host);
    expect(adapter.renderStats().layers['zone-frames'].drawn).toBe(1);
  });

  it('survives a destroy while a redraw frame is pending (a StrictMode remount)', async () => {
    const { adapter, host } = setup();
    adapter.setLayer('route-steps', content('route-steps', [stepMarker('a', GORNEK)])); // requests a frame
    adapter.setViewport({ center: GORNEK, zoom: -1 }); // redraws synchronously
    adapter.setLayer('route-steps', content('route-steps', [stepMarker('b', GORNEK)])); // requests another
    adapter.destroy();
    adapter.mount(host);
    adapter.destroy();
    // Any stale frame would run now and throw on the destroyed renderer (an unhandled error fails the run).
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(adapter.getView()).toBeNull();
  });

  it('paints glyphs, frame labels and aggregate counts on the canvas', () => {
    const { adapter } = setup();
    adapter.setLayer('zone-frames', content('zone-frames', [durotarFrame]));
    adapter.setLayer('objectives', content('objectives', [
      {
        type: 'aggregate',
        id: 'agg:objectives:1411',
        point: GORNEK,
        layer: 'objectives',
        count: 37,
        subjects: 4,
        emphasis: 'normal',
        label: 'Durotar: 4 objective targets at 37 points',
        ref: { kind: 'aggregate', layer: 'objectives', mapId: KALIMDOR, uiMapId: uiMapId(1411), count: 37 },
      },
    ]));
    calls.length = 0;
    // A view reset redraws the whole canvas synchronously.
    adapter.setViewport({ center: GORNEK, zoom: -2 });
    const texts = calls.filter((call) => call.name === 'fillText').map((call) => call.args[0]);
    expect(texts).toContain('37');
    expect(texts).toContain('Durotar');
    expect(calls.some((call) => call.name === 'arc')).toBe(true);
  });

  it('hit-tests through the canvas renderer: the topmost layer wins, and hidden layers never do', () => {
    const { adapter, host, events } = setup();
    adapter.setViewport({ center: GORNEK, zoom: -2 });
    adapter.setLayer('zone-frames', content('zone-frames', [durotarFrame]));
    adapter.setLayer('available-quests', content('available-quests', [giver(3143, GORNEK, 'Gornek')]));
    // Set later but lower in the layer order: must still end up below the route.
    adapter.setLayer('route-steps', content('route-steps', [stepMarker('s1', GORNEK)]));
    adapter.setLayer('zone-frames', content('zone-frames', [{ ...durotarFrame, label: 'Durotar (again)' }]));
    const at = screenOf(adapter, GORNEK);
    pointer(host, 'click', at);
    const click = events.filter((event) => event.type === 'click').at(-1);
    expect(click).toMatchObject({ type: 'click', hit: { layer: 'route-steps', id: 'step:s1', ref: { kind: 'step', stepId: 's1' }, refs: [{ kind: 'step', stepId: 's1' }], segment: null } });
    expect(click?.type === 'click' ? click.zones : null).toEqual([1411]);

    adapter.setLayer('route-steps', content('route-steps', []));
    pointer(host, 'click', at);
    expect(events.filter((event) => event.type === 'click').at(-1)).toMatchObject({ hit: { layer: 'available-quests', id: 'spawn:npc:3143:0' } });

    adapter.toggleLayer('available-quests', false);
    expect(adapter.isLayerVisible('available-quests')).toBe(false);
    pointer(host, 'click', at);
    const empty = events.filter((event) => event.type === 'click').at(-1);
    expect(empty).toMatchObject({ type: 'click', hit: null, zones: [1411] });
    if (empty?.type === 'click') {
      expect(empty.point.mapId).toBe(1);
      expect(empty.point.x).toBeCloseTo(GORNEK.x, -1);
      expect(empty.point.y).toBeCloseTo(GORNEK.y, -1);
    }
    adapter.toggleLayer('available-quests', true);
    pointer(host, 'click', at);
    expect(events.filter((event) => event.type === 'click').at(-1)).toMatchObject({ hit: { layer: 'available-quests' } });
  });

  it('reports the hit segment of a polyline', () => {
    const { adapter, host, events } = setup();
    adapter.setViewport({ center: { mapId: KALIMDOR, x: 0, y: -3000 }, zoom: -2 });
    const line: PolylineDescriptor = {
      type: 'polyline',
      id: 'run:1:route:a',
      mapId: KALIMDOR,
      points: [
        { mapId: KALIMDOR, x: 0, y: -2000 },
        { mapId: KALIMDOR, x: 0, y: -3000 },
        { mapId: KALIMDOR, x: -1000, y: -3000 },
      ],
      style: 'route',
      emphasis: 'normal',
      label: 'Route: steps 1–3',
      ref: { kind: 'run', style: 'route', stepIds: [stepId('a'), stepId('b'), stepId('c')] },
    };
    adapter.setLayer('route-line', content('route-line', [line]));
    pointer(host, 'click', screenOf(adapter, { mapId: KALIMDOR, x: -500, y: -3000 }));
    expect(events.filter((event) => event.type === 'click').at(-1)).toMatchObject({ hit: { id: 'run:1:route:a', segment: 1 } });
    pointer(host, 'click', screenOf(adapter, { mapId: KALIMDOR, x: 0, y: -2400 }));
    expect(events.filter((event) => event.type === 'click').at(-1)).toMatchObject({ hit: { segment: 0 } });
  });

  it('shows hover labels as text, never as HTML', () => {
    const { adapter, host, events } = setup();
    adapter.setViewport({ center: GORNEK, zoom: -2 });
    adapter.setLayer('available-quests', content('available-quests', [giver(3143, GORNEK, '<b>Gornek</b> & co')]));
    pointer(host, 'mousemove', screenOf(adapter, GORNEK));
    expect(events.filter((event) => event.type === 'hover').at(-1)).toMatchObject({ hit: { layer: 'available-quests', id: 'spawn:npc:3143:0' } });
    const tooltip = host.querySelector('.frl-map__tooltip');
    expect(tooltip?.textContent).toBe('<b>Gornek</b> & co');
    expect(tooltip?.querySelector('b')).toBeNull();
  });

  it('switches surfaces, redrawing what each layer holds for the new world map', () => {
    const { adapter, events } = setup();
    adapter.setLayer('route-steps', content('route-steps', [stepMarker('a', GORNEK), stepMarker('c', { mapId: EK, x: -8900, y: 500 })]));
    expect(adapter.setSurface('world:0')).toBe(true);
    expect(adapter.getSurface()).toBe('world:0');
    expect(adapter.renderStats().layers['route-steps']).toMatchObject({ drawn: 1, offSurface: 1 });
    expect(events.filter((event) => event.type === 'surface').at(-1)).toMatchObject({ surface: 'world:0', view: { mapId: 0 } });
    expect(adapter.setSurface('world:2991')).toBe(false);
    expect(adapter.focus({ mapId: worldMapId(36), x: 0, y: 0 })).toBe(false);
    expect(adapter.getSurface()).toBe('world:0');
    // Focusing a Kalimdor point switches back and brings it into view at focus zoom.
    expect(adapter.focus(GORNEK)).toBe(true);
    const view = adapter.getView();
    expect(view).toMatchObject({ surface: 'world:1', zoom: -2 });
    expect(view?.center.x).toBeCloseTo(GORNEK.x, 3);
    expect(view?.center.y).toBeCloseTo(GORNEK.y, 3);
    expect(events.filter((event) => event.type === 'surface').map((event) => (event.type === 'surface' ? event.surface : null))).toEqual(['world:0', 'world:1']);
    expect(events.some((event) => event.type === 'move')).toBe(true);
    // The Eastern Kingdoms view was remembered.
    adapter.setSurface('world:0');
    expect(adapter.getView()?.mapId).toBe(0);
  });

  it('fits bounds and remembers views per surface', () => {
    const { adapter } = setup();
    expect(adapter.fitBounds(DUROTAR, { paddingPx: 0 })).toBe(true);
    const view = adapter.getView();
    expect(view?.bounds.xMin).toBeLessThanOrEqual(DUROTAR.xMin);
    expect(view?.bounds.yMax).toBeGreaterThanOrEqual(DUROTAR.yMax);
    // happy-dom has no 3D transforms, so Leaflet snaps fits to whole zooms there: -2.72 → -3.
    expect(view?.zoom).toBeGreaterThanOrEqual(-3);
    adapter.setSurface('world:0');
    adapter.setSurface('world:1');
    expect(adapter.getView()?.zoom).toBe(view?.zoom);
  });

  it('highlights items without rebuilding the layer', () => {
    const { adapter } = setup();
    adapter.setLayer('route-steps', content('route-steps', [stepMarker('a', GORNEK), stepMarker('b', { mapId: KALIMDOR, x: 0, y: -3000 })]));
    adapter.highlight({ layer: 'route-steps', ids: ['step:b'] });
    adapter.highlight(null);
    expect(adapter.renderStats().layers['route-steps']).toMatchObject({ drawn: 2, skipped: 0 });
  });

  it('records User Timing measures around setLayer and redraws', () => {
    const performance = fakePerformance();
    const { adapter } = setup({ performance });
    adapter.setLayer('route-steps', content('route-steps', [stepMarker('a', GORNEK)]));
    expect(performance.measures.find((m) => m.name === 'frl:map:set-layer')?.detail).toEqual({ layer: 'route-steps', added: 1, removed: 0, changed: 0, moved: 0 });
    performance.measures.length = 0;
    adapter.setViewport({ center: GORNEK, zoom: -1 });
    const names = performance.measures.map((m) => m.name);
    // One real update per view reset: the calls Leaflet postpones (and skips) are not measured.
    expect(names.filter((name) => name === 'frl:map:update-paths')).toHaveLength(1);
    expect(names).toContain('frl:map:redraw');
  });

  it('re-reads its palette from CSS custom properties', () => {
    const { adapter, host } = setup();
    adapter.setLayer('route-steps', content('route-steps', [stepMarker('a', GORNEK)]));
    const fills = (): readonly unknown[] => calls.filter((call) => call.name === 'set:fillStyle').map((call) => call.args[0]);
    calls.length = 0;
    adapter.setViewport({ center: GORNEK, zoom: -2 });
    expect(fills()).toContain('#3a4fc4'); // the light accent default
    host.querySelector<HTMLElement>('.frl-map')?.style.setProperty('--frl-accent', '#010203');
    adapter.refreshTheme();
    calls.length = 0;
    adapter.setViewport({ center: GORNEK, zoom: -1.5 });
    expect(fills()).toContain('#010203');
  });
});

/** Leaflet 1.9.4's canvas `_bringToFront`: every call dirties the path's area, and a restack's calls add up to the whole canvas. */
const spyBringToFront = () => vi.spyOn(L.Canvas.prototype as unknown as { _bringToFront(layer: unknown): void }, '_bringToFront');

const at = (x: number, y: number): WorldPoint => ({ mapId: KALIMDOR, x, y });

/** The adapter's highlight overlays (private), for the tests that follow them. */
const overlaysOf = (adapter: LeafletMapAdapter): readonly GlyphMarker[] =>
  [...(adapter as unknown as { overlays: Map<string, { path: GlyphMarker }> }).overlays.values()].map((overlay) => overlay.path);

const drawnPath = (adapter: LeafletMapAdapter, layer: LayerId, id: string): L.Layer => {
  const entry = (adapter as unknown as { layers: Record<LayerId, { drawn: Map<string, { leaflet: L.Layer }> }> }).layers[layer].drawn.get(id);
  if (entry === undefined) throw new Error(`${layer}/${id} is not drawn`);
  return entry.leaflet;
};

const routeLine = (id: string, points: readonly WorldPoint[], style: PolylineDescriptor['style'] = 'route'): PolylineDescriptor => ({
  type: 'polyline',
  id,
  mapId: KALIMDOR,
  points,
  style,
  emphasis: 'normal',
  label: 'Route',
  ref: { kind: 'run', style, stepIds: points.map((_, i) => stepId(`s${String(i)}`)) },
});

describe('LeafletMapAdapter draw order and updates (M3 review PERF-1, PERF-2)', () => {
  it('stacks layers in layer order in the draw list, whatever order they are set in', () => {
    const { adapter } = setup();
    adapter.setLayer('route-steps', content('route-steps', [stepMarker('a', GORNEK), stepMarker('b', at(0, -3000))]));
    adapter.setLayer('zone-frames', content('zone-frames', [durotarFrame]));
    adapter.setLayer('available-quests', content('available-quests', [giver(1, at(10, -3000))]));
    expect(adapter.drawOrder()).toEqual(['zone-frames/frame:1411', 'available-quests/spawn:npc:1:0', 'route-steps/step:a', 'route-steps/step:b']);
    // A new item lands in its layer's order, not on top of the canvas.
    adapter.setLayer('available-quests', content('available-quests', [giver(1, at(10, -3000)), giver(2, at(20, -3000))]));
    expect(adapter.drawOrder()).toEqual([
      'zone-frames/frame:1411',
      'available-quests/spawn:npc:1:0',
      'available-quests/spawn:npc:2:0',
      'route-steps/step:a',
      'route-steps/step:b',
    ]);
    // A real reorder moves the item.
    adapter.setLayer('route-steps', content('route-steps', [stepMarker('b', at(0, -3000)), stepMarker('a', GORNEK)]));
    expect(adapter.drawOrder().slice(-2)).toEqual(['route-steps/step:b', 'route-steps/step:a']);
    // Hidden, then shown again: back in its place.
    adapter.toggleLayer('available-quests', false);
    expect(adapter.drawOrder()).toEqual(['zone-frames/frame:1411', 'route-steps/step:b', 'route-steps/step:a']);
    adapter.toggleLayer('available-quests', true);
    expect(adapter.drawOrder()).toEqual([
      'zone-frames/frame:1411',
      'available-quests/spawn:npc:1:0',
      'available-quests/spawn:npc:2:0',
      'route-steps/step:b',
      'route-steps/step:a',
    ]);
  });

  it('brings nothing to the front for an update in place', () => {
    const performance = fakePerformance();
    const { adapter } = setup({ performance });
    adapter.setLayer('zone-frames', content('zone-frames', [durotarFrame]));
    const [a, b, c] = [stepMarker('a', GORNEK), stepMarker('b', at(0, -3000)), stepMarker('c', at(0, -3500))];
    adapter.setLayer('route-steps', content('route-steps', [a, b, c]));
    adapter.setLayer('selection', content('selection', [stepMarker('halo', GORNEK)]));
    const order = adapter.drawOrder();
    const bringToFront = spyBringToFront();
    // Move one marker and restyle another: both in place.
    adapter.setLayer('route-steps', content('route-steps', [a, { ...b, point: at(5, -3000) }, { ...c, emphasis: 'strong' }]));
    expect(bringToFront).not.toHaveBeenCalled();
    expect(adapter.drawOrder()).toEqual(order);
    expect(performance.measures.at(-1)?.detail).toEqual({ layer: 'route-steps', added: 0, removed: 0, changed: 2, moved: 0 });
  });

  it('brings nothing to the front for a highlight, drawing it on top of the selection layer', () => {
    const { adapter } = setup();
    adapter.setLayer('available-quests', content('available-quests', [giver(1, GORNEK)]));
    adapter.setLayer('route-steps', content('route-steps', [stepMarker('a', GORNEK)]));
    adapter.setLayer('selection', content('selection', [stepMarker('halo', at(0, -3000))]));
    const order = adapter.drawOrder();
    const bringToFront = spyBringToFront();
    adapter.highlight({ layer: 'available-quests', ids: ['spawn:npc:1:0'] });
    expect(adapter.drawOrder()).toEqual([...order, 'highlight/available-quests/spawn:npc:1:0']);
    // A selection item added later still goes below the highlight.
    adapter.setLayer('selection', content('selection', [stepMarker('halo', at(0, -3000)), stepMarker('halo2', at(0, -3100))]));
    expect(adapter.drawOrder().at(-1)).toBe('highlight/available-quests/spawn:npc:1:0');
    adapter.highlight({ layer: 'available-quests', ids: ['spawn:npc:1:0'] }); // the same target: nothing to do
    adapter.highlight(null);
    expect(bringToFront).not.toHaveBeenCalled();
    expect(adapter.drawOrder()).toEqual([...order, 'selection/step:halo2']);
    expect(adapter.renderStats().layers['available-quests']).toMatchObject({ drawn: 1, skipped: 0 });
  });

  it('draws a marker highlight as a strong copy that follows its item, and restyles a highlighted line in place', () => {
    const { adapter } = setup();
    adapter.setLayer('route-line', content('route-line', [routeLine('run:1:route:a', [GORNEK, at(0, -3000)])]));
    adapter.setLayer('route-steps', content('route-steps', [stepMarker('a', GORNEK)]));
    const setStyle = vi.spyOn(L.Polyline.prototype, 'setStyle');
    adapter.highlight({ layer: 'route-line', ids: ['run:1:route:a'] });
    expect(setStyle).toHaveBeenCalledTimes(1);
    expect(setStyle.mock.calls[0]?.[0]).toMatchObject({ weight: 5 });
    expect(adapter.drawOrder()).toEqual(['route-line/run:1:route:a', 'route-steps/step:a']);
    adapter.highlight({ layer: 'route-steps', ids: ['step:a'] });
    expect(setStyle).toHaveBeenCalledTimes(2); // the line back to normal
    expect(overlaysOf(adapter)[0]?.spec.size).toBeCloseTo(5.5 * 1.35, 9);
    adapter.setLayer('route-steps', content('route-steps', [stepMarker('a', at(100, -3000))]));
    expect(overlaysOf(adapter)[0]?.getLatLng().lat).toBe(100);
    adapter.toggleLayer('route-steps', false);
    expect(overlaysOf(adapter)).toEqual([]);
  });

  it('calls Leaflet only for what changed: nothing for a label or ref alone', () => {
    const { adapter } = setup();
    const a = stepMarker('a', GORNEK, 'a');
    const line = routeLine('run:1:route:a', [GORNEK, at(0, -3000)]);
    adapter.setLayer('route-steps', content('route-steps', [a]));
    adapter.setLayer('route-line', content('route-line', [line]));
    const setLatLng = vi.spyOn(GlyphMarker.prototype, 'setLatLng');
    const setSpec = vi.spyOn(GlyphMarker.prototype, 'setSpec');
    const setLatLngs = vi.spyOn(L.Polyline.prototype, 'setLatLngs');
    const setStyle = vi.spyOn(L.Polyline.prototype, 'setStyle');
    const redraw = vi.spyOn(L.Path.prototype, 'redraw');
    adapter.setLayer('route-steps', content('route-steps', [{ ...a, label: 'renamed', labels: ['renamed'] }]));
    adapter.setLayer('route-line', content('route-line', [{ ...line, label: 'Route: steps 2–3', ref: { kind: 'run', style: 'route', stepIds: [stepId('x'), stepId('b')] } }]));
    expect([setLatLng, setSpec, setLatLngs, setStyle, redraw].map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0, 0, 0]);
    // A move is one setLatLng; a new emphasis one setSpec; both at once still redraw the marker once.
    adapter.setLayer('route-steps', content('route-steps', [{ ...a, point: at(1, -3000) }]));
    expect([setLatLng.mock.calls.length, setSpec.mock.calls.length]).toEqual([1, 0]);
    adapter.setLayer('route-steps', content('route-steps', [{ ...a, point: at(1, -3000), emphasis: 'strong' }]));
    expect([setLatLng.mock.calls.length, setSpec.mock.calls.length]).toEqual([1, 1]);
    redraw.mockClear();
    adapter.setLayer('route-steps', content('route-steps', [{ ...a, point: at(2, -3000), emphasis: 'normal' }]));
    expect(redraw).toHaveBeenCalledTimes(1);
    // Only the line's shape changed: no restyle.
    adapter.setLayer('route-line', content('route-line', [{ ...line, points: [GORNEK, at(0, -3100)] }]));
    expect([setLatLngs.mock.calls.length, setStyle.mock.calls.length]).toEqual([1, 0]);
  });

  it('skips an unchanged restyle on a theme refresh', () => {
    const { adapter } = setup();
    adapter.setLayer('route-steps', content('route-steps', [stepMarker('a', GORNEK)]));
    adapter.setLayer('zone-frames', content('zone-frames', [durotarFrame]));
    const setSpec = vi.spyOn(GlyphMarker.prototype, 'setSpec');
    const setStyle = vi.spyOn(L.Path.prototype, 'setStyle');
    adapter.refreshTheme();
    expect([setSpec.mock.calls.length, setStyle.mock.calls.length]).toEqual([0, 0]);
  });
});

describe('LeafletMapAdapter stacks and labels (M3 review MAP-UX-3, PERF-2)', () => {
  it('reports every ref of a merged marker and labels it through the label provider', () => {
    const numbers: Readonly<Record<string, number>> = { a: 4, b: 5, c: 6, d: 7 };
    const label = (ref: MapRef): string | null => (ref.kind === 'step' ? `${String(numbers[ref.stepId] ?? 0)} · Accept: Cutting Teeth` : null);
    const { adapter, host, events } = setup({ label });
    adapter.setViewport({ center: GORNEK, zoom: -2 });
    adapter.setLayer('route-steps', content('route-steps', [stack(['a', 'b', 'c', 'd'], GORNEK)]));
    pointer(host, 'click', screenOf(adapter, GORNEK));
    const click = events.filter((event) => event.type === 'click').at(-1);
    expect(click?.type === 'click' ? click.hit?.refs.map((ref) => (ref.kind === 'step' ? ref.stepId : null)) : null).toEqual(['a', 'b', 'c', 'd']);
    pointer(host, 'mousemove', screenOf(adapter, GORNEK));
    expect(host.querySelector('.frl-map__tooltip')?.textContent).toBe(
      '4 here: 4 · Accept: Cutting Teeth; 5 · Accept: Cutting Teeth; 6 · Accept: Cutting Teeth and 1 more',
    );
  });

  it('asks the provider at hover time, so a renumbered step needs no new descriptor', async () => {
    let first = 1;
    const { adapter, host } = setup();
    adapter.setLabelProvider((ref) => (ref.kind === 'step' ? `${String(first)} · Note` : null));
    adapter.setViewport({ center: GORNEK, zoom: -2 });
    adapter.setLayer('route-steps', content('route-steps', [stepMarker('a', GORNEK, 'a')]));
    const text = (): string | null | undefined => host.querySelector('.frl-map__tooltip')?.textContent;
    // Leaflet throttles hover to one test per 32 ms.
    const hover = async (point: { readonly x: number; readonly y: number }): Promise<void> => {
      pointer(host, 'mousemove', point);
      await new Promise((resolve) => setTimeout(resolve, 40));
    };
    await hover(screenOf(adapter, GORNEK));
    expect(text()).toBe('1 · Note');
    first = 2;
    await hover({ x: 1, y: 1 });
    await hover(screenOf(adapter, GORNEK));
    expect(text()).toBe('2 · Note');
    // Without a provider the descriptor's own label (here the label key) is shown.
    adapter.setLabelProvider(null);
    await hover({ x: 1, y: 1 });
    await hover(screenOf(adapter, GORNEK));
    expect(text()).toBe('a');
  });
});

describe('LeafletMapAdapter zoom limits, fits and resizing (M3 review MAP-UX-7, PERF-4, PERF-5, PERF-12)', () => {
  // The Barrens 1413 (conversion.json target_bounds at b6f5b07b): wider than a small stage allows at zoom -3.5.
  const BARRENS: WorldBounds = { mapId: KALIMDOR, xMin: -5270.8330078125, xMax: 2622.916015625, yMin: -5416.6665039062, yMax: 1452.0832519531 };

  it('lets a small stage zoom out until the largest surface fits, down to the floor', () => {
    const { adapter } = setup();
    // 800 x 600 shows every continent at -6.
    expect(adapter.zoomLimits()).toEqual({ min: -6, max: 2 });
    // 336 px across (1280 px with the layer panel open): Kalimdor's 36,800 yd need about -7.
    stage = { width: 336, height: 634 };
    adapter.resize();
    expect(adapter.zoomLimits()?.min).toBe(-7);
    adapter.fitBounds(KALIMDOR_EXTENT);
    expect(adapter.getView()?.bounds.yMax).toBeGreaterThanOrEqual(KALIMDOR_EXTENT.yMax);
    stage = { width: 120, height: 200 };
    adapter.resize();
    expect(adapter.zoomLimits()?.min).toBe(-7.5);
    stage = { width: 800, height: 600 };
    adapter.resize();
    expect(adapter.zoomLimits()?.min).toBe(-6);
  });

  it('fits with a zoom floor: a wide zone is centred at the floor instead', () => {
    stage = { width: 424, height: 634 };
    const { adapter } = setup();
    adapter.fitBounds(BARRENS);
    expect(adapter.getView()?.zoom).toBeLessThan(-3.5);
    // happy-dom has no 3D transforms, so Leaflet snaps views to whole zooms there: use a whole floor.
    adapter.fitBounds(BARRENS, { minZoom: -3 });
    const view = adapter.getView();
    expect(view?.zoom).toBe(-3);
    expect(view?.center.x).toBeCloseTo((BARRENS.xMin + BARRENS.xMax) / 2, 3);
    expect(view?.center.y).toBeCloseTo((BARRENS.yMin + BARRENS.yMax) / 2, 3);
    // A zone that fits above the floor is fitted as before.
    adapter.fitBounds(DUROTAR, { minZoom: -6 });
    expect(adapter.getView()?.zoom).toBeGreaterThan(-6);
  });

  it('settles an observed resize once, after it stops, and keeps the grid backing store when the size is unchanged', () => {
    const view = document.defaultView;
    if (view === null) throw new Error('no window');
    const observer: { callback: (() => void) | null } = { callback: null };
    class FakeObserver {
      constructor(callback: () => void) {
        observer.callback = callback;
      }
      observe(): void {
        // The test calls the callback itself.
      }
      disconnect(): void {
        observer.callback = null;
      }
    }
    const original = Object.getOwnPropertyDescriptor(view, 'ResizeObserver');
    Object.defineProperty(view, 'ResizeObserver', { configurable: true, writable: true, value: FakeObserver });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { adapter, events } = setup({ observeResize: true });
      const grid = (adapter as unknown as { grid: GridLayer }).grid;
      const moves = (): number => events.filter((event) => event.type === 'move').length;
      const before = { moves: moves(), grid: grid.counts() };
      for (const width of [790, 780, 770, 760]) {
        stage = { width, height: 600 };
        observer.callback?.();
      }
      expect(moves()).toBe(before.moves);
      vi.advanceTimersByTime(250);
      expect(moves()).toBe(before.moves + 1);
      expect(grid.counts()).toEqual({ redraws: before.grid.redraws + 1, allocations: before.grid.allocations + 1 });
      // A view change at the same size redraws the grid once and reallocates nothing.
      adapter.setViewport({ center: GORNEK, zoom: -3 });
      expect(grid.counts()).toEqual({ redraws: before.grid.redraws + 2, allocations: before.grid.allocations + 1 });
    } finally {
      vi.useRealTimers();
      if (original === undefined) Reflect.deleteProperty(view, 'ResizeObserver');
      else Object.defineProperty(view, 'ResizeObserver', original);
    }
  });
});

describe('LeafletMapAdapter glyph drawing (M3 review PERF-3, PERF-13, MAP-UX-3)', () => {
  it('bounds a glyph by its whole paint, badges included, but hit-tests the glyph alone', () => {
    const { adapter } = setup();
    adapter.setViewport({ center: GORNEK, zoom: -2 });
    const badged: MarkerDescriptor = { ...stepMarker('b', at(0, -3000)), badges: ['leg-unknown'] };
    adapter.setLayer('route-steps', content('route-steps', [stepMarker('a', GORNEK), badged]));
    const halfWidth = (id: string): number => {
      const bounds = (drawnPath(adapter, 'route-steps', id) as unknown as { _pxBounds: L.Bounds })._pxBounds;
      return ((bounds.max?.x ?? 0) - (bounds.min?.x ?? 0)) / 2;
    };
    // The question mark reaches about 7.5 px beyond the 5.5 px bead.
    expect(halfWidth('step:b')).toBeGreaterThanOrEqual(5.5 + 7.5);
    expect(halfWidth('step:b')).toBeGreaterThan(halfWidth('step:a'));
    const radius = (id: string): number => (drawnPath(adapter, 'route-steps', id) as GlyphMarker).getRadius();
    expect(radius('step:b')).toBe(radius('step:a'));
  });

  it('draws a stack with a count badge', () => {
    const { adapter } = setup();
    adapter.setLayer('route-steps', content('route-steps', [stack(['a', 'b', 'c'], GORNEK)]));
    calls.length = 0;
    adapter.setViewport({ center: GORNEK, zoom: -2 });
    expect(calls.filter((call) => call.name === 'fillText').map((call) => call.args[0])).toContain('3');
  });

  it('sets no dash pattern and saves no state per glyph unless a dashed line was stroked before it', () => {
    const { adapter } = setup();
    adapter.setLayer('route-steps', content('route-steps', [stepMarker('a', GORNEK), stepMarker('b', at(10, -3000))]));
    calls.length = 0;
    adapter.setViewport({ center: GORNEK, zoom: -2 });
    expect(calls.filter((call) => call.name === 'setLineDash')).toEqual([]);
    const saves = calls.filter((call) => call.name === 'save').length;
    adapter.setLayer('route-line', content('route-line', [routeLine('run:1:transport:a', [at(0, -2500), at(0, -3500)], 'transport')]));
    calls.length = 0;
    adapter.setViewport({ center: GORNEK, zoom: -2.5 });
    const dashes = calls.filter((call) => call.name === 'setLineDash').map((call) => JSON.stringify(call.args[0]));
    // Leaflet's dash for the line, then one clear before the first glyph after it.
    expect(dashes).toEqual(['[10,6]', '[]']);
    // Two glyphs, and no more saves than Leaflet's own per pass.
    expect(calls.filter((call) => call.name === 'save').length).toBe(saves);
  });
});

describe('LeafletMapAdapter departures and aggregates', () => {
  it('reports the departure glyph of a hearth with no known destination, and an aggregate, with their refs', () => {
    const { adapter, host, events } = setup();
    adapter.setViewport({ center: GORNEK, zoom: -2 });
    const departure = single({
      id: 'departure:h',
      point: GORNEK,
      kind: 'transition',
      style: 'accent',
      emphasis: 'normal',
      label: 'Hearthstone (destination unknown until simulation)',
      badges: [],
      ref: { kind: 'departure', stepId: stepId('h'), leg: 'hearth' },
    });
    adapter.setLayer('route-line', content('route-line', [departure]));
    pointer(host, 'click', screenOf(adapter, GORNEK));
    expect(events.filter((event) => event.type === 'click').at(-1)).toMatchObject({ hit: { ref: { kind: 'departure', stepId: 'h' } } });
    const aggregate: AggregateDescriptor = {
      type: 'aggregate',
      id: 'agg:objectives:1411',
      point: at(0, -3000),
      layer: 'objectives',
      count: 12,
      subjects: 2,
      emphasis: 'normal',
      label: 'Durotar: 2 objective targets at 12 points; zoom in to see them',
      ref: { kind: 'aggregate', layer: 'objectives', mapId: KALIMDOR, uiMapId: uiMapId(1411), count: 12 },
    };
    adapter.setLayer('objectives', content('objectives', [aggregate]));
    pointer(host, 'click', screenOf(adapter, at(0, -3000)));
    expect(events.filter((event) => event.type === 'click').at(-1)).toMatchObject({ hit: { id: 'agg:objectives:1411', refs: [{ kind: 'aggregate' }] } });
  });
});

describe('LeafletMapAdapter canvas padding (M3 review PERF-3)', () => {
  it('pads the canvas by a tenth of the view on every side by default', () => {
    const { adapter, host } = setup();
    adapter.setLayer('route-steps', content('route-steps', [stepMarker('a', GORNEK)])); // the renderer joins with its first path
    // 800 x 600 plus 10% on each side.
    expect([pathCanvas(host).width, pathCanvas(host).height]).toEqual([960, 720]);
  });

  it('takes another padding when asked', () => {
    const { adapter, host } = setup({ rendererPadding: 0.25 });
    adapter.setLayer('route-steps', content('route-steps', [stepMarker('a', GORNEK)]));
    expect([pathCanvas(host).width, pathCanvas(host).height]).toEqual([1200, 900]);
  });
});

describe('LeafletMapAdapter art, relief and terrain outlines (D-032, D-033)', () => {
  const relief: MapDescriptor = {
    type: 'art',
    id: 'relief:1',
    bounds: { mapId: KALIMDOR, xMin: -12800, xMax: 17066.7, yMin: -9066.7, yMax: 17066.7 },
    url: 'maps/terrain/1/relief.png',
    opacity: 0.85,
    label: 'Shaded relief',
    ref: { kind: 'terrain', layer: 'relief', mapId: KALIMDOR },
  };
  const durotarArt: MapDescriptor = {
    type: 'art',
    id: 'art:1411',
    bounds: DUROTAR,
    url: 'maps/art/1411.webp',
    opacity: 1,
    label: 'Durotar',
    ref: { kind: 'art', uiMapId: uiMapId(1411) },
  };
  const zones: OutlineDescriptor = {
    type: 'outline',
    id: 'outline:zones:1',
    mapId: KALIMDOR,
    kind: 'zones',
    lines: [
      [at(0, -3000), at(100, -3100), at(200, -3000)],
      [at(-500, -4000), at(-400, -4200)],
    ],
    label: 'Zone outlines',
    ref: { kind: 'terrain', layer: 'zone-outlines', mapId: KALIMDOR },
  };

  it('puts the relief in a pane below the art’s, both below the grid and the canvas, as images that take no pointer', () => {
    const { adapter, host } = setup();
    adapter.setLayer('art', content('art', [durotarArt]));
    adapter.setLayer('relief', content('relief', [relief]));
    const reliefImage = host.querySelector<HTMLImageElement>('.leaflet-frl-relief-pane img.frl-map__relief');
    const artImage = host.querySelector<HTMLImageElement>('.leaflet-frl-art-pane img.frl-map__art');
    expect(reliefImage?.getAttribute('src')).toBe('maps/terrain/1/relief.png');
    expect(artImage?.getAttribute('src')).toBe('maps/art/1411.webp');
    const zIndex = (name: string) => Number(host.querySelector<HTMLElement>(`.leaflet-${name}-pane`)?.style.zIndex);
    expect(zIndex('frl-relief')).toBeLessThan(zIndex('frl-art'));
    expect(zIndex('frl-art')).toBeLessThan(zIndex('frl-grid'));
    expect(host.querySelector<HTMLElement>('.leaflet-frl-relief-pane')?.style.pointerEvents).toBe('none');
    // Images are not canvas paths: they neither count toward the path cap nor sit in the draw list.
    expect(adapter.renderStats().paths).toBe(0);
    expect(adapter.renderStats().layers.relief.drawn).toBe(1);
    expect(adapter.drawOrder()).toEqual([]);
  });

  it('changes a relief’s opacity in place when art appears over it', () => {
    const { adapter, host } = setup();
    adapter.setLayer('relief', content('relief', [relief]));
    const image = host.querySelector<HTMLImageElement>('img.frl-map__relief');
    adapter.setLayer('relief', content('relief', [{ ...relief, opacity: 0.4 }]));
    expect(host.querySelector('img.frl-map__relief')).toBe(image);
    expect(image?.style.opacity).toBe('0.4');
  });

  it('draws zone outlines as one non-interactive multi-line path, under the zone frames', () => {
    const { adapter, host, events } = setup();
    adapter.setLayer('zone-frames', content('zone-frames', [durotarFrame]));
    adapter.setLayer('zone-outlines', content('zone-outlines', [zones]));
    adapter.setLayer('coastline', content('coastline', [{ ...zones, id: 'outline:coast:1', kind: 'coast', ref: { kind: 'terrain', layer: 'coastline', mapId: KALIMDOR } }]));
    expect(adapter.drawOrder()).toEqual(['coastline/outline:coast:1', 'zone-outlines/outline:zones:1', 'zone-frames/frame:1411']);
    expect(adapter.renderStats().paths).toBe(3);
    // A click on the line is a click on the map: outlines are pictures, not items.
    adapter.setViewport({ center: at(100, -3100), zoom: 0 });
    pointer(host, 'click', screenOf(adapter, at(100, -3100)));
    expect(events.filter((event) => event.type === 'click').at(-1)).toMatchObject({ hit: null });
  });

  it('strokes a frame without its fill over the art', () => {
    const { adapter } = setup();
    const painted = (frame: FrameDescriptor, zoom: number) => {
      adapter.setLayer('zone-frames', content('zone-frames', [frame]));
      calls.length = 0;
      // A view reset redraws the whole canvas synchronously.
      adapter.setViewport({ center: at(0, -4600), zoom });
      return { fills: calls.filter((call) => call.name === 'fill').length, strokes: calls.filter((call) => call.name === 'stroke').length };
    };
    expect(painted(durotarFrame, -3).fills).toBe(1);
    const bare = painted({ ...durotarFrame, id: 'frame:1411:bare', filled: false }, -2.5);
    expect(bare.fills).toBe(0);
    expect(bare.strokes).toBeGreaterThan(0);
  });
});
