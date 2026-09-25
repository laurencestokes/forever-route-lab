import type { AreaId, UiMapId, WorldMapId } from './ids';

/**
 * Canonical runtime point: yards in one world coordinate space. `x` points north and `y` points
 * west, as in the game client (docs/research/coordinates.md §2). Distances are only meaningful
 * between points with the same `mapId`.
 */
export interface WorldPoint {
  readonly mapId: WorldMapId;
  readonly x: number;
  readonly y: number;
}

/** Display point: percent (0-100, may fall outside) of one UiMap frame. */
export interface MapPoint {
  readonly uiMapId: UiMapId;
  readonly x: number;
  readonly y: number;
}

/**
 * Which frame a zone-percent point was authored in. Only four UiMaps differ between Era and
 * Forever (1412, 1423, 1433, 1453); `era` points on those maps are converted through world space.
 */
export type ZoneFrame = 'forever' | 'era';

/**
 * A point exactly as authored or published. Nothing derived from it (for example its world
 * position under some geometry) is ever persisted (D-017). `lexemes` keeps the original number
 * spelling from an RXP guide so exports reproduce it byte for byte.
 */
export type SourcedPoint =
  | {
      readonly space: 'world';
      readonly mapId: WorldMapId;
      readonly x: number;
      readonly y: number;
      /** The UiMap the author named alongside the world point (RXP `UiMapID/instance,y,x`), if any. */
      readonly uiMapId: UiMapId | null;
      readonly lexemes: readonly [string, string] | null;
    }
  | {
      readonly space: 'zone';
      readonly uiMapId: UiMapId;
      readonly x: number;
      readonly y: number;
      readonly frame: ZoneFrame;
      readonly lexemes: readonly [string, string] | null;
    };

/** QuestieDB's `{-1,-1}` sentinel: the entity is inside the instance with this area id. */
export interface InstancePresence {
  readonly kind: 'instance';
  readonly areaId: AreaId;
}

/**
 * A published zone-percent point whose AreaTable id has no UiMap (suppressed areas, legacy
 * dungeon compatibility pairs, instance areas). It cannot be placed until an entrance or frame
 * is known, so it stays unresolved with a reason instead of being guessed.
 */
export interface UnmappedAreaPoint {
  readonly kind: 'unmapped';
  readonly areaId: AreaId;
  readonly x: number;
  readonly y: number;
  readonly reason: 'suppressed' | 'no-uimap' | 'instance-area';
}

/** Where a route step happens. The authored point is the source of truth. */
export interface Location {
  readonly source: SourcedPoint;
  readonly label: string | null;
  /** Arrival radius in yards, when the author gave one (RXP `.goto ...,radius`). */
  readonly radius: number | null;
}

export function worldSourcedPoint(mapId: WorldMapId, x: number, y: number, uiMapId: UiMapId | null = null): SourcedPoint {
  return { space: 'world', mapId, x, y, uiMapId, lexemes: null };
}

export function zoneSourcedPoint(
  uiMapId: UiMapId,
  x: number,
  y: number,
  frame: ZoneFrame = 'forever',
): SourcedPoint {
  return { space: 'zone', uiMapId, x, y, frame, lexemes: null };
}
