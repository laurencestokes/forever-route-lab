import { describe, expect, it } from 'vitest';
import { estimate } from '../domain/estimate';
import { areaId, npcId, questId, skillId, spellId, uiMapId, worldMapId } from '../domain/ids';
import { zoneSourcedPoint } from '../domain/points';
import type { RouteStep } from '../domain/route';
import {
  makeAbandonStep,
  makeAcceptStep,
  makeCompleteStep,
  makeFlightStep,
  makeGrindStep,
  makeHearthStep,
  makeNoteStep,
  makeTrainStep,
  makeTravelStep,
  makeTurnInStep,
  makeVendorStep,
} from '../domain/step-factory';
import type { TravelLeg, TravelModel } from '../domain/travel';
import type { TransportSeed } from '../rules/travel-seeds';
import type { SimFact } from '../sim/facts';
import { enumerateLegs, legPairKey } from './legs';
import {
  at,
  EASTERN_KINGDOMS,
  fixtureContext,
  type FixtureContextOptions,
  fixtureDataset,
  fixtureProject,
  itemObjective,
  itemRecord,
  KALIMDOR,
  killObjective,
  npcRecord,
  point,
  questRecord,
  rxpGroup,
  spawnAt,
  TEST_INSTANCE,
  testIds,
} from './test-helpers';
import type { RouteWalk, StepRecord, WalkProject, WalkVisitor } from './types';
import { CHECKPOINT_INTERVAL, createRouteWalker, walkMetrics, walkRoute } from './walker';

/**
 * The route walker (docs/ARCHITECTURE.md §9.2) on synthetic routes: every step kind, checkpoints
 * and re-walks, conditions, hearth cooldowns, multi-target work, unknown XP and prior history,
 * pending legs, leg enumeration, and the TIME-T rows that need the walker (docs/SIMULATION.md §6.9).
 * Record numbers are made up for the tests.
 */

const q = questId;
const ids = testIds();

const DATA = fixtureDataset({
  quests: [
    questRecord(100, { objectives: [killObjective(1)], starters: [{ kind: 'npc', id: npcId(10) }], finishers: [{ kind: 'npc', id: npcId(10) }] }),
    questRecord(101, { objectives: [killObjective(1)], starters: [{ kind: 'npc', id: npcId(10) }], finishers: [{ kind: 'npc', id: npcId(10) }] }),
    questRecord(102, { objectives: [itemObjective(500)] }),
    questRecord(103, { objectives: [killObjective(1), killObjective(1)], reputationReward: [{ factionId: 76 as never, value: 250 }] }),
    questRecord(200, { xp: null }),
    questRecord(201, { xp: { questLevel: 10, baseXp: 840, basis: 'era-seed' } }),
    questRecord(202, { minLevel: 8 }),
    questRecord(300, { starters: [{ kind: 'npc', id: npcId(11) }] }),
    questRecord(301, { starters: [{ kind: 'npc', id: npcId(12) }] }),
  ],
  npcs: [
    npcRecord(1),
    npcRecord(10),
    npcRecord(11),
    npcRecord(12),
    npcRecord(60, { npcFlags: 8, friendlyTo: 'H' }),
    npcRecord(61, { npcFlags: 8, friendlyTo: 'H' }),
    npcRecord(50),
    npcRecord(51),
  ],
  items: [itemRecord(500, [1])],
  spawns: {
    'npc:10': [spawnAt(point(100))],
    'npc:11': [spawnAt(point(5000)), spawnAt(point(1100))],
    'npc:12': [spawnAt(null)],
    'npc:60': [spawnAt(point(0))],
    'npc:61': [spawnAt(point(3200))],
    'npc:50': [spawnAt(point(100))],
    'npc:51': [spawnAt(point(0, 0, EASTERN_KINGDOMS))],
  },
});

const BOAT: TransportSeed = {
  id: 'test-boat',
  name: 'Test boat',
  stops: [
    { name: 'Kalimdor dock', mapId: KALIMDOR, dockNpcIds: [npcId(50)] },
    { name: 'Eastern Kingdoms dock', mapId: EASTERN_KINGDOMS, dockNpcIds: [npcId(51)] },
  ],
  factions: ['Alliance'],
  basis: 'assumption',
  source: 'test',
};

const DUNGEON = { dungeonAreaId: areaId(1), name: 'Test dungeon', instanceMapId: TEST_INSTANCE, entrances: [{ point: point(350), frameVerified: true }] };

const context = (options: FixtureContextOptions = {}) =>
  fixtureContext(DATA, { flightMasterIds: [60, 61], dungeons: [DUNGEON], graph: { transports: [BOAT] }, ...options });

const walk = (steps: readonly RouteStep[], options: Parameters<typeof fixtureProject>[1] = {}, ctx = context()): RouteWalk => walkRoute(fixtureProject(steps, options), ctx);
const factKinds = (record: StepRecord | undefined): SimFact['kind'][] => record?.estimate.facts.map((fact) => fact.kind) ?? [];
const record = (result: RouteWalk, index: number): StepRecord => {
  const found = result.records[index];
  if (found === undefined) throw new Error(`no record ${String(index)}`);
  return found;
};
const seconds = (result: RouteWalk, index: number): number | null => record(result, index).estimate.duration.value;

