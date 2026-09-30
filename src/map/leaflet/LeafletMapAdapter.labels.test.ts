// @vitest-environment happy-dom
import { pinGeometry } from '../marks-pins';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NpcId, StepId, UiMapId, WorldMapId } from '../../domain/ids';
import type { WorldPoint } from '../../domain/points';
import type { AreaDescriptor, LabelDescriptor, LayerContent, LayerId, MapDescriptor, MapEvent, MapStepNumbers, MarkerDescriptor, SurfaceInfo, WorldBounds } from '../adapter';
import { LeafletMapAdapter, type LeafletMapAdapterOptions } from './LeafletMapAdapter';
import type { PerformanceLike } from './perf';

/**
 * The labels canvas in the Leaflet adapter (docs/research/map-presentation.md §5.5, §13; step MP.1):
 * it takes no hits, draws in the next frame, redraws alone after a renumbering, numbers the beads
 * at the zone and close bands only, and cross-fades the outgoing pictures at a band change.
 * happy-dom has no canvas: `getContext` returns a recording stand-in, and animation frames are
 * collected and run by the test.
 */

const npcId = (value: number): NpcId => value as NpcId;
const stepId = (value: string): StepId => value as StepId;
const uiMapId = (value: number): UiMapId => value as UiMapId;
const worldMapId = (value: number): WorldMapId => value as WorldMapId;

