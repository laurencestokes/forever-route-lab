// @vitest-environment happy-dom
import type { Map as LeafletMap } from 'leaflet';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StepId, UiMapId, WorldMapId } from '../../domain/ids';
import type { WorldPoint } from '../../domain/points';
import type { LayerContent, LayerId, MapDescriptor, PolylineDescriptor, SurfaceInfo, WorldBounds, ZoneFillDescriptor } from '../adapter';
import { HaloPolyline, ZoneFillShape } from './leaflet-layers';
import { LeafletMapAdapter } from './LeafletMapAdapter';

/*
 * The presentation fixes in the Leaflet adapter, in happy-dom with a recording canvas (the joint
 * review's presentation findings): every line over its halo, drawn first (PR-03); a piece after the
 * active step dashed and faded (PR-02); the coordinate grid's row and its zone-band floor, its labels
 * on the halo (PR-10, QA-26); a faction pattern clipped to land (PR-15, QA-15).
 */

const KALIMDOR = 1 as WorldMapId;
const EXTENT: WorldBounds = { mapId: KALIMDOR, xMin: -11733.299804688, xMax: 12799.900390625, yMin: -19733.2109375, yMax: 17066.599609375 };
const SURFACES: readonly SurfaceInfo[] = [{ id: 'world:1', mapId: KALIMDOR, name: 'Kalimdor', extent: EXTENT, extentSource: 'continent', extentUiMapId: 1414 as UiMapId, uiMapIds: [] }];
const CENTRE: WorldPoint = { mapId: KALIMDOR, x: -600, y: -4200 };
const at = (dx: number, dy: number): WorldPoint => ({ mapId: KALIMDOR, x: CENTRE.x + dx, y: CENTRE.y + dy });

interface Recorded {
  readonly name: string;
  readonly args: readonly unknown[];
}

let calls: Recorded[];
let adapters: LeafletMapAdapter[];
let sizes: { width: PropertyDescriptor | undefined; height: PropertyDescriptor | undefined };

function fakeContext(): CanvasRenderingContext2D {
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

beforeEach(() => {
  calls = [];
  adapters = [];
  const context = fakeContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context);
  sizes = { width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'), height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight') };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
});

afterEach(() => {
  for (const adapter of adapters) adapter.destroy();
  vi.restoreAllMocks();
  for (const [key, descriptor] of [
    ['clientWidth', sizes.width],
    ['clientHeight', sizes.height],
  ] as const) {
    if (descriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, key);
    else Object.defineProperty(HTMLElement.prototype, key, descriptor);
  }
  document.body.innerHTML = '';
});

function setup(): LeafletMapAdapter {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const adapter = new LeafletMapAdapter({ surfaces: SURFACES, initialSurface: 'world:1', observeResize: false, performance: null });
  adapters.push(adapter);
  adapter.mount(host);
  return adapter;
}

const content = (layer: LayerId, items: readonly MapDescriptor[]): LayerContent => ({
  layer,
  items,
  stats: { drawn: items.length, notDrawn: 0, aggregated: 0, unresolved: 0, unresolvedBy: {}, otherSurfaces: 0 },
});

const leafletOf = (adapter: LeafletMapAdapter, layer: LayerId, id: string): unknown =>
  (adapter as unknown as { layers: Record<LayerId, { drawn: Map<string, { leaflet: unknown }> }> }).layers[layer].drawn.get(id)?.leaflet;

const line = (id: string, fields: Partial<PolylineDescriptor> = {}): PolylineDescriptor => ({
  type: 'polyline',
  id,
  mapId: KALIMDOR,
  points: [at(0, -400), at(0, 400)],
  style: 'route',
  emphasis: 'normal',
  label: 'Route',
  ref: { kind: 'run', style: 'route', stepIds: ['a', 'b'] as StepId[] },
  ...fields,
});

