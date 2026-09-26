import { describe, expect, it, vi } from 'vitest';
import { type ProjectV1, sequentialIdSource, stepId } from '../domain';
import { fixedClock, manualClock } from './clock';
import {
  type Command,
  type CommandContext,
  copySelected,
  cutSelected,
  deleteSelected,
  duplicateSelected,
  insertNote,
  moveSelected,
  paste,
  renameRoute,
  toggleLockSelected,
  updateStepNote,
} from './commands';
import { DEFAULT_MAP_UI, patchMapUi } from './map-view';
import { createEditorStore, DEFAULT_VIEW, type EditorStoreOptions, NO_LOCKS } from './store';
import { notesProject, order, sid, sorted, T0 } from './test-helpers';

const LATER = '2026-01-02T03:04:05.000Z';

function makeStore(letters = 'abcd', opts: Partial<EditorStoreOptions> = {}) {
  return createEditorStore({ project: notesProject(letters), ids: sequentialIdSource(), clock: fixedClock(LATER), ...opts });
}

/** A keyless command that renames the route, for history tests. */
const setName = (name: string): Command => ({
  label: `Name ${name}`,
  apply: (p) => ({ ...p, route: { ...p.route, name } }),
});

const identity: Command = { label: 'Nothing', apply: (p) => p };

describe('createEditorStore', () => {
  it('starts at revision 0 with an empty selection, default view and no history', () => {
    const project = notesProject('ab');
    const store = createEditorStore({ project, ids: sequentialIdSource(), clock: fixedClock(LATER), view: { theme: 'dark' } });
    const s = store.getState();
    expect(s.project).toBe(project);
    expect(s.revision).toBe(0);
    expect(s.selection.stepIds.size).toBe(0);
    expect(s.view).toEqual({ ...DEFAULT_VIEW, theme: 'dark' });
    expect(s.editingLocked).toBe(false);
    expect(s.locks).toBe(NO_LOCKS);
    expect(s.clipboard.steps).toEqual([]);
    expect(s.history).toEqual({ canUndo: false, canRedo: false, undoLabel: null, redoLabel: null, undoDepth: 0, redoDepth: 0 });
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
  });

  it('rejects invalid limits', () => {
    expect(() => makeStore('a', { historyLimit: -1 })).toThrow(RangeError);
    expect(() => makeStore('a', { historyLimit: 1.5 })).toThrow(RangeError);
    expect(() => makeStore('a', { historyMaxBytes: Number.NaN })).toThrow(RangeError);
    expect(() => makeStore('a', { coalesceWindowMs: -1 })).toThrow(RangeError);
    expect(() => makeStore('a', { coalesceWindowMs: null, historyLimit: 0 })).not.toThrow();
  });
});

