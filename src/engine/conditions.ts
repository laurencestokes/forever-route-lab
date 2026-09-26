import type { FilterAst, StatePredicate, StepCondition, Truth, VariantTag } from '../domain/conditions';
import type { QuestId } from '../domain/ids';
import type { CharacterProfile, RouteProfile } from '../domain/project';
import type { AcceptPolicy, ReadonlyCharacterState } from './types';

/**
 * Condition evaluation (docs/ARCHITECTURE.md §9.2; docs/RXP.md §6.3-§6.5, §8.2, §14 rows 5-6).
 * Three-valued: a word or tag whose truth depends on a value the project does not know is
 * `unknown`, and a step whose condition is `unknown` stays active with a warning; it is never
 * silently hidden.
 *
 * - Filters (`<<`) and variant tags depend only on the character and route profile, so they are
 *   evaluated once per walk. Level words use `character.startLevel`, as RXP does at guide load.
 * - Skip predicates (`skipIf`) read the walker state when the step (or its group's first step) is
 *   reached.
 */

export const TRUE: Truth = 'true';
export const FALSE: Truth = 'false';
export const UNKNOWN_TRUTH: Truth = 'unknown';

export const truthOf = (value: boolean): Truth => (value ? 'true' : 'false');

/** Three-valued AND: false if any is false, else unknown if any is unknown, else true. */
export function and3(values: Iterable<Truth>): Truth {
  let result: Truth = 'true';
  for (const value of values) {
    if (value === 'false') return 'false';
    if (value === 'unknown') result = 'unknown';
  }
  return result;
}

/** Three-valued OR: true if any is true, else unknown if any is unknown, else false. */
export function or3(values: Iterable<Truth>): Truth {
  let result: Truth = 'false';
  for (const value of values) {
    if (value === 'true') return 'true';
    if (value === 'unknown') result = 'unknown';
  }
  return result;
}

/** Three-valued NOT: unknown stays unknown. */
export function not3(value: Truth): Truth {
  return value === 'unknown' ? 'unknown' : value === 'true' ? 'false' : 'true';
}

/** What filters and variant tags read. */
export interface ConditionSubject {
  readonly character: Pick<CharacterProfile, 'faction' | 'race' | 'class' | 'sex' | 'startLevel'>;
  readonly routeProfile: RouteProfile;
}

// =============================================================================================
// Filter words (RXP.md §6.3), in our own words and order

/** Class words, compared upper-cased with the class token; other games' classes never match. */
const CLASS_ALIASES: Readonly<Record<string, string>> = { DK: 'DEATHKNIGHT' };
const CLASS_WORDS: ReadonlySet<string> = new Set([
  'WARRIOR', 'PALADIN', 'HUNTER', 'ROGUE', 'PRIEST', 'SHAMAN', 'MAGE', 'WARLOCK', 'DRUID',
  'DEATHKNIGHT', 'DK', 'MONK', 'DEMONHUNTER', 'EVOKER',
]);
/** Case-sensitive race words; `Undead` is RXP's spelling of `Scourge`. */
const RACE_WORDS: ReadonlySet<string> = new Set(['Human', 'Orc', 'Dwarf', 'NightElf', 'Scourge', 'Undead', 'Tauren', 'Gnome', 'Troll', 'Skyborne', 'Haranir']);
const RACE_ALIASES: Readonly<Record<string, string>> = { Undead: 'Scourge' };
/** The project's Skyborne race keys: their client race token is unverified (RXP.md §6.3, Q1). */
const SKYBORNE_RACES: ReadonlySet<string> = new Set(['HighOrderSkyborne', 'WindshaperSkyborne']);
const GAME_WORDS: ReadonlySet<string> = new Set(['FOREVER', 'CLASSIC', 'TBC', 'WOTLK', 'CATA', 'MOP', 'RETAIL', 'DF']);
const LOCALE_WORDS: ReadonlySet<string> = new Set(['enUS', 'deDE', 'frFR', 'esES', 'esMX', 'ruRU', 'koKR', 'zhCN', 'zhTW', 'ptBR', 'itIT']);

/**
 * One filter word (RXP.md §6.3, §6.5). Unknown when it depends on an unknown profile value: any
 * race word for a Skyborne character, `Male`/`Female` without a sex, `SoD` without a season.
 * Words outside the vocabulary (`skip`, typos, other games' words) are false.
 */
export function evaluateFilterWord(word: string, subject: ConditionSubject): Truth {
  const { character, routeProfile } = subject;
  const upper = word.toUpperCase();
  if (CLASS_WORDS.has(upper)) return truthOf((CLASS_ALIASES[upper] ?? upper) === character.class);
  if (RACE_WORDS.has(word)) {
    if (SKYBORNE_RACES.has(character.race)) return 'unknown';
    return truthOf((RACE_ALIASES[word] ?? word) === character.race);
  }
  if (word === 'Alliance' || word === 'Horde') return truthOf(word === character.faction);
  if (GAME_WORDS.has(upper)) return truthOf(upper === 'FOREVER');
  if (upper === 'MALE' || upper === 'FEMALE') {
    if (character.sex === null) return 'unknown';
    return truthOf(upper === character.sex.toUpperCase());
  }
  if (upper === 'SOD') {
    if (routeProfile.season === null) return 'unknown';
    return truthOf(routeProfile.season === 2);
  }
  if (LOCALE_WORDS.has(word)) return truthOf(word === routeProfile.locale);
  return 'false';
}

