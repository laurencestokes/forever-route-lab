import type { Chunk } from 'luaparse';
import { Evaluator, hostFunction, type Lint } from './evaluator';
import { bytesToLuaText, parseLua, type ParseOptions } from './lua-source';
import { type LuaFunction, LuaTable, type LuaValue, ShapeError } from './lua-value';
import type { Transcription } from './semantics';

/**
 * The environments QuestieDB files run in, reproduced for the whitelisted evaluator:
 *
 * - the **support** environment of `src/support/data.lua` (`support.Install`): `QuestieLoader`
 *   hands out `{ private = {} }` module tables, and `Expansions` is seeded with the flavour's
 *   expansion order (Forever: rules "Classic", so `Expansions.Current = 1`);
 * - the **correction** environment of `src/corrections/compat.lua`: module stand-ins built from the
 *   enum constants for one expansion, the five `*ObjectiveFirst` hint sets, identity `l10n`, and
 *   the `Questie` icon constants, which exist as a global only while a provider runs
 *   (`compat.Invoke`).
 *
 * Persona calls (`UnitFactionGroup`, `UnitClassBase`) read a mutable persona; outside a dynamic
 * provider the persona is unset and such a call fails closed.
 */

/** Upstream behaviour transcribed here, with the blob it was written against (lib/semantics.ts). */
export const TRANSCRIBES: readonly Transcription[] = [
  { path: 'src/support/data.lua', sha256: '70e4dba6d3eea140b47acf0a67d2a9bbcbc4bda0b251596eb584fdcc8d7e91d4', what: 'support.Install (module shim, seeded Expansions)' },
  {
    path: 'src/corrections/compat.lua',
    sha256: 'a08c1f79033a6fe0696ee068580fb0f84521c68fe88c48b6789eb9052b122539',
    what: 'compat.Install module stand-ins, pick, the objectiveFirst hint sets, l10n, compat.Invoke (the Questie global)',
  },
];

export interface Persona {
  faction: 'Alliance' | 'Horde' | null;
  classFile: string | null;
}

export const EXPANSION_ORDER: Readonly<Record<string, number>> = { Classic: 1, TBC: 2, Wotlk: 3, Cata: 4, MoP: 5 };

function personaFunctions(persona: Persona): { readonly faction: LuaFunction; readonly classBase: LuaFunction } {
  return {
    faction: hostFunction('UnitFactionGroup', () => {
      if (persona.faction === null) throw new Error('UnitFactionGroup called outside a faction-dependent evaluation');
      return persona.faction;
    }),
    classBase: hostFunction('UnitClassBase', () => {
      if (persona.classFile === null) throw new Error('UnitClassBase called outside a class-dependent evaluation');
      return persona.classFile;
    }),
  };
}

function loader(modules: Map<string, LuaValue>, create: (name: string) => LuaValue): LuaTable {
  const get = (args: readonly LuaValue[]): LuaValue => {
    const name = args[1];
    if (typeof name !== 'string') throw new Error('QuestieLoader: module name must be a string');
    const existing = modules.get(name);
    if (existing !== undefined) return existing;
    const created = create(name);
    modules.set(name, created);
    return created;
  };
  return LuaTable.from([
    // Upstream's loaders return one module table each (compat.lua:199-206 at the pin): single-valued.
    ['ImportModule', hostFunction('QuestieLoader:ImportModule', get, { singleValued: true })],
    ['CreateModule', hostFunction('QuestieLoader:CreateModule', get, { singleValued: true })],
  ]);
}

export interface RunResult {
  readonly value: LuaValue;
  readonly lints: readonly Lint[];
}

