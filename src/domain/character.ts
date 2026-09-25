/**
 * Character identity tokens. Tokens are English client identifiers (UnitRace / UnitClass file
 * names). Forever adds two Skyborne races and new race/class pairs (docs/research/forever-game-rules.md §4).
 */
export type Faction = 'Alliance' | 'Horde';

export const RACE_TOKENS = [
  'Human',
  'Orc',
  'Dwarf',
  'NightElf',
  'Scourge',
  'Tauren',
  'Gnome',
  'Troll',
  'HighOrderSkyborne',
  'WindshaperSkyborne',
] as const;
export type RaceToken = (typeof RACE_TOKENS)[number];

export const CLASS_TOKENS = [
  'WARRIOR',
  'PALADIN',
  'HUNTER',
  'ROGUE',
  'PRIEST',
  'SHAMAN',
  'MAGE',
  'WARLOCK',
  'DRUID',
] as const;
export type ClassToken = (typeof CLASS_TOKENS)[number];

export type Sex = 'male' | 'female';
