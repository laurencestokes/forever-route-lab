// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fixturePrepared, fixtureView } from '../../tests/support/fixture-dataset';
import { createEditorStore, type EditorStore, fixedClock } from '../app';
import { preparedDatasetSource } from '../app/dataset-source';
import { createSampleProject, SAMPLE_PROJECT_NAME, SAMPLE_ROUTE_NAME, SAMPLE_ROUTE_NOTICE } from '../app/sample-route';
import { sequentialIdSource } from '../app/shell-support';
import type { DatasetView, QuestRecord } from '../domain/dataset';
import type { QuestId } from '../domain/ids';
import { App } from './App';
import { PLACEHOLDER_DATA_NOTICE } from './app-model';
import { AVAILABLE_PAGE_SIZE, AvailableQuests } from './app/AvailableQuests';
import { formatInteger } from './kit';

afterEach(cleanup);

const NOW = '2026-09-25T12:00:00.000Z';
const GEOMETRY = 'placeholder: 49 frames @ 1.60.1.69893, 12 rows @ 1.60.1.70009; local set: none';

function setup(): EditorStore {
  const project = createSampleProject({ dataset: fixtureView(), nowIso: NOW });
  const store = createEditorStore({ project, ids: sequentialIdSource(1000), clock: fixedClock(NOW) });
  render(
    <App
      store={store}
      data={preparedDatasetSource(fixturePrepared())}
      projectName={SAMPLE_PROJECT_NAME}
      routeNotice={SAMPLE_ROUTE_NOTICE}
      geometrySummary={GEOMETRY}
      version="0.0.0-test"
      sourceCommit={null}
    />,
  );
  return store;
}

const list = () => screen.getByRole('listbox');
const sidePanel = () => screen.getByRole('complementary', { name: 'Quests and details' });
const tab = (name: RegExp) => within(sidePanel()).getByRole('tab', { name });

describe('App over the real dataset (fixture slice) with the sample route', () => {
  it('labels the route as an auto-generated sample, not placeholder data', () => {
    setup();
    const banner = screen.getByRole('note');
    expect(banner.textContent).toContain(SAMPLE_ROUTE_NOTICE);
    expect(banner.textContent).not.toContain(PLACEHOLDER_DATA_NOTICE);
    const top = document.querySelector('.frl-topbar');
    expect(top?.textContent).toContain('Sample project');
    expect(top?.textContent).toContain('Sample: Durotar start (auto-generated)');
    expect(top?.textContent).toContain(SAMPLE_ROUTE_NAME);
    expect(within(top as HTMLElement).getByTitle('Sample project')).toBeTruthy();
  });

  it('shows the data badge with the short revision and the full identity as its tooltip', () => {
    setup();
    const status = screen.getByRole('region', { name: 'Route status' });
    expect(status.textContent).toContain('Data 695c41df');
    const title = [...status.querySelectorAll('[title]')].map((el) => el.getAttribute('title') ?? '').find((t) => t.startsWith('Data revision'));
    expect(title).toMatch(/^Data revision 695c41df5635b456ca1b9698814e7a07fd40db2c83dd721181e1a46b8cec6cad, frame build 1\.60\.1\.69893, QuestieDB commit b6f5b07b/);
    expect(title).toMatch(/Forever content is not verified/);
  });

  it('lists the sample steps and shows a real quest in Details: givers at zone and percent, objectives, quest text', () => {
    setup();
    const accept = within(list()).getByRole('option', { name: /Accept quest: Cutting Teeth/ });
    fireEvent.click(accept);
    fireEvent.click(tab(/^Details/));
    const panel = within(sidePanel());
    expect(panel.getByText('Gornek · Durotar 42.06, 68.33')).toBeTruthy();
    expect(panel.getByText('Generated for the sample route')).toBeTruthy();
    expect(panel.getAllByText('Gornek (NPC) · Durotar 42.06, 68.33')).toHaveLength(2);
    const quest = panel.getByRole('heading', { name: 'Quest' }).closest('section');
    expect(quest?.textContent).toMatch(/Kill Mottled Boar \(count unknown\) · \d+ spawns in Durotar/);
    expect(quest?.textContent).toContain('Quest text');
    expect(quest?.textContent).toMatch(/Era value from QuestieDB; Forever XP is unknown/);
    expect(quest?.textContent).toContain('Forever status: unknown');
  });

  it('shows the geometry in use on the map panel', () => {
    setup();
    expect(screen.getByText(`Geometry loaded: ${GEOMETRY}.`)).toBeTruthy();
  });

  it('lists the quests open to the character, with a count and no placeholder tag, and follows a character change', () => {
    const store = setup();
    const aside = () => within(sidePanel()).getByText(/^\d[\d,]* open$/).textContent;
    const horde = aside();
    expect(within(sidePanel()).queryByTitle('Placeholder quest data')).toBeNull();
    const project = store.getState().project;
    act(() => {
      store.replaceProject({ ...project, character: { ...project.character, faction: 'Alliance', race: 'Human' } });
    });
    expect(aside()).not.toBe(horde);
  });

  it('opens About in real-data mode: the pinned commit, the data revision and the full notice link', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'About Forever Route Lab' }));
    const dialog = screen.getByRole('dialog', { name: 'About Forever Route Lab' });
    expect(dialog.textContent).not.toContain('placeholder data');
    expect(dialog.textContent).toContain('pinned commit b6f5b07b0acf');
    expect(dialog.textContent).toContain('Data revision 695c41df5635');
    expect(within(dialog).getByRole('link', { name: 'Full data notice' }).getAttribute('href')).toBe('data/NOTICE.md');
  });
});

