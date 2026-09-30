import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { type EditorState, type EditorStore, setMapLayerVisible, setMapWalkingPaths } from '../../app';
import {
  ART_NOTICE_PATH,
  ATLAS_NOTICE_PATH,
  atlasInstruction,
  DEFAULT_HIDDEN_CATEGORIES,
  EMPTY_MAP_LAYERS_RECORD,
  isMapCategoryGroupId,
  layerVisibility,
  MINIMAP_NOTICE_PATH,
  normaliseHidden,
  type ActivePlacement,
  type MapBackdrop,
  type MapCategoryGroupId,
  type MapController,
  type MapEngineSetup,
  type MapInsetStatus,
  type MapPreset,
  type MapStatus,
} from '../../app/map-exports';
import { type DerivedState, selectZoneSpans } from '../../app/derived';
import { useDerivedSelector, useEditor } from '../../app/react';
import type { UiMapId } from '../../domain/ids';
import { isAtlasSurface, surfaceMapIds, type MapAdapterFactory, type MapCategoryId, type SurfaceInfo, type UnplacedReason } from '../../map/adapter';
import { type ActiveRow, type RouteView } from '../app-model';
import { AssumedMarker, DifficultyLabel, formatInteger, plural, VisuallyHidden } from '../kit';
import { isModalDialogOpen } from '../lib/modal';
import type { SelectOption, SelectOptionGroup } from '../primitives/Select';
import { MapFrame, MapHoverText, useMapRegionDocking, type MapCommand, type MapEngineState } from '../shell/MapFrame';
import type { DatasetView } from '../../domain/dataset';
import { loadMapLayersPanel, loadMapPopover, useLazyKept } from './lazy';
import type { Announce } from './LiveAnnouncer';
import type { RouteActions } from './route-actions';
import { useActiveTarget } from './selectors';

/**
 * The centre panel (docs/UI.md §12; ARCHITECTURE §7; docs/research/map-presentation.md §25.3): the
 * map engine, loaded on demand in its own chunk, mounted by the map controller
 * (src/app/map-controller.ts), with its controls floating on it (src/ui/shell/MapFrame.tsx) and the
 * Map layers drawer on its left (a lazy part, `MapLayersPanel`).
 *
 * The map follows the active step of the route list (the controller brings it into view); a click
 * on a step marker selects that step, a click on a cluster zooms in to it, and a click on a pin, a
 * stack or a point of the map opens the map popover (a lazy part, `MapPopoverPanel`; §14.2, step
 * MP.6) with what can be added there. Every one of those has a keyboard path elsewhere, which the
 * instructions say.
 *
 * **The drawer** (§25.3.1, §25.3.7; D-047): open by default where it docks (a map region of 900 px or
 * more), closed where it would lie over the map; the choice is kept in this browser, and a kept
 * "open" applies only where it docks. Its rows are applied here, so they hold before the drawer's
 * code has loaded: the pin rows to the controller's mask, the layer rows to the store's layer
 * visibility, Walking paths to the store, and all of them to the kept record (500 ms after the last
 * change). What the pointer is over comes from the controller's own hover channel and is rendered by
 * a small component of its own (M3 review PERF-14).
 */

export interface MapPanelProps {
  readonly store: EditorStore;
  readonly view: RouteView;
  readonly activeRow: ActiveRow | null;
  /** The map engine and its controller; null when there is none (tests without geometry). */
  readonly map: { readonly setup: MapEngineSetup; readonly controller: MapController } | null;
  /** Which geometry is loaded (MAPS.md §5.6 step 6); null when not known. */
  readonly geometry?: string | null | undefined;
  readonly announce: Announce;
  /** The dataset and the route actions the map popover's actions use (step MP.6); omitted: the popover opens without them (tests). */
  readonly dataset?: DatasetView | null | undefined;
  readonly actions?: RouteActions | null | undefined;
}

