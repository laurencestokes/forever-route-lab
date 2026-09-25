import {
  type CharacterProfile,
  classAllowed,
  type DatasetView,
  QUEST_STEP_KINDS,
  type QuestId,
  type QuestRecord,
  raceAllowed,
  type RouteStep,
  type StepId,
} from '../domain';
import { type Difficulty, questDifficulty } from '../rules';
import type { Command } from './commands';

/**
 * Deterministic ids, for the shell's tests and fixtures: ui may import values only from app
 * (ARCHITECTURE §4), and its tests must not use random ids.
 */
export { sequentialIdSource } from '../domain';

/**
 * App-layer support for the Milestone 1 shell (src/ui/App.tsx). ui may import values only from
 * app (ARCHITECTURE §4), so the few pure-module functions the shell needs are wrapped here, where
 * they are testable without React. The derived-result pipeline of Milestone 6 supersedes most of
 * this.
 */

/** QuestieDB's level for a scaling quest: it takes the player's level (SIMULATION QXP-7, COL-5). */
export const SCALING_QUEST_LEVEL = -1;

/** A level usable by the rules: a whole number of at least 1. */
const isLevel = (level: number): boolean => Number.isInteger(level) && level >= 1;

/**
 * The level a quest counts as for a player of `playerLevel`, or null when it is unknown. A scaling
 * quest (`questLevel` -1) takes `max(minLevel ?? 1, playerLevel)` (QXP-7), so it needs a known
 * player level. Any other level of 0 or below, and any fractional level, is not a valid quest
 * level: unknown, not a guess.
 */
export function effectiveQuestLevel(playerLevel: number | null, questLevel: number | null, minLevel: number | null = null): number | null {
  if (questLevel === null) return null;
  if (questLevel === SCALING_QUEST_LEVEL) {
    if (playerLevel === null || !isLevel(playerLevel)) return null;
    const floor = minLevel ?? 1;
    const level = Math.max(floor, playerLevel);
    return isLevel(level) ? level : null;
  }
  return isLevel(questLevel) ? questLevel : null;
}

/**
 * The difficulty of a quest of `questLevel` (and `minLevel`, which a scaling quest needs) for a
 * player of `playerLevel` (Era thresholds, SIMULATION.md COL-1), or null when either level is
 * unknown or not a valid level (see effectiveQuestLevel).
 */
export function questDifficultyAt(playerLevel: number | null, questLevel: number | null, minLevel: number | null = null): Difficulty | null {
  if (playerLevel === null || !isLevel(playerLevel)) return null;
  const level = effectiveQuestLevel(playerLevel, questLevel, minLevel);
  return level === null ? null : questDifficulty(playerLevel, level);
}

/**
 * Whether the quest's race and class masks admit the character (D-012 arithmetic tests). Null
 * when a mask is malformed (not a non-negative safe integer): unknown, not "no".
 */
export function questOpenTo(
  quest: Pick<QuestRecord, 'races' | 'classes'>,
  character: Pick<CharacterProfile, 'race' | 'class'>,
): boolean | null {
  try {
    return raceAllowed(quest.races, character.race) && classAllowed(quest.classes, character.class);
  } catch {
    return null;
  }
}

/**
 * The level a quest sorts at: the higher of its level and its required level, so a level-1 quest
 * that needs level 42 (4295 "Rocknot's Ale") sorts with the level-42 quests, not first (M2 review
 * code-F9). A scaling quest sorts at its required level (at least 1); an unknown or invalid level
 * (null, 0, a fraction) sorts last, and an invalid required level is ignored.
 */
export function questSortLevel(quest: Pick<QuestRecord, 'level' | 'minLevel'>): number {
  const required = quest.minLevel !== null && isLevel(quest.minLevel) ? quest.minLevel : 1;
  if (quest.level === SCALING_QUEST_LEVEL) return required;
  return quest.level !== null && isLevel(quest.level) ? Math.max(quest.level, required) : Number.POSITIVE_INFINITY;
}

/**
 * The required level to show next to a quest for a character of `level`: the quest's `minLevel`
 * when it is above that level, else null (nothing to say, or unknown).
 */
export function requiredLevelAbove(quest: Pick<QuestRecord, 'minLevel'>, level: number | null): number | null {
  if (quest.minLevel === null || !isLevel(quest.minLevel) || level === null) return null;
  return quest.minLevel > level ? quest.minLevel : null;
}

/** Ascending sort level (unknown last), then id. */
function byLevel(a: QuestRecord, b: QuestRecord): number {
  const la = questSortLevel(a);
  const lb = questSortLevel(b);
  return la === lb ? a.id - b.id : la - lb;
}

export interface QuestsForCharacter {
  /** Quests whose race and class masks admit the character, by `questSortLevel` and then id. */
  readonly open: readonly QuestRecord[];
  /** Quests closed to the character's race or class. */
  readonly closed: readonly QuestRecord[];
  /** Quests whose race or class mask cannot be read: whether they are open is unknown. */
  readonly unknown: readonly QuestRecord[];
}

/**
 * Dataset quests split by race and class only. Level, prerequisites and the character's state at a
 * step are the engine's job (Milestone 6); nothing here claims a quest is available at a step. A
 * mask that cannot be read puts the quest in `unknown`, never in `open`.
 */
export function questsForCharacter(dataset: DatasetView, character: Pick<CharacterProfile, 'race' | 'class'>): QuestsForCharacter {
  const open: QuestRecord[] = [];
  const closed: QuestRecord[] = [];
  const unknown: QuestRecord[] = [];
  for (const quest of dataset.quests()) {
    const verdict = questOpenTo(quest, character);
    (verdict === null ? unknown : verdict ? open : closed).push(quest);
  }
  return { open: open.sort(byLevel), closed: closed.sort(byLevel), unknown: unknown.sort(byLevel) };
}

export function isQuestStep(step: RouteStep): boolean {
  return QUEST_STEP_KINDS.has(step.kind);
}

/** The quests a step acts on, in step order without repeats; empty for non-quest steps. */
export function stepQuestIds(step: RouteStep): QuestId[] {
  switch (step.kind) {
    case 'accept':
    case 'turnin':
    case 'abandon':
      return [step.questId];
    case 'complete':
      return [...new Set(step.targets.map((t) => t.questId))];
    case 'travel':
    case 'grind':
    case 'hearth':
    case 'flight':
    case 'train':
    case 'vendor':
    case 'note':
      return [];
  }
}

/**
 * Sets a note step's text. Typing into one note coalesces into one undo entry; an unknown id, a
 * step that is not a note, or unchanged text is a no-op.
 */
export function editNoteText(id: StepId, text: string): Command {
  return {
    label: 'Edit note text',
    coalesceKey: `note-text:${id}`,
    apply(project) {
      const steps = project.route.steps;
      const index = steps.findIndex((s) => s.id === id);
      const step = steps[index];
      if (step === undefined || step.kind !== 'note' || step.text === text) return project;
      const next = steps.map((s, i) => (i === index ? { ...step, text } : s));
      return { ...project, route: { ...project.route, steps: next } };
    },
  };
}
