import { describe, expect, it } from 'vitest';
import type { Estimated } from '../domain/estimate';
import { stepId, worldMapId } from '../domain/ids';
import { effectiveRules } from '../rules/precedence';
import { ERA_1_15, FOREVER_BETA } from '../rules/ruleset';
import { aggregateRouteMetrics, applyDurationOverride, levelEstimate, type StepEstimate, stepDuration, type TimePart } from './estimate';
import { interactionTime } from './interaction';
import { ASSUMPTION, combine, eraSeedInput, mergeKeys, ruleInput, SOURCE, sumEstimates, UNKNOWN, withBasis } from './provenance';
import { flightTime, type LocalTaxiData, localTaxiRoute } from './taxi';

const forever = effectiveRules(FOREVER_BETA);
const est = (value: number | null, basis: Estimated<number>['basis'] = 'assumption', eraFallback = false): Estimated<number> =>
  value === null ? { value: null, basis: 'unknown', eraFallback: false } : { value, basis, eraFallback };

describe('combination rule (SIMULATION §8)', () => {
  it('unknown wins, then assumption, then derived when computed, else source', () => {
    expect(combine([SOURCE, UNKNOWN, ASSUMPTION])).toEqual(UNKNOWN);
    expect(combine([SOURCE, ASSUMPTION])).toEqual({ basis: 'assumption', eraFallback: false });
    expect(combine([SOURCE, SOURCE])).toEqual({ basis: 'derived', eraFallback: false });
    expect(combine([SOURCE], false)).toEqual({ basis: 'source', eraFallback: false });
    expect(combine([{ basis: 'derived', eraFallback: false }], false)).toEqual({ basis: 'derived', eraFallback: false });
  });

  it('maps rule bases: assumption stays one, era-assumed is a source with the Era fallback, the rest are sources', () => {
    expect(ruleInput({ basis: 'assumption' })).toEqual(ASSUMPTION);
    expect(ruleInput({ basis: 'era-assumed' })).toEqual({ basis: 'source', eraFallback: true });
    for (const basis of ['client-data', 'official', 'reported'] as const) expect(ruleInput({ basis })).toEqual(SOURCE);
  });

  it('era-seed XP is an Era stand-in only in forever-beta', () => {
    expect(eraSeedInput('forever-beta').eraFallback).toBe(true);
    expect(eraSeedInput('era-1.15').eraFallback).toBe(false);
  });

  it('never gives a value with an unknown basis', () => {
    expect(withBasis(5, UNKNOWN)).toEqual({ value: null, basis: 'unknown', eraFallback: false });
    expect(sumEstimates([est(2), est(null)])).toEqual({ value: null, basis: 'unknown', eraFallback: false });
    expect(sumEstimates([est(2, 'source'), est(3, 'derived', true)])).toEqual({ value: 5, basis: 'derived', eraFallback: true });
    expect(sumEstimates([est(2, 'source')])).toEqual(est(2, 'source'));
  });

  it('merges key lists in RULE_KEYS order', () => {
    expect(mergeKeys(['killSeconds', 'runSpeed'], ['maxLevel', 'runSpeed'])).toEqual(['maxLevel', 'runSpeed', 'killSeconds']);
    expect(mergeKeys()).toEqual([]);
    expect(mergeKeys(['killXpMultiplier'], [], ['maxLevel', 'killXpMultiplier'])).toEqual(['maxLevel', 'killXpMultiplier']);
    // The scratch marks are cleared: a second call is not affected by the first.
    expect(mergeKeys(['runSpeed'])).toEqual(['runSpeed']);
  });
});

