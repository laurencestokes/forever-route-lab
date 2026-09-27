import { describe, expect, it } from 'vitest';
import { questId, stepId } from '../domain/ids';
import type { RouteStep } from '../domain/route';
import { applyChangeSets } from './apply';
import { diffRoutes } from './diff';
import { semanticStepKey } from './steps';
import { accept, complete, editSteps, note, place, seeded, shuffled, syntheticRoute, travel, turnIn } from './test-helpers';
import type { DiffOp, RouteDiff } from './types';

const ids = (steps: readonly RouteStep[]): string[] => steps.map((s) => s.id);
const all = (diff: RouteDiff): Set<string> => new Set(diff.changeSets.map((set) => set.id));
const kinds = (diff: RouteDiff): string[] => diff.ops.map((op) => op.kind);
const moved = (diff: RouteDiff): string[] => diff.ops.flatMap((op) => (op.kind === 'move' ? [op.stepId] : []));

describe('diffRoutes: identity', () => {
  it('finds nothing between a route and itself, or a structurally equal copy', () => {
    const { steps } = syntheticRoute(500);
    expect(diffRoutes(steps, steps)).toEqual({ ops: [], changeSets: [] });
    const copy = JSON.parse(JSON.stringify(steps)) as RouteStep[];
    expect(diffRoutes(steps, copy)).toEqual({ ops: [], changeSets: [] });
    expect(diffRoutes([], [])).toEqual({ ops: [], changeSets: [] });
  });

  it('treats a key set to undefined as absent, and -0 as different from 0', () => {
    const a = note('n1');
    expect(diffRoutes([a], [{ ...a, ext: undefined } as unknown as RouteStep]).ops).toEqual([
      expect.objectContaining({ kind: 'modify' }),
    ]);
    const withExt = { ...a, ext: { x: 1, y: undefined } };
    expect(diffRoutes([withExt], [{ ...a, ext: { x: 1 } }]).ops).toEqual([]);
    expect(diffRoutes([{ ...a, durationOverride: 0 }], [{ ...a, durationOverride: -0 }]).ops).toHaveLength(1);
  });

  it('refuses duplicate ids', () => {
    const a = note('n1');
    expect(() => diffRoutes([a, a], [a])).toThrow(/Duplicate step id "n1" in before/);
    expect(() => diffRoutes([a], [a, a])).toThrow(/Duplicate step id "n1" in after/);
    // Found in the match pass: a repeated id that `before` lacks, with or without semantic keys.
    const b = accept('b', 2);
    expect(() => diffRoutes([a], [b, a, b])).toThrow(/Duplicate step id "b" in after/);
    expect(() => diffRoutes([accept('c', 2)], [b, b], { semanticKey: semanticStepKey })).toThrow(/Duplicate step id "b" in after/);
    expect(() => diffRoutes([a, a], [b, b])).toThrow(/Duplicate step id "n1" in before/);
  });
});

