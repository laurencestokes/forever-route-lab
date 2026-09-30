/**
 * Map values and types the ui needs from modules it may not import (ARCHITECTURE §4): ui may import
 * `map/adapter` and `app`, but not `map/layers` (the pure builders) or `infra` (local art, the
 * committed art and terrain loader). They are re-exported here rather than copied, as
 * src/app/rules-exports.ts does for the rules.
 */
export { DEFAULT_LOD, lodLevelAt, RELIEF_OPACITY, routeLegsOf, type LodLevel, type LodSettings } from '../map/layers';
/**
 * The one path set and state table for quest marks and pins (map-presentation.md §25.2.2, §25.2.3;
 * step MP.2b): the route rows' `QuestMark` and the Map layers drawer read the same objects the map's
 * pins draw (ui may not import map/marks itself). Each glyph is its own export, so the entry chunk
 * takes only the paths the rows use.
 */
export {
  BADGE_SLOT_OF,
  BADGE_SLOTS,
  COLOUR_MIN_SHAPE_PX,
  colourFits,
  DUNGEON_GLYPH,
  GLYPH_BOX_UNITS,
  isQuestGlyph,
  MARK_DIFFICULTIES,
  MARK_STATES,
  markColour,
  PIPS_LIT,
  QUEST_GLYPH,
  QUEST_MARK_STATES,
  resolveMarkLook,
  TURN_IN_GLYPH,
  type BadgeKind,
  type BadgeSlot,
  type GlyphPart,
  type GlyphPath,
  type MarkColour,
  type MarkDifficulty,
  type MarkEdge,
  type MarkFamily,
  type MarkFill,
  type MarkGlyph,
  type MarkLook,
  type MarkModifiers,
  type MarkState,
  type ResolvedMarkLook,
} from '../map/marks';
export {
  fillSpoken,
  FLIGHT_GLYPH,
  groupLook,
  INNKEEPER_GLYPH,
  MARK_GLYPHS,
  OBJECTIVE_GLYPH,
  PORTAL_GLYPH,
  RAID_GLYPH,
  TRAINER_GLYPH,
  TRANSPORT_GLYPH,
  VENDOR_GLYPH,
  type GroupMember,
} from '../map/marks-pins';
export type { LocalArt, LocalArtEntry, LocalArtLoad, LocalArtStatus, MapLayersRecord, MapLayersSetting, MapResources, MapResourcesOptions, MapStyleSetting } from '../infra/maps';
/**
 * For the composition root, which may not import infra (ARCHITECTURE §4): the committed art and
 * terrain loader, the notices' paths, and the map's settings kept in this browser (the style and the
 * Map layers drawer's record, map-presentation.md §25.3.7).
 */
export {
  ART_NOTICE_PATH,
  ATLAS_NOTICE_PATH,
  createMapLayersSetting,
  createMapResources,
  createMapStyleSetting,
  EMPTY_MAP_LAYERS_RECORD,
  MAP_LAYERS_STORAGE_KEY,
  MINIMAP_NOTICE_PATH,
  TERRAIN_NOTICE_PATH,
} from '../infra/maps';
/** The Map layers drawer's rows and groups (map-presentation.md §25.3.2; step MP.4b). */
export {
  categoryRow,
  DEFAULT_HIDDEN_CATEGORIES,
  groupState,
  hideAll,
  isMapCategoryGroupId,
  layerVisibility,
  MAP_CATEGORY_GROUP_IDS,
  MAP_CATEGORY_ROWS,
  normaliseHidden,
  PIN_CATEGORY_IDS,
  setCategory,
  setGroup,
  SHOW_ALL,
  type MapCategoryApply,
  type MapCategoryGroupId,
  type MapCategoryRow,
} from './map-categories';
export {
  AGGREGATE_ZOOM,
  atlasInstruction,
  CLUSTER_MAX_ZOOM,
  BADGE_TEXT,
  insetNote,
  type ActivePlacement,
  createMapController,
  FIT_ROUTE_MAX_ZOOM,
  type FitRouteResult,
  type FocusStepResult,
  MAX_SYNC_MEASURES,
  type MapBackdrop,
  type MapCategoryCounts,
  type MapController,
  type MapControllerOptions,
  type MapEngineSetup,
  type MapInsetStatus,
  type MapLayerStatus,
  type MapPickRequest,
  type MapPopoverTarget,
  type MapResultMatch,
  type MapPickStatus,
  type MapPreset,
  type MapStatus,
  type MapStyleStatus,
  type MapTiming,
  type ObjectUrls,
  type WalkingPathsStatus,
} from './map-controller';
export { zoneBounds, zoneGroups, type RouteMapSummary, type ZoneGroup, type ZoneOption } from './map-model';