describe('movement and places (TIME-2, TIME-7)', () => {
  it('TIME-T 1: a located step 700 yd away on foot costs 125 s, basis assumption with the Era fallback', () => {
    const result = walk([makeTravelStep(ids, { location: at(700) })]);
    expect(record(result, 0).estimate.duration).toEqual({ value: 125, basis: 'assumption', eraFallback: true });
    expect(record(result, 0).estimate.assumptionsUsed).toEqual(['runSpeed', 'groundDetourFactor']);
    expect(record(result, 0).legs).toHaveLength(1);
    expect(result.final.location).toEqual(point(700));
  });

  it('TIME-T 25: declared riding tier 1 at level 45 rides 700 yd in 78.125 s', () => {
    const result = walk([makeVendorStep(ids, { location: at(700) })], { character: { riding: 1, startLevel: 45 } });
    expect(record(result, 0).estimate.breakdown.travel).toBeCloseTo(78.125, 10);
  });

  it('an arrival radius shortens the move', () => {
    const result = walk([makeTravelStep(ids, { location: at(714, 0, KALIMDOR, 14) })]);
    expect(seconds(result, 0)).toBeCloseTo(125, 10);
  });

  it('an unresolved location reports SIM-3 once and makes travel unknown, never zero; the next located step re-anchors', () => {
    const nowhere = { source: zoneSourcedPoint(uiMapId(99999), 50, 50), label: null, radius: null };
    const result = walk([makeVendorStep(ids, { location: nowhere }), makeVendorStep(ids, { location: at(200) }), makeVendorStep(ids, { location: at(270) })]);
    expect(factKinds(record(result, 0))).toEqual(['unresolved-location']);
    expect(record(result, 0).estimate.duration).toEqual({ value: null, basis: 'unknown', eraFallback: false });
    expect(record(result, 0).estimate.breakdown.interaction).toBe(10);
    expect(record(result, 0).delta.locationAfter).toBeNull();
    // The next move starts from an unknown position: no issue, but a fact saying why (TIME-2).
    expect(record(result, 1).estimate.facts).toEqual([{ kind: 'position-unknown', cause: 'unresolved' }]);
    expect(seconds(result, 1)).toBeNull();
    expect(record(result, 1).delta.locationAfter).toEqual(point(200));
    expect(seconds(result, 2)).toBeCloseTo(10 + (70 * 1.25) / 7, 10);
  });

  it('a zone point resolves through src/geo with the injected geometry', () => {
    const durotar = { source: zoneSourcedPoint(uiMapId(1411), 50, 50), label: null, radius: null };
    const result = walk([makeVendorStep(ids, { location: durotar })], { character: { startLocation: durotar } });
    expect(result.final.location?.mapId).toBe(KALIMDOR);
    expect(record(result, 0).estimate.breakdown.travel).toBe(0);
  });

  it('TIME-T 11: a move between world maps without a transport is unknown with SIM-4', () => {
    const result = walk([makeVendorStep(ids, { location: at(0, 0, EASTERN_KINGDOMS) })]);
    expect(record(result, 0).estimate.facts).toContainEqual({ kind: 'cross-world-no-transport', fromMapId: KALIMDOR, toMapId: EASTERN_KINGDOMS });
    expect(seconds(result, 0)).toBeNull();
    expect(result.final.location).toEqual(point(0, 0, EASTERN_KINGDOMS));
  });

  it('TIME-T 30: a step inside an instance walks 350 yd to the entrance (62.5 s), then 0 s inside; leaving uses that entrance', () => {
    const result = walk([makeVendorStep(ids, { location: at(5, 5, TEST_INSTANCE) }), makeVendorStep(ids, { location: at(1050) })]);
    const inside = record(result, 0);
    expect(inside.estimate.breakdown.travel).toBe(62.5);
    expect(inside.estimate.duration.basis).toBe('assumption');
    expect(factKinds(inside)).toEqual([]);
    expect(inside.legs.map((leg) => leg.purpose)).toEqual(['entrance']);
    const outside = record(result, 1);
    expect(outside.estimate.breakdown.travel).toBeCloseTo((700 * 1.25) / 7, 10);
    expect(outside.legs[0]?.from.point).toEqual(point(350));
  });

  it('a quest step without a location goes to its only starter’s nearest spawn; ties and misses follow TIME-2', () => {
    const result = walk(
      [makeTravelStep(ids, { location: at(1000) }), makeAcceptStep(ids, { questId: q(300) }), makeAcceptStep(ids, { questId: q(301) }), makeAcceptStep(ids, { questId: q(201) })],
      { character: { priorHistory: 'fresh' } },
    );
    expect(record(result, 1).delta.locationAfter).toEqual(point(1100));
    expect(factKinds(record(result, 2))).toEqual(['unresolved-location']);
    expect(record(result, 2).delta.locationAfter).toBeNull();
    // Quest 201 names no entity: no travel, the position is unchanged.
    expect(record(result, 3).estimate.breakdown.travel).toBe(0);
    expect(record(result, 3).delta.locationAfter).toBeNull();
  });

  it('TIME-T 10: a transport 100 yd from its dock costs 100 × 1.25 / 7 + 60 + 60 s, 60 s of it waiting', () => {
    const result = walk([makeTravelStep(ids, { mode: 'transport', transport: { id: 'test-boat', dock: null }, location: at(0, 0, EASTERN_KINGDOMS) })]);
    const crossing = record(result, 0);
    expect(crossing.estimate.duration.value).toBeCloseTo((100 * 1.25) / 7 + 120, 10);
    expect(crossing.estimate.breakdown.waiting).toBe(60);
    expect(crossing.legs.map((leg) => leg.purpose)).toEqual(['dock']);
    expect(crossing.estimate.facts).toContainEqual({ kind: 'transport-faction', transportId: 'test-boat' });
    expect(result.final.location).toEqual(point(0, 0, EASTERN_KINGDOMS));
  });

  it('a transport step without a record picks the quickest edge between the maps; a dock without a record uses the defaults', () => {
    const picked = walk([makeTravelStep(ids, { mode: 'transport', location: at(40, 30, EASTERN_KINGDOMS) })]);
    expect(record(picked, 0).estimate.duration.value).toBeCloseTo((100 * 1.25) / 7 + 120 + (50 * 1.25) / 7, 10);
    expect(record(picked, 0).legs.map((leg) => leg.purpose)).toEqual(['dock', 'step']);
    const userDock = walk([makeTravelStep(ids, { mode: 'transport', transport: { id: null, dock: at(70) }, location: at(9, 9, EASTERN_KINGDOMS) })]);
    expect(record(userDock, 0).estimate.duration.value).toBeCloseTo(12.5 + 120, 10);
    expect(userDock.final.location).toEqual(point(9, 9, EASTERN_KINGDOMS));
    const none = walk([makeTravelStep(ids, { mode: 'transport', transport: { id: 'no-such-boat', dock: null }, location: at(9, 9, EASTERN_KINGDOMS) })]);
    expect(factKinds(record(none, 0))).toEqual(['cross-world-no-transport']);
  });

  it('a travel step without a location, and a death skip, make the position unknown without SIM-3', () => {
    const deathskip = makeNoteStep(ids, { text: '.deathskip', preserved: { format: 'rxp', lines: ['    .deathskip >>Die'] } });
    const result = walk([makeTravelStep(ids, { location: null }), makeVendorStep(ids, { location: at(10) }), deathskip, makeVendorStep(ids, { location: at(10) })]);
    expect(factKinds(record(result, 0))).toEqual([]);
    expect(seconds(result, 0)).toBeNull();
    expect(record(result, 0).delta.locationAfter).toBeNull();
    expect(record(result, 2).delta.locationAfter).toBeNull();
    expect(factKinds(record(result, 2))).toEqual([]);
    expect(seconds(result, 3)).toBeNull();
    expect(record(result, 3).delta.locationAfter).toEqual(point(10));
  });

  it('a group’s leg waypoints are walked, in order, before its first located step only', () => {
    const group = rxpGroup('g1', {
      waypoints: [
        { point: at(100).source, role: 'leg', radius: null, filter: null, line: null },
        { point: at(9999).source, role: 'pin', radius: null, filter: null, line: null },
        { point: at(150, 50).source, role: 'leg', radius: 5, filter: null, line: null },
        { point: at(7777).source, role: 'leg', radius: null, filter: { kind: 'word', word: 'Mage' }, line: null },
      ],
    });
    const result = walk(
      [makeVendorStep(ids, { location: at(200), groupId: group.id }), makeVendorStep(ids, { location: at(200), groupId: group.id })],
      { groups: [group] },
    );
    expect(record(result, 0).legs.map((leg) => [leg.purpose, leg.to.point.x])).toEqual([
      ['waypoint', 100],
      ['waypoint', 150],
      ['step', 200],
    ]);
    expect(record(result, 1).legs).toEqual([]);
    const skyborne = walk([makeVendorStep(ids, { location: at(200), groupId: group.id })], { groups: [group], character: { faction: 'Horde', race: 'WindshaperSkyborne' } });
    expect(record(skyborne, 0).legs.map((leg) => leg.to.point.x)).toEqual([100, 150, 200]);
    const troll = rxpGroup('g1t', { waypoints: [{ point: at(7777).source, role: 'leg', radius: null, filter: { kind: 'word', word: 'Troll' }, line: null }] });
    const unknown = walk([makeVendorStep(ids, { location: at(200), groupId: troll.id })], { groups: [troll], character: { faction: 'Horde', race: 'WindshaperSkyborne' } });
    expect(record(unknown, 0).legs.map((leg) => leg.to.point.x)).toEqual([7777, 200]);
    expect(factKinds(record(unknown, 0))).toEqual(['condition-unknown']);
  });

  it('pending navigation legs pass through with their warnings (TIME-2)', () => {
    const pendingModel: TravelModel = {
      id: 'navigation',
      revision: 'nav-test',
      leg: (): TravelLeg => ({ seconds: estimate(10, 'derived'), method: 'navigation', pending: true, warnings: [{ kind: 'long-swim', longestSwimYd: 250 }] }),
      path: () => null,
    };
    const result = walk([makeTravelStep(ids, { location: at(700) })], {}, context({ travel: pendingModel }));
    const leg = record(result, 0).legs[0];
    expect(leg).toMatchObject({ method: 'navigation', pending: true, warnings: [{ kind: 'long-swim', longestSwimYd: 250 }] });
    expect(record(result, 0).estimate.facts).toEqual([{ kind: 'travel-warning', warning: { kind: 'long-swim', longestSwimYd: 250 } }, { kind: 'pending-leg' }]);
    expect(record(result, 0).estimate.assumptionsUsed).toEqual(['runSpeed', 'swimSpeed']);
    expect(walkMetrics(result).pendingLegs).toBe(1);
  });
});