const UNPLACED_TEXT: Readonly<Record<UnplacedReason, string>> = {
  'no-geometry': 'its map has no geometry here',
  'outside-ui-rectangles': 'its point lies outside every map rectangle',
  'no-era-coefficients': 'its Era-frame point has no conversion',
  'non-finite': 'its coordinates are not valid numbers',
  'instance-without-entrance': 'it is inside an instance with no known entrance',
  'unmapped-area': 'it is in an area no map shows',
  'destination-unknown': 'it moves the character somewhere the route does not say',
};

export const MAP_INSTRUCTIONS =
  'Drag, or use the arrow keys, to pan; plus and minus zoom. Click a step marker to select its step, a cluster to zoom in to it, and a pin or a place on the map to open a popover of what you can add there (Escape closes it). ' +
  'Map layers, before the map, shows and hides each kind of pin and searches the map. The map is supplementary: the route list, the Available tab, Details and the top bar’s Go to zone or view do everything it does.';

export const NO_MAP_ENGINE = 'The map engine or its geometry is not available in this view.';

/** The caption while a pick is in progress ("Pick on map" in Details, docs/UI.md §14). */
export const pickText = (label: string): string => `Picking ${label}: click the map to place it. Escape cancels.`;
export const SCHEMATIC_NOTICE = 'Schematic map: zone frames, not terrain';
export const SCHEMATIC_NOTICE_SHORT = 'Schematic';
export const LOCAL_ART_NOTICE = 'Local map art (this machine only), over zone frames';
export const LOCAL_ART_NOTICE_SHORT = 'Local art';
/** Shown with the painted art (D-033 rule 2: Blizzard's notice accompanies the art); About has the full notice. */
export const PAINTED_ART_NOTICE = 'Painted map art © Blizzard Entertainment';
export const PAINTED_ART_NOTICE_SHORT = 'Art © Blizzard';
/** Shown with the minimap tiles (D-045 item 1: D-033's terms, a NOTICE naming Blizzard); About has the notice. */
export const MINIMAP_ART_NOTICE = 'Minimap art © Blizzard Entertainment';
export const RELIEF_NOTICE = 'Terrain relief computed from game data, not painted art';
export const RELIEF_NOTICE_SHORT = 'Relief';

/** The notice and its short form for what the map shows under its markers. */
export const BACKDROP_NOTICES: Readonly<Record<MapBackdrop, { readonly long: string; readonly short: string }>> = {
  art: { long: PAINTED_ART_NOTICE, short: PAINTED_ART_NOTICE_SHORT },
  'local-art': { long: LOCAL_ART_NOTICE, short: LOCAL_ART_NOTICE_SHORT },
  relief: { long: RELIEF_NOTICE, short: RELIEF_NOTICE_SHORT },
  schematic: { long: SCHEMATIC_NOTICE, short: SCHEMATIC_NOTICE_SHORT },
};

/** The drawer's record is written this long after the last change (§25.3.7). */
export const MAP_LAYERS_WRITE_DELAY_MS = 500;

type Engine = { readonly kind: 'loading' } | { readonly kind: 'ready'; readonly factory: MapAdapterFactory } | { readonly kind: 'failed'; readonly message: string };

const NO_STATUS_SUBSCRIBE = (): (() => void) => () => undefined;
const NO_SURFACES: readonly SurfaceInfo[] = [];
const NO_INSETS: readonly MapInsetStatus[] = [];

/** The group of switcher entries for maps the atlas does not place (map-atlas.md §8.5). */
export const SEPARATE_MAPS_GROUP = 'Separate maps';

/** The atlas's view entry: `Azeroth (both continents; Zephras Isle inset)`. */
export function atlasSurfaceLabel(name: string, insets: readonly string[]): string {
  return insets.length === 0 ? `${name} (both continents)` : `${name} (both continents; ${insets.join(', ')} inset${insets.length === 1 ? '' : 's'})`;
}

/**
 * The view entries (the top bar's "Go to zone or view…" select takes the atlas's views, §25.3.0):
 * one per world surface, each with its route steps; with the atlas, the atlas (its steps on every
 * map it places), its presets, then the other surfaces under `SEPARATE_MAPS_GROUP`.
 */
