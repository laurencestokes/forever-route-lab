import { describe, expect, it } from 'vitest';
import { fixtureView } from '../../tests/support/fixture-dataset';
import {
  itemId,
  makeAcceptStep,
  makeNoteStep,
  makeTravelStep,
  npcId,
  objectId,
  questId,
  sequentialIdSource,
  stepId,
  uiMapId,
  worldMapId,
  worldSourcedPoint,
  zoneSourcedPoint,
  type Location,
  type RouteStep,
} from '../domain';
import { fixtureGeometry } from '../geo/test-fixtures';
import { surfacesOf } from '../map/layers';
import {
  createDrawnRouteFilter,
  createRouteInputBuilder,
  firstRouteSurface,
  flightMasterModel,
  focusQuestIds,
  focusWithin,
  legUnknownAt,
  mapRouteInput,
  objectiveModel,
  questGiverModel,
  routeBoundsOn,
  routeMapSummary,
  routeStepIndex,
  routeStepOf,
  stepFocusOf,
  stepsWithoutSurface,
  turnInModel,
  zoneBounds,
  zoneGroups,
} from './map-model';
import { stubDataset, stubItem, stubNpc, stubObject, stubQuest, worldSpawn, instanceSpawn } from './map-test-helpers';
import { EMPTY_SELECTION, type Selection } from './selection';
import { questsForCharacter } from './shell-support';

const GEOMETRY = fixtureGeometry();
const KALIMDOR = worldMapId(1);
const EK = worldMapId(0);
const DUROTAR = uiMapId(1411);
const at = (x: number, y: number) => worldSpawn(KALIMDOR, x, y, DUROTAR);
const HORDE_WARRIOR = { race: 'Orc', class: 'WARRIOR' } as const;

