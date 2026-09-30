import { describe, expect, it, vi } from 'vitest';
import { npcId, questId, sequentialIdSource, uiMapId, worldMapId, type RouteStep, type UiMapId, type WorldMapId } from '../domain';
import { atlasHash, atlasPlacements } from '../geo/atlas';
import { ATLAS_LAYOUT } from '../geo/atlas-layout';
import { AZEROTH, FIXTURE_MAPS, fixtureGeometry } from '../geo/test-fixtures';
import { syntheticIndex } from '../../tests/support/atlas-tiles';
import type { ArtImage, ArtManifestLoad, AtlasIndexLoad, MapResources, TerrainManifestLoad } from '../infra/maps';
import { isAtlasSurface, mapViewOf, type ConnectorDescriptor, type LayerId, type MapContainer, type MapDescriptor, type MapView } from '../map/adapter';
import { createMapLayers, RELIEF_OPACITY } from '../map/layers';
import { fixedClock } from './clock';
import { atlasInstruction, createMapController, insetNote, viewAtZoom, type MapControllerOptions } from './map-controller';
import {
  createDrawnRouteFilter,
  createRouteInputBuilder,
  flightMasterModel,
  questGiverModel,
} from './map-model';
import { acceptStepsAt, fakeAdapterFactory, MAP_TEST_DATASET, mapTestWorkspace, stubDataset, stubNpc, stubQuest, worldSpawn, type FakeAdapter } from './map-test-helpers';
import { setMapLayerVisible } from './map-view';
import { createEditorStore } from './store';
import { MAP_WORDING, MINIMAP_TILES_NOTE } from './map-wording';

/*
 * The map controller with the atlas on (docs/research/map-atlas.md §8.2, §8.5, §8.8; steps ATL.4
 * and ATL.5): per-map builders joined, the cap shared across them, presets, the inset note, and a
 * world surface's layers exactly as one builder gives them (the golden case). Since ATL.10 the atlas
 * and the smooth wheel are the controller's defaults, and since MM.9 the minimap is the default
 * style, so the tile modes below are shown with the minimap's index; `setup` still names
 * `atlas: true` so each case says what it runs on.
 */

const T0 = '2026-09-27T12:00:00.000Z';
const KALIMDOR = worldMapId(1);
const EK = worldMapId(0);
const ZEPHRAS = worldMapId(2991);
const EL: MapContainer = { nodeType: 1, ownerDocument: null };

/** Durotar (Kalimdor), then Stormwind's harbour (the Eastern Kingdoms), then Zephras Isle. */
const ACROSS = [
  { mapId: 1, x: 0, y: -4000 },
  { mapId: 1, x: 50, y: -4100 },
  { mapId: 0, x: -8900, y: 500 },
  { mapId: 0, x: -8950, y: 520 },
  { mapId: 2991, x: 3000, y: 1500 },
];

function setup(steps: RouteStep[] = acceptStepsAt(ACROSS), options: Partial<MapControllerOptions> = {}, dataset = MAP_TEST_DATASET) {
  const workspace = mapTestWorkspace(steps, T0, dataset);
  const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(100), clock: fixedClock(T0) });
  const factory = fakeAdapterFactory();
  const controller = createMapController({
    wording: MAP_WORDING,
    store,
    data: workspace.data,
    geometry: workspace.geometry,
    describeStep: (step, index) => `${String(index + 1)} · ${step.kind}`,
    timing: null,
    objectUrls: null,
    atlas: true,
    ...options,
  });
  const adapter = (): FakeAdapter => {
    const first = factory.adapters[0];
    if (first === undefined) throw new Error('no adapter yet');
    return first;
  };
  return { workspace, store, controller, factory, adapter, steps };
}

const itemsOf = (adapter: FakeAdapter, layer: LayerId): readonly MapDescriptor[] => adapter.contents.get(layer)?.items ?? [];
const idsOf = (adapter: FakeAdapter, layer: LayerId): readonly string[] => itemsOf(adapter, layer).map((item) => item.id);
const stepAt = (steps: readonly RouteStep[], i: number): RouteStep => {
  const step = steps[i];
  if (step === undefined) throw new Error(`no step ${String(i)}`);
  return step;
};

/** Centres the fake atlas view on a world point at a zoom (the fake's stage is 800 × 600 px). */
const panTo = (adapter: FakeAdapter, mapId: WorldMapId, x: number, y: number, zoom: number): void => {
  adapter.pan({ mapId, x, y, zoom });
};

