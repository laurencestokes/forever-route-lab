// @vitest-environment happy-dom
import * as L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SmoothWheel, wheelPixels, type SmoothWheelOptions, type WheelEnvironment } from './smooth-wheel';

/*
 * The smooth wheel (docs/research/map-atlas.md §8.4, MA-11; step ATL.8) on a real Leaflet map in
 * happy-dom, with fake animation frames and a fake clock: no dropped input, 0.5 level per 100 px,
 * the notch and stream rates apart, line and page modes, `ctrlKey` doubled, one `moveend` per
 * gesture, the centre clamped every frame (no pan-back), and reduced motion.
 */

/** Frames and a clock the test drives. */
function fakeFrames() {
  let now = 1000;
  let next = 1;
  const queue = new Map<number, () => void>();
  const environment: WheelEnvironment = {
    requestFrame: (callback) => {
      const handle = next;
      next += 1;
      queue.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      queue.delete(handle);
    },
    now: () => now,
  };
  /** Runs one frame `ms` after the last. */
  const frame = (ms = 16): void => {
    now += ms;
    const due = [...queue.values()];
    queue.clear();
    for (const callback of due) callback();
  };
  return {
    environment,
    frame,
    /** Lets `ms` pass without a frame (events come faster than frames). */
    wait: (ms: number): void => {
      now += ms;
    },
    /** Runs frames until none is requested (the gesture settled), at most `limit`. */
    settle: (limit = 400): number => {
      let frames = 0;
      while (queue.size > 0 && frames < limit) {
        frame();
        frames += 1;
      }
      return frames;
    },
    pending: (): number => queue.size,
  };
}

let sizes: { width: PropertyDescriptor | undefined; height: PropertyDescriptor | undefined };
let maps: L.Map[];

beforeEach(() => {
  maps = [];
  sizes = {
    width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
    height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
  };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
});

afterEach(() => {
  for (const map of maps) map.remove();
  const restore = (key: 'clientWidth' | 'clientHeight', descriptor: PropertyDescriptor | undefined): void => {
    if (descriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, key);
    else Object.defineProperty(HTMLElement.prototype, key, descriptor);
  };
  restore('clientWidth', sizes.width);
  restore('clientHeight', sizes.height);
  document.body.innerHTML = '';
});

function setup(zoom = -4, options: SmoothWheelOptions = {}) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const map = L.map(element, { crs: L.CRS.Simple, minZoom: -8, maxZoom: 2, zoomSnap: 0, scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false });
  map.setView([-13056, 15360], zoom, { animate: false });
  maps.push(map);
  const frames = fakeFrames();
  const wheel = new SmoothWheel(map, { environment: frames.environment, reducedMotion: false, ...options });
  wheel.enable();
  const events: string[] = [];
  for (const type of ['movestart', 'zoomstart', 'moveend', 'zoomend'] as const) {
    map.on(type, () => {
      events.push(type);
    });
  }
  const send = (init: WheelEventInit): WheelEvent => {
    const full: WheelEventInit = { clientX: 400, clientY: 300, deltaMode: 0, ctrlKey: false, bubbles: true, cancelable: true, ...init };
    const event = new WheelEvent('wheel', full);
    // happy-dom's WheelEvent leaves out the MouseEvent fields: set what the handler reads.
    for (const key of ['clientX', 'clientY', 'deltaY', 'deltaMode', 'ctrlKey'] as const) {
      if (event[key] !== full[key]) Object.defineProperty(event, key, { value: full[key] });
    }
    element.dispatchEvent(event);
    return event;
  };
  return { map, wheel, frames, events, send };
}

