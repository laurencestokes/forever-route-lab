import { memo } from 'react';
import type { DerivedState, EditorStore } from '../../app';
import { questChainPosition } from '../../app/quest-chains';
import { useDerivedSelector, useEditor } from '../../app/react';
import { questDifficultyAt } from '../../app/shell-support';
import type { DatasetView, QuestRecord } from '../../domain/dataset';
import type { QuestId } from '../../domain/ids';
import type { ReadonlyQuestLogEntry } from '../../engine/types';
import { type RouteView } from '../app-model';
import { objectiveText } from './detail-text';
import {
  describeDifficulty,
  EmptyState,
  foreverProvenanceOf,
  formatInteger,
  PanelSection,
  QuestGrid,
  QuestListItem,
  type QuestMarkState,
  QuestObjectiveRow,
  type QuestRowAction,
} from '../kit';
import { noResultsReason, questLogCountOf, questLogWhere, questLogWords, sameQuestLogCount } from './derived-view';
import type { QuestActions } from './QuestDetails';
import { selectCharacter } from './selectors';

/** A log quest's turn-in state (map-presentation.md §7.5): never ready while its record or its progress is unknown. */
export type LogQuestState = 'ready' | 'in-progress' | 'record-unknown';

/**
 * The same rule as the quest-state model's `turnInOf` (src/app/quest-state.ts, in the lazy derived
 * pipeline, so not imported here): ready when every objective is done; in progress when an accept of
 * the route put it in the log; otherwise its progress is unknown.
 */
export function logQuestState(entry: ReadonlyQuestLogEntry, record: QuestRecord | undefined): LogQuestState {
  const done = entry.objectives.filter((objective) => objective === 'done').length;
  if (record === undefined) return 'record-unknown';
  if (done === entry.objectives.length) return 'ready';
  return entry.routeAccepted ? 'in-progress' : 'record-unknown';
}

const STATE_WORDS: Readonly<Record<LogQuestState, string>> = {
  ready: 'Ready to turn in',
  'in-progress': 'In progress',
  'record-unknown': 'Its progress before the route is unknown: never shown as ready',
};

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

const selectSelected = (s: DerivedState | null) => s?.selected ?? null;
const selectWhy = (s: DerivedState | null): string => {
  if (s === null || s.results === null) return noResultsReason(s);
  // With no step selected the log is the last step's (D-050 item 2), so only an empty route has none.
  return s.selected === null && s.results.project.route.steps.length === 0 ? 'The route has no steps yet' : 'Working out the state after the selected step';
};

export interface QuestLogPanelProps {
  readonly store: EditorStore;
  readonly view: RouteView;
  readonly dataset: DatasetView;
  /** Objectives done, Turn in and Done here add steps after the selection; omitted: no actions. */
  readonly questActions?: QuestActions | undefined;
  /** Opens a quest in Details. */
  readonly onOpen: (id: QuestId) => void;
}

/**
 * The Quest log tab (docs/research/ui-refresh.md §5.5; a lazy part): the quests in the log after the
 * active step (the derived pipeline's `selected.after.questLog`), headed "Quest log after step 12:
 * 4 / 40" with the capacity's basis. Each quest: its "?" mark (ready, in progress with its pie, or
 * unknown), the name (opens Details), the chip, Objectives done and Turn in; each objective under it
 * with ○ or ✓ and Done here while it is open. A failed quest says so and has no Turn in. Without
 * route state it says why and lists nothing: it never claims an empty log.
 */
