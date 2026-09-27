import { describe, expect, it } from 'vitest';
import { type QuestId, questId, stepId } from '../domain/ids';
import type { RouteStep } from '../domain/route';
import { makeGrindStep } from '../domain/step-factory';
import { applyChangeSets } from './apply';
import { closeChangeSets } from './change-sets';
import { diffRoutes } from './diff';
import { stepQuestIds } from './steps';
import { accept, note, turnIn } from './test-helpers';
import type { DiffOptions, RouteDiff } from './types';

/**
 * Two real optimiser proposals on the app's sample route (src/app/sample-route.ts), recorded as the
 * diff sees them: each step's kind and quests, the candidate's order, the section's anchors, the
 * grind fill's step dependency and the dataset's prerequisites. They come from `startOptimization`
 * (min-time, the original XP kept, beam 256, 400,000 evaluations) on sections [1..54] and [3..43],
 * and `proposalDiff` (src/app/optimizer-proposal.ts) diffs the whole route as `proposal` does here.
 * Step ids are `s<route index>`; the fill is `fill`.
 */

/** The sample route: a note, then 27 accept/turn-in pairs. */
const ROUTE =
  'n a2383 t2383 a4641 t4641 a788 t788 a789 t789 a4402 t4402 a792 t792 a5441 t5441 a6394 t6394 a790 t790 a794 t794 a804 t804 a805 t805 ' +
  'a2161 t2161 a784 t784 a791 t791 a818 t818 a823 t823 a831 t831 a786 t786 a817 t817 a825 t825 a808 t808 a826 t826 a806 t806 a827 t827 ' +
  'a828 t828 a829 t829';

/** The dataset's prerequisites of the route's quests (`preQuestSingle` and `preQuestGroup`); no quest is exclusive. */
const PREREQUISITES: Readonly<Record<number, readonly number[]>> = {
  789: [788],
  794: [792, 1499],
  804: [790],
  805: [794],
  806: [823],
  825: [784],
  827: [828],
  828: [806],
  829: [827],
  831: [830],
  2383: [788],
  4402: [788],
  6394: [5441],
};

interface Recorded {
  /** The candidate route: before-indices, with -1 for the fill. */
  readonly after: string;
  /** The section's anchors (the diff's fixed steps), as before-indices. */
  readonly anchors: readonly number[];
  /** The before-indices the fill's dependency requires. */
  readonly fillRequires: readonly number[];
}

const SECTION_1_54: Recorded = {
  after: '0 1 17 18 11 12 19 20 13 14 43 44 39 40 31 32 45 46 33 25 34 27 28 47 48 35 41 42 26 29 30 49 50 53 54 36 21 15 16 3 2 22 4 5 6 7 8 9 10 23 37 38 24 51 52 -1',
  anchors: [1],
  fillRequires: [18, 20, 44, 40, 46, 28, 48, 26, 30, 54, 36, 16, 2, 22, 4, 6, 8, 10, 38, 24],
};

const SECTION_3_43: Recorded = {
  after: '0 1 2 17 18 11 12 19 20 13 14 29 30 27 28 41 42 39 40 31 32 33 43 37 38 25 15 16 3 23 4 5 6 7 9 10 35 34 26 36 21 22 8 24 -1 44 45 46 47 48 49 50 51 52 53 54',
  anchors: [],
  fillRequires: [18, 20, 30, 42, 40, 38, 16, 4, 6, 10, 26, 22, 8, 24],
};

function sampleRoute(): RouteStep[] {
  return ROUTE.split(' ').map((code, i) => {
    const id = `s${String(i)}`;
    if (code === 'n') return note(id);
    const quest = Number(code.slice(1));
    return code.startsWith('a') ? accept(id, quest) : turnIn(id, quest);
  });
}

function proposal(recorded: Recorded): { readonly before: RouteStep[]; readonly after: RouteStep[]; readonly diff: RouteDiff } {
  const before = sampleRoute();
  const fill = makeGrindStep({ next: () => 'fill' }, { until: { kind: 'level', level: 10, offset: null }, origin: { source: 'optimizer', ref: null } });
  const after = recorded.after.split(' ').map((index) => (index === '-1' ? fill : (before[Number(index)] as RouteStep)));
  const anchors = new Set(recorded.anchors.map((i) => before[i]?.id));
  const options: DiffOptions = {
    relations: { exclusive: () => [], prerequisites: (q: QuestId) => (PREREQUISITES[q] ?? []).map(questId) },
    fixed: (step) => step.locked || anchors.has(step.id),
    dependencies: [{ stepId: stepId('fill'), requires: recorded.fillRequires.map((i) => before[i]?.id ?? stepId('?')) }],
  };
  return { before, after, diff: diffRoutes(before, after, options) };
}