describe('the atlas surface in the controller (map-atlas.md §5.6, §8.5)', () => {
  it('offers the atlas instead of maps 0, 1 and 2991, with presets for the continents and names for every map', () => {
    const s = setup();
    expect(s.controller.surfaces.map((info) => info.id)).toEqual(['atlas']);
    const atlas = s.controller.surfaces[0];
    expect(atlas !== undefined && isAtlasSurface(atlas) ? atlas.mapIds : null).toEqual([KALIMDOR, EK, ZEPHRAS]);
    expect(s.controller.presets.map((preset) => [preset.id, preset.name, preset.mapId])).toEqual([
      ['preset:1', 'Kalimdor', KALIMDOR],
      ['preset:0', 'Eastern Kingdoms', EK],
    ]);
    // A preset fits the continent's 947 rectangle (the placement's).
    const placements = atlasPlacements(s.workspace.geometry, ATLAS_LAYOUT);
    expect(s.controller.presets[1]?.bounds).toEqual(placements?.[1]?.rect);
    expect([s.controller.mapName(EK), s.controller.mapName(ZEPHRAS), s.controller.mapName(worldMapId(36))]).toEqual(['Eastern Kingdoms', 'Zephras Isle', null]);
    // Jump-to-zone groups by world map, all on the atlas.
    expect(s.controller.zoneGroups.map((group) => [group.surface, group.label])).toEqual([
      ['atlas', 'Kalimdor'],
      ['atlas', 'Eastern Kingdoms'],
      ['atlas', 'Zephras Isle'],
    ]);
  });

  it('keeps the world surfaces, exactly as before, when the atlas is off', () => {
    const s = setup(undefined, { atlas: false });
    expect(s.controller.surfaces.map((info) => info.id)).toEqual(['world:0', 'world:1', 'world:2991']);
    expect(s.controller.presets).toEqual([]);
  });

  it('is the default since ATL.10: with no atlas option, maps 0, 1 and 2991 have no world surface of their own', () => {
    const s = setup(undefined, { atlas: undefined, idle: () => () => undefined });
    expect(s.controller.surfaces.map((info) => info.id)).toEqual(['atlas']);
    expect(s.controller.presets.map((preset) => preset.id)).toEqual(['preset:1', 'preset:0']);
    s.controller.attach(s.factory.factory, EL);
    expect([s.adapter().options.initialSurface, s.adapter().options.smoothWheel]).toEqual(['atlas', true]);
    expect(s.controller.showSurface('world:1')).toBe(false);
  });

  it('keeps one world surface per world map, and says why, when the geometry cannot place the continents (no 947 rows)', () => {
    const s = setup(undefined, { atlas: undefined, idle: () => () => undefined, geometry: fixtureGeometry(FIXTURE_MAPS.filter((map) => map !== AZEROTH)) });
    expect(s.controller.surfaces.map((info) => info.id)).toEqual(['world:0', 'world:1', 'world:2991']);
    expect(s.controller.presets).toEqual([]);
    s.controller.attach(s.factory.factory, EL);
    expect(s.controller.getStatus().problems).toContain('The atlas could not be placed from this geometry: the map shows one world map at a time');
  });

  it('opens on the atlas and fits every placed step of the route there, on both continents and the isle', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    expect(adapter.options.initialSurface).toBe('atlas');
    const fit = adapter.callsOf('fitBounds')[0];
    // One rectangle in Kalimdor's yards covering the translated steps of all three maps.
    expect(fit?.bounds.mapId).toBe(KALIMDOR);
    const status = s.controller.getStatus();
    expect(status.surface).toBe('atlas');
    expect(status.route).toMatchObject({ total: 5, placed: 5, onSurface: 5, noSurface: 0, canFit: true });
    expect(s.controller.fitRoute()).toEqual({ kind: 'fitted', surface: 'atlas', steps: 5 });
  });

  it('says that Zephras Isle is shown in a box, and that it has no quest data only while that is so', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const [inset] = s.controller.getStatus().insets;
    expect(inset).toEqual({ mapId: ZEPHRAS, name: 'Zephras Isle', questData: false });
    if (inset === undefined) throw new Error('no inset');
    expect(insetNote(inset)).toBe('Zephras Isle: shown in a box, not in position; no quest data yet');
    expect(atlasInstruction([inset])).toBe('Both continents; Zephras Isle is shown in a box between them, because the game does not place it; it has no quest data yet.');
    // A dataset with a quest giver on the isle.
    const withGiver = stubDataset({
      quests: [stubQuest({ id: questId(1), name: 'Skyborne', starters: [{ kind: 'npc', id: npcId(50) }] })],
      npcs: [stubNpc({ id: npcId(50), name: 'Skyborne greeter' })],
      spawns: { 'npc:50': [worldSpawn(ZEPHRAS, 3000, 1500, uiMapId(2521))] },
    });
    const t = setup(undefined, {}, withGiver);
    t.controller.attach(t.factory.factory, EL);
    const [shown] = t.controller.getStatus().insets;
    expect(shown?.questData).toBe(true);
    if (shown !== undefined) expect(insetNote(shown)).toBe('Zephras Isle: shown in a box, not in position');
  });
});

