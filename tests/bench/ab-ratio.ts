/**
 * The ratios of an interleaved A/B (tests/bench/ab-derived.ts): each tree's median of the runs'
 * medians against a reference tree's, per case. The reference is the first label; a case the first
 * label's tree does not have (a case added after it, such as `taxiArrives`) is compared with the
 * next label whose tree has it, and the row names that label, so a checked case never goes without
 * a ratio (review C-12). A ratio against a later tree is not the gate's ratio against the
 * pre-rework tree: the row says which tree it is against, and the reader judges it as such.
 */

export const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? Number.NaN) : ((sorted[mid - 1] ?? Number.NaN) + (sorted[mid] ?? Number.NaN)) / 2;
};

export interface RatioCell {
  readonly median: number;
  readonly min: number;
  readonly max: number;
  /** Against `against`'s median; null for the reference itself. */
  readonly ratio: number | null;
}

export interface RatioRow {
  /** The label the ratios are against: the first label that has the case; null when none has it. */
  readonly against: string | null;
  readonly cells: Readonly<Record<string, RatioCell | 'absent'>>;
}

/** One case's row: every label's median, spread and ratio, absent where its tree lacks the case. */
export function ratioRow(labels: readonly string[], samplesOf: (label: string) => readonly number[] | undefined): RatioRow {
  const against = labels.find((label) => (samplesOf(label)?.length ?? 0) > 0) ?? null;
  const base = against === null ? undefined : samplesOf(against);
  const cells: Record<string, RatioCell | 'absent'> = {};
  for (const label of labels) {
    const values = samplesOf(label);
    if (values === undefined || values.length === 0) {
      cells[label] = 'absent';
      continue;
    }
    const m = median(values);
    cells[label] = { median: m, min: Math.min(...values), max: Math.max(...values), ratio: base === undefined || label === against ? null : m / median(base) };
  }
  return { against, cells };
}

/** What the printed row adds about its reference: nothing for the first label, else which tree it is against, or that only one tree has the case. */
export function againstNote(row: RatioRow, reference: string): string {
  if (row.against === null || row.against === reference) return '';
  const others = Object.entries(row.cells).filter(([label, cell]) => label !== row.against && cell !== 'absent');
  return others.length === 0 ? ` (only ${row.against} has the case: no ratio)` : ` (vs ${row.against}: ${reference} lacks the case)`;
}
