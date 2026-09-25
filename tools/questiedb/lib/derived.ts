import type { Rows } from './entities';
import { LuaTable, ShapeError } from './lua-value';
import type { Transcription } from './semantics';

/**
 * The Derived Pass `requiredRaces:questieCompatibility` (QuestieDB src/derived/requiredRaces.lua
 * `ApplyQuestieCompatibility`), transcribed with its quirks: it runs on the statically corrected
 * rows; a quest whose requiredRaces is nil or 0 and whose creature starters are friendly to exactly
 * one faction gets that faction's Era mask (Forever rules "Classic": 77 / 178). Missing NPCs and
 * unknown faction strings are ignored, as upstream ignores them.
 */

/** Upstream behaviour transcribed here, with the blob it was written against (lib/semantics.ts). */
export const TRANSCRIBES: readonly Transcription[] = [
  { path: 'src/derived/requiredRaces.lua', sha256: '19cab68a2ffc46dc2115f1387b8ac1dec526c67fcc57c4cc09dea57e4612299d', what: 'ApplyQuestieCompatibility' },
  {
    path: 'src/derived/_end.lua',
    sha256: '60578bb0634acabc770c786a459baed2f1c0efab06b5adba68b012b51922195a',
    what: 'pass registration: requiredRaces:questieCompatibility (order 50) is the only pass that affects shipped fields; the waypoint passes do not',
  },
];

export const QUEST_STARTED_BY = 2;
export const QUEST_REQUIRED_RACES = 6;
export const NPC_FRIENDLY_TO = 13;

export interface RaceMasks {
  readonly allAlliance: number;
  readonly allHorde: number;
}

/** Returns the ids of the quests the pass changed (for the report and `layers`). */
export function applyRequiredRaces(quests: Rows, npcs: Rows, masks: RaceMasks): readonly number[] {
  const changed: number[] = [];
  for (const id of [...quests.keys()].sort((a, b) => a - b)) {
    const quest = quests.get(id);
    if (quest === undefined) continue;
    const races = quest.get(QUEST_REQUIRED_RACES);
    // `(not races) or races == 0`: an empty table (the delete idiom) is truthy in Lua.
    if (!(races === null || races === false || races === 0)) continue;
    const startedBy = quest.get(QUEST_STARTED_BY);
    if (startedBy === null || startedBy === false) continue;
    if (!(startedBy instanceof LuaTable)) throw new ShapeError(`quest ${String(id)}`, 'startedBy is not a table');
    const creatures = startedBy.get(1);
    let canAlliance = false;
    let canHorde = false;
    if (creatures !== null && creatures !== false) {
      if (!(creatures instanceof LuaTable)) throw new ShapeError(`quest ${String(id)}`, 'startedBy[1] is not a table');
      for (const [, npcId] of creatures.entries()) {
        if (typeof npcId !== 'number') continue;
        const friendly = npcs.get(npcId)?.get(NPC_FRIENDLY_TO) ?? null;
        if (friendly === 'H') canHorde = true;
        else if (friendly === 'A') canAlliance = true;
        else if (friendly === 'AH') {
          canAlliance = true;
          canHorde = true;
        }
      }
    }
    if (canAlliance !== canHorde) {
      quest.set(QUEST_REQUIRED_RACES, canAlliance ? masks.allAlliance : masks.allHorde);
      changed.push(id);
    }
  }
  return changed;
}
