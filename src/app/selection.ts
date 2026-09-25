import type { RouteStep, StepId } from '../domain';

/**
 * Route-list selection (docs/ARCHITECTURE.md §12.1). `anchor` is where a shift-click range
 * starts; `focus` is the last step acted on (the keyboard cursor). Both are null or the id of a
 * step in the route; `stepIds` only ever holds ids of steps in the route. Selection is view state:
 * it is never persisted and never enters a command's result.
 */
export interface Selection {
  readonly stepIds: ReadonlySet<StepId>;
  readonly anchor: StepId | null;
  readonly focus: StepId | null;
}

export const EMPTY_SELECTION: Selection = { stepIds: new Set<StepId>(), anchor: null, focus: null };

/**
 * `single`: plain click. `toggle`: ctrl/cmd-click. `range`: shift-click, from the anchor to `id`
 * inclusive (a plain click when there is no anchor). `set`: select exactly these ids.
 */
export type SelectAction =
  | { readonly kind: 'single'; readonly id: StepId }
  | { readonly kind: 'toggle'; readonly id: StepId }
  | { readonly kind: 'range'; readonly id: StepId }
  | { readonly kind: 'set'; readonly ids: readonly StepId[] }
  | { readonly kind: 'all' }
  | { readonly kind: 'none' };

function idsOf(steps: readonly RouteStep[]): Set<StepId> {
  return new Set(steps.map((s) => s.id));
}

function sameIds(a: ReadonlySet<StepId>, b: ReadonlySet<StepId>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

export function sameSelection(a: Selection, b: Selection): boolean {
  return a === b || (a.anchor === b.anchor && a.focus === b.focus && sameIds(a.stepIds, b.stepIds));
}

/** `next`, or `current` itself when they are equal, so unchanged selections keep their identity. */
function keep(current: Selection, next: Selection): Selection {
  return sameSelection(current, next) ? current : next;
}

/** Applies a selection gesture. Ids that are not in `steps` leave the selection unchanged. */
export function applySelect(selection: Selection, steps: readonly RouteStep[], action: SelectAction): Selection {
  switch (action.kind) {
    case 'single': {
      if (!steps.some((s) => s.id === action.id)) return selection;
      return keep(selection, { stepIds: new Set([action.id]), anchor: action.id, focus: action.id });
    }
    case 'toggle': {
      if (!steps.some((s) => s.id === action.id)) return selection;
      const stepIds = new Set(selection.stepIds);
      if (stepIds.has(action.id)) stepIds.delete(action.id);
      else stepIds.add(action.id);
      return keep(selection, { stepIds, anchor: action.id, focus: action.id });
    }
    case 'range': {
      const target = steps.findIndex((s) => s.id === action.id);
      if (target < 0) return selection;
      const anchor = selection.anchor === null ? -1 : steps.findIndex((s) => s.id === selection.anchor);
      if (anchor < 0) return applySelect(selection, steps, { kind: 'single', id: action.id });
      const from = Math.min(anchor, target);
      const to = Math.max(anchor, target);
      const stepIds = new Set(steps.slice(from, to + 1).map((s) => s.id));
      return keep(selection, { stepIds, anchor: selection.anchor, focus: action.id });
    }
    case 'set': {
      const wanted = new Set(action.ids);
      const picked = steps.filter((s) => wanted.has(s.id)).map((s) => s.id);
      const first = picked[0];
      const last = picked.at(-1);
      if (first === undefined || last === undefined) return keep(selection, EMPTY_SELECTION);
      return keep(selection, { stepIds: new Set(picked), anchor: first, focus: last });
    }
    case 'all': {
      const first = steps[0];
      const last = steps.at(-1);
      if (first === undefined || last === undefined) return keep(selection, EMPTY_SELECTION);
      const present = idsOf(steps);
      const valid = (id: StepId | null): id is StepId => id !== null && present.has(id);
      return keep(selection, {
        stepIds: present,
        anchor: valid(selection.anchor) ? selection.anchor : first.id,
        focus: valid(selection.focus) ? selection.focus : last.id,
      });
    }
    case 'none':
      return keep(selection, EMPTY_SELECTION);
  }
}

/** The nearest step of `previous` after the one with `id` that is still `present`, else the nearest before it. */
function neighbour(id: StepId, previous: readonly RouteStep[], present: ReadonlySet<StepId>): StepId | null {
  const at = previous.findIndex((s) => s.id === id);
  if (at < 0) return null;
  for (let i = at + 1; i < previous.length; i += 1) {
    const s = previous[i];
    if (s !== undefined && present.has(s.id)) return s.id;
  }
  for (let i = at - 1; i >= 0; i -= 1) {
    const s = previous[i];
    if (s !== undefined && present.has(s.id)) return s.id;
  }
  return null;
}

/**
 * Drops ids that are no longer in `steps`. When the focused step disappeared and `previous` (the
 * steps before the change) is given, focus moves to its nearest surviving neighbour, after it
 * if possible; a vanished anchor falls back to the focus. Returns `selection` itself when nothing
 * changed.
 */
export function pruneSelection(
  selection: Selection,
  steps: readonly RouteStep[],
  previous: readonly RouteStep[] | null = null,
): Selection {
  const present = idsOf(steps);
  const kept = [...selection.stepIds].filter((id) => present.has(id));
  let focus = selection.focus !== null && present.has(selection.focus) ? selection.focus : null;
  if (focus === null && selection.focus !== null && previous !== null) focus = neighbour(selection.focus, previous, present);
  let anchor = selection.anchor !== null && present.has(selection.anchor) ? selection.anchor : null;
  if (anchor === null && selection.anchor !== null) anchor = focus;
  if (kept.length === selection.stepIds.size && anchor === selection.anchor && focus === selection.focus) return selection;
  return { stepIds: kept.length === selection.stepIds.size ? selection.stepIds : new Set(kept), anchor, focus };
}

/**
 * The selection after a command changed the route from `before` to `after`. Steps the command
 * created (ids new to the route) become the selection, anchored on the first and focused on the
 * last, so an inserted, duplicated or pasted section is ready for the next gesture. Otherwise
 * the selection is pruned, with focus moving to the neighbour of a removed focused step.
 */
export function reconcileSelection(
  selection: Selection,
  before: readonly RouteStep[],
  after: readonly RouteStep[],
): Selection {
  if (before === after) return selection;
  const existing = idsOf(before);
  const created = after.filter((s) => !existing.has(s.id)).map((s) => s.id);
  const first = created[0];
  const last = created.at(-1);
  if (first !== undefined && last !== undefined) {
    return keep(selection, { stepIds: new Set(created), anchor: first, focus: last });
  }
  return pruneSelection(selection, after, before);
}

/** The selected steps in route order. */
export function selectedSteps(steps: readonly RouteStep[], ids: ReadonlySet<StepId>): RouteStep[] {
  return steps.filter((s) => ids.has(s.id));
}