describe('questGiverModel (the Available tab’s quests)', () => {
  it('groups the open quests by starter, labels each giver with what it starts, and counts what has no giver', () => {
    const dataset = stubDataset({
      quests: [
        stubQuest({ id: questId(1), name: 'Alpha', starters: [{ kind: 'npc', id: npcId(10) }] }),
        stubQuest({ id: questId(2), name: 'Beta', starters: [{ kind: 'npc', id: npcId(10) }] }),
        stubQuest({ id: questId(3), name: 'Gamma', starters: [{ kind: 'npc', id: npcId(10) }] }),
        stubQuest({ id: questId(4), name: 'Delta', starters: [{ kind: 'object', id: objectId(20) }] }),
        stubQuest({ id: questId(5), name: 'Epsilon', starters: [{ kind: 'item', id: itemId(30) }] }),
        stubQuest({ id: questId(6), name: 'Zeta', starters: [] }),
        // Human only (race bit 0): closed to an Orc, so not a giver here.
        stubQuest({ id: questId(7), name: 'Eta', races: 1, starters: [{ kind: 'npc', id: npcId(11) }] }),
      ],
      npcs: [stubNpc({ id: npcId(10), name: 'Gornek' }), stubNpc({ id: npcId(11), name: 'Marshal' })],
      objects: [stubObject({ id: objectId(20), name: 'Wanted Poster' })],
      spawns: { 'npc:10': [at(0, -4000)], 'object:20': [at(10, -4010), at(20, -4020)] },
    });
    const model = questGiverModel(dataset, HORDE_WARRIOR);
    expect(model.openQuests).toBe(6);
    expect(model.itemStarted).toBe(1);
    expect(model.noStarter).toBe(1);
    expect(model.spawnlessGivers).toBe(0);
    expect(model.input.groups.map((g) => [g.subject, g.label, g.questIds, g.spawns.length])).toEqual([
      [{ kind: 'npc', id: 10 }, 'Gornek: starts 3 quests (Alpha, Beta and 1 more)', [1, 2, 3], 1],
      [{ kind: 'object', id: 20 }, 'Wanted Poster: starts Delta', [4], 2],
    ]);
  });

  it('counts givers with no spawn in the dataset, and the quests left with no giver marker (MAP-HONEST-4)', () => {
    const dataset = stubDataset({
      quests: [
        stubQuest({ id: questId(1), name: 'Seen', starters: [{ kind: 'npc', id: npcId(10) }] }),
        // Two spawnless starters: one giver quest with no marker at all.
        stubQuest({ id: questId(2), name: 'Unseen', starters: [{ kind: 'npc', id: npcId(11) }, { kind: 'object', id: objectId(20) }] }),
        // A spawnless starter beside a spawned one still has a marker.
        stubQuest({ id: questId(3), name: 'Half', starters: [{ kind: 'npc', id: npcId(10) }, { kind: 'npc', id: npcId(11) }] }),
        // A spawnless NPC and an item: the item starts it, so it is not without a start.
        stubQuest({ id: questId(4), name: 'Item too', starters: [{ kind: 'npc', id: npcId(11) }, { kind: 'item', id: itemId(30) }] }),
      ],
      npcs: [stubNpc({ id: npcId(10), name: 'Seen' }), stubNpc({ id: npcId(11), name: 'Ghost' })],
      objects: [stubObject({ id: objectId(20), name: 'Lost chest' })],
      spawns: { 'npc:10': [at(0, -4000)] },
    });
    const model = questGiverModel(dataset, HORDE_WARRIOR);
    expect(model.spawnlessGivers).toBe(2);
    expect(model.spawnlessQuests).toBe(1);
    expect(model.itemStarted).toBe(0);
    // The spawnless givers stay in the input (map/layers draws nothing of them).
    expect(model.input.groups.map((g) => [g.label, g.spawns.length])).toEqual([
      ['Seen: starts 2 quests (Seen and Half)', 1],
      ['Ghost: starts 3 quests (Unseen, Half and 1 more)', 0],
      ['Lost chest: starts Unseen', 0],
    ]);
  });

  it('follows the Available tab’s rule over the real fixture slice: every open quest with an NPC or object starter has a giver', () => {
    const dataset = fixtureView();
    const model = questGiverModel(dataset, HORDE_WARRIOR);
    const { open } = questsForCharacter(dataset, HORDE_WARRIOR);
    expect(model.openQuests).toBe(open.length);
    const covered = new Set(model.input.groups.flatMap((g) => g.questIds));
    for (const quest of open) {
      const placeable = quest.starters.some((ref) => ref.kind !== 'item');
      expect(covered.has(quest.id)).toBe(placeable);
    }
    // Gornek (3143) starts quests in the Valley of Trials.
    const gornek = model.input.groups.find((g) => g.subject.kind === 'npc' && g.subject.id === npcId(3143));
    expect(gornek?.label).toMatch(/^Gornek: starts /);
  });
});