describe('per-map builders joined (map-atlas.md §8.2, ATL.4)', () => {
  it('draws each continent’s part of every layer, and a connector between them, once, with nothing counted elsewhere', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    // The whole atlas at −5: every placed map is active.
    panTo(adapter, KALIMDOR, 12778 - 13056, 5652 - 15360, -5);
    expect(adapter.getView()?.visible?.map((bounds) => bounds.mapId)).toEqual([KALIMDOR, EK, ZEPHRAS]);
    const steps = itemsOf(adapter, 'route-steps');
    expect(steps.map((item) => (item.type === 'marker' ? item.point.mapId : null))).toEqual([KALIMDOR, KALIMDOR, EK, EK, ZEPHRAS]);
    expect(adapter.contents.get('route-steps')?.stats).toMatchObject({ drawn: 5, notDrawn: 0, otherSurfaces: 0 });
    const connectors = itemsOf(adapter, 'route-line').filter((item): item is ConnectorDescriptor => item.type === 'connector');
    expect(connectors.map((item) => [item.id, item.from.mapId, item.to.mapId])).toEqual([[`connector:${stepAt(s.steps, 1).id}>${stepAt(s.steps, 2).id}`, KALIMDOR, EK]]);
    // The leg to the inset keeps its glyph pair.
    expect(idsOf(adapter, 'route-line')).toEqual(expect.arrayContaining([`transition:out:${stepAt(s.steps, 3).id}`, `transition:in:${stepAt(s.steps, 4).id}`]));
    // The connector's hover text and click, as a leg's.
    const connector = connectors[0];
    if (connector === undefined) throw new Error('no connector');
    expect(s.controller.labelFor(connector.ref)).toBe('Route to Eastern Kingdoms: step 2 to step 3');
    adapter.emit({ type: 'click', point: connector.from, hit: { layer: 'route-line', id: connector.id, ref: connector.ref, refs: [connector.ref], segment: 3 }, zones: [] });
    expect(s.store.getState().selection.focus).toBe(stepAt(s.steps, 2).id);
  });

  it('builds only the maps that meet the view, and does not count the others as elsewhere', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    panTo(adapter, EK, -8900, 500, -2);
    expect(adapter.getView()?.visible?.map((bounds) => bounds.mapId)).toEqual([EK]);
    expect(itemsOf(adapter, 'route-steps').map((item) => (item.type === 'marker' ? item.point.mapId : null))).toEqual([EK, EK]);
    expect(adapter.contents.get('route-steps')?.stats.otherSurfaces).toBe(0);
    // The connector is drawn by the map it reaches while the map it leaves is not built.
    expect(itemsOf(adapter, 'route-line').some((item) => item.type === 'connector')).toBe(true);
    // The status line counts the route on every map the atlas places.
    expect(s.controller.getStatus().route.onSurface).toBe(5);
  });

  it('shares each layer’s budget across the active maps in proportion to their candidates in view', () => {
    const steps = acceptStepsAt([
      { mapId: 1, x: 0, y: -4000 },
      { mapId: 1, x: 10, y: -4000 },
      { mapId: 1, x: 20, y: -4000 },
      { mapId: 1, x: 30, y: -4000 },
      { mapId: 0, x: -8900, y: 500 },
      { mapId: 0, x: -8910, y: 500 },
    ]);
    const s = setup(steps, { lod: { budgets: { 'route-steps': 3 } } });
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    panTo(adapter, KALIMDOR, 12778 - 13056, 5652 - 15360, -5);
    // In view: 4 on Kalimdor, 2 on the Eastern Kingdoms; 3 shared as 2 and 1.
    const drawn = itemsOf(adapter, 'route-steps').map((item) => (item.type === 'marker' ? item.point.mapId : null));
    expect(drawn).toEqual([KALIMDOR, KALIMDOR, EK]);
    expect(adapter.contents.get('route-steps')?.stats).toMatchObject({ drawn: 3, notDrawn: 3 });
  });

  it('sends nothing again while no part changed, and keeps the joined object for unchanged parts', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    panTo(adapter, KALIMDOR, 12778 - 13056, 5652 - 15360, -5);
    const before = new Map(adapter.contents);
    const sets = adapter.callsOf('setLayer').length;
    s.controller.setActiveStep(null);
    s.controller.setRoutePaths(null);
    expect(adapter.callsOf('setLayer').length).toBe(sets);
    // A pan inside the same view cell rebuilds nothing.
    panTo(adapter, KALIMDOR, 12778 - 13056 + 10, 5652 - 15360, -5);
    for (const layer of ['route-steps', 'route-line', 'available-quests', 'zone-frames'] as const) expect(adapter.contents.get(layer)).toBe(before.get(layer));
  });

  it('keeps a point on another placed map on the atlas: focus, the active step and presets', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    expect(s.controller.focusStep(stepAt(s.steps, 3).id)).toEqual({ kind: 'focused', surface: 'atlas' });
    expect(adapter.getView()?.mapId).toBe(EK);
    s.controller.setActiveStep(stepAt(s.steps, 4).id);
    expect(s.controller.getStatus().activeStep?.placement).toEqual({ kind: 'point', surface: 'atlas' });
    expect(adapter.getSurface()).toBe('atlas');
    expect(s.controller.showPreset('preset:1')).toBe(true);
    expect(adapter.callsOf('fitBounds').at(-1)?.bounds).toEqual(s.controller.presets[0]?.bounds);
    expect(s.controller.showPreset('preset:36')).toBe(false);
    expect(adapter.callsOf('setSurface')).toEqual([]);
  });

  it('fits the whole atlas on "Both continents", also when the atlas is already shown (review QA-03)', () => {
    const s = setup();
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    const atlas = s.controller.surfaces.find((info) => info.kind === 'atlas');
    if (atlas === undefined) throw new Error('no atlas');
    // Zoomed into a zone on the atlas, then "Both continents": the atlas's extent is fitted, not the zone view kept.
    expect(s.controller.showPreset('preset:1')).toBe(true);
    const fits = adapter.callsOf('fitBounds').length;
    expect(s.controller.showSurface('atlas')).toBe(true);
    expect(adapter.callsOf('fitBounds')).toHaveLength(fits + 1);
    expect(adapter.callsOf('fitBounds').at(-1)?.bounds).toEqual(atlas.extent);
    // Every choice fits again.
    expect(s.controller.showSurface('atlas')).toBe(true);
    expect(adapter.callsOf('fitBounds')).toHaveLength(fits + 2);
    expect(adapter.getSurface()).toBe('atlas');
  });
});

