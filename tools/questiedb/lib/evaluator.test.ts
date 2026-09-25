import { describe, expect, it } from 'vitest';
import { Evaluator, hostFunction, type Lint, LuaEvalError } from './evaluator';
import { bytesToLuaText, decodeLuaBytes, parseLua } from './lua-source';
import { LuaTable, type LuaValue, luaEqual, sequence, ShapeError, toPlain } from './lua-value';

/** Runs a Lua chunk given as a JS string of UTF-8 text, the way the extractor reads bytes. */
function run(source: string, globals: ReadonlyMap<string, LuaValue> = new Map(), varargs: readonly LuaValue[] = []): { readonly value: LuaValue; readonly lints: readonly Lint[] } {
  const text = bytesToLuaText(Buffer.from(source, 'utf8'), 'test.lua');
  const lints: Lint[] = [];
  const value = new Evaluator({ file: 'test.lua', globals, varargs, lints }).runChunk(parseLua(text, 'test.lua', { locations: true }));
  return { value, lints };
}

const plain = (source: string): unknown => toPlain(run(source).value);

describe('Lua values', () => {
  it('treats positional and explicit integer keys as one key space, drops nil, and normalises -0', () => {
    const table = LuaTable.list(['a', null, 'c']);
    expect(table.size).toBe(2);
    expect(table.get(1)).toBe('a');
    expect(table.get(2)).toBeNull();
    table.set(-0, 'zero');
    expect(table.keys()).toEqual([0, 1, 3]);
    table.set(1, null);
    expect(table.has(1)).toBe(false);
  });

  it('reads sequences 1..n and fails closed on holes', () => {
    expect(sequence(LuaTable.list([1, 2, 3]), 'x')).toEqual([1, 2, 3]);
    expect(() => sequence(LuaTable.list([1, null, 3]), 'x')).toThrow(ShapeError);
    expect(() => sequence(LuaTable.from([['a', 1]]), 'x')).toThrow(ShapeError);
  });

  it('compares tables structurally', () => {
    expect(luaEqual(LuaTable.list([1, LuaTable.list([2])]), LuaTable.list([1, LuaTable.list([2])]))).toBe(true);
    expect(luaEqual(LuaTable.list([1]), LuaTable.list([1, 2]))).toBe(false);
    expect(luaEqual(new LuaTable(), null)).toBe(false);
  });
});

describe('literal parsing', () => {
  it('reads numbers in every Lua 5.1 spelling', () => {
    expect(plain('return {1, -2, 3.5, .5, 1e3, 0x10, -0.25, 42.10}')).toEqual({ 1: 1, 2: -2, 3: 3.5, 4: 0.5, 5: 1000, 6: 16, 7: -0.25, 8: 42.1 });
  });

  it('decodes string escapes byte-accurately and reads UTF-8', () => {
    expect(plain(String.raw`return {"a\"b", 'it\'s', "back\\slash", "line\nbreak", "\195\169t\195\169", "café"}`)).toEqual({
      1: 'a"b',
      2: "it's",
      3: 'back\\slash',
      4: 'line\nbreak',
      5: 'été',
      6: 'café',
    });
  });

  it('reads long-bracket strings, skipping one leading newline', () => {
    expect(run('return [[\nfirst\nsecond]]').value).toBe('first\nsecond');
    expect(run('return [==[a]]b]==]').value).toBe('a]]b');
  });

  it('keeps positional holes: {nil, {55}} has only key 2', () => {
    const value = run('return {nil, {55}}').value;
    expect(value).toBeInstanceOf(LuaTable);
    expect((value as LuaTable).keys()).toEqual([2]);
  });

  it('mixes positional and keyed fields', () => {
    expect(plain('return {nil, 3, "text", 0, {{"object", 2715}}, [7] = true, name = "n"}')).toEqual({ 2: 3, 3: 'text', 4: 0, 5: { 1: { 1: 'object', 2: 2715 } }, 7: true, name: 'n' });
  });

  it('treats [k] = nil as a no-op and keeps the last of repeated keys, as Lua does, with a lint', () => {
    const { value, lints } = run('return {[1] = "a", [2] = nil, [1] = "b"}');
    expect(toPlain(value)).toEqual({ 1: 'b' });
    expect(lints).toHaveLength(1);
    expect(lints[0]?.kind).toBe('duplicate-key');
  });

  it('fails closed when a positional value collides with an explicit integer key', () => {
    expect(() => run('return {"a", [1] = "b"}')).toThrow(LuaEvalError);
  });

  it('rejects invalid UTF-8 in strings', () => {
    expect(() => decodeLuaBytes('\xff\xfe', 'x')).toThrow(/UTF-8/);
    expect(() => run(String.raw`return "\255"`)).toThrow(/UTF-8/);
  });

  it('rejects a byte-order mark', () => {
    expect(() => bytesToLuaText(Buffer.from([0xef, 0xbb, 0xbf, 0x72]), 'bom.lua')).toThrow(/byte-order mark/);
  });
});

