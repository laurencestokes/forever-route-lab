import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorStore } from '../app';
import type { DatasetSource } from '../app/dataset-source';
import { cachedDatasetSource, datasetBaseView } from '../app/dataset-views';
import type { StepId } from '../domain/ids';
import { createMapController, type MapEngineSetup } from '../app/map-exports';
import { useEditor } from '../app/react';
import { type ActiveRow, buildRouteView, mapStepLabel } from './app-model';
import { AppSidePanel } from './app/AppSidePanel';
import { AppStatusBar } from './app/AppStatusBar';
import { AppTopBar } from './app/AppTopBar';
import { LazyDialogFallback, loadSettingsDialog, preloadLazyParts, useLazy } from './app/lazy';
import { AnnouncerContext, createAnnouncer, LiveRegion, useSelectionAnnouncements } from './app/LiveAnnouncer';
import { MapPanel } from './app/MapPanel';
import { createRouteActions } from './app/route-actions';
import { RoutePanel } from './app/RoutePanel';
import { selectCharacterClass, selectCustomQuests, selectFaction, selectImports, selectQuestOverrides, selectRoute, selectStartLevel } from './app/selectors';
import { useGlobalShortcuts } from './app/useShortcuts';
import { AboutDialog, AppShell } from './kit';
import './App.css';

/**
 * The composition of the shell: the UI kit (src/ui/kit.ts) wired to the editor store (src/app),
 * the derived-results store (the engine walk per revision: estimates, metrics, issues; read with
 * `useDerivedSelector` from the `DerivedStoreProvider` the composition root puts around the app)
 * and the loaded dataset. What the walk has not worked out is shown as unknown with the reason,
 * never as a made-up number; without a derived store (component tests) every estimate says it is
 * not simulated.
 *
 * The dataset view follows the project: its faction and class pick the overlay records, and its
 * custom quests and overrides lie on top (ARCHITECTURE §5.5). The source memoises the view, so it
 * changes only when one of those does.
 *
 * The source is wrapped in a small cache of views (`cachedDatasetSource`), so the project's view
 * and the view without its custom quests (what a custom quest with a real id replaces, DATA001) are
 * both kept.
 *
 * App reads only what the route rows are built from (the route, its imports, the start level) and
 * builds them once per change. Each panel (src/ui/app/) subscribes to its own slices and is
 * memoised, so a selection click re-renders the list, Details, the status bar and the map, and
 * neither the top bar nor the quest list.
 *
 * The Settings dialog, the custom quest editor and the RXP dialogs load on first use
 * (`src/ui/app/lazy.tsx`, M4 review CR-19); production builds fetch them once the page is idle.
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
  /**
   * The map: the geometry it draws, the local set's art, and the loader of the map engine (a
   * dynamic import in the composition root, so Leaflet stays out of the entry chunk). Null or
   * omitted: the centre panel says there is no map.
   */
  readonly map?: MapEngineSetup | null | undefined;
  readonly version: string;
  /** Exact source commit, injected by release builds; null otherwise. */
  readonly sourceCommit: string | null;
}

