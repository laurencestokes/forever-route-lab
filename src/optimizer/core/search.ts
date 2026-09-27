import { createTransitions, runSequence, solutionOf } from './evaluate';
import { addMod, P1, P2, powerOfTwoAtLeast, scalarLanes, tableSlot } from './hash';
import { Heuristic } from './heuristic';
import {
  Candidates,
  Layer,
  S_DIVERGENCE,
  S_ELAPSED,
  S_LAST_VISIT,
  S_LEVEL,
  S_LOC,
  S_READY_AT,
  S_SINCE_CAST,
  S_TIER,
  S_UNKNOWN_PARTS,
  S_UNKNOWN_XP,
  S_WAIT_EXCESS,
  S_XP_INTO,
  Trail,
} from './state';
import { type Closed, loadScalars, type NodeState, SCALAR_COUNT, saveScalars, type Transitions } from './transitions';
import type { AdvanceResult, SearchOptions, SearchOutcome, SearchProblem, SearchProgress, SearchSolution, SearchStats, SearchTermination, Stepper } from './types';

/**
 * The search (docs/research/optimizer-m7.md §7): a layered beam over units, with candidate records
 * in typed arrays, an arithmetic duplicate table with exact comparison, dominance pruning with at
 * most four entries per key, a total deterministic order, an ancestry trail, anytime greedy
 * rollouts, and a local improvement of the best solution after each rollout (review PRF-08). A run
 * is a fixed sequence of work items (rollout R0, local pass P0, layers L0-L7, rollout R8, P8, ...);
 * the budget is checked after each item and never cuts one short, and `advance(n)` may stop
 * anywhere inside an item and resume exactly there, so results never depend on slice sizes.
 *
 * No clock and no randomness: the lane constants are fixed.
 */

/** At most this many non-dominated entries per exact key (§7.3, review OP-17). */
export const ENTRIES_PER_KEY = 4;

/** The local pass moves one unit at most this many places either way (review PRF-08). */
export const DEFAULT_LOCAL_WINDOW = 24;

const EMPTY = -1;
const TOMBSTONE = -2;
/** The key's scalars (§7.1): with the scheduled set and the quest statuses, the exact state. */
const KEY_FIELDS: readonly number[] = [S_LOC, S_LAST_VISIT, S_TIER, S_UNKNOWN_XP, S_SINCE_CAST, S_LEVEL, S_XP_INTO];

function validate(options: SearchOptions): void {
  const positiveInteger = (name: string, value: number): void => {
    if (!Number.isInteger(value) || value < 1) throw new RangeError(`Invalid ${name} ${String(value)}: expected an integer of 1 or more`);
  };
  positiveInteger('beamWidth', options.beamWidth);
  positiveInteger('candidates', options.candidates);
  positiveInteger('rolloutEvery', options.rolloutEvery);
  if (!Number.isFinite(options.maxEvaluations) || options.maxEvaluations < 0) throw new RangeError(`Invalid maxEvaluations ${String(options.maxEvaluations)}`);
  if (!Number.isFinite(options.divergencePenalty) || options.divergencePenalty < 0) throw new RangeError(`Invalid divergencePenalty ${String(options.divergencePenalty)}`);
  const window = options.localWindow;
  if (window !== undefined && (!Number.isInteger(window) || window < 0)) throw new RangeError(`Invalid localWindow ${String(window)}: expected an integer of 0 or more`);
}

