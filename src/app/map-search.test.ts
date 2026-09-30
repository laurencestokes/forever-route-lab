import { describe, expect, it } from 'vitest';
import type { NpcId, ObjectId, QuestId, UiMapId, WorldMapId } from '../domain';
import { createMapSearchIndex, foldText, MAP_SEARCH_MIN_CHARS, type MapSearchPlace, resultPoint, resultZone, searchFilterOf } from './map-search';
import { stubDataset, stubNpc, stubObject, stubQuest, worldSpawn } from './map-test-helpers';

/*
 * The map search's index (docs/research/map-presentation.md §25.3.5; step MP.4c): quests, the NPCs
 * and objects they name, flight masters and zones; folded matching, prefix matches first; the map
 * mask of a result set, and where a result is on the map.
 */

const npc = (id: number): NpcId => id as NpcId;
const obj = (id: number): ObjectId => id as ObjectId;
const quest = (id: number): QuestId => id as QuestId;
const zone = (id: number): UiMapId => id as UiMapId;
const map = (id: number): WorldMapId => id as WorldMapId;

const DATASET = stubDataset({
  quests: [
    stubQuest({ id: quest(1), name: 'Sarkoth', starters: [{ kind: 'npc', id: npc(10) }], finishers: [{ kind: 'npc', id: npc(10) }], objectives: [{ kind: 'kill', npcId: npc(11), label: null, count: 1 }] }),
    stubQuest({ id: quest(2), name: 'The Dark Portal', starters: [{ kind: 'item', id: 5 as never }, { kind: 'object', id: obj(20) }], objectives: [{ kind: 'object', objectId: obj(21), label: null, count: 1 }] }),
    stubQuest({ id: quest(3), name: 'Zul’Farrak Déjà vu', starters: [{ kind: 'npc', id: npc(12) }] }),
  ],
  npcs: [stubNpc({ id: npc(10), name: 'Gornek' }), stubNpc({ id: npc(11), name: 'Sarkoth' }), stubNpc({ id: npc(12), name: 'Déjà Mage' }), stubNpc({ id: npc(13), name: 'Doras' }), stubNpc({ id: npc(99), name: 'Nobody named' })],
  objects: [stubObject({ id: obj(20), name: 'Portal Stone' }), stubObject({ id: obj(21), name: 'Dark Crate' })],
  spawns: {
    'npc:10': [worldSpawn(map(1), -600, -4200, zone(1411))],
    'npc:13': [worldSpawn(map(1), 1600, -4400, zone(1454))],
    'object:20': [{ source: { kind: 'instance', areaId: 1 as never }, world: null, uiMapId: null }, worldSpawn(map(0), -11000, -3200, zone(1419))],
  },
  zones: [
    { uiMapId: zone(1411), name: 'Durotar', worldMapId: map(1) },
    { uiMapId: zone(1419), name: 'Blasted Lands', worldMapId: map(0) },
    { uiMapId: zone(1463), name: null, worldMapId: map(0) },
  ],
});

const INDEX = createMapSearchIndex(DATASET, [npc(13)]);
const keys = (query: string) => INDEX.search(query).items.map((item) => item.key);

