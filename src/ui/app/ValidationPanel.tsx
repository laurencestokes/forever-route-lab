import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type DerivedState, type EditorStore, provisionalNote } from '../../app';
import { issueExplanation } from '../../app/issue-codes';
import { useDerivedSelector } from '../../app/react';
import type { IssueSeverity, ValidationIssue } from '../../domain/issues';
import type { RouteView } from '../app-model';
import {
  Button,
  describeIssueCounts,
  EmptyState,
  formatInteger,
  IssueList,
  type IssueListItem,
  PanelSection,
  plural,
  Select,
  SEVERITY_LABELS,
  SeverityIcon,
  totalIssues,
} from '../kit';
import { noResultsReason, validationCounts } from './derived-view';
import type { Announce } from './LiveAnnouncer';
import { sameResultsView, selectDerived } from './selectors';
import './Validation.css';

/**
 * The Validation tab (docs/UI.md §16; ARCHITECTURE §9.4): the issues the validator found in the
 * latest walk, route-level ones first and then by step, with counts by severity, a severity filter
 * and pages of 100. Each issue says its severity (shape and word), its message, its code, where it
 * is and what the code means (the registry, src/validate/codes.ts, through src/app/issue-codes.ts).
 * Choosing an issue about a step selects that step and puts keyboard focus on it in the route list;
 * the map follows the active step.
 *
 * It loads on first use with the other lazy parts (lazy.tsx), which keeps the registry out of the
 * entry chunk. It never claims "no issues" while the route has not been checked.
 */

export type SeverityFilter = 'all' | 'problems' | IssueSeverity;

const FILTERS: readonly SeverityFilter[] = ['all', 'problems', 'error', 'warning', 'info'];

const isFilter = (value: string): value is SeverityFilter => (FILTERS as readonly string[]).includes(value);

/** Issues shown per page. */
export const VALIDATION_PAGE = 100;

function matches(filter: SeverityFilter, severity: IssueSeverity): boolean {
  if (filter === 'all') return true;
  if (filter === 'problems') return severity !== 'info';
  return severity === filter;
}

/** What the live region says after the filter changes: the count now shown. */
export function filterMessage(filter: SeverityFilter, shown: number): string {
  switch (filter) {
    case 'all':
      return `Showing all ${plural(shown, 'issue')}.`;
    case 'problems':
      return `Showing ${plural(shown, 'error or warning', 'errors and warnings')}.`;
    case 'error':
      return `Showing ${plural(shown, 'error')}.`;
    case 'warning':
      return `Showing ${plural(shown, 'warning')}.`;
    case 'info':
      return `Showing ${plural(shown, 'info issue')}.`;
  }
}

/** The registry's explanations, looked up once per code. */
const explanations = new Map<string, string | null>();
function explanationOf(code: string): string | null {
  let text = explanations.get(code);
  if (text === undefined) {
    text = issueExplanation(code);
    explanations.set(code, text);
  }
  return text;
}

export interface ValidationPanelProps {
  readonly store: EditorStore;
  readonly view: RouteView;
  readonly announce: Announce;
  /** Puts keyboard focus on the route list (after an issue selects its step). */
  readonly onFocusList: () => void;
}

interface Shown {
  readonly issue: ValidationIssue;
  /** The issue's position in the results' list: its key. */
  readonly index: number;
}

