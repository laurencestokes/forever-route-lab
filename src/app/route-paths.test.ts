import { describe, expect, it } from 'vitest';
import { type RouteStep, sequentialIdSource, stepId, worldMapId } from '../domain';
import type { MapContainer, MapDescriptor, RouteLeg } from '../map/adapter';
import type { NavLegQuery } from '../nav/worker/protocol';
import { fixedClock } from './clock';
import { projectRules, projectTravelGraph, selectTravelModel } from './derived-context';
import { createMapController } from './map-controller';
import { acceptStepsAt, fakeAdapterFactory, MAP_TEST_DATASET, mapTestSteps, mapTestWorkspace } from './map-test-helpers';
import { navLegEntryOf, navLegRequest } from './navigation-legs';
import { createNavigationRuntime } from './navigation-runtime';
import { endpoint, ManualTimers, otherComponent, testNavManifest } from './navigation-test-helpers';
import { createRoutePathFeed, type RoutePathFeedOptions } from './route-paths';
import { createEditorStore } from './store';
import { MAP_WORDING } from './map-wording';

/**
 * Map path wiring (MAPS §7.4; terrain-navigation.md §9.3 `path()`): the navigation model's paths
 * reach the route line through the feed and the map controller, requested only for legs being
 * drawn, in batches, pending until every leg on the shown map is decided.
 */

const T0 = '2026-09-25T12:00:00.000Z';
const EL: MapContainer = { nodeType: 1, ownerDocument: null };

/** A worker stand-in that answers path requests by hand. */
class PathService {
  readonly pathCalls: { readonly query: NavLegQuery; readonly resolve: (p: readonly number[] | null) => void }[] = [];
  legs = () => new Promise<never>(() => undefined);
  path(query: NavLegQuery): Promise<readonly number[] | null> {
    return new Promise((resolve) => this.pathCalls.push({ query, resolve }));
  }
  dispose(): void {
    // nothing to stop
  }
  /** Answers every open request with a path bent 5 yd off the midpoint (x, y, z triples). */
  answerAll(): void {
    for (const call of this.pathCalls.splice(0)) {
      const { from, to } = call.query;
      call.resolve([from.x, from.y, 0, (from.x + to.x) / 2 + 5, (from.y + to.y) / 2, 0, to.x, to.y, 0]);
    }
  }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

function setup(steps: RouteStep[] = mapTestSteps(), feedOptions: Partial<RoutePathFeedOptions> = {}, navMaps: readonly number[] = [1]) {
  const workspace = mapTestWorkspace(steps, T0);
  const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(1000), clock: fixedClock(T0) });
  const timers = new ManualTimers();
  const service = new PathService();
  const runtime = createNavigationRuntime(testNavManifest(navMaps), service, timers);
  const rules = projectRules('forever-beta', {});
  const graph = projectTravelGraph(MAP_TEST_DATASET, [], rules);
  const selection = selectTravelModel({ navigation: { kind: 'available', runtime }, detourFactor: 1.25, graph, faction: 'Horde', dataset: MAP_TEST_DATASET, geometry: workspace.geometry });
  const feed = createRoutePathFeed({ store, geometry: workspace.geometry, timers, now: () => timers.now, ...feedOptions });
  const factory = fakeAdapterFactory();
  const controller = createMapController({
    wording: MAP_WORDING,
    store,
    data: workspace.data,
    geometry: workspace.geometry,
    describeStep: (step, index) => `${String(index + 1)} · ${step.kind}`,
    paths: feed,
    timing: null,
    objectUrls: null,
    // One world surface per world map, as before step ATL.10 (the path instances and a geometry
    // without the 947 rows still take); the atlas, the default since ATL.10, is route-paths.atlas.test.ts.
    atlas: false,
    smoothWheel: false,
  });
  const adapter = () => {
    const a = factory.adapters[0];
    if (a === undefined) throw new Error('not attached');
    return a;
  };
  const routeLine = (): MapDescriptor[] => (adapter().contents.get('route-line')?.items ?? []).filter((item) => item.type === 'polyline');
  return { store, timers, service, runtime, selection, feed, controller, factory, adapter, routeLine };
}

const styles = (items: readonly MapDescriptor[]) => items.map((item) => (item.type === 'polyline' ? item.style : null));

