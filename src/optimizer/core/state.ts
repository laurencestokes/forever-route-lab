import { loadScalars, type NodeState, SCALAR_COUNT, saveScalars } from './transitions';

/**
 * Node layout (docs/research/optimizer-m7.md §7.1): the beam's nodes as fixed-size records in
 * parallel typed arrays, two layers alive (current and next), and the candidate records a layer's
 * generation fills before any child state is built (§7.3). One byte per unit and per quest (no bit
 * packing without bitwise operators).
 */

/** A row length padded to a multiple of 4 bytes, so rows compare as 32-bit words. */
export const paddedStride = (n: number): number => 4 * Math.ceil(n / 4);

export class Layer {
  size = 0;
  /** Row strides: `units` and `quests` padded to a multiple of 4 (the padding stays 0). */
  readonly unitStride: number;
  readonly questStride: number;
  readonly scheduled: Uint8Array;
  readonly status: Uint8Array;
  /** The same rows as 32-bit words (review PRF-05): `unitStride / 4` and `questStride / 4` per node. */
  readonly scheduledWords: Int32Array;
  readonly statusWords: Int32Array;
  readonly scalars: Float64Array;
  /** Index into the ancestry trail (−1 for the root). */
  readonly trail: Int32Array;
  /** 0 for a node that closes with nothing left worth scheduling (§7.5). */
  readonly expandable: Uint8Array;

  constructor(
    readonly capacity: number,
    readonly units: number,
    readonly quests: number,
  ) {
    this.unitStride = paddedStride(units);
    this.questStride = paddedStride(quests);
    this.scheduled = new Uint8Array(capacity * this.unitStride);
    this.status = new Uint8Array(capacity * this.questStride);
    this.scheduledWords = new Int32Array(this.scheduled.buffer, 0, this.scheduled.length / 4);
    this.statusWords = new Int32Array(this.status.buffer, 0, this.status.length / 4);
    this.scalars = new Float64Array(capacity * SCALAR_COUNT);
    this.trail = new Int32Array(capacity);
    this.expandable = new Uint8Array(capacity);
  }

  get bytes(): number {
    return this.scheduled.byteLength + this.status.byteLength + this.scalars.byteLength + this.trail.byteLength + this.expandable.byteLength;
  }

  /** Copies node `r` into a working state. */
  load(r: number, s: NodeState): void {
    s.scheduled.set(this.scheduled.subarray(r * this.unitStride, r * this.unitStride + this.units));
    s.status.set(this.status.subarray(r * this.questStride, r * this.questStride + this.quests));
    loadScalars(this.scalars, s, r * SCALAR_COUNT);
  }

  /** Stores a working state as node `r`. */
  store(r: number, s: NodeState, trail: number): void {
    this.scheduled.set(s.scheduled, r * this.unitStride);
    this.status.set(s.status, r * this.questStride);
    saveScalars(s, this.scalars, r * SCALAR_COUNT);
    this.trail[r] = trail;
    this.expandable[r] = 1;
  }

  /** Copies node `p` of `from` into node `r` of this layer (rows and scalars; not the trail). */
  copyRows(r: number, from: Layer, p: number): void {
    this.scheduled.set(from.scheduled.subarray(p * this.unitStride, (p + 1) * this.unitStride), r * this.unitStride);
    this.status.set(from.status.subarray(p * this.questStride, (p + 1) * this.questStride), r * this.questStride);
  }
}

/**
 * A layer's candidate records (§7.3): the parent rank, the unit, the score and the child's scalars,
 * and the child's quest-status changes in a shared pool, so a child is materialised only when kept.
 */
export class Candidates {
  count = 0;
  parent: Int32Array;
  unit: Int32Array;
  score: Float64Array;
  h1: Float64Array;
  h2: Float64Array;
  scalars: Float64Array;
  changeStart: Int32Array;
  changeCount: Int32Array;
  alive: Uint8Array;
  /** Pairs (quest, new status). */
  changes: Int32Array;
  changeSize = 0;

  constructor(private capacity: number) {
    this.parent = new Int32Array(capacity);
    this.unit = new Int32Array(capacity);
    this.score = new Float64Array(capacity);
    this.h1 = new Float64Array(capacity);
    this.h2 = new Float64Array(capacity);
    this.scalars = new Float64Array(capacity * SCALAR_COUNT);
    this.changeStart = new Int32Array(capacity);
    this.changeCount = new Int32Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.changes = new Int32Array(Math.max(64, capacity * 4));
  }

  get bytes(): number {
    return (
      this.parent.byteLength +
      this.unit.byteLength +
      this.score.byteLength +
      this.h1.byteLength +
      this.h2.byteLength +
      this.scalars.byteLength +
      this.changeStart.byteLength +
      this.changeCount.byteLength +
      this.alive.byteLength +
      this.changes.byteLength
    );
  }

