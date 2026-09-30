import { describe, expect, it } from 'vitest';
import {
  ROUTE_ROW_HEIGHT,
  ROUTE_ROW_HEIGHT_TWO_LINE,
  ROW_DENSITIES,
  routeRowHeight,
  clampScrollTop,
  computeVirtualWindow,
  dropSlotAtOffset,
  dropTargetIndex,
  listCommandForKey,
  maxScrollTop,
  pageSize,
  rowIndexAtOffset,
  scrollTopToReveal,
  selectionModeForClick,
  type KeyInput,
  type ListKeyState,
} from './virtual';

const H = ROUTE_ROW_HEIGHT;

describe('computeVirtualWindow', () => {
  const base = { rowHeight: H, overscan: 0 };

  it('renders nothing for an empty list', () => {
    expect(computeVirtualWindow({ ...base, scrollTop: 0, viewportHeight: 280, rowCount: 0 })).toEqual({
      start: 0,
      end: 0,
      offsetTop: 0,
      totalHeight: 0,
    });
  });

  it('covers exactly the visible rows at the top', () => {
    // 280px shows rows 0-9 (10 × 28px).
    expect(computeVirtualWindow({ ...base, scrollTop: 0, viewportHeight: 280, rowCount: 1000 })).toEqual({
      start: 0,
      end: 10,
      offsetTop: 0,
      totalHeight: 28000,
    });
  });

  it('includes a partially visible row at each edge', () => {
    // scrollTop 14 shows the bottom half of row 0 and the top half of row 10.
    const w = computeVirtualWindow({ ...base, scrollTop: 14, viewportHeight: 280, rowCount: 1000 });
    expect([w.start, w.end]).toEqual([0, 11]);
  });

  it('adds overscan on both sides, clamped to the list', () => {
    const mid = computeVirtualWindow({ rowHeight: H, overscan: 5, scrollTop: 100 * H, viewportHeight: 10 * H, rowCount: 1000 });
    expect([mid.start, mid.end, mid.offsetTop]).toEqual([95, 115, 95 * H]);
    const top = computeVirtualWindow({ rowHeight: H, overscan: 5, scrollTop: 0, viewportHeight: 10 * H, rowCount: 1000 });
    expect([top.start, top.end]).toEqual([0, 15]);
  });

  it('clamps an over-scrolled position to the last page', () => {
    const w = computeVirtualWindow({ ...base, scrollTop: 1e9, viewportHeight: 10 * H, rowCount: 100 });
    expect([w.start, w.end]).toEqual([90, 100]);
  });

  it('shows everything when the list is shorter than the viewport', () => {
    const w = computeVirtualWindow({ ...base, scrollTop: 50, viewportHeight: 600, rowCount: 3 });
    expect([w.start, w.end, w.totalHeight]).toEqual([0, 3, 84]);
  });

  it('renders at least one row with a zero-height viewport', () => {
    const w = computeVirtualWindow({ ...base, scrollTop: 0, viewportHeight: 0, rowCount: 10 });
    expect([w.start, w.end]).toEqual([0, 1]);
  });

  it('keeps the rendered count bounded for a 10,000-step route', () => {
    for (const scrollTop of [0, 12345, 140000, 279720]) {
      const w = computeVirtualWindow({ rowHeight: H, overscan: 8, scrollTop, viewportHeight: 800, rowCount: 10000 });
      expect(w.end - w.start).toBeLessThanOrEqual(Math.ceil(800 / H) + 1 + 16);
      expect(w.offsetTop).toBe(w.start * H);
    }
  });
});

describe('scroll helpers', () => {
  it('computes the scroll range', () => {
    expect(maxScrollTop(100, H, 280)).toBe(2800 - 280);
    expect(maxScrollTop(3, H, 280)).toBe(0);
    expect(clampScrollTop(-5, 100, H, 280)).toBe(0);
    expect(clampScrollTop(Number.NaN, 100, H, 280)).toBe(0);
    expect(clampScrollTop(5000, 100, H, 280)).toBe(2520);
  });

  it('reveals a row with the smallest scroll change', () => {
    // Viewport 0-280 shows rows 0-9.
    expect(scrollTopToReveal(5, 0, 280, H)).toBe(0);
    expect(scrollTopToReveal(10, 0, 280, H)).toBe(11 * H - 280);
    expect(scrollTopToReveal(3, 10 * H, 280, H)).toBe(3 * H);
    expect(scrollTopToReveal(0, 0, 280, H)).toBe(0);
  });

  it('maps offsets to rows', () => {
    expect(rowIndexAtOffset(0, H, 10)).toBe(0);
    expect(rowIndexAtOffset(27.9, H, 10)).toBe(0);
    expect(rowIndexAtOffset(28, H, 10)).toBe(1);
    expect(rowIndexAtOffset(280, H, 10)).toBeNull();
    expect(rowIndexAtOffset(-1, H, 10)).toBeNull();
  });

  it('pages by the rows that fit, less one', () => {
    expect(pageSize(280, H)).toBe(9);
    expect(pageSize(20, H)).toBe(1);
  });
});

