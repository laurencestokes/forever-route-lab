import * as L from 'leaflet';
import type { WorldMapId } from '../../domain/ids';
import type { WorldBounds } from '../adapter';
import { drawGlyph } from './glyphs';
import type { MapPerf } from './perf';
import { glyphExtent, glyphHitRadius, type GlyphSpec, type MapPalette } from './style';
import { gridLabel, gridLinesIn, gridSpacingAt, latLngBoundsToWorld, scaleBarAt, worldToLatLng } from './transform';

/**
 * The Leaflet classes behind `LeafletMapAdapter` (docs/MAPS.md §7). Leaflet is pinned to exactly
 * 1.9.4 (package.json), and these classes use a few of its canvas renderer's internals, named in
 * the interfaces below: the renderer's `_ctx`, `_drawing`, `_postponeUpdatePaths`, `_redraw`,
 * `_updatePaths`, `_draw`, `_fillStroke`, `_requestRedraw` and its draw list (`_drawFirst`,
 * `_drawLast`, a path's `_order`), and a path's `_renderer`, `_point`, `_radius`, `_pxBounds`,
 * `_updateBounds`, `_clickTolerance` and `_empty`. A Leaflet upgrade must re-check them.
 *
 * Hit-testing stays Leaflet's: the canvas renderer tests every interactive path with
 * `_containsPoint` (a circle of the hit radius for glyphs) and fires the path's events.
 */

/**
 * A node of Leaflet 1.9.4's canvas draw list (a doubly linked list, drawn and hit-tested first to
 * last). Leaflet leaves an end's link `undefined` or `null`; both mean none.
 */
interface DrawNode {
  readonly layer: unknown;
  prev: DrawNode | null | undefined;
  next: DrawNode | null | undefined;
}

/** Leaflet 1.9.4 `L.Canvas` internals. */
interface CanvasInternals {
  readonly _ctx: CanvasRenderingContext2D | null | undefined;
  readonly _drawing: boolean | undefined;
  readonly _postponeUpdatePaths: boolean | undefined;
  _redrawRequest: number | null | undefined;
  _drawFirst: DrawNode | null | undefined;
  _drawLast: DrawNode | null | undefined;
  _redraw(): void;
  _updatePaths(): void;
  _draw(): void;
  _fillStroke(ctx: CanvasRenderingContext2D, layer: L.Path): void;
  _requestRedraw(layer: L.Path): void;
}

/** Leaflet 1.9.4 `L.CircleMarker` / `L.Polyline` internals. */
interface PathInternals {
  readonly _renderer: CanvasInternals | undefined;
  readonly _point: L.Point | undefined;
  readonly _radius: number;
  _pxBounds: L.Bounds | undefined;
  readonly _order: DrawNode | undefined;
  _empty(): boolean;
  _clickTolerance(): number;
}

/** A path's options as the canvas renderer keeps them (`_dashArray` is the parsed `dashArray`). */
interface RendererPathOptions {
  readonly stroke?: boolean;
  readonly weight?: number;
  readonly _dashArray?: readonly number[] | null;
}

const canvasPrototype = L.Canvas.prototype as unknown as CanvasInternals;
const rectanglePrototype = L.Rectangle.prototype as unknown as { _updatePath(this: unknown): void };

/** The drawing context while the renderer is drawing, else null. */
function drawingContext(path: PathInternals): CanvasRenderingContext2D | null {
  const renderer = path._renderer;
  if (renderer === undefined || renderer._drawing !== true) return null;
  return renderer._ctx ?? null;
}

/**
 * `L.Canvas` with User Timing measures around its full update and every redraw (perf.ts), two
 * guards for Leaflet 1.9.4's redraw scheduling, and the dash tracking glyphs use.
 *
 * - A synchronous redraw (on `moveend` or a view reset) clears `_redrawRequest` without cancelling
 *   the animation frame already requested, so that frame redraws again later, or, when the map was
 *   removed in between (a React StrictMode remount, a quick unmount), runs on a destroyed renderer
 *   and throws on its deleted context. The pending frame is cancelled before every redraw, and a
 *   redraw without a context does nothing.
 * - `frl:map:update-paths` is recorded only for real updates: Leaflet postpones the ones between
 *   `viewprereset` and `viewreset` (they return at once), and measuring them would skew a median.
 * - `frlLineDashed` says whether the context may have a dash pattern set in the current draw pass:
 *   Leaflet sets one on every path it strokes and leaves it there, so glyphs clear it only then.
 */
export class MeasuredCanvas extends L.Canvas {
  private readonly frlPerf: MapPerf;
  frlLineDashed = false;

