import type { DatasetView, EntityRef, QuestRecord, SpawnPoint } from '../domain/dataset';
import type { Estimated } from '../domain/estimate';
import type { QuestId, StepId, UiMapId, WorldMapId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';
import type { CharacterProfile } from '../domain/project';
import type { ReadonlyCharacterState, ReadonlyQuestLogEntry, StepRecord } from '../engine/types';
import { convexHull, gridGroups, OUTLINE_CELL_YARDS, OUTLINE_MIN_POINTS } from '../geo/groups';
import type { MapGeometry } from '../geo/types';
import type { CountedObjectiveInput, LogObjectivesInput, MarkerMark, ObjectiveAreaInput, PointGroupInput, SpawnLayerInput } from '../map/adapter';
import type { MarkState } from '../map/marks';
import { type Difficulty, DIFFICULTY_LABELS, questDifficulty } from '../rules/difficulty';
import type { EffectiveRules } from '../rules/precedence';
import { questXp } from '../sim/quest-xp';
import { type AcceptChecks, type AcceptFinding, acceptTruth, availabilitySubject } from '../validate/availability';
import { formatIssueMessage, type IssueCode, issueCodeSpec } from '../validate/codes';
import { characterName } from './character-names';
import { objectiveModel } from './map-model';
import { withArticle } from './quest-state-text';
import { HOLIDAY_QUEST_SORTS } from './sample-route';
import { effectiveQuestLevel } from './shell-support';
import { zoneRating, type ZoneRating, type ZoneSpan, type ZoneSpans } from './zone-levels';

/**
 * The quest state at the selected step (docs/research/map-presentation.md §7.1, §7.2, §7.5, §14.4;
 * the one state table §25.2.3; step MP.3): every quest open to the character's race and class is
 * classified from the accept checks (`createAcceptChecks`, VAL-1 to VAL-22) at the state after the
 * active step, and COL-1, with WoWF-QRP's relevance windows re-implemented from their behaviour
 * (no code or data of theirs). The derived pipeline builds it once per (walk, active step), off the
 * map sync, and publishes it; the Available tab, the top bar, the map's quest layers and (MP.4b) the
 * drawer's counts read it.
 *
 * - **Classes** (§7.2, first match in this order): in the log; done (turned in or abandoned);
 *   available; low level (trivial by COL-1); may be available for a level doubt (the level is a
 *   lower bound) within the level window; may be available for an unverifiable history within the
 *   prerequisite window; may be available for another doubt (skill, reputation, spell, window,
 *   specialisation); needs a prerequisite (only prerequisite errors, inside the prerequisite window,
 *   not a follow-up of a quest in the log); unlocks soon (only a level error, within the level
 *   window); outside the window, with its reason.
 * - **Windows** (ASSUMPTIONs of the design, to tune with the owner): the level window is a required
 *   level at most the character's level + 3; the prerequisite window is a quest level above grey and
 *   at most the character's level + 4.
 * - **A lower-bound level** never locks a quest for level: its VAL-4 is a doubt, so the quest is
 *   "may be available" with the lower bound in words.
 * - **Turn-ins** (§7.5): ready when the walk marks every objective done; in progress when an accept
 *   of the route put the quest in the log and some objective is open; otherwise the record is
 *   unknown (a quest the dataset does not know, or a pre-route entry whose progress is not
 *   declared), and it is never ready.
 * - **Words** never name a step number: the step is the model's (`stepId`), and the UI and the map's
 *   label provider number it from the route order when they show it.
 *
 * Unknown stays unknown: an unknown quest level gives no difficulty and no window, an unreadable
 * record is said so, and nothing is guessed.
 */

// =============================================================================================
// Types

export type QuestClass =
  | 'in-log'
  | 'done'
  | 'available'
  | 'low-level'
  | 'uncertain-level'
  | 'uncertain-history'
  | 'uncertain-other'
  | 'locked'
  | 'unlocks-soon'
  | 'outside';

export const QUEST_CLASSES: readonly QuestClass[] = ['in-log', 'done', 'available', 'low-level', 'uncertain-level', 'uncertain-history', 'uncertain-other', 'locked', 'unlocks-soon', 'outside'];

/** Why a quest is outside the windows (counted in the layer notes by reason, §7.2). */
export type OutsideReason =
  /** Only a level error (or a level doubt) with the required level more than 3 above. */
  | 'level-ahead'
  /** A prerequisite error or an unverifiable history, outside the prerequisite window. */
  | 'prerequisite-outside'
  /** A prerequisite error of a quest that follows one in the log (a direct pre-quest in the log, or a log quest of the same name). */
  | 'follow-up'
  | 'level-and-prerequisite'
  /** Any other error: the maximum level, skill, reputation, spell or an availability window. */
  | 'closed'
  /** A prerequisite error or doubt whose window cannot be tested: the quest's level is unknown. */
  | 'level-unknown'
  /** A quest of a holiday or recurring event (QuestieDB's event categories): offered only while its event is on, which the route does not know. */
  | 'event';

export const OUTSIDE_REASONS: readonly OutsideReason[] = ['level-ahead', 'prerequisite-outside', 'follow-up', 'level-and-prerequisite', 'closed', 'level-unknown', 'event'];

/** The Map layers drawer's quest rows (§25.3.2): which row a quest counts in. */
export type QuestRow = 'available' | 'may-be-available' | 'needs-prerequisite' | 'unlocks-soon' | 'low-level' | 'turn-ins';

export const QUEST_ROWS: readonly QuestRow[] = ['available', 'may-be-available', 'needs-prerequisite', 'unlocks-soon', 'low-level', 'turn-ins'];

/** The rows drawn by default (§7.2, §25.3.2); "Unlocks soon" and "Low level" are off by default. */
export const DRAWN_ROWS: ReadonlySet<QuestRow> = new Set<QuestRow>(['available', 'may-be-available', 'needs-prerequisite']);

/** The level window: a required level at most this far above the character's (§7.2, ASSUMPTION). */
export const LEVEL_WINDOW = 3;
/** The prerequisite window: a quest level at most this far above the character's, and above grey (§7.2, ASSUMPTION). */
export const PREREQUISITE_WINDOW = 4;

export type TurnInKind = 'ready' | 'in-progress' | 'record-unknown';

/** The step that completes a log quest's open objectives after the active step: a `complete`, or its turn-in carrying the work (D-040). */
export interface CompletingStep {
  readonly stepId: StepId;
  readonly turnIn: boolean;
}

export interface TurnInState {
  readonly kind: TurnInKind;
  readonly done: number;
  readonly total: number;
  readonly failed: boolean;
  /** Null when the route does not complete the open objectives after the active step (or none is open). */
  readonly completedBy: CompletingStep | null;
}

export interface QuestStateEntry {
  readonly questId: QuestId;
  readonly name: string;
  readonly cls: QuestClass;
  readonly outside: OutsideReason | null;
  /** Its state in the one state table (§25.2.3); null when it is done. */
  readonly mark: MarkState | null;
  /** Its drawer row; null when done or outside the windows. */
  readonly row: QuestRow | null;
  /** The quest's level for this character (a scaling quest's at the character's level); null when unknown. */
  readonly level: number | null;
  /** Its required level, or null for none. */
  readonly requiredLevel: number | null;
  /** COL-1 at the character's level after the step; null when the quest's level is unknown. */
  readonly difficulty: Difficulty | null;
  /** Its state and reason in words, sentence case, without a step number: "Needs Cutting Teeth", "Unlocks at level 16". */
  readonly reason: string;
  /** The prerequisite quests a lock names (the "Needs" link of the Available tab), ascending. */
  readonly needs: readonly QuestId[];
  readonly dungeonQuest: boolean;
  /** Its turn-in, while it is in the log. */
  readonly turnIn: TurnInState | null;
  /**
   * A listed quest's XP at the character's level after the step (QXP-3, with its basis: Era values
   * unless entered or observed), for the Available rows' "+630 XP ≈" (ui-refresh.md §5.4; review
   * UI-05); absent or null for a quest in the log, done, or outside the windows.
   */
  readonly xp?: Estimated<number> | null;
  /** The codes of the accept checks that decided its class, in rule order (none in the log or done). */
  readonly codes: readonly IssueCode[];
}

/** One heading of the Available tab (§14.4, ui-refresh §5.4): a zone by distance, then Unlocks soon, then Low level. */
export interface AvailableGroup {
  readonly key: string;
  readonly kind: 'zone' | 'no-giver' | 'unlocks-soon' | 'low-level';
  readonly title: string;
  readonly uiMapId: UiMapId | null;
  /** The zone's span for the character (MP.3's derived span), or null. */
  readonly span: ZoneSpan | null;
  /** Its median quest level rated at the step, where the span allows (§12.5). */
  readonly rating: ZoneRating | null;
  /** Straight-line yards from the character to the group's nearest giver, on one world map; null when unknown. Order only. */
  readonly distance: number | null;
  /** Its quests: available first, then may be available, then needs a prerequisite; then by level and name. */
  readonly questIds: readonly QuestId[];
}

export interface QuestStateCounts {
  readonly classes: Readonly<Record<QuestClass, number>>;
  readonly outside: Readonly<Record<OutsideReason, number>>;
  readonly rows: Readonly<Record<QuestRow, number>>;
  /** Distinct givers of the available row's quests ("209 · 118 givers"). */
  readonly availableGivers: number;
  /** Log quests ready to turn in ("8 · 4 ready"). */
  readonly ready: number;
  /** Log quests with open objectives placed on a map. */
  readonly objectives: number;
}

/** What the givers' layer notes say it cannot draw (MAP-HONEST-4). */
export interface GiverNotes {
  readonly itemStarted: number;
  readonly noStarter: number;
  readonly spawnlessGivers: number;
  readonly spawnlessQuests: number;
}

/** What the turn-ins' layer notes say it cannot draw. */
export interface TurnInNotes {
  /** Log quests the dataset does not know: no finisher to draw. */
  readonly unknownQuests: number;
  /** Finishers that are items: no map position. */
  readonly noPosition: number;
  /** Log quests whose every NPC or object finisher has no spawn. */
  readonly spawnless: number;
}

/**
 * The quest layers' notes for the layer panel and the drawer (MAP-HONEST-5), in words without a
 * step number: the first sentence of each is read after "After step N: " (the controller numbers it
 * from the route order). Built here, in the lazy pipeline, so the entry chunk carries no copy.
 */
export interface QuestLayerNotes {
  readonly givers: readonly string[];
  readonly turnIns: readonly string[];
  readonly objectives: readonly string[];
}

/** The map's quest layers from the model. */
export interface QuestMapInputs {
  /** The givers of the quests drawn by default (§7.2), one group per NPC or object, with the best state. */
  readonly givers: SpawnLayerInput;
  readonly giverNotes: GiverNotes;
  /** The finishers of every quest in the log, with its turn-in state. */
  readonly turnIns: SpawnLayerInput;
  readonly turnInNotes: TurnInNotes;
  /** The open objectives of the log quests: counted marks and outlines (§7.4). */
  readonly log: LogObjectivesInput;
  readonly notes: QuestLayerNotes;
}

export interface QuestStateModel {
  /** The editor revision walked. */
  readonly revision: number;
  /** The active step: the state is the one after it. */
  readonly stepId: StepId;
  readonly stepIndex: number;
  /** "Orc Warrior". */
  readonly who: string;
  /** The character's level after the step (the known-XP lower bound when `levelLowerBound`). */
  readonly level: number;
  readonly levelLowerBound: boolean;
  /** Every quest open to the character's race and class, and every quest in the log, by id. */
  readonly quests: ReadonlyMap<QuestId, QuestStateEntry>;
  readonly counts: QuestStateCounts;
  readonly log: { readonly size: number; readonly capacity: number; readonly full: boolean };
  /** The Available tab's headings, in order, with the quests drawn by default, then Unlocks soon and Low level. */
  readonly groups: readonly AvailableGroup[];
  /** The Available tab's summary after "After step N, ": the level, the rows' counts and what is not listed. */
  readonly summary: string;
  readonly map: QuestMapInputs;
  /**
   * The givers of `questIds` not drawn by default (unlocks soon, low level, outside the windows), for
   * the quests in focus (opened in Details): the same object for the same ids.
   */
  readonly giversOf: (questIds: readonly QuestId[]) => SpawnLayerInput;
  /**
   * The givers of the quests of `rows` (the Map layers drawer's shown quest rows; `DRAWN_ROWS` by
   * default) and of the focused `questIds` outside them, one group per NPC or object with its best
   * state and each quest's own (map-presentation.md §25.3.4, step MP.4b): the drawer's Unlocks soon
   * and Low level rows, off by default, join the layer only when shown, so they cost no budget until
   * then. The same object for the same rows and ids.
   */
  readonly giversFor: (rows: ReadonlySet<QuestRow>, questIds: readonly QuestId[]) => SpawnLayerInput;
}

export interface QuestStateInput {
  readonly revision: number;
  readonly stepId: StepId;
  readonly stepIndex: number;
  /** The character state after the active step (`SelectedStepState.after`). */
  readonly state: ReadonlyCharacterState;
  /** The walk's records, for the steps that complete the log quests' objectives. */
  readonly records: readonly StepRecord[];
  readonly dataset: DatasetView;
  readonly geometry: MapGeometry;
  readonly rules: EffectiveRules;
  readonly character: Pick<CharacterProfile, 'race' | 'class' | 'priorHistory' | 'reputation'>;
  /** Accept checks over the same dataset and rules (the validator's rules; LINT is not asked). */
  readonly checks: AcceptChecks;
  /** The quests open to the character's race and class (`questsForCharacter(...).open`). */
  readonly open: readonly QuestRecord[];
  readonly spans: ZoneSpans;
  /** The model published before, whose unchanged entries are kept (so the Available tab re-renders only the rows that changed). */
  readonly previous?: QuestStateModel | null;
}

// =============================================================================================
// Words

const LEVEL_DOUBTS: ReadonlySet<string> = new Set(['VAL004-min-level-uncertain', 'VAL005-max-level-uncertain']);
const HISTORY_DOUBTS: ReadonlySet<string> = new Set([
  'VAL008-prequest-single-unverifiable',
  'VAL009-prequest-group-unverifiable',
  'VAL010-parent-not-active-unverifiable',
  'VAL013-breadcrumb-target-unavailable',
  'VAL021-previous-chain-active',
]);
const PREREQUISITE_ERRORS: ReadonlySet<string> = new Set([
  'VAL008-prequest-single',
  'VAL009-prequest-group',
  'VAL010-parent-not-active',
  'VAL011-later-chain-step',
  'VAL012-exclusive',
  'VAL013-breadcrumb-target-taken',
  'VAL014-breadcrumb-active',
]);
/**
 * Findings that do not decide a class: a full log (VAL-20, said once for the whole model, so a full
 * log does not blank the map) and VAL-22, an info that never blocks (ARCHITECTURE §9.4: the flag
 * means completion needs a trigger).
 */
const NOT_CLASSIFYING: ReadonlySet<string> = new Set(['VAL020-quest-log-full', 'VAL022-needs-event']);

const upperFirst = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** `a`, `a or b`, `a, b and c`; a name that repeats (two quests of one name) is said once. */
function joinWords(names: readonly string[], word: 'and' | 'or'): string {
  const items = [...new Set(names)];
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${word} ${items[items.length - 1] ?? ''}`;
}

const questName = (dataset: Pick<DatasetView, 'quest'>, id: QuestId): string => dataset.quest(id)?.name ?? `Quest ${String(id)}`;

/**
 * A quest's name inside a reason sentence, in quotation marks (review QA-27): names such as
 * "... and a Batch of Ooze" otherwise read as a sentence cut short.
 */
const quotedName = (dataset: Pick<DatasetView, 'quest'>, id: QuestId): string => `“${questName(dataset, id)}”`;

/** Quest ids from a finding's `idList` data value ("12,48"). */
function idsOf(value: unknown): QuestId[] {
  if (typeof value !== 'string' || value === '') return [];
  return value.split(',').flatMap((part) => (/^\d+$/.test(part) ? [Number(part) as QuestId] : []));
}

const idOf = (value: unknown): QuestId | null => (typeof value === 'number' && Number.isSafeInteger(value) ? (value as QuestId) : null);

/** A finding's own message with the quest called "it" (the row names the quest already). */
const messageOf = (finding: AcceptFinding): string => formatIssueMessage(finding.code, finding.data, { ...finding.words, quest: 'it' });

interface Phrase {
  readonly text: string;
  readonly needs: readonly QuestId[];
}

/** A prerequisite error's or history doubt's words, without "May be available". */
function prerequisitePhrase(finding: AcceptFinding, record: QuestRecord, dataset: Pick<DatasetView, 'quest'>): Phrase {
  const names = (ids: readonly QuestId[], word: 'and' | 'or'): string => joinWords(ids.map((id) => quotedName(dataset, id)), word);
  const data = finding.data;
  const one = (value: unknown, none: string): string => {
    const id = idOf(value);
    return id === null ? none : quotedName(dataset, id);
  };
  const code: string = finding.code;
  if (code.startsWith('VAL008-')) {
    const ids = [...record.prerequisites.preQuestSingle].sort((a, b) => a - b);
    return { text: `needs ${names(ids, 'or')}`, needs: ids };
  }
  if (code.startsWith('VAL009-')) {
    const ids = idsOf(data?.quests);
    return { text: `needs ${names(ids, 'and')}`, needs: ids };
  }
  if (code.startsWith('VAL010-')) {
    const parent = idOf(data?.parentQuestId);
    return parent === null ? { text: lowerFirst(messageOf(finding)), needs: [] } : { text: `needs ${quotedName(dataset, parent)} in the quest log`, needs: [parent] };
  }
  if (code === 'VAL011-later-chain-step') return { text: `closed: the next quest in its chain, ${one(data?.nextQuestId, 'another quest')}, is taken or done`, needs: [] };
  if (code === 'VAL012-exclusive') return { text: `closed: exclusive with ${names(idsOf(data?.quests), 'and')}, taken or done`, needs: [] };
  if (code === 'VAL013-breadcrumb-target-taken') return { text: `closed: it leads to ${one(data?.targetQuestId, 'a quest')}, already taken or done`, needs: [] };
  if (code === 'VAL013-breadcrumb-target-unavailable') {
    return { text: `it leads to ${one(data?.targetQuestId, 'a quest')}, which cannot be accepted yet (Questie offers it; the vmangos emulator does not)`, needs: [] };
  }
  if (code === 'VAL014-breadcrumb-active') return { text: `not offered while ${names(idsOf(data?.quests), 'and')} is in the quest log`, needs: [] };
  if (code === 'VAL021-previous-chain-active') {
    return { text: `it follows ${one(data?.previousQuestId, 'a quest')}, still in the quest log (Questie offers it; the vmangos emulator does not)`, needs: [] };
  }
  return { text: lowerFirst(messageOf(finding)), needs: [] };
}

/** The phrases of several findings, joined; their named prerequisites united, ascending. */
function phrases(list: readonly Phrase[]): Phrase {
  const needs = [...new Set(list.flatMap((phrase) => phrase.needs))].sort((a, b) => a - b);
  return { text: [...new Set(list.map((phrase) => phrase.text))].join('; '), needs };
}

const difficultyWord = (difficulty: Difficulty): string => DIFFICULTY_LABELS[difficulty].toLowerCase();

function levelWords(level: number | null, difficulty: Difficulty | null): string {
  if (level === null) return 'level unknown';
  return difficulty === null ? `level ${String(level)}` : `${difficultyWord(difficulty)}, level ${String(level)}`;
}

// =============================================================================================
// Classification

export interface Classification {
  readonly cls: QuestClass;
  readonly outside: OutsideReason | null;
  readonly reason: string;
  readonly needs: readonly QuestId[];
  readonly codes: readonly IssueCode[];
}

export interface ClassifyContext {
  readonly state: ReadonlyCharacterState;
  readonly dataset: Pick<DatasetView, 'quest'>;
  /** The quest's level for the character and its difficulty at the state (null when unknown). */
  readonly level: number | null;
  readonly difficulty: Difficulty | null;
  /** Names of the quests in the log (a follow-up of one is outside the window). */
  readonly logNames: ReadonlySet<string>;
}

const validLevel = (level: number | null): number | null => (level !== null && Number.isInteger(level) && level >= 1 ? level : null);

/**
 * The class of a quest that is neither in the log nor done, from its accept findings at the state
 * (§7.2). Exported for the tests; `questStateModel` classifies every quest with it.
 */
export function classifyFindings(record: QuestRecord, findings: readonly AcceptFinding[], ctx: ClassifyContext): Classification {
  const { state, dataset, level, difficulty } = ctx;
  const characterLevel = state.level;
  const required = validLevel(record.minLevel);
  const withinLevel = required === null || required <= characterLevel + LEVEL_WINDOW;
  const trivial = difficulty === 'trivial';
  const inPrerequisiteWindow = level !== null && !trivial && level <= characterLevel + PREREQUISITE_WINDOW;
  const deciding = findings.filter((finding) => !NOT_CLASSIFYING.has(finding.code));
  const codes = deciding.map((finding) => finding.code);
  const errors = deciding.filter((finding) => issueCodeSpec(finding.code).severity === 'error');
  const doubts = deciding.filter((finding) => issueCodeSpec(finding.code).severity !== 'error' && acceptTruth([finding]) === 'unknown');
  const out = (outside: OutsideReason, reason: string, needs: readonly QuestId[] = []): Classification => ({ cls: 'outside', outside, reason, needs, codes });
  const at = (cls: QuestClass, reason: string, needs: readonly QuestId[] = []): Classification => ({ cls, outside: null, reason, needs, codes });
  const unlockText = required === null ? 'Unlocks at a higher level' : `Unlocks at level ${String(required)}`;
  const outsideWhy = (): string => {
    if (level === null) return 'its level is unknown';
    if (trivial) return 'outside the window: low level';
    if (level > characterLevel + PREREQUISITE_WINDOW) return `outside the window: level ${String(level)}, more than ${String(PREREQUISITE_WINDOW)} above`;
    return `outside the window: it needs level ${String(required ?? 1)}`;
  };

  // The design's "event-only" row (§7.2): a holiday or recurring event's quest is offered only
  // while its event is on, which no route state knows (VAL-22's flag is about completion, and never blocks).
  if (record.zoneOrSort !== null && HOLIDAY_QUEST_SORTS.has(record.zoneOrSort)) {
    return out('event', `Offered only while its holiday or event is on (QuestieDB event category ${String(record.zoneOrSort)})`);
  }
  if (errors.length === 0 && doubts.length === 0) {
    return trivial ? at('low-level', `Low level (${levelWords(level, difficulty)})`) : at('available', `Available (${levelWords(level, difficulty)})`);
  }

  if (errors.length === 0) {
    const levelDoubts = doubts.filter((finding) => LEVEL_DOUBTS.has(finding.code));
    const historyDoubts = doubts.filter((finding) => HISTORY_DOUBTS.has(finding.code));
    const otherDoubts = doubts.filter((finding) => !LEVEL_DOUBTS.has(finding.code) && !HISTORY_DOUBTS.has(finding.code));
    const levelPhrases = levelDoubts.map((finding): Phrase => {
      const max = validLevel(record.maxLevel);
      const bound = `the level is a lower bound (at least ${String(characterLevel)}`;
      return { text: finding.code === 'VAL005-max-level-uncertain' && max !== null ? `${bound}; it is offered up to level ${String(max)})` : `${bound}; it needs ${String(required ?? 1)})`, needs: [] };
    });
    const otherPhrases = otherDoubts.map((finding) => ({ text: lowerFirst(messageOf(finding)), needs: [] }));
    if (historyDoubts.length > 0) {
      const history = phrases([...historyDoubts.map((finding) => prerequisitePhrase(finding, record, dataset)), ...levelPhrases, ...otherPhrases]);
      const text = history.text;
      const unknown = historyDoubts.some((finding) => finding.code.endsWith('-unverifiable')) ? ', and the history before the route is unknown' : '';
      if (level === null) return out('level-unknown', `${upperFirst(text)}${unknown}; its level is unknown`, history.needs);
      if (inPrerequisiteWindow && withinLevel) return at('uncertain-history', `May be available: ${text}${unknown}`, history.needs);
      return out('prerequisite-outside', `${upperFirst(text)}${unknown}; ${outsideWhy()}`, history.needs);
    }
    if (levelDoubts.length > 0) {
      const all = phrases([...levelPhrases, ...otherPhrases]);
      return withinLevel ? at('uncertain-level', `May be available: ${all.text}`) : out('level-ahead', `${unlockText} (the level is a lower bound, at least ${String(characterLevel)})`);
    }
    return at('uncertain-other', `May be available: ${phrases(otherPhrases).text}`);
  }

  const levelError = errors.some((finding) => finding.code === 'VAL004-min-level');
  const prerequisiteErrors = errors.filter((finding) => PREREQUISITE_ERRORS.has(finding.code));
  const otherErrors = errors.filter((finding) => finding.code !== 'VAL004-min-level' && !PREREQUISITE_ERRORS.has(finding.code));
  if (otherErrors.length > 0) return out('closed', upperFirst(otherErrors.map((finding) => messageOf(finding).replace(/\.$/, '')).join('; ')));
  const prerequisite = phrases(prerequisiteErrors.map((finding) => prerequisitePhrase(finding, record, dataset)));
  if (levelError && prerequisiteErrors.length > 0) return out('level-and-prerequisite', `${unlockText}; ${prerequisite.text}`, prerequisite.needs);
  if (levelError) return withinLevel ? at('unlocks-soon', unlockText) : out('level-ahead', unlockText);
  // Only prerequisite errors: in the window unless the quest follows one in the log.
  const pre = record.prerequisites;
  const direct = [...pre.preQuestSingle, ...pre.preQuestGroup.map((entry) => Math.abs(entry) as QuestId)];
  const followed = direct.find((id) => state.questLog.has(id)) ?? null;
  if (followed !== null || ctx.logNames.has(record.name)) {
    const what = followed === null ? `a quest of the same name` : quotedName(dataset, followed);
    return out('follow-up', `Follows ${what}, in the quest log; ${prerequisite.text}`, prerequisite.needs);
  }
  if (level === null) return out('level-unknown', `${upperFirst(prerequisite.text)}; its level is unknown`, prerequisite.needs);
  if (!inPrerequisiteWindow) return out('prerequisite-outside', `${upperFirst(prerequisite.text)}; ${outsideWhy()}`, prerequisite.needs);
  return at('locked', upperFirst(prerequisite.text), prerequisite.needs);
}

const MARK_OF: Readonly<Record<Exclude<QuestClass, 'in-log' | 'done' | 'outside'>, MarkState>> = {
  available: 'available',
  'low-level': 'low-level',
  'uncertain-level': 'uncertain',
  'uncertain-history': 'uncertain',
  'uncertain-other': 'uncertain',
  locked: 'locked',
  'unlocks-soon': 'unlocks-soon',
};

const ROW_OF: Readonly<Record<Exclude<QuestClass, 'done' | 'outside'>, QuestRow>> = {
  'in-log': 'turn-ins',
  available: 'available',
  'low-level': 'low-level',
  'uncertain-level': 'may-be-available',
  'uncertain-history': 'may-be-available',
  'uncertain-other': 'may-be-available',
  locked: 'needs-prerequisite',
  'unlocks-soon': 'unlocks-soon',
};

/** A turn-in's state from the log entry (§7.5): never ready while the record or the progress is unknown. */
export function turnInOf(entry: ReadonlyQuestLogEntry, record: QuestRecord | undefined): Omit<TurnInState, 'completedBy'> {
  const total = entry.objectives.length;
  const done = entry.objectives.filter((objective) => objective === 'done').length;
  const kind: TurnInKind = record === undefined ? 'record-unknown' : done === total ? 'ready' : entry.routeAccepted ? 'in-progress' : 'record-unknown';
  return { kind, done, total, failed: entry.failed };
}

function turnInReason(turnIn: Omit<TurnInState, 'completedBy'>, known: boolean): string {
  if (turnIn.failed) return 'In the quest log: failed';
  switch (turnIn.kind) {
    case 'ready':
      return 'In the quest log: ready to turn in';
    case 'in-progress':
      return `In the quest log: ${String(turnIn.done)} of ${String(turnIn.total)} objectives done`;
    case 'record-unknown':
      return known ? 'In the quest log: its progress before the route is unknown (never shown as ready)' : 'In the quest log: the dataset has no record of it (never shown as ready)';
  }
}

/**
 * The steps after `from` that complete each log quest's open objectives (§7.4's outline numbers):
 * the step whose marks leave none open; a turn-in that carries the work is marked so (D-040).
 */
function completingSteps(records: readonly StepRecord[], from: number, open: ReadonlyMap<QuestId, ReadonlySet<number>>): ReadonlyMap<QuestId, CompletingStep> {
  const remaining = new Map<QuestId, Set<number>>();
  for (const [id, set] of open) if (set.size > 0) remaining.set(id, new Set(set));
  const out = new Map<QuestId, CompletingStep>();
  for (let i = from; i < records.length && remaining.size > 0; i += 1) {
    const record = records[i];
    if (record === undefined) continue;
    for (const mark of record.delta.objectivesDone) {
      const set = remaining.get(mark.questId);
      if (set === undefined) continue;
      set.delete(mark.objective);
      if (set.size === 0) {
        out.set(mark.questId, { stepId: record.step.id, turnIn: record.step.kind === 'turnin' });
        remaining.delete(mark.questId);
      }
    }
    // Abandoned or turned in without completing: no step completes it.
    for (const id of [record.delta.abandoned, record.delta.turnedIn]) if (id !== null) remaining.delete(id);
  }
  return out;
}

// =============================================================================================
// The map's inputs

const GIVER_RANK: Readonly<Partial<Record<MarkState, number>>> = { available: 0, uncertain: 1, locked: 2, 'unlocks-soon': 3, 'low-level': 4 };
const TURN_IN_RANK: Readonly<Partial<Record<MarkState, number>>> = { ready: 0, 'in-progress': 1, 'record-unknown': 2 };

type PlaceRef = Extract<EntityRef, { readonly kind: 'npc' | 'object' }>;

function entityName(dataset: DatasetView, ref: PlaceRef): string {
  return ref.kind === 'npc' ? (dataset.npc(ref.id)?.name ?? `NPC ${String(ref.id)}`) : (dataset.object(ref.id)?.name ?? `Object ${String(ref.id)}`);
}

/** One quest's own mark (`MarkerQuest.mark`): its state, difficulty, arch and a turn-in's progress; null when it is done. */
function questMarkOf(entry: QuestStateEntry): MarkerMark | null {
  if (entry.mark === null) return null;
  const turnIn = entry.turnIn;
  return {
    state: entry.mark,
    difficulty: entry.difficulty,
    dungeonQuest: entry.dungeonQuest,
    progress: turnIn === null || turnIn.kind !== 'in-progress' ? null : { done: turnIn.done, total: turnIn.total },
    ...(entry.mark === 'unlocks-soon' ? { unlockLevel: entry.requiredLevel } : {}),
  };
}

/** The best-ranked entries' mark: the state, the difficulty when they share one, the arch, and a single quest's progress. */
function markOf(entries: readonly QuestStateEntry[], rank: Readonly<Partial<Record<MarkState, number>>>): MarkerMark | undefined {
  const ranked = entries.filter((entry) => entry.mark !== null && rank[entry.mark] !== undefined);
  if (ranked.length === 0) return undefined;
  const best = Math.min(...ranked.map((entry) => rank[entry.mark as MarkState] ?? Infinity));
  const top = ranked.filter((entry) => rank[entry.mark as MarkState] === best);
  const [first] = top;
  if (first === undefined || first.mark === null) return undefined;
  const shared = top.every((entry) => entry.difficulty === first.difficulty) ? first.difficulty : null;
  const turnIn = top.length === 1 ? first.turnIn : null;
  const unlock = first.mark === 'unlocks-soon' && top.every((entry) => entry.requiredLevel === first.requiredLevel) ? first.requiredLevel : null;
  return {
    state: first.mark,
    difficulty: shared,
    dungeonQuest: top.some((entry) => entry.dungeonQuest),
    progress: turnIn === null || turnIn.kind !== 'in-progress' ? null : { done: turnIn.done, total: turnIn.total },
    ...(first.mark === 'unlocks-soon' ? { unlockLevel: unlock } : {}),
  };
}

/** One group per NPC or object, labelled with each quest's state in words (no step number: the label provider adds it). */
function placeGroups(
  dataset: DatasetView,
  entries: readonly QuestStateEntry[],
  refsOf: (record: QuestRecord) => readonly EntityRef[],
  verb: string,
  rank: Readonly<Partial<Record<MarkState, number>>>,
): { readonly groups: readonly PointGroupInput[]; readonly itemOnly: number; readonly none: number; readonly spawnlessGroups: number; readonly spawnlessQuests: number } {
  const bySubject = new Map<string, { readonly ref: PlaceRef; readonly entries: QuestStateEntry[] }>();
  let itemOnly = 0;
  let none = 0;
  let spawnlessQuests = 0;
  for (const entry of entries) {
    const record = dataset.quest(entry.questId);
    const refs = record === undefined ? [] : refsOf(record);
    if (refs.length === 0) {
      none += 1;
      continue;
    }
    let placeable = false;
    let spawned = false;
    let item = false;
    for (const ref of refs) {
      if (ref.kind === 'item') {
        item = true;
        continue;
      }
      placeable = true;
      if (dataset.spawns(ref).length > 0) spawned = true;
      const key = `${ref.kind}:${String(ref.id)}`;
      const group = bySubject.get(key) ?? { ref, entries: [] };
      if (!group.entries.includes(entry)) group.entries.push(entry);
      bySubject.set(key, group);
    }
    if (!placeable) itemOnly += 1;
    else if (!spawned && !item) spawnlessQuests += 1;
  }
  let spawnlessGroups = 0;
  const groups: PointGroupInput[] = [...bySubject.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, { ref, entries: list }]) => {
      const spawns = dataset.spawns(ref);
      if (spawns.length === 0) spawnlessGroups += 1;
      const words = list.map((entry) => `${verb}${entry.name}: ${lowerFirst(entry.reason)}`);
      const label = `${entityName(dataset, ref)}: ${list.length === 1 ? (words[0] ?? '') : `${String(list.length)} quests: ${words.join('; ')}`}`;
      const mark = markOf(list, rank);
      const subject = ref.kind === 'npc' ? { kind: 'npc' as const, id: ref.id } : { kind: 'object' as const, id: ref.id };
      // Each quest's own state, for the clusters' group rule and the drawer's mask (map-presentation.md §25.2.5, §25.3.4).
      const quests = [...list].sort((a, b) => a.questId - b.questId).map((entry) => ({ questId: entry.questId, mark: questMarkOf(entry) }));
      return { subject, label, questIds: quests.map((quest) => quest.questId), spawns, quests, ...(mark === undefined ? {} : { mark }) };
    });
  return { groups, itemOnly, none, spawnlessGroups, spawnlessQuests };
}

const zoneNameOf = (dataset: DatasetView, uiMapId: UiMapId | null): string => (uiMapId === null ? 'no zone' : (dataset.zone(uiMapId)?.name ?? `UiMap ${String(uiMapId)}`));

/** The open objectives of the log quests as counted marks and outlines (§7.4). */
function logObjectives(
  dataset: DatasetView,
  geometry: MapGeometry,
  entries: readonly QuestStateEntry[],
  open: ReadonlyMap<QuestId, ReadonlySet<number>>,
): { readonly input: LogObjectivesInput; readonly quests: number } {
  const counted: CountedObjectiveInput[] = [];
  const areas: ObjectiveAreaInput[] = [];
  let quests = 0;
  for (const entry of entries) {
    const objectives = open.get(entry.questId);
    if (objectives === undefined || objectives.size === 0) continue;
    const model = objectiveModel(dataset, geometry, [entry.questId], (_quest, index) => objectives.has(index));
    /** Every placed point of the quest, per zone and world map. */
    const byZone = new Map<string, { readonly mapId: WorldMapId; readonly uiMapId: UiMapId | null; readonly points: WorldPoint[] }>();
    for (const group of model.input.groups) {
      const subjectKey = group.subject.kind === 'event' ? `event:${String(group.subject.questId)}:${String(group.subject.objective)}` : `${group.subject.kind}:${String(group.subject.id)}`;
      const perZone = new Map<string, { readonly uiMapId: UiMapId | null; readonly first: number; readonly points: WorldPoint[] }>();
      group.spawns.forEach((spawn: SpawnPoint, index) => {
        const world = spawn.world;
        if (world === null) return;
        const key = `${String(world.mapId)}:${String(spawn.uiMapId ?? 'none')}`;
        const zone = perZone.get(key) ?? { uiMapId: spawn.uiMapId, first: index, points: [] };
        zone.points.push(world);
        perZone.set(key, zone);
        const all = byZone.get(key) ?? { mapId: world.mapId, uiMapId: spawn.uiMapId, points: [] };
        all.points.push(world);
        byZone.set(key, all);
      });
      for (const [key, zone] of perZone) {
        const [first] = zone.points;
        if (first === undefined) continue;
        const n = zone.points.length;
        const point: WorldPoint = { mapId: first.mapId, x: zone.points.reduce((sum, p) => sum + p.x, 0) / n, y: zone.points.reduce((sum, p) => sum + p.y, 0) / n };
        const noun = group.subject.kind === 'event' ? (n === 1 ? 'point' : 'points') : n === 1 ? 'spawn' : 'spawns';
        counted.push({
          id: `count:${String(entry.questId)}:${subjectKey}:${key}`,
          questId: entry.questId,
          point,
          label: `${group.label} · ${String(n)} ${noun} in ${zoneNameOf(dataset, zone.uiMapId)}`,
          ref: { kind: 'spawn', subject: group.subject, spawnIndex: zone.first, questIds: [entry.questId] },
        });
      }
    }
    if (byZone.size > 0) quests += 1;
    // Outlines: 90 yd grid groups of 5 points or more per zone; the largest is labelled with the completing step.
    const questAreas: { readonly area: Omit<ObjectiveAreaInput, 'labelStep' | 'labelTurnIn'>; readonly size: number }[] = [];
    for (const [key, zone] of [...byZone.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      gridGroups(zone.points, OUTLINE_CELL_YARDS).forEach((members, k) => {
        if (members.length < OUTLINE_MIN_POINTS) return;
        const ring = convexHull(members);
        if (ring.length < 3) return;
        questAreas.push({
          area: { id: `area:${String(entry.questId)}:${key}:${String(k)}`, questId: entry.questId, mapId: zone.mapId, ring, label: `Objectives of ${entry.name}`, uiMapId: zone.uiMapId },
          size: members.length,
        });
      });
    }
    const largest = questAreas.reduce((best, candidate, index) => (candidate.size > (questAreas[best]?.size ?? -1) ? index : best), 0);
    const completedBy = entry.turnIn?.completedBy ?? null;
    questAreas.forEach(({ area }, index) => {
      const labelled = index === largest && completedBy !== null;
      areas.push({
        ...area,
        labelStep: labelled ? completedBy.stepId : null,
        labelTurnIn: labelled && completedBy.turnIn,
        label: completedBy === null ? `${area.label}: the route does not complete them` : area.label,
      });
    });
  }
  return { input: { counted, areas }, quests };
}

// =============================================================================================
// The model

const sameIds = <T>(a: readonly T[], b: readonly T[]): boolean => a.length === b.length && a.every((value, i) => value === b[i]);

function sameTurnIn(a: TurnInState | null, b: TurnInState | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.kind === b.kind &&
    a.done === b.done &&
    a.total === b.total &&
    a.failed === b.failed &&
    (a.completedBy === null || b.completedBy === null ? a.completedBy === b.completedBy : a.completedBy.stepId === b.completedBy.stepId && a.completedBy.turnIn === b.completedBy.turnIn)
  );
}

/** Whether two entries say the same (every field). */
const sameXp = (a: Estimated<number> | null, b: Estimated<number> | null): boolean =>
  a === b || (a !== null && b !== null && a.value === b.value && a.basis === b.basis && a.eraFallback === b.eraFallback);

export function sameEntry(a: QuestStateEntry, b: QuestStateEntry): boolean {
  return (
    a.questId === b.questId &&
    a.name === b.name &&
    a.cls === b.cls &&
    a.outside === b.outside &&
    a.mark === b.mark &&
    a.row === b.row &&
    a.level === b.level &&
    a.requiredLevel === b.requiredLevel &&
    a.difficulty === b.difficulty &&
    a.reason === b.reason &&
    a.dungeonQuest === b.dungeonQuest &&
    sameXp(a.xp ?? null, b.xp ?? null) &&
    sameIds(a.needs, b.needs) &&
    sameIds(a.codes, b.codes) &&
    sameTurnIn(a.turnIn, b.turnIn)
  );
}

const CLASS_ORDER: Readonly<Record<QuestClass, number>> = {
  available: 0,
  'uncertain-level': 1,
  'uncertain-other': 1,
  'uncertain-history': 1,
  locked: 2,
  'unlocks-soon': 3,
  'low-level': 4,
  'in-log': 5,
  done: 6,
  outside: 7,
};

const zeroes = <K extends string>(keys: readonly K[]): Record<K, number> => Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;

const n = (value: number): string => value.toLocaleString('en-GB');
const counted = (value: number, one: string, many: string): string => `${n(value)} ${value === 1 ? one : many}`;

/** The layer notes (§7.2's "counted in the notes by reason", MAP-HONEST-5), without step numbers. */
function layerNotes(counts: QuestStateCounts, who: string, log: QuestStateModel['log'], giverNotes: GiverNotes, turnInNotes: TurnInNotes): QuestLayerNotes {
  const { rows, outside, classes } = counts;
  const givers = [
    `${counted(rows.available, 'quest', 'quests')} available, ${n(rows['may-be-available'])} may be available (uncertain) and ${n(rows['needs-prerequisite'])} need a prerequisite, open to ${withArticle(who)} (dataset quests).`,
    `Not drawn: ${n(rows['unlocks-soon'])} unlock within ${String(LEVEL_WINDOW)} levels, ${n(rows['low-level'])} are low level, ${n(classes['in-log'])} are in the log (turn-ins) and ${n(classes.done)} are done.`,
  ];
  const words: Readonly<Record<OutsideReason, string>> = {
    'level-ahead': 'need a higher level',
    'prerequisite-outside': 'need a prerequisite outside the window',
    'follow-up': 'follow a quest in the log',
    'level-and-prerequisite': 'need both a level and a prerequisite',
    closed: 'are closed to the character',
    'level-unknown': 'have no known level',
    event: 'are holiday or event quests',
  };
  const reasons = OUTSIDE_REASONS.filter((reason) => outside[reason] > 0).map((reason) => `${n(outside[reason])} ${words[reason]}`);
  if (reasons.length > 0) givers.push(`Outside the windows: ${reasons.join(', ')}.`);
  if (log.full) givers.push(`The quest log is full (${n(log.size)} of ${n(log.capacity)}): nothing can be accepted until a quest is turned in.`);
  if (giverNotes.itemStarted > 0) givers.push(`${n(giverNotes.itemStarted)} start from an item: no map position.`);
  if (giverNotes.noStarter > 0) givers.push(`${n(giverNotes.noStarter)} have no starter in the dataset.`);
  if (giverNotes.spawnlessGivers > 0) givers.push(`${counted(giverNotes.spawnlessGivers, 'quest giver has', 'quest givers have')} no spawn in the dataset.`);
  const turnIns = [`${counted(classes['in-log'], 'quest', 'quests')} in the log, ${n(counts.ready)} ready to turn in; a quest whose progress is unknown is never shown as ready.`];
  if (turnInNotes.unknownQuests > 0) turnIns.push(`${counted(turnInNotes.unknownQuests, 'log quest is', 'log quests are')} not in the dataset: no turn-in to draw.`);
  if (turnInNotes.noPosition > 0) turnIns.push(`${counted(turnInNotes.noPosition, 'turn-in is an item', 'turn-ins are items')}: no map position.`);
  if (turnInNotes.spawnless > 0) turnIns.push(`${counted(turnInNotes.spawnless, 'log quest has', 'log quests have')} no finisher with a spawn in the dataset.`);
  const objectives = [`the open objectives of ${counted(counts.objectives, 'log quest', 'log quests')}: counted marks and outlines from the zone band.`];
  return { givers, turnIns, objectives };
}

/** The Available tab's summary, read after "After step N, " (§14.4). */
function summaryOf(counts: QuestStateCounts, level: number, lowerBound: boolean): string {
  const { rows, classes } = counts;
  return `level ${lowerBound ? 'at least ' : ''}${String(level)}: ${n(rows.available)} available, ${n(rows['may-be-available'])} may be available and ${n(rows['needs-prerequisite'])} need a prerequisite, by zone from the nearest; then ${n(rows['unlocks-soon'])} that unlock within ${String(LEVEL_WINDOW)} levels and ${n(rows['low-level'])} at a low level. Not listed: ${n(classes['in-log'])} in the log, ${n(classes.done)} done and ${n(classes.outside)} outside these windows (search finds them). Levels are the dataset’s; difficulty is at the level after the step.`;
}

/** Available first, then may be available, then needs a prerequisite; then by level (unknown last), name and id. */
function byListOrder(a: QuestStateEntry, b: QuestStateEntry): number {
  return (
    CLASS_ORDER[a.cls] - CLASS_ORDER[b.cls] ||
    (a.level ?? Infinity) - (b.level ?? Infinity) ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
    a.questId - b.questId
  );
}

/** The giver nearest the character (on its world map), else the first placed one: its zone and distance. */
function giverPlace(dataset: DatasetView, record: QuestRecord | undefined, location: WorldPoint | null): { readonly uiMapId: UiMapId | null; readonly distance: number | null } | null {
  if (record === undefined) return null;
  let first: SpawnPoint | null = null;
  let best: { readonly spawn: SpawnPoint; readonly distanceSq: number } | null = null;
  for (const ref of record.starters) {
    if (ref.kind === 'item') continue;
    for (const spawn of dataset.spawns(ref)) {
      const world = spawn.world;
      if (world === null) continue;
      first ??= spawn;
      if (location === null || world.mapId !== location.mapId) continue;
      const dx = world.x - location.x;
      const dy = world.y - location.y;
      const distanceSq = dx * dx + dy * dy;
      if (best === null || distanceSq < best.distanceSq) best = { spawn, distanceSq };
    }
  }
  if (best !== null) return { uiMapId: best.spawn.uiMapId, distance: Math.sqrt(best.distanceSq) };
  return first === null ? null : { uiMapId: first.uiMapId, distance: null };
}

export function questStateModel(input: QuestStateInput): QuestStateModel {
  const { state, dataset, geometry, rules, character, checks } = input;
  const subject = availabilitySubject(character);
  const characterLevel = state.level;
  const lowerBound = state.unknownXpEvents > 0;
  const difficultyOptions = { yellowLowerBound: rules.values.difficultyYellowLowerBound.value, greenRange: rules.values.greenRange.value };
  const levelOf = (record: QuestRecord | undefined): { readonly level: number | null; readonly difficulty: Difficulty | null } => {
    const level = record === undefined ? null : effectiveQuestLevel(characterLevel, record.level, record.minLevel);
    return { level, difficulty: level === null ? null : questDifficulty(characterLevel, level, difficultyOptions) };
  };
  const logNames = new Set<string>();
  for (const id of state.questLog.keys()) {
    const name = dataset.quest(id)?.name;
    if (name !== undefined) logNames.add(name);
  }

  const quests = new Map<QuestId, QuestStateEntry>();
  const open = new Map<QuestId, ReadonlySet<number>>();
  const addLogEntry = (id: QuestId, record: QuestRecord | undefined): void => {
    const logEntry = state.questLog.get(id);
    if (logEntry === undefined) return;
    const turnIn = turnInOf(logEntry, record);
    const openObjectives = new Set<number>();
    logEntry.objectives.forEach((objective, index) => {
      if (objective === 'open' || turnIn.kind === 'record-unknown') openObjectives.add(index);
    });
    open.set(id, openObjectives);
    const { level, difficulty } = levelOf(record);
    quests.set(id, {
      questId: id,
      name: record?.name ?? `Quest ${String(id)}`,
      cls: 'in-log',
      outside: null,
      mark: turnIn.kind,
      row: 'turn-ins',
      level,
      requiredLevel: validLevel(record?.minLevel ?? null),
      difficulty,
      reason: turnInReason(turnIn, record !== undefined),
      needs: [],
      dungeonQuest: record?.dungeonQuest ?? false,
      turnIn: { ...turnIn, completedBy: null },
      codes: [],
    });
  };
  for (const record of input.open) {
    const id = record.id;
    if (state.questLog.has(id)) {
      addLogEntry(id, record);
      continue;
    }
    const { level, difficulty } = levelOf(record);
    const base = { questId: id, name: record.name, level, requiredLevel: validLevel(record.minLevel), difficulty, dungeonQuest: record.dungeonQuest, turnIn: null };
    if (state.completed.has(id) || state.abandoned.has(id)) {
      quests.set(id, { ...base, cls: 'done', outside: null, mark: null, row: null, reason: state.completed.has(id) ? 'Turned in' : 'Abandoned', needs: [], codes: [] });
      continue;
    }
    const found = classifyFindings(record, checks.check(id, state, subject, false), { state, dataset, level, difficulty, logNames });
    const mark = found.cls === 'outside' ? (found.outside === 'level-ahead' ? 'unlocks-soon' : 'locked') : found.cls === 'in-log' || found.cls === 'done' ? null : MARK_OF[found.cls];
    const row = found.cls === 'outside' || found.cls === 'done' ? null : ROW_OF[found.cls];
    // A listed quest's XP at the level after the step (review UI-05): the rows show it with its basis.
    const xp = row === null ? null : questXp({ questId: id, xp: record.xp, requiredLevel: record.minLevel, dungeonQuest: record.dungeonQuest, playerLevel: Math.max(1, Math.floor(characterLevel)) }, input.rules).xp;
    quests.set(id, { ...base, cls: found.cls, outside: found.outside, mark, row, reason: found.reason, needs: found.needs, codes: found.codes, xp });
  }
  // Log quests the character's race and class do not open (a declared log, an assumed one) are in the log all the same.
  for (const id of [...state.questLog.keys()].sort((a, b) => a - b)) if (!quests.has(id)) addLogEntry(id, dataset.quest(id));

  // The steps that complete the log quests' open objectives (outline numbers).
  const completed = completingSteps(input.records, input.stepIndex + 1, open);
  for (const [id, step] of completed) {
    const entry = quests.get(id);
    if (entry !== undefined && entry.turnIn !== null) quests.set(id, { ...entry, turnIn: { ...entry.turnIn, completedBy: step } });
  }

  // Unchanged entries keep the previous model's objects.
  const previous = input.previous ?? null;
  if (previous !== null) {
    for (const [id, entry] of quests) {
      const old = previous.quests.get(id);
      if (old !== undefined && sameEntry(old, entry)) quests.set(id, old);
    }
  }
  const entries = [...quests.values()].sort((a, b) => a.questId - b.questId);
  const classes = zeroes(QUEST_CLASSES);
  const outside = zeroes(OUTSIDE_REASONS);
  const rows = zeroes(QUEST_ROWS);
  let ready = 0;
  for (const entry of entries) {
    classes[entry.cls] += 1;
    if (entry.outside !== null) outside[entry.outside] += 1;
    if (entry.row !== null) rows[entry.row] += 1;
    if (entry.turnIn?.kind === 'ready') ready += 1;
  }

  // The map's inputs.
  const drawn = entries.filter((entry) => entry.row !== null && DRAWN_ROWS.has(entry.row));
  const givers = placeGroups(dataset, drawn, (record) => record.starters, '', GIVER_RANK);
  const logEntries = entries.filter((entry) => entry.cls === 'in-log');
  const turnIns = placeGroups(dataset, logEntries, (record) => record.finishers, 'turn in ', TURN_IN_RANK);
  let unknownQuests = 0;
  let noPosition = 0;
  for (const entry of logEntries) {
    const record = dataset.quest(entry.questId);
    if (record === undefined) unknownQuests += 1;
    else noPosition += record.finishers.filter((ref) => ref.kind === 'item').length;
  }
  const objectives = logObjectives(dataset, geometry, logEntries, open);
  const availableGivers = new Set<string>();
  for (const entry of entries) {
    if (entry.row !== 'available') continue;
    for (const ref of dataset.quest(entry.questId)?.starters ?? []) if (ref.kind !== 'item') availableGivers.add(`${ref.kind}:${String(ref.id)}`);
  }

  // The Available tab's groups.
  const listed = entries.filter((entry) => entry.row !== null && entry.row !== 'turn-ins').sort(byListOrder);
  const zoneGroups = new Map<string, { title: string; uiMapId: UiMapId | null; distance: number | null; ids: QuestId[] }>();
  const soon: QuestId[] = [];
  const low: QuestId[] = [];
  for (const entry of listed) {
    if (entry.row === 'unlocks-soon') {
      soon.push(entry.questId);
      continue;
    }
    if (entry.row === 'low-level') {
      low.push(entry.questId);
      continue;
    }
    const place = giverPlace(dataset, dataset.quest(entry.questId), state.location);
    const key = place === null ? 'no-giver' : `zone:${String(place.uiMapId ?? 'none')}`;
    const group = zoneGroups.get(key) ?? {
      title: place === null ? 'No giver on the map' : ((place.uiMapId === null ? undefined : input.spans.get(place.uiMapId)?.name) ?? zoneNameOf(dataset, place.uiMapId)),
      uiMapId: place?.uiMapId ?? null,
      distance: null,
      ids: [],
    };
    const distance = place?.distance ?? null;
    if (distance !== null && (group.distance === null || distance < group.distance)) group.distance = distance;
    group.ids.push(entry.questId);
    zoneGroups.set(key, group);
  }
  const groups: AvailableGroup[] = [...zoneGroups.entries()]
    .sort(([ka, a], [kb, b]) => {
      if ((ka === 'no-giver') !== (kb === 'no-giver')) return ka === 'no-giver' ? 1 : -1;
      return (a.distance ?? Infinity) - (b.distance ?? Infinity) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0) || (a.uiMapId ?? 0) - (b.uiMapId ?? 0);
    })
    .map(([key, group]) => {
      const span = group.uiMapId === null ? null : (input.spans.get(group.uiMapId) ?? null);
      return {
        key,
        kind: key === 'no-giver' ? 'no-giver' : 'zone',
        title: group.title,
        uiMapId: group.uiMapId,
        span,
        rating: span === null ? null : zoneRating(span, characterLevel, lowerBound, rules),
        distance: group.distance,
        questIds: group.ids,
      };
    });
  if (soon.length > 0) groups.push({ key: 'unlocks-soon', kind: 'unlocks-soon', title: 'Unlocks soon', uiMapId: null, span: null, rating: null, distance: null, questIds: soon });
  if (low.length > 0) groups.push({ key: 'low-level', kind: 'low-level', title: 'Low level', uiMapId: null, span: null, rating: null, distance: null, questIds: low });

  let focused: { readonly key: string; readonly input: SpawnLayerInput } | null = null;
  const giversOf = (ids: readonly QuestId[]): SpawnLayerInput => {
    const extra = [...new Set(ids)]
      .sort((a, b) => a - b)
      .flatMap((id) => {
        const entry = quests.get(id);
        return entry === undefined || entry.cls === 'in-log' || entry.cls === 'done' || (entry.row !== null && DRAWN_ROWS.has(entry.row)) ? [] : [entry];
      });
    const key = extra.map((entry) => String(entry.questId)).join(',');
    if (focused?.key !== key) focused = { key, input: { groups: placeGroups(dataset, extra, (record) => record.starters, '', GIVER_RANK).groups } };
    return focused.input;
  };

  const giversInput: SpawnLayerInput = { groups: givers.groups };
  let shownRows: { readonly key: string; readonly input: SpawnLayerInput } | null = null;
  let withFocused: { readonly extra: SpawnLayerInput; readonly input: SpawnLayerInput } | null = null;
  const giversFor = (rowsShown: ReadonlySet<QuestRow>, ids: readonly QuestId[]): SpawnLayerInput => {
    const inRows = (entry: QuestStateEntry): boolean => entry.row !== null && entry.row !== 'turn-ins' && rowsShown.has(entry.row);
    const defaults = rowsShown.size === DRAWN_ROWS.size && [...DRAWN_ROWS].every((row) => rowsShown.has(row));
    if (defaults) {
      const extra = giversOf(ids);
      if (extra.groups.length === 0) return giversInput;
      if (withFocused?.extra !== extra) withFocused = { extra, input: { groups: [...givers.groups, ...extra.groups] } };
      return withFocused.input;
    }
    const focusedIds = new Set(ids);
    const chosen = entries.filter((entry) => entry.cls !== 'in-log' && entry.cls !== 'done' && (inRows(entry) || focusedIds.has(entry.questId)));
    const key = `${[...rowsShown].sort().join(',')}|${chosen.map((entry) => String(entry.questId)).join(',')}`;
    if (shownRows?.key !== key) shownRows = { key, input: { groups: placeGroups(dataset, chosen, (record) => record.starters, '', GIVER_RANK).groups } };
    return shownRows.input;
  };

  const capacity = rules.values.questLogCapacity.value;
  const counts: QuestStateCounts = { classes, outside, rows, availableGivers: availableGivers.size, ready, objectives: objectives.quests };
  const log = { size: state.questLog.size, capacity, full: state.questLog.size >= capacity };
  const giverNotes: GiverNotes = { itemStarted: givers.itemOnly, noStarter: givers.none, spawnlessGivers: givers.spawnlessGroups, spawnlessQuests: givers.spawnlessQuests };
  const turnInNotes: TurnInNotes = { unknownQuests, noPosition, spawnless: turnIns.spawnlessQuests };
  const who = characterName(character);
  return {
    revision: input.revision,
    stepId: input.stepId,
    stepIndex: input.stepIndex,
    who,
    level: characterLevel,
    levelLowerBound: lowerBound,
    quests,
    counts,
    log,
    groups,
    summary: summaryOf(counts, characterLevel, lowerBound),
    map: {
      givers: giversInput,
      giverNotes,
      turnIns: { groups: turnIns.groups },
      turnInNotes,
      log: objectives.input,
      notes: layerNotes(counts, who, log, giverNotes, turnInNotes),
    },
    giversOf,
    giversFor,
  };
}
