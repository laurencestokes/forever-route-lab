// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MapPlaceholder } from './MapPlaceholder';

afterEach(cleanup);

describe('MapPlaceholder layout', () => {
  it('lays the card and the layer stub out as siblings in one grid, never stacked on each other', () => {
    const { container } = render(<MapPlaceholder focus={null} />);
    const layout = container.querySelector('.frl-mapph__layout') as HTMLElement;
    const children = [...layout.children].map((child) => child.className);
    expect(children).toEqual(['frl-mapph__card', 'frl-mapph__layers']);
    // The decorative art stays outside the grid, behind it.
    expect(layout.parentElement?.querySelector(':scope > svg.frl-mapph__art')).not.toBeNull();
    expect(screen.getByText('No active step')).toBeDefined();
  });

  it('echoes the active step and its location', () => {
    render(<MapPlaceholder focus={{ title: 'Placeholder step 7', location: 'Placeholder Vale' }} />);
    expect(screen.getByText('Placeholder step 7')).toBeDefined();
    expect(screen.getByText('· Placeholder Vale', { exact: false })).toBeDefined();
  });
});
