// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEditorStore, type EditorStore, fixedClock } from '../app';
import { staticDatasetSource } from '../app/dataset-source';
import { createPlaceholderWorkspace, PLACEHOLDER_PROJECT_NAME } from '../app/placeholder-project';
import { sequentialIdSource } from '../app/shell-support';
import { App } from './App';
import { NOT_SIMULATED, PLACEHOLDER_DATA_NOTICE } from './app-model';
import { NO_MAP_FOR_ZONES, NOT_YET } from './app/AppTopBar';
import { SELECTION_ANNOUNCE_DELAY_MS } from './app/LiveAnnouncer';
import { loadDetailsPanel } from './app/lazy';

// The Details panel is a lazy part (ui-refresh.md UR.1a) that production builds preload when idle; so do these tests.
beforeAll(async () => {
  await loadDetailsPanel();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // The shell's choices are kept per browser (view-prefs.ts): each test starts from the defaults.
  localStorage.clear();
});

const NOW = '2026-09-25T12:00:00.000Z';

function setup(): { store: EditorStore; stepCount: () => number } {
  const { project, dataset } = createPlaceholderWorkspace({ nowIso: NOW });
  // Deterministic ids for inserted and duplicated steps (collisionFreeIds skips the project's own).
  const store = createEditorStore({ project, ids: sequentialIdSource(1000), clock: fixedClock(NOW) });
  render(<App store={store} data={staticDatasetSource(dataset)} projectName={PLACEHOLDER_PROJECT_NAME} version="0.0.0-test" sourceCommit={null} />);
  return { store, stepCount: () => store.getState().project.route.steps.length };
}

const list = () => screen.getByRole('listbox');
const option = (name: RegExp) => within(list()).getByRole('option', { name });
const sidePanel = () => screen.getByRole('complementary', { name: 'Quests and details' });
const tab = (name: RegExp) => within(sidePanel()).getByRole('tab', { name });
const routeActions = () => within(screen.getByRole('toolbar', { name: 'Selected steps' }));
/** The Add footer, named for where new steps go ("Add after step 12"). */
const addFooter = () => within(screen.getByRole('toolbar', { name: /^Add / }));
const history = () => within(screen.getByRole('toolbar', { name: 'History' }));
const liveRegion = (): HTMLElement => {
  const region = document.querySelector<HTMLElement>('.frl-app-live');
  if (region === null) throw new Error('live region missing');
  return region;
};
/** The live region's text without the no-break space that marks a repeated message. */
const announced = () => liveRegion().textContent.replace(/\u00a0$/, '');

/** A key pressed with focus outside any text field and outside the route editor. */
const pressGlobal = (key: string, init: KeyboardEventInit = {}) => {
  fireEvent.keyDown(document.body, { key, ...init });
};

/** A key pressed on an element inside the route editor that is not the list (a toolbar button). */
const pressInEditor = (key: string, init: KeyboardEventInit = {}) => {
  fireEvent.keyDown(addFooter().getByRole('button', { name: 'Note' }), { key, ...init });
};

const isUnavailable = (element: HTMLElement) => element.getAttribute('aria-disabled') === 'true';

