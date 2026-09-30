import * as L from 'leaflet';

/**
 * A continuous wheel zoom of our own (docs/research/map-atlas.md §8.4, MA-11; step ATL.8), in place
 * of Leaflet's `scrollWheelZoom`, which drops input during its 250 ms zoom animation.
 *
 * - Each `wheel` event (a non-passive listener; its default is prevented): `px = deltaY` in pixel
 *   mode, × 100/3 in line mode, × the container height in page mode, × 2 with `ctrlKey` (a trackpad
 *   pinch); `Δz = clamp(−px / R, −1, +1)`; the target zoom `= clamp(target + Δz, minZoom, maxZoom)`;
 *   the anchor is the pointer's container point and the map point under it.
 * - **Two rates** (MA-11): `R_stream` for a continuous stream (pixel mode, |deltaY| < 40, under
 *   30 ms after the previous event: trackpads and smooth-scrolling mice), `R_notch` for everything
 *   else (a mouse notch, line or page mode). Both start at 200 px per level (0.5 level per 100 px);
 *   ATL.9 calibrates them apart on the owner's hardware, where a notch's `deltaY` is UNKNOWN.
 * - The first event of a gesture stops any pan or fly animation and calls `map._moveStart(true,
 *   false)`. Each animation frame eases `z += (target − z)·(1 − e^(−dt/90 ms))` (snapped within
 *   0.002), keeps the anchor's map point under the pointer, **clamps the centre by
 *   `map._limitCenter`** to the map's `maxBounds`, and calls `map._move(centre, z, { pinch: true,
 *   round: false })`: no transition, every frame. With the clamp every frame, Leaflet's
 *   `_panInsideMaxBounds` finds nothing to correct at the settle, so there is no pan-back.
 * - 140 ms after the last event, once the target is reached: `map._moveEnd(true)`, the one
 *   `zoomend`/`moveend` of the gesture (one re-projection, redraw and sync).
 * - Reduced motion: each event jumps straight to its target (no easing); one settle 140 ms after
 *   the last event.
 * - No input is dropped: every event moves the target, whatever the frame rate.
 * - **Leaflet's own animated zoom** (the buttons, the keys; review MR-04): a gesture that starts
 *   while one runs takes it over. The animation has already moved the map to its target (Leaflet's
 *   `_animateZoom` does at its start), so its CSS transition is ended there, its `zoom` and `move`
 *   are fired as its own end would fire them, and its `moveend` is left to the gesture's settle:
 *   one settle for both, and the gesture goes on from the button's level. A button or key zoom
 *   during a gesture (`setZoom`, `zoomIn`, `zoomOut`, `setZoomAround`) moves the gesture's target
 *   by its step, about the view centre (or its own point), instead of starting a second animation
 *   whose end would jump the map back; any other `setView` during a gesture (a jump, a fit) ends
 *   the gesture first, leaving its settle to the new view's `moveend`.
 *
 * Leaflet 1.9.4 internals used: `Map._stop`, `_moveStart`, `_move` (and its `pinch` and `round`
 * flags), `_moveEnd`, `_limitCenter`, and of the animated zoom `_animatingZoom`, `_mapPane` and
 * `_tempFireZoomEvent`. Touch keeps Leaflet's `TouchZoom`.
 */

/** The clock and frame source (the page's by default; tests pass fakes). */
export interface WheelEnvironment {
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  now(): number;
}

export interface SmoothWheelOptions {
  /** Pixels of wheel input per zoom level for notch-like input (default 200). */
  readonly notchPxPerLevel?: number;
  /** Pixels of wheel input per zoom level for a continuous stream (default 200). */
  readonly streamPxPerLevel?: number;
  /** The settle, this long after the last event (default 140 ms). */
  readonly settleMs?: number;
  /** The easing time constant (default 90 ms). */
  readonly easeMs?: number;
  /** Reduced motion: no easing (default: the page's `prefers-reduced-motion` when enabled). */
  readonly reducedMotion?: boolean;
  readonly environment?: WheelEnvironment;
  /** After `_moveStart`, before the first frame's move. */
  readonly onGestureStart?: () => void;
  /** After each frame's `_move`. */
  readonly onFrame?: () => void;
  /** After the settle's `_moveEnd`. */
  readonly onGestureEnd?: () => void;
}