describe('drag and drop math', () => {
  it('picks the nearest gap', () => {
    expect(dropSlotAtOffset(0, H, 10)).toBe(0);
    expect(dropSlotAtOffset(13, H, 10)).toBe(0);
    expect(dropSlotAtOffset(15, H, 10)).toBe(1);
    expect(dropSlotAtOffset(10 * H + 50, H, 10)).toBe(10);
    expect(dropSlotAtOffset(-40, H, 10)).toBe(0);
  });

  it('converts a slot to the index after the move', () => {
    // Moving row 2 down into the gap above row 5 puts it at index 4.
    expect(dropTargetIndex(2, 5)).toBe(4);
    // Moving row 5 up into the gap above row 1 puts it at index 1.
    expect(dropTargetIndex(5, 1)).toBe(1);
    // The gaps directly above and below the row leave it in place.
    expect(dropTargetIndex(3, 3)).toBe(3);
    expect(dropTargetIndex(3, 4)).toBe(3);
    // After the last row.
    expect(dropTargetIndex(0, 10)).toBe(9);
  });
});

describe('listCommandForKey', () => {
  const key = (k: string, mods: Partial<Omit<KeyInput, 'key'>> = {}): KeyInput => ({
    key: k,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...mods,
  });
  const state = (activeIndex: number | null, extra: Partial<ListKeyState> = {}): ListKeyState => ({
    activeIndex,
    rowCount: 100,
    pageSize: 9,
    readOnly: false,
    ...extra,
  });

  it('moves the active row and lets the selection follow', () => {
    expect(listCommandForKey(key('ArrowDown'), state(4))).toEqual({ type: 'navigate', index: 5, selection: 'replace' });
    expect(listCommandForKey(key('ArrowUp'), state(4))).toEqual({ type: 'navigate', index: 3, selection: 'replace' });
    expect(listCommandForKey(key('Home'), state(40))).toEqual({ type: 'navigate', index: 0, selection: 'replace' });
    expect(listCommandForKey(key('End'), state(40))).toEqual({ type: 'navigate', index: 99, selection: 'replace' });
    expect(listCommandForKey(key('PageDown'), state(40))).toEqual({ type: 'navigate', index: 49, selection: 'replace' });
    expect(listCommandForKey(key('PageUp'), state(40))).toEqual({ type: 'navigate', index: 31, selection: 'replace' });
  });

  it('clamps at the ends', () => {
    expect(listCommandForKey(key('ArrowUp'), state(0))).toEqual({ type: 'navigate', index: 0, selection: 'replace' });
    expect(listCommandForKey(key('ArrowDown'), state(99))).toEqual({ type: 'navigate', index: 99, selection: 'replace' });
    expect(listCommandForKey(key('PageDown'), state(95))).toEqual({ type: 'navigate', index: 99, selection: 'replace' });
    expect(listCommandForKey(key('PageUp'), state(3))).toEqual({ type: 'navigate', index: 0, selection: 'replace' });
  });

  it('starts from an edge when nothing is active', () => {
    expect(listCommandForKey(key('ArrowDown'), state(null))).toEqual({ type: 'navigate', index: 0, selection: 'replace' });
    expect(listCommandForKey(key('ArrowUp'), state(null))).toEqual({ type: 'navigate', index: 99, selection: 'replace' });
    expect(listCommandForKey(key(' '), state(null))).toBeNull();
  });

  it('extends with Shift and moves focus only with Ctrl or Cmd', () => {
    expect(listCommandForKey(key('ArrowDown', { shiftKey: true }), state(4))).toEqual({
      type: 'navigate',
      index: 5,
      selection: 'range',
    });
    expect(listCommandForKey(key('End', { shiftKey: true }), state(4))).toEqual({ type: 'navigate', index: 99, selection: 'range' });
    expect(listCommandForKey(key('ArrowDown', { ctrlKey: true }), state(4))).toEqual({
      type: 'navigate',
      index: 5,
      selection: 'none',
    });
    expect(listCommandForKey(key('ArrowDown', { metaKey: true }), state(4))).toEqual({
      type: 'navigate',
      index: 5,
      selection: 'none',
    });
  });

  it('toggles with Space and extends with Shift+Space', () => {
    expect(listCommandForKey(key(' '), state(7))).toEqual({ type: 'select', index: 7, mode: 'toggle' });
    expect(listCommandForKey(key(' ', { ctrlKey: true }), state(7))).toEqual({ type: 'select', index: 7, mode: 'toggle' });
    expect(listCommandForKey(key(' ', { shiftKey: true }), state(7))).toEqual({ type: 'select', index: 7, mode: 'range' });
  });

  it('selects all with Ctrl/Cmd+A', () => {
    expect(listCommandForKey(key('a', { ctrlKey: true }), state(null))).toEqual({ type: 'selectAll' });
    expect(listCommandForKey(key('a', { metaKey: true }), state(3))).toEqual({ type: 'selectAll' });
    expect(listCommandForKey(key('a'), state(3))).toBeNull();
    expect(listCommandForKey(key('a', { ctrlKey: true }), state(null, { rowCount: 0 }))).toBeNull();
  });

  it('maps the editing keys', () => {
    expect(listCommandForKey(key('Enter'), state(2))).toEqual({ type: 'activate', index: 2 });
    expect(listCommandForKey(key('Delete'), state(2))).toEqual({ type: 'delete', index: 2 });
    expect(listCommandForKey(key('l'), state(2))).toEqual({ type: 'toggleLock', index: 2 });
    expect(listCommandForKey(key('L', { shiftKey: true }), state(2))).toEqual({ type: 'toggleLock', index: 2 });
    expect(listCommandForKey(key('d', { ctrlKey: true }), state(2))).toEqual({ type: 'duplicate', index: 2 });
    expect(listCommandForKey(key('d'), state(2))).toBeNull();
    expect(listCommandForKey(key('ArrowUp', { altKey: true }), state(2))).toEqual({ type: 'move', index: 2, delta: -1 });
    expect(listCommandForKey(key('ArrowDown', { altKey: true }), state(2))).toEqual({ type: 'move', index: 2, delta: 1 });
  });

  it('ignores editing keys when read-only but still navigates', () => {
    const ro = state(2, { readOnly: true });
    expect(listCommandForKey(key('Delete'), ro)).toBeNull();
    expect(listCommandForKey(key('l'), ro)).toBeNull();
    expect(listCommandForKey(key('d', { ctrlKey: true }), ro)).toBeNull();
    expect(listCommandForKey(key('ArrowDown', { altKey: true }), ro)).toBeNull();
    expect(listCommandForKey(key('ArrowDown'), ro)).toEqual({ type: 'navigate', index: 3, selection: 'replace' });
    expect(listCommandForKey(key('Enter'), ro)).toEqual({ type: 'activate', index: 2 });
  });

  it('leaves other keys alone', () => {
    expect(listCommandForKey(key('Tab'), state(2))).toBeNull();
    expect(listCommandForKey(key('x'), state(2))).toBeNull();
    expect(listCommandForKey(key('ArrowLeft', { altKey: true }), state(2))).toBeNull();
    expect(listCommandForKey(key('ArrowDown'), state(null, { rowCount: 0 }))).toBeNull();
  });

  it('treats an out-of-range active index as none', () => {
    expect(listCommandForKey(key('Delete'), state(250))).toBeNull();
    expect(listCommandForKey(key('ArrowDown'), state(250))).toEqual({ type: 'navigate', index: 0, selection: 'replace' });
  });
});

