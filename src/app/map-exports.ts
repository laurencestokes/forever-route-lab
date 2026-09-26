/**
 * Map values and types the ui needs from modules it may not import (ARCHITECTURE §4): ui may import
 * `map/adapter` and `app`, but not `map/layers` (the pure builders) or `infra` (local art). They are
 * re-exported here rather than copied, as src/app/rules-exports.ts does for the rules.
 */
export { DEFAULT_LOD, layerStatsNotes, lodLevelAt, type LodLevel, type LodSettings } from '../map/layers';
export type { LocalArt, LocalArtEntry, LocalArtLoad, LocalArtStatus } from '../infra/maps';
export {
  AGGREGATE_ZOOM,
  BADGE_TEXT,
  type ActivePlacement,
  createMapController,
  FIT_ROUTE_MAX_ZOOM,
  type FitRouteResult,
  type FocusStepResult,
  MAX_SYNC_MEASURES,
  type MapChoice,
  type MapChoiceOption,
  type MapController,
  type MapControllerOptions,
  type MapEngineSetup,
  type MapLayerStatus,
  type MapStatus,
  type MapTiming,
  type ObjectUrls,
} from './map-controller';
export { zoneBounds, zoneGroups, type RouteMapSummary, type ZoneGroup, type ZoneOption } from './map-model';
