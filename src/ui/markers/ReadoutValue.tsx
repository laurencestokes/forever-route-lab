import { cx } from '../lib/cx';
import type { Readout } from '../lib/readout';
import { AssumedMarker } from './AssumedMarker';
import { PendingMarker } from './PendingMarker';
import './markers.css';

export interface ReadoutValueProps<T> {
  readonly readout: Readout<T>;
  /** Visible text for a known value. */
  readonly format: (value: T) => string;
  /** Spoken form, when the visible text is abbreviated (`'3h 07m'` → `'3 hours 7 minutes'`). */
  readonly formatLong?: ((value: T) => string) | undefined;
  /** Tooltip detail for the assumed marker. */
  readonly assumptionDetail?: string | undefined;
  /** At most one marker glyph (dense rows); its text then covers both assumption and Era fallback. */
  readonly compactMarkers?: boolean | undefined;
  /**
   * Why a known value is provisional (it changes when a background computation ends, such as a
   * walking path): shown in italics with the pending marker, which says this. Null or omitted: final.
   */
  readonly pending?: string | null | undefined;
  readonly className?: string | undefined;
}

/**
 * Renders a {@link Readout}: `≥` for lower bounds, `≤` for upper bounds, the assumed and Era-fallback markers, the
 * pending marker for provisional values, and a visible `?` (never 0) with its reason for unknown
 * values.
 */
export function ReadoutValue<T>({ readout, format, formatLong, assumptionDetail, compactMarkers = false, pending = null, className }: ReadoutValueProps<T>) {
  if (readout.value === null) {
    const reason = readout.unknownReason ?? 'Unknown';
    return (
      <span className={cx('frl-readout', 'frl-readout--unknown', className)} title={reason} data-state="unknown">
        <span aria-hidden="true">?</span>
        <span className="frl-visually-hidden">Unknown: {reason}</span>
      </span>
    );
  }
  const text = format(readout.value);
  const spoken = formatLong === undefined ? text : formatLong(readout.value);
  const bound = readout.lowerBound ? 'lower' : readout.upperBound ? 'upper' : null;
  // The visible text is hidden from assistive technology and restated in words below, so "≥"
  // is always spoken as "at least" and "≤" as "at most".
  return (
    <span
      className={cx(
        'frl-readout',
        bound === 'lower' && 'frl-readout--lower-bound',
        bound === 'upper' && 'frl-readout--upper-bound',
        pending !== null && 'frl-readout--pending',
        className,
      )}
      data-state={bound === 'lower' ? 'lower-bound' : bound === 'upper' ? 'upper-bound' : 'known'}
    >
      <span className="frl-readout__value frl-num" aria-hidden="true">
        {bound === 'lower' && (
          <span className="frl-readout__bound" title="Lower bound: the true value is at least this">
            ≥
          </span>
        )}
        {bound === 'upper' && (
          <span className="frl-readout__bound" title="Upper bound: the true value is at most this">
            ≤
          </span>
        )}
        {text}
      </span>
      <span className="frl-visually-hidden">{bound === 'lower' ? `at least ${spoken}` : bound === 'upper' ? `at most ${spoken}` : spoken}</span>
      {compactMarkers && readout.assumed && readout.eraFallback ? (
        <AssumedMarker reason="assumption" detail={[assumptionDetail, 'also uses Era values where Forever values are unknown'].filter(Boolean).join('; ')} />
      ) : (
        <>
          {readout.assumed && <AssumedMarker reason="assumption" detail={assumptionDetail} />}
          {readout.eraFallback && <AssumedMarker reason="era-fallback" />}
        </>
      )}
      {pending !== null && <PendingMarker detail={pending} />}
    </span>
  );
}
