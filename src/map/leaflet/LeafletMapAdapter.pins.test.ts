// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NpcId, QuestId, WorldMapId } from '../../domain/ids';
import type { WorldPoint } from '../../domain/points';
import type { ClusterMember, LayerContent, LayerId, MapCategoryId, MapDescriptor, MapEvent, MapRef, MarkerDescriptor, MarkerMark, SurfaceInfo, WorldBounds } from '../adapter';
import { pinGeometry } from '../marks-pins';
import { GlyphMarker, PinMarker } from './leaflet-layers';
import { pinDiameterFor } from './pins';
import { LeafletMapAdapter, type LeafletMapAdapterOptions } from './LeafletMapAdapter';

/*
 * The pins in the Leaflet adapter (docs/research/map-presentation.md §25.2, §25.3.4; step MP.4a), in
 * happy-dom: pins as paths drawn from bitmaps, their sizes by band, the stacks at the zone band, the
 * drawer's mask and the search filter (a redraw, never a rebuild), the thresholds of places and
 * services, the nearest-head hit rule, the selected pin, and the forced-colours palette.
 */

const npcId = (value: number): NpcId => value as NpcId;
const questId = (value: number): QuestId => value as QuestId;
const KALIMDOR = 1 as WorldMapId;
const EXTENT: WorldBounds = { mapId: KALIMDOR, xMin: -11733.299804688, xMax: 12799.900390625, yMin: -19733.2109375, yMax: 17066.599609375 };
const SURFACES: readonly SurfaceInfo[] = [
  { id: 'world:1', mapId: KALIMDOR, name: 'Kalimdor', extent: EXTENT, extentSource: 'continent', extentUiMapId: 1414 as never, uiMapIds: [] },
];
const CENTRE: WorldPoint = { mapId: KALIMDOR, x: -600, y: -4200 };
const at = (dx: number, dy: number): WorldPoint => ({ mapId: KALIMDOR, x: CENTRE.x + dx, y: CENTRE.y + dy });

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

const mark = (state: MarkerMark['state'], difficulty: MarkerMark['difficulty'] = 'standard'): MarkerMark => ({ state, difficulty, dungeonQuest: false, progress: null });

function pin(id: number, point: WorldPoint, fields: Partial<MarkerDescriptor> = {}): MarkerDescriptor {
  const ref: MapRef = { kind: 'spawn', subject: { kind: 'npc', id: npcId(id) }, spawnIndex: 0, questIds: [questId(id)] };
  return {
    type: 'marker',
    id: `spawn:npc:${String(id)}:0`,
    point,
    kind: 'quest-start',
    style: 'neutral',
    emphasis: 'normal',
    label: `Giver ${String(id)}`,
    badges: [],
    ref,
    count: 1,
    refs: [ref],
    labels: [`Giver ${String(id)}`],
    mark: mark('available'),
    category: 'available',
    ...fields,
  };
}

const member = (id: number, category: MapCategoryId, state: MarkerMark['state'] = 'available'): ClusterMember => ({ questId: questId(id), mark: mark(state), category, subjects: [`npc:${String(id)}`] });

function clusterPin(point: WorldPoint, members: readonly ClusterMember[]): MarkerDescriptor {
  const bounds: WorldBounds = { mapId: KALIMDOR, xMin: point.x - 100, xMax: point.x + 100, yMin: point.y - 100, yMax: point.y + 100 };
  const ref: MapRef = { kind: 'cluster', layer: 'available-quests', bounds, quests: members.length, places: members.length };
  return { ...pin(900, point), id: 'cluster:available-quests:1024:0:0', ref, refs: [ref], labels: ['A cluster'], cluster: { members, places: members.length, points: members.length, bounds, cellYards: 1024 } };
}

let adapters: LeafletMapAdapter[];
let sizes: { width: PropertyDescriptor | undefined; height: PropertyDescriptor | undefined };

