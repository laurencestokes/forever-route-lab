import { describe, expect, it } from 'vitest';
import type { ObjectiveDef } from '../domain/dataset';
import { areaId, npcId, questId, uiMapId } from '../domain/ids';
import { zoneSourcedPoint } from '../domain/points';
import type { RouteStep } from '../domain/route';
import {
  makeAcceptStep,
  makeCompleteStep,
  makeFlightStep,
  makeGrindStep,
  makeHearthStep,
  makeNoteStep,
  makeTravelStep,
  makeTurnInStep,
  makeVendorStep,
} from '../domain/step-factory';
import { TRANSPORT_SEEDS } from '../rules/travel-seeds';
import type { LocalTaxiData } from '../sim/taxi';
import { checkpointOf, cloneState, createInitialState, restoreCheckpoint } from './state';
import { createPlaces } from './places';
import {
  at,
  EASTERN_KINGDOMS,
  fixtureContext,
  type FixtureContextOptions,
  fixtureDataset,
  fixtureProject,
  killObjective,
  npcRecord,
  point,
  questRecord,
  spawnAt,
  TEST_INSTANCE,
  testIds,
} from './test-helpers';
import type { EngineContext, RouteWalk, StepRecord } from './types';
import { aggregateRouteMetrics } from '../sim/estimate';
import { sharedSimCache } from './sim-cache';
import { createRouteWalker, walkMetrics, walkRoute } from './walker';

/**
 * Walker cases from the Milestone 6 review (docs/SIMULATION.md XP-2..XP-4, TIME-2, TIME-4..TIME-10,
 * TIME-12, KXP-5, §8): the level cap, the provenance of levels, duration overrides, targets that
 * cannot be priced, the hearth clock, unpositioned transports, instance kills, local taxi legs,
 * unknown positions and the start XP. Record numbers are made up for the tests.
 */

const q = questId;
const ids = testIds();
const REPUTATION: ObjectiveDef = { kind: 'reputation', factionId: 76, value: 3000, label: null } as unknown as ObjectiveDef;

const DATA = fixtureDataset({
  quests: [
    questRecord(1, { xp: null }),
    questRecord(2, { xp: { questLevel: 19, baseXp: 1000, basis: 'era-seed' } }),
    questRecord(3, { xp: { questLevel: 10, baseXp: 840, basis: 'forever-observed' } }),
    questRecord(4, { xp: { questLevel: 19, baseXp: 50000, basis: 'forever-observed' } }),
    questRecord(10, { objectives: [killObjective(5)] }),
    questRecord(11, { objectives: [killObjective(5)] }),
    questRecord(12, { objectives: [REPUTATION] }),
    questRecord(13, { objectives: [killObjective(7)] }),
    questRecord(300, { starters: [{ kind: 'npc', id: npcId(20) }] }),
  ],
  npcs: [
    npcRecord(5),
    npcRecord(7, { rank: 1 }),
    npcRecord(20),
    npcRecord(60, { npcFlags: 8, friendlyTo: 'H' }),
    npcRecord(61, { npcFlags: 8, friendlyTo: 'H' }),
    npcRecord(62, { npcFlags: 8, friendlyTo: 'H' }),
    npcRecord(63, { npcFlags: 8, friendlyTo: 'A' }),
  ],
  spawns: {
    'npc:5': [spawnAt(point(10))],
    'npc:7': [spawnAt(point(5, 5, TEST_INSTANCE))],
    'npc:20': [spawnAt(point(5000)), spawnAt(point(1100))],
    'npc:60': [spawnAt(point(0))],
    'npc:61': [spawnAt(point(6000))],
    'npc:62': [spawnAt(point(3000, 2000))],
    'npc:63': [spawnAt(point(3000, -2000))],
  },
});