/** A filter AST (RXP.md §6.5): `and []` is true, `or []` is false, level words use the start level. */
export function evaluateFilter(ast: FilterAst, subject: ConditionSubject): Truth {
  switch (ast.kind) {
    case 'word':
      return evaluateFilterWord(ast.word, subject);
    case 'minLevel':
      return truthOf(subject.character.startLevel >= ast.level);
    case 'not':
      return not3(evaluateFilter(ast.expr, subject));
    case 'and':
      return and3(ast.exprs.map((expr) => evaluateFilter(expr, subject)));
    case 'or':
      return or3(ast.exprs.map((expr) => evaluateFilter(expr, subject)));
  }
}

// =============================================================================================
// Variant tags (RXP.md §8.1, §8.2, §12.2)

const NUMBER = /^\d+(?:\.\d+)?$|^\.\d+$/;
const INTEGER = /^\d+$/;

function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  return NUMBER.test(trimmed) ? Number(trimmed) : null;
}

function parseInteger(text: string): number | null {
  const trimmed = text.trim();
  return INTEGER.test(trimmed) ? Number(trimmed) : null;
}

/**
 * `#xprate <R`, `>R` or `R1-R2` against `routeProfile.xpRate`. The comparisons are read as strict
 * for `<`/`>` and inclusive for a range (the boundary behaviour is not documented; RXP.md §8.1).
 */
function xpRateTruth(value: string | null, xpRate: number): Truth {
  if (value === null) return 'unknown';
  const text = value.replace(/\s+/g, '');
  if (text.startsWith('<')) {
    const bound = parseNumber(text.slice(1));
    return bound === null ? 'unknown' : truthOf(xpRate < bound);
  }
  if (text.startsWith('>')) {
    const bound = parseNumber(text.slice(1));
    return bound === null ? 'unknown' : truthOf(xpRate > bound);
  }
  const dash = text.indexOf('-');
  if (dash > 0) {
    const low = parseNumber(text.slice(0, dash));
    const high = parseNumber(text.slice(dash + 1));
    return low === null || high === null ? 'unknown' : truthOf(xpRate >= low && xpRate <= high);
  }
  return 'unknown';
}

/** `#season` list (separated by `,`, `;` or spaces) against `routeProfile.season` (null is unknown). */
function seasonTruth(value: string | null, season: number | null): Truth {
  if (value === null) return 'unknown';
  const parts = value.split(/[\s,;]+/).filter((part) => part !== '');
  const seasons = parts.map(parseInteger);
  if (seasons.length === 0 || seasons.some((s) => s === null)) return 'unknown';
  if (season === null) return 'unknown';
  return truthOf(seasons.includes(season));
}

/** `#phase N` or `N-M` against `routeProfile.phase` (null is unknown). */
function phaseTruth(value: string | null, phase: number | null): Truth {
  if (value === null || phase === null) return 'unknown';
  const text = value.replace(/\s+/g, '');
  const dash = text.indexOf('-');
  const low = parseInteger(dash > 0 ? text.slice(0, dash) : text);
  const high = dash > 0 ? parseInteger(text.slice(dash + 1)) : low;
  if (low === null || high === null) return 'unknown';
  return truthOf(phase >= low && phase <= high);
}

/**
 * One load-time variant entry against the route profile (RXP.md §8.2, §14 row 6), without its own
 * line filter. Entries the profile cannot decide (the realm-rule tags, `.profession` by name, an
 * unreadable value, an unrecognised name) are unknown.
 */
export function evaluateVariantValue(tag: Pick<VariantTag, 'name' | 'value'>, subject: ConditionSubject): Truth {
  const profile = subject.routeProfile;
  switch (tag.name) {
    case 'xprate':
      return xpRateTruth(tag.value, profile.xpRate);
    case 'season':
      return seasonTruth(tag.value, profile.season);
    case 'era':
      return profile.season === null ? 'unknown' : truthOf(profile.season === 0);
    case 'som':
      return profile.season === null ? 'unknown' : truthOf(profile.season === 1);
    case 'era/som':
      return profile.season === null ? 'unknown' : truthOf(profile.season === 0 || profile.season === 1);
    case 'phase':
      return phaseTruth(tag.value, profile.phase);
    case 'hardcore':
      return truthOf(profile.hardcore);
    case 'softcore':
      return truthOf(!profile.hardcore);
    case 'hardcoreserver':
    case 'softcoreserver':
      // Realm rules: whether Forever has hardcore realms is unknown (RXP.md §15.5).
      return 'unknown';
    case 'ah':
      return truthOf(!profile.ssf);
    case 'ssf':
      return truthOf(profile.ssf);
    case 'maxlevel': {
      // Dropped when the level at load is above N, only while XP step skipping is on (§8.1).
      const level = tag.value === null ? null : parseInteger(tag.value);
      if (level === null) return 'unknown';
      return truthOf(!profile.xpStepSkipping || subject.character.startLevel <= level);
    }
    case 'fresh':
    case 'veteran':
    case 'questguide':
    case 'speedrunguide':
    case 'daily':
    case 'aldor':
    case 'scryer':
      // Inert on Forever: these checks pass (§8.2).
      return 'true';
    case '.dungeon': {
      if (tag.value === null) return 'unknown';
      const text = tag.value.trim();
      const negated = text.startsWith('!');
      const token = (negated ? text.slice(1) : text).trim().toUpperCase();
      if (token === '') return 'unknown';
      const enabled = profile.dungeons.some((dungeon) => dungeon.toUpperCase() === token);
      return truthOf(negated ? !enabled : enabled);
    }
    case '.group':
      return truthOf(profile.groupQuests);
    case '.solo':
      // Read as the solo counterpart of `.group` (RXP.md §8.2 GroupCheck).
      return truthOf(!profile.groupQuests);
    case '.profession':
      // Named professions are not mapped to skill lines here, so the check cannot be made.
      return 'unknown';
    default:
      return 'unknown';
  }
}

