/** `infra/maps`: the committed placeholder geometry, the local-map probe and local art (ARCHITECTURE §7.3). */
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