const context = (options: FixtureContextOptions = {}): EngineContext => fixtureContext(DATA, { flightMasterIds: [60, 61, 62, 63], ...options });
const walk = (steps: readonly RouteStep[], options: Parameters<typeof fixtureProject>[1] = {}, ctx = context()): RouteWalk => walkRoute(fixtureProject(steps, options), ctx);
const record = (result: RouteWalk, index: number): StepRecord => {
  const found = result.records[index];
  if (found === undefined) throw new Error(`no record ${String(index)}`);
  return found;
};
const UNKNOWN = { value: null, basis: 'unknown', eraFallback: false };

describe('the level cap (XP-2, XP-4; review SIM-01)', () => {
  const capped = context({ assumptions: { maxLevel: 20 } });

  it('a quest without an XP record at the cap gives a known 0 and leaves the level exact', () => {
    const result = walk([makeAcceptStep(ids, { questId: q(1) }), makeTurnInStep(ids, { questId: q(1) })], { character: { startLevel: 20 } }, capped);
    const turnIn = record(result, 1);
    expect(turnIn.estimate.xpGained).toEqual({ value: 0, basis: 'assumption', eraFallback: false });
    expect(turnIn.estimate.facts).toEqual([]);
    expect(turnIn.estimate.levelIsLowerBound).toBe(false);
    expect(result.final.unknownXpEvents).toBe(0);
  });

  it('a lower bound that reaches the effective cap is exact: the unknown-XP count resets', () => {
    const result = walk(
      [
        makeAcceptStep(ids, { questId: q(1) }),
        makeAcceptStep(ids, { questId: q(2) }),
        makeTurnInStep(ids, { questId: q(1) }),
        makeTurnInStep(ids, { questId: q(2) }),
        makeNoteStep(ids, { text: 'later' }),
      ],
      { character: { startLevel: 19, startXp: 21000 } },
      capped,
    );
    expect(record(result, 2).estimate.levelIsLowerBound).toBe(true);
    const capReached = record(result, 3);
    expect(capReached.estimate.levelAfter).toEqual({ value: 20, basis: 'assumption', eraFallback: true });
    expect(capReached.estimate).toMatchObject({ xpAfter: 0, levelIsLowerBound: false });
    expect(capReached.delta.unknownXpReset).toBe(true);
    expect(capReached.estimate.assumptionsUsed).toEqual(expect.arrayContaining(['maxLevel', 'xpToNextLevel']));
    expect(record(result, 4).estimate.levelIsLowerBound).toBe(false);
  });
});

describe('the provenance of levels (SIMULATION §8; review SIM-02)', () => {
  it('a forever-observed grant that crosses a level carries the XP table’s Era fallback and names it', () => {
    const result = walk([makeAcceptStep(ids, { questId: q(3) }), makeTurnInStep(ids, { questId: q(3) })], { character: { startLevel: 9, startXp: 6000 } });
    const turnIn = record(result, 1);
    expect(turnIn.estimate.xpGained).toEqual({ value: 840, basis: 'source', eraFallback: false });
    expect(turnIn.estimate.levelAfter).toEqual({ value: 10, basis: 'derived', eraFallback: true });
    expect(turnIn.estimate.assumptionsUsed).toContain('xpToNextLevel');
  });

  it('a grant bounded by a project cap is an assumption and names maxLevel (era-1.15)', () => {
    const result = walk(
      [makeAcceptStep(ids, { questId: q(4) }), makeTurnInStep(ids, { questId: q(4) })],
      { character: { startLevel: 19 } },
      context({ rulesetId: 'era-1.15', assumptions: { maxLevel: 20 } }),
    );
    const turnIn = record(result, 1);
    expect(turnIn.estimate.levelAfter).toEqual({ value: 20, basis: 'assumption', eraFallback: false });
    expect(turnIn.estimate.assumptionsUsed).toContain('maxLevel');
    expect(turnIn.estimate.assumptionsUsed).not.toContain('xpToNextLevel');
  });
});

