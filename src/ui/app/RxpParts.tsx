import { type ReactNode, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RxpDiagnostic } from '../../rxp';
import { cx } from '../lib/cx';
import { formatInteger } from '../lib/format';
import { countIssues, describeIssueCounts, SEVERITY_LABELS } from '../lib/issues';
import { SeverityIcon } from '../markers/SeverityIcon';
import { VisuallyHidden } from '../primitives/Badge';
import { Button } from '../primitives/Button';
import { Select } from '../primitives/Select';
import './RxpDialogs.css';

/**
 * Parts the two RXP custom-guide dialogs share (docs/UI.md §15): the diagnostics list, whose items
 * open the source line they are about (a disclosure: the excerpt follows the item), the excerpt
 * itself, and a radio group.
 */

/** A text a diagnostic's line can be shown from. */
export interface RxpSourceText {
  /** How the text is named in the excerpt's label: "the pasted text", "“Horde.lua”", "the imported guide “X”". */
  readonly name: string;
  readonly lines: readonly string[];
}

/** Splits a text into its physical lines (CRLF, CR or LF each end one, as RXP reads them). */
export function sourceLines(text: string): readonly string[] {
  return text.split(/\r\n|\r|\n/);
}

/** "Line 12, column 5"; "Line 12" without a column; "Not tied to a line" for line 0. */
export function whereText(line: number, column: number): string {
  if (line <= 0) return 'Not tied to a line';
  return column > 0 ? `Line ${formatInteger(line)}, column ${formatInteger(column)}` : `Line ${formatInteger(line)}`;
}

// Source excerpt --------------------------------------------------------------------------------

export interface SourceExcerptProps {
  readonly id?: string | undefined;
  readonly source: RxpSourceText;
  readonly line: number;
  /** 1-based column in code points; 0 marks no column. */
  readonly column: number;
  /** Lines shown before and after the line. */
  readonly context?: number | undefined;
}

/** The line (and a few around it), numbered, with the line marked and its column highlighted. */
export function SourceExcerpt({ id, source, line, column, context = 2 }: SourceExcerptProps) {
  const label = `${whereText(line, column)} of ${source.name}`;
  if (line < 1 || line > source.lines.length) {
    return (
      <p id={id} className="frl-rxp__hint">
        Line {formatInteger(line)} is not in {source.name}.
      </p>
    );
  }
  const first = Math.max(1, line - context);
  const last = Math.min(source.lines.length, line + context);
  const rows: ReactNode[] = [];
  for (let n = first; n <= last; n += 1) {
    const text = source.lines[n - 1] ?? '';
    const target = n === line;
    let content: ReactNode = text === '' ? ' ' : text;
    if (target && column > 0) {
      const points = Array.from(text);
      const at = points[column - 1];
      content = (
        <>
          {points.slice(0, column - 1).join('')}
          <mark className="frl-rxpsource__column">{at === undefined || at === '\t' || at === ' ' ? ' ' : at}</mark>
          {points.slice(column).join('')}
        </>
      );
    }
    rows.push(
      <span key={n} className={cx('frl-rxpsource__line', target && 'is-target')}>
        <span className="frl-rxpsource__number" aria-hidden="true">
          {target ? '▶' : ''}
          {formatInteger(n)}
        </span>
        <VisuallyHidden>{target ? `Line ${formatInteger(n)}, this line: ` : `Line ${formatInteger(n)}: `}</VisuallyHidden>
        <span className="frl-rxpsource__text">{content}</span>
      </span>,
    );
  }
  return (
    // Long lines scroll sideways, so the excerpt is focusable (keyboard scrolling).
    <pre id={id} className="frl-rxpsource" role="region" aria-label={label} tabIndex={0}>
      {rows}
    </pre>
  );
}

// Diagnostics list ------------------------------------------------------------------------------

type SeverityFilter = 'all' | 'problems' | 'errors';

const PAGE = 100;

export interface RxpDiagnosticListProps {
  readonly diagnostics: readonly RxpDiagnostic[];
  /** The text a diagnostic's line is in; null or omitted: its line cannot be shown. */
  readonly sourceOf?: ((diagnostic: RxpDiagnostic) => RxpSourceText | null) | undefined;
  /** Extra words after where it is ("in “Guide two”"), or null. */
  readonly contextOf?: ((diagnostic: RxpDiagnostic) => string | null) | undefined;
  readonly emptyText: string;
}

/**
 * Diagnostics in line order: severity (shape and word), where, message, code, and whether RestedXP
 * itself would drop or change the line. An item with a source line is a button that shows the line
 * right after it (`aria-expanded`). Counts by severity, a filter, and pages of 100. "Show more"
 * on the last page removes itself, so focus moves to the first item it added (UI-F1).
 */
