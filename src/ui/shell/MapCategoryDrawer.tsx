import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { MARK_GLYPHS, type GlyphPath, type MarkEdge, type MarkGlyph, type MapCategoryGroupId } from '../../app/map-exports';
import type { MapStyle } from '../../map/adapter';
import { cx } from '../lib/cx';
import { Button } from '../primitives/Button';
import { Checkbox } from '../primitives/Checkbox';
import { IconButton } from '../primitives/IconButton';
import { SearchField } from '../primitives/SearchField';
import { SegmentedControl, type SegmentedOption } from '../primitives/SegmentedControl';
import { Toolbar } from '../primitives/Toolbar';
import './MapCategoryDrawer.css';

/**
 * The Map layers drawer (docs/research/map-presentation.md §25.3.1 to §25.3.8; D-047; step MP.4b),
 * presentational: the style control, the search, Show all / Hide all / Defaults, the groups of rows
 * with their counts and notes, the search's results, and the key. A lazy part (`lazy-parts.ts`),
 * with its container `app/MapLayersPanel.tsx`; nothing here is in the entry chunk.
 *
 * Keyboard (§25.3.8; UI.md §9 rule 4, one stop per composite widget):
 * 1. the style control (native radios: one stop, arrows inside);
 * 2. the search field (Down moves to the first result);
 * 3. the toolbar (one stop, arrows inside);
 * 4. each group, one stop: a roving tabindex over the group's checkbox and its rows; Up and Down
 *    move, Home and End jump, Space toggles the box under focus; on the group's own box Enter, or
 *    Left and Right, collapse and expand it;
 * 5. the key's disclosure.
 *
 * Escape outside the search field closes a drawer that lies over the map (and its close button
 * does); a docked drawer has no close button and Escape does nothing there (the toggle closes it).
 * In the field the first Escape clears the text (the kit's field), the next reaches the drawer.
 */

/** A row's or result's icon: a pin's glyph in monochrome (the map's own paths), or a line or area swatch. */
export type DrawerIcon =
  | {
      readonly kind: 'pin';
      readonly glyph: MarkGlyph;
      readonly light?: boolean;
      readonly edge?: MarkEdge;
      readonly hollow?: boolean;
      readonly struck?: boolean;
      /** A badge in its slot (§25.2.3), for the key: the BL position ring and the TR faction letter too (review PR-14). */
      readonly badge?: 'lock' | 'level' | 'pie' | 'pie-unknown' | 'arch' | 'count' | 'position' | 'faction';
    }
  | { readonly kind: 'swatch'; readonly swatch: 'route' | 'flight' | 'transport' | 'walking' | 'numbers' | 'labels' | 'border' | 'faction' | 'relief' | 'coast' | 'inset' | 'grid' | 'network-flight' | 'network-transport' };

export interface DrawerRow {
  readonly id: string;
  readonly label: string;
  readonly icon: DrawerIcon;
  readonly shown: boolean;
  /** Why the row cannot be used now (its checkbox disabled, the reason as its note); null when it can. */
  readonly unavailable: string | null;
  /** The count, right-aligned in tabular figures ("209 · 118 givers"); null for none. */
  readonly count: string | null;
  /** The accessible name: the label, the count with its unit, and the state ("Available: 209 quests at 118 givers after step 1425, shown"). */
  readonly name: string;
  /** The tooltip ("12 in view"); null for none. */
  readonly title: string | null;
  /** Honest notes (MAP-HONEST-5), a muted second line. */
  readonly notes: readonly string[];
}

export interface DrawerGroup {
  readonly id: MapCategoryGroupId;
  readonly title: string;
  /** "after step 1425", "zoomed in"; null for none. */
  readonly subtitle: string | null;
  readonly state: boolean | 'mixed';
  readonly collapsed: boolean;
  readonly rows: readonly DrawerRow[];
}

export interface DrawerResult {
  readonly id: string;
  readonly icon: DrawerIcon;
  readonly name: string;
  /** One line: "Start: Thork · level 14 · available after step 1425". */
  readonly line: string;
}

export interface DrawerResultGroup {
  readonly title: string;
  readonly results: readonly DrawerResult[];
}

