import * as L from 'leaflet';
import type { WorldMapId } from '../../domain/ids';
import type { WorldBounds } from '../adapter';
import { drawGlyph } from './glyphs';
import type { MapPerf } from './perf';
import { drawPin, specExtent, targetContains, type PathMaker, type PinBitmap, type PinPalette, type PinSpec } from './pins';
import { glyphExtent, glyphHitRadius, type GlyphSpec, type LineHalo, type MapPalette } from './style';
import { gridLabel, gridLinesIn, gridSpacingAt, latLngBoundsOnMap, placedLatLng, scaleBarAt, type Translation } from './transform';

/**
 * The Leaflet classes behind `LeafletMapAdapter` (docs/MAPS.md §7). Leaflet is pinned to exactly
 * 1.9.4 (package.json), and these classes use a few of its canvas renderer's internals, named in
 * the interfaces below: the renderer's `_ctx`, `_drawing`, `_postponeUpdatePaths`, `_redraw`,
 * `_updatePaths`, `_draw`, `_fillStroke`, `_requestRedraw` and its draw list (`_drawFirst`,
 * `_drawLast`, a path's `_order`), and a path's `_renderer`, `_point`, `_radius`, `_pxBounds`,
 * `_updateBounds`, `_clickTolerance` and `_empty`, and a polyline's `_parts` (`AreaOutline`'s halo).
 * A Leaflet upgrade must re-check them (labels-canvas.ts names the renderer internals it uses).
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
  _postponeUpdatePaths: boolean | undefined;
  _redrawRequest: number | null | undefined;
  /** The area a pending redraw covers (Leaflet 1.9.4 `_extendRedrawBounds`). */
  _redrawBounds?: L.Bounds | null | undefined;
  _drawFirst: DrawNode | null | undefined;
  _drawLast: DrawNode | null | undefined;
  readonly _map: (L.Map & { readonly _animatingZoom?: boolean }) | undefined;
  readonly _bounds: L.Bounds | undefined;
  readonly _container: HTMLCanvasElement | undefined;
  readonly _zoom: number | undefined;
  _redraw(): void;
  _updatePaths(): void;
  _update(): void;
  _reset(): void;
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
  readonly _map: L.Map | undefined;
  /** A polyline's projected bounds before the click tolerance (Leaflet 1.9.4 `Polyline._rawPxBounds`). */
  readonly _rawPxBounds?: L.Bounds | undefined;
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
const rendererPrototype = L.Renderer.prototype as unknown as { _update(this: unknown): void };
const rectanglePrototype = L.Rectangle.prototype as unknown as { _updatePath(this: unknown): void };
const polylinePrototype = L.Polyline.prototype as unknown as { _updatePath(this: unknown): void; _updateBounds(this: unknown): void };

/** The drawing context while the renderer is drawing, else null. */
function drawingContext(path: PathInternals): CanvasRenderingContext2D | null {
  const renderer = path._renderer;
  if (renderer === undefined || renderer._drawing !== true) return null;
  return renderer._ctx ?? null;
}

/**
 * `L.Canvas` with User Timing measures around its full update and every redraw (perf.ts), two
 * guards for Leaflet 1.9.4's redraw scheduling, the dash tracking glyphs use, and (with the
 * smooth wheel, map-atlas.md §8.4) the backing store at the device's pixel ratio and a mid-gesture
 * refresh.
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
 * - With a `pixelRatio` (the smooth wheel), `_update` sizes the backing store by it (the device's
 *   ratio capped at 2) instead of Leaflet's fixed 2x on any ratio above 1: at DPR 1.5, 43.75 %
 *   fewer pixels per redraw. Without one, Leaflet's own `_update` runs unchanged.
 * - `frlRefresh()` re-renders at the current view mid-gesture through the renderer's `_reset()`,
 *   as a view reset does (`_postponeUpdatePaths` first, so paths are projected before the one
 *   redraw); `frlLastDrawMs` is how long the last full update or refresh took.
 */
export class MeasuredCanvas extends L.Canvas {
  private readonly frlPerf: MapPerf;
  private readonly frlPixelRatio: (() => number) | null;
  private readonly frlNow: () => number;
  frlLineDashed = false;
  /** Milliseconds the last full path update (a settled view) or mid-gesture refresh took. */
  frlLastDrawMs = 0;
  /** Held (`frlHold`, review MR-02): the settled view's update waits for `frlRelease`, and no redraw runs meanwhile. */
  private frlHeld = false;
  private frlUpdateWanted = false;

  constructor(options: L.RendererOptions, perf: MapPerf, pixelRatio: (() => number) | null = null, now: () => number = () => performance.now()) {
    super(options);
    this.frlPerf = perf;
    this.frlPixelRatio = pixelRatio;
    this.frlNow = now;
  }

  _updatePaths(): void {
    if ((this as unknown as CanvasInternals)._postponeUpdatePaths === true) {
      canvasPrototype._updatePaths.call(this);
      return;
    }
    const start = this.frlNow();
    this.frlPerf.time('frl:map:update-paths', () => {
      canvasPrototype._updatePaths.call(this);
    });
    this.frlLastDrawMs = this.frlNow() - start;
  }