beforeEach(() => {
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

function setup(options: Partial<LeafletMapAdapterOptions> = {}): { readonly adapter: LeafletMapAdapter; readonly host: HTMLElement; readonly events: MapEvent[] } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const adapter = new LeafletMapAdapter({ surfaces: SURFACES, initialSurface: 'world:1', observeResize: false, performance: null, ...options });
  adapters.push(adapter);
  const events: MapEvent[] = [];
  for (const type of ['click', 'hover'] as const) {
    adapter.on(type, (event) => {
      events.push(event);
    });
  }
  adapter.mount(host);
  return { adapter, host, events };
}

const leafletOf = (adapter: LeafletMapAdapter, layer: LayerId, id: string): unknown =>
  (adapter as unknown as { layers: Record<LayerId, { drawn: Map<string, { leaflet: unknown }> }> }).layers[layer].drawn.get(id)?.leaflet;

const pinOf = (adapter: LeafletMapAdapter, layer: LayerId, id: string): PinMarker => {
  const leaflet = leafletOf(adapter, layer, id);
  if (!(leaflet instanceof PinMarker)) throw new Error(`${layer}/${id} is not a pin`);
  return leaflet;
};

/** A pin head's place on screen at the zone band (D 26): above the item's point. */
function headAt(adapter: LeafletMapAdapter, point: WorldPoint, diameter = 26): { readonly x: number; readonly y: number } {
  const view = adapter.getView();
  if (view === null) throw new Error('not mounted');
  const scale = 2 ** view.zoom;
  return { x: (view.bounds.yMax - point.y) * scale, y: (view.bounds.xMax - point.x) * scale - pinGeometry(diameter).centreToPoint };
}

function press(host: HTMLElement, type: 'click' | 'mousemove', where: { readonly x: number; readonly y: number }): void {
  const canvas = host.querySelector<HTMLCanvasElement>('.leaflet-overlay-pane canvas:not(.frl-map__grid)');
  if (canvas === null) throw new Error('no path canvas');
  canvas.dispatchEvent(new MouseEvent(type, { clientX: where.x, clientY: where.y, bubbles: true, cancelable: true }));
}

describe('pins in the adapter (map-presentation.md §25.2; step MP.4a)', () => {
  it('draws quest givers, turn-ins, counted objectives and flight points as pins, a focused quest’s objective points as dots', () => {
    const { adapter } = setup();
    adapter.setViewport({ center: CENTRE, zoom: -2 });
    adapter.setLayer('available-quests', content('available-quests', [pin(1, at(0, 0))]));
    adapter.setLayer('turn-ins', content('turn-ins', [pin(2, at(500, 0), { kind: 'quest-end', mark: mark('ready'), category: 'turn-ins' })]));
    adapter.setLayer('objectives', content('objectives', [pin(3, at(-500, 0), { kind: 'objective', mark: mark('objective', null), category: 'objectives' }), pin(4, at(-500, 500), { kind: 'objective', category: 'objectives', mark: undefined as never })]));
    adapter.setLayer('flight-masters', content('flight-masters', [pin(5, at(0, 500), { kind: 'flight-master', mark: undefined as never, category: 'flight-points' })]));
    expect(leafletOf(adapter, 'available-quests', 'spawn:npc:1:0')).toBeInstanceOf(PinMarker);
    expect(leafletOf(adapter, 'turn-ins', 'spawn:npc:2:0')).toBeInstanceOf(PinMarker);
    expect(leafletOf(adapter, 'objectives', 'spawn:npc:3:0')).toBeInstanceOf(PinMarker);
    expect(leafletOf(adapter, 'objectives', 'spawn:npc:4:0')).toBeInstanceOf(GlyphMarker);
    expect(leafletOf(adapter, 'flight-masters', 'spawn:npc:5:0')).toBeInstanceOf(PinMarker);
    expect(pinOf(adapter, 'available-quests', 'spawn:npc:1:0').spec).toMatchObject({ glyph: 'quest', diameter: 26, colour: 'standard' });
    expect(pinOf(adapter, 'objectives', 'spawn:npc:3:0').spec).toMatchObject({ glyph: 'objective', diameter: 26 * 0.8 });
    expect(adapter.renderStats().pins).toMatchObject({ drawn: 4, hidden: 0, diameter: 26 });
    // A view reset redraws at once: the pins are drawn from bitmaps.
    adapter.setViewport({ center: at(1, 1), zoom: -2 });
    expect(adapter.renderStats().pins?.bitmaps).toBeGreaterThan(0);
  });

  it('sizes pins by band: 12 px zoomed out, 26 from the zone band, re-drawn at each settle (§25.2.4)', () => {
    const { adapter } = setup();
    adapter.setViewport({ center: CENTRE, zoom: -7 });
    adapter.setLayer('available-quests', content('available-quests', [pin(1, at(0, 0))]));
    expect(pinOf(adapter, 'available-quests', 'spawn:npc:1:0').spec).toMatchObject({ diameter: 12, colour: null });
    // Leaflet snaps to whole levels without CSS 3D (happy-dom): −4 is 0.0625 px/yd, D 22.
    adapter.setViewport({ center: CENTRE, zoom: -4 });
    expect(adapter.renderStats().pins?.diameter).toBe(pinDiameterFor(2 ** -4));
    expect(pinOf(adapter, 'available-quests', 'spawn:npc:1:0').spec.diameter).toBe(22);
    adapter.setViewport({ center: CENTRE, zoom: -2 });
    expect(pinOf(adapter, 'available-quests', 'spawn:npc:1:0').spec).toMatchObject({ diameter: 26, colour: 'standard' });
  });

  it('stacks pins of one kind whose heads overlap into their first with "×n" at the zone band, and not below it (§25.2.5)', () => {
    const { adapter } = setup();
    adapter.setViewport({ center: CENTRE, zoom: -2 });
    // 20 yd apart at 0.25 px/yd: 5 px, within 0.4 × 26.
    adapter.setLayer('available-quests', content('available-quests', [pin(1, at(0, 0)), pin(2, at(20, 0)), pin(3, at(400, 0))]));
    expect(adapter.renderStats().pins).toMatchObject({ drawn: 2, merged: 1, stacks: 1 });
    expect(pinOf(adapter, 'available-quests', 'spawn:npc:1:0').spec.count).toBe('×2');
    expect(pinOf(adapter, 'available-quests', 'spawn:npc:2:0').frlHidden).toBe(true);
    // Zoomed in, they part.
    adapter.setViewport({ center: CENTRE, zoom: 1 });
    expect(adapter.renderStats().pins).toMatchObject({ drawn: 3, merged: 0, stacks: 0 });
    // A turn-in over a giver is another kind: never merged.
    adapter.setViewport({ center: CENTRE, zoom: -2 });
    adapter.setLayer('turn-ins', content('turn-ins', [pin(4, at(5, 0), { kind: 'quest-end', mark: mark('ready'), category: 'turn-ins' })]));
    expect(pinOf(adapter, 'turn-ins', 'spawn:npc:4:0').frlHidden).toBe(false);
  });

  it('hides a category by the mask, a redraw and no rebuild, and a cluster counts only its members still drawn (§25.3.4)', () => {
    const { adapter, host, events } = setup();
    adapter.setViewport({ center: CENTRE, zoom: -2 });
    const locked = pin(2, at(0, 600), { mark: mark('locked'), category: 'needs-prerequisite' });
    const items = [pin(1, at(0, 0)), locked];
    adapter.setLayer('available-quests', content('available-quests', items));
    adapter.setMask({ hidden: ['needs-prerequisite'], only: null });
    expect(pinOf(adapter, 'available-quests', 'spawn:npc:2:0').frlHidden).toBe(true);
    expect(pinOf(adapter, 'available-quests', 'spawn:npc:1:0').frlHidden).toBe(false);
    // Not hit either: the press is on empty map.
    press(host, 'click', headAt(adapter, locked.point));
    expect(events.filter((event) => event.type === 'click').at(-1)).toMatchObject({ hit: null });
    // The same descriptors stay drawn: the mask changed no layer content.
    expect(leafletOf(adapter, 'available-quests', 'spawn:npc:2:0')).toBeInstanceOf(PinMarker);
    adapter.setMask({ hidden: [], only: null });
    expect(pinOf(adapter, 'available-quests', 'spawn:npc:2:0').frlHidden).toBe(false);
    // A cluster keeps its drawn members only, and goes when none is left.
    adapter.setViewport({ center: CENTRE, zoom: -5 });
    adapter.setLayer('available-quests', content('available-quests', [clusterPin(at(0, 0), [member(11, 'available'), member(12, 'available'), member(13, 'needs-prerequisite', 'locked')])]));
    expect(pinOf(adapter, 'available-quests', 'cluster:available-quests:1024:0:0').spec.count).toBe('×3');
    adapter.setMask({ hidden: ['needs-prerequisite'], only: null });
    expect(pinOf(adapter, 'available-quests', 'cluster:available-quests:1024:0:0').spec).toMatchObject({ count: '×2' });
    adapter.setMask({ hidden: ['available', 'needs-prerequisite'], only: null });
    expect(pinOf(adapter, 'available-quests', 'cluster:available-quests:1024:0:0').frlHidden).toBe(true);
  });

  it('draws only what a map search found, by place or quest (§25.3.5)', () => {
    const { adapter } = setup();
    adapter.setViewport({ center: CENTRE, zoom: -2 });
    adapter.setLayer('available-quests', content('available-quests', [pin(1, at(0, 0)), pin(2, at(0, 600)), pin(3, at(0, 1200))]));
    adapter.setMask({ hidden: [], only: { subjects: ['npc:1'], quests: [questId(3)] } });
    expect(['spawn:npc:1:0', 'spawn:npc:2:0', 'spawn:npc:3:0'].map((id) => pinOf(adapter, 'available-quests', id).frlHidden)).toEqual([false, true, false]);
    adapter.setMask({ hidden: [], only: null });
    expect(adapter.renderStats().pins?.drawn).toBe(3);
  });

  it('gives a press to the pin whose head centre is nearest, across the pin layers, and a tie to a list (§25.2.7)', () => {
    const { adapter, host, events } = setup();
    adapter.setViewport({ center: CENTRE, zoom: 0 });
    // A giver and a turn-in 12 px apart at 1 px/yd: the turn-in is drawn above the giver.
    const giver = pin(1, at(0, 0));
    const turnIn = pin(2, at(0, -12), { kind: 'quest-end', mark: mark('ready'), category: 'turn-ins' });
    adapter.setLayer('available-quests', content('available-quests', [giver]));
    adapter.setLayer('turn-ins', content('turn-ins', [turnIn]));
    const head = headAt(adapter, giver.point);
    press(host, 'click', { x: head.x - 3, y: head.y });
    expect(events.filter((event) => event.type === 'click').at(-1)).toMatchObject({ hit: { layer: 'available-quests', id: 'spawn:npc:1:0' } });
    press(host, 'click', { x: head.x + 10, y: head.y });
    expect(events.filter((event) => event.type === 'click').at(-1)).toMatchObject({ hit: { layer: 'turn-ins', id: 'spawn:npc:2:0' } });
    // Halfway: a tie, every ref of both.
    press(host, 'click', { x: head.x + 6, y: head.y });
    const tie = events.filter((event) => event.type === 'click').at(-1);
    expect(tie?.type === 'click' ? tie.hit?.refs.length : null).toBe(2);
  });

  it('draws places from 0.0325 px/yd with hysteresis, and services from 0.149 (§25.2.2)', () => {
    const { adapter } = setup();
    // Whole levels (happy-dom snaps to them): −5 is 0.031 px/yd, −4 0.0625, −3 0.125, −2 0.25.
    adapter.setViewport({ center: CENTRE, zoom: -5 });
    adapter.setLayer('flight-masters', content('flight-masters', [pin(5, at(0, 0), { kind: 'flight-master', mark: undefined as never, category: 'flight-points' })]));
    adapter.setLayer('services', content('services', [pin(6, at(0, 500), { kind: 'flight-master', mark: mark('innkeeper', null), category: 'innkeepers' })]));
    expect(pinOf(adapter, 'flight-masters', 'spawn:npc:5:0').frlHidden).toBe(true);
    adapter.setViewport({ center: CENTRE, zoom: -4 });
    expect(pinOf(adapter, 'flight-masters', 'spawn:npc:5:0').frlHidden).toBe(false);
    expect(pinOf(adapter, 'services', 'spawn:npc:6:0').frlHidden).toBe(true);
    adapter.setViewport({ center: CENTRE, zoom: -3 });
    expect(pinOf(adapter, 'services', 'spawn:npc:6:0').frlHidden).toBe(true);
    adapter.setViewport({ center: CENTRE, zoom: -2 });
    expect(pinOf(adapter, 'services', 'spawn:npc:6:0').frlHidden).toBe(false);
    expect(pinOf(adapter, 'services', 'spawn:npc:6:0').spec).toMatchObject({ family: 'light', diameter: 26 * 0.8 });
  });

  it('draws the chosen pin selected on top, and its hover with the wider keyline (§25.2.3)', () => {
    const { adapter } = setup();
    adapter.setViewport({ center: CENTRE, zoom: -2 });
    adapter.setLayer('available-quests', content('available-quests', [pin(1, at(0, 0))]));
    adapter.selectPins({ layer: 'available-quests', ids: ['spawn:npc:1:0'] });
    expect(adapter.drawOrder().at(-1)).toBe('highlight/selected:available-quests/spawn:npc:1:0');
    adapter.highlight({ layer: 'available-quests', ids: ['spawn:npc:1:0'] });
    const overlays = (adapter as unknown as { overlays: Map<string, { path: PinMarker }> }).overlays;
    expect(overlays.get('selected:available-quests/spawn:npc:1:0')?.path.spec.state).toBe('selected');
    expect(overlays.get('available-quests/spawn:npc:1:0')?.path.spec.state).toBe('hover');
    adapter.selectPins(null);
    adapter.highlight(null);
    expect(overlays.size).toBe(0);
  });

  it('follows forced colours: the palette from the probe, and the pins redrawn from new bitmaps (§25.2.9)', () => {
    let forced = false;
    const listeners: (() => void)[] = [];
    const original = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
      if (query !== '(forced-colors: active)') return original(query);
      return {
        get matches() {
          return forced;
        },
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: () => void) => {
          listeners.push(listener);
        },
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => true,
      } as unknown as MediaQueryList;
    });
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => {
      if (element.classList.contains('frl-map__probe')) {
        return { color: 'rgb(255, 255, 255)', backgroundColor: 'rgb(0, 0, 0)', borderTopColor: 'rgb(0, 255, 255)', getPropertyValue: () => '' } as unknown as CSSStyleDeclaration;
      }
      return computed(element);
    });
    const { adapter, host } = setup();
    expect(host.querySelector('.frl-map__probe')?.getAttribute('aria-hidden')).toBe('true');
    adapter.setViewport({ center: CENTRE, zoom: -2 });
    adapter.setLayer('available-quests', content('available-quests', [pin(1, at(0, 0), { mark: mark('locked'), category: 'needs-prerequisite' })]));
    const palette = (): { forced: boolean; body: string; ring: string } => (adapter as unknown as { pinPalette: { forced: boolean; body: string; ring: string } }).pinPalette;
    expect(palette().forced).toBe(false);
    const bitmaps = adapter.renderStats().pins?.bitmaps ?? 0;
    forced = true;
    for (const listener of listeners) listener();
    expect(palette()).toMatchObject({ forced: true, body: 'rgb(0, 0, 0)', ring: 'rgb(0, 255, 255)' });
    // A synchronous redraw (a view reset) draws the pins again, from bitmaps of the new palette.
    adapter.setViewport({ center: at(10, 10), zoom: -2 });
    expect(adapter.renderStats().pins?.bitmaps).toBeGreaterThan(bitmaps);
  });
});