describe('quest steps, XP and objective work (TIME-8..TIME-11, XP-4)', () => {
  it('accepts at one NPC form a visit: 3 s first, 2 s for each further accept', () => {
    const result = walk([makeAcceptStep(ids, { questId: q(100) }), makeAcceptStep(ids, { questId: q(101) }), makeAcceptStep(ids, { questId: q(201), via: { kind: 'npc', id: npcId(10) } })]);
    expect(record(result, 0).estimate.breakdown).toMatchObject({ interaction: 3, travel: (100 * 1.25) / 7 });
    expect(record(result, 1).estimate.breakdown).toEqual({ travel: 0, combat: 0, interaction: 2, objective: 0, waiting: 0 });
    expect(record(result, 2).estimate.breakdown.interaction).toBe(2);
    expect([...result.final.questLog.keys()]).toEqual([q(100), q(101), q(201)]);
    expect(record(result, 0).delta).toMatchObject({ questId: q(100), accepted: q(100) });
  });

  it('TIME-T 12, 14 and turn-in: one work block for two kill targets (360 s, 1,140 XP), then 850 quest XP', () => {
    const result = walk([
      makeAcceptStep(ids, { questId: q(100) }),
      makeAcceptStep(ids, { questId: q(101) }),
      makeCompleteStep(ids, { targets: [{ questId: q(100), objective: 0 }, { questId: q(101), objective: null }] }),
      makeTurnInStep(ids, { questId: q(100) }),
    ], { character: { startLevel: 10 } });
    const work = record(result, 2);
    expect(work.estimate.breakdown.objective).toBe(360);
    expect(work.estimate.xpGained).toEqual({ value: 1140, basis: 'assumption', eraFallback: true });
    expect(work.delta.objectivesDone).toEqual([{ questId: q(100), objective: 0 }, { questId: q(101), objective: 0 }]);
    const turnIn = record(result, 3);
    expect(turnIn.estimate.xpGained).toEqual({ value: 850, basis: 'assumption', eraFallback: true });
    expect(turnIn.estimate.xpAfter).toBe(1990);
    expect(turnIn.estimate.levelAfter).toEqual({ value: 10, basis: 'assumption', eraFallback: true });
    expect(result.final.completed.has(q(100))).toBe(true);
    expect(result.final.questLog.has(q(100))).toBe(false);
  });

  it('TIME-T 15, 16 and SIM-12/16: mixed targets, a partial step, an already-done target and a quest not in the log', () => {
    const result = walk([
      makeAcceptStep(ids, { questId: q(100) }),
      makeAcceptStep(ids, { questId: q(102), via: { kind: 'npc', id: npcId(10) } }),
      makeCompleteStep(ids, { targets: [{ questId: q(100), objective: 0 }], progress: 'partial' }),
      makeCompleteStep(ids, { targets: [{ questId: q(100), objective: 0 }, { questId: q(102), objective: 0 }] }),
      makeCompleteStep(ids, { targets: [{ questId: q(100), objective: 0 }, { questId: q(101), objective: 0 }] }),
    ], { character: { startLevel: 10 } });
    expect(record(result, 2).estimate.breakdown.objective).toBe(0);
    expect(record(result, 2).estimate.xpGained.value).toBe(0);
    expect(record(result, 2).delta.objectivesDone).toEqual([]);
    expect(record(result, 3).estimate.breakdown.objective).toBe(440);
    expect(record(result, 3).estimate.xpGained.value).toBe(1343);
    expect(record(result, 4).estimate.facts).toEqual([
      { kind: 'complete-not-in-log', questId: q(101) },
      { kind: 'objective-already-done', questId: q(100), objective: 0 },
    ]);
    expect(record(result, 4).estimate.breakdown.objective).toBe(240);
    expect(record(result, 4).delta.objectivesDone).toEqual([]);
  });

  it('TIME-T 17 (D-040): a turn-in carries the work of objectives no step finishes', () => {
    const result = walk([makeAcceptStep(ids, { questId: q(103) }), makeTurnInStep(ids, { questId: q(103), rewardIndex: 2 })], { character: { startLevel: 10 } });
    const turnIn = record(result, 1);
    expect(turnIn.estimate.facts).toContainEqual({
      kind: 'objectives-carried',
      questId: q(103),
      objectives: [0, 1],
      time: 'counted',
      killXp: { value: 1140, basis: 'assumption', eraFallback: true },
      level: 10,
      levelBasis: 'assumption',
      levelEraFallback: true,
    });
    expect(turnIn.estimate.breakdown.interaction).toBe(5);
    expect(turnIn.estimate.breakdown.objective).toBe(360);
    expect(turnIn.estimate.xpGained.value).toBe(1140 + 850);
    expect(turnIn.delta.turnedIn).toBe(q(103));
    expect(result.final.reputationDelta.get(76)).toBe(250);
  });

  it('TIME-T 18, 19, 21: unknown XP makes levels lower bounds; a grind to a level makes them known again', () => {
    const result = walk(
      [
        makeAcceptStep(ids, { questId: q(200) }),
        makeAcceptStep(ids, { questId: q(201) }),
        makeTurnInStep(ids, { questId: q(200) }),
        makeTurnInStep(ids, { questId: q(201) }),
        makeGrindStep(ids, { until: { kind: 'level', level: 6, offset: null } }),
      ],
      { character: { startLevel: 5, startXp: 0 } },
    );
    const unknown = record(result, 2);
    expect(unknown.estimate.xpGained).toEqual({ value: null, basis: 'unknown', eraFallback: false });
    expect(unknown.estimate.facts).toContainEqual({ kind: 'unknown-xp', questId: q(200), reason: 'no-record' });
    expect(unknown.estimate).toMatchObject({ xpAfter: 0, levelIsLowerBound: true });
    expect(unknown.estimate.levelAfter.value).toBe(5);
    const known = record(result, 3);
    expect(known.estimate).toMatchObject({ xpAfter: 850, levelIsLowerBound: true });
    const grind = record(result, 4);
    expect(grind.estimate.breakdown.combat).toBe(840);
    expect(grind.estimate).toMatchObject({ xpAfter: 10, levelIsLowerBound: false });
    expect(grind.estimate.levelAfter.value).toBe(6);
    expect(grind.delta.unknownXpReset).toBe(true);
    expect(grind.estimate.facts).toEqual([{ kind: 'grind-upper-bound' }, { kind: 'target-level-late', seconds: 840, uncertain: true }]);
    expect(result.final.unknownXpEvents).toBe(0);
  });

  it('an any-of accept takes the first acceptable candidate (TIME-T 32); an any-of turn-in the first in the log', () => {
    const result = walk(
      [makeAcceptStep(ids, { questId: q(202), anyOf: [q(202), q(201)] }), makeTurnInStep(ids, { questId: q(202), anyOf: [q(202), q(201)] })],
      { character: { startLevel: 5 } },
    );
    expect(record(result, 0).delta).toMatchObject({ questId: q(201), accepted: q(201) });
    expect(record(result, 1).delta).toMatchObject({ questId: q(201), turnedIn: q(201) });
  });

  it('abandon and skip-if-missing turn-ins', () => {
    const result = walk([
      makeAcceptStep(ids, { questId: q(201) }),
      makeAbandonStep(ids, { questId: q(201) }),
      makeTurnInStep(ids, { questId: q(201), skipIfMissing: true }),
      makeTurnInStep(ids, { questId: q(201) }),
    ]);
    expect(record(result, 1).delta.abandoned).toBe(q(201));
    expect(result.final.abandoned.has(q(201))).toBe(true);
    expect(record(result, 2).delta.skipped).toBe('skip-if-missing');
    expect(record(result, 2).estimate.active).toBe(false);
    expect(record(result, 3).delta.turnedIn).toBeNull();
    expect(record(result, 3).estimate.xpGained.value).toBe(0);
  });
});

