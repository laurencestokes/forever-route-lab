import type { DatasetView } from '../domain/dataset';
import type { QuestId } from '../domain/ids';
import type { MapGeometry } from '../geo/types';
import { type RxpExportContext, type RxpLowerContext, type RxpQuestFacts, type ZoneKeyLookup, zoneKeyLookup } from '../rxp';

/**
 * The lookups `src/rxp` takes injected (ARCHITECTURE §4, §10), built over what the app has loaded:
 *
 * - **Zone keys** from the view's zone names, which come only from `zones.json` (QuestieDB's
 *   validated `uiMapIdToAreaId.lua` names, DATA_PROVENANCE §6.6). A name two UiMaps share resolves
 *   to nothing, never to a guess; a UiMap only the geometry knows has no name and no key.
 * - **Quest facts** from the view (the dataset overlaid with the project's custom quests): the
 *   objective count for `.complete` index checks (`RXP031`), `custom` for `RXP032`; null for a quest
 *   the view does not have.
 * - **Geometry** (the committed placeholder, or it merged with a local set) for `RXP035` at import
 *   and for points made in the app at export; null without a map.
 *
 * Import and export use the same zone-key table, so a template group lowers again exactly as it
 * was imported (docs/RXP.md §13).
 */
export interface RxpContext {
  readonly lower: RxpLowerContext;
  readonly export: RxpExportContext;
  readonly questFacts: (id: QuestId) => RxpQuestFacts | null;
  readonly zoneKey: ZoneKeyLookup;
}

/** `RxpQuestFacts` of a view's quest, or null when the view does not have it. */
export function questFactsOf(dataset: Pick<DatasetView, 'quest'>): (id: QuestId) => RxpQuestFacts | null {
  return (id) => {
    const quest = dataset.quest(id);
    return quest === undefined ? null : { objectiveCount: quest.objectives.length, custom: quest.provenance.source === 'custom' };
  };
}

export function createRxpContext(dataset: Pick<DatasetView, 'quest' | 'zones'>, geometry: MapGeometry | null): RxpContext {
  const zoneKey = zoneKeyLookup(dataset.zones());
  const questFacts = questFactsOf(dataset);
  return {
    lower: { zoneKey, quest: questFacts, geometry },
    export: { zoneKey, geometry },
    questFacts,
    zoneKey,
  };
}
