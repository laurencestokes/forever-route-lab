import { memo, useMemo } from 'react';
import type { EditorStore } from '../../app';
import { useEditor } from '../../app/react';
import { effectiveQuestLevel, questDifficultyAt, questsForCharacter } from '../../app/shell-support';
import type { DatasetView, QuestRecord } from '../../domain/dataset';
import type { QuestId } from '../../domain/ids';
import { characterName, entityName, questZoneName, sameItems } from '../app-model';
import { PanelSection, PlaceholderTag, QuestListItem, foreverProvenanceOf, plural } from '../kit';
import { selectCharacter, selectRouteQuestIds } from './selectors';

export interface AvailableQuestsProps {
  readonly store: EditorStore;
  readonly dataset: DatasetView;
  readonly search: string;
}

/** Why a quest sits in the "unknown" list (F12: unknown stays unknown, never "open"). */
export const UNREADABLE_MASK_REASON = 'Race or class unknown: the quest’s mask cannot be read';

function matches(quest: QuestRecord, needle: string): boolean {
  return needle === '' || quest.name.toLowerCase().includes(needle) || String(quest.id) === needle;
}

interface QuestListProps {
  readonly label: string;
  readonly quests: readonly QuestRecord[];
  readonly dataset: DatasetView;
  readonly startLevel: number;
  readonly inRoute: ReadonlySet<QuestId>;
  /** Extra text after the zone and starter, for every quest in this list. */
  readonly note?: string | undefined;
}

function QuestList({ label, quests, dataset, startLevel, inRoute, note }: QuestListProps) {
  return (
    <ul className="frl-app-quests" aria-label={label}>
      {quests.map((quest) => {
        const zone = questZoneName(dataset, quest);
        const starter = quest.starters[0];
        const parts = [
          note ?? null,
          zone,
          starter === undefined ? null : `from ${entityName(dataset, starter)}`,
          inRoute.has(quest.id) ? 'in the route' : null,
        ];
        const detail = parts.filter((part) => part !== null).join(' · ');
        return (
          <QuestListItem
            key={quest.id}
            name={quest.name}
            level={effectiveQuestLevel(startLevel, quest.level, quest.minLevel)}
            difficulty={questDifficultyAt(startLevel, quest.level, quest.minLevel)}
            uncertain
            provenance={foreverProvenanceOf(quest.provenance)}
            detail={detail === '' ? null : detail}
          />
        );
      })}
    </ul>
  );
}

/**
 * The Available tab: dataset quests split by race and class only (availability at a step waits
 * for simulation). Quests whose masks cannot be read are listed apart, with the reason.
 */
export const AvailableQuests = memo(function AvailableQuests({ store, dataset, search }: AvailableQuestsProps) {
  const character = useEditor(store, selectCharacter);
  const routeQuests = useEditor(store, selectRouteQuestIds, sameItems);
  const { open, closed, unknown } = useMemo(() => questsForCharacter(dataset, character), [dataset, character]);
  const inRoute = useMemo(() => new Set(routeQuests), [routeQuests]);
  const needle = search.trim().toLowerCase();
  const shown = open.filter((q) => matches(q, needle));
  const shownUnknown = unknown.filter((q) => matches(q, needle));
  const who = characterName(character);
  const start = character.startLevel;
  return (
    <PanelSection title="Quests" aside={<PlaceholderTag what="quest data" />}>
      <p className="frl-app-hint">
        {`Quests open to your ${who} by race and class. Availability at a step (level, prerequisites, quest log) arrives with simulation in Milestone 6. Difficulty is taken at the start level.`}
      </p>
      {shown.length === 0 && shownUnknown.length === 0 ? (
        <p className="frl-app-hint">{needle === '' ? 'No quests in the dataset.' : `No quests match “${search.trim()}”.`}</p>
      ) : (
        shown.length > 0 && <QuestList label="Quests" quests={shown} dataset={dataset} startLevel={start} inRoute={inRoute} />
      )}
      {shownUnknown.length > 0 && (
        <>
          <p className="frl-app-hint">{`${plural(shownUnknown.length, 'quest')} whose race or class mask cannot be read: whether they are open to ${who} is unknown.`}</p>
          <QuestList
            label="Quests with unknown availability"
            quests={shownUnknown}
            dataset={dataset}
            startLevel={start}
            inRoute={inRoute}
            note={UNREADABLE_MASK_REASON}
          />
        </>
      )}
      {closed.length > 0 && <p className="frl-app-hint">{`${plural(closed.length, 'quest')} not shown: not open to ${who}.`}</p>}
    </PanelSection>
  );
});
