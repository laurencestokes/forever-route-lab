import { describe, expect, it } from 'vitest';
import { jsonOf, publicSite } from '../../../tests/support/fake-fetch';
import { SITE } from '../../../tests/support/fixture-dataset';
import { DATA_JSON_FILES } from './rows';
import { readDataFile } from './schema';

type Json = Record<string, unknown>;

const PUBLIC = publicSite();

/** A deep copy of one fixture file, to edit. */
const copy = (file: string): Json => structuredClone(jsonOf(SITE, `data/${file}`)) as Json;

const rows = (json: Json, key = 'rows'): Json[] => json[key] as Json[];
const first = (list: Json[]): Json => {
  const [head] = list;
  if (head === undefined) throw new Error('fixture list is empty');
  return head;
};

const errorsOf = (file: (typeof DATA_JSON_FILES)[number], json: unknown): readonly string[] => {
  const result = readDataFile(file, json);
  return result.ok ? [] : result.errors;
};

describe('readDataFile', () => {
  it.each(DATA_JSON_FILES)('accepts the fixture slice %s and strips _generated', (file) => {
    const result = readDataFile(file, jsonOf(SITE, `data/${file}`));
    expect(result.ok ? [] : result.errors).toEqual([]);
    if (result.ok) expect('_generated' in result.content).toBe(false);
  });

  it.each(DATA_JSON_FILES)('accepts the committed public/data %s', (file) => {
    expect(errorsOf(file, jsonOf(PUBLIC, `data/${file}`))).toEqual([]);
  });

  it('refuses a record with a missing or an unexpected key, naming the path', () => {
    const missing = copy('quests.json');
    delete first(rows(missing))['objectivesText'];
    expect(errorsOf('quests.json', missing)).toEqual(['quests.json.rows[0].objectivesText: missing']);
    const extra = copy('entities.json');
    first(rows(extra, 'npcs'))['health'] = 100;
    expect(errorsOf('entities.json', extra)).toEqual(['entities.json.npcs[0].health: unexpected key']);
  });

  it('refuses values the extractor never writes: a declared Forever status, a user XP basis', () => {
    const status = copy('items.json');
    first(rows(status))['provenance'] = { upstreamDiff: 'era', foreverStatus: 'user-declared-new', corrected: false, created: false, source: 'questiedb' };
    expect(errorsOf('items.json', status)[0]).toMatch(/^items\.json\.rows\[0\]\.provenance\.foreverStatus: expected one of "unknown"/);
    const xp = copy('quests.json');
    first(rows(xp))['xp'] = { questLevel: 7, baseXp: 630, basis: 'user' };
    expect(errorsOf('quests.json', xp)[0]).toMatch(/^quests\.json\.rows\[0\]\.xp\.basis: expected one of "era-seed"/);
  });

  it('refuses rows out of id order', () => {
    const json = copy('items.json');
    const list = rows(json);
    json['rows'] = [list[1], list[0], ...list.slice(2)];
    expect(errorsOf('items.json', json)).toEqual([expect.stringMatching(/^items\.json\.rows\[1\]\.id: ids must be unique and ascending/)]);
  });

  it('refuses a malformed point, an unknown area link and a bad overlay patch', () => {
    const spawns = copy('spawns.json');
    (spawns['npc'] as Record<string, Record<string, unknown>>)['3143'] = { '14': [[-1, 68.33]] };
    expect(errorsOf('spawns.json', spawns)).toEqual(['spawns.json.npc.3143.14[0]: malformed instance-presence sentinel (must be exactly [-1, -1])']);
    const zones = copy('zones.json');
    (zones['areas'] as Record<string, unknown>)['14'] = { uiMapId: 1411, link: 'guessed' };
    expect(errorsOf('zones.json', zones)[0]).toMatch(/^zones\.json\.areas\.14\.link: expected one of "direct", "routed", "synthetic-alias", "legacy-compat", "suppressed"/);
    // The M2 fixture's single link class is gone (split into direct and routed, COORD-3).
    (zones['areas'] as Record<string, unknown>)['14'] = { uiMapId: 1411, link: 'native' };
    expect(errorsOf('zones.json', zones)).toHaveLength(1);
    const overlays = copy('overlays.json');
    ((overlays['faction'] as Json)['Horde'] as Json)['quests'] = { '8670': { id: 8670 } };
    expect(errorsOf('overlays.json', overlays)).toEqual(['overlays.json.faction.Horde.quests.8670.id: unexpected key']);
  });

  it('reads both link classes of the base table, direct and routed (COORD-3)', () => {
    const zones = copy('zones.json');
    const areas = zones['areas'] as Record<string, { uiMapId: number; link: string }>;
    // 14 is Durotar's own AreaId (a direct frame); 363 Valley of Trials is routed to Durotar's UiMap.
    expect(areas['14']).toEqual({ uiMapId: 1411, link: 'direct' });
    expect(areas['363']).toEqual({ uiMapId: 1411, link: 'routed' });
    expect(errorsOf('zones.json', zones)).toEqual([]);
  });

  it('requires every dungeon entrance to say whether its frame is verified (COORD-4)', () => {
    const zones = copy('zones.json');
    const entrance = { areaId: 215, x: 36.85, y: 35.86 };
    zones['dungeons'] = { '5861': { name: 'Darkmoon Faire Island', alternativeAreaIds: [], parentZoneAreaId: 215, entrances: [entrance] } };
    expect(errorsOf('zones.json', zones)).toEqual(['zones.json.dungeons.5861.entrances[0].frameVerified: missing']);
    zones['dungeons'] = { '5861': { name: 'Darkmoon Faire Island', alternativeAreaIds: [], parentZoneAreaId: 215, entrances: [{ ...entrance, frameVerified: false }] } };
    expect(errorsOf('zones.json', zones)).toEqual([]);
    const full = jsonOf(PUBLIC, 'data/zones.json') as { dungeons: Record<string, { entrances: { frameVerified: boolean }[] }> };
    const unverified = Object.entries(full.dungeons).filter(([, d]) => d.entrances.some((e) => !e.frameVerified)).map(([key]) => Number(key));
    expect(unverified).toEqual([5861, 6618, 10001]);
  });

  it('refuses a 0 in a single-id field, which the extractor ships as null (code-F8)', () => {
    const quests = copy('quests.json');
    const quest = first(rows(quests));
    const prerequisites = quest['prerequisites'] as Json;
    prerequisites['nextQuestInChain'] = 0;
    prerequisites['parentQuest'] = 0;
    (quest['requirements'] as Json)['sourceItemId'] = 0;
    quest['zoneOrSort'] = 0;
    expect(errorsOf('quests.json', quests)).toEqual([
      'quests.json.rows[0].zoneOrSort: expected a non-zero integer, got 0',
      'quests.json.rows[0].prerequisites.nextQuestInChain: expected an integer >= 1, got 0',
      'quests.json.rows[0].prerequisites.parentQuest: expected an integer >= 1, got 0',
      'quests.json.rows[0].requirements.sourceItemId: expected an integer >= 1, got 0',
    ]);
    const entities = copy('entities.json');
    first(rows(entities, 'npcs'))['zoneId'] = 0;
    first(rows(entities, 'objects'))['zoneId'] = 0;
    expect(errorsOf('entities.json', entities)).toEqual([
      'entities.json.npcs[0].zoneId: expected an integer >= 1, got 0',
      'entities.json.objects[0].zoneId: expected an integer >= 1, got 0',
    ]);
    const items = copy('items.json');
    first(rows(items))['startsQuest'] = 0;
    expect(errorsOf('items.json', items)).toEqual(['items.json.rows[0].startsQuest: expected an integer >= 1, got 0']);
    // The same rule holds in overlay patches: the Horde patch of 1198 clears nextQuestInChain with null.
    const overlays = copy('overlays.json');
    ((overlays['faction'] as Json)['Horde'] as Json)['quests'] = { '788': { prerequisites: { ...prerequisites, nextQuestInChain: null, parentQuest: 0 } } };
    expect(errorsOf('overlays.json', overlays)).toEqual(['overlays.json.faction.Horde.quests.788.prerequisites.parentQuest: expected an integer >= 1, got 0']);
    const full = jsonOf(PUBLIC, 'data/overlays.json') as { faction: { Horde: { quests: Record<string, { prerequisites?: { nextQuestInChain: number | null } }> } } };
    expect(full.faction.Horde.quests['1198']?.prerequisites?.nextQuestInChain).toBeNull();
  });

  it('keeps signed ids signed: a negative zoneOrSort (a QuestSort) and requirements.spell pass', () => {
    const quests = copy('quests.json');
    const quest = first(rows(quests));
    quest['zoneOrSort'] = -22;
    (quest['requirements'] as Json)['spell'] = -1234;
    expect(errorsOf('quests.json', quests)).toEqual([]);
  });

  it('refuses a file without its _generated marker', () => {
    const json = copy('zones.json');
    delete json['_generated'];
    expect(errorsOf('zones.json', json)).toEqual(['zones.json._generated: missing']);
  });
});
