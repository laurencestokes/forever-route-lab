import { describe, expect, it } from 'vitest';
import type { StepCondition } from '../domain/conditions';
import { estimate } from '../domain/estimate';
import { npcId, type QuestId, questId, stepId } from '../domain/ids';
import type { ValidationIssue } from '../domain/issues';
import type { CustomQuest } from '../domain/project';
import type { RouteStep } from '../domain/route';
import {
  makeAbandonStep,
  makeAcceptStep,
  makeCompleteStep,
  makeGrindStep,
  makeHearthStep,
  makeTravelStep,
  makeTurnInStep,
  makeVendorStep,
} from '../domain/step-factory';
import type { TravelLeg, TravelModel } from '../domain/travel';
import {
  at,
  EASTERN_KINGDOMS,
  fixtureContext,
  type FixtureContextOptions,
  fixtureDataset,
  fixtureProject,
  itemObjective,
  itemRecord,
  killObjective,
  npcRecord,
  point,
  questRecord,
  spawnAt,
  testIds,
} from '../engine/test-helpers';
import type { EngineContext, StepDelta, WalkProject } from '../engine/types';
import { createRouteWalker } from '../engine/walker';
import { effectiveRules } from '../rules/precedence';
import { FOREVER_BETA } from '../rules/ruleset';
import { issueCodeSpec, isRegisteredCode } from './codes';
import { turnInIssues } from './quest-steps';
import { createRouteValidator, validateRoute, type ValidateRouteOptions } from './validator';

/**
 * The validator on walked routes (docs/SIMULATION.md §7, ARCHITECTURE §9.4): the TIME-T rows the
 * validator owns (20, 31, 32), turn-in, abandon and objective-work checks with their variants,
 * simulation facts through a walk, route-level issues, the issue shape, stable order, and
 * re-validation after an edit. Record numbers are made up for the tests.
 */

const q = questId;
const ids = testIds();
const GIVER = { kind: 'npc', id: npcId(10) } as const;

const DATA = fixtureDataset({
  quests: [
    questRecord(100, { objectives: [killObjective(1)], starters: [GIVER], finishers: [GIVER] }),
    questRecord(101, { minLevel: 6, starters: [GIVER], finishers: [GIVER] }),
    questRecord(102, { minLevel: 7, starters: [GIVER], finishers: [GIVER] }),
    questRecord(200, { xp: null, starters: [GIVER], finishers: [GIVER] }),
    questRecord(201, { minLevel: 8 }),
    questRecord(202),
    questRecord(203, { minLevel: 9 }),
    questRecord(300, { prerequisites: { ...questRecord(1).prerequisites, preQuestSingle: [q(301)] } }),
    questRecord(301),
    questRecord(400, { level: 2, xp: { questLevel: 2, baseXp: 170, basis: 'era-seed' }, finishers: [GIVER] }),
    questRecord(401, { level: 4, xp: { questLevel: 4, baseXp: 400, basis: 'era-seed' } }),
    questRecord(402, { level: 5, xp: { questLevel: 5, baseXp: 450, basis: 'era-seed' } }),
    questRecord(403, { level: 2, xp: null }),
    questRecord(500, { flags: { repeatable: false, needsEvent: true, questFlags: 0, specialFlags: 2 } }),
    questRecord(600, { finishers: [GIVER] }),
    questRecord(700, { xp: { questLevel: 19, baseXp: 1000, basis: 'era-seed' } }),
    questRecord(701, { minLevel: 22, level: 22, xp: { questLevel: 22, baseXp: 2000, basis: 'era-seed' } }),
    questRecord(702, { minLevel: 15, maxLevel: 20, level: 20, xp: { questLevel: 20, baseXp: 2000, basis: 'era-seed' } }),
    questRecord(800, { level: 4, xp: { questLevel: 4, baseXp: 400, basis: 'era-seed' }, objectives: [killObjective(2)], starters: [GIVER], finishers: [GIVER] }),
    questRecord(801, { objectives: [itemObjective(900)], starters: [GIVER], finishers: [GIVER] }),
  ],
  npcs: [npcRecord(1), npcRecord(2, { minLevel: 9, maxLevel: 9 }), npcRecord(10), npcRecord(11)],
  items: [itemRecord(900, [1])],
  spawns: { 'npc:10': [spawnAt(point(100))], 'npc:11': [spawnAt(point(200))] },
});