describe('prior history (ARCHITECTURE §9.2, §9.4; SIMULATION §7.1)', () => {
  it('seeds the log and completed set; a pre-route log entry has every objective open', () => {
    const result = walk([makeTurnInStep(ids, { questId: q(103) })], { character: { priorHistory: 'listed', priorQuestLog: [q(103)], priorCompletedQuests: [q(100)] } });
    expect(record(result, 0).delta.turnedIn).toBe(q(103));
    expect(record(result, 0).delta.assumedInLog).toEqual([]);
    expect(factKinds(record(result, 0))).toContain('objectives-incidental');
    expect(result.final.completed.has(q(100))).toBe(true);
  });

  it('with an unknown history, a quest the route never accepted is assumed to have been in the log', () => {
    const steps = [makeCompleteStep(ids, { targets: [{ questId: q(101), objective: 0 }] }), makeTurnInStep(ids, { questId: q(201) }), makeAbandonStep(ids, { questId: q(100) })];
    const unknown = walk(steps, { character: { priorHistory: 'unknown', startLevel: 10 } });
    expect(record(unknown, 0).delta.assumedInLog).toEqual([q(101)]);
    expect(factKinds(record(unknown, 0))).not.toContain('complete-not-in-log');
    expect(record(unknown, 1).delta).toMatchObject({ assumedInLog: [q(201)], turnedIn: q(201) });
    expect(record(unknown, 1).estimate.xpGained.value).toBe(850);
    expect(record(unknown, 2).delta).toMatchObject({ assumedInLog: [q(100)], abandoned: q(100) });
    const listed = walk(steps, { character: { priorHistory: 'listed', startLevel: 10 } });
    expect(factKinds(record(listed, 0))).toContain('complete-not-in-log');
    expect(record(listed, 1).delta).toMatchObject({ assumedInLog: [], turnedIn: null });
    expect(record(listed, 2).delta.abandoned).toBeNull();
  });
});

