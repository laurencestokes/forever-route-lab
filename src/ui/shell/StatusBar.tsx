import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import { formatDuration, formatDurationLong, formatInteger, formatPercent } from '../lib/format';
import type { Readout } from '../lib/readout';
import { Badge } from '../primitives/Badge';
import { AssumedMarker } from '../markers/AssumedMarker';
import { ReadoutValue } from '../markers/ReadoutValue';
import { XpBar, type XpBarProps } from './XpBar';
import './StatusBar.css';

/** What the status bar says about the optimiser. The app maps its own state to this. */
export type OptimizerStatus =
  | { readonly state: 'unavailable'; readonly detail: string }
  | { readonly state: 'idle' }
  | { readonly state: 'running'; readonly progress: number | null; readonly detail: string | null }
  | { readonly state: 'proposal'; readonly detail: string | null }
  | { readonly state: 'failed'; readonly detail: string };

export interface StatusBarProps {
  readonly xp: XpBarProps;
  /** The active step, or null when nothing is active. */
  readonly currentStep: { readonly number: number; readonly total: number; readonly title: string } | null;
  /** Estimated route duration in seconds. */
  readonly duration: Readout<number>;
  readonly xpPerHour: Readout<number>;
  readonly optimizer: OptimizerStatus;
  /** Dataset identity, e.g. `{ label: 'b6f5b07', detail: 'dataRevision …', placeholder: false }`. */
  readonly data: { readonly label: string; readonly detail: string; readonly placeholder: boolean };
  /** Active ruleset, e.g. `{ label: 'forever-beta', detail: '…', eraFallback: true }`. */
  readonly ruleset: { readonly label: string; readonly detail: string; readonly eraFallback: boolean };
}

function Item({ label, children, className, title }: { label: string; children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={cx('frl-statusbar__item', className)} title={title}>
      <span className="frl-statusbar__label">{label}</span>
      <span className="frl-statusbar__value">{children}</span>
    </span>
  );
}

export function optimizerText(status: OptimizerStatus): string {
  switch (status.state) {
    case 'unavailable':
      return 'Not available';
    case 'idle':
      return 'Idle';
    case 'running':
      return status.progress === null ? 'Running' : `Running ${formatPercent(status.progress)}`;
    case 'proposal':
      return 'Proposal ready';
    case 'failed':
      return 'Failed';
  }
}

function OptimizerItem({ status }: { status: OptimizerStatus }) {
  const detail = status.state === 'idle' ? null : status.detail;
  const text = optimizerText(status);
  return (
    <Item label="Optimiser" className={`frl-statusbar__optimizer is-${status.state}`} title={detail === null ? text : `${text}: ${detail}`}>
      {/* The state (not the percentage) is announced politely. */}
      <span aria-live="polite" className="frl-statusbar__optimizer-state">
        {status.state === 'running' ? 'Running' : text}
      </span>
      {status.state === 'running' && (
        <span
          className="frl-statusbar__progress"
          role="progressbar"
          aria-label="Optimiser progress"
          {...(status.progress === null
            ? { 'aria-valuetext': 'In progress' }
            : { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.floor(status.progress * 100) })}
        >
          <span
            className={cx('frl-statusbar__progress-fill', status.progress === null && 'is-indeterminate')}
            style={status.progress === null ? undefined : { width: `${String(Math.min(1, Math.max(0, status.progress)) * 100)}%` }}
          />
        </span>
      )}
      {status.state === 'running' && status.progress !== null && (
        <span className="frl-num" aria-hidden="true">
          {formatPercent(status.progress)}
        </span>
      )}
    </Item>
  );
}

/**
 * The bottom bar: projected level and XP, the active step, duration, XP per hour, optimiser state,
 * and the data and ruleset identities (ARCHITECTURE §12.4).
 */
export function StatusBar({ xp, currentStep, duration, xpPerHour, optimizer, data, ruleset }: StatusBarProps) {
  return (
    <section className="frl-statusbar" aria-label="Route status">
      <XpBar {...xp} className="frl-statusbar__xp" />
      <span className="frl-statusbar__sep" aria-hidden="true" />
      <Item label="Step" className="frl-statusbar__step" title={currentStep === null ? 'No active step' : currentStep.title}>
        {currentStep === null ? (
          <span className="frl-statusbar__none">none</span>
        ) : (
          <>
            <span className="frl-num">
              {formatInteger(currentStep.number)}/{formatInteger(currentStep.total)}
            </span>
            <span className="frl-statusbar__step-title">{currentStep.title}</span>
          </>
        )}
      </Item>
      <span className="frl-statusbar__sep" aria-hidden="true" />
      <Item label="Time">
        <ReadoutValue readout={duration} format={formatDuration} formatLong={formatDurationLong} />
      </Item>
      <Item label="XP/h">
        <ReadoutValue readout={xpPerHour} format={formatInteger} formatLong={(v) => `${formatInteger(v)} XP per hour`} />
      </Item>
      <span className="frl-statusbar__sep" aria-hidden="true" />
      <OptimizerItem status={optimizer} />
      <span className="frl-statusbar__spacer" />
      <span className="frl-statusbar__badges">
        <Badge tone={data.placeholder ? 'placeholder' : 'neutral'} title={data.detail}>
          Data {data.placeholder ? 'placeholder' : data.label}
        </Badge>
        <Badge title={ruleset.detail}>
          Ruleset {ruleset.label}
          {ruleset.eraFallback && <AssumedMarker reason="era-fallback" />}
        </Badge>
      </span>
    </section>
  );
}
