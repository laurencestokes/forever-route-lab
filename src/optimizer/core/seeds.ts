import { type AnytimeHost, entryMs } from './anytime';
import { solutionOf } from './evaluate';
import { Layer, S_ELAPSED, S_WAIT_EXCESS } from './state';
import { type Closed, loadScalars, type NodeState, SCALAR_COUNT, saveScalars } from './transitions';
import type { SearchSolution } from './types';

/**
 * The constructive seeds (docs/research/optimizer-m7.md §19; review M7 open item 1): two complete
 * orders built before the beam's first layer, so a weak original never leaves the search far from
 * a plain tour of the same pool. Each seed applies units with the search's own transitions
 * (`enabled`, `apply` and `close`), so anchors, blocks, bound units, precedence and availability
 * edges, the level and log-capacity checks, carried work and the unknown-XP rules hold exactly as
 * for a beam node, and a seed is listed only when it closes under the full closing rules. Each
 * transition applied counts one evaluation; `step()` may pause between atomic sub-steps and resumes
 * exactly there, so a seed never depends on the slices. No clock and no randomness: ties go to the
 * lower unit index (the original order).
 */

/** The better of a seed's result so far and a newly closed order (by `comparedMs`; ties keep the first). */
function better(result: SearchSolution | null, units: ArrayLike<number>, closed: Closed): SearchSolution {
  return result !== null && result.comparedMs <= closed.comparedMs ? result : solutionOf(units, closed);
}

/** Restores a working state after a trial `apply` (which may have changed it in part). */
function undo(host: AnytimeHost, s: NodeState, u: number, snapshot: Float64Array): void {
  host.t.undoStatuses(s, 0);
  s.scheduled[u] = 0;
  loadScalars(snapshot, s);
}

/**
 * The enabled unit nearest to `s` (by `entryMs`, preferring units whose scheduling drops no quest,
 * then the lower unit index) that the transitions accept, applied to `s`; −1 when none is (then `s`
 * is unchanged). Each trial counts one evaluation.
 */
function applyNearest(host: AnytimeHost, s: NodeState, snapshot: Float64Array, cands: number[], dist: Float64Array, drops: Uint8Array): number {
  const { t, meter, problem } = host;
  const { predStart, pred } = problem.edges;
  cands.length = 0;
  for (let u = 0; u < t.units; u += 1) {
    if (!t.enabled(s, u)) continue;
    cands.push(u);
    dist[u] = entryMs(problem, s, u);
    let drop = 0;
    for (let k = predStart[u] ?? 0; k < (predStart[u + 1] ?? 0) && drop === 0; k += 1) {
      const p = pred[k] ?? 0;
      if ((s.scheduled[p] ?? 0) === 0 && !t.unitDropped(s, p)) drop = 1;
    }
    drops[u] = drop;
  }
  cands.sort((a, b) => (drops[a] ?? 0) - (drops[b] ?? 0) || (dist[a] ?? 0) - (dist[b] ?? 0) || a - b);
  for (const u of cands) {
    meter.spend();
    t.logSize = 0;
    saveScalars(s, snapshot);
    if (t.applyEnabled(s, u)) {
      t.logSize = 0;
      return u;
    }
    undo(host, s, u, snapshot);
  }
  t.logSize = 0;
  return -1;
}

/**
 * Nearest neighbour: from the section start, repeatedly schedule the enabled unit whose first
 * destination is nearest (matrix ms at the current riding tier), preferring units whose scheduling
 * drops no quest, then the lower unit index. A candidate the transitions refuse (a level or log
 * check, a condition, a bind position) is skipped for the next nearest. The order is tested for
 * closing after each unit, and the seed stops at the first close that meets the target without a
 * fill, as a rollout does (optional units only add time).
 */
export class NearestNeighbourSeed {
  /** The seed's best closed order (null until one closes). */
  result: SearchSolution | null = null;
  private readonly s: NodeState;
  private readonly seq: number[] = [];
  private readonly snapshot = new Float64Array(SCALAR_COUNT);
  private readonly candidates: number[] = [];
  private readonly dist: Float64Array;
  private readonly drops: Uint8Array;

  constructor(private readonly host: AnytimeHost) {
    this.s = host.t.createState();
    this.dist = new Float64Array(host.t.units);
    this.drops = new Uint8Array(host.t.units);
  }

