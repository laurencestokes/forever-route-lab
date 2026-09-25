import { describe, expect, it } from 'vitest';
import { applyOverlay, composeOverlay, isDeleteIdiom, loadCorrectionFiles, materialise, mergeInto, OVERLAY_NIL, type WriteLog } from './corrections';
import { applyRequiredRaces } from './derived';
import type { Rows } from './entities';
import { LuaTable, type LuaValue, toPlain } from './lua-value';
import type { ProviderStep } from './plan';
import { projectQuest, type QuestContext } from './project';
import type { EntityMeta } from './upstream-lua';

/** A quest-like schema: 1 name (string), 5 level (number), 13 preQuestSingle (table), 18 skill pair, 26 rewards. */
const META: EntityMeta = {
  entity: 'Quest',
  fieldCount: 36,
  keys: new Map(),
  types: new Map(Array.from({ length: 36 }, (_, i) => [i + 1, i + 1 === 1 ? 'string' : [2, 3, 8, 9, 10, 12, 13, 14, 15, 16, 18, 19, 20, 21, 26, 28, 29, 35].includes(i + 1) ? 'table' : 'number'] as const)),
  structures: new Map(),
  constantValues: new Map(),
  zeroPairIsNil: new Set([18, 19, 20]),
};

const OPTIONS = { noNewEntries: false, noOverwrites: false };
const row = (entries: readonly (readonly [number, LuaValue])[]): LuaTable => LuaTable.from(entries);
const corrections = (entries: readonly (readonly [number, LuaTable])[]): LuaTable => LuaTable.from(entries);

describe('MergeInto semantics (registry.lua)', () => {
  it('replaces whole fields instead of merging them, and logs the last writer', () => {
    const rows: Rows = new Map([[7, row([[1, 'Kobold Camp Cleanup'], [13, LuaTable.list([783, 5])]])]]);
    const log: WriteLog = new Map();
    const stats = mergeInto(rows, corrections([[7, row([[13, LuaTable.list([99])]])]]), OPTIONS, META, 'p1', log, new Set());
    expect(toPlain(rows.get(7)?.get(13) ?? null)).toEqual({ 1: 99 });
    expect(stats.applied).toBe(1);
    mergeInto(rows, corrections([[7, row([[13, LuaTable.list([100])]])]]), OPTIONS, META, 'p2', log, new Set());
    expect(log.get(7)?.get(13)).toBe('p2');
  });

  it('creates absent ids unless noNewEntries', () => {
    const rows: Rows = new Map();
    const created = new Set<number>();
    mergeInto(rows, corrections([[5, row([[1, 'New']])]]), OPTIONS, META, 'p', new Map(), created);
    expect(rows.has(5)).toBe(true);
    expect([...created]).toEqual([5]);
    const stats = mergeInto(rows, corrections([[6, row([[1, 'Not created']])]]), { noNewEntries: true, noOverwrites: false }, META, 'p', new Map(), created);
    expect(rows.has(6)).toBe(false);
    expect(stats.skippedAbsent).toBe(1);
  });

  it('stores {} (the delete idiom), which projection reads as absent', () => {
    const rows: Rows = new Map([[7, row([[1, 'Q'], [13, LuaTable.list([783])], [5, 2]])]]);
    mergeInto(rows, corrections([[7, row([[13, new LuaTable()], [5, new LuaTable()]])]]), OPTIONS, META, 'p', new Map(), new Set());
    const quest = rows.get(7) ?? new LuaTable();
    expect(isDeleteIdiom(quest.get(13))).toBe(true);
    const ctx: QuestContext = { hinted: () => false, xp: new Map(), dungeonAreas: new Set() };
    const projected = projectQuest(7, quest, ctx);
    expect(projected.prerequisites.preQuestSingle).toEqual([]);
    expect(projected.level).toBeNull();
  });

  it('noOverwrites writes only nil fields; an existing {} is not nil', () => {
    const rows: Rows = new Map([[1, row([[1, 'A'], [13, new LuaTable()]])]]);
    mergeInto(rows, corrections([[1, row([[1, 'B'], [13, LuaTable.list([1])], [5, 3]])]]), { noNewEntries: true, noOverwrites: true }, META, 'p', new Map(), new Set());
    expect(rows.get(1)?.get(1)).toBe('A');
    expect(isDeleteIdiom(rows.get(1)?.get(13) ?? null)).toBe(true);
    expect(rows.get(1)?.get(5)).toBe(3);
  });

  it('ignores non-numeric field keys, as MergeInto does, and fails closed on type mismatches', () => {
    const rows: Rows = new Map([[1, row([[1, 'A']])]]);
    const stats = mergeInto(rows, corrections([[1, LuaTable.from([['note', 'x']])]]), OPTIONS, META, 'p', new Map(), new Set());
    expect(stats.ignoredKeys).toEqual(['1.note']);
    expect(() => mergeInto(rows, corrections([[1, row([[5, 'not a number']])]]), OPTIONS, META, 'p', new Map(), new Set())).toThrow(/schema says number/);
    expect(() => mergeInto(rows, corrections([[1, row([[40, 1]])]]), OPTIONS, META, 'p', new Map(), new Set())).toThrow(/outside/);
  });
});

