import { describe, expect, it } from 'vitest';
import { worldMapId } from '../domain/ids';
import type { TravelEndpoint } from '../domain/travel';
import { createStraightLineTravelModel, straightLineLeg } from './straight-line';

const end = (mapId: number, x: number, y: number, zoneHint = 0): TravelEndpoint => ({ point: { mapId: worldMapId(mapId), x, y }, zoneHint });
const ON_FOOT = { groundYps: 7, swimYps: 4.722 };

describe('createStraightLineTravelModel', () => {
  const model = createStraightLineTravelModel(1.25);

  it('identifies itself as the straight-line model and draws no path', () => {
    expect(model.id).toBe('straight-line');
    expect(model.revision).toBe('straight-line');
    expect(model.path(end(1, 0, 0), end(1, 700, 0))).toBeNull();
  });

  it('prices a leg as distance × detour factor / ground speed, basis assumption (TIME-T 1, 2)', () => {
    expect(model.leg(end(1, 0, 0), end(1, 700, 0), ON_FOOT)).toEqual({
      seconds: { value: 125, basis: 'assumption', eraFallback: false },
      method: 'straight-line',
      pending: false,
      warnings: [],
    });
    expect(model.leg(end(1, 0, 0), end(1, 0, -700), { groundYps: 11.2, swimYps: 4.722 }).seconds.value).toBe(78.125);
    expect(model.leg(end(1, 0, 0), end(1, 700, 0), { groundYps: 14, swimYps: 4.722 }).seconds.value).toBe(62.5);
  });

  it('uses the plain Euclidean distance, symmetric, ignoring zone hints and swim speed', () => {
    const detourless = createStraightLineTravelModel(1);
    expect(detourless.leg(end(0, 3, 4, 12), end(0, 0, 0, 40), { groundYps: 1, swimYps: 99 }).seconds.value).toBe(5);
    const a = end(1, -600.2991646363, -4186.4222239014);
    const b = end(1, 1234.5, 987.25);
    expect(model.leg(a, b, ON_FOOT).seconds.value).toBe(model.leg(b, a, ON_FOOT).seconds.value);
    expect(model.leg(a, a, ON_FOOT).seconds.value).toBe(0);
  });

  it('has no leg across world maps: the seconds are unknown, never a straight line', () => {
    expect(model.leg(end(0, 0, 0), end(1, 0, 0), ON_FOOT)).toEqual({
      seconds: { value: null, basis: 'unknown', eraFallback: false },
      method: 'straight-line',
      pending: false,
      warnings: [],
    });
  });

  it('refuses a non-positive speed or detour factor', () => {
    expect(() => model.leg(end(1, 0, 0), end(1, 1, 0), { groundYps: 0, swimYps: 1 })).toThrow(RangeError);
    expect(() => createStraightLineTravelModel(0)).toThrow(RangeError);
    expect(() => straightLineLeg(end(1, 0, 0), end(1, 1, 0), ON_FOOT, Number.NaN)).toThrow(RangeError);
  });
});