  /**
   * Holds the settled view's update (review MR-02): while a gesture's settle waits to be reported,
   * Leaflet's `moveend` re-clip and full redraw wait, and so does every redraw asked for, so the
   * canvas keeps its picture, transformed as during the gesture, until `frlRelease`.
   */
  frlHold(): void {
    this.frlHeld = true;
  }

  /** Ends a hold: an update asked for meanwhile runs in the next frame (`request`), redrawing everything once. */
  frlRelease(request: (callback: () => void) => void): void {
    if (!this.frlHeld) return;
    this.frlHeld = false;
    if (!this.frlUpdateWanted) return;
    request(() => {
      if (!this.frlUpdateWanted || this.frlHeld) return;
      this.frlUpdateWanted = false;
      this._update();
    });
  }

  _update(): void {
    if (this.frlHeld && (this as unknown as CanvasInternals)._map?._animatingZoom !== true) {
      this.frlUpdateWanted = true;
      return;
    }
    this.frlUpdateWanted = false;
    const ratio = this.frlPixelRatio;
    if (ratio === null) {
      canvasPrototype._update.call(this);
      return;
    }
    // Leaflet 1.9.4 `Canvas._update`, with the backing store at `ratio`.
    const self = this as unknown as CanvasInternals;
    if (self._map?._animatingZoom === true && self._bounds !== undefined) return;
    rendererPrototype._update.call(this);
    const bounds = self._bounds;
    const container = self._container;
    const ctx = self._ctx;
    const min = bounds?.min;
    if (bounds === undefined || min === undefined || container === undefined || ctx === null || ctx === undefined) return;
    const size = bounds.getSize();
    const m = ratio();
    const width = Math.round(size.x * m);
    const height = Math.round(size.y * m);
    L.DomUtil.setPosition(container, min);
    // Setting the size also clears the canvas.
    container.width = width;
    container.height = height;
    container.style.width = `${String(size.x)}px`;
    container.style.height = `${String(size.y)}px`;
    if (size.x > 0 && size.y > 0 && (width !== size.x || height !== size.y)) ctx.scale(width / size.x, height / size.y);
    ctx.translate(-min.x, -min.y);
    this.fire('update');
  }

  /** The zoom the paths were last drawn at, or null before the first draw. */
  frlDrawnZoom(): number | null {
    return (this as unknown as CanvasInternals)._zoom ?? null;
  }

  /** Re-renders every path at the current view (the smooth wheel's mid-gesture refresh). */
  frlRefresh(): void {
    const self = this as unknown as CanvasInternals;
    if (self._map === undefined) return;
    const start = this.frlNow();
    self._postponeUpdatePaths = true;
    self._reset();
    this.frlLastDrawMs = this.frlNow() - start;
  }

  _redraw(): void {
    const self = this as unknown as CanvasInternals;
    const pending = self._redrawRequest;
    if (pending !== null && pending !== undefined) L.Util.cancelAnimFrame(pending);
    // Held, or an update waiting: the paths are projected for a view the canvas is not positioned for yet; the update redraws them all.
    if (this.frlHeld || this.frlUpdateWanted) {
      self._redrawRequest = null;
      self._redrawBounds = null;
      return;
    }
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
  /** Masked by the Map layers drawer or the map search (map-presentation.md §25.3.4): not drawn, not hit. */
  frlHidden = false;

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

  /** Hides or shows the glyph (the mask), redrawing its area when it changed. */
  setHidden(hidden: boolean, redraw = true): void {
    if (hidden === this.frlHidden) return;
    this.frlHidden = hidden;
    if (redraw) this.redraw();
  }

  _containsPoint(p: L.Point): boolean {
    if (this.frlHidden) return false;
    const self = this as unknown as PathInternals;
    const point = self._point;
    return point !== undefined && p.distanceTo(point) <= self._radius + self._clickTolerance();
  }

  _updatePath(): void {
    const self = this as unknown as PathInternals;
    const ctx = drawingContext(self);
    const point = self._point;
    if (ctx === null || point === undefined || self._empty() || this.frlHidden) return;
    const renderer = self._renderer;
    const measured = renderer instanceof MeasuredCanvas ? renderer : null;
    drawGlyph(ctx, point.x, point.y, this.frlSpec, measured?.frlLineDashed ?? true);
    if (measured !== null) measured.frlLineDashed = false;
  }
}

/** What a pin needs to draw itself: its bitmap (null: draw it as vectors), the palette and the path maker, from the adapter. */
export interface PinDrawing {
  bitmap(spec: PinSpec): PinBitmap | null;
  palette(): PinPalette;
  readonly path: PathMaker;
}

/**
 * A pin (map-presentation.md §25.2; pins.ts) as a Leaflet `CircleMarker`: Leaflet projects it,
 * culls it off screen and hit-tests it (the renderer's topmost interactive path, so the route's
 * beads above the pins win and the lines below them lose); its target is the pin's own
 * (`targetContains`: the head plus 2 px, the triangle to the point, 24 px at least below D 20), and
 * the adapter then picks the nearest head centre among the pins under the pointer. It draws its
 * bitmap (or, without one, its vectors); its canvas bounds are its extent (`specExtent`), so a
 * partial redraw never cuts it. Hidden (masked, merged into a stack, below its band) it draws
 * nothing and takes no pointer.
 */
export class PinMarker extends L.CircleMarker {
  private frlSpec: PinSpec;
  private readonly frlDrawing: PinDrawing;
  frlHidden = false;

