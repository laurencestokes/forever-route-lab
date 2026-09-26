import { memo, useCallback, useMemo, useState } from 'react';
import { type EditorStore, openQuestsInDetails } from '../../app';
import { useEditor } from '../../app/react';
import { effectiveQuestLevel, questDifficultyAt, questsForCharacter, requiredLevelAbove } from '../../app/shell-support';
import type { DatasetView, QuestRecord } from '../../domain/dataset';
import type { QuestId } from '../../domain/ids';
import { characterName, entityName, questTitle, questZoneName, sameItems } from '../app-model';
import { Button, PanelSection, PlaceholderTag, QuestListItem, foreverProvenanceOf, formatInteger, plural } from '../kit';
import type { QuestActions } from './QuestDetails';
import { selectCharacter, selectRouteQuestIds } from './selectors';

export interface AvailableQuestsProps {
  readonly store: EditorStore;
  readonly dataset: DatasetView;
  readonly search: string;
  /** "Add to route" on each quest (accept, complete and turn in after the selection); omitted: no add. */
  readonly questActions?: QuestActions | undefined;
  /** Opens the custom quest editor for a new quest; omitted: no such button. */
  readonly onNewCustomQuest?: (() => void) | undefined;
}

/** The Available rows' add button: all three steps of the quest, after the selection. */
export const ADD_QUEST_LABEL = 'Add accept, complete and turn in after the selection';

/** Why a quest sits in the "unknown" list (F12: unknown stays unknown, never "open"). */
export const UNREADABLE_MASK_REASON = 'Race or class unknown: the quest’s mask cannot be read';

/**
 * How many quests the list renders at once. The dataset has thousands open to any character, so
 * the list shows this many (by level, then id) with an honest count of the rest, and grows by the
 * same step on request; searching narrows it.
 */
export const AVAILABLE_PAGE_SIZE = 100;

function matches(quest: QuestRecord, needle: string): boolean {
  return needle === '' || quest.name.toLowerCase().includes(needle) || String(quest.id) === needle;
}

interface QuestRowProps {
  readonly quest: QuestRecord;
  readonly dataset: DatasetView;
  readonly startLevel: number;
  readonly inRoute: boolean;
  readonly note: string | undefined;
  readonly onOpen: (id: QuestId) => void;
  readonly onAdd: ((id: QuestId) => void) | undefined;
}

/**
 * One quest of a list. Memoised on its props (the quest record, the view, the start level and
 * two flags), so "Show more" renders only the rows it adds (M2 review code-F4). A required level
 * above the start level is stated ("requires 42"): the sort already puts such a quest with its
 * required level, and the row says why.
 */
const QuestRow = memo(function QuestRow({ quest, dataset, startLevel, inRoute, note, onOpen, onAdd }: QuestRowProps) {
  const zone = questZoneName(dataset, quest);
  const starter = quest.starters[0];
  const required = requiredLevelAbove(quest, startLevel);
  const parts = [
    note ?? null,
    required === null ? null : `requires ${String(required)}`,
    zone,
    starter === undefined ? null : `from ${entityName(dataset, starter)}`,
    inRoute ? 'in the route' : null,
  ];
  const detail = parts.filter((part) => part !== null).join(' · ');
  return (
    <QuestListItem
      name={questTitle(dataset, quest.id)}
      level={effectiveQuestLevel(startLevel, quest.level, quest.minLevel)}
      difficulty={questDifficultyAt(startLevel, quest.level, quest.minLevel)}
      uncertain
      provenance={foreverProvenanceOf(quest.provenance)}
      detail={detail === '' ? null : detail}
      onOpen={() => {
        onOpen(quest.id);
      }}
      onAdd={
        onAdd === undefined
          ? undefined
          : () => {
              onAdd(quest.id);
            }
      }
      addLabel={ADD_QUEST_LABEL}
    />
  );
});

interface QuestListProps {
  readonly label: string;
  readonly quests: readonly QuestRecord[];
  readonly dataset: DatasetView;
  readonly startLevel: number;
  readonly inRoute: ReadonlySet<QuestId>;
  /** Extra text after the zone and starter, for every quest in this list. */
  readonly note?: string | undefined;
  readonly onOpen: (id: QuestId) => void;
  readonly onAdd: ((id: QuestId) => void) | undefined;
}

function QuestList({ label, quests, dataset, startLevel, inRoute, note, onOpen, onAdd }: QuestListProps) {
  return (
    <ul className="frl-app-quests" aria-label={label}>
      {quests.map((quest) => (
        <QuestRow key={quest.id} quest={quest} dataset={dataset} startLevel={startLevel} inRoute={inRoute.has(quest.id)} note={note} onOpen={onOpen} onAdd={onAdd} />
      ))}
    </ul>
  );
}

/** "Showing 100 of 2,143 quests open to Orc Warrior." and its search variant. */
export function shownText(shown: number, total: number, who: string, searching: boolean): string {
  const what = searching ? `matching ${total === 1 ? 'quest' : 'quests'}` : `${total === 1 ? 'quest' : 'quests'} open to ${who}`;
  return shown >= total
    ? `${formatInteger(total)} ${what}.`
    : `Showing ${formatInteger(shown)} of ${formatInteger(total)} ${what}, by level (or required level, when higher) and then id.`;
}

