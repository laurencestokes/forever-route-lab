// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from './Button';
import { IconButton } from './IconButton';

afterEach(cleanup);

describe('IconButton', () => {
  it('is named by its label and exposes its shortcut as aria-keyshortcuts', () => {
    render(<IconButton icon="duplicate" label="Duplicate selected steps" shortcut="Ctrl+D" />);
    const button = screen.getByRole('button', { name: 'Duplicate selected steps' });
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Control+D');
    // The native title stays the pointer tooltip, with the shortcut as people read it.
    expect(button.getAttribute('title')).toBe('Duplicate selected steps (Ctrl+D)');
    expect(button.getAttribute('type')).toBe('button');
  });

  it('converts every shortcut form the app uses', () => {
    render(
      <>
        <IconButton icon="delete" label="Delete selected steps" shortcut="Delete" />
        <IconButton icon="lock" label="Lock or unlock selected steps" shortcut="L" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Delete selected steps' }).getAttribute('aria-keyshortcuts')).toBe('Delete');
    expect(screen.getByRole('button', { name: 'Lock or unlock selected steps' }).getAttribute('aria-keyshortcuts')).toBe('L');
  });

  it('has no aria-keyshortcuts without a shortcut, and a plain tooltip', () => {
    render(<IconButton icon="close" label="Dismiss" />);
    const button = screen.getByRole('button', { name: 'Dismiss' });
    expect(button.hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(button.getAttribute('title')).toBe('Dismiss');
  });

  it('is a toggle when pressed is set', () => {
    render(<IconButton icon="lock" label="Lock step" pressed />);
    const button = screen.getByRole('button', { name: 'Lock step' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.className).toContain('is-pressed');
  });
});

describe('Button', () => {
  it('never submits by accident and keeps its variant class when disabled', () => {
    render(
      <Button variant="ghost" disabled>
        Undo
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Undo' });
    expect(button.getAttribute('type')).toBe('button');
    // primitives.css keeps a disabled ghost button edgeless (tests/ui-tokens.test.ts checks the rule).
    expect(button.className).toContain('frl-button--ghost');
  });
});
