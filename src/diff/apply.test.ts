import { describe, expect, it } from 'vitest';
import { groupId, questId, routeId, stepId } from '../domain/ids';
import type { Route, RouteGroup, RouteStep } from '../domain/route';
import { applyChangeSets, applyRouteChangeSets } from './apply';
import { closeChangeSets } from './change-sets';
import { diffRoute, diffRoutes } from './diff';
import { semanticStepKey } from './steps';
import { accept, editSteps, note, pick, seeded, shuffled, syntheticRoute, travel, turnIn } from './test-helpers';
import type { DiffOptions, RouteDiff } from './types';

const ids = (steps: readonly RouteStep[]): string[] => steps.map((s) => s.id);
const everySet = (diff: RouteDiff): Set<string> => new Set(diff.changeSets.map((set) => set.id));

/** A seeded selection of about `share` of the sets. */
function selection(diff: RouteDiff, next: () => number, share: number): Set<string> {
  return new Set(diff.changeSets.filter(() => next() < share).map((set) => set.id));
}

/**
 * The invariants of a partial application (apply.ts):
 * - the result holds `before` less the selected removes, plus the selected inserts;
 * - steps no selected op places keep their `before` order;
 * - steps kept in place (matched, not moved) and steps a selected op places keep their `after`
 *   order, so a quest's own steps (one change-set) are in their `before` or their `after` order;
 * - each selected insert or move directly follows the nearest step before it in `after` that is
 *   kept in place or placed by a selected op, or starts the result;
 * - a step is the `after` version exactly when its modify is selected.
 */
function checkPartial(before: readonly RouteStep[], after: readonly RouteStep[], diff: RouteDiff, selected: ReadonlySet<string>, result: readonly RouteStep[]): void {
  const closed = closeChangeSets(diff, selected);
  const on = new Set<number>();
  for (const set of diff.changeSets) if (closed.has(set.id)) for (const k of set.ops) on.add(k);
  const removed = new Set<string>();
  const inserted = new Set<string>();
  const placed = new Set<string>();
  const everyPlaced = new Set<string>();
  const modified = new Map<string, RouteStep>();
  const idInResult = new Map<string, string>();
  diff.ops.forEach((op, k) => {
    if (op.kind === 'modify') idInResult.set(op.after.id, on.has(k) ? op.after.id : op.before.id);
    if (op.kind === 'insert') everyPlaced.add(op.step.id);
    else if (op.kind === 'move') everyPlaced.add(op.stepId);
    if (!on.has(k)) return;
    if (op.kind === 'remove') removed.add(op.stepId);
    else if (op.kind === 'insert') {
      inserted.add(op.step.id);
      placed.add(op.step.id);
    } else if (op.kind === 'move') placed.add(op.stepId);
    else if (op.kind === 'modify') modified.set(op.stepId, op.after);
  });
  const beforeIdOf = new Map<string, string>(diff.ops.flatMap((op) => (op.kind === 'modify' ? [[op.after.id, op.before.id] as const] : [])));
  const resultIds = ids(result);
  const expectedIds = [...before.filter((s) => !removed.has(s.id)).map((s) => modified.get(s.id)?.id ?? s.id), ...inserted].sort();
  expect([...resultIds].sort()).toEqual(expectedIds);

  // Steps no selected op places keep their before order.
  const beforeIndex = new Map(before.map((s, i) => [modified.get(s.id)?.id ?? s.id, i]));
  let last = -1;
  for (const step of result) {
    const original = before[beforeIndex.get(step.id) ?? -1];
    if (original === undefined || placed.has(original.id)) continue;
    const index = beforeIndex.get(step.id) ?? -1;
    expect(index).toBeGreaterThan(last);
    last = index;
  }

  // Kept and placed steps keep their after order, and each placed step follows its anchor.
  const position = new Map(resultIds.map((id, i) => [id, i]));
  let anchor: string | null = null;
  let lastAt = -1;
  for (const step of after) {
    const key = beforeIdOf.get(step.id) ?? step.id;
    if (everyPlaced.has(key) && !placed.has(key)) continue;
    const mine = idInResult.get(step.id) ?? step.id;
    const at = position.get(mine) ?? -1;
    expect(at).toBeGreaterThan(lastAt);
    lastAt = at;
    if (placed.has(key)) {
      if (anchor === null) expect(at).toBe(0);
      else expect(resultIds[at - 1]).toBe(anchor);
    }
    anchor = mine;
  }

  for (const step of result) {
    const byAfter = modified.get(step.id);
    if (byAfter !== undefined) expect(step).toBe(byAfter);
  }
}

