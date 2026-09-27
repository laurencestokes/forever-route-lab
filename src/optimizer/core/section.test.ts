import { describe, expect, it } from 'vitest';
import { npcId, questId } from '../../domain/ids';
import type { RouteStep } from '../../domain/route';
import { makeAbandonStep, makeFlightStep, makeGrindStep, makeNoteStep, makeTravelStep, makeVendorStep } from '../../domain/step-factory';
import { at, itemObjective, itemRecord, npcRecord, point, rxpGroup, spawnAt, TEST_INSTANCE } from '../../engine/test-helpers';
import { areaId, uiMapId } from '../../domain/ids';
import { zoneSourcedPoint } from '../../domain/points';
import { type AnalysisInternal, analyseSection, buildStructure, namedQuests } from './section';
import { harnessInput, hQuest, hScenario, hSteps, type Scenario } from './test-helpers';
import type { CompileFailure, SectionAnalysis } from './types';

/** Section analysis (docs/research/optimizer-m7.md §3, §4.4, §5.1). */

function analyse(scenario: Scenario, goal: Parameters<typeof harnessInput>[3] = {}): SectionAnalysis {
  const analysis = analyseSection(harnessInput(scenario.project, scenario.context, scenario.section, goal));
  if (!analysis.ok) throw new Error(analysis.reason);
  return analysis;
}

const internal = (analysis: SectionAnalysis): AnalysisInternal => analysis.internal as AnalysisInternal;

/** Each unit as its steps' offsets in the section, with `*` for an anchor and `#` for a block. */
function unitShape(analysis: SectionAnalysis): string[] {
  const { structure } = internal(analysis);
  return structure.units.map((unit) => `${unit.block ? '#' : unit.anchor ? '*' : ''}${unit.steps.map((i) => String(i - structure.first)).join('+')}`);
}

const role = (analysis: SectionAnalysis, offset: number): string => {
  const { structure } = internal(analysis);
  const info = structure.steps.get(structure.first + offset);
  return `${info?.role ?? '?'}:${info?.reason ?? '?'}`;
};

describe('the §3.1 classification', () => {
  it('classifies every step kind', () => {
    const s = hSteps();
    const steps: RouteStep[] = [
      s.accept(1, 10, 0, { condition: { filter: { kind: 'word', word: 'Mage' }, variant: null, skipIf: [] } }), // inert (the character is a warrior)
      s.accept(2, 20, 0, { locked: true }),
      s.accept(3, 30, 0, { condition: { filter: null, variant: null, skipIf: [{ kind: 'levelAtLeast', level: 60, xp: null, negate: false }] } }),
      s.accept(4, 40, 0, { anyOf: [questId(4), questId(5)] }),
      s.turnin(6, 50, 0, { skipIfMissing: true }),
      s.complete(7, 60, 0),
      s.hearth('use', null, 0),
      makeFlightStep(s.ids, { to: null, nodeQuery: 'Nowhere' }),
      makeAbandonStep(s.ids, { questId: questId(2) }),
      makeTravelStep(s.ids, { mode: 'transport', location: at(70, 0) }),
      makeGrindStep(s.ids, { until: { kind: 'level', level: 10, offset: null } }),
      s.accept(8, 80, 0),
      makeVendorStep(s.ids, { location: at(90, 0) }),
      s.turnin(8, 80, 0),
    ];
    const scenario = hScenario({
      quests: [1, 2, 3, 4, 5, 6, 7, 8].map((id) => hQuest(id, 1000)),
      steps,
      exit: { x: 0, y: 0 },
    });
    const analysis = analyse(scenario);
    expect(Array.from({ length: steps.length }, (_, k) => role(analysis, k))).toEqual([
      'inert:inert',
      'anchor:locked',
      'anchor:conditional',
      'anchor:any-of',
      'anchor:skip-if-missing',
      'anchor:SIM-16',
      'anchor:hearth',
      'anchor:flight',
      'anchor:abandon',
      'anchor:transport',
      'anchor:grind',
      'host:host',
      'bound:bound',
      'host:host',
    ]);
  });

  it('names a step’s quests: its quest, any-of candidates and complete targets', () => {
    const s = hSteps();
    expect(namedQuests(s.accept(1, 0, 0, { anyOf: [questId(2), questId(1)] }))).toEqual([1, 2]);
    expect(namedQuests(s.complete(3, 0, 0, { targets: [{ questId: questId(3), objective: 0 }, { questId: questId(4), objective: null }, { questId: questId(3), objective: 1 }] }))).toEqual([3, 4]);
    expect(namedQuests(makeNoteStep(s.ids, { text: 'x' }))).toEqual([]);
  });
});

