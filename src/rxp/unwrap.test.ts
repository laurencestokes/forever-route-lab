import { describe, expect, it } from 'vitest';
import fixture01 from '../../tests/fixtures/rxp/01-basic-durotar.txt?raw';
import fixture03 from '../../tests/fixtures/rxp/03-lua-wrapped.txt?raw';
import { longBracketLevelFor, looksProtected, luaQuoted, unwrapRxpInput } from './unwrap';

const GUIDE_A = [
  '#forever',
  '<< Horde',
  '#name 6-8 Fixture Three',
  '#version 3',
  '#group Forever Route Lab Fixtures',
  '#subgroup Parser Samples',
  '',
  'step',
  '    .goto Durotar,52.00,43.00',
  '    >>Wrapped guide A, first step',
  '    .zone Durotar >>Enter Durotar',
  '',
].join('\n');

const GUIDE_B = [
  '#forever',
  '#name 6-8 Fixture Three (Alt)',
  '#version 1',
  '#group Forever Route Lab Fixtures',
  '',
  'step',
  '    *A star note that mentions a closing bracket pair ]] which would end a level-0 string\\nand has an escaped line break',
  '    .goto 1411,52.50,43.50,20',
  '',
].join('\n');

const GUIDE_C = [
  '#forever',
  '#name 8-9 Fixture Four',
  '#group This Line Is Ignored In The Two Argument Form',
  '#version 1',
  'step',
  '    .goto Durotar,53.00,44.00,15',
  '    >>Two-argument form',
  '',
].join('\n');

const GUIDE_D = [
  '#forever',
  '#name 9-10 Fixture Quoted',
  '#group Forever Route Lab Fixtures',
  '#version 1',
  'step',
  '    >>Quoted form with a "quote" and a backslash \\ in it',
  '    .goto Durotar,53.50,44.50,15',
  '',
].join('\n');

describe('unwrap: Lua-wrapped guides (docs/RXP.md §3.2)', () => {
  const result = unwrapRxpInput(fixture03);

  it('extracts exactly guides A-D from fixture 03, never the one in a block comment or the dynamic one', () => {
    expect(result.kind).toBe('lua');
    expect(result.guides.map((guide) => guide.text)).toEqual([GUIDE_A, GUIDE_B, GUIDE_C, GUIDE_D]);
    expect(result.guides.map((guide) => [guide.form, guide.level, guide.groupArg, guide.defaultForArg])).toEqual([
      ['long-bracket', 0, null, null],
      ['long-bracket', 2, null, null],
      ['long-bracket', 0, 'Forever Route Lab Fixtures', 'Orc/Troll'],
      ['quoted', null, null, null],
    ]);
  });

  it('reports the guards as ignored and the dynamic call as skipped, with Lua-file lines', () => {
    expect(result.diagnostics.map((d) => `${String(d.line)}:${String(d.column)} ${d.code}`)).toEqual([
      '11:1 RXP021-lua-guard-ignored',
      '66:1 RXP021-lua-guard-ignored',
      '67:1 RXP020-lua-dynamic',
    ]);
  });

  it('records the Lua-file line of every text line', () => {
    const [a, , , d] = result.guides;
    expect(a?.fileLines.slice(0, 3)).toEqual([17, 18, 19]);
    expect(a?.fileLines).toHaveLength(11);
    expect(d?.fileLines).toEqual([55, 55, 55, 55, 55, 55, 55]);
  });

  it('decodes Lua escapes in quoted strings, including decimal byte escapes as UTF-8', () => {
    const quoted = unwrapRxpInput('RXPGuides.RegisterGuide("a\\tb\\\\\\"\\195\\156\\65\\\nc")');
    expect(quoted.guides.map((guide) => guide.text)).toEqual(['a\tb\\"ÜA\nc']);
    expect(quoted.guides[0]?.fileLines).toEqual([1, 2]);
  });

  it('skips calls inside comments and strings, and reports non-literal or parenthesis-less calls', () => {
    const lua = [
      '-- RXPGuides.RegisterGuide([[#name no]])',
      'local s = "RXPGuides.RegisterGuide([[#name no]])"',
      'RXPGuides.RegisterGuide(name)',
      'RXPGuides.RegisterGuide [[#name no]]',
      'RXPGuides.RegisterGuide("a", "b", "c", "d")',
      'RXPGuides . RegisterGuide ( [=[#name yes]=] )',
      'addon.RXPGuides.RegisterGuide([[#name no]])',
    ].join('\n');
    const out = unwrapRxpInput(lua);
    expect(out.guides.map((guide) => guide.text)).toEqual(['#name yes']);
    expect(out.diagnostics.map((d) => `${String(d.line)} ${d.code}`)).toEqual([
      '2 RXP021-lua-guard-ignored',
      '3 RXP020-lua-dynamic',
      '4 RXP020-lua-dynamic',
      '5 RXP020-lua-dynamic',
      '7 RXP021-lua-guard-ignored',
    ]);
  });

  it('treats guide text without a registration call as raw text, exactly as given', () => {
    const raw = unwrapRxpInput(fixture01);
    expect(raw.kind).toBe('raw');
    expect(raw.guides.map((guide) => guide.text)).toEqual([fixture01]);
    expect(unwrapRxpInput('step\n    >>Talk about RegisterGuide here\n    .target Hana\'zua\n').kind).toBe('raw');
  });
});

