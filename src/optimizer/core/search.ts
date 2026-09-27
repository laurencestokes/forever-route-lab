import { type AnytimeHost, Meter } from './anytime';
import { createTransitions, runSequence, solutionOf } from './evaluate';
import { addMod, P1, P2, powerOfTwoAtLeast, scalarLanes, tableSlot } from './hash';
import { Heuristic } from './heuristic';
import { KICK_MIN_UNITS, Kicks } from './kicks';
import { LocalSearch } from './local';
import { InsertionSeed, NearestNeighbourSeed } from './seeds';
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
 * The search (docs/research/optimizer-m7.md §7, §19): a layered beam over units, with candidate
 * records in typed arrays, an arithmetic duplicate table with exact comparison, dominance pruning
 * with at most four entries per key, a total deterministic order, an ancestry trail, and anytime
 * parts: two constructive seeds (nearest neighbour and cheapest insertion, `seeds.ts`), greedy
 * rollouts, a local pass (or-opt, exchange, 2-opt and drop, `local.ts`) and an iterated local
 * search (kicks, `kicks.ts`). A run is a fixed sequence of work items: the nearest-neighbour seed N
 * and the local pass over it, the insertion seed I and the pass over it; then, when the beam can
 * reach a closing depth within the budget (review M7Q Q-01), rollout R0, the pass P0, layers L0-L7,
 * rollout R8, P8, and so on until the beam is exhausted, then kicks K (or, in a section of fewer
 * than `KICK_MIN_UNITS` units, one last pass over the best); otherwise kicks only. Kicks end at the
 * budget or when they stall (`converged`). The budget is checked after each
 * item; the seeds and the passes also end at the budget at their own boundaries, and no other item
 * stops short. `advance(n)` may stop anywhere inside an item and resume exactly there, so results
 * never depend on slice sizes.
 *
 * No clock and no randomness: the lane constants and the kicks' sequence are fixed.
 */

/** At most this many non-dominated entries per exact key (§7.3, review OP-17). */
export const ENTRIES_PER_KEY = 4;

/** The local pass's moves reach at most this many places either way (review PRF-08). */
export const DEFAULT_LOCAL_WINDOW = 24;

/** The work items before the first rollout: each seed, then the local pass over that seed. */
const PRELUDE = ['seed-nn', 'local-nn', 'seed-insertion', 'local-insertion'] as const;
type ItemKind = (typeof PRELUDE)[number] | 'local' | 'rollout' | 'layer' | 'kick' | 'polish';

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

class BeamSearch implements Stepper, AnytimeHost {
  readonly t: Transitions;
  readonly meter: Meter;
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
  /** The best order the latest rollout closed (the local pass after it starts there). */
  private rolloutResult: SearchSolution | null = null;
  private rolloutBest = -1;
  private rolloutBestScore = Number.POSITIVE_INFINITY;
  private bestThisCall: SearchSolution | null = null;
  // The anytime parts: the seeds (null when off) and the local pass.
  private readonly nearest: NearestNeighbourSeed | null;
  private readonly insertion: InsertionSeed | null;
  private readonly local: LocalSearch;
  /** The iterated local search (null when off). */
  private readonly kicks: Kicks | null;
  /**
   * After the prelude: the beam (then kicks once it is exhausted, or without kicks a last pass over
   * the best, `polish`), or kicks only; null until decided.
   */
  private mode: 'beam' | 'kicks' | 'polish' | null = null;
  /** Units enabled at the root (the beam's cost estimate). */
  private readonly rootEnabled: number;
  /** The solution the local pass in progress started from. */
  private localBase: SearchSolution | null = null;
  /** The dominance fields (§7.3): divergence only when it is penalised. */
  private readonly dominanceFields: readonly number[];
  private readonly heap: Int32Array;

