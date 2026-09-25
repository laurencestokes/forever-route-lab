import type { ClassToken, Faction, RaceToken } from './character';

/**
 * Race and class bitmask tests (SIMULATION.md §7.3, D-012). Skyborne races use bits 32 and 33,
 * beyond the 32 bits JavaScript bitwise operators keep, so every test here is arithmetic:
 * `Math.floor(mask / 2 ** bit) % 2 === 1`. Masks are exact up to 2^53.
 */

/** Race token to its bit in `requiredRaces` (race id - 1 for the eight classic races). */
export const RACE_BITS: Readonly<Record<RaceToken, number>> = {
  Human: 0,
  Orc: 1,
  Dwarf: 2,
  NightElf: 3,
  Scourge: 4,
  Tauren: 5,
  Gnome: 6,
  Troll: 7,
  HighOrderSkyborne: 32,
  WindshaperSkyborne: 33,
};

/** Class token to its client class id; the mask bit is `classId - 1`. */
export const CLASS_IDS: Readonly<Record<ClassToken, number>> = {
  WARRIOR: 1,
  PALADIN: 2,
  HUNTER: 3,
  ROGUE: 4,
  PRIEST: 5,
  SHAMAN: 7,
  MAGE: 8,
  WARLOCK: 9,
  DRUID: 11,
};

export const RACE_FACTION: Readonly<Record<RaceToken, Faction>> = {
  Human: 'Alliance',
  Orc: 'Horde',
  Dwarf: 'Alliance',
  NightElf: 'Alliance',
  Scourge: 'Horde',
  Tauren: 'Horde',
  Gnome: 'Alliance',
  Troll: 'Horde',
  HighOrderSkyborne: 'Alliance',
  WindshaperSkyborne: 'Horde',
};

/** Every classic Alliance race. As an exact mask it also admits High Order Skyborne (D-012). */
export const ALLIANCE_RACE_MASK = 77;
/** Every classic Horde race. As an exact mask it also admits Windshaper Skyborne (D-012). */
export const HORDE_RACE_MASK = 178;

const MAX_BIT = 52;

function assertMask(mask: number): void {
  if (!Number.isSafeInteger(mask) || mask < 0) {
    throw new RangeError(`Invalid bitmask ${String(mask)}: expected a non-negative safe integer`);
  }
}

function assertBit(bit: number): void {
  if (!Number.isInteger(bit) || bit < 0 || bit > MAX_BIT) {
    throw new RangeError(`Invalid bit ${String(bit)}: expected an integer from 0 to ${String(MAX_BIT)}`);
  }
}

function bitSet(mask: number, bit: number): boolean {
  return Math.floor(mask / 2 ** bit) % 2 === 1;
}

/**
 * Raw bit test. A null mask has no bits, like 0; use {@link raceAllowed} for eligibility, where
 * null and 0 both mean "any race".
 */
export function hasRaceBit(mask: number | null, raceBit: number): boolean {
  assertBit(raceBit);
  if (mask === null) return false;
  assertMask(mask);
  return bitSet(mask, raceBit);
}

/**
 * Whether a quest with race mask `mask` admits `race`. Null and 0 admit every race. The exact
 * faction masks 77 and 178 also admit that faction's Skyborne race (Questie's Forever rule); any
 * other mask needs the race's own bit, so a Human-only quest stays closed to Skyborne.
 */
export function raceAllowed(mask: number | null, race: RaceToken): boolean {
  if (mask === null || mask === 0) return true;
  assertMask(mask);
  if (mask === ALLIANCE_RACE_MASK && race === 'HighOrderSkyborne') return true;
  if (mask === HORDE_RACE_MASK && race === 'WindshaperSkyborne') return true;
  return bitSet(mask, RACE_BITS[race]);
}

/** Whether a quest with class mask `mask` admits `cls`. Null and 0 admit every class. */
export function classAllowed(mask: number | null, cls: ClassToken): boolean {
  if (mask === null || mask === 0) return true;
  assertMask(mask);
  return bitSet(mask, CLASS_IDS[cls] - 1);
}
