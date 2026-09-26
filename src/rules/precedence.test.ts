import { describe, expect, it } from 'vitest';
import type { AssumptionKey, AssumptionOverrides } from '../domain/assumptions';
import { ASSUMPTION_RULE_KEYS, effectiveRules, effectiveValue, isMarkedBasis, markedKeys, UNRULED_ASSUMPTION_KEYS } from './precedence';
import { ERA_1_15, FOREVER_BETA, RULE_KEYS } from './ruleset';

describe('precedence (ARCHITECTURE §9.1, SIMULATION §1.2)', () => {
  it('without assumptions every value is the ruleset value with its own provenance', () => {
    const rules = effectiveRules(FOREVER_BETA);
    expect(rules.rulesetId).toBe('forever-beta');
    for (const key of RULE_KEYS) {
      expect(rules.values[key]).toEqual({ ...FOREVER_BETA.values[key], from: 'ruleset' });
    }
  });

  it('a project assumption wins and carries basis assumption, source project (TIME-T 22)', () => {
    const rules = effectiveRules(FOREVER_BETA, { maxLevel: 20 });
    expect(rules.values.maxLevel).toEqual({ value: 20, basis: 'assumption', source: 'project', from: 'project' });
    expect(effectiveValue(FOREVER_BETA, { maxLevel: 20 }, 'maxLevel')).toEqual(rules.values.maxLevel);
    // Everything else is untouched.
    expect(rules.values.questLogCapacity).toEqual({ ...FOREVER_BETA.values.questLogCapacity, from: 'ruleset' });
  });

  it('maps every AssumptionValues field onto the §1.2 parameter names', () => {
    const overrides: Required<AssumptionOverrides> = {
      groupSize: 3,
      groupXp: true,
      maxLevel: 30,
      questLogCapacity: 25,
      runSpeedYps: 8,
      travelDetourFactor: 1.5,
      taxiSpeedYps: 30,
      taxiDetourFactor: 1.6,
      transportWaitSeconds: 90,
      transportRideSeconds: 120,
      interactionSeconds: 4,
      lootSeconds: 1,
      secondsPerKill: 20,
      killsPerObjective: 10,
      secondsPerObjective: 99,
      objectiveConcurrency: 0.25,
      questXpMultiplier: 2,
      dungeonQuestXpMultiplier: 3,
      killXpMultiplier: 0.5,
    };
    const values = effectiveRules(ERA_1_15, overrides).values;
    expect({
      groupSize: values.groupSize.value,
      groupXpEnabled: values.groupXpEnabled.value,
      maxLevel: values.maxLevel.value,
      questLogCapacity: values.questLogCapacity.value,
      runSpeed: values.runSpeed.value,
      groundDetourFactor: values.groundDetourFactor.value,
      taxiSpeed: values.taxiSpeed.value,
      taxiDetourFactor: values.taxiDetourFactor.value,
      transportWaitSeconds: values.transportWaitSeconds.value,
      transportRideSeconds: values.transportRideSeconds.value,
      acceptSeconds: values.acceptSeconds.value,
      turninSeconds: values.turninSeconds.value,
      acceptExtraSeconds: values.acceptExtraSeconds.value,
      lootSeconds: values.lootSeconds.value,
      killSeconds: values.killSeconds.value,
      objectiveKillCount: values.objectiveKillCount.value,
      objectiveConcurrency: values.objectiveConcurrency.value,
      questXpMultiplier: values.questXpMultiplier.value,
      dungeonQuestXpMultiplier: values.dungeonQuestXpMultiplier.value,
      killXpMultiplier: values.killXpMultiplier.value,
    }).toEqual({
      groupSize: 3,
      groupXpEnabled: true,
      maxLevel: 30,
      questLogCapacity: 25,
      runSpeed: 8,
      groundDetourFactor: 1.5,
      taxiSpeed: 30,
      taxiDetourFactor: 1.6,
      transportWaitSeconds: 90,
      transportRideSeconds: 120,
      acceptSeconds: 4,
      turninSeconds: 4,
      acceptExtraSeconds: 2, // interactionSeconds sets acceptSeconds and turninSeconds only
      lootSeconds: 1,
      killSeconds: 20,
      objectiveKillCount: 10,
      objectiveConcurrency: 0.25,
      questXpMultiplier: 2,
      dungeonQuestXpMultiplier: 3,
      killXpMultiplier: 0.5,
    });
    const overridden = RULE_KEYS.filter((key) => values[key].from === 'project');
    expect(overridden).toHaveLength(Object.values(ASSUMPTION_RULE_KEYS).flat().length);
    for (const key of overridden) expect(values[key]).toMatchObject({ basis: 'assumption', source: 'project' });
  });

  it('secondsPerObjective has no rule yet, so it overrides nothing (open question 10.14)', () => {
    expect(ASSUMPTION_RULE_KEYS.secondsPerObjective).toEqual([]);
    const values = effectiveRules(FOREVER_BETA, { secondsPerObjective: 99 }).values;
    expect(RULE_KEYS.filter((key) => values[key].from === 'project')).toEqual([]);
    expect(UNRULED_ASSUMPTION_KEYS).toEqual(['groupSize', 'secondsPerObjective', 'killXpMultiplier']);
  });

  it('ignores keys that are absent or explicitly undefined, and inherited keys', () => {
    const inherited = Object.create({ maxLevel: 5 }) as AssumptionOverrides;
    expect(effectiveRules(FOREVER_BETA, inherited).values.maxLevel.from).toBe('ruleset');
    const withUndefined = { maxLevel: undefined } as unknown as AssumptionOverrides;
    expect(effectiveRules(FOREVER_BETA, withUndefined).values.maxLevel.value).toBe(60);
  });

  it('covers every AssumptionKey', () => {
    const keys: AssumptionKey[] = Object.keys(ASSUMPTION_RULE_KEYS) as AssumptionKey[];
    expect(keys).toHaveLength(19);
  });
});

describe('marked values', () => {
  it('marks assumption and era-assumed, nothing else', () => {
    expect(isMarkedBasis('assumption')).toBe(true);
    expect(isMarkedBasis('era-assumed')).toBe(true);
    expect(isMarkedBasis('client-data')).toBe(false);
    expect(isMarkedBasis('official')).toBe(false);
    expect(isMarkedBasis('reported')).toBe(false);
  });

  it('lists read keys whose effective basis is marked, in RULE_KEYS order without duplicates', () => {
    const forever = effectiveRules(FOREVER_BETA);
    expect(markedKeys(forever, ['killSeconds', 'runSpeed', 'hearthCastSeconds', 'runSpeed', 'maxLevel'])).toEqual(['runSpeed', 'killSeconds']);
    // In era-1.15 the run speed is `reported`; a project override makes maxLevel an assumption.
    const era = effectiveRules(ERA_1_15, { maxLevel: 20 });
    expect(markedKeys(era, ['killSeconds', 'runSpeed', 'maxLevel'])).toEqual(['maxLevel', 'killSeconds']);
  });
});