describe('diffRoutes: moves, inserts, removes and modifies', () => {
  const a = accept('a', 1);
  const b = accept('b', 2);
  const c = accept('c', 3);
  const d = accept('d', 4);

  it('reports a remove and an insert with their anchors', () => {
    const x = note('x');
    const diff = diffRoutes([a, b, c], [a, x, c]);
    expect(diff.ops).toEqual<DiffOp[]>([
      { kind: 'remove', stepId: stepId('b'), beforeIndex: 1 },
      { kind: 'insert', step: x, after: stepId('a'), afterIndex: 1 },
    ]);
    // The note binds to the next quest step (c), so the insert joins quest 3's set.
    expect(diff.changeSets).toEqual([
      { id: 'q:2', questIds: [2], ops: [0], requires: [] },
      { id: 'q:3', questIds: [3], ops: [1], requires: [] },
    ]);
  });

  it('reports the fewest moves: one step moved to the end', () => {
    const diff = diffRoutes([a, b, c, d], [b, c, d, a]);
    expect(diff.ops).toEqual<DiffOp[]>([{ kind: 'move', stepId: stepId('a'), after: stepId('d'), beforeIndex: 0, afterIndex: 3 }]);
    expect(diffRoutes([a, b, c, d], [d, a, b, c]).ops).toEqual<DiffOp[]>([
      { kind: 'move', stepId: stepId('d'), after: null, beforeIndex: 3, afterIndex: 0 },
    ]);
  });

  it('breaks ties by the smaller before-index: a swap moves the earlier step', () => {
    // After-order before-indices [1, 0]: both single elements weigh 1; the end with the smaller value (a) is kept.
    expect(moved(diffRoutes([a, b], [b, a]))).toEqual(['b']);
  });

  it('reports a modify for a changed step, beside its move', () => {
    const edited = { ...c, note: 'edited' };
    const diff = diffRoutes([a, b, c], [edited, a, b]);
    expect(kinds(diff)).toEqual(['move', 'modify']);
    expect(diff.ops[1]).toEqual({ kind: 'modify', stepId: stepId('c'), before: c, after: edited, beforeIndex: 2, afterIndex: 0 });
    expect(diff.changeSets).toEqual([{ id: 'q:3', questIds: [3], ops: [0, 1], requires: [] }]);
  });

  it('orders ops: removes (before order), inserts and moves (after order), modifies', () => {
    const x = note('x');
    const y = note('y');
    const diff = diffRoutes([a, b, c, d], [x, { ...d, note: 'n' }, c, y, a]);
    // After-order before-indices [3, 2, 0]: a (0) is kept, d and c move.
    expect(kinds(diff)).toEqual(['remove', 'insert', 'move', 'move', 'insert', 'modify']);
    expect(diff.ops.map((op) => ('afterIndex' in op ? op.afterIndex : op.kind === 'remove' ? op.beforeIndex : -1))).toEqual([1, 0, 1, 2, 3, 1]);
  });

  it('keeps locked steps in place: fixture 7e reports only A and B as moved', () => {
    // docs/research/optimizer-m7.md §13 fixture 7e: original A, L1, C3, B, L2; proposal L1, C3, L2, B, A.
    const aAccept = accept('A-accept', 741, { location: place(200, 100) });
    const aTurnIn = turnIn('A-turnin', 741, { location: place(200, 100) });
    const l1 = note('L1', { location: place(300, -200), locked: true });
    const c3 = note('C3', { location: place(0, -100) });
    const bAccept = accept('B-accept', 742, { location: place(-200, 100) });
    const bTurnIn = turnIn('B-turnin', 742, { location: place(-200, 100) });
    const l2 = note('L2', { location: place(-300, -200), locked: true });
    const before = [aAccept, aTurnIn, l1, c3, bAccept, bTurnIn, l2];
    const after = [l1, c3, l2, bAccept, bTurnIn, aAccept, aTurnIn];
    const diff = diffRoutes(before, after);
    expect(moved(diff)).toEqual(['B-accept', 'B-turnin', 'A-accept', 'A-turnin']);
    expect(diff.changeSets.map((set) => set.id)).toEqual(['q:742', 'q:741']);
    // Unweighted, the plain longest subsequence (L1, C3, B, B) would report the locked L2 as moved.
    expect(moved(diffRoutes(before, after, { fixed: () => false }))).toContain('L2');
    // The optimiser passes its implicit anchors too (C3 has a skipIf); the result is the same.
    const anchors = new Set(['L1', 'C3', 'L2']);
    expect(moved(diffRoutes(before, after, { fixed: (s) => anchors.has(s.id) }))).toEqual(['B-accept', 'B-turnin', 'A-accept', 'A-turnin']);
    expect(applyChangeSets(before, diff, all(diff))).toEqual(after);
  });

  it('fixes a step when either version is locked', () => {
    const lockedLater = { ...b, locked: true };
    // b is locked only in `after`; it keeps its place and a moves.
    const diff = diffRoutes([a, b], [lockedLater, a]);
    expect(moved(diff)).toEqual(['a']);
  });
});

