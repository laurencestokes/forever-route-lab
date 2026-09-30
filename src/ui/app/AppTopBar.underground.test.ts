import { describe, expect, it } from 'vitest';
import type { UiMapId } from '../../domain/ids';
import type { ZoneSpan, ZoneSpans } from '../../app/zone-levels';
import { zoneOptionLabel } from './AppTopBar';

/*
 * The zone select's names in the minimap style (D-049 O19; review PR-17): an underground city says
 * so there, as its label and the "Viewing" chip do; the painted style keeps the plain name.
 */

// A ui file imports no domain values (ARCHITECTURE §4): the id by its type.
const IRONFORGE = 1455 as UiMapId;
const span: ZoneSpan = {
  uiMapId: IRONFORGE,
  name: 'Ironforge',
  open: 0,
  all: 12,
  low: null,
  median: null,
  high: null,
  text: 'no quests for an Orc Warrior',
  detail: 'Ironforge: no quests for an Orc Warrior (12 quests in the dataset)',
  basis: 'derived',
  viewing: 'no quests for an Orc Warrior',
  undergroundName: 'Ironforge (underground city)',
};
const spans: ZoneSpans = new Map([[IRONFORGE, span]]);

describe('zoneOptionLabel (review PR-17)', () => {
  it('names an underground city so in the minimap style only', () => {
    expect(zoneOptionLabel('Ironforge', IRONFORGE, spans, true)).toBe('Ironforge (underground city) · no quests for an Orc Warrior');
    expect(zoneOptionLabel('Ironforge', IRONFORGE, spans, false)).toBe('Ironforge · no quests for an Orc Warrior');
    expect(zoneOptionLabel('Ironforge', IRONFORGE, spans)).toBe('Ironforge · no quests for an Orc Warrior');
  });
});
