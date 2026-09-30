import { memo, useCallback, useId, useMemo, useState } from 'react';
import { type DerivedState, type EditorState, type EditorStore, openQuestsInDetails } from '../../app';
import { selectQuestState } from '../../app/derived';
import { questChainPosition } from '../../app/quest-chains';
import type { AvailableGroup, QuestStateEntry, QuestStateModel } from '../../app/quest-state';
import { noStateText } from '../../app/quest-state-text';
import { useDerivedSelector, useEditor } from '../../app/react';
import { effectiveQuestLevel, questDifficultyAt, questsForCharacter, requiredLevelAbove } from '../../app/shell-support';
import type { DatasetView, QuestRecord } from '../../domain/dataset';
import type { QuestId } from '../../domain/ids';
import type { Difficulty } from '../../rules/difficulty';
import { characterName, entityName, questName, questZoneName, sameItems } from '../app-model';
import {
  AssumedMarker,
  Button,
  type Readout,
  ReadoutValue,
  readoutFromEstimate,
  DifficultyLabel,
  describeDifficulty,
  foreverProvenanceOf,
  formatInteger,
  PanelSection,
  PlaceholderTag,
  plural,
  QuestGrid,
  QuestGroupHeader,
  QuestListItem,
  type QuestMarkState,
  type QuestRowAction,
  SearchField,
  Select,
} from '../kit';
import type { QuestActions } from './QuestDetails';
import { selectCharacter, selectRouteQuestIds } from './selectors';

export interface AvailableQuestsProps {
  readonly store: EditorStore;
  readonly dataset: DatasetView;
  readonly search: string;
  /** The filter's text is the top bar's quest search (one text, two fields); omitted: the filter field is not shown. */
  readonly onSearchChange?: ((value: string) => void) | undefined;
  /** Accept on each quest (and Accept first on a locked one): the step after the selection; omitted: no actions. */
  readonly questActions?: QuestActions | undefined;
  /** Opens the custom quest editor for a new quest; omitted: no such link. */
  readonly onNewCustomQuest?: (() => void) | undefined;
}

/** Why a quest sits in the "unknown" list (F12: unknown stays unknown, never "open"). */
export const UNREADABLE_MASK_REASON = 'Race or class unknown: the quest’s mask cannot be read';

/**
 * How many quests the list renders at once. The dataset has thousands open to any character, so
 * the list shows this many with an honest count of the rest, and grows by the same step on
 * request; searching narrows it.
 */
export const AVAILABLE_PAGE_SIZE = 100;

/** The view choice of the filter row: the groups nearest first (default), one zone's group, or five-level brackets. */
const NEAR = 'near';
/** The step's words while its number is not known (no route state, or a step no longer in the route). */
const NO_STEP = 'the selected step';
const BY_LEVEL = 'level';

function matches(quest: QuestRecord, needle: string): boolean {
  return needle === '' || quest.name.toLowerCase().includes(needle) || String(quest.id) === needle;
}

/** "1/2" for a quest in a chain (the name says "part 1 of 2"), else null. */
function chainOf(dataset: DatasetView, id: QuestId): { readonly short: string; readonly words: string } | null {
  const position = questChainPosition(dataset, id);
  return position === null ? null : { short: `${String(position.index)}/${String(position.length)}`, words: `, part ${String(position.index)} of ${String(position.length)}` };
}

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);
const upperFirst = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Each quest's first accept step number in the route, as "quest:number" items: compared by items, so typing a note re-renders nothing (QA-05). */
const selectAcceptSteps = (s: EditorState): readonly string[] => {
  const seen = new Set<QuestId>();
  const out: string[] = [];
  s.project.route.steps.forEach((step, index) => {
    if (step.kind !== 'accept' || seen.has(step.questId)) return;
    seen.add(step.questId);
    out.push(`${String(step.questId)}:${String(index + 1)}`);
  });
  return out;
};

/** Where Accept puts a step with nothing selected: at the end of the route (UI-08). */
const selectNothingSelected = (s: EditorState): boolean => s.selection.stepIds.size === 0 && s.selection.focus === null;