const context = (options: FixtureContextOptions = {}): EngineContext => fixtureContext(DATA, options);

function validate(steps: readonly RouteStep[], options: Parameters<typeof fixtureProject>[1] = {}, ctx = context(), extra: ValidateRouteOptions = {}) {
  return validateRoute(fixtureProject(steps, options), ctx, extra);
}

/** `index code questId` per issue (index into `steps`, `route` for route-level issues). */
function summary(steps: readonly RouteStep[], issues: readonly ValidationIssue[]): string[] {
  const index = new Map(steps.map((step, i) => [step.id, i]));
  return issues.map((issue) => `${issue.stepId === null ? 'route' : String(index.get(issue.stepId))} ${issue.code}${issue.questId === null ? '' : ` ${String(issue.questId)}`}`);
}

function run(steps: readonly RouteStep[], options: Parameters<typeof fixtureProject>[1] = {}, ctx = context(), extra: ValidateRouteOptions = {}): string[] {
  return summary(steps, validate(steps, options, ctx, extra).issues);
}

const accept = (id: number, fields: Partial<Parameters<typeof makeAcceptStep>[1]> = {}) => makeAcceptStep(ids, { questId: q(id), ...fields });
const turnIn = (id: number, fields: Partial<Parameters<typeof makeTurnInStep>[1]> = {}) => makeTurnInStep(ids, { questId: q(id), ...fields });
const complete = (id: number, objective: number | null = null) => makeCompleteStep(ids, { targets: [{ questId: q(id), objective }] });

describe('the TIME-T rows of the validator (SIMULATION §6.9)', () => {
  it('rows 18-21: unknown XP makes VAL-4 uncertain until a grind to a level makes the level known again', () => {
    const steps = [
      accept(200),
      turnIn(200),
      accept(202),
      turnIn(202),
      accept(101),
      makeGrindStep(ids, { until: { kind: 'level', level: 6, offset: null } }),
      accept(102),
    ];
    const result = validate(steps, { character: { startLevel: 5, priorHistory: 'fresh' } });
    expect(summary(steps, result.issues)).toEqual([
      '1 SIM001-unknown-xp 200',
      '4 VAL004-min-level-uncertain 101',
      '5 SIM002-grind-upper-bound',
      '5 SIM011-target-level-late-uncertain',
      '6 VAL004-min-level 102',
    ]);
    expect(result.walk.records[3]?.estimate.xpAfter).toBe(850);
    const uncertain = result.issues[1];
    expect(uncertain?.severity).toBe('warning');
    expect(uncertain?.message).toBe('Quest 101 (101) needs level 6; the character is at least level 5, but the XP of an earlier quest is unknown.');
    // Row 21: 1,950 XP short, 28 kills of 70 XP, 840 s over the 600 s warning limit, an upper bound.
    expect(result.issues[3]?.data).toEqual({ seconds: 840, warnSeconds: 600 });
    expect(result.issues[3]?.message).toBe('The grind to the target level takes at most about 14 min, more than 10 min; the XP of an earlier quest is unknown.');
  });

  it('row 31: an unmet prerequisite is -unverifiable with an unknown history, an error with a listed one; the quest is accepted', () => {
    const steps = [accept(300)];
    const unknown = validate(steps, { character: { priorHistory: 'unknown' } });
    expect(summary(steps, unknown.issues)).toEqual(['0 VAL008-prequest-single-unverifiable 300']);
    expect(unknown.walk.final.questLog.has(q(300))).toBe(true);
    expect(run(steps, { character: { priorHistory: 'listed' } })).toEqual(['0 VAL008-prequest-single 300']);
    expect(run(steps, { character: { priorHistory: 'listed', priorCompletedQuests: [q(301)] } })).toEqual([]);
  });

  it('row 32: an any-of accept takes the first candidate without an error, with no issue for the others', () => {
    const steps = [accept(201, { anyOf: [q(201), q(202)] })];
    const result = validate(steps, { character: { startLevel: 5 } });
    expect(result.issues).toEqual([]);
    expect(result.walk.records[0]?.delta.accepted).toBe(202);
  });

  it("any-of: the chosen candidate's warnings and infos; questId's errors when every candidate fails", () => {
    expect(run([accept(201, { anyOf: [q(500)] })], { character: { startLevel: 5 } })).toEqual(['0 VAL022-needs-event 500']);
    expect(run([accept(201, { anyOf: [q(203)] })], { character: { startLevel: 5 } })).toEqual(['0 VAL004-min-level 201']);
  });
});

