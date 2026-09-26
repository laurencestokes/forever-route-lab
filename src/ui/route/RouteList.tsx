import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { cx } from '../lib/cx';
import { GroupRow, StepRow } from './StepRow';
import { routeRowContext, type RouteRowModel } from './rows';
import {
  DEFAULT_OVERSCAN,
  ROUTE_ROW_HEIGHT,
  computeVirtualWindow,
  dropSlotAtOffset,
  dropTargetIndex,
  listCommandForKey,
  pageSize,
  scrollTopToReveal,
  selectionModeForClick,
  type ListCommand,
  type SelectionMode,
} from './virtual';
import './RouteList.css';

export interface RouteListProps {
  readonly rows: readonly RouteRowModel[];
  /** Accessible name of the list, e.g. the route name. */
  readonly label: string;
  /** Index of the active (keyboard focus) row, or null. Controlled: the store owns it. */
  readonly activeIndex: number | null;
  /** Keys (`row.key`) of the selected rows. */
  readonly selectedKeys: ReadonlySet<string>;
  readonly onActiveIndexChange: (index: number) => void;
  /**
   * Selection intent at `index`: `replace` (plain click or arrow), `toggle` (Ctrl/Cmd+click,
   * Space) or `range` (Shift: from the selection anchor, which the caller keeps).
   */
  readonly onSelect: (index: number, mode: SelectionMode) => void;
  readonly onSelectAll?: (() => void) | undefined;
  /** Enter or double-click: open the step in Details. */
  readonly onActivate?: ((index: number) => void) | undefined;
  /** Alt+↑ / Alt+↓. */
  readonly onMove?: ((index: number, delta: -1 | 1) => void) | undefined;
  readonly onToggleLock?: ((index: number) => void) | undefined;
  readonly onDuplicate?: ((index: number) => void) | undefined;
  readonly onDelete?: ((index: number) => void) | undefined;
  /** A drag began on the handle of row `index`. The drag preview is local to the list. */
  readonly onDragStart?: ((index: number) => void) | undefined;
  /**
   * The row at `fromIndex` was dropped so that it ends up at `toIndex` (indices after the move,
   * as a `move(from, to)` operation expects). Not called for drops that change nothing.
   */
  readonly onDrop?: ((fromIndex: number, toIndex: number) => void) | undefined;
  /** Escape, pointer cancel, or a drop back in place. */
  readonly onDragCancel?: (() => void) | undefined;
  /** The pointer entered row `index`, or left the list (null): the map highlights the row's steps. */
  readonly onHoverIndexChange?: ((index: number | null) => void) | undefined;
  /** No editing affordances or commands (optimiser running, proposal open); navigation works. */
  readonly readOnly?: boolean | undefined;
  readonly overscan?: number | undefined;
  /** Viewport height used until the real one is measured (and in environments without layout). */
  readonly initialViewportHeight?: number | undefined;
  /** Shown instead of rows when `rows` is empty. */
  readonly emptyState?: ReactNode;
  readonly className?: string | undefined;
}

interface DragState {
  readonly from: number;
  readonly slot: number;
}

/** Binds an index callback to one row, keeping "not provided" as undefined. */
function atIndex(callback: ((index: number) => void) | undefined, index: number): (() => void) | undefined {
  return callback === undefined
    ? undefined
    : () => {
        callback(index);
      };
}

/**
 * The DOM id of a row, derived from its stable key (not its index), so `aria-activedescendant`
 * changes whenever the active item's identity changes (a delete, an undo, a reorder) and stays on
 * the same item when only its index moves. Keys are URI-encoded so the id never has whitespace.
 */
export function routeRowDomId(baseId: string, key: string): string {
  return `${baseId}-row-${encodeURIComponent(key)}`;
}

/**
 * The route editor list: fixed 28px rows, virtualised by index arithmetic (virtual.ts), a
 * `listbox` with `aria-activedescendant` so keyboard focus stays on the list while the active
 * row scrolls into view. Rows other than the active one are unmounted outside the window.
 *
 * Step rows carry `aria-posinset`/`aria-setsize` among the steps only (so "16." is also "16 of
 * 40"), and a step under a group header says "in group …" in its name; header rows carry no
 * position.
 */
