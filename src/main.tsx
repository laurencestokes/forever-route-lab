import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createEditorStore, type EditorStore, randomIdSource, systemClock } from './app';
import { browserSha256, loadWorkspace, type Workspace, type WorkspaceProgress } from './app/workspace';
import { App } from './ui/App';
import { Boot } from './ui/Boot';
import { applyThemePreference, isThemePreference, type ThemePreference } from './ui/kit';
import './ui/styles/tokens.css';
import './ui/styles/base.css';

/**
 * Composition root. The page shows a loading screen while the Forever dataset (public/data/) and
 * the map geometry load and verify, then opens the sample project built from them (storage
 * arrives in Milestone 4). A failed load shows what failed, with a retry.
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
}

/** One start: load and verify everything, then open the workspace's project in a store. */
async function start(onProgress: (progress: WorkspaceProgress) => void): Promise<Started> {
  const workspace = await loadWorkspace({
    fetch: (url, init) => window.fetch(url, init),
    baseUrl: import.meta.env.BASE_URL,
    sha256: browserSha256(),
    nowIso: systemClock.nowIso(),
    now: () => performance.now(),
    onProgress,
  });
  // For the startup budget (ARCHITECTURE §14): the mark's time is navigation start to ready, and
  // its detail the measured phases (docs/measurements/data-m2.json, `loader`).
  performance.mark('frl:workspace-ready', { detail: workspace.report });
  const store = createEditorStore({ project: workspace.project, ids: randomIdSource(), clock: systemClock, view: { theme: initialTheme } });
  // The theme lives in the store's view state; apply and remember every change.
  let appliedTheme = initialTheme;
  store.subscribe(() => {
    const theme = store.getState().view.theme;
    if (theme === appliedTheme) return;
    appliedTheme = theme;
    applyThemePreference(document.documentElement, theme);
    storeTheme(theme);
  });
  return { workspace, store };
}

const container = document.getElementById('root');
if (container === null) throw new Error('index.html has no #root element');

createRoot(container).render(
  <StrictMode>
    <Boot load={start}>
      {({ workspace, store }) => (
        <App
          store={store}
          data={workspace.data}
          projectName={workspace.projectName}
          routeNotice={workspace.routeNotice}
          geometrySummary={workspace.geometrySummary}
          version={appVersion()}
          sourceCommit={null}
        />
      )}
    </Boot>
  </StrictMode>,
);
