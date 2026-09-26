import { describe, expect, it } from 'vitest';
import type { ObjectiveDef } from '../domain/dataset';
import { areaId, npcId, questId } from '../domain/ids';
import type { RouteStep } from '../domain/route';
import { makeAbandonStep, makeAcceptStep, makeCompleteStep, makeNoteStep, makeTurnInStep, makeVendorStep } from '../domain/step-factory';
import { sumEstimates } from '../sim/provenance';
import { legPairKey } from './legs';
import {
  at,
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
  TEST_INSTANCE,
  testIds,
} from './test-helpers';
import type { EngineContext, QuestLogEntry, RouteWalk, StepRecord, WalkProject, WalkVisitor } from './types';
import { createRouteWalker, walkMetrics, walkRoute } from './walker';

/**
 * D-040 (docs/SIMULATION.md TIME-11): a turn-in carries the work of objectives no `complete` step
 * finished, for a quest an accept step of the route put in the log: the TIME-9 time and kill XP of
 * each open objective at the turn-in's level and at no point (as a `complete` step without a
 * location), combined as TIME-10, without travel. Pre-route, assumed and failed quests, and finished
 * objectives, stay as they were; items collected before the accept count at the accept. Record
 * numbers are made up for the tests.
 */

const q = questId;
const ids = testIds();
const REPUTATION: ObjectiveDef = { kind: 'reputation', factionId: 76, value: 3000, label: null } as unknown as ObjectiveDef;
const GIVER = { kind: 'npc', id: npcId(10) } as const;
/** A finisher inside the test instance. */
const INSIDE = { kind: 'npc', id: npcId(11) } as const;
const quest = (id: number, objectives: readonly ObjectiveDef[], fields: Parameters<typeof questRecord>[1] = {}) =>
  questRecord(id, { objectives: [...objectives], starters: [GIVER], finishers: [GIVER], ...fields });

const DATA = fixtureDataset({
  quests: [
    quest(100, [killObjective(1)]),
    quest(103, [killObjective(1), killObjective(1)]),
    quest(104, [killObjective(1), REPUTATION]),
    quest(105, [killObjective(2)], { xp: { questLevel: 20, baseXp: 1000, basis: 'era-seed' } }),
    quest(106, []),
    quest(107, [killObjective(1)]),
    // Item 500 drops from NPC 1 (level 10, no spawn) and NPC 3 (level 14, next to the giver).
    quest(110, [itemObjective(500)]),
    quest(111, [itemObjective(500), killObjective(1)]),
    quest(120, [killObjective(1)], { finishers: [INSIDE] }),
    quest(130, [killObjective(1)], { xp: null }),
    quest(200, [], { xp: null }),
  ],
  npcs: [npcRecord(1), npcRecord(2, { minLevel: 20, maxLevel: 20 }), npcRecord(3, { minLevel: 14, maxLevel: 14 }), npcRecord(10), npcRecord(11)],
  items: [itemRecord(500, [1, 3])],
  spawns: { 'npc:10': [spawnAt(point(100))], 'npc:3': [spawnAt(point(110))], 'npc:11': [spawnAt(point(5, 5, TEST_INSTANCE))] },
});

const context = (options: FixtureContextOptions = {}): EngineContext => fixtureContext(DATA, options);
const walk = (steps: readonly RouteStep[], options: Parameters<typeof fixtureProject>[1] = {}, ctx = context(), visitors: readonly WalkVisitor[] = []): RouteWalk =>
  walkRoute(fixtureProject(steps, options), ctx, visitors);
const record = (result: RouteWalk, index: number): StepRecord => {
  const found = result.records[index];
  if (found === undefined) throw new Error(`no record ${String(index)}`);
  return found;
};
const accept = (id: number, fields: Partial<Parameters<typeof makeAcceptStep>[1]> = {}): RouteStep => makeAcceptStep(ids, { questId: q(id), ...fields });
const turnIn = (id: number, fields: Partial<Parameters<typeof makeTurnInStep>[1]> = {}): RouteStep => makeTurnInStep(ids, { questId: q(id), ...fields });
const complete = (id: number, objective: number | null, fields: Partial<Parameters<typeof makeCompleteStep>[1]> = {}): RouteStep =>
  makeCompleteStep(ids, { targets: [{ questId: q(id), objective }], ...fields });
