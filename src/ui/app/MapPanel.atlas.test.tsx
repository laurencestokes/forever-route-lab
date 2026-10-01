// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEditorStore, fixedClock } from '../../app';
import { createMapController, type MapControllerOptions, type MapEngineSetup, type MapResources } from '../../app/map-exports';
import { acceptStepsAt, fakeAdapterFactory, mapTestWorkspace } from '../../app/map-test-helpers';
import { sequentialIdSource } from '../../app/shell-support';
import type { WorldMapId } from '../../domain';
import { syntheticIndex } from '../../../tests/support/atlas-tiles';
import { buildRouteView, mapStepLabel } from '../app-model';
import { ATLAS_LAYOUT_NOTE } from '../shell/MapKey';
import { loadMapLayersPanel } from './lazy';
import { atlasSurfaceLabel, MapPanel, MINIMAP_ART_NOTICE, SEPARATE_MAPS_GROUP, surfaceSwitcherOptions } from './MapPanel';

/*
 * The map panel with the atlas on (docs/research/map-atlas.md §8.5, §8.8; step ATL.5): the switcher
 * with the atlas, its presets and the separate maps, and the inset's note in the status line, the
 * key and the map's instructions. The atlas is the default since ATL.10, with the minimap style since
 * MM.9 (the last case, with no `atlas` option).
 */

afterEach(cleanup);

// The Map layers drawer is a lazy part (map-presentation.md §25.3.1) that production builds preload
// when idle; so do these tests. Loaded at the first open instead, the chunk can take over a second
// on a busy machine, longer than Testing Library waits by default.
beforeAll(async () => {
  await loadMapLayersPanel();
});

// ui may import only app and map/adapter values (ARCHITECTURE §4), so the test brands the id itself.
const worldMapId = (value: number): WorldMapId => value as WorldMapId;

const NOW = '2026-09-27T12:00:00.000Z';

