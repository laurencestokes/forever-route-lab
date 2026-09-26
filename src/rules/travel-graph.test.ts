import { describe, expect, it } from 'vitest';
import type { EntityRef, NpcRecord, SpawnPoint, ZoneInfo } from '../domain/dataset';
import { areaId, type NpcId, npcId, uiMapId, type UiMapId, worldMapId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';
import { effectiveRules } from './precedence';
import { FOREVER_BETA } from './ruleset';
import {
  type DungeonEntrances,
  entrancesOf,
  findTaxiNodes,
  instanceKindOf,
  isFlightMaster,
  isInstanceMap,
  nearestEntrance,
  nearestTaxiNode,
  resolveTaxiNodeQuery,
  resolveTaxiNodeRef,
  sameMapTransports,
  seedTravelGraph,
  type TravelGraphSource,
  transportEdges,
  transportsBetweenMaps,
  withDeparture,
} from './travel-graph';
import { FOREVER_TAXI_NODE_SEEDS, TRANSPORT_SEEDS, type TransportSeed, UNMAPPED_ERA_TRANSPORT_PATHS } from './travel-seeds';

const EK = worldMapId(0);
const KALIMDOR = worldMapId(1);
const DEADMINES = worldMapId(36);

const at = (mapId: typeof EK, x: number, y: number): WorldPoint => ({ mapId, x, y });

function npc(id: number, name: string, npcFlags: number, friendlyTo: NpcRecord['friendlyTo'] = 'AH', levels: [number | null, number | null] = [55, 55]): NpcRecord {
  return {
    id: npcId(id),
    name,
    subName: null,
    minLevel: levels[0],
    maxLevel: levels[1],
    rank: 0,
    zoneId: null,
    npcFlags,
    friendlyTo,
    questStarts: [],
    questEnds: [],
    provenance: { upstreamDiff: 'era', foreverStatus: 'unknown', corrected: false, created: false, source: 'questiedb' },
  };
}

const spawnAt = (world: WorldPoint | null, uiMap: number | null): SpawnPoint => ({
  source: { kind: 'unmapped', areaId: areaId(1), x: 0, y: 0, reason: 'no-uimap' },
  world,
  uiMapId: uiMap === null ? null : uiMapId(uiMap),
});

interface Fixture {
  readonly npcs: readonly NpcRecord[];
  readonly spawns: Readonly<Record<number, readonly SpawnPoint[]>>;
  readonly flightMasterIds: readonly number[];
  readonly dungeons?: readonly DungeonEntrances[];
}

function source(fixture: Fixture): TravelGraphSource {
  const zones: Record<number, ZoneInfo> = {
    1411: { uiMapId: uiMapId(1411), name: 'Durotar', worldMapId: KALIMDOR },
    1413: { uiMapId: uiMapId(1413), name: 'The Barrens', worldMapId: KALIMDOR },
  };
  return {
    npc: (id: NpcId) => fixture.npcs.find((record) => record.id === id),
    spawns: (ref: EntityRef) => (ref.kind === 'npc' ? (fixture.spawns[ref.id] ?? []) : []),
    zone: (id: UiMapId) => zones[id],
    flightMasterIds: fixture.flightMasterIds.map(npcId),
    dungeons: fixture.dungeons ?? [],
  };
}

const rules = effectiveRules(FOREVER_BETA);

// Synthetic flight masters (ids and positions invented for the test, not dataset values).
const FIXTURE: Fixture = {
  npcs: [
    npc(10, 'Vale Keeper', 8 + 2, 'H'), // FLIGHT_MASTER plus QUEST_GIVER
    npc(20, 'Ridge Keeper', 8, 'A'),
    npc(30, 'Innkeeper Test', 128, 'AH'), // not a flight master
    npc(40, 'Lost Keeper', 8, null), // no resolvable spawn
  ],
  spawns: {
    10: [spawnAt(null, null), spawnAt(at(KALIMDOR, 100, 100), 1411), spawnAt(at(KALIMDOR, 900, 900), 1411)],
    20: [spawnAt(at(KALIMDOR, 400, 100), 1413)],
    30: [spawnAt(at(KALIMDOR, 0, 0), 1411)],
    40: [spawnAt(null, null)],
  },
  flightMasterIds: [40, 30, 20, 10, 10],
};

describe('isFlightMaster (npcFlags bit 3, tested arithmetically)', () => {
  it.each([
    [8, true],
    [10, true],
    [8 + 2 ** 32, true],
    [2 ** 33, false],
    [7, false],
    [16, false],
    [-8, false],
    [8.5, false],
  ])('npcFlags %d → %s', (flags, expected) => {
    expect(isFlightMaster({ npcFlags: flags })).toBe(expected);
  });
});

describe('seedTravelGraph: taxi nodes', () => {
  const graph = seedTravelGraph(source(FIXTURE), rules);

  it('keeps candidate NPCs whose record has FLIGHT_MASTER, at their first resolved spawn, by id', () => {
    const dataset = graph.taxiNodes.filter((node) => node.origin === 'dataset');
    expect(dataset.map((node) => node.key)).toEqual(['npc:10', 'npc:20', 'npc:40']);
    expect(dataset[0]).toMatchObject({ npcId: 10, taxiNodeId: null, names: ['Vale Keeper', 'Durotar'], point: at(KALIMDOR, 100, 100), factions: ['Horde'] });
    expect(dataset[1]).toMatchObject({ names: ['Ridge Keeper', 'The Barrens'], factions: ['Alliance'] });
    expect(dataset[2]).toMatchObject({ point: null, factions: null });
    expect(graph.report.taxiNodes).toEqual({ dataset: 3, cited: FOREVER_TAXI_NODE_SEEDS.length, withoutPosition: 1 });
  });

  it('adds the cited new Forever nodes by TaxiNodes id (forever-game-rules.md §6.4)', () => {
    const cited = graph.taxiNodes.filter((node) => node.origin === 'cited');
    expect(cited.map((node) => node.taxiNodeId)).toEqual([559, 3203, 3242, 3275, 3276]);
    expect(cited.find((node) => node.taxiNodeId === 3203)).toMatchObject({
      key: 'taxi:3203',
      names: ["Rog'mar, Riverglades"],
      point: at(EK, -7924, -4783),
      factions: ['Horde'],
    });
  });

  it('resolves a TaxiNodeRef by npcId, then taxiNodeId, then name', () => {
    expect(resolveTaxiNodeRef(graph, { npcId: npcId(20), taxiNodeId: null, name: null })).toMatchObject({ kind: 'node', node: { key: 'npc:20' } });
    expect(resolveTaxiNodeRef(graph, { npcId: null, taxiNodeId: 3276, name: null })).toMatchObject({ kind: 'node', node: { key: 'taxi:3276' } });
    expect(resolveTaxiNodeRef(graph, { npcId: npcId(99), taxiNodeId: 559, name: null })).toMatchObject({ kind: 'node', node: { key: 'taxi:559' } });
    expect(resolveTaxiNodeRef(graph, { npcId: null, taxiNodeId: null, name: 'Farholde' })).toMatchObject({ kind: 'node', node: { key: 'taxi:3276' } });
    expect(resolveTaxiNodeRef(graph, { npcId: npcId(30), taxiNodeId: null, name: null })).toEqual({ kind: 'none' });
    // A ref with an id that matches nothing does not fall back to its name.
    expect(resolveTaxiNodeRef(graph, { npcId: npcId(99), taxiNodeId: null, name: 'Vale' })).toEqual({ kind: 'none' });
  });

  it('matches name queries case-insensitively by substring, exact names first, per faction', () => {
    expect(findTaxiNodes(graph, 'mount hyjal').map((node) => node.key)).toEqual(['taxi:559', 'taxi:3242']);
    expect(resolveTaxiNodeQuery(graph, 'KEEPER')).toMatchObject({ kind: 'several' });
    expect(resolveTaxiNodeQuery(graph, 'keeper', 'Alliance')).toMatchObject({ kind: 'several' }); // 20 and 40 (faction unknown)
    expect(findTaxiNodes(graph, 'durotar', 'Horde').map((node) => node.key)).toEqual(['npc:10']);
    expect(findTaxiNodes(graph, 'durotar', 'Alliance')).toEqual([]);
    expect(findTaxiNodes(graph, 'Powderfuse Port, Riverglades').map((node) => node.key)).toEqual(['taxi:3275']);
    expect(resolveTaxiNodeQuery(graph, '   ')).toEqual({ kind: 'none' });
  });

  it('finds the nearest node on the same world map, ties by graph order', () => {
    expect(nearestTaxiNode(graph, at(KALIMDOR, 250, 100))?.key).toBe('npc:10');
    expect(nearestTaxiNode(graph, at(KALIMDOR, 300, 100))?.key).toBe('npc:20');
    expect(nearestTaxiNode(graph, at(KALIMDOR, 300, 100), (node) => node.key !== 'npc:20')?.key).toBe('npc:10');
    expect(nearestTaxiNode(graph, at(EK, -9000, -4800))?.key).toBe('taxi:3276');
    expect(nearestTaxiNode(graph, at(worldMapId(2991), 0, 0))).toBeNull();
  });

  it('keeps only known taxi edges between graph nodes', () => {
    const withEdges = seedTravelGraph(source(FIXTURE), rules, {
      taxiEdges: [
        { from: 'npc:10', to: 'npc:20' },
        { from: 'npc:10', to: 'npc:99' },
        { from: 'npc:10', to: 'npc:10' },
      ],
    });
    expect(withEdges.taxiEdges).toEqual([{ from: 'npc:10', to: 'npc:20' }]);
    expect(graph.taxiEdges).toEqual([]);
  });
});

describe('seedTravelGraph: transports (TIME-7)', () => {
  it('seeds every cited transport with every ordered stop pair; no dock position without a dock NPC or user dock', () => {
    const graph = seedTravelGraph(source(FIXTURE), rules);
    const expectedEdges = TRANSPORT_SEEDS.reduce((sum, seed) => sum + seed.stops.length * (seed.stops.length - 1), 0);
    expect(graph.transports).toHaveLength(expectedEdges);
    expect(graph.report.transports).toMatchObject({ records: 7, edges: expectedEdges, positionedEdges: 0, docksFromNpc: 0, docksFromUser: 0 });
    expect(transportEdges(graph, 'menethil-southshore-auberdine').map((edge) => edge.id)).toEqual([
      'menethil-southshore-auberdine:0>1',
      'menethil-southshore-auberdine:0>2',
      'menethil-southshore-auberdine:1>0',
      'menethil-southshore-auberdine:1>2',
      'menethil-southshore-auberdine:2>0',
      'menethil-southshore-auberdine:2>1',
    ]);
    const edge = transportEdges(graph, 'stormwind-auberdine:1>0')[0];
    expect(edge).toMatchObject({ transportId: 'stormwind-auberdine', basis: 'official', factions: null });
    expect(edge?.waitS).toEqual({ ...FOREVER_BETA.values.transportWaitSeconds, from: 'ruleset' });
    expect(edge?.from).toEqual({ stop: 1, name: 'Stormwind Harbor', mapId: EK, point: null, pointFrom: null, npcId: null });
    expect(UNMAPPED_ERA_TRANSPORT_PATHS).toHaveLength(7);
  });

  it('takes docks from dock NPCs on the stop map and from user docks, and reports ignored user docks', () => {
    const seeds: readonly TransportSeed[] = [
      {
        id: 'test-boat',
        name: 'Test boat',
        stops: [
          { name: 'North dock', mapId: KALIMDOR, dockNpcIds: [npcId(50), npcId(51)] },
          { name: 'South dock', mapId: KALIMDOR, dockNpcIds: [] },
        ],
        factions: ['Horde'],
        basis: 'client-data',
        source: 'test',
      },
    ];
    const fixture: Fixture = {
      ...FIXTURE,
      npcs: [...FIXTURE.npcs, npc(50, 'Wrong-map Dockmaster', 0), npc(51, 'Dockmaster', 0)],
      spawns: { ...FIXTURE.spawns, 50: [spawnAt(at(EK, 1, 1), null)], 51: [spawnAt(at(KALIMDOR, 5000, 0), null)] },
    };
    const graph = seedTravelGraph(source(fixture), rules, {
      transports: seeds,
      userDocks: [
        { transportId: 'test-boat', stop: 1, point: at(KALIMDOR, 3000, 0) },
        { transportId: 'test-boat', stop: 0, point: at(EK, 0, 0) }, // wrong map: ignored
        { transportId: 'nope', stop: 0, point: at(KALIMDOR, 0, 0) }, // no such record
      ],
    });
    expect(graph.transports.map((edge) => [edge.id, edge.from.pointFrom, edge.from.npcId, edge.to.pointFrom])).toEqual([
      ['test-boat:0>1', 'dock-npc', 51, 'user'],
      ['test-boat:1>0', 'user', null, 'dock-npc'],
    ]);
    expect(graph.report.transports).toMatchObject({ records: 1, edges: 2, positionedEdges: 2, docksFromNpc: 1, docksFromUser: 1, userDocksIgnored: 2 });
    expect(sameMapTransports(graph, KALIMDOR).map((edge) => edge.id)).toEqual(['test-boat:0>1', 'test-boat:1>0']);
    expect(sameMapTransports(graph, EK)).toEqual([]);
  });

  it("answers same-map transports only with both docks positioned (Rut'theran ↔ Auberdine)", () => {
    const unpositioned = seedTravelGraph(source(FIXTURE), rules);
    expect(sameMapTransports(unpositioned, KALIMDOR)).toEqual([]);
    const graph = seedTravelGraph(source(FIXTURE), rules, {
      userDocks: [
        { transportId: 'rutheran-auberdine', stop: 0, point: at(KALIMDOR, 8000, 1000) },
        { transportId: 'rutheran-auberdine', stop: 1, point: at(KALIMDOR, 6500, 900) },
      ],
    });
    expect(sameMapTransports(graph, KALIMDOR).map((edge) => edge.id)).toEqual(['rutheran-auberdine:0>1', 'rutheran-auberdine:1>0']);
    // Menethil ↔ Southshore share map 0 but have no positions.
    expect(sameMapTransports(graph, EK)).toEqual([]);
    expect(transportsBetweenMaps(graph, EK, KALIMDOR).map((edge) => edge.id)).toEqual([
      'stormwind-auberdine:1>0',
      'menethil-southshore-auberdine:0>2',
      'menethil-southshore-auberdine:1>2',
      'steamwheedle-powderfuse:1>0',
      'menethil-auberdine:0>1',
    ]);
  });

  it('boards at a user-entered dock on the departure map only', () => {
    const graph = seedTravelGraph(source(FIXTURE), rules);
    const edge = transportEdges(graph, 'menethil-auberdine:0>1')[0];
    if (edge === undefined) throw new Error('fixture');
    expect(withDeparture(edge, at(EK, -3700, -600))?.from).toMatchObject({ point: at(EK, -3700, -600), pointFrom: 'user' });
    expect(withDeparture(edge, at(KALIMDOR, 0, 0))).toBeNull();
  });
});

describe('seedTravelGraph: instance entrance edges (TIME-7, COORD-4)', () => {
  const dungeons: readonly DungeonEntrances[] = [
    {
      dungeonAreaId: areaId(1581),
      name: 'The Deadmines',
      instanceMapId: DEADMINES,
      entrances: [
        { point: at(EK, -11000, 1500), frameVerified: true },
        { point: at(EK, -11200, 1600), frameVerified: false }, // unverified frame: no edge
        { point: null, frameVerified: true }, // unresolved: no edge
        { point: at(DEADMINES, 0, 0), frameVerified: true }, // already inside: no edge
      ],
    },
    { dungeonAreaId: areaId(717), name: 'The Stockade', instanceMapId: null, entrances: [{ point: at(EK, -8800, 800), frameVerified: true }] },
  ];
  const graph = seedTravelGraph(source({ ...FIXTURE, dungeons }), rules);

  it('seeds one zero-wait edge per verified, resolved entrance of a dungeon with an instance map', () => {
    expect(graph.entrances).toEqual([
      { dungeonAreaId: 1581, name: 'The Deadmines', instanceMapId: DEADMINES, outdoor: at(EK, -11000, 1500), index: 0, raid: false },
    ]);
    expect(graph.report.entrances).toEqual({ edges: 1, frameUnverified: 1, noInstanceMap: 1, unresolved: 2 });
    expect(isInstanceMap(graph, DEADMINES)).toBe(true);
    expect(isInstanceMap(graph, EK)).toBe(false);
    expect(entrancesOf(graph, DEADMINES)).toHaveLength(1);
  });

  it('finds the entrance nearest a point on the outdoor map', () => {
    expect(nearestEntrance(graph, DEADMINES, at(EK, -10650, 1500))?.index).toBe(0);
    expect(nearestEntrance(graph, DEADMINES, at(KALIMDOR, 0, 0))).toBeNull();
  });

  it('tells a raid from a five-player dungeon (KXP-5); an instance whose type is not given counts as a dungeon', () => {
    expect(instanceKindOf(graph, DEADMINES)).toBe('dungeon');
    expect(instanceKindOf(graph, EK)).toBeNull();
    const raidMap = worldMapId(409);
    const raid = seedTravelGraph(
      source({ ...FIXTURE, dungeons: [{ dungeonAreaId: areaId(2717), name: 'Molten Core', instanceMapId: raidMap, raid: true, entrances: [{ point: at(EK, -7500, -1000), frameVerified: true }] }] }),
      rules,
    );
    expect(raid.entrances[0]?.raid).toBe(true);
    expect(instanceKindOf(raid, raidMap)).toBe('raid');
  });
});
