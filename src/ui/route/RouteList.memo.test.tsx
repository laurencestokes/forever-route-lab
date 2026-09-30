// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_ISSUES } from '../lib/issues';
import { knownReadout } from '../lib/readout';
import { RouteList } from './RouteList';
import type { StepRowModel } from './rows';
import type * as StepRowModule from './StepRow';
import { ROW_DENSITIES, routeRowHeight } from './virtual';

/**
 * The route list's rows are memoised (PERF-11): new derived results re-render only the rows whose
 * model changed, new handler props from the panel re-render none, a selection change re-renders at
 * most the two rows whose flags changed, and the insertion line and the later band move without a
 * row render (ui-refresh.md §10.1, D-048 B). StepRow is wrapped to count its renders.
 */

const { renders } = vi.hoisted(() => ({ renders: new Map<string, number>() }));
vi.mock('./StepRow', async (importOriginal) => {
  const original = await importOriginal<typeof StepRowModule>();
  return {
    ...original,
    StepRow: (props: Parameters<typeof original.StepRow>[0]) => {
      renders.set(props.model.key, (renders.get(props.model.key) ?? 0) + 1);
      return original.StepRow(props);
    },
  };
});

afterEach(() => {
  cleanup();
  renders.clear();
});

const step = (i: number): StepRowModel => ({
  type: 'step',
  key: `step-${String(i)}`,
  number: i + 1,
  kind: 'note',
  verb: 'Note',
  title: `Placeholder step ${String(i)}`,
  chain: null,
  detail: null,
  projectedLevel: knownReadout(1),
  duration: knownReadout(60),
  xpGained: knownReadout(0),
  pending: null,
  assumptions: null,
  quest: null,
  issues: NO_ISSUES,
  issue: null,
  mark: null,
  levelUp: null,
  locked: false,
});

const ROWS = Array.from({ length: 50 }, (_, i) => step(i));

describe.each(ROW_DENSITIES)('RouteList row memoisation (PERF-11), %s rows', (density) => {
  /** Models kept per row, as `createRowDeriver`'s `stableRow` keeps them; `changed` rows get new numbers, `view` new line-2 words. */
  function deriverFactory() {
    const models = new Map<string, StepRowModel>();
    return (changed: number | null, view = 'A') =>
      (row: StepRowModel): StepRowModel => {
        const known = models.get(row.key);
        const detail = `Where ${view}`;
        if (known !== undefined && row.number - 1 !== changed && known.detail === detail) return known;
        const next = { ...row, detail, duration: knownReadout(row.number - 1 === changed ? 99 : 60) };
        models.set(row.key, next);
        return next;
      };
  }
  const base = (derive: (row: StepRowModel) => StepRowModel) => ({
    rows: ROWS,
    deriveRow: derive,
    density,
    label: 'Route',
    activeIndex: null,
    selectedKeys: new Set<string>(),
    onActiveIndexChange: vi.fn(),
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    overscan: 2,
    initialViewportHeight: 10 * routeRowHeight(density),
  });

  it('re-renders only the rows whose model changed, and none for new handler identities', () => {
    const deriver = deriverFactory();
    const { rerender } = render(<RouteList {...base(deriver(null))} />);
    expect(renders.size).toBeGreaterThan(5);
    renders.clear();
    // A new walk: new deriver and new handlers, only row 3's numbers changed.
    rerender(<RouteList {...base(deriver(3))} />);
    expect([...renders.keys()]).toEqual(['step-3']);
    // The rows' handlers still reach the latest props.
    const onSelect = vi.fn();
    rerender(<RouteList {...base(deriver(3))} onSelect={onSelect} />);
    fireEvent.click(screen.getAllByRole('option')[1] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(1, 'replace');
  });

  it('re-renders at most the two rows whose selection changed, and none when the insertion line and band move', () => {
    const deriver = deriverFactory();
    const derive = deriver(null);
    const { rerender } = render(<RouteList {...base(derive)} selectedKeys={new Set(['step-2'])} activeIndex={2} insertAt={3} />);
    renders.clear();
    rerender(<RouteList {...base(derive)} selectedKeys={new Set(['step-3'])} activeIndex={3} insertAt={4} />);
    expect([...renders.keys()].sort()).toEqual(['step-2', 'step-3']);
    renders.clear();
    // The line and the band are single elements outside the rows: moving them renders no row.
    rerender(<RouteList {...base(derive)} selectedKeys={new Set(['step-3'])} activeIndex={3} insertAt={9} />);
    expect(renders.size).toBe(0);
    expect(document.querySelector<HTMLElement>('.frl-routelist__insert')?.style.top).toBe(`${String(9 * routeRowHeight(density))}px`);
  });

  it('refreshes line 2 of every mounted row when the view changes its words', () => {
    const deriver = deriverFactory();
    const { rerender } = render(<RouteList {...base(deriver(null, 'A'))} />);
    const mounted = renders.size;
    renders.clear();
    rerender(<RouteList {...base(deriver(null, 'B'))} />);
    expect(renders.size).toBe(mounted);
    expect(screen.getAllByRole('option')[0]?.getAttribute('aria-label')).toContain('Where B');
  });
});
