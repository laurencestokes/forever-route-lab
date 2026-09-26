// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditorStore, type EditorStore, fixedClock } from '../app';
import type { MapEngineSetup } from '../app/map-exports';
import { fakeAdapterFactory, MAP_TEST_ORGRIMMAR, mapTestWorkspace, type FakeAdapter } from '../app/map-test-helpers';
import { sequentialIdSource } from '../app/shell-support';
import { App } from './App';

/**
 * The map wired into the shell (docs/UI.md §12) with a fake engine: jump to zone from the top bar,
 * quests opened from the map or the Available tab in Details, the map following the route list,
 * and a StrictMode remount that reuses the engine.
 */

afterEach(cleanup);

const NOW = '2026-09-25T12:00:00.000Z';

interface Setup {
  readonly store: EditorStore;
  readonly adapter: () => FakeAdapter;
  readonly adapters: FakeAdapter[];
  readonly steps: ReturnType<typeof mapTestWorkspace>['steps'];
}

async function setup(strict = false): Promise<Setup> {
  const workspace = mapTestWorkspace(undefined, NOW);
  const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(100), clock: fixedClock(NOW) });
  const fake = fakeAdapterFactory();
  const map: MapEngineSetup = { geometry: workspace.geometry, art: null, loadAdapter: () => Promise.resolve(fake.factory) };
  const app = <App store={store} data={workspace.data} projectName="Map test" map={map} version="0.0.0-test" sourceCommit={null} />;
  render(strict ? <StrictMode>{app}</StrictMode> : app);
  await act(async () => {
    await Promise.resolve();
  });
  return {
    store,
    adapters: fake.adapters,
    steps: workspace.steps,
    adapter: () => {
      const adapter = fake.adapters[0];
      if (adapter === undefined) throw new Error('no engine');
      return adapter;
    },
  };
}

const sidePanel = () => within(screen.getByRole('complementary', { name: 'Quests and details' }));
/** The live region's text without the no-break space that marks a repeated message. */
const liveText = () => document.querySelector('.frl-app-live')?.textContent.replace(/\u00a0$/, '') ?? '';

