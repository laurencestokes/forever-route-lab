import { describe, expect, it } from 'vitest';
import type { FilterAst } from '../domain/conditions';
import { parseFilter, printFilter } from './filter';

const word = (w: string): FilterAst => ({ kind: 'word', word: w });
const not = (expr: FilterAst): FilterAst => ({ kind: 'not', expr });
const and = (...exprs: FilterAst[]): FilterAst => ({ kind: 'and', exprs });
const or = (...exprs: FilterAst[]): FilterAst => ({ kind: 'or', exprs });
const level = (n: number): FilterAst => ({ kind: 'minLevel', level: n });

describe('filter parser (docs/RXP.md §6.2)', () => {
  it.each<[string, FilterAst]>([
    ['Horde', word('Horde')],
    ['!Orc !Troll', and(not(word('Orc')), not(word('Troll')))],
    ['(Orc/Troll) Warrior', and(or(word('Orc'), word('Troll')), word('Warrior'))],
    ['Warrior/Rogue', or(word('Warrior'), word('Rogue'))],
    ['Orc Warrior/Troll Rogue', or(and(word('Orc'), word('Warrior')), and(word('Troll'), word('Rogue')))],
    ['!(Orc/Troll)', not(or(word('Orc'), word('Troll')))],
    ['3', level(3)],
    ['!5', not(level(5))],
    ['tbc << wotlk', and(word('tbc'), word('wotlk'))],
    ['Night Elf', and(word('Night'), word('Elf'))],
    ['! Orc', word('Orc')],
    ['Orc-Troll', and(word('Orc'), word('Troll'))],
    ['1e1', level(10)],
    ['0x10', level(16)],
  ])('reads %j', (text, expected) => {
    expect(parseFilter(text).ast).toEqual(expected);
  });

  it('does not nest groups: the first ")" ends a group and a leftover "(" or ")" only separates words', () => {
    // RXP: the group is "(a/b" read flat, then " c)" leaves the word c and a separator.
    expect(parseFilter('((a/b) c)').ast).toEqual(and(or(word('a'), word('b')), word('c')));
    expect(parseFilter('a (b/c').ast).toEqual(or(and(word('a'), word('b')), word('c')));
  });

  it('ignores empty alternatives, and a filter with none left is false (§6.2 rule 2)', () => {
    expect(parseFilter('Orc/').ast).toEqual(word('Orc'));
    expect(parseFilter('/Orc').ast).toEqual(word('Orc'));
    expect(parseFilter('Orc//Troll').ast).toEqual(or(word('Orc'), word('Troll')));
    expect(parseFilter('/').ast).toEqual(or());
    expect(parseFilter('(Orc/)').ast).toEqual(word('Orc'));
    expect(parseFilter('( /Orc)').ast).toEqual(word('Orc'));
    expect(parseFilter('()').ast).toEqual(or());
    expect(parseFilter('Orc/(/)').ast).toEqual(or(word('Orc'), or()));
    expect(parseFilter('Orc/').quirks.map((q) => [q.offset, q.message])).toEqual([[4, expect.stringContaining('empty alternative')]]);
    expect(parseFilter('/').quirks.map((q) => q.message)).toEqual([expect.stringContaining('every alternative of this filter is empty')]);
  });

  it('reads an alternative that has characters but no words as true (§6.2 rule 3)', () => {
    expect(parseFilter('Orc/ - ').ast).toEqual(or(word('Orc'), and()));
    expect(parseFilter('Orc/ /Troll').ast).toEqual(or(word('Orc'), and(), word('Troll')));
    expect(parseFilter('(-) Orc').ast).toEqual(and(and(), word('Orc')));
    expect(parseFilter('Orc/ - ').quirks.map((q) => q.message)).toEqual([expect.stringContaining('characters but no words is always true')]);
  });

  it('reads a group written against a word or another group as one word that never matches (§6.2 rule 1)', () => {
    expect(parseFilter('Orc(Warrior)').ast).toEqual(word('Orc(Warrior)'));
    expect(parseFilter('(Orc)Warrior').ast).toEqual(word('(Orc)Warrior'));
    expect(parseFilter('Orc!(Warrior)').ast).toEqual(word('Orc!(Warrior)'));
    expect(parseFilter('!Orc(Warrior)').ast).toEqual(not(word('Orc(Warrior)')));
    expect(parseFilter('!(Orc)Warrior').ast).toEqual(word('!(Orc)Warrior'));
    expect(parseFilter('(Orc)(Troll)').ast).toEqual(word('(Orc)(Troll)'));
    expect(parseFilter('Orc( Warrior / Mage ) Rogue').ast).toEqual(and(word('Orc(Warrior/Mage)'), word('Rogue')));
    expect(parseFilter('Orc (Warrior)').ast).toEqual(and(word('Orc'), word('Warrior')));
    expect(parseFilter('Orc(Warrior)').quirks.map((q) => q.message)).toEqual([expect.stringContaining('"Orc(Warrior)" is one word in RXP')]);
    expect(parseFilter('Orc(Warrior)').usesLevel).toBe(false);
    expect(parseFilter('Orc(Warrior').ast).toEqual(and(word('Orc'), word('Warrior')));
  });

  it('knows Skyborne as a race word but not the project’s own race keys for its two halves (§6.3)', () => {
    expect(parseFilter('Skyborne').quirks).toEqual([]);
    for (const key of ['HighOrderSkyborne', 'WindshaperSkyborne']) {
      expect(parseFilter(key).quirks.map((q) => q.message)).toEqual([`"${key}" is not a filter word RXP knows on Forever, so it is always false`]);
    }
  });

  it('marks level words (RXP028)', () => {
    expect(parseFilter('3').usesLevel).toBe(true);
    expect(parseFilter('Orc').usesLevel).toBe(false);
  });
});

