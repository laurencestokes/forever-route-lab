/**
 * `infra/maps`: the committed placeholder geometry, the local-map probe and local art (ARCHITECTURE
 * §7.3), and the committed painted art, atlas tile index and terrain byproducts (D-032, D-033, D-042).
 */
export {
  contentHashOf,
  describeGeometry,
  frameHashOf,
  GeometryLoadError,
  loadGeometry,
  LOCAL_MANIFEST_PATH,
  PLACEHOLDER_GEOMETRY_PATH,
  type GeometryLoadErrorCode,
  type GeometryLoaderOptions,
  type LoadedGeometry,
  type LocalMapSetStatus,
} from './geometry-loader';
export { contentTypeOfName, type ImageContentType } from './image-types';
export type { ImageHeader, ImageHeaderResult } from './image-header';
export type { LocalArt, LocalArtBounds, LocalArtEntry, LocalArtLoad, LocalArtStatus } from './local-art';
export { ART_MANIFEST_PATH, ART_NOTICE_PATH, parseArtManifest, type ArtImage, type ArtManifest, type ArtRect, type UnplacedArt } from './art-manifest';
export type { AtlasIndexFile } from './atlas-index';
export {
  createMapLayersSetting,
  createMapStyleSetting,
  EMPTY_MAP_LAYERS_RECORD,
  MAP_LAYERS_STORAGE_KEY,
  MAP_STYLE_STORAGE_KEY,
  type KeyValueStorage,
  type MapLayersRecord,
  type MapLayersSetting,
  type MapStyleSetting,
} from './map-style-setting';
export {
  ATLAS_INDEX_PATH,
  ATLAS_NOTICE_PATH,
  MINIMAP_INDEX_PATH,
  MINIMAP_NOTICE_PATH,
  createMapResources,
  type ArtManifestLoad,
  type AtlasIndexLoad,
  type MapResourceFailure,
  type MapResources,
  type MapResourcesOptions,
  type TerrainArcsLoad,
  type TerrainManifestLoad,
} from './map-resources';
export { TERRAIN_MANIFEST_PATH, TERRAIN_NOTICE_PATH } from './terrain-paths';
export type { TerrainArcFile, TerrainArcKind, TerrainArcs, TerrainManifest, TerrainMap, TerrainRect, TerrainRelief } from './terrain';
