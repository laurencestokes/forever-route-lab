import { describe, expect, it } from 'vitest';
import { groupId, type QuestId, questId, stepId } from '../domain/ids';
import type { RouteStep } from '../domain/route';
import { makeGrindStep } from '../domain/step-factory';
import { closeChangeSets } from './change-sets';
import { diffRoutes } from './diff';
import { hostIndices, stepQuestIds } from './steps';
import { accept, complete, note, travel, turnIn } from './test-helpers';
import type { DiffRelations, RouteDiff } from './types';

const summary = (diff: RouteDiff): { id: string; quests: number[]; steps: string[]; requires: readonly string[] }[] =>
  diff.changeSets.map((set) => ({
    id: set.id,
    quests: [...set.questIds],
    steps: set.ops.map((k) => {
      const op = diff.ops[k];
      if (op === undefined) return '?';
      switch (op.kind) {
        case 'insert':
          return `+${op.step.id}`;
        case 'remove':
          return `-${op.stepId}`;
        case 'move':
          return `~${op.stepId}`;
        case 'modify':
          return `*${op.stepId}`;
        case 'group-add':
        case 'group-remove':
        case 'group-modify':
          return `${op.kind}:${op.groupId}`;
      }
    }),
    requires: set.requires,
  }));

const relations = (table: { exclusive?: Record<number, number[]>; prerequisites?: Record<number, number[]> }): DiffRelations => ({
  exclusive: (q: QuestId) => (table.exclusive?.[q] ?? []).map(questId),
  prerequisites: (q: QuestId) => (table.prerequisites?.[q] ?? []).map(questId),
});

describe('stepQuestIds and hostIndices', () => {
  it('names the quests of quest steps, sorted and without repeats', () => {
    expect(stepQuestIds(accept('a', 5, { anyOf: [9, 3, 5] }))).toEqual([3, 5, 9]);
    expect(stepQuestIds(complete('c', [8, 2, 8]))).toEqual([2, 8]);
    expect(stepQuestIds(turnIn('t', 4))).toEqual([4]);
    expect(stepQuestIds(note('n'))).toEqual([]);
  });

  it('binds a non-quest step to the next quest step whatever its group, and a trailing run to none', () => {
    const g1 = groupId('G1');
    const g2 = groupId('G2');
    // Interleaved groups (docs/research/optimizer-m7.md §3.2): T1 in G1 binds to A in G2, not to B in G1.
    const steps = [travel('T1', { groupId: g1 }), accept('A', 1, { groupId: g2 }), accept('B', 2, { groupId: g1 }), note('N1'), travel('T2')];
    expect([...hostIndices(steps)]).toEqual([1, 1, 2, -1, -1]);
    expect([...hostIndices([])]).toEqual([]);
  });
});

