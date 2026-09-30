// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, buttonLook, type ButtonVariant } from './Button';
import { Checkbox } from './Checkbox';
import { EXTERNAL_LINK_TEXT, ExternalLink } from './ExternalLink';
import { Icon, type IconName } from './Icon';
import { IconButton } from './IconButton';
import { SearchField } from './SearchField';
import { SegmentedControl } from './SegmentedControl';

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
        <IconButton icon="up" label="Move up" shortcut="Alt+↑" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Delete selected steps' }).getAttribute('aria-keyshortcuts')).toBe('Delete');
    expect(screen.getByRole('button', { name: 'Lock or unlock selected steps' }).getAttribute('aria-keyshortcuts')).toBe('L');
    expect(screen.getByRole('button', { name: 'Move up' }).getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowUp');
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

  it('draws the tile look, with secondary as its alias (ui-refresh.md §7.1)', () => {
    render(
      <>
        <IconButton icon="add" label="Zoom in" variant="tile" />
        <IconButton icon="add" label="Old" variant="secondary" />
        <IconButton icon="add" label="Plain" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Zoom in' }).className).toContain('frl-icon-button--tile');
    expect(screen.getByRole('button', { name: 'Old' }).className).toContain('frl-icon-button--tile');
    expect(screen.getByRole('button', { name: 'Plain' }).className).toContain('frl-icon-button--ghost');
  });
});

