import { describe, expect, it } from 'vitest';
import { uiMapId, worldMapId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';
import { fixtureGeometry, FIXTURE_MAPS } from './test-fixtures';
import {
  assignmentForPercent,
  assignmentPercentToWorld,
  assignmentWorldToPercent,
  isFullUiRectangle,
  mapToWorld,
  uiRectangleContains,
  worldToMap,
} from './transforms';

const geometry = fixtureGeometry();

/** docs/research/coordinates.md §7: NPC 3143 Gornek, Durotar 1411 at 42.06, 68.33 (foreverNpcDB.lua:2604). */
const gornekWorld = (): WorldPoint => {
  const world = mapToWorld({ uiMapId: uiMapId(1411), x: 42.06, y: 68.33 }, geometry);
  if (world === null) throw new Error('Gornek did not resolve');
  return world;
};

describe('mapToWorld / worldToMap: worked example 1, Gornek (coordinates.md §7)', () => {
  it('Durotar 42.06, 68.33 is world (X, Y) = (-600.30, -4186.42) on map 1', () => {
    const world = gornekWorld();
    expect(world.mapId).toBe(1);
    // §7.1: X = 1808.3332519531 − 0.6833·3524.9998779297, Y = −1962.4998779297 − 0.4206·5287.4996337891
    expect(world.x).toBeCloseTo(-600.2991646363, 9);
    expect(world.y).toBeCloseTo(-4186.4222239014, 9);
    expect(world.x.toFixed(2)).toBe('-600.30');
    expect(world.y.toFixed(2)).toBe('-4186.42');
  });

  it('is Kalimdor 1414 57.7531, 54.6207 and Azeroth 947 28.7673, 51.5603 (row 46785)', () => {
    const world = gornekWorld();
    const kalimdor = worldToMap(world, uiMapId(1414), geometry);
    expect(kalimdor?.x.toFixed(4)).toBe('57.7531');
    expect(kalimdor?.y.toFixed(4)).toBe('54.6207');
    const azeroth = worldToMap(world, uiMapId(947), geometry);
    expect(azeroth?.x.toFixed(4)).toBe('28.7673');
    expect(azeroth?.y.toFixed(4)).toBe('51.5603');
  });

  it('matches the direct zone → continent affine form (coordinates.md §7.2)', () => {
    const kalimdor = worldToMap(gornekWorld(), uiMapId(1414), geometry);
    expect(kalimdor?.x).toBeCloseTo(0.14368279 * 42.06 + 51.70977569, 5);
    expect(kalimdor?.y).toBeCloseTo(0.14368284 * 68.33 + 44.80282658, 5);
  });

  it('gives off-frame percent without clamping: the same point on Orgrimmar is 36.06, 307.26 (§7.4)', () => {
    const orgrimmar = worldToMap(gornekWorld(), uiMapId(1454), geometry);
    expect(orgrimmar?.x.toFixed(2)).toBe('36.06');
    expect(orgrimmar?.y.toFixed(2)).toBe('307.26');
  });
});

describe('round trips', () => {
  const PERCENTS = [-50, -0.01, 0, 12.5, 33.33, 42.06, 68.33, 99.99, 100, 150];

  it('percent → world → percent is exact to 1e-9 on every full-rectangle fixture row, inside and outside 0..100', () => {
    let worst = 0;
    for (const map of FIXTURE_MAPS) {
      for (const row of map.assignments.filter(isFullUiRectangle)) {
        for (const x of PERCENTS) {
          for (const y of PERCENTS) {
            const world = assignmentPercentToWorld(row, x, y);
            const back = assignmentWorldToPercent(row, world.x, world.y);
            worst = Math.max(worst, Math.abs(back.x - x), Math.abs(back.y - y));
          }
        }
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('world → percent → world is exact to 1e-9 yards on Azeroth sub-rectangles and zones', () => {
    let worst = 0;
    for (const map of FIXTURE_MAPS) {
      for (const row of map.assignments) {
        for (const fx of [0, 0.25, 0.5, 1, 1.5]) {
          const worldX = row.xMin + fx * (row.xMax - row.xMin);
          const worldY = row.yMin + (1 - fx) * (row.yMax - row.yMin);
          const percent = assignmentWorldToPercent(row, worldX, worldY);
          const back = assignmentPercentToWorld(row, percent.x, percent.y);
          worst = Math.max(worst, Math.abs(back.x - worldX), Math.abs(back.y - worldY));
        }
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('mapToWorld and worldToMap invert each other through the geometry lookup', () => {
    const point = { uiMapId: uiMapId(1412), x: 43.89, y: 76.66 };
    const world = mapToWorld(point, geometry);
    expect(world).not.toBeNull();
    const back = world === null ? null : worldToMap(world, uiMapId(1412), geometry);
    expect(back?.x).toBeCloseTo(43.89, 10);
    expect(back?.y).toBeCloseTo(76.66, 10);
  });
});

describe('multi-row maps (Azeroth 947)', () => {
  it('picks the sub-rectangle containing the point, with its own world map', () => {
    const kalimdorSide = mapToWorld({ uiMapId: uiMapId(947), x: 28.7673, y: 51.5603 }, geometry);
    expect(kalimdorSide?.mapId).toBe(1);
    expect(kalimdorSide?.x).toBeCloseTo(-600.3, 0);
    expect(kalimdorSide?.y).toBeCloseTo(-4186.4, 0);
    const easternKingdomsSide = mapToWorld({ uiMapId: uiMapId(947), x: 70, y: 50 }, geometry);
    expect(easternKingdomsSide?.mapId).toBe(0);
  });

  it('has no world position between or outside the sub-rectangles (open ocean)', () => {
    expect(mapToWorld({ uiMapId: uiMapId(947), x: 50, y: 50 }, geometry)).toBeNull();
    expect(mapToWorld({ uiMapId: uiMapId(947), x: 2, y: 50 }, geometry)).toBeNull();
    expect(assignmentForPercent(geometry, uiMapId(947), 50, 50)).toBeNull();
  });

  it('includes sub-rectangle edges', () => {
    const [kalimdorRow] = geometry.maps.get(uiMapId(947))?.assignments ?? [];
    expect(kalimdorRow).toBeDefined();
    if (kalimdorRow === undefined) return;
    expect(uiRectangleContains(kalimdorRow, 100 * kalimdorRow.uiMin[0], 100 * kalimdorRow.uiMax[1])).toBe(true);
    expect(isFullUiRectangle(kalimdorRow)).toBe(false);
  });

  it('worldToMap uses the row of the point’s world map', () => {
    const ek = worldToMap({ mapId: worldMapId(0), x: -8832.77, y: 478.62 }, uiMapId(947), geometry);
    expect(ek).not.toBeNull();
    expect(ek?.x).toBeGreaterThan(55);
    expect(ek?.x).toBeLessThan(90);
  });
});

describe('unknowns', () => {
  it('returns null for a UiMap the geometry lacks, and for a world map the UiMap does not show', () => {
    expect(mapToWorld({ uiMapId: uiMapId(2482), x: 50, y: 50 }, geometry)).toBeNull();
    expect(worldToMap(gornekWorld(), uiMapId(2482), geometry)).toBeNull();
    expect(worldToMap({ mapId: worldMapId(0), x: 0, y: 0 }, uiMapId(1411), geometry)).toBeNull();
    expect(worldToMap({ mapId: worldMapId(2991), x: 0, y: 0 }, uiMapId(947), geometry)).toBeNull();
  });
});