describe('step duration (TIME-13) and overrides (TIME-8)', () => {
  const parts: TimePart[] = [
    { bucket: 'travel', seconds: est(125, 'assumption', true) },
    { bucket: 'interaction', seconds: est(3) },
    { bucket: 'objective', seconds: est(null) },
    { bucket: 'waiting', seconds: est(60) },
  ];

  it('an unknown part makes the duration unknown; the breakdown keeps the known parts', () => {
    expect(stepDuration(parts)).toEqual({
      duration: { value: null, basis: 'unknown', eraFallback: false },
      breakdown: { travel: 125, combat: 0, interaction: 3, objective: 0, waiting: 60 },
      knownSeconds: 188,
    });
  });

  it('a durationOverride replaces the step’s own work, keeping travel and waiting', () => {
    const overridden = stepDuration(applyDurationOverride(parts, 30, 'objective'));
    expect(overridden.duration).toEqual({ value: 215, basis: 'assumption', eraFallback: true });
    expect(overridden.breakdown).toEqual({ travel: 125, combat: 0, interaction: 0, objective: 30, waiting: 60 });
    expect(() => applyDurationOverride(parts, -1, 'objective')).toThrow(RangeError);
  });

  it('no parts is 0 s', () => {
    expect(stepDuration([]).duration).toEqual({ value: 0, basis: 'derived', eraFallback: false });
  });
});

describe('interaction times (TIME-8)', () => {
  const seconds = (interaction: Parameters<typeof interactionTime>[0], rules = forever) => interactionTime(interaction, rules).part.seconds.value;

  it('accept 3 s first in a visit, 2 s after; turn-in 3 s, +2 s with a reward choice', () => {
    expect(seconds({ kind: 'accept', firstInVisit: true })).toBe(3);
    expect(seconds({ kind: 'accept', firstInVisit: false })).toBe(2);
    expect(seconds({ kind: 'turnin', rewardChoice: false })).toBe(3);
    expect(seconds({ kind: 'turnin', rewardChoice: true })).toBe(5);
  });

  it('vendor 10 s, trainer 10 s, bind 5 s, flight master 3 s, note and abandon 0 s', () => {
    expect([{ kind: 'vendor' }, { kind: 'train' }, { kind: 'bind' }, { kind: 'flight-master' }, { kind: 'note' }, { kind: 'abandon' }].map((i) => seconds(i as never))).toEqual([
      10, 10, 5, 3, 0, 0,
    ]);
    expect(interactionTime({ kind: 'note' }, forever).part.seconds.basis).toBe('assumption');
  });

  it('interactionSeconds overrides accept and turn-in, and is listed as used', () => {
    const rules = effectiveRules(ERA_1_15, { interactionSeconds: 6 });
    expect(seconds({ kind: 'turnin', rewardChoice: true }, rules)).toBe(8);
    expect(interactionTime({ kind: 'accept', firstInVisit: true }, rules).used).toEqual(['acceptSeconds']);
  });
});

describe('local flight times (TIME-6)', () => {
  // Synthetic legs between invented node ids (never a real extraction).
  const data: LocalTaxiData = {
    build: 'test',
    legs: [
      { from: 1, to: 2, l3dYards: 1000 },
      { from: 2, to: 3, l3dYards: 1000 },
      { from: 1, to: 4, l3dYards: 1500 },
      { from: 4, to: 3, l3dYards: 500 },
      { from: 1, to: 3, l3dYards: 2600 },
    ],
  };

  it('takes the shortest journey through usable nodes; ties by fewer legs, then node ids', () => {
    expect(localTaxiRoute(data, 1, 3, () => true)).toEqual({ l3dYards: 2000, nodes: [1, 2, 3] });
    expect(localTaxiRoute(data, 1, 3, (id) => id !== 2)).toEqual({ l3dYards: 2000, nodes: [1, 4, 3] });
    expect(localTaxiRoute(data, 1, 3, (id) => id !== 2 && id !== 4)).toEqual({ l3dYards: 2600, nodes: [1, 3] });
    expect(localTaxiRoute(data, 3, 1, () => true)).toBeNull();
    expect(localTaxiRoute(data, 2, 2, () => true)).toEqual({ l3dYards: 0, nodes: [2] });
  });

  it("'auto' uses a covered journey at taxiSpeed; 'straight-line' and uncovered journeys use TIME-5", () => {
    const from = { mapId: worldMapId(1), x: 0, y: 0 };
    const to = { mapId: worldMapId(1), x: 1600, y: 0 };
    const local = { data, usable: () => true };
    const auto = flightTime({ from, to, fromTaxiNodeId: 1, toTaxiNodeId: 3 }, forever, local);
    expect(auto.model).toBe('local');
    expect(auto.nodes).toEqual([1, 2, 3]);
    expect(stepDuration(auto.parts).duration).toEqual({ value: 3 + 2000 / 32, basis: 'assumption', eraFallback: true });
    const straight = { ...forever, values: { ...forever.values, taxiModel: { ...forever.values.taxiModel, value: 'straight-line' as const } } };
    expect(flightTime({ from, to, fromTaxiNodeId: 1, toTaxiNodeId: 3 }, straight, local).model).toBe('straight-line');
    expect(flightTime({ from, to, fromTaxiNodeId: 3, toTaxiNodeId: 1 }, forever, local).model).toBe('straight-line');
    expect(flightTime({ from, to, fromTaxiNodeId: null, toTaxiNodeId: 3 }, forever, local).model).toBe('straight-line');
  });
});

