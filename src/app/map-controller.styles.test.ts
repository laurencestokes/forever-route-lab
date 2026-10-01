import { describe, expect, it, vi } from 'vitest';
import { sequentialIdSource, worldMapId, type RouteStep } from '../domain';
import { atlasHash, atlasPlacements } from '../geo/atlas';
import { ATLAS_LAYOUT } from '../geo/atlas-layout';
import { MINIMAP_TEMPLATE, syntheticIndex, TEST_TEMPLATE } from '../../tests/support/atlas-tiles';
import { createMapStyleSetting, MAP_LAYERS_STORAGE_KEY, MAP_STYLE_STORAGE_KEY, type AtlasIndexLoad, type KeyValueStorage, type MapResources, type MapStyleSetting, type TerrainManifestLoad } from '../infra/maps';
import type { LayerId, MapContainer, MapDescriptor, MapStyle } from '../map/adapter';
import type { ClustersOf } from '../map/layers';
import { fixedClock } from './clock';
import { createMapClusterer } from './map-clusters';
import { createMapController, type MapControllerOptions } from './map-controller';
import { acceptStepsAt, fakeAdapterFactory, mapTestWorkspace, type FakeAdapter } from './map-test-helpers';
import { createEditorStore } from './store';
import { ATLAS_TILES_NOTE, MAP_WORDING, MINIMAP_TILES_NOTE } from './map-wording';

/*
 * The two map styles in the controller (docs/research/map-atlas.md §21.2 to §21.4; steps MM.1 and
 * MM.9): one index per style, fetched only when that style is first shown; the chosen style from the
 * per-browser setting, read at the first mount, else the default (the minimap since MM.9); the old
 * style kept while the new one's index loads; the fallbacks of §21.4 with their messages; and the
 * setting never written by a fallback.
 */

const T0 = '2026-09-27T12:00:00.000Z';
const KALIMDOR = worldMapId(1);
const EL: MapContainer = { nodeType: 1, ownerDocument: null };
const HASH = (() => {
  const placements = atlasPlacements(mapTestWorkspace().geometry, ATLAS_LAYOUT);
  if (placements === null) throw new Error('no atlas');
  return atlasHash(placements, ATLAS_LAYOUT);
})();

const TERRAIN = {
  kind: 'loaded',
  manifest: {
    build: '1.60.1.70009',
    maps: [0, 1].map((id) => ({
      mapId: worldMapId(id),
      name: id === 0 ? 'Eastern Kingdoms' : 'Kalimdor',
      relief: { url: `./maps/terrain/${String(id)}/relief.png`, bounds: { mapId: worldMapId(id), xMin: -16000, xMax: 16000, yMin: -16000, yMax: 16000 }, width: 1, height: 1, ydPerPx: 17 },
      zones: null,
      coast: null,
    })),
  },
} as unknown as TerrainManifestLoad;

const loaded = (style: MapStyle): AtlasIndexLoad => ({
  kind: 'loaded',
  file: {
    index: syntheticIndex({ hash: HASH, style, stored: { [-8]: [[0, 0]] } }),
    style,
    urlTemplate: style === 'minimap' ? MINIMAP_TEMPLATE : TEST_TEMPLATE,
    layout: 'compact',
  },
});
const refusal = (style: MapStyle): string =>
  `maps/${style === 'minimap' ? 'minimap' : 'atlas'}/index.json: its atlasHash 0123456789ab… is not this build’s ${HASH.slice(0, 12)}… (the tiles were composed for other placements)`;
const refused = (style: MapStyle): AtlasIndexLoad => ({ kind: 'failed', reason: 'invalid', detail: refusal(style) });

/** Index loads the test resolves by hand, per style. */
function deferredIndexes() {
  const waiting = new Map<MapStyle, (load: AtlasIndexLoad) => void>();
  const atlas = vi.fn((_hash: string, style: MapStyle = 'painted') => new Promise<AtlasIndexLoad>((resolve) => waiting.set(style, resolve)));
  const resolve = (style: MapStyle, load: AtlasIndexLoad): void => {
    const done = waiting.get(style);
    if (done === undefined) throw new Error(`no ${style} index requested`);
    waiting.delete(style);
    done(load);
  };
  const styles = (): readonly MapStyle[] => atlas.mock.calls.map((call) => call[1] ?? 'painted');
  return { atlas, resolve, styles };
}