describe('grind at 0 XP per hour (TIME-12; review SIM-04)', () => {
  it('a level target is unreachable: unknown time, the level unchanged', () => {
    const result = walk([makeGrindStep(ids, { until: { kind: 'level', level: 10, offset: null }, xpPerHour: 0 })], { character: { startLevel: 9 } });
    const grind = record(result, 0);
    expect(grind.estimate.duration).toEqual(UNKNOWN);
    expect(grind.estimate.facts).toEqual([{ kind: 'grind-zero-rate' }]);
    expect(grind.estimate.levelAfter.value).toBe(9);
  });

  it('a duration target still takes its time and grants 0 XP', () => {
    const result = walk([makeGrindStep(ids, { until: { kind: 'duration', seconds: 600 }, xpPerHour: 0 })], { character: { startLevel: 9 } });
    expect(record(result, 0).estimate.duration.value).toBe(600);
    expect(record(result, 0).estimate.xpGained.value).toBe(0);
  });
});

describe('duration overrides replace the facts about the work they replace (TIME-8, TIME-9; review SIM-05, ENG-04)', () => {
  it('a reputation objective priced by an override has no unknown-time fact', () => {
    const result = walk([makeAcceptStep(ids, { questId: q(12) }), makeCompleteStep(ids, { targets: [{ questId: q(12), objective: 0 }], durationOverride: 300 })]);
    const work = record(result, 1);
    expect(work.estimate.duration).toEqual({ value: 300, basis: 'assumption', eraFallback: false });
    expect(work.estimate.facts).toEqual([]);
    // Without the override the time is unknown and says why.
    const plain = walk([makeAcceptStep(ids, { questId: q(12) }), makeCompleteStep(ids, { targets: [{ questId: q(12), objective: 0 }] })]);
    expect(record(plain, 1).estimate.facts.map((fact) => fact.kind)).toEqual(['time-unknown']);
  });

  it('a grind priced by an override has no long-grind warning, and an unreachable one no unknown-time fact', () => {
    const long = walk([makeGrindStep(ids, { until: { kind: 'level', level: 6, offset: null }, durationOverride: 300 })], { character: { startLevel: 5 } });
    expect(record(long, 0).estimate.duration.value).toBe(300);
    expect(record(long, 0).estimate.facts).toEqual([]);
    const unreachable = walk([makeGrindStep(ids, { until: { kind: 'level', level: 70, offset: null }, durationOverride: 600 })], { character: { startLevel: 5 } });
    expect(record(unreachable, 0).estimate.duration.value).toBe(600);
    expect(record(unreachable, 0).estimate.facts).toEqual([]);
  });
});

describe('a complete step with a target that cannot be priced (TIME-10; review SIM-06, ENG-05)', () => {
  const accepts = [makeAcceptStep(ids, { questId: q(10) }), makeAcceptStep(ids, { questId: q(11) })];
  const both = [
    { questId: q(10), objective: 0 },
    { questId: q(11), objective: 0 },
  ];

  it('two priced kill targets alone: S = 360 s, f = 0.75, kill XP 1,140 (TIME-T 14)', () => {
    const result = walk([...accepts, makeCompleteStep(ids, { targets: both })], { character: { startLevel: 10 } });
    expect(record(result, 2).estimate.duration.value).toBe(360);
    expect(record(result, 2).estimate.xpGained.value).toBe(1140);
  });

  it.each([
    ['a quest the dataset does not know', { questId: q(999), objective: 0 }],
    ['an objective index the record does not have', { questId: q(10), objective: 5 }],
  ])('plus %s: S is unknown and kill XP is taken with f = 1, 2 × 760', (_name, extra) => {
    const result = walk([...accepts, makeCompleteStep(ids, { targets: [...both, extra] })], { character: { startLevel: 10 } });
    const work = record(result, 2);
    expect(work.estimate.duration).toEqual(UNKNOWN);
    expect(work.estimate.xpGained.value).toBe(1520);
    expect(work.delta.objectivesDone).toEqual([
      { questId: q(10), objective: 0 },
      { questId: q(11), objective: 0 },
    ]);
  });
});

