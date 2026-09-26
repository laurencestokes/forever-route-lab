/**
 * Map values and types the ui needs from modules it may not import (ARCHITECTURE §4): ui may import
 * `map/adapter` and `app`, but not `map/layers` (the pure builders) or `infra` (local art, the
 * committed art and terrain loader). They are re-exported here rather than copied, as
 * src/app/rules-exports.ts does for the rules.
 */
export { DEFAULT_LOD, layerStatsNotes, lodLevelAt, RELIEF_OPACITY, routeLegsOf, type LodLevel, type LodSettings } from '../map/layers';
export type { LocalArt, LocalArtEntry, LocalArtLoad, LocalArtStatus, MapResources, MapResourcesOptions } from '../infra/maps';
/** For the composition root, which may not import infra (ARCHITECTURE §4): the committed art and terrain loader. */
export { ART_NOTICE_PATH, createMapResources, TERRAIN_NOTICE_PATH } from '../infra/maps';
export {
  AGGREGATE_ZOOM,
  BADGE_TEXT,
  type ActivePlacement,
  createMapController,
  FIT_ROUTE_MAX_ZOOM,
  type FitRouteResult,
  type FocusStepResult,
  MAX_SYNC_MEASURES,
  MAP_ART_OWNER_NOTE,
  type MapBackdrop,
  type MapChoice,
  type MapChoiceOption,
  type MapController,
  type MapControllerOptions,
  type MapEngineSetup,
  type MapLayerStatus,
  type MapPickRequest,
  type MapPickStatus,
  type MapStatus,
  type MapTiming,
  type ObjectUrls,
  type WalkingPathsStatus,
} from './map-controller';
export { zoneBounds, zoneGroups, type RouteMapSummary, type ZoneGroup, type ZoneOption } from './map-model';
