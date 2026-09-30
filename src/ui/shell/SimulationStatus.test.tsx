// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { knownReadout } from '../lib/readout';
import { PENDING_TRAVEL_TEXT, PendingMarker } from '../markers/PendingMarker';
import { ReadoutValue } from '../markers/ReadoutValue';
import { IssueList } from './DetailParts';
import { RouteSummary } from './RouteSummary';
import { COUNTING_LEGS_TEXT, PATHS_READY_TEXT, SimulationStatus, type SimulationStatusModel, simulationStatusText } from './SimulationStatus';

afterEach(cleanup);

describe('SimulationStatus', () => {
  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<SimulationStatus status={{ state: 'ready' }} />);
    expect(container.innerHTML).toBe('');
  });

  it('says each state in words with its detail, and offers no action it cannot run', () => {
    const { container, rerender } = render(<SimulationStatus status={{ state: 'loading', detail: 'Not simulated yet' }} />);
    expect(container.textContent).toBe('SimulationLoadingNot simulated yet');
    rerender(<SimulationStatus status={{ state: 'failed', detail: 'offline' }} />);
    expect(container.textContent).toBe('SimulationFailedoffline');
    rerender(<SimulationStatus status={{ state: 'computing', done: 1, total: 4, detail: 'details' }} />);
    expect(screen.getByRole('progressbar', { name: 'Walking paths computed' }).getAttribute('aria-valuetext')).toBe('1 of 4 legs');
    // Without a handler there is no Cancel button.
    expect(screen.queryByRole('button')).toBeNull();
    expect(simulationStatusText({ state: 'paused', pending: 1, detail: '' })).toBe('Paused, 1 leg pending');
  });

  it('is not a live region: progress is never announced', () => {
    const { container } = render(<SimulationStatus status={{ state: 'computing', done: 1, total: 4, detail: 'details' }} onCancel={vi.fn()} />);
    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('says a run that has not counted its legs is counting: an indeterminate bar, no numbers, never "0/0" (UI-08)', () => {
    const { container } = render(<SimulationStatus status={{ state: 'computing', done: null, total: null, detail: 'Counting.' }} onCancel={vi.fn()} />);
    const bar = screen.getByRole('progressbar', { name: 'Walking paths computed' });
    expect(bar.getAttribute('aria-valuetext')).toBe('Counting legs');
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.hasAttribute('aria-valuemax')).toBe(false);
    expect(bar.firstElementChild?.className).toContain('is-indeterminate');
    expect(container.textContent).toContain(COUNTING_LEGS_TEXT);
    expect(container.textContent).not.toMatch(/\d/);
    // A zero total from a caller is the same: unknown, not an empty bar.
    render(<SimulationStatus status={{ state: 'computing', done: 0, total: 0, detail: 'x' }} />);
    expect(screen.getAllByRole('progressbar')[1]?.getAttribute('aria-valuetext')).toBe('Counting legs');
  });
});