describe('diffRoutes: semantic keys (imported updates)', () => {
  it('matches steps with new ids by key, lowest before index first, and reports the id change as a modify', () => {
    const before = [accept('a1', 5, { location: place(1, 1) }), accept('a2', 5, { location: place(1, 1) }), turnIn('t1', 5)];
    const after = [accept('b1', 5, { location: place(1, 1) }), turnIn('t2', 5), note('n')];
    const plain = diffRoutes(before, after);
    expect(kinds(plain)).toEqual(['remove', 'remove', 'remove', 'insert', 'insert', 'insert']);
    const keyed = diffRoutes(before, after, { semanticKey: semanticStepKey });
    expect(keyed.ops).toEqual<DiffOp[]>([
      { kind: 'remove', stepId: stepId('a2'), beforeIndex: 1 },
      { kind: 'insert', step: after[2] as RouteStep, after: stepId('t2'), afterIndex: 2 },
      { kind: 'modify', stepId: stepId('a1'), before: before[0] as RouteStep, after: after[0] as RouteStep, beforeIndex: 0, afterIndex: 0 },
      { kind: 'modify', stepId: stepId('t1'), before: before[2] as RouteStep, after: after[1] as RouteStep, beforeIndex: 2, afterIndex: 1 },
    ]);
    // The trailing note has no host: its own set.
    expect(keyed.changeSets.map((set) => set.id)).toEqual(['q:5', 's:n']);
    expect(applyChangeSets(before, keyed, all(keyed))).toEqual(after);
    expect(applyChangeSets(before, keyed, new Set())).toEqual(before);
  });

  it('matches by id before key, and never by a null key', () => {
    const before = [note('n1'), accept('a', 1)];
    const after = [note('n2'), accept('a', 1)];
    expect(kinds(diffRoutes(before, after, { semanticKey: semanticStepKey }))).toEqual(['remove', 'insert']);
  });

  it('keys quest steps by kind, quest, targets and location', () => {
    expect(semanticStepKey(accept('x', 7))).toBe('accept|7|-');
    expect(semanticStepKey(turnIn('x', 7, { location: place(1.5, -2) }))).toBe('turnin|7|w:1:1.5:-2');
    expect(semanticStepKey(complete('x', [7, 8]))).toBe('complete|7:*,8:*|-');
    expect(semanticStepKey(travel('x'))).toBeNull();
  });
});

describe('diffRoutes: large routes', () => {
  const { steps } = syntheticRoute(10_000);

  it('diffs a reversed 10,000-step route: one step kept, the rest moved, and applies it both ways', () => {
    const reversed = [...steps].reverse();
    // The 50 ms budget (ARCHITECTURE §14) is gated by tests/bench/diff.bench.ts --check.
    const diff = diffRoutes(steps, reversed);
    expect(diff.ops.length).toBe(9_999);
    expect(diff.ops.every((op) => op.kind === 'move')).toBe(true);
    // The kept step is the one with the smallest before-index (the tie rule).
    expect(diff.ops.some((op) => op.kind === 'move' && op.beforeIndex === 0)).toBe(false);
    expect(applyChangeSets(steps, diff, all(diff))).toEqual(reversed);
    expect(applyChangeSets(steps, diff, new Set())).toEqual(steps);
  });

  it('diffs a shuffled route with 1% edits and reproduces it', () => {
    const next = seeded(42);
    const after = editSteps(shuffled(steps, next), next, { removes: 33, inserts: 33, modifies: 34 });
    const diff = diffRoutes(steps, after);
    const count = (kind: string): number => diff.ops.filter((op) => op.kind === kind).length;
    expect(count('remove')).toBe(33);
    expect(count('insert')).toBe(33);
    expect(count('modify')).toBeGreaterThan(25);
    expect(count('move')).toBeGreaterThan(9_000);
    expect(ids(applyChangeSets(steps, diff, all(diff)))).toEqual(ids(after));
    expect(applyChangeSets(steps, diff, all(diff))).toEqual(after);
  });

  it('is deterministic', () => {
    const next = seeded(9);
    const after = editSteps(steps, next, { moves: 200, removes: 50, inserts: 50, modifies: 50 });
    const first = diffRoutes(steps, after, { semanticKey: semanticStepKey });
    const second = diffRoutes([...steps], [...after], { semanticKey: semanticStepKey });
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('reports unmatched quests only for their own steps', () => {
    const [first, ...rest] = steps;
    if (first === undefined) throw new Error('empty');
    const diff = diffRoutes(steps, rest);
    expect(diff.ops).toEqual([{ kind: 'remove', stepId: first.id, beforeIndex: 0 }]);
    // The removed travel step binds to the next quest step, the accept of quest 1000.
    expect(diff.changeSets).toEqual([{ id: 'q:1000', questIds: [questId(1000)], ops: [0], requires: [] }]);
  });
});