/** Parses bytes and runs them as one chunk in `globals`, with `varargs` as `...`. */
export function runFile(
  file: string,
  bytes: Uint8Array | string,
  globals: ReadonlyMap<string, LuaValue>,
  options: ParseOptions & { readonly varargs?: readonly LuaValue[] } = {},
): RunResult {
  const text = typeof bytes === 'string' ? bytes : bytesToLuaText(bytes, file);
  const chunk: Chunk = parseLua(text, file, options);
  const lints: Lint[] = [];
  const value = new Evaluator({ file, globals, varargs: options.varargs ?? [], lints }).runChunk(chunk);
  return { value, lints };
}

// ---------------------------------------------------------------------------------------------
// Support environment

export interface SupportEnvironment {
  readonly globals: ReadonlyMap<string, LuaValue>;
  readonly modules: ReadonlyMap<string, LuaValue>;
  readonly persona: Persona;
  module(name: string): LuaTable;
}

export function supportEnvironment(rules: string): SupportEnvironment {
  const current = EXPANSION_ORDER[rules];
  if (current === undefined) throw new Error(`support environment: unknown rules ${rules}`);
  const modules = new Map<string, LuaValue>();
  const create = (): LuaValue => LuaTable.from([['private', new LuaTable()]]);
  const expansions = create() as LuaTable;
  for (const [name, order] of [['Era', 1], ['Classic', 1], ['Tbc', 2], ['Wotlk', 3], ['Cata', 4], ['MoP', 5], ['Current', current]] as const) {
    expansions.set(name, order);
  }
  modules.set('Expansions', expansions);
  const persona: Persona = { faction: null, classFile: null };
  const { faction } = personaFunctions(persona);
  const globals = new Map<string, LuaValue>([
    ['QuestieLoader', loader(modules, create)],
    ['UnitFactionGroup', faction],
  ]);
  return {
    globals,
    modules,
    persona,
    module(name) {
      const value = modules.get(name);
      if (!(value instanceof LuaTable)) throw new ShapeError('support environment', `module ${name} was not created`);
      return value;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Correction environment (src/corrections/compat.lua)

export const HINT_SETS = [
  'killCreditObjectiveFirst',
  'objectObjectiveFirst',
  'itemObjectiveFirst',
  'eventObjectiveFirst',
  'spellObjectiveFirst',
] as const;
export type HintSet = (typeof HINT_SETS)[number];

export const DATA_FIELDS = { questData: 'Quest', npcData: 'Npc', itemData: 'Item', objectData: 'Object' } as const;
export type Datatype = 'Quest' | 'Npc' | 'Object' | 'Item';

export interface CorrectionEnvironment {
  readonly globals: ReadonlyMap<string, LuaValue>;
  readonly modules: Map<string, LuaValue>;
  readonly persona: Persona;
  /** compat.objectiveFirst: the hint tables correction files write into at load. */
  readonly hints: ReadonlyMap<HintSet, LuaTable>;
  /** compat.captured: direct writes such as `QuestieDB.questData[id] = {...}`. */
  readonly captured: ReadonlyMap<Datatype, LuaTable>;
  /**
   * compat.Invoke: calls a provider with the private `Questie` icon constants installed as a
   * global, and removes them again afterwards, also when the provider fails. Outside a provider
   * call (while the correction files load, for example) `Questie` is an unknown global.
   */
  invoke(fn: LuaFunction, args: readonly LuaValue[]): LuaValue;
}

/** compat.lua `pick`: a shared constant table, else the expansion's own; missing is an error. */
function pick(constants: LuaTable, name: string, expansion: string): LuaTable {
  const shared = constants.get(name);
  if (shared instanceof LuaTable) return shared;
  const byExpansion = constants.get('byExpansion');
  const scoped = byExpansion instanceof LuaTable ? byExpansion.get(expansion) : null;
  if (!(scoped instanceof LuaTable)) throw new ShapeError('correction compat', `constants are missing expansion data for ${expansion}`);
  const value = scoped.get(name);
  if (!(value instanceof LuaTable)) throw new ShapeError('correction compat', `unknown constant ${name} for expansion ${expansion}`);
  return value;
}

function reversed(keys: LuaTable): LuaTable {
  const out = new LuaTable();
  for (const [key, index] of keys.entries()) {
    if (typeof index === 'number') out.set(index, key);
  }
  return out;
}

export function correctionEnvironment(constants: LuaTable, rules: string): CorrectionEnvironment {
  const current = EXPANSION_ORDER[rules];
  if (current === undefined) throw new Error(`correction environment: unknown rules ${rules}`);
  const captured = new Map<Datatype, LuaTable>([
    ['Quest', new LuaTable()],
    ['Npc', new LuaTable()],
    ['Item', new LuaTable()],
    ['Object', new LuaTable()],
  ]);
  const questieDB = new LuaTable();
  for (const name of ['questKeys', 'npcKeys', 'itemKeys', 'objectKeys', 'raceKeys', 'classKeys', 'sortKeys', 'specialFlags', 'factionIDs', 'questFlags', 'npcFlags', 'itemClasses', 'waypointPresets']) {
    questieDB.set(name, pick(constants, name, rules));
  }
  for (const [field, datatype] of Object.entries(DATA_FIELDS)) questieDB.set(field, captured.get(datatype) ?? null);
  for (const type of ['quest', 'npc', 'item', 'object']) {
    questieDB.set(`${type}KeysReversed`, reversed(questieDB.get(`${type}Keys`) as LuaTable));
  }
  const hints = new Map<HintSet, LuaTable>(HINT_SETS.map((name) => [name, new LuaTable()]));
  const modules = new Map<string, LuaValue>([
    ['QuestieDB', questieDB],
    ['ZoneDB', LuaTable.from([['zoneIDs', pick(constants, 'zoneIDs', rules)]])],
    [
      'QuestieProfessions',
      LuaTable.from([
        ['professionKeys', pick(constants, 'professionKeys', rules)],
        ['specializationKeys', pick(constants, 'specializationKeys', rules)],
        ['rankNames', pick(constants, 'rankNames', rules)],
      ]),
    ],
    ['QuestieCorrections', LuaTable.from(HINT_SETS.map((name) => [name, hints.get(name) ?? null] as const))],
    ['Phasing', LuaTable.from([['phases', pick(constants, 'phases', rules)]])],
    // `l10n(text)` stores the enUS string: upstream defines it as `function(_, text) return text end`
    // (compat.lua:145 at the pin), exactly one value, so it is safe where Lua expands return values
    // (for example the last field of an extraObjectives entry, classicQuestFixes.lua:1082).
    [
      'l10n',
      hostFunction(
        'l10n',
        (args) => {
          const text = args[0] ?? null;
          if (typeof text !== 'string') throw new Error('l10n expects a string');
          return text;
        },
        { singleValued: true },
      ),
    ],
    [
      'Expansions',
      LuaTable.from([
        ['Era', 1],
        ['Classic', 1],
        ['Tbc', 2],
        ['Wotlk', 3],
        ['Cata', 4],
        ['MoP', 5],
        ['Current', current],
      ]),
    ],
  ]);
  const persona: Persona = { faction: null, classFile: null };
  const { faction, classBase } = personaFunctions(persona);
  const iconTypes = constants.get('iconTypes');
  if (!(iconTypes instanceof LuaTable)) throw new ShapeError('correction compat', 'constants.iconTypes is missing');
  const globals = new Map<string, LuaValue>([
    ['QuestieLoader', loader(modules, () => new LuaTable())],
    ['UnitFactionGroup', faction],
    ['UnitClassBase', classBase],
  ]);
  // compat.lua `correctionQuestie`: one private table, visible only while a provider runs.
  const questie = iconTypes.clone();
  const invoke = (fn: LuaFunction, args: readonly LuaValue[]): LuaValue => {
    globals.set('Questie', questie);
    try {
      return fn.invoke(args);
    } finally {
      globals.delete('Questie');
    }
  };
  return { globals, modules, persona, hints, captured, invoke };
}
