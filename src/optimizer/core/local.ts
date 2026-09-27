import { type AnytimeHost, FAR_MS } from './anytime';
import { NOT_REQUESTED } from './matrix';
import { Layer, S_ELAPSED, S_KNOWN_TOTAL, S_LAST_VISIT, S_LEVEL, S_LOC, S_READY_AT, S_SINCE_CAST, S_TIER, S_UNKNOWN_PARTS, S_UNKNOWN_XP, S_WAIT_EXCESS, S_XP_INTO } from './state';
import { type Closed, type NodeState, SCALAR_COUNT } from './transitions';
import type { Op, SearchProblem, SearchSolution } from './types';

/**
 * The local pass (docs/research/optimizer-m7.md §19; reviews PRF-08 and M7 open item 1): a
 * first-improvement descent over one solution's unit order. Three neighbourhoods permute a
 * contiguous window of the order:
 *
 * - **or-opt**: a run of 1, 2 or 3 units moved up to `window` places later or earlier;
 * - **exchange**: two units up to `window` places apart swap places;
 * - **2-opt**: a run of up to `window + 1` units is reversed;
 *
 * and a fourth removes one droppable quest's units (**drop**), tried once per quest at the start
 * of each scan. A drop is priced only when the XP the quest's units granted in the current order
 * leaves the rest at the target, or when the request lets the fill replace quests (D-043 item 2):
 * the closing rules decide, so `'shortfall'` never lets the fill cover a dropped quest. The drop
 * move is off under `'keep-original'` with the `'shortfall'` fill (`SearchProblem.dropMove`; D-044,
 * review M7Q Q-05).
 *
 * A window move is tried only when it keeps every precedence edge (`require` and `order`) between
 * units of the window, checked on the edge table before any transition; the transitions then check
 * everything else (levels, the log, conditions, bind positions, moves between world maps, drop
 * cascades), and closing checks the rest of the contract. No quest is ever added.
 *
 * Pricing is incremental, from the prefix states of the current order: the window is applied from
 * the state before it, then the unit after it; when the state there has the same key, unknown parts
 * and time to the hearth as the current order's, the rest costs the same and the move is judged on
 * the window alone. A move whose time at that point is not below the current order's is dropped (it
 * cannot win with the same state; with another, the XP differs, and it is not priced further). A
 * kept move lowers `comparedMs` by at least 1 ms, so the descent ends.
 *
 * The pre-screen (review M7Q Q-04) judges a window move by its matrix travel alone only when the
 * matrix sees the move's whole effect: every unit of the window and the unit after it is
 * screenable (no anchor, hearth, bind, flight, transport, grind or riding train, no condition, no
 * waypoint chain or lost position, no level-limited or any-of accept, no quest with unknown XP),
 * and the window ends before the order does (the exit chain's first leg changes otherwise).
 * Every other move is priced exactly.
 *
 * Don't-look bits (one per unit): a unit whose moves all failed is not tried again until a kept
 * move changes its neighbourhood, and the pass ends when a scan finds every unit clean (a local
 * optimum for the four neighbourhoods) or when the run's evaluation budget is reached at a move
 * boundary. A pass may start with only some units dirty (`focus`: the iterated local search's kick
 * changes a few places of a local optimum). Each transition applied counts one evaluation; `step()`
 * pauses only between moves, so the pass never depends on the slices.
 */

const OR_OPT = 0;
const EXCHANGE = 1;
const REVERSE = 2;
/** The or-opt run lengths. */
const OR_OPT_RUNS = [1, 2, 3] as const;

/**
 * The pre-screen's tolerance: a move is priced only when its matrix travel delta is below 5 s. What
 * the matrix does not see is small per move: a visit discount changes an accept by 1 s (TIME-8),
 * kill time varies with the level, and an arrival radius shortens a leg (TIME-2).
 */
export const LOCAL_TOLERANCE_MS = 5000;

/** A pre-screen's share of an evaluation in the slice (`Meter.work`): about its measured cost. */
const PRESCREEN_WORK = 0.25;

/**
 * Whether the matrix sees a unit's whole effect on the time around it, so the pre-screen may judge a
 * move touching it by travel alone (review M7Q Q-04; see the file comment).
 */
