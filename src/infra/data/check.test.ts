import { describe, expect, it } from 'vitest';
import { array, checkAscendingIds, checkValue, literal, map, MAX_ERRORS, nullable, object, partial, union } from './check';

interface Pair {
  a: number;
  b: string | null;
}

const pair = object<Pair>({ a: 'int', b: nullable('string') });

describe('checkValue', () => {
  it('accepts values that match and reports nothing', () => {
    expect(checkValue(pair, { a: 1, b: null }, 'x')).toEqual([]);
    expect(checkValue(array(pair), [{ a: -3, b: 'ok' }], 'x')).toEqual([]);
  });

  it('is strict about keys: a missing and an unexpected key both fail, with their paths', () => {
    expect(checkValue(pair, { a: 1 }, 'x')).toEqual(['x.b: missing']);
    expect(checkValue(pair, { a: 1, b: null, c: 2 }, 'x')).toEqual(['x.c: unexpected key']);
  });

  it('lets partial objects omit keys but still refuses unknown ones', () => {
    const patch = partial<Pair>({ a: 'int', b: nullable('string') });
    expect(checkValue(patch, {}, 'p')).toEqual([]);
    expect(checkValue(patch, { b: 'x' }, 'p')).toEqual([]);
    expect(checkValue(patch, { id: 1 }, 'p')).toEqual(['p.id: unexpected key']);
  });

  it('distinguishes the integer kinds and finite numbers', () => {
    expect(checkValue('int', -1, 'v')).toEqual([]);
    expect(checkValue('uint', -1, 'v')).toEqual(['v: expected an integer >= 0, got -1']);
    expect(checkValue('id', 0, 'v')).toEqual(['v: expected an integer >= 1, got 0']);
    expect(checkValue('int', 1.5, 'v')).toEqual(['v: expected an integer, got 1.5']);
    expect(checkValue('number', 1.5, 'v')).toEqual([]);
    expect(checkValue('number', Number.NaN, 'v')).toEqual(['v: expected a finite number, got NaN']);
    expect(checkValue('int', '1', 'v')).toEqual(['v: expected an integer, got the string "1"']);
  });

  it('takes signed ids as any integer but 0, which ships as null (M2 review code-F8)', () => {
    expect(checkValue('signedId', -22, 'v')).toEqual([]);
    expect(checkValue('signedId', 14, 'v')).toEqual([]);
    expect(checkValue('signedId', 0, 'v')).toEqual(['v: expected a non-zero integer, got 0']);
    expect(checkValue('signedId', 1.5, 'v')).toEqual(['v: expected a non-zero integer, got 1.5']);
    expect(checkValue(nullable('signedId'), null, 'v')).toEqual([]);
    expect(checkValue(nullable('id'), 0, 'v')).toEqual(['v: expected an integer >= 1, got 0']);
  });

  it('checks literals, maps and tagged unions', () => {
    expect(checkValue(literal('A', 'H', null), 'X', 'v')).toEqual(['v: expected one of "A", "H", null, got the string "X"']);
    expect(checkValue(map('uint', 'int'), { '1': 2, '10': 3 }, 'm')).toEqual([]);
    expect(checkValue(map('uint', 'int'), { '01': 2 }, 'm')).toEqual(['m.01: key is not a decimal id']);
    expect(checkValue(map('token', 'int'), { WARRIOR: 1, warrior: 2 }, 'm')).toEqual(['m.warrior: key is not an upper-case token']);
    const shape = union('kind', {
      one: object<{ kind: 'one'; n: number }>({ kind: literal('one'), n: 'int' }),
      two: object<{ kind: 'two' }>({ kind: literal('two') }),
    });
    expect(checkValue(shape, { kind: 'two' }, 'u')).toEqual([]);
    expect(checkValue(shape, { kind: 'one' }, 'u')).toEqual(['u.n: missing']);
    expect(checkValue(shape, { kind: 'three' }, 'u')).toEqual(['u.kind: expected one of one, two, got the string "three"']);
  });

  it('accepts published point rows and the exact presence sentinel only', () => {
    expect(checkValue(array('point'), [[42.06, 68.33], [1, 2, 3], [-1, -1]], 'p')).toEqual([]);
    expect(checkValue('point', [-1, 50], 'p')).toEqual(['p: malformed instance-presence sentinel (must be exactly [-1, -1])']);
    // The dataset contract is 0-100 or exactly [-1, -1] (COORD-11): a lone -1 is a damaged sentinel,
    // even where it would be a legal off-frame value such as [-1, 55.2]; other off-frame values pass.
    expect(checkValue('point', [-1, 55.2], 'p')).toEqual(['p: malformed instance-presence sentinel (must be exactly [-1, -1])']);
    expect(checkValue('point', [-0.5, 101.25], 'p')).toEqual([]);
    expect(checkValue('point', [-1, -1, 2], 'p')).toEqual(['p: malformed instance-presence sentinel (must be exactly [-1, -1])']);
    expect(checkValue('point', [1], 'p')).toEqual(['p: expected a point row [x, y] or [x, y, phase]']);
    expect(checkValue('point', [1, 2, 0.5], 'p')).toEqual(['p: a point phase must be an integer']);
    expect(checkValue('point', [1, 'x'], 'p')).toEqual(['p: point coordinates must be finite numbers']);
  });

  it('stops after MAX_ERRORS problems', () => {
    const bad = Array.from({ length: 100 }, () => 'x');
    expect(checkValue(array('int'), bad, 'a')).toHaveLength(MAX_ERRORS);
  });
});

describe('checkAscendingIds', () => {
  it('passes ascending unique ids and names the first offender', () => {
    expect(checkAscendingIds([{ id: 1 }, { id: 2 }, { id: 9 }], 'rows')).toEqual([]);
    expect(checkAscendingIds([{ id: 1 }, { id: 3 }, { id: 3 }], 'rows')).toEqual(['rows[2].id: ids must be unique and ascending (3 then 3)']);
    expect(checkAscendingIds([{ id: 5 }, { id: 4 }], 'rows')).toEqual(['rows[1].id: ids must be unique and ascending (5 then 4)']);
  });
});
