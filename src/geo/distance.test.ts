import { describe, expect, it } from 'vitest';
import { uiMapId, worldMapId } from '../domain/ids';
import { zoneSourcedPoint } from '../domain/points';
import { distanceYards } from './distance';
import { resolve } from './resolve';
import { ERA_FRAMES, FIXTURE_MAPS, fixtureGeometry, LANDMARK_MAPS, TAXI_LANDMARKS } from './test-fixtures';

const geometry = fixtureGeometry([...FIXTURE_MAPS, ...LANDMARK_MAPS]);

describe('distanceYards', () => {
  it('is the plain Euclidean distance in yards on one world map', () => {
    const a = { mapId: worldMapId(1), x: 0, y: 0 };
    expect(distanceYards(a, { mapId: worldMapId(1), x: 3, y: -4 })).toBe(5);
    expect(distanceYards(a, a)).toBe(0);
    const b = { mapId: worldMapId(1), x: -600.2991646363, y: -4186.4222239014 };
    expect(distanceYards(a, b)).toBe(distanceYards(b, a));
  });

  it('is null across world maps, never zero or a straight line', () => {
    expect(distanceYards({ mapId: worldMapId(0), x: 0, y: 0 }, { mapId: worldMapId(1), x: 0, y: 0 })).toBeNull();
    expect(distanceYards({ mapId: worldMapId(1), x: 10, y: 10 }, { mapId: worldMapId(2991), x: 10, y: 10 })).toBeNull();
  });
});

describe('flight masters vs TaxiNodes (coordinates.md §9; cited client values, D-022)', () => {
  it.each(TAXI_LANDMARKS)('TaxiNode $taxiNode ($name) is $yards yd from QuestieDB flight master $npc', (landmark) => {
    const master = resolve(zoneSourcedPoint(uiMapId(landmark.uiMapId), landmark.spawn[0], landmark.spawn[1]), geometry);
    expect(master).not.toBeNull();
    if (master === null) return;
    const node = { mapId: worldMapId(landmark.mapId), x: landmark.x, y: landmark.y };
    const yards = distanceYards(master, node);
    expect(yards?.toFixed(1)).toBe(landmark.yards.toFixed(1));
    // MAPS.md §5.5 L6: every landmark within 30 yd in the Forever frame
    expect(yards).toBeLessThan(30);
  });

  it('covers three of the four changed frames (1423, 1433, 1453), not only Stormwind', () => {
    const changed = new Set(TAXI_LANDMARKS.filter((landmark) => landmark.eraYards !== null).map((landmark) => landmark.uiMapId));
    expect([...changed].sort((a, b) => a - b)).toEqual([1423, 1433, 1453]);
  });

  it.each(TAXI_LANDMARKS.filter((landmark) => landmark.eraYards !== null))(
    'reading NPC $npc’s Forever percent with the Era $uiMapId frame puts it $eraYards yd from TaxiNode $taxiNode',
    (landmark) => {
      const eraFrame = ERA_FRAMES[landmark.uiMapId];
      if (eraFrame === undefined) throw new Error('fixture');
      const wrongFrame = resolve(zoneSourcedPoint(uiMapId(landmark.uiMapId), landmark.spawn[0], landmark.spawn[1]), fixtureGeometry([eraFrame], []));
      expect(wrongFrame).not.toBeNull();
      if (wrongFrame === null) return;
      const yards = distanceYards(wrongFrame, { mapId: worldMapId(landmark.mapId), x: landmark.x, y: landmark.y });
      expect(yards?.toFixed(1)).toBe(landmark.eraYards?.toFixed(1));
      // Mixing frames costs about 100 yd or more, far outside the 30 yd landmark tolerance (MAPS.md §5.5 L6).
      expect(yards).toBeGreaterThan(100);
    },
  );

  it('a flight master and a node on another world map have no distance', () => {
    const [dungar, doras] = TAXI_LANDMARKS;
    const master = resolve(zoneSourcedPoint(uiMapId(dungar.uiMapId), dungar.spawn[0], dungar.spawn[1]), geometry);
    expect(master).not.toBeNull();
    if (master === null) return;
    expect(distanceYards(master, { mapId: worldMapId(doras.mapId), x: doras.x, y: doras.y })).toBeNull();
  });
});