/** A variant entry with its line filter: it applies only to characters the filter admits (RXP.md §12.5). */
export function evaluateVariantTag(tag: VariantTag, subject: ConditionSubject): Truth {
  const applies = tag.filter === null ? 'true' : evaluateFilter(tag.filter, subject);
  if (applies === 'false') return 'true';
  return or3([not3(applies), evaluateVariantValue(tag, subject)]);
}

/** A condition's filter and variant entries: the part that does not depend on the walk. */
export function evaluateStaticCondition(condition: StepCondition | null, subject: ConditionSubject): Truth {
  if (condition === null) return 'true';
  const filter = condition.filter === null ? 'true' : evaluateFilter(condition.filter, subject);
  if (filter === 'false' || condition.variant === null || condition.variant.length === 0) return filter;
  return and3([filter, and3(condition.variant.map((tag) => evaluateVariantTag(tag, subject)))]);
}

// =============================================================================================
// Skip predicates (RXP.md §9.2, §12.2, §14 row 5)

export interface PredicateContext {
  readonly priorHistory: CharacterProfile['priorHistory'];
  readonly xpStepSkipping: boolean;
  readonly acceptPolicy: AcceptPolicy;
}

/** Whether the route state can say anything about a quest the route never touched. */
function untouched(questId: QuestId, state: ReadonlyCharacterState): boolean {
  return !state.questLog.has(questId) && !state.completed.has(questId) && !state.abandoned.has(questId) && !state.acceptedInRoute.has(questId);
}

function questStateTruth(
  state: ReadonlyCharacterState,
  questId: QuestId,
  kind: 'onQuest' | 'complete' | 'turnedIn' | 'available',
  context: PredicateContext,
): Truth {
  if (kind === 'available') return context.acceptPolicy.acceptable(questId, state);
  // With an unknown pre-route history, a quest the route never touched may have been in the log or
  // turned in before the route: the state cannot decide.
  if (context.priorHistory === 'unknown' && untouched(questId, state)) return 'unknown';
  switch (kind) {
    case 'onQuest':
      return truthOf(state.questLog.has(questId));
    case 'complete': {
      const entry = state.questLog.get(questId);
      return truthOf(entry !== undefined && !entry.failed && entry.objectives.every((objective) => objective === 'done'));
    }
    case 'turnedIn':
      return truthOf(state.completed.has(questId));
  }
}

/**
 * One skip predicate against the walker state. `levelAtLeast` without `negate` applies only while
 * `routeProfile.xpStepSkipping` is on; with `negate` (the `<` form) always. A lower-bound level
 * that does not reach the target is unknown while XP is uncertain. `opaque` is always unknown.
 */
export function evaluatePredicate(predicate: StatePredicate, state: ReadonlyCharacterState, context: PredicateContext): Truth {
  switch (predicate.kind) {
    case 'questState': {
      const values = predicate.questIds.map((questId) => questStateTruth(state, questId, predicate.state, context));
      const truth = predicate.match === 'any' ? or3(values) : and3(values);
      return predicate.negate ? not3(truth) : truth;
    }
    case 'levelAtLeast': {
      if (!predicate.negate && !context.xpStepSkipping) return 'false';
      const reached = state.level > predicate.level || (state.level === predicate.level && state.xp >= (predicate.xp ?? 0));
      const truth: Truth = reached ? 'true' : state.unknownXpEvents > 0 ? 'unknown' : 'false';
      return predicate.negate ? not3(truth) : truth;
    }
    case 'opaque':
      return 'unknown';
  }
}

/** A `skipIf` list: the step is skipped when any predicate holds. */
export function evaluateSkipIf(predicates: readonly StatePredicate[], state: ReadonlyCharacterState, context: PredicateContext): Truth {
  if (predicates.length === 0) return 'false';
  return or3(predicates.map((predicate) => evaluatePredicate(predicate, state, context)));
}
