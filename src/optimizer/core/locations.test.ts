import { describe, expect, it } from 'vitest';
import { itemId, npcId } from '../../domain/ids';
import { createPlaces } from '../../engine/places';
import { fixtureContext, fixtureDataset, npcRecord, point, spawnAt } from '../../engine/test-helpers';
import { buildSpawnTables, endpointKey, indexLocations, LocationSet, locationOf, SpawnChooser } from './locations';
import { SPAWN_LOST, SPAWN_NONE } from './types';

/** Locations, point ids and spawn tables (docs/research/optimizer-m7.md §5.2). */

describe('locations', () => {
  it('are sorted by (mapId, x, y, zoneHint) and share a point id when only the hint differs', () => {
    const set = new LocationSet();
    set.add({ point: point(10, 5), zoneHint: 3 });
    set.add({ point: point(10, 5), zoneHint: 0 });
    set.add({ point: point(-4, 9), zoneHint: 0 });
    expect(set.add({ point: point(-4, 9), zoneHint: 0 })).toBe(false);
    const indexed = indexLocations(set);
    expect(indexed.endpoints.map(endpointKey)).toEqual(['1|-4|9|0', '1|10|5|0', '1|10|5|3']);
    expect(Array.from(indexed.table.pointId)).toEqual([0, 1, 1]);
    expect(indexed.table.pointCount).toBe(2);
    expect(locationOf(indexed, { point: point(10, 5), zoneHint: 3 })).toBe(2);
    expect(locationOf(indexed, null)).toBe(-1);
    expect(() => locationOf(indexed, { point: point(1, 1), zoneHint: 0 })).toThrow(/not collected/);
  });
});

describe('spawn tables', () => {
  const dataset = fixtureDataset({
    npcs: [npcRecord(10), npcRecord(11), npcRecord(12)],
    spawns: { 'npc:10': [spawnAt(point(100, 0)), spawnAt(point(-100, 0))], 'npc:11': [spawnAt(point(5, 5))], 'npc:12': [spawnAt(null)] },
  });
  const places = createPlaces(fixtureContext(dataset));

  it('choose the nearest spawn from each location; several spawns from the unknown position are unknown', () => {
    const set = new LocationSet();
    for (const x of [-100, -90, 90, 100]) set.add({ point: point(x, 0), zoneHint: 0 });
    set.add({ point: point(5, 5), zoneHint: 0 });
    const indexed = indexLocations(set);
    const chooser = new SpawnChooser(places);
    const refs = [
      { kind: 'npc' as const, id: npcId(10) },
      { kind: 'npc' as const, id: npcId(11) },
      { kind: 'npc' as const, id: npcId(12) },
      { kind: 'item' as const, id: itemId(1) },
    ];
    const tables = buildSpawnTables(refs, indexed, chooser);
    const n = indexed.table.count;
    const row = (t: number): number[] => Array.from(tables.data.subarray(t * (n + 1), (t + 1) * (n + 1)));
    const at = (x: number, y = 0): number => locationOf(indexed, { point: point(x, y), zoneHint: 0 });
    expect(row(0)).toEqual([SPAWN_LOST, at(-100), at(-100), at(100), at(100), at(100)]);
    expect(row(1)).toEqual(Array.from({ length: n + 1 }, () => at(5, 5)));
    expect(row(2)).toEqual(Array.from({ length: n + 1 }, () => SPAWN_LOST));
    expect(row(3)).toEqual(Array.from({ length: n + 1 }, () => SPAWN_NONE));
    // The memo is keyed by the entity and point objects, and answers the same outcome again.
    const near = point(90, 0);
    const ref = refs[0] as (typeof refs)[0];
    expect(chooser.choose(ref, near)).toBe(chooser.choose(ref, near));
  });
});
