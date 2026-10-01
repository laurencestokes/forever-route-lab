// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEditorStore, fixedClock } from '../../app';
import { createMapController, createMapLayersSetting, MAP_LAYERS_STORAGE_KEY, type MapEngineSetup, type MapResources } from '../../app/map-exports';
import { fakeAdapterFactory, mapTestWorkspace } from '../../app/map-test-helpers';
import { sequentialIdSource } from '../../app/shell-support';
import { buildRouteView, mapStepLabel } from '../app-model';
import { loadMapLayersPanel } from './lazy';
import { MapPanel } from './MapPanel';

/*
 * The Map layers drawer in the map panel (docs/research/map-presentation.md §25.3; D-047; steps
 * MP.4b, MP.4c, MM.7): the one kept record (rows, collapsed groups, open state, style), open by
 * default only where it docks, Show all / Hide all / Defaults with their announcements, the search
 * filtering the map, and the style control with its persistence, fallback and announcement.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The drawer is a lazy part (map-presentation.md §25.3.1) that production builds preload when idle;
// so do these tests. Loaded at the first open instead, the chunk can take over a second on a busy
// machine, longer than Testing Library waits by default.
beforeAll(async () => {
  await loadMapLayersPanel();
});

const NOW = '2026-09-28T12:00:00.000Z';

/** A storage like `localStorage`. */
function memoryStorage(initial: Readonly<Record<string, unknown>> = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    record: (): unknown => JSON.parse(values.get(MAP_LAYERS_STORAGE_KEY) ?? 'null'),
  };
}

function setup({ record, atlas = false, resources = null, minimap }: { record?: unknown; atlas?: boolean; resources?: MapResources | null; minimap?: boolean } = {}) {
  const storage = memoryStorage(record === undefined ? {} : { [MAP_LAYERS_STORAGE_KEY]: record });
  const setting = createMapLayersSetting(() => storage);
  const workspace = mapTestWorkspace(undefined, NOW);
  const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(100), clock: fixedClock(NOW) });
  const fake = fakeAdapterFactory();
  const controller = createMapController({ store, data: workspace.data, geometry: workspace.geometry, describeStep: mapStepLabel, timing: null, objectUrls: null, atlas, resources, mapStyle: setting.style, minimap });
  const setupMap: MapEngineSetup = { geometry: workspace.geometry, art: null, resources, loadAdapter: () => Promise.resolve(fake.factory), mapLayers: setting };
  const announce = vi.fn<(message: string) => void>();
  const view = buildRouteView(store.getState().project.route, workspace.dataset, 1);
  render(<MapPanel store={store} view={view} activeRow={null} map={{ setup: setupMap, controller }} geometry="fixture geometry" announce={announce} />);
  const adapter = () => {
    const first = fake.adapters[0];
    if (first === undefined) throw new Error('no adapter');
    return first;
  };
  return { store, controller, storage, adapter, announce };
}

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

async function openDrawer() {
  fireEvent.click(screen.getByRole('button', { name: 'Map layers' }));
  return within(await screen.findByRole('region', { name: 'Map layers' }));
}

/** Makes every element measure `width` px wide, as a laid-out map region would. */
function regionWidth(width: number): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: 700, width, height: 700, toJSON: () => ({}) });
}

