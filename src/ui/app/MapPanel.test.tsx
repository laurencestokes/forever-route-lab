// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditorStore, type EditorStore, fixedClock } from '../../app';
import type { RouteStep } from '../../domain';
import { createMapController, type MapController, type MapEngineSetup, type MapResources } from '../../app/map-exports';
import { acceptStepsAt, fakeAdapterFactory, mapTestWorkspace, type FakeAdapter } from '../../app/map-test-helpers';
import { sequentialIdSource } from '../../app/shell-support';
import type { MapAdapterFactory } from '../../map/adapter';
import { buildRouteView, mapStepLabel } from '../app-model';
import { createAnnouncer } from './LiveAnnouncer';
import {
  MAP_INSTRUCTIONS,
  MapPanel,
  NO_MAP_ENGINE,
  PAINTED_ART_NOTICE,
  PAINTED_ART_NOTICE_SHORT,
  SCHEMATIC_NOTICE,
  SCHEMATIC_NOTICE_SHORT,
  focusUnavailable,
  noSurfaceText,
  routeStatusText,
} from './MapPanel';

afterEach(cleanup);

const NOW = '2026-09-25T12:00:00.000Z';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Setup {
  readonly store: EditorStore;
  readonly controller: MapController;
  readonly adapters: FakeAdapter[];
  readonly factory: MapAdapterFactory;
  readonly load: ReturnType<typeof vi.fn<() => Promise<MapAdapterFactory>>>;
  readonly announce: ReturnType<typeof vi.fn<(message: string) => void>>;
  readonly steps: ReturnType<typeof mapTestWorkspace>['steps'];
  readonly rerender: () => void;
}

/**
 * The map panel over the map test workspace (or `steps`), with a fake engine (loaded by `load`,
 * immediate by default), and optionally the committed map resources.
 */
function setup(load?: () => Promise<MapAdapterFactory>, steps?: RouteStep[], resources?: MapResources): Setup {
  const workspace = mapTestWorkspace(steps, NOW);
  const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(100), clock: fixedClock(NOW) });
  const fake = fakeAdapterFactory();
  const loader = vi.fn(load ?? (() => Promise.resolve(fake.factory)));
  const controller = createMapController({
    store,
    data: workspace.data,
    geometry: workspace.geometry,
    describeStep: mapStepLabel,
    timing: null,
    objectUrls: null,
    resources: resources ?? null,
  });
  const setupMap: MapEngineSetup = { geometry: workspace.geometry, art: null, resources: resources ?? null, loadAdapter: loader };
  const map = { setup: setupMap, controller };
  const announce = vi.fn<(message: string) => void>();
  const view = () => buildRouteView(store.getState().project.route, workspace.dataset, 1);
  const tree = () => <MapPanel store={store} view={view()} activeRow={null} map={map} geometry="fixture geometry" announce={announce} />;
  const { rerender } = render(tree());
  return {
    store,
    controller,
    adapters: fake.adapters,
    factory: fake.factory,
    load: loader,
    announce,
    steps: workspace.steps,
    rerender: () => {
      rerender(tree());
    },
  };
}

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const adapterOf = (s: Setup): FakeAdapter => {
  const adapter = s.adapters[0];
  if (adapter === undefined) throw new Error('the engine was not started');
  return adapter;
};

const commands = () => within(screen.getByRole('toolbar', { name: 'Map commands' }));
const surfaceSelect = () => screen.getByRole('combobox', { name: 'Map surface' });