const kinds = (result: RouteWalk, index: number): string[] => record(result, index).estimate.facts.map((fact) => fact.kind);
const UNKNOWN = { value: null, basis: 'unknown', eraFallback: false };
const L10 = { character: { startLevel: 10 } } as const;

describe('a turn-in carries the work of open objectives (D-040, TIME-11)', () => {
  it('accept and turn-in only: the time and kill XP of the explicit complete step at the same level, without its travel', () => {
    const carried = walk([accept(100), turnIn(100)], L10);
    const explicit = walk([accept(100), complete(100, 0), turnIn(100)], L10);
    const work = record(explicit, 1).estimate;
    const questXp = record(explicit, 2).estimate.xpGained;
    const turn = record(carried, 1).estimate;
    // TIME-T 12: 8 kills × 30 s = 240 s and 8 × 95 = 760 kill XP, then TIME-T 19's 850 quest XP.
    expect(work.breakdown.objective).toBe(240);
    expect(work.xpGained).toEqual({ value: 760, basis: 'assumption', eraFallback: true });
    expect(turn.breakdown).toEqual({ travel: 0, combat: 0, interaction: 3, objective: 240, waiting: 0 });
    expect(turn.duration).toEqual(sumEstimates([work.duration, record(explicit, 2).estimate.duration]));
    expect(turn.xpGained).toEqual(sumEstimates([work.xpGained, questXp]));
    expect(turn.xpGained.value).toBe(1610);
    expect(turn).toMatchObject({ xpAfter: record(explicit, 2).estimate.xpAfter, levelAfter: record(explicit, 2).estimate.levelAfter, levelIsLowerBound: false });
    expect(turn.assumptionsUsed).toEqual(expect.arrayContaining([...work.assumptionsUsed, ...record(explicit, 2).estimate.assumptionsUsed]));
    expect(turn.facts).toEqual([
      { kind: 'objectives-carried', questId: q(100), objectives: [0], time: 'counted', killXp: work.xpGained, level: 10, levelBasis: 'assumption', levelEraFallback: true },
    ]);
    expect(record(carried, 1).delta.objectivesDone).toEqual([{ questId: q(100), objective: 0 }]);
    expect(carried.final).toEqual(explicit.final);
    // A complete step somewhere else adds the travel there and back; the carried work has none.
    const located = walk([accept(100), complete(100, 0, { location: at(800) }), turnIn(100)], L10);
    expect(record(located, 1).estimate.breakdown).toMatchObject({ objective: 240, travel: (700 * 1.25) / 7 });
    expect(record(located, 2).estimate.breakdown.travel).toBe((700 * 1.25) / 7);
    expect(record(located, 1).estimate.xpGained).toEqual(work.xpGained);
    expect(walkMetrics(located).duration.value).toBe((walkMetrics(carried).duration.value ?? 0) + 2 * ((700 * 1.25) / 7));
    expect(walkMetrics(located).xpGained).toEqual(walkMetrics(carried).xpGained);
  });

  it('two open objectives are one TIME-10 block: S = 240 + 0.5 × 240 = 360 s, kill XP floor(0.75 × 1,520) = 1,140 (TIME-T 14)', () => {
    const turn = record(walk([accept(103), turnIn(103)], L10), 1).estimate;
    expect(turn.breakdown.objective).toBe(360);
    expect(turn.xpGained.value).toBe(1140 + 850);
    expect(turn.assumptionsUsed).toContain('objectiveConcurrency');
    expect(turn.facts).toEqual([
      {
        kind: 'objectives-carried',
        questId: q(103),
        objectives: [0, 1],
        time: 'counted',
        killXp: { value: 1140, basis: 'assumption', eraFallback: true },
        level: 10,
        levelBasis: 'assumption',
        levelEraFallback: true,
      },
    ]);
  });

  it('an objective an earlier complete step finished is not carried; the open one is', () => {
    const result = walk([accept(103), complete(103, 0), turnIn(103)], L10);
    expect(record(result, 1).estimate.breakdown.objective).toBe(240);
    const turn = record(result, 2);
    expect(turn.estimate.breakdown.objective).toBe(240);
    expect(turn.estimate.xpGained.value).toBe(760 + 850);
    expect(turn.estimate.facts).toMatchObject([{ kind: 'objectives-carried', objectives: [1] }]);
    expect(turn.delta.objectivesDone).toEqual([{ questId: q(103), objective: 1 }]);
    // Every objective finished: nothing is carried and the turn-in is its interaction alone.
    const done = walk([accept(103), complete(103, null), turnIn(103)], L10);
    expect(record(done, 2).estimate.breakdown.objective).toBe(0);
    expect(record(done, 2).estimate.facts).toEqual([]);
  });

  it('partial steps cost only their override; the turn-in carries the whole work once', () => {
    const result = walk([accept(100), complete(100, 0, { progress: 'partial' }), complete(100, 0, { progress: 'partial', durationOverride: 30 }), turnIn(100)], L10);
    expect(record(result, 1).estimate.breakdown.objective).toBe(0);
    expect(record(result, 2).estimate.breakdown.objective).toBe(30);
    expect(record(result, 1).estimate.xpGained.value).toBe(0);
    expect(record(result, 2).estimate.xpGained.value).toBe(0);
    expect(record(result, 3).estimate.breakdown.objective).toBe(240);
    expect(record(result, 3).estimate.xpGained.value).toBe(760 + 850);
    expect(walkMetrics(result).xpGained.value).toBe(760 + 850);
  });

  it('prices at the turn-in’s level: the carried kill XP is granted before the quest XP', () => {
    // Level 19 against level-20 mobs: 8 × round(140 × 1.05) = 1,176 kill XP.
    const result = walk([accept(105), turnIn(105)], { character: { startLevel: 19 } });
    const turn = record(result, 1).estimate;
    expect(turn.xpGained.value).toBe(1176 + 1000);
    expect(turn.facts).toMatchObject([{ kind: 'objectives-carried', level: 19 }]);
  });
});