function setup(extra: Partial<MapControllerOptions> = { atlas: true }) {
  const steps = acceptStepsAt([
    { mapId: 1, x: 0, y: -4000 },
    { mapId: 0, x: -8900, y: 500 },
    { mapId: 0, x: -8910, y: 500 },
  ]);
  const workspace = mapTestWorkspace(steps, NOW);
  const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(100), clock: fixedClock(NOW) });
  const fake = fakeAdapterFactory();
  const controller = createMapController({ store, data: workspace.data, geometry: workspace.geometry, describeStep: mapStepLabel, timing: null, objectUrls: null, ...extra });
  const setupMap: MapEngineSetup = { geometry: workspace.geometry, art: null, resources: extra.resources ?? null, loadAdapter: () => Promise.resolve(fake.factory) };
  const view = buildRouteView(store.getState().project.route, workspace.dataset, 1);
  render(<MapPanel store={store} view={view} activeRow={null} map={{ setup: setupMap, controller }} geometry="fixture geometry" announce={vi.fn()} />);
  return { store, controller, adapters: fake.adapters };
}

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('MapPanel on the atlas', () => {
  it('labels the atlas, the continents as presets, with their route steps, and fits a preset when shown', async () => {
    const s = setup();
    await settle();
    // The surface select went to the top bar's "Go to zone or view…" (map-presentation.md §25.3.0, step MP.4b);
    // the entries keep their labels here.
    expect(screen.queryByRole('combobox', { name: 'Map surface' })).toBeNull();
    const stepsOn = (mapIds: readonly number[]) => [1, 0, 0].filter((mapId) => mapIds.includes(mapId)).length;
    const options = surfaceSwitcherOptions(s.controller.surfaces, s.controller.presets, stepsOn);
    expect(options.map((entry) => ('group' in entry ? [entry.group, ''] : [entry.value, entry.label]))).toEqual([
      ['atlas', `${atlasSurfaceLabel('Azeroth', ['Zephras Isle'])} · 3 route steps`],
      ['preset:1', 'Kalimdor · 1 route step'],
      ['preset:0', 'Eastern Kingdoms · 2 route steps'],
    ]);
    expect(atlasSurfaceLabel('Azeroth', ['Zephras Isle'])).toBe('Azeroth (both continents; Zephras Isle inset)');
    const fits = s.adapters[0]?.callsOf('fitBounds').length ?? 0;
    act(() => {
      s.controller.showPreset('preset:0');
    });
    expect(s.adapters[0]?.callsOf('fitBounds')).toHaveLength(fits + 1);
    expect(s.adapters[0]?.callsOf('fitBounds').at(-1)?.bounds.mapId).toBe(0);
    expect(s.adapters[0]?.getSurface()).toBe('atlas');
  });

  it('says where Zephras Isle is in the drawer’s notices, the key and the map’s instructions', async () => {
    setup();
    await settle();
    expect(document.body.textContent).toContain('Route map: Azeroth. Both continents; Zephras Isle is shown in a box between them, because the game does not place it; it has no quest data yet.');
    // The status line went into the Map layers drawer (map-presentation.md §25.3.0, step MP.4b).
    fireEvent.click(screen.getByRole('button', { name: 'Map layers' }));
    const drawer = within(await screen.findByRole('region', { name: 'Map layers' }));
    expect(drawer.getByText('Zephras Isle: shown in a box, not in position; no quest data yet')).toBeTruthy();
    const key = drawer.getByText('Key').closest('details');
    if (key === null) throw new Error('no key');
    const atlas = within(key).getByRole('region', { name: 'Atlas' });
    expect(within(atlas).getAllByRole('listitem').map((item) => item.querySelector('svg')?.getAttribute('data-swatch') ?? 'line')).toEqual(['line', 'inset']);
    expect(within(key).getByText(ATLAS_LAYOUT_NOTE)).toBeTruthy();
    expect(within(key).getByText('Zephras Isle: shown in a box, not in position; no quest data yet.')).toBeTruthy();
  });

  it('groups the maps the atlas does not place under "Separate maps"', () => {
    const s = setup();
    const [atlas] = s.controller.surfaces;
    if (atlas === undefined) throw new Error('no atlas');
    const darkspear = { id: 'world:2997' as const, mapId: worldMapId(2997), name: 'Darkspear Islands', extent: atlas.extent, extentSource: 'zone-union' as const, extentUiMapId: null, uiMapIds: [] };
    const options = surfaceSwitcherOptions([atlas, darkspear], s.controller.presets, (mapIds) => (mapIds.includes(worldMapId(2997)) ? 4 : 0));
    expect(options.map((entry) => ('group' in entry ? entry.group : entry.value))).toEqual(['atlas', 'preset:1', 'preset:0', SEPARATE_MAPS_GROUP]);
    expect(options[3]).toEqual({ group: 'Separate maps', options: [{ value: 'world:2997', label: 'Darkspear Islands · 4 route steps' }] });
    // Without the atlas: one entry per world surface, as before.
    expect(surfaceSwitcherOptions([darkspear], [], () => 0)).toEqual([{ value: 'world:2997', label: 'Darkspear Islands' }]);
  });

  it('is the default (ATL.10): the atlas in place of maps 0, 1 and 2991, the smooth wheel, and the minimap tiles with their notice first (MM.9)', async () => {
    const failed = () => Promise.resolve({ kind: 'failed', reason: 'unavailable', detail: 'none' } as const);
    const resources: MapResources = {
      art: failed,
      terrain: failed,
      arcs: failed,
      atlas: (hash, style) =>
        Promise.resolve({
          kind: 'loaded',
          file: { index: syntheticIndex({ hash, style: 'minimap', stored: { [-8]: [[0, 0]] } }), style: style ?? 'minimap', urlTemplate: './maps/minimap/t/{z}/{x}/{y}.webp', layout: 'compact' },
        }),
    };
    const s = setup({ resources });
    await settle();
    expect(s.controller.surfaces.map((info) => info.id)).toEqual(['atlas']);
    const adapter = s.adapters[0];
    expect([adapter?.options.initialSurface, adapter?.options.smoothWheel, adapter?.options.style]).toEqual(['atlas', true, 'minimap']);
    await vi.waitFor(() => {
      expect(s.controller.getStatus().style).toEqual({ chosen: 'minimap', shown: 'minimap', unavailable: null });
    });
    await settle();
    expect(screen.getByText(MINIMAP_ART_NOTICE)).toBeTruthy();
    const surface = document.querySelector('.fake-map');
    expect(document.getElementById(surface?.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/^Minimap art © Blizzard Entertainment\. Route map: Azeroth\. /);
  });
});
