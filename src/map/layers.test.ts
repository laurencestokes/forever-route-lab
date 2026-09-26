import { describe, expect, it, vi } from 'vitest';
import type { SpawnPoint } from '../domain/dataset';
import { areaId, npcId, objectId, questId, sequentialIdSource, stepId, uiMapId, worldMapId, type QuestId } from '../domain/ids';
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
import { DUROTAR, EASTERN_KINGDOMS, fixtureGeometry, FIXTURE_MAPS, KALIMDOR } from '../geo/test-fixtures';
import type {
  AggregateDescriptor,
  ArtInput,
  LayerContent,
  LegStyle,
  MapDescriptor,
  MapView,
  MarkerDescriptor,
  OutlineDescriptor,
  OutlineInput,
  PointGroupInput,
  PolylineDescriptor,
  ReliefInput,
  RouteInput,
  RouteLeg,
  RoutePathsInput,
  RouteStepInput,
  SpawnLayerInput,
  StepPlacement,
} from './adapter';
import {
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
  LAYER_STATS_UNITS,
  layerContextOf,
  layerStatsNotes,
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

describe('level of detail settings', () => {
  it('defaults to zone detail at -3.5 and a 2,500-path cap (M3 review PERF-3), with budgets inside the cap', () => {
    expect(DEFAULT_LOD.zoneZoom).toBe(-3.5);
    expect(DEFAULT_LOD.pathCapPerSurface).toBe(2500);
    expect(lodProblems(DEFAULT_LOD)).toEqual([]);
    const canvas = Object.entries(DEFAULT_LOD.budgets)
      .filter(([layer]) => layer !== 'art' && layer !== 'relief')
      .reduce((sum, [, budget]) => sum + budget, 0);
    expect(canvas).toBeLessThanOrEqual(DEFAULT_LOD.pathCapPerSurface);
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
    expect(createLod({ budgets: { art: 10_000 } }).budgets.art).toBe(10_000);
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
  it('folds points into one aggregate per zone at their centroid', () => {
    const content = buildSpawnLayer(ctx, 'available-quests', givers, view(1, CONTINENT_ZOOM));
    expect(ids(content)).toEqual(['agg:available-quests:1411', 'agg:available-quests:1413']);
    const durotar = byId(content, 'agg:available-quests:1411') as AggregateDescriptor;
    expect(durotar).toMatchObject({ type: 'aggregate', layer: 'available-quests', count: 4, subjects: 2 });
    expect(durotar.label).toBe('Durotar: 2 quest givers at 4 points; zoom in to see them');
    expect(durotar.ref).toEqual({ kind: 'aggregate', layer: 'available-quests', mapId: 1, uiMapId: 1411, count: 4 });
    const points = [many.spawns[0], many.spawns[3], many.spawns[7], gornek.spawns[0]].map((spawn) => spawn?.world);
    const mean = (pick: (p: WorldPoint) => number): number => points.reduce((sum, p) => sum + (p === null || p === undefined ? 0 : pick(p)), 0) / 4;
    expect(durotar.point.x).toBeCloseTo(mean((p) => p.x), 9);
    expect(durotar.point.y).toBeCloseTo(mean((p) => p.y), 9);
    expect(content.stats).toMatchObject({ drawn: 2, aggregated: 5, unresolved: 3, otherSurfaces: 1 });
  });

  it('keeps the focused quest’s points raw at any zoom', () => {
    const content = buildSpawnLayer(ctx, 'available-quests', givers, view(1, CONTINENT_ZOOM), [GORNEK_QUEST]);
    expect(ids(content)).toEqual(['agg:available-quests:1411', 'agg:available-quests:1413', 'spawn:npc:3143:0']);
    expect(byId(content, 'agg:available-quests:1411')).toMatchObject({ count: 3, subjects: 1 });
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
    expect(layerStatsNotes(content.stats, 'available-quests')[0]).toBe('3 more markers not drawn: zoom in or pan to see them');
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
    const continent = layers.spawns('available-quests', givers, view(1, CONTINENT_ZOOM));
    const jumped = layers.spawns('available-quests', givers, view(1, CONTINENT_ZOOM), [], uiMapId(1411));
    expect(jumped).not.toBe(continent);
    expect(ids(jumped)).toEqual(['agg:available-quests:1413', 'spawn:npc:100:0', 'spawn:npc:100:3', 'spawn:npc:100:7', 'spawn:npc:3143:0']);
    expect(markers(jumped).every((m) => m.emphasis === 'normal')).toBe(true);
    expect(jumped.stats).toMatchObject({ aggregated: 1 });
    expect(buildSpawnLayer(ctx, 'available-quests', givers, view(1, CONTINENT_ZOOM), [], uiMapId(1411))).toEqual(jumped);
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

describe('layerStatsNotes', () => {
  const stats = {
    drawn: 10,
    notDrawn: 1234,
    aggregated: 1,
    unresolved: 12,
    unresolvedBy: { 'instance-without-entrance': 10, 'unmapped-area': 2 },
    otherSurfaces: 3,
  } as const;

  it('explains what a layer leaves out, always naming the unit (M3 review MAP-HONEST-5)', () => {
    expect(layerStatsNotes(stats, 'available-quests')).toEqual([
      '1,234 more markers not drawn: zoom in or pan to see them',
      '1 point shown as zone counts: zoom in to see them',
      '12 points not placed: 10 inside an instance with no known entrance, 2 in an area no map shows',
      '3 points on other world maps',
    ]);
    expect(layerStatsNotes({ drawn: 1, notDrawn: 0, aggregated: 0, unresolved: 0, unresolvedBy: {}, otherSurfaces: 0 }, 'route-steps')).toEqual([]);
  });

  it('uses each layer’s units, or one noun given for every count', () => {
    const one = { ...stats, notDrawn: 1, unresolved: 1, unresolvedBy: { 'destination-unknown': 1 }, otherSurfaces: 1 };
    expect(layerStatsNotes(one, 'route-steps')).toEqual([
      '1 more step marker not drawn: zoom in or pan to see them',
      '1 point shown as zone counts: zoom in to see them',
      '1 step not placed: 1 moving somewhere the route does not say',
      '1 step on other world maps',
    ]);
    expect(layerStatsNotes(stats, 'route-line').at(-1)).toBe('3 lines and glyphs on other world maps');
    expect(layerStatsNotes(stats, ['quest', 'quests']).at(-1)).toBe('3 quests on other world maps');
    for (const units of Object.values(LAYER_STATS_UNITS)) for (const [a, b] of Object.values(units)) expect(a !== '' && b !== '').toBe(true);
  });

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

    it('take one path each of the 2,500-path cap: the canvas budgets still sum to it', () => {
      expect(DEFAULT_LOD.budgets).toMatchObject({ relief: 1, art: 16, coastline: 1, 'zone-outlines': 1, 'zone-frames': 98 });
      const canvas = Object.entries(DEFAULT_LOD.budgets).reduce((sum, [layer, budget]) => sum + (layer === 'art' || layer === 'relief' ? 0 : budget), 0);
      expect(canvas).toBe(DEFAULT_LOD.pathCapPerSurface);
      expect(layerStatsNotes(buildZoneOutlines(ctx, [zones], view(1)).stats, 'zone-outlines')).toEqual([]);
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
      const content = buildSpawnLayer(ctx, 'available-quests', input, view(1, -5));
      expect(ids(content)).toEqual(['agg:available-quests:1411', 'agg:available-quests:map-1']);
      expect(content.items.find((item) => item.id === 'agg:available-quests:map-1')).toMatchObject({
        label: 'No zone: 2 quest givers at 2 points; zoom in to see them',
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
      expect(ids(buildSpawnLayer(ctx, 'turn-ins', { groups: [npc] }, view(1, -5)))).toEqual(['agg:turn-ins:map-1']);
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
      expect(all.length).toBeGreaterThan(DEFAULT_LOD.budgets['route-line']);
      expect(all.every((line) => line.points.length >= 2 && line.points.length <= ROUTE_PIECE_MAX_VERTICES)).toBe(true);
      for (let i = 1; i < all.length; i += 1) expect(all[i]?.points[0]).toEqual(all[i - 1]?.points.at(-1));
      // Every step point and path point is drawn exactly once, apart from the shared ends.
      const vertices = all.reduce((sum, line) => sum + line.points.length, 0) - (all.length - 1);
      expect(vertices).toBe(2000 + 1999 * 20);
      expect(new Set(all.map((line) => line.id)).size).toBe(all.length);
      // With the default budgets the layer draws its 150 paths and counts the rest.
      const capped = buildRouteLine(ctx, route, view(), paths);
      expect(capped.stats).toMatchObject({ drawn: DEFAULT_LOD.budgets['route-line'], notDrawn: all.length - DEFAULT_LOD.budgets['route-line'] });
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
