import * as L from 'leaflet';
import './leaflet-core.css';
import './map.css';
import type { UiMapId, WorldMapId } from '../../domain/ids';
import type { WorldPoint } from '../../domain/points';
import {
  descriptorMapId,
  LAYER_IDS,
  labelOf,
  refsOf,
  surfaceIdOf,
  surfaceMapId,
  type Emphasis,
  type FitOptions,
  type FocusOptions,
  type FrameDescriptor,
  type HighlightTarget,
  type LayerContent,
  type LayerId,
  type LayerRenderStats,
  type MapAdapter,
  type MapAdapterOptions,
  type MapContainer,
  type MapDescriptor,
  type MapEvent,
  type MapEventType,
  type MapHit,
  type MapLabelProvider,
  type MapRenderStats,
  type MapViewState,
  type SurfaceId,
  type SurfaceInfo,
  type Viewport,
  type WorldBounds,
} from '../adapter';
import { capItems, diffById, sameData } from './diff';
import { drawOrder, FrameRectangle, GlyphMarker, GridLayer, MeasuredCanvas, placeAfter, ScaleBarControl } from './leaflet-layers';
import { createMapPerf, pagePerformance, type MapPerf, type PerformanceLike } from './perf';
import { aggregateGlyph, frameStyle, markerGlyph, polylineStyle, readMapPalette, type GlyphSpec, type MapPalette, type PathStyle } from './style';
import { boundsToLatLngBounds, latLngBoundsToWorld, latLngToWorld, minZoomFor, nearestSegment, pointToLatLng, zonesAt } from './transform';

/**
 * The Leaflet 1.9.4 implementation of `MapAdapter` (docs/ARCHITECTURE.md §7.2; docs/MAPS.md §7).
 * This directory is the only Leaflet importer; react-leaflet is not used (D-005).
 *
 * - `L.CRS.Simple`, one surface per world map, `latLng = (x, −y)` in yards (transform.ts has the
 *   transform and its inverse). The surface extent bounds the view (with slack), and the least
 *   zoom follows the container, so the largest surface always fits (`minZoomFor`).
 * - One canvas renderer (`L.canvas`, padding 0.1, with User Timing measures, perf.ts) draws every
 *   path. Markers are small original canvas glyphs (glyphs.ts), route and proposal lines polylines,
 *   zone frames rectangles with labels. Local map art (dev/preview only, D-018) is image overlays
 *   in a pane below the canvas; the procedural yard grid has its own canvas above the art, and a
 *   yard scale bar sits bottom left. No Blizzard art ships (MAPS §8.1).
 * - Layers are stacked in `LAYER_IDS` order in the renderer's draw list, which is also the
 *   hit-testing order (the topmost path wins). A created path, or one whose place in its layer's
 *   order changed, is moved to its place in the list (`placeAfter`), which redraws only its own
 *   area; an update in place moves nothing (M3 review PERF-1).
 * - `setLayer` skips content whose `items` array is unchanged by reference, and otherwise diffs by
 *   id (diff.ts): new ids are created, missing ids removed, and changed descriptors updated in
 *   place, calling Leaflet only for what changed: the position (`setLatLng`, `setLatLngs`,
 *   `setBounds`), the glyph or the style. A descriptor whose label or ref alone changed costs
 *   nothing on the canvas.
 * - Hover emphasis (`highlight`) is drawn as a copy of the glyph on top of the `selection` layer;
 *   a highlighted line is restyled in place. Nothing else moves.
 * - Only descriptors on the current surface are drawn; each layer keeps its last content, so a
 *   surface switch redraws what the layers already hold for the new world map.
 * - Clicks and hovers come from the canvas renderer's hit-testing; the adapter maps the hit path
 *   back to its layer and descriptor and emits plain events (with every ref of a merged marker).
 *   Hover labels use one shared tooltip whose text is set as text, never as HTML, from `labelOf`
 *   and the label provider.
 */

export interface LeafletMapAdapterOptions extends MapAdapterOptions {
  /**
   * The least zoom on a stage large enough to show every surface at it (default -6: continents are
   * about -5.2 at native art size, MAPS §7.1). A smaller stage gets the zoom that fits the largest
   * surface extent instead, down to `minZoomFloor`.
   */
  readonly minZoom?: number;
  /** Never allow zooming out below this, however small the stage (default -7.5). */
  readonly minZoomFloor?: number;
  /** Default 2. */
  readonly maxZoom?: number;
  /** `focus` zooms in to at least this (default -2, a little closer than a zone's native -2.4). */
  readonly focusZoom?: number;
  /** The adapter's own hard cap on canvas paths per surface (default 2,500, as map/layers' default budgets). */
  readonly maxPathsPerSurface?: number;
  /** Hover labels (default true). */
  readonly tooltips?: boolean;
  /** Leaflet's zoom buttons (default true). */
  readonly zoomControl?: boolean;
  /** The yard scale bar (default true). */
  readonly scaleBar?: boolean;
  /** Where User Timing measures go (default the page's `performance`; null for none). */
  readonly performance?: PerformanceLike | null;
  /** A fixed palette; default: read from the container's CSS custom properties (style.ts). */
  readonly palette?: MapPalette;
  /** Observe the container's size with `ResizeObserver` where it exists (default true). */
  readonly observeResize?: boolean;
  /**
   * How far the canvas extends beyond the view on every side, as a fraction of its size (default
   * 0.1, Leaflet's own). It is redrawn in full on every `moveend`: 0.25 redraws 2.25 times the
   * view's area, 0.1 1.44 times (docs/MAPS.md §7.2 has the measured difference).
   */
  readonly rendererPadding?: number;
}

