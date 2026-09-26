import { cx } from '../lib/cx';
import './markers.css';

/** The default reason: a travel time that waits for its walking path (terrain-navigation.md §9.3). */
export const PENDING_TRAVEL_TEXT = 'Pending: the walking path is still being computed, so the travel time is a straight-line estimate for now';

/** A travel time that waits for the navigation data to be checked (the manifest is still loading). */
export const PENDING_CHECKING_TEXT = 'Pending: the navigation data is still being checked, so the travel time is a straight-line estimate for now';

/**
 * Why a step's travel time is provisional (terrain-navigation.md §9.3-§9.4; one reason for the whole
 * route, src/app/derived.ts `pendingTravelReason`; review UI-04):
 * - `path`: its walking leg is still being computed (or about to be);
 * - `retrying`: computing failed in a way that may pass, and is tried again shortly;
 * - `paused`: the user paused computing walking paths;
 * - `failed`: computing stopped on an unexpected error;
 * - `checking`: the navigation data is still being checked, so every travel time is a
 *   straight-line estimate until it is.
 */
export type PendingTravel = 'path' | 'retrying' | 'paused' | 'failed' | 'checking';

/** The pending marker's words for a step's travel time. */
export const PENDING_TRAVEL_TEXTS: Readonly<Record<PendingTravel, string>> = {
  path: PENDING_TRAVEL_TEXT,
  retrying: 'Pending: computing the walking path failed and will be tried again shortly, so the travel time is a straight-line estimate for now',
  paused: 'Pending: computing walking paths is paused, so the travel time is a straight-line estimate until you resume',
  failed: 'Pending: the walking path could not be computed, so the travel time is a straight-line estimate',
  checking: PENDING_CHECKING_TEXT,
};

export interface PendingMarkerProps {
  /** Why the number is provisional, for the tooltip and screen readers. */
  readonly detail?: string | undefined;
  /**
   * No spoken text: the name of what holds it already says it (a route row's `aria-label`). The
   * tooltip stays.
   */
  readonly silent?: boolean | undefined;
  readonly className?: string | undefined;
}

/**
 * A small neutral hourglass after (or beside) a number that is provisional: it will change when a
 * computation running in the background ends (a walking path being computed). Shape and words, never
 * colour alone (docs/UI.md §4); it is not the assumed marker, which means "depends on assumptions".
 */
export function PendingMarker({ detail = PENDING_TRAVEL_TEXT, silent = false, className }: PendingMarkerProps) {
  return (
    <span className={cx('frl-pending', className)} title={detail} data-state="pending">
      <svg className="frl-pending__glyph" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
        <path d="M2.5 1.25h7M2.5 10.75h7" />
        <path d="M3.5 1.25v1.4c0 1.3 1.1 2.15 2.5 3.35 1.4-1.2 2.5-2.05 2.5-3.35v-1.4M3.5 10.75v-1.4c0-1.3 1.1-2.15 2.5-3.35 1.4 1.2 2.5 2.05 2.5 3.35v1.4" />
      </svg>
      {!silent && <span className="frl-visually-hidden">({detail})</span>}
    </span>
  );
}
