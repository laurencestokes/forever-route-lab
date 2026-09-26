import { createContext, useEffect, useSyncExternalStore } from 'react';
import type { EditorStore } from '../../app';
import { selectionMessage } from '../app-model';

/**
 * The app's polite live regions (docs/UI.md §9 rule 6). The shell has one, mounted once, empty,
 * and never remounted: a region inserted together with its text is often not announced. A modal
 * dialog makes everything outside it inert, and inert content is not exposed to assistive
 * technology, so each open modal dialog has its own region too (`ModalDialog`), and announcements
 * go to the top-most open dialog's region while one is open (UI-F2). Messages are short results of
 * what the user just did (selection counts, row commands), never percentages.
 */

export type Announce = (message: string) => void;

/** A region's text, for `useSyncExternalStore`. */
export interface LiveText {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getMessage: () => string;
}

/** A modal dialog's own region text (`createDialogRegion`); the announcer writes to it while the dialog's channel is open. */
export interface DialogRegion extends LiveText {
  /** The last message, without the repeat marker. */
  readonly last: () => string;
  readonly say: (text: string) => void;
  readonly clear: () => void;
}

/** A modal dialog's link to the announcer, open while the dialog is (`Announcer.openChannel`). */
export interface AnnounceChannel {
  /**
   * A press or a key inside the dialog (or its Escape). A message said before it belongs to the
   * earlier action and is not said again when the dialog closes.
   */
  readonly noteInteraction: () => void;
  /**
   * The dialog closed: announcements go to the region below it again (the next open dialog's, or
   * the shell's), and the dialog's region is emptied. A message said since the last interaction
   * was the result of the action that closed the dialog ("Settings saved.", "Imported …"), so it
   * is said again there, where it can be heard: the dialog's own region goes with the dialog.
   */
  readonly close: () => void;
}

export interface Announcer extends LiveText {
  /** Says a message in the top-most open dialog's region, else in the shell's (`subscribe`, `getMessage`). */
  readonly announce: Announce;
  /**
   * How many messages have been said so far, in any region. A pending message that a newer one
   * supersedes (the settled selection count after a command said its own result) compares it.
   */
  readonly said: () => number;
  /** Routes announcements to a modal dialog's region until the channel closes; the newest open channel wins. */
  readonly openChannel: (region: DialogRegion) => AnnounceChannel;
}

const NO_BREAK_SPACE = '\u00a0';

/**
 * One region's text. Saying the same thing twice still announces it: the repeat carries a
 * trailing no-break space, so the region's text changes.
 */
export function createDialogRegion(): DialogRegion {
  let message = '';
  let last = '';
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getMessage: () => message,
    last: () => last,
    say(text) {
      last = text;
      message = message === text ? `${text}${NO_BREAK_SPACE}` : text;
      notify();
    },
    clear() {
      if (message === '' && last === '') return;
      message = '';
      last = '';
      notify();
    },
  };
}

interface Channel {
  readonly region: DialogRegion;
  interactions: number;
  /** `interactions` when the last message was said; -1 for none. */
  saidAt: number;
  open: boolean;
}

/** The regions' texts, outside React, so any handler can announce without re-rendering the shell. */
export function createAnnouncer(): Announcer {
  const shell = createDialogRegion();
  const channels: Channel[] = [];
  let count = 0;
  const announce: Announce = (text) => {
    const next = text.trim();
    if (next === '') return;
    count += 1;
    const top = channels.at(-1);
    if (top === undefined) {
      shell.say(next);
      return;
    }
    top.region.say(next);
    top.saidAt = top.interactions;
  };
  return {
    announce,
    said: () => count,
    subscribe: shell.subscribe,
    getMessage: shell.getMessage,
    openChannel(region) {
      const channel: Channel = { region, interactions: 0, saidAt: -1, open: true };
      channels.push(channel);
      return {
        noteInteraction() {
          channel.interactions += 1;
        },
        close() {
          if (!channel.open) return;
          channel.open = false;
          const at = channels.indexOf(channel);
          if (at >= 0) channels.splice(at, 1);
          const carried = channel.saidAt === channel.interactions ? region.last() : '';
          region.clear();
          if (carried !== '') announce(carried);
        },
      };
    },
  };
}

/**
 * The shell's announcer, for the modal dialogs' own regions (`ModalDialog`). Null outside a shell
 * (component tests): a dialog then has its region, but nothing routes to it.
 */
export const AnnouncerContext = createContext<Announcer | null>(null);

/** A visually hidden polite region. */
function Region({ className, text }: { readonly className: string; readonly text: LiveText }) {
  const message = useSyncExternalStore(text.subscribe, text.getMessage, text.getMessage);
  return (
    <div className={`frl-visually-hidden ${className}`} role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}

/** The shell's region itself. Render it once, at the root of the shell. */
export function LiveRegion({ announcer }: { readonly announcer: Announcer }) {
  return <Region className="frl-app-live" text={announcer} />;
}

/** A modal dialog's region: rendered for as long as the dialog is, empty until its channel speaks. */
export function DialogLiveRegion({ region }: { readonly region: DialogRegion }) {
  return <Region className="frl-dialog-live" text={region} />;
}

/** How long the selection must stay put before its count is announced. */
export const SELECTION_ANNOUNCE_DELAY_MS = 500;

/**
 * Announces the number of selected steps once it settles ("12 steps selected", "Selection
 * cleared"), so Shift+arrow runs say the final count only. Arrowing keeps one step selected and is
 * not announced: the list already reads the new active option. Selection changes that come with a
 * project change (a command, undo, redo, a load) are left to that change's own message, and so are
 * those whose command says its own result before the count settles (choosing an issue: "Showing
 * step 12 in the route: …", UI-11): with an `Announcer`, a message said after the selection changed
 * cancels the count.
 */
export function useSelectionAnnouncements(store: EditorStore, announcer: Announce | Pick<Announcer, 'announce' | 'said'>, delayMs = SELECTION_ANNOUNCE_DELAY_MS): void {
  const announce = typeof announcer === 'function' ? announcer : announcer.announce;
  const said = typeof announcer === 'function' ? null : announcer.said;
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
      const mark = said?.() ?? 0;
      timer = setTimeout(() => {
        timer = null;
        if (said !== null && said() !== mark) return;
        announce(selectionMessage(size));
      }, delayMs);
    });
    return () => {
      cancel();
      unsubscribe();
    };
  }, [store, announce, said, delayMs]);
}
