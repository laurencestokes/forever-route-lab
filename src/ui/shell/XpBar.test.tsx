// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { knownReadout, unknownReadout } from '../lib/readout';
import { StatusBar, optimizerText, type StatusBarProps } from './StatusBar';
import { XpBar, xpBarState } from './XpBar';

afterEach(cleanup);

describe('xpBarState', () => {
  it('computes fill and text for known progress', () => {
    expect(xpBarState({ level: 12, xp: 3400, xpToNext: 9800, lowerBound: false })).toEqual({
      kind: 'progress',
      fraction: 3400 / 9800,
      text: '3,400 / 9,800 XP',
      valueText: 'Level 12, 3,400 of 9,800 XP (34%)',
    });
  });

  it('says "at least" for a lower bound, with the reason', () => {
    const state = xpBarState({
      level: 12,
      xp: 3400,
      xpToNext: 9800,
      lowerBound: true,
      lowerBoundReason: '2 quests with unknown XP are not counted',
    });
    expect(state.text).toBe('≥3,400 / 9,800 XP');
    expect(state.valueText).toBe(
      'At least level 12, at least 3,400 of 9,800 XP (34%) (lower bound: 2 quests with unknown XP are not counted)',
    );
  });

  it('clamps overfull bars', () => {
    expect(xpBarState({ level: 5, xp: 5000, xpToNext: 4000, lowerBound: false }).fraction).toBe(1);
  });

  it('keeps unknown unknown: no fill, no zero', () => {
    const state = xpBarState({ level: null, xp: null, xpToNext: null, lowerBound: false, unknownReason: 'no route yet' });
    expect(state).toEqual({ kind: 'unknown', fraction: 0, text: 'XP ?', valueText: 'Level unknown: no route yet' });
    expect(xpBarState({ level: 7, xp: null, xpToNext: 4000, lowerBound: false }).valueText).toBe('Level 7, XP unknown');
  });

  it('reports the level cap', () => {
    expect(xpBarState({ level: 60, xp: null, xpToNext: null, atCap: true, lowerBound: false })).toEqual({
      kind: 'cap',
      fraction: 1,
      text: 'Max level',
      valueText: 'Level 60, the level cap',
    });
  });
});

describe('XpBar', () => {
  it('exposes a progressbar with values and a text alternative', () => {
    render(<XpBar level={12} xp={3400} xpToNext={9800} lowerBound={false} />);
    const bar = screen.getByRole('progressbar', { name: 'Projected level' });
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('9800');
    expect(bar.getAttribute('aria-valuenow')).toBe('3400');
    expect(bar.getAttribute('aria-valuetext')).toBe('Level 12, 3,400 of 9,800 XP (34%)');
    expect((bar.querySelector('.frl-xpbar__fill') as HTMLElement).style.width).toMatch(/^34\.69/);
    expect(bar.querySelector('.frl-xpbar__marker')).toBeNull();
  });

  it('draws the lower-bound marker and hatching, and marks assumptions', () => {
    const { container } = render(<XpBar level={12} xp={3400} xpToNext={9800} lowerBound assumed eraFallback />);
    const root = container.querySelector('.frl-xpbar') as HTMLElement;
    expect(root.getAttribute('data-state')).toBe('lower-bound');
    expect(root.textContent).toContain('≥');
    expect(root.querySelector('.frl-xpbar__marker')).not.toBeNull();
    expect(root.querySelector('.frl-xpbar__beyond')).not.toBeNull();
    expect(root.querySelector('[data-reason="assumption"]')).not.toBeNull();
    expect(root.querySelector('[data-reason="era-fallback"]')).not.toBeNull();
  });

  it('is indeterminate when unknown', () => {
    render(<XpBar level={null} xp={null} xpToNext={null} lowerBound={false} unknownReason="no dataset" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.getAttribute('aria-valuetext')).toBe('Level unknown: no dataset');
    expect(bar.parentElement?.textContent).toContain('Lv ?');
    expect(bar.parentElement?.textContent).not.toContain('0');
  });
});

describe('StatusBar', () => {
  const props: StatusBarProps = {
    xp: { level: 3, xp: 120, xpToNext: 1400, lowerBound: false },
    currentStep: { number: 4, total: 120, title: 'Placeholder step 4' },
    duration: knownReadout(3 * 3600 + 7 * 60 + 5, { assumed: true }),
    xpPerHour: unknownReadout('Quest XP unknown'),
    optimizer: { state: 'unavailable', detail: 'Arrives in Milestone 7' },
    data: { label: 'none', detail: 'Placeholder data: no dataset loaded', placeholder: true },
    ruleset: { label: 'forever-beta', detail: 'Forever beta ruleset', eraFallback: true },
  };

  it('shows each readout with its state', () => {
    const { container } = render(<StatusBar {...props} />);
    const region = screen.getByRole('region', { name: 'Route status' });
    expect(region.textContent).toContain('4/120');
    expect(region.textContent).toContain('Placeholder step 4');
    expect(region.textContent).toContain('3h 07m');
    expect(region.textContent).toContain('3 hours 7 minutes');
    // XP/h is unknown: "?" with the reason, never 0.
    const unknown = container.querySelector('[data-state="unknown"]');
    expect(unknown?.getAttribute('title')).toBe('Quest XP unknown');
    expect(region.textContent).toContain('Not available');
    expect(region.textContent).toContain('Placeholder');
    expect(region.textContent).toContain('forever-beta');
    expect(container.querySelector('.frl-badge [data-reason="era-fallback"]')).not.toBeNull();
  });

  it('shows optimiser progress', () => {
    render(<StatusBar {...props} optimizer={{ state: 'running', progress: 0.456, detail: null }} />);
    const progress = screen.getByRole('progressbar', { name: 'Optimiser progress' });
    expect(progress.getAttribute('aria-valuenow')).toBe('45');
    expect(optimizerText({ state: 'running', progress: 0.456, detail: null })).toBe('Running 45%');
    expect(optimizerText({ state: 'proposal', detail: null })).toBe('Proposal ready');
  });
});
