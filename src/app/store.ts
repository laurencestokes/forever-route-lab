import type { IdSource, ProjectV1 } from '../domain';
import { type Clock, parseIsoMs } from './clock';
import { type Clipboard, type Command, type CommandContext, EMPTY_CLIPBOARD } from './commands';
import {
  closeCoalescing,
  DEFAULT_HISTORY_LIMITS,
  EMPTY_HISTORY,
  type History,
  type HistoryLimits,
  type HistoryMove,
  recordChange,
  redoHistory,
  undoHistory,
} from './history';
import { collisionFreeIds } from './ids';
import { DEFAULT_MAP_UI, type MapUiState, type OpenedQuests } from './map-view';
import { applySelect, EMPTY_SELECTION, pruneSelection, reconcileSelection, type SelectAction, type Selection } from './selection';

/**
 * The editor store (docs/ARCHITECTURE.md §12.1): one immutable EditorState, replaced on every
 * change and read by React through useSyncExternalStore (src/app/react.ts). Framework-agnostic.
 */

export type RightTab = 'available' | 'context' | 'details' | 'validation';
export type ThemePreference = 'system' | 'light' | 'dark';

export interface ViewState {
  readonly rightTab: RightTab;
  readonly theme: ThemePreference;
  readonly showLayerPanel: boolean;
  /** The map's view state (src/app/map-view.ts): surface, zoom band, visible layers, last zone (hover is the map controller's). */
  readonly map: MapUiState;
  /** Quests opened in Details from the map or the Available tab, with the selection they belong to. */
  readonly openedQuests: OpenedQuests | null;
}

export const DEFAULT_VIEW: ViewState = { rightTab: 'available', theme: 'system', showLayerPanel: false, map: DEFAULT_MAP_UI, openedQuests: null };

/** Every ViewState key (the `satisfies` makes a new key a compile error until it is listed). */
const VIEW_KEYS = Object.keys({
  rightTab: true,
  theme: true,
  showLayerPanel: true,
  map: true,
  openedQuests: true,
} satisfies Record<keyof ViewState, true>) as readonly (keyof ViewState)[];

/**
 * Why route editing is locked (§12.1): an optimiser run is active, or a proposal is open. Each
 * holder takes and releases its own lock, so ending one never unlocks editing for the other.
 */
export type EditLockReason = 'optimizer' | 'proposal';

export const NO_LOCKS: ReadonlySet<EditLockReason> = new Set<EditLockReason>();

/** What the undo and redo controls show. Both are unavailable while editing is locked. */
export interface HistoryStatus {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  readonly undoDepth: number;
  readonly redoDepth: number;
}

export interface EditorState {
  readonly project: ProjectV1;
  /** Monotonic; +1 on every project change (command, undo, redo, replace). Not persisted. */
  readonly revision: number;
  readonly selection: Selection;
  readonly view: ViewState;
  /** The edit locks held (§12.1). A new set on every change; never mutated. */
  readonly locks: ReadonlySet<EditLockReason>;
  /**
   * Derived: `locks.size > 0`. While true, only clipboard-only commands run (copy), undo and redo
   * are unavailable, and replaceProject is refused.
   */
  readonly editingLocked: boolean;
  /** Cut or copied steps; not persisted and not part of undo history. */
  readonly clipboard: Clipboard;
  readonly history: HistoryStatus;
}

export type { SelectAction };

/**
 * Members are function-typed properties, not methods: none of them uses `this`, so they can be
 * passed around unbound (`useSyncExternalStore(store.subscribe, ...)`, `onClick={store.undo}`).
 */