/** The Validation tab's content. */
export function ValidationPanel({ store, view, announce, onFocusList }: ValidationPanelProps) {
  const derived = useDerivedSelector(selectDerived, sameResultsView);
  const [filter, setFilter] = useState<SeverityFilter>('all');
  const [limit, setLimit] = useState(VALIDATION_PAGE);
  const listRef = useRef<HTMLUListElement>(null);
  /** The position of the first issue a last "Show more" added, to focus once it is rendered. */
  const focusAfterMore = useRef<number | null>(null);
  const issues = derived?.results?.issues ?? null;
  const counts = validationCounts(derived);

  const shown = useMemo((): readonly Shown[] => {
    if (issues === null) return [];
    const out: Shown[] = [];
    issues.forEach((issue, index) => {
      if (matches(filter, issue.severity)) out.push({ issue, index });
    });
    return out;
  }, [issues, filter]);

  const items = useMemo(
    (): readonly IssueListItem[] =>
      shown.slice(0, limit).map(({ issue, index }): IssueListItem => {
        const number = issue.stepId === null ? undefined : view.numberOfStep.get(issue.stepId);
        return {
          key: String(index),
          severity: issue.severity,
          code: issue.code,
          message: issue.message,
          stepNumber: number ?? null,
          explanation: explanationOf(issue.code),
          where: issue.stepId === null ? 'Route' : 'A step no longer in the route',
        };
      }),
    [shown, limit, view],
  );

  useLayoutEffect(() => {
    const at = focusAfterMore.current;
    if (at === null) return;
    focusAfterMore.current = null;
    const item = listRef.current?.children[at];
    (item?.querySelector<HTMLElement>('button') ?? listRef.current)?.focus();
  });

  if (derived === null || issues === null || counts === null) {
    return (
      <EmptyState title="Not checked yet">
        <p>{`${noResultsReason(derived)}. No issues are reported until the route is checked, and none are claimed to be absent.`}</p>
      </EmptyState>
    );
  }

  const select = (key: string) => {
    const issue = issues[Number(key)];
    const id = issue?.stepId ?? null;
    const number = id === null ? undefined : view.numberOfStep.get(id);
    if (issue === undefined || id === null || number === undefined) return;
    store.select({ kind: 'single', id });
    onFocusList();
    announce(`Showing step ${formatInteger(number)} in the route: ${SEVERITY_LABELS[issue.severity].toLowerCase()} ${issue.code}.`);
  };

  const total = totalIssues(counts);
  const options = [
    { value: 'all', label: `All (${formatInteger(total)})` },
    { value: 'problems', label: `Errors and warnings (${formatInteger(counts.error + counts.warning)})` },
    { value: 'error', label: `Errors (${formatInteger(counts.error)})` },
    { value: 'warning', label: `Warnings (${formatInteger(counts.warning)})` },
    { value: 'info', label: `Info (${formatInteger(counts.info)})` },
  ];
  const pending = provisionalNote(derived);
  const rest = shown.length - items.length;
  return (
    <PanelSection title="Issues" aside={<span className="frl-num">{total === 0 ? 'none' : describeIssueCounts(counts)}</span>} className="frl-app-validation">
      <ValidationNotes state={derived} pending={pending} />
      {total === 0 ? (
        <p className="frl-app-hint">No issues were found in the route.</p>
      ) : (
        <>
          <div className="frl-app-validation__bar">
            <p className="frl-app-validation__counts" aria-hidden="true">
              {(['error', 'warning', 'info'] as const).map((severity) =>
                counts[severity] === 0 ? null : (
                  <span key={severity} className="frl-app-validation__count" data-severity={severity}>
                    <SeverityIcon severity={severity} labelled={false} size={12} />
                    {formatInteger(counts[severity])}
                  </span>
                ),
              )}
            </p>
            <Select
              label="Show"
              size="sm"
              className="frl-app-validation__filter"
              value={filter}
              options={options}
              onChange={(value) => {
                if (!isFilter(value)) return;
                setFilter(value);
                setLimit(VALIDATION_PAGE);
                const count = issues.reduce((n, issue) => (matches(value, issue.severity) ? n + 1 : n), 0);
                announce(filterMessage(value, count));
              }}
            />
          </div>
          <div className="frl-app-validation__list">
            <IssueList items={items} onSelect={select} label="Issues" listRef={listRef} emptyText="None of this severity." />
          </div>
          {rest > 0 && (
            <div className="frl-app-actions">
              <Button
                size="sm"
                onClick={() => {
                  const more = Math.min(VALIDATION_PAGE, rest);
                  // The last page removes this button: focus the first issue it adds instead (UI-F1).
                  if (more === rest) focusAfterMore.current = items.length;
                  setLimit((n) => n + VALIDATION_PAGE);
                  announce(`Showing ${formatInteger(items.length + more)} of ${plural(shown.length, 'issue')}.`);
                }}
              >
                {`Show ${formatInteger(Math.min(VALIDATION_PAGE, rest))} more (${formatInteger(rest)} not shown)`}
              </Button>
            </div>
          )}
        </>
      )}
    </PanelSection>
  );
}

/** What the issues depend on: travel checks still pending, a failed walk, how to use the list. */
function ValidationNotes({ state, pending }: { readonly state: DerivedState; readonly pending: string | null }) {
  return (
    <>
      {state.status === 'failed' && state.failure !== null && <p className="frl-app-hint">{`${state.failure}. The issues below are from the last walk that succeeded.`}</p>}
      {pending !== null && <p className="frl-app-hint">{`${pending} Travel checks may change when they arrive.`}</p>}
      <p className="frl-app-hint">Choose an issue to select its step in the route. Arrow keys move between issues.</p>
    </>
  );
}
