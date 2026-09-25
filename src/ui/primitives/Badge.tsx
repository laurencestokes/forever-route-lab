import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import './primitives.css';

export type BadgeTone = 'neutral' | 'accent' | 'placeholder';

export interface BadgeProps {
  readonly children: ReactNode;
  readonly tone?: BadgeTone | undefined;
  /** Tooltip with the full detail (for example a full data revision). */
  readonly title?: string | undefined;
  readonly className?: string | undefined;
}

/** A small inline label for identities and states: data revision, ruleset, counts. */
export function Badge({ children, tone = 'neutral', title, className }: BadgeProps) {
  return (
    <span className={cx('frl-badge', `frl-badge--${tone}`, className)} title={title}>
      {children}
    </span>
  );
}

export interface PlaceholderTagProps {
  /** What is a placeholder, for the tooltip and screen readers, e.g. `'route data'`. */
  readonly what?: string | undefined;
  readonly className?: string | undefined;
}

/**
 * The visible "Placeholder" label. Anything that stands in for real content (sample routes,
 * the map stub) carries it, so it can never be mistaken for game data.
 */
export function PlaceholderTag({ what, className }: PlaceholderTagProps) {
  return (
    <Badge tone="placeholder" className={className} title={what === undefined ? 'Placeholder' : `Placeholder ${what}`}>
      Placeholder
      {what !== undefined && <span className="frl-visually-hidden"> {what}</span>}
    </Badge>
  );
}

export function VisuallyHidden({ children }: { readonly children: ReactNode }) {
  return <span className="frl-visually-hidden">{children}</span>;
}
