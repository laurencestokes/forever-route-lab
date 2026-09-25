import { describe, expect, it } from 'vitest';
import { LuaTable, type LuaValue } from './lua-value';
import { classifyRow, type Coefficients, projectEraPair, roundCoordinate } from './provenance';

const L = (...values: LuaValue[]): LuaTable => LuaTable.list(values);
const spawns = (area: number, ...points: (readonly [number, number])[]): LuaTable => LuaTable.from([[area, L(...points.map(([x, y]) => L(x, y)))]]);

// Mulgore (AreaId 215), conversion.json geometry.area_coefficients at the pin.
const MULGORE: Coefficients = { scaleX: 0.8348002068275978, offsetX: 7.007453108736848, scaleY: 0.8349418225477033, offsetY: 13.15387327724201 };
const COEFFICIENTS = new Map<number, Coefficients>([[215, MULGORE]]);

describe('the Era→Forever projection check (convert.py round_coordinate)', () => {
  it('rounds to hundredths with halfway values away from zero', () => {
    // Halfway is decided on the binary value, as in Python: 1.005 * 100 is 100.49999999999999.
    expect(roundCoordinate(1.005)).toBe(1);
    expect(roundCoordinate(2.345)).toBe(2.35);
    expect(roundCoordinate(-2.345)).toBe(-2.35);
    expect(roundCoordinate(0.004)).toBe(0);
    expect(Object.is(roundCoordinate(-0.004), 0)).toBe(true);
  });

  it('projects an Era pair with the documented coefficients', () => {
    const [x, y] = projectEraPair(MULGORE, 50, 50);
    expect([x, y]).toEqual([roundCoordinate(0.8348002068275978 * 50 + 7.007453108736848), roundCoordinate(0.8349418225477033 * 50 + 13.15387327724201)]);
  });
});

describe('upstreamDiff classification', () => {
  const eraNpc = (): LuaTable => LuaTable.from([[1, 'Chief'], [7, spawns(215, [50, 50], [-1, -1])], [9, 215]]);

  it('tags identical rows era and absent fork-base rows forever-new', () => {
    expect(classifyRow('npc', eraNpc(), eraNpc(), COEFFICIENTS).tag).toBe('era');
    expect(classifyRow('npc', eraNpc(), undefined, COEFFICIENTS).tag).toBe('forever-new');
  });

  it('tags rows that differ only by the projection era-coords, counting converted pairs', () => {
    const [x, y] = projectEraPair(MULGORE, 50, 50);
    const forever = LuaTable.from([[1, 'Chief'], [7, spawns(215, [x, y], [-1, -1])], [9, 215]]);
    expect(classifyRow('npc', forever, eraNpc(), COEFFICIENTS)).toEqual({ tag: 'era-coords', convertedPairs: 1 });
  });

  it('tags any other difference forever-changed', () => {
    const renamed = LuaTable.from([[1, 'Other'], [7, spawns(215, [50, 50], [-1, -1])], [9, 215]]);
    expect(classifyRow('npc', renamed, eraNpc(), COEFFICIENTS).tag).toBe('forever-changed');
    const moved = LuaTable.from([[1, 'Chief'], [7, spawns(215, [51, 50], [-1, -1])], [9, 215]]);
    expect(classifyRow('npc', moved, eraNpc(), COEFFICIENTS).tag).toBe('forever-changed');
    // An area without coefficients cannot explain a changed pair.
    const other = LuaTable.from([[1, 'Chief'], [7, spawns(14, [1, 1])]]);
    const otherForever = LuaTable.from([[1, 'Chief'], [7, spawns(14, [1.5, 1])]]);
    expect(classifyRow('npc', otherForever, other, COEFFICIENTS).tag).toBe('forever-changed');
  });

  it('checks the spawn list inside quest triggerEnd', () => {
    const [x, y] = projectEraPair(MULGORE, 10, 20);
    const era = LuaTable.from([[9, L('Explore', spawns(215, [10, 20]))]]);
    const forever = LuaTable.from([[9, L('Explore', spawns(215, [x, y]))]]);
    expect(classifyRow('quest', forever, era, COEFFICIENTS).tag).toBe('era-coords');
    const retexted = LuaTable.from([[9, L('Changed', spawns(215, [x, y]))]]);
    expect(classifyRow('quest', retexted, era, COEFFICIENTS).tag).toBe('forever-changed');
  });
});
