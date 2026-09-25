import { describe, expect, it } from 'vitest';
import {
  groupId,
  type ProjectV1,
  type RouteGroup,
  type RouteStep,
  sequentialIdSource,
  stepId,
  uiMapId,
  zoneSourcedPoint,
} from '../domain';
import { serializeProject } from '../project';
import {
  type Clipboard,
  type CommandContext,
  copySelected,
  cutSelected,
  deleteSelected,
  duplicateSelected,
  EMPTY_CLIPBOARD,
  insertGrind,
  insertionIndex,
  insertNote,
  insertStep,
  insertTravel,
  joinSections,
  moveSelected,
  paste,
  patchStep,
  renameRoute,
  setLockedSelected,
  toggleLockSelected,
  updateStepNote,
} from './commands';
import { EMPTY_SELECTION, type Selection } from './selection';
import { idSet, notesProject, order, sid, T0 } from './test-helpers';

function ctx(opts: { selected?: string; focus?: string | null; clipboard?: Clipboard } = {}): CommandContext {
  const letters = [...(opts.selected ?? '')];
  const selection: Selection = {
    stepIds: idSet(...letters),
    anchor: letters[0] === undefined ? null : sid(letters[0]),
    focus: opts.focus !== undefined ? (opts.focus === null ? null : sid(opts.focus)) : letters.length > 0 ? sid(letters.at(-1) ?? '') : null,
  };
  return { ids: sequentialIdSource(), nowIso: T0, selection, clipboard: opts.clipboard ?? EMPTY_CLIPBOARD };
}

const GROUP: RouteGroup = { id: groupId('g-1'), rxp: null };

/** Steps b and c belong to group g-1. */
function grouped(letters = 'abcd'): ProjectV1 {
  const p = notesProject(letters);
  const steps = p.route.steps.map((s): RouteStep => (s.id === sid('b') || s.id === sid('c') ? { ...s, groupId: GROUP.id } : s));
  return { ...p, route: { ...p.route, steps, groups: { [GROUP.id]: GROUP } } };
}

function frozenProject(p: ProjectV1): ProjectV1 {
  for (const s of p.route.steps) Object.freeze(s);
  Object.freeze(p.route.steps);
  Object.freeze(p.route.groups);
  Object.freeze(p.route);
  return Object.freeze(p);
}

describe('insertionIndex', () => {
  const steps = notesProject('abcd').route.steps;
  it('goes after the last selected step, else after the focus, else at the end', () => {
    expect(insertionIndex(steps, { stepIds: idSet('a', 'c'), anchor: null, focus: null })).toBe(3);
    expect(insertionIndex(steps, { stepIds: new Set(), anchor: null, focus: sid('b') })).toBe(2);
    expect(insertionIndex(steps, EMPTY_SELECTION)).toBe(4);
    expect(insertionIndex(steps, { stepIds: idSet('zz'), anchor: null, focus: sid('zz') })).toBe(4);
  });
});

describe('insert commands', () => {
  it('insertNote inserts after the selection with an id from the context', () => {
    const p = frozenProject(notesProject('abc'));
    const out = insertNote({ text: 'Placeholder x' }).apply(p, ctx({ selected: 'a' }));
    expect(order(out)).toBe('axbc');
    expect(out.route.steps[1]?.id).toBe(stepId('step-1'));
    expect(out.route.steps[1]?.origin).toEqual({ source: 'manual', ref: null });
    expect(order(p)).toBe('abc');
  });

  it('honours an explicit index and appends without a selection', () => {
    const p = notesProject('abc');
    expect(order(insertNote({ text: 'Placeholder x' }, 0).apply(p, ctx({ selected: 'b' })))).toBe('xabc');
    expect(order(insertNote({ text: 'Placeholder x' }).apply(p, ctx()))).toBe('abcx');
  });

  it('insertTravel and insertGrind build their kinds with unknowns as null', () => {
    const p = notesProject('ab');
    const travel = insertTravel().apply(p, ctx({ selected: 'a' }));
    expect(order(travel)).toBe('aTb');
    expect(travel.route.steps[1]).toMatchObject({ kind: 'travel', mode: 'auto', location: null, transport: null });
    const grind = insertGrind({ until: { kind: 'duration', seconds: 600 } }).apply(p, ctx());
    expect(grind.route.steps[2]).toMatchObject({ kind: 'grind', mobLevel: null, xpPerHour: null });
  });

  it('insertStep takes any factory and label', () => {
    const cmd = insertStep((ids) => ({ ...notesProject('q').route.steps[0], id: stepId(ids.next('step')) }) as RouteStep, 1, 'Add');
    expect(cmd.label).toBe('Add');
    expect(order(cmd.apply(notesProject('ab'), ctx()))).toBe('aqb');
  });
});