export function RxpDiagnosticList({ diagnostics, sourceOf, contextOf, emptyText }: RxpDiagnosticListProps) {
  const [filter, setFilter] = useState<SeverityFilter>('all');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<number | null>(null);
  const baseId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  /** The position of the first item a last "Show more" added, to focus once it is rendered. */
  const focusItem = useRef<number | null>(null);
  useLayoutEffect(() => {
    const at = focusItem.current;
    if (at === null) return;
    focusItem.current = null;
    const item = listRef.current?.children[at];
    (item?.querySelector<HTMLElement>('button') ?? listRef.current)?.focus();
  });
  const counts = useMemo(() => countIssues(diagnostics), [diagnostics]);
  const shown = useMemo(
    () =>
      diagnostics
        .map((diagnostic, index) => ({ diagnostic, index }))
        .filter(({ diagnostic }) => filter === 'all' || diagnostic.severity === 'error' || (filter === 'problems' && diagnostic.severity === 'warning')),
    [diagnostics, filter],
  );
  if (diagnostics.length === 0) return <p className="frl-rxp__hint">{emptyText}</p>;
  const options = [
    { value: 'all', label: `All (${formatInteger(diagnostics.length)})` },
    { value: 'problems', label: `Errors and warnings (${formatInteger(counts.error + counts.warning)})` },
    { value: 'errors', label: `Errors (${formatInteger(counts.error)})` },
  ];
  return (
    <div className="frl-rxpdiag">
      <div className="frl-rxpdiag__bar">
        <p className="frl-rxpdiag__counts">{describeIssueCounts(counts)}</p>
        <Select
          label="Show"
          size="sm"
          value={filter}
          options={options}
          onChange={(value) => {
            if (value === 'all' || value === 'problems' || value === 'errors') {
              setFilter(value);
              setLimit(PAGE);
            }
          }}
        />
      </div>
      {shown.length === 0 ? (
        <p className="frl-rxp__hint">None at this level.</p>
      ) : (
        <ul className="frl-rxpdiag__list" ref={listRef} tabIndex={-1} aria-label="Diagnostics">
          {shown.slice(0, limit).map(({ diagnostic, index }) => {
            const source = diagnostic.line > 0 ? (sourceOf?.(diagnostic) ?? null) : null;
            const context = contextOf?.(diagnostic) ?? null;
            const expanded = open === index && source !== null;
            const excerptId = `${baseId}-excerpt-${String(index)}`;
            const body = (
              <>
                <span className="frl-rxpdiag__severity">
                  <SeverityIcon severity={diagnostic.severity} labelled={false} />
                  <span>{SEVERITY_LABELS[diagnostic.severity]}</span>
                </span>
                <span className="frl-rxpdiag__where">
                  {whereText(diagnostic.line, diagnostic.column)}
                  {context !== null && ` ${context}`}
                </span>
                <span className="frl-rxpdiag__message">{diagnostic.message}</span>
                <span className="frl-rxpdiag__meta">
                  <code>{diagnostic.code}</code>
                  {diagnostic.rxpCompat && <span>RestedXP itself drops or changes this</span>}
                  {source !== null && <span className="frl-rxpdiag__toggle">{expanded ? 'Hide the line' : 'Show the line'}</span>}
                </span>
              </>
            );
            return (
              <li key={index} className={cx('frl-rxpdiag__item', `frl-rxpdiag__item--${diagnostic.severity}`, expanded && 'is-open')} data-severity={diagnostic.severity}>
                {source === null ? (
                  <div className="frl-rxpdiag__body">{body}</div>
                ) : (
                  <button
                    type="button"
                    className="frl-rxpdiag__body"
                    aria-expanded={expanded}
                    aria-controls={expanded ? excerptId : undefined}
                    onClick={() => {
                      setOpen(expanded ? null : index);
                    }}
                  >
                    {body}
                  </button>
                )}
                {expanded && <SourceExcerpt id={excerptId} source={source} line={diagnostic.line} column={diagnostic.column} />}
              </li>
            );
          })}
        </ul>
      )}
      {shown.length > limit && (
        <p className="frl-rxpdiag__more">
          Showing {formatInteger(limit)} of {formatInteger(shown.length)}.{' '}
          <Button
            size="sm"
            onClick={() => {
              if (limit + PAGE >= shown.length) focusItem.current = limit;
              setLimit(limit + PAGE);
            }}
          >
            Show {formatInteger(Math.min(PAGE, shown.length - limit))} more
          </Button>
        </p>
      )}
    </div>
  );
}

/** "3 errors, 1 warning" for a guide's summary; "no diagnostics" when empty. */
export function diagnosticCountsText(diagnostics: readonly RxpDiagnostic[]): string {
  return diagnostics.length === 0 ? 'no diagnostics' : describeIssueCounts(countIssues(diagnostics));
}

// Radio group -----------------------------------------------------------------------------------

export interface RadioOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** A sentence under the option (its description). */
  readonly hint?: string | undefined;
  /** Why the option cannot be chosen; null or omitted when it can. */
  readonly unavailable?: string | null | undefined;
}

export interface RadioGroupProps<T extends string> {
  readonly legend: string;
  readonly value: T;
  readonly options: readonly RadioOption<T>[];
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean | undefined;
}

/** Native radio buttons in a fieldset: arrow keys move between them; each hint describes its option. */
export function RadioGroup<T extends string>({ legend, value, options, onChange, disabled = false }: RadioGroupProps<T>) {
  const name = useId();
  return (
    <fieldset className="frl-rxp__group" disabled={disabled}>
      <legend>{legend}</legend>
      {options.map((option) => {
        const id = `${name}-${option.value}`;
        const hint = option.unavailable ?? option.hint;
        return (
          <div key={option.value} className="frl-rxp__radio">
            <input
              id={id}
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={option.unavailable !== undefined && option.unavailable !== null}
              aria-describedby={hint === undefined ? undefined : `${id}-hint`}
              onChange={() => {
                onChange(option.value);
              }}
            />
            <label htmlFor={id}>{option.label}</label>
            {hint !== undefined && (
              <p id={`${id}-hint`} className="frl-rxp__hint">
                {hint}
              </p>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
