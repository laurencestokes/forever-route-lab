// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_ISSUES } from '../lib/issues';
import { knownReadout } from '../lib/readout';
import { RouteList } from './RouteList';
import type { StepRowModel } from './rows';
import type * as StepRowModule from './StepRow';
import { ROUTE_ROW_HEIGHT } from './virtual';

/**
 * The route list's rows are memoised (PERF-11): new derived results re-render only the rows whose
 * model changed, and new handler props from the panel re-render none. StepRow is wrapped to count
 * its renders.
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
  title: `Placeholder step ${String(i)}`,
  detail: null,
  projectedLevel: knownReadout(1),
  duration: knownReadout(60),
  xpGained: knownReadout(0),
  pending: null,
  assumptions: null,
  quest: null,
  issues: NO_ISSUES,
  locked: false,
});

const ROWS = Array.from({ length: 50 }, (_, i) => step(i));

describe('RouteList row memoisation (PERF-11)', () => {
  it('re-renders only the rows whose model changed, and none for new handler identities', () => {
    // Models for rows 0-49, kept per row; row 3's changes in the second pass.
    const models = new Map<string, StepRowModel>();
    const deriver = (changed: number | null) => (row: StepRowModel): StepRowModel => {
      const known = models.get(row.key);
      if (known !== undefined && row.number - 1 !== changed) return known;
      const next = { ...row, duration: knownReadout(row.number - 1 === changed ? 99 : 60) };
      models.set(row.key, next);
      return next;
    };
    const props = (changed: number | null) => ({
      rows: ROWS,
      deriveRow: deriver(changed),
      label: 'Route',
      activeIndex: null,
      selectedKeys: new Set<string>(),
      onActiveIndexChange: vi.fn(),
      onSelect: vi.fn(),
      onDelete: vi.fn(),
      overscan: 2,
      initialViewportHeight: 10 * ROUTE_ROW_HEIGHT,
    });
    const { rerender } = render(<RouteList {...props(null)} />);
    const mounted = [...renders.keys()];
    expect(mounted.length).toBeGreaterThan(5);
    renders.clear();
    // A new walk: new deriver and new handlers, only row 3's numbers changed.
    rerender(<RouteList {...props(3)} />);
    expect([...renders.keys()]).toEqual(['step-3']);
    // The rows' handlers still reach the latest props.
    const onSelect = vi.fn();
    rerender(<RouteList {...props(3)} onSelect={onSelect} />);
    fireEvent.click(screen.getAllByRole('option')[1] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(1, 'replace');
  });
});
