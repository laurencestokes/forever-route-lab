import type { Truth } from '../../domain/conditions';
import { grantXp } from '../../sim/xp';
import { addMod, type HashLayout, P1, P2, QUEST_STATUSES, subMod } from './hash';
import { CROSS_MAP, NOT_REQUESTED, UNKNOWN_MS } from './matrix';
import type { Pricing } from './pricing';
import { type AvailabilityCheck, type Op, type OpTravel, type PredicateCheck, type SearchProblem, SPAWN_LOST, SPAWN_NONE } from './types';

/**
 * Transitions (docs/research/optimizer-m7.md §6): one unit applied to a search state, exactly as
 * the engine's `runStep` would run its steps (engine/steps.ts), with each part rounded to integer
 * milliseconds once; the implicit drops and precedence edges of §3.4-§3.5; the dynamic checks of
 * §4.2; and closing (§7.5) with the terminal grind fill and the exit chain (§5.4).
 */

export const STATUS_UNTOUCHED = 0;
export const STATUS_IN_LOG = 1;
export const STATUS_TURNED_IN = 2;
export const STATUS_ABANDONED = 3;
export const STATUS_DROPPED = 4;

/** A search state: scalars, the scheduled units and the pool quests' statuses. */
export interface NodeState {
  loc: number;
  tier: number;
  unknownXp: number;
  sinceCastUnknown: number;
  level: number;
  xpInto: number;
  knownTotal: number;
  elapsed: number;
  readyAt: number;
  lastVisit: number;
  logCount: number;
  unknownParts: number;
  divergence: number;
  anyDropped: number;
  /** The first unit, in original order, neither scheduled nor dropped (divergence). */
  firstOpen: number;
  /** Obligatory units scheduled. */
  oblScheduled: number;
  /**
   * Hearth waits whose length is uncertain (TIME-4: unknown time since the cast). They are unknown
   * time, counted apart from `unknownParts` because their number depends on the clock.
   */
  waitParts: number;
  /**
   * At each such wait, how much of its upper bound exceeds the incumbent's there, summed (ms;
   * review COR-01/02). `elapsed + waitExcess` is the time with every uncertain wait at the worse of
   * its two extremes relative to the incumbent, so a saving over the incumbent measured on it holds
   * however long the unknown time was.
   */
  waitExcess: number;
  /** The hash lanes of the scheduled set and the quest statuses (§7.2). */
  set1: number;
  set2: number;
  readonly scheduled: Uint8Array;
  readonly status: Uint8Array;
}

export const SCALAR_COUNT = 20;

export function saveScalars(s: NodeState, out: Float64Array, at = 0): void {
  out[at] = s.loc;
  out[at + 1] = s.tier;
  out[at + 2] = s.unknownXp;
  out[at + 3] = s.sinceCastUnknown;
  out[at + 4] = s.level;
  out[at + 5] = s.xpInto;
  out[at + 6] = s.knownTotal;
  out[at + 7] = s.elapsed;
  out[at + 8] = s.readyAt;
  out[at + 9] = s.lastVisit;
  out[at + 10] = s.logCount;
  out[at + 11] = s.unknownParts;
  out[at + 12] = s.divergence;
  out[at + 13] = s.anyDropped;
  out[at + 14] = s.firstOpen;
  out[at + 15] = s.oblScheduled;
  out[at + 16] = s.set1;
  out[at + 17] = s.set2;
  out[at + 18] = s.waitParts;
  out[at + 19] = s.waitExcess;
}

export function loadScalars(from: Float64Array, s: NodeState, at = 0): void {
  s.loc = from[at] ?? -1;
  s.tier = from[at + 1] ?? 0;
  s.unknownXp = from[at + 2] ?? 0;
  s.sinceCastUnknown = from[at + 3] ?? 0;
  s.level = from[at + 4] ?? 1;
  s.xpInto = from[at + 5] ?? 0;
  s.knownTotal = from[at + 6] ?? 0;
  s.elapsed = from[at + 7] ?? 0;
  s.readyAt = from[at + 8] ?? 0;
  s.lastVisit = from[at + 9] ?? -1;
  s.logCount = from[at + 10] ?? 0;
  s.unknownParts = from[at + 11] ?? 0;
  s.divergence = from[at + 12] ?? 0;
  s.anyDropped = from[at + 13] ?? 0;
  s.firstOpen = from[at + 14] ?? 0;
  s.oblScheduled = from[at + 15] ?? 0;
  s.set1 = from[at + 16] ?? 0;
  s.set2 = from[at + 17] ?? 0;
  s.waitParts = from[at + 18] ?? 0;
  s.waitExcess = from[at + 19] ?? 0;
}

export interface Closed {
  /** Known ms with every uncertain hearth wait at 0, as the engine prices it (the parity figure). */
  readonly estimatedMs: number;
  /** `estimatedMs` plus the uncertain waits' excess over the incumbent's (`NodeState.waitExcess`). */
  readonly comparedMs: number;
  readonly knownGain: number;
  readonly fillXp: number;
  readonly fillMs: number;
  readonly exitMs: number;
  /** Every part with unknown time, uncertain hearth waits included. */
  readonly unknownParts: number;
  /** The uncertain hearth waits among them. */
  readonly uncertainWaits: number;
  /** Figures of the state at the section end (the incumbent's become the closing limits). */
  readonly readyAtMs: number;
  readonly tier: number;
}