export function createLeafletMapAdapter(options: LeafletMapAdapterOptions): MapAdapter {
  return new LeafletMapAdapter(options);
}

/** Pixels kept free around fitted bounds by default, and around the largest extent when choosing the least zoom. */
const FIT_PADDING_PX = 24;
const ZOOM_SNAP = 0.25;
/** The default `rendererPadding`: Leaflet's own (0.25 before the M3 review, PERF-3). */
const RENDERER_PADDING = 0.1;

/** A glyph marker, polyline or frame rectangle (all canvas paths), or an art image overlay. */
type DrawnLayer = L.Path | L.ImageOverlay;

interface Entry {
  descriptor: MapDescriptor;
  readonly leaflet: DrawnLayer;
  /** The path style last applied (polylines and frames), so an unchanged restyle calls nothing. */
  applied: PathStyle | null;
}

interface LayerState {
  /** The last content's items (every surface). */
  items: readonly MapDescriptor[];
  /** Drawn on the current surface. */
  readonly drawn: Map<string, Entry>;
  /** Ids in draw order (bottom first). */
  order: readonly string[];
  visible: boolean;
  group: L.LayerGroup | null;
  offSurface: number;
  duplicates: number;
  truncated: number;
  skipped: number;
}

interface Owner {
  readonly layer: LayerId;
  readonly id: string;
}

/** The hover emphasis of one highlighted marker: a strong copy of its glyph on top of the selection layer. */
interface Overlay {
  source: MapDescriptor;
  readonly path: GlyphMarker;
}

interface SavedView {
  readonly center: WorldPoint;
  readonly zoom: number;
}

interface PendingFit {
  readonly bounds: WorldBounds;
  readonly options: FitOptions;
}

type Handler = (event: MapEvent) => void;

const CANVAS_LAYERS: readonly LayerId[] = LAYER_IDS.filter((layer) => layer !== 'art');

const leafletLatLng = (point: { readonly x: number; readonly y: number }): L.LatLng => {
  const [lat, lng] = pointToLatLng(point);
  return L.latLng(lat, lng);
};

const leafletBounds = (bounds: WorldBounds): L.LatLngBounds => {
  const [[south, west], [north, east]] = boundsToLatLngBounds(bounds);
  return L.latLngBounds([south, west], [north, east]);
};

function pathOptions(style: PathStyle): L.PathOptions {
  return {
    stroke: style.stroke,
    color: style.color,
    weight: style.weight,
    opacity: style.opacity,
    fill: style.fill,
    fillColor: style.fillColor,
    fillOpacity: style.fillOpacity,
    dashArray: style.dashArray ?? undefined,
    lineCap: style.lineCap,
    lineJoin: style.lineJoin,
  };
}

/** The glyph of a marker or an aggregate. */
function glyphOf(descriptor: MapDescriptor, palette: MapPalette, emphasis?: Emphasis): GlyphSpec | null {
  if (descriptor.type === 'marker') return markerGlyph(descriptor, palette, emphasis);
  if (descriptor.type === 'aggregate') return aggregateGlyph(descriptor, palette, emphasis);
  return null;
}

const pointOf = (descriptor: MapDescriptor): WorldPoint | null =>
  descriptor.type === 'marker' || descriptor.type === 'aggregate' ? descriptor.point : null;

