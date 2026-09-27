import { describe, expect, it } from 'vitest';
import { questId } from '../../domain/ids';
import { makeGrindStep } from '../../domain/step-factory';
import { cumulativeXp, xpCurveOf } from '../../sim/xp';
import { buildEdges, suffixGuard } from './relations';
import { type AnalysisInternal, analyseSection, type Structure } from './section';
import { coreFixtures } from './test-fixtures';
import { harnessInput, hQuest, hScenario, hSteps, type Scenario } from './test-helpers';

/** Precedence edges and the suffix guard (docs/research/optimizer-m7.md §3.5, §4.4). */

function structureOf(scenario: Scenario): Structure {
  const analysis = analyseSection(harnessInput(scenario.project, scenario.context, scenario.section, {}));
  if (!analysis.ok) throw new Error(analysis.reason);
  return (analysis.internal as AnalysisInternal).structure;
}

const edgesOf = (scenario: Scenario): string[] => buildEdges(structureOf(scenario)).map((e) => `${String(e.from)}${e.kind === 0 ? '>' : '~'}${String(e.to)}`);

const fixture = (id: string): Scenario => {
  const found = coreFixtures().find((f) => f.id === id);
  if (found === undefined) throw new Error(`no fixture ${id}`);
  return found.scenario;
};

describe('precedence edges on the fixtures (§3.5)', () => {
  // `a>b` is `require`, `a~b` is `order`.
  it.each([
    ['5', ['0>1', '2>3', '4>5']],
    ['6', ['1>2', '0>3', '3>4']],
    ['7b', ['0>1', '2>3']],
    ['7c', ['1>2', '0>3']],
    ['7d', ['0>1', '2>3']],
    ['7e', ['0>1', '2>3', '4>5', '3>6']],
    ['7f-v1', ['0>1', '2>3']],
    ['7f-v2', ['0>1', '1~3', '2>3']],
    ['13a', ['0>1']],
    ['13b', ['0>1', '1>2', '2>3']],
    ['13c', ['0>1']],
  ])('fixture %s', (id, expected) => {
    expect(edgesOf(fixture(id))).toEqual(expected);
  });

  it('orders every edge with the original, so the incumbent satisfies all of them', () => {
    for (const f of coreFixtures()) for (const edge of buildEdges(structureOf(f.scenario))) expect(edge.from).toBeLessThan(edge.to);
  });

  it('requires a completed prerequisite that came first (VAL-8), and keeps an exclusive quest on its side (VAL-12)', () => {
    const s = hSteps();
    const x = hQuest(2, 1000);
    const y = hQuest(3, 1000);
    const scenario = hScenario({
      quests: [hQuest(1, 1000), { ...x, prerequisites: { ...x.prerequisites, preQuestSingle: [questId(1)] } }, { ...y, prerequisites: { ...y.prerequisites, exclusiveTo: [questId(1)] } }],
      steps: [...s.quest(1, 100, 0), ...s.quest(2, 200, 0), ...s.quest(3, 300, 0)],
      exit: { x: 0, y: 0 },
    });
    // Units: 0 accept 1, 1 turn in 1, 2 accept 2, 3 turn in 2, 4 accept 3, 5 turn in 3.
    expect(edgesOf(scenario)).toEqual(['0>1', '1>2', '2>3', '0~4', '1~4', '4>5']);
  });

  it('keeps XP-granting units before an unknown-XP turn-in, or dropped (review OP-20)', () => {
    const s = hSteps();
    const scenario = hScenario({ quests: [hQuest(1, 1000), hQuest(2, null), hQuest(3, 1000)], steps: [...s.quest(1, 100, 0), ...s.quest(2, 200, 0), ...s.quest(3, 300, 0)], exit: { x: 0, y: 0 } });
    expect(edgesOf(scenario)).toEqual(['0>1', '1~3', '2>3', '4>5']);
  });

  it('keeps a block holding the section start first', () => {
    const s = hSteps();
    const scenario = hScenario({ quests: [hQuest(1, 1000), hQuest(2, 1000)], steps: [...s.quest(1, 100, 0), ...s.quest(2, 200, 0)], exit: { x: 0, y: 0 }, character: { startLocation: null } });
    expect(edgesOf(scenario)).toEqual(['0>1', '0>2', '0>3', '2>3']);
  });
});

describe('the suffix guard (§4.4)', () => {
  const curve = xpCurveOf(hScenario({ quests: [], steps: [], exit: null }).context.rules);
  const total = (level: number, xp = 0): number => cumulativeXp(curve, level) + xp;

  it('keeps each suffix threshold on its side: a level predicate not met and an accept gate met', () => {
    const s = hSteps();
    const gate = hQuest(3, 1000, { minLevel: 10 });
    const scenario = hScenario({
      quests: [hQuest(1, 1000), hQuest(2, 1000), gate],
      steps: [...s.quest(1, 100, 0), ...s.quest(2, 200, 0)],
      suffix: [s.note(0, 0, { condition: { filter: null, variant: null, skipIf: [{ kind: 'levelAtLeast', level: 11, xp: null, negate: false }] } }), s.accept(3, 50, 0)],
    });
    const guard = suffixGuard(structureOf(scenario));
    const end = total(10, 2000);
    expect(guard.originalEndTotal).toBe(end);
    expect(guard.deltaHi).toBe(total(11) - end);
    expect(guard.deltaLo).toBe(total(10) - end);
    expect(guard.logRule).toBe('at-most');
  });

  it('stops at a grind to a level both walks reach, and asks for an equal log when a reader exists', () => {
    const s = hSteps();
    const scenario = hScenario({
      quests: [hQuest(1, 1000), hQuest(2, 1000), hQuest(3, 1000, { minLevel: 12 }), hQuest(4, 1000), hQuest(5, 1000)],
      steps: [...s.quest(1, 100, 0), ...s.quest(2, 200, 0)],
      suffix: [makeGrindStep(s.ids, { until: { kind: 'level', level: 11, offset: null } }), s.accept(3, 50, 0), s.accept(4, 60, 0, { anyOf: [questId(4), questId(5)] })],
    });
    const guard = suffixGuard(structureOf(scenario));
    expect(guard.deltaHi).toBe(total(11) - total(10, 2000));
    expect(guard.deltaLo).toBe(Number.NEGATIVE_INFINITY);
    // The any-of accept after the grind is still a reader of the log.
    expect(guard.logRule).toBe('equal');
  });
});
