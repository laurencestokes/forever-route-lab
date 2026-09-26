import type { StepId } from '../domain/ids';
import type { Location, WorldPoint } from '../domain/points';
import type { RouteStep } from '../domain/route';
import type { TravelEndpoint } from '../domain/travel';
import type { ZoneHintResolver } from '../engine/types';
import { resolve } from '../geo/resolve';
import type { MapGeometry } from '../geo/types';
import type { MapView, RouteLeg, RoutePathsInput } from '../map/adapter';
import { isWalkable, navLegRequest, type NavLegRequest } from './navigation-legs';
import type { NavigationTravelModel } from './navigation-model';
import type { NavigationRuntime } from './navigation-runtime';
import { defaultNavTimers, type NavigationBatch, type NavTimers } from './navigation-scheduler';
import type { EditorStore } from './store';

/**
 * Walking paths for the map's route line (MAPS §7.4; terrain-navigation.md §9.3 `path()`): the
 * `RoutePathsInput` the map controller draws walked legs from, fed by the navigation model's path
 * cache and kept cheap for long routes:
 *
 * - **One record per walked leg.** The feed keeps, per leg (by its first step), the leg's request
 *   (built once, so no key string is rebuilt per pass) and its answer once known: a path, or none.
 *   An answer is copied from the model's small path LRU when it arrives, so the LRU evicting it
 *   later changes nothing, and a decided leg is never asked again while it stays the same leg (same
 *   steps, same points). Records of legs no longer drawn are dropped.
 * - **Only legs being drawn ask for a path.** A leg on another world map than the one shown gets
 *   no answer (it is not drawn there). A leg on the shown map whose path is not known is requested
 *   from the worker only when it lies in the view (padded) or when the map has few legs, at most
 *   `maxRequests` per paths object, and once (the path cache never records a path already asked),
 *   so a 10,000-step route never floods the worker, and more legs in view than the 256-path LRU
 *   holds still settle. Panning requests the legs that come into view.
 * - **Batches, not per path.** A new `RoutePathsInput` object (which makes the map rebuild the
 *   route layers) is issued when answers for legs it waits for arrived, at most every
 *   `minIntervalMs` (250 ms), when the shown world map changes, and when undecided legs come into
 *   view.
 * - **Pending.** An object is `pending` while a leg in the view (padded), or one that was
 *   requested, has no answer yet, so such legs are drawn as pending, never as a straight-line
 *   fallback. A leg that has no walking path (another component, no navigation on the map) is
 *   decided; once every leg in view is decided, the next object is not pending and those legs are
 *   drawn as fallbacks. (Out-of-view legs never requested do not hold the whole object pending: the
 *   adapter's pending flag is per object, not per leg.)
 * - **Endpoints** are the steps' authored locations with the zone hints the engine uses
 *   (src/app/derived-context.ts), so a drawn path is the one the walk priced when the two agree.
 */

export interface RoutePathFeed {
  /** The paths the route line follows now, or null (no navigation model: every leg straight). */
  readonly current: () => RoutePathsInput | null;
  /** Called when `current` changes to a new object. */
  readonly subscribe: (listener: () => void) => () => void;
  /** The map's view (the controller calls it on every move and surface change); null when unmounted. */
  readonly setView: (view: MapView | null) => void;
  /** The navigation model (the pipeline calls it); null for none. */
  readonly setModel: (model: NavigationTravelModel | null, runtime: NavigationRuntime | null, hints: ZoneHintResolver) => void;
  /**
   * Walked legs the current object drew with no answer that do not hold it pending: outside the
   * view and never asked for (the map's walking-paths note counts them apart).
   */
  readonly outOfView: () => number;
  readonly dispose: () => void;
}

export interface RoutePathFeedOptions {
  /** Where step locations come from (for the endpoints' zone hints). */
  readonly store: Pick<EditorStore, 'getState'>;
  readonly geometry: MapGeometry;
  readonly timers?: NavTimers;
  /** Monotonic ms; default 0. */
  readonly now?: () => number;
  /** Least ms between two paths objects (default 250). */
  readonly minIntervalMs?: number;
  /** Most path requests per paths object (default 64). */
  readonly maxRequests?: number;
  /** A map with at most this many walked legs asks for all of them, in view or not (default 64). */
  readonly smallRouteLegs?: number;
  /** View padding, as a fraction of the view's width and height on each side (default 0.25). */
  readonly padding?: number;
}

/** What the feed knows of one walked leg. */
interface LegRecord {
  readonly toStepId: StepId;
  readonly mapId: number;
  readonly fx: number;
  readonly fy: number;
  readonly tx: number;
  readonly ty: number;
  /** The leg as last drawn (for the view checks). */
  leg: RouteLeg;
  /** The worker request, built once; null until needed. */
  request: NavLegRequest | null;
  /** The path, null for a leg without one, undefined while unknown. */
  answer: readonly WorldPoint[] | null | undefined;
  /** Asked of the worker (and not lost since). */
  requested: boolean;
  /** The last paths object that drew it. */
  seen: Pass | null;
}