export interface DrawerSearch {
  readonly query: string;
  readonly onQuery: (text: string) => void;
  /** The field's first focus builds the index. */
  readonly onFocus: () => void;
  /** Null while no query is active: the categories show. */
  readonly results: { readonly summary: string; readonly groups: readonly DrawerResultGroup[]; readonly more: string | null } | null;
  readonly onChoose: (id: string) => void;
  readonly onFit: () => void;
  /** The polite status line after the debounce ("6 results"); empty for none. */
  readonly status: string;
}

export interface DrawerStyle {
  readonly value: MapStyle;
  readonly options: readonly SegmentedOption<MapStyle>[];
  readonly onChange: (style: MapStyle) => void;
  /** Why the chosen style is not shown, or what styles need; null for nothing to say. */
  readonly note: string | null;
}

export interface MapCategoryDrawerProps {
  readonly id: string;
  readonly docked: boolean;
  readonly style: DrawerStyle;
  /** The map's notices (what could not be loaded, the insets): the drawer replaces the status line (D-047). */
  readonly notices: readonly string[];
  readonly groups: readonly DrawerGroup[];
  readonly onRow: (id: string, show: boolean) => void;
  readonly onGroup: (id: MapCategoryGroupId, show: boolean) => void;
  readonly onCollapse: (id: MapCategoryGroupId, collapsed: boolean) => void;
  readonly onShowAll: () => void;
  readonly onHideAll: () => void;
  readonly onDefaults: () => void;
  readonly search: DrawerSearch;
  /** Closes a drawer over the map (Escape, its close button); focus goes back to the toggle. */
  readonly onClose: () => void;
  /** The key (`MapKey`). */
  readonly keyContent: ReactNode;
}

// =============================================================================================
// Icons

function GlyphParts({ glyph, hollow }: { readonly glyph: GlyphPath; readonly hollow: boolean }) {
  return (
    <>
      {glyph.map((part) => {
        if (part.mode === 'stroke') return <path key={part.d} d={part.d} fill="none" stroke="currentColor" strokeWidth={part.width} strokeLinecap="round" strokeLinejoin="round" />;
        if (part.mode === 'cut') return <path key={part.d} d={part.d} className="frl-mapdrawer__cut" fill="none" strokeWidth={part.width} strokeLinecap="round" />;
        if (part.mode === 'cut-fill') return <path key={part.d} d={part.d} className="frl-mapdrawer__cut-fill" />;
        return hollow ? <path key={part.d} d={part.d} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" /> : <path key={part.d} d={part.d} fill="currentColor" />;
      })}
    </>
  );
}

const SWATCHES: Readonly<Record<Extract<DrawerIcon, { kind: 'swatch' }>['swatch'], ReactNode>> = {
  route: <path d="M2 12 8 6l4 3 6-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  flight: <path d="M2 13Q10 1 18 11" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="0.5 3.5" strokeLinecap="round" />,
  // The travel network as the canvas draws it (style.ts `network-flight`, `network-transport`): thin, solid for flights, 3-3 dashes for rides (review PR-14).
  'network-flight': <path d="M2 13Q10 1 18 11" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />,
  'network-transport': <path d="M2 11h16" fill="none" stroke="currentColor" strokeWidth="1.1" strokeDasharray="3 3" />,
  transport: <path d="M2 11h16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeDasharray="4 2.5" />,
  walking: <path d="M2 12c3-6 6 2 9-3s5-3 7-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  numbers: (
    <>
      <circle cx="6" cy="10" r="3.2" fill="currentColor" />
      <text x="11" y="9" fontSize="8" fontWeight="700" fill="currentColor">
        12
      </text>
    </>
  ),
  labels: (
    <text x="1" y="12.5" fontSize="9" fontWeight="700" fill="currentColor">
      Ab
    </text>
  ),
  border: <path d="M2 4c4 1 5 5 8 6s5 2 8 5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />,
  faction: (
    <>
      <rect x="2.5" y="3.5" width="15" height="11" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3 13 9 4M8 14l7-10M13 14l4-6" fill="none" stroke="currentColor" strokeWidth="1" />
    </>
  ),
  relief: (
    <>
      <rect x="2.5" y="3.5" width="15" height="11" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3 14 8 7l3 4 2-2 4 5" fill="currentColor" opacity="0.5" />
    </>
  ),
  coast: <path d="M1 12c2-2 4 0 6-2s3-4 6-3 4-2 6-2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />,
  grid: <path d="M7 2v14M13 2v14M2 6.5h16M2 11.5h16" fill="none" stroke="currentColor" strokeWidth="1" />,
  inset: <rect x="2.5" y="3.5" width="15" height="11" fill="none" stroke="currentColor" strokeWidth="2" />,
};

