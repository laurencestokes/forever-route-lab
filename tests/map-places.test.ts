/**
 * The committed client tables in the app, end to end (D-039 B, E, F; map-presentation.md §8 to
 * §10; SIMULATION TIME-5, TIME-6, TIME-7; steps MP.5, MP.8, MP.9): the full committed dataset and
 * `public/maps/client/` served by the fake fetch and verified with Node's WebCrypto, the derived
 * pipeline loading the tables itself, the TravelGraph seeded from the taxi file, a flight timed by
 * TIME-6 from the committed path length (TIME-5 before the file has loaded), and the places model:
 * dungeon membership, the tuning levels, flight points and flights, and the transports' inferred
 * docks. No client needed.
 */
import { describe, expect, it } from 'vitest';
import { fixedClock } from '../src/app/clock';
import { createDerivedStore, type DerivedState, provisionalNote } from '../src/app/derived';
import { createDerivedPipeline } from '../src/app/derived-pipeline';
import { createEditorStore } from '../src/app/store';
import { loadWorkspace } from '../src/app/workspace';
import { npcId, sequentialIdSource } from '../src/domain/ids';
import { makeFlightStep } from '../src/domain/step-factory';
import { createClientTables } from '../src/infra/maps/client-tables';
import type { MarkerDescriptor } from '../src/map/adapter';
import { fakeServer, nodeSha256, publicSite, readDirectory } from './support/fake-fetch';

