import { cx } from '../lib/cx';
import type { Readout } from '../lib/readout';
import { AssumedMarker } from './AssumedMarker';
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
  readonly className?: string | undefined;
}

/**
 * Renders a {@link Readout}: `≥` for lower bounds, the assumed and Era-fallback markers, and a
 * visible `?` (never 0) with its reason for unknown values.
 */
export function ReadoutValue<T>({ readout, format, formatLong, assumptionDetail, compactMarkers = false, className }: ReadoutValueProps<T>) {
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
  // The visible text is hidden from assistive technology and restated in words below, so "≥"
  // is always spoken as "at least".
  return (
    <span
      className={cx('frl-readout', readout.lowerBound && 'frl-readout--lower-bound', className)}
      data-state={readout.lowerBound ? 'lower-bound' : 'known'}
    >
      <span className="frl-readout__value frl-num" aria-hidden="true">
        {readout.lowerBound && (
          <span className="frl-readout__bound" title="Lower bound: the true value is at least this">
            ≥
          </span>
        )}
        {text}
      </span>
      <span className="frl-visually-hidden">{readout.lowerBound ? `at least ${spoken}` : spoken}</span>
      {compactMarkers && readout.assumed && readout.eraFallback ? (
        <AssumedMarker reason="assumption" detail={[assumptionDetail, 'also uses Era values where Forever values are unknown'].filter(Boolean).join('; ')} />
      ) : (
        <>
          {readout.assumed && <AssumedMarker reason="assumption" detail={assumptionDetail} />}
          {readout.eraFallback && <AssumedMarker reason="era-fallback" />}
        </>
      )}
    </span>
  );
}
