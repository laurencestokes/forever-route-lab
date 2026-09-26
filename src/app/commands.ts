import {
  type IdSource,
  type Location,
  type ProjectV1,
  type Route,
  type RouteGroup,
  type RouteStep,
  type StepId,
  type StepPatch,
  cutSection,
  duplicateSteps,
  insertSteps,
  joinSections as joinStepSections,
  makeGrindStep,
  makeNoteStep,
  makeTravelStep,
  moveSteps,
  moveStepsBy,
  pasteSection,
  pruneGroups,
  removeSteps,
  routeGroup,
  selectionIndices,
  setLocked,
  updateStep,
} from '../domain';
import { EMPTY_SELECTION, type Selection, selectedSteps } from './selection';

/**
 * Commands (docs/ARCHITECTURE.md §12.2): every project mutation is a command with a label and a
 * pure `apply`. A command that changes nothing returns the project object it was given, which the
 * store treats as a no-op (no revision, no history entry). Commands never read the clock or make
 * ids themselves: both come from the context.
 */

/** Steps cut or copied, with the groups they reference so a paste can restore a pruned group. */
export interface Clipboard {
  readonly steps: readonly RouteStep[];
  /** Keyed by GroupId, like Route.groups. */
  readonly groups: Readonly<Record<string, RouteGroup>>;
}

export const EMPTY_CLIPBOARD: Clipboard = { steps: [], groups: {} };

export interface CommandContext {
  readonly ids: IdSource;
  readonly nowIso: string;
  /** The selection at dispatch. Absent means nothing is selected. */
  readonly selection?: Selection;
  /** The store's clipboard at dispatch. Absent means it is empty. */
  readonly clipboard?: Clipboard;
}

export interface Command {
  /** Shown as "Undo <label>" / "Redo <label>". */
  readonly label: string;
  /** Consecutive commands with the same key merge into one undo entry (typing, held-key moves). */
  readonly coalesceKey?: string;
  /**
   * True for a command that never changes the project and only sets the clipboard (copy). The
   * store runs it while editing is locked, never calls its `apply`, and records no history.
   */
  readonly clipboardOnly?: boolean;
  apply(project: ProjectV1, ctx: CommandContext): ProjectV1;
  /**
   * Optional clipboard effect, computed from the project before `apply`. A non-null result
   * replaces the store's clipboard; null leaves it alone.
   */
  copy?(project: ProjectV1, ctx: CommandContext): Clipboard | null;
}

// Helpers --------------------------------------------------------------------------------------

const NO_IDS: ReadonlySet<StepId> = new Set<StepId>();

/** The explicit ids, else the selection at dispatch. */
function targetIds(ids: ReadonlySet<StepId> | undefined, ctx: CommandContext): ReadonlySet<StepId> {
  return ids ?? ctx.selection?.stepIds ?? NO_IDS;
}

