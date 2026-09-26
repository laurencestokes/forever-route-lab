import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { type EditorState, type EditorStore, setMapLayerVisible } from '../../app';
import type { ActivePlacement, MapController, MapEngineSetup, MapLayerStatus, MapStatus } from '../../app/map-exports';
import { useEditor } from '../../app/react';
import { isLayerId, LAYER_IDS, LAYER_LABELS, parseSurfaceId, type LayerId, type MapAdapterFactory, type SurfaceId, type SurfaceInfo, type UnplacedReason } from '../../map/adapter';
import { type ActiveRow, type RouteView } from '../app-model';
import { formatInteger, plural } from '../kit';
import { MapFrame, MapHoverText, type MapChoiceProps, type MapCommand, type MapEngineState, type MapLayerRow } from '../shell/MapFrame';
import type { MapGlyphKind } from '../shell/MapLegend';
import type { Announce } from './LiveAnnouncer';
import { useActiveTarget } from './selectors';

/**
 * The centre panel (docs/UI.md §12; ARCHITECTURE §7): the map engine, loaded on demand in its own
 * chunk, mounted by the map controller (src/app/map-controller.ts), with the surface switcher,
 * fit route, focus step, the layer panel and key, and the status line around it
 * (src/ui/shell/MapFrame.tsx).
 *
 * The map follows the active step of the route list (the controller brings it into view); a click
 * on a step marker selects that step, a click on a quest giver or flight master opens its quests in
 * Details, and a click on several items at one point lists them to choose from. Every one of those
 * has a keyboard path elsewhere, which the instructions say.
 *
 * What the pointer is over comes from the controller's own hover channel and is rendered by a
 * small component of its own, so crossing markers re-renders only that line (M3 review PERF-14).
 */

export interface MapPanelProps {
  readonly store: EditorStore;
  readonly view: RouteView;
  readonly activeRow: ActiveRow | null;
  /** The map engine and its controller; null when there is none (tests without geometry). */
  readonly map: { readonly setup: MapEngineSetup; readonly controller: MapController } | null;
  /** Which geometry is loaded, for the layer panel (MAPS.md §5.6 step 6); null when not known. */
  readonly geometry?: string | null | undefined;
  readonly announce: Announce;
}

/** The layer panel lists the topmost layer first. */
const PANEL_ORDER: readonly LayerId[] = [...LAYER_IDS].reverse();

/** Each layer's glyph in the layer panel, as the map draws it (MapLegend.tsx). */
export const LAYER_GLYPHS: Readonly<Record<LayerId, MapGlyphKind>> = {
  art: 'art',
  'zone-frames': 'frame',
  'available-quests': 'quest-start',
  objectives: 'objective',
  'turn-ins': 'quest-end',
  'flight-masters': 'flight-master',
  'route-line': 'line-route',
  'route-steps': 'step',
  proposal: 'line-proposal',
  selection: 'halo',
};

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
  'Drag, or use the arrow keys, to pan; plus and minus zoom. Click a step marker to select its step, and a quest giver, objective, turn-in or flight master to open its quests in Details; where several share a point, a list lets you choose. ' +
  'The map is supplementary: the route list, the Available tab, Details and the top bar’s Jump to zone do everything it does.';

export const NO_MAP_ENGINE = 'The map engine or its geometry is not available in this view.';
export const SCHEMATIC_NOTICE = 'Schematic map: zone frames, not terrain';
export const SCHEMATIC_NOTICE_SHORT = 'Schematic';
export const LOCAL_ART_NOTICE = 'Local map art (this machine only), over zone frames';
export const LOCAL_ART_NOTICE_SHORT = 'Local art';

type Engine = { readonly kind: 'loading' } | { readonly kind: 'ready'; readonly factory: MapAdapterFactory } | { readonly kind: 'failed'; readonly message: string };