  /** Runs the seed; true when it is complete (closed, or at a dead end). */
  step(): boolean {
    const { t, meter, problem } = this.host;
    const s = this.s;
    for (;;) {
      if (meter.paused) return false;
      const chosen = applyNearest(this.host, s, this.snapshot, this.candidates, this.dist, this.drops);
      if (chosen < 0) return true;
      this.seq.push(chosen);
      const closed = t.close(s);
      if (closed === null) this.host.noteRefusal();
      else {
        this.result = better(this.result, this.seq, closed);
        this.host.addSolution(this.seq, closed);
        if (closed.fillXp === 0 && closed.knownGain >= problem.targetXp) return true;
      }
    }
  }
}

/**
 * The insertion seed's allowance per unit (review M7Q Q-03): it may spend
 * `min(INSERTION_PER_UNIT × units, budget / 2)` evaluations before it finishes by nearest neighbour.
 * It depends on the section's size, not on the budget, so a larger budget only continues the same
 * run. Measured on 20 generated 100-quest pools at 2,000,000 evaluations, an allowance of about
 * 200,000 left the best 1.0% lower on average than 500,000, 0.4% lower than 1,000,000 and 1.0%
 * lower than no insertion seed.
 */
export const INSERTION_PER_UNIT = 700;

/** A unit's insertion state. */
const WAITING = 0;
const OPEN = 1;
const PLACED = 2;

/**
 * Cheapest insertion: starting from the empty order, repeatedly insert the open unit (every
 * precedence predecessor placed) whose cheapest position adds the least time, at that position
 * (ties: the lower unit index, then the earlier position). A position is priced by applying the
 * unit and the unit after it from the stored state before the position, against the stored state
 * after that next unit: the added travel and work, from exact transitions. Positions are never
 * before the unit's last predecessor, so every order built keeps the edges.
 *
 * Each open unit's best position is kept between insertions: an insertion at position k shifts the
 * later positions and splits position k in two, so only the two new positions are priced for each
 * open unit, and a unit whose best position was the split one is priced again in full. Before an
 * insertion, the whole remaining order is re-applied with the unit in place (a later accept may no
 * longer fit the log, a later check may fail); a refused position falls back to the unit's other
 * positions in cost order, and a unit that fits nowhere waits for the next insertion. Every unit is
 * inserted, so no quest is dropped, and the full order is closed at the end.
 *
 * Its cost grows faster than n² and varies with the pool (review M7Q Q-03: 320,000 to 1,000,000
 * evaluations for 300 units, median about 500,000; over 2,000,000 for 600). So it has an allowance
 * (`INSERTION_PER_UNIT`): when that is spent, the partial order is finished by
 * nearest neighbour from its end (every unit left, nearest first, as the nearest-neighbour seed
 * chooses, until none is enabled) and closed, so the spend always yields a route. It ends without a
 * result only at the run's budget or when no open unit fits.
 */
export class InsertionSeed {
  /** The seed's closed order (null until it closes). */
  result: SearchSolution | null = null;
  /** Row k: the state after the first k units of the partial order. */
  private readonly prefix: Layer;
  /** The rows a verification builds, copied into `prefix` when the insertion is made. */
  private readonly trial: Layer;
  private readonly w: NodeState;
  private readonly seq: Int32Array;
  private readonly pos: Int32Array;
  private readonly status: Uint8Array;
  private readonly bestCost: Float64Array;
  private readonly bestGap: Int32Array;
  private readonly gapCost: Float64Array;
  private readonly gaps: number[] = [];
  private m = 0;
  private started = false;
  private phase: 'open' | 'pick' | 'verify' | 'fallback' | 'update' | 'finish' = 'open';
  /** Whether the allowance ran out and the order was finished by nearest neighbour. */
  finished = false;
  private readonly snapshot = new Float64Array(SCALAR_COUNT);
  private readonly candidates: number[] = [];
  private readonly dist: Float64Array;
  private readonly drops: Uint8Array;
  private cursor = 0;
  private pick = -1;
  private placedAt = -1;
  /** The meter's count when the seed started, and what it may spend. */
  private startedAt = 0;
  private readonly allowance: number;