  reset(): void {
    this.count = 0;
    this.changeSize = 0;
  }

  private grow(): void {
    const capacity = this.capacity * 2;
    const grow64 = (a: Float64Array, size: number): Float64Array => {
      const b = new Float64Array(size);
      b.set(a);
      return b;
    };
    const grow32 = (a: Int32Array, size: number): Int32Array => {
      const b = new Int32Array(size);
      b.set(a);
      return b;
    };
    const grow8 = (a: Uint8Array, size: number): Uint8Array => {
      const b = new Uint8Array(size);
      b.set(a);
      return b;
    };
    this.parent = grow32(this.parent, capacity);
    this.unit = grow32(this.unit, capacity);
    this.score = grow64(this.score, capacity);
    this.h1 = grow64(this.h1, capacity);
    this.h2 = grow64(this.h2, capacity);
    this.scalars = grow64(this.scalars, capacity * SCALAR_COUNT);
    this.changeStart = grow32(this.changeStart, capacity);
    this.changeCount = grow32(this.changeCount, capacity);
    this.alive = grow8(this.alive, capacity);
    this.capacity = capacity;
  }

  /** Records a child; `log` holds (quest, old, new) triples from `from`. Returns its index. */
  add(parent: number, unit: number, score: number, h1: number, h2: number, s: NodeState, log: Int32Array, logSize: number, from: number): number {
    if (this.count >= this.capacity) this.grow();
    const c = this.count;
    this.count += 1;
    this.parent[c] = parent;
    this.unit[c] = unit;
    this.score[c] = score;
    this.h1[c] = h1;
    this.h2[c] = h2;
    saveScalars(s, this.scalars, c * SCALAR_COUNT);
    const pairs = (logSize - from) / 3;
    if (this.changeSize + pairs * 2 > this.changes.length) {
      const next = new Int32Array(Math.max(this.changes.length * 2, this.changeSize + pairs * 2));
      next.set(this.changes);
      this.changes = next;
    }
    this.changeStart[c] = this.changeSize;
    this.changeCount[c] = pairs;
    for (let k = from; k < logSize; k += 3) {
      this.changes[this.changeSize] = log[k] ?? 0;
      this.changes[this.changeSize + 1] = log[k + 2] ?? 0;
      this.changeSize += 2;
    }
    this.alive[c] = 1;
    return c;
  }

  /** A scalar of candidate `c` (see `saveScalars` for the order). */
  scalar(c: number, k: number): number {
    return this.scalars[c * SCALAR_COUNT + k] ?? 0;
  }

  /** Applies candidate `c`'s status changes to a status row starting at `offset`. */
  applyChanges(c: number, status: Uint8Array, offset = 0): void {
    const start = this.changeStart[c] ?? 0;
    const count = this.changeCount[c] ?? 0;
    for (let k = 0; k < count; k += 1) status[offset + (this.changes[start + 2 * k] ?? 0)] = this.changes[start + 2 * k + 1] ?? 0;
  }
}

/** Scalar positions in the saved records (`saveScalars`). */
export const S_LOC = 0;
export const S_TIER = 1;
export const S_UNKNOWN_XP = 2;
export const S_SINCE_CAST = 3;
export const S_LEVEL = 4;
export const S_XP_INTO = 5;
export const S_KNOWN_TOTAL = 6;
export const S_ELAPSED = 7;
export const S_READY_AT = 8;
export const S_LAST_VISIT = 9;
export const S_UNKNOWN_PARTS = 11;
export const S_DIVERGENCE = 12;
export const S_WAIT_EXCESS = 19;

/** The ancestry trail (§7.3): `(parentTrail, unit)` pairs; a node's schedule is read back from it. */
export class Trail {
  size = 0;
  private parents: Int32Array;
  private units: Int32Array;

  constructor(capacity: number) {
    this.parents = new Int32Array(Math.max(16, capacity));
    this.units = new Int32Array(Math.max(16, capacity));
  }

  get bytes(): number {
    return this.parents.byteLength + this.units.byteLength;
  }

  add(parent: number, unit: number): number {
    if (this.size >= this.parents.length) {
      const parents = new Int32Array(this.parents.length * 2);
      parents.set(this.parents);
      const units = new Int32Array(this.units.length * 2);
      units.set(this.units);
      this.parents = parents;
      this.units = units;
    }
    this.parents[this.size] = parent;
    this.units[this.size] = unit;
    this.size += 1;
    return this.size - 1;
  }

  /** The units from the root to trail entry `index`, in schedule order. */
  sequence(index: number): number[] {
    const out: number[] = [];
    for (let k = index; k >= 0; k = this.parents[k] ?? -1) out.push(this.units[k] ?? 0);
    return out.reverse();
  }
}