/** A quest row's spoken name: the name, its chain part, the difficulty, its XP with its basis, and line 2's words. */
function rowName(name: string, chain: { readonly words: string } | null, level: number | null, difficulty: Difficulty | null, uncertain: boolean, detail: string | null, xp: string | null = null): string {
  return `${name}${chain?.words ?? ''}, ${lowerFirst(describeDifficulty(level, difficulty, uncertain))}${xp === null ? '' : `, ${xp}`}${detail === null ? '' : `, ${detail}`}`;
}

/** Why a quest's XP is unknown here: the dataset has no XP value for it, or its level is unknown. */
const XP_UNKNOWN = 'No XP value for this quest in the dataset';

/** "+630 XP" on line 2; spoken "630 XP". */
const xpShort = (value: number): string => `+${formatInteger(value)} XP`;
const xpLong = (value: number): string => `${formatInteger(value)} XP`;

/** The XP's words for the row's name (§9.1): "630 XP (depends on assumptions)", "at most 630 XP", "XP unknown". */
function xpWords(readout: Readout<number>): string {
  if (readout.value === null) return 'XP unknown';
  const bound = readout.upperBound ? 'at most ' : readout.lowerBound ? 'at least ' : '';
  const flags = [readout.assumed ? 'depends on assumptions' : null, readout.eraFallback ? 'uses Era values' : null].filter((flag) => flag !== null);
  return `${bound}${xpLong(readout.value)}${flags.length === 0 ? '' : ` (${flags.join(', ')})`}`;
}

/** The states whose mark takes the difficulty colour: the chip, with its pips, stands beside them. */
const COLOURED: ReadonlySet<QuestMarkState> = new Set<QuestMarkState>(['available', 'uncertain', 'low-level', 'ready']);

interface RowCommon {
  readonly dataset: DatasetView;
  readonly inRoute: boolean;
  readonly onOpen: (id: QuestId) => void;
  /** Accepts a quest after the selection, or undefined without actions. */
  readonly onAccept: ((id: QuestId) => void) | undefined;
  /** Why accepting cannot run now (editing locked), or null. */
  readonly unavailable: string | null;
  /** The active step's number as text ("12"), or "the selected step". */
  readonly step: string;
  /** Where Accept puts the step, in words: "after step 12", "after the selection", or "at the end of the route" with nothing selected (UI-08). */
  readonly where: string;
}

function acceptAction(id: QuestId, name: string, where: string, onAccept: (id: QuestId) => void, unavailable: string | null): QuestRowAction {
  return {
    key: 'accept',
    label: 'Accept',
    name: `Accept ${name} ${where}`,
    unavailable,
    onRun: () => {
      onAccept(id);
    },
  };
}

interface StateRowProps extends RowCommon {
  readonly entry: QuestStateEntry;
  /** The character's level after the step is a lower bound (the chip's dashed edge). */
  readonly lowerBound: boolean;
  /** Extra words after the reason ("level after step 12: 14"), or null. */
  readonly extra: string | null;
  /** A locked quest's prerequisite that Accept first adds (the first the route does not already take), or null for none. */
  readonly firstId?: QuestId | null | undefined;
  /** Why Accept first cannot add it (the route accepts it later, or it is already in the log), or null when it can (QA-05). */
  readonly firstBlocked?: string | null | undefined;
}

/**
 * What a locked quest's Accept first adds (review QA-05): its first prerequisite that the route does
 * not accept anywhere and that is neither in the log nor done after the step, so it never inserts a
 * second accept (VAL001); when every prerequisite is taken already, the first one, with the reason
 * the button is unavailable.
 */
