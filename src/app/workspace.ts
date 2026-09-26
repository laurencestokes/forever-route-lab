import type { IdSource, ProjectV1 } from '../domain';
import {
  createDatasetView,
  type DataManifest,
  DatasetLoadError,
  type DatasetLoadProgress,
  type FileTiming,
  loadDataset,
  type LoadedDataset,
  prepareDataset,
  type SpawnStats,
} from '../infra/data';
import { defaultSha256, type Sha256Digest } from '../infra/hash';
import type { FetchLike } from '../infra/http';
import { describeGeometry, GeometryLoadError, loadGeometry, type LoadedGeometry } from '../infra/maps';
import type { OpenedProjectStorage, ProjectLocks, StorageChangeChannel } from '../infra/persistence';
import { type Clock, fixedClock } from './clock';
import { type DatasetSource, datasetViewInputOf, preparedDatasetSource } from './dataset-source';
import { randomIdSource } from './ids';
import { restoreStartupProject, type StartupProject } from './persistence';
import { createProjectLibrary, type ProjectLibrary } from './project-library';
import { createSampleProject, SAMPLE_PROJECT_NAME, SAMPLE_ROUTE_NOTICE } from './sample-route';

/**
 * Startup (ARCHITECTURE §5.2, §7.3, §14): the dataset and the map geometry load in parallel under
 * one abort signal (a failure of either cancels the other's requests), the two are checked to come
 * from one QuestieDB pin, frame build and `conversion.json`, the dataset is prepared once against
 * the geometry (spawns become world points). Then the project opens: with project storage, the
 * one the last visit had open (ARCHITECTURE §12.3; `restoreStartupProject`, which also takes its
 * lock, or finds another tab has it open), and the sample only when storage holds no project at
 * all; without storage (tests), the sample.
 *
 * Budget (§14): dataset fetch to ready within 1 s, with no task over 100 ms; `report` carries the
 * measured phases (docs/measurements/data-m2.json, `loader`).
 */

export interface WorkspaceProgress {
  readonly stage: 'fetching' | 'building' | 'ready';
  readonly filesDone: number;
  readonly filesTotal: number;
  readonly bytesDone: number;
  readonly bytesTotal: number;
}

