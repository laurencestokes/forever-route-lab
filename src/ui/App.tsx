import { useCallback, useMemo, useRef, useState } from 'react';
import type { EditorStore } from '../app';
import type { DatasetSource } from '../app/dataset-source';
import { useEditor } from '../app/react';
import { type ActiveRow, buildRouteView } from './app-model';
import { AppSidePanel } from './app/AppSidePanel';
import { AppStatusBar, MapPanel } from './app/AppStatusBar';
import { AppTopBar } from './app/AppTopBar';
import { createAnnouncer, LiveRegion, useSelectionAnnouncements } from './app/LiveAnnouncer';
import { createRouteActions } from './app/route-actions';
import { RoutePanel } from './app/RoutePanel';
import { selectCharacterClass, selectCustomQuests, selectFaction, selectImports, selectQuestOverrides, selectRoute, selectStartLevel } from './app/selectors';
import { useGlobalShortcuts } from './app/useShortcuts';
import { AboutDialog, AppShell } from './kit';
import './App.css';

/**
 * The composition of the shell: the UI kit (src/ui/kit.ts) wired to the editor store (src/app)
 * and the loaded dataset. Everything derived (levels, durations, XP, validation) waits for
 * simulation in Milestone 6 and is shown as unknown with that reason, never as a made-up number.
 *
 * The dataset view follows the project: its faction and class pick the overlay records, and its
 * custom quests and overrides lie on top (ARCHITECTURE §5.5). The source memoises the view, so it
 * changes only when one of those does.
 *
 * App reads only what the route rows are built from (the route, its imports, the start level) and
 * builds them once per change. Each panel (src/ui/app/) subscribes to its own slices and is
 * memoised, so a selection click re-renders the list, Details, the status bar and the map, and
 * neither the top bar nor the quest list.
 */

export interface AppProps {
  readonly store: EditorStore;
  /** The loaded dataset; the view for the project's character is taken from it. */
  readonly data: DatasetSource;
  /** ProjectV1 has no name of its own; the caller supplies the label (for example from storage). */
  readonly projectName: string;
  /**
   * A line about the open route, shown above it and marking the project as a sample (for example
   * "Sample route (auto-generated, not a recommended route)"); null for a route of the user's own.
   */
  readonly routeNotice?: string | null | undefined;
  /** Which map geometry is loaded, for the map panel; null when not known. */
  readonly geometrySummary?: string | null | undefined;
  readonly version: string;
  /** Exact source commit, injected by release builds; null otherwise. */
  readonly sourceCommit: string | null;
}

export function App({ store, data, projectName, routeNotice = null, geometrySummary = null, version, sourceCommit }: AppProps) {
  const route = useEditor(store, selectRoute);
  const imports = useEditor(store, selectImports);
  const startLevel = useEditor(store, selectStartLevel);
  const faction = useEditor(store, selectFaction);
  const characterClass = useEditor(store, selectCharacterClass);
  const customQuests = useEditor(store, selectCustomQuests);
  const questOverrides = useEditor(store, selectQuestOverrides);
  const dataset = useMemo(
    () => data.view({ faction, class: characterClass, customQuests, questOverrides }),
    [data, faction, characterClass, customQuests, questOverrides],
  );

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
  const sample = routeNotice !== null;

  return (
    <>
      <AppShell
        top={
          <AppTopBar
            store={store}
            dataset={dataset}
            projectName={projectName}
            placeholder={placeholder || sample}
            placeholderLabel={placeholder ? undefined : 'Sample'}
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
            notice={routeNotice}
            activeRow={activeRow}
            onActiveRowChange={setActiveRow}
            actions={actions}
            containerRef={routeRef}
            onFocusList={focusList}
          />
        }
        centre={<MapPanel store={store} view={view} dataset={dataset} activeRow={activeRow} geometry={geometrySummary} />}
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
        dataUpstreamCommit={placeholder || identity.upstreamCommit === 'none' ? null : identity.upstreamCommit}
        dataIdentity={placeholder ? null : { dataRevision: identity.dataRevision, frameBuild: identity.frameBuild }}
      />
      <LiveRegion announcer={announcer} />
    </>
  );
}
