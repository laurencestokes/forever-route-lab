import { describe, expect, it, vi } from 'vitest';
import {
  makeAcceptStep,
  makeHearthStep,
  makeNoteStep,
  npcId,
  questId,
  sequentialIdSource,
  stepId,
  uiMapId,
  worldMapId,
  worldSourcedPoint,
  zoneSourcedPoint,
  type Location,
  type RouteStep,
  type SourcedPoint,
  type UiMapId,
  type WorldMapId,
} from '../domain';
import { zoneFramesContaining } from '../geo';
import { CROSSROADS_NODE } from '../geo/test-fixtures';
import type { ArtImage, ArtManifestLoad, LocalArt, LocalArtEntry, LocalArtLoad, MapResources, TerrainArcKind, TerrainArcsLoad, TerrainManifestLoad } from '../infra/maps';
import { LAYER_IDS, refsOf, type LayerId, type MapContainer, type MapDescriptor, type MapHit, type MapRef, type MapViewState, type RoutePathsInput } from '../map/adapter';
import { DEFAULT_LOD, RELIEF_OPACITY } from '../map/layers';
import { fixedClock } from './clock';
import { insertNote, moveSelected } from './commands';
import { BADGE_TEXT, createMapController, FIT_ROUTE_MAX_ZOOM, MAX_SYNC_MEASURES, stagePixelOf, type MapControllerOptions, type MapTiming } from './map-controller';
import {
  fakeAdapterFactory,
  MAP_TEST_DATASET,
  mapTestWorkspace,
  stubDataset,
  stubNpc,
  stubQuest,
  worldSpawn,
  type FakeAdapter,
  type FakeAdapterSettings,
} from './map-test-helpers';
import { setMapLayerVisible, setMapWalkingPaths } from './map-view';
import { editNoteText } from './shell-support';
import { createEditorStore, type EditorStore } from './store';
import { MAP_ART_OWNER_NOTE, MAP_WORDING } from './map-wording';

const T0 = '2026-09-25T12:00:00.000Z';
const KALIMDOR = worldMapId(1);
const EK = worldMapId(0);
const DUROTAR = uiMapId(1411);
const MULGORE = uiMapId(1412);
const THE_BARRENS = uiMapId(1413);
const KALIMDOR_CONTINENT = uiMapId(1414);
const ORGRIMMAR = uiMapId(1454);
/** A container without a DOM (the controller passes it to the adapter untouched). */
const EL: MapContainer = { nodeType: 1, ownerDocument: null };

interface RecordingTiming extends MapTiming {
  readonly measures: { readonly name: string; readonly detail: unknown }[];
  readonly cleared: string[];
}

interface Setup {
  readonly store: EditorStore;
  readonly steps: readonly RouteStep[];
  readonly controller: ReturnType<typeof createMapController>;
  readonly factory: ReturnType<typeof fakeAdapterFactory>;
  readonly adapter: () => FakeAdapter;
  readonly timing: RecordingTiming;
  readonly urls: { readonly created: Blob[]; readonly revoked: string[] };
}

function recordingTiming(): RecordingTiming {
  const measures: { name: string; detail: unknown }[] = [];
  const cleared: string[] = [];
  return {
    measures,
    cleared,
    mark: () => undefined,
    measure: (name, options) => {
      measures.push({ name, detail: options.detail });
    },
    clearMarks: () => undefined,
    clearMeasures: (name) => {
      cleared.push(name ?? '');
    },
  };
}

interface SetupOptions {
  readonly steps?: RouteStep[];
  readonly settings?: FakeAdapterSettings;
  readonly options?: Partial<MapControllerOptions>;
  readonly dataset?: Parameters<typeof mapTestWorkspace>[2];
  readonly flightMasters?: Parameters<typeof mapTestWorkspace>[3];
}

/**
 * The controller on world surfaces, one per world map. Since step ATL.10 (docs/research/map-atlas.md
 * §11) the app shows maps 0, 1 and 2991 on the atlas, and their world surfaces are retired; the
 * world-surface path remains for the instances, battlegrounds and Darkspear Islands, and for every
 * world map when the geometry cannot place the continents (no 947 rows). This file keeps testing
 * that path on the small fixture, so it asks for it (`atlas: false`), and for Leaflet's own wheel
 * (`smoothWheel: false`, which also leaves out the idle pre-build). The atlas, the default, is
 * tested in map-controller.atlas.test.ts and map-controller.styles.test.ts.
 */
function setup(opts: SetupOptions = {}): Setup {
  const workspace = mapTestWorkspace(opts.steps, T0, opts.dataset, opts.flightMasters);
  const steps = workspace.steps;
  const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(100), clock: fixedClock(T0) });
  const factory = fakeAdapterFactory(opts.settings);
  const timing = recordingTiming();
  const created: Blob[] = [];
  const revoked: string[] = [];
  const controller = createMapController({
    wording: MAP_WORDING,
    store,
    data: workspace.data,
    geometry: workspace.geometry,
    describeStep: (step, index) => `${String(index + 1)} · ${step.kind}`,
    timing,
    objectUrls: {
      create: (blob) => {
        created.push(blob);
        return `blob:${String(created.length)}`;
      },
      revoke: (url) => {
        revoked.push(url);
      },
    },
    atlas: false,
    smoothWheel: false,
    ...opts.options,
  });
  const adapter = (): FakeAdapter => {
    const first = factory.adapters[0];
    if (first === undefined) throw new Error('no adapter yet');
    return first;
  };
  return { store, steps, controller, factory, adapter, timing, urls: { created, revoked } };
}

const setLayerCount = (adapter: FakeAdapter, layer: LayerId): number => adapter.callsOf('setLayer').filter((call) => call.layer === layer).length;
const stepAt = (s: { readonly steps: readonly RouteStep[] }, i: number) => {
  const step = s.steps[i];
  if (step === undefined) throw new Error(`no step ${String(i)}`);
  return step;
};
const hit = (layer: LayerId, id: string, ref: MapRef, segment: number | null = null): MapHit => ({ layer, id, ref, refs: [ref], segment });
/** The hit the adapter reports for a drawn descriptor: its first ref and all of them. */
const hitOf = (layer: LayerId, descriptor: MapDescriptor): MapHit => ({ layer, id: descriptor.id, ref: descriptor.ref, refs: refsOf(descriptor), segment: null });
const loc = (x: number, y: number, mapId: WorldMapId = KALIMDOR): Location => ({ source: worldSourcedPoint(mapId, x, y), label: null, radius: null });
const itemsOf = (adapter: FakeAdapter, layer: LayerId) => adapter.contents.get(layer)?.items ?? [];

describe('attach', () => {
  it('opens on the route’s first surface, fits the route there, and sends every layer once', () => {
    const s = setup();
    expect(s.controller.attach(s.factory.factory, EL)).toBe(true);
    const adapter = s.adapter();
    expect(adapter.options.initialSurface).toBe('world:1');
    expect(adapter.options.surfaces.map((info) => info.id)).toEqual(['world:0', 'world:1', 'world:2991']);
    // The controller is the adapter's label provider.
    expect(adapter.options.label).toBe(s.controller.labelFor);
    expect(adapter.callsOf('fitBounds')).toEqual([
      { kind: 'fitBounds', bounds: { mapId: KALIMDOR, xMin: 0, xMax: 200, yMin: -4300, yMax: -4000 }, options: { maxZoom: FIT_ROUTE_MAX_ZOOM } },
    ]);
    for (const layer of LAYER_IDS) expect(setLayerCount(adapter, layer)).toBe(1);
    expect(s.store.getState().view.map).toMatchObject({ surface: 'world:1', zoomBand: 'zone' });
    const status = s.controller.getStatus();
    expect(status.attached).toBe(true);
    expect(status.route).toMatchObject({ total: 7, placed: 5, unplaced: 1, withoutLocation: 1, onSurface: 4, noSurface: 0, canFit: true });
  });

  it('draws the givers of the open quests, the flight masters and the route on the shown surface', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const contents = s.adapter().contents;
    expect(contents.get('available-quests')?.items.map((item) => item.label)).toEqual(['Gornek: starts 2 quests (Gather and Cull)']);
    expect(contents.get('flight-masters')?.items.map((item) => item.label)).toEqual(['Doras · flight master']);
    expect(contents.get('route-steps')?.items.map((item) => item.id)).toHaveLength(4);
    // The fifth placed step is on Eastern Kingdoms, and a travel step with no destination breaks the line.
    expect(contents.get('route-steps')?.stats).toMatchObject({ otherSurfaces: 1, unresolved: 1, unresolvedBy: { 'destination-unknown': 1 } });
    // No quest is in focus yet: no objectives or turn-ins.
    expect(contents.get('objectives')?.items).toEqual([]);
  });

  it('reports an engine that fails to start, and starts a new one on the next attach', () => {
    const s = setup({ settings: { failMount: 'no canvas' } });
    expect(s.controller.attach(s.factory.factory, EL)).toBe(false);
    expect(s.controller.getStatus()).toMatchObject({ attached: false, failure: 'no canvas' });
    const working = fakeAdapterFactory();
    expect(s.controller.attach(working.factory, EL)).toBe(true);
    expect(working.adapters).toHaveLength(1);
    expect(s.controller.getStatus()).toMatchObject({ attached: true, failure: null });
  });

  it('applies a command given before the engine loaded, instead of fitting the route', () => {
    const s = setup();
    expect(s.controller.jumpToZone(ORGRIMMAR)).toBe(true);
    s.controller.attach(s.factory.factory, EL);
    const fits = s.adapter().callsOf('fitBounds');
    expect(fits).toHaveLength(1);
    expect(fits[0]?.bounds).toMatchObject({ mapId: KALIMDOR, xMin: 1338.4605712891 });
    expect(fits[0]?.options).toEqual({ minZoom: DEFAULT_LOD.zoneZoom });
    // The views passed on the way to the zone do not clear it.
    expect(s.store.getState().view.map.zone).toBe(ORGRIMMAR);
  });
});

