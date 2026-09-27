import { describe, expect, it } from 'vitest';
import { addMod, floorMod, HASH_SEED, hashLayout, laneConstants, LEHMER_MODULUS, lehmerNext, P1, P2, powerOfTwoAtLeast, scalarLanes, subMod, tableSlot, XP_FOLD } from './hash';

/** The arithmetic hash (docs/research/optimizer-m7.md §7.2). */

describe('lane constants', () => {
  it('come from the fixed Lehmer generator, two outputs per feature', () => {
    const first = lehmerNext(HASH_SEED);
    const second = lehmerNext(first);
    const { c1, c2 } = laneConstants(3);
    expect(c1[0]).toBe(first % P1);
    expect(c2[0]).toBe(second % P2);
    expect(c1[1]).toBe(lehmerNext(second) % P1);
    // The generator's products stay exact in doubles.
    expect(LEHMER_MODULUS * 48271).toBeLessThan(2 ** 53);
  });

  it('are deterministic and within their moduli', () => {
    const a = laneConstants(1000);
    const b = laneConstants(1000);
    expect(Array.from(a.c1)).toEqual(Array.from(b.c1));
    for (let k = 0; k < 1000; k += 1) {
      expect(a.c1[k]).toBeGreaterThanOrEqual(0);
      expect(a.c1[k]).toBeLessThan(P1);
      expect(a.c2[k]).toBeLessThan(P2);
    }
    // The XP fold's product stays below 2^47.
    expect((P1 - 1) * (XP_FOLD - 1)).toBeLessThan(2 ** 47);
  });
});

describe('lanes', () => {
  const layout = hashLayout({ units: 5, quests: 2, locations: 4, visitKeys: 6, maxLevel: 60 });
  const base = { loc: 1, lastVisit: 2, tier: 0, unknownXp: 0, sinceCastUnknown: 0, level: 10, xpInto: 1234 };
  const lanes = (fields: Partial<typeof base>): readonly [number, number] => {
    const out = { h1: 0, h2: 0 };
    scalarLanes(layout, { ...base, ...fields }, out);
    return [out.h1, out.h2];
  };

  it('change with every key field', () => {
    const reference = lanes({});
    for (const change of [{ loc: -1 }, { lastVisit: -1 }, { tier: 1 }, { unknownXp: 3 }, { sinceCastUnknown: 1 }, { level: 11 }, { xpInto: 1235 }]) {
      expect(lanes(change)).not.toEqual(reference);
    }
    expect(lanes({})).toEqual(reference);
  });

  it('cap the unknown-XP count at 15', () => {
    expect(lanes({ unknownXp: 15 })).toEqual(lanes({ unknownXp: 40 }));
  });

  it('add and remove exactly modulo the primes', () => {
    expect(addMod(P1 - 1, 5, P1)).toBe(4);
    expect(subMod(3, 5, P1)).toBe(P1 - 2);
    expect(subMod(addMod(123, 456, P2), 456, P2)).toBe(123);
  });

  it('map to a slot inside the table', () => {
    const capacity = powerOfTwoAtLeast(1000);
    expect(capacity).toBe(1024);
    expect(tableSlot(P1 - 1, P2 - 1, capacity)).toBeLessThan(capacity);
    expect(tableSlot(0, 0, capacity)).toBe(0);
    expect(((P1 - 1) * 32 + 31) < 2 ** 53).toBe(true);
  });
});

describe('floorMod (review PRF-04)', () => {
  it('equals % on doubles for lane values up to 2^47, at the moduli the hash uses', () => {
    let x = HASH_SEED;
    const next = (): number => {
      x = lehmerNext(x);
      return x;
    };
    const moduli = [P1, P2, 32, 16, 1024, 2 ** 18, 2 ** 20];
    const values: number[] = [0, 1, 2 ** 47 - 1, 2 ** 34, (P1 - 1) * (XP_FOLD - 1)];
    // Random values below 2^47 (two 31-bit draws), and the neighbours of multiples of each modulus.
    for (let k = 0; k < 20_000; k += 1) values.push((next() % 65_536) * 2 ** 31 + next());
    for (const m of moduli) {
      for (let k = 1; k < 2000; k += 1) {
        const q = next() % Math.floor(2 ** 47 / m);
        for (const d of [-1, 0, 1]) if (q * m + d >= 0 && q * m + d < 2 ** 47) values.push(q * m + d);
      }
    }
    let checked = 0;
    for (const m of moduli) {
      for (const v of values) {
        if (floorMod(v, m) !== v % m) throw new Error(`floorMod(${String(v)}, ${String(m)}) = ${String(floorMod(v, m))}, expected ${String(v % m)}`);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100_000);
  });
});
