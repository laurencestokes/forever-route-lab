import { describe, expect, it } from 'vitest';
import { type EntityRef, itemId, npcId, objectId, questId, raceAllowed, uiMapId } from '../../domain';
import {
  PLACEHOLDER_DATASET_IDENTITY,
  PLACEHOLDER_ID_MIN,
  PLACEHOLDER_QUEST_IDS,
  PLACEHOLDER_SPOTS,
  PLACEHOLDER_ZONES,
  createPlaceholderDataset,
} from './placeholder-dataset';

const dataset = createPlaceholderDataset();
const quests = dataset.quests();

/** Every entity a quest names: starters, finishers and objective targets. */
function referencedEntities(): EntityRef[] {
  const refs: EntityRef[] = [];
  for (const q of quests) {
    refs.push(...q.starters, ...q.finishers);
    for (const o of q.objectives) {
      if (o.kind === 'kill') refs.push({ kind: 'npc', id: o.npcId });
      else if (o.kind === 'object') refs.push({ kind: 'object', id: o.objectId });
      else if (o.kind === 'item') refs.push({ kind: 'item', id: o.itemId });
    }
  }
  return refs;
}

function resolve(ref: EntityRef): { readonly id: number; readonly name: string } | undefined {
  switch (ref.kind) {
    case 'npc':
      return dataset.npc(ref.id);
    case 'object':
      return dataset.object(ref.id);
    case 'item':
      return dataset.item(ref.id);
  }
}

describe('placeholder dataset', () => {
  it('identifies itself as placeholder data', () => {
    expect(dataset.identity).toEqual({
      dataRevision: 'placeholder',
      frameBuild: 'placeholder',
      upstreamCommit: 'none',
      foreverContentVerified: false,
    });
    expect(dataset.identity).toBe(PLACEHOLDER_DATASET_IDENTITY);
  });

  it('holds a handful of quests, in ascending id order', () => {
    expect(quests.length).toBeGreaterThanOrEqual(6);
    expect(quests.length).toBeLessThanOrEqual(10);
    const ids = quests.map((q) => q.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names every record and zone "Placeholder ..." and keeps ids in the reserved synthetic range', () => {
    const records = [...quests, ...referencedEntities().map((ref) => resolve(ref))];
    for (const record of records) {
      expect(record).toBeDefined();
      expect(record?.name).toMatch(/^Placeholder /);
      expect(record?.id).toBeGreaterThanOrEqual(PLACEHOLDER_ID_MIN);
    }
    for (const zone of dataset.zones()) {
      expect(zone.name).toMatch(/^Placeholder /);
      expect(zone.uiMapId).toBeGreaterThanOrEqual(PLACEHOLDER_ID_MIN);
    }
    for (const spot of Object.values(PLACEHOLDER_SPOTS)) expect(spot.label).toMatch(/^Placeholder /);
  });

  it('fabricates no game data: XP, objective counts and objective text are unknown', () => {
    for (const q of quests) {
      expect(q.xp).toBeNull();
      expect(q.objectivesText).toBeNull();
      for (const o of q.objectives) if ('count' in o) expect(o.count).toBeNull();
      expect(q.provenance.foreverStatus).toBe('unknown');
      expect(q.provenance.source).toBe('custom');
    }
  });

  it('resolves every reference a quest makes', () => {
    for (const ref of referencedEntities()) expect(resolve(ref), `${ref.kind} ${String(ref.id)}`).toBeDefined();
    for (const q of quests) {
      for (const pre of q.prerequisites.preQuestSingle) expect(dataset.quest(pre)).toBeDefined();
    }
  });

  it('keeps NPC questStarts and questEnds consistent with quest starters and finishers', () => {
    for (const q of quests) {
      for (const ref of q.starters) if (ref.kind === 'npc') expect(dataset.npc(ref.id)?.questStarts).toContain(q.id);
      for (const ref of q.finishers) if (ref.kind === 'npc') expect(dataset.npc(ref.id)?.questEnds).toContain(q.id);
    }
  });

  it('places spawns in the placeholder zones, without world points (there is no geometry)', () => {
    for (const ref of referencedEntities()) {
      for (const spawn of dataset.spawns(ref)) {
        expect(spawn.world).toBeNull();
        expect(spawn.uiMapId === null ? undefined : dataset.zone(spawn.uiMapId)).toBeDefined();
      }
    }
    expect(dataset.spawns({ kind: 'npc', id: npcId(900_101) })).toHaveLength(1);
    expect(dataset.spawns({ kind: 'object', id: objectId(900_201) })).toHaveLength(1);
    expect(dataset.spawns({ kind: 'item', id: itemId(900_301) })).toEqual([]);
  });

  it('answers undefined or empty for ids it does not hold', () => {
    expect(dataset.quest(questId(1))).toBeUndefined();
    expect(dataset.npc(npcId(1))).toBeUndefined();
    expect(dataset.object(objectId(1))).toBeUndefined();
    expect(dataset.item(itemId(1))).toBeUndefined();
    expect(dataset.zone(uiMapId(1411))).toBeUndefined();
    expect(dataset.spawns({ kind: 'npc', id: npcId(1) })).toEqual([]);
  });

  it('lists zones in ascending UiMap order', () => {
    expect(dataset.zones().map((z) => z.name)).toEqual([PLACEHOLDER_ZONES.vale.name, PLACEHOLDER_ZONES.ridge.name]);
  });

  it('has one quest for each faction only, to exercise race-mask filtering', () => {
    const horde = dataset.quest(PLACEHOLDER_QUEST_IDS.hordeOnly);
    const alliance = dataset.quest(PLACEHOLDER_QUEST_IDS.allianceOnly);
    expect(horde !== undefined && raceAllowed(horde.races, 'Orc')).toBe(true);
    expect(horde !== undefined && raceAllowed(horde.races, 'Human')).toBe(false);
    expect(alliance !== undefined && raceAllowed(alliance.races, 'Orc')).toBe(false);
  });

  it('is deterministic', () => {
    expect(createPlaceholderDataset().quests()).toEqual(quests);
  });
});
