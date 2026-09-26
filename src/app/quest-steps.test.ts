import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  itemId,
  makeNoteStep,
  npcId,
  objectId,
  type ProjectV1,
  questId,
  type RouteStep,
  sequentialIdSource,
  stepId,
  uiMapId,
  worldMapId,
  worldSourcedPoint,
  zoneSourcedPoint,
} from '../domain';
import { fixtureGeometry } from '../geo/test-fixtures';
import type { CommandContext } from './commands';
import { stubDataset, stubItem, stubNpc, stubObject, stubQuest, worldSpawn } from './map-test-helpers';
import { addQuestSteps, insertionContext, nearestSpot, questPartSpots, type QuestSpot } from './quest-steps';
import { EMPTY_SELECTION, type Selection } from './selection';
import { createEditorStore } from './store';
import { fixedClock } from './clock';

const T0 = '2026-09-26T00:00:00.000Z';
const KALIMDOR = worldMapId(1);
const EK = worldMapId(0);
const DUROTAR = uiMapId(1411);

/**
 * Quest 7 "Boar Hunt": two givers (NPC 1 at x 0 and NPC 2 at x 1000), kill boars (NPC 3, spawns
 * at x 100 and x 900), collect tusks dropped by NPC 3 and chest object 4, and hand in to NPC 5
 * (x 950) or NPC 6 on the Eastern Kingdoms. Quest 8 has an item starter only.
 */
const DATASET = stubDataset({
  quests: [
    stubQuest({
      id: questId(7),
      name: 'Boar Hunt',
      starters: [
        { kind: 'npc', id: npcId(1) },
        { kind: 'npc', id: npcId(2) },
      ],
      finishers: [
        { kind: 'npc', id: npcId(6) },
        { kind: 'npc', id: npcId(5) },
      ],
      objectives: [
        { kind: 'kill', npcId: npcId(3), label: null, count: null },
        { kind: 'item', itemId: itemId(40), label: null, count: null },
        { kind: 'reputation', factionId: 76 as never, value: 100 },
      ],
    }),
    stubQuest({ id: questId(8), name: 'From an item', starters: [{ kind: 'item', id: itemId(40) }] }),
  ],
  npcs: [
    stubNpc({ id: npcId(1), name: 'West giver' }),
    stubNpc({ id: npcId(2), name: 'East giver' }),
    stubNpc({ id: npcId(3), name: 'Boar' }),
    stubNpc({ id: npcId(5), name: 'Receiver' }),
    stubNpc({ id: npcId(6), name: 'Faraway receiver' }),
  ],
  objects: [stubObject({ id: objectId(4), name: 'Chest' })],
  items: [stubItem({ id: itemId(40), name: 'Tusk', dropNpcs: [npcId(3)], dropObjects: [objectId(4)] })],
  spawns: {
    'npc:1': [worldSpawn(KALIMDOR, 0, 0, DUROTAR)],
    'npc:2': [worldSpawn(KALIMDOR, 1000, 0, DUROTAR)],
    'npc:3': [worldSpawn(KALIMDOR, 100, 0, DUROTAR), worldSpawn(KALIMDOR, 900, 0, DUROTAR), { source: { kind: 'instance', areaId: 1 as never }, world: null, uiMapId: null }],
    'object:4': [worldSpawn(KALIMDOR, 500, 0, DUROTAR)],
    'npc:5': [worldSpawn(KALIMDOR, 950, 0, DUROTAR)],
    'npc:6': [worldSpawn(EK, 0, 0, uiMapId(1429))],
  },
});

const at = (x: number, mapId = KALIMDOR) => ({ source: worldSourcedPoint(mapId, x, 0), label: null, radius: null });

function project(steps: RouteStep[] = []): ProjectV1 {
  const base = createEmptyProject({ ids: sequentialIdSource(), nowIso: T0, name: 'Quest steps' });
  return { ...base, route: { ...base.route, steps } };
}

function ctx(selection: Selection = EMPTY_SELECTION): CommandContext {
  return { ids: sequentialIdSource(100), nowIso: T0, selection };
}

