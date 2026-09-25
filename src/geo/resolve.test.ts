import { describe, expect, expectTypeOf, it } from 'vitest';
import { uiMapId, worldMapId } from '../domain/ids';
import { worldSourcedPoint, zoneSourcedPoint, type Location, type SourcedPoint } from '../domain/points';
import { resolve, resolveDetailed, resolvePoint, resolvePointDetailed } from './resolve';
import { DUROTAR, fixtureGeometry, FIXTURE_MAPS, MULGORE_ERA } from './test-fixtures';
import { worldToMap } from './transforms';

const geometry = fixtureGeometry();

describe('resolve: worked example 1, Gornek (coordinates.md §7)', () => {
  it('a Forever-frame zone point on Durotar resolves to world (-600.2992, -4186.4222) on map 1', () => {
    const world = resolve(zoneSourcedPoint(uiMapId(1411), 42.06, 68.33), geometry);
    expect(world).not.toBeNull();
    expect(world?.mapId).toBe(1);
    expect(world?.x.toFixed(4)).toBe('-600.2992');
    expect(world?.y.toFixed(4)).toBe('-4186.4222');
  });

  it('an Era-frame point on an unchanged zone resolves exactly like the Forever point', () => {
    const era = resolve(zoneSourcedPoint(uiMapId(1411), 42.06, 68.33, 'era'), geometry);
    const forever = resolve(zoneSourcedPoint(uiMapId(1411), 42.06, 68.33, 'forever'), geometry);
    expect(era).toEqual(forever);
  });
});

describe('resolve: worked example 2, Chief Hawkwind (coordinates.md §8)', () => {
  const eraPoint = zoneSourcedPoint(uiMapId(1412), 44.18, 76.06, 'era');

  it('converts Era 44.18, 76.06 to Forever 43.888926, 76.659548 and world (-2877.9715, -221.8308)', () => {
    const world = resolve(eraPoint, geometry);
    expect(world?.mapId).toBe(1);
    expect(world?.x.toFixed(4)).toBe('-2877.9715');
    expect(world?.y.toFixed(4)).toBe('-221.8308');
    const forever = world === null ? null : worldToMap(world, uiMapId(1412), geometry);
    expect(forever?.x.toFixed(6)).toBe('43.888926');
    expect(forever?.y.toFixed(6)).toBe('76.659548');
  });

  it('keeps the world position of reading the Era percent with the Era bounds (step 2)', () => {
    const eraGeometry = fixtureGeometry([MULGORE_ERA], []);
    const viaEraBounds = resolve(zoneSourcedPoint(uiMapId(1412), 44.18, 76.06), eraGeometry);
    const viaCoefficients = resolve(eraPoint, geometry);
    expect(viaEraBounds).not.toBeNull();
    expect(Math.abs((viaEraBounds?.x ?? 0) - (viaCoefficients?.x ?? 1))).toBeLessThan(1e-6);
    expect(Math.abs((viaEraBounds?.y ?? 0) - (viaCoefficients?.y ?? 1))).toBeLessThan(1e-6);
  });

  it('never converts Forever-frame data again: QuestieDB stores 43.89, 76.66, world (-2877.99, -221.90), Kalimdor 46.98, 63.90', () => {
    const stored = resolve(zoneSourcedPoint(uiMapId(1412), 43.89, 76.66), geometry);
    expect(stored?.x.toFixed(2)).toBe('-2877.99');
    expect(stored?.y.toFixed(2)).toBe('-221.90');
    const kalimdor = stored === null ? null : worldToMap(stored, uiMapId(1414), geometry);
    expect(kalimdor?.x.toFixed(2)).toBe('46.98');
    expect(kalimdor?.y.toFixed(2)).toBe('63.90');
    const convertedAgain = resolve(zoneSourcedPoint(uiMapId(1412), 43.89, 76.66, 'era'), geometry);
    expect(convertedAgain).not.toEqual(stored);
  });

  it('is unresolved, with a reason, when the geometry lacks the coefficients for a changed UiMap', () => {
    const noEra = fixtureGeometry(FIXTURE_MAPS, []);
    expect(resolve(eraPoint, noEra)).toBeNull();
    expect(resolvePointDetailed(eraPoint, noEra)).toEqual({ kind: 'unresolved', reason: 'no-era-coefficients', uiMapId: 1412 });
  });
});

