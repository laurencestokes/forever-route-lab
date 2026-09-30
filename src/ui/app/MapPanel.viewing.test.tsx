// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createDerivedStore } from '../../app/derived';
import type { PlacesModel } from '../../app/map-places';
import { DerivedStoreProvider } from '../../app/react';
import { zoneSpans, type ZoneSpan } from '../../app/zone-levels';
import { mapTestWorkspace } from '../../app/map-test-helpers';
import type { UiMapId } from '../../domain/ids';
import type { LabelDescriptor } from '../../map/adapter';
import { ViewingChip } from './MapPanel';

/**
 * The "Viewing" chip (map-presentation.md §13.5; step MP.7): from the zone band, the zone at the view
 * centre with its span for the character, the boxed E, and the real `DifficultyLabel` rating its
 * median quest level at the step (the card's twin input).
 */

afterEach(cleanup);

const DUROTAR = 1411 as UiMapId;

describe('ViewingChip', () => {
  it('names the zone with its span, the Era marker and the rating, once the pipeline has built them', () => {
    const workspace = mapTestWorkspace();
    const handle = createDerivedStore();
    render(
      <DerivedStoreProvider store={handle.store}>
        <ViewingChip uiMapId={DUROTAR} />
      </DerivedStoreProvider>,
    );
    // Nothing before the spans exist: nothing is guessed.
    expect(document.body.textContent).toBe('');
    const base = zoneSpans(workspace.dataset, workspace.geometry, { race: 'Orc', class: 'WARRIOR' }).get(DUROTAR);
    if (base === undefined) throw new Error('no span');
    const span: ZoneSpan = { ...base, low: 13, high: 25, median: 18, open: 93, text: 'quests 13–25 (93)', viewing: 'quests 13–25 (93 open to an Orc Warrior)' };
    const card: LabelDescriptor = {
      type: 'label',
      id: 'zone:1411',
      point: { mapId: 1 as never, x: 0, y: 0 },
      kind: 'zone',
      text: 'Durotar',
      card: { name: 'Durotar', span: 'quests 13–25 (93)', compact: '13–25', basis: 'derived', difficulty: { key: 'difficult', levelText: '18', lowerBound: true }, widthPx: 120 },
      priority: 1,
      minPxPerYard: 0,
      maxPxPerYard: 0.3,
      label: null,
      ref: { kind: 'zone', uiMapId: DUROTAR },
    };
    act(() => {
      handle.publish({ zoneSpans: new Map([[DUROTAR, span]]), places: { labels: { painted: [card], minimap: [card] } } as unknown as PlacesModel });
    });
    expect(document.querySelector('.frl-mapframe__viewing-text')?.textContent).toMatch(/^Viewing Durotar · quests 13–25 \(93 open to an Orc Warrior\)/);
    expect(document.querySelector('.frl-assumed--era-fallback')).not.toBeNull();
    const chip = document.querySelector('.frl-difficulty');
    expect(chip?.getAttribute('data-difficulty')).toBe('difficult');
    expect(chip?.classList.contains('frl-difficulty--uncertain')).toBe(true);
    expect(screen.getByText('Median quest level:')).toBeTruthy();
  });
});
