/**
 * Fixed-row-height virtualisation and list keyboard handling, as pure functions (ARCHITECTURE
 * §12.4: fixed-height rows of one or two lines, in-house index-based virtualisation). RouteList.tsx
 * is a thin shell over these; the tests exercise them directly.
 *
 * Two-line rows have one exception to the fixed height (layout B+, docs/DECISIONS.md D-051): the
 * active row grows by one fixed extra, so row `i` starts at `i × rowHeight`, plus the extra for every
 * row after the grown one (`rowTop`). Every offset below takes that grown row as an optional
 * `GrownRow`; without one the list is plain index arithmetic.
 */

/** One-line route rows (the compact View choice): 28px, matching `--frl-row-height` in tokens.css. */
export const ROUTE_ROW_HEIGHT = 28;

/** Two-line route rows (the default; B+, D-051): 44px, matching `--frl-row-height-two-line` in tokens.css. */
export const ROUTE_ROW_HEIGHT_TWO_LINE = 44;

/**
 * What the active two-line row grows by (D-051): two 16px lines for its issue in full, the NPC and the
 * zone; matching `--frl-row-grow` in tokens.css. One-line rows never grow.
 */
export const ROUTE_ACTIVE_ROW_EXTRA = 32;

/** The route list's row density (docs/research/ui-refresh.md §6): every row of a list has the same height. */
export type RowDensity = 'two-line' | 'one-line';

export const ROW_DENSITIES: readonly RowDensity[] = ['two-line', 'one-line'];

/** The fixed row height of a density: one height for the window, drag, auto-scroll and paging. */
export function routeRowHeight(density: RowDensity): number {
  return density === 'one-line' ? ROUTE_ROW_HEIGHT : ROUTE_ROW_HEIGHT_TWO_LINE;
}

/** The one row taller than the rest (the active two-line row, D-051) and how much taller; null for none. */
export interface GrownRow {
  readonly index: number;
  readonly extra: number;
}

/**
 * Whether the active two-line row may grow in a viewport this tall: only when the grown row and one
 * plain row fit (2 × 44 + 32 = 120px). A shorter list (200% zoom on a 768px-high screen leaves about
 * 61px) keeps the active row at the plain height, so it is never taller than the list.
 */
export function activeRowCanGrow(viewportHeight: number, rowHeight: number, extra: number = ROUTE_ACTIVE_ROW_EXTRA): boolean {
  return viewportHeight >= 2 * rowHeight + extra;
}

/** Rows rendered beyond each edge of the viewport so fast scrolling does not show gaps. */
export const DEFAULT_OVERSCAN = 8;

export interface VirtualWindowInput {
  readonly scrollTop: number;
  readonly viewportHeight: number;
  readonly rowHeight: number;
  readonly rowCount: number;
  readonly overscan: number;
  readonly grown?: GrownRow | null | undefined;
}

/** Rows `[start, end)` are rendered; `offsetTop` is the top of row `start`. */
export interface VirtualWindow {
  readonly start: number;
  readonly end: number;
  readonly offsetTop: number;
  readonly totalHeight: number;
}

/** The extra a grown row adds above row `index` (0 at and above the grown row). */
function extraAbove(index: number, grown: GrownRow | null): number {
  return grown !== null && index > grown.index ? grown.extra : 0;
}

/** The top of row `index`: `index × rowHeight`, plus the grown row's extra below it. Index `rowCount` is the end. */
export function rowTop(index: number, rowHeight: number, grown: GrownRow | null = null): number {
  return index * rowHeight + extraAbove(index, grown);
}

/** The grown row when it is one of the list's rows, else null (a stale index draws nothing taller). */
function grownIn(rowCount: number, grown: GrownRow | null | undefined): GrownRow | null {
  const row = grown ?? null;
  return row !== null && row.index >= 0 && row.index < rowCount ? row : null;
}

export function totalHeight(rowCount: number, rowHeight: number, grown: GrownRow | null = null): number {
  const count = Math.max(0, rowCount);
  return rowTop(count, rowHeight, grownIn(count, grown));
}

/** The largest scrollTop that still shows content (0 when everything fits). */
export function maxScrollTop(rowCount: number, rowHeight: number, viewportHeight: number, grown: GrownRow | null = null): number {
  return Math.max(0, totalHeight(rowCount, rowHeight, grown) - Math.max(0, viewportHeight));
}