describe('route paths: feed and map controller', () => {
  it('draw straight lines until there is a navigation model', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    expect(s.feed.current()).toBeNull();
    expect(s.controller.getStatus().walkingPaths.unavailable).toBe('No walking paths are available yet: every leg is drawn as a straight line');
    expect(styles(s.routeLine())).toEqual(['route']);
  });

  it('request the drawn legs, draw them pending, then follow the paths once a batch arrives', async () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    s.feed.setModel(s.selection.navigation, s.runtime, s.selection.hints);
    expect(s.feed.current()?.pending).toBe(true);
    expect(styles(s.routeLine())).toEqual(['route-pending']);
    s.timers.advance(0);
    // The three walked legs of the shown map (Kalimdor), and nothing else.
    expect(s.service.pathCalls.map((c) => c.query.mapId)).toEqual([1, 1, 1]);
    s.service.answerAll();
    await settle();
    // Applied in one scheduler batch; the feed issues new paths at most every 250 ms.
    s.timers.advance(100);
    s.timers.advance(250);
    const line = s.routeLine();
    expect(styles(line)).toEqual(['route']);
    // Four step points plus one bent point per leg.
    expect(line[0]?.type === 'polyline' ? line[0].points : []).toHaveLength(7);
    expect(s.controller.getStatus().walkingPaths.notes).toContain('3 walked legs follow their paths on this map.');
    // Every leg is decided: the next object is not pending.
    s.timers.advance(250);
    expect(s.feed.current()?.pending).toBe(false);
  });

  it('hold new paths while the map moves, and draw them once it settles, in a task after its sync (D-050 item 5)', async () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    s.feed.setModel(s.selection.navigation, s.runtime, s.selection.hints);
    s.timers.advance(0);
    s.service.answerAll();
    await settle();
    // A pan begins before the batch is applied: no new paths object while it lasts, however long.
    s.adapter().emit({ type: 'movestart' });
    s.timers.advance(100);
    s.timers.advance(1000);
    expect(styles(s.routeLine())).toEqual(['route-pending']);
    // It settles: the view's own sync first, the paths in the next task.
    s.adapter().pan({ x: 1 });
    expect(styles(s.routeLine())).toEqual(['route-pending']);
    s.timers.advance(0);
    expect(styles(s.routeLine())).toEqual(['route']);
  });

  it('lapse a hold whose end is never reported (holdMaxMs)', async () => {
    const s = setup(mapTestSteps(), { holdMaxMs: 500 });
    s.controller.attach(s.factory.factory, EL);
    s.feed.setModel(s.selection.navigation, s.runtime, s.selection.hints);
    s.timers.advance(0);
    s.service.answerAll();
    await settle();
    s.feed.hold(true);
    s.timers.advance(400);
    expect(styles(s.routeLine())).toEqual(['route-pending']);
    s.timers.advance(100);
    expect(styles(s.routeLine())).toEqual(['route']);
  });

  it('draw a leg without a walking path as a fallback once nothing is pending', async () => {
    const s = setup();
    const [a, b] = [endpoint(1, 0, -4000), endpoint(1, 10, -4010)];
    const table = s.runtime.table;
    table.set(navLegRequest(table.revision, a, b).key, navLegEntryOf(otherComponent()));
    s.controller.attach(s.factory.factory, EL);
    s.feed.setModel(s.selection.navigation, s.runtime, s.selection.hints);
    s.timers.advance(0);
    // The leg with no walking path is never requested.
    expect(s.service.pathCalls).toHaveLength(2);
    s.service.answerAll();
    await settle();
    s.timers.advance(100);
    s.timers.advance(250);
    s.timers.advance(250);
    expect(s.feed.current()?.pending).toBe(false);
    expect(styles(s.routeLine())).toEqual(['route-fallback', 'route']);
  });

  it('request only legs in view on a long route, and the ones that come into view when the map pans', () => {
    // Twelve steps 2,000 yd apart: the fitted view (±100 yd in the fake adapter) shows few legs.
    const steps = acceptStepsAt(Array.from({ length: 12 }, (_, i) => ({ mapId: 1, x: i * 2000, y: -4000 })));
    const s = setup(steps, { smallRouteLegs: 0 });
    s.controller.attach(s.factory.factory, EL);
    s.feed.setModel(s.selection.navigation, s.runtime, s.selection.hints);
    s.timers.advance(0);
    const asked = (): number[] => s.service.pathCalls.map((c) => c.query.from.x);
    const first = asked();
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(11);
    // Pan to the far end of the route: its leg is asked for then, without a new paths object.
    const before = s.feed.current();
    s.adapter().pan({ x: 21000, y: -4000 });
    s.timers.advance(0);
    expect(asked()).toContain(20000);
    expect(s.feed.current()).toBe(before);
  });

  it('ask nothing for legs on another world map than the one shown', () => {
    const steps = acceptStepsAt([
      { mapId: 1, x: 0, y: -4000 },
      { mapId: 1, x: 50, y: -4000 },
      { mapId: 0, x: -9000, y: 800 },
      { mapId: 0, x: -9050, y: 800 },
    ]);
    const s = setup(steps);
    s.controller.attach(s.factory.factory, EL);
    s.feed.setModel(s.selection.navigation, s.runtime, s.selection.hints);
    s.timers.advance(0);
    expect(s.service.pathCalls.map((c) => c.query.mapId)).toEqual([1]);
  });

  it('issue new paths when the map shows another world map, and ask for its legs then', () => {
    const steps = acceptStepsAt([
      { mapId: 1, x: 0, y: -4000 },
      { mapId: 1, x: 50, y: -4000 },
      { mapId: 0, x: -9000, y: 800 },
      { mapId: 0, x: -9050, y: 800 },
    ]);
    const s = setup(steps, {}, [0, 1]);
    s.controller.attach(s.factory.factory, EL);
    s.feed.setModel(s.selection.navigation, s.runtime, s.selection.hints);
    s.timers.advance(0);
    const before = s.feed.current();
    expect(s.service.pathCalls.map((c) => c.query.mapId)).toEqual([1]);
    s.controller.showSurface('world:0');
    s.timers.advance(250);
    expect(s.feed.current()).not.toBe(before);
    expect(s.service.pathCalls.map((c) => c.query.mapId)).toEqual([1, 0]);
  });

  it('say apart the legs outside the view that are not asked for yet (NAV-07)', async () => {
    const steps = acceptStepsAt(Array.from({ length: 12 }, (_, i) => ({ mapId: 1, x: i * 2000, y: -4000 })));
    const s = setup(steps, { smallRouteLegs: 0 });
    s.controller.attach(s.factory.factory, EL);
    s.feed.setModel(s.selection.navigation, s.runtime, s.selection.hints);
    s.timers.advance(0);
    s.service.answerAll();
    await settle();
    s.timers.advance(100);
    s.timers.advance(250);
    s.timers.advance(250);
    // The legs in view are decided: the object is no longer pending for the ones never asked.
    expect(s.feed.current()?.pending).toBe(false);
    const outside = s.feed.outOfView();
    expect(outside).toBeGreaterThan(0);
    const notes = s.controller.getStatus().walkingPaths.notes;
    expect(notes).toContain(`${String(outside)} legs outside the view wait to be computed until they come into view.`);
    expect(notes.some((note) => note.includes('no walking path'))).toBe(false);
  });

  it('stop following the feed when the map is detached', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    s.controller.detach();
    s.feed.setModel(s.selection.navigation, s.runtime, s.selection.hints);
    s.timers.advance(0);
    expect(s.service.pathCalls).toHaveLength(0);
  });
});

