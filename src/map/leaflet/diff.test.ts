import { describe, expect, it } from 'vitest';
import { capItems, diffById, isEmptyDiff, sameData } from './diff';

interface Item {
  readonly id: string;
  readonly value: number;
}

const item = (id: string, value = 0): Item => ({ id, value });

describe('diffById', () => {
  it('sorts next items into added, changed and unchanged, and finds the removed ids', () => {
    const a = item('a');
    const b = item('b');
    const c = item('c');
    const previous = new Map<string, Item>([
      ['a', a],
      ['b', b],
      ['c', c],
    ]);
    const b2 = item('b', 1);
    const d = item('d');
    const diff = diffById(previous, [d, b2, a]);
    expect(diff.added).toEqual([d]);
    expect(diff.changed).toEqual([{ previous: b, next: b2 }]);
    expect(diff.unchanged).toBe(1);
    expect(diff.removed).toEqual(['c']);
    expect(diff.order.map((x) => x.id)).toEqual(['d', 'b', 'a']);
    expect(isEmptyDiff(diff)).toBe(false);
  });

  it('treats an equal but different object as changed: identity is the contract', () => {
    const previous = new Map([['a', item('a')]]);
    const diff = diffById(previous, [item('a')]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.unchanged).toBe(0);
  });

  it('is empty when every item is the same object', () => {
    const a = item('a');
    const diff = diffById(new Map([['a', a]]), [a]);
    expect(isEmptyDiff(diff)).toBe(true);
    expect(diff.unchanged).toBe(1);
  });

  it('keeps the first of repeated ids and reports the rest', () => {
    const first = item('x', 1);
    const diff = diffById(new Map<string, Item>(), [first, item('x', 2), item('y'), item('x', 3)]);
    expect(diff.added).toEqual([first, item('y')]);
    expect(diff.duplicates).toEqual(['x', 'x']);
    expect(diff.order.map((x) => x.value)).toEqual([1, 0]);
  });

  it('removes everything for an empty next list', () => {
    const diff = diffById(new Map([['a', item('a')], ['b', item('b')]]), []);
    expect(diff.removed).toEqual(['a', 'b']);
    expect(diff.added).toEqual([]);
  });
});

describe('capItems', () => {
  it('passes items under the cap through unchanged', () => {
    const items = [1, 2, 3];
    const result = capItems(items, 3);
    expect(result.kept).toBe(items);
    expect(result.dropped).toBe(0);
  });

  it('drops from the bottom of the draw order, keeping the top (focused items come last)', () => {
    expect(capItems([1, 2, 3, 4, 5], 2)).toEqual({ kept: [4, 5], dropped: 3 });
    expect(capItems([1, 2], 0)).toEqual({ kept: [], dropped: 2 });
    expect(capItems([1, 2], -3)).toEqual({ kept: [], dropped: 2 });
    expect(capItems([1, 2], Number.POSITIVE_INFINITY).dropped).toBe(0);
  });
});

describe('sameData', () => {
  it('compares plain data structurally, as plainEqual in map/layers does', () => {
    expect(sameData({ a: [1, { b: 'x' }] }, { a: [1, { b: 'x' }] })).toBe(true);
    expect(sameData({ a: [1, 2] }, { a: [1, 2, 3] })).toBe(false);
    expect(sameData({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameData([1], { 0: 1 })).toBe(false);
    expect(sameData(null, {})).toBe(false);
    expect(sameData(Number.NaN, Number.NaN)).toBe(false);
    expect(sameData('x', 'x')).toBe(true);
  });
});
