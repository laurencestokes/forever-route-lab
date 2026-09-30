import { describe, expect, it } from 'vitest';
import { npcId, questId, stepId, worldMapId } from '../domain/ids';
import type { ValidationIssue } from '../domain/issues';
import { fixtureDataset, questRecord } from '../engine/test-helpers';
import { effectiveRules } from '../rules/precedence';
import { FOREVER_BETA } from '../rules/ruleset';
import type { SimFact } from '../sim/facts';
import { factIssues, pendingLegsIssue } from './facts';
import { stateWith } from './test-helpers';

/**
 * Simulation facts to issues (docs/SIMULATION.md §7.7): every fact kind with its code, severity,
 * data and message; the travel warnings merged per step; SIM-22 for pending legs.
 */

const STEP = stepId('step-1');
const RULES = effectiveRules(FOREVER_BETA);
const NAMES = fixtureDataset({ quests: [questRecord(790, { name: 'Sarkoth' })] });

function issues(facts: readonly SimFact[], state = stateWith()): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  factIssues(STEP, facts, state, { rules: RULES, names: NAMES, taxiName: (key) => (key === 'npc:3310' ? 'Doras' : null) }, out);
  return out;
}

const one = (fact: SimFact, state = stateWith()): ValidationIssue => {
  const found = issues([fact], state);
  expect(found).toHaveLength(1);
  const [issue] = found;
  if (issue === undefined) throw new Error('no issue');
  return issue;
};