describe('objectiveModel and turnInModel (the focused quests)', () => {
  const dataset = stubDataset({
    quests: [
      stubQuest({
        id: questId(1),
        name: 'Cull',
        objectives: [
          { kind: 'kill', npcId: npcId(10), label: null, count: null },
          { kind: 'killCredit', npcIds: [npcId(11), npcId(12)], rootNpcId: npcId(11), label: null, count: null },
          { kind: 'object', objectId: objectId(20), label: null, count: null },
          { kind: 'item', itemId: itemId(30), label: null, count: null },
          { kind: 'item', itemId: itemId(31), label: null, count: null },
          { kind: 'reputation', factionId: 76 as never, value: 3000 },
          { kind: 'event', text: 'Scout the camp', points: [zoneSourcedPoint(DUROTAR, 50, 50), { kind: 'instance', areaId: 1 as never }] },
          { kind: 'event', text: null, points: [] },
        ],
        finishers: [{ kind: 'npc', id: npcId(10) }, { kind: 'item', id: itemId(30) }],
      }),
    ],
    npcs: [stubNpc({ id: npcId(10), name: 'Boar' }), stubNpc({ id: npcId(11), name: 'Credit' }), stubNpc({ id: npcId(12), name: 'Helper' })],
    objects: [stubObject({ id: objectId(20), name: 'Cage' }), stubObject({ id: objectId(21), name: 'Chest' })],
    items: [
      stubItem({ id: itemId(30), name: 'Tusk', dropNpcs: [npcId(10)], dropObjects: [objectId(21)] }),
      stubItem({ id: itemId(31), name: 'Relic', dropItems: [itemId(30)] }),
    ],
    spawns: { 'npc:10': [at(0, -4000)], 'object:21': [instanceSpawn(1)] },
  });

  it('draws kill, kill-credit, object and drop-source targets and event areas, and counts objectives with no map position', () => {
    const model = objectiveModel(dataset, GEOMETRY, [questId(1), questId(1), questId(99)]);
    expect(model.questIds).toEqual([1, 99]);
    expect(model.missingQuests).toBe(1);
    // Reputation, the item that drops only from another item, and the event without points.
    expect(model.noPosition).toBe(3);
    // Kill credit (Credit and Helper have no spawns) and the Cage have no spawn in the dataset;
    // the Tusk drops from the Boar, which has one.
    expect(model.spawnless).toBe(2);
    expect(model.input.groups.map((g) => g.label)).toEqual([
      'Boar · kill for Cull',
      'Credit · kill credit for Cull',
      'Helper · kill credit for Cull',
      'Cage · use for Cull',
      'Boar · drops Tusk for Cull',
      'Chest · holds Tusk for Cull',
      'Scout the camp · for Cull',
    ]);
    const event = model.input.groups.at(-1);
    expect(event?.subject).toEqual({ kind: 'event', questId: 1, objective: 6 });
    // The zone point resolves through the geometry; the instance point stays without a world position.
    expect(event?.spawns.map((s) => s.world === null)).toEqual([false, true]);
    expect(event?.spawns[0]?.uiMapId).toBe(DUROTAR);
  });

  it('draws the finishing NPCs and objects; an item finisher has no map position', () => {
    const model = turnInModel(dataset, [questId(1)]);
    expect(model.input.groups.map((g) => [g.label, g.questIds])).toEqual([['Boar · turn in Cull', [1]]]);
    expect(model.noPosition).toBe(1);
    expect(model.spawnless).toBe(0);
    expect(turnInModel(dataset, []).input.groups).toEqual([]);
  });

  it('counts turn-ins whose NPC and object finishers all have no spawn (MAP-HONEST-4)', () => {
    const spawnless = stubDataset({
      quests: [
        stubQuest({ id: questId(1), name: 'Lost', finishers: [{ kind: 'npc', id: npcId(11) }, { kind: 'object', id: objectId(21) }] }),
        stubQuest({ id: questId(2), name: 'Found', finishers: [{ kind: 'npc', id: npcId(11) }, { kind: 'npc', id: npcId(10) }] }),
      ],
      npcs: [stubNpc({ id: npcId(10), name: 'Boar' }), stubNpc({ id: npcId(11), name: 'Ghost' })],
      spawns: { 'npc:10': [at(0, -4000)] },
    });
    expect(turnInModel(spawnless, [questId(1), questId(2)]).spawnless).toBe(1);
    const kill = stubDataset({
      quests: [stubQuest({ id: questId(1), name: 'Hunt', objectives: [{ kind: 'kill', npcId: npcId(11), label: null, count: null }] })],
      npcs: [stubNpc({ id: npcId(11), name: 'Ghost' })],
    });
    expect(objectiveModel(kill, GEOMETRY, [questId(1)])).toMatchObject({ spawnless: 1, noPosition: 0 });
  });
});