const KALIMDOR = worldMapId(1);
const KALIMDOR_EXTENT: WorldBounds = { mapId: KALIMDOR, xMin: -11733.299804688, xMax: 12799.900390625, yMin: -19733.2109375, yMax: 17066.599609375 };
const SURFACES: readonly SurfaceInfo[] = [
  { id: 'world:1', mapId: KALIMDOR, name: 'Kalimdor', extent: KALIMDOR_EXTENT, extentSource: 'continent', extentUiMapId: uiMapId(1414), uiMapIds: [] },
];
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
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function fakePerformance(): PerformanceLike & { readonly measures: string[] } {
  const measures: string[] = [];
  return {
    measures,
    mark: () => undefined,
    measure: (name) => {
      measures.push(name);
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

const single = (fields: Omit<MarkerDescriptor, 'type' | 'count' | 'refs' | 'labels'>): MarkerDescriptor => ({ type: 'marker', ...fields, count: 1, refs: [fields.ref], labels: [fields.label] });

const bead = (id: string, point: WorldPoint): MarkerDescriptor =>
  single({ id: `step:${id}`, point, kind: 'step', style: 'accent', emphasis: 'normal', label: id, badges: [], ref: { kind: 'step', stepId: stepId(id) } });

const giver = (id: number, point: WorldPoint): MarkerDescriptor =>
  single({
    id: `spawn:npc:${String(id)}:0`,
    point,
    kind: 'quest-start',
    style: 'neutral',
    emphasis: 'normal',
    label: 'Gornek',
    badges: [],
    ref: { kind: 'spawn', subject: { kind: 'npc', id: npcId(id) }, spawnIndex: 0, questIds: [] },
  });

const zoneLabel = (id: string, point: WorldPoint, text: string): LabelDescriptor => ({
  type: 'label',
  id,
  point,
  kind: 'zone',
  text,
  card: null,
  priority: 5,
  minPxPerYard: 0,
  maxPxPerYard: null,
  label: null,
  ref: { kind: 'zone', uiMapId: uiMapId(1411) },
});

let calls: Recorded[];
let adapters: LeafletMapAdapter[];
let frames: (() => void)[];
let sizes: { width: PropertyDescriptor | undefined; height: PropertyDescriptor | undefined };

beforeEach(() => {
  calls = [];
  adapters = [];
  frames = [];
  const context = fakeContext(calls);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context);
  sizes = { width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'), height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight') };
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
  restore('clientWidth', sizes.width);
  restore('clientHeight', sizes.height);
  document.body.innerHTML = '';
});

/** Runs every pending animation frame (and any they request), as the page would. */
function runFrames(): void {
  for (let i = 0; i < 10 && frames.length > 0; i += 1) frames.splice(0).forEach((frame) => frame());
}

function setup(options: Partial<LeafletMapAdapterOptions> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const perf = fakePerformance();
  const numbers = new Map<string, number>();
  let active: StepId | null = null;
  const stepNumbers: MapStepNumbers = { stepNumber: (id) => numbers.get(id) ?? null, activeStep: () => active };
  const adapter = new LeafletMapAdapter({
    surfaces: SURFACES,
    initialSurface: 'world:1',
    observeResize: false,
    performance: perf,
    stepNumbers,
    frames: {
      request: (callback) => {
        frames.push(callback);
        return frames.length;
      },
      cancel: () => undefined,
    },
    ...options,
  });
  adapters.push(adapter);
  const events: MapEvent[] = [];
  adapter.on('click', (event) => {
    events.push(event);
  });
  adapter.mount(host);
  runFrames();
  return {
    adapter,
    host,
    perf,
    events,
    numbers,
    setActive: (id: string | null) => {
      active = id === null ? null : stepId(id);
    },
  };
}

const labelsCanvas = (host: HTMLElement): HTMLCanvasElement => {
  const canvas = host.querySelector<HTMLCanvasElement>('.leaflet-frl-labels-pane canvas.frl-map__labels');
  if (canvas === null) throw new Error('no labels canvas');
  return canvas;
};
const filled = (): readonly string[] => calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
const count = (names: readonly string[], name: string): number => names.filter((entry) => entry === name).length;

describe('the labels canvas (map-presentation.md §5.5, §13)', () => {
  it('sits in its own pane above the paths and takes no pointer events: a click where a label is still hits the marker under it', () => {
    const s = setup();
    s.adapter.setViewport({ center: GORNEK, zoom: -2 });
    s.adapter.setLayer('available-quests', content('available-quests', [giver(3143, GORNEK)]));
    s.adapter.setLayer('labels', content('labels', [zoneLabel('label:durotar', GORNEK, 'Durotar')]));
    runFrames();
    const canvas = labelsCanvas(s.host);
    expect(canvas.style.pointerEvents).toBe('none');
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(s.host.querySelector<HTMLElement>('.leaflet-frl-labels-pane')?.style.zIndex).toBe('450');
    expect(filled()).toContain('Durotar');
    expect(s.adapter.renderStats().labels).toMatchObject({ placed: 1, skipped: [] });
    // The label is never a hit target: the click reaches the giver under it.
    const path = s.host.querySelector<HTMLCanvasElement>('.leaflet-overlay-pane canvas');
    const view = s.adapter.getView();
    if (path === null || view === null) throw new Error('not mounted');
    const scale = 2 ** view.zoom;
    // The giver's pin head, above its point (map-presentation.md §25.2.1).
    const at = { x: (view.bounds.yMax - GORNEK.y) * scale, y: (view.bounds.xMax - GORNEK.x) * scale - pinGeometry(26).centreToPoint };
    path.dispatchEvent(new MouseEvent('click', { clientX: at.x, clientY: at.y, bubbles: true, cancelable: true }));
    expect(s.events.at(-1)).toMatchObject({ type: 'click', hit: { layer: 'available-quests', id: 'spawn:npc:3143:0' } });
    // Labels count against the path cap like canvas paths.
    expect(s.adapter.renderStats().layers.labels.drawn).toBe(1);
    expect(s.adapter.renderStats().paths).toBe(2);
  });

  it('numbers the beads at the zone and close bands after the frame, the active step first, never a stack', () => {
    const s = setup();
    const near = { ...GORNEK, x: GORNEK.x + 2 };
    s.numbers.set('a', 3);
    s.numbers.set('b', 4);
    s.numbers.set('c', 9);
    s.adapter.setViewport({ center: GORNEK, zoom: -2 });
    const stack: MarkerDescriptor = { ...bead('c', { ...GORNEK, x: GORNEK.x + 400 }), count: 2, refs: [{ kind: 'step', stepId: stepId('c') }, { kind: 'step', stepId: stepId('d') }], labels: ['c', 'd'] };
    s.adapter.setLayer('route-steps', content('route-steps', [bead('a', GORNEK), bead('b', near), stack]));
    calls.length = 0;
    runFrames();
    // 'b' is within 16 px of 'a': one of them is numbered, the active one first.
    expect(filled()).toEqual(['3']);
    s.setActive('b');
    s.adapter.refreshLabels();
    calls.length = 0;
    runFrames();
    expect(filled()).toEqual(['4']);
    expect(s.adapter.renderStats().labels).toMatchObject({ band: 'zone', stepNumbers: 1, stepNumbersSkipped: 1 });
    // At the continent band no numbers are drawn.
    s.adapter.setViewport({ center: GORNEK, zoom: -5 });
    calls.length = 0;
    runFrames();
    expect(filled()).toEqual([]);
    expect(s.adapter.renderStats().labels).toMatchObject({ band: 'continent', stepNumbers: 0 });
  });

  it('redraws only the labels canvas after a renumbering, in the next frame, and nothing on the path canvas', () => {
    const s = setup();
    s.numbers.set('a', 1);
    s.adapter.setViewport({ center: GORNEK, zoom: -2 });
    s.adapter.setLayer('route-steps', content('route-steps', [bead('a', GORNEK)]));
    runFrames();
    const measures = [...s.perf.measures];
    const draws = s.adapter.renderStats().labels.draws;
    // An insert above renumbers step 'a' without changing any descriptor.
    s.numbers.set('a', 2);
    calls.length = 0;
    s.adapter.refreshLabels();
    // Nothing is drawn until the frame.
    expect(filled()).toEqual([]);
    runFrames();
    expect(filled()).toEqual(['2']);
    const added = s.perf.measures.slice(measures.length);
    expect(count(added, 'frl:map:labels')).toBe(1);
    expect(count(added, 'frl:map:redraw')).toBe(0);
    expect(count(added, 'frl:map:update-paths')).toBe(0);
    expect(count(added, 'frl:map:set-layer')).toBe(0);
    expect(s.adapter.renderStats().labels.draws).toBe(draws + 1);
    // Several requests in one frame draw once.
    s.adapter.refreshLabels();
    s.adapter.refreshLabels();
    runFrames();
    expect(s.adapter.renderStats().labels.draws).toBe(draws + 2);
  });

  it('draws an objective outline as a non-interactive haloed polygon, with its completing step number above it', () => {
    const s = setup();
    s.numbers.set('done', 22);
    s.adapter.setViewport({ center: GORNEK, zoom: -2 });
    const ring = [GORNEK, { ...GORNEK, x: GORNEK.x + 200 }, { ...GORNEK, y: GORNEK.y + 200 }];
    const area: AreaDescriptor = { type: 'area', id: 'area:q:1', mapId: KALIMDOR, ring, style: 'objective-area', labelStep: stepId('done'), label: 'Objectives of a quest', ref: { kind: 'zone', uiMapId: uiMapId(1411) } };
    s.adapter.setLayer('objectives', content('objectives', [area]));
    calls.length = 0;
    runFrames();
    expect(filled()).toContain('22');
    expect(s.adapter.drawOrder()).toContain('objectives/area:q:1');
    // A turn-in that carries the work (D-040) is numbered "t 22" (map-presentation.md §7.4; MP.3).
    s.adapter.setLayer('objectives', content('objectives', [{ ...area, labelTurnIn: true }]));
    calls.length = 0;
    s.adapter.refreshLabels();
    runFrames();
    expect(filled()).toContain('t 22');
  });

  it('draws a zone card with the difficulty twin on its second line, from the card scale to the zone band (MP.7)', () => {
    const s = setup();
    s.adapter.setViewport({ center: GORNEK, zoom: Math.log2(0.06) });
    const card: LabelDescriptor = {
      ...zoneLabel('zone:1411', GORNEK, 'Durotar'),
      maxPxPerYard: 0.3,
      card: { name: 'Durotar', span: 'quests 6–13 (10)', compact: '6–13', basis: 'derived', difficulty: { key: 'standard', levelText: '18', lowerBound: false }, widthPx: 120 },
    };
    s.adapter.setLayer('labels', content('labels', [card]));
    calls.length = 0;
    s.adapter.refreshLabels();
    runFrames();
    // The name, the twin's level, the span and the boxed E.
    expect(filled()).toEqual(expect.arrayContaining(['Durotar', '18', 'quests 6–13 (10)', 'E']));
    expect(s.adapter.renderStats().labels.placed).toBe(1);
  });

  it('draws the zone fills on the path canvas: a tint without hits, a faction pattern that takes the hover (MP.10)', () => {
    const s = setup();
    s.adapter.setViewport({ center: GORNEK, zoom: -5 });
    const ring = [GORNEK, { ...GORNEK, x: GORNEK.x + 2000 }, { ...GORNEK, y: GORNEK.y + 2000 }, GORNEK];
    const tint: MapDescriptor = { type: 'zone-fill', id: 'tint:1:14', mapId: KALIMDOR, areaId: 14, rings: [ring], fill: { tint: '#886f4b' }, label: null, ref: { kind: 'zone', uiMapId: uiMapId(1411) } };
    const faction: MapDescriptor = { ...tint, id: 'faction:1:14', fill: { pattern: 'horde' }, label: 'Durotar: Horde territory' };
    calls.length = 0;
    s.adapter.setLayer('zone-fill', content('zone-fill', [tint, faction]));
    expect(s.adapter.drawOrder().filter((entry) => entry.startsWith('zone-fill/'))).toEqual(['zone-fill/tint:1:14', 'zone-fill/faction:1:14']);
    // The pattern's tile was drawn in the hatch colour and made a pattern.
    expect(calls.some((call) => call.name === 'createPattern')).toBe(true);
    expect(s.adapter.renderStats().layers['zone-fill'].drawn).toBe(2);
  });

  it('cross-fades the outgoing path and label pictures at a band change, and not under reduced motion', async () => {
    const s = setup();
    s.adapter.setViewport({ center: GORNEK, zoom: -2 });
    s.adapter.setLayer('available-quests', content('available-quests', [giver(3143, GORNEK)]));
    runFrames();
    // The first view (fitted, at the continent band) gave way to the zone band: let that fade end.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const path = s.host.querySelector<HTMLCanvasElement>('.leaflet-overlay-pane canvas');
    const labels = labelsCanvas(s.host);
    if (path === null) throw new Error('no path canvas');
    // happy-dom's canvases have no backing size of their own: give them one, as a browser would.
    path.width = 1000;
    path.height = 800;
    labels.width = 1000;
    labels.height = 800;
    // A pan within the band: no fade.
    s.adapter.setViewport({ center: { ...GORNEK, y: GORNEK.y + 100 }, zoom: -2 });
    expect(s.host.querySelectorAll('.frl-map__fade')).toHaveLength(0);
    // Zooming out past the zone band's edge: both pictures fade out over 140 ms.
    s.adapter.setViewport({ center: GORNEK, zoom: -5 });
    const fades = [...s.host.querySelectorAll<HTMLCanvasElement>('.frl-map__fade')];
    expect(fades).toHaveLength(2);
    for (const fade of fades) {
      expect(fade.style.pointerEvents).toBe('none');
      expect(fade.style.transition).toContain('140ms');
      expect(fade.classList.contains('leaflet-zoom-hide')).toBe(true);
    }
    expect(fades[0]?.previousElementSibling).toBe(path);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(s.host.querySelectorAll('.frl-map__fade')).toHaveLength(0);
  });

  it('does not fade under reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as MediaQueryList,
    );
    const s = setup();
    s.adapter.setViewport({ center: GORNEK, zoom: -2 });
    const path = s.host.querySelector<HTMLCanvasElement>('.leaflet-overlay-pane canvas');
    if (path !== null) {
      path.width = 100;
      path.height = 100;
    }
    s.adapter.setViewport({ center: GORNEK, zoom: -5 });
    expect(s.host.querySelectorAll('.frl-map__fade')).toHaveLength(0);
  });
});