interface OpenQuestPagesProps {
  readonly quests: readonly QuestRecord[];
  readonly dataset: DatasetView;
  readonly startLevel: number;
  readonly inRoute: ReadonlySet<QuestId>;
  readonly who: string;
  readonly searching: boolean;
  readonly onOpen: (id: QuestId) => void;
  readonly onAdd: ((id: QuestId) => void) | undefined;
}

/**
 * The open quests matching one search, a page at a time. Its parent keys it on the search, so the
 * page count starts over whenever the search changes, including back to a search shown before.
 */
function OpenQuestPages({ quests, dataset, startLevel, inRoute, who, searching, onOpen, onAdd }: OpenQuestPagesProps) {
  const [limit, setLimit] = useState(AVAILABLE_PAGE_SIZE);
  const shown = useMemo(() => quests.slice(0, limit), [quests, limit]);
  return (
    <>
      {(quests.length > AVAILABLE_PAGE_SIZE || searching) && (
        <p className="frl-app-hint">
          {shownText(shown.length, quests.length, who, searching)}
          {quests.length > shown.length && !searching ? ' Search by name or quest id to find others.' : ''}
        </p>
      )}
      <QuestList label="Quests" quests={shown} dataset={dataset} startLevel={startLevel} inRoute={inRoute} onOpen={onOpen} onAdd={onAdd} />
      {quests.length > shown.length && (
        <div className="frl-app-actions">
          <Button
            size="sm"
            onClick={() => {
              setLimit((current) => current + AVAILABLE_PAGE_SIZE);
            }}
          >
            {`Show ${formatInteger(Math.min(AVAILABLE_PAGE_SIZE, quests.length - shown.length))} more`}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * The Available tab: dataset quests split by race and class only (availability at a step waits
 * for simulation). Quests whose masks cannot be read are listed apart, with the reason. Long lists
 * are capped (AVAILABLE_PAGE_SIZE) with the count of what is not shown.
 */
export const AvailableQuests = memo(function AvailableQuests({ store, dataset, search, questActions, onNewCustomQuest }: AvailableQuestsProps) {
  const character = useEditor(store, selectCharacter);
  const routeQuests = useEditor(store, selectRouteQuestIds, sameItems);
  const { open, closed, unknown } = useMemo(() => questsForCharacter(dataset, character), [dataset, character]);
  const inRoute = useMemo(() => new Set(routeQuests), [routeQuests]);
  const needle = search.trim().toLowerCase();
  const matching = useMemo(() => open.filter((q) => matches(q, needle)), [open, needle]);
  const matchingUnknown = useMemo(() => unknown.filter((q) => matches(q, needle)), [unknown, needle]);
  const shownUnknown = matchingUnknown.slice(0, AVAILABLE_PAGE_SIZE);
  const who = characterName(character);
  const start = character.startLevel;
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
  // Adding is a no-op (and says nothing) while editing is locked; the button stays for the keyboard order.
  const add = questActions?.add;
  const addUnavailable = questActions?.unavailable ?? null;
  const onAdd = useMemo(
    () =>
      add === undefined
        ? undefined
        : (id: QuestId) => {
            if (addUnavailable === null) add(id, ['accept', 'complete', 'turnin']);
          },
    [add, addUnavailable],
  );
  return (
    <PanelSection
      title="Quests"
      aside={placeholder ? <PlaceholderTag what="quest data" /> : <span className="frl-num">{`${formatInteger(open.length)} open`}</span>}
    >
      <p className="frl-app-hint">
        {`Quests open to your ${who} by race and class. Availability at a step (level, prerequisites, quest log) arrives with simulation in Milestone 6. Difficulty is taken at the start level.`}
        {onAdd !== undefined && ' The + button adds the quest’s accept, complete and turn-in after the selection, each at the spawn nearest the step before it.'}
      </p>
      {onNewCustomQuest !== undefined && (
        <div className="frl-app-actions frl-app-actions--top">
          <Button size="sm" icon="add" onClick={onNewCustomQuest} data-focus-key="custom-quest:new">
            New custom quest
          </Button>
        </div>
      )}
      {matching.length === 0 && matchingUnknown.length === 0 ? (
        <p className="frl-app-hint">{searching ? `No quests match “${search.trim()}”.` : 'No quests in the dataset.'}</p>
      ) : (
        matching.length > 0 && (
          <OpenQuestPages
            key={needle}
            quests={matching}
            dataset={dataset}
            startLevel={start}
            inRoute={inRoute}
            who={who}
            searching={searching}
            onOpen={onOpen}
            onAdd={onAdd}
          />
        )
      )}
      {matchingUnknown.length > 0 && (
        <>
          <p className="frl-app-hint">{`${plural(matchingUnknown.length, 'quest')} whose race or class mask cannot be read: whether they are open to ${who} is unknown.`}</p>
          <QuestList
            label="Quests with unknown availability"
            quests={shownUnknown}
            dataset={dataset}
            startLevel={start}
            inRoute={inRoute}
            note={UNREADABLE_MASK_REASON}
            onOpen={onOpen}
            onAdd={onAdd}
          />
          {matchingUnknown.length > shownUnknown.length && (
            <p className="frl-app-hint">{`${plural(matchingUnknown.length - shownUnknown.length, 'more quest')} with unknown availability not shown.`}</p>
          )}
        </>
      )}
      {closed.length > 0 && <p className="frl-app-hint">{`${plural(closed.length, 'quest')} not shown: not open to ${who}.`}</p>}
    </PanelSection>
  );
});