describe('store changes', () => {
  it('re-sends only the layers an edit changes, and nothing after an edit that draws the same', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    const before = adapter.callsOf('setLayer').length;
    s.store.dispatch(editNoteText(stepAt(s, 0).id, 'Start here'));
    expect(adapter.callsOf('setLayer').length).toBe(before);
    s.store.select({ kind: 'single', id: stepAt(s, 3).id });
    // The new focus is the active step at once: its quests' objectives, turn-in and giver emphasis
    // come with the selection's halo and strong marker, in one sync. The step markers do not see
    // the focus (M3 review PERF-2); the route line and the beads split at the active step
    // (map-presentation.md §13.6; review PR-02), so those after it come again, faded.
    const afterSelect = adapter.callsOf('setLayer').slice(before).map((call) => call.layer);
    expect(afterSelect.sort()).toEqual(['available-quests', 'objectives', 'route-line', 'route-steps', 'selection', 'turn-ins']);
    const mark = adapter.callsOf('setLayer').length;
    const markersBefore = itemsOf(adapter, 'route-steps');
    s.store.dispatch(moveSelected({ by: -1 }));
    // The line's vertices and the leg into the active step change. The step markers carry no
    // numbers and no focus: the same descriptor objects come in the new route order (later steps
    // on top), so the adapter's diff finds nothing to redraw (M3 review PERF-2).
    const afterMove = adapter.callsOf('setLayer').slice(mark).map((call) => call.layer);
    expect(afterMove).toEqual(['route-line', 'route-steps', 'selection']);
    // The same objects, faded ones included: only the beads the split passes over change (§13.6).
    const markersAfter = itemsOf(adapter, 'route-steps');
    expect(markersAfter.filter((item) => !markersBefore.includes(item)).length).toBeLessThanOrEqual(1);
    // The sync after the edit is measured, with what it set.
    expect(s.timing.measures.at(-1)).toEqual({ name: 'frl:map:sync', detail: { trigger: 'store', layers: ['route-line', 'route-steps', 'selection'] } });
  });

  it('keeps step numbers out of the descriptors: an insert above re-sends nothing, and the labels follow the new order', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    const gather = stepAt(s, 1);
    const ref: MapRef = { kind: 'step', stepId: gather.id };
    expect(s.controller.labelFor(ref)).toBe('2 · accept');
    const marker = itemsOf(adapter, 'route-steps').find((item) => item.id === `step:${gather.id}`);
    expect(marker?.label).toBe(gather.id);
    const sets = adapter.callsOf('setLayer').length;
    s.store.dispatch(insertNote({ text: 'Before everything' }, 0));
    // The new note is the active step, so the route after it is drawn as such (§13.6; review PR-02):
    // the route layers alone come again, and the bead is the same one, faded, with no number in it.
    expect(
      adapter
        .callsOf('setLayer')
        .slice(sets)
        .map((call) => call.layer)
        .sort(),
    ).toEqual(['route-line', 'route-steps']);
    expect(itemsOf(adapter, 'route-steps').find((item) => item.id === `step:${gather.id}`)).toEqual({ ...marker, after: true });
    expect(s.controller.labelFor(ref)).toBe('3 · accept');
  });

  it('labels steps in plain text: guide colour tokens and escapes are removed (docs/RXP.md §12 row 32)', () => {
    const s = setup({ options: { describeStep: (step, index) => `${String(index + 1)} · Talk to |cRXP_FRIENDLY_Gornek|r |T1:0|t(${step.kind})` } });
    s.controller.attach(s.factory.factory, EL);
    const gather = stepAt(s, 1);
    expect(s.controller.labelFor({ kind: 'step', stepId: gather.id })).toBe('2 · Talk to Gornek (accept)');
  });

  it('shows and hides layers from the store', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    // The coastline is hidden by default (UI.md §12).
    expect(s.adapter().callsOf('toggleLayer')).toEqual([{ kind: 'toggleLayer', layer: 'coastline', visible: false }]);
    setMapLayerVisible(s.store, 'available-quests', false);
    expect(s.adapter().callsOf('toggleLayer').slice(1)).toEqual([{ kind: 'toggleLayer', layer: 'available-quests', visible: false }]);
    expect(s.controller.getStatus().layers.find((layer) => layer.layer === 'available-quests')?.visible).toBe(false);
    setMapLayerVisible(s.store, 'available-quests', true);
    expect(s.adapter().callsOf('toggleLayer').at(-1)).toEqual({ kind: 'toggleLayer', layer: 'available-quests', visible: true });
  });

  it('follows the active step: brings it into view once, and draws its quests’ objectives and turn-ins', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    const complete = stepAt(s, 3);
    s.controller.setActiveStep(complete.id);
    expect(adapter.callsOf('focus')).toEqual([{ kind: 'focus', point: { mapId: KALIMDOR, x: 200, y: -4300 }, options: { recenter: false } }]);
    expect(adapter.contents.get('objectives')?.items.map((item) => item.label)).toEqual(['Boar · kill for Cull', 'Boar · kill for Cull']);
    expect(adapter.contents.get('turn-ins')?.items.map((item) => item.label)).toEqual(['Zureetha · turn in Cull']);
    // The giver of the focused quest is drawn emphasised.
    expect(adapter.contents.get('available-quests')?.items[0]).toMatchObject({ emphasis: 'strong' });
    s.controller.setActiveStep(complete.id);
    expect(adapter.callsOf('focus')).toHaveLength(1);
    // A step on another surface switches the map there.
    s.controller.setActiveStep(stepAt(s, 6).id);
    expect(adapter.getSurface()).toBe('world:0');
    expect(s.store.getState().view.map.surface).toBe('world:0');
  });

  it('syncs once per selection change: the shell reporting the new active step afterwards changes nothing (PERF-6)', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    const markers = setLayerCount(adapter, 'route-steps');
    for (const i of [1, 3, 4]) {
      const selections = setLayerCount(adapter, 'selection');
      const measures = s.timing.measures.length;
      const step = stepAt(s, i);
      s.store.select({ kind: 'single', id: step.id });
      s.controller.setActiveStep(step.id);
      expect(setLayerCount(adapter, 'selection') - selections).toBe(1);
      expect(s.timing.measures.length - measures).toBe(1);
    }
    // The step markers never see the selection (M3 review PERF-2), but the split at the active step
    // moves with it (§13.6; review PR-02): at most one re-send per selection change.
    expect(setLayerCount(adapter, 'route-steps') - markers).toBeLessThanOrEqual(3);
    expect(adapter.callsOf('focus')).toHaveLength(3);
  });

  it('keeps at most MAX_SYNC_MEASURES sync measures on the timeline (PERF-8)', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const [a, b] = [stepAt(s, 1).id, stepAt(s, 2).id];
    for (let i = 0; i < MAX_SYNC_MEASURES + 50; i += 1) s.store.select({ kind: 'single', id: i % 2 === 0 ? a : b });
    expect(s.timing.measures.length).toBeGreaterThan(MAX_SYNC_MEASURES);
    expect(s.timing.cleared).toEqual(['frl:map:sync']);
  });
});

