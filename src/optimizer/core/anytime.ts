import { NOT_REQUESTED } from './matrix';
import type { Closed, NodeState, Transitions } from './transitions';
import type { SearchProblem } from './types';

/**
 * What the anytime parts of the search share (docs/research/optimizer-m7.md §7.6, §19): the
 * evaluation meter, the transitions, and the solution list. The constructive seeds (`seeds.ts`)
 * and the local improvement (`local.ts`) are work items of the fixed sequence; each prices with the
 * search's own transitions and closing, so every order they report satisfies the section contract
 * exactly as a beam node does.
 */

/**
 * The evaluation meter. `left` is what the current `advance` call may still spend (a pause point,
 * never a result: items resume exactly where they paused); `evaluations` is the run's total, and
 * `max` the run's budget (`maxEvaluations`), which the seeds and the local pass read at their own
 * move boundaries (deterministic: it depends on the count alone, never on the slices).
 */
export class Meter {
  left = 0;
  evaluations = 0;

  constructor(readonly max: number) {}

  /** One transition applied (one evaluation). */
  spend(): void {
    this.left -= 1;
    this.evaluations += 1;
  }

  /**
   * Work that applies no transition (the local pass's arithmetic pre-screen): it shortens the
   * current slice, so a slice stays near its time, and never counts towards the budget or the
   * statistics. A pause changes no result.
   */
  work(fraction: number): void {
    this.left -= fraction;
  }

  /** The current `advance` call has spent its slice: pause. */
  get paused(): boolean {
    return this.left <= 0;
  }

  /** The run's budget is reached: a seed or pass ends at its next boundary. */
  get spent(): boolean {
    return this.evaluations >= this.max;
  }
}

export interface AnytimeHost {
  readonly problem: SearchProblem;
  readonly t: Transitions;
  readonly meter: Meter;
  /** Records a closed order (listed when it is among the best distinct `candidates`). */
  addSolution(units: ArrayLike<number>, closed: Closed): void;
  /** Records a close refused only by the XP-4 fill rule (review PAR-04). */
  noteRefusal(): void;
}

/**
 * A sentinel ranking after every real leg (unknown, cross-map or unrequested legs): above any sum
 * of Int32 matrix legs, and small enough that sums of a few thousand stay exact in doubles.
 */
export const FAR_MS = 1e12;

/**
 * The matrix ms from the state's location to unit `u`'s first destination (§7.4's `firstDest`): 0
 * for a unit without travel, from an unknown position, to an unresolved destination or to the same
 * point; `FAR_MS` for a sentinel leg. It is a ranking, not a price: the transitions price the move.
 */
export function entryMs(problem: SearchProblem, s: Pick<NodeState, 'loc' | 'tier'>, u: number): number {
  const from = s.loc;
  const kind = problem.units.firstDestKind[u] ?? 0;
  if (kind === 0 || from < 0) return 0;
  const n = problem.locations.count;
  let to = problem.units.firstDest[u] ?? -1;
  if (kind === 2) to = problem.spawnTables.data[to * (n + 1) + from + 1] ?? -1;
  if (to < 0) return 0;
  const points = problem.locations.pointId;
  if ((points[from] ?? -1) === (points[to] ?? -2)) return 0;
  const tier = problem.tierIndex[s.tier] ?? -1;
  if (tier < 0) return FAR_MS;
  const ms = problem.matrix[(tier * n + from) * n + to] ?? NOT_REQUESTED;
  return ms >= 0 ? ms : FAR_MS;
}
