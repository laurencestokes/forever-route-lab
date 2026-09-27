import type { StepId } from '../domain/ids';
import type { Route, RouteGroup, RouteStep } from '../domain/route';
import { closeChangeSets } from './change-sets';
import type { RouteDiff } from './types';

/**
 * Applying selected change-sets (docs/ARCHITECTURE.md §13; docs/research/optimizer-m7.md §10).
 *
 * 1. Close the selection over `requires`.
 * 2. Apply the selected removes.
 * 3. Apply the selected inserts and moves in `after` order, each placed directly after its anchor:
 *    the nearest preceding (in `after` order) step that is kept in place (matched and not moved)
 *    or placed by a selected op, or at the start when there is none. The search skips the steps of
 *    unselected inserts and moves (an unselected moved step is still at its `before` place) by
 *    following each one's own anchor.
 * 4. Apply the selected modifies.
 *
 * So the steps kept in place and the steps of the selected ops appear in their `after` order, and
 * the steps no selected op places keep their `before` order: each quest's own steps (all in one
 * change-set) are in one order or the other, and a placed step stays after the kept steps that
 * precede it in `after` (an unmoved prerequisite's turn-in, for example). With every set selected
 * the result is `after`; with none it is `before`. Steps are found by id (a semantically matched
 * step by either of its ids), so applying the same selection to its own result changes nothing: a
 * remove of an absent step is skipped, and a placed step is placed again after the same anchor.
 * The caller re-walks and re-validates the result.
 */

function selectedOps(diff: RouteDiff, selected: ReadonlySet<string>): Uint8Array {
  const closed = closeChangeSets(diff, selected);
  const on = new Uint8Array(diff.ops.length);
  for (const set of diff.changeSets) {
    if (!closed.has(set.id)) continue;
    for (const k of set.ops) on[k] = 1;
  }
  return on;
}

