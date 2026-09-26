// @vitest-environment happy-dom
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorStore, fixedClock, insertNote } from '../../app';
import { createPlaceholderWorkspace } from '../../app/placeholder-project';
import { sequentialIdSource } from '../../app/shell-support';
import { createAnnouncer, createDialogRegion, LiveRegion, SELECTION_ANNOUNCE_DELAY_MS, useSelectionAnnouncements } from './LiveAnnouncer';

const NOW = '2026-09-25T12:00:00.000Z';

afterEach(cleanup);

describe('createAnnouncer', () => {
  it('changes the text for a repeated message, so it is announced again', () => {
    const announcer = createAnnouncer();
    const seen: string[] = [];
    const unsubscribe = announcer.subscribe(() => seen.push(announcer.getMessage()));
    announcer.announce('1 step deleted.');
    announcer.announce('1 step deleted.');
    announcer.announce('1 step deleted.');
    announcer.announce('   ');
    unsubscribe();
    announcer.announce('Not heard');
    expect(seen).toEqual(['1 step deleted.', '1 step deleted.\u00a0', '1 step deleted.']);
  });

  it('renders one polite region that starts empty and shows the latest message', () => {
    const announcer = createAnnouncer();
    const { container } = render(<LiveRegion announcer={announcer} />);
    const region = container.querySelector('[role="status"]');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.getAttribute('aria-atomic')).toBe('true');
    expect(region?.textContent).toBe('');
    act(() => {
      announcer.announce('3 steps selected');
    });
    expect(region?.textContent).toBe('3 steps selected');
  });
});

describe('dialog channels (UI-F2)', () => {
  it('routes announcements to the newest open dialog, then back to the one below and to the shell', () => {
    const announcer = createAnnouncer();
    const first = createDialogRegion();
    const second = createDialogRegion();
    const a = announcer.openChannel(first);
    announcer.announce('Renamed.');
    expect(first.getMessage()).toBe('Renamed.');
    expect(announcer.getMessage()).toBe('');
    const b = announcer.openChannel(second);
    announcer.announce('Copied.');
    expect(second.getMessage()).toBe('Copied.');
    expect(first.getMessage()).toBe('Renamed.');
    b.noteInteraction();
    b.close();
    // The newer dialog's region empties with it.
    expect(second.getMessage()).toBe('');
    announcer.announce('Deleted.');
    expect(first.getMessage()).toBe('Deleted.');
    a.noteInteraction();
    a.close();
    announcer.announce('Back in the shell.');
    expect(announcer.getMessage()).toBe('Back in the shell.');
  });

  it('says the result of the action that closed a dialog again in the region below, and nothing older', () => {
    const announcer = createAnnouncer();
    const saved = announcer.openChannel(createDialogRegion());
    saved.noteInteraction();
    announcer.announce('Settings saved. Undo with Ctrl+Z.');
    saved.close();
    expect(announcer.getMessage()).toBe('Settings saved. Undo with Ctrl+Z.');
    // A copy made earlier, then Escape: the copy result is not said again.
    const copied = announcer.openChannel(createDialogRegion());
    copied.noteInteraction();
    announcer.announce('Copied the guide text to the clipboard.');
    copied.noteInteraction();
    copied.close();
    expect(announcer.getMessage()).toBe('Settings saved. Undo with Ctrl+Z.');
    // Closing twice does nothing more.
    copied.close();
    expect(announcer.getMessage()).toBe('Settings saved. Undo with Ctrl+Z.');
  });
});

describe('useSelectionAnnouncements', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const { project } = createPlaceholderWorkspace({ nowIso: NOW });
    const store = createEditorStore({ project, ids: sequentialIdSource(1000), clock: fixedClock(NOW) });
    const announce = vi.fn<(message: string) => void>();
    renderHook(() => {
      useSelectionAnnouncements(store, announce);
    });
    const stepIds = store.getState().project.route.steps.map((s) => s.id);
    return { store, announce, stepIds };
  }

  it('announces the settled count only', () => {
    const { store, announce, stepIds } = setup();
    store.select({ kind: 'set', ids: stepIds.slice(0, 2) });
    store.select({ kind: 'set', ids: stepIds.slice(0, 3) });
    vi.advanceTimersByTime(SELECTION_ANNOUNCE_DELAY_MS - 1);
    expect(announce).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(announce.mock.calls).toEqual([['3 steps selected']]);
    store.select({ kind: 'none' });
    vi.advanceTimersByTime(SELECTION_ANNOUNCE_DELAY_MS);
    expect(announce.mock.calls.at(-1)).toEqual(['Selection cleared']);
  });

  it('leaves selection changes that come with a project change to that change', () => {
    const { store, announce, stepIds } = setup();
    store.select({ kind: 'set', ids: stepIds.slice(0, 2) });
    // Within the delay, a command changes the project (and the selection with it).
    store.dispatch(insertNote({ text: 'Placeholder' }));
    vi.advanceTimersByTime(SELECTION_ANNOUNCE_DELAY_MS * 2);
    expect(announce).not.toHaveBeenCalled();
  });

  it('stays quiet when the count does not change', () => {
    const { store, announce, stepIds } = setup();
    store.select({ kind: 'set', ids: stepIds.slice(0, 1) });
    vi.advanceTimersByTime(SELECTION_ANNOUNCE_DELAY_MS);
    store.select({ kind: 'set', ids: stepIds.slice(1, 2) });
    vi.advanceTimersByTime(SELECTION_ANNOUNCE_DELAY_MS);
    expect(announce.mock.calls).toEqual([['1 step selected']]);
  });
});