describe('units (§3.2)', () => {
  it('binds non-quest steps to the next quest step, whatever its group; a trailing run is an anchor', () => {
    const s = hSteps();
    const g1 = rxpGroup('g1');
    const g2 = rxpGroup('g2');
    const steps: RouteStep[] = [
      { ...makeNoteStep(s.ids, { text: 'T1', location: at(5, 5) }), groupId: g1.id },
      { ...s.accept(1, 10, 0), groupId: g2.id },
      { ...s.accept(2, 20, 0), groupId: g1.id },
      makeTravelStep(s.ids, { location: at(30, 0) }),
      makeVendorStep(s.ids, { location: at(31, 0) }),
      s.turnin(1, 10, 0),
      s.turnin(2, 20, 0),
      makeNoteStep(s.ids, { text: 'tail', location: at(40, 0) }),
    ];
    const analysis = analyse(hScenario({ quests: [hQuest(1, 1000), hQuest(2, 1000)], steps, groups: [g1, g2], exit: { x: 0, y: 0 } }));
    expect(unitShape(analysis)).toEqual(['0+1', '2', '3+4+5', '6', '*7']);
  });

  it('makes a non-quest anchor its own unit, and the steps before it join it', () => {
    const s = hSteps();
    const steps: RouteStep[] = [...s.quest(1, 10, 0), makeTravelStep(s.ids, { location: at(15, 0) }), s.note(20, 0, { locked: true }), ...s.quest(2, 30, 0)];
    const analysis = analyse(hScenario({ quests: [hQuest(1, 1000), hQuest(2, 1000)], steps, exit: { x: 0, y: 0 } }));
    expect(unitShape(analysis)).toEqual(['0', '1', '*2+3', '4', '5']);
  });
});

describe('barriers and blocks (§3.6)', () => {
  it('merges a zone travel with its neighbours: back to the first unit that travels, on to the first known end (fixture 12)', () => {
    const s = hSteps();
    const steps = [s.accept(1, 100, 0), s.turnin(1, 100, 0), s.travel(null, 0), s.accept(2, 200, 0), s.turnin(2, 200, 0), ...s.quest(3, 3000, 0)];
    const analysis = analyse(hScenario({ quests: [hQuest(1, 1000), hQuest(2, 1000), hQuest(3, 1000)], steps, exit: { x: 0, y: 0 } }));
    expect(unitShape(analysis)).toEqual(['0', '#1+2+3', '4', '5', '6']);
    expect(analysis.summary.barriers).toEqual([2, 3]);
    expect(analysis.summary.obligatory).toEqual([1, 2]);
  });

  it('makes a block of the section start when the position is unknown, and schedules it first', () => {
    const s = hSteps();
    const steps = [...s.quest(1, 100, 0), ...s.quest(2, 200, 0)];
    const analysis = analyse(hScenario({ quests: [hQuest(1, 1000), hQuest(2, 1000)], steps, exit: { x: 0, y: 0 }, character: { startLocation: null } }));
    const { structure } = internal(analysis);
    expect(unitShape(analysis)).toEqual(['#0', '1', '2', '3']);
    expect(structure.units[0]?.first).toBe(true);
  });

  it('makes a block of a death skip that ends the section, and schedules it last', () => {
    const s = hSteps();
    const steps = [...s.quest(1, 100, 0), ...s.quest(2, 200, 0), makeNoteStep(s.ids, { text: '.deathskip', preserved: { format: 'rxp', lines: ['.deathskip'] } })];
    const analysis = analyse(hScenario({ quests: [hQuest(1, 1000), hQuest(2, 1000)], steps, exit: { x: 0, y: 0 } }));
    const { structure } = internal(analysis);
    expect(unitShape(analysis)).toEqual(['0', '1', '2', '#3+4']);
    expect(structure.units[3]?.last).toBe(true);
  });

  it('treats an unresolved destination and an unbound hearth as position-unknown events', () => {
    const s = hSteps();
    const nowhere = { source: zoneSourcedPoint(uiMapId(99_999), 50, 50), label: null, radius: null };
    const steps = [...s.quest(1, 100, 0), { ...s.accept(2, 0, 0), location: nowhere }, s.turnin(2, 300, 0), s.hearth('use', null, 0), ...s.quest(3, -300, 100)];
    const analysis = analyse(hScenario({ quests: [hQuest(1, 1000), hQuest(2, 1000), hQuest(3, 1000)], steps, exit: { x: 0, y: 0 } }));
    // Accept 2 goes nowhere (SIM-3); turn-in 2 moves from the unknown position; the hearth has no bind point.
    expect(analysis.summary.barriers).toEqual([2, 3, 4, 5]);
    expect(unitShape(analysis)).toEqual(['0', '#1+2+3+4+5', '6']);
  });

  it('extends a block backwards over units without travel', () => {
    const s = hSteps();
    const steps = [s.accept(1, 100, 0), { ...s.complete(1, 0, 0), location: null }, s.travel(null, 0), s.turnin(1, 150, 0)];
    const analysis = analyse(hScenario({ quests: [hQuest(1, 1000, { objectives: [itemObjective(700)] })], data: { items: [itemRecord(700, [])] }, steps, exit: { x: 0, y: 0 } }));
    expect(unitShape(analysis)).toEqual(['#0+1+2+3']);
  });
});

