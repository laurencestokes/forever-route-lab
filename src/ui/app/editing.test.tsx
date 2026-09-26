// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditorStore, type EditorStore, fixedClock } from '../../app';
import type { DatasetSource } from '../../app/dataset-source';
import { mapTestWorkspace } from '../../app/map-test-helpers';
import { createPlaceholderWorkspace, PLACEHOLDER_PROJECT_NAME } from '../../app/placeholder-project';
import { updateSettings } from '../../app/project-commands';
import { sequentialIdSource } from '../../app/shell-support';
import type { DatasetView, QuestRecord } from '../../domain/dataset';
import type { QuestId } from '../../domain/ids';
import type { CustomQuest, ProjectV1 } from '../../domain/project';
import { App } from '../App';
import { ADD_QUEST_LABEL } from './AvailableQuests';

/**
 * The route editor's flows in the whole shell (docs/UI.md §8, §14), over the placeholder data:
 * adding quests from the Available tab and Details, the clipboard and join, the Details editors,
 * custom quests and the Settings dialog.
 */

afterEach(cleanup);

const NOW = '2026-09-25T12:00:00.000Z';
/** Placeholder Quest 1 (kill), 4 (its follow-up) and 3 (object). */
const KILL = 900_001 as QuestId;
const FOLLOW_UP = 900_004 as QuestId;

/**
 * A source that lays the project's custom quests over `base`, as the loaded dataset's does
 * (ARCHITECTURE §5.5): a custom quest replaces the quest with its id, or is added.
 */
function overlaySource(base: DatasetView): DatasetSource {
  const views = new Map<readonly CustomQuest[], DatasetView>();
  const record = ({ starterLocation: _s, finisherLocation: _f, ...quest }: CustomQuest): QuestRecord => quest;
  return {
    identity: base.identity,
    flightMasterIds: [],
    view(input) {
      if (input.customQuests.length === 0) return base;
      const known = views.get(input.customQuests);
      if (known !== undefined) return known;
      const custom = new Map(input.customQuests.map((q) => [q.id, record(q)]));
      const quests = [...base.quests().filter((q) => !custom.has(q.id)), ...custom.values()].sort((a, b) => a.id - b.id);
      const view: DatasetView = { ...base, quest: (id) => custom.get(id) ?? base.quest(id), quests: () => quests };
      views.set(input.customQuests, view);
      return view;
    },
  };
}

type Steps = () => ProjectV1['route']['steps'];

function setup(data: 'placeholder' | 'map' = 'placeholder'): { store: EditorStore; steps: Steps } {
  const { project, dataset } = data === 'placeholder' ? createPlaceholderWorkspace({ nowIso: NOW }) : mapTestWorkspace(undefined, NOW);
  const store = createEditorStore({ project, ids: sequentialIdSource(1000), clock: fixedClock(NOW) });
  render(<App store={store} data={overlaySource(dataset)} projectName={PLACEHOLDER_PROJECT_NAME} version="0.0.0-test" sourceCommit={null} />);
  return { store, steps: () => store.getState().project.route.steps };
}

const list = () => screen.getByRole('listbox');
const sidePanel = () => within(screen.getByRole('complementary', { name: 'Quests and details' }));
const tab = (name: RegExp) => sidePanel().getByRole('tab', { name });
const routeActions = () => within(screen.getByRole('toolbar', { name: 'Route actions' }));
const announced = () => (document.querySelector('.frl-app-live')?.textContent ?? '').replace(/\u00a0$/, '');
const select = (store: EditorStore, index: number) => {
  const id = store.getState().project.route.steps[index]?.id;
  if (id === undefined) throw new Error(`no step ${String(index)}`);
  act(() => {
    store.select({ kind: 'single', id });
  });
};
/** Selects exactly these steps. */
const selectSet = (store: EditorStore, ids: readonly (string | undefined)[]) => {
  act(() => {
    store.select({ kind: 'set', ids: ids.filter((id): id is NonNullable<typeof id> => id !== undefined) as never });
  });
};

