// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isModalDialogOpen } from '../lib/modal';
import { type Announcer, AnnouncerContext, createAnnouncer, LiveRegion } from './LiveAnnouncer';
import { ModalDialog } from './ModalDialog';
import type { RouteActions } from './route-actions';
import { useGlobalShortcuts } from './useShortcuts';

afterEach(cleanup);

/** Only undo and redo are used by the global shortcuts. */
function stubActions() {
  const undo = vi.fn();
  const redo = vi.fn();
  return { actions: { undo, redo } as unknown as RouteActions, undo, redo };
}

function Shell({ actions, announcer, dismissOnBackdrop }: { readonly actions: RouteActions; readonly announcer: Announcer; readonly dismissOnBackdrop?: boolean | undefined }) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(true);
  useGlobalShortcuts({ actions, focusSearch: () => undefined, enabled: true });
  return (
    <AnnouncerContext.Provider value={announcer}>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <ModalDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Test dialog"
        dismissOnBackdrop={dismissOnBackdrop}
        footer={
          <button
            type="button"
            onClick={() => {
              announcer.announce('Saved.');
              setOpen(false);
            }}
          >
            Save
          </button>
        }
      >
        <button type="button" onClick={() => announcer.announce('Copied.')}>
          Copy
        </button>
        {more && (
          <button type="button" onClick={() => setMore(false)}>
            Show the rest
          </button>
        )}
      </ModalDialog>
      <LiveRegion announcer={announcer} />
    </AnnouncerContext.Provider>
  );
}

function setup(dismissOnBackdrop?: boolean) {
  const stub = stubActions();
  const announcer = createAnnouncer();
  render(<Shell actions={stub.actions} announcer={announcer} dismissOnBackdrop={dismissOnBackdrop} />);
  const open = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    return screen.getByRole('dialog', { name: 'Test dialog' });
  };
  return { ...stub, announcer, open };
}

const shellText = () => (document.querySelector('.frl-app-live')?.textContent ?? '').trim();

describe('ModalDialog', () => {
  it('keeps the global undo off while it is open, even with focus on the page body (UI-F1)', () => {
    const s = setup();
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(s.undo).toHaveBeenCalledTimes(1);
    const dialog = s.open();
    expect(isModalDialogOpen()).toBe(true);
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
    // Ctrl keys pressed inside the dialog stop at it as well.
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Copy' }), { key: 'z', ctrlKey: true });
    expect(s.undo).toHaveBeenCalledTimes(1);
    expect(s.redo).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(isModalDialogOpen()).toBe(false);
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(s.undo).toHaveBeenCalledTimes(2);
  });

  it('moves focus to its title when the focused control removes itself (UI-F1)', async () => {
    const s = setup();
    const dialog = s.open();
    const rest = within(dialog).getByRole('button', { name: 'Show the rest' });
    rest.focus();
    fireEvent.click(rest);
    await act(async () => {
      await Promise.resolve();
    });
    expect(within(dialog).queryByRole('button', { name: 'Show the rest' })).toBeNull();
    expect(document.activeElement).toBe(within(dialog).getByRole('heading', { name: 'Test dialog' }));
  });

  it('announces in its own region while open, and the closing action’s result in the shell’s after (UI-F2)', () => {
    const s = setup();
    const dialog = s.open();
    const region = dialog.querySelector('[role="status"]');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.textContent).toBe('');
    const copy = within(dialog).getByRole('button', { name: 'Copy' });
    fireEvent.pointerDown(copy);
    fireEvent.click(copy);
    expect(region?.textContent).toBe('Copied.');
    expect(shellText()).toBe('');
    // Escape later: the copy result stays unsaid in the shell.
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog', { name: 'Test dialog' })).toBeNull();
    expect(shellText()).toBe('');
    const again = s.open();
    // A reopened dialog's region starts empty.
    expect(again.querySelector('[role="status"]')?.textContent).toBe('');
    const save = within(again).getByRole('button', { name: 'Save' });
    fireEvent.pointerDown(save);
    fireEvent.click(save);
    expect(shellText()).toBe('Saved.');
  });

  it('closes on a backdrop press unless dismissOnBackdrop is false (UI-F10)', () => {
    const kept = setup(false);
    const dialog = kept.open();
    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog);
    expect(screen.getByRole('dialog', { name: 'Test dialog' })).toBe(dialog);
    cleanup();
    const closing = setup();
    const other = closing.open();
    // A press that starts inside and ends on the backdrop (a text selection) does not close it.
    fireEvent.pointerDown(within(other).getByRole('button', { name: 'Copy' }));
    fireEvent.click(other);
    expect(screen.getByRole('dialog', { name: 'Test dialog' })).toBe(other);
    fireEvent.pointerDown(other);
    fireEvent.click(other);
    expect(screen.queryByRole('dialog', { name: 'Test dialog' })).toBeNull();
  });

  it('never leaves a dropped file to the browser: a drop no target took goes to onFileDrop (UI-F14)', () => {
    const onFileDrop = vi.fn<(file: File) => void>();
    render(
      <ModalDialog open onClose={() => undefined} title="Drop dialog" onFileDrop={onFileDrop}>
        <p>Body</p>
      </ModalDialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Drop dialog' });
    const file = new File(['guide'], 'guide.txt');
    const over = fireEvent.dragOver(within(dialog).getByRole('heading', { name: 'Drop dialog' }), { dataTransfer: { files: [file], types: ['Files'] } });
    expect(over).toBe(false);
    const dropped = fireEvent.drop(dialog, { dataTransfer: { files: [file], types: ['Files'] } });
    expect(dropped).toBe(false);
    expect(onFileDrop).toHaveBeenCalledWith(file);
    // Text dragged from the page is left alone.
    expect(fireEvent.drop(dialog, { dataTransfer: { files: [], types: ['text/plain'] } })).toBe(true);
    expect(onFileDrop).toHaveBeenCalledTimes(1);
  });

  it('has no banner or contentinfo landmarks inside', () => {
    const s = setup();
    const dialog = s.open();
    expect(dialog.querySelector('header, footer')).toBeNull();
    expect(within(dialog).queryByRole('banner')).toBeNull();
    expect(within(dialog).queryByRole('contentinfo')).toBeNull();
  });
});