describe('flightMasterModel', () => {
  const FM = 8;
  const dataset = stubDataset({
    npcs: [
      stubNpc({ id: npcId(1), name: 'Doras', subName: 'Wind Rider Master', npcFlags: FM + 2, friendlyTo: 'H' }),
      stubNpc({ id: npcId(2), name: 'Gryphon Master', npcFlags: FM, friendlyTo: 'A' }),
      stubNpc({ id: npcId(3), name: 'Neutral', npcFlags: FM, friendlyTo: 'AH' }),
      stubNpc({ id: npcId(4), name: 'Mystery', npcFlags: FM, friendlyTo: null }),
      stubNpc({ id: npcId(5), name: 'Innkeeper', npcFlags: 128, friendlyTo: 'H' }),
    ],
    spawns: { 'npc:1': [at(1, -4400)] },
  });

  const HORDE = { faction: 'Horde', ...HORDE_WARRIOR } as const;

  it('keeps the faction’s flight masters and those with an unknown faction (labelled so), and counts the others', () => {
    const model = flightMasterModel(dataset, [npcId(1), npcId(2), npcId(3), npcId(4), npcId(5), npcId(6)], HORDE);
    expect(model.input.groups.map((g) => g.label)).toEqual([
      'Doras <Wind Rider Master> · flight master',
      'Neutral · flight master',
      'Mystery · flight master (faction unknown)',
    ]);
    expect(model.otherFaction).toBe(1);
    expect(model.factionUnknown).toBe(1);
    // Neutral and Mystery have no spawn here.
    expect(model.spawnless).toBe(2);
    expect(model.input.groups.every((g) => g.questIds.length === 0)).toBe(true);
  });

  it('gives a flight master the open quests it starts, so a click on it opens them (MAP-UX-3)', () => {
    const starts = stubDataset({
      quests: [
        stubQuest({ id: questId(6386), name: 'Return to the Crossroads.', starters: [{ kind: 'npc', id: npcId(1) }] }),
        // Human only: not open to an Orc, so not offered.
        stubQuest({ id: questId(7), name: 'Closed', races: 1, starters: [{ kind: 'npc', id: npcId(1) }] }),
      ],
      npcs: [stubNpc({ id: npcId(1), name: 'Doras', subName: 'Wind Rider Master', npcFlags: FM, friendlyTo: 'H' })],
      spawns: { 'npc:1': [at(1, -4400)] },
    });
    const model = flightMasterModel(starts, [npcId(1)], HORDE);
    expect(model.input.groups.map((g) => [g.label, g.questIds])).toEqual([
      ['Doras <Wind Rider Master> · flight master; starts Return to the Crossroads.', [6386]],
    ]);
  });
});

