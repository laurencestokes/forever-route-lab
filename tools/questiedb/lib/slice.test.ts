import { describe, expect, it } from 'vitest';
import type { Dataset, DatasetDetail } from './dataset';
import { CLASS_TOKENS } from './overlays';
import type { AreaRow, ClassLayer, FactionLayer, ItemRow, NpcRow, PointMap, QuestRow, UiMapRow } from './shapes';
import { sliceDataset } from './slice';

/** The closure the fixture slice takes (code-F13), on a synthetic dataset. */

const provenance = { upstreamDiff: 'era', foreverStatus: 'unknown', corrected: false, created: false, source: 'questiedb' } as const;
const quest = (id: number, fields: Partial<QuestRow>): QuestRow => ({
  id,
  name: `Quest ${String(id)}`,
  level: 1,
  minLevel: 1,
  maxLevel: null,
  races: null,
  classes: null,
  zoneOrSort: 14,
  dungeonQuest: false,
  starters: [],
  finishers: [],
  objectives: [],
  objectiveHints: [],
  objectivesText: null,
  prerequisites: {
    preQuestSingle: [],
    preQuestGroup: [],
    exclusiveTo: [],
    nextQuestInChain: null,
    parentQuest: null,
    childQuests: [],
    inGroupWith: [],
    breadcrumbForQuestId: null,
    breadcrumbs: [],
    availableUntilCompleted: null,
    availableStartingWith: null,
    disabledByQuest: null,
  },
  requirements: { skill: null, minReputation: null, maxReputation: null, spell: null, specialization: null, sourceItemId: null, requiredSourceItems: [] },
  reputationReward: [],
  flags: { repeatable: false, needsEvent: false, questFlags: 0, specialFlags: 0 },
  xp: null,
  provenance,
  ...fields,
});
const npc = (id: number, fields: Partial<NpcRow> = {}): NpcRow => ({
  id,
  name: `NPC ${String(id)}`,
  subName: null,
  minLevel: 1,
  maxLevel: 1,
  rank: 0,
  zoneId: null,
  npcFlags: 0,
  friendlyTo: 'H',
  questStarts: [],
  questEnds: [],
  provenance,
  ...fields,
});
const item = (id: number, fields: Partial<ItemRow> = {}): ItemRow => ({ id, name: `Item ${String(id)}`, itemClass: 12, dropNpcs: [], dropObjects: [], dropItems: [], startsQuest: null, provenance, ...fields });
const emptyLayer = (): FactionLayer => ({ quests: {}, npcs: {}, objects: {}, items: {}, dungeons: {} });
const classes = (): Readonly<Record<string, ClassLayer>> => Object.fromEntries(CLASS_TOKENS.map((token) => [token, { quests: {} }]));
const FLAGS = { flightMaster: 8, trainer: 16, innkeeper: 128 };

describe('fixture slice closure', () => {
  const full: Dataset = {
    quests: [
      quest(1, { starters: [{ kind: 'npc', id: 1 }], objectives: [{ kind: 'item', itemId: 10, label: null, count: null }] }),
      quest(2, { starters: [{ kind: 'npc', id: 2 }] }),
    ],
    npcs: [npc(1), npc(2), npc(3), npc(4, { npcFlags: 8 }), npc(5, { questEnds: [1] }), npc(6), npc(7, { npcFlags: 8 })],
    objects: [],
    items: [item(10, { dropNpcs: [3], dropItems: [11] }), item(11), item(12, { startsQuest: 1 }), item(13)],
    spawns: {
      npc: new Map<number, PointMap>([
        [1, { 363: [[40, 60]] }],
        [2, { 12: [[50, 50]] }],
        [4, { 14: [[45, 55]] }],
        [7, { 12: [[10, 10]] }],
      ]),
      object: new Map(),
    },
    zones: {
      areas: new Map<number, AreaRow>([
        [12, { uiMapId: 1429, link: 'direct' }],
        [14, { uiMapId: 1411, link: 'direct' }],
        [363, { uiMapId: 1411, link: 'routed' }],
        [209, { uiMapId: 310, link: 'legacy-compat' }],
      ]),
      uiMaps: new Map<number, UiMapRow>([
        [1411, { name: 'Durotar', nameSource: null, areaId: 14 }],
        [1429, { name: 'Elwynn Forest', nameSource: null, areaId: 12 }],
      ]),
      dungeons: new Map(),
      instanceAreas: new Map(),
    },
    overlays: {
      faction: { Alliance: { ...emptyLayer(), quests: { 1: { starters: [{ kind: 'npc', id: 6 }] } } }, Horde: emptyLayer() },
      class: { Alliance: classes(), Horde: classes() },
    },
    detail: {} as DatasetDetail,
  };
  const region = { uiMapId: 1411, label: 'Durotar' };
  const sliced = sliceDataset(full, region, FLAGS);

  it('takes the region from direct and routed links to the UiMap, never other link kinds', () => {
    expect(sliced.regionAreas).toEqual([14, 363]);
  });

  it('keeps quests whose givers spawn in the region, and everything they reference', () => {
    expect(sliced.dataset.quests.map((q) => q.id)).toEqual([1]);
    // 1 starter, 3 drops the objective item, 4 a flight master in the region, 5 names quest 1,
    // 6 the Alliance overlay's starter. 2 and 7 spawn outside the region.
    expect(sliced.dataset.npcs.map((n) => n.id)).toEqual([1, 3, 4, 5, 6]);
    // 10 the objective, 11 its container (dropItems closure), 12 starts quest 1; 13 is unrelated.
    expect(sliced.dataset.items.map((i) => i.id)).toEqual([10, 11, 12]);
    expect([...sliced.dataset.spawns.npc.keys()]).toEqual([1, 4]);
  });

  it('keeps only the zone rows the slice uses', () => {
    expect([...sliced.dataset.zones.areas.keys()]).toEqual([14, 363]);
    expect([...sliced.dataset.zones.uiMaps.keys()]).toEqual([1411]);
    expect(sliced.dataset.overlays.faction.Alliance.quests).toEqual({ 1: { starters: [{ kind: 'npc', id: 6 }] } });
  });
});