/** A badge on the key's pins, in its slot: the lock, level and pies top right, the arch top left, the count bottom right. */
function BadgeMark({ badge }: { readonly badge: NonNullable<Extract<DrawerIcon, { kind: 'pin' }>['badge']> }) {
  const tr = { x: 19.4, y: 4 };
  const disc = (x: number, y: number) => <circle cx={x} cy={y} r={3.8} className="frl-mapdrawer__badge" />;
  switch (badge) {
    case 'lock':
      return (
        <g>
          {disc(tr.x, tr.y)}
          <rect x={tr.x - 1.8} y={tr.y - 0.4} width={3.6} height={2.4} fill="currentColor" />
          <path d={`M${String(tr.x - 1.1)} ${String(tr.y - 0.4)}v-0.8a1.1 1.1 0 0 1 2.2 0v0.8`} fill="none" stroke="currentColor" strokeWidth={0.8} />
        </g>
      );
    case 'level':
      return (
        <g>
          <rect x={tr.x - 4.2} y={tr.y - 3.4} width={8.4} height={6.8} rx={3.4} className="frl-mapdrawer__badge" />
          <text x={tr.x} y={tr.y + 1.9} fontSize="5.4" fontWeight="700" textAnchor="middle" fill="currentColor">
            16
          </text>
        </g>
      );
    case 'pie':
    case 'pie-unknown':
      return (
        <g>
          {disc(tr.x, tr.y)}
          <circle cx={tr.x} cy={tr.y} r={2.2} fill="none" stroke="currentColor" strokeWidth={0.8} strokeDasharray={badge === 'pie-unknown' ? '1 0.8' : undefined} />
          {badge === 'pie' && <path d={`M${String(tr.x)} ${String(tr.y)}V${String(tr.y - 2.2)}A2.2 2.2 0 0 1 ${String(tr.x + 2.2)} ${String(tr.y)}z`} fill="currentColor" />}
        </g>
      );
    case 'arch':
      return (
        <g>
          {disc(4.6, 4)}
          <path d="M2.9 6V4.2a1.7 1.7 0 0 1 3.4 0V6h-1.1V4.5a0.6 0.6 0 0 0-1.2 0V6z" fill="currentColor" />
        </g>
      );
    case 'count':
      return (
        <g>
          <rect x={14} y={15.4} width={10} height={7} rx={3.5} className="frl-mapdrawer__badge" />
          <text x={19} y={20.6} fontSize="5.2" fontWeight="700" textAnchor="middle" fill="currentColor">
            ×12
          </text>
        </g>
      );
    case 'position':
      return (
        <g>
          {disc(4.6, 19)}
          <circle cx={4.6} cy={19} r={2.3} fill="none" stroke="currentColor" strokeWidth={0.9} strokeDasharray="1.2 0.9" />
        </g>
      );
    case 'faction':
      return (
        <g>
          {disc(tr.x, tr.y)}
          <text x={tr.x} y={tr.y + 1.9} fontSize="5.4" fontWeight="700" textAnchor="middle" fill="currentColor">
            A
          </text>
        </g>
      );
  }
}