/** Lexicographic order of two unit sequences. */
function compareSequences(a: Int32Array, b: Int32Array): number {
  const n = Math.min(a.length, b.length);
  for (let k = 0; k < n; k += 1) {
    const d = (a[k] ?? 0) - (b[k] ?? 0);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

const sameSequence = (a: Int32Array, b: Int32Array): boolean => a.length === b.length && compareSequences(a, b) === 0;

/** What the duplicate table asks of the candidates it holds. */
export interface CandidateOrder {
  lanes(c: number): { readonly h1: number; readonly h2: number };
  /** The exact state comparison after a lane match. */
  sameKey(a: number, b: number): boolean;
  /** −1: a dominates b; 1: b dominates a; 2: equal on every dominance field; 0: neither. */
  dominance(a: number, b: number): number;
  /** The selection order (§7.3): negative when a comes first. */
  before(a: number, b: number): number;
}

/**
 * The layer's duplicate table (§7.2, §7.3): open addressing with linear probing on the lanes, an
 * exact comparison on every lane match, dominance within a key, and at most `ENTRIES_PER_KEY`
 * non-dominated entries per key (the last in the selection order goes, which may be the newcomer).
 */
export class DuplicateTable {
  readonly slots: Int32Array;
  /** Slots filled this layer (cleared at the layer's end). */
  private used = new Int32Array(1024);
  private usedCount = 0;
  duplicates = 0;
  dominated = 0;

  constructor(
    capacity: number,
    private readonly order: CandidateOrder,
    private readonly alive: (c: number, value: boolean) => void,
  ) {
    this.slots = new Int32Array(powerOfTwoAtLeast(capacity)).fill(EMPTY);
  }

  private group = new Int32Array(16);
  private groupSlots = new Int32Array(16);
  private groupSize = 0;

  /** Inserts candidate `c`; false when it is dropped (a duplicate, dominated, or beyond four entries). */
  insert(c: number): boolean {
    const cap = this.slots.length;
    const { h1, h2 } = this.order.lanes(c);
    let slot = tableSlot(h1, h2, cap);
    let free = -1;
    this.groupSize = 0;
    for (;;) {
      const e = this.slots[slot] ?? EMPTY;
      if (e === EMPTY) {
        if (free < 0) free = slot;
        break;
      }
      if (e === TOMBSTONE) {
        if (free < 0) free = slot;
      } else {
        const lanes = this.order.lanes(e);
        if (lanes.h1 === h1 && lanes.h2 === h2 && this.order.sameKey(e, c)) {
          if (this.groupSize === this.group.length) {
            const g = new Int32Array(this.group.length * 2);
            g.set(this.group);
            this.group = g;
            const gs = new Int32Array(this.groupSlots.length * 2);
            gs.set(this.groupSlots);
            this.groupSlots = gs;
          }
          this.group[this.groupSize] = e;
          this.groupSlots[this.groupSize] = slot;
          this.groupSize += 1;
        }
      }
      slot = slot + 1 === cap ? 0 : slot + 1;
    }
    const n = this.groupSize;
    // A newcomer an entry dominates, or equals on every field, is dropped: the first stays.
    for (let k = 0; k < n; k += 1) {
      const e = this.group[k] ?? 0;
      const d = this.order.dominance(e, c);
      if (d === -1 || d === 2) {
        this.alive(c, false);
        if (d === 2) this.duplicates += 1;
        else this.dominated += 1;
        return false;
      }
    }
    let keptCount = 0;
    let worst = c;
    let worstSlot = -1;
    for (let k = 0; k < n; k += 1) {
      const e = this.group[k] ?? 0;
      const es = this.groupSlots[k] ?? 0;
      if (this.order.dominance(c, e) === -1) {
        this.alive(e, false);
        this.slots[es] = TOMBSTONE;
        this.dominated += 1;
      } else {
        keptCount += 1;
        if (this.order.before(e, worst) > 0) {
          worst = e;
          worstSlot = es;
        }
      }
    }
    if (keptCount >= ENTRIES_PER_KEY) {
      this.alive(worst, false);
      this.duplicates += 1;
      if (worst === c) return false;
      this.slots[worstSlot] = TOMBSTONE;
    }
    this.slots[free] = c;
    if (this.usedCount === this.used.length) {
      const grown = new Int32Array(this.used.length * 2);
      grown.set(this.used);
      this.used = grown;
    }
    this.used[this.usedCount] = free;
    this.usedCount += 1;
    return true;
  }

  clear(): void {
    for (let k = 0; k < this.usedCount; k += 1) this.slots[this.used[k] ?? 0] = EMPTY;
    this.usedCount = 0;
  }
}

export function createSearch(problem: SearchProblem, options: SearchOptions): Stepper {
  return new BeamSearch(problem, options);
}

interface Budget {
  left: number;
}

class BeamSearch implements Stepper {
  private readonly t: Transitions;
  private readonly heuristic: Heuristic;
  private readonly beam: number;
  private readonly units: number;
  private readonly quests: number;
  private current: Layer;
  private next: Layer;
  private readonly cands: Candidates;
  private readonly trail: Trail;
  private readonly table: DuplicateTable;
  /** The working state for layer generation, and one for rollouts. */
  private readonly s: NodeState;
  private readonly r: NodeState;
  private readonly snapshot = new Float64Array(SCALAR_COUNT);
  private readonly lanes = { h1: 0, h2: 0 };
  readonly incumbent: SearchSolution;
  private readonly solutions: SearchSolution[] = [];
  // Counters.
  private evaluations = 0;
  private layers = 0;
  private rollouts = 0;
  private firstImprovement: number | null = null;
  private blockedCloses = 0;
  private smallestShortfall = Number.POSITIVE_INFINITY;
  // The work item in progress.
  private item = 0;
  private termination: SearchTermination | null = null;
  private exhausted = false;
  private parentRank = 0;
  private unitCursor = 0;
  private parentLoaded = false;
  private rolloutActive = false;
  private rolloutPhase: 'test' | 'children' = 'test';
  private rolloutBase: number[] = [];
  private readonly rolloutSeq: number[] = [];
  private rolloutBest = -1;
  private rolloutBestScore = Number.POSITIVE_INFINITY;
  private bestThisCall: SearchSolution | null = null;
  // The local pass (review PRF-08): the sequence, its prefix states, the move being tried.
  private readonly localWindow: number;
  private readonly prefix: Layer;
  private readonly w: NodeState;
  private readonly localSeq: Int32Array;
  private localLength = 0;
  private localActive = false;
  private localBuilt = 0;
  private localI = 0;
  private localD = 0;
  private localMs = 0;
  /** The solution the last pass started from: a pass is not repeated on an unchanged best. */
  private localBase: SearchSolution | null = null;
  /** The dominance fields (§7.3): divergence only when it is penalised. */
  private readonly dominanceFields: readonly number[];
  private readonly heap: Int32Array;

  constructor(
    private readonly problem: SearchProblem,
    private readonly options: SearchOptions,
  ) {
    validate(options);
    // The wait excess joins the fields (review COR-01): with it, and uncertain waits no longer
    // limited at closing, the closed `comparedMs` is monotone in every field (see `close`).
    const fields = [S_ELAPSED, S_READY_AT, S_UNKNOWN_PARTS, S_WAIT_EXCESS];
    this.dominanceFields = options.divergencePenalty > 0 ? [...fields, S_DIVERGENCE] : fields;
    this.t = createTransitions(problem);
    this.heuristic = new Heuristic(problem, this.t, options.divergencePenalty);
    this.beam = options.beamWidth;
    this.heap = new Int32Array(options.beamWidth);
    this.units = problem.units.count;
    this.quests = problem.quests.count;
    this.current = new Layer(this.beam, this.units, this.quests);
    this.next = new Layer(this.beam, this.units, this.quests);
    this.cands = new Candidates(Math.max(16, Math.min(this.beam * Math.max(1, this.units), 32_768)));
    this.trail = new Trail(this.beam * 4);
    const lanes = { h1: 0, h2: 0 };
    this.table = new DuplicateTable(
      2 * this.beam * Math.max(1, this.units),
      {
        lanes: (c) => {
          lanes.h1 = this.cands.h1[c] ?? 0;
          lanes.h2 = this.cands.h2[c] ?? 0;
          return lanes;
        },
        sameKey: (a, b) => this.sameKey(a, b),
        dominance: (a, b) => this.dominance(a, b),
        before: (a, b) => this.before(a, b),
      },
      (c, value) => {
        this.cands.alive[c] = value ? 1 : 0;
      },
    );
    this.s = this.t.createState();
    this.r = this.t.createState();
    this.w = this.t.createState();
    // The pass reorders freely, so it stays off when out-of-order units are penalised.
    this.localWindow = options.divergencePenalty > 0 ? 0 : (options.localWindow ?? DEFAULT_LOCAL_WINDOW);
    this.prefix = new Layer(this.localWindow > 0 ? this.units + 1 : 0, this.units, this.quests);
    this.localSeq = new Int32Array(this.units);
    // The incumbent (the original order) seeds the solutions (§7.5).
    const incumbentUnits = Int32Array.from({ length: this.units }, (_, u) => u);
    const priced = runSequence(createTransitions(problem), incumbentUnits, true);
    if ('infeasible' in priced) throw new Error(`The incumbent is infeasible: ${priced.infeasible}`);
    this.incumbent = solutionOf(incumbentUnits, priced.closed);
    this.solutions.push(this.incumbent);
    // The root is the beam's only node; it may close at once.
    const root = this.t.createState();
    this.current.store(0, root, -1);
    this.current.size = 1;
    this.closeNode(this.current, 0, root, () => []);
  }

  // ===========================================================================================
  // Solutions

  private addSolution(units: readonly number[], closed: Closed): void {
    // A saving the uncertain hearth waits could absorb is no saving (review COR-02): such a
    // solution is not listed, so no caller can mistake its lower `estimatedMs` for one.
    const incumbentMs = this.incumbent.estimatedMs;
    if (closed.estimatedMs < incumbentMs && closed.comparedMs >= incumbentMs) return;
    const solution = solutionOf(units, closed);
    const before = this.solutions[0];
    if (this.solutions.some((known) => sameSequence(known.units, solution.units))) return;
    this.solutions.push(solution);
    this.solutions.sort((a, b) => a.comparedMs - b.comparedMs || compareSequences(a.units, b.units));
    if (this.solutions.length > this.options.candidates) {
      // The incumbent is kept while it is among the best; beyond `candidates` the worst goes.
      this.solutions.length = this.options.candidates;
    }
    const head = this.solutions[0];
    if (head !== undefined && before !== undefined && head !== before && head.comparedMs < before.comparedMs) {
      this.bestThisCall = head;
      if (this.firstImprovement === null && head.comparedMs < incumbentMs) this.firstImprovement = this.evaluations;
    }
  }

  /** Records a close refused only by the XP-4 fill rule (review PAR-04). */
  private noteRefusal(): void {
    if (!this.t.blockedByUnknownXp) return;
    this.blockedCloses += 1;
    this.smallestShortfall = Math.min(this.smallestShortfall, this.t.unknownXpShortfall);
  }

  /**
   * Tests a kept node for closing (§7.5); a node that closes with its target met is not expanded:
   * optional units only add time. Not quite always: an arrival radius makes the engine's move
   * shorter than a direct leg (TIME-2), so a detour through an optional unit could look faster.
   * That is the simplification's artefact, not a better route, and is deliberately not harvested
   * (review COR-04).
   */
  private closeNode(layer: Layer, rank: number, s: NodeState, units: () => readonly number[]): void {
    const closed = this.t.close(s);
    if (closed === null) {
      this.noteRefusal();
      return;
    }
    this.addSolution(units(), closed);
    if (closed.fillXp === 0 && closed.knownGain >= this.problem.targetXp) layer.expandable[rank] = 0;
  }

  // ===========================================================================================
  // Candidates, duplicates and dominance (§7.2, §7.3)

  private evaluateChild(s: NodeState, parent: number, unit: number): void {
    saveScalars(s, this.snapshot);
    if (this.t.applyEnabled(s, unit)) {
      scalarLanes(this.t.layout, s, this.lanes);
      let h1 = addMod(this.lanes.h1, s.set1, P1);
      let h2 = addMod(this.lanes.h2, s.set2, P2);
      if (this.options.testHash === 'constant') {
        h1 = 0;
        h2 = 0;
      }
      const score = this.heuristic.score(s);
      const c = this.cands.add(parent, unit, score, h1, h2, s, this.t.log, this.t.logSize, 0);
      if (this.options.dominance) this.table.insert(c);
    }
    this.t.undoStatuses(s, 0);
    s.scheduled[unit] = 0;
    loadScalars(this.snapshot, s);
  }

  /** The selection order (§7.3): score, elapsed, parent rank, unit index. */
  private before(a: number, b: number): number {
    const c = this.cands;
    return (
      (c.score[a] ?? 0) - (c.score[b] ?? 0) ||
      c.scalar(a, S_ELAPSED) - c.scalar(b, S_ELAPSED) ||
      (c.parent[a] ?? 0) - (c.parent[b] ?? 0) ||
      (c.unit[a] ?? 0) - (c.unit[b] ?? 0)
    );
  }

  /**
   * Whether two candidates are the same state (the exact comparison after a lane match). The
   * scheduled and status rows are compared as 32-bit words (review PRF-05): each child's unit and
   * status changes are applied in place to its parent's rows, compared, and undone.
   */
  private sameKey(a: number, b: number): boolean {
    const c = this.cands;
    for (const k of KEY_FIELDS) if (c.scalar(a, k) !== c.scalar(b, k)) return false;
    const pa = c.parent[a] ?? 0;
    const pb = c.parent[b] ?? 0;
    // Two children of one parent schedule different units.
    if (pa === pb) return false;
    const ua = c.unit[a] ?? 0;
    const ub = c.unit[b] ?? 0;
    const layer = this.current;
    const us = layer.unitStride;
    const sched = layer.scheduled;
    // Equal sets with ua ≠ ub need ub scheduled in a's parent and ua in b's.
    if (ua !== ub && ((sched[pa * us + ub] ?? 0) !== 1 || (sched[pb * us + ua] ?? 0) !== 1)) return false;
    const sw = layer.scheduledWords;
    sched[pa * us + ua] = 1;
    sched[pb * us + ub] = 1;
    let same = true;
    for (let w = (pa * us) / 4, v = (pb * us) / 4, end = w + us / 4; w < end; w += 1, v += 1) {
      if (sw[w] !== sw[v]) {
        same = false;
        break;
      }
    }
    // Both units were unscheduled in their parents (they were enabled there).
    sched[pa * us + ua] = 0;
    sched[pb * us + ub] = 0;
    if (!same) return false;
    const qs = layer.questStride;
    const status = layer.status;
    const na = c.changeCount[a] ?? 0;
    const nb = c.changeCount[b] ?? 0;
    if (na > this.saveA.length || nb > this.saveB.length) {
      const size = 2 * Math.max(na, nb);
      this.saveA = new Uint8Array(size);
      this.saveB = new Uint8Array(size);
    }
    const oa = this.saveA;
    const ob = this.saveB;
    const sa = c.changeStart[a] ?? 0;
    const sb = c.changeStart[b] ?? 0;
    for (let k = 0; k < na; k += 1) {
      const at = pa * qs + (c.changes[sa + 2 * k] ?? 0);
      oa[k] = status[at] ?? 0;
      status[at] = c.changes[sa + 2 * k + 1] ?? 0;
    }
    for (let k = 0; k < nb; k += 1) {
      const at = pb * qs + (c.changes[sb + 2 * k] ?? 0);
      ob[k] = status[at] ?? 0;
      status[at] = c.changes[sb + 2 * k + 1] ?? 0;
    }
    const qw = layer.statusWords;
    for (let w = (pa * qs) / 4, v = (pb * qs) / 4, end = w + qs / 4; w < end; w += 1, v += 1) {
      if (qw[w] !== qw[v]) {
        same = false;
        break;
      }
    }
    // Undo in reverse, so a quest changed twice gets its first old value back.
    for (let k = nb - 1; k >= 0; k -= 1) status[pb * qs + (c.changes[sb + 2 * k] ?? 0)] = ob[k] ?? 0;
    for (let k = na - 1; k >= 0; k -= 1) status[pa * qs + (c.changes[sa + 2 * k] ?? 0)] = oa[k] ?? 0;
    return same;
  }

  private saveA = new Uint8Array(256);
  private saveB = new Uint8Array(256);

  /** −1: a dominates b; 1: b dominates a; 2: equal on every dominance field; 0: neither. */
  private dominance(a: number, b: number): number {
    const c = this.cands;
    let aBetter = false;
    let bBetter = false;
    for (const k of this.dominanceFields) {
      const d = c.scalar(a, k) - c.scalar(b, k);
      if (d < 0) aBetter = true;
      else if (d > 0) bBetter = true;
    }
    if (aBetter && !bBetter) return -1;
    if (bBetter && !aBetter) return 1;
    return aBetter ? 0 : 2;
  }

  // ===========================================================================================
  // Work items (§7.6)

  /** The item kind: a rollout, then the local pass, then `rolloutEvery` layers, repeated. */
  private itemKind(): 'rollout' | 'local' | 'layer' {
    const k = this.item % (this.options.rolloutEvery + 2);
    return k === 0 ? 'rollout' : k === 1 ? 'local' : 'layer';
  }

  /** Generates the layer's candidates; true when the layer is complete. */
  private stepLayer(budget: Budget): boolean {
    const layer = this.current;
    while (this.parentRank < layer.size) {
      if (!this.parentLoaded) {
        if ((layer.expandable[this.parentRank] ?? 0) === 0) {
          this.parentRank += 1;
          continue;
        }
        layer.load(this.parentRank, this.s);
        this.parentLoaded = true;
        this.unitCursor = 0;
      }
      while (this.unitCursor < this.units) {
        if (budget.left <= 0) return false;
        const unit = this.unitCursor;
        this.unitCursor += 1;
        if (!this.t.enabled(this.s, unit)) continue;
        budget.left -= 1;
        this.evaluations += 1;
        this.evaluateChild(this.s, this.parentRank, unit);
      }
      this.parentLoaded = false;
      this.parentRank += 1;
    }
    this.finishLayer();
    return true;
  }

  /** Selects the beam and builds its nodes (§7.3 steps 3-4), then tests them for closing. */
  private finishLayer(): void {
    const cands = this.cands;
    // Top-K selection with a bounded max-heap on the selection order (the order is total, so the
    // kept set and its sorted order equal those of a full sort).
    const heap = this.heap;
    let size = 0;
    const K = this.beam;
    for (let c = 0; c < cands.count; c += 1) {
      if ((cands.alive[c] ?? 0) !== 1) continue;
      if (size < K) {
        let i = size;
        size += 1;
        while (i > 0) {
          const parent = Math.floor((i - 1) / 2);
          const pv = heap[parent] ?? 0;
          if (this.before(pv, c) >= 0) break;
          heap[i] = pv;
          i = parent;
        }
        heap[i] = c;
      } else if (this.before(c, heap[0] ?? 0) < 0) {
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          if (l >= size) break;
          const r = l + 1;
          let m = l;
          if (r < size && this.before(heap[r] ?? 0, heap[l] ?? 0) > 0) m = r;
          const mv = heap[m] ?? 0;
          if (this.before(mv, c) <= 0) break;
          heap[i] = mv;
          i = m;
        }
        heap[i] = c;
      }
    }
    this.parentRank = 0;
    this.parentLoaded = false;
    this.layers += 1;
    if (size === 0) {
      this.exhausted = true;
      cands.reset();
      this.table.clear();
      return;
    }
    const kept = Array.from(heap.subarray(0, size)).sort((a, b) => this.before(a, b));
    const from = this.current;
    const to = this.next;
    kept.forEach((c, k) => {
      const p = cands.parent[c] ?? 0;
      const unit = cands.unit[c] ?? 0;
      to.copyRows(k, from, p);
      to.scheduled[k * to.unitStride + unit] = 1;
      cands.applyChanges(c, to.status, k * to.questStride);
      to.scalars.set(cands.scalars.subarray(c * SCALAR_COUNT, (c + 1) * SCALAR_COUNT), k * SCALAR_COUNT);
      to.trail[k] = this.trail.add(from.trail[p] ?? -1, unit);
      to.expandable[k] = 1;
    });
    to.size = kept.length;
    this.current = to;
    this.next = from;
    cands.reset();
    this.table.clear();
    for (let k = 0; k < to.size; k += 1) {
      to.load(k, this.s);
      this.closeNode(to, k, this.s, () => this.trail.sequence(to.trail[k] ?? -1));
    }
  }

  /** A greedy rollout from the best-ranked node (§7.6); true when it is complete. */
  private stepRollout(budget: Budget): boolean {
    const r = this.r;
    if (!this.rolloutActive) {
      if (this.current.size === 0 || (this.current.expandable[0] ?? 0) === 0) return true;
      this.current.load(0, r);
      this.rolloutBase = this.trail.sequence(this.current.trail[0] ?? -1);
      this.rolloutSeq.length = 0;
      this.rolloutActive = true;
      this.rolloutPhase = 'children';
      this.unitCursor = 0;
      this.rolloutBest = -1;
      this.rolloutBestScore = Number.POSITIVE_INFINITY;
      this.rollouts += 1;
    }
    for (;;) {
      if (this.rolloutPhase === 'test') {
        const closed = this.t.close(r);
        if (closed === null) this.noteRefusal();
        else {
          this.addSolution([...this.rolloutBase, ...this.rolloutSeq], closed);
          if (closed.fillXp === 0 && closed.knownGain >= this.problem.targetXp) {
            this.rolloutActive = false;
            return true;
          }
        }
        this.rolloutPhase = 'children';
        this.unitCursor = 0;
        this.rolloutBest = -1;
        this.rolloutBestScore = Number.POSITIVE_INFINITY;
      }
      while (this.unitCursor < this.units) {
        if (budget.left <= 0) return false;
        const unit = this.unitCursor;
        this.unitCursor += 1;
        if (!this.t.enabled(r, unit)) continue;
        budget.left -= 1;
        this.evaluations += 1;
        saveScalars(r, this.snapshot);
        if (this.t.applyEnabled(r, unit)) {
          const score = this.heuristic.score(r);
          if (score < this.rolloutBestScore) {
            this.rolloutBestScore = score;
            this.rolloutBest = unit;
          }
        }
        this.t.undoStatuses(r, 0);
        r.scheduled[unit] = 0;
        loadScalars(this.snapshot, r);
      }
      if (this.rolloutBest < 0) {
        this.rolloutActive = false;
        return true;
      }
      if (!this.t.applyEnabled(r, this.rolloutBest)) throw new Error('A rollout child could not be applied again');
      this.t.logSize = 0;
      this.rolloutSeq.push(this.rolloutBest);
      this.rolloutPhase = 'test';
    }
  }

  // ===========================================================================================
  // The local pass (review PRF-08)
  //
  // The beam compares nodes of equal depth, and on a good incumbent (a nearest-neighbour order, a
  // hand-made route) it may never beat it. The pass takes the best solution so far and tries every
  // move of one unit up to `localWindow` places either way (1, −1, 2, −2, ...), keeping the first
  // that lowers `comparedMs`, until every move has been tried once. It prices with the same
  // transitions and closing, from stored prefix states: a move changes only the window between its
  // two positions, and when the state after the window has the same key, unknown parts and time to
  // the hearth as the current order's there, the rest costs the same, so the move is judged on the
  // window alone. Each unit applied counts one evaluation; a move is never split by `advance`.

  private elementAt(k: number, i: number, j: number): number {
    const seq = this.localSeq;
    if (j > i) return k === j ? (seq[i] ?? 0) : (seq[k + 1] ?? 0);
    return k === j ? (seq[i] ?? 0) : (seq[k - 1] ?? 0);
  }

  /** Applies one unit to the pass's working state, counting it; false when it cannot be scheduled there. */
  private localApply(u: number, budget: Budget): boolean {
    budget.left -= 1;
    this.evaluations += 1;
    const ok = this.t.apply(this.w, u);
    this.t.logSize = 0;
    return ok;
  }

  /** Rebuilds the prefix states from position `from`; false (never expected) when the sequence breaks. */
  private rebuildPrefix(from: number, budget: Budget): Closed | null {
    const n = this.localLength;
    this.prefix.load(from, this.w);
    for (let k = from; k < n; k += 1) {
      if (!this.localApply(this.localSeq[k] ?? 0, budget)) return null;
      this.prefix.store(k + 1, this.w, -1);
    }
    return this.t.close(this.w);
  }

  /** Whether the state after a move's window can finish exactly as the current order does from `q`. */
  private sameRest(q: number): boolean {
    const w = this.w;
    const at = q * SCALAR_COUNT;
    const x = this.prefix.scalars;
    return (
      w.loc === x[at + S_LOC] &&
      w.lastVisit === x[at + S_LAST_VISIT] &&
      w.tier === x[at + S_TIER] &&
      w.unknownXp === x[at + S_UNKNOWN_XP] &&
      w.sinceCastUnknown === x[at + S_SINCE_CAST] &&
      w.level === x[at + S_LEVEL] &&
      w.xpInto === x[at + S_XP_INTO] &&
      w.unknownParts === x[at + S_UNKNOWN_PARTS] &&
      w.readyAt - w.elapsed === (x[at + S_READY_AT] ?? 0) - (x[at + S_ELAPSED] ?? 0)
    );
  }

  /** Moves unit i to j in the pass's sequence; kept (and listed) only when it lowers `comparedMs`. */
  private keepMove(i: number, j: number, budget: Budget): boolean {
    const shift = (from: number, to: number): void => {
      const moved = this.localSeq[from] ?? 0;
      if (to > from) this.localSeq.copyWithin(from, from + 1, to + 1);
      else this.localSeq.copyWithin(to + 1, to, from);
      this.localSeq[to] = moved;
    };
    const p = Math.min(i, j);
    shift(i, j);
    const kept = this.rebuildPrefix(p, budget);
    if (kept === null || kept.comparedMs >= this.localMs) {
      shift(j, i);
      this.rebuildPrefix(p, budget);
      return false;
    }
    this.localMs = kept.comparedMs;
    this.addSolution(Array.from(this.localSeq.subarray(0, this.localLength)), kept);
    return true;
  }

  /** The local pass over the best solution; true when it is complete. */
  private stepLocal(budget: Budget): boolean {
    const n0 = this.localWindow;
    if (!this.localActive) {
      const base = this.solutions[0];
      if (n0 === 0 || base === undefined || base === this.localBase || base.units.length < 2) return true;
      this.localBase = base;
      this.localLength = base.units.length;
      this.localSeq.set(base.units);
      this.localMs = base.comparedMs;
      this.localBuilt = 0;
      this.localI = 0;
      this.localD = 0;
      this.localActive = true;
      const root = this.t.createState();
      this.prefix.store(0, root, -1);
    }
    const n = this.localLength;
    if (this.localBuilt < n) {
      // The prefix states of the base, built once per pass (one item, never split by a budget).
      if (budget.left <= 0) return false;
      if (this.rebuildPrefix(0, budget) === null) {
        this.localActive = false;
        return true;
      }
      this.localBuilt = n;
    }
    const moves = 2 * Math.min(n0, n - 1);
    while (this.localI < n) {
      if (this.localD >= moves) {
        this.localI += 1;
        this.localD = 0;
        continue;
      }
      if (budget.left <= 0) return false;
      const i = this.localI;
      const step = Math.floor(this.localD / 2) + 1;
      const j = this.localD % 2 === 0 ? i + step : i - step;
      this.localD += 1;
      if (j < 0 || j >= n) continue;
      const p = Math.min(i, j);
      const q = Math.max(i, j) + 1;
      this.prefix.load(p, this.w);
      let ok = true;
      for (let k = p; k < q && ok; k += 1) ok = this.localApply(this.elementAt(k, i, j), budget);
      // One unit past the window both orders apply the same unit, so both stand at its destination.
      let r = q;
      if (ok && r < n) {
        ok = this.localApply(this.localSeq[r] ?? 0, budget);
        r += 1;
      }
      if (!ok) continue;
      let exact = false;
      if (r < n) {
        // At the same unit past the window: behind the current order, the move is dropped (with the
        // same state it cannot win; with another, the XP differs, it is not worth pricing further).
        // Ahead with the same state, it wins by exactly that much.
        const at = r * SCALAR_COUNT;
        const delta = this.w.elapsed + this.w.waitExcess - ((this.prefix.scalars[at + S_ELAPSED] ?? 0) + (this.prefix.scalars[at + S_WAIT_EXCESS] ?? 0));
        if (delta >= 0) continue;
        exact = this.sameRest(r);
      }
      if (!exact) {
        for (let k = r; k < n && ok; k += 1) ok = this.localApply(this.localSeq[k] ?? 0, budget);
        if (!ok) continue;
        const closed = this.t.close(this.w);
        if (closed === null || closed.comparedMs >= this.localMs) continue;
      }
      if (this.keepMove(i, j, budget)) this.localD = 0;
    }
    this.localActive = false;
    return true;
  }

  // ===========================================================================================
  // The stepper

  private progress(): SearchProgress {
    return {
      layer: this.layers,
      evaluations: this.evaluations,
      beamSize: this.current.size,
      incumbentMs: this.incumbent.estimatedMs,
      bestMs: this.solutions[0]?.comparedMs ?? null,
    };
  }

  private stats(): SearchStats {
    return {
      evaluations: this.evaluations,
      layers: this.layers,
      duplicates: this.table.duplicates,
      dominated: this.table.dominated,
      rollouts: this.rollouts,
      firstImprovementEvaluations: this.firstImprovement,
      arrayBytes: this.current.bytes + this.next.bytes + this.prefix.bytes + this.cands.bytes + this.table.slots.byteLength + this.trail.bytes + this.t.pricing.memoBytes,
    };
  }

  private outcome(termination: SearchTermination): SearchOutcome {
    const unknownXpBlocked = this.blockedCloses === 0 ? null : { closes: this.blockedCloses, smallestShortfall: this.smallestShortfall };
    return { termination, incumbent: this.incumbent, solutions: [...this.solutions], stats: this.stats(), unknownXpBlocked };
  }

  advance(maxEvaluations: number): AdvanceResult {
    this.bestThisCall = null;
    if (this.termination !== null) return { done: true, outcome: this.outcome(this.termination) };
    const budget: Budget = { left: Math.max(0, Math.floor(maxEvaluations)) };
    for (;;) {
      const kind = this.itemKind();
      const finished = kind === 'rollout' ? this.stepRollout(budget) : kind === 'local' ? this.stepLocal(budget) : this.stepLayer(budget);
      if (!finished) return { done: false, progress: this.progress(), best: this.bestThisCall };
      this.item += 1;
      if (this.exhausted) this.termination = 'exhausted';
      else if (this.evaluations >= this.options.maxEvaluations) this.termination = 'budget';
      if (this.termination !== null) return { done: true, outcome: this.outcome(this.termination) };
      if (budget.left <= 0) return { done: false, progress: this.progress(), best: this.bestThisCall };
    }
  }

  finish(termination: 'timeout' | 'cancelled'): SearchOutcome {
    this.termination ??= termination;
    return this.outcome(termination);
  }
}
