import { describe, expect, it } from 'vitest';
import { questId, sequentialIdSource, type StepId } from '../domain';
import type { LayerId, MapContainer, MapDescriptor, MarkerDescriptor, PolylineDescriptor } from '../map/adapter';
import { fixedClock } from './clock';
import { createDerivedStore } from './derived';
import { createDerivedPipeline } from './derived-pipeline';
import { DEFAULT_HIDDEN_CATEGORIES } from './map-categories';
import { createMapController } from './map-controller';
import { fakeAdapterFactory, MAP_TEST_KALIMDOR, mapTestWorkspace, type FakeAdapter } from './map-test-helpers';
import { openQuestsInDetails } from './map-view';
import { ManualTimers } from './navigation-test-helpers';
import { createEditorStore } from './store';
import { MAP_WORDING } from './map-wording';

/*
 * The presentation fixes in the controller (the joint review's presentation findings): the route
 * split at the active step (PR-02), the popover's pin drawn selected (PR-06), the coordinate grid
 * row (PR-10), and no turn-in for a focused quest that is done (PR-19). The fixture
 * (map-test-helpers): Gather (1) from and to Gornek; Cull (2) from Gornek, to Zureetha. Steps: a
 * note; accept Gather; accept Cull; complete Cull; turn in Cull; …
 */

const T0 = '2026-09-25T12:00:00.000Z';
const EL: MapContainer = { nodeType: 1, ownerDocument: null };

function setup(withDerived = true) {
  const workspace = mapTestWorkspace(undefined, T0);
  const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(100), clock: fixedClock(T0) });
  const timers = new ManualTimers();
  const handle = createDerivedStore();
  createDerivedPipeline({ store, data: workspace.data, geometry: workspace.geometry, output: handle, timers, now: () => timers.now });
  const factory = fakeAdapterFactory();
  const controller = createMapController({
    wording: MAP_WORDING,
    store,
    data: workspace.data,
    geometry: workspace.geometry,
    describeStep: (step, index) => `${String(index + 1)} · ${step.kind}`,
    timing: null,
    derived: withDerived ? handle.store : null,
    atlas: false,
    smoothWheel: false,
  });
  controller.attach(factory.factory, EL);
  const adapter = (): FakeAdapter => {
    const first = factory.adapters[0];
    if (first === undefined) throw new Error('no adapter');
    return first;
  };
  const select = (index: number): StepId => {
    const step = workspace.steps[index];
    if (step === undefined) throw new Error(`no step ${String(index)}`);
    store.select({ kind: 'single', id: step.id });
    timers.advance(0);
    return step.id;
  };
  timers.advance(0);
  return { store, controller, adapter, select, steps: workspace.steps };
}

const itemsOf = (adapter: FakeAdapter, layer: LayerId): readonly MapDescriptor[] => adapter.contents.get(layer)?.items ?? [];
const markersOf = (adapter: FakeAdapter, layer: LayerId): readonly MarkerDescriptor[] => itemsOf(adapter, layer).filter((item): item is MarkerDescriptor => item.type === 'marker');
const linesOf = (adapter: FakeAdapter): readonly PolylineDescriptor[] => itemsOf(adapter, 'route-line').filter((item): item is PolylineDescriptor => item.type === 'polyline');

describe('the route after the active step (map-presentation.md §13.6; review PR-02)', () => {
  it('draws nothing as after while no step is active, and splits the line and fades the beads after the active one', () => {
    const s = setup();
    expect(linesOf(s.adapter()).some((line) => line.after === true)).toBe(false);
    expect(markersOf(s.adapter(), 'route-steps').some((bead) => bead.after === true)).toBe(false);
    const active = s.select(2);
    const positions = new Map(s.steps.map((step, index) => [step.id, index]));
    const at = positions.get(active) ?? -1;
    // Every bead of a later step is faded, and none of the active step or before.
    for (const bead of markersOf(s.adapter(), 'route-steps')) {
      const later = bead.refs.every((ref) => ref.kind === 'step' && (positions.get(ref.stepId) ?? -1) > at);
      expect(bead.after === true).toBe(later);
    }
    // Every leg into a later step is on a piece after the split; every other leg on one before it.
    for (const line of linesOf(s.adapter())) {
      if (line.ref.kind !== 'run') continue;
      const into = line.ref.stepIds.slice(1).map((id) => (positions.get(id) ?? -1) > at);
      expect(into.every((later) => later === (line.after === true))).toBe(true);
    }
    expect(linesOf(s.adapter()).some((line) => line.after === true)).toBe(true);
  });
});

describe('the pin whose popover is open is drawn selected (§25.2.3; review PR-06)', () => {
  it('sends the clicked pin to selectPins while its popover is open, and clears it on close', () => {
    const s = setup(false);
    const giver = markersOf(s.adapter(), 'available-quests')[0];
    if (giver === undefined) throw new Error('no giver');
    s.adapter().emit({ type: 'click', point: giver.point, hit: { layer: 'available-quests', id: giver.id, ref: giver.ref, refs: giver.refs, segment: null }, zones: [] });
    expect(s.controller.getStatus().popover).not.toBeNull();
    expect(s.adapter().callsOf('selectPins').at(-1)?.target).toEqual({ layer: 'available-quests', ids: [giver.id] });
    s.controller.closePopover();
    expect(s.adapter().callsOf('selectPins').at(-1)?.target).toBeNull();
  });

  it('draws nothing selected for a popover on empty map', () => {
    const s = setup(false);
    s.controller.jumpToZone(1411 as never);
    s.adapter().emit({ type: 'click', point: { mapId: MAP_TEST_KALIMDOR, x: 100, y: -4000 }, hit: null, zones: [] });
    expect(s.controller.getStatus().popover).not.toBeNull();
    expect(s.adapter().callsOf('selectPins').at(-1)?.target ?? null).toBeNull();
  });
});

describe('the coordinate grid row (review PR-10)', () => {
  it('shows the grid by default and hides it with its row', () => {
    const s = setup(false);
    expect(DEFAULT_HIDDEN_CATEGORIES).not.toContain('coordinate-grid');
    expect(s.adapter().callsOf('setGrid').at(-1)?.shown).toBe(true);
    s.controller.setCategories([...DEFAULT_HIDDEN_CATEGORIES, 'coordinate-grid']);
    expect(s.adapter().callsOf('setGrid').at(-1)?.shown).toBe(false);
  });
});

describe('a focused quest that is done has no turn-in drawn (§25.2.3; review PR-19)', () => {
  it('leaves off the turn-in of a quest turned in by the step, even while it is open in Details', () => {
    const s = setup();
    // After the turn-in (step 5) Cull is done; Gather is still in the log.
    s.select(4);
    const drawnFor = (quest: number): readonly MarkerDescriptor[] =>
      markersOf(s.adapter(), 'turn-ins').filter((marker) => marker.refs.some((ref) => ref.kind === 'spawn' && ref.questIds.includes(questId(quest))));
    expect(drawnFor(2)).toEqual([]);
    openQuestsInDetails(s.store, [questId(2)]);
    expect(drawnFor(2)).toEqual([]);
    // Every turn-in still drawn has a state from the table (§25.2.3).
    for (const marker of markersOf(s.adapter(), 'turn-ins')) expect(marker.mark?.state).toMatch(/^(ready|in-progress|record-unknown)$/);
  });
});