describe('adding quests', () => {
  it('adds accept, complete and turn in from the Available tab after the selection, as one undo entry', () => {
    const { store, steps } = setup();
    select(store, 0);
    fireEvent.click(tab(/^Available/));
    const add = sidePanel().getByRole('button', { name: `${ADD_QUEST_LABEL}: Placeholder Quest 5: delivery` });
    fireEvent.click(add);
    const added = steps().slice(1, 4);
    expect(added.map((s) => s.kind)).toEqual(['accept', 'complete', 'turnin']);
    expect(added.every((s) => 'questId' in s ? s.questId === 900_005 : s.kind === 'complete')).toBe(true);
    // Each has the spawn of its NPC as its location (the placeholder spawns have no world point, so the first is taken).
    expect(added[0]?.location?.label).toBe('Placeholder Quartermaster');
    expect(announced()).toMatch(/^Placeholder Quest 5: delivery: accept quest, complete objectives, turn in quest added as steps 2 to 4\./);
    expect(store.getState().history.undoLabel).toBe('Add quest');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(steps()[1]?.kind).toBe('accept');
    expect(steps()).toHaveLength(40);
  });

  it('adds single parts and one objective from Details, and labels chain positions', () => {
    const { store, steps } = setup();
    // Step 2 accepts Placeholder Quest 1; its follow-up (Quest 4) is part 2 of its chain.
    select(store, 1);
    fireEvent.click(tab(/^Details/));
    expect(sidePanel().getByText('Part 1 of 2: Placeholder Quest 1: kill objective → Placeholder Quest 4: follow-up to Quest 1')).toBeTruthy();
    const quest = sidePanel().getByRole('group', { name: /^Add “Placeholder Quest 1: kill objective” to the route/ });
    fireEvent.click(within(quest).getByRole('button', { name: 'Turn in' }));
    expect(steps()[2]).toMatchObject({ kind: 'turnin', questId: KILL });
    expect(store.getState().history.undoLabel).toBe('Add turn-in');
    // The chain position is in the route rows' titles.
    expect(within(list()).getAllByRole('option').some((row) => (row.getAttribute('aria-label') ?? '').includes('Placeholder Quest 4: follow-up to Quest 1 (2/2)'))).toBe(true);
    expect(steps().some((s) => s.kind === 'accept' && s.questId === FOLLOW_UP)).toBe(true);
  });
});

describe('clipboard and join', () => {
  it('cuts, pastes after the selection and joins sections from the toolbar', () => {
    const { store, steps } = setup();
    const ids = steps().map((s) => s.id);
    selectSet(store, [ids[1], ids[2]]);
    fireEvent.click(routeActions().getByRole('button', { name: 'Cut selected steps' }));
    expect(steps()).toHaveLength(38);
    expect(announced()).toBe('2 steps cut. Paste with Ctrl+V; undo with Ctrl+Z.');
    const first = steps()[0];
    if (first === undefined) throw new Error('step missing');
    selectSet(store, [first.id]);
    fireEvent.click(routeActions().getByRole('button', { name: 'Paste 2 steps after the selection' }));
    expect(steps()).toHaveLength(40);
    expect(steps()[1]?.origin.source).toBe('paste');
    expect(announced()).toBe('2 steps pasted as steps 2 to 3.');
    // Two runs selected: steps 1 and 5 join, 5 moving to follow 1.
    const [a, , , , e] = steps();
    if (a === undefined || e === undefined) throw new Error('steps missing');
    selectSet(store, [a.id, e.id]);
    const join = routeActions().getByRole('button', { name: 'Join the 2 selected sections' });
    fireEvent.click(join);
    expect(steps()[1]?.id).toBe(e.id);
    expect(announced()).toBe('2 sections joined: now steps 1 to 2.');
    expect(routeActions().getByRole('button', { name: /^Join sections/ }).getAttribute('aria-disabled')).toBe('true');
  });

  it('runs Ctrl+C, Ctrl+V and J from the list', () => {
    const { store, steps } = setup();
    const [a, b, c] = steps();
    if (a === undefined || b === undefined || c === undefined) throw new Error('steps missing');
    selectSet(store, [b.id]);
    fireEvent.keyDown(list(), { key: 'c', ctrlKey: true });
    expect(announced()).toBe('1 step copied. Paste with Ctrl+V.');
    fireEvent.keyDown(list(), { key: 'v', ctrlKey: true });
    expect(steps()).toHaveLength(41);
    selectSet(store, [a.id, c.id]);
    fireEvent.keyDown(list(), { key: 'j' });
    expect(steps()[1]?.id).toBe(c.id);
    fireEvent.keyDown(list(), { key: 'x', ctrlKey: true });
    expect(steps()).toHaveLength(39);
  });
});

