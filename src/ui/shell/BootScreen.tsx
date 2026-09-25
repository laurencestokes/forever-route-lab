import { type ReactNode, useEffect, useRef } from 'react';
import { cx } from '../lib/cx';
import { formatInteger } from '../lib/format';
import { Button } from '../primitives/Button';
import { BrandMark, PRODUCT_NAME } from './TopBar';
import './BootScreen.css';

/**
 * The screens before the shell: loading the dataset and the map geometry, and a failed start.
 * Presentational: the app supplies the progress and the failure (src/ui/Boot.tsx).
 */

export interface BootProgress {
  /** `fetching`: files arriving and being verified; `building`: spawns becoming map positions. */
  readonly stage: 'fetching' | 'building' | 'ready';
  readonly filesDone: number;
  readonly filesTotal: number;
  readonly bytesDone: number;
  readonly bytesTotal: number;
}

/** `9001425` → `'9.0 MB'` (decimal megabytes, one decimal, truncated). */
export function formatMegabytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '? MB';
  const tenths = Math.floor(bytes / 100_000);
  return `${String(Math.floor(tenths / 10))}.${String(tenths % 10)} MB`;
}

/** The status line of the loading screen. */
export function loadingText(progress: BootProgress | null): string {
  if (progress === null || progress.filesTotal === 0) return 'Reading the data manifest…';
  if (progress.stage === 'fetching') {
    return `Fetching and verifying data files: ${formatInteger(progress.filesDone)} of ${formatInteger(progress.filesTotal)} (${formatMegabytes(progress.bytesDone)} of ${formatMegabytes(progress.bytesTotal)})`;
  }
  return 'Placing quest givers, objectives and spawns on the map geometry…';
}

function Frame({ children, busy }: { readonly children: ReactNode; readonly busy: boolean }) {
  return (
    <main className="frl-boot" aria-busy={busy}>
      <div className="frl-boot__card">
        <div className="frl-boot__brand">
          <BrandMark />
          <h1 className="frl-boot__name">{PRODUCT_NAME}</h1>
        </div>
        {children}
      </div>
    </main>
  );
}

export interface LoadingScreenProps {
  readonly progress: BootProgress | null;
}

/** Shown from the first paint until the dataset is ready. */
export function LoadingScreen({ progress }: LoadingScreenProps) {
  const determinate = progress !== null && progress.stage === 'fetching' && progress.filesTotal > 0;
  const fraction = determinate ? progress.filesDone / progress.filesTotal : 0;
  return (
    <Frame busy>
      <p className="frl-boot__lead">Loading the Forever dataset and map geometry. Everything runs in your browser.</p>
      <div
        className="frl-boot__progress"
        role="progressbar"
        aria-label="Loading progress"
        {...(determinate
          ? { 'aria-valuemin': 0, 'aria-valuemax': progress.filesTotal, 'aria-valuenow': progress.filesDone }
          : { 'aria-valuetext': loadingText(progress) })}
      >
        <span
          className={cx('frl-boot__progress-fill', !determinate && 'is-indeterminate')}
          style={determinate ? { width: `${String(Math.round(fraction * 100))}%` } : undefined}
        />
      </div>
      <p className="frl-boot__status" role="status">
        {loadingText(progress)}
      </p>
    </Frame>
  );
}

/**
 * What can fix a failed start: trying again (`reload`), regenerating and redeploying the site's
 * files (`redeploy`), or opening the site over https so the browser can verify them
 * (`open-over-https`). The app decides which (src/app/workspace.ts `describeLoadFailure`).
 */
export type LoadRemedy = 'reload' | 'redeploy' | 'open-over-https';

/** The sentence shown instead of "Try again" when a retry cannot help. */
export const NO_RETRY_TEXT: Readonly<Record<Exclude<LoadRemedy, 'reload'>, string>> = {
  redeploy: 'Trying again will not help: the deployed files need to be regenerated and redeployed.',
  'open-over-https': 'Trying again will not help here: open the site over https (or on localhost), where the browser can verify the files.',
};

export interface LoadErrorScreenProps {
  readonly title: string;
  readonly message: string;
  readonly details: readonly string[];
  /** `reload` shows "Try again"; any other remedy says what to do instead. */
  readonly remedy: LoadRemedy;
  readonly onRetry: () => void;
}

/** A failed start: what failed, why, and what can fix it. Nothing of the partial load is shown or used. */
export function LoadErrorScreen({ title, message, details, remedy, onRetry }: LoadErrorScreenProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <Frame busy={false}>
      <div className="frl-boot__error" role="alert">
        <h2 className="frl-boot__title" ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <p>{message}</p>
        <p className="frl-boot__muted">No data was shown, and nothing was filled in or guessed.</p>
      </div>
      {details.length > 0 && (
        <details className="frl-boot__details">
          <summary>Details</summary>
          <ul>
            {details.map((line, i) => (
              <li key={i}>
                <code>{line}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="frl-boot__actions">
        {remedy === 'reload' ? (
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
        ) : (
          <p className="frl-boot__muted">{NO_RETRY_TEXT[remedy]}</p>
        )}
      </div>
    </Frame>
  );
}
