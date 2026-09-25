import type { AreaId, UiMapId, WorldMapId } from '../domain/ids';

/**
 * Map geometry: the world rectangles behind every UiMap (docs/MAPS.md §5.3, §8.2;
 * docs/research/coordinates.md §3, §15). One shape serves the committed placeholder, a local set
 * and the two merged. Built from `geometry.placeholder.json` / `geometry.local.json` by
 * `parseGeometryFile`, or in tests by `createMapGeometry`.
 */

/**
 * Where a geometry row came from (D-018, D-026):
 * - `questiedb-conversion`: QuestieDB `data/Forever/conversion.json` `target_bounds` (build 1.60.1.69893);
 * - `db2-csv`: the committed cited rows file `tools/maps/inputs/db2-rows-1.60.1.70009.json`;
 * - `local-db2`: a developer's own extraction in `local-maps/` (never committed or deployed).
 */
export type GeometryRowSource = 'questiedb-conversion' | 'db2-csv' | 'local-db2';

export const GEOMETRY_ROW_SOURCES: readonly GeometryRowSource[] = ['questiedb-conversion', 'db2-csv', 'local-db2'];

/**
 * One `UiMapAssignment` row: a world rectangle placed onto a UI rectangle of its UiMap.
 *
 * World axes (coordinates.md §2-§3): `x` is north, `y` is west, in yards on world map `mapId`.
 * The DB2 columns map as `xMin = Region_0` (south edge), `xMax = Region_3` (north edge),
 * `yMin = Region_1` (east edge) and `yMax = Region_4` (west edge). QuestieDB's `bottom`, `top`,
 * `right` and `left` are the same four values.
 */
export interface GeometryAssignment {
  /** `UiMapAssignment.ID`. Provenance: never part of the frame hash or of merge row comparisons (the content hash does cover it). */
  readonly id: number;
  /** `UiMapAssignment.MapID`: the world coordinate space of the rectangle. */
  readonly mapId: WorldMapId;
  /** `UiMapAssignment.AreaID`. The DB2 value is kept: 0 for continent and world rows, which name no AreaTable zone. */
  readonly areaId: AreaId;
  /** `UiMapAssignment.OrderIndex`: 0 everywhere except Azeroth 947's second row. */
  readonly orderIndex: number;
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  /** `(UiMin_0, UiMin_1)`: top-left corner (u, v) of the row's UI sub-rectangle, 0..1. */
  readonly uiMin: readonly [number, number];
  /** `(UiMax_0, UiMax_1)`: bottom-right corner (u, v). Zone rows have `(0,0)-(1,1)`. */
  readonly uiMax: readonly [number, number];
  readonly source: GeometryRowSource;
  /** Game build the row was taken at, for example `1.60.1.69893` (every row records one, D-026). */
  readonly build: string;
}

export interface UiMapGeometry {
  readonly uiMapId: UiMapId;
  /** `conversion.json` `target_name` for QuestieDB frames, `UiMap.Name_lang` for DB2 rows. */
  readonly name: string;
  readonly nameSource: GeometryRowSource;
  /** `UiMap.Type` (1 world, 2 continent, 3 zone, 6 other); null where the source does not carry it (the 49 QuestieDB frames). */
  readonly type: number | null;
  /** `UiMap.ParentUiMapID` (0 = root, the DB2 value); null where the source does not carry it. */
  readonly parent: UiMapId | null;
  /** At least one row, in ascending `orderIndex`. */
  readonly assignments: readonly GeometryAssignment[];
}

/**
 * Era → Forever percent coefficients for one changed UiMap (coordinates.md §10.2):
 * `x' = scaleX·x + offsetX`, `y' = scaleY·y + offsetY`, in 0-100 percent units. They keep the
 * world position fixed while the frame changes.
 */
export interface EraToForeverCoefficients {
  readonly scaleX: number;
  readonly offsetX: number;
  readonly scaleY: number;
  readonly offsetY: number;
  /** Era frame build (`conversion.json` `geometry.source_build`). */
  readonly fromBuild: string;
  /** Forever frame build (`geometry.target_build`). */
  readonly toBuild: string;
  readonly source: 'questiedb-conversion';
}

/** `placeholder` and `local` come from files; `merged` is a placeholder plus the UiMaps a local set added. */
export type GeometryKind = 'placeholder' | 'local' | 'merged';

export interface MapGeometry {
  readonly kind: GeometryKind;
  /** Game product, `wow_classic_beta` for Forever. */
  readonly product: string;
  /**
   * The frame hash the file states (MAPS.md §5.6). Informational: consumers recompute it from
   * `canonicalFrameTuples` and never trust this value on its own. Null when the file has none.
   */
  readonly recordedFrameHash: string | null;
  /**
   * The content hash the file states (`contentHash`, docs/MAPS.md §5.3): the SHA-256 of
   * `canonicalGeometryContent`, which covers every row, name, parent and coefficient. Informational
   * like the frame hash: consumers recompute it and refuse the file on a mismatch. Required in the
   * placeholder; optional (usually null) in a local set; null for a merged geometry, whose content
   * is the placeholder's plus the added UiMaps.
   */
  readonly recordedContentHash: string | null;
  /** Every UiMap, iterated in ascending id order. */
  readonly maps: ReadonlyMap<UiMapId, UiMapGeometry>;
  /** Coefficients for the Era-changed UiMaps (exactly 1412, 1423, 1433, 1453 in the placeholder), ascending. */
  readonly eraToForever: ReadonlyMap<UiMapId, EraToForeverCoefficients>;
}

/** A 0-100 percent pair on some UiMap (values outside 0..100 are legal: outside the frame). */
export interface PercentPair {
  readonly x: number;
  readonly y: number;
}
