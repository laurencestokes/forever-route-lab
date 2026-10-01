/**
 * Small statistics for the browser harness: nearest-rank quantiles over raw samples and the
 * median-with-spread summaries the A/B reports (docs/measurements: "median [min-max]").
 */

export const round1 = (value: number): number => Math.round(value * 10) / 10;

/** The q-quantile by nearest rank (q in [0, 1]); NaN for no samples. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(q * sorted.length)));
  return sorted[rank - 1] ?? Number.NaN;
}

/** The median (the mean of the two middle values for an even count); NaN for no samples. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? Number.NaN) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export interface Summary {
  readonly n: number;
  readonly median: number;
  readonly p90: number;
  readonly min: number;
  readonly max: number;
}

/** n, median, p90 (nearest rank), min and max, rounded to 0.1 ms. */
export function summary(values: readonly number[]): Summary {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return { n: 0, median: Number.NaN, p90: Number.NaN, min: Number.NaN, max: Number.NaN };
  return {
    n: finite.length,
    median: round1(median(finite)),
    p90: round1(quantile(finite, 0.9)),
    min: round1(Math.min(...finite)),
    max: round1(Math.max(...finite)),
  };
}

/** Median and spread of per-round values (each round contributes one value, e.g. its median). */
export interface Spread {
  readonly n: number;
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly values: readonly number[];
}

export function spread(values: readonly number[]): Spread {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return { n: 0, median: Number.NaN, min: Number.NaN, max: Number.NaN, values: [] };
  return { n: finite.length, median: round1(median(finite)), min: round1(Math.min(...finite)), max: round1(Math.max(...finite)), values: finite.map(round1) };
}
