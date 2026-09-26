// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LayerPanel, MAP_CHOICE_WIDTH, MapFrame, MapHoverText, mapChoicePosition, type MapFrameProps, type MapLayerRow } from './MapFrame';
import { MAP_GRID_NOTE, MAP_KEY } from './MapLegend';

afterEach(cleanup);

const ROWS: readonly MapLayerRow[] = [
  { id: 'route-steps', label: 'Step markers', visible: true, unavailable: null, count: '12 drawn', notes: ['3 on other world maps'] },
  { id: 'objectives', label: 'Objectives', visible: false, unavailable: null, count: null, notes: [] },
  { id: 'art', label: 'Map art (local set)', visible: true, unavailable: 'No local map set', count: null, notes: [] },
];

function frame(overrides: Partial<MapFrameProps> = {}) {
  const props: MapFrameProps = {
    surface: { value: 'world:1', options: [{ value: 'world:0', label: 'Eastern Kingdoms' }, { value: 'world:1', label: 'Kalimdor' }], onChange: vi.fn() },
    commands: [
      { id: 'fit', label: 'Fit route', title: 'Show the route', unavailable: null, onRun: vi.fn() },
      { id: 'focus', label: 'Focus step', title: 'Centre on the step', unavailable: 'Select a step first', onRun: vi.fn() },
    ],
    layersOpen: false,
    onLayersOpenChange: vi.fn(),
    layers: { layers: ROWS, onToggle: vi.fn(), footer: ['Geometry loaded: placeholder.'] },
    notice: 'Schematic map: zone frames, not terrain',
    engine: { kind: 'ready' },
    stageRef: createRef<HTMLDivElement>(),
    instructionsId: 'map-instructions',
    instructions: 'Drag to pan.',
    status: ['Route: 4 of 7 steps on Kalimdor'],
    hover: null,
    ...overrides,
  };
  render(<MapFrame {...props} />);
  return props;
}

describe('LayerPanel', () => {
  it('lists each layer with its count and notes; an unavailable layer is disabled and says why', () => {
    const onToggle = vi.fn();
    render(<LayerPanel layers={ROWS} onToggle={onToggle} footer={['Geometry loaded: placeholder.']} />);
    const group = within(screen.getByRole('group', { name: 'Layers' }));
    const steps = group.getByRole('checkbox', { name: /Step markers/ });
    expect(steps).toHaveProperty('checked', true);
    expect(document.getElementById(steps.getAttribute('aria-describedby') ?? '')?.textContent).toBe('3 on other world maps');
    expect(steps.closest('li')?.textContent).toContain('12 drawn');
    const objectives = group.getByRole('checkbox', { name: 'Objectives' });
    expect(objectives).toHaveProperty('checked', false);
    expect(objectives.hasAttribute('aria-describedby')).toBe(false);
    fireEvent.click(objectives);
    expect(onToggle).toHaveBeenCalledWith('objectives', true);
    const art = group.getByRole('checkbox', { name: /Map art/ });
    expect(art).toHaveProperty('disabled', true);
    // Unavailable is never shown as checked, whatever the stored visibility.
    expect(art).toHaveProperty('checked', false);
    expect(document.getElementById(art.getAttribute('aria-describedby') ?? '')?.textContent).toBe('No local map set');
    expect(group.getByText('Geometry loaded: placeholder.')).toBeTruthy();
  });
});

