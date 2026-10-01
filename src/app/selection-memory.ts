import type { ProjectId, StepId } from '../domain/ids';
import type { RouteStep } from '../domain/route';
import type { EditorStore } from './store';

/**
 * The step selected when a project opens (D-050 item 2; review UI-08): the step last selected in
 * that project in this browser, else the route's last step, so the panels and the map start at a
 * step instead of in their no-selection form.
 *
 * The last focus is a per-browser convenience, like the shell's preferences (`ui/app/view-prefs.ts`):
 * not in the project file (schema v1 is frozen, D-035), not exported, not undone. It is one
 * `localStorage` record holding the most recently used projects' last focus steps, at most
 * `SELECTION_MEMORY_LIMIT` of them. Every access is guarded: a private window, blocked storage or a
 * quota error only means the last step is selected next time. A remembered step that has left the
 * route is ignored.
 */

export const SELECTION_MEMORY_KEY = 'forever-route-lab:selection';

/** Projects whose last focus is kept (the most recently used first). */
export const SELECTION_MEMORY_LIMIT = 50;

/** What the memory needs of `Storage`. */
export interface SelectionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The stored record: project id and step id pairs, the most recently used first. */
interface MemoryRecord {
  readonly v: 1;
  readonly last: readonly (readonly [string, string])[];
}

function readRecord(storage: () => SelectionStorage | null): readonly (readonly [string, string])[] {
  let raw: unknown;
  try {
    const text = storage()?.getItem(SELECTION_MEMORY_KEY) ?? null;
    raw = text === null ? null : JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof raw !== 'object' || raw === null || (raw as { v?: unknown }).v !== 1) return [];
  const last = (raw as { last?: unknown }).last;
  if (!Array.isArray(last)) return [];
  return last.flatMap((entry: unknown) =>
    Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' && typeof entry[1] === 'string' ? [[entry[0], entry[1]] as const] : [],
  );
}

/** The step last selected in `project` in this browser, or null. */
export function rememberedStep(storage: () => SelectionStorage | null, project: ProjectId): StepId | null {
  const found = readRecord(storage).find(([id]) => id === project);
  return found === undefined ? null : (found[1] as StepId);
}

/** Records `step` as the last selected in `project`; a storage that refuses keeps nothing. */
export function rememberStep(storage: () => SelectionStorage | null, project: ProjectId, step: StepId): void {
  const others = readRecord(storage).filter(([id]) => id !== project);
  const first: readonly [string, string] = [project, step];
  const record: MemoryRecord = { v: 1, last: [first, ...others].slice(0, SELECTION_MEMORY_LIMIT) };
  try {
    storage()?.setItem(SELECTION_MEMORY_KEY, JSON.stringify(record));
  } catch {
    // Not stored: the last step is selected when the project next opens.
  }
}

/** The step to select when a project opens: the remembered one while it is in the route, else the last step; null for an empty route. */
export function openingStep(steps: readonly RouteStep[], remembered: StepId | null): StepId | null {
  if (remembered !== null && steps.some((step) => step.id === remembered)) return remembered;
  return steps[steps.length - 1]?.id ?? null;
}

/**
 * Selects the opening step of the store's project now and of every project that replaces it (a
 * project opened, imported or started from the Projects menu: a new project id), and remembers
 * each focus step the user moves to. A project that opens with a selection keeps it. Returns the
 * unsubscribe function.
 */
export function followSelection(store: EditorStore, storage: () => SelectionStorage | null): () => void {
  let project: ProjectId | null = null;
  let focus: StepId | null = null;
  const onChange = (): void => {
    const state = store.getState();
    if (state.project.id !== project) {
      project = state.project.id;
      focus = state.selection.focus;
      if (focus !== null) return;
      const step = openingStep(state.project.route.steps, rememberedStep(storage, project));
      // Selecting notifies again; that call sees the new focus and remembers it.
      if (step !== null) store.select({ kind: 'single', id: step });
      return;
    }
    const next = state.selection.focus;
    if (next === focus) return;
    focus = next;
    if (next !== null) rememberStep(storage, state.project.id, next);
  };
  const unsubscribe = store.subscribe(onChange);
  onChange();
  return unsubscribe;
}
