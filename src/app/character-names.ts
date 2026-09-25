import type { ClassToken, RaceToken } from '../domain';

/** English display names of the character tokens (src/domain/character.ts). */
export const RACE_NAMES: Readonly<Record<RaceToken, string>> = {
  Human: 'Human',
  Orc: 'Orc',
  Dwarf: 'Dwarf',
  NightElf: 'Night Elf',
  Scourge: 'Undead',
  Tauren: 'Tauren',
  Gnome: 'Gnome',
  Troll: 'Troll',
  HighOrderSkyborne: 'High Order Skyborne',
  WindshaperSkyborne: 'Windshaper Skyborne',
};

export const CLASS_NAMES: Readonly<Record<ClassToken, string>> = {
  WARRIOR: 'Warrior',
  PALADIN: 'Paladin',
  HUNTER: 'Hunter',
  ROGUE: 'Rogue',
  PRIEST: 'Priest',
  SHAMAN: 'Shaman',
  MAGE: 'Mage',
  WARLOCK: 'Warlock',
  DRUID: 'Druid',
};

/** "Orc Warrior", "Night Elf Druid". */
export function characterName(character: { readonly race: RaceToken; readonly class: ClassToken }): string {
  return `${RACE_NAMES[character.race]} ${CLASS_NAMES[character.class]}`;
}
