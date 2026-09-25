/**
 * Where a number came from. Every derived number in the UI carries one of these so estimates are
 * never presented as observed facts (docs/ARCHITECTURE.md §2 principle 3).
 *
 * - `source`: taken from source data (for example a quest's XP reward in the dataset).
 * - `assumption`: produced by a user-configurable assumption (for example seconds per kill).
 * - `derived`: computed from sources and assumptions (for example a level projection).
 * - `unknown`: cannot be computed; `value` is null.
 */
export type EstimateBasis = 'source' | 'assumption' | 'derived' | 'unknown';

export interface Estimated<T> {
  readonly value: T | null;
  readonly basis: EstimateBasis;
  /** True when an Era value stood in for an unknown Forever value somewhere in the chain. */
  readonly eraFallback: boolean;
}

export const unknownEstimate = <T>(): Estimated<T> => ({ value: null, basis: 'unknown', eraFallback: false });

export const estimate = <T>(value: T, basis: Exclude<EstimateBasis, 'unknown'>, eraFallback = false): Estimated<T> => ({
  value,
  basis,
  eraFallback,
});