  constructor(options: L.RendererOptions, perf: MapPerf) {
    super(options);
    this.frlPerf = perf;
  }

  _updatePaths(): void {
    if ((this as unknown as CanvasInternals)._postponeUpdatePaths === true) {
      canvasPrototype._updatePaths.call(this);
      return;
    }
    this.frlPerf.time('frl:map:update-paths', () => {
      canvasPrototype._updatePaths.call(this);
    });
  }

  _redraw(): void {
    const self = this as unknown as CanvasInternals;
    const pending = self._redrawRequest;
    if (pending !== null && pending !== undefined) L.Util.cancelAnimFrame(pending);
    if (self._ctx === null || self._ctx === undefined) {
      self._redrawRequest = null;
      return;
    }
    this.frlPerf.time('frl:map:redraw', () => {
      canvasPrototype._redraw.call(this);
    });
  }

  _draw(): void {
    // A draw pass starts from the saved base state, which has no dash pattern.
    this.frlLineDashed = false;
    canvasPrototype._draw.call(this);
  }

  _fillStroke(ctx: CanvasRenderingContext2D, layer: L.Path): void {
    canvasPrototype._fillStroke.call(this, ctx, layer);
    const options = layer.options as RendererPathOptions;
    if (options.stroke === true && options.weight !== 0) this.frlLineDashed = (options._dashArray?.length ?? 0) > 0;
  }
}

/**
 * Moves `path` to just after `after` in the canvas draw list (first when `after` is null), the
 * order in which the renderer draws and hit-tests. Only the path's own area is redrawn, unlike
 * `bringToFront`, whose calls add up to a whole-canvas redraw when a layer is restacked (M3 review
 * PERF-1). True when it moved; false when it was already there or either path is not on the canvas.
 */
export function placeAfter(renderer: L.Canvas, path: L.Path, after: L.Path | null): boolean {
  const list = renderer as unknown as CanvasInternals;
  const node = (path as unknown as PathInternals)._order;
  const anchor = after === null ? null : ((after as unknown as PathInternals)._order ?? undefined);
  if (node === undefined || anchor === undefined || anchor === node) return false;
  const prev = node.prev ?? null;
  const next = node.next ?? null;
  if (prev === anchor) return false;
  // Unlink.
  if (prev === null) list._drawFirst = next;
  else prev.next = next;
  if (next === null) list._drawLast = prev;
  else next.prev = prev;
  // Link after the anchor (first when there is none).
  const following = anchor === null ? (list._drawFirst ?? null) : (anchor.next ?? null);
  node.prev = anchor;
  node.next = following;
  if (anchor === null) list._drawFirst = node;
  else anchor.next = node;
  if (following === null) list._drawLast = node;
  else following.prev = node;
  list._requestRedraw(path);
  return true;
}

/** The paths in the renderer's draw list, first (bottom) to last (top). For tests and diagnostics. */
export function drawOrder(renderer: L.Canvas): readonly unknown[] {
  const out: unknown[] = [];
  for (let node = (renderer as unknown as CanvasInternals)._drawFirst ?? null; node !== null; node = node.next ?? null) out.push(node.layer);
  return out;
}

/**
 * A canvas glyph (glyphs.ts) as a Leaflet `CircleMarker`: Leaflet projects it, culls it off
 * screen and hit-tests it as a circle of `glyphHitRadius`; the draw hook paints the glyph instead
 * of a circle. Its canvas bounds cover the whole glyph, badges included (`glyphExtent`), so a
 * redraw that clears part of a glyph always redraws all of it; the stroke itself is off.
 */
export class GlyphMarker extends L.CircleMarker {
  private frlSpec: GlyphSpec;

  constructor(latlng: L.LatLngExpression, spec: GlyphSpec, options: L.CircleMarkerOptions) {
    super(latlng, { ...options, radius: glyphHitRadius(spec), stroke: false, fill: false, weight: 0 });
    this.frlSpec = spec;
  }

  get spec(): GlyphSpec {
    return this.frlSpec;
  }

  /** Replaces the glyph; `redraw` false when a `setLatLng` follows, so the marker is updated once. */
  setSpec(spec: GlyphSpec, redraw = true): void {
    this.frlSpec = spec;
    const radius = glyphHitRadius(spec);
    if (redraw) {
      this.setRadius(radius);
      return;
    }
    this.options.radius = radius;
    (this as unknown as { _radius: number })._radius = radius;
  }

  _updateBounds(): void {
    const self = this as unknown as PathInternals;
    const point = self._point;
    if (point === undefined) return;
    const extent = Math.max(glyphExtent(this.frlSpec), self._radius + self._clickTolerance());
    self._pxBounds = L.bounds(point.subtract([extent, extent]), point.add([extent, extent]));
  }

