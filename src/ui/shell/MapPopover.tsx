import { useEffect, useId, useRef, type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { Difficulty } from '../../rules/difficulty';
import { cx } from '../lib/cx';
import { AssumedMarker, type AssumedReason } from '../markers/AssumedMarker';
import { DifficultyLabel } from '../markers/DifficultyLabel';
import { ProvenanceBadge } from '../markers/ProvenanceBadge';
import type { ForeverProvenance } from '../markers/provenance';
import { Button } from '../primitives/Button';
import { EXTERNAL_LINK_TEXT, ExternalLink } from '../primitives/ExternalLink';
import { IconButton } from '../primitives/IconButton';
import './MapPopover.css';

/**
 * The map popover (docs/research/map-presentation.md §14.2; docs/UI.md §9 rule 15; D-041 J; step
 * MP.6): what a click on a pin, a stack or a point of the map offers, beside the point. Presentational:
 * the container (`src/ui/app/MapPopoverPanel.tsx`, a lazy part) builds the sections from the map's
 * target and runs the actions.
 *
 * Keyboard contract (UI.md §9 rule 15): a non-modal `dialog` (`aria-modal="false"`) named after its
 * subject; opening it moves focus to its first action; its actions, the Wowhead link included, are
 * one list (Up and Down move, Home and End jump, Enter or Space activates); Tab and Shift+Tab leave
 * it and close it; Escape, or a press outside it, closes it; Escape gives focus back to the map. It
 * announces nothing on opening: its name is read with the focus.
 */

export interface MapPopoverQuestView {
  readonly level: number | null;
  readonly difficulty: Difficulty | null;
  readonly lowerBound: boolean;
  /** "450 XP" and its basis marker; null when the dataset has none. */
  readonly xp: { readonly text: string; readonly basis: AssumedReason | null; readonly detail: string } | null;
  readonly provenance: ForeverProvenance | null;
}

export interface MapPopoverActionView {
  readonly key: string;
  readonly label: string;
  /** The accessible name when the label alone does not say which item it acts on ("Accept Isha Awak after step 28"; review QA-18); omitted: the label. */
  readonly name?: string | undefined;
  readonly variant: 'primary' | 'default' | 'external';
  /** Why it cannot run now (rendered `aria-disabled`, with this as its description); null when it can. */
  readonly unavailable: string | null;
  /** An external link's address (`variant` `external`). */
  readonly href?: string | undefined;
}

export interface MapPopoverSectionView {
  readonly key: string;
  readonly heading: string;
  readonly quest: MapPopoverQuestView | null;
  readonly lines: readonly string[];
  readonly actions: readonly MapPopoverActionView[];
}

export interface MapPopoverProps {
  /** Changes with every click, so the popover moves focus to its first action again. */
  readonly openKey: number;
  readonly title: string;
  readonly sections: readonly MapPopoverSectionView[];
  readonly footer: readonly MapPopoverActionView[];
  /** The point in stage pixels with the stage's size; null to place it at the top left. */
  readonly at: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
  readonly onAction: (key: string) => void;
  /** Closes it: `escape` also gives focus back to the map; `outside` and `tab` leave focus where it went. */
  readonly onClose: (how: 'escape' | 'outside' | 'tab') => void;
  /** Where a press does not count as outside (the map's stage: the map closes the popover itself on its own click). */
  readonly insideOf?: (() => HTMLElement | null) | undefined;
}

/** The popover's width in pixels (MapPopover.css), for keeping it inside the stage. */
export const MAP_POPOVER_WIDTH = 320;

/** The popover's tallest (MapPopover.css), and the gap it keeps to the stage's edges. */
export const MAP_POPOVER_MAX_HEIGHT = 520;
const EDGE = 8;

/**
 * Where the popover goes: beside the point, inside the stage, below the point in the upper half and
 * above it in the lower half, and never taller than the room on that side (review PR-07): its body
 * scrolls instead, so the last action is never past the stage's edge.
 */
export function mapPopoverPosition(at: MapPopoverProps['at']): CSSProperties {
  if (at === null) return { left: EDGE, top: EDGE };
  const left = Math.max(EDGE, Math.min(at.x + 14, at.width - MAP_POPOVER_WIDTH - EDGE));
  if (at.y <= at.height / 2) {
    const top = Math.max(EDGE, at.y + 14);
    return { left, top, maxHeight: Math.max(120, Math.min(MAP_POPOVER_MAX_HEIGHT, at.height - top - EDGE)) };
  }
  const bottom = Math.max(EDGE, at.height - at.y + 14);
  return { left, bottom, maxHeight: Math.max(120, Math.min(MAP_POPOVER_MAX_HEIGHT, at.height - bottom - EDGE)) };
}

/** Wowhead's page is the Era quest's (D-041 J): said beside the link, not only in its tooltip (review PR-21). */
export const WOWHEAD_ERA_CAVEAT = "Wowhead describes the Era quest; Forever's changes may not be there";

const ACTION_SELECTOR = '[data-popover-action]';

function Action({ action, onAction, first, reasonId }: { readonly action: MapPopoverActionView; readonly onAction: (key: string) => void; readonly first: boolean; readonly reasonId: string }): ReactNode {
  const unavailable = action.unavailable !== null;
  if (action.variant === 'external' && action.href !== undefined) {
    return (
      <li className="frl-map-popover__action">
        <ExternalLink
          href={action.href}
          className="frl-map-popover__link"
          title={WOWHEAD_ERA_CAVEAT}
          aria-label={action.name === undefined ? undefined : `${action.name} ${EXTERNAL_LINK_TEXT}`}
          aria-describedby={reasonId}
          data-popover-action=""
          tabIndex={first ? 0 : -1}
        >
          {action.label}
        </ExternalLink>
        <span id={reasonId} className="frl-map-popover__caveat">
          (Era page)
          <span className="frl-visually-hidden">{`: ${WOWHEAD_ERA_CAVEAT}`}</span>
        </span>
      </li>
    );
  }
  return (
    <li className="frl-map-popover__action">
      <Button
        size="sm"
        variant={action.variant === 'primary' ? 'primary' : 'default'}
        aria-label={action.name}
        data-popover-action=""
        tabIndex={first ? 0 : -1}
        aria-disabled={unavailable ? true : undefined}
        aria-describedby={unavailable ? reasonId : undefined}
        title={action.unavailable ?? undefined}
        onClick={() => {
          if (!unavailable) onAction(action.key);
        }}
      >
        {action.label}
      </Button>
      {unavailable && (
        <span id={reasonId} hidden>
          {action.unavailable}
        </span>
      )}
    </li>
  );
}

export function MapPopover({ openKey, title, sections, footer, at, onAction, onClose, insideOf }: MapPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;

  // Opening (and every new click) moves focus to the first available action (else the first; QA-04),
  // which is the list's tab stop.
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const actions = [...root.querySelectorAll<HTMLElement>(ACTION_SELECTOR)];
    const first = Math.max(0, actions.findIndex((element) => element.getAttribute('aria-disabled') !== 'true'));
    actions.forEach((element, index) => {
      element.tabIndex = index === first ? 0 : -1;
    });
    actions[first]?.focus();
  }, [openKey]);

  // A press outside closes it (the map's own clicks close it through the map).
  useEffect(() => {
    const root = rootRef.current;
    const doc = root?.ownerDocument;
    if (root === null || doc === undefined) return undefined;
    const onPointerDown = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node) || root.contains(target)) return;
      if (insideOf?.()?.contains(target) === true) return;
      onClose('outside');
    };
    doc.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      doc.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onClose, insideOf]);

  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const root = rootRef.current;
    if (root === null) return;
    const actions = [...root.querySelectorAll<HTMLElement>(ACTION_SELECTOR)];
    const current = actions.findIndex((element) => element === event.target);
    const last = actions.length - 1;
    if (last < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? last : event.key === 'ArrowDown' ? (current < 0 ? 0 : Math.min(last, current + 1)) : Math.max(0, current - 1);
    actions.forEach((element, index) => {
      element.tabIndex = index === next ? 0 : -1;
    });
    actions[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose('escape');
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      move(event);
      return;
    }
    // Space activates a link as Enter does (a button does both natively).
    if (event.key === ' ' && event.target instanceof HTMLAnchorElement) {
      event.preventDefault();
      event.target.click();
    }
  };

  // Tab and Shift+Tab leave it and close it: focus has gone to an element outside.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && rootRef.current !== null && !rootRef.current.contains(next)) onClose('tab');
  };

  // The list's one tab stop: its first available action, else its first (the effect keeps it so as
  // focus moves); an unavailable one never takes the first focus while another can act (QA-04).
  const listed = [...sections.flatMap((section) => section.actions), ...footer];
  const firstKey = (listed.find((action) => action.unavailable === null) ?? listed[0])?.key ?? null;
  const renderActions = (list: readonly MapPopoverActionView[], owner: string): ReactNode => (
    <ul className="frl-map-popover__actions" aria-label={`Actions: ${owner}`}>
      {list.map((action) => (
        <Action key={action.key} action={action} onAction={onAction} first={action.key === firstKey} reasonId={`${baseId}-${action.key}-reason`} />
      ))}
    </ul>
  );

  return (
    <div
      ref={rootRef}
      className="frl-map-popover"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      style={mapPopoverPosition(at)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <div className="frl-map-popover__head">
        <h2 id={titleId} className="frl-map-popover__title">
          {title}
        </h2>
        <IconButton
          icon="close"
          size="sm"
          label="Close"
          tabIndex={-1}
          onClick={() => {
            onClose('escape');
          }}
        />
      </div>
      <div className="frl-map-popover__body">
        {sections.map((section) => (
          <section key={section.key} className="frl-map-popover__section" aria-label={section.heading}>
            <h3 className="frl-map-popover__heading">
              <span className="frl-map-popover__name">{section.heading}</span>
              {section.quest !== null && (
                <span className={cx('frl-map-popover__chips')}>
                  <DifficultyLabel level={section.quest.level} difficulty={section.quest.difficulty} uncertain={section.quest.lowerBound} />
                  {section.quest.provenance !== null && <ProvenanceBadge provenance={section.quest.provenance} />}
                </span>
              )}
            </h3>
            {section.quest !== null && section.quest.xp !== null && (
              <p className="frl-map-popover__line">
                {section.quest.xp.text}
                {section.quest.xp.basis !== null && <AssumedMarker reason={section.quest.xp.basis} detail={section.quest.xp.detail} />}
              </p>
            )}
            {section.lines.map((line) => (
              <p key={line} className="frl-map-popover__line">
                {line}
              </p>
            ))}
            {section.actions.length > 0 && renderActions(section.actions, section.heading)}
          </section>
        ))}
        {footer.length > 0 && <div className="frl-map-popover__footer">{renderActions(footer, title)}</div>}
      </div>
    </div>
  );
}
