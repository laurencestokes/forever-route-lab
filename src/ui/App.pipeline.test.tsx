// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDerivedStore, createEditorStore, fixedClock, insertNote } from '../app';
import { createDerivedPipeline } from '../app/derived-pipeline';
import { mapTestWorkspace } from '../app/map-test-helpers';
import { ManualTimers } from '../app/navigation-test-helpers';
import { DerivedStoreProvider } from '../app/react';
import { sequentialIdSource } from '../app/shell-support';
import { App } from './App';
import { STEP_NOT_WALKED } from './app/derived-view';
import { loadValidationPanel } from './app/lazy';

/**
 * The shell over the real derived-result pipeline (src/app/derived-pipeline.ts: engine, simulation
 * and validator) on the map test route, with no navigation data: the rows, the status bar and the
 * Validation tab show what the walk worked out, and an edit is walked again.
 */

// The Validation panel is a lazy part (ui-refresh.md UR.1a) that production builds preload when
// idle; so does this test. Run first on a cold transform cache, the chunk took longer than
// findByRole's default 1 s to load (rework follow-up F-12).
beforeAll(async () => {
  await loadValidationPanel();
}, 60_000);

afterEach(cleanup);

// The Validation panel is a lazy part (ARCHITECTURE §12.1) that production builds preload when idle;
// so do these tests. Loaded at the first open instead, the chunk can take over a second on a busy
// machine, longer than Testing Library waits by default.
beforeAll(async () => {
  await loadValidationPanel();
});

const NOW = '2026-09-25T12:00:00.000Z';

function setup() {
  const workspace = mapTestWorkspace(undefined, NOW);
  const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(100), clock: fixedClock(NOW) });
  const handle = createDerivedStore();
  const timers = new ManualTimers();
  const pipeline = createDerivedPipeline({
    store,
    data: workspace.data,
    geometry: workspace.geometry,
    output: handle,
    navigation: { kind: 'unavailable', reason: 'no navigation data in this test' },
    timers,
  });
  render(
    <DerivedStoreProvider store={handle.store}>
      <App store={store} data={workspace.data} projectName="Pipeline test" version="0.0.0-test" sourceCommit={null} selectOnOpen={false} />
    </DerivedStoreProvider>,
  );
  return { store, handle, pipeline, timers };
}

const options = () => within(screen.getByRole('listbox')).getAllByRole('option');

describe('the shell over the real pipeline', () => {
  it('fills the rows, the status bar and the Validation tab from the walk, and walks an edit again', async () => {
    const s = setup();
    act(() => {
      s.pipeline.flush();
    });
    expect(s.handle.store.getState().status).toBe('ready');
    // Every row now has the walk's numbers: known values or reasons, none "not simulated".
    for (const option of options()) {
      expect(option.getAttribute('aria-label')).not.toContain('Not simulated');
      expect(option.getAttribute('aria-label')).toMatch(/Level after step (at least )?\d/);
    }
    const bar = document.querySelector('.frl-statusbar__simulation');
    expect(bar?.getAttribute('data-state')).toBe('straight-line');
    expect(bar?.textContent).toContain('no navigation data in this test');
    const status = within(screen.getByRole('region', { name: 'Route status' }));
    expect(status.getByTitle("The route's duration").textContent).not.toContain('Unknown');

    const issues = s.handle.store.getState().results?.issues ?? [];
    fireEvent.click(screen.getByRole('tab', { name: /^Validation/ }));
    const list = await screen.findByRole('list', { name: 'Issues' }, { timeout: 10_000 });
    expect(within(list).getAllByRole('listitem')).toHaveLength(Math.min(issues.length, 100));

    // An edit: the new step is said to be waiting for the walk until it runs.
    act(() => {
      s.store.dispatch(insertNote({ text: 'A new first step' }, 0));
    });
    expect(options()[0]?.getAttribute('aria-label')).toContain(STEP_NOT_WALKED);
    act(() => {
      s.pipeline.flush();
    });
    expect(options()[0]?.getAttribute('aria-label')).not.toContain(STEP_NOT_WALKED);
    expect(s.handle.store.getState().results?.revision).toBe(s.store.getState().revision);
    s.pipeline.dispose();
  });
});