describe('App over the Milestone 1 placeholder data (editing behaviour)', () => {
  it('says plainly that the data is a placeholder, and keeps the key to the marks in View', () => {
    setup();
    const editor = within(screen.getByRole('main', { name: 'Route editor' }));
    // The header tags the data; the meta line says it in words (ui-refresh.md §4.1).
    expect(editor.getByTitle('Placeholder data')).toBeTruthy();
    expect(editor.getByText(PLACEHOLDER_DATA_NOTICE)).toBeTruthy();
    expect(editor.getByText(/^\d+ steps · Orc Warrior from level 1$/)).toBeTruthy();
    // View is a disclosure: the rows' density, their numbers, and the key that replaced the banner's.
    const view = editor.getByRole('button', { name: 'View' });
    expect(view.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(view);
    expect(view.getAttribute('aria-expanded')).toBe('true');
    const panel = within(editor.getByRole('group', { name: 'View' }));
    expect(panel.getByRole('radio', { name: 'Two lines' })).toHaveProperty('checked', true);
    expect(panel.getByRole('radio', { name: 'XP gained' })).toHaveProperty('checked', true);
    expect(panel.getByText(/unknown, with the reason in its tooltip/)).toBeTruthy();
    fireEvent.click(panel.getByRole('radio', { name: 'One line' }));
    expect(list().querySelector('.frl-row--one-line')).not.toBeNull();
    expect(within(editor.getByRole('group', { name: 'View' })).getByRole('combobox', { name: 'Rows show' })).toBeTruthy();
    fireEvent.keyDown(editor.getByRole('group', { name: 'View' }), { key: 'Escape' });
    expect(view.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(view);
    const status = screen.getByRole('region', { name: 'Route status' });
    expect(status.textContent).toContain('Data placeholder');
  });

  it('has the product name as the page heading', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Forever Route Lab' })).toBeTruthy();
  });

  it('shows unknown derived numbers as unknown, with the reason, never as numbers', () => {
    setup();
    const status = screen.getByRole('region', { name: 'Route status' });
    // Duration, XP and XP per hour; without a route simulation they say so.
    expect(within(status).getAllByText(`Unknown: ${NOT_SIMULATED}`)).toHaveLength(3);
    const xp = within(status).getByRole('progressbar', { name: 'Projected level' });
    expect(xp.getAttribute('aria-valuetext')).toBe(`At least level 1, XP unknown: ${NOT_SIMULATED}`);
    expect(status.textContent).toContain('Not available');
  });

  it('gives the placeholder data badge no build stamp', () => {
    setup();
    const status = screen.getByRole('region', { name: 'Route status' });
    const titles = [...status.querySelectorAll('[title]')].map((el) => el.getAttribute('title') ?? '');
    const data = titles.find((title) => title.startsWith(PLACEHOLDER_DATA_NOTICE));
    expect(data).toBeDefined();
    expect(data).not.toMatch(/frame build/);
  });

  it('lists the placeholder route with its group header and selects steps from the list', () => {
    const { store } = setup();
    expect(within(list()).getByRole('option', { name: /^Group: Step group, 3 steps/ })).toBeTruthy();
    fireEvent.click(option(/^2\. Accept quest: Placeholder Quest 1/));
    expect(store.getState().selection.stepIds.size).toBe(1);
    fireEvent.click(option(/^3\. Accept quest/), { ctrlKey: true });
    expect(store.getState().selection.stepIds.size).toBe(2);
    fireEvent.click(option(/^6\. Complete objectives/), { shiftKey: true });
    expect(store.getState().selection.stepIds.size).toBe(4);
    fireEvent.click(option(/^Group: Step group/));
    expect(store.getState().selection.stepIds.size).toBe(3);
  });

  it('shows the active step and its quest in Details, with difficulty from the start level', () => {
    setup();
    fireEvent.click(option(/^2\. Accept quest: Placeholder Quest 1/));
    fireEvent.click(tab(/^Details/));
    const panel = within(sidePanel());
    expect(panel.getAllByText('Placeholder Quest 1: kill objective').length).toBeGreaterThan(0);
    expect(panel.getByText('Open to Orc Warrior')).toBeTruthy();
    expect(panel.getByText('Kill Placeholder Boar (count unknown)')).toBeTruthy();
    expect(panel.getByText(/Quest level 1, Difficult \(yellow\), from a lower-bound level/)).toBeTruthy();
    expect(panel.getByText('Forever status: unknown')).toBeTruthy();
  });

  it('deletes, moves, duplicates and locks from the keyboard, and undoes and redoes', () => {
    const { store, stepCount } = setup();
    fireEvent.click(option(/^2\. Accept quest/));
    fireEvent.keyDown(list(), { key: 'Delete' });
    expect(stepCount()).toBe(39);
    pressGlobal('z', { ctrlKey: true });
    expect(stepCount()).toBe(40);
    pressGlobal('Z', { ctrlKey: true, shiftKey: true });
    expect(stepCount()).toBe(39);
    pressGlobal('y', { ctrlKey: true });
    expect(stepCount()).toBe(39);
    pressGlobal('z', { ctrlKey: true });

    fireEvent.click(option(/^2\. Accept quest: Placeholder Quest 1/));
    fireEvent.keyDown(list(), { key: 'ArrowDown', altKey: true });
    expect(option(/^3\. Accept quest: Placeholder Quest 1/)).toBeTruthy();
    fireEvent.keyDown(list(), { key: 'd', ctrlKey: true });
    expect(stepCount()).toBe(41);
    fireEvent.keyDown(list(), { key: 'l' });
    expect(store.getState().project.route.steps.filter((s) => s.locked)).toHaveLength(2);
  });

  it('gives duplicated steps deterministic ids', () => {
    const { store } = setup();
    fireEvent.click(option(/^2\. Accept quest: Placeholder Quest 1/));
    fireEvent.keyDown(list(), { key: 'd', ctrlKey: true });
    expect(store.getState().project.route.steps[2]?.id).toMatch(/^step-1\d{3}$/);
  });

  it('runs the route shortcuts anywhere inside the route editor', () => {
    const { store, stepCount } = setup();
    fireEvent.click(option(/^5\. Travel/));
    pressInEditor('ArrowUp', { altKey: true });
    expect(option(/^4\. Travel/)).toBeTruthy();
    pressInEditor('d', { ctrlKey: true });
    expect(stepCount()).toBe(41);
    pressInEditor('Delete');
    expect(stepCount()).toBe(40);
    pressInEditor('a', { ctrlKey: true });
    expect(store.getState().selection.stepIds.size).toBe(40);
    pressInEditor('Escape');
    expect(store.getState().selection.stepIds.size).toBe(0);
  });

  it('keeps Delete, Alt+arrows, Ctrl+D and Ctrl+A away from the route when focus is elsewhere', () => {
    const { store, stepCount } = setup();
    fireEvent.click(option(/^5\. Travel/));
    const details = tab(/^Details/);
    for (const target of [details, document.body]) {
      fireEvent.keyDown(target, { key: 'Delete' });
      fireEvent.keyDown(target, { key: 'ArrowUp', altKey: true });
      fireEvent.keyDown(target, { key: 'd', ctrlKey: true });
      fireEvent.keyDown(target, { key: 'a', ctrlKey: true });
      fireEvent.keyDown(target, { key: 'Escape' });
    }
    expect(stepCount()).toBe(40);
    expect(option(/^5\. Travel/)).toBeTruthy();
    expect(store.getState().selection.stepIds.size).toBe(1);
    expect(store.getState().history.canUndo).toBe(false);
  });

  it('keeps undo, redo and Ctrl+K global', () => {
    const { stepCount } = setup();
    fireEvent.click(option(/^1\. Note/));
    fireEvent.keyDown(list(), { key: 'Delete' });
    fireEvent.keyDown(tab(/^Details/), { key: 'z', ctrlKey: true });
    expect(stepCount()).toBe(40);
    fireEvent.keyDown(tab(/^Details/), { key: 'y', ctrlKey: true });
    expect(stepCount()).toBe(39);
    pressGlobal('k', { ctrlKey: true });
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search quests' }));
  });

  it('inserts note, travel and grind steps after the selection, from the Add footer that names the place', () => {
    const { store, stepCount } = setup();
    fireEvent.click(option(/^1\. Note/));
    expect(screen.getByRole('toolbar', { name: 'Add after step 1' })).toBeTruthy();
    fireEvent.click(addFooter().getByRole('button', { name: 'Travel' }));
    expect(option(/^2\. Travel: to an unknown place/)).toBeTruthy();
    fireEvent.click(addFooter().getByRole('button', { name: 'Grind' }));
    expect(option(/^3\. Grind: for 15m 00s/)).toBeTruthy();
    fireEvent.click(addFooter().getByRole('button', { name: 'Note' }));
    expect(stepCount()).toBe(43);
    // The new note opens in Details, where its text can be edited.
    const text = within(sidePanel()).getByRole('textbox', { name: 'Text' });
    fireEvent.change(text, { target: { value: 'My own note' } });
    expect(option(/^4\. Note: My own note/)).toBeTruthy();
    expect(store.getState().history.undoLabel).toBe('Edit note text');
  });

  it('marks undo and redo unavailable from the history, keeping them focusable', () => {
    setup();
    const undo = history().getByRole('button', { name: 'Nothing to undo' });
    expect(isUnavailable(undo)).toBe(true);
    expect(undo.hasAttribute('disabled')).toBe(false);
    fireEvent.click(option(/^1\. Note/));
    fireEvent.keyDown(list(), { key: 'Delete' });
    expect(isUnavailable(undo)).toBe(false);
    expect(undo.getAttribute('aria-label')).toBe('Undo Delete steps');
    expect(undo.getAttribute('aria-keyshortcuts')).toBe('Control+Z');
    undo.focus();
    fireEvent.click(undo);
    // The last entry is undone: Undo is unavailable again but keeps focus (F-03).
    expect(isUnavailable(undo)).toBe(true);
    expect(document.activeElement).toBe(undo);
    expect(isUnavailable(history().getByRole('button', { name: 'Redo Delete steps' }))).toBe(false);
  });

  it('keeps focus in the route list after the toolbar deletes the last selected step', () => {
    const { stepCount } = setup();
    fireEvent.click(option(/^3\. Accept quest/));
    const remove = routeActions().getByRole('button', { name: 'Delete selected steps' });
    remove.focus();
    fireEvent.click(remove);
    expect(stepCount()).toBe(39);
    expect(document.activeElement).toBe(list());
    // Unavailable now (nothing selected), still focusable, and inert.
    expect(isUnavailable(remove)).toBe(true);
    fireEvent.click(remove);
    expect(stepCount()).toBe(39);
  });

  it('keeps focus in the route list after Details deletes the step it shows', () => {
    const { stepCount } = setup();
    fireEvent.click(option(/^3\. Accept quest/));
    fireEvent.click(tab(/^Details/));
    const remove = within(sidePanel()).getByRole('button', { name: 'Delete' });
    remove.focus();
    fireEvent.click(remove);
    expect(stepCount()).toBe(39);
    expect(document.activeElement).toBe(list());
  });

  it('turns editing off while editing is locked (optimiser run or proposal)', () => {
    const { store, stepCount } = setup();
    act(() => {
      store.acquireLock('proposal');
    });
    const note = addFooter().getByRole('button', { name: 'Note' });
    expect(isUnavailable(note)).toBe(true);
    fireEvent.click(note);
    fireEvent.click(option(/^1\. Note/));
    fireEvent.keyDown(list(), { key: 'Delete' });
    pressInEditor('Delete');
    expect(stepCount()).toBe(40);
    expect(isUnavailable(routeActions().getByRole('button', { name: 'Delete selected steps' }))).toBe(true);
    act(() => {
      store.releaseLock('proposal');
    });
    expect(isUnavailable(note)).toBe(false);
  });

  it('lists placeholder quests open to the character and filters them by search', () => {
    setup();
    const quests = () => within(within(sidePanel()).getByRole('grid', { name: 'Quests' })).getAllByRole('row').filter((row) => row.classList.contains('frl-quest-item'));
    expect(quests()).toHaveLength(7);
    expect(within(sidePanel()).getByText('1 quest not shown: not open to Orc Warrior.')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search quests' }), { target: { value: 'second zone' } });
    expect(quests()).toHaveLength(1);
  });

  it('never claims "no issues" or an empty quest log before the route is checked', async () => {
    setup();
    expect(tab(/^Validation/).textContent).toBe('Validation');
    fireEvent.click(tab(/^Validation/));
    expect(await within(sidePanel()).findByText('Not checked yet')).toBeTruthy();
    expect(within(sidePanel()).getByText(new RegExp(`^${NOT_SIMULATED}\\. No issues are reported`))).toBeTruthy();
    fireEvent.click(tab(/^Quest log/));
    expect(tab(/^Quest log/).textContent).toBe('Quest log');
    expect(await within(sidePanel()).findByText('Not checked yet')).toBeTruthy();
    expect(within(sidePanel()).getByText(`${NOT_SIMULATED}.`)).toBeTruthy();
  });

  it('changes the theme through the store', () => {
    const { store } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^System theme\. Switch to light theme/ }));
    expect(store.getState().view.theme).toBe('light');
  });

  it('renders the actions this shell cannot run unavailable, saying why', () => {
    setup();
    const toolbar = within(screen.getByRole('toolbar', { name: 'Project actions' }));
    // Settings opens its dialog (Milestone 4); import and export need project storage, which this shell has none of.
    expect(isUnavailable(toolbar.getByRole('button', { name: 'Orc Warrior · Horde, settings' }))).toBe(false);
    const expected = { Import: NOT_YET.import, Export: NOT_YET.export } as const;
    for (const [name, reason] of Object.entries(expected)) {
      const button = toolbar.getByRole('button', { name });
      expect(isUnavailable(button)).toBe(true);
      expect(button.hasAttribute('disabled')).toBe(false);
      const described = document.getElementById(button.getAttribute('aria-describedby') ?? '');
      expect(described?.textContent).toBe(reason);
      fireEvent.click(button);
    }
    // This shell has no map (no geometry was given), so jump-to-zone says so.
    const go = screen.getByRole('button', { name: 'Go to the chosen zone or view' });
    expect(isUnavailable(go)).toBe(true);
    expect(document.getElementById(go.getAttribute('aria-describedby') ?? '')?.textContent).toBe(NO_MAP_FOR_ZONES);
    // No notice appears anywhere: the reasons are descriptions, not messages.
    expect(announced()).toBe('');
  });

  it('keeps one polite live region mounted, empty until something happens', () => {
    setup();
    const region = liveRegion();
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
    expect(document.querySelectorAll('.frl-app-live')).toHaveLength(1);
  });

  it('announces row-command results', () => {
    setup();
    fireEvent.click(option(/^3\. Accept quest/));
    fireEvent.keyDown(list(), { key: 'Delete' });
    expect(announced()).toBe('1 step deleted. Undo with Ctrl+Z.');
    pressGlobal('z', { ctrlKey: true });
    expect(announced()).toBe('Undone: Delete steps.');
    fireEvent.keyDown(list(), { key: 'ArrowDown', altKey: true });
    expect(announced()).toBe('1 step moved down: now step 4.');
    fireEvent.keyDown(list(), { key: 'l' });
    expect(announced()).toBe('1 step locked.');
    fireEvent.keyDown(list(), { key: 'd', ctrlKey: true });
    expect(announced()).toBe('1 step duplicated: the copy is step 5.');
    fireEvent.click(addFooter().getByRole('button', { name: 'Travel' }));
    expect(announced()).toBe('Travel inserted as step 6.');
  });

  it('announces the selection count once it settles, and "Selection cleared"', () => {
    vi.useFakeTimers();
    setup();
    fireEvent.click(option(/^2\. Accept quest/));
    fireEvent.keyDown(list(), { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(list(), { key: 'ArrowDown', shiftKey: true });
    expect(announced()).toBe('');
    act(() => {
      vi.advanceTimersByTime(SELECTION_ANNOUNCE_DELAY_MS);
    });
    expect(announced()).toBe('3 steps selected');
    fireEvent.keyDown(list(), { key: 'a', ctrlKey: true });
    act(() => {
      vi.advanceTimersByTime(SELECTION_ANNOUNCE_DELAY_MS);
    });
    expect(announced()).toBe('40 steps selected');
    pressInEditor('Escape');
    act(() => {
      vi.advanceTimersByTime(SELECTION_ANNOUNCE_DELAY_MS);
    });
    expect(announced()).toBe('Selection cleared');
  });

  it('does not announce plain arrowing, which keeps one step selected', () => {
    vi.useFakeTimers();
    setup();
    fireEvent.click(option(/^2\. Accept quest/));
    act(() => {
      vi.advanceTimersByTime(SELECTION_ANNOUNCE_DELAY_MS);
    });
    expect(announced()).toBe('1 step selected');
    fireEvent.keyDown(list(), { key: 'ArrowDown' });
    fireEvent.keyDown(list(), { key: 'ArrowDown' });
    act(() => {
      vi.advanceTimersByTime(SELECTION_ANNOUNCE_DELAY_MS);
    });
    expect(liveRegion().textContent).toBe('1 step selected');
  });

  it('toggles map focus with Alt+M anywhere outside a text field, and keeps the choice per browser (ui-refresh.md §4.3)', () => {
    setup();
    const editor = () => document.querySelector('main') as HTMLElement;
    pressGlobal('m', { altKey: true, code: 'KeyM' });
    expect(editor().hidden).toBe(true);
    expect((document.querySelector('aside') as HTMLElement).hidden).toBe(true);
    expect(screen.getByRole('button', { name: 'Map focus' }).getAttribute('aria-pressed')).toBe('true');
    expect(JSON.parse(localStorage.getItem('forever-route-lab:shell') ?? '{}')).toMatchObject({ mapFocus: true });
    // In a text field Alt+M is the field's.
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search quests' }), { key: 'µ', altKey: true, code: 'KeyM' });
    expect(editor().hidden).toBe(true);
    pressGlobal('µ', { altKey: true, code: 'KeyM' });
    expect(editor().hidden).toBe(false);
    cleanup();
    // A new visit starts from what was kept: here, the route panel collapsed from its handle.
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Hide the route panel' }));
    cleanup();
    setup();
    expect((document.querySelector('main') as HTMLElement).hidden).toBe(true);
    expect(screen.getByRole('button', { name: 'Show the route panel' })).toBeTruthy();
  });

  it('opens and closes the About dialog, which says the data is a placeholder', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'About Forever Route Lab' }));
    const dialog = screen.getByRole('dialog', { name: 'About Forever Route Lab' });
    expect(dialog.textContent).toContain('This build runs on placeholder data');
    expect(within(dialog).queryByRole('link', { name: 'Full data notice' })).toBeNull();
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' })[0] as HTMLElement);
    expect(dialog.textContent).toBe('');
  });
});