/** Path answers the test releases: at once, or one at a time. */
type PathAnswer = (q: NavLegQuery) => readonly number[] | null;

/** The feed alone over synthetic legs, drawn as the map draws them (every walked leg per new object). */
function feedOnly(count: number, answer: PathAnswer, options: { readonly slow?: boolean } = {}) {
  const timers = new ManualTimers();
  const calls: NavLegQuery[] = [];
  const held: (() => void)[] = [];
  const service = {
    legs: () => new Promise<never>(() => undefined),
    path: (q: NavLegQuery) => {
      calls.push(q);
      if (options.slow !== true) return Promise.resolve(answer(q));
      return new Promise<readonly number[] | null>((resolve) => {
        held.push(() => {
          resolve(answer(q));
        });
      });
    },
    dispose: () => undefined,
  };
  const runtime = createNavigationRuntime(testNavManifest([1]), service, timers);
  const rules = projectRules('forever-beta', {});
  const graph = projectTravelGraph(MAP_TEST_DATASET, [], rules);
  const workspace = mapTestWorkspace(mapTestSteps(), T0);
  const selection = selectTravelModel({ navigation: { kind: 'available', runtime }, detourFactor: 1.25, graph, faction: 'Horde', dataset: MAP_TEST_DATASET, geometry: workspace.geometry });
  const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(1000), clock: fixedClock(T0) });
  const feed = createRoutePathFeed({ store, geometry: workspace.geometry, timers, now: () => timers.now });
  const legs: RouteLeg[] = Array.from({ length: count }, (_, i) => ({
    fromStepId: stepId(`leg-${String(i)}`),
    toStepId: stepId(`leg-${String(i + 1)}`),
    from: { mapId: worldMapId(1), x: i * 20, y: 0 },
    to: { mapId: worldMapId(1), x: i * 20 + 20, y: 0 },
  }));
  let objects = 0;
  let drawn = { along: 0, none: 0, pending: true };
  const draw = (): void => {
    const input = feed.current();
    if (input === null) return;
    let along = 0;
    let none = 0;
    for (const leg of legs) {
      if (input.pathOf(leg) === null) none += 1;
      else along += 1;
    }
    drawn = { along, none, pending: input.pending };
  };
  feed.subscribe(() => {
    objects += 1;
    draw();
  });
  feed.setModel(selection.navigation, runtime, selection.hints);
  return {
    feed,
    legs,
    calls,
    drawn: () => drawn,
    objects: () => objects,
    /** Runs `ms` of simulated time in `step` ms steps; with slow answers, one path is answered per step. */
    async run(ms: number, step = 50): Promise<void> {
      for (let t = 0; t < ms; t += step) {
        held.shift()?.();
        await settle();
        timers.advance(step);
        await settle();
      }
    },
    setView(xMin: number, xMax: number): void {
      feed.setView({ mapId: worldMapId(1), center: { x: (xMin + xMax) / 2, y: 0 }, zoom: 0, bounds: { mapId: worldMapId(1), xMin, xMax, yMin: -10, yMax: 10 } });
      draw();
    },
  };
}