describe('turn-in (VAL-30, LINT-4)', () => {
  it('a quest not in the log is an error; with an unknown history it is assumed in the log (-unverifiable)', () => {
    expect(run([turnIn(100)])).toEqual(['0 VAL030-not-in-log 100']);
    expect(run([turnIn(100)], { character: { priorHistory: 'unknown' } })).toEqual(['0 VAL030-not-in-log-unverifiable 100', '0 VAL030-objectives-incidental 100']);
  });

  it('a skip-if-missing turn-in of a quest not in the log is skipped without an issue', () => {
    expect(run([turnIn(100, { skipIfMissing: true })])).toEqual([]);
  });

  it('objectives no step finishes are carried for a quest the route accepted, incidental for a pre-route one; a finished quest is clean', () => {
    expect(run([accept(100), turnIn(100)])).toEqual(['1 VAL030-objectives-carried 100']);
    expect(run([accept(100), complete(100), turnIn(100)])).toEqual([]);
    expect(run([turnIn(100)], { character: { priorQuestLog: [q(100)] } })).toEqual(['0 VAL030-objectives-incidental 100']);
  });

  it('carried work (D-040): the warning says what the turn-in counts; LINT-4 reads the level after the carried kill XP', () => {
    const carried = validate([accept(100), turnIn(100)], { character: { startLevel: 10 } });
    expect(carried.issues).toEqual([
      {
        code: 'VAL030-objectives-carried',
        severity: 'warning',
        stepId: carried.walk.records[1]?.step.id,
        questId: 100,
        message:
          'Quest 100 (100) is turned in, but no step finishes objective 1: the time and kill XP of that work are added to the turn-in, without the travel to it. Add a Complete step where the work is done.',
        data: { objectives: '0', time: 'counted' },
      },
    ]);
    // Level 9, 100 XP short of 10: 8 kills of level-9 mobs (720 XP) level the character up before the
    // turn-in, so quest 800 (level 4) is turned in 6 levels above its level, as after a Complete step.
    const need = effectiveRules(FOREVER_BETA).values.xpToNextLevel.value[8] ?? 0;
    const character = { character: { startLevel: 9, startXp: need - 100 } };
    const steps = [accept(800), turnIn(800)];
    const viaTurnIn = validate(steps, character);
    const viaComplete = validate([accept(800), complete(800), turnIn(800)], character);
    const lint = (issues: readonly ValidationIssue[]) => issues.find((issue) => issue.code === 'LINT004-xp-reduced');
    expect(summary(steps, viaTurnIn.issues)).toEqual(['0 LINT003-low-value 800', '1 LINT004-xp-reduced 800', '1 VAL030-objectives-carried 800']);
    expect(lint(viaTurnIn.issues)?.data).toMatchObject({ level: 10, levelBasis: 'assumption', percent: 80 });
    expect(lint(viaTurnIn.issues)?.data).toEqual(lint(viaComplete.issues)?.data);
    expect(viaTurnIn.walk.final).toEqual(viaComplete.walk.final);
  });

  it('carried work with a duration override says the override stands in for its time (review D40-03)', () => {
    const steps = [accept(100), turnIn(100, { durationOverride: 7 })];
    const result = validate(steps, { character: { startLevel: 10 } });
    expect(summary(steps, result.issues)).toEqual(['1 VAL030-objectives-carried 100']);
    expect(result.issues[0]).toMatchObject({
      message:
        "Quest 100 (100) is turned in, but no step finishes objective 1: the kill XP of that work is added to the turn-in, and the step's duration override stands in for its time. Add a Complete step where the work is done.",
      data: { objectives: '0', time: 'overridden' },
    });
  });

  it('items collected before the accept: SIM016 on that step, and the turn-in carries nothing (review D40-01)', () => {
    const steps = [complete(801), accept(801), turnIn(801)];
    expect(run(steps)).toEqual(['0 SIM016-complete-not-in-log 801']);
    // Kills before the accept do not count toward the quest, so the turn-in still carries them.
    expect(run([complete(100), accept(100), turnIn(100)])).toEqual(['0 SIM016-complete-not-in-log 100', '2 VAL030-objectives-carried 100']);
  });

  it('a turn-in at an entity that is not a finisher is a warning', () => {
    expect(run([accept(600), turnIn(600, { via: { kind: 'npc', id: npcId(10) } })])).toEqual([]);
    const steps = [accept(600), turnIn(600, { via: { kind: 'npc', id: npcId(11) } })];
    const issue = validate(steps).issues[0];
    expect(issue?.code).toBe('VAL030-finisher-mismatch');
    expect(issue?.data).toEqual({ viaKind: 'npc', viaId: 11 });
    expect(issue?.message).toBe('Quest 600 (600) is turned in at NPC 11, which is not one of its finishers.');
  });

  it('a failed quest cannot be turned in (VAL030-failed; nothing in the route model fails a quest yet)', () => {
    const step = turnIn(100);
    const delta = { questId: q(100), turnedIn: null, assumedInLog: [] } as unknown as StepDelta;
    const out: ValidationIssue[] = [];
    turnInIssues(step, delta, { failed: true, level: 10, levelBasis: 'source', levelEraFallback: false }, DATA, effectiveRules(FOREVER_BETA), out);
    expect(out.map((issue) => issue.code)).toEqual(['VAL030-failed']);
  });

  it('LINT-4: from 6 levels above the quest the reduced XP is a warning with the XP lost; unknown XP keeps its percent', () => {
    const steps = [accept(400), turnIn(400), accept(401), turnIn(401), accept(402), turnIn(402), accept(403), turnIn(403)];
    const result = validate(steps, { character: { startLevel: 10 } });
    const reduced = result.issues.filter((issue) => issue.code === 'LINT004-xp-reduced');
    expect(summary(steps, result.issues)).toEqual([
      '0 LINT003-low-value 400',
      '1 LINT004-xp-reduced 400',
      '2 LINT003-low-value 401',
      '3 LINT004-xp-reduced 401',
      '6 LINT003-low-value 403',
      '7 LINT004-xp-reduced 403',
      '7 SIM001-unknown-xp 403',
    ]);
    expect(reduced[0]?.data).toEqual({
      level: 10,
      levelBasis: 'source',
      levelEraFallback: false,
      questLevel: 2,
      percent: 40,
      xp: 70,
      fullXp: 170,
      xpLost: 100,
      xpBasis: 'assumption',
      eraFallback: true,
      assumed: 'questXpRounding,questXpMultiplier',
    });
    expect(reduced[0]?.message).toBe('Quest 400 (400) is turned in 8 levels above its level 2: it gives 40% of its XP, 100 XP less.');
    expect(reduced[1]?.data).toMatchObject({ questLevel: 4, percent: 80, xp: 320, fullXp: 400, xpLost: 80 });
    expect(reduced[2]?.data).toMatchObject({ questLevel: 2, percent: 40, xp: null, fullXp: null, xpLost: null, xpBasis: 'unknown' });
    expect(reduced[2]?.message).toBe('Quest 403 (403) is turned in 8 levels above its level 2: it gives 40% of its XP.');
  });
});

