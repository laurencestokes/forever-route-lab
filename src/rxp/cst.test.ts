import { describe, expect, it } from 'vitest';
import fixture01 from '../../tests/fixtures/rxp/01-basic-durotar.txt?raw';
import fixture02 from '../../tests/fixtures/rxp/02-filters-and-step-tags.txt?raw';
import fixture03 from '../../tests/fixtures/rxp/03-lua-wrapped.txt?raw';
import fixture04 from '../../tests/fixtures/rxp/04-edge-cases-crlf.txt?raw';
import fixture05 from '../../tests/fixtures/rxp/05-travel-and-conditions.txt?raw';
import fixture06 from '../../tests/fixtures/rxp/06-lowering-and-export.txt?raw';
import { guideDiagnostics, parseRxpCst, printRxpCst, type RxpCstLine } from './cst';
import { splitAnyEol } from './test-fixtures';

const FIXTURES: Readonly<Record<string, string>> = { fixture01, fixture02, fixture03, fixture04, fixture05, fixture06 };

/** U+FEFF, the UTF-8 byte-order mark, built from its code so no source file holds the raw character. */
const BOM = String.fromCharCode(0xfeff);

/** The same text with every line ending replaced by `endings[k % endings.length]`. */
function withEndings(text: string, endings: readonly string[]): string {
  const lines = splitAnyEol(text);
  return lines.map((line, k) => line + (k === lines.length - 1 ? '' : (endings[k % endings.length] ?? '\n'))).join('');
}

/** A small deterministic generator (no Math.random in the pure set). */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const lineAt = (text: string, lineNo: number): RxpCstLine => {
  const line = parseRxpCst(text).lines[lineNo - 1];
  if (line === undefined) throw new Error(`no line ${String(lineNo)}`);
  return line;
};