describe('what is not carried (D-040)', () => {
  const incidental = (result: RouteWalk, index: number, id: number, objectives: readonly number[]): void => {
    const turn = record(result, index);
    expect(turn.estimate.facts).toContainEqual({ kind: 'objectives-incidental', questId: q(id), objectives });
    expect(turn.estimate.facts.some((fact) => fact.kind === 'objectives-carried')).toBe(false);
    expect(turn.estimate.breakdown.objective).toBe(0);
  };

  it('a quest in the prior quest log: its progress is unknown, so the objectives stay incidental at 0 s and 0 kill XP', () => {
    const result = walk([turnIn(100)], { character: { startLevel: 10, priorHistory: 'listed', priorQuestLog: [q(100)] } });
    incidental(result, 0, 100, [0]);
    expect(record(result, 0).estimate.xpGained.value).toBe(850);
    // An accept of a quest already in the log (VAL-1) keeps its pre-route entry.
    incidental(walk([accept(100), turnIn(100)], { character: { startLevel: 10, priorQuestLog: [q(100)] } }), 1, 100, [0]);
    // Abandoned and accepted again in the route, it is the route's own entry: carried.
    const again = walk([makeAbandonStep(ids, { questId: q(100) }), accept(100), turnIn(100)], { character: { startLevel: 10, priorQuestLog: [q(100)] } });
    expect(kinds(again, 2)).toEqual(['objectives-carried']);
    expect(record(again, 2).estimate.breakdown.objective).toBe(240);
  });

  it('a quest assumed in the log through an unknown history stays incidental', () => {
    const result = walk([turnIn(103)], { character: { startLevel: 10, priorHistory: 'unknown' } });
    expect(record(result, 0).delta.assumedInLog).toEqual([q(103)]);
    incidental(result, 0, 103, [0, 1]);
    // Assumed through a complete step first: the objective it did not finish is still incidental.
    const worked = walk([complete(103, 0), turnIn(103)], { character: { startLevel: 10, priorHistory: 'unknown' } });
    incidental(worked, 1, 103, [1]);
  });

  it('a failed quest is not turned in, so nothing is carried', () => {
    // Nothing in the route model fails a quest yet: the test fails it through the live state.
    const fail: WalkVisitor = {
      enter: (visit) => {
        if (visit.step.kind !== 'turnin') return;
        const entry = visit.state.questLog.get(q(100)) as QuestLogEntry | undefined;
        if (entry !== undefined) entry.failed = true;
      },
    };
    const result = walk([accept(100), turnIn(100)], L10, context(), [fail]);
    const turn = record(result, 1);
    expect(turn.delta.turnedIn).toBeNull();
    expect(turn.estimate.facts).toEqual([]);
    expect(turn.estimate.breakdown.objective).toBe(0);
    expect(turn.estimate.xpGained.value).toBe(0);
  });
});