const label = (step: RouteStep): string => (step.kind === 'accept' ? `a${String(step.questId)}` : step.kind === 'turnin' ? `t${String(step.questId)}` : step.id);

/**
 * The quests of the selected sets (closed over `requires`) whose steps are not in their `after`
 * order in `result`, as `quest: labels in result order`.
 */
function questsOutOfOrder(after: readonly RouteStep[], diff: RouteDiff, selected: ReadonlySet<string>, result: readonly RouteStep[]): string[] {
  const closed = closeChangeSets(diff, selected);
  const position = new Map(result.map((s, i) => [s.id, i]));
  const out: string[] = [];
  for (const set of diff.changeSets) {
    if (!closed.has(set.id)) continue;
    for (const q of set.questIds) {
      const inAfter = after.filter((s) => stepQuestIds(s).includes(q));
      const inResult = [...inAfter].sort((x, y) => (position.get(x.id) ?? -1) - (position.get(y.id) ?? -1));
      if (inResult.some((s, i) => s !== inAfter[i])) out.push(`${String(q)}: ${inResult.map(label).join(' ')}`);
    }
  }
  return out;
}

describe('change-sets of real optimiser proposals on the sample route', () => {
  it('[1..54]: selecting quest 804 (and its prerequisite 790) keeps its accept before its turn-in', () => {
    const { before, after, diff } = proposal(SECTION_1_54);
    expect(diff.changeSets.map((set) => set.id).join(' ')).toBe(
      'q:790 q:794 q:808 q:817 q:826 q:2161 q:784 q:806 q:791 q:829 q:831 q:804 q:6394 q:4641 q:2383 q:788 q:789 q:4402 q:805 q:786 s:fill',
    );
    expect(diff.changeSets.find((set) => set.id === 'q:804')?.requires).toEqual(['q:790']);
    expect(applyChangeSets(before, diff, new Set(diff.changeSets.map((set) => set.id)))).toEqual(after);

    const selected = new Set(['q:804']);
    const result = applyChangeSets(before, diff, selected);
    // The old placement put t804 at 5 (after t2383, whose move was not selected) and a804 at 36.
    const at = (id: string): number => result.findIndex((s) => s.id === id);
    expect(at('s22')).toBeGreaterThan(at('s21'));
    expect(questsOutOfOrder(after, diff, selected, result)).toEqual([]);
  });

  it('[1..54] and [3..43]: every set applied alone keeps the steps of its quests in their proposed order', () => {
    for (const recorded of [SECTION_1_54, SECTION_3_43]) {
      const { before, after, diff } = proposal(recorded);
      for (const set of diff.changeSets) {
        const selected = new Set([set.id]);
        expect(questsOutOfOrder(after, diff, selected, applyChangeSets(before, diff, selected)), set.id).toEqual([]);
      }
    }
  });

  it('[3..43]: the grind fill has a set of its own, not the set of the first quest after the section', () => {
    const { before, after, diff } = proposal(SECTION_3_43);
    // The section ends with a808, which moves; t808 is the first step after the section. The fill
    // used to join quest 808's set, which then required 14 other sets.
    const byId = new Map(diff.changeSets.map((set) => [set.id, set]));
    expect(byId.get('q:808')).toEqual({ id: 'q:808', questIds: [808], ops: [diff.ops.findIndex((op) => op.kind === 'move' && op.stepId === 's43')], requires: [] });
    const fill = byId.get('s:fill');
    expect(fill?.questIds).toEqual([]);
    expect(fill?.ops.map((k) => diff.ops[k]?.kind)).toEqual(['insert']);
    expect(fill?.requires).toEqual([
      'q:790', 'q:794', 'q:791', 'q:825', 'q:817', 'q:786', 'q:2161', 'q:6394', 'q:4641', 'q:805', 'q:788', 'q:789', 'q:4402', 'q:804',
    ]);
    // Moving quest 808 is a change of its own: a808 goes after a823, as proposed, and nothing else moves.
    const moved = applyChangeSets(before, diff, new Set(['q:808']));
    expect(moved.map(label)).toEqual(before.filter((s) => s.id !== 's43').flatMap((s) => (s.id === 's33' ? ['a823', 'a808'] : [label(s)])));
    expect(applyChangeSets(before, diff, new Set(diff.changeSets.map((set) => set.id)))).toEqual(after);
  });
});