/** The id of the first turn-in that comes before its quest's accept, or null. */
function turnInBeforeAccept(steps: readonly RouteStep[]): string | null {
  const accepts = new Set<number>(steps.flatMap((s) => (s.kind === 'accept' ? [s.questId] : [])));
  const accepted = new Set<number>();
  for (const step of steps) {
    if (step.kind === 'accept') accepted.add(step.questId);
    else if (step.kind === 'turnin' && accepts.has(step.questId) && !accepted.has(step.questId)) return step.id;
  }
  return null;
}

/**
 * A seeded valid order of `quests` accept/turn-in pairs (each accept before its turn-in), with a
 * note before the accepts of `notes`: the shape of an optimiser reordering. `byId` reuses steps.
 */
function validOrder(quests: number, next: () => number, notes: ReadonlySet<number>, byId?: ReadonlyMap<string, RouteStep>): RouteStep[] {
  const pending: RouteStep[][] = [];
  for (let q = 1; q <= quests; q += 1) {
    const unit: RouteStep[] = [];
    if (notes.has(q)) unit.push(byId?.get(`n${String(q)}`) ?? note(`n${String(q)}`));
    unit.push(byId?.get(`a${String(q)}`) ?? accept(`a${String(q)}`, q), byId?.get(`t${String(q)}`) ?? turnIn(`t${String(q)}`, q));
    pending.push(unit);
  }
  const out: RouteStep[] = [];
  for (;;) {
    const live = pending.filter((unit) => unit.length > 0);
    if (live.length === 0) return out;
    const step = live[pick(next, live.length)]?.shift();
    if (step !== undefined) out.push(step);
  }
}