describe('conditions (ARCHITECTURE §9.2; RXP.md §14 rows 5-6)', () => {
  it('an unknown token keeps the step active with SIM-13; a failing filter makes it inactive', () => {
    const skyborne = rxpGroup('sky', { condition: { filter: { kind: 'word', word: 'Skyborne' }, variant: null, skipIf: [] } });
    const mageOnly = rxpGroup('mage', { condition: { filter: { kind: 'word', word: 'Mage' }, variant: null, skipIf: [] } });
    const steps = [
      makeVendorStep(ids, { location: at(70), groupId: skyborne.id }),
      makeNoteStep(ids, { text: 'x', groupId: skyborne.id }),
      makeVendorStep(ids, { location: at(700), groupId: mageOnly.id }),
    ];
    const result = walk(steps, { character: { faction: 'Alliance', race: 'HighOrderSkyborne' }, groups: [skyborne, mageOnly] });
    expect(record(result, 0).estimate.active).toBe('unknown');
    expect(factKinds(record(result, 0))).toEqual(['condition-unknown']);
    expect(factKinds(record(result, 1))).toEqual(['condition-unknown']);
    expect(record(result, 2).estimate).toMatchObject({ active: false, duration: { value: 0 } });
    expect(record(result, 2).delta.skipped).toBe('condition');
    expect(result.final.location).toEqual(point(70));
  });

  it('a group’s skip predicates are decided once, at its first step', () => {
    const group = rxpGroup('g', { condition: { filter: null, variant: null, skipIf: [{ kind: 'questState', state: 'onQuest', questIds: [q(201)], match: 'any', negate: false }] } });
    const result = walk(
      [makeNoteStep(ids, { text: 'a', groupId: group.id }), makeAcceptStep(ids, { questId: q(201), groupId: group.id }), makeNoteStep(ids, { text: 'b', groupId: group.id })],
      { groups: [group] },
    );
    expect(result.estimates.map((e) => e.active)).toEqual([true, true, true]);
    const skipped = walk([makeAcceptStep(ids, { questId: q(201) }), makeNoteStep(ids, { text: 'a', groupId: group.id })], { groups: [group] });
    expect(record(skipped, 1).estimate.active).toBe(false);
  });

  it('variant entries read the route profile; an opaque skip keeps the step active with SIM-13', () => {
    const variant = rxpGroup('v', { condition: { filter: null, variant: [{ name: 'xprate', value: '<1.5', filter: null }], skipIf: [] } });
    const opaque = rxpGroup('o', { condition: { filter: null, variant: null, skipIf: [{ kind: 'opaque', raw: '.money <5' }] } });
    const steps = [makeNoteStep(ids, { text: 'v', groupId: variant.id }), makeNoteStep(ids, { text: 'o', groupId: opaque.id })];
    const slow = walk(steps, { groups: [variant, opaque] });
    expect(slow.estimates.map((e) => e.active)).toEqual([true, 'unknown']);
    const fast = walk(steps, { groups: [variant, opaque], routeProfile: { xpRate: 2 } });
    expect(fast.estimates.map((e) => e.active)).toEqual([false, 'unknown']);
  });
});

describe('hearth, flights, training (TIME-3..TIME-5)', () => {
  it('TIME-T 8, 9: a hearth ready at t = 0 casts 10 s; a second at t = 1,800 waits 1,810 s', () => {
    const result = walk(
      [makeHearthStep(ids), makeNoteStep(ids, { text: 'wait', durationOverride: 1790 }), makeHearthStep(ids)],
      { character: { hearthLocation: at(900) } },
    );
    expect(record(result, 0).estimate).toMatchObject({ startSec: 0, endSec: 10, breakdown: { travel: 10, waiting: 0 } });
    expect(record(result, 0).delta.locationAfter).toEqual(point(900));
    const second = record(result, 2);
    expect(second.estimate).toMatchObject({ startSec: 1800, endSec: 3620, breakdown: { travel: 10, waiting: 1810 } });
    expect(second.estimate.facts).toEqual([{ kind: 'hearth-cooldown', waitSeconds: 1810, upperBound: false }]);
    // The wait is the cooldown less the time since the cast, which is an assumed 1,790 s note.
    expect(second.estimate.duration.basis).toBe('assumption');
    expect(result.final.hearthReadyAt).toBe(7220);
  });

  it('a bind step moves every later hearth destination; an unbound hearth is SIM-6 with unknown travel', () => {
    const result = walk([makeHearthStep(ids), makeHearthStep(ids, { mode: 'bind', location: at(400) }), makeTravelStep(ids, { location: at(0) }), makeHearthStep(ids)]);
    expect(factKinds(record(result, 0))).toEqual(['hearth-unbound']);
    expect(seconds(result, 0)).toBeNull();
    expect(record(result, 1).delta.hearthChanged).toBe(true);
    expect(record(result, 3).delta.locationAfter).toEqual(point(400));
  });

  it('TIME-T 5, 7: flights between flight masters 3,200 yd apart cost 143 s; an unknown node is SIM-7', () => {
    const known = walk([makeFlightStep(ids, { to: { npcId: npcId(61), taxiNodeId: null, name: null } })], {
      character: { knownFlightPaths: [{ npcId: npcId(60), taxiNodeId: null, name: null }, { npcId: npcId(61), taxiNodeId: null, name: null }] },
    });
    expect(record(known, 0).estimate.duration).toEqual({ value: 143, basis: 'assumption', eraFallback: true });
    expect(factKinds(record(known, 0))).toEqual([]);
    expect(known.final.location).toEqual(point(3200));
    const unknown = walk([makeFlightStep(ids, { nodeQuery: 'NPC 61' })], { character: { knownFlightPaths: [{ npcId: npcId(60), taxiNodeId: null, name: null }] } });
    expect(record(unknown, 0).estimate.facts).toEqual([{ kind: 'flight-unknown-path', end: 'to', node: 'npc:61' }]);
    expect(seconds(unknown, 0)).toBe(143);
  });

  it('flight discover learns the node; an unresolvable query is SIM-8', () => {
    const result = walk([makeFlightStep(ids, { mode: 'discover', nodeQuery: 'npc 61' }), makeFlightStep(ids, { nodeQuery: 'Nowhere' })]);
    expect(record(result, 0).delta.flightPathsLearned).toEqual(['npc:61']);
    expect(record(result, 0).estimate.breakdown).toMatchObject({ travel: (3200 * 1.25) / 7, interaction: 3 });
    expect(record(result, 1).estimate.facts).toContainEqual({ kind: 'flight-unresolved', end: 'to', reason: 'no-node' });
    expect(seconds(result, 1)).toBeNull();
  });

  it('TIME-T 3, 4, 23: riding training by rank or riding spell; too low a level changes nothing', () => {
    const low = walk([makeTrainStep(ids, { skill: 'riding', rank: 1 })], { character: { startLevel: 38 } });
    expect(record(low, 0).estimate.facts).toEqual([{ kind: 'riding-too-low', tier: 1, requiredLevel: 40, level: 38, uncertain: false }]);
    expect(low.final.riding).toEqual({ trained: 0, speedBonus: 0 });
    expect(seconds(low, 0)).toBe(10);
    const ok = walk([makeTrainStep(ids, { spellId: spellId(33388) }), makeVendorStep(ids, { location: at(700) })], { character: { startLevel: 40 } });
    expect(ok.final.riding).toEqual({ trained: 1, speedBonus: 0.6 });
    expect(record(ok, 0).delta).toMatchObject({ ridingChanged: true, spellsLearned: [33388] });
    expect(record(ok, 1).estimate.breakdown.travel).toBeCloseTo(78.125, 10);
  });

  it('profession training adds the skill line at 1 and records it as trained in the route', () => {
    const result = walk([makeTrainStep(ids, { skill: 'profession', skillId: skillId(182) }), makeTrainStep(ids, { skill: 'profession', skillId: skillId(182) })]);
    expect(result.final.skills.get(182)).toBe(1);
    expect(result.final.trainedSkills.has(182)).toBe(true);
    expect(record(result, 0).delta.skillsLearned).toEqual([182]);
    expect(record(result, 1).delta.skillsLearned).toEqual([]);
  });

  it('`mount` before riding is trained travels on foot with SIM-9', () => {
    const result = walk([makeTravelStep(ids, { mode: 'mount', location: at(700) })]);
    expect(factKinds(record(result, 0))).toEqual(['mount-untrained']);
    expect(seconds(result, 0)).toBe(125);
  });
});