describe('obligations (§3.4)', () => {
  function obligatoryOf(scenario: Scenario): readonly number[] {
    return analyse(scenario).summary.obligatory;
  }

  it('item 1: quests named outside the section or by a skip predicate', () => {
    const s = hSteps();
    const named = obligatoryOf(hScenario({ quests: [hQuest(1, 1000), hQuest(2, 1000)], steps: [...s.quest(1, 100, 0), s.accept(2, 200, 0)], suffix: [s.turnin(2, 200, 0)] }));
    expect(named).toEqual([2]);
    const t = hSteps();
    const predicate = obligatoryOf(
      hScenario({
        quests: [hQuest(1, 1000), hQuest(2, 1000)],
        steps: [...t.quest(1, 100, 0), ...t.quest(2, 200, 0)],
        suffix: [t.note(0, 0, { condition: { filter: null, variant: null, skipIf: [{ kind: 'questState', state: 'turnedIn', questIds: [questId(1)], match: 'any', negate: false }] } })],
      }),
    );
    expect(predicate).toEqual([1]);
  });

  it('item 2: an anchor unit; item 3: a bound train or vendor step', () => {
    const s = hSteps();
    expect(obligatoryOf(hScenario({ quests: [hQuest(1, 1000), hQuest(2, 1000)], steps: [s.accept(1, 100, 0, { locked: true }), s.turnin(1, 100, 0), ...s.quest(2, 200, 0)], exit: { x: 0, y: 0 } }))).toEqual([1]);
    const t = hSteps();
    expect(obligatoryOf(hScenario({ quests: [hQuest(1, 1000), hQuest(2, 1000)], steps: [t.accept(1, 100, 0), makeVendorStep(t.ids, { location: at(110, 0) }), t.turnin(1, 100, 0), ...t.quest(2, 200, 0)], exit: { x: 0, y: 0 } }))).toEqual([1]);
  });

  it('item 4: unknown XP or repeatable; item 5: unknown time', () => {
    const s = hSteps();
    expect(obligatoryOf(hScenario({ quests: [hQuest(1, null), hQuest(2, 1000, { flags: { repeatable: true, needsEvent: false, questFlags: 0, specialFlags: 0 } }), hQuest(3, 1000)], steps: [...s.quest(1, 100, 0), ...s.quest(2, 150, 0), ...s.quest(3, 200, 0)], exit: { x: 0, y: 0 } }))).toEqual([1, 2]);
    const t = hSteps();
    const withReputation = hQuest(1, 1000, { objectives: [{ kind: 'reputation', factionId: 76 as never, value: 1 }] });
    expect(obligatoryOf(hScenario({ quests: [withReputation, hQuest(2, 1000)], steps: [t.accept(1, 100, 0), t.complete(1, 120, 0), t.turnin(1, 100, 0), ...t.quest(2, 200, 0)], exit: { x: 0, y: 0 } }))).toEqual([1]);
  });

  it('item 6: a suffix accept depending on it (fixture 7b); item 7: not untouched at the start', () => {
    const s = hSteps();
    const f = hQuest(3, 1000);
    expect(
      obligatoryOf(hScenario({ quests: [hQuest(1, 1000), hQuest(2, 1000), { ...f, prerequisites: { ...f.prerequisites, preQuestSingle: [questId(1)] } }], steps: [...s.quest(1, -800, 0), ...s.quest(2, 100, 0)], suffix: [s.accept(3, 200, 0)] })),
    ).toEqual([1]);
    const t = hSteps();
    expect(obligatoryOf(hScenario({ quests: [hQuest(1, 1000), hQuest(2, 1000)], steps: [t.turnin(1, 100, 0), ...t.quest(2, 200, 0)], exit: { x: 0, y: 0 }, character: { priorQuestLog: [questId(1)], priorHistory: 'listed' } }))).toEqual([1]);
  });

  it('item 8: a turn-in carrying objective work (D-040), listed in the summary', () => {
    const s = hSteps();
    const analysis = analyse(hScenario({ quests: [hQuest(1, 1000, { objectives: [itemObjective(700)] }), hQuest(2, 1000)], data: { items: [itemRecord(700, [7])], npcs: [npcRecord(7)] }, steps: [...s.quest(1, 100, 0), ...s.quest(2, 200, 0)], exit: { x: 0, y: 0 } }));
    expect(analysis.summary.obligatory).toEqual([1]);
    expect(analysis.summary.carried).toEqual([1]);
  });

  it('item 9: the unit that walked a group’s waypoints, when the group continues into the suffix', () => {
    const s = hSteps();
    const g = rxpGroup('g', { waypoints: [{ point: at(50, 50).source, role: 'leg', radius: null, filter: null, line: null }] });
    const analysis = analyse(
      hScenario({
        quests: [hQuest(1, 1000), hQuest(2, 1000)],
        groups: [g],
        steps: [{ ...s.accept(1, 100, 0), groupId: g.id }, s.turnin(1, 100, 0), ...s.quest(2, 200, 0)],
        suffix: [{ ...s.note(300, 0), groupId: g.id }],
      }),
    );
    expect(analysis.summary.obligatory).toEqual([1]);
  });

  it('makes a quest sharing a unit with an obligatory quest obligatory too (all or none)', () => {
    const s = hSteps();
    const kill = (id: number): ReturnType<typeof hQuest> => hQuest(id, 1000, { objectives: [itemObjective(700)] });
    const analysis = analyse(
      hScenario({
        quests: [kill(1), kill(2)],
        data: { items: [itemRecord(700, [7])], npcs: [npcRecord(7)] },
        steps: [s.accept(1, 100, 0, { locked: true }), s.accept(2, 110, 0), s.complete(1, 300, 0, { targets: [{ questId: questId(1), objective: null }, { questId: questId(2), objective: null }] }), s.turnin(1, 100, 0), s.turnin(2, 110, 0)],
        exit: { x: 0, y: 0 },
      }),
    );
    expect(analysis.summary.obligatory).toEqual([1, 2]);
  });
});

