import type { NodeState, Transitions } from './transitions';
import type { SearchProblem } from './types';

/**
 * The ranking score (docs/research/optimizer-m7.md §7.4), integer milliseconds in doubles:
 *
 * `score = elapsedMs + waitExcessMs + nearestUsefulMs + remainingXpMs + divergencePenaltyMs × divergence`
 *
 * - `waitExcessMs`: the uncertain hearth waits' excess over the incumbent's (review COR-01/02), so
 *   the ranking agrees with `comparedMs`;
 * - `nearestUsefulMs`: the smallest matrix ms from the node's location to the first destination of
 *   an enabled unit, scanning the location's neighbour list (at most 48, by tier-0 ms); 0 when a
 *   unit without travel is enabled, when nothing is found, or when the position is unknown;
 * - `remainingXpMs`: the XP still short of the target at the incumbent's rate.
 *
 * It is a practical ranking, not a bound.
 */
export class Heuristic {
  private readonly n: number;
  private readonly noTravel: Int32Array;
  /** CSR per location: units whose first destination may be that location. */
  private readonly atStart: Int32Array;
  private readonly at: Int32Array;
  private readonly penaltyMs: number;

  constructor(
    private readonly problem: SearchProblem,
    private readonly transitions: Transitions,
    divergencePenalty: number,
  ) {
    const n = problem.locations.count;
    this.n = n;
    const units = problem.units;
    const noTravel: number[] = [];
    const lists: number[][] = Array.from({ length: n }, () => []);
    for (let u = 0; u < units.count; u += 1) {
      const kind = units.firstDestKind[u] ?? 0;
      const dest = units.firstDest[u] ?? -1;
      if (kind === 0) noTravel.push(u);
      else if (kind === 1) lists[dest]?.push(u);
      else {
        const seen = new Set<number>();
        for (let from = -1; from < n; from += 1) {
          const to = problem.spawnTables.data[dest * (n + 1) + from + 1] ?? -1;
          if (to < 0 || seen.has(to)) continue;
          seen.add(to);
          lists[to]?.push(u);
        }
      }
    }
    this.noTravel = Int32Array.from(noTravel);
    const start = new Int32Array(n + 1);
    const flat: number[] = [];
    lists.forEach((list, loc) => {
      start[loc] = flat.length;
      flat.push(...list);
    });
    start[n] = flat.length;
    this.atStart = start;
    this.at = Int32Array.from(flat);
    this.penaltyMs = Math.round(1000 * divergencePenalty);
  }

  /** Whether an enabled unit's first destination from `from` is `to`. */
  private enabledAt(s: NodeState, from: number, to: number): boolean {
    const units = this.problem.units;
    for (let k = this.atStart[to] ?? 0; k < (this.atStart[to + 1] ?? 0); k += 1) {
      const u = this.at[k] ?? 0;
      if ((units.firstDestKind[u] ?? 0) === 2) {
        const table = units.firstDest[u] ?? 0;
        if ((this.problem.spawnTables.data[table * (this.n + 1) + from + 1] ?? -1) !== to) continue;
      }
      if (this.transitions.enabled(s, u)) return true;
    }
    return false;
  }

  private nearestUseful(s: NodeState): number {
    const from = s.loc;
    if (from < 0) return 0;
    for (const u of this.noTravel) if (this.transitions.enabled(s, u)) return 0;
    if (this.enabledAt(s, from, from)) return 0;
    const tier = this.problem.tierIndex[s.tier] ?? 0;
    const { neighbourStart, neighbours, matrix } = this.problem;
    for (let k = neighbourStart[from] ?? 0; k < (neighbourStart[from + 1] ?? 0); k += 1) {
      const to = neighbours[k] ?? 0;
      if (!this.enabledAt(s, from, to)) continue;
      const ms = matrix[(tier * this.n + from) * this.n + to] ?? 0;
      return ms > 0 ? ms : 0;
    }
    return 0;
  }

  score(s: NodeState): number {
    const gain = s.knownTotal - this.problem.start.knownTotal;
    const incumbent = this.problem.incumbent;
    const remaining = Math.round((Math.max(0, this.problem.targetXp - gain) * incumbent.ms) / Math.max(1, incumbent.gain));
    return s.elapsed + s.waitExcess + this.nearestUseful(s) + remaining + this.penaltyMs * s.divergence;
  }
}
