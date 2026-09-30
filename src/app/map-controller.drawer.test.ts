import { describe, expect, it } from 'vitest';
import { questId, sequentialIdSource, worldMapId, type WorldPoint } from '../domain';
import type { MapContainer, MapHit, MapRef } from '../map/adapter';
import { fixedClock } from './clock';
import { CLUSTER_MAX_ZOOM, createMapController, RESULT_MIN_ZOOM, type MapControllerOptions } from './map-controller';
import { fakeAdapterFactory, mapTestWorkspace, type FakeAdapter } from './map-test-helpers';
import { MAP_WORDING } from './map-wording';
import { createEditorStore } from './store';

/*
 * The controller's side of the Map layers drawer (docs/research/map-presentation.md §25.3; D-047;
 * steps MP.4a to MP.4c): the rows it applies (the adapter's mask, the step numbers), the search's
 * filter and a chosen result, the view commands, a cluster's click, and the drawer's words and
 * counts, which arrive with the drawer's lazy part (`setWording`).
 */

const T0 = '2026-09-28T12:00:00.000Z';
const KALIMDOR = worldMapId(1);
const EL: MapContainer = { nodeType: 1, ownerDocument: null };
const GORNEK: WorldPoint = { mapId: KALIMDOR, x: 0, y: -4000 };

function setup(options: Partial<MapControllerOptions> = {}) {
  const workspace = mapTestWorkspace(undefined, T0);
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
    ...options,
  });
  controller.attach(factory.factory, EL);
  const adapter = factory.adapters[0];
  if (adapter === undefined) throw new Error('no adapter');
  return { store, controller, adapter };
}

const lastMask = (adapter: FakeAdapter) => adapter.callsOf('setMask').at(-1)?.mask;
const notesOf = (s: ReturnType<typeof setup>, layer: string) => s.controller.getStatus().layers.find((entry) => entry.layer === layer)?.notes;

describe('the drawer’s rows in the controller (§25.3.4)', () => {
  it('starts with the default rows hidden by the adapter’s mask, and applies new rows as a redraw, never a rebuild', () => {
    const s = setup();
    expect(lastMask(s.adapter)).toEqual({ hidden: ['unlocks-soon', 'low-level', 'unconfirmed-raids', 'other-faction-flights'], only: null });
    const builds = s.adapter.callsOf('setLayer').length;
    s.controller.setCategories(['available', 'route-line', 'available']);
    expect(lastMask(s.adapter)).toEqual({ hidden: ['available'], only: null });
    expect(s.controller.getStatus().hidden).toEqual(['available', 'route-line']);
    expect(s.adapter.callsOf('setLayer')).toHaveLength(builds);
    // The same rows again: nothing sent.
    const masks = s.adapter.callsOf('setMask').length;
    s.controller.setCategories(['route-line', 'available']);
    expect(s.adapter.callsOf('setMask')).toHaveLength(masks);
  });

  it('hides the step numbers on the labels canvas with their row', () => {
    const s = setup();
    s.controller.setCategories(['step-numbers']);
    expect(s.adapter.callsOf('setStepNumbers').at(-1)?.shown).toBe(false);
    s.controller.setCategories([]);
    expect(s.adapter.callsOf('setStepNumbers').at(-1)?.shown).toBe(true);
  });
});