describe('wheelPixels (map-atlas.md §8.4)', () => {
  it('takes pixel mode as is, line mode at 100/3 px a line, page mode at the container height, doubled with ctrlKey', () => {
    expect(wheelPixels({ deltaY: 100, deltaMode: 0, ctrlKey: false }, 600)).toBe(100);
    expect(wheelPixels({ deltaY: 3, deltaMode: 1, ctrlKey: false }, 600)).toBeCloseTo(100, 12);
    expect(wheelPixels({ deltaY: 1, deltaMode: 2, ctrlKey: false }, 600)).toBe(600);
    expect(wheelPixels({ deltaY: 50, deltaMode: 0, ctrlKey: true }, 600)).toBe(100);
  });
});

describe('SmoothWheel (map-atlas.md §8.4)', () => {
  it('moves 0.5 level per 100 px, out for a positive deltaY and in for a negative one', () => {
    const s = setup(-4);
    const event = s.send({ deltaY: 100 });
    expect(event.defaultPrevented).toBe(true);
    expect(s.wheel.target).toBe(-4.5);
    s.frames.settle();
    expect(s.map.getZoom()).toBe(-4.5);
    s.send({ deltaY: -100 });
    s.frames.settle();
    expect(s.map.getZoom()).toBe(-4);
  });

  it('drops no input: every event moves the target, however fast they come', () => {
    const s = setup(-6);
    for (let i = 0; i < 10; i += 1) {
      s.send({ deltaY: -100 });
      s.frames.wait(5);
      // A frame only every third event.
      if (i % 3 === 2) s.frames.frame(1);
    }
    expect(s.wheel.target).toBe(-1);
    expect(s.wheel.counts()).toEqual({ events: 10, gestures: 1 });
    s.frames.settle();
    expect(s.map.getZoom()).toBe(-1);
  });

  it('takes a continuous stream at its own rate, apart from notches', () => {
    const s = setup(-4, { notchPxPerLevel: 200, streamPxPerLevel: 400 });
    // The first small event has no predecessor: notch rate, 10/200.
    s.send({ deltaY: -10 });
    expect(s.wheel.target).toBeCloseTo(-3.95, 12);
    // Then small events under 30 ms apart: stream rate, 10/400 each.
    for (let i = 0; i < 4; i += 1) {
      s.frames.wait(10);
      s.send({ deltaY: -10 });
    }
    expect(s.wheel.target).toBeCloseTo(-3.85, 12);
    // A notch-sized event (|deltaY| ≥ 40) inside the stream: notch rate.
    s.frames.wait(10);
    s.send({ deltaY: -100 });
    expect(s.wheel.target).toBeCloseTo(-3.35, 12);
    // A small event after a pause of 30 ms or more: notch rate again.
    s.frames.wait(40);
    s.send({ deltaY: -10 });
    expect(s.wheel.target).toBeCloseTo(-3.3, 12);
  });

  it('reads line and page modes, clamps one event to one level, and doubles ctrlKey (a trackpad pinch)', () => {
    const s = setup(-4);
    s.send({ deltaY: -3, deltaMode: 1 });
    expect(s.wheel.target).toBeCloseTo(-3.5, 12);
    s.send({ deltaY: -1, deltaMode: 2 });
    expect(s.wheel.target).toBeCloseTo(-2.5, 12);
    s.send({ deltaY: -0.1, deltaMode: 2 });
    expect(s.wheel.target).toBeCloseTo(-2.2, 12);
    s.send({ deltaY: -50, ctrlKey: true });
    expect(s.wheel.target).toBeCloseTo(-1.7, 12);
  });

  it('starts and ends a gesture once: one movestart, one zoomend and one moveend however many events', () => {
    const s = setup(-4);
    const moves: number[] = [];
    s.map.on('move', () => moves.push(s.map.getZoom()));
    for (let i = 0; i < 5; i += 1) {
      s.send({ deltaY: -100 });
      s.frames.frame(20);
    }
    expect(s.events).toEqual(['zoomstart', 'movestart']);
    expect(s.wheel.gesturing).toBe(true);
    const frames = s.frames.settle();
    expect(frames).toBeGreaterThan(5);
    expect(s.events).toEqual(['zoomstart', 'movestart', 'zoomend', 'moveend']);
    expect(s.wheel.gesturing).toBe(false);
    expect(s.map.getZoom()).toBe(-1.5);
    // The zoom eased up every frame, never past the target.
    expect(moves.length).toBeGreaterThan(5);
    expect(moves.every((zoom, i) => i === 0 || zoom >= (moves[i - 1] ?? -Infinity))).toBe(true);
    // The next event starts a new gesture.
    s.send({ deltaY: 100 });
    s.frames.settle();
    expect(s.events.filter((type) => type === 'moveend')).toHaveLength(2);
    expect(s.wheel.counts().gestures).toBe(2);
  });

  it('settles 140 ms after the last event, once the target is reached', () => {
    // A step the first frame reaches (under the 0.002 snap): the settle waits for the 140 ms.
    const small = setup(-4);
    small.send({ deltaY: -0.2 });
    let elapsed = 0;
    while (!small.events.includes('moveend') && elapsed < 1000) {
      small.frames.frame(5);
      elapsed += 5;
    }
    expect(elapsed).toBe(140);
    expect(small.map.getZoom()).toBeCloseTo(-3.999, 12);
    // A 0.5-level step eases for longer than 140 ms (within 0.002 after about 5.5 time constants of
    // 90 ms): the settle comes on the first frame at the target.
    const s = setup(-4);
    s.send({ deltaY: -100 });
    const zooms: number[] = [];
    elapsed = 0;
    while (!s.events.includes('moveend') && elapsed < 2000) {
      s.frames.frame(5);
      elapsed += 5;
      zooms.push(s.map.getZoom());
    }
    expect(elapsed).toBeGreaterThan(140);
    expect(s.map.getZoom()).toBe(-3.5);
    expect(zooms.indexOf(-3.5)).toBe(zooms.length - 1);
    expect(Math.abs((zooms.at(-2) ?? 0) + 3.5)).toBeLessThan(0.0025);
  });

  it('keeps the map point under the pointer where it was', () => {
    const s = setup(-4);
    const pointer = L.point(100, 150);
    const before = s.map.containerPointToLatLng(pointer);
    s.send({ deltaY: -100, clientX: 100, clientY: 150 });
    s.frames.settle();
    const after = s.map.containerPointToLatLng(pointer);
    expect(s.map.getZoom()).toBe(-3.5);
    expect(Math.abs(after.lat - before.lat)).toBeLessThan(2 ** 4);
    expect(Math.abs(after.lng - before.lng)).toBeLessThan(2 ** 4);
  });

  it('clamps the centre to the bounds every frame, so nothing pans back at the settle', () => {
    const s = setup(-3);
    const bounds = L.latLngBounds([-26112, 0], [0, 30720]).pad(0.5);
    s.map.setMaxBounds(bounds);
    // Near the bounds' west edge, zooming out around a pointer at the stage's west edge.
    s.map.setView([-13056, -10000], -3, { animate: false });
    const limit = s.map as unknown as { _limitCenter(center: L.LatLng, zoom: number, bounds: L.LatLngBounds): L.LatLng };
    const offBounds: string[] = [];
    s.map.on('move', () => {
      const center = s.map.getCenter();
      const zoom = s.map.getZoom();
      const clamped = limit._limitCenter(center, zoom, bounds);
      const a = s.map.project(center, zoom);
      const b = s.map.project(clamped, zoom);
      if (Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1) offBounds.push(`${zoom.toFixed(3)}: ${String(a.x - b.x)}, ${String(a.y - b.y)}`);
    });
    for (let i = 0; i < 3; i += 1) {
      s.send({ deltaY: 100, clientX: 0, clientY: 300 });
      s.frames.frame(16);
    }
    let settledAt: L.LatLng | null = null;
    let movesAfterSettle = 0;
    s.map.on('moveend', () => {
      settledAt = s.map.getCenter();
    });
    s.map.on('move', () => {
      if (settledAt !== null) movesAfterSettle += 1;
    });
    s.frames.settle();
    expect(offBounds).toEqual([]);
    expect(settledAt).not.toBeNull();
    // Leaflet's `_panInsideMaxBounds` runs on moveend: it found nothing to correct.
    expect(movesAfterSettle).toBe(0);
    expect(s.map.getCenter()).toEqual(settledAt);
    expect(s.map.getZoom()).toBe(-4.5);
  });

  it('under reduced motion, jumps to each target at once and settles once, 140 ms after the last event', () => {
    const s = setup(-4, { reducedMotion: true });
    s.send({ deltaY: -100 });
    expect(s.map.getZoom()).toBe(-3.5);
    s.frames.frame(50);
    s.send({ deltaY: -100 });
    expect(s.map.getZoom()).toBe(-3);
    s.frames.frame(100);
    expect(s.events).not.toContain('moveend');
    s.frames.frame(50);
    expect(s.events).toEqual(['zoomstart', 'movestart', 'zoomend', 'moveend']);
  });

  it('starts no gesture at a zoom limit', () => {
    const s = setup(2);
    const event = s.send({ deltaY: -100 });
    expect(event.defaultPrevented).toBe(true);
    expect(s.wheel.gesturing).toBe(false);
    expect(s.frames.pending()).toBe(0);
    expect(s.events).toEqual([]);
    s.send({ deltaY: 400 });
    expect(s.wheel.target).toBe(1);
  });

  it('calls its hooks: start before the first move, a frame after each move, end after the settle', () => {
    const calls: string[] = [];
    const s = setup(-4, {
      onGestureStart: () => calls.push('start'),
      onFrame: () => calls.push('frame'),
      onGestureEnd: () => calls.push('end'),
    });
    s.send({ deltaY: -100 });
    s.frames.settle();
    expect(calls[0]).toBe('start');
    expect(calls.at(-1)).toBe('end');
    expect(calls.filter((call) => call === 'frame').length).toBeGreaterThan(1);
    expect(calls.filter((call) => call === 'start' || call === 'end')).toEqual(['start', 'end']);
  });

  it('stops listening when disabled', () => {
    const s = setup(-4);
    s.wheel.disable();
    s.send({ deltaY: -100 });
    expect(s.wheel.counts().events).toBe(0);
    expect(s.map.getZoom()).toBe(-4);
    // And gives the map its own zoom methods back.
    expect(Object.hasOwn(s.map, 'setZoom')).toBe(false);
    s.map.setZoom(-3, { animate: false });
    expect(s.map.getZoom()).toBe(-3);
  });
});

