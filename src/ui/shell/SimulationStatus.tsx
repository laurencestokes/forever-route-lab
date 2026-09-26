import { type FocusEvent, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../lib/cx';
import { formatInteger, plural } from '../lib/format';
import { VisuallyHidden } from '../primitives/Badge';
import { Button } from '../primitives/Button';
import './StatusBar.css';

/**
 * What the status bar says about the route simulation and its travel model (ARCHITECTURE §12.1;
 * terrain-navigation.md §9.3-§9.4). The app maps the derived store's state to this.
 *
 * - `ready`: nothing to say (walking paths are known, or there are none to compute);
 * - `loading`: the simulation's code is loading, nothing is simulated yet;
 * - `failed`: the simulation could not load, or the last walk failed (`detail` says why);
 * - `checking`: the navigation data is being checked; times use straight lines meanwhile;
 * - `computing`: walking paths are being computed, with progress and Cancel; `done` and `total`
 *   are null while the run has not said how many legs it computes (never drawn as "0 of 0");
 * - `paused`: the user cancelled; `pending` legs keep their straight-line estimates until Resume;
 * - `straight-line`: navigation data is unavailable (for some maps or all), so those travel times
 *   are straight-line estimates. Never an error dialog: a statement, with the reason.
 */
export type SimulationStatusModel =
  | { readonly state: 'ready' }
  | { readonly state: 'loading'; readonly detail: string }
  | { readonly state: 'failed'; readonly detail: string }
  | { readonly state: 'checking'; readonly detail: string }
  | { readonly state: 'computing'; readonly done: number | null; readonly total: number | null; readonly detail: string }
  | { readonly state: 'paused'; readonly pending: number; readonly detail: string }
  | { readonly state: 'straight-line'; readonly text: string; readonly detail: string };

export interface SimulationStatusProps {
  readonly status: SimulationStatusModel;
  /** Stops computing walking paths (the legs computed so far are kept). */
  readonly onCancel?: (() => void) | undefined;
  /** Computes the pending walking paths again after a cancel. */
  readonly onResume?: (() => void) | undefined;
  readonly className?: string | undefined;
}

const LABEL: Readonly<Record<SimulationStatusModel['state'], string>> = {
  ready: 'Paths',
  loading: 'Simulation',
  failed: 'Simulation',
  checking: 'Travel',
  computing: 'Paths',
  paused: 'Paths',
  'straight-line': 'Travel',
};

/** The words of the `ready` state, shown only while the item still holds keyboard focus. */
export const PATHS_READY_TEXT = 'None pending';
const PATHS_READY_DETAIL = 'No walking legs are waiting to be computed.';

/** A computing run whose leg count is not known yet. */
export const COUNTING_LEGS_TEXT = 'Counting legs…';

/** The short visible words of a state (the detail follows as a tooltip and for screen readers). */
export function simulationStatusText(status: SimulationStatusModel): string {
  switch (status.state) {
    case 'ready':
      return PATHS_READY_TEXT;
    case 'loading':
      return 'Loading';
    case 'failed':
      return 'Failed';
    case 'checking':
      return 'Checking navigation data';
    case 'computing':
      return status.total === null ? COUNTING_LEGS_TEXT : 'Computing walking paths';
    case 'paused':
      return `Paused, ${plural(status.pending, 'leg')} pending`;
    case 'straight-line':
      return status.text;
  }
}

/** The computing progress bar: legs answered of those asked, or indeterminate while they are counted. */
function PathsProgress({ done, total }: { readonly done: number | null; readonly total: number | null }) {
  if (done === null || total === null || total <= 0) {
    // Unknown progress is never a fill (UI.md §1 principle 5, §9 rule 5): the sliding bar, or the
    // unknown hatching across the whole track under reduced motion. No numbers are spoken.
    return (
      <span className="frl-statusbar__progress is-indeterminate" role="progressbar" aria-label="Walking paths computed" aria-valuetext="Counting legs">
        <span className="frl-statusbar__progress-fill is-indeterminate" />
      </span>
    );
  }
  const max = Math.max(total, 1);
  return (
    <>
      <span
        className="frl-statusbar__progress"
        role="progressbar"
        aria-label="Walking paths computed"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(done, max)}
        aria-valuetext={`${formatInteger(done)} of ${plural(total, 'leg')}`}
      >
        <span className="frl-statusbar__progress-fill" style={{ width: `${String(Math.min(1, done / total) * 100)}%` }} />
      </span>
      <span className="frl-num frl-statusbar__simulation-count" aria-hidden="true">
        {`${formatInteger(done)}/${formatInteger(total)}`}
      </span>
    </>
  );
}

