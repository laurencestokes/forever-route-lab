import type { CharacterProfile } from '../domain/project';
import type { DatasetView } from '../domain/dataset';
import type { UiMapId } from '../domain/ids';
import { isFullUiRectangle } from '../geo/transforms';
import type { MapGeometry, UiMapGeometry } from '../geo/types';
import type { ZoneCard } from '../map/adapter';
import { type Difficulty, questDifficulty } from '../rules/difficulty';
import type { EffectiveRules } from '../rules/precedence';
import { characterName } from './character-names';
import { withArticle } from './quest-state-text';
import { questOpenTo } from './shell-support';

/**
 * Zone level spans (docs/research/map-presentation.md §12.5; step MP.3 builds the spans the
 * Available tab's zone headings and the top bar's zone list show; step MP.7 adds the cited official
 * text of the new zones, the zone cards' content with the difficulty twin's input, and the
 * "Viewing" chip's words).
 *
 * - **Span**: per zone or city UiMap, the p10 to p90 of `quest.level` over the zone's non-dungeon
 *   quests (`zoneOrSort` is the UiMap's AreaTable id, or a subzone's that `zones.json` `areas`
 *   routes to the UiMap, as the Valley of Trials' 363 to Durotar: the extractor's area links,
 *   QuestieDB's `areaIdToUiMapId`; review finding QA-02) **open to the character's race and class**,
 *   with the count; the dataset's levels, so the basis is `derived` from Era data (the boxed E).
 *   Fewer than 5 quests give no span, and none open to the character say so; nothing is guessed.
 * - **Rating**: the median quest level against the character's level at a step (COL-1 with the
 *   ruleset's thresholds), only where at least 10 quests are open and the p10 to p90 spread is at
 *   most 15 levels. Both thresholds are ASSUMPTIONs of the design, labelled so where they show.
 *
 * Computed once per dataset view and character, in the lazy derived pipeline.
 */

/** A span needs this many quests (§12.5, ASSUMPTION). */
export const SPAN_MIN_QUESTS = 5;
/** A rating needs this many quests (§12.5, ASSUMPTION). */
export const RATING_MIN_QUESTS = 10;
/** A rating needs the p10 to p90 spread to be at most this many levels (§12.5, ASSUMPTION). */
export const RATING_MAX_SPREAD = 15;

export interface ZoneSpan {
  readonly uiMapId: UiMapId;
  /** The UiMap's name in the geometry. */
  readonly name: string;
  /** Non-dungeon quests of the zone with a level, open to the character. */
  readonly open: number;
  /** The same quests over the whole dataset, whoever they are open to. */
  readonly all: number;
  /** p10, median and p90 of their levels; null with fewer than `SPAN_MIN_QUESTS`. */
  readonly low: number | null;
  readonly median: number | null;
  readonly high: number | null;
  /** "quests 13–25 (93)", "4 quests: too few for a span", "no quests for an Orc Warrior". */
  readonly text: string;
  /** "The Barrens: quests 13–25 (93 open to an Orc Warrior; 98 in the dataset)". */
  readonly detail: string;
  /** The levels are the dataset's (Era) quest levels, counted here: the boxed E goes with the span. */
  readonly basis: 'derived';
  /** The "Viewing" chip's words after the zone's name (§13.5): "quests 13–25 (93 open to an Orc Warrior)", or the cited text. */
  readonly viewing: string;
  /**
   * The name the minimap style gives the zone, whose picture shows only Ironforge's gate and the
   * ruins of Lordaeron (D-049 O19; review PR-17): "Ironforge (underground city)", "Undercity
   * (underground city)"; null for every other zone. The labels, the "Viewing" chip and the zone
   * select say it in that style.
   */
  readonly undergroundName: string | null;
}

/** The underground cities named so in the minimap style (D-049 O19; the committed UiMap rows): Ironforge and the Undercity. */
export const UNDERGROUND_CITIES: readonly number[] = [1455, 1458];

export const undergroundName = (name: string): string => `${name} (underground city)`;

