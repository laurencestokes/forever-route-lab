import {
  createEmptyProject,
  type DatasetView,
  type EntityRef,
  type ItemRecord,
  type Location,
  makeAcceptStep,
  makeCompleteStep,
  makeNoteStep,
  makeTravelStep,
  makeTurnInStep,
  npcId,
  type NpcId,
  type NpcRecord,
  type ObjectRecord,
  type ProjectV1,
  questId,
  type QuestRecord,
  type RecordProvenance,
  type RouteStep,
  sequentialIdSource,
  type SpawnPoint,
  uiMapId,
  type UiMapId,
  worldMapId,
  type WorldMapId,
  worldSourcedPoint,
  type ZoneInfo,
  zoneSourcedPoint,
} from '../domain';
import type { MapGeometry } from '../geo';
import { fixtureGeometry } from '../geo/test-fixtures';
import {
  boundsCenter,
  surfaceIdOf,
  surfaceMapId,
  type FitOptions,
  type FocusOptions,
  type HighlightTarget,
  type LayerContent,
  type LayerId,
  type MapAdapter,
  type MapAdapterFactory,
  type MapAdapterOptions,
  type MapContainer,
  type MapEvent,
  type MapEventType,
  type MapRenderStats,
  type MapViewState,
  type SurfaceId,
  type Viewport,
  type WorldBounds,
} from '../map/adapter';
import { type DatasetSource, staticDatasetSource } from './dataset-source';

/**
 * Test support for the map controller and the map panel (not imported by application code): a
 * stub `DatasetView` over hand-written records, and a fake `MapAdapter` that records every call,
 * keeps a view it moves on fits and focuses, and emits events like the Leaflet adapter does.
 */

// Dataset stubs ------------------------------------------------------------------------------

const PROVENANCE: RecordProvenance = { upstreamDiff: 'era', foreverStatus: 'unknown', corrected: false, created: false, source: 'questiedb' };

export function stubQuest(fields: Partial<QuestRecord> & Pick<QuestRecord, 'id' | 'name'>): QuestRecord {
  return {
    level: 1,
    minLevel: 1,
    maxLevel: null,
    races: null,
    classes: null,
    zoneOrSort: null,
    dungeonQuest: false,
    starters: [],
    finishers: [],
    objectives: [],
    objectiveHints: [],
    objectivesText: null,
    prerequisites: {
      preQuestSingle: [],
      preQuestGroup: [],
      exclusiveTo: [],
      nextQuestInChain: null,
      parentQuest: null,
      childQuests: [],
      inGroupWith: [],
      breadcrumbForQuestId: null,
      breadcrumbs: [],
      availableUntilCompleted: null,
      availableStartingWith: null,
      disabledByQuest: null,
    },
    requirements: {
      skill: null,
      minReputation: null,
      maxReputation: null,
      spell: null,
      specialization: null,
      sourceItemId: null,
      requiredSourceItems: [],
    },
    reputationReward: [],
    flags: { repeatable: false, needsEvent: false, questFlags: 0, specialFlags: 0 },
    xp: null,
    provenance: PROVENANCE,
    ...fields,
  };
}

export function stubNpc(fields: Partial<NpcRecord> & Pick<NpcRecord, 'id' | 'name'>): NpcRecord {
  return {
    subName: null,
    minLevel: null,
    maxLevel: null,
    rank: null,
    zoneId: null,
    npcFlags: 0,
    friendlyTo: null,
    questStarts: [],
    questEnds: [],
    provenance: PROVENANCE,
    ...fields,
  };
}

export function stubObject(fields: Partial<ObjectRecord> & Pick<ObjectRecord, 'id' | 'name'>): ObjectRecord {
  return { zoneId: null, factionId: null, questStarts: [], questEnds: [], provenance: PROVENANCE, ...fields };
}

export function stubItem(fields: Partial<ItemRecord> & Pick<ItemRecord, 'id' | 'name'>): ItemRecord {
  return { itemClass: null, dropNpcs: [], dropObjects: [], dropItems: [], startsQuest: null, provenance: PROVENANCE, ...fields };
}

