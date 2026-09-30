import { type DatasetIdentity, type DatasetView, type Faction, type NpcId, type ProjectV1, type UiMapId, uiMapId } from '../domain';
import { createDatasetViewCache, type DatasetViewInput, type PreparedDataset } from '../infra/data';
import type { DungeonTable } from '../infra/data/points';
import type { ZonesTable } from '../infra/data/rows';
import type { MapGeometry } from '../geo/types';
import { isFlightMaster } from '../rules/travel-graph-flags';

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
  /**
   * Every NPC whose `npcFlags` has INNKEEPER, TRAINER or VENDOR (128, 16, 4) in any faction variant,
   * ascending, for the map's services (map-presentation.md §11; step MP.11): listed on first use, in
   * the lazy derived pipeline. Absent for a source that cannot list its NPCs.
   */
  readonly serviceNpcIds?: () => readonly NpcId[];
  /**
   * The rows the map's dungeon entrances are read from (map-presentation.md §8.2): `zones.json`,
   * the faction's dungeon table and the geometry, converted in the lazy derived pipeline
   * (`datasetDungeons`). Absent for a source with no dungeon table (the placeholder dataset).
   */
  readonly dungeonRows?: (faction: Faction) => { readonly zones: ZonesTable; readonly dungeons: DungeonTable; readonly geometry: MapGeometry };
  /**
   * Each AreaTable id `zones.json` `areas` links to a UiMap (`direct`, `routed` or
   * `synthetic-alias`: a subzone such as the Valley of Trials, 363, to Durotar, 1411), for the zone
   * level spans (review finding QA-02). Listed on first use. Absent for a source without the table.
   */
  readonly areaZones?: () => ReadonlyMap<number, UiMapId>;
}

/** The area links of `zones.json` that place an area on a UiMap (DATA_PROVENANCE §6.5; `infra/data/points.ts`). */
export function areaZonesOf(zones: Pick<ZonesTable, 'areas'>): ReadonlyMap<number, UiMapId> {
  const out = new Map<number, UiMapId>();
  for (const [key, link] of Object.entries(zones.areas)) {
    if (link.link === 'direct' || link.link === 'routed' || link.link === 'synthetic-alias') out.set(Number(key), uiMapId(link.uiMapId));
  }
  return out;
}

/**
 * Whether an NPC record is a flight master: QuestieDB's Classic `npcFlags.FLIGHT_MASTER` (8, bit 3),
 * tested arithmetically (D-012). One definition, in src/rules (the TravelGraph seeds its taxi nodes
 * by it), re-exported for the app's callers.
 */
export { isFlightMaster };

/** The ids over the base records and every faction layer whose record passes `test`, ascending. */
function npcIdsOf(prepared: Pick<PreparedDataset, 'base' | 'factions'>, test: (npc: { readonly npcFlags: number }) => boolean): readonly NpcId[] {
  const ids = new Set<NpcId>();
  const layers = [prepared.base, prepared.factions.Alliance, prepared.factions.Horde];
  for (const layer of layers) for (const npc of layer.npcs.values()) if (test(npc)) ids.add(npc.id);
  return [...ids].sort((a, b) => a - b);
}

/** Flight-master ids over the base records and every faction layer, ascending. */
export const flightMasterIdsOf = (prepared: Pick<PreparedDataset, 'base' | 'factions'>): readonly NpcId[] => npcIdsOf(prepared, isFlightMaster);

/** An innkeeper, trainer or vendor flag (128, 16, 4), tested arithmetically (D-012). */
const isService = (npc: { readonly npcFlags: number }): boolean => [128, 16, 4].some((bit) => Math.floor(npc.npcFlags / bit) % 2 === 1);

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
  const tables = prepared.dungeonTables;
  let services: readonly NpcId[] | undefined;
  let areaZones: ReadonlyMap<number, UiMapId> | undefined;
  return {
    identity: prepared.identity,
    view,
    flightMasterIds: flightMasterIdsOf(prepared),
    serviceNpcIds: () => (services ??= npcIdsOf(prepared, isService)),
    dungeonRows: (faction) => ({ zones: tables.zones, dungeons: tables.byFaction[faction], geometry: prepared.geometry }),
    areaZones: () => (areaZones ??= areaZonesOf(tables.zones)),
  };
}

/**
 * A source that always returns `view`, whatever the character: for test datasets that have no
 * overlays (the Milestone 1 placeholder dataset the shell tests use). A view cannot list its NPCs,
 * so the flight masters are whatever the caller names (none by default).
 */
export function staticDatasetSource(view: DatasetView, flightMasterIds: readonly NpcId[] = []): DatasetSource {
  return { identity: view.identity, view: () => view, flightMasterIds: [...flightMasterIds].sort((a, b) => a - b) };
}
