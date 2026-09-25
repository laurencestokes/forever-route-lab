import type { ReactElement } from 'react';
import type { StepKind } from '../../domain/route';
import { cx } from '../lib/cx';
import './markers.css';

/** Accessible and tooltip names for each step kind. */
export const STEP_KIND_LABELS: Readonly<Record<StepKind, string>> = {
  accept: 'Accept quest',
  complete: 'Complete objectives',
  turnin: 'Turn in quest',
  abandon: 'Abandon quest',
  travel: 'Travel',
  grind: 'Grind',
  hearth: 'Hearthstone',
  flight: 'Flight',
  train: 'Train',
  vendor: 'Vendor',
  note: 'Note',
};

/*
 * Original 16×16 line glyphs. Quest steps share one "quest card" silhouette with a different
 * mark (plus, target, tick, cross) so they read as a family; the other kinds each have their own
 * shape. Shapes alone distinguish every kind: glyphs are drawn in the neutral text colour.
 */
const CARD = 'M3.5 2.5h6.25l2.75 2.75v8.25a.5.5 0 0 1-.5.5h-8.5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z';

const GLYPHS: Readonly<Record<StepKind, ReactElement>> = {
  accept: (
    <>
      <path d={CARD} />
      <path d="M8 6.5v5M5.5 9h5" />
    </>
  ),
  complete: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="2.5" />
      <circle cx="8" cy="8" r="0.6" fill="currentColor" />
    </>
  ),
  turnin: (
    <>
      <path d={CARD} />
      <path d="m5.5 9.25 1.75 1.75 3.25-3.5" />
    </>
  ),
  abandon: (
    <>
      <path d={CARD} />
      <path d="m6 7.25 4 4M10 7.25l-4 4" />
    </>
  ),
  travel: (
    <>
      <path d="M2.5 13c2.5 0 2.5-5 5.5-5s3-4.5 5-4.5" strokeDasharray="1.6 1.9" />
      <path d="M10.75 2.25 13.25 3.5 12 6" />
    </>
  ),
  grind: (
    <>
      <path d="m3 3 7.5 7.5M13 3l-7.5 7.5" />
      <path d="M9.25 12.25 12.25 9.25M6.75 12.25 3.75 9.25" />
      <path d="m11.5 11.5 1.5 1.5M4.5 11.5 3 13" />
    </>
  ),
  hearth: (
    <>
      <path d="M2.75 7.25 8 2.75l5.25 4.5" />
      <path d="M4.25 6.25v7h7.5v-7" />
      <path d="M8 12.75c-1.1 0-1.75-.8-1.75-1.7 0-1.3 1.75-2.3 1.75-3.3 0 0 1.75 1.4 1.75 3.3 0 .9-.65 1.7-1.75 1.7z" />
    </>
  ),
  flight: (
    <>
      <path d="M2.25 8.25 13.5 3 10 13.25 7.5 9.25z" />
      <path d="M7.5 9.25 13.5 3" />
    </>
  ),
  train: (
    <>
      <path d="M8 4.25c-1.5-1-3.5-1.25-5.5-1v9.25c2-.25 4 0 5.5 1 1.5-1 3.5-1.25 5.5-1V3.25c-2-.25-4 0-5.5 1z" />
      <path d="M8 4.25v9.25" />
    </>
  ),
  vendor: (
    <>
      <path d="M3.25 5.5h9.5l-.75 8h-8z" />
      <path d="M5.75 5.5V4.75a2.25 2.25 0 0 1 4.5 0v.75" />
    </>
  ),
  note: (
    <>
      <path d="M3 2.75h10v7L9.75 13H3z" />
      <path d="M9.75 13V9.75H13M5.25 5.75h5.5M5.25 8h3.5" />
    </>
  ),
};

export interface StepTypeGlyphProps {
  readonly kind: StepKind;
  /**
   * `true` (default): the glyph is an image named after the step kind. `false`: decorative,
   * for places where the kind is already spelled out in text or in an enclosing label.
   */
  readonly labelled?: boolean | undefined;
  readonly size?: 14 | 16 | undefined;
  readonly className?: string | undefined;
}

export function StepTypeGlyph({ kind, labelled = true, size = 16, className }: StepTypeGlyphProps) {
  const label = STEP_KIND_LABELS[kind];
  return (
    <svg
      className={cx('frl-step-glyph', `frl-step-glyph--${kind}`, className)}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      data-step-kind={kind}
      {...(labelled ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {labelled && <title>{label}</title>}
      {GLYPHS[kind]}
    </svg>
  );
}