const NO_STATUS_SUBSCRIBE = (): (() => void) => () => undefined;
const NO_SURFACES: readonly SurfaceInfo[] = [];
const NO_LINES: readonly string[] = [];

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
 * surfaces: the switcher reaches the latter, nothing reaches the former (MAP-UX-9).
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

function layerRow(status: MapLayerStatus): MapLayerRow {
  const drawn = status.stats.drawn;
  return {
    id: status.layer,
    label: LAYER_LABELS[status.layer],
    glyph: LAYER_GLYPHS[status.layer],
    visible: status.visible,
    unavailable: status.unavailable,
    // A hidden layer draws nothing: its count would read as drawn.
    count: status.unavailable === null && status.visible && drawn > 0 ? `${formatInteger(drawn)} drawn` : null,
    notes: status.notes,
  };
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

/** The status line's "Pointer on: …", subscribed to the controller's hover alone. */
function PointerLine({ controller }: { readonly controller: MapController }) {
  const text = useSyncExternalStore(controller.subscribeHover, controller.getHover, controller.getHover);
  return <MapHoverText text={text} />;
}

const selectSurface = (s: EditorState) => s.view.map.surface;
const selectZoomBand = (s: EditorState) => s.view.map.zoomBand;
const selectLayersOpen = (s: EditorState) => s.view.showLayerPanel;

export const MapPanel = memo(function MapPanel({ store, view, activeRow, map, geometry = null, announce }: MapPanelProps) {
  const controller = map?.controller ?? null;
  const { engine, retry } = useMapEngine(map?.setup.loadAdapter ?? null);
  const hostRef = useRef<HTMLDivElement>(null);
  const instructionsId = useId();

  const status = useSyncExternalStore(
    controller?.subscribe ?? NO_STATUS_SUBSCRIBE,
    () => controller?.getStatus() ?? null,
    () => controller?.getStatus() ?? null,
  );
  const storedSurface = useEditor(store, selectSurface);
  const zoomBand = useEditor(store, selectZoomBand);
  const layersOpen = useEditor(store, selectLayersOpen);
  const { step: activeStep } = useActiveTarget(store, view, activeRow);
  const activeStepId = activeStep?.id ?? null;

  const surfaces = controller?.surfaces ?? NO_SURFACES;
  const surfaceId = status?.surface ?? storedSurface ?? surfaces[0]?.id ?? null;
  const surfaceInfo = surfaces.find((info) => info.id === surfaceId) ?? null;
  const surfaceName = surfaceInfo?.name ?? null;
  const mapLabel = surfaceName === null ? 'Route map' : `Route map: ${surfaceName}`;
  const localArt = status !== null && status.artDrawn > 0;
  const notice = localArt ? LOCAL_ART_NOTICE : SCHEMATIC_NOTICE;

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

  const routeCounts = status?.route.maps;
  const surfaceOptions = useMemo(
    () =>
      surfaces.map((info) => {
        const steps = routeCounts?.find((entry) => entry.mapId === info.mapId)?.steps ?? 0;
        return { value: info.id, label: steps > 0 ? `${info.name} · ${plural(steps, 'route step')}` : info.name };
      }),
    [surfaces, routeCounts],
  );

  const onSurfaceChange = useCallback(
    (value: string) => {
      if (controller === null || parseSurfaceId(value) === null) return;
      controller.showSurface(value as SurfaceId);
    },
    [controller],
  );
  const surfaceProp = useMemo(() => ({ value: surfaceId ?? '', options: surfaceOptions, onChange: onSurfaceChange }), [surfaceId, surfaceOptions, onSurfaceChange]);

  const onLayerToggle = useCallback(
    (id: string, visible: boolean) => {
      if (isLayerId(id)) setMapLayerVisible(store, id, visible);
    },
    [store],
  );

  const onLayersOpenChange = useCallback(
    (open: boolean) => {
      store.setView({ showLayerPanel: open });
    },
    [store],
  );

  const canFit = status?.route.canFit === true;
  const focusReason = controller === null ? NO_MAP_ENGINE : focusUnavailable(active);
  const activeNumber = active?.number ?? 0;
  const commands = useMemo(
    (): readonly MapCommand[] => [
      {
        id: 'fit-route',
        label: 'Fit route',
        title: 'Show the whole route on this map (or on the first map it reaches)',
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
        title: 'Centre the map on the active step',
        unavailable: focusReason,
        onRun: () => {
          if (controller === null || activeStepId === null) return;
          const result = controller.focusStep(activeStepId);
          if (result.kind === 'focused') announce(`Map centred on step ${formatInteger(activeNumber)}.`);
          else if (result.kind === 'no-surface') announce(`${noSurfaceText(activeNumber, result.mapId)}.`);
        },
      },
    ],
    [controller, canFit, focusReason, activeStepId, activeNumber, surfaces, announce],
  );

  const layerRows = useMemo(() => {
    if (status === null) return [];
    const byLayer = new Map(status.layers.map((layer) => [layer.layer, layer]));
    return PANEL_ORDER.flatMap((layer) => {
      const entry = byLayer.get(layer);
      return entry === undefined ? [] : [layerRow(entry)];
    });
  }, [status]);
  const footer = useMemo(() => (geometry === null ? NO_LINES : [`Geometry loaded: ${geometry}.`]), [geometry]);
  const layersProp = useMemo(() => ({ layers: layerRows, onToggle: onLayerToggle, footer }), [layerRows, onLayerToggle, footer]);

  const startFailure = status?.failure ?? null;
  const frameEngine = useMemo((): MapEngineState => {
    if (map === null || controller === null) return { kind: 'unavailable', message: NO_MAP_ENGINE };
    if (engine.kind === 'failed') return { kind: 'failed', message: engine.message, onRetry: retry };
    if (engine.kind === 'loading') return { kind: 'loading' };
    // Loaded, but the engine threw while starting (a retry loads and starts it afresh).
    if (startFailure !== null) return { kind: 'failed', message: startFailure, onRetry: retry };
    return { kind: 'ready' };
  }, [map, controller, engine, startFailure, retry]);

  const routeLine = status === null ? null : routeStatusText(status.route, surfaceName);
  const statusLines = useMemo(() => {
    const lines: string[] = [];
    if (routeLine !== null) lines.push(routeLine);
    if (zoomBand === 'continent') lines.push('Zoomed out: quest points shown as zone counts');
    if (unreachable !== null) lines.push(unreachable);
    return lines;
  }, [routeLine, zoomBand, unreachable]);

  const hover = useMemo(() => (controller === null ? null : <PointerLine controller={controller} />), [controller]);

  const pendingChoice = status?.choice ?? null;
  const choice = useMemo((): MapChoiceProps | null => {
    if (controller === null || pendingChoice === null) return null;
    return {
      title: pendingChoice.title,
      hint: pendingChoice.hint,
      options: pendingChoice.options.map((option) => option.label),
      allLabel: pendingChoice.allLabel,
      at: pendingChoice.at,
      onChoose: controller.choose,
      onAll: controller.chooseAll,
      onDismiss: controller.dismissChoice,
    };
  }, [controller, pendingChoice]);

  return (
    <MapFrame
      surface={surfaceProp}
      commands={commands}
      layersOpen={layersOpen}
      onLayersOpenChange={onLayersOpenChange}
      layers={layersProp}
      notice={notice}
      noticeShort={localArt ? LOCAL_ART_NOTICE_SHORT : SCHEMATIC_NOTICE_SHORT}
      engine={frameEngine}
      stageRef={hostRef}
      instructionsId={instructionsId}
      instructions={`${notice}. ${mapLabel}. ${MAP_INSTRUCTIONS}`}
      status={statusLines}
      hover={hover}
      choice={choice}
    />
  );
});
