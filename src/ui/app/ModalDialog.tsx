import { type ReactNode, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../lib/cx';
import { IconButton } from '../primitives/IconButton';
import { type AnnounceChannel, AnnouncerContext, createDialogRegion, DialogLiveRegion } from './LiveAnnouncer';
import './ProjectMenu.css';

/**
 * The app's modal dialog (docs/UI.md §9 rule 7): a native modal `<dialog>`, so focus moves in,
 * Escape closes and focus returns to the opener. Settings, the RXP dialogs and their loading
 * stand-ins use it directly; the Projects, Import, Export and drift dialogs through
 * `ProjectMenuDialog.tsx`, which re-exports it. (The shell's About dialog is the kit's own.)
 *
 * - `onEscape` lets an inner step (a rename field, a delete confirmation) take Escape first.
 * - Ctrl/Cmd keys pressed inside stop at the dialog, and the shell's global shortcuts are off
 *   while any modal dialog is open (`isModalDialogOpen`, src/ui/lib/modal.ts), so undo never
 *   changes the route behind it, even when focus has fallen to the page body (UI-F1).
 * - When the control that had focus leaves the dialog (a "Try again" replaced by progress, the
 *   last "Show more"), focus moves to the dialog's title instead of the page body (UI-F1).
 * - It has its own polite live region, mounted with it: the page outside a modal dialog is inert,
 *   so the shell's region cannot be heard. While it is open, announcements go to the top-most
 *   open dialog's region; a result announced by the action that closes the dialog is said again
 *   in the shell's region once it has closed (`AnnouncerContext`, UI-F2).
 * - A press that starts and ends on the backdrop closes it, unless `dismissOnBackdrop` is false:
 *   a dialog that holds a draft (Settings, a pasted guide) closes only by Escape, Cancel or Close,
 *   so a slip of the pointer loses nothing (UI-F10).
 * - A file dragged over the dialog or its backdrop is never left to the browser, which would open
 *   it in place of the app and lose the dialog's state: a drop that no target inside took goes to
 *   `onFileDrop`, or is refused (UI-F14).
 * - The header and footer are plain elements, not `header` or `footer` landmarks.
 */

const hasFiles = (types: readonly string[]): boolean => types.includes('Files');

export interface ModalDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  /** Called on Escape before closing; return true when it handled Escape (the dialog stays open). */
  readonly onEscape?: (() => boolean) | undefined;
  readonly footer?: ReactNode;
  readonly className?: string | undefined;
  /** Whether a press on the backdrop closes the dialog; default true. False for dialogs that hold a draft. */
  readonly dismissOnBackdrop?: boolean | undefined;
  /**
   * A file dropped anywhere on the dialog or its backdrop that no drop target inside took. Without
   * it such a drop is refused. Either way the browser never opens the file in place of the app.
   */
  readonly onFileDrop?: ((file: File) => void) | undefined;
  readonly children?: ReactNode;
}

export function ModalDialog({ open, onClose, title, onEscape, footer, className, dismissOnBackdrop = true, onFileDrop, children }: ModalDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const pressOnBackdrop = useRef(false);
  /** The element inside the dialog that last had focus. */
  const lastFocused = useRef<Element | null>(null);
  const openRef = useRef(open);
  const titleId = useId();
  const announcer = useContext(AnnouncerContext);
  const [region] = useState(createDialogRegion);
  const channel = useRef<AnnounceChannel | null>(null);

  useLayoutEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null || !open) return undefined;
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    const opened = announcer?.openChannel(region) ?? null;
    channel.current = opened;
    // A focused control that removes itself would drop focus to the page body: take the title.
    const observer =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            const doc = dialog.ownerDocument;
            const lost = lastFocused.current;
            if (!openRef.current || lost === null || lost.isConnected) return;
            lastFocused.current = null;
            if (doc.activeElement !== null && doc.activeElement !== doc.body) return;
            titleRef.current?.focus();
          });
    observer?.observe(dialog, { childList: true, subtree: true });
    return () => {
      observer?.disconnect();
      if (dialog.open) {
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      }
      // After the dialog has closed, so a carried announcement lands in a region that can be heard.
      channel.current = null;
      if (opened === null) region.clear();
      else opened.close();
    };
  }, [open, announcer, region]);

  const noteInteraction = () => {
    channel.current?.noteInteraction();
  };

  return (
    <dialog
      ref={ref}
      className={cx('frl-modal', className)}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        noteInteraction();
        if (onEscape?.() === true) return;
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onKeyDownCapture={noteInteraction}
      onKeyDown={(event) => {
        if (event.ctrlKey || event.metaKey) event.stopPropagation();
      }}
      onPointerDownCapture={noteInteraction}
      onPointerDown={(event) => {
        pressOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // Only a press that both starts and ends on the backdrop closes (see AboutDialog).
        const fromBackdrop = pressOnBackdrop.current;
        pressOnBackdrop.current = false;
        if (dismissOnBackdrop && fromBackdrop && event.target === event.currentTarget) onClose();
      }}
      onFocus={(event) => {
        lastFocused.current = event.target;
      }}
      onDragOver={(event) => {
        if (event.defaultPrevented || !hasFiles([...event.dataTransfer.types])) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = onFileDrop === undefined ? 'none' : 'copy';
      }}
      onDrop={(event) => {
        if (event.defaultPrevented || !hasFiles([...event.dataTransfer.types])) return;
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file !== undefined) onFileDrop?.(file);
      }}
    >
      <DialogLiveRegion region={region} />
      {open && (
        <div className="frl-modal__content">
          <div className="frl-modal__header">
            <h2 id={titleId} ref={titleRef} className="frl-modal__title" tabIndex={-1}>
              {title}
            </h2>
            <IconButton icon="close" label="Close" onClick={onClose} />
          </div>
          <div className="frl-modal__body">{children}</div>
          {footer !== undefined && <div className="frl-modal__footer">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
