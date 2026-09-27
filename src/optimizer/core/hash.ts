/**
 * The arithmetic duplicate-detection hash (docs/research/optimizer-m7.md §7.2). ESLint's
 * `no-bitwise` covers the whole repository, so there is no Zobrist XOR: each feature of a state has
 * two constants from a fixed Lehmer generator, and a state's hash is two lane sums modulo primes.
 * Every value stays below 2^47, so all arithmetic is exact in doubles on every engine. A lane
 * match is always followed by an exact state comparison, so hash quality changes speed only.
 */

/** Lehmer (Park-Miller) generator: `x ← x × 48271 mod 2^31 − 1`. */
export const LEHMER_MULTIPLIER = 48271;
export const LEHMER_MODULUS = 2147483647;
/** The fixed seed (the plan's date): no clock, no randomness. */
export const HASH_SEED = 20260927;
/** Lane moduli, both prime. */
export const P1 = 2147483647;
export const P2 = 2147483629;
/** `xpInto` is folded modulo this prime before it multiplies its constant (the product stays below 2^47). */
export const XP_FOLD = 65521;

/** The next Lehmer output after `x`. */
export function lehmerNext(x: number): number {
  return (x * LEHMER_MULTIPLIER) % LEHMER_MODULUS;
}

/**
 * Two constants per feature: the k-th feature takes the generator's next two outputs, the first
 * modulo P1 and the second modulo P2.
 */
export function laneConstants(count: number): { readonly c1: Float64Array; readonly c2: Float64Array } {
  const c1 = new Float64Array(count);
  const c2 = new Float64Array(count);
  let x = HASH_SEED;
  for (let k = 0; k < count; k += 1) {
    x = lehmerNext(x);
    c1[k] = x % P1;
    x = lehmerNext(x);
    c2[k] = x % P2;
  }
  return { c1, c2 };
}

/** The feature slots of a search state (§7.2). */
export interface HashLayout {
  readonly units: number;
  readonly quests: number;
  readonly unitBase: number;
  /** Five slots per quest: untouched, in log, turned in, abandoned, dropped. */
  readonly questBase: number;
  /** Location + 1 (slot 0 is the unknown position). */
  readonly locBase: number;
  /** Visit key + 1 (slot 0 is none). */
  readonly visitBase: number;
  readonly tierBase: number;
  /** `unknownXpEvents`, capped at 15. */
  readonly unknownBase: number;
  readonly sinceCastBase: number;
  readonly levelBase: number;
  readonly levelSlots: number;
  readonly xpSlot: number;
  readonly c1: Float64Array;
  readonly c2: Float64Array;
}

export const QUEST_STATUSES = 5;
export const UNKNOWN_XP_CAP = 15;

export function hashLayout(counts: { readonly units: number; readonly quests: number; readonly locations: number; readonly visitKeys: number; readonly maxLevel: number }): HashLayout {
  const unitBase = 0;
  const questBase = unitBase + counts.units;
  const locBase = questBase + counts.quests * QUEST_STATUSES;
  const visitBase = locBase + counts.locations + 1;
  const tierBase = visitBase + counts.visitKeys + 1;
  const unknownBase = tierBase + 3;
  const sinceCastBase = unknownBase + UNKNOWN_XP_CAP + 1;
  const levelBase = sinceCastBase + 2;
  const levelSlots = counts.maxLevel + 2;
  const xpSlot = levelBase + levelSlots;
  const { c1, c2 } = laneConstants(xpSlot + 1);
  return { units: counts.units, quests: counts.quests, unitBase, questBase, locBase, visitBase, tierBase, unknownBase, sinceCastBase, levelBase, levelSlots, xpSlot, c1, c2 };
}

/** `(a + b) mod p` for lane values below p. */
export function addMod(a: number, b: number, p: number): number {
  const s = a + b;
  return s >= p ? s - p : s;
}

/** `(a − b) mod p` for lane values below p. */
export function subMod(a: number, b: number, p: number): number {
  const s = a - b;
  return s < 0 ? s + p : s;
}

/**
 * `x mod m` for integers `0 ≤ x < 2^47` and `1 ≤ m < 2^32`, by floor division (review PRF-04): the
 * operands exceed int32, so `%` on doubles is slow. The quotient is exact: its rounding error is
 * below 2^-37, and a quotient that is not an integer lies at least 1/m > 2^-32 from one.
 */
export function floorMod(x: number, m: number): number {
  return x - m * Math.floor(x / m);
}

/**
 * The scalar part of a state's lanes: location, visit key, riding tier, unknown-XP count, the
 * since-cast flag, level and the folded XP into the level.
 */
export function scalarLanes(
  layout: HashLayout,
  s: { readonly loc: number; readonly lastVisit: number; readonly tier: number; readonly unknownXp: number; readonly sinceCastUnknown: number; readonly level: number; readonly xpInto: number },
  out: { h1: number; h2: number },
): void {
  const { c1, c2 } = layout;
  const a = layout.locBase + s.loc + 1;
  const b = layout.visitBase + s.lastVisit + 1;
  const c = layout.tierBase + s.tier;
  const d = layout.unknownBase + Math.min(UNKNOWN_XP_CAP, s.unknownXp);
  const e = layout.sinceCastBase + s.sinceCastUnknown;
  const f = layout.levelBase + Math.min(layout.levelSlots - 1, Math.max(0, s.level));
  // Six constants below 2^31 sum below 2^34: exact, then one reduction.
  const s1 = (c1[a] ?? 0) + (c1[b] ?? 0) + (c1[c] ?? 0) + (c1[d] ?? 0) + (c1[e] ?? 0) + (c1[f] ?? 0);
  const s2 = (c2[a] ?? 0) + (c2[b] ?? 0) + (c2[c] ?? 0) + (c2[d] ?? 0) + (c2[e] ?? 0) + (c2[f] ?? 0);
  const fold = s.xpInto % XP_FOLD;
  out.h1 = addMod(floorMod(s1, P1), floorMod((c1[layout.xpSlot] ?? 0) * fold, P1), P1);
  out.h2 = addMod(floorMod(s2, P2), floorMod((c2[layout.xpSlot] ?? 0) * fold, P2), P2);
}

/** The table slot of a state's lanes: `(h1 × 32 + (h2 mod 32)) mod capacity` (exact below 2^53). */
export function tableSlot(h1: number, h2: number, capacity: number): number {
  return floorMod(h1 * 32 + floorMod(h2, 32), capacity);
}

/** The smallest power of two at least `n` (and at least 16). */
export function powerOfTwoAtLeast(n: number): number {
  let c = 16;
  while (c < n) c *= 2;
  return c;
}