const RANK: Readonly<Record<Truth, number>> = { false: 0, unknown: 1, true: 2 };
const min3 = (a: Truth, b: Truth): Truth => (RANK[a] <= RANK[b] ? a : b);
const not3 = (t: Truth): Truth => (t === 'unknown' ? 'unknown' : t === 'true' ? 'false' : 'true');

export class Transitions {
  readonly units: number;
  readonly quests: number;
  private readonly n: number;
  private readonly oblTotal: number;
  private readonly maxLevel: number;
  private readonly castMs: number;
  private readonly cooldownMs: number;
  /** Status changes of the current evaluation: (quest, old status, new status) triples. */
  log = new Int32Array(3 * 1024);
  logSize = 0;
  /** Why the last `apply` or `close` failed. */
  failure = '';
  /** Whether the last `close` failed only because the known XP cannot reach the target. */
  targetOutOfReach = false;
  /**
   * Whether the last `close` failed only because a grind fill cannot follow unknown XP (XP-4): with
   * the target lowered by `unknownXpShortfall` it would have closed (review PAR-04).
   */
  blockedByUnknownXp = false;
  unknownXpShortfall = 0;
  /**
   * Compile only: each hearth-use op records its uncertain wait's upper bound here (ms, by op index),
   * the incumbent's figures that `SearchProblem.incumbentWaits` holds.
   */
  recordWaits: Float64Array | null = null;
  /** Compile only: the unknown-time legs the incumbent uses are recorded here and allowed (§5.3). */
  recordUnknown: Set<number> | null = null;
  /** Parts rounded to integer ms so far (the parity bound of §6.3 is 1 ms per part). */
  pricedParts = 0;
  // Per-op accumulators (no allocation in the hot path).
  private travelMs = 0;
  private waitMs = 0;
  private workMs = 0;
  private unknownTravel = 0;
  private unknownWork = 0;
  private legWalked = false;
  /** Pricing the exit chain: a move between world maps is unknown travel there (review PAR-01). */
  private inExit = false;
  /** Groups whose waypoints the current unit (or the exit chain) walked. */
  private localGroups = new Int32Array(64);
  private localCount = 0;

  constructor(
    readonly problem: SearchProblem,
    readonly pricing: Pricing,
    readonly layout: HashLayout,
  ) {
    this.units = problem.units.count;
    this.quests = problem.quests.count;
    this.n = problem.locations.count;
    let obligatory = 0;
    for (let u = 0; u < this.units; u += 1) obligatory += problem.units.obligatory[u] ?? 0;
    this.oblTotal = obligatory;
    this.maxLevel = pricing.curve.maxLevel;
    this.castMs = Math.round(problem.rules.values.hearthCastSeconds.value * 1000);
    this.cooldownMs = Math.round(problem.rules.values.hearthCooldownSeconds.value * 1000);
  }

  // ===========================================================================================
  // The start state

  createState(): NodeState {
    const p = this.problem;
    const start = p.start;
    const status = new Uint8Array(this.quests);
    let logCount = start.externalActive;
    let set1 = 0;
    let set2 = 0;
    for (let q = 0; q < this.quests; q += 1) {
      const st = p.quests.startStatus[q] ?? 0;
      status[q] = st;
      if (st === STATUS_IN_LOG) logCount += 1;
      const slot = this.layout.questBase + q * QUEST_STATUSES + st;
      set1 = addMod(set1, this.layout.c1[slot] ?? 0, P1);
      set2 = addMod(set2, this.layout.c2[slot] ?? 0, P2);
    }
    return {
      loc: start.loc,
      tier: start.tier,
      unknownXp: start.unknownXp,
      sinceCastUnknown: start.sinceCastUnknown,
      level: start.level,
      xpInto: start.xpInto,
      knownTotal: start.knownTotal,
      elapsed: 0,
      readyAt: start.readyAtMs,
      lastVisit: start.lastVisit,
      logCount,
      unknownParts: 0,
      divergence: 0,
      anyDropped: 0,
      firstOpen: 0,
      oblScheduled: 0,
      waitParts: 0,
      waitExcess: 0,
      set1,
      set2,
      scheduled: new Uint8Array(this.units),
      status,
    };
  }

  // ===========================================================================================
  // Status changes and units

  private setStatus(s: NodeState, q: number, next: number): void {
    const old = s.status[q] ?? 0;
    if (old === next) return;
    if (this.logSize + 3 > this.log.length) {
      const grown = new Int32Array(this.log.length * 2);
      grown.set(this.log);
      this.log = grown;
    }
    this.log[this.logSize] = q;
    this.log[this.logSize + 1] = old;
    this.log[this.logSize + 2] = next;
    this.logSize += 3;
    s.status[q] = next;
    const base = this.layout.questBase + q * QUEST_STATUSES;
    s.set1 = addMod(subMod(s.set1, this.layout.c1[base + old] ?? 0, P1), this.layout.c1[base + next] ?? 0, P1);
    s.set2 = addMod(subMod(s.set2, this.layout.c2[base + old] ?? 0, P2), this.layout.c2[base + next] ?? 0, P2);
  }

