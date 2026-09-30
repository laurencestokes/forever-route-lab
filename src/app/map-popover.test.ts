import { describe, expect, it } from 'vitest';
import { npcId, questId, sequentialIdSource, stepId, uiMapId, worldMapId } from '../domain/ids';
import type { MapRef, MarkerDescriptor, PlaceItem, PlaceLayerInput } from '../map/adapter';
import { fixedClock } from './clock';
import type { MapPopoverTarget } from './map-controller';
import type { PlacesModel } from './map-places';
import { buildMapPopover, type PopoverAction, type PopoverContext, wowheadQuestUrl } from './map-popover';
import { stubDataset, stubNpc, stubQuest, mapTestWorkspace } from './map-test-helpers';
import type { QuestStateEntry, QuestStateModel } from './quest-state';
import { createEditorStore } from './store';

/**
 * The map popover's content (map-presentation.md §14.2, §8.5, §11; UI.md §9 rule 15; D-041 J; step
 * MP.6): which actions a pin, a stack or a point offers, which one is primary, what is unavailable
 * and why, and that each insert makes the step the design names (run through the editor store).
 */

const KALIMDOR = worldMapId(1);
const DUROTAR = uiMapId(1411);

const dataset = stubDataset({
  quests: [
    stubQuest({ id: questId(1), name: 'Cutting Teeth', level: 3, xp: { questLevel: 3, baseXp: 450, basis: 'era-seed' }, starters: [{ kind: 'npc', id: npcId(10) }] }),
    stubQuest({ id: questId(2), name: 'Sting of the Scorpid', level: 4, starters: [{ kind: 'npc', id: npcId(10) }] }),
    stubQuest({ id: questId(3), name: 'My Quest', level: 5, provenance: { upstreamDiff: 'forever-new', foreverStatus: 'user-declared-new', corrected: false, created: true, source: 'custom' } }),
  ],
  npcs: [
    stubNpc({ id: npcId(10), name: 'Gornek', friendlyTo: 'H' }),
    stubNpc({ id: npcId(20), name: 'Doras', subName: 'Wind Rider Master', npcFlags: 8, friendlyTo: 'H' }),
    stubNpc({ id: npcId(40), name: 'Innkeeper Grosk', npcFlags: 128, friendlyTo: 'H' }),
  ],
  zones: [{ uiMapId: DUROTAR, name: 'Durotar', worldMapId: KALIMDOR }],
});

const entry = (id: number, fields: Partial<QuestStateEntry>): QuestStateEntry => ({
  questId: questId(id),
  name: `Q${String(id)}`,
  cls: 'available',
  outside: null,
  mark: 'available',
  row: 'available',
  level: 3,
  requiredLevel: 1,
  difficulty: 'standard',
  reason: 'Available',
  needs: [],
  dungeonQuest: false,
  turnIn: null,
  codes: [],
  ...fields,
});

const questState = {
  levelLowerBound: false,
  quests: new Map([
    [questId(1), entry(1, { reason: 'Available' })],
    [questId(2), entry(2, { cls: 'in-log', row: 'turn-ins', mark: 'ready', reason: 'Ready to turn in', turnIn: { kind: 'ready', done: 1, total: 1, failed: false, completedBy: null } })],
  ]),
} as unknown as QuestStateModel;

const flightItem = (id: string, ref: MapRef, x: number, known: boolean, name: string, node: number): PlaceItem => {
  const descriptor: MarkerDescriptor = {
    type: 'marker',
    id,
    point: { mapId: KALIMDOR, x, y: -4000 },
    kind: 'flight-master',
    style: 'neutral',
    emphasis: 'normal',
    label: name,
    badges: [],
    ref,
    count: 1,
    refs: [ref],
    labels: [name],
    mark: { state: known ? 'flight-known' : 'flight-not-known', difficulty: null, dungeonQuest: false, progress: null },
    category: 'flight-points',
  };
  return { descriptor, node, name };
};
const dorasRef: MapRef = { kind: 'spawn', subject: { kind: 'npc', id: npcId(20) }, spawnIndex: 0, questIds: [] };
const crossroadsRef: MapRef = { kind: 'taxi-node', node: 25 };
const layer = (items: readonly PlaceItem[]): PlaceLayerInput => ({ items, unplaced: 0 });
const places = {
  flightPoints: layer([flightItem('flight:npc:20', dorasRef, 1700, true, 'Orgrimmar', 23), flightItem('flight:25', crossroadsRef, -400, true, 'The Crossroads', 25), flightItem('flight:9', { kind: 'taxi-node', node: 9 }, 0, false, 'Far Away', 9)]),
  dungeons: layer([]),
} as unknown as PlacesModel;