export function clampScrollTop(scrollTop: number, rowCount: number, rowHeight: number, viewportHeight: number, grown: GrownRow | null = null): number {
  if (!Number.isFinite(scrollTop)) return 0;
  return Math.min(Math.max(0, scrollTop), maxScrollTop(rowCount, rowHeight, viewportHeight, grown));
}

/** The index of the row (or the end, past the last row) whose box holds `offsetY` (≥ 0), unbounded. */
function indexAt(offsetY: number, rowHeight: number, grown: GrownRow | null): number {
  const plain = Math.floor(offsetY / rowHeight);
  if (grown === null || plain <= grown.index) return plain;
  // Inside the grown row's extra, or below it: count from the extra's end.
  return Math.max(grown.index, Math.floor((offsetY - grown.extra) / rowHeight));
}

export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindow {
  const { rowHeight, rowCount, overscan } = input;
  if (rowCount <= 0 || rowHeight <= 0) return { start: 0, end: 0, offsetTop: 0, totalHeight: 0 };
  const grown = grownIn(rowCount, input.grown);
  const height = totalHeight(rowCount, rowHeight, grown);
  const viewportHeight = Math.max(0, input.viewportHeight);
  const scrollTop = clampScrollTop(input.scrollTop, rowCount, rowHeight, viewportHeight, grown);
  const firstVisible = indexAt(scrollTop, rowHeight, grown);
  // A viewport of height h starting mid-row can touch the rows up to the one its bottom edge is in.
  const bottom = scrollTop + viewportHeight;
  const last = indexAt(bottom, rowHeight, grown);
  const lastVisibleExclusive = rowTop(last, rowHeight, grown) < bottom ? last + 1 : last;
  const start = Math.max(0, firstVisible - Math.max(0, overscan));
  const end = Math.min(rowCount, Math.max(lastVisibleExclusive, firstVisible + 1) + Math.max(0, overscan));
  return { start, end, offsetTop: rowTop(start, rowHeight, grown), totalHeight: height };
}

/** Whole rows that fit in the viewport, at least 1. PageUp/PageDown move by one page less a row. */
export function pageSize(viewportHeight: number, rowHeight: number): number {
  if (rowHeight <= 0) return 1;
  return Math.max(1, Math.floor(viewportHeight / rowHeight) - 1);
}

/**
 * The scrollTop that brings row `index` fully into view, changing as little as possible:
 * unchanged if already visible, else aligned to the nearer edge. A grown row is revealed by its
 * whole box; a row taller than the viewport is aligned to its top.
 */
export function scrollTopToReveal(index: number, scrollTop: number, viewportHeight: number, rowHeight: number, grown: GrownRow | null = null): number {
  const top = rowTop(index, rowHeight, grown);
  const bottom = top + rowHeight + (grown !== null && grown.index === index ? grown.extra : 0);
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewportHeight) return Math.max(0, Math.min(top, bottom - viewportHeight));
  return scrollTop;
}

/** The row under a y offset measured from the top of the list content (scroll included). */
export function rowIndexAtOffset(offsetY: number, rowHeight: number, rowCount: number, grown: GrownRow | null = null): number | null {
  if (rowCount <= 0 || rowHeight <= 0 || offsetY < 0) return null;
  const index = indexAt(offsetY, rowHeight, grownIn(rowCount, grown));
  return index < rowCount ? index : null;
}

/**
 * Drag and drop. A drop *slot* is a gap between rows: slot `s` is just above row `s`, and slot
 * `rowCount` is after the last row. The slot is the gap nearest to the pointer; a grown row's gaps
 * are its top and its bottom, extra included.
 */
export function dropSlotAtOffset(offsetY: number, rowHeight: number, rowCount: number, grown: GrownRow | null = null): number {
  if (rowCount <= 0 || rowHeight <= 0) return 0;
  const g = grownIn(rowCount, grown);
  let slot: number;
  if (g === null) slot = Math.round(offsetY / rowHeight);
  else if (offsetY < g.index * rowHeight + (rowHeight + g.extra) / 2) slot = Math.min(g.index, Math.round(offsetY / rowHeight));
  else slot = Math.max(g.index + 1, Math.round((offsetY - g.extra) / rowHeight));
  return Math.min(rowCount, Math.max(0, slot));
}

/**
 * The index the dragged row ends up at when dropped into `slot`, counted after the move (the
 * convention of a `move(from, to)` operation). Slots directly above and below the row itself
 * leave it where it is.
 */
export function dropTargetIndex(fromIndex: number, slot: number): number {
  return slot > fromIndex ? slot - 1 : slot;
}

// Keyboard ---------------------------------------------------------------------------------

