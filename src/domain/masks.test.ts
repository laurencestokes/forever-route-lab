import { describe, expect, it } from 'vitest';
import { CLASS_TOKENS, RACE_TOKENS, type RaceToken } from './character';
import {
  ALLIANCE_RACE_MASK,
  CLASS_IDS,
  HORDE_RACE_MASK,
  RACE_BITS,
  RACE_FACTION,
  classAllowed,
  hasRaceBit,
  raceAllowed,
} from './masks';

const ALLIANCE: readonly RaceToken[] = ['Human', 'Dwarf', 'NightElf', 'Gnome'];
const HORDE: readonly RaceToken[] = ['Orc', 'Scourge', 'Tauren', 'Troll'];

describe('race bits', () => {
  it('matches SIMULATION §7.3', () => {
    expect(RACE_BITS).toEqual({
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
    });
  });

  it('builds the faction masks from the classic races', () => {
    const sum = (races: readonly RaceToken[]): number => races.reduce((acc, r) => acc + 2 ** RACE_BITS[r], 0);
    expect(sum(ALLIANCE)).toBe(ALLIANCE_RACE_MASK);
    expect(sum(HORDE)).toBe(HORDE_RACE_MASK);
  });

  it('assigns every race a faction consistent with the masks', () => {
    for (const race of ALLIANCE) expect(RACE_FACTION[race]).toBe('Alliance');
    for (const race of HORDE) expect(RACE_FACTION[race]).toBe('Horde');
    expect(RACE_FACTION.HighOrderSkyborne).toBe('Alliance');
    expect(RACE_FACTION.WindshaperSkyborne).toBe('Horde');
  });
});

describe('hasRaceBit', () => {
  it('tests single bits, including bits 32 and 33', () => {
    expect(hasRaceBit(1, 0)).toBe(true);
    expect(hasRaceBit(1, 1)).toBe(false);
    expect(hasRaceBit(2 ** 32, 32)).toBe(true);
    expect(hasRaceBit(2 ** 32, 0)).toBe(false);
    expect(hasRaceBit(2 ** 33, 33)).toBe(true);
    expect(hasRaceBit(2 ** 33, 32)).toBe(false);
  });

  it('keeps bits that 32-bit bitwise operators would drop', () => {
    const mask = 4294967373; // 2^32 + 77
    // The truncation this module avoids: `mask & 2 ** 32` would be 0.
    expect(hasRaceBit(mask, 32)).toBe(true);
    expect(hasRaceBit(mask, 33)).toBe(false);
    expect(hasRaceBit(8589934770, 33)).toBe(true); // 2^33 + 178
    expect(hasRaceBit(8589934770, 32)).toBe(false);
  });

  it('does not treat exact 77 as having bit 32 (that rule belongs to raceAllowed)', () => {
    expect(hasRaceBit(77, 32)).toBe(false);
    expect(hasRaceBit(178, 33)).toBe(false);
  });

  it('gives false for a null mask', () => {
    expect(hasRaceBit(null, 0)).toBe(false);
    expect(hasRaceBit(null, 32)).toBe(false);
  });

  it('rejects invalid masks and bits', () => {
    expect(() => hasRaceBit(-1, 0)).toThrow(RangeError);
    expect(() => hasRaceBit(1.5, 0)).toThrow(RangeError);
    expect(() => hasRaceBit(2 ** 53, 0)).toThrow(RangeError);
    expect(() => hasRaceBit(1, -1)).toThrow(RangeError);
    expect(() => hasRaceBit(1, 53)).toThrow(RangeError);
    expect(() => hasRaceBit(1, 0.5)).toThrow(RangeError);
  });
});

