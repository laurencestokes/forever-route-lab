// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StepKind } from '../../domain/route';
import { NO_ISSUES } from '../lib/issues';
import { knownReadout } from '../lib/readout';
import { UNKNOWN_FOREVER_PROVENANCE } from '../markers/provenance';
import { RouteList, routeRowDomId, type RouteListProps } from './RouteList';
import { routeRowContext, type GroupRowModel, type RouteRowModel, type StepRowModel } from './rows';
import { ROUTE_ROW_HEIGHT, type SelectionMode } from './virtual';

afterEach(cleanup);

const KINDS: readonly StepKind[] = ['accept', 'travel', 'complete', 'turnin', 'grind', 'note'];

function placeholderStep(i: number): StepRowModel {
  const kind = KINDS[i % KINDS.length] ?? 'note';
  return {
    type: 'step',
    key: `step-${String(i + 1)}`,
    number: i + 1,
    kind,
    title: `Placeholder step ${String(i + 1)}`,
    detail: null,
    projectedLevel: knownReadout(1 + i / 100),
    duration: knownReadout(60),
    xpGained: knownReadout(0),
    pending: null,
    assumptions: null,
    quest: kind === 'accept' ? { level: 5, difficulty: 'difficult', uncertain: false, provenance: UNKNOWN_FOREVER_PROVENANCE } : null,
    issues: NO_ISSUES,
    locked: false,
  };
}

const rows = (n: number): RouteRowModel[] => Array.from({ length: n }, (_, i) => placeholderStep(i));

/** 280px viewport: 10 rows visible. */
const VIEWPORT = 10 * ROUTE_ROW_HEIGHT;

type Handlers = Pick<
  RouteListProps,
  'onActiveIndexChange' | 'onSelect' | 'onDelete' | 'onToggleLock' | 'onDuplicate' | 'onMove' | 'onActivate' | 'onDrop' | 'onDragStart' | 'onDragCancel'
>;

