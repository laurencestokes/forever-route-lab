import { describe, expect, it } from 'vitest';
import type { EntityRef, ItemRecord, NpcRecord, ObjectiveDef, SpawnPoint } from '../domain/dataset';
import { areaId, itemId, type ItemId, npcId, type NpcId, objectId, questId, spellId, worldMapId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';
import type { TravelEndpoint } from '../domain/travel';
import { effectiveRules } from '../rules/precedence';
import { FOREVER_BETA } from '../rules/ruleset';
import { createStraightLineTravelModel } from '../rules/straight-line';
import { nearestEntrance, seedTravelGraph } from '../rules/travel-graph';
import { stepDuration } from './estimate';
import { grind } from './grind';
import { hearthUse } from './hearth';
import { interactionTime } from './interaction';
import { completeWork, type ObjectiveLookup, objectiveWork, partialWork } from './objectives';
import { questXp } from './quest-xp';
import { flightTime, nearestLocalTaxiNode } from './taxi';
import { transportCrossing } from './transport';
import { groundTravel, initialRiding, trainRiding, travelSpeeds } from './travel';
import { grantXp, xpCurveOf } from './xp';

/**
 * docs/SIMULATION.md §6.9 TIME-T vectors (`forever-beta` defaults unless stated), at the level of
 * the pure functions. Rows 7, 11, 17, 18 and 30 also need the walker (it records the SIM-7, SIM-4,
 * VAL-30 and SIM-1 facts and the lower-bound flags); rows 20, 31 and 32 are validator rows.
 */

const rules = effectiveRules(FOREVER_BETA);
const curve = xpCurveOf(rules);
const model = createStraightLineTravelModel(rules.values.groundDetourFactor.value);
const KALIMDOR = worldMapId(1);
const EK = worldMapId(0);
const point = (x: number, y = 0, mapId = KALIMDOR): WorldPoint => ({ mapId, x, y });
const end = (x: number, y = 0, mapId = KALIMDOR): TravelEndpoint => ({ point: point(x, y, mapId), zoneHint: 0 });
const onFoot = initialRiding(0, rules);

function npc(id: number, minLevel: number, maxLevel: number): NpcRecord {
  return {
    id: npcId(id),
    name: `Mob ${String(id)}`,
    subName: null,
    minLevel,
    maxLevel,
    rank: 0,
    zoneId: null,
    npcFlags: 0,
    friendlyTo: null,
    questStarts: [],
    questEnds: [],
    provenance: { upstreamDiff: 'era', foreverStatus: 'unknown', corrected: false, created: false, source: 'questiedb' },
  };
}

function item(id: number, dropNpcs: readonly number[], dropObjects: readonly number[] = []): ItemRecord {
  return {
    id: itemId(id),
    name: `Item ${String(id)}`,
    itemClass: 12,
    dropNpcs: dropNpcs.map(npcId),
    dropObjects: dropObjects.map(objectId),
    dropItems: [],
    startsQuest: null,
    provenance: { upstreamDiff: 'era', foreverStatus: 'unknown', corrected: false, created: false, source: 'questiedb' },
  };
}

const spawn = (world: WorldPoint): SpawnPoint => ({ source: { kind: 'unmapped', areaId: areaId(1), x: 0, y: 0, reason: 'no-uimap' }, world, uiMapId: null });

// Synthetic records: level-10 mobs, a drop item and an object-only item (not dataset values).
const NPCS = [npc(1, 10, 10), npc(2, 9, 12), npc(3, 30, 30)];
const ITEMS = [item(100, [1]), item(101, [], [7]), item(102, []), item(103, [3, 2])];
const SPAWNS: Readonly<Record<number, readonly SpawnPoint[]>> = { 2: [spawn(point(50))], 3: [spawn(point(500))] };
const lookup: ObjectiveLookup = {
  npc: (id: NpcId) => NPCS.find((record) => record.id === id),
  item: (id: ItemId) => ITEMS.find((record) => record.id === id),
  spawns: (ref: EntityRef) => (ref.kind === 'npc' ? (SPAWNS[ref.id] ?? []) : []),
};

const killTarget: ObjectiveDef = { kind: 'kill', npcId: npcId(1), label: null, count: null };
const itemTarget: ObjectiveDef = { kind: 'item', itemId: itemId(100), label: null, count: null };
const work = (objective: ObjectiveDef, quest = 1, playerLevel = 10, at: WorldPoint | null = null) =>
  objectiveWork({ questId: questId(quest), index: 0, objective, countOverride: null, playerLevel, at, place: 'open-world' }, lookup, rules);

describe('TIME-T 1-4, 23-25: movement and riding', () => {
  it('1: 700 yd on foot → 700 × 1.25 / 7.0 = 125 s (assumption, Era fallback from the run speed)', () => {
    const move = groundTravel(end(0), end(700), null, travelSpeeds('auto', onFoot, rules), model, rules);
    expect(move).toMatchObject({ outcome: 'leg', method: 'straight-line', pending: false, straightYards: 700 });
    expect(move.seconds).toEqual({ value: 125, basis: 'assumption', eraFallback: true });
    expect(move.used).toEqual(['runSpeed', 'groundDetourFactor']);
  });

  it('2: riding tier 1 / tier 2 → 78.125 s / 62.5 s', () => {
    for (const [tier, seconds] of [
      [1, 78.125],
      [2, 62.5],
    ] as const) {
      const speeds = travelSpeeds('auto', initialRiding(tier, rules), rules);
      expect(speeds.mounted).toBe(true);
      expect(groundTravel(end(0), end(700), null, speeds, model, rules).seconds.value).toBeCloseTo(seconds, 9);
    }
  });

  it("3: train riding rank 1 at level 38 → riding-too-low, riding unchanged, 10 s", () => {
    const result = trainRiding({ skill: 'riding', spellId: null, rank: 1 }, { level: 38, unknownXpEvents: 0, riding: onFoot }, rules);
    expect(result.riding).toEqual({ trained: 0, speedBonus: 0 });
    expect(result.facts).toEqual([{ kind: 'riding-too-low', tier: 1, requiredLevel: 40, level: 38, uncertain: false }]);
    expect(interactionTime({ kind: 'train' }, rules).part.seconds.value).toBe(10);
  });

  it('3 (uncertain): after unknown XP the tier is applied and the fact is uncertain', () => {
    const result = trainRiding({ skill: 'riding', spellId: null, rank: 1 }, { level: 38, unknownXpEvents: 2, riding: onFoot }, rules);
    expect(result.riding).toEqual({ trained: 1, speedBonus: 0.6 });
    expect(result.facts).toEqual([{ kind: 'riding-too-low', tier: 1, requiredLevel: 40, level: 38, uncertain: true }]);
  });

  it('4: the same at level 40 → riding { trained: 1, speedBonus: 0.6 }', () => {
    const result = trainRiding({ skill: 'riding', spellId: null, rank: 1 }, { level: 40, unknownXpEvents: 0, riding: onFoot }, rules);
    expect(result).toMatchObject({ recognised: true, tier: 1, riding: { trained: 1, speedBonus: 0.6 }, facts: [] });
  });

  it('23: train { spellId: 33388 } at level 40 → recognised by ridingSpells, tier 1', () => {
    const result = trainRiding({ skill: null, spellId: spellId(33388), rank: null }, { level: 40, unknownXpEvents: 0, riding: onFoot }, rules);
    expect(result).toMatchObject({ recognised: true, tier: 1, riding: { trained: 1, speedBonus: 0.6 } });
    // The riding spells, mount levels and bonuses are client data: nothing to mark.
    expect(result.used).toEqual([]);
  });

  it('24: train { spellId: 33391 } at level 45, riding 1 → tier 2 needs 60: riding-too-low, unchanged', () => {
    const riding = initialRiding(1, rules);
    const result = trainRiding({ skill: null, spellId: spellId(33391), rank: null }, { level: 45, unknownXpEvents: 0, riding }, rules);
    expect(result.riding).toBe(riding);
    expect(result.facts).toEqual([{ kind: 'riding-too-low', tier: 2, requiredLevel: 60, level: 45, uncertain: false }]);
  });

  it('25: character.riding = 1 at level 45; first step 700 yd, auto → riding starts { 1, 0.6 }; 78.125 s', () => {
    const riding = initialRiding(1, rules);
    expect(riding).toEqual({ trained: 1, speedBonus: 0.6 });
    expect(groundTravel(end(0), end(700), null, travelSpeeds('auto', riding, rules), model, rules).seconds.value).toBeCloseTo(78.125, 9);
  });

  it('a non-riding train step is not recognised; tier defaults to trained + 1, capped at 2', () => {
    expect(trainRiding({ skill: 'class', spellId: spellId(6673), rank: null }, { level: 60, unknownXpEvents: 0, riding: onFoot }, rules).recognised).toBe(false);
    const second = trainRiding({ skill: 'riding', spellId: null, rank: null }, { level: 60, unknownXpEvents: 0, riding: initialRiding(1, rules) }, rules);
    expect(second.riding).toEqual({ trained: 2, speedBonus: 1 });
    const capped = trainRiding({ skill: 'riding', spellId: null, rank: 5 }, { level: 60, unknownXpEvents: 0, riding: onFoot }, rules);
    expect(capped.tier).toBe(2);
  });

  it("'mount' before riding is trained travels on foot and records mount-untrained (SIM-9); 'walk' never rides", () => {
    expect(travelSpeeds('mount', onFoot, rules)).toMatchObject({ mounted: false, speeds: { groundYps: 7 }, facts: [{ kind: 'mount-untrained' }] });
    expect(travelSpeeds('walk', initialRiding(2, rules), rules)).toMatchObject({ mounted: false, speeds: { groundYps: 7 } });
    expect(travelSpeeds('transport', initialRiding(2, rules), rules)).toMatchObject({ mounted: true, speeds: { groundYps: 14, swimYps: 4.722 } });
  });
});

describe('TIME-2 edge cases', () => {
  const speeds = travelSpeeds('auto', onFoot, rules);

  it('an arrival radius shortens the move; inside it the move is 0 s and no leg is asked for', () => {
    expect(groundTravel(end(0), end(700), 140, speeds, model, rules).seconds.value).toBe(100);
    const arrived = groundTravel(end(0), end(700), 800, speeds, model, rules);
    expect(arrived).toMatchObject({ outcome: 'arrived', seconds: { value: 0 }, method: null });
  });

  it('11: consecutive steps on world maps 0 and 1 → the move is unknown (the walker records SIM-4)', () => {
    const move = groundTravel(end(0, 0, EK), end(0), null, speeds, model, rules);
    expect(move).toMatchObject({ outcome: 'cross-map', seconds: { value: null, basis: 'unknown' }, facts: [] });
  });

  it('an unknown start or an unresolved destination makes the move unknown, never zero', () => {
    expect(groundTravel(null, end(10), null, speeds, model, rules)).toMatchObject({ outcome: 'from-unknown', seconds: { value: null } });
    expect(groundTravel(end(10), null, null, speeds, model, rules)).toMatchObject({ outcome: 'to-unknown', seconds: { value: null } });
  });

  it('passes navigation warnings and pending legs through as facts, scaled by the radius', () => {
    const navigation = {
      id: 'navigation' as const,
      revision: 'nav-test',
      leg: () => ({
        seconds: { value: 200, basis: 'derived' as const, eraFallback: false },
        method: 'navigation' as const,
        pending: true,
        warnings: [{ kind: 'long-swim' as const, longestSwimYd: 250 }, { kind: 'unverified-passage' as const, passages: ['undercity-west-tunnel'] }],
      }),
      path: () => null,
    };
    const move = groundTravel(end(0), end(400), 100, speeds, navigation, rules);
    expect(move.seconds).toEqual({ value: 150, basis: 'derived', eraFallback: true });
    expect(move.facts).toEqual([
      { kind: 'travel-warning', warning: { kind: 'long-swim', longestSwimYd: 250 } },
      { kind: 'travel-warning', warning: { kind: 'unverified-passage', passages: ['undercity-west-tunnel'] } },
      { kind: 'pending-leg' },
    ]);
    expect(move.used).toEqual(['runSpeed', 'swimSpeed']);
  });
});

describe('TIME-T 5-7: flights (TIME-5)', () => {
  it('5: known flight masters 3,200 yd apart → 3 + 3200 × 1.4 / 32 = 143 s; assumption, Era fallback', () => {
    const flight = flightTime({ from: point(0), to: point(3200), fromTaxiNodeId: null, toTaxiNodeId: null }, rules);
    expect(flight.model).toBe('straight-line');
    const { duration, breakdown } = stepDuration(flight.parts);
    expect(duration).toEqual({ value: 143, basis: 'assumption', eraFallback: true });
    expect(breakdown).toMatchObject({ interaction: 3, travel: 140 });
  });

  it('6: taxiSpeedBonusPct 20 → 3 + 3200 × 1.4 / 38.4 = 119.67 s', () => {
    const bonus = { ...rules, values: { ...rules.values, taxiSpeedBonusPct: { ...rules.values.taxiSpeedBonusPct, value: 20 } } };
    const flight = flightTime({ from: point(0), to: point(3200), fromTaxiNodeId: null, toTaxiNodeId: null }, bonus);
    expect(stepDuration(flight.parts).duration.value).toBeCloseTo(119.67, 2);
  });

  it('7: a node not in knownFlightPaths is timed as 5 (the walker adds SIM-7)', () => {
    const flight = flightTime({ from: point(0), to: point(3200), fromTaxiNodeId: 3276, toTaxiNodeId: 3203 }, rules);
    expect(stepDuration(flight.parts).duration.value).toBe(143);
    expect(flight.facts).toEqual([]);
  });

  it('TIME-6: a flight master maps to the TaxiNodes row nearest it on its map, within 50 yd (review SIM-10)', () => {
    const data = { build: 'test', legs: [], nodes: [{ id: 7, point: point(30, 40) }, { id: 8, point: point(3, 4) }, { id: 9, point: point(0, 0, EK) }, { id: 10, point: point(500) }] };
    expect(nearestLocalTaxiNode(data, point(0))).toBe(8);
    expect(nearestLocalTaxiNode(data, point(0, 0, EK))).toBe(9);
    expect(nearestLocalTaxiNode(data, point(200))).toBeNull();
    expect(nearestLocalTaxiNode({ build: 'test', legs: [] }, point(0))).toBeNull();
  });

  it('across world maps a flight is unknown with cross-world-no-transport', () => {
    const flight = flightTime({ from: point(0, 0, EK), to: point(0), fromTaxiNodeId: null, toTaxiNodeId: null }, rules);
    expect(stepDuration(flight.parts)).toMatchObject({ duration: { value: null }, breakdown: { interaction: 3, travel: 0 } });
    expect(flight.facts).toEqual([{ kind: 'cross-world-no-transport', fromMapId: EK, toMapId: KALIMDOR }]);
  });
});

describe('TIME-T 8-9: hearth (TIME-4)', () => {
  it('8: hearth use at t = 0, ready → 10 s cast; hearthReadyAt 3,610', () => {
    const use = hearthUse({ timeSec: 0, hearthReadyAt: 0, bound: true }, rules);
    expect(use).toMatchObject({ readyAt: 3610, arrivesAt: 10, facts: [] });
    expect(stepDuration(use.parts)).toMatchObject({ duration: { value: 10, basis: 'source' }, breakdown: { travel: 10, waiting: 0 } });
  });

  it('9: a second use at t = 1,800 waits 1,810 s, casts 10 s; hearthReadyAt 7,220; hearth-cooldown', () => {
    const use = hearthUse({ timeSec: 1800, hearthReadyAt: 3610, bound: true }, rules);
    expect(use).toMatchObject({ readyAt: 7220, arrivesAt: 3620, facts: [{ kind: 'hearth-cooldown', waitSeconds: 1810, upperBound: false }] });
    expect(stepDuration(use.parts).breakdown).toMatchObject({ waiting: 1810, travel: 10 });
  });

  it('the wait takes the basis of the time since the cast; after unknown time it is an unknown upper bound (TIME-4, TIME-13)', () => {
    const assumed = hearthUse({ timeSec: 1800, hearthReadyAt: 3610, bound: true, sinceCast: { basis: 'assumption', eraFallback: true } }, rules);
    expect(assumed.parts[0]?.seconds).toEqual({ value: 1810, basis: 'assumption', eraFallback: true });
    const unknown = hearthUse({ timeSec: 1800, hearthReadyAt: 3610, bound: true, sinceCast: { basis: 'unknown', eraFallback: false } }, rules);
    expect(unknown).toMatchObject({ arrivesAt: 1810, readyAt: 5410, facts: [{ kind: 'hearth-cooldown', waitSeconds: 1810, upperBound: true }] });
    expect(stepDuration(unknown.parts)).toMatchObject({ duration: { value: null }, breakdown: { waiting: 0, travel: 10 }, knownSeconds: 10 });
  });

  it('an unbound hearth records hearth-unbound (SIM-6) and unknown travel', () => {
    const use = hearthUse({ timeSec: 50, hearthReadyAt: 0, bound: false }, rules);
    expect(use).toMatchObject({ readyAt: 0, arrivesAt: null, facts: [{ kind: 'hearth-unbound' }] });
    expect(stepDuration(use.parts).duration.value).toBeNull();
  });
});

describe('TIME-T 10: transport (TIME-7)', () => {
  it('dock 100 yd away, on foot, default wait and ride → 100 × 1.25 / 7 + 60 + 60 = 137.86 s (waiting 60)', () => {
    const walk = groundTravel(end(0), end(100), null, travelSpeeds('transport', onFoot, rules), model, rules);
    const crossing = transportCrossing(walk, null, 'Horde', rules);
    const { duration, breakdown } = stepDuration(crossing.parts);
    expect(duration.value).toBeCloseTo(137.857, 3);
    expect(duration.basis).toBe('assumption');
    expect(breakdown.waiting).toBe(60);
  });

  it('a record whose known factions exclude the character records transport-faction (SIM-14)', () => {
    const graph = seedTravelGraph(
      { npc: () => undefined, spawns: () => [], zone: () => undefined, flightMasterIds: [], dungeons: [] },
      rules,
      { transports: [{ id: 'test', name: 'Test', stops: [{ name: 'A', mapId: KALIMDOR, dockNpcIds: [] }, { name: 'B', mapId: EK, dockNpcIds: [] }], factions: ['Horde'], basis: 'assumption', source: 'test' }] },
    );
    const edge = graph.transports[0] ?? null;
    const walk = groundTravel(end(0), end(0), null, travelSpeeds('transport', onFoot, rules), model, rules);
    expect(transportCrossing(walk, edge, 'Alliance', rules).facts).toEqual([{ kind: 'transport-faction', transportId: 'test' }]);
    expect(transportCrossing(walk, edge, 'Horde', rules).facts).toEqual([]);
  });
});

describe('TIME-T 12-17: objective work (TIME-9..11)', () => {
  it('12: one kill target, count null, P = 10, M = 10 → 8 × 30 = 240 s; kill XP 8 × 95 = 760', () => {
    const result = work(killTarget);
    expect(result).toMatchObject({ workCount: 8, npcId: 1, seconds: { value: 240, basis: 'assumption' }, killXp: { value: 760, basis: 'assumption', eraFallback: true } });
    expect(completeWork([result], rules)).toMatchObject({ seconds: { value: 240 }, killXp: { value: 760 }, factor: 1 });
  });

  it('13: one item target with an NPC drop, count null → k = ceil(5 / 0.5) = 10; 10 × 32 = 320 s; kill XP 950', () => {
    expect(work(itemTarget)).toMatchObject({ workCount: 10, npcId: 1, seconds: { value: 320 }, killXp: { value: 950 } });
  });

  it('14: two kill targets as in 12 → S = 240 + 0.5 × 240 = 360 s; f = 0.75; kill XP 1,140', () => {
    const result = completeWork([work(killTarget, 1), work(killTarget, 2)], rules);
    expect(result).toMatchObject({ seconds: { value: 360, basis: 'assumption' }, factor: 0.75, killXp: { value: 1140 } });
    expect(result.used).toContain('objectiveConcurrency');
  });

  it('15: the targets of 12 and 13 → S = 320 + 0.5 × 240 = 440 s; kill XP floor(1710 × 440 / 560) = 1,343', () => {
    const result = completeWork([work(killTarget, 1), work(itemTarget, 2)], rules);
    expect(result.seconds.value).toBe(440);
    expect(result.killXp.value).toBe(1343);
  });

  it('16: partial, no override → objective 0 s, kill XP 0 (nothing is marked)', () => {
    expect(partialWork(null)).toEqual({ seconds: { value: 0, basis: 'assumption', eraFallback: false }, killXp: { value: 0, basis: 'derived', eraFallback: false } });
    expect(partialWork(45).seconds.value).toBe(45);
  });

  it('17: incidental completion costs 0 s and 0 kill XP; the quest XP is granted as usual', () => {
    expect(partialWork(null).seconds.value).toBe(0);
    expect(questXp({ questId: questId(5), xp: { questLevel: 10, baseXp: 840, basis: 'era-seed' }, requiredLevel: null, dungeonQuest: false, playerLevel: 10 }, rules).xp.value).toBe(850);
  });

  it('an unknown target time makes S unknown; kill XP is taken over the known targets with f = 1', () => {
    const reputation = work({ kind: 'reputation', factionId: 72 as never, value: 3000 });
    expect(reputation).toMatchObject({ seconds: { value: null }, facts: [{ kind: 'time-unknown', part: 'objective', reason: 'reputation-objective', questId: 1, objective: 0 }] });
    const result = completeWork([work(killTarget), reputation], rules);
    expect(result).toMatchObject({ seconds: { value: null, basis: 'unknown' }, killXp: { value: 760 }, factor: 1 });
  });

  it('prices objects, object-only items, events and unknown items', () => {
    expect(work({ kind: 'object', objectId: objectId(7), label: null, count: null })).toMatchObject({ workCount: 6, seconds: { value: 120 }, killXp: { value: 0 } });
    expect(work({ kind: 'item', itemId: itemId(101), label: null, count: 2 })).toMatchObject({ workCount: 2, seconds: { value: 40 } });
    expect(work({ kind: 'event', text: null, points: [] })).toMatchObject({ seconds: { value: 20 }, workCount: null });
    expect(work({ kind: 'spell', spellId: spellId(1), itemId: null, label: null })).toMatchObject({ seconds: { value: 20 } });
    expect(work({ kind: 'item', itemId: itemId(102), label: null, count: null })).toMatchObject({ seconds: { value: null }, facts: [{ reason: 'item-without-source' }] });
    expect(work({ kind: 'item', itemId: itemId(999), label: null, count: null }).seconds.value).toBeNull();
  });

  it('uses a user count for time and XP alike, and the kill credit root NPC', () => {
    const counted = objectiveWork({ questId: questId(1), index: 1, objective: killTarget, countOverride: 3, playerLevel: 10, at: null, place: 'open-world' }, lookup, rules);
    expect(counted).toMatchObject({ workCount: 3, seconds: { value: 90 }, killXp: { value: 285 } });
    expect(counted.used).not.toContain('objectiveKillCount');
    expect(work({ kind: 'killCredit', npcIds: [npcId(2)], rootNpcId: npcId(1), label: null, count: null })).toMatchObject({ npcId: 1, killXp: { value: 760 } });
  });

  it('chooses the drop NPC nearest the step, else the lowest id', () => {
    const drop: ObjectiveDef = { kind: 'item', itemId: itemId(103), label: null, count: null };
    expect(work(drop, 1, 10, point(450)).npcId).toBe(3);
    expect(work(drop, 1, 10, point(60)).npcId).toBe(2);
    expect(work(drop, 1, 10, null).npcId).toBe(2);
  });

  it('assumes a same-level mob for an NPC without a record and says so', () => {
    const unknownMob = work({ kind: 'kill', npcId: npcId(77), label: null, count: null }, 1, 20);
    expect(unknownMob).toMatchObject({ killXp: { value: 8 * 145 }, facts: [{ kind: 'mob-level-assumed', npcId: 77 }] });
  });
});

describe('TIME-T 18-19, 21, 26-29: unknown XP and grind (XP-4, TIME-12)', () => {
  it('18: level 5, 0 XP; turn-in with unknown XP → nothing granted; unknown-xp fact', () => {
    const result = questXp({ questId: questId(9), xp: null, requiredLevel: null, dungeonQuest: false, playerLevel: 5 }, rules);
    expect(result.xp.value).toBeNull();
    expect(result.facts).toEqual([{ kind: 'unknown-xp', questId: 9, reason: 'no-record' }]);
  });

  it('19: then turn-in B (era-seed 840, Q 10) → +850; 850 of 2,800', () => {
    const gained = questXp({ questId: questId(10), xp: { questLevel: 10, baseXp: 840, basis: 'era-seed' }, requiredLevel: null, dungeonQuest: false, playerLevel: 5 }, rules);
    expect(gained.xp.value).toBe(850);
    expect(grantXp(curve, { level: 5, xp: 0 }, 850)).toMatchObject({ level: 5, xp: 850 });
  });

  it('21: then grind to level 6, mobLevel null → 28 kills of 70 XP; 840 s; level 6 with 10 XP; upper bound; SIM-2 and SIM-11 uncertain', () => {
    const result = grind({ until: { kind: 'level', level: 6, offset: null }, mobLevel: null, xpPerHour: null, state: { level: 5, xp: 850 }, unknownXpEvents: 1 }, curve, rules);
    expect(result).toMatchObject({
      kills: 28,
      seconds: { value: 840, basis: 'assumption', eraFallback: true },
      xpGained: { value: 1960 },
      state: { level: 6, xp: 10 },
      resetsUnknownXp: true,
      upperBound: true,
    });
    expect(result.facts).toEqual([{ kind: 'grind-upper-bound' }, { kind: 'target-level-late', seconds: 840, uncertain: true }]);
  });

  it('26: level 9, 0 XP; to 10-300 at 40,000 XP/h → T 27,300; deficit 6,200; 558 s; level 9 with 6,200', () => {
    const result = grind({ until: { kind: 'level', level: 10, offset: { kind: 'xpShort', xp: 300 } }, mobLevel: null, xpPerHour: 40_000, state: { level: 9, xp: 0 }, unknownXpEvents: 0 }, curve, rules);
    expect(result).toMatchObject({ seconds: { value: 558 }, xpGained: { value: 6200 }, state: { level: 9, xp: 6200 }, kills: null, resetsUnknownXp: false, facts: [] });
  });

  it('27: level 10, 0 XP; to 10.5 at 40,000 XP/h → deficit 3,800; 342 s; level 10 with 3,800', () => {
    const result = grind({ until: { kind: 'level', level: 10, offset: { kind: 'fraction', fraction: 0.5 } }, mobLevel: null, xpPerHour: 40_000, state: { level: 10, xp: 0 }, unknownXpEvents: 0 }, curve, rules);
    expect(result).toMatchObject({ seconds: { value: 342 }, state: { level: 10, xp: 3800 } });
  });

  it('28: level 9, 6,000 XP; to 10+2500 at 40,000 XP/h → T 30,100; deficit 3,000; 270 s; level 10 with 2,500', () => {
    const result = grind({ until: { kind: 'level', level: 10, offset: { kind: 'xpInto', xp: 2500 } }, mobLevel: null, xpPerHour: 40_000, state: { level: 9, xp: 6000 }, unknownXpEvents: 0 }, curve, rules);
    expect(result).toMatchObject({ seconds: { value: 270 }, xpGained: { value: 3000 }, state: { level: 10, xp: 2500 } });
  });

  it('29: to 60+1 with maxLevel 60 → unreachable; duration unknown; time-unknown (SIM-15)', () => {
    const result = grind({ until: { kind: 'level', level: 60, offset: { kind: 'xpInto', xp: 1 } }, mobLevel: null, xpPerHour: null, state: { level: 50, xp: 0 }, unknownXpEvents: 1 }, curve, rules);
    expect(result).toMatchObject({ seconds: { value: null, basis: 'unknown' }, state: { level: 50, xp: 0 }, resetsUnknownXp: false });
    expect(result.facts).toEqual([{ kind: 'time-unknown', part: 'grind', reason: 'above-max-level', questId: null, objective: null }]);
  });

  it('a target at or below the current total does nothing and resets nothing', () => {
    const result = grind({ until: { kind: 'level', level: 5, offset: null }, mobLevel: null, xpPerHour: null, state: { level: 5, xp: 850 }, unknownXpEvents: 3 }, curve, rules);
    expect(result).toMatchObject({ seconds: { value: 0 }, kills: 0, resetsUnknownXp: false, facts: [] });
  });

  it('0 XP per hour makes a level target unreachable (review SIM-04); only null runs the kill loop', () => {
    const result = grind({ until: { kind: 'level', level: 10, offset: null }, mobLevel: null, xpPerHour: 0, state: { level: 9, xp: 0 }, unknownXpEvents: 0 }, curve, rules);
    expect(result).toMatchObject({ seconds: { value: null, basis: 'unknown' }, kills: null, state: { level: 9, xp: 0 }, facts: [{ kind: 'grind-zero-rate' }] });
  });

  it('a gray mob makes a level target unreachable', () => {
    const result = grind({ until: { kind: 'level', level: 12, offset: null }, mobLevel: 3, xpPerHour: null, state: { level: 10, xp: 0 }, unknownXpEvents: 0 }, curve, rules);
    expect(result.facts).toEqual([{ kind: 'time-unknown', part: 'grind', reason: 'gray-mob', questId: null, objective: null }]);
  });

  it('a duration target grants floor(S × xpPerHour / 3600), or the kills of floor(S / killSeconds), and never resets', () => {
    const perHour = grind({ until: { kind: 'duration', seconds: 900 }, mobLevel: null, xpPerHour: 10_000, state: { level: 10, xp: 0 }, unknownXpEvents: 1 }, curve, rules);
    expect(perHour).toMatchObject({ seconds: { value: 900 }, xpGained: { value: 2500 }, resetsUnknownXp: false });
    const kills = grind({ until: { kind: 'duration', seconds: 3000 }, mobLevel: null, xpPerHour: null, state: { level: 10, xp: 7500 }, unknownXpEvents: 0 }, curve, rules);
    // 100 kills: 2 at level 10 (95 XP; 7,690 is level 11 with 90), 88 at level 11 (100 XP; level 12 with 90),
    // then 10 at level 12 (105 XP).
    expect(kills).toMatchObject({ kills: 100, xpGained: { value: 190 + 8800 + 1050 }, state: { level: 12, xp: 90 + 1050 } });
  });
});

describe('TIME-T 30: instance entrance edge', () => {
  it('a step on an instance map whose entrance is 350 yd away → 62.5 s to the entrance, 0 s inside', () => {
    const instance = worldMapId(36);
    const graph = seedTravelGraph(
      {
        npc: () => undefined,
        spawns: () => [],
        zone: () => undefined,
        flightMasterIds: [],
        dungeons: [{ dungeonAreaId: areaId(1581), name: 'Test instance', instanceMapId: instance, entrances: [{ point: point(350), frameVerified: true }] }],
      },
      rules,
    );
    const entrance = nearestEntrance(graph, instance, point(0));
    expect(entrance).not.toBeNull();
    if (entrance === null) return;
    const walk = groundTravel(end(0), { point: entrance.outdoor, zoneHint: 0 }, null, travelSpeeds('auto', onFoot, rules), model, rules);
    expect(walk.seconds.value).toBe(62.5);
  });
});