describe('labels', () => {
  it('numbers route items from the current order and names the other surface', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const [, a, b, c, , travel, ek] = s.steps.map((step) => step.id);
    if (a === undefined || b === undefined || c === undefined || travel === undefined || ek === undefined) throw new Error('steps');
    expect(s.controller.labelFor({ kind: 'run', style: 'route', stepIds: [a, b, c] })).toBe('Route: steps 2–4');
    expect(s.controller.labelFor({ kind: 'run', style: 'flight', stepIds: [a] })).toBe('Flight: step 2');
    expect(s.controller.labelFor({ kind: 'leg', fromStepId: a, toStepId: c })).toBe('Selected leg: step 2 to step 4');
    const transition = { kind: 'transition', fromStepId: c, toStepId: ek, fromMapId: KALIMDOR, toMapId: EK, leg: 'transport' } as const;
    expect(s.controller.labelFor({ ...transition, end: 'departure' })).toBe('Transport to Eastern Kingdoms: step 4 to step 7');
    expect(s.controller.labelFor({ ...transition, end: 'arrival' })).toBe('Transport from Kalimdor: step 4 to step 7');
    expect(s.controller.labelFor({ kind: 'departure', stepId: travel, leg: 'hearth' })).toBe('Step 6: Hearthstone (destination unknown until simulation)');
    // A step no longer in the route, and refs the adapter labels itself, keep the descriptor's label.
    expect(s.controller.labelFor({ kind: 'step', stepId: stepId('gone') })).toBeNull();
    expect(s.controller.labelFor({ kind: 'zone', uiMapId: DUROTAR })).toBeNull();
  });

  it('adds what a marker’s badges mean to its hover text (MAP-A11Y-10)', () => {
    const ids = sequentialIdSource();
    const offFrame: Location = { source: zoneSourcedPoint(DUROTAR, 120, 50), label: null, radius: null };
    const steps = [
      makeAcceptStep(ids, { questId: questId(1), location: loc(0, -4000) }),
      makeAcceptStep(ids, { questId: questId(2), location: { source: zoneSourcedPoint(uiMapId(9999), 1, 1), label: null, radius: null } }),
      makeAcceptStep(ids, { questId: questId(2), location: offFrame }),
    ];
    const dataset = stubDataset({
      quests: [stubQuest({ id: questId(1), name: 'Gather', starters: [{ kind: 'npc', id: npcId(10) }] })],
      npcs: [stubNpc({ id: npcId(10), name: 'Gornek' })],
      spawns: { 'npc:10': [{ source: zoneSourcedPoint(DUROTAR, 101, 50), world: { mapId: KALIMDOR, x: 5, y: -4005 }, uiMapId: DUROTAR }] },
    });
    const s = setup({ steps, dataset, flightMasters: [] });
    s.controller.attach(s.factory.factory, EL);
    const [, , third] = steps;
    if (third === undefined) throw new Error('steps');
    expect(s.controller.labelFor({ kind: 'step', stepId: third.id })).toBe(`3 · accept (${BADGE_TEXT['off-frame']}; ${BADGE_TEXT['leg-unknown']})`);
    const giver = itemsOf(s.adapter(), 'available-quests')[0];
    if (giver?.type !== 'marker') throw new Error('giver missing');
    expect(giver.badges).toEqual(['off-frame']);
    // Without route state the givers' hover says so (map-presentation.md §7.1).
    expect(s.controller.labelFor(giver.ref)).toBe(`Gornek: starts Gather (${BADGE_TEXT['off-frame']}) · quests open to an Orc Warrior (no route state yet)`);
  });
});

