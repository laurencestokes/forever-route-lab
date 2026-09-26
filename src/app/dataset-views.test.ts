import { describe, expect, it } from 'vitest';
import { createEmptyProject, type DatasetView, questId, sequentialIdSource } from '../domain';
import type { DatasetSource, DatasetViewInput } from './dataset-source';
import { cachedDatasetSource, datasetBaseView } from './dataset-views';
import { stubDataset, stubQuest } from './map-test-helpers';
import { buildCustomQuest } from './project-commands';

/** A source that, like the loaded one, keeps only its last view. */
function singleEntrySource(): DatasetSource & { readonly built: DatasetViewInput[] } {
  const built: DatasetViewInput[] = [];
  let last: { readonly input: DatasetViewInput; readonly view: DatasetView } | null = null;
  return {
    built,
    identity: stubDataset({}).identity,
    flightMasterIds: [],
    view(input) {
      if (last !== null && last.input.faction === input.faction && last.input.class === input.class && last.input.customQuests === input.customQuests && last.input.questOverrides === input.questOverrides) return last.view;
      built.push(input);
      const view = stubDataset({ quests: [stubQuest({ id: questId(1), name: 'Dataset' }), ...input.customQuests.map((q) => stubQuest({ id: q.id, name: q.name }))] });
      last = { input, view };
      return view;
    },
  };
}

describe('cachedDatasetSource', () => {
  it('keeps the project view and the base view apart, so neither is rebuilt while its inputs stay', () => {
    const source = singleEntrySource();
    const cached = cachedDatasetSource(source);
    const base = createEmptyProject({ ids: sequentialIdSource(), nowIso: '2026-09-26T00:00:00.000Z', name: 'x' });
    const custom = buildCustomQuest({ id: questId(1), name: 'Custom', level: 1, minLevel: null, baseXp: null, foreverStatus: 'unknown', starterLocation: null, finisherLocation: null }, null);
    const project = { ...base, customQuests: [custom] };
    const input: DatasetViewInput = { faction: 'Horde', class: 'WARRIOR', customQuests: project.customQuests, questOverrides: project.questOverrides };
    const view = cached.view(input);
    const baseView = datasetBaseView(cached, input);
    expect(cached.view(input)).toBe(view);
    expect(datasetBaseView(cached, input)).toBe(baseView);
    expect(source.built).toHaveLength(2);
    expect(view.quest(questId(1))?.name).toBe('Custom');
    expect(baseView.quest(questId(1))?.name).toBe('Dataset');
    expect(cached.identity).toBe(source.identity);
  });

  it('drops the least recently used view past its capacity', () => {
    const source = singleEntrySource();
    const cached = cachedDatasetSource(source, 2);
    const input = (cls: DatasetViewInput['class']): DatasetViewInput => ({ faction: 'Horde', class: cls, customQuests: [], questOverrides: {} });
    const warrior = input('WARRIOR');
    const first = cached.view(warrior);
    cached.view(input('MAGE'));
    cached.view(input('ROGUE'));
    expect(cached.view(warrior)).not.toBe(first);
  });
});
