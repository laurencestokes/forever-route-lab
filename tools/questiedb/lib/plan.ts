import { LuaTable, type LuaValue, sequence, ShapeError } from './lua-value';
import type { Datatype } from './sandbox';
import type { Transcription } from './semantics';
import { literalAssignment, type ReadInput } from './upstream-lua';

/**
 * The correction plan: which provider functions apply to a flavour, in which order, with which
 * merge options. It is derived from upstream's own tables (config.lua `ownedCorrections` and
 * `flavors`, manifest.lua, registry.lua `loadOrder`) with a TypeScript transcription of
 * `config.correctionApplies`, `register.FromManifest` and `registry.Select` ordering, and then
 * compared with the plan this tool was written for, so an upstream change to providers, order or
 * options fails closed (DATA_PROVENANCE §4.1, §5).
 */

/** Upstream behaviour transcribed here, with the blob it was written against (lib/semantics.ts). */
export const TRANSCRIBES: readonly Transcription[] = [
  { path: 'src/config.lua', sha256: 'ec03223d44cf67553f785a608c040cd639c1acfd4668223d9aeaa29a0f864808', what: 'config.correctionApplies' },
  {
    path: 'src/corrections/register.lua',
    sha256: '1abd208277be869221b08fd623cc78e1cef6fd1a80a8fca7e99a507a4a4bf7c0',
    what: 'register.FromManifest load orders, register.WindowFor, IsSodActive / IsTitanReforgedActive',
  },
  { path: 'src/corrections/registry.lua', sha256: 'f8ad7dd54e6baad137ed217dc26f2802e721b7e3eea5d9da2c5522806bdcef67', what: 'registry.Select ordering' },
];

export interface MergeOptions {
  readonly noNewEntries: boolean;
  readonly noOverwrites: boolean;
}

export interface ProviderStep {
  /** Repository path of the correction file, e.g. src/corrections/Forever/legacy/classicQuestFixes.lua */
  readonly file: string;
  readonly module: string;
  readonly datatype: Datatype;
  readonly functionName: string;
  readonly dynamic: boolean;
  readonly loadOrder: number;
  readonly sequence: number;
  readonly options: MergeOptions;
}

export interface Flavour {
  readonly name: string;
  readonly expansion: string;
  readonly dataPrefix: string;
  readonly rules: string;
  readonly interface: string;
}

export interface CorrectionPlan {
  readonly flavour: Flavour;
  readonly enumFiles: readonly string[];
  /** Static steps per datatype, in apply order. */
  readonly staticSteps: ReadonlyMap<Datatype, readonly ProviderStep[]>;
  readonly dynamicSteps: ReadonlyMap<Datatype, readonly ProviderStep[]>;
  /** Files whose top level must be run (so their modules and hint writes exist). */
  readonly files: readonly string[];
}

const DATATYPES: readonly Datatype[] = ['Quest', 'Npc', 'Object', 'Item'];
const EXPANSION_ORDER: Readonly<Record<string, number>> = { Classic: 1, TBC: 2, Wotlk: 3, Cata: 4, MoP: 5 };

const field = (table: LuaTable, key: string): LuaValue => table.get(key);
const optString = (table: LuaTable, key: string, where: string): string | null => {
  const value = field(table, key);
  if (value === null) return null;
  if (typeof value !== 'string') throw new ShapeError(where, `${key} must be a string`);
  return value;
};
const strings = (value: LuaValue, where: string): readonly string[] => {
  if (value === null) return [];
  if (!(value instanceof LuaTable)) throw new ShapeError(where, 'expected a list of names');
  return sequence(value, where).map((item) => {
    if (typeof item !== 'string') throw new ShapeError(where, 'expected a list of names');
    return item;
  });
};

function readFlavours(read: ReadInput): readonly Flavour[] {
  const value = literalAssignment(read, 'src/config.lua', 'config.flavors');
  if (!(value instanceof LuaTable)) throw new ShapeError('src/config.lua', 'config.flavors is not a table');
  return sequence(value, 'config.flavors').map((entry, index) => {
    const where = `config.flavors[${String(index + 1)}]`;
    if (!(entry instanceof LuaTable)) throw new ShapeError(where, 'not a table');
    const get = (key: string): string => {
      const v = optString(entry, key, where);
      if (v === null) throw new ShapeError(where, `${key} missing`);
      return v;
    };
    return { name: get('name'), expansion: get('expansion'), dataPrefix: get('dataPrefix'), rules: get('rules'), interface: get('interface') };
  });
}

interface Spec {
  readonly file: string;
  readonly module: string;
  readonly datatype: Datatype;
  readonly static: readonly string[];
  readonly dynamic: readonly string[];
  readonly generated: boolean;
  readonly owned: string | null;
  readonly window: string | null;
  readonly expansions: ReadonlySet<string> | null;
  readonly minExpansionOrder: number | null;
  readonly options: MergeOptions;
}