/**
 * The simulation's item in the status bar: a label, a short state and, while walking paths are
 * computed, a progress bar (legs answered of those asked; never announced) and Cancel; after a
 * cancel, Resume. The state is not a live region: only the result of Cancel and Resume is announced,
 * by the caller.
 *
 * Keyboard focus is never dropped (UI-03): when the focused Cancel or Resume goes (the other takes
 * its place, or computing ends in the background), focus moves to the button now in the item, else
 * to the item itself; and while the item holds focus it stays on screen, in the `ready` state as
 * "Paths: None pending", until focus leaves it. Background work never moves focus anywhere else.
 */
export function SimulationStatus({ status, onCancel, onResume, className }: SimulationStatusProps) {
  const itemRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Focus is inside the item, as far as the focus events say: a focused button that is removed
  // fires no event React sees (it is already detached), so this stays true until focus moves on.
  const holdsFocus = useRef(false);
  const [holding, setHolding] = useState(false);

  useLayoutEffect(() => {
    const item = itemRef.current;
    if (!holdsFocus.current || item === null) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body && item.contains(active)) return;
    // The focused control went with this render (and focus with it, to the page): give focus to what
    // took its place, or to the item.
    (buttonRef.current ?? item).focus();
  });

  const onFocus = () => {
    holdsFocus.current = true;
    setHolding(true);
  };
  const release = () => {
    holdsFocus.current = false;
    setHolding(false);
  };
  const onBlur = (event: FocusEvent<HTMLSpanElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    if (next !== null) {
      release();
      return;
    }
    // Focus went nowhere: leaving the window (focus comes back here with it), a press on something
    // that takes no focus, or the focused button being removed by a render, which some browsers
    // report as a blur. Decide once the render's layout effect has put focus back in the item.
    queueMicrotask(() => {
      const item = itemRef.current;
      const active = document.activeElement;
      if (!document.hasFocus() || (item !== null && active !== null && item.contains(active))) return;
      release();
    });
  };

  if (status.state === 'ready' && !holding) return null;
  const text = simulationStatusText(status);
  const detail = status.state === 'ready' ? PATHS_READY_DETAIL : status.detail;
  return (
    <span
      ref={itemRef}
      tabIndex={-1}
      className={cx('frl-statusbar__item', 'frl-statusbar__simulation', `is-${status.state}`, className)}
      title={`${text}: ${detail}`}
      data-state={status.state}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <span className="frl-statusbar__label">{LABEL[status.state]}</span>
      <span className="frl-statusbar__value">
        {status.state === 'computing' ? (
          <>
            <PathsProgress done={status.done} total={status.total} />
            {status.total === null && (
              <span className="frl-statusbar__simulation-text" aria-hidden="true">
                {COUNTING_LEGS_TEXT}
              </span>
            )}
          </>
        ) : (
          <span className="frl-statusbar__simulation-text">{text}</span>
        )}
        <VisuallyHidden>{status.state === 'computing' ? `${text}. ${detail}` : detail}</VisuallyHidden>
        {status.state === 'computing' && onCancel !== undefined && (
          <Button ref={buttonRef} size="sm" variant="ghost" className="frl-statusbar__action" onClick={onCancel}>
            Cancel
            <VisuallyHidden> computing walking paths</VisuallyHidden>
          </Button>
        )}
        {status.state === 'paused' && onResume !== undefined && (
          <Button ref={buttonRef} size="sm" variant="ghost" className="frl-statusbar__action" onClick={onResume}>
            Resume
            <VisuallyHidden> computing walking paths</VisuallyHidden>
          </Button>
        )}
      </span>
    </span>
  );
}
