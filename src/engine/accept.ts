import type { Truth } from '../domain/conditions';
import type { QuestId } from '../domain/ids';
import type { AcceptPolicy, EngineDataset, ReadonlyCharacterState } from './types';

/**
 * The engine's default `AcceptPolicy`: the status and level checks of SIMULATION §7.2 that the
 * walker's state decides on its own (VAL-1, VAL-2 with the repeatable exemption, VAL-4 and VAL-5,
 * with the uncertain variants of §7.6 counting as acceptable). The validator injects the full
 * availability rules (prerequisites, race and class masks, reputation, skills, log capacity), so
 * the walker picks the same any-of candidate the validator checks.
 */
export function createBasicAcceptPolicy(dataset: Pick<EngineDataset, 'quest'>): AcceptPolicy {
  return {
    acceptable(questId: QuestId, state: ReadonlyCharacterState): Truth {
      if (state.questLog.has(questId)) return 'false';
      const record = dataset.quest(questId);
      // An unknown quest is a warning (DATA002), not an error.
      if (record === undefined) return 'unknown';
      if (state.completed.has(questId) && !record.flags.repeatable) return 'false';
      const uncertain = state.unknownXpEvents > 0;
      if (record.minLevel !== null && state.level < record.minLevel) return uncertain ? 'unknown' : 'false';
      if (record.maxLevel !== null && record.maxLevel > 0 && state.level > record.maxLevel) return 'false';
      return uncertain && record.maxLevel !== null && record.maxLevel > 0 ? 'unknown' : 'true';
    },
  };
}