describe('whitelisted evaluation', () => {
  it('runs locals, module methods with self, if/elseif/else, and/or, not, + and comparisons', () => {
    const source = `
      local M = {}
      local base = 40
      function M:Load()
        local t = { value = base + 2, flag = not false, pick = (nil or "x") and "y" }
        if base > 50 then return { branch = "a" }
        elseif base >= 40 then t.branch = "b"
        else return nil end
        t.self = self == M
        return t
      end
      return M:Load()
    `;
    expect(plain(source)).toEqual({ value: 42, flag: true, pick: 'y', branch: 'b', self: true });
  });

  it('passes ... to the chunk and calls host functions', () => {
    const globals = new Map<string, LuaValue>([['Twice', hostFunction('Twice', (args) => (typeof args[0] === 'number' ? args[0] * 2 : null), { singleValued: true })]]);
    expect(run('local _, lib = ...\nreturn { lib.n, Twice(21) }', globals, ['QuestieDB', LuaTable.from([['n', 7]])]).value).toSatisfy((v: LuaValue) => luaEqual(v, LuaTable.list([7, 42])));
  });

  it('indexes a constructor with a class token; an absent key reads nil, so the field disappears', () => {
    const globals = new Map<string, LuaValue>([['playerClass', 'SHAMAN']]);
    expect(toPlain(run('return { next = ({ DRUID = 1, MAGE = 2 })[playerClass], other = ({ SHAMAN = 3 })[playerClass] }', globals).value)).toEqual({ other: 3 });
    expect(toPlain(run('return { next = ({ DRUID = 1 })[playerClass] }', globals).value)).toEqual({});
  });

  it.each([
    ['a loop', 'for i = 1, 2 do end'],
    ['a while loop', 'while false do end'],
    ['a local function', 'local function f() end'],
    ['a function with parameters', 'local M = {} function M:F(x) end'],
    ['an anonymous function', 'local f = function() end'],
    ['the length operator', 'return #{}'],
    ['concatenation', 'return "a" .. "b"'],
    ['multiplication', 'return 2 * 3'],
    ['a call statement', 'print("x")'],
    ['several return values', 'return 1, 2'],
    ['a table call', 'local t = f{}'],
    ['two locals from one call', 'local a, b = f()'],
    ['two locals from one string call', 'local a, b = f"x"'],
    ['two locals from one method call', 'local a, b, c = 1, t:m()'],
  ])('fails closed on %s, wherever it is', (_label, source) => {
    expect(() => run(`if false then ${source} end`)).toThrow(LuaEvalError);
  });

  it('fails closed on `local playerClass, playerClassId = UnitClassBase("player")` (data-F1)', () => {
    // The real UnitClassBase returns (classFile, classId); a one-value host function would bind
    // nil to playerClassId, and a correction using it would be dropped silently.
    const globals = new Map<string, LuaValue>([['UnitClassBase', hostFunction('UnitClassBase', () => 'SHAMAN')]]);
    const source = `
      local QuestieDB = { questKeys = { requiredClasses = 7 } }
      local Fixes = {}
      function Fixes:LoadDynamic()
        local playerClass, playerClassId = UnitClassBase("player")
        return { [8315] = { [QuestieDB.questKeys.requiredClasses] = playerClassId } }
      end
      return Fixes:LoadDynamic()
    `;
    expect(() => run(source, globals)).toThrow(/test\.lua:5: unsupported construct \(several locals assigned from one call/);
    // One local per call, several values without a call, and `...` stay allowed.
    expect(toPlain(run('local c = UnitClassBase("player")\nlocal a, b = 1\nreturn { c, a, b }', globals).value)).toEqual({ 1: 'SHAMAN', 2: 1 });
    expect(toPlain(run('local a, b = ...\nreturn { a, b }', globals, ['x', 'y']).value)).toEqual({ 1: 'x', 2: 'y' });
  });

  it('fails closed on a call in a position where Lua expands every return value, and allows the rest', () => {
    // `{ UnitClassBase("player") }` and `f(1, UnitClassBase())` would receive classFile AND classId
    // in real Lua; the one-value host function would silently drop the second.
    const globals = new Map<string, LuaValue>([['UnitClassBase', hostFunction('UnitClassBase', () => 'SHAMAN')]]);
    const withL10n = new Map<string, LuaValue>([
      ...globals,
      ['l10n', hostFunction('l10n', ([text]) => text ?? null, { singleValued: true })],
      ['Pack', hostFunction('Pack', (args) => args.length)],
    ]);
    expect(() => run('return { UnitClassBase("player") }', globals)).toThrow(/UnitClassBase called where Lua expands every return value/);
    expect(() => run('return { 1, UnitClassBase"player", }', globals)).toThrow(/not declared single-valued/);
    expect(() => run('return Pack(1, UnitClassBase("player"))', withL10n)).toThrow(/UnitClassBase called where Lua expands/);
    // A keyed field, or a call that is not last, takes only the first value in Lua too; a declared
    // single-valued function is safe anywhere (upstream's l10n, as at classicQuestFixes.lua:1082).
    expect(toPlain(run('return { k = UnitClassBase("player"), UnitClassBase("player"), 2 }', globals).value)).toEqual({ k: 'SHAMAN', 1: 'SHAMAN', 2: 2 });
    expect(toPlain(run('return { 1, l10n("Fish"), }', withL10n).value)).toEqual({ 1: 1, 2: 'Fish' });
    expect(run('return Pack(1, l10n("x"))', withL10n).value).toBe(2);
  });

  it.each([
    ['an unknown global', 'return UnitRace("player")'],
    ['an unknown member', 'local t = { a = 1 } return t.b'],
    ['a global assignment', 'x = 1'],
    ['string arithmetic', 'return "1" + 1'],
    ['indexing a non-table', 'local n = 1 return n.x'],
    ['a nil table index', 'return { [nil] = 1 }'],
    ['calling a non-function', 'local t = {} return t:missing()'],
  ])('fails closed on %s at run time', (_label, source) => {
    expect(() => run(source)).toThrow(LuaEvalError);
  });

  it('wraps host function failures with the call site', () => {
    const globals = new Map<string, LuaValue>([['Boom', hostFunction('Boom', () => {
      throw new Error('outside a persona');
    })]]);
    expect(() => run('return Boom()', globals)).toThrow(/test\.lua:1: Boom: outside a persona/);
  });
});