describe('the hearth cooldown wait follows the route clock (TIME-4, TIME-13; review SIM-07, ENG-09)', () => {
  it('after a step with unknown time the wait is unknown, an upper bound; after the next cast it is known again', () => {
    const result = walk(
      [
        makeHearthStep(ids, { mode: 'bind', location: at(0) }),
        makeHearthStep(ids),
        makeTravelStep(ids, { location: at(100, 0, EASTERN_KINGDOMS) }),
        makeHearthStep(ids),
        makeNoteStep(ids, { text: 'wait', durationOverride: 100 }),
        makeHearthStep(ids),
      ],
    );
    const afterUnknown = record(result, 3);
    expect(afterUnknown.estimate.duration).toEqual(UNKNOWN);
    expect(afterUnknown.estimate.breakdown).toMatchObject({ waiting: 0, travel: 10 });
    expect(afterUnknown.estimate.facts).toEqual([{ kind: 'hearth-cooldown', waitSeconds: 3600, upperBound: true }]);
    expect(afterUnknown.estimate.endSec).toBe(afterUnknown.estimate.startSec + 10);
    const exact = record(result, 5);
    expect(exact.estimate.facts).toEqual([{ kind: 'hearth-cooldown', waitSeconds: 3500, upperBound: false }]);
    expect(exact.estimate.duration).toEqual({ value: 3510, basis: 'assumption', eraFallback: false });
  });

  it('with no step since the cast the wait is the cooldown alone: derived', () => {
    const result = walk([makeHearthStep(ids, { mode: 'bind', location: at(0) }), makeHearthStep(ids), makeHearthStep(ids)]);
    expect(record(result, 2).estimate.duration).toEqual({ value: 3610, basis: 'derived', eraFallback: false });
  });
});

describe('transports without positions (TIME-7; review SIM-08, ENG-07, ENG-08)', () => {
  it('a seeded transport whose docks have no position explains its unknown time with SIM-3', () => {
    const result = walk([makeTravelStep(ids, { mode: 'transport', location: at(100, 0, EASTERN_KINGDOMS) })], {}, context({ graph: { transports: TRANSPORT_SEEDS } }));
    expect(record(result, 0).estimate.duration).toEqual(UNKNOWN);
    expect(record(result, 0).estimate.facts.map((fact) => fact.kind)).toContain('unresolved-location');
  });

  it('a dock-only transport without a step location arrives somewhere unknown; the next move says so', () => {
    const result = walk([makeTravelStep(ids, { mode: 'transport', transport: { id: null, dock: at(70) } }), makeVendorStep(ids, { location: at(200) })]);
    expect(record(result, 0).estimate.duration.value).toBeCloseTo((70 * 1.25) / 7 + 120, 10);
    expect(record(result, 0).delta.locationAfter).toBeNull();
    expect(record(result, 1).estimate.facts).toEqual([{ kind: 'position-unknown', cause: 'transport-arrival' }]);
    expect(record(result, 1).estimate.duration).toEqual(UNKNOWN);
  });
});

describe('instance kills (KXP-5; review SIM-09)', () => {
  const dungeon = (raid: boolean) => ({ dungeonAreaId: areaId(1), name: 'Test instance', instanceMapId: TEST_INSTANCE, raid, entrances: [{ point: point(350), frameVerified: true }] });

  it('raid elites take ×2, five-player dungeon elites ×2.5', () => {
    const steps = [makeAcceptStep(ids, { questId: q(13) }), makeCompleteStep(ids, { targets: [{ questId: q(13), objective: 0 }], location: at(5, 5, TEST_INSTANCE) })];
    const raid = walk(steps, { character: { startLevel: 10 } }, context({ dungeons: [dungeon(true)] }));
    const five = walk(steps, { character: { startLevel: 10 } }, context({ dungeons: [dungeon(false)] }));
    expect(record(raid, 1).estimate.xpGained.value).toBe(8 * 190);
    expect(record(five, 1).estimate.xpGained.value).toBe(8 * 238);
  });

  it('a grind on an instance map kills dungeon mobs: dungeonMobXpMultiplier applies', () => {
    const base = context({ dungeons: [dungeon(false)] });
    const halved: EngineContext = { ...base, rules: { ...base.rules, values: { ...base.rules.values, dungeonMobXpMultiplier: { ...base.rules.values.dungeonMobXpMultiplier, value: 0.5 } } } };
    const steps = [makeGrindStep(ids, { until: { kind: 'duration', seconds: 300 }, location: at(5, 5, TEST_INSTANCE) })];
    const outside = [makeGrindStep(ids, { until: { kind: 'duration', seconds: 300 }, location: at(700) })];
    expect(record(walk(steps, { character: { startLevel: 10 } }, halved), 0).estimate.xpGained.value).toBe(10 * 48);
    expect(record(walk(outside, { character: { startLevel: 10 } }, halved), 0).estimate.xpGained.value).toBe(10 * 95);
  });
});