/*
 * Review MR-04: the wheel and Leaflet's own animated zoom (the buttons, the keys) moved the map at
 * once: a button's animation ended by jumping to its level in the middle of a wheel gesture, and a
 * button pressed during a gesture was lost when the gesture's frames went on to the wheel's target.
 */
describe('SmoothWheel with the buttons and keys (review MR-04)', () => {
  /** What Leaflet 1.9.4's `_tryAnimatedZoom` and `_animateZoom` leave while a button's zoom animates: the map moved to the target (events held back), the pane's animation class, the flags. */
  function animateTo(map: L.Map, zoom: number): void {
    const internals = map as unknown as {
      _moveStart(zoomChanged: boolean, noMoveStart: boolean): L.Map;
      _move(center: L.LatLng, zoom: number, data: undefined, supressEvent: boolean): L.Map;
      _animatingZoom: boolean;
      _animateToCenter: L.LatLng;
      _animateToZoom: number;
      _tempFireZoomEvent: boolean;
      _mapPane: HTMLElement;
    };
    const center = map.getCenter();
    internals._moveStart(true, false);
    internals._animatingZoom = true;
    internals._animateToCenter = center;
    internals._animateToZoom = zoom;
    L.DomUtil.addClass(internals._mapPane, 'leaflet-zoom-anim');
    internals._tempFireZoomEvent = true;
    internals._move(center, zoom, undefined, true);
  }
  const transitionEnd = (map: L.Map): void => {
    (map as unknown as { _onZoomTransitionEnd(): void })._onZoomTransitionEnd();
  };

  it('takes over a button’s zoom still animating: from its level, one settle for both, and the animation’s end does nothing', () => {
    const s = setup(-3);
    const zooms: number[] = [];
    s.map.on('zoom', () => zooms.push(s.map.getZoom()));
    // Zoom in (to −2), then the wheel out 60 ms later, before the animation's 250 ms end.
    animateTo(s.map, -2);
    s.send({ deltaY: 100 });
    const pane = (s.map as unknown as { _mapPane: HTMLElement })._mapPane;
    expect(pane.classList.contains('leaflet-zoom-anim')).toBe(false);
    expect(s.wheel.target).toBe(-2.5);
    s.frames.frame();
    transitionEnd(s.map);
    s.frames.settle();
    expect(s.map.getZoom()).toBe(-2.5);
    // One gesture: one zoomstart and movestart (the animation's), one zoomend and moveend (the settle's).
    expect(s.events).toEqual(['zoomstart', 'movestart', 'zoomend', 'moveend']);
    // Never back to the button's level once the wheel has moved away from it.
    const firstBelow = zooms.findIndex((zoom) => zoom < -2);
    expect(firstBelow).toBeGreaterThanOrEqual(0);
    expect(zooms.slice(firstBelow).every((zoom) => zoom < -2)).toBe(true);
  });

  it('adds a button’s or key’s step to a gesture’s target, and loses none', () => {
    const s = setup(-2);
    // Wheel in (to −1.5), then Zoom out 80 ms later: the target moves by −1, to −2.5.
    s.send({ deltaY: -100 });
    s.frames.frame(40);
    s.frames.frame(40);
    s.map.zoomOut(1);
    expect(s.wheel.target).toBe(-2.5);
    // A key (`setZoom(getZoom() + 1)`, as Leaflet's keyboard handler does) adds its step too.
    s.map.setZoom(s.map.getZoom() + 1);
    expect(s.wheel.target).toBe(-1.5);
    s.map.zoomOut(1);
    s.frames.settle();
    expect(s.map.getZoom()).toBe(-2.5);
    expect(s.events).toEqual(['zoomstart', 'movestart', 'zoomend', 'moveend']);
    expect(s.wheel.counts().gestures).toBe(1);
    // Outside a gesture the map's own methods run (happy-dom has no 3D transforms, so Leaflet snaps them to whole levels here).
    s.map.zoomIn(0.5, { animate: false });
    expect(s.map.getZoom()).toBe(-2);
    expect(s.wheel.gesturing).toBe(false);
  });

  it('zooms about the point a double click gives (`setZoomAround`) during a gesture', () => {
    const s = setup(-3);
    s.send({ deltaY: -100 });
    const point = L.point(100, 150);
    const before = s.map.containerPointToLatLng(point);
    s.map.setZoomAround(point, s.map.getZoom() + 1);
    expect(s.wheel.target).toBe(-1.5);
    s.frames.settle();
    const after = s.map.containerPointToLatLng(point);
    expect(Math.abs(after.lat - before.lat)).toBeLessThan(2 ** 3);
    expect(Math.abs(after.lng - before.lng)).toBeLessThan(2 ** 3);
  });

  it('ends a gesture when the view is set otherwise (a jump), leaving the settle to that view', () => {
    const s = setup(-3);
    const ends: string[] = [];
    const wheel = new SmoothWheel(s.map, { environment: s.frames.environment, reducedMotion: false, onGestureEnd: () => ends.push('end') });
    s.wheel.disable();
    wheel.enable();
    s.send({ deltaY: -100 });
    s.frames.frame();
    s.map.setView([-13000, 15000], -5, { animate: false });
    expect(wheel.gesturing).toBe(false);
    expect(ends).toEqual(['end']);
    s.frames.settle();
    expect(s.map.getZoom()).toBe(-5);
    expect(s.events.filter((type) => type === 'moveend')).toHaveLength(1);
  });
});
