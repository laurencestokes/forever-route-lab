import { type KeyboardEvent, memo, type ReactNode, useId, useLayoutEffect, useRef } from 'react';
import type { Difficulty } from '../../rules/difficulty';
import { cx } from '../lib/cx';
import { formatInteger } from '../lib/format';
import { PlaceholderTag } from '../primitives/Badge';
import { Button } from '../primitives/Button';
import { DifficultyLabel } from '../markers/DifficultyLabel';
import { ProvenanceBadge } from '../markers/ProvenanceBadge';
import { QuestMark, type QuestMarkState } from '../markers/QuestMark';
import type { ForeverProvenance } from '../markers/provenance';
import './SidePanel.css';

/** Building blocks for side-panel content. All presentational. */

export interface PanelSectionProps {
  readonly title: string;
  /** Right-aligned header content (a count, a small action). */
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}

export function PanelSection({ title, aside, children, className }: PanelSectionProps) {
  return (
    <section className={cx('frl-panel-section', className)}>
      <header className="frl-panel-section__header">
        <h2 className="frl-panel-section__title">{title}</h2>
        {aside !== undefined && <span className="frl-panel-section__aside">{aside}</span>}
      </header>
      <div className="frl-panel-section__body">{children}</div>
    </section>
  );
}

export interface EmptyStateProps {
  readonly title: string;
  readonly children?: ReactNode;
  /** Adds the visible "Placeholder" label (content that stands in for later milestones). */
  readonly placeholder?: boolean | undefined;
}