describe('deleteSelected', () => {
  it('removes the selection, or explicit ids, and prunes groups left empty', () => {
    const p = frozenProject(grouped());
    const one = deleteSelected().apply(p, ctx({ selected: 'b' }));
    expect(order(one)).toBe('acd');
    expect(one.route.groups).toBe(p.route.groups);
    const both = deleteSelected(idSet('b', 'c')).apply(p, ctx({ selected: 'a' }));
    expect(order(both)).toBe('ad');
    expect(both.route.groups).toEqual({});
  });

  it('is a no-op (same object) when nothing is selected or the ids are unknown', () => {
    const p = notesProject('ab');
    expect(deleteSelected().apply(p, ctx())).toBe(p);
    expect(deleteSelected(idSet('zz')).apply(p, ctx())).toBe(p);
  });
});

describe('moveSelected', () => {
  it('moves by a delta and to an index', () => {
    const p = frozenProject(notesProject('abcde'));
    expect(order(moveSelected({ by: 1 }).apply(p, ctx({ selected: 'b' })))).toBe('acbde');
    expect(order(moveSelected({ by: -1 }).apply(p, ctx({ selected: 'cd' })))).toBe('acdbe');
    expect(order(moveSelected({ toIndex: 0 }).apply(p, ctx({ selected: 'de' })))).toBe('deabc');
    expect(order(moveSelected({ toIndex: 1 }, idSet('a', 'e')).apply(p, ctx()))).toBe('baecd');
  });

  it('coalesces delta moves only', () => {
    expect(moveSelected({ by: 1 }).coalesceKey).toBe('move-steps');
    expect(moveSelected({ toIndex: 1 }).coalesceKey).toBeUndefined();
  });

  it('is a no-op at the edge or without a selection', () => {
    const p = notesProject('abc');
    expect(moveSelected({ by: -1 }).apply(p, ctx({ selected: 'a' }))).toBe(p);
    expect(moveSelected({ by: 1 }).apply(p, ctx({ selected: 'c' }))).toBe(p);
    expect(moveSelected({ by: 1 }).apply(p, ctx())).toBe(p);
    expect(moveSelected({ toIndex: 1 }).apply(p, ctx({ selected: 'b' }))).toBe(p);
  });
});

describe('duplicateSelected', () => {
  it('places copies after the last selected step with new ids and origin duplicate', () => {
    const p = frozenProject(notesProject('abcd'));
    const out = duplicateSelected().apply(p, ctx({ selected: 'ac' }));
    expect(order(out)).toBe('abcacd');
    expect(out.route.steps.map((s) => s.id).slice(3, 5)).toEqual([stepId('step-1'), stepId('step-2')]);
    expect(out.route.steps[3]?.origin).toEqual({ source: 'duplicate', ref: 's-a' });
  });

  it('is a no-op without a selection', () => {
    const p = notesProject('ab');
    expect(duplicateSelected().apply(p, ctx())).toBe(p);
  });
});

describe('lock commands', () => {
  it('setLockedSelected locks and unlocks; unchanged steps are a no-op', () => {
    const p = frozenProject(notesProject('abc'));
    const locked = setLockedSelected(true).apply(p, ctx({ selected: 'ab' }));
    expect(locked.route.steps.map((s) => s.locked)).toEqual([true, true, false]);
    expect(locked.route.steps[2]).toBe(p.route.steps[2]);
    expect(setLockedSelected(true).apply(locked, ctx({ selected: 'ab' }))).toBe(locked);
    expect(setLockedSelected(false).apply(p, ctx({ selected: 'ab' }))).toBe(p);
  });

  it('toggleLockSelected unlocks only when every selected step is locked', () => {
    const p = notesProject('abc');
    const a = toggleLockSelected().apply(p, ctx({ selected: 'a' }));
    const ab = toggleLockSelected().apply(a, ctx({ selected: 'ab' }));
    expect(ab.route.steps.map((s) => s.locked)).toEqual([true, true, false]);
    const none = toggleLockSelected().apply(ab, ctx({ selected: 'ab' }));
    expect(none.route.steps.map((s) => s.locked)).toEqual([false, false, false]);
    expect(toggleLockSelected().apply(p, ctx())).toBe(p);
  });
});