describe('MapPanel: the engine', () => {
  it('says it is loading, then mounts the engine and names its surface for assistive technology', async () => {
    const engine = deferred<MapAdapterFactory>();
    const s = setup(() => engine.promise);
    expect(screen.getByRole('status').textContent).toBe('Loading the map…');
    expect(s.adapters).toHaveLength(0);
    await act(async () => {
      engine.resolve(s.factory);
      await engine.promise;
    });
    expect(screen.queryByText('Loading the map…')).toBeNull();
    const surface = document.querySelector('.fake-map');
    expect(surface?.getAttribute('role')).toBe('application');
    expect(surface?.getAttribute('aria-roledescription')).toBe('map');
    expect(surface?.getAttribute('aria-label')).toBe('Route map: Kalimdor');
    // The instructions start with what kind of map this is (MAP-A11Y-13).
    const instructions = document.getElementById(surface?.getAttribute('aria-describedby') ?? '');
    expect(instructions?.textContent).toBe(`${SCHEMATIC_NOTICE}. Route map: Kalimdor. ${MAP_INSTRUCTIONS}`);
    expect(adapterOf(s).mounted()).toBe(true);
    expect(screen.getByText(SCHEMATIC_NOTICE)).toBeTruthy();
    // The short form for a narrow panel is there too (the stylesheet shows one or the other).
    expect(screen.getByText(SCHEMATIC_NOTICE_SHORT)).toBeTruthy();
  });

  it('offers a retry when the engine cannot be loaded', async () => {
    let attempt = 0;
    const s = setup(() => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('chunk failed')) : Promise.resolve(fakeFactory);
    });
    const fake = fakeAdapterFactory();
    const fakeFactory = fake.factory;
    await settle();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('The map could not be loaded');
    expect(alert.textContent).toContain('chunk failed');
    expect(alert.textContent).toContain('The route list, the Available tab and Details work without it.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await settle();
    expect(s.load).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fake.adapters[0]?.mounted()).toBe(true);
  });

  it('says so when the loaded engine throws while starting, and starts a new one on retry', async () => {
    const broken = fakeAdapterFactory({ failMount: 'WebGL? No: canvas unavailable' });
    const working = fakeAdapterFactory();
    let attempt = 0;
    setup(() => {
      attempt += 1;
      return Promise.resolve(attempt === 1 ? broken.factory : working.factory);
    });
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('canvas unavailable');
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' }));
    await settle();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(working.adapters[0]?.mounted()).toBe(true);
    expect(document.querySelector('.fake-map')?.getAttribute('aria-label')).toBe('Route map: Kalimdor');
  });

  it('unmounts the engine with the panel', async () => {
    const s = setup();
    await settle();
    cleanup();
    expect(adapterOf(s).callsOf('destroy')).toHaveLength(1);
    expect(s.controller.getStatus().attached).toBe(false);
  });

  it('says there is no map when none was given', () => {
    const store = createEditorStore({ project: mapTestWorkspace().project, ids: sequentialIdSource(100), clock: fixedClock(NOW) });
    const view = buildRouteView(store.getState().project.route, mapTestWorkspace().dataset, 1);
    render(<MapPanel store={store} view={view} activeRow={null} map={null} announce={createAnnouncer().announce} />);
    expect(screen.getByText('No map here').parentElement?.textContent).toContain(NO_MAP_ENGINE);
    expect(commands().getByRole('button', { name: 'Fit route' }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('MapPanel: surfaces, layers and commands', () => {
  it('switches surfaces from the select, which lists the route’s steps per surface', async () => {
    const s = setup();
    await settle();
    const options = [...surfaceSelect().querySelectorAll('option')].map((option) => option.textContent);
    expect(options).toEqual(['Eastern Kingdoms · 1 route step', 'Kalimdor · 4 route steps', 'Zephras Isle']);
    fireEvent.change(surfaceSelect(), { target: { value: 'world:0' } });
    expect(adapterOf(s).getSurface()).toBe('world:0');
    expect((surfaceSelect() as HTMLSelectElement).value).toBe('world:0');
    expect(document.querySelector('.fake-map')?.getAttribute('aria-label')).toBe('Route map: Eastern Kingdoms');
    expect(screen.getByText('Route: 1 of 7 steps on Eastern Kingdoms · 4 on other maps · 1 not placed · 1 without a location')).toBeTruthy();
  });

  it('opens the layer panel, toggles a layer, and says why art and the proposal are unavailable', async () => {
    const s = setup();
    await settle();
    const toggle = commands().getByRole('button', { name: 'Layers' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(s.store.getState().view.showLayerPanel).toBe(true);
    const panel = within(screen.getByRole('group', { name: 'Layers' }));
    const givers = panel.getByRole('checkbox', { name: /Available quests/ });
    expect(givers).toHaveProperty('checked', true);
    fireEvent.click(givers);
    expect(s.store.getState().view.map.layers['available-quests']).toBe(false);
    // The coastline is hidden from the start (UI.md §12).
    expect(adapterOf(s).callsOf('toggleLayer')).toEqual([
      { kind: 'toggleLayer', layer: 'coastline', visible: false },
      { kind: 'toggleLayer', layer: 'available-quests', visible: false },
    ]);
    const art = panel.getByRole('checkbox', { name: /Painted map art/ });
    expect(art).toHaveProperty('disabled', true);
    expect(document.getElementById(art.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/^No local map set/);
    expect(panel.getByRole('checkbox', { name: /Proposal overlay/ })).toHaveProperty('disabled', true);
    // Counts and notes: what is drawn and what is not, with its unit.
    expect(panel.getByRole('checkbox', { name: /Step markers/ }).closest('li')?.textContent).toContain('4 drawn');
    expect(panel.getByText('1 step on other world maps', { exact: false })).toBeTruthy();
    expect(panel.getByText('Geometry loaded: fixture geometry.')).toBeTruthy();
    // Each layer shows its glyph, as the map draws it, and the key says what every glyph means.
    const glyphOf = (name: RegExp) => panel.getByRole('checkbox', { name }).closest('label')?.querySelector('svg')?.getAttribute('data-glyph');
    expect(glyphOf(/Available quests/)).toBe('quest-start');
    expect(glyphOf(/Route line/)).toBe('line-route');
    const key = within(screen.getByRole('group', { name: 'Key' }));
    expect(key.getByText('Flight: dotted')).toBeTruthy();
    expect(key.getByText('Leg unknown: an earlier step could not be placed')).toBeTruthy();
    // The topmost layer is listed first.
    expect(panel.getAllByRole('checkbox').map((box) => box.closest('label')?.textContent)).toEqual([
      'Selection',
      'Proposal overlay',
      'Step markers4 drawn',
      'Route line1 drawn',
      'Walking paths',
      'Flight masters1 drawn',
      'Turn-ins',
      'Objectives',
      'Available quests',
      'Zone frames6 drawn',
      'Zone outlines',
      'Coastline',
      'Painted map art',
      'Relief',
    ]);
    // Without map resources the terrain layers and walking paths say why they are unavailable.
    const reason = (name: RegExp) => document.getElementById(panel.getByRole('checkbox', { name }).getAttribute('aria-describedby') ?? '')?.textContent;
    expect(reason(/^Relief/)).toMatch(/^No terrain data in this build/);
    expect(reason(/Walking paths/)).toMatch(/^No walking paths are available yet/);
  });

  it('fits the route, and focuses the active step once there is one', async () => {
    const s = setup();
    await settle();
    const adapter = adapterOf(s);
    fireEvent.click(commands().getByRole('button', { name: 'Fit route' }));
    expect(adapter.callsOf('fitBounds')).toHaveLength(2);
    expect(s.announce).toHaveBeenLastCalledWith('Map shows 4 route steps on Kalimdor.');
    const focus = commands().getByRole('button', { name: 'Focus step' });
    expect(focus.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(focus.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Select a step in the route first');
    const complete = s.steps[3];
    if (complete === undefined) throw new Error('step missing');
    act(() => {
      s.store.select({ kind: 'single', id: complete.id });
    });
    s.rerender();
    // The map follows the new active step…
    expect(adapter.callsOf('focus').at(-1)).toMatchObject({ point: { x: 200, y: -4300 }, options: { recenter: false } });
    // …and "Focus step" recentres on it on request.
    expect(focus.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(focus);
    expect(adapter.callsOf('focus').at(-1)).toMatchObject({ options: { recenter: true } });
    expect(s.announce).toHaveBeenLastCalledWith('Map centred on step 4.');
  });

  it('says why a step without a map position cannot be focused', async () => {
    const s = setup();
    await settle();
    const note = s.steps[0];
    if (note === undefined) throw new Error('step missing');
    act(() => {
      s.store.select({ kind: 'single', id: note.id });
    });
    s.rerender();
    const focus = commands().getByRole('button', { name: 'Focus step' });
    expect(document.getElementById(focus.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Step 1 has no location');
    fireEvent.click(focus);
    expect(adapterOf(s).callsOf('focus')).toHaveLength(0);
  });

  it('shows what the pointer is over, and the zoom band when points are folded into zone counts', async () => {
    const s = setup();
    await settle();
    const adapter = adapterOf(s);
    const giver = adapter.contents.get('available-quests')?.items[0];
    if (giver?.type !== 'marker') throw new Error('giver missing');
    act(() => {
      adapter.emit({ type: 'hover', point: giver.point, hit: { layer: 'available-quests', id: giver.id, ref: giver.ref, refs: giver.refs, segment: null } });
    });
    expect(document.querySelector('.frl-mapframe__hover')?.textContent).toBe('Pointer on: Gornek: starts 2 quests (Gather and Cull)');
    // Step markers read their number from the route order, as the tooltip does.
    const step = adapter.contents.get('route-steps')?.items[0];
    if (step === undefined) throw new Error('step missing');
    act(() => {
      adapter.emit({ type: 'hover', point: null, hit: { layer: 'route-steps', id: step.id, ref: step.ref, refs: [step.ref], segment: null } });
    });
    expect(document.querySelector('.frl-mapframe__hover')?.textContent).toBe('Pointer on: 2 · Accept quest: Gather');
    act(() => {
      adapter.emit({ type: 'hover', point: null, hit: null });
    });
    expect(document.querySelector('.frl-mapframe__hover')).toBeNull();
    act(() => {
      adapter.pan({ zoom: -5 });
    });
    expect(screen.getByText('Zoomed out: quest points shown as zone counts')).toBeTruthy();
  });

  it('lists the items of a clicked stack near it, and runs the one chosen from the keyboard (MAP-UX-3)', async () => {
    const s = setup();
    await settle();
    const adapter = adapterOf(s);
    const [, gather, cull] = s.steps;
    if (gather === undefined || cull === undefined) throw new Error('steps missing');
    const refs = [
      { kind: 'step', stepId: gather.id },
      { kind: 'step', stepId: cull.id },
    ] as const;
    act(() => {
      adapter.emit({ type: 'click', point: { mapId: 1 as never, x: 0, y: -4000 }, hit: { layer: 'route-steps', id: `step:${gather.id}`, ref: refs[0], refs, segment: null }, zones: [] });
    });
    const dialog = screen.getByRole('dialog', { name: '2 steps here' });
    expect(within(dialog).getByText('Choose one to select its step.')).toBeTruthy();
    const options = within(dialog).getAllByRole('button').filter((button) => button.classList.contains('frl-mapchoice__option'));
    expect(options.map((button) => button.textContent)).toEqual(['2 · Accept quest: Gather', '3 · Accept quest: Cull']);
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(options[0] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(options[1] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Select all 2 steps');
    fireEvent.click(options[1] as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(s.store.getState().selection.focus).toBe(cull.id);
    // Escape closes it and gives focus back to the map.
    act(() => {
      adapter.emit({ type: 'click', point: { mapId: 1 as never, x: 0, y: -4000 }, hit: { layer: 'route-steps', id: `step:${gather.id}`, ref: refs[0], refs, segment: null }, zones: [] });
    });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('.fake-map'));
  });

  it('says, shows and announces that the active step is on a world map with no surface (MAP-UX-9)', async () => {
    const steps = acceptStepsAt([
      { mapId: 1, x: 0, y: -4000 },
      { mapId: 36, x: 10, y: 20 },
    ]);
    const s = setup(undefined, steps);
    await settle();
    expect(screen.getByText('Route: 1 of 2 steps on Kalimdor · 1 on maps with no surface')).toBeTruthy();
    act(() => {
      s.store.select({ kind: 'single', id: steps[1]?.id ?? ('' as never) });
    });
    s.rerender();
    const text = 'Step 2 is on world map 36, which this map cannot show';
    expect([...document.querySelectorAll('.frl-mapframe__status-item')].map((item) => item.textContent)).toContain(text);
    expect(s.announce).toHaveBeenCalledWith(`${text}.`);
    const focus = commands().getByRole('button', { name: 'Focus step' });
    expect(focus.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(focus.getAttribute('aria-describedby') ?? '')?.textContent).toBe(text);
    expect(noSurfaceText(12, 36)).toBe('Step 12 is on world map 36, which this map cannot show');
  });
});

describe('MapPanel texts', () => {
  it('summarises the route on a surface, telling steps on other surfaces from those on maps with none (MAP-UX-9)', () => {
    const route = { total: 10, placed: 6, unplaced: 1, withoutLocation: 3, maps: [], onSurface: 4, noSurface: 0, canFit: true };
    expect(routeStatusText(route, 'Kalimdor')).toBe('Route: 4 of 10 steps on Kalimdor · 2 on other maps · 1 not placed · 3 without a location');
    expect(routeStatusText({ ...route, noSurface: 1 }, 'Kalimdor')).toBe(
      'Route: 4 of 10 steps on Kalimdor · 1 on other maps · 1 on maps with no surface · 1 not placed · 3 without a location',
    );
    expect(routeStatusText({ ...route, placed: 4, unplaced: 0, withoutLocation: 0 }, null)).toBe('Route: 4 of 10 steps');
  });

  it('says why focus is unavailable', () => {
    expect(focusUnavailable(null)).toBe('Select a step in the route first');
    expect(focusUnavailable({ stepId: 's' as never, number: 3, placement: { kind: 'unknown', reason: 'no-geometry' } })).toBe(
      'Step 3 is not on the map: its map has no geometry here',
    );
    expect(focusUnavailable({ stepId: 's' as never, number: 3, placement: { kind: 'point', surface: 'world:1' } })).toBeNull();
    expect(focusUnavailable({ stepId: 's' as never, number: 6, placement: { kind: 'no-surface', mapId: 36 as never } })).toBe(
      'Step 6 is on world map 36, which this map cannot show',
    );
  });
});

describe('MapPanel: painted art, terrain and walking paths', () => {
  type ArtLoad = Awaited<ReturnType<MapResources['art']>>;
  type TerrainLoad = Awaited<ReturnType<MapResources['terrain']>>;
  const DUROTAR_ART: ArtLoad = {
    kind: 'loaded',
    manifest: {
      owner: 'Blizzard Entertainment',
      build: '1.60.1.70009',
      images: [
        {
          uiMapId: 1411 as never,
          name: 'Durotar',
          uiMapType: 3,
          styleId: 1,
          bounds: { mapId: 1 as never, xMin: -1716.67, xMax: 1808.33, yMin: -7250, yMax: -1962.5 },
          url: './maps/art/1411.webp',
          contentType: 'image/webp',
          width: 1002,
          height: 668,
          sha256: 'a'.repeat(64),
        },
      ],
      unplaced: [],
    },
  };
  const NO_TERRAIN: TerrainLoad = { kind: 'failed', reason: 'invalid', detail: 'maps/terrain/manifest.json is not JSON' };
  const resources = (art: ArtLoad, terrain: TerrainLoad = NO_TERRAIN): MapResources => ({
    art: () => Promise.resolve(art),
    terrain: () => Promise.resolve(terrain),
    arcs: () => Promise.resolve({ kind: 'failed', reason: 'invalid', detail: 'none' }),
  });

  it('carries Blizzard Entertainment’s notice while the painted art is drawn, and starts the instructions with it', async () => {
    setup(undefined, undefined, resources(DUROTAR_ART));
    await settle();
    await settle();
    expect(screen.getByText(PAINTED_ART_NOTICE)).toBeTruthy();
    expect(screen.getByText(PAINTED_ART_NOTICE_SHORT)).toBeTruthy();
    expect(PAINTED_ART_NOTICE).toBe('Painted map art \u00a9 Blizzard Entertainment');
    const surface = document.querySelector('.fake-map');
    expect(document.getElementById(surface?.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      `${PAINTED_ART_NOTICE}. Route map: Kalimdor. ${MAP_INSTRUCTIONS}`,
    );
    // No terrain: said in the status line, without stopping the map.
    const status = [...document.querySelectorAll('.frl-mapframe__status-item')].map((item) => item.textContent);
    expect(status).toContain('Terrain data could not be loaded: no relief, zone outlines or coastline');
  });

  it('says in the status line when the painted art could not be loaded, and shows the schematic notice', async () => {
    setup(undefined, undefined, resources({ kind: 'failed', reason: 'unavailable', detail: 'maps/art/manifest.json: HTTP 404' }));
    await settle();
    await settle();
    expect(screen.getByText(SCHEMATIC_NOTICE)).toBeTruthy();
    const status = [...document.querySelectorAll('.frl-mapframe__status-item')].map((item) => item.textContent);
    expect(status).toContain('Painted map art could not be loaded: the map shows zone frames instead');
  });

  it('toggles walking paths from their row under the route line, once the navigation model gives paths', async () => {
    const s = setup();
    await settle();
    fireEvent.click(commands().getByRole('button', { name: 'Layers' }));
    const panel = within(screen.getByRole('group', { name: 'Layers' }));
    const row = () => panel.getByRole('checkbox', { name: /Walking paths/ });
    expect(row()).toHaveProperty('disabled', true);
    act(() => {
      s.controller.setRoutePaths({ pending: false, pathOf: (leg) => [leg.from, leg.to] });
    });
    expect(row()).toHaveProperty('disabled', false);
    expect(row()).toHaveProperty('checked', true);
    expect(row().closest('li')?.textContent).toContain('3 walked legs follow their paths on this map.');
    fireEvent.click(row());
    expect(s.store.getState().view.map.walkingPaths).toBe(false);
    expect(row()).toHaveProperty('checked', false);
    fireEvent.click(row());
    expect(s.store.getState().view.map.walkingPaths).toBe(true);
  });
});