  _updatePath(): void {
    const self = this as unknown as PathInternals;
    const ctx = drawingContext(self);
    const point = self._point;
    if (ctx === null || point === undefined || self._empty()) return;
    const renderer = self._renderer;
    const measured = renderer instanceof MeasuredCanvas ? renderer : null;
    drawGlyph(ctx, point.x, point.y, this.frlSpec, measured?.frlLineDashed ?? true);
    if (measured !== null) measured.frlLineDashed = false;
  }
}

export interface FrameLabelStyle {
  readonly color: string;
  readonly font: string;
}

/** A zone frame: Leaflet's rectangle plus its label, centred, drawn only when the frame is wide enough on screen. */
export class FrameRectangle extends L.Rectangle {
  private frlLabel: string | null;
  private frlLabelStyle: FrameLabelStyle;

  constructor(bounds: L.LatLngBoundsExpression, label: string | null, labelStyle: FrameLabelStyle, options: L.PolylineOptions) {
    super(bounds, options);
    this.frlLabel = label;
    this.frlLabelStyle = labelStyle;
  }

  /** Sets the label; redraws only when it or its style changed. */
  setLabel(label: string | null, labelStyle: FrameLabelStyle): void {
    if (label === this.frlLabel && labelStyle.color === this.frlLabelStyle.color && labelStyle.font === this.frlLabelStyle.font) return;
    this.frlLabel = label;
    this.frlLabelStyle = labelStyle;
    this.redraw();
  }

  _updatePath(): void {
    rectanglePrototype._updatePath.call(this);
    const self = this as unknown as PathInternals;
    const ctx = drawingContext(self);
    const bounds = self._pxBounds;
    const label = this.frlLabel;
    const min = bounds?.min;
    const max = bounds?.max;
    if (ctx === null || min === undefined || max === undefined || label === null || label === '') return;
    const width = max.x - min.x;
    const height = max.y - min.y;
    ctx.save();
    ctx.font = `500 12px ${this.frlLabelStyle.font}`;
    const textWidth = ctx.measureText(label).width;
    if (width >= textWidth + 12 && height >= 20) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = this.frlLabelStyle.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, (min.x + max.x) / 2, (min.y + max.y) / 2);
    }
    ctx.restore();
  }
}

/**
 * The grid redraws once per settled view. Leaflet fires `moveend` after every pan, zoom, view reset
 * (before `viewreset`, in the same call) and debounced resize, so it is the only event needed.
 */
const GRID_EVENTS = 'moveend';

/**
 * The procedural yard grid (MAPS §8.1): its own canvas in a pane below the paths, redrawn when the
 * view settles and hidden during zoom animation. Lines of constant world X run east-west, lines of
 * constant world Y run north-south; both are labelled with their axis, yard value and direction
 * (`X 500 (N)`, `Y −4100 (W)`) along the view's top and left edges, and clipped to the surface
 * extent. It is not interactive. The backing store is reallocated only when the size or the pixel
 * ratio changes.
 */
export class GridLayer extends L.Layer {
  private frlMap: L.Map | null = null;
  private frlCanvas: HTMLCanvasElement | null = null;
  private frlMapId: WorldMapId | null = null;
  private frlExtent: WorldBounds | null = null;
  private frlPalette: MapPalette;
  private frlRedraws = 0;
  private frlAllocations = 0;
  private readonly frlRedraw = (): void => {
    this.redraw();
  };

  constructor(options: L.LayerOptions, palette: MapPalette) {
    super(options);
    // L.Layer has no initialize(), so the constructor does not take options by itself.
    L.Util.setOptions(this, options);
    this.frlPalette = palette;
  }

  override onAdd(map: L.Map): this {
    this.frlMap = map;
    const canvas = map.getContainer().ownerDocument.createElement('canvas');
    canvas.className = 'frl-map__grid leaflet-zoom-hide';
    canvas.style.pointerEvents = 'none';
    this.getPane()?.appendChild(canvas);
    this.frlCanvas = canvas;
    map.on(GRID_EVENTS, this.frlRedraw);
    this.redraw();
    return this;
  }

  override onRemove(map: L.Map): this {
    map.off(GRID_EVENTS, this.frlRedraw);
    this.frlCanvas?.remove();
    this.frlCanvas = null;
    this.frlMap = null;
    return this;
  }

  setSurface(mapId: WorldMapId | null, extent: WorldBounds | null): void {
    this.frlMapId = mapId;
    this.frlExtent = extent;
    this.redraw();
  }