describe('fact to issue', () => {
  it('maps every issue-bearing fact kind to its code', () => {
    const q = questId(790);
    const cases: [SimFact, string][] = [
      [{ kind: 'unknown-xp', questId: q, reason: 'no-record' }, 'SIM001-unknown-xp'],
      [{ kind: 'grind-upper-bound' }, 'SIM002-grind-upper-bound'],
      [{ kind: 'unresolved-location' }, 'SIM003-unresolved-location'],
      [{ kind: 'cross-world-no-transport', fromMapId: worldMapId(1), toMapId: worldMapId(0) }, 'SIM004-cross-world-no-transport'],
      [{ kind: 'hearth-cooldown', waitSeconds: 1810, upperBound: false }, 'SIM005-hearth-cooldown'],
      [{ kind: 'hearth-cooldown', waitSeconds: 1810, upperBound: true }, 'SIM005-hearth-cooldown-uncertain'],
      [{ kind: 'hearth-unbound' }, 'SIM006-hearth-unbound'],
      [{ kind: 'flight-unknown-path', end: 'to', node: 'npc:3310' }, 'SIM007-flight-unknown-path'],
      [{ kind: 'flight-no-known-journey' }, 'SIM007-flight-unknown-path-journey'],
      [{ kind: 'flight-unresolved', end: 'from', reason: 'several-nodes' }, 'SIM008-flight-unresolved'],
      [{ kind: 'mount-untrained' }, 'SIM009-mount-untrained'],
      [{ kind: 'riding-too-low', tier: 1, requiredLevel: 40, level: 38, uncertain: false }, 'SIM010-riding-too-low'],
      [{ kind: 'riding-too-low', tier: 2, requiredLevel: 60, level: 45, uncertain: true }, 'SIM010-riding-too-low-uncertain'],
      [{ kind: 'target-level-late', seconds: 840, uncertain: false }, 'SIM011-target-level-late'],
      [{ kind: 'target-level-late', seconds: 840, uncertain: true }, 'SIM011-target-level-late-uncertain'],
      [{ kind: 'objective-already-done', questId: q, objective: 0 }, 'SIM012-objective-already-done'],
      [{ kind: 'condition-unknown' }, 'SIM013-condition-unknown'],
      [{ kind: 'transport-faction', transportId: 'zeppelin-og-uc' }, 'SIM014-transport-faction'],
      [{ kind: 'flight-faction', end: 'to', node: 'npc:3310' }, 'SIM024-flight-faction'],
      [{ kind: 'time-unknown', part: 'objective', reason: 'reputation-objective', questId: q, objective: 1 }, 'SIM015-time-unknown'],
      [{ kind: 'grind-zero-rate' }, 'SIM015-time-unknown'],
      [{ kind: 'complete-not-in-log', questId: q }, 'SIM016-complete-not-in-log'],
      [{ kind: 'objectives-incidental', questId: q, objectives: [0, 2] }, 'VAL030-objectives-incidental'],
      [{ kind: 'objectives-carried', questId: q, objectives: [0, 2], time: 'counted', killXp: { value: 760, basis: 'assumption', eraFallback: true }, level: 10, levelBasis: 'assumption', levelEraFallback: true }, 'VAL030-objectives-carried'],
      [{ kind: 'travel-warning', warning: { kind: 'no-walking-path' } }, 'SIM017-no-walking-path'],
      [{ kind: 'travel-warning', warning: { kind: 'off-navmesh', end: 'from' } }, 'SIM018-off-navmesh'],
      [{ kind: 'travel-warning', warning: { kind: 'unverified-passage', passages: ['Undercity west tunnel'] } }, 'SIM019-unverified-passage'],
      [{ kind: 'travel-warning', warning: { kind: 'ambiguous-floor' } }, 'SIM020-ambiguous-floor'],
      [{ kind: 'travel-warning', warning: { kind: 'long-swim', longestSwimYd: 240.4 } }, 'SIM021-long-swim'],
    ];
    for (const [fact, code] of cases) expect(one(fact).code, fact.kind).toBe(code);
  });

  it('records no issue for pending legs (route-level SIM-22), assumed mob levels (KXP-4), moves from an unknown position (TIME-2), items counted at an accept (D-040) or a ride (TIME-7)', () => {
    expect(
      issues([
        { kind: 'pending-leg' },
        { kind: 'mob-level-assumed', npcId: npcId(3098) },
        { kind: 'position-unknown', cause: 'start-unset' },
        { kind: 'objectives-before-accept', questId: questId(790), objectives: [0] },
        { kind: 'transport-ride', transportId: 'stormwind-auberdine', edgeId: 'stormwind-auberdine:0>1', name: 'Stormwind Harbor – Auberdine ship', docks: [], berthWalk: true },
      ]),
    ).toEqual([]);
  });

  it('names the flight point a faction may not use (SIM-24), and says why the straight line stands in (SIM-7 variant)', () => {
    expect(one({ kind: 'flight-faction', end: 'to', node: 'npc:3310' })).toMatchObject({
      severity: 'warning',
      data: { end: 'to', node: 'npc:3310' },
      message: "The flight's destination node, Doras (npc:3310), is not open to the character's faction; the flight is still timed.",
    });
    expect(one({ kind: 'flight-no-known-journey' })).toMatchObject({ severity: 'warning', data: null });
  });

  it('writes messages and data with explicit nulls', () => {
    expect(one({ kind: 'unknown-xp', questId: questId(790), reason: 'unknown-level' })).toEqual({
      code: 'SIM001-unknown-xp',
      severity: 'info',
      stepId: STEP,
      questId: 790,
      message: 'Sarkoth (790) gives an unknown amount of XP; the levels after it are lower bounds.',
      data: { reason: 'unknown-level' },
    });
    expect(one({ kind: 'hearth-unbound' })).toEqual({
      code: 'SIM006-hearth-unbound',
      severity: 'warning',
      stepId: STEP,
      questId: null,
      message: 'The hearthstone is used with no bind point that can be placed on the map; the destination is unknown.',
      data: null,
    });
    expect(one({ kind: 'hearth-cooldown', waitSeconds: 1810, upperBound: false }).message).toBe('The hearthstone is on cooldown; the route waits 30 min 10 s for it.');
    expect(one({ kind: 'hearth-cooldown', waitSeconds: 3600, upperBound: true })).toMatchObject({
      data: { waitSeconds: 3600 },
      message: 'The hearthstone may still be on cooldown: the route waits up to 1 h. An earlier step has an unknown time, so the wait is unknown.',
    });
    expect(one({ kind: 'grind-zero-rate' })).toMatchObject({
      data: { part: 'grind', reason: 'zero-rate', objective: null },
      message: 'The grind time of this step cannot be estimated: at 0 XP per hour the grind never reaches its target.',
    });
    expect(one({ kind: 'flight-unknown-path', end: 'to', node: 'npc:3310' }).message).toBe("Not a known flight path: the flight's destination node, Doras (npc:3310).");
    expect(one({ kind: 'flight-unknown-path', end: 'from', node: 'taxi:1' }).message).toBe("Not a known flight path: the flight's departure node, taxi:1.");
    expect(one({ kind: 'flight-unresolved', end: 'from', reason: 'several-nodes' }).message).toBe("The flight's departure cannot be resolved: several flight nodes match.");
    expect(one({ kind: 'objectives-incidental', questId: questId(790), objectives: [0, 2] }).message).toBe(
      'Sarkoth (790) is turned in, but no step finishes objectives 1 and 3; assumed completed along the way.',
    );
    // D-040: the carried work's message says what the turn-in counts, what it does not, and what to add.
    const carried = (objectives: readonly number[], time: 'counted' | 'overridden' | 'unknown'): SimFact => ({
      kind: 'objectives-carried',
      questId: questId(790),
      objectives,
      time,
      killXp: { value: 760, basis: 'assumption', eraFallback: true },
      level: 10,
      levelBasis: 'assumption',
      levelEraFallback: true,
    });
    expect(one(carried([0], 'counted'))).toEqual({
      code: 'VAL030-objectives-carried',
      severity: 'warning',
      stepId: STEP,
      questId: 790,
      message:
        'Sarkoth (790) is turned in, but no step finishes objective 1: the time and kill XP of that work are added to the turn-in, without the travel to it. Add a Complete step where the work is done.',
      data: { objectives: '0', time: 'counted' },
    });
    expect(one(carried([0, 1], 'counted')).message).toBe(
      'Sarkoth (790) is turned in, but no step finishes objectives 1 and 2: the time and kill XP of that work are added to the turn-in, without the travel to it. Add a Complete step where the work is done.',
    );
    // Review D40-03: an override stands in for the time, and an unknown time is not claimed as added.
    expect(one(carried([0], 'overridden'))).toMatchObject({
      message:
        "Sarkoth (790) is turned in, but no step finishes objective 1: the kill XP of that work is added to the turn-in, and the step's duration override stands in for its time. Add a Complete step where the work is done.",
      data: { objectives: '0', time: 'overridden' },
    });
    expect(one(carried([0, 1], 'unknown')).message).toBe(
      'Sarkoth (790) is turned in, but no step finishes objectives 1 and 2: the kill XP of that work is added to the turn-in, but its time cannot be estimated. Add a Complete step where the work is done.',
    );
    expect(one({ kind: 'objective-already-done', questId: questId(5), objective: null }).message).toBe('Quest 5: every objective is already done.');
    const late = one({ kind: 'target-level-late', seconds: 839.6, uncertain: true });
    expect(late.data).toEqual({ seconds: 840, warnSeconds: 600 });
    expect(late.message).toBe('The grind to the target level takes at most about 14 min, more than 10 min; the XP of an earlier quest is unknown.');
  });

  it('gives a level its basis in SIM-10', () => {
    const issue = one({ kind: 'riding-too-low', tier: 1, requiredLevel: 40, level: 38, uncertain: false }, stateWith({ level: 38, xpBasis: 'assumption', xpEraFallback: true }));
    expect(issue.data).toEqual({ tier: 1, requiredLevel: 40, level: 38, levelBasis: 'assumption', levelEraFallback: true });
    expect(issue.message).toBe('Riding tier 1 needs level 40; the character is level 38, so riding is unchanged.');
  });

  it("merges a step's travel warnings per kind", () => {
    const found = issues([
      { kind: 'travel-warning', warning: { kind: 'unverified-passage', passages: ['Undercity west tunnel'] } },
      { kind: 'travel-warning', warning: { kind: 'off-navmesh', end: 'from' } },
      { kind: 'pending-leg' },
      { kind: 'travel-warning', warning: { kind: 'unverified-passage', passages: ['Ironforge mountain top', 'Undercity west tunnel'] } },
      { kind: 'travel-warning', warning: { kind: 'off-navmesh', end: 'to' } },
      { kind: 'travel-warning', warning: { kind: 'long-swim', longestSwimYd: 210 } },
      { kind: 'travel-warning', warning: { kind: 'long-swim', longestSwimYd: 260.6 } },
      { kind: 'travel-warning', warning: { kind: 'no-walking-path' } },
      { kind: 'travel-warning', warning: { kind: 'no-walking-path' } },
    ]);
    expect(found.map((issue) => [issue.code, issue.data, issue.message])).toEqual([
      [
        'SIM017-no-walking-path',
        { legs: 2 },
        'The navigation data has no walking path for 2 legs of this step, and no transport joins the places; a straight-line estimate is used.',
      ],
      ['SIM018-off-navmesh', { legs: 2, end: 'both' }, 'Off the navigation mesh: the start and end of 2 legs of this step; a straight-line estimate is used.'],
      [
        'SIM019-unverified-passage',
        { legs: 2, passages: 'Ironforge mountain top, Undercity west tunnel' },
        'The path of this step goes through Ironforge mountain top and Undercity west tunnel, which nobody has walked in game yet.',
      ],
      ['SIM021-long-swim', { legs: 2, longestSwimYd: 261 }, 'The path of this step includes a swim of 261 yards; whether fatigue applies is not verified.'],
    ]);
  });

  it('SIM-22 counts pending legs and their steps', () => {
    expect(pendingLegsIssue(3, 2)).toEqual({
      code: 'SIM022-legs-pending',
      severity: 'info',
      stepId: null,
      questId: null,
      message: 'Travel legs still being computed: 3 on 2 steps; their times are straight-line estimates until then.',
      data: { legs: 3, steps: 2 },
    });
  });
});
