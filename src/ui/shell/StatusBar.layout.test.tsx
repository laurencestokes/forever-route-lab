// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { unknownReadout } from '../lib/readout';
import { RouteSummary } from './RouteSummary';
import { SimulationStatus, type SimulationStatusModel } from './SimulationStatus';
import { StatusBar } from './StatusBar';

/**
 * The status bar's structure that its narrow-window layout rests on (docs/UI.md §6, §16; UI-01,
 * UI-07, UI-15). Vitest does not load stylesheets into tests (CSS imports are empty), so the
 * widths, focus rings and forced colours themselves are checked in a browser (UI.md §16 "Checked by
 * hand"); these pin the hooks the stylesheet uses.
 */

afterEach(cleanup);

const computing: SimulationStatusModel = { state: 'computing', done: 3, total: 8, detail: '3 of 8.' };

function bar(
  currentStep: { number: number; total: number; title: string } | null = { number: 4, total: 55, title: 'Your Place In The World (1/2)' },
  questLog: { text: string; detail: string } | null = { text: '4 / 40', detail: 'In the quest log after step 4: 4 of 40 quests (capacity 40: client data).' },
) {
  return render(
    <StatusBar
      xp={{ level: 5, xp: 10, xpToNext: 100, lowerBound: false, label: currentStep === null ? 'Level at the end of the route' : `Level after step ${String(currentStep.number)}` }}
      questLog={questLog}
      currentStep={currentStep}
      duration={unknownReadout<number>('x')}
      xpPerHour={unknownReadout<number>('x')}
      summary={<RouteSummary rows={[]} notes={['A note.']} />}
      simulation={<SimulationStatus status={computing} onCancel={() => undefined} />}
      optimizer={{ state: 'unavailable', detail: 'Arrives in Milestone 7' }}
      data={{ label: '65c377bc', detail: 'Data revision', placeholder: false }}
      ruleset={{ label: 'forever-beta', detail: 'Forever beta', eraFallback: true }}
    />,
  );
}

describe('status bar structure (UI-01)', () => {
  it('merges the level with the step, "Lv 5 after step 4", with the step\u2019s title as its tooltip (ui-refresh.md §8)', () => {
    const { container } = bar();
    const level = container.querySelector('.frl-xpbar__level');
    expect(level?.textContent).toBe('Lv 5 after step 4');
    expect(level?.querySelector('.frl-xpbar__after')?.textContent).toBe(' after step 4');
    expect(level?.getAttribute('title')).toBe('Step 4 of 55: Your Place In The World (1/2)');
    expect(container.querySelector('.frl-statusbar__step')).toBeNull();
    expect(container.querySelector('.frl-statusbar__step-title')).toBeNull();
    cleanup();
    expect(bar(null).container.querySelector('.frl-xpbar__level')?.textContent).toBe('Lv 5 at the end of the route');
  });

  it('says the quest log after the step, "In log 4 / 40", with its basis in words, and says nothing when not given', () => {
    const { container } = bar();
    const log = container.querySelector('.frl-statusbar__log');
    expect(log?.textContent).toContain('In log');
    expect(log?.textContent).toContain('4 / 40');
    expect(log?.getAttribute('title')).toBe('In the quest log after step 4: 4 of 40 quests (capacity 40: client data).');
    expect(log?.querySelector('.frl-visually-hidden')?.textContent).toBe('In the quest log after step 4: 4 of 40 quests (capacity 40: client data).');
    cleanup();
    expect(bar(undefined, null).container.querySelector('.frl-statusbar__log')).toBeNull();
  });

  it('keeps the badges’ key words in their own spans, so they can leave the view and still be spoken', () => {
    const { container } = bar();
    const keys = [...container.querySelectorAll('.frl-statusbar__badge-key')].map((key) => key.textContent);
    expect(keys).toEqual(['Data ', 'Ruleset ']);
    expect(container.querySelector('.frl-statusbar__badges')?.textContent).toContain('Data 65c377bc');
  });

  it('keeps the unavailable optimiser in the page (its state is spoken, its live region never remounted)', () => {
    const { container } = bar();
    const optimizer = container.querySelector('.frl-statusbar__optimizer.is-unavailable');
    expect(optimizer?.querySelector('[aria-live="polite"]')?.textContent).toBe('Not available');
  });
});

describe('route summary hooks (UI-07)', () => {
  it('marks the open disclosure, which lays its panel out in the flow at 720px and below', () => {
    const { container } = bar();
    expect(container.querySelector('.frl-summary')?.className).not.toContain('is-open');
    fireEvent.click(screen.getByRole('button', { name: 'Summary' }));
    expect(container.querySelector('.frl-summary')?.className).toContain('is-open');
  });
});

describe('progress track hooks (UI-15)', () => {
  it('marks an unknown count’s track, which forced colours with reduced motion draw dashed and empty', () => {
    const { container } = render(<SimulationStatus status={{ state: 'computing', done: null, total: null, detail: 'Counting.' }} />);
    expect(container.querySelector('.frl-statusbar__progress')?.className).toContain('is-indeterminate');
    cleanup();
    const known = render(<SimulationStatus status={computing} />);
    expect(known.container.querySelector('.frl-statusbar__progress')?.className).not.toContain('is-indeterminate');
  });
});
