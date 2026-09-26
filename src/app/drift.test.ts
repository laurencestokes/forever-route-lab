import { describe, expect, it } from 'vitest';
import { fixtureView } from '../../tests/support/fixture-dataset';
import {
  type DatasetView,
  makeAcceptStep,
  makeCompleteStep,
  makeNoteStep,
  type ProjectV1,
  type QuestId,
  type QuestRecord,
  questId,
  sequentialIdSource,
} from '../domain';
import { checkDrift, dataPrintsOf, fingerprint, projectQuestIds } from './drift';
import { notesProject } from './test-helpers';

/** The fixture view with some quests edited or removed, under another data revision. */
function editedView(base: DatasetView, edit: (quest: QuestRecord) => QuestRecord | undefined, revision = 'rev-new'): DatasetView {
  const quests = new Map<QuestId, QuestRecord>();
  for (const quest of base.quests()) {
    const next = edit(quest);
    if (next !== undefined) quests.set(quest.id, next);
  }
  return {
    ...base,
    identity: { ...base.identity, dataRevision: revision },
    quest: (id) => quests.get(id),
    quests: () => [...quests.values()],
    npc: (id) => base.npc(id),
    object: (id) => base.object(id),
    item: (id) => base.item(id),
    spawns: (ref) => base.spawns(ref),
    zone: (id) => base.zone(id),
    zones: () => base.zones(),
  };
}

function projectUsing(ids: readonly QuestId[]): ProjectV1 {
  const project = notesProject('');
  const source = sequentialIdSource(1);
  const [first, second, ...rest] = ids;
  const steps = [
    makeNoteStep(source, { text: 'start' }),
    ...(first === undefined ? [] : [makeAcceptStep(source, { questId: first })]),
    ...(second === undefined ? [] : [makeCompleteStep(source, { targets: [{ questId: second, objective: null }] })]),
    ...rest.map((id) => makeAcceptStep(source, { questId: id })),
  ];
  return { ...project, route: { ...project.route, steps } };
}

describe('projectQuestIds', () => {
  it('collects the quests of the steps and the prior history, distinct and ascending', () => {
    const project = projectUsing([questId(30), questId(10)]);
    const withHistory = { ...project, character: { ...project.character, priorCompletedQuests: [questId(20), questId(10)], priorQuestLog: [questId(5)] } };
    expect(projectQuestIds(withHistory)).toEqual([5, 10, 20, 30]);
  });
});

describe('fingerprint', () => {
  it('is stable, short and sensitive to any change', () => {
    expect(fingerprint('abc')).toBe(fingerprint('abc'));
    expect(fingerprint('abc')).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprint('abc')).not.toBe(fingerprint('abd'));
    expect(fingerprint('')).not.toBe(fingerprint('\u0000'));
  });
});

describe('checkDrift', () => {
  const view = fixtureView();
  const [a, b, c] = view.quests();
  if (a === undefined || b === undefined || c === undefined) throw new Error('fixture needs three quests');
  const project = projectUsing([a.id, b.id, c.id]);
  const prints = dataPrintsOf(project, view);
  const storedRevision = view.identity.dataRevision;

  it('says nothing when the project was saved with the loaded revision', () => {
    expect(checkDrift({ project, storedRevision, view, prints })).toBeNull();
  });

  it('lists quests that are gone and quests whose objectives or prerequisites changed', () => {
    const next = editedView(view, (quest) => {
      if (quest.id === a.id) return undefined;
      if (quest.id === b.id) return { ...quest, objectives: [...quest.objectives, { kind: 'event', text: 'new', points: [] }] };
      if (quest.id === c.id) return { ...quest, prerequisites: { ...quest.prerequisites, preQuestSingle: [questId(999_999)] } };
      return quest;
    });
    expect(checkDrift({ project, storedRevision, view: next, prints })).toEqual({
      storedRevision,
      loadedRevision: 'rev-new',
      questCount: 3,
      missingQuestIds: [a.id],
      changedObjectives: [b.id],
      changedPrerequisites: [c.id],
    });
  });

  it('does not count a record rebuilt with its keys in another order as a change', () => {
    const next = editedView(view, (quest) => ({ ...quest, prerequisites: Object.fromEntries(Object.entries(quest.prerequisites).reverse()) as QuestRecord['prerequisites'] }));
    expect(checkDrift({ project, storedRevision, view: next, prints })).toMatchObject({ missingQuestIds: [], changedObjectives: [], changedPrerequisites: [] });
  });

  it('keeps changes unknown when there are no prints to compare with (an imported file)', () => {
    const next = editedView(view, (quest) => (quest.id === a.id ? undefined : quest));
    expect(checkDrift({ project, storedRevision: 'rev-file', view: next, prints: null })).toEqual({
      storedRevision: 'rev-file',
      loadedRevision: 'rev-new',
      questCount: 3,
      missingQuestIds: [a.id],
      changedObjectives: null,
      changedPrerequisites: null,
    });
  });

  it('ignores prints taken against another revision than the one the project records', () => {
    const next = editedView(view, (quest) => quest);
    expect(checkDrift({ project, storedRevision: 'rev-other', view: next, prints })).toMatchObject({ changedObjectives: null, changedPrerequisites: null });
  });
});
