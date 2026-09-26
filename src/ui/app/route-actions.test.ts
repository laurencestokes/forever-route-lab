import { describe, expect, it, vi } from 'vitest';
import { createEditorStore, fixedClock } from '../../app';
import { createPlaceholderWorkspace } from '../../app/placeholder-project';
import { sequentialIdSource } from '../../app/shell-support';
import type { StepId } from '../../domain/ids';
import { createRouteActions, DEFAULT_GRIND_SECONDS, UNDO_HINT } from './route-actions';

const NOW = '2026-09-25T12:00:00.000Z';

function setup() {
  const { project, dataset } = createPlaceholderWorkspace({ nowIso: NOW });
  const store = createEditorStore({ project, ids: sequentialIdSource(1000), clock: fixedClock(NOW) });
  const announce = vi.fn<(message: string) => void>();
  const actions = createRouteActions(store, announce);
  const ids = (...positions: number[]): ReadonlySet<StepId> =>
    new Set(positions.map((p) => store.getState().project.route.steps[p - 1]?.id).filter((id) => id !== undefined));
  const last = () => announce.mock.calls.at(-1)?.[0];
  return { store, actions, announce, ids, last, dataset };
}

describe('createRouteActions', () => {
  it('announces deletions with the undo hint, and reports whether anything was deleted', () => {
    const { store, actions, ids, last } = setup();
    expect(actions.deleteSteps(ids(2, 3))).toBe(true);
    expect(last()).toBe(`2 steps deleted. ${UNDO_HINT}`);
    expect(store.getState().project.route.steps).toHaveLength(38);
    expect(actions.deleteSteps()).toBe(false);
  });

  it('says nothing when a command changes nothing', () => {
    const { store, actions, announce, ids } = setup();
    actions.moveSteps({ by: -1 }, ids(1));
    actions.duplicateSteps(new Set());
    actions.undo();
    store.acquireLock('optimizer');
    expect(actions.deleteSteps(ids(2))).toBe(false);
    actions.insertNote();
    expect(announce).not.toHaveBeenCalled();
  });

  it('announces moves with their direction and the new positions', () => {
    const { actions, ids, last } = setup();
    actions.moveSteps({ by: 1 }, ids(2));
    expect(last()).toBe('1 step moved down: now step 3.');
    actions.moveSteps({ by: -1 }, ids(3, 4));
    expect(last()).toBe('2 steps moved up: now steps 2 to 3.');
    actions.moveSteps({ toIndex: 0 }, ids(5));
    expect(last()).toBe('1 step moved: now step 1.');
  });

  it('announces duplicates, lock changes and inserts', () => {
    const { store, actions, ids, last } = setup();
    actions.duplicateSteps(ids(2, 3));
    expect(last()).toBe('2 steps duplicated: the copies are steps 4 to 5.');
    actions.toggleLock(ids(2));
    expect(last()).toBe('1 step locked.');
    actions.toggleLock(ids(2));
    expect(last()).toBe('1 step unlocked.');
    store.select({ kind: 'single', id: [...ids(1)][0] as StepId });
    actions.insertTravel();
    expect(last()).toBe('Travel inserted as step 2.');
    actions.insertNote();
    expect(last()).toBe('Note inserted as step 3.');
    actions.insertGrind();
    expect(last()).toBe('Grind inserted as step 4.');
    const grind = store.getState().project.route.steps[3];
    expect(grind?.kind === 'grind' ? grind.until : null).toEqual({ kind: 'duration', seconds: DEFAULT_GRIND_SECONDS });
  });

  it('acts on the selection when no ids are given', () => {
    const { store, actions, ids, last } = setup();
    store.select({ kind: 'set', ids: [...ids(2, 3, 4)] });
    actions.toggleLock();
    expect(last()).toBe('3 steps locked.');
    actions.deleteSteps();
    expect(last()).toBe(`3 steps deleted. ${UNDO_HINT}`);
  });

  it('announces undo and redo with the entry they applied', () => {
    const { actions, ids, last } = setup();
    actions.deleteSteps(ids(2));
    actions.undo();
    expect(last()).toBe('Undone: Delete steps.');
    actions.redo();
    expect(last()).toBe('Redone: Delete steps.');
  });

  it('announces cut, copy, paste and join, and says nothing when they change nothing', () => {
    const { store, actions, announce, ids, last } = setup();
    expect(actions.cutSteps(ids(2, 3))).toBe(true);
    expect(last()).toBe('2 steps cut. Paste with Ctrl+V; undo with Ctrl+Z.');
    store.select({ kind: 'single', id: [...ids(1)][0] as StepId });
    actions.pasteSteps();
    expect(last()).toBe('2 steps pasted as steps 2 to 3.');
    actions.copySteps(ids(5));
    expect(last()).toBe('1 step copied. Paste with Ctrl+V.');
    store.select({ kind: 'set', ids: [...ids(1, 4, 7)] });
    actions.joinSections();
    expect(last()).toBe('3 sections joined: now steps 1 to 3.');
    const calls = announce.mock.calls.length;
    store.select({ kind: 'set', ids: [...ids(1, 2)] });
    actions.joinSections();
    actions.copySteps(new Set());
    expect(announce.mock.calls.length).toBe(calls);
  });

  it('adds a quest’s steps with where they are, and says which have no location', () => {
    const { store, actions, dataset, last } = setup();
    store.select({ kind: 'none' });
    const quest = dataset.quests()[0];
    if (quest === undefined) throw new Error('quest missing');
    expect(actions.addQuest(dataset, quest.id, ['accept', 'turnin'])).toBe(true);
    expect(last()).toBe(`${quest.name}: accept quest, turn in quest added as steps 41 to 42.`);
    expect(actions.addQuest(dataset, 424242 as never, ['accept'])).toBe(true);
    expect(last()).toBe('Quest 424242: accept quest added as step 43. 1 step has no location: the dataset has no usable spawn for it.');
  });

  it('announces location and duration edits', () => {
    const { store, actions, last } = setup();
    const first = store.getState().project.route.steps[0];
    if (first === undefined) throw new Error('step missing');
    actions.setDuration(first.id, 90);
    expect(last()).toBe('Duration of step 1 set to 1 minute 30 seconds.');
    actions.setDuration(first.id, null);
    expect(last()).toBe('Duration override of step 1 cleared: the estimate applies.');
    const location = store.getState().project.route.steps[1]?.location ?? null;
    actions.setLocation(first.id, location);
    expect(last()).toBe('Location of step 1 set.');
    actions.setLocation(first.id, null);
    expect(last()).toBe('Location of step 1 cleared.');
  });
});
