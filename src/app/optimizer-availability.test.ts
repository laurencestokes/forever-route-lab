import { describe, expect, it } from 'vitest';
import { factionId, questId, skillId } from '../domain/ids';
import { stubDataset, stubQuest } from './map-test-helpers';
import { codesTruth, compileAvailability } from './optimizer-availability';

/**
 * `compileAvailability` (docs/research/optimizer-m7.md §4.2): the dependency lists read from the
 * same record fields as the validator's `check`, and the truth of finding codes as `acceptTruth`
 * reads them. The probe visitor is exercised by the run and verification tests.
 */

const q = questId;

describe('compileAvailability', () => {
  const pre = (fields: Partial<ReturnType<typeof stubQuest>['prerequisites']>) => ({ ...stubQuest({ id: q(1), name: 'x' }).prerequisites, ...fields });
  const dataset = stubDataset({
    quests: [
      stubQuest({ id: q(10), name: 'single', prerequisites: pre({ preQuestSingle: [q(1), q(2)], exclusiveTo: [q(11), q(10)], breadcrumbs: [q(12)] }) }),
      stubQuest({ id: q(20), name: 'group', prerequisites: pre({ preQuestGroup: [3, -4], parentQuest: q(5), availableStartingWith: q(6) }) }),
      stubQuest({ id: q(3), name: 'alt', prerequisites: pre({ exclusiveTo: [q(7)] }) }),
      stubQuest({
        id: q(30),
        name: 'breadcrumb',
        minLevel: 8,
        maxLevel: 20,
        prerequisites: pre({ breadcrumbForQuestId: q(31), nextQuestInChain: q(32), availableUntilCompleted: q(33), disabledByQuest: q(34) }),
        requirements: { ...stubQuest({ id: q(1), name: 'x' }).requirements, minReputation: { factionId: factionId(76), value: 3000 }, maxReputation: { factionId: factionId(76), value: 9000 }, spell: -123, skill: { skillId: skillId(171), value: 50 } },
      }),
      stubQuest({ id: q(31), name: 'target', minLevel: 11, prerequisites: pre({ preQuestSingle: [q(8)] }) }),
      stubQuest({ id: q(40), name: 'previous', prerequisites: pre({ nextQuestInChain: q(30) }) }),
    ],
  });
  const availability = compileAvailability({ dataset });

  it('lists what check reads, by relation', () => {
    expect(availability.dependencies(q(10))).toEqual({
      completed: [[q(1), q(2)]],
      inLog: [],
      takenOrDone: [],
      blockers: [q(11), q(12)],
      minLevel: 1,
      maxLevel: null,
      parent: null,
      skills: [],
      spells: [],
      minReputation: [],
      maxReputation: [],
      breadcrumbTarget: null,
    });
    // A positive group entry carries its exclusive alternatives; a negative one does not.
    expect(availability.dependencies(q(20))).toMatchObject({ completed: [[q(3), q(7)], [q(4)]], inLog: [q(5)], parent: q(5), takenOrDone: [q(6)] });
    const breadcrumb = availability.dependencies(q(30));
    expect(breadcrumb).toMatchObject({
      blockers: [q(31), q(32), q(33), q(34), q(40)],
      minLevel: 8,
      maxLevel: 20,
      skills: [171],
      spells: [123],
      minReputation: [76],
      maxReputation: [76],
    });
    expect(breadcrumb.breadcrumbTarget).toEqual({ questId: q(31), dependencies: expect.objectContaining({ completed: [[q(8)]], minLevel: 11 }) as unknown });
    // An unknown quest reads nothing but itself.
    expect(availability.dependencies(q(999))).toMatchObject({ completed: [], blockers: [], minLevel: null });
  });

  it('reads codes as acceptTruth does: an error blocks, a doubt is unknown, an info is true', () => {
    expect(codesTruth([])).toBe('true');
    expect(codesTruth(['VAL022-needs-event'])).toBe('true');
    expect(codesTruth(['VAL004-min-level-uncertain', 'VAL022-needs-event'])).toBe('unknown');
    expect(codesTruth(['VAL004-min-level-uncertain', 'VAL004-min-level'])).toBe('false');
    expect(codesTruth(['NOT-A-CODE'])).toBe('false');
    expect(availability.truth(['VAL013-breadcrumb-target-unavailable'])).toBe('unknown');
  });
});
