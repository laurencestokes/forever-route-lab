import { describe, expect, it } from 'vitest';
import { sequentialIdSource, worldMapId, type WorldMapId } from '../domain';
import type { MapContainer } from '../map/adapter';
import type { NavLegQuery } from '../nav/worker/protocol';
import { fixedClock } from './clock';
import { projectRules, projectTravelGraph, selectTravelModel } from './derived-context';
import { createMapController } from './map-controller';
import { acceptStepsAt, fakeAdapterFactory, MAP_TEST_DATASET, mapTestWorkspace } from './map-test-helpers';
import { createNavigationRuntime } from './navigation-runtime';
import { ManualTimers, testNavManifest } from './navigation-test-helpers';
import { createRoutePathFeed } from './route-paths';
import { createEditorStore } from './store';
import { MAP_WORDING } from './map-wording';

/*
 * Walking paths on the atlas (docs/research/map-atlas.md §8.2: "route-paths asks for legs on every
 * active view, not only view.mapId"): the feed asks for the walked legs of every map the atlas view
 * builds, and asks again when a map comes into view.
 */

const T0 = '2026-09-27T12:00:00.000Z';
const EL: MapContainer = { nodeType: 1, ownerDocument: null };
const KALIMDOR = worldMapId(1);
const EK = worldMapId(0);

class PathService {
  readonly calls: NavLegQuery[] = [];
  legs = () => new Promise<never>(() => undefined);
  path(query: NavLegQuery): Promise<readonly number[] | null> {
    this.calls.push(query);
    return new Promise(() => undefined);
  }
  dispose(): void {
    // nothing to stop
  }
}

function setup() {
  // Two walked legs in Durotar, then two in Stormwind's harbour (the boat between them is no walked leg).
  const steps = acceptStepsAt([
    { mapId: 1, x: 0, y: -4000 },
    { mapId: 1, x: 10, y: -4010 },
    { mapId: 1, x: 20, y: -4020 },
    { mapId: 0, x: -8900, y: 500 },
    { mapId: 0, x: -8910, y: 510 },
    { mapId: 0, x: -8920, y: 520 },
  ]);
  const workspace = mapTestWorkspace(steps, T0);
  const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(1000), clock: fixedClock(T0) });
  const timers = new ManualTimers();
  const service = new PathService();
  const runtime = createNavigationRuntime(testNavManifest([0, 1]), service, timers);
  const rules = projectRules('forever-beta', {});
  const graph = projectTravelGraph(MAP_TEST_DATASET, [], rules);
  const selection = selectTravelModel({ navigation: { kind: 'available', runtime }, detourFactor: 1.25, graph, faction: 'Horde', dataset: MAP_TEST_DATASET, geometry: workspace.geometry });
  const feed = createRoutePathFeed({ store, geometry: workspace.geometry, timers, now: () => timers.now });
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
    atlas: true,
  });
  const adapter = () => {
    const a = factory.adapters[0];
    if (a === undefined) throw new Error('not attached');
    return a;
  };
  return { timers, service, runtime, selection, feed, controller, factory, adapter };
}

const mapsAsked = (service: PathService): readonly WorldMapId[] => service.calls.map((call) => worldMapId(call.mapId)).sort((a, b) => a - b);

describe('route paths on the atlas', () => {
  it('asks for the walked legs of every map the view builds', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    // The whole atlas: both continents are built.
    s.adapter().pan({ mapId: KALIMDOR, x: 12778 - 13056, y: 5652 - 15360, zoom: -5 });
    s.feed.setModel(s.selection.navigation, s.runtime, s.selection.hints);
    s.timers.advance(0);
    expect(mapsAsked(s.service)).toEqual([EK, EK, KALIMDOR, KALIMDOR]);
  });

  it('asks only for the maps in view, and for another map’s legs once it comes into view', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    s.adapter().pan({ mapId: EK, x: -8910, y: 510, zoom: -2 });
    s.feed.setModel(s.selection.navigation, s.runtime, s.selection.hints);
    s.timers.advance(0);
    expect(mapsAsked(s.service)).toEqual([EK, EK]);
    // Zooming out brings Kalimdor into the view: a new paths object, whose drawing asks for its legs.
    s.adapter().pan({ mapId: KALIMDOR, x: 12778 - 13056, y: 5652 - 15360, zoom: -5 });
    s.timers.advance(250);
    s.timers.advance(0);
    expect(mapsAsked(s.service)).toEqual([EK, EK, KALIMDOR, KALIMDOR]);
  });
});