/** A row's icon as an inline SVG in `currentColor` (so forced colours keep it), hidden from assistive technology: the name says it. */
export function DrawerIconView({ icon }: { readonly icon: DrawerIcon }) {
  if (icon.kind === 'swatch') {
    return (
      <svg className="frl-mapdrawer__icon" viewBox="0 0 20 18" width={20} height={18} aria-hidden="true" focusable="false" data-swatch={icon.swatch}>
        {SWATCHES[icon.swatch]}
      </svg>
    );
  }
  // A small teardrop in the pin's family: the glyph in the map's own paths, in monochrome (§25.3.2:
  // a difficulty colour in the key would read as the category's colour).
  const dash = icon.edge === 'dashed' ? '2.2 1.6' : undefined;
  return (
    <svg className={cx('frl-mapdrawer__icon', 'frl-mapdrawer__pin', icon.light === true && 'is-light')} viewBox="0 0 24 30" width={16} height={20} aria-hidden="true" focusable="false" data-glyph={icon.glyph}>
      <path className="frl-mapdrawer__pin-body" d="M12 29 4.1 17.1A9.6 9.6 0 1 1 19.9 17.1z" strokeWidth="1.4" strokeDasharray={dash} />
      {icon.edge === 'double' && <circle cx="12" cy="11.4" r="7.2" fill="none" stroke="currentColor" strokeWidth="0.9" />}
      <g className="frl-mapdrawer__pin-glyph" transform="translate(4.5 3.9) scale(0.625)">
        <GlyphParts glyph={MARK_GLYPHS[icon.glyph]} hollow={icon.hollow === true} />
      </g>
      {icon.struck === true && <path d="M6 17 18 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
      {icon.badge !== undefined && <BadgeMark badge={icon.badge} />}
    </svg>
  );
}

// =============================================================================================
// A group: one stop, a roving tabindex over its box and its rows

function GroupView({
  group,
  onRow,
  onGroup,
  onCollapse,
}: {
  readonly group: DrawerGroup;
  readonly onRow: (id: string, show: boolean) => void;
  readonly onGroup: (id: MapCategoryGroupId, show: boolean) => void;
  readonly onCollapse: (id: MapCategoryGroupId, collapsed: boolean) => void;
}) {
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const titleId = `${baseId}-title`;
  const rowsId = `${baseId}-rows`;

  const items = (): HTMLInputElement[] => [...(rootRef.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-roving]') ?? [])];

  // Keep exactly one tab stop in the group (items appear and go with the collapse).
  useLayoutEffect(() => {
    const list = items();
    const index = Math.min(active, list.length - 1);
    list.forEach((item, i) => {
      item.tabIndex = i === index ? 0 : -1;
    });
  });

  const focusAt = (index: number): void => {
    const list = items();
    const item = list[Math.max(0, Math.min(list.length - 1, index))];
    if (item === undefined) return;
    setActive(list.indexOf(item));
    item.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const list = items();
    const current = list.findIndex((item) => item === event.target);
    if (current < 0) return;
    const onHeading = current === 0;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusAt(current + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(current - 1);
        return;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        return;
      case 'End':
        event.preventDefault();
        focusAt(list.length - 1);
        return;
      case 'Enter':
        if (!onHeading) return;
        event.preventDefault();
        onCollapse(group.id, !group.collapsed);
        return;
      case 'ArrowLeft':
        if (!onHeading) return;
        event.preventDefault();
        onCollapse(group.id, true);
        return;
      case 'ArrowRight':
        if (!onHeading) return;
        event.preventDefault();
        onCollapse(group.id, false);
        return;
      default:
        return;
    }
  };

  return (
    <div
      ref={rootRef}
      className={cx('frl-mapdrawer__group', group.collapsed && 'is-collapsed')}
      role="group"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        const index = items().findIndex((item) => item === event.target);
        if (index >= 0 && index !== active) setActive(index);
      }}
    >
      <div className="frl-mapdrawer__heading">
        <span id={titleId} className="frl-visually-hidden">
          {group.subtitle === null ? group.title : `${group.title}, ${group.subtitle}`}
        </span>
        <GroupBox group={group} onGroup={onGroup} />
        {group.subtitle !== null && <span className="frl-mapdrawer__subtitle">{group.subtitle}</span>}
        <IconButton
          icon="chevron-down"
          size="sm"
          label={`${group.collapsed ? 'Expand' : 'Collapse'} ${group.title}`}
          className={cx('frl-mapdrawer__collapse', group.collapsed && 'is-collapsed')}
          tabIndex={-1}
          aria-expanded={!group.collapsed}
          aria-controls={rowsId}
          onClick={() => {
            onCollapse(group.id, !group.collapsed);
          }}
        />
      </div>
      {!group.collapsed && (
        <ul className="frl-mapdrawer__rows" id={rowsId}>
          {group.rows.map((row) => (
            <RowView key={row.id} row={row} onRow={onRow} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** A group's own box: checked, unchecked or mixed (the kit's Checkbox). */
function GroupBox({ group, onGroup }: { readonly group: DrawerGroup; readonly onGroup: (id: MapCategoryGroupId, show: boolean) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  // The kit's box is the roving item: mark it once rendered.
  useLayoutEffect(() => {
    ref.current?.querySelector('input')?.setAttribute('data-roving', '');
  });
  return (
    <span ref={ref} className="frl-mapdrawer__group-box">
      <Checkbox
        label={group.title}
        checked={group.state}
        onChange={(checked) => {
          onGroup(group.id, checked);
        }}
      />
    </span>
  );
}

/**
 * A row. One that cannot be used now is `aria-disabled`, not disabled (UI.md §9 rule 6): it stays in
 * the group's arrow order, its reason is its description, and a press does nothing.
 */
function RowView({ row, onRow }: { readonly row: DrawerRow; readonly onRow: (id: string, show: boolean) => void }) {
  const noteId = useId();
  const [open, setOpen] = useState(false);
  const lines = row.unavailable === null ? row.notes : [row.unavailable, ...row.notes];
  const described = lines.length > 0;
  const unavailable = row.unavailable !== null;
  const shown = !unavailable && row.shown;
  return (
    <li className={cx('frl-mapdrawer__row', !unavailable && !row.shown && 'is-hidden', unavailable && 'is-unavailable')}>
      <label className="frl-mapdrawer__label" title={row.title ?? undefined}>
        <span className="frl-mapdrawer__box">
          <input
            type="checkbox"
            data-roving=""
            checked={shown}
            aria-disabled={unavailable ? true : undefined}
            aria-label={row.name}
            aria-describedby={described ? noteId : undefined}
            onClick={(event) => {
              if (unavailable) event.preventDefault();
            }}
            onChange={(event) => {
              if (!unavailable) onRow(row.id, event.currentTarget.checked);
            }}
          />
        </span>
        <DrawerIconView icon={row.icon} />
        <span className="frl-mapdrawer__name">{row.label}</span>
        {row.count !== null && <span className="frl-mapdrawer__count frl-num">{row.count}</span>}
      </label>
      {described && (
        <>
          {/* The whole notes (MAP-HONEST-5): the box's description, always read with it. */}
          <ul className="frl-visually-hidden" id={noteId}>
            {lines.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          {/*
           * Shown: one muted line, the leading caveat or count, with how many more (review PR-09;
           * §25.3.3). The rest opens under it while the row's box has keyboard focus, on a press of
           * the line, and in its tooltip; the key at the foot holds the general rules.
           */}
          <div
            className={cx('frl-mapdrawer__notes', open && 'is-open')}
            aria-hidden="true"
            title={lines.join('\n')}
            onClick={() => {
              setOpen((was) => !was);
            }}
          >
            <p className="frl-mapdrawer__note-line">
              <span className="frl-mapdrawer__note-first">{lines[0]}</span>
              {lines.length > 1 && <span className="frl-mapdrawer__note-more">{`+${String(lines.length - 1)} more`}</span>}
            </p>
            <ul className="frl-mapdrawer__note-all">
              {lines.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </li>
  );
}

// =============================================================================================
// The search's results: a list of buttons with a roving tabindex

function Results({ search, fieldRef }: { readonly search: DrawerSearch; readonly fieldRef: RefObject<HTMLInputElement | null> }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const results = search.results;
  const buttons = (): HTMLButtonElement[] => [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('.frl-mapdrawer__result') ?? [])];
  useLayoutEffect(() => {
    const list = buttons();
    const focused = list.findIndex((button) => button === button.ownerDocument.activeElement);
    list.forEach((button, i) => {
      button.tabIndex = i === Math.max(0, focused) ? 0 : -1;
    });
  });
  if (results === null) return null;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const list = buttons();
    const current = list.findIndex((button) => button === event.target);
    if (current < 0) return;
    const move = (index: number): void => {
      const next = list[index];
      if (next === undefined) return;
      event.preventDefault();
      list.forEach((button, i) => {
        button.tabIndex = i === index ? 0 : -1;
      });
      next.focus();
    };
    if (event.key === 'ArrowDown') move(Math.min(list.length - 1, current + 1));
    else if (event.key === 'ArrowUp') {
      if (current === 0) {
        event.preventDefault();
        fieldRef.current?.focus();
      } else move(current - 1);
    } else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(list.length - 1);
  };
  return (
    <div ref={rootRef} className="frl-mapdrawer__results" onKeyDown={onKeyDown}>
      <p className="frl-mapdrawer__summary">{results.summary}</p>
      {results.groups.map((group) => (
        <section key={group.title} className="frl-mapdrawer__result-group" aria-label={group.title}>
          <h4 className="frl-mapdrawer__result-title">{group.title}</h4>
          <ul className="frl-mapdrawer__result-list">
            {group.results.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  className="frl-mapdrawer__result"
                  onClick={() => {
                    search.onChoose(result.id);
                  }}
                >
                  <DrawerIconView icon={result.icon} />
                  <span className="frl-mapdrawer__result-text">
                    <span className="frl-mapdrawer__result-name">{result.name}</span>
                    <span className="frl-mapdrawer__result-line">{result.line}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {results.more !== null && <p className="frl-mapdrawer__more">{results.more}</p>}
    </div>
  );
}

// =============================================================================================
// The drawer

export function MapCategoryDrawer({ id, docked, style, notices, groups, onRow, onGroup, onCollapse, onShowAll, onHideAll, onDefaults, search, onClose, keyContent }: MapCategoryDrawerProps) {
  const titleId = useId();
  const styleNoteId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const searching = search.results !== null;
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Escape' || docked) return;
    // The field's own Escape clears its text first (the kit's field stops that one).
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  return (
    <section className={cx('frl-mapdrawer', docked ? 'is-docked' : 'is-over')} role="region" aria-labelledby={titleId} onKeyDown={onKeyDown} data-drawer-id={id}>
      <header className="frl-mapdrawer__head">
        <h2 id={titleId} className="frl-mapdrawer__title">
          Map layers
        </h2>
        {!docked && <IconButton icon="close" size="sm" label="Close Map layers" onClick={onClose} />}
      </header>
      <div className="frl-mapdrawer__body">
        <div className="frl-mapdrawer__style">
          <span className="frl-mapdrawer__style-label" aria-hidden="true">
            Map style
          </span>
          <SegmentedControl legend="Map style" options={style.options} value={style.value} onChange={style.onChange} describedBy={style.note === null ? undefined : styleNoteId} />
        </div>
        {style.note !== null && (
          <p id={styleNoteId} className="frl-mapdrawer__note">
            {style.note}
          </p>
        )}
        {notices.length > 0 && (
          <ul className="frl-mapdrawer__notices">
            {notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        )}
        <div
          className="frl-mapdrawer__search"
          onFocusCapture={() => {
            search.onFocus();
          }}
        >
          <SearchField
            label="Search the map"
            placeholder="Search quests, places, NPCs"
            size="sm"
            value={search.query}
            onChange={search.onQuery}
            inputRef={fieldRef}
            onArrowDown={() => {
              fieldRef.current?.closest('.frl-mapdrawer')?.querySelector<HTMLButtonElement>('.frl-mapdrawer__result')?.focus();
            }}
          />
        </div>
        <p className="frl-visually-hidden" role="status">
          {search.status}
        </p>
        {searching ? (
          <>
            <Toolbar label="Search results" className="frl-mapdrawer__toolbar">
              <Button size="sm" onClick={search.onFit}>
                Fit results on the map
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  search.onQuery('');
                  fieldRef.current?.focus();
                }}
              >
                Clear search
              </Button>
            </Toolbar>
            <Results search={search} fieldRef={fieldRef} />
          </>
        ) : (
          <>
            <Toolbar label="All map categories" className="frl-mapdrawer__toolbar">
              <Button size="sm" aria-label="Show all map categories" onClick={onShowAll}>
                Show all
              </Button>
              <Button size="sm" aria-label="Hide all map categories" onClick={onHideAll}>
                Hide all
              </Button>
              <Button size="sm" aria-label="Restore the default map categories" onClick={onDefaults}>
                Defaults
              </Button>
            </Toolbar>
            {groups.map((group) => (
              <GroupView key={group.id} group={group} onRow={onRow} onGroup={onGroup} onCollapse={onCollapse} />
            ))}
          </>
        )}
        <details className="frl-mapdrawer__key">
          <summary>Key</summary>
          {keyContent}
        </details>
      </div>
    </section>
  );
}
