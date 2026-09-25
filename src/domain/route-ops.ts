import { type GroupId, type IdSource, type StepId, stepId } from './ids';
import type { Route, RouteGroup, RouteStep, StepOrigin } from './route';

/**
 * Pure route operations (docs/ARCHITECTURE.md §8.1). Every function returns a new array or object
 * and never mutates its input; steps that do not change keep their identity, so snapshots share
 * structure. A "section" is any set of step ids; positions follow route order, never the order of
 * the set. Indices are clamped to the valid range.
 */

/** The common fields an edit may change. `kind` and the kind's payload never change here. */
export type StepPatch = Partial<Pick<RouteStep, 'note' | 'location' | 'locked' | 'durationOverride' | 'condition'>>;

function clampIndex(index: number, length: number): number {
  if (Number.isNaN(index)) return length;
  return Math.min(Math.max(Math.trunc(index), 0), length);
}

function assertUniqueIds(existing: readonly RouteStep[], add: readonly RouteStep[]): void {
  const seen = new Set<StepId>(existing.map((s) => s.id));
  for (const step of add) {
    if (seen.has(step.id)) throw new Error(`Duplicate step id ${step.id}`);
    seen.add(step.id);
  }
}

/** Inserts `add` before position `index` (so `steps.length` appends). Throws on a duplicate id. */
export function insertSteps(steps: readonly RouteStep[], index: number, add: readonly RouteStep[]): RouteStep[] {
  assertUniqueIds(steps, add);
  const at = clampIndex(index, steps.length);
  return [...steps.slice(0, at), ...add, ...steps.slice(at)];
}

export function removeSteps(steps: readonly RouteStep[], ids: ReadonlySet<StepId>): RouteStep[] {
  return steps.filter((s) => !ids.has(s.id));
}

/** Sorted indices of the selected steps; ids not in the route are ignored. */
export function selectionIndices(steps: readonly RouteStep[], ids: ReadonlySet<StepId>): number[] {
  const out: number[] = [];
  steps.forEach((s, i) => {
    if (ids.has(s.id)) out.push(i);
  });
  return out;
}

function partition(
  steps: readonly RouteStep[],
  ids: ReadonlySet<StepId>,
): { readonly picked: RouteStep[]; readonly rest: RouteStep[] } {
  const picked: RouteStep[] = [];
  const rest: RouteStep[] = [];
  for (const s of steps) (ids.has(s.id) ? picked : rest).push(s);
  return { picked, rest };
}

/**
 * Moves the selected steps, as one block in their route order, to position `toIndex` of the
 * array without them. Non-contiguous selections are gathered.
 */
export function moveSteps(steps: readonly RouteStep[], ids: ReadonlySet<StepId>, toIndex: number): RouteStep[] {
  const { picked, rest } = partition(steps, ids);
  if (picked.length === 0) return [...steps];
  const at = clampIndex(toIndex, rest.length);
  return [...rest.slice(0, at), ...picked, ...rest.slice(at)];
}

/**
 * Moves the selection `delta` places (negative is up): the gathered block starts `delta` places
 * from where the first selected step was. For keyboard reordering.
 */
export function moveStepsBy(steps: readonly RouteStep[], ids: ReadonlySet<StepId>, delta: number): RouteStep[] {
  const first = selectionIndices(steps, ids)[0];
  if (first === undefined) return [...steps];
  return moveSteps(steps, ids, first + delta);
}

/**
 * A copy of `step` under a new id. The copy has no RXP source line (only the original owns it),
 * keeps the `>>` text and group, and records where it came from.
 */
function copyStep(step: RouteStep, ids: IdSource, source: StepOrigin['source']): RouteStep {
  const text = step.rxp?.text ?? null;
  return {
    ...step,
    id: stepId(ids.next('step')),
    origin: { source, ref: step.id },
    rxp: text === null ? null : { text, line: null },
  };
}