/** A spawn with a world point (as the dataset view gives them after conversion). */
export function worldSpawn(mapId: WorldMapId, x: number, y: number, uiMapId: UiMapId): SpawnPoint {
  return { source: zoneSourcedPoint(uiMapId, 50, 50), world: { mapId, x, y }, uiMapId };
}

/** A spawn inside an instance with no known entrance (no world point). */
export const instanceSpawn = (areaId: number): SpawnPoint => ({ source: { kind: 'instance', areaId: areaId as never }, world: null, uiMapId: null });

export interface StubDatasetParts {
  readonly quests?: readonly QuestRecord[];
  readonly npcs?: readonly NpcRecord[];
  readonly objects?: readonly ObjectRecord[];
  readonly items?: readonly ItemRecord[];
  /** Keyed `npc:<id>` or `object:<id>`. */
  readonly spawns?: Readonly<Record<string, readonly SpawnPoint[]>>;
  readonly zones?: readonly ZoneInfo[];
}

export function stubDataset(parts: StubDatasetParts): DatasetView {
  const quests = [...(parts.quests ?? [])].sort((a, b) => a.id - b.id);
  const byQuest = new Map(quests.map((q) => [q.id, q]));
  const npcs = new Map((parts.npcs ?? []).map((n) => [n.id, n]));
  const objects = new Map((parts.objects ?? []).map((o) => [o.id, o]));
  const items = new Map((parts.items ?? []).map((i) => [i.id, i]));
  const spawns = parts.spawns ?? {};
  const zones = parts.zones ?? [];
  return {
    identity: { dataRevision: 'stub', frameBuild: '1.60.1.69893', upstreamCommit: 'none', foreverContentVerified: false },
    quest: (id) => byQuest.get(id),
    npc: (id) => npcs.get(id),
    object: (id) => objects.get(id),
    item: (id) => items.get(id),
    quests: () => quests,
    spawns: (ref: EntityRef) => (ref.kind === 'item' ? [] : (spawns[`${ref.kind}:${String(ref.id)}`] ?? [])),
    zone: (id) => zones.find((z) => z.uiMapId === id),
    zones: () => zones,
  };
}

// Fake adapter --------------------------------------------------------------------------------

export type FakeCall =
  | { readonly kind: 'mount' }
  | { readonly kind: 'destroy' }
  | { readonly kind: 'setLayer'; readonly layer: LayerId; readonly content: LayerContent }
  | { readonly kind: 'toggleLayer'; readonly layer: LayerId; readonly visible: boolean }
  | { readonly kind: 'setSurface'; readonly surface: SurfaceId }
  | { readonly kind: 'fitBounds'; readonly bounds: WorldBounds; readonly options: FitOptions }
  | { readonly kind: 'focus'; readonly point: { readonly mapId: WorldMapId; readonly x: number; readonly y: number }; readonly options: FocusOptions }
  | { readonly kind: 'setViewport'; readonly viewport: Viewport }
  | { readonly kind: 'highlight'; readonly target: HighlightTarget | null };

export interface FakeAdapter extends MapAdapter {
  readonly options: MapAdapterOptions;
  readonly calls: FakeCall[];
  /** The last content given to each layer. */
  readonly contents: Map<LayerId, LayerContent>;
  readonly mounted: () => boolean;
  /** Emits an event to the registered handlers, as the Leaflet adapter would. */
  emit(event: MapEvent): void;
  /** Moves the view (as a pan or zoom by the user would) and emits `zoom` (when it changed) and `move`. */
  pan(to: { readonly x?: number; readonly y?: number; readonly zoom?: number }): void;
  /** Calls of one kind. */
  callsOf<K extends FakeCall['kind']>(kind: K): Extract<FakeCall, { readonly kind: K }>[];
}

export interface FakeAdapterSettings {
  /** The zoom a fit lands on (default -2, zone zoom); a fit's `minZoom` raises it. */
  readonly fitZoom?: number;
  /** The zoom a surface opens at (default -5, continent zoom). */
  readonly surfaceZoom?: number;
  /** Throw from `mount` (an engine that fails to start). */
  readonly failMount?: string;
}

