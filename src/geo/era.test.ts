import { describe, expect, it } from 'vitest';
import { uiMapId } from '../domain/ids';
import { ERA_CHANGED_UIMAP_IDS, eraToForever } from './era';
import { resolve } from './resolve';
import { fixtureGeometry, FIXTURE_MAPS, STORMWIND_ERA } from './test-fixtures';
import { zoneSourcedPoint } from '../domain/points';

const geometry = fixtureGeometry();

describe('eraToForever (coordinates.md §8, §10.2)', () => {
  it('applies the conversion.json coefficients: Hawkwind 44.18, 76.06 → 43.888926, 76.659548', () => {
    const forever = eraToForever(uiMapId(1412), 44.18, 76.06, geometry);
    expect(forever?.x.toFixed(6)).toBe('43.888926');
    expect(forever?.y.toFixed(6)).toBe('76.659548');
    // §8 step 4, by hand from the coefficients
    expect(forever?.x).toBeCloseTo(0.8348002068 * 44.18 + 7.0074531087, 8);
    expect(forever?.y).toBeCloseTo(0.8349418225 * 76.06 + 13.1538732772, 8);
  });

  it('is identity on every UiMap whose frame did not change', () => {
    expect(eraToForever(uiMapId(1411), 42.06, 68.33, geometry)).toEqual({ x: 42.06, y: 68.33 });
    expect(eraToForever(uiMapId(2482), 12, 34, geometry)).toEqual({ x: 12, y: 34 });
  });

  it('is unknown (null) on the four changed UiMaps when the geometry has no coefficients', () => {
    const bare = fixtureGeometry(FIXTURE_MAPS, []);
    expect(ERA_CHANGED_UIMAP_IDS).toEqual([1412, 1423, 1433, 1453]);
    for (const id of ERA_CHANGED_UIMAP_IDS) expect(eraToForever(id, 50, 50, bare)).toBeNull();
  });

  it('keeps world positions fixed on Stormwind City: Era percent read with Era bounds = converted percent read with Forever bounds', () => {
    const eraGeometry = fixtureGeometry([STORMWIND_ERA], []);
    let worst = 0;
    for (const [x, y] of [[0, 0], [50, 50], [70.95, 72.51], [100, 100], [-10, 120]] as const) {
      const viaEra = resolve(zoneSourcedPoint(uiMapId(1453), x, y), eraGeometry);
      const viaCoefficients = resolve(zoneSourcedPoint(uiMapId(1453), x, y, 'era'), geometry);
      if (viaEra === null || viaCoefficients === null) throw new Error('unresolved');
      worst = Math.max(worst, Math.abs(viaEra.x - viaCoefficients.x), Math.abs(viaEra.y - viaCoefficients.y));
    }
    expect(worst).toBeLessThan(1e-6);
  });
});