function screenableUnit(problem: SearchProblem, u: number): boolean {
  if ((problem.units.anchor[u] ?? 1) === 1) return false;
  const { questStart, quests } = problem.units;
  for (let k = questStart[u] ?? 0; k < (questStart[u + 1] ?? 0); k += 1) {
    const spec = problem.pricing.questXp[problem.quests.xp[quests[k] ?? 0] ?? -1];
    if (spec === undefined || spec.xp === null) return false;
  }
  for (let k = problem.units.opStart[u] ?? 0; k < (problem.units.opStart[u + 1] ?? 0); k += 1) {
    const op = problem.ops[k];
    if (op === undefined || !screenableOp(problem, op)) return false;
  }
  return true;
}

/** A level limit the section can meet or break: a minimum above the start level, or any maximum. */
function levelLimited(problem: SearchProblem, check: { readonly minLevel: number | null; readonly maxLevel: number | null }): boolean {
  return (check.minLevel !== null && check.minLevel > problem.start.level) || check.maxLevel !== null;
}

function screenableOp(problem: SearchProblem, op: Op): boolean {
  if (op.cond >= 0) return false;
  switch (op.kind) {
    case 'skip':
      return true;
    case 'hearth-use':
    case 'hearth-bind':
    case 'table':
    case 'grind':
      return false;
    case 'plain':
      if (op.train >= 0) return false;
      break;
    case 'accept': {
      if (op.anyOf >= 0) return false;
      const check = op.availability >= 0 ? problem.checks.accepts[op.availability] : undefined;
      if (check !== undefined && (levelLimited(problem, check) || (check.target !== null && levelLimited(problem, check.target)))) return false;
      break;
    }
    case 'complete':
    case 'turnin':
    case 'abandon':
      break;
  }
  return op.travel.group < 0 && op.travel.dest.kind !== 'lost';
}

export class LocalSearch {
  private readonly prefix: Layer;
  private readonly w: NodeState;
  private readonly seq: Int32Array;
  /** The window's new order, and each window unit's place in it (−1 outside). */
  private readonly win: Int32Array;
  private readonly winPos: Int32Array;
  private readonly undoBuffer: Int32Array;
  /** Each unit's position in the order (−1 when dropped). */
  private readonly posOf: Int32Array;
  /** 1 when the unit's moves all failed since its neighbourhood last changed. */
  private readonly clean: Uint8Array;
  /** 1 when the pre-screen may judge a move touching the unit (`screenableUnit`). */
  private readonly screenable: Uint8Array;
  /** The move table: kind, run length and signed offset. */
  private readonly moveKind: Int8Array;
  private readonly moveRun: Int8Array;
  private readonly moveOffset: Int32Array;
  private n = 0;
  private active = false;
  private built = false;
  private ms = 0;
  private i = 0;
  private move = 0;
  private improvedInScan = false;
  /** A scan starts with the drop moves, one per quest. */
  private dropping = true;
  private dropCursor = 0;
  private readonly removed: Uint8Array;
  /** The length of the window `fill` wrote. */
  private length = 0;
  /** The orders passes started from or ended on: a pass is not repeated on one of them. */
  private readonly polished = new Set<string>();
  /** Whether the pass in progress records its start and end in `polished`. */
  private remember = true;
  /** The comparedMs of the order the latest pass ended on (+∞ when its start did not close). */
  resultMs = Number.POSITIVE_INFINITY;

  constructor(
    private readonly host: AnytimeHost,
    readonly window: number,
    readonly tolerance = LOCAL_TOLERANCE_MS,
  ) {
    const t = host.t;
    this.prefix = new Layer(window > 0 ? t.units + 1 : 0, t.units, t.quests);
    this.w = t.createState();
    this.seq = new Int32Array(t.units);
    this.win = new Int32Array(t.units);
    this.winPos = new Int32Array(t.units).fill(-1);
    this.undoBuffer = new Int32Array(t.units);
    this.posOf = new Int32Array(t.units).fill(-1);
    this.clean = new Uint8Array(t.units);
    this.screenable = Uint8Array.from({ length: t.units }, (_, u) => (screenableUnit(host.problem, u) ? 1 : 0));
    this.removed = new Uint8Array(t.units);
    const kind: number[] = [];
    const run: number[] = [];
    const offset: number[] = [];
    const add = (k: number, r: number, o: number): void => {
      kind.push(k);
      run.push(r);
      offset.push(o);
    };
    for (const r of OR_OPT_RUNS) {
      for (let step = 1; step <= window; step += 1) {
        add(OR_OPT, r, step);
        add(OR_OPT, r, -step);
      }
    }
    // Exchange at distance 1 and a reversal of 2 or 3 units repeat an or-opt move or an exchange.
    for (let step = 2; step <= window; step += 1) add(EXCHANGE, 1, step);
    for (let step = 3; step <= window; step += 1) add(REVERSE, 1, step);
    this.moveKind = Int8Array.from(kind);
    this.moveRun = Int8Array.from(run);
    this.moveOffset = Int32Array.from(offset);
  }