describe('selectionModeForClick', () => {
  it('follows the platform conventions', () => {
    expect(selectionModeForClick({ shiftKey: false, ctrlKey: false, metaKey: false })).toBe('replace');
    expect(selectionModeForClick({ shiftKey: false, ctrlKey: true, metaKey: false })).toBe('toggle');
    expect(selectionModeForClick({ shiftKey: false, ctrlKey: false, metaKey: true })).toBe('toggle');
    expect(selectionModeForClick({ shiftKey: true, ctrlKey: true, metaKey: false })).toBe('range');
  });
});

describe('row densities (ui-refresh.md §6, §10.1)', () => {
  it('gives each density one fixed height: 40px two-line rows (the default), 28px one-line rows', () => {
    expect(routeRowHeight('two-line')).toBe(ROUTE_ROW_HEIGHT_TWO_LINE);
    expect(routeRowHeight('one-line')).toBe(ROUTE_ROW_HEIGHT);
    expect(ROUTE_ROW_HEIGHT_TWO_LINE).toBe(40);
    expect(ROW_DENSITIES).toEqual(['two-line', 'one-line']);
  });

  it('windows, pages and reveals by the density’s height', () => {
    const tall = ROUTE_ROW_HEIGHT_TWO_LINE;
    // 13 two-line rows in the mock's 519px list; 8 rows of overscan each side mid-list.
    const view = computeVirtualWindow({ scrollTop: 100 * tall, viewportHeight: 519, rowHeight: tall, rowCount: 10_000, overscan: 8 });
    expect(view.start).toBe(92);
    expect(view.end).toBe(121);
    expect(view.offsetTop).toBe(92 * tall);
    expect(pageSize(519, tall)).toBe(11);
    expect(scrollTopToReveal(200, 0, 519, tall)).toBe(201 * tall - 519);
  });
});
