import { CUSTOM_SHADOWED_CODE, shadowedQuest } from '../../app/project-commands';
import { questChainPosition } from '../../app/quest-chains';
import type { QuestStepPart } from '../../app/quest-steps';
import { effectiveQuestLevel, questDifficultyAt, questOpenTo, SCALING_QUEST_LEVEL } from '../../app/shell-support';
import type { CharacterProfile } from '../../domain/project';
import type { DatasetView, QuestRecord } from '../../domain/dataset';
import type { QuestId } from '../../domain/ids';
import { characterName, entityWhereText, objectiveText, objectiveWhere, questZoneName, upstreamProvenanceText } from '../app-model';
import {
  Button,
  DetailList,
  DifficultyLabel,
  EmptyState,
  PanelSection,
  ProvenanceBadge,
  ReadoutValue,
  SeverityIcon,
  foreverProvenanceOf,
  formatInteger,
  unknownReadout,
  type DetailItem,
} from '../kit';

/**
 * What the Details tab can do with a quest: add its steps to the route (after the selection), and
 * open the custom quest editor for it. Omitted: the quest is shown without actions.
 */
export interface QuestActions {
  /** Why nothing can be added or edited (editing is locked), or null. */
  readonly unavailable: string | null;
  readonly add: (questId: QuestId, parts: readonly QuestStepPart[], objective?: number | null) => void;
  /** Edit the project's custom quest `id`, replace the dataset quest `id` with one, or create one with a missing id. */
  readonly editCustom: (edit: { readonly mode: 'edit' | 'replace' | 'new-with-id'; readonly id: QuestId }) => void;
  /** Deletes the custom quest, so the dataset record shows again. */
  readonly deleteCustom: (id: QuestId) => void;
}

export interface QuestDetailsProps {
  readonly questId: QuestId;
  readonly dataset: DatasetView;
  readonly character: CharacterProfile;
  readonly actions?: QuestActions | undefined;
  /** The project's data without its custom quests: whether a custom quest replaces a dataset quest (DATA001). */
  readonly baseDataset?: DatasetView | undefined;
}

const NO_XP = unknownReadout<number>('No XP value in the dataset');

/** The level line's hint: how the difficulty was taken, and how a scaling quest's level is found. */
function levelHint(quest: QuestRecord, startLevel: number): string {
  const scaling =
    quest.level === SCALING_QUEST_LEVEL
      ? `A scaling quest: its level follows the player's (at least its required level ${String(quest.minLevel ?? 1)}). `
      : '';
  return `${scaling}Difficulty at the character's start level (${String(startLevel)}), a lower bound for this step. Era thresholds; Forever's are unknown.`;
}

/** XP with its basis in words: Era seed values are QuestieDB's Era table, not Forever's. */
function xpText(xp: NonNullable<QuestRecord['xp']>): string {
  const basis = xp.basis === 'era-seed' ? 'Era value from QuestieDB; Forever XP is unknown' : xp.basis === 'user' ? 'entered by you' : 'observed in Forever';
  return `${formatInteger(xp.baseXp)} base XP at quest level ${String(xp.questLevel)} (${basis})`;
}

/** Starters or finishers, one per line with where they are (zone name and percent, as published). */
function Stops({ dataset, refs }: { readonly dataset: DatasetView; readonly refs: QuestRecord['starters'] }) {
  if (refs.length === 0) return <>Unknown</>;
  return (
    <ul className="frl-app-list">
      {refs.map((ref) => (
        <li key={`${ref.kind}:${String(ref.id)}`}>{entityWhereText(dataset, ref)}</li>
      ))}
    </ul>
  );
}

/** "Part 2 of 3: Your Place in the World → Cutting Teeth → Sting of the Scorpid", or null outside a chain. */
export function chainText(dataset: DatasetView, id: QuestId): string | null {
  const position = questChainPosition(dataset, id);
  if (position === null) return null;
  const names = position.quests.map((quest) => dataset.quest(quest)?.name ?? `Quest ${String(quest)}`);
  return `Part ${String(position.index)} of ${String(position.length)}: ${names.join(' → ')}`;
}

