import { describe, expect, it } from 'vitest';
import { areaId, npcId, questId, stepId, uiMapId, worldMapId, type WorldMapId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';
import type { ReadonlyCharacterState, StepRecord } from '../engine/types';
import type { DatasetDungeon } from '../infra/data/dungeons';
import type { ClientDungeons, ClientLfgRow, ClientTaxi } from '../infra/maps/client-tables';
import type { MarkerDescriptor, PlaceLayerInput, PolylineDescriptor } from '../map/adapter';
import { effectiveRules } from '../rules/precedence';
import { FOREVER_BETA } from '../rules/ruleset';
import { seedTravelGraph, type TaxiNodeKey, type TravelGraphSource } from '../rules/travel-graph';
import { taxiLegDataOf } from '../sim/taxi';
import { ANNOUNCED_INSTANCES, createPlacesBuilder, LFG_MATCHES, type PlacesInput, tuningLevelOf } from './map-places';
import { stubDataset, stubNpc, stubQuest, worldSpawn } from './map-test-helpers';
import type { QuestStateModel } from './quest-state';

/*
 * The places model (map-presentation.md §8 to §10, §25.4; steps MP.5, MP.8, MP.9) over synthetic
 * client tables and a stub dataset: ids, names, positions and lengths are invented for the tests
 * (the real tables are checked in tests/map-places.test.ts).
 */

const KALIMDOR = worldMapId(1);
const EK = worldMapId(0);
const at = (mapId: WorldMapId, x: number, y: number): WorldPoint => ({ mapId, x, y });
const rules = effectiveRules(FOREVER_BETA);

const view = stubDataset({
  npcs: [
    stubNpc({ id: npcId(10), name: 'Hilltop Keeper', subName: 'Wind Rider Master', npcFlags: 8, friendlyTo: 'H' }),
    stubNpc({ id: npcId(20), name: 'Lake Keeper', npcFlags: 8, friendlyTo: 'H' }),
    stubNpc({ id: npcId(30), name: 'Gryphon Keeper', npcFlags: 8, friendlyTo: 'A' }),
  ],
  spawns: {
    'npc:10': [worldSpawn(KALIMDOR, 0, 0, uiMapId(1411))],
    'npc:20': [worldSpawn(KALIMDOR, 3000, 0, uiMapId(1411))],
    'npc:30': [worldSpawn(KALIMDOR, 6000, 0, uiMapId(1411))],
  },
  quests: [
    stubQuest({ id: questId(1), name: 'Into the Cave', level: 18, dungeonQuest: true, zoneOrSort: 718 }),
    stubQuest({ id: questId(2), name: 'Deeper', level: 20, dungeonQuest: true, zoneOrSort: 718 }),
    stubQuest({ id: questId(3), name: 'Mail Run', level: 12, starters: [{ kind: 'npc', id: npcId(10) }] }),
  ],
  zones: [{ uiMapId: uiMapId(1411), name: 'Durotar', worldMapId: KALIMDOR }],
});

const shape = (from: WorldPoint, to: WorldPoint): readonly WorldPoint[] => [from, at(from.mapId, (from.x + to.x) / 2, 10), to];

const TAXI: ClientTaxi = {
  build: 'test-build',
  nodes: [
    { id: 1, name: 'Hilltop, Test Hills', point: at(KALIMDOR, 3, 4), alliance: false, horde: true },
    { id: 2, name: 'Lakeside, Test Lake', point: at(KALIMDOR, 3000, 5), alliance: false, horde: true },
    { id: 3, name: 'Gryphon Roost', point: at(KALIMDOR, 6000, 3), alliance: true, horde: false },
    { id: 4, name: 'Neutral Post', point: at(KALIMDOR, 9000, 0), alliance: false, horde: false },
  ],
  flights: [
    { pathId: 20, from: 1, to: 2, l3dYards: 3200, shape: shape(at(KALIMDOR, 3, 4), at(KALIMDOR, 3000, 5)) },
    { pathId: 21, from: 2, to: 1, l3dYards: 3264, shape: shape(at(KALIMDOR, 3000, 5), at(KALIMDOR, 3, 4)) },
    { pathId: 22, from: 2, to: 4, l3dYards: 6400, shape: shape(at(KALIMDOR, 3000, 5), at(KALIMDOR, 9000, 0)) },
    { pathId: 23, from: 3, to: 4, l3dYards: 3100, shape: shape(at(KALIMDOR, 6000, 3), at(KALIMDOR, 9000, 0)) },
  ],
  transports: [
    // Cited by no seed: drawn, service unknown.
    { pathId: 241, maps: [KALIMDOR, EK], stops: [{ point: at(KALIMDOR, -1006, -3842), delaySeconds: 60 }, { point: at(EK, -14278, 583), delaySeconds: 60 }] },
    // Cited by the Rut'theran – Auberdine seed (both stops on Kalimdor).
    { pathId: 293, maps: [KALIMDOR], stops: [{ point: at(KALIMDOR, 8532, 1024), delaySeconds: 60 }, { point: at(KALIMDOR, 6594, 760), delaySeconds: 60 }] },
  ],
};

const lfg = (id: number, name: string, levels: readonly [number, number, number, number]): ClientLfgRow => ({
  id,
  name,
  contentTuningId: 5000 + id,
  minLevelSquish: levels[0],
  maxLevelSquish: levels[1],
  lfgMinLevel: levels[2],
  lfgMaxLevel: levels[3],
});

const DUNGEONS: ClientDungeons = {
  build: 'test-build',
  lfg: [lfg(1, 'Wailing Caverns', [17, 17, 0, 0]), lfg(45, 'Onyxia', [60, 60, 0, 0]), lfg(3272, 'Ruins of Lordaeron', [15, 15, 27, 27])],
  instanceMaps: [
    { id: worldMapId(43), name: 'Wailing Caverns', instanceType: 1, areaIds: [areaId(718)] },
    { id: worldMapId(249), name: "Onyxia's Lair", instanceType: 2, areaIds: [] },
    { id: worldMapId(533), name: 'Naxxramas', instanceType: 2, areaIds: [areaId(3456)] },
    { id: worldMapId(2999), name: 'Ruins of Lordaeron', instanceType: 1, areaIds: [areaId(16611)] },
    { id: worldMapId(3002), name: 'Half-Pint Tavern', instanceType: 1, areaIds: [areaId(16632)] },
  ],
  undecodedRows: { LFGDungeons: 5, Map: 8 },
};

const DATASET_DUNGEONS: readonly DatasetDungeon[] = [
  { areaId: areaId(718), name: 'Wailing Caverns', alternativeAreaIds: [], entrances: [{ world: at(KALIMDOR, -850, -2040), uiMapId: uiMapId(1413), frameVerified: true }] },
  { areaId: areaId(2159), name: "Onyxia's Lair", alternativeAreaIds: [], entrances: [{ world: at(KALIMDOR, -4720, -3740), uiMapId: uiMapId(1445), frameVerified: false }] },
  { areaId: areaId(3456), name: 'Naxxramas', alternativeAreaIds: [], entrances: [{ world: at(EK, 3134, -3730), uiMapId: uiMapId(1423), frameVerified: true }] },
  // Not a member: the dataset's Utgarde Keep (Northrend) is never drawn.
  { areaId: areaId(206), name: 'Utgarde Keep', alternativeAreaIds: [], entrances: [{ world: at(EK, 0, 0), uiMapId: null, frameVerified: true }] },
];

const source: TravelGraphSource = {
  npc: (id) => view.npc(id),
  spawns: (ref) => view.spawns(ref),
  zone: (id) => view.zone(id),
  flightMasterIds: [npcId(10), npcId(20), npcId(30)],
  dungeons: [],
};
// No cited node seeds: the file's rows are the only TaxiNodes rows here.
const graph = seedTravelGraph(source, rules, { taxi: TAXI, taxiNodes: [] });
const legs = taxiLegDataOf(TAXI);

const after = (known: readonly TaxiNodeKey[]): ReadonlyCharacterState => ({ knownFlightPaths: new Set(known) }) as unknown as ReadonlyCharacterState;

function input(fields: Partial<PlacesInput> = {}): PlacesInput {
  return {
    taxi: { kind: 'loaded', table: TAXI },
    dungeons: { kind: 'loaded', table: DUNGEONS },
    graph,
    legs,
    view,
    datasetDungeons: DATASET_DUNGEONS,
    character: { faction: 'Horde', race: 'Orc', class: 'WARRIOR', priorHistory: 'fresh' },
    rules,
    mapName: (mapId) => (mapId === EK ? 'Eastern Kingdoms' : 'Kalimdor'),
    selected: { stepId: stepId('s1'), after: after(['npc:10']) },
    records: [],
    startKnown: new Set(['npc:10']),
    questState: null,
    ...fields,
  };
}

const markers = (layer: PlaceLayerInput): readonly MarkerDescriptor[] => layer.items.flatMap((item) => (item.descriptor.type === 'marker' ? [item.descriptor] : []));
const lines = (layer: PlaceLayerInput): readonly PolylineDescriptor[] => layer.items.flatMap((item) => (item.descriptor.type === 'polyline' ? [item.descriptor] : []));

describe('LFG tuning levels (D-039 E; §8.4)', () => {
  it('is one number labelled "meaning unverified", or "?" with the numbers where the row disagrees with itself', () => {
    expect(tuningLevelOf(lfg(1, 'Wailing Caverns', [17, 17, 0, 0]), 'b')).toEqual({
      level: 17,
      text: 'LFG tuning level 17 (client LFGDungeons row 1 → ContentTuning 5001, build b; meaning unverified)',
    });
    // Ruins of Lordaeron: the row gives both 15 and 27.
    expect(tuningLevelOf(lfg(3272, 'Ruins of Lordaeron', [15, 15, 27, 27]), 'b')).toEqual({
      level: null,
      text: "LFG tuning level ? (the client's row gives both 15 and 27: client LFGDungeons row 3272 → ContentTuning 8272, build b)",
    });
    expect(tuningLevelOf(lfg(67, 'Excavation', [0, 0, 0, 0]), 'b').text).toMatch(/^LFG tuning level: none set/);
  });

  it('matches every committed finder row by hand, and names the eleven announced instances', () => {
    expect(LFG_MATCHES).toHaveLength(30);
    expect(new Set(LFG_MATCHES.map((match) => match.lfg)).size).toBe(30);
    expect(ANNOUNCED_INSTANCES).toHaveLength(11);
  });
});

describe('dungeon entrances (MP.5)', () => {
  const model = createPlacesBuilder()(input());
  const pins = markers(model.dungeons);

  it('draws the finder’s instances at the dataset’s entrances, raids by the client’s instance type, unconfirmed raids apart', () => {
    expect(pins.map((pin) => [pin.id.split(':').slice(0, 2).join(':'), pin.category, pin.mark?.state])).toEqual([
      ['dungeon:0', 'unconfirmed-raids', 'raid'],
      ['dungeon:1', 'raids', 'raid'],
      ['dungeon:1', 'dungeons', 'dungeon'],
    ]);
    expect(pins.some((pin) => pin.label?.includes('Utgarde') === true)).toBe(false);
    expect(model.counts).toMatchObject({ dungeons: 1, raids: 1, 'unconfirmed-raids': 1 });
  });

  it('marks an entrance the dataset’s audit did not verify, and words each number with its basis', () => {
    const onyxia = pins.find((pin) => pin.category === 'raids');
    expect(onyxia?.mark?.positionUnverified).toBe(true);
    expect(onyxia?.label).toContain('LFG tuning level 60 (client LFGDungeons row 45');
    expect(onyxia?.label).toContain("position not verified by the dataset's audit");
    const caverns = pins.find((pin) => pin.category === 'dungeons');
    expect(caverns?.label).toMatch(/^Wailing Caverns \(dungeon entrance\) · LFG tuning level 17 .*meaning unverified\) · 2 dungeon quests open to an Orc Warrior: too few for a span$/);
  });

  it('counts the quests inside after the step, the uncertain apart (§8.5)', () => {
    const questState = {
      level: 18,
      levelLowerBound: false,
      quests: new Map([
        [questId(1), { cls: 'in-log' }],
        [questId(2), { cls: 'uncertain-level' }],
      ]),
    } as unknown as QuestStateModel;
    const stated = markers(createPlacesBuilder()(input({ questState })).dungeons).find((pin) => pin.category === 'dungeons');
    expect(stated?.label).toMatch(/quests inside after step \{step\}: 1 in the log · 1 may be available$/);
  });

  it('names the announced instances with no entrance, the unconfirmed raids and the maps of unknown purpose', () => {
    expect(model.notes.dungeons).toEqual(
      expect.arrayContaining([
        'Raids with no dungeon-finder row, hidden by default (D-039 F): Naxxramas.',
        expect.stringMatching(/^11 announced Forever instances have no known entrance .*Ruins of Lordaeron \(LFG tuning \?\)/),
        '1 instance map of unknown purpose not shown: Half-Pint Tavern.',
        "The client's lists may be incomplete: 5 LFGDungeons rows and 8 Map rows are encrypted.",
      ]),
    );
  });
});

