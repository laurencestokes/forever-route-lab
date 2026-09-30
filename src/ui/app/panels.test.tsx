// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { Profiler, createRef, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditorStore, type EditorStore, fixedClock } from '../../app';
import { createPlaceholderWorkspace } from '../../app/placeholder-project';
import { editNoteText, sequentialIdSource } from '../../app/shell-support';
import type { DatasetView, QuestRecord } from '../../domain/dataset';
import type { GroupId, QuestId } from '../../domain/ids';
import type { ProjectV1 } from '../../domain/project';
import { buildRouteView } from '../app-model';
import { AppTopBar } from './AppTopBar';
import { AvailableQuests, UNREADABLE_MASK_REASON } from './AvailableQuests';
import { QuestDetails } from './QuestDetails';
import { createRouteActions } from './route-actions';
import { DetailsPanel } from './StepDetails';

const NOW = '2026-09-25T12:00:00.000Z';

afterEach(cleanup);

function workspace(edit: (project: ProjectV1) => ProjectV1 = (p) => p): { store: EditorStore; dataset: DatasetView } {
  const { project, dataset } = createPlaceholderWorkspace({ nowIso: NOW });
  return { store: createEditorStore({ project: edit(project), ids: sequentialIdSource(1000), clock: fixedClock(NOW) }), dataset };
}

/** The dataset with extra or replaced quest records. */
function withQuests(dataset: DatasetView, records: readonly QuestRecord[]): DatasetView {
  const byId = new Map(records.map((q) => [q.id, q]));
  const base = dataset.quests().filter((q) => !byId.has(q.id));
  return { ...dataset, quests: () => [...base, ...records], quest: (id) => byId.get(id) ?? dataset.quest(id) };
}

function firstQuest(dataset: DatasetView): QuestRecord {
  const quest = dataset.quests()[0];
  if (quest === undefined) throw new Error('placeholder quest missing');
  return quest;
}

/** Counts the commits of a subtree: a panel whose slices did not change does not commit. */
function renderCounted(node: ReactNode) {
  const onRender = vi.fn();
  render(
    <Profiler id="panel" onRender={onRender}>
      {node}
    </Profiler>,
  );
  return onRender;
}

describe('panel slices (F13)', () => {
  it('does not re-render the quest list for selection changes or typing in a note', () => {
    const { store, dataset } = workspace();
    const [first, second] = store.getState().project.route.steps;
    if (first === undefined || second === undefined) throw new Error('steps missing');
    // Accept says where the step goes: "at the end of the route" only while nothing is selected
    // (review UI-08), so the list starts with a selection; moving it re-renders nothing.
    store.select({ kind: 'single', id: first.id });
    const renders = renderCounted(<AvailableQuests store={store} dataset={dataset} search="" />);
    const initial = renders.mock.calls.length;
    act(() => {
      store.select({ kind: 'single', id: second.id });
      store.select({ kind: 'all' });
      store.dispatch(editNoteText(first.id, 'Placeholder typed'));
      store.setView({ rightTab: 'details' });
    });
    expect(renders.mock.calls.length).toBe(initial);
    act(() => {
      const project = store.getState().project;
      store.replaceProject({ ...project, route: { ...project.route, steps: [] } });
    });
    // The quests in the route changed (there are none now): it re-renders.
    expect(renders.mock.calls.length).toBeGreaterThan(initial);
  });

  it('does not re-render the top bar for selection changes or edits, only for its own slices', () => {
    const { store, dataset } = workspace();
    const renders = renderCounted(
      <AppTopBar
        store={store}
        dataset={dataset}
        projectName="Placeholder project"
        search=""
        onSearchChange={vi.fn()}
        onSearchSubmit={vi.fn()}
        searchRef={createRef<HTMLInputElement>()}
        onAbout={vi.fn()}
      />,
    );
    const initial = renders.mock.calls.length;
    const [first] = store.getState().project.route.steps;
    if (first === undefined) throw new Error('steps missing');
    act(() => {
      store.select({ kind: 'all' });
      store.dispatch(editNoteText(first.id, 'Placeholder typed'));
    });
    expect(renders.mock.calls.length).toBe(initial);
    act(() => {
      store.setView({ theme: 'dark' });
    });
    expect(renders.mock.calls.length).toBe(initial + 1);
  });
});

