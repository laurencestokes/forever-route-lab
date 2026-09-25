import { cx } from '../lib/cx';
import './markers.css';

/**
 * Why a number is not a plain fact:
 * - `assumption`: it depends on a user or ruleset assumption (seconds per kill, XP multipliers).
 * - `era-fallback`: an Era value stood in for an unknown Forever value (D-008).
 */
export type AssumedReason = 'assumption' | 'era-fallback';

const TEXT: Readonly<Record<AssumedReason, string>> = {
  assumption: 'Depends on assumptions',
  'era-fallback': 'Uses Era values where Forever values are unknown',
};

const GLYPH: Readonly<Record<AssumedReason, string>> = {
  assumption: '≈',
  'era-fallback': 'E',
};

export interface AssumedMarkerProps {
  readonly reason?: AssumedReason | undefined;
  /** Which assumptions, for the tooltip: `'Seconds per kill 20 s; quest XP multiplier 1.0'`. */
  readonly detail?: string | undefined;
  readonly className?: string | undefined;
}

/** A small neutral marker placed after an assumption-dependent number. */
export function AssumedMarker({ reason = 'assumption', detail, className }: AssumedMarkerProps) {
  const text = detail === undefined ? TEXT[reason] : `${TEXT[reason]}: ${detail}`;
  return (
    <span className={cx('frl-assumed', `frl-assumed--${reason}`, className)} title={text} data-reason={reason}>
      <span className="frl-assumed__glyph" aria-hidden="true">
        {GLYPH[reason]}
      </span>
      <span className="frl-visually-hidden">({text})</span>
    </span>
  );
}
