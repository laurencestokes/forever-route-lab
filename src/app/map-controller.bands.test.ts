import { describe, expect, it } from 'vitest';
import { sequentialIdSource, uiMapId, worldMapId, type RouteStep, type StepId } from '../domain';
import type { MapContainer, MapStepNumbers } from '../map/adapter';
import { DEFAULT_LOD } from '../map/layers';
import { fixedClock } from './clock';
import { insertNote } from './commands';
import { createMapController, type MapControllerOptions } from './map-controller';
import { createMapClusterer } from './map-clusters';
import { acceptStepsAt, fakeAdapterFactory, MAP_TEST_DATASET, mapTestWorkspace, type FakeAdapter } from './map-test-helpers';
import { createEditorStore } from './store';
import { MAP_WORDING } from './map-wording';

/**
 * Zoom bands and step numbers in the controller (docs/research/map-presentation.md §5.1, §13.6;
 * step MP.1): each settled view's band with hysteresis, given to the builders as `MapView.band`; a
 * view the controller moves to itself starts afresh; the step numbers it hands the adapter, and the
 * labels canvas redrawn alone after an edit that may renumber.
 */

const T0 = '2026-09-27T12:00:00.000Z';
const KALIMDOR = worldMapId(1);
const DUROTAR = uiMapId(1411);
const EL: MapContainer = { nodeType: 1, ownerDocument: null };

/** Two steps in Durotar and one far off, so the route fits a zone view. */
const POINTS = [
  { mapId: 1, x: 0, y: -4000 },
  { mapId: 1, x: 50, y: -4100 },
  { mapId: 1, x: 80, y: -4150 },
];

function setup(steps: RouteStep[] = acceptStepsAt(POINTS), options: Partial<MapControllerOptions> = {}) {
  const workspace = mapTestWorkspace(steps, T0, MAP_TEST_DATASET);
  const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(100), clock: fixedClock(T0) });
  const factory = fakeAdapterFactory();
  const controller = createMapController({
    wording: MAP_WORDING,
    store,
    data: workspace.data,
    geometry: workspace.geometry,
    describeStep: (step, index) => `${String(index + 1)} · ${step.kind}`,
    timing: null,
    objectUrls: null,
    clusters: createMapClusterer().of,
    ...options,
  });
  controller.attach(factory.factory, EL);
  const adapter = (): FakeAdapter => {
    const first = factory.adapters[0];
    if (first === undefined) throw new Error('no adapter yet');
    return first;
  };
  return { workspace, store, controller, factory, adapter, steps };
}

/** The givers fold below the zone band: into clusters (map-presentation.md §25.2.5), which the layer's stats count. */
const giversAggregated = (adapter: FakeAdapter): boolean => adapter.contents.get('available-quests')?.stats.clustered !== undefined;
const giverCount = (adapter: FakeAdapter): number => adapter.contents.get('available-quests')?.items.length ?? 0;

describe('zoom bands in the controller (map-presentation.md §5.1)', () => {
  it('keeps a band until the zoom passes its edge by 0.125, so a view resting at the edge never flips its detail', () => {
    const s = setup();
    const adapter = s.adapter();
    adapter.pan({ mapId: KALIMDOR, x: 0, y: -4000, zoom: -4 });
    expect(s.store.getState().view.map.zoomBand).toBe('continent');
    expect(giversAggregated(adapter)).toBe(true);
    // -3.4 is past −3.506 (0.088 px/yd) but not by 0.125: still the continent band.
    adapter.pan({ zoom: -3.4 });
    expect(s.store.getState().view.map.zoomBand).toBe('continent');
    expect(giversAggregated(adapter)).toBe(true);
    adapter.pan({ zoom: -3.25 });
    expect(s.store.getState().view.map.zoomBand).toBe('zone');
    expect(giversAggregated(adapter)).toBe(false);
    // And back: -3.6 keeps the zone band; -3.75 leaves it.
    adapter.pan({ zoom: -3.6 });
    expect(s.store.getState().view.map.zoomBand).toBe('zone');
    expect(giversAggregated(adapter)).toBe(false);
    adapter.pan({ zoom: -3.75 });
    expect(s.store.getState().view.map.zoomBand).toBe('continent');
    expect(giversAggregated(adapter)).toBe(true);
  });

  it('starts afresh when the controller moves the view itself: a jump to a zone at −3.5 shows its points raw', () => {
    const s = setup();
    const adapter = s.adapter();
    adapter.pan({ mapId: KALIMDOR, x: 0, y: -4000, zoom: -5 });
    expect(giversAggregated(adapter)).toBe(true);
    const fits = adapter.callsOf('fitBounds').length;
    expect(s.controller.jumpToZone(DUROTAR)).toBe(true);
    const fit = adapter.callsOf('fitBounds').at(fits);
    expect(fit?.options).toEqual({ minZoom: DEFAULT_LOD.zoneZoom });
    expect(adapter.getView()?.zoom).toBeLessThanOrEqual(-2);
    expect(s.store.getState().view.map.zoomBand).toBe('zone');
    expect(giversAggregated(adapter)).toBe(false);
    expect(giverCount(adapter)).toBeGreaterThan(0);
  });

  it('cuts each layer to its band’s budget: the pin layers’ caps change at the band edges', () => {
    const s = setup(acceptStepsAt(POINTS), { lod: { bandBudgets: { zone: { 'route-steps': 1 }, close: { 'route-steps': 2 } } } });
    const adapter = s.adapter();
    adapter.pan({ mapId: KALIMDOR, x: 0, y: -4000, zoom: -2 });
    expect(adapter.contents.get('route-steps')?.stats).toMatchObject({ drawn: 1, notDrawn: 2 });
    adapter.pan({ zoom: 0 });
    expect(adapter.contents.get('route-steps')?.stats).toMatchObject({ drawn: 2, notDrawn: 1 });
  });
});

describe('step numbers for the labels canvas (map-presentation.md §13.6)', () => {
  it('numbers the steps by their place in the route and names the active step, asked at paint time', () => {
    const s = setup();
    const provider = s.adapter().options.stepNumbers as MapStepNumbers | undefined;
    if (provider === undefined) throw new Error('no step numbers given to the adapter');
    const [first, second] = s.steps;
    if (first === undefined || second === undefined) throw new Error('no steps');
    expect(provider.stepNumber(first.id)).toBe(1);
    expect(provider.stepNumber(second.id)).toBe(2);
    expect(provider.stepNumber('nope' as StepId)).toBeNull();
    s.controller.setActiveStep(second.id);
    expect(provider.activeStep()).toBe(second.id);
    // An insert above renumbers without a new provider: the next paint reads the new route.
    s.store.dispatch(insertNote({ text: 'Before everything' }, 0));
    expect(provider.stepNumber(first.id)).toBe(2);
  });

  it('asks the adapter to redraw the labels canvas after an edit or an active-step change, and not after a pan', () => {
    const s = setup();
    const adapter = s.adapter();
    const refreshes = (): number => adapter.callsOf('refreshLabels').length;
    const before = refreshes();
    expect(before).toBeGreaterThan(0);
    adapter.pan({ mapId: KALIMDOR, x: 10, y: -4000, zoom: -2 });
    expect(refreshes()).toBe(before);
    s.store.dispatch(insertNote({ text: 'A note shifts every number' }, 0));
    expect(refreshes()).toBe(before + 1);
    const [, second] = s.steps;
    if (second === undefined) throw new Error('no step');
    s.controller.setActiveStep(second.id);
    expect(refreshes()).toBe(before + 2);
  });
});