/** A controlled host that keeps the active row and a simple selection, like the store will. */
function Harness({ count, readOnly = false, spy }: { count: number; readOnly?: boolean; spy: Partial<Handlers> }) {
  const data = rows(count);
  const [active, setActive] = useState<number | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const onSelect = (index: number, mode: SelectionMode) => {
    spy.onSelect?.(index, mode);
    const key = data[index]?.key;
    if (key === undefined) return;
    setSelected((prev) => {
      if (mode === 'replace') return new Set([key]);
      const next = new Set(prev);
      if (mode === 'toggle' && next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  return (
    <RouteList
      rows={data}
      label="Placeholder route"
      activeIndex={active}
      selectedKeys={selected}
      onActiveIndexChange={(index) => {
        spy.onActiveIndexChange?.(index);
        setActive(index);
      }}
      onSelect={onSelect}
      onDelete={spy.onDelete}
      onToggleLock={spy.onToggleLock}
      onDuplicate={spy.onDuplicate}
      onMove={spy.onMove}
      onActivate={spy.onActivate}
      onDrop={spy.onDrop}
      onDragStart={spy.onDragStart}
      onDragCancel={spy.onDragCancel}
      readOnly={readOnly}
      overscan={2}
      initialViewportHeight={VIEWPORT}
    />
  );
}

const listbox = () => screen.getByRole('listbox', { name: 'Placeholder route' });
const renderedNumbers = () =>
  within(listbox())
    .getAllByRole('option')
    .map((el) => Number(el.getAttribute('aria-posinset')))
    .sort((a, b) => a - b);

describe('RouteList virtualisation', () => {
  it('mounts only the visible window plus overscan', () => {
    render(<Harness count={1000} spy={{}} />);
    // Rows 0-9 visible, overscan 2 below: posinset 1-12.
    expect(renderedNumbers()).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    const first = within(listbox()).getAllByRole('option')[0];
    expect(first?.getAttribute('aria-setsize')).toBe('1000');
    expect(first?.style.top).toBe('0px');
  });

  it('asks deriveRow only for the mounted rows, and shows the chosen estimate column', () => {
    const asked: number[] = [];
    const deriveRow = (row: StepRowModel, index: number): StepRowModel => {
      asked.push(index);
      return { ...row, xpGained: knownReadout(100 * (index + 1)), pending: index === 1 ? 'path' : null };
    };
    render(
      <RouteList
        rows={rows(10_000)}
        deriveRow={deriveRow}
        estimateColumn="xp"
        label="Placeholder route"
        activeIndex={null}
        selectedKeys={new Set()}
        onActiveIndexChange={vi.fn()}
        onSelect={vi.fn()}
        overscan={2}
        initialViewportHeight={VIEWPORT}
      />,
    );
    // 10 visible rows and 2 of overscan: 12 of 10,000 rows derived.
    expect([...new Set(asked)].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    const options = within(listbox()).getAllByRole('option');
    expect(options[0]?.querySelector('.frl-steprow__estimate')?.textContent).toContain('+100');
    expect(options[1]?.className).toContain('is-pending');
    expect(options[1]?.getAttribute('aria-label')).toContain('XP gained 200 XP');
  });

  it('sizes the canvas for every row and positions rows by index', () => {
    render(<Harness count={1000} spy={{}} />);
    const canvas = listbox().firstElementChild as HTMLElement;
    expect(canvas.style.height).toBe(`${String(1000 * ROUTE_ROW_HEIGHT)}px`);
    const row5 = within(listbox()).getAllByRole('option').find((el) => el.getAttribute('aria-posinset') === '6');
    expect(row5?.style.top).toBe(`${String(5 * ROUTE_ROW_HEIGHT)}px`);
  });

  it('moves the window when the list scrolls', () => {
    render(<Harness count={1000} spy={{}} />);
    const el = listbox();
    el.scrollTop = 500 * ROUTE_ROW_HEIGHT;
    fireEvent.scroll(el);
    // Rows 500-509 visible, overscan 2 each side: posinset 499-512.
    expect(renderedNumbers()).toEqual(Array.from({ length: 14 }, (_, i) => i + 499));
  });
});

describe('RouteList keyboard', () => {
  it('moves the active row and selection with the arrow keys', () => {
    const spy = { onActiveIndexChange: vi.fn(), onSelect: vi.fn() };
    render(<Harness count={50} spy={spy} />);
    const el = listbox();
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    expect(spy.onActiveIndexChange).toHaveBeenLastCalledWith(0);
    expect(spy.onSelect).toHaveBeenLastCalledWith(0, 'replace');
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    expect(spy.onActiveIndexChange).toHaveBeenLastCalledWith(1);
    const active = document.getElementById(el.getAttribute('aria-activedescendant') ?? '');
    expect(active?.getAttribute('aria-posinset')).toBe('2');
    expect(active?.getAttribute('aria-selected')).toBe('true');
  });

  it('extends with Shift and moves focus alone with Ctrl', () => {
    const spy = { onActiveIndexChange: vi.fn(), onSelect: vi.fn() };
    render(<Harness count={50} spy={spy} />);
    const el = listbox();
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    fireEvent.keyDown(el, { key: 'ArrowDown', shiftKey: true });
    expect(spy.onSelect).toHaveBeenLastCalledWith(1, 'range');
    spy.onSelect.mockClear();
    fireEvent.keyDown(el, { key: 'ArrowDown', ctrlKey: true });
    expect(spy.onActiveIndexChange).toHaveBeenLastCalledWith(2);
    expect(spy.onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(el, { key: ' ' });
    expect(spy.onSelect).toHaveBeenLastCalledWith(2, 'toggle');
    const selected = within(el)
      .getAllByRole('option')
      .filter((o) => o.getAttribute('aria-selected') === 'true')
      .map((o) => o.getAttribute('aria-posinset'));
    expect(selected).toEqual(['1', '2', '3']);
  });

  it('scrolls the active row into view on End, PageUp and Home', () => {
    render(<Harness count={1000} spy={{}} />);
    const el = listbox();
    fireEvent.keyDown(el, { key: 'End' });
    const activeId = el.getAttribute('aria-activedescendant');
    expect(activeId).not.toBeNull();
    expect(document.getElementById(activeId ?? '')?.getAttribute('aria-posinset')).toBe('1000');
    // The window followed: the last page is mounted.
    expect(renderedNumbers()).toContain(991);
    expect(renderedNumbers()).not.toContain(1);
    fireEvent.keyDown(el, { key: 'PageUp' });
    expect(document.getElementById(el.getAttribute('aria-activedescendant') ?? '')?.getAttribute('aria-posinset')).toBe('991');
    fireEvent.keyDown(el, { key: 'Home' });
    expect(renderedNumbers()[0]).toBe(1);
  });

  it('keeps the active row mounted when scrolled far away', () => {
    render(<Harness count={1000} spy={{}} />);
    const el = listbox();
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    el.scrollTop = 700 * ROUTE_ROW_HEIGHT;
    fireEvent.scroll(el);
    const activeId = el.getAttribute('aria-activedescendant') ?? '';
    expect(document.getElementById(activeId)?.getAttribute('aria-posinset')).toBe('1');
    expect(renderedNumbers()).toContain(701);
  });

  it('runs editing commands on the active row', () => {
    const spy = { onDelete: vi.fn(), onToggleLock: vi.fn(), onDuplicate: vi.fn(), onMove: vi.fn(), onActivate: vi.fn() };
    render(<Harness count={20} spy={spy} />);
    const el = listbox();
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    fireEvent.keyDown(el, { key: 'Delete' });
    expect(spy.onDelete).toHaveBeenCalledWith(1);
    fireEvent.keyDown(el, { key: 'l' });
    expect(spy.onToggleLock).toHaveBeenCalledWith(1);
    fireEvent.keyDown(el, { key: 'd', ctrlKey: true });
    expect(spy.onDuplicate).toHaveBeenCalledWith(1);
    fireEvent.keyDown(el, { key: 'ArrowUp', altKey: true });
    expect(spy.onMove).toHaveBeenCalledWith(1, -1);
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(spy.onActivate).toHaveBeenCalledWith(1);
  });

  it('ignores editing commands when read-only', () => {
    const spy = { onDelete: vi.fn(), onToggleLock: vi.fn(), onActiveIndexChange: vi.fn() };
    render(<Harness count={20} readOnly spy={spy} />);
    const el = listbox();
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    fireEvent.keyDown(el, { key: 'Delete' });
    fireEvent.keyDown(el, { key: 'l' });
    expect(spy.onActiveIndexChange).toHaveBeenCalledWith(0);
    expect(spy.onDelete).not.toHaveBeenCalled();
    expect(spy.onToggleLock).not.toHaveBeenCalled();
    expect(within(el).queryAllByRole('button')).toHaveLength(0);
  });
});

describe('RouteList pointer', () => {
  it('selects on click with the modifier conventions', () => {
    const spy = { onSelect: vi.fn(), onActiveIndexChange: vi.fn() };
    render(<Harness count={20} spy={spy} />);
    const options = within(listbox()).getAllByRole('option');
    fireEvent.click(options[3] as HTMLElement);
    expect(spy.onActiveIndexChange).toHaveBeenLastCalledWith(3);
    expect(spy.onSelect).toHaveBeenLastCalledWith(3, 'replace');
    fireEvent.click(options[5] as HTMLElement, { ctrlKey: true });
    expect(spy.onSelect).toHaveBeenLastCalledWith(5, 'toggle');
    fireEvent.click(options[7] as HTMLElement, { shiftKey: true });
    expect(spy.onSelect).toHaveBeenLastCalledWith(7, 'range');
  });

  it('reports a drag as from/to indices and draws the drop line locally', () => {
    const spy = { onDragStart: vi.fn(), onDrop: vi.fn(), onDragCancel: vi.fn() };
    const { container } = render(<Harness count={20} spy={spy} />);
    const handle = container.querySelectorAll('.frl-row__handle')[1] as HTMLElement;
    fireEvent.pointerDown(handle, { button: 0, clientY: 1.5 * ROUTE_ROW_HEIGHT });
    expect(spy.onDragStart).toHaveBeenCalledWith(1);
    // Pointer near the gap above row 5 (the test DOM has no layout, so offsets are client Y).
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 5 * ROUTE_ROW_HEIGHT + 3 }));
    });
    expect(container.querySelector('.frl-routelist__drop')).not.toBeNull();
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 5 * ROUTE_ROW_HEIGHT + 3 }));
    });
    expect(spy.onDrop).toHaveBeenCalledWith(1, 4);
    expect(container.querySelector('.frl-routelist__drop')).toBeNull();
  });

  it('cancels a drag on Escape or a drop in place', () => {
    const spy = { onDrop: vi.fn(), onDragCancel: vi.fn() };
    const { container } = render(<Harness count={20} spy={spy} />);
    const handle = () => container.querySelectorAll('.frl-row__handle')[2] as HTMLElement;
    fireEvent.pointerDown(handle(), { button: 0, clientY: 2.5 * ROUTE_ROW_HEIGHT });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 9 * ROUTE_ROW_HEIGHT }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(spy.onDragCancel).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(handle(), { button: 0, clientY: 2.5 * ROUTE_ROW_HEIGHT });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 2.5 * ROUTE_ROW_HEIGHT }));
    });
    expect(spy.onDragCancel).toHaveBeenCalledTimes(2);
    expect(spy.onDrop).not.toHaveBeenCalled();
  });
});

