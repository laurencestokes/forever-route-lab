// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEditorStore, type EditorStore, fixedClock } from '../../app';
import { createDerivedStore } from '../../app/derived';
import type { MapController } from '../../app/map-exports';
import { createPlaceholderWorkspace } from '../../app/placeholder-project';
import { DerivedStoreProvider } from '../../app/react';
import { sequentialIdSource } from '../../app/shell-support';
import type { DatasetView } from '../../domain/dataset';
import type { QuestId } from '../../domain/ids';
import { fixtureView } from '../../../tests/support/fixture-dataset';
import { buildRouteView } from '../app-model';
import { goToOptions } from './AppTopBar';
import { derivedResults, readyState } from './derived-test-helpers';
import { loadDetailsPanel } from './lazy';
import { primaryQuestAction, QuestDetails, wowheadQuestUrl } from './QuestDetails';
import { logQuestState, QuestLogPanel } from './QuestLogPanel';
import { createRouteActions } from './route-actions';
import { RoutePanel } from './RoutePanel';
import { browserStorage, DEFAULT_SHELL_PREFS, readShellPrefs, SHELL_PREFS_KEY, writeShellPrefs } from './view-prefs';

/**
 * The route panel (ui-refresh.md §4.1, step UR.4), the Quest log tab (§5.5, UR.6), Details' state
 * primary and Wowhead link (§7.2), the top bar's "Go to zone or view…" (§8) and the shell's
 * per-browser preferences (§4.3).
 */

beforeAll(async () => {
  await loadDetailsPanel();
});

afterEach(cleanup);

const NOW = '2026-09-25T12:00:00.000Z';

function setup(): { store: EditorStore; dataset: DatasetView; announce: ReturnType<typeof vi.fn> } {
  const { project, dataset } = createPlaceholderWorkspace({ nowIso: NOW });
  const store = createEditorStore({ project, ids: sequentialIdSource(1000), clock: fixedClock(NOW) });
  const announce = vi.fn();
  function Panel() {
    const view = buildRouteView(store.getState().project.route, dataset, 1);
    return (
      <RoutePanel
        store={store}
        view={view}
        dataset={dataset}
        routeName="Placeholder route"
        placeholder
        activeRow={null}
        onActiveRowChange={vi.fn()}
        actions={createRouteActions(store, announce)}
        containerRef={createRef<HTMLDivElement>()}
        onFocusList={vi.fn()}
      />
    );
  }
  const rendered = render(<Panel />);
  store.subscribe(() => {
    rendered.rerender(<Panel />);
  });
  return { store, dataset, announce };
}

const selectStep = (store: EditorStore, index: number) => {
  const id = store.getState().project.route.steps[index]?.id;
  if (id === undefined) throw new Error(`no step ${String(index)}`);
  act(() => {
    store.select({ kind: 'single', id });
  });
};