describe('questPartSpots', () => {
  const quest = DATASET.quest(questId(7));
  if (quest === undefined) throw new Error('quest 7 missing');

  it('lists the starters’ and finishers’ spawns with the entity and its name, never an instance spawn', () => {
    const accept = questPartSpots(DATASET, quest, 'accept');
    expect(accept.map((spot) => spot.via)).toEqual([
      { kind: 'npc', id: 1 },
      { kind: 'npc', id: 2 },
    ]);
    expect(accept[0]?.location).toEqual({ source: zoneSourcedPoint(DUROTAR, 50, 50), label: 'West giver', radius: null });
    expect(questPartSpots(DATASET, quest, 'turnin').map((spot) => spot.world?.mapId)).toEqual([EK, KALIMDOR]);
    // The objective's creature has an instance spawn too: it has no published point, so it is left out.
    expect(questPartSpots(DATASET, quest, 'complete', { objective: 0 })).toHaveLength(2);
  });

  it('finds an item objective at its drop sources, and nothing for reputation', () => {
    const tusks = questPartSpots(DATASET, quest, 'complete', { objective: 1 });
    expect(tusks.map((spot) => spot.via)).toEqual([
      { kind: 'npc', id: 3 },
      { kind: 'npc', id: 3 },
      { kind: 'object', id: 4 },
    ]);
    expect(questPartSpots(DATASET, quest, 'complete', { objective: 2 })).toEqual([]);
    // All objectives: every target in objective order.
    expect(questPartSpots(DATASET, quest, 'complete')).toHaveLength(5);
  });

  it('adds a custom quest’s own starter and finisher locations', () => {
    const custom = { starterLocation: at(10), finisherLocation: null } as never;
    const spots = questPartSpots(DATASET, quest, 'accept', { custom });
    expect(spots.at(-1)).toMatchObject({ via: null, world: { mapId: KALIMDOR, x: 10, y: 0 } });
  });

  it('has no spot for an item starter', () => {
    const fromItem = DATASET.quest(questId(8));
    if (fromItem === undefined) throw new Error('quest 8 missing');
    expect(questPartSpots(DATASET, fromItem, 'accept')).toEqual([]);
  });
});

describe('nearestSpot', () => {
  const spot = (x: number, mapId = KALIMDOR, world = true): QuestSpot => ({ via: null, location: at(x, mapId), world: world ? { mapId, x, y: 0 } : null });

  it('takes the nearest by straight line on the context’s world map, ties to the earlier spot', () => {
    expect(nearestSpot([spot(0), spot(100), spot(90)], { mapId: KALIMDOR, x: 95, y: 0 })?.location.source).toMatchObject({ x: 100 });
    expect(nearestSpot([spot(10), spot(-10)], { mapId: KALIMDOR, x: 0, y: 0 })?.location.source).toMatchObject({ x: 10 });
  });

  it('puts spots on another world map or without a position after the rest, and handles no context', () => {
    expect(nearestSpot([spot(0, EK), spot(5000)], { mapId: KALIMDOR, x: 0, y: 0 })?.location.source).toMatchObject({ x: 5000 });
    expect(nearestSpot([spot(0, EK)], { mapId: KALIMDOR, x: 0, y: 0 })?.location.source).toMatchObject({ mapId: EK });
    expect(nearestSpot([spot(1, KALIMDOR, false), spot(2)], null)?.location.source).toMatchObject({ x: 2 });
    expect(nearestSpot([spot(1, KALIMDOR, false)], { mapId: KALIMDOR, x: 0, y: 0 })?.location.source).toMatchObject({ x: 1 });
    expect(nearestSpot([], null)).toBeNull();
  });
});

describe('insertionContext', () => {
  it('is the last located step before the insertion point, else the start location, else unknown', () => {
    const ids = sequentialIdSource();
    const steps = [makeNoteStep(ids, { text: 'a', location: at(300) }), makeNoteStep(ids, { text: 'b' }), makeNoteStep(ids, { text: 'c', location: at(700) })];
    const p = project(steps);
    expect(insertionContext(p, 2, null)).toEqual({ mapId: KALIMDOR, x: 300, y: 0 });
    expect(insertionContext(p, 3, null)).toEqual({ mapId: KALIMDOR, x: 700, y: 0 });
    expect(insertionContext(p, 0, null)).toBeNull();
    const started: ProjectV1 = { ...p, character: { ...p.character, startLocation: at(-50) } };
    expect(insertionContext(started, 0, null)).toEqual({ mapId: KALIMDOR, x: -50, y: 0 });
  });

  it('places zone-percent locations only with geometry', () => {
    const ids = sequentialIdSource();
    const zone = { source: zoneSourcedPoint(DUROTAR, 42.06, 68.33), label: null, radius: null };
    const p = project([makeNoteStep(ids, { text: 'Gornek', location: zone })]);
    expect(insertionContext(p, 1, null)).toBeNull();
    expect(insertionContext(p, 1, fixtureGeometry())?.mapId).toBe(KALIMDOR);
  });
});

