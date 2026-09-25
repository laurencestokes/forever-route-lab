import { describe, expect, it } from 'vitest';
import { makeNoteStep, type StepId } from '../domain';
import {
  applySelect,
  EMPTY_SELECTION,
  pruneSelection,
  reconcileSelection,
  sameSelection,
  selectedSteps,
  type Selection,
} from './selection';
import { idSet, notes, sid, sorted } from './test-helpers';

const steps = notes('abcdef');

function sel(letters: string, anchor: string | null, focus: string | null): Selection {
  return { stepIds: idSet(...letters), anchor: anchor === null ? null : sid(anchor), focus: focus === null ? null : sid(focus) };
}

const show = (s: Selection): { ids: string[]; anchor: StepId | null; focus: StepId | null } => ({
  ids: sorted(s.stepIds),
  anchor: s.anchor,
  focus: s.focus,
});

describe('applySelect', () => {
  it('single selects one step and sets anchor and focus', () => {
    const out = applySelect(sel('abc', 'a', 'c'), steps, { kind: 'single', id: sid('d') });
    expect(show(out)).toEqual({ ids: ['s-d'], anchor: 's-d', focus: 's-d' });
  });

  it('toggle adds and removes, moving anchor and focus to the toggled step', () => {
    const added = applySelect(sel('a', 'a', 'a'), steps, { kind: 'toggle', id: sid('c') });
    expect(show(added)).toEqual({ ids: ['s-a', 's-c'], anchor: 's-c', focus: 's-c' });
    const removed = applySelect(added, steps, { kind: 'toggle', id: sid('a') });
    expect(show(removed)).toEqual({ ids: ['s-c'], anchor: 's-a', focus: 's-a' });
  });

  it('range selects from the anchor to the target inclusive, in either direction', () => {
    const down = applySelect(sel('b', 'b', 'b'), steps, { kind: 'range', id: sid('e') });
    expect(show(down)).toEqual({ ids: ['s-b', 's-c', 's-d', 's-e'], anchor: 's-b', focus: 's-e' });
    const up = applySelect(down, steps, { kind: 'range', id: sid('a') });
    expect(show(up)).toEqual({ ids: ['s-a', 's-b'], anchor: 's-b', focus: 's-a' });
    const self = applySelect(down, steps, { kind: 'range', id: sid('b') });
    expect(show(self)).toEqual({ ids: ['s-b'], anchor: 's-b', focus: 's-b' });
  });

  it('range replaces a toggled selection and anchors on the last toggled step', () => {
    const toggled = applySelect(sel('a', 'a', 'a'), steps, { kind: 'toggle', id: sid('d') });
    const out = applySelect(toggled, steps, { kind: 'range', id: sid('f') });
    expect(show(out)).toEqual({ ids: ['s-d', 's-e', 's-f'], anchor: 's-d', focus: 's-f' });
  });

  it('range without an anchor (or with a vanished one) acts as a single click', () => {
    expect(show(applySelect(EMPTY_SELECTION, steps, { kind: 'range', id: sid('c') }))).toEqual({
      ids: ['s-c'],
      anchor: 's-c',
      focus: 's-c',
    });
    expect(show(applySelect(sel('', 'z', null), steps, { kind: 'range', id: sid('c') }))).toEqual({
      ids: ['s-c'],
      anchor: 's-c',
      focus: 's-c',
    });
  });

  it('all selects every step, keeping a valid anchor and focus', () => {
    expect(show(applySelect(EMPTY_SELECTION, steps, { kind: 'all' }))).toEqual({
      ids: ['s-a', 's-b', 's-c', 's-d', 's-e', 's-f'],
      anchor: 's-a',
      focus: 's-f',
    });
    const kept = applySelect(sel('c', 'c', 'd'), steps, { kind: 'all' });
    expect([kept.anchor, kept.focus]).toEqual([sid('c'), sid('d')]);
    expect(applySelect(sel('a', 'a', 'a'), [], { kind: 'all' })).toBe(EMPTY_SELECTION);
  });

  it('set selects exactly the given ids that exist, anchored and focused in route order', () => {
    const out = applySelect(EMPTY_SELECTION, steps, { kind: 'set', ids: [sid('e'), sid('zz'), sid('b')] });
    expect(show(out)).toEqual({ ids: ['s-b', 's-e'], anchor: 's-b', focus: 's-e' });
    expect(applySelect(sel('a', 'a', 'a'), steps, { kind: 'set', ids: [] })).toBe(EMPTY_SELECTION);
  });

  it('none clears everything', () => {
    expect(applySelect(sel('abc', 'a', 'c'), steps, { kind: 'none' })).toBe(EMPTY_SELECTION);
  });

  it('ignores ids that are not in the route', () => {
    const current = sel('a', 'a', 'a');
    for (const kind of ['single', 'toggle', 'range'] as const) {
      expect(applySelect(current, steps, { kind, id: sid('zz') })).toBe(current);
    }
  });

  it('returns the same object when nothing changes', () => {
    const current = sel('b', 'b', 'b');
    expect(applySelect(current, steps, { kind: 'single', id: sid('b') })).toBe(current);
    expect(applySelect(EMPTY_SELECTION, steps, { kind: 'none' })).toBe(EMPTY_SELECTION);
    const all = applySelect(EMPTY_SELECTION, steps, { kind: 'all' });
    expect(applySelect(all, steps, { kind: 'all' })).toBe(all);
  });
});

