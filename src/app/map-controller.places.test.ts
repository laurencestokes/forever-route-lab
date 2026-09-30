import { describe, expect, it } from 'vitest';
import { npcId, sequentialIdSource, worldMapId } from '../domain';
import type { LabelDescriptor, MapContainer, MapRef, MarkerDescriptor, PlaceItem, PlaceLayerInput, PolylineDescriptor, ZoneFillDescriptor } from '../map/adapter';
import { fixedClock } from './clock';
import { createDerivedStore } from './derived';
import { createMapController } from './map-controller';
import type { PlacesModel } from './map-places';
import { fakeAdapterFactory, mapTestWorkspace, type FakeAdapter } from './map-test-helpers';
import { MAP_WORDING } from './map-wording';
import { createEditorStore } from './store';

/**
 * The map's place layers from the derived pipeline's places model (map-presentation.md §8 to §10,
 * §25.4; steps MP.5, MP.8, MP.9): the dungeons, flight points, flights and transports drawn from
 * it, the step's number put into their hovers at paint time, the zoomed-in flight network following
 * the hovered flight point, the drawer's counts and the layers' notes. The model here is written by
 * hand (the builder is tested in map-places.test.ts).
 */

const T0 = '2026-09-25T12:00:00.000Z';
const EL: MapContainer = { nodeType: 1, ownerDocument: null };
const KALIMDOR = worldMapId(1);

const flightRef: MapRef = { kind: 'spawn', subject: { kind: 'npc', id: npcId(20) }, spawnIndex: 0, questIds: [] };
const flightPin: MarkerDescriptor = {
  type: 'marker',
  id: 'flight:npc:20',
  point: { mapId: KALIMDOR, x: 1700, y: -4400 },
  kind: 'flight-master',
  style: 'neutral',
  emphasis: 'normal',
  label: 'Flight point: Orgrimmar (Doras) · Horde (client TaxiNodes flags, inferred) · known to the route after step {step}',
  badges: [],
  ref: flightRef,
  count: 1,
  refs: [flightRef],
  labels: ['Flight point: Orgrimmar (Doras) · Horde (client TaxiNodes flags, inferred) · known to the route after step {step}'],
  mark: { state: 'flight-known', difficulty: null, dungeonQuest: false, progress: null },
  category: 'flight-points',
};
const line = (a: number, b: number, route = false): PlaceItem => {
  const descriptor: PolylineDescriptor = {
    type: 'polyline',
    id: `flight:${String(a)}-${String(b)}`,
    mapId: KALIMDOR,
    points: [
      { mapId: KALIMDOR, x: 1700, y: -4400 },
      { mapId: KALIMDOR, x: 1650 + a, y: -4350 },
    ],
    style: 'network-flight',
    emphasis: 'normal',
    label: `Flight ${String(a)} to ${String(b)}`,
    ref: { kind: 'taxi-edge', from: a, to: b },
  };
  return { descriptor, nodes: [a, b], ...(route ? { route: true } : {}) };
};
const dungeonRef: MapRef = { kind: 'dungeon', dungeon: 2437, entrance: 0 };
const dungeonPin: MarkerDescriptor = {
  ...flightPin,
  id: 'dungeon:1:1815:-4418',
  point: { mapId: KALIMDOR, x: 1815, y: -4418 },
  kind: 'transition',
  label: 'Ragefire Chasm (dungeon entrance) · LFG tuning level 13 (…; meaning unverified) · quests inside after step {step}: 1 available',
  ref: dungeonRef,
  refs: [dungeonRef],
  labels: ['Ragefire Chasm (dungeon entrance) · LFG tuning level 13 (…; meaning unverified) · quests inside after step {step}: 1 available'],
  mark: { state: 'dungeon', difficulty: null, dungeonQuest: false, progress: null },
  category: 'dungeons',
};
const layer = (items: readonly PlaceItem[]): PlaceLayerInput => ({ items, unplaced: 0 });
const serviceRef: MapRef = { kind: 'service', service: 'innkeeper', npc: npcId(40), spawnIndex: 0 };
const servicePin: MarkerDescriptor = {
  ...flightPin,
  id: 'service:npc:40:0',
  point: { mapId: KALIMDOR, x: 1650, y: -4420 },
  kind: 'transition',
  label: 'Innkeeper: Innkeeper Grosk · Horde · Set hearth here after step {step}',
  ref: serviceRef,
  refs: [serviceRef],
  labels: ['Innkeeper: Innkeeper Grosk · Horde · Set hearth here after step {step}'],
  mark: { state: 'innkeeper', difficulty: null, dungeonQuest: false, progress: null },
  category: 'innkeepers',
};

