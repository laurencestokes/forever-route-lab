import { describe, expect, it } from 'vitest';
import { type StepId, groupId, questId, routeId, sequentialIdSource, stepId, uiMapId } from './ids';
import { zoneSourcedPoint } from './points';
import type { Route, RouteStep } from './route';
import {
  cutSection,
  duplicateSteps,
  insertSteps,
  joinSections,
  moveSteps,
  moveStepsBy,
  pasteSection,
  pruneGroups,
  removeSteps,
  routeGroup,
  selectionIndices,
  setLocked,
  updateStep,
} from './route-ops';
import { makeAcceptStep, makeNoteStep } from './step-factory';

/** Notes a..n with ids s-a, s-b, ...: ids and texts make orders easy to read. */
function notes(letters: string): RouteStep[] {
  return [...letters].map((letter) => makeNoteStep({ next: () => `s-${letter}` }, { text: `Placeholder ${letter}` }));
}

const order = (steps: readonly RouteStep[]): string =>
  steps.map((s) => (s.kind === 'note' ? s.text.slice(-1) : '?')).join('');

const ids = (...letters: string[]): ReadonlySet<StepId> => new Set(letters.map((l) => stepId(`s-${l}`)));

const NONE: ReadonlySet<StepId> = new Set();

function frozen(steps: RouteStep[]): readonly RouteStep[] {
  for (const s of steps) Object.freeze(s);
  return Object.freeze(steps);
}

describe('insertSteps', () => {
  it('inserts before an index, at the start and at the end', () => {
    const base = frozen(notes('abc'));
    expect(order(insertSteps(base, 1, notes('x')))).toBe('axbc');
    expect(order(insertSteps(base, 0, notes('xy')))).toBe('xyabc');
    expect(order(insertSteps(base, 3, notes('x')))).toBe('abcx');
    expect(order(insertSteps([], 0, notes('x')))).toBe('x');
  });

  it('clamps out-of-range indices', () => {
    const base = notes('abc');
    expect(order(insertSteps(base, -5, notes('x')))).toBe('xabc');
    expect(order(insertSteps(base, 99, notes('x')))).toBe('abcx');
    expect(order(insertSteps(base, Number.NaN, notes('x')))).toBe('abcx');
    expect(order(insertSteps(base, 1.7, notes('x')))).toBe('axbc');
  });

  it('returns a new array and keeps step identity', () => {
    const base = frozen(notes('ab'));
    const out = insertSteps(base, 1, []);
    expect(out).not.toBe(base);
    expect(out[0]).toBe(base[0]);
  });

  it('refuses duplicate ids', () => {
    expect(() => insertSteps(notes('ab'), 0, notes('a'))).toThrow(/Duplicate step id s-a/);
    expect(() => insertSteps(notes('ab'), 0, notes('xx'))).toThrow(/Duplicate step id s-x/);
  });
});

describe('removeSteps', () => {
  it('removes selected steps and ignores unknown ids', () => {
    const base = frozen(notes('abcd'));
    expect(order(removeSteps(base, ids('b', 'd', 'z')))).toBe('ac');
    expect(order(removeSteps(base, NONE))).toBe('abcd');
    expect(removeSteps(base, NONE)).not.toBe(base);
    expect(removeSteps(base, ids('a', 'b', 'c', 'd'))).toEqual([]);
  });
});

describe('selectionIndices', () => {
  it('gives sorted indices in route order, whatever the set order', () => {
    const base = notes('abcde');
    expect(selectionIndices(base, new Set([stepId('s-d'), stepId('s-a'), stepId('s-c')]))).toEqual([0, 2, 3]);
    expect(selectionIndices(base, NONE)).toEqual([]);
    expect(selectionIndices(base, ids('z'))).toEqual([]);
  });
});

