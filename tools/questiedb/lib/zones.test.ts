import { describe, expect, it } from 'vitest';
import { buildZoneTables, type DeferredRow, FRAME_UNVERIFIED_ENTRANCES, readDeferredTables, readDungeons, type UnverifiedEntrance } from './zones';

const bytes = (text: string): Buffer => Buffer.from(text, 'utf8');

const AREA_FILE = `-- header
local ZoneDB = QuestieLoader:ImportModule("ZoneDB")

ZoneDB.private.areaIdToUiMapIdOverride = [[return {
    [0] = 0, -- Existing fail-safe
    [2257] = 0, -- Deeprun Tram: retain existing display suppression
    [10073] = 1414, -- Synthetic AreaID: Kalimdor continent map
    -- Legacy consumer pre-entrance lookup only
    [209] = 310, -- Referenced dungeon area
    [14] = 1411, -- Referenced dungeon area
}]]

ZoneDB.private.areaIdToUiMapId = [[
return {
    [14] = 1454, -- Durotar (overridden)
    [363] = 1411, -- Valley of Trials -> Durotar
    [616] = 2482, -- Mount Hyjal
}]]
`;

const UIMAP_FILE = `local ZoneDB = QuestieLoader:ImportModule("ZoneDB")
ZoneDB.private.uiMapIdToAreaIdOverride = [[return {
    [1414] = 10073, -- Kalimdor

    -- Legacy consumer pre-entrance lookup only, NOT native Forever floor maps.
    [310] = 209, -- Referenced dungeon area
    [1411] = 14, -- Referenced dungeon area
}]]
ZoneDB.private.uiMapIdToAreaId = [[return {
    [2482] = 616, -- Mount Hyjal
}]]
`;

const DUNGEONS = `local ZoneDB = QuestieLoader:ImportModule("ZoneDB")
local Expansions = QuestieLoader:ImportModule("Expansions")
local isHorde = UnitFactionGroup("Player") == "Horde"
local dungeons = {
    [209] = {"Shadowfang Keep",{10014},130,{{130, 44.8, 67.8}}},
    [14] = {"Fake instance",nil,14,{{14, 1, 2}}},
    [2597] = {"Alterac Valley",nil,36,{(isHorde and {36, 39.5, 80.2}) or {36, 63.6, 58.8}}},
}
if Expansions.Current >= Expansions.Wotlk then
    dungeons[209][4] = {{130, 1, 1}}
end
ZoneDB.private.dungeons = dungeons
`;

describe('deferred zone tables', () => {
  it('reads [number] = number rows with their file line and same-line comment', () => {
    const tables = readDeferredTables('area.lua', bytes(AREA_FILE), ['areaIdToUiMapIdOverride', 'areaIdToUiMapId'], 'Classic');
    const override = tables.get('areaIdToUiMapIdOverride') ?? [];
    expect(override[0]).toEqual<DeferredRow>({ key: 0, value: 0, line: 5, comment: 'Existing fail-safe' });
    expect(override.find((row) => row.key === 209)).toEqual<DeferredRow>({ key: 209, value: 310, line: 9, comment: 'Referenced dungeon area' });
    // A string that starts with a newline after [[ starts on the next line.
    expect((tables.get('areaIdToUiMapId') ?? [])[0]).toEqual<DeferredRow>({ key: 14, value: 1454, line: 15, comment: 'Durotar (overridden)' });
  });

  it('fails closed on a row that is not [number] = number', () => {
    const bad = AREA_FILE.replace('[363] = 1411,', '[363] = someName,');
    expect(() => readDeferredTables('area.lua', bytes(bad), ['areaIdToUiMapId'], 'Classic')).toThrow(/\[number\] = number/);
  });
});

const NO_UNVERIFIED: readonly UnverifiedEntrance[] = [];

