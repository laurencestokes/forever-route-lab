// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXTERNAL_LINK_TEXT } from '../primitives/ExternalLink';
import { MAP_POPOVER_WIDTH, MapPopover, mapPopoverPosition, type MapPopoverProps } from './MapPopover';

afterEach(cleanup);

/*
 * The map popover's keyboard contract (docs/UI.md §9 rule 15; map-presentation.md §14.2; step
 * MP.6): a named non-modal dialog; focus moves to its first action; one list of actions, the Wowhead
 * link included (arrows, Home, End); Tab leaves and closes it; Escape closes it; a press outside
 * closes it, but not a press on the map's stage (the map's own click closes it).
 */

function popover(overrides: Partial<MapPopoverProps> = {}) {
  const props: MapPopoverProps = {
    openKey: 1,
    title: 'Quests at Gornek',
    sections: [
      {
        key: 'quest:1',
        heading: 'Cutting Teeth',
        quest: { level: 3, difficulty: 'standard', lowerBound: false, xp: { text: '450 base XP', basis: 'era-fallback', detail: 'Era value from QuestieDB; Forever XP is unknown' }, provenance: null },
        lines: ['Available', 'At Gornek'],
        actions: [
          { key: 'accept', label: 'Accept after step 12', variant: 'primary', unavailable: null },
          { key: 'details', label: 'Show in Details', variant: 'default', unavailable: null },
          { key: 'wowhead', label: 'Open on Wowhead', variant: 'external', unavailable: null, href: 'https://www.wowhead.com/classic/quest=1' },
        ],
      },
    ],
    footer: [
      { key: 'go', label: 'Go here after step 12', variant: 'default', unavailable: null },
      { key: 'fly', label: 'Fly from the nearest known flight point', variant: 'default', unavailable: 'Where the character is after step 12 is not known' },
    ],
    at: { x: 700, y: 500, width: 800, height: 600 },
    onAction: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(
    <div>
      <div className="stage">
        <MapPopover {...props} />
      </div>
      <button type="button">Elsewhere</button>
    </div>,
  );
  return props;
}

const actionsOf = (dialog: HTMLElement): HTMLElement[] => [...dialog.querySelectorAll<HTMLElement>('[data-popover-action]')];

describe('MapPopover (UI.md §9 rule 15)', () => {
  it('is a non-modal dialog named after its subject, beside the point and inside the stage, with focus on its first action', () => {
    popover();
    const dialog = screen.getByRole('dialog', { name: 'Quests at Gornek' });
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    expect(dialog.style.left).toBe(`${String(800 - MAP_POPOVER_WIDTH - 8)}px`);
    expect(dialog.style.bottom).toBe('114px');
    expect(document.activeElement?.textContent).toBe('Accept after step 12');
    expect(mapPopoverPosition({ x: 10, y: 20, width: 800, height: 600 })).toEqual({ left: 24, top: 34, maxHeight: 520 });
    expect(mapPopoverPosition(null)).toEqual({ left: 8, top: 8 });
    // Never taller than the room on its side (review PR-07): the body scrolls instead.
    expect(dialog.style.maxHeight).toBe(`${String(600 - 114 - 8)}px`);
    // The quest's chips and words: its difficulty, its XP with the Era marker.
    expect(within(dialog).getByText('450 base XP')).toBeTruthy();
    expect(dialog.querySelector('.frl-difficulty')).not.toBeNull();
  });

  it('gives the first focus to an available action, not to an unavailable one before it (QA-04)', () => {
    popover({
      title: 'Transport stop (service unknown)',
      sections: [
        {
          key: 'transport:241:1',
          heading: 'Client transport path 241',
          quest: null,
          lines: ['client transport path 241, stop 2 of 2 · to Kalimdor'],
          actions: [{ key: 'transport', label: 'Add transport after step 12', variant: 'default', unavailable: 'This stop’s service is not known: it is never used for a route' }],
        },
      ],
    });
    expect(document.activeElement?.textContent).toBe('Go here after step 12');
  });

  it('keeps a stack’s popover near mid-stage inside the stage, every action reachable, and names each action with its quest (PR-07, QA-18)', () => {
    const quest = (id: number, name: string) => ({
      key: `quest:${String(id)}`,
      heading: name,
      quest: { level: 10, difficulty: 'difficult' as const, lowerBound: false, xp: null, provenance: null },
      lines: ['Available', 'At Gar’Thok'],
      actions: [
        { key: `quest:${String(id)}:accept`, label: 'Accept after step 55', name: `Accept ${name} after step 55`, variant: 'primary' as const, unavailable: null },
        { key: `quest:${String(id)}:details`, label: 'Show in Details', name: `Show ${name} in Details`, variant: 'default' as const, unavailable: null },
        { key: `quest:${String(id)}:wowhead`, label: 'Open on Wowhead', name: `Open ${name} on Wowhead`, variant: 'external' as const, unavailable: null, href: `https://www.wowhead.com/classic/quest=${String(id)}` },
      ],
    });
    // The verifier's case: a pin at y 318 of a 690 px stage (the upper half), below which only 358 px are left.
    popover({ title: '2 quests at Gar’Thok and Misha', sections: [quest(1, 'Encroachment'), quest(2, 'Lost But Not Forgotten')], at: { x: 400, y: 318, width: 684, height: 690 } });
    const dialog = screen.getByRole('dialog', { name: '2 quests at Gar’Thok and Misha' });
    const top = Number.parseFloat(dialog.style.top);
    const maxHeight = Number.parseFloat(dialog.style.maxHeight);
    expect(top).toBe(318 + 14);
    expect(top + maxHeight).toBeLessThanOrEqual(690 - 8);
    // Each action says which quest it is for, so the two stacks' buttons differ for a screen reader.
    expect(within(dialog).getByRole('button', { name: 'Accept Encroachment after step 55' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Accept Lost But Not Forgotten after step 55' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: `Open Encroachment on Wowhead ${EXTERNAL_LINK_TEXT}` })).toBeTruthy();
    // The Era caveat is beside the link, not only in its tooltip (PR-21).
    expect(dialog.querySelectorAll('.frl-map-popover__caveat')).toHaveLength(2);
  });

  it('moves through one list of actions, the Wowhead link included, with the arrows, Home and End; one tab stop', () => {
    popover();
    const dialog = screen.getByRole('dialog');
    const actions = actionsOf(dialog);
    expect(actions.map((element) => element.textContent)).toEqual([
      'Accept after step 12',
      'Show in Details',
      `Open on Wowhead ${EXTERNAL_LINK_TEXT}`,
      'Go here after step 12',
      'Fly from the nearest known flight point',
    ]);
    expect(actions.filter((element) => element.tabIndex === 0)).toHaveLength(1);
    fireEvent.keyDown(actions[0] as HTMLElement, { key: 'ArrowDown' });
    fireEvent.keyDown(actions[1] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(actions[2]);
    // The link: external, a new tab, no opener and no referrer (D-041 J).
    expect(actions[2]?.getAttribute('target')).toBe('_blank');
    expect(actions[2]?.getAttribute('rel')).toBe('noopener noreferrer');
    fireEvent.keyDown(actions[2] as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(actions[4]);
    fireEvent.keyDown(actions[4] as HTMLElement, { key: 'Home' });
    expect(document.activeElement).toBe(actions[0]);
    expect(actions.filter((element) => element.tabIndex === 0)).toEqual([actions[0]]);
  });

  it('runs an action on a press, and says why an unavailable one cannot run (without running it)', () => {
    const props = popover();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept after step 12' }));
    expect(props.onAction).toHaveBeenCalledWith('accept');
    const fly = within(dialog).getByRole('button', { name: 'Fly from the nearest known flight point' });
    expect(fly.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(fly.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Where the character is after step 12 is not known');
    fireEvent.click(fly);
    expect(props.onAction).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape (focus back to the map), on Tab out, and on a press outside, but not on a press on the stage', () => {
    const props = popover({ insideOf: () => document.querySelector<HTMLElement>('.stage') });
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(props.onClose).toHaveBeenLastCalledWith('escape');
    // Tab: focus leaves for an element outside.
    fireEvent.blur(actionsOf(dialog)[0] as HTMLElement, { relatedTarget: screen.getByRole('button', { name: 'Elsewhere' }) });
    expect(props.onClose).toHaveBeenLastCalledWith('tab');
    // A move within the popover closes nothing.
    fireEvent.blur(actionsOf(dialog)[0] as HTMLElement, { relatedTarget: actionsOf(dialog)[1] });
    expect(props.onClose).toHaveBeenCalledTimes(2);
    fireEvent.pointerDown(document.querySelector('.stage') as HTMLElement);
    expect(props.onClose).toHaveBeenCalledTimes(2);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(props.onClose).toHaveBeenLastCalledWith('outside');
  });

  it('moves focus to the first action again when a new click opens it', () => {
    popover({ openKey: 2 });
    expect(document.activeElement?.textContent).toBe('Accept after step 12');
  });
});
