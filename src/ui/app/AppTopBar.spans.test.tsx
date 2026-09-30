// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditorStore, fixedClock } from '../../app';
import { createDerivedStore } from '../../app/derived';
import { createMapController } from '../../app/map-controller';
import { mapTestWorkspace } from '../../app/map-test-helpers';
import { DerivedStoreProvider } from '../../app/react';
import { sequentialIdSource } from '../../app/shell-support';
import { zoneSpans } from '../../app/zone-levels';
import type { UiMapId } from '../../domain/ids';
import { AppTopBar, zoneOptionLabel } from './AppTopBar';

/** The top bar's zone list with each zone's level span for the character (map-presentation.md §14.4; step MP.3). */

afterEach(cleanup);

const T0 = '2026-09-25T12:00:00.000Z';

describe('the top bar’s zone spans', () => {
  it('adds the span and its basis to a zone’s option, and keeps the name alone without spans', () => {
    const workspace = mapTestWorkspace(undefined, T0);
    const spans = zoneSpans(workspace.dataset, workspace.geometry, { race: 'Orc', class: 'WARRIOR' });
    expect(zoneOptionLabel('Durotar', 1411, spans)).toBe('Durotar · no quests for an Orc Warrior');
    const span = spans.get(1411 as UiMapId);
    if (span === undefined) throw new Error('no span');
    const spanned = new Map([[1411 as UiMapId, { ...span, low: 13, high: 25, median: 18, open: 93, text: 'quests 13–25 (93)' }]]);
    expect(zoneOptionLabel('The Barrens', 1411, spanned)).toBe('The Barrens · quests 13–25 (93), Era data');
    expect(zoneOptionLabel('Durotar', 1411, null)).toBe('Durotar');
    expect(zoneOptionLabel('Mulgore', 1412, spanned)).toBe('Mulgore');
  });

  it('shows the spans once the pipeline has built them', () => {
    const workspace = mapTestWorkspace(undefined, T0);
    const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(100), clock: fixedClock(T0) });
    const handle = createDerivedStore();
    const controller = createMapController({ store, data: workspace.data, geometry: workspace.geometry, describeStep: () => '', timing: null });
    render(
      <DerivedStoreProvider store={handle.store}>
        <AppTopBar
          store={store}
          dataset={workspace.dataset}
          projectName="Map test"
          search=""
          onSearchChange={vi.fn()}
          onSearchSubmit={vi.fn()}
          searchRef={createRef<HTMLInputElement>()}
          onAbout={vi.fn()}
          mapController={controller}
        />
      </DerivedStoreProvider>,
    );
    expect(screen.getByRole('option', { name: 'Durotar' })).toBeTruthy();
    act(() => {
      handle.publish({ zoneSpans: zoneSpans(workspace.dataset, workspace.geometry, { race: 'Orc', class: 'WARRIOR' }) });
    });
    expect(screen.getByRole('option', { name: 'Durotar · no quests for an Orc Warrior' })).toBeTruthy();
  });
});