/** One paths object's bookkeeping. */
interface Pass {
  readonly input: RoutePathsInput;
  /** Walked legs on the shown map this object drew. */
  asked: number;
  /** Its undecided legs. */
  readonly waiting: Set<LegRecord>;
  requests: number;
  /** A check after the pass is scheduled. */
  checking: boolean;
  /** Records not drawn by this object were dropped (after its first full drawing). */
  swept: boolean;
}

const samePoint = (a: WorldPoint, b: WorldPoint): boolean => a.mapId === b.mapId && a.x === b.x && a.y === b.y;

/** Records beyond those one drawing uses that are kept before the unused ones are dropped. */
const RECORD_SLACK = 1024;

export function createRoutePathFeed(options: RoutePathFeedOptions): RoutePathFeed {
  const { store, geometry } = options;
  const timers = options.timers ?? defaultNavTimers;
  const now = options.now ?? (() => 0);
  const minIntervalMs = options.minIntervalMs ?? 250;
  const maxRequests = options.maxRequests ?? 64;
  const smallRouteLegs = options.smallRouteLegs ?? 64;
  const padding = options.padding ?? 0.25;
  const listeners = new Set<() => void>();

  let model: NavigationTravelModel | null = null;
  let hints: ZoneHintResolver | null = null;
  let unsubscribeBatches: (() => void) | null = null;
  let view: MapView | null = null;
  let pass: Pass | null = null;
  let issueTimer: unknown = null;
  let lastIssued = Number.NEGATIVE_INFINITY;
  let disposed = false;

  /** Walked legs by their first step (a step starts at most one walked leg). */
  const records = new Map<StepId, LegRecord>();

  // Step locations by id, rebuilt only when a step is not found where the map placed it.
  let locations = new Map<StepId, Location | null>();

  function rebuildLocations(): void {
    const steps: readonly RouteStep[] = store.getState().project.route.steps;
    locations = new Map(steps.map((step) => [step.id, step.location]));
  }

  const placedAt = (location: Location | null | undefined, point: WorldPoint): location is Location => {
    if (location === null || location === undefined) return false;
    const world = resolve(location, geometry);
    return world !== null && samePoint(world, point);
  };

  function endpointOf(stepId: StepId, point: WorldPoint): TravelEndpoint {
    let location = locations.get(stepId);
    if (!placedAt(location, point)) {
      rebuildLocations();
      location = locations.get(stepId);
    }
    const hint = placedAt(location, point) && hints !== null ? hints.routePoint(location.source, point) : 0;
    return { point, zoneHint: hint };
  }

  function inView(leg: RouteLeg): boolean {
    const bounds = view?.bounds ?? null;
    if (bounds === null || bounds === undefined) return true;
    if (bounds.mapId !== leg.from.mapId) return false;
    const padX = (bounds.xMax - bounds.xMin) * padding;
    const padY = (bounds.yMax - bounds.yMin) * padding;
    const xMin = Math.min(leg.from.x, leg.to.x);
    const xMax = Math.max(leg.from.x, leg.to.x);
    const yMin = Math.min(leg.from.y, leg.to.y);
    const yMax = Math.max(leg.from.y, leg.to.y);
    return xMax >= bounds.xMin - padX && xMin <= bounds.xMax + padX && yMax >= bounds.yMin - padY && yMin <= bounds.yMax + padY;
  }

  /** The record of `leg`, new when the leg changed (other steps or points). */
  function recordOf(leg: RouteLeg): LegRecord {
    const r = records.get(leg.fromStepId);
    if (r !== undefined && r.toStepId === leg.toStepId && r.mapId === leg.from.mapId && r.fx === leg.from.x && r.fy === leg.from.y && r.tx === leg.to.x && r.ty === leg.to.y) {
      r.leg = leg;
      return r;
    }
    const fresh: LegRecord = { toStepId: leg.toStepId, mapId: leg.from.mapId, fx: leg.from.x, fy: leg.from.y, tx: leg.to.x, ty: leg.to.y, leg, request: null, answer: undefined, requested: false, seen: null };
    records.set(leg.fromStepId, fresh);
    return fresh;
  }

  /** Decides a record from the model's table and path cache, when they know its answer. */
  function decide(m: NavigationTravelModel, r: LegRecord): void {
    if (!m.hasNavigation(r.mapId)) {
      r.answer = null;
      return;
    }
    r.request ??= navLegRequest(m.revision, endpointOf(r.leg.fromStepId, r.leg.from), endpointOf(r.leg.toStepId, r.leg.to));
    const entry = m.table.get(r.request.key);
    if (entry !== undefined && !isWalkable(entry)) {
      r.answer = null;
      return;
    }
    const cached = m.paths.get(r.request.key);
    if (cached !== undefined) r.answer = cached;
    // A request the path cache dropped (its waiting list is bounded) is made again.
    else if (r.requested && !m.paths.isWaiting(r.request.key)) r.requested = false;
  }

  function request(p: Pass, r: LegRecord): void {
    const m = model;
    if (m === null || r.requested || r.request === null || p.requests >= maxRequests) return;
    r.requested = true;
    p.requests += 1;
    m.paths.recordMissing(r.request);
  }

  /** Whether an undecided record holds the drawing pending: it is in view, or it was asked for. */
  const holdsPending = (r: LegRecord): boolean => r.requested || inView(r.leg);

  /** After a pass: request what the map has few enough legs to ask in full, settle `pending`, drop unused records. */
  function afterPass(p: Pass): void {
    p.checking = false;
    if (pass !== p || disposed) return;
    if (!p.swept) {
      p.swept = true;
      if (records.size > p.asked + RECORD_SLACK) for (const [id, r] of records) if (r.seen !== p) records.delete(id);
    }
    if (p.waiting.size > 0 && p.asked <= smallRouteLegs) for (const r of p.waiting) request(p, r);
    // Everything that holds the drawing pending is decided, but this object said "pending": issue one that does not.
    if (p.input.pending && p.asked > 0 && ![...p.waiting].some(holdsPending)) scheduleIssue();
  }

  function pathOf(p: Pass, leg: RouteLeg): readonly WorldPoint[] | null {
    const m = model;
    if (m === null || view === null || leg.from.mapId !== view.mapId || leg.to.mapId !== leg.from.mapId) return null;
    if (!p.checking) {
      p.checking = true;
      timers.set(() => {
        afterPass(p);
      }, 0);
    }
    const r = recordOf(leg);
    if (r.seen !== p) {
      r.seen = p;
      p.asked += 1;
    }
    if (r.answer === undefined) decide(m, r);
    if (r.answer !== undefined) {
      p.waiting.delete(r);
      return r.answer;
    }
    p.waiting.add(r);
    if (inView(leg)) request(p, r);
    return null;
  }

  function newPass(pending: boolean): Pass {
    const p: Pass = {
      input: {
        pathOf: (leg) => pathOf(p, leg),
        pending,
      },
      asked: 0,
      waiting: new Set(),
      requests: 0,
      checking: false,
      swept: false,
    };
    return p;
  }

  function issue(): void {
    if (issueTimer !== null) {
      timers.clear(issueTimer);
      issueTimer = null;
    }
    if (disposed) return;
    const previous = pass;
    // Pending until the previous pass showed every leg that matters decided (in view or asked).
    const pending = previous === null || previous.asked === 0 || [...previous.waiting].some((r) => r.answer === undefined && holdsPending(r));
    pass = model === null ? null : newPass(pending);
    lastIssued = now();
    for (const listener of [...listeners]) listener();
  }

  function scheduleIssue(): void {
    if (disposed || issueTimer !== null) return;
    issueTimer = timers.set(issue, Math.max(0, lastIssued + minIntervalMs - now()));
  }

  function onBatch(batch: NavigationBatch): void {
    const p = pass;
    const m = model;
    if (p === null || m === null) return;
    if (batch.unavailable.length > 0) {
      // A map lost its navigation: every answer on it changes (no path any more).
      records.clear();
      scheduleIssue();
      return;
    }
    if (batch.paths === 0 && batch.legs === 0) return;
    // A new object only when an answer this one waits for has arrived: a path, or a leg found to
    // have none.
    for (const r of p.waiting) {
      if (!r.requested || r.request === null) continue;
      const entry = m.table.get(r.request.key);
      if ((entry !== undefined && !isWalkable(entry)) || m.paths.get(r.request.key) !== undefined) {
        scheduleIssue();
        return;
      }
    }
  }

  return {
    current: () => pass?.input ?? null,
    outOfView() {
      let n = 0;
      if (pass !== null) for (const r of pass.waiting) if (r.answer === undefined && !holdsPending(r)) n += 1;
      return n;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setView(next) {
      const previous = view;
      view = next;
      if (next === null || pass === null) return;
      if (previous === null ? pass.asked > 0 : previous.mapId !== next.mapId) {
        // Another world map (or legs asked before there was a view): they were never asked with
        // this object on the map now shown.
        scheduleIssue();
        return;
      }
      const p = pass;
      let cameIntoView = false;
      for (const r of p.waiting) {
        if (r.requested || !inView(r.leg)) continue;
        cameIntoView = true;
        request(p, r);
      }
      // Undecided legs came into view under an object that is not pending: they must be drawn as
      // pending, not as fallbacks.
      if (cameIntoView && !p.input.pending) scheduleIssue();
    },
    setModel(next, runtime, nextHints) {
      if (next === model) return;
      unsubscribeBatches?.();
      unsubscribeBatches = runtime?.scheduler.subscribe(onBatch) ?? null;
      model = next;
      hints = nextHints;
      records.clear();
      // A new model answers differently: start over at once.
      pass = null;
      issue();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (issueTimer !== null) timers.clear(issueTimer);
      issueTimer = null;
      unsubscribeBatches?.();
      listeners.clear();
    },
  };
}