describe('the route', () => {
  const ids = sequentialIdSource();
  const loc = (x: number, y: number, mapId = KALIMDOR): Location => ({ source: worldSourcedPoint(mapId, x, y), label: null, radius: null });
  const steps: RouteStep[] = [
    makeNoteStep(ids, { text: 'start' }),
    makeAcceptStep(ids, { questId: questId(1), location: loc(0, -4000) }),
    makeAcceptStep(ids, { questId: questId(2), location: loc(100, -4200) }),
    makeTravelStep(ids, {}),
    makeAcceptStep(ids, { questId: questId(3), location: loc(-9000, 800, EK) }),
    makeAcceptStep(ids, { questId: questId(4), location: { source: zoneSourcedPoint(uiMapId(9999), 1, 1), label: null, radius: null } }),
  ];
  const route = mapRouteInput(steps, GEOMETRY);

  it('places each step with its quests, and carries neither its position nor its text (PERF-2)', () => {
    expect(route.steps.map((s) => [s.stepId, s.placement.kind, s.questIds])).toEqual([
      [steps[0]?.id, 'none', []],
      [steps[1]?.id, 'point', [1]],
      [steps[2]?.id, 'point', [2]],
      [steps[3]?.id, 'unknown', []],
      [steps[4]?.id, 'point', [3]],
      [steps[5]?.id, 'unknown', [4]],
    ]);
    expect(Object.keys(route.steps[0] ?? {}).sort()).toEqual(['arrive', 'departs', 'placement', 'questIds', 'stepId']);
  });

  it('says whether the leg into a step is unknown, and counts steps on maps with no surface', () => {
    expect([1, 2, 4, 5].map((i) => legUnknownAt(route, i))).toEqual([false, false, true, false]);
    // The fifth step (index 4) follows the travel step with no destination; the sixth is itself unplaced.
    const summary = routeMapSummary(mapRouteInput([...steps, makeAcceptStep(ids, { questId: questId(5), location: loc(1, 2, worldMapId(36)) })], GEOMETRY));
    expect(stepsWithoutSurface(summary, surfacesOf(GEOMETRY))).toBe(1);
    expect(stepsWithoutSurface(routeMapSummary(route), surfacesOf(GEOMETRY))).toBe(0);
  });

  it('summarises the route by world map, in the order the route reaches them', () => {
    expect(routeMapSummary(route)).toEqual({
      total: 6,
      placed: 3,
      unplaced: 2,
      withoutLocation: 1,
      maps: [
        { mapId: KALIMDOR, steps: 2 },
        { mapId: EK, steps: 1 },
      ],
    });
    expect(firstRouteSurface(route)).toBe('world:1');
    expect(firstRouteSurface({ steps: [] })).toBeNull();
  });

  it('bounds the placed steps on one world map only', () => {
    expect(routeBoundsOn(route, KALIMDOR)).toEqual({ mapId: KALIMDOR, xMin: 0, xMax: 100, yMin: -4200, yMax: -4000 });
    expect(routeBoundsOn(route, EK)).toEqual({ mapId: EK, xMin: -9000, xMax: -9000, yMin: 800, yMax: 800 });
    expect(routeBoundsOn(route, worldMapId(2991))).toBeNull();
  });

  it('builds the same input incrementally, keyed by step id: a move or an insert keeps every other step’s input', () => {
    const build = createRouteInputBuilder(GEOMETRY);
    const first = build(steps);
    expect(first).toEqual(route);
    expect(build(steps)).toBe(first);
    const inputOf = (built: typeof first, id: string | undefined) => built.steps.find((input) => input.stepId === id);
    // Swap the last two steps: every step keeps its input object, whatever its new position.
    const swapped = [...steps.slice(0, 4), steps[5], steps[4]].filter((step): step is RouteStep => step !== undefined);
    const next = build(swapped);
    for (const step of steps) expect(inputOf(next, step.id)).toBe(inputOf(first, step.id));
    expect(next.steps[4]?.stepId).toBe(steps[5]?.id);
    expect(next).toEqual(mapRouteInput(swapped, GEOMETRY));
    // An insert at the top: the others keep theirs too.
    const inserted = [makeNoteStep(ids, { text: 'top' }), ...swapped];
    const withNote = build(inserted);
    expect(withNote.steps.slice(1).every((input, i) => input === next.steps[i])).toBe(true);
  });

  it('keeps an edited step’s input when it draws the same, and the whole route when nothing changed (PERF-2)', () => {
    const build = createRouteInputBuilder(GEOMETRY);
    const first = build(steps);
    const [note] = steps;
    if (note?.kind !== 'note') throw new Error('note missing');
    // A new note text is a new step object, but the same input: the route input is the same object.
    const edited = [{ ...note, text: 'renamed' }, ...steps.slice(1)];
    expect(build(edited)).toBe(first);
    // A new location is a new input.
    const [, accept] = steps;
    if (accept === undefined) throw new Error('accept missing');
    const moved = [note, { ...accept, location: loc(5, -4005) }, ...steps.slice(2)];
    const next = build(moved);
    expect(next).not.toBe(first);
    expect(next.steps[1]).not.toBe(first.steps[1]);
    expect(next.steps[2]).toBe(first.steps[2]);
  });

  it('gives the route layers only the steps they draw from, the same object while those are unchanged', () => {
    const build = createRouteInputBuilder(GEOMETRY);
    const drawnOf = createDrawnRouteFilter();
    const first = drawnOf(build(steps));
    // The note (no location, no special departure) is left out; the unplaced travel step stays.
    expect(first.steps.map((input) => input.stepId)).toEqual(steps.slice(1).map((step) => step.id));
    // Inserting, editing or deleting a note keeps the drawn route object.
    const withNote = [steps[0], makeNoteStep(ids, { text: 'another' }), ...steps.slice(1)].filter((step): step is RouteStep => step !== undefined);
    expect(drawnOf(build(withNote))).toBe(first);
    expect(drawnOf(build(steps.slice(1)))).toBe(first);
    // A step that draws changes it.
    expect(drawnOf(build(steps.slice(0, 3)))).not.toBe(first);
    // A route with nothing to leave out is passed on as it is.
    const placed = build(steps.slice(1, 3));
    expect(createDrawnRouteFilter()(placed)).toBe(placed);
  });

  it('finds a step by id', () => {
    const second = steps[1];
    expect(second === undefined ? null : routeStepOf(route, second.id)?.stepId).toBe(second?.id);
    expect(second === undefined ? null : routeStepIndex(route, second.id)).toBe(1);
    expect(routeStepOf(route, stepId('missing'))).toBeNull();
    expect(routeStepIndex(route, stepId('missing'))).toBeNull();
  });
});

