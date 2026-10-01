import { describe, expect, it, vi } from 'vitest';
import type { SpawnPoint } from '../domain/dataset';
import { areaId, npcId, objectId, questId, sequentialIdSource, stepId, uiMapId, worldMapId, type QuestId, type WorldMapId } from '../domain/ids';
import { worldSourcedPoint, zoneSourcedPoint, type Location, type WorldPoint } from '../domain/points';
import {
  makeAcceptStep,
  makeCompleteStep,
  makeFlightStep,
  makeGrindStep,
  makeHearthStep,
  makeNoteStep,
  makeTrainStep,
  makeTravelStep,
  makeTurnInStep,
  makeVendorStep,
} from '../domain/step-factory';
import { createMapGeometry, resolvePoint, type UiMapGeometry } from '../geo';
import { atlasHash, atlasPlacements } from '../geo/atlas';
import { ATLAS_LAYOUT } from '../geo/atlas-layout';
import { AZEROTH, DUROTAR, EASTERN_KINGDOMS, fixtureGeometry, FIXTURE_MAPS, KALIMDOR } from '../geo/test-fixtures';
import type {
  AggregateDescriptor,
  ArtDescriptor,
  ArtInput,
  ConnectorDescriptor,
  FrameDescriptor,
  WorldBounds,
  LabelDescriptor,
  LayerContent,
  LayerId,
  MapBand,
  LegStyle,
  MapCategoryId,
  MapDescriptor,
  MapView,
  MarkerDescriptor,
  OutlineDescriptor,
  OutlineInput,
  PlaceItem,
  PlaceLayerInput,
  PointGroupInput,
  PolylineDescriptor,
  ReliefInput,
  RouteInput,
  RouteLeg,
  RoutePathsInput,
  RouteStepInput,
  SpawnLayerInput,
  StepPlacement,
  ZoneFillDescriptor,
} from './adapter';
import {
  atlasSurfaceOf,
  atlasSurfacesOf,
  createLayerJoin,
  insetCaption,
  joinLayerParts,
  partBudgets,
  buildArt,
  buildCoastline,
  buildProposal,
  buildRelief,
  buildRouteLine,
  buildRouteSteps,
  buildSelection,
  buildSpawnLayer,
  buildZoneFrames,
  buildZoneOutlines,
  createLod,
  createMapLayers,
  DEFAULT_LOD,
  groupDigits,
  layerContextOf,
  legOf,
  lodLevelAt,
  lodProblems,
  placeStep,
  plainEqual,
  rankingCenter,
  RANK_GRID_PX,
  RELIEF_OPACITY,
  ROUTE_PIECE_MAX_VERTICES,
  ROUTE_PIECE_MIN_VERTICES,
  routeInputOf,
  routeLegsOf,
  routePieces,
  routeStepInputOf,
  subjectKey,
  surfacesOf,
  bandOfView,
  budgetOf,
  buildLabels,
  labelInBand,
  LAYER_BAND_EDGES,
  flightsKept,
  spawnLayerAggregatesIn,
  viewLodLevel,
  type ClustersOf,
  type LayerCall,
} from './layers';

const geometry = fixtureGeometry();
const ctx = layerContextOf(geometry);
const KALIMDOR_MAP = worldMapId(1);

const ZONE_ZOOM = -2;
const CONTINENT_ZOOM = -5;
const view = (mapId: number, zoom = ZONE_ZOOM, center: { x: number; y: number } | null = null): MapView => ({ mapId: worldMapId(mapId), zoom, center });

const ids = (content: LayerContent): readonly string[] => content.items.map((item) => item.id);
const markers = (content: LayerContent): readonly MarkerDescriptor[] =>
  content.items.filter((item): item is MarkerDescriptor => item.type === 'marker');
const lines = (content: LayerContent): readonly PolylineDescriptor[] =>
  content.items.filter((item): item is PolylineDescriptor => item.type === 'polyline');
const byId = (content: LayerContent, id: string): MapDescriptor => {
  const found = content.items.find((item) => item.id === id);
  if (found === undefined) throw new Error(`no item ${id} in ${ids(content).join(', ')}`);
  return found;
};

// ---- spawns

const zoneSpawn = (ui: number, x: number, y: number): SpawnPoint => {
  const source = zoneSourcedPoint(uiMapId(ui), x, y);
  return { source, world: resolvePoint(source, geometry), uiMapId: uiMapId(ui) };
};
const ENTRANCE: WorldPoint = { mapId: KALIMDOR_MAP, x: 0, y: -3000 };
const instanceAtEntrance: SpawnPoint = { source: { kind: 'instance', areaId: areaId(718) }, world: ENTRANCE, uiMapId: uiMapId(1411) };
const instanceNowhere: SpawnPoint = { source: { kind: 'instance', areaId: areaId(209) }, world: null, uiMapId: null };
const unmapped: SpawnPoint = { source: { kind: 'unmapped', areaId: areaId(9999), x: 10, y: 20, reason: 'no-uimap' }, world: null, uiMapId: null };
// Stranglethorn Vale (1434) is not in the fixture geometry.
const noGeometry: SpawnPoint = { source: zoneSourcedPoint(uiMapId(1434), 30, 30), world: null, uiMapId: uiMapId(1434) };

const GORNEK_QUEST = questId(788);
const OTHER_QUEST = questId(790);

const gornek: PointGroupInput = {
  subject: { kind: 'npc', id: npcId(3143) },
  label: 'Gornek',
  questIds: [GORNEK_QUEST],
  spawns: [zoneSpawn(1411, 42.06, 68.33)],
};
const many: PointGroupInput = {
  subject: { kind: 'npc', id: npcId(100) },
  label: 'Many places',
  questIds: [OTHER_QUEST],
  spawns: [
    zoneSpawn(1411, 50, 50), // 0 Durotar
    zoneSpawn(1413, 50, 50), // 1 The Barrens
    zoneSpawn(1453, 50, 50), // 2 Stormwind City: another world map
    instanceAtEntrance, // 3 drawn at the entrance, with a badge
    instanceNowhere, // 4 unresolved
    unmapped, // 5 unresolved
    noGeometry, // 6 unresolved
    zoneSpawn(1411, 110, 50), // 7 off the Durotar frame (valid)
  ],
};
const givers: SpawnLayerInput = { groups: [gornek, many] };
const BARRENS_CENTRE = { x: -1765.625, y: -2443.75 };

// ---- route

const point = (x: number, y: number, mapId = 1, offFrame = false): StepPlacement => ({
  kind: 'point',
  world: { mapId: worldMapId(mapId), x, y },
  uiMapId: null,
  offFrame,
});
const NONE: StepPlacement = { kind: 'none' };
const UNKNOWN: StepPlacement = { kind: 'unknown', reason: 'destination-unknown' };
// Route inputs carry no position and no text (PERF-2): the `index` argument only documents the fixture.
const step = (id: string, _index: number, placement: StepPlacement, arrive: LegStyle = 'route', departs: LegStyle | null = null): RouteStepInput => ({
  stepId: stepId(id),
  placement,
  arrive,
  departs,
  questIds: [],
});

/**
 * s1-s3 walk on Kalimdor, s3 takes a flight to s4, s6 arrives by boat on the Eastern Kingdoms,
 * s8 goes somewhere unknown, s11 hearths without a location (its bind point is unknown, so it is
 * unplaced and leaves from s10) and s12 is placed after it.
 */
const ROUTE: RouteInput = {
  steps: [
    step('s1', 0, point(0, 0)),
    step('s2', 1, point(10, 0)),
    step('s3', 2, point(20, 0), 'route', 'flight'),
    step('s4', 3, point(100, 100)),
    step('s5', 4, NONE),
    step('s6', 5, point(50, 50, 0), 'transport'),
    step('s7', 6, point(60, 50, 0)),
    step('s8', 7, UNKNOWN),
    step('s9', 8, point(70, 50, 0)),
    step('s10', 9, point(80, 50, 0, true)),
    step('s11', 10, UNKNOWN, 'route', 'hearth'),
    step('s12', 11, point(0, 0, 0)),
  ],
};

// =============================================================================================

/** The four bands (`MAP_BANDS` in adapter.ts, whose values this module's tests may not import). */
const MAP_BANDS: readonly MapBand[] = ['world', 'continent', 'zone', 'close'];

describe('level of detail settings', () => {
  it('defaults to zone detail at -3.5 and a 2,500-path cap (M3 review PERF-3), with every band inside the cap', () => {
    expect(DEFAULT_LOD.zoneZoom).toBe(-3.5);
    expect(DEFAULT_LOD.pathCapPerSurface).toBe(2500);
    expect(lodProblems(DEFAULT_LOD)).toEqual([]);
    for (const band of MAP_BANDS) {
      const canvas = Object.entries(DEFAULT_LOD.budgets[band])
        .filter(([layer]) => layer !== 'art' && layer !== 'relief')
        .reduce((sum, [, budget]) => sum + budget, 0);
      expect(canvas, band).toBeLessThanOrEqual(DEFAULT_LOD.pathCapPerSurface);
    }
  });

  it('switches from continent to zone detail at zoneZoom', () => {
    expect(lodLevelAt(-3.5)).toBe('zone');
    expect(lodLevelAt(-2.4)).toBe('zone');
    expect(lodLevelAt(-3.51)).toBe('continent');
    expect(lodLevelAt(-5.2)).toBe('continent');
  });

  it('refuses budgets above the cap and malformed numbers', () => {
    expect(() => createLod({ budgets: { objectives: 10_000 } })).toThrow(/above the cap/);
    expect(() => createLod({ pathCapPerSurface: -1 })).toThrow(RangeError);
    expect(() => createLod({ budgets: { 'route-steps': 1.5 } })).toThrow(/non-negative integer/);
    expect(() => createLod({ zoneZoom: Number.NaN })).toThrow(/finite/);
    // art counts images, not canvas paths
    expect(createLod({ budgets: { art: 10_000 } }).budgets.zone.art).toBe(10_000);
    // One band over the cap is refused on its own, and named.
    expect(createLod({ bandBudgets: { close: { objectives: 1000 } } }).budgets.close.objectives).toBe(1000);
    expect(() => createLod({ bandBudgets: { close: { objectives: 1100 } } })).toThrow(/close band sum to 2600/);
    expect(() => createLod({ bandBudgets: { world: { objectives: 1100 } } })).toThrow(/world band/);
  });
});