export const QuestLogPanel = memo(function QuestLogPanel({ store, view, dataset, questActions, onOpen }: QuestLogPanelProps) {
  const selected = useDerivedSelector(selectSelected);
  const count = useDerivedSelector(questLogCountOf, sameQuestLogCount);
  const why = useDerivedSelector(selectWhy);
  const character = useEditor(store, selectCharacter);
  const stepNumber = selected === null ? null : (view.numberOfStep.get(selected.stepId) ?? null);
  if (selected === null || stepNumber === null) {
    return (
      <PanelSection title="Quest log">
        <EmptyState title="Not checked yet">
          <p>{`${why}.`}</p>
        </EmptyState>
      </PanelSection>
    );
  }
  const words = questLogWords(count, stepNumber, character.priorHistory, why);
  const step = formatInteger(stepNumber);
  const where = questLogWhere(selected, stepNumber);
  const level = selected.after.level;
  const unavailable = questActions?.unavailable ?? null;
  const add = questActions?.add;
  const entries = [...selected.after.questLog.entries()];
  return (
    <PanelSection title={selected.atEnd ? 'Quest log at the end of the route' : `Quest log after step ${step}`} aside={<span className="frl-num" title={words.detail}>{words.text}</span>}>
      <p className="frl-app-hint">{words.detail}</p>
      {entries.length === 0 ? (
        <p className="frl-app-hint">{`No quests in the log ${where}.`}</p>
      ) : (
        <QuestGrid label={`Quest log ${where}`}>
          {entries.flatMap(([id, entry]) => {
            const record = dataset.quest(id);
            const state = logQuestState(entry, record);
            const name = record?.name ?? `Quest ${String(id)} (not in the dataset)`;
            const position = questChainPosition(dataset, id);
            const difficulty = record === undefined ? null : questDifficultyAt(level, record.level, record.minLevel);
            const questLevel = record?.level ?? null;
            const done = entry.objectives.filter((objective) => objective === 'done').length;
            const total = entry.objectives.length;
            const detail = entry.failed ? 'Failed' : state === 'in-progress' ? `${formatInteger(done)} of ${formatInteger(total)} objectives done` : STATE_WORDS[state];
            const mark: QuestMarkState = state;
            const actions: QuestRowAction[] = [];
            if (add !== undefined && !entry.failed) {
              // Named as the Available tab names Accept: "… after step 12" (fix UI-11).
              if (state !== 'ready') {
                actions.push({ key: 'complete', label: 'Objectives done', name: `Objectives done: ${name}, after step ${step}`, unavailable, onRun: () => { add(id, ['complete']); } });
              }
              actions.push({ key: 'turnin', label: 'Turn in', name: `Turn in ${name} after step ${step}`, unavailable, onRun: () => { add(id, ['turnin']); } });
            }
            const known = entry.routeAccepted && record !== undefined;
            const objectives = (record?.objectives ?? []).map((objective, index) => {
              const progress = known ? entry.objectives[index] : undefined;
              const objectiveState = progress === 'done' ? 'done' : progress === 'open' ? 'open' : 'unknown';
              return (
                <QuestObjectiveRow
                  key={`${String(id)}:${String(index)}`}
                  rowKey={`${String(id)}:${String(index)}`}
                  text={objectiveText(dataset, objective)}
                  state={objectiveState}
                  action={
                    add === undefined || objectiveState !== 'open' || entry.failed
                      ? null
                      : { key: 'here', label: 'Done here', name: `Done here: ${objectiveText(dataset, objective)} (objective ${String(index + 1)} of ${name}), after step ${step}`, unavailable, onRun: () => { add(id, ['complete'], index); } }
                  }
                />
              );
            });
            return [
              <QuestListItem
                key={String(id)}
                rowKey={String(id)}
                name={name}
                mark={{ state: mark, progress: state === 'in-progress' ? { done, total } : null }}
                level={questLevel}
                difficulty={difficulty}
                uncertain={selected.after.unknownXpEvents > 0}
                provenance={foreverProvenanceOf(record?.provenance ?? { upstreamDiff: 'era', foreverStatus: 'unknown' })}
                chain={position === null ? null : `${String(position.index)}/${String(position.length)}`}
                // Every log quest shows its chip (§5.5): its level and pips beside the "?" mark (fix UI-11).
                chip
                detail={detail}
                nameLabel={`${name}, ${lowerFirst(describeDifficulty(questLevel, difficulty, selected.after.unknownXpEvents > 0))}, ${detail}`}
                onOpen={() => {
                  onOpen(id);
                }}
                actions={actions}
              />,
              ...objectives,
            ];
          })}
        </QuestGrid>
      )}
    </PanelSection>
  );
});