describe('lines over their halos (§25.4; review PR-03) and the route after the active step (§13.6; PR-02)', () => {
  it('strokes the halo, 5.5 px in the label halo, before the 2.6 px route line', () => {
    const adapter = setup();
    adapter.setLayer('route-line', content('route-line', [line('run:1:route:a')]));
    calls.length = 0;
    adapter.setViewport({ center: CENTRE, zoom: -2 });
    const widths = calls.filter((call) => call.name === 'set:lineWidth').map((call) => call.args[0]);
    const halo = widths.indexOf(5.5);
    expect(halo).toBeGreaterThanOrEqual(0);
    expect(widths.indexOf(2.6)).toBeGreaterThan(halo);
    const leaflet = leafletOf(adapter, 'route-line', 'run:1:route:a');
    expect(leaflet).toBeInstanceOf(HaloPolyline);
    expect((leaflet as HaloPolyline).halo?.weight).toBe(5.5);
  });

  it('gives the network lines a 3 px halo, and draws a piece after the active step dashed 5-6 at 55 %', () => {
    const adapter = setup();
    adapter.setLayer('flight-network', content('flight-network', [line('flight:1-2', { style: 'network-flight', ref: { kind: 'taxi-path', from: 1, to: 2 } as never })]));
    adapter.setLayer('route-line', content('route-line', [line('run:1:route:a>after', { after: true })]));
    adapter.setViewport({ center: CENTRE, zoom: -2 });
    expect((leafletOf(adapter, 'flight-network', 'flight:1-2') as HaloPolyline).halo?.weight).toBe(3);
    const after = leafletOf(adapter, 'route-line', 'run:1:route:a>after') as HaloPolyline;
    expect(after.options).toMatchObject({ dashArray: '5 6', opacity: 0.55 });
  });
});

describe('the coordinate grid (review PR-10, QA-26)', () => {
  const gridLabels = (): readonly string[] => calls.filter((call) => call.name === 'fillText' && /^[XY] /.test(String(call.args[0]))).map((call) => String(call.args[0]));

  it('draws its labels on the halo from the zone band, none below it, and none while its row hides it', () => {
    const adapter = setup();
    calls.length = 0;
    adapter.setViewport({ center: CENTRE, zoom: -2 });
    expect(gridLabels().length).toBeGreaterThan(0);
    // Each label is stroked in the halo first (QA-26).
    const strokes = calls.filter((call) => call.name === 'strokeText' && /^[XY] /.test(String(call.args[0]))).map((call) => String(call.args[0]));
    expect(strokes).toEqual(gridLabels());
    calls.length = 0;
    adapter.setViewport({ center: CENTRE, zoom: -4 });
    expect(gridLabels()).toEqual([]);
    adapter.setViewport({ center: CENTRE, zoom: -2 });
    adapter.setGrid(false);
    calls.length = 0;
    adapter.setViewport({ center: CENTRE, zoom: -1.5 });
    expect(gridLabels()).toEqual([]);
  });
});

describe('the faction patterns on land only (§12.6; review PR-15, QA-15)', () => {
  it('clips a faction fill to its land rings before filling, and a hover over its sea is not on it', () => {
    const adapter = setup();
    const ring = (x0: number, y0: number, x1: number, y1: number): readonly WorldPoint[] => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)];
    const fill: ZoneFillDescriptor = {
      type: 'zone-fill',
      id: 'faction:1:14',
      mapId: KALIMDOR,
      areaId: 14,
      rings: [ring(-2000, -2000, 2000, 2000)],
      fill: { pattern: 'horde' },
      label: 'Durotar: Horde territory',
      ref: { kind: 'zone', uiMapId: 1411 as UiMapId },
      words: 'Horde territory',
      land: [ring(-2000, -2000, 2000, 0)],
    };
    adapter.setViewport({ center: CENTRE, zoom: -4 });
    adapter.setLayer('zone-fill', content('zone-fill', [fill]));
    calls.length = 0;
    adapter.setViewport({ center: CENTRE, zoom: -4.5 });
    const names = calls.map((call) => call.name);
    const clip = names.indexOf('clip');
    expect(clip).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('fill', clip)).toBeGreaterThan(clip);
    const shape = leafletOf(adapter, 'zone-fill', fill.id) as ZoneFillShape;
    expect(shape).toBeInstanceOf(ZoneFillShape);
    const map = (adapter as unknown as { map: LeafletMap }).map;
    const toLayer = (p: WorldPoint) => map.latLngToLayerPoint([p.x, -p.y]);
    const internals = shape as unknown as { _containsPoint(p: unknown): boolean };
    // Land (the ring's half with y below the centre's) and sea (the other half) of the zone.
    expect(internals._containsPoint(toLayer(at(1000, -1000)))).toBe(true);
    expect(internals._containsPoint(toLayer(at(1000, 1000)))).toBe(false);
  });
});