describe('addQuestSteps', () => {
  const options = { dataset: DATASET, geometry: null };

  it('adds accept, complete and turn-in as one command, each at the spot nearest the one before', () => {
    const ids = sequentialIdSource();
    const p = project([makeNoteStep(ids, { text: 'Here', location: at(980) })]);
    const out = addQuestSteps(questId(7), ['turnin', 'accept', 'complete'], options).apply(p, ctx());
    const added = out.route.steps.slice(1);
    expect(added.map((s) => s.kind)).toEqual(['accept', 'complete', 'turnin']);
    // East giver (x 1000) is nearest x 980; then the boar at x 900; then the receiver at x 950.
    expect(added[0]).toMatchObject({ kind: 'accept', questId: 7, via: { kind: 'npc', id: 2 }, location: { label: 'East giver' } });
    expect(added[1]).toMatchObject({ kind: 'complete', targets: [{ questId: 7, objective: null }], progress: 'finish', location: { label: 'Boar' } });
    expect(added[2]).toMatchObject({ kind: 'turnin', questId: 7, via: { kind: 'npc', id: 5 } });
    expect(added.every((s) => s.origin.source === 'manual' && s.id.startsWith('step-'))).toBe(true);
    expect(addQuestSteps(questId(7), ['accept', 'complete', 'turnin'], options).label).toBe('Add quest');
  });

  it('walks from the west giver when the context is west, and targets one objective', () => {
    const ids = sequentialIdSource();
    const p = project([makeNoteStep(ids, { text: 'West', location: at(-100) })]);
    const accept = addQuestSteps(questId(7), ['accept'], options).apply(p, ctx());
    expect(accept.route.steps[1]).toMatchObject({ via: { kind: 'npc', id: 1 } });
    const tusks = addQuestSteps(questId(7), ['complete'], { ...options, objective: 1 }).apply(p, ctx());
    expect(tusks.route.steps[1]).toMatchObject({ targets: [{ questId: 7, objective: 1 }], location: { label: 'Boar' } });
    expect(addQuestSteps(questId(7), ['complete'], options).label).toBe('Add complete');
  });

  it('inserts after the selection by default, or at an index, and leaves the location unknown when nothing places it', () => {
    const ids = sequentialIdSource();
    const steps = [makeNoteStep(ids, { text: 'a' }), makeNoteStep(ids, { text: 'b' })];
    const p = project(steps);
    const selected: Selection = { stepIds: new Set([steps[0]?.id ?? stepId('x')]), anchor: null, focus: null };
    const out = addQuestSteps(questId(8), ['accept', 'turnin'], options).apply(p, ctx(selected));
    expect(out.route.steps.map((s) => s.kind)).toEqual(['note', 'accept', 'turnin', 'note']);
    expect(out.route.steps[1]?.location).toBeNull();
    expect(out.route.steps[1]).toMatchObject({ via: null });
    const atStart = addQuestSteps(questId(8), ['accept'], { ...options, at: 0 }).apply(p, ctx(selected));
    expect(atStart.route.steps[0]?.kind).toBe('accept');
    // A quest the dataset does not have still gets its steps, with no location.
    const unknown = addQuestSteps(questId(999), ['accept'], options).apply(p, ctx());
    expect(unknown.route.steps.at(-1)).toMatchObject({ kind: 'accept', questId: 999, location: null, via: null });
    expect(addQuestSteps(questId(7), [], options).apply(p, ctx())).toBe(p);
  });

  it('is one undo entry in the store, and the new steps become the selection', () => {
    const store = createEditorStore({ project: project(), ids: sequentialIdSource(), clock: fixedClock(T0) });
    store.dispatch(addQuestSteps(questId(7), ['accept', 'complete', 'turnin'], options));
    expect(store.getState().project.route.steps).toHaveLength(3);
    expect(store.getState().selection.stepIds.size).toBe(3);
    expect(store.getState().history.undoLabel).toBe('Add quest');
    store.undo();
    expect(store.getState().project.route.steps).toHaveLength(0);
  });
});
