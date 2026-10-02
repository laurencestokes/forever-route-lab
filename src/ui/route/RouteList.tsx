import {
  type CSSProperties,
  memo,
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
import { routeRowContext, type EstimateColumn, type GroupRowModel, type RouteRowModel, type StepRowModel, type TopNumber } from './rows';
import {
  DEFAULT_OVERSCAN,
  ROUTE_ACTIVE_ROW_EXTRA,
  activeRowCanGrow,
  computeVirtualWindow,
  dropSlotAtOffset,
  dropTargetIndex,
  listCommandForKey,
  pageSize,
  routeRowHeight,
  rowIndexAtOffset,
  rowTop,
  scrollTopToReveal,
  selectionModeForClick,
  type GrownRow,
  type ListCommand,
  type RowDensity,
  type SelectionMode,
} from './virtual';
import './RouteList.css';

export interface RouteListProps {
  readonly rows: readonly RouteRowModel[];
  /**
   * Fills in a step row's derived values (estimates, pending, issues) as it renders. Only mounted
   * rows call it, so new derived results cost the rows in view, not the whole route (docs/UI.md
   * §8); omitted: the rows are drawn as they are.
   */
  readonly deriveRow?: ((row: StepRowModel, index: number) => StepRowModel) | undefined;
  /** Fills in a group header's level span as it renders, as `deriveRow` does for steps; omitted: drawn as it is. */
  readonly deriveGroup?: ((row: GroupRowModel, index: number) => GroupRowModel) | undefined;
  /**
   * Two lines of 44px (default; B+, D-051), whose active step row grows by one fixed extra, or one
   * line of 28px: one height for every other row of the list.
   */
  readonly density?: RowDensity | undefined;
  /** One-line rows: which estimate the right-hand column shows; default the level after the step. */
  readonly estimateColumn?: EstimateColumn | undefined;
  /** Two-line rows: the top number over the level after; default the XP gained. */
  readonly topNumber?: TopNumber | undefined;
  /**
   * Where new steps go: the row boundary above row `insertAt` (`rows.length` for the end), drawn as
   * a dashed insertion line, with the band under every row after it (the steps after the selection,
   * D-048 B). Both are one element each, outside the rows, so moving them re-renders no row. Null or
   * omitted: neither is drawn.
   */
  readonly insertAt?: number | null | undefined;
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

/** The list's row callbacks, by index: one stable object for the list's lifetime (it calls the latest props). */
interface RowCallbacks {
  readonly click: (index: number, event: MouseEvent<HTMLDivElement>) => void;
  readonly activate: (index: number) => void;
  readonly hover: (index: number) => void;
  readonly handleDown: (index: number, event: PointerEvent<HTMLElement>) => void;
  readonly toggleLock: (index: number) => void;
  readonly duplicate: (index: number) => void;
  readonly remove: (index: number) => void;
}

interface StepRowSlotProps {
  readonly index: number;
  readonly id: string;
  readonly model: StepRowModel;
  readonly top: number;
  readonly height: number;
  readonly selected: boolean;
  readonly active: boolean;
  readonly grown: boolean;
  readonly dragging: boolean;
  readonly posInSet: number | undefined;
  readonly setSize: number;
  readonly groupLabel: string | null;
  readonly density: RowDensity;
  readonly estimateColumn: EstimateColumn;
  readonly topNumber: TopNumber;
  readonly readOnly: boolean;
  readonly canDrag: boolean;
  readonly hasHover: boolean;
  readonly hasLock: boolean;
  readonly hasDuplicate: boolean;
  readonly hasDelete: boolean;
  readonly callbacks: RowCallbacks;
}

/**
 * One mounted step row, memoised on plain values and the row's model (PERF-11): new derived results
 * re-render only the rows whose model changed (`deriveRow` hands back the same model for a row whose
 * numbers did not), and a scroll only the rows that enter the window.
 */
const StepRowSlot = memo(function StepRowSlot({
  index,
  id,
  model,
  top,
  height,
  selected,
  active,
  grown,
  dragging,
  posInSet,
  setSize,
  groupLabel,
  density,
  estimateColumn,
  topNumber,
  readOnly,
  canDrag,
  hasHover,
  hasLock,
  hasDuplicate,
  hasDelete,
  callbacks,
}: StepRowSlotProps) {
  return (
    <StepRow
      id={id}
      selected={selected}
      active={active}
      grown={grown}
      dragging={dragging}
      style={{ top, height }}
      onClick={(event) => {
        callbacks.click(index, event);
      }}
      onDoubleClick={() => {
        callbacks.activate(index);
      }}
      onMouseEnter={
        hasHover
          ? () => {
              callbacks.hover(index);
            }
          : undefined
      }
      onHandlePointerDown={
        canDrag
          ? (event) => {
              callbacks.handleDown(index, event);
            }
          : undefined
      }
      posInSet={posInSet}
      setSize={setSize}
      groupLabel={groupLabel}
      model={model}
      density={density}
      estimateColumn={estimateColumn}
      topNumber={topNumber}
      readOnly={readOnly}
      onToggleLock={
        hasLock
          ? () => {
              callbacks.toggleLock(index);
            }
          : undefined
      }
      onDuplicate={
        hasDuplicate
          ? () => {
              callbacks.duplicate(index);
            }
          : undefined
      }
      onDelete={
        hasDelete
          ? () => {
              callbacks.remove(index);
            }
          : undefined
      }
    />
  );
});

/**
 * The DOM id of a row, derived from its stable key (not its index), so `aria-activedescendant`
 * changes whenever the active item's identity changes (a delete, an undo, a reorder) and stays on
 * the same item when only its index moves. Keys are URI-encoded so the id never has whitespace.
 */
export function routeRowDomId(baseId: string, key: string): string {
  return `${baseId}-row-${encodeURIComponent(key)}`;
}

/**
 * The route editor list: fixed-height rows (44px two-line rows, or 28px one-line rows; one height
 * per list), virtualised by index arithmetic (virtual.ts), a `listbox` with
 * `aria-activedescendant` so keyboard focus stays on the list while the active row scrolls into
 * view. Rows other than the active one are unmounted outside the window. The insertion line and the
 * band under the later steps are one element each, drawn by the list, never by a row.
 *
 * Two-line rows (B+, D-051): the active step row grows by `ROUTE_ACTIVE_ROW_EXTRA`, so every row
 * after it sits that much lower. Each row's `top` stays `index × 44`; the rows after the grown one
 * are moved down by CSS alone (`.is-grown ~ .frl-row`, RouteList.css), so a change of active row
 * re-renders only the two rows whose flags changed (PERF-11). For that rule the rows are in index
 * order in the DOM: an active row outside the window comes first or last. The list itself places what
 * it draws as single elements (the canvas height, the band, the insertion and drop lines) and finds
 * rows, gaps and reveals with the grown row's offsets.
 *
 * Step rows carry `aria-posinset`/`aria-setsize` among the steps only (so "16." is also "16 of
 * 40"), and a step under a group header says "in group …" in its name; header rows carry no
 * position. Derived values come in through `deriveRow`, asked only for the mounted rows.
 */
export function RouteList({
  rows,
  deriveRow,
  deriveGroup,
  density = 'two-line',
  estimateColumn = 'level',
  topNumber = 'xp',
  insertAt = null,
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
  const rowHeight = routeRowHeight(density);
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
  // The active step row of a two-line list grows (D-051); a header row, one-line rows and a list too
  // short for the grown row (activeRowCanGrow) never do.
  const grownIndex =
    density === 'two-line' && revealIndex !== null && rows[revealIndex]?.type === 'step' && activeRowCanGrow(viewportHeight, rowHeight) ? revealIndex : null;
  const grown = useMemo<GrownRow | null>(() => (grownIndex === null ? null : { index: grownIndex, extra: ROUTE_ACTIVE_ROW_EXTRA }), [grownIndex]);
  const grownRef = useRef<GrownRow | null>(null);
  useLayoutEffect(() => {
    const before = grownRef.current;
    grownRef.current = grown;
    let next = scrollTopRef.current;
    // A grown row above the view that shrinks (or a new one there) moves every row in view: keep them
    // still, as the browser's scroll anchoring would, by the change at the first row in view.
    if (before !== grown) {
      const first = rowIndexAtOffset(next, rowHeight, rowCount, before);
      if (first !== null && first !== before?.index) next += rowTop(first, rowHeight, grown) - rowTop(first, rowHeight, before);
    }
    if (revealIndex !== null) next = scrollTopToReveal(revealIndex, next, viewportHeight, rowHeight, grown);
    if (next === scrollTopRef.current) return;
    scrollTopRef.current = next;
    setScrollTop(next);
    const el = listRef.current;
    if (el !== null && el.scrollTop !== next) el.scrollTop = next;
    // Edits elsewhere (new rows) do not re-run this: the grown row is read when the active row changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealIndex, grown, viewportHeight, rowHeight]);

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
      const slot = dropSlotAtOffset(event.clientY - rect.top + el.scrollTop, rowHeight, rowCount, grown);
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
  }, [dragging, rowCount, rowHeight, grown, onDrop, onDragCancel]);

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

  // The rows' callbacks: one object for the list's lifetime, calling the latest props, so the
  // memoised rows are not re-rendered for new handler identities (PERF-11).
  const latest = useRef({ onRowClick, onActivate, onHoverIndexChange, beginDrag, onToggleLock, onDuplicate, onDelete });
  useLayoutEffect(() => {
    latest.current = { onRowClick, onActivate, onHoverIndexChange, beginDrag, onToggleLock, onDuplicate, onDelete };
  });
  const callbacks = useMemo<RowCallbacks>(
    () => ({
      click: (index, event) => {
        latest.current.onRowClick(index, event);
      },
      activate: (index) => {
        latest.current.onActivate?.(index);
      },
      hover: (index) => {
        latest.current.onHoverIndexChange?.(index);
      },
      handleDown: (index, event) => {
        latest.current.beginDrag(index, event);
      },
      toggleLock: (index) => {
        latest.current.onToggleLock?.(index);
      },
      duplicate: (index) => {
        latest.current.onDuplicate?.(index);
      },
      remove: (index) => {
        latest.current.onDelete?.(index);
      },
    }),
    [],
  );

  const view = computeVirtualWindow({ scrollTop, viewportHeight, rowHeight, rowCount, overscan, grown });
  const indices: number[] = [];
  for (let i = view.start; i < view.end; i += 1) indices.push(i);
  // The active row is always mounted so aria-activedescendant never points at nothing; in index order
  // (first or last), so the rows after it in the DOM are the rows after it in the list.
  if (revealIndex !== null && revealIndex < view.start) indices.unshift(revealIndex);
  if (revealIndex !== null && revealIndex >= view.end) indices.push(revealIndex);
  const at = (index: number) => rowTop(index, rowHeight, grown);

  const activeRow = revealIndex === null ? undefined : rows[revealIndex];
  const activeId = activeRow === undefined ? undefined : routeRowDomId(baseId, activeRow.key);
  const showDropIndicator = drag !== null && dropTargetIndex(drag.from, drag.slot) !== drag.from;
  const insertLine = insertAt === null || rowCount === 0 ? null : Math.min(rowCount, Math.max(0, insertAt));

  return (
    <div
      className={cx(
        'frl-routelist',
        `frl-routelist--${density}`,
        readOnly && 'is-read-only',
        dragging && 'is-dragging',
        // A selection of several rows shows the row actions on none of them at rest (D-051: "the selected row").
        selectedKeys.size > 1 && 'is-multi-selected',
        className,
      )}
    >
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
        <div className="frl-routelist__canvas" style={{ height: view.totalHeight, '--frl-number-digits': Math.max(2, String(context.stepCount).length) } as CSSProperties}>
          {indices.map((index) => {
            const row = rows[index];
            if (row === undefined) return null;
            if (row.type === 'step') {
              return (
                <StepRowSlot
                  key={row.key}
                  index={index}
                  id={routeRowDomId(baseId, row.key)}
                  model={deriveRow === undefined ? row : deriveRow(row, index)}
                  top={index * rowHeight}
                  height={index === grownIndex ? rowHeight + ROUTE_ACTIVE_ROW_EXTRA : rowHeight}
                  grown={index === grownIndex}
                  selected={selectedKeys.has(row.key)}
                  active={index === activeIndex}
                  dragging={drag?.from === index}
                  posInSet={context.stepPosition[index] ?? undefined}
                  setSize={context.stepCount}
                  groupLabel={context.groupLabel[index] ?? null}
                  density={density}
                  estimateColumn={estimateColumn}
                  topNumber={topNumber}
                  readOnly={readOnly}
                  canDrag={canDrag}
                  hasHover={onHoverIndexChange !== undefined}
                  hasLock={onToggleLock !== undefined}
                  hasDuplicate={onDuplicate !== undefined}
                  hasDelete={onDelete !== undefined}
                  callbacks={callbacks}
                />
              );
            }
            const frame = {
              id: routeRowDomId(baseId, row.key),
              selected: selectedKeys.has(row.key),
              active: index === activeIndex,
              dragging: drag?.from === index,
              density,
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
            return <GroupRow key={row.key} {...frame} model={deriveGroup === undefined ? row : deriveGroup(row, index)} />;
          })}
          {insertLine !== null && (
            <>
              {insertLine < rowCount && (
                <div className="frl-routelist__later" style={{ top: at(insertLine), height: view.totalHeight - at(insertLine) }} aria-hidden="true" />
              )}
              <div className="frl-routelist__insert" style={{ top: at(insertLine) }} aria-hidden="true" />
            </>
          )}
          {showDropIndicator && (
            <div className="frl-routelist__drop" style={{ top: at(drag.slot) }} aria-hidden="true" />
          )}
        </div>
      </div>
      {rowCount === 0 && emptyState !== undefined && <div className="frl-routelist__empty">{emptyState}</div>}
    </div>
  );
}