describe('every step kind in one route', () => {
  it('walks accept, complete, turn-in, abandon, travel, grind, hearth, flight, train, vendor and note', () => {
    const steps: RouteStep[] = [
      makeAcceptStep(ids, { questId: q(100) }),
      makeCompleteStep(ids, { targets: [{ questId: q(100), objective: null }], location: at(500) }),
      makeTurnInStep(ids, { questId: q(100) }),
      makeAcceptStep(ids, { questId: q(201), via: { kind: 'npc', id: npcId(10) } }),
      makeAbandonStep(ids, { questId: q(201) }),
      makeTravelStep(ids, { mode: 'walk', location: at(1000) }),
      makeGrindStep(ids, { until: { kind: 'duration', seconds: 60 }, xpPerHour: 3600 }),
      makeHearthStep(ids, { mode: 'bind' }),
      makeTrainStep(ids, { what: 'class skills', skill: 'class' }),
      makeVendorStep(ids),
      makeFlightStep(ids, { mode: 'discover', to: { npcId: npcId(61), taxiNodeId: null, name: null } }),
      makeFlightStep(ids, { to: { npcId: npcId(60), taxiNodeId: null, name: null } }),
      makeHearthStep(ids),
      makeNoteStep(ids, { text: 'done' }),
    ];
    const result = walk(steps, { character: { startLevel: 10, knownFlightPaths: [{ npcId: npcId(60), taxiNodeId: null, name: null }] } });
    expect(result.records.map((r) => r.step.kind)).toEqual(steps.map((s) => s.kind));
    expect(result.estimates.every((e) => e.active === true)).toBe(true);
    expect(result.records.map((r) => r.delta.locationAfter?.x ?? null)).toEqual([100, 500, 100, 100, 100, 1000, 1000, 1000, 1000, 1000, 3200, 0, 1000, 1000]);
    expect(record(result, 6).estimate.xpGained.value).toBe(60);
    expect(record(result, 6).estimate.breakdown.combat).toBe(60);
    expect(record(result, 7).estimate.breakdown.interaction).toBe(5);
    expect(record(result, 8).estimate.breakdown.interaction).toBe(10);
    expect(record(result, 11).estimate.duration.value).toBe(143);
    let time = 0;
    for (const e of result.estimates) {
      expect(e.startSec).toBe(time);
      time = e.endSec;
    }
    expect(result.final.timeSec).toBe(time);
    expect(walkMetrics(result).stepsWithUnknownTime).toBe(0);
  });
});

// =============================================================================================
// Checkpoints, visitors, determinism, leg enumeration

/** A long synthetic route: accept, work, turn-in cycles over spread-out places. */
function longRoute(count: number, seed = 0): RouteStep[] {
  const localIds = testIds();
  const steps: RouteStep[] = [];
  for (let i = 0; steps.length < count; i += 1) {
    const x = ((i * 37 + seed) % 50) * 20;
    const y = ((i * 53 + seed) % 40) * 20;
    const quest = q(100 + (i % 2));
    steps.push(makeAcceptStep(localIds, { questId: quest, location: at(x, y) }));
    steps.push(makeCompleteStep(localIds, { targets: [{ questId: quest, objective: 0 }], location: at(x + 100, y) }));
    steps.push(makeTurnInStep(localIds, { questId: quest, location: at(x, y) }));
    if (i % 7 === 0) steps.push(makeHearthStep(localIds));
    if (i % 11 === 0) steps.push(makeGrindStep(localIds, { until: { kind: 'duration', seconds: 120 } }));
  }
  return steps.slice(0, count);
}

const BASE = fixtureProject([], { character: { hearthLocation: at(300), startLevel: 1 } });
/** The same character, profile and custom quests for every route, so only the steps differ between walks. */
const project = (steps: readonly RouteStep[]): WalkProject => ({ ...BASE, route: { ...BASE.route, steps } });