  /** Reverts the status changes logged from `from` on. */
  undoStatuses(s: NodeState, from: number): void {
    for (let k = this.logSize - 3; k >= from; k -= 3) {
      const q = this.log[k] ?? 0;
      s.status[q] = this.log[k + 1] ?? 0;
    }
    this.logSize = from;
  }

  /** Whether a unit is dropped (any of its quests is). */
  unitDropped(s: NodeState, u: number): boolean {
    const { questStart, quests } = this.problem.units;
    for (let k = questStart[u] ?? 0; k < (questStart[u + 1] ?? 0); k += 1) if ((s.status[quests[k] ?? 0] ?? 0) === STATUS_DROPPED) return true;
    return false;
  }

  /**
   * Whether a unit can be scheduled next (§7.3): unscheduled and not dropped, every `require`
   * predecessor scheduled, and every `order` predecessor scheduled or droppable.
   */
  enabled(s: NodeState, u: number): boolean {
    if ((s.scheduled[u] ?? 0) === 1 || this.unitDropped(s, u)) return false;
    const { predStart, pred, kind } = this.problem.edges;
    for (let k = predStart[u] ?? 0; k < (predStart[u + 1] ?? 0); k += 1) {
      const p = pred[k] ?? 0;
      if ((s.scheduled[p] ?? 0) === 1) continue;
      if ((kind[k] ?? 0) === 0) return false;
      if ((this.problem.units.obligatory[p] ?? 0) === 1) return false;
    }
    return true;
  }

  /** Drops a droppable quest and cascades through `require` edges (§3.4); false when a drop is not allowed. */
  private drop(s: NodeState, q: number): boolean {
    if ((s.status[q] ?? 0) === STATUS_DROPPED) return true;
    const p = this.problem;
    if ((p.quests.obligatory[q] ?? 0) === 1) {
      this.failure = `quest ${String(p.quests.ids[q])} is obligatory`;
      return false;
    }
    const { unitStart, units } = p.quests;
    for (let k = unitStart[q] ?? 0; k < (unitStart[q + 1] ?? 0); k += 1) {
      if ((s.scheduled[units[k] ?? 0] ?? 0) === 1) {
        this.failure = `quest ${String(p.quests.ids[q])} would be left partly scheduled`;
        return false;
      }
    }
    this.setStatus(s, q, STATUS_DROPPED);
    s.anyDropped = 1;
    const { succStart, succ } = p.edges;
    for (let k = unitStart[q] ?? 0; k < (unitStart[q + 1] ?? 0); k += 1) {
      const x = units[k] ?? 0;
      for (let j = succStart[x] ?? 0; j < (succStart[x + 1] ?? 0); j += 1) {
        const v = succ[j] ?? 0;
        if ((p.units.obligatory[v] ?? 0) === 1) {
          this.failure = `dropping quest ${String(p.quests.ids[q])} removes a predecessor of an obligatory unit`;
          return false;
        }
        for (let m = p.units.questStart[v] ?? 0; m < (p.units.questStart[v + 1] ?? 0); m += 1) if (!this.drop(s, p.units.quests[m] ?? 0)) return false;
      }
    }
    return true;
  }

  private advanceFirstOpen(s: NodeState): void {
    while (s.firstOpen < this.units && ((s.scheduled[s.firstOpen] ?? 0) === 1 || this.unitDropped(s, s.firstOpen))) s.firstOpen += 1;
  }

  /**
   * Schedules unit `u` (§7.3): its implicit drops, then its steps. False when the child is
   * infeasible (`failure` says why); the state is then partly changed and the caller restores it.
   */
  apply(s: NodeState, u: number): boolean {
    if (!this.enabled(s, u)) {
      this.failure = `unit ${String(u)} is not enabled`;
      return false;
    }
    return this.applyEnabled(s, u);
  }

  /** `apply` for a unit the caller has found enabled. */
  applyEnabled(s: NodeState, u: number): boolean {
    const p = this.problem;
    const { predStart, pred } = p.edges;
    for (let k = predStart[u] ?? 0; k < (predStart[u + 1] ?? 0); k += 1) {
      const x = pred[k] ?? 0;
      if ((s.scheduled[x] ?? 0) === 1) continue;
      for (let m = p.units.questStart[x] ?? 0; m < (p.units.questStart[x + 1] ?? 0); m += 1) if (!this.drop(s, p.units.quests[m] ?? 0)) return false;
    }
    this.advanceFirstOpen(s);
    if (u > s.firstOpen) s.divergence += 1;
    this.localCount = 0;
    for (let k = p.units.opStart[u] ?? 0; k < (p.units.opStart[u + 1] ?? 0); k += 1) {
      const op = p.ops[k];
      if (op === undefined || !this.applyOp(s, op, k)) return false;
    }
    s.scheduled[u] = 1;
    s.set1 = addMod(s.set1, this.layout.c1[this.layout.unitBase + u] ?? 0, P1);
    s.set2 = addMod(s.set2, this.layout.c2[this.layout.unitBase + u] ?? 0, P2);
    if ((p.units.obligatory[u] ?? 0) === 1) s.oblScheduled += 1;
    this.advanceFirstOpen(s);
    return true;
  }

  // ===========================================================================================
  // Travel (TIME-2)