describe('the level cap (XP-2, XP-4) and carried work', () => {
  const capped = context({ assumptions: { maxLevel: 20 } });

  it('at the cap the carried kill XP is a known 0 and the level stays exact', () => {
    const result = walk([accept(105), turnIn(105)], { character: { startLevel: 20 } }, capped);
    const turn = record(result, 1).estimate;
    expect(turn.breakdown.objective).toBe(240);
    expect(turn.xpGained).toEqual({ value: 0, basis: 'assumption', eraFallback: false });
    expect(turn).toMatchObject({ xpAfter: 0, levelIsLowerBound: false, levelAfter: { value: 20 } });
  });

  it('carried kill XP that reaches the cap makes a lower-bound level exact, and names maxLevel', () => {
    const need = capped.rules.values.xpToNextLevel.value[18] ?? 0;
    const result = walk([accept(200), accept(105), turnIn(200), turnIn(105)], { character: { startLevel: 19, startXp: need - 500 } }, capped);
    expect(record(result, 2).estimate.levelIsLowerBound).toBe(true);
    const turn = record(result, 3);
    expect(turn.estimate.facts).toMatchObject([{ kind: 'objectives-carried', level: 20 }]);
    expect(turn.estimate).toMatchObject({ xpAfter: 0, levelIsLowerBound: false, levelAfter: { value: 20, basis: 'assumption' } });
    expect(turn.delta.unknownXpReset).toBe(true);
    expect(turn.estimate.assumptionsUsed).toEqual(expect.arrayContaining(['maxLevel', 'killSeconds', 'objectiveKillCount']));
  });
});

describe('overrides and unknown work (TIME-8, TIME-13)', () => {
  it('a duration override on the turn-in replaces the carried time; the kill XP is still granted', () => {
    const result = walk([accept(100), turnIn(100, { durationOverride: 7 })], L10);
    const turn = record(result, 1).estimate;
    expect(turn.breakdown).toEqual({ travel: 0, combat: 0, interaction: 7, objective: 0, waiting: 0 });
    expect(turn.duration).toMatchObject({ value: 7, basis: 'assumption' });
    expect(turn.xpGained.value).toBe(760 + 850);
    expect(turn.facts).toMatchObject([{ kind: 'objectives-carried', time: 'overridden', killXp: { value: 760 } }]);
  });

  it('an objective without a time estimate leaves the turn-in’s time unknown, with SIM-15’s fact; kill XP over the known work', () => {
    const result = walk([accept(104), turnIn(104)], L10);
    const turn = record(result, 1).estimate;
    expect(turn.duration).toEqual(UNKNOWN);
    expect(turn.breakdown).toEqual({ travel: 0, combat: 0, interaction: 3, objective: 0, waiting: 0 });
    expect(turn.xpGained.value).toBe(760 + 850);
    expect(turn.facts).toEqual([
      { kind: 'time-unknown', part: 'objective', reason: 'reputation-objective', questId: q(104), objective: 1 },
      {
        kind: 'objectives-carried',
        questId: q(104),
        objectives: [0, 1],
        time: 'unknown',
        killXp: { value: 760, basis: 'assumption', eraFallback: true },
        level: 10,
        levelBasis: 'assumption',
        levelEraFallback: true,
      },
    ]);
    expect(walkMetrics(result).stepsWithUnknownTime).toBe(1);
    // An override prices it, and drops the unknown-time fact (SIM-05, ENG-04).
    const priced = record(walk([accept(104), turnIn(104, { durationOverride: 90 })], L10), 1).estimate;
    expect(priced.duration.value).toBe(90);
    expect(priced.facts).toMatchObject([{ kind: 'objectives-carried', time: 'overridden' }]);
  });

  it('unknown quest XP makes the turn-in’s XP unknown; the known kill XP is still granted, and the route’s known XP counts it', () => {
    const result = walk([accept(200), accept(100), turnIn(100)], L10, context());
    expect(record(result, 2).estimate.xpGained.value).toBe(1610);
    const unknown = walk([accept(130), turnIn(130)], L10);
    const turn = record(unknown, 1).estimate;
    expect(turn.xpGained).toEqual(UNKNOWN);
    expect(turn).toMatchObject({ xpAfter: 760, levelIsLowerBound: true });
    expect(turn.facts).toContainEqual(expect.objectContaining({ kind: 'objectives-carried', killXp: { value: 760, basis: 'assumption', eraFallback: true } }));
    // Review D40-04: the known total is the XP that went into the level, a lower bound as the level is.
    const metrics = walkMetrics(unknown);
    expect(metrics).toMatchObject({ xpGained: { value: 760, basis: 'assumption', eraFallback: true }, unknownXpSteps: 1, levelIsLowerBound: true });
    expect(metrics.xpGained.value).toBe(unknown.final.xp);
  });
});

