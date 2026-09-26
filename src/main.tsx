import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createEditorStore, type EditorStore, randomIdSource, systemClock } from './app';
import type { MapEngineSetup } from './app/map-exports';
import { browserLifecycle, createProjectSession, openBrowserProjectStorage, type ProjectSession } from './app/persistence';
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

/** One start: load and verify everything, then open the workspace's project in a store. */
async function start(onProgress: (progress: WorkspaceProgress) => void): Promise<Started> {
  // Fetch the map engine alongside the data; the map panel reports a failure (and retries).
  loadMapAdapter().catch(() => undefined);
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
  const map: MapEngineSetup = { geometry: workspace.geometry.geometry, art: workspace.geometry.art, loadAdapter: loadMapAdapter };
  return { workspace, store, map, session };
}

/** The app, with the project name and the sample notice following the open project. */
function Root({ started }: { readonly started: Started }) {
  const { workspace, store, map, session } = started;
  const state = useProjectSessionState(session);
  const projectName = state?.current.name ?? workspace.projectName;
  const routeNotice = state === null ? workspace.routeNotice : state.current.sample ? SAMPLE_ROUTE_NOTICE : null;
  return (
    <ProjectSessionProvider session={session}>
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
