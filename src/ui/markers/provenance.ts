import type { RecordProvenance } from '../../domain/dataset';

/**
 * What the UI may say about a record's Forever status (D-026, ARCHITECTURE §12.4):
 *
 * - `new` / `changed` with `declaredBy: 'data'`: the upstream dataset diff says so
 *   (`upstreamDiff` is `forever-new` / `forever-changed`).
 * - `new` / `changed` with `declaredBy: 'user'`: the user declared it (`foreverStatus`).
 * - `unknown`: nothing supports a claim. This is every dataset record today.
 */
export type ForeverProvenance =
  | { readonly claim: 'new' | 'changed'; readonly declaredBy: 'data' | 'user' }
  | { readonly claim: 'unknown'; readonly declaredBy: null };

export const UNKNOWN_FOREVER_PROVENANCE: ForeverProvenance = { claim: 'unknown', declaredBy: null };

/** A user declaration wins over the data diff: it is the more specific, more recent claim. */
export function foreverProvenanceOf(provenance: Pick<RecordProvenance, 'upstreamDiff' | 'foreverStatus'>): ForeverProvenance {
  switch (provenance.foreverStatus) {
    case 'user-declared-new':
      return { claim: 'new', declaredBy: 'user' };
    case 'user-declared-changed':
      return { claim: 'changed', declaredBy: 'user' };
    case 'unknown':
      break;
  }
  switch (provenance.upstreamDiff) {
    case 'forever-new':
      return { claim: 'new', declaredBy: 'data' };
    case 'forever-changed':
      return { claim: 'changed', declaredBy: 'data' };
    case 'era':
    case 'era-coords':
      return UNKNOWN_FOREVER_PROVENANCE;
  }
}

/** Full sentence for tooltips and screen readers. */
export function describeForeverProvenance(provenance: ForeverProvenance): string {
  if (provenance.claim === 'unknown') return 'Forever status: unknown';
  const what = provenance.claim === 'new' ? 'New in Forever' : 'Changed in Forever';
  return provenance.declaredBy === 'user' ? `${what} (user-declared)` : `${what} (per the dataset)`;
}
