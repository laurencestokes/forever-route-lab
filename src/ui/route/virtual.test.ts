import { describe, expect, it } from 'vitest';
import {
  ROUTE_ROW_HEIGHT,
  ROUTE_ROW_HEIGHT_TWO_LINE,
  ROUTE_ACTIVE_ROW_EXTRA,
  ROW_DENSITIES,
  activeRowCanGrow,
  routeRowHeight,
  clampScrollTop,
  computeVirtualWindow,
  dropSlotAtOffset,
  dropTargetIndex,
  listCommandForKey,
  maxScrollTop,
  pageSize,
  rowIndexAtOffset,
  rowTop,
  scrollTopToReveal,
  selectionModeForClick,
  totalHeight,
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
  it('gives each density one fixed height: 44px two-line rows (the default, B+), 28px one-line rows', () => {
    expect(routeRowHeight('two-line')).toBe(ROUTE_ROW_HEIGHT_TWO_LINE);
    expect(routeRowHeight('one-line')).toBe(ROUTE_ROW_HEIGHT);
    expect(ROUTE_ROW_HEIGHT_TWO_LINE).toBe(44);
    expect(ROUTE_ACTIVE_ROW_EXTRA).toBe(32);
    expect(ROW_DENSITIES).toEqual(['two-line', 'one-line']);
  });

  it('windows, pages and reveals by the density’s height', () => {
    const tall = ROUTE_ROW_HEIGHT_TWO_LINE;
    // 11 whole two-line rows in the sample's 505px list (D-051); 8 rows of overscan each side mid-list.
    const view = computeVirtualWindow({ scrollTop: 100 * tall, viewportHeight: 505, rowHeight: tall, rowCount: 10_000, overscan: 8 });
    expect(view.start).toBe(92);
    expect(view.end).toBe(120);
    expect(view.offsetTop).toBe(92 * tall);
    expect(pageSize(505, tall)).toBe(10);
    expect(scrollTopToReveal(200, 0, 505, tall)).toBe(201 * tall - 505);
  });
});