function sameElements(a: readonly RouteStep[], b: readonly RouteStep[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/** `project` with `route`, or `project` itself when the route is unchanged. */
function withRoute(project: ProjectV1, route: Route): ProjectV1 {
  return route === project.route ? project : { ...project, route };
}

/** `route` with `steps`, or `route` itself when the step list is element-for-element the same. */
function withSteps(route: Route, steps: readonly RouteStep[]): Route {
  return sameElements(steps, route.steps) ? route : { ...route, steps };
}

/** pruneGroups, keeping the groups object (and the route) when no group was dropped. */
function prunedRoute(route: Route): Route {
  const pruned = pruneGroups(route);
  return Object.keys(pruned.groups).length === Object.keys(route.groups).length ? route : pruned;
}

/**
 * Where an insertion lands when the caller gives no index: after the last selected step, else
 * after the focused step, else at the end of the route.
 */
export function insertionIndex(steps: readonly RouteStep[], selection: Selection = EMPTY_SELECTION): number {
  const last = selectionIndices(steps, selection.stepIds).at(-1);
  if (last !== undefined) return last + 1;
  if (selection.focus !== null) {
    const focus = steps.findIndex((s) => s.id === selection.focus);
    if (focus >= 0) return focus + 1;
  }
  return steps.length;
}

function resolveIndex(at: number | null, steps: readonly RouteStep[], ctx: CommandContext): number {
  return at ?? insertionIndex(steps, ctx.selection);
}

function clipboardOf(route: Route, ids: ReadonlySet<StepId>): Clipboard | null {
  const steps = selectedSteps(route.steps, ids);
  if (steps.length === 0) return null;
  const groups = new Map<string, RouteGroup>();
  for (const s of steps) {
    if (s.groupId === null || groups.has(s.groupId)) continue;
    const group = routeGroup(route, s.groupId);
    if (group !== null) groups.set(s.groupId, group);
  }
  // fromEntries defines own properties, so no group id reaches an Object.prototype setter.
  return { steps, groups: Object.fromEntries(groups) };
}

// Insertion ------------------------------------------------------------------------------------

/**
 * Inserts the step `make` builds (with the context's IdSource) at `at`, or after the selection
 * when `at` is null. The new step becomes the selection.
 */
export function insertStep(make: (ids: IdSource) => RouteStep, at: number | null = null, label = 'Insert step'): Command {
  return {
    label,
    apply(project, ctx) {
      const steps = project.route.steps;
      return withRoute(project, withSteps(project.route, insertSteps(steps, resolveIndex(at, steps, ctx), [make(ctx.ids)])));
    },
  };
}

type NoteFields = Parameters<typeof makeNoteStep>[1];
type TravelFields = NonNullable<Parameters<typeof makeTravelStep>[1]>;
type GrindFields = Parameters<typeof makeGrindStep>[1];

export function insertNote(fields: NoteFields, at: number | null = null): Command {
  return insertStep((ids) => makeNoteStep(ids, fields), at, 'Insert note');
}

export function insertTravel(fields: TravelFields = {}, at: number | null = null): Command {
  return insertStep((ids) => makeTravelStep(ids, fields), at, 'Insert travel');
}

export function insertGrind(fields: GrindFields, at: number | null = null): Command {
  return insertStep((ids) => makeGrindStep(ids, fields), at, 'Insert grind');
}

// Selection-based edits ------------------------------------------------------------------------
// Each takes explicit ids or, when they are omitted, acts on the selection at dispatch.

/** Deletes the steps and drops groups no remaining step references. */
export function deleteSelected(ids?: ReadonlySet<StepId>): Command {
  return {
    label: 'Delete steps',
    apply(project, ctx) {
      const route = withSteps(project.route, removeSteps(project.route.steps, targetIds(ids, ctx)));
      return route === project.route ? project : withRoute(project, prunedRoute(route));
    },
  };
}

export type MoveTarget =
  /** Places up (negative) or down; held-key moves of this kind coalesce. */
  | { readonly by: number }
  /** Position in the step list without the moved steps (a drop target). */
  | { readonly toIndex: number };

/** Moves the steps as one block in route order (non-contiguous selections are gathered). */
export function moveSelected(target: MoveTarget, ids?: ReadonlySet<StepId>): Command {
  const move = (steps: readonly RouteStep[], picked: ReadonlySet<StepId>): RouteStep[] =>
    'by' in target ? moveStepsBy(steps, picked, target.by) : moveSteps(steps, picked, target.toIndex);
  return {
    label: 'Move steps',
    ...('by' in target ? { coalesceKey: 'move-steps' } : {}),
    apply(project, ctx) {
      return withRoute(project, withSteps(project.route, move(project.route.steps, targetIds(ids, ctx))));
    },
  };
}

/** Copies the steps directly after the last of them; the copies become the selection. */
export function duplicateSelected(ids?: ReadonlySet<StepId>): Command {
  return {
    label: 'Duplicate steps',
    apply(project, ctx) {
      const { steps } = duplicateSteps(project.route.steps, targetIds(ids, ctx), ctx.ids);
      return withRoute(project, withSteps(project.route, steps));
    },
  };
}

export function setLockedSelected(locked: boolean, ids?: ReadonlySet<StepId>): Command {
  return {
    label: locked ? 'Lock steps' : 'Unlock steps',
    apply(project, ctx) {
      return withRoute(project, withSteps(project.route, setLocked(project.route.steps, targetIds(ids, ctx), locked)));
    },
  };
}

/** Unlocks the steps when all of them are locked, otherwise locks them all. */
export function toggleLockSelected(ids?: ReadonlySet<StepId>): Command {
  return {
    label: 'Toggle lock',
    apply(project, ctx) {
      const picked = selectedSteps(project.route.steps, targetIds(ids, ctx));
      if (picked.length === 0) return project;
      const locked = !picked.every((s) => s.locked);
      return setLockedSelected(locked, ids).apply(project, ctx);
    },
  };
}

/** Removes the steps onto the store's clipboard (groups left unreferenced are dropped). */
export function cutSelected(ids?: ReadonlySet<StepId>): Command {
  return {
    label: 'Cut steps',
    copy: (project, ctx) => clipboardOf(project.route, targetIds(ids, ctx)),
    apply(project, ctx) {
      const route = withSteps(project.route, cutSection(project.route.steps, targetIds(ids, ctx)).steps);
      return route === project.route ? project : withRoute(project, prunedRoute(route));
    },
  };
}

/**
 * Puts the steps on the clipboard without changing the project: no undo entry, and allowed while
 * editing is locked (clipboardOnly).
 */
export function copySelected(ids?: ReadonlySet<StepId>): Command {
  return {
    label: 'Copy steps',
    clipboardOnly: true,
    copy: (project, ctx) => clipboardOf(project.route, targetIds(ids, ctx)),
    apply: (project) => project,
  };
}

/**
 * Inserts fresh copies of the clipboard at `at`, or after the selection when `at` is null; the
 * copies become the selection. A group the clipboard steps reference that the route no longer
 * has (pruned by the cut) is restored from the clipboard; an existing group is left as it is.
 */
export function paste(at: number | null = null): Command {
  return {
    label: 'Paste steps',
    apply(project, ctx) {
      const clipboard = ctx.clipboard ?? EMPTY_CLIPBOARD;
      if (clipboard.steps.length === 0) return project;
      const route = project.route;
      const { steps } = pasteSection(route.steps, resolveIndex(at, route.steps, ctx), clipboard.steps, ctx.ids);
      let groups = route.groups;
      for (const s of clipboard.steps) {
        if (s.groupId === null || routeGroup({ groups }, s.groupId) !== null) continue;
        const group = routeGroup(clipboard, s.groupId);
        // A computed key in a literal defines an own property, even for `__proto__`.
        if (group !== null) groups = { ...groups, [s.groupId]: group };
      }
      return withRoute(project, { ...route, steps, groups });
    },
  };
}

/** Moves the `second` section to directly follow the last step of `first`. */
export function joinSections(first: ReadonlySet<StepId>, second: ReadonlySet<StepId>): Command {
  return {
    label: 'Join sections',
    apply(project) {
      return withRoute(project, withSteps(project.route, joinStepSections(project.route.steps, first, second)));
    },
  };
}

/**
 * The contiguous runs of `ids` in route order (ids not in the route are ignored): the sections a
 * multi-selection is made of.
 */
export function selectionRuns(steps: readonly RouteStep[], ids: ReadonlySet<StepId>): StepId[][] {
  const runs: StepId[][] = [];
  let current: StepId[] | null = null;
  for (const step of steps) {
    if (!ids.has(step.id)) {
      current = null;
      continue;
    }
    if (current === null) {
      current = [];
      runs.push(current);
    }
    current.push(step.id);
  }
  return runs;
}

/**
 * Joins the sections of a selection (ARCHITECTURE §8.1): every later run of selected steps moves,
 * in route order, to directly follow the first run. With fewer than two runs nothing changes.
 */
export function joinSelectedSections(ids?: ReadonlySet<StepId>): Command {
  return {
    label: 'Join sections',
    apply(project, ctx) {
      const [first, ...rest] = selectionRuns(project.route.steps, targetIds(ids, ctx));
      if (first === undefined || rest.length === 0) return project;
      return joinSections(new Set(first), new Set(rest.flat())).apply(project, ctx);
    },
  };
}

// Field edits ----------------------------------------------------------------------------------

export function renameRoute(name: string): Command {
  return {
    label: 'Rename route',
    coalesceKey: 'rename-route',
    apply(project) {
      return name === project.route.name ? project : withRoute(project, { ...project.route, name });
    },
  };
}

/**
 * Applies `patch` to one step. Values equal (by identity) to the current ones change nothing, so
 * a patch that restates the step is a no-op. An unknown id is a no-op.
 */
export function patchStep(id: StepId, patch: StepPatch, opts: { readonly label?: string; readonly coalesceKey?: string } = {}): Command {
  return {
    label: opts.label ?? 'Edit step',
    ...(opts.coalesceKey === undefined ? {} : { coalesceKey: opts.coalesceKey }),
    apply(project) {
      const step = project.route.steps.find((s) => s.id === id);
      if (step === undefined) return project;
      const changes = (Object.keys(patch) as (keyof StepPatch)[]).some(
        (key) => patch[key] !== undefined && !Object.is(patch[key], step[key]),
      );
      if (!changes) return project;
      return withRoute(project, withSteps(project.route, updateStep(project.route.steps, id, patch)));
    },
  };
}

/** Sets a step's note; an empty string clears it (null). Typing into one note coalesces. */
export function updateStepNote(id: StepId, note: string | null): Command {
  return patchStep(id, { note: note === '' ? null : note }, { label: 'Edit note', coalesceKey: `step-note:${id}` });
}

/** Sets or clears (null) a step's location. */
export function setStepLocation(id: StepId, location: Location | null): Command {
  return patchStep(id, { location }, { label: location === null ? 'Clear location' : 'Set location' });
}

/**
 * Sets a step's duration override in seconds, or clears it (null: the estimate applies). Only a
 * finite, non-negative number is an override (the schema's rule); anything else changes nothing.
 */
export function setDurationOverride(id: StepId, seconds: number | null): Command {
  if (seconds !== null && !(Number.isFinite(seconds) && seconds >= 0)) {
    return { label: 'Set duration', apply: (project) => project };
  }
  return patchStep(id, { durationOverride: seconds }, { label: seconds === null ? 'Clear duration' : 'Set duration' });
}
