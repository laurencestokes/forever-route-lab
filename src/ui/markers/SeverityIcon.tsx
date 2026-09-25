import type { ReactElement } from 'react';
import type { IssueSeverity } from '../../domain/issues';
import { cx } from '../lib/cx';
import { SEVERITY_LABELS } from '../lib/issues';
import './markers.css';

/*
 * Each severity has its own shape (octagon with ×, triangle with !, circle with i) as well as its
 * own hue, and the hues avoid the reserved difficulty set: error is magenta, warning violet, info
 * blue. Fill and mark colours come from markers.css.
 */
const SHAPES: Readonly<Record<IssueSeverity, ReactElement>> = {
  error: (
    <>
      <path className="frl-severity-icon__shape" d="M5.5 1.75h5l3.75 3.75v5l-3.75 3.75h-5L1.75 10.5v-5z" />
      <path className="frl-severity-icon__mark" d="m5.75 5.75 4.5 4.5M10.25 5.75l-4.5 4.5" />
    </>
  ),
  warning: (
    <>
      <path className="frl-severity-icon__shape" d="M8 1.9 14.6 13.6H1.4z" />
      <path className="frl-severity-icon__mark" d="M8 6.25v3.25" />
      <circle className="frl-severity-icon__dot" cx="8" cy="11.6" r="0.9" />
    </>
  ),
  info: (
    <>
      <circle className="frl-severity-icon__shape" cx="8" cy="8" r="6.25" />
      <path className="frl-severity-icon__mark" d="M8 7.25v4" />
      <circle className="frl-severity-icon__dot" cx="8" cy="4.9" r="0.9" />
    </>
  ),
};

export interface SeverityIconProps {
  readonly severity: IssueSeverity;
  /** `true` (default): named image ("Error"). `false`: decorative, next to text that says it. */
  readonly labelled?: boolean | undefined;
  readonly size?: 12 | 14 | 16 | undefined;
  readonly className?: string | undefined;
}

export function SeverityIcon({ severity, labelled = true, size = 14, className }: SeverityIconProps) {
  const label = SEVERITY_LABELS[severity];
  return (
    <svg
      className={cx('frl-severity-icon', `frl-severity-icon--${severity}`, className)}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      data-severity={severity}
      {...(labelled ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {labelled && <title>{label}</title>}
      {SHAPES[severity]}
    </svg>
  );
}