describe('MapFrame', () => {
  it('runs available commands and keeps unavailable ones focusable, described and inert', () => {
    const props = frame();
    const toolbar = within(screen.getByRole('toolbar', { name: 'Map commands' }));
    fireEvent.click(toolbar.getByRole('button', { name: 'Fit route' }));
    expect(props.commands[0]?.onRun).toHaveBeenCalledTimes(1);
    const focus = toolbar.getByRole('button', { name: 'Focus step' });
    expect(focus.getAttribute('aria-disabled')).toBe('true');
    expect(focus.hasAttribute('disabled')).toBe(false);
    expect(document.getElementById(focus.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Select a step first');
    expect(focus.getAttribute('title')).toBe('Centre on the step: Select a step first');
    fireEvent.click(focus);
    expect(props.commands[1]?.onRun).not.toHaveBeenCalled();
  });

  it('toggles the layer panel, which sits beside the stage when open', () => {
    const props = frame();
    const toggle = screen.getByRole('button', { name: 'Layers' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('group', { name: 'Layers' })).toBeNull();
    fireEvent.click(toggle);
    expect(props.onLayersOpenChange).toHaveBeenCalledWith(true);
    cleanup();
    frame({ layersOpen: true });
    const open = screen.getByRole('button', { name: 'Layers' });
    expect(open.getAttribute('aria-pressed')).toBe('true');
    const panel = screen.getByRole('group', { name: 'Layers' });
    expect(open.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.closest('.frl-mapframe__side')?.previousElementSibling?.className).toBe('frl-mapframe__stage');
  });

  it('switches surfaces through a labelled select', () => {
    const props = frame();
    fireEvent.change(screen.getByRole('combobox', { name: 'Map surface' }), { target: { value: 'world:0' } });
    expect(props.surface.onChange).toHaveBeenCalledWith('world:0');
  });

  it('always shows what kind of map this is, the status lines and the hover text', () => {
    frame({ hover: 'Gornek: starts 2 quests' });
    expect(screen.getByText('Schematic map: zone frames, not terrain')).toBeTruthy();
    expect(screen.getByText('Route: 4 of 7 steps on Kalimdor')).toBeTruthy();
    expect(document.querySelector('.frl-mapframe__hover')?.textContent).toBe('Pointer on: Gornek: starts 2 quests');
    expect(document.getElementById('map-instructions')?.textContent).toBe('Drag to pan.');
    // Without a short form the notice has only its full text.
    expect(document.querySelector('.frl-mapframe__notice-short')).toBeNull();
  });

  it('carries a short notice for narrow panels, and takes the hover line as an element that renders it', () => {
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

  it('shows each layer’s glyph and, with the layer panel, the key to every glyph and line style (MAP-A11Y-10)', () => {
    frame({ layersOpen: true, layers: { layers: ROWS.map((row) => ({ ...row, glyph: row.id === 'route-steps' ? 'step' : null })), onToggle: vi.fn() } });
    const panel = within(screen.getByRole('group', { name: 'Layers' }));
    const glyph = panel.getByRole('checkbox', { name: /Step markers/ }).closest('label')?.querySelector('svg');
    expect(glyph?.getAttribute('data-glyph')).toBe('step');
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    expect(panel.getByRole('checkbox', { name: 'Objectives' }).closest('label')?.querySelector('svg')).toBeNull();
    const key = within(screen.getByRole('group', { name: 'Key' }));
    for (const section of MAP_KEY) {
      const list = key.getByRole('list', { name: section.title });
      expect(within(list).getAllByRole('listitem').map((item) => [item.querySelector('svg')?.getAttribute('data-glyph'), item.querySelector('span')?.textContent])).toEqual(
        section.entries.map((entry) => [entry.glyph, entry.text]),
      );
    }
    expect(key.getByText(MAP_GRID_NOTE)).toBeTruthy();
  });

  it('lists the items at a clicked point, keyboard first, and closes on Escape, on a pick or on a press outside', () => {
    const onChoose = vi.fn();
    const onAll = vi.fn();
    const onDismiss = vi.fn();
    const choice = { title: '3 steps here', hint: 'Choose one to select its step.', options: ['4 · A', '5 · B', '6 · C'], allLabel: 'Select all 3 steps', at: { x: 700, y: 500, width: 800, height: 600 }, onChoose, onAll, onDismiss };
    frame({ choice });
    const dialog = screen.getByRole('dialog', { name: '3 steps here' });
    expect(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Choose one to select its step.');
    // Beside the point but inside the stage; above it in the lower half.
    expect(dialog.style.left).toBe(`${String(800 - MAP_CHOICE_WIDTH - 8)}px`);
    expect(dialog.style.bottom).toBe('112px');
    const items = within(dialog).getAllByRole('listitem').map((item) => item.querySelector('button'));
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0] as HTMLElement, { key: 'End' });
    expect(document.activeElement?.textContent).toBe('Select all 3 steps');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0] as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.click(items[2] as HTMLElement);
    expect(onChoose).toHaveBeenCalledWith(2);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Select all 3 steps' }));
    expect(onAll).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(screen.getByRole('combobox', { name: 'Map surface' }));
    expect(onDismiss).toHaveBeenCalledTimes(2);
    fireEvent.pointerDown(items[1] as HTMLElement);
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('places the list below a point in the upper half, and at the corner without one', () => {
    expect(mapChoicePosition({ x: 10, y: 20, width: 800, height: 600 })).toEqual({ left: 22, top: 32 });
    expect(mapChoicePosition(null)).toEqual({ left: 8, top: 8 });
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