describe('abandon (VAL-32) and objective work (SIM-16)', () => {
  it('VAL-32: abandoning a quest in the log is clean; one not in the log is an error or, with an unknown history, -unverifiable', () => {
    expect(run([accept(100), makeAbandonStep(ids, { questId: q(100) })])).toEqual([]);
    expect(run([makeAbandonStep(ids, { questId: q(100) })])).toEqual(['0 VAL032-not-in-log 100']);
    expect(run([makeAbandonStep(ids, { questId: q(100) })], { character: { priorHistory: 'unknown' } })).toEqual(['0 VAL032-not-in-log-unverifiable 100']);
  });

  it('SIM-16: work on a quest not in the log; with an unknown history, -unverifiable; an unknown quest is DATA002 too', () => {
    expect(run([accept(100), complete(100)])).toEqual([]);
    expect(run([complete(100)])).toEqual(['0 SIM016-complete-not-in-log 100']);
    expect(run([complete(100)], { character: { priorHistory: 'unknown' } })).toEqual(['0 SIM016-complete-not-in-log-unverifiable 100']);
    expect(run([complete(999)], { character: { priorHistory: 'unknown' } })).toEqual(['0 DATA002-unknown-quest 999', '0 SIM016-complete-not-in-log-unverifiable 999']);
    expect(run([accept(100), complete(100), complete(100, 0)])).toEqual(['2 SIM012-objective-already-done 100']);
  });

  it('DATA003: a target naming an objective its quest does not have (the unknown work time is explained)', () => {
    const steps = [accept(100), complete(100, 3)];
    const result = validate(steps);
    expect(summary(steps, result.issues)).toEqual(['1 DATA003-unknown-objective 100']);
    expect(result.issues[0]).toMatchObject({ severity: 'warning', data: { objective: 3, objectives: 1 }, message: 'Quest 100 (100) has no objective 4; its work in this step cannot be priced.' });
    expect(result.walk.records[1]?.estimate.duration.value).toBeNull();
  });

  it('DATA002 on accept, turn-in and abandon of a quest the dataset does not know', () => {
    expect(run([accept(999), turnIn(999), makeAbandonStep(ids, { questId: q(999) })])).toEqual([
      '0 DATA002-unknown-quest 999',
      '1 DATA002-unknown-quest 999',
      '1 SIM001-unknown-xp 999',
      '2 DATA002-unknown-quest 999',
      '2 VAL032-not-in-log 999',
    ]);
  });
});