export function createFakeAdapter(options: MapAdapterOptions, settings: FakeAdapterSettings = {}): FakeAdapter {
  const calls: FakeCall[] = [];
  const contents = new Map<LayerId, LayerContent>();
  const visible = new Map<LayerId, boolean>();
  const handlers = new Map<MapEventType, Set<(event: MapEvent) => void>>();
  const fitZoom = settings.fitZoom ?? -2;
  const surfaceZoom = settings.surfaceZoom ?? -5;
  let mounted = false;
  let surface: SurfaceId | null = options.initialSurface ?? options.surfaces[0]?.id ?? null;
  const views = new Map<SurfaceId, { x: number; y: number; zoom: number }>();
  let child: { remove(): void } | null = null;

  const viewOf = (id: SurfaceId): { x: number; y: number; zoom: number } => {
    const saved = views.get(id);
    if (saved !== undefined) return saved;
    const info = options.surfaces.find((s) => s.id === id);
    const center = info === undefined ? { x: 0, y: 0 } : boundsCenter(info.extent);
    const fresh = { x: center.x, y: center.y, zoom: surfaceZoom };
    views.set(id, fresh);
    return fresh;
  };

  const state = (): MapViewState | null => {
    if (!mounted || surface === null) return null;
    const view = viewOf(surface);
    const mapId = surfaceMapId(surface);
    return {
      surface,
      mapId,
      center: { mapId, x: view.x, y: view.y },
      zoom: view.zoom,
      bounds: { mapId, xMin: view.x - 100, xMax: view.x + 100, yMin: view.y - 100, yMax: view.y + 100 },
      widthPx: 800,
      heightPx: 600,
    };
  };

  const emit = (event: MapEvent): void => {
    for (const handler of [...(handlers.get(event.type) ?? [])]) handler(event);
  };

  const emitMove = (zoomChanged: boolean): void => {
    const view = state();
    if (view === null) return;
    if (zoomChanged) emit({ type: 'zoom', view });
    emit({ type: 'move', view });
  };

  const switchTo = (id: SurfaceId): boolean => {
    if (!options.surfaces.some((s) => s.id === id)) return false;
    if (id === surface) return true;
    surface = id;
    const view = state();
    if (view !== null) emit({ type: 'surface', surface: id, view });
    return true;
  };

  const moveTo = (id: SurfaceId, x: number, y: number, zoom: number): void => {
    const view = viewOf(id);
    const zoomChanged = view.zoom !== zoom;
    views.set(id, { x, y, zoom });
    if (surface === id) emitMove(zoomChanged);
  };

  const adapter: FakeAdapter = {
    options,
    calls,
    contents,
    mounted: () => mounted,
    emit,
    callsOf: <K extends FakeCall['kind']>(kind: K) => calls.filter((call): call is Extract<FakeCall, { readonly kind: K }> => call.kind === kind),
    pan(to) {
      if (surface === null) return;
      const view = viewOf(surface);
      moveTo(surface, to.x ?? view.x, to.y ?? view.y, to.zoom ?? view.zoom);
    },
    mount(el: MapContainer) {
      if (settings.failMount !== undefined) throw new Error(settings.failMount);
      calls.push({ kind: 'mount' });
      mounted = true;
      const doc = el.ownerDocument as { createElement?: (tag: string) => { className: string; remove(): void } } | null;
      if (doc?.createElement !== undefined) {
        const div = doc.createElement('div');
        div.className = 'frl-map fake-map';
        (el as unknown as { appendChild(node: unknown): void }).appendChild(div);
        child = div;
      }
    },
    destroy() {
      calls.push({ kind: 'destroy' });
      mounted = false;
      child?.remove();
      child = null;
    },
    setSurface(id) {
      calls.push({ kind: 'setSurface', surface: id });
      return switchTo(id);
    },
    getSurface: () => surface,
    setViewport(viewport) {
      calls.push({ kind: 'setViewport', viewport });
      const id = surfaceIdOf(viewport.center.mapId);
      if (!switchTo(id)) return false;
      moveTo(id, viewport.center.x, viewport.center.y, viewport.zoom);
      return true;
    },
    fitBounds(bounds, fit = {}) {
      calls.push({ kind: 'fitBounds', bounds, options: fit });
      const id = surfaceIdOf(bounds.mapId);
      if (!switchTo(id)) return false;
      const center = boundsCenter(bounds);
      // A fit that needs a zoom below the floor is centred at the floor instead (as the Leaflet adapter does).
      moveTo(id, center.x, center.y, Math.max(Math.min(fit.maxZoom ?? 2, fitZoom), fit.minZoom ?? -Infinity));
      return true;
    },
    setLayer(layer, content) {
      calls.push({ kind: 'setLayer', layer, content });
      contents.set(layer, content);
    },
    toggleLayer(layer, show) {
      calls.push({ kind: 'toggleLayer', layer, visible: show });
      visible.set(layer, show);
    },
    isLayerVisible: (layer) => visible.get(layer) ?? true,
    highlight(target) {
      calls.push({ kind: 'highlight', target });
    },
    focus(point, focus = {}) {
      calls.push({ kind: 'focus', point, options: focus });
      const id = surfaceIdOf(point.mapId);
      if (!switchTo(id)) return false;
      const view = viewOf(id);
      moveTo(id, point.x, point.y, focus.zoom ?? Math.max(view.zoom, -2));
      return true;
    },
    on(type, handler) {
      const set = handlers.get(type) ?? new Set();
      handlers.set(type, set);
      const wrapped = handler as (event: MapEvent) => void;
      set.add(wrapped);
      return () => {
        set.delete(wrapped);
      };
    },
    getView: state,
    resize: () => undefined,
    refreshTheme: () => undefined,
    renderStats(): MapRenderStats {
      return { surface, paths: 0, layers: {} as MapRenderStats['layers'] };
    },
  };
  return adapter;
}