/** The first two rates (map-atlas.md §8.4): 0.5 level per 100 px. */
export const WHEEL_PX_PER_LEVEL = 200;
export const WHEEL_SETTLE_MS = 140;
export const WHEEL_EASE_MS = 90;
/** Snap to the target within this many levels. */
const SNAP = 0.002;
/** Pixel-mode events smaller than this, closer together than `STREAM_GAP_MS`, are a stream. */
const STREAM_DELTA_PX = 40;
const STREAM_GAP_MS = 30;
/** Line mode: 100/3 px per line (map-atlas.md §8.4). */
const LINE_PX = 100 / 3;

/** Leaflet 1.9.4 `Map` internals used by the handler. */
interface MapInternals {
  _stop(): L.Map;
  _moveStart(zoomChanged: boolean, noMoveStart: boolean): L.Map;
  _move(center: L.LatLng, zoom: number, data?: { readonly pinch?: boolean; readonly round?: boolean }): L.Map;
  _moveEnd(zoomChanged: boolean): L.Map;
  _limitCenter(center: L.LatLng, zoom: number, bounds: L.LatLngBounds): L.LatLng;
  /** True from an animated zoom's start (`_animateZoom`) to its end (`_onZoomTransitionEnd`). */
  _animatingZoom?: boolean;
  _mapPane?: HTMLElement;
  _tempFireZoomEvent?: boolean;
}

/** The map methods a gesture routes (review MR-04), bound to the map, as Leaflet 1.9.4 declares them. */
interface ZoomMethods {
  readonly setZoom: (zoom: number, options?: L.ZoomPanOptions) => L.Map;
  readonly setZoomAround: (position: L.Point | L.LatLngExpression, zoom: number, options?: L.ZoomOptions) => L.Map;
  readonly setView: (center: L.LatLngExpression, zoom?: number, options?: L.ZoomPanOptions) => L.Map;
}

const ROUTED = ['setZoom', 'setZoomAround', 'setView'] as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** The wheel input of one event in pixels (map-atlas.md §8.4): mode-scaled, doubled with `ctrlKey`. */
export function wheelPixels(event: Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'ctrlKey'>, containerHeight: number): number {
  const base = event.deltaMode === 1 ? event.deltaY * LINE_PX : event.deltaMode === 2 ? event.deltaY * containerHeight : event.deltaY;
  return event.ctrlKey ? base * 2 : base;
}

function pageEnvironment(view: (Window & typeof globalThis) | null): WheelEnvironment {
  return {
    requestFrame: (callback) => (view === null ? 0 : view.requestAnimationFrame(() => callback())),
    cancelFrame: (handle) => view?.cancelAnimationFrame(handle),
    now: () => (view === null ? Date.now() : view.performance.now()),
  };
}

export class SmoothWheel {
  private readonly map: L.Map;
  private readonly internals: MapInternals;
  private readonly notchRate: number;
  private readonly streamRate: number;
  private readonly settleMs: number;
  private readonly easeMs: number;
  private readonly options: SmoothWheelOptions;
  private environment: WheelEnvironment | null = null;
  private reduced = false;
  private container: HTMLElement | null = null;

  private active = false;
  private zoom = 0;
  private goal = 0;
  private anchorPoint: L.Point = L.point(0, 0);
  private anchorLatLng: L.LatLng = L.latLng(0, 0);
  private lastEventAt: number | null = null;
  private lastFrameAt = 0;
  private frame: number | null = null;
  private events = 0;
  private gestures = 0;
  /** The map's own zoom methods, while `enable` has replaced them on the map (review MR-04). */
  private own: ZoomMethods | null = null;

  private readonly onWheel = (event: WheelEvent): void => {
    this.wheel(event);
  };

  constructor(map: L.Map, options: SmoothWheelOptions = {}) {
    this.map = map;
    this.internals = map as unknown as MapInternals;
    this.notchRate = options.notchPxPerLevel ?? WHEEL_PX_PER_LEVEL;
    this.streamRate = options.streamPxPerLevel ?? WHEEL_PX_PER_LEVEL;
    this.settleMs = options.settleMs ?? WHEEL_SETTLE_MS;
    this.easeMs = options.easeMs ?? WHEEL_EASE_MS;
    this.options = options;
  }

