/**
 * Interoperability vocabulary (D-019): filter words and tag names, listed in our own words and
 * order from docs/RXP.md §6.3, §7 and §8.1. The parser only uses these lists to report
 * diagnostics (`RXP012`, `RXP016`); filters are evaluated later by `domain/conditions` (§6.5).
 */

export type FilterWordKind =
  | 'class'
  | 'race'
  | 'faction'
  | 'game'
  | 'sex'
  | 'season'
  | 'locale'
  | 'level'
  | 'skip'
  | 'unknown';

/** Case-insensitive words: compared after upper-casing (docs/RXP.md §6.3). */
const CLASS_WORDS: readonly string[] = [
  'WARRIOR', 'PALADIN', 'HUNTER', 'ROGUE', 'PRIEST', 'SHAMAN', 'MAGE', 'WARLOCK', 'DRUID',
  // Other games' classes: valid words, always false on Forever.
  'DEATHKNIGHT', 'DK', 'MONK', 'DEMONHUNTER', 'EVOKER',
];
const GAME_WORDS: readonly string[] = ['FOREVER', 'CLASSIC', 'TBC', 'WOTLK', 'CATA', 'MOP', 'RETAIL', 'DF'];
const SEX_WORDS: readonly string[] = ['MALE', 'FEMALE'];
const SEASON_WORDS: readonly string[] = ['SOD'];

/**
 * Case-sensitive words. `Undead` is RXP's alias for `Scourge`; `Skyborne` appears in Forever guides
 * (its client token is UNVERIFIED, §6.3). The project's own race keys for the two Skyborne halves
 * are not RXP filter words and are not listed: until Q1 is answered they are unknown words (§6.3).
 */
const RACE_WORDS: readonly string[] = ['Human', 'Orc', 'Dwarf', 'NightElf', 'Scourge', 'Undead', 'Tauren', 'Gnome', 'Troll', 'Skyborne', 'Haranir'];
const FACTION_WORDS: readonly string[] = ['Alliance', 'Horde'];
const LOCALE_WORDS: readonly string[] = ['enUS', 'deDE', 'frFR', 'esES', 'esMX', 'ruRU', 'koKR', 'zhCN', 'zhTW', 'ptBR', 'itIT'];

export interface FilterWordInfo {
  readonly kind: FilterWordKind;
  /** For a case-sensitive word written in another case: the spelling RXP would match. */
  readonly caseHint: string | null;
}

/** Plain decimal level word (`10`); the odd number forms are handled by the filter parser. */
const LEVEL_WORD = /^\d+$/;

export function classifyFilterWord(word: string): FilterWordInfo {
  if (LEVEL_WORD.test(word)) return { kind: 'level', caseHint: null };
  const upper = word.toUpperCase();
  if (CLASS_WORDS.includes(upper)) return { kind: 'class', caseHint: null };
  if (GAME_WORDS.includes(upper)) return { kind: 'game', caseHint: null };
  if (SEX_WORDS.includes(upper)) return { kind: 'sex', caseHint: null };
  if (SEASON_WORDS.includes(upper)) return { kind: 'season', caseHint: null };
  if (RACE_WORDS.includes(word)) return { kind: 'race', caseHint: null };
  if (FACTION_WORDS.includes(word)) return { kind: 'faction', caseHint: null };
  if (LOCALE_WORDS.includes(word)) return { kind: 'locale', caseHint: null };
  if (word === 'skip') return { kind: 'skip', caseHint: null };
  const hint = [...RACE_WORDS, ...FACTION_WORDS, ...LOCALE_WORDS].find((candidate) => candidate.toUpperCase() === upper) ?? null;
  return { kind: 'unknown', caseHint: hint };
}

/** Game tags of a guide header (§7). */
export const GAME_TAGS: readonly string[] = ['forever', 'classic', 'era', 'som', 'tbc', 'wotlk', 'cata', 'mop', 'retail', 'df'];

/** Header game tags that make RXP skip the guide on Forever unless `#forever` or `#classic` is present (§4 P6). */
export const OTHER_GAME_GATE_TAGS: readonly string[] = ['tbc', 'wotlk', 'df', 'retail', 'cata'];

/** Header keys RXP reads (§7). */
export const HEADER_TAGS: readonly string[] = [
  ...GAME_TAGS,
  'name', 'group', 'subgroup', 'version', 'displayname', 'defaultfor', 'next',
  'groupid', 'groupweight', 'subweight', 'groupdisplayname', 'internal', 'disabled',
  'hardcore', 'softcore', 'title', 'chapter', 'chapters', 'minLevel', 'maxLevel', 'theme', 'loop',
  'xprate', 'season', 'era/som',
];

/**
 * Load-time step tags (§8.1, §8.2): lowered to `VariantTag` entries of the group condition
 * (§12.5) instead of `RxpTag`s.
 */
export const LOAD_TIME_TAGS: readonly string[] = [
  'xprate', 'season', 'era', 'som', 'era/som', 'phase', 'hardcore', 'softcore', 'hardcoreserver', 'softcoreserver',
  'ah', 'ssf', 'maxlevel', 'fresh', 'veteran', 'questguide', 'speedrunguide', 'daily', 'aldor', 'scryer',
];

/** Step tags RXP reads (§8.1). */
export const STEP_TAGS: readonly string[] = [
  'completewith', 'sticky', 'label', 'requires', 'optional', 'hidewindow', 'loop', 'level',
  ...LOAD_TIME_TAGS,
  'include', 'map', 'arrowtext', 'title', 'tip', 'track', 'ignorecorpse', 'timer',
];