describe('flight points and the flight network (MP.8)', () => {
  it('shows each node’s state after the step, its side by edge, and the other faction apart', () => {
    const model = createPlacesBuilder()(input());
    const pins = markers(model.flightPoints);
    expect(pins.map((pin) => [pin.id, pin.category, pin.mark?.state, pin.mark?.sides ?? 'own', pin.mark?.faction ?? null])).toEqual([
      ['flight:npc:10', 'flight-points', 'flight-known', 'own', null],
      ['flight:npc:20', 'flight-points', 'flight-not-known', 'own', null],
      ['flight:npc:30', 'other-faction-flights', 'flight-other-faction', 'own', 'A'],
      ['flight:taxi:4', 'flight-points', 'flight-not-known', 'none', null],
    ]);
    expect(pins[0]?.label).toBe('Flight point: Hilltop, Test Hills (Hilltop Keeper <Wind Rider Master>) · Horde (client TaxiNodes flags, inferred) · known to the route after step {step}; starts Mail Run');
    expect(pins[0]?.ref).toEqual({ kind: 'spawn', subject: { kind: 'npc', id: 10 }, spawnIndex: 0, questIds: [3] });
    expect(pins[3]?.ref).toEqual({ kind: 'taxi-node', node: 4 });
    expect(model.flightPoints.items.map((item) => item.node)).toEqual([1, 2, 3, 4]);
    expect(model.counts).toMatchObject({ 'flight-points': 3, 'other-faction-flights': 1, 'flight-network': 2 });
    expect(model.flightsKnown).toBe(1);
  });

  it('says a node may be known when the history is unknown, and has no state without route state', () => {
    const unknown = markers(createPlacesBuilder()(input({ character: { faction: 'Horde', race: 'Orc', class: 'WARRIOR', priorHistory: 'unknown' } })).flightPoints);
    expect(unknown[1]?.mark?.state).toBe('flight-may-be-known');
    const stateless = createPlacesBuilder()(input({ selected: null }));
    expect(markers(stateless.flightPoints)[0]?.mark).toBeUndefined();
    expect(stateless.flightsKnown).toBeNull();
  });

  it('draws one line per pair the side may fly, with both directions’ times from the client lengths and the rules', () => {
    const model = createPlacesBuilder()(input());
    const flights = lines(model.flights);
    // The Alliance node's flight is left out; the one to the node with no side is kept.
    expect(flights.map((line) => line.id)).toEqual(['flight:1-2', 'flight:2-4']);
    expect(flights[0]?.label).toBe(
      'Flight: Hilltop, Test Hills to Lakeside, Test Lake ≈ 1:40 (client path 3,200 yd, TaxiPath 20); Lakeside, Test Lake to Hilltop, Test Hills ≈ 1:42 (client path 3,264 yd, TaxiPath 21) · at 32 yd/s (era-assumed taxi speed), plus 3 s at the flight master (assumption)',
    );
    expect(model.flights.items[0]?.nodes).toEqual([1, 2]);
  });

  it("flags the route's own flights: each journey as TIME-6 routes it, with the points known when it is flown", () => {
    const flightStep = {
      step: { kind: 'flight', mode: 'take', from: null, to: null },
      legs: [{ purpose: 'flight-master', to: { point: at(KALIMDOR, 0, 0) } }],
      delta: { locationAfter: at(KALIMDOR, 3000, 0), flightPathsLearned: [] },
    } as unknown as StepRecord;
    const model = createPlacesBuilder()(input({ records: [flightStep] }));
    expect(model.flights.items.map((item) => [item.descriptor.id, item.route === true])).toEqual([
      ['flight:1-2', true],
      ['flight:2-4', false],
    ]);
  });

  it('draws no flights and says why when the taxi file failed; flights are then timed by TIME-5', () => {
    const model = createPlacesBuilder()(input({ taxi: { kind: 'failed', reason: 'HTTP 404' }, legs: null }));
    expect(model.flights.items).toEqual([]);
    expect(model.unavailable['flight-network']).toMatch(/^The client taxi file could not be used \(HTTP 404\): no flight lines are drawn, and flights are timed as a straight line/);
    expect(model.transports.items).toEqual([]);
  });
});

