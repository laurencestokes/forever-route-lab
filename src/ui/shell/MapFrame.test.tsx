// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell, type ShellLayout } from './AppShell';
import { MapFrame, MapHoverText, type MapFrameProps } from './MapFrame';

afterEach(cleanup);

/*
 * The map's frame (docs/research/map-presentation.md §25.3.0, §25.3.1; step MP.4b): the stage takes
 * the region, the controls float on it (Map layers at the top left, Map focus at the top right, the
 * Map view toolbar at the bottom right, the caption at the bottom left), and the drawer docks or
 * lies over the stage's left edge.
 */

function frame(overrides: Partial<MapFrameProps> = {}) {
  const props: MapFrameProps = {
    drawer: { id: 'map-layers', open: false, docked: false, onToggle: vi.fn(), content: <p>Drawer content</p> },
    commands: [
      { id: 'zoom-in', label: 'Zoom in', icon: 'add', title: 'Zoom in', group: 'zoom', unavailable: null, onRun: vi.fn() },
      { id: 'zoom-out', label: 'Zoom out', icon: 'minus', title: 'Zoom out', group: 'zoom', unavailable: null, onRun: vi.fn() },
      { id: 'fit', label: 'Fit route', icon: 'fit', title: 'Show the route', group: 'view', unavailable: null, onRun: vi.fn() },
      { id: 'focus', label: 'Focus step', icon: 'target', title: 'Centre on the step', group: 'view', unavailable: 'Select a step first', onRun: vi.fn() },
    ],
    notice: 'Schematic map: zone frames, not terrain',
    engine: { kind: 'ready' },
    stageRef: createRef<HTMLDivElement>(),
    instructionsId: 'map-instructions',
    instructions: 'Drag to pan.',
    caption: ['Route: 4 of 7 steps on Kalimdor'],
    hover: null,
    ...overrides,
  };
  render(<MapFrame {...props} />);
  return props;
}

