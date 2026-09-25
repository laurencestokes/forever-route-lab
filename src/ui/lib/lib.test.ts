import { describe, expect, it } from 'vitest';
import type { Estimated } from '../../domain/estimate';
import { cx } from './cx';
import { formatDuration, formatDurationLong, formatInteger, formatLevel, formatPercent, plural } from './format';
import { countIssues, describeIssueCounts, totalIssues, worstSeverity } from './issues';
import { toAriaKeyShortcuts } from './keys';
import { knownReadout, readoutFromEstimate, unknownReadout } from './readout';
import { applyThemePreference, isThemePreference, nextThemePreference } from './theme';

describe('format', () => {
  it('groups integers with commas and truncates', () => {
    expect(formatInteger(0)).toBe('0');
    expect(formatInteger(999)).toBe('999');
    expect(formatInteger(1000)).toBe('1,000');
    expect(formatInteger(1234567.9)).toBe('1,234,567');
    expect(formatInteger(-12345)).toBe('-12,345');
    expect(formatInteger(Number.NaN)).toBe('?');
  });

  it('truncates fractional levels to one decimal', () => {
    expect(formatLevel(12)).toBe('12.0');
    expect(formatLevel(12.47)).toBe('12.4');
    expect(formatLevel(12.7)).toBe('12.7');
    expect(formatLevel(12.99)).toBe('12.9');
    expect(formatLevel(1.3)).toBe('1.3');
    expect(formatLevel(-1)).toBe('?');
  });

  it('formats percentages without rounding up', () => {
    expect(formatPercent(0.456)).toBe('45%');
    expect(formatPercent(0.999)).toBe('99%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(1.5)).toBe('100%');
    expect(formatPercent(0.29)).toBe('29%');
  });

  it('formats durations compactly and in words', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(725)).toBe('12m 05s');
    expect(formatDuration(3 * 3600 + 7 * 60 + 59)).toBe('3h 07m');
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(-1)).toBe('?');
    expect(formatDurationLong(3 * 3600 + 7 * 60)).toBe('3 hours 7 minutes');
    expect(formatDurationLong(61)).toBe('1 minute 1 second');
    expect(formatDurationLong(0)).toBe('0 seconds');
    expect(formatDurationLong(3600)).toBe('1 hour');
  });

  it('pluralises', () => {
    expect(plural(1, 'step')).toBe('1 step');
    expect(plural(2, 'step')).toBe('2 steps');
    expect(plural(1200, 'quest')).toBe('1,200 quests');
  });
});

describe('issues', () => {
  const counts = countIssues([{ severity: 'warning' }, { severity: 'error' }, { severity: 'warning' }, { severity: 'info' }]);

  it('counts, totals and ranks severities', () => {
    expect(counts).toEqual({ error: 1, warning: 2, info: 1 });
    expect(totalIssues(counts)).toBe(4);
    expect(worstSeverity(counts)).toBe('error');
    expect(worstSeverity({ error: 0, warning: 0, info: 3 })).toBe('info');
    expect(worstSeverity({ error: 0, warning: 0, info: 0 })).toBeNull();
  });

  it('describes counts in words', () => {
    expect(describeIssueCounts(counts)).toBe('1 error, 2 warnings, 1 note');
    expect(describeIssueCounts({ error: 0, warning: 0, info: 0 })).toBe('No issues');
  });
});

// Literal estimates: ui code imports only types from pure modules (ARCHITECTURE §4).
const est = (value: number | null, basis: Estimated<number>['basis'], eraFallback = false): Estimated<number> => ({ value, basis, eraFallback });

describe('readout', () => {
  it('builds known and unknown readouts', () => {
    expect(knownReadout(5, { lowerBound: true })).toEqual({
      value: 5,
      unknownReason: null,
      lowerBound: true,
      assumed: false,
      eraFallback: false,
    });
    expect(unknownReadout('no data')).toEqual({
      value: null,
      unknownReason: 'no data',
      lowerBound: false,
      assumed: false,
      eraFallback: false,
    });
  });

  it('converts estimates, keeping unknown unknown', () => {
    expect(readoutFromEstimate(est(10, 'assumption', true), 'n/a')).toEqual({
      value: 10,
      unknownReason: null,
      lowerBound: false,
      assumed: true,
      eraFallback: true,
    });
    expect(readoutFromEstimate(est(10, 'source'), 'n/a').assumed).toBe(false);
    expect(readoutFromEstimate(est(null, 'unknown'), 'Quest XP unknown')).toEqual(unknownReadout('Quest XP unknown'));
  });
});

describe('theme', () => {
  it('cycles system, light, dark', () => {
    expect(nextThemePreference('system')).toBe('light');
    expect(nextThemePreference('light')).toBe('dark');
    expect(nextThemePreference('dark')).toBe('system');
  });

  it('validates stored values', () => {
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('sepia')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  it('sets or clears data-theme', () => {
    const attributes = new Map<string, string>();
    const root = {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    } as unknown as Element;
    applyThemePreference(root, 'dark');
    expect(attributes.get('data-theme')).toBe('dark');
    applyThemePreference(root, 'system');
    expect(attributes.has('data-theme')).toBe(false);
  });
});

describe('cx', () => {
  it('joins truthy class names', () => {
    expect(cx('a', false, null, undefined, 'b', '')).toBe('a b');
    expect(cx()).toBe('');
  });
});

describe('toAriaKeyShortcuts', () => {
  it('names modifiers and keys the way aria-keyshortcuts expects', () => {
    expect(toAriaKeyShortcuts('Ctrl+D')).toBe('Control+D');
    expect(toAriaKeyShortcuts('Delete')).toBe('Delete');
    expect(toAriaKeyShortcuts('L')).toBe('L');
    expect(toAriaKeyShortcuts('Alt+↑')).toBe('Alt+ArrowUp');
    expect(toAriaKeyShortcuts('Cmd+Shift+z')).toBe('Meta+Shift+Z');
    expect(toAriaKeyShortcuts('Esc')).toBe('Escape');
    expect(toAriaKeyShortcuts('Ctrl+/')).toBe('Control+/');
  });

  it('separates alternatives with a space', () => {
    expect(toAriaKeyShortcuts('Ctrl+Shift+Z or Ctrl+Y')).toBe('Control+Shift+Z Control+Y');
    expect(toAriaKeyShortcuts('Alt+↑ / Alt+↓')).toBe('Alt+ArrowUp Alt+ArrowDown');
    expect(toAriaKeyShortcuts('Del, Backspace')).toBe('Delete Backspace');
  });

  it('gives nothing for empty text', () => {
    expect(toAriaKeyShortcuts('')).toBe('');
    expect(toAriaKeyShortcuts('  ')).toBe('');
  });
});