describe('golden: a world surface draws exactly what one builder draws (ATL.4)', () => {
  it('sends, layer by layer, the content a fresh builder gives for the same inputs and view', () => {
    const s = setup(undefined, { atlas: false });
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    const state = adapter.getView();
    if (state === null) throw new Error('no view');
    const view: MapView = mapViewOf(state);
    const fresh = createMapLayers({ geometry: s.workspace.geometry });
    const route = createDrawnRouteFilter()(createRouteInputBuilder(s.workspace.geometry)(s.steps));
    const character = s.workspace.project.character;
    expect(adapter.contents.get('route-steps')).toEqual(fresh.routeSteps(route, view));
    expect(adapter.contents.get('route-line')).toEqual(fresh.routeLine(route, view, null));
    expect(adapter.contents.get('zone-frames')).toEqual(fresh.zoneFrames(view, null, true));
    expect(adapter.contents.get('available-quests')).toEqual(fresh.spawns('available-quests', questGiverModel(s.workspace.dataset, character).input, view, [], null));
    expect(adapter.contents.get('flight-masters')).toEqual(fresh.spawns('flight-masters', flightMasterModel(s.workspace.dataset, [npcId(20)], character).input, view, [], null));
  });
});

describe('the atlas’s painted art: the modes of map-atlas.md §8.6 (ATL.7)', () => {
  const rect = (mapId: WorldMapId, xMin: number, xMax: number, yMin: number, yMax: number) => ({ mapId, xMin, xMax, yMin, yMax });
  const image = (id: UiMapId, name: string, type: number, bounds: ArtImage['bounds']): ArtImage => ({
    uiMapId: id,
    name,
    uiMapType: type,
    styleId: 1,
    bounds,
    url: `./maps/art/${String(id)}.webp`,
    contentType: 'image/webp',
    width: 1002,
    height: 668,
    sha256: 'b'.repeat(64),
  });
  const ART: ArtManifestLoad = {
    kind: 'loaded',
    manifest: {
      owner: 'Blizzard Entertainment',
      build: '1.60.1.70009',
      images: [
        image(uiMapId(1411), 'Durotar', 3, rect(KALIMDOR, -1716.6666259765625, 1808.333251953125, -7249.99951171875, -1962.4998779296875)),
        image(uiMapId(1414), 'Kalimdor', 2, rect(KALIMDOR, -11733.2998046875, 12799.900390625, -19733.2109375, 17066.599609375)),
        image(uiMapId(1415), 'Eastern Kingdoms', 2, rect(EK, -16000, 7466.6000976562, -19199.900390625, 16000)),
        image(uiMapId(1453), 'Stormwind City', 3, rect(EK, -9154.169921875, -7995.830078125, -14.58399963379, 1722.9200439453)),
        image(uiMapId(2521), 'Zephras Isle', 3, rect(ZEPHRAS, 1247.9169921875, 4956.25, -1331.25, 4231.25)),
      ],
      unplaced: [],
    },
  };
  const relief = (mapId: WorldMapId) => ({ url: `./maps/terrain/${String(mapId)}/relief.png`, bounds: rect(mapId, -16000, 16000, -16000, 16000), width: 1, height: 1, ydPerPx: 17 });
  const TERRAIN = {
    kind: 'loaded',
    manifest: {
      build: '1.60.1.70009',
      maps: [
        { mapId: EK, name: 'Eastern Kingdoms', relief: relief(EK), zones: null, coast: null },
        { mapId: KALIMDOR, name: 'Kalimdor', relief: relief(KALIMDOR), zones: null, coast: null },
      ],
    },
  } as unknown as TerrainManifestLoad;
  const HASH = (() => {
    const placements = atlasPlacements(mapTestWorkspace().geometry, ATLAS_LAYOUT);
    if (placements === null) throw new Error('no atlas');
    return atlasHash(placements, ATLAS_LAYOUT);
  })();
  /** The default style's index (the minimap since MM.9; map-atlas.md §21.3). */
  const indexLoad = (hash: string): AtlasIndexLoad => ({
    kind: 'loaded',
    file: { index: syntheticIndex({ hash, stored: { [-8]: [[0, 0]], [-5]: [[1, 1]] } }), style: 'minimap', urlTemplate: './maps/minimap/t/{z}/{x}/{y}.webp', layout: 'compact' },
  });
  const resourcesWith = (atlas: ((expected: string) => Promise<AtlasIndexLoad>) | null): MapResources => ({
    art: () => Promise.resolve(ART),
    terrain: () => Promise.resolve(TERRAIN),
    arcs: () => Promise.resolve({ kind: 'failed', reason: 'unavailable', detail: 'none' }),
    ...(atlas === null ? {} : { atlas }),
  });
  const artNotes = (s: ReturnType<typeof setup>): readonly string[] => s.controller.getStatus().layers.find((entry) => entry.layer === 'art')?.notes ?? [];
  /** Over the middle of the atlas at the world band. */
  const overview = (adapter: FakeAdapter): void => {
    panTo(adapter, KALIMDOR, 12778 - 13056, 5652 - 15360, -5);
  };

  it('draws the tiles as the art layer’s one item, drops the relief on the atlas, and keeps the zone rectangles unpainted', async () => {
    const atlas = vi.fn(() => Promise.resolve(indexLoad(HASH)));
    const s = setup(undefined, { resources: resourcesWith(atlas) });
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    overview(adapter);
    await vi.waitFor(() => {
      expect(idsOf(adapter, 'art')).toEqual(['atlas-tiles:minimap']);
    });
    // Only the default style's index is fetched (the painted one waits until that style is shown).
    expect(atlas).toHaveBeenCalledTimes(1);
    expect(atlas).toHaveBeenCalledWith(HASH, 'minimap');
    const [band] = itemsOf(adapter, 'art');
    expect(band?.type === 'tiles' ? [band.index.hash, band.urlTemplate] : null).toEqual([HASH, './maps/minimap/t/{z}/{x}/{y}.webp']);
    expect(idsOf(adapter, 'relief')).toEqual([]);
    const frames = itemsOf(adapter, 'zone-frames').filter((item) => item.type === 'frame');
    expect(frames.filter((frame) => frame.kind === 'zone').every((frame) => frame.hidden === true)).toBe(true);
    expect(frames.find((frame) => frame.kind === 'inset')).toMatchObject({ id: 'inset:2991', overTiles: true });
    const status = s.controller.getStatus();
    expect(status.backdrop).toBe('art');
    expect(status.problems).toEqual([]);
    expect(artNotes(s)).toContain(MINIMAP_TILES_NOTE);
    // The band keeps its identity across syncs, so the adapter keeps its tile layer.
    panTo(adapter, KALIMDOR, 0, -4000, -3);
    expect(itemsOf(adapter, 'art')[0]).toBe(band);
    // Zoomed in to tile level −1 over Ironforge's card, the city card is framed (if the geometry has it) and no zone frame is painted.
    panTo(adapter, EK, -4900, -980, -1);
    expect(itemsOf(adapter, 'zone-frames').every((item) => item.type !== 'frame' || item.kind !== 'zone' || item.hidden === true)).toBe(true);
  });

  it('refuses an index composed for other placements: the relief backdrop, Zephras Isle’s own map on its card, and a status line', async () => {
    // The loader refuses an index whose hash is not the one it is given (map-resources.test.ts).
    const refused: AtlasIndexLoad = {
      kind: 'failed',
      reason: 'invalid',
      detail: 'maps/atlas/index.json: its atlasHash 0123456789ab… is not this build’s 748eef8d5584… (the tiles were composed for other placements)',
    };
    const atlas = vi.fn((_expected: string) => Promise.resolve(refused));
    const s = setup(undefined, { resources: resourcesWith(atlas) });
    s.controller.attach(s.factory.factory, EL);
    // The default style's index first; refused, it asks for the painted one (map-atlas.md §21.4).
    expect(atlas).toHaveBeenCalledWith(HASH, 'minimap');
    await vi.waitFor(() => {
      expect(atlas).toHaveBeenCalledWith(HASH, 'painted');
    });
    const adapter = s.adapter();
    overview(adapter);
    await vi.waitFor(() => {
      expect(s.controller.getStatus().problems.some((problem) => problem.startsWith('The atlas tiles could not be used'))).toBe(true);
    });
    await vi.waitFor(() => {
      expect(idsOf(adapter, 'art')).toEqual(['art:2521']);
    });
    expect(s.controller.getStatus().problems.find((problem) => problem.startsWith('The atlas tiles'))).toContain('other placements');
    expect(itemsOf(adapter, 'relief').map((item) => (item.type === 'art' ? [item.id, item.opacity] : null))).toEqual([
      ['relief:1', RELIEF_OPACITY.backdrop],
      ['relief:0', RELIEF_OPACITY.backdrop],
    ]);
    expect(itemsOf(adapter, 'zone-frames').some((item) => item.type === 'frame' && item.hidden === true)).toBe(false);
    expect(artNotes(s).some((note) => note.startsWith('The atlas tiles are not available'))).toBe(true);
  });

  it('treats resources without a tile index as refused (no interim per-image art on the continents)', async () => {
    const s = setup(undefined, { resources: resourcesWith(null) });
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    overview(adapter);
    await vi.waitFor(() => {
      expect(idsOf(adapter, 'art')).toEqual(['art:2521']);
    });
    expect(s.controller.getStatus().problems).toContain('The atlas tiles could not be used (this build has no tile index): the map shows the terrain relief instead');
  });

  it('with the painted art off, draws the relief per placement as the backdrop, hidden above zoom 0', async () => {
    const s = setup(undefined, { resources: resourcesWith(() => Promise.resolve(indexLoad(HASH))) });
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    overview(adapter);
    await vi.waitFor(() => {
      expect(idsOf(adapter, 'art')).toEqual(['atlas-tiles:minimap']);
    });
    setMapLayerVisible(s.store, 'art', false);
    await vi.waitFor(() => {
      expect(idsOf(adapter, 'relief')).toEqual(['relief:1', 'relief:0']);
    });
    expect(itemsOf(adapter, 'relief').every((item) => item.type === 'art' && item.opacity === RELIEF_OPACITY.backdrop)).toBe(true);
    // The zone rectangles are painted again (no tiles under them).
    expect(itemsOf(adapter, 'zone-frames').some((item) => item.type === 'frame' && item.hidden === true)).toBe(false);
    panTo(adapter, KALIMDOR, 0, -4000, 0.5);
    expect(idsOf(adapter, 'relief')).toEqual([]);
    panTo(adapter, KALIMDOR, 0, -4000, 0);
    expect(idsOf(adapter, 'relief')).toEqual(['relief:1']);
  });

  it('draws neither relief nor art while the index loads (the relief is not fetched to be replaced), then the tiles', async () => {
    let resolve: (load: AtlasIndexLoad) => void = () => undefined;
    const s = setup(undefined, { resources: resourcesWith(() => new Promise<AtlasIndexLoad>((done) => (resolve = done))) });
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    overview(adapter);
    await vi.waitFor(() => {
      expect(artNotes(s)).toContain('Loading the atlas tiles…');
    });
    expect(idsOf(adapter, 'relief')).toEqual([]);
    expect(idsOf(adapter, 'art')).toEqual([]);
    resolve(indexLoad(HASH));
    await vi.waitFor(() => {
      expect(idsOf(adapter, 'art')).toEqual(['atlas-tiles:minimap']);
    });
    expect(idsOf(adapter, 'relief')).toEqual([]);
  });
});

