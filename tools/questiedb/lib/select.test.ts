import { describe, expect, it } from 'vitest';
import { hasBit } from './project';
import { hasFlag, selectEntities } from './select';
import type { EntityRefRow, QuestRow } from './shapes';

type QuestInput = Pick<QuestRow, 'id' | 'starters' | 'finishers' | 'objectives' | 'objectiveHints' | 'requirements'>;
const REQUIREMENTS: QuestRow['requirements'] = { skill: null, minReputation: null, maxReputation: null, spell: null, specialization: null, sourceItemId: null, requiredSourceItems: [] };
const quest = (id: number, starters: readonly EntityRefRow[], extra: Partial<QuestInput> = {}): QuestInput => ({
  id,
  starters,
  finishers: [],
  objectives: [],
  objectiveHints: [],
  requirements: REQUIREMENTS,
  ...extra,
});
const npc = (npcFlags = 0, questStarts: readonly number[] = []) => [{ npcFlags, questStarts, questEnds: [] as readonly number[] }];
const item = (startsQuest: number | null, dropNpcs: readonly number[] = [], dropItems: readonly number[] = []) => [{ startsQuest, dropNpcs, dropObjects: [] as readonly number[], dropItems }];

describe('arithmetic bit tests (D-012)', () => {
  it('tests bits above 31, where bitwise operators would truncate', () => {
    const allianceWithSkyborne = 4294967373; // 77 + 2^32, QuestieDB byExpansion.Forever ALL_ALLIANCE
    expect(hasBit(allianceWithSkyborne, 32)).toBe(true);
    expect(hasBit(allianceWithSkyborne, 33)).toBe(false);
    expect(hasBit(allianceWithSkyborne, 0)).toBe(true);
    expect(hasBit(allianceWithSkyborne, 1)).toBe(false);
    expect(hasBit(8589934770, 33)).toBe(true);
    expect(hasBit(178, 7)).toBe(true);
  });

  it('tests npcFlags by value and rejects a value that is not a power of two', () => {
    expect(hasFlag(135, 128)).toBe(true);
    expect(hasFlag(135, 8)).toBe(false);
    expect(hasFlag(268435456, 128)).toBe(false);
    expect(() => hasFlag(1, 3)).toThrow(/power of two/);
  });
});

describe('entity selection', () => {
  const FLAGS = { flightMaster: 8, trainer: 16, innkeeper: 128 };

  it('selects quest-referenced entities, drop sources, containers and flag-selected NPCs', () => {
    const selection = selectEntities({
      quests: [quest(1, [{ kind: 'npc', id: 10 }], { objectives: [{ kind: 'item', itemId: 100, label: null, count: null }] })],
      npcs: new Map([
        [10, npc()],
        [11, npc()], // drops item 100
        [12, npc(8)], // flight master
        [13, npc(2)], // quest giver only, unreferenced: not shipped
        [14, npc(0, [99])], // questStarts: quest-referenced by its own list
        [15, npc()], // drops container 101
      ]),
      objects: new Map([[50, [{ questStarts: [], questEnds: [] }]]]),
      items: new Map([
        [100, item(null, [11], [101])],
        [101, item(null, [15])],
        [102, item(1)], // starts quest 1: selected
        [103, item(4242)], // starts a quest the dataset lacks: not selected on its own
      ]),
      flagValues: FLAGS,
    });
    expect([...selection.npcs].sort((a, b) => a - b)).toEqual([10, 11, 12, 14, 15]);
    expect([...selection.items].sort((a, b) => a - b)).toEqual([100, 101, 102]);
    expect([...selection.objects]).toEqual([]);
    expect(selection.npcCounts.flagOnly).toBe(1);
    expect(selection.unresolved).toEqual([]);
  });

  it('reports references to entities the composed data lacks instead of inventing them', () => {
    const selection = selectEntities({
      quests: [quest(1, [{ kind: 'object', id: 404 }])],
      npcs: new Map(),
      objects: new Map(),
      items: new Map(),
      flagValues: FLAGS,
    });
    expect(selection.unresolved).toEqual([{ kind: 'object', id: 404, referencedBy: 'quest 1' }]);
  });

  it('scans every persona variant of a record', () => {
    const selection = selectEntities({
      quests: [quest(1, [{ kind: 'npc', id: 10 }]), quest(1, [{ kind: 'npc', id: 20 }])],
      npcs: new Map([
        [10, npc()],
        [20, npc()],
        [30, [...npc(0), ...npc(128)]],
      ]),
      objects: new Map(),
      items: new Map(),
      flagValues: FLAGS,
    });
    expect([...selection.npcs].sort((a, b) => a - b)).toEqual([10, 20, 30]);
  });
});