export interface EditorStore {
  /** The same object until something changes. */
  readonly getState: () => EditorState;
  /** Calls `listener` after every state change; returns the unsubscribe function. */
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Applies a command. A no-op when the command returns the project it was given, and while
   * editing is locked unless the command is clipboard-only (copy). A command that changes only
   * the clipboard ends the open coalescing group. The command's ids never collide with ids in the
   * project.
   */
  readonly dispatch: (command: Command) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly canUndo: () => boolean;
  readonly canRedo: () => boolean;
  readonly select: (action: SelectAction) => void;
  /**
   * Merges `patch` into the view state. A patch whose every field is the same value (by
   * `Object.is`) changes nothing and notifies nobody; build nested values such as `map` with
   * `patchMapUi`, which keeps the current object when nothing in it changes.
   */
  readonly setView: (patch: Partial<ViewState>) => void;
  /**
   * Swaps in another project (load, import): clears history, selection and clipboard, and keeps
   * the project's updatedAt. Refused while any edit lock is held, so a load cannot swap the project
   * under an open proposal or optimiser run: returns false and changes nothing. The caller ends
   * the run or rejects the proposal first. Returns true otherwise.
   */
  readonly replaceProject: (project: ProjectV1) => boolean;
  /** Takes the edit lock for `reason`. Taking a lock already held changes nothing. */
  readonly acquireLock: (reason: EditLockReason) => void;
  /** Releases the edit lock for `reason`; editing unlocks once no lock is held. */
  readonly releaseLock: (reason: EditLockReason) => void;
  /** Ends the open coalescing group (for example when a text field loses focus). */
  readonly breakCoalescing: () => void;
}

export interface EditorStoreOptions {
  readonly project: ProjectV1;
  readonly ids: IdSource;
  readonly clock: Clock;
  /** Maximum undo entries, default 200. */
  readonly historyLimit?: number;
  /** Approximate byte bound on undo history, default 32 MiB (see DEFAULT_HISTORY_LIMITS). */
  readonly historyMaxBytes?: number;
  /** Coalescing window in ms, default 1000; null for no time limit. */
  readonly coalesceWindowMs?: number | null;
  readonly view?: Partial<ViewState>;
}

function checkCount(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  return value;
}

function limitsFrom(opts: EditorStoreOptions): HistoryLimits {
  const window = opts.coalesceWindowMs === undefined ? DEFAULT_HISTORY_LIMITS.coalesceWindowMs : opts.coalesceWindowMs;
  if (window !== null && !(window >= 0)) throw new RangeError(`coalesceWindowMs must be >= 0 or null, got ${window}`);
  const maxBytes = opts.historyMaxBytes ?? DEFAULT_HISTORY_LIMITS.maxBytes;
  if (!(maxBytes >= 0)) throw new RangeError(`historyMaxBytes must be >= 0, got ${maxBytes}`);
  return {
    maxEntries: checkCount('historyLimit', opts.historyLimit ?? DEFAULT_HISTORY_LIMITS.maxEntries),
    maxBytes,
    coalesceWindowMs: window,
  };
}

function sameStatus(a: HistoryStatus, b: HistoryStatus): boolean {
  return (
    a.canUndo === b.canUndo &&
    a.canRedo === b.canRedo &&
    a.undoLabel === b.undoLabel &&
    a.redoLabel === b.redoLabel &&
    a.undoDepth === b.undoDepth &&
    a.redoDepth === b.redoDepth
  );
}