/** A storage like `localStorage`, recording writes. */
function memoryStorage(initial: Readonly<Record<string, string>> = {}) {
  const values = new Map(Object.entries(initial));
  const writes: [string, string][] = [];
  const storage: KeyValueStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      writes.push([key, value]);
      values.set(key, value);
    },
  };
  return { storage, writes };
}

function setup(atlas: MapResources['atlas'], mapStyle: MapStyleSetting | null = null, extra: Partial<MapControllerOptions> = {}) {
  const steps: RouteStep[] = acceptStepsAt([{ mapId: 1, x: 0, y: -4000 }]);
  const workspace = mapTestWorkspace(steps, T0);
  const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(100), clock: fixedClock(T0) });
  const factory = fakeAdapterFactory();
  const resources: MapResources = {
    art: () => Promise.resolve({ kind: 'failed', reason: 'unavailable', detail: 'none' }),
    terrain: () => Promise.resolve(TERRAIN),
    arcs: () => Promise.resolve({ kind: 'failed', reason: 'unavailable', detail: 'none' }),
    ...(atlas === undefined ? {} : { atlas }),
  };
  const controller = createMapController({
    wording: MAP_WORDING,
    store,
    data: workspace.data,
    geometry: workspace.geometry,
    describeStep: (step, index) => `${String(index + 1)} · ${step.kind}`,
    timing: null,
    objectUrls: null,
    atlas: true,
    resources,
    mapStyle,
    ...extra,
  });
  controller.attach(factory.factory, EL);
  const adapter = factory.adapters[0];
  if (adapter === undefined) throw new Error('no adapter');
  // Over the middle of the atlas at the world band.
  adapter.pan({ mapId: KALIMDOR, x: 12778 - 13056, y: 5652 - 15360, zoom: -5 });
  return { controller, adapter, store };
}

const items = (adapter: FakeAdapter, layer: LayerId): readonly MapDescriptor[] => adapter.contents.get(layer)?.items ?? [];
const artIds = (adapter: FakeAdapter): readonly string[] => items(adapter, 'art').map((item) => item.id);
const artNotes = (controller: ReturnType<typeof setup>['controller']): readonly string[] => controller.getStatus().layers.find((entry) => entry.layer === 'art')?.notes ?? [];