describe('small helpers', () => {
  it('groups digits without the host locale', () => {
    expect(groupDigits(0)).toBe('0');
    expect(groupDigits(999)).toBe('999');
    expect(groupDigits(1234)).toBe('1,234');
    expect(groupDigits(1234567)).toBe('1,234,567');
    expect(groupDigits(-4500)).toBe('-4,500');
  });

  it('keys subjects', () => {
    expect(subjectKey({ kind: 'npc', id: npcId(3143) })).toBe('npc:3143');
    expect(subjectKey({ kind: 'object', id: objectId(1619) })).toBe('object:1619');
    expect(subjectKey({ kind: 'event', questId: questId(-2), objective: 3 })).toBe('event:-2:3');
  });

  it('compares plain data structurally', () => {
    expect(plainEqual({ a: [1, { b: 'x' }] }, { a: [1, { b: 'x' }] })).toBe(true);
    expect(plainEqual({ a: [1, 2] }, { a: [1, 2, 3] })).toBe(false);
    expect(plainEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(plainEqual([1], { 0: 1 })).toBe(false);
    expect(plainEqual(null, {})).toBe(false);
  });
});

describe('surfacesOf', () => {
  it('makes one surface per world map, continents from their frames and islands from their zones', () => {
    const surfaces = surfacesOf(geometry);
    expect(surfaces.map((surface) => surface.id)).toEqual(['world:0', 'world:1', 'world:2991']);
    const [ek, kalimdor, zephras] = surfaces;
    const ekRow = EASTERN_KINGDOMS.assignments[0];
    const kalimdorRow = KALIMDOR.assignments[0];
    if (ek === undefined || kalimdor === undefined || zephras === undefined || ekRow === undefined || kalimdorRow === undefined) throw new Error('fixture');
    expect(ek).toMatchObject({ name: 'Eastern Kingdoms', extentSource: 'continent', extentUiMapId: 1415 });
    expect(ek.extent).toEqual({ mapId: 0, xMin: ekRow.xMin, xMax: ekRow.xMax, yMin: ekRow.yMin, yMax: ekRow.yMax });
    expect(ek.uiMapIds).toEqual([1415, 1453]); // Azeroth 947 is two sub-rectangles, not a whole-map row
    expect(kalimdor).toMatchObject({ name: 'Kalimdor', extentSource: 'continent', extentUiMapId: 1414 });
    expect(kalimdor.extent.xMax).toBe(kalimdorRow.xMax);
    expect(kalimdor.uiMapIds).toEqual([1411, 1412, 1413, 1414, 1454, 1456]);
    // Zephras Isle 2521: 1247.9169921875..4956.25 x -1331.25..4231.25, plus 5% on every side.
    expect(zephras).toMatchObject({ name: 'Zephras Isle', extentSource: 'zone-union', extentUiMapId: null, uiMapIds: [2521] });
    expect(zephras.extent.xMin).toBeCloseTo(1247.9169921875 - 0.05 * (4956.25 - 1247.9169921875), 9);
    expect(zephras.extent.yMax).toBeCloseTo(4231.25 + 0.05 * (4231.25 + 1331.25), 9);
  });

  it('ignores root-level alternative continents (1463, 1464) when choosing the extent', () => {
    const alternative: UiMapGeometry = {
      ...KALIMDOR,
      uiMapId: uiMapId(1464),
      parent: uiMapId(0),
      assignments: KALIMDOR.assignments.map((row) => ({ ...row, id: 46775, xMin: -11870, xMax: 12470, yMin: -13370, yMax: 10970 })),
    };
    const withAlternative = createMapGeometry({
      kind: 'placeholder',
      product: 'wow_classic_beta',
      recordedFrameHash: null,
      maps: [...FIXTURE_MAPS, alternative],
      eraToForever: [],
    });
    const kalimdor = surfacesOf(withAlternative).find((surface) => surface.mapId === 1);
    expect(kalimdor?.extentUiMapId).toBe(1414);
    expect(kalimdor?.uiMapIds).toContain(1464);
  });

  it('falls back to the zone union when a map has no single continent', () => {
    const noContinent = createMapGeometry({ kind: 'placeholder', product: 'wow_classic_beta', recordedFrameHash: null, maps: [DUROTAR], eraToForever: [] });
    const [only] = surfacesOf(noContinent);
    expect(only).toMatchObject({ id: 'world:1', name: 'Durotar', extentSource: 'zone-union' });
  });
});

describe('placeStep and legOf', () => {
  const source = sequentialIdSource();
  const at = (point: Location['source']): Location => ({ source: point, label: null, radius: null });
  const gornekAt = at(zoneSourcedPoint(uiMapId(1411), 42.06, 68.33));

  it('places a resolvable location with its UiMap and the off-frame flag', () => {
    const placement = placeStep(makeAcceptStep(source, { questId: GORNEK_QUEST, location: gornekAt }), geometry);
    expect(placement.kind).toBe('point');
    if (placement.kind !== 'point') return;
    expect(placement.uiMapId).toBe(1411);
    expect(placement.offFrame).toBe(false);
    // Gornek (coordinates.md §7.1): world (-600.30, -4186.42) on Kalimdor.
    expect(placement.world.mapId).toBe(1);
    expect(placement.world.x).toBeCloseTo(-600.3, 1);
    expect(placement.world.y).toBeCloseTo(-4186.42, 1);
    const outside = placeStep(makeAcceptStep(source, { questId: GORNEK_QUEST, location: at(zoneSourcedPoint(uiMapId(1411), 110, 50)) }), geometry);
    expect(outside).toMatchObject({ kind: 'point', offFrame: true });
  });

  it('checks a world point against the UiMap it names', () => {
    const inside = placeStep(makeTravelStep(source, { location: at(worldSourcedPoint(KALIMDOR_MAP, -600, -4186, uiMapId(1411))) }), geometry);
    expect(inside).toMatchObject({ kind: 'point', uiMapId: 1411, offFrame: false });
    const outside = placeStep(makeTravelStep(source, { location: at(worldSourcedPoint(KALIMDOR_MAP, 5000, -4186, uiMapId(1411))) }), geometry);
    expect(outside).toMatchObject({ kind: 'point', offFrame: true });
    const noHint = placeStep(makeTravelStep(source, { location: at(worldSourcedPoint(worldMapId(36), 1, 2)) }), geometry);
    expect(noHint).toMatchObject({ kind: 'point', uiMapId: null, offFrame: false, world: { mapId: 36, x: 1, y: 2 } });
  });

  it('never guesses: an unresolvable location is unknown with its reason', () => {
    const lost = placeStep(makeAcceptStep(source, { questId: GORNEK_QUEST, location: at(zoneSourcedPoint(uiMapId(1434), 30, 30)) }), geometry);
    expect(lost).toEqual({ kind: 'unknown', reason: 'no-geometry' });
    const bad = placeStep(makeAcceptStep(source, { questId: GORNEK_QUEST, location: at(zoneSourcedPoint(uiMapId(1411), Number.NaN, 3)) }), geometry);
    expect(bad).toEqual({ kind: 'unknown', reason: 'non-finite' });
  });

  it('treats a travel step or a hearth without a location as going somewhere unknown, and other steps as staying', () => {
    expect(placeStep(makeTravelStep(source), geometry)).toEqual({ kind: 'unknown', reason: 'destination-unknown' });
    expect(placeStep(makeNoteStep(source, { text: 'note' }), geometry)).toEqual({ kind: 'none' });
    // The bind point is unknown until the simulation (M3 review MAP-HONEST-8).
    expect(placeStep(makeHearthStep(source), geometry)).toEqual({ kind: 'unknown', reason: 'destination-unknown' });
    expect(placeStep(makeHearthStep(source, { mode: 'bind' }), geometry)).toEqual({ kind: 'none' });
    expect(placeStep(makeFlightStep(source), geometry)).toEqual({ kind: 'none' });
    expect(placeStep(makeGrindStep(source, { until: { kind: 'duration', seconds: 60 } }), geometry)).toEqual({ kind: 'none' });
  });

  it('styles legs by how the character moves', () => {
    expect(legOf(makeTravelStep(source, { mode: 'transport' }))).toEqual({ arrive: 'transport', departs: null });
    expect(legOf(makeTravelStep(source, { mode: 'walk' }))).toEqual({ arrive: 'route', departs: null });
    expect(legOf(makeFlightStep(source, { mode: 'take' }))).toEqual({ arrive: 'route', departs: 'flight' });
    expect(legOf(makeFlightStep(source, { mode: 'discover' }))).toEqual({ arrive: 'route', departs: null });
    expect(legOf(makeHearthStep(source))).toEqual({ arrive: 'route', departs: 'hearth' });
    expect(legOf(makeHearthStep(source, { location: gornekAt }))).toEqual({ arrive: 'hearth', departs: null });
    expect(legOf(makeHearthStep(source, { mode: 'bind', location: gornekAt }))).toEqual({ arrive: 'route', departs: null });
    for (const plain of [
      makeAcceptStep(source, { questId: GORNEK_QUEST }),
      makeTurnInStep(source, { questId: GORNEK_QUEST }),
      makeCompleteStep(source, { targets: [{ questId: GORNEK_QUEST, objective: null }] }),
      makeTrainStep(source),
      makeVendorStep(source),
      makeNoteStep(source, { text: 'x' }),
    ]) {
      expect(legOf(plain)).toEqual({ arrive: 'route', departs: null });
    }
  });

  it('builds route input in route order with the caller’s quest ids, and no position or text', () => {
    const steps = [makeAcceptStep(source, { questId: GORNEK_QUEST, location: gornekAt }), makeTravelStep(source), makeHearthStep(source)];
    const input = routeInputOf(steps, geometry, (s) => (s.kind === 'accept' ? [s.questId] : []));
    expect(input.steps.map((s) => [s.stepId, s.placement.kind, s.arrive, s.departs])).toEqual([
      [steps[0]?.id, 'point', 'route', null],
      [steps[1]?.id, 'unknown', 'route', null],
      [steps[2]?.id, 'unknown', 'route', 'hearth'],
    ]);
    expect(input.steps[0]?.questIds).toEqual([788]);
    expect(Object.keys(input.steps[0] ?? {}).sort()).toEqual(['arrive', 'departs', 'placement', 'questIds', 'stepId']);
    // One step's input depends on that step alone.
    const first = steps[0];
    if (first === undefined) throw new Error('fixture');
    expect(routeStepInputOf(first, geometry, [GORNEK_QUEST])).toEqual(input.steps[0]);
    expect(routeInputOf(steps, geometry).steps[0]?.questIds).toEqual([]);
  });
});

describe('buildZoneFrames', () => {
  it('draws the extent, then zone frames largest first, with their names', () => {
    const content = buildZoneFrames(ctx, view(1));
    // The Barrens, Mulgore, Durotar, Orgrimmar, Thunder Bluff by area.
    expect(ids(content)).toEqual(['extent:1', 'frame:1413', 'frame:1412', 'frame:1411', 'frame:1454', 'frame:1456']);
    const durotar = byId(content, 'frame:1411');
    expect(durotar).toMatchObject({ type: 'frame', kind: 'zone', label: 'Durotar', emphasis: 'normal', ref: { kind: 'zone', uiMapId: 1411 } });
    expect(byId(content, 'extent:1')).toMatchObject({ kind: 'extent', label: null, ref: { kind: 'surface', mapId: 1 } });
    expect(content.stats).toMatchObject({ drawn: 6, notDrawn: 0, unresolved: 0 });
    expect(ids(buildZoneFrames(ctx, view(2991)))).toEqual(['extent:2991', 'frame:2521']);
    expect(ids(buildZoneFrames(ctx, view(0)))).toEqual(['extent:0', 'frame:1453']);
    expect(ids(buildZoneFrames(ctx, view(36)))).toEqual([]);
  });

  it('draws the focused zone strong and on top', () => {
    const content = buildZoneFrames(ctx, view(1), uiMapId(1411));
    expect(ids(content).at(-1)).toBe('frame:1411');
    expect(byId(content, 'frame:1411')).toMatchObject({ emphasis: 'strong' });
  });
});

describe('buildArt', () => {
  const art = [
    { uiMapId: uiMapId(1411), url: 'local-maps/art/1411.webp', opacity: 1 },
    { uiMapId: uiMapId(1414), url: 'local-maps/art/1414.webp', opacity: 2 },
    { uiMapId: uiMapId(2521), url: 'local-maps/art/2521.webp', opacity: 0.5 },
    { uiMapId: uiMapId(1434), url: 'local-maps/art/1434.webp', opacity: 1 },
  ];

  it('prefers the continent art on a continent surface and counts what it cannot place', () => {
    const content = buildArt(ctx, art, view(1));
    expect(ids(content)).toEqual(['art:1414']);
    expect(byId(content, 'art:1414')).toMatchObject({ type: 'art', url: 'local-maps/art/1414.webp', opacity: 1, label: 'Kalimdor' });
    expect(content.stats).toMatchObject({ otherSurfaces: 1, unresolved: 1, unresolvedBy: { 'no-geometry': 1 } });
    expect(ids(buildArt(ctx, art, view(2991)))).toEqual(['art:2521']);
  });

  it('draws zone art largest first when there is no continent art', () => {
    const zones = [
      { uiMapId: uiMapId(1411), url: 'a.webp', opacity: 1 },
      { uiMapId: uiMapId(1413), url: 'b.webp', opacity: 1 },
    ];
    expect(ids(buildArt(ctx, zones, view(1)))).toEqual(['art:1413', 'art:1411']);
  });
});

describe('buildSpawnLayer at zone zoom', () => {
  it('draws every point with a world position on this surface, raw, and counts the rest by reason', () => {
    const content = buildSpawnLayer(ctx, 'available-quests', givers, view(1));
    expect(ids(content)).toEqual(['spawn:npc:100:0', 'spawn:npc:100:1', 'spawn:npc:100:3', 'spawn:npc:100:7', 'spawn:npc:3143:0']);
    expect(content.stats).toEqual({
      drawn: 5,
      notDrawn: 0,
      aggregated: 0,
      unresolved: 3,
      unresolvedBy: { 'instance-without-entrance': 1, 'no-geometry': 1, 'unmapped-area': 1 },
      otherSurfaces: 1,
    });
    const marker = byId(content, 'spawn:npc:3143:0');
    expect(marker).toMatchObject({
      type: 'marker',
      kind: 'quest-start',
      style: 'neutral',
      emphasis: 'normal',
      label: 'Gornek',
      badges: [],
      ref: { kind: 'spawn', subject: { kind: 'npc', id: 3143 }, spawnIndex: 0, questIds: [788] },
      count: 1,
      labels: ['Gornek'],
    });
    expect((marker as MarkerDescriptor).refs).toEqual([(marker as MarkerDescriptor).ref]);
    expect(byId(content, 'spawn:npc:100:3')).toMatchObject({ badges: ['instance'], point: ENTRANCE });
    expect(byId(content, 'spawn:npc:100:7')).toMatchObject({ badges: ['off-frame'] });
  });

  it('uses the glyph of each spawn layer', () => {
    const kinds = (['available-quests', 'objectives', 'turn-ins', 'flight-masters'] as const).map(
      (layer) => (buildSpawnLayer(ctx, layer, { groups: [gornek] }, view(1)).items[0] as MarkerDescriptor).kind,
    );
    expect(kinds).toEqual(['quest-start', 'objective', 'quest-end', 'flight-master']);
  });

  it('draws the points of focused quests strong and above the rest', () => {
    const content = buildSpawnLayer(ctx, 'available-quests', givers, view(1), [OTHER_QUEST]);
    expect(ids(content)).toEqual(['spawn:npc:3143:0', 'spawn:npc:100:0', 'spawn:npc:100:1', 'spawn:npc:100:3', 'spawn:npc:100:7']);
    expect(markers(content).map((m) => m.emphasis)).toEqual(['normal', 'strong', 'strong', 'strong', 'strong']);
  });

  it('merges groups for the same subject and unites their quests', () => {
    const again: PointGroupInput = { ...gornek, label: 'Gornek again', questIds: [questId(2383), GORNEK_QUEST] };
    const content = buildSpawnLayer(ctx, 'turn-ins', { groups: [again, gornek] }, view(1));
    expect(ids(content)).toEqual(['spawn:npc:3143:0']);
    expect(byId(content, 'spawn:npc:3143:0')).toMatchObject({ label: 'Gornek again', ref: { questIds: [788, 2383] } });
  });

  it('does not depend on input order', () => {
    const forward = buildSpawnLayer(ctx, 'objectives', givers, view(1, ZONE_ZOOM, BARRENS_CENTRE));
    const backward = buildSpawnLayer(ctx, 'objectives', { groups: [many, gornek] }, view(1, ZONE_ZOOM, BARRENS_CENTRE));
    expect(backward).toEqual(forward);
  });
});

describe('buildSpawnLayer at continent zoom', () => {
  // Quest givers and turn-ins cluster below the zone band instead (map-presentation.md §25.2.5; clusters.test.ts).
  it('folds points into one aggregate per zone at their centroid', () => {
    const content = buildSpawnLayer(ctx, 'objectives', givers, view(1, CONTINENT_ZOOM));
    expect(ids(content)).toEqual(['agg:objectives:1411', 'agg:objectives:1413']);
    const durotar = byId(content, 'agg:objectives:1411') as AggregateDescriptor;
    expect(durotar).toMatchObject({ type: 'aggregate', layer: 'objectives', count: 4, subjects: 2, category: 'objectives' });
    expect(durotar.label).toBe('Durotar: 2 objective targets at 4 points; zoom in to see them');
    expect(durotar.ref).toEqual({ kind: 'aggregate', layer: 'objectives', mapId: 1, uiMapId: 1411, count: 4 });
    const points = [many.spawns[0], many.spawns[3], many.spawns[7], gornek.spawns[0]].map((spawn) => spawn?.world);
    const mean = (pick: (p: WorldPoint) => number): number => points.reduce((sum, p) => sum + (p === null || p === undefined ? 0 : pick(p)), 0) / 4;
    expect(durotar.point.x).toBeCloseTo(mean((p) => p.x), 9);
    expect(durotar.point.y).toBeCloseTo(mean((p) => p.y), 9);
    expect(content.stats).toMatchObject({ drawn: 2, aggregated: 5, unresolved: 3, otherSurfaces: 1 });
  });

  it('keeps the focused quest’s points raw at any zoom', () => {
    const content = buildSpawnLayer(ctx, 'objectives', givers, view(1, CONTINENT_ZOOM), [GORNEK_QUEST]);
    expect(ids(content)).toEqual(['agg:objectives:1411', 'agg:objectives:1413', 'spawn:npc:3143:0']);
    expect(byId(content, 'agg:objectives:1411')).toMatchObject({ count: 3, subjects: 1 });
    expect(byId(content, 'spawn:npc:3143:0')).toMatchObject({ emphasis: 'strong' });
  });

  it('never aggregates flight masters', () => {
    const content = buildSpawnLayer(ctx, 'flight-masters', givers, view(1, CONTINENT_ZOOM));
    expect(content.items.every((item) => item.type === 'marker')).toBe(true);
    expect(content.stats.aggregated).toBe(0);
  });

  it('groups points without a UiMap under their world map', () => {
    const loose: PointGroupInput = {
      subject: { kind: 'event', questId: questId(-5), objective: 0 },
      label: 'Somewhere',
      questIds: [questId(-5)],
      spawns: [{ source: worldSourcedPoint(KALIMDOR_MAP, 1, 2), world: { mapId: KALIMDOR_MAP, x: 1, y: 2 }, uiMapId: null }],
    };
    const content = buildSpawnLayer(ctx, 'objectives', { groups: [loose] }, view(1, CONTINENT_ZOOM));
    expect(ids(content)).toEqual(['agg:objectives:map-1']);
    expect(byId(content, 'agg:objectives:map-1')).toMatchObject({ label: 'No zone: 1 objective target at 1 point; zoom in to see them' });
  });
});

describe('the path cap', () => {
  const small = layerContextOf(geometry, createLod({ budgets: { 'available-quests': 2 } }));

  it('keeps the items nearest the viewport centre and says how many were left out', () => {
    const content = buildSpawnLayer(small, 'available-quests', givers, view(1, ZONE_ZOOM, BARRENS_CENTRE));
    // The Barrens point itself, then the entrance (3.4e6 yd² away) beats Gornek (4.4e6).
    expect(ids(content)).toEqual(['spawn:npc:100:1', 'spawn:npc:100:3']);
    expect(content.stats).toMatchObject({ drawn: 2, notDrawn: 3 });
  });

  it('keeps focused items first, then the nearest, and still draws them in layer order', () => {
    const content = buildSpawnLayer(small, 'available-quests', givers, view(1, ZONE_ZOOM, BARRENS_CENTRE), [GORNEK_QUEST]);
    expect(ids(content)).toEqual(['spawn:npc:100:1', 'spawn:npc:3143:0']);
  });

  it('ranks by id without a centre (and ignores a non-finite one)', () => {
    const expected = ['spawn:npc:100:0', 'spawn:npc:100:1'];
    expect(ids(buildSpawnLayer(small, 'available-quests', givers, view(1)))).toEqual(expected);
    expect(ids(buildSpawnLayer(small, 'available-quests', givers, view(1, ZONE_ZOOM, { x: Number.NaN, y: 0 })))).toEqual(expected);
  });

  it('draws nothing with a zero budget, honestly', () => {
    const none = layerContextOf(geometry, createLod({ budgets: { 'available-quests': 0 } }));
    expect(buildSpawnLayer(none, 'available-quests', givers, view(1)).stats).toMatchObject({ drawn: 0, notDrawn: 5 });
  });

  it('breaks ties at the cut by id, as a full sort by distance then id would', () => {
    const at = (x: number, y: number): SpawnPoint => ({ source: worldSourcedPoint(KALIMDOR_MAP, x, y), world: { mapId: KALIMDOR_MAP, x, y }, uiMapId: uiMapId(1411) });
    // Four points 10 yd from the centre (a tie), one nearer and one further.
    const ring: PointGroupInput = { subject: { kind: 'npc', id: npcId(7) }, label: 'Ring', questIds: [], spawns: [at(10, 0), at(0, -10), at(-10, 0), at(0, 10), at(1, 1), at(50, 50)] };
    const three = layerContextOf(geometry, createLod({ budgets: { 'available-quests': 3 } }));
    const content = buildSpawnLayer(three, 'available-quests', { groups: [ring] }, view(1, ZONE_ZOOM, { x: 0, y: 0 }));
    // The nearest (index 4), then the two tied points with the smallest ids, in draw order.
    expect(ids(content)).toEqual(['spawn:npc:7:0', 'spawn:npc:7:1', 'spawn:npc:7:4']);
    expect(content.stats).toMatchObject({ drawn: 3, notDrawn: 3 });
  });
});

describe('buildRouteLine', () => {
  it('splits the route into (world map, style) runs', () => {
    const kalimdor = buildRouteLine(ctx, ROUTE, view(1));
    expect(ids(kalimdor)).toEqual(['run:1:route:s1', 'run:1:flight:s3', 'transition:out:s4']);
    const [walk, flight] = lines(kalimdor);
    // No step numbers in the label: the adapter's label provider adds them (M3 review PERF-2).
    expect(walk).toMatchObject({ style: 'route', label: 'Route', ref: { kind: 'run', style: 'route', stepIds: ['s1', 's2', 's3'] } });
    expect(walk?.points.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [10, 0],
      [20, 0],
    ]);
    // The flight starts at the flight master (s3) and ends at the next placed step.
    expect(flight).toMatchObject({ style: 'flight', label: 'Flight', ref: { stepIds: ['s3', 's4'] } });
    // Two lines, a transition glyph and a departure glyph are on the Eastern Kingdoms.
    expect(kalimdor.stats).toMatchObject({ drawn: 3, otherSurfaces: 4, unresolved: 2, unresolvedBy: { 'destination-unknown': 2 } });
  });

  it('ends a run at a world-map change, with a transition glyph at both ends', () => {
    const departure = byId(buildRouteLine(ctx, ROUTE, view(1)), 'transition:out:s4');
    expect(departure).toMatchObject({
      type: 'marker',
      kind: 'transition',
      label: 'Transport to Eastern Kingdoms',
      point: { mapId: 1, x: 100, y: 100 },
      ref: { kind: 'transition', end: 'departure', fromStepId: 's4', toStepId: 's6', fromMapId: 1, toMapId: 0, leg: 'transport' },
    });
    const ek = buildRouteLine(ctx, ROUTE, view(0));
    expect(ids(ek)).toEqual(['run:0:route:s6', 'run:0:route:s9', 'transition:in:s6', 'departure:s11']);
    expect(byId(ek, 'transition:in:s6')).toMatchObject({ label: 'Transport from Kalimdor', ref: { end: 'arrival' } });
    // No line crosses world maps, and the unknown steps s8 and s11 break the line.
    expect(lines(ek).map((line) => line.ref)).toEqual([
      { kind: 'run', style: 'route', stepIds: ['s6', 's7'] },
      { kind: 'run', style: 'route', stepIds: ['s9', 's10'] },
    ]);
  });

  it('ends the line at a hearth without a location, with a departure glyph, rather than drawing a teleport (M3 review MAP-HONEST-8)', () => {
    const ek = buildRouteLine(ctx, ROUTE, view(0));
    expect(byId(ek, 'departure:s11')).toMatchObject({
      type: 'marker',
      kind: 'transition',
      point: { mapId: 0, x: 80, y: 50 },
      label: 'Hearthstone (destination unknown until simulation)',
      ref: { kind: 'departure', stepId: 's11', leg: 'hearth' },
    });
    // No hearth line to s12, and s12's leg is unknown.
    expect(lines(ek).some((line) => line.style === 'hearth')).toBe(false);
    expect(byId(buildRouteSteps(ctx, ROUTE, view(0)), 'step:s12')).toMatchObject({ badges: ['leg-unknown'] });
    // A hearth with nothing placed before it leaves from nowhere known: no glyph.
    const first: RouteInput = { steps: [step('h', 0, UNKNOWN, 'route', 'hearth'), step('a', 1, point(1, 1))] };
    expect(ids(buildRouteLine(ctx, first, view(1)))).toEqual([]);
  });

  it('cuts a long run into pieces of at most 256 vertices that share their ends', () => {
    const long: RouteInput = { steps: Array.from({ length: 700 }, (_, i) => step(`p${String(i)}`, i, point(i, 0))) };
    const content = buildRouteLine(ctx, long, view(1));
    const pieces = lines(content);
    expect(pieces.length).toBeGreaterThan(2);
    for (const piece of pieces) {
      expect(piece.points.length).toBeGreaterThanOrEqual(2);
      expect(piece.points.length).toBeLessThanOrEqual(ROUTE_PIECE_MAX_VERTICES);
      expect(piece.ref).toMatchObject({ kind: 'run', style: 'route' });
      expect(piece.id).toBe(`run:1:route:${piece.ref.kind === 'run' ? (piece.ref.stepIds[0] ?? '') : ''}`);
    }
    pieces.slice(1).forEach((piece, i) => {
      expect(piece.points[0]).toBe(pieces[i]?.points.at(-1));
    });
    // Every vertex is drawn once, plus one shared vertex per boundary.
    expect(pieces.reduce((sum, piece) => sum + piece.points.length, 0)).toBe(700 + pieces.length - 1);
  });
});

