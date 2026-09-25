import type { Lint } from './evaluator';
import { isFunction } from './evaluator';
import type { Rows } from './entities';
import { assertFieldType } from './entities';
import { describeValue, LuaTable, type LuaValue, ShapeError, sequence } from './lua-value';
import type { ProviderStep } from './plan';
import { correctionEnvironment, type CorrectionEnvironment, type Datatype, HINT_SETS, type HintSet, runFile } from './sandbox';
import type { Transcription } from './semantics';
import type { EntityMeta, ReadInput } from './upstream-lua';

/**
 * Correction providers (DATA_PROVENANCE §5; research/questiedb-schema.md §7): loading the files,
 * materialising one provider function (register.lua `wrap`), and QuestieDB's merge
 * (registry.lua `MergeInto`) with per-field write tracking.
 */

/** Upstream behaviour transcribed here, with the blob it was written against (lib/semantics.ts). */
export const TRANSCRIBES: readonly Transcription[] = [
  { path: 'src/corrections/register.lua', sha256: '1abd208277be869221b08fd623cc78e1cef6fd1a80a8fca7e99a507a4a4bf7c0', what: 'register.lua wrap (direct writes, then the returned table)' },
  { path: 'src/corrections/registry.lua', sha256: 'f8ad7dd54e6baad137ed217dc26f2802e721b7e3eea5d9da2c5522806bdcef67', what: 'registry.MergeInto and recompose' },
  { path: 'src/meta/normalize.lua', sha256: '9047cb03c21dd5f26e007d07ee0f700dab0b20149484e5ee5ba4504e266b131b', what: 'normalize.field nil cases of overlay values ({} and {0, 0} pairs)' },
];

export interface LoadedCorrections {
  readonly env: CorrectionEnvironment;
  /** The `*ObjectiveFirst` quest-id sets written at file load (compat.lua objectiveFirst). */
  readonly hints: ReadonlyMap<HintSet, readonly number[]>;
  readonly lints: readonly Lint[];
}

/** Runs the top level of every correction file once, in plan order, in one compat environment. */
export function loadCorrectionFiles(read: ReadInput, files: readonly string[], constants: LuaTable, rules: string): LoadedCorrections {
  const env = correctionEnvironment(constants, rules);
  const lints: Lint[] = [];
  for (const file of files) {
    const result = runFile(file, read(file), env.globals, { locations: true });
    lints.push(...result.lints);
  }
  const hints = new Map<HintSet, readonly number[]>();
  for (const name of HINT_SETS) {
    const table = env.hints.get(name) ?? new LuaTable();
    const ids: number[] = [];
    for (const [id, flag] of table.entries()) {
      if (typeof id !== 'number' || !Number.isInteger(id) || flag !== true) throw new ShapeError(`compat.objectiveFirst.${name}`, `entry ${String(id)} = ${describeValue(flag)} is not [questId] = true`);
      ids.push(id);
    }
    hints.set(name, ids);
  }
  return { env, hints, lints };
}

/**
 * register.lua `wrap`: the function's direct writes into `QuestieDB.<type>Data` first, then its
 * returned table on top (field by field). The persona is set only for this call, and the call runs
 * through compat.Invoke (the `Questie` global exists only while it runs).
 */
export function materialise(loaded: LoadedCorrections, step: ProviderStep, persona: { readonly faction: 'Alliance' | 'Horde'; readonly classFile: string } | null): LuaTable {
  const module = loaded.env.modules.get(step.module);
  if (!(module instanceof LuaTable)) throw new ShapeError(step.file, `module ${step.module} was not created by the file`);
  const fn = module.get(step.functionName);
  if (fn === null || !isFunction(fn)) throw new ShapeError(step.file, `${step.module}:${step.functionName} is not a function`);
  for (const buffer of loaded.env.captured.values()) for (const key of buffer.keys()) buffer.set(key, null);
  loaded.env.persona.faction = persona?.faction ?? null;
  loaded.env.persona.classFile = persona?.classFile ?? null;
  let returned: LuaValue;
  try {
    returned = loaded.env.invoke(fn, [module]);
  } finally {
    loaded.env.persona.faction = null;
    loaded.env.persona.classFile = null;
  }
  const merged = new LuaTable();
  const captured = loaded.env.captured.get(step.datatype) ?? new LuaTable();
  for (const [id, fields] of captured.entries()) {
    if (!(fields instanceof LuaTable)) throw new ShapeError(step.file, `direct write to id ${String(id)} is not a table`);
    merged.set(id, fields.clone());
  }
  if (returned !== null) {
    if (!(returned instanceof LuaTable)) throw new ShapeError(step.file, `${step.functionName} returned a ${describeValue(returned)}`);
    for (const [id, fields] of returned.entries()) {
      if (!(fields instanceof LuaTable)) throw new ShapeError(step.file, `correction for id ${String(id)} is not a table`);
      const existing = merged.get(id);
      const row = existing instanceof LuaTable ? existing : new LuaTable();
      for (const [key, value] of fields.entries()) row.set(key, value);
      merged.set(id, row);
    }
  }
  return merged;
}

/** Per entity: field index → last static writer. */
export type WriteLog = Map<number, Map<number, string>>;

export interface MergeStats {
  readonly provider: string;
  applied: number;
  created: number;
  /** Ids skipped because noNewEntries forbade creating them. */
  skippedAbsent: number;
  readonly fieldWrites: Map<number, number>;
  /** Non-numeric field keys, which MergeInto ignores. */
  readonly ignoredKeys: string[];
}

export const isDeleteIdiom = (value: LuaValue): boolean => value instanceof LuaTable && value.isEmpty();