  constructor(latlng: L.LatLngExpression, spec: PinSpec, drawing: PinDrawing, options: L.CircleMarkerOptions) {
    super(latlng, { ...options, radius: spec.diameter / 2 + 2, stroke: false, fill: false, weight: 0 });
    this.frlSpec = spec;
    this.frlDrawing = drawing;
  }

  get spec(): PinSpec {
    return this.frlSpec;
  }

  /** Replaces the look; `redraw` false while the view is about to be redrawn anyway (a zoom's settle). */
  setSpec(spec: PinSpec, redraw = true): void {
    this.frlSpec = spec;
    const radius = spec.diameter / 2 + 2;
    if (redraw && this.frlHidden === false) {
      this.setRadius(radius);
      return;
    }
    this.options.radius = radius;
    (this as unknown as { _radius: number })._radius = radius;
    if (redraw) this.redraw();
  }

  setHidden(hidden: boolean, redraw = true): void {
    if (hidden === this.frlHidden) return;
    this.frlHidden = hidden;
    if (redraw) this.redraw();
  }

  /** The pin's point in layer pixels once projected, or null. */
  get layerPoint(): L.Point | null {
    return (this as unknown as PathInternals)._point ?? null;
  }

  _updateBounds(): void {
    const self = this as unknown as PathInternals;
    const point = self._point;
    if (point === undefined) return;
    const e = specExtent(this.frlSpec);
    self._pxBounds = L.bounds(L.point(point.x - e.left, point.y - e.up), L.point(point.x + e.right, point.y + e.down));
  }

  _containsPoint(p: L.Point): boolean {
    if (this.frlHidden) return false;
    const point = (this as unknown as PathInternals)._point;
    return point !== undefined && targetContains({ id: '', x: point.x, y: point.y, diameter: this.frlSpec.diameter, list: false }, p.x, p.y);
  }

  _updatePath(): void {
    const self = this as unknown as PathInternals;
    const ctx = drawingContext(self);
    const point = self._point;
    if (ctx === null || point === undefined || self._empty() || this.frlHidden) return;
    const bitmap = this.frlDrawing.bitmap(this.frlSpec);
    if (bitmap === null) drawPin(ctx, point.x, point.y, this.frlSpec, this.frlDrawing.palette(), this.frlDrawing.path);
    else ctx.drawImage(bitmap.image as unknown as CanvasImageSource, Math.round(point.x - bitmap.left), Math.round(point.y - bitmap.up), bitmap.width, bitmap.height);
    const renderer = self._renderer;
    if (renderer instanceof MeasuredCanvas) renderer.frlLineDashed = false;
  }
}

/**
 * A cross-map leg on the atlas (map-atlas.md §8.5): Leaflet's polyline along the sampled arc
 * (transform.ts `connectorArc`), in the leg's dash style, plus a transition glyph at mid-arc. It is
 * hit-tested as the polyline; its canvas bounds also cover the glyph, so a partial redraw never
 * cuts it.
 */
export class ConnectorArc extends L.Polyline {
  private frlGlyph: GlyphSpec;
  private frlMid: L.LatLng;
  /** A network ride's halo (review PR-11); null for the route's own connectors. */
  private frlHalo: LineHalo | null;
  /** Masked with its drawer row (a network ride with Transport stops, §25.3.4): not drawn, not hit. */
  frlHidden = false;

  constructor(latlngs: L.LatLngExpression[], mid: L.LatLng, glyph: GlyphSpec, options: L.PolylineOptions, halo: LineHalo | null = null) {
    super(latlngs, options);
    this.frlGlyph = glyph;
    this.frlMid = mid;
    this.frlHalo = halo;
  }

  setHalo(halo: LineHalo | null): void {
    if (halo === this.frlHalo || (halo !== null && this.frlHalo !== null && halo.color === this.frlHalo.color && halo.weight === this.frlHalo.weight)) return;
    this.frlHalo = halo;
    this.redraw();
  }

  setHidden(hidden: boolean, redraw = true): void {
    if (hidden === this.frlHidden) return;
    this.frlHidden = hidden;
    if (redraw) this.redraw();
  }

  _containsPoint(point: L.Point): boolean {
    return !this.frlHidden && (polylinePrototype as unknown as { _containsPoint(this: unknown, p: L.Point): boolean })._containsPoint.call(this, point);
  }

  get glyph(): GlyphSpec {
    return this.frlGlyph;
  }

  setGlyph(glyph: GlyphSpec): void {
    this.frlGlyph = glyph;
    this.redraw();
  }

  /** Moves the arc and its mid-arc glyph (both ends' points changed). */
  setArc(latlngs: L.LatLngExpression[], mid: L.LatLng): void {
    this.frlMid = mid;
    this.setLatLngs(latlngs);
  }