export function acceptFirstOf(
  needs: readonly QuestId[],
  model: Pick<QuestStateModel, 'quests'>,
  acceptAt: ReadonlyMap<QuestId, number>,
  step: string,
  nameOf: (id: QuestId) => string,
): { readonly id: QuestId | null; readonly blocked: string | null } {
  const [first] = needs;
  if (first === undefined) return { id: null, blocked: null };
  const takeable = (id: QuestId): boolean => {
    const cls = model.quests.get(id)?.cls;
    return !acceptAt.has(id) && cls !== 'in-log' && cls !== 'done';
  };
  const free = needs.find(takeable);
  if (free !== undefined) return { id: free, blocked: null };
  const name = nameOf(first);
  const cls = model.quests.get(first)?.cls;
  const at = acceptAt.get(first);
  const blocked =
    cls === 'in-log'
      ? `${name} is already in the quest log after step ${step}: complete it and turn it in first`
      : cls === 'done'
        ? `${name} is already done after step ${step}`
        : `${name} is already accepted at step ${at === undefined ? '?' : formatInteger(at)}: move that step before step ${step} instead of accepting it twice`;
  return { id: first, blocked };
}

/** One quest with its state (ui-refresh.md §5.4). The pipeline keeps an unchanged entry's object, so a new step re-renders only the rows that changed. */
const StateRow = memo(function StateRow({ entry, dataset, lowerBound, extra, inRoute, onOpen, onAccept, unavailable, where, firstId = null, firstBlocked = null }: StateRowProps) {
  const record = dataset.quest(entry.questId);
  const starter = record?.starters[0];
  // A done quest (found by the search) has no mark and nothing to take.
  const state = entry.mark as QuestMarkState | null;
  const chain = chainOf(dataset, entry.questId);
  const name = entry.name;
  const giver = starter === undefined ? null : entityName(dataset, starter);
  const locked = state === 'locked';
  const plain = state === 'available' || state === 'low-level';
  const coloured = state !== null && COLOURED.has(state);
  const detail = [plain ? giver : entry.reason, extra, inRoute ? 'in the route' : null].filter((part) => part !== null).join(' · ');
  // The prerequisite named first is the one Accept first adds (QA-05); the others are "and n more".
  const first = firstId ?? entry.needs[0];
  const firstName = first === undefined ? null : questName(dataset, first);
  const others = entry.needs.filter((id) => id !== first);
  const needs =
    locked && first !== undefined && firstName !== null
      ? {
          text: firstName,
          name: `Needs ${firstName}: show it in Details`,
          more: others.length,
          moreTitle: others.length === 0 ? null : others.map((id) => questName(dataset, id)).join(', '),
          onOpen: () => {
            onOpen(first);
          },
          acceptFirst:
            onAccept === undefined
              ? null
              : {
                  key: 'first',
                  label: 'Accept first',
                  name: `Accept first: ${firstName}, the prerequisite of ${name}`,
                  unavailable: unavailable ?? firstBlocked,
                  onRun: () => {
                    onAccept(first);
                  },
                },
        }
      : null;
  const takeable = state === 'available' || state === 'uncertain' || state === 'low-level';
  const actions = onAccept !== undefined && takeable ? [acceptAction(entry.questId, name, where, onAccept, unavailable)] : [];
  // The quest's XP at the level after the step, with its basis (§5.4; UI-05). A lower-bound level makes it an upper bound.
  const xp = entry.xp === undefined || entry.xp === null || needs !== null ? null : readoutFromEstimate(entry.xp, XP_UNKNOWN, { upperBound: lowerBound });
  return (
    <QuestListItem
      rowKey={String(entry.questId)}
      name={name}
      mark={state === null ? null : { state, unlockLevel: entry.requiredLevel, dungeonQuest: entry.dungeonQuest }}
      level={entry.level}
      difficulty={entry.difficulty}
      uncertain={lowerBound}
      provenance={foreverProvenanceOf(record?.provenance ?? { upstreamDiff: 'era', foreverStatus: 'unknown' })}
      chain={chain?.short ?? null}
      chip={coloured}
      xp={xp === null ? null : <ReadoutValue readout={xp} format={xpShort} formatLong={xpLong} compactMarkers />}
      detail={detail === '' ? null : detail}
      nameLabel={rowName(name, chain, entry.level, entry.difficulty, lowerBound, locked && firstName !== null ? `needs ${firstName}` : detail === '' ? null : detail, xp === null ? null : xpWords(xp))}
      onOpen={() => {
        onOpen(entry.questId);
      }}
      needs={needs}
      actions={actions}
    />
  );
});

