// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEditorStore, type DerivedState, type EditorStore, fixedClock, IDLE_PATHS } from '../app';
import { mapTestWorkspace } from '../app/map-test-helpers';
import { DerivedStoreProvider } from '../app/react';
import { sequentialIdSource } from '../app/shell-support';
import type { QuestId } from '../domain/ids';
import { App } from './App';
import { PATHS_PAUSED_MESSAGE, PATHS_RESUMED_MESSAGE } from './app/AppStatusBar';
import { derivedResults, derivedStoreWith, issue, known, readyState, unknownValue } from './app/derived-test-helpers';
import type * as DerivedView from './app/derived-view';
import { loadDetailsPanel } from './app/lazy';
import { SELECTION_ANNOUNCE_DELAY_MS } from './app/LiveAnnouncer';

// View is a lazy part (ui-refresh.md §10.3) that production builds preload when idle; so do these tests.
beforeAll(async () => {
  await loadDetailsPanel();
});

// Counts how often the rows' deriver and the status bar's metrics are worked out (PERF-11).
const { deriverCalls, metricsViewCalls } = vi.hoisted(() => ({ deriverCalls: { count: 0 }, metricsViewCalls: { count: 0 } }));
vi.mock('./app/derived-view', async (importOriginal) => {
  const original = await importOriginal<typeof DerivedView>();
  return {
    ...original,
    createRowDeriver: (...args: Parameters<typeof original.createRowDeriver>) => {
      deriverCalls.count += 1;
      return original.createRowDeriver(...args);
    },
    routeMetricsView: (...args: Parameters<typeof original.routeMetricsView>) => {
      metricsViewCalls.count += 1;
      return original.routeMetricsView(...args);
    },
  };
});

/**
 * The simulation and validation results in the shell (docs/UI.md §16), from a derived store with
 * hand-built results: the rows' estimates, markers, pending travel and issue indicators; the status
 * bar's metrics, summary and computing-paths item with Cancel and Resume; the validation panel, its
 * explanations, filter and keyboard path from an issue to its step.
 */

afterEach(() => {
  cleanup();
  // View's choices are kept per browser (view-prefs.ts): each test starts from the defaults.
  localStorage.clear();
});

const NOW = '2026-09-25T12:00:00.000Z';

interface Setup {
  readonly store: EditorStore;
  readonly calls: string[];
  readonly steps: ReturnType<typeof mapTestWorkspace>['steps'];
  readonly publish: (patch: Partial<DerivedState>) => void;
}

function setup(patch: Partial<DerivedState> = {}, resume: 'running' | 'idle' = 'running'): Setup {
  const workspace = mapTestWorkspace(undefined, NOW);
  const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(100), clock: fixedClock(NOW) });
  const [, accept1, accept2, complete, turnIn] = workspace.steps;
  const results = derivedResults(workspace.project, {
    revision: store.getState().revision,
    steps: [
      {},
      { duration: known(12, 'derived'), xpGained: known(0, 'source'), level: 1 },
      { duration: known(8, 'assumption'), xpGained: known(0, 'source'), level: 1 },
      { duration: known(600, 'assumption', true), xpGained: known(450, 'assumption', true), level: 2, levelBasis: 'assumption', eraFallback: true, xpAfter: 50, facts: [{ kind: 'pending-leg' }] },
      { duration: unknownValue, xpGained: unknownValue, level: 2, lowerBound: true, facts: [{ kind: 'time-unknown', part: 'objective', reason: 'reputation-objective', questId: null, objective: null }] },
    ],
    issues: [
      issue('SIM022-legs-pending', 'info', null, 'Travel legs still being computed: 1 on step 4.'),
      issue('VAL004-min-level', 'error', accept2?.id ?? null, 'Cull needs level 3; the character is level 1.'),
      issue('LINT003-low-value', 'warning', complete?.id ?? null, 'Cull is of low value at level 2: it is grey.'),
      issue('VAL030-not-in-log', 'error', turnIn?.id ?? null, 'Cull is not in the quest log.'),
    ],
  });
  if (accept1 === undefined) throw new Error('fixture changed');
  const handle = derivedStoreWith(readyState(results, patch), resume);
  render(
    <DerivedStoreProvider store={handle.store}>
      <App store={store} data={workspace.data} projectName="Derived test" version="0.0.0-test" sourceCommit={null} />
    </DerivedStoreProvider>,
  );
  return { store, calls: handle.calls, steps: workspace.steps, publish: handle.publish };
}