const header = (key: string, label: string, stepCount: number): GroupRowModel => ({ type: 'group', key, label, stepCount });

/** Steps 1-6 with a header over steps 2-4: rows H? S1 [H S2 S3 S4] S5 S6. */
function groupedRows(): RouteRowModel[] {
  const steps = rows(6);
  return [steps[0], header('group:g1:step-2', 'Placeholder guide, step 1', 3), steps[1], steps[2], steps[3], steps[4], steps[5]].filter(
    (row): row is RouteRowModel => row !== undefined,
  );
}

function StaticList({ data, active }: { data: readonly RouteRowModel[]; active: number | null }) {
  return (
    <RouteList
      rows={data}
      label="Placeholder route"
      activeIndex={active}
      selectedKeys={new Set()}
      onActiveIndexChange={vi.fn()}
      onSelect={vi.fn()}
      initialViewportHeight={VIEWPORT}
    />
  );
}

describe('routeRowContext', () => {
  it('numbers steps only and assigns each header its steps', () => {
    const context = routeRowContext(groupedRows());
    expect(context.stepCount).toBe(6);
    expect(context.stepPosition).toEqual([1, null, 2, 3, 4, 5, 6]);
    const g = 'Placeholder guide, step 1';
    expect(context.groupLabel).toEqual([null, null, g, g, g, null, null]);
  });

  it('ends a group at the next header even when it promised more steps', () => {
    const steps = rows(3);
    const data = [header('h1', 'First', 5), steps[0], header('h2', 'Second', 1), steps[1], steps[2]].filter(
      (row): row is RouteRowModel => row !== undefined,
    );
    expect(routeRowContext(data).groupLabel).toEqual([null, 'First', null, 'Second', null]);
    expect(routeRowContext([]).stepCount).toBe(0);
  });
});