function setup() {
  const workspace = mapTestWorkspace(undefined, T0);
  const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(100), clock: fixedClock(T0) });
  const handle = createDerivedStore();
  const factory = fakeAdapterFactory();
  const controller = createMapController({
    wording: MAP_WORDING,
    store,
    data: workspace.data,
    geometry: workspace.geometry,
    describeStep: (step, index) => `${String(index + 1)} · ${step.kind}`,
    timing: null,
    derived: handle.store,
  });
  controller.attach(factory.factory, EL);
  const adapter = (): FakeAdapter => {
    const first = factory.adapters[0];
    if (first === undefined) throw new Error('no adapter');
    return first;
  };
  const model: PlacesModel = {
    stepId: workspace.steps[2]?.id ?? null,
    taxi: 'loaded',
    dungeonTable: 'loaded',
    dungeons: layer([{ descriptor: dungeonPin }]),
    flightPoints: layer([
      { descriptor: flightPin, node: 23 },
      { descriptor: { ...flightPin, id: 'flight:npc:30', point: { mapId: KALIMDOR, x: 1800, y: -4400 }, category: 'other-faction-flights' }, node: 3 },
    ]),
    flights: layer([line(23, 25), line(25, 29), line(29, 44, true)]),
    transports: layer([]),
    services: layer([{ descriptor: servicePin, name: 'Innkeeper Grosk' }]),
    notes: { dungeons: ['Dungeon note.'], 'flight-masters': ['Flight point note.'], 'flight-network': ['Flight note.'], transports: [], services: ['Service note.'] },
    unavailable: {},
    counts: { dungeons: 1, 'flight-points': 1, 'flight-network': 3 },
    flightsKnown: 1,
  };
  handle.publish({ places: model });
  return { store, controller, adapter, handle, model };
}

const idsOf = (adapter: FakeAdapter, id: 'flight-network' | 'dungeons' | 'flight-masters' | 'transports'): readonly string[] =>
  (adapter.contents.get(id)?.items ?? []).map((item) => item.id);