describe('simulation facts through a walk (SIM-1..22)', () => {
  it('hearth, cross-world moves and unknown conditions', () => {
    const opaque: StepCondition = { filter: null, variant: null, skipIf: [{ kind: 'opaque', raw: '.itemcount 4862,10' }] };
    const steps = [
      makeHearthStep(ids),
      makeHearthStep(ids, { mode: 'bind', location: at(100) }),
      makeHearthStep(ids),
      makeHearthStep(ids),
      makeVendorStep(ids, { location: at(0, 0, EASTERN_KINGDOMS) }),
      makeVendorStep(ids, { condition: opaque }),
    ];
    const result = validate(steps);
    expect(summary(steps, result.issues)).toEqual(['0 SIM006-hearth-unbound', '3 SIM005-hearth-cooldown', '4 SIM004-cross-world-no-transport', '5 SIM013-condition-unknown']);
    expect(result.issues[1]?.message).toBe('The hearthstone is on cooldown; the route waits 1 h for it.');
  });

  it('a cooldown wait after a step with unknown time is only an upper bound (SIM005-uncertain; review SIM-07, ENG-09)', () => {
    const steps = [makeHearthStep(ids, { mode: 'bind', location: at(0) }), makeHearthStep(ids), makeVendorStep(ids, { location: at(100, 0, EASTERN_KINGDOMS) }), makeHearthStep(ids)];
    const result = validate(steps);
    expect(summary(steps, result.issues)).toEqual(['2 SIM004-cross-world-no-transport', '3 SIM005-hearth-cooldown-uncertain']);
    expect(result.issues[1]?.message).toBe('The hearthstone may still be on cooldown: the route waits up to 59 min 50 s. An earlier step has an unknown time, so the wait is unknown.');
  });

  it('travel warnings from the travel model (SIM-17..21) and pending legs at route level (SIM-22)', () => {
    const model: TravelModel = {
      id: 'navigation',
      revision: 'test',
      leg: (): TravelLeg => ({
        seconds: estimate(10, 'derived'),
        method: 'navigation',
        pending: true,
        warnings: [{ kind: 'unverified-passage', passages: ['Undercity west tunnel'] }, { kind: 'ambiguous-floor' }],
      }),
      path: () => null,
    };
    const steps = [makeTravelStep(ids, { location: at(700) }), makeTravelStep(ids, { location: at(1400) }), makeVendorStep(ids)];
    const result = validate(steps, {}, context({ travel: model }));
    expect(summary(steps, result.issues)).toEqual([
      'route SIM022-legs-pending',
      '0 SIM019-unverified-passage',
      '0 SIM020-ambiguous-floor',
      '1 SIM019-unverified-passage',
      '1 SIM020-ambiguous-floor',
    ]);
    expect(result.issues[0]?.data).toEqual({ legs: 2, steps: 2 });
    expect(result.issues[1]?.data).toEqual({ legs: 1, passages: 'Undercity west tunnel' });
  });

  it('a final state with every leg computed has no SIM-22', () => {
    expect(run([makeTravelStep(ids, { location: at(700) })])).toEqual([]);
  });
});

