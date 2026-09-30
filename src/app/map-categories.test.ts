import { describe, expect, it } from 'vitest';
import { categoryOfMark, MAP_CATEGORY_IDS } from '../map/adapter';
import { categoryOfMarkState } from '../map/layers';
import { MARK_STATE_NAMES } from '../map/marks';
import {
  DEFAULT_HIDDEN_CATEGORIES,
  groupState,
  hideAll,
  layerVisibility,
  MAP_CATEGORY_GROUP_IDS,
  MAP_CATEGORY_ROWS,
  maskOf,
  normaliseHidden,
  PIN_CATEGORY_IDS,
  questRowsShown,
  setCategory,
  setGroup,
  SHOW_ALL,
} from './map-categories';

/*
 * The Map layers drawer's rows (docs/research/map-presentation.md §25.3.2-§25.3.4; step MP.4b):
 * one row per category, their defaults, the group and "Show all | Hide all | Defaults" rules, and
 * how a hidden set reaches the map (the adapter's mask, the store's layers).
 */

describe('the map categories (§25.3.2)', () => {
  it('has one row per category, in five groups, in the adapter’s order', () => {
    expect(MAP_CATEGORY_ROWS.map((row) => row.id)).toEqual(MAP_CATEGORY_IDS);
    expect([...new Set(MAP_CATEGORY_ROWS.map((row) => row.group))]).toEqual(MAP_CATEGORY_GROUP_IDS);
  });

  it('hides by default only the rows the design names (§25.3.2)', () => {
    expect(DEFAULT_HIDDEN_CATEGORIES).toEqual(['unlocks-soon', 'low-level', 'unconfirmed-raids', 'all-flights', 'other-faction-flights', 'zone-faction', 'coastline']);
  });

  it('keeps a hidden set in the rows’ order and drops unknown ids, repeats and non-strings (a kept record may be stale)', () => {
    expect(normaliseHidden(['coastline', 'available', 'available', 'no-such-row', 7, null])).toEqual(['available', 'coastline']);
  });

  it('shows or hides a group as one, and says when it is mixed', () => {
    const quests = setGroup([], 'quests', false);
    expect(quests).toEqual(['available', 'may-be-available', 'needs-prerequisite', 'unlocks-soon', 'low-level', 'turn-ins', 'objectives']);
    expect(groupState('quests', new Set(quests))).toBe(false);
    expect(groupState('quests', new Set(DEFAULT_HIDDEN_CATEGORIES))).toBe('mixed');
    expect(groupState('services', new Set(DEFAULT_HIDDEN_CATEGORIES))).toBe(true);
    expect(setGroup(DEFAULT_HIDDEN_CATEGORIES, 'quests', true)).toEqual(['unconfirmed-raids', 'all-flights', 'other-faction-flights', 'zone-faction', 'coastline']);
    expect(setCategory(DEFAULT_HIDDEN_CATEGORIES, 'coastline', true)).not.toContain('coastline');
    expect(setCategory([], 'turn-ins', false)).toEqual(['turn-ins']);
  });

  it('shows everything on Show all; Hide all hides every pin row and leaves Route and map as they were', () => {
    expect(SHOW_ALL).toEqual([]);
    const hidden = hideAll(['route-line', 'available']);
    expect(hidden.filter((id) => !PIN_CATEGORY_IDS.includes(id))).toEqual(['route-line']);
    expect(PIN_CATEGORY_IDS.every((id) => hidden.includes(id))).toBe(true);
    // The route is never lost by Hide all.
    expect(hideAll([])).not.toContain('route-line');
    expect(hideAll([])).not.toContain('step-numbers');
  });

  it('gives the adapter only the pin rows, and the store the layer rows', () => {
    expect(maskOf(['available', 'route-line', 'walking-paths', 'relief'])).toEqual({ hidden: ['available'], only: null });
    const only = { subjects: ['npc:3143'], quests: [] };
    expect(maskOf([], only)).toEqual({ hidden: [], only });
    const layers = layerVisibility(new Set(['route-line', 'coastline'] as const));
    expect(layers.get('route-line')).toBe(false);
    expect(layers.get('coastline')).toBe(false);
    expect(layers.get('relief')).toBe(true);
    expect(layers.has('available-quests')).toBe(false);
  });

  it('files a quest state under the same row in the builder and the adapter (map/layers keeps its own copy of the table)', () => {
    for (const state of MARK_STATE_NAMES) expect(categoryOfMarkState(state), state).toBe(categoryOfMark(state));
    expect(categoryOfMarkState(null)).toBe(categoryOfMark(null));
  });

  it('builds the givers of Unlocks soon and Low level only while their rows are shown', () => {
    expect([...questRowsShown(new Set(DEFAULT_HIDDEN_CATEGORIES))]).toEqual(['available', 'may-be-available', 'needs-prerequisite']);
    expect([...questRowsShown(new Set())]).toEqual(['available', 'may-be-available', 'needs-prerequisite', 'unlocks-soon', 'low-level']);
  });
});
