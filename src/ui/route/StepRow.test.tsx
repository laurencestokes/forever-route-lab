// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_ISSUES } from '../lib/issues';
import { knownReadout, unknownReadout } from '../lib/readout';
import { PENDING_CHECKING_TEXT, PENDING_TRAVEL_TEXT } from '../markers/PendingMarker';
import { UNKNOWN_FOREVER_PROVENANCE } from '../markers/provenance';
import { GroupRow, StepRow, describeStepRow } from './StepRow';
import type { StepRowModel } from './rows';

afterEach(cleanup);

const base: StepRowModel = {
  type: 'step',
  key: 'step-12',
  number: 12,
  kind: 'accept',
  title: 'Placeholder quest A',
  detail: 'Placeholder zone',
  projectedLevel: knownReadout(7.46),
  duration: knownReadout(125),
  xpGained: knownReadout(0),
  pending: null,
  assumptions: null,
  quest: { level: 8, difficulty: 'difficult', uncertain: false, provenance: UNKNOWN_FOREVER_PROVENANCE },
  issues: NO_ISSUES,
  locked: false,
};

/** The estimates as the name says them when they are 7.4, 0 XP and 2 minutes 5 seconds. */
const BASE_ESTIMATES = 'Level after step 7.4. XP gained 0 XP. Time 2 minutes 5 seconds';

describe('describeStepRow', () => {
  it('names the step in words: number, kind, title, difficulty and every estimate', () => {
    expect(describeStepRow(base)).toBe(
      `12. Accept quest: Placeholder quest A, Placeholder zone. Quest level 8, Difficult (yellow). ${BASE_ESTIMATES}.`,
    );
  });

  it('spells out lower bounds, assumptions, issues, provenance and the lock', () => {
    const model: StepRowModel = {
      ...base,
      kind: 'turnin',
      detail: null,
      quest: { level: 8, difficulty: 'standard', uncertain: true, provenance: { claim: 'new', declaredBy: 'user' } },
      projectedLevel: knownReadout(9.05, { lowerBound: true, assumed: true }),
      xpGained: knownReadout(450, { assumed: true, eraFallback: true }),
      duration: knownReadout(3700, { assumed: true }),
      issues: { error: 1, warning: 2, info: 0 },
      locked: true,
    };
    expect(describeStepRow(model)).toBe(
      '12. Turn in quest: Placeholder quest A. Quest level 8, Standard (green), from a lower-bound level: may be easier. ' +
        'New in Forever (user-declared). Level after step at least 9.0 (depends on assumptions). ' +
        'XP gained 450 XP (depends on assumptions, uses Era values). Time 1 hour 1 minute (depends on assumptions). ' +
        'Issues: 1 error, 2 warnings. Locked.',
    );
  });

  it('says when a travel time waits for its walking path, or for the navigation data to be checked', () => {
    expect(describeStepRow({ ...base, pending: 'path' })).toContain(
      'Time 2 minutes 5 seconds, pending: its walking path is still being computed, so the travel time is a straight-line estimate for now.',
    );
    expect(describeStepRow({ ...base, pending: 'checking' })).toContain(
      'Time 2 minutes 5 seconds, pending: the navigation data is still being checked, so the travel time is a straight-line estimate for now.',
    );
  });

  it('says an upper bound as "at most"', () => {
    expect(describeStepRow({ ...base, xpGained: knownReadout(450, { upperBound: true }) })).toContain('XP gained at most 450 XP');
  });

  it('names the group a step sits under', () => {
    expect(describeStepRow(base, 'Placeholder guide, step 3')).toBe(
      '12. Accept quest: Placeholder quest A, Placeholder zone, in group Placeholder guide, step 3. ' +
        `Quest level 8, Difficult (yellow). ${BASE_ESTIMATES}.`,
    );
    expect(describeStepRow(base, null)).toBe(describeStepRow(base));
  });

  it('keeps unknown estimates unknown, with their reasons', () => {
    const model: StepRowModel = {
      ...base,
      kind: 'grind',
      quest: null,
      projectedLevel: unknownReadout('Quest XP unknown'),
      xpGained: unknownReadout('No XP record'),
    };
    expect(describeStepRow(model)).toBe(
      '12. Grind: Placeholder quest A, Placeholder zone. Level after step unknown: Quest XP unknown. XP gained unknown: No XP record. ' +
        'Time 2 minutes 5 seconds.',
    );
  });

  it('says a shared reason once when nothing is simulated', () => {
    const unknown = unknownReadout<number>('Not simulated yet');
    const model: StepRowModel = { ...base, quest: null, projectedLevel: unknown, xpGained: unknown, duration: unknown };
    expect(describeStepRow(model)).toBe(
      '12. Accept quest: Placeholder quest A, Placeholder zone. Level after step, XP and time unknown: Not simulated yet.',
    );
  });
});