describe('the level cap and the start XP (XP-2..XP-4, §7.1; review SIM-01, ENG-11)', () => {
  const capped = context({ assumptions: { maxLevel: 20 } });

  it('at the cap a quest without an XP record gives 0 (LINT-3), not unknown XP, so later level checks stay certain', () => {
    expect(run([accept(200), turnIn(200), accept(702), accept(701)], { character: { startLevel: 20 } }, capped)).toEqual([
      '0 LINT003-low-value 200',
      '1 LINT004-xp-reduced 200',
      '2 LINT003-low-value 702',
      '3 LINT003-low-value 701',
      '3 VAL004-min-level 701',
    ]);
  });

  it('unknown XP before the cap stops mattering once the lower bound reaches the cap: no -uncertain variants', () => {
    expect(run([accept(200), accept(700), turnIn(200), turnIn(700), accept(702), accept(701)], { character: { startLevel: 19, startXp: 21000 } }, capped)).toEqual([
      '0 LINT003-low-value 200',
      '1 LINT003-low-value 700',
      '2 LINT004-xp-reduced 200',
      '2 SIM001-unknown-xp 200',
      '4 LINT003-low-value 702',
      '5 LINT003-low-value 701',
      '5 VAL004-min-level 701',
    ]);
  });

  it('SIM-23: a start XP beyond the start level is carried over, with a route-level warning', () => {
    const steps = [makeVendorStep(ids, { location: at(0) })];
    const result = validate(steps, { character: { startLevel: 5, startXp: 50000 } });
    expect(result.issues).toEqual([
      {
        code: 'SIM023-start-xp-beyond-level',
        severity: 'warning',
        stepId: null,
        questId: null,
        message: 'The start XP, 50000, is more than level 5 holds; the route starts at level 13 with 700 XP.',
        data: { startLevel: 5, startXp: 50000, level: 13, xp: 700 },
      },
    ]);
    expect(validate(steps, { character: { startLevel: 5, startXp: 2799 } }).issues).toEqual([]);
  });
});

describe('route-level issues, shape and order', () => {
  it('DATA001: a custom quest with a real id that replaces a dataset quest (with the base dataset given)', () => {
    const custom = { ...questRecord(100, { name: 'My Cutting Teeth' }), provenance: { ...questRecord(100).provenance, source: 'custom' }, starterLocation: null, finisherLocation: null } as CustomQuest;
    const invented = { ...custom, id: q(-1) };
    const project: WalkProject = { ...fixtureProject([]), customQuests: [custom, invented] };
    const base = fixtureDataset({ quests: [questRecord(100)] });
    const result = validateRoute(project, context(), { baseDataset: base });
    expect(result.issues).toEqual([
      { code: 'DATA001-custom-shadowed', severity: 'info', stepId: null, questId: 100, message: 'The custom quest Quest 100 (100) replaces the dataset quest with the same id.', data: null },
    ]);
    expect(validateRoute(project, context()).issues).toEqual([]);
  });

  it('every issue has the fixed shape with explicit nulls, a registered code, its registry severity and data keys', () => {
    const steps = [accept(200), turnIn(200), accept(101), accept(999), turnIn(100), makeHearthStep(ids), makeVendorStep(ids, { location: at(0, 0, EASTERN_KINGDOMS) })];
    const { issues } = validate(steps, { character: { startLevel: 5 } });
    expect(issues.length).toBeGreaterThanOrEqual(5);
    for (const issue of issues) {
      expect(Object.keys(issue)).toEqual(['code', 'severity', 'stepId', 'questId', 'message', 'data']);
      if (!isRegisteredCode(issue.code)) throw new Error(`unregistered ${issue.code}`);
      const spec = issueCodeSpec(issue.code);
      expect(issue.severity).toBe(spec.severity);
      expect(issue.data === null ? [] : Object.keys(issue.data)).toEqual(spec.params);
      expect(issue.questId === null || typeof issue.questId === 'number').toBe(true);
      expect(issue.message).not.toMatch(/[{}]|undefined/);
    }
  });

  it('orders route-level issues first, then by step, and within a step by code and quest; the same walk gives the same issues', () => {
    const steps = [accept(999, { anyOf: null }), accept(500), accept(500), turnIn(100), turnIn(999)];
    const first = validate(steps, { character: { startLevel: 5 } }).issues;
    expect(summary(steps, first)).toEqual([
      '0 DATA002-unknown-quest 999',
      '1 VAL022-needs-event 500',
      '2 VAL001-already-in-log 500',
      '2 VAL022-needs-event 500',
      '3 VAL030-not-in-log 100',
      '4 DATA002-unknown-quest 999',
      '4 SIM001-unknown-xp 999',
    ]);
    expect(validate(steps, { character: { startLevel: 5 } }).issues).toEqual(first);
  });
});

