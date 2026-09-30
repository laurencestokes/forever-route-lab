import { describe, expect, it } from 'vitest';
import { npcId, questId, sequentialIdSource, uiMapId, type DatasetView } from '../domain';
import { refsOf, type LayerId, type MapContainer, type MarkerDescriptor } from '../map/adapter';
import { fixedClock } from './clock';
import { createDerivedStore } from './derived';
import { createDerivedPipeline } from './derived-pipeline';
import { createMapController } from './map-controller';
import {
  fakeAdapterFactory,
  MAP_TEST_DATASET,
  MAP_TEST_DUROTAR,
  MAP_TEST_KALIMDOR,
  mapTestWorkspace,
  stubDataset,
  stubNpc,
  stubQuest,
  worldSpawn,
  type FakeAdapter,
} from './map-test-helpers';
import { openQuestsInDetails } from './map-view';
import { ManualTimers } from './navigation-test-helpers';
import { createEditorStore } from './store';
import { MAP_WORDING } from './map-wording';

/**
 * The map's quest layers from the derived pipeline's quest state (map-presentation.md §7; step
 * MP.3): the givers of the quests drawn by default with their state, every log quest's turn-in,
 * the log's open objectives as counted marks at the zone band, the hover's "after step N" and the
 * layer notes; without a model, the race-and-class rule, and it says so.
 *
 * The fixture (map-test-helpers): Gather (1) from and to Gornek; Cull (2) from Gornek, to Zureetha,
 * kill Boars. Steps: a note; accept Gather; accept Cull; complete Cull; turn in Cull; …
 */

const T0 = '2026-09-25T12:00:00.000Z';
const DUROTAR = uiMapId(1411);
const EL: MapContainer = { nodeType: 1, ownerDocument: null };

function setup(withDerived = true, dataset: DatasetView = MAP_TEST_DATASET) {
  const workspace = mapTestWorkspace(undefined, T0, dataset);
  const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(100), clock: fixedClock(T0) });
  const timers = new ManualTimers();
  const handle = createDerivedStore();
  const pipeline = createDerivedPipeline({ store, data: workspace.data, geometry: workspace.geometry, output: handle, timers, now: () => timers.now });
  const factory = fakeAdapterFactory();
  const controller = createMapController({
    wording: MAP_WORDING,
    store,
    data: workspace.data,
    geometry: workspace.geometry,
    describeStep: (step, index) => `${String(index + 1)} · ${step.kind}`,
    timing: null,
    derived: withDerived ? handle.store : null,
  });
  controller.attach(factory.factory, EL);
  const adapter = (): FakeAdapter => {
    const first = factory.adapters[0];
    if (first === undefined) throw new Error('no adapter');
    return first;
  };
  const select = (index: number): void => {
    const step = workspace.steps[index];
    if (step === undefined) throw new Error(`no step ${String(index)}`);
    store.select({ kind: 'single', id: step.id });
    timers.advance(0);
  };
  timers.advance(0);
  return { store, controller, adapter, select, pipeline, handle };
}

const markersOf = (adapter: FakeAdapter, layer: LayerId): readonly MarkerDescriptor[] =>
  (adapter.contents.get(layer)?.items ?? []).filter((item): item is MarkerDescriptor => item.type === 'marker');

