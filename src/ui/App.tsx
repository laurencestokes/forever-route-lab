import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EditorStore } from '../app';
import type { DatasetSource } from '../app/dataset-source';
import { cachedDatasetSource, datasetBaseView } from '../app/dataset-views';
import type { StepId, WorldMapId } from '../domain/ids';
import { createMapController, type MapEngineSetup } from '../app/map-exports';
import { followSelection } from '../app/selection-memory';
import { useDerivedStore, useEditor } from '../app/react';
import { type ActiveRow, buildRouteView, mapStepLabel } from './app-model';
import { AppSidePanel } from './app/AppSidePanel';
import { AppStatusBar } from './app/AppStatusBar';
import { AppTopBar } from './app/AppTopBar';
import { LazyDialogFallback, loadAboutDialog, loadSettingsDialog, preloadLazyParts, useLazy, useLazyKept } from './app/lazy';
import { AnnouncerContext, createAnnouncer, LiveRegion, useSelectionAnnouncements } from './app/LiveAnnouncer';
import { MapPanel } from './app/MapPanel';
import { type ProjectsDialogMode, ProjectsDialogHost } from './app/ProjectMenu';
import { useProjectSession } from './app/ProjectMenuContext';
import { createRouteActions } from './app/route-actions';
import { type RowPrefs, RoutePanel } from './app/RoutePanel';
import { selectCharacterClass, selectCustomQuests, selectFaction, selectImports, selectQuestOverrides, selectRoute, selectStartLevel } from './app/selectors';
import { useGlobalShortcuts } from './app/useShortcuts';
import { browserStorage, type PrefsStorage, readShellPrefs, type ShellPrefs, writeShellPrefs } from './app/view-prefs';
import { AppShell, PRODUCT_NAME } from './kit';
import type { ShellLayout } from './shell/AppShell';
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
  /**
   * Where the shell keeps its per-browser preferences (rows, panel widths, collapse, map focus;
   * `view-prefs.ts`) and each project's last selected step (`app/selection-memory.ts`); default the
   * browser's `localStorage`, null for none (kept for the page load).
   */
  readonly prefsStorage?: (() => PrefsStorage | null) | undefined;
  /**
   * Select a step when a project opens (D-050 item 2; review UI-08): the one last selected in it,
   * else the last step. Default true; component tests of other behaviour start with none selected.
   */
  readonly selectOnOpen?: boolean | undefined;
}