describe('the Map layers drawer in the map panel (§25.3)', () => {
  it('reads the kept record at the first render, applies its rows before the drawer loads, and writes changes 500 ms after the last', async () => {
    const s = setup({ record: { version: 1, style: 'painted', hidden: ['turn-ins', 'route-line'], collapsed: ['services'], drawerOpen: true } });
    await settle();
    // Applied at once: the mask for the pin row, the store for the layer row.
    expect(s.adapter().callsOf('setMask').at(-1)?.mask).toEqual({ hidden: ['turn-ins'], only: null });
    expect(s.store.getState().view.map.layers['route-line']).toBe(false);
    // A kept "open" applies only where the drawer docks; happy-dom lays nothing out, so it lies over the map, closed.
    expect(screen.getByRole('button', { name: 'Map layers' }).getAttribute('aria-expanded')).toBe('false');
    const drawer = await openDrawer();
    expect(drawer.getByRole('button', { name: 'Expand Services' }).getAttribute('aria-expanded')).toBe('false');
    const turnIns = drawer.getByRole('checkbox', { name: /^Turn-ins/ });
    expect(turnIns).toHaveProperty('checked', false);
    fireEvent.click(turnIns);
    expect(s.adapter().callsOf('setMask').at(-1)?.mask).toEqual({ hidden: [], only: null });
    // Not yet written; written once the changes stop.
    expect(s.storage.record()).toEqual({ version: 1, style: 'painted', hidden: ['turn-ins', 'route-line'], collapsed: ['services'], drawerOpen: true });
    await vi.waitFor(
      () => {
        expect(s.storage.record()).toEqual({ version: 1, style: 'painted', hidden: ['route-line'], drawerOpen: true, collapsed: ['services'] });
      },
      { timeout: 2000, interval: 50 },
    );
  });

  it('starts with the default rows when nothing is kept, and never writes them', async () => {
    const s = setup();
    await settle();
    expect(s.adapter().callsOf('setMask').at(-1)?.mask).toEqual({ hidden: ['unlocks-soon', 'low-level', 'unconfirmed-raids', 'other-faction-flights'], only: null });
    expect(s.store.getState().view.map.layers['coastline']).toBe(false);
    expect(s.storage.record()).toBeNull();
  });

  it('opens by default where the map region docks it (900 px or more), and keeps a closed drawer closed', async () => {
    regionWidth(1200);
    setup();
    expect(await screen.findByRole('region', { name: 'Map layers' })).toBeTruthy();
    expect(document.querySelector('.frl-mapframe')?.classList.contains('is-docked')).toBe(true);
    // Docked: no close button; the toggle closes it.
    expect(screen.queryByRole('button', { name: 'Close Map layers' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Map layers' }));
    expect(screen.queryByRole('region', { name: 'Map layers' })).toBeNull();
    cleanup();
    setup({ record: { version: 1, drawerOpen: false } });
    await settle();
    expect(screen.getByRole('button', { name: 'Map layers' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('region', { name: 'Map layers' })).toBeNull();
  });

  it('closes a drawer over the map on Escape and gives focus back to its toggle', async () => {
    setup();
    await settle();
    const drawer = await openDrawer();
    fireEvent.keyDown(drawer.getByRole('checkbox', { name: /^Route line/ }), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Map layers' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Map layers' }));
  });

  it('says Show all, Hide all and Defaults, and applies them: Hide all keeps the route', async () => {
    const s = setup();
    await settle();
    const drawer = await openDrawer();
    fireEvent.click(drawer.getByRole('button', { name: 'Show all map categories' }));
    expect(s.announce).toHaveBeenLastCalledWith('All map categories shown.');
    expect(s.adapter().callsOf('setMask').at(-1)?.mask).toEqual({ hidden: [], only: null });
    expect(s.store.getState().view.map.layers['coastline']).toBe(true);
    fireEvent.click(drawer.getByRole('button', { name: 'Hide all map categories' }));
    expect(s.announce).toHaveBeenLastCalledWith('All map categories hidden; the route stays.');
    expect(s.adapter().callsOf('setMask').at(-1)?.mask.hidden).toContain('available');
    expect(s.store.getState().view.map.layers['route-line']).toBe(true);
    expect(within(drawer.getByRole('group', { name: /^Quests, / })).getByRole('checkbox', { name: 'Quests' })).toHaveProperty('checked', false);
    fireEvent.click(drawer.getByRole('button', { name: 'Restore the default map categories' }));
    expect(s.announce).toHaveBeenLastCalledWith('Map categories back to their defaults.');
    expect(s.adapter().callsOf('setMask').at(-1)?.mask.hidden).toEqual(['unlocks-soon', 'low-level', 'unconfirmed-raids', 'other-faction-flights']);
  });

  it('searches the map: the results in place of the rows, the map drawn with only them, and a chosen result shown', async () => {
    const s = setup();
    await settle();
    const drawer = await openDrawer();
    const field = drawer.getByRole('searchbox', { name: 'Search the map' });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'g' } });
    // One character: no query yet.
    expect(drawer.getByRole('toolbar', { name: 'All map categories' })).toBeTruthy();
    fireEvent.change(field, { target: { value: 'gor' } });
    const results = within(await drawer.findByRole('region', { name: 'Quests' }));
    expect(drawer.getByText('1 result: 1 NPC')).toBeTruthy();
    await vi.waitFor(() => {
      expect(s.adapter().callsOf('setMask').at(-1)?.mask.only).toEqual({ subjects: ['npc:10'], quests: [], places: [] });
    });
    const focuses = s.adapter().callsOf('focus').length;
    fireEvent.click(results.getByRole('button', { name: /^Gornek/ }));
    expect(s.adapter().callsOf('focus')).toHaveLength(focuses + 1);
    expect(s.adapter().callsOf('focus').at(-1)?.point).toEqual({ mapId: 1, x: 0, y: -4000 });
    // §25.3.5 (review PR-05): its popover opens on its pin (and takes focus; it says nothing on opening).
    expect(s.controller.getStatus().popover?.refs.some((ref) => ref.kind === 'spawn' && ref.subject.kind === 'npc' && ref.subject.id === 10)).toBe(true);
    // A quest's popover opens too; the right panel's tab is left as it is (Show in Details is in the popover).
    const tab = s.store.getState().view.rightTab;
    fireEvent.change(field, { target: { value: 'cull' } });
    const quest = within(await drawer.findByRole('region', { name: 'Quests' }));
    await vi.waitFor(() => {
      expect(quest.getByRole('button', { name: /^Cull/ })).toBeTruthy();
    });
    fireEvent.click(quest.getByRole('button', { name: /^Cull/ }));
    expect(s.store.getState().view.rightTab).toBe(tab);
    expect(s.store.getState().view.openedQuests?.questIds ?? []).not.toContain(2);
    // Cleared: the rows again, and the map unfiltered.
    fireEvent.click(within(drawer.getByRole('toolbar', { name: 'Search results' })).getByRole('button', { name: 'Clear search' }));
    await vi.waitFor(() => {
      expect(s.adapter().callsOf('setMask').at(-1)?.mask.only).toBeNull();
    });
    expect(drawer.getByRole('toolbar', { name: 'All map categories' })).toBeTruthy();
  });

  it('offers the style only on the seamless atlas, and says why it cannot be used without one (MM.7; the world-surface path since ATL.10)', async () => {
    setup();
    await settle();
    const drawer = await openDrawer();
    const radios = within(drawer.getByRole('group', { name: 'Map style' })).getAllByRole('radio');
    expect(radios.every((radio) => (radio as HTMLInputElement).disabled)).toBe(true);
    expect(drawer.getByText('Styles apply to the seamless atlas, which this geometry cannot place: the map shows one world map at a time.')).toBeTruthy();
  });

  it('switches the style on the atlas, says so, and keeps it in the record (MM.7; the minimap by default since MM.9)', async () => {
    const s = setup({ atlas: true, record: { version: 1, hidden: ['turn-ins'] } });
    await settle();
    const drawer = await openDrawer();
    const group = within(drawer.getByRole('group', { name: 'Map style' }));
    expect(group.getByRole('radio', { name: 'Minimap' })).toHaveProperty('checked', true);
    fireEvent.click(group.getByRole('radio', { name: 'Painted' }));
    expect(s.announce).toHaveBeenLastCalledWith('Map style: Painted.');
    expect(s.controller.getStatus().style.chosen).toBe('painted');
    expect(group.getByRole('radio', { name: 'Painted' })).toHaveProperty('checked', true);
    // Written at once, beside the kept rows.
    expect(s.storage.record()).toEqual({ version: 1, style: 'painted', hidden: ['turn-ins'] });
  });

  it('shows the minimap as unavailable in a painted build, says why, and keeps the minimap choice in the record (D-053)', async () => {
    const s = setup({ atlas: true, minimap: false, record: { version: 1, style: 'minimap' } });
    await settle();
    const why = 'This build has no minimap tiles, so the painted map is the only style.';
    const drawer = await openDrawer();
    const group = within(drawer.getByRole('group', { name: 'Map style' }));
    const minimap = group.getByRole('radio', { name: 'Minimap' });
    expect(minimap).toHaveProperty('disabled', true);
    expect(minimap.closest('label')?.getAttribute('title')).toBe(why);
    expect(group.getByRole('radio', { name: 'Painted' })).toHaveProperty('checked', true);
    expect(group.getByRole('radio', { name: 'Painted' })).toHaveProperty('disabled', false);
    // The note describes the control.
    const note = drawer.getAllByText(why).find((element) => element.classList.contains('frl-mapdrawer__note'));
    expect(note?.id).toBeTruthy();
    expect(minimap.closest('fieldset')?.getAttribute('aria-describedby')).toBe(note?.id);
    expect(s.controller.getStatus().style.chosen).toBe('painted');
    expect(s.storage.record()).toEqual({ version: 1, style: 'minimap' });
  });

  it('says why the chosen style is not drawn, and which one is, when its tiles cannot be loaded (MM.7, map-atlas.md §21.4)', async () => {
    const failed = (detail: string) => Promise.resolve({ kind: 'failed', reason: 'unavailable', detail } as const);
    const resources: MapResources = {
      art: () => failed('none'),
      terrain: () => failed('none'),
      arcs: () => failed('none'),
      atlas: (_hash, style) => failed(`maps/${style === 'minimap' ? 'minimap' : 'atlas'}/index.json: HTTP 404`),
    };
    const s = setup({ atlas: true, resources, record: { version: 1, style: 'minimap' } });
    await settle();
    const message = 'Minimap tiles unavailable: maps/minimap/index.json: HTTP 404; showing the painted map';
    await vi.waitFor(() => {
      expect(s.controller.getStatus().style.unavailable).toBe(message);
    });
    const drawer = await openDrawer();
    const minimap = within(drawer.getByRole('group', { name: 'Map style' })).getByRole('radio', { name: 'Minimap' });
    // The choice stands, and the note describes the control.
    expect(minimap).toHaveProperty('checked', true);
    const note = drawer.getAllByText(message).find((element) => element.classList.contains('frl-mapdrawer__note'));
    expect(note?.id).toBeTruthy();
    expect(minimap.closest('fieldset')?.getAttribute('aria-describedby')).toBe(note?.id);
    // A fallback is never written.
    expect(s.storage.record()).toEqual({ version: 1, style: 'minimap' });
  });
});