  constructor(private readonly host: AnytimeHost) {
    const t = host.t;
    this.prefix = new Layer(t.units + 1, t.units, t.quests);
    this.trial = new Layer(t.units + 1, t.units, t.quests);
    this.w = t.createState();
    this.seq = new Int32Array(t.units);
    this.pos = new Int32Array(t.units).fill(-1);
    this.status = new Uint8Array(t.units);
    this.bestCost = new Float64Array(t.units).fill(Number.POSITIVE_INFINITY);
    this.bestGap = new Int32Array(t.units).fill(-1);
    this.gapCost = new Float64Array(t.units + 1);
    this.dist = new Float64Array(t.units);
    this.drops = new Uint8Array(t.units);
    this.allowance = Math.min(INSERTION_PER_UNIT * t.units, Math.floor(host.meter.max / 2));
  }

  get bytes(): number {
    return this.prefix.bytes + this.trial.bytes;
  }

  /** Applies one unit to the working state, counting it. */
  private applyOne(u: number): boolean {
    this.host.meter.spend();
    const ok = this.host.t.apply(this.w, u);
    this.host.t.logSize = 0;
    return ok;
  }

  private timeAt(row: number): number {
    const at = row * SCALAR_COUNT;
    return (this.prefix.scalars[at + S_ELAPSED] ?? 0) + (this.prefix.scalars[at + S_WAIT_EXCESS] ?? 0);
  }

  /** The time inserting `u` at position k adds, or +∞ when the transitions refuse it. */
  private price(u: number, k: number): number {
    this.prefix.load(k, this.w);
    if (!this.applyOne(u)) return Number.POSITIVE_INFINITY;
    if (k < this.m) {
      if (!this.applyOne(this.seq[k] ?? 0)) return Number.POSITIVE_INFINITY;
      return this.w.elapsed + this.w.waitExcess - this.timeAt(k + 1);
    }
    return this.w.elapsed + this.w.waitExcess - this.timeAt(k);
  }

  /** The first position after every predecessor of `u`. */
  private lowest(u: number): number {
    const { predStart, pred } = this.host.problem.edges;
    let lo = 0;
    for (let k = predStart[u] ?? 0; k < (predStart[u + 1] ?? 0); k += 1) lo = Math.max(lo, (this.pos[pred[k] ?? 0] ?? -1) + 1);
    return lo;
  }

  /** Whether every predecessor of `u` is placed. */
  private ready(u: number): boolean {
    const { predStart, pred } = this.host.problem.edges;
    for (let k = predStart[u] ?? 0; k < (predStart[u + 1] ?? 0); k += 1) if ((this.pos[pred[k] ?? 0] ?? -1) < 0) return false;
    return true;
  }

  /** A candidate position for `u`: kept when cheaper, or as cheap and earlier. */
  private offer(u: number, k: number, cost: number): void {
    const best = this.bestCost[u] ?? Number.POSITIVE_INFINITY;
    if (cost < best || (cost === best && cost !== Number.POSITIVE_INFINITY && k < (this.bestGap[u] ?? 0))) {
      this.bestCost[u] = cost;
      this.bestGap[u] = k;
    }
  }

  /** Prices every position of `u`. */
  private full(u: number): void {
    this.bestCost[u] = Number.POSITIVE_INFINITY;
    this.bestGap[u] = -1;
    for (let k = this.lowest(u); k <= this.m; k += 1) this.offer(u, k, this.price(u, k));
  }

  /** Whether the whole order applies with `u` at position k; the states after it go to `trial`. */
  private verify(u: number, k: number): boolean {
    this.prefix.load(k, this.w);
    if (!this.applyOne(u)) return false;
    this.trial.store(k + 1, this.w, -1);
    for (let j = k; j < this.m; j += 1) {
      if (!this.applyOne(this.seq[j] ?? 0)) return false;
      this.trial.store(j + 2, this.w, -1);
    }
    return true;
  }

  private insert(u: number, k: number): void {
    this.seq.copyWithin(k + 1, k, this.m);
    this.seq[k] = u;
    this.m += 1;
    for (let j = k; j < this.m; j += 1) this.pos[this.seq[j] ?? 0] = j;
    for (let r = k + 1; r <= this.m; r += 1) {
      this.prefix.copyRows(r, this.trial, r);
      this.prefix.scalars.set(this.trial.scalars.subarray(r * SCALAR_COUNT, (r + 1) * SCALAR_COUNT), r * SCALAR_COUNT);
    }
    this.status[u] = PLACED;
    this.placedAt = k;
    this.cursor = 0;
    this.phase = 'update';
  }

