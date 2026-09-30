// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThemePreference } from '../lib/theme';
import { Button } from '../primitives/Button';
import { Toolbar } from '../primitives/Toolbar';
import { AboutDialog, DATA_LICENCE_CARVE_OUT } from './AboutDialog';
import { AppShell, clampLeftWidth, clampRightWidth, type ShellLayout } from './AppShell';
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

  it('clamps both side panels to 300-460px (ui-refresh.md §4.1, §4.2)', () => {
    expect(clampLeftWidth(100)).toBe(300);
    expect(clampLeftWidth(355.4)).toBe(355);
    expect(clampLeftWidth(999)).toBe(460);
    expect(clampLeftWidth(Number.NaN)).toBe(340);
    expect(clampRightWidth(100)).toBe(300);
    expect(clampRightWidth(999)).toBe(460);
    const { container } = render(<AppShell top={null} left={null} centre={null} right={null} bottom={null} leftWidth={500} rightWidth={250} />);
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--frl-left-width')).toBe('460px');
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--frl-right-width')).toBe('300px');
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
    expect(splitter.getAttribute('aria-valuenow')).toBe('460');
    fireEvent.keyDown(splitter, { key: 'Home' });
    expect(splitter.getAttribute('aria-valuenow')).toBe('300');
  });

  it('resizes the side panel from its own separator, where the arrows move the splitter (the left arrow widens it)', () => {
    function Resizable() {
      const [width, setWidth] = useState(340);
      return <AppShell top={null} left={null} centre={null} right={null} bottom={null} rightWidth={width} onRightWidthChange={setWidth} />;
    }
    render(<Resizable />);
    const splitter = screen.getByRole('separator', { name: 'Resize quests and details panel' });
    fireEvent.keyDown(splitter, { key: 'ArrowLeft' });
    expect(splitter.getAttribute('aria-valuenow')).toBe('344');
    fireEvent.keyDown(splitter, { key: 'ArrowRight', shiftKey: true });
    expect(splitter.getAttribute('aria-valuenow')).toBe('324');
    fireEvent.keyDown(splitter, { key: 'End' });
    expect(splitter.getAttribute('aria-valuenow')).toBe('460');
  });
});

describe('TopBar', () => {
  function Bar(overrides: Partial<TopBarProps>) {
    const [theme, setTheme] = useState<ThemePreference>('system');
    return (
      <TopBar
        character={{ name: 'Orc Warrior', faction: 'Horde' }}
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

  it('shows the product, the search, "Go to zone or view", the character button and the controls', () => {
    render(<Bar />);
    const banner = screen.getByRole('banner');
    expect(banner.textContent).toContain('Forever Route Lab');
    expect(screen.getByRole('searchbox', { name: 'Search quests' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Go to zone or view' })).toBeDefined();
    const toolbar = screen.getByRole('toolbar', { name: 'Project actions' });
    expect(within(toolbar).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Orc Warrior · Horde, settings',
      'Import',
      'Export',
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
    expect(text).toContain("Neither Questie nor QuestieDB has a root licence file (none covering Questie's own code or data");
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

describe('AppShell collapse and map focus (ui-refresh.md §4.3, §9.2)', () => {
  function Collapsible({ initial = { leftCollapsed: false, rightCollapsed: false, mapFocus: false } }: { readonly initial?: ShellLayout }) {
    const [layout, setLayout] = useState<ShellLayout>(initial);
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setLayout((was) => ({ ...was, mapFocus: !was.mapFocus }));
          }}
        >
          Outside toggle
        </button>
        <AppShell
          top={<header>top</header>}
          left={
            <div role="listbox" aria-label="Route" tabIndex={0}>
              list
            </div>
          }
          centre={<p>map</p>}
          right={
            <div role="tablist" aria-label="Side">
              <button type="button" role="tab" aria-selected="true">
                Available
              </button>
            </div>
          }
          bottom={<p>bottom</p>}
          leftWidth={340}
          onLeftWidthChange={() => undefined}
          rightWidth={340}
          onRightWidthChange={() => undefined}
          layout={layout}
          onLayoutChange={(patch) => {
            setLayout((was) => ({ ...was, ...patch }));
          }}
        />
      </>
    );
  }
  const main = () => screen.getByRole('main', { hidden: true });
  const aside = () => screen.getByRole('complementary', { hidden: true });

  it('hides a panel from its handle, moves focus to the handle that shows it again, and restores it into the panel', () => {
    render(<Collapsible />);
    const hide = screen.getByRole('button', { name: 'Hide the route panel' });
    hide.focus();
    fireEvent.click(hide);
    expect(main().hidden).toBe(true);
    const show = screen.getByRole('button', { name: 'Show the route panel' });
    expect(document.activeElement).toBe(show);
    fireEvent.click(show);
    expect(main().hidden).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('listbox', { name: 'Route' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide the quests and details panel' }));
    expect(aside().hidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show the quests and details panel' }));
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Available' }));
  });

  it('puts each handle in the hidden panel’s place in the tab order', () => {
    render(<Collapsible initial={{ leftCollapsed: true, rightCollapsed: true, mapFocus: false }} />);
    const order = [...document.querySelectorAll('main, .frl-shell__handle, section, aside')].map((el) => el.getAttribute('aria-label') ?? el.tagName);
    expect(order).toEqual(['Route editor', 'Show the route panel', 'Map', 'Show the quests and details panel', 'Quests and details']);
  });

  it('collapses a panel with Enter on its separator (the window splitter pattern)', () => {
    render(<Collapsible />);
    const separator = screen.getByRole('separator', { name: 'Resize route panel' });
    expect(separator.getAttribute('aria-keyshortcuts')).toBe('Enter');
    separator.focus();
    fireEvent.keyDown(separator, { key: 'Enter' });
    expect(main().hidden).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show the route panel' }));
  });

  it('hides both panels in map focus, keeps focus on its pressed toggle, and restores them as they were', () => {
    render(<Collapsible initial={{ leftCollapsed: false, rightCollapsed: true, mapFocus: false }} />);
    const toggle = screen.getByRole('button', { name: 'Map focus' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.getAttribute('aria-keyshortcuts')).toBe('Alt+M');
    expect(toggle.closest('[aria-label="Map"]')).not.toBeNull();
    fireEvent.click(toggle);
    expect(main().hidden).toBe(true);
    expect(aside().hidden).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    expect(main().hidden).toBe(false);
    expect(aside().hidden).toBe(true);
  });

  it('moves focus out of a panel that map focus hides (Alt+M from inside it) to the Map focus toggle', () => {
    render(<Collapsible />);
    const list = screen.getByRole('listbox', { name: 'Route' });
    list.focus();
    // Alt+M changes the shell's state from outside its controls (a click here does not move focus).
    fireEvent.click(screen.getByRole('button', { name: 'Outside toggle' }));
    expect(main().hidden).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Map focus' }));
  });

  it('shows a hidden panel from map focus alone, ending map focus', () => {
    render(<Collapsible initial={{ leftCollapsed: false, rightCollapsed: false, mapFocus: true }} />);
    expect(main().hidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show the route panel' }));
    expect(main().hidden).toBe(false);
    expect(aside().hidden).toBe(true);
    expect(screen.getByRole('button', { name: 'Map focus' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('draws no handles and no Map focus without a layout handler', () => {
    render(<AppShell top={null} left={null} centre={null} right={null} bottom={null} />);
    expect(screen.queryByRole('button', { name: /route panel/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Map focus' })).toBeNull();
  });
});