describe('dispatch', () => {
  it('applies the command, bumps the revision and stamps updatedAt', () => {
    const store = makeStore('ab');
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch(renameRoute('Placeholder renamed'));
    const s = store.getState();
    expect(s.project.route.name).toBe('Placeholder renamed');
    expect(s.project.updatedAt).toBe(LATER);
    expect(s.project.createdAt).toBe(T0);
    expect(s.revision).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(s.history).toMatchObject({ canUndo: true, undoLabel: 'Rename route', undoDepth: 1 });
  });

  it('gives the command the store ids, the clock time, the selection and the clipboard', () => {
    const store = makeStore('ab');
    store.select({ kind: 'single', id: sid('a') });
    const apply = vi.fn((p: ProjectV1, _ctx: CommandContext) => p);
    store.dispatch({ label: 'Spy', apply });
    expect(apply.mock.calls[0]?.[1]).toMatchObject({ nowIso: LATER, selection: store.getState().selection, clipboard: store.getState().clipboard });
    store.dispatch(insertNote({ text: 'Placeholder x' }));
    expect(store.getState().project.route.steps[1]?.id).toBe(stepId('step-1'));
  });

  it('never hands a command an id the project already uses', () => {
    const store = makeStore('ab', { ids: sequentialIdSource() });
    store.dispatch(insertNote({ text: 'Placeholder x' }));
    const first = store.getState().project;
    // A second store over the same project with a restarted counter must not reuse step-1.
    const restarted = createEditorStore({ project: first, ids: sequentialIdSource(), clock: fixedClock(LATER) });
    restarted.dispatch(insertNote({ text: 'Placeholder y' }));
    const ids = restarted.getState().project.route.steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('treats a command that returns the same project as a no-op', () => {
    const store = makeStore('ab');
    const before = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch(identity);
    store.dispatch(deleteSelected()); // nothing selected
    store.dispatch(renameRoute(before.project.route.name));
    expect(store.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    expect(store.canUndo()).toBe(false);
  });

  it('leaves the state unchanged when a command throws', () => {
    const store = makeStore('ab');
    const before = store.getState();
    expect(() =>
      store.dispatch({
        label: 'Boom',
        apply: () => {
          throw new Error('boom');
        },
      }),
    ).toThrow('boom');
    expect(store.getState()).toBe(before);
  });
});

describe('undo and redo', () => {
  it('walks back and forward through snapshots, bumping the revision each time', () => {
    const store = makeStore('ab');
    const p0 = store.getState().project;
    store.dispatch(setName('one'));
    const p1 = store.getState().project;
    store.dispatch(setName('two'));
    expect(store.getState().history.undoLabel).toBe('Name two');

    store.undo();
    expect(store.getState().project.route).toBe(p1.route);
    expect(store.getState().history).toMatchObject({ undoLabel: 'Name one', redoLabel: 'Name two', undoDepth: 1, redoDepth: 1 });
    store.undo();
    expect(store.getState().project.route).toBe(p0.route);
    expect(store.getState().revision).toBe(4);
    expect(store.canUndo()).toBe(false);
    store.undo(); // nothing left: no-op
    expect(store.getState().revision).toBe(4);

    store.redo();
    store.redo();
    expect(store.getState().project.route.name).toBe('two');
    expect(store.getState().revision).toBe(6);
    expect(store.canRedo()).toBe(false);
    store.redo();
    expect(store.getState().revision).toBe(6);
  });

  it('stamps updatedAt on undo and redo', () => {
    const clock = manualClock(LATER);
    const store = makeStore('ab', { clock });
    store.dispatch(setName('one'));
    clock.advance(60_000);
    store.undo();
    expect(store.getState().project.updatedAt).toBe('2026-01-02T03:05:05.000Z');
    clock.advance(60_000);
    store.redo();
    expect(store.getState().project.updatedAt).toBe('2026-01-02T03:06:05.000Z');
  });

  it('a new command clears the redo stack', () => {
    const store = makeStore('ab');
    store.dispatch(setName('one'));
    store.dispatch(setName('two'));
    store.undo();
    expect(store.canRedo()).toBe(true);
    store.dispatch(setName('three'));
    expect(store.canRedo()).toBe(false);
    store.undo();
    expect(store.getState().project.route.name).toBe('one');
  });

  it('restores the selection that went with each snapshot, dropping vanished ids', () => {
    const store = makeStore('abcd');
    store.select({ kind: 'single', id: sid('b') });
    store.select({ kind: 'range', id: sid('c') });
    store.dispatch(deleteSelected());
    expect(order(store.getState().project)).toBe('ad');
    expect(store.getState().selection).toMatchObject({ anchor: sid('d'), focus: sid('d') });
    expect(store.getState().selection.stepIds.size).toBe(0);

    store.undo();
    expect(order(store.getState().project)).toBe('abcd');
    expect(sorted(store.getState().selection.stepIds)).toEqual(['s-b', 's-c']);
    expect(store.getState().selection).toMatchObject({ anchor: sid('b'), focus: sid('c') });

    store.redo();
    expect(store.getState().selection.stepIds.size).toBe(0);
    expect(store.getState().selection.focus).toBe(sid('d'));
  });

  it('undo restores the selection from before the command, redo the one from when undo ran', () => {
    const store = makeStore('ab');
    store.select({ kind: 'single', id: sid('a') });
    store.dispatch(insertNote({ text: 'Placeholder x' }));
    expect(sorted(store.getState().selection.stepIds)).toEqual(['step-1']);
    store.select({ kind: 'toggle', id: sid('b') });
    store.undo();
    expect(sorted(store.getState().selection.stepIds)).toEqual(['s-a']);
    store.redo();
    // Redo brings back the selection as it was when undo ran.
    expect(sorted(store.getState().selection.stepIds)).toEqual(['s-b', 'step-1']);
  });
});

describe('coalescing', () => {
  it('merges consecutive commands with the same key into one undo entry', () => {
    const store = makeStore('ab');
    for (const text of ['P', 'Pl', 'Pla']) store.dispatch(updateStepNote(sid('a'), text));
    expect(store.getState().revision).toBe(3);
    expect(store.getState().history.undoDepth).toBe(1);
    store.undo();
    expect(store.getState().project.route.steps[0]?.note).toBeNull();
  });

  it('starts a new entry after the window, a different key, a selection change or breakCoalescing', () => {
    const clock = manualClock(LATER);
    const store = makeStore('ab', { clock });
    const note = (text: string) => updateStepNote(sid('a'), text);
    store.dispatch(note('1'));
    clock.advance(1001);
    store.dispatch(note('2'));
    expect(store.getState().history.undoDepth).toBe(2);
    store.dispatch(updateStepNote(sid('b'), 'x'));
    expect(store.getState().history.undoDepth).toBe(3);
    store.dispatch(note('3'));
    store.select({ kind: 'single', id: sid('a') });
    store.dispatch(note('4'));
    expect(store.getState().history.undoDepth).toBe(5);
    store.breakCoalescing();
    store.dispatch(note('5'));
    expect(store.getState().history.undoDepth).toBe(6);
  });

  it('coalesces held-key moves but not after an undo', () => {
    const store = makeStore('abcd');
    store.select({ kind: 'single', id: sid('a') });
    store.dispatch(moveSelected({ by: 1 }));
    store.dispatch(moveSelected({ by: 1 }));
    expect(order(store.getState().project)).toBe('bcad');
    expect(store.getState().history.undoDepth).toBe(1);
    store.undo();
    expect(order(store.getState().project)).toBe('abcd');
    store.dispatch(moveSelected({ by: 1 }));
    store.dispatch(moveSelected({ by: 1 }));
    store.undo();
    expect(order(store.getState().project)).toBe('abcd');
  });

  it('a null window coalesces regardless of time', () => {
    const clock = manualClock(LATER);
    const store = makeStore('ab', { clock, coalesceWindowMs: null });
    store.dispatch(renameRoute('x'));
    clock.advance(3_600_000);
    store.dispatch(renameRoute('xy'));
    expect(store.getState().history.undoDepth).toBe(1);
  });
});

describe('history cap', () => {
  it('keeps at most historyLimit entries', () => {
    const store = makeStore('a', { historyLimit: 3 });
    for (let i = 1; i <= 5; i += 1) store.dispatch(setName(`n${i}`));
    expect(store.getState().history.undoDepth).toBe(3);
    store.undo();
    store.undo();
    store.undo();
    expect(store.getState().project.route.name).toBe('n2');
    expect(store.canUndo()).toBe(false);
  });

  it('defaults to 200 entries', () => {
    const store = makeStore('a');
    for (let i = 1; i <= 205; i += 1) store.dispatch(setName(`n${i}`));
    expect(store.getState().history.undoDepth).toBe(200);
    for (let i = 0; i < 200; i += 1) store.undo();
    expect(store.getState().project.route.name).toBe('n5');
  });

  it('historyLimit 0 disables undo', () => {
    const store = makeStore('a', { historyLimit: 0 });
    store.dispatch(setName('x'));
    expect(store.getState().revision).toBe(1);
    expect(store.canUndo()).toBe(false);
  });

  it('drops the oldest entries past the byte bound', () => {
    const store = makeStore('a', { historyMaxBytes: 50_000 });
    const blob = (tag: string): Command => ({ label: tag, apply: (p) => ({ ...p, ext: { blob: tag.repeat(10_000) } }) });
    for (const tag of ['a', 'b', 'c', 'd', 'e']) store.dispatch(blob(tag));
    // Each entry retains a 10,000-character string (about 20 KB), so two fit under 50 KB.
    expect(store.getState().history.undoDepth).toBe(2);
  });
});

describe('edit locks', () => {
  it('block dispatch, undo and redo, but not selection or view changes', () => {
    const store = makeStore('abc');
    store.dispatch(setName('one'));
    store.dispatch(setName('two'));
    store.undo();
    store.acquireLock('optimizer');
    const locked = store.getState();
    expect(locked.editingLocked).toBe(true);
    expect([...locked.locks]).toEqual(['optimizer']);
    expect(locked.history).toMatchObject({ canUndo: false, canRedo: false, undoLabel: null, redoLabel: null });
    expect(store.canUndo()).toBe(false);

    store.dispatch(setName('three'));
    store.undo();
    store.redo();
    expect(store.getState()).toBe(locked);

    store.select({ kind: 'single', id: sid('a') });
    store.setView({ rightTab: 'validation' });
    expect(store.getState().project).toBe(locked.project);
    expect(store.getState().revision).toBe(locked.revision);

    store.releaseLock('optimizer');
    expect(store.getState().editingLocked).toBe(false);
    expect(store.getState().locks.size).toBe(0);
    expect(store.canUndo()).toBe(true);
    expect(store.canRedo()).toBe(true);
    store.redo();
    expect(store.getState().project.route.name).toBe('two');
  });

  it('stay locked until every reason is released, in any order', () => {
    const store = makeStore('a');
    store.acquireLock('optimizer');
    store.acquireLock('proposal');
    expect([...store.getState().locks].sort()).toEqual(['optimizer', 'proposal']);
    // The run ends first: the open proposal still locks editing.
    store.releaseLock('optimizer');
    expect(store.getState().editingLocked).toBe(true);
    store.dispatch(setName('blocked'));
    expect(store.getState().project.route.name).toBe('Placeholder route');
    store.releaseLock('proposal');
    expect(store.getState().editingLocked).toBe(false);
    store.dispatch(setName('free'));
    expect(store.getState().project.route.name).toBe('free');
  });

  it('never mutates a published lock set', () => {
    const store = makeStore('a');
    store.acquireLock('proposal');
    const held = store.getState().locks;
    store.acquireLock('optimizer');
    expect([...held]).toEqual(['proposal']);
    expect(store.getState().locks).not.toBe(held);
  });

  it('taking a held lock or releasing a free one is a no-op', () => {
    const store = makeStore('a');
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getState();
    store.releaseLock('proposal');
    expect(store.getState()).toBe(before);
    store.acquireLock('proposal');
    const locked = store.getState();
    store.acquireLock('proposal');
    expect(store.getState()).toBe(locked);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('taking a lock ends the open coalescing group', () => {
    const store = makeStore('a', { coalesceWindowMs: null });
    store.dispatch(updateStepNote(sid('a'), 'Placeholder n'));
    store.acquireLock('proposal');
    store.releaseLock('proposal');
    store.dispatch(updateStepNote(sid('a'), 'Placeholder no'));
    expect(store.getState().history.undoDepth).toBe(2);
  });

  it('releasing one lock reason leaves another held, and a redundant release is a no-op', () => {
    const store = makeStore('a');
    store.acquireLock('optimizer');
    store.acquireLock('proposal');
    store.releaseLock('proposal');
    expect([...store.getState().locks]).toEqual(['optimizer']);
    expect(store.getState().editingLocked).toBe(true);
    store.releaseLock('optimizer');
    const before = store.getState();
    store.releaseLock('optimizer');
    expect(store.getState()).toBe(before);
  });
});

describe('selection through the store', () => {
  it('select applies gestures and keeps the state when nothing changes', () => {
    const store = makeStore('abcde');
    store.select({ kind: 'single', id: sid('b') });
    store.select({ kind: 'range', id: sid('d') });
    expect(sorted(store.getState().selection.stepIds)).toEqual(['s-b', 's-c', 's-d']);
    const before = store.getState();
    store.select({ kind: 'range', id: sid('d') });
    store.select({ kind: 'single', id: sid('zz') });
    expect(store.getState()).toBe(before);
    store.select({ kind: 'toggle', id: sid('a') });
    expect(sorted(store.getState().selection.stepIds)).toEqual(['s-a', 's-b', 's-c', 's-d']);
    store.select({ kind: 'all' });
    expect(store.getState().selection.stepIds.size).toBe(5);
    store.select({ kind: 'none' });
    expect(store.getState().selection.stepIds.size).toBe(0);
    expect(store.getState().revision).toBe(0);
  });

  it('inserted, duplicated and pasted steps become the selection; focus follows the last one', () => {
    const store = makeStore('abc');
    store.select({ kind: 'single', id: sid('a') });
    store.dispatch(insertNote({ text: 'Placeholder x' }));
    expect(store.getState().selection).toMatchObject({ anchor: stepId('step-1'), focus: stepId('step-1') });
    store.select({ kind: 'single', id: sid('b') });
    store.select({ kind: 'range', id: sid('c') });
    store.dispatch(duplicateSelected());
    expect(order(store.getState().project)).toBe('axbcbc');
    expect(sorted(store.getState().selection.stepIds)).toEqual(['step-2', 'step-3']);
    expect(store.getState().selection.focus).toBe(stepId('step-3'));
  });

  it('keeps the selection when steps move or lock', () => {
    const store = makeStore('abc');
    store.select({ kind: 'single', id: sid('a') });
    const selection = store.getState().selection;
    store.dispatch(moveSelected({ by: 1 }));
    store.dispatch(toggleLockSelected());
    expect(store.getState().selection).toBe(selection);
    expect(store.getState().project.route.steps[1]).toMatchObject({ id: sid('a'), locked: true });
  });
});

describe('clipboard', () => {
  it('cut fills the clipboard and paste inserts fresh copies after the selection', () => {
    const store = makeStore('abcde');
    store.select({ kind: 'single', id: sid('b') });
    store.select({ kind: 'range', id: sid('c') });
    store.dispatch(cutSelected());
    expect(order(store.getState().project)).toBe('ade');
    expect(store.getState().clipboard.steps.map((s) => s.id)).toEqual([sid('b'), sid('c')]);
    store.select({ kind: 'single', id: sid('e') });
    store.dispatch(paste());
    expect(order(store.getState().project)).toBe('adebc');
    expect(sorted(store.getState().selection.stepIds)).toEqual(['step-1', 'step-2']);
    // Paste again: more fresh copies.
    store.dispatch(paste());
    expect(order(store.getState().project)).toBe('adebcbc');
  });

  it('undo does not touch the clipboard', () => {
    const store = makeStore('abc');
    store.select({ kind: 'single', id: sid('b') });
    store.dispatch(cutSelected());
    const clipboard = store.getState().clipboard;
    store.undo();
    expect(order(store.getState().project)).toBe('abc');
    expect(store.getState().clipboard).toBe(clipboard);
  });

  it('copy updates the clipboard and notifies without a revision or history entry', () => {
    const store = makeStore('abc');
    store.select({ kind: 'single', id: sid('c') });
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch(copySelected());
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().clipboard.steps.map((s) => s.id)).toEqual([sid('c')]);
    expect(store.getState().revision).toBe(0);
    expect(store.canUndo()).toBe(false);
  });

  it('paste with an empty clipboard does nothing', () => {
    const store = makeStore('abc');
    const before = store.getState();
    store.dispatch(paste());
    expect(store.getState()).toBe(before);
  });

  it('copy ends the open coalescing group: typing, copy, typing is two undo entries', () => {
    const store = makeStore('abc', { coalesceWindowMs: null });
    store.select({ kind: 'single', id: sid('a') });
    store.dispatch(updateStepNote(sid('a'), 'Placeholder n'));
    store.dispatch(updateStepNote(sid('a'), 'Placeholder no'));
    expect(store.getState().history.undoDepth).toBe(1);
    store.dispatch(copySelected());
    store.dispatch(updateStepNote(sid('a'), 'Placeholder not'));
    expect(store.getState().history.undoDepth).toBe(2);
    store.undo();
    expect(store.getState().project.route.steps[0]?.note).toBe('Placeholder no');
  });

  it('a copy that finds nothing to copy changes nothing, coalescing included', () => {
    const store = makeStore('abc', { coalesceWindowMs: null });
    store.dispatch(updateStepNote(sid('a'), 'Placeholder n'));
    const before = store.getState();
    store.dispatch(copySelected());
    expect(store.getState()).toBe(before);
    store.dispatch(updateStepNote(sid('a'), 'Placeholder no'));
    expect(store.getState().history.undoDepth).toBe(1);
  });

  it('copy works while editing is locked; cut and paste do not', () => {
    const store = makeStore('abc');
    store.select({ kind: 'single', id: sid('b') });
    store.acquireLock('proposal');
    store.dispatch(cutSelected());
    expect(order(store.getState().project)).toBe('abc');
    expect(store.getState().clipboard.steps).toEqual([]);
    store.dispatch(copySelected());
    expect(store.getState().clipboard.steps.map((s) => s.id)).toEqual([sid('b')]);
    const locked = store.getState();
    store.dispatch(paste());
    expect(store.getState()).toBe(locked);
    expect(locked.revision).toBe(0);
  });

  it('never calls apply on a clipboard-only command', () => {
    const store = makeStore('abc');
    store.select({ kind: 'single', id: sid('a') });
    const apply = vi.fn((p: ProjectV1) => ({ ...p, route: { ...p.route, name: 'changed' } }));
    store.dispatch({ ...copySelected(), apply });
    expect(apply).not.toHaveBeenCalled();
    expect(store.getState().project.route.name).toBe('Placeholder route');
    expect(store.getState().clipboard.steps).toHaveLength(1);
  });
});

describe('subscribe', () => {
  it('notifies until unsubscribed; unsubscribing twice is harmless', () => {
    const store = makeStore('ab');
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.dispatch(setName('x'));
    unsubscribe();
    unsubscribe();
    store.dispatch(setName('y'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies the listeners subscribed when the change happened, even if one unsubscribes another', () => {
    const store = makeStore('ab');
    const second = vi.fn();
    let unsubscribeSecond = (): void => undefined;
    store.subscribe(() => unsubscribeSecond());
    unsubscribeSecond = store.subscribe(second);
    store.dispatch(setName('x'));
    store.dispatch(setName('y'));
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('reads the new state inside the listener', () => {
    const store = makeStore('ab');
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.getState().revision));
    store.dispatch(setName('x'));
    store.undo();
    expect(seen).toEqual([1, 2]);
  });
});

describe('setView', () => {
  it('merges the patch and ignores patches that change nothing', () => {
    const store = makeStore('a');
    const listener = vi.fn();
    store.subscribe(listener);
    store.setView({ rightTab: 'details', showLayerPanel: true });
    expect(store.getState().view).toEqual({ rightTab: 'details', theme: 'system', showLayerPanel: true, map: DEFAULT_MAP_UI, openedQuests: null });
    const before = store.getState();
    store.setView({ rightTab: 'details' });
    store.setView({});
    expect(store.getState()).toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().revision).toBe(0);
  });

  it('compares nested view state by reference, so an unchanged map patch notifies nobody', () => {
    const store = makeStore('a');
    const listener = vi.fn();
    store.subscribe(listener);
    const current = store.getState().view.map;
    store.setView({ map: patchMapUi(current, { surface: current.surface, layers: { ...current.layers } }) });
    expect(listener).not.toHaveBeenCalled();
    store.setView({ map: patchMapUi(current, { surface: 'world:1' }) });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().view.map.surface).toBe('world:1');
    expect(store.getState().view.map.layers).toBe(current.layers);
    // Map state is view state: no revision, no undo entry.
    expect(store.getState().revision).toBe(0);
    expect(store.canUndo()).toBe(false);
  });
});

describe('replaceProject', () => {
  it('swaps the project, clears history, selection and clipboard, and keeps its timestamps', () => {
    const store = makeStore('abc');
    store.select({ kind: 'single', id: sid('a') });
    store.dispatch(copySelected());
    store.dispatch(setName('x'));
    store.dispatch(setName('y'));
    store.undo();
    const next = notesProject('de');
    expect(store.replaceProject(next)).toBe(true);
    const s = store.getState();
    expect(s.project).toBe(next);
    expect(s.revision).toBe(4);
    expect(s.selection.stepIds.size).toBe(0);
    expect(s.clipboard.steps).toEqual([]);
    expect(s.history).toMatchObject({ canUndo: false, canRedo: false, undoDepth: 0, redoDepth: 0 });
    // Nothing from the old project can be pasted into the new one.
    store.dispatch(paste());
    expect(store.getState().project).toBe(next);
  });

  it('replacing with the same project only clears history and clipboard', () => {
    const store = makeStore('a');
    store.select({ kind: 'single', id: sid('a') });
    store.dispatch(copySelected());
    store.dispatch(setName('x'));
    const { project, revision } = store.getState();
    expect(store.replaceProject(project)).toBe(true);
    expect(store.getState().revision).toBe(revision);
    expect(store.getState().clipboard.steps).toEqual([]);
    expect(store.canUndo()).toBe(false);
    const before = store.getState();
    expect(store.replaceProject(project)).toBe(true);
    expect(store.getState()).toBe(before);
  });

  it('is refused while any lock is held, and changes nothing', () => {
    const store = makeStore('abc');
    store.select({ kind: 'single', id: sid('a') });
    store.dispatch(copySelected());
    store.dispatch(setName('x'));
    for (const reason of ['proposal', 'optimizer'] as const) {
      store.acquireLock(reason);
      const locked = store.getState();
      expect(store.replaceProject(notesProject('de'))).toBe(false);
      expect(store.replaceProject(locked.project)).toBe(false);
      expect(store.getState()).toBe(locked);
      store.releaseLock(reason);
    }
    expect(store.canUndo()).toBe(true);
    expect(store.replaceProject(notesProject('de'))).toBe(true);
    expect(order(store.getState().project)).toBe('de');
  });
});