describe('applyChangeSets', () => {
  it('applies every set to give `after`, and none to give `before`, over seeded edits', () => {
    const { steps } = syntheticRoute(400, { groups: true });
    for (let seed = 1; seed <= 40; seed += 1) {
      const next = seeded(seed);
      const after = editSteps(steps, next, { moves: pick(next, 40), removes: pick(next, 20), inserts: pick(next, 20), modifies: pick(next, 20) });
      const diff = diffRoutes(steps, after);
      expect(applyChangeSets(steps, diff, everySet(diff))).toEqual(after);
      expect(applyChangeSets(steps, diff, new Set())).toEqual(steps);
    }
  });

  it('keeps the partial-application invariants over seeded selections', () => {
    const { steps } = syntheticRoute(300, { groups: true });
    for (let seed = 1; seed <= 60; seed += 1) {
      const next = seeded(1000 + seed);
      const base = seed % 3 === 0 ? shuffled(steps, next) : steps;
      const after = editSteps(base, next, { moves: pick(next, 30), removes: pick(next, 15), inserts: pick(next, 15), modifies: pick(next, 15) });
      const options: DiffOptions = seed % 2 === 0 ? { semanticKey: semanticStepKey } : {};
      const diff = diffRoutes(steps, after, options);
      for (const share of [0.1, 0.5, 0.9]) {
        const selected = selection(diff, next, share);
        const result = applyChangeSets(steps, diff, selected);
        checkPartial(steps, after, diff, selected, result);
      }
    }
  });

  it('is idempotent: applying a selection to its own result changes nothing', () => {
    const { steps } = syntheticRoute(300, { groups: true });
    for (let seed = 1; seed <= 30; seed += 1) {
      const next = seeded(500 + seed);
      const after = editSteps(steps, next, { moves: pick(next, 40), removes: pick(next, 10), inserts: pick(next, 10), modifies: pick(next, 10) });
      const diff = diffRoutes(steps, after, { semanticKey: semanticStepKey });
      const selected = selection(diff, next, 0.5);
      const once = applyChangeSets(steps, diff, selected);
      expect(applyChangeSets(once, diff, selected)).toEqual(once);
      // The closed selection gives the same result as the selection.
      expect(applyChangeSets(steps, diff, closeChangeSets(diff, selected))).toEqual(once);
      // What is left is a diff of its own, and applying it all reaches `after`.
      const rest = diffRoutes(once, after);
      expect(applyChangeSets(once, rest, everySet(rest))).toEqual(after);
      const full = applyChangeSets(steps, diff, everySet(diff));
      expect(diffRoutes(full, after).ops).toEqual([]);
      expect(applyChangeSets(full, diff, everySet(diff))).toEqual(after);
    }
  });

  it('places a step after the nearest kept or selected step, skipping unselected inserts', () => {
    const a = accept('a', 1);
    const b = accept('b', 2);
    const c = accept('c', 3);
    const y = accept('y', 8);
    const x = accept('x', 9);
    const before = [a, b, c];
    // After-order before-indices [0, 2, 1]: a and b are kept, c moves; its anchor chain is x, y, a.
    const after = [a, y, x, c, b];
    const diff = diffRoutes(before, after);
    expect(diff.changeSets.map((set) => set.id)).toEqual(['q:8', 'q:9', 'q:3']);
    expect(ids(applyChangeSets(before, diff, new Set(['q:3'])))).toEqual(['a', 'c', 'b']);
    expect(ids(applyChangeSets(before, diff, new Set(['q:3', 'q:8'])))).toEqual(['a', 'y', 'c', 'b']);
    expect(ids(applyChangeSets(before, diff, new Set(['q:9'])))).toEqual(['a', 'x', 'b', 'c']);
    expect(ids(applyChangeSets(before, diff, new Set(['q:3', 'q:9'])))).toEqual(['a', 'x', 'c', 'b']);
    // Non-quest inserts bind to the next quest step (a, which is kept); b moves to the start.
    const chain = diffRoutes([a, b], [b, note('n1'), note('n2'), a]);
    expect(chain.changeSets.map((set) => set.id)).toEqual(['q:2', 'q:1']);
    // Unselected, b is still at its before place, so it anchors nothing: the notes go in before
    // their host a, as in `after` (they used to follow b to the end).
    expect(ids(applyChangeSets([a, b], chain, new Set(['q:1'])))).toEqual(['n1', 'n2', 'a', 'b']);
    expect(ids(applyChangeSets([a, b], chain, new Set(['q:2'])))).toEqual(['b', 'a']);
    expect(ids(applyChangeSets([a, b], chain, new Set(['q:1', 'q:2'])))).toEqual(['b', 'n1', 'n2', 'a']);
  });

  it('never anchors a placed step to an unselected moved step, which is still at its before place', () => {
    // RTD-01, case 1. Kept: a3, t2, t3 (the subsequence); q:1 moves a1 and t1, q:2 moves a2. q:2
    // alone used to anchor a2 to a1 at its before place: a3 t2 t3 a1 a2 t1, turn-in before accept.
    const before = [accept('a3', 3), accept('a2', 2), turnIn('t2', 2), turnIn('t3', 3), accept('a1', 1), turnIn('t1', 1)];
    const byId = new Map(before.map((s) => [s.id, s]));
    const after = ['a1', 'a2', 't1', 'a3', 't2', 't3'].map((id) => byId.get(stepId(id)) as RouteStep);
    const diff = diffRoutes(before, after);
    expect(diff.changeSets.map((set) => [set.id, set.ops])).toEqual([
      ['q:1', [0, 2]],
      ['q:2', [1]],
    ]);
    expect(ids(applyChangeSets(before, diff, new Set(['q:2'])))).toEqual(['a2', 'a3', 't2', 't3', 'a1', 't1']);
    expect(ids(applyChangeSets(before, diff, new Set(['q:1'])))).toEqual(['a1', 't1', 'a3', 'a2', 't2', 't3']);

    // Case 2: a placed quest stays after an unmoved prerequisite's turn-in. Quest 2 needs quest 1,
    // which is kept, so no requires edge exists. q:2 alone used to give a3 a2 a1 t1 n t2 t3.
    const before2 = [accept('a3', 3), accept('a1', 1), turnIn('t1', 1), note('n'), accept('a2', 2), turnIn('t2', 2), turnIn('t3', 3)];
    const byId2 = new Map(before2.map((s) => [s.id, s]));
    const after2 = ['a1', 't1', 'a3', 'a2', 'n', 't2', 't3'].map((id) => byId2.get(stepId(id)) as RouteStep);
    const diff2 = diffRoutes(before2, after2, {
      relations: { exclusive: () => [], prerequisites: (q) => (q === questId(2) ? [questId(1)] : []) },
    });
    expect(diff2.changeSets.map((set) => [set.id, set.requires])).toEqual([
      ['q:3', []],
      ['q:2', []],
    ]);
    expect(ids(applyChangeSets(before2, diff2, new Set(['q:2'])))).toEqual(['a3', 'a1', 't1', 'a2', 'n', 't2', 't3']);
    expect(ids(applyChangeSets(before2, diff2, new Set(['q:3'])))).toEqual(['a1', 't1', 'a3', 'n', 'a2', 't2', 't3']);
  });

  it('keeps each quest in order under single and random selections of seeded valid reorderings', () => {
    let applications = 0;
    for (let seed = 1; seed <= 1500; seed += 1) {
      const next = seeded(seed);
      const quests = 3 + pick(next, 4);
      const notes = new Set<number>();
      for (let q = 1; q <= quests; q += 1) if (next() < 0.3) notes.add(q);
      const before = validOrder(quests, next, notes);
      const after = validOrder(quests, seeded(100_000 + seed), notes, new Map(before.map((s) => [s.id, s])));
      const diff = diffRoutes(before, after);
      expect(applyChangeSets(before, diff, everySet(diff))).toEqual(after);
      const selections = [...diff.changeSets.map((set) => new Set([set.id])), selection(diff, next, 0.5), selection(diff, next, 0.5)];
      for (const selected of selections) {
        applications += 1;
        const result = applyChangeSets(before, diff, selected);
        expect(turnInBeforeAccept(result), `seed ${String(seed)}, {${[...selected].join(',')}}`).toBeNull();
        checkPartial(before, after, diff, selected, result);
      }
    }
    expect(applications).toBeGreaterThan(5000);
  });

  it('refuses unknown sets and diffs of another route', () => {
    const before = [accept('a', 1), accept('b', 2)];
    const diff = diffRoutes(before, [accept('b', 2), accept('a', 1)]);
    expect(() => applyChangeSets(before, diff, new Set(['q:9']))).toThrow(/Unknown change-set/);
    expect(() => applyChangeSets([accept('z', 1)], diff, everySet(diff))).toThrow(/not in the route/);
    expect(() => applyChangeSets([...before, before[0] as RouteStep], diff, new Set())).toThrow(/Duplicate step id/);
  });
});