describe('resolve: world points and the UiMap hint (coordinates.md §13.4, §15 test 7)', () => {
  const hinted = { ...worldSourcedPoint(worldMapId(1), -500, -4000, uiMapId(1411)), lexemes: ['-4000.00', '-500.00'] as const };

  it('passes world points through unchanged, with and without the hint', () => {
    const withHint = resolve(hinted, geometry);
    const withoutHint = resolve(worldSourcedPoint(worldMapId(1), -500, -4000), geometry);
    expect(withHint).toEqual({ mapId: 1, x: -500, y: -4000 });
    expect(withoutHint).toEqual(withHint);
    expect(Object.keys(withHint ?? {})).toEqual(['mapId', 'x', 'y']);
  });

  it('is Durotar 38.5343, 65.4846 through row 46721', () => {
    const world = resolve(hinted, geometry);
    const durotar = world === null ? null : worldToMap(world, uiMapId(1411), geometry);
    expect(durotar?.x.toFixed(4)).toBe('38.5343');
    expect(durotar?.y.toFixed(4)).toBe('65.4846');
  });

  it('resolves world points even on maps the geometry does not know', () => {
    expect(resolve(worldSourcedPoint(worldMapId(2997), 100, 2000), fixtureGeometry([DUROTAR], []))).toEqual({ mapId: 2997, x: 100, y: 2000 });
  });
});

describe('resolve: unknowns stay unknown', () => {
  it('a zone point on a UiMap without geometry is null (no-geometry), never a guess', () => {
    const point = zoneSourcedPoint(uiMapId(2482), 50, 50);
    expect(resolve(point, geometry)).toBeNull();
    expect(resolvePointDetailed(point, geometry)).toEqual({ kind: 'unresolved', reason: 'no-geometry', uiMapId: 2482 });
  });

  it('a percent point on no Azeroth sub-rectangle is null (outside-ui-rectangles)', () => {
    expect(resolvePointDetailed(zoneSourcedPoint(uiMapId(947), 50, 50), geometry)).toEqual({
      kind: 'unresolved',
      reason: 'outside-ui-rectangles',
      uiMapId: 947,
    });
  });

  it('non-finite coordinates are null (non-finite)', () => {
    expect(resolvePointDetailed(zoneSourcedPoint(uiMapId(1411), Number.NaN, 5), geometry)).toMatchObject({ reason: 'non-finite' });
    expect(resolvePointDetailed(worldSourcedPoint(worldMapId(1), Infinity, 5), geometry)).toMatchObject({ reason: 'non-finite' });
  });

  it('off-frame zone points are valid and extrapolate in their frame', () => {
    const world = resolve(zoneSourcedPoint(uiMapId(1411), 150, -20), geometry);
    expect(world).not.toBeNull();
    const back = world === null ? null : worldToMap(world, uiMapId(1411), geometry);
    expect(back?.x).toBeCloseTo(150, 9);
    expect(back?.y).toBeCloseTo(-20, 9);
  });
});

describe('resolve accepts a Location or a SourcedPoint', () => {
  it('resolves the Location’s authored source and nothing else', () => {
    const location: Location = { source: zoneSourcedPoint(uiMapId(1411), 42.06, 68.33), label: 'Gornek', radius: 5 };
    expect(resolve(location, geometry)).toEqual(resolvePoint(location.source, geometry));
    expect(resolveDetailed(location, geometry)).toEqual(resolvePointDetailed(location.source, geometry));
  });

  it('a Location has no derived world field, so nothing derived can be persisted (coordinates.md §15 test 6)', () => {
    expectTypeOf<keyof Location>().toEqualTypeOf<'source' | 'label' | 'radius'>();
    expectTypeOf<Location['source']>().toEqualTypeOf<SourcedPoint>();
  });
});