  /** After an insertion at `placedAt`: opens units whose predecessors are all placed, and re-prices the rest. */
  private update(u: number): void {
    const status = this.status[u] ?? PLACED;
    if (status === WAITING) {
      if (this.ready(u)) {
        this.status[u] = OPEN;
        this.full(u);
      }
      return;
    }
    if (status !== OPEN) return;
    const k = this.placedAt;
    const gap = this.bestGap[u] ?? -1;
    if (gap === k || gap < 0) {
      this.full(u);
      return;
    }
    if (gap > k) this.bestGap[u] = gap + 1;
    const lo = this.lowest(u);
    for (let g = k; g <= k + 1; g += 1) if (g >= lo && g <= this.m) this.offer(u, g, this.price(u, g));
  }

  /** Runs the seed; true when it is complete (closed, abandoned at the budget, or when no unit fits). */
  step(): boolean {
    const { t, meter } = this.host;
    if (!this.started) {
      this.started = true;
      this.startedAt = meter.evaluations;
      this.prefix.store(0, t.createState(), -1);
    }
    for (;;) {
      if (meter.spent) return true;
      if (this.phase !== 'finish' && meter.evaluations - this.startedAt >= this.allowance) {
        // The allowance is spent: finish the partial order by nearest neighbour from its end.
        this.prefix.load(this.m, this.w);
        this.finished = true;
        this.phase = 'finish';
      }
      if (meter.paused) return false;
      switch (this.phase) {
        case 'finish': {
          const chosen = applyNearest(this.host, this.w, this.snapshot, this.candidates, this.dist, this.drops);
          if (chosen >= 0) {
            this.seq[this.m] = chosen;
            this.m += 1;
            break;
          }
          const closed = t.close(this.w);
          if (closed === null) this.host.noteRefusal();
          else {
            this.result = better(null, this.seq.subarray(0, this.m), closed);
            this.host.addSolution(this.seq.subarray(0, this.m), closed);
          }
          return true;
        }
        case 'open': {
          if (this.cursor >= t.units) {
            this.phase = 'pick';
            break;
          }
          const u = this.cursor;
          this.cursor += 1;
          if (this.ready(u)) {
            this.status[u] = OPEN;
            this.full(u);
          }
          break;
        }
        case 'pick': {
          if (this.m === t.units) {
            this.prefix.load(this.m, this.w);
            const closed = t.close(this.w);
            if (closed === null) this.host.noteRefusal();
            else {
              this.result = better(null, this.seq.subarray(0, this.m), closed);
              this.host.addSolution(this.seq.subarray(0, this.m), closed);
            }
            return true;
          }
          let pick = -1;
          for (let u = 0; u < t.units; u += 1) {
            if (this.status[u] !== OPEN) continue;
            if (pick < 0 || (this.bestCost[u] ?? 0) < (this.bestCost[pick] ?? 0)) pick = u;
          }
          if (pick < 0 || this.bestCost[pick] === Number.POSITIVE_INFINITY) return true;
          this.pick = pick;
          this.phase = 'verify';
          break;
        }
        case 'verify': {
          const k = this.bestGap[this.pick] ?? 0;
          if (this.verify(this.pick, k)) {
            this.insert(this.pick, k);
            break;
          }
          // The cheapest position breaks the rest of the order: the others, in cost order.
          this.gaps.length = 0;
          for (let g = this.lowest(this.pick); g <= this.m; g += 1) {
            if (g === k) continue;
            const c = this.price(this.pick, g);
            if (c === Number.POSITIVE_INFINITY) continue;
            this.gapCost[g] = c;
            this.gaps.push(g);
          }
          this.gaps.sort((a, b) => (this.gapCost[a] ?? 0) - (this.gapCost[b] ?? 0) || a - b);
          this.cursor = 0;
          this.phase = 'fallback';
          break;
        }
        case 'fallback': {
          if (this.cursor >= this.gaps.length) {
            // It fits nowhere now: it waits for the next insertion.
            this.bestCost[this.pick] = Number.POSITIVE_INFINITY;
            this.bestGap[this.pick] = -1;
            this.phase = 'pick';
            break;
          }
          const g = this.gaps[this.cursor] ?? 0;
          this.cursor += 1;
          if (this.verify(this.pick, g)) this.insert(this.pick, g);
          break;
        }
        case 'update': {
          if (this.cursor >= t.units) {
            this.phase = 'pick';
            break;
          }
          const u = this.cursor;
          this.cursor += 1;
          this.update(u);
          break;
        }
      }
    }
  }
}
