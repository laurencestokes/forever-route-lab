// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapCategoryDrawer, type DrawerGroup, type DrawerRow, type MapCategoryDrawerProps } from './MapCategoryDrawer';

afterEach(cleanup);

/*
 * The Map layers drawer, presentational (docs/research/map-presentation.md §25.3.1-§25.3.8; step
 * MP.4b): its rows' names, counts and notes, the groups' boxes and their keyboard (one stop each,
 * a roving tabindex), Escape, the style control, and the search's results in place of the groups.
 */

const row = (id: string, fields: Partial<DrawerRow> = {}): DrawerRow => ({
  id,
  label: id,
  icon: { kind: 'pin', glyph: 'quest' },
  shown: true,
  unavailable: null,
  count: null,
  name: `${id}, shown`,
  title: null,
  notes: [],
  ...fields,
});

const QUESTS: DrawerGroup = {
  id: 'quests',
  title: 'Quests',
  subtitle: 'after step 12',
  state: 'mixed',
  collapsed: false,
  rows: [
    row('available', { label: 'Available', count: '209 · 118 givers', name: 'Available: 209 quests at 118 givers after step 12, shown', title: '14 in view' }),
    row('unlocks-soon', { label: 'Unlocks soon', shown: false, name: 'Unlocks soon: after step 12, hidden', notes: ['Within 2 levels'] }),
    row('dungeons', { label: 'Dungeons', unavailable: 'Not drawn yet: dungeons arrive with a later step', name: 'Dungeons, hidden' }),
  ],
};

const ROUTE: DrawerGroup = { id: 'route-and-map', title: 'Route and map', subtitle: null, state: true, collapsed: false, rows: [row('route-line', { label: 'Route line', icon: { kind: 'swatch', swatch: 'route' } })] };

function drawer(overrides: Partial<MapCategoryDrawerProps> = {}) {
  const props: MapCategoryDrawerProps = {
    id: 'map-layers',
    docked: false,
    style: {
      value: 'minimap',
      options: [
        { value: 'minimap', label: 'Minimap' },
        { value: 'painted', label: 'Painted' },
      ],
      onChange: vi.fn(),
      note: null,
    },
    notices: [],
    groups: [QUESTS, ROUTE],
    onRow: vi.fn(),
    onGroup: vi.fn(),
    onCollapse: vi.fn(),
    onShowAll: vi.fn(),
    onHideAll: vi.fn(),
    onDefaults: vi.fn(),
    search: { query: '', onQuery: vi.fn(), onFocus: vi.fn(), results: null, onChoose: vi.fn(), onFit: vi.fn(), status: '' },
    onClose: vi.fn(),
    keyContent: <p>Key content</p>,
    ...overrides,
  };
  render(<MapCategoryDrawer {...props} />);
  return props;
}

const region = () => within(screen.getByRole('region', { name: 'Map layers' }));
const boxesIn = (name: string) => [...within(screen.getByRole('group', { name })).getAllByRole('checkbox')] as HTMLInputElement[];