  _updateBounds(): void {
    polylinePrototype._updateBounds.call(this);
    const self = this as unknown as PathInternals;
    const bounds = self._pxBounds;
    const map = self._map;
    if (bounds === undefined || map === undefined) return;
    const point = map.latLngToLayerPoint(this.frlMid);
    const extent = glyphExtent(this.frlGlyph);
    const weight = (this.options as { weight?: number }).weight ?? 0;
    const pad = this.frlHalo === null || this.frlHalo.weight <= weight || bounds.min === undefined || bounds.max === undefined ? 0 : (this.frlHalo.weight - weight) / 2;
    const padded = pad === 0 || bounds.min === undefined || bounds.max === undefined ? bounds : L.bounds(bounds.min.subtract([pad, pad]), bounds.max.add([pad, pad]));
    self._pxBounds = padded.extend(point.subtract([extent, extent])).extend(point.add([extent, extent]));
  }

  _updatePath(): void {
    if (this.frlHidden) return;
    const self = this as unknown as PathInternals & PartsInternals;
    strokeHalo(drawingContext(self), self._parts, this.frlHalo, this.options);
    polylinePrototype._updatePath.call(this);
    const ctx = drawingContext(self);
    const map = self._map;
    // A polyline has no `_empty` (only `L.CircleMarker` has): nothing clipped into view is no parts.
    if (ctx === null || map === undefined || (self._parts?.length ?? 0) === 0) return;
    const point = map.latLngToLayerPoint(this.frlMid);
    const renderer = self._renderer;
    const measured = renderer instanceof MeasuredCanvas ? renderer : null;
    drawGlyph(ctx, point.x, point.y, this.frlGlyph, measured?.frlLineDashed ?? true);
    if (measured !== null) measured.frlLineDashed = false;
  }
}

/** Leaflet 1.9.4 `L.Polyline._parts`: the projected, clipped rings or lines of a polyline or polygon, in layer points. */
interface PartsInternals {
  readonly _parts: readonly (readonly L.Point[])[] | undefined;
}

/** A dash pattern in canvas pixels ("5 6" → [5, 6]); empty for solid. */
const dashOf = (dash: string | undefined): number[] =>
  dash === undefined
    ? []
    : dash
        .split(/[\s,]+/)
        .map(Number)
        .filter((n) => Number.isFinite(n) && n >= 0);

/**
 * A line over its halo (map-presentation.md §25.4, §25.6; review PR-03): Leaflet's polyline, with a
 * wider stroke in the halo colour drawn first along its projected lines (`_parts`), in the line's own
 * dashes, cap and opacity, so the line keeps an edge of the halo on any ground (the route 2.6 px over
 * 5.5 px, the travel network 1.1 px over 3 px). Its canvas bounds cover the halo, so a partial redraw
 * never cuts it. With no halo it is a plain polyline.
 */
export class HaloPolyline extends L.Polyline {
  private frlHalo: LineHalo | null;
  /** Masked with its drawer row (a network ride with Transport stops, §25.3.4; PR-11): not drawn, not hit. */
  frlHidden = false;

  constructor(latlngs: L.LatLngExpression[], halo: LineHalo | null, options: L.PolylineOptions) {
    super(latlngs, options);
    this.frlHalo = halo;
  }

  setHidden(hidden: boolean, redraw = true): void {
    if (hidden === this.frlHidden) return;
    this.frlHidden = hidden;
    if (redraw) this.redraw();
  }

  _containsPoint(point: L.Point): boolean {
    return !this.frlHidden && (polylinePrototype as unknown as { _containsPoint(this: unknown, p: L.Point): boolean })._containsPoint.call(this, point);
  }

  get halo(): LineHalo | null {
    return this.frlHalo;
  }

  setHalo(halo: LineHalo | null): void {
    if (halo === this.frlHalo || (halo !== null && this.frlHalo !== null && halo.color === this.frlHalo.color && halo.weight === this.frlHalo.weight)) return;
    this.frlHalo = halo;
    this.redraw();
  }

  _updateBounds(): void {
    polylinePrototype._updateBounds.call(this);
    const self = this as unknown as PathInternals;
    const bounds = self._pxBounds;
    const halo = this.frlHalo;
    const weight = (this.options as { weight?: number }).weight ?? 0;
    if (bounds?.min === undefined || bounds.max === undefined || halo === null || halo.weight <= weight) return;
    const pad = (halo.weight - weight) / 2;
    self._pxBounds = L.bounds(bounds.min.subtract([pad, pad]), bounds.max.add([pad, pad]));
  }