describe('provider materialisation (register.lua wrap)', () => {
  const step = (functionName: string): ProviderStep => ({
    file: 'fixes.lua',
    module: 'Fixes',
    datatype: 'Quest',
    functionName,
    dynamic: false,
    loadOrder: 11,
    sequence: 1,
    options: OPTIONS,
  });
  const source = `
    local Fixes = QuestieLoader:CreateModule("Fixes")
    local QuestieDB = QuestieLoader:ImportModule("QuestieDB")
    local QuestieCorrections = QuestieLoader:ImportModule("QuestieCorrections")
    local l10n = QuestieLoader:ImportModule("l10n")
    QuestieCorrections.itemObjectiveFirst[503] = true
    QuestieCorrections.itemObjectiveFirst[5088] = true
    function Fixes:Load()
      local questKeys = QuestieDB.questKeys
      QuestieDB.questData[9] = { [questKeys.name] = "direct", [questKeys.questLevel] = 1 }
      return {
        [9] = { [questKeys.questLevel] = 2 },
        [10] = { [questKeys.name] = l10n("Text") },
      }
    end
    function Fixes:LoadFactionFixes()
      local questKeys = QuestieDB.questKeys
      local playerClass = UnitClassBase("player")
      local horde = { [11] = { [questKeys.questLevel] = 60, [questKeys.nextQuestInChain] = ({ SHAMAN = 8380 })[playerClass] } }
      local alliance = { [11] = { [questKeys.questLevel] = 61 } }
      if UnitFactionGroup("Player") == "Horde" then return horde else return alliance end
    end
  `;
  const constants = (): LuaTable => {
    const keyTable = LuaTable.from([['name', 1], ['questLevel', 5], ['nextQuestInChain', 22]]);
    const scoped = LuaTable.from(['raceKeys', 'classKeys', 'npcFlags'].map((name) => [name, new LuaTable()] as const));
    return LuaTable.from([
      ...['questKeys', 'npcKeys', 'itemKeys', 'objectKeys'].map((name) => [name, keyTable] as const),
      ...['sortKeys', 'specialFlags', 'factionIDs', 'questFlags', 'itemClasses', 'waypointPresets', 'zoneIDs', 'professionKeys', 'specializationKeys', 'rankNames', 'phases', 'iconTypes'].map((name) => [name, new LuaTable()] as const),
      ['byExpansion', LuaTable.from([['Classic', scoped]])],
    ]);
  };
  const load = () => loadCorrectionFiles(() => Buffer.from(source, 'utf8'), ['fixes.lua'], constants(), 'Classic');

  it('collects *ObjectiveFirst hints at load and merges direct writes under returned values', () => {
    const loaded = load();
    expect(loaded.hints.get('itemObjectiveFirst')).toEqual([503, 5088]);
    const table = materialise(loaded, step('Load'), null);
    expect(toPlain(table)).toEqual({ 9: { 1: 'direct', 5: 2 }, 10: { 1: 'Text' } });
  });

  it('fails closed when a static provider asks for the persona', () => {
    expect(() => materialise(load(), step('LoadFactionFixes'), null)).toThrow(/UnitClassBase called outside/);
  });

  it('exposes the Questie icon constants only while a provider runs (compat.Invoke)', () => {
    const withIcons = constants();
    withIcons.set('iconTypes', LuaTable.from([['ICON_TYPE_SLAY', 1]]));
    const provider = `
      local Fixes = QuestieLoader:CreateModule("Fixes")
      function Fixes:Load()
        return { [9] = { [5] = Questie.ICON_TYPE_SLAY } }
      end
      function Fixes:LoadFactionFixes()
        local horde = UnitFactionGroup("Player") == "Horde"
        return {}
      end
    `;
    const loaded = loadCorrectionFiles(() => Buffer.from(provider, 'utf8'), ['fixes.lua'], withIcons, 'Classic');
    expect(loaded.env.globals.has('Questie')).toBe(false);
    expect(toPlain(materialise(loaded, step('Load'), null))).toEqual({ 9: { 5: 1 } });
    expect(loaded.env.globals.has('Questie')).toBe(false);
    // Removed again when the provider fails.
    expect(() => materialise(loaded, step('LoadFactionFixes'), null)).toThrow(/UnitFactionGroup called outside/);
    expect(loaded.env.globals.has('Questie')).toBe(false);
    // A correction file that reads it while loading fails closed.
    expect(() => loadCorrectionFiles(() => Buffer.from('local slay = Questie.ICON_TYPE_SLAY', 'utf8'), ['top.lua'], withIcons, 'Classic')).toThrow(/top\.lua:1: unknown global Questie/);
  });

  it('evaluates dynamic providers per persona; an absent class key leaves the field unset', () => {
    const loaded = load();
    const dynamic = { ...step('LoadFactionFixes'), dynamic: true };
    expect(toPlain(materialise(loaded, dynamic, { faction: 'Horde', classFile: 'SHAMAN' }))).toEqual({ 11: { 5: 60, 22: 8380 } });
    expect(toPlain(materialise(loaded, dynamic, { faction: 'Horde', classFile: 'WARRIOR' }))).toEqual({ 11: { 5: 60 } });
    expect(toPlain(materialise(loaded, dynamic, { faction: 'Alliance', classFile: 'SHAMAN' }))).toEqual({ 11: { 5: 61 } });
  });
});

