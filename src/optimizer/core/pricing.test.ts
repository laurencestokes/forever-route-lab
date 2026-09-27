import { describe, expect, it } from 'vitest';
import { itemId, npcId, questId } from '../../domain/ids';
import { itemObjective, itemRecord, killObjective, npcRecord, point, spawnAt } from '../../engine/test-helpers';
import { grind } from '../../sim/grind';
import { completeWork, objectiveWork } from '../../sim/objectives';
import { questXp } from '../../sim/quest-xp';
import { xpCurveOf } from '../../sim/xp';
import { Pricing, sliceLookup } from './pricing';
import { hScenario } from './test-helpers';
import type { PricingSlice, SearchProblem } from './types';

/** Lazy level-only pricing through `src/sim` (docs/research/optimizer-m7.md §5.5). */

const rules = hScenario({ quests: [], steps: [], exit: null }).context.rules;

const slice: PricingSlice = {
  blocks: [
    {
      works: [
        { questId: 1, index: 0, objective: killObjective(10), at: point(0, 0), place: 'open-world' },
        { questId: 1, index: 1, objective: itemObjective(500), at: point(90, 0), place: 'open-world' },
      ],
      unknowns: 0,
    },
    { works: [{ questId: 2, index: 0, objective: killObjective(11), at: null, place: 'dungeon' }], unknowns: 1 },
  ],
  questXp: [
    { questId: 1, xp: { questLevel: 12, baseXp: 1450, basis: 'era-seed' }, requiredLevel: 8, dungeonQuest: false },
    { questId: 2, xp: null, requiredLevel: null, dungeonQuest: false },
  ],
  trains: [{ step: { skill: 'riding', spellId: null, rank: 1 }, original: 1 }],
  grinds: [{ until: { kind: 'level', level: 12, offset: null }, mobLevel: null, xpPerHour: null, place: 'open-world' }],
  npcs: [npcRecord(10, { minLevel: 8, maxLevel: 12 }), npcRecord(11, { minLevel: 14, maxLevel: 14, rank: 1 }), npcRecord(20), npcRecord(21)],
  items: [itemRecord(500, [20, 21])],
  spawns: [
    { key: 'npc:20', spawns: [spawnAt(point(-500, 0))] },
    { key: 'npc:21', spawns: [spawnAt(point(100, 0))] },
  ],
};
const problem = { rules, pricing: slice } as unknown as Pick<SearchProblem, 'rules' | 'pricing'>;

describe('Pricing', () => {
  const lookup = sliceLookup(slice);

  it('prices a work block as objectiveWork then completeWork at the level', () => {
    const pricing = new Pricing(problem);
    for (const level of [5, 10, 13]) {
      const works = (slice.blocks[0]?.works ?? []).map((w) =>
        objectiveWork({ questId: questId(w.questId), index: w.index, objective: w.objective, countOverride: null, playerLevel: level, at: w.at, place: w.place }, lookup, rules),
      );
      const block = completeWork(works, rules);
      expect(pricing.blockSeconds(0, level)).toBe(Math.round((block.seconds.value ?? 0) * 1000));
      expect(pricing.blockKillXp(0, level)).toBe(block.killXp.value);
    }
  });

  it('chooses the item drop NPC nearest the step’s point through the slice’s spawns', () => {
    expect(lookup.item(itemId(500))?.dropNpcs).toEqual([20, 21]);
    expect(lookup.spawns({ kind: 'npc', id: npcId(21) })).toHaveLength(1);
    expect(lookup.spawns({ kind: 'npc', id: npcId(99) })).toEqual([]);
  });

  it('makes a block with an unpriceable target unknown, keeping its known kill XP', () => {
    const pricing = new Pricing(problem);
    expect(pricing.blockSeconds(1, 12)).toBe(-1);
    expect(pricing.blockKillXp(1, 12)).toBeGreaterThan(0);
  });

  it('prices quest XP with questXp, unknown as −1', () => {
    const pricing = new Pricing(problem);
    for (const level of [8, 12, 16]) {
      const expected = questXp({ questId: questId(1), xp: slice.questXp[0]?.xp ?? null, requiredLevel: 8, dungeonQuest: false, playerLevel: level }, rules).xp.value;
      expect(pricing.questXp(0, level)).toBe(expected);
    }
    expect(pricing.questXp(1, 10)).toBe(-1);
  });

  it('memoises per level: the order of the queries never changes an answer', () => {
    const a = new Pricing(problem);
    const b = new Pricing(problem);
    const levels = [3, 17, 9, 12, 3, 30];
    const forward = levels.map((level) => [a.blockSeconds(0, level), a.blockKillXp(0, level), a.questXp(0, level)]);
    const backward = [...levels].reverse().map((level) => [b.blockSeconds(0, level), b.blockKillXp(0, level), b.questXp(0, level)]).reverse();
    expect(backward).toEqual(forward);
  });

  it('prices riding and grinds per transition with the sim functions', () => {
    const pricing = new Pricing(problem);
    expect(pricing.train(0, 39, 0, 0)).toBe(0);
    expect(pricing.train(0, 40, 0, 0)).toBe(1);
    expect(pricing.train(0, 39, 1, 0)).toBe(1);
    const curve = xpCurveOf(rules);
    const expected = grind({ until: { kind: 'level', level: 12, offset: null }, mobLevel: null, xpPerHour: null, state: { level: 11, xp: 500 }, unknownXpEvents: 0, place: 'open-world' }, curve, rules);
    const priced = pricing.grind(slice.grinds[0] as PricingSlice['grinds'][number], 11, 500, 0);
    expect(priced.ms).toBe(Math.round((expected.seconds.value ?? 0) * 1000));
    expect([priced.level, priced.xpInto, priced.xpGained]).toEqual([expected.state.level, expected.state.xp, expected.xpGained.value]);
  });
});
