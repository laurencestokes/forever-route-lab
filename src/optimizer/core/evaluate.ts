import { hashLayout } from './hash';
import { Pricing } from './pricing';
import { type Closed, type NodeState, Transitions } from './transitions';
import type { SearchProblem, SearchSolution } from './types';

/**
 * `evaluateSequence` (docs/research/optimizer-m7.md §5.6, §11): prices one order of units exactly as
 * the search does, from the section start, and closes it. Units not listed are dropped at closing
 * (only droppable ones may be). Pure; it runs on the main thread (the compile self-check) and in
 * tests.
 */

export function createTransitions(problem: SearchProblem): Transitions {
  const pricing = new Pricing(problem);
  const layout = hashLayout({
    units: problem.units.count,
    quests: problem.quests.count,
    locations: problem.locations.count,
    visitKeys: problem.visitKeyCount,
    maxLevel: pricing.curve.maxLevel,
  });
  return new Transitions(problem, pricing, layout);
}

export interface SequenceResult {
  readonly closed: Closed;
  readonly state: NodeState;
}

/** Applies `units` in order and closes; `reference` skips the incumbent's limits (compile). */
export function runSequence(transitions: Transitions, units: ArrayLike<number>, reference: boolean): SequenceResult | { readonly infeasible: string } {
  const state = transitions.createState();
  for (let k = 0; k < units.length; k += 1) {
    const u = units[k] ?? -1;
    if (!Number.isInteger(u) || u < 0 || u >= transitions.units) return { infeasible: `unit ${String(u)} does not exist` };
    if (!transitions.apply(state, u)) return { infeasible: `unit ${String(u)} (position ${String(k)}): ${transitions.failure}` };
  }
  const closed = transitions.close(state, reference);
  if (closed === null) return { infeasible: `the sequence cannot close: ${transitions.failure}` };
  return { closed, state };
}

export function solutionOf(units: ArrayLike<number>, closed: Closed): SearchSolution {
  return {
    units: Int32Array.from(units),
    estimatedMs: closed.estimatedMs,
    comparedMs: closed.comparedMs,
    knownGain: closed.knownGain,
    fillXp: closed.fillXp,
    fillMs: closed.fillMs,
    exitMs: closed.exitMs,
    unknownParts: closed.unknownParts,
    uncertainWaits: closed.uncertainWaits,
  };
}

export function evaluateSequence(problem: SearchProblem, units: Int32Array): SearchSolution | { readonly infeasible: string } {
  const result = runSequence(createTransitions(problem), units, false);
  if ('infeasible' in result) return result;
  return solutionOf(units, result.closed);
}