  constructor(
    readonly problem: SearchProblem,
    private readonly options: SearchOptions,
  ) {
    validate(options);
    this.meter = new Meter(options.maxEvaluations);
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
    // The seeds and the pass reorder freely, so they stay off when out-of-order units are penalised.
    const free = options.divergencePenalty === 0;
    const seeds = free && options.seeds !== false;
    this.nearest = seeds ? new NearestNeighbourSeed(this) : null;
    this.insertion = seeds ? new InsertionSeed(this) : null;
    this.local = new LocalSearch(this, free ? (options.localWindow ?? DEFAULT_LOCAL_WINDOW) : 0);
    this.kicks = this.local.window > 0 && options.kicks !== false && this.units >= KICK_MIN_UNITS ? new Kicks(this, this.local) : null;
    // The incumbent (the original order) seeds the solutions (§7.5).
    const incumbentUnits = Int32Array.from({ length: this.units }, (_, u) => u);
    const priced = runSequence(createTransitions(problem), incumbentUnits, true);
    if ('infeasible' in priced) throw new Error(`The incumbent is infeasible: ${priced.infeasible}`);
    this.incumbent = solutionOf(incumbentUnits, priced.closed);
    this.solutions.push(this.incumbent);
    // The root is the beam's only node; it may close at once.
    const root = this.t.createState();
    let enabled = 0;
    for (let u = 0; u < this.units; u += 1) if (this.t.enabled(root, u)) enabled += 1;
    this.rootEnabled = enabled;
    this.current.store(0, root, -1);
    this.current.size = 1;
    this.closeNode(this.current, 0, root, () => []);
  }

  // ===========================================================================================
  // Solutions

  addSolution(units: ArrayLike<number>, closed: Closed): void {
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
    // A new head is reported even at an equal figure (an order ranked first by the tie rule), so the
    // last `best` a caller sees is always the outcome's first solution.
    if (head !== undefined && before !== undefined && head !== before && head.comparedMs <= before.comparedMs) {
      this.bestThisCall = head;
      if (this.firstImprovement === null && head.comparedMs < incumbentMs) this.firstImprovement = this.meter.evaluations;
    }
  }