describe('StepRow', () => {
  it('renders one option with the number, glyph, title and level', () => {
    render(<StepRow model={base} selected={false} active={false} />);
    const option = screen.getByRole('option');
    expect(option.getAttribute('aria-selected')).toBe('false');
    expect(option.textContent).toContain('12');
    expect(option.textContent).toContain('Placeholder quest A');
    expect(option.textContent).toContain('7.4');
    expect(option.querySelector('[data-step-kind="accept"]')).not.toBeNull();
    expect(option.querySelector('[data-difficulty="difficult"]')).not.toBeNull();
  });

  it('shows the worst severity and the issue total', () => {
    const { container } = render(
      <StepRow model={{ ...base, issues: { error: 0, warning: 2, info: 1 } }} selected={false} active={false} />,
    );
    const issues = container.querySelector('.frl-steprow__issues');
    expect(issues?.getAttribute('data-severity')).toBe('warning');
    expect(issues?.textContent).toBe('3');
    expect(issues?.getAttribute('title')).toBe('Issues: 2 warnings, 1 info issue');
    // The row's name carries the indicator in words (option children are presentational).
    expect(screen.getByRole('option').getAttribute('aria-label')).toContain('Issues: 2 warnings, 1 info issue.');
  });

  it('shows a ≥ lower bound and the assumed marker', () => {
    const { container } = render(
      <StepRow
        model={{ ...base, projectedLevel: knownReadout(9.5, { lowerBound: true, assumed: true }) }}
        selected={false}
        active={false}
      />,
    );
    const level = container.querySelector('.frl-steprow__estimate .frl-readout');
    expect(container.querySelector('.frl-steprow__estimate')?.getAttribute('data-column')).toBe('level');
    expect(level?.getAttribute('data-state')).toBe('lower-bound');
    expect(level?.textContent).toContain('≥9.5');
    expect(level?.querySelector('[data-reason="assumption"]')).not.toBeNull();
  });

  it('shows ? for an unknown level, never 0', () => {
    const { container } = render(
      <StepRow model={{ ...base, projectedLevel: unknownReadout('No XP data') }} selected={false} active={false} />,
    );
    const level = container.querySelector('.frl-steprow__estimate .frl-readout');
    expect(level?.getAttribute('data-state')).toBe('unknown');
    expect(level?.textContent).toContain('?');
    expect(level?.textContent).not.toContain('0');
  });

  it('shows the chosen estimate with its basis markers: XP gained or the step time', () => {
    const model: StepRowModel = {
      ...base,
      xpGained: knownReadout(1250, { assumed: true, eraFallback: true }),
      duration: knownReadout(125, { eraFallback: true }),
      assumptions: 'seconds per kill (your assumption)',
    };
    const { container, rerender } = render(<StepRow model={model} estimateColumn="xp" selected={false} active={false} />);
    const cell = () => container.querySelector('.frl-steprow__estimate');
    expect(cell()?.getAttribute('data-column')).toBe('xp');
    expect(cell()?.textContent).toContain('+1,250');
    // Dense rows show one marker; its words cover both the assumption and the Era values.
    const marker = cell()?.querySelector('[data-reason="assumption"]');
    expect(marker?.getAttribute('title')).toBe(
      'Depends on assumptions: this step reads seconds per kill (your assumption); also uses Era values where Forever values are unknown',
    );
    rerender(<StepRow model={model} estimateColumn="time" selected={false} active={false} />);
    expect(cell()?.getAttribute('data-column')).toBe('time');
    expect(cell()?.textContent).toContain('2m 05s');
    expect(cell()?.querySelector('[data-reason="era-fallback"]')).not.toBeNull();
    // Every estimate is in the cell's tooltip, whichever one it shows.
    expect(cell()?.getAttribute('title')).toBe(
      'Level after 7.4 · XP +1,250 ≈ E · Time 2m 05s E. This step reads seconds per kill (your assumption)',
    );
  });

  it('shows unknown XP and time as ? with the reason, never 0', () => {
    const model: StepRowModel = { ...base, xpGained: unknownReadout('No XP record'), duration: unknownReadout('No drop source') };
    const { container, rerender } = render(<StepRow model={model} estimateColumn="xp" selected={false} active={false} />);
    const readout = () => container.querySelector('.frl-steprow__estimate .frl-readout');
    expect(readout()?.getAttribute('data-state')).toBe('unknown');
    expect(readout()?.getAttribute('title')).toBe('No XP record');
    expect(readout()?.textContent).not.toContain('0');
    rerender(<StepRow model={model} estimateColumn="time" selected={false} active={false} />);
    expect(readout()?.getAttribute('title')).toBe('No drop source');
  });

  it('marks a step whose travel time waits for its walking path', () => {
    const { container, rerender } = render(
      <StepRow model={{ ...base, pending: 'path' }} estimateColumn="time" selected={false} active={false} />,
    );
    const option = screen.getByRole('option');
    expect(option.className).toContain('is-pending');
    const marker = container.querySelector('.frl-steprow__estimate [data-state="pending"]');
    expect(marker?.getAttribute('title')).toBe(PENDING_TRAVEL_TEXT);
    // Silent inside the row: the row's name says it once.
    expect(marker?.textContent).toBe('');
    expect(option.getAttribute('aria-label')).toContain('pending: its walking path is still being computed');
    rerender(<StepRow model={{ ...base, pending: 'checking' }} estimateColumn="time" selected={false} active={false} />);
    expect(container.querySelector('.frl-steprow__estimate [data-state="pending"]')?.getAttribute('title')).toBe(PENDING_CHECKING_TEXT);
    rerender(<StepRow model={base} estimateColumn="time" selected={false} active={false} />);
    expect(container.querySelector('[data-state="pending"]')).toBeNull();
    expect(screen.getByRole('option').className).not.toContain('is-pending');
  });

  it('draws the hourglass beside the step time only: level and XP do not wait for walking paths (UI-12)', () => {
    const { container, rerender } = render(<StepRow model={{ ...base, pending: 'path' }} estimateColumn="level" selected={false} active={false} />);
    expect(container.querySelector('[data-state="pending"]')).toBeNull();
    // The row still says the travel time is pending, in its name and the cell's tooltip.
    expect(screen.getByRole('option').getAttribute('aria-label')).toContain('pending: its walking path is still being computed');
    expect(container.querySelector('.frl-steprow__estimate')?.getAttribute('title')).toContain('(walking path pending)');
    rerender(<StepRow model={{ ...base, pending: 'path' }} estimateColumn="xp" selected={false} active={false} />);
    expect(container.querySelector('[data-state="pending"]')).toBeNull();
    rerender(<StepRow model={{ ...base, pending: 'path' }} estimateColumn="time" selected={false} active={false} />);
    expect(container.querySelector('[data-state="pending"]')).not.toBeNull();
  });

  const action = (name: 'duplicate' | 'delete' | 'lock') => {
    const el = screen.getByRole('option').querySelector(`[data-action="${name}"]`);
    if (!(el instanceof HTMLElement)) throw new Error(`no ${name} affordance`);
    return el;
  };

  it('runs lock, duplicate and delete without selecting the row', () => {
    const onClick = vi.fn();
    const onToggleLock = vi.fn();
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();
    render(
      <StepRow
        model={base}
        selected={false}
        active
        onClick={onClick}
        onToggleLock={onToggleLock}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />,
    );
    expect(action('lock').getAttribute('title')).toBe('Lock step (L)');
    expect(action('duplicate').getAttribute('title')).toBe('Duplicate step (Ctrl+D)');
    expect(action('delete').getAttribute('title')).toBe('Delete step (Delete)');
    fireEvent.click(action('lock'));
    fireEvent.click(action('duplicate'));
    fireEvent.click(action('delete'));
    expect(onToggleLock).toHaveBeenCalledTimes(1);
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps the in-row affordances out of the accessibility tree and the tab order', () => {
    render(<StepRow model={base} selected={false} active onToggleLock={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />);
    const option = screen.getByRole('option');
    // Option children are presentational: nothing inside may be focusable or interactive
    // (axe-core's nested-interactive rule), so the affordances are hidden, focus-less spans.
    const focusable = option.querySelectorAll('button, a[href], input, select, textarea, [tabindex], [role="button"], [contenteditable]');
    expect(focusable).toHaveLength(0);
    for (const name of ['lock', 'duplicate', 'delete'] as const) {
      expect(action(name).tagName).toBe('SPAN');
      expect(action(name).closest('[aria-hidden="true"]')).not.toBeNull();
    }
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    // The row is still fully named in words.
    expect(option.getAttribute('aria-label')).toBe(describeStepRow(base));
  });

  it('shows the pressed lock for a locked step', () => {
    render(<StepRow model={{ ...base, locked: true }} selected active={false} onToggleLock={vi.fn()} />);
    expect(action('lock').className).toContain('is-pressed');
    expect(action('lock').getAttribute('title')).toBe('Unlock step (L)');
    expect(screen.getByRole('option').className).toContain('is-locked');
  });

  it('shows the lock disabled when there is no lock handler', () => {
    const onClick = vi.fn();
    render(<StepRow model={base} selected={false} active onClick={onClick} />);
    expect(action('lock').className).toContain('is-disabled');
    fireEvent.click(action('lock'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('has no editing affordances when read-only but still shows the lock state', () => {
    render(<StepRow model={{ ...base, locked: true }} selected={false} active readOnly onToggleLock={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole('option').querySelector('[data-action]')).toBeNull();
    expect(screen.getByRole('option').querySelector('[aria-label="Locked"]')).not.toBeNull();
  });

  it('says which group the step is in, and states its position only when given one', () => {
    render(<StepRow model={base} groupLabel="Step group" posInSet={12} setSize={40} selected={false} active={false} />);
    const option = screen.getByRole('option');
    expect(option.getAttribute('aria-label')).toMatch(/^12\. Accept quest: Placeholder quest A, Placeholder zone, in group Step group\. /);
    expect(option.getAttribute('aria-posinset')).toBe('12');
    expect(option.getAttribute('aria-setsize')).toBe('40');
  });

  it('shows provenance only when there is a claim', () => {
    const { container, rerender } = render(<StepRow model={base} selected={false} active={false} />);
    expect(container.querySelector('.frl-provenance')).toBeNull();
    rerender(
      <StepRow
        model={{ ...base, quest: { level: 8, difficulty: 'difficult', uncertain: false, provenance: { claim: 'changed', declaredBy: 'data' } } }}
        selected={false}
        active={false}
      />,
    );
    const badge = container.querySelector('.frl-provenance');
    expect(badge?.getAttribute('data-claim')).toBe('changed');
    expect(badge?.textContent).toContain('◇');
  });
});

describe('GroupRow', () => {
  it('is a one-line option naming the group and its size', () => {
    render(<GroupRow model={{ type: 'group', key: 'g1', label: 'Placeholder group', stepCount: 3 }} selected={false} active={false} />);
    const option = screen.getByRole('option', { name: 'Group: Placeholder group, 3 steps.' });
    expect(option.getAttribute('data-row-type')).toBe('group');
    expect(option.hasAttribute('aria-posinset')).toBe(false);
    expect(option.hasAttribute('aria-setsize')).toBe(false);
  });
});
