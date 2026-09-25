// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Toolbar } from './Toolbar';

afterEach(cleanup);

const button = (name: string) => screen.getByRole('button', { name });

describe('Toolbar with unavailable items (F-03)', () => {
  it('keeps aria-disabled items in the roving tab stop and the arrow-key order', () => {
    render(
      <Toolbar label="Tools">
        <Button>One</Button>
        <Button aria-disabled>Unavailable</Button>
        <span data-toolbar-item aria-disabled="true" role="button" aria-label="Custom">
          c
        </span>
        <Button disabled>Native</Button>
        <Button>Two</Button>
      </Toolbar>,
    );
    button('One').focus();
    fireEvent.keyDown(button('One'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(button('Unavailable'));
    fireEvent.keyDown(button('Unavailable'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(button('Custom'));
    // Natively disabled buttons cannot take focus and are skipped.
    fireEvent.keyDown(button('Custom'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(button('Two'));
  });

  it('swallows clicks on unavailable items, so their handlers never run', () => {
    const onUnavailable = vi.fn();
    const onInner = vi.fn();
    const onAvailable = vi.fn();
    render(
      <Toolbar label="Tools">
        <Button aria-disabled onClick={onUnavailable}>
          <span onClick={onInner}>Unavailable</span>
        </Button>
        <Button onClick={onAvailable}>Available</Button>
      </Toolbar>,
    );
    fireEvent.click(button('Unavailable'));
    fireEvent.click(screen.getByText('Unavailable'));
    fireEvent.click(button('Available'));
    expect(onUnavailable).not.toHaveBeenCalled();
    expect(onInner).not.toHaveBeenCalled();
    expect(onAvailable).toHaveBeenCalledTimes(1);
  });

  it('keeps focus on an item that becomes unavailable when it is used', () => {
    function Last() {
      const [left, setLeft] = useState(1);
      return (
        <Toolbar label="Tools">
          <Button
            aria-disabled={left === 0 ? true : undefined}
            onClick={() => {
              setLeft((n) => n - 1);
            }}
          >
            Delete
          </Button>
          <Button>Other</Button>
        </Toolbar>
      );
    }
    render(<Last />);
    const remove = button('Delete');
    remove.focus();
    fireEvent.click(remove);
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(remove);
    expect(remove.tabIndex).toBe(0);
  });
});
