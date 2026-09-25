import { describe, expect, it } from 'vitest';
import { LuaTable, type LuaValue, ShapeError } from './lua-value';
import { buildObjectives } from './objectives';
import { I, N, O, projectItem, projectNpc, projectObject, projectQuest, Q, type QuestContext } from './project';

const ctx: QuestContext = { hinted: () => false, xp: new Map(), dungeonAreas: new Set() };
const row = (entries: readonly (readonly [number, LuaValue])[]): LuaTable => LuaTable.from(entries);

describe('single ids where upstream writes 0 for none (DATA_PROVENANCE §6; code-F8, data-F13)', () => {
  it('ships 0 as null in every single-id quest field, and keeps real ids', () => {
    const zeros = projectQuest(
      1,
      row([
        [Q.name, 'Q'],
        [Q.zoneOrSort, 0],
        [Q.nextQuestInChain, 0],
        [Q.parentQuest, 0],
        [Q.breadcrumbForQuestId, 0],
        [Q.availableUntilCompleted, 0],
        [Q.availableStartingWith, 0],
        [Q.disabledByQuest, 0],
        [Q.sourceItemId, 0],
        [Q.requiredSpell, 0],
        [Q.requiredSpecialization, 0],
      ]),
      ctx,
    );
    expect(zeros.zoneOrSort).toBeNull();
    expect(zeros.prerequisites).toMatchObject({ nextQuestInChain: null, parentQuest: null, breadcrumbForQuestId: null, availableUntilCompleted: null, availableStartingWith: null, disabledByQuest: null });
    expect(zeros.requirements).toMatchObject({ sourceItemId: null, spell: null, specialization: null });

    const ids = projectQuest(2, row([[Q.name, 'Q'], [Q.zoneOrSort, -22], [Q.nextQuestInChain, 15], [Q.sourceItemId, 1307], [Q.requiredSpell, -9000]]), ctx);
    expect(ids.zoneOrSort).toBe(-22); // signed: a QuestSort
    expect(ids.prerequisites.nextQuestInChain).toBe(15);
    expect(ids.requirements.sourceItemId).toBe(1307);
    expect(ids.requirements.spell).toBe(-9000); // signed: must not know the spell
  });

  it('fails closed on a negative value in a positive-id field', () => {
    expect(() => projectQuest(3, row([[Q.name, 'Q'], [Q.parentQuest, -5]]), ctx)).toThrow(ShapeError);
    expect(() => projectQuest(3, row([[Q.name, 'Q'], [Q.parentQuest, -5]]), ctx)).toThrow(/positive id or 0/);
  });

  it('ships zoneId 0 of NPCs and objects, object factionId 0 and item startQuest 0 as null', () => {
    expect(projectNpc(5676, row([[N.name, 'N'], [N.zoneID, 0]])).record.zoneId).toBeNull();
    expect(projectNpc(3143, row([[N.name, 'N'], [N.zoneID, 14]])).record.zoneId).toBe(14);
    const object = projectObject(2082, row([[O.name, 'O'], [O.zoneID, 0], [O.factionID, 0]])).record;
    expect([object.zoneId, object.factionId]).toEqual([null, null]);
    expect(projectItem(1, row([[I.name, 'I'], [I.startQuest, 0]])).startsQuest).toBeNull();
    expect(projectItem(1, row([[I.name, 'I'], [I.startQuest, 90]])).startsQuest).toBe(90);
  });

  it('ships a spell objective item id of 0 as null', () => {
    const objectives = buildObjectives(9, LuaTable.from([[6, LuaTable.list([LuaTable.list([1234, 'Use it', 0])])]]), null, () => false);
    expect(objectives).toEqual([{ kind: 'spell', spellId: 1234, itemId: null, label: 'Use it' }]);
  });
});
