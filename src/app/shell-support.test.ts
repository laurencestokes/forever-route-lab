import { describe, expect, it } from 'vitest';
import {
  makeAcceptStep,
  makeCompleteStep,
  makeTravelStep,
  makeTurnInStep,
  questId,
  sequentialIdSource,
  type QuestRecord,
} from '../domain';
import { createPlaceholderDataset, PLACEHOLDER_QUEST_IDS } from '../infra/data/placeholder-dataset';
import {
  editNoteText,
  effectiveQuestLevel,
  isQuestStep,
  questDifficultyAt,
  questOpenTo,
  questsForCharacter,
  SCALING_QUEST_LEVEL,
  stepQuestIds,
} from './shell-support';
import { notesProject, sid, T0 } from './test-helpers';

const ctx = { ids: sequentialIdSource(), nowIso: T0 };
const masks = (races: number | null, classes: number | null): Pick<QuestRecord, 'races' | 'classes'> => ({ races, classes });

describe('questDifficultyAt', () => {
  it('uses the Era thresholds', () => {
    expect(questDifficultyAt(10, 15)).toBe('impossible');
    expect(questDifficultyAt(10, 13)).toBe('verydifficult');
    expect(questDifficultyAt(10, 8)).toBe('difficult');
    expect(questDifficultyAt(10, 5)).toBe('standard');
    expect(questDifficultyAt(10, 4)).toBe('trivial');
  });

  it('is null, not a guess, when a level is unknown or invalid', () => {
    expect(questDifficultyAt(null, 5)).toBeNull();
    expect(questDifficultyAt(5, null)).toBeNull();
    expect(questDifficultyAt(0, 5)).toBeNull();
    expect(questDifficultyAt(4.5, 5)).toBeNull();
    expect(questDifficultyAt(5, 5.5)).toBeNull();
  });

  it('takes a scaling quest (level -1) at max(minLevel ?? 1, player level), never as level -1 (QXP-7)', () => {
    expect(SCALING_QUEST_LEVEL).toBe(-1);
    // Taken literally, -1 would be grey from level 6 on and yellow at level 1.
    expect(questDifficultyAt(1, -1)).toBe('difficult');
    expect(questDifficultyAt(30, -1)).toBe('difficult');
    expect(questDifficultyAt(30, -1, 10)).toBe('difficult');
    // A required level above the player's is the effective level.
    expect(questDifficultyAt(10, -1, 13)).toBe('verydifficult');
    expect(questDifficultyAt(10, -1, 15)).toBe('impossible');
  });

  it('treats quest levels of 0 and below -1 as unknown', () => {
    expect(questDifficultyAt(10, 0)).toBeNull();
    expect(questDifficultyAt(10, -2)).toBeNull();
    expect(questDifficultyAt(10, -60)).toBeNull();
  });
});

describe('effectiveQuestLevel', () => {
  it('passes valid levels through and resolves scaling quests from the player level', () => {
    expect(effectiveQuestLevel(10, 12)).toBe(12);
    expect(effectiveQuestLevel(null, 12)).toBe(12);
    expect(effectiveQuestLevel(10, -1)).toBe(10);
    expect(effectiveQuestLevel(10, -1, 1)).toBe(10);
    expect(effectiveQuestLevel(10, -1, 14)).toBe(14);
  });

  it('is null when the level cannot be known', () => {
    expect(effectiveQuestLevel(10, null)).toBeNull();
    expect(effectiveQuestLevel(null, -1)).toBeNull();
    expect(effectiveQuestLevel(0, -1)).toBeNull();
    expect(effectiveQuestLevel(1, -1, 2.5)).toBeNull();
    expect(effectiveQuestLevel(10, 0)).toBeNull();
    expect(effectiveQuestLevel(10, -3)).toBeNull();
    expect(effectiveQuestLevel(10, 7.5)).toBeNull();
  });
});

