import { effectiveQuestLevel, questDifficultyAt, questOpenTo, SCALING_QUEST_LEVEL } from '../../app/shell-support';
import type { CharacterProfile } from '../../domain/project';
import type { DatasetView, QuestRecord } from '../../domain/dataset';
import type { QuestId } from '../../domain/ids';
import { characterName, entityName, objectiveText, questZoneName } from '../app-model';
import {
  DetailList,
  DifficultyLabel,
  EmptyState,
  PanelSection,
  ProvenanceBadge,
  ReadoutValue,
  foreverProvenanceOf,
  formatInteger,
  unknownReadout,
  type DetailItem,
} from '../kit';

export interface QuestDetailsProps {
  readonly questId: QuestId;
  readonly dataset: DatasetView;
  readonly character: CharacterProfile;
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

/** One quest the active step acts on, in the Details tab. */
export function QuestDetails({ questId, dataset, character }: QuestDetailsProps) {
  const quest = dataset.quest(questId);
  if (quest === undefined) {
    return (
      <PanelSection title="Quest" aside={<code>#{String(questId)}</code>}>
        <EmptyState title={`Quest ${String(questId)} is not in the loaded dataset`}>
          <p>Custom quests arrive with the route editor. Its details are unknown here.</p>
        </EmptyState>
      </PanelSection>
    );
  }
  const start = character.startLevel;
  const difficulty = questDifficultyAt(start, quest.level, quest.minLevel);
  const open = questOpenTo(quest, character);
  const names = (refs: QuestRecord['starters']) => (refs.length === 0 ? 'Unknown' : refs.map((r) => entityName(dataset, r)).join(', '));
  const items: DetailItem[] = [
    { term: 'Name', value: quest.name },
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
    { term: 'Starts at', value: names(quest.starters) },
    { term: 'Ends at', value: names(quest.finishers) },
    {
      term: 'Objectives',
      value:
        quest.objectives.length === 0 ? (
          'None listed'
        ) : (
          <ul className="frl-app-list">
            {quest.objectives.map((o, i) => (
              <li key={i}>{objectiveText(dataset, o)}</li>
            ))}
          </ul>
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
      value:
        quest.xp === null ? (
          <ReadoutValue readout={NO_XP} format={formatInteger} />
        ) : (
          `${formatInteger(quest.xp.baseXp)} base XP (${quest.xp.basis})`
        ),
    },
    { term: 'Forever', value: <ProvenanceBadge provenance={foreverProvenanceOf(quest.provenance)} variant="full" /> },
  ];
  return (
    <PanelSection title="Quest" aside={<code>#{String(quest.id)}</code>}>
      <DetailList items={items} />
    </PanelSection>
  );
}