/** Copies the selected steps, in route order, directly after the last selected step. */
export function duplicateSteps(
  steps: readonly RouteStep[],
  ids: ReadonlySet<StepId>,
  idSource: IdSource,
): { steps: RouteStep[]; created: StepId[] } {
  const last = selectionIndices(steps, ids).at(-1);
  if (last === undefined) return { steps: [...steps], created: [] };
  const copies = partition(steps, ids).picked.map((s) => copyStep(s, idSource, 'duplicate'));
  return { steps: insertSteps(steps, last + 1, copies), created: copies.map((s) => s.id) };
}

export function setLocked(steps: readonly RouteStep[], ids: ReadonlySet<StepId>, locked: boolean): RouteStep[] {
  return steps.map((s) => (ids.has(s.id) && s.locked !== locked ? { ...s, locked } : s));
}

/** Applies `patch` to the step `id`; an unknown id leaves the route unchanged. */
export function updateStep(steps: readonly RouteStep[], id: StepId, patch: StepPatch): RouteStep[] {
  return steps.map((s) => {
    if (s.id !== id) return s;
    // Copy only the patchable keys, so an untyped caller cannot smuggle in `kind` or `id`.
    return {
      ...s,
      note: patch.note !== undefined ? patch.note : s.note,
      location: patch.location !== undefined ? patch.location : s.location,
      locked: patch.locked ?? s.locked,
      durationOverride: patch.durationOverride !== undefined ? patch.durationOverride : s.durationOverride,
      condition: patch.condition !== undefined ? patch.condition : s.condition,
    };
  });
}

/** Removes the selected steps; the clipboard holds them, unchanged, in route order. */
export function cutSection(
  steps: readonly RouteStep[],
  ids: ReadonlySet<StepId>,
): { steps: RouteStep[]; clipboard: RouteStep[] } {
  const { picked, rest } = partition(steps, ids);
  return { steps: rest, clipboard: picked };
}

/**
 * Inserts copies of the clipboard before position `index`, with fresh ids and origin `paste`.
 * Copies keep their `groupId`; a caller that pruned the group meanwhile should restore it.
 */
export function pasteSection(
  steps: readonly RouteStep[],
  index: number,
  clipboard: readonly RouteStep[],
  idSource: IdSource,
): { steps: RouteStep[]; created: StepId[] } {
  const copies = clipboard.map((s) => copyStep(s, idSource, 'paste'));
  return { steps: insertSteps(steps, index, copies), created: copies.map((s) => s.id) };
}

/**
 * Moves the steps of `second` (in route order) to directly follow the last step of `first`.
 * Steps in both sets stay where they are. Unchanged when either section is empty.
 */
export function joinSections(
  steps: readonly RouteStep[],
  first: ReadonlySet<StepId>,
  second: ReadonlySet<StepId>,
): RouteStep[] {
  const moving = new Set<StepId>();
  for (const s of steps) if (second.has(s.id) && !first.has(s.id)) moving.add(s.id);
  const { picked, rest } = partition(steps, moving);
  const anchor = selectionIndices(rest, first).at(-1);
  if (anchor === undefined || picked.length === 0) return [...steps];
  return [...rest.slice(0, anchor + 1), ...picked, ...rest.slice(anchor + 1)];
}

/**
 * The group `id` names, or null when `id` is null or the route has no such group. `groups` is a
 * plain object keyed by ids from files, so a lookup must use own keys only: `groups[id]` would
 * return an Object.prototype member for an id such as `toString` or `constructor`.
 */
export function routeGroup(route: Pick<Route, 'groups'>, id: GroupId | null): RouteGroup | null {
  if (id === null || !Object.hasOwn(route.groups, id)) return null;
  return route.groups[id] ?? null;
}

/** Drops groups that no step references, keeping the others in their key order. */
export function pruneGroups(route: Route): Route {
  const used = new Set<string>();
  for (const s of route.steps) if (s.groupId !== null) used.add(s.groupId);
  // fromEntries defines own properties, so no key (not even `__proto__`) reaches a setter.
  const groups: Readonly<Record<string, RouteGroup>> = Object.fromEntries(
    Object.entries(route.groups).filter(([key]) => used.has(key)),
  );
  return { ...route, groups };
}