describe('raceAllowed', () => {
  it('admits every race for null and 0', () => {
    for (const race of RACE_TOKENS) {
      expect(raceAllowed(null, race)).toBe(true);
      expect(raceAllowed(0, race)).toBe(true);
    }
  });

  it('exact 77 admits the Alliance races and High Order Skyborne only', () => {
    for (const race of ALLIANCE) expect(raceAllowed(77, race)).toBe(true);
    for (const race of HORDE) expect(raceAllowed(77, race)).toBe(false);
    expect(raceAllowed(77, 'HighOrderSkyborne')).toBe(true);
    expect(raceAllowed(77, 'WindshaperSkyborne')).toBe(false);
  });

  it('exact 178 admits the Horde races and Windshaper Skyborne only', () => {
    for (const race of HORDE) expect(raceAllowed(178, race)).toBe(true);
    for (const race of ALLIANCE) expect(raceAllowed(178, race)).toBe(false);
    expect(raceAllowed(178, 'WindshaperSkyborne')).toBe(true);
    expect(raceAllowed(178, 'HighOrderSkyborne')).toBe(false);
  });

  it('keeps race-specific masks closed to Skyborne', () => {
    expect(raceAllowed(1, 'Human')).toBe(true);
    expect(raceAllowed(1, 'HighOrderSkyborne')).toBe(false);
    expect(raceAllowed(2, 'WindshaperSkyborne')).toBe(false);
    // All eight classic races, but not an exact faction mask.
    expect(raceAllowed(255, 'HighOrderSkyborne')).toBe(false);
    expect(raceAllowed(255, 'WindshaperSkyborne')).toBe(false);
    // 77 plus one Horde race is no longer exact.
    expect(raceAllowed(77 + 2, 'HighOrderSkyborne')).toBe(false);
  });

  it('reads the Skyborne bits of large masks', () => {
    expect(raceAllowed(4294967373, 'HighOrderSkyborne')).toBe(true);
    expect(raceAllowed(4294967373, 'Human')).toBe(true);
    expect(raceAllowed(4294967373, 'WindshaperSkyborne')).toBe(false);
    expect(raceAllowed(4294967373, 'Orc')).toBe(false);
    expect(raceAllowed(8589934770, 'WindshaperSkyborne')).toBe(true);
    expect(raceAllowed(8589934770, 'Tauren')).toBe(true);
    expect(raceAllowed(8589934770, 'HighOrderSkyborne')).toBe(false);
    expect(raceAllowed(8589934770, 'Gnome')).toBe(false);
    expect(raceAllowed(2 ** 32, 'HighOrderSkyborne')).toBe(true);
    expect(raceAllowed(2 ** 33, 'WindshaperSkyborne')).toBe(true);
    expect(raceAllowed(2 ** 32 + 2 ** 33, 'Human')).toBe(false);
  });

  it('rejects an invalid mask', () => {
    expect(() => raceAllowed(-77, 'Human')).toThrow(RangeError);
    expect(() => raceAllowed(Number.NaN, 'Human')).toThrow(RangeError);
  });
});

describe('classAllowed', () => {
  it('uses bit classId - 1', () => {
    expect(CLASS_IDS).toEqual({
      WARRIOR: 1,
      PALADIN: 2,
      HUNTER: 3,
      ROGUE: 4,
      PRIEST: 5,
      SHAMAN: 7,
      MAGE: 8,
      WARLOCK: 9,
      DRUID: 11,
    });
    for (const cls of CLASS_TOKENS) {
      const mask = 2 ** (CLASS_IDS[cls] - 1);
      for (const other of CLASS_TOKENS) expect(classAllowed(mask, other)).toBe(other === cls);
    }
  });

  it('admits every class for null and 0', () => {
    for (const cls of CLASS_TOKENS) {
      expect(classAllowed(null, cls)).toBe(true);
      expect(classAllowed(0, cls)).toBe(true);
    }
  });

  it('reads combined masks', () => {
    const mageWarlock = 128 + 256;
    expect(classAllowed(mageWarlock, 'MAGE')).toBe(true);
    expect(classAllowed(mageWarlock, 'WARLOCK')).toBe(true);
    expect(classAllowed(mageWarlock, 'PRIEST')).toBe(false);
    expect(classAllowed(1024, 'DRUID')).toBe(true);
    expect(classAllowed(64, 'SHAMAN')).toBe(true);
    // Bit 5 (class id 6) is unused by these classes.
    expect(CLASS_TOKENS.some((cls) => classAllowed(32, cls))).toBe(false);
  });

  it('rejects an invalid mask', () => {
    expect(() => classAllowed(-1, 'WARRIOR')).toThrow(RangeError);
  });
});
