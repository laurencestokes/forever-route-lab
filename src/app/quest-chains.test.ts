import { describe, expect, it } from 'vitest';
import { type QuestId, type QuestRecord, questId } from '../domain';
import { stubDataset, stubQuest } from './map-test-helpers';
import { questChainLabel, questChainPosition, withChainLabel } from './quest-chains';

const q = questId;

function quest(id: number, links: { next?: number; pre?: readonly number[] } = {}): QuestRecord {
  const base = stubQuest({ id: q(id), name: `Quest ${String(id)}` });
  return {
    ...base,
    prerequisites: {
      ...base.prerequisites,
      nextQuestInChain: links.next === undefined ? null : q(links.next),
      preQuestSingle: (links.pre ?? []).map(q),
    },
  };
}

const ids = (list: readonly QuestId[] | undefined): number[] => (list ?? []).map(Number);

describe('questChainPosition', () => {
  it('follows nextQuestInChain both ways', () => {
    const dataset = stubDataset({ quests: [quest(1, { next: 2 }), quest(2, { next: 3 }), quest(3)] });
    expect(questChainPosition(dataset, q(1))).toMatchObject({ index: 1, length: 3 });
    expect(questChainPosition(dataset, q(2))).toMatchObject({ index: 2, length: 3 });
    expect(ids(questChainPosition(dataset, q(3))?.quests)).toEqual([1, 2, 3]);
    expect(questChainLabel(dataset, q(2))).toBe('(2/3)');
    expect(withChainLabel(dataset, q(3), 'Third')).toBe('Third (3/3)');
  });

  it('falls back on single pre-quest links where no nextQuestInChain says', () => {
    const dataset = stubDataset({ quests: [quest(10), quest(11, { pre: [10] }), quest(12, { pre: [11] })] });
    expect(questChainLabel(dataset, q(10))).toBe('(1/3)');
    expect(questChainLabel(dataset, q(12))).toBe('(3/3)');
  });

  it('ends the chain at an ambiguous link, a missing quest or a cycle, and has no label alone', () => {
    // Two quests follow 20 through their only pre-quest: 20 has no single next.
    const branching = stubDataset({ quests: [quest(20), quest(21, { pre: [20] }), quest(22, { pre: [20] })] });
    expect(questChainLabel(branching, q(20))).toBeNull();
    expect(questChainLabel(branching, q(21))).toBe('(2/2)');
    // Two quests name 31 as next: 31 has no single previous.
    const merging = stubDataset({ quests: [quest(30, { next: 31 }), quest(32, { next: 31 }), quest(31)] });
    expect(questChainLabel(merging, q(31))).toBeNull();
    expect(questChainLabel(merging, q(30))).toBe('(1/2)');
    const missing = stubDataset({ quests: [quest(40, { next: 41 })] });
    expect(questChainPosition(missing, q(40))).toBeNull();
    const cycle = stubDataset({ quests: [quest(50, { next: 51 }), quest(51, { next: 50 })] });
    expect(questChainPosition(cycle, q(50))).toMatchObject({ length: 2 });
    const alone = stubDataset({ quests: [quest(60), quest(61, { pre: [60, 99] })] });
    expect(questChainLabel(alone, q(60))).toBeNull();
    expect(questChainLabel(alone, q(61))).toBeNull();
    expect(questChainLabel(alone, q(999))).toBeNull();
    expect(withChainLabel(alone, q(60), 'Alone')).toBe('Alone');
  });
});
