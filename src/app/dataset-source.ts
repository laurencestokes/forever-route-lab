import type { DatasetIdentity, DatasetView, NpcId, ProjectV1 } from '../domain';
import { createDatasetViewCache, type DatasetViewInput, type PreparedDataset } from '../infra/data';
import { isFlightMaster } from '../rules/travel-graph';

/**
 * Where the app gets its `DatasetView`: the loaded dataset seen through one project's character
 * (faction and class overlays), custom quests and quest overrides (ARCHITECTURE §5.5, §12.1).
 * `ui` reads the view through this interface and never imports `infra` (ARCHITECTURE §4).
 */
export interface DatasetSource {
  readonly identity: DatasetIdentity;
  /** The view for these inputs. The same inputs (by value, and by identity for the lists) give the same object. */
  view(input: DatasetViewInput): DatasetView;
  /**
   * Every NPC whose `npcFlags` has FLIGHT_MASTER in any faction variant, ascending. `DatasetView`
   * looks records up by id but cannot list them, so the map's flight-master layer starts here and
   * reads each record through the view (which picks the faction's variant).
   */
  readonly flightMasterIds: readonly NpcId[];
}

/**
 * Whether an NPC record is a flight master: QuestieDB's Classic `npcFlags.FLIGHT_MASTER` (8, bit 3),
 * tested arithmetically (D-012). One definition, in src/rules (the TravelGraph seeds its taxi nodes
 * by it), re-exported for the app's callers.
 */
export { isFlightMaster };

/** Flight-master ids over the base records and every faction layer, ascending. */
export function flightMasterIdsOf(prepared: Pick<PreparedDataset, 'base' | 'factions'>): readonly NpcId[] {
  const ids = new Set<NpcId>();
  const layers = [prepared.base, prepared.factions.Alliance, prepared.factions.Horde];
  for (const layer of layers) for (const npc of layer.npcs.values()) if (isFlightMaster(npc)) ids.add(npc.id);
  return [...ids].sort((a, b) => a - b);
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
  return { identity: prepared.identity, view, flightMasterIds: flightMasterIdsOf(prepared) };
}

/**
 * A source that always returns `view`, whatever the character: for test datasets that have no
 * overlays (the Milestone 1 placeholder dataset the shell tests use). A view cannot list its NPCs,
 * so the flight masters are whatever the caller names (none by default).
 */
export function staticDatasetSource(view: DatasetView, flightMasterIds: readonly NpcId[] = []): DatasetSource {
  return { identity: view.identity, view: () => view, flightMasterIds: [...flightMasterIds].sort((a, b) => a - b) };
}