describe('the route panel (ui-refresh.md §4.1)', () => {
  it('heads the panel with the route name, the tags, View and the history, then a meta line', () => {
    setup();
    // Without project storage the name is plain text in the heading (with it, the Projects menu button).
    expect(screen.getByRole('heading', { level: 2, name: 'Placeholder route' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View' }).getAttribute('aria-expanded')).toBe('false');
    const history = within(screen.getByRole('toolbar', { name: 'History' }));
    expect(history.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Nothing to undo', 'Nothing to redo']);
    expect(screen.getByText(/^\d+ steps · Orc Warrior from level 1$/)).toBeTruthy();
  });

  it('puts Move up and Move down first in the step toolbar, one tab stop, and presses Lock when the selection is locked', () => {
    const { store } = setup();
    const toolbar = screen.getByRole('toolbar', { name: 'Selected steps' });
    expect(within(toolbar).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Move selected steps up',
      'Move selected steps down',
      'Duplicate selected steps',
      'Lock selected steps',
      'Delete selected steps',
      'Cut selected steps',
      'Copy selected steps',
      'Paste steps (the clipboard is empty)',
      'Join sections (select two or more separate runs of steps)',
    ]);
    expect(within(toolbar).getAllByRole('button').filter((b) => b.tabIndex === 0)).toHaveLength(1);
    expect(within(toolbar).getByRole('button', { name: 'Move selected steps up' }).getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowUp');
    const locked = store.getState().project.route.steps.findIndex((s) => s.locked);
    selectStep(store, locked);
    expect(within(toolbar).getByRole('button', { name: 'Lock selected steps' }).getAttribute('aria-pressed')).toBe('true');
    selectStep(store, 1);
    expect(within(toolbar).getByRole('button', { name: 'Lock selected steps' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('moves the selection up and down from the toolbar, and says so', () => {
    const { store, announce } = setup();
    selectStep(store, 3);
    const id = store.getState().project.route.steps[3]?.id;
    fireEvent.click(screen.getByRole('button', { name: 'Move selected steps up' }));
    expect(store.getState().project.route.steps[2]?.id).toBe(id);
    expect(announce).toHaveBeenLastCalledWith('1 step moved up: now step 3.');
    fireEvent.click(screen.getByRole('button', { name: 'Move selected steps down' }));
    expect(store.getState().project.route.steps[3]?.id).toBe(id);
  });

  it('names the Add footer for where new steps go, and inserts Hearth, Train and Buy there, announcing each', () => {
    const { store, announce } = setup();
    expect(screen.getByRole('toolbar', { name: 'Add at the end of the route' })).toBeTruthy();
    selectStep(store, 1);
    const footer = within(screen.getByRole('toolbar', { name: 'Add after step 2' }));
    expect(footer.getAllByRole('button').map((b) => b.textContent)).toEqual(['Grind', 'Travel', 'Hearth', 'Train', 'Buy', 'Note']);
    fireEvent.click(footer.getByRole('button', { name: 'Hearth' }));
    expect(store.getState().project.route.steps[2]).toMatchObject({ kind: 'hearth', mode: 'use' });
    expect(announce).toHaveBeenLastCalledWith('Hearthstone inserted as step 3.');
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Add after step 3' })).getByRole('button', { name: 'Train' }));
    expect(store.getState().project.route.steps[3]).toMatchObject({ kind: 'train', what: null });
    expect(announce).toHaveBeenLastCalledWith('Train inserted as step 4.');
    // Train and Buy open Details, where the trainer or vendor is set.
    expect(store.getState().view.rightTab).toBe('details');
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Add after step 4' })).getByRole('button', { name: 'Buy' }));
    expect(store.getState().project.route.steps[4]).toMatchObject({ kind: 'vendor', what: null });
    expect(announce).toHaveBeenLastCalledWith('Vendor inserted as step 5.');
  });

  it('keeps every Add button focusable and inert while editing is locked', () => {
    const { store } = setup();
    act(() => {
      store.acquireLock('proposal');
    });
    const count = store.getState().project.route.steps.length;
    for (const button of within(screen.getByRole('toolbar', { name: /^Add / })).getAllByRole('button')) {
      expect(button.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(button);
    }
    expect(store.getState().project.route.steps).toHaveLength(count);
  });
});

describe('the shell’s per-browser preferences (ui-refresh.md §4.3)', () => {
  it('reads each field on its own, with the defaults for what is absent or unreadable', () => {
    const map = new Map<string, string>();
    const storage = () => ({ getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value) });
    expect(readShellPrefs(storage)).toEqual(DEFAULT_SHELL_PREFS);
    map.set(SHELL_PREFS_KEY, JSON.stringify({ density: 'one-line', topNumber: 'bogus', leftWidth: 400, mapFocus: true, rightCollapsed: 'yes' }));
    expect(readShellPrefs(storage)).toEqual({ ...DEFAULT_SHELL_PREFS, density: 'one-line', leftWidth: 400, mapFocus: true });
    map.set(SHELL_PREFS_KEY, '{not json');
    expect(readShellPrefs(storage)).toEqual(DEFAULT_SHELL_PREFS);
    writeShellPrefs(storage, { ...DEFAULT_SHELL_PREFS, leftCollapsed: true });
    expect(readShellPrefs(storage).leftCollapsed).toBe(true);
  });

  it('keeps the choice for the page load when storage refuses', () => {
    const refusing = () => ({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readShellPrefs(refusing)).toEqual(DEFAULT_SHELL_PREFS);
    expect(() => {
      writeShellPrefs(refusing, DEFAULT_SHELL_PREFS);
    }).not.toThrow();
    expect(browserStorage()).toBe(window.localStorage);
  });
});

describe('the Quest log tab (ui-refresh.md §5.5)', () => {
  function renderLog(selected: 'none' | 'log') {
    const { project, dataset } = createPlaceholderWorkspace({ nowIso: NOW });
    const store = createEditorStore({ project, ids: sequentialIdSource(1000), clock: fixedClock(NOW) });
    const view = buildRouteView(project.route, dataset, 1);
    const [quest, other] = dataset.quests();
    if (quest === undefined || other === undefined) throw new Error('quests missing');
    const step = project.route.steps[3];
    const results = derivedResults(project);
    const after = {
      level: 3,
      unknownXpEvents: 0,
      questLog: new Map([
        [quest.id, { objectives: quest.objectives.map((_o, i) => (i === 0 ? 'done' : 'open')), failed: false, routeAccepted: true }],
        [other.id, { objectives: other.objectives.map(() => 'done'), failed: false, routeAccepted: true }],
      ]),
    };
    const state = readyState(results, {
      selected: selected === 'none' || step === undefined ? null : ({ revision: 0, stepId: step.id, index: 3, record: {}, before: after, after, issues: [] } as never),
    });
    const add = vi.fn();
    const onOpen = vi.fn();
    render(
      <DerivedStoreProvider store={createDerivedStore(state).store}>
        <QuestLogPanel store={store} view={view} dataset={dataset} questActions={{ unavailable: null, add, editCustom: vi.fn(), deleteCustom: vi.fn() }} onOpen={onOpen} />
      </DerivedStoreProvider>,
    );
    return { quest, other, add, onOpen };
  }

  it('never claims an empty log without a walked step, and says why', () => {
    renderLog('none');
    expect(screen.getByText('Not checked yet')).toBeTruthy();
    expect(screen.getByText('Select a step to see the quest log after it.')).toBeTruthy();
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('lists the log after the step with its capacity and basis, each quest’s "?" in its state, and its objectives', () => {
    const { quest, other, add, onOpen } = renderLog('log');
    expect(screen.getByRole('heading', { name: 'Quest log after step 4' })).toBeTruthy();
    expect(screen.getByText('In the quest log after step 4: 2 of 40 quests (capacity 40: client data).')).toBeTruthy();
    const grid = screen.getByRole('grid', { name: 'Quest log after step 4' });
    const rows = within(grid).getAllByRole('row').filter((row) => row.classList.contains('frl-quest-item'));
    expect(rows).toHaveLength(2);
    const [first, second] = rows;
    // The first is in progress (a pie), the second ready (the difficulty colour, with its chip).
    expect(first?.querySelector('.frl-quest-mark')?.getAttribute('data-state')).toBe(quest.objectives.length > 1 ? 'in-progress' : 'ready');
    expect(second?.querySelector('.frl-quest-mark')?.getAttribute('data-state')).toBe('ready');
    expect(second?.querySelector('.frl-quest-item__detail [data-difficulty]')).not.toBeNull();
    // Every log row shows its chip (UI-11), and the actions name the step as the Available tab does.
    expect(first?.querySelector('.frl-quest-item__detail [data-difficulty]')).not.toBeNull();
    fireEvent.click(within(second as HTMLElement).getByRole('button', { name: `Turn in ${other.name} after step 4` }));
    expect(add).toHaveBeenLastCalledWith(other.id, ['turnin']);
    fireEvent.click(within(second as HTMLElement).getByRole('button', { name: new RegExp(`^${other.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, `) }));
    expect(onOpen).toHaveBeenCalledWith(other.id);
    // The objectives: ✓ or ○, and Done here while one is open.
    const objectives = within(grid).getAllByRole('row').filter((row) => row.classList.contains('frl-quest-objective'));
    expect(objectives.length).toBe(quest.objectives.length + other.objectives.length);
    if (quest.objectives.length > 1) {
      // Done here names the objective's words, then its number and quest, then the step (UI-11).
      const doneHere = (name: string) => name.startsWith('Done here: ') && name.endsWith(`(objective 2 of ${quest.name}), after step 4`);
      fireEvent.click(within(grid).getByRole('button', { name: doneHere }));
      expect(add).toHaveBeenLastCalledWith(quest.id, ['complete'], 1);
    }
    // Every objective's words are a grid item, the done one included, so ↓ reaches it (UI-11).
    for (const objective of objectives) expect(objective.querySelector('[role="gridcell"][data-grid-item]')).not.toBeNull();
  });

  it('is never ready while the record or the progress is unknown (the model’s rule)', () => {
    const record = { objectives: [{}, {}] } as never;
    expect(logQuestState({ objectives: ['done', 'done'], failed: false, routeAccepted: false }, record)).toBe('ready');
    expect(logQuestState({ objectives: ['done', 'open'], failed: false, routeAccepted: true }, record)).toBe('in-progress');
    expect(logQuestState({ objectives: ['done', 'open'], failed: false, routeAccepted: false }, record)).toBe('record-unknown');
    expect(logQuestState({ objectives: [], failed: false, routeAccepted: true }, undefined)).toBe('record-unknown');
  });
});

describe('Details, a quest (ui-refresh.md §7.2)', () => {
  it('makes the state’s action the one primary: Accept, Objectives done or Turn in, and none without route state', () => {
    const entry = (cls: string, turnIn: unknown = null) => ({ cls, turnIn }) as never;
    expect(primaryQuestAction(null)).toBeNull();
    expect(primaryQuestAction(entry('available'))).toBe('accept');
    expect(primaryQuestAction(entry('uncertain-level'))).toBe('accept');
    expect(primaryQuestAction(entry('locked'))).toBeNull();
    expect(primaryQuestAction(entry('in-log', { kind: 'ready', failed: false }))).toBe('turnin');
    expect(primaryQuestAction(entry('in-log', { kind: 'in-progress', failed: false }))).toBe('complete');
    expect(primaryQuestAction(entry('in-log', { kind: 'record-unknown', failed: false }))).toBeNull();
    expect(primaryQuestAction(entry('in-log', { kind: 'ready', failed: true }))).toBeNull();
  });

  it('adds all three, and opens the quest on Wowhead as an external link that sends nothing but its id', () => {
    // A dataset quest (the placeholder's are custom, with no Wowhead page): 788 of the fixture slice.
    const { project } = createPlaceholderWorkspace({ nowIso: NOW });
    const dataset = fixtureView();
    const quest = dataset.quest(788 as QuestId);
    if (quest === undefined) throw new Error('quest missing');
    const add = vi.fn();
    render(<QuestDetails questId={quest.id} dataset={dataset} character={project.character} actions={{ unavailable: null, add, editCustom: vi.fn(), deleteCustom: vi.fn() }} />);
    const group = within(screen.getByRole('group', { name: /^Add “/ }));
    expect(group.getAllByRole('button').map((b) => b.textContent)).toEqual(['Accept', 'Objectives done', 'Turn in', 'Add all three']);
    expect(group.getAllByRole('button').filter((b) => b.className.includes('frl-button--primary'))).toHaveLength(0);
    fireEvent.click(group.getByRole('button', { name: 'Add all three' }));
    expect(add).toHaveBeenCalledWith(quest.id, ['accept', 'complete', 'turnin'], null);
    const link = screen.getByRole('link', { name: 'Open on Wowhead (opens in a new tab)' });
    expect(link.getAttribute('href')).toBe(wowheadQuestUrl(quest.id));
    expect(link.getAttribute('href')).toBe(`https://www.wowhead.com/classic/quest=${String(quest.id)}`);
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('"Go to zone or view…" (ui-refresh.md §8)', () => {
  it('puts the atlas’s views first, then the zones by world map, each with its span', () => {
    const controller = {
      surfaces: [{ kind: 'atlas', id: 'atlas', name: 'Azeroth' }],
      presets: [
        { id: 'preset:1', name: 'Kalimdor' },
        { id: 'preset:0', name: 'Eastern Kingdoms' },
      ],
      zoneGroups: [{ label: 'Kalimdor', zones: [{ uiMapId: 1411, label: 'Durotar' }] }],
    } as unknown as MapController;
    expect(goToOptions(controller, null)).toEqual([
      {
        group: 'Views',
        options: [
          { value: 'view:atlas', label: 'Both continents' },
          { value: 'preset:1', label: 'Kalimdor' },
          { value: 'preset:0', label: 'Eastern Kingdoms' },
        ],
      },
      { group: 'Kalimdor', options: [{ value: '1411', label: 'Durotar' }] },
    ]);
    const noAtlas = { ...controller, surfaces: [], presets: [] } as unknown as MapController;
    expect(goToOptions(noAtlas, null)).toEqual([{ group: 'Kalimdor', options: [{ value: '1411', label: 'Durotar' }] }]);
  });
});
