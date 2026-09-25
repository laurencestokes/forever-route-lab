import { useCallback, useMemo, useRef, useState } from 'react';
import type { EditorStore } from '../app';
import { useEditor } from '../app/react';
import type { DatasetView } from '../domain/dataset';
import { type ActiveRow, buildRouteView } from './app-model';
import { AppSidePanel } from './app/AppSidePanel';
import { AppStatusBar, MapPanel } from './app/AppStatusBar';
import { AppTopBar } from './app/AppTopBar';
import { createAnnouncer, LiveRegion, useSelectionAnnouncements } from './app/LiveAnnouncer';
import { createRouteActions } from './app/route-actions';
import { RoutePanel } from './app/RoutePanel';
import { selectImports, selectRoute, selectStartLevel } from './app/selectors';
import { useGlobalShortcuts } from './app/useShortcuts';
import { AboutDialog, AppShell } from './kit';
import './App.css';

/**
 * The composition of the Milestone 1 shell: the UI kit (src/ui/kit.ts) wired to the editor store
 * (src/app). Everything derived (levels, durations, XP, validation) waits for simulation in
 * Milestone 6 and is shown as unknown with that reason, never as a made-up number.
 *
 * App reads only what the route rows are built from (the route, its imports, the start level) and
 * builds them once per change. Each panel (src/ui/app/) subscribes to its own slices and is
 * memoised, so a selection click re-renders the list, Details, the status bar and the map, and
 * neither the top bar nor the quest list.
 */

export interface AppProps {
  readonly store: EditorStore;
  readonly dataset: DatasetView;
  /** ProjectV1 has no name of its own; the caller supplies the label (for example from storage). */
  readonly projectName: string;
  readonly version: string;
  /** Exact source commit, injected by release builds; null otherwise. */
  readonly sourceCommit: string | null;
}

export function App({ store, dataset, projectName, version, sourceCommit }: AppProps) {
  const route = useEditor(store, selectRoute);
  const imports = useEditor(store, selectImports);
  const startLevel = useEditor(store, selectStartLevel);

  const [activeRow, setActiveRow] = useState<ActiveRow | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [leftWidth, setLeftWidth] = useState<number | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const routeRef = useRef<HTMLDivElement>(null);

  const [announcer] = useState(createAnnouncer);
  const actions = useMemo(() => createRouteActions(store, announcer.announce), [store, announcer]);
  useSelectionAnnouncements(store, announcer.announce);

  const importNames = useMemo(() => new Map(imports.map((i) => [i.id, i.name])), [imports]);
  const view = useMemo(() => buildRouteView(route, dataset, startLevel, importNames), [route, dataset, startLevel, importNames]);

  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
  }, []);
  const focusList = useCallback(() => {
    routeRef.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus();
  }, []);
  useGlobalShortcuts({ actions, focusSearch, enabled: !aboutOpen });

  const onSearchChange = useCallback(
    (value: string) => {
      setSearch(value);
      if (value.trim() !== '') store.setView({ rightTab: 'available' });
    },
    [store],
  );
  const onSearchSubmit = useCallback(() => {
    store.setView({ rightTab: 'available' });
  }, [store]);
  const openAbout = useCallback(() => {
    setAboutOpen(true);
  }, []);
  const closeAbout = useCallback(() => {
    setAboutOpen(false);
  }, []);

  const identity = dataset.identity;
  const placeholder = identity.dataRevision === 'placeholder';

  return (
    <>
      <AppShell
        top={
          <AppTopBar
            store={store}
            dataset={dataset}
            projectName={projectName}
            placeholder={placeholder}
            search={search}
            onSearchChange={onSearchChange}
            onSearchSubmit={onSearchSubmit}
            searchRef={searchRef}
            onAbout={openAbout}
          />
        }
        left={
          <RoutePanel
            store={store}
            view={view}
            routeName={route.name}
            placeholder={placeholder}
            activeRow={activeRow}
            onActiveRowChange={setActiveRow}
            actions={actions}
            containerRef={routeRef}
            onFocusList={focusList}
          />
        }
        centre={<MapPanel store={store} view={view} dataset={dataset} activeRow={activeRow} />}
        right={
          <AppSidePanel
            store={store}
            view={view}
            route={route}
            dataset={dataset}
            activeRow={activeRow}
            search={search}
            actions={actions}
            onFocusList={focusList}
          />
        }
        bottom={<AppStatusBar store={store} view={view} dataset={dataset} activeRow={activeRow} />}
        leftWidth={leftWidth}
        onLeftWidthChange={setLeftWidth}
      />
      <AboutDialog
        open={aboutOpen}
        onClose={closeAbout}
        version={version}
        sourceCommit={sourceCommit}
        dataUpstreamCommit={identity.upstreamCommit === 'none' ? null : identity.upstreamCommit}
      />
      <LiveRegion announcer={announcer} />
    </>
  );
}
