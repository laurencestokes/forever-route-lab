import type { Estimated } from '../../domain/estimate';

/**
 * A number as the UI shows it, with everything a reader needs to judge it
 * (docs/ARCHITECTURE.md §2 principle 3, §12.4):
 *
 * - `value: null` means unknown, never 0; `unknownReason` says why.
 * - `lowerBound`: the true value is at least `value` (for example a level projection that
 *   skipped quests with unknown XP). Shown with a `≥` prefix.
 * - `assumed`: the number depends on a user or ruleset assumption. Shown with the assumed marker.
 * - `eraFallback`: an Era value stood in for an unknown Forever value somewhere in the chain.
 */
export interface Readout<T> {
  readonly value: T | null;
  readonly unknownReason: string | null;
  readonly lowerBound: boolean;
  readonly assumed: boolean;
  readonly eraFallback: boolean;
}

export interface ReadoutFlags {
  readonly lowerBound?: boolean;
  readonly assumed?: boolean;
  readonly eraFallback?: boolean;
}

export function knownReadout<T>(value: T, flags: ReadoutFlags = {}): Readout<T> {
  return {
    value,
    unknownReason: null,
    lowerBound: flags.lowerBound ?? false,
    assumed: flags.assumed ?? false,
    eraFallback: flags.eraFallback ?? false,
  };
}

export function unknownReadout<T>(reason: string): Readout<T> {
  return { value: null, unknownReason: reason, lowerBound: false, assumed: false, eraFallback: false };
}

/**
 * Converts a domain estimate. `assumption` basis marks the value as assumed; `unknown` basis
 * (or a null value) becomes an unknown readout with `unknownReason`.
 */
export function readoutFromEstimate<T>(
  estimate: Estimated<T>,
  unknownReason: string,
  flags: Pick<ReadoutFlags, 'lowerBound'> = {},
): Readout<T> {
  if (estimate.basis === 'unknown' || estimate.value === null) return unknownReadout<T>(unknownReason);
  return knownReadout(estimate.value, {
    lowerBound: flags.lowerBound ?? false,
    assumed: estimate.basis === 'assumption',
    eraFallback: estimate.eraFallback,
  });
}