/** A correction value must suit the field's storage type; `{}` is the delete idiom for every type. */
export function assertCorrectionValue(meta: EntityMeta, where: string, index: number, value: LuaValue): void {
  if (isDeleteIdiom(value)) {
    if (!meta.types.has(index)) throw new ShapeError(where, `field ${String(index)} is outside the ${meta.entity} schema`);
    return;
  }
  assertFieldType(meta, where, index, value);
}

/**
 * registry.lua `MergeInto`: whole-field replacement; an absent id is created unless noNewEntries;
 * noOverwrites writes only fields that are nil; `[k] = {}` stores the empty table (the delete
 * idiom, which reads back as nil); ids are independent, so iteration order does not matter.
 */
export function mergeInto(
  rows: Rows,
  corrections: LuaTable,
  options: { readonly noNewEntries: boolean; readonly noOverwrites: boolean },
  meta: EntityMeta,
  provider: string,
  log: WriteLog,
  created: Set<number>,
): MergeStats {
  const stats: MergeStats = { provider, applied: 0, created: 0, skippedAbsent: 0, fieldWrites: new Map(), ignoredKeys: [] };
  for (const [id, fields] of corrections.entries()) {
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) throw new ShapeError(provider, `correction key ${String(id)} is not a positive integer id`);
    if (!(fields instanceof LuaTable)) throw new ShapeError(provider, `correction for ${String(id)} is not a table`);
    let row = rows.get(id);
    if (row === undefined) {
      if (options.noNewEntries) {
        stats.skippedAbsent += 1;
        continue;
      }
      row = new LuaTable();
      rows.set(id, row);
      created.add(id);
      stats.created += 1;
    }
    for (const [index, value] of fields.entries()) {
      if (typeof index !== 'number') {
        stats.ignoredKeys.push(`${String(id)}.${String(index)}`);
        continue;
      }
      assertCorrectionValue(meta, `${provider} id ${String(id)}`, index, value);
      if (options.noOverwrites && row.get(index) !== null) continue;
      row.set(index, value);
      stats.applied += 1;
      stats.fieldWrites.set(index, (stats.fieldWrites.get(index) ?? 0) + 1);
      let fieldsLog = log.get(id);
      if (fieldsLog === undefined) {
        fieldsLog = new Map();
        log.set(id, fieldsLog);
      }
      fieldsLog.set(index, provider);
    }
  }
  return stats;
}

// ---------------------------------------------------------------------------------------------
// Dynamic corrections (registry.lua recompose)

/** registry.NIL: the overlay sets the field to nil (a plain nil could not say so). */
export const OVERLAY_NIL: unique symbol = Symbol('overlay nil');
/** An overlay field value: a Lua value, or {@link OVERLAY_NIL}. */
export type OverlayValue = Exclude<LuaValue, null> | typeof OVERLAY_NIL;
/** id → field → value, for one datatype and one persona. */
export type Overlay = Map<number, Map<number, OverlayValue>>;

/** normalize.field's nil cases for an overlay value: `{}` everywhere, `{0,0}` pairs of fields 18-20. */
function overlayNil(zeroPairFields: ReadonlySet<number>, index: number, value: Exclude<LuaValue, null>): boolean {
  if (isDeleteIdiom(value)) return true;
  if (zeroPairFields.has(index) && value instanceof LuaTable) {
    const a = value.get(1);
    const b = value.get(2);
    return (a === null || a === 0) && (b === null || b === 0);
  }
  return false;
}

/**
 * Composes one persona's dynamic layer: later providers win per field; `{}` and zero pairs become
 * nil; deprecated constant fields are dropped (as upstream drops them). A non-empty table in a
 * scalar field or a field outside the schema fails closed (upstream warns and drops it).
 */
export function composeOverlay(
  materialised: readonly { readonly step: ProviderStep; readonly corrections: LuaTable }[],
  meta: EntityMeta,
  zeroPairFields: ReadonlySet<number>,
): Overlay {
  const overlay: Overlay = new Map();
  for (const { step, corrections } of materialised) {
    for (const [id, fields] of corrections.entries()) {
      if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) throw new ShapeError(step.file, `dynamic correction key ${String(id)} is not an id`);
      if (!(fields instanceof LuaTable)) throw new ShapeError(step.file, `dynamic correction for ${String(id)} is not a table`);
      for (const [index, value] of fields.entries()) {
        if (typeof index !== 'number') continue;
        if (meta.constantValues.has(index)) continue;
        assertCorrectionValue(meta, `${step.file} ${step.functionName} id ${String(id)}`, index, value);
        let row = overlay.get(id);
        if (row === undefined) {
          row = new Map();
          overlay.set(id, row);
        }
        row.set(index, overlayNil(zeroPairFields, index, value) ? OVERLAY_NIL : value);
      }
    }
  }
  return overlay;
}

/** A static row with one persona's overlay applied (a fresh table; the static row is untouched). */
export function applyOverlay(row: LuaTable, fields: ReadonlyMap<number, OverlayValue>): LuaTable {
  const patched = row.clone();
  for (const [index, value] of fields) patched.set(index, value === OVERLAY_NIL ? null : value);
  return patched;
}

/** The ids of a sequence of numbers (an upstream idarray), failing closed on anything else. */
export function idList(value: LuaValue, where: string): readonly number[] {
  if (value === null || isDeleteIdiom(value)) return [];
  if (!(value instanceof LuaTable)) throw new ShapeError(where, `expected a list of ids, got ${describeValue(value)}`);
  return sequence(value, where).map((item) => {
    if (typeof item !== 'number' || !Number.isInteger(item)) throw new ShapeError(where, `list element ${describeValue(item)} is not an integer id`);
    return item;
  });
}

export type { Datatype };
