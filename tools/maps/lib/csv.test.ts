import { describe, expect, it } from 'vitest';
import { parseCsv, recordColumns, requireColumns } from './csv';

describe('parseCsv', () => {
  it('reads quoted fields with commas, escaped quotes and newlines, keeping each record’s raw text and line', () => {
    const text = 'Name_lang,ID,Note\n"Eastern Kingdoms",1415,plain\nShen\'dralas,2652,"a, ""b""\nsecond line"\nlast,1,x';
    const table = parseCsv(text);
    expect(table.header).toEqual(['Name_lang', 'ID', 'Note']);
    expect(table.records.map((r) => r.fields)).toEqual([
      ['Eastern Kingdoms', '1415', 'plain'],
      ["Shen'dralas", '2652', 'a, "b"\nsecond line'],
      ['last', '1', 'x'],
    ]);
    expect(table.records.map((r) => r.line)).toEqual([2, 3, 5]);
    expect(table.records[0]?.raw).toBe('"Eastern Kingdoms",1415,plain');
    expect(table.records[1]?.raw).toBe('Shen\'dralas,2652,"a, ""b""\nsecond line"');
    const [first] = table.records;
    if (first === undefined) throw new Error('no record');
    expect(recordColumns(table, first)).toEqual({ Name_lang: 'Eastern Kingdoms', ID: '1415', Note: 'plain' });
  });

  it('fails closed on CR line endings, ragged rows, stray quotes, unterminated quotes and duplicate columns', () => {
    expect(() => parseCsv('a,b\r\n1,2\r\n')).toThrow(/LF line endings/);
    expect(() => parseCsv('a,b\n1,2,3\n')).toThrow(/line 2: 3 fields, header has 2/);
    expect(() => parseCsv('a,b\n1x"y",2\n')).toThrow(/quote may only open a field/);
    expect(() => parseCsv('a,b\n"1,2\n')).toThrow(/unterminated/);
    expect(() => parseCsv('a,a\n1,2\n')).toThrow(/duplicate/);
    expect(() => parseCsv('')).toThrow(/no header/);
  });

  it('requireColumns names the missing columns', () => {
    const table = parseCsv('ID,Pos_0\n1,2\n');
    expect(() => requireColumns(table, ['ID', 'Pos_0'], 'x')).not.toThrow();
    expect(() => requireColumns(table, ['ID', 'Pos_1', 'ContinentID'], 'TaxiNodes')).toThrow('TaxiNodes: missing column(s) Pos_1, ContinentID');
  });
});