  enable(): void {
    if (this.container !== null) return;
    const container = this.map.getContainer();
    const view = container.ownerDocument.defaultView;
    this.environment = this.options.environment ?? pageEnvironment(view);
    this.reduced =
      this.options.reducedMotion ?? (view !== null && typeof view.matchMedia === 'function' && view.matchMedia('(prefers-reduced-motion: reduce)').matches);
    container.addEventListener('wheel', this.onWheel, { passive: false });
    this.container = container;
    this.routeZooms();
  }

  /** Removes the listener and stops a gesture where it is (no settle: the map is going away or the handler is being replaced). */
  disable(): void {
    this.container?.removeEventListener('wheel', this.onWheel);
    this.container = null;
    if (this.frame !== null) this.environment?.cancelFrame(this.frame);
    this.frame = null;
    this.active = false;
    this.restoreZooms();
  }

  /**
   * Replaces the map's `setZoom`, `setZoomAround` and `setView` on this map object (Leaflet's
   * buttons, keys, `zoomIn` and `zoomOut` call them), so that during a gesture a zoom step moves the
   * gesture's target and any other view change ends the gesture first (review MR-04). Outside a
   * gesture each calls the map's own.
   */
  private routeZooms(): void {
    if (this.own !== null) return;
    const map = this.map;
    const own: ZoomMethods = { setZoom: map.setZoom.bind(map), setZoomAround: map.setZoomAround.bind(map), setView: map.setView.bind(map) };
    this.own = own;
    // Own properties of this map object, over the prototype's methods (`restoreZooms` deletes them).
    const routed: ZoomMethods = {
      setZoom: (zoom, options) => {
        if (!this.active) return own.setZoom(zoom, options);
        this.retarget(zoom - map.getZoom(), null);
        return map;
      },
      setZoomAround: (position, zoom, options) => {
        if (!this.active) return own.setZoomAround(position, zoom, options);
        this.retarget(zoom - map.getZoom(), position instanceof L.Point ? position : map.latLngToContainerPoint(L.latLng(position as L.LatLngTuple)));
        return map;
      },
      setView: (center, zoom, options) => {
        if (this.active) this.interrupt();
        return own.setView(center, zoom, options);
      },
    };
    Object.assign(map, routed);
  }

  /** Gives the map its own zoom methods back. */
  private restoreZooms(): void {
    if (this.own === null) return;
    for (const name of ROUTED) Reflect.deleteProperty(this.map, name);
    this.own = null;
  }

  /**
   * Moves the gesture's target by `delta` levels (a button or key zoom during a gesture, review
   * MR-04), about `anchor` (a container point) or the view centre; the settle waits for it as it
   * waits after a wheel event.
   */
  private retarget(delta: number, anchor: L.Point | null): void {
    const environment = this.environment;
    if (environment === null || !Number.isFinite(delta)) return;
    const map = this.map;
    this.goal = clamp(this.goal + delta, map.getMinZoom(), map.getMaxZoom());
    this.anchorPoint = anchor ?? map.getSize().divideBy(2);
    this.anchorLatLng = map.containerPointToLatLng(this.anchorPoint);
    this.lastEventAt = environment.now();
    if (this.reduced) {
      this.zoom = this.goal;
      this.moveTo(this.goal);
    }
    this.schedule();
  }

  /** Ends a gesture without its settle: a view change of the map's own is under way, and its `moveend` closes the gesture's move too. */
  private interrupt(): void {
    if (this.frame !== null) this.environment?.cancelFrame(this.frame);
    this.frame = null;
    this.active = false;
    this.lastEventAt = null;
    this.options.onGestureEnd?.();
  }

  /**
   * Takes over Leaflet's animated zoom if one is running (review MR-04): the map is already at its
   * target (`_animateZoom` moved it there), so the CSS transition is ended and the `zoom` and `move`
   * its end would fire are fired; its `moveend` is left to the gesture's settle. True when one was
   * taken over (its `zoomstart` and `movestart` have been fired already).
   */
  private takeOverZoomAnimation(): boolean {
    const internals = this.internals;
    if (internals._animatingZoom !== true) return false;
    const pane = internals._mapPane;
    if (pane !== undefined) L.DomUtil.removeClass(pane, 'leaflet-zoom-anim');
    internals._animatingZoom = false;
    const fireZoom = internals._tempFireZoomEvent === true;
    delete internals._tempFireZoomEvent;
    if (fireZoom) this.map.fire('zoom');
    this.map.fire('move');
    return true;
  }

