import { useEffect, type KeyboardEvent } from 'react';
import type { EditorStore } from '../../app';
import { isModalDialogOpen } from '../lib/modal';
import type { RouteActions } from './route-actions';

/**
 * Keyboard shortcuts of the shell, in two scopes. Undo, redo and Ctrl+K (search) are global: they
 * work wherever focus is, except in text fields (which keep their own undo) and while a dialog is
 * open. The route commands (Delete, Alt+↑/↓, Ctrl+D, Ctrl+A, Ctrl+X, Ctrl+C, Ctrl+V, J, Escape)
 * act on the route selection only while focus is inside the route editor: Delete on a side-panel
 * tab deletes nothing, and Ctrl+A or Ctrl+C there select and copy text as usual. The route list
 * handles some of the same keys itself first and marks them handled (`defaultPrevented`), so
 * nothing runs twice. docs/UI.md §8 lists every key.
 */

export interface ShortcutKey {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

export type GlobalShortcut = 'undo' | 'redo' | 'search';
export type RouteEditorShortcut = 'selectAll' | 'duplicate' | 'delete' | 'moveUp' | 'moveDown' | 'clearSelection' | 'cut' | 'copy' | 'paste' | 'join';

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

/** Single characters compare lower-cased (Shift+Z arrives as "Z"). */
const keyOf = (input: ShortcutKey): string => (input.key.length === 1 ? input.key.toLowerCase() : input.key);

export function globalShortcutFor(input: ShortcutKey): GlobalShortcut | null {
  const mod = input.ctrlKey || input.metaKey;
  if (!mod || input.altKey) return null;
  const key = keyOf(input);
  if (key === 'z') return input.shiftKey ? 'redo' : 'undo';
  if (input.shiftKey) return null;
  if (key === 'y') return 'redo';
  if (key === 'k') return 'search';
  return null;
}

export function routeEditorShortcutFor(input: ShortcutKey): RouteEditorShortcut | null {
  const mod = input.ctrlKey || input.metaKey;
  const key = keyOf(input);
  if (mod && !input.altKey && !input.shiftKey) {
    if (key === 'a') return 'selectAll';
    if (key === 'd') return 'duplicate';
    if (key === 'x') return 'cut';
    if (key === 'c') return 'copy';
    if (key === 'v') return 'paste';
    return null;
  }
  if (input.altKey && !mod && !input.shiftKey) {
    if (key === 'ArrowUp') return 'moveUp';
    if (key === 'ArrowDown') return 'moveDown';
    return null;
  }
  if (mod || input.altKey || input.shiftKey) return null;
  if (key === 'Delete') return 'delete';
  if (key === 'Escape') return 'clearSelection';
  if (key === 'j') return 'join';
  return null;
}

export interface GlobalShortcutOptions {
  readonly actions: RouteActions;
  readonly focusSearch: () => void;
  /** False while a dialog the shell owns is open. */
  readonly enabled: boolean;
}

/**
 * Registers the global shortcuts on the window. They are off while any modal dialog is open,
 * whoever owns it: the keys may reach the window from the page body when a control inside the
 * dialog removed itself, and undo must not change the route behind a dialog (UI-F1).
 */
export function useGlobalShortcuts({ actions, focusSearch, enabled }: GlobalShortcutOptions): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      if (isModalDialogOpen()) return;
      const shortcut = globalShortcutFor(event);
      if (shortcut === null) return;
      event.preventDefault();
      if (shortcut === 'undo') actions.undo();
      else if (shortcut === 'redo') actions.redo();
      else focusSearch();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [actions, focusSearch, enabled]);
}

/**
 * The route editor's key handler, for `onKeyDown` on the element that wraps the whole editor, so
 * it only ever sees keys pressed with focus inside it.
 */
export function routeEditorKeyHandler(store: EditorStore, actions: RouteActions): (event: KeyboardEvent<HTMLElement>) => void {
  return (event) => {
    if (event.defaultPrevented || isEditableTarget(event.target)) return;
    const shortcut = routeEditorShortcutFor(event);
    if (shortcut === null) return;
    const hasSelection = store.getState().selection.stepIds.size > 0;
    switch (shortcut) {
      case 'selectAll':
        store.select({ kind: 'all' });
        break;
      case 'duplicate':
        // Always claimed, so the browser's bookmark shortcut never fires inside the editor.
        if (hasSelection) actions.duplicateSteps();
        break;
      case 'delete':
        if (!hasSelection) return;
        actions.deleteSteps();
        break;
      case 'moveUp':
      case 'moveDown':
        if (!hasSelection) return;
        actions.moveSteps({ by: shortcut === 'moveUp' ? -1 : 1 });
        break;
      case 'clearSelection':
        if (!hasSelection) return;
        store.select({ kind: 'none' });
        break;
      case 'cut':
        if (!hasSelection) return;
        actions.cutSteps();
        break;
      case 'copy':
        if (!hasSelection) return;
        actions.copySteps();
        break;
      case 'paste':
        if (store.getState().clipboard.steps.length === 0) return;
        actions.pasteSteps();
        break;
      case 'join':
        if (!hasSelection) return;
        actions.joinSections();
        break;
    }
    event.preventDefault();
  };
}
