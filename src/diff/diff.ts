import { type GroupId, groupId } from '../domain/ids';
import type { Route, RouteStep } from '../domain/route';
import { buildChangeSets } from './change-sets';
import { structurallyEqual } from './equal';
import { longestIncreasingSubsequence } from './lis';
import type { DiffOp, DiffOptions, RouteDiff } from './types';

/**
 * The route diff (docs/ARCHITECTURE.md §13; docs/research/optimizer-m7.md §10). Pure and
 * deterministic: the output depends only on the two step lists and the options.
 *
 * - Matching: by id; then, with `options.semanticKey`, each unmatched `after` step (in order) takes
 *   the lowest unmatched `before` index with an equal non-null key.
 * - Moves: the matched steps kept in place are a maximum-weight increasing subsequence of their
 *   before-indices in `after` order (`longestIncreasingSubsequence`), with fixed steps weighing
 *   n + 1 and the others 1, so when the fixed steps are increasing among themselves none of them is
 *   reported as moved. Every other matched step is a move.
 * - Unmatched `before` steps are removes, unmatched `after` steps inserts, and a matched pair that
 *   is not the same object and not structurally equal is also a modify.
 */

function indexById(steps: readonly RouteStep[], which: string): Map<string, number> {
  const out = new Map<string, number>();
  steps.forEach((step, i) => {
    if (out.has(step.id)) throw new Error(`Duplicate step id "${step.id}" in ${which}`);
    out.set(step.id, i);
  });
  return out;
}

const locked = (step: RouteStep): boolean => step.locked;

/** The step ops of `after` relative to `before`, in the `RouteDiff` op order. */
function stepOps(before: readonly RouteStep[], after: readonly RouteStep[], options: DiffOptions): DiffOp[] {
  const beforeIndex = indexById(before, 'before');
  // match[a]: the before-index of after[a], or -1. `before`'s ids are unique, so an `after` id
  // repeats exactly when two `after` steps match one `before` step, or two unmatched ones share it:
  // the match pass finds duplicates without a second id map of `after`.
  const match = new Int32Array(after.length).fill(-1);
  const matched = new Uint8Array(before.length);
  const unmatchedIds = new Set<string>();
  let matchedCount = 0;
  after.forEach((step, a) => {
    const b = beforeIndex.get(step.id);
    if (b === undefined) {
      if (unmatchedIds.has(step.id)) throw new Error(`Duplicate step id "${step.id}" in after`);
      unmatchedIds.add(step.id);
      return;
    }
    if (matched[b] === 1) throw new Error(`Duplicate step id "${step.id}" in after`);
    match[a] = b;
    matched[b] = 1;
    matchedCount += 1;
  });
  const semanticKey = options.semanticKey;
  if (semanticKey !== undefined && matchedCount < Math.min(before.length, after.length)) {
    const byKey = new Map<string, { readonly indices: number[]; next: number }>();
    before.forEach((step, b) => {
      if (matched[b] === 1) return;
      const key = semanticKey(step);
      if (key === null) return;
      const entry = byKey.get(key);
      if (entry === undefined) byKey.set(key, { indices: [b], next: 0 });
      else entry.indices.push(b);
    });
    after.forEach((step, a) => {
      if ((match[a] ?? -1) >= 0) return;
      const key = semanticKey(step);
      const entry = key === null ? undefined : byKey.get(key);
      const b = entry?.indices[entry.next];
      if (entry === undefined || b === undefined) return;
      entry.next += 1;
      match[a] = b;
      matched[b] = 1;
      matchedCount += 1;
    });
  }

  // The subsequence kept in place.
  const fixed = options.fixed ?? locked;
  const heavy = matchedCount + 1;
  const values = new Int32Array(matchedCount);
  const weights = new Float64Array(matchedCount);
  const positions = new Int32Array(matchedCount);
  let k = 0;
  after.forEach((step, a) => {
    const b = match[a] ?? -1;
    if (b < 0) return;
    const original = before[b];
    values[k] = b;
    weights[k] = fixed(step) || (original !== undefined && original !== step && fixed(original)) ? heavy : 1;
    positions[k] = a;
    k += 1;
  });
  const kept = new Uint8Array(after.length);
  for (const position of longestIncreasingSubsequence(values, weights)) kept[positions[position] ?? 0] = 1;

  const ops: DiffOp[] = [];
  before.forEach((step, b) => {
    if (matched[b] === 0) ops.push({ kind: 'remove', stepId: step.id, beforeIndex: b });
  });
  after.forEach((step, a) => {
    const previous = a > 0 ? (after[a - 1]?.id ?? null) : null;
    const b = match[a] ?? -1;
    if (b < 0) ops.push({ kind: 'insert', step, after: previous, afterIndex: a });
    else if (kept[a] === 0) ops.push({ kind: 'move', stepId: before[b]?.id ?? step.id, after: previous, beforeIndex: b, afterIndex: a });
  });
  after.forEach((step, a) => {
    const b = match[a] ?? -1;
    const original = b < 0 ? undefined : before[b];
    if (original === undefined || original === step || structurallyEqual(original, step)) return;
    ops.push({ kind: 'modify', stepId: original.id, before: original, after: step, beforeIndex: b, afterIndex: a });
  });
  return ops;
}

/** The diff of two step lists. Step ids must be unique within each list. */
export function diffRoutes(before: readonly RouteStep[], after: readonly RouteStep[], options: DiffOptions = {}): RouteDiff {
  const ops = stepOps(before, after, options);
  return { ops, changeSets: buildChangeSets({ before, after, ops, relations: options.relations, dependencies: options.dependencies }) };
}

/**
 * The diff of two routes: their steps (`diffRoutes`) and their `groups` sidecar. Group ops follow
 * the step ops (removes in `before.groups` key order, then adds and modifies in `after.groups` key
 * order), each in its own `g:<group id>` change-set. The route's id, name and description are not
 * compared.
 */
export function diffRoute(before: Route, after: Route, options: DiffOptions = {}): RouteDiff {
  const ops = stepOps(before.steps, after.steps, options);
  const groupIdOf = (key: string): GroupId => groupId(key);
  for (const key of Object.keys(before.groups)) {
    const group = before.groups[key];
    if (group !== undefined && !Object.hasOwn(after.groups, key)) ops.push({ kind: 'group-remove', groupId: groupIdOf(key), group });
  }
  const modified: DiffOp[] = [];
  for (const key of Object.keys(after.groups)) {
    const group = after.groups[key];
    if (group === undefined) continue;
    const original = Object.hasOwn(before.groups, key) ? before.groups[key] : undefined;
    if (original === undefined) ops.push({ kind: 'group-add', groupId: groupIdOf(key), group });
    else if (original !== group && !structurallyEqual(original, group)) {
      modified.push({ kind: 'group-modify', groupId: groupIdOf(key), before: original, after: group });
    }
  }
  ops.push(...modified);
  return {
    ops,
    changeSets: buildChangeSets({ before: before.steps, after: after.steps, ops, relations: options.relations, dependencies: options.dependencies }),
  };
}