interface OpenRowProps extends RowCommon {
  readonly quest: QuestRecord;
  readonly startLevel: number;
  /** Extra text before the zone and starter (the unreadable-mask reason). */
  readonly note: string | undefined;
}

/**
 * One quest open by race and class, without route state: its availability at a step is not known,
 * so it is drawn "may be" (the dashed ring), with difficulty at the start level (a lower bound).
 */
const OpenRow = memo(function OpenRow({ quest, dataset, startLevel, inRoute, note, onOpen, onAccept, unavailable, where }: OpenRowProps) {
  const zone = questZoneName(dataset, quest);
  const starter = quest.starters[0];
  const required = requiredLevelAbove(quest, startLevel);
  const detail = [note ?? null, required === null ? null : `requires ${String(required)}`, zone, starter === undefined ? null : `from ${entityName(dataset, starter)}`, inRoute ? 'in the route' : null]
    .filter((part) => part !== null)
    .join(' · ');
  const level = effectiveQuestLevel(startLevel, quest.level, quest.minLevel);
  const difficulty = questDifficultyAt(startLevel, quest.level, quest.minLevel);
  const chain = chainOf(dataset, quest.id);
  return (
    <QuestListItem
      rowKey={String(quest.id)}
      name={quest.name}
      mark={{ state: 'uncertain' }}
      level={level}
      difficulty={difficulty}
      uncertain
      provenance={foreverProvenanceOf(quest.provenance)}
      chain={chain?.short ?? null}
      detail={detail === '' ? null : detail}
      nameLabel={rowName(quest.name, chain, level, difficulty, true, detail === '' ? null : detail)}
      onOpen={() => {
        onOpen(quest.id);
      }}
      actions={onAccept === undefined ? [] : [acceptAction(quest.id, quest.name, where, onAccept, unavailable)]}
    />
  );
});

/** "Showing 100 of 2,143 quests open to Orc Warrior." and its search variant. */
export function shownText(shown: number, total: number, who: string, searching: boolean): string {
  const what = searching ? `matching ${total === 1 ? 'quest' : 'quests'}` : `${total === 1 ? 'quest' : 'quests'} open to ${who}`;
  return shown >= total
    ? `${formatInteger(total)} ${what}.`
    : `Showing ${formatInteger(shown)} of ${formatInteger(total)} ${what}, by level (or required level, when higher) and then id.`;
}

function MoreButton({ left, onMore }: { readonly left: number; readonly onMore: () => void }) {
  return left <= 0 ? null : (
    <div className="frl-app-actions">
      <Button size="sm" onClick={onMore}>
        {`Show ${formatInteger(Math.min(AVAILABLE_PAGE_SIZE, left))} more`}
      </Button>
    </div>
  );
}

interface OpenQuestPagesProps extends Omit<RowCommon, 'inRoute'> {
  readonly quests: readonly QuestRecord[];
  readonly unknown: readonly QuestRecord[];
  readonly startLevel: number;
  readonly inRoute: ReadonlySet<QuestId>;
  readonly who: string;
  readonly searching: boolean;
}

/**
 * The open quests matching one search, a page at a time, then those whose masks cannot be read.
 * Its parent keys it on the search, so the page count starts over whenever the search changes.
 */
