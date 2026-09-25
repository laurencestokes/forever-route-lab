import { describe, expect, it } from 'vitest';
import { LuaTable, type LuaValue } from './lua-value';
import { buildObjectiveHints, buildObjectives, type HintLookup } from './objectives';
import { pointMap, pointRow } from './points';
import type { HintSet } from './sandbox';

const L = (...values: LuaValue[]): LuaTable => LuaTable.list(values);
const none: HintLookup = () => false;
const hints = (set: HintSet, ids: readonly number[]): HintLookup => (name, id) => name === set && ids.includes(id);

describe('ObjectiveData order (Questie QuestieDB.lua:1735-1864)', () => {
  // creature, object, item, reputation, killCredit, spell groups plus a triggerEnd event.
  const objectives = L(
    L(L(6, 'Kobold slain'), L(7, null, 1)),
    L(L(55, 'Body')),
    L(L(773), L(774, 'Dust', 2)),
    L(72, 250),
    L(L(L(100, 101), 102, 'Credit', 0)),
    L(L(900, 'Cast', 5)),
  );
  const triggerEnd = L('Explore the camp', LuaTable.from([[12, L(L(48.92, 41.61))]]));

  it('lists creature, object, item, reputation, killCredit, spell, then the event', () => {
    const list = buildObjectives(1, objectives, triggerEnd, none);
    expect(list.map((o) => o.kind)).toEqual(['kill', 'kill', 'object', 'item', 'item', 'reputation', 'killCredit', 'spell', 'event']);
    expect(list[0]).toEqual({ kind: 'kill', npcId: 6, label: 'Kobold slain', count: null });
    expect(list[1]).toEqual({ kind: 'kill', npcId: 7, label: null, count: null });
    expect(list[5]).toEqual({ kind: 'reputation', factionId: 72, value: 250 });
    expect(list[6]).toEqual({ kind: 'killCredit', npcIds: [100, 101], rootNpcId: 102, label: 'Credit', count: null });
    expect(list[7]).toEqual({ kind: 'spell', spellId: 900, itemId: 5, label: 'Cast' });
    expect(list[8]).toEqual({ kind: 'event', text: 'Explore the camp', points: { 12: [[48.92, 41.61]] } });
  });

  it('inserts hinted elements at position 1 as they are processed, so several end up reversed', () => {
    const list = buildObjectives(503, objectives, null, hints('itemObjectiveFirst', [503]));
    expect(list.map((o) => (o.kind === 'item' ? `item:${String(o.itemId)}` : o.kind))).toEqual(['item:774', 'item:773', 'kill', 'kill', 'object', 'reputation', 'killCredit', 'spell']);
  });

  it('puts a hinted event first', () => {
    expect(buildObjectives(9, objectives, triggerEnd, hints('eventObjectiveFirst', [9]))[0]?.kind).toBe('event');
  });

  it('reads a missing or deleted objectives field as no objectives, and skips an empty killCredit group', () => {
    expect(buildObjectives(1, null, null, none)).toEqual([]);
    expect(buildObjectives(1, new LuaTable(), new LuaTable(), none)).toEqual([]);
    expect(buildObjectives(1, LuaTable.from([[5, new LuaTable()]]), null, none)).toEqual([]);
  });

  it('fails closed on a sparse list, an unknown slot or a malformed pair', () => {
    expect(() => buildObjectives(1, L(LuaTable.from([[1, L(6)], [3, L(7)]])), null, none)).toThrow(/sequence/);
    expect(() => buildObjectives(1, LuaTable.from([[7, L()]]), null, none)).toThrow(/unexpected key 7/);
    expect(() => buildObjectives(1, LuaTable.from([[4, new LuaTable()]]), null, none)).toThrow(/reputation value/);
  });

  it('builds objective hints with refs and points, never counting them', () => {
    const extra = L(
      L(null, 4, 'Use the cannon', 0, L(L('object', 113531))),
      L(LuaTable.from([[331, L(L(-1, -1))]]), 3, null, null, L(L('monster', 10), L('item', 20))),
    );
    expect(buildObjectiveHints(1, extra)).toEqual([
      { text: 'Use the cannon', objectiveIndex: 0, points: {}, refs: [{ kind: 'object', id: 113531 }] },
      { text: null, objectiveIndex: null, points: { 331: [[-1, -1]] }, refs: [{ kind: 'npc', id: 10 }, { kind: 'item', id: 20 }] },
    ]);
    expect(() => buildObjectiveHints(1, L(L(null, 1, null, 0, L(L('vehicle', 1)))))).toThrow(/unknown reference kind/);
  });
});

describe('published points', () => {
  it('keeps numbers as published, drops a zero phase, keeps a non-zero phase and the instance sentinel', () => {
    expect(pointRow(L(42.06, 68.33), 'p')).toEqual([42.06, 68.33]);
    expect(pointRow(L(44.399, 86.11, 0), 'p')).toEqual([44.399, 86.11]);
    expect(pointRow(L(10, 20, 169), 'p')).toEqual([10, 20, 169]);
    expect(pointRow(L(-1, -1, 5), 'p')).toEqual([-1, -1]);
  });

  it('fails closed on a partial sentinel or a malformed point', () => {
    expect(() => pointRow(L(-1, 20), 'p')).toThrow(/partial instance sentinel/);
    expect(() => pointRow(L('x', 1), 'p')).toThrow(ShapeLike);
    expect(() => pointRow(LuaTable.from([[1, 1], [2, 2], [4, 4]]), 'p')).toThrow(/key 4/);
  });

  it('keys spawn lists by AreaTable id in ascending order', () => {
    const map = pointMap(LuaTable.from([[1519, L(L(1, 2))], [14, L(L(42.06, 68.33))]]), 'spawns');
    expect(Object.keys(map ?? {})).toEqual(['14', '1519']);
    expect(pointMap(new LuaTable(), 'spawns')).toBeNull();
  });
});

const ShapeLike = /coordinates must be finite numbers/;
