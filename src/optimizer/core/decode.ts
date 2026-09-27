import { type IdSource, type StepId, stepId } from '../../domain/ids';
import type { GrindStep, RouteStep } from '../../domain/route';
import type { DecodeTable, SearchSolution, StepDependency } from './types';

/**
 * `decodeSolution` (docs/research/optimizer-m7.md §9 step 5, §10): a solution's units back to route
 * steps. Every step is the original step object (its id is its `sourceStepId`); dropped quests'
 * steps are left out; a terminal grind fill is a new `grind` step made with the injected
 * `IdSource`. The fill's step dependency requires every removed step and every moved XP-granting
 * step (turn-ins and completes): applying the fill alone would add grinding nothing needs.
 */

export interface DecodedSection {
  /** The section's new steps, in order. */
  readonly steps: readonly RouteStep[];
  /** Each step's source step id: the original's, or null for the fill. */
  readonly sourceStepIds: readonly (StepId | null)[];
  readonly dependencies: readonly StepDependency[];
}

/**
 * Positions kept in place: a maximum-weight increasing subsequence of `values` (fixed steps weigh
 * n + 1, the rest 1). Ties take the predecessor with the smaller value, then the end with the
 * smaller value (the diff's rule, §10).
 */
export function keptInPlace(values: readonly number[], fixed: readonly boolean[]): Set<number> {
  const n = values.length;
  const weight = (i: number): number => (fixed[i] === true ? n + 1 : 1);
  const best = new Float64Array(n);
  const prev = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i += 1) {
    best[i] = weight(i);
    for (let j = 0; j < i; j += 1) {
      if ((values[j] ?? 0) >= (values[i] ?? 0)) continue;
      const candidate = (best[j] ?? 0) + weight(i);
      const current = prev[i] ?? -1;
      if (candidate > (best[i] ?? 0) || (candidate === (best[i] ?? 0) && current >= 0 && (values[j] ?? 0) < (values[current] ?? 0))) {
        best[i] = candidate;
        prev[i] = j;
      }
    }
  }
  let end = -1;
  for (let i = 0; i < n; i += 1) {
    if (end < 0 || (best[i] ?? 0) > (best[end] ?? 0) || ((best[i] ?? 0) === (best[end] ?? 0) && (values[i] ?? 0) < (values[end] ?? 0))) end = i;
  }
  const out = new Set<number>();
  for (let i = end; i >= 0; i = prev[i] ?? -1) out.add(i);
  return out;
}

export function decodeSolution(decode: DecodeTable, solution: SearchSolution, ids: IdSource): DecodedSection {
  const steps: RouteStep[] = [];
  const sourceStepIds: (StepId | null)[] = [];
  const offsets: number[] = [];
  for (const u of solution.units) {
    for (let k = decode.unitStart[u] ?? 0; k < (decode.unitStart[u + 1] ?? 0); k += 1) {
      const offset = decode.unitSteps[k] ?? 0;
      const step = decode.steps[offset];
      if (step === undefined) throw new RangeError(`No section step ${String(offset)}`);
      steps.push(step);
      sourceStepIds.push(step.id);
      offsets.push(offset);
    }
  }
  const dependencies: StepDependency[] = [];
  if (solution.fillMs > 0 || solution.fillXp > 0) {
    if (decode.fillUntil === null) throw new Error('A grind fill needs a target level');
    const fill: GrindStep = {
      id: stepId(ids.next('step')),
      kind: 'grind',
      until: decode.fillUntil,
      mobLevel: null,
      xpPerHour: null,
      location: null,
      note: null,
      locked: false,
      groupId: null,
      condition: null,
      durationOverride: null,
      origin: { source: 'optimizer', ref: null },
      rxp: null,
      ext: null,
    };
    const kept = new Set(offsets);
    const removed = decode.steps.filter((_, offset) => !kept.has(offset)).map((step) => step.id);
    const inPlace = keptInPlace(
      offsets,
      offsets.map((offset) => (decode.fixed[offset] ?? 0) === 1),
    );
    const moved = offsets
      .map((offset, k) => ({ offset, k }))
      .filter(({ offset, k }) => {
        const step = decode.steps[offset];
        return !inPlace.has(k) && (step?.kind === 'turnin' || step?.kind === 'complete');
      })
      .map(({ offset }) => decode.steps[offset]?.id)
      .filter((id): id is StepId => id !== undefined);
    steps.push(fill);
    sourceStepIds.push(null);
    dependencies.push({ stepId: fill.id, requires: [...removed, ...moved] });
  }
  return { steps, sourceStepIds, dependencies };
}
