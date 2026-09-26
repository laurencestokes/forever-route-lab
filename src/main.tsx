import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createEditorStore, type EditorStore, randomIdSource, systemClock } from './app';
import { createDerivedStore, type DerivedResults, type DerivedStore, type DerivedStoreHandle } from './app/derived';
import { createMapResources, type MapEngineSetup } from './app/map-exports';
import { NAVIGATION_CHECKING, type NavigationState, startNavigation } from './app/navigation-runtime';
import { browserLifecycle, createProjectSession, openBrowserProjectStorage, type ProjectSession } from './app/persistence';
import { DerivedStoreProvider } from './app/react';
import { createRoutePathFeed } from './app/route-paths';
import { SAMPLE_ROUTE_NOTICE } from './app/sample-route';
import type { MapAdapterFactory } from './map/adapter';
import { browserSha256, loadWorkspace, type Workspace, type WorkspaceProgress } from './app/workspace';
import { App } from './ui/App';
import { ProjectSessionProvider, useProjectSessionState } from './ui/app/ProjectMenuContext';
import { Boot } from './ui/Boot';
import { applyThemePreference, isThemePreference, type ThemePreference } from './ui/kit';
import './ui/styles/tokens.css';
import './ui/styles/base.css';

/**
 * Composition root. The page shows a loading screen while the Forever dataset (public/data/) and
 * the map geometry load and verify, and project storage (IndexedDB) opens beside them; then it
 * opens the project the last visit had open, or the sample on a first visit (ARCHITECTURE §12.3).
 * A failed load shows what failed, with a retry.
 *
 * Once the project is open, the derived-result pipeline (engine, simulation, validation;
 * ARCHITECTURE §12.1) starts in its own chunk and publishes through the derived store, which the
 * app reads from `DerivedStoreProvider`. Navigation (the manifest, then the worker) starts beside
 * the data load; until it is known the walks use the straight-line model and say so.
 */

/** Also read by the inline script in index.html, which applies the theme before first paint. */
const THEME_STORAGE_KEY = 'forever-route-lab:theme';

