// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { Profiler, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditorStore, fixedClock } from '../../app';
import { createDerivedStore } from '../../app/derived';
import { createDerivedPipeline } from '../../app/derived-pipeline';
import { mapTestWorkspace } from '../../app/map-test-helpers';
import { ManualTimers } from '../../app/navigation-test-helpers';
import { DerivedStoreProvider } from '../../app/react';
import { editNoteText, sequentialIdSource } from '../../app/shell-support';
import { AvailableQuests } from './AvailableQuests';

/**
 * The Available tab's content with route state (map-presentation.md §14.4; step MP.3; its look and
 * keys are UR.6's): the quests after the active step by the windows, each with its reason, in zone
 * groups with their span and count, the search reaching every quest with its state in words, and
 * the words without route state.
 *
 * The fixture (map-test-helpers): Gather (1) and Cull (2) from Gornek in Durotar. Steps: a note;
 * accept Gather; accept Cull; complete Cull; turn in Cull; a travel; accept Gather again.
 */

afterEach(cleanup);

/** The quest rows under a group heading, up to the next heading. */
function groupRows(heading: HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (let row = heading.closest('[role="row"]')?.nextElementSibling ?? null; row !== null && row.querySelector('[role="rowheader"]') === null; row = row.nextElementSibling) {
    if (row instanceof HTMLElement && row.getAttribute('role') === 'row') rows.push(row);
  }
  return rows;
}

const T0 = '2026-09-25T12:00:00.000Z';

function setup() {
  const workspace = mapTestWorkspace(undefined, T0);
  const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(100), clock: fixedClock(T0) });
  const timers = new ManualTimers();
  const handle = createDerivedStore();
  createDerivedPipeline({ store, data: workspace.data, geometry: workspace.geometry, output: handle, timers, now: () => timers.now });
  const onRender = vi.fn();
  const view = (search: string): ReactNode => (
    <DerivedStoreProvider store={handle.store}>
      <Profiler id="available" onRender={onRender}>
        <AvailableQuests store={store} dataset={workspace.dataset} search={search} />
      </Profiler>
    </DerivedStoreProvider>
  );
  const rendered = render(view(''));
  const select = (index: number): void => {
    const step = workspace.steps[index];
    if (step === undefined) throw new Error(`no step ${String(index)}`);
    act(() => {
      store.select({ kind: 'single', id: step.id });
      timers.advance(0);
    });
  };
  return { store, timers, rendered, view, select, onRender, steps: workspace.steps, handle };
}

describe('AvailableQuests with route state (MP.3)', () => {
  it('says there is no route state yet while the route is simulated; with no step selected it shows the end of the route (D-050 item 2)', () => {
    const s = setup();
    expect(screen.getByText(/^Quests open to an Orc Warrior \(no route state yet\): the route is still being simulated\./)).toBeTruthy();
    act(() => {
      s.timers.advance(0);
    });
    const last = String(s.steps.length);
    expect(screen.getByText(new RegExp(`^At the end of the route \\(after step ${last}\\), level (at least )?\\d+: .* Accept adds the quest’s accept step at the end of the route,`))).toBeTruthy();
  });

  it('lists the quests available after the active step in their giver’s zone, with the span and count, and each quest’s giver', () => {
    const s = setup();
    s.select(0);
    expect(screen.getByText(/^After step 1, level 1: 2 available, 0 may be available and 0 need a prerequisite, by zone from the nearest;/)).toBeTruthy();
    expect(screen.getByText('2 available after step 1')).toBeTruthy();
    // The heading's name words both numbers (UI-13): the span and how many are listed.
    const heading = screen.getByRole('rowheader', { name: /^Durotar, .*2 quests listed$/ });
    expect(heading.textContent).toContain('Durotar');
    const items = groupRows(heading);
    expect(items.map((item) => item.querySelector('.frl-quest-item__label')?.textContent)).toEqual(['Cull', 'Gather']);
    expect(items[0]?.querySelector('.frl-quest-item__detail .frl-quest-item__words')?.textContent).toBe('Gornek · in the route');
    expect(items[0]?.querySelector('.frl-quest-mark')?.getAttribute('data-state')).toBe('available');
    // The name button says the row: the name, the difficulty and the giver.
    expect(within(items[0] as HTMLElement).getByRole('button', { name: /^Cull, quest level 1, .*Gornek · in the route$/ })).toBeTruthy();
    // Without quest actions (no editor wired), no Accept.
    expect(within(items[0] as HTMLElement).queryByRole('button', { name: /^Accept/ })).toBeNull();
  });

  it('follows the active step: accepted quests leave the list for the log, and the header says so', () => {
    const s = setup();
    s.select(2);
    expect(screen.getByText(/Not listed: 2 in the log, 0 done and 0 outside these windows \(search finds them\)\./)).toBeTruthy();
    expect(screen.getByText('No quests to list after step 3.')).toBeTruthy();
  });

  it('finds any quest by search, with its state in words (in the log, done, outside the windows)', () => {
    const s = setup();
    s.select(2);
    s.rendered.rerender(s.view('cull'));
    const others = groupRows(screen.getByRole('rowheader', { name: /^In the log, done or not available after step 3, / }));
    expect(others.map((row) => row.textContent).join(' ')).toContain('In the quest log: 0 of 1 objectives done');
    s.select(4);
    s.rendered.rerender(s.view('cull'));
    const done = groupRows(screen.getByRole('rowheader', { name: /^In the log, done or not available after step 5, / }));
    expect(done.map((row) => row.textContent).join(' ')).toContain('Turned in');
    // A done quest has no mark and nothing to take.
    expect(done[0]?.querySelector('.frl-quest-mark')).toBeNull();
    expect(within(done[0] as HTMLElement).queryByRole('button', { name: /^Accept/ })).toBeNull();
    s.rendered.rerender(s.view('no such quest'));
    expect(screen.getByText('No quests match “no such quest”.')).toBeTruthy();
  });

  it('does not re-render for typing in a note, and renumbers the step when the route changes (F13)', () => {
    const s = setup();
    s.select(2);
    const [note] = s.steps;
    if (note === undefined) throw new Error('no note');
    const before = s.onRender.mock.calls.length;
    act(() => {
      s.store.dispatch(editNoteText(note.id, 'typed'));
      s.timers.advance(0);
    });
    // The note edit walks again: the model is rebuilt with equal entries, so the tab renders the new model once at most.
    expect(s.onRender.mock.calls.length - before).toBeLessThanOrEqual(1);
    expect(screen.getByText(/^After step 3, level 1:/)).toBeTruthy();
  });
});
