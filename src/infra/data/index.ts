/**
 * `infra/data`: the dataset loader and the synchronous `DatasetView` (ARCHITECTURE §5.2, §12.1).
 * `app` wires these to the store; `ui` never imports them (ARCHITECTURE §4).
 */
export {
  applyQuestOverride,
  createDatasetView,
  createDatasetViewCache,
  prepareDataset,
  type DatasetViewInput,
  type PreparedDataset,
  type SpawnStats,
} from './dataset-view';
export { DatasetLoadError, loadDataset, MANIFEST_FILE, type DatasetLoadErrorCode, type DatasetLoaderOptions, type DatasetLoadProgress, type FileTiming, type LoadedDataset } from './loader';
export { computeDataRevision, CONVERSION_INPUT_PATH, dataRevisionInput, identityOf, parseManifest, type DataManifest, type ManifestOutput } from './manifest';
export { entranceOf, isSourcedPoint, publishedPoint, publishedPoints, type EntranceGap, type EntranceResult } from './points';
export { AREA_LINKS, DATA_JSON_FILES, DATA_NOTICE_FILE, DATA_OUTPUT_FILES, type AreaLink, type DatasetFiles } from './rows';
export { readDataFile } from './schema';
