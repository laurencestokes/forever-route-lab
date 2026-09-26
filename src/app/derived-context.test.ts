import { describe, expect, it } from 'vitest';
import { type Location, npcId, sequentialIdSource, worldMapId, worldSourcedPoint, zoneSourcedPoint } from '../domain';
import { makeTravelStep } from '../domain/step-factory';
import type { TravelSpeeds } from '../domain/travel';
import { NO_ZONE_HINTS } from '../engine/types';
import { fixtureGeometry } from '../geo/test-fixtures';
import { effectiveRules } from '../rules/precedence';
import { FOREVER_BETA } from '../rules/ruleset';
import { seedTravelGraph } from '../rules/travel-graph';
import type { TransportSeed } from '../rules/travel-seeds';
import { createZoneHintResolver, projectRules, projectTravelGraph, sameMapTransportNote, sameMapTransportsOf, selectTravelModel, travelGraphSourceOf, userDocksKey, userDocksOf } from './derived-context';
import { MAP_TEST_DATASET, MAP_TEST_DUROTAR, MAP_TEST_KALIMDOR, stubNpc, worldSpawn } from './map-test-helpers';
import { NavigationLegTable, NavigationPathCache } from './navigation-legs';
import { createNavigationRuntime, type NavigationState } from './navigation-runtime';
import { endpoint, testNavManifest } from './navigation-test-helpers';

/**
 * The walk's context (ARCHITECTURE §9.1, §12.1): rules with project precedence, the TravelGraph
 * seeded from the dataset, zone hints, same-map transports and the choice of travel model.
 */

const SPEEDS: TravelSpeeds = { groundYps: 7, swimYps: 4.722 };
const geometry = fixtureGeometry();

const fakeService = {
  legs: () => Promise.resolve([]),
  path: () => Promise.resolve(null),
  dispose: () => undefined,
};

describe('project rules', () => {
  it('put project assumptions over the ruleset, with their provenance', () => {
    const rules = projectRules('forever-beta', { runSpeedYps: 8 });
    expect(rules.rulesetId).toBe('forever-beta');
    expect(rules.values.runSpeed).toEqual({ value: 8, basis: 'assumption', source: 'project', from: 'project' });
    expect(rules.values.maxLevel.from).toBe('ruleset');
    expect(projectRules('era-1.15', {}).rulesetId).toBe('era-1.15');
  });
});

describe('TravelGraph seeding from the dataset', () => {
  it('finds the flight masters of the view among the dataset ids, at their resolved spawn', () => {
    const rules = effectiveRules(FOREVER_BETA);
    const graph = projectTravelGraph(MAP_TEST_DATASET, [npcId(20), npcId(10)], rules);
    const nodes = graph.taxiNodes.filter((node) => node.origin === 'dataset');
    expect(nodes.map((node) => node.key)).toEqual(['npc:20']);
    expect(nodes[0]).toMatchObject({ names: ['Doras', 'Orgrimmar'], point: { mapId: 1, x: 1700, y: -4400 }, factions: ['Horde'] });
    // No instance world map per dungeon in zones.json yet: no entrance edge.
    expect(graph.entrances).toEqual([]);
    expect(travelGraphSourceOf(MAP_TEST_DATASET, []).dungeons).toEqual([]);
  });
});

describe('zone hints', () => {
  it('give a route point the zone of the UiMap it was authored on, and a spawn the zone of its UiMap', () => {
    const hints = createZoneHintResolver(geometry, testNavManifest([1]));
    const world = { mapId: MAP_TEST_KALIMDOR, x: 0, y: -4000 };
    const zonePoint = zoneSourcedPoint(MAP_TEST_DUROTAR, 50, 50, 'forever');
    const hint = hints.routePoint(zonePoint, world);
    expect(hint).toBeGreaterThan(0);
    expect(hints.spawn(worldSpawn(MAP_TEST_KALIMDOR, 0, -4000, MAP_TEST_DUROTAR), world)).toBe(hint);
    // A world point authored without a UiMap has no hint.
    expect(hints.routePoint(worldSourcedPoint(MAP_TEST_KALIMDOR, 0, -4000), world)).toBe(0);
  });
});

