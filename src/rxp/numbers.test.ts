import { describe, expect, it } from 'vitest';
import { parseLuaInteger, parseLuaNumber, parseXpExpression } from './numbers';
import { closestName, codePointColumn, formatFixed2, formatNumber } from './text';

describe('Lua number conversion (docs/RXP.md §9.0)', () => {
  it.each<[string, number | null]>([
    ['5', 5],
    ['+5', 5],
    ['.5', 0.5],
    ['5.', 5],
    ['-600.30', -600.3],
    ['1e3', 1000],
    ['0x10', 16],
    ['-0x10', -16],
    ['5.5.5', null],
    ['-600.00.00', null],
    ['', null],
    ['abc', null],
    ['inf', null],
    ['1e', null],
  ])('%j reads as %j', (text, expected) => {
    expect(parseLuaNumber(text)).toBe(expected);
  });

  it('reads integers only when the value is a safe integer', () => {
    expect(parseLuaInteger('4641')).toBe(4641);
    expect(parseLuaInteger('4641.0')).toBe(4641);
    expect(parseLuaInteger('4641.5')).toBeNull();
  });
});

describe('.xp level expressions (docs/RXP.md §9.4)', () => {
  it.each([
    ['5', { below: false, level: 5, offset: null, extra: false }],
    ['5+200', { below: false, level: 5, offset: { kind: 'xpInto', xp: 200 }, extra: false }],
    ['5-300', { below: false, level: 5, offset: { kind: 'xpShort', xp: 300 }, extra: false }],
    ['10.25', { below: false, level: 10, offset: { kind: 'fraction', fraction: 0.25, digits: '25' }, extra: false }],
    ['<5', { below: true, level: 5, offset: null, extra: false }],
    ['< 5 + 20', { below: true, level: 5, offset: { kind: 'xpInto', xp: 20 }, extra: false }],
    ['lvl5x', { below: false, level: 5, offset: null, extra: true }],
  ])('%j', (text, expected) => {
    expect(parseXpExpression(text)).toEqual(expected);
  });

  it('finds no shape in text without digits', () => {
    expect(parseXpExpression('<')).toBeNull();
  });
});

describe('text helpers', () => {
  it('formats new numbers without exponents, leading "+" or "-0"', () => {
    expect(formatNumber(10)).toBe('10');
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(0.5)).toBe('0.5');
    expect(formatNumber(1e21)).toBe('1000000000000000000000');
    expect(formatNumber(1.5e-7)).toBe('0.00000015');
    expect(formatNumber(-2.5e-7)).toBe('-0.00000025');
    expect(formatNumber(Number.NaN)).toBeNull();
    expect(formatFixed2(-4000)).toBe('-4000.00');
    expect(formatFixed2(-0.001)).toBe('0.00');
  });

  it('counts columns in code points and suggests close names', () => {
    expect(codePointColumn('a🐗b', 3)).toBe(3);
    expect(closestName('completwith', ['sticky', 'completewith'])).toBe('completewith');
    expect(closestName('zzz', ['sticky'])).toBeNull();
  });
});