  get bytes(): number {
    return this.prefix.bytes;
  }

  /** The order the latest pass ended on (a copy). */
  resultUnits(): Int32Array {
    return this.seq.slice(0, this.n);
  }

  /** Whether a pass would start on `base`: the window is open and no pass started from or ended on its order. */
  wants(base: SearchSolution | null | undefined): base is SearchSolution {
    return this.window > 0 && base !== undefined && base !== null && base.units.length >= 2 && !this.polished.has(base.units.join(','));
  }

  /** Applies one unit to the working state, counting it; false when it cannot be scheduled there. */
  private applyOne(u: number): boolean {
    this.host.meter.spend();
    const ok = this.host.t.apply(this.w, u);
    this.host.t.logSize = 0;
    return ok;
  }

  /** Rebuilds the prefix states from position `from`; null (never expected) when the order breaks. */
  private rebuild(from: number): Closed | null {
    this.prefix.load(from, this.w);
    for (let k = from; k < this.n; k += 1) {
      if (!this.applyOne(this.seq[k] ?? 0)) return null;
      this.prefix.store(k + 1, this.w, -1);
    }
    return this.host.t.close(this.w);
  }

  /** Whether the state after a window can finish exactly as the current order does from row `r`. */
  private sameRest(r: number): boolean {
    const w = this.w;
    const at = r * SCALAR_COUNT;
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

  /** Whether the window's new order `win[0..m)` keeps every precedence edge between its units. */
  private keepsEdges(m: number): boolean {
    const { predStart, pred } = this.host.problem.edges;
    for (let a = 0; a < m; a += 1) this.winPos[this.win[a] ?? 0] = a;
    let ok = true;
    for (let a = 0; a < m && ok; a += 1) {
      const x = this.win[a] ?? 0;
      for (let k = predStart[x] ?? 0; k < (predStart[x + 1] ?? 0); k += 1) {
        if ((this.winPos[pred[k] ?? 0] ?? -1) > a) {
          ok = false;
          break;
        }
      }
    }
    for (let a = 0; a < m; a += 1) this.winPos[this.win[a] ?? 0] = -1;
    return ok;
  }

  /**
   * Writes move `index` at position i into `win` and its length into `length`; returns the window's
   * start, or −1 when the move leaves the order.
   */
  private fill(index: number, i: number): number {
    const seq = this.seq;
    const n = this.n;
    const kind = this.moveKind[index] ?? 0;
    const run = this.moveRun[index] ?? 1;
    const off = this.moveOffset[index] ?? 0;
    if (kind === OR_OPT) {
      if (i + run > n) return -1;
      if (off > 0) {
        const q = i + run + off;
        if (q > n) return -1;
        let a = 0;
        for (let k = i + run; k < q; k += 1) this.win[a++] = seq[k] ?? 0;
        for (let k = i; k < i + run; k += 1) this.win[a++] = seq[k] ?? 0;
        this.length = q - i;
        return i;
      }
      const p = i + off;
      if (p < 0) return -1;
      let a = 0;
      for (let k = i; k < i + run; k += 1) this.win[a++] = seq[k] ?? 0;
      for (let k = p; k < i; k += 1) this.win[a++] = seq[k] ?? 0;
      this.length = i + run - p;
      return p;
    }
    const j = i + off;
    if (j >= n) return -1;
    this.length = j - i + 1;
    if (kind === EXCHANGE) {
      this.win[0] = seq[j] ?? 0;
      for (let k = i + 1; k < j; k += 1) this.win[k - i] = seq[k] ?? 0;
      this.win[j - i] = seq[i] ?? 0;
      return i;
    }
    for (let k = i; k <= j; k += 1) this.win[j - k] = seq[k] ?? 0;
    return i;
  }

  /** The matrix ms from a location to unit `u`'s first destination at a riding tier (see `entryMs`). */
  private entry(from: number, tier: number, u: number): number {
    const problem = this.host.problem;
    const kind = problem.units.firstDestKind[u] ?? 0;
    if (kind === 0 || from < 0) return 0;
    const n = problem.locations.count;
    let to = problem.units.firstDest[u] ?? -1;
    if (kind === 2) to = problem.spawnTables.data[to * (n + 1) + from + 1] ?? -1;
    if (to < 0) return 0;
    const points = problem.locations.pointId;
    if ((points[from] ?? -1) === (points[to] ?? -2)) return 0;
    const t = problem.tierIndex[tier] ?? -1;
    if (t < 0) return FAR_MS;
    const ms = problem.matrix[(t * n + from) * n + to] ?? NOT_REQUESTED;
    return ms >= 0 ? ms : FAR_MS;
  }

  /** The matrix ms into unit `u` from where the first `row` units of the current order end. */
  private legAt(row: number, u: number): number {
    const x = this.prefix.scalars;
    return this.entry(x[row * SCALAR_COUNT + S_LOC] ?? -1, x[row * SCALAR_COUNT + S_TIER] ?? 0, u);
  }

  /**
   * The pre-screen: the change in matrix travel of the legs a move changes (into each unit whose
   * predecessor changes, and into the unit after the window), each unit leaving from where it ended
   * in the current order. Or-opt and exchange change three or four legs, found from the prefix rows
   * in constant time; a reversal changes every leg inside it (`windowDelta`). Arithmetic only, no
   * transition and no evaluation; a move is priced only when this is below the tolerance.
   */
  private travelDelta(index: number, i: number, p: number, m: number): number {
    const kind = this.moveKind[index] ?? 0;
    if (kind === REVERSE) return this.windowDelta(p, m);
    const n = this.n;
    const seq = this.seq;
    const at = (k: number): number => seq[k] ?? 0;
    const q = p + m;
    if (kind === EXCHANGE) {
      // S[i-1] | S[j] S[i+1] ... S[j-1] S[i] | S[j+1], with j = q - 1 ≥ i + 2.
      const j = q - 1;
      const after = this.legAt(i, at(j)) + this.legAt(j + 1, at(i + 1)) + this.legAt(j, at(i)) + (q < n ? this.legAt(i + 1, at(q)) : 0);
      const before = this.legAt(i, at(i)) + this.legAt(i + 1, at(i + 1)) + this.legAt(j, at(j)) + (q < n ? this.legAt(q, at(q)) : 0);
      return after - before;
    }
    const run = this.moveRun[index] ?? 1;
    if ((this.moveOffset[index] ?? 0) > 0) {
      // Forward: S[i-1] | S[i+r] ... S[q-1] S[i] ... S[i+r-1] | S[q].
      const after = this.legAt(i, at(i + run)) + this.legAt(q, at(i)) + (q < n ? this.legAt(i + run, at(q)) : 0);
      const before = this.legAt(i, at(i)) + this.legAt(i + run, at(i + run)) + (q < n ? this.legAt(q, at(q)) : 0);
      return after - before;
    }
    // Backward: S[p-1] | S[i] ... S[i+r-1] S[p] ... S[i-1] | S[q], with q = i + r.
    const after = this.legAt(p, at(i)) + this.legAt(q, at(p)) + (q < n ? this.legAt(i, at(q)) : 0);
    const before = this.legAt(p, at(p)) + this.legAt(i, at(i)) + (q < n ? this.legAt(q, at(q)) : 0);
    return after - before;
  }

  /** The pre-screen of any window order `win` (every leg in the window, and into the unit after it). */
  private windowDelta(p: number, m: number): number {
    const n = this.n;
    const x = this.prefix.scalars;
    const q = p + m;
    let before = 0;
    for (let k = p; k <= q && k < n; k += 1) before += this.entry(x[k * SCALAR_COUNT + S_LOC] ?? -1, x[k * SCALAR_COUNT + S_TIER] ?? 0, this.seq[k] ?? 0);
    let row = p;
    let after = 0;
    for (let a = 0; a < m; a += 1) {
      const u = this.win[a] ?? 0;
      after += this.legAt(row, u);
      row = (this.posOf[u] ?? 0) + 1;
    }
    if (q < n) after += this.legAt(row, this.seq[q] ?? 0);
    return after - before;
  }

  /**
   * Whether the pre-screen may judge the window [p, p + m) by travel alone: it ends before the order
   * does, and it and the unit after it are all screenable (review M7Q Q-04).
   */
  private screened(p: number, m: number): boolean {
    const q = p + m;
    if (q >= this.n) return false;
    for (let k = p; k <= q; k += 1) if ((this.screenable[this.seq[k] ?? 0] ?? 0) === 0) return false;
    return true;
  }

  /** Prices the window [p, p + m) in the order `win`; true when it lowers `comparedMs` and is kept. */
  private tryWindow(p: number, m: number): boolean {
    if (!this.keepsEdges(m)) return false;
    const n = this.n;
    const q = p + m;
    this.prefix.load(p, this.w);
    let ok = true;
    for (let a = 0; a < m && ok; a += 1) ok = this.applyOne(this.win[a] ?? 0);
    // One unit past the window both orders apply the same unit, so both stand at its destination.
    let r = q;
    if (ok && r < n) {
      ok = this.applyOne(this.seq[r] ?? 0);
      r += 1;
    }
    if (!ok) return false;
    let exact = false;
    if (r < n) {
      const at = r * SCALAR_COUNT;
      const delta = this.w.elapsed + this.w.waitExcess - ((this.prefix.scalars[at + S_ELAPSED] ?? 0) + (this.prefix.scalars[at + S_WAIT_EXCESS] ?? 0));
      if (delta >= 0) return false;
      exact = this.sameRest(r);
    }
    if (!exact) {
      for (let k = r; k < n && ok; k += 1) ok = this.applyOne(this.seq[k] ?? 0);
      if (!ok) return false;
      const closed = this.host.t.close(this.w);
      if (closed === null || closed.comparedMs >= this.ms) return false;
    }
    return this.keep(p, m);
  }

  /** Writes the window into the order and re-prices it; kept (and listed) only when it lowers `comparedMs`. */
  private keep(p: number, m: number): boolean {
    this.undoBuffer.set(this.seq.subarray(p, p + m));
    this.seq.set(this.win.subarray(0, m), p);
    const kept = this.rebuild(p);
    if (kept === null || kept.comparedMs >= this.ms) {
      this.seq.set(this.undoBuffer.subarray(0, m), p);
      this.rebuild(p);
      return false;
    }
    this.ms = kept.comparedMs;
    for (let k = p; k < p + m; k += 1) this.posOf[this.seq[k] ?? 0] = k;
    this.host.addSolution(this.seq.subarray(0, this.n), kept);
    // The window and its two neighbours have new neighbourhoods.
    for (let k = Math.max(0, p - 1); k <= Math.min(this.n - 1, p + m); k += 1) this.clean[this.seq[k] ?? 0] = 0;
    return true;
  }

  /**
   * Drops quest q from the order when that lowers `comparedMs`: every unit of q is in the order, q
   * is droppable, and the XP its units granted leaves the rest at the target (or the fill may
   * replace quests). True when kept.
   */
  private tryDrop(q: number): boolean {
    const problem = this.host.problem;
    if ((problem.quests.obligatory[q] ?? 1) === 1) return false;
    const { unitStart, units } = problem.quests;
    const x = this.prefix.scalars;
    let first = this.n;
    let xp = 0;
    for (let k = unitStart[q] ?? 0; k < (unitStart[q + 1] ?? 0); k += 1) {
      const at = this.posOf[units[k] ?? 0] ?? -1;
      if (at < 0) return false;
      first = Math.min(first, at);
      xp += (x[(at + 1) * SCALAR_COUNT + S_KNOWN_TOTAL] ?? 0) - (x[at * SCALAR_COUNT + S_KNOWN_TOTAL] ?? 0);
    }
    if (first === this.n) return false;
    const gain = (x[this.n * SCALAR_COUNT + S_KNOWN_TOTAL] ?? 0) - problem.start.knownTotal;
    if (!problem.fill.replaceQuests && gain - xp < problem.targetXp) return false;
    for (let k = unitStart[q] ?? 0; k < (unitStart[q + 1] ?? 0); k += 1) this.removed[units[k] ?? 0] = 1;
    let m = 0;
    for (let k = first; k < this.n; k += 1) {
      const u = this.seq[k] ?? 0;
      if ((this.removed[u] ?? 0) === 0) this.win[m++] = u;
    }
    for (let k = unitStart[q] ?? 0; k < (unitStart[q + 1] ?? 0); k += 1) this.removed[units[k] ?? 0] = 0;
    this.prefix.load(first, this.w);
    let ok = true;
    for (let a = 0; a < m && ok; a += 1) ok = this.applyOne(this.win[a] ?? 0);
    if (!ok) return false;
    const closed = this.host.t.close(this.w);
    if (closed === null || closed.comparedMs >= this.ms) return false;
    // Keep it: the order from `first` loses q's units.
    const oldN = this.n;
    this.undoBuffer.set(this.seq.subarray(first, oldN));
    this.seq.set(this.win.subarray(0, m), first);
    this.n = first + m;
    const kept = this.rebuild(first);
    if (kept === null || kept.comparedMs >= this.ms) {
      this.seq.set(this.undoBuffer.subarray(0, oldN - first), first);
      this.n = oldN;
      this.rebuild(first);
      return false;
    }
    this.ms = kept.comparedMs;
    for (let k = unitStart[q] ?? 0; k < (unitStart[q + 1] ?? 0); k += 1) this.posOf[units[k] ?? 0] = -1;
    for (let k = first; k < this.n; k += 1) {
      this.posOf[this.seq[k] ?? 0] = k;
      this.clean[this.seq[k] ?? 0] = 0;
    }
    if (first > 0) this.clean[this.seq[first - 1] ?? 0] = 0;
    this.host.addSolution(this.seq.subarray(0, this.n), kept);
    return true;
  }

  /**
   * Runs the pass over `base` (see `wants`); true when it is complete. With `focus` (pairs of
   * positions [from, to) in `base`), only the units there start dirty; with `remember` false, the
   * pass leaves `polished` alone (the iterated local search's passes). The start is priced from
   * scratch; `resultMs` and `resultUnits()` give where the pass ended.
   */
  step(base: Pick<SearchSolution, 'units'>, focus: readonly number[] | null = null, remember = true): boolean {
    const meter = this.host.meter;
    if (!this.active) {
      this.active = true;
      this.built = false;
      this.remember = remember;
      if (remember) this.polished.add(base.units.join(','));
      this.n = base.units.length;
      this.seq.set(base.units);
      this.ms = Number.POSITIVE_INFINITY;
      this.resultMs = Number.POSITIVE_INFINITY;
      this.i = 0;
      this.move = 0;
      this.improvedInScan = false;
      this.dropping = this.host.problem.dropMove;
      this.dropCursor = 0;
      for (let k = 0; k < this.n; k += 1) {
        this.clean[this.seq[k] ?? 0] = focus === null ? 0 : 1;
        this.posOf[this.seq[k] ?? 0] = k;
      }
      if (focus !== null) {
        for (let f = 0; f + 1 < focus.length; f += 2) {
          for (let k = Math.max(0, focus[f] ?? 0); k < Math.min(this.n, focus[f + 1] ?? 0); k += 1) this.clean[this.seq[k] ?? 0] = 0;
        }
      }
      this.prefix.store(0, this.host.t.createState(), -1);
    }
    if (!this.built) {
      // The prefix states, built once per pass (never split by a slice).
      if (meter.paused) return false;
      const start = this.rebuild(0);
      if (start === null) return this.end(false);
      this.ms = start.comparedMs;
      this.built = true;
    }
    const moves = this.moveKind.length;
    const quests = this.host.problem.quests.count;
    for (;;) {
      if (this.dropping) {
        if (this.dropCursor >= quests) {
          this.dropping = false;
          continue;
        }
        if (meter.spent) return this.end();
        if (meter.paused) return false;
        const q = this.dropCursor;
        this.dropCursor += 1;
        meter.work(PRESCREEN_WORK);
        if (this.tryDrop(q)) this.improvedInScan = true;
        continue;
      }
      if (this.i >= this.n) {
        if (!this.improvedInScan) return this.end();
        this.i = 0;
        this.move = 0;
        this.improvedInScan = false;
        this.dropping = this.host.problem.dropMove;
        this.dropCursor = 0;
        continue;
      }
      const u = this.seq[this.i] ?? 0;
      if ((this.clean[u] ?? 0) === 1 || this.move >= moves) {
        this.clean[u] = 1;
        this.i += 1;
        this.move = 0;
        continue;
      }
      if (meter.spent) return this.end();
      if (meter.paused) return false;
      const index = this.move;
      this.move += 1;
      const p = this.fill(index, this.i);
      if (p < 0) continue;
      if (this.screened(p, this.length)) {
        meter.work(PRESCREEN_WORK);
        if (this.travelDelta(index, this.i, p, this.length) >= this.tolerance) continue;
      }
      if (this.tryWindow(p, this.length)) {
        this.improvedInScan = true;
        this.move = 0;
      }
    }
  }

  /** Ends the pass; `closed` is false when its start did not close (nothing to report). */
  private end(closed = true): boolean {
    this.active = false;
    if (closed) this.resultMs = this.ms;
    // A pass on its own result would find nothing.
    if (this.remember) this.polished.add(this.seq.subarray(0, this.n).join(','));
    return true;
  }
}
