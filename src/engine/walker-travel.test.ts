import { describe, expect, it } from 'vitest';
import { estimate } from '../domain/estimate';
import { npcId } from '../domain/ids';
import type { RouteStep } from '../domain/route';
import { makeFlightStep, makeTravelStep, makeVendorStep } from '../domain/step-factory';
import type { TravelLeg, TravelModel } from '../domain/travel';
import type { CommittedTaxi } from '../rules/travel-graph';
import type { TransportSeed } from '../rules/travel-seeds';
import type { SimFact } from '../sim/facts';
import { at, EASTERN_KINGDOMS, fixtureContext, type FixtureContextOptions, fixtureDataset, fixtureProject, KALIMDOR, npcRecord, point, spawnAt, testIds } from './test-helpers';
import type { RouteWalk, StepRecord } from './types';
import { walkRoute } from './walker';

/**
 * The walker's transports and flights after the map rework's travel review (docs/SIMULATION.md
 * TIME-5..TIME-7; findings TR-01, TR-02, TR-03 and TR-08): the quickest-edge choice never picks a
 * service from inferred docks, a ride records its edge and its docks' provenance, a walk to or from
 * a client berth ends at its boarding point on walkable ground, the step to the berth priced at run
 * speed as an assumption (D-052 item 1), and a flight to a
 * node its faction may not use warns.
 * The seeded ship, its client path and the positions are made up for the tests.
 */

const ids = testIds();

const DATA = fixtureDataset({
  npcs: [npcRecord(60, { npcFlags: 8, friendlyTo: 'H' }), npcRecord(61, { npcFlags: 8, friendlyTo: 'A' })],
  spawns: { 'npc:60': [spawnAt(point(0))], 'npc:61': [spawnAt(point(3200))] },
});

/** A ship whose docks only the committed file positions (TIME-7): client path 900, stops 1 and 2. */
const SHIP: TransportSeed = {
  id: 'test-ship',
  name: 'Test ship',
  stops: [
    { name: 'Kalimdor pier', mapId: KALIMDOR, dockNpcIds: [], clientStop: 0 },
    { name: 'Eastern Kingdoms pier', mapId: EASTERN_KINGDOMS, dockNpcIds: [], clientStop: 1 },
  ],
  factions: null,
  basis: 'client-data',
  source: 'test',
  clientPath: 900,
};

const TAXI: CommittedTaxi = {
  build: 'test-build',
  nodes: [],
  flights: [],
  transports: [{ pathId: 900, maps: [KALIMDOR, EASTERN_KINGDOMS], stops: [{ point: point(100), delaySeconds: 60 }, { point: point(0, 0, EASTERN_KINGDOMS), delaySeconds: 60 }] }],
};

const context = (options: FixtureContextOptions = {}) => fixtureContext(DATA, { flightMasterIds: [60, 61], graph: { transports: [SHIP], taxi: TAXI }, ...options });
const walk = (steps: readonly RouteStep[], ctx = context(), character: Parameters<typeof fixtureProject>[1] = {}): RouteWalk => walkRoute(fixtureProject(steps, character), ctx);
const record = (result: RouteWalk, index: number): StepRecord => {
  const found = result.records[index];
  if (found === undefined) throw new Error(`no record ${String(index)}`);
  return found;
};
const factsOf = <K extends SimFact['kind']>(r: StepRecord, kind: K): Extract<SimFact, { readonly kind: K }>[] => r.estimate.facts.filter((fact): fact is Extract<SimFact, { readonly kind: K }> => fact.kind === kind);

/**
 * A navigation-like model: half of every leg's straight line is ground, half swim, so the seconds
 * say which speed the swim was priced at, and a swim over 200 yd warns (as SIM-21's source does).
 */
const halfSwim: TravelModel = {
  id: 'navigation',
  revision: 'nav-test',
  leg: (from, to, speeds): TravelLeg => {
    const d = Math.sqrt((from.point.x - to.point.x) ** 2 + (from.point.y - to.point.y) ** 2);
    return {
      seconds: estimate(d / 2 / speeds.groundYps + d / 2 / speeds.swimYps, 'derived'),
      method: 'navigation',
      pending: false,
      warnings: d / 2 > 200 ? [{ kind: 'long-swim', longestSwimYd: d / 2 }] : [],
    };
  },
  path: () => null,
};

