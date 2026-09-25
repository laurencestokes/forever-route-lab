import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createEditorStore, randomIdSource, systemClock } from './app';
import { createPlaceholderWorkspace, PLACEHOLDER_PROJECT_NAME } from './app/placeholder-project';
import { App } from './ui/App';
import { applyThemePreference, isThemePreference, type ThemePreference } from './ui/kit';
import './ui/styles/tokens.css';
import './ui/styles/base.css';

/**
 * Composition root. Milestone 1 opens the placeholder project over the placeholder dataset; storage
 * (Milestone 4) and the real dataset (Milestone 2) replace both.
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

const { project, dataset } = createPlaceholderWorkspace({ nowIso: systemClock.nowIso() });
const store = createEditorStore({ project, ids: randomIdSource(), clock: systemClock, view: { theme: initialTheme } });

// The theme lives in the store's view state; apply and remember every change.
let appliedTheme = initialTheme;
store.subscribe(() => {
  const theme = store.getState().view.theme;
  if (theme === appliedTheme) return;
  appliedTheme = theme;
  applyThemePreference(document.documentElement, theme);
  storeTheme(theme);
});

const container = document.getElementById('root');
if (container === null) throw new Error('index.html has no #root element');

createRoot(container).render(
  <StrictMode>
    <App store={store} dataset={dataset} projectName={PLACEHOLDER_PROJECT_NAME} version={appVersion()} sourceCommit={null} />
  </StrictMode>,
);