describe('SimulationStatus keeps keyboard focus (UI-03)', () => {
  const computing: SimulationStatusModel = { state: 'computing', done: 1, total: 4, detail: 'details' };
  const counting: SimulationStatusModel = { state: 'computing', done: null, total: null, detail: 'counting' };
  const paused: SimulationStatusModel = { state: 'paused', pending: 3, detail: 'paused' };
  const ready: SimulationStatusModel = { state: 'ready' };
  const item = () => document.querySelector<HTMLElement>('.frl-statusbar__simulation');

  function Harness({ status }: { readonly status: SimulationStatusModel }) {
    return (
      <div>
        <button type="button">Before</button>
        <SimulationStatus status={status} onCancel={vi.fn()} onResume={vi.fn()} />
        <button type="button">After</button>
      </div>
    );
  }

  it('moves focus to the button that takes the focused one\u2019s place, through a state with none', () => {
    const { rerender } = render(<Harness status={computing} />);
    act(() => {
      screen.getByRole('button', { name: 'Cancel computing walking paths' }).focus();
    });
    rerender(<Harness status={paused} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Resume computing walking paths' }));
    rerender(<Harness status={counting} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel computing walking paths' }));
    rerender(<Harness status={computing} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel computing walking paths' }));
  });

  it('keeps the item, focused, when computing ends under the focused Cancel, until focus leaves it', async () => {
    const { rerender } = render(<Harness status={computing} />);
    act(() => {
      screen.getByRole('button', { name: 'Cancel computing walking paths' }).focus();
    });
    rerender(<Harness status={ready} />);
    expect(document.activeElement).toBe(item());
    expect(item()?.textContent).toContain(PATHS_READY_TEXT);
    expect(item()?.getAttribute('data-state')).toBe('ready');
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(item());
    // Leaving it lets it go.
    act(() => {
      screen.getByRole('button', { name: 'After' }).focus();
    });
    expect(item()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After' }));
  });

  it('never takes focus it does not hold: background changes leave focus where the user is', () => {
    const { rerender } = render(<Harness status={computing} />);
    const before = screen.getByRole('button', { name: 'Before' });
    act(() => {
      before.focus();
    });
    rerender(<Harness status={paused} />);
    rerender(<Harness status={ready} />);
    expect(document.activeElement).toBe(before);
    expect(item()).toBeNull();
  });
});

describe('PendingMarker and pending readouts', () => {
  it('draws an hourglass with its words, or silently inside a named row', () => {
    const { container, rerender } = render(<PendingMarker />);
    expect(container.textContent).toBe(`(${PENDING_TRAVEL_TEXT})`);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    rerender(<PendingMarker silent />);
    expect(container.textContent).toBe('');
    expect(container.firstElementChild?.getAttribute('title')).toBe(PENDING_TRAVEL_TEXT);
  });

  it('marks a provisional readout, and only a known one', () => {
    const { container } = render(<ReadoutValue readout={knownReadout(90)} format={String} pending="Pending: legs." />);
    expect(container.querySelector('.frl-readout--pending')).not.toBeNull();
    expect(container.textContent).toContain('(Pending: legs.)');
  });
});

describe('RouteSummary', () => {
  it('is a disclosure: the panel follows the button, and a press outside closes it', () => {
    render(
      <div>
        <RouteSummary rows={[{ term: 'Duration', value: '1h', basis: 'depends on assumptions' }]} notes={['A note.']} />
        <button type="button">Elsewhere</button>
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Summary' });
    fireEvent.click(button);
    const panel = screen.getByRole('region', { name: 'Route summary' });
    expect(button.getAttribute('aria-controls')).toBe(panel.id);
    expect(within(panel).getByRole('columnheader', { name: 'Basis' })).toBeTruthy();
    expect(panel.textContent).toContain('A note.');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('region', { name: 'Route summary' })).toBeNull();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.queryByRole('region', { name: 'Route summary' })).toBeNull();
  });

  it('closes when keyboard focus leaves it, so it never covers the focused control (UI-06)', () => {
    render(
      <div>
        <button type="button">Before</button>
        <RouteSummary rows={[{ term: 'Duration', value: '1h', basis: 'depends on assumptions' }]} notes={[]} />
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Summary' });
    fireEvent.click(button);
    expect(screen.getByRole('region', { name: 'Route summary' })).toBeTruthy();
    const before = screen.getByRole('button', { name: 'Before' });
    fireEvent.blur(button, { relatedTarget: before });
    expect(screen.queryByRole('region', { name: 'Route summary' })).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('lists every parameter the route reads with its origin (UI-13)', () => {
    const keys = ['killSeconds', 'runSpeed', 'swimSpeed', 'lootSeconds', 'questXpRounding', 'questXpMultiplier'] as const;
    const parameters = keys.map((key, i) => ({ key, label: `parameter ${'abcdef'.charAt(i)}`, origin: i % 2 === 0 ? 'Era value' : 'your assumption' }));
    render(<RouteSummary rows={[]} notes={[]} parameters={parameters} />);
    fireEvent.click(screen.getByRole('button', { name: 'Summary' }));
    const list = screen.getByRole('list', { name: /The route reads 6 parameters/ });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'parameter a (Era value)',
      'parameter b (your assumption)',
      'parameter c (Era value)',
      'parameter d (your assumption)',
      'parameter e (Era value)',
      'parameter f (your assumption)',
    ]);
  });
});

describe('IssueList', () => {
  const items = [
    { key: 'a', severity: 'error' as const, code: 'VAL004-min-level', message: 'Too low.', stepNumber: 3, explanation: 'Level must reach it.' },
    { key: 'b', severity: 'info' as const, code: 'SIM022-legs-pending', message: 'Pending.', stepNumber: null },
    { key: 'c', severity: 'warning' as const, code: 'LINT003-low-value', message: 'Grey.', stepNumber: 7, explanation: null },
  ];

  it('without onSelect is plain text: no buttons, severity in words, where it is', () => {
    render(<IssueList items={items} label="Checks" />);
    const list = screen.getByRole('list', { name: 'Checks' });
    expect(within(list).queryAllByRole('button')).toHaveLength(0);
    expect(list.textContent).toContain('Error');
    expect(list.textContent).toContain('Step 3');
    expect(list.textContent).toContain('Route');
    expect(list.textContent).toContain('Level must reach it.');
  });

  it('with onSelect makes step issues one composite of buttons, named in words and described by the explanation', () => {
    const onSelect = vi.fn();
    render(<IssueList items={items} onSelect={onSelect} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Error, step 3: Too low. (VAL004-min-level)',
      'Warning, step 7: Grey. (LINT003-low-value)',
    ]);
    expect(buttons.map((b) => b.tabIndex)).toEqual([0, -1]);
    expect(document.getElementById(buttons[0]?.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Level must reach it.');
    expect(buttons[1]?.hasAttribute('aria-describedby')).toBe(false);
    buttons[0]?.focus();
    fireEvent.keyDown(buttons[0] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(buttons[1] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.click(buttons[1] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith('c');
  });
});