  /** Records a close refused only by the XP-4 fill rule (review PAR-04). */
  noteRefusal(): void {
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

  /**
   * The item kind: the prelude; then, in beam mode, a rollout, the local pass and `rolloutEvery`
   * layers, repeated; in kicks mode, kicks; in polish mode (an exhausted beam without kicks), one
   * pass over the best. The mode is chosen at the first item after the prelude from counts alone
   * (deterministic), and changes only when the beam is exhausted.
   */
  private itemKind(): ItemKind {
    const prelude = PRELUDE[this.item];
    if (prelude !== undefined) return prelude;
    this.mode ??= this.kicks !== null && !this.beamAffordable() ? 'kicks' : 'beam';
    if (this.mode === 'kicks') return 'kick';
    if (this.mode === 'polish') return 'polish';
    const k = (this.item - PRELUDE.length) % (this.options.rolloutEvery + 2);
    return k === 0 ? 'rollout' : k === 1 ? 'local' : 'layer';
  }

  /**
   * Whether the beam can plausibly reach a closing depth within what is left of the budget (review
   * M7Q Q-01): its layers cost about width × depth × (units enabled at the root) / 2 evaluations,
   * the depth being the best order's length. A beam that cannot close any node only spends the
   * budget, so the kicks get it instead.
   */
  private beamAffordable(): boolean {
    const depth = this.solutions[0]?.units.length ?? this.units;
    const predicted = (this.beam * depth * Math.max(1, this.rootEnabled)) / 2;
    return this.meter.evaluations + predicted <= this.meter.max;
  }

  /** Generates the layer's candidates; true when the layer is complete. */
  private stepLayer(): boolean {
    const meter = this.meter;
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
        if (meter.paused) return false;
        const unit = this.unitCursor;
        this.unitCursor += 1;
        if (!this.t.enabled(this.s, unit)) continue;
        meter.spend();
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
  private stepRollout(): boolean {
    const meter = this.meter;
    const r = this.r;
    if (!this.rolloutActive) {
      if (this.current.size === 0 || (this.current.expandable[0] ?? 0) === 0) return true;
      this.current.load(0, r);
      this.rolloutBase = this.trail.sequence(this.current.trail[0] ?? -1);
      this.rolloutSeq.length = 0;
      this.rolloutResult = null;
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
          const units = [...this.rolloutBase, ...this.rolloutSeq];
          if (this.rolloutResult === null || closed.comparedMs < this.rolloutResult.comparedMs) this.rolloutResult = solutionOf(units, closed);
          this.addSolution(units, closed);
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
        if (meter.paused) return false;
        const unit = this.unitCursor;
        this.unitCursor += 1;
        if (!this.t.enabled(r, unit)) continue;
        meter.spend();
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
  // The local pass (local.ts) over the best solution so far

  /**
   * The local pass over `base` (a seed's order, or the best solution so far); true when it is
   * complete, or when there is nothing new to improve.
   */
  private stepLocal(base: SearchSolution | undefined): boolean {
    if (this.localBase === null) {
      if (!this.local.wants(base)) return true;
      this.localBase = base;
    }
    if (!this.local.step(this.localBase)) return false;
    this.localBase = null;
    return true;
  }

  // ===========================================================================================
  // The stepper

  private progress(): SearchProgress {
    return {
      layer: this.layers,
      evaluations: this.meter.evaluations,
      beamSize: this.current.size,
      incumbentMs: this.incumbent.estimatedMs,
      bestMs: this.solutions[0]?.comparedMs ?? null,
    };
  }

  private stats(): SearchStats {
    return {
      evaluations: this.meter.evaluations,
      layers: this.layers,
      duplicates: this.table.duplicates,
      dominated: this.table.dominated,
      rollouts: this.rollouts,
      firstImprovementEvaluations: this.firstImprovement,
      arrayBytes:
        this.current.bytes +
        this.next.bytes +
        this.local.bytes +
        (this.insertion?.bytes ?? 0) +
        (this.kicks?.bytes ?? 0) +
        this.cands.bytes +
        this.table.slots.byteLength +
        this.trail.bytes +
        this.t.pricing.memoBytes,
    };
  }

  private outcome(termination: SearchTermination): SearchOutcome {
    const unknownXpBlocked = this.blockedCloses === 0 ? null : { closes: this.blockedCloses, smallestShortfall: this.smallestShortfall };
    return { termination, incumbent: this.incumbent, solutions: [...this.solutions], stats: this.stats(), unknownXpBlocked };
  }

  /** Runs the current work item; true when it is complete. */
  private stepItem(kind: ItemKind): boolean {
    switch (kind) {
      case 'seed-nn':
        return this.nearest?.step() ?? true;
      case 'seed-insertion':
        return this.insertion?.step() ?? true;
      case 'local-nn':
        return this.stepLocal(this.nearest?.result ?? undefined);
      case 'local-insertion':
        return this.stepLocal(this.insertion?.result ?? undefined);
      case 'local':
        // The latest rollout's order (a new start for the descent), else the best solution so far.
        return this.stepLocal(this.local.wants(this.rolloutResult) ? this.rolloutResult : this.solutions[0]);
      case 'rollout':
        return this.stepRollout();
      case 'layer':
        return this.stepLayer();
      case 'kick':
        return this.kicks?.step(this.solutions[0]) ?? true;
      case 'polish':
        // The beam's last improvements came after the last pass: one pass over the best (if new).
        return this.stepLocal(this.solutions[0]);
    }
  }

  advance(maxEvaluations: number): AdvanceResult {
    this.bestThisCall = null;
    if (this.termination !== null) return { done: true, outcome: this.outcome(this.termination) };
    this.meter.left = Math.max(0, Math.floor(maxEvaluations));
    for (;;) {
      if (!this.stepItem(this.itemKind())) return { done: false, progress: this.progress(), best: this.bestThisCall };
      this.item += 1;
      if (this.exhausted && this.mode === 'beam' && !this.meter.spent) {
        // The beam is exhausted: the rest of the budget goes to kicks, or to a last pass over the best.
        this.exhausted = false;
        this.mode = this.kicks !== null ? 'kicks' : 'polish';
      } else if (this.mode === 'polish') this.exhausted = true;
      if (this.exhausted) this.termination = 'exhausted';
      else if (this.meter.spent) this.termination = 'budget';
      else if (this.mode === 'kicks' && (this.kicks?.stalled ?? true)) this.termination = 'converged';
      if (this.termination !== null) return { done: true, outcome: this.outcome(this.termination) };
      if (this.meter.paused) return { done: false, progress: this.progress(), best: this.bestThisCall };
    }
  }

  finish(termination: 'timeout' | 'cancelled'): SearchOutcome {
    this.termination ??= termination;
    return this.outcome(termination);
  }
}