describe('the exit chain, the cast window and targets (§4.3, §5.1, §5.4)', () => {
  it('runs the exit chain over suffix steps without a fixed position to the first with one', () => {
    const s = hSteps();
    const giver = { kind: 'npc' as const, id: npcId(10) };
    const analysis = analyse(
      hScenario({
        quests: [hQuest(1, 1000), hQuest(2, 1000, { starters: [giver] })],
        // Two spawns: which one the accept walks to depends on where the section ends.
        data: { npcs: [npcRecord(10)], spawns: { 'npc:10': [spawnAt(point(500, 0)), spawnAt(point(-500, 0))] } },
        steps: s.quest(1, 100, 0),
        suffix: [makeNoteStep(s.ids, { text: 'no place' }), { ...s.accept(2, 0, 0), location: null }, s.note(900, 0), s.note(950, 0)],
      }),
    );
    expect(analysis.summary.exitChain).toEqual([2, 3, 4]);
    expect(analysis.summary.firstSuffixIndex).toBe(2);
  });

  it('ends the exit chain at an unlocated step whose NPC stands at one point (review PAR-07)', () => {
    const s = hSteps();
    const giver = { kind: 'npc' as const, id: npcId(10) };
    // Before, the chain ran on through every step after it without a location, to the route's end.
    const tail = Array.from({ length: 40 }, () => makeNoteStep(s.ids, { text: 'no place' }));
    const analysis = analyse(
      hScenario({
        quests: [hQuest(1, 1000), hQuest(2, 1000, { starters: [giver] })],
        data: { npcs: [npcRecord(10)], spawns: { 'npc:10': [spawnAt(point(500, 0)), spawnAt(point(500, 0))] } },
        steps: s.quest(1, 100, 0),
        suffix: [makeNoteStep(s.ids, { text: 'no place' }), { ...s.accept(2, 0, 0), location: null }, ...tail],
      }),
    );
    expect(analysis.summary.exitChain).toEqual([2, 3]);
  });

  it('starts the cast window at the last hearth cast before the section, and lists its legs', () => {
    const s = hSteps();
    const scenario = hScenario({
      quests: [hQuest(1, 1000)],
      character: { hearthLocation: at(900, 0) },
      prefix: [s.note(100, 0), s.hearth('use', null, 0), s.note(800, 0), s.note(700, 0)],
      steps: s.quest(1, 100, 0),
      exit: { x: 0, y: 0 },
    });
    const analysis = analyse(scenario);
    expect(analysis.castWindowStart).toBe(1);
    const keys = analysis.pairs.map((pair) => `${String(pair.from.point.x)}>${String(pair.to.point.x)}`);
    expect(keys).toEqual(expect.arrayContaining(['900>800', '800>700']));
  });

  it('takes the original known gain for keep-original, and a number as given', () => {
    const s = hSteps();
    const scenario = hScenario({ quests: [hQuest(1, 1000), hQuest(2, 600)], steps: [...s.quest(1, 100, 0), ...s.quest(2, 200, 0)], exit: { x: 0, y: 0 } });
    expect(analyse(scenario).summary.targetXp).toBe(1600);
    expect(analyse(scenario, { targetXp: 900 }).summary.targetXp).toBe(900);
  });
});

