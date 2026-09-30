import * as L from 'leaflet';
import type { MapPerf } from './perf';
import type { Box } from './labels';

/**
 * The labels canvas as a Leaflet renderer, and the band change's cross-fade
 * (docs/research/map-presentation.md §5.5; step MP.1). Placement and drawing are in labels.ts.
 * Leaflet 1.9.4 internals used (for MAPS §7.5's list): `L.Renderer`'s `_container`, `_map`,
 * `_bounds`, `_center`, `_update`, `_updateTransform`, `_initContainer` and `_destroyContainer`,
 * and the map's `_animatingZoom`.
 */

/** Leaflet 1.9.4 `L.Renderer` internals the labels canvas uses. */
interface RendererInternals {
  _container: HTMLCanvasElement | undefined;
  readonly _map: (L.Map & { readonly _animatingZoom?: boolean }) | undefined;
  readonly _bounds: L.Bounds | undefined;
}

const rendererPrototype = L.Renderer.prototype as unknown as { _update(this: unknown): void; _updateTransform(this: unknown, center: L.LatLng, zoom: number): void };

export interface LabelsRendererHooks {
  /** Draws the labels and numbers; the context is translated so layer points draw where they are. `area` is the visible container in layer points. */
  readonly draw: (ctx: CanvasRenderingContext2D, area: Box) => void;
  /** The backing store's pixel ratio (the device's, capped at 2). */
  readonly pixelRatio: () => number;
  readonly perf: MapPerf;
  /** Animation frames (the page's by default). */
  readonly frames: { readonly request: (callback: () => void) => number; readonly cancel: (handle: number) => void };
  /**
   * Posts a task of its own (review MR-02): the draw a held settle asked for runs in a task after the
   * frame that redraws the paths, not in that frame's own callbacks; absent, in the frame.
   */
  readonly tasks?: { readonly post: (task: () => void) => () => void } | null;
}

/**
 * The labels canvas as a Leaflet renderer without paths: Leaflet positions and scales it during
 * zoom animations and gestures exactly as its path renderers (`_onZoom`, `_onAnimZoom`,
 * `_updateTransform`), and every settled view (`moveend`, a view reset) schedules one draw in the
 * next animation frame, which re-bounds the canvas (with the renderer's padding), sizes its backing
 * store at the pixel ratio and draws. Its container takes no pointer events.
 */
export class LabelsRenderer extends L.Renderer {
  private readonly frlHooks: LabelsRendererHooks;
  private frlFrame: number | null = null;
  private frlRebound = false;
  private frlDraws = 0;
  /** Held (`hold`): a draw asked for waits for `release`. */
  private frlHeld = false;
  private frlWanted = false;
  /** The draw posted after a frame by `release`, as its cancel. */
  private frlCancelTask: (() => void) | null = null;

  constructor(options: L.RendererOptions, hooks: LabelsRendererHooks) {
    super(options);
    this.frlHooks = hooks;
  }

  /** Full draws so far (for tests and stats). */
  get draws(): number {
    return this.frlDraws;
  }

  /** The canvas element, or null before it is added. */
  get element(): HTMLCanvasElement | null {
    return (this as unknown as RendererInternals)._container ?? null;
  }

  _initContainer(): void {
    const canvas = L.DomUtil.create('canvas', 'frl-map__labels leaflet-zoom-animated');
    canvas.style.pointerEvents = 'none';
    canvas.setAttribute('aria-hidden', 'true');
    (this as unknown as RendererInternals)._container = canvas;
  }

  _destroyContainer(): void {
    if (this.frlFrame !== null) this.frlHooks.frames.cancel(this.frlFrame);
    this.frlFrame = null;
    this.frlCancelTask?.();
    this.frlCancelTask = null;
    const self = this as unknown as RendererInternals;
    self._container?.remove();
    self._container = undefined;
  }

  /**
   * A settled view: re-bound and draw in the next frame (Leaflet calls this on `moveend` and view
   * resets). The first one bounds the canvas at once, so a zoom before the first frame has a centre
   * and zoom to transform from.
   */
  _update(): void {
    const self = this as unknown as RendererInternals;
    if (self._map?._animatingZoom === true && self._bounds !== undefined) return;
    if (self._bounds === undefined && self._map !== undefined) rendererPrototype._update.call(this);
    this.requestDraw(true);
  }

  /** Leaflet's zoom transform, once the canvas has been bounded (before that there is nothing drawn to move). */
  _updateTransform(center: L.LatLng, zoom: number): void {
    if ((this as unknown as RendererInternals & { readonly _center?: L.LatLng })._center === undefined) return;
    rendererPrototype._updateTransform.call(this, center, zoom);
  }