describe('local taxi legs for dataset flight masters (TIME-6; review SIM-10)', () => {
  const LOCAL: LocalTaxiData = {
    build: 'test',
    nodes: [
      { id: 7, point: point(3, 4) },
      { id: 8, point: point(6010) },
      { id: 9, point: point(3000, 2010) },
      { id: 10, point: point(3000, -2010) },
    ],
    legs: [
      { from: 7, to: 8, l3dYards: 9000 },
      { from: 7, to: 9, l3dYards: 3000 },
      { from: 9, to: 8, l3dYards: 3000 },
      { from: 7, to: 10, l3dYards: 2000 },
      { from: 10, to: 8, l3dYards: 2000 },
    ],
  };
  const ref = (id: number) => ({ npcId: npcId(id), taxiNodeId: null, name: null });
  const fly = (known: readonly number[]): number | null => {
    const ctx: EngineContext = { ...context(), localTaxi: LOCAL };
    const result = walk([makeFlightStep(ids, { to: ref(61) })], { character: { knownFlightPaths: known.map(ref) } }, ctx);
    return record(result, 0).estimate.breakdown.travel;
  };

  it('maps each flight master to its nearest TaxiNodes row and routes through known nodes of the faction', () => {
    // Through node 62 (known, Horde): 6,000 yd at 32 yd/s. Node 63 (Alliance) is never an intermediate.
    expect(fly([60, 61, 62, 63])).toBeCloseTo(6000 / 32, 10);
    // Node 62 unknown: the direct leg, 9,000 yd.
    expect(fly([60, 61, 63])).toBeCloseTo(9000 / 32, 10);
  });
});

describe('unknown positions say why (TIME-2; review ENG-02, ENG-03, UI-16)', () => {
  it('an unset or unresolvable start: the first move is unknown with its cause', () => {
    const unset = walk([makeVendorStep(ids, { location: at(100) })], { character: { startLocation: null } });
    expect(record(unset, 0).estimate.facts).toEqual([{ kind: 'position-unknown', cause: 'start-unset' }]);
    const nowhere = { source: zoneSourcedPoint(uiMapId(99999), 50, 50), label: null, radius: null };
    const unresolved = walk([makeVendorStep(ids, { location: at(100) })], { character: { startLocation: nowhere } });
    expect(record(unresolved, 0).estimate.facts).toEqual([{ kind: 'position-unknown', cause: 'start-unresolved' }]);
  });

  it('from an unknown position, an entity with several spawns leaves the position unknown', () => {
    const result = walk([makeAcceptStep(ids, { questId: q(300) }), makeVendorStep(ids, { location: at(1000) })], { character: { startLocation: null } });
    expect(record(result, 0).delta.locationAfter).toBeNull();
    expect(record(result, 1).estimate.duration).toEqual(UNKNOWN);
    expect(record(result, 1).estimate.facts).toEqual([{ kind: 'position-unknown', cause: 'several-spawns' }]);
    // From a known position the nearest spawn is used, as before.
    const known = walk([makeAcceptStep(ids, { questId: q(300) }), makeVendorStep(ids, { location: at(1000) })], { character: { startLocation: at(900) } });
    expect(record(known, 0).delta.locationAfter).toEqual(point(1100));
  });
});