describe('checkpoints and leg enumeration (ARCHITECTURE §9.2; terrain-navigation.md §9.4)', () => {
  /** Accept and turn-in cycles only, over spread-out givers, with pre-route quests among them. */
  function cycles(count: number): RouteStep[] {
    const local = testIds();
    const steps: RouteStep[] = [];
    for (let i = 0; steps.length < count; i += 1) {
      const id = [100, 103, 104][i % 3] ?? 100;
      steps.push(makeAcceptStep(local, { questId: q(id), location: at((i % 13) * 40) }));
      if (i % 4 === 0) steps.push(makeCompleteStep(local, { targets: [{ questId: q(id), objective: 0 }] }));
      steps.push(makeTurnInStep(local, { questId: q(id), location: at((i % 17) * 30) }));
      if (i % 9 === 0) steps.push(makeTurnInStep(local, { questId: q(107) }), makeAcceptStep(local, { questId: q(107) }));
    }
    return steps.slice(0, count);
  }
  /** 107 starts in the prior quest log: its first turn-in is incidental, the later ones carried. */
  const base = fixtureProject([], { character: { startLevel: 10, priorQuestLog: [q(107)] } });
  /** The same character, profile and custom quests for every route, so only the steps differ between walks. */
  const project = (steps: readonly RouteStep[]): WalkProject => ({ ...base, route: { ...base.route, steps } });

  it('an edit then a re-walk from a checkpoint equals a full walk', () => {
    const steps = cycles(800);
    const walker = createRouteWalker(context());
    const first = walker.walk(project(steps));
    expect(first.estimates.filter((e) => e.facts.some((fact) => fact.kind === 'objectives-carried')).length).toBeGreaterThan(100);
    expect(first.estimates.some((e) => e.facts.some((fact) => fact.kind === 'objectives-incidental'))).toBe(true);
    let edited = steps;
    for (const index of [600, 300, 257]) {
      edited = [...edited];
      edited[index] = makeVendorStep(testIds(), { location: at(123, 45) });
      const again = walker.walk(project(edited));
      expect(again.fromIndex).toBe(Math.floor(index / 256) * 256);
      const fresh = createRouteWalker(context());
      const full = fresh.walk(project(edited));
      expect(again.estimates).toEqual(full.estimates);
      expect(again.records.map((r) => r.delta)).toEqual(full.records.map((r) => r.delta));
      expect(again.final).toEqual(full.final);
      expect(walker.legs().map(legPairKey)).toEqual(fresh.legs().map(legPairKey));
      expect(walkMetrics(again)).toEqual(walkMetrics(full));
    }
    expect(walker.stateBefore(700)).toEqual(createRouteWalker(context()).walk(project(edited.slice(0, 700))).final);
  });

  it('carried work asks the travel model for no leg: the same legs as quests without objectives', () => {
    const at200 = { location: at(200) };
    const carried = walk([accept(103, at200), makeNoteStep(ids, { text: 'x', location: at(900) }), turnIn(103, at200)], L10);
    const none = walk([accept(106, at200), makeNoteStep(ids, { text: 'x', location: at(900) }), turnIn(106, at200)], L10);
    expect(record(carried, 2).estimate.breakdown.objective).toBe(360);
    expect(carried.records.map((r) => r.legsAsked.map(legPairKey))).toEqual(none.records.map((r) => r.legsAsked.map(legPairKey)));
    expect(carried.records.map((r) => r.estimate.breakdown.travel)).toEqual(none.records.map((r) => r.estimate.breakdown.travel));
  });
});