describe('same-map transports', () => {
  const seed: TransportSeed = {
    id: 'test-boat',
    name: 'Test boat',
    stops: [
      { name: 'North dock', mapId: worldMapId(1), dockNpcIds: [npcId(30)] },
      { name: 'South dock', mapId: worldMapId(1), dockNpcIds: [] },
    ],
    factions: null,
    basis: 'client-data',
    source: 'test',
  };
  const dataset = {
    ...MAP_TEST_DATASET,
    npc: (id: number) => (id === 30 ? stubNpc({ id: npcId(30), name: 'Dockmaster' }) : MAP_TEST_DATASET.npc(npcId(id))),
    spawns: (ref: Parameters<typeof MAP_TEST_DATASET.spawns>[0]) =>
      ref.kind === 'npc' && ref.id === 30 ? [worldSpawn(MAP_TEST_KALIMDOR, 500, -3000, MAP_TEST_DUROTAR)] : MAP_TEST_DATASET.spawns(ref),
  };
  const rules = effectiveRules(FOREVER_BETA);
  const graph = seedTravelGraph(travelGraphSourceOf(dataset, []), rules, {
    transports: [seed],
    taxiNodes: [],
    userDocks: [{ transportId: 'test-boat', stop: 1, point: { mapId: worldMapId(1), x: 900, y: -6000 } }],
  });

  it('are the graph edges with both docks on the map, with wait plus ride and their basis', () => {
    const hints = createZoneHintResolver(geometry, testNavManifest([1]));
    const transports = sameMapTransportsOf(graph, 'Horde', dataset.spawns, hints)(worldMapId(1));
    expect(transports.map((t) => t.id)).toEqual(['test-boat:0>1', 'test-boat:1>0']);
    const first = transports[0];
    // The dock NPC's spawn, with its hint (as the walker makes it); the user dock with hint 0.
    expect(first?.from).toEqual({ point: { mapId: 1, x: 500, y: -3000 }, zoneHint: hints.spawn(worldSpawn(MAP_TEST_KALIMDOR, 500, -3000, MAP_TEST_DUROTAR), { mapId: MAP_TEST_KALIMDOR, x: 500, y: -3000 }) });
    expect(first?.to).toEqual({ point: { mapId: 1, x: 900, y: -6000 }, zoneHint: 0 });
    expect(first?.seconds).toEqual({ value: rules.values.transportWaitSeconds.value + rules.values.transportRideSeconds.value, basis: 'assumption', eraFallback: false });
    expect(sameMapTransportsOf(graph, 'Horde', dataset.spawns, hints)(worldMapId(0))).toEqual([]);
  });

  it('are said to be unused while no same-map transport has both docks positioned (NAV-08)', () => {
    const none = seedTravelGraph(travelGraphSourceOf(MAP_TEST_DATASET, []), rules, { transports: [{ ...seed, stops: seed.stops.map((stop) => ({ ...stop, dockNpcIds: [] })) }], taxiNodes: [] });
    expect(sameMapTransportNote(none, [1])).toMatch(/^Boats and zeppelins between two docks on one continent are not used for walking legs that have no walking path: no dock has a known position/);
    // One positioned pair is enough; a map without same-map transports needs no note.
    expect(sameMapTransportNote(graph, [1])).toBeNull();
    expect(sameMapTransportNote(none, [0])).toBeNull();
  });

  it('leave out transports the faction may not use', () => {
    const closed = seedTravelGraph(travelGraphSourceOf(dataset, []), rules, {
      transports: [{ ...seed, factions: ['Alliance'] }],
      taxiNodes: [],
      userDocks: [{ transportId: 'test-boat', stop: 1, point: { mapId: worldMapId(1), x: 900, y: -6000 } }],
    });
    expect(sameMapTransportsOf(closed, 'Horde', dataset.spawns, NO_ZONE_HINTS)(worldMapId(1))).toEqual([]);
    expect(sameMapTransportsOf(closed, 'Alliance', dataset.spawns, NO_ZONE_HINTS)(worldMapId(1))).toHaveLength(2);
  });
});