  _updatePath(): void {
    if (this.frlHidden) return;
    const self = this as unknown as PathInternals & PartsInternals;
    strokeHalo(drawingContext(self), self._parts, this.frlHalo, this.options);
    polylinePrototype._updatePath.call(this);
  }
}

/**
 * A line's halo along its projected lines, in the line's own dashes and cap, at the halo colour's
 * own strength whatever the line's opacity (under the faded route after the active step too, so its
 * edge keeps the halo's contrast; review PR-02, PR-03). Drawn before the line; no save: Leaflet's
 * stroke of the line, next, sets every property this one does.
 */
function strokeHalo(ctx: CanvasRenderingContext2D | null, parts: readonly (readonly L.Point[])[] | undefined, halo: LineHalo | null, pathOptions: L.PathOptions): void {
  if (halo === null || ctx === null || parts === undefined || parts.length === 0) return;
  const options = pathOptions as { opacity?: number; dashArray?: string; lineCap?: CanvasLineCap; lineJoin?: CanvasLineJoin };
  ctx.beginPath();
  for (const line of parts) {
    line.forEach((point, i) => {
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
  }
  ctx.setLineDash(dashOf(options.dashArray));
  ctx.globalAlpha = 1;
  ctx.lineWidth = halo.weight;
  ctx.lineCap = options.lineCap ?? 'round';
  ctx.lineJoin = options.lineJoin ?? 'round';
  ctx.strokeStyle = halo.color;
  ctx.stroke();
}

const polygonPrototype = L.Polygon.prototype as unknown as { _updatePath(this: unknown): void };

/**
 * An objective outline (map-presentation.md §7.4, §6.4): Leaflet's polygon, stroked over a 3 px
 * halo along its projected rings (`_parts`), so the faint line reads on any art. Not interactive.
 */
/** The side of a hatch pattern's tile, CSS pixels. */
const HATCH_TILE = 8;

/**
 * The faction overlay's patterns (map-presentation.md §12.6): `/` diagonal hatching for Alliance
 * territory, `\` for Horde territory, both for the client's value 6, dots for a sanctuary, none for no
 * faction in the client. Drawn in `colour` (the hatch token) on a transparent tile; null where a
 * canvas cannot be made (then the fill's colour stands in).
 */
export function hatchPattern(doc: Document, pattern: 'alliance' | 'horde' | 'both' | 'none' | 'sanctuary', colour: string): CanvasPattern | null {
  if (pattern === 'none') return null;
  const tile = doc.createElement('canvas');
  tile.width = HATCH_TILE;
  tile.height = HATCH_TILE;
  const ctx = tile.getContext('2d');
  if (ctx === null) return null;
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 1.25;
  const line = (x0: number, y0: number, x1: number, y1: number): void => {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  const n = HATCH_TILE;
  if (pattern === 'alliance' || pattern === 'both') {
    line(-1, n + 1, n + 1, -1);
    line(-1, 1, 1, -1);
    line(n - 1, n + 1, n + 1, n - 1);
  }
  if (pattern === 'horde' || pattern === 'both') {
    line(-1, -1, n + 1, n + 1);
    line(-1, n - 1, 1, n + 1);
    line(n - 1, -1, n + 1, 1);
  }
  if (pattern === 'sanctuary') {
    ctx.beginPath();
    ctx.arc(n / 2, n / 2, 1.3, 0, 2 * Math.PI);
    ctx.fill();
  }
  // A stand-in context (tests) may give back nothing at all: no pattern then.
  const pattern2d: CanvasPattern | null | undefined = ctx.createPattern(tile, 'repeat');
  return pattern2d ?? null;
}

/**
 * A zone fill (map-presentation.md §12.4, §12.6; step MP.10): the zone's terrain rings, even-odd, filled
 * with the fallback tint or the faction overlay's pattern (`setPattern`), never stroked.
 */
export class ZoneFillShape extends L.Polygon {
  private frlPattern: CanvasPattern | null = null;
  /** The land the pattern is drawn on (`ZoneFillDescriptor.land`), and its rings projected at the last zoom and origin. */
  private frlLand: readonly (readonly L.LatLng[])[] | null = null;
  private frlLandPx: { readonly zoom: number; readonly x: number; readonly y: number; readonly rings: readonly (readonly L.Point[])[] } | null = null;

  setPattern(pattern: CanvasPattern | null): void {
    if (pattern === this.frlPattern) return;
    this.frlPattern = pattern;
    this.redraw();
  }

  /** Clips the pattern to land (review PR-15, QA-15): nonzero winding of the coastline's rings; null for none. */
  setLand(land: readonly (readonly L.LatLng[])[] | null): void {
    if (land === this.frlLand) return;
    this.frlLand = land;
    this.frlLandPx = null;
    this.redraw();
  }

  /** The land rings in layer points at the map's current zoom and pixel origin (projected once per zoom). */
  private landPoints(): readonly (readonly L.Point[])[] | null {
    const land = this.frlLand;
    const map = (this as unknown as PathInternals)._map;
    if (land === null || map === undefined) return null;
    const zoom = map.getZoom();
    const origin = map.getPixelOrigin();
    const kept = this.frlLandPx;
    if (kept !== null && kept.zoom === zoom && kept.x === origin.x && kept.y === origin.y) return kept.rings;
    const rings = land.map((ring) => ring.map((latlng) => map.latLngToLayerPoint(latlng)));
    this.frlLandPx = { zoom, x: origin.x, y: origin.y, rings };
    return rings;
  }

  _updatePath(): void {
    const options = this.options as { fillColor?: unknown };
    const colour = options.fillColor;
    const land = this.landPoints();
    const ctx = land === null ? null : drawingContext(this as unknown as PathInternals);
    if (this.frlPattern !== null) options.fillColor = this.frlPattern;
    if (ctx !== null && land !== null) {
      ctx.save();
      ctx.beginPath();
      for (const ring of land) {
        ring.forEach((point, i) => {
          if (i === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
        ctx.closePath();
      }
      ctx.clip('nonzero');
    }
    try {
      (L.Polygon.prototype as unknown as { _updatePath(this: unknown): void })._updatePath.call(this);
    } finally {
      options.fillColor = colour;
      if (ctx !== null && land !== null) ctx.restore();
    }
  }

  /** A hover over the zone's sea is not on its territory: the point must be on land too. */
  _containsPoint(p: L.Point): boolean {
    const inside = (L.Polygon.prototype as unknown as { _containsPoint(this: unknown, p: L.Point): boolean })._containsPoint.call(this, p);
    const land = this.landPoints();
    return inside && (land === null || windingAt(land, p.x, p.y) !== 0);
  }
}

interface XY {
  readonly x: number;
  readonly y: number;
}

/** A closed ring and its bounds. */
export interface LandRing<P extends XY = XY> {
  readonly ring: readonly P[];
  readonly box: { readonly xMin: number; readonly xMax: number; readonly yMin: number; readonly yMax: number };
}

const landRingsMemo = new WeakMap<readonly (readonly XY[])[], readonly LandRing[]>();

export const boundsOfPoints = (points: readonly XY[]): LandRing['box'] => {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of points) {
    xMin = Math.min(xMin, p.x);
    xMax = Math.max(xMax, p.x);
    yMin = Math.min(yMin, p.y);
    yMax = Math.max(yMax, p.y);
  }
  return { xMin, xMax, yMin, yMax };
};

/**
 * The terrain coastline's lines as closed rings (`ZoneFillDescriptor.land`; review PR-15, QA-15),
 * memoised per lines array: a closed line is a ring; the open ones (a shore that reaches another
 * line's end) are chained end to start, as the lines keep land on their left; a chain that does not
 * close (a shore at the edge of the terrain grid) is closed straight. So land is where the rings'
 * winding is not zero and the sea is where it is zero (checked on the committed coastlines:
 * Orgrimmar, the Crossroads, Darkshore, Stormwind, Ironforge 1; the sea east of Durotar, west of
 * Darkshore and west of Westfall 0).
 */
export function landRingsOf<P extends XY>(lines: readonly (readonly P[])[]): readonly LandRing<P>[] {
  const kept = landRingsMemo.get(lines) as readonly LandRing<P>[] | undefined;
  if (kept !== undefined) return kept;
  const key = (p: XY): string => `${String(p.x)},${String(p.y)}`;
  const rings: (readonly P[])[] = [];
  const open: (readonly P[])[] = [];
  for (const line of lines) {
    const first = line[0];
    const last = line.at(-1);
    if (first === undefined || last === undefined || line.length < 2) continue;
    if (key(first) === key(last)) rings.push(line);
    else open.push(line);
  }
  const starts = new Map<string, number[]>();
  open.forEach((line, i) => {
    const first = line[0];
    if (first === undefined) return;
    const list = starts.get(key(first)) ?? [];
    list.push(i);
    starts.set(key(first), list);
  });
  const used = new Set<number>();
  open.forEach((line, i) => {
    if (used.has(i)) return;
    used.add(i);
    const chain: P[] = [...line];
    const head = chain[0];
    for (;;) {
      const end = chain.at(-1);
      if (end === undefined || head === undefined || (chain.length > line.length && key(end) === key(head))) break;
      const next = (starts.get(key(end)) ?? []).find((j) => !used.has(j));
      if (next === undefined) break;
      used.add(next);
      chain.push(...(open[next] ?? []).slice(1));
    }
    rings.push(chain);
  });
  const out = rings.filter((ring) => ring.length >= 3).map((ring) => ({ ring, box: boundsOfPoints(ring) }));
  landRingsMemo.set(lines, out);
  return out;
}

/** The land rings that meet `points`' bounds (a zone's rings): the ones its clip needs. */
export function landRingsNear<P extends XY>(lines: readonly (readonly P[])[], points: readonly XY[]): readonly (readonly P[])[] {
  const box = boundsOfPoints(points);
  return landRingsOf(lines)
    .filter((entry) => entry.box.xMin <= box.xMax && entry.box.xMax >= box.xMin && entry.box.yMin <= box.yMax && entry.box.yMax >= box.yMin)
    .map((entry) => entry.ring);
}

/**
 * The winding number of closed rings round a point (the canvas's `nonzero` rule: inside where it is
 * not zero). `ZoneFillDescriptor.land` is land where it is not zero (review PR-15).
 */
export function windingAt(rings: readonly (readonly { readonly x: number; readonly y: number }[])[], x: number, y: number): number {
  let winding = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (a === undefined || b === undefined) continue;
      const side = (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y);
      if (a.y <= y) {
        if (b.y > y && side > 0) winding += 1;
      } else if (b.y <= y && side < 0) winding -= 1;
    }
  }
  return winding;
}

export class AreaOutline extends L.Polygon {
  private frlHalo: string;
  /** Masked with the Objectives row (map-presentation.md §25.3.4): not drawn. */
  frlHidden = false;

  constructor(latlngs: L.LatLngExpression[], halo: string, options: L.PolylineOptions) {
    super(latlngs, options);
    this.frlHalo = halo;
  }

  setHalo(halo: string): void {
    if (halo === this.frlHalo) return;
    this.frlHalo = halo;
    this.redraw();
  }

  setHidden(hidden: boolean, redraw = true): void {
    if (hidden === this.frlHidden) return;
    this.frlHidden = hidden;
    if (redraw) this.redraw();
  }

  _updatePath(): void {
    if (this.frlHidden) return;
    const self = this as unknown as PathInternals & PartsInternals;
    const ctx = drawingContext(self);
    const parts = self._parts;
    if (ctx !== null && parts !== undefined && parts.length > 0) {
      ctx.save();
      ctx.beginPath();
      for (const ring of parts) {
        ring.forEach((point, i) => {
          if (i === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
        ctx.closePath();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3.5;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = this.frlHalo;
      ctx.stroke();
      ctx.restore();
    }
    polygonPrototype._updatePath.call(this);
  }
}

/** Height kept above an inset's card for its caption, and the caption's estimated width per character (12 px text). */
const CAPTION_HEIGHT = 20;
const CAPTION_CHAR_PX = 7.5;

const captionWidth = (label: string | null): number => (label === null ? 0 : label.length * CAPTION_CHAR_PX + 8);

export interface FrameLabelStyle {
  readonly color: string;
  readonly font: string;
  /** A halo stroked under the text (captions over the atlas tiles), or none. */
  readonly halo?: string;
}

/**
 * A zone frame: Leaflet's rectangle plus its label, centred, drawn only when the frame is wide
 * enough on screen. An inset's card (map-atlas.md §5.5) puts its label above its top edge instead,
 * as a caption, so it never covers the painting inside.
 */
export class FrameRectangle extends L.Rectangle {
  private frlLabel: string | null;
  private frlLabelStyle: FrameLabelStyle;
  private readonly frlPlacement: 'centre' | 'above';

  constructor(
    bounds: L.LatLngBoundsExpression,
    label: string | null,
    labelStyle: FrameLabelStyle,
    options: L.PolylineOptions,
    placement: 'centre' | 'above' = 'centre',
  ) {
    super(bounds, options);
    this.frlLabel = label;
    this.frlLabelStyle = labelStyle;
    this.frlPlacement = placement;
  }

  /** Sets the label; redraws only when it or its style changed. */
  setLabel(label: string | null, labelStyle: FrameLabelStyle): void {
    if (
      label === this.frlLabel &&
      labelStyle.color === this.frlLabelStyle.color &&
      labelStyle.font === this.frlLabelStyle.font &&
      labelStyle.halo === this.frlLabelStyle.halo
    ) {
      return;
    }
    this.frlLabel = label;
    this.frlLabelStyle = labelStyle;
    this.redraw();
  }

  _updateBounds(): void {
    polylinePrototype._updateBounds.call(this);
    if (this.frlPlacement !== 'above') return;
    // The caption above the card is part of what this path paints: its canvas bounds cover it.
    const self = this as unknown as PathInternals;
    const min = self._pxBounds?.min;
    const max = self._pxBounds?.max;
    if (min === undefined || max === undefined) return;
    const width = captionWidth(this.frlLabel);
    self._pxBounds = L.bounds(min.subtract([0, CAPTION_HEIGHT]), L.point(Math.max(max.x, min.x + width), max.y));
  }

  _updatePath(): void {
    rectanglePrototype._updatePath.call(this);
    const self = this as unknown as PathInternals;
    const ctx = drawingContext(self);
    const bounds = this.frlPlacement === 'above' ? (self._rawPxBounds ?? self._pxBounds) : self._pxBounds;
    const label = this.frlLabel;
    const min = bounds?.min;
    const max = bounds?.max;
    if (ctx === null || min === undefined || max === undefined || label === null || label === '') return;
    const width = max.x - min.x;
    const height = max.y - min.y;
    ctx.save();
    ctx.font = `500 12px ${this.frlLabelStyle.font}`;
    const textWidth = ctx.measureText(label).width;
    if (this.frlPlacement === 'above') {
      // A caption just above the card's top edge, left-aligned (inside this path's canvas bounds:
      // `_updateBounds` grows them to hold it).
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      const halo = this.frlLabelStyle.halo;
      if (halo !== undefined) {
        ctx.strokeStyle = halo;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.setLineDash([]);
        ctx.strokeText(label, min.x + 2, min.y - 4);
      }
      ctx.fillStyle = this.frlLabelStyle.color;
      ctx.fillText(label, min.x + 2, min.y - 4);
    } else if (width >= textWidth + 12 && height >= 20) {
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

/** One world map the grid is drawn for: its placement on the surface and the rectangle its lines are clipped to. */
export interface GridPlacement {
  readonly mapId: WorldMapId;
  readonly translation: Translation;
  /** The map's extent on a world surface, its placed rectangle on the atlas; null for none. */
  readonly clip: WorldBounds | null;
}

/** The yard grid is drawn from the zone band (px per yard, `BAND_EDGES.zone` in adapter.ts; review PR-10). */
export const GRID_MIN_PX_PER_YARD = 0.088;

/**
 * The procedural yard grid (MAPS §8.1): its own canvas in a pane below the paths, redrawn when the
 * view settles and hidden during zoom animation. Lines of constant world X run east-west, lines of
 * constant world Y run north-south; both are labelled with their axis, yard value and direction
 * (`X 500 (N)`, `Y −4100 (W)`) along the top and left edges of what is drawn. On a world surface
 * the grid is the map's, clipped to the surface extent; on the atlas it is drawn per placement,
 * each map's own yards clipped to its placed rectangle (docs/research/map-atlas.md §8.5), so the
 * labels always name that map's coordinates. It is not interactive. The backing store is
 * reallocated only when the size or the pixel ratio changes. It is drawn from the zone band only,
 * and hidden by the drawer's Coordinate grid row (`setShown`); its labels carry the map labels' halo.
 */
export class GridLayer extends L.Layer {
  private frlMap: L.Map | null = null;
  private frlCanvas: HTMLCanvasElement | null = null;
  private frlPlacements: readonly GridPlacement[] = [];
  private frlPalette: MapPalette;
  private frlShown = true;
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

  /** The maps to draw the grid for (none: no grid). */
  setPlacements(placements: readonly GridPlacement[]): void {
    this.frlPlacements = placements;
    this.redraw();
  }

  setPalette(palette: MapPalette): void {
    this.frlPalette = palette;
    this.redraw();
  }

  /** The drawer's Coordinate grid row (review PR-10). */
  setShown(shown: boolean): void {
    if (shown === this.frlShown) return;
    this.frlShown = shown;
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
    if (ctx === null) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    // Drawn from the zone band only (review PR-10): zoomed out its labels repeated on every map and card.
    if (!this.frlShown || this.frlPlacements.length === 0 || size.x === 0 || size.y === 0 || !(2 ** map.getZoom() >= GRID_MIN_PX_PER_YARD)) return;
    const spacing = gridSpacingAt(map.getZoom(), 96);
    if (spacing === null) return;
    const view = map.getBounds();
    for (const placement of this.frlPlacements) this.drawPlacement(ctx, map, size, view, spacing, placement);
  }

  private drawPlacement(ctx: CanvasRenderingContext2D, map: L.Map, size: L.Point, view: L.LatLngBounds, spacing: number, placement: GridPlacement): void {
    const { mapId, translation } = placement;
    const visible = latLngBoundsOnMap(translation, view.getSouth(), view.getWest(), view.getNorth(), view.getEast(), mapId);
    const lines = gridLinesIn(visible, placement.clip, spacing);
    if (lines === null) return;
    const toScreen = (x: number, y: number): L.Point => map.latLngToContainerPoint(placedLatLng(translation, x, y) as [number, number]);
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
    // The labels on the map labels' halo (review QA-26): readable on the painted art as on the minimap.
    ctx.strokeStyle = this.frlPalette.labelHalo;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    const label = (text: string, x: number, y: number): void => {
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    };
    const topLeft = toScreen(area.xMax, area.yMax);
    const labelY = Math.max(4, topLeft.y + 4);
    const labelX = Math.max(4, topLeft.x + 4);
    for (const y of lines.ys) {
      const px = Math.round(toScreen(area.xMax, y).x);
      if (px > labelX + 64 && px < size.x - 64) label(gridLabel('Y', y), px + 3, labelY);
    }
    for (const x of lines.xs) {
      const py = Math.round(toScreen(x, area.yMax).y);
      if (py > labelY + 16 && py < size.y - 12) label(gridLabel('X', x), labelX, py + 3);
    }
  }
}

/** A yard scale bar (Leaflet's own scale control would say metres and feet). */
export class ScaleBarControl extends L.Control {
  private frlMap: L.Map | null = null;
  private frlBar: HTMLElement | null = null;
  private frlText: HTMLElement | null = null;
  private readonly frlMaxWidth: number;
  private readonly frlName: () => string | null;
  private readonly frlUpdate = (): void => {
    this.update();
  };

  /** `name`: the map the scale applies to, shown after the length (the atlas names the map under the view centre, map-atlas.md §8.5); null for none. */
  constructor(options: L.ControlOptions, maxWidthPx = 120, name: () => string | null = () => null) {
    super(options);
    this.frlMaxWidth = maxWidthPx;
    this.frlName = name;
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
    const name = this.frlName();
    this.frlBar.style.width = bar === null ? '0px' : `${String(Math.round(bar.widthPx))}px`;
    this.frlText.textContent = bar === null ? '' : name === null ? bar.text : `${bar.text} · ${name}`;
  }

  /** The text shown, for tests. */
  text(): string {
    return this.frlText?.textContent ?? '';
  }
}