describe('the validator as a visitor of a long-lived walker', () => {
  /** 700 steps: accept, turn-in pairs of made-up quests, some broken on purpose. */
  function longRoute(): RouteStep[] {
    const steps: RouteStep[] = [];
    for (let i = 0; i < 350; i += 1) {
      const id = i % 50 === 7 ? 999 : 100 + (i % 3);
      steps.push(accept(id), turnIn(id));
    }
    return steps;
  }

  it('re-validates from the checkpoint after an edit and agrees with a fresh validation', () => {
    const steps = longRoute();
    const project = fixtureProject(steps, { character: { startLevel: 10 } });
    const validator = createRouteValidator({ dataset: DATA, rules: context().rules });
    const walker = createRouteWalker({ ...context(), acceptPolicy: validator.acceptPolicy });
    walker.walk(project, [validator.visitor]);
    expect(validator.issues()).toEqual(validateRoute(project, context()).issues);

    const edited: RouteStep[] = [...steps];
    edited[601] = makeAbandonStep(ids, { questId: q(101) });
    const editedProject = { ...project, route: { ...project.route, steps: edited } };
    const rewalk = walker.walk(editedProject, [validator.visitor]);
    expect(rewalk.fromIndex).toBe(512);
    const fresh = validateRoute(editedProject, context()).issues;
    expect(validator.issues()).toEqual(fresh);
    // Step 601 was the turn-in of quest 100; step 602 accepts quest 101 again.
    expect(summary(edited, fresh).filter((line) => line.startsWith('601 ') || line.startsWith('602 '))).toEqual([
      '601 VAL032-not-in-log 101',
      '602 LINT003-low-value 101',
      '602 VAL002-already-completed 101',
    ]);
    expect(validator.stepIssues(601).map((issue) => issue.code)).toEqual(['VAL032-not-in-log']);
    expect(validator.stepIssues(9999)).toEqual([]);
  });

  it('refuses a re-walk it did not see from the start', () => {
    const project = fixtureProject(longRoute());
    const validator = createRouteValidator({ dataset: DATA, rules: context().rules });
    const walker = createRouteWalker({ ...context(), acceptPolicy: validator.acceptPolicy });
    walker.walk(project);
    walker.invalidate(300);
    expect(() => walker.walk(project, [validator.visitor])).toThrow('pass its visitor to every walk');
    walker.invalidate(0);
    walker.walk(project, [validator.visitor]);
    expect(validator.issues()).toEqual(validateRoute(project, context()).issues);
  });

  it('gives the walker its availability rules for `available` predicates', () => {
    // Skip the step unless quest 300 is available: its prerequisite 301 is not done.
    const unlessAvailable: StepCondition = { filter: null, variant: null, skipIf: [{ kind: 'questState', state: 'available', questIds: [q(300)], match: 'any', negate: true }] };
    const steps = [makeVendorStep(ids, { condition: unlessAvailable })];
    const withValidator = validate(steps, { character: { priorHistory: 'listed' } });
    expect(withValidator.walk.records[0]?.delta.skipped).toBe('condition');
    const basic = createRouteWalker(context()).walk(fixtureProject(steps, { character: { priorHistory: 'listed' } }));
    expect(basic.records[0]?.delta.skipped).toBeNull();
  });

  it('keeps the explicit stepId of each issue on the step it is about', () => {
    const steps = [accept(999)];
    const { issues } = validate(steps);
    expect(issues[0]?.stepId).toBe(steps[0]?.id);
    expect(issues[0]?.stepId).not.toBe(stepId('other'));
    const quests: QuestId[] = issues.map((issue) => issue.questId).filter((id): id is QuestId => id !== null);
    expect(quests).toEqual([999]);
  });
});