function OpenQuestPages({ quests, unknown, startLevel, inRoute, who, searching, ...common }: OpenQuestPagesProps) {
  const [limit, setLimit] = useState(AVAILABLE_PAGE_SIZE);
  const shown = useMemo(() => quests.slice(0, limit), [quests, limit]);
  const shownUnknown = unknown.slice(0, AVAILABLE_PAGE_SIZE);
  return (
    <>
      {unknown.length > 0 && <p className="frl-app-hint">{`${plural(unknown.length, 'quest')} whose race or class mask cannot be read: whether they are open to ${who} is unknown.`}</p>}
      {(quests.length > AVAILABLE_PAGE_SIZE || searching) && (
        <p className="frl-app-hint">
          {shownText(shown.length, quests.length, who, searching)}
          {quests.length > shown.length && !searching ? ' Search by name or quest id to find others.' : ''}
        </p>
      )}
      <QuestGrid label="Quests">
        {shown.map((quest) => (
          <OpenRow key={quest.id} quest={quest} startLevel={startLevel} inRoute={inRoute.has(quest.id)} note={undefined} {...common} />
        ))}
        {shownUnknown.length > 0 && (
          <QuestGroupHeader gridKey="group:unknown" title="Unknown availability" count={formatInteger(unknown.length)} words={`Race or class unknown, ${plural(unknown.length, 'quest')}`} />
        )}
        {shownUnknown.map((quest) => (
          <OpenRow key={quest.id} quest={quest} startLevel={startLevel} inRoute={inRoute.has(quest.id)} note={UNREADABLE_MASK_REASON} {...common} />
        ))}
      </QuestGrid>
      <MoreButton
        left={quests.length - shown.length}
        onMore={() => {
          setLimit((current) => current + AVAILABLE_PAGE_SIZE);
        }}
      />
      {unknown.length > shownUnknown.length && <p className="frl-app-hint">{`${plural(unknown.length - shownUnknown.length, 'more quest')} with unknown availability not shown.`}</p>}
    </>
  );
}

// =============================================================================================
// With route state: the quests after the active step (map-presentation.md §7.2, §14.4; step MP.3)

/** The search's groups: the lists' matches in their groups, then every other match (in the log, done, outside the windows) with its state in words. */
function searchGroups(model: QuestStateModel, needle: string, step: string): readonly AvailableGroup[] {
  const hit = (id: QuestId): boolean => {
    const entry = model.quests.get(id);
    return entry !== undefined && (entry.name.toLowerCase().includes(needle) || String(id) === needle);
  };
  const listed = model.groups.map((group) => ({ ...group, questIds: group.questIds.filter(hit) })).filter((group) => group.questIds.length > 0);
  const others = [...model.quests.values()].filter((entry) => (entry.row === null || entry.row === 'turn-ins') && hit(entry.questId)).map((entry) => entry.questId);
  if (others.length === 0) return listed;
  return [...listed, { key: 'others', kind: 'zone', title: `In the log, done or not available after step ${step}`, uiMapId: null, span: null, rating: null, distance: null, questIds: others }];
}

/** Five-level brackets (ui-refresh.md §5.3's "Group by: Level"): the listed quests by level, lowest first; an unknown level last. */
function levelGroups(model: QuestStateModel): readonly AvailableGroup[] {
  const brackets = new Map<number, QuestId[]>();
  for (const group of model.groups) {
    for (const id of group.questIds) {
      const level = model.quests.get(id)?.level ?? null;
      const bracket = level === null ? Number.POSITIVE_INFINITY : Math.floor((Math.max(1, level) - 1) / 5);
      const list = brackets.get(bracket) ?? [];
      list.push(id);
      brackets.set(bracket, list);
    }
  }
  return [...brackets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bracket, questIds]) => ({
      key: `level:${String(bracket)}`,
      kind: 'zone' as const,
      title: Number.isFinite(bracket) ? `Levels ${String(bracket * 5 + 1)}-${String(bracket * 5 + 5)}` : 'Level unknown',
      uiMapId: null,
      span: null,
      rating: null,
      distance: null,
      questIds,
    }));
}

interface StateQuestsProps extends Omit<RowCommon, 'inRoute'> {
  readonly model: QuestStateModel;
  readonly needle: string;
  /** The filter row's view: near (the model's groups), a zone's key, or by level. */
  readonly groupBy: string;
  readonly inRoute: ReadonlySet<QuestId>;
  /** Each quest's first accept step number in the route (Accept first never adds a second, QA-05). */
  readonly acceptAt: ReadonlyMap<QuestId, number>;
}