describe('user docks from the route (TIME-7, NAV-08)', () => {
  const ids = sequentialIdSource(100);
  const at = (mapId: number, x: number, y: number): Location => ({ source: worldSourcedPoint(worldMapId(mapId), x, y), label: null, radius: null });
  const transports: TransportSeed[] = [
    { id: 'ferry', name: 'Ferry', stops: [{ name: 'West', mapId: worldMapId(1), dockNpcIds: [] }, { name: 'East', mapId: worldMapId(0), dockNpcIds: [] }], factions: null, basis: 'official', source: 'test' },
    { id: 'lake', name: 'Lake boat', stops: [{ name: 'North', mapId: worldMapId(1), dockNpcIds: [] }, { name: 'South', mapId: worldMapId(1), dockNpcIds: [] }], factions: null, basis: 'official', source: 'test' },
  ];
  const transport = (id: string | null, dock: Location | null) => makeTravelStep(ids, { mode: 'transport', transport: { id, dock } });

  it('take the dock a transport step boards at as its stop on that map, the first step winning', () => {
    const steps = [
      makeTravelStep(ids, { mode: 'walk', location: at(1, 5, 5) }),
      transport('ferry', at(1, 100, -200)),
      transport('ferry', at(1, 999, -999)),
      transport('ferry', at(0, -300, 400)),
    ];
    expect(userDocksOf(steps, geometry, transports)).toEqual([
      { transportId: 'ferry', stop: 0, point: { mapId: 1, x: 100, y: -200 } },
      { transportId: 'ferry', stop: 1, point: { mapId: 0, x: -300, y: 400 } },
    ]);
  });

  it('guess nothing: no transport id, an unknown transport, a map with two of its stops, or no stop on that map give no dock', () => {
    const steps = [transport(null, at(1, 1, 1)), transport('nope', at(1, 1, 1)), transport('lake', at(1, 1, 1)), transport('ferry', at(530, 1, 1)), transport('ferry', null)];
    expect(userDocksOf(steps, geometry, transports)).toEqual([]);
  });

  it('position the graph\'s docks, so the edges between them are priced', () => {
    const docks = userDocksOf([transport('ferry', at(1, 100, -200)), transport('ferry', at(0, -300, 400))], geometry, transports);
    const rules = effectiveRules(FOREVER_BETA);
    const graph = seedTravelGraph(travelGraphSourceOf(MAP_TEST_DATASET, []), rules, { transports, taxiNodes: [], userDocks: docks });
    const edge = graph.transports.find((e) => e.id === 'ferry:0>1');
    expect(edge?.from).toMatchObject({ point: { mapId: 1, x: 100, y: -200 }, pointFrom: 'user' });
    expect(edge?.to).toMatchObject({ point: { mapId: 0, x: -300, y: 400 }, pointFrom: 'user' });
    expect(userDocksKey(docks)).toBe('ferry:0@1:100,-200|ferry:1@0:-300,400');
    // The app's graph takes them for the seeded transports (a test position, not a dock's).
    const seeded = userDocksOf([transport('stormwind-auberdine', at(1, 100, -200))], geometry);
    expect(seeded).toEqual([{ transportId: 'stormwind-auberdine', stop: 0, point: { mapId: 1, x: 100, y: -200 } }]);
    expect(projectTravelGraph(MAP_TEST_DATASET, [], rules, seeded).report.transports.docksFromUser).toBe(1);
    expect(projectTravelGraph(MAP_TEST_DATASET, [], rules).report.transports.docksFromUser).toBe(0);
  });
});

describe('travel model selection', () => {
  const rules = effectiveRules(FOREVER_BETA);
  const graph = projectTravelGraph(MAP_TEST_DATASET, [], rules);
  const base = { detourFactor: 1.5, graph, faction: 'Horde' as const, dataset: MAP_TEST_DATASET, geometry };
  const from = endpoint(1, 0, 0);
  const to = endpoint(1, 70, 0);

  it('is the straight-line model while navigation is checked or unavailable, with the effective detour and no hints', () => {
    for (const navigation of [{ kind: 'checking' }, { kind: 'unavailable', reason: 'none' }] satisfies NavigationState[]) {
      const selection = selectTravelModel({ ...base, navigation });
      expect(selection.model.id).toBe('straight-line');
      expect(selection.navigation).toBeNull();
      expect(selection.hints).toBe(NO_ZONE_HINTS);
      expect(selection.model.leg(from, to, SPEEDS)).toEqual({ seconds: { value: 15, basis: 'assumption', eraFallback: false }, method: 'straight-line', pending: false, warnings: [] });
    }
  });

  it('is the navigation model when its runtime is available, with the straight-line fallback while legs are pending', () => {
    const runtime = createNavigationRuntime(testNavManifest([1]), fakeService);
    const selection = selectTravelModel({ ...base, navigation: { kind: 'available', runtime } });
    expect(selection.model.id).toBe('navigation');
    expect(selection.navigation).toBe(selection.model);
    expect(selection.navigation?.table).toBe(runtime.table);
    expect(selection.model.revision).toBe(runtime.manifest.navRevision);
    expect(selection.navigation?.hasNavigation(1)).toBe(true);
    expect(selection.navigation?.hasNavigation(0)).toBe(false);
    // Pending: the fallback's seconds (the effective detour), marked pending.
    expect(selection.model.leg(from, to, SPEEDS)).toMatchObject({ seconds: { value: 15, basis: 'assumption' }, method: 'straight-line', pending: true });
    // A map without navigation data takes the fallback for good.
    expect(selection.model.leg(endpoint(0, 0, 0), endpoint(0, 70, 0), SPEEDS)).toMatchObject({ pending: false, method: 'straight-line' });
    runtime.dispose();
  });

  it('shares the runtime\'s leg table between models built for different rules', () => {
    const table = new NavigationLegTable(testNavManifest([1]).navRevision);
    const paths = new NavigationPathCache();
    const runtime = { ...createNavigationRuntime(testNavManifest([1]), fakeService), table, paths };
    const a = selectTravelModel({ ...base, navigation: { kind: 'available', runtime } });
    const b = selectTravelModel({ ...base, detourFactor: 2, navigation: { kind: 'available', runtime } });
    expect(a.navigation?.table).toBe(b.navigation?.table);
    expect(b.model.leg(from, to, SPEEDS).seconds.value).toBe(20);
  });
});
