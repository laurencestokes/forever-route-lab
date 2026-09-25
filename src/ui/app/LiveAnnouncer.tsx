import { useEffect, useSyncExternalStore } from 'react';
import type { EditorStore } from '../../app';
import { selectionMessage } from '../app-model';

/**
 * The shell's one polite live region (docs/UI.md §9 rule 6). It is mounted once, empty, and stays
 * mounted: a region inserted together with its text is often not announced. Messages are short
 * results of what the user just did (selection counts, row commands), never percentages.
 */

export type Announce = (message: string) => void;

export interface Announcer {
  readonly announce: Announce;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getMessage: () => string;
}

const NO_BREAK_SPACE = '\u00a0';

/**
 * The region's text, outside React so any handler can announce without re-rendering the shell.
 * Saying the same thing twice still announces it: the repeat carries a trailing no-break space,
 * so the region's text changes.
 */
export function createAnnouncer(): Announcer {
  let message = '';
  const listeners = new Set<() => void>();
  return {
    announce(text) {
      const next = text.trim();
      if (next === '') return;
      message = message === next ? `${next}${NO_BREAK_SPACE}` : next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getMessage: () => message,
  };
}

/** The visually hidden region itself. Render it once, at the root of the shell. */
export function LiveRegion({ announcer }: { readonly announcer: Announcer }) {
  const message = useSyncExternalStore(announcer.subscribe, announcer.getMessage, announcer.getMessage);
  return (
    <div className="frl-visually-hidden frl-app-live" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}

/** How long the selection must stay put before its count is announced. */
export const SELECTION_ANNOUNCE_DELAY_MS = 500;

/**
 * Announces the number of selected steps once it settles ("12 steps selected", "Selection
 * cleared"), so Shift+arrow runs say the final count only. Arrowing keeps one step selected and is
 * not announced: the list already reads the new active option. Selection changes that come with a
 * project change (a command, undo, redo, a load) are left to that change's own message.
 */
export function useSelectionAnnouncements(store: EditorStore, announce: Announce, delayMs = SELECTION_ANNOUNCE_DELAY_MS): void {
  useEffect(() => {
    let { revision } = store.getState();
    let size = store.getState().selection.stepIds.size;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cancel = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const unsubscribe = store.subscribe(() => {
      const state = store.getState();
      const nextSize = state.selection.stepIds.size;
      if (state.revision !== revision) {
        revision = state.revision;
        size = nextSize;
        cancel();
        return;
      }
      if (nextSize === size) return;
      size = nextSize;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        announce(selectionMessage(size));
      }, delayMs);
    });
    return () => {
      cancel();
      unsubscribe();
    };
  }, [store, announce, delayMs]);
}