describe('diffRoute and applyRouteChangeSets: the groups sidecar', () => {
  const g = (id: string, stepIndex = 0): RouteGroup => ({
    id: groupId(id),
    rxp: { importId: 'imp', stepIndex, tags: [], condition: null, waypoints: [], annotations: [], fingerprint: `fp-${id}` },
  });
  const route = (steps: RouteStep[], groups: RouteGroup[]): Route => ({
    id: routeId('r'),
    name: 'Route',
    description: '',
    steps,
    groups: Object.fromEntries(groups.map((group) => [group.id, group])),
  });

  it('adds, removes and modifies groups in their own sets, with requires edges from the steps', () => {
    const g1 = groupId('G1');
    const g2 = groupId('G2');
    const g3 = groupId('G3');
    const before = route([accept('a', 1, { groupId: g1 }), turnIn('t', 1, { groupId: g1 }), accept('b', 2, { groupId: g2 }), travel('x')], [g('G1'), g('G2')]);
    const after = route(
      [accept('a', 1, { groupId: g1 }), turnIn('t', 1, { groupId: g1 }), accept('c', 3, { groupId: g3 }), turnIn('d', 3, { groupId: g3 }), travel('x')],
      [{ ...g('G1'), rxp: { ...(g('G1').rxp as NonNullable<RouteGroup['rxp']>), fingerprint: 'changed' } }, g('G3', 2)],
    );
    const diff = diffRoute(before, after);
    expect(diff.ops.map((op) => op.kind)).toEqual(['remove', 'insert', 'insert', 'group-remove', 'group-add', 'group-modify']);
    expect(diff.changeSets.map((set) => [set.id, set.requires])).toEqual([
      ['q:2', []],
      ['q:3', ['g:G3']],
      ['g:G2', ['q:2']],
      ['g:G3', []],
      ['g:G1', []],
    ]);
    expect(applyRouteChangeSets(before, diff, everySet(diff))).toEqual(after);
    expect(applyRouteChangeSets(before, diff, new Set())).toEqual(before);
    // Inserting quest 3 brings its group; removing G2 brings the removal of its step.
    const withC = applyRouteChangeSets(before, diff, new Set(['q:3']));
    expect(Object.keys(withC.groups)).toEqual(['G1', 'G2', 'G3']);
    // c goes after its nearest surviving predecessor in `after` (t), and d after c.
    expect(ids(withC.steps)).toEqual(['a', 't', 'c', 'd', 'b', 'x']);
    const withoutG2 = applyRouteChangeSets(before, diff, new Set(['g:G2']));
    expect(Object.keys(withoutG2.groups)).toEqual(['G1']);
    expect(ids(withoutG2.steps)).toEqual(['a', 't', 'x']);
    // Idempotent on the groups as well.
    expect(applyRouteChangeSets(withC, diff, new Set(['q:3']))).toEqual(withC);
  });

  it('keeps a route whose groups do not change, and the step-level apply ignores group ops', () => {
    const { steps, groups } = syntheticRoute(200, { groups: true });
    const before: Route = { id: routeId('r'), name: 'n', description: '', steps, groups };
    const next = seeded(4);
    const after: Route = { ...before, steps: editSteps(steps, next, { moves: 20, modifies: 5 }) };
    const diff = diffRoute(before, after);
    expect(diff.ops.some((op) => op.kind.startsWith('group'))).toBe(false);
    const applied = applyRouteChangeSets(before, diff, everySet(diff));
    expect(applied).toEqual(after);
    expect(applied.groups).toBe(before.groups);
    const dropped = diffRoute(before, { ...before, groups: {} });
    expect(applyChangeSets(steps, dropped, everySet(dropped))).toEqual(steps);
    expect(applyRouteChangeSets(before, dropped, everySet(dropped)).groups).toEqual({});
  });

  it('binds steps to hosts across interleaved groups', () => {
    const { steps, groups } = syntheticRoute(60, { groups: true });
    const before: Route = { id: routeId('r'), name: '', description: '', steps, groups };
    // Quest 1000's and 1001's accepts share group g0, with quest 1000's other steps between them.
    expect(steps[1]?.groupId).toBe('g0');
    expect(steps[7]?.groupId).toBe('g0');
    // Remove quest 1001's unit: s7 (travel), s8 (accept, g0), s9, s10 (complete), s11, s12 (turn-in).
    const unit = new Set(['s7', 's8', 's9', 's10', 's11', 's12']);
    const diff = diffRoute(before, { ...before, steps: steps.filter((s) => !unit.has(s.id)) });
    expect(diff.changeSets.map((set) => set.id)).toEqual(['q:1001']);
    expect(diff.ops.map((op) => (op.kind === 'remove' ? op.stepId : op.kind))).toEqual([...unit]);
    // Group g0 keeps quest 1000's accept, so the sidecar does not change.
    const applied = applyRouteChangeSets(before, diff, everySet(diff));
    expect(applied.groups).toBe(groups);
    expect(applied.steps.some((s) => s.kind === 'accept' && s.questId === questId(1001))).toBe(false);
  });
});