/** The median chip's words: "median quest level 9, Impossible (red)". */
const medianWords = (level: number, difficulty: Difficulty | null, lowerBound: boolean): string => `median ${lowerFirst(describeDifficulty(level, difficulty, lowerBound))}`;

/**
 * A zone heading's spoken words (review UI-13): its name, its span with what the count in brackets
 * counts, the median chip in words ("median quest level 9, Impossible (red), at the level after
 * step 12"), and how many quests are listed under it.
 */
export function groupHeadingWords(group: AvailableGroup, step: string): string {
  const parts = [group.title];
  if (group.span !== null) {
    const detail = group.span.detail.startsWith(`${group.span.name}: `) ? group.span.detail.slice(group.span.name.length + 2) : group.span.detail;
    parts.push(detail);
  }
  if (group.rating !== null) parts.push(`${medianWords(group.rating.level, group.rating.difficulty, group.rating.lowerBound)}, at the level after step ${step}`);
  parts.push(`${plural(group.questIds.length, 'quest')} listed`);
  return parts.join(', ');
}

/** The groups of one model and search as one grid, a page at a time (its parent keys it on the search). */
function StateQuests({ model, needle, groupBy, inRoute, acceptAt, ...common }: StateQuestsProps) {
  const [limit, setLimit] = useState(AVAILABLE_PAGE_SIZE);
  const groups = useMemo(() => {
    if (needle !== '') return searchGroups(model, needle, common.step);
    if (groupBy === BY_LEVEL) return levelGroups(model);
    if (groupBy === NEAR) return model.groups;
    return model.groups.filter((group) => group.key === groupBy);
  }, [model, needle, groupBy, common.step]);
  const total = groups.reduce((sum, group) => sum + group.questIds.length, 0);
  const pages: { readonly group: AvailableGroup; readonly ids: readonly QuestId[] }[] = [];
  for (let i = 0, shown = 0; i < groups.length && shown < limit; i += 1) {
    const group = groups[i];
    if (group === undefined) continue;
    const ids = group.questIds.slice(0, limit - shown);
    shown += ids.length;
    if (ids.length > 0) pages.push({ group, ids });
  }
  const levelAfter = `level after step ${common.step}: ${model.levelLowerBound ? 'at least ' : ''}${String(model.level)}`;
  if (total === 0) return <p className="frl-app-hint">{needle === '' ? `No quests to list after step ${common.step}.` : `No quests match “${needle}”.`}</p>;
  return (
    <>
      <QuestGrid label={`Quests after step ${common.step}`}>
        {pages.map(({ group, ids }) => [
          <QuestGroupHeader
            key={`h:${group.key}`}
            gridKey={`group:${group.key}`}
            title={group.title}
            count={formatInteger(group.questIds.length)}
            countTitle={`${plural(group.questIds.length, 'quest')} listed here`}
            words={groupHeadingWords(group, common.step)}
            aside={
              group.span === null && group.rating === null ? undefined : (
                <>
                  {group.span !== null && (
                    <span title={group.span.detail}>
                      {group.span.text}
                      {group.span.low !== null && <AssumedMarker reason="era-fallback" />}
                    </span>
                  )}
                  {group.rating !== null && (
                    <DifficultyLabel
                      level={group.rating.level}
                      difficulty={group.rating.difficulty}
                      uncertain={group.rating.lowerBound}
                      description={`${upperFirst(medianWords(group.rating.level, group.rating.difficulty, group.rating.lowerBound))}, at the level after step ${common.step}`}
                    />
                  )}
                </>
              )
            }
          />,
          ...ids.map((id) => {
            const entry = model.quests.get(id);
            if (entry === undefined) return null;
            const first = entry.mark === 'locked' ? acceptFirstOf(entry.needs, model, acceptAt, common.step, (quest) => questName(common.dataset, quest)) : null;
            return (
              <StateRow
                key={id}
                entry={entry}
                lowerBound={model.levelLowerBound}
                extra={entry.row === 'unlocks-soon' ? levelAfter : null}
                inRoute={inRoute.has(id)}
                firstId={first?.id ?? null}
                firstBlocked={first?.blocked ?? null}
                {...common}
              />
            );
          }),
        ])}
      </QuestGrid>
      <MoreButton
        left={total - limit}
        onMore={() => {
          setLimit((current) => current + AVAILABLE_PAGE_SIZE);
        }}
      />
    </>
  );
}