describe('routePieces', () => {
  const idsOf = (n: number, prefix = 'id'): readonly string[] => Array.from({ length: n }, (_, i) => `${prefix}${String(i)}`);

  it('keeps a short run whole and never leaves a one-vertex piece', () => {
    expect(routePieces(['a', 'b'])).toEqual([[0, 1]]);
    expect(routePieces(['a'])).toEqual([]);
    expect(routePieces(idsOf(ROUTE_PIECE_MIN_VERTICES))).toEqual([[0, ROUTE_PIECE_MIN_VERTICES - 1]]);
    for (const [first, last] of routePieces(idsOf(1000))) expect(last - first + 1).toBeGreaterThanOrEqual(2);
  });

  it('cuts at content-defined boundaries, between the minimum and the maximum length', () => {
    const pieces = routePieces(idsOf(5000));
    expect(pieces[0]?.[0]).toBe(0);
    expect(pieces.at(-1)?.[1]).toBe(4999);
    pieces.forEach(([first, last], i) => {
      if (i > 0) expect(first).toBe(pieces[i - 1]?.[1]);
      const length = last - first + 1;
      expect(length).toBeLessThanOrEqual(ROUTE_PIECE_MAX_VERTICES);
      if (i < pieces.length - 1) expect(length).toBeGreaterThanOrEqual(ROUTE_PIECE_MIN_VERTICES);
    });
    // On average about 128 vertices a piece.
    expect(pieces.length).toBeGreaterThan(5000 / ROUTE_PIECE_MAX_VERTICES);
    expect(pieces.length).toBeLessThan(5000 / ROUTE_PIECE_MIN_VERTICES);
  });

  it('moves only the boundaries next to an insert, so the other pieces keep their first step', () => {
    const before = idsOf(3000);
    const after = [...before.slice(0, 10), 'inserted', ...before.slice(10)];
    const firsts = (ids: readonly string[]): readonly string[] => routePieces(ids).map(([first]) => ids[first] ?? '');
    const old = firsts(before);
    const now = firsts(after);
    const lost = old.filter((id) => !now.includes(id));
    expect(lost.length).toBeLessThanOrEqual(1);
    expect(now.filter((id) => !old.includes(id)).length).toBeLessThanOrEqual(1);
  });

  it('draws no line for a lone point', () => {
    const lone: RouteInput = { steps: [step('a', 0, point(1, 1)), step('b', 1, UNKNOWN), step('c', 2, point(5, 5))] };
    expect(buildRouteLine(ctx, lone, view(1)).items).toEqual([]);
  });

  it('keeps run ids unique when a step id repeats', () => {
    const repeated: RouteInput = {
      steps: [step('x', 0, point(0, 0)), step('y', 1, point(1, 0)), step('z', 2, UNKNOWN), step('x', 3, point(2, 0)), step('y', 4, point(3, 0))],
    };
    expect(ids(buildRouteLine(ctx, repeated, view(1)))).toEqual(['run:1:route:x', 'run:1:route:x~2']);
  });

  it('draws the proposal in one style, split only by world map', () => {
    const proposal = buildProposal(ctx, ROUTE, view(1));
    expect(proposal.layer).toBe('proposal');
    expect(ids(proposal)).toEqual(['run:1:proposal:s1', 'transition:out:s4']);
    expect(lines(proposal)[0]?.ref).toEqual({ kind: 'run', style: 'proposal', stepIds: ['s1', 's2', 's3', 's4'] });
    expect(byId(proposal, 'transition:out:s4')).toMatchObject({ style: 'proposal', label: 'Proposed route to Eastern Kingdoms' });
    expect(buildProposal(ctx, null, view(1)).items).toEqual([]);
  });
});

describe('buildRouteSteps', () => {
  it('marks every placed step on this surface and flags unknown legs and off-frame points', () => {
    const content = buildRouteSteps(ctx, ROUTE, view(0));
    expect(ids(content)).toEqual(['step:s6', 'step:s7', 'step:s9', 'step:s10', 'step:s12']);
    expect(byId(content, 'step:s9')).toMatchObject({ badges: ['leg-unknown'] });
    expect(byId(content, 'step:s10')).toMatchObject({ badges: ['off-frame'] });
    // The label is a label key (the step id): no position, which an insert above would change.
    expect(byId(content, 'step:s6')).toEqual({
      type: 'marker',
      id: 'step:s6',
      point: { mapId: 0, x: 50, y: 50 },
      kind: 'step',
      style: 'accent',
      emphasis: 'normal',
      label: 's6',
      badges: [],
      ref: { kind: 'step', stepId: 's6' },
      count: 1,
      refs: [{ kind: 'step', stepId: 's6' }],
      labels: ['s6'],
    });
    expect(content.stats).toMatchObject({ drawn: 5, otherSurfaces: 4, unresolved: 2 });
  });

  it('merges steps at the identical point into one marker with every ref (M3 review MAP-UX-3)', () => {
    const gornekStack: RouteInput = {
      steps: [
        step('a', 0, point(5, 5)),
        step('b', 1, point(0, 0)),
        step('c', 2, point(5, 5, 1, true)),
        step('d', 3, point(9, 9)),
        step('e', 4, point(5, 5)),
      ],
    };
    const content = buildRouteSteps(ctx, gornekStack, view(1));
    // The stack takes its last item's place (later steps on top) and its first item's id.
    expect(ids(content)).toEqual(['step:b', 'step:d', 'step:a']);
    expect(byId(content, 'step:a')).toMatchObject({
      count: 3,
      label: 'a',
      labels: ['a', 'c', 'e'],
      refs: [
        { kind: 'step', stepId: 'a' },
        { kind: 'step', stepId: 'c' },
        { kind: 'step', stepId: 'e' },
      ],
      badges: ['off-frame'],
    });
    expect(content.stats.drawn).toBe(3);
    // Focused members are drawn by the selection layer: a halo and a strong marker per stack.
    const halos = buildSelection(ctx, gornekStack, view(1), { selected: [stepId('a'), stepId('e')], hovered: null, active: null });
    expect(ids(halos)).toEqual(['halo:a', 'focus:a']);
    expect(byId(halos, 'halo:a')).toMatchObject({ count: 2, labels: ['a', 'e'] });
    expect(byId(halos, 'focus:a')).toMatchObject({ kind: 'step', emphasis: 'strong', count: 2, labels: ['a', 'e'], badges: [] });
  });

  it('does not see the focus: every marker is normal, in route order (M3 review PERF-2)', () => {
    const content = buildRouteSteps(ctx, ROUTE, view(0));
    expect(ids(content)).toEqual(['step:s6', 'step:s7', 'step:s9', 'step:s10', 'step:s12']);
    expect(markers(content).every((m) => m.emphasis === 'normal')).toBe(true);
    // A selection change leaves the memoised layer's content as it was.
    const layers = createMapLayers({ geometry });
    const before = layers.routeSteps(ROUTE, view(0));
    layers.selection(ROUTE, view(0), { selected: [stepId('s7')], hovered: stepId('s10'), active: stepId('s7') });
    expect(layers.routeSteps(ROUTE, view(0))).toBe(before);
  });

  it('builds the same markers from its caches as the stateless builder, stacks included', () => {
    const layers = createMapLayers({ geometry });
    const stacked: RouteInput = {
      steps: [step('a', 0, point(5, 5)), step('b', 1, point(0, 0)), step('c', 2, point(5, 5)), step('d', 3, UNKNOWN), step('e', 4, point(0, 0)), step('f', 5, point(7, 7))],
    };
    const first = layers.routeSteps(stacked, view(1));
    expect(first.items).toEqual(buildRouteSteps(ctx, stacked, view(1)).items);
    // Moving `f` above `a` rebuilds in route order; unchanged stacks keep their objects.
    const moved: RouteInput = { steps: [stacked.steps[5]!, ...stacked.steps.slice(0, 5)] };
    const after = layers.routeSteps(moved, view(1));
    expect(after.items).toEqual(buildRouteSteps(ctx, moved, view(1)).items);
    expect(ids(after)).toEqual(['step:f', 'step:a', 'step:b']);
    expect(byId(after, 'step:a')).toBe(byId(first, 'step:a'));
    expect(byId(after, 'step:b')).toMatchObject({ count: 2, badges: ['leg-unknown'] });
  });

  it('keeps marker ids unique when a step id repeats', () => {
    const repeated: RouteInput = { steps: [step('x', 0, point(0, 0)), step('x', 1, point(1, 0))] };
    expect(ids(buildRouteSteps(ctx, repeated, view(1)))).toEqual(['step:x', 'step:x~2']);
  });
});

describe('buildSelection', () => {
  const focus = (active: string | null, selected: readonly string[] = []) => ({
    selected: selected.map(stepId),
    hovered: null,
    active: active === null ? null : stepId(active),
  });

  it('draws the leg into the active step, then a halo and a strong marker for each focused step', () => {
    const content = buildSelection(ctx, ROUTE, view(0), focus('s10', ['s7']));
    expect(ids(content)).toEqual(['leg:s10', 'halo:s7', 'halo:s10', 'focus:s7', 'focus:s10']);
    expect(byId(content, 'focus:s10')).toMatchObject({ kind: 'step', style: 'accent', emphasis: 'strong', badges: ['off-frame'], ref: { kind: 'step', stepId: 's10' } });
    expect(byId(content, 'leg:s10')).toMatchObject({
      type: 'polyline',
      style: 'highlight',
      emphasis: 'strong',
      ref: { kind: 'leg', fromStepId: 's9', toStepId: 's10' },
      points: [
        { mapId: 0, x: 70, y: 50 },
        { mapId: 0, x: 80, y: 50 },
      ],
    });
    expect(byId(content, 'halo:s7')).toMatchObject({ kind: 'halo', emphasis: 'strong' });
  });

  it('skips steps without a place but draws no leg across an unknown step or a world-map change', () => {
    const skip: RouteInput = { steps: [step('a', 0, point(0, 0)), step('b', 1, NONE), step('c', 2, point(5, 0))] };
    expect(ids(buildSelection(ctx, skip, view(1), focus('c')))).toEqual(['leg:c', 'halo:c', 'focus:c']);
    expect(byId(buildSelection(ctx, skip, view(1), focus('c')), 'leg:c')).toMatchObject({ label: 'Selected leg', ref: { fromStepId: 'a' } });
    expect(ids(buildSelection(ctx, ROUTE, view(0), focus('s12')))).toEqual(['halo:s12', 'focus:s12']);
    expect(byId(buildSelection(ctx, ROUTE, view(0), focus('s12')), 'focus:s12')).toMatchObject({ badges: ['leg-unknown'] });
    expect(ids(buildSelection(ctx, ROUTE, view(0), focus('s9')))).toEqual(['halo:s9', 'focus:s9']);
    expect(ids(buildSelection(ctx, ROUTE, view(0), focus('s6')))).toEqual(['halo:s6', 'focus:s6']);
  });

  it('keeps the active step first when the cap bites', () => {
    const many: RouteInput = { steps: Array.from({ length: 80 }, (_, i) => step(`m${String(i)}`, i, point(i * 10, 0))) };
    const tight = layerContextOf(geometry, createLod({ budgets: { selection: 4 } }));
    const all = many.steps.map((s) => String(s.stepId));
    const content = buildSelection(tight, many, view(1, -2, { x: 0, y: 0 }), focus('m79', all));
    expect(ids(content)).toContain('focus:m79');
    expect(ids(content)).toContain('halo:m79');
    expect(ids(content)).toContain('leg:m79');
    expect(content.stats.notDrawn).toBe(80 * 2 + 1 - 4);
  });

  it('counts selected steps that cannot be drawn here', () => {
    const content = buildSelection(ctx, ROUTE, view(0), focus(null, ['s1', 's8', 's5']));
    expect(content.items).toEqual([]);
    expect(content.stats).toMatchObject({ otherSurfaces: 1, unresolved: 1 });
  });
});

describe('createMapLayers (memoised per layer)', () => {
  const inputs = (groups: readonly PointGroupInput[]): SpawnLayerInput => ({ groups });

  it('returns the same content object while a layer’s own inputs are unchanged', () => {
    const layers = createMapLayers({ geometry });
    const first = layers.spawns('available-quests', givers, view(1, ZONE_ZOOM, BARRENS_CENTRE), [GORNEK_QUEST]);
    // A pan under the cap, a zoom within zone detail, and an equal focus in a new array change nothing.
    expect(layers.spawns('available-quests', givers, view(1, -1.25, { x: 99, y: 99 }), [GORNEK_QUEST])).toBe(first);
    expect(layers.spawns('available-quests', givers, view(1, ZONE_ZOOM, null), [questId(788)])).toBe(first);
    // Rebuilding from an equal input keeps the content (every descriptor is interned).
    expect(layers.spawns('available-quests', inputs([many, gornek]), view(1), [GORNEK_QUEST])).toBe(first);
  });

  it('recomputes when the level of detail, the surface or the focus changes', () => {
    const layers = createMapLayers({ geometry });
    const zone = layers.spawns('objectives', givers, view(1));
    const continent = layers.spawns('objectives', givers, view(1, CONTINENT_ZOOM));
    expect(continent).not.toBe(zone);
    expect(continent.items[0]?.type).toBe('aggregate');
    const focused = layers.spawns('objectives', givers, view(1, CONTINENT_ZOOM), [GORNEK_QUEST]);
    expect(focused).not.toBe(continent);
    // On the Eastern Kingdoms only the Stormwind City point is drawn.
    expect(ids(layers.spawns('objectives', givers, view(0)))).toEqual(['spawn:npc:100:2']);
  });
  it('keys a spawn layer on the groups a focus holds, not its quests: a focus on none of its groups changes nothing (D-050 item 5)', () => {
    const layers = createMapLayers({ geometry });
    const plain = layers.spawns('available-quests', givers, view(1));
    // A quest no giver of this layer offers: the same content object, nothing collected again.
    expect(layers.spawns('available-quests', givers, view(1), [questId(99999)])).toBe(plain);
    const focused = layers.spawns('available-quests', givers, view(1), [GORNEK_QUEST]);
    expect(focused).not.toBe(plain);
    // Only the focused group's markers change, to strong: every other descriptor is the same object.
    const changed = focused.items.filter((item) => !plain.items.includes(item));
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((item) => item.type === 'marker' && item.emphasis === 'strong')).toBe(true);
    expect(focused.items.length).toBe(plain.items.length);
    // And back: the plain markers again, as they were.
    expect(layers.spawns('available-quests', givers, view(1)).items).toEqual(plain.items);
  });

  it('keeps unchanged descriptors (and the items array) when only stats change', () => {
    const layers = createMapLayers({ geometry });
    const before = layers.spawns('turn-ins', givers, view(1));
    const extra: PointGroupInput = { subject: { kind: 'npc', id: npcId(5) }, label: 'Elsewhere', questIds: [], spawns: [zoneSpawn(1453, 1, 1)] };
    const after = layers.spawns('turn-ins', inputs([gornek, many, extra]), view(1));
    expect(after).not.toBe(before);
    expect(after.items).toBe(before.items);
    expect(after.stats.otherSurfaces).toBe(2);
  });

  it('re-ranks only while the cap bites', () => {
    const layers = createMapLayers({ geometry, lod: { budgets: { 'available-quests': 2 } } });
    const near = layers.spawns('available-quests', givers, view(1, ZONE_ZOOM, BARRENS_CENTRE));
    const far = layers.spawns('available-quests', givers, view(1, ZONE_ZOOM, { x: 45.8, y: -7778 }));
    expect(far).not.toBe(near);
    expect(ids(far)).toEqual(['spawn:npc:100:0', 'spawn:npc:100:7']);
  });

  it('keeps every step marker when a step is inserted above them: no step numbers in descriptors (M3 review PERF-2)', () => {
    const layers = createMapLayers({ geometry });
        const route: RouteInput = { steps: Array.from({ length: 600 }, (_, i) => step(`q${String(i)}`, i, point(i, i % 7))) };
    const markersBefore = layers.routeSteps(route, view(1));
    const lineBefore = layers.routeLine(route, view(1));
    const inserted: RouteInput = { steps: [step('top', 0, NONE), ...route.steps.slice(0, 3), step('new', 4, point(2.5, 9)), ...route.steps.slice(3)] };
    const markersAfter = layers.routeSteps(inserted, view(1));
    const kept = markersAfter.items.filter((item) => markersBefore.items.includes(item));
    // Only the new step's marker is new; every other marker is the same object.
    expect(markersAfter.items.length).toBe(markersBefore.items.length + 1);
    expect(kept.length).toBe(markersBefore.items.length);
    const lineAfter = layers.routeLine(inserted, view(1));
    const changedPieces = lineAfter.items.filter((item) => !lineBefore.items.includes(item));
    expect(lineBefore.items.length).toBeGreaterThan(2);
    expect(changedPieces.length).toBeLessThanOrEqual(2);
  });

  it('draws the zone the user jumped to raw at any zoom, and only while the layer aggregates', () => {
    const layers = createMapLayers({ geometry });
    const continent = layers.spawns('objectives', givers, view(1, CONTINENT_ZOOM));
    const jumped = layers.spawns('objectives', givers, view(1, CONTINENT_ZOOM), [], uiMapId(1411));
    expect(jumped).not.toBe(continent);
    expect(ids(jumped)).toEqual(['agg:objectives:1413', 'spawn:npc:100:0', 'spawn:npc:100:3', 'spawn:npc:100:7', 'spawn:npc:3143:0']);
    expect(markers(jumped).every((m) => m.emphasis === 'normal')).toBe(true);
    expect(jumped.stats).toMatchObject({ aggregated: 1 });
    expect(buildSpawnLayer(ctx, 'objectives', givers, view(1, CONTINENT_ZOOM), [], uiMapId(1411))).toEqual(jumped);
    // At zone zoom the raw zone changes nothing.
    const zone = layers.spawns('objectives', givers, view(1));
    expect(layers.spawns('objectives', givers, view(1), [], uiMapId(1411))).toBe(zone);
  });

  it('ranks from a snapped centre under the cap, and keeps what it draws while it stays in view (M3 review PERF-7)', () => {
    expect(rankingCenter(view(1, -2, { x: 100, y: -300 }))).toEqual({ x: 0, y: 0, grid: 4 * RANK_GRID_PX });
    expect(rankingCenter(view(1, -2, null))).toBeNull();
    const grid = 4 * RANK_GRID_PX;
    const bounds = (cx: number, cy: number) => ({ mapId: KALIMDOR_MAP, xMin: cx - 2000, xMax: cx + 2000, yMin: cy - 3000, yMax: cy + 3000 });
    const at = (x: number, y: number): MapView => ({ mapId: KALIMDOR_MAP, zoom: -2, center: { x, y }, bounds: bounds(x, y) });
    const layers = createMapLayers({ geometry, lod: { budgets: { 'available-quests': 2 } } });
    const first = layers.spawns('available-quests', givers, at(BARRENS_CENTRE.x, BARRENS_CENTRE.y));
    // A pan inside one grid cell ranks nothing again.
    expect(layers.spawns('available-quests', givers, at(BARRENS_CENTRE.x + 50, BARRENS_CENTRE.y - 50))).toBe(first);
    // A pan to the next cells re-ranks, but items already drawn and still in view stay.
    const panned = layers.spawns('available-quests', givers, at(BARRENS_CENTRE.x + grid, BARRENS_CENTRE.y - 1.5 * grid));
    expect(ids(panned)).toEqual(ids(first));
    // Without the hold (no view rectangle), that pan would have swapped both markers out.
    const fresh = createMapLayers({ geometry, lod: { budgets: { 'available-quests': 2 } } });
    const unheld = fresh.spawns('available-quests', givers, { ...at(BARRENS_CENTRE.x + grid, BARRENS_CENTRE.y - 1.5 * grid), bounds: null });
    expect(ids(unheld).filter((id) => ids(first).includes(id))).toEqual([]);
    // The stateless builder ranks from the exact centre alone.
    expect(ids(buildSpawnLayer(layerContextOf(geometry, createLod({ budgets: { 'available-quests': 2 } })), 'available-quests', givers, view(1, -2, BARRENS_CENTRE)))).toEqual(
      ids(first),
    );
  });

  it('touches only what a route edit changed', () => {
    const layers = createMapLayers({ geometry });
        const before = layers.routeSteps(ROUTE, view(0));
    const moved = ROUTE.steps.map((s) => (s.stepId === 's7' ? { ...s, placement: point(61, 50, 0) } : s));
    const after = layers.routeSteps({ steps: moved }, view(0));
    expect(after.items).not.toBe(before.items);
    const changed = after.items.filter((item, i) => item !== before.items[i]).map((item) => item.id);
    expect(changed).toEqual(['step:s7']);
    // The Kalimdor line does not change at all when an Eastern Kingdoms step moves.
    const kalimdor = layers.routeLine(ROUTE, view(1));
    expect(layers.routeLine({ steps: moved }, view(1))).toBe(kalimdor);
    // Spawn layers never see the route.
    const spawns = layers.spawns('available-quests', givers, view(0));
    layers.routeLine({ steps: moved }, view(0));
    expect(layers.spawns('available-quests', givers, view(0))).toBe(spawns);
  });

  it('memoises frames, art, selection and proposal too', () => {
    const layers = createMapLayers({ geometry });
    const frames = layers.zoneFrames(view(1));
    expect(layers.zoneFrames(view(1, -5, { x: 1, y: 1 }))).toBe(frames);
    expect(layers.zoneFrames(view(1), uiMapId(1411))).not.toBe(frames);
    const art: readonly { readonly uiMapId: ReturnType<typeof uiMapId>; readonly url: string; readonly opacity: number }[] = [];
    const artContent = layers.art(art, view(1));
    expect(layers.art(art, view(1))).toBe(artContent);
    const focus = { selected: [stepId('s7')], hovered: null, active: stepId('s7') };
    const selection = layers.selection(ROUTE, view(0), focus);
    expect(layers.selection(ROUTE, view(0), { ...focus, selected: [stepId('s7'), stepId('s7')] })).toBe(selection);
    expect(layers.proposal(null, view(0))).toBe(layers.proposal(null, view(0)));
    expect(layers.surfaces.map((s) => s.id)).toEqual(['world:0', 'world:1', 'world:2991']);
    expect(layers.lodLevel(-4)).toBe('continent');
  });
});

