// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditorStore, fixedClock } from '../../app';
import { staticDatasetSource } from '../../app/dataset-source';
import { createPlaceholderWorkspace, PLACEHOLDER_PROJECT_NAME } from '../../app/placeholder-project';
import { sequentialIdSource } from '../../app/shell-support';
import { App } from '../App';
import { LazyDialogFallback, loadCustomQuestEditor, loadDetailsPanel, loadRxpExportDialog, loadRxpImportDialog, loadSettingsDialog, loadValidationPanel, type PartLoader, preloadLazyParts, useLazy, loadProjectDialogs, loadQuestLogPanel, loadAboutDialog, loadImportExport, loadRowView, loadMapLayersPanel, loadMapPopover } from './lazy';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// First in this file, so the chunk has not been loaded yet (each test file has its own modules).
describe('Details through the lazy boundary (UR.1a)', () => {
  it('says the panel is loading until its code arrives, then shows the step', async () => {
    expect(loadDetailsPanel.peek()).toBeNull();
    const nowIso = '2026-09-25T12:00:00.000Z';
    const { project, dataset } = createPlaceholderWorkspace({ nowIso });
    const store = createEditorStore({ project, ids: sequentialIdSource(1000), clock: fixedClock(nowIso) });
    render(<App store={store} data={staticDatasetSource(dataset)} projectName={PLACEHOLDER_PROJECT_NAME} version="0.0.0-test" sourceCommit={null} />);
    const side = within(screen.getByRole('complementary', { name: 'Quests and details' }));
    const first = store.getState().project.route.steps[0]?.id;
    if (first === undefined) throw new Error('the placeholder route has no steps');
    act(() => {
      store.select({ kind: 'single', id: first });
    });
    fireEvent.click(side.getByRole('tab', { name: /^Details/ }));
    const panel = side.getByRole('tabpanel');
    expect(within(panel).getByRole('heading', { name: 'Details' })).toBeDefined();
    expect(panel.textContent).toContain('Loading the details panel…');
    // The loaded panel takes the words' place: the active step, "1 of n".
    expect(await within(panel).findByRole('heading', { name: 'Step' })).toBeDefined();
    expect(panel.textContent).not.toContain('Loading the details panel…');
    expect(loadDetailsPanel.peek()).not.toBeNull();
  });
});

function Harness({ load, wanted }: { readonly load: PartLoader<string>; readonly wanted: boolean }) {
  const state = useLazy(load, wanted);
  return (
    <>
      <p data-testid="state">{state.kind === 'ready' ? `ready: ${state.value}` : state.kind}</p>
      <LazyDialogFallback title="Settings" state={state} onClose={() => undefined} />
    </>
  );
}

describe('useLazy and LazyDialogFallback', () => {
  it('loads only when wanted, says so while loading, and offers Try again after a failure', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue('module');
    const { rerender } = render(<Harness load={load} wanted={false} />);
    expect(screen.getByTestId('state').textContent).toBe('idle');
    expect(load).not.toHaveBeenCalled();
    rerender(<Harness load={load} wanted />);
    expect(screen.getByRole('dialog', { name: 'Settings' }).textContent).toContain('Loading…');
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('dialog', { name: 'Settings' }).textContent).toContain('Settings could not be loaded (network down). Check the connection and try again.');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await Promise.resolve();
    });
    expect(screen.getByTestId('state').textContent).toBe('ready: module');
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
    // Kept once loaded, whether wanted or not.
    rerender(<Harness load={load} wanted={false} />);
    expect(screen.getByTestId('state').textContent).toBe('ready: module');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('draws a part its loader already holds on the first wanted render, never before it is wanted', () => {
    const load: PartLoader<string> = Object.assign(vi.fn(() => Promise.resolve('held')), { peek: () => ({ value: 'held' }) });
    const { rerender } = render(<Harness load={load} wanted={false} />);
    // Held but not wanted: a dialog is not mounted until it is first opened.
    expect(screen.getByTestId('state').textContent).toBe('idle');
    rerender(<Harness load={load} wanted />);
    expect(screen.getByTestId('state').textContent).toBe('ready: held');
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
  });
});

describe('the lazy parts chunk (docs/UI.md §11 CR-19; ui-refresh.md §10.3 UR.1a)', () => {
  it('holds the Details panel, the Quest log, the Projects dialog and menu, View and the dialogs, behind one loader', async () => {
    const loaders = [
      loadSettingsDialog,
      loadCustomQuestEditor,
      loadRxpImportDialog,
      loadRxpExportDialog,
      loadValidationPanel,
      loadDetailsPanel,
      loadProjectDialogs,
      loadQuestLogPanel,
      loadAboutDialog,
      loadImportExport,
      loadRowView,
      loadMapLayersPanel,
      loadMapPopover,
    ];
    // One dynamic import for all of them, so the modules they share stay in the entry chunk.
    expect(new Set(loaders).size).toBe(1);
    const parts = await loadDetailsPanel();
    expect(Object.keys(parts).sort()).toEqual([
      'AboutDialog',
      'CustomQuestEditor',
      'DetailsPanel',
      'DriftDialog',
      'ExportDialog',
      'ImportDialog',
      'MapLayersPanel',
      'MapPopoverPanel',
      'ProjectMenuDialog',
      'ProjectsMenuPopup',
      'QuestLogPanel',
      'RowViewPanel',
      'RxpExportDialog',
      'RxpImportDialog',
      'SettingsDialog',
      'ValidationPanel',
    ]);
    expect(loadDetailsPanel.peek()?.value).toBe(parts);
    // Loaded once: every later call gives the same module.
    expect(await loadValidationPanel()).toBe(parts);
  });

  it('fetches the chunk when the page is idle in production builds, and never in development', async () => {
    const idle = vi.fn<(callback: () => void, options?: { timeout: number }) => number>(() => 7);
    const cancel = vi.fn<(handle: number) => void>();
    vi.stubGlobal('requestIdleCallback', idle);
    vi.stubGlobal('cancelIdleCallback', cancel);
    vi.stubEnv('PROD', false);
    preloadLazyParts()();
    expect(idle).not.toHaveBeenCalled();
    vi.stubEnv('PROD', true);
    const stop = preloadLazyParts();
    expect(idle).toHaveBeenCalledTimes(1);
    expect(idle.mock.calls[0]?.[1]).toEqual({ timeout: 5000 });
    // The idle callback starts the one import.
    idle.mock.calls[0]?.[0]();
    const parts = await loadDetailsPanel();
    expect(parts.DetailsPanel).toBeDefined();
    stop();
    expect(cancel).toHaveBeenCalledWith(7);
  });
});