/** The buttons that add a quest's steps after the selection. */
function AddButtons({ quest, actions }: { readonly quest: QuestRecord; readonly actions: QuestActions }) {
  const off = actions.unavailable !== null;
  const add = (parts: readonly QuestStepPart[], objective: number | null = null) => () => {
    if (!off) actions.add(quest.id, parts, objective);
  };
  const props = { size: 'sm' as const, 'aria-disabled': off ? (true as const) : undefined, title: actions.unavailable ?? undefined };
  return (
    <div className="frl-app-actions" role="group" aria-label={`Add “${quest.name}” to the route after the selection`}>
      <Button {...props} icon="add" variant="primary" onClick={add(['accept', 'complete', 'turnin'])}>
        Add accept, complete and turn in
      </Button>
      <Button {...props} onClick={add(['accept'])}>
        Accept
      </Button>
      <Button {...props} onClick={add(['complete'])}>
        {quest.objectives.length > 1 ? 'Complete all objectives' : 'Complete'}
      </Button>
      <Button {...props} onClick={add(['turnin'])}>
        Turn in
      </Button>
    </div>
  );
}

/** One quest the active step acts on, or one opened in Details. */
export function QuestDetails({ questId, dataset, character, actions, baseDataset }: QuestDetailsProps) {
  const quest = dataset.quest(questId);
  if (quest === undefined) {
    return (
      <PanelSection title="Quest" aside={<code>#{String(questId)}</code>}>
        <EmptyState title={`Quest ${String(questId)} is not in the loaded dataset`}>
          <p>Its details are unknown here. A custom quest with this id can say what you know about it.</p>
        </EmptyState>
        {actions !== undefined && (
          <div className="frl-app-actions">
            <Button
              size="sm"
              aria-disabled={actions.unavailable === null ? undefined : true}
              title={actions.unavailable ?? undefined}
              data-focus-key={`custom-quest:new-with-id:${String(questId)}`}
              onClick={() => {
                if (actions.unavailable === null) actions.editCustom({ mode: 'new-with-id', id: questId });
              }}
            >
              Create a custom quest with this id
            </Button>
          </div>
        )}
      </PanelSection>
    );
  }
  const start = character.startLevel;
  const difficulty = questDifficultyAt(start, quest.level, quest.minLevel);
  const open = questOpenTo(quest, character);
  const custom = quest.provenance.source === 'custom';
  const replaced = custom && baseDataset !== undefined ? shadowedQuest(baseDataset, quest.id) : null;
  const chain = chainText(dataset, quest.id);
  const objectiveOff = actions === undefined || actions.unavailable !== null;
  const items: DetailItem[] = [
    { term: 'Name', value: quest.name },
    ...(chain === null ? [] : [{ term: 'Chain', value: chain }]),
    {
      term: 'Level',
      value: (
        <span className="frl-app-stack">
          <DifficultyLabel level={effectiveQuestLevel(start, quest.level, quest.minLevel)} difficulty={difficulty} uncertain variant="full" />
          <span className="frl-app-hint">{levelHint(quest, start)}</span>
        </span>
      ),
    },
    { term: 'Required level', value: quest.minLevel === null ? 'Unknown' : String(quest.minLevel) },
    {
      term: 'Race and class',
      value: open === null ? 'Unknown: the race or class mask cannot be read' : `${open ? 'Open' : 'Not open'} to ${characterName(character)}`,
    },
    { term: 'Zone', value: questZoneName(dataset, quest) ?? 'Unknown' },
    { term: 'Starts at', value: <Stops dataset={dataset} refs={quest.starters} /> },
    { term: 'Ends at', value: <Stops dataset={dataset} refs={quest.finishers} /> },
    {
      term: 'Objectives',
      value:
        quest.objectives.length === 0 ? (
          custom ? 'None entered' : 'None listed'
        ) : (
          <ul className="frl-app-list">
            {quest.objectives.map((o, i) => {
              const where = objectiveWhere(dataset, o);
              return (
                <li key={i} className="frl-app-objective">
                  <span>
                    {objectiveText(dataset, o)}
                    {where !== null && <span className="frl-app-hint">{` · ${where}`}</span>}
                  </span>
                  {actions !== undefined && quest.objectives.length > 1 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="add"
                      aria-disabled={objectiveOff ? true : undefined}
                      title={actions.unavailable ?? `Add a step completing objective ${String(i + 1)} after the selection`}
                      onClick={() => {
                        if (!objectiveOff) actions.add(quest.id, ['complete'], i);
                      }}
                    >
                      {`Complete objective ${String(i + 1)}`}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        ),
    },
    {
      term: 'Quest text',
      value:
        quest.objectivesText === null || quest.objectivesText.length === 0 ? (
          custom ? 'None entered' : 'None in the dataset'
        ) : (
          <span className="frl-app-stack">
            {quest.objectivesText.map((line, i) => (
              <span key={i}>{line}</span>
            ))}
          </span>
        ),
    },
    {
      term: 'Requires',
      value:
        quest.prerequisites.preQuestSingle.length === 0
          ? 'No prerequisite quests'
          : quest.prerequisites.preQuestSingle.map((id) => dataset.quest(id)?.name ?? `#${String(id)}`).join(', '),
    },
    {
      term: 'XP',
      value: quest.xp === null ? <ReadoutValue readout={custom ? unknownReadout<number>('No XP entered for this custom quest') : NO_XP} format={formatInteger} /> : xpText(quest.xp),
    },
    { term: 'Forever', value: <ProvenanceBadge provenance={foreverProvenanceOf(quest.provenance)} variant="full" /> },
    { term: 'Source', value: upstreamProvenanceText(quest.provenance) },
  ];
  return (
    <PanelSection title={custom ? 'Custom quest' : 'Quest'} aside={<code>#{String(quest.id)}</code>}>
      {replaced !== null && (
        <p className="frl-app-info">
          <SeverityIcon severity="info" size={14} labelled={false} />
          <span>
            <code>{CUSTOM_SHADOWED_CODE}</code> (info): this custom quest replaces the dataset quest “{replaced.name}” in this project.
          </span>
        </p>
      )}
      {actions !== undefined && <AddButtons quest={quest} actions={actions} />}
      <DetailList items={items} />
      {actions !== undefined && (
        <div className="frl-app-actions">
          {custom ? (
            <>
              <Button
                size="sm"
                aria-disabled={actions.unavailable === null ? undefined : true}
                title={actions.unavailable ?? undefined}
                data-focus-key={`custom-quest:edit:${String(quest.id)}`}
                onClick={() => {
                  if (actions.unavailable === null) actions.editCustom({ mode: 'edit', id: quest.id });
                }}
              >
                Edit custom quest
              </Button>
              {replaced !== null && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-disabled={actions.unavailable === null ? undefined : true}
                  title={actions.unavailable ?? 'Deletes the custom quest; undo brings it back'}
                  onClick={() => {
                    if (actions.unavailable === null) actions.deleteCustom(quest.id);
                  }}
                >
                  Use the dataset record
                </Button>
              )}
            </>
          ) : (
            <Button
              size="sm"
              aria-disabled={actions.unavailable === null ? undefined : true}
              title={actions.unavailable ?? 'A custom quest with this id and your values (DATA001-custom-shadowed)'}
              data-focus-key={`custom-quest:replace:${String(quest.id)}`}
              onClick={() => {
                if (actions.unavailable === null) actions.editCustom({ mode: 'replace', id: quest.id });
              }}
            >
              Replace with a custom quest
            </Button>
          )}
        </div>
      )}
    </PanelSection>
  );
}
