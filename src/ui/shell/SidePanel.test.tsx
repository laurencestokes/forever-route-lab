// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestListItem } from './PanelContent';

afterEach(cleanup);

const LONG_NAME = 'Placeholder quest with a name far too long to fit in the side panel on one line';

describe('QuestListItem', () => {
  it('puts the name in its own ellipsised label, with the provenance badge after it', () => {
    const { container } = render(
      <ul>
        <QuestListItem
          name={LONG_NAME}
          level={12}
          difficulty="standard"
          provenance={{ claim: 'new', declaredBy: 'data' }}
          detail="Placeholder zone"
          onAdd={vi.fn()}
        />
      </ul>,
    );
    const name = container.querySelector('.frl-quest-item__name') as HTMLElement;
    const label = name.querySelector('.frl-quest-item__label') as HTMLElement;
    // The label is a real element (an anonymous flex item cannot ellipsise) and carries the full
    // name as its tooltip; the badge is its sibling, so SidePanel.css can keep it from shrinking.
    expect(label.textContent).toBe(LONG_NAME);
    expect(label.getAttribute('title')).toBe(LONG_NAME);
    expect(label.nextElementSibling?.classList.contains('frl-provenance')).toBe(true);
    expect(name.children).toHaveLength(2);
    expect(screen.getByRole('button', { name: `Add to route: ${LONG_NAME}` })).toBeDefined();
  });

  it('has only the label when the Forever status is unknown', () => {
    const { container } = render(
      <ul>
        <QuestListItem name="Placeholder quest" level={3} difficulty={null} provenance={{ claim: 'unknown', declaredBy: null }} detail={null} />
      </ul>,
    );
    const name = container.querySelector('.frl-quest-item__name') as HTMLElement;
    expect(name.children).toHaveLength(1);
    expect(name.querySelector('.frl-quest-item__label')?.textContent).toBe('Placeholder quest');
  });
});