export function surfaceSwitcherOptions(
  surfaces: readonly SurfaceInfo[],
  presets: readonly MapPreset[],
  stepsOn: (mapIds: readonly number[]) => number,
): readonly (SelectOption | SelectOptionGroup)[] {
  const labelled = (value: string, name: string, steps: number): SelectOption => ({ value, label: steps > 0 ? `${name} · ${plural(steps, 'route step')}` : name });
  const atlas = surfaces.find(isAtlasSurface);
  if (atlas === undefined) return surfaces.map((info) => labelled(info.id, info.name, stepsOn(surfaceMapIds(info))));
  const insets = atlas.placements.filter((placement) => placement.kind === 'inset').map((placement) => atlas.members.find((member) => member.mapId === placement.mapId)?.name ?? `World map ${String(placement.mapId)}`);
  const main = [labelled(atlas.id, atlasSurfaceLabel(atlas.name, insets), stepsOn(atlas.mapIds)), ...presets.map((preset) => labelled(preset.id, preset.name, stepsOn([preset.mapId])))];
  const separate = surfaces.filter((info) => info !== atlas).map((info) => labelled(info.id, info.name, stepsOn(surfaceMapIds(info))));
  return separate.length === 0 ? main : [...main, { group: SEPARATE_MAPS_GROUP, options: separate }];
}

