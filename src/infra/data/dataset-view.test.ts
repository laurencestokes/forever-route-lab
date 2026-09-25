import { describe, expect, it } from 'vitest';
import type { CustomQuest, QuestOverride } from '../../domain/project';
import { itemId, npcId, objectId, questId, uiMapId } from '../../domain/ids';
import { zoneSourcedPoint } from '../../domain/points';
import { publicSite } from '../../../tests/support/fake-fetch';
import { HORDE_WARRIOR, fixturePrepared, fixtureView, placeholderGeometry, siteFiles, siteManifest } from '../../../tests/support/fixture-dataset';
import { applyQuestOverride, createDatasetView, createDatasetViewCache, type DatasetViewInput, prepareDataset } from './dataset-view';
import { identityOf } from './manifest';
import type { DatasetFiles, DungeonRow } from './rows';

const GORNEK = npcId(3143);
const files = siteFiles();
const identity = identityOf(siteManifest());
const geometry = placeholderGeometry();

const input = (patch: Partial<DatasetViewInput> = {}): DatasetViewInput => ({ ...HORDE_WARRIOR, ...patch });

/** The fixture files with extra overlay layers and spawns, for the cases the slice lacks. */
function withOverlays(edit: (files: DatasetFiles) => DatasetFiles): DatasetFiles {
  return edit(structuredClone(files));
}

function customQuest(id: number, name: string): CustomQuest {
  const base = fixtureView().quest(questId(788));
  if (base === undefined) throw new Error('fixture quest 788 missing');
  const { provenance, xp, ...rest } = base;
  return {
    ...rest,
    id: questId(id),
    name,
    xp,
    provenance: { ...provenance, source: 'custom' },
    starterLocation: null,
    finisherLocation: null,
  };
}

describe('prepareDataset + createDatasetView over the fixture slice', () => {
  const view = fixtureView();

  it('says what it is and lists every quest in ascending id order', () => {
    expect(view.identity).toEqual(identity);
    const ids = view.quests().map((q) => q.id);
    expect(ids).toHaveLength(96);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(view.quest(questId(788))?.name).toBe('Cutting Teeth');
    expect(view.quest(questId(1))).toBeUndefined();
  });

  it('looks up NPCs, objects and items', () => {
    expect(view.npc(GORNEK)?.name).toBe('Gornek');
    expect(view.object(objectId(3189))?.name).toBeDefined();
    expect(view.item(itemId(4859))?.name).toBe('Burning Blade Medallion');
  });

  it('converts spawns once to published points with world positions (Gornek, coordinates.md §7)', () => {
    const [spawn, ...rest] = view.spawns({ kind: 'npc', id: GORNEK });
    expect(rest).toEqual([]);
    expect(spawn?.source).toEqual(zoneSourcedPoint(uiMapId(1411), 42.06, 68.33, 'forever'));
    expect(spawn?.uiMapId).toBe(1411);
    expect(spawn?.world?.mapId).toBe(1);
    expect(spawn?.world?.x).toBeCloseTo(-600.3, 1);
    expect(spawn?.world?.y).toBeCloseTo(-4186.42, 1);
    expect(view.spawns({ kind: 'npc', id: GORNEK })).toBe(view.spawns({ kind: 'npc', id: GORNEK }));
    expect(view.spawns({ kind: 'item', id: itemId(4859) })).toEqual([]);
    expect(view.spawns({ kind: 'npc', id: npcId(999_999) })).toEqual([]);
  });

  it('turns event objective points into published points', () => {
    const spider = view.quest(questId(2936));
    const event = spider?.objectives.find((o) => o.kind === 'event');
    expect(event).toEqual({ kind: 'event', text: "Find the Spider God's Name", points: [zoneSourcedPoint(uiMapId(1446), 38.73, 19.88, 'forever')] });
  });

  it('counts the conversion: every fixture spawn has a world position', () => {
    const stats = fixturePrepared().spawnStats;
    expect(stats.points).toBe(1349);
    expect(stats.resolved).toBe(stats.points);
    expect(stats.presence).toBe(0);
  });

  it('lists zones ascending: the named UiMaps and every UiMap of the geometry', () => {
    const zones = view.zones();
    const ids = zones.map((z) => z.uiMapId);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(view.zone(uiMapId(1411))).toEqual({ uiMapId: 1411, name: 'Durotar', worldMapId: 1 });
    // In the geometry but named by no QuestieDB table: no validated name (DATA_PROVENANCE §6.6).
    expect(view.zone(uiMapId(1463))).toEqual({ uiMapId: 1463, name: null, worldMapId: 0 });
    // Azeroth has rows on two world maps.
    expect(view.zone(uiMapId(947))?.worldMapId).toBeNull();
    expect(ids).toHaveLength(new Set([...Object.keys(files.zones.uiMaps).map(Number), ...geometry.maps.keys()]).size);
  });

  it('is deterministic: preparing twice gives equal views', () => {
    const again = createDatasetView(prepareDataset(files, identity, geometry), HORDE_WARRIOR);
    expect(JSON.stringify(again.quests())).toBe(JSON.stringify(view.quests()));
    expect(JSON.stringify(again.zones())).toBe(JSON.stringify(view.zones()));
    expect(JSON.stringify(again.spawns({ kind: 'npc', id: GORNEK }))).toBe(JSON.stringify(view.spawns({ kind: 'npc', id: GORNEK })));
  });
});

