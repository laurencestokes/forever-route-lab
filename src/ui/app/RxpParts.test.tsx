// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RxpDiagnostic } from '../../rxp';
import { RxpDiagnosticList, type RxpSourceText } from './RxpParts';

afterEach(cleanup);

const SOURCE: RxpSourceText = { name: 'the pasted text', lines: Array.from({ length: 160 }, (_, i) => `step ${String(i + 1)}`) };

function diagnostics(count: number): RxpDiagnostic[] {
  return Array.from({ length: count }, (_, i) => ({
    code: 'RXP001-unknown-command',
    severity: 'warning',
    importId: 'import-1',
    line: i + 1,
    column: 1,
    rxpCompat: true,
    message: `Warning ${String(i + 1)}`,
  }));
}

describe('RxpDiagnosticList', () => {
  it('moves focus to the first added item when the last "Show more" removes itself (UI-F1)', () => {
    render(<RxpDiagnosticList diagnostics={diagnostics(150)} sourceOf={() => SOURCE} emptyText="None." />);
    const list = screen.getByRole('list', { name: 'Diagnostics' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(100);
    const more = screen.getByRole('button', { name: 'Show 50 more' });
    more.focus();
    fireEvent.click(more);
    expect(screen.queryByRole('button', { name: /^Show \d+ more$/ })).toBeNull();
    expect(within(list).getAllByRole('listitem')).toHaveLength(150);
    const first = within(list).getAllByRole('listitem')[100];
    expect(first?.textContent).toContain('Warning 101');
    expect(document.activeElement).toBe(first?.querySelector('button'));
  });

  it('keeps focus on "Show more" while more pages remain', () => {
    render(<RxpDiagnosticList diagnostics={diagnostics(250)} sourceOf={() => SOURCE} emptyText="None." />);
    const more = screen.getByRole('button', { name: 'Show 100 more' });
    more.focus();
    fireEvent.click(more);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show 50 more' }));
  });
});