describe('start XP beyond the start level (SIMULATION §7.1; review ENG-11)', () => {
  it('is carried over by XP-2: level 5 with 50,000 XP starts at level 13 with 700 XP (4,800 + 50,000 − 54,100)', () => {
    const result = walk([makeNoteStep(ids, { text: 'start' })], { character: { startLevel: 5, startXp: 50000 } });
    expect(record(result, 0).delta.levelBefore).toBe(13);
    expect(record(result, 0).estimate).toMatchObject({ xpAfter: 700, levelAfter: { value: 13, basis: 'derived', eraFallback: true } });
  });
});

describe('shared caches and incremental metrics (review PERF-05..07)', () => {
  const route = (count: number): RouteStep[] => {
    const steps: RouteStep[] = [];
    for (let i = 0; steps.length < count; i += 1) {
      steps.push(makeAcceptStep(ids, { questId: q(10) }), makeCompleteStep(ids, { targets: [{ questId: q(10), objective: 0 }], location: at(100 + (i % 7) * 50) }));
      steps.push(makeTurnInStep(ids, { questId: q(10) }), makeHearthStep(ids, { mode: i % 5 === 0 ? 'bind' : 'use', location: at(i % 3) }));
    }
    return steps.slice(0, count);
  };

  it('walkMetrics after a re-walk from a checkpoint equals the full sum over the estimates', () => {
    const steps = route(700);
    const walker = createRouteWalker(context());
    const project = fixtureProject(steps, { character: { startLevel: 5 } });
    const first = walker.walk(project);
    expect(walkMetrics(first)).toEqual(aggregateRouteMetrics(first.estimates, { level: 5 }));
    for (const index of [600, 699, 257, 0]) {
      const edited = [...steps];
      const original = steps[index];
      if (original === undefined) throw new Error('fixture');
      edited[index] = makeNoteStep(ids, { text: `edit ${String(index)}`, durationOverride: 17 });
      const again = walker.walk({ ...project, route: { ...project.route, steps: edited } });
      expect(walkMetrics(again)).toEqual(aggregateRouteMetrics(again.estimates, { level: 5 }));
      // The previous walk's metrics are still its own.
      expect(walkMetrics(first)).toEqual(aggregateRouteMetrics(first.estimates, { level: 5 }));
    }
  });

  it('walkers of one (rules, dataset) pair share their pure caches and agree with a cold walker', () => {
    const ctx = context();
    expect(sharedSimCache(ctx.rules, ctx.dataset)).toBe(sharedSimCache(ctx.rules, ctx.dataset));
    expect(sharedSimCache({ ...ctx.rules }, ctx.dataset)).not.toBe(sharedSimCache(ctx.rules, ctx.dataset));
    const project = fixtureProject(route(300), { character: { startLevel: 5 } });
    const warm = createRouteWalker(ctx);
    warm.walk(project);
    const shared = createRouteWalker(ctx).walk(project);
    const cold = createRouteWalker({ ...ctx, rules: { ...ctx.rules } }).walk(project);
    expect(shared.estimates).toEqual(cold.estimates);
  });
});

describe('checkpoints keep one state shape (review PERF-08)', () => {
  it('a restored state has the property order of the initial state and of a clone', () => {
    const ctx = context();
    const places = createPlaces(ctx);
    const initial = createInitialState(fixtureProject([]).character, { ...ctx, places });
    const restored = restoreCheckpoint(checkpointOf(initial), initial);
    expect(Object.keys(restored.state)).toEqual(Object.keys(initial.state));
    expect(Object.keys(cloneState(initial.state))).toEqual(Object.keys(initial.state));
    const walker = createRouteWalker(ctx);
    walker.walk(fixtureProject([makeNoteStep(ids, { text: 'a' }), makeNoteStep(ids, { text: 'b' })]));
    expect(Object.keys(walker.stateBefore(1))).toEqual(Object.keys(initial.state));
  });
});