export function createEditorStore(opts: EditorStoreOptions): EditorStore {
  const { ids, clock } = opts;
  const limits = limitsFrom(opts);
  const listeners = new Set<() => void>();
  let history: History = EMPTY_HISTORY;

  function statusOf(h: History, locked: boolean, previous: HistoryStatus | null): HistoryStatus {
    const undo = locked ? undefined : h.past.at(-1);
    const redo = locked ? undefined : h.future.at(-1);
    const next: HistoryStatus = {
      canUndo: undo !== undefined,
      canRedo: redo !== undefined,
      undoLabel: undo?.label ?? null,
      redoLabel: redo?.label ?? null,
      undoDepth: h.past.length,
      redoDepth: h.future.length,
    };
    return previous !== null && sameStatus(previous, next) ? previous : next;
  }

  let state: EditorState = {
    project: opts.project,
    revision: 0,
    selection: EMPTY_SELECTION,
    view: { ...DEFAULT_VIEW, ...opts.view },
    locks: NO_LOCKS,
    editingLocked: false,
    clipboard: EMPTY_CLIPBOARD,
    history: statusOf(history, false, null),
  };

  /** Publishes `patch` over the current state, with editingLocked and the history status derived. */
  function commit(patch: Partial<Omit<EditorState, 'editingLocked' | 'history'>>): void {
    const locks = patch.locks ?? state.locks;
    const editingLocked = locks.size > 0;
    state = { ...state, ...patch, locks, editingLocked, history: statusOf(history, editingLocked, state.history) };
    for (const listener of [...listeners]) listener();
  }

  function setLock(reason: EditLockReason, held: boolean): void {
    if (state.locks.has(reason) === held) return;
    const locks = new Set(state.locks);
    if (held) locks.add(reason);
    else locks.delete(reason);
    history = closeCoalescing(history);
    commit({ locks });
  }

  function restore(move: HistoryMove | null): void {
    if (move === null) return;
    history = move.history;
    const project: ProjectV1 = { ...move.restored.project, updatedAt: clock.nowIso() };
    commit({ project, revision: state.revision + 1, selection: pruneSelection(move.restored.selection, project.route.steps) });
  }

  const present = () => ({ project: state.project, selection: state.selection });

  return {
    getState: () => state,

    subscribe(listener) {
      const entry = () => listener();
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },

    dispatch(command) {
      const clipboardOnly = command.clipboardOnly === true;
      if (state.editingLocked && !clipboardOnly) return;
      const nowIso = clock.nowIso();
      const before = state.project;
      const ctx: CommandContext = {
        ids: collisionFreeIds(ids, before),
        nowIso,
        selection: state.selection,
        clipboard: state.clipboard,
      };
      const copied = command.copy?.(before, ctx) ?? null;
      const applied = clipboardOnly ? before : command.apply(before, ctx);
      const clipboard = copied ?? state.clipboard;
      if (applied === before) {
        if (clipboard === state.clipboard) return;
        // Typing, copying, then typing again is two undo entries, not one.
        history = closeCoalescing(history);
        commit({ clipboard });
        return;
      }
      const project: ProjectV1 = { ...applied, updatedAt: nowIso };
      history = recordChange(
        history,
        { before: present(), after: project, label: command.label, coalesceKey: command.coalesceKey ?? null, atMs: parseIsoMs(nowIso) },
        limits,
      );
      commit({
        project,
        revision: state.revision + 1,
        selection: reconcileSelection(state.selection, before.route.steps, project.route.steps),
        clipboard,
      });
    },

    undo() {
      if (!state.editingLocked) restore(undoHistory(history, present()));
    },

    redo() {
      if (!state.editingLocked) restore(redoHistory(history, present()));
    },

    canUndo: () => state.history.canUndo,
    canRedo: () => state.history.canRedo,

    select(action) {
      const selection = applySelect(state.selection, state.project.route.steps, action);
      if (selection === state.selection) return;
      history = closeCoalescing(history);
      commit({ selection });
    },

    setView(patch) {
      const view = { ...state.view, ...patch };
      const current = state.view;
      if (VIEW_KEYS.every((key) => Object.is(view[key], current[key]))) return;
      commit({ view });
    },

    replaceProject(project) {
      if (state.editingLocked) return false;
      history = EMPTY_HISTORY;
      // The clipboard's groups belong to the old project: pasting them could merge into an
      // unrelated group of the new one that happens to share an id.
      const clipboard = EMPTY_CLIPBOARD;
      if (project === state.project) {
        if (!sameStatus(statusOf(history, false, null), state.history) || state.clipboard !== clipboard) commit({ clipboard });
        return true;
      }
      commit({ project, revision: state.revision + 1, selection: EMPTY_SELECTION, clipboard });
      return true;
    },

    acquireLock: (reason) => setLock(reason, true),
    releaseLock: (reason) => setLock(reason, false),

    breakCoalescing() {
      history = closeCoalescing(history);
    },
  };
}