describe('the map in the shell', () => {
  it('jumps to a zone from the top bar: the zones are grouped by world map', async () => {
    const s = await setup();
    const select = screen.getByRole('combobox', { name: 'Jump to zone' });
    expect([...select.querySelectorAll('optgroup')].map((group) => group.getAttribute('label'))).toEqual(['Eastern Kingdoms', 'Kalimdor', 'Zephras Isle']);
    fireEvent.change(select, { target: { value: String(MAP_TEST_ORGRIMMAR) } });
    const go = screen.getByRole('button', { name: 'Go to zone' });
    expect(go.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(go);
    expect(s.adapter().callsOf('fitBounds').at(-1)?.bounds).toMatchObject({ xMin: 1338.4605712891 });
    expect(s.store.getState().view.map.zone).toBe(MAP_TEST_ORGRIMMAR);
    expect(liveText()).toBe('Map shows Orgrimmar.');
    expect((select as HTMLSelectElement).value).toBe(String(MAP_TEST_ORGRIMMAR));
    // Once another surface is shown the zone is no longer "the zone": the select resets (MAP-UX-12).
    act(() => {
      s.adapter().setSurface('world:0');
    });
    expect(s.store.getState().view.map.zone).toBeNull();
    expect((select as HTMLSelectElement).value).toBe('');
  });

  it('opens a clicked quest giver’s quests in Details, and goes back to the step', async () => {
    const s = await setup();
    const giver = s.adapter().contents.get('available-quests')?.items[0];
    if (giver?.type !== 'marker') throw new Error('giver missing');
    act(() => {
      s.adapter().emit({ type: 'click', point: giver.point, hit: { layer: 'available-quests', id: giver.id, ref: giver.ref, refs: giver.refs, segment: null }, zones: [] });
    });
    expect(sidePanel().getByRole('tab', { name: /Details/ }).getAttribute('aria-selected')).toBe('true');
    const panel = sidePanel().getByRole('tabpanel');
    expect(panel.textContent).toContain('2 opened quests');
    expect(panel.textContent).toContain('Gather');
    expect(panel.textContent).toContain('Cull');
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(s.store.getState().view.openedQuests).toBeNull();
    expect(sidePanel().getByRole('tabpanel').textContent).toContain('No step selected');
    // Focus goes back to the route list, not to the page.
    expect(document.activeElement?.getAttribute('role')).toBe('listbox');
  });

  it('opens a quest in Details from the Available tab, the keyboard path to a marker click', async () => {
    const s = await setup();
    const button = sidePanel().getByRole('button', { name: 'Show in Details: Cull' });
    fireEvent.click(button);
    const panel = sidePanel().getByRole('tabpanel');
    expect(panel.textContent).toContain('Opened quest');
    expect(panel.textContent).toContain('Cull');
    // The opened quest is in focus on the map: its objectives and turn-ins are drawn.
    expect(s.adapter().contents.get('objectives')?.items.map((item) => item.label)).toEqual(['Boar · kill for Cull', 'Boar · kill for Cull']);
    expect(s.adapter().contents.get('turn-ins')?.items.map((item) => item.label)).toEqual(['Zureetha · turn in Cull']);
    // Selecting a step shows the step again.
    const step = s.steps[1];
    if (step === undefined) throw new Error('step missing');
    act(() => {
      s.store.select({ kind: 'single', id: step.id });
    });
    expect(sidePanel().getByRole('tabpanel').textContent).not.toContain('Opened quest');
  });

  it('follows the route list: the active step is brought into view and a clicked marker selects its step', async () => {
    const s = await setup();
    const rows = () => within(screen.getByRole('listbox')).getAllByRole('option');
    const option = rows()[3];
    if (option === undefined) throw new Error('row missing');
    const stepSets = () => s.adapter().callsOf('setLayer').filter((call) => call.layer === 'selection').length;
    const before = stepSets();
    fireEvent.click(option);
    expect(s.adapter().callsOf('focus').at(-1)).toMatchObject({ point: { x: 200, y: -4300 } });
    // One sync for the click: the selection and the active step it makes (PERF-6); the step markers do not see it (PERF-2).
    expect(stepSets() - before).toBe(1);
    const second = s.steps[1];
    const marker = s.adapter().contents.get('route-steps')?.items.find((item) => item.ref.kind === 'step' && item.ref.stepId === second?.id);
    if (marker?.type !== 'marker') throw new Error('marker missing');
    act(() => {
      s.adapter().emit({ type: 'click', point: marker.point, hit: { layer: 'route-steps', id: marker.id, ref: marker.ref, refs: marker.refs, segment: null }, zones: [] });
    });
    expect(rows()[1]?.getAttribute('aria-selected')).toBe('true');
    expect(rows()[3]?.getAttribute('aria-selected')).toBe('false');
  });

  it('highlights a route row’s marker while the pointer is over the row', async () => {
    const s = await setup();
    const rows = within(screen.getByRole('listbox')).getAllByRole('option');
    const [note, gather] = s.steps;
    fireEvent.mouseEnter(rows[1] as HTMLElement);
    expect(s.adapter().callsOf('highlight').at(-1)).toEqual({ kind: 'highlight', target: { layer: 'route-steps', ids: [`step:${String(gather?.id)}`] } });
    // A note has no marker to highlight.
    fireEvent.mouseEnter(rows[0] as HTMLElement);
    expect(note?.kind).toBe('note');
    expect(s.adapter().callsOf('highlight').at(-1)).toEqual({ kind: 'highlight', target: null });
    fireEvent.mouseEnter(rows[1] as HTMLElement);
    fireEvent.mouseLeave(screen.getByRole('listbox'));
    expect(s.adapter().callsOf('highlight').at(-1)).toEqual({ kind: 'highlight', target: null });
  });

  it('survives a StrictMode remount with one engine, mounted once at the end', async () => {
    const s = await setup(true);
    expect(s.adapters).toHaveLength(1);
    const adapter = s.adapter();
    expect(adapter.mounted()).toBe(true);
    expect(adapter.callsOf('mount').length - adapter.callsOf('destroy').length).toBe(1);
    // The surface element of the last mount is the one named.
    const surfaces = document.querySelectorAll('.fake-map');
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]?.getAttribute('aria-label')).toBe('Route map: Kalimdor');
  });
});