describe('Button (ui-refresh.md §7.1)', () => {
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

  it('draws the default look by default, and secondary as an alias of it (review UR-07)', () => {
    render(
      <>
        <Button>Accept</Button>
        <Button variant="secondary">Show all</Button>
      </>,
    );
    const accept = screen.getByRole('button', { name: 'Accept' });
    const showAll = screen.getByRole('button', { name: 'Show all' });
    expect(accept.className).toContain('frl-button--default');
    expect(showAll.className).toBe(accept.className);
    expect(showAll.className).not.toContain('secondary');
    expect(buttonLook('secondary')).toBe('default');
  });

  it.each<[ButtonVariant, string]>([
    ['default', 'frl-button--default'],
    ['primary', 'frl-button--primary'],
    ['danger', 'frl-button--danger'],
    ['ghost', 'frl-button--ghost'],
    ['link', 'frl-button--link'],
  ])('%s draws with %s', (variant, className) => {
    render(<Button variant={variant}>Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' }).className).toContain(className);
  });

  it('is a toggle that keeps its name when pressed (Pick on map, Map focus)', () => {
    const { rerender } = render(<Button pressed={false}>Map focus</Button>);
    const button = screen.getByRole('button', { name: 'Map focus' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    rerender(<Button pressed>Map focus</Button>);
    expect(screen.getByRole('button', { name: 'Map focus', pressed: true })).toBe(button);
    // Without the prop a caller's own aria-pressed passes through; without either there is none.
    rerender(<Button aria-pressed>Map focus</Button>);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    rerender(<Button>Map focus</Button>);
    expect(button.hasAttribute('aria-pressed')).toBe(false);
  });

  it('keeps its name when expanded: the disclosure look is driven by aria-expanded', () => {
    render(
      <Button variant="ghost" aria-expanded aria-controls="view-panel">
        View
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'View', expanded: true });
    expect(button.getAttribute('aria-controls')).toBe('view-panel');
    expect(button.hasAttribute('aria-pressed')).toBe(false);
  });

  it('draws a leading icon without adding to the name', () => {
    render(
      <Button variant="danger" icon="delete">
        Delete route
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Delete route' });
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('ExternalLink (D-041 J)', () => {
  it('opens in a new tab with no opener and no referrer, and says so in its name', () => {
    render(<ExternalLink href="https://www.wowhead.com/classic/quest=788">Open on Wowhead</ExternalLink>);
    const link = screen.getByRole('link', { name: `Open on Wowhead ${EXTERNAL_LINK_TEXT}` });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('referrerpolicy')).toBe('no-referrer');
    // The words are visually hidden; the external glyph shows it.
    expect(link.querySelector('.frl-visually-hidden')?.textContent).toBe(' (opens in a new tab)');
    expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('Checkbox', () => {
  it('draws a mixed group state with a dash, and a press checks it', () => {
    const onChange = vi.fn<(checked: boolean) => void>();
    const { rerender } = render(<Checkbox label="Quests" checked="mixed" onChange={onChange} />);
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Quests' });
    expect(box.indeterminate).toBe(true);
    expect(box.getAttribute('aria-checked')).toBe('mixed');
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
    // Kept mixed by its owner, the box is drawn mixed again.
    rerender(<Checkbox label="Quests" checked="mixed" onChange={onChange} />);
    expect(box.indeterminate).toBe(true);
    rerender(<Checkbox label="Quests" checked onChange={onChange} />);
    expect(box.indeterminate).toBe(false);
    expect(box.hasAttribute('aria-checked')).toBe(false);
    expect(box.checked).toBe(true);
  });
});

function Segmented({ onChange }: { readonly onChange: (value: 'minimap' | 'painted') => void }) {
  const [value, setValue] = useState<'minimap' | 'painted'>('minimap');
  return (
    <SegmentedControl
      legend="Map style"
      value={value}
      options={[
        { value: 'minimap', label: 'Minimap' },
        { value: 'painted', label: 'Painted' },
      ]}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('SegmentedControl', () => {
  it('is a group of native radios named by its legend, with the checked option marked', () => {
    const onChange = vi.fn<(value: 'minimap' | 'painted') => void>();
    render(<Segmented onChange={onChange} />);
    const group = screen.getByRole('group', { name: 'Map style' });
    const radios = within(group).getAllByRole<HTMLInputElement>('radio');
    expect(radios.map((radio) => radio.checked)).toEqual([true, false]);
    // One name, so the browser gives one tab stop and the arrow keys.
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
    expect(within(group).getByRole('radio', { name: 'Minimap' }).closest('label')?.className).toContain('is-checked');
    fireEvent.click(within(group).getByRole('radio', { name: 'Painted' }));
    expect(onChange).toHaveBeenCalledWith('painted');
    expect(within(group).getByRole('radio', { name: 'Painted' }).closest('label')?.className).toContain('is-checked');
    expect(within(group).getByRole('radio', { name: 'Minimap' }).closest('label')?.className).not.toContain('is-checked');
  });

  it('disables an option that cannot be chosen, with the reason as its tooltip', () => {
    render(
      <SegmentedControl
        legend="Map style"
        value="painted"
        options={[
          { value: 'minimap', label: 'Minimap', unavailable: 'The minimap tiles are not installed' },
          { value: 'painted', label: 'Painted' },
        ]}
        onChange={() => undefined}
      />,
    );
    const minimap = screen.getByRole<HTMLInputElement>('radio', { name: 'Minimap' });
    expect(minimap.disabled).toBe(true);
    expect(minimap.closest('label')?.getAttribute('title')).toBe('The minimap tiles are not installed');
  });
});

function Search({ onDown }: { readonly onDown?: () => void }) {
  const [value, setValue] = useState('');
  return (
    <div
      data-testid="drawer"
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.currentTarget.dataset.closed = 'yes';
      }}
    >
      <SearchField label="Search the map" placeholder="Search quests, places, NPCs" value={value} onChange={setValue} onArrowDown={onDown} />
    </div>
  );
}

describe('SearchField (map-presentation.md §25.3.5)', () => {
  it('is a named searchbox with a clear button while there is text', () => {
    render(<Search />);
    const field = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search the map' });
    expect(field.placeholder).toBe('Search quests, places, NPCs');
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    fireEvent.change(field, { target: { value: 'kolkar' } });
    const clear = screen.getByRole('button', { name: 'Clear search' });
    fireEvent.click(clear);
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });

  it('clears on the first Escape and lets the next one through to the drawer', () => {
    render(<Search />);
    const field = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search the map' });
    fireEvent.change(field, { target: { value: 'kolkar' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field.value).toBe('');
    expect(screen.getByTestId('drawer').dataset.closed).toBeUndefined();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.getByTestId('drawer').dataset.closed).toBe('yes');
  });

  it('moves to the first result on Down', () => {
    const onDown = vi.fn();
    render(<Search onDown={onDown} />);
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search the map' }), { key: 'ArrowDown' });
    expect(onDown).toHaveBeenCalledTimes(1);
  });
});

describe('Icon', () => {
  it.each<IconName>(['undo', 'redo', 'up', 'down', 'left', 'right', 'external', 'layers', 'map-focus'])('draws the refresh icon %s in currentColor', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.children.length).toBeGreaterThan(0);
  });
});