  setPalette(palette: MapPalette): void {
    this.frlPalette = palette;
    this.redraw();
  }

  /** Redraws and backing-store allocations so far, for tests. */
  counts(): { readonly redraws: number; readonly allocations: number } {
    return { redraws: this.frlRedraws, allocations: this.frlAllocations };
  }

  redraw(): void {
    const map = this.frlMap;
    const canvas = this.frlCanvas;
    if (map === null || canvas === null) return;
    this.frlRedraws += 1;
    const size = map.getSize();
    const ratio = map.getContainer().ownerDocument.defaultView?.devicePixelRatio ?? 1;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    const width = Math.max(0, Math.round(size.x * ratio));
    const height = Math.max(0, Math.round(size.y * ratio));
    // Assigning width or height reallocates and clears the backing store: do it only on a change.
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${String(size.x)}px`;
      canvas.style.height = `${String(size.y)}px`;
      this.frlAllocations += 1;
    }
    const ctx = canvas.getContext('2d');
    const mapId = this.frlMapId;
    if (ctx === null) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    if (mapId === null || size.x === 0 || size.y === 0) return;
    const view = map.getBounds();
    const visible = latLngBoundsToWorld(view.getSouth(), view.getWest(), view.getNorth(), view.getEast(), mapId);
    const spacing = gridSpacingAt(map.getZoom(), 96);
    if (spacing === null) return;
    const lines = gridLinesIn(visible, this.frlExtent, spacing);
    if (lines === null) return;
    const toScreen = (x: number, y: number): L.Point => map.latLngToContainerPoint(worldToLatLng(x, y) as [number, number]);
    const { area } = lines;
    ctx.strokeStyle = this.frlPalette.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const x of lines.xs) {
      const a = toScreen(x, area.yMax);
      const b = toScreen(x, area.yMin);
      const py = Math.round(a.y) + 0.5;
      ctx.moveTo(a.x, py);
      ctx.lineTo(b.x, py);
    }
    for (const y of lines.ys) {
      const a = toScreen(area.xMax, y);
      const b = toScreen(area.xMin, y);
      const px = Math.round(a.x) + 0.5;
      ctx.moveTo(px, a.y);
      ctx.lineTo(px, b.y);
    }
    ctx.stroke();
    ctx.fillStyle = this.frlPalette.gridLabel;
    ctx.font = `10px ${this.frlPalette.font}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const topLeft = toScreen(area.xMax, area.yMax);
    const labelY = Math.max(4, topLeft.y + 4);
    const labelX = Math.max(4, topLeft.x + 4);
    for (const y of lines.ys) {
      const px = Math.round(toScreen(area.xMax, y).x);
      if (px > labelX + 64 && px < size.x - 64) ctx.fillText(gridLabel('Y', y), px + 3, labelY);
    }
    for (const x of lines.xs) {
      const py = Math.round(toScreen(x, area.yMax).y);
      if (py > labelY + 16 && py < size.y - 12) ctx.fillText(gridLabel('X', x), labelX, py + 3);
    }
  }
}

/** A yard scale bar (Leaflet's own scale control would say metres and feet). */
export class ScaleBarControl extends L.Control {
  private frlMap: L.Map | null = null;
  private frlBar: HTMLElement | null = null;
  private frlText: HTMLElement | null = null;
  private readonly frlMaxWidth: number;
  private readonly frlUpdate = (): void => {
    this.update();
  };

  constructor(options: L.ControlOptions, maxWidthPx = 120) {
    super(options);
    this.frlMaxWidth = maxWidthPx;
  }

  override onAdd(map: L.Map): HTMLElement {
    this.frlMap = map;
    const container = L.DomUtil.create('div', 'frl-map__scale');
    container.setAttribute('aria-hidden', 'true');
    this.frlBar = L.DomUtil.create('div', 'frl-map__scale-bar', container);
    this.frlText = L.DomUtil.create('span', 'frl-map__scale-text', container);
    map.on('zoomend moveend', this.frlUpdate);
    this.update();
    return container;
  }

  override onRemove(map: L.Map): void {
    map.off('zoomend moveend', this.frlUpdate);
    this.frlMap = null;
  }

  update(): void {
    const map = this.frlMap;
    if (map === null || this.frlBar === null || this.frlText === null) return;
    const bar = scaleBarAt(map.getZoom(), this.frlMaxWidth);
    this.frlBar.style.width = bar === null ? '0px' : `${String(Math.round(bar.widthPx))}px`;
    this.frlText.textContent = bar === null ? '' : bar.text;
  }

  /** The text shown, for tests. */
  text(): string {
    return this.frlText?.textContent ?? '';
  }
}