export type SelectionMode = 'replace' | 'toggle' | 'range';

export interface KeyInput {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}

export interface ListKeyState {
  readonly activeIndex: number | null;
  readonly rowCount: number;
  readonly pageSize: number;
  /** Editing commands (move, delete, lock, duplicate) are ignored while read-only. */
  readonly readOnly: boolean;
}

/**
 * What a key press means. `navigate` always moves the active row; its `selection` says what
 * happens to the selection: `replace` (plain arrows: selection follows focus), `range` (Shift:
 * extend from the anchor) or `none` (Ctrl/Cmd: move focus only, keep the selection).
 */
export type ListCommand =
  | { readonly type: 'navigate'; readonly index: number; readonly selection: 'replace' | 'range' | 'none' }
  | { readonly type: 'select'; readonly index: number; readonly mode: SelectionMode }
  | { readonly type: 'selectAll' }
  | { readonly type: 'activate'; readonly index: number }
  | { readonly type: 'move'; readonly index: number; readonly delta: -1 | 1 }
  | { readonly type: 'delete'; readonly index: number }
  | { readonly type: 'toggleLock'; readonly index: number }
  | { readonly type: 'duplicate'; readonly index: number };

function navigationTarget(key: string, active: number | null, count: number, page: number): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  switch (key) {
    case 'ArrowDown':
      return active === null ? 0 : Math.min(last, active + 1);
    case 'ArrowUp':
      return active === null ? last : Math.max(0, active - 1);
    case 'Home':
      return 0;
    case 'End':
      return last;
    case 'PageDown':
      return active === null ? Math.min(last, page) : Math.min(last, active + page);
    case 'PageUp':
      return active === null ? 0 : Math.max(0, active - page);
    default:
      return null;
  }
}

/**
 * Maps a key press to a list command, or null when the list does not handle the key (the caller
 * then leaves the event alone). Key map (docs/UI.md, "Route list"):
 *
 * | Keys | Command |
 * |---|---|
 * | ↑ ↓ Home End PageUp PageDown | move the active row; selection follows |
 * | Shift + those | extend the selection from the anchor |
 * | Ctrl/Cmd + those | move the active row only |
 * | Space / Ctrl+Space / Shift+Space | toggle / toggle / extend to the active row |
 * | Ctrl/Cmd+A | select all |
 * | Enter | activate (open details) |
 * | Alt+↑ / Alt+↓ | move the step up / down |
 * | Delete | delete |
 * | L | lock or unlock |
 * | Ctrl/Cmd+D | duplicate |
 */
export function listCommandForKey(input: KeyInput, state: ListKeyState): ListCommand | null {
  const { key, shiftKey, altKey } = input;
  const mod = input.ctrlKey || input.metaKey;
  const { activeIndex, rowCount, readOnly } = state;
  const hasActive = activeIndex !== null && activeIndex >= 0 && activeIndex < rowCount;

  if (altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
    if (readOnly || !hasActive || mod || shiftKey) return null;
    return { type: 'move', index: activeIndex, delta: key === 'ArrowUp' ? -1 : 1 };
  }
  if (altKey) return null;

  const target = navigationTarget(key, hasActive ? activeIndex : null, rowCount, state.pageSize);
  if (target !== null) {
    return { type: 'navigate', index: target, selection: shiftKey ? 'range' : mod ? 'none' : 'replace' };
  }

  if (mod && !shiftKey && (key === 'a' || key === 'A')) return rowCount > 0 ? { type: 'selectAll' } : null;
  if (!hasActive) return null;

  switch (key) {
    case ' ':
    case 'Spacebar':
      return { type: 'select', index: activeIndex, mode: shiftKey ? 'range' : 'toggle' };
    case 'Enter':
      return mod || shiftKey ? null : { type: 'activate', index: activeIndex };
    case 'Delete':
      return readOnly || mod || shiftKey ? null : { type: 'delete', index: activeIndex };
    case 'l':
    case 'L':
      return readOnly || mod ? null : { type: 'toggleLock', index: activeIndex };
    case 'd':
    case 'D':
      return readOnly || !mod || shiftKey ? null : { type: 'duplicate', index: activeIndex };
    default:
      return null;
  }
}

/** Selection mode for a pointer click with these modifiers. */
export function selectionModeForClick(input: Pick<KeyInput, 'shiftKey' | 'ctrlKey' | 'metaKey'>): SelectionMode {
  if (input.shiftKey) return 'range';
  if (input.ctrlKey || input.metaKey) return 'toggle';
  return 'replace';
}