describe('RouteList semantics', () => {
  it('gives positions among the steps only, none to headers, and names the group', () => {
    render(<StaticList data={groupedRows()} active={null} />);
    const options = within(listbox()).getAllByRole('option');
    expect(options.map((o) => o.getAttribute('aria-posinset'))).toEqual(['1', null, '2', '3', '4', '5', '6']);
    expect(options.map((o) => o.getAttribute('aria-setsize'))).toEqual(['6', null, '6', '6', '6', '6', '6']);
    expect(options[2]?.getAttribute('aria-label')).toMatch(/^2\. Travel: Placeholder step 2, in group Placeholder guide, step 1\. /);
    expect(options[5]?.getAttribute('aria-label')).not.toMatch(/in group/);
    expect(options[1]?.getAttribute('aria-label')).toBe('Group: Placeholder guide, step 1, 3 steps.');
  });

  it('derives option ids from row keys, so the active descendant follows the item, not the index', () => {
    const data = rows(5);
    const { rerender } = render(<StaticList data={data} active={1} />);
    const el = listbox();
    const first = el.getAttribute('aria-activedescendant') ?? '';
    expect(document.getElementById(first)?.getAttribute('aria-label')).toMatch(/^2\. /);
    // Delete the active step: same index, different item, so a different id.
    rerender(<StaticList data={data.filter((_, i) => i !== 1)} active={1} />);
    const afterDelete = el.getAttribute('aria-activedescendant') ?? '';
    expect(afterDelete).not.toBe(first);
    expect(document.getElementById(afterDelete)?.getAttribute('aria-label')).toMatch(/^3\. /);
    // Move that item up one row: new index, same item, so the same id.
    const moved = [data[0], data[2], data[3], data[4]].filter((row): row is RouteRowModel => row !== undefined);
    const swapped = [moved[1], moved[0], moved[2], moved[3]].filter((row): row is RouteRowModel => row !== undefined);
    rerender(<StaticList data={swapped} active={0} />);
    expect(el.getAttribute('aria-activedescendant')).toBe(afterDelete);
  });

  it('makes ids that are unique per key and free of whitespace', () => {
    expect(routeRowDomId('r1', 'group:g 1:step-2')).toBe('r1-row-group%3Ag%201%3Astep-2');
    expect(routeRowDomId('r1', 'a')).not.toBe(routeRowDomId('r1', 'b'));
    render(<StaticList data={groupedRows()} active={null} />);
    const ids = within(listbox())
      .getAllByRole('option')
      .map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => !/\s/.test(id))).toBe(true);
  });

  it('has no focusable or interactive content inside any option', () => {
    render(<Harness count={20} spy={{ onDelete: vi.fn(), onDuplicate: vi.fn(), onToggleLock: vi.fn(), onDrop: vi.fn() }} />);
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
    for (const option of within(listbox()).getAllByRole('option')) {
      expect(option.querySelectorAll('button, a[href], input, select, textarea, [tabindex], [role="button"]')).toHaveLength(0);
    }
    // The list itself is the one tab stop.
    expect(listbox().tabIndex).toBe(0);
  });
});