/** A factory that makes fake adapters and keeps them, for assertions. */
export function fakeAdapterFactory(settings: FakeAdapterSettings = {}): { readonly factory: MapAdapterFactory; readonly adapters: FakeAdapter[] } {
  const adapters: FakeAdapter[] = [];
  return {
    adapters,
    factory: (options) => {
      const adapter = createFakeAdapter(options, settings);
      adapters.push(adapter);
      return adapter;
    },
  };
}

// A small map workspace ----------------------------------------------------------------------

export const MAP_TEST_KALIMDOR = worldMapId(1);
export const MAP_TEST_EASTERN_KINGDOMS = worldMapId(0);
export const MAP_TEST_DUROTAR = uiMapId(1411);
export const MAP_TEST_ORGRIMMAR = uiMapId(1454);

const worldLocation = (x: number, y: number, mapId: WorldMapId = MAP_TEST_KALIMDOR): Location => ({
  source: worldSourcedPoint(mapId, x, y),
  label: null,
  radius: null,
});

/**
 * Quests 1 "Gather" and 2 "Cull" from Gornek (NPC 10) in Durotar; Cull's objective is to kill
 * Boars (NPC 11) and it is turned in to Zureetha (NPC 12); Doras (NPC 20) is a Horde flight master
 * in Orgrimmar. Spawns carry world points on Kalimdor (map 1), inside the cited Durotar frame.
 */