/** Why there is no route state yet, for the fallback's hint (null outside a derived store: component tests). */
const selectNoStateWhy = (s: DerivedState | null): string | null => {
  if (s === null) return null;
  if (s.status === 'loading') return 'the route is still being simulated';
  if (s.status === 'failed') return 'the route could not be simulated';
  return s.selected === null ? 'select a step to see which quests are available after it' : 'working out the quests after the selected step';
};

/**
 * The Available tab (map-presentation.md §14.4; MP.3 owns its content, ui-refresh.md §5.4 its look
 * and keys, UR.6): a filter row (the quest search's text, and "Near step 12", one zone or "By
 * level"), a summary line with New custom quest, then the quests as one layout grid whose group
 * headings take focus. With route state: the quests after the active step by the relevance windows
 * of §7.2, each with its mark and reason, grouped by the zone of its nearest giver (nearest first),
 * then Unlocks soon and Low level; a locked quest shows "Needs <prerequisite>" and Accept first; the
 * search finds any quest, with its state in words. Without route state (loading, failed, no active
 * step, or no derived store): the dataset quests split by race and class only, each "may be", and it
 * says so. Long lists are capped (AVAILABLE_PAGE_SIZE) with the count of the rest.
 */
export const AvailableQuests = memo(function AvailableQuests({ store, dataset, search, onSearchChange, questActions, onNewCustomQuest }: AvailableQuestsProps) {
  const model = useDerivedSelector(selectQuestState);
  const noStateWhy = useDerivedSelector(selectNoStateWhy);
  const hintId = useId();
  const [groupBy, setGroupBy] = useState(NEAR);
  // The active step's number now: a number, so typing in a note does not re-render the list (F13).
  const stepId = model?.stepId ?? null;
  const selectStepIndex = useCallback((s: EditorState) => (stepId === null ? -1 : s.project.route.steps.findIndex((step) => step.id === stepId)), [stepId]);
  const stepIndex = useEditor(store, selectStepIndex);
  const character = useEditor(store, selectCharacter);
  const routeQuests = useEditor(store, selectRouteQuestIds, sameItems);
  const acceptSteps = useEditor(store, selectAcceptSteps, sameItems);
  const nothingSelected = useEditor(store, selectNothingSelected);
  const acceptAt = useMemo(
    () =>
      new Map(
        acceptSteps.map((item) => {
          const [quest = '0', at = '0'] = item.split(':');
          return [Number(quest) as QuestId, Number(at)] as const;
        }),
      ),
    [acceptSteps],
  );
  const { open, closed, unknown } = useMemo(() => questsForCharacter(dataset, character), [dataset, character]);
  const inRoute = useMemo(() => new Set(routeQuests), [routeQuests]);
  const needle = search.trim().toLowerCase();
  const matching = useMemo(() => open.filter((q) => matches(q, needle)), [open, needle]);
  const matchingUnknown = useMemo(() => unknown.filter((q) => matches(q, needle)), [unknown, needle]);
  const who = characterName(character);
  const placeholder = dataset.identity.dataRevision === 'placeholder';
  const searching = needle !== '';
  // Opening a quest shows it in Details and puts it in focus on the map (its givers, objectives
  // and turn-ins): the keyboard path to what a click on a map marker does.
  const onOpen = useCallback(
    (id: QuestId) => {
      openQuestsInDetails(store, [id]);
    },
    [store],
  );
  // Accepting is a no-op while editing is locked; the button stays in the grid, aria-disabled with the reason.
  const add = questActions?.add;
  const unavailable = questActions?.unavailable ?? null;
  const onAccept = useMemo(
    () =>
      add === undefined
        ? undefined
        : (id: QuestId) => {
            if (unavailable === null) add(id, ['accept']);
          },
    [add, unavailable],
  );
  const step = model === null || stepIndex < 0 ? NO_STEP : formatInteger(stepIndex + 1);
  const where = step !== NO_STEP ? `after step ${step}` : nothingSelected ? 'at the end of the route' : 'after the selection';
  const hint =
    model !== null
      ? `After step ${step}, ${model.summary} Accept adds the quest’s accept step after the selection, at the spawn nearest the step before it; Details adds all three steps.`
      : noStateWhy === null
        ? `Quests open to your ${who} by race and class. This list does not check availability at a step (level, prerequisites, quest log): the Validation tab checks each accept in the route. Difficulty here is taken at the start level.`
        : `${noStateText(who)}: ${noStateWhy}. Until then this list does not check availability (level, prerequisites, quest log), and difficulty is taken at the start level.`;
  const zoneGroups = model?.groups.filter((group) => group.kind === 'zone' && group.uiMapId !== null) ?? [];
  const viewOptions = [
    { value: NEAR, label: model === null ? 'All quests' : `Near step ${step}` },
    ...zoneGroups.map((group) => ({ value: group.key, label: group.title })),
    ...(model === null ? [] : [{ value: BY_LEVEL, label: 'By level' }]),
  ];
  const view = viewOptions.some((option) => option.value === groupBy) ? groupBy : NEAR;
  const common = { dataset, onOpen, onAccept, unavailable, step, where };
  const count = model === null ? `${formatInteger(open.length)} open to your ${who}` : `${formatInteger(model.counts.rows.available)} available after step ${step}`;

  return (
    <PanelSection title="Quests" aside={placeholder ? <PlaceholderTag what="quest data" /> : undefined}>
      <div className="frl-available__filters">
        {onSearchChange !== undefined && (
          <SearchField label="Filter quests by name or id" placeholder="Filter by name or id" value={search} onChange={onSearchChange} describedBy={hintId} size="sm" className="frl-available__search" />
        )}
        <Select label="Show" hideLabel size="sm" className="frl-available__view" value={view} options={viewOptions} onChange={setGroupBy} />
      </div>
      {/* The filter's description; without route state it is also the tab's explanation, shown. */}
      <p id={hintId} className="frl-app-hint" hidden={model !== null}>
        {hint}
      </p>
      <div className="frl-available__summary">
        <span className="frl-num">{count}</span>
        {onNewCustomQuest !== undefined && (
          <Button size="sm" variant="link" onClick={onNewCustomQuest} data-focus-key="custom-quest:new">
            New custom quest
          </Button>
        )}
      </div>
      {model !== null && model.log.full && (
        <p className="frl-app-hint">{`The quest log is full after step ${step} (${formatInteger(model.log.size)} of ${formatInteger(model.log.capacity)}): nothing can be accepted until a quest is turned in.`}</p>
      )}
      {model !== null ? (
        <StateQuests key={`${needle}|${view}`} model={model} needle={needle} groupBy={view} inRoute={inRoute} acceptAt={acceptAt} {...common} />
      ) : matching.length === 0 && matchingUnknown.length === 0 ? (
        <p className="frl-app-hint">{searching ? `No quests match “${search.trim()}”.` : 'No quests in the dataset.'}</p>
      ) : (
        <>
          <OpenQuestPages key={needle} quests={matching} unknown={matchingUnknown} startLevel={character.startLevel} inRoute={inRoute} who={who} searching={searching} {...common} />
        </>
      )}
      {model === null && closed.length > 0 && <p className="frl-app-hint">{`${plural(closed.length, 'quest')} not shown: not open to ${who}.`}</p>}
    </PanelSection>
  );
});
