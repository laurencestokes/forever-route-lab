import { performance } from 'node:perf_hooks';
import { loadCorrectionFiles, type LoadedCorrections, materialise, mergeInto, type MergeStats, type WriteLog } from './corrections';
import { applyRequiredRaces, QUEST_REQUIRED_RACES } from './derived';
import { dataFilePath, ENTITY_KINDS, ENTITY_TYPES, type EntityKind, readEntityFile, type Rows } from './entities';
import type { Lint } from './evaluator';
import { LuaTable, type LuaValue, ShapeError } from './lua-value';
import { assertExpectedPlan, type CorrectionPlan, derivePlan, describeStep, type Flavour } from './plan';
import type { Datatype } from './sandbox';
import { assertKeysMatch, type EntityMeta, evaluateEnums, evaluateMeta, type ReadInput } from './upstream-lua';

/**
 * Composition of one flavour's static layer (DATA_PROVENANCE §5 layers 1-3): raw rows, static
 * corrections in upstream order with upstream merge semantics, then the requiredRaces pass.
 * Forever is the shipped flavour; Vanilla (Era) is composed the same way as the fork base for
 * `upstreamDiff` only.
 */

export const KIND_OF: Readonly<Record<Datatype, EntityKind>> = { Quest: 'quest', Npc: 'npc', Object: 'object', Item: 'item' };
export const META_FILES: Readonly<Record<EntityKind, string>> = {
  quest: 'src/meta/questMeta.lua',
  npc: 'src/meta/npcMeta.lua',
  object: 'src/meta/objectMeta.lua',
  item: 'src/meta/itemMeta.lua',
};

export type PerKind<T> = { readonly [K in EntityKind]: T };

export interface Composition {
  readonly flavour: Flavour;
  readonly plan: CorrectionPlan;
  readonly constants: LuaTable;
  readonly metas: PerKind<EntityMeta>;
  /** Raw rows as parsed (never mutated). */
  readonly raw: PerKind<ReadonlyMap<number, LuaTable>>;
  /** Rows after static corrections and the derived pass. */
  readonly composed: PerKind<Rows>;
  /** Last static writer of every corrected field. */
  readonly writes: PerKind<WriteLog>;
  readonly created: PerKind<ReadonlySet<number>>;
  readonly mergeStats: readonly (MergeStats & { readonly kind: EntityKind })[];
  /** Quests the requiredRaces pass changed, with the value it replaced. */
  readonly derivedRaces: ReadonlyMap<number, LuaValue>;
  readonly corrections: LoadedCorrections;
  readonly lints: readonly Lint[];
  readonly timingsMs: Readonly<Record<string, number>>;
}

export function loadMetas(read: ReadInput): PerKind<EntityMeta> {
  return {
    quest: evaluateMeta(read, META_FILES.quest),
    npc: evaluateMeta(read, META_FILES.npc),
    object: evaluateMeta(read, META_FILES.object),
    item: evaluateMeta(read, META_FILES.item),
  };
}

function raceMask(constants: LuaTable, rules: string, name: string): number {
  const byExpansion = constants.get('byExpansion');
  const scoped = byExpansion instanceof LuaTable ? byExpansion.get(rules) : null;
  const races = scoped instanceof LuaTable ? scoped.get('raceKeys') : null;
  const value = races instanceof LuaTable ? races.get(name) : null;
  if (typeof value !== 'number') throw new ShapeError('enum/expansions.lua', `byExpansion.${rules}.raceKeys.${name} is missing`);
  return value;
}

export function compose(read: ReadInput, flavourName: string, metas: PerKind<EntityMeta>): Composition {
  const timings: Record<string, number> = {};
  const time = <T>(label: string, fn: () => T): T => {
    const start = performance.now();
    try {
      return fn();
    } finally {
      timings[label] = Math.round((performance.now() - start) * 10) / 10;
    }
  };
  const plan = time('plan', () => derivePlan(read, flavourName));
  assertExpectedPlan(plan);
  const rules = plan.flavour.rules;
  const lints: Lint[] = [];
  const constants = time('enums', () => evaluateEnums(read, plan.enumFiles, lints));
  for (const kind of ENTITY_KINDS) {
    const keys = constants.get(ENTITY_TYPES[kind].keysField);
    if (!(keys instanceof LuaTable)) throw new ShapeError('enum/fieldKeys.lua', `constants.${ENTITY_TYPES[kind].keysField} missing`);
    // The item schema has teachesSpell (16), which the enum constants also list.
    assertKeysMatch(metas[kind], keys, `enum ${ENTITY_TYPES[kind].keysField}`, false);
  }
  const raw = {} as Record<EntityKind, ReadonlyMap<number, LuaTable>>;
  const composed = {} as Record<EntityKind, Rows>;
  for (const kind of ENTITY_KINDS) {
    const file = dataFilePath(plan.flavour.expansion, plan.flavour.dataPrefix, kind);
    const rows = time(`parse:${kind}`, () => readEntityFile(file, read(file), kind, metas[kind], rules));
    raw[kind] = rows;
    composed[kind] = new Map([...rows].map(([id, row]) => [id, row.clone()]));
  }
  const corrections = time('load corrections', () => loadCorrectionFiles(read, plan.files, constants, rules));
  lints.push(...corrections.lints);
  const writes = { quest: new Map(), npc: new Map(), object: new Map(), item: new Map() } as Record<EntityKind, WriteLog>;
  const created = { quest: new Set(), npc: new Set(), object: new Set(), item: new Set() } as Record<EntityKind, Set<number>>;
  const mergeStats: (MergeStats & { readonly kind: EntityKind })[] = [];
  time('static corrections', () => {
    for (const [datatype, steps] of plan.staticSteps) {
      const kind = KIND_OF[datatype];
      for (const step of steps) {
        const table = materialise(corrections, step, null);
        const stats = mergeInto(composed[kind], table, step.options, metas[kind], describeStep(step), writes[kind], created[kind]);
        mergeStats.push({ ...stats, kind });
      }
    }
  });
  const derivedRaces = new Map<number, LuaValue>();
  time('derived requiredRaces', () => {
    const before = new Map([...composed.quest].map(([id, row]) => [id, row.get(QUEST_REQUIRED_RACES)]));
    const changed = applyRequiredRaces(composed.quest, composed.npc, {
      allAlliance: raceMask(constants, rules, 'ALL_ALLIANCE'),
      allHorde: raceMask(constants, rules, 'ALL_HORDE'),
    });
    for (const id of changed) derivedRaces.set(id, before.get(id) ?? null);
  });
  return { flavour: plan.flavour, plan, constants, metas, raw, composed, writes, created, mergeStats, derivedRaces, corrections, lints, timingsMs: timings };
}

/** A composed row as it was after the static corrections, before the derived pass. */
export function beforeDerived(composition: Composition, id: number): LuaTable | undefined {
  const row = composition.composed.quest.get(id);
  if (row === undefined || !composition.derivedRaces.has(id)) return row;
  const copy = row.clone();
  copy.set(QUEST_REQUIRED_RACES, composition.derivedRaces.get(id) ?? null);
  return copy;
}

export const counts = (rows: PerKind<ReadonlyMap<number, unknown>>): { quests: number; npcs: number; objects: number; items: number } => ({
  quests: rows.quest.size,
  npcs: rows.npc.size,
  objects: rows.object.size,
  items: rows.item.size,
});