describe('work a complete step priced before the accept (review D40-01)', () => {
  const LISTED = { character: { startLevel: 10, priorHistory: 'listed' } } as const;

  it('items collected before the accept count at the accept: the turn-in carries nothing, so the work is priced once', () => {
    const early = walk([complete(110, 0), accept(110), turnIn(110)], LISTED);
    const explicit = walk([accept(110), complete(110, 0), turnIn(110)], LISTED);
    // The early step prices the work (SIM-16: the quest is not in the log yet) and marks nothing.
    expect(record(early, 0).estimate.breakdown.objective).toBe(320);
    expect(record(early, 0).estimate.xpGained).toEqual(record(explicit, 1).estimate.xpGained);
    expect(kinds(early, 0)).toEqual(['complete-not-in-log']);
    expect(record(early, 0).delta.objectivesDone).toEqual([]);
    // The accept marks the item objective done.
    expect(record(early, 1).estimate.facts).toEqual([{ kind: 'objectives-before-accept', questId: q(110), objectives: [0] }]);
    expect(record(early, 1).delta.objectivesDone).toEqual([{ questId: q(110), objective: 0 }]);
    // The turn-in carries nothing: its time and XP are those of the explicit route's turn-in.
    expect(record(early, 2).estimate).toMatchObject({ breakdown: { objective: 0 }, facts: [] });
    expect(record(early, 2).estimate.xpGained).toEqual(record(explicit, 2).estimate.xpGained);
    expect(walkMetrics(early)).toEqual(walkMetrics(explicit));
    expect(early.final).toEqual(explicit.final);
    expect(early.final.itemsBeforeAccept.size).toBe(0);
    // A later step for the same objective finds it done (SIM-12) and adds no work.
    const again = walk([complete(110, 0), accept(110), complete(110, 0), turnIn(110)], LISTED);
    expect(record(again, 2).estimate.breakdown.objective).toBe(0);
    expect(kinds(again, 2)).toEqual(['objective-already-done']);
  });

  it('kills before the accept do not count toward the quest (SIM-16), so the turn-in still carries them (for the architect to rule)', () => {
    const result = walk([complete(100, 0), accept(100), turnIn(100)], LISTED);
    expect(kinds(result, 0)).toEqual(['complete-not-in-log']);
    expect(record(result, 1).estimate.facts).toEqual([]);
    expect(record(result, 2).estimate.facts).toMatchObject([{ kind: 'objectives-carried', objectives: [0], time: 'counted' }]);
    expect(record(result, 2).estimate.breakdown.objective).toBe(240);
    // One quest with both: the item objective counts at the accept, the kill objective is carried.
    const mixed = walk([complete(111, null), accept(111), turnIn(111)], LISTED);
    expect(record(mixed, 1).estimate.facts).toEqual([{ kind: 'objectives-before-accept', questId: q(111), objectives: [0] }]);
    expect(record(mixed, 2).estimate.facts).toMatchObject([{ kind: 'objectives-carried', objectives: [1] }]);
    expect(record(mixed, 2).estimate.breakdown.objective).toBe(240);
  });

  it('only a complete step that finishes counts: a partial one prices nothing, so the turn-in carries the items', () => {
    const result = walk([complete(110, 0, { progress: 'partial' }), accept(110), turnIn(110)], LISTED);
    expect(record(result, 1).estimate.facts).toEqual([]);
    expect(record(result, 2).estimate.facts).toMatchObject([{ kind: 'objectives-carried', objectives: [0] }]);
    expect(record(result, 2).estimate.breakdown.objective).toBe(320);
  });

  it('with an unknown history the complete step assumes the quest in the log, so nothing is remembered', () => {
    const result = walk([complete(110, 0), accept(110), turnIn(110)], { character: { startLevel: 10, priorHistory: 'unknown' } });
    expect(record(result, 0).delta.assumedInLog).toEqual([q(110)]);
    expect(record(result, 0).delta.objectivesDone).toEqual([{ questId: q(110), objective: 0 }]);
    expect(record(result, 1).estimate.facts).toEqual([]);
    expect(record(result, 2).estimate.breakdown.objective).toBe(0);
  });

  it('the remembered items survive a checkpoint: an edit between the complete step and the accept re-walks as a full walk', () => {
    const local = testIds();
    const steps: RouteStep[] = [];
    for (let i = 0; i < 250; i += 1) steps.push(makeVendorStep(local, { location: at(i % 7) }));
    steps.push(makeCompleteStep(local, { targets: [{ questId: q(110), objective: 0 }] }));
    for (let i = 0; i < 12; i += 1) steps.push(makeVendorStep(local, { location: at(i % 5) }));
    steps.push(makeAcceptStep(local, { questId: q(110) }), makeTurnInStep(local, { questId: q(110) }));
    const base = fixtureProject([], LISTED);
    const project = (list: readonly RouteStep[]): WalkProject => ({ ...base, route: { ...base.route, steps: list } });
    const walker = createRouteWalker(context());
    const first = walker.walk(project(steps));
    expect(first.estimates[263]?.facts).toEqual([{ kind: 'objectives-before-accept', questId: q(110), objectives: [0] }]);
    expect(first.estimates[264]?.breakdown.objective).toBe(0);
    const edited = [...steps];
    edited[258] = makeVendorStep(testIds(), { location: at(123, 45) });
    const again = walker.walk(project(edited));
    expect(again.fromIndex).toBe(256);
    const full = createRouteWalker(context()).walk(project(edited));
    expect(again.estimates).toEqual(full.estimates);
    expect(again.final).toEqual(full.final);
    expect(again.estimates[264]?.breakdown.objective).toBe(0);
    expect(walker.stateBefore(260).itemsBeforeAccept.get(q(110))).toEqual([0]);
  });
});

