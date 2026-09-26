import { type KeyboardEvent, type ReactNode, type Ref, useId, useState } from 'react';
import type { IssueSeverity } from '../../domain/issues';
import type { Difficulty } from '../../rules/difficulty';
import { cx } from '../lib/cx';
import { formatInteger } from '../lib/format';
import { SEVERITY_LABELS } from '../lib/issues';
import { PlaceholderTag } from '../primitives/Badge';
import { IconButton } from '../primitives/IconButton';
import { DifficultyLabel } from '../markers/DifficultyLabel';
import { ProvenanceBadge } from '../markers/ProvenanceBadge';
import { SeverityIcon } from '../markers/SeverityIcon';
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

export interface DetailItem {
  readonly term: string;
  readonly value: ReactNode;
}

/** Term/value pairs for the Details tab. */
export function DetailList({ items }: { readonly items: readonly DetailItem[] }) {
  return (
    <dl className="frl-details">
      {items.map((item) => (
        <div key={item.term} className="frl-details__row">
          <dt>{item.term}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface IssueListItem {
  readonly key: string;
  readonly severity: IssueSeverity;
  /** Registry code, e.g. `VAL004-min-level`. */
  readonly code: string;
  readonly message: string;
  /** Step number to jump to, or null for route-level issues (and issues of a step no longer in the route). */
  readonly stepNumber: number | null;
  /** What the code means (the registry's explanation), shown under the issue; null or omitted: none. */
  readonly explanation?: string | null | undefined;
  /** Where an issue without a step number is, in words: "Route" (the default), "A step no longer in the route". */
  readonly where?: string | undefined;
}

export interface IssueListProps {
  readonly items: readonly IssueListItem[];
  /**
   * Makes each issue with a step number a button (jump to its step). The buttons are one tab stop:
   * ↑ ↓ Home End move between them, Enter or Space jumps (docs/UI.md §9 rule 4).
   */
  readonly onSelect?: ((key: string) => void) | undefined;
  readonly emptyText?: string | undefined;
  /** The list's accessible name. */
  readonly label?: string | undefined;
  /** The list element (focusable, `tabIndex` -1), for moving focus to it. */
  readonly listRef?: Ref<HTMLUListElement> | undefined;
}

/** The spoken name of an issue that jumps to its step: `Error, step 12: … (VAL004-min-level)`. */
export function describeIssue(item: Pick<IssueListItem, 'severity' | 'code' | 'message' | 'stepNumber' | 'where'>): string {
  const where = item.stepNumber === null ? (item.where ?? 'Route') : `step ${formatInteger(item.stepNumber)}`;
  return `${SEVERITY_LABELS[item.severity]}, ${where}: ${item.message} (${item.code})`;
}

const JUMP_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

/**
 * Validation issues: severity shape and word, message, code, where (the step, or the route) and,
 * when given, what the code means. Never colour alone. With `onSelect`, issues about a step are
 * buttons that jump to it, as one composite: the tab stop is the last issue used, the arrow keys
 * move between issues, and route-level issues (no step to jump to) are plain text between them.
 */
export function IssueList({ items, onSelect, emptyText = 'No issues.', label = 'Issues', listRef }: IssueListProps) {
  const [current, setCurrent] = useState<string | null>(null);
  const baseId = useId();
  if (items.length === 0) return <p className="frl-issues__empty">{emptyText}</p>;
  const actionable = onSelect === undefined ? [] : items.filter((item) => item.stepNumber !== null);
  const tabStop = actionable.find((item) => item.key === current)?.key ?? actionable[0]?.key ?? null;

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!JUMP_KEYS.has(event.key) || actionable.length === 0) return;
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-issue-key]') : null;
    const at = target === null ? -1 : actionable.findIndex((item) => item.key === target.dataset.issueKey);
    if (at < 0) return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? actionable.length - 1 : Math.min(actionable.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)));
    event.preventDefault();
    const key = actionable[next]?.key;
    if (key === undefined) return;
    setCurrent(key);
    Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-issue-key]'))
      .find((element) => element.dataset.issueKey === key)
      ?.focus();
  };

  return (
    <ul className="frl-issues" aria-label={label} ref={listRef} tabIndex={-1} onKeyDown={onKeyDown}>
      {items.map((item, index) => {
        const explanationId = `${baseId}-explanation-${String(index)}`;
        const where = item.stepNumber === null ? (item.where ?? 'Route') : `Step ${formatInteger(item.stepNumber)}`;
        const body = (
          <>
            <span className="frl-issues__severity">
              <SeverityIcon severity={item.severity} labelled={false} />
              <span>{SEVERITY_LABELS[item.severity]}</span>
            </span>{' '}
            <span className="frl-issues__message">{item.message}</span>{' '}
            <span className="frl-issues__meta">
              <span>{where}</span> <code>{item.code}</code>
            </span>
          </>
        );
        const explanation =
          item.explanation === undefined || item.explanation === null ? null : (
            <p id={explanationId} className="frl-issues__explanation">
              {item.explanation}
            </p>
          );
        return (
          <li key={item.key} className={cx('frl-issues__item', `frl-issues__item--${item.severity}`)} data-severity={item.severity}>
            {onSelect === undefined || item.stepNumber === null ? (
              <div className="frl-issues__body">{body}</div>
            ) : (
              <button
                type="button"
                className="frl-issues__body"
                data-issue-key={item.key}
                tabIndex={item.key === tabStop ? 0 : -1}
                aria-label={describeIssue(item)}
                aria-describedby={explanation === null ? undefined : explanationId}
                onFocus={() => {
                  setCurrent(item.key);
                }}
                onClick={() => {
                  setCurrent(item.key);
                  onSelect(item.key);
                }}
              >
                {body}
              </button>
            )}
            {explanation}
          </li>
        );
      })}
    </ul>
  );
}

export interface QuestListItemProps {
  readonly name: string;
  readonly level: number | null;
  readonly difficulty: Difficulty | null;
  readonly uncertain?: boolean | undefined;
  readonly provenance: ForeverProvenance;
  /** Secondary line: zone, starter. */
  readonly detail: string | null;
  readonly onAdd?: (() => void) | undefined;
  readonly addLabel?: string | undefined;
  /** Opens the quest in Details (and so puts it in focus on the map). */
  readonly onOpen?: (() => void) | undefined;
  readonly openLabel?: string | undefined;
}

/** One quest in the Available or Quest log lists. Render inside a `<ul>`. */
export function QuestListItem({
  name,
  level,
  difficulty,
  uncertain = false,
  provenance,
  detail,
  onAdd,
  addLabel = 'Add to route',
  onOpen,
  openLabel = 'Show in Details',
}: QuestListItemProps) {
  return (
    <li className="frl-quest-item">
      <DifficultyLabel level={level} difficulty={difficulty} uncertain={uncertain} />
      <span className="frl-quest-item__text">
        <span className="frl-quest-item__name">
          <span className="frl-quest-item__label" title={name}>
            {name}
          </span>
          <ProvenanceBadge provenance={provenance} className="frl-quest-item__provenance" />
        </span>
        {detail !== null && <span className="frl-quest-item__detail">{detail}</span>}
      </span>
      {onOpen !== undefined && <IconButton icon="about" label={`${openLabel}: ${name}`} size="sm" onClick={onOpen} />}
      {onAdd !== undefined && <IconButton icon="add" label={`${addLabel}: ${name}`} size="sm" onClick={onAdd} />}
    </li>
  );
}