describe('map events', () => {
  it('selects the step of a clicked marker, route segment, transition or departure glyph', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    const [, a, b, c] = s.steps.map((step) => step.id);
    if (a === undefined || b === undefined || c === undefined) throw new Error('steps');
    const click = (target: MapHit) => {
      adapter.emit({ type: 'click', point: { mapId: KALIMDOR, x: 0, y: 0 }, hit: target, zones: [] });
    };
    click(hit('route-steps', `step:${b}`, { kind: 'step', stepId: b }));
    expect(s.store.getState().selection.focus).toBe(b);
    click(hit('route-line', 'run', { kind: 'run', style: 'route', stepIds: [a, b, c] }, 1));
    expect(s.store.getState().selection.focus).toBe(c);
    click(hit('selection', 'leg', { kind: 'leg', fromStepId: a, toStepId: b }));
    expect(s.store.getState().selection.focus).toBe(b);
    const transition = { kind: 'transition', fromStepId: a, toStepId: c, fromMapId: KALIMDOR, toMapId: EK, leg: 'route' } as const;
    click(hit('route-line', 'out', { ...transition, end: 'departure' }));
    expect(s.store.getState().selection.focus).toBe(c);
    click(hit('route-line', 'in', { ...transition, end: 'arrival' }));
    expect(s.store.getState().selection.focus).toBe(a);
    click(hit('route-line', 'departure', { kind: 'departure', stepId: b, leg: 'hearth' }));
    expect(s.store.getState().selection.focus).toBe(b);
  });

  it('opens the map popover on a clicked pin, with its items’ texts and the point (MP.6; §14.2), and Details only from it', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const giver: MapRef = { kind: 'spawn', subject: { kind: 'npc', id: npcId(10) }, spawnIndex: 0, questIds: [questId(2), questId(1)] };
    s.adapter().emit({ type: 'click', point: { mapId: KALIMDOR, x: 0, y: -4000 }, hit: hit('available-quests', 'spawn:npc:10:0', giver), zones: [DUROTAR] });
    const popover = s.controller.getStatus().popover;
    expect(popover).toMatchObject({ layer: 'available-quests', refs: [giver], point: { space: 'world', mapId: KALIMDOR, x: 0, y: -4000 } });
    expect(popover?.key).toBeGreaterThan(0);
    // The popover's actions are the UI's: the click itself opens nothing in Details.
    expect(s.store.getState().view.rightTab).not.toBe('details');
    // Another pin: a new target (a new key, so focus moves to its first action again).
    const master: MapRef = { kind: 'spawn', subject: { kind: 'npc', id: npcId(20) }, spawnIndex: 0, questIds: [] };
    s.adapter().emit({ type: 'click', point: { mapId: KALIMDOR, x: 1700, y: -4400 }, hit: hit('flight-masters', 'spawn:npc:20:0', master), zones: [] });
    const second = s.controller.getStatus().popover;
    expect(second?.layer).toBe('flight-masters');
    expect(second?.key).toBeGreaterThan(popover?.key ?? 0);
    // Closing it: the API, a pan, or a click on empty map (which then does nothing more).
    s.controller.closePopover();
    expect(s.controller.getStatus().popover).toBeNull();
  });

  it('opens the popover on a stack whose steps do different things, placed at the marker, with the character’s place (MAP-UX-3)', () => {
    const ids = sequentialIdSource();
    const steps = [
      makeAcceptStep(ids, { questId: questId(1), location: loc(0, -4000) }),
      makeAcceptStep(ids, { questId: questId(2), location: loc(0, -4000) }),
      makeAcceptStep(ids, { questId: questId(2), location: loc(50, -4100) }),
    ];
    const s = setup({ steps });
    s.controller.attach(s.factory.factory, EL);
    const stack = itemsOf(s.adapter(), 'route-steps').find((item) => item.type === 'marker' && item.count === 2);
    if (stack?.type !== 'marker') throw new Error('stack missing');
    const [first, , third] = steps;
    if (first === undefined || third === undefined) throw new Error('steps');
    s.controller.setActiveStep(third.id);
    s.adapter().emit({ type: 'click', point: stack.point, hit: hitOf('route-steps', stack), zones: [] });
    const popover = s.controller.getStatus().popover;
    expect(popover).toMatchObject({ layer: 'route-steps', labels: ['1 · accept', '2 · accept'], from: { mapId: KALIMDOR, x: 50, y: -4100 } });
    // The fake view is 800 × 600 px over ±100 yd around its centre.
    const view = s.adapter().getView();
    if (view === null) throw new Error('no view');
    expect(popover?.at).toEqual({ ...stagePixelOf(view, stack.point), width: 800, height: 600 });
    expect(s.store.getState().selection.focus).toBeNull();
    // A pan closes it.
    s.adapter().pan({ x: 10 });
    expect(s.controller.getStatus().popover).toBeNull();
    // Two refs with one outcome (the same step twice) need no popover: the step is selected.
    const same: MapRef = { kind: 'step', stepId: first.id };
    s.adapter().emit({ type: 'click', point: stack.point, hit: { layer: 'route-steps', id: 'x', ref: same, refs: [same, same], segment: null }, zones: [] });
    expect(s.controller.getStatus().popover).toBeNull();
    expect(s.store.getState().selection.focus).toBe(first.id);
  });

  it('opens the popover on an empty point at the zone band, and a click on empty map with it open only closes it', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    s.adapter().pan({ zoom: -2 });
    s.adapter().emit({ type: 'click', point: { mapId: KALIMDOR, x: 12.34, y: -4000.06 }, hit: null, zones: [DUROTAR] });
    expect(s.controller.getStatus().popover).toMatchObject({ layer: null, refs: [], point: { space: 'world', x: 12.3, y: -4000.1 } });
    s.adapter().emit({ type: 'click', point: { mapId: KALIMDOR, x: 50, y: -4000 }, hit: null, zones: [DUROTAR] });
    expect(s.controller.getStatus().popover).toBeNull();
    // A cluster still zooms in, and opens nothing.
    const bounds = { mapId: KALIMDOR, xMin: 0, xMax: 10, yMin: -4010, yMax: -4000 };
    s.adapter().emit({ type: 'click', point: { mapId: KALIMDOR, x: 5, y: -4005 }, hit: hit('available-quests', 'cluster', { kind: 'cluster', layer: 'available-quests', bounds, quests: 2, places: 2 }), zones: [] });
    expect(s.controller.getStatus().popover).toBeNull();
  });

  it('jumps to the zone frame an empty click at continent zoom is most central in, not the smallest (MAP-UX-1)', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    const empty = (x: number, y: number, zones: UiMapId[]) => {
      adapter.emit({ type: 'click', point: { mapId: KALIMDOR, x, y }, hit: null, zones });
    };
    empty(1700, -4400, [ORGRIMMAR, DUROTAR]);
    // At zone zoom an empty click does nothing.
    expect(adapter.callsOf('fitBounds')).toHaveLength(1);
    adapter.pan({ zoom: -5 });
    expect(s.store.getState().view.map.zoomBand).toBe('continent');
    // Well inside Orgrimmar: Orgrimmar.
    empty(1700, -4400, [ORGRIMMAR, DUROTAR]);
    expect(adapter.callsOf('fitBounds').at(-1)?.bounds).toMatchObject({ xMin: 1338.4605712891 });
    expect(s.store.getState().view.map).toMatchObject({ zone: ORGRIMMAR, zoomBand: 'zone' });
    // The zone's frame is drawn emphasised.
    expect(adapter.contents.get('zone-frames')?.items.find((item) => item.id === `frame:${String(ORGRIMMAR)}`)).toMatchObject({ emphasis: 'strong' });
    // The Crossroads (TaxiNodes 25) lies in the Durotar, Mulgore and Barrens frames, Durotar's the
    // smallest: the Barrens, where it is most central, is the zone.
    adapter.pan({ zoom: -5 });
    empty(CROSSROADS_NODE.x, CROSSROADS_NODE.y, [DUROTAR, MULGORE, THE_BARRENS]);
    expect(s.store.getState().view.map.zone).toBe(THE_BARRENS);
  });

  it('opens a clicked aggregate glyph’s zone at zone detail, even on a stage too small to fit it there (PERF-4, MAP-UX-2)', () => {
    // A fit on this stage lands at -4.25, below the zone zoom of -3.5.
    const s = setup({ settings: { fitZoom: -4.25 } });
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    adapter.pan({ zoom: -5 });
    // Quest givers cluster below the zone band (map-presentation.md §25.2.5); a zone count is the
    // objectives layer's (points of quests not in focus), clicked here as the adapter reports it.
    const ref = { kind: 'aggregate', layer: 'objectives', mapId: KALIMDOR, uiMapId: DUROTAR, count: 3 } as const;
    adapter.emit({ type: 'click', point: { mapId: KALIMDOR, x: 0, y: -4000 }, hit: { layer: 'objectives', id: 'agg:objectives:1411', ref, refs: [ref], segment: null }, zones: [] });
    const fit = adapter.callsOf('fitBounds').at(-1);
    expect(fit?.bounds).toMatchObject({ xMin: -1716.6666259766 });
    expect(fit?.options).toEqual({ minZoom: DEFAULT_LOD.zoneZoom });
    expect(adapter.getView()?.zoom).toBe(DEFAULT_LOD.zoneZoom);
    expect(s.store.getState().view.map).toMatchObject({ zone: DUROTAR, zoomBand: 'zone' });
    expect(itemsOf(adapter, 'available-quests').map((item) => item.type)).toEqual(['marker']);
  });

  it('draws the zone jumped to raw at any zoom, and forgets it once panned out of view or on another surface (MAP-UX-12)', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    expect(s.controller.jumpToZone(DUROTAR)).toBe(true);
    // Zoomed out with Durotar still in view: its givers stay raw, the zone stays set.
    adapter.pan({ zoom: -5 });
    expect(s.store.getState().view.map.zone).toBe(DUROTAR);
    expect(itemsOf(adapter, 'available-quests').map((item) => item.type)).toEqual(['marker']);
    // Panned far away: the zone is forgotten, and its points fold into clusters again (one giver: its own pin).
    adapter.pan({ x: 9000, y: 9000 });
    expect(s.store.getState().view.map.zone).toBeNull();
    expect(itemsOf(adapter, 'available-quests').map((item) => item.type)).toEqual(['marker']);
    expect(adapter.contents.get('available-quests')?.stats.clustered).toBe(0);
    expect(itemsOf(adapter, 'zone-frames').every((item) => item.type === 'frame' && item.emphasis === 'normal')).toBe(true);
    s.controller.jumpToZone(ORGRIMMAR);
    expect(s.store.getState().view.map.zone).toBe(ORGRIMMAR);
    s.controller.showSurface('world:0');
    expect(s.store.getState().view.map.zone).toBeNull();
    // A jump to a zone on another surface keeps it through the surface switch.
    s.controller.jumpToZone(ORGRIMMAR);
    expect(s.store.getState().view.map).toMatchObject({ surface: 'world:1', zone: ORGRIMMAR });
  });

  it('keeps hover out of the store: it highlights the item and gives the tooltip’s text to the status line (PERF-14)', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    const giver = adapter.contents.get('available-quests')?.items[0];
    if (giver?.type !== 'marker') throw new Error('giver missing');
    const storeListener = vi.fn();
    const hoverListener = vi.fn();
    s.store.subscribe(storeListener);
    s.controller.subscribeHover(hoverListener);
    const status = s.controller.getStatus();
    adapter.emit({ type: 'hover', point: giver.point, hit: hitOf('available-quests', giver) });
    expect(adapter.callsOf('highlight').at(-1)).toEqual({ kind: 'highlight', target: { layer: 'available-quests', ids: [giver.id] } });
    expect(s.controller.getHover()).toBe('Gornek: starts 2 quests (Gather and Cull) · quests open to an Orc Warrior (no route state yet)');
    const step = itemsOf(adapter, 'route-steps')[0];
    if (step === undefined) throw new Error('step missing');
    adapter.emit({ type: 'hover', point: null, hit: hitOf('route-steps', step) });
    expect(s.controller.getHover()).toBe('2 · accept');
    const sets = adapter.callsOf('setLayer').length;
    adapter.emit({ type: 'hover', point: null, hit: null });
    expect(adapter.callsOf('highlight').at(-1)).toEqual({ kind: 'highlight', target: null });
    expect(s.controller.getHover()).toBeNull();
    expect(hoverListener).toHaveBeenCalledTimes(3);
    // Nothing reached the store or the status, and nothing was rebuilt.
    expect(storeListener).not.toHaveBeenCalled();
    expect(s.controller.getStatus()).toBe(status);
    expect(adapter.callsOf('setLayer').length).toBe(sets);
  });

  it('highlights the step markers of hovered route rows, stacks included', () => {
    const ids = sequentialIdSource();
    const steps = [
      makeAcceptStep(ids, { questId: questId(1), location: loc(0, -4000) }),
      makeAcceptStep(ids, { questId: questId(2), location: loc(0, -4000) }),
      makeAcceptStep(ids, { questId: questId(2), location: loc(50, -4100) }),
      makeNoteStep(ids, { text: 'No marker' }),
    ];
    const s = setup({ steps });
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    const [first, second, third, note] = steps;
    if (first === undefined || second === undefined || third === undefined || note === undefined) throw new Error('steps');
    s.controller.hoverSteps([third.id]);
    expect(adapter.callsOf('highlight').at(-1)).toEqual({ kind: 'highlight', target: { layer: 'route-steps', ids: [`step:${third.id}`] } });
    // The second step is drawn in the stack its first step heads.
    s.controller.hoverSteps([second.id]);
    expect(adapter.callsOf('highlight').at(-1)).toEqual({ kind: 'highlight', target: { layer: 'route-steps', ids: [`step:${first.id}`] } });
    const calls = adapter.callsOf('highlight').length;
    s.controller.hoverSteps([second.id]);
    expect(adapter.callsOf('highlight')).toHaveLength(calls);
    s.controller.hoverSteps([note.id]);
    expect(adapter.callsOf('highlight').at(-1)).toEqual({ kind: 'highlight', target: null });
    s.controller.hoverSteps([third.id]);
    s.controller.hoverSteps(null);
    expect(adapter.callsOf('highlight').at(-1)).toEqual({ kind: 'highlight', target: null });
  });

  it('rebuilds the view-dependent layers on a pan or zoom that changes their level of detail', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    const sets = adapter.callsOf('setLayer').length;
    adapter.pan({ x: 20 });
    // Under the cap, a pan at the same level of detail changes nothing.
    expect(adapter.callsOf('setLayer').length).toBe(sets);
    adapter.pan({ zoom: -5 });
    const changed = adapter.callsOf('setLayer').slice(sets).map((call) => call.layer);
    // Quest givers and turn-ins cluster below the zone band (map-presentation.md §25.2.5): their counts change.
    expect(changed).toEqual(['available-quests', 'turn-ins']);
    expect(adapter.contents.get('available-quests')?.stats.clustered).toBe(0);
  });
});