const NOW = '2026-09-26T00:00:00.000Z';
const ref = (id: number) => ({ npcId: npcId(id), taxiNodeId: null, name: null });
// Doras (Orgrimmar, TaxiNodes 23) and Devrak (Crossroads, TaxiNodes 25): dataset flight masters.
const ORGRIMMAR = 3310;
const CROSSROADS = 3615;

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe('the committed client tables in the derived pipeline and the map’s places', () => {
  it('times a flight from the committed path length once the taxi file has loaded, and builds the places', { timeout: 60_000 }, async () => {
    const site = new Map([...publicSite(), ...readDirectory('public/maps/client', 'maps/client/')]);
    const server = fakeServer(site);
    const workspace = await loadWorkspace({ fetch: server.fetch, baseUrl: './', sha256: nodeSha256, nowIso: NOW, yieldToRender: () => Promise.resolve() });
    const ids = sequentialIdSource(9000);
    const flight = makeFlightStep(ids, { from: ref(ORGRIMMAR), to: ref(CROSSROADS) });
    const base = workspace.project;
    const project = {
      ...base,
      character: { ...base.character, faction: 'Horde' as const, race: 'Orc' as const, class: 'WARRIOR' as const, knownFlightPaths: [ref(ORGRIMMAR), ref(CROSSROADS)] },
      route: { ...base.route, steps: [flight], groups: {} },
    };
    const store = createEditorStore({ project, ids: sequentialIdSource(1000), clock: fixedClock(NOW) });
    const handle = createDerivedStore();
    const seen: DerivedState[] = [];
    handle.store.subscribe(() => seen.push(handle.store.getState()));
    const pipeline = createDerivedPipeline({
      store,
      data: workspace.data,
      geometry: workspace.geometry.geometry,
      output: handle,
      clientTables: { resources: { fetch: server.fetch, baseUrl: './', sha256: nodeSha256 } },
    });
    store.select({ kind: 'single', id: flight.id });
    await until(() => handle.store.getState().places?.taxi === 'loaded' && handle.store.getState().places?.dungeonTable === 'loaded', 'the client tables');
    await until(() => (handle.store.getState().places?.flightsKnown ?? null) !== null, 'the places with route state');

    // TIME-5 before the file had loaded: the straight line × 1.4 at 32 yd/s.
    const taxi = JSON.parse(new TextDecoder().decode(site.get('maps/client/taxi.json'))) as { flights: { from: number; to: number; l3d: number }[] };
    const direct = taxi.flights.find((candidate) => candidate.from === 23 && candidate.to === 25);
    if (direct === undefined) throw new Error('no Orgrimmar → Crossroads flight in the committed file');
    const travels = seen.flatMap((state) => (state.results === null ? [] : [state.results.estimates[0]?.breakdown.travel ?? null]));
    const last = handle.store.getState().results?.estimates[0];
    // TIME-6: the committed 3D length at 32 yd/s (era-assumed); the flight master's 3 s go to interaction.
    expect(last?.breakdown.travel).toBeCloseTo(direct.l3d / 32, 6);
    expect(last?.breakdown.interaction).toBe(3);
    expect(travels[0]).not.toBeCloseTo(direct.l3d / 32, 1);

    const places = handle.store.getState().places;
    if (places === null || places === undefined) throw new Error('no places');
    // MP.5: the finder's instances at the dataset's entrances; nothing that is not Forever content.
    const labels = places.dungeons.items.flatMap((item) => (item.descriptor.type === 'marker' ? item.descriptor.labels : []));
    for (const name of ['Utgarde', 'Black Morass', 'Old Hillsbrad', 'Blackrock Caverns', 'Firelands', 'Dragon Soul', 'Darkmoon', 'Deeprun Tram', 'Demon Fall Canyon', 'Karazhan']) {
      expect(labels.some((label) => label?.includes(name) === true), name).toBe(false);
    }
    expect(places.counts).toMatchObject({ dungeons: 19, raids: 4, 'unconfirmed-raids': 3 });
    const blackrock = places.dungeons.items.map((item) => item.descriptor).filter((d): d is MarkerDescriptor => d.type === 'marker' && d.labels.some((label) => label?.startsWith('Molten Core') === true));
    expect(blackrock.map((pin) => pin.count)).toEqual([4, 4]);
    expect(places.notes.dungeons.join(' ')).toContain('Ruins of Lordaeron (LFG tuning ?)');
    expect(places.notes.dungeons.join(' ')).toContain('2 instance maps of unknown purpose not shown: Half-Pint Tavern and Manor Mistmantle.');
    const caverns = labels.find((label) => label?.startsWith('Wailing Caverns') === true);
    expect(caverns).toContain('LFG tuning level 17 (client LFGDungeons row 1 → ContentTuning 5254, build 1.60.1.70124; meaning unverified)');
    expect(caverns).toContain('dungeon quests 16–22 (9 open to an Orc Warrior; Era quest levels from the dataset)');

    // MP.8: the Horde's flight points, the two known after the step, and its flights.
    // The file's nodes the Horde may use: its own, both factions' and the one with no side (35), and
    // the two Moonglade druid flight masters, at no node of the file (it keeps the paid paths'
    // nodes), drawn from the dataset, which gives them both factions (review TR-10).
    expect(places.counts['flight-points']).toBe(37);
    expect(places.notes['flight-masters']).toContain(
      "3 flight masters stand at no node of the client taxi file, which keeps only the nodes of paths that cost something (Vesprystus, Bunthen Plainswind and Silva Fil'naveth): drawn where the dataset puts them, with the dataset's faction (it records no class restriction), and their flights timed by the straight-line estimate (TIME-5).",
    );
    for (const id of [11798, 11800]) expect(places.flightPoints.items.find((item) => item.descriptor.id === `flight:npc:${String(id)}`)).toMatchObject({ name: expect.any(String) as unknown });
    // Vesprystus is the Alliance's: drawn in the other faction's row.
    expect(places.flightPoints.items.find((item) => item.descriptor.id === 'flight:npc:3838')?.descriptor.category).toBe('other-faction-flights');
    expect(places.flightsKnown).toBe(2);
    const crossroads = places.flightPoints.items.find((item) => item.descriptor.id === `flight:npc:${String(CROSSROADS)}`);
    expect(crossroads?.node).toBe(25);
    expect(crossroads?.descriptor.type === 'marker' ? crossroads.descriptor.mark?.state : null).toBe('flight-known');
    expect(places.counts['flight-network']).toBe(74);
    const route = places.flights.items.filter((item) => item.route === true).map((item) => item.descriptor.id);
    expect(route).toEqual(['flight:23-25']);

    // MP.9: the matched stops are inferred with their record; the others never reach the engine.
    const stops = places.transports.items.flatMap((item) => (item.descriptor.type === 'marker' ? [item.descriptor] : []));
    expect(stops.filter((stop) => stop.mark?.state === 'transport-inferred')).toHaveLength(13);
    expect(stops.filter((stop) => stop.mark?.state === 'transport-unknown')).toHaveLength(13);

    // MP.11: the Horde's and both factions' innkeepers, Warrior trainers and the dataset's vendors.
    // Two vendors that are another class's or a profession's trainer are not drawn as vendors (review PR-21).
    expect(places.counts).toMatchObject({ innkeepers: 26, trainers: 16, vendors: 57 });
    expect(places.services.items).toHaveLength(109);
    expect(places.notes.services).toContain('3 service NPCs have no faction in the dataset: not drawn.');
    pipeline.dispose();
  });

  it('keeps the results provisional while the taxi file loads, then final on TIME-6 (TIME-5, TIME-6; review TR-07)', { timeout: 60_000 }, async () => {
    const site = new Map([...publicSite(), ...readDirectory('public/maps/client', 'maps/client/')]);
    const server = fakeServer(site);
    const workspace = await loadWorkspace({ fetch: server.fetch, baseUrl: './', sha256: nodeSha256, nowIso: NOW, yieldToRender: () => Promise.resolve() });
    const tables = createClientTables({ fetch: server.fetch, baseUrl: './', sha256: nodeSha256 });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ids = sequentialIdSource(9000);
    // `.fly Crossroads`: only the file's node names ("Crossroads, The Barrens") resolve the query.
    const flight = makeFlightStep(ids, { from: ref(ORGRIMMAR), to: null, nodeQuery: 'Crossroads' });
    const base = workspace.project;
    const project = {
      ...base,
      character: { ...base.character, faction: 'Horde' as const, race: 'Orc' as const, class: 'WARRIOR' as const, knownFlightPaths: [ref(ORGRIMMAR), ref(CROSSROADS)] },
      route: { ...base.route, steps: [flight], groups: {} },
    };
    const store = createEditorStore({ project, ids: sequentialIdSource(1000), clock: fixedClock(NOW) });
    const handle = createDerivedStore();
    const pipeline = createDerivedPipeline({
      store,
      data: workspace.data,
      geometry: workspace.geometry.geometry,
      output: handle,
      navigation: { kind: 'unavailable', reason: 'test' },
      clientTables: {
        taxi: async () => {
          await gate;
          return tables.taxi();
        },
        dungeons: () => tables.dungeons(),
      },
    });
    await until(() => handle.store.getState().results !== null, 'the first walk');
    const before = handle.store.getState();
    // Navigation is settled and no leg is pending, but the taxi file has not arrived: not final.
    expect(before.results).toMatchObject({ final: false, taxiPending: true, pendingLegs: 0 });
    expect(provisionalNote(before)).toBe('Pending: loading the client taxi file; flight times use the straight-line estimate.');
    expect(before.results?.stepIssues[0]?.map((issue) => issue.code)).toContain('SIM008-flight-unresolved');
    release();
    await until(() => handle.store.getState().places?.taxi === 'loaded' && handle.store.getState().results?.final === true, 'the taxi file and the final walk');
    const after = handle.store.getState();
    expect(after.results?.taxiPending).toBe(false);
    expect(provisionalNote(after)).toBeNull();
    expect(after.results?.stepIssues[0]?.map((issue) => issue.code)).not.toContain('SIM008-flight-unresolved');
    expect(after.results?.estimates[0]?.assumptionsUsed).not.toContain('taxiDetourFactor');
    pipeline.dispose();
  });

  it('keeps TIME-5 for good and says why when the taxi file fails its check (a tampered file)', { timeout: 60_000 }, async () => {
    const site = new Map([...publicSite(), ...readDirectory('public/maps/client', 'maps/client/')]);
    const server = fakeServer(site);
    const workspace = await loadWorkspace({ fetch: server.fetch, baseUrl: './', sha256: nodeSha256, nowIso: NOW, yieldToRender: () => Promise.resolve() });
    server.set('maps/client/taxi.json', '{"schema":1,"kind":"client-taxi"}');
    const ids = sequentialIdSource(9000);
    const flight = makeFlightStep(ids, { from: ref(ORGRIMMAR), to: ref(CROSSROADS) });
    const project = { ...workspace.project, character: { ...workspace.project.character, knownFlightPaths: [ref(ORGRIMMAR), ref(CROSSROADS)] }, route: { ...workspace.project.route, steps: [flight], groups: {} } };
    const store = createEditorStore({ project, ids: sequentialIdSource(1000), clock: fixedClock(NOW) });
    const handle = createDerivedStore();
    const pipeline = createDerivedPipeline({ store, data: workspace.data, geometry: workspace.geometry.geometry, output: handle, clientTables: { resources: { fetch: server.fetch, baseUrl: './', sha256: nodeSha256 } } });
    await until(() => handle.store.getState().places?.taxi === 'failed' && handle.store.getState().places?.dungeonTable === 'loaded', 'the failed taxi file');
    const places = handle.store.getState().places;
    expect(places?.unavailable['flight-network']).toMatch(/^The client taxi file could not be used \(maps\/client\/taxi\.json failed its integrity check: .*\): no flight lines are drawn, and flights are timed as a straight line/);
    expect(places?.flights.items).toEqual([]);
    expect(places?.counts.dungeons).toBe(19);
    // TIME-5: the flight is the straight line × the detour factor.
    expect(handle.store.getState().results?.estimates[0]?.assumptionsUsed).toContain('taxiDetourFactor');
    // Once the file has failed, TIME-5 is final: nothing is still loading (TR-07).
    await until(() => handle.store.getState().results?.taxiPending === false, 'the walk after the failure');
    pipeline.dispose();
  });
});