describe('transport stops (MP.9)', () => {
  const model = createPlacesBuilder()(input());

  it('says a matched stop’s service is inferred, with its record, and draws the others as service unknown', () => {
    const stops = markers(model.transports);
    expect(stops.map((stop) => [stop.id, stop.mark?.state])).toEqual([
      ['stop:0:-14278:583', 'transport-unknown'],
      ['stop:1:-1006:-3842', 'transport-unknown'],
      ['stop:1:6594:760', 'transport-inferred'],
      ['stop:1:8532:1024', 'transport-inferred'],
    ]);
    expect(stops[3]?.label).toBe("Transport stop: Rut'theran Village, Rut'theran – Auberdine boat to Auberdine (service inferred from client transport path 293, stop 1 of 2) · wait and ride times assumed (TIME-7)");
    expect(stops[0]?.label).toBe('Transport stop (service unknown) · client transport path 241, stop 2 of 2 · to Kalimdor');
    expect(model.counts['transport-stops']).toBe(4);
  });

  it('draws a same-map ride as a straight line, and a ride between the continents as a connector', () => {
    const rides = model.transports.items.filter((item) => item.descriptor.type !== 'marker').map((item) => [item.descriptor.type, item.descriptor.id]);
    expect(rides).toEqual([
      ['connector', 'ride:241:1'],
      ['polyline', 'ride:293:1'],
    ]);
  });

  it('draws every ride in the travel network’s style, never as the route’s own transport leg, and hides it with the stops (review PR-11)', () => {
    const rides = model.transports.items.map((item) => item.descriptor).filter((d) => d.type === 'connector' || d.type === 'polyline');
    expect(rides.map((d) => [d.id, d.type === 'connector' || d.type === 'polyline' ? d.style : null, d.type === 'connector' || d.type === 'polyline' ? d.category : null])).toEqual([
      ['ride:241:1', 'network-transport', 'transport-stops'],
      ['ride:293:1', 'network-transport', 'transport-stops'],
    ]);
  });
});