describe('route metrics (ARCHITECTURE §9.3)', () => {
  const step = (index: number, fields: Partial<StepEstimate>): StepEstimate => ({
    stepId: stepId(`step-${String(index)}`),
    index,
    active: true,
    startSec: 0,
    endSec: 0,
    duration: est(0),
    xpGained: est(0, 'derived'),
    xpAfter: 0,
    levelAfter: est(5, 'source'),
    levelIsLowerBound: false,
    breakdown: { travel: 0, combat: 0, interaction: 0, objective: 0, waiting: 0 },
    assumptionsUsed: [],
    facts: [],
    ...fields,
  });

  it('sums the known parts, counts unknowns and pending legs, and gives shares with their basis', () => {
    const metrics = aggregateRouteMetrics(
      [
        step(0, {
          duration: est(1200, 'assumption', true),
          breakdown: { travel: 600, combat: 0, interaction: 0, objective: 600, waiting: 0 },
          xpGained: est(760, 'assumption', true),
          assumptionsUsed: ['runSpeed', 'killSeconds'],
          facts: [{ kind: 'pending-leg' }],
        }),
        step(1, {
          duration: est(null),
          breakdown: { travel: 0, combat: 0, interaction: 600, objective: 0, waiting: 0 },
          xpGained: est(null),
          levelAfter: est(6, 'assumption', true),
          levelIsLowerBound: true,
          assumptionsUsed: ['maxLevel', 'runSpeed'],
        }),
      ],
      { level: 5 },
    );
    expect(metrics).toEqual({
      duration: { value: 1800, basis: 'assumption', eraFallback: true },
      durationIsLowerBound: true,
      stepsWithUnknownTime: 1,
      xpGained: { value: 760, basis: 'assumption', eraFallback: true },
      unknownXpSteps: 1,
      levelReached: { value: 6, basis: 'assumption', eraFallback: true },
      levelIsLowerBound: true,
      xpPerHour: { value: 1520, basis: 'assumption', eraFallback: true },
      shares: {
        travel: { value: 1 / 3, basis: 'assumption', eraFallback: true },
        combatAndObjective: { value: 1 / 3, basis: 'assumption', eraFallback: true },
        interaction: { value: 1 / 3, basis: 'assumption', eraFallback: true },
        waiting: { value: 0, basis: 'assumption', eraFallback: true },
      },
      pendingLegs: 1,
      eraFallback: true,
      assumptionsUsed: ['maxLevel', 'runSpeed', 'killSeconds'],
    });
  });

  it('an empty route reaches its start level with no known time', () => {
    const metrics = aggregateRouteMetrics([], { level: 12 });
    expect(metrics.levelReached).toEqual({ value: 12, basis: 'source', eraFallback: false });
    expect(metrics.xpPerHour.value).toBeNull();
    expect(metrics.shares.travel.value).toBeNull();
  });

  it('levelAfter carries the combined basis of the XP grants so far', () => {
    expect(levelEstimate(7, { basis: 'assumption', eraFallback: true })).toEqual({ value: 7, basis: 'assumption', eraFallback: true });
  });
});
