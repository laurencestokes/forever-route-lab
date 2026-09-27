import type { GroupId, QuestId, StepId } from '../domain/ids';
import type { RouteStep } from '../domain/route';
import { hostIndices, stepQuestIds } from './steps';
import type { ChangeSet, DiffOp, DiffRelations, RouteDiff, StepDependency } from './types';

/**
 * Change-sets (docs/ARCHITECTURE.md §13; docs/research/optimizer-m7.md §10).
 *
 * - An op's quests are the quests its step names (`stepQuestIds`; both versions for a modify). A
 *   non-quest step takes its host's (`hostIndices` over the sequence it lives in: `before` for a
 *   remove, `after` otherwise), unless it is a dependency's `stepId`: its requirements are
 *   explicit, so it is a change of its own. (The optimiser's grind fill ends the section, so its
 *   host would be the first quest step after the section, which the proposal does not touch;
 *   joining that quest's set would name the fill after it, merge it with that quest's exclusive
 *   partners, and make the quest's set require everything the fill requires.) With neither, the
 *   op has no quest and forms an `s:` set.
 * - Union-find merges the ops that share a quest (so a multi-target complete merges its quests),
 *   the ops of one step (a move and a modify), and quests related by `relations.exclusive`.
 * - `requires` edges come from `relations.prerequisites` (placing a quest needs its prerequisites
 *   placed; removing a prerequisite needs its dependants removed), from `dependencies`, and, in a
 *   route-level diff, from the groups sidecar (a step op that leaves a step in an added group
 *   requires that group; a group removal requires the ops that take its steps out of it).
 * - Set ids: `q:<lowest quest id>`, `g:<group id>` for a group op, or `s:<step id>`.
 */

export interface ChangeSetInput {
  readonly before: readonly RouteStep[];
  readonly after: readonly RouteStep[];
  readonly ops: readonly DiffOp[];
  readonly relations: DiffRelations | undefined;
  readonly dependencies: readonly StepDependency[] | undefined;
}

function unionFind(size: number): { find(k: number): number; union(a: number, b: number): void } {
  const parent = new Int32Array(size);
  for (let k = 0; k < size; k += 1) parent[k] = k;
  const find = (k: number): number => {
    let root = k;
    while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
    // Path compression.
    let node = k;
    while (node !== root) {
      const up = parent[node] ?? root;
      parent[node] = root;
      node = up;
    }
    return root;
  };
  return {
    find,
    union(a, b) {
      const ra = find(a);
      const rb = find(b);
      // The smaller op index is the root, so a set's root is its first op.
      if (ra < rb) parent[rb] = ra;
      else if (rb < ra) parent[ra] = rb;
    },
  };
}

/** The step an op leaves in the result, or null for a remove or a group op. */
function resultStep(op: DiffOp, after: readonly RouteStep[]): RouteStep | null {
  switch (op.kind) {
    case 'insert':
      return op.step;
    case 'move':
      return after[op.afterIndex] ?? null;
    case 'modify':
      return op.after;
    case 'remove':
    case 'group-add':
    case 'group-remove':
    case 'group-modify':
      return null;
  }
}

const mergeQuestIds = (a: readonly QuestId[], b: readonly QuestId[]): QuestId[] =>
  b.length === 0 ? [...a] : [...new Set([...a, ...b])].sort((x, y) => x - y);