const straightPath: PathAnswer = (q) => [q.from.x, q.from.y, 0, q.to.x, q.to.y, 0];

describe('route paths: long routes (NAV-06, NAV-07, NAV-09)', () => {
  it('settle with more legs in view than the 256-path cache holds: each asked once, no endless new objects (NAV-06)', async () => {
    const f = feedOnly(400, straightPath);
    f.setView(-10, 400 * 20 + 10);
    await f.run(10_000);
    expect(f.drawn()).toEqual({ along: 400, none: 0, pending: false });
    // Every leg asked exactly once.
    expect(f.calls).toHaveLength(400);
    expect(new Set(f.calls.map((q) => q.from.x)).size).toBe(400);
    const settled = f.objects();
    await f.run(20_000);
    expect(f.objects()).toBe(settled);
    expect(f.calls).toHaveLength(400);
  });

  it('draw decided legs in view in their final style while legs out of view were never asked (NAV-07)', async () => {
    // Legs 0-4 have no walking path; about 13 legs lie in the padded view.
    const f = feedOnly(100, (q) => (q.from.x < 100 ? null : straightPath(q)));
    f.setView(0, 200);
    await f.run(5_000);
    const input = f.feed.current();
    expect(input?.pending).toBe(false);
    // Legs 0-4 are answered "no path": drawn as fallbacks now, not as still being computed.
    expect(f.legs.slice(0, 5).map((leg) => input?.pathOf(leg) ?? null)).toEqual([null, null, null, null, null]);
    expect(f.calls.length).toBeGreaterThan(5);
    expect(f.calls.length).toBeLessThan(20);
    expect(f.feed.outOfView()).toBe(100 - f.calls.length);
    // Panning brings undecided legs into view: they are asked for, under a pending object.
    f.setView(1000, 1200);
    await f.run(1_000);
    expect(f.calls.some((q) => q.from.x === 1100)).toBe(true);
    expect(f.feed.current()?.pending).toBe(false);
    expect(f.drawn().along).toBeGreaterThan(20);
  });

  it('never ask the worker twice for a path whose request is still in flight (NAV-09)', async () => {
    // One path answered every 30 ms; every new paths object is drawn in full meanwhile.
    const f = feedOnly(20, straightPath, { slow: true });
    f.setView(-10, 20 * 20 + 10);
    await f.run(3_000, 30);
    expect(f.drawn()).toEqual({ along: 20, none: 0, pending: false });
    expect(f.calls).toHaveLength(20);
    expect(new Set(f.calls.map((q) => q.from.x)).size).toBe(20);
    expect(f.objects()).toBeGreaterThan(3);
  });
});