  /** True between a gesture's first event and its settle. */
  get gesturing(): boolean {
    return this.active;
  }

  /** The zoom the gesture is heading to (the current zoom when idle). */
  get target(): number {
    return this.active ? this.goal : this.map.getZoom();
  }

  /** Wheel events handled and gestures started so far (tests and diagnostics). */
  counts(): { readonly events: number; readonly gestures: number } {
    return { events: this.events, gestures: this.gestures };
  }

  private wheel(event: WheelEvent): void {
    const environment = this.environment;
    if (environment === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.events += 1;
    const map = this.map;
    const now = environment.now();
    const px = wheelPixels(event, map.getSize().y);
    // A button's or key's zoom still animating: the gesture takes it over, from its level.
    const tookOver = !this.active && this.takeOverZoomAnimation();
    const stream = event.deltaMode === 0 && Math.abs(event.deltaY) < STREAM_DELTA_PX && this.lastEventAt !== null && now - this.lastEventAt < STREAM_GAP_MS;
    const rate = stream ? this.streamRate : this.notchRate;
    const delta = clamp(-px / rate, -1, 1);
    const from = this.active ? this.goal : map.getZoom();
    const goal = clamp(from + delta, map.getMinZoom(), map.getMaxZoom());
    this.lastEventAt = now;
    this.anchorPoint = map.mouseEventToContainerPoint(event);
    this.anchorLatLng = map.containerPointToLatLng(this.anchorPoint);
    if (!this.active) {
      // Nothing to do at a zoom limit: no gesture, no events (unless it took over an animation, whose `moveend` is the settle's).
      if (goal === from && !tookOver) return;
      this.start(now, tookOver);
    }
    this.goal = goal;
    if (this.reduced) {
      this.zoom = goal;
      this.moveTo(goal);
    }
    this.schedule();
  }

  private start(now: number, tookOver = false): void {
    const map = this.map;
    this.internals._stop();
    this.active = true;
    this.gestures += 1;
    this.zoom = map.getZoom();
    this.lastFrameAt = now;
    // A zoom animation taken over has fired its `zoomstart` and `movestart` already.
    if (!tookOver) this.internals._moveStart(true, false);
    this.options.onGestureStart?.();
  }

  private schedule(): void {
    const environment = this.environment;
    if (this.frame !== null || environment === null) return;
    this.frame = environment.requestFrame(() => {
      this.frame = null;
      this.step();
    });
  }

  /** One animation frame of the gesture. */
  private step(): void {
    const environment = this.environment;
    if (!this.active || environment === null) return;
    const now = environment.now();
    const dt = Math.max(0, now - this.lastFrameAt);
    this.lastFrameAt = now;
    if (this.zoom !== this.goal) {
      const next = this.reduced ? this.goal : this.zoom + (this.goal - this.zoom) * (1 - Math.exp(-dt / this.easeMs));
      this.zoom = Math.abs(this.goal - next) < SNAP ? this.goal : next;
      this.moveTo(this.zoom);
    }
    if (this.zoom === this.goal && this.lastEventAt !== null && now - this.lastEventAt >= this.settleMs) {
      this.settle();
      return;
    }
    this.schedule();
  }

  /** Moves the map to `zoom`, the anchor's point under the pointer, the centre clamped to the bounds (map-atlas.md §8.4, MA-11). */
  private moveTo(zoom: number): void {
    const map = this.map;
    const half = map.getSize().divideBy(2);
    let center = map.unproject(map.project(this.anchorLatLng, zoom).subtract(this.anchorPoint.subtract(half)), zoom);
    const bounds = map.options.maxBounds;
    if (bounds !== undefined && bounds !== null) center = this.internals._limitCenter(center, zoom, L.latLngBounds(bounds as L.LatLngBoundsLiteral));
    this.internals._move(center, zoom, { pinch: true, round: false });
    this.options.onFrame?.();
  }

  private settle(): void {
    this.active = false;
    this.lastEventAt = null;
    this.internals._moveEnd(true);
    this.options.onGestureEnd?.();
  }
}