describe('moveSteps', () => {
  const base = frozen(notes('abcdef'));

  it('moves a contiguous block, toIndex counted without the moved steps', () => {
    expect(order(moveSteps(base, ids('b', 'c'), 0))).toBe('bcadef');
    expect(order(moveSteps(base, ids('b', 'c'), 1))).toBe('abcdef');
    expect(order(moveSteps(base, ids('b', 'c'), 2))).toBe('adbcef');
    expect(order(moveSteps(base, ids('b', 'c'), 4))).toBe('adefbc');
  });

  it('moves to both ends, clamping beyond them', () => {
    expect(order(moveSteps(base, ids('d'), 0))).toBe('dabcef');
    expect(order(moveSteps(base, ids('b'), 5))).toBe('acdefb');
    expect(order(moveSteps(base, ids('b'), 99))).toBe('acdefb');
    expect(order(moveSteps(base, ids('e'), -3))).toBe('eabcdf');
  });

  it('gathers a non-contiguous selection, keeping its relative order', () => {
    expect(order(moveSteps(base, new Set([stepId('s-e'), stepId('s-a'), stepId('s-c')]), 1))).toBe('bacedf');
    expect(order(moveSteps(base, ids('f', 'a'), 2))).toBe('bcafde');
  });

  it('leaves the route unchanged for an empty or unknown selection', () => {
    expect(order(moveSteps(base, NONE, 3))).toBe('abcdef');
    expect(order(moveSteps(base, ids('z'), 0))).toBe('abcdef');
    expect(moveSteps(base, NONE, 3)).not.toBe(base);
  });

  it('keeps the moved step objects', () => {
    const out = moveSteps(base, ids('c'), 0);
    expect(out[0]).toBe(base[2]);
  });
});

describe('moveStepsBy', () => {
  const base = frozen(notes('abcdef'));

  it('moves a block up and down by one', () => {
    expect(order(moveStepsBy(base, ids('c', 'd'), -1))).toBe('acdbef');
    expect(order(moveStepsBy(base, ids('c', 'd'), 1))).toBe('abecdf');
  });

  it('stops at the ends', () => {
    expect(order(moveStepsBy(base, ids('a'), -1))).toBe('abcdef');
    expect(order(moveStepsBy(base, ids('f'), 1))).toBe('abcdef');
    expect(order(moveStepsBy(base, ids('e', 'f'), 3))).toBe('abcdef');
  });

  it('gathers a non-contiguous selection at the first selected position plus delta', () => {
    expect(order(moveStepsBy(base, ids('b', 'e'), 0))).toBe('abecdf');
    expect(order(moveStepsBy(base, NONE, 1))).toBe('abcdef');
  });
});

describe('duplicateSteps', () => {
  it('places copies after the last selected step, in route order', () => {
    const base = frozen(notes('abcde'));
    const source = sequentialIdSource(1);
    const { steps, created } = duplicateSteps(base, new Set([stepId('s-d'), stepId('s-b')]), source);
    expect(order(steps)).toBe('abcdbde');
    expect(created).toEqual(['step-1', 'step-2']);
    expect(steps.map((s) => s.id)).toEqual(['s-a', 's-b', 's-c', 's-d', 'step-1', 'step-2', 's-e']);
  });

  it('marks copies as duplicates of their originals and keeps their content', () => {
    const base = frozen(notes('ab'));
    const { steps } = duplicateSteps(base, ids('a'), sequentialIdSource(7));
    const copy = steps[1];
    expect(copy).toEqual({ ...base[0], id: 'step-7', origin: { source: 'duplicate', ref: 's-a' } });
  });

  it('drops the RXP source line from copies but keeps the >> text and group', () => {
    const original = makeAcceptStep(
      { next: () => 's-q' },
      {
        questId: questId(-1),
        groupId: groupId('group-1'),
        origin: { source: 'rxp', ref: 'import-1' },
        rxp: { text: 'Placeholder text', line: { importId: 'import-1', firstLine: 3, lastLine: 3 } },
      },
    );
    const bare = makeNoteStep({ next: () => 's-n' }, { text: 'Placeholder', rxp: { text: null, line: null } });
    const { steps } = duplicateSteps([original, bare], new Set([original.id, bare.id]), sequentialIdSource());
    const [, , copyA, copyN] = steps;
    expect(copyA?.rxp).toEqual({ text: 'Placeholder text', line: null });
    expect(copyA?.groupId).toBe('group-1');
    expect(copyA?.origin).toEqual({ source: 'duplicate', ref: 's-q' });
    expect(copyN?.rxp).toBeNull();
    expect(original.rxp?.line).not.toBeNull();
  });

  it('does nothing for an empty selection', () => {
    const base = notes('ab');
    const source = sequentialIdSource();
    const out = duplicateSteps(base, NONE, source);
    expect(order(out.steps)).toBe('ab');
    expect(out.created).toEqual([]);
    expect(source.next('step')).toBe('step-1');
  });
});

describe('setLocked', () => {
  it('locks and unlocks selected steps only', () => {
    const base = frozen(notes('abc'));
    const locked = setLocked(base, ids('a', 'c'), true);
    expect(locked.map((s) => s.locked)).toEqual([true, false, true]);
    expect(locked[1]).toBe(base[1]);
    const unlocked = setLocked(locked, ids('a'), false);
    expect(unlocked.map((s) => s.locked)).toEqual([false, false, true]);
    expect(unlocked[2]).toBe(locked[2]);
  });

  it('keeps identity for steps already in the requested state', () => {
    const base = frozen(notes('ab'));
    const out = setLocked(base, ids('a'), false);
    expect(out[0]).toBe(base[0]);
    expect(out).not.toBe(base);
  });
});