describe('zones', () => {
  it('bounds a UiMap with one full-rectangle row, never Azeroth (two rows)', () => {
    expect(zoneBounds(GEOMETRY, DUROTAR)).toEqual({ mapId: KALIMDOR, xMin: -1716.6666259766, xMax: 1808.3332519531, yMin: -7249.9995117188, yMax: -1962.4998779297 });
    expect(zoneBounds(GEOMETRY, uiMapId(947))).toBeNull();
    expect(zoneBounds(GEOMETRY, uiMapId(1))).toBeNull();
  });

  it('offers the zones of each surface, sorted by name, continents and worlds left out', () => {
    const groups = zoneGroups(GEOMETRY, surfacesOf(GEOMETRY));
    expect(groups.map((g) => [g.surface, g.label, g.zones.map((z) => z.label)])).toEqual([
      ['world:0', 'Eastern Kingdoms', ['Stormwind City']],
      ['world:1', 'Kalimdor', ['Durotar', 'Mulgore', 'Orgrimmar', 'The Barrens', 'Thunder Bluff']],
      ['world:2991', 'Zephras Isle', ['Zephras Isle']],
    ]);
  });
});

describe('focus', () => {
  const ids = sequentialIdSource();
  const accept = makeAcceptStep(ids, { questId: questId(7) });
  const selection: Selection = { stepIds: new Set([accept.id]), anchor: accept.id, focus: accept.id };

  it('focuses the opened quests while their selection lasts, otherwise the active step’s quests', () => {
    const opened = { questIds: [questId(3), questId(2)], selection };
    expect(focusQuestIds(opened, selection, accept)).toEqual([3, 2]);
    expect(focusQuestIds(opened, EMPTY_SELECTION, accept)).toEqual([7]);
    expect(focusQuestIds(null, selection, null)).toEqual([]);
  });

  it('builds the route layers’ step focus from the selection and the active step', () => {
    expect(stepFocusOf(selection, accept.id)).toEqual({ selected: [accept.id], hovered: null, active: accept.id });
  });

  it('leaves steps the route layers do not draw from out of their focus', () => {
    const note = makeNoteStep(ids, { text: 'n' });
    const focus = { selected: [accept.id, note.id], hovered: note.id, active: note.id };
    expect(focusWithin(focus, new Set([accept.id]))).toEqual({ selected: [accept.id], hovered: null, active: null });
    expect(focusWithin(focus, new Set([accept.id, note.id]))).toEqual(focus);
  });
});
