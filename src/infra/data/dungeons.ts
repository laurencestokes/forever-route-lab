import { type AreaId, areaId, type UiMapId } from '../../domain/ids';
import type { WorldPoint } from '../../domain/points';
import { type MapGeometry, resolvePoint } from '../../geo';
import { isSourcedPoint, publishedPoint, type DungeonTable } from './points';
import type { ZonesTable } from './rows';

/**
 * The dataset's dungeons with their entrances as world points (`zones.json` `dungeons`, QuestieDB's
 * `dungeons.lua`, with a faction's whole-entry replacements; DATA_PROVENANCE §6.6), for the map's
 * dungeon entrances (docs/research/map-presentation.md §8.2; step MP.5). Every entrance is kept,
 * with its `frameVerified` flag: an entrance QuestieDB's coordinate audit leaves unverified is
 * drawn with its "position not verified" badge, and none is moved or guessed (M2 review COORD-4).
 * Imported only by the lazy derived pipeline, so the entry chunk carries none of it.
 */

export interface DatasetEntrance {
  /** Where the entrance is; null when its area has no map or its point does not resolve. */
  readonly world: WorldPoint | null;
  /** The UiMap its percentages are published on; null when it has none. */
  readonly uiMapId: UiMapId | null;
  readonly frameVerified: boolean;
}

export interface DatasetDungeon {
  /** The dungeon's AreaTable id, the table's key. */
  readonly areaId: AreaId;
  readonly name: string;
  readonly alternativeAreaIds: readonly AreaId[];
  /** In dataset order. */
  readonly entrances: readonly DatasetEntrance[];
}

/** The dungeon table's entries, ascending by area id, with their entrances resolved through `geometry`. */
export function datasetDungeons(zones: ZonesTable, dungeons: DungeonTable, geometry: MapGeometry): readonly DatasetDungeon[] {
  const out: DatasetDungeon[] = [];
  for (const key of Object.keys(dungeons).sort((a, b) => Number(a) - Number(b))) {
    const row = dungeons[key];
    if (row === undefined || !Number.isSafeInteger(Number(key))) continue;
    const entrances = row.entrances.map((entrance): DatasetEntrance => {
      const point = publishedPoint(String(entrance.areaId), [entrance.x, entrance.y], zones);
      if (!isSourcedPoint(point) || point.space !== 'zone') return { world: null, uiMapId: null, frameVerified: entrance.frameVerified };
      return { world: resolvePoint(point, geometry), uiMapId: point.uiMapId, frameVerified: entrance.frameVerified };
    });
    out.push({ areaId: areaId(Number(key)), name: row.name, alternativeAreaIds: row.alternativeAreaIds.map((id) => areaId(id)), entrances });
  }
  return out;
}