describe('checkpoints and re-walks (ARCHITECTURE §9.2)', () => {
  const steps = longRoute(1000);

  it('keeps a checkpoint every 256 steps', () => {
    const walker = createRouteWalker(context());
    walker.walk(project(steps));
    expect(walker.checkpointIndices()).toEqual([0, 256, 512, 768]);
    expect(CHECKPOINT_INTERVAL).toBe(256);
  });

  it('an edit in the middle re-walks from the checkpoint before it and equals a full walk', () => {
    const walker = createRouteWalker(context());
    walker.walk(project(steps));
    const edited = [...steps];
    edited[600] = makeVendorStep(testIds(), { location: at(123, 456) });
    const re = walker.walk(project(edited));
    expect(re.fromIndex).toBe(512);
    const full = createRouteWalker(context()).walk(project(edited));
    expect(re.estimates).toEqual(full.estimates);
    expect(re.records.map((r) => r.delta)).toEqual(full.records.map((r) => r.delta));
    expect(walker.stateBefore(1000)).toEqual(createRouteWalker(context()).walk(project(edited)).final);
  });

  it('appending continues from the working state; removing re-walks from the checkpoint before the new end', () => {
    const walker = createRouteWalker(context());
    walker.walk(project(steps.slice(0, 700)));
    expect(walker.walk(project(steps)).fromIndex).toBe(700);
    const shorter = walker.walk(project(steps.slice(0, 900)));
    expect(shorter.fromIndex).toBe(768);
    expect(shorter.estimates).toEqual(createRouteWalker(context()).walk(project(steps.slice(0, 900))).estimates);
  });

  it('an unchanged project re-walks nothing; invalidate forces a re-walk from the checkpoint before it', () => {
    const walker = createRouteWalker(context());
    const p = project(steps);
    walker.walk(p);
    expect(walker.walk(p).fromIndex).toBe(1000);
    walker.invalidate(300);
    expect(walker.walk(p).fromIndex).toBe(256);
    expect(walker.walk({ ...p, character: { ...p.character } }).fromIndex).toBe(0);
  });

  it('a replaced group re-walks from its first step', () => {
    const group = rxpGroup('g', { condition: { filter: null, variant: null, skipIf: [] } });
    const withGroup = steps.map((s, i) => (i >= 300 && i < 303 ? { ...s, groupId: group.id } : s));
    const walker = createRouteWalker(context());
    const base = fixtureProject(withGroup, { groups: [group] });
    walker.walk(base);
    const changedGroup = rxpGroup('g', { condition: { filter: { kind: 'word', word: 'Mage' }, variant: null, skipIf: [] } });
    const re = walker.walk({ ...base, route: { ...base.route, groups: { g: changedGroup } } });
    expect(re.fromIndex).toBe(256);
    expect(re.estimates[300]?.active).toBe(false);
  });

  it('the state at a selected step comes from the nearest checkpoint and equals a walk to that step', () => {
    const walker = createRouteWalker(context());
    walker.walk(project(steps));
    for (const index of [0, 1, 255, 256, 700, 999]) {
      expect(walker.stateBefore(index)).toEqual(createRouteWalker(context()).walk(project(steps.slice(0, index))).final);
    }
    expect(() => walker.stateBefore(1001)).toThrow(RangeError);
  });

  it('is deterministic: two walkers give the same records', () => {
    const a = createRouteWalker(context()).walk(project(steps));
    const b = createRouteWalker(context()).walk(project(steps));
    expect(a.estimates).toEqual(b.estimates);
    expect(a.records.map((r) => r.legsAsked)).toEqual(b.records.map((r) => r.legsAsked));
  });
});

describe('visitors', () => {
  it('see the state before a step in enter and after it in leave, with its record', () => {
    const seen: string[] = [];
    const visitor: WalkVisitor = {
      begin: (start) => seen.push(`begin ${String(start.fromIndex)}`),
      enter: (visit) => seen.push(`enter ${String(visit.index)} ${String(visit.state.questLog.has(q(201)))}`),
      leave: (visit, rec) => seen.push(`leave ${String(visit.index)} ${String(visit.state.questLog.has(q(201)))} ${rec.step.kind}`),
      end: (w) => seen.push(`end ${String(w.records.length)}`),
    };
    walkRoute(project([makeAcceptStep(ids, { questId: q(201) }), makeTurnInStep(ids, { questId: q(201) })]), context(), [visitor]);
    expect(seen).toEqual(['begin 0', 'enter 0 false', 'leave 0 true accept', 'enter 1 true', 'leave 1 false turnin', 'end 2']);
  });

  it('a visitor that throws leaves the walker able to walk again correctly', () => {
    const steps = longRoute(600);
    const walker = createRouteWalker(context());
    walker.walk(project(steps));
    walker.invalidate(0);
    expect(() =>
      walker.walk(project(steps), [
        {
          leave: (visit) => {
            if (visit.index === 300) throw new Error('visitor failed');
          },
        },
      ]),
    ).toThrow('visitor failed');
    const again = walker.walk(project(steps));
    expect(again.fromIndex).toBe(256);
    expect(again.estimates).toEqual(createRouteWalker(context()).walk(project(steps)).estimates);
  });

  it('a re-walk visits only the steps from its start', () => {
    const steps = longRoute(600);
    const walker = createRouteWalker(context());
    walker.walk(project(steps));
    const visited: number[] = [];
    const edited = [...steps];
    edited[590] = makeNoteStep(testIds(), { text: 'edit' });
    walker.walk(project(edited), [{ enter: (visit) => visited.push(visit.index) }]);
    expect(visited[0]).toBe(512);
    expect(visited.length).toBe(88);
  });
});