function prefersReducedMotion(container: HTMLElement): boolean {
  const view = container.ownerDocument.defaultView;
  return view !== null && typeof view.matchMedia === 'function' && view.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class LeafletMapAdapter implements MapAdapter {
  private readonly surfaces: ReadonlyMap<SurfaceId, SurfaceInfo>;
  private readonly surfaceOrder: readonly SurfaceId[];
  private readonly preferredMinZoom: number;
  private readonly minZoomFloor: number;
  private readonly maxZoom: number;
  private readonly focusZoom: number;
  private readonly maxPaths: number;
  private readonly tooltips: boolean;
  private readonly zoomControl: boolean;
  private readonly scaleBar: boolean;
  private readonly fixedPalette: MapPalette | null;
  private readonly observeResize: boolean;
  private readonly rendererPadding: number;
  private readonly perf: MapPerf;
  private readonly layers: Record<LayerId, LayerState>;
  private readonly handlers = new Map<MapEventType, Set<Handler>>();
  private readonly owners = new Map<object, Owner>();
  private readonly savedViews = new Map<SurfaceId, SavedView>();
  private readonly pendingFits = new Map<SurfaceId, PendingFit>();
  private readonly overlays = new Map<string, Overlay>();

  private surface: SurfaceId | null;
  private labelProvider: MapLabelProvider | null;
  private map: L.Map | null = null;
  private container: HTMLElement | null = null;
  private canvas: MeasuredCanvas | null = null;
  private grid: GridLayer | null = null;
  private tooltip: L.Tooltip | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private stopColorSchemeListener: (() => void) | null = null;
  private palette: MapPalette | null = null;
  private highlighted: { readonly layer: LayerId; readonly ids: ReadonlySet<string> } | null = null;
  /** A fit requested while the container had no size, applied once it has one. */
  private deferredFit: PendingFit | null = null;

  constructor(options: LeafletMapAdapterOptions) {
    this.surfaces = new Map(options.surfaces.map((surface) => [surface.id, surface]));
    this.surfaceOrder = options.surfaces.map((surface) => surface.id);
    this.surface = options.initialSurface !== null && this.surfaces.has(options.initialSurface) ? options.initialSurface : (this.surfaceOrder[0] ?? null);
    this.labelProvider = options.label ?? null;
    this.preferredMinZoom = options.minZoom ?? -6;
    this.minZoomFloor = Math.min(options.minZoomFloor ?? -7.5, this.preferredMinZoom);
    this.maxZoom = options.maxZoom ?? 2;
    this.focusZoom = options.focusZoom ?? -2;
    this.maxPaths = options.maxPathsPerSurface ?? 2500;
    this.tooltips = options.tooltips ?? true;
    this.zoomControl = options.zoomControl ?? true;
    this.scaleBar = options.scaleBar ?? true;
    this.fixedPalette = options.palette ?? null;
    this.observeResize = options.observeResize ?? true;
    this.rendererPadding = options.rendererPadding ?? RENDERER_PADDING;
    this.perf = createMapPerf(options.performance === undefined ? pagePerformance() : options.performance);
    const layers: Partial<Record<LayerId, LayerState>> = {};
    for (const layer of LAYER_IDS) {
      layers[layer] = {
        items: [],
        drawn: new Map(),
        order: [],
        visible: true,
        group: null,
        offSurface: 0,
        duplicates: 0,
        truncated: 0,
        skipped: 0,
      };
    }
    this.layers = layers as Record<LayerId, LayerState>;
  }

  // ===========================================================================================
  // Lifecycle

  mount(el: MapContainer): void {
    if (this.map !== null) throw new Error('LeafletMapAdapter.mount: already mounted; call destroy() first');
    const host = el as unknown as HTMLElement;
    const container = host.ownerDocument.createElement('div');
    container.className = 'frl-map';
    host.appendChild(container);
    this.container = container;
    this.palette = this.fixedPalette ?? readMapPalette(container);

    const canvas = new MeasuredCanvas({ padding: this.rendererPadding, tolerance: 2 }, this.perf);
    const animate = !prefersReducedMotion(container);
    const map = L.map(container, {
      crs: L.CRS.Simple,
      minZoom: this.preferredMinZoom,
      maxZoom: this.maxZoom,
      zoomSnap: ZOOM_SNAP,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
      attributionControl: false,
      zoomControl: this.zoomControl,
      preferCanvas: true,
      renderer: canvas,
      maxBoundsViscosity: 0.9,
      zoomAnimation: animate,
      fadeAnimation: animate,
      markerZoomAnimation: animate,
      inertia: animate,
    });
    this.map = map;
    this.canvas = canvas;
    const art = map.createPane('frl-art');
    art.style.zIndex = '250';
    art.style.pointerEvents = 'none';
    const gridPane = map.createPane('frl-grid');
    gridPane.style.zIndex = '350';
    gridPane.style.pointerEvents = 'none';
    this.updateMinZoom();

    // A view first, so every layer below is added to a loaded map in layer order.
    const info = this.surface === null ? undefined : this.surfaces.get(this.surface);
    if (info === undefined) map.setView([0, 0], -3, { animate: false });
    else this.applySurfaceView(info);

    for (const layer of LAYER_IDS) {
      const group = layer === 'art' ? L.layerGroup() : L.featureGroup();
      if (group instanceof L.FeatureGroup) this.wireGroup(layer, group);
      const state = this.layers[layer];
      state.group = group;
      if (state.visible) group.addTo(map);
    }
    this.grid = new GridLayer({ pane: 'frl-grid' }, this.palette);
    this.grid.addTo(map);
    this.grid.setSurface(info?.mapId ?? null, info?.extent ?? null);
    if (this.scaleBar) new ScaleBarControl({ position: 'bottomleft' }).addTo(map);
    if (this.tooltips) this.tooltip = L.tooltip({ className: 'frl-map__tooltip', direction: 'top', offset: [0, -10], opacity: 1 });
    if (info !== undefined) map.setMaxBounds(leafletBounds(info.extent).pad(0.5));

    map.on('click', (event: L.LeafletMouseEvent) => {
      const point = this.worldOf(event.latlng);
      if (point !== null) this.emit({ type: 'click', point, hit: null, zones: this.zonesAt(point) });
    });
    map.on('moveend', () => {
      this.rememberView();
      const view = this.getView();
      if (view !== null) this.emit({ type: 'move', view });
    });
    map.on('zoomend', () => {
      const view = this.getView();
      if (view !== null) this.emit({ type: 'zoom', view });
    });

    for (const layer of LAYER_IDS) this.apply(layer);

    const view = host.ownerDocument.defaultView;
    const Observer = view?.ResizeObserver;
    if (this.observeResize && Observer !== undefined) {
      this.resizeObserver = new Observer(() => {
        this.onObservedResize();
      });
      this.resizeObserver.observe(container);
    }
    if (this.fixedPalette === null && view !== null) this.watchTheme(view, host.ownerDocument.documentElement);
  }

  /**
   * Canvas colours come from CSS custom properties, which change with the theme: re-read them when
   * the root's `data-theme` changes (the kit's theme toggle, UI.md §2) or the system colour scheme
   * does. A theme set on some other subtree needs an explicit `refreshTheme()`.
   */
  private watchTheme(view: Window & typeof globalThis, root: HTMLElement): void {
    const refresh = (): void => {
      this.refreshTheme();
    };
    if (typeof view.MutationObserver === 'function') {
      this.themeObserver = new view.MutationObserver(refresh);
      this.themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    }
    const scheme = typeof view.matchMedia === 'function' ? view.matchMedia('(prefers-color-scheme: dark)') : null;
    if (scheme !== null && typeof scheme.addEventListener === 'function') {
      scheme.addEventListener('change', refresh);
      this.stopColorSchemeListener = () => {
        scheme.removeEventListener('change', refresh);
      };
    }
  }

  destroy(): void {
    const map = this.map;
    if (map === null) return;
    this.rememberView();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    this.stopColorSchemeListener?.();
    this.stopColorSchemeListener = null;
    // A debounced resize's moveend (Leaflet 1.9.4 `_sizeTimer`) must not fire on a removed map.
    clearTimeout((map as unknown as { _sizeTimer?: ReturnType<typeof setTimeout> })._sizeTimer);
    map.remove();
    this.container?.remove();
    for (const layer of LAYER_IDS) {
      const state = this.layers[layer];
      state.drawn.clear();
      state.order = [];
      state.group = null;
    }
    this.owners.clear();
    this.overlays.clear();
    this.map = null;
    this.container = null;
    this.canvas = null;
    this.grid = null;
    this.tooltip = null;
    this.deferredFit = null;
  }

  /** Re-measures the container now: the view settles (`moveend`, a `move` event) at once. */
  resize(): void {
    const map = this.map;
    if (map === null) return;
    map.invalidateSize({ pan: false });
    this.afterResize();
  }

  /**
   * A resize seen by the `ResizeObserver` (at most once a frame while a splitter is dragged): the
   * view settles 200 ms after the last one, so the renderer redraws and the controller syncs once
   * rather than every frame (M3 review PERF-5). The canvas padding covers the gap meanwhile.
   */
  private onObservedResize(): void {
    const map = this.map;
    if (map === null) return;
    map.invalidateSize({ pan: false, debounceMoveend: true });
    this.afterResize();
  }

  private afterResize(): void {
    const map = this.map;
    if (map === null) return;
    this.updateMinZoom();
    const fit = this.deferredFit;
    const size = map.getSize();
    if (fit !== null && size.x > 0 && size.y > 0) {
      this.deferredFit = null;
      this.fitNow(fit.bounds, fit.options);
    }
  }

  /** The least zoom that still shows the largest surface extent in this container (`minZoomFor`). */
  private updateMinZoom(): void {
    const map = this.map;
    if (map === null) return;
    const size = map.getSize();
    const zoom = minZoomFor(
      [...this.surfaces.values()].map((surface) => surface.extent),
      size.x,
      size.y,
      { paddingPx: FIT_PADDING_PX, preferred: this.preferredMinZoom, floor: this.minZoomFloor, snap: ZOOM_SNAP },
    );
    if (zoom !== map.getMinZoom()) map.setMinZoom(zoom);
  }

  /** The zoom range the map allows now, or null before mounting (for tests and diagnostics). */
  zoomLimits(): { readonly min: number; readonly max: number } | null {
    const map = this.map;
    return map === null ? null : { min: map.getMinZoom(), max: map.getMaxZoom() };
  }

  refreshTheme(): void {
    if (this.container === null) return;
    this.palette = this.fixedPalette ?? readMapPalette(this.container);
    for (const layer of LAYER_IDS) for (const entry of this.layers[layer].drawn.values()) this.restyle(layer, entry);
    for (const overlay of this.overlays.values()) this.refreshOverlay(overlay, overlay.source);
    this.grid?.setPalette(this.palette);
  }

  setLabelProvider(provider: MapLabelProvider | null): void {
    this.labelProvider = provider;
  }

  // ===========================================================================================
  // Surfaces and views

  getSurface(): SurfaceId | null {
    return this.surface;
  }

  setSurface(surface: SurfaceId): boolean {
    const info = this.surfaces.get(surface);
    if (info === undefined) return false;
    if (surface === this.surface) return true;
    this.rememberView();
    this.surface = surface;
    const map = this.map;
    if (map === null) return true;
    this.closeTooltip();
    this.highlighted = null;
    this.syncHighlight();
    for (const layer of LAYER_IDS) this.clearLayer(layer);
    this.grid?.setSurface(info.mapId, info.extent);
    // The bounds of the previous surface would pull the new view back; lift them while moving.
    map.setMaxBounds();
    this.applySurfaceView(info);
    map.setMaxBounds(leafletBounds(info.extent).pad(0.5));
    for (const layer of LAYER_IDS) this.apply(layer);
    const view = this.getView();
    if (view !== null) this.emit({ type: 'surface', surface, view });
    return true;
  }

  setViewport(viewport: Viewport): boolean {
    const surface = surfaceIdOf(viewport.center.mapId);
    if (!this.setSurface(surface)) return false;
    if (this.map === null) {
      this.pendingFits.delete(surface);
      this.savedViews.set(surface, { center: viewport.center, zoom: viewport.zoom });
      return true;
    }
    this.map.setView(leafletLatLng(viewport.center), viewport.zoom, { animate: false });
    return true;
  }

  fitBounds(bounds: WorldBounds, options: FitOptions = {}): boolean {
    const surface = surfaceIdOf(bounds.mapId);
    if (!this.setSurface(surface)) return false;
    if (this.map === null) {
      this.pendingFits.set(surface, { bounds, options });
      return true;
    }
    this.fitNow(bounds, options);
    return true;
  }

  focus(point: WorldPoint, options: FocusOptions = {}): boolean {
    const surface = surfaceIdOf(point.mapId);
    if (!this.setSurface(surface)) return false;
    const map = this.map;
    if (map === null) {
      this.pendingFits.delete(surface);
      this.savedViews.set(surface, { center: point, zoom: options.zoom ?? this.focusZoom });
      return true;
    }
    const current = map.getZoom();
    const zoom = options.zoom ?? Math.max(current, this.focusZoom);
    const target = leafletLatLng(point);
    if (options.recenter !== true && zoom === current && map.getBounds().pad(-0.2).contains(target)) return true;
    map.setView(target, zoom, { animate: options.animate ?? false });
    return true;
  }

  getView(): MapViewState | null {
    const map = this.map;
    const surface = this.surface;
    if (map === null || surface === null) return null;
    const mapId = surfaceMapId(surface);
    const center = map.getCenter();
    const bounds = map.getBounds();
    const size = map.getSize();
    return {
      surface,
      mapId,
      center: latLngToWorld(center.lat, center.lng, mapId),
      zoom: map.getZoom(),
      bounds: latLngBoundsToWorld(bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast(), mapId),
      widthPx: size.x,
      heightPx: size.y,
    };
  }

  private applySurfaceView(info: SurfaceInfo): void {
    const map = this.map;
    if (map === null) return;
    const fit = this.pendingFits.get(info.id);
    const saved = this.savedViews.get(info.id);
    this.pendingFits.delete(info.id);
    if (fit !== undefined) this.fitNow(fit.bounds, fit.options);
    else if (saved !== undefined) map.setView(leafletLatLng(saved.center), saved.zoom, { animate: false });
    else this.fitNow(info.extent, {});
  }

  private fitNow(bounds: WorldBounds, options: FitOptions): void {
    const map = this.map;
    if (map === null) return;
    const padding = options.paddingPx ?? FIT_PADDING_PX;
    const size = map.getSize();
    // With no size yet (a hidden or unlaid-out container) Leaflet would pick the minimum zoom;
    // fit again once the container has a size (resize()).
    this.deferredFit = size.x === 0 || size.y === 0 ? { bounds, options } : null;
    const target = leafletBounds(bounds);
    const maxZoom = options.maxZoom ?? this.maxZoom;
    const animate = options.animate ?? false;
    const floor = options.minZoom;
    if (floor !== undefined && this.deferredFit === null) {
      const fitted = Math.min(maxZoom, map.getBoundsZoom(target, false, L.point(2 * padding, 2 * padding)));
      if (fitted < floor) {
        // The bounds need more room than the floor allows: centre on them at the floor instead.
        map.setView(target.getCenter(), Math.min(floor, maxZoom), { animate });
        return;
      }
    }
    map.fitBounds(target, { padding: [padding, padding], maxZoom, animate });
  }

  private rememberView(): void {
    const view = this.getView();
    if (view !== null) this.savedViews.set(view.surface, { center: view.center, zoom: view.zoom });
  }

  private currentMapId(): WorldMapId | null {
    return this.surface === null ? null : surfaceMapId(this.surface);
  }

  private worldOf(latlng: L.LatLng): WorldPoint | null {
    const mapId = this.currentMapId();
    return mapId === null ? null : latLngToWorld(latlng.lat, latlng.lng, mapId);
  }

  // ===========================================================================================
  // Layers

  setLayer(layer: LayerId, content: LayerContent): void {
    const state = this.layers[layer];
    if (content.items === state.items) {
      state.skipped += 1;
      return;
    }
    state.items = content.items;
    if (this.map === null) return;
    this.perf.time(
      'frl:map:set-layer',
      () => this.apply(layer),
      (counts) => ({ layer, ...counts }),
    );
  }

  toggleLayer(layer: LayerId, visible: boolean): void {
    const state = this.layers[layer];
    if (state.visible === visible) return;
    state.visible = visible;
    const map = this.map;
    if (map === null || state.group === null) return;
    if (visible) {
      // Its paths join the draw list at the end; move them to their place.
      state.group.addTo(map);
      this.place(layer);
    } else {
      this.closeTooltip();
      map.removeLayer(state.group);
    }
    this.syncHighlight();
  }

  isLayerVisible(layer: LayerId): boolean {
    return this.layers[layer].visible;
  }

  highlight(target: HighlightTarget | null): void {
    const previous = this.highlighted;
    const next = target === null || target.ids.length === 0 ? null : { layer: target.layer, ids: new Set(target.ids) };
    if (previous === next || (previous !== null && next !== null && previous.layer === next.layer && sameData([...previous.ids], [...next.ids]))) return;
    this.highlighted = next;
    // Lines are restyled in place (thicker) and keep their place in the stack.
    for (const current of [previous, next]) {
      if (current === null) continue;
      const state = this.layers[current.layer];
      for (const id of current.ids) {
        const entry = state.drawn.get(id);
        if (entry?.descriptor.type === 'polyline') this.restyle(current.layer, entry);
      }
    }
    this.syncHighlight();
  }

  renderStats(): MapRenderStats {
    const layers: Partial<Record<LayerId, LayerRenderStats>> = {};
    let paths = 0;
    for (const layer of LAYER_IDS) {
      const state = this.layers[layer];
      if (layer !== 'art' && state.visible) paths += state.drawn.size;
      layers[layer] = {
        visible: state.visible,
        drawn: state.drawn.size,
        offSurface: state.offSurface,
        duplicates: state.duplicates,
        truncated: state.truncated,
        skipped: state.skipped,
      };
    }
    return { surface: this.surface, paths, layers: layers as Record<LayerId, LayerRenderStats> };
  }

  /**
   * The canvas paths in draw order, bottom first, as `layer/id` (a highlight overlay as
   * `highlight/<layer>/<id>`): the order the renderer draws and hit-tests in. For tests and diagnostics.
   */
  drawOrder(): readonly string[] {
    const renderer = this.canvas;
    if (renderer === null) return [];
    const overlayNames = new Map<object, string>();
    for (const [key, overlay] of this.overlays) overlayNames.set(overlay.path, `highlight/${key}`);
    return drawOrder(renderer).map((path) => {
      if (typeof path !== 'object' || path === null) return '?';
      const owner = this.owners.get(path);
      return owner === undefined ? (overlayNames.get(path) ?? '?') : `${owner.layer}/${owner.id}`;
    });
  }

  /** Diffs the layer's stored items for the current surface against what is drawn, and applies the difference. */
  private apply(layer: LayerId): { added: number; removed: number; changed: number; moved: number } {
    const state = this.layers[layer];
    const group = state.group;
    const mapId = this.currentMapId();
    if (group === null) return { added: 0, removed: 0, changed: 0, moved: 0 };
    const onSurface = mapId === null ? [] : state.items.filter((descriptor) => descriptorMapId(descriptor) === mapId);
    state.offSurface = state.items.length - onSurface.length;
    const capacity = layer === 'art' ? Infinity : this.maxPaths - this.pathsOutside(layer);
    const { kept, dropped } = capItems(onSurface, capacity);
    state.truncated = dropped;
    const previous = new Map<string, MapDescriptor>();
    for (const [id, entry] of state.drawn) previous.set(id, entry.descriptor);
    const diff = diffById(previous, kept);
    state.duplicates = diff.duplicates.length;
    for (const id of diff.removed) this.removeEntry(layer, id);
    for (const { previous: old, next } of diff.changed) {
      const entry = state.drawn.get(next.id);
      if (entry === undefined) continue;
      if (old.type === next.type) this.update(layer, entry, next);
      else {
        this.removeEntry(layer, next.id);
        this.create(layer, next);
      }
    }
    for (const descriptor of diff.added) this.create(layer, descriptor);
    state.order = diff.order.map((descriptor) => descriptor.id);
    const moved = this.place(layer);
    if (this.highlighted?.layer === layer) this.syncHighlight();
    return { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length, moved };
  }

  /**
   * Puts the layer's paths in its order, just after the topmost path of the visible layers below:
   * a created path (appended at the top by Leaflet) or one whose place changed is moved, redrawing
   * only its own area; paths already in place are not touched. Returns how many moved.
   */
  private place(layer: LayerId): number {
    const renderer = this.canvas;
    const state = this.layers[layer];
    if (renderer === null || layer === 'art' || !state.visible) return 0;
    let previous = this.topPathBelow(layer);
    let moved = 0;
    for (const id of state.order) {
      const leaflet = state.drawn.get(id)?.leaflet;
      if (!(leaflet instanceof L.Path)) continue;
      if (placeAfter(renderer, leaflet, previous)) moved += 1;
      previous = leaflet;
    }
    return moved;
  }

  /** The topmost path of the visible canvas layers below `layer`, or null when there is none. */
  private topPathBelow(layer: LayerId): L.Path | null {
    for (let i = CANVAS_LAYERS.indexOf(layer) - 1; i >= 0; i -= 1) {
      const below = CANVAS_LAYERS[i];
      if (below === undefined) continue;
      const state = this.layers[below];
      if (!state.visible) continue;
      for (let j = state.order.length - 1; j >= 0; j -= 1) {
        const leaflet = state.drawn.get(state.order[j] ?? '')?.leaflet;
        if (leaflet instanceof L.Path) return leaflet;
      }
    }
    return null;
  }

  private pathsOutside(layer: LayerId): number {
    let total = 0;
    for (const other of CANVAS_LAYERS) if (other !== layer) total += this.layers[other].drawn.size;
    return total;
  }

  private clearLayer(layer: LayerId): void {
    const state = this.layers[layer];
    for (const id of [...state.drawn.keys()]) this.removeEntry(layer, id);
    state.order = [];
  }

  private removeEntry(layer: LayerId, id: string): void {
    const state = this.layers[layer];
    const entry = state.drawn.get(id);
    if (entry === undefined) return;
    state.group?.removeLayer(entry.leaflet);
    this.owners.delete(entry.leaflet);
    state.drawn.delete(id);
  }

  private isHighlighted(layer: LayerId, id: string): boolean {
    return this.highlighted !== null && this.highlighted.layer === layer && this.highlighted.ids.has(id);
  }

  /** A highlighted line is drawn strong in place; markers keep their own emphasis (their highlight is an overlay). */
  private emphasisOf(layer: LayerId, descriptor: MapDescriptor): Emphasis {
    if (descriptor.type === 'art') return 'normal';
    if (descriptor.type === 'polyline' && this.isHighlighted(layer, descriptor.id)) return 'strong';
    return descriptor.emphasis;
  }

  private create(layer: LayerId, descriptor: MapDescriptor): void {
    const state = this.layers[layer];
    const palette = this.palette;
    const renderer = this.canvas;
    if (state.group === null || palette === null || renderer === null) return;
    const interactive = { renderer, interactive: true, bubblingMouseEvents: false };
    let leaflet: DrawnLayer;
    let applied: PathStyle | null = null;
    switch (descriptor.type) {
      case 'marker':
        leaflet = new GlyphMarker(leafletLatLng(descriptor.point), markerGlyph(descriptor, palette), interactive);
        break;
      case 'aggregate':
        leaflet = new GlyphMarker(leafletLatLng(descriptor.point), aggregateGlyph(descriptor, palette), interactive);
        break;
      case 'polyline':
        applied = polylineStyle(descriptor.style, this.emphasisOf(layer, descriptor), palette);
        leaflet = L.polyline(descriptor.points.map(leafletLatLng), { ...interactive, ...pathOptions(applied), smoothFactor: 1 });
        break;
      case 'frame':
        applied = frameStyle(descriptor.kind, descriptor.emphasis, palette);
        leaflet = new FrameRectangle(leafletBounds(descriptor.bounds), descriptor.label, { color: palette.frameLabel, font: palette.font }, {
          renderer,
          interactive: false,
          ...pathOptions(applied),
        });
        break;
      case 'art':
        leaflet = L.imageOverlay(descriptor.url, leafletBounds(descriptor.bounds), {
          pane: 'frl-art',
          opacity: descriptor.opacity,
          interactive: false,
          alt: '',
          className: 'frl-map__art',
        });
        break;
    }
    state.drawn.set(descriptor.id, { descriptor, leaflet, applied });
    this.owners.set(leaflet, { layer, id: descriptor.id });
    state.group.addLayer(leaflet);
  }

  /**
   * Updates a drawn item in place, calling Leaflet only for what changed: its position or shape,
   * then its glyph or style. A descriptor whose label or ref alone changed (a step renumbered by an
   * insert elsewhere) costs no canvas work.
   */
  private update(layer: LayerId, entry: Entry, next: MapDescriptor): void {
    const leaflet = entry.leaflet;
    const previous = entry.descriptor;
    entry.descriptor = next;
    switch (next.type) {
      case 'marker':
      case 'aggregate': {
        const palette = this.palette;
        if (!(leaflet instanceof GlyphMarker) || palette === null) return;
        const before = pointOf(previous);
        const moved = before === null || !sameData(before, next.point);
        const spec = glyphOf(next, palette);
        if (spec !== null && !sameData(spec, leaflet.spec)) leaflet.setSpec(spec, !moved);
        if (moved) leaflet.setLatLng(leafletLatLng(next.point));
        return;
      }
      case 'polyline':
        if (leaflet instanceof L.Polyline && (previous.type !== 'polyline' || !sameData(previous.points, next.points))) {
          leaflet.setLatLngs(next.points.map(leafletLatLng));
        }
        break;
      case 'frame':
        if (leaflet instanceof FrameRectangle && (previous.type !== 'frame' || !sameData(previous.bounds, next.bounds))) {
          leaflet.setBounds(leafletBounds(next.bounds));
        }
        break;
      case 'art':
        if (leaflet instanceof L.ImageOverlay) {
          const old = previous.type === 'art' ? previous : null;
          if (old?.url !== next.url) leaflet.setUrl(next.url);
          if (old === null || !sameData(old.bounds, next.bounds)) leaflet.setBounds(leafletBounds(next.bounds));
          if (old?.opacity !== next.opacity) leaflet.setOpacity(next.opacity);
        }
        return;
    }
    this.restyle(layer, entry);
  }

  /** Applies the item's current glyph or style (palette, emphasis, highlight) when it differs from what is drawn. */
  private restyle(layer: LayerId, entry: Entry): void {
    const palette = this.palette;
    if (palette === null) return;
    const descriptor = entry.descriptor;
    const leaflet = entry.leaflet;
    switch (descriptor.type) {
      case 'marker':
      case 'aggregate': {
        const spec = glyphOf(descriptor, palette);
        if (leaflet instanceof GlyphMarker && spec !== null && !sameData(spec, leaflet.spec)) leaflet.setSpec(spec);
        return;
      }
      case 'polyline': {
        const style = polylineStyle(descriptor.style, this.emphasisOf(layer, descriptor), palette);
        if (leaflet instanceof L.Polyline && !sameData(style, entry.applied)) {
          leaflet.setStyle(pathOptions(style));
          entry.applied = style;
        }
        return;
      }
      case 'frame': {
        if (!(leaflet instanceof FrameRectangle)) return;
        const style = frameStyle(descriptor.kind, descriptor.emphasis, palette);
        if (!sameData(style, entry.applied)) {
          leaflet.setStyle(pathOptions(style));
          entry.applied = style;
        }
        leaflet.setLabel(descriptor.label, { color: palette.frameLabel, font: palette.font });
        return;
      }
      case 'art':
        return;
    }
  }

  // ===========================================================================================
  // Highlight overlays

  /**
   * Brings the hover overlays in line with `highlighted`: one strong copy of each highlighted
   * marker or aggregate of a visible layer, drawn on top of the `selection` layer (created last,
   * so above every layer's paths, which are always placed below it). Lines are restyled in place
   * instead (`highlight`).
   */
  private syncHighlight(): void {
    const target = this.highlighted;
    const wanted = new Map<string, MapDescriptor>();
    if (target !== null && this.layers[target.layer].visible) {
      for (const id of target.ids) {
        const descriptor = this.layers[target.layer].drawn.get(id)?.descriptor;
        if (descriptor?.type === 'marker' || descriptor?.type === 'aggregate') wanted.set(`${target.layer}/${id}`, descriptor);
      }
    }
    const group = this.layers.selection.group;
    for (const [key, overlay] of this.overlays) {
      if (wanted.has(key)) continue;
      group?.removeLayer(overlay.path);
      this.overlays.delete(key);
    }
    const palette = this.palette;
    const renderer = this.canvas;
    if (group === null || palette === null || renderer === null) return;
    for (const [key, descriptor] of wanted) {
      const existing = this.overlays.get(key);
      if (existing !== undefined) {
        if (existing.source !== descriptor) this.refreshOverlay(existing, descriptor);
        continue;
      }
      const spec = glyphOf(descriptor, palette, 'strong');
      const point = pointOf(descriptor);
      if (spec === null || point === null) continue;
      const path = new GlyphMarker(leafletLatLng(point), spec, { renderer, interactive: false });
      group.addLayer(path);
      this.overlays.set(key, { source: descriptor, path });
    }
  }

  private refreshOverlay(overlay: Overlay, descriptor: MapDescriptor): void {
    const palette = this.palette;
    const point = pointOf(descriptor);
    if (palette === null || point === null) return;
    const before = pointOf(overlay.source);
    overlay.source = descriptor;
    const moved = before === null || !sameData(before, point);
    const spec = glyphOf(descriptor, palette, 'strong');
    if (spec !== null && !sameData(spec, overlay.path.spec)) overlay.path.setSpec(spec, !moved);
    if (moved) overlay.path.setLatLng(leafletLatLng(point));
  }

  // ===========================================================================================
  // Events

  on<E extends MapEventType>(type: E, handler: (event: Extract<MapEvent, { readonly type: E }>) => void): () => void {
    const set = this.handlers.get(type) ?? new Set<Handler>();
    this.handlers.set(type, set);
    const wrapped = handler as Handler;
    set.add(wrapped);
    return () => {
      set.delete(wrapped);
    };
  }

  private emit(event: MapEvent): void {
    const set = this.handlers.get(event.type);
    if (set === undefined) return;
    for (const handler of [...set]) handler(event);
  }

  private wireGroup(layer: LayerId, group: L.FeatureGroup): void {
    group.on('click', (event: L.LeafletMouseEvent) => {
      const hit = this.hitOf(event);
      const point = this.worldOf(event.latlng);
      if (hit === null || point === null) return;
      this.emit({ type: 'click', point, hit: { ...hit, segment: this.segmentOf(hit, point) }, zones: this.zonesAt(point) });
    });
    group.on('mouseover', (event: L.LeafletMouseEvent) => {
      const hit = this.hitOf(event);
      const point = this.worldOf(event.latlng);
      if (hit === null || point === null) return;
      const full: MapHit = { ...hit, segment: this.segmentOf(hit, point) };
      this.showTooltip(layer, full.id, event.latlng);
      this.emit({ type: 'hover', point, hit: full });
    });
    group.on('mouseout', () => {
      this.closeTooltip();
      this.emit({ type: 'hover', point: null, hit: null });
    });
  }

  private hitOf(event: L.LeafletEvent): Omit<MapHit, 'segment'> | null {
    const source: unknown = event.propagatedFrom;
    if (typeof source !== 'object' || source === null) return null;
    const owner = this.owners.get(source);
    if (owner === undefined) return null;
    const entry = this.layers[owner.layer].drawn.get(owner.id);
    if (entry === undefined) return null;
    return { layer: owner.layer, id: owner.id, ref: entry.descriptor.ref, refs: refsOf(entry.descriptor) };
  }

  private segmentOf(hit: Omit<MapHit, 'segment'>, point: WorldPoint): number | null {
    const descriptor = this.layers[hit.layer].drawn.get(hit.id)?.descriptor;
    return descriptor?.type === 'polyline' ? nearestSegment(descriptor.points, point) : null;
  }

  private zonesAt(point: WorldPoint): readonly UiMapId[] {
    const frames: FrameDescriptor[] = [];
    for (const entry of this.layers['zone-frames'].drawn.values()) if (entry.descriptor.type === 'frame') frames.push(entry.descriptor);
    return zonesAt(frames, point);
  }

  private showTooltip(layer: LayerId, id: string, at: L.LatLng): void {
    const map = this.map;
    const tooltip = this.tooltip;
    const descriptor = this.layers[layer].drawn.get(id)?.descriptor;
    if (map === null || tooltip === null || descriptor === undefined) return;
    const label = descriptor.type === 'art' ? null : labelOf(descriptor, this.labelProvider);
    if (label === null) {
      this.closeTooltip();
      return;
    }
    const text = map.getContainer().ownerDocument.createElement('span');
    text.textContent = label;
    const point = pointOf(descriptor);
    tooltip.setContent(text).setLatLng(point === null ? at : leafletLatLng(point));
    map.openTooltip(tooltip);
  }

  private closeTooltip(): void {
    if (this.map !== null && this.tooltip !== null) this.map.closeTooltip(this.tooltip);
  }
}