const list = () => screen.getByRole('listbox');
const options = () => within(list()).getAllByRole('option');
const status = () => within(screen.getByRole('region', { name: 'Route status' }));
const sidePanel = () => within(screen.getByRole('complementary', { name: 'Quests and details' }));
const announced = () => document.querySelector('.frl-app-live')?.textContent.replace(/\u00a0$/, '') ?? '';

async function openValidation(): Promise<void> {
  fireEvent.click(sidePanel().getByRole('tab', { name: /^Validation/ }));
  await sidePanel().findByRole('list', { name: 'Issues' });
}

describe('route rows with the walk’s numbers', () => {
  it('name every estimate with its basis, pending travel and the issues by severity', () => {
    setup();
    const [, first, second, third, fourth] = options();
    expect(first?.getAttribute('aria-label')).toContain('Level after step 1.0. XP gained 0 XP. Time 12 seconds.');
    expect(second?.getAttribute('aria-label')).toContain('Time 8 seconds (depends on assumptions). Issues: 1 error.');
    const pending = third?.getAttribute('aria-label') ?? '';
    expect(pending).toContain('XP gained 450 XP (depends on assumptions, uses Era values)');
    expect(pending).toContain('Time 10 minutes (depends on assumptions, uses Era values), pending: its walking path is still being computed');
    expect(pending).toContain('Issues: 1 warning.');
    expect(third?.className).toContain('is-pending');
    // Unknown stays unknown, with the walk's reason, never 0.
    expect(fourth?.getAttribute('aria-label')).toContain('XP gained unknown: This step’s XP cannot be worked out');
    expect(fourth?.getAttribute('aria-label')).toContain('Time unknown: A reputation objective has no time estimate');
    expect(fourth?.getAttribute('aria-label')).toContain('Level after step at least 2.0');
  });

  it('show XP gained over the level after in two-line rows, the step time on top as a View choice, and one chosen column in one-line rows', () => {
    setup();
    const top = (row: HTMLElement | undefined) => row?.querySelector('.frl-steprow__top');
    const bottom = (row: HTMLElement | undefined) => row?.querySelector('.frl-steprow__bottom');
    expect(top(options()[3])?.getAttribute('data-column')).toBe('xp');
    expect(top(options()[3])?.textContent).toContain('+450');
    expect(top(options()[3])?.querySelector('[data-reason="assumption"]')).not.toBeNull();
    // Level 1 to level 2 after step 3: a level-up.
    expect(bottom(options()[3])?.querySelector('.frl-steprow__up')).not.toBeNull();
    expect(options()[3]?.getAttribute('aria-label')).toContain(', reaches level 2.');
    // A known zero is muted (review UO-14).
    expect(top(options()[1])?.querySelector('.frl-steprow__xp')?.className).toContain('is-zero');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Step time' }));
    expect(top(options()[3])?.textContent).toContain('10m 00s');
    expect(top(options()[3])?.querySelector('[data-state="pending"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'One line' }));
    const cell = (row: HTMLElement | undefined) => row?.querySelector('.frl-steprow__estimate');
    expect(cell(options()[3])?.getAttribute('data-column')).toBe('level');
    fireEvent.change(screen.getByRole('combobox', { name: 'Rows show' }), { target: { value: 'time' } });
    expect(cell(options()[3])?.textContent).toContain('10m 00s');
    expect(cell(options()[4])?.querySelector('[data-state="unknown"]')?.textContent).toContain('?');
  });

  it('draw each quest step\u2019s mark from its issues, and put the worst issue in words on line 2', () => {
    setup();
    // Step 3 accepts Cull with an error at the step: locked, and line 2 names the error.
    const locked = options()[2];
    expect(locked?.querySelector('.frl-quest-mark')?.getAttribute('data-state')).toBe('locked');
    expect(locked?.querySelector('.frl-steprow__issue')?.textContent).toContain('Cull needs level 3; the character is level 1.');
    expect(locked?.getAttribute('aria-label')).toContain('Cannot be accepted here.');
    expect(locked?.getAttribute('aria-label')).toContain('Error: Cull needs level 3; the character is level 1.');
    expect(options()[1]?.querySelector('.frl-quest-mark')?.getAttribute('data-state')).toBe('available');
  });

  it('draw the insertion line and the later band after the selection, and name the Add footer for the place', () => {
    const s = setup();
    const step = s.steps[1];
    if (step === undefined) throw new Error('step missing');
    act(() => {
      s.store.select({ kind: 'single', id: step.id });
    });
    // Two 44px rows, the second of them the active row, grown by 32px (B+, D-051).
    const insert = document.querySelector<HTMLElement>('.frl-routelist__insert');
    expect(insert?.style.top).toBe('120px');
    expect(document.querySelector<HTMLElement>('.frl-routelist__later')?.style.top).toBe('120px');
    expect(screen.getByRole('toolbar', { name: 'Add after step 2' })).toBeTruthy();
  });
});

describe('the status bar', () => {
  it('shows the route metrics with their markers, pending while walking paths are computed', () => {
    setup();
    const time = status().getByTitle("The route's duration");
    expect(time.querySelector('[data-state="pending"]')?.getAttribute('title')).toBe(
      'Pending: 1 walking leg is still being computed; its time uses the straight-line estimate.',
    );
    expect(time.textContent).toContain('at least 10 minutes 20 seconds');
    expect(time.querySelector('[data-reason="assumption"]')).not.toBeNull();
  });

  it('opens the route summary with every metric and its basis, and closes it with Escape', () => {
    setup();
    const button = status().getByRole('button', { name: 'Summary' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const summary = screen.getByRole('region', { name: 'Route summary' });
    const rows = within(summary).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      'Duration',
      'XP gained',
      'Level reached',
      'XP per hour',
      'Travel',
      'Combat and objectives',
      'Interaction',
      'Waiting',
    ]);
    expect(rows[1]?.textContent).toContain('depends on assumptions; uses Era values');
    expect(summary.textContent).toContain('Navigation data is unavailable (this deploy has no navigation data): every travel time is a straight-line estimate.');
    button.focus();
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Route summary' })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('states straight-line travel plainly, never as an error dialog', () => {
    setup();
    const item = document.querySelector('.frl-statusbar__simulation');
    expect(item?.getAttribute('data-state')).toBe('straight-line');
    expect(item?.textContent).toContain('Straight-line estimates');
    expect(item?.textContent).toContain('every travel time is a straight-line estimate');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('shows computing paths with progress, and Cancel then Resume with focus kept and the result announced', () => {
    const s = setup({
      travel: { model: 'navigation', reason: null, revision: 'nav-1', unavailableMaps: [], unavailableAll: false },
      paths: { ...IDLE_PATHS, state: 'running', revision: 0, done: 3, total: 8 },
    });
    const progress = status().getByRole('progressbar', { name: 'Walking paths computed' });
    expect(progress.getAttribute('aria-valuenow')).toBe('3');
    expect(progress.getAttribute('aria-valuemax')).toBe('8');
    expect(progress.getAttribute('aria-valuetext')).toBe('3 of 8 legs');
    const cancel = status().getByRole('button', { name: 'Cancel computing walking paths' });
    cancel.focus();
    fireEvent.click(cancel);
    expect(s.calls).toEqual(['cancel']);
    expect(announced()).toBe(PATHS_PAUSED_MESSAGE);
    const resume = status().getByRole('button', { name: 'Resume computing walking paths' });
    expect(document.activeElement).toBe(resume);
    expect(document.querySelector('.frl-statusbar__simulation')?.textContent).toContain('Paused, 1 leg pending');
    fireEvent.click(resume);
    expect(s.calls).toEqual(['cancel', 'resume']);
    expect(announced()).toBe(PATHS_RESUMED_MESSAGE);
    expect(document.activeElement).toBe(status().getByRole('button', { name: 'Cancel computing walking paths' }));
  });

  it('keeps focus on Cancel after a Resume that goes idle first, and on the item when computing ends (UI-03)', () => {
    const navigation = { model: 'navigation', reason: null, revision: 'nav-1', unavailableMaps: [], unavailableAll: false } as const;
    const s = setup({ travel: navigation, paths: { ...IDLE_PATHS, state: 'paused', revision: 0, done: 3, total: 8 } }, 'idle');
    const resume = status().getByRole('button', { name: 'Resume computing walking paths' });
    resume.focus();
    fireEvent.click(resume);
    // The pipeline publishes idle until its next walk: the legs are still pending, so the item says
    // they are being counted, and Cancel takes Resume's place and focus.
    const item = () => document.querySelector('.frl-statusbar__simulation');
    expect(item()?.textContent).toContain('Counting legs');
    expect(item()?.textContent).not.toContain('0/0');
    const cancel = status().getByRole('button', { name: 'Cancel computing walking paths' });
    expect(document.activeElement).toBe(cancel);
    act(() => {
      s.publish({ paths: { ...IDLE_PATHS, state: 'running', revision: 0, done: 0, total: 5 } });
    });
    expect(document.activeElement).toBe(status().getByRole('button', { name: 'Cancel computing walking paths' }));
    // Computing ends in the background while Cancel has focus: the item stays, focused, until left.
    act(() => {
      s.publish({ paths: IDLE_PATHS, results: derivedResults(s.store.getState().project, { revision: s.store.getState().revision }) });
    });
    expect(item()?.getAttribute('data-state')).toBe('ready');
    expect(document.activeElement).toBe(item());
    expect(document.activeElement).not.toBe(document.body);
  });

  it('re-renders only the simulation item for a paths-progress tick (PERF-11)', () => {
    const navigation = { model: 'navigation', reason: null, revision: 'nav-1', unavailableMaps: [], unavailableAll: false } as const;
    const s = setup({ travel: navigation, paths: { ...IDLE_PATHS, state: 'running', revision: 0, done: 3, total: 8 } });
    const derivedCalls = deriverCalls.count;
    const metricsCalls = metricsViewCalls.count;
    act(() => {
      s.publish({ paths: { ...IDLE_PATHS, state: 'running', revision: 0, done: 4, total: 8 } });
    });
    expect(status().getByRole('progressbar', { name: 'Walking paths computed' }).getAttribute('aria-valuetext')).toBe('4 of 8 legs');
    // Neither the rows nor the status bar's metrics were worked out again.
    expect(deriverCalls.count).toBe(derivedCalls);
    expect(metricsViewCalls.count).toBe(metricsCalls);
    // New results do reach them.
    act(() => {
      s.publish({ results: derivedResults(s.store.getState().project, { revision: s.store.getState().revision }) });
    });
    expect(deriverCalls.count).toBeGreaterThan(derivedCalls);
    expect(metricsViewCalls.count).toBeGreaterThan(metricsCalls);
  });
});

describe('the validation panel', () => {
  it('counts the issues on its tab, and lists each with its explanation from the registry', async () => {
    setup();
    expect(sidePanel().getByRole('tab', { name: /^Validation/ }).textContent).toContain('4');
    await openValidation();
    const issues = sidePanel().getByRole('list', { name: 'Issues' });
    const error = within(issues).getByRole('button', { name: 'Error, step 3: Cull needs level 3; the character is level 1. (VAL004-min-level)' });
    const explanation = document.getElementById(error.getAttribute('aria-describedby') ?? '');
    expect(explanation?.textContent).toBe("The character's level must reach the quest's required level. A quest's colour never blocks it.");
    // A route-level issue has no step to jump to: it is text, not a button.
    expect(within(issues).getByText('Travel legs still being computed: 1 on step 4.').closest('button')).toBeNull();
    expect(sidePanel().getByText('2 errors, 1 warning, 1 info issue')).toBeTruthy();
  });

  it('filters by severity and says how many are shown', async () => {
    setup();
    await openValidation();
    fireEvent.change(sidePanel().getByRole('combobox', { name: 'Show' }), { target: { value: 'error' } });
    const issues = sidePanel().getByRole('list', { name: 'Issues' });
    expect(within(issues).getAllByRole('listitem')).toHaveLength(2);
    expect(within(issues).getAllByRole('listitem').every((item) => item.getAttribute('data-severity') === 'error')).toBe(true);
    expect(announced()).toBe('Showing 2 errors.');
  });

  it('moves between issues with the arrow keys and jumps from an issue to its step, focused in the route', async () => {
    const s = setup();
    await openValidation();
    const user = userEvent.setup();
    const buttons = () => within(sidePanel().getByRole('list', { name: 'Issues' })).getAllByRole('button');
    // One tab stop: the first issue with a step.
    expect(buttons().map((b) => b.tabIndex)).toEqual([0, -1, -1]);
    buttons()[0]?.focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(buttons()[1]);
    expect(buttons().map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(buttons()[2]);
    await user.keyboard('{Home}');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    const complete = s.steps[3];
    if (complete === undefined) throw new Error('fixture changed');
    expect([...s.store.getState().selection.stepIds]).toEqual([complete.id]);
    expect(document.activeElement).toBe(list());
    const active = document.getElementById(list().getAttribute('aria-activedescendant') ?? '');
    expect(active?.getAttribute('aria-label')).toMatch(/^4\. Complete objectives: Cull/);
    expect(active?.getAttribute('aria-selected')).toBe('true');
    expect(announced()).toBe('Showing step 4 in the route: warning LINT003-low-value.');
    // Only that is said: the new selection's count ("1 step selected") is not said after it (UI-11).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SELECTION_ANNOUNCE_DELAY_MS + 100));
    });
    expect(announced()).toBe('Showing step 4 in the route: warning LINT003-low-value.');
    // The panel stays on Validation, so the next issue is one Tab away.
    expect(sidePanel().getByRole('tab', { name: /^Validation/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows the active step’s issues in Details', async () => {
    const s = setup();
    const accept2 = s.steps[2];
    if (accept2 === undefined) throw new Error('fixture changed');
    act(() => {
      s.store.select({ kind: 'single', id: accept2.id });
    });
    fireEvent.click(sidePanel().getByRole('tab', { name: /^Details/ }));
    const section = await sidePanel().findByRole('list', { name: 'Issues at step 3' });
    expect(within(section).getByText('Cull needs level 3; the character is level 1.')).toBeTruthy();
    expect(within(section).queryByRole('button')).toBeNull();
    expect(sidePanel().getByText('Duration').closest('div')?.textContent).toContain('8s');
  });

  it('says in Details what a turn-in’s numbers include when it carries objective work (D-040)', async () => {
    const s = setup();
    const turnIn = s.steps[4];
    if (turnIn === undefined) throw new Error('fixture changed');
    const { project, revision } = s.store.getState();
    const carried = {
      kind: 'objectives-carried',
      questId: 1 as QuestId,
      objectives: [0],
      time: 'counted',
      killXp: known(760, 'assumption'),
      level: 2,
      levelBasis: 'assumption',
      levelEraFallback: false,
    } as const;
    act(() => {
      s.publish({ results: derivedResults(project, { revision, steps: [{}, {}, {}, {}, { duration: known(243, 'assumption'), xpGained: known(1610, 'assumption'), facts: [carried] }] }) });
      s.store.select({ kind: 'single', id: turnIn.id });
    });
    fireEvent.click(sidePanel().getByRole('tab', { name: /^Details/ }));
    const term = await sidePanel().findByText('Objective work');
    expect(term.closest('div')?.textContent).toContain(
      'This turn-in includes the time and kill XP of objective 1, which no Complete step finishes; the travel to that work is not included.',
    );
  });
});