describe('prepareDataset over the committed public/data', () => {
  const site = publicSite();
  const prepared = prepareDataset(siteFiles(site), identityOf(siteManifest(site)), placeholderGeometry(site));

  it('places every drawable spawn and keeps presence and unverified entrances unknown (COORD-3, COORD-4)', () => {
    // 76,294 points on direct AreaIDs and 6 on synthetic aliases, none on a routed key; 1,282
    // presence markers, of which 902 reach a single, frame-verified entrance.
    expect(prepared.spawnStats).toEqual({
      points: 77_582,
      resolved: 76_300,
      zoneWithoutGeometry: 0,
      presence: 1_282,
      presenceAtEntrance: 902,
      unmapped: { suppressed: 0, 'instance-area': 0, 'no-uimap': 0 },
    });
  });

  it('reads single ids that upstream writes as 0 as null, never as id 0 (code-F8)', () => {
    const horde = createDatasetView(prepared, input({ faction: 'Horde' }));
    for (const quest of horde.quests()) {
      const p = quest.prerequisites;
      for (const id of [p.nextQuestInChain, p.parentQuest, p.breadcrumbForQuestId, p.availableUntilCompleted, p.availableStartingWith, p.disabledByQuest]) {
        expect(id === null || id > 0).toBe(true);
      }
      expect(quest.zoneOrSort).not.toBe(0);
    }
    // The Horde layer clears 1198's next quest (upstream's 0, normalised to null over the static 1200).
    expect(horde.quest(questId(1198))?.prerequisites.nextQuestInChain).toBeNull();
    expect(createDatasetView(prepared, input({ faction: 'Alliance' })).quest(questId(1198))?.prerequisites.nextQuestInChain).toBe(1200);
  });
});