describe('the map search index (§25.3.5)', () => {
  it('folds case and accents', () => {
    expect(foldText('Zul’Farrak Déjà vu')).toBe('zul’farrak deja vu');
    expect(foldText('ÉLWYNN')).toBe('elwynn');
  });

  it('holds the quests, the NPCs and objects they name, the flight masters and the named zones, once each', () => {
    expect(INDEX.size).toBe(11);
    // Doras is a flight master and no quest names him; the NPC no quest names is not in the index.
    expect(keys('doras')).toEqual(['npc:13']);
    expect(INDEX.search('doras').items[0]).toMatchObject({ kind: 'flight-point', group: 'travel' });
    expect(keys('nobody')).toEqual([]);
    // A zone with no validated name is left out rather than named by its id.
    expect(INDEX.search('1463').items).toEqual([]);
  });

  it('starts at two characters, and lists prefix matches before other matches, each by name', () => {
    expect(MAP_SEARCH_MIN_CHARS).toBe(2);
    expect(INDEX.search('d').items).toEqual([]);
    expect(INDEX.search(' s ').items).toEqual([]);
    // "Dark Crate", "Déjà Mage", "Doras" start with "d"…; "The Dark Portal" does not.
    expect(keys('da')).toEqual(['object:21', 'quest:2']);
    // The quest and the NPC of one name: both, by key.
    expect(keys('SARK')).toEqual(['npc:11', 'quest:1']);
    expect(keys('deja')).toEqual(['npc:12', 'quest:3']);
    expect(keys('portal')).toEqual(['object:20', 'quest:2']);
  });

  it('places a quest at its first placed giver, skipping items, and a zone nowhere (it jumps instead)', () => {
    const [portal] = INDEX.search('the dark').items;
    if (portal === undefined) throw new Error('no result');
    // The item starter has no place; the object's first spawn is inside an instance with no entrance.
    expect(resultPoint(DATASET, portal)).toEqual({ mapId: 0, x: -11000, y: -3200 });
    const [durotar] = INDEX.search('duro').items;
    if (durotar === undefined) throw new Error('no result');
    expect(resultPoint(DATASET, durotar)).toBeNull();
    expect(resultZone(durotar)).toBe(1411);
    const [sarkoth] = INDEX.search('sarkoth').items;
    if (sarkoth === undefined) throw new Error('no result');
    // An NPC with no spawn in the data has no place: unknown stays unknown.
    expect(resultPoint(DATASET, sarkoth)).toBeNull();
  });

  it('turns a result set into the map’s mask: the places and the quests found, never the zones', () => {
    expect(searchFilterOf(INDEX.search('d').items)).toEqual({ subjects: [], quests: [], places: [] });
    expect(searchFilterOf([...INDEX.search('sark').items, ...INDEX.search('duro').items])).toEqual({ subjects: ['npc:11'], quests: [1], places: [] });
  });

  it('finds the places model’s places by name and by kind, in their groups, and masks and places them by their pins (review PR-05)', () => {
    const at = (x: number) => ({ mapId: map(1), x, y: -4000 });
    const places: MapSearchPlace[] = [
      { key: 'place:dungeon:718', kind: 'dungeon', id: 0, name: 'Wailing Caverns', also: 'dungeon instance', pins: ['dungeon:718'], point: at(-800), what: 'Dungeon entrance', category: 'dungeons' },
      { key: 'place:flight:25', kind: 'taxi-node', id: 0, name: 'Crossroads, The Barrens', also: 'flight point', pins: ['flight:25'], point: at(-400), what: 'Flight point', category: 'flight-points' },
      { key: 'place:stop:1', kind: 'transport', id: 0, name: 'Orgrimmar, Zeppelin to Undercity', also: 'transport stop', pins: ['stop:1'], point: at(1500), what: 'Transport stop', category: 'transport-stops' },
      // A service NPC takes its NPC key, so it is found under Services and not again as a quest's NPC.
      { key: 'npc:10', kind: 'service', id: 10, name: 'Gornek', also: 'Innkeeper', pins: ['service:npc:10:0', 'service:npc:10:1'], point: at(-600), what: 'Innkeeper', category: 'innkeepers' },
    ];
    const index = createMapSearchIndex(DATASET, [npc(13)], places);
    const first = (query: string) => index.search(query).items[0];
    expect(first('wailing')).toMatchObject({ kind: 'dungeon', group: 'instances' });
    expect(first('crossroads')).toMatchObject({ kind: 'taxi-node', group: 'travel' });
    expect(first('zeppelin')).toMatchObject({ kind: 'transport', group: 'travel' });
    // By kind: "innkeeper" finds the innkeeper NPC under Services.
    expect(index.search('innkeeper').items.map((item) => [item.key, item.group])).toEqual([['npc:10', 'services']]);
    expect(index.search('gornek').items.map((item) => item.key)).toEqual(['npc:10']);
    // The mask keeps a found place's pins; the point is its first pin's.
    const wailing = first('wailing');
    if (wailing === undefined) throw new Error('no result');
    expect(resultPoint(DATASET, wailing)).toEqual(at(-800));
    expect(searchFilterOf(index.search('innkeeper').items)).toEqual({ subjects: [], quests: [], places: ['service:npc:10:0', 'service:npc:10:1'] });
  });
});