function applyStepOps(steps: readonly RouteStep[], diff: RouteDiff, on: Uint8Array): RouteStep[] {
  const { ops } = diff;
  let inserts = 0;
  for (const op of ops) if (op.kind === 'insert') inserts += 1;
  const capacity = steps.length + inserts;
  const items: (RouteStep | undefined)[] = new Array<RouteStep | undefined>(capacity);
  const next = new Int32Array(capacity).fill(-1);
  const prev = new Int32Array(capacity).fill(-1);
  const nodeOf = new Map<string, number>();
  let head = -1;
  let tail = -1;
  let used = 0;

  const linkAfter = (node: number, anchor: number): void => {
    const following = anchor < 0 ? head : (next[anchor] ?? -1);
    prev[node] = anchor;
    next[node] = following;
    if (anchor < 0) head = node;
    else next[anchor] = node;
    if (following < 0) tail = node;
    else prev[following] = node;
  };
  const unlink = (node: number): void => {
    const before = prev[node] ?? -1;
    const after = next[node] ?? -1;
    if (before < 0) head = after;
    else next[before] = after;
    if (after < 0) tail = before;
    else prev[after] = before;
    prev[node] = -1;
    next[node] = -1;
  };

  for (const step of steps) {
    if (nodeOf.has(step.id)) throw new Error(`Duplicate step id "${step.id}"`);
    items[used] = step;
    nodeOf.set(step.id, used);
    linkAfter(used, tail);
    used += 1;
  }

  // A semantically matched step has two ids; either finds it.
  const alias = new Map<string, StepId>();
  for (const op of ops) {
    if (op.kind === 'modify' && op.before.id !== op.after.id) {
      alias.set(op.before.id, op.after.id);
      alias.set(op.after.id, op.before.id);
    }
  }
  const find = (id: string): number => {
    const node = nodeOf.get(id);
    if (node !== undefined) return node;
    const other = alias.get(id);
    return other === undefined ? -1 : (nodeOf.get(other) ?? -1);
  };
  const required = (id: StepId, what: string): number => {
    const node = find(id);
    if (node < 0) throw new Error(`The ${what} step "${id}" is not in the route: the diff belongs to another route`);
    return node;
  };
  // The insert or move at each `after` index; -1 where a step is kept in place.
  let placedLength = 0;
  for (const op of ops) if (op.kind === 'insert' || op.kind === 'move') placedLength = Math.max(placedLength, op.afterIndex + 1);
  const placing = new Int32Array(placedLength).fill(-1);
  ops.forEach((op, k) => {
    if (op.kind === 'insert' || op.kind === 'move') placing[op.afterIndex] = k;
  });
  /**
   * The node to place the step at `after` index `afterIndex` after, given its `after` predecessor
   * `id`: the nearest preceding step kept in place (no op at its index) or placed by a selected op
   * (ops run in `after` order, so it is already placed). An unselected insert or move is skipped
   * for its own predecessor. -1 is the start.
   */
  const anchorOf = (afterIndex: number, id: StepId | null): number => {
    let current = id;
    for (let a = afterIndex - 1; a >= 0 && current !== null; a -= 1) {
      const k = placing[a] ?? -1;
      if (k < 0 || on[k] === 1) return required(current, 'anchor');
      const op = ops[k];
      if (op?.kind !== 'insert' && op?.kind !== 'move') break;
      current = op.after;
    }
    return -1;
  };

  ops.forEach((op, k) => {
    if (on[k] !== 1 || op.kind !== 'remove') return;
    const node = find(op.stepId);
    if (node < 0) return;
    unlink(node);
    nodeOf.delete(items[node]?.id ?? op.stepId);
  });
  ops.forEach((op, k) => {
    if (on[k] !== 1) return;
    if (op.kind === 'move') {
      const node = required(op.stepId, 'moved');
      unlink(node);
      linkAfter(node, anchorOf(op.afterIndex, op.after));
    } else if (op.kind === 'insert') {
      let node = find(op.step.id);
      if (node >= 0) {
        unlink(node);
      } else {
        node = used;
        used += 1;
        nodeOf.set(op.step.id, node);
      }
      items[node] = op.step;
      linkAfter(node, anchorOf(op.afterIndex, op.after));
    }
  });
  ops.forEach((op, k) => {
    if (on[k] !== 1 || op.kind !== 'modify') return;
    const node = required(op.stepId, 'modified');
    const current = items[node];
    if (current !== undefined && current.id !== op.after.id) {
      nodeOf.delete(current.id);
      nodeOf.set(op.after.id, node);
    }
    items[node] = op.after;
  });

  const out: RouteStep[] = [];
  for (let node = head; node >= 0; node = next[node] ?? -1) {
    const step = items[node];
    if (step !== undefined) out.push(step);
  }
  return out;
}

/**
 * `steps` with the selected change-sets of `diff` (and the sets they require) applied. `steps` is
 * the diff's `before` (or the result of applying the same diff). Group ops are ignored here:
 * `applyRouteChangeSets` applies them. Throws on an unknown set id or a diff of another route.
 */
export function applyChangeSets(steps: readonly RouteStep[], diff: RouteDiff, selected: ReadonlySet<string>): RouteStep[] {
  return applyStepOps(steps, diff, selectedOps(diff, selected));
}

/**
 * `route` with the selected change-sets applied to its steps and its `groups` sidecar: a selected
 * group remove deletes the group, an add or modify sets it. Groups keep their key order, with added
 * ones last. Everything else on the route is kept.
 */
export function applyRouteChangeSets(route: Route, diff: RouteDiff, selected: ReadonlySet<string>): Route {
  const on = selectedOps(diff, selected);
  const steps = applyStepOps(route.steps, diff, on);
  const groups = new Map<string, RouteGroup>();
  for (const key of Object.keys(route.groups)) {
    const group = route.groups[key];
    if (group !== undefined) groups.set(key, group);
  }
  let changed = false;
  diff.ops.forEach((op, k) => {
    if (on[k] !== 1) return;
    if (op.kind === 'group-remove') changed = groups.delete(op.groupId) || changed;
    else if (op.kind === 'group-add') {
      groups.set(op.groupId, op.group);
      changed = true;
    } else if (op.kind === 'group-modify') {
      groups.set(op.groupId, op.after);
      changed = true;
    }
  });
  // fromEntries defines own properties, so no key (not even `__proto__`) reaches a setter.
  return { ...route, steps, groups: changed ? Object.fromEntries(groups) : route.groups };
}