describe('where carried work is priced (review D40-02)', () => {
  it('as a complete step without a location: an item’s drop NPC is the lowest id, not the one nearest the turn-in', () => {
    const carried = walk([accept(110), turnIn(110)], L10);
    const explicit = walk([accept(110), complete(110, 0), turnIn(110)], L10);
    const turn = record(carried, 1).estimate;
    // NPC 1 (level 10): 10 kills for the drop, 950 kill XP; NPC 3 (level 14, 10 yd away) would give 1,140.
    expect(turn.facts).toMatchObject([{ kind: 'objectives-carried', killXp: { value: 950 } }]);
    expect(turn.breakdown.objective).toBe(record(explicit, 1).estimate.breakdown.objective);
    expect(turn.xpGained).toEqual(sumEstimates([record(explicit, 1).estimate.xpGained, record(explicit, 2).estimate.xpGained]));
    expect(carried.final).toEqual(explicit.final);
    // A complete step next to NPC 3 picks it: the place is what an explicit step adds.
    expect(record(walk([accept(110), complete(110, 0, { location: at(110) }), turnIn(110)], L10), 1).estimate.xpGained.value).toBe(1140);
  });

  it('kills are open-world kills even when the turn-in is inside an instance (KXP-5)', () => {
    const dungeon = { dungeonAreaId: areaId(1), name: 'Test instance', instanceMapId: TEST_INSTANCE, raid: false, entrances: [{ point: point(350), frameVerified: true }] };
    const base = context({ dungeons: [dungeon] });
    const halved: EngineContext = { ...base, rules: { ...base.rules, values: { ...base.rules.values, dungeonMobXpMultiplier: { ...base.rules.values.dungeonMobXpMultiplier, value: 0.5 } } } };
    const carried = walk([accept(120), turnIn(120)], L10, halved);
    expect(carried.final.location?.mapId).toBe(TEST_INSTANCE);
    expect(record(carried, 1).estimate.facts).toMatchObject([{ kind: 'objectives-carried', killXp: { value: 760 } }]);
    expect(record(walk([accept(120), complete(120, 0), turnIn(120)], L10, halved), 1).estimate.xpGained.value).toBe(760);
    // Inside the instance a complete step's kills take the dungeon multiplier: 8 × round(95 × 0.5).
    expect(record(walk([accept(120), complete(120, 0, { location: at(5, 5, TEST_INSTANCE) }), turnIn(120)], L10, halved), 1).estimate.xpGained.value).toBe(8 * 48);
  });
});