describe('Details editors', () => {
  it('sets a duration override in minutes and a typed location, each one undo entry', () => {
    const { store, steps } = setup();
    select(store, 0);
    fireEvent.click(tab(/^Details/));
    const minutes = sidePanel().getByLabelText('Duration override (minutes)');
    minutes.focus();
    fireEvent.change(minutes, { target: { value: '2.5' } });
    fireEvent.keyDown(minutes, { key: 'Enter' });
    expect(steps()[0]?.durationOverride).toBe(150);
    expect(announced()).toBe('Duration of step 1 set to 2 minutes 30 seconds.');
    // The editor is not remounted by its own commit: focus stays in the field (UI-F4).
    expect(document.activeElement).toBe(minutes);
    expect(sidePanel().getByLabelText('Duration override (minutes)')).toBe(minutes);
    expect(sidePanel().getByText("(override 2m 30s for the step's own work)")).toBeTruthy();
    const location = sidePanel().getByRole('group', { name: 'Location' });
    fireEvent.change(within(location).getByLabelText('Zone'), { target: { value: String(steps()[1]?.location?.source.space === 'zone' ? steps()[1]?.location?.source.uiMapId : '') } });
    fireEvent.change(within(location).getByLabelText('X %'), { target: { value: '12.5' } });
    fireEvent.change(within(location).getByLabelText('Y %'), { target: { value: '80' } });
    fireEvent.click(within(location).getByRole('button', { name: 'Set point' }));
    expect(steps()[0]?.location?.source).toMatchObject({ space: 'zone', x: 12.5, y: 80, frame: 'forever' });
    expect(store.getState().history.undoLabel).toBe('Set location');
    // No map in this shell: picking says so.
    expect(within(location).getByRole('button', { name: 'Pick on map' }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('custom quests', () => {
  it('creates an invented quest with user XP, shows it in Available and Details, and edits and deletes it', async () => {
    const { store } = setup();
    fireEvent.click(tab(/^Available/));
    fireEvent.click(sidePanel().getByRole('button', { name: 'New custom quest' }));
    // The editor loads on first use (CR-19).
    const form = await sidePanel().findByRole('form', { name: 'New custom quest' });
    // The form takes focus (UI-F5).
    expect(document.activeElement).toBe(within(form).getByLabelText('Name'));
    expect(within(form).getByLabelText<HTMLInputElement>('Quest id (negative for an invented quest)').value).toBe('-1');
    fireEvent.click(within(form).getByRole('button', { name: 'Save custom quest' }));
    const problem = within(form).getByText('The quest needs a name.');
    // The first failed save focuses the list, and the field it names is marked and described by it (UI-F6).
    expect(document.activeElement?.contains(problem)).toBe(true);
    const nameField = within(form).getByLabelText('Name');
    expect(nameField.getAttribute('aria-invalid')).toBe('true');
    expect((nameField.getAttribute('aria-describedby') ?? '').split(' ')).toContain(problem.id);
    // The same problem again takes focus again.
    nameField.focus();
    fireEvent.click(within(form).getByRole('button', { name: 'Save custom quest' }));
    expect(document.activeElement?.contains(within(form).getByText('The quest needs a name.'))).toBe(true);
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Skyborne errand' } });
    fireEvent.change(within(form).getByLabelText('Level'), { target: { value: '3' } });
    fireEvent.change(within(form).getByLabelText('Base XP (yours, taken at the quest level)'), { target: { value: '250' } });
    fireEvent.change(within(form).getByLabelText('Forever status'), { target: { value: 'user-declared-new' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save custom quest' }));
    const quest = store.getState().project.customQuests[0];
    expect(quest).toMatchObject({ id: -1, name: 'Skyborne errand', level: 3, xp: { questLevel: 3, baseXp: 250, basis: 'user' }, provenance: { source: 'custom', foreverStatus: 'user-declared-new' } });
    expect(announced()).toBe('Custom quest “Skyborne errand” saved.');
    // Details shows it, as a custom quest with its XP entered by the user.
    expect(sidePanel().getByText('250 base XP at quest level 3 (entered by you)')).toBeTruthy();
    // Saving shows the quest in Details, with focus on the tab panel.
    expect(document.activeElement?.getAttribute('role')).toBe('tabpanel');
    fireEvent.click(sidePanel().getByRole('button', { name: 'Edit custom quest' }));
    const editForm = await sidePanel().findByRole('form', { name: 'Edit custom quest' });
    // The id is the quest's identity, which its steps use: read-only when editing (CR-10).
    const idField = within(editForm).getByLabelText<HTMLInputElement>('Quest id (negative for an invented quest)');
    expect(idField.readOnly).toBe(true);
    expect(document.getElementById(idField.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/^The id stays as it is/);
    // Cancel puts focus back on the button that opened the editor.
    fireEvent.click(within(editForm).getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(sidePanel().getByRole('button', { name: 'Edit custom quest' }));
    fireEvent.click(sidePanel().getByRole('button', { name: 'Edit custom quest' }));
    const renameForm = await sidePanel().findByRole('form', { name: 'Edit custom quest' });
    fireEvent.change(within(renameForm).getByLabelText('Name'), { target: { value: 'Skyborne errand, revised' } });
    fireEvent.click(within(renameForm).getByRole('button', { name: 'Save custom quest' }));
    expect(store.getState().project.customQuests.map((q) => q.name)).toEqual(['Skyborne errand, revised']);
    // Add its steps, then delete it: the editor says how many steps use it.
    fireEvent.click(sidePanel().getByRole('button', { name: 'Add accept, complete and turn in' }));
    fireEvent.click(sidePanel().getByRole('button', { name: 'Edit custom quest' }));
    const deleteButton = await sidePanel().findByRole('button', { name: 'Delete custom quest' });
    expect(document.getElementById(deleteButton.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Deleting it: 3 steps use this quest and keep its id, which then means a quest this project does not know.',
    );
    fireEvent.click(deleteButton);
    expect(store.getState().project.customQuests).toEqual([]);
    expect(announced()).toBe(
      'Custom quest “Skyborne errand, revised” deleted. 3 steps use this quest and keep its id, which then means a quest this project does not know. Undo with Ctrl+Z.',
    );
  });

  it('replaces a dataset quest with a custom one, says so (DATA001-custom-shadowed), and goes back to the dataset record', async () => {
    // The map test data: QuestieDB-sourced stubs, quest 2 "Cull" with a kill objective (its accept is step 3).
    const { store } = setup('map');
    select(store, 2);
    fireEvent.click(tab(/^Details/));
    fireEvent.click(sidePanel().getByRole('button', { name: 'Replace with a custom quest' }));
    const form = await sidePanel().findByRole('form', { name: 'Replace with a custom quest' });
    expect(form.textContent).toContain('DATA001-custom-shadowed');
    expect(within(form).getByLabelText<HTMLInputElement>('Name').value).toBe('Cull');
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Cull, as it is in Forever' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save custom quest' }));
    expect(store.getState().project.customQuests[0]).toMatchObject({ id: 2, name: 'Cull, as it is in Forever', objectives: [{ kind: 'kill' }], provenance: { source: 'custom' } });
    expect(sidePanel().getByText(/this custom quest replaces the dataset quest “Cull” in this project/)).toBeTruthy();
    fireEvent.click(sidePanel().getByRole('button', { name: 'Use the dataset record' }));
    expect(store.getState().project.customQuests).toEqual([]);
    // Its button left with the custom quest: focus is on the button that took its place (UI-F5).
    expect(document.activeElement).toBe(sidePanel().getByRole('button', { name: 'Replace with a custom quest' }));
  });
});

/** Opens Settings, which loads on first use (CR-19), and waits for its form. */
async function openSettings() {
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  await screen.findByRole('button', { name: 'Save settings' });
  return within(screen.getByRole('dialog', { name: 'Settings' }));
}

describe('Settings', () => {
  it('edits the character and route profile as one undo entry, and refuses a start level above the cap', async () => {
    const { store } = setup();
    const dialog = await openSettings();
    fireEvent.change(dialog.getByLabelText('Race'), { target: { value: 'Tauren' } });
    // Warrior is a Tauren class; Mage is not offered.
    expect(dialog.getAllByRole('option').some((o) => o.textContent === 'Mage')).toBe(false);
    fireEvent.change(dialog.getByLabelText('Class'), { target: { value: 'DRUID' } });
    fireEvent.change(dialog.getByLabelText('Start level (1 to 60)'), { target: { value: '61' } });
    const save = dialog.getByRole('button', { name: 'Save settings' });
    fireEvent.pointerDown(save);
    fireEvent.click(save);
    const problem = dialog.getByText('The start level must be a whole number from 1 to 60.');
    // The first failed save focuses the list, the field is marked and described by its problem (UI-F6),
    // and the announcement goes to the dialog's own region: the shell's is inert behind it (UI-F2).
    expect(document.activeElement?.contains(problem)).toBe(true);
    const level = dialog.getByLabelText('Start level (1 to 60)');
    expect(level.getAttribute('aria-invalid')).toBe('true');
    expect(level.getAttribute('aria-describedby')).toBe(problem.id);
    const dialogElement = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialogElement.querySelector('.frl-dialog-live')?.textContent).toBe('Not saved: The start level must be a whole number from 1 to 60.');
    expect(announced()).toBe('');
    // A press on the backdrop keeps the draft (UI-F10).
    fireEvent.pointerDown(dialogElement);
    fireEvent.click(dialogElement);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBe(dialogElement);
    fireEvent.change(dialog.getByLabelText('Start level (1 to 60)'), { target: { value: '12' } });
    fireEvent.change(dialog.getByLabelText('Before the route'), { target: { value: 'listed' } });
    fireEvent.change(dialog.getByLabelText('Quests completed before the route (ids)'), { target: { value: '900001, 900002' } });
    fireEvent.click(dialog.getByLabelText('Hardcore'));
    fireEvent.change(dialog.getByLabelText('Season (empty: unknown)'), { target: { value: '2' } });
    fireEvent.pointerDown(save);
    fireEvent.click(dialog.getByRole('button', { name: 'Save settings' }));
    const project = store.getState().project;
    expect(project.character).toMatchObject({ race: 'Tauren', class: 'DRUID', startLevel: 12, priorHistory: 'listed', priorCompletedQuests: [900001, 900002] });
    expect(project.routeProfile).toMatchObject({ hardcore: true, season: 2 });
    expect(store.getState().history.undoLabel).toBe('Edit settings');
    // The save closes the dialog, so its result is said in the shell's region, after the close.
    expect(announced()).toBe('Settings saved. Undo with Ctrl+Z.');
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
  });

  it('shows a race the faction does not have as it is, instead of the first race (UI-F15)', async () => {
    const { store } = setup();
    act(() => {
      store.dispatch(updateSettings({ character: { faction: 'Alliance', race: 'Orc' } }));
    });
    const dialog = await openSettings();
    const race = dialog.getByLabelText<HTMLSelectElement>('Race');
    expect(race.value).toBe('Orc');
    expect(race.selectedOptions[0]?.textContent).toBe('Orc (not a race of the Alliance)');
  });

  it('shows and keeps a partly known history’s quest lists as a partial record (ENG-12)', async () => {
    const { store } = setup();
    act(() => {
      store.dispatch(updateSettings({ character: { priorHistory: 'unknown', priorCompletedQuests: [900_001 as QuestId], priorQuestLog: [900_004 as QuestId] } }));
    });
    const dialog = await openSettings();
    expect(dialog.getByLabelText<HTMLInputElement>('Quests known to be completed before the route (ids, a partial record)').value).toBe('900001');
    expect(dialog.getByLabelText<HTMLInputElement>('Quests known to be in the log at the start (ids, a partial record)').value).toBe('900004');
    expect(dialog.getByText(/^A partial record:/)).toBeTruthy();
    // An unrelated change keeps the lists.
    fireEvent.change(dialog.getByLabelText('Start level (1 to 60)'), { target: { value: '8' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save settings' }));
    expect(store.getState().project.character).toMatchObject({ startLevel: 8, priorHistory: 'unknown', priorCompletedQuests: [900_001], priorQuestLog: [900_004] });
    // Choosing "A new character" empties them where the user sees it.
    const again = await openSettings();
    fireEvent.change(again.getByLabelText('Before the route'), { target: { value: 'fresh' } });
    expect(again.queryByLabelText(/Quests .*completed before the route/)).toBeNull();
    fireEvent.click(again.getByRole('button', { name: 'Save settings' }));
    expect(store.getState().project.character).toMatchObject({ priorHistory: 'fresh', priorCompletedQuests: [], priorQuestLog: [] });
  });

  it('drops the draft on Cancel', async () => {
    const { store } = setup();
    const dialog = await openSettings();
    fireEvent.change(dialog.getByLabelText('Start level (1 to 60)'), { target: { value: '30' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(store.getState().project.character.startLevel).toBe(1);
    expect(store.getState().history.canUndo).toBe(false);
  });
});