export const MAP_TEST_DATASET: DatasetView = stubDataset({
  quests: [
    stubQuest({ id: questId(1), name: 'Gather', starters: [{ kind: 'npc', id: npcId(10) }], finishers: [{ kind: 'npc', id: npcId(10) }] }),
    stubQuest({
      id: questId(2),
      name: 'Cull',
      starters: [{ kind: 'npc', id: npcId(10) }],
      finishers: [{ kind: 'npc', id: npcId(12) }],
      objectives: [{ kind: 'kill', npcId: npcId(11), label: null, count: null }],
    }),
  ],
  npcs: [
    stubNpc({ id: npcId(10), name: 'Gornek' }),
    stubNpc({ id: npcId(11), name: 'Boar' }),
    stubNpc({ id: npcId(12), name: 'Zureetha' }),
    stubNpc({ id: npcId(20), name: 'Doras', npcFlags: 8, friendlyTo: 'H' }),
  ],
  spawns: {
    'npc:10': [worldSpawn(MAP_TEST_KALIMDOR, 0, -4000, MAP_TEST_DUROTAR)],
    'npc:11': [worldSpawn(MAP_TEST_KALIMDOR, 200, -4300, MAP_TEST_DUROTAR), worldSpawn(MAP_TEST_KALIMDOR, 220, -4320, MAP_TEST_DUROTAR)],
    'npc:12': [worldSpawn(MAP_TEST_KALIMDOR, 50, -4100, MAP_TEST_DUROTAR)],
    'npc:20': [worldSpawn(MAP_TEST_KALIMDOR, 1700, -4400, MAP_TEST_ORGRIMMAR)],
  },
  zones: [
    { uiMapId: MAP_TEST_DUROTAR, name: 'Durotar', worldMapId: MAP_TEST_KALIMDOR },
    { uiMapId: MAP_TEST_ORGRIMMAR, name: 'Orgrimmar', worldMapId: MAP_TEST_KALIMDOR },
  ],
});

/**
 * Seven steps: a note (no location); accept Gather and Cull; complete and turn in Cull (all four
 * placed in Durotar); a travel step with no destination; accept Gather in Eastern Kingdoms.
 */
export function mapTestSteps(): RouteStep[] {
  const ids = sequentialIdSource();
  return [
    makeNoteStep(ids, { text: 'Start' }),
    makeAcceptStep(ids, { questId: questId(1), location: worldLocation(0, -4000) }),
    makeAcceptStep(ids, { questId: questId(2), location: worldLocation(10, -4010) }),
    makeCompleteStep(ids, { targets: [{ questId: questId(2), objective: null }], location: worldLocation(200, -4300) }),
    makeTurnInStep(ids, { questId: questId(2), location: worldLocation(50, -4100) }),
    makeTravelStep(ids, {}),
    makeAcceptStep(ids, { questId: questId(1), location: worldLocation(-9000, 800, MAP_TEST_EASTERN_KINGDOMS) }),
  ];
}

/** Accept steps (quests 1, 2, 1, 2, …) at world points, for tests that need steps on given world maps. */
export function acceptStepsAt(points: readonly { readonly mapId: number; readonly x: number; readonly y: number }[]): RouteStep[] {
  const ids = sequentialIdSource();
  return points.map((point, index) =>
    makeAcceptStep(ids, { questId: questId(1 + (index % 2)), location: worldLocation(point.x, point.y, worldMapId(point.mapId)) }),
  );
}

export interface MapTestWorkspace {
  readonly project: ProjectV1;
  readonly steps: readonly RouteStep[];
  readonly data: DatasetSource;
  readonly dataset: DatasetView;
  /** The cited fixture geometry (src/geo/test-fixtures.ts): surfaces 0, 1 and 2991. */
  readonly geometry: MapGeometry;
}

/**
 * An Orc Warrior project over `mapTestSteps` (or `steps`), the stub dataset (or `dataset`, with its
 * flight masters) and the fixture geometry.
 */
export function mapTestWorkspace(
  steps: RouteStep[] = mapTestSteps(),
  nowIso = '2026-09-25T12:00:00.000Z',
  dataset: DatasetView = MAP_TEST_DATASET,
  flightMasters: readonly NpcId[] = [npcId(20)],
): MapTestWorkspace {
  const base = createEmptyProject({ ids: sequentialIdSource(), nowIso, name: 'Map test' });
  const project: ProjectV1 = {
    ...base,
    character: { ...base.character, faction: 'Horde', race: 'Orc', class: 'WARRIOR' },
    route: { ...base.route, name: 'Map test route', steps },
  };
  return { project, steps, data: staticDatasetSource(dataset, flightMasters), dataset, geometry: fixtureGeometry() };
}