describe('commands', () => {
  it('focuses a placed step (switching surface) and says why it cannot focus the others', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    expect(s.controller.focusStep(stepAt(s, 0).id)).toEqual({ kind: 'no-location' });
    expect(s.controller.focusStep(stepAt(s, 5).id)).toEqual({ kind: 'not-placed', reason: 'destination-unknown' });
    expect(s.controller.focusStep(stepId('gone'))).toEqual({ kind: 'not-in-route' });
    expect(s.controller.focusStep(stepAt(s, 6).id)).toEqual({ kind: 'focused', surface: 'world:0' });
    expect(s.adapter().callsOf('focus').at(-1)).toEqual({ kind: 'focus', point: { mapId: EK, x: -9000, y: 800 }, options: { recenter: true } });
  });

  it('says when a step is on a world map with no surface, and counts it apart (MAP-UX-9)', () => {
    const ids = sequentialIdSource();
    const steps = [makeAcceptStep(ids, { questId: questId(1), location: loc(0, -4000) }), makeAcceptStep(ids, { questId: questId(2), location: loc(10, 20, worldMapId(36)) })];
    const s = setup({ steps });
    s.controller.attach(s.factory.factory, EL);
    const [, deadmines] = steps;
    if (deadmines === undefined) throw new Error('steps');
    expect(s.controller.focusStep(deadmines.id)).toEqual({ kind: 'no-surface', mapId: 36 });
    s.controller.setActiveStep(deadmines.id);
    const status = s.controller.getStatus();
    expect(status.activeStep).toEqual({ stepId: deadmines.id, number: 2, placement: { kind: 'no-surface', mapId: 36 } });
    expect(status.route).toMatchObject({ placed: 2, onSurface: 1, noSurface: 1, canFit: true });
  });

  it('counts a hearth without a location as not placed, and labels where it leaves', () => {
    const ids = sequentialIdSource();
    const steps = [makeAcceptStep(ids, { questId: questId(1), location: loc(0, -4000) }), makeHearthStep(ids, {}), makeAcceptStep(ids, { questId: questId(2), location: loc(50, -4100) })];
    const s = setup({ steps });
    s.controller.attach(s.factory.factory, EL);
    expect(s.controller.getStatus().route).toMatchObject({ placed: 2, unplaced: 1, withoutLocation: 0 });
    const departure = itemsOf(s.adapter(), 'route-line').find((item) => item.ref.kind === 'departure');
    if (departure === undefined) throw new Error('departure missing');
    expect(s.controller.labelFor(departure.ref)).toBe('Step 2: Hearthstone (destination unknown until simulation)');
  });

  it('fits the route on the shown surface, else on the first surface it reaches', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    s.controller.showSurface('world:0');
    expect(s.controller.fitRoute()).toEqual({ kind: 'fitted', surface: 'world:0', steps: 1 });
    s.controller.showSurface('world:2991');
    expect(s.controller.fitRoute()).toEqual({ kind: 'fitted', surface: 'world:1', steps: 4 });
    expect(s.adapter().getSurface()).toBe('world:1');
    const empty = setup({ steps: [] });
    empty.controller.attach(empty.factory.factory, EL);
    expect(empty.controller.fitRoute()).toEqual({ kind: 'nothing-to-fit' });
    expect(empty.controller.getStatus().route.canFit).toBe(false);
  });

  it('refuses surfaces and zones it cannot show', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    expect(s.controller.showSurface('world:529')).toBe(false);
    expect(s.controller.jumpToZone(uiMapId(947))).toBe(false);
    expect(s.controller.jumpToZone(uiMapId(1))).toBe(false);
    expect(s.controller.zoneGroups.map((group) => group.surface)).toEqual(['world:0', 'world:1', 'world:2991']);
  });
});

describe('detach and remount', () => {
  it('stops following the store while detached and resends only what changed when mounted again', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    s.controller.detach();
    expect(adapter.callsOf('destroy')).toHaveLength(1);
    const sets = adapter.callsOf('setLayer').length;
    s.store.select({ kind: 'single', id: stepAt(s, 2).id });
    expect(adapter.callsOf('setLayer').length).toBe(sets);
    expect(s.controller.getStatus().attached).toBe(false);
    s.controller.attach(s.factory.factory, EL);
    expect(s.factory.adapters).toHaveLength(1);
    expect(adapter.callsOf('mount')).toHaveLength(2);
    // No second route fit: the adapter kept its view.
    expect(adapter.callsOf('fitBounds')).toHaveLength(1);
    expect(adapter.callsOf('setLayer').slice(sets).map((call) => call.layer).sort()).toEqual(['selection']);
  });
});

describe('status', () => {
  it('says what each layer leaves out, with its unit, and why the unavailable ones are', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const layers = new Map(s.controller.getStatus().layers.map((layer) => [layer.layer, layer]));
    expect(layers.get('art')?.unavailable).toMatch(/^No local map set/);
    expect(layers.get('proposal')?.unavailable).toMatch(/^No proposal is open/);
    expect(layers.get('available-quests')?.notes[0]).toBe('Quests open to an Orc Warrior (no route state yet): the givers of all 2 quests open by race and class.');
    expect(layers.get('objectives')?.notes[0]).toMatch(/^Select a quest step/);
    expect(layers.get('route-steps')?.notes).toEqual(['1 step not placed: 1 moving somewhere the route does not say', '1 step on other world maps']);
  });

  it('says what has no spawn in the dataset (MAP-HONEST-4)', () => {
    const dataset = stubDataset({
      quests: [
        stubQuest({ id: questId(1), name: 'Seen', starters: [{ kind: 'npc', id: npcId(10) }] }),
        stubQuest({
          id: questId(2),
          name: 'Unseen',
          starters: [{ kind: 'npc', id: npcId(11) }],
          finishers: [{ kind: 'npc', id: npcId(11) }],
          objectives: [{ kind: 'kill', npcId: npcId(12), label: null, count: null }],
        }),
      ],
      npcs: [stubNpc({ id: npcId(10), name: 'Seen' }), stubNpc({ id: npcId(11), name: 'Ghost' }), stubNpc({ id: npcId(12), name: 'Phantom' })],
      spawns: { 'npc:10': [worldSpawn(KALIMDOR, 0, -4000, DUROTAR)] },
    });
    const s = setup({ dataset, flightMasters: [] });
    s.controller.attach(s.factory.factory, EL);
    s.store.setView({ openedQuests: { questIds: [questId(2)], selection: s.store.getState().selection } });
    const layers = new Map(s.controller.getStatus().layers.map((layer) => [layer.layer, layer]));
    expect(layers.get('available-quests')?.notes).toContain('1 quest giver has no spawn in the dataset: 1 quest has no giver marker.');
    expect(layers.get('objectives')?.notes).toContain('1 objective has no spawn in the dataset: not drawn.');
    expect(layers.get('turn-ins')?.notes).toContain('1 turn-in has no spawn in the dataset: not drawn.');
  });

  it('notifies listeners only when the status changes', () => {
    const s = setup();
    const listener = vi.fn();
    s.controller.subscribe(listener);
    s.controller.attach(s.factory.factory, EL);
    const calls = listener.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    const status = s.controller.getStatus();
    s.store.dispatch(editNoteText(stepAt(s, 0).id, 'Same drawing'));
    expect(s.controller.getStatus()).toBe(status);
    expect(listener.mock.calls.length).toBe(calls);
    s.controller.setActiveStep(stepAt(s, 1).id);
    expect(s.controller.getStatus().activeStep).toEqual({ stepId: stepAt(s, 1).id, number: 2, placement: { kind: 'point', surface: 'world:1' } });
    expect(listener.mock.calls.length).toBeGreaterThan(calls);
  });

  it('places a world point in stage pixels: east right, north up', () => {
    const view: MapViewState = {
      surface: 'world:1',
      mapId: KALIMDOR,
      center: { mapId: KALIMDOR, x: 0, y: 0 },
      zoom: 0,
      bounds: { mapId: KALIMDOR, xMin: -100, xMax: 100, yMin: -200, yMax: 200 },
      widthPx: 400,
      heightPx: 200,
    };
    expect(stagePixelOf(view, { mapId: KALIMDOR, x: 100, y: 200 })).toEqual({ x: 0, y: 0 });
    expect(stagePixelOf(view, { mapId: KALIMDOR, x: -100, y: -200 })).toEqual({ x: 400, y: 200 });
    expect(stagePixelOf(view, { mapId: KALIMDOR, x: 0, y: 0 })).toEqual({ x: 200, y: 100 });
    expect(stagePixelOf({ ...view, bounds: { ...view.bounds, xMax: -100 } }, { mapId: KALIMDOR, x: 0, y: 0 })).toBeNull();
  });
});