describe('overlays (static → faction → class, DATA_PROVENANCE §6.7)', () => {
  it('applies the faction layer from the character: quest 8670 rewards the faction’s own reputation', () => {
    const horde = fixtureView(input({ faction: 'Horde' }));
    const alliance = fixtureView(input({ faction: 'Alliance' }));
    expect(horde.quest(questId(8670))?.reputationReward).toEqual([{ factionId: 67, value: 50 }]);
    expect(alliance.quest(questId(8670))?.reputationReward).toEqual([{ factionId: 469, value: 50 }]);
    // Unpatched records are shared between personas.
    expect(horde.quest(questId(788))).toBe(alliance.quest(questId(788)));
    expect(horde.quests().find((q) => q.id === 8670)).toBe(horde.quest(questId(8670)));
  });

  it('applies the class layer after the faction layer', () => {
    const edited = withOverlays((f) => ({
      ...f,
      overlays: {
        ...f.overlays,
        faction: { ...f.overlays.faction, Horde: { ...f.overlays.faction.Horde, quests: { '788': { minLevel: 2, maxLevel: 9 } } } },
        class: { ...f.overlays.class, Horde: { ...f.overlays.class.Horde, WARRIOR: { quests: { '788': { minLevel: 3 } } } } },
      },
    }));
    const prepared = prepareDataset(edited, identity, geometry);
    const warrior = createDatasetView(prepared, input({ class: 'WARRIOR' })).quest(questId(788));
    const mage = createDatasetView(prepared, input({ class: 'MAGE' })).quest(questId(788));
    const alliance = createDatasetView(prepared, input({ faction: 'Alliance', class: 'WARRIOR' })).quest(questId(788));
    expect([warrior?.minLevel, warrior?.maxLevel]).toEqual([3, 9]);
    expect([mage?.minLevel, mage?.maxLevel]).toEqual([2, 9]);
    expect([alliance?.minLevel, alliance?.maxLevel]).toEqual([1, null]);
  });

  it('replaces an entity’s record and spawns from its faction patch', () => {
    const edited = withOverlays((f) => ({
      ...f,
      overlays: {
        ...f.overlays,
        faction: { ...f.overlays.faction, Alliance: { ...f.overlays.faction.Alliance, npcs: { '3143': { subName: 'Moved', spawns: { '14': [[50, 50]] } } } } },
      },
    }));
    const prepared = prepareDataset(edited, identity, geometry);
    const alliance = createDatasetView(prepared, input({ faction: 'Alliance' }));
    const horde = createDatasetView(prepared, input({ faction: 'Horde' }));
    expect(alliance.npc(GORNEK)?.subName).toBe('Moved');
    expect(horde.npc(GORNEK)?.subName).toBe(fixtureView().npc(GORNEK)?.subName);
    expect(alliance.spawns({ kind: 'npc', id: GORNEK }).map((s) => s.source)).toEqual([zoneSourcedPoint(uiMapId(1411), 50, 50, 'forever')]);
    expect(horde.spawns({ kind: 'npc', id: GORNEK }).map((s) => s.source)).toEqual([zoneSourcedPoint(uiMapId(1411), 42.06, 68.33, 'forever')]);
  });
});

describe('unmapped areas and instance presence', () => {
  const dungeon = (x: number, y: number): DungeonRow => ({ name: 'Arathi Basin', alternativeAreaIds: [], parentZoneAreaId: 14, entrances: [{ areaId: 14, x, y, frameVerified: true }] });
  // NPC 3143's spawns replaced by one of each kind of published point (real area links only).
  const edited = withOverlays((f) => ({
    ...f,
    spawns: { ...f.spawns, npc: { ...f.spawns.npc, '3143': { '14': [[42.06, 68.33]], '209': [[30, 40]], '2257': [[5, 5]], '3358': [[-1, -1]], '424242': [[1, 2]] } } },
    zones: {
      ...f.zones,
      areas: { ...f.zones.areas, '209': { uiMapId: 310, link: 'legacy-compat' }, '2257': { uiMapId: 0, link: 'suppressed' } },
      instanceAreas: { ...f.zones.instanceAreas, '3358': { dungeonAreaId: 3358 } },
    },
    overlays: {
      ...f.overlays,
      faction: {
        Alliance: { ...f.overlays.faction.Alliance, dungeons: { '3358': dungeon(10, 10) } },
        Horde: { ...f.overlays.faction.Horde, dungeons: { '3358': dungeon(90, 90) } },
      },
    },
  }));
  const prepared = prepareDataset(edited, identity, geometry);

  it('keeps every published point with its kind and reason; only zone points and known entrances get a world position', () => {
    const spawns = createDatasetView(prepared, input({ faction: 'Horde' })).spawns({ kind: 'npc', id: GORNEK });
    expect(spawns.map((s) => s.source)).toEqual([
      zoneSourcedPoint(uiMapId(1411), 42.06, 68.33, 'forever'),
      { kind: 'unmapped', areaId: 209, x: 30, y: 40, reason: 'instance-area' },
      { kind: 'unmapped', areaId: 2257, x: 5, y: 5, reason: 'suppressed' },
      { kind: 'instance', areaId: 3358 },
      { kind: 'unmapped', areaId: 424242, x: 1, y: 2, reason: 'no-uimap' },
    ]);
    expect(spawns.map((s) => s.world !== null)).toEqual([true, false, false, true, false]);
    expect(spawns.map((s) => s.uiMapId)).toEqual([1411, null, null, 1411, null]);
    expect(prepared.spawnStats.unmapped).toEqual({ suppressed: 1, 'instance-area': 1, 'no-uimap': 1 });
  });

  it('resolves presence in a faction-dependent dungeon to that faction’s entrance', () => {
    const at = (faction: 'Alliance' | 'Horde') => createDatasetView(prepared, input({ faction })).spawns({ kind: 'npc', id: GORNEK })[3]?.world;
    const alliance = at('Alliance');
    const horde = at('Horde');
    expect(alliance).not.toBeNull();
    expect(horde).not.toBeNull();
    expect(alliance?.x).not.toBeCloseTo(horde?.x ?? 0, 0);
    // The faction-invariant base cannot know the entrance.
    expect(prepared.base.npcSpawns.get(GORNEK)?.[3]?.world).toBeNull();
  });
});