function readStoredTheme(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

function storeTheme(theme: ThemePreference): void {
  try {
    if (theme === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage is blocked (private browsing, site data disabled): the choice lasts for this visit.
  }
}

/** package.json's version, injected by vite.config.ts. */
function appVersion(): string {
  const raw: unknown = import.meta.env.VITE_APP_VERSION;
  return typeof raw === 'string' && raw !== '' ? raw : 'unknown';
}

const initialTheme = readStoredTheme();
applyThemePreference(document.documentElement, initialTheme);

interface Started {
  readonly workspace: Workspace;
  readonly store: EditorStore;
  readonly map: MapEngineSetup;
  /** The open project's link to storage (autosave, the project menu). */
  readonly session: ProjectSession | null;
  /** Derived results (the engine walk per revision), provided to the app through `DerivedStoreProvider`. */
  readonly derived: DerivedStore;
}

/**
 * Project storage opens once per page, however many times the start is retried. A connection lost
 * later (another tab upgraded the database) stops saving, with the reason.
 */
let storageLost: (reason: string) => void = () => undefined;
let projectStorage: ReturnType<typeof openBrowserProjectStorage> | null = null;
const openStorage = () => {
  projectStorage ??= openBrowserProjectStorage((reason) => {
    storageLost(reason);
  });
  return projectStorage;
};

/**
 * The map engine (Leaflet behind `MapAdapter`, ARCHITECTURE §7.2) is a dynamic import, in its own
 * chunk, so Leaflet and its stylesheet stay out of the entry chunk (§14). The import starts with
 * the data load, so the chunk arrives while the data does; a failed import is forgotten, so the
 * map panel's "Try again" imports it afresh.
 */
let mapEngine: Promise<MapAdapterFactory> | null = null;
const loadMapAdapter: MapEngineSetup['loadAdapter'] = () => {
  mapEngine ??= import('./map/leaflet').then(
    (module) => module.createLeafletMapAdapter,
    (error: unknown) => {
      mapEngine = null;
      throw error;
    },
  );
  return mapEngine;
};

/**
 * Terrain navigation starts once per page (terrain-navigation.md §9.6): the manifest is small and
 * loads beside the data; the worker starts when it is available. Never rejects: a deploy or browser
 * without navigation resolves to `unavailable`, and the walks keep the straight-line model.
 */
let navigation: Promise<NavigationState> | null = null;
const startNavigationOnce = (): Promise<NavigationState> => {
  navigation ??= startNavigation({ fetch: (url, init) => window.fetch(url, init), baseUrl: import.meta.env.BASE_URL, sha256: browserSha256() }).catch(
    (error: unknown): NavigationState => ({ kind: 'unavailable', reason: `navigation could not start (${error instanceof Error ? error.message : String(error)})` }),
  );
  return navigation;
};

/** The derived-result pipeline's chunk (the engine, simulation and validator), imported once the project is open. */
const loadPipeline = () => import('./app/derived-pipeline');

/** User Timing for the edit-to-results budget (ARCHITECTURE §14: ≤ 50 ms); older measures are cleared. */
let derivedMeasures = 0;
function measureDerived(results: DerivedResults): void {
  try {
    const end = performance.now();
    derivedMeasures += 1;
    if (derivedMeasures > 500) {
      performance.clearMeasures('frl:derived');
      derivedMeasures = 1;
    }
    performance.measure('frl:derived', { start: end - results.timing.sinceChangeMs, end, detail: { revision: results.revision, ...results.timing } });
  } catch {
    // A timeline that refuses a measure must not break the results.
  }
}

/**
 * Starts the pipeline for the open project: its chunk loads, it walks the project once, and it
 * follows the store; navigation replaces the straight-line model when it is available.
 */
function startDerived(store: EditorStore, workspace: Workspace, handle: DerivedStoreHandle, paths: ReturnType<typeof createRoutePathFeed>): void {
  loadPipeline().then(
    ({ createDerivedPipeline }) => {
      const pipeline = createDerivedPipeline({
        store,
        data: workspace.data,
        geometry: workspace.geometry.geometry,
        output: handle,
        navigation: NAVIGATION_CHECKING,
        now: () => performance.now(),
        onPublished: measureDerived,
        onNavigationModel: paths.setModel,
      });
      void startNavigationOnce().then((state) => {
        pipeline.setNavigation(state);
      });
    },
    (error: unknown) => {
      handle.publish({ status: 'failed', failure: `The route simulation could not be loaded: ${error instanceof Error ? error.message : String(error)}` });
    },
  );
}

/** One start: load and verify everything, then open the workspace's project in a store. */
async function start(onProgress: (progress: WorkspaceProgress) => void): Promise<Started> {
  // Fetch the map engine and the navigation manifest alongside the data; the map panel reports a
  // failure (and retries), and navigation failing only keeps the straight-line model.
  loadMapAdapter().catch(() => undefined);
  void startNavigationOnce();
  const ids = randomIdSource();
  const workspace = await loadWorkspace({
    fetch: (url, init) => window.fetch(url, init),
    baseUrl: import.meta.env.BASE_URL,
    sha256: browserSha256(),
    nowIso: systemClock.nowIso(),
    now: () => performance.now(),
    onProgress,
    storage: openStorage(),
    clock: systemClock,
    ids,
  });
  // For the startup budget (ARCHITECTURE §14): the mark's time is navigation start to ready, and
  // its detail the measured phases (docs/measurements/data-m2.json, `loader`).
  performance.mark('frl:workspace-ready', { detail: workspace.report });
  const store = createEditorStore({ project: workspace.project, ids, clock: systemClock, view: { theme: initialTheme } });
  const persistence = workspace.persistence;
  const session =
    persistence === null ? null : createProjectSession({ store, data: workspace.data, clock: systemClock, ids, lifecycle: browserLifecycle(), ...persistence });
  if (session !== null) {
    storageLost = session.storageLost;
    void session.refresh();
  }
  // The theme lives in the store's view state; apply and remember every change.
  let appliedTheme = initialTheme;
  store.subscribe(() => {
    const theme = store.getState().view.theme;
    if (theme === appliedTheme) return;
    appliedTheme = theme;
    applyThemePreference(document.documentElement, theme);
    storeTheme(theme);
  });
  const derived = createDerivedStore();
  const paths = createRoutePathFeed({ store, geometry: workspace.geometry.geometry, now: () => performance.now() });
  startDerived(store, workspace, derived, paths);
  const map: MapEngineSetup = {
    geometry: workspace.geometry.geometry,
    art: workspace.geometry.art,
    resources: createMapResources({ fetch: (url, init) => window.fetch(url, init), baseUrl: import.meta.env.BASE_URL, sha256: browserSha256() }),
    paths,
    loadAdapter: loadMapAdapter,
  };
  return { workspace, store, map, session, derived: derived.store };
}

/** The app, with the project name and the sample notice following the open project. */
function Root({ started }: { readonly started: Started }) {
  const { workspace, store, map, session, derived } = started;
  const state = useProjectSessionState(session);
  const projectName = state?.current.name ?? workspace.projectName;
  const routeNotice = state === null ? workspace.routeNotice : state.current.sample ? SAMPLE_ROUTE_NOTICE : null;
  return (
    <ProjectSessionProvider session={session}>
      <DerivedStoreProvider store={derived}>
        <App
        store={store}
        data={workspace.data}
        projectName={projectName}
        routeNotice={routeNotice}
        geometrySummary={workspace.geometrySummary}
        map={map}
        version={appVersion()}
        sourceCommit={null}
        />
      </DerivedStoreProvider>
    </ProjectSessionProvider>
  );
}

const container = document.getElementById('root');
if (container === null) throw new Error('index.html has no #root element');

createRoot(container).render(
  <StrictMode>
    <Boot load={start}>{(started) => <Root started={started} />}</Boot>
  </StrictMode>,
);
