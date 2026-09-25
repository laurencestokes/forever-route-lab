// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_ISSUES } from '../lib/issues';
import { knownReadout, unknownReadout } from '../lib/readout';
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
  quest: { level: 8, difficulty: 'difficult', uncertain: false, provenance: UNKNOWN_FOREVER_PROVENANCE },
  issues: NO_ISSUES,
  locked: false,
};

describe('describeStepRow', () => {
  it('names the step in words: number, kind, title, difficulty and level', () => {
    expect(describeStepRow(base)).toBe(
      '12. Accept quest: Placeholder quest A, Placeholder zone. Quest level 8, Difficult (yellow). Level after step 7.4.',
    );
  });

  it('spells out lower bounds, assumptions, issues, provenance and the lock', () => {
    const model: StepRowModel = {
      ...base,
      kind: 'turnin',
      detail: null,
      quest: { level: 8, difficulty: 'standard', uncertain: true, provenance: { claim: 'new', declaredBy: 'user' } },
      projectedLevel: knownReadout(9.05, { lowerBound: true, assumed: true }),
      issues: { error: 1, warning: 2, info: 0 },
      locked: true,
    };
    expect(describeStepRow(model)).toBe(
      '12. Turn in quest: Placeholder quest A. Quest level 8, Standard (green), from a lower-bound level: may be easier. ' +
        'New in Forever (user-declared). Level after step at least 9.0 (depends on assumptions). 1 error, 2 warnings. Locked.',
    );
  });

  it('names the group a step sits under', () => {
    expect(describeStepRow(base, 'Placeholder guide, step 3')).toBe(
      '12. Accept quest: Placeholder quest A, Placeholder zone, in group Placeholder guide, step 3. ' +
        'Quest level 8, Difficult (yellow). Level after step 7.4.',
    );
    expect(describeStepRow(base, null)).toBe(describeStepRow(base));
  });

  it('keeps an unknown level unknown', () => {
    const model: StepRowModel = { ...base, kind: 'grind', quest: null, projectedLevel: unknownReadout('Quest XP unknown') };
    expect(describeStepRow(model)).toBe(
      '12. Grind: Placeholder quest A, Placeholder zone. Level after step unknown: Quest XP unknown.',
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
    expect(issues?.getAttribute('title')).toBe('2 warnings, 1 note');
  });

  it('shows a ≥ lower bound and the assumed marker', () => {
    const { container } = render(
      <StepRow
        model={{ ...base, projectedLevel: knownReadout(9.5, { lowerBound: true, assumed: true }) }}
        selected={false}
        active={false}
      />,
    );
    const level = container.querySelector('.frl-steprow__level');
    expect(level?.getAttribute('data-state')).toBe('lower-bound');
    expect(level?.textContent).toContain('≥9.5');
    expect(level?.querySelector('[data-reason="assumption"]')).not.toBeNull();
  });

  it('shows ? for an unknown level, never 0', () => {
    const { container } = render(
      <StepRow model={{ ...base, projectedLevel: unknownReadout('No XP data') }} selected={false} active={false} />,
    );
    const level = container.querySelector('.frl-steprow__level');
    expect(level?.getAttribute('data-state')).toBe('unknown');
    expect(level?.textContent).toContain('?');
    expect(level?.textContent).not.toContain('0');
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