export type ZoneSpans = ReadonlyMap<UiMapId, ZoneSpan>;

/** A zone's rating at a step: the difficulty of its median quest level for the character's level. */
export interface ZoneRating {
  readonly difficulty: Difficulty;
  /** The median quest level the rating is of. */
  readonly level: number;
  /** The character's level is a lower bound (dashed edge, as `DifficultyLabel`'s). */
  readonly lowerBound: boolean;
}

/** The value at share `p` of ascending `sorted` (the nearest rank by index, as the design's measurement took it). */
const at = (sorted: readonly number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))] ?? 0;


const count = (n: number, one: string, many: string): string => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/** "13–25", or "13" when both ends are the same. */
export const levelRange = (low: number, high: number): string => (low === high ? String(low) : `${String(low)}–${String(high)}`);

/**
 * The spans of every zone and city the geometry frames (a UiMap with one full-rectangle row naming
 * an AreaTable zone), by UiMap id in ascending order. `areaZones` (the dataset's area links,
 * `DatasetSource.areaZones`) sends a subzone's quests to the UiMap its area is routed to; an area it
 * does not list counts only for the UiMap whose own row names it.
 */
export function zoneSpans(
  dataset: DatasetView,
  geometry: MapGeometry,
  character: Pick<CharacterProfile, 'race' | 'class'>,
  areaZones?: ReadonlyMap<number, UiMapId>,
): ZoneSpans {
  const who = withArticle(characterName(character));
  const framed: UiMapGeometry[] = [];
  const ownRow = new Map<number, UiMapId[]>();
  for (const map of geometry.maps.values()) {
    const [row] = map.assignments;
    if (map.assignments.length !== 1 || row === undefined || row.areaId <= 0 || !isFullUiRectangle(row)) continue;
    framed.push(map);
    ownRow.set(row.areaId, [...(ownRow.get(row.areaId) ?? []), map.uiMapId]);
  }
  const byZone = new Map<UiMapId, { all: number; levels: number[] }>();
  for (const quest of dataset.quests()) {
    const area = quest.zoneOrSort;
    const level = quest.level;
    if (area === null || area <= 0 || quest.dungeonQuest || level === null || !Number.isInteger(level) || level < 1) continue;
    const routed = areaZones?.get(area);
    const isOpen = questOpenTo(quest, character) === true;
    for (const zone of routed === undefined ? (ownRow.get(area) ?? []) : [routed]) {
      const entry = byZone.get(zone) ?? { all: 0, levels: [] };
      entry.all += 1;
      if (isOpen) entry.levels.push(level);
      byZone.set(zone, entry);
    }
  }
  const out = new Map<UiMapId, ZoneSpan>();
  for (const map of framed) {
    const entry = byZone.get(map.uiMapId);
    const levels = [...(entry?.levels ?? [])].sort((a, b) => a - b);
    const all = entry?.all ?? 0;
    const open = levels.length;
    const spanned = open >= SPAN_MIN_QUESTS;
    const low = spanned ? at(levels, 0.1) : null;
    const high = spanned ? at(levels, 0.9) : null;
    const text =
      low !== null && high !== null
        ? `quests ${levelRange(low, high)} (${open.toLocaleString('en-GB')})`
        : open > 0
          ? `${count(open, 'quest', 'quests')}: too few for a span`
          : `no quests for ${who}`;
    const detail =
      low !== null && high !== null
        ? `${map.name}: quests ${levelRange(low, high)} (${open.toLocaleString('en-GB')} open to ${who}; ${all.toLocaleString('en-GB')} in the dataset)`
        : `${map.name}: ${text} (${count(all, 'quest', 'quests')} in the dataset)`;
    const cited = ZONE_LEVEL_TEXTS.get(map.uiMapId);
    const viewing = cited?.text ?? (low !== null && high !== null ? `quests ${levelRange(low, high)} (${open.toLocaleString('en-GB')} open to ${who})` : text);
    const underground = UNDERGROUND_CITIES.includes(map.uiMapId) ? undergroundName(map.name) : null;
    out.set(map.uiMapId, { uiMapId: map.uiMapId, name: map.name, open, all, low, median: spanned ? at(levels, 0.5) : null, high, text, detail, basis: 'derived', viewing, undergroundName: underground });
  }
  return out;
}

