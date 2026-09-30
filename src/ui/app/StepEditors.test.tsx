// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditorStore, fixedClock } from '../../app';
import { createMapController, type MapEngineSetup } from '../../app/map-exports';
import { fakeAdapterFactory, MAP_TEST_DATASET, MAP_TEST_DUROTAR, MAP_TEST_KALIMDOR, mapTestWorkspace } from '../../app/map-test-helpers';
import { editNoteText, sequentialIdSource } from '../../app/shell-support';
import type { Location } from '../../domain/points';
import { buildRouteView, mapStepLabel } from '../app-model';
import { MapPanel, pickText } from './MapPanel';
import { createRouteActions } from './route-actions';
import { DetailsPanel } from './StepDetails';
import { DurationEditor, LocationEditor, NOTHING_TO_CLEAR } from './StepEditors';

afterEach(cleanup);

const NOW = '2026-09-25T12:00:00.000Z';

describe('LocationEditor', () => {
  it('sets a typed zone-percent point in the Forever frame, and clears', () => {
    const onChange = vi.fn<(location: Location | null) => void>();
    const announce = vi.fn<(message: string) => void>();
    const value: Location = { source: { space: 'zone', uiMapId: MAP_TEST_DUROTAR, x: 40, y: 60, frame: 'forever', lexemes: null }, label: null, radius: null };
    render(<LocationEditor label="Location" value={value} dataset={MAP_TEST_DATASET} disabled={false} onChange={onChange} pick={null} announce={announce} />);
    const group = screen.getByRole('group', { name: 'Location' });
    expect(group.textContent).toContain('Durotar 40, 60');
    // The fields start from the point.
    expect(within(group).getByLabelText<HTMLInputElement>('X %').value).toBe('40');
    fireEvent.change(within(group).getByLabelText('X %'), { target: { value: '42.5' } });
    fireEvent.click(within(group).getByRole('button', { name: 'Set point' }));
    expect(onChange).toHaveBeenLastCalledWith({ source: { space: 'zone', uiMapId: MAP_TEST_DUROTAR, x: 42.5, y: 60, frame: 'forever', lexemes: null }, label: null, radius: null });
    fireEvent.change(within(group).getByLabelText('Y %'), { target: { value: 'north' } });
    fireEvent.click(within(group).getByRole('button', { name: 'Set point' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(group.textContent).toContain('type X and Y as numbers');
    expect(announce.mock.calls.at(-1)?.[0]).toMatch(/^Not set: /);
    fireEvent.click(within(group).getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    // Without a map, picking says what to do instead.
    const pickButton = within(group).getByRole('button', { name: 'Pick on map' });
    expect(pickButton.getAttribute('aria-disabled')).toBe('true');
    expect(pickButton.getAttribute('title')).toMatch(/type the zone and percent instead/);
  });

  it('follows the value when it changes outside the fields, keeps an unchanged point as it is, and keeps focus on Clear (CR-17, UI-F4)', () => {
    const onChange = vi.fn<(location: Location | null) => void>();
    const era: Location = { source: { space: 'zone', uiMapId: MAP_TEST_DUROTAR, x: 40, y: 60, frame: 'era', lexemes: null }, label: null, radius: null };
    const moved: Location = { source: { space: 'zone', uiMapId: MAP_TEST_DUROTAR, x: 12, y: 34, frame: 'forever', lexemes: null }, label: null, radius: null };
    const editor = (value: Location | null) => <LocationEditor label="Location" value={value} dataset={MAP_TEST_DATASET} disabled={false} onChange={onChange} pick={null} />;
    const { rerender } = render(editor(era));
    const group = screen.getByRole('group', { name: 'Location' });
    const x = () => within(group).getByLabelText<HTMLInputElement>('X %').value;
    // Set point on the value's own point keeps it (an Era-frame point stays Era).
    fireEvent.click(within(group).getByRole('button', { name: 'Set point' }));
    expect(onChange).not.toHaveBeenCalled();
    // A typed but unsaved edit, then the value changes (a map pick, undo): the fields show the new value.
    fireEvent.change(within(group).getByLabelText('X %'), { target: { value: '99' } });
    rerender(editor(moved));
    expect(x()).toBe('12');
    expect(within(group).getByLabelText<HTMLInputElement>('Y %').value).toBe('34');
    // Clear keeps focus: with no value it is aria-disabled, not disabled, and says why.
    const clear = within(group).getByRole('button', { name: 'Clear' });
    clear.focus();
    fireEvent.click(clear);
    expect(onChange).toHaveBeenLastCalledWith(null);
    rerender(editor(null));
    expect(x()).toBe('');
    const cleared = within(group).getByRole('button', { name: 'Clear' });
    expect(cleared).toBe(clear);
    expect(document.activeElement).toBe(clear);
    expect(cleared.hasAttribute('disabled')).toBe(false);
    expect(cleared.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(cleared.getAttribute('aria-describedby') ?? '')?.textContent).toBe(NOTHING_TO_CLEAR);
    fireEvent.click(cleared);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('is read-only when disabled', () => {
    render(<LocationEditor label="Location" value={null} dataset={MAP_TEST_DATASET} disabled onChange={() => undefined} pick={null} />);
    const group = screen.getByRole('group', { name: 'Location' });
    expect(group.textContent).toContain('Not set');
    expect(within(group).getByLabelText<HTMLInputElement>('X %').disabled).toBe(true);
  });
});

describe('DurationEditor', () => {
  it('takes minutes, stores whole seconds and says both', () => {
    const onChange = vi.fn<(seconds: number | null) => void>();
    const { rerender } = render(<DurationEditor value={null} disabled={false} onChange={onChange} />);
    const field = screen.getByLabelText('Duration override (minutes)');
    expect(document.getElementById(field.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/^Not set: the simulation’s estimate applies/);
    fireEvent.change(field, { target: { value: '12.5' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(750);
    rerender(<DurationEditor value={750} disabled={false} onChange={onChange} />);
    expect(screen.getByText(/Set: 12 minutes 30 seconds \(stored as 750 seconds\)/)).toBeTruthy();
    fireEvent.change(field, { target: { value: '-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set' }));
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('keeps focus in the field after Enter and follows the value (UI-F4)', () => {
    const onChange = vi.fn<(seconds: number | null) => void>();
    const { rerender } = render(<DurationEditor value={null} disabled={false} onChange={onChange} />);
    const field = screen.getByLabelText<HTMLInputElement>('Duration override (minutes)');
    field.focus();
    fireEvent.change(field, { target: { value: '2.5' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(150);
    rerender(<DurationEditor value={150} disabled={false} onChange={onChange} />);
    expect(screen.getByLabelText('Duration override (minutes)')).toBe(field);
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe('2.5');
    // Undo elsewhere: the field shows the value again.
    rerender(<DurationEditor value={null} disabled={false} onChange={onChange} />);
    expect(field.value).toBe('');
    const clear = screen.getByRole('button', { name: 'Clear' });
    expect(clear.getAttribute('aria-disabled')).toBe('true');
    expect(clear.hasAttribute('disabled')).toBe(false);
  });
});

describe('Details: pick on map', () => {
  function setup() {
    const workspace = mapTestWorkspace(undefined, NOW);
    const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(100), clock: fixedClock(NOW) });
    const fake = fakeAdapterFactory();
    const controller = createMapController({ store, data: workspace.data, geometry: workspace.geometry, describeStep: mapStepLabel, timing: null, objectUrls: null });
    const setupMap: MapEngineSetup = { geometry: workspace.geometry, art: null, loadAdapter: () => Promise.resolve(fake.factory) };
    const announce = vi.fn<(message: string) => void>();
    const actions = createRouteActions(store, announce, { geometry: workspace.geometry });
    const tree = () => {
      const view = buildRouteView(store.getState().project.route, workspace.dataset, 1);
      return (
        <>
          <MapPanel store={store} view={view} activeRow={null} map={{ setup: setupMap, controller }} announce={announce} />
          <DetailsPanel
            store={store}
            view={view}
            route={store.getState().project.route}
            dataset={workspace.dataset}
            activeRow={null}
            actions={actions}
            mapController={controller}
            announce={announce}
            onFocusList={() => undefined}
          />
        </>
      );
    };
    const utils = render(tree());
    return { store, controller, fake, announce, steps: workspace.steps, rerender: () => utils.rerender(tree()) };
  }

  it('takes the next map click as the step’s location, world form with the zone hint, and undoes as one edit', async () => {
    const s = setup();
    await act(async () => {
      await Promise.resolve();
    });
    const note = s.steps[0];
    if (note === undefined) throw new Error('note missing');
    act(() => {
      s.store.select({ kind: 'single', id: note.id });
    });
    s.rerender();
    act(() => {
      s.controller.jumpToZone(MAP_TEST_DUROTAR);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pick on map' }));
    expect(s.announce).toHaveBeenLastCalledWith('Click the map to place the location of step 1. Escape cancels.');
    expect(screen.getByText(pickText('the location of step 1'))).toBeTruthy();
    const location = screen.getByRole('group', { name: 'Location' });
    // A toggle keeps its name while pressed (UI-F18).
    expect(within(location).getByRole('button', { name: 'Pick on map' }).getAttribute('aria-pressed')).toBe('true');
    const adapter = s.fake.adapters[0];
    if (adapter === undefined) throw new Error('no adapter');
    act(() => {
      adapter.emit({ type: 'click', point: { mapId: MAP_TEST_KALIMDOR, x: 5.04, y: -4003.96 }, hit: null, zones: [] });
    });
    expect(s.store.getState().project.route.steps[0]?.location).toEqual({
      source: { space: 'world', mapId: MAP_TEST_KALIMDOR, x: 5, y: -4004, uiMapId: MAP_TEST_DUROTAR, lexemes: null },
      label: null,
      radius: null,
    });
    expect(s.announce).toHaveBeenLastCalledWith('Location of step 1 set.');
    expect(s.controller.getStatus().pick).toBeNull();
    expect(s.store.getState().history.undoLabel).toBe('Set location');
  });

  it('leaves Escape to an open modal dialog while a pick waits behind it (UI-F8)', async () => {
    const s = setup();
    await act(async () => {
      await Promise.resolve();
    });
    const note = s.steps[0];
    if (note === undefined) throw new Error('note missing');
    act(() => {
      s.store.select({ kind: 'single', id: note.id });
    });
    s.rerender();
    fireEvent.click(screen.getByRole('button', { name: 'Pick on map' }));
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    dialog.showModal();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(s.controller.getStatus().pick).not.toBeNull();
    dialog.close();
    dialog.remove();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(s.controller.getStatus().pick).toBeNull();
  });

  it('cancels with Escape or the map’s Cancel pick, and when the step leaves Details', async () => {
    const s = setup();
    await act(async () => {
      await Promise.resolve();
    });
    const [note, accept] = s.steps;
    if (note === undefined || accept === undefined) throw new Error('steps missing');
    act(() => {
      s.store.select({ kind: 'single', id: note.id });
    });
    s.rerender();
    fireEvent.click(screen.getByRole('button', { name: 'Pick on map' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(s.controller.getStatus().pick).toBeNull();
    expect(s.announce).toHaveBeenLastCalledWith('Pick on map cancelled.');
    fireEvent.click(screen.getByRole('button', { name: 'Pick on map' }));
    const mapToolbar = screen.getAllByRole('toolbar').find((toolbar) => within(toolbar).queryByRole('button', { name: 'Fit route' }) !== null);
    if (mapToolbar === undefined) throw new Error('map toolbar missing');
    fireEvent.click(within(mapToolbar).getByRole('button', { name: 'Cancel pick' }));
    expect(s.controller.getStatus().pick).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pick on map' }));
    act(() => {
      s.store.select({ kind: 'single', id: accept.id });
    });
    s.rerender();
    expect(s.controller.getStatus().pick).toBeNull();
    expect(s.store.getState().project.route.steps[0]?.location).toBeNull();
  });
});

describe('Details: imported guide text (UI-F7)', () => {
  it('shows a note plain, edits it as written, and says how it reads', () => {
    const workspace = mapTestWorkspace(undefined, NOW);
    const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(100), clock: fixedClock(NOW) });
    const note = workspace.steps[0];
    if (note === undefined) throw new Error('note missing');
    store.dispatch(editNoteText(note.id, 'Talk to |cRXP_FRIENDLY_Gornek|r |T133799:0|t'));
    store.select({ kind: 'single', id: note.id });
    const announce = vi.fn<(message: string) => void>();
    const view = buildRouteView(store.getState().project.route, workspace.dataset, 1);
    render(
      <DetailsPanel
        store={store}
        view={view}
        route={store.getState().project.route}
        dataset={workspace.dataset}
        activeRow={null}
        actions={createRouteActions(store, announce, { geometry: workspace.geometry })}
        announce={announce}
        onFocusList={() => undefined}
      />,
    );
    expect(screen.getByText('Talk to Gornek')).toBeTruthy();
    const text = screen.getByLabelText<HTMLInputElement>('Text');
    expect(text.value).toBe('Talk to |cRXP_FRIENDLY_Gornek|r |T133799:0|t');
    expect(document.getElementById(text.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Shown as “Talk to Gornek”: the guide’s colour and icon codes are kept for export.',
    );
  });
});