function readSpecs(value: LuaValue, where: string): readonly Spec[] {
  if (!(value instanceof LuaTable)) throw new ShapeError(where, 'not a table');
  return sequence(value, where).map((entry, index): Spec => {
    const at = `${where}[${String(index + 1)}]`;
    if (!(entry instanceof LuaTable)) throw new ShapeError(at, 'not a table');
    const file = optString(entry, 'file', at);
    const module = optString(entry, 'module', at);
    const datatype = optString(entry, 'datatype', at);
    if (file === null || module === null || datatype === null || !DATATYPES.includes(datatype as Datatype)) throw new ShapeError(at, 'file/module/datatype missing');
    const expansionsValue = field(entry, 'expansions');
    let expansions: Set<string> | null = null;
    if (expansionsValue instanceof LuaTable) {
      expansions = new Set();
      for (const [key, flag] of expansionsValue.entries()) if (flag === true && typeof key === 'string') expansions.add(key);
    }
    const min = field(entry, 'minExpansionOrder');
    const options = field(entry, 'options');
    const flag = (name: string): boolean => options instanceof LuaTable && options.get(name) === true;
    if (options instanceof LuaTable) {
      for (const key of options.keys()) if (key !== 'noNewEntries' && key !== 'noOverwrites') throw new ShapeError(at, `unknown merge option ${String(key)}`);
    }
    return {
      file: `src/corrections/${file}`,
      module,
      datatype: datatype as Datatype,
      static: strings(field(entry, 'static'), `${at}.static`),
      dynamic: strings(field(entry, 'dynamic'), `${at}.dynamic`),
      generated: field(entry, 'generated') === true,
      owned: optString(entry, 'owned', at),
      window: optString(entry, 'window', at),
      expansions,
      minExpansionOrder: typeof min === 'number' ? min : null,
      options: { noNewEntries: flag('noNewEntries'), noOverwrites: flag('noOverwrites') },
    };
  });
}

/** config.correctionApplies */
function applies(spec: Spec, flavour: Flavour): boolean {
  if (spec.owned !== null) return spec.owned === flavour.name;
  if (flavour.name === 'Forever') return false;
  const order = EXPANSION_ORDER[flavour.expansion] ?? 0;
  return (spec.expansions === null || spec.expansions.has(flavour.expansion)) && (spec.minExpansionOrder === null || order >= spec.minExpansionOrder);
}

/** register.WindowFor */
function windowFor(spec: Spec): string {
  const file = spec.file.slice('src/corrections/'.length);
  for (const [prefix, window] of [['Sod/', 'SoD'], ['Era/', 'Era'], ['Tbc/', 'Tbc'], ['Wotlk/', 'Wotlk'], ['Titan/', 'Titan'], ['Cata/', 'Cata'], ['MoP/', 'MoP']] as const) {
    if (file.startsWith(prefix)) return window;
  }
  return 'Era';
}

export function derivePlan(read: ReadInput, flavourName: string): CorrectionPlan {
  const flavour = readFlavours(read).find((entry) => entry.name === flavourName);
  if (flavour === undefined) throw new ShapeError('src/config.lua', `no flavour ${flavourName}`);
  const loadOrderTable = literalAssignment(read, 'src/corrections/registry.lua', 'registry.loadOrder');
  if (!(loadOrderTable instanceof LuaTable)) throw new ShapeError('registry.lua', 'registry.loadOrder is not a table');
  const loadOrder = (name: string): number => {
    const value = loadOrderTable.get(name);
    if (typeof value !== 'number') throw new ShapeError('registry.lua', `no load order window ${name}`);
    return value;
  };
  const enumFiles = strings(literalAssignment(read, 'src/config.lua', 'config.enumFiles'), 'config.enumFiles');
  // manifest.lua: its own entries, then config.ownedCorrections appended (manifest.lua:44-45).
  const specs = [
    ...readSpecs(literalAssignment(read, 'src/corrections/manifest.lua', 'manifest'), 'manifest.lua manifest'),
    ...readSpecs(literalAssignment(read, 'src/config.lua', 'config.ownedCorrections'), 'config.ownedCorrections'),
  ];
  const steps: ProviderStep[] = [];
  let sequenceNo = 0;
  const files: string[] = [];
  for (const spec of specs) {
    if (!applies(spec, flavour)) continue;
    const relative = spec.file.slice('src/corrections/'.length);
    // Seasonal variants are never active offline (register.IsSodActive / IsTitanReforgedActive).
    if (relative.startsWith('Sod/') || relative.startsWith('Titan/')) continue;
    files.push(spec.file);
    const window = spec.window ?? windowFor(spec);
    spec.static.forEach((functionName, index) => {
      sequenceNo += 1;
      steps.push({
        file: spec.file,
        module: spec.module,
        datatype: spec.datatype,
        functionName,
        dynamic: false,
        loadOrder: loadOrder(`${window}Static`) + (spec.generated ? 1 : 10) + index + 1,
        sequence: sequenceNo,
        options: spec.options,
      });
    });
    spec.dynamic.forEach((functionName, index) => {
      sequenceNo += 1;
      steps.push({
        file: spec.file,
        module: spec.module,
        datatype: spec.datatype,
        functionName,
        dynamic: true,
        loadOrder: loadOrder(`${window}Dynamic`) + (spec.generated ? 1 : 10) + index + 1,
        sequence: sequenceNo,
        options: spec.options,
      });
    });
  }
  const order = (a: ProviderStep, b: ProviderStep): number => (a.loadOrder !== b.loadOrder ? a.loadOrder - b.loadOrder : a.sequence - b.sequence);
  const group = (dynamic: boolean): Map<Datatype, readonly ProviderStep[]> =>
    new Map(DATATYPES.map((datatype) => [datatype, steps.filter((step) => step.dynamic === dynamic && step.datatype === datatype).sort(order)]));
  return { flavour, enumFiles, staticSteps: group(false), dynamicSteps: group(true), files };
}