describe('dynamic overlays (registry.lua recompose)', () => {
  const stepOf = (n: number): ProviderStep => ({ file: `p${String(n)}.lua`, module: 'M', datatype: 'Quest', functionName: 'LoadFactionFixes', dynamic: true, loadOrder: n, sequence: n, options: OPTIONS });

  it('lets later providers win per field, turns {} and {0,0} pairs into nil, and drops constant fields', () => {
    const meta: EntityMeta = { ...META, constantValues: new Map([[2, 0]]) };
    const overlay = composeOverlay(
      [
        { step: stepOf(1), corrections: corrections([[7, row([[5, 10], [13, LuaTable.list([1])]])]]) },
        { step: stepOf(2), corrections: corrections([[7, row([[5, 11], [13, new LuaTable()], [18, LuaTable.list([0, 0])], [2, LuaTable.list([1])]])]]) },
      ],
      meta,
      meta.zeroPairIsNil,
    );
    const fields = overlay.get(7);
    expect(fields?.get(5)).toBe(11);
    expect(fields?.get(13)).toBe(OVERLAY_NIL);
    expect(fields?.get(18)).toBe(OVERLAY_NIL);
    expect(fields?.has(2)).toBe(false);
    const patched = applyOverlay(row([[1, 'Q'], [5, 1], [13, LuaTable.list([9])]]), fields ?? new Map());
    expect(toPlain(patched)).toEqual({ 1: 'Q', 5: 11 });
  });

  it('fails closed on a non-empty table written into a scalar field', () => {
    expect(() => composeOverlay([{ step: stepOf(1), corrections: corrections([[7, row([[5, LuaTable.list([1])]])]]) }], META, META.zeroPairIsNil)).toThrow(/schema says number/);
  });
});

describe('requiredRaces:questieCompatibility', () => {
  const npcs: Rows = new Map([
    [1, row([[13, 'A']])],
    [2, row([[13, 'H']])],
    [3, row([[13, 'AH']])],
  ]);
  const quest = (races: LuaValue, starters: LuaValue): LuaTable => row([[6, races], [2, starters]]);

  it('infers the faction mask from creature starters when requiredRaces is nil or 0', () => {
    const quests: Rows = new Map([
      [10, quest(null, LuaTable.list([LuaTable.list([1])]))],
      [11, quest(0, LuaTable.list([LuaTable.list([2, 404])]))],
      [12, quest(null, LuaTable.list([LuaTable.list([1, 2])]))],
      [13, quest(null, LuaTable.list([LuaTable.list([3])]))],
      [14, quest(new LuaTable(), LuaTable.list([LuaTable.list([1])]))],
      [15, quest(4, LuaTable.list([LuaTable.list([1])]))],
      [16, quest(null, LuaTable.list([null, LuaTable.list([55])]))],
    ]);
    const changed = applyRequiredRaces(quests, npcs, { allAlliance: 77, allHorde: 178 });
    expect(changed).toEqual([10, 11]);
    expect(quests.get(10)?.get(6)).toBe(77);
    expect(quests.get(11)?.get(6)).toBe(178);
    // Both factions, "AH", the delete idiom (truthy in Lua), an explicit mask, object starters: unchanged.
    expect(quests.get(12)?.get(6)).toBeNull();
    expect(quests.get(13)?.get(6)).toBeNull();
    expect(isDeleteIdiom(quests.get(14)?.get(6) ?? null)).toBe(true);
    expect(quests.get(15)?.get(6)).toBe(4);
    expect(quests.get(16)?.get(6)).toBeNull();
  });
});