describe('change-sets', () => {
  it('groups a quest unit (bound travel steps with their host) into one set', () => {
    const before = [
      travel('t1'), accept('a1', 1), travel('t2'), complete('c1', [1]), travel('t3'), turnIn('ti1', 1),
      travel('t4'), accept('a2', 2), turnIn('ti2', 2),
    ];
    const byId = new Map(before.map((s) => [s.id, s]));
    const order = ['t4', 'a2', 'ti2', 't1', 'a1', 't2', 'c1', 't3', 'ti1'];
    const after = order.map((id) => byId.get(stepId(id)) as RouteStep);
    expect(summary(diffRoutes(before, after))).toEqual([{ id: 'q:2', quests: [2], steps: ['~t4', '~a2', '~ti2'], requires: [] }]);
  });

  it('follows the interleaved-group binding, and gives a hostless step its own set', () => {
    const g1 = groupId('G1');
    const before = [travel('T1', { groupId: g1 }), accept('A', 1), accept('B', 2, { groupId: g1 }), travel('T9')];
    const after = [accept('A', 1), accept('B', 2, { groupId: g1 })];
    expect(summary(diffRoutes(before, after))).toEqual([
      { id: 'q:1', quests: [1], steps: ['-T1'], requires: [] },
      { id: 's:T9', quests: [], steps: ['-T9'], requires: [] },
    ]);
  });

  it('merges the quests of a multi-target complete', () => {
    const before = [accept('a1', 1), accept('a2', 2), complete('c', [1, 2]), turnIn('t1', 1), turnIn('t2', 2), accept('a3', 3), turnIn('t3', 3)];
    const after = [accept('a3', 3), turnIn('t3', 3), accept('a1', 1), accept('a2', 2), { ...complete('c', [1, 2]), note: 'edited' }, turnIn('t1', 1)];
    // t2 removed (quest 2) and the complete edited (quests 1 and 2): one set, named by quest 1.
    expect(summary(diffRoutes(before, after))).toEqual([
      { id: 'q:1', quests: [1, 2], steps: ['-t2', '*c'], requires: [] },
      { id: 'q:3', quests: [3], steps: ['~a3', '~t3'], requires: [] },
    ]);
  });

  it('merges a modify with the move of the same step, and names the set by its lowest quest', () => {
    const before = [accept('a', 7), accept('b', 3)];
    const after = [{ ...(before[1] as RouteStep), note: 'x' }, before[0] as RouteStep];
    expect(summary(diffRoutes(before, after))).toEqual([{ id: 'q:3', quests: [3], steps: ['~b', '*b'], requires: [] }]);
  });

  it('merges exclusive quests that ops touch, and ignores untouched partners', () => {
    const before = [accept('a1', 1), accept('a2', 2), accept('a3', 3)];
    const after = [accept('a3', 3)];
    const diff = diffRoutes(before, after, { relations: relations({ exclusive: { 1: [2, 99], 2: [1] } }) });
    expect(summary(diff)).toEqual([{ id: 'q:1', quests: [1, 2], steps: ['-a1', '-a2'], requires: [] }]);
  });

  it('turns prerequisites into requires edges: placing needs the prerequisite placed, removing needs the dependant removed', () => {
    const rel = relations({ prerequisites: { 2: [1] } });
    // Both quests moved to the end, past quest 3: quest 2's set requires quest 1's.
    const placed = diffRoutes(
      [accept('a1', 1), turnIn('t1', 1), accept('a2', 2), turnIn('t2', 2), accept('a3', 3)],
      [accept('a3', 3), accept('a1', 1), turnIn('t1', 1), accept('a2', 2), turnIn('t2', 2)],
      { relations: rel },
    );
    // The subsequence keeps quests 1 and 2 (four steps) and moves a3.
    expect(summary(placed)).toEqual([{ id: 'q:3', quests: [3], steps: ['~a3'], requires: [] }]);
    const placedBoth = diffRoutes(
      [accept('a3', 3), turnIn('t3', 3), note('n'), accept('a1', 1), turnIn('t1', 1), accept('a2', 2), turnIn('t2', 2)],
      [accept('a1', 1), turnIn('t1', 1), accept('a2', 2), turnIn('t2', 2), accept('a3', 3), turnIn('t3', 3), note('n')],
      { relations: rel, fixed: (s) => s.id === 'a3' || s.id === 't3' || s.id === 'n' },
    );
    expect(summary(placedBoth)).toEqual([
      { id: 'q:1', quests: [1], steps: ['~a1', '~t1'], requires: [] },
      { id: 'q:2', quests: [2], steps: ['~a2', '~t2'], requires: ['q:1'] },
    ]);
    const removed = diffRoutes([accept('a1', 1), turnIn('t1', 1), accept('a2', 2), turnIn('t2', 2), accept('a3', 3)], [accept('a3', 3)], { relations: rel });
    expect(summary(removed)).toEqual([
      { id: 'q:1', quests: [1], steps: ['-a1', '-t1'], requires: ['q:2'] },
      { id: 'q:2', quests: [2], steps: ['-a2', '-t2'], requires: [] },
    ]);
    // Removing the dependant alone needs nothing; removing the prerequisite brings the dependant.
    expect([...closeChangeSets(removed, ['q:2'])]).toEqual(['q:2']);
    expect([...closeChangeSets(removed, ['q:1'])].sort()).toEqual(['q:1', 'q:2']);
  });

  it('turns step dependencies into requires edges (the grind fill needs the removals and XP moves)', () => {
    const fill = makeGrindStep({ next: () => 'fill' }, { until: { kind: 'level', level: 10, offset: null }, origin: { source: 'optimizer', ref: null } });
    const before = [accept('b1', 2), turnIn('b2', 2), accept('a1', 1), turnIn('a2', 1), accept('c1', 3), turnIn('c2', 3)];
    const after = [accept('a1', 1), turnIn('a2', 1), accept('b1', 2), turnIn('b2', 2), fill];
    const diff = diffRoutes(before, after, { dependencies: [{ stepId: stepId('fill'), requires: [stepId('c1'), stepId('c2'), stepId('a2'), stepId('zz')] }] });
    // The subsequence keeps b (the smaller before-indices on the tie) and moves a.
    expect(summary(diff)).toEqual([
      { id: 'q:3', quests: [3], steps: ['-c1', '-c2'], requires: [] },
      { id: 'q:1', quests: [1], steps: ['~a1', '~a2'], requires: [] },
      { id: 's:fill', quests: [], steps: ['+fill'], requires: ['q:3', 'q:1'] },
    ]);
    expect([...closeChangeSets(diff, ['s:fill'])]).toEqual(['s:fill', 'q:3', 'q:1']);
  });

  it('gives a step with a dependency (the grind fill) a set of its own, whatever quest follows it', () => {
    // A proposal's whole route (as proposalDiff diffs it): section [a1..t3] reordered, the fill at
    // its end, then an untouched suffix whose first quest step (a9) would be the fill's host.
    const fill = makeGrindStep({ next: () => 'fill' }, { until: { kind: 'level', level: 10, offset: null }, origin: { source: 'optimizer', ref: null } });
    const section = [accept('a1', 1), turnIn('t1', 1), accept('a2', 2), turnIn('t2', 2), accept('a3', 3), turnIn('t3', 3)];
    const suffix = [note('n'), accept('a9', 9), turnIn('t9', 9)];
    const byId = new Map(section.map((s) => [s.id, s]));
    const candidate = ['a2', 't2', 'a3', 't3', 'a1', 't1'].map((id) => byId.get(stepId(id)) as RouteStep);
    const dependencies = [{ stepId: stepId('fill'), requires: [stepId('t1')] }];
    const plain = diffRoutes([...section, ...suffix], [...candidate, fill, ...suffix], { dependencies });
    // The fill used to be q:9, named after the suffix quest the proposal never touched.
    expect(summary(plain)).toEqual([
      { id: 'q:1', quests: [1], steps: ['~a1', '~t1'], requires: [] },
      { id: 's:fill', quests: [], steps: ['+fill'], requires: ['q:1'] },
    ]);
    // Quest 9 exclusive to quest 1 used to merge the fill into quest 1's set, so moving quest 1
    // brought the grinding with it.
    const exclusive = diffRoutes([...section, ...suffix], [...candidate, fill, ...suffix], {
      dependencies,
      relations: relations({ exclusive: { 1: [9], 9: [1] } }),
    });
    expect(summary(exclusive)).toEqual(summary(plain));
    expect([...closeChangeSets(exclusive, ['q:1'])]).toEqual(['q:1']);
    // Without a dependency, a non-quest step still joins its host's set.
    expect(summary(diffRoutes([...section, ...suffix], [...candidate, fill, ...suffix])).map((set) => set.id)).toEqual(['q:1', 'q:9']);
  });

  it('closes selections transitively and refuses unknown ids', () => {
    const rel = relations({ prerequisites: { 2: [1], 3: [2] } });
    const diff = diffRoutes([accept('a1', 1), accept('a2', 2), accept('a3', 3), note('n')], [note('n')], { relations: rel });
    expect(summary(diff).map((s) => [s.id, s.requires])).toEqual([
      ['q:1', ['q:2']],
      ['q:2', ['q:3']],
      ['q:3', []],
    ]);
    expect([...closeChangeSets(diff, ['q:1'])]).toEqual(['q:1', 'q:2', 'q:3']);
    expect([...closeChangeSets(diff, [])]).toEqual([]);
    expect(() => closeChangeSets(diff, ['q:9'])).toThrow(/Unknown change-set "q:9"/);
  });
});