describe('updateStep', () => {
  const base = frozen(notes('abc'));

  it('patches the editable common fields', () => {
    const location = { source: zoneSourcedPoint(uiMapId(1411), 50, 50), label: 'Placeholder location', radius: null };
    const out = updateStep(base, stepId('s-b'), { note: 'Placeholder note', location, durationOverride: 30, locked: true });
    expect(out[1]).toMatchObject({ id: 's-b', kind: 'note', note: 'Placeholder note', location, durationOverride: 30, locked: true });
    expect(out[0]).toBe(base[0]);
    expect(out[2]).toBe(base[2]);
    expect(base[1]?.note).toBeNull();
  });

  it('sets fields back to null and leaves absent keys alone', () => {
    const withNote = updateStep(base, stepId('s-a'), { note: 'Placeholder', durationOverride: 10 });
    const cleared = updateStep(withNote, stepId('s-a'), { note: null });
    expect(cleared[0]?.note).toBeNull();
    expect(cleared[0]?.durationOverride).toBe(10);
  });

  it('sets and clears a condition', () => {
    const condition = { filter: { kind: 'word', word: 'Placeholder' } as const, variant: null, skipIf: [] };
    const out = updateStep(base, stepId('s-a'), { condition });
    expect(out[0]?.condition).toEqual(condition);
    expect(updateStep(out, stepId('s-a'), { condition: null })[0]?.condition).toBeNull();
  });

  it('never changes kind or id, even from an untyped caller', () => {
    const sneaky = { note: 'x', kind: 'grind', id: 'other' } as unknown as Parameters<typeof updateStep>[2];
    const out = updateStep(base, stepId('s-a'), sneaky);
    expect(out[0]?.kind).toBe('note');
    expect(out[0]?.id).toBe('s-a');
    expect(out[0]?.note).toBe('x');
  });

  it('leaves the route unchanged for an unknown id', () => {
    const out = updateStep(base, stepId('s-z'), { note: 'x' });
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
  });
});

describe('cutSection and pasteSection', () => {
  it('cuts selected steps into a clipboard in route order', () => {
    const base = frozen(notes('abcde'));
    const { steps, clipboard } = cutSection(base, new Set([stepId('s-d'), stepId('s-b')]));
    expect(order(steps)).toBe('ace');
    expect(order(clipboard)).toBe('bd');
    expect(clipboard[0]).toBe(base[1]);
  });

  it('round-trips a cut back to its place with fresh ids and the same order', () => {
    const base = frozen(notes('abcdef'));
    const { steps, clipboard } = cutSection(base, ids('c', 'd'));
    const pasted = pasteSection(steps, 2, clipboard, sequentialIdSource(1));
    expect(order(pasted.steps)).toBe('abcdef');
    expect(pasted.created).toEqual(['step-1', 'step-2']);
    expect(pasted.steps.map((s) => s.id)).toEqual(['s-a', 's-b', 'step-1', 'step-2', 's-e', 's-f']);
    expect(pasted.steps[2]?.origin).toEqual({ source: 'paste', ref: 's-c' });
    const { id: _a, origin: _b, ...pastedRest } = pasted.steps[2] as RouteStep;
    const { id: _c, origin: _d, ...originalRest } = base[2] as RouteStep;
    expect(pastedRest).toEqual(originalRest);
  });

  it('pastes a non-contiguous cut as one block, at the ends too', () => {
    const { steps, clipboard } = cutSection(notes('abcdef'), ids('a', 'c', 'f'));
    expect(order(steps)).toBe('bde');
    expect(order(pasteSection(steps, 0, clipboard, sequentialIdSource()).steps)).toBe('acfbde');
    expect(order(pasteSection(steps, 3, clipboard, sequentialIdSource()).steps)).toBe('bdeacf');
    expect(order(pasteSection(steps, 99, clipboard, sequentialIdSource()).steps)).toBe('bdeacf');
  });

  it('pastes the same clipboard twice with distinct ids', () => {
    const { steps, clipboard } = cutSection(notes('abc'), ids('b'));
    const source = sequentialIdSource();
    const once = pasteSection(steps, 0, clipboard, source);
    const twice = pasteSection(once.steps, 3, clipboard, source);
    expect(order(twice.steps)).toBe('bacb');
    expect(new Set(twice.steps.map((s) => s.id)).size).toBe(4);
  });

  it('handles an empty selection and an empty clipboard', () => {
    const base = notes('ab');
    const cut = cutSection(base, NONE);
    expect(order(cut.steps)).toBe('ab');
    expect(cut.clipboard).toEqual([]);
    const pasted = pasteSection(base, 1, [], sequentialIdSource());
    expect(order(pasted.steps)).toBe('ab');
    expect(pasted.created).toEqual([]);
  });
});

