import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { cx } from '../lib/cx';
import type { RuleParameter } from '../lib/rule-labels';
import { Button } from '../primitives/Button';
import './StatusBar.css';

/** One route metric: its name, the value (a `ReadoutValue`, with its markers) and where it comes from in words. */
export interface RouteSummaryRow {
  readonly term: string;
  readonly value: ReactNode;
  /** The value's basis in words: "depends on assumptions", "worked out from the data and rules", "unknown". */
  readonly basis: string;
}

export interface RouteSummaryProps {
  /** The metrics, in order (ARCHITECTURE §9.3: duration, XP, level reached, XP per hour, then the time shares). */
  readonly rows: readonly RouteSummaryRow[];
  /** Sentences under the table: what is pending, which travel model the times use, what is not counted. */
  readonly notes: readonly string[];
  /**
   * Every ruleset parameter the route reads that is an assumption or an Era value, each with where
   * its value comes from; listed in full (a tooltip names four and counts the rest, the summary
   * never does). Omitted or empty: no list.
   */
  readonly parameters?: readonly RuleParameter[] | undefined;
  /** The button's visible word. */
  readonly buttonLabel?: string | undefined;
  readonly className?: string | undefined;
}

/**
 * The route's metrics with their bases, behind a "Summary" button in the status bar (a disclosure:
 * `aria-expanded`, the panel follows the button in the reading order). The panel opens above the
 * status bar, over the side panel (in the flow under its button at 720px and below), and closes
 * with the button, Escape (focus back on the button), a press anywhere outside it, or keyboard
 * focus leaving it (Tab or Shift+Tab past it), so it never hides the focused control behind it
 * (WCAG 2.4.11). It holds no controls, so it needs no focus management of its own.
 */
export function RouteSummary({ rows, notes, parameters = [], buttonLabel = 'Summary', className }: RouteSummaryProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const parametersId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={cx('frl-summary', open && 'is-open', className)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }}
      onBlur={(event) => {
        // Focus moved to a control outside the disclosure: close, so the panel cannot cover it.
        // A blur to nowhere (another window, a press on the page) is left to the outside press.
        const next = event.relatedTarget;
        if (!open || !(next instanceof Node) || event.currentTarget.contains(next)) return;
        setOpen(false);
      }}
    >
      <Button
        ref={buttonRef}
        size="sm"
        variant="ghost"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="frl-summary__button"
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        {buttonLabel}
      </Button>
      {open && (
        <div id={panelId} role="region" aria-label="Route summary" className="frl-summary__panel">
          <p className="frl-summary__title">Route summary</p>
          <table className="frl-summary__table">
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col">Value</th>
                <th scope="col">Basis</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.term}>
                  <th scope="row">{row.term}</th>
                  <td className="frl-num">{row.value}</td>
                  <td className="frl-summary__basis">{row.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {notes.map((note) => (
            <p key={note} className="frl-summary__note">
              {note}
            </p>
          ))}
          {parameters.length > 0 && (
            <>
              <p id={parametersId} className="frl-summary__note">
                {`The route reads ${String(parameters.length)} ${parameters.length === 1 ? 'parameter that is an assumption or an Era value' : 'parameters that are assumptions or Era values'}:`}
              </p>
              <ul className="frl-summary__parameters" aria-labelledby={parametersId}>
                {parameters.map((parameter) => (
                  <li key={parameter.key}>
                    {parameter.label} <span className="frl-summary__basis">({parameter.origin})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