/** Loads the map engine's chunk once per attempt; `retry` starts another attempt. */
function useMapEngine(load: (() => Promise<MapAdapterFactory>) | null): { readonly engine: Engine; readonly retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [engine, setEngine] = useState<Engine>({ kind: 'loading' });
  useEffect(() => {
    if (load === null) return undefined;
    let live = true;
    load().then(
      (factory) => {
        if (live) setEngine({ kind: 'ready', factory });
      },
      (error: unknown) => {
        if (live) setEngine({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [load, attempt]);
  const retry = useCallback(() => {
    setEngine({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }, []);
  return { engine, retry };
}

/**
 * "Route: 34 of 40 steps on Kalimdor · 2 on other maps · 1 on maps with no surface · 1 not placed
 * · 3 without a location". Steps on world maps no surface shows are said apart from those on other
 * surfaces: the views reach the latter, nothing reaches the former (MAP-UX-9).
 */
export function routeStatusText(route: MapStatus['route'], surfaceName: string | null): string {
  const where = surfaceName === null ? '' : ` on ${surfaceName}`;
  const parts = [`Route: ${formatInteger(route.onSurface)} of ${plural(route.total, 'step')}${where}`];
  const elsewhere = route.placed - route.onSurface - route.noSurface;
  if (elsewhere > 0) parts.push(`${formatInteger(elsewhere)} on other maps`);
  if (route.noSurface > 0) parts.push(`${formatInteger(route.noSurface)} on maps with no surface`);
  if (route.unplaced > 0) parts.push(`${formatInteger(route.unplaced)} not placed`);
  if (route.withoutLocation > 0) parts.push(`${formatInteger(route.withoutLocation)} without a location`);
  return parts.join(' · ');
}

/** `Step 6 is on world map 36, which this map cannot show`. */
export function noSurfaceText(number: number, mapId: number): string {
  return `Step ${formatInteger(number)} is on world map ${String(mapId)}, which this map cannot show`;
}

/** Why "focus step" cannot run, or null when it can. */
export function focusUnavailable(active: MapStatus['activeStep']): string | null {
  if (active === null) return 'Select a step in the route first';
  const placement: ActivePlacement = active.placement;
  switch (placement.kind) {
    case 'point':
      return null;
    case 'no-surface':
      return noSurfaceText(active.number, placement.mapId);
    case 'none':
      return `Step ${formatInteger(active.number)} has no location`;
    case 'unknown':
      return `Step ${formatInteger(active.number)} is not on the map: ${UNPLACED_TEXT[placement.reason]}`;
  }
}

/** Names the engine's focusable surface (the element the engine created inside the host) for assistive technology. */
function labelEngineSurface(host: HTMLElement | null, label: string, describedBy: string): void {
  const surface = host?.firstElementChild;
  if (!(surface instanceof HTMLElement)) return;
  surface.setAttribute('role', 'application');
  surface.setAttribute('aria-roledescription', 'map');
  surface.setAttribute('aria-label', label);
  surface.setAttribute('aria-describedby', describedBy);
}

/** The caption's "Pointer on: …", subscribed to the controller's hover alone. */
function PointerLine({ controller }: { readonly controller: MapController }) {
  const text = useSyncExternalStore(controller.subscribeHover, controller.getHover, controller.getHover);
  return <MapHoverText text={text} />;
}

const selectPaintedLabels = (state: DerivedState | null) => state?.places?.labels?.painted ?? null;

/**
 * The "Viewing" chip's content (map-presentation.md §13.5; step MP.7): "Viewing The Barrens · quests
 * 13–25 (93 open to an Orc Warrior)" with the boxed E, or a new zone's cited text, and the real
 * `DifficultyLabel` rating the zone's median quest level at the character's level after the step
 * (the card's twin input, where the span allows a rating).
 */
export function ViewingChip({ uiMapId, minimap = false }: { readonly uiMapId: UiMapId; readonly minimap?: boolean }) {
  const spans = useDerivedSelector(selectZoneSpans);
  const labels = useDerivedSelector(selectPaintedLabels);
  const span = spans?.get(uiMapId);
  if (span === undefined) return null;
  const card = labels?.find((label) => label.id === `zone:${String(uiMapId)}`)?.card ?? null;
  const rated = card?.difficulty ?? null;
  // In the minimap style an underground city says so (D-049 O19; review PR-17).
  const name = minimap ? (span.undergroundName ?? span.name) : span.name;
  return (
    <>
      <span className="frl-mapframe__viewing-text">
        Viewing <strong>{name}</strong> · {span.viewing}
        {card?.basis === 'derived' && <AssumedMarker reason="era-fallback" detail="the dataset's Era quest levels, counted over the quests open to the character" />}
      </span>
      {rated !== null && (
        <span>
          <VisuallyHidden>Median quest level: </VisuallyHidden>
          <DifficultyLabel level={Number(rated.levelText)} difficulty={rated.key} uncertain={rated.lowerBound} />
        </span>
      )}
    </>
  );
}

const selectSurface = (s: EditorState) => s.view.map.surface;
const selectMapUi = (s: EditorState) => s.view.map;

/** The notices' links in the key (map-atlas.md §21.6; D-033 rule 2). */
const NOTICE_LINKS = { painted: ATLAS_NOTICE_PATH, minimap: MINIMAP_NOTICE_PATH, art: ART_NOTICE_PATH } as const;

export const MapPanel = memo(function MapPanel({ store, view, activeRow, map, geometry = null, announce, dataset = null, actions = null }: MapPanelProps) {
  const controller = map?.controller ?? null;
  const settings = map?.setup.mapLayers ?? null;
  const { engine, retry } = useMapEngine(map?.setup.loadAdapter ?? null);
  const hostRef = useRef<HTMLDivElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const instructionsId = useId();
  const drawerId = useId();

  const status = useSyncExternalStore(
    controller?.subscribe ?? NO_STATUS_SUBSCRIBE,
    () => controller?.getStatus() ?? null,
    () => controller?.getStatus() ?? null,
  );
  const picking = status?.pick?.label ?? null;
  const storedSurface = useEditor(store, selectSurface);
  const mapUi = useEditor(store, selectMapUi);
  const { step: activeStep } = useActiveTarget(store, view, activeRow);
  const activeStepId = activeStep?.id ?? null;

  const surfaces = controller?.surfaces ?? NO_SURFACES;
  const surfaceId = status?.surface ?? storedSurface ?? surfaces[0]?.id ?? null;
  const surfaceInfo = surfaces.find((info) => info.id === surfaceId) ?? null;
  const surfaceName = surfaceInfo?.name ?? null;
  const mapLabel = surfaceName === null ? 'Route map' : `Route map: ${surfaceName}`;
  const minimapShown = status?.style.shown === 'minimap';
  const backdrop = BACKDROP_NOTICES[status?.backdrop ?? 'schematic'];
  const notice = status?.backdrop === 'art' && minimapShown ? MINIMAP_ART_NOTICE : backdrop.long;
  const insets = status?.insets ?? NO_INSETS;
  const onAtlas = surfaceInfo?.kind === 'atlas';

  // The drawer's record (§25.3.7), read once at the first render.
  const [record] = useState(() => settings?.read() ?? EMPTY_MAP_LAYERS_RECORD);
  const [hidden, setHidden] = useState<readonly MapCategoryId[]>(() => normaliseHidden(record.hidden ?? DEFAULT_HIDDEN_CATEGORIES));
  const [collapsed, setCollapsed] = useState<readonly MapCategoryGroupId[]>(() => record.collapsed.filter(isMapCategoryGroupId));
  /** This page's choice of open or closed; null until the user chooses (the default then applies). */
  const [openChoice, setOpenChoice] = useState<boolean | null>(null);
  const docked = useMapRegionDocking(regionRef);
  // Open by default where it docks; a kept "open" applies only there (§25.3.1, P4).
  const drawerOpen = openChoice ?? (docked ? (record.drawerOpen ?? true) : false);
  const dirty = useRef(false);

  // Rows apply at once, before the drawer's code has loaded (§25.3.4).
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  useEffect(() => {
    controller?.setCategories(hidden);
  }, [controller, hidden]);
  useEffect(() => {
    for (const [layer, visible] of layerVisibility(hiddenSet)) if (mapUi.layers[layer] !== visible) setMapLayerVisible(store, layer, visible);
    const walking = !hiddenSet.has('walking-paths');
    if (mapUi.walkingPaths !== walking) setMapWalkingPaths(store, walking);
  }, [store, hiddenSet, mapUi.layers, mapUi.walkingPaths]);
  // Kept 500 ms after the last change; only what the user chose.
  useEffect(() => {
    if (!dirty.current || settings === null) return undefined;
    const handle = window.setTimeout(() => {
      settings.write({ hidden, collapsed, ...(openChoice === null ? {} : { drawerOpen: openChoice }) });
    }, MAP_LAYERS_WRITE_DELAY_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [settings, hidden, collapsed, openChoice]);

  const onHidden = useCallback(
    (next: readonly MapCategoryId[], announcement?: string) => {
      dirty.current = true;
      setHidden(normaliseHidden(next));
      if (announcement !== undefined) announce(announcement);
    },
    [announce],
  );
  const onCollapsed = useCallback((next: readonly MapCategoryGroupId[]) => {
    dirty.current = true;
    setCollapsed(next);
  }, []);
  const toggleDrawer = useCallback(() => {
    dirty.current = true;
    setOpenChoice(!drawerOpen);
  }, [drawerOpen]);
  const closeDrawer = useCallback(() => {
    dirty.current = true;
    setOpenChoice(false);
    regionRef.current?.querySelector<HTMLButtonElement>('.frl-mapframe__layers-toggle')?.focus();
  }, []);

  // The engine creates its surface element on every mount: name it then, and again whenever the
  // shown surface changes. The latest label is kept in a ref so a remount never waits for a render.
  const labelRef = useRef(mapLabel);
  useEffect(() => {
    labelRef.current = mapLabel;
    labelEngineSurface(hostRef.current, mapLabel, instructionsId);
  }, [mapLabel, instructionsId]);

  // Mount the engine once it is loaded; unmount on cleanup (StrictMode remounts reuse the adapter).
  useEffect(() => {
    const host = hostRef.current;
    if (controller === null || engine.kind !== 'ready' || host === null) return undefined;
    if (!controller.attach(engine.factory, host)) return undefined;
    labelEngineSurface(host, labelRef.current, instructionsId);
    return () => {
      controller.detach();
    };
  }, [controller, engine, instructionsId]);

  useEffect(() => {
    controller?.setActiveStep(activeStepId);
  }, [controller, activeStepId]);

  // The map cannot follow a step placed on a world map it has no surface for: say so once per step.
  const active = status?.activeStep ?? null;
  const unreachable = active !== null && active.placement.kind === 'no-surface' ? noSurfaceText(active.number, active.placement.mapId) : null;
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (unreachable !== null && unreachable !== announced.current) announce(`${unreachable}.`);
    announced.current = unreachable;
  }, [unreachable, announce]);

  const canFit = status?.route.canFit === true;
  const focusReason = controller === null ? NO_MAP_ENGINE : focusUnavailable(active);
  const activeNumber = active?.number ?? 0;
  const usable = controller !== null && engine.kind === 'ready';
  const commands = useMemo(
    (): readonly MapCommand[] => [
      {
        id: 'zoom-in',
        label: 'Zoom in',
        icon: 'add',
        title: 'Zoom in',
        group: 'zoom',
        unavailable: usable ? null : NO_MAP_ENGINE,
        onRun: () => {
          controller?.zoomBy(1);
        },
      },
      {
        id: 'zoom-out',
        label: 'Zoom out',
        icon: 'minus',
        title: 'Zoom out',
        group: 'zoom',
        unavailable: usable ? null : NO_MAP_ENGINE,
        onRun: () => {
          controller?.zoomBy(-1);
        },
      },
      {
        id: 'fit-route',
        label: 'Fit route',
        icon: 'fit',
        title: 'Show the whole route on this map (or on the first map it reaches)',
        group: 'view',
        unavailable: controller === null ? NO_MAP_ENGINE : canFit ? null : 'No step of the route has a map position',
        onRun: () => {
          const result = controller?.fitRoute();
          if (result?.kind === 'fitted') {
            const name = surfaces.find((info) => info.id === result.surface)?.name ?? 'the map';
            announce(`Map shows ${plural(result.steps, 'route step')} on ${name}.`);
          }
        },
      },
      {
        id: 'focus-step',
        label: 'Focus step',
        icon: 'target',
        title: 'Centre the map on the active step',
        group: 'view',
        unavailable: focusReason,
        onRun: () => {
          if (controller === null || activeStepId === null) return;
          const result = controller.focusStep(activeStepId);
          if (result.kind === 'focused') announce(`Map centred on step ${formatInteger(activeNumber)}.`);
          else if (result.kind === 'no-surface') announce(`${noSurfaceText(activeNumber, result.mapId)}.`);
        },
      },
      ...(picking === null
        ? []
        : [
            {
              id: 'cancel-pick',
              label: 'Cancel pick',
              title: `Stop picking ${picking} (Escape)`,
              group: 'view' as const,
              unavailable: null,
              onRun: () => {
                if (controller?.cancelPick() === true) announce('Pick on map cancelled.');
              },
            },
          ]),
    ],
    [controller, usable, canFit, focusReason, activeStepId, activeNumber, surfaces, announce, picking],
  );

  const startFailure = status?.failure ?? null;
  const frameEngine = useMemo((): MapEngineState => {
    if (map === null || controller === null) return { kind: 'unavailable', message: NO_MAP_ENGINE };
    if (engine.kind === 'failed') return { kind: 'failed', message: engine.message, onRetry: retry };
    if (engine.kind === 'loading') return { kind: 'loading' };
    // Loaded, but the engine threw while starting (a retry loads and starts it afresh).
    if (startFailure !== null) return { kind: 'failed', message: startFailure, onRetry: retry };
    return { kind: 'ready' };
  }, [map, controller, engine, startFailure, retry]);

  // A pick in progress: the next click is a point. Escape anywhere cancels it (before any other
  // Escape handler: the route list's clear-selection, a search field's clear), except while a
  // modal dialog is open: the map is inert then, and Escape closes the dialog (UI-F8). The pick
  // waits behind it.
  useEffect(() => {
    if (picking === null || controller === null) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || isModalDialogOpen() || !controller.cancelPick()) return;
      event.preventDefault();
      event.stopPropagation();
      announce('Pick on map cancelled.');
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [picking, controller, announce]);

  const routeLine = status === null ? null : routeStatusText(status.route, surfaceName);
  const caption = useMemo(() => {
    const lines: string[] = [];
    if (picking !== null) lines.push(pickText(picking));
    if (routeLine !== null) lines.push(routeLine);
    if (unreachable !== null) lines.push(unreachable);
    return lines;
  }, [picking, routeLine, unreachable]);

  const hover = useMemo(() => (controller === null ? null : <PointerLine controller={controller} />), [controller]);

  // The map popover (§14.2; step MP.6): a lazy part, drawn while the map has a target.
  const target = status?.popover ?? null;
  const popoverCode = useLazyKept(loadMapPopover, target !== null && controller !== null);
  const returnFocus = useCallback(() => {
    const surface = hostRef.current?.firstElementChild;
    if (surface instanceof HTMLElement) surface.focus();
  }, []);
  const stage = useCallback(() => hostRef.current, []);
  const popover =
    target === null || controller === null || dataset === null || actions === null || popoverCode.kind !== 'ready' ? null : (
      <popoverCode.value.MapPopoverPanel target={target} controller={controller} store={store} dataset={dataset} actions={actions} returnFocus={returnFocus} stage={stage} />
    );

  // The drawer is a lazy part (§25.3.1): its code loads the first time it opens (the production
  // build preloads it when idle), and a stand-in says so meanwhile.
  const panel = useLazyKept(loadMapLayersPanel, drawerOpen && controller !== null);
  let drawerContent;
  if (controller === null)
    drawerContent = (
      <div className="frl-mapframe__drawer-note">
        <p>{NO_MAP_ENGINE}</p>
        {geometry !== null && <p>{`Geometry loaded: ${geometry}.`}</p>}
      </div>
    );
  else if (panel.kind === 'ready') {
    const { MapLayersPanel } = panel.value;
    drawerContent = (
      <MapLayersPanel
        id={drawerId}
        docked={docked}
        controller={controller}
        store={store}
        hidden={hidden}
        onHidden={onHidden}
        collapsed={collapsed}
        onCollapsed={onCollapsed}
        onClose={closeDrawer}
        announce={announce}
        notices={NOTICE_LINKS}
        geometry={geometry}
      />
    );
  } else if (panel.kind === 'failed') {
    drawerContent = (
      <div className="frl-mapframe__drawer-note" role="alert">
        <p>{`Map layers could not be loaded (${panel.message}).`}</p>
        <button type="button" className="frl-button frl-button--default frl-button--sm" onClick={panel.retry}>
          Try again
        </button>
      </div>
    );
  } else {
    drawerContent = (
      <p className="frl-mapframe__drawer-note" role="status">
        Loading map layers…
      </p>
    );
  }

  return (
    <MapFrame
      drawer={{ id: drawerId, open: drawerOpen, docked, onToggle: toggleDrawer, content: drawerContent }}
      commands={commands}
      notice={notice}
      noticeShort={status?.backdrop === 'art' && minimapShown ? MINIMAP_ART_NOTICE.replace('Minimap art', 'Art') : backdrop.short}
      engine={frameEngine}
      stageRef={hostRef}
      regionRef={regionRef}
      instructionsId={instructionsId}
      instructions={onAtlas ? `${notice}. ${mapLabel}. ${atlasInstruction(insets)} ${MAP_INSTRUCTIONS}` : `${notice}. ${mapLabel}. ${MAP_INSTRUCTIONS}`}
      caption={caption}
      hover={hover}
      popover={popover}
      viewing={status === null || status.viewing === null ? null : <ViewingChip uiMapId={status.viewing} minimap={minimapShown} />}
    />
  );
});
