// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThemePreference } from '../lib/theme';
import { Button } from '../primitives/Button';
import { Toolbar } from '../primitives/Toolbar';
import { AboutDialog, DATA_LICENCE_CARVE_OUT } from './AboutDialog';
import { AppShell, clampLeftWidth } from './AppShell';
import { MapPlaceholder } from './MapPlaceholder';
import { TopBar, type TopBarProps } from './TopBar';

afterEach(cleanup);

describe('AppShell', () => {
  it('lays out the five areas as landmarks', () => {
    render(<AppShell top={<header>top</header>} left={<p>left</p>} centre={<p>centre</p>} right={<p>right</p>} bottom={<p>bottom</p>} />);
    expect(screen.getByRole('main', { name: 'Route editor' }).textContent).toBe('left');
    expect(screen.getByRole('region', { name: 'Map' }).textContent).toBe('centre');
    expect(screen.getByRole('complementary', { name: 'Quests and details' }).textContent).toBe('right');
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('clamps the route panel width to 320-380px', () => {
    expect(clampLeftWidth(100)).toBe(320);
    expect(clampLeftWidth(355.4)).toBe(355);
    expect(clampLeftWidth(999)).toBe(380);
    expect(clampLeftWidth(Number.NaN)).toBe(340);
    const { container } = render(<AppShell top={null} left={null} centre={null} right={null} bottom={null} leftWidth={500} />);
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--frl-left-width')).toBe('380px');
  });

  it('resizes the route panel from the keyboard', () => {
    function Resizable() {
      const [width, setWidth] = useState(340);
      return <AppShell top={null} left={null} centre={null} right={null} bottom={null} leftWidth={width} onLeftWidthChange={setWidth} />;
    }
    render(<Resizable />);
    const splitter = screen.getByRole('separator', { name: 'Resize route panel' });
    expect(splitter.getAttribute('aria-valuenow')).toBe('340');
    fireEvent.keyDown(splitter, { key: 'ArrowRight' });
    expect(splitter.getAttribute('aria-valuenow')).toBe('344');
    fireEvent.keyDown(splitter, { key: 'ArrowLeft', shiftKey: true });
    expect(splitter.getAttribute('aria-valuenow')).toBe('324');
    fireEvent.keyDown(splitter, { key: 'End' });
    expect(splitter.getAttribute('aria-valuenow')).toBe('380');
    fireEvent.keyDown(splitter, { key: 'Home' });
    expect(splitter.getAttribute('aria-valuenow')).toBe('320');
  });
});

describe('TopBar', () => {
  function Bar(overrides: Partial<TopBarProps>) {
    const [theme, setTheme] = useState<ThemePreference>('system');
    return (
      <TopBar
        projectName="Placeholder project"
        routeName="Placeholder route"
        placeholder
        search={{ value: '', onChange: vi.fn() }}
        zones={{ value: '', options: [{ value: 'z1', label: 'Placeholder zone' }], onJump: vi.fn() }}
        onImport={vi.fn()}
        onExport={vi.fn()}
        onSettings={vi.fn()}
        onAbout={vi.fn()}
        theme={theme}
        onThemeChange={setTheme}
        {...overrides}
      />
    );
  }

  it('shows the product, the project with its Placeholder label, and the controls', () => {
    render(<Bar />);
    const banner = screen.getByRole('banner');
    expect(banner.textContent).toContain('Forever Route Lab');
    expect(banner.textContent).toContain('Placeholder project');
    expect(within(banner).getByTitle('Placeholder project')).toBeDefined();
    expect(screen.getByRole('searchbox', { name: 'Search quests' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Jump to zone' })).toBeDefined();
    const toolbar = screen.getByRole('toolbar', { name: 'Project actions' });
    expect(within(toolbar).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Import',
      'Export',
      'Settings',
      'System theme. Switch to light theme',
      'About Forever Route Lab',
    ]);
  });

  it('cycles the theme preference', () => {
    render(<Bar />);
    fireEvent.click(screen.getByRole('button', { name: /^System theme/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Light theme/ }));
    expect(screen.getByRole('button', { name: 'Dark theme. Switch to system theme' })).toBeDefined();
  });

  it('calls the action callbacks', () => {
    const onImport = vi.fn();
    const onAbout = vi.fn();
    render(<Bar onImport={onImport} onAbout={onAbout} />);
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    fireEvent.click(screen.getByRole('button', { name: 'About Forever Route Lab' }));
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onAbout).toHaveBeenCalledTimes(1);
  });
});

describe('Toolbar', () => {
  it('has one tab stop and moves with the arrow keys', () => {
    render(
      <Toolbar label="Tools">
        <Button>One</Button>
        <Button disabled>Skipped</Button>
        <Button>Two</Button>
        <Button>Three</Button>
      </Toolbar>,
    );
    const button = (name: string) => screen.getByRole('button', { name });
    expect([button('One').tabIndex, button('Two').tabIndex, button('Three').tabIndex]).toEqual([0, -1, -1]);
    button('One').focus();
    fireEvent.keyDown(button('One'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(button('Two'));
    expect([button('One').tabIndex, button('Two').tabIndex]).toEqual([-1, 0]);
    fireEvent.keyDown(button('Two'), { key: 'End' });
    expect(document.activeElement).toBe(button('Three'));
    fireEvent.keyDown(button('Three'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(button('One'));
  });
});

describe('MapPlaceholder', () => {
  it('says the map arrives in Milestone 3, is labelled Placeholder, and stubs the layers', () => {
    render(<MapPlaceholder focus={{ title: 'Placeholder step 3', location: null }} />);
    expect(screen.getByRole('heading', { name: 'The map arrives in Milestone 3' })).toBeDefined();
    expect(screen.getByText('Placeholder')).toBeDefined();
    const layers = screen.getByRole('group', { name: 'Layers' });
    const boxes = within(layers).getAllByRole('checkbox');
    expect(boxes).toHaveLength(5);
    expect(boxes.every((box) => (box as HTMLInputElement).disabled || layers.hasAttribute('disabled'))).toBe(true);
    expect(screen.getByText('Placeholder step 3')).toBeDefined();
  });
});

describe('AboutDialog', () => {
  const props = { onClose: vi.fn(), version: '0.1.0', dataUpstreamCommit: 'b6f5b07b0acf1c820993cbb0ce2521c912bb4c92' };

  it('renders nothing while closed', () => {
    const { container } = render(<AboutDialog {...props} open={false} sourceCommit={null} />);
    expect(container.querySelector('dialog')?.textContent).toBe('');
  });

  it('states the licence, warranty, data notice and non-affiliation', () => {
    render(<AboutDialog {...props} open sourceCommit={null} />);
    const dialog = screen.getByRole('dialog', { name: 'About Forever Route Lab' });
    const text = dialog.textContent;
    expect(text).toContain('GPL-3.0-or-later');
    expect(text).toContain('WITHOUT ANY WARRANTY');
    expect(text).toContain(DATA_LICENCE_CARVE_OUT);
    expect(text).toContain('Neither Questie nor QuestieDB has published a licence file');
    expect(text).toContain('pinned commit b6f5b07b0acf');
    expect(text).toContain('not affiliated with or endorsed by Blizzard Entertainment, the Questie project or RestedXP');
    expect(text).toContain('Not recorded in this build');
  });

  it('links the exact source commit when the build provides it', () => {
    render(<AboutDialog {...props} open sourceCommit="0123456789abcdef0123456789abcdef01234567" />);
    const link = screen.getByRole('link', { name: '0123456789ab' });
    expect(link.getAttribute('href')).toBe(
      'https://github.com/laurencestokes/forever-route-lab/commit/0123456789abcdef0123456789abcdef01234567',
    );
  });

  it('closes from its buttons', () => {
    const onClose = vi.fn();
    render(<AboutDialog {...props} onClose={onClose} open sourceCommit={null} />);
    for (const button of screen.getAllByRole('button', { name: 'Close' })) fireEvent.click(button);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