describe('failures', () => {
  const s = hSteps();
  const scenario = hScenario({ quests: [hQuest(1, 1000)], steps: s.quest(1, 100, 0), exit: { x: 0, y: 0 } });

  it('refuses a section that is not a range of the route', () => {
    const input = harnessInput(scenario.project, scenario.context, scenario.section);
    expect(analyseSection({ ...input, section: { first: 1, last: 0 } })).toMatchObject({ ok: false, status: 'failed' });
    expect(analyseSection({ ...input, section: { first: 0, last: 9 } })).toMatchObject({ ok: false, status: 'failed' });
    expect(analyseSection({ ...input, goal: { targetXp: -5, grindFill: 'shortfall' } })).toMatchObject({ ok: false, status: 'failed' });
  });

  it('refuses a walk whose records the replay cannot reproduce', () => {
    const input = harnessInput(scenario.project, scenario.context, scenario.section);
    const records = input.walk.records.map((record, i) => (i === 0 ? { ...record, estimate: { ...record.estimate, duration: { ...record.estimate.duration, value: 999 } } } : record));
    const result = buildStructure(input, { ...input.walk, records });
    expect((result as CompileFailure).reason).toMatch(/replay/);
  });

  it('is infeasible when the section itself moves between world maps without a transport (SIM-4)', () => {
    const t = hSteps();
    const cross = hScenario({ quests: [hQuest(1, 1000)], steps: [t.accept(1, 100, 0), { ...t.turnin(1, 0, 0), location: at(50, 50, 0 as never) }], exit: { x: 0, y: 0 } });
    expect(analyseSection(harnessInput(cross.project, cross.context, cross.section))).toMatchObject({ ok: false, status: 'infeasible' });
  });

  it('refuses a section on an instance map while entrance edges exist (ENG-01)', () => {
    const t = hSteps();
    const dungeon = { dungeonAreaId: areaId(1), name: 'Test dungeon', instanceMapId: TEST_INSTANCE, entrances: [{ point: point(350), frameVerified: true }] };
    const inside = hScenario({
      quests: [hQuest(1, 1000)],
      steps: [t.accept(1, 100, 0), { ...t.turnin(1, 0, 0), location: at(10, 10, TEST_INSTANCE) }],
      exit: { x: 0, y: 0 },
      contextOptions: { dungeons: [dungeon] },
    });
    expect(analyseSection(harnessInput(inside.project, inside.context, inside.section))).toMatchObject({ ok: false, status: 'failed', reason: expect.stringMatching(/ENG-01/) as unknown });
  });
});