describe('questOpenTo', () => {
  it('tests race and class masks arithmetically', () => {
    expect(questOpenTo(masks(null, null), { race: 'Orc', class: 'WARRIOR' })).toBe(true);
    expect(questOpenTo(masks(178, null), { race: 'Orc', class: 'WARRIOR' })).toBe(true);
    expect(questOpenTo(masks(178, null), { race: 'WindshaperSkyborne', class: 'WARRIOR' })).toBe(true);
    expect(questOpenTo(masks(77, null), { race: 'Orc', class: 'WARRIOR' })).toBe(false);
    expect(questOpenTo(masks(null, 2 ** 7), { race: 'Orc', class: 'WARRIOR' })).toBe(false);
    expect(questOpenTo(masks(null, 2 ** 7), { race: 'Orc', class: 'MAGE' })).toBe(true);
  });

  it('answers null for a malformed mask instead of throwing', () => {
    expect(questOpenTo(masks(-1, null), { race: 'Orc', class: 'WARRIOR' })).toBeNull();
  });
});

describe('questsForCharacter', () => {
  it('splits the placeholder quests by race and sorts them by level, then id', () => {
    const { open, closed, unknown } = questsForCharacter(createPlaceholderDataset(), { race: 'Orc', class: 'WARRIOR' });
    expect(closed.map((q) => q.id)).toEqual([PLACEHOLDER_QUEST_IDS.allianceOnly]);
    expect(open.map((q) => q.id)).toContain(PLACEHOLDER_QUEST_IDS.hordeOnly);
    expect(unknown).toEqual([]);
    const keys = open.map((q) => [q.level ?? Infinity, q.id] as const);
    expect(keys).toEqual([...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  });

  it('puts quests with an unreadable mask in unknown, never in open', () => {
    const base = createPlaceholderDataset();
    const [first, second] = base.quests();
    if (first === undefined || second === undefined) throw new Error('placeholder quests missing');
    const unreadable: QuestRecord[] = [
      { ...first, id: questId(990_002), level: 5, races: -1 },
      { ...second, id: questId(990_001), level: 5, classes: 2 ** 60 },
    ];
    const dataset = { ...base, quests: () => [...base.quests(), ...unreadable] };
    const { open, closed, unknown } = questsForCharacter(dataset, { race: 'Orc', class: 'WARRIOR' });
    expect(unknown.map((q) => q.id)).toEqual([990_001, 990_002]);
    expect([...open, ...closed].some((q) => q.id >= 990_000)).toBe(false);
  });
});

describe('stepQuestIds and isQuestStep', () => {
  const ids = sequentialIdSource();
  it('lists the quests a step acts on', () => {
    expect(stepQuestIds(makeAcceptStep(ids, { questId: questId(5) }))).toEqual([5]);
    expect(stepQuestIds(makeTurnInStep(ids, { questId: questId(6) }))).toEqual([6]);
    const complete = makeCompleteStep(ids, {
      targets: [
        { questId: questId(7), objective: 0 },
        { questId: questId(8), objective: null },
        { questId: questId(7), objective: 1 },
      ],
    });
    expect(stepQuestIds(complete)).toEqual([7, 8]);
    expect(stepQuestIds(makeTravelStep(ids))).toEqual([]);
    expect(isQuestStep(complete)).toBe(true);
    expect(isQuestStep(makeTravelStep(ids))).toBe(false);
  });
});

describe('editNoteText', () => {
  it('changes a note step text and coalesces per step', () => {
    const project = notesProject('ab');
    const command = editNoteText(sid('a'), 'Placeholder edited');
    const next = command.apply(project, ctx);
    const step = next.route.steps[0];
    expect(step?.kind === 'note' ? step.text : null).toBe('Placeholder edited');
    expect(next.route.steps[1]).toBe(project.route.steps[1]);
    expect(command.coalesceKey).toBe('note-text:s-a');
  });

  it('is a no-op for unchanged text, unknown ids and steps that are not notes', () => {
    const project = notesProject('ab');
    expect(editNoteText(sid('a'), 'Placeholder a').apply(project, ctx)).toBe(project);
    expect(editNoteText(sid('z'), 'x').apply(project, ctx)).toBe(project);
    const travel = makeTravelStep({ next: () => 's-t' });
    const withTravel = { ...project, route: { ...project.route, steps: [travel] } };
    expect(editNoteText(sid('t'), 'x').apply(withTravel, ctx)).toBe(withTravel);
  });
});
