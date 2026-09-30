// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopBar, type TopBarProps } from './TopBar';

afterEach(cleanup);

const ZONES = [
  { value: 'z1', label: 'Placeholder Vale' },
  { value: 'z2', label: 'Placeholder Ridge' },
];

function renderBar(overrides: Partial<TopBarProps> = {}) {
  const props: TopBarProps = {
    character: { name: 'Orc Warrior', faction: 'Horde' },
    search: { value: '', onChange: vi.fn() },
    zones: { value: '', options: ZONES, onJump: vi.fn() },
    onImport: vi.fn(),
    onExport: vi.fn(),
    onSettings: vi.fn(),
    onAbout: vi.fn(),
    theme: 'system',
    onThemeChange: vi.fn(),
    ...overrides,
  };
  const view = render(<TopBar {...props} />);
  return { ...view, props };
}

const zoneSelect = () => screen.getByRole('combobox', { name: 'Go to zone or view' });
const go = () => screen.getByRole('button', { name: 'Go to the chosen zone or view' });
const describedBy = (element: HTMLElement) => document.getElementById(element.getAttribute('aria-describedby') ?? '')?.textContent;

describe('TopBar', () => {
  it('makes the product name the page heading (h1)', () => {
    renderBar();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('Forever Route Lab');
    expect(within(screen.getByRole('banner')).getByRole('heading', { level: 1 })).toBe(heading);
  });

  it('renders unavailable actions aria-disabled, focusable and described, and never calls them', () => {
    const onImport = vi.fn();
    const onSettings = vi.fn();
    renderBar({ onImport, onSettings, unavailable: { import: 'Arrives in Milestone 4', settings: 'Arrives in Milestone 6', export: null } });
    const toolbar = within(screen.getByRole('toolbar', { name: 'Project actions' }));
    const importButton = toolbar.getByRole('button', { name: 'Import' });
    expect(importButton.getAttribute('aria-disabled')).toBe('true');
    expect(importButton.hasAttribute('disabled')).toBe(false);
    expect(describedBy(importButton)).toBe('Arrives in Milestone 4');
    expect(importButton.getAttribute('title')).toBe('Import a project or RXP guide: Arrives in Milestone 4');
    fireEvent.click(importButton);
    fireEvent.click(toolbar.getByRole('button', { name: 'Orc Warrior · Horde, settings' }));
    expect(onImport).not.toHaveBeenCalled();
    expect(onSettings).not.toHaveBeenCalled();
    // Export has no reason: available as usual.
    const exportButton = toolbar.getByRole('button', { name: 'Export' });
    expect(exportButton.hasAttribute('aria-disabled')).toBe(false);
    expect(exportButton.hasAttribute('aria-describedby')).toBe(false);
    // Unavailable items keep their place in the toolbar's arrow-key order.
    const settings = toolbar.getByRole('button', { name: 'Orc Warrior · Horde, settings' });
    expect(settings.getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(settings)).toBe('Arrives in Milestone 6');
    importButton.focus();
    fireEvent.keyDown(importButton, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(exportButton);
  });

  it('keeps the button names free of the reasons', () => {
    renderBar({ unavailable: { import: 'Arrives in Milestone 4', export: 'Arrives in Milestone 4', settings: 'Arrives in Milestone 6' } });
    const toolbar = screen.getByRole('toolbar', { name: 'Project actions' });
    expect(within(toolbar).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Orc Warrior · Horde, settings',
      'Import',
      'Export',
      'System theme. Switch to light theme',
      'About Forever Route Lab',
    ]);
  });

  it('opens Settings from the character button, whose name starts with its visible words (D-048 D; WCAG 2.5.3)', () => {
    const onSettings = vi.fn();
    renderBar({ onSettings });
    const button = screen.getByRole('button', { name: 'Orc Warrior · Horde, settings' });
    expect(button.querySelector('.frl-topbar__character-name')?.textContent).toBe('Orc Warrior');
    expect(button.querySelector('.frl-topbar__character-faction')?.textContent).toBe(' · Horde');
    fireEvent.click(button);
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it('no longer shows the project and route crumb: the route panel names the route (ui-refresh.md §8)', () => {
    renderBar();
    expect(screen.getByRole('banner').querySelector('.frl-topbar__project')).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Search quests' })).toBeDefined();
  });

  it('does not jump while the zone choice changes, only on Go or Enter (F-08)', () => {
    const onJump = vi.fn();
    renderBar({ zones: { value: '', options: ZONES, onJump } });
    const select = zoneSelect() as HTMLSelectElement;
    // Arrowing through a closed select fires change in Chromium on Windows: it must not jump,
    // and the choice must stay put rather than snap back to the placeholder.
    fireEvent.change(select, { target: { value: 'z1' } });
    fireEvent.change(select, { target: { value: 'z2' } });
    expect(onJump).not.toHaveBeenCalled();
    expect(select.value).toBe('z2');
    fireEvent.keyDown(select, { key: 'Enter' });
    expect(onJump).toHaveBeenLastCalledWith('z2');
    fireEvent.change(select, { target: { value: 'z1' } });
    fireEvent.click(go());
    expect(onJump).toHaveBeenLastCalledWith('z1');
    expect(onJump).toHaveBeenCalledTimes(2);
  });

  it('does nothing on Go before a zone is chosen', () => {
    const onJump = vi.fn();
    renderBar({ zones: { value: '', options: ZONES, onJump } });
    fireEvent.click(go());
    expect(onJump).not.toHaveBeenCalled();
  });

  it('starts again from the zone the caller shows when it changes', () => {
    const zones = { options: ZONES, onJump: vi.fn() };
    const { rerender, props } = renderBar({ zones: { ...zones, value: 'z1' } });
    const select = zoneSelect() as HTMLSelectElement;
    expect(select.value).toBe('z1');
    fireEvent.change(select, { target: { value: 'z2' } });
    rerender(<TopBar {...props} zones={{ ...zones, value: 'z1' }} />);
    expect(select.value).toBe('z2');
    rerender(<TopBar {...props} zones={{ ...zones, value: '' }} />);
    expect(select.value).toBe('');
  });

  it('keeps Go focusable and inert while jumping is unavailable, saying why', () => {
    const onJump = vi.fn();
    renderBar({ zones: { value: '', options: ZONES, onJump, unavailableReason: 'Arrives with the map in Milestone 3' } });
    fireEvent.change(zoneSelect(), { target: { value: 'z1' } });
    const button = go();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(describedBy(button)).toBe('Arrives with the map in Milestone 3');
    fireEvent.click(button);
    fireEvent.keyDown(zoneSelect(), { key: 'Enter' });
    expect(onJump).not.toHaveBeenCalled();
  });

});
