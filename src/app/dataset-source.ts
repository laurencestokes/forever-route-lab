import type { DatasetIdentity, DatasetView, ProjectV1 } from '../domain';
import { createDatasetViewCache, type DatasetViewInput, type PreparedDataset } from '../infra/data';

/**
 * Where the app gets its `DatasetView`: the loaded dataset seen through one project's character
 * (faction and class overlays), custom quests and quest overrides (ARCHITECTURE §5.5, §12.1).
 * `ui` reads the view through this interface and never imports `infra` (ARCHITECTURE §4).
 */
export interface DatasetSource {
  readonly identity: DatasetIdentity;
  /** The view for these inputs. The same inputs (by value, and by identity for the lists) give the same object. */
  view(input: DatasetViewInput): DatasetView;
}

export type { DatasetViewInput };

/** The view inputs of a project. */
export function datasetViewInputOf(project: Pick<ProjectV1, 'character' | 'customQuests' | 'questOverrides'>): DatasetViewInput {
  return {
    faction: project.character.faction,
    class: project.character.class,
    customQuests: project.customQuests,
    questOverrides: project.questOverrides,
  };
}

/** The loaded dataset as a source; views are memoised on their inputs. */
export function preparedDatasetSource(prepared: PreparedDataset): DatasetSource {
  const view = createDatasetViewCache(prepared);
  return { identity: prepared.identity, view };
}

/**
 * A source that always returns `view`, whatever the character: for test datasets that have no
 * overlays (the Milestone 1 placeholder dataset the shell tests use).
 */
export function staticDatasetSource(view: DatasetView): DatasetSource {
  return { identity: view.identity, view: () => view };
}
