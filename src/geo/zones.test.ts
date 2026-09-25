import { describe, expect, it } from 'vitest';
import { uiMapId, worldMapId } from '../domain/ids';
import { CROSSROADS_NODE, DUROTAR, fixtureGeometry, TAXI_LANDMARKS } from './test-fixtures';
import { attributeZone, frameCentrality, rowContainsWorldPoint, worldMapIdOf, worldMapIds, zoneFramesContaining } from './zones';

const geometry = fixtureGeometry();
const gornek = { mapId: worldMapId(1), x: -600.2991646363, y: -4186.4222239014 };
const orgrimmarNode = { mapId: worldMapId(1), x: TAXI_LANDMARKS[1].x, y: TAXI_LANDMARKS[1].y };
const crossroads = { mapId: worldMapId(CROSSROADS_NODE.mapId), x: CROSSROADS_NODE.x, y: CROSSROADS_NODE.y };

describe('frameCentrality', () => {
  it('is min(fu, 1 − fu, fv, 1 − fv): 0.5 at the centre, 0 on an edge, negative outside', () => {
    const [row] = DUROTAR.assignments;
    if (row === undefined) throw new Error('fixture');
    const centre = { mapId: worldMapId(1), x: (row.xMin + row.xMax) / 2, y: (row.yMin + row.yMax) / 2 };
    expect(frameCentrality(row, centre)).toBeCloseTo(0.5, 12);
    expect(frameCentrality(row, { ...centre, x: row.xMax })).toBe(0);
    expect(frameCentrality(row, { ...centre, y: row.yMax + 100 })).toBeLessThan(0);
    // Gornek, Durotar 42.06, 68.33: fu = 0.4206, fv = 0.6833
    expect(frameCentrality(row, gornek)).toBeCloseTo(0.3167, 9);
  });
});

describe('zoneFramesContaining', () => {
  it('lists overlapping zone frames most central first and never continents (AreaID 0)', () => {
    // Durotar and The Barrens overlap (coordinates.md §5); Kalimdor contains the point but is not a zone.
    // Gornek is 0.3275 deep in The Barrens' frame and 0.3167 in Durotar's.
    expect(zoneFramesContaining(gornek, geometry)).toEqual([1413, 1411]);
    // A city before the zone that contains it: the node is central in Orgrimmar and near Durotar's north edge.
    expect(zoneFramesContaining(orgrimmarNode, geometry)).toEqual([1454, 1411]);
  });

  it('only matches rows on the point’s world map', () => {
    expect(zoneFramesContaining({ ...gornek, mapId: worldMapId(0) }, geometry)).toEqual([]);
  });

  it('breaks a centrality tie with the smaller frame (city before zone), then the UiMapId', () => {
    const [row] = DUROTAR.assignments;
    if (row === undefined) throw new Error('fixture');
    // Two synthetic frames sharing Durotar's centre: the point is exactly 0.5 deep in both.
    const inner = { ...DUROTAR, uiMapId: uiMapId(9002), assignments: [{ ...row, xMin: row.xMin + 100, xMax: row.xMax - 100, yMin: row.yMin + 150, yMax: row.yMax - 150 }] };
    const twin = { ...DUROTAR, uiMapId: uiMapId(9001) };
    const tie = fixtureGeometry([DUROTAR, twin, inner], []);
    const centre = { mapId: worldMapId(1), x: (row.xMin + row.xMax) / 2, y: (row.yMin + row.yMax) / 2 };
    expect(zoneFramesContaining(centre, tie)).toEqual([9002, 1411, 9001]);
  });
});

describe('attributeZone', () => {
  it('prefers the hint when its frame contains the point', () => {
    expect(attributeZone(gornek, uiMapId(1411), geometry)).toEqual({ uiMapId: 1411, basis: 'hint' });
    expect(attributeZone(gornek, uiMapId(1413), geometry)).toEqual({ uiMapId: 1413, basis: 'hint' });
    expect(attributeZone(gornek, uiMapId(1414), geometry)).toEqual({ uiMapId: 1414, basis: 'hint' });
  });

  it('falls back to the containing zone frame the point is most central in, labelled as containment', () => {
    // TaxiNodes 25 (Crossroads) lies in the Durotar, Mulgore and The Barrens frames. The smallest
    // frame (Durotar) was wrong; it is 0.304 deep in The Barrens, 0.173 in Mulgore, 0.120 in Durotar.
    expect(zoneFramesContaining(crossroads, geometry)).toEqual([1413, 1412, 1411]);
    expect(attributeZone(crossroads, null, geometry)).toEqual({ uiMapId: 1413, basis: 'containment' });
    expect(attributeZone(orgrimmarNode, null, geometry)).toEqual({ uiMapId: 1454, basis: 'containment' });
    expect(attributeZone({ mapId: worldMapId(2991), x: 3000, y: 1000 }, null, geometry)).toEqual({ uiMapId: 2521, basis: 'containment' });
    // A hint whose frame does not contain the point falls back too.
    expect(attributeZone(crossroads, uiMapId(1454), geometry)).toEqual({ uiMapId: 1413, basis: 'containment' });
    expect(attributeZone(crossroads, uiMapId(2482), geometry)).toEqual({ uiMapId: 1413, basis: 'containment' });
  });

  it('is a heuristic that can miss, which is why the hint wins: Gornek without a hint goes to The Barrens', () => {
    expect(attributeZone(gornek, null, geometry)).toEqual({ uiMapId: 1413, basis: 'containment' });
  });

  it('is null when no zone frame contains the point: unknown, not guessed', () => {
    expect(attributeZone({ mapId: worldMapId(1), x: 12000, y: 16000 }, null, geometry)).toBeNull();
    expect(attributeZone({ mapId: worldMapId(2997), x: 0, y: 2000 }, uiMapId(2524), geometry)).toBeNull();
  });
});

describe('world maps of UiMaps', () => {
  it('worldMapIdOf gives the single world map a UiMap shows, or null', () => {
    expect(worldMapIdOf(uiMapId(1411), geometry)).toBe(1);
    expect(worldMapIdOf(uiMapId(1453), geometry)).toBe(0);
    expect(worldMapIdOf(uiMapId(2521), geometry)).toBe(2991);
    expect(worldMapIdOf(uiMapId(947), geometry)).toBeNull();
    expect(worldMapIdOf(uiMapId(2482), geometry)).toBeNull();
  });

  it('worldMapIds lists every world map with a row, ascending', () => {
    expect(worldMapIds(geometry)).toEqual([0, 1, 2991]);
  });

  it('rowContainsWorldPoint includes the frame edges', () => {
    const [durotar] = geometry.maps.get(uiMapId(1411))?.assignments ?? [];
    if (durotar === undefined) throw new Error('fixture');
    expect(rowContainsWorldPoint(durotar, { mapId: worldMapId(1), x: durotar.xMax, y: durotar.yMin })).toBe(true);
    expect(rowContainsWorldPoint(durotar, { mapId: worldMapId(1), x: durotar.xMax + 0.001, y: durotar.yMin })).toBe(false);
  });
});