/** A zone's rating for a character of `level` (a lower bound when `lowerBound`), or null where the span is too small or too wide to rate. */
export function zoneRating(span: ZoneSpan, level: number, lowerBound: boolean, rules: EffectiveRules): ZoneRating | null {
  if (span.open < RATING_MIN_QUESTS || span.median === null || span.low === null || span.high === null) return null;
  if (span.high - span.low > RATING_MAX_SPREAD || !Number.isInteger(level) || level < 1) return null;
  const values = rules.values;
  const difficulty = questDifficulty(level, span.median, { yellowLowerBound: values.difficultyYellowLowerBound.value, greenRange: values.greenRange.value });
  return { difficulty, level: span.median, lowerBound };
}

// =============================================================================================
// Cited level text and the zone cards (step MP.7)

/**
 * The level text of the zones whose range is announced or unknown rather than counted (§12.5):
 * shown on their cards and in the "Viewing" chip instead of the dataset's span, worded with its
 * basis. CITED: docs/research/forever-game-rules.md §1 (Riverglades "mid-30s to mid-40s", S2,
 * CONFIRMED; Mount Hyjal "endgame", R4, REPORTED; Shen'dralas not announced, UNKNOWN) and, for the
 * Darkspear Islands, the client's `Map` row 2997 (`InstanceType` 3, a battleground; build
 * 1.60.1.70009, `.cache/map-presentation/data.md`; D-022).
 */
export interface ZoneLevelText {
  readonly text: string;
  readonly basis: 'official' | 'reported' | 'unknown' | 'client';
}

export const ZONE_LEVEL_TEXTS: ReadonlyMap<number, ZoneLevelText> = new Map<number, ZoneLevelText>([
  [2548, { text: 'mid-30s to mid-40s (official)', basis: 'official' }],
  [2482, { text: 'endgame (reported)', basis: 'reported' }],
  [2652, { text: 'level range unknown ?', basis: 'unknown' }],
  [2524, { text: 'Battleground (client: Map 2997 InstanceType 3)', basis: 'client' }],
]);

/** Estimated text widths for a card's reserved width (the adapter widens it to the measured text). */
const NAME_PX_PER_CHAR = 7.2;
const SPAN_PX_PER_CHAR = 5.6;
/** The difficulty twin's width on a card, with its gap, and the boxed E's (§13.4). */
export const CARD_CHIP_PX = 30;
export const CARD_BASIS_PX = 13;

/**
 * A zone card's content (§12.5, §13.4): the name; line 2 the difficulty twin (the median quest level
 * rated at the step, from `zoneRating`), "quests 13–25 (93)" and the boxed E, or the cited text; the
 * compact form's span ("13–25", none for a cited text: the name alone, §13.3); and a width reserved
 * for the twin whether or not it is rated now, so a step change never widens the card.
 */
export function zoneCardOf(name: string, uiMapId: number, span: ZoneSpan | null, rating: ZoneRating | null): ZoneCard {
  const cited = ZONE_LEVEL_TEXTS.get(uiMapId) ?? null;
  const line = cited?.text ?? span?.text ?? null;
  const compact = cited === null && span !== null && span.low !== null && span.high !== null ? levelRange(span.low, span.high) : null;
  const basis = cited?.basis ?? (span === null ? null : 'derived');
  const difficulty = cited === null && rating !== null ? { key: rating.difficulty, levelText: String(rating.level), lowerBound: rating.lowerBound } : null;
  const second = line === null ? 0 : CARD_CHIP_PX + line.length * SPAN_PX_PER_CHAR + (basis === 'derived' ? CARD_BASIS_PX : 0);
  return { name, span: line, compact, basis, difficulty, widthPx: Math.ceil(Math.max(name.length * NAME_PX_PER_CHAR, second)) };
}