describe('filter printer (docs/RXP.md §13.4 rule 10)', () => {
  it.each([
    'Horde',
    '!Orc !Troll',
    '(Orc/Troll) Warrior',
    'Orc Warrior/Troll Rogue',
    '!(Orc/Troll)',
    '!5',
    'Orc/-',
    '-',
    '/',
    'Orc/(/)',
    '(-) Orc',
    'Orc(Warrior)',
    '!Orc(Warrior)',
    '(Orc)Warrior',
    'Orc!(Warrior)',
    '!(Orc)Warrior',
    'Orc(Warrior/Mage) Rogue',
    '(Orc Warrior) Mage',
    '(a/b)/c',
    '!(a b)',
  ])('prints %j back unchanged', (text) => {
    const ast = parseFilter(text).ast;
    expect(printFilter(ast)).toBe(text);
    expect(parseFilter(printFilter(ast) ?? '').ast).toEqual(ast);
  });

  it('normalises separators, keeps word spelling and never reorders', () => {
    expect(printFilter(parseFilter('tbc << wotlk').ast)).toBe('tbc wotlk');
    expect(printFilter(parseFilter('Troll  /  orc').ast)).toBe('Troll/orc');
    expect(printFilter(parseFilter('1e1').ast)).toBe('10');
    expect(printFilter(parseFilter('Orc//Troll/').ast)).toBe('Orc/Troll');
    expect(printFilter(parseFilter('Orc/  -  /Troll').ast)).toBe('Orc/-/Troll');
    expect(printFilter(parseFilter('()').ast)).toBe('/');
    expect(printFilter(parseFilter('Orc( Warrior / Mage )').ast)).toBe('Orc(Warrior/Mage)');
  });

  it('refuses ASTs with no RXP form', () => {
    expect(printFilter(not(word('(Orc)Warrior')))).toBeNull();
    expect(printFilter(word('Orc(Warrior / Mage)'))).toBeNull();
    expect(printFilter(word('Orc(a<<b)'))).toBeNull();
    expect(printFilter(or(word('a'), and(word('b(c)'))))).toBe('a/b(c)');
    expect(printFilter(and(or(word('a'), word('b(c)'))))).toBeNull();
    expect(printFilter(word('Night Elf'))).toBeNull();
    expect(printFilter(not(not(word('Orc'))))).toBeNull();
    expect(printFilter(and(or(word('a'), and(or(word('b'), word('c')), word('d'))), word('e')))).toBeNull();
    expect(printFilter(level(2.5))).toBeNull();
  });
});