describe('the map search in the controller (§25.3.5)', () => {
  it('draws only the results while a query lasts, whatever their row, and the rows again after it', () => {
    const s = setup();
    s.controller.setCategories(['available']);
    const only = { subjects: ['npc:10'], quests: [questId(2)] };
    s.controller.setSearchFilter(only);
    expect(lastMask(s.adapter)).toEqual({ hidden: [], only });
    expect(s.controller.getStatus().searching).toBe(true);
    s.controller.setSearchFilter(null);
    expect(lastMask(s.adapter)).toEqual({ hidden: ['available'], only: null });
    expect(s.controller.getStatus().searching).toBe(false);
  });

  it('shows a chosen result at the zone band at least, rings its pin, and says when no surface shows it', () => {
    const s = setup();
    expect(s.controller.showResult(GORNEK, { subject: 'npc:10' })).toBe(true);
    const focus = s.adapter.callsOf('focus').at(-1);
    expect(focus?.point).toEqual(GORNEK);
    expect(focus?.options.zoom).toBeGreaterThanOrEqual(RESULT_MIN_ZOOM);
    const ringed = s.adapter.callsOf('selectPins').at(-1)?.target;
    expect(ringed?.layer).toBe('available-quests');
    expect(ringed?.ids.length).toBeGreaterThan(0);
    // §25.3.5 (review PR-05): the chosen result's popover opens on its pin, beside the point.
    const popover = s.controller.getStatus().popover;
    expect(popover?.layer).toBe('available-quests');
    expect(popover?.refs.some((ref) => ref.kind === 'spawn' && ref.subject.kind === 'npc' && ref.subject.id === 10)).toBe(true);
    expect(s.controller.showResult({ mapId: worldMapId(9999), x: 0, y: 0 }, null)).toBe(false);
    // Ending the search lets the ring go (once its popover has closed: the pin of an open popover stays selected).
    s.controller.closePopover();
    s.controller.setSearchFilter({ subjects: ['npc:10'], quests: [] });
    s.controller.setSearchFilter(null);
    expect(s.adapter.callsOf('selectPins').at(-1)?.target).toBeNull();
  });

  it('fits the results it can show, and none when no surface shows them', () => {
    const s = setup();
    expect(s.controller.fitPoints([GORNEK, { mapId: KALIMDOR, x: 1700, y: -4400 }])).toBe(true);
    const fit = s.adapter.callsOf('fitBounds').at(-1)?.bounds;
    expect(fit).toMatchObject({ mapId: KALIMDOR });
    expect(fit?.xMin).toBeLessThanOrEqual(0);
    expect(fit?.xMax).toBeGreaterThanOrEqual(1700);
    expect(s.controller.fitPoints([])).toBe(false);
    expect(s.controller.fitPoints([{ mapId: worldMapId(9999), x: 0, y: 0 }])).toBe(false);
  });
});

describe('the view commands and clusters (§25.3.0, §25.2.5)', () => {
  it('zooms by whole levels through the adapter', () => {
    const s = setup();
    s.controller.zoomBy(1);
    s.controller.zoomBy(-1);
    expect(s.adapter.callsOf('zoomBy').map((call) => call.delta)).toEqual([1, -1]);
  });

  it('zooms in to a clicked cluster’s members, no further than where they separate', () => {
    const s = setup();
    const bounds = { mapId: KALIMDOR, xMin: -100, xMax: 100, yMin: -4200, yMax: -3900 };
    const ref: MapRef = { kind: 'cluster', layer: 'available-quests', bounds, quests: 2, places: 1 };
    const hit: MapHit = { layer: 'available-quests', id: 'cluster:1', ref, refs: [ref], segment: null };
    s.adapter.emit({ type: 'click', point: GORNEK, hit, zones: [] });
    const fit = s.adapter.callsOf('fitBounds').at(-1);
    expect(fit?.bounds).toEqual(bounds);
    expect(fit?.options.maxZoom).toBe(CLUSTER_MAX_ZOOM);
  });
});

describe('the drawer’s words and counts (a lazy part, §25.3.3)', () => {
  it('keeps the notes and counts empty until the drawer installs its words, then publishes them', () => {
    const s = setup({ wording: null });
    expect(notesOf(s, 'available-quests')).toEqual([]);
    expect(s.controller.getStatus().counts.who).toBe('');
    let published = 0;
    s.controller.subscribe(() => {
      published += 1;
    });
    s.controller.setWording(MAP_WORDING);
    expect(published).toBeGreaterThan(0);
    expect(notesOf(s, 'available-quests')?.[0]).toMatch(/the givers of all 2 quests open by race and class\.$/);
    const counts = s.controller.getStatus().counts;
    expect(counts).toMatchObject({ afterStep: null, who: 'Orc Warrior', quests: { available: 2 }, availableGivers: null, places: { 'flight-points': 1 } });
    // Installing it again changes nothing.
    const before = published;
    s.controller.setWording(MAP_WORDING);
    expect(published).toBe(before);
  });

  it('counts what the settled view shows of each row', () => {
    const s = setup();
    s.adapter.pan({ x: GORNEK.x, y: GORNEK.y, zoom: -2 });
    const inView = s.controller.getStatus().counts.inView;
    // Gornek's two quests, and no flight master here.
    expect(inView.available).toBe(2);
    expect(inView['flight-points']).toBeUndefined();
  });
});
