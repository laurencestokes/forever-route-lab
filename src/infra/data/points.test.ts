import { describe, expect, it } from 'vitest';
import { areaId, uiMapId } from '../../domain/ids';
import { zoneSourcedPoint } from '../../domain/points';
import { placeholderGeometry } from '../../../tests/support/fixture-dataset';
import { entranceOf, publishedPoint, publishedPoints, SpawnConverter } from './points';
import type { DungeonRow, ZonesTable } from './rows';

/**
 * Synthetic zones that cover every area link, with real AreaIds and UiMaps so the placeholder
 * geometry can place them: 14 Durotar (direct, UiMap 1411), 363 Valley of Trials (routed to
 * 1411), 10073 (the synthetic Kalimdor alias, 1414), 2257 (suppressed, UiMap 0), 209 (a legacy
 * dungeon pair); 999999 is in no table.
 */
const dungeon = (name: string, entrances: DungeonRow['entrances']): DungeonRow => ({ name, alternativeAreaIds: [], parentZoneAreaId: 14, entrances });
const door = (areaId: number, x: number, y: number, frameVerified = true): DungeonRow['entrances'][number] => ({ areaId, x, y, frameVerified });

const ZONES: ZonesTable = {
  areas: {
    '14': { uiMapId: 1411, link: 'direct' },
    '209': { uiMapId: 310, link: 'legacy-compat' },
    '363': { uiMapId: 1411, link: 'routed' },
    '2257': { uiMapId: 0, link: 'suppressed' },
    '10073': { uiMapId: 1414, link: 'synthetic-alias' },
  },
  uiMaps: { '1411': { name: 'Durotar', nameSource: null, areaId: 14 } },
  dungeons: {
    '209': dungeon('One door', [door(14, 42.06, 68.33)]),
    '1584': dungeon('Two doors', [door(14, 10, 10), door(14, 90, 90)]),
    '2100': dungeon('Door on no map', [door(2257, 50, 50)]),
    // Like Stratholme Gauntlet 10001 at the pin: one entrance, on a changed frame the audit leaves unverified.
    '10001': dungeon('Door on an unverified frame', [door(14, 43.5, 19.4, false)]),
  },
  instanceAreas: {
    '209': { dungeonAreaId: 209 },
    '10000': { dungeonAreaId: 209 },
    '1585': { dungeonAreaId: 1584 },
    '2100': { dungeonAreaId: 2100 },
    '3358': { dungeonAreaId: 3358 },
    '10002': { dungeonAreaId: 10001 },
  },
};

const geometry = placeholderGeometry();

describe('publishedPoint', () => {
  it('turns direct, routed and synthetic-alias areas into zone points in the mapped UiMap’s Forever frame, as published', () => {
    expect(publishedPoint('14', [42.06, 68.33], ZONES)).toEqual(zoneSourcedPoint(uiMapId(1411), 42.06, 68.33, 'forever'));
    // A routed subzone has no frame of its own: its percentages are read in its parent's (COORD-3).
    expect(publishedPoint('363', [42.06, 68.33], ZONES)).toEqual(zoneSourcedPoint(uiMapId(1411), 42.06, 68.33, 'forever'));
    expect(publishedPoint('10073', [51.5, 40.25], ZONES)).toEqual(zoneSourcedPoint(uiMapId(1414), 51.5, 40.25, 'forever'));
  });

  it('keeps suppressed, legacy dungeon and unknown areas unmapped with their reason, never guessed', () => {
    expect(publishedPoint('2257', [50, 50], ZONES)).toEqual({ kind: 'unmapped', areaId: 2257, x: 50, y: 50, reason: 'suppressed' });
    expect(publishedPoint('209', [30, 40], ZONES)).toEqual({ kind: 'unmapped', areaId: 209, x: 30, y: 40, reason: 'instance-area' });
    expect(publishedPoint('999999', [1, 2], ZONES)).toEqual({ kind: 'unmapped', areaId: 999999, x: 1, y: 2, reason: 'no-uimap' });
  });

  it('reads exactly [-1, -1] as instance presence, whatever the area', () => {
    expect(publishedPoint('209', [-1, -1], ZONES)).toEqual({ kind: 'instance', areaId: 209 });
    expect(publishedPoint('999999', [-1, -1], ZONES)).toEqual({ kind: 'instance', areaId: 999999 });
  });

  it('drops a phase, which the domain points have no place for', () => {
    expect(publishedPoint('14', [42.06, 68.33, 3], ZONES)).toEqual(zoneSourcedPoint(uiMapId(1411), 42.06, 68.33, 'forever'));
  });

  it('lists a PointMap in ascending AreaId order, rows as published', () => {
    const points = publishedPoints({ '2257': [[5, 6]], '14': [[3, 4], [1, 2]] }, ZONES);
    expect(points.map((p) => ('space' in p ? `${String(p.uiMapId)}:${String(p.x)}` : `${p.kind}:${String(p.areaId)}`))).toEqual(['1411:3', '1411:1', 'unmapped:2257']);
  });
});