describe('zone table assembly', () => {
  const dungeons = { Alliance: readDungeons(bytes(DUNGEONS), 'Alliance', 'Classic', NO_UNVERIFIED), Horde: readDungeons(bytes(DUNGEONS), 'Horde', 'Classic', NO_UNVERIFIED) };
  const build = (areaFile = AREA_FILE, uiMapFile = UIMAP_FILE, frames: readonly { uiMapId: number; areaId: number }[] = []) =>
    buildZoneTables(
      readDeferredTables('area.lua', bytes(areaFile), ['areaIdToUiMapIdOverride', 'areaIdToUiMapId'], 'Classic'),
      readDeferredTables('uimap.lua', bytes(uiMapFile), ['uiMapIdToAreaIdOverride', 'uiMapIdToAreaId'], 'Classic'),
      dungeons,
      frames,
    );

  it('applies override precedence, keeps 0 as suppressed and classifies every override row', () => {
    const zones = build();
    expect(zones.areas.get(14)).toEqual({ uiMapId: 1411, link: 'legacy-compat' });
    expect(zones.areas.get(2257)).toEqual({ uiMapId: 0, link: 'suppressed' });
    expect(zones.areas.get(10073)).toEqual({ uiMapId: 1414, link: 'synthetic-alias' });
    expect(zones.report.overriddenBaseRows).toEqual([14]);
    expect(zones.report.legacyPairs['Referenced dungeon area']).toBe(2);
  });

  it("splits base rows into direct frames (the UiMap's own AreaId) and routed subzones (COORD-3)", () => {
    const zones = build();
    // 2482's own AreaId in uiMapIdToAreaId is 616: a direct frame. 363 only routes to 1411.
    expect(zones.areas.get(616)).toEqual({ uiMapId: 2482, link: 'direct' });
    expect(zones.areas.get(363)).toEqual({ uiMapId: 1411, link: 'routed' });
    expect([zones.report.directAreas, zones.report.routedAreas]).toEqual([1, 1]);
  });

  it('cross-checks the direct links against the client frames of conversion.json', () => {
    expect(() => build(AREA_FILE, UIMAP_FILE, [{ uiMapId: 2482, areaId: 616 }])).not.toThrow();
    // A client frame whose AreaId only routes, or that is not linked at all, fails the extraction.
    expect(() => build(AREA_FILE, UIMAP_FILE, [{ uiMapId: 1411, areaId: 363 }])).toThrow(/linked as routed to UiMap 1411, not as a direct link/);
    expect(() => build(AREA_FILE, UIMAP_FILE, [{ uiMapId: 1429, areaId: 12 }])).toThrow(/not linked/);
  });

  it('names UiMaps from same-line comments only, records the source line, and leaves unlisted UiMaps unnamed', () => {
    const zones = build();
    expect(zones.uiMaps.get(1414)).toEqual({ name: 'Kalimdor', nameSource: 'questiedb:support/Forever/Zones/uiMapIdToAreaId.lua:3', areaId: 10073 });
    expect(zones.uiMaps.get(2482)).toEqual({ name: 'Mount Hyjal', nameSource: 'questiedb:support/Forever/Zones/uiMapIdToAreaId.lua:10', areaId: 616 });
    // 1411 is reached by the native link of AreaId 363 but has no name row here.
    expect(zones.uiMaps.get(1411)).toEqual({ name: null, nameSource: null, areaId: null });
    expect(zones.uiMaps.has(310)).toBe(false);
  });

  it('fails when a legacy row carries any other comment (rule 3)', () => {
    expect(() => build(AREA_FILE, UIMAP_FILE.replace('[310] = 209, -- Referenced dungeon area', '[310] = 209, -- Shadowfang Keep'))).toThrow(/rule 3/);
  });

  it('fails when a zone row has no name (rule 4)', () => {
    expect(() => build(AREA_FILE, UIMAP_FILE.replace('[2482] = 616, -- Mount Hyjal', '[2482] = 616,'))).toThrow(/rule 4/);
  });

  it('fails on an override row it cannot classify', () => {
    expect(() => build(AREA_FILE.replace('[10073] = 1414,', '[10073] = 1415,'))).toThrow(/review it/);
  });

  it('evaluates dungeons.lua per faction, with the Era expansion order', () => {
    expect(dungeons.Alliance.get(2597)?.entrances).toEqual([{ areaId: 36, x: 63.6, y: 58.8, frameVerified: true }]);
    expect(dungeons.Horde.get(2597)?.entrances).toEqual([{ areaId: 36, x: 39.5, y: 80.2, frameVerified: true }]);
    expect(dungeons.Alliance.get(209)).toEqual({
      areaId: 209,
      name: 'Shadowfang Keep',
      alternativeAreaIds: [10014],
      parentZoneAreaId: 130,
      entrances: [{ areaId: 130, x: 44.8, y: 67.8, frameVerified: true }],
    });
  });

  it("marks the audit's frame-unverified entrances, and fails when one is not in dungeons.lua (COORD-4)", () => {
    const unverified: readonly UnverifiedEntrance[] = [{ dungeonAreaId: 209, areaId: 130, x: 44.8, y: 67.8, label: 'test entrance' }];
    expect(readDungeons(bytes(DUNGEONS), 'Horde', 'Classic', unverified).get(209)?.entrances).toEqual([{ areaId: 130, x: 44.8, y: 67.8, frameVerified: false }]);
    const moved: readonly UnverifiedEntrance[] = [{ dungeonAreaId: 209, areaId: 130, x: 44.9, y: 67.8, label: 'moved entrance' }];
    expect(() => readDungeons(bytes(DUNGEONS), 'Horde', 'Classic', moved)).toThrow(/moved entrance matches 0 entrances .*review FRAME_UNVERIFIED_ENTRANCES/);
    // The default list is the three entries of QuestieDB's audit at the pin.
    expect(FRAME_UNVERIFIED_ENTRANCES.map((entry) => entry.dungeonAreaId)).toEqual([5861, 6618, 10001]);
  });
});