describe('cut, copy and paste', () => {
  it('cutSelected removes the steps and hands them, with their groups, to the clipboard', () => {
    const p = frozenProject(grouped());
    const cmd = cutSelected();
    const c = ctx({ selected: 'bc' });
    expect(cmd.copy?.(p, c)).toEqual({ steps: [p.route.steps[1], p.route.steps[2]], groups: { [GROUP.id]: GROUP } });
    const out = cmd.apply(p, c);
    expect(order(out)).toBe('ad');
    expect(out.route.groups).toEqual({});
  });

  it('cut and copy with nothing selected leave the clipboard and project alone', () => {
    const p = notesProject('ab');
    expect(cutSelected().copy?.(p, ctx())).toBeNull();
    expect(cutSelected().apply(p, ctx())).toBe(p);
    expect(copySelected().copy?.(p, ctx())).toBeNull();
  });

  it('copySelected fills the clipboard without changing the project', () => {
    const p = notesProject('abc');
    const c = ctx({ selected: 'ca' });
    expect(copySelected().copy?.(p, c)?.steps.map((s) => s.id)).toEqual([sid('a'), sid('c')]);
    expect(copySelected().apply(p, c)).toBe(p);
  });

  it('paste inserts fresh copies after the selection and restores pruned groups', () => {
    const p = grouped();
    const clipboard = cutSelected().copy?.(p, ctx({ selected: 'bc' })) ?? EMPTY_CLIPBOARD;
    const cut = cutSelected().apply(p, ctx({ selected: 'bc' }));
    const out = paste().apply(cut, ctx({ selected: 'd', clipboard }));
    expect(order(out)).toBe('adbc');
    expect(out.route.steps.slice(2).map((s) => [s.id, s.origin.source, s.groupId])).toEqual([
      [stepId('step-1'), 'paste', GROUP.id],
      [stepId('step-2'), 'paste', GROUP.id],
    ]);
    expect(out.route.groups).toEqual({ [GROUP.id]: GROUP });
  });

  it('paste keeps an existing group and honours an explicit index', () => {
    const p = grouped();
    const other: RouteGroup = { id: GROUP.id, rxp: null };
    const withOther: ProjectV1 = { ...p, route: { ...p.route, groups: { [GROUP.id]: other } } };
    const clipboard = copySelected().copy?.(p, ctx({ selected: 'b' })) ?? EMPTY_CLIPBOARD;
    const out = paste(0).apply(withOther, ctx({ clipboard }));
    expect(order(out)).toBe('babcd');
    expect(out.route.groups[GROUP.id]).toBe(other);
  });

  it('paste with an empty clipboard is a no-op', () => {
    const p = notesProject('ab');
    expect(paste().apply(p, ctx({ selected: 'a' }))).toBe(p);
    expect(paste().apply(p, { ids: sequentialIdSource(), nowIso: T0 })).toBe(p);
  });

  it('only copy is clipboard-only', () => {
    expect(copySelected().clipboardOnly).toBe(true);
    expect(cutSelected().clipboardOnly).toBeUndefined();
    expect(paste().clipboardOnly).toBeUndefined();
  });

  it('never copies or pastes an Object.prototype member as a group (M1 review F4)', () => {
    // A step whose groupId names an Object.prototype member and no such group: projectSchema now
    // rejects the id at import, but a project built in code can still hold it.
    const p = notesProject('ab');
    const odd = groupId('toString');
    const steps = p.route.steps.map((s): RouteStep => (s.id === sid('a') ? { ...s, groupId: odd } : s));
    const project: ProjectV1 = { ...p, route: { ...p.route, steps } };
    const clipboard = copySelected().copy?.(project, ctx({ selected: 'a' })) ?? EMPTY_CLIPBOARD;
    expect(clipboard.steps).toHaveLength(1);
    expect(Object.keys(clipboard.groups)).toEqual([]);
    const out = paste().apply(project, ctx({ selected: 'b', clipboard }));
    expect(order(out)).toBe('aba');
    expect(Object.hasOwn(out.route.groups, 'toString')).toBe(false);
    expect(() => serializeProject(out)).not.toThrow();
  });

  it('restores a group stored under a prototype member name as an own key', () => {
    const p = notesProject('ab');
    const odd = groupId('constructor');
    const group: RouteGroup = { id: odd, rxp: null };
    const steps = p.route.steps.map((s): RouteStep => (s.id === sid('a') ? { ...s, groupId: odd } : s));
    const project: ProjectV1 = { ...p, route: { ...p.route, steps, groups: { [odd]: group } } };
    const clipboard = cutSelected().copy?.(project, ctx({ selected: 'a' })) ?? EMPTY_CLIPBOARD;
    expect(clipboard.groups).toEqual({ [odd]: group });
    const cut = cutSelected().apply(project, ctx({ selected: 'a' }));
    expect(Object.hasOwn(cut.route.groups, odd)).toBe(false);
    const out = paste().apply(cut, ctx({ selected: 'b', clipboard }));
    expect(Object.hasOwn(out.route.groups, odd)).toBe(true);
    expect(out.route.groups[odd]).toBe(group);
    expect(Object.getPrototypeOf(out.route.groups)).toBe(Object.prototype);
  });
});

