import { describe, expect, it } from 'vitest';
import { stepId, uiMapId, worldMapId } from '../domain/ids';
import { atlasHash, atlasPlacements } from '../geo/atlas';
import { ATLAS_LAYOUT } from '../geo/atlas-layout';
import { fixtureGeometry } from '../geo/test-fixtures';
import {
  ATLAS_SURFACE_ID,
  boundsOnMap,
  descriptorOnSurface,
  isAtlasSurface,
  isSurfaceId,
  placementOn,
  shareCap,
  stagePixelOf,
  surfaceBoundsUnion,
  surfaceForMap,
  surfaceMapIds,
  surfacePlacements,
  surfacePointAt,
  viewBoundsOn,
  viewMapIds,
  type AtlasSurfaceInfo,
  type ConnectorDescriptor,
  type SurfaceInfo,
  type WorldSurfaceInfo,
  boundsCenter,
  boundsContain,
  boundsOfPoints,
  combineLabels,
  descriptorMapId,
  emptyLayerContent,
  IMAGE_LAYER_IDS,
  isImageLayer,
  isLayerId,
  LAYER_IDS,
  LAYER_LABELS,
  labelOf,
  mapViewOf,
  MAX_POLYLINE_VERTICES,
  parseSurfaceId,
  refsOf,
  routeLegKey,
  SPAWN_LAYER_IDS,
  surfaceIdOf,
  surfaceMapId,
  type MapDescriptor,
  type MapRef,
  type MarkerDescriptor,
  type WorldBounds,
  isStoredTile,
  resolveTile,
  storedTilesAt,
  tileBandOf,
  tileLevelOf,
  tileUrl,
  DECODED_TILE_BYTES,
  DEFAULT_MAP_STYLE,
  isMapStyle,
  TILE_KEEP_BUFFER,
  TILE_MEMORY_BUDGET,
  tileBandId,
  aboveThreshold,
  BAND_EDGES,
  BAND_HYSTERESIS_ZOOM,
  bandAt,
  bandLevelOf,
  BASE_MAP_LABEL_SCALE,
  baseMapLabelsOf,
  fallbackTintAllowed,
  isLabelLayer,
  LABEL_LAYER_IDS,
  MAP_BANDS,
  nextBand,
  NO_BASE_MAP_LABELS,
  pxPerYardAt,
  viewBand,
  zoomAtPxPerYard,
  type AreaDescriptor,
  type LabelDescriptor,
  type TileBandDescriptor,
} from './adapter';
import { bandFor, MINIMAP_TEMPLATE, syntheticIndex } from '../../tests/support/atlas-tiles';

const ONE = worldMapId(1);

describe('surface ids', () => {
  it('formats and parses world:<mapId>', () => {
    expect(surfaceIdOf(worldMapId(0))).toBe('world:0');
    expect(surfaceIdOf(worldMapId(2991))).toBe('world:2991');
    expect(parseSurfaceId('world:1')).toBe(1);
    expect(parseSurfaceId('world:2997')).toBe(2997);
    expect(surfaceMapId('world:0')).toBe(0);
  });

  it('refuses anything but a canonical non-negative integer', () => {
    for (const text of ['world:', 'world:-1', 'world:1.5', 'world:01', 'world:1e3', 'ui:947', ' world:1', 'world:1 ']) {
      expect(parseSurfaceId(text), text).toBeNull();
    }
    expect(() => surfaceMapId('world:1.5')).toThrow(RangeError);
  });
});

describe('world bounds', () => {
  const b: WorldBounds = { mapId: ONE, xMin: -10, xMax: 10, yMin: -20, yMax: 20 };

  it('contains points on its map, edges included', () => {
    expect(boundsContain(b, { mapId: ONE, x: 10, y: -20 })).toBe(true);
    expect(boundsContain(b, { mapId: ONE, x: 10.001, y: 0 })).toBe(false);
    expect(boundsContain(b, { mapId: worldMapId(0), x: 0, y: 0 })).toBe(false);
  });

  it('has a centre', () => {
    expect(boundsCenter(b)).toEqual({ mapId: ONE, x: 0, y: 0 });
  });

  it('bounds points on one map and ignores the others', () => {
    const points = [
      { mapId: ONE, x: 1, y: 5 },
      { mapId: worldMapId(0), x: 1000, y: 1000 },
      { mapId: ONE, x: -3, y: 2 },
    ];
    expect(boundsOfPoints(ONE, points)).toEqual({ mapId: ONE, xMin: -3, xMax: 1, yMin: 2, yMax: 5 });
    expect(boundsOfPoints(worldMapId(2991), points)).toBeNull();
  });
});

describe('layers', () => {
  it('lists every layer once in the draw order of map-presentation.md §5.2 and §25.2.6: lines, then pins, then beads, the selection and the labels canvas', () => {
    expect(new Set(LAYER_IDS).size).toBe(LAYER_IDS.length);
    expect(LAYER_IDS).toEqual([
      'relief',
      'art',
      'coastline',
      'zone-outlines',
      'zone-fill',
      'zone-frames',
      'flight-network',
      'transports',
      'route-line',
      'services',
      'objectives',
      'available-quests',
      'turn-ins',
      'dungeons',
      'flight-masters',
      'route-steps',
      'proposal',
      'selection',
      'labels',
    ]);
    expect(IMAGE_LAYER_IDS).toEqual(['relief', 'art']);
    expect(LAYER_IDS.filter(isImageLayer)).toEqual(['relief', 'art']);
    expect(LABEL_LAYER_IDS).toEqual(['labels']);
    expect(LAYER_IDS.filter(isLabelLayer)).toEqual(['labels']);
    // The labels canvas is above every path; the selection tops the path canvas.
    expect(LAYER_IDS.at(-1)).toBe('labels');
    expect(LAYER_IDS.filter((layer) => !isImageLayer(layer) && !isLabelLayer(layer)).at(-1)).toBe('selection');
    // Lines under pins, pins under the route's beads (§25.2.6): the route line below every spawn
    // layer, the step beads above them, so a step at a quest giver shows its bead on the giver.
    for (const spawn of SPAWN_LAYER_IDS) {
      expect(LAYER_IDS.indexOf(spawn)).toBeGreaterThan(LAYER_IDS.indexOf('route-line'));
      expect(LAYER_IDS.indexOf(spawn)).toBeLessThan(LAYER_IDS.indexOf('route-steps'));
    }
    expect(Object.keys(LAYER_LABELS).sort()).toEqual([...LAYER_IDS].sort());
    expect(isLayerId('route-steps')).toBe(true);
    expect(isLayerId('route')).toBe(false);
  });

  it('shares one items array between empty contents, so repeated clears are skipped by reference', () => {
    const a = emptyLayerContent('route-line');
    const b = emptyLayerContent('objectives');
    expect(a.items).toBe(b.items);
    expect(a.items).toEqual([]);
    expect(a.stats.drawn).toBe(0);
    expect(b.layer).toBe('objectives');
  });
});