describe('leg enumeration (terrain-navigation.md §9.4)', () => {
  it('lists consecutive located steps, leg waypoints, spawn positions and hearth destinations, once each', () => {
    const group = rxpGroup('w', { waypoints: [{ point: at(150).source, role: 'leg', radius: null, filter: null, line: null }] });
    const steps = [
      makeVendorStep(ids, { location: at(100) }),
      makeVendorStep(ids, { location: at(200), groupId: group.id }),
      makeHearthStep(ids),
      makeAcceptStep(ids, { questId: q(300) }),
      makeVendorStep(ids, { location: at(100) }),
      makeVendorStep(ids, { location: at(100) }),
      makeTravelStep(ids, { mode: 'transport', location: at(40, 30, EASTERN_KINGDOMS) }),
    ];
    const walker = createRouteWalker(context());
    const result = walker.walk(fixtureProject(steps, { character: { hearthLocation: at(1000) }, groups: [group] }));
    const pairs = walker.legs().map((pair) => [pair.from.point.mapId, pair.from.point.x, pair.from.point.y, pair.to.point.x, pair.to.point.y]);
    expect(pairs).toEqual([
      [1, 0, 0, 100, 0],
      [1, 100, 0, 150, 0],
      [1, 150, 0, 200, 0],
      [1, 1000, 0, 1100, 0],
      [1, 1100, 0, 100, 0],
      [0, 0, 0, 40, 30],
    ]);
    expect(enumerateLegs(result.records).map(legPairKey)).toEqual(walker.legs().map(legPairKey));
    // The walk to the Kalimdor dock (100, 0) is 0 yd away: no leg is asked for.
    expect(record(result, 6).legsAsked).toHaveLength(1);
  });

  it('a navigation walk asks for the same legs as a straight-line walk', () => {
    const steps = longRoute(300);
    const recorded: string[] = [];
    const base = context();
    const navigation: TravelModel = {
      id: 'navigation',
      revision: 'nav-test',
      leg: (from, to, speeds) => {
        recorded.push(legPairKey({ from, to }));
        return { ...base.travel.leg(from, to, speeds), method: 'navigation', seconds: estimate(1, 'derived'), pending: false };
      },
      path: () => null,
    };
    const straight = createRouteWalker(base);
    straight.walk(project(steps));
    const nav = createRouteWalker(context({ travel: navigation }));
    nav.walk(project(steps));
    expect(nav.legs().map(legPairKey)).toEqual(straight.legs().map(legPairKey));
    expect(new Set(recorded)).toEqual(new Set(straight.legs().map(legPairKey)));
  });
});

describe('injected dependencies', () => {
  it('zone hints come from the injected resolver, for route points and spawns', () => {
    const hinted = { ...context(), zoneHints: { routePoint: () => 14, spawn: () => 17 } };
    const result = walkRoute(fixtureProject([makeVendorStep(ids, { location: at(50) }), makeAcceptStep(ids, { questId: q(100) })]), hinted);
    expect(record(result, 0).legs[0]).toMatchObject({ from: { zoneHint: 14 }, to: { zoneHint: 14 } });
    expect(record(result, 1).legs[0]).toMatchObject({ from: { zoneHint: 14 }, to: { zoneHint: 17 } });
    expect(result.final.locationHint).toBe(17);
  });

  it('an injected accept policy picks the any-of candidate', () => {
    const policy = { acceptable: (id: ReturnType<typeof q>) => (id === q(201) ? ('false' as const) : ('true' as const)) };
    const result = walkRoute(fixtureProject([makeAcceptStep(ids, { questId: q(201), anyOf: [q(201), q(202)] })]), { ...context(), acceptPolicy: policy });
    expect(record(result, 0).delta.accepted).toBe(q(202));
  });

  it('a located flight walks to its flight master first; a dock on another map is SIM-4', () => {
    const flight = walk([makeFlightStep(ids, { location: at(3000), to: { npcId: npcId(60), taxiNodeId: null, name: null } })], {
      character: { knownFlightPaths: [{ npcId: npcId(60), taxiNodeId: null, name: null }, { npcId: npcId(61), taxiNodeId: null, name: null }] },
    });
    expect(record(flight, 0).legs.map((leg) => [leg.purpose, leg.to.point.x])).toEqual([
      ['step', 3000],
      ['flight-master', 3200],
    ]);
    expect(flight.final.location).toEqual(point(0));
    const dock = walk([makeTravelStep(ids, { mode: 'transport', transport: { id: null, dock: at(5, 5, EASTERN_KINGDOMS) }, location: at(9, 9, EASTERN_KINGDOMS) })]);
    expect(record(dock, 0).estimate.facts).toContainEqual({ kind: 'cross-world-no-transport', fromMapId: KALIMDOR, toMapId: EASTERN_KINGDOMS });
  });

  it('a group’s skip is decided at its first step even when that step’s own filter drops it', () => {
    const group = rxpGroup('g2', { condition: { filter: null, variant: null, skipIf: [{ kind: 'questState', state: 'onQuest', questIds: [q(201)], match: 'any', negate: false }] } });
    const result = walk(
      [
        makeNoteStep(ids, { text: 'mage only', groupId: group.id, condition: { filter: { kind: 'word', word: 'Mage' }, variant: null, skipIf: [] } }),
        makeAcceptStep(ids, { questId: q(201) }),
        makeNoteStep(ids, { text: 'b', groupId: group.id }),
      ],
      { groups: [group] },
    );
    expect(result.estimates.map((e) => e.active)).toEqual([false, true, true]);
  });

  it('stateBefore returns a copy that does not change the walker', () => {
    const walker = createRouteWalker(context());
    walker.walk(fixtureProject([makeAcceptStep(ids, { questId: q(201) })]));
    const copy = walker.stateBefore(1) as ReturnType<typeof walker.stateBefore> & { questLog: Map<unknown, unknown> };
    copy.questLog.clear();
    expect(walker.stateBefore(1).questLog.size).toBe(1);
    expect(walker.stateBefore(0).questLog.size).toBe(0);
  });
});

describe('ruleset', () => {
  it('era-1.15 carries no Era fallback flag', () => {
    const result = walk([makeTravelStep(ids, { location: at(700) })], {}, context({ rulesetId: 'era-1.15' }));
    expect(record(result, 0).estimate.duration).toEqual({ value: 125, basis: 'assumption', eraFallback: false });
  });

  it('a start level beyond the XP table leaves grind time unknown instead of failing', () => {
    const result = walk([makeGrindStep(ids, { until: { kind: 'level', level: 60, offset: null } })], { character: { startLevel: 70 } });
    expect(seconds(result, 0)).toBeNull();
    expect(record(result, 0).estimate.facts).toEqual([{ kind: 'time-unknown', part: 'grind', reason: 'above-max-level', questId: null, objective: null }]);
  });

  it('keeps world map ids branded', () => {
    expect(worldMapId(0)).toBe(EASTERN_KINGDOMS);
  });
});