export function RouteList({
  rows,
  label,
  activeIndex,
  selectedKeys,
  onActiveIndexChange,
  onSelect,
  onSelectAll,
  onActivate,
  onMove,
  onToggleLock,
  onDuplicate,
  onDelete,
  onDragStart,
  onDrop,
  onDragCancel,
  onHoverIndexChange,
  readOnly = false,
  overscan = DEFAULT_OVERSCAN,
  initialViewportHeight = 560,
  emptyState,
  className,
}: RouteListProps) {
  const rowHeight = ROUTE_ROW_HEIGHT;
  const rowCount = rows.length;
  const baseId = useId();
  const context = useMemo(() => routeRowContext(rows), [rows]);

  const listRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(initialViewportHeight);
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDragState] = useState<DragState | null>(null);

  const setDrag = (next: DragState | null) => {
    dragRef.current = next;
    setDragState(next);
  };

  // Measure the viewport; keep the initial height where layout reports nothing (tests).
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (el.clientHeight > 0) setViewportHeight(el.clientHeight);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Keep the active row in view whenever it changes (keyboard, or selection from elsewhere). The
  // scroll position comes from a ref and edits elsewhere in the route do not re-run this, so a
  // user who scrolled away is not snapped back.
  const revealIndex = activeIndex !== null && activeIndex >= 0 && activeIndex < rowCount ? activeIndex : null;
  useLayoutEffect(() => {
    if (revealIndex === null) return;
    const next = scrollTopToReveal(revealIndex, scrollTopRef.current, viewportHeight, ROUTE_ROW_HEIGHT);
    if (next === scrollTopRef.current) return;
    scrollTopRef.current = next;
    setScrollTop(next);
    const el = listRef.current;
    if (el !== null && el.scrollTop !== next) el.scrollTop = next;
  }, [revealIndex, viewportHeight]);

  // While dragging, follow the pointer anywhere in the window.
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return undefined;
    const finish = (commit: boolean) => {
      const current = dragRef.current;
      if (current === null) return;
      dragRef.current = null;
      setDragState(null);
      const to = dropTargetIndex(current.from, current.slot);
      if (commit && to !== current.from) onDrop?.(current.from, to);
      else onDragCancel?.();
    };
    const onPointerMove = (event: globalThis.PointerEvent) => {
      const el = listRef.current;
      const current = dragRef.current;
      if (el === null || current === null) return;
      const rect = el.getBoundingClientRect();
      // Auto-scroll by half a row per move near either edge (only where there is real layout).
      if (rect.height > 2 * rowHeight) {
        if (event.clientY < rect.top + rowHeight) el.scrollTop = Math.max(0, el.scrollTop - rowHeight / 2);
        else if (event.clientY > rect.bottom - rowHeight) el.scrollTop += rowHeight / 2;
      }
      const slot = dropSlotAtOffset(event.clientY - rect.top + el.scrollTop, rowHeight, rowCount);
      if (slot === current.slot) return;
      dragRef.current = { from: current.from, slot };
      setDragState(dragRef.current);
    };
    const onPointerUp = () => {
      finish(true);
    };
    const onPointerCancel = () => {
      finish(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [dragging, rowCount, rowHeight, onDrop, onDragCancel]);

  const canDrag = !readOnly && onDrop !== undefined;
  const beginDrag = (index: number, event: PointerEvent<HTMLElement>) => {
    if (!canDrag || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    listRef.current?.focus();
    setDrag({ from: index, slot: index });
    onDragStart?.(index);
  };

  const run = (command: ListCommand): boolean => {
    switch (command.type) {
      case 'navigate':
        onActiveIndexChange(command.index);
        if (command.selection !== 'none') onSelect(command.index, command.selection);
        return true;
      case 'select':
        onSelect(command.index, command.mode);
        return true;
      case 'selectAll':
        if (onSelectAll === undefined) return false;
        onSelectAll();
        return true;
      case 'activate':
        if (onActivate === undefined) return false;
        onActivate(command.index);
        return true;
      case 'move':
        if (onMove === undefined) return false;
        onMove(command.index, command.delta);
        return true;
      case 'delete':
        if (onDelete === undefined) return false;
        onDelete(command.index);
        return true;
      case 'toggleLock':
        if (onToggleLock === undefined || rows[command.index]?.type !== 'step') return false;
        onToggleLock(command.index);
        return true;
      case 'duplicate':
        if (onDuplicate === undefined) return false;
        onDuplicate(command.index);
        return true;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (dragRef.current !== null) return;
    const command = listCommandForKey(event, {
      activeIndex,
      rowCount,
      pageSize: pageSize(viewportHeight, rowHeight),
      readOnly,
    });
    if (command !== null && run(command)) event.preventDefault();
  };

  const onRowClick = (index: number, event: MouseEvent<HTMLDivElement>) => {
    onActiveIndexChange(index);
    onSelect(index, selectionModeForClick(event));
  };

  const view = computeVirtualWindow({ scrollTop, viewportHeight, rowHeight, rowCount, overscan });
  const indices: number[] = [];
  for (let i = view.start; i < view.end; i += 1) indices.push(i);
  // The active row is always mounted so aria-activedescendant never points at nothing.
  if (revealIndex !== null && (revealIndex < view.start || revealIndex >= view.end)) indices.push(revealIndex);

  const activeRow = revealIndex === null ? undefined : rows[revealIndex];
  const activeId = activeRow === undefined ? undefined : routeRowDomId(baseId, activeRow.key);
  const showDropIndicator = drag !== null && dropTargetIndex(drag.from, drag.slot) !== drag.from;

  return (
    <div className={cx('frl-routelist', readOnly && 'is-read-only', dragging && 'is-dragging', className)}>
      <div
        ref={listRef}
        role="listbox"
        aria-label={label}
        aria-multiselectable="true"
        aria-activedescendant={activeId}
        tabIndex={0}
        className="frl-routelist__viewport"
        onKeyDown={onKeyDown}
        onMouseLeave={
          onHoverIndexChange === undefined
            ? undefined
            : () => {
                onHoverIndexChange(null);
              }
        }
        onScroll={(event) => {
          const next = event.currentTarget.scrollTop;
          scrollTopRef.current = next;
          setScrollTop(next);
        }}
      >
        <div className="frl-routelist__canvas" style={{ height: view.totalHeight }}>
          {indices.map((index) => {
            const row = rows[index];
            if (row === undefined) return null;
            const frame = {
              id: routeRowDomId(baseId, row.key),
              selected: selectedKeys.has(row.key),
              active: index === activeIndex,
              dragging: drag?.from === index,
              style: { top: index * rowHeight, height: rowHeight },
              onClick: (event: MouseEvent<HTMLDivElement>) => {
                onRowClick(index, event);
              },
              onDoubleClick: () => {
                onActivate?.(index);
              },
              onMouseEnter: atIndex(onHoverIndexChange, index),
              onHandlePointerDown: canDrag
                ? (event: PointerEvent<HTMLElement>) => {
                    beginDrag(index, event);
                  }
                : undefined,
            };
            return row.type === 'step' ? (
              <StepRow
                key={row.key}
                {...frame}
                posInSet={context.stepPosition[index] ?? undefined}
                setSize={context.stepCount}
                groupLabel={context.groupLabel[index] ?? null}
                model={row}
                readOnly={readOnly}
                onToggleLock={atIndex(onToggleLock, index)}
                onDuplicate={atIndex(onDuplicate, index)}
                onDelete={atIndex(onDelete, index)}
              />
            ) : (
              <GroupRow key={row.key} {...frame} model={row} />
            );
          })}
          {showDropIndicator && (
            <div className="frl-routelist__drop" style={{ top: drag.slot * rowHeight }} aria-hidden="true" />
          )}
        </div>
      </div>
      {rowCount === 0 && emptyState !== undefined && <div className="frl-routelist__empty">{emptyState}</div>}
    </div>
  );
}