describe('a transport step naming its record (TIME-7; TR-02)', () => {
  it('rides the inferred docks and records the edge with each dock’s client record', () => {
    const result = walk([makeTravelStep(ids, { mode: 'transport', transport: { id: 'test-ship', dock: null }, location: at(40, 30, EASTERN_KINGDOMS) })]);
    const crossing = record(result, 0);
    expect(crossing.estimate.duration.value).toBeCloseTo((100 * 1.25) / 7 + 120 + (50 * 1.25) / 7, 10);
    expect(factsOf(crossing, 'transport-ride')).toEqual([
      {
        kind: 'transport-ride',
        transportId: 'test-ship',
        edgeId: 'test-ship:0>1',
        name: 'Test ship',
        docks: [
          { end: 'departure', name: 'Kalimdor pier', pointFrom: 'inferred', record: 'client transport path 900, stop 1 of 2', boardingYd: null },
          { end: 'arrival', name: 'Eastern Kingdoms pier', pointFrom: 'inferred', record: 'client transport path 900, stop 2 of 2', boardingYd: null },
        ],
      },
    ]);
  });

  it('a user dock boards where the user said: the departure is the user’s, without the inferred record', () => {
    const result = walk([makeTravelStep(ids, { mode: 'transport', transport: { id: 'test-ship', dock: at(70) }, location: at(0, 0, EASTERN_KINGDOMS) })]);
    const [ride] = factsOf(record(result, 0), 'transport-ride');
    expect(ride?.docks[0]).toEqual({ end: 'departure', name: 'Kalimdor pier', pointFrom: 'user', record: null, boardingYd: null });
    expect(ride?.docks[1]).toMatchObject({ pointFrom: 'inferred' });
  });
});

describe('a transport step naming no record and no dock (TIME-7; TR-01)', () => {
  it('never chooses the service from inferred docks: unknown with SIM-3, as before the file loaded', () => {
    const result = walk([makeTravelStep(ids, { mode: 'transport', transport: null, location: at(40, 30, EASTERN_KINGDOMS) })]);
    const crossing = record(result, 0);
    expect(crossing.estimate.duration.value).toBeNull();
    expect(crossing.estimate.facts.map((fact) => fact.kind)).toContain('unresolved-location');
    expect(factsOf(crossing, 'transport-ride')).toEqual([]);
    expect(crossing.legs).toEqual([]);
    // Without the file the result is the same.
    const without = walk([makeTravelStep(ids, { mode: 'transport', transport: null, location: at(40, 30, EASTERN_KINGDOMS) })], context({ graph: { transports: [SHIP] } }));
    expect(record(without, 0).estimate.duration).toEqual(crossing.estimate.duration);
  });

  it('still chooses among docks the user entered for both stops', () => {
    const userDocks = [
      { transportId: 'test-ship', stop: 0, point: point(100) },
      { transportId: 'test-ship', stop: 1, point: point(0, 0, EASTERN_KINGDOMS) },
    ];
    const result = walk([makeTravelStep(ids, { mode: 'transport', transport: null, location: at(40, 30, EASTERN_KINGDOMS) })], context({ graph: { transports: [SHIP], taxi: TAXI, userDocks } }));
    const crossing = record(result, 0);
    expect(crossing.estimate.duration.value).toBeCloseTo((100 * 1.25) / 7 + 120 + (50 * 1.25) / 7, 10);
    expect(factsOf(crossing, 'transport-ride')[0]).toMatchObject({ edgeId: 'test-ship:0>1' });
  });
});