describe('gestures in the controller (map-atlas.md §8.2, §8.4; ATL.8)', () => {
  it('passes smoothWheel to the adapter by default (ATL.10), and leaves it out only when asked not to', () => {
    const plain = setup(undefined, { idle: () => () => undefined });
    plain.controller.attach(plain.factory.factory, EL);
    expect(plain.adapter().options.smoothWheel).toBe(true);
    const off = setup(undefined, { smoothWheel: false });
    off.controller.attach(off.factory.factory, EL);
    expect(off.adapter().options.smoothWheel).toBeUndefined();
  });

  it('builds the other band’s spawn layers in idle time within half a level of the edge, so the crossing finds them', () => {
    const tasks: (() => void)[] = [];
    const idle = vi.fn((task: () => void) => {
      tasks.push(task);
      return () => {
        const at = tasks.indexOf(task);
        if (at >= 0) tasks.splice(at, 1);
      };
    });
    const s = setup(undefined, { smoothWheel: true, idle });
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    // Far from the edge (−3.5): nothing is scheduled.
    panTo(adapter, KALIMDOR, 0, -4000, -5);
    expect(tasks).toHaveLength(0);
    // Within half a level of it, on the continent side: the zone band is built in idle time.
    panTo(adapter, KALIMDOR, 0, -4000, -3.8);
    expect(tasks).toHaveLength(1);
    // The idle build draws nothing: it only collects (map/layers `prebuild`, tested there).
    const before = adapter.callsOf('setLayer').length;
    tasks.splice(0).forEach((task) => {
      task();
    });
    expect(adapter.callsOf('setLayer')).toHaveLength(before);
    // Crossing then draws the zone band exactly as a fresh builder does. The band changes only once
    // the zoom passes the edge by 0.125 (map-presentation.md §5.1): −3.4 still keeps the continent band.
    panTo(adapter, KALIMDOR, 0, -4000, -3.4);
    expect(adapter.contents.get('available-quests')?.stats.clustered).toBeTypeOf('number');
    panTo(adapter, KALIMDOR, 0, -4000, -3.25);
    const state = adapter.getView();
    if (state === null) throw new Error('no view');
    const fresh = createMapLayers({ geometry: s.workspace.geometry });
    const character = s.workspace.project.character;
    expect(adapter.contents.get('available-quests')).toEqual(fresh.spawns('available-quests', questGiverModel(s.workspace.dataset, character).input, mapViewOf(state), [], null));
    // A pan away from the edge cancels a pending build.
    panTo(adapter, KALIMDOR, 0, -4000, -3.8);
    expect(tasks).toHaveLength(1);
    panTo(adapter, KALIMDOR, 0, -4000, -7);
    expect(tasks).toHaveLength(0);
  });

  // Review MR-01: every band edge, not only the spawn layers' one (the labels, the zone frames and
  // the flight network change at each).
  it('builds ahead near every band edge, and nowhere else', () => {
    const tasks: (() => void)[] = [];
    const idle = (task: () => void): (() => void) => {
      tasks.push(task);
      return () => {
        const at = tasks.indexOf(task);
        if (at >= 0) tasks.splice(at, 1);
      };
    };
    const s = setup(undefined, { smoothWheel: true, idle });
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    // world | continent (−5.51), continent | zone (−3.51), zone | close (−1): within half a level of each.
    for (const [zoom, near] of [[-5.8, true], [-5.3, true], [-4.5, false], [-3.2, true], [-2.2, false], [-1.3, true], [-0.7, true], [0.2, false]] as const) {
      panTo(adapter, KALIMDOR, 0, -4000, zoom);
      expect(tasks.length, String(zoom)).toBe(near ? 1 : 0);
    }
    // Run to the end, each task drawing nothing: the queue ends.
    panTo(adapter, KALIMDOR, 0, -4000, -3.2);
    const before = adapter.callsOf('setLayer').length;
    for (let i = 0; i < 200 && tasks.length > 0; i += 1) tasks.splice(0).forEach((task) => {
      task();
    });
    expect(tasks).toHaveLength(0);
    expect(adapter.callsOf('setLayer')).toHaveLength(before);
    // The crossing then draws what a view reached directly draws.
    panTo(adapter, KALIMDOR, 0, -4000, -4.2);
    const crossed = new Map(adapter.contents);
    const direct = setup(undefined, { smoothWheel: true, idle: () => () => undefined });
    direct.controller.attach(direct.factory.factory, EL);
    panTo(direct.adapter(), KALIMDOR, 0, -4000, -4.2);
    for (const layer of ['available-quests', 'objectives', 'turn-ins', 'labels', 'zone-frames', 'route-line'] as const) expect(crossed.get(layer), layer).toEqual(direct.adapter().contents.get(layer));
  });

  it('predicts the maps a zoom-out brings in as the adapter finds them (viewAtZoom)', () => {
    const s = setup(undefined, { idle: () => () => undefined });
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    const atlas = s.controller.surfaces.find(isAtlasSurface) ?? null;
    // Durotar gains Zephras Isle; the south-west of Kalimdor gains the Eastern Kingdoms (the fake's stage, as the Leaflet adapter's).
    for (const [x, y, from, to] of [[0, -4000, -3.2, -4.2], [-4400, 3000, -3.58, -4.2], [2000, 1000, -2.2, -3.58]] as const) {
      panTo(adapter, KALIMDOR, x, y, from);
      const before = adapter.getView();
      panTo(adapter, KALIMDOR, x, y, to);
      const after = adapter.getView();
      if (before === null || after === null) throw new Error('no view');
      const predicted = viewAtZoom(atlas, mapViewOf(before), to, 'continent');
      expect(predicted.visible?.map((bounds) => bounds.mapId), `${String(x)},${String(y)}`).toEqual(after.visible?.map((bounds) => bounds.mapId));
      expect(predicted.band).toBe('continent');
      for (const [i, bounds] of (predicted.visible ?? []).entries()) {
        const actual = after.visible?.[i];
        expect(bounds.xMax - bounds.xMin).toBeCloseTo((actual?.xMax ?? 0) - (actual?.xMin ?? 0), 3);
        expect(bounds.yMin).toBeCloseTo(actual?.yMin ?? 0, 3);
      }
    }
  });
});