describe('the route line’s stats', () => {
  it('counts the route line on other world maps by line, not by piece', () => {
    const long: RouteInput = { steps: Array.from({ length: 600 }, (_, i) => step(`r${String(i)}`, i, point(i, 0, 0))) };
    const content = buildRouteLine(ctx, long, view(1));
    expect(content.items).toEqual([]);
    expect(content.stats.otherSurfaces).toBe(1);
  });
});

describe('determinism', () => {
  it('gives identical output for identical inputs across builders', () => {
    const quests: readonly QuestId[] = [GORNEK_QUEST];
    for (let i = 0; i < 3; i += 1) {
      const layers = createMapLayers({ geometry });
      expect(layers.spawns('available-quests', givers, view(1, CONTINENT_ZOOM), quests)).toEqual(
        buildSpawnLayer(ctx, 'available-quests', givers, view(1, CONTINENT_ZOOM), quests),
      );
      expect(layers.routeLine(ROUTE, view(0))).toEqual(buildRouteLine(ctx, ROUTE, view(0)));
    }
  });
});

describe('terrain and art layers (D-032, D-033)', () => {
  /*
   * The terrain and art layers (D-032, D-033; terrain-navigation.md §13.2): the relief image, the
   * committed art placed by its manifest's rectangle, zone outlines and the coastline as one path
   * each, frames without their fill over art, and the aggregate rule for points published on the
   * world map (STATUS: the quest-giver aggregate drawn for Azeroth 947).
   */

  const geometry = fixtureGeometry();
  const ctx = layerContextOf(geometry);
  const KALIMDOR = worldMapId(1);
  const EK = worldMapId(0);
  const view = (mapId: number, zoom = -2): MapView => ({ mapId: worldMapId(mapId), zoom, center: null });
  const ids = (content: LayerContent): readonly string[] => content.items.map((item) => item.id);

  const RELIEF: readonly ReliefInput[] = [
    { mapId: EK, url: 'maps/terrain/0/relief.png', bounds: { mapId: EK, xMin: -16000, xMax: 6400, yMin: -7466.7, yMax: 4800 } },
    { mapId: KALIMDOR, url: 'maps/terrain/1/relief.png', bounds: { mapId: KALIMDOR, xMin: -12800, xMax: 17066.7, yMin: -9066.7, yMax: 17066.7 } },
  ];

  const wp = (mapId: number, x: number, y: number): WorldPoint => ({ mapId: worldMapId(mapId), x, y });

  describe('buildRelief', () => {
    it('draws the view’s world map’s relief under everything: a backdrop, or faint under painted art', () => {
      const content = buildRelief(ctx, RELIEF, view(1));
      expect(ids(content)).toEqual(['relief:1']);
      expect(content.items[0]).toEqual({
        type: 'art',
        id: 'relief:1',
        bounds: { mapId: 1, xMin: -12800, xMax: 17066.7, yMin: -9066.7, yMax: 17066.7 },
        url: 'maps/terrain/1/relief.png',
        opacity: RELIEF_OPACITY.backdrop,
        label: 'Shaded relief',
        ref: { kind: 'terrain', layer: 'relief', mapId: 1 },
      });
      expect(buildRelief(ctx, RELIEF, view(1), true).items[0]).toMatchObject({ id: 'relief:1', opacity: RELIEF_OPACITY.underArt });
      expect(RELIEF_OPACITY.underArt).toBeLessThan(RELIEF_OPACITY.backdrop);
      // Another world map's relief is its own, not an item "elsewhere".
      expect(content.stats).toMatchObject({ drawn: 1, otherSurfaces: 0, unresolved: 0 });
      expect(ids(buildRelief(ctx, RELIEF, view(2991)))).toEqual([]);
    });

    it('counts an image whose rectangle is not on its world map as not placed', () => {
      const wrong: ReliefInput = { mapId: KALIMDOR, url: 'x.png', bounds: { mapId: EK, xMin: 0, xMax: 1, yMin: 0, yMax: 1 } };
      expect(buildRelief(ctx, [wrong], view(1)).stats).toMatchObject({ drawn: 0, unresolved: 1, unresolvedBy: { 'no-geometry': 1 } });
    });

    it('changes only the opacity when art appears over it (the adapter then only calls setOpacity)', () => {
      const layers = createMapLayers({ geometry });
      const alone = layers.relief(RELIEF, view(1));
      expect(layers.relief(RELIEF, view(1))).toBe(alone);
      const under = layers.relief(RELIEF, view(1), true);
      expect(under).not.toBe(alone);
      const [before] = alone.items;
      const [after] = under.items;
      expect({ ...after, opacity: 0 }).toEqual({ ...before, opacity: 0 });
    });
  });

  describe('buildArt with committed images', () => {
    const durotar: ArtInput = {
      uiMapId: uiMapId(1411),
      url: 'maps/art/1411.webp',
      opacity: 1,
      // The art manifest's rectangle, which differs from the fixture's rounded row in the last digits.
      bounds: { mapId: KALIMDOR, xMin: -1716.6666259765625, xMax: 1808.333251953125, yMin: -7249.99951171875, yMax: -1962.4998779296875 },
    };

    it('places an image by the rectangle its manifest records, not the geometry’s row', () => {
      const content = buildArt(ctx, [durotar], view(1));
      expect(content.items[0]).toMatchObject({ id: 'art:1411', url: 'maps/art/1411.webp', label: 'Durotar', bounds: durotar.bounds });
    });

    it('places an image the geometry does not know by its rectangle, and refuses an empty one', () => {
      const unknown: ArtInput = { uiMapId: uiMapId(1434), url: 'maps/art/1434.webp', opacity: 1, bounds: { mapId: EK, xMin: -15422, xMax: -11168, yMin: -4160, yMax: 2220 } };
      const empty: ArtInput = { uiMapId: uiMapId(1435), url: 'maps/art/1435.webp', opacity: 1, bounds: { mapId: EK, xMin: 1, xMax: 1, yMin: 0, yMax: 2 } };
      const content = buildArt(ctx, [unknown, empty], view(0));
      expect(ids(content)).toEqual(['art:1434']);
      expect(content.stats).toMatchObject({ unresolved: 1, unresolvedBy: { 'no-geometry': 1 } });
    });

    it('counts an image on another world map', () => {
      expect(buildArt(ctx, [durotar], view(0)).stats).toMatchObject({ drawn: 0, otherSurfaces: 1 });
    });
  });

  describe('zone outlines and coastline', () => {
    const zones: OutlineInput = {
      mapId: KALIMDOR,
      lines: [
        [wp(1, 0, 0), wp(1, 10, 0), wp(1, 10, 10)],
        [wp(1, 5, 5)], // one point: not a line
        [wp(1, 20, 20), wp(1, 30, 20)],
      ],
    };
    const coast: OutlineInput = { mapId: EK, lines: [[wp(0, 1, 1), wp(0, 2, 2)]] };

    it('draws one non-interactive path per world map from the arcs, dropping lines of fewer than two points', () => {
      const content = buildZoneOutlines(ctx, [zones, coast], view(1));
      expect(ids(content)).toEqual(['outline:zones:1']);
      const outline = content.items[0] as OutlineDescriptor;
      expect(outline).toMatchObject({ type: 'outline', kind: 'zones', mapId: 1, label: 'Zone outlines', ref: { kind: 'terrain', layer: 'zone-outlines', mapId: 1 } });
      expect(outline.lines).toHaveLength(2);
      expect(content.stats).toMatchObject({ drawn: 1, otherSurfaces: 0 });
      expect(ids(buildCoastline(ctx, [zones, coast], view(0)))).toEqual(['outline:coast:0']);
      expect(ids(buildZoneOutlines(ctx, [zones], view(2991)))).toEqual([]);
    });

    it('keeps one descriptor object per input, so a rebuild compares nothing', () => {
      const first = buildZoneOutlines(ctx, [zones], view(1)).items[0];
      expect(buildZoneOutlines(ctx, [zones], view(1)).items[0]).toBe(first);
      const layers = createMapLayers({ geometry });
      const content = layers.zoneOutlines([zones], view(1));
      expect(layers.zoneOutlines([zones], view(1, -5))).toBe(content);
    });

    it('take one path each, out of the zone frames and terrain paths’ 60 (map-presentation.md §5.2)', () => {
      for (const band of MAP_BANDS) {
        expect(DEFAULT_LOD.budgets[band]).toMatchObject({ relief: 1, art: 16, coastline: 1, 'zone-outlines': 1, 'zone-frames': 58 });
        const b = DEFAULT_LOD.budgets[band];
        expect(b['zone-frames'] + b.coastline + b['zone-outlines']).toBe(60);
      }
      expect(buildZoneOutlines(ctx, [zones], view(1)).stats).toMatchObject({ notDrawn: 0, aggregated: 0, unresolved: 0, otherSurfaces: 0 });
    });
  });

  describe('zone frames over painted art', () => {
    it('lose their faint fill (the art shows through); the extent is never filled', () => {
      const filled = buildZoneFrames(ctx, view(1));
      expect(filled.items.filter((item) => item.type === 'frame' && item.kind === 'zone').every((item) => item.type === 'frame' && item.filled)).toBe(true);
      expect(filled.items.find((item) => item.id === 'extent:1')).toMatchObject({ filled: false });
      const bare = buildZoneFrames(ctx, view(1), null, false);
      expect(bare.items.every((item) => item.type === 'frame' && !item.filled)).toBe(true);
      const layers = createMapLayers({ geometry });
      expect(layers.zoneFrames(view(1), null, false)).not.toBe(layers.zoneFrames(view(1), null, true));
    });
  });

  describe('aggregates of points published on the world map or a continent (STATUS known issue, UiMap 947)', () => {
    // Published in Azeroth 947 (one row per continent) and in the Kalimdor continent map 1414, as
    // QuestieDB has a few (the object "Freshly Dug Dirt" in 947; an NPC in 1415 on the other side).
    const onAzeroth = zoneSourcedPoint(uiMapId(947), 29.99, 89.15);
    const onKalimdor = zoneSourcedPoint(uiMapId(1414), 50, 50);
    const inDurotar = zoneSourcedPoint(uiMapId(1411), 50, 50);
    const group = (id: number, source: typeof onAzeroth): PointGroupInput => ({
      subject: { kind: 'object', id: objectId(id) },
      label: `Object ${String(id)}`,
      questIds: [questId(id)],
      spawns: [{ source, world: resolvePoint(source, geometry), uiMapId: source.uiMapId }],
    });

    it('are folded into their world map’s count, never an aggregate named after the world or a continent', () => {
      const input = { groups: [group(1, onAzeroth), group(2, onKalimdor), group(3, inDurotar)] };
      const content = buildSpawnLayer(ctx, 'objectives', input, view(1, -5));
      expect(ids(content)).toEqual(['agg:objectives:1411', 'agg:objectives:map-1']);
      expect(content.items.find((item) => item.id === 'agg:objectives:map-1')).toMatchObject({
        label: 'No zone: 2 objective targets at 2 points; zoom in to see them',
        ref: { kind: 'aggregate', uiMapId: null, count: 2 },
      });
      expect(content.items.some((item) => item.label?.startsWith('Azeroth') === true)).toBe(false);
    });

    it('are drawn raw at zone zoom, where they are', () => {
      const input = { groups: [group(1, onAzeroth)] };
      const content = buildSpawnLayer(ctx, 'available-quests', input, view(1));
      expect(ids(content)).toEqual(['spawn:object:1:0']);
      const world = resolvePoint(onAzeroth, geometry);
      expect(content.items[0]).toMatchObject({ point: world });
      // An NPC's spawns behave the same.
      const npc: PointGroupInput = { subject: { kind: 'npc', id: npcId(9) }, label: 'Npc', questIds: [], spawns: [{ source: onAzeroth, world, uiMapId: uiMapId(947) }] };
      expect(ids(buildSpawnLayer(ctx, 'objectives', { groups: [npc] }, view(1, -5)))).toEqual(['agg:objectives:map-1']);
    });
  });
});