describe('the Map layers drawer (§25.3)', () => {
  it('names each row with its count and state, shows the count and the tooltip, and describes notes and why a row is unavailable', () => {
    const props = drawer();
    const available = region().getByRole('checkbox', { name: 'Available: 209 quests at 118 givers after step 12, shown' });
    expect(available).toHaveProperty('checked', true);
    const label = available.closest('label');
    expect(label?.querySelector('.frl-mapdrawer__count')?.textContent).toBe('209 · 118 givers');
    expect(label?.getAttribute('title')).toBe('14 in view');
    // No notes: not described.
    expect(available.hasAttribute('aria-describedby')).toBe(false);
    const soon = region().getByRole('checkbox', { name: 'Unlocks soon: after step 12, hidden' });
    expect(soon).toHaveProperty('checked', false);
    expect(document.getElementById(soon.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Within 2 levels');
    const dungeons = region().getByRole('checkbox', { name: 'Dungeons, hidden' });
    // Unavailable: focusable, described and inert (UI.md §9 rule 6).
    expect(dungeons.getAttribute('aria-disabled')).toBe('true');
    expect(dungeons).toHaveProperty('disabled', false);
    expect(dungeons).toHaveProperty('checked', false);
    fireEvent.click(dungeons);
    expect(dungeons).toHaveProperty('checked', false);
    expect(props.onRow).not.toHaveBeenCalled();
    expect(document.getElementById(dungeons.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Not drawn yet: dungeons arrive with a later step');
    fireEvent.click(soon);
    expect(props.onRow).toHaveBeenCalledWith('unlocks-soon', true);
    fireEvent.click(available);
    expect(props.onRow).toHaveBeenLastCalledWith('available', false);
  });

  it('gives each group one tab stop, moves with Up, Down, Home and End, and shows a mixed group as mixed', () => {
    const props = drawer();
    const quests = boxesIn('Quests, after step 12');
    // The group's own box, then its rows.
    expect(quests.map((box) => box.tabIndex)).toEqual([0, -1, -1, -1]);
    expect(quests[0]?.getAttribute('aria-checked')).toBe('mixed');
    expect(quests[0]?.indeterminate).toBe(true);
    expect(boxesIn('Route and map').map((box) => box.tabIndex)).toEqual([0, -1]);
    const [head, first, second, third] = quests as [HTMLInputElement, HTMLInputElement, HTMLInputElement, HTMLInputElement];
    head.focus();
    fireEvent.keyDown(head, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(first);
    expect(quests.map((box) => box.tabIndex)).toEqual([-1, 0, -1, -1]);
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: 'End' });
    // An unavailable row is still reached (its reason is its description).
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(third, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(third, { key: 'Home' });
    expect(document.activeElement).toBe(head);
    fireEvent.keyDown(head, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(head);
    // Pressing a mixed box shows the whole group.
    fireEvent.click(head);
    expect(props.onGroup).toHaveBeenCalledWith('quests', true);
  });

  it('collapses and expands a group from its box with Enter, Left and Right, and from its chevron; a row’s Enter does nothing', () => {
    const props = drawer();
    const [head, first] = boxesIn('Quests, after step 12') as [HTMLInputElement, HTMLInputElement];
    fireEvent.keyDown(head, { key: 'Enter' });
    expect(props.onCollapse).toHaveBeenLastCalledWith('quests', true);
    fireEvent.keyDown(head, { key: 'ArrowLeft' });
    expect(props.onCollapse).toHaveBeenLastCalledWith('quests', true);
    fireEvent.keyDown(head, { key: 'ArrowRight' });
    expect(props.onCollapse).toHaveBeenLastCalledWith('quests', false);
    fireEvent.keyDown(first, { key: 'Enter' });
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(props.onCollapse).toHaveBeenCalledTimes(3);
    const chevron = region().getByRole('button', { name: 'Collapse Quests' });
    expect(chevron.getAttribute('aria-expanded')).toBe('true');
    expect(chevron.tabIndex).toBe(-1);
    fireEvent.click(chevron);
    expect(props.onCollapse).toHaveBeenLastCalledWith('quests', true);
    cleanup();
    drawer({ groups: [{ ...QUESTS, collapsed: true }] });
    // Collapsed: the rows go, the box stays the group's stop.
    expect(boxesIn('Quests, after step 12')).toHaveLength(1);
    expect(region().getByRole('button', { name: 'Expand Quests' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('runs Show all, Hide all and Defaults from one toolbar', () => {
    const props = drawer();
    const toolbar = within(region().getByRole('toolbar', { name: 'All map categories' }));
    fireEvent.click(toolbar.getByRole('button', { name: 'Show all map categories' }));
    fireEvent.click(toolbar.getByRole('button', { name: 'Hide all map categories' }));
    fireEvent.click(toolbar.getByRole('button', { name: 'Restore the default map categories' }));
    expect([props.onShowAll, props.onHideAll, props.onDefaults].map((fn) => (fn as ReturnType<typeof vi.fn>).mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('closes on Escape and from its close button over the map; docked, it has neither', () => {
    const props = drawer();
    fireEvent.keyDown(boxesIn('Route and map')[1] as HTMLElement, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(region().getByRole('button', { name: 'Close Map layers' }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
    cleanup();
    const docked = drawer({ docked: true });
    expect(screen.queryByRole('button', { name: 'Close Map layers' })).toBeNull();
    fireEvent.keyDown(boxesIn('Route and map')[1] as HTMLElement, { key: 'Escape' });
    expect(docked.onClose).not.toHaveBeenCalled();
  });

  it('clears the search field on its first Escape, and closes the drawer on the next', () => {
    const onQuery = vi.fn();
    const props = drawer({ search: { query: 'gor', onQuery, onFocus: vi.fn(), results: { summary: 'No results for “gor”', groups: [], more: null }, onChoose: vi.fn(), onFit: vi.fn(), status: 'No results' } });
    const field = region().getByRole('searchbox', { name: 'Search the map' });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(onQuery).toHaveBeenCalledWith('');
    expect(props.onClose).not.toHaveBeenCalled();
    cleanup();
    const empty = drawer();
    fireEvent.keyDown(region().getByRole('searchbox', { name: 'Search the map' }), { key: 'Escape' });
    expect(empty.onClose).toHaveBeenCalledTimes(1);
  });

  it('offers the map style as one radio group, described by its note, and lists the map’s notices', () => {
    const props = drawer({
      style: {
        value: 'painted',
        options: [
          { value: 'minimap', label: 'Minimap', unavailable: 'Styles apply to the seamless atlas' },
          { value: 'painted', label: 'Painted', unavailable: 'Styles apply to the seamless atlas' },
        ],
        onChange: vi.fn(),
        note: 'Styles apply to the seamless atlas',
      },
      notices: ['Terrain data could not be loaded: no relief, zone outlines or coastline'],
    });
    const group = region().getByRole('group', { name: 'Map style' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((radio) => radio.closest('label')?.textContent)).toEqual(['Minimap', 'Painted']);
    expect(radios.every((radio) => (radio as HTMLInputElement).disabled)).toBe(true);
    expect(region().getByText('Styles apply to the seamless atlas')).toBeTruthy();
    expect(region().getByText('Terrain data could not be loaded: no relief, zone outlines or coastline')).toBeTruthy();
    expect(props.style.onChange).not.toHaveBeenCalled();
    cleanup();
    const live = drawer();
    fireEvent.click(within(region().getByRole('group', { name: 'Map style' })).getByRole('radio', { name: 'Painted' }));
    expect(live.style.onChange).toHaveBeenCalledWith('painted');
  });

  it('shows a query’s results in place of the groups, moves between the field and the results, and chooses one', () => {
    const onFocus = vi.fn();
    const props = drawer({
      search: {
        query: 'gor',
        onQuery: vi.fn(),
        onFocus,
        results: {
          summary: '2 results: 1 quest, 1 NPC',
          groups: [
            {
              title: 'Quests',
              results: [
                { id: 'npc:3143', icon: { kind: 'pin', glyph: 'quest' }, name: 'Gornek', line: 'NPC · Durotar' },
                { id: 'quest:788', icon: { kind: 'pin', glyph: 'quest' }, name: 'Cutting Teeth', line: 'Start: Gornek · level 2 · available after step 12' },
              ],
            },
          ],
          more: 'and 4 more: type more to narrow the search',
        },
        onChoose: vi.fn(),
        onFit: vi.fn(),
        status: '6 results',
      },
    });
    expect(screen.queryByRole('group', { name: 'Quests, after step 12' })).toBeNull();
    expect(region().getByText('2 results: 1 quest, 1 NPC')).toBeTruthy();
    expect(region().getByText('and 4 more: type more to narrow the search')).toBeTruthy();
    expect(region().getByRole('status').textContent).toBe('6 results');
    const field = region().getByRole('searchbox', { name: 'Search the map' });
    fireEvent.focus(field);
    expect(onFocus).toHaveBeenCalled();
    const results = within(region().getByRole('region', { name: 'Quests' })).getAllByRole('button');
    expect(results.map((button) => button.tabIndex)).toEqual([0, -1]);
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(results[0]);
    fireEvent.keyDown(results[0] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(results[1]);
    fireEvent.keyDown(results[1] as HTMLElement, { key: 'Home' });
    expect(document.activeElement).toBe(results[0]);
    fireEvent.keyDown(results[0] as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(field);
    fireEvent.click(results[1] as HTMLElement);
    expect(props.search.onChoose).toHaveBeenCalledWith('quest:788');
    const toolbar = within(region().getByRole('toolbar', { name: 'Search results' }));
    fireEvent.click(toolbar.getByRole('button', { name: 'Fit results on the map' }));
    expect(props.search.onFit).toHaveBeenCalledTimes(1);
    fireEvent.click(toolbar.getByRole('button', { name: 'Clear search' }));
    expect(props.search.onQuery).toHaveBeenCalledWith('');
  });

  it('keeps the key in a closed disclosure at its foot', () => {
    drawer();
    const key = region().getByText('Key').closest('details');
    expect(key?.open).toBe(false);
    expect(key?.textContent).toContain('Key content');
  });
});