describe('services (§11; step MP.11)', () => {
  const services = stubDataset({
    npcs: [
      stubNpc({ id: npcId(100), name: 'Innkeeper Grosk', subName: 'Innkeeper', npcFlags: 128 + 4 + 2, friendlyTo: 'H' }),
      stubNpc({ id: npcId(101), name: 'Frang', subName: 'Warrior Trainer', npcFlags: 16 + 2, friendlyTo: 'H' }),
      stubNpc({ id: npcId(102), name: 'Shikrik', subName: 'Shaman Trainer', npcFlags: 16, friendlyTo: 'H' }),
      stubNpc({ id: npcId(103), name: 'Ghrawt', subName: 'Bowyer', npcFlags: 4, friendlyTo: 'H' }),
      stubNpc({ id: npcId(104), name: 'Innkeeper Allison', npcFlags: 128, friendlyTo: 'A' }),
      stubNpc({ id: npcId(105), name: 'Jubie Gadgetspring', subName: 'Engineering Supplies', npcFlags: 4, friendlyTo: 'AH' }),
      stubNpc({ id: npcId(106), name: 'Mystery Vendor', npcFlags: 4, friendlyTo: null }),
      stubNpc({ id: npcId(107), name: 'Deep Vendor', npcFlags: 4, friendlyTo: 'H' }),
      stubNpc({ id: npcId(108), name: 'Lost Vendor', npcFlags: 4, friendlyTo: 'H' }),
      // Another class's trainer who also sells (review PR-21): not a vendor for a Warrior.
      stubNpc({ id: npcId(109), name: 'Martha Strain', subName: 'Demon Trainer', npcFlags: 5, friendlyTo: 'H' }),
    ],
    spawns: {
      'npc:100': [worldSpawn(KALIMDOR, 100, 100, uiMapId(1411))],
      'npc:101': [worldSpawn(KALIMDOR, 200, 100, uiMapId(1411)), worldSpawn(KALIMDOR, 900, 100, uiMapId(1411))],
      'npc:102': [worldSpawn(KALIMDOR, 300, 100, uiMapId(1411))],
      'npc:103': [worldSpawn(KALIMDOR, 400, 100, uiMapId(1411))],
      'npc:104': [worldSpawn(KALIMDOR, 500, 100, uiMapId(1411))],
      'npc:105': [worldSpawn(KALIMDOR, 600, 100, uiMapId(1411))],
      'npc:106': [worldSpawn(KALIMDOR, 700, 100, uiMapId(1411))],
      'npc:107': [{ source: { kind: 'instance', areaId: 718 as never }, world: { mapId: KALIMDOR, x: 800, y: 100 }, uiMapId: uiMapId(1411) }],
      'npc:108': [],
      'npc:109': [worldSpawn(KALIMDOR, 1000, 100, uiMapId(1411))],
    },
  });
  const model = createPlacesBuilder()(input({ view: services, serviceNpcIds: [100, 101, 102, 103, 104, 105, 106, 107, 108, 109].map((id) => npcId(id)) }));
  const pins = markers(model.services);

  it('draws the side’s and both factions’ innkeepers, class trainers and vendors as light service pins, one per placed spawn', () => {
    expect(pins.map((pin) => [pin.id, pin.category, pin.mark?.state])).toEqual([
      ['service:npc:100:0', 'innkeepers', 'innkeeper'],
      ['service:npc:101:0', 'trainers', 'trainer'],
      ['service:npc:101:1', 'trainers', 'trainer'],
      ['service:npc:103:0', 'vendors', 'vendor'],
      ['service:npc:105:0', 'vendors', 'vendor'],
    ]);
    // An innkeeper who also sells is an innkeeper; another class's trainer is not drawn.
    expect(pins[0]?.ref).toEqual({ kind: 'service', service: 'innkeeper', npc: 100, spawnIndex: 0 });
    expect(model.services.items[0]?.name).toBe('Innkeeper Grosk');
    expect(model.counts).toMatchObject({ innkeepers: 1, trainers: 1, vendors: 2 });
  });

  it('says what each offers, with the step to be numbered at paint time, and that the vendors are only the dataset’s', () => {
    expect(pins[0]?.label).toBe('Innkeeper: Innkeeper Grosk · Horde · Set hearth here after step {step}');
    expect(pins[1]?.label).toBe('Warrior trainer: Frang · Horde · Train here after step {step}');
    expect(pins[4]?.label).toBe('Vendor: Jubie Gadgetspring <Engineering Supplies> (dataset only) · both factions · Buy here after step {step}');
    expect(model.notes.services).toEqual([
      "Innkeepers and Warrior trainers of the Horde and of both factions, from the dataset (QuestieDB's NPC flags, Era): drawn from zoom −2.75.",
      'Vendors: only the 2 vendors the dataset carries for the Horde (those tied to quests); many vendors are missing. Drawn at the close band.',
      'Profession trainers are not shown yet.',
      '1 service NPC has no faction in the dataset: not drawn.',
      '2 service NPCs have no placed spawn in the dataset: not drawn.',
      '1 spawn is inside an instance: not drawn at its entrance.',
    ]);
    expect(model.services.unplaced).toBe(2);
  });

  it('follows the character’s side and class', () => {
    const alliance = createPlacesBuilder()(input({ view: services, serviceNpcIds: [100, 101, 102, 104, 105].map((id) => npcId(id)), character: { faction: 'Alliance', race: 'Human', class: 'SHAMAN', priorHistory: 'fresh' } }));
    expect(markers(alliance.services).map((pin) => pin.id)).toEqual(['service:npc:104:0', 'service:npc:105:0']);
    const shaman = createPlacesBuilder()(input({ view: services, serviceNpcIds: [101, 102].map((id) => npcId(id)), character: { faction: 'Horde', race: 'Troll', class: 'SHAMAN', priorHistory: 'fresh' } }));
    expect(markers(shaman.services).map((pin) => pin.id)).toEqual(['service:npc:102:0']);
  });
});