describe('Layer 1 CST: print(parse(x)) === x', () => {
  it('reads fixture 04 with its exact bytes (CRLF, a tab, trailing spaces, no final newline)', () => {
    expect(fixture04.split('\r\n')).toHaveLength(113);
    expect(fixture04.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(fixture04.endsWith('no trailing newline')).toBe(true);
    expect(fixture04).toContain('\t.goto Durotar,42.06,68.33   \r\n');
  });

  it.each(Object.entries(FIXTURES))('round-trips %s byte for byte', (_name, text) => {
    const cst = parseRxpCst(text);
    expect(printRxpCst(cst)).toBe(text);
    for (const line of cst.lines) {
      expect(line.indent + line.content + line.gap + (line.comment === null ? '' : `--${line.comment}`)).toBe(line.raw);
    }
  });

  it.each(Object.entries(FIXTURES))('round-trips LF, CR-only, CRLF and mixed-ending variants of %s', (_name, text) => {
    const variants = [
      withEndings(text, ['\n']),
      withEndings(text, ['\r']),
      withEndings(text, ['\r\n']),
      withEndings(text, ['\n', '\r\n', '\r']),
      withEndings(text, ['\r', '\r\n']),
      `${withEndings(text, ['\n'])}\n`,
      `${BOM}${withEndings(text, ['\r\n', '\n'])}\r\n\r\n`,
    ];
    for (const variant of variants) expect(printRxpCst(parseRxpCst(variant))).toBe(variant);
  });

  it('round-trips arbitrary strings, including surrogates and lone carriage returns', () => {
    const alphabet = ['s', 't', 'e', 'p', ' ', '\t', '\r', '\n', '-', '<', '>', '#', '.', '+', '*', ',', ';', '=', '(', ')', '/', '!', 'é', '翻', '🐗', '\ud800', BOM];
    const random = lcg(42);
    for (let sample = 0; sample < 300; sample += 1) {
      let text = '';
      const length = Math.floor(random() * 80);
      for (let k = 0; k < length; k += 1) text += alphabet[Math.floor(random() * alphabet.length)] ?? '';
      expect(printRxpCst(parseRxpCst(text))).toBe(text);
    }
    expect(printRxpCst(parseRxpCst(''))).toBe('');
  });

  it('keeps line endings per line and numbers physical lines from 1', () => {
    const cst = parseRxpCst('#name A\r\n\rstep\n    .accept 1');
    expect(cst.lines.map((line) => [line.line, line.eol])).toEqual([
      [1, '\r\n'],
      [2, '\r'],
      [3, '\n'],
      [4, ''],
    ]);
    expect(cst.stepLines).toEqual([2]);
  });

  it('keeps a byte-order mark and reports it (RXP026)', () => {
    const cst = parseRxpCst(`${BOM}#forever\nstep\n`);
    expect(cst.bom).toBe(true);
    expect(printRxpCst(cst)).toBe(`${BOM}#forever\nstep\n`);
    expect(cst.diagnostics.map((d) => d.code)).toEqual(['RXP026-bom']);
  });
});

describe('Layer 1 CST: classification (docs/RXP.md §4, §5)', () => {
  it('splits a line into indentation, content, gap and comment', () => {
    const line = lineAt(fixture04, 20);
    expect([line.indent, line.content, line.gap, line.comment]).toEqual(['\t', '.goto Durotar,42.06,68.33', '   ', null]);
    const commented = lineAt(fixture01, 40);
    expect([commented.content, commented.comment]).toEqual(['.complete 788,1', 'objective 1 of quest 788']);
  });

  it('assigns header and step sections and step indices', () => {
    const cst = parseRxpCst(fixture01);
    expect(lineAt(fixture01, 14).section).toBe('header');
    expect(cst.stepLines).toHaveLength(18);
    const first = cst.lines[cst.stepLines[0] ?? 0];
    expect(first?.kind).toBe('step');
    expect(first?.stepIndex).toBe(0);
    expect(cst.lines[(cst.stepLines[0] ?? 0) + 1]?.stepIndex).toBe(0);
  });

  it('reads tags, the header filter and step filters', () => {
    const enabled = lineAt(fixture01, 15);
    expect(enabled.kind).toBe('enabledFor');
    expect(enabled.filter?.parsed.ast).toEqual({ kind: 'word', word: 'Horde' });
    const tag = lineAt(fixture02, 11);
    expect(tag.tag).toEqual({ key: 'displayname', value: '4-6 Fixture Two (Alliance)', assignment: false });
    expect(tag.filter?.text).toBe('Alliance');
    const step = lineAt(fixture02, 24);
    expect(step.kind).toBe('step');
    expect(step.stepSuffix).toBeNull();
    expect(step.filter?.text).toBe('(Orc/Troll) Warrior');
  });

  it('splits command arguments by the command separator and drops empty fields', () => {
    expect(lineAt(fixture04, 45).command?.args).toEqual(['1411', '42.00', '68.00', '25', '0']);
    expect(lineAt(fixture04, 45).command?.emptyFields).toBe(1);
    expect(lineAt(fixture04, 49).command?.args).toEqual(['Durotar', '42.10', '68.20', '10']);
    expect(lineAt(fixture04, 61).command?.args).toEqual(['Scorpid Worker', 'Vile Familiar']);
    expect(lineAt(fixture04, 59).command?.args).toEqual(['https://example.org/a,b?x=1\\-\\-2']);
    expect(lineAt(fixture04, 59).text).toBe('A link whose URL has commas and an escaped double dash');
  });

  it('reproduces RXP’s order: filter first, then tag, then text, then command (§4 P8)', () => {
    const before = lineAt(fixture04, 53);
    expect(before.kind).toBe('command');
    expect(before.text).toBeNull();
    expect(before.filter?.text).toBe('Horde >> Turn in Cutting Teeth');
    const after = lineAt(fixture04, 55);
    expect(after.text).toBe('Turn in Sting of the Scorpid');
    expect(after.filter?.text).toBe('Horde');
    const tagWithArrow = parseRxpCst('step\n#tip a >> b << Orc').lines[1];
    expect(tagWithArrow?.tag?.value).toBe('a >> b');
    expect(parseRxpCst('step\n#key=value').lines[1]?.tag).toEqual({ key: 'key=value', value: null, assignment: false });
    expect(lineAt(fixture04, 91).tag).toEqual({ key: 'OnComplete', value: 'noop', assignment: true });
  });

  it('treats "--" anywhere as a comment, and "<<" at the very end as text', () => {
    expect(lineAt(fixture04, 57).text).toBe('Kill boars');
    const trailing = parseRxpCst('step\n    >>a <<').lines[1];
    expect(trailing?.filter).toBeNull();
    expect(trailing?.text).toBe('a <<');
  });

  it('recognises plain lines: notes, objectives, star notes and stray text (§4 P8e)', () => {
    expect(lineAt(fixture04, 68).kind).toBe('objective');
    expect(lineAt(fixture04, 70).kind).toBe('star');
    expect(lineAt(fixture04, 28).kind).toBe('stray');
    const cst = parseRxpCst('step\n+label >>shown\nfoo >>bar\n>>');
    expect(cst.lines.slice(1).map((line) => [line.kind, line.lead, line.text])).toEqual([
      ['objective', '+label', 'shown'],
      ['note', 'foo', 'bar'],
      ['stray', null, null],
    ]);
  });

  it('starts a step on any line beginning with "step", case-sensitively (§4 P5)', () => {
    const cst = parseRxpCst(fixture04);
    const accidental = lineAt(fixture04, 95);
    expect(accidental.kind).toBe('step');
    expect(accidental.stepSuffix).toBe('wise text that starts with the letters step');
    expect(lineAt(fixture04, 98).kind).toBe('stray');
    expect(cst.stepLines).toHaveLength(8);
  });
});

describe('Layer 1 CST: diagnostics (docs/RXP.md §11)', () => {
  it('reports every fixture 04 edge case with its code and line', () => {
    const cst = parseRxpCst(fixture04);
    expect(cst.diagnostics.map((d) => `${String(d.line)} ${d.code}`)).toEqual([
      '14 RXP013-shadowed-tag',
      '15 RXP015-header-command',
      '28 RXP002-stray-line',
      '30 RXP001-unknown-command',
      '32 RXP017-command-case',
      '45 RXP005-empty-field',
      '47 RXP005-empty-field',
      '53 RXP006-filter-before-text',
      '53 RXP016-filter-quirk',
      '53 RXP016-filter-quirk',
      '53 RXP016-filter-quirk',
      '53 RXP016-filter-quirk',
      '57 RXP007-inline-comment',
      '88 RXP012-unknown-tag',
      '89 RXP012-unknown-tag',
      '91 RXP014-function-tag',
      '94 RXP013-shadowed-tag',
      '95 RXP010-step-prefix',
      '98 RXP011-step-typo',
      '113 RXP022-unterminated-comment',
    ]);
    expect(cst.diagnostics.find((d) => d.code === 'RXP012-unknown-tag')?.message).toContain('did you mean "#completewith"');
    expect(cst.diagnostics.find((d) => d.code === 'RXP017-command-case')?.message).toContain('".accept"');
  });

  it('gives columns in Unicode code points', () => {
    // ">", ">", "翻", "🐗" (one code point, two UTF-16 units), " ", then "--" at column 6.
    const cst = parseRxpCst('step\n>>翻🐗 -- c\n');
    expect(cst.diagnostics).toEqual([expect.objectContaining({ code: 'RXP007-inline-comment', line: 2, column: 6 })]);
  });

  it('reports filter quirks: double "<<", unknown words, parentheses, "!" and number-like words (RXP016)', () => {
    const codes = (text: string): string[] => parseRxpCst(`step\n>>x << ${text}`).diagnostics.map((d) => d.message);
    expect(codes('tbc << wotlk')).toEqual([expect.stringContaining('second "<<"')]);
    expect(codes('Aliance')).toEqual([expect.stringContaining('"Aliance"')]);
    expect(codes('orc')).toEqual([expect.stringContaining('did you mean "Orc"')]);
    expect(codes('skip')).toEqual([]);
    expect(codes('((Orc/Troll) Warrior)')).toEqual(expect.arrayContaining([expect.stringContaining('nested parentheses')]));
    expect(codes('! Orc')).toEqual([expect.stringContaining('"!" is not directly before a word')]);
    expect(codes('1e1')).toEqual([expect.stringContaining('the number 10')]);
    expect(codes('Orc/')).toEqual([expect.stringContaining('empty alternative')]);
    expect(codes('/')).toEqual([expect.stringContaining('every alternative of this filter is empty')]);
    expect(codes('Orc/ - ')).toEqual([expect.stringContaining('characters but no words is always true')]);
    expect(codes('Orc(Warrior)')).toEqual([expect.stringContaining('is one word in RXP')]);
  });

  it('says that the last "<< filter" header line decides whether the guide loads (§4 P7)', () => {
    const cst = parseRxpCst('<< Horde\n#name A\n<< Orc\nstep\n');
    expect(cst.diagnostics.map((d) => [d.line, d.code])).toEqual([[3, 'RXP013-shadowed-tag']]);
    expect(cst.diagnostics[0]?.message).toContain('keeps the first one (line 1) as the guide\'s filter');
    expect(cst.diagnostics[0]?.message).toContain('from the last such line');
  });

  it('reports a filtered first "<< filter" header line only once, and duplicate unfiltered tags', () => {
    const cst = parseRxpCst('<< Horde\n<< Orc\n#name A\n#name B << Orc\n#name C\n');
    expect(cst.diagnostics.map((d) => `${String(d.line)} ${d.code}`)).toEqual(['2 RXP013-shadowed-tag', '4 RXP013-shadowed-tag', '5 RXP013-shadowed-tag']);
    const filteredFirst = parseRxpCst('step\n#completewith next << Warrior\n#completewith Boars << !Warrior\n');
    expect(filteredFirst.diagnostics).toEqual([]);
  });

  it('checks the guide header: missing #name/#group, other games, #classic without #forever', () => {
    const codes = (text: string, groupArg: string | null = null): string[] => guideDiagnostics(parseRxpCst(text), { groupArg }).map((d) => d.code);
    expect(codes('#forever\n#name A\n#group G\nstep\n')).toEqual([]);
    expect(codes('#forever\n#name A\nstep\n')).toEqual(['RXP025-missing-name-or-group']);
    expect(codes('#forever\n#name A\nstep\n', 'Group from Lua')).toEqual([]);
    expect(codes('#tbc\n#name A\n#group G\n')).toEqual(['RXP024-other-game']);
    expect(codes('#classic\n#name A\n#group G\n')).toEqual(['RXP027-classic-header']);
    // Fixture 01 has both #forever and #classic, so RXP027 does not apply to it.
    expect(guideDiagnostics(parseRxpCst(fixture01), { groupArg: null })).toEqual([]);
  });
});