export function App({ store, data, projectName, routeNotice = null, geometrySummary = null, map = null, version, sourceCommit, prefsStorage = browserStorage, selectOnOpen = true }: AppProps) {
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
  // The shell's per-browser preferences (ui-refresh.md §4.1, §4.3): read once, written on change.
  const [prefs, setPrefs] = useState<ShellPrefs>(() => readShellPrefs(prefsStorage));
  const prefsLoaded = useRef(false);
  useEffect(() => {
    if (!prefsLoaded.current) {
      prefsLoaded.current = true;
      return;
    }
    writeShellPrefs(prefsStorage, prefs);
  }, [prefs, prefsStorage]);
  const updatePrefs = useCallback((patch: Partial<ShellPrefs>) => {
    setPrefs((was) => ({ ...was, ...patch }));
  }, []);
  const onLeftWidthChange = useCallback((leftWidth: number) => {
    updatePrefs({ leftWidth });
  }, [updatePrefs]);
  const onRightWidthChange = useCallback((rightWidth: number) => {
    updatePrefs({ rightWidth });
  }, [updatePrefs]);
  const toggleMapFocus = useCallback(() => {
    setPrefs((was) => ({ ...was, mapFocus: !was.mapFocus }));
  }, []);
  const rowPrefs = useMemo<RowPrefs>(() => ({ density: prefs.density, topNumber: prefs.topNumber, column: prefs.column }), [prefs.density, prefs.topNumber, prefs.column]);
  const layout = useMemo<ShellLayout>(
    () => ({ leftCollapsed: prefs.leftCollapsed, rightCollapsed: prefs.rightCollapsed, mapFocus: prefs.mapFocus }),
    [prefs.leftCollapsed, prefs.rightCollapsed, prefs.mapFocus],
  );
  // The Projects dialog (the route name's menu and the project bar's notices open it; a lazy part).
  const session = useProjectSession();
  const [projectsDialog, setProjectsDialog] = useState<ProjectsDialogMode | null>(null);
  const closeProjects = useCallback(() => {
    setProjectsDialog(null);
  }, []);
  const searchRef = useRef<HTMLInputElement>(null);
  const routeRef = useRef<HTMLDivElement>(null);

  // A step is selected when a project opens (D-050 item 2; review UI-08): the one last selected in
  // it, else the last step. Before paint, and before the announcements subscribe, so it is not read out.
  useLayoutEffect(() => (selectOnOpen ? followSelection(store, prefsStorage) : undefined), [store, prefsStorage, selectOnOpen]);

  const [announcer] = useState(createAnnouncer);
  // The map's quest layers read the quest state after the active step (map-presentation.md §7; MP.3).
  const derivedStore = useDerivedStore();
  const settings = useLazy(loadSettingsDialog, settingsOpen);
  const about = useLazyKept(loadAboutDialog, aboutOpen);
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
          atlas: map.atlas,
          smoothWheel: map.smoothWheel,
          mapStyle: map.mapStyle,
          derived: derivedStore,
        }),
  );
  const mapWiring = useMemo(() => (map === null || mapController === null ? null : { setup: map, controller: mapController }), [map, mapController]);
  // World map names for the status bar's travel sentences ("Kalimdor", not "world map 1"): the
  // controller's, which name every world map whichever surface shows it (the atlas shows several).
  const mapName = useMemo(() => {
    const controller = mapController;
    return (mapId: number): string | null => controller?.mapName(mapId as WorldMapId) ?? null;
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
  useGlobalShortcuts({ actions, focusSearch, toggleMapFocus, enabled: !aboutOpen && !settingsOpen && projectsDialog === null });

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

  return (
    <AnnouncerContext.Provider value={announcer}>
      <AppShell
        top={
          <AppTopBar
            store={store}
            dataset={dataset}
            projectName={projectName}
            search={search}
            onSearchChange={onSearchChange}
            onSearchSubmit={onSearchSubmit}
            searchRef={searchRef}
            onAbout={openAbout}
            mapController={mapController}
            announce={announcer.announce}
            onOpenSettings={openSettings}
            onOpenProjects={setProjectsDialog}
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
            rowPrefs={rowPrefs}
            onRowPrefsChange={updatePrefs}
            onOpenProjects={setProjectsDialog}
            announce={announcer.announce}
          />
        }
        centre={<MapPanel store={store} view={view} activeRow={activeRow} map={mapWiring} geometry={geometrySummary} announce={announcer.announce} dataset={dataset} actions={actions} />}
        right={
          <AppSidePanel
            store={store}
            view={view}
            route={route}
            dataset={dataset}
            baseDataset={baseDataset}
            activeRow={activeRow}
            search={search}
            onSearchChange={onSearchChange}
            actions={actions}
            mapController={mapController}
            announce={announcer.announce}
            onFocusList={focusList}
          />
        }
        bottom={<AppStatusBar store={store} view={view} dataset={dataset} activeRow={activeRow} announce={announcer.announce} mapName={mapName} />}
        leftWidth={prefs.leftWidth ?? undefined}
        onLeftWidthChange={onLeftWidthChange}
        rightWidth={prefs.rightWidth ?? undefined}
        onRightWidthChange={onRightWidthChange}
        layout={layout}
        onLayoutChange={updatePrefs}
      />
      {session !== null && <ProjectsDialogHost session={session} mode={projectsDialog} onClose={closeProjects} announce={announcer.announce} />}
      {about.kind === 'ready' ? (
        <about.value.AboutDialog
          open={aboutOpen}
          onClose={closeAbout}
          version={version}
          sourceCommit={sourceCommit}
          dataUpstreamCommit={placeholder || identity.upstreamCommit === 'none' ? null : identity.upstreamCommit}
          dataIdentity={placeholder ? null : { dataRevision: identity.dataRevision, frameBuild: identity.frameBuild }}
          mapStyleShown={mapController?.getStatus().style.shown ?? null}
        />
      ) : (
        aboutOpen && <LazyDialogFallback title={`About ${PRODUCT_NAME}`} state={about} onClose={closeAbout} />
      )}
      {settings.kind === 'ready' ? (
        <settings.value.SettingsDialog open={settingsOpen} onClose={closeSettings} store={store} announce={announcer.announce} />
      ) : (
        <LazyDialogFallback title="Settings" state={settings} onClose={closeSettings} />
      )}
      <LiveRegion announcer={announcer} />
    </AnnouncerContext.Provider>
  );
}
