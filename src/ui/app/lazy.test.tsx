// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LazyDialogFallback, useLazy } from './lazy';

afterEach(cleanup);

function Harness({ load, wanted }: { readonly load: () => Promise<string>; readonly wanted: boolean }) {
  const state = useLazy(load, wanted);
  return (
    <>
      <p data-testid="state">{state.kind === 'ready' ? `ready: ${state.value}` : state.kind}</p>
      <LazyDialogFallback title="Settings" state={state} onClose={() => undefined} />
    </>
  );
}

describe('useLazy and LazyDialogFallback', () => {
  it('loads only when wanted, says so while loading, and offers Try again after a failure', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue('module');
    const { rerender } = render(<Harness load={load} wanted={false} />);
    expect(screen.getByTestId('state').textContent).toBe('idle');
    expect(load).not.toHaveBeenCalled();
    rerender(<Harness load={load} wanted />);
    expect(screen.getByRole('dialog', { name: 'Settings' }).textContent).toContain('Loading…');
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('dialog', { name: 'Settings' }).textContent).toContain('Settings could not be loaded (network down). Check the connection and try again.');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await Promise.resolve();
    });
    expect(screen.getByTestId('state').textContent).toBe('ready: module');
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
    // Kept once loaded, whether wanted or not.
    rerender(<Harness load={load} wanted={false} />);
    expect(screen.getByTestId('state').textContent).toBe('ready: module');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