describe('joinSections', () => {
  const base = frozen(notes('abcdefg'));

  it('moves a later section to follow an earlier one', () => {
    expect(order(joinSections(base, ids('a', 'b'), ids('e', 'f')))).toBe('abefcdg');
  });

  it('moves an earlier section to follow a later one', () => {
    expect(order(joinSections(base, ids('e', 'f'), ids('a', 'b')))).toBe('cdefabg');
  });

  it('gathers non-contiguous sections after the last step of the first', () => {
    expect(order(joinSections(base, ids('a', 'c'), ids('g', 'e')))).toBe('abcegdf');
  });

  it('leaves steps that are in both sections where they are', () => {
    expect(order(joinSections(base, ids('a', 'b'), ids('b', 'f')))).toBe('abfcdeg');
  });

  it('is unchanged when either section is empty or already joined', () => {
    expect(order(joinSections(base, NONE, ids('c')))).toBe('abcdefg');
    expect(order(joinSections(base, ids('c'), NONE))).toBe('abcdefg');
    expect(order(joinSections(base, ids('b'), ids('c', 'd')))).toBe('abcdefg');
    expect(order(joinSections(base, ids('z'), ids('c')))).toBe('abcdefg');
  });
});

describe('pruneGroups', () => {
  it('drops unreferenced groups and keeps the rest', () => {
    const g1 = groupId('group-1');
    const g2 = groupId('group-2');
    const step = makeNoteStep({ next: () => 's-a' }, { text: 'Placeholder', groupId: g1 });
    const route: Route = Object.freeze({
      id: routeId('route-1'),
      name: 'Placeholder route',
      description: '',
      steps: [step],
      groups: Object.freeze({ [g1]: { id: g1, rxp: null }, [g2]: { id: g2, rxp: null } }),
    });
    const pruned = pruneGroups(route);
    expect(Object.keys(pruned.groups)).toEqual(['group-1']);
    expect(pruned.groups[g1]).toBe(route.groups[g1]);
    expect(pruned.steps).toBe(route.steps);
    expect(Object.keys(route.groups)).toEqual(['group-1', 'group-2']);
    expect(Object.keys(pruneGroups({ ...route, steps: [] }).groups)).toEqual([]);
  });
});

describe('routeGroup', () => {
  const g1 = groupId('group-1');
  const group = { id: g1, rxp: null };
  const groups = Object.freeze({ [g1]: group });

  it('returns the group an id names, or null for null and unknown ids', () => {
    expect(routeGroup({ groups }, g1)).toBe(group);
    expect(routeGroup({ groups }, null)).toBeNull();
    expect(routeGroup({ groups }, groupId('group-2'))).toBeNull();
  });

  it('never returns an Object.prototype member', () => {
    for (const name of ['toString', 'constructor', 'hasOwnProperty', 'valueOf', '__proto__']) {
      expect(routeGroup({ groups }, groupId(name)), name).toBeNull();
    }
  });

  it('finds a group stored under a prototype member name as an own key', () => {
    const odd = groupId('toString');
    const own = { id: odd, rxp: null };
    expect(routeGroup({ groups: { [odd]: own } }, odd)).toBe(own);
  });
});

describe('pruneGroups with awkward keys', () => {
  it('keeps an own __proto__ key as data and never touches the prototype', () => {
    const proto = groupId('__proto__');
    const group = { id: proto, rxp: null };
    const groups: Record<string, { id: typeof proto; rxp: null }> = {};
    Object.defineProperty(groups, '__proto__', { value: group, enumerable: true, configurable: true, writable: true });
    const step = makeNoteStep({ next: () => 's-a' }, { text: 'Placeholder', groupId: proto });
    const route: Route = { id: routeId('route-1'), name: 'Placeholder route', description: '', steps: [step], groups };
    const pruned = pruneGroups(route);
    expect(Object.getPrototypeOf(pruned.groups)).toBe(Object.prototype);
    expect(Object.hasOwn(pruned.groups, '__proto__')).toBe(true);
    expect(routeGroup(pruned, proto)).toBe(group);
  });
});