describe('pruneSelection', () => {
  it('drops vanished ids and keeps identity when nothing vanished', () => {
    const current = sel('bcd', 'b', 'd');
    expect(pruneSelection(current, steps)).toBe(current);
    const out = pruneSelection(current, steps.filter((s) => s.id !== sid('c')));
    expect(show(out)).toEqual({ ids: ['s-b', 's-d'], anchor: 's-b', focus: 's-d' });
  });

  it('moves a vanished focus to the next surviving step, else the previous one', () => {
    const remaining = notes('abf');
    expect(pruneSelection(sel('cde', 'c', 'e'), remaining, steps).focus).toBe(sid('f'));
    expect(pruneSelection(sel('cde', 'e', 'c'), remaining, steps).focus).toBe(sid('f'));
    expect(pruneSelection(sel('ef', 'e', 'f'), notes('abcd'), steps).focus).toBe(sid('d'));
  });

  it('falls back from a vanished anchor to the focus', () => {
    const out = pruneSelection(sel('cd', 'c', 'd'), notes('abdef'), steps);
    expect(show(out)).toEqual({ ids: ['s-d'], anchor: 's-d', focus: 's-d' });
  });

  it('without the previous steps a vanished focus becomes null', () => {
    expect(pruneSelection(sel('c', 'c', 'c'), notes('ab'))).toEqual({ stepIds: new Set(), anchor: null, focus: null });
  });

  it('empties when every step is gone', () => {
    expect(show(pruneSelection(sel('abcdef', 'a', 'f'), [], steps))).toEqual({ ids: [], anchor: null, focus: null });
  });
});

describe('reconcileSelection', () => {
  it('selects created steps, anchored on the first and focused on the last', () => {
    const x = makeNoteStep({ next: () => 'new-1' }, { text: 'Placeholder x' });
    const y = makeNoteStep({ next: () => 'new-2' }, { text: 'Placeholder y' });
    const after = [...steps.slice(0, 2), x, y, ...steps.slice(2)];
    const out = reconcileSelection(sel('b', 'b', 'b'), steps, after);
    expect(show(out)).toEqual({ ids: ['new-1', 'new-2'], anchor: 'new-1', focus: 'new-2' });
  });

  it('prunes with neighbour focus when steps were only removed', () => {
    const out = reconcileSelection(sel('bc', 'b', 'c'), steps, notes('adef'));
    expect(show(out)).toEqual({ ids: [], anchor: 's-d', focus: 's-d' });
  });

  it('keeps the selection object for a reorder or an identical list', () => {
    const current = sel('bc', 'b', 'c');
    expect(reconcileSelection(current, steps, steps)).toBe(current);
    expect(reconcileSelection(current, steps, [...steps].reverse())).toBe(current);
  });
});

describe('helpers', () => {
  it('sameSelection compares content', () => {
    expect(sameSelection(sel('ab', 'a', 'b'), sel('ba', 'a', 'b'))).toBe(true);
    expect(sameSelection(sel('ab', 'a', 'b'), sel('ab', 'b', 'b'))).toBe(false);
    expect(sameSelection(sel('ab', 'a', 'b'), sel('abc', 'a', 'b'))).toBe(false);
  });

  it('selectedSteps returns route order', () => {
    expect(selectedSteps(steps, idSet('e', 'a', 'c')).map((s) => s.id)).toEqual([sid('a'), sid('c'), sid('e')]);
  });
});
