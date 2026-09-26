import type { ReactNode } from 'react';
import type { IssueSeverity } from '../../domain/issues';
import type { Difficulty } from '../../rules/difficulty';
import { cx } from '../lib/cx';
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
  /** Step number to jump to, or null for route-level issues. */
  readonly stepNumber: number | null;
}

export interface IssueListProps {
  readonly items: readonly IssueListItem[];
  /** Makes each issue a button (jump to its step). */
  readonly onSelect?: ((key: string) => void) | undefined;
  readonly emptyText?: string | undefined;
}

/** Validation issues: severity icon and word, message, code and step. Never colour alone. */
export function IssueList({ items, onSelect, emptyText = 'No issues.' }: IssueListProps) {
  if (items.length === 0) return <p className="frl-issues__empty">{emptyText}</p>;
  return (
    <ul className="frl-issues">
      {items.map((item) => {
        const body = (
          <>
            <span className="frl-issues__severity">
              <SeverityIcon severity={item.severity} labelled={false} />
              <span>{SEVERITY_LABELS[item.severity]}</span>
            </span>
            <span className="frl-issues__message">{item.message}</span>
            <span className="frl-issues__meta">
              <code>{item.code}</code>
              {item.stepNumber !== null && <span>Step {item.stepNumber}</span>}
            </span>
          </>
        );
        return (
          <li key={item.key} className={cx('frl-issues__item', `frl-issues__item--${item.severity}`)} data-severity={item.severity}>
            {onSelect === undefined ? (
              <div className="frl-issues__body">{body}</div>
            ) : (
              <button
                type="button"
                className="frl-issues__body"
                onClick={() => {
                  onSelect(item.key);
                }}
              >
                {body}
              </button>
            )}
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