const ctx: PopoverContext = {
  dataset,
  questState,
  places,
  after: 'after step 12',
  locked: null,
  zoneName: (id) => (id === DUROTAR ? 'Durotar' : null),
  stepNumber: (id) => (id === stepId('a') ? 1 : id === stepId('b') ? 2 : null),
};

function target(layer: MapPopoverTarget['layer'], refs: readonly MapRef[], labels: readonly (string | null)[] = refs.map(() => null), from: MapPopoverTarget['from'] = null): MapPopoverTarget {
  return { key: 1, layer, refs, labels, point: { space: 'world', mapId: KALIMDOR, x: 0, y: -4000, uiMapId: DUROTAR, lexemes: null }, at: null, from };
}

const labels = (list: readonly PopoverAction[]) => list.map((action) => [action.label, action.variant, action.unavailable]);

describe('buildMapPopover', () => {
  it('lists a giver’s quests, each with its state, chips and actions: Accept primary, Show in Details, Open on Wowhead (D-041 J)', () => {
    const giver: MapRef = { kind: 'spawn', subject: { kind: 'npc', id: npcId(10) }, spawnIndex: 0, questIds: [questId(1), questId(2)] };
    const model = buildMapPopover(target('available-quests', [giver]), ctx);
    expect(model.title).toBe('Quests at Gornek');
    const [available, inLog] = model.sections;
    expect(available).toMatchObject({ heading: 'Cutting Teeth', lines: ['Available', 'At Gornek'], quest: { questId: 1, level: 3, difficulty: 'standard', xp: { baseXp: 450, basis: 'era-seed' } } });
    expect(labels(available?.actions ?? [])).toEqual([
      ['Accept after step 12', 'primary', null],
      ['Show in Details', 'default', null],
      ['Open on Wowhead', 'external', null],
    ]);
    expect(available?.actions[2]?.command).toEqual({ kind: 'link', href: wowheadQuestUrl(questId(1)) });
    expect(wowheadQuestUrl(questId(1))).toBe('https://www.wowhead.com/classic/quest=1');
    // A log quest ready to turn in: Turn in is the likely action.
    expect(labels(inLog?.actions ?? []).slice(0, 2)).toEqual([
      ['Complete objectives after step 12', 'default', null],
      ['Turn in after step 12', 'primary', null],
    ]);
    // Any point: go there, or fly there from the nearest known flight point.
    expect(model.footer.map((action) => action.key)).toEqual(['go', 'fly']);
  });

  it('heads a stack of several givers with them all and names each action with its quest (review QA-18)', () => {
    const gornek: MapRef = { kind: 'spawn', subject: { kind: 'npc', id: npcId(10) }, spawnIndex: 0, questIds: [questId(1)] };
    const grosk: MapRef = { kind: 'spawn', subject: { kind: 'npc', id: npcId(40) }, spawnIndex: 0, questIds: [questId(3)] };
    const model = buildMapPopover(target('available-quests', [gornek, grosk]), ctx);
    expect(model.title).toBe('2 quests at Gornek and Innkeeper Grosk');
    const names = model.sections.flatMap((section) => section.actions.map((action) => action.name));
    expect(names).toContain('Accept Cutting Teeth after step 12');
    expect(names).toContain('Show Cutting Teeth in Details');
    expect(names).toContain('Open Cutting Teeth on Wowhead');
    expect(names).toContain('Accept My Quest after step 12');
    // Every name is different, so a screen reader tells the two quests' buttons apart.
    expect(new Set(names).size).toBe(names.length);
    // One giver keeps its title.
    expect(buildMapPopover(target('available-quests', [gornek]), ctx).title).toBe('Quests at Gornek');
  });

  it('gives a custom quest no Wowhead link, and says an unknown quest is not in the dataset', () => {
    const ref: MapRef = { kind: 'spawn', subject: { kind: 'npc', id: npcId(10) }, spawnIndex: 0, questIds: [questId(3), questId(99)] };
    const [custom, unknown] = buildMapPopover(target('turn-ins', [ref]), { ...ctx, questState: null }).sections;
    expect(custom?.actions.map((action) => action.variant)).toEqual(['primary', 'default']);
    expect(custom?.lines[0]).toBe('No route state yet: its state at the step is not known');
    expect(unknown).toMatchObject({ heading: 'Quest 99', lines: ['Not in the dataset: nothing is known about it'], actions: [] });
  });

  it('makes every insert unavailable, with the reason, while editing is locked', () => {
    const giver: MapRef = { kind: 'spawn', subject: { kind: 'npc', id: npcId(10) }, spawnIndex: 0, questIds: [questId(1)] };
    const model = buildMapPopover(target('available-quests', [giver]), { ...ctx, locked: 'Unavailable while the optimiser runs' });
    expect(model.sections[0]?.actions.map((action) => action.unavailable)).toEqual(['Unavailable while the optimiser runs', null, null]);
    expect(model.footer[0]?.unavailable).toBe('Unavailable while the optimiser runs');
  });

  it('offers a flight point “Add flight from here”, and no “Fly from” of its own', () => {
    const model = buildMapPopover(target('flight-masters', [dorasRef]), ctx);
    expect(model.title).toBe('Flight point: Orgrimmar');
    expect(labels(model.sections[0]?.actions ?? [])).toEqual([['Add flight from here after step 12', 'default', null]]);
    expect(model.footer.map((action) => action.key)).toEqual(['go']);
  });

  it('flies from the known flight point nearest the character to the known one nearest the point, naming both', () => {
    const empty = buildMapPopover(target(null, [], [], { mapId: KALIMDOR, x: 1650, y: -4000 }), ctx);
    expect(empty.title).toBe('Here: Durotar');
    expect(empty.footer.map((action) => [action.label, action.unavailable])).toEqual([
      ['Go here after step 12', null],
      ['Fly from Orgrimmar to The Crossroads after step 12', null],
    ]);
    // Without the character's place, or two known flight points, it says why.
    expect(buildMapPopover(target(null, []), ctx).footer[1]?.unavailable).toBe('Where the character is after step 12 is not known');
    expect(buildMapPopover(target(null, [], [], { mapId: KALIMDOR, x: 1650, y: -4000 }), { ...ctx, places: { ...places, flightPoints: layer([]) } }).footer[1]?.unavailable).toBe(
      'Two flight points known to the route after step 12 are needed on this map',
    );
  });

  it('offers a service its action (§11), and a transport stop of unknown service none', () => {
    const inn: MapRef = { kind: 'service', service: 'innkeeper', npc: npcId(40), spawnIndex: 0 };
    const model = buildMapPopover(target('services', [inn], ['Innkeeper: Innkeeper Grosk · Horde · Set hearth here after step 12']), ctx);
    expect(model.title).toBe('Innkeeper: Innkeeper Grosk');
    expect(labels(model.sections[0]?.actions ?? [])).toEqual([['Set hearth here after step 12', 'primary', null]]);
    const stop = buildMapPopover(target('transports', [{ kind: 'transport', path: 1, stop: 0 }]), ctx);
    expect(stop.title).toBe('Transport stop (service unknown)');
    expect(stop.sections[0]?.actions[0]?.unavailable).toBe('This stop’s service is not known: it is never used for a route');
  });

  it('words a transport stop’s service state once: the title, not again in the heading or the line (QA-04)', () => {
    const unknown = buildMapPopover(target('transports', [{ kind: 'transport', path: 241, stop: 1 }], ['Transport stop (service unknown) · client transport path 241, stop 2 of 2 · to Kalimdor']), ctx);
    expect(unknown.title).toBe('Transport stop (service unknown)');
    expect(unknown.sections.map((section) => [section.heading, section.lines])).toEqual([['Client transport path 241', ['client transport path 241, stop 2 of 2 · to Kalimdor']]]);
    // A ride of unknown service (its ring between the continents): said once too.
    const ride = buildMapPopover(target('transports', [{ kind: 'transport', path: 302, stop: null }], ['Transport route (service unknown): Kalimdor to Eastern Kingdoms']), ctx);
    expect(ride.title).toBe('Transport route (service unknown)');
    expect(ride.sections.map((section) => [section.heading, section.lines])).toEqual([['Client transport path 302', ['Kalimdor to Eastern Kingdoms']]]);
    const label = "Transport stop: Rut'theran Village, Rut'theran – Auberdine boat to Auberdine (service inferred from client transport path 293, stop 1 of 2) · wait and ride times assumed (TIME-7)";
    const inferred = buildMapPopover(target('transports', [{ kind: 'transport', path: 293, stop: 0 }], [label]), ctx);
    expect(inferred.title).toBe("Transport stop: Rut'theran Village");
    expect(inferred.sections[0]?.heading).toBe("Rut'theran – Auberdine boat: Rut'theran Village");
    expect(inferred.sections[0]?.lines[0]).toBe(label);
    // "Add transport" adds the transport by id: no dock is copied from the inferred stop (TR-02).
    const workspace = mapTestWorkspace([], '2026-09-25T12:00:00.000Z', dataset, [npcId(20)]);
    const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(500), clock: fixedClock('2026-09-25T12:00:00.000Z') });
    const action = inferred.sections[0]?.actions[0];
    if (action?.command.kind !== 'insert') throw new Error('Add transport is not an insert');
    store.dispatch(action.command.command);
    expect(store.getState().project.route.steps.at(-1)).toMatchObject({ kind: 'travel', mode: 'transport', transport: { id: 'rutheran-auberdine', dock: null } });
  });

  it('lists a stack of steps with “Select step N”, and “Select all”', () => {
    const model = buildMapPopover(
      target('route-steps', [
        { kind: 'step', stepId: stepId('a') },
        { kind: 'step', stepId: stepId('b') },
      ], ['1 · Accept quest: Cutting Teeth', '2 · Accept quest: Sting of the Scorpid']),
      ctx,
    );
    expect(model.title).toBe('2 steps here');
    expect(model.sections.map((section) => [section.heading, section.actions[0]?.label])).toEqual([
      ['1 · Accept quest: Cutting Teeth', 'Select step 1'],
      ['2 · Accept quest: Sting of the Scorpid', 'Select step 2'],
    ]);
    expect(model.footer.map((action) => [action.label, action.command])).toEqual([['Select all 2 steps', { kind: 'select', stepIds: ['a', 'b'] }]]);
  });

  it('inserts the steps the design names, after the selection (§11, §14.2)', () => {
    const workspace = mapTestWorkspace([], '2026-09-25T12:00:00.000Z', dataset, [npcId(20)]);
    const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(500), clock: fixedClock('2026-09-25T12:00:00.000Z') });
    const run = (action: PopoverAction | undefined): void => {
      if (action?.command.kind !== 'insert') throw new Error(`not an insert: ${String(action?.label)}`);
      store.dispatch(action.command.command);
    };
    const serviceModel = (service: 'innkeeper' | 'trainer' | 'vendor') => buildMapPopover(target('services', [{ kind: 'service', service, npc: npcId(40), spawnIndex: 0 }]), ctx);
    run(serviceModel('innkeeper').sections[0]?.actions[0]);
    run(serviceModel('trainer').sections[0]?.actions[0]);
    run(serviceModel('vendor').sections[0]?.actions[0]);
    run(buildMapPopover(target('flight-masters', [dorasRef]), ctx).sections[0]?.actions[0]);
    const here = buildMapPopover(target(null, [], [], { mapId: KALIMDOR, x: 1650, y: -4000 }), ctx);
    run(here.footer[0]);
    run(here.footer[1]);
    const steps = store.getState().project.route.steps;
    expect(steps.map((step) => step.kind)).toEqual(['hearth', 'train', 'vendor', 'flight', 'travel', 'flight']);
    const [hearth, train, vendor, flight, travel, fly] = steps;
    expect(hearth).toMatchObject({ mode: 'bind', location: { source: { space: 'world', mapId: KALIMDOR, x: 0, y: -4000 }, label: 'Innkeeper Grosk' } });
    expect(train).toMatchObject({ skill: 'class', location: { label: 'Innkeeper Grosk' } });
    expect(vendor).toMatchObject({ what: null, location: { label: 'Innkeeper Grosk' } });
    expect(flight).toMatchObject({ mode: 'take', from: { npcId: 20, taxiNodeId: 23, name: 'Orgrimmar' }, to: null });
    expect(travel).toMatchObject({ mode: 'auto', location: { source: { space: 'world', mapId: KALIMDOR, x: 0, y: -4000, uiMapId: DUROTAR } } });
    expect(fly).toMatchObject({ mode: 'take', from: { npcId: 20, taxiNodeId: 23 }, to: { npcId: null, taxiNodeId: 25, name: 'The Crossroads' } });
  });
});