// Review MR-03: the controller kept a band per map, so a map entering the view inside the
// hysteresis window took the plain band while the others kept theirs, and the adapter kept a third.
describe('one band per view (map-presentation.md §5.1; review MR-03)', () => {
  const MARSHAL = npcId(30);
  const withEk = stubDataset({
    quests: [stubQuest({ id: questId(1), name: 'Gather', starters: [{ kind: 'npc', id: npcId(10) }] }), stubQuest({ id: questId(3), name: 'Report', starters: [{ kind: 'npc', id: MARSHAL }] })],
    npcs: [stubNpc({ id: npcId(10), name: 'Gornek' }), stubNpc({ id: MARSHAL, name: 'Marshal' })],
    spawns: {
      'npc:10': [worldSpawn(KALIMDOR, -4400, 3000, uiMapId(1411))],
      'npc:30': [worldSpawn(EK, -8900, 500, uiMapId(1453)), worldSpawn(EK, -8910, 510, uiMapId(1453))],
    },
  });
  const clustered = (adapter: FakeAdapter): boolean => itemsOf(adapter, 'available-quests').some((item) => item.type === 'marker' && item.cluster !== undefined);
  const marshalRaw = (adapter: FakeAdapter): boolean => idsOf(adapter, 'available-quests').includes('spawn:npc:30:0');

  it('builds a map that enters inside the hysteresis window for the view’s band, and gives the adapter that band', () => {
    const s = setup(acceptStepsAt([{ mapId: 1, x: -4400, y: 3000 }]), { idle: () => () => undefined }, withEk);
    s.controller.attach(s.factory.factory, EL);
    const adapter = s.adapter();
    panTo(adapter, KALIMDOR, -4400, 3000, -3.2);
    expect(adapter.bands.at(-1)).toBe('zone');
    // Out to −3.58: the zone band is kept (its edge is −3.51, left at −3.63), with Kalimdor alone in view.
    panTo(adapter, KALIMDOR, -4400, 3000, -3.58);
    expect(adapter.getView()?.visible?.map((bounds) => bounds.mapId)).toEqual([KALIMDOR]);
    expect(s.store.getState().view.map.zoomBand).toBe('zone');
    // A pan brings in the Eastern Kingdoms: built for the zone band too, its giver raw, no cluster.
    panTo(adapter, KALIMDOR, -2000, -2000, -3.58);
    expect(adapter.getView()?.visible?.map((bounds) => bounds.mapId)).toEqual([KALIMDOR, EK]);
    expect(marshalRaw(adapter)).toBe(true);
    expect(clustered(adapter)).toBe(false);
    expect(adapter.bands.at(-1)).toBe('zone');
    // The control: arriving at −3.58 from further out, every map is at the continent band.
    panTo(adapter, KALIMDOR, -2000, -2000, -4.2);
    panTo(adapter, KALIMDOR, -2000, -2000, -3.58);
    expect(s.store.getState().view.map.zoomBand).toBe('continent');
    expect(marshalRaw(adapter)).toBe(false);
    expect(clustered(adapter)).toBe(true);
    expect(adapter.bands.at(-1)).toBe('continent');
  });
});