  private allowedUnknown(from: number, to: number): boolean {
    const list = this.problem.unknownPairs;
    const code = from * this.n + to;
    let lo = 0;
    let hi = list.length - 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const value = list[mid] ?? 0;
      if (value === code) return true;
      if (value < code) lo = mid + 1;
      else hi = mid - 1;
    }
    return false;
  }

  /** `walkTo` on one world map: a ground leg `radius` yards short, from the matrix (§5.2, §5.3). */
  private move(s: { loc: number; readonly tier: number }, to: number, radius: number, walk: boolean): boolean {
    const from = s.loc;
    if (to < 0 || from < 0) {
      // An unresolved destination, or a move from an unknown position: unknown travel (TIME-13).
      this.unknownTravel += 1;
      s.loc = to;
      return true;
    }
    const loc = this.problem.locations;
    if ((loc.pointId[from] ?? -1) === (loc.pointId[to] ?? -2)) {
      s.loc = to;
      return true;
    }
    const tier = this.problem.tierIndex[walk ? 0 : s.tier] ?? -1;
    if (tier < 0) throw new Error(`Riding tier ${String(walk ? 0 : s.tier)} has no matrix`);
    const m = this.problem.matrix[(tier * this.n + from) * this.n + to] ?? NOT_REQUESTED;
    if (m === NOT_REQUESTED) throw new Error(`Leg ${String(from)} → ${String(to)} was not requested`);
    if (m === CROSS_MAP) {
      if (this.inExit) {
        // The exit chain runs the suffix as the engine walks it: a move between world maps without
        // a transport is unknown travel to the destination (TIME-7, SIM-4).
        this.unknownTravel += 1;
        s.loc = to;
        return true;
      }
      this.failure = 'a move between world maps outside an anchor';
      return false;
    }
    if (m === UNKNOWN_MS) {
      if (this.recordUnknown !== null) this.recordUnknown.add(from * this.n + to);
      else if (!this.allowedUnknown(from, to)) {
        this.failure = 'a leg with unknown time the original did not use';
        return false;
      }
      this.unknownTravel += 1;
      this.legWalked = true;
      s.loc = to;
      return true;
    }
    let ms = m;
    if (radius > 0) {
      const dx = (loc.x[from] ?? 0) - (loc.x[to] ?? 0);
      const dy = (loc.y[from] ?? 0) - (loc.y[to] ?? 0);
      const d = Math.sqrt(dx * dx + dy * dy);
      const reach = Math.max(0, d - radius);
      if (reach === 0) {
        s.loc = to;
        return true;
      }
      ms = Math.round((m * reach) / d);
      this.pricedParts += 1;
    }
    this.pricedParts += 1;
    this.travelMs += ms;
    this.legWalked = true;
    s.loc = to;
    return true;
  }

  /** An op's travel: its group's waypoint chain when due, then its destination. */
  private travel(s: NodeState | ExitCursor, travel: OpTravel, scheduled: Uint8Array): boolean {
    const g = travel.group;
    if (g >= 0 && !this.groupDoneFor(scheduled, g)) {
      if (this.localCount === this.localGroups.length) {
        const grown = new Int32Array(this.localGroups.length * 2);
        grown.set(this.localGroups);
        this.localGroups = grown;
      }
      this.localGroups[this.localCount] = g;
      this.localCount += 1;
      const groups = this.problem.groups;
      for (let k = groups.chainStart[g] ?? 0; k < (groups.chainStart[g + 1] ?? 0); k += 1) {
        if (!this.move(s, groups.chainLoc[k] ?? -1, groups.chainRadius[k] ?? 0, travel.walk)) return false;
      }
    }
    const dest = travel.dest;
    switch (dest.kind) {
      case 'none':
        return true;
      case 'loc':
        return this.move(s, dest.loc, dest.radius, travel.walk);
      case 'lost':
        this.unknownTravel += 1;
        s.loc = -1;
        return true;
      case 'spawn': {
        const chosen = this.problem.spawnTables.data[dest.table * (this.n + 1) + s.loc + 1] ?? SPAWN_LOST;
        if (chosen === SPAWN_NONE) return true;
        if (chosen === SPAWN_LOST) {
          this.unknownTravel += 1;
          s.loc = -1;
          return true;
        }
        return this.move(s, chosen, 0, travel.walk);
      }
    }
  }

  private localHas(g: number): boolean {
    for (let k = 0; k < this.localCount; k += 1) if (this.localGroups[k] === g) return true;
    return false;
  }

  private groupDoneFor(scheduled: Uint8Array, g: number): boolean {
    const groups = this.problem.groups;
    if ((groups.prefixDone[g] ?? 0) === 1 || this.localHas(g)) return true;
    for (let k = groups.unitStart[g] ?? 0; k < (groups.unitStart[g + 1] ?? 0); k += 1) if ((scheduled[groups.units[k] ?? 0] ?? 0) === 1) return true;
    return false;
  }

  // ===========================================================================================
  // XP (XP-2)

  /** XP-2: a known grant; the fast path within a level equals `grantXp` (a property test checks it). */
  grant(s: NodeState, amount: number): void {
    if (amount <= 0 || s.level >= this.maxLevel) return;
    const curve = this.pricing.curve;
    const span = curve.toNext[s.level - 1] ?? 0;
    if (s.xpInto + amount < span) {
      s.xpInto += amount;
      s.knownTotal += amount;
      return;
    }
    const next = grantXp(curve, { level: s.level, xp: s.xpInto }, amount);
    s.level = next.level;
    s.xpInto = next.xp;
    s.knownTotal = (curve.cumulative[next.level - 1] ?? 0) + next.xp;
  }

  // ===========================================================================================
  // Checks (§4.2)

  /** The dynamic part of an accept's availability: VAL-4/5, VAL-20 and VAL-13's target. */
  private dynamicTruth(s: NodeState, check: AvailabilityCheck): Truth {
    let t: Truth = 'true';
    const uncertain = s.unknownXp > 0;
    const capacity = this.problem.checks.capacity;
    if (!check.levelLifted) {
      if (check.minLevel !== null && s.level < check.minLevel) t = min3(t, uncertain ? 'unknown' : 'false');
      if (check.maxLevel !== null && check.maxLevel > 0) {
        if (s.level > check.maxLevel) t = 'false';
        else if (uncertain) t = min3(t, 'unknown');
      }
    }
    const inLog = check.quest >= 0 ? (s.status[check.quest] ?? 0) === STATUS_IN_LOG : check.inLog;
    if (!inLog && s.logCount >= capacity) t = 'false';
    const target = check.target;
    if (target !== null) {
      let error = false;
      if (!target.levelLifted) {
        if (target.minLevel !== null && s.level < target.minLevel && !uncertain) error = true;
        if (target.maxLevel !== null && target.maxLevel > 0 && s.level > target.maxLevel) error = true;
      }
      if (!target.inLog && s.logCount >= capacity) error = true;
      if (error) t = min3(t, 'unknown');
    }
    return t;
  }

  private acceptTruth(s: NodeState, index: number): Truth {
    const check = this.problem.checks.accepts[index];
    if (check === undefined) throw new RangeError(`No availability check ${String(index)}`);
    return min3(check.static, this.dynamicTruth(s, check));
  }

  private predicateTruth(s: NodeState, predicate: PredicateCheck): Truth {
    switch (predicate.kind) {
      case 'fixed':
        return predicate.original;
      case 'level': {
        if (!predicate.negate && !this.problem.checks.xpStepSkipping) return 'false';
        const reached = s.level > predicate.level || (s.level === predicate.level && s.xpInto >= (predicate.xp ?? 0));
        const truth: Truth = reached ? 'true' : s.unknownXp > 0 ? 'unknown' : 'false';
        return predicate.negate ? not3(truth) : truth;
      }
      case 'available': {
        let truth: Truth = predicate.match === 'any' ? 'false' : 'true';
        for (const index of predicate.checks) {
          const one = this.acceptTruth(s, index);
          if (predicate.match === 'any') truth = RANK[one] > RANK[truth] ? one : truth;
          else truth = min3(truth, one);
        }
        return predicate.negate ? not3(truth) : truth;
      }
    }
  }

  private conditionHolds(s: NodeState, index: number): boolean {
    const check = this.problem.checks.conditions[index];
    if (check === undefined) throw new RangeError(`No condition check ${String(index)}`);
    for (const predicate of check.group ?? []) {
      if (this.predicateTruth(s, predicate) !== predicate.original) {
        this.failure = 'a group condition would change';
        return false;
      }
    }
    for (const predicate of check.step) {
      if (this.predicateTruth(s, predicate) !== predicate.original) {
        this.failure = 'a step condition would change';
        return false;
      }
    }
    return true;
  }

  private present(s: NodeState, q: number): boolean {
    const status = s.status[q] ?? 0;
    return status === STATUS_IN_LOG || (this.problem.checks.unknownHistory && status === STATUS_UNTOUCHED);
  }

  // ===========================================================================================
  // One op (engine/steps.ts `runStep`)

  private resetParts(): void {
    this.travelMs = 0;
    this.waitMs = 0;
    this.workMs = 0;
    this.unknownTravel = 0;
    this.unknownWork = 0;
    this.legWalked = false;
  }

  private work(ms: number): void {
    this.pricedParts += 1;
    if (ms < 0) this.unknownWork += 1;
    else this.workMs += ms;
  }

  private enterLog(s: NodeState, q: number): void {
    if ((s.status[q] ?? 0) === STATUS_IN_LOG) return;
    this.setStatus(s, q, STATUS_IN_LOG);
    s.logCount += 1;
  }

  private leaveLog(s: NodeState, q: number, next: number): void {
    if ((s.status[q] ?? 0) === STATUS_IN_LOG) s.logCount -= 1;
    this.setStatus(s, q, next);
  }

  /**
   * One uncertain hearth wait (TIME-4): its upper bound `wait`, recorded at compile, and its excess
   * over the incumbent's bound at the same op (review COR-01/02).
   */
  private uncertainWait(index: number, wait: number): number {
    if (this.recordWaits !== null) this.recordWaits[index] = wait;
    return Math.max(0, wait - (this.problem.incumbentWaits[index] ?? 0));
  }

  applyOp(s: NodeState, op: Op, index: number): boolean {
    if (op.cond >= 0 && !this.conditionHolds(s, op.cond)) return false;
    if (op.kind === 'skip') {
      if (op.missing >= 0 && this.present(s, op.missing)) {
        this.failure = 'a skip-if-missing turn-in would run';
        return false;
      }
      return true;
    }
    this.resetParts();
    const p = this.problem;
    const pointBefore = s.loc < 0 ? -1 : (p.locations.pointId[s.loc] ?? -1);
    let visitKey = -1;
    let cast = false;
    switch (op.kind) {
      case 'accept': {
        if (op.anyOf >= 0) {
          const choice = p.checks.anyOf[op.anyOf];
          if (choice === undefined) throw new RangeError(`No any-of check ${String(op.anyOf)}`);
          for (let k = 0; k < choice.chosen; k += 1) {
            if (this.acceptTruth(s, choice.candidates[k] ?? 0) !== 'false') {
              this.failure = 'an any-of accept would choose another quest';
              return false;
            }
          }
        }
        if (op.availability >= 0) {
          const check = p.checks.accepts[op.availability];
          if (check !== undefined && RANK[this.acceptTruth(s, op.availability)] < RANK[check.original]) {
            this.failure = `accepting quest ${String(check.questId)} would be less available than in the original`;
            return false;
          }
        }
        if (!this.travel(s, op.travel, s.scheduled)) return false;
        const pointAfter = s.loc < 0 ? -1 : (p.locations.pointId[s.loc] ?? -1);
        visitKey = op.entityKey >= 0 ? op.entityKey : op.entityKey === -1 ? pointAfter : -1;
        const moved = pointBefore !== pointAfter || this.legWalked;
        this.workMs += moved || visitKey < 0 || s.lastVisit !== visitKey ? op.firstMs : op.furtherMs;
        this.enterLog(s, op.quest);
        break;
      }
      case 'complete': {
        const level = s.level;
        if (!this.travel(s, op.travel, s.scheduled)) return false;
        for (const q of op.quests) if ((s.status[q] ?? 0) !== STATUS_IN_LOG && this.present(s, q)) this.enterLog(s, q);
        if (op.partial) this.workMs += op.partialMs;
        else if (op.block >= 0) {
          this.work(this.pricing.blockSeconds(op.block, level));
          this.grant(s, this.pricing.blockKillXp(op.block, level));
        }
        break;
      }
      case 'turnin': {
        if (!this.travel(s, op.travel, s.scheduled)) return false;
        this.workMs += op.interactionMs;
        const present = this.present(s, op.quest);
        if (present !== op.turnsIn) {
          this.failure = 'a turn-in would change whether it turns its quest in';
          return false;
        }
        if (op.requirePresent && !present) {
          this.failure = 'a skip-if-missing turn-in would be skipped';
          return false;
        }
        if (present) {
          const wasInLog = (s.status[op.quest] ?? 0) === STATUS_IN_LOG;
          if (op.carry >= 0 && wasInLog) {
            this.work(this.pricing.blockSeconds(op.carry, s.level));
            this.grant(s, this.pricing.blockKillXp(op.carry, s.level));
          }
          const xp = this.pricing.questXp(p.quests.xp[op.quest] ?? 0, s.level);
          if (xp < 0) s.unknownXp += 1;
          else this.grant(s, xp);
          this.leaveLog(s, op.quest, STATUS_TURNED_IN);
        }
        break;
      }
      case 'abandon': {
        if (!this.travel(s, op.travel, s.scheduled)) return false;
        if (this.present(s, op.quest)) this.leaveLog(s, op.quest, STATUS_ABANDONED);
        break;
      }
      case 'plain': {
        if (!this.travel(s, op.travel, s.scheduled)) return false;
        this.workMs += op.interactionMs;
        if (op.train >= 0) {
          const spec = p.pricing.trains[op.train];
          const after = this.pricing.train(op.train, s.level, s.unknownXp, s.tier);
          if (spec === undefined || after !== spec.original) {
            this.failure = 'a riding train step would change its outcome';
            return false;
          }
          s.tier = after;
        }
        break;
      }
      case 'grind': {
        if (!this.travel(s, op.travel, s.scheduled)) return false;
        const spec = p.pricing.grinds[op.grind];
        if (spec === undefined) throw new RangeError(`No grind ${String(op.grind)}`);
        const price = this.pricing.grind(spec, s.level, s.xpInto, s.unknownXp);
        this.work(price.ms);
        if (price.xpGained > 0) {
          s.level = price.level;
          s.xpInto = price.xpInto;
          s.knownTotal = (this.pricing.curve.cumulative[price.level - 1] ?? 0) + price.xpInto;
        }
        if (price.resets) s.unknownXp = 0;
        break;
      }
      case 'hearth-use': {
        if (op.bindLoc < 0) {
          this.unknownTravel += 1;
          s.loc = -1;
          break;
        }
        const wait = Math.max(0, s.readyAt - s.elapsed);
        let waited = 0;
        if (wait > 0) {
          if (s.sinceCastUnknown === 1) {
            s.waitParts += 1;
            s.waitExcess += this.uncertainWait(index, wait);
          } else {
            this.waitMs += wait;
            waited = wait;
          }
        }
        this.travelMs += this.castMs;
        s.readyAt = s.elapsed + waited + this.castMs + this.cooldownMs;
        s.loc = op.bindLoc;
        cast = true;
        break;
      }
      case 'hearth-bind': {
        if (op.checkPoint !== -2) {
          const point = s.loc < 0 ? -1 : (p.locations.pointId[s.loc] ?? -1);
          if (point !== op.checkPoint) {
            this.failure = 'an unlocated bind would bind somewhere else';
            return false;
          }
        }
        if (!this.travel(s, op.travel, s.scheduled)) return false;
        this.workMs += op.interactionMs;
        break;
      }
      case 'table': {
        const t = this.problem.tierIndex[s.tier] ?? -1;
        const at = (op.table * p.tierCount + t) * (this.n + 1) + s.loc + 1;
        const ms = p.anchorTables.ms[at] ?? NOT_REQUESTED;
        if (t < 0 || ms === NOT_REQUESTED) throw new Error(`Table ${String(op.table)} has no entry for location ${String(s.loc)} at tier ${String(s.tier)}`);
        // The table holds the whole step as the engine priced it (its override included).
        this.pricedParts += 1;
        s.elapsed += ms;
        const unknown = p.anchorTables.unknown[at] ?? 0;
        s.unknownParts += unknown;
        if (unknown > 0) s.sinceCastUnknown = 1;
        s.loc = p.anchorTables.arrival[at] ?? -1;
        s.lastVisit = -1;
        if (s.unknownXp > 0 && s.level >= this.maxLevel) s.unknownXp = 0;
        return true;
      }
    }
    // TIME-8: a valid override replaces the interaction, objective and combat parts.
    if (op.overrideMs >= 0 && !(op.kind === 'complete' && op.partial)) {
      this.workMs = op.overrideMs;
      this.unknownWork = 0;
    }
    this.pricedParts += 1;
    s.elapsed += this.travelMs + this.waitMs + this.workMs;
    const unknown = this.unknownTravel + this.unknownWork;
    s.unknownParts += unknown;
    if (cast) s.sinceCastUnknown = 0;
    else if (unknown > 0) s.sinceCastUnknown = 1;
    s.lastVisit = op.kind === 'accept' ? visitKey : -1;
    // XP-4: at the effective cap the lower bound is the level.
    if (s.unknownXp > 0 && s.level >= this.maxLevel) s.unknownXp = 0;
    return true;
  }

  // ===========================================================================================
  // Closing (§7.5) and the exit chain (§5.4)

  /** Whether the node may close without the fill and limits: every obligatory unit scheduled and no quest partly scheduled. */
  structurallyClosable(s: NodeState): boolean {
    if (s.oblScheduled !== this.oblTotal) return false;
    const { unitStart, units } = this.problem.quests;
    for (let q = 0; q < this.quests; q += 1) {
      if ((s.status[q] ?? 0) === STATUS_DROPPED) continue;
      let scheduled = 0;
      const count = (unitStart[q + 1] ?? 0) - (unitStart[q] ?? 0);
      for (let k = unitStart[q] ?? 0; k < (unitStart[q + 1] ?? 0); k += 1) scheduled += s.scheduled[units[k] ?? 0] ?? 0;
      if (scheduled > 0 && scheduled < count) return false;
    }
    return true;
  }

  /** Whether every unscheduled unit is optional (the closing drops them) and some remain. */
  private dropsAtClose(s: NodeState): boolean {
    for (let u = 0; u < this.units; u += 1) if ((s.scheduled[u] ?? 0) === 0 && !this.unitDropped(s, u)) return true;
    return false;
  }

  /**
   * Closes a node (§7.5): drops the unscheduled optional quests, adds the terminal grind fill when
   * the known total is short of `fill.total` (the target, or the suffix interval's floor when that
   * is higher: review PAR-06), and adds the exit chain. `reference` skips the limits taken from the
   * incumbent (compile uses it to price the incumbent itself). Null when the node cannot close
   * (`failure` says why).
   */
  close(s: NodeState, reference = false): Closed | null {
    const p = this.problem;
    this.targetOutOfReach = false;
    this.blockedByUnknownXp = false;
    if (!this.structurallyClosable(s)) {
      this.failure = 'obligatory units are unscheduled, or a quest is partly scheduled';
      return null;
    }
    const dropped = s.anyDropped === 1 || this.dropsAtClose(s);
    if (!reference) {
      if (s.readyAt > p.incumbent.readyAtMs) {
        this.failure = 'the hearthstone would be ready later than in the original';
        return null;
      }
      if (s.tier < p.incumbent.tier) {
        this.failure = 'riding would be lower than in the original';
        return null;
      }
    }
    const gain = s.knownTotal - p.start.knownTotal;
    let fillMs = 0;
    let fillXp = 0;
    let total = s.knownTotal;
    /** Set when only the XP-4 rule stops the fill: the other rules are still checked, for the diagnostic. */
    let blocked = '';
    const short = gain < p.targetXp;
    if (short || total < p.fill.total) {
      const fillAllowed = p.fill.until !== null && !(dropped && !p.fill.replaceQuests);
      if (s.unknownXp > 0 && short) {
        blocked = 'the known XP is short of the target, and a grind fill cannot follow unknown XP (XP-4)';
      } else if (s.unknownXp > 0 || !fillAllowed) {
        // Below the suffix floor only: the interval check below refuses it.
        if (short) {
          this.failure = 'the known XP is short of the target and no grind fill is allowed';
          this.targetOutOfReach = true;
          return null;
        }
      } else if (p.fill.until !== null) {
        const price = this.pricing.grind({ until: p.fill.until, mobLevel: null, xpPerHour: null, place: 'open-world' }, s.level, s.xpInto, 0);
        if (price.ms < 0) {
          this.failure = 'the grind fill cannot reach the target';
          this.targetOutOfReach = short;
          return null;
        }
        fillMs = price.ms;
        fillXp = price.xpGained;
        total = (this.pricing.curve.cumulative[price.level - 1] ?? 0) + price.xpInto;
        this.pricedParts += 1;
      }
    }
    if (!reference) {
      const delta = total - p.closing.originalEndTotal;
      if (delta < p.closing.deltaLo || delta >= p.closing.deltaHi) {
        this.failure = 'the XP at the section end would change a suffix threshold';
        return null;
      }
      if (p.closing.logRule === 'equal' ? s.logCount !== p.closing.originalLogCount : s.logCount > p.closing.originalLogCount) {
        this.failure = 'the quest log at the section end would differ';
        return null;
      }
    }
    const exit = this.exit(s, s.elapsed + fillMs);
    if (exit === null) return null;
    // Uncertain waits are bounded by `waitExcess`; the other unknown parts may not grow (§4.3).
    const fixedUnknown = s.unknownParts + exit.unknown;
    if (!reference && fixedUnknown > p.incumbent.unknownParts) {
      this.failure = 'more time would be unknown than in the original';
      return null;
    }
    if (blocked !== '') {
      this.failure = blocked;
      this.targetOutOfReach = true;
      this.blockedByUnknownXp = true;
      this.unknownXpShortfall = p.targetXp - gain;
      return null;
    }
    const estimatedMs = s.elapsed + fillMs + exit.ms;
    const uncertainWaits = s.waitParts + exit.waits;
    return {
      estimatedMs,
      comparedMs: estimatedMs + s.waitExcess + exit.excess,
      knownGain: gain,
      fillXp,
      fillMs,
      exitMs: exit.ms,
      unknownParts: fixedUnknown + uncertainWaits,
      uncertainWaits,
      readyAtMs: s.readyAt,
      tier: s.tier,
    };
  }

  /** The exit chain's travel and waiting from the node's end (§5.4, §6.3). */
  private exit(s: NodeState, elapsed: number): { readonly ms: number; readonly unknown: number; readonly waits: number; readonly excess: number } | null {
    const p = this.problem;
    const cursor: ExitCursor = { loc: s.loc, tier: s.tier };
    let readyAt = s.readyAt;
    let sinceCastUnknown = s.sinceCastUnknown;
    let ms = 0;
    let unknown = 0;
    let waits = 0;
    let excess = 0;
    this.localCount = 0;
    this.inExit = true;
    try {
      for (const index of p.exitOps) {
        const op = p.ops[index];
        if (op === undefined || op.kind === 'skip') continue;
        this.resetParts();
        let cast = false;
        switch (op.kind) {
          case 'table': {
            const t = p.tierIndex[cursor.tier] ?? -1;
            const at = (op.table * p.tierCount + t) * (this.n + 1) + cursor.loc + 1;
            const tableMs = p.anchorTables.exitMs[at] ?? NOT_REQUESTED;
            if (t < 0 || tableMs === NOT_REQUESTED) throw new Error(`Table ${String(op.table)} has no entry for location ${String(cursor.loc)}`);
            this.travelMs += tableMs;
            this.unknownTravel += p.anchorTables.unknown[at] ?? 0;
            cursor.loc = p.anchorTables.arrival[at] ?? -1;
            break;
          }
          case 'hearth-use': {
            if (op.bindLoc < 0) {
              this.unknownTravel += 1;
              cursor.loc = -1;
              break;
            }
            const now = elapsed + ms;
            const wait = Math.max(0, readyAt - now);
            let waited = 0;
            if (wait > 0) {
              if (sinceCastUnknown === 1) {
                waits += 1;
                excess += this.uncertainWait(index, wait);
              } else {
                this.waitMs += wait;
                waited = wait;
              }
            }
            this.travelMs += this.castMs;
            readyAt = now + waited + this.castMs + this.cooldownMs;
            cast = true;
            cursor.loc = op.bindLoc;
            break;
          }
          case 'accept':
          case 'complete':
          case 'turnin':
          case 'abandon':
          case 'plain':
          case 'grind':
          case 'hearth-bind':
            if (!this.travel(cursor, op.travel, s.scheduled)) return null;
            break;
        }
        this.pricedParts += 1;
        ms += this.travelMs + this.waitMs;
        unknown += this.unknownTravel;
        // As in `applyOp`: the cast resets the basis of the next wait (TIME-4).
        if (cast) sinceCastUnknown = 0;
        else if (this.unknownTravel > 0) sinceCastUnknown = 1;
      }
    } finally {
      this.inExit = false;
    }
    return { ms, unknown, waits, excess };
  }
}

/** The position the exit chain moves (it never changes the node). */
interface ExitCursor {
  loc: number;
  readonly tier: number;
}