export function buildChangeSets(input: ChangeSetInput): ChangeSet[] {
  const { before, after, ops, relations, dependencies } = input;
  let hostsBefore: Int32Array | null = null;
  let hostsAfter: Int32Array | null = null;
  const hostQuests = (sequence: 'before' | 'after', index: number): QuestId[] => {
    let hosts: Int32Array;
    if (sequence === 'before') hosts = hostsBefore ??= hostIndices(before);
    else hosts = hostsAfter ??= hostIndices(after);
    const host = hosts[index] ?? -1;
    const step = host < 0 ? undefined : (sequence === 'before' ? before : after)[host];
    return step === undefined ? [] : stepQuestIds(step);
  };
  // A non-quest step with a dependency of its own takes no host.
  const dependants = new Set<StepId>();
  for (const dependency of dependencies ?? []) dependants.add(dependency.stepId);
  const hostless = (op: DiffOp): boolean => {
    if (dependants.size === 0) return false;
    switch (op.kind) {
      case 'remove':
        return dependants.has(op.stepId);
      case 'move':
        return dependants.has(op.stepId) || dependants.has(after[op.afterIndex]?.id ?? op.stepId);
      case 'insert':
        return dependants.has(op.step.id);
      case 'modify':
        return dependants.has(op.before.id) || dependants.has(op.after.id);
      case 'group-add':
      case 'group-remove':
      case 'group-modify':
        return false;
    }
  };

  // Per op: the quests it names itself, and the quests it belongs to (its own, or its host's).
  const own: QuestId[][] = [];
  const quests: QuestId[][] = [];
  for (const op of ops) {
    let mine: QuestId[];
    switch (op.kind) {
      case 'remove': {
        const step = before[op.beforeIndex];
        mine = step === undefined ? [] : stepQuestIds(step);
        break;
      }
      case 'insert':
        mine = stepQuestIds(op.step);
        break;
      case 'move': {
        const step = after[op.afterIndex];
        mine = step === undefined ? [] : stepQuestIds(step);
        break;
      }
      case 'modify':
        mine = mergeQuestIds(stepQuestIds(op.before), stepQuestIds(op.after));
        break;
      case 'group-add':
      case 'group-remove':
      case 'group-modify':
        mine = [];
        break;
    }
    own.push(mine);
    if (mine.length > 0 || op.kind === 'group-add' || op.kind === 'group-remove' || op.kind === 'group-modify' || hostless(op)) quests.push(mine);
    else if (op.kind === 'remove') quests.push(hostQuests('before', op.beforeIndex));
    else quests.push(hostQuests('after', op.afterIndex));
  }

  const sets = unionFind(ops.length);
  const firstOpOfQuest = new Map<QuestId, number>();
  const opOfBeforeIndex = new Map<number, number>();
  ops.forEach((op, k) => {
    for (const q of quests[k] ?? []) {
      const first = firstOpOfQuest.get(q);
      if (first === undefined) firstOpOfQuest.set(q, k);
      else sets.union(first, k);
    }
    if (op.kind === 'move' || op.kind === 'modify') {
      const first = opOfBeforeIndex.get(op.beforeIndex);
      if (first === undefined) opOfBeforeIndex.set(op.beforeIndex, k);
      else sets.union(first, k);
    }
  });
  if (relations !== undefined) {
    for (const [q, k] of firstOpOfQuest) {
      for (const r of relations.exclusive(q)) {
        const other = firstOpOfQuest.get(r);
        if (other !== undefined) sets.union(k, other);
      }
    }
  }

  // Sets in order of their first op (each root is its set's first op).
  const setOfOp = new Int32Array(ops.length);
  const setOfRoot = new Map<number, number>();
  const members: number[][] = [];
  ops.forEach((_, k) => {
    const root = sets.find(k);
    let index = setOfRoot.get(root);
    if (index === undefined) {
      index = members.length;
      setOfRoot.set(root, index);
      members.push([]);
    }
    members[index]?.push(k);
    setOfOp[k] = index;
  });

  const requires: Set<number>[] = members.map(() => new Set<number>());
  const edge = (from: number, to: number): void => {
    if (from !== to) requires[from]?.add(to);
  };

  if (relations !== undefined) {
    const placed = new Set<QuestId>();
    const removed = new Set<QuestId>();
    ops.forEach((op, k) => {
      if (op.kind === 'insert' || op.kind === 'move') for (const q of own[k] ?? []) placed.add(q);
      else if (op.kind === 'remove') for (const q of own[k] ?? []) removed.add(q);
    });
    for (const [q, k] of firstOpOfQuest) {
      const setQ = setOfOp[k] ?? 0;
      for (const p of relations.prerequisites(q)) {
        const other = firstOpOfQuest.get(p);
        if (other === undefined) continue;
        const setP = setOfOp[other] ?? 0;
        if (placed.has(q) && placed.has(p)) edge(setQ, setP);
        if (removed.has(p) && removed.has(q)) edge(setP, setQ);
      }
    }
  }

  if (dependencies !== undefined && dependencies.length > 0) {
    const opOfStepId = new Map<StepId, number>();
    ops.forEach((op, k) => {
      switch (op.kind) {
        case 'remove':
          opOfStepId.set(op.stepId, k);
          break;
        case 'insert':
          opOfStepId.set(op.step.id, k);
          break;
        case 'move': {
          opOfStepId.set(op.stepId, k);
          const step = after[op.afterIndex];
          if (step !== undefined) opOfStepId.set(step.id, k);
          break;
        }
        case 'modify':
          opOfStepId.set(op.before.id, k);
          opOfStepId.set(op.after.id, k);
          break;
        case 'group-add':
        case 'group-remove':
        case 'group-modify':
          break;
      }
    });
    for (const dependency of dependencies) {
      const from = opOfStepId.get(dependency.stepId);
      if (from === undefined) continue;
      for (const id of dependency.requires) {
        const to = opOfStepId.get(id);
        if (to !== undefined) edge(setOfOp[from] ?? 0, setOfOp[to] ?? 0);
      }
    }
  }

  const addedGroup = new Map<GroupId, number>();
  const removedGroup = new Map<GroupId, number>();
  ops.forEach((op, k) => {
    if (op.kind === 'group-add') addedGroup.set(op.groupId, setOfOp[k] ?? 0);
    else if (op.kind === 'group-remove') removedGroup.set(op.groupId, setOfOp[k] ?? 0);
  });
  if (addedGroup.size > 0 || removedGroup.size > 0) {
    ops.forEach((op, k) => {
      const setK = setOfOp[k] ?? 0;
      const left = resultStep(op, after)?.groupId ?? null;
      const needs = left === null ? undefined : addedGroup.get(left);
      if (needs !== undefined) edge(setK, needs);
      let from: GroupId | null = null;
      if (op.kind === 'remove') from = before[op.beforeIndex]?.groupId ?? null;
      else if (op.kind === 'modify' && op.before.groupId !== op.after.groupId) from = op.before.groupId;
      const removal = from === null ? undefined : removedGroup.get(from);
      if (removal !== undefined) edge(removal, setK);
    });
  }

  // Each set's quests, collected once and sorted once (a merged set can hold thousands).
  const setQuests = members.map((opIndices) => {
    const merged = new Set<QuestId>();
    for (const k of opIndices) for (const q of quests[k] ?? []) merged.add(q);
    return [...merged].sort((x, y) => x - y);
  });
  const setIds = members.map((opIndices, index) => {
    const lowest = setQuests[index]?.[0];
    if (lowest !== undefined) return `q:${String(lowest)}`;
    const first = ops[opIndices[0] ?? -1];
    if (first === undefined) return `s:${String(index)}`;
    switch (first.kind) {
      case 'group-add':
      case 'group-remove':
      case 'group-modify':
        return `g:${first.groupId}`;
      case 'insert':
        return `s:${first.step.id}`;
      case 'remove':
      case 'move':
      case 'modify':
        return `s:${first.stepId}`;
    }
  });
  return members.map((opIndices, index) => ({
    id: setIds[index] ?? '',
    questIds: setQuests[index] ?? [],
    ops: opIndices,
    requires: [...(requires[index] ?? [])].sort((a, b) => a - b).map((to) => setIds[to] ?? ''),
  }));
}

/**
 * The ids of `selected` and of every set they require, directly or not. Throws on an id that is
 * not one of the diff's sets.
 */
export function closeChangeSets(diff: RouteDiff, selected: Iterable<string>): Set<string> {
  const byId = new Map<string, ChangeSet>();
  for (const set of diff.changeSets) byId.set(set.id, set);
  const closed = new Set<string>();
  const queue: string[] = [];
  for (const id of selected) {
    if (!byId.has(id)) throw new Error(`Unknown change-set "${id}"`);
    if (!closed.has(id)) {
      closed.add(id);
      queue.push(id);
    }
  }
  for (let k = 0; k < queue.length; k += 1) {
    for (const id of byId.get(queue[k] ?? '')?.requires ?? []) {
      if (closed.has(id)) continue;
      closed.add(id);
      queue.push(id);
    }
  }
  return closed;
}
