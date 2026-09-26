import { describe, expect, it } from 'vitest';
import { uiMapId, worldMapId } from '../domain/ids';
import { worldSourcedPoint, zoneSourcedPoint, type WorldPoint } from '../domain/points';
import { fixtureGeometry } from '../geo/test-fixtures';
import { rolledUpZone, routePointEndpoint, spawnEndpoint, uiMapZoneHint } from './navigation-hints';
import { testNavManifest } from './navigation-test-helpers';

/** Zone hints for endpoints (terrain-navigation.md §8.1 rule A), on the cited fixture geometry. */

const GEOMETRY = fixtureGeometry();
const NAV = testNavManifest([0, 1]); // its roll-up maps area 363 to 14
const at = (mapId: number, x: number, y: number): WorldPoint => ({ mapId: worldMapId(mapId), x, y });
/** Razor Hill (Durotar), inside the Durotar and Barrens frames. */
const RAZOR_HILL = at(1, 300, -4700);
/** Orgrimmar's valley, inside the Orgrimmar and Durotar frames. */
const ORGRIMMAR = at(1, 1600, -4400);

describe('navigation zone hints', () => {
  it('uses the zone of the UiMap row a route point was authored on', () => {
    expect(uiMapZoneHint(GEOMETRY, uiMapId(1411), RAZOR_HILL, NAV)).toBe(14);
    expect(uiMapZoneHint(GEOMETRY, uiMapId(1413), RAZOR_HILL, NAV)).toBe(17);
    expect(uiMapZoneHint(GEOMETRY, uiMapId(1454), ORGRIMMAR, NAV)).toBe(1637);
    expect(routePointEndpoint(zoneSourcedPoint(uiMapId(1454), 50, 50), ORGRIMMAR, GEOMETRY, NAV)).toEqual({ point: ORGRIMMAR, zoneHint: 1637 });
  });

  it('gives 0 for no UiMap, a continent or world UiMap, an unknown UiMap, or a UiMap of another world map', () => {
    expect(routePointEndpoint(worldSourcedPoint(worldMapId(1), 300, -4700), RAZOR_HILL, GEOMETRY, NAV).zoneHint).toBe(0);
    expect(uiMapZoneHint(GEOMETRY, uiMapId(1414), RAZOR_HILL, NAV)).toBe(0);
    expect(uiMapZoneHint(GEOMETRY, uiMapId(947), RAZOR_HILL, NAV)).toBe(0);
    expect(uiMapZoneHint(GEOMETRY, uiMapId(9999), RAZOR_HILL, NAV)).toBe(0);
    expect(uiMapZoneHint(GEOMETRY, uiMapId(1453), RAZOR_HILL, NAV)).toBe(0);
  });

  it('keeps the UiMap an RXP world point names', () => {
    expect(routePointEndpoint(worldSourcedPoint(worldMapId(1), 300, -4700, uiMapId(1411)), RAZOR_HILL, GEOMETRY, NAV).zoneHint).toBe(14);
  });

  it('rolls area keys up with the manifest (spawnHint), and passes them through without a manifest', () => {
    expect(rolledUpZone(NAV, 1, 363)).toBe(14);
    expect(rolledUpZone(NAV, 1, 17)).toBe(17);
    expect(rolledUpZone(null, 1, 363)).toBe(363);
    expect(rolledUpZone(NAV, 1, 0)).toBe(0);
    expect(rolledUpZone(NAV, 1, -1)).toBe(0);
  });

  it('hints a dataset spawn by its area key when known, else by its published UiMap', () => {
    const spawn = { world: RAZOR_HILL, uiMapId: uiMapId(1411) };
    expect(spawnEndpoint(spawn, GEOMETRY, NAV, 363)).toEqual({ point: RAZOR_HILL, zoneHint: 14 });
    expect(spawnEndpoint(spawn, GEOMETRY, NAV)).toEqual({ point: RAZOR_HILL, zoneHint: 14 });
    expect(spawnEndpoint({ world: null, uiMapId: uiMapId(1411) }, GEOMETRY, NAV)).toBeNull();
    expect(spawnEndpoint({ world: RAZOR_HILL, uiMapId: null }, GEOMETRY, NAV)?.zoneHint).toBe(0);
  });
});