describe('map controller: the quest layers from the quest state (MP.3)', () => {
  it('draws the givers of the quests available after the active step, with their state, and says whose state it is', () => {
    const s = setup();
    s.select(0);
    const [gornek] = markersOf(s.adapter(), 'available-quests');
    expect(gornek?.mark).toMatchObject({ state: 'available' });
    expect(gornek?.ref).toMatchObject({ kind: 'spawn', questIds: [questId(1), questId(2)] });
    expect(s.controller.labelFor(gornek?.ref ?? { kind: 'surface', mapId: 1 as never })).toMatch(/^After step 1: Gornek: 2 quests: Gather: available \(/);
    const notes = s.controller.getStatus().layers.find((layer) => layer.layer === 'available-quests')?.notes ?? [];
    expect(notes[0]).toBe('After step 1: 2 quests available, 0 may be available (uncertain) and 0 need a prerequisite, open to an Orc Warrior (dataset quests).');
    expect(notes[1]).toMatch(/^Not drawn: 0 unlock within 3 levels, 0 are low level, 0 are in the log \(turn-ins\) and 0 are done\.$/);
  });

  it('moves quests to the turn-ins once accepted, each with its turn-in state, and the numbers follow the route order', () => {
    const s = setup();
    s.select(2);
    expect(markersOf(s.adapter(), 'available-quests')).toEqual([]);
    const turnIns = markersOf(s.adapter(), 'turn-ins');
    expect(turnIns.map((marker) => [marker.label?.split(':')[0], marker.mark?.state, marker.mark?.progress])).toEqual([
      ['Gornek', 'ready', null],
      ['Zureetha', 'in-progress', { done: 0, total: 1 }],
    ]);
    const cull = turnIns[1];
    if (cull === undefined) throw new Error('no turn-in');
    expect(s.controller.labelFor(cull.ref)).toBe('After step 3: Zureetha: turn in Cull: in the quest log: 0 of 1 objectives done');
    const notes = s.controller.getStatus().layers.find((layer) => layer.layer === 'turn-ins')?.notes ?? [];
    expect(notes[0]).toBe('After step 3: 2 quests in the log, 1 ready to turn in; a quest whose progress is unknown is never shown as ready.');
  });

  it('draws the open objectives of log quests not in focus as counted marks at the zone band, and the focused quest’s raw', () => {
    const s = setup();
    s.select(2);
    s.controller.jumpToZone(DUROTAR);
    // The active step's quest (Cull) is in focus: its Boars are raw, and it has no counted mark.
    expect(markersOf(s.adapter(), 'objectives').map((marker) => marker.id)).toEqual(['spawn:npc:11:0', 'spawn:npc:11:1']);
    // With Gather open in Details, Cull is no longer in focus: one counted mark for its Boars.
    openQuestsInDetails(s.store, [questId(1)]);
    const [mark] = markersOf(s.adapter(), 'objectives');
    expect(mark).toMatchObject({ id: 'count:2:npc:11:1:1411', style: 'muted', mark: { state: 'objective' }, label: 'Boar · kill for Cull · 2 spawns in Durotar' });
    expect(refsOf(mark ?? ({} as MarkerDescriptor))[0]).toMatchObject({ kind: 'spawn', questIds: [questId(2)] });
  });

  it('draws no giver for a quest that is done, focused or not', () => {
    const s = setup();
    s.select(4);
    // After the turn-in Cull is done, and Gather (accepted at step 2) is in the log: no givers.
    expect(markersOf(s.adapter(), 'available-quests')).toEqual([]);
    openQuestsInDetails(s.store, [questId(2)]);
    // A done quest has no giver to go to, focused or not.
    expect(markersOf(s.adapter(), 'available-quests')).toEqual([]);
  });

  it('falls back to the quests open by race and class without route state, and says so', () => {
    const s = setup();
    // No active step yet: no model.
    const [giver] = markersOf(s.adapter(), 'available-quests');
    expect(giver?.mark).toBeUndefined();
    expect(s.controller.labelFor(giver?.ref ?? { kind: 'surface', mapId: 1 as never })).toMatch(/ · quests open to an Orc Warrior \(no route state yet\)$/);
    const none = setup(false);
    none.select(0);
    expect(markersOf(none.adapter(), 'available-quests')[0]?.mark).toBeUndefined();
    expect(none.controller.getStatus().layers.find((layer) => layer.layer === 'available-quests')?.notes[0]).toMatch(/^Quests open to an Orc Warrior \(no route state yet\): /);
  });

  it('stops following the quest state when detached', () => {
    const s = setup();
    s.controller.detach();
    s.select(0);
    s.controller.attach(fakeAdapterFactory().factory, EL);
    expect(markersOf(s.adapter(), 'available-quests')[0]?.mark).toMatchObject({ state: 'available' });
  });
});

// Review QA-09: a search only masked the pins already drawn, so a result in no drawn row (Gorn,
// whose quests are level 40) was announced and centred on, with nothing drawn there.
describe('map controller: search results drawn with pins of their own (§25.3.5; review QA-09)', () => {
  const GORN = npcId(30);
  const TROLL = npcId(31);
  const withGorn = stubDataset({
    quests: [
      MAP_TEST_DATASET.quest(questId(1)),
      MAP_TEST_DATASET.quest(questId(2)),
      stubQuest({ id: questId(3), name: 'Report to Kargath', level: 40, minLevel: 38, starters: [{ kind: 'npc', id: GORN }], finishers: [{ kind: 'npc', id: GORN }] }),
      stubQuest({ id: questId(4), name: 'Trolls', level: 40, minLevel: 38, starters: [{ kind: 'npc', id: npcId(12) }], objectives: [{ kind: 'kill', npcId: TROLL, label: null, count: null }] }),
    ].flatMap((quest) => (quest === undefined ? [] : [quest])),
    npcs: [stubNpc({ id: npcId(10), name: 'Gornek' }), stubNpc({ id: npcId(11), name: 'Boar' }), stubNpc({ id: npcId(12), name: 'Zureetha' }), stubNpc({ id: GORN, name: 'Gorn' }), stubNpc({ id: TROLL, name: 'Troll' })],
    spawns: {
      'npc:10': [worldSpawn(MAP_TEST_KALIMDOR, 0, -4000, MAP_TEST_DUROTAR)],
      'npc:11': [worldSpawn(MAP_TEST_KALIMDOR, 200, -4300, MAP_TEST_DUROTAR), worldSpawn(MAP_TEST_KALIMDOR, 220, -4320, MAP_TEST_DUROTAR)],
      'npc:12': [worldSpawn(MAP_TEST_KALIMDOR, 50, -4100, MAP_TEST_DUROTAR)],
      'npc:30': [worldSpawn(MAP_TEST_KALIMDOR, 400, -4500, MAP_TEST_DUROTAR)],
      'npc:31': [worldSpawn(MAP_TEST_KALIMDOR, 600, -4600, MAP_TEST_DUROTAR)],
    },
  });
  const idsIn = (adapter: FakeAdapter, layer: LayerId): readonly string[] => markersOf(adapter, layer).map((marker) => marker.id);

  it('draws a found NPC whose quests no row draws, with its quest’s state, rings it when chosen, and drops it after the search', () => {
    const s = setup(true, withGorn);
    s.select(0);
    s.controller.jumpToZone(DUROTAR);
    // Level 40 quests at level 1: in no drawn row, so no pin before the search.
    expect(idsIn(s.adapter(), 'available-quests')).not.toContain('spawn:npc:30:0');
    s.controller.setSearchFilter({ subjects: ['npc:30'], quests: [] });
    const gorn = markersOf(s.adapter(), 'available-quests').find((marker) => marker.id === 'spawn:npc:30:0');
    expect(gorn?.ref).toMatchObject({ kind: 'spawn', questIds: [questId(3)] });
    expect(gorn?.mark?.state).toBeDefined();
    expect(gorn?.emphasis).not.toBe('strong');
    expect(s.controller.showResult({ mapId: MAP_TEST_KALIMDOR, x: 400, y: -4500 }, { subject: 'npc:30' })).toBe(true);
    expect(s.adapter().callsOf('selectPins').at(-1)?.target).toEqual({ layer: 'available-quests', ids: ['spawn:npc:30:0'] });
    s.controller.setSearchFilter(null);
    expect(idsIn(s.adapter(), 'available-quests')).not.toContain('spawn:npc:30:0');
  });

  it('draws a found objective target and a found quest’s giver, whatever their row', () => {
    const s = setup(true, withGorn);
    s.select(0);
    s.controller.jumpToZone(DUROTAR);
    s.controller.setSearchFilter({ subjects: ['npc:31'], quests: [questId(3)] });
    // The Troll as an objective of Trolls (4), Gorn as the giver of the quest found (3).
    expect(idsIn(s.adapter(), 'objectives')).toContain('spawn:npc:31:0');
    expect(idsIn(s.adapter(), 'available-quests')).toContain('spawn:npc:30:0');
    // The mask still keeps only the results (Zureetha, the Trolls' giver, is not one).
    expect(s.adapter().callsOf('setMask').at(-1)?.mask.only).toEqual({ subjects: ['npc:31'], quests: [questId(3)] });
  });
});