describe('map controller: the place layers from the places model (MP.5, MP.8, MP.9)', () => {
  it('draws the services from the model, with the step numbered in their hovers (MP.11)', () => {
    const s = setup();
    s.adapter().pan({ zoom: -2 });
    expect((s.adapter().contents.get('services')?.items ?? []).map((item) => item.id)).toEqual(['service:npc:40:0']);
    expect(s.controller.labelFor(serviceRef)).toBe('Innkeeper: Innkeeper Grosk · Horde · Set hearth here after step 3');
    expect(s.controller.getStatus().layers.find((entry) => entry.layer === 'services')).toMatchObject({ unavailable: null, notes: ['Service note.'] });
    // Nothing at the world and continent bands (§5.4: services from the zone band).
    s.adapter().pan({ zoom: -5 });
    expect(s.adapter().contents.get('services')?.items ?? []).toEqual([]);
  });

  it('draws the dungeons and flight points, and numbers the step in their hovers from the route order', () => {
    const s = setup();
    expect(idsOf(s.adapter(), 'dungeons')).toEqual(['dungeon:1:1815:-4418']);
    expect(idsOf(s.adapter(), 'flight-masters')).toEqual(['flight:npc:20']);
    expect(s.controller.labelFor(dungeonRef)).toBe('Ragefire Chasm (dungeon entrance) · LFG tuning level 13 (…; meaning unverified) · quests inside after step 3: 1 available');
    expect(s.controller.labelFor(flightRef)).toBe('Flight point: Orgrimmar (Doras) · Horde (client TaxiNodes flags, inferred) · known to the route after step 3');
  });

  it('draws the whole network at the continent band, and zoomed in the hovered point’s flights and the route’s', () => {
    const s = setup();
    const adapter = s.adapter();
    adapter.pan({ zoom: -5 });
    expect(idsOf(adapter, 'flight-network')).toEqual(['flight:23-25', 'flight:25-29', 'flight:29-44']);
    adapter.pan({ zoom: -2 });
    expect(idsOf(adapter, 'flight-network')).toEqual(['flight:29-44']);
    adapter.emit({ type: 'hover', point: flightPin.point, hit: { layer: 'flight-masters', id: flightPin.id, ref: flightRef, refs: [flightRef], segment: null } });
    expect(idsOf(adapter, 'flight-network')).toEqual(['flight:23-25', 'flight:29-44']);
    // Onto one of its lines: the point stays in focus.
    const lineRef: MapRef = { kind: 'taxi-edge', from: 23, to: 25 };
    adapter.emit({ type: 'hover', point: flightPin.point, hit: { layer: 'flight-network', id: 'flight:23-25', ref: lineRef, refs: [lineRef], segment: 0 } });
    expect(idsOf(adapter, 'flight-network')).toEqual(['flight:23-25', 'flight:29-44']);
    const drawnLine = adapter.contents.get('flight-network')?.items[0];
    expect(drawnLine === undefined ? null : s.controller.labelFor(drawnLine.type === 'polyline' ? drawnLine.ref : lineRef)).toBe('Flight 23 to 25');
    adapter.emit({ type: 'hover', point: null, hit: null });
    expect(idsOf(adapter, 'flight-network')).toEqual(['flight:29-44']);
    // "All flights when zoomed in" restores the rest.
    s.controller.setCategories(s.controller.getStatus().hidden.filter((id) => id !== 'all-flights'));
    expect(idsOf(adapter, 'flight-network')).toEqual(['flight:23-25', 'flight:25-29', 'flight:29-44']);
  });

  it('leaves the other faction’s flight points out of the layer while their row is hidden, so they take none of its budget', () => {
    const s = setup();
    expect(idsOf(s.adapter(), 'flight-masters')).toEqual(['flight:npc:20']);
    s.controller.setCategories(s.controller.getStatus().hidden.filter((id) => id !== 'other-faction-flights'));
    expect(idsOf(s.adapter(), 'flight-masters')).toEqual(['flight:npc:20', 'flight:npc:30']);
  });

  it('counts the place rows and gives the layers the model’s notes', () => {
    const s = setup();
    const status = s.controller.getStatus();
    expect(status.counts.places).toEqual({ dungeons: 1, 'flight-points': 1, 'flight-network': 3 });
    expect(status.counts.flightsKnown).toBe(1);
    expect(status.layers.find((entry) => entry.layer === 'dungeons')?.notes[0]).toBe('Dungeon note.');
    expect(status.layers.find((entry) => entry.layer === 'flight-masters')?.notes[0]).toBe('Flight point note.');
    expect(status.layers.find((entry) => entry.layer === 'dungeons')?.unavailable).toBeNull();
  });

  it('draws the model’s names on the labels canvas, the minimap style’s in that style, and names the zone at the centre from the zone band (MP.7)', () => {
    const s = setup();
    const durotar: LabelDescriptor = {
      type: 'label',
      id: 'zone:1411',
      point: { mapId: KALIMDOR, x: 500, y: -5500 },
      kind: 'zone',
      text: 'Durotar',
      card: null,
      priority: 4_000_000,
      minPxPerYard: 0,
      maxPxPerYard: 0.3,
      label: null,
      ref: { kind: 'zone', uiMapId: 1411 as never },
    };
    s.handle.publish({ places: { ...s.model, labels: { painted: [durotar], minimap: [{ ...durotar, text: 'Durotar (in the minimap style)' }] } } });
    const labels = (): readonly LabelDescriptor[] => (s.adapter().contents.get('labels')?.items ?? []).filter((item): item is LabelDescriptor => item.type === 'label');
    expect(labels().map((label) => label.text)).toEqual(['Durotar']);
    // The zone at the view centre: none below the zone band, Durotar from it.
    s.adapter().pan({ zoom: -5, x: 500, y: -5500 });
    expect(s.controller.getStatus().viewing).toBeNull();
    s.adapter().pan({ zoom: -2, x: 500, y: -5500 });
    expect(s.controller.getStatus().viewing).toBe(1411);
  });

  it('draws the fallback tint where no art is drawn, the faction overlay only while its row is shown, and a faction fill’s click jumps to its zone (MP.10)', () => {
    const s = setup();
    const ring = [
      { mapId: KALIMDOR, x: -1000, y: -6000 },
      { mapId: KALIMDOR, x: 1000, y: -6000 },
      { mapId: KALIMDOR, x: 1000, y: -4000 },
      { mapId: KALIMDOR, x: -1000, y: -6000 },
    ];
    const tint: ZoneFillDescriptor = { type: 'zone-fill', id: 'tint:1:14', mapId: KALIMDOR, areaId: 14, rings: [ring], fill: { tint: '#886f4b' }, label: null, ref: { kind: 'zone', uiMapId: 1411 as never } };
    const faction: ZoneFillDescriptor = { ...tint, id: 'faction:1:14', fill: { pattern: 'horde' }, label: 'Durotar: Horde territory' };
    s.handle.publish({ places: { ...s.model, zoneFill: { tint: [tint], faction: [faction], notes: ['Zone fill note.'] } } });
    s.adapter().pan({ zoom: -5, x: 0, y: -5000 });
    const ids = (): readonly string[] => (s.adapter().contents.get('zone-fill')?.items ?? []).map((item) => item.id);
    // No art on the map here (no resources): the tint is drawn; the overlay is off by default.
    expect(ids()).toEqual(['tint:1:14']);
    s.controller.setCategories(s.controller.getStatus().hidden.filter((id) => id !== 'zone-faction'));
    expect(ids()).toEqual(['tint:1:14', 'faction:1:14']);
    expect(s.store.getState().view.map.layers['zone-fill']).toBe(true);
    expect(s.controller.getStatus().layers.find((entry) => entry.layer === 'zone-fill')).toMatchObject({ unavailable: null, notes: ['Zone fill note.'] });
    // A click on the overlay jumps to the zone, as an empty click at continent zoom does.
    s.adapter().emit({ type: 'click', point: { mapId: KALIMDOR, x: 0, y: -5000 }, hit: { layer: 'zone-fill', id: faction.id, ref: faction.ref, refs: [faction.ref], segment: null }, zones: [] });
    expect(s.store.getState().view.map.zone).toBe(1411);
  });

  it('says why a place layer draws nothing when its table failed', () => {
    const s = setup();
    s.handle.publish({ places: { ...s.model, taxi: 'failed', flights: layer([]), unavailable: { 'flight-network': 'The client taxi file could not be used (HTTP 404): …' } } });
    const status = s.controller.getStatus();
    expect(status.layers.find((entry) => entry.layer === 'flight-network')?.unavailable).toBe('The client taxi file could not be used (HTTP 404): …');
    expect(idsOf(s.adapter(), 'flight-network')).toEqual([]);
  });
});