/** The fixture view with `extra` synthetic quests open to everyone, for the list cap. */
function withManyQuests(base: DatasetView, extra: number): DatasetView {
  const template = base.quest(788 as QuestId);
  if (template === undefined) throw new Error('quest 788 missing');
  const added: QuestRecord[] = Array.from({ length: extra }, (_, i) => ({ ...template, id: (900_000 + i) as QuestId, name: `Synthetic quest ${String(i)}`, races: null }));
  const all = [...base.quests(), ...added];
  const byId = new Map(all.map((q) => [q.id, q]));
  return { ...base, quests: () => all, quest: (id) => byId.get(id) };
}

describe('AvailableQuests with thousands of quests', () => {
  it('renders a page at a time with an honest count, grows on request and narrows by search', () => {
    const project = createSampleProject({ dataset: fixtureView(), nowIso: NOW });
    const store = createEditorStore({ project, ids: sequentialIdSource(1000), clock: fixedClock(NOW) });
    const dataset = withManyQuests(fixtureView(), 250);
    const { rerender } = render(<AvailableQuests store={store} dataset={dataset} search="" />);
    const items = () => within(screen.getByRole('list', { name: 'Quests' })).getAllByRole('listitem');
    expect(items()).toHaveLength(AVAILABLE_PAGE_SIZE);
    const open = Number((screen.getByText(/^\d[\d,]* open$/).textContent ?? '').replace(/[^\d]/g, ''));
    expect(open).toBeGreaterThan(250);
    expect(screen.getByText(new RegExp(`^Showing 100 of ${formatInteger(open)} quests open to Orc Warrior, by level \\(or required level, when higher\\) and then id\\.`))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show 100 more' }));
    expect(items()).toHaveLength(2 * AVAILABLE_PAGE_SIZE);
    rerender(<AvailableQuests store={store} dataset={dataset} search="synthetic quest 1" />);
    // "Synthetic quest 1", "…10" to "…19" and "…100" to "…199": 111 matches, a fresh first page.
    expect(items()).toHaveLength(AVAILABLE_PAGE_SIZE);
    expect(screen.getByText('Showing 100 of 111 matching quests, by level (or required level, when higher) and then id.')).toBeTruthy();
    rerender(<AvailableQuests store={store} dataset={dataset} search="synthetic quest 24" />);
    expect(items()).toHaveLength(11);
    expect(screen.getByText('11 matching quests.')).toBeTruthy();
  });

  it('starts over at one page whenever the search changes, also back to an earlier search (code-F4)', () => {
    const project = createSampleProject({ dataset: fixtureView(), nowIso: NOW });
    const store = createEditorStore({ project, ids: sequentialIdSource(1000), clock: fixedClock(NOW) });
    const dataset = withManyQuests(fixtureView(), 250);
    const { rerender } = render(<AvailableQuests store={store} dataset={dataset} search="" />);
    const items = () => within(screen.getByRole('list', { name: 'Quests' })).getAllByRole('listitem');
    fireEvent.click(screen.getByRole('button', { name: 'Show 100 more' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show 100 more' }));
    expect(items()).toHaveLength(3 * AVAILABLE_PAGE_SIZE);
    rerender(<AvailableQuests store={store} dataset={dataset} search="t" />);
    expect(items()).toHaveLength(AVAILABLE_PAGE_SIZE);
    // Clearing the search does not bring the expanded list back: one page, with the full count.
    rerender(<AvailableQuests store={store} dataset={dataset} search="" />);
    expect(items()).toHaveLength(AVAILABLE_PAGE_SIZE);
    expect(screen.getByRole('button', { name: 'Show 100 more' })).toBeTruthy();
    expect(screen.getByText(/^Showing 100 of /)).toBeTruthy();
  });

  it('sorts a quest by its required level when higher, and says what it requires (code-F9)', () => {
    const project = createSampleProject({ dataset: fixtureView(), nowIso: NOW });
    const store = createEditorStore({ project, ids: sequentialIdSource(1000), clock: fixedClock(NOW) });
    const base = fixtureView();
    const template = base.quest(788 as QuestId);
    if (template === undefined) throw new Error('quest 788 missing');
    // Like 4295 "Rocknot's Ale": quest level 1, required level 42.
    const ale: QuestRecord = { ...template, id: 4295 as QuestId, name: "Rocknot's Ale", level: 1, minLevel: 42, races: null };
    const all = [...base.quests(), ale].sort((a, b) => a.id - b.id);
    const dataset: DatasetView = { ...base, quests: () => all, quest: (id) => (id === ale.id ? ale : base.quest(id)) };
    render(<AvailableQuests store={store} dataset={dataset} search="" />);
    const rows = within(screen.getByRole('list', { name: 'Quests' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '');
    const index = rows.findIndex((row) => row.includes("Rocknot's Ale"));
    // Sorted with the level-42 quests, not with its quest level 1 (before, it came before Cutting Teeth, level 2).
    expect(index).toBeGreaterThan(rows.findIndex((row) => row.includes('Cutting Teeth')));
    expect(rows[index]).toContain('requires 42');
    expect(rows.some((row) => row.includes('Cutting Teeth') && row.includes('requires'))).toBe(false);
  });
});