describe('descriptorMapId', () => {
  const ref = { kind: 'step', stepId: stepId('s1') } as const;
  it('reads the world map of every descriptor type', () => {
    const bounds: WorldBounds = { mapId: worldMapId(2991), xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    const descriptors: readonly MapDescriptor[] = [
      {
        type: 'marker',
        id: 'm',
        point: { mapId: ONE, x: 0, y: 0 },
        kind: 'step',
        style: 'accent',
        emphasis: 'normal',
        label: null,
        badges: [],
        ref,
        count: 1,
        refs: [ref],
        labels: [null],
      },
      { type: 'polyline', id: 'p', mapId: worldMapId(0), points: [], style: 'route', emphasis: 'normal', label: null, ref },
      { type: 'frame', id: 'f', bounds, kind: 'zone', label: null, emphasis: 'normal', filled: true, ref },
      { type: 'art', id: 'a', bounds, url: 'x.webp', opacity: 1, label: null, ref },
      {
        type: 'aggregate',
        id: 'g',
        point: { mapId: worldMapId(30), x: 0, y: 0 },
        layer: 'objectives',
        count: 1,
        subjects: 1,
        emphasis: 'normal',
        label: null,
        ref,
      },
      { type: 'outline', id: 'o', mapId: worldMapId(0), kind: 'zones', lines: [], label: null, ref: { kind: 'terrain', layer: 'zone-outlines', mapId: worldMapId(0) } },
    ];
    expect(descriptors.map(descriptorMapId)).toEqual([1, 0, 2991, 2991, 30, 0]);
  });
});

describe('walking paths input', () => {
  it('keys a leg by its world map and both end points, exactly', () => {
    const from = { mapId: ONE, x: -618.2, y: -4251.7 };
    expect(routeLegKey({ from, to: { mapId: ONE, x: -601, y: -4225 } })).toBe('1:-618.2,-4251.7>-601,-4225');
    expect(routeLegKey({ from, to: { mapId: ONE, x: -601, y: -4225.01 } })).not.toBe(routeLegKey({ from, to: { mapId: ONE, x: -601, y: -4225 } }));
  });
});

describe('mapViewOf', () => {
  it('keeps the world map, zoom and centre of a view state', () => {
    const view = mapViewOf({
      surface: 'world:1',
      mapId: ONE,
      center: { mapId: ONE, x: 5, y: -7 },
      zoom: -2.5,
      bounds: { mapId: ONE, xMin: 0, xMax: 10, yMin: -10, yMax: 0 },
      widthPx: 800,
      heightPx: 600,
    });
    expect(view).toEqual({ mapId: 1, zoom: -2.5, center: { x: 5, y: -7 }, bounds: { mapId: 1, xMin: 0, xMax: 10, yMin: -10, yMax: 0 } });
  });
});

describe('labels without step numbers (M3 review PERF-2, MAP-UX-3)', () => {
  const step = (id: string): MapRef => ({ kind: 'step', stepId: stepId(id) });
  const marker = (ids: readonly string[], labels: readonly (string | null)[]): MarkerDescriptor => ({
    type: 'marker',
    id: `step:${ids[0] ?? ''}`,
    point: { mapId: ONE, x: 0, y: 0 },
    kind: 'step',
    style: 'accent',
    emphasis: 'normal',
    label: labels[0] ?? null,
    badges: [],
    ref: step(ids[0] ?? ''),
    count: ids.length,
    refs: ids.map(step),
    labels,
  });

  it('combines the labels of a stack, naming how many it holds', () => {
    expect(combineLabels([])).toBeNull();
    expect(combineLabels([], 3)).toBe('3 here');
    expect(combineLabels(['a'])).toBe('a');
    expect(combineLabels(['a', 'b'])).toBe('2 here: a; b');
    expect(combineLabels(['a', 'b', 'c', 'd', 'e', 'f'])).toBe('6 here: a; b; c and 3 more');
    expect(combineLabels(['a'], 4)).toBe('4 here: a and 3 more');
  });

  it('resolves label keys with the provider when a label is shown, else keeps the descriptor’s own', () => {
    const numbers: Readonly<Record<string, number>> = { x: 12, y: 13 };
    const provider = (ref: MapRef): string | null => (ref.kind === 'step' ? `${String(numbers[ref.stepId] ?? 0)} · Note` : null);
    const one = marker(['x'], ['x']);
    expect(labelOf(one)).toBe('x');
    expect(labelOf(one, provider)).toBe('12 · Note');
    expect(labelOf(marker(['x', 'y'], ['x', 'y']), provider)).toBe('2 here: 12 · Note; 13 · Note');
    expect(labelOf(marker(['x'], [null]))).toBeNull();
    expect(refsOf(marker(['x', 'y'], ['x', 'y']))).toEqual([step('x'), step('y')]);
    const frame: MapDescriptor = {
      type: 'frame',
      id: 'f',
      bounds: { mapId: ONE, xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
      kind: 'zone',
      filled: true,
      label: 'Durotar',
      emphasis: 'normal',
      ref: { kind: 'zone', uiMapId: uiMapId(1411) },
    };
    // A provider that knows nothing about a ref leaves the descriptor's label.
    expect(labelOf(frame, provider)).toBe('Durotar');
    expect(refsOf(frame)).toEqual([frame.ref]);
  });

  it('caps route polylines at 256 vertices', () => {
    // map/layers ties ROUTE_PIECE_MAX_VERTICES to this constant's type, so the two cannot drift.
    expect(MAX_POLYLINE_VERTICES).toBe(256);
  });
});

// =============================================================================================
// The atlas surface (docs/research/map-atlas.md §5, §8.1; steps ATL.3-ATL.5)

const EK = worldMapId(0);
const ZEPHRAS = worldMapId(2991);

/** The atlas over the cited fixture rows (947 rows 46785 and 46784, 2521 row 69208), as map/layers' `atlasSurfaceOf` builds it. */
function fixtureAtlas(): AtlasSurfaceInfo {
  const placements = atlasPlacements(fixtureGeometry(), ATLAS_LAYOUT);
  if (placements === null) throw new Error('the fixture geometry cannot place the atlas');
  const member = (mapId: typeof ONE, name: string): WorldSurfaceInfo => ({
    id: surfaceIdOf(mapId),
    mapId,
    name,
    extent: placements.find((placement) => placement.mapId === mapId)?.rect ?? { mapId, xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
    extentSource: 'zone-union',
    extentUiMapId: null,
    uiMapIds: [],
  });
  const [first] = placements;
  if (first === undefined) throw new Error('no placement');
  const e = ATLAS_LAYOUT.extent;
  return {
    kind: 'atlas',
    id: 'atlas',
    mapId: first.mapId,
    name: 'Azeroth',
    extent: { mapId: first.mapId, xMin: first.sOff - e.sMax, xMax: first.sOff - e.sMin, yMin: first.eOff - e.eMax, yMax: first.eOff - e.eMin },
    extentSource: 'atlas',
    extentUiMapId: null,
    uiMapIds: [],
    mapIds: placements.map((placement) => placement.mapId),
    placements,
    layout: ATLAS_LAYOUT,
    hash: atlasHash(placements, ATLAS_LAYOUT),
    members: [member(ONE, 'Kalimdor'), member(EK, 'Eastern Kingdoms'), member(ZEPHRAS, 'Zephras Isle')],
  };
}

const WORLD_ONE: WorldSurfaceInfo = {
  id: 'world:1',
  mapId: ONE,
  name: 'Kalimdor',
  extent: { mapId: ONE, xMin: -11733.299804688, xMax: 12799.900390625, yMin: -19733.2109375, yMax: 17066.599609375 },
  extentSource: 'continent',
  extentUiMapId: uiMapId(1414),
  uiMapIds: [],
};

describe('atlas surface ids', () => {
  it('accepts `atlas` as a surface id that names no single world map', () => {
    expect(isSurfaceId('atlas')).toBe(true);
    expect(isSurfaceId('world:1')).toBe(true);
    expect(isSurfaceId('world:1.5')).toBe(false);
    expect(isSurfaceId('Atlas')).toBe(false);
    expect(parseSurfaceId(ATLAS_SURFACE_ID)).toBeNull();
    expect(() => surfaceMapId('atlas')).toThrow(RangeError);
  });
});

describe('surface placements (map-atlas.md §5.1, §5.4)', () => {
  it('draws a world surface through its identity placement over its extent', () => {
    expect(surfacePlacements(WORLD_ONE)).toEqual([{ mapId: ONE, kind: 'identity', scale: 1, eOff: 0, sOff: 0, rect: WORLD_ONE.extent }]);
    expect(surfacePlacements(WORLD_ONE)).toBe(surfacePlacements(WORLD_ONE));
    expect(surfaceMapIds(WORLD_ONE)).toEqual([ONE]);
    expect(placementOn(WORLD_ONE, EK)).toBeNull();
    expect(isAtlasSurface(WORLD_ONE)).toBe(false);
  });

  it('draws the atlas through the compact layout’s placements: Kalimdor, the Eastern Kingdoms, Zephras Isle', () => {
    const atlas = fixtureAtlas();
    expect(surfaceMapIds(atlas)).toEqual([ONE, EK, ZEPHRAS]);
    expect(surfacePlacements(atlas).map((placement) => [placement.mapId, placement.kind, placement.eOff, placement.sOff])).toEqual([
      [ONE, 'placed', 5652, 12778],
      [EK, 'placed', 22499, 7907],
      [ZEPHRAS, 'inset', 17671.25, 5468.25],
    ]);
    expect(placementOn(atlas, worldMapId(2997))).toBeNull();
  });

  it('resolves every atlas position to a real world map: the card, then the side of the seam (E 16,617)', () => {
    const atlas = fixtureAtlas();
    // The card spans E 13,440–19,002.5, S 512–4,220.3: its north-west corner is Zephras Isle's (xMax, yMax).
    expect(surfacePointAt(atlas, 13440, 512)).toEqual({ mapId: ZEPHRAS, x: 4956.25, y: 4231.25 });
    expect(surfacePointAt(atlas, 16617, 10000)).toEqual({ mapId: ONE, x: 12778 - 10000, y: 5652 - 16617 });
    expect(surfacePointAt(atlas, 16617.5, 10000)).toEqual({ mapId: EK, x: 7907 - 10000, y: 22499 - 16617.5 });
    // Open sea far from any land still names a map (D-042 A5).
    expect(surfacePointAt(atlas, 30000, 26000)?.mapId).toBe(EK);
    expect(surfacePointAt(WORLD_ONE, 5, 7)).toEqual({ mapId: ONE, x: -7, y: -5 });
  });

  it('moves rectangles between maps of one surface by the translation between their placements (display only)', () => {
    const atlas = fixtureAtlas();
    const durotar: WorldBounds = { mapId: ONE, xMin: -1716.6666259766, xMax: 1808.3332519531, yMin: -7249.9995117188, yMax: -1962.4998779297 };
    const moved = boundsOnMap(atlas, durotar, EK);
    // Same atlas rectangle: E = eOff − y, S = sOff − x on both sides.
    expect(moved).toEqual({ mapId: EK, xMin: durotar.xMin + (7907 - 12778), xMax: durotar.xMax + (7907 - 12778), yMin: durotar.yMin + (22499 - 5652), yMax: durotar.yMax + (22499 - 5652) });
    expect(boundsOnMap(atlas, durotar, ONE)).toBe(durotar);
    expect(boundsOnMap(WORLD_ONE, durotar, EK)).toBeNull();
    const stormwind: WorldBounds = { mapId: EK, xMin: -9154, xMax: -7995, yMin: -14, yMax: 1722 };
    const union = surfaceBoundsUnion(atlas, [durotar, stormwind]);
    expect(union?.mapId).toBe(ONE);
    expect(union?.xMin).toBe(Math.min(durotar.xMin, stormwind.xMin + (12778 - 7907)));
    expect(union?.yMax).toBe(Math.max(durotar.yMax, stormwind.yMax + (5652 - 22499)));
    expect(surfaceBoundsUnion(WORLD_ONE, [stormwind])).toBeNull();
    expect(surfaceBoundsUnion(WORLD_ONE, [durotar])).toBe(durotar);
  });

  it('sends a point to the shown surface when it places the map, else to the first that does', () => {
    const atlas = fixtureAtlas();
    const darkspear: WorldSurfaceInfo = { ...WORLD_ONE, id: 'world:2997', mapId: worldMapId(2997), name: 'Darkspear Islands' };
    const surfaces: readonly SurfaceInfo[] = [atlas, darkspear];
    expect(surfaceForMap(surfaces, 'world:2997', EK)?.id).toBe('atlas');
    expect(surfaceForMap(surfaces, 'atlas', worldMapId(2997))?.id).toBe('world:2997');
    expect(surfaceForMap(surfaces, null, worldMapId(36))).toBeNull();
    expect(surfaceForMap([WORLD_ONE, atlas], 'atlas', ONE)?.id).toBe('atlas');
    expect(surfaceForMap([WORLD_ONE, atlas], null, ONE)?.id).toBe('world:1');
  });
});

describe('descriptors on a surface (map-atlas.md §8.1, §8.5)', () => {
  const connector = (from: typeof ONE, to: typeof ONE): ConnectorDescriptor => ({
    type: 'connector',
    id: 'connector:a>b',
    from: { mapId: from, x: 0, y: 0 },
    to: { mapId: to, x: 1, y: 1 },
    style: 'transport',
    emphasis: 'normal',
    label: 'Transport to Eastern Kingdoms',
    ref: { kind: 'connector', fromStepId: stepId('a'), toStepId: stepId('b'), fromMapId: from, toMapId: to, leg: 'transport' },
  });
  const marker = (mapId: typeof ONE): MarkerDescriptor => ({
    type: 'marker',
    id: `m:${String(mapId)}`,
    point: { mapId, x: 0, y: 0 },
    kind: 'step',
    style: 'accent',
    emphasis: 'normal',
    label: null,
    badges: [],
    ref: { kind: 'step', stepId: stepId('a') },
    count: 1,
    refs: [{ kind: 'step', stepId: stepId('a') }],
    labels: [null],
  });

  it('draws what is on a placed map of the atlas, and on a world surface only its own map', () => {
    const atlas = fixtureAtlas();
    expect([ONE, EK, ZEPHRAS, worldMapId(2997)].map((mapId) => descriptorOnSurface(marker(mapId), atlas))).toEqual([true, true, true, false]);
    expect([ONE, EK].map((mapId) => descriptorOnSurface(marker(mapId), WORLD_ONE))).toEqual([true, false]);
  });

  it('draws a connector only where both ends’ maps are placed as maps: never on a world surface, never to an inset', () => {
    const atlas = fixtureAtlas();
    expect(descriptorOnSurface(connector(ONE, EK), atlas)).toBe(true);
    expect(descriptorOnSurface(connector(EK, ONE), atlas)).toBe(true);
    expect(descriptorOnSurface(connector(ONE, ZEPHRAS), atlas)).toBe(false);
    expect(descriptorOnSurface(connector(ONE, worldMapId(36)), atlas)).toBe(false);
    expect(descriptorOnSurface(connector(ONE, EK), WORLD_ONE)).toBe(false);
    expect(descriptorMapId(connector(EK, ONE))).toBe(EK);
  });
});

describe('shareCap (map-atlas.md §8.1)', () => {
  it('splits the cap in proportion to the counts, by the largest remainder, ties to the earlier entry', () => {
    expect(shareCap([3, 1], 100)).toEqual([75, 25]);
    expect(shareCap([1, 1, 1], 100)).toEqual([34, 33, 33]);
    expect(shareCap([1, 2], 10)).toEqual([3, 7]);
    expect(shareCap([700, 0], 700)).toEqual([700, 0]);
    expect(shareCap([5, 5], 3)).toEqual([2, 1]);
  });

  it('always hands out the whole cap when any count is positive, and nothing otherwise', () => {
    for (const counts of [
      [1, 2, 3],
      [1e6, 1, 1],
      [0.5, 0, 7],
      [3, 3, 3, 3, 3, 3, 3],
    ]) {
      for (const cap of [0, 1, 7, 100, 2500]) expect(shareCap(counts, cap).reduce((a, b) => a + b, 0), `${counts.join(',')} / ${String(cap)}`).toBe(cap);
    }
    expect(shareCap([0, 0], 100)).toEqual([0, 0]);
    expect(shareCap([Number.NaN, -1, 2], 10)).toEqual([0, 0, 10]);
    expect(shareCap([2, 2], Number.POSITIVE_INFINITY)).toEqual([0, 0]);
  });
});

describe('atlas views (map-atlas.md §8.1)', () => {
  const kalimdor: WorldBounds = { mapId: ONE, xMin: -1000, xMax: 1000, yMin: -9000, yMax: -7000 };
  const ek: WorldBounds = { mapId: EK, xMin: 3871, xMax: 5871, yMin: 7847, yMax: 9847 };

  it('carries the surface and the visible maps into the layer view of an atlas state, and nothing more for a world one', () => {
    const state = {
      surface: 'atlas' as const,
      mapId: ONE,
      center: { mapId: ONE, x: 0, y: -8000 },
      zoom: -3,
      bounds: kalimdor,
      widthPx: 800,
      heightPx: 600,
      visible: [kalimdor, ek],
    };
    const view = mapViewOf(state);
    expect(view).toEqual({ mapId: ONE, zoom: -3, center: { x: 0, y: -8000 }, bounds: kalimdor, surface: 'atlas', visible: [kalimdor, ek] });
    expect(viewMapIds(view)).toEqual([ONE, EK]);
    expect(viewBoundsOn(view, EK)).toBe(ek);
    expect(viewBoundsOn(view, ZEPHRAS)).toBeNull();
    // The centre's map is always built, even outside every placed rectangle.
    expect(viewMapIds({ ...view, visible: [ek] })).toEqual([EK, ONE]);
    const { visible: _visible, ...rest } = state;
    const world = mapViewOf({ ...rest, surface: 'world:1' });
    expect('surface' in world).toBe(false);
    expect(viewMapIds(world)).toEqual([ONE]);
    expect(viewBoundsOn(world, ONE)).toBe(kalimdor);
    expect(viewBoundsOn(world, EK)).toBeNull();
  });

  it('places a point in stage pixels through its own map’s visible rectangle', () => {
    const state = { surface: 'atlas' as const, mapId: ONE, center: { mapId: ONE, x: 0, y: -8000 }, zoom: -3, bounds: kalimdor, widthPx: 800, heightPx: 600, visible: [kalimdor, ek] };
    expect(stagePixelOf(state, { mapId: ONE, x: 1000, y: -7000 })).toEqual({ x: 0, y: 0 });
    expect(stagePixelOf(state, { mapId: EK, x: 3871, y: 7847 })).toEqual({ x: 800, y: 600 });
    expect(stagePixelOf(state, { mapId: ZEPHRAS, x: 0, y: 0 })).toBeNull();
  });
});

// =============================================================================================
// The atlas tiles (docs/research/map-atlas.md §7.1, §7.2, §8.1; step ATL.7)

describe('resolveTile (map-atlas.md §7.2, MA-10)', () => {
  // Level −8 stored; level −5: key (1, 1) stored, (3, 3) sea; level −2: (5, 5) stored, (12, 12) sea
  // with (13, 12) neither; level −1: (10, 10) stored.
  const index = syntheticIndex({
    stored: { [-8]: [[0, 0]], [-5]: [[1, 1]], [-2]: [[5, 5]], [-1]: [[10, 10]] },
    sea: { [-5]: [[3, 3]], [-2]: [[12, 12]] },
  });

  it('resolves a stored key as stored and builds its URL', () => {
    expect(resolveTile(index, -2, 5, 5)).toEqual({ kind: 'stored' });
    expect(resolveTile(index, -1, 10, 10)).toEqual({ kind: 'stored' });
    expect(isStoredTile(index, -5, 1, 1)).toBe(true);
    const band = bandFor(index, '/base/maps/atlas/t/{z}/{x}/{y}.webp');
    expect(tileUrl(band, -2, 5, 5)).toBe('/base/maps/atlas/t/-2/5/5.webp');
  });

  it('never builds a URL for a key the index does not list', () => {
    const band = bandFor(index);
    expect(tileUrl(band, -2, 6, 5)).toBeNull();
    expect(tileUrl(band, -2, 12, 12)).toBeNull();
    expect(tileUrl(band, -9, 0, 0)).toBeNull();
    expect(tileUrl(band, 1, 0, 0)).toBeNull();
    expect(tileUrl(band, -2, 30, 0)).toBeNull();
  });

  it('resolves a sea key as sea (it creates no element)', () => {
    expect(resolveTile(index, -5, 3, 3)).toEqual({ kind: 'sea' });
    expect(resolveTile(index, -2, 12, 12)).toEqual({ kind: 'sea' });
  });

  it('resolves a fine key over a level −2 sea key as sea, at both fine levels', () => {
    expect(resolveTile(index, -1, 24, 24)).toEqual({ kind: 'sea' });
    expect(resolveTile(index, -1, 25, 25)).toEqual({ kind: 'sea' });
    expect(resolveTile(index, 0, 48, 48)).toEqual({ kind: 'sea' });
    expect(resolveTile(index, 0, 51, 51)).toEqual({ kind: 'sea' });
    // Next to it, over a level −2 key that is not sea, a fine key is virtual.
    expect(resolveTile(index, 0, 52, 48).kind).toBe('virtual');
  });

  it('resolves a virtual key to its nearest stored ancestor, with the scale and its offsets in it', () => {
    // Level 0 key (21, 22): its level −1 ancestor (10, 11) is not stored, its level −2 ancestor (5, 5) is.
    expect(resolveTile(index, 0, 21, 22)).toEqual({ kind: 'virtual', z: -2, x: 5, y: 5, scale: 4, dx: 1, dy: 2 });
    // Level 0 key (21, 20): its level −1 ancestor (10, 10) is stored and nearer.
    expect(resolveTile(index, 0, 21, 20)).toEqual({ kind: 'virtual', z: -1, x: 10, y: 10, scale: 2, dx: 1, dy: 0 });
    // Level −3 key (0, 0): nothing stored at −4 … −7 above it, so level −8's one key, 32 times.
    expect(resolveTile(index, -3, 0, 0)).toEqual({ kind: 'virtual', z: -8, x: 0, y: 0, scale: 32, dx: 0, dy: 0 });
    // Level −4 key (3, 2): its level −5 ancestor (1, 1) is stored.
    expect(resolveTile(index, -4, 3, 2)).toEqual({ kind: 'virtual', z: -5, x: 1, y: 1, scale: 2, dx: 1, dy: 0 });
  });

  it('treats keys outside the index’s levels or grid as sea: nothing is drawn or requested there', () => {
    expect(resolveTile(index, -9, 0, 0)).toEqual({ kind: 'sea' });
    expect(resolveTile(index, 1, 0, 0)).toEqual({ kind: 'sea' });
    expect(resolveTile(index, -2, 30, 0)).toEqual({ kind: 'sea' });
    expect(resolveTile(index, -2, 0, 26)).toEqual({ kind: 'sea' });
    expect(resolveTile(index, -2, -1, 0)).toEqual({ kind: 'sea' });
    expect(resolveTile(index, -2, 0.5, 0)).toEqual({ kind: 'sea' });
    // A level with nothing stored above a key: sea too.
    expect(resolveTile(syntheticIndex({ stored: {} }), -3, 0, 0)).toEqual({ kind: 'sea' });
  });

  it('lists the stored keys of a level row by row (the underlay’s keys)', () => {
    expect(storedTilesAt(index, -5)).toEqual([[1, 1]]);
    expect(storedTilesAt(index, -4)).toEqual([]);
    expect(storedTilesAt(index, 3)).toEqual([]);
    expect(tileLevelOf(index, -2)).toMatchObject({ z: -2, nx: 30, ny: 26 });
  });

  it('builds the band as plain data, the one descriptor in atlas units', () => {
    const band = tileBandOf(index, '/t/{z}/{x}/{y}.webp', 'painted');
    expect(band).toEqual(bandFor(index, '/t/{z}/{x}/{y}.webp'));
    expect(descriptorMapId(band)).toBeNull();
    expect(refsOf(band)).toEqual([{ kind: 'atlas-tiles' }]);
    // One band per style (map-atlas.md §21.2): its id names the style, so a switch replaces the band;
    // the minimap band keeps one row and column around the view, the painted two (§24.5).
    expect([band.id, band.style, band.keepBuffer]).toEqual(['atlas-tiles:painted', 'painted', 2]);
    const minimap = tileBandOf(syntheticIndex({ stored: {}, style: 'minimap' }), '/m/{z}/{x}/{y}.webp', 'minimap');
    expect([minimap.id, minimap.style, minimap.keepBuffer, minimap.underlayLevel]).toEqual([tileBandId('minimap'), 'minimap', TILE_KEEP_BUFFER.minimap, -6]);
    expect(minimap.id).not.toBe(band.id);
  });

  it('draws the band only on an atlas whose hash is the index’s', () => {
    const atlas = fixtureAtlas();
    const world: WorldSurfaceInfo = { id: 'world:1', mapId: ONE, name: 'Kalimdor', extent: atlas.placements[0]?.rect ?? { mapId: ONE, xMin: 0, xMax: 1, yMin: 0, yMax: 1 }, extentSource: 'zone-union', extentUiMapId: null, uiMapIds: [] };
    expect(descriptorOnSurface(tileBandOf(syntheticIndex({ stored: {}, hash: atlas.hash }), '', 'painted'), atlas)).toBe(true);
    expect(descriptorOnSurface(tileBandOf(syntheticIndex({ stored: {} }), '', 'painted'), atlas)).toBe(false);
    expect(descriptorOnSurface(tileBandOf(syntheticIndex({ stored: {}, hash: atlas.hash }), '', 'painted'), world)).toBe(false);
    expect(descriptorOnSurface(tileBandOf(syntheticIndex({ stored: {}, hash: atlas.hash, style: 'minimap' }), '', 'minimap'), atlas)).toBe(true);
  });
});

// =============================================================================================
// Two styles (docs/research/map-atlas.md §18.4, §21, §24.5; step MM.1)

describe('two styles (map-atlas.md §21, §24.5; MM.1)', () => {
  it('names two styles, the minimap by default since the presentation’s names exist (§21.3, §22; MM.9)', () => {
    expect([isMapStyle('minimap'), isMapStyle('painted'), isMapStyle('Minimap'), isMapStyle(null), isMapStyle('atlas')]).toEqual([true, true, false, false, false]);
    expect(DEFAULT_MAP_STYLE).toBe('minimap');
    expect([tileBandId('minimap'), tileBandId('painted')]).toEqual(['atlas-tiles:minimap', 'atlas-tiles:painted']);
  });

  it('resolves every key of a minimap index as stored or sea: its base level is 0 and no key is virtual (§18.4)', () => {
    const minimap = syntheticIndex({
      style: 'minimap',
      stored: {
        [-8]: [[0, 0]],
        [-7]: [[0, 0]],
        [-6]: [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ],
        [-2]: [[5, 5]],
        [0]: [
          [20, 20],
          [21, 20],
        ],
      },
    });
    expect([minimap.baseLevel, minimap.underlayLevel, minimap.uiMaps.size]).toEqual([0, -6, 0]);
    let stored = 0;
    for (const level of minimap.levels) {
      expect(level.sea, String(level.z)).not.toBeNull();
      for (let y = 0; y < level.ny; y += 1) {
        for (let x = 0; x < level.nx; x += 1) {
          const kind = resolveTile(minimap, level.z, x, y).kind;
          expect(kind === 'stored' || kind === 'sea', `${String(level.z)}/${String(x)}/${String(y)}`).toBe(true);
          if (kind === 'stored') stored += 1;
        }
      }
    }
    expect(stored).toBe(9);
    // Its underlay holds the level −6 keys: 4 tiles (§24.5).
    expect(storedTilesAt(minimap, minimap.underlayLevel)).toHaveLength(4);
    const band = tileBandOf(minimap, '/base/maps/minimap/t/{z}/{x}/{y}.webp', 'minimap');
    expect(tileUrl(band, 0, 21, 20)).toBe('/base/maps/minimap/t/0/21/20.webp');
    expect(tileUrl(band, 0, 22, 20)).toBeNull();
  });

  it('keeps the decoded-tile budgets by the design’s arithmetic (§24.5, MM-09)', () => {
    const mb = (tiles: number): number => tiles * DECODED_TILE_BYTES;
    expect(DECODED_TILE_BYTES).toBe(262_144);
    // In view, minimap: 7 × 5 tiles at the worst fractional zoom in a 918 × 700 panel, plus the level −6 underlay.
    expect(mb(35 + 4)).toBeLessThanOrEqual(TILE_MEMORY_BUDGET.inViewBytes);
    // Revision 3's level −5 underlay (13 tiles) would not fit: why the minimap's is level −6.
    expect(mb(35 + 13)).toBeGreaterThan(TILE_MEMORY_BUDGET.inViewBytes);
    // All live tiles: keepBuffer 1 keeps 9 × 7; Leaflet's default 2 would keep 11 × 9 (over the budget).
    expect(mb((7 + 2 * TILE_KEEP_BUFFER.minimap) * (5 + 2 * TILE_KEEP_BUFFER.minimap) + 4)).toBeLessThanOrEqual(TILE_MEMORY_BUDGET.liveBytes);
    expect(mb(11 * 9)).toBeGreaterThan(TILE_MEMORY_BUDGET.liveBytes);
    // A switch from painted to minimap with the old buffer pruned: two views and both underlays.
    expect(mb(35 + 13 + 35 + 4)).toBeLessThanOrEqual(TILE_MEMORY_BUDGET.switchBytes);
    expect(TILE_MEMORY_BUDGET.holdMs).toBe(2000);
  });
});

describe('zoom bands (map-presentation.md §5.1; step MP.1)', () => {
  it('chooses the band from the pixels per yard: world below 0.022, continent to 0.088, zone to 0.5, close above', () => {
    expect(BAND_EDGES).toEqual({ continent: 0.022, zone: 0.088, close: 0.5 });
    expect(MAP_BANDS).toEqual(['world', 'continent', 'zone', 'close']);
    expect(bandAt(0.0219)).toBe('world');
    expect(bandAt(0.022)).toBe('continent');
    expect(bandAt(0.0879)).toBe('continent');
    expect(bandAt(0.088)).toBe('zone');
    expect(bandAt(0.4999)).toBe('zone');
    expect(bandAt(0.5)).toBe('close');
    expect(bandAt(3)).toBe('close');
    expect(bandAt(0)).toBe('world');
    expect(bandAt(Number.NaN)).toBe('world');
    expect(bandAt(Infinity)).toBe('close');
    // The fit-both view of the 918 px panel (0.0239 px per yard) is in the continent band, at the top of the world band's hysteresis.
    expect(bandAt(0.0239)).toBe('continent');
    expect(nextBand('world', 0.0239)).toBe('world');
    // The design's zooms on a world surface (scale 1): -5.5, -3.5 and -1 are the edges, to rounding.
    expect(bandAt(pxPerYardAt(-5.5))).toBe('continent');
    expect(bandAt(pxPerYardAt(-3.5))).toBe('zone');
    expect(bandAt(pxPerYardAt(-1))).toBe('close');
    expect(zoomAtPxPerYard(0.088)).toBeCloseTo(-3.506, 3);
  });

  it('changes band only once the scale passes an edge by 0.125 zoom, in either direction', () => {
    expect(BAND_HYSTERESIS_ZOOM).toBe(0.125);
    // Resting at -3.5 (on the zone edge): each side keeps its band.
    expect(nextBand('continent', pxPerYardAt(-3.5))).toBe('continent');
    expect(nextBand('zone', pxPerYardAt(-3.5))).toBe('zone');
    const up = zoomAtPxPerYard(0.088) + 0.125;
    expect(nextBand('continent', pxPerYardAt(up - 0.001))).toBe('continent');
    expect(nextBand('continent', pxPerYardAt(up + 0.001))).toBe('zone');
    const down = zoomAtPxPerYard(0.088) - 0.125;
    expect(nextBand('zone', pxPerYardAt(down + 0.001))).toBe('zone');
    expect(nextBand('zone', pxPerYardAt(down - 0.001))).toBe('continent');
    // A jump across several bands takes the plain band; no previous band, too.
    expect(nextBand('world', 1)).toBe('close');
    expect(nextBand(null, pxPerYardAt(-3.5))).toBe('zone');
  });

  it('never flickers when a view rests on an edge or steps back and forth across it by less than the margin', () => {
    for (const edge of [BAND_EDGES.continent, BAND_EDGES.zone, BAND_EDGES.close]) {
      const at = zoomAtPxPerYard(edge);
      for (const side of [-1, 1]) {
        let band = nextBand(null, pxPerYardAt(at + side * 0.25));
        const first = band;
        for (let i = 0; i < 12; i += 1) {
          // Oscillate across the edge by 0.1 zoom each way, inside the 0.125 margin.
          const zoom = at + (i % 2 === 0 ? -0.1 : 0.1);
          band = nextBand(band, pxPerYardAt(zoom));
          expect(band, `edge ${String(edge)}, side ${String(side)}`).toBe(first);
        }
      }
    }
  });

  it('bands by placement: a placement of another scale gets its own band at the same zoom', () => {
    expect(pxPerYardAt(-3, 1)).toBeCloseTo(0.125, 12);
    expect(bandAt(pxPerYardAt(-3, 1))).toBe('zone');
    // An inset drawn at half scale is in the continent band at the same zoom.
    expect(bandAt(pxPerYardAt(-3, 0.5))).toBe('continent');
    expect(zoomAtPxPerYard(0.0625, 0.5)).toBeCloseTo(-3, 12);
  });

  it('applies the same rule to in-band thresholds, and reads a view band or its zoom', () => {
    expect(aboveThreshold(null, 0.0325, 0.0325)).toBe(true);
    expect(aboveThreshold(null, 0.0324, 0.0325)).toBe(false);
    expect(aboveThreshold(true, 0.0325 * 2 ** -0.1, 0.0325)).toBe(true);
    expect(aboveThreshold(true, 0.0325 * 2 ** -0.2, 0.0325)).toBe(false);
    expect(aboveThreshold(false, 0.0325 * 2 ** 0.1, 0.0325)).toBe(false);
    expect(aboveThreshold(false, 0.0325 * 2 ** 0.2, 0.0325)).toBe(true);
    expect(viewBand({ zoom: -3.4 })).toBe('zone');
    expect(viewBand({ zoom: -3.4, band: 'continent' })).toBe('continent');
    expect(bandLevelOf('world')).toBe('continent');
    expect(bandLevelOf('continent')).toBe('continent');
    expect(bandLevelOf('zone')).toBe('zone');
    expect(bandLevelOf('close')).toBe('zone');
  });
});

describe('labels and areas (map-presentation.md §5.3; step MP.1)', () => {
  const label: LabelDescriptor = {
    type: 'label',
    id: 'label:zone:1411',
    point: { mapId: ONE, x: 0, y: -4000 },
    kind: 'zone',
    text: 'Durotar',
    card: null,
    priority: 10,
    minPxPerYard: 0,
    maxPxPerYard: 0.3,
    label: null,
    ref: { kind: 'zone', uiMapId: uiMapId(1411) },
  };
  const area: AreaDescriptor = {
    type: 'area',
    id: 'area:101:1',
    mapId: ONE,
    ring: [
      { mapId: ONE, x: 0, y: 0 },
      { mapId: ONE, x: 100, y: 0 },
      { mapId: ONE, x: 0, y: 100 },
    ],
    style: 'objective-area',
    labelStep: stepId('s1'),
    label: 'Objectives of Plainstrider Menace',
    ref: { kind: 'zone', uiMapId: uiMapId(1411) },
  };

  it('puts labels on the labels canvas layer, and both kinds on their world map', () => {
    expect(LABEL_LAYER_IDS).toEqual(['labels']);
    expect(isLabelLayer('labels')).toBe(true);
    expect(isLabelLayer('route-steps')).toBe(false);
    expect(descriptorMapId(label)).toBe(ONE);
    expect(descriptorMapId(area)).toBe(ONE);
    expect(refsOf(label)).toEqual([label.ref]);
    // A label takes no hover text of its own; an area names its quest, never a step number.
    expect(labelOf(label)).toBeNull();
    expect(labelOf(area)).toBe('Objectives of Plainstrider Menace');
  });

  it('draws them through the surface predicate: their map on a world surface; every placed map, the inset included, on the atlas', () => {
    const atlas = fixtureAtlas();
    expect(descriptorOnSurface(label, WORLD_ONE)).toBe(true);
    expect(descriptorOnSurface({ ...label, point: { mapId: EK, x: 0, y: 0 } }, WORLD_ONE)).toBe(false);
    expect(descriptorOnSurface(label, atlas)).toBe(true);
    expect(descriptorOnSurface({ ...label, point: { mapId: ZEPHRAS, x: 3000, y: 1000 } }, atlas)).toBe(true);
    expect(descriptorOnSurface({ ...area, mapId: worldMapId(30) }, atlas)).toBe(false);
  });
});

describe('the atlas interface agreed with the presentation (map-presentation.md MP.0c; map-atlas.md §8.7)', () => {
  const painted = (uiMaps: readonly (readonly [number, number, number])[]): TileBandDescriptor => {
    const index = syntheticIndex({ stored: {} });
    return bandFor({ ...index, uiMaps: new Map(uiMaps.map(([id, topLevel, ydPerPx]) => [uiMapId(id), { topLevel, ydPerPx }])) });
  };

  it('has an empty BaseMapLabels in the minimap style, without a band, and while the art is not at full opacity', () => {
    const minimap = bandFor(syntheticIndex({ stored: {}, style: 'minimap' }), MINIMAP_TEMPLATE, 'minimap');
    expect(baseMapLabelsOf(minimap, 0, { fullOpacity: true })).toBe(NO_BASE_MAP_LABELS);
    expect(baseMapLabelsOf(null, 0, { fullOpacity: true })).toBe(NO_BASE_MAP_LABELS);
    const band = painted([[1411, -1, 2.5]]);
    expect(baseMapLabelsOf(band, 0, { fullOpacity: false })).toBe(NO_BASE_MAP_LABELS);
    expect(baseMapLabelsOf(band, Number.NaN, { fullOpacity: true })).toBe(NO_BASE_MAP_LABELS);
    expect(NO_BASE_MAP_LABELS).toEqual({ continents: false, zones: false, places: [] });
  });

  it('names a painting places where its art is drawn at 0.75 of its native scale or more, no sharper than its stored level, and not under the tint', () => {
    // 1411 stored to level -1 at 2.5 yd per art pixel: 2^zoom x 2.5 >= 0.75 from zoom -1.74.
    // 1412 stored to level -3 at 2.5 yd/px: never sharper than 2^-3 x 2.5 = 0.31 of native, so never legible.
    const band = painted([
      [1411, -1, 2.5],
      [1412, -3, 2.5],
      [1413, 0, 4],
    ]);
    expect(BASE_MAP_LABEL_SCALE).toBe(0.75);
    expect(baseMapLabelsOf(band, -2, { fullOpacity: true }).places).toEqual([uiMapId(1413)]);
    expect(baseMapLabelsOf(band, -1.5, { fullOpacity: true }).places).toEqual([uiMapId(1411), uiMapId(1413)]);
    expect(baseMapLabelsOf(band, 2, { fullOpacity: true }).places).toEqual([uiMapId(1411), uiMapId(1413)]);
    expect(baseMapLabelsOf(band, -3, { fullOpacity: true })).toBe(NO_BASE_MAP_LABELS);
    // Continent and zone names are never the picture's.
    const labels = baseMapLabelsOf(band, 0, { fullOpacity: true });
    expect([labels.continents, labels.zones]).toEqual([false, false]);
    // Under the fallback tint, a painting's names do not count.
    expect(baseMapLabelsOf(band, 0, { fullOpacity: true, tinted: new Set([uiMapId(1413)]) }).places).toEqual([uiMapId(1411)]);
  });

  it('allows the fallback zone tint in the painted style and on untiled art, never in the minimap style (section 25.4)', () => {
    expect(fallbackTintAllowed('minimap')).toBe(false);
    expect(fallbackTintAllowed('painted')).toBe(true);
    expect(fallbackTintAllowed(null)).toBe(true);
  });
});
