import {
  type Command,
  deleteSelected,
  duplicateSelected,
  type EditorStore,
  insertGrind,
  insertNote,
  insertTravel,
  type MoveTarget,
  moveSelected,
  toggleLockSelected,
} from '../../app';
import type { StepId } from '../../domain/ids';
import type { RouteStep } from '../../domain/route';
import { formatDurationLong, formatInteger, plural, STEP_KIND_LABELS } from '../kit';
import type { Announce } from './LiveAnnouncer';

/**
 * The route editor's commands as the shell runs them: each dispatches one store command and, when
 * the project changed, announces the result in the live region ("3 steps deleted. Undo with
 * Ctrl+Z."). A command that changed nothing (editing locked, nothing selected, already at the top)
 * says nothing. Plain functions over the store, so they are testable without React.
 */

/** Default grind block for "Insert grind": a planning choice the user edits later, not game data. */
export const DEFAULT_GRIND_SECONDS = 15 * 60;

export const UNDO_HINT = 'Undo with Ctrl+Z.';

export interface RouteActions {
  /** Deletes the steps (default: the selection). True when something was deleted. */
  readonly deleteSteps: (ids?: ReadonlySet<StepId>) => boolean;
  readonly duplicateSteps: (ids?: ReadonlySet<StepId>) => void;
  readonly moveSteps: (target: MoveTarget, ids?: ReadonlySet<StepId>) => void;
  readonly toggleLock: (ids?: ReadonlySet<StepId>) => void;
  readonly insertNote: () => void;
  readonly insertTravel: () => void;
  readonly insertGrind: () => void;
  readonly undo: () => void;
  readonly redo: () => void;
}

/** "step 4" or "steps 4 to 6": the 1-based positions of `ids` in `steps`, as a range. */
function positionsText(steps: readonly RouteStep[], ids: ReadonlySet<StepId>): string | null {
  const positions: number[] = [];
  steps.forEach((step, i) => {
    if (ids.has(step.id)) positions.push(i + 1);
  });
  const first = positions[0];
  const last = positions.at(-1);
  if (first === undefined || last === undefined) return null;
  return first === last ? `step ${formatInteger(first)}` : `steps ${formatInteger(first)} to ${formatInteger(last)}`;
}

function present(steps: readonly RouteStep[], ids: ReadonlySet<StepId>): number {
  return steps.reduce((n, step) => (ids.has(step.id) ? n + 1 : n), 0);
}

/** Steps in `after` that `before` does not have (inserted or duplicated). */
function newSteps(before: readonly RouteStep[], after: readonly RouteStep[]): RouteStep[] {
  const old = new Set(before.map((s) => s.id));
  return after.filter((s) => !old.has(s.id));
}

export function createRouteActions(store: EditorStore, announce: Announce): RouteActions {
  /** Dispatches `command`; when the project changed, announces `describe(before, after)`. */
  const run = (command: Command, describe: (before: readonly RouteStep[], after: readonly RouteStep[]) => string | null): boolean => {
    const { revision, project } = store.getState();
    store.dispatch(command);
    const next = store.getState();
    if (next.revision === revision) return false;
    const message = describe(project.route.steps, next.project.route.steps);
    if (message !== null) announce(message);
    return true;
  };

  const targetOf = (ids: ReadonlySet<StepId> | undefined): ReadonlySet<StepId> => ids ?? store.getState().selection.stepIds;

  const insert = (command: Command) => {
    run(command, (before, after) => {
      const added = newSteps(before, after)[0];
      if (added === undefined) return null;
      const where = positionsText(after, new Set([added.id]));
      return `${STEP_KIND_LABELS[added.kind]} inserted${where === null ? '' : ` as ${where}`}.`;
    });
  };

  const history = (direction: 'undo' | 'redo') => {
    const status = store.getState().history;
    const label = direction === 'undo' ? status.undoLabel : status.redoLabel;
    const { revision } = store.getState();
    if (direction === 'undo') store.undo();
    else store.redo();
    if (store.getState().revision !== revision && label !== null) announce(`${direction === 'undo' ? 'Undone' : 'Redone'}: ${label}.`);
  };

  return {
    deleteSteps: (ids) =>
      run(deleteSelected(ids), (before, after) => `${plural(before.length - after.length, 'step')} deleted. ${UNDO_HINT}`),

    duplicateSteps: (ids) => {
      run(duplicateSelected(ids), (before, after) => {
        const copies = newSteps(before, after);
        const where = positionsText(after, new Set(copies.map((s) => s.id)));
        return `${plural(copies.length, 'step')} duplicated${where === null ? '' : `: the copies are ${where}`}.`;
      });
    },

    moveSteps: (target, ids) => {
      const moving = new Set(targetOf(ids));
      run(moveSelected(target, ids), (_before, after) => {
        const count = present(after, moving);
        const where = positionsText(after, moving);
        const how = 'by' in target ? (target.by < 0 ? ' up' : ' down') : '';
        return `${plural(count, 'step')} moved${how}${where === null ? '' : `: now ${where}`}.`;
      });
    },

    toggleLock: (ids) => {
      const picked = new Set(targetOf(ids));
      run(toggleLockSelected(ids), (_before, after) => {
        const steps = after.filter((s) => picked.has(s.id));
        const locked = steps.every((s) => s.locked);
        return `${plural(steps.length, 'step')} ${locked ? 'locked' : 'unlocked'}.`;
      });
    },

    insertNote: () => {
      insert(insertNote({ text: 'New note' }));
    },
    insertTravel: () => {
      insert(insertTravel());
    },
    insertGrind: () => {
      insert(insertGrind({ until: { kind: 'duration', seconds: DEFAULT_GRIND_SECONDS } }));
    },

    undo: () => {
      history('undo');
    },
    redo: () => {
      history('redo');
    },
  };
}

/** The Insert grind button's tooltip. */
export const INSERT_GRIND_TITLE = `Insert a grind step (${formatDurationLong(DEFAULT_GRIND_SECONDS)}) after the selection`;