describe('MapFrame (map-presentation.md §25.3.0)', () => {
  it('floats the Map view toolbar: zoom, then fit and focus, runs available commands and keeps unavailable ones focusable, described and inert', () => {
    const props = frame();
    const toolbar = within(screen.getByRole('toolbar', { name: 'Map view' }));
    expect(toolbar.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Zoom in', 'Zoom out', 'Fit route', 'Focus step']);
    fireEvent.click(toolbar.getByRole('button', { name: 'Zoom in' }));
    expect(props.commands[0]?.onRun).toHaveBeenCalledTimes(1);
    fireEvent.click(toolbar.getByRole('button', { name: 'Fit route' }));
    expect(props.commands[2]?.onRun).toHaveBeenCalledTimes(1);
    const focus = toolbar.getByRole('button', { name: 'Focus step' });
    expect(focus.getAttribute('aria-disabled')).toBe('true');
    expect(focus.hasAttribute('disabled')).toBe(false);
    expect(document.getElementById(focus.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Select a step first');
    fireEvent.click(focus);
    expect(props.commands[3]?.onRun).not.toHaveBeenCalled();
    // No toolbar row and no status line any more: the map takes the region.
    expect(document.querySelector('.frl-mapframe__bar, .frl-mapframe__status')).toBeNull();
  });

  it('toggles the Map layers drawer as a disclosure, and places it by the region’s width', () => {
    const props = frame();
    const toggle = screen.getByRole('button', { name: 'Map layers' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.hasAttribute('aria-pressed')).toBe(false);
    expect(screen.queryByText('Drawer content')).toBeNull();
    fireEvent.click(toggle);
    expect(props.drawer.onToggle).toHaveBeenCalledTimes(1);
    cleanup();
    frame({ drawer: { id: 'map-layers', open: true, docked: true, onToggle: vi.fn(), content: <p>Drawer content</p> } });
    const open = screen.getByRole('button', { name: 'Map layers' });
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(open.classList.contains('is-pressed')).toBe(true);
    const drawer = document.getElementById(open.getAttribute('aria-controls') ?? '');
    expect(drawer?.textContent).toBe('Drawer content');
    // Docked: beside the stage, which follows it; the frame says so for the layout.
    expect(drawer?.nextElementSibling?.className).toBe('frl-mapframe__stage');
    expect(document.querySelector('.frl-mapframe')?.classList.contains('is-docked')).toBe(true);
    cleanup();
    frame({ drawer: { id: 'map-layers', open: true, docked: false, onToggle: vi.fn(), content: <p>Drawer content</p> } });
    expect(document.querySelector('.frl-mapframe')?.classList.contains('is-over')).toBe(true);
    // Keyboard order in the region: Map layers, the drawer, the map surface, the toolbar.
    const order = [...document.querySelectorAll('.frl-mapframe__layers-toggle, .frl-mapframe__drawer, .frl-mapframe__host, [role="toolbar"]')].map((el) => el.className.split(' ')[0]);
    expect(order).toEqual(['frl-icon-button', 'frl-mapframe__drawer', 'frl-mapframe__host', 'frl-toolbar']);
  });

  it('shows in the caption what kind of map this is, the route and the hover text, never as a live region', () => {
    frame({ hover: 'Gornek: starts 2 quests' });
    const caption = document.querySelector('.frl-mapframe__caption');
    expect(caption?.textContent).toContain('Schematic map: zone frames, not terrain');
    expect(caption?.textContent).toContain('Route: 4 of 7 steps on Kalimdor');
    expect(caption?.querySelector('[role="status"], [aria-live]')).toBeNull();
    expect(document.querySelector('.frl-mapframe__hover')?.textContent).toBe('Pointer on: Gornek: starts 2 quests');
    expect(document.getElementById('map-instructions')?.textContent).toBe('Drag to pan.');
    expect(document.querySelector('.frl-mapframe__notice-short')).toBeNull();
  });

  it('carries a short notice for a narrow map, and takes the hover line as an element that renders it', () => {
    frame({ noticeShort: 'Schematic', hover: <MapHoverText text="From a child" /> });
    const notice = document.querySelector('.frl-mapframe__notice');
    expect(notice?.classList.contains('has-short')).toBe(true);
    expect(notice?.getAttribute('title')).toBe('Schematic map: zone frames, not terrain');
    expect(notice?.querySelector('.frl-mapframe__notice-short')?.textContent).toBe('Schematic');
    expect(document.querySelector('.frl-mapframe__hover')?.textContent).toBe('Pointer on: From a child');
    cleanup();
    frame({ hover: null });
    expect(document.querySelector('.frl-mapframe__hover')).toBeNull();
  });

  it('claims the shell’s Map focus toggle into its top right, between the map surface and the toolbar', () => {
    function Shell() {
      const [layout, setLayout] = useState<ShellLayout>({ leftCollapsed: false, rightCollapsed: false, mapFocus: false });
      return (
        <AppShell
          top={null}
          left={<p>left</p>}
          centre={
            <MapFrame
              drawer={{ id: 'd', open: false, docked: false, onToggle: () => undefined, content: null }}
              commands={[{ id: 'zoom-in', label: 'Zoom in', icon: 'add', title: 'Zoom in', group: 'zoom', unavailable: null, onRun: () => undefined }]}
              notice="Map"
              engine={{ kind: 'ready' }}
              stageRef={createRef<HTMLDivElement>()}
              instructionsId="i"
              instructions=""
              caption={[]}
              hover={null}
            />
          }
          right={<p>right</p>}
          bottom={null}
          layout={layout}
          onLayoutChange={(patch) => {
            setLayout((was) => ({ ...was, ...patch }));
          }}
        />
      );
    }
    render(<Shell />);
    const toggles = screen.getAllByRole('button', { name: 'Map focus' });
    expect(toggles).toHaveLength(1);
    const toggle = toggles[0] as HTMLElement;
    expect(toggle.closest('.frl-mapframe__focus')).not.toBeNull();
    const order = [...document.querySelectorAll('.frl-mapframe__host, .frl-mapframe__focus button, [role="toolbar"]')];
    expect(order.indexOf(toggle)).toBe(1);
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Map focus' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('draws the map popover and the "Viewing" chip in the stage once the engine is ready (MP.6, MP.7)', () => {
    frame({ popover: <div role="dialog" aria-label="Quests at Gornek" />, viewing: <span>Viewing Durotar</span> });
    const stage = document.querySelector('.frl-mapframe__stage');
    expect(stage?.contains(screen.getByRole('dialog', { name: 'Quests at Gornek' }))).toBe(true);
    expect(document.querySelector('.frl-mapframe__viewing')?.textContent).toBe('Viewing Durotar');
    cleanup();
    frame({ engine: { kind: 'loading' }, popover: <div role="dialog" aria-label="Quests at Gornek" />, viewing: <span>Viewing Durotar</span> });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.frl-mapframe__viewing')).toBeNull();
  });

  it('shows the engine’s state over the stage: loading, failed with a retry, or not available', () => {
    frame({ engine: { kind: 'loading' } });
    expect(screen.getByRole('status').textContent).toBe('Loading the map…');
    expect(document.querySelector('.frl-mapframe__host')?.classList.contains('is-idle')).toBe(true);
    cleanup();
    const onRetry = vi.fn();
    frame({ engine: { kind: 'failed', message: 'chunk failed', onRetry } });
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    cleanup();
    frame({ engine: { kind: 'unavailable', message: 'No geometry.' } });
    expect(screen.getByText('No map here')).toBeTruthy();
    expect(screen.getByText('No geometry.')).toBeTruthy();
    cleanup();
    frame();
    expect(document.querySelector('.frl-mapframe__card')).toBeNull();
    expect(document.querySelector('.frl-mapframe__host')?.classList.contains('is-idle')).toBe(false);
  });
});