/** One step as `file:function(options)`, the manifest `layers` spelling. */
export function describeStep(step: ProviderStep): string {
  const flags = [step.options.noNewEntries ? 'noNewEntries' : null, step.options.noOverwrites ? 'noOverwrites' : null].filter((f) => f !== null);
  const file = step.file.replace(/^src\/corrections\/(Forever\/)?/, '');
  return `${file}:${step.functionName}${flags.length > 0 ? `(${flags.join(',')})` : ''}`;
}

/**
 * The plans this tool was written and reviewed for, as `datatype: [layer, ...]`. A derived plan
 * that differs fails the extraction until the tool is updated deliberately.
 */
export const EXPECTED_PLANS: Readonly<Record<string, { readonly static: Readonly<Record<Datatype, readonly string[]>>; readonly dynamic: Readonly<Record<Datatype, readonly string[]>> }>> = {
  Forever: {
    static: {
      Quest: ['legacy/classicQuestReputationFixes.lua:Load', 'legacy/classicQuestFixes.lua:Load', 'foreverQuestFixes.lua:Load'],
      Npc: ['legacy/classicNPCFixes.lua:Load', 'foreverNPCFixes.lua:Load'],
      Object: ['legacy/classicObjectFixes.lua:Load', 'foreverObjectFixes.lua:Load'],
      Item: ['legacy/itemStartFixes.lua:LoadAutomaticQuestStarts(noNewEntries,noOverwrites)', 'legacy/classicItemFixes.lua:Load', 'foreverItemFixes.lua:Load'],
    },
    dynamic: {
      Quest: ['legacy/classicQuestFixes.lua:LoadFactionFixes', 'foreverQuestFixes.lua:LoadDynamic'],
      Npc: ['legacy/classicNPCFixes.lua:LoadFactionFixes', 'foreverNPCFixes.lua:LoadDynamic'],
      Object: ['legacy/classicObjectFixes.lua:LoadFactionFixes', 'foreverObjectFixes.lua:LoadDynamic'],
      Item: ['legacy/classicItemFixes.lua:LoadFactionFixes', 'foreverItemFixes.lua:LoadDynamic'],
    },
  },
  // The fork base (DATA_PROVENANCE §4.1.1): Era's own static providers, read only for upstreamDiff.
  Vanilla: {
    static: {
      Quest: ['Era/classicQuestReputationFixes.lua:Load', 'Era/classicQuestFixes.lua:Load'],
      Npc: ['Era/classicNPCFixes.lua:Load'],
      Object: ['Era/classicObjectFixes.lua:Load'],
      Item: ['Shared/itemStartFixes.lua:LoadAutomaticQuestStarts(noNewEntries,noOverwrites)', 'Era/classicItemFixes.lua:Load'],
    },
    dynamic: {
      Quest: ['Era/classicQuestFixes.lua:LoadFactionFixes'],
      Npc: ['Era/classicNPCFixes.lua:LoadFactionFixes'],
      Object: ['Era/classicObjectFixes.lua:LoadFactionFixes'],
      Item: ['Era/classicItemFixes.lua:LoadFactionFixes'],
    },
  },
};

export function assertExpectedPlan(plan: CorrectionPlan): void {
  const expected = EXPECTED_PLANS[plan.flavour.name];
  if (expected === undefined) throw new ShapeError('plan', `no reviewed plan for flavour ${plan.flavour.name}`);
  for (const datatype of DATATYPES) {
    for (const kind of ['static', 'dynamic'] as const) {
      const actual = ((kind === 'static' ? plan.staticSteps : plan.dynamicSteps).get(datatype) ?? []).map(describeStep);
      const want = expected[kind][datatype];
      if (JSON.stringify(actual) !== JSON.stringify(want)) {
        throw new ShapeError('correction plan', `${plan.flavour.name} ${kind} ${datatype} is ${JSON.stringify(actual)}, the tool was reviewed for ${JSON.stringify(want)}`);
      }
    }
  }
}