// D-052 item 1 (review TR-03, follow-up F-07): a client berth lies in the water beside its pier; its
// walks end at the boarding point the berth table gives (src/rules/berths.ts), and the step between
// the boarding point and the berth is priced at each end as its straight-line yards at run speed,
// an assumption, as a travel part of its own (not in the wait).
describe('walks to and from client berths (TIME-7; D-052 item 1; TR-03)', () => {
  /** The Stormwind Harbor – Auberdine ship on its real client path and berths (the table knows them). */
  const REAL: TransportSeed = { ...SHIP, id: 'real-ship', clientPath: 11616 };
  const REAL_TAXI: CommittedTaxi = {
    ...TAXI,
    transports: [{ pathId: 11616, maps: [KALIMDOR, EASTERN_KINGDOMS], stops: [{ point: point(6548, 942), delaySeconds: 60 }, { point: point(-8654, 1344, EASTERN_KINGDOMS), delaySeconds: 60 }] }],
  };
  const BOARD_K = point(6534, 908);
  const BOARD_E = point(-8648, 1333, EASTERN_KINGDOMS);
  const real = (options: FixtureContextOptions = {}) => fixtureContext(DATA, { flightMasterIds: [60, 61], graph: { transports: [REAL], taxi: REAL_TAXI }, travel: halfSwim, ...options });
  const start = { character: { startLocation: at(6634, 908) } };

  it('walk to the boarding point on walkable ground, and on from the arrival’s, and price each step to the berth at run speed as an assumption', () => {
    const ctx = real();
    const result = walk([makeTravelStep(ids, { mode: 'transport', transport: { id: 'real-ship', dock: null }, location: at(-8648, 1433, EASTERN_KINGDOMS) })], ctx, start);
    const crossing = record(result, 0);
    expect(crossing.legs.map((leg) => [leg.purpose, leg.from.point, leg.to.point])).toEqual([
      ['dock', point(6634, 908), BOARD_K],
      ['step', BOARD_E, point(-8648, 1433, EASTERN_KINGDOMS)],
    ]);
    // 100 yd to the boarding point and 100 yd on (half ground, half swim in this model), the wait
    // and the ride, and the two berth steps (36.8 and 12.5 yd) at run speed. No leg is drawn for them.
    const runSpeed = ctx.rules.values.runSpeed.value;
    const swim = crossing.legs[0]?.seconds.value ?? 0;
    expect(crossing.estimate.duration.value).toBeCloseTo(2 * swim + 120 + (36.8 + 12.5) / runSpeed, 10);
    expect(crossing.estimate.duration.basis).toBe('assumption');
    expect(crossing.estimate.breakdown.waiting).toBeCloseTo(60, 10);
    expect(crossing.estimate.breakdown.travel).toBeCloseTo(2 * swim + 60 + (36.8 + 12.5) / runSpeed, 10);
    expect(factsOf(crossing, 'transport-ride')[0]?.docks.map((dock) => dock.boardingYd)).toEqual([36.8, 12.5]);
  });

  it('price only the arrival’s berth step when the departure is a dock the user entered', () => {
    const ctx = real();
    const result = walk([makeTravelStep(ids, { mode: 'transport', transport: { id: 'real-ship', dock: at(6548, 942) }, location: at(-8648, 1433, EASTERN_KINGDOMS) })], ctx, start);
    const crossing = record(result, 0);
    expect(crossing.legs.map((leg) => [leg.purpose, leg.to.point])).toEqual([
      ['dock', point(6548, 942)],
      ['step', point(-8648, 1433, EASTERN_KINGDOMS)],
    ]);
    const runSpeed = ctx.rules.values.runSpeed.value;
    const walked = crossing.legs.reduce((sum, leg) => sum + (leg.seconds.value ?? 0), 0);
    expect(crossing.estimate.duration.value).toBeCloseTo(walked + 120 + 12.5 / runSpeed, 10);
    expect(factsOf(crossing, 'transport-ride')[0]?.docks.map((dock) => dock.boardingYd)).toEqual([null, 12.5]);
  });

  it('a transport without a location leaves the character at the arrival’s boarding point', () => {
    const result = walk([makeTravelStep(ids, { mode: 'transport', transport: { id: 'real-ship', dock: null } }), makeVendorStep(ids, { location: at(-8648, 1433, EASTERN_KINGDOMS) })], real(), start);
    expect(record(result, 0).delta.locationAfter).toEqual(BOARD_E);
    expect(record(result, 1).legs[0]?.from.point).toEqual(BOARD_E);
  });

  it('a berth the table does not know keeps its walk to the berth, priced as it is, swim and warning included', () => {
    const ctx = context({ travel: halfSwim });
    const result = walk([makeTravelStep(ids, { mode: 'transport', transport: { id: 'test-ship', dock: null }, location: at(0, 900, EASTERN_KINGDOMS) })], ctx);
    const crossing = record(result, 0);
    const swimSpeed = ctx.rules.values.swimSpeed.value;
    expect(crossing.legs.map((leg) => [leg.purpose, leg.to.point])).toEqual([
      ['dock', point(100)],
      ['step', point(0, 900, EASTERN_KINGDOMS)],
    ]);
    expect(crossing.legs[1]?.seconds.value).toBeCloseTo(450 / 7 + 450 / swimSpeed, 10);
    expect(crossing.estimate.facts).toContainEqual({ kind: 'travel-warning', warning: { kind: 'long-swim', longestSwimYd: 450 } });
  });
});

describe('flights to a node the faction may not use (TIME-5, SIM-24; TR-08)', () => {
  it('are still timed, with a warning per end the faction may not use', () => {
    const ref = (id: number) => ({ npcId: npcId(id), taxiNodeId: null, name: null });
    const result = walk([makeFlightStep(ids, { from: ref(60), to: ref(61) })], context(), { character: { faction: 'Horde', knownFlightPaths: [ref(60), ref(61)] } });
    const flight = record(result, 0);
    expect(flight.estimate.duration.value).not.toBeNull();
    expect(factsOf(flight, 'flight-faction')).toEqual([{ kind: 'flight-faction', end: 'to', node: 'npc:61' }]);
    const own = walk([makeFlightStep(ids, { from: ref(61), to: ref(61) })], context(), { character: { faction: 'Alliance', knownFlightPaths: [ref(61)] } });
    expect(factsOf(record(own, 0), 'flight-faction')).toEqual([]);
  });
});
