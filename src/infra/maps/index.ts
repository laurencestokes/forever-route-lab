/**
 * `infra/maps`: the committed placeholder geometry, the local-map probe and local art (ARCHITECTURE
 * §7.3), and the committed painted art and terrain byproducts (D-032, D-033).
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
export { contentTypeOfName, readImageHeader, type ImageContentType, type ImageHeader, type ImageHeaderResult } from './image-header';
export type { LocalArt, LocalArtBounds, LocalArtEntry, LocalArtLoad, LocalArtStatus } from './local-art';
export { ART_MANIFEST_PATH, ART_NOTICE_PATH, parseArtManifest, type ArtImage, type ArtManifest, type ArtRect, type UnplacedArt } from './art-manifest';
export {
  createMapResources,
  type ArtManifestLoad,
  type MapResourceFailure,
  type MapResources,
  type MapResourcesOptions,
  type TerrainArcsLoad,
  type TerrainManifestLoad,
} from './map-resources';
export {
  parseTerrainArcs,
  parseTerrainManifest,
  TERRAIN_MANIFEST_PATH,
  TERRAIN_NOTICE_PATH,
  type TerrainArcFile,
  type TerrainArcKind,
  type TerrainArcs,
  type TerrainManifest,
  type TerrainMap,
  type TerrainRect,
  type TerrainRelief,
} from './terrain';
