// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUEST_GRID_KEYS, QuestGrid, QuestGroupHeader, QuestListItem, QuestObjectiveRow, gridKeyTarget } from './PanelContent';

afterEach(cleanup);

const LONG_NAME = 'Placeholder quest with a name far too long to fit in the side panel on one line';
const PROVENANCE = { claim: 'new', declaredBy: 'data' } as const;

describe('QuestListItem', () => {
  it('puts the name in its own ellipsised label, with the chain and the provenance badge after it', () => {
    const { container } = render(
      <QuestGrid label="Quests">
        <QuestListItem rowKey="1" name={LONG_NAME} mark={{ state: 'available' }} level={12} difficulty="standard" provenance={PROVENANCE} chain="1/2" detail="Placeholder giver" onOpen={vi.fn()} />
      </QuestGrid>,
    );
    const name = container.querySelector('.frl-quest-item__name') as HTMLElement;
    const label = name.querySelector('.frl-quest-item__label') as HTMLElement;
    // The label is a real element (an anonymous flex item cannot ellipsise) and carries the full name
    // as its tooltip; the chain and the badge are its siblings, so SidePanel.css keeps them whole.
    expect(label.textContent).toBe(LONG_NAME);
    expect(label.getAttribute('title')).toBe(LONG_NAME);
    expect(label.nextElementSibling?.textContent).toBe('1/2');
    expect(name.lastElementChild?.classList.contains('frl-provenance')).toBe(true);
  });

  it('has only the label when the Forever status is unknown and nothing opens it', () => {
    const { container } = render(
      <QuestGrid label="Quests">
        <QuestListItem rowKey="1" name="Placeholder quest" mark={null} level={3} difficulty={null} provenance={{ claim: 'unknown', declaredBy: null }} detail={null} />
      </QuestGrid>,
    );
    const name = container.querySelector('.frl-quest-item__name') as HTMLElement;
    expect(name.children).toHaveLength(1);
    expect(name.querySelector('.frl-quest-item__label')?.textContent).toBe('Placeholder quest');
  });

  it('draws the mark in its state, the chip beside a coloured one, and Accept at the row’s end', () => {
    const onRun = vi.fn();
    const { container } = render(
      <QuestGrid label="Quests">
        <QuestListItem
          rowKey="7"
          name="Break a Few Eggs"
          nameLabel="Break a Few Eggs, quest level 6, Difficult (yellow), Cook Torka"
          mark={{ state: 'available' }}
          level={6}
          difficulty="difficult"
          provenance={PROVENANCE}
          detail="Cook Torka"
          onOpen={vi.fn()}
          actions={[{ key: 'accept', label: 'Accept', name: 'Accept Break a Few Eggs after step 12', onRun }]}
        />
      </QuestGrid>,
    );
    expect(container.querySelector('.frl-quest-mark')?.getAttribute('data-colour')).toBe('difficult');
    expect(container.querySelector('.frl-quest-item__detail [data-difficulty="difficult"]')).not.toBeNull();
    const row = screen.getByRole('row');
    expect(within(row).getByRole('button', { name: 'Break a Few Eggs, quest level 6, Difficult (yellow), Cook Torka' })).toBeDefined();
    fireEvent.click(within(row).getByRole('button', { name: 'Accept Break a Few Eggs after step 12' }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('puts "Needs <prerequisite>" and Accept first right after it on a locked row, with no action at its end (review UO-11)', () => {
    const onNeeds = vi.fn();
    const onFirst = vi.fn();
    render(
      <QuestGrid label="Quests">
        <QuestListItem
          rowKey="9"
          name="Encroachment"
          mark={{ state: 'locked' }}
          level={7}
          difficulty="standard"
          chip={false}
          provenance={PROVENANCE}
          detail={null}
          onOpen={vi.fn()}
          needs={{
            text: 'Vanquish the Betrayers',
            name: 'Needs Vanquish the Betrayers: show it in Details',
            more: 0,
            onOpen: onNeeds,
            acceptFirst: { key: 'first', label: 'Accept first', name: 'Accept first: Vanquish the Betrayers, the prerequisite of Encroachment', onRun: onFirst },
          }}
        />
      </QuestGrid>,
    );
    const cells = within(screen.getByRole('row')).getAllByRole('gridcell');
    expect(cells.map((cell) => cell.className)).toEqual(['frl-quest-item__main', 'frl-quest-item__needs', 'frl-quest-item__cell frl-quest-item__first']);
    fireEvent.click(screen.getByRole('button', { name: 'Needs Vanquish the Betrayers: show it in Details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept first: Vanquish the Betrayers, the prerequisite of Encroachment' }));
    expect(onNeeds).toHaveBeenCalledTimes(1);
    expect(onFirst).toHaveBeenCalledTimes(1);
  });

  it('keeps an unavailable action focusable and inert, with the reason', () => {
    const onRun = vi.fn();
    render(
      <QuestGrid label="Quests">
        <QuestListItem rowKey="1" name="Q" mark={{ state: 'available' }} level={1} difficulty="standard" provenance={PROVENANCE} detail={null} actions={[{ key: 'accept', label: 'Accept', name: 'Accept Q', onRun, unavailable: 'Locked while the optimiser runs' }]} />
      </QuestGrid>,
    );
    const accept = screen.getByRole('button', { name: 'Accept Q' });
    expect(accept.getAttribute('aria-disabled')).toBe('true');
    expect(accept.getAttribute('title')).toBe('Locked while the optimiser runs');
    fireEvent.click(accept);
    expect(onRun).not.toHaveBeenCalled();
  });
});

describe('QuestGrid (ui-refresh.md §9.3; APG layout grid)', () => {
  function Grid() {
    return (
      <QuestGrid label="Quests after step 12">
        <QuestGroupHeader gridKey="g:1" title="Razor Hill" count="2" words="Razor Hill, Durotar 5-12, 2 quests" aside={<span>Durotar 5-12</span>} />
        <QuestListItem rowKey="1" name="One" mark={{ state: 'available' }} level={5} difficulty="standard" provenance={PROVENANCE} detail={null} onOpen={vi.fn()} actions={[{ key: 'accept', label: 'Accept', name: 'Accept One', onRun: vi.fn() }]} />
        <QuestListItem rowKey="2" name="Two" mark={{ state: 'available' }} level={5} difficulty="standard" provenance={PROVENANCE} detail={null} onOpen={vi.fn()} actions={[{ key: 'accept', label: 'Accept', name: 'Accept Two', onRun: vi.fn() }]} />
        <QuestGroupHeader gridKey="g:soon" title="Unlocks soon" count="1" words="Unlocks soon, 1 quest" />
        <QuestListItem rowKey="3" name="Three" mark={{ state: 'unlocks-soon', unlockLevel: 7 }} level={7} difficulty={null} chip={false} provenance={PROVENANCE} detail="Unlocks at level 7" onOpen={vi.fn()} />
        <QuestObjectiveRow rowKey="3:0" text="Kill ten boars" state="open" action={{ key: 'here', label: 'Done here', name: 'Done here: objective 1 of Three', onRun: vi.fn() }} />
      </QuestGrid>
    );
  }
  const grid = () => screen.getByRole('grid', { name: 'Quests after step 12' });
  const button = (name: string) => screen.getByRole('button', { name });
  const header = (name: string) => screen.getByRole('rowheader', { name });

  it('is one tab stop, described by its keys', () => {
    render(<Grid />);
    const stops = [...grid().querySelectorAll('[data-grid-item]')].filter((el) => (el as HTMLElement).tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBe(header('Razor Hill, Durotar 5-12, 2 quests'));
    expect(document.getElementById(grid().getAttribute('aria-describedby') ?? '')?.textContent).toBe(QUEST_GRID_KEYS);
  });

  it('moves ↑ ↓ between rows, headers in the order, and ← → Home End along a row, remembering the tab stop', () => {
    render(<Grid />);
    header('Razor Hill, Durotar 5-12, 2 quests').focus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(button('One'));
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(button('Accept One'));
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(button('Accept Two'));
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    // The group heading takes focus, so the group change is heard (review UR-11).
    expect(document.activeElement).toBe(header('Unlocks soon, 1 quest'));
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(button('Three'));
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
    expect(document.activeElement).toBe(button('Done here: objective 1 of Three'));
    fireEvent.keyDown(document.activeElement as Element, { key: 'Home', ctrlKey: true });
    expect(document.activeElement).toBe(header('Razor Hill, Durotar 5-12, 2 quests'));
    fireEvent.keyDown(document.activeElement as Element, { key: 'End', ctrlKey: true });
    expect(document.activeElement).toBe(button('Done here: objective 1 of Three'));
    // One tab stop, where focus last was.
    expect([...grid().querySelectorAll('[data-grid-item]')].filter((el) => (el as HTMLElement).tabIndex === 0)).toEqual([button('Done here: objective 1 of Three')]);
  });

  it('pages by ten rows, and clamps at the ends', () => {
    expect(gridKeyTarget('PageDown', false, [1, 2, 2, 1], { row: 0, item: 0 })).toEqual({ row: 3, item: 0 });
    expect(gridKeyTarget('PageUp', false, [1, 2, 2, 1], { row: 2, item: 1 })).toEqual({ row: 0, item: 0 });
    expect(gridKeyTarget('ArrowUp', false, [1, 2], { row: 0, item: 0 })).toEqual({ row: 0, item: 0 });
    expect(gridKeyTarget('ArrowDown', false, [2, 1], { row: 0, item: 1 })).toEqual({ row: 1, item: 0 });
    expect(gridKeyTarget('x', false, [1], { row: 0, item: 0 })).toBeNull();
  });

  it('says an objective’s state in words beside its ○ or ✓', () => {
    render(
      <QuestGrid label="Log">
        <QuestObjectiveRow rowKey="a" text="Kill ten boars" state="done" />
        <QuestObjectiveRow rowKey="b" text="Collect five hides" state="unknown" />
      </QuestGrid>,
    );
    const cells = screen.getAllByRole('gridcell');
    expect(cells.map((cell) => cell.textContent)).toEqual(['✓Kill ten boars, done', '?Collect five hides, progress unknown']);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    // Each objective's words are a grid item, so ↓ reaches a done or unknown one too (review UI-11).
    expect(cells.every((cell) => cell.hasAttribute('data-grid-item'))).toBe(true);
    (cells[0] as HTMLElement).focus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(cells[1]);
  });

  it('keeps focus in the grid when a row’s action removes its row: the same item of the row now there, never the page (review QA-06)', () => {
    const row = (key: string, name: string) => (
      <QuestListItem key={key} rowKey={key} name={name} mark={{ state: 'available' }} level={5} difficulty="standard" provenance={PROVENANCE} detail={null} onOpen={vi.fn()} actions={[{ key: 'accept', label: 'Accept', name: `Accept ${name}`, onRun: vi.fn() }]} />
    );
    const list = (names: readonly string[]) => (
      <QuestGrid label="Quests">
        <QuestGroupHeader gridKey="g" title="Durotar" count={String(names.length)} words={`Durotar, ${String(names.length)} quests listed`} />
        {names.map((name) => row(name, name))}
      </QuestGrid>
    );
    const { rerender } = render(list(['One', 'Two', 'Three']));
    button('Accept Two').focus();
    // Accept put Two into the log: its row leaves the list.
    rerender(list(['One', 'Three']));
    expect(document.activeElement).toBe(button('Accept Three'));
    expect(button('Accept Three').tabIndex).toBe(0);
    // The last row going: focus goes to the row now last.
    rerender(list(['One']));
    expect(document.activeElement).toBe(button('Accept One'));
    // Every quest going: the group heading.
    rerender(list([]));
    expect(document.activeElement).toBe(screen.getByRole('rowheader', { name: 'Durotar, 0 quests listed' }));
  });

  it('leaves focus alone when it has moved out of the grid (review QA-06)', () => {
    const { rerender } = render(
      <div>
        <QuestGrid label="Quests">
          <QuestListItem rowKey="1" name="One" mark={{ state: 'available' }} level={5} difficulty="standard" provenance={PROVENANCE} detail={null} onOpen={vi.fn()} />
        </QuestGrid>
        <button type="button">Elsewhere</button>
      </div>,
    );
    screen.getByRole('button', { name: 'One' }).focus();
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    elsewhere.focus();
    rerender(
      <div>
        <QuestGrid label="Quests">
          <QuestListItem rowKey="2" name="Two" mark={{ state: 'available' }} level={5} difficulty="standard" provenance={PROVENANCE} detail={null} onOpen={vi.fn()} />
        </QuestGrid>
        <button type="button">Elsewhere</button>
      </div>,
    );
    expect(document.activeElement).toBe(elsewhere);
  });
});
