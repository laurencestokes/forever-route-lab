import type { CustomQuest, DatasetView } from '../domain';
import type { DatasetSource, DatasetViewInput } from './dataset-source';

/**
 * A `DatasetSource` that keeps the last few views, keyed like the source's own memo (faction,
 * class, and the custom quests and overrides by identity). The loaded source keeps one view, so
 * asking it for a second view (the project's data without its custom quests, `datasetBaseView`)
 * would evict the project's view and hand every later caller a new object; through this cache
 * both stay the same objects while their inputs do.
 */
export function cachedDatasetSource(source: DatasetSource, capacity = 4): DatasetSource {
  const entries: { readonly input: DatasetViewInput; readonly view: DatasetView }[] = [];
  const same = (a: DatasetViewInput, b: DatasetViewInput): boolean =>
    a.faction === b.faction && a.class === b.class && a.customQuests === b.customQuests && a.questOverrides === b.questOverrides;
  return {
    identity: source.identity,
    flightMasterIds: source.flightMasterIds,
    view(input) {
      const at = entries.findIndex((entry) => same(entry.input, input));
      const hit = entries[at];
      if (hit !== undefined) {
        if (at > 0) {
          entries.splice(at, 1);
          entries.unshift(hit);
        }
        return hit.view;
      }
      const view = source.view(input);
      entries.unshift({ input, view });
      if (entries.length > capacity) entries.length = capacity;
      return view;
    },
  };
}

const NO_CUSTOM_QUESTS: readonly CustomQuest[] = [];

/**
 * The project's data without its custom quests (faction, class and overrides as the project has
 * them): what a custom quest with a real id replaces (`shadowedQuest`, DATA001-custom-shadowed).
 */
export function datasetBaseView(source: DatasetSource, input: Omit<DatasetViewInput, 'customQuests'>): DatasetView {
  return source.view({ faction: input.faction, class: input.class, customQuests: NO_CUSTOM_QUESTS, questOverrides: input.questOverrides });
}