describe('joinSections', () => {
  it('moves the second section to follow the first', () => {
    const p = notesProject('abcdef');
    expect(order(joinSections(idSet('a', 'b'), idSet('e', 'f')).apply(p, ctx()))).toBe('abefcd');
  });

  it('is a no-op when already joined or when a section is empty', () => {
    const p = notesProject('abcd');
    expect(joinSections(idSet('a', 'b'), idSet('c')).apply(p, ctx())).toBe(p);
    expect(joinSections(idSet(), idSet('c')).apply(p, ctx())).toBe(p);
  });
});

describe('field edits', () => {
  it('renameRoute renames and coalesces; the same name is a no-op', () => {
    const p = frozenProject(notesProject('a'));
    const out = renameRoute('Placeholder renamed').apply(p, ctx());
    expect(out.route.name).toBe('Placeholder renamed');
    expect(out.route.steps).toBe(p.route.steps);
    expect(renameRoute(p.route.name).apply(p, ctx())).toBe(p);
    expect(renameRoute('x').coalesceKey).toBe(renameRoute('y').coalesceKey);
  });

  it('updateStepNote sets and clears a note, coalescing per step', () => {
    const p = frozenProject(notesProject('ab'));
    const out = updateStepNote(sid('a'), 'Placeholder note').apply(p, ctx());
    expect(out.route.steps[0]?.note).toBe('Placeholder note');
    expect(out.route.steps[1]).toBe(p.route.steps[1]);
    expect(updateStepNote(sid('a'), '').apply(out, ctx()).route.steps[0]?.note).toBeNull();
    expect(updateStepNote(sid('a'), 'Placeholder note').apply(out, ctx())).toBe(out);
    expect(updateStepNote(sid('a'), null).apply(p, ctx())).toBe(p);
    expect(updateStepNote(sid('zz'), 'x').apply(p, ctx())).toBe(p);
    expect(updateStepNote(sid('a'), 'x').coalesceKey).not.toBe(updateStepNote(sid('b'), 'x').coalesceKey);
  });

  it('patchStep edits common fields and never the kind', () => {
    const p = notesProject('ab');
    const location = { source: zoneSourcedPoint(uiMapId(1411), 50, 50), label: null, radius: null };
    const out = patchStep(sid('b'), { location, durationOverride: 30, locked: true }).apply(p, ctx());
    expect(out.route.steps[1]).toMatchObject({ kind: 'note', location, durationOverride: 30, locked: true });
    expect(patchStep(sid('b'), { location, durationOverride: 30 }).apply(out, ctx())).toBe(out);
    expect(patchStep(sid('b'), {}).apply(p, ctx())).toBe(p);
    const custom = patchStep(sid('a'), { note: 'n' }, { label: 'Custom', coalesceKey: 'k' });
    expect([custom.label, custom.coalesceKey]).toEqual(['Custom', 'k']);
  });
});