describe('AvailableQuests', () => {
  it('lists quests with an unreadable mask apart, with the reason, never as open (F12)', () => {
    const { store, dataset: base } = workspace();
    const quest = firstQuest(base);
    const unreadable: QuestRecord = { ...quest, id: 990_001 as QuestId, name: 'Placeholder unreadable quest', races: -1 };
    const dataset = withQuests(base, [unreadable]);
    render(<AvailableQuests store={store} dataset={dataset} search="" />);
    // One grid: the open quests, then the heading "Unknown availability" and the quests under it.
    const rows = within(screen.getByRole('grid', { name: 'Quests' })).getAllByRole('row');
    const heading = rows.findIndex((row) => within(row).queryByRole('rowheader', { name: 'Race or class unknown, 1 quest' }) !== null);
    expect(heading).toBeGreaterThan(0);
    expect(rows.slice(0, heading).some((row) => row.textContent.includes('Placeholder unreadable quest'))).toBe(false);
    const item = rows[heading + 1];
    expect(item?.textContent).toContain('Placeholder unreadable quest');
    expect(item?.textContent).toContain(UNREADABLE_MASK_REASON);
    expect(screen.getByText(/1 quest whose race or class mask cannot be read: whether they are open to Orc Warrior is unknown/)).toBeTruthy();
  });

  it('filters the unknown list with the search too', () => {
    const { store, dataset: base } = workspace();
    const unreadable: QuestRecord = { ...firstQuest(base), id: 990_001 as QuestId, name: 'Placeholder unreadable quest', races: -1 };
    render(<AvailableQuests store={store} dataset={withQuests(base, [unreadable])} search="nothing matches this" />);
    expect(screen.queryByRole('rowheader', { name: 'Race or class unknown, 1 quest' })).toBeNull();
    expect(screen.getByText('No quests match “nothing matches this”.')).toBeTruthy();
  });
});

describe('QuestDetails', () => {
  it('shows a scaling quest at its effective level and says it scales (F8)', () => {
    const { store, dataset: base } = workspace();
    const quest = { ...firstQuest(base), level: -1, minLevel: 4 };
    render(<QuestDetails questId={quest.id} dataset={withQuests(base, [quest])} character={store.getState().project.character} />);
    // Start level 1, required level 4: the quest counts as level 4, orange (Q - P = 3).
    expect(screen.getByText(/Quest level 4, Very difficult \(orange\)/)).toBeTruthy();
    expect(screen.getByText(/A scaling quest: its level follows the player's \(at least its required level 4\)/)).toBeTruthy();
    expect(screen.queryByText(/Quest level -1/)).toBeNull();
  });

  it('shows other levels of 0 and below as unknown', () => {
    const { store, dataset: base } = workspace();
    const quest = { ...firstQuest(base), level: 0 };
    render(<QuestDetails questId={quest.id} dataset={withQuests(base, [quest])} character={store.getState().project.character} />);
    expect(screen.getByText(/Quest level unknown, difficulty unknown/)).toBeTruthy();
  });
});

describe('DetailsPanel', () => {
  it('labels a step whose group id names an Object.prototype member as a plain group (F4)', () => {
    const { store, dataset } = workspace((project) => {
      const [first, ...rest] = project.route.steps;
      if (first === undefined) throw new Error('steps missing');
      const odd = { ...first, groupId: 'toString' as GroupId };
      return { ...project, route: { ...project.route, steps: [odd, ...rest] } };
    });
    const first = store.getState().project.route.steps[0];
    if (first === undefined) throw new Error('steps missing');
    store.select({ kind: 'single', id: first.id });
    const route = store.getState().project.route;
    const view = buildRouteView(route, dataset, 1);
    render(
      <DetailsPanel
        store={store}
        view={view}
        route={route}
        dataset={dataset}
        activeRow={null}
        actions={createRouteActions(store, vi.fn())}
        onFocusList={vi.fn()}
      />,
    );
    expect(screen.getByText('Step group of 1 step')).toBeTruthy();
  });
});
