import { describe, expect, it } from 'vitest';
import { minutesText, parseIdList, parseMinutes, parseNumber, parseWhole, parseWordList } from './field-parse';

describe('field parsing', () => {
  it('reads plain decimals only, with empty meaning not set', () => {
    expect(parseNumber(' 12.5 ')).toEqual({ kind: 'number', value: 12.5 });
    expect(parseNumber('-3')).toEqual({ kind: 'number', value: -3 });
    expect(parseNumber('')).toEqual({ kind: 'empty' });
    expect(parseNumber('   ')).toEqual({ kind: 'empty' });
    for (const bad of ['1e3', '12,5', 'abc', '.5', '5.', '--1', 'Infinity']) expect(parseNumber(bad)).toEqual({ kind: 'invalid' });
    expect(parseWhole('7')).toEqual({ kind: 'number', value: 7 });
    expect(parseWhole('7.5')).toEqual({ kind: 'invalid' });
  });

  it('turns minutes into whole seconds, and back', () => {
    expect(parseMinutes('12.5')).toEqual({ kind: 'seconds', seconds: 750 });
    expect(parseMinutes('0.01')).toEqual({ kind: 'seconds', seconds: 1 });
    expect(parseMinutes('0')).toEqual({ kind: 'seconds', seconds: 0 });
    expect(parseMinutes('')).toEqual({ kind: 'empty' });
    expect(parseMinutes('-1')).toEqual({ kind: 'invalid' });
    expect(parseMinutes('ten')).toEqual({ kind: 'invalid' });
    expect(minutesText(750)).toBe('12.5');
    expect(minutesText(45)).toBe('0.75');
    expect(minutesText(0)).toBe('0');
  });

  it('reads id lists and word lists', () => {
    expect(parseIdList('123, 456 -2,,123')).toEqual([123, 456, -2]);
    expect(parseIdList('')).toEqual([]);
    expect(parseIdList('12, x')).toBeNull();
    expect(parseIdList('0')).toBeNull();
    expect(parseIdList('1.5')).toBeNull();
    expect(parseWordList(' RFC, WC ,, RFC ')).toEqual(['RFC', 'WC']);
    expect(parseWordList('')).toEqual([]);
  });
});