export function EmptyState({ title, children, placeholder = false }: EmptyStateProps) {
  return (
    <div className="frl-empty">
      {placeholder && <PlaceholderTag />}
      <p className="frl-empty__title">{title}</p>
      {children !== undefined && <div className="frl-empty__text">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Quest lists: WAI-ARIA layout grids (docs/research/ui-refresh.md §5.4, §5.5, §9.3; D-048)

/** What a grid key does: the row and item to move to, or null when the grid does not handle it. */
export function gridKeyTarget(
  key: string,
  ctrl: boolean,
  rows: readonly number[],
  at: { readonly row: number; readonly item: number },
): { readonly row: number; readonly item: number } | null {
  const last = rows.length - 1;
  if (last < 0) return null;
  const clampItem = (row: number, item: number) => Math.max(0, Math.min((rows[row] ?? 1) - 1, item));
  const to = (row: number, item: number) => {
    const r = Math.max(0, Math.min(last, row));
    return { row: r, item: clampItem(r, item) };
  };
  switch (key) {
    case 'ArrowDown':
      return to(at.row + 1, at.item);
    case 'ArrowUp':
      return to(at.row - 1, at.item);
    case 'ArrowRight':
      return to(at.row, at.item + 1);
    case 'ArrowLeft':
      return to(at.row, at.item - 1);
    case 'Home':
      return ctrl ? to(0, 0) : to(at.row, 0);
    case 'End':
      return ctrl ? to(last, (rows[last] ?? 1) - 1) : to(at.row, (rows[at.row] ?? 1) - 1);
    case 'PageDown':
      return to(at.row + 10, at.item);
    case 'PageUp':
      return to(at.row - 10, at.item);
    default:
      return null;
  }
}

/** The grid's focusable items (one widget or row header per cell), row by row. */
function gridItems(grid: HTMLElement): HTMLElement[][] {
  return Array.from(grid.querySelectorAll<HTMLElement>('[role="row"]'))
    .map((row) => Array.from(row.querySelectorAll<HTMLElement>('[data-grid-item]')))
    .filter((items) => items.length > 0);
}

export const QUEST_GRID_KEYS =
  'Arrow keys move between the quests and their buttons, and onto the group headings; Home and End go along a row, Control+Home and Control+End to the ends, Page Up and Page Down by ten rows; Enter or Space activates.';

export interface QuestGridProps {
  /** The grid's accessible name. */
  readonly label: string;
  /** Rows: `QuestGroupHeader`, `QuestListItem`, `QuestObjectiveRow`. */
  readonly children: ReactNode;
  readonly className?: string | undefined;
}

/**
 * A quest list as a layout grid (ui-refresh.md §9.3): one tab stop that remembers its item; ↑ ↓
 * between rows (group headings included), ← → between a row's buttons, Home and End along a row,
 * Ctrl+Home and Ctrl+End to the ends, PageUp and PageDown by ten rows, Enter or Space to activate.
 * The roving tab stop moves `tabIndex` on two items through the DOM, not through React state, so
 * arrowing re-renders nothing (§10.2). Its description says the keys.
 */
export function QuestGrid({ label, children, className }: QuestGridProps) {
  const ref = useRef<HTMLDivElement>(null);
  const current = useRef<string | null>(null);
  /** Where focus was in the grid (row and item index), while it is there; null once it has left. */
  const place = useRef<{ readonly row: number; readonly item: number } | null>(null);
  const descriptionId = useId();

  // After every render (a page more, a new search, a row's action that removed or changed its row):
  // exactly one item takes the tab stop. When the focused item has gone from the page (Accept moved
  // its quest into the log), focus would fall to the page body (review QA-06): it goes to the same
  // item of the row now at that place, else to that row's first item (a group heading), so the
  // keyboard user carries on from where they were (docs/UI.md §6: focus never stays on nothing).
  useLayoutEffect(() => {
    const grid = ref.current;
    if (grid === null) return;
    const rows = gridItems(grid);
    const all = rows.flat();
    const kept = all.find((item) => item.dataset.gridKey === current.current) ?? null;
    const active = grid.ownerDocument.activeElement;
    const nowhere = active === null || active === grid.ownerDocument.body;
    if (place.current !== null && nowhere) {
      const at = place.current;
      const row = rows[Math.min(at.row, rows.length - 1)];
      const target = kept ?? row?.[Math.min(at.item, row.length - 1)] ?? row?.[0] ?? null;
      if (target !== null) {
        current.current = target.dataset.gridKey ?? null;
        for (const item of all) item.tabIndex = item === target ? 0 : -1;
        target.focus();
        return;
      }
    }
    const stop = kept ?? all[0] ?? null;
    for (const item of all) item.tabIndex = item === stop ? 0 : -1;
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const grid = ref.current;
    if (grid === null || !(event.target instanceof HTMLElement)) return;
    const rows = gridItems(grid);
    const row = rows.findIndex((items) => items.includes(event.target as HTMLElement));
    if (row < 0) return;
    const item = rows[row]?.indexOf(event.target) ?? 0;
    const next = gridKeyTarget(event.key, event.ctrlKey || event.metaKey, rows.map((items) => items.length), { row, item });
    if (next === null) return;
    event.preventDefault();
    const target = rows[next.row]?.[next.item];
    if (target === undefined) return;
    event.target.tabIndex = -1;
    target.tabIndex = 0;
    target.focus();
  };

  return (
    <div
      ref={ref}
      role="grid"
      aria-label={label}
      aria-describedby={descriptionId}
      className={cx('frl-quest-grid', className)}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        const key = event.target instanceof HTMLElement ? (event.target.dataset.gridKey ?? null) : null;
        if (key === null) return;
        current.current = key;
        const rows = gridItems(event.currentTarget);
        const target = event.target as HTMLElement;
        const row = rows.findIndex((items) => items.includes(target));
        place.current = row < 0 ? null : { row, item: rows[row]?.indexOf(target) ?? 0 };
        for (const item of rows.flat()) item.tabIndex = item === event.target ? 0 : -1;
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        // Focus moved elsewhere, or the item is going from the page (removed items may send a blur
        // on the way out): only a move to another element that stays counts as leaving the grid.
        const left = event.target;
        queueMicrotask(() => {
          if (left.isConnected) place.current = null;
        });
      }}
    >
      <p id={descriptionId} hidden>
        {QUEST_GRID_KEYS}
      </p>
      {children}
    </div>
  );
}

export interface QuestGroupHeaderProps {
  /** The stable key the grid remembers its tab stop by. */
  readonly gridKey: string;
  /** Visible title, in small caps: "Razor Hill". */
  readonly title: string;
  /** What follows the title: the zone's span, its rating, markers. */
  readonly aside?: ReactNode;
  /** The count at the right: "6". */
  readonly count: string;
  /** The heading's spoken words, which a screen reader hears when ↓ lands on it: "Razor Hill, Durotar 5-12, 6 quests". */
  readonly words: string;
  /** The count's tooltip, in words ("8 quests listed here"); omitted: none. */
  readonly countTitle?: string | undefined;
}

/** A group heading row: one `rowheader` cell that takes focus, so ↓ lands on it and the group change is heard (review UR-11). */
export function QuestGroupHeader({ gridKey, title, aside, count, words, countTitle }: QuestGroupHeaderProps) {
  return (
    <div role="row" className="frl-quest-group">
      <div role="rowheader" aria-label={words} data-grid-item data-grid-key={gridKey} tabIndex={-1} className="frl-quest-group__cell">
        <span className="frl-quest-group__title" aria-hidden="true">
          {title}
        </span>
        {aside !== undefined && (
          <span className="frl-quest-group__aside" aria-hidden="true">
            {aside}
          </span>
        )}
        <span className="frl-quest-group__count frl-num" aria-hidden="true" title={countTitle}>
          {count}
        </span>
      </div>
    </div>
  );
}

/** A button at a quest row's end or on its line 2 (Accept, Accept first, Turn in, Objectives done, Done here). */
export interface QuestRowAction {
  readonly key: string;
  /** Visible words: "Accept". */
  readonly label: string;
  /** Accessible name, starting with the visible words: "Accept Break a Few Eggs after step 12". */
  readonly name: string;
  readonly onRun: () => void;
  /** Why it cannot run now (editing is locked): `aria-disabled`, the reason as its tooltip. */
  readonly unavailable?: string | null | undefined;
  /** `link` for the inline actions (Done here); `default` otherwise. */
  readonly look?: 'default' | 'link' | undefined;
}

function RowActionCell({ action, rowKey, className }: { readonly action: QuestRowAction; readonly rowKey: string; readonly className?: string | undefined }) {
  const unavailable = action.unavailable ?? null;
  return (
    <div role="gridcell" className={cx('frl-quest-item__cell', className)}>
      <Button
        size="sm"
        variant={action.look ?? 'default'}
        aria-label={action.name}
        aria-disabled={unavailable === null ? undefined : true}
        title={unavailable ?? undefined}
        tabIndex={-1}
        data-grid-item
        data-grid-key={`${rowKey}:${action.key}`}
        onClick={() => {
          if (unavailable === null) action.onRun();
        }}
      >
        {action.label}
      </Button>
    </div>
  );
}

export interface QuestListItemProps {
  /** Stable key (the quest id): the grid remembers its tab stop by it. */
  readonly rowKey: string;
  readonly name: string;
  /** The quest mark (§5.1), or null for none. */
  readonly mark: {
    readonly state: QuestMarkState;
    readonly unlockLevel?: number | null | undefined;
    readonly progress?: { readonly done: number; readonly total: number | null } | null | undefined;
    readonly dungeonQuest?: boolean | undefined;
  } | null;
  readonly level: number | null;
  readonly difficulty: Difficulty | null;
  readonly uncertain?: boolean | undefined;
  readonly provenance: ForeverProvenance;
  /** The chain position after the name ("1/2"), or null. */
  readonly chain?: string | null | undefined;
  /** Line 2's words after the chip: the giver, or the state's reason; null for none. */
  readonly detail: string | null;
  /** Draws the difficulty chip on line 2 (always beside a coloured mark, so colour never stands alone). */
  readonly chip?: boolean | undefined;
  /** Line 2's XP with its basis marker ("+630 XP ≈"), after the chip (ui-refresh.md §5.4; review UI-05); omitted: none. */
  readonly xp?: ReactNode;
  /** The name button's accessible name ("Break a Few Eggs, quest level 6, Difficult (yellow), from Cook Torka"). */
  readonly nameLabel?: string | undefined;
  /** Opens the quest in Details (and so puts it in focus on the map). */
  readonly onOpen?: (() => void) | undefined;
  /**
   * A locked quest's line 2 (§5.4): "Needs <prerequisite>" as a link to it, then Accept first as the
   * next cell; the row then has no action at its end.
   */
  readonly needs?: {
    readonly text: string;
    readonly name: string;
    readonly onOpen: () => void;
    readonly more: number;
    /** The other prerequisites' names, the "and n more" tooltip; omitted or null for none. */
    readonly moreTitle?: string | null | undefined;
    readonly acceptFirst: QuestRowAction | null;
  } | null | undefined;
  /** The buttons at the row's end: Accept, or Objectives done and Turn in; none on locked and "Unlocks soon" rows. */
  readonly actions?: readonly QuestRowAction[] | undefined;
}

/**
 * One quest of the Available or Quest log lists, a row of a `QuestGrid` (§5.4): the quest mark in its
 * state, the name (a button that opens Details), the chain and provenance; line 2 with the chip and
 * the giver or the reason, or "Needs <prerequisite>" and Accept first; the actions at the end. The
 * mark, chip and badges are decorative; the name button's name says the row.
 */
export const QuestListItem = memo(function QuestListItem({
  rowKey,
  name,
  mark,
  level,
  difficulty,
  uncertain = false,
  provenance,
  chain = null,
  detail,
  chip = true,
  xp = null,
  nameLabel,
  onOpen,
  needs = null,
  actions = [],
}: QuestListItemProps) {
  return (
    <div role="row" className={cx('frl-quest-item', needs !== null && 'is-locked')} data-quest-row={rowKey}>
      <div role="gridcell" className="frl-quest-item__main">
        {mark !== null && (
          <QuestMark
            state={mark.state}
            difficulty={difficulty}
            unlockLevel={mark.unlockLevel}
            progress={mark.progress}
            dungeonQuest={mark.dungeonQuest}
            className="frl-quest-item__mark"
          />
        )}
        <span className="frl-quest-item__name">
          {onOpen === undefined ? (
            <span className="frl-quest-item__label" title={name}>
              {name}
            </span>
          ) : (
            <button
              type="button"
              className="frl-quest-item__label frl-quest-item__open"
              title={name}
              aria-label={nameLabel}
              tabIndex={-1}
              data-grid-item
              data-grid-key={`${rowKey}:name`}
              onClick={onOpen}
            >
              {name}
            </button>
          )}
          {chain !== null && <span className="frl-quest-item__chain frl-num">{chain}</span>}
          <ProvenanceBadge provenance={provenance} className="frl-quest-item__provenance" />
        </span>
        {needs === null && (
          <span className="frl-quest-item__detail">
            {chip && <DifficultyLabel level={level} difficulty={difficulty} uncertain={uncertain} />}
            {xp !== null && xp !== undefined && <span className="frl-quest-item__xp frl-num">{xp}</span>}
            {detail !== null && <span className="frl-quest-item__words">{detail}</span>}
          </span>
        )}
      </div>
      {needs !== null && (
        <>
          <div role="gridcell" className="frl-quest-item__needs">
            <span aria-hidden="true">Needs </span>
            <Button
              size="sm"
              variant="link"
              aria-label={needs.name}
              tabIndex={-1}
              data-grid-item
              data-grid-key={`${rowKey}:needs`}
              onClick={needs.onOpen}
            >
              {needs.text}
            </Button>
            {needs.more > 0 && (
              <span className="frl-quest-item__words" title={needs.moreTitle ?? undefined}>
                {` and ${formatInteger(needs.more)} more`}
              </span>
            )}
          </div>
          {needs.acceptFirst !== null && <RowActionCell action={needs.acceptFirst} rowKey={rowKey} className="frl-quest-item__first" />}
        </>
      )}
      {actions.map((action) => (
        <RowActionCell key={action.key} action={action} rowKey={rowKey} className="frl-quest-item__action" />
      ))}
    </div>
  );
});

export interface QuestObjectiveRowProps {
  readonly rowKey: string;
  /** The objective's words. */
  readonly text: string;
  /** Its state in words for the row ("done", "open", "unknown"). */
  readonly state: 'open' | 'done' | 'unknown';
  /** Done here (a link) while it is open. */
  readonly action?: QuestRowAction | null | undefined;
}

/** One objective under a Quest log quest (§5.5): ○ or ✓, its words, and Done here while it is open. */
export function QuestObjectiveRow({ rowKey, text, state, action = null }: QuestObjectiveRowProps) {
  const glyph = state === 'done' ? '✓' : state === 'open' ? '○' : '?';
  const words = state === 'done' ? 'done' : state === 'open' ? 'open' : 'progress unknown';
  // The objective's words are a grid item of their own, so ↓ reaches every objective, a done or an
  // unknown one too, not only the open ones through Done here (fix UI-11).
  return (
    <div role="row" className={cx('frl-quest-objective', `is-${state}`)}>
      <div role="gridcell" className="frl-quest-objective__text" tabIndex={-1} data-grid-item data-grid-key={`${rowKey}:text`}>
        <span aria-hidden="true" className="frl-quest-objective__glyph">
          {glyph}
        </span>
        <span>{text}</span>
        <span className="frl-visually-hidden">{`, ${words}`}</span>
      </div>
      {action !== null && <RowActionCell action={{ ...action, look: 'link' }} rowKey={rowKey} className="frl-quest-objective__action" />}
    </div>
  );
}