describe('walking paths (MAPS §7.4)', () => {
  /*
   * Route lines along walking paths (docs/MAPS.md §7.4): a walked leg follows the path the
   * navigation model gives, a leg without one is straight and styled pending or fallback, and the
   * 256-vertex pieces and the path cap (MAPS §7.2) hold with paths.
   */

  const geometry = fixtureGeometry();
  const ctx = layerContextOf(geometry);
  const view = (mapId = 1, zoom = -2): MapView => ({ mapId: worldMapId(mapId), zoom, center: null });

  const at = (x: number, y: number, mapId = 1): StepPlacement => ({ kind: 'point', world: { mapId: worldMapId(mapId), x, y }, uiMapId: null, offFrame: false });
  const step = (id: string, placement: StepPlacement, arrive: LegStyle = 'route', departs: LegStyle | null = null): RouteStepInput => ({
    stepId: stepId(id),
    placement,
    arrive,
    departs,
    questIds: [],
  });
  const lines = (items: readonly unknown[]): readonly PolylineDescriptor[] => items.filter((item): item is PolylineDescriptor => (item as PolylineDescriptor).type === 'polyline');

  /** `n` evenly spaced points strictly between the leg's ends, bent sideways so they are not on the straight line. */
  function bent(leg: RouteLeg, n: number): WorldPoint[] {
    const out: WorldPoint[] = [];
    for (let i = 1; i <= n; i += 1) {
      const t = i / (n + 1);
      out.push({ mapId: leg.from.mapId, x: leg.from.x + (leg.to.x - leg.from.x) * t + 3, y: leg.from.y + (leg.to.y - leg.from.y) * t });
    }
    return out;
  }

  /** Paths from `from` through `n` bent points to `to` (the ends included, as a navigation model returns them). */
  function pathsOf(n: number, pending = false, answer?: (leg: RouteLeg) => readonly WorldPoint[] | null): RoutePathsInput & { readonly calls: RouteLeg[] } {
    const calls: RouteLeg[] = [];
    return {
      calls,
      pending,
      pathOf: (leg) => {
        calls.push(leg);
        return answer === undefined ? [leg.from, ...bent(leg, n), leg.to] : answer(leg);
      },
    };
  }

  /** s1-s3 walked, s3 takes a flight to s4, s5 is at s4's point, s6 is walked to. */
  const ROUTE: RouteInput = {
    steps: [
      step('s1', at(0, 0)),
      step('s2', at(100, 0)),
      step('s3', at(100, 100), 'route', 'flight'),
      step('s4', at(500, 500)),
      step('s5', at(500, 500)),
      step('s6', at(600, 500)),
    ],
  };

  describe('routeLegsOf', () => {
    it('lists the walked legs: not a flight, transport or hearth, not a leg that does not move, never across a break or a world map', () => {
      const route: RouteInput = {
        steps: [
          ...ROUTE.steps,
          step('s7', { kind: 'unknown', reason: 'destination-unknown' }),
          step('s8', at(700, 500)),
          step('s9', at(800, 500), 'transport'),
          step('s10', at(0, 0, 0)),
          step('s11', { kind: 'none' }),
          step('s12', at(10, 0, 0)),
        ],
      };
      expect(routeLegsOf(route).map((leg) => `${leg.fromStepId}>${leg.toStepId}`)).toEqual(['s1>s2', 's2>s3', 's5>s6', 's10>s12']);
      expect(routeLegsOf(route)[0]).toEqual({ fromStepId: 's1', toStepId: 's2', from: { mapId: 1, x: 0, y: 0 }, to: { mapId: 1, x: 100, y: 0 } });
    });
  });

  describe('buildRouteLine with walking paths', () => {
    it('draws exactly as before without paths, and says nothing about paths', () => {
      const content = buildRouteLine(ctx, ROUTE, view());
      expect(lines(content.items).map((line) => [line.id, line.points.length])).toEqual([
        ['run:1:route:s1', 3],
        ['run:1:flight:s3', 2],
        ['run:1:route:s4', 3],
      ]);
      expect(content.stats).not.toHaveProperty('paths');
    });

    it('follows each walked leg’s path, joined to the step points, and asks for no other leg', () => {
      const paths = pathsOf(2);
      const content = buildRouteLine(ctx, ROUTE, view(), paths);
      expect(paths.calls.map((leg) => `${leg.fromStepId}>${leg.toStepId}`)).toEqual(['s1>s2', 's2>s3', 's5>s6']);
      const [walk, flight, last] = lines(content.items);
      // s1, two path points, s2, two path points, s3: the path's own ends are not repeated.
      expect(walk?.points).toHaveLength(7);
      expect(walk?.points[0]).toEqual({ mapId: 1, x: 0, y: 0 });
      expect(walk?.points[1]).toMatchObject({ mapId: 1, y: 0 });
      expect(walk?.points[1]?.x).toBeCloseTo(100 / 3 + 3, 9);
      expect(walk?.points[3]).toEqual({ mapId: 1, x: 100, y: 0 });
      expect(walk?.style).toBe('route');
      expect(flight?.points).toHaveLength(2);
      // s4 to s5 does not move; s5 to s6 follows its path.
      expect(last?.points).toHaveLength(5);
      expect(content.stats.paths).toEqual({ along: 3, pending: 0, fallback: 0 });
    });

    it('names one step per vertex, the step its leg leads into, so a click on a path segment selects that step', () => {
      const [walk] = lines(buildRouteLine(ctx, ROUTE, view(), pathsOf(2)).items);
      expect(walk?.ref).toEqual({ kind: 'run', style: 'route', stepIds: ['s1', 's2', 's2', 's2', 's3', 's3', 's3'] });
    });

    it('draws a leg without a path straight: pending while paths are computed, else a fallback, each its own run', () => {
      const noSecond = (leg: RouteLeg) => (leg.toStepId === 's3' ? null : [leg.from, leg.to]);
      const pending = buildRouteLine(ctx, ROUTE, view(), pathsOf(0, true, noSecond));
      expect(lines(pending.items).map((line) => line.id)).toEqual(['run:1:route:s1', 'run:1:route-pending:s2', 'run:1:flight:s3', 'run:1:route:s4']);
      expect(lines(pending.items)[1]).toMatchObject({ points: [{ x: 100, y: 0 }, { x: 100, y: 100 }], label: 'Route (walking path pending)' });
      expect(pending.stats.paths).toEqual({ along: 2, pending: 1, fallback: 0 });
      const done = buildRouteLine(ctx, ROUTE, view(), pathsOf(0, false, noSecond));
      expect(lines(done.items)[1]).toMatchObject({ id: 'run:1:route-fallback:s2', style: 'route-fallback', label: 'Route (straight line: no walking path)' });
      expect(done.stats.paths).toEqual({ along: 2, pending: 0, fallback: 1 });
    });

    it('keeps a stationary step inside a run of pending legs, so the run is not cut there (PERF-2)', () => {
      // s2 and s3 share a point: the leg between them does not move.
      const route: RouteInput = { steps: [step('s1', at(0, 0)), step('s2', at(100, 0)), step('s3', at(100, 0)), step('s4', at(200, 0))] };
      const pending = buildRouteLine(ctx, route, view(), pathsOf(0, true, () => null));
      expect(lines(pending.items).map((line) => line.id)).toEqual(['run:1:route-pending:s1']);
      expect(pending.stats.paths).toEqual({ along: 0, pending: 2, fallback: 0 });
      // Without paths nothing changes: one plain route run.
      expect(lines(buildRouteLine(ctx, route, view()).items).map((line) => line.id)).toEqual(['run:1:route:s1']);
    });

    it('draws a path that breaks the rules as a fallback: off the leg’s world map, not finite, empty, or a provider that throws', () => {
      const bad: readonly ((leg: RouteLeg) => readonly WorldPoint[] | null)[] = [
        (leg) => [leg.from, { mapId: worldMapId(0), x: 1, y: 1 }, leg.to],
        (leg) => [leg.from, { mapId: leg.from.mapId, x: Number.NaN, y: 1 }, leg.to],
        () => [],
        () => {
          throw new Error('navigation failed');
        },
      ];
      for (const answer of bad) {
        expect(buildRouteLine(ctx, { steps: ROUTE.steps.slice(0, 2) }, view(), pathsOf(0, false, answer)).items[0]).toMatchObject({ style: 'route-fallback' });
      }
    });

    it('keeps a path whose ends were snapped away from the step points, joined to them', () => {
      const snapped = (leg: RouteLeg): readonly WorldPoint[] => [{ ...leg.from, x: leg.from.x + 1 }, { ...leg.to, x: leg.to.x - 1 }];
      const content = buildRouteLine(ctx, { steps: ROUTE.steps.slice(0, 2) }, view(), pathsOf(0, false, snapped));
      expect(lines(content.items)[0]?.points.map((p) => p.x)).toEqual([0, 1, 99, 100]);
    });

    it('never takes paths for the proposal', () => {
      const paths = pathsOf(2);
      const proposal = buildProposal(ctx, ROUTE, view());
      expect(lines(proposal.items).every((line) => line.style === 'proposal')).toBe(true);
      expect(paths.calls).toHaveLength(0);
    });
  });

  describe('the vertex and path caps with paths (MAPS §7.2)', () => {
    /** `n` walked steps in a line on Kalimdor, `gap` yd apart. */
    const longRoute = (n: number, gap = 50): RouteInput => ({ steps: Array.from({ length: n }, (_, i) => step(`w${String(i)}`, at(i * gap, 0))) });

    it('cuts runs into pieces of at most 256 vertices that share their ends, and draws at most the layer’s budget', () => {
      const route = longRoute(2000);
      const paths = pathsOf(20);
      // Everything, with room for every piece (a budget taken from the step markers).
      const roomy = layerContextOf(geometry, createLod({ budgets: { 'route-line': 850, 'route-steps': 0 } }));
      const all = lines(buildRouteLine(roomy, route, view(), paths).items);
      expect(all.length).toBeGreaterThan(DEFAULT_LOD.budgets.zone['route-line']);
      expect(all.every((line) => line.points.length >= 2 && line.points.length <= ROUTE_PIECE_MAX_VERTICES)).toBe(true);
      for (let i = 1; i < all.length; i += 1) expect(all[i]?.points[0]).toEqual(all[i - 1]?.points.at(-1));
      // Every step point and path point is drawn exactly once, apart from the shared ends.
      const vertices = all.reduce((sum, line) => sum + line.points.length, 0) - (all.length - 1);
      expect(vertices).toBe(2000 + 1999 * 20);
      expect(new Set(all.map((line) => line.id)).size).toBe(all.length);
      // With the default budgets the layer draws its 150 paths and counts the rest.
      const capped = buildRouteLine(ctx, route, view(), paths);
      expect(capped.stats).toMatchObject({ drawn: DEFAULT_LOD.budgets.zone['route-line'], notDrawn: all.length - DEFAULT_LOD.budgets.zone['route-line'] });
      expect(lines(capped.items).every((line) => line.points.length <= ROUTE_PIECE_MAX_VERTICES)).toBe(true);
    });

    it('cuts a single leg longer than a piece inside the leg, naming the pieces by the step and the offset', () => {
      const route = longRoute(2, 1000);
      const content = buildRouteLine(ctx, route, view(), pathsOf(600));
      const pieces = lines(content.items);
      expect(pieces.map((line) => [line.id, line.points.length])).toEqual([
        ['run:1:route:w0', 256],
        ['run:1:route:w1@255', 256],
        ['run:1:route:w1@510', 92],
      ]);
      expect(pieces[1]?.ref).toMatchObject({ kind: 'run', stepIds: Array.from({ length: 256 }, () => 'w1') });
    });

    it('keeps the highlighted leg into the active step along its path, in pieces of at most 256 vertices', () => {
      const route = longRoute(2, 1000);
      const focus = { selected: [stepId('w1')], hovered: null, active: stepId('w1') };
      const content = buildSelection(ctx, route, view(), focus, pathsOf(300));
      const legs = lines(content.items);
      expect(legs.map((line) => [line.id, line.points.length])).toEqual([
        ['leg:w1', 256],
        ['leg:w1~2', 47],
      ]);
      expect(legs[1]?.points[0]).toEqual(legs[0]?.points.at(-1));
      expect(legs.every((line) => line.style === 'highlight' && line.ref.kind === 'leg')).toBe(true);
      // Without paths it is the straight leg, as before.
      expect(lines(buildSelection(ctx, route, view(), focus).items).map((line) => line.points.length)).toEqual([2]);
    });
  });

  describe('memoised with paths (createMapLayers)', () => {
    const route = (n: number): RouteInput => ({ steps: Array.from({ length: n }, (_, i) => step(`m${String(i)}`, at(i * 40, (i % 7) * 10))) });

    it('asks for each leg once per paths object, and a route edit asks only for the legs it changed', () => {
      const layers = createMapLayers({ geometry });
      const first = route(300);
      const paths = pathsOf(3);
      const before = layers.routeLine(first, view(), paths);
      expect(paths.calls).toHaveLength(299);
      // Moving step 150 changes the legs into it and out of it.
      const moved = first.steps.map((s, i) => (i === 150 ? step(s.stepId, at(150 * 40 + 5, 0)) : s));
      const after = layers.routeLine({ steps: moved }, view(), paths);
      expect(paths.calls).toHaveLength(301);
      expect(paths.calls.slice(299).map((leg) => leg.toStepId)).toEqual(['m150', 'm151']);
      // Only the pieces around the edit are new objects.
      const kept = after.items.filter((item) => before.items.includes(item));
      expect(after.items.length - kept.length).toBeLessThanOrEqual(2);
      // The selection's leg shares the answers: no new question.
      layers.selection({ steps: moved }, view(), { selected: [], hovered: null, active: stepId('m150') }, paths);
      expect(paths.calls).toHaveLength(301);
      // A new paths object (a new batch arrived) asks again.
      const next = pathsOf(3);
      layers.routeLine({ steps: moved }, view(), next);
      expect(next.calls).toHaveLength(299);
    });

    it('keeps every piece a new batch of paths leaves unchanged: a leg whose answer is the same array keeps its drawing', () => {
      const layers = createMapLayers({ geometry });
      const input = route(300);
      const answers = new Map<string, readonly WorldPoint[]>();
      const provider = (pending: boolean, changed: string | null = null): RoutePathsInput => ({
        pending,
        pathOf: (leg) => {
          if (leg.toStepId === changed) return [leg.from, { ...leg.from, x: leg.from.x + 1, y: leg.from.y + 7 }, leg.to];
          const known = answers.get(leg.toStepId);
          if (known !== undefined) return known;
          const fresh = [leg.from, ...bent(leg, 3), leg.to];
          answers.set(leg.toStepId, fresh);
          return fresh;
        },
      });
      const before = layers.routeLine(input, view(), provider(true));
      // Computing finished: the same answers in a new object, so every piece keeps its descriptor.
      const done = layers.routeLine(input, view(), provider(false));
      expect(done.items).toBe(before.items);
      // One leg got a new path: only the pieces of its step range are rebuilt (its vertex count
      // changed, so they are cut again); every other piece keeps its object.
      const next = layers.routeLine(input, view(), provider(false, 'm200'));
      const rebuilt = next.items.filter((item) => !done.items.includes(item));
      expect(next.items.length).toBeGreaterThanOrEqual(6);
      expect(rebuilt.length).toBeGreaterThanOrEqual(1);
      expect(rebuilt.length).toBeLessThanOrEqual(3);
      expect(rebuilt.some((item) => item.type === 'polyline' && item.ref.kind === 'run' && item.ref.stepIds.includes(stepId('m200')))).toBe(true);
    });

    it('rebuilds nothing while the paths object is the same, and draws straight again without it', () => {
      const layers = createMapLayers({ geometry });
      const input = route(20);
      const paths = pathsOf(3);
      const content = layers.routeLine(input, view(), paths);
      expect(layers.routeLine(input, view(), paths)).toBe(content);
      const straight = layers.routeLine(input, view(), null);
      expect(lines(straight.items)[0]?.points).toHaveLength(20);
      expect(straight.stats).not.toHaveProperty('paths');
    });

    it('asks nothing for a route without walked legs, and a spy sees the leg query', () => {
      const pathOf = vi.fn((leg: RouteLeg) => [leg.from, leg.to]);
      const layers = createMapLayers({ geometry });
      layers.routeLine({ steps: [step('a', at(0, 0)), step('b', at(10, 0), 'transport')] }, view(), { pathOf, pending: false });
      expect(pathOf).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================================
/*
 * The atlas in map/layers (docs/research/map-atlas.md §5, §8.2, §8.5; steps ATL.4 and ATL.5): the
 * surface, per-map building on it, connectors, the inset's card, interim art clipped at the seam,
 * and the cap shared across the active maps' parts. The fixture geometry carries the cited 947 rows
 * and the Zephras Isle row (src/geo/test-fixtures.ts).
 */

const atlasGeometry = fixtureGeometry();
const atlasCtx = layerContextOf(atlasGeometry);
const MAP_1 = worldMapId(1);
const MAP_0 = worldMapId(0);
const MAP_2991 = worldMapId(2991);
const ANY_RECT: WorldBounds = { mapId: MAP_1, xMin: -1, xMax: 1, yMin: -1, yMax: 1 };

/** A view on the atlas for one map's builder, with the maps the atlas view builds (their rectangles do not matter here). */
function atlasView(mapId: WorldMapId, active: readonly WorldMapId[] = [MAP_1, MAP_0, MAP_2991], zoom = -2): MapView {
  return { mapId, zoom, center: null, surface: 'atlas', visible: active.map((id) => ({ ...ANY_RECT, mapId: id })) };
}
const worldView = (mapId: WorldMapId, zoom = -2): MapView => ({ mapId, zoom, center: null });

const idsIn = (partContent: LayerContent): readonly string[] => partContent.items.map((item) => item.id);

const placedAt = (x: number, y: number, mapId: WorldMapId): StepPlacement => ({ kind: 'point', world: { mapId, x, y }, uiMapId: null, offFrame: false });
const routeStep = (id: string, placement: StepPlacement, arrive: LegStyle = 'route'): RouteStepInput => ({ stepId: stepId(id), placement, arrive, departs: null, questIds: [] });

describe('atlasSurfaceOf (map-atlas.md §5, §8.1)', () => {
  it('places Kalimdor, the Eastern Kingdoms and the Zephras Isle inset from the geometry, with the layout’s hash', () => {
    const atlas = atlasSurfaceOf(atlasGeometry);
    if (atlas === null) throw new Error('no atlas');
    const placements = atlasPlacements(atlasGeometry, ATLAS_LAYOUT);
    expect(atlas).toMatchObject({ kind: 'atlas', id: 'atlas', name: 'Azeroth', mapId: MAP_1, extentSource: 'atlas', extentUiMapId: null });
    expect(atlas.mapIds).toEqual([MAP_1, MAP_0, MAP_2991]);
    expect(atlas.placements).toEqual(placements);
    expect(atlas.hash).toBe(atlasHash(placements ?? [], ATLAS_LAYOUT));
    expect(atlas.members.map((member) => [member.id, member.name])).toEqual([
      ['world:1', 'Kalimdor'],
      ['world:0', 'Eastern Kingdoms'],
      ['world:2991', 'Zephras Isle'],
    ]);
    expect(atlas.members).toEqual(surfacesOf(atlasGeometry).filter((surface) => atlas.mapIds.includes(surface.mapId)).sort((a, b) => atlas.mapIds.indexOf(a.mapId) - atlas.mapIds.indexOf(b.mapId)));
    expect(atlas.uiMapIds).toEqual([...new Set(atlas.members.flatMap((member) => member.uiMapIds))].sort((a, b) => a - b));
  });

  it('expresses the layout’s extent, card included, in Kalimdor’s yards (E = eOff − y, S = sOff − x)', () => {
    const atlas = atlasSurfaceOf(atlasGeometry);
    const kalimdor = atlas?.placements[0];
    if (atlas === null || kalimdor === undefined) throw new Error('no atlas');
    const { extent } = atlas;
    expect([kalimdor.eOff - extent.yMax, kalimdor.eOff - extent.yMin, kalimdor.sOff - extent.xMax, kalimdor.sOff - extent.xMin]).toEqual([0, 30720, 0, 26112]);
  });

  it('is null when the geometry cannot place the layout, and the surfaces are then the world maps', () => {
    const without947 = createMapGeometry({ kind: 'placeholder', product: 'wow_classic_beta', recordedFrameHash: null, maps: FIXTURE_MAPS.filter((map) => map !== AZEROTH), eraToForever: [] });
    expect(atlasSurfaceOf(without947)).toBeNull();
    expect(atlasSurfacesOf(without947)).toEqual(surfacesOf(without947));
    expect(atlasSurfacesOf(atlasGeometry).map((surface) => surface.id)).toEqual(['atlas']);
    expect(atlasCtx.atlas?.id).toBe('atlas');
  });
});

describe('building one map of the atlas (map-atlas.md §8.2)', () => {
  const stormwindSpawn = (): SpawnPoint => {
    const source = zoneSourcedPoint(uiMapId(1453), 50, 50);
    return { source, world: resolvePoint(source, atlasGeometry), uiMapId: uiMapId(1453) };
  };
  const durotarSpawn = (): SpawnPoint => {
    const source = zoneSourcedPoint(uiMapId(1411), 50, 50);
    return { source, world: resolvePoint(source, atlasGeometry), uiMapId: uiMapId(1411) };
  };
  const input: SpawnLayerInput = {
    groups: [{ subject: { kind: 'npc', id: npcId(1) }, label: 'Two continents', questIds: [questId(1)], spawns: [durotarSpawn(), stormwindSpawn()] }],
  };

  it('leaves a point on another placed map to that map’s builder, never counting it as elsewhere', () => {
    const world = buildSpawnLayer(atlasCtx, 'available-quests', input, worldView(MAP_1));
    expect(world.stats).toMatchObject({ drawn: 1, otherSurfaces: 1 });
    const one = buildSpawnLayer(atlasCtx, 'available-quests', input, atlasView(MAP_1));
    const zero = buildSpawnLayer(atlasCtx, 'available-quests', input, atlasView(MAP_0));
    expect(one.stats).toMatchObject({ drawn: 1, otherSurfaces: 0 });
    expect(zero.stats).toMatchObject({ drawn: 1, otherSurfaces: 0 });
    expect([...idsIn(one), ...idsIn(zero)]).toEqual(['spawn:npc:1:0', 'spawn:npc:1:1']);
  });

  it('draws no continent extents on the atlas, and the inset’s card with its caption', () => {
    expect(idsIn(buildZoneFrames(atlasCtx, worldView(MAP_1)))).toContain('extent:1');
    const one = buildZoneFrames(atlasCtx, atlasView(MAP_1));
    expect(idsIn(one).filter((id) => !id.startsWith('frame:'))).toEqual([]);
    const isle = buildZoneFrames(atlasCtx, atlasView(MAP_2991));
    const card = isle.items.find((item): item is FrameDescriptor => item.type === 'frame' && item.kind === 'inset');
    expect(card).toMatchObject({ id: 'inset:2991', label: insetCaption('Zephras Isle'), filled: false, ref: { kind: 'surface', mapId: MAP_2991 } });
    expect(card?.label).toBe('Zephras Isle: separate map, not in position');
    // The card is the placed rectangle: the 2521 row.
    expect(card?.bounds).toEqual({ mapId: MAP_2991, xMin: 1247.9169921875, xMax: 4956.25, yMin: -1331.25, yMax: 4231.25 });
  });

  it('clips each continent’s painting to its side of the seam, and leaves the card’s painting whole (interim art)', () => {
    const art: readonly ArtInput[] = [
      { uiMapId: uiMapId(1414), url: '1414.webp', opacity: 1 },
      { uiMapId: uiMapId(1415), url: '1415.webp', opacity: 1 },
      { uiMapId: uiMapId(2521), url: '2521.webp', opacity: 1 },
    ];
    const image = (partContent: LayerContent): ArtDescriptor | undefined => partContent.items.find((item): item is ArtDescriptor => item.type === 'art');
    // The seam E 16,617 is y = 5,652 − 16,617 in Kalimdor's yards and y = 22,499 − 16,617 in the Eastern Kingdoms'.
    const one = image(buildArt(atlasCtx, art, atlasView(MAP_1)));
    expect(one?.clip).toEqual({ ...one?.bounds, yMin: 5652 - 16617 });
    const zero = image(buildArt(atlasCtx, art, atlasView(MAP_0)));
    expect(zero?.clip).toEqual({ ...zero?.bounds, yMax: 22499 - 16617 });
    expect(image(buildArt(atlasCtx, art, atlasView(MAP_2991)))?.clip).toBeUndefined();
    // On a world surface nothing is clipped, and the other maps' images are counted elsewhere.
    const world = buildArt(atlasCtx, art, worldView(MAP_1));
    expect(image(world)).not.toHaveProperty('clip');
    expect(world.stats.otherSurfaces).toBe(2);
    expect(buildArt(atlasCtx, art, atlasView(MAP_1)).stats.otherSurfaces).toBe(0);
  });
});

describe('connectors and transition glyphs on the atlas (map-atlas.md §8.5)', () => {
  // s2 takes the boat from Durotar to Stormwind's harbour; s4 goes to Zephras Isle; s5 to an instance map.
  const ACROSS_ROUTE: RouteInput = {
    steps: [
      routeStep('s1', placedAt(0, -3000, MAP_1)),
      routeStep('s2', placedAt(-8500, 900, MAP_0), 'transport'),
      routeStep('s3', placedAt(-8600, 1000, MAP_0)),
      routeStep('s4', placedAt(3000, 1500, MAP_2991), 'transport'),
      routeStep('s5', placedAt(100, 100, worldMapId(36))),
    ],
  };

  it('draws a leg between the continents as one connector, from the builder of the map it leaves', () => {
    const one = buildRouteLine(atlasCtx, ACROSS_ROUTE, atlasView(MAP_1));
    const zero = buildRouteLine(atlasCtx, ACROSS_ROUTE, atlasView(MAP_0));
    const connector = one.items.find((item): item is ConnectorDescriptor => item.type === 'connector');
    expect(connector).toEqual({
      type: 'connector',
      id: 'connector:s1>s2',
      from: { mapId: MAP_1, x: 0, y: -3000 },
      to: { mapId: MAP_0, x: -8500, y: 900 },
      style: 'transport',
      emphasis: 'normal',
      label: 'Transport to Eastern Kingdoms',
      ref: { kind: 'connector', fromStepId: 's1', toStepId: 's2', fromMapId: MAP_1, toMapId: MAP_0, leg: 'transport' },
    });
    expect(zero.items.some((item) => item.type === 'connector')).toBe(false);
    expect([...idsIn(one), ...idsIn(zero)].filter((id) => id.startsWith('transition:') && id.includes('s1'))).toEqual([]);
    // When the map it leaves is not being built, the map it reaches draws it.
    const alone = buildRouteLine(atlasCtx, ACROSS_ROUTE, atlasView(MAP_0, [MAP_0]));
    expect(alone.items.find((item) => item.type === 'connector')?.id).toBe('connector:s1>s2');
    // On a world surface the same leg keeps its glyph pair.
    expect(idsIn(buildRouteLine(atlasCtx, ACROSS_ROUTE, worldView(MAP_1)))).toContain('transition:out:s1');
  });

  it('keeps transition glyph pairs for legs to the inset and to maps the atlas does not place', () => {
    const zero = buildRouteLine(atlasCtx, ACROSS_ROUTE, atlasView(MAP_0));
    const isle = buildRouteLine(atlasCtx, ACROSS_ROUTE, atlasView(MAP_2991));
    // The Eastern Kingdoms draw the departure to the card, the card's builder its arrival.
    expect(idsIn(zero)).toContain('transition:out:s3');
    expect(idsIn(zero)).not.toContain('transition:in:s4');
    expect(idsIn(isle)).toContain('transition:in:s4');
    const toInset = zero.items.find((item): item is MarkerDescriptor => item.id === 'transition:out:s3');
    expect(toInset?.label).toBe('Transport to Zephras Isle');
    // The leg to world map 36 (an instance, not on the atlas): a departure glyph on Zephras Isle, its
    // arrival elsewhere. It shares s4's point with the arrival from the Eastern Kingdoms: one stack.
    const stack = isle.items.find((item): item is MarkerDescriptor => item.id === 'transition:in:s4');
    expect(stack?.refs.map((ref) => (ref.kind === 'transition' ? `${ref.end}:${String(ref.toMapId)}` : ref.kind))).toEqual(['arrival:2991', 'departure:36']);
    expect(isle.stats.otherSurfaces).toBe(zero.stats.otherSurfaces);
    // Only the arrival glyph on map 36 is elsewhere: the Eastern Kingdoms' run and glyphs are the atlas's.
    expect(isle.stats.otherSurfaces).toBe(1);
  });
});

/** Largest-remainder shares, as `shareCap` in map/adapter (map/layers and its tests may import only its types). */
function localShare(counts: readonly number[], cap: number): readonly number[] {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0 || cap <= 0) return counts.map(() => 0);
  const quotas = counts.map((count) => (count * cap) / total);
  const shares = quotas.map((quota) => Math.floor(quota));
  let left = cap - shares.reduce((sum, share) => sum + share, 0);
  const order = quotas
    .map((quota, index) => ({ index, rest: quota - Math.floor(quota) }))
    .filter((entry) => (counts[entry.index] ?? 0) > 0)
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (let i = 0; left > 0 && order.length > 0; i = (i + 1) % order.length) {
    const index = order[i]?.index ?? 0;
    shares[index] = (shares[index] ?? 0) + 1;
    left -= 1;
  }
  return shares;
}

describe('parts, shared budgets and the join (map-atlas.md §8.2)', () => {
  const partsOf = (...entries: readonly (readonly [number, number])[]) => entries.map(([candidates, inView]) => ({ candidates, inView }));

  it('gives one part the layer’s budget, and every part all of it when their candidates fit together', () => {
    expect(partBudgets('route-steps', partsOf([5000, 10]), DEFAULT_LOD, localShare)).toEqual([700]);
    expect(partBudgets('route-steps', partsOf([300, 300], [200, 0]), DEFAULT_LOD, localShare)).toEqual([700, 700]);
  });

  it('shares the budget by candidates in view, caps a part at its candidates and gives the room to the others', () => {
    expect(partBudgets('route-steps', partsOf([1000, 300], [1000, 100]), DEFAULT_LOD, localShare)).toEqual([525, 175]);
    expect(partBudgets('route-steps', partsOf([50, 50], [5000, 500]), DEFAULT_LOD, localShare)).toEqual([50, 650]);
    // A part with nothing in view gets what the others leave, by its candidates.
    expect(partBudgets('route-steps', partsOf([100, 100], [3000, 0]), DEFAULT_LOD, localShare)).toEqual([100, 600]);
    // Nothing in view anywhere: by candidates.
    expect(partBudgets('route-steps', partsOf([3000, 0], [1000, 0]), DEFAULT_LOD, localShare)).toEqual([525, 175]);
  });

  it('keeps the per-map layers per map, and takes their extra paths from the zone frames, so the cap holds', () => {
    expect(partBudgets('relief', partsOf([1, 1], [1, 1], [0, 0]), DEFAULT_LOD, localShare)).toEqual([1, 1, 1]);
    expect(partBudgets('zone-outlines', partsOf([1, 1], [1, 1], [0, 0]), DEFAULT_LOD, localShare)).toEqual([1, 1, 1]);
    const frames = partBudgets('zone-frames', partsOf([60, 40], [60, 20], [5, 1]), DEFAULT_LOD, localShare);
    expect(frames.reduce((sum, value) => sum + value, 0)).toBe(58 - 2 * 2);
    // Every canvas layer's shares, with three maps, stay within the 2,500-path cap in every band.
    for (const band of MAP_BANDS) {
      const layers = (Object.keys(DEFAULT_LOD.budgets[band]) as LayerId[]).filter((layer) => layer !== 'art' && layer !== 'relief');
      const total = layers.reduce((sum, layer) => sum + partBudgets(layer, partsOf([9000, 900], [9000, 50], [9000, 5]), DEFAULT_LOD, localShare, band).reduce((a, b) => a + b, 0), 0);
      expect(total, band).toBeLessThanOrEqual(DEFAULT_LOD.pathCapPerSurface);
    }
  });

  it('never hands out more than the budget', () => {
    let seed = 12345;
    const next = (): number => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 500; i += 1) {
      const count = 2 + Math.floor(next() * 3);
      const entries = Array.from({ length: count }, () => {
        const candidates = Math.floor(next() * 2000);
        return { candidates, inView: Math.floor(next() * candidates) };
      });
      const band = MAP_BANDS[i % 4] ?? 'zone';
      const budgets = partBudgets('available-quests', entries, DEFAULT_LOD, localShare, band);
      const own = DEFAULT_LOD.budgets[band]['available-quests'];
      const fits = entries.reduce((sum, entry) => sum + entry.candidates, 0) <= own;
      if (!fits) expect(budgets.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(own);
      budgets.forEach((budget, index) => {
        expect(budget).toBeGreaterThanOrEqual(0);
        if (!fits) expect(budget).toBeLessThanOrEqual(entries[index]?.candidates ?? 0);
      });
    }
  });

  const partContent = (id: string, over: Partial<LayerContent['stats']> = {}): LayerContent => ({
    layer: 'route-line',
    items: id === '' ? [] : [{ type: 'frame', id, bounds: ANY_RECT, kind: 'zone', label: null, emphasis: 'normal', filled: false, ref: { kind: 'zone', uiMapId: uiMapId(1) } }],
    stats: { drawn: id === '' ? 0 : 1, notDrawn: 0, aggregated: 0, unresolved: 2, unresolvedBy: { 'destination-unknown': 2 }, otherSurfaces: 3, ...over },
  });

  it('joins the parts in order, summing what they draw and keeping the map-independent counts once', () => {
    const a = partContent('a', { notDrawn: 4, paths: { along: 1, pending: 2, fallback: 3 } });
    const b = partContent('b', { notDrawn: 1, paths: { along: 10, pending: 0, fallback: 1 } });
    const joined = joinLayerParts('route-line', [a, b]);
    expect(idsIn(joined)).toEqual(['a', 'b']);
    expect(joined.stats).toEqual({
      drawn: 2,
      notDrawn: 5,
      aggregated: 0,
      unresolved: 2,
      unresolvedBy: { 'destination-unknown': 2 },
      otherSurfaces: 3,
      paths: { along: 11, pending: 2, fallback: 4 },
    });
    // The relief counts each map's own images, so its unplaced images add up.
    const relief = joinLayerParts('relief', [partContent('r0', { unresolved: 1, unresolvedBy: { 'no-geometry': 1 } }), partContent('r1', { unresolved: 1, unresolvedBy: { 'no-geometry': 1 } })]);
    expect(relief.stats.unresolvedBy).toEqual({ 'no-geometry': 2 });
    // One part as it is; one part drawing with the others empty: that part, identity kept.
    expect(joinLayerParts('route-line', [a])).toBe(a);
    expect(joinLayerParts('route-line', [a, partContent('')])).toBe(a);
  });

  it('memoises the join on the parts’ identities (the adapter skips it by reference)', () => {
    const join = createLayerJoin();
    const a = partContent('a');
    const b = partContent('b');
    const first = join('route-line', [a, b]);
    expect(join('route-line', [a, b])).toBe(first);
    // New parts with the same items and counts give the previous object back.
    expect(join('route-line', [{ ...a }, { ...b }])).toBe(first);
    expect(join('route-line', [a, partContent('c')])).not.toBe(first);
  });

  it('builds a layer as a part: its method’s result, its candidates and those in view', () => {
    const layers = createMapLayers({ geometry: atlasGeometry });
    const route: RouteInput = { steps: [routeStep('a', placedAt(0, -3000, MAP_1)), routeStep('b', placedAt(500, -3000, MAP_1)), routeStep('c', placedAt(9000, 9000, MAP_1))] };
    const inView: MapView = { mapId: MAP_1, zoom: -2, center: null, bounds: { mapId: MAP_1, xMin: -100, xMax: 1000, yMin: -3100, yMax: -2900 } };
    const part = layers.part({ layer: 'route-steps', route }, inView);
    expect(part.candidates).toBe(3);
    expect(part.inView()).toBe(2);
    expect(part.finish()).toBe(layers.routeSteps(route, inView));
    // Another budget cuts it (the view ranks from no centre, so by id).
    expect(idsIn(part.finish(1))).toEqual(['step:a']);
  });
});

// =============================================================================================
// Over the atlas tiles (map-atlas.md §8.5, §8.6; ATL.7) and the idle pre-build (§8.2; ATL.8)

describe('zone frames over the atlas tiles (map-atlas.md §8.5, §8.6; D-042 A8)', () => {
  // Ironforge (1455) at Stormwind's rectangle, for the test: a city the tiles draw as a card.
  const stormwind = FIXTURE_MAPS.find((map) => map.uiMapId === uiMapId(1453));
  if (stormwind === undefined) throw new Error('no Stormwind');
  const IRONFORGE: UiMapGeometry = { ...stormwind, uiMapId: uiMapId(1455), name: 'Ironforge', assignments: stormwind.assignments.map((row) => ({ ...row, id: 46765 })) };
  const geometry = fixtureGeometry([...FIXTURE_MAPS, IRONFORGE]);
  const frames = (content: LayerContent): readonly FrameDescriptor[] => content.items.filter((item): item is FrameDescriptor => item.type === 'frame');

  it('keeps every zone rectangle but paints none, and frames the city cards only at tile levels −1 and 0', () => {
    const layers = createMapLayers({ geometry });
    const call: LayerCall = { layer: 'zone-frames', focusZone: uiMapId(1453), filled: true, overTiles: true };
    const at = (zoom: number): readonly FrameDescriptor[] => frames(layers.part(call, atlasView(MAP_0, [MAP_0], zoom)).finish());
    const coarse = at(-2);
    expect(coarse.length).toBeGreaterThan(1);
    expect(coarse.every((frame) => frame.kind === 'zone' && frame.hidden === true && !frame.filled)).toBe(true);
    // Level −1 (zoom −1.5 rounds to −1) and level 0 (any zoom above it): Ironforge is a card, captioned, over the tiles.
    for (const zoom of [-1.5, -1, 0, 1.75]) {
      const fine = at(zoom);
      expect(fine.find((frame) => frame.id === 'frame:1455'), String(zoom)).toMatchObject({ kind: 'card', label: 'Ironforge', overTiles: true, filled: false, emphasis: 'normal' });
      expect(fine.find((frame) => frame.id === 'frame:1455')?.hidden).toBeUndefined();
      expect(fine.filter((frame) => frame.id !== 'frame:1455').every((frame) => frame.hidden === true)).toBe(true);
    }
    expect(at(-1.51).find((frame) => frame.id === 'frame:1455')?.kind).toBe('zone');
    // The inset's card is drawn over the tiles too.
    const isle = frames(layers.part(call, atlasView(MAP_2991, [MAP_2991])).finish());
    expect(isle.find((frame) => frame.kind === 'inset')).toMatchObject({ id: 'inset:2991', overTiles: true });
  });

  it('in the minimap style, frames no city card and dashes the underground cities from the zone band, uncaptioned (D-049 O19)', () => {
    const layers = createMapLayers({ geometry });
    const call: LayerCall = { layer: 'zone-frames', focusZone: null, filled: true, overTiles: true, minimap: true };
    const at = (zoom: number, band?: 'continent' | 'zone' | 'close'): readonly FrameDescriptor[] => frames(layers.part(call, { ...atlasView(MAP_0, [MAP_0], zoom), ...(band === undefined ? {} : { band }) }).finish());
    for (const zoom of [-3, -1.5, 0]) {
      const ironforge = at(zoom).find((frame) => frame.id === 'frame:1455');
      expect(ironforge, String(zoom)).toMatchObject({ kind: 'zone', dashed: true, label: null, filled: false });
      expect(ironforge?.hidden).toBeUndefined();
      expect(at(zoom).filter((frame) => frame.id !== 'frame:1455').every((frame) => frame.hidden === true && frame.dashed === undefined)).toBe(true);
    }
    // Below the zone band it is kept but not painted, as every rectangle over the tiles.
    expect(at(-4, 'continent').find((frame) => frame.id === 'frame:1455')).toMatchObject({ hidden: true });
  });

  it('draws the frames as before without tiles, and on a world surface', () => {
    const layers = createMapLayers({ geometry });
    const plain = frames(layers.part({ layer: 'zone-frames', focusZone: null, filled: true }, atlasView(MAP_0, [MAP_0], -1)).finish());
    expect(plain.some((frame) => frame.hidden === true || frame.overTiles === true || frame.kind === 'card')).toBe(false);
    const world = frames(layers.part({ layer: 'zone-frames', focusZone: null, filled: true, overTiles: true }, worldView(MAP_0, -1)).finish());
    expect(world.some((frame) => frame.hidden === true || frame.kind === 'card')).toBe(false);
  });
});

describe('MapLayers.prebuild (map-atlas.md §8.2: the other band in idle time)', () => {
  /** A spawn input that counts how often a builder collects it. */
  function countedInput(): { readonly input: SpawnLayerInput; readonly reads: () => number } {
    let reads = 0;
    const spawn = (): SpawnPoint => {
      const source = zoneSourcedPoint(uiMapId(1411), 50, 50);
      return { source, world: resolvePoint(source, atlasGeometry), uiMapId: uiMapId(1411) };
    };
    const groups = [{ subject: { kind: 'npc' as const, id: npcId(1) }, label: 'Giver', questIds: [questId(1)], spawns: [spawn()] }];
    const input: SpawnLayerInput = {
      get groups() {
        reads += 1;
        return groups;
      },
    };
    return { input, reads: () => reads };
  }

  it('collects the other band ahead of need, touching nothing drawn, and a crossing then collects nothing', () => {
    const layers = createMapLayers({ geometry: atlasGeometry });
    const { input, reads } = countedInput();
    const call: LayerCall = { layer: 'objectives', input, focusQuests: [], rawZone: null };
    const continent = worldView(MAP_1, -3.8);
    const zone = worldView(MAP_1, -3.2);
    const drawn = layers.part(call, continent).finish();
    const collected = reads();
    // Built ahead, from the points the builder already holds for this input (its `SpawnBase`): the
    // input is not read again, and the drawn content is untouched.
    expect(layers.prebuild(call, zone)).toBe(true);
    expect(reads()).toBe(collected);
    expect(layers.part(call, continent).finish()).toBe(drawn);
    // Already there: nothing to do.
    expect(layers.prebuild(call, zone)).toBe(false);
    expect(layers.prebuild(call, continent)).toBe(false);
    // The crossing finds it: no collect, and the zone band's raw points.
    const crossed = layers.part(call, zone).finish();
    expect(reads()).toBe(collected);
    expect(crossed.items.every((item) => item.type === 'marker')).toBe(true);
    expect(drawn.items.every((item) => item.type === 'aggregate')).toBe(true);
    // And back across: the previous band is kept as the spare, so nothing is collected either.
    expect(layers.part(call, continent).finish().items).toEqual(drawn.items);
    expect(reads()).toBe(collected);
  });

  // Review MR-01: the padded view doubles with each zoom level, so a band crossing on the atlas
  // nearly always changes the maps it meets (Durotar: [1, 0] becomes [1, 0, 2991]; Feralas: [1] becomes [1, 0]).
  it('on the atlas, keys no layer but the connectors on the maps the view meets: a crossing that brings in a map finds the prebuild', () => {
    const layers = createMapLayers({ geometry: atlasGeometry });
    for (const layer of ['objectives', 'available-quests', 'turn-ins'] as const) {
      const { input, reads } = countedInput();
      const call: LayerCall = { layer, input, focusQuests: [], rawZone: null };
      const before = atlasView(MAP_1, [MAP_1], -3.2);
      const after = atlasView(MAP_1, [MAP_1, MAP_0, MAP_2991], -4);
      layers.part(call, before).finish();
      const collected = reads();
      // A map entering the view alone collects nothing again, at either band (the clusters' memo included).
      layers.part(call, atlasView(MAP_1, [MAP_1, MAP_0], -3.2)).finish();
      layers.part(call, atlasView(MAP_1, [MAP_1, MAP_0, MAP_2991], -3.2)).finish();
      expect(reads(), layer).toBe(collected);
      // Prebuilt for the other band with the maps of the view before the crossing…
      expect(layers.prebuild(call, atlasView(MAP_1, [MAP_1], -4)), layer).toBe(true);
      const prebuilt = reads();
      // …the crossing, which brings in the Eastern Kingdoms and the inset, collects nothing.
      const crossed = layers.part(call, after).finish();
      expect(reads(), layer).toBe(prebuilt);
      expect(layers.prebuild(call, after), layer).toBe(false);
      expect(crossed.items.length, layer).toBeGreaterThan(0);
      // The same items as a builder that never saw the other maps.
      const fresh = createMapLayers({ geometry: atlasGeometry }).part(call, atlasView(MAP_1, [MAP_1], -4)).finish();
      expect(crossed.items, layer).toEqual(fresh.items);
    }
  });

  it('still keys the route line on the maps that can emit a connector, and not on the inset', () => {
    const layers = createMapLayers({ geometry: atlasGeometry });
    const route: RouteInput = { steps: [routeStep('s1', placedAt(0, -3000, MAP_1)), routeStep('s2', placedAt(-8500, 900, MAP_0), 'transport')] };
    const call: LayerCall = { layer: 'route-line', route, paths: null };
    const connectorOf = (content: LayerContent): string | undefined => content.items.find((item) => item.type === 'connector')?.id;
    const both = layers.part(call, atlasView(MAP_0, [MAP_1, MAP_0])).finish();
    expect(connectorOf(both)).toBeUndefined();
    // The inset entering the view changes nothing (the same content object).
    expect(layers.part(call, atlasView(MAP_0, [MAP_1, MAP_0, MAP_2991])).finish()).toBe(both);
    // Kalimdor leaving it hands the connector to the Eastern Kingdoms' builder.
    expect(connectorOf(layers.part(call, atlasView(MAP_0, [MAP_0, MAP_2991])).finish())).toBe('connector:s1>s2');
  });
});

// =============================================================================================
/*
 * Zoom bands, per-band budgets and the labels layer (docs/research/map-presentation.md §5.1, §5.2,
 * §25.7; steps MP.0c and MP.1). A view's band (`MapView.band`, the controller's, with hysteresis)
 * chooses the level of detail and each layer's budget; the builders stay stateless.
 */

describe('per-band budgets (map-presentation.md §5.2, §25.7; D-047)', () => {
  const PINS: readonly LayerId[] = ['available-quests', 'turn-ins', 'dungeons', 'flight-masters', 'transports', 'services'];
  const canvasSum = (band: MapBand): number =>
    Object.entries(DEFAULT_LOD.budgets[band]).reduce((sum, [layer, budget]) => sum + (layer === 'art' || layer === 'relief' ? 0 : budget), 0);

  it('holds the design’s table: every band within the 2,500 cap, at most 300 pins per band', () => {
    expect(MAP_BANDS.map(canvasSum)).toEqual([1510, 1812, 2020, 2000]);
    for (const band of MAP_BANDS) expect(canvasSum(band)).toBeLessThanOrEqual(DEFAULT_LOD.pathCapPerSurface);
    // Pins (clusters count as pins) plus the zone band's 50 counted objective pins: 160, 252, 300 and 300.
    const pins = MAP_BANDS.map((band) => PINS.reduce((sum, layer) => sum + DEFAULT_LOD.budgets[band][layer], 0));
    expect(pins).toEqual([160, 252, 250, 250]);
    expect(pins.map((count, i) => count + (i >= 2 ? 50 : 0))).toEqual([160, 252, 300, 300]);
    // Places from the continent band, services from the zone band, the zone tint zoomed out only.
    expect(MAP_BANDS.map((band) => DEFAULT_LOD.budgets[band].dungeons)).toEqual([0, 30, 30, 30]);
    expect(MAP_BANDS.map((band) => DEFAULT_LOD.budgets[band]['flight-masters'])).toEqual([0, 35, 35, 35]);
    expect(MAP_BANDS.map((band) => DEFAULT_LOD.budgets[band].services)).toEqual([0, 0, 18, 18]);
    expect(MAP_BANDS.map((band) => DEFAULT_LOD.budgets[band]['zone-fill'])).toEqual([100, 100, 0, 0]);
    expect(MAP_BANDS.map((band) => DEFAULT_LOD.budgets[band].labels)).toEqual([60, 120, 60, 40]);
    expect(MAP_BANDS.map((band) => DEFAULT_LOD.budgets[band]['available-quests'])).toEqual([120, 120, 100, 100]);
    expect(MAP_BANDS.map((band) => DEFAULT_LOD.budgets[band].objectives)).toEqual([80, 80, 500, 500]);
    expect(budgetOf(DEFAULT_LOD, 'turn-ins', 'close')).toBe(40);
  });

  it('keeps the band edges of adapter.ts (a repeated constant)', () => {
    expect(LAYER_BAND_EDGES).toEqual({ continent: 0.022, zone: 0.088, close: 0.5 });
    expect(bandOfView({ zoom: Math.log2(0.0219) })).toBe('world');
    expect(bandOfView({ zoom: Math.log2(0.022) })).toBe('continent');
    expect(bandOfView({ zoom: -3.5 })).toBe('zone');
    expect(bandOfView({ zoom: -1 })).toBe('close');
    expect(bandOfView({ zoom: -1, band: 'continent' })).toBe('continent');
  });

  it('cuts each layer to its own band’s budget, from the view’s band', () => {
    const lod = createLod({ bandBudgets: { zone: { 'available-quests': 1 }, close: { 'available-quests': 3 } } });
    const small = layerContextOf(geometry, lod);
    const at = view(1, -2);
    expect(buildSpawnLayer(small, 'available-quests', givers, { ...at, band: 'zone' }).stats.drawn).toBe(1);
    expect(buildSpawnLayer(small, 'available-quests', givers, { ...at, band: 'close' }).stats.drawn).toBe(3);
    // Without a band, the plain band of the zoom (-2: zone).
    expect(buildSpawnLayer(small, 'available-quests', givers, at).stats.drawn).toBe(1);
    // The memoised builders cut the same way, and give the design's defaults per band.
    const layers = createMapLayers({ geometry, lod: { bandBudgets: { zone: { 'available-quests': 1 } } } });
    expect(layers.part({ layer: 'available-quests', input: givers, focusQuests: [], rawZone: null }, { ...at, band: 'zone' }).finish().stats.drawn).toBe(1);
    expect(layers.part({ layer: 'available-quests', input: givers, focusQuests: [], rawZone: null }, { ...at, band: 'close' }).finish().stats.drawn).toBeGreaterThan(1);
  });

  it('folds spawn points into counts at the world and continent bands, from the band rather than the zoom', () => {
    const raw = buildSpawnLayer(ctx, 'objectives', givers, { ...view(1, -3.45), band: 'zone' });
    expect(raw.stats.aggregated).toBe(0);
    // The same zoom, still in the continent band after the hysteresis: counts.
    const folded = buildSpawnLayer(ctx, 'objectives', givers, { ...view(1, -3.45), band: 'continent' });
    expect(folded.stats.aggregated).toBeGreaterThan(0);
    expect(folded.items.every((item) => item.type === 'aggregate')).toBe(true);
    // Quest givers cluster there instead (map-presentation.md §25.2.5) when the pipeline has handed
    // their clusters (app/map-clusters.ts; here a source with no cells), and not at the zone band.
    const noCells: ClustersOf = () => ({ cells: () => [], cluster: () => { throw new Error('no cell'); } });
    expect(buildSpawnLayer(ctx, 'available-quests', givers, { ...view(1, -3.45), band: 'continent' }, [], null, noCells).stats.clustered).toBe(0);
    expect(buildSpawnLayer(ctx, 'available-quests', givers, { ...view(1, -3.45), band: 'continent' }).stats.clustered).toBeUndefined();
    expect(buildSpawnLayer(ctx, 'available-quests', givers, { ...view(1, -3.45), band: 'zone' }, [], null, noCells).stats.clustered).toBeUndefined();
    expect(spawnLayerAggregatesIn('available-quests', { zoom: -3.45, band: 'world' })).toBe(true);
    expect(spawnLayerAggregatesIn('available-quests', { zoom: -3.45, band: 'close' })).toBe(false);
    expect(spawnLayerAggregatesIn('flight-masters', { zoom: -6, band: 'world' })).toBe(false);
    expect(viewLodLevel({ zoom: -6 })).toBe('continent');
    expect(viewLodLevel({ zoom: -6, band: 'zone' })).toBe('zone');
    // The memo key follows the band: the same zoom in two bands gives two contents.
    const layers = createMapLayers({ geometry });
    const call: LayerCall = { layer: 'available-quests', input: givers, focusQuests: [], rawZone: null };
    const zone = layers.part(call, { ...view(1, -3.45), band: 'zone' }).finish();
    const continent = layers.part(call, { ...view(1, -3.45), band: 'continent' }).finish();
    expect(zone).not.toBe(continent);
    expect(layers.part(call, { ...view(1, -3.45), band: 'zone' }).finish()).toEqual(zone);
  });

  it('shares a band’s budget across the atlas’s parts', () => {
    const parts = [
      { candidates: 200, inView: 150 },
      { candidates: 200, inView: 50 },
    ];
    expect(partBudgets('available-quests', parts, DEFAULT_LOD, localShare, 'world').reduce((a, b) => a + b, 0)).toBe(120);
    expect(partBudgets('available-quests', parts, DEFAULT_LOD, localShare, 'zone').reduce((a, b) => a + b, 0)).toBe(100);
    expect(partBudgets('dungeons', parts, DEFAULT_LOD, localShare, 'world')).toEqual([0, 0]);
  });
});

describe('the new layers and the labels layer (map-presentation.md §5.2, §5.3)', () => {
  const zoneLabel = (id: string, x: number, y: number, priority: number, mapId = 1, range: readonly [number, number | null] = [0, 0.3]): LabelDescriptor => ({
    type: 'label',
    id,
    point: { mapId: worldMapId(mapId), x, y },
    kind: 'zone',
    text: id,
    card: null,
    priority,
    minPxPerYard: range[0],
    maxPxPerYard: range[1],
    label: null,
    ref: { kind: 'zone', uiMapId: uiMapId(1411) },
  });

  it('keeps the zone fills of the view’s map in their order (tints under the faction patterns), zoomed out only (MP.10; §5.2)', () => {
    const layers = createMapLayers({ geometry });
    const ring = (mapId: number, x: number) => [
      { mapId: worldMapId(mapId), x, y: 0 },
      { mapId: worldMapId(mapId), x: x + 10, y: 0 },
      { mapId: worldMapId(mapId), x: x + 10, y: 10 },
      { mapId: worldMapId(mapId), x, y: 0 },
    ];
    const fill = (id: string, mapId: number, kind: 'tint' | 'faction'): ZoneFillDescriptor => ({
      type: 'zone-fill',
      id,
      mapId: worldMapId(mapId),
      areaId: 14,
      rings: [ring(mapId, 0)],
      fill: kind === 'tint' ? { tint: '#886f4b' } : { pattern: 'horde' },
      label: kind === 'tint' ? null : 'Durotar: Horde territory',
      ref: { kind: 'zone', uiMapId: uiMapId(1411) },
    });
    const fills = [fill('tint:1:14', 1, 'tint'), fill('tint:0:1', 0, 'tint'), fill('faction:1:14', 1, 'faction')];
    const content = layers.part({ layer: 'zone-fill', fills }, { ...view(1), zoom: -5, band: 'continent' }).finish();
    expect(content.items.map((item) => item.id)).toEqual(['tint:1:14', 'faction:1:14']);
    expect(content.stats.otherSurfaces).toBe(1);
    // The zone and close bands' budget is 0 (§5.2): the fills are drawn zoomed out only.
    expect(layers.part({ layer: 'zone-fill', fills }, { ...view(1), zoom: -2, band: 'zone' }).finish().items).toEqual([]);
  });

  it('keeps the labels of the view’s map whose range meets its band, in static priority order, and counts the rest elsewhere', () => {
    const labels = [
      zoneLabel('low', 0, 0, 1),
      zoneLabel('high', 10, 10, 9),
      zoneLabel('mid', 20, 20, 5),
      // Continent band only (0.022 to 0.05): not built at the zone band, but built at the continent band.
      zoneLabel('compact', 30, 30, 7, 1, [0.022, 0.05]),
      // Another world map: counted as elsewhere on a world surface.
      zoneLabel('stormwind', 0, 0, 3, 0),
    ];
    const zone = buildLabels(ctx, labels, { ...view(1, -2), band: 'zone' });
    expect(ids(zone)).toEqual(['high', 'mid', 'low']);
    expect(zone.stats).toMatchObject({ drawn: 3, otherSurfaces: 1 });
    const continent = buildLabels(ctx, labels, { ...view(1, -4.8), band: 'continent' });
    expect(ids(continent)).toEqual(['high', 'compact', 'mid', 'low']);
    // A label just past its range's edge is still built (the adapter's hysteresis decides whether it shows).
    expect(labelInBand({ minPxPerYard: 0.5 * 2 ** 0.1, maxPxPerYard: null }, 'zone')).toBe(true);
    expect(labelInBand({ minPxPerYard: 0.5 * 2 ** 0.2, maxPxPerYard: null }, 'zone')).toBe(false);
    expect(labelInBand({ minPxPerYard: 0, maxPxPerYard: 0.088 * 2 ** -0.2 }, 'zone')).toBe(false);
    expect(labelInBand({ minPxPerYard: 0, maxPxPerYard: null }, 'world')).toBe(true);
  });

  it('caps the labels by the band’s budget, and the memoised builder returns the same content for the same inputs', () => {
    const many = Array.from({ length: 150 }, (_, i) => zoneLabel(`l${String(i).padStart(3, '0')}`, i, i, i, 1, [0, null]));
    expect(buildLabels(ctx, many, { ...view(1, -4.5, { x: 0, y: 0 }), band: 'continent' }).stats).toMatchObject({ drawn: 120, notDrawn: 30 });
    expect(buildLabels(ctx, many, { ...view(1, -2, { x: 0, y: 0 }), band: 'zone' }).stats).toMatchObject({ drawn: 60, notDrawn: 90 });
    expect(buildLabels(ctx, many, { ...view(1, 0, { x: 0, y: 0 }), band: 'close' }).stats).toMatchObject({ drawn: 40, notDrawn: 110 });
    const layers = createMapLayers({ geometry });
    const first = layers.labels(many, { ...view(1, -2), band: 'zone' });
    expect(layers.labels(many, { ...view(1, -2), band: 'zone' })).toBe(first);
    expect(first.stats).toMatchObject({ drawn: 60, notDrawn: 90 });
  });

  it('builds each atlas map’s labels in its own part, the inset’s included, and never counts a placed map’s as elsewhere', () => {
    const labels = [zoneLabel('kalimdor', 0, -4000, 2, 1), zoneLabel('eastern', 0, 0, 2, 0), zoneLabel('isle', 3000, 1000, 2, 2991)];
    const one = buildLabels(atlasCtxForLabels, labels, { ...atlasViewForLabels(worldMapId(1)), band: 'zone' });
    const isle = buildLabels(atlasCtxForLabels, labels, { ...atlasViewForLabels(worldMapId(2991)), band: 'continent' });
    expect(ids(one)).toEqual(['kalimdor']);
    expect(one.stats.otherSurfaces).toBe(0);
    expect(ids(isle)).toEqual(['isle']);
    // A map the atlas does not show counts as elsewhere.
    expect(buildLabels(atlasCtxForLabels, [...labels, zoneLabel('instance', 0, 0, 1, 30)], { ...atlasViewForLabels(worldMapId(1)), band: 'zone' }).stats.otherSurfaces).toBe(1);
  });
});

const atlasCtxForLabels = layerContextOf(fixtureGeometry());
function atlasViewForLabels(mapId: WorldMapId): MapView {
  const rect: WorldBounds = { mapId, xMin: -1, xMax: 1, yMin: -1, yMax: 1 };
  return { mapId, zoom: -2, center: null, surface: 'atlas', visible: [worldMapId(1), worldMapId(0), worldMapId(2991)].map((id) => ({ ...rect, mapId: id })) };
}

describe('quest state on the quest layers (map-presentation.md §7, §25.2.3; step MP.3)', () => {
  const available = { state: 'available', difficulty: 'standard', dungeonQuest: false, progress: null } as const;
  const locked = { state: 'locked', difficulty: null, dungeonQuest: true, progress: null } as const;

  it('carries a group’s quest mark into its markers, and leaves markers without one unmarked', () => {
    const content = buildSpawnLayer(ctx, 'available-quests', { groups: [{ ...gornek, mark: available }, many] }, view(1));
    expect((byId(content, 'spawn:npc:3143:0') as MarkerDescriptor).mark).toEqual(available);
    expect('mark' in byId(content, 'spawn:npc:100:0')).toBe(false);
  });

  it('gives a stack the best state of its members, with a difficulty only when they share it', () => {
    const here = gornek.spawns;
    const a: PointGroupInput = { subject: { kind: 'npc', id: npcId(1) }, label: 'A', questIds: [questId(1)], spawns: here, mark: locked };
    const b: PointGroupInput = { subject: { kind: 'npc', id: npcId(2) }, label: 'B', questIds: [questId(2)], spawns: here, mark: available };
    const c: PointGroupInput = { subject: { kind: 'npc', id: npcId(3) }, label: 'C', questIds: [questId(3)], spawns: here, mark: { ...available, difficulty: 'difficult' } };
    const [stack] = markers(buildSpawnLayer(ctx, 'available-quests', { groups: [a, b] }, view(1)));
    expect(stack).toMatchObject({ count: 2, mark: available });
    const [mixed] = markers(buildSpawnLayer(ctx, 'available-quests', { groups: [a, b, c] }, view(1)));
    expect(mixed?.mark).toEqual({ state: 'available', difficulty: null, dungeonQuest: false, progress: null });
  });

  const KALIMDOR_POINT = (x: number, y: number): WorldPoint => ({ mapId: KALIMDOR_MAP, x, y });
  const counted = (quest: number, n: number) => ({
    id: `count:${String(quest)}:npc:5:${String(n)}`,
    questId: questId(quest),
    point: KALIMDOR_POINT(-500 - n, -4000),
    label: `Boar · kill for Q${String(quest)} · 3 spawns in Durotar`,
    ref: { kind: 'spawn' as const, subject: { kind: 'npc' as const, id: npcId(5) }, spawnIndex: 0, questIds: [questId(quest)] },
  });
  const ring = [KALIMDOR_POINT(-600, -4100), KALIMDOR_POINT(-500, -4100), KALIMDOR_POINT(-550, -4000)];
  const log = {
    counted: [counted(7, 0), counted(8, 1)],
    areas: [
      { id: 'area:7:1:1411:0', questId: questId(7), mapId: KALIMDOR_MAP, ring, labelStep: stepId('s-9'), labelTurnIn: true, label: 'Objectives of Q7', uiMapId: uiMapId(1411) },
      { id: 'area:9:0:1453:0', questId: questId(9), mapId: worldMapId(0), ring: ring.map((p) => ({ ...p, mapId: worldMapId(0) })), labelStep: null, labelTurnIn: false, label: 'Objectives of Q9', uiMapId: null },
    ],
  };
  const layers = () => createMapLayers({ geometry });
  const objectivesAt = (zoom: number, focus: readonly QuestId[] = [], logInput: typeof log | null = log) =>
    layers().part({ layer: 'objectives', input: { groups: [] }, focusQuests: focus, rawZone: null, log: logInput }, view(1, zoom)).finish();

  it('draws the log’s outlines and counted marks at the zone band only, the counted marks muted with the objective state', () => {
    const zone = objectivesAt(ZONE_ZOOM);
    expect(ids(zone)).toEqual(['area:7:1:1411:0', 'count:7:npc:5:0', 'count:8:npc:5:1']);
    expect(byId(zone, 'area:7:1:1411:0')).toEqual({
      type: 'area',
      id: 'area:7:1:1411:0',
      mapId: KALIMDOR_MAP,
      ring,
      style: 'objective-area',
      labelStep: stepId('s-9'),
      labelTurnIn: true,
      label: 'Objectives of Q7',
      ref: { kind: 'zone', uiMapId: uiMapId(1411) },
    });
    expect(byId(zone, 'count:7:npc:5:0')).toMatchObject({ kind: 'objective', style: 'muted', count: 1, mark: { state: 'objective' }, label: 'Boar · kill for Q7 · 3 spawns in Durotar' });
    expect(ids(objectivesAt(CONTINENT_ZOOM))).toEqual([]);
  });

  it('leaves out a focused quest’s counted marks (its points are raw) but keeps its outline', () => {
    expect(ids(objectivesAt(ZONE_ZOOM, [questId(7)]))).toEqual(['area:7:1:1411:0', 'count:8:npc:5:1']);
  });

  it('caps the counted marks at 50 of the budget, nearest the centre first, and counts the rest as not drawn', () => {
    const many = { counted: Array.from({ length: 60 }, (_, n) => counted(100 + n, n)), areas: [] };
    const content = layers().part({ layer: 'objectives', input: { groups: [] }, focusQuests: [], rawZone: null, log: many }, view(1, ZONE_ZOOM, { x: -500, y: -4000 })).finish();
    expect(content.items).toHaveLength(50);
    expect(content.stats.notDrawn).toBe(10);
    // The nearest to (-500, -4000) are the ones with the smallest n.
    expect(ids(content)).toContain('count:100:npc:5:0');
    expect(ids(content)).not.toContain('count:159:npc:5:59');
  });

  it('rebuilds nothing when the log input is the same object', () => {
    const builder = layers();
    const call = { layer: 'objectives' as const, input: { groups: [] }, focusQuests: [], rawZone: null, log };
    const first = builder.part(call, view(1)).finish();
    expect(builder.part({ ...call }, view(1)).finish()).toBe(first);
    expect(builder.part({ ...call, log: { ...log } }, view(1)).finish().items).toBe(first.items);
  });
});

describe('the log’s objectives under the budget (map-presentation.md §7.4)', () => {
  it('keeps the outlines and counted marks before a focused quest’s raw points, which fill the rest nearest first', () => {
    const KP = (x: number, y: number): WorldPoint => ({ mapId: KALIMDOR_MAP, x, y });
    const raw: PointGroupInput = {
      subject: { kind: 'npc', id: npcId(77) },
      label: 'Raw',
      questIds: [questId(1)],
      spawns: Array.from({ length: 520 }, (_, n) => ({ source: zoneSourcedPoint(uiMapId(1411), 50, 50), world: KP(-4000 + n, -4000), uiMapId: uiMapId(1411) })),
    };
    const log = {
      counted: [{ id: 'count:2:npc:5:x', questId: questId(2), point: KP(900, 900), label: 'far', ref: { kind: 'spawn' as const, subject: { kind: 'npc' as const, id: npcId(5) }, spawnIndex: 0, questIds: [questId(2)] } }],
      areas: [{ id: 'area:2:x:0', questId: questId(2), mapId: KALIMDOR_MAP, ring: [KP(1000, 1000), KP(1100, 1000), KP(1050, 1100)], labelStep: null, labelTurnIn: false, label: 'far', uiMapId: null }],
    };
    const content = createMapLayers({ geometry }).part({ layer: 'objectives', input: { groups: [raw] }, focusQuests: [questId(1)], rawZone: null, log }, view(1, ZONE_ZOOM, { x: -4000, y: -4000 })).finish();
    expect(content.items).toHaveLength(500);
    expect(ids(content)).toContain('area:2:x:0');
    expect(ids(content)).toContain('count:2:npc:5:x');
    expect(content.stats.notDrawn).toBe(22);
  });
});


/*
 * The place layers (map-presentation.md §8 to §10, §25.4; steps MP.5, MP.8, MP.9): descriptors the
 * derived pipeline's places model builds, kept by the builder to the view's map, the band's rule of
 * the flight network, and the cap.
 */
describe('place layers: dungeons, flight points, the flight network, transports', () => {
  const pin = (id: string, mapId: WorldMapId, x: number, y: number, category: MapCategoryId): MarkerDescriptor => ({
    type: 'marker',
    id,
    point: { mapId, x, y },
    kind: 'transition',
    style: 'neutral',
    emphasis: 'normal',
    label: id,
    badges: [],
    ref: { kind: 'dungeon', dungeon: 1, entrance: 0 },
    count: 1,
    refs: [{ kind: 'dungeon', dungeon: 1, entrance: 0 }],
    labels: [id],
    mark: { state: 'dungeon', difficulty: null, dungeonQuest: false, progress: null },
    category,
  });
  const flight = (a: number, b: number, mapId: WorldMapId, route = false): PlaceItem => ({
    descriptor: {
      type: 'polyline',
      id: `flight:${String(a)}-${String(b)}`,
      mapId,
      points: [
        { mapId, x: a, y: 0 },
        { mapId, x: b, y: 0 },
      ],
      style: 'network-flight',
      emphasis: 'normal',
      label: 'Flight',
      ref: { kind: 'taxi-edge', from: a, to: b },
    },
    nodes: [a, b],
    ...(route ? { route: true } : {}),
  });
  const ride: PlaceItem = {
    descriptor: {
      type: 'connector',
      id: 'ride:1:1',
      from: { mapId: MAP_1, x: 0, y: 0 },
      to: { mapId: MAP_0, x: 0, y: 0 },
      style: 'transport',
      emphasis: 'normal',
      label: 'Boat',
      ref: { kind: 'transport', path: 1, stop: null },
    },
  };

  it('keeps the items of the view’s map and counts those of maps the surface does not show', () => {
    const layers = createMapLayers({ geometry });
    const places: PlaceLayerInput = { items: [{ descriptor: pin('a', MAP_1, 0, 0, 'dungeons') }, { descriptor: pin('b', MAP_0, 0, 0, 'raids') }], unplaced: 1 };
    const content = layers.part({ layer: 'dungeons', places }, view(1)).finish();
    expect(ids(content)).toEqual(['a']);
    expect(content.stats).toMatchObject({ drawn: 1, otherSurfaces: 1 });
    // Not built yet: nothing drawn.
    expect(layers.part({ layer: 'transports', places: null }, view(1)).finish().items).toEqual([]);
  });

  it('draws the flight points from the places model instead of the dataset’s flight masters', () => {
    const layers = createMapLayers({ geometry });
    const places: PlaceLayerInput = { items: [{ descriptor: pin('flight:npc:1', MAP_1, 5, 5, 'flight-points'), node: 25 }], unplaced: 0 };
    const call = { layer: 'flight-masters' as const, input: { groups: [] }, focusQuests: [], rawZone: null, places };
    expect(ids(layers.part(call, view(1)).finish())).toEqual(['flight:npc:1']);
    expect(ids(layers.part({ ...call, places: null }, view(1)).finish())).toEqual([]);
  });

  it('draws the whole network out to the continent band, and zoomed in only the focused points’ and the route’s flights (§25.4)', () => {
    const places: PlaceLayerInput = { items: [flight(1, 2, MAP_1), flight(2, 3, MAP_1), flight(3, 4, MAP_1, true), flight(5, 6, MAP_1)], unplaced: 0 };
    const layers = createMapLayers({ geometry });
    const at = (zoom: number, focusNodes: readonly number[], allFlights = false) => ids(layers.part({ layer: 'flight-network', places, focusNodes, allFlights }, view(1, zoom)).finish());
    expect(at(CONTINENT_ZOOM, [])).toEqual(['flight:1-2', 'flight:2-3', 'flight:3-4', 'flight:5-6']);
    expect(at(ZONE_ZOOM, [])).toEqual(['flight:3-4']);
    expect(at(ZONE_ZOOM, [2])).toEqual(['flight:1-2', 'flight:2-3', 'flight:3-4']);
    expect(at(0, [6])).toEqual(['flight:3-4', 'flight:5-6']);
    expect(at(ZONE_ZOOM, [], true)).toEqual(['flight:1-2', 'flight:2-3', 'flight:3-4', 'flight:5-6']);
    expect(flightsKept('continent', [1], false)).toBeNull();
    expect(flightsKept('zone', [1], true)).toBeNull();
    expect(flightsKept('close', [1], false)?.(flight(1, 9, MAP_1))).toBe(true);
  });

  it('keeps the route’s flights first under the cap', () => {
    const many: PlaceItem[] = Array.from({ length: 160 }, (_, i) => flight(i * 2, i * 2 + 1, MAP_1, i === 159));
    const layers = createMapLayers({ geometry });
    const content = layers.part({ layer: 'flight-network', places: { items: many, unplaced: 0 }, focusNodes: [], allFlights: false }, view(1, CONTINENT_ZOOM)).finish();
    expect(content.items).toHaveLength(150);
    expect(ids(content)).toContain('flight:318-319');
    expect(content.stats.notDrawn).toBe(10);
  });

  it('draws a ride between the continents only on the atlas, once, by the map it leaves', () => {
    const places: PlaceLayerInput = { items: [ride], unplaced: 0 };
    const layers = createMapLayers({ geometry: atlasGeometry });
    expect(idsIn(layers.part({ layer: 'transports', places }, atlasView(MAP_1)).finish())).toEqual(['ride:1:1']);
    expect(idsIn(layers.part({ layer: 'transports', places }, atlasView(MAP_0)).finish())).toEqual([]);
    // Only the Eastern Kingdoms active: it draws the arc.
    expect(idsIn(layers.part({ layer: 'transports', places }, atlasView(MAP_0, [MAP_0])).finish())).toEqual(['ride:1:1']);
    expect(idsIn(createMapLayers({ geometry: atlasGeometry }).part({ layer: 'transports', places }, worldView(MAP_1)).finish())).toEqual([]);
  });
});