  /**
   * Holds the next draw (review MR-02): while a gesture's settle waits to be reported, a draw asked
   * for (Leaflet's `moveend`) waits for `release`, so the canvas draws once, with the settled
   * view's labels, after the controller's sync. Until then it keeps its picture, transformed as
   * during the gesture.
   */
  hold(): void {
    if (this.frlHeld) return;
    this.frlHeld = true;
    if (this.frlFrame !== null) {
      this.frlHooks.frames.cancel(this.frlFrame);
      this.frlFrame = null;
      this.frlWanted = true;
    }
  }

  /**
   * Ends a hold: a draw asked for meanwhile runs after the next frame (the one that redraws the
   * paths), in a task of its own where `tasks` is given, so the two are not one long frame.
   */
  release(): void {
    if (!this.frlHeld) return;
    this.frlHeld = false;
    if (!this.frlWanted) return;
    this.frlWanted = false;
    const tasks = this.frlHooks.tasks ?? null;
    if (tasks === null || this.frlFrame !== null) {
      this.requestDraw();
      return;
    }
    this.frlFrame = this.frlHooks.frames.request(() => {
      this.frlFrame = null;
      this.frlCancelTask = tasks.post(() => {
        this.frlCancelTask = null;
        this.drawNow();
      });
    });
  }

  /** Schedules one draw in the next frame; `rebound` also moves and resizes the canvas to the current view. */
  requestDraw(rebound = false): void {
    this.frlRebound ||= rebound;
    if (this.frlHeld) {
      this.frlWanted = true;
      return;
    }
    if (this.frlFrame !== null) return;
    this.frlFrame = this.frlHooks.frames.request(() => {
      this.frlFrame = null;
      this.drawNow();
    });
  }

  /** Draws at once (a scheduled frame, or tests), re-bounding first when a settled view asked for it or it was never bounded. */
  drawNow(): void {
    const self = this as unknown as RendererInternals;
    const map = self._map;
    const canvas = self._container;
    if (map === undefined || canvas === undefined) return;
    if (this.frlFrame !== null) {
      this.frlHooks.frames.cancel(this.frlFrame);
      this.frlFrame = null;
    }
    this.frlCancelTask?.();
    this.frlCancelTask = null;
    const rebound = this.frlRebound || self._bounds === undefined;
    this.frlRebound = false;
    if (rebound) rendererPrototype._update.call(this);
    const bounds = self._bounds;
    const min = bounds?.min;
    if (bounds === undefined || min === undefined) return;
    const size = bounds.getSize();
    const ratio = this.frlHooks.pixelRatio();
    const width = Math.max(0, Math.round(size.x * ratio));
    const height = Math.max(0, Math.round(size.y * ratio));
    if (rebound) {
      L.DomUtil.setPosition(canvas, min);
      canvas.style.width = `${String(size.x)}px`;
      canvas.style.height = `${String(size.y)}px`;
    }
    // Setting the size clears the canvas; a same-size redraw clears it explicitly.
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (size.x > 0 && size.y > 0) ctx.setTransform(width / size.x, 0, 0, height / size.y, 0, 0);
    ctx.translate(-min.x, -min.y);
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    const mapSize = map.getSize();
    const area: Box = { x0: topLeft.x, y0: topLeft.y, x1: topLeft.x + mapSize.x, y1: topLeft.y + mapSize.y };
    this.frlDraws += 1;
    this.frlHooks.perf.time('frl:map:labels', () => {
      this.frlHooks.draw(ctx, area);
    });
  }
}

/**
 * The outgoing picture of a canvas faded out over `ms` (§5.5): a transient copy in the same place
 * (same parent, classes, size and CSS transform), just above it, fading to transparent and then
 * removed. It takes no pointer events and hides during zoom animations. Returns the copy, or null
 * when nothing could be copied (no size, no 2D context, or `ms` 0: reduced motion).
 */
export function crossFadeOut(source: HTMLCanvasElement, ms: number, timers: { readonly set: (callback: () => void, ms: number) => number }): HTMLCanvasElement | null {
  const parent = source.parentElement;
  if (ms <= 0 || parent === null || source.width === 0 || source.height === 0) return null;
  const copy = source.ownerDocument.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  const ctx = copy.getContext('2d');
  if (ctx === null) return null;
  ctx.drawImage(source, 0, 0);
  copy.className = `${source.className} frl-map__fade leaflet-zoom-hide`;
  copy.setAttribute('aria-hidden', 'true');
  copy.style.cssText = source.style.cssText;
  copy.style.pointerEvents = 'none';
  copy.style.opacity = '1';
  copy.style.transition = `opacity ${String(ms)}ms linear`;
  source.after(copy);
  // Start the transition on the next style change: read a layout property, then set the target.
  void copy.offsetWidth;
  copy.style.opacity = '0';
  timers.set(() => {
    copy.remove();
  }, ms + 20);
  return copy;
}