describe('unwrap: protected import strings (docs/RXP.md §3.3)', () => {
  it('refuses the protected shapes without echoing them', () => {
    const inputs = ['  12|-345678:abcdef', 'x 17#QUJDREVGR0hJSktMTU5PUA==% y', 'lots of opaque data |3'];
    for (const input of inputs) {
      expect(looksProtected(input)).toBe(true);
      const out = unwrapRxpInput(input);
      expect(out.kind).toBe('refused');
      expect(out.guides).toEqual([]);
      expect(out.diagnostics.map((d) => d.code)).toEqual(['RXP019-protected-format']);
      expect(out.diagnostics[0]?.message).not.toContain(input.trim());
    }
  });

  it('does not refuse real guides, including ones with a percent-encoded URL or a trailing |digits', () => {
    expect(looksProtected(fixture01)).toBe(false);
    expect(looksProtected('#name A\nstep\n    .link https://example.org/1/abcdefghijklmnopqrstuv%20 >>x\n    >>colour |3')).toBe(false);
  });

  it('does not refuse a guide whose header looks like a count and hash, or ends in |digits (§3.3)', () => {
    expect(looksProtected('#forever\n#name 01|02: x\n#group G\nstep\n    .accept 1\n')).toBe(false);
    expect(looksProtected('#name 01|02: x\n#group G\n')).toBe(false);
    expect(looksProtected('#forever\n#name A\n#group G\n#version 3|12')).toBe(false);
    expect(unwrapRxpInput('#forever\n#name 01|02: x\n#group G\nstep\n').kind).toBe('raw');
    // A count and hash after a line break is not the protected shape's start.
    expect(looksProtected('some words\n12|-345:abcdef')).toBe(false);
  });
});

describe('unwrap: Lua tokenizer columns', () => {
  it('reports columns in code points after surrogate pairs and on later lines', () => {
    const out = unwrapRxpInput('local a = "🐗🐗" x = 1 RXPGuides.RegisterGuide(v)\n  y RXPGuides.RegisterGuide(w)');
    expect(out.diagnostics.map((d) => `${String(d.line)}:${String(d.column)} ${d.code}`)).toEqual([
      '1:1 RXP021-lua-guard-ignored',
      '1:22 RXP020-lua-dynamic',
      '2:3 RXP021-lua-guard-ignored',
      '2:5 RXP020-lua-dynamic',
    ]);
  });
});

describe('Lua wrapper helpers (docs/RXP.md §13.4 rule 14)', () => {
  it('picks the smallest safe long-bracket level', () => {
    expect(longBracketLevelFor('plain')).toBe(0);
    expect(longBracketLevelFor('a [[ b')).toBe(1);
    expect(longBracketLevelFor('a ]] b')).toBe(1);
    expect(longBracketLevelFor('a ]=] ]] b')).toBe(2);
    expect(longBracketLevelFor('ends with ]')).toBe(1);
  });

  it('quotes strings that the extractor reads back unchanged', () => {
    const value = 'Group "A" \\ é\n';
    const out = unwrapRxpInput(`RXPGuides.RegisterGuide(${luaQuoted(value)}, [[x]])`);
    expect(out.guides[0]?.groupArg).toBe(value);
  });
});