describe('entranceOf', () => {
  it('gives the entrance of a dungeon with exactly one, through instanceAreas and alternative ids', () => {
    const one = entranceOf(areaId(10000), ZONES, ZONES.dungeons);
    expect(one).toEqual({ kind: 'entrance', point: zoneSourcedPoint(uiMapId(1411), 42.06, 68.33, 'forever'), dungeonAreaId: 209 });
  });

  it('gives none, with the reason, for several entrances, an unmapped entrance or no dungeon', () => {
    expect(entranceOf(areaId(1585), ZONES, ZONES.dungeons)).toEqual({ kind: 'none', gap: 'several-entrances' });
    expect(entranceOf(areaId(2100), ZONES, ZONES.dungeons)).toEqual({ kind: 'none', gap: 'entrance-unmapped' });
    expect(entranceOf(areaId(3358), ZONES, ZONES.dungeons)).toEqual({ kind: 'none', gap: 'no-dungeon' });
    expect(entranceOf(areaId(424242), ZONES, ZONES.dungeons)).toEqual({ kind: 'none', gap: 'no-dungeon' });
  });

  it('never uses an entrance whose frame QuestieDB’s audit leaves unverified (COORD-4)', () => {
    expect(entranceOf(areaId(10002), ZONES, ZONES.dungeons)).toEqual({ kind: 'none', gap: 'entrance-frame-unverified' });
    expect(entranceOf(areaId(10001), ZONES, ZONES.dungeons)).toEqual({ kind: 'none', gap: 'entrance-frame-unverified' });
    // The same point with a verified frame is used.
    const verified = { ...ZONES.dungeons, '10001': dungeon('Door on a verified frame', [door(14, 43.5, 19.4)]) };
    expect(entranceOf(areaId(10002), ZONES, verified)).toMatchObject({ kind: 'entrance', dungeonAreaId: 10001 });
  });

  it('uses a faction table where one replaces a dungeon', () => {
    const horde = { ...ZONES.dungeons, '3358': dungeon('Arathi Basin', [door(14, 73.5, 29)]) };
    expect(entranceOf(areaId(3358), ZONES, horde)).toMatchObject({ kind: 'entrance', dungeonAreaId: 3358 });
  });
});

describe('SpawnConverter', () => {
  const converter = new SpawnConverter(ZONES, ZONES.dungeons, geometry, new Set([3358]));

  it('resolves zone points to world points through the geometry (Gornek, coordinates.md §7)', () => {
    const [gornek] = converter.spawns({ '14': [[42.06, 68.33]] });
    expect(gornek?.uiMapId).toBe(1411);
    expect(gornek?.world?.mapId).toBe(1);
    expect(gornek?.world?.x).toBeCloseTo(-600.3, 1);
    expect(gornek?.world?.y).toBeCloseTo(-4186.42, 1);
  });

  it('places instance presence at the single entrance, keeping the source "inside"', () => {
    const [inside] = converter.spawns({ '10000': [[-1, -1]] });
    expect(inside?.source).toEqual({ kind: 'instance', areaId: 10000 });
    expect(inside?.uiMapId).toBe(1411);
    expect(inside?.world?.x).toBeCloseTo(-600.3, 1);
  });

  it('leaves presence unresolved when the entrance is ambiguous or unverified, and unmapped points without a world point', () => {
    const spawns = converter.spawns({ '209': [[30, 40]], '1585': [[-1, -1]], '2257': [[5, 5]], '10002': [[-1, -1]] });
    expect(spawns.map((s) => [s.world, s.uiMapId])).toEqual([
      [null, null],
      [null, null],
      [null, null],
      [null, null],
    ]);
  });

  it('shares one spawn object per presence area', () => {
    const a = converter.spawns({ '10000': [[-1, -1]] })[0];
    const b = converter.spawns({ '10000': [[-1, -1], [-1, -1]] });
    expect(b[0]).toBe(a);
    expect(b[1]).toBe(a);
  });

  it('flags point maps whose presence may resolve differently by faction', () => {
    expect(converter.dependsOnFaction({ '3358': [[-1, -1]] })).toBe(true);
    expect(converter.dependsOnFaction({ '3358': [[10, 10]] })).toBe(false);
    expect(converter.dependsOnFaction({ '10000': [[-1, -1]] })).toBe(false);
  });
});