describe('local art', () => {
  const entryOf = (uiMapId: UiMapId, bounds: LocalArtEntry['bounds']): LocalArtEntry => ({
    uiMapId,
    mapId: KALIMDOR,
    bounds,
    url: `./local-maps/art/${String(uiMapId)}.png`,
    width: 1002,
    height: 668,
    contentType: 'image/png',
    sha256: 'a'.repeat(64),
  });
  const DUROTAR_ART = entryOf(DUROTAR, { xMin: -1716.6666259766, xMax: 1808.3332519531, yMin: -7249.9995117188, yMax: -1962.4998779297 });
  const MULGORE_ART = entryOf(MULGORE, { xMin: -3835.416015625, xMax: 266.666015625, yMin: -3675, yMax: 2479.1669921875 });
  const CONTINENT_ART = entryOf(KALIMDOR_CONTINENT, { xMin: -11733.299804688, xMax: 12799.900390625, yMin: -19733.2109375, yMax: 17066.599609375 });

  function artOf(entries: readonly LocalArtEntry[], load: (id: UiMapId) => Promise<LocalArtLoad>): LocalArt {
    return { status: { kind: 'listed', count: entries.length }, entries, load };
  }

  const verifying = (entries: readonly LocalArtEntry[]) =>
    vi.fn((id: UiMapId): Promise<LocalArtLoad> => {
      const entry = entries.find((candidate) => candidate.uiMapId === id);
      if (entry === undefined) throw new Error('unexpected');
      return Promise.resolve({ kind: 'verified', entry, blob: new Blob([String(id)]) });
    });

  it('draws verified art from an object URL, and revokes it on detach', async () => {
    const load = verifying([DUROTAR_ART]);
    const s = setup({ options: { art: artOf([DUROTAR_ART], load) } });
    s.controller.attach(s.factory.factory, EL);
    await vi.waitFor(() => {
      expect(s.adapter().contents.get('art')?.items).toHaveLength(1);
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(s.urls.created).toHaveLength(1);
    expect(s.adapter().contents.get('art')?.items[0]).toMatchObject({ type: 'art', url: 'blob:1' });
    expect(s.controller.getStatus().artDrawn).toBe(1);
    s.controller.detach();
    expect(s.urls.revoked).toEqual(['blob:1']);
  });

  it('loads only the images drawn at this level of detail: zone art in view zoomed in, the continent zoomed out (PERF-9)', async () => {
    const entries = [DUROTAR_ART, MULGORE_ART, CONTINENT_ART];
    const load = verifying(entries);
    const s = setup({ options: { art: artOf(entries, load) } });
    s.controller.attach(s.factory.factory, EL);
    // Zone zoom over Durotar: Mulgore is out of view and the continent image is not drawn here.
    await vi.waitFor(() => {
      expect(s.adapter().contents.get('art')?.items.map((item) => item.id)).toEqual([`art:${String(DUROTAR)}`]);
    });
    expect(load.mock.calls.map(([id]) => id)).toEqual([DUROTAR]);
    s.adapter().pan({ zoom: -5 });
    await vi.waitFor(() => {
      expect(s.adapter().contents.get('art')?.items.map((item) => item.id)).toEqual([`art:${String(KALIMDOR_CONTINENT)}`]);
    });
    expect(load.mock.calls.map(([id]) => id)).toEqual([DUROTAR, KALIMDOR_CONTINENT]);
    // Back in: the zone image is already verified; nothing is fetched again.
    s.adapter().pan({ zoom: -2 });
    expect(s.adapter().contents.get('art')?.items.map((item) => item.id)).toEqual([`art:${String(DUROTAR)}`]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('says when an image is refused, and does not draw it', async () => {
    const load = vi.fn((): Promise<LocalArtLoad> => Promise.resolve({ kind: 'refused', uiMapId: DUROTAR, reason: 'changed', detail: 'sha mismatch' }));
    const s = setup({ options: { art: artOf([DUROTAR_ART], load) } });
    s.controller.attach(s.factory.factory, EL);
    await vi.waitFor(() => {
      expect(s.controller.getStatus().layers.find((layer) => layer.layer === 'art')?.notes).toContain('UiMap 1411 art changed after the set was activated.');
    });
    expect(s.adapter().contents.get('art')?.items).toEqual([]);
    expect(s.urls.created).toEqual([]);
  });
});

describe('the default dataset', () => {
  it('is the stub the other tests assume', () => {
    expect(MAP_TEST_DATASET.npc(npcId(20))?.name).toBe('Doras');
  });
});

describe('pick on map', () => {
  it('takes the next click as a world-form point with the zone hint, and selects nothing with it', () => {
    const s = setup();
    const picked: unknown[] = [];
    expect(s.controller.startPick({ label: 'the location of step 2', onPick: (point) => picked.push(point) })).toBe(false);
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    s.controller.jumpToZone(DUROTAR);
    expect(s.controller.startPick({ label: 'the location of step 2', onPick: (point) => picked.push(point) })).toBe(true);
    expect(s.controller.getStatus().pick).toEqual({ label: 'the location of step 2' });
    const selection = s.store.getState().selection;
    const target = stepAt(s, 1);
    // A click on a step marker is still just a point while picking.
    adapter.emit({ type: 'click', point: { mapId: KALIMDOR, x: 12.345, y: -4000.06 }, hit: hit('route-steps', `step:${target.id}`, { kind: 'step', stepId: target.id }), zones: [] });
    expect(picked).toEqual([{ space: 'world', mapId: KALIMDOR, x: 12.3, y: -4000.1, uiMapId: DUROTAR, lexemes: null }]);
    expect(s.store.getState().selection).toBe(selection);
    expect(s.controller.getStatus().pick).toBeNull();
    // The pick is over: the next click selects as usual.
    adapter.emit({ type: 'click', point: { mapId: KALIMDOR, x: 0, y: -4000 }, hit: hit('route-steps', `step:${target.id}`, { kind: 'step', stepId: target.id }), zones: [] });
    expect(s.store.getState().selection.focus).toBe(target.id);
    expect(picked).toHaveLength(1);
  });

  it('hints the most central zone frame without a jumped-to zone, and none outside every frame', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const picked: SourcedPoint[] = [];
    s.controller.startPick({ label: 'x', onPick: (point) => picked.push(point) });
    s.adapter().emit({ type: 'click', point: { mapId: KALIMDOR, x: 0, y: -4000 }, hit: null, zones: [] });
    const [first] = zoneFramesContaining({ mapId: KALIMDOR, x: 0, y: -4000 }, mapTestWorkspace().geometry);
    expect(first).toBeDefined();
    expect(picked[0]).toMatchObject({ space: 'world', uiMapId: first });
    s.controller.startPick({ label: 'x', onPick: (point) => picked.push(point) });
    s.adapter().emit({ type: 'click', point: { mapId: KALIMDOR, x: 900000, y: 900000 }, hit: null, zones: [] });
    expect(picked[1]).toMatchObject({ uiMapId: null });
  });

  it('cancels, is replaced by a new pick, and ends on detach', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const first: unknown[] = [];
    const second: unknown[] = [];
    s.controller.startPick({ label: 'first', onPick: (point) => first.push(point) });
    s.controller.startPick({ label: 'second', onPick: (point) => second.push(point) });
    expect(s.controller.getStatus().pick?.label).toBe('second');
    s.adapter().emit({ type: 'click', point: { mapId: KALIMDOR, x: 0, y: -4000 }, hit: null, zones: [] });
    expect([first.length, second.length]).toEqual([0, 1]);
    s.controller.startPick({ label: 'third', onPick: (point) => first.push(point) });
    expect(s.controller.cancelPick()).toBe(true);
    expect(s.controller.cancelPick()).toBe(false);
    expect(s.controller.getStatus().pick).toBeNull();
    s.controller.startPick({ label: 'fourth', onPick: (point) => first.push(point) });
    s.controller.detach();
    expect(s.controller.getStatus().pick).toBeNull();
    expect(first).toHaveLength(0);
  });
});

// =============================================================================================
// Committed art and terrain (D-032, D-033) and walking paths (MAPS §7.4)

const rect = (mapId: WorldMapId, xMin: number, xMax: number, yMin: number, yMax: number) => ({ mapId, xMin, xMax, yMin, yMax });

function artImage(uiMapId: UiMapId, name: string, uiMapType: number, bounds: ArtImage['bounds'], width = 1002, height = 668): ArtImage {
  return {
    uiMapId,
    name,
    uiMapType,
    styleId: 1,
    bounds,
    url: `./maps/art/${String(uiMapId)}.webp`,
    contentType: 'image/webp',
    width,
    height,
    sha256: 'b'.repeat(64),
  };
}

const ZEPHRAS = worldMapId(2991);
const ART: ArtManifestLoad = {
  kind: 'loaded',
  manifest: {
    owner: 'Blizzard Entertainment',
    build: '1.60.1.70009',
    images: [
      artImage(DUROTAR, 'Durotar', 3, rect(KALIMDOR, -1716.6666259765625, 1808.333251953125, -7249.99951171875, -1962.4998779296875)),
      artImage(MULGORE, 'Mulgore', 3, rect(KALIMDOR, -3835.416015625, 266.666015625, -3675, 2479.1669921875)),
      artImage(KALIMDOR_CONTINENT, 'Kalimdor', 2, rect(KALIMDOR, -11733.2998046875, 12799.900390625, -19733.2109375, 17066.599609375)),
      // The alternative continent: never drawn in place of the surface's continent.
      artImage(uiMapId(1464), 'Kalimdor', 2, rect(KALIMDOR, -11870, 12470, -13370, 10970), 512, 512),
      // Two images of one rectangle: the one with more pixels is drawn.
      artImage(uiMapId(2521), 'Zephras Isle', 3, rect(ZEPHRAS, 1247.9, 4956.25, -1331.25, 4231.25)),
      artImage(uiMapId(2665), 'Zephras Isle', 3, rect(ZEPHRAS, 1247.9, 4956.25, -1331.25, 4231.25), 512, 512),
    ],
    unplaced: [{ uiMapId: uiMapId(947), name: 'Azeroth' }],
  },
};

const arcFile = (mapId: WorldMapId, kind: TerrainArcKind) => ({
  kind,
  mapId,
  path: `maps/terrain/${String(mapId)}/${kind}.json`,
  url: `./maps/terrain/${String(mapId)}/${kind}.json`,
  sha256: 'c'.repeat(64),
  arcs: 1,
});

const TERRAIN: TerrainManifestLoad = {
  kind: 'loaded',
  manifest: {
    build: '1.60.1.70009',
    maps: [
      {
        mapId: KALIMDOR,
        name: 'Kalimdor',
        relief: { mapId: KALIMDOR, url: './maps/terrain/1/relief.png', bounds: rect(KALIMDOR, -12800, 17066.7, -9066.7, 17066.7), width: 1568, height: 1792, pixelYd: 16.7 },
        zones: arcFile(KALIMDOR, 'zones'),
        coast: arcFile(KALIMDOR, 'coast'),
      },
    ],
  },
};

const arcsOf = (mapId: WorldMapId, kind: TerrainArcKind): TerrainArcsLoad => ({
  kind: 'loaded',
  arcs: {
    kind,
    mapId,
    lines: [
      [
        { mapId, x: 0, y: -4000 },
        { mapId, x: 100, y: -4100 },
      ],
    ],
    sides: kind === 'zones' ? [[14, 17]] : [],
  },
});

interface FakeResources extends MapResources {
  readonly calls: string[];
}

function fakeResources(answers: { readonly art?: ArtManifestLoad; readonly terrain?: TerrainManifestLoad; readonly arcs?: typeof arcsOf } = {}): FakeResources {
  const calls: string[] = [];
  return {
    calls,
    art: () => {
      calls.push('art');
      return Promise.resolve(answers.art ?? ART);
    },
    terrain: () => {
      calls.push('terrain');
      return Promise.resolve(answers.terrain ?? TERRAIN);
    },
    arcs: (mapId, kind) => {
      calls.push(`arcs ${String(mapId)} ${kind}`);
      return Promise.resolve((answers.arcs ?? arcsOf)(mapId, kind));
    },
  };
}

const layerStatus = (s: Setup, layer: LayerId) => s.controller.getStatus().layers.find((entry) => entry.layer === layer);

describe('committed art and terrain', () => {
  it('loads them when the map first mounts, then draws the zone art in view zoomed in and the continent zoomed out, over a faint relief', async () => {
    const resources = fakeResources();
    const s = setup({ options: { resources } });
    // Nothing is loaded before the map mounts.
    expect(resources.calls).toEqual([]);
    s.controller.attach(s.factory.factory, EL);
    expect(resources.calls).toEqual(['art', 'terrain']);
    await vi.waitFor(() => {
      expect(itemsOf(s.adapter(), 'art').map((item) => item.id)).toEqual(['art:1411']);
    });
    // Placed by the manifest's rectangle, drawn from its deployed URL.
    expect(itemsOf(s.adapter(), 'art')[0]).toMatchObject({ url: './maps/art/1411.webp', bounds: ART.kind === 'loaded' ? ART.manifest.images[0]?.bounds : null });
    expect(itemsOf(s.adapter(), 'relief')[0]).toMatchObject({ id: 'relief:1', url: './maps/terrain/1/relief.png', opacity: RELIEF_OPACITY.underArt });
    // Over the art the zone frames lose their fill.
    expect(itemsOf(s.adapter(), 'zone-frames').filter((item) => item.type === 'frame' && item.kind === 'zone').every((item) => item.type === 'frame' && !item.filled)).toBe(true);
    const status = s.controller.getStatus();
    expect(status.backdrop).toBe('art');
    expect(status.problems).toEqual([]);
    expect(layerStatus(s, 'art')?.notes).toContain(MAP_ART_OWNER_NOTE);
    expect(layerStatus(s, 'art')?.notes).toContain('1 image spans several world maps and is not drawn (Azeroth).');
    expect(layerStatus(s, 'relief')?.notes.some((note) => note.startsWith('Faint under the painted art'))).toBe(true);
    // Zoomed out: the surface's continent image, not the alternative continent.
    s.adapter().pan({ zoom: -5 });
    expect(itemsOf(s.adapter(), 'art').map((item) => item.id)).toEqual(['art:1414']);
    // Hiding the art brings the relief back as the backdrop and the frames' fill with it.
    setMapLayerVisible(s.store, 'art', false);
    expect(itemsOf(s.adapter(), 'relief')[0]).toMatchObject({ opacity: RELIEF_OPACITY.backdrop });
    expect(s.controller.getStatus().backdrop).toBe('relief');
    expect(resources.calls.filter((call) => call === 'art' || call === 'terrain')).toEqual(['art', 'terrain']);
  });

  it('draws one zone image at a time, the zone being viewed, and none zoomed in outside every zone image', async () => {
    const s = setup({ options: { resources: fakeResources() } });
    s.controller.attach(s.factory.factory, EL);
    await vi.waitFor(() => {
      expect(itemsOf(s.adapter(), 'art').map((item) => item.id)).toEqual(['art:1411']);
    });
    // Mulgore's rectangle meets the view once it is panned there; only the zone at the centre is drawn.
    s.adapter().pan({ x: -1000, y: -3000 });
    expect(itemsOf(s.adapter(), 'art').map((item) => item.id)).toEqual(['art:1411']);
    s.adapter().pan({ x: -1800, y: 0 });
    expect(itemsOf(s.adapter(), 'art').map((item) => item.id)).toEqual(['art:1412']);
    // Out at sea at zone zoom: no zone image and not the coarse continent image; the relief is the backdrop.
    s.adapter().pan({ x: 0, y: -9000 });
    expect(itemsOf(s.adapter(), 'art')).toEqual([]);
    expect(itemsOf(s.adapter(), 'relief')[0]).toMatchObject({ opacity: RELIEF_OPACITY.backdrop });
    expect(s.controller.getStatus().backdrop).toBe('relief');
  });

  it('draws one image per rectangle where there is no continent: the one with more pixels', async () => {
    const s = setup({ options: { resources: fakeResources() } });
    s.controller.attach(s.factory.factory, EL);
    s.controller.showSurface('world:2991');
    await vi.waitFor(() => {
      expect(itemsOf(s.adapter(), 'art').map((item) => item.id)).toEqual(['art:2521']);
    });
    expect(layerStatus(s, 'relief')?.unavailable).toBe('No terrain data for this world map (it covers Kalimdor)');
    expect(layerStatus(s, 'art')?.unavailable).toBeNull();
  });

  it('fetches the zone outlines of the shown world map, and the coastline only once it is shown', async () => {
    const resources = fakeResources();
    const s = setup({ options: { resources } });
    s.controller.attach(s.factory.factory, EL);
    await vi.waitFor(() => {
      expect(itemsOf(s.adapter(), 'zone-outlines').map((item) => item.id)).toEqual(['outline:zones:1']);
    });
    expect(resources.calls).toEqual(['art', 'terrain', 'arcs 1 zones']);
    expect(itemsOf(s.adapter(), 'coastline')).toEqual([]);
    expect(s.adapter().isLayerVisible('coastline')).toBe(false);
    setMapLayerVisible(s.store, 'coastline', true);
    await vi.waitFor(() => {
      expect(itemsOf(s.adapter(), 'coastline').map((item) => item.id)).toEqual(['outline:coast:1']);
    });
    expect(resources.calls.at(-1)).toBe('arcs 1 coast');
    expect(layerStatus(s, 'zone-outlines')?.notes[0]).toMatch(/^Zone outlines from the client’s terrain areas/);
  });

  it('never breaks the map: a failed art manifest leaves the relief as the backdrop, and the status line says so', async () => {
    const failed: ArtManifestLoad = { kind: 'failed', reason: 'unavailable', detail: 'maps/art/manifest.json: HTTP 503' };
    const resources = fakeResources({ art: failed });
    const s = setup({ options: { resources } });
    s.controller.attach(s.factory.factory, EL);
    await vi.waitFor(() => {
      expect(s.controller.getStatus().problems).toEqual(['Painted map art could not be loaded: the map shows the terrain relief instead']);
    });
    expect(layerStatus(s, 'art')?.unavailable).toBe('Painted map art could not be loaded (maps/art/manifest.json: HTTP 503)');
    expect(itemsOf(s.adapter(), 'relief')[0]).toMatchObject({ opacity: RELIEF_OPACITY.backdrop });
    expect(itemsOf(s.adapter(), 'zone-frames').some((item) => item.type === 'frame' && item.filled)).toBe(true);
    expect(s.controller.getStatus().backdrop).toBe('relief');
    // The route is drawn as ever.
    expect(itemsOf(s.adapter(), 'route-steps').length).toBeGreaterThan(0);
    // A request that failed is tried again at the next mount.
    s.controller.detach();
    s.controller.attach(s.factory.factory, EL);
    expect(resources.calls.filter((call) => call === 'art')).toHaveLength(2);
  });

  it('falls back to the schematic frames when the terrain fails too, and says why per layer', async () => {
    const resources = fakeResources({
      art: { kind: 'failed', reason: 'invalid', detail: 'maps/art/manifest.json is not JSON' },
      terrain: { kind: 'failed', reason: 'invalid', detail: 'maps/terrain/manifest.json: schema is not 1' },
    });
    const s = setup({ options: { resources } });
    s.controller.attach(s.factory.factory, EL);
    await vi.waitFor(() => {
      expect(s.controller.getStatus().problems).toHaveLength(2);
    });
    expect(s.controller.getStatus().problems).toEqual([
      'Painted map art could not be loaded: the map shows zone frames instead',
      'Terrain data could not be loaded: no relief, zone outlines or coastline',
    ]);
    expect(s.controller.getStatus().backdrop).toBe('schematic');
    expect(layerStatus(s, 'relief')?.unavailable).toBe('Terrain data could not be loaded (maps/terrain/manifest.json: schema is not 1)');
    // An invalid manifest is not asked for again.
    s.controller.detach();
    s.controller.attach(s.factory.factory, EL);
    expect(resources.calls).toEqual(['art', 'terrain']);
  });

  it('says when an outline file could not be loaded', async () => {
    const resources = fakeResources({ arcs: () => ({ kind: 'failed', reason: 'invalid', detail: 'maps/terrain/1/zones.json failed its integrity check' }) });
    const s = setup({ options: { resources } });
    s.controller.attach(s.factory.factory, EL);
    await vi.waitFor(() => {
      expect(s.controller.getStatus().problems).toEqual(['Zone outlines could not be loaded']);
    });
    expect(layerStatus(s, 'zone-outlines')?.unavailable).toBe('Zone outlines could not be loaded (maps/terrain/1/zones.json failed its integrity check)');
    expect(itemsOf(s.adapter(), 'zone-outlines')).toEqual([]);
  });
});

describe('walking paths', () => {
  /** Paths with one bent point per leg. */
  const bentPaths = (pending = false): RoutePathsInput => ({
    pending,
    pathOf: (leg) => [leg.from, { mapId: leg.from.mapId, x: (leg.from.x + leg.to.x) / 2 + 5, y: (leg.from.y + leg.to.y) / 2 }, leg.to],
  });
  const routeLine = (s: Setup) => itemsOf(s.adapter(), 'route-line').filter((item) => item.type === 'polyline');

  it('are unavailable until the navigation model gives some, and every leg is straight', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    expect(s.controller.getStatus().walkingPaths).toEqual({
      visible: true,
      unavailable: 'No walking paths are available yet: every leg is drawn as a straight line',
      notes: [],
    });
    expect(routeLine(s)[0]).toMatchObject({ points: [{ x: 0 }, { x: 10 }, { x: 200 }, { x: 50 }] });
  });

  it('are followed by the route line once given, counted in the status, and turned off by the toggle', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    s.controller.setRoutePaths(bentPaths());
    expect(routeLine(s)[0]?.type === 'polyline' ? routeLine(s)[0]?.points : []).toHaveLength(7);
    const status = s.controller.getStatus().walkingPaths;
    expect(status.unavailable).toBeNull();
    expect(status.notes).toContain('3 walked legs follow their paths on this map.');
    // The toggle draws every leg straight again, without forgetting the paths.
    setMapWalkingPaths(s.store, false);
    expect(routeLine(s)[0]?.type === 'polyline' ? routeLine(s)[0]?.points : []).toHaveLength(4);
    expect(s.controller.getStatus().walkingPaths.visible).toBe(false);
    setMapWalkingPaths(s.store, true);
    expect(routeLine(s)[0]?.type === 'polyline' ? routeLine(s)[0]?.points : []).toHaveLength(7);
  });

  it('say which legs are straight while their paths are computed, or have none', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    s.controller.setRoutePaths({ pending: true, pathOf: () => null });
    expect(routeLine(s).map((item) => (item.type === 'polyline' ? item.style : null))).toEqual(['route-pending']);
    expect(s.controller.getStatus().walkingPaths.notes).toContain('3 legs are straight, in short dashes, while their paths are computed.');
    s.controller.setRoutePaths({ pending: false, pathOf: () => null });
    expect(routeLine(s).map((item) => (item.type === 'polyline' ? item.style : null))).toEqual(['route-fallback']);
    expect(s.controller.getStatus().walkingPaths.notes).toContain('3 legs have no walking path: drawn straight, dash-dot-dot.');
    // Hover text names the style without step numbers lost.
    const run = routeLine(s)[0];
    if (run === undefined) throw new Error('no run');
    expect(s.controller.labelFor(run.ref)).toBe('Route (straight line: no walking path): steps 2–5');
  });

  it('rebuild the route layers only for a new paths object', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const paths = bentPaths();
    s.controller.setRoutePaths(paths);
    const sets = setLayerCount(s.adapter(), 'route-line');
    s.controller.setRoutePaths(paths);
    expect(setLayerCount(s.adapter(), 'route-line')).toBe(sets);
    s.controller.setRoutePaths(null);
    expect(setLayerCount(s.adapter(), 'route-line')).toBe(sets + 1);
  });
});