describe('two map styles in the controller (map-atlas.md §21; MM.1)', () => {
  it('opens in the minimap style by default (MM.9) and fetches no painted index', async () => {
    const indexes = deferredIndexes();
    const s = setup(indexes.atlas);
    expect(s.adapter.options.style).toBe('minimap');
    expect(indexes.styles()).toEqual(['minimap']);
    expect(indexes.atlas).toHaveBeenCalledWith(HASH, 'minimap');
    indexes.resolve('minimap', loaded('minimap'));
    await vi.waitFor(() => {
      expect(artIds(s.adapter)).toEqual(['atlas-tiles:minimap']);
    });
    expect(s.controller.getStatus().style).toEqual({ chosen: 'minimap', shown: 'minimap', unavailable: null });
    expect(artNotes(s.controller)).toContain(MINIMAP_TILES_NOTE);
    expect(indexes.styles()).toEqual(['minimap']);
  });

  it('sends the tile band before building any other layer, so the first view’s images are asked for first (review MR-07)', async () => {
    const indexes = deferredIndexes();
    // The quest givers' clusters are asked for while their layer is built (the view is at the world
    // band): what the art layer holds then tells whether the band went first.
    let adapter: FakeAdapter | null = null;
    const artWhenBuilt: (readonly string[])[] = [];
    const clusterer = createMapClusterer();
    const clusters: ClustersOf = (layer, input) => {
      if (adapter !== null) artWhenBuilt.push(artIds(adapter));
      return clusterer.of(layer, input);
    };
    const s = setup(indexes.atlas, null, { clusters });
    adapter = s.adapter;
    const before = s.adapter.callsOf('setLayer').length;
    indexes.resolve('minimap', loaded('minimap'));
    await vi.waitFor(() => {
      expect(artIds(s.adapter)).toEqual(['atlas-tiles:minimap']);
    });
    const layers = s.adapter.callsOf('setLayer').slice(before).map((call) => call.layer);
    expect(layers[0]).toBe('art');
    // The givers were built after the band had been sent.
    expect(artWhenBuilt.at(-1)).toEqual(['atlas-tiles:minimap']);
    // And at a pan that changes other layers, the band (unchanged) is not sent again.
    const sent = s.adapter.callsOf('setLayer').length;
    s.adapter.pan({ zoom: -2 });
    expect(s.adapter.callsOf('setLayer').slice(sent).map((call) => call.layer)).not.toContain('art');
  });

  it('opens in the painted style when this browser chose it, and fetches no minimap index', async () => {
    const indexes = deferredIndexes();
    const { storage, writes } = memoryStorage({ [MAP_LAYERS_STORAGE_KEY]: '{"version":1,"style":"painted"}' });
    const s = setup(indexes.atlas, createMapStyleSetting(() => storage));
    expect(s.adapter.options.style).toBe('painted');
    expect(indexes.styles()).toEqual(['painted']);
    indexes.resolve('painted', loaded('painted'));
    await vi.waitFor(() => {
      expect(artIds(s.adapter)).toEqual(['atlas-tiles:painted']);
    });
    expect(s.controller.getStatus().style).toEqual({ chosen: 'painted', shown: 'painted', unavailable: null });
    expect(artNotes(s.controller)).toContain(ATLAS_TILES_NOTE);
    expect(indexes.styles()).toEqual(['painted']);
    expect(writes).toEqual([]);
  });

  it('opens in the style this browser chose, read at the first mount, and fetches the painted index only when it is shown', async () => {
    const indexes = deferredIndexes();
    const { storage, writes } = memoryStorage({ [MAP_STYLE_STORAGE_KEY]: 'minimap' });
    const s = setup(indexes.atlas, createMapStyleSetting(() => storage));
    expect(s.adapter.options.style).toBe('minimap');
    expect(indexes.styles()).toEqual(['minimap']);
    indexes.resolve('minimap', loaded('minimap'));
    await vi.waitFor(() => {
      expect(artIds(s.adapter)).toEqual(['atlas-tiles:minimap']);
    });
    const [band] = items(s.adapter, 'art');
    expect(band?.type === 'tiles' ? [band.style, band.urlTemplate, band.keepBuffer, band.underlayLevel] : null).toEqual(['minimap', MINIMAP_TEMPLATE, 1, -6]);
    expect(artNotes(s.controller)).toContain(MINIMAP_TILES_NOTE);
    expect(s.controller.getStatus().style).toEqual({ chosen: 'minimap', shown: 'minimap', unavailable: null });
    expect(writes).toEqual([]);

    // Switching: the painted index is fetched now; the minimap stays drawn while it loads.
    s.controller.setMapStyle('painted');
    expect(indexes.styles()).toEqual(['minimap', 'painted']);
    // Kept in the map's settings record (map-presentation.md §25.3.7; step MM.7); the earlier key is only read.
    expect(writes).toEqual([[MAP_LAYERS_STORAGE_KEY, '{"version":1,"style":"painted"}']]);
    expect(artIds(s.adapter)).toEqual(['atlas-tiles:minimap']);
    expect(s.controller.getStatus().style).toEqual({ chosen: 'painted', shown: 'minimap', unavailable: null });
    indexes.resolve('painted', loaded('painted'));
    await vi.waitFor(() => {
      expect(artIds(s.adapter)).toEqual(['atlas-tiles:painted']);
    });
    // Back again: no second fetch; the same band object as before, so the adapter's decoded keys serve it.
    s.controller.setMapStyle('minimap');
    expect(artIds(s.adapter)).toEqual(['atlas-tiles:minimap']);
    expect(items(s.adapter, 'art')[0]).toBe(band);
    expect(indexes.styles()).toEqual(['minimap', 'painted']);
  });

  it('ignores a stored value that is not a style, and never writes the default it falls back to', () => {
    const indexes = deferredIndexes();
    const { storage, writes } = memoryStorage({ [MAP_STYLE_STORAGE_KEY]: 'satellite' });
    const s = setup(indexes.atlas, createMapStyleSetting(() => storage));
    expect(s.controller.getStatus().style.chosen).toBe('minimap');
    expect(writes).toEqual([]);
    // A storage that throws (a private window, blocked storage) reads as none and writes nothing.
    const blocked = createMapStyleSetting(() => {
      throw new Error('SecurityError');
    });
    expect(blocked.read()).toBeNull();
    expect(() => {
      blocked.write('minimap');
    }).not.toThrow();
  });

  it('shows the painted style, and says why, when the minimap index is missing or refused (§21.4); the choice is kept', async () => {
    const indexes = deferredIndexes();
    const { storage, writes } = memoryStorage({ [MAP_STYLE_STORAGE_KEY]: 'minimap' });
    const s = setup(indexes.atlas, createMapStyleSetting(() => storage));
    indexes.resolve('minimap', refused('minimap'));
    // The painted index is fetched then, and drawn.
    await vi.waitFor(() => {
      expect(indexes.styles()).toEqual(['minimap', 'painted']);
    });
    indexes.resolve('painted', loaded('painted'));
    await vi.waitFor(() => {
      expect(artIds(s.adapter)).toEqual(['atlas-tiles:painted']);
    });
    const status = s.controller.getStatus();
    const message = `Minimap tiles unavailable: ${refusal('minimap')}; showing the painted map`;
    expect(status.style).toEqual({ chosen: 'minimap', shown: 'painted', unavailable: message });
    expect(status.problems).toContain(message);
    expect(writes).toEqual([]);
    expect(storage.getItem(MAP_STYLE_STORAGE_KEY)).toBe('minimap');
  });

  it('shows the painted style when the minimap’s first view fails (no tile pack), and tries the minimap again when chosen again', async () => {
    // The default style on a clone or build without the tile pack (map-atlas.md §21.4, §23.4).
    const indexes = deferredIndexes();
    const s = setup(indexes.atlas, null);
    indexes.resolve('minimap', loaded('minimap'));
    await vi.waitFor(() => {
      expect(artIds(s.adapter)).toEqual(['atlas-tiles:minimap']);
    });
    expect(indexes.styles()).toEqual(['minimap']);
    // The adapter reports that every image of the minimap's first view failed: the painted index is fetched and drawn.
    s.adapter.emit({ type: 'tiles', band: 'atlas-tiles:minimap', style: 'minimap', state: 'failed' });
    await vi.waitFor(() => {
      expect(indexes.styles()).toEqual(['minimap', 'painted']);
    });
    indexes.resolve('painted', loaded('painted'));
    await vi.waitFor(() => {
      expect(artIds(s.adapter)).toEqual(['atlas-tiles:painted']);
    });
    const why = 'Minimap tiles not downloaded (run `pnpm maps:minimap:fetch`); showing the painted map';
    expect(s.controller.getStatus().style).toEqual({ chosen: 'minimap', shown: 'painted', unavailable: why });
    expect(s.controller.getStatus().problems).toContain(why);
    // A ready report changes nothing; choosing the minimap again tries it again.
    s.adapter.emit({ type: 'tiles', band: 'atlas-tiles:painted', style: 'painted', state: 'ready' });
    expect(artIds(s.adapter)).toEqual(['atlas-tiles:painted']);
    s.controller.setMapStyle('minimap');
    expect(artIds(s.adapter)).toEqual(['atlas-tiles:minimap']);
    expect(s.controller.getStatus().style.unavailable).toBeNull();
    expect(indexes.styles()).toEqual(['minimap', 'painted']);
  });

  // Review MR-07: at 4× the index waited about 500 ms for the map's mount, after the map engine's chunk.
  it('asks for the chosen style’s index as soon as it is made, before the map is mounted, and only once', () => {
    const indexes = deferredIndexes();
    const { storage } = memoryStorage({ [MAP_LAYERS_STORAGE_KEY]: '{"version":1,"style":"painted"}' });
    const workspace = mapTestWorkspace(acceptStepsAt([{ mapId: 1, x: 0, y: -4000 }]), T0);
    const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(100), clock: fixedClock(T0) });
    const controller = createMapController({
      wording: MAP_WORDING,
      store,
      data: workspace.data,
      geometry: workspace.geometry,
      describeStep: () => 'step',
      timing: null,
      objectUrls: null,
      atlas: true,
      resources: { art: () => new Promise(() => undefined), terrain: () => new Promise(() => undefined), arcs: () => new Promise(() => undefined), atlas: indexes.atlas },
      mapStyle: createMapStyleSetting(() => storage),
    });
    expect(indexes.styles()).toEqual(['painted']);
    expect(indexes.atlas.mock.calls[0]?.[0]).toBe(HASH);
    controller.attach(fakeAdapterFactory().factory, EL);
    expect(indexes.styles()).toEqual(['painted']);
  });

  // Review MD-03: a deploy build has every tile (map-atlas.md §24.3), so its visitors are never told to run a developer command.
  it('names no developer command in a deploy build, where a failed first view is the network’s', async () => {
    const indexes = deferredIndexes();
    const s = setup(indexes.atlas, null, { deployBuild: true });
    indexes.resolve('minimap', loaded('minimap'));
    await vi.waitFor(() => {
      expect(artIds(s.adapter)).toEqual(['atlas-tiles:minimap']);
    });
    s.adapter.emit({ type: 'tiles', band: 'atlas-tiles:minimap', style: 'minimap', state: 'failed' });
    indexes.resolve('painted', loaded('painted'));
    await vi.waitFor(() => {
      expect(artIds(s.adapter)).toEqual(['atlas-tiles:painted']);
    });
    expect(s.controller.getStatus().style.unavailable).toBe('Minimap tiles could not be loaded; showing the painted map');
    expect(s.controller.getStatus().problems.join(' ')).not.toContain('pnpm');
  });

  it('draws the relief, and says why, when neither style can be drawn', async () => {
    const indexes = deferredIndexes();
    const s = setup(indexes.atlas);
    indexes.resolve('minimap', refused('minimap'));
    await vi.waitFor(() => {
      expect(indexes.styles()).toEqual(['minimap', 'painted']);
    });
    indexes.resolve('painted', refused('painted'));
    await vi.waitFor(() => {
      expect(s.controller.getStatus().problems.some((problem) => problem.startsWith('The atlas tiles could not be used (maps/minimap/index.json'))).toBe(true);
    });
    expect(artIds(s.adapter)).toEqual([]);
    expect(items(s.adapter, 'relief').map((item) => item.id)).toEqual(['relief:1', 'relief:0']);
    expect(s.controller.getStatus().style).toMatchObject({ chosen: 'minimap', shown: null });
  });

  it('keeps the chosen style when the minimap is drawn in the painted style’s place (the painted index refused)', async () => {
    const indexes = deferredIndexes();
    const { storage } = memoryStorage({ [MAP_LAYERS_STORAGE_KEY]: '{"version":1,"style":"painted"}' });
    const s = setup(indexes.atlas, createMapStyleSetting(() => storage));
    indexes.resolve('painted', refused('painted'));
    await vi.waitFor(() => {
      expect(indexes.styles()).toEqual(['painted', 'minimap']);
    });
    indexes.resolve('minimap', loaded('minimap'));
    await vi.waitFor(() => {
      expect(artIds(s.adapter)).toEqual(['atlas-tiles:minimap']);
    });
    expect(s.controller.getStatus().style.unavailable).toMatch(/^Painted map tiles unavailable: maps\/atlas\/index\.json: .*; showing the minimap$/);
  });

  it('asks again for an index that could not be fetched only at the next request, never in a loop (both styles HTTP 404)', async () => {
    const atlas = vi.fn((_hash: string, style: MapStyle = 'painted') => Promise.resolve<AtlasIndexLoad>({ kind: 'failed', reason: 'unavailable', detail: `maps/${style === 'minimap' ? 'minimap' : 'atlas'}/index.json: HTTP 404` }));
    const s = setup(atlas);
    await vi.waitFor(() => {
      expect(s.controller.getStatus().style.unavailable).toBe('Minimap tiles unavailable: maps/minimap/index.json: HTTP 404; showing the painted map');
    });
    // Let any further loads run: one fetch per style, the minimap's failure asking for the painted one's once.
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(atlas.mock.calls.map((call) => call[1])).toEqual(['minimap', 'painted']);
    // Choosing a style is a new request: the failed indexes are asked for again, once each, the chosen one first.
    s.controller.setMapStyle('painted');
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(atlas.mock.calls.map((call) => call[1])).toEqual(['minimap', 'painted', 'painted', 'minimap']);
  });
});