describe('custom quests and quest overrides (ARCHITECTURE §5.5)', () => {
  it('lets a custom quest replace the dataset quest with its id, and adds new ones in id order', () => {
    const replaced = customQuest(788, 'My Cutting Teeth');
    const invented = customQuest(-5, 'Invented');
    const forever = customQuest(90_001, 'A Forever quest');
    const view = fixtureView(input({ customQuests: [forever, replaced, invented] }));
    expect(view.quest(questId(788))?.name).toBe('My Cutting Teeth');
    expect(view.quest(questId(788))?.provenance.source).toBe('custom');
    expect(view.quest(questId(788))).not.toHaveProperty('starterLocation');
    const ids = view.quests().map((q) => q.id);
    expect(ids).toHaveLength(98);
    expect(ids[0]).toBe(-5);
    expect(ids.at(-1)).toBe(90_001);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('applies overrides: user XP, objective counts and a declared Forever status', () => {
    const override: QuestOverride = { xp: { questLevel: 2, baseXp: 999, basis: 'user' }, objectiveCounts: [7, null], foreverStatus: 'user-declared-changed' };
    const view = fixtureView(input({ questOverrides: { '788': override, '123456': override } }));
    const quest = view.quest(questId(788));
    expect(quest?.xp).toEqual({ questLevel: 2, baseXp: 999, basis: 'user' });
    expect(quest?.objectives[0]).toMatchObject({ kind: 'kill', count: 7 });
    expect(quest?.provenance.foreverStatus).toBe('user-declared-changed');
    expect(view.quests().find((q) => q.id === 788)).toBe(quest);
    // An override for a quest nobody has creates nothing.
    expect(view.quest(questId(123456))).toBeUndefined();
  });

  it('leaves a record alone for an all-null override', () => {
    const quest = fixtureView().quest(questId(788));
    if (quest === undefined) throw new Error('quest 788 missing');
    expect(applyQuestOverride(quest, { xp: null, objectiveCounts: null, foreverStatus: null })).toBe(quest);
    expect(applyQuestOverride(quest, { xp: null, objectiveCounts: [null], foreverStatus: null })).toBe(quest);
  });
});

describe('createDatasetViewCache', () => {
  it('returns the same view for the same inputs and a new one when an input changes', () => {
    const view = createDatasetViewCache(fixturePrepared());
    const customQuests: readonly CustomQuest[] = [];
    const questOverrides = {};
    const a = view({ faction: 'Horde', class: 'WARRIOR', customQuests, questOverrides });
    expect(view({ faction: 'Horde', class: 'WARRIOR', customQuests, questOverrides })).toBe(a);
    expect(view({ faction: 'Alliance', class: 'WARRIOR', customQuests, questOverrides })).not.toBe(a);
    const b = view({ faction: 'Horde', class: 'WARRIOR', customQuests: [], questOverrides });
    expect(b).not.toBe(a);
    expect(b.quest(questId(788))).toBe(a.quest(questId(788)));
  });
});