describe('the grown active row (B+, D-051): index × 44 plus one fixed extra below it', () => {
  it('grows the active row only in a list that holds it and one plain row (2 × 44 + 32 = 120px)', () => {
    expect(activeRowCanGrow(120, ROUTE_ROW_HEIGHT_TWO_LINE)).toBe(true);
    expect(activeRowCanGrow(560, ROUTE_ROW_HEIGHT_TWO_LINE)).toBe(true);
    expect(activeRowCanGrow(119, ROUTE_ROW_HEIGHT_TWO_LINE)).toBe(false);
    // 200% zoom on a 768px-high screen: a 61px list, shorter than the 76px grown row.
    expect(activeRowCanGrow(61, ROUTE_ROW_HEIGHT_TWO_LINE)).toBe(false);
    expect(activeRowCanGrow(2 * ROUTE_ROW_HEIGHT_TWO_LINE + ROUTE_ACTIVE_ROW_EXTRA, ROUTE_ROW_HEIGHT_TWO_LINE)).toBe(true);
  });

  const h = ROUTE_ROW_HEIGHT_TWO_LINE;
  const x = ROUTE_ACTIVE_ROW_EXTRA;
  const at = (index: number) => ({ index, extra: x });

  it('puts every row after the grown one down by the extra, and no other', () => {
    expect([0, 4, 5, 6, 9].map((i) => rowTop(i, h, at(5)))).toEqual([0, 4 * h, 5 * h, 6 * h + x, 9 * h + x]);
    expect(rowTop(7, h)).toBe(7 * h);
    expect(rowTop(7, h, null)).toBe(7 * h);
    // First, last and absent.
    expect(totalHeight(10, h, at(0))).toBe(10 * h + x);
    expect(totalHeight(10, h, at(9))).toBe(10 * h + x);
    expect(totalHeight(10, h, null)).toBe(10 * h);
    // An index outside the list grows nothing.
    expect(totalHeight(10, h, at(10))).toBe(10 * h);
    expect(totalHeight(10, h, at(-1))).toBe(10 * h);
    expect(maxScrollTop(20, h, 505, at(3))).toBe(20 * h + x - 505);
    expect(clampScrollTop(10_000, 20, h, 505, at(3))).toBe(20 * h + x - 505);
  });

  it('finds the row under an offset, the grown row through its extra', () => {
    const g = at(5);
    expect(rowIndexAtOffset(5 * h - 1, h, 10, g)).toBe(4);
    expect(rowIndexAtOffset(5 * h, h, 10, g)).toBe(5);
    expect(rowIndexAtOffset(6 * h, h, 10, g)).toBe(5);
    expect(rowIndexAtOffset(6 * h + x - 1, h, 10, g)).toBe(5);
    expect(rowIndexAtOffset(6 * h + x, h, 10, g)).toBe(6);
    expect(rowIndexAtOffset(10 * h + x - 1, h, 10, g)).toBe(9);
    expect(rowIndexAtOffset(10 * h + x, h, 10, g)).toBeNull();
    // The grown row first and last.
    expect(rowIndexAtOffset(h + x - 1, h, 10, at(0))).toBe(0);
    expect(rowIndexAtOffset(h + x, h, 10, at(0))).toBe(1);
    expect(rowIndexAtOffset(9 * h + x + 5, h, 10, at(9))).toBe(9);
    // Absent: plain arithmetic.
    expect(rowIndexAtOffset(6 * h, h, 10, null)).toBe(6);
  });

  it('drops into the gap nearest the pointer, the grown row\'s gaps at its top and its bottom', () => {
    const g = at(5);
    expect(dropSlotAtOffset(5 * h + 3, h, 10, g)).toBe(5);
    // The grown row's middle is 5h + (h + x) / 2: above it its top, below it its bottom.
    expect(dropSlotAtOffset(5 * h + (h + x) / 2 - 1, h, 10, g)).toBe(5);
    expect(dropSlotAtOffset(5 * h + (h + x) / 2 + 1, h, 10, g)).toBe(6);
    expect(dropSlotAtOffset(6 * h + x + 3, h, 10, g)).toBe(6);
    expect(dropSlotAtOffset(7 * h + x - 3, h, 10, g)).toBe(7);
    expect(dropSlotAtOffset(4 * h + 3, h, 10, g)).toBe(4);
    expect(dropSlotAtOffset(10 * h + x + 50, h, 10, g)).toBe(10);
    expect(dropSlotAtOffset(-50, h, 10, g)).toBe(0);
    expect(dropSlotAtOffset((h + x) / 2 - 2, h, 10, at(0))).toBe(0);
    expect(dropSlotAtOffset(h + x - 2, h, 10, at(0))).toBe(1);
    expect(dropSlotAtOffset(10 * h + x - 2, h, 10, at(9))).toBe(10);
    expect(dropSlotAtOffset(6 * h - 2, h, 10, null)).toBe(6);
  });

  it('windows the rows by their real offsets', () => {
    // The grown row above the viewport: the first visible row is found past its extra.
    const above = computeVirtualWindow({ scrollTop: 20 * h + x, viewportHeight: 505, rowHeight: h, rowCount: 1000, overscan: 0, grown: at(5) });
    expect(above.start).toBe(20);
    expect(above.offsetTop).toBe(20 * h + x);
    expect(above.end).toBe(32);
    expect(above.totalHeight).toBe(1000 * h + x);
    // The grown row in the viewport takes its extra's room: the window ends a row earlier than without it.
    const inside = computeVirtualWindow({ scrollTop: 0, viewportHeight: 505, rowHeight: h, rowCount: 1000, overscan: 0, grown: at(3) });
    expect(inside.start).toBe(0);
    expect(inside.end).toBe(11);
    const plain = computeVirtualWindow({ scrollTop: 0, viewportHeight: 505, rowHeight: h, rowCount: 1000, overscan: 0 });
    expect(plain.end).toBe(12);
    const exact = computeVirtualWindow({ scrollTop: 0, viewportHeight: 11 * h + x, rowHeight: h, rowCount: 1000, overscan: 0, grown: at(3) });
    expect(exact.end).toBe(11);
    // Below the viewport: unchanged.
    const below = computeVirtualWindow({ scrollTop: 0, viewportHeight: 505, rowHeight: h, rowCount: 1000, overscan: 2, grown: at(500) });
    expect(below).toEqual({ ...plain, end: 14, totalHeight: 1000 * h + x });
    // One-line rows never grow: the same arithmetic with no grown row.
    const compact = computeVirtualWindow({ scrollTop: 0, viewportHeight: 505, rowHeight: ROUTE_ROW_HEIGHT, rowCount: 1000, overscan: 0, grown: null });
    expect(compact.end).toBe(Math.ceil(505 / ROUTE_ROW_HEIGHT));
  });

  it('reveals the grown row by its whole box, and the rows after it at their shifted offsets', () => {
    // Below the viewport: its bottom, extra included, meets the viewport's.
    expect(scrollTopToReveal(20, 0, 505, h, at(20))).toBe(21 * h + x - 505);
    // Above: its top.
    expect(scrollTopToReveal(3, 600, 505, h, at(3))).toBe(3 * h);
    // A row after the grown one.
    expect(scrollTopToReveal(30, 0, 505, h, at(3))).toBe(31 * h + x - 505);
    expect(scrollTopToReveal(30, 31 * h + x - 505, 505, h, at(3))).toBe(31 * h + x - 505);
    // A grown row taller than the viewport shows its top.
    expect(scrollTopToReveal(20, 0, 60, h, at(20))).toBe(20 * h);
    // Paging still counts whole 44px rows: 10 rows in the 505px list.
    expect(pageSize(505, h)).toBe(10);
  });
});
