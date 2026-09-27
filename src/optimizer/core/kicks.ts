import type { AnytimeHost } from './anytime';
import type { LocalSearch } from './local';
import type { SearchSolution } from './types';

/**
 * The iterated local search (docs/research/optimizer-m7.md §19; review M7Q Q-01): after the seeds,
 * the budget the beam cannot use goes to kicks. Each kick takes the current order (the best found),
 * swaps two adjacent segments of it (a jump the local pass's 24-place window cannot make), restores
 * every precedence edge inside the kicked span without moving anything else, and runs the local pass
 * from there with only the units near the three new junctions dirty. The pass's end replaces the
 * current order when its `comparedMs` is lower or equal (an equal order lets the kicks move along a
 * plateau); every improvement it finds on the way is reported to the host like any other. The kicked order is priced by the pass itself with the search's own
 * transitions and closing, so the section contract holds as for every other order.
 *
 * Deterministic: the segments come from a Lehmer sequence with a fixed seed (as the hash constants,
 * §7.2), advanced once per kick, so a run is reproducible and never depends on the slices (a kick's
 * choice is atomic; the pass resumes exactly where it paused). No clock and no randomness.
 *
 * The search stops kicking when the current order has not improved (strictly) for `stallAllowance`
 * evaluations (termination `converged`, review M7Q Q-07), or at the budget.
 */

/** Sections with fewer units than this are left to the beam (which is near-exhaustive there). */
export const KICK_MIN_UNITS = 16;
/** The longest segment a kick moves. */
export const KICK_MAX_SEGMENT = 30;
/** The Lehmer seed of the kicks (fixed). */
export const KICK_SEED = 20260928;
/** The stall allowance is `max(KICK_STALL_FLOOR, KICK_STALL_PER_UNIT × units)` evaluations. */
export const KICK_STALL_FLOOR = 100_000;
export const KICK_STALL_PER_UNIT = 2_000;
/** The units dirtied around each junction of a kick, either way. */
const FOCUS = 2;

export class Kicks {
  private x: number;
  /** The current order (a local optimum) and its `comparedMs`. */
  private current: Int32Array | null = null;
  private currentMs = Number.POSITIVE_INFINITY;
  /** The kicked order the pass in progress started from. */
  private kicked: { readonly units: Int32Array } | null = null;
  private focus: number[] = [];
  /** The run's evaluation count when the current order last improved (or the kicks started). */
  private improvedAt = 0;
  private readonly inSpan: Uint8Array;
  private readonly placed: Uint8Array;
  readonly stallAllowance: number;
  /** Kicks started, and kicks whose pass ended at or below the current order. */
  iterations = 0;
  accepted = 0;

  /** `seed`: the kicks' Lehmer seed (another one only for an independent reference run). */
  constructor(
    private readonly host: AnytimeHost,
    private readonly local: LocalSearch,
    seed = KICK_SEED,
  ) {
    this.x = seed;
    const units = host.t.units;
    this.inSpan = new Uint8Array(units);
    this.placed = new Uint8Array(units);
    this.stallAllowance = Math.max(KICK_STALL_FLOOR, KICK_STALL_PER_UNIT * units);
  }

  /** Set when there is nothing to kick (no solution, or an order too short). */
  private impossible = false;

  /** Whether the current order has not improved for the stall allowance (or cannot be kicked). */
  get stalled(): boolean {
    return this.impossible || (this.current !== null && this.host.meter.evaluations - this.improvedAt >= this.stallAllowance);
  }

  private next(): number {
    this.x = (this.x * 48271) % 2147483647;
    return this.x;
  }

  /**
   * One kick and its pass from the best solution (`best` is read when the first kick starts, and
   * whenever it is better than the current order); true when the kick is complete.
   */
  step(best: SearchSolution | undefined): boolean {
    if (this.kicked === null) {
      if (best === undefined) {
        this.impossible = true;
        return true;
      }
      if (this.current === null || best.comparedMs < this.currentMs) {
        if (this.current === null) this.improvedAt = this.host.meter.evaluations;
        this.current = best.units.slice();
        this.currentMs = best.comparedMs;
      }
      const kicked = this.kick(this.current);
      this.iterations += 1;
      if (kicked === null) {
        this.impossible = true;
        return true;
      }
      this.kicked = { units: kicked };
    }
    if (!this.local.step(this.kicked, this.focus, false)) return false;
    this.kicked = null;
    if (this.local.resultMs <= this.currentMs) {
      if (this.local.resultMs < this.currentMs) this.improvedAt = this.host.meter.evaluations;
      this.current = this.local.resultUnits();
      this.currentMs = this.local.resultMs;
      this.accepted += 1;
    }
    return true;
  }

  /**
   * The order with segments [a, b) and [b, c) swapped, the span [a, c) re-ordered stably so that
   * every precedence edge inside it holds (edges into it from outside held before and still do);
   * null when the order is too short. `focus` gets the positions around the three junctions.
   */
  private kick(order: Int32Array): Int32Array | null {
    const n = order.length;
    const longest = Math.min(KICK_MAX_SEGMENT, Math.floor(n / 3));
    if (longest < 1) return null;
    const l1 = 1 + (this.next() % longest);
    const l2 = 1 + (this.next() % longest);
    const a = this.next() % (n - l1 - l2 + 1);
    const b = a + l1;
    const c = b + l2;
    const out = order.slice();
    out.set(order.subarray(b, c), a);
    out.set(order.subarray(a, b), a + l2);
    this.repair(out, a, c);
    this.focus = [a - FOCUS, a + FOCUS, a + l2 - FOCUS, a + l2 + FOCUS, c - FOCUS, c + FOCUS];
    return out;
  }

  /** Stable repair of span [a, c): each unit after its predecessors in the span, else in kicked order. */
  private repair(out: Int32Array, a: number, c: number): void {
    const { predStart, pred } = this.host.problem.edges;
    const span = Array.from(out.subarray(a, c));
    for (const u of span) this.inSpan[u] = 1;
    let at = a;
    while (at < c) {
      let pick = -1;
      for (let k = 0; k < span.length && pick < 0; k += 1) {
        const u = span[k] ?? 0;
        if ((this.placed[u] ?? 0) === 1) continue;
        let ready = true;
        for (let e = predStart[u] ?? 0; e < (predStart[u + 1] ?? 0) && ready; e += 1) {
          const p = pred[e] ?? 0;
          if ((this.inSpan[p] ?? 0) === 1 && (this.placed[p] ?? 0) === 0) ready = false;
        }
        if (ready) pick = u;
      }
      // The span's edges were acyclic in the order before the kick, so a ready unit always exists.
      if (pick < 0) throw new Error('A kicked span has a precedence cycle');
      this.placed[pick] = 1;
      out[at] = pick;
      at += 1;
    }
    for (const u of span) {
      this.inSpan[u] = 0;
      this.placed[u] = 0;
    }
  }

  get bytes(): number {
    return this.inSpan.byteLength + this.placed.byteLength;
  }
}