export interface WorkspaceLoadOptions {
  readonly fetch: FetchLike;
  /** `import.meta.env.BASE_URL`, read by the composition root. */
  readonly baseUrl: string;
  readonly sha256: Sha256Digest | null;
  /** Stamped on the sample project. */
  readonly nowIso: string;
  /** Monotonic ms (`performance.now`) for the report; without it every timing is 0. */
  readonly now?: (() => number) | undefined;
  /**
   * Lets the page render the "building" state before the synchronous preparation runs. Defaults
   * to a macrotask (`setTimeout(0)`).
   */
  readonly yieldToRender?: (() => Promise<void>) | undefined;
  readonly onProgress?: ((progress: WorkspaceProgress) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
  /** Accept the test fixture slice as the dataset (tests only; see `loadDataset`). */
  readonly allowSlice?: boolean | undefined;
  /**
   * Project storage, opening alongside the data (`openBrowserProjectStorage`). Omitted: no storage;
   * the sample opens and nothing is saved.
   */
  readonly storage?: Promise<OpenedProjectStorage> | undefined;
  /** Stamps saves and backups; defaults to a clock fixed at `nowIso`. */
  readonly clock?: Clock | undefined;
  /** Ids for new projects and backups; defaults to random ids. */
  readonly ids?: IdSource | undefined;
}

export interface WorkspaceReport {
  /** Dataset fetch, verification, parse and check (the loader's total). */
  readonly datasetMs: number;
  readonly manifestMs: number;
  readonly files: Readonly<Record<string, FileTiming>>;
  /** Start to the geometry the workspace uses (the reload retry included). */
  readonly geometryMs: number;
  /** Whether the geometry was fetched a second time, past the HTTP cache, to pair it with the data. */
  readonly geometryReloaded: boolean;
  /** `prepareDataset`: one synchronous task. */
  readonly prepareMs: number;
  /** The first `DatasetView` (the sample character's). */
  readonly viewMs: number;
  readonly sampleMs: number;
  /** Reading and opening the stored project (0 without storage). */
  readonly restoreMs: number;
  /** Start to ready. */
  readonly totalMs: number;
  readonly spawnStats: SpawnStats;
}

export interface Workspace {
  readonly project: ProjectV1;
  /** ProjectV1 has no name of its own; the top bar shows this. */
  readonly projectName: string;
  /** A line the route panel shows above the route (the sample route's label), or null. */
  readonly routeNotice: string | null;
  readonly data: DatasetSource;
  readonly geometry: LoadedGeometry;
  /** Which geometry is in use, for the map panel (MAPS.md §5.6 step 6). */
  readonly geometrySummary: string;
  /** The verified `data/NOTICE.md`. */
  readonly dataNotice: string;
  readonly report: WorkspaceReport;
  /** Project storage and what the start opened from it; null without storage. */
  readonly persistence: WorkspacePersistence | null;
}

/** What `createProjectSession` needs from the start. */
export interface WorkspacePersistence {
  readonly library: ProjectLibrary;
  readonly startup: StartupProject;
  /** Why browser storage is unavailable (projects then live in memory); null when it is used. */
  readonly unavailable: string | null;
  /** Builds the sample project again (after the last stored project is deleted). */
  readonly createSample: () => ProjectV1;
  readonly sampleName: string;
  /** The project locks shared with other tabs; null without (memory storage, or no Web Locks). */
  readonly locks: ProjectLocks | null;
  /** Storage changes other tabs make; null without (memory storage, or no BroadcastChannel). */
  readonly channel: StorageChangeChannel | null;
}

/** The load errors, for callers that cannot import infra (ui, ARCHITECTURE §4). */
export { DatasetLoadError, GeometryLoadError };

/** The data and the geometry must come from the same QuestieDB pin, frame build and conversion file (D-013). */
export class FrameMismatchError extends Error {
  override readonly name = 'FrameMismatchError';
}

/** The browser's WebCrypto digest, or null outside a secure context (the load then fails clearly). */
export const browserSha256 = defaultSha256;

const defaultYield = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const short = (value: string | null): string => (value === null ? 'none recorded' : value.slice(0, 12));

/**
 * How the data and the geometry fail to pair, or null when they share one QuestieDB commit, one
 * data frame build and one `conversion.json` (by SHA-256, so a geometry built from another
 * conversion file at a mislabelled commit is refused too; M2 review COORD-10).
 */
export function pairingProblems(manifest: Pick<DataManifest, 'upstreamCommit' | 'frameBuild' | 'conversionSha256'>, frame: LoadedGeometry['frameSource']): readonly string[] {
  const problems: string[] = [];
  if (frame.commit !== manifest.upstreamCommit) problems.push(`QuestieDB commit: geometry ${short(frame.commit)}, data ${short(manifest.upstreamCommit)}`);
  if (frame.build !== manifest.frameBuild) problems.push(`frame build: geometry ${frame.build ?? 'none recorded'}, data ${manifest.frameBuild}`);
  if (frame.sha256 !== manifest.conversionSha256) problems.push(`conversion.json SHA-256: geometry ${short(frame.sha256)}, data ${short(manifest.conversionSha256)}`);
  return problems;
}

export async function loadWorkspace(opts: WorkspaceLoadOptions): Promise<Workspace> {
  opts.signal?.throwIfAborted();
  const now = opts.now ?? (() => 0);
  const start = now();
  const report = opts.onProgress ?? (() => undefined);
  let last: DatasetLoadProgress = { phase: 'manifest', filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 };
  const forward = (p: DatasetLoadProgress) => {
    last = p;
    report({ stage: 'fetching', filesDone: p.filesDone, filesTotal: p.filesTotal, bytesDone: p.bytesDone, bytesTotal: p.bytesTotal });
  };

  // One signal for both loads: the caller's abort reaches both, and the first failure of either
  // cancels the other's requests (a failed geometry must not leave 9 MB of data downloading).
  const controller = new AbortController();
  const outer = opts.signal;
  const forwardAbort = () => {
    controller.abort(outer?.reason);
  };
  outer?.addEventListener('abort', forwardAbort, { once: true });
  const cancelOnFailure = (error: unknown): never => {
    controller.abort(error);
    throw error;
  };
  const common = { fetch: opts.fetch, baseUrl: opts.baseUrl, sha256: opts.sha256, signal: controller.signal };
  // A failed data load must not leave the storage promise's rejection unhandled.
  opts.storage?.catch(() => undefined);

  let geometryMs = 0;
  let geometryReloaded = false;
  let loaded: LoadedDataset;
  let geometry: LoadedGeometry;
  try {
    [loaded, geometry] = await Promise.all([
      loadDataset({ ...common, now, onProgress: forward, allowSlice: opts.allowSlice }).catch(cancelOnFailure),
      loadGeometry(common)
        .then((g) => {
          geometryMs = now() - start;
          return g;
        })
        .catch(cancelOnFailure),
    ]);
    if (pairingProblems(loaded.manifest, geometry.frameSource).length > 0) {
      // The geometry changes at every pin bump, and the data manifest is always revalidated: a
      // mismatch is most likely a copy of the geometry cached from an earlier deploy (a CDN that
      // ignores revalidation). Fetch it once more past the HTTP cache before refusing.
      geometry = await loadGeometry({ ...common, cache: 'reload' });
      geometryMs = now() - start;
      geometryReloaded = true;
    }
  } finally {
    outer?.removeEventListener('abort', forwardAbort);
  }

  const identity = loaded.identity;
  const problems = pairingProblems(loaded.manifest, geometry.frameSource);
  if (problems.length > 0) {
    throw new FrameMismatchError(
      `The map geometry and the data come from different sources (${problems.join('; ')}), also after fetching the geometry again past the cache. ` +
        'Spawn percentages would be read in the wrong frames, so nothing is shown. Both files must be regenerated from one pin (pnpm data:extract, pnpm maps:placeholder) and deployed together.',
    );
  }

  report({ stage: 'building', filesDone: last.filesDone, filesTotal: last.filesTotal, bytesDone: last.bytesDone, bytesTotal: last.bytesTotal });
  await (opts.yieldToRender ?? defaultYield)();

  const prepareStart = now();
  const prepared = prepareDataset(loaded.files, identity, geometry.geometry);
  const prepareMs = now() - prepareStart;
  const data = preparedDatasetSource(prepared);

  // The sample character is fixed (Horde Orc Warrior); the sample is built from its view, and the
  // project's own view (memoised, the one the app shows first) is made once the project exists.
  const clock = opts.clock ?? fixedClock(opts.nowIso);
  let sampleMs = 0;
  const createSample = (): ProjectV1 => {
    const sampleStart = now();
    const sample = createSampleProject({
      dataset: createDatasetView(prepared, { faction: 'Horde', class: 'WARRIOR', customQuests: [], questOverrides: {} }),
      nowIso: clock.nowIso(),
    });
    sampleMs = now() - sampleStart;
    return sample;
  };

  const restoreStart = now();
  let project: ProjectV1;
  let projectName = SAMPLE_PROJECT_NAME;
  let sample = true;
  let persistence: WorkspacePersistence | null = null;
  if (opts.storage === undefined) {
    project = createSample();
  } else {
    const opened = await opts.storage;
    const ids = opts.ids ?? randomIdSource();
    const library = createProjectLibrary({ storage: opened.storage, clock, ids });
    const locks = opened.locks ?? null;
    const startup = await restoreStartupProject({ library, data, clock, ids, createSample, sampleName: SAMPLE_PROJECT_NAME, locks });
    project = startup.project;
    projectName = startup.handle.name;
    sample = startup.handle.sample;
    persistence = { library, startup, unavailable: opened.unavailable, createSample, sampleName: SAMPLE_PROJECT_NAME, locks, channel: opened.channel ?? null };
  }
  const restoreMs = now() - restoreStart - sampleMs;
  const viewStart = now();
  data.view(datasetViewInputOf(project));
  const viewMs = now() - viewStart;

  report({ stage: 'ready', filesDone: last.filesDone, filesTotal: last.filesTotal, bytesDone: last.bytesDone, bytesTotal: last.bytesTotal });
  return {
    project,
    projectName,
    routeNotice: sample ? SAMPLE_ROUTE_NOTICE : null,
    data,
    geometry,
    geometrySummary: describeGeometry(geometry),
    dataNotice: loaded.notice,
    report: {
      datasetMs: loaded.timings.totalMs,
      manifestMs: loaded.timings.manifestMs,
      files: loaded.timings.files,
      geometryMs,
      geometryReloaded,
      prepareMs,
      viewMs,
      sampleMs,
      restoreMs,
      totalMs: now() - start,
      spawnStats: prepared.spawnStats,
    },
    persistence,
  };
}

// Errors for the UI --------------------------------------------------------------------------

/**
 * What can fix a failed start (M2 review code-F3):
 * - `reload`: trying again can help (a network or server problem, a copy cached from an earlier deploy);
 * - `redeploy`: the deployed files are wrong (another format, inconsistent, test data), so only
 *   regenerating and redeploying them helps;
 * - `open-over-https`: this page cannot verify anything (no WebCrypto outside a secure context),
 *   so the site must be opened over https (or on localhost).
 */
export type LoadRemedy = 'reload' | 'redeploy' | 'open-over-https';

export interface LoadFailure {
  readonly title: string;
  readonly message: string;
  /** Path-level problems or the underlying error, for the details disclosure. */
  readonly details: readonly string[];
  readonly remedy: LoadRemedy;
}

const DATA_TITLES: Readonly<Record<DatasetLoadError['code'], string>> = {
  unsupported: 'This browser cannot verify the data',
  network: 'The data files could not be loaded',
  http: 'The data files could not be loaded',
  integrity: 'The data files failed their integrity check',
  format: 'The data files are not in the expected format',
  slice: 'The deployed data is a test fixture, not the dataset',
};

const DATA_REMEDIES: Readonly<Record<DatasetLoadError['code'], LoadRemedy>> = {
  unsupported: 'open-over-https',
  network: 'reload',
  http: 'reload',
  // Each file is fetched a second time past the cache before this is reported; a reload can
  // still help if the deploy was caught half-way.
  integrity: 'reload',
  format: 'redeploy',
  slice: 'redeploy',
};

const GEOMETRY_TITLES: Readonly<Record<GeometryLoadError['code'], string>> = {
  unsupported: 'This browser cannot verify the map geometry',
  network: 'The map geometry could not be loaded',
  http: 'The map geometry could not be loaded',
  format: 'The map geometry is not in the expected format',
  integrity: 'The map geometry failed its integrity check',
};

const GEOMETRY_REMEDIES: Readonly<Record<GeometryLoadError['code'], LoadRemedy>> = {
  unsupported: 'open-over-https',
  network: 'reload',
  http: 'reload',
  // The file disagrees with its own recorded hashes or shape: fetching it again cannot help.
  format: 'redeploy',
  integrity: 'redeploy',
};

/** What the error screen says about a failed start. Unknown errors are shown as they are. */
export function describeLoadFailure(error: unknown): LoadFailure {
  if (error instanceof DatasetLoadError) {
    return { title: DATA_TITLES[error.code], message: error.message, details: error.details, remedy: DATA_REMEDIES[error.code] };
  }
  if (error instanceof GeometryLoadError) {
    return { title: GEOMETRY_TITLES[error.code], message: error.message, details: error.details, remedy: GEOMETRY_REMEDIES[error.code] };
  }
  if (error instanceof FrameMismatchError) {
    // The geometry was already fetched again past the cache before this was reported.
    return { title: 'The data and the map geometry do not match', message: error.message, details: [], remedy: 'redeploy' };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { title: 'Forever Route Lab could not start', message, details: error instanceof Error && error.stack !== undefined ? [error.stack] : [], remedy: 'reload' };
}