export function App({ store, data, projectName, routeNotice = null, geometrySummary = null, map = null, version, sourceCommit }: AppProps) {
  const source = useMemo(() => cachedDatasetSource(data), [data]);
  const route = useEditor(store, selectRoute);
  const imports = useEditor(store, selectImports);
  const startLevel = useEditor(store, selectStartLevel);
  const faction = useEditor(store, selectFaction);
  const characterClass = useEditor(store, selectCharacterClass);
  const customQuests = useEditor(store, selectCustomQuests);
  const questOverrides = useEditor(store, selectQuestOverrides);
  const dataset = useMemo(
    () => source.view({ faction, class: characterClass, customQuests, questOverrides }),
    [source, faction, characterClass, customQuests, questOverrides],
  );
  const baseDataset = useMemo(() => datasetBaseView(source, { faction, class: characterClass, questOverrides }), [source, faction, characterClass, questOverrides]);

  const [activeRow, setActiveRow] = useState<ActiveRow | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [leftWidth, setLeftWidth] = useState<number | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const routeRef = useRef<HTMLDivElement>(null);

  const [announcer] = useState(createAnnouncer);
  const settings = useLazy(loadSettingsDialog, settingsOpen);
  useEffect(() => preloadLazyParts(), []);
  // One controller for the app's lifetime: the top bar's jump-to-zone and the map panel share it.
  const [mapController] = useState(() =>
    map === null
      ? null
      : createMapController({
          store,
          data: source,
          geometry: map.geometry,
          art: map.art,
          resources: map.resources ?? null,
          paths: map.paths ?? null,
          describeStep: mapStepLabel,
        }),
  );
  const mapWiring = useMemo(() => (map === null || mapController === null ? null : { setup: map, controller: mapController }), [map, mapController]);
  // World map names for the status bar's travel sentences ("Kalimdor", not "world map 1"): the
  // map panel's surfaces, one per world map.
  const mapName = useMemo(() => {
    const names = new Map((mapController?.surfaces ?? []).map((surface) => [surface.mapId as number, surface.name]));
    return (mapId: number): string | null => names.get(mapId) ?? null;
  }, [mapController]);
  const geometry = map?.geometry ?? null;
  const actions = useMemo(() => createRouteActions(store, announcer.announce, { geometry }), [store, announcer, geometry]);
  useSelectionAnnouncements(store, announcer);

  const importNames = useMemo(() => new Map(imports.map((i) => [i.id, i.name])), [imports]);
  const view = useMemo(() => buildRouteView(route, dataset, startLevel, importNames), [route, dataset, startLevel, importNames]);

  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
  }, []);
  const focusList = useCallback(() => {
    routeRef.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus();
  }, []);
  useGlobalShortcuts({ actions, focusSearch, enabled: !aboutOpen && !settingsOpen });

  // Hovering a route row highlights its step markers on the map.
  const onHoverSteps = useCallback(
    (ids: readonly StepId[] | null) => {
      mapController?.hoverSteps(ids);
    },
    [mapController],
  );

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
  const openSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const identity = dataset.identity;
  const placeholder = identity.dataRevision === 'placeholder';
  const sample = routeNotice !== null;

  return (
    <AnnouncerContext.Provider value={announcer}>
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
            mapController={mapController}
            announce={announcer.announce}
            onOpenSettings={openSettings}
            geometry={geometry}
            data={source}
          />
        }
        left={
          <RoutePanel
            store={store}
            view={view}
            dataset={dataset}
            routeName={route.name}
            placeholder={placeholder}
            notice={routeNotice}
            activeRow={activeRow}
            onActiveRowChange={setActiveRow}
            actions={actions}
            containerRef={routeRef}
            onFocusList={focusList}
            onHoverSteps={onHoverSteps}
          />
        }
        centre={<MapPanel store={store} view={view} activeRow={activeRow} map={mapWiring} geometry={geometrySummary} announce={announcer.announce} />}
        right={
          <AppSidePanel
            store={store}
            view={view}
            route={route}
            dataset={dataset}
            baseDataset={baseDataset}
            activeRow={activeRow}
            search={search}
            actions={actions}
            mapController={mapController}
            announce={announcer.announce}
            onFocusList={focusList}
          />
        }
        bottom={<AppStatusBar store={store} view={view} dataset={dataset} activeRow={activeRow} announce={announcer.announce} mapName={mapName} />}
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
      {settings.kind === 'ready' ? (
        <settings.value.SettingsDialog open={settingsOpen} onClose={closeSettings} store={store} announce={announcer.announce} />
      ) : (
        <LazyDialogFallback title="Settings" state={settings} onClose={closeSettings} />
      )}
      <LiveRegion announcer={announcer} />
    </AnnouncerContext.Provider>
  );
}
