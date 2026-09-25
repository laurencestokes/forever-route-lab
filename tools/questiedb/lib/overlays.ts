import type { Composition } from './compose';
import { KIND_OF } from './compose';
import { applyOverlay, composeOverlay, materialise, OVERLAY_NIL, type Overlay, type OverlayValue } from './corrections';
import type { EntityKind } from './entities';
import { compact } from './json';
import { type LuaTable, luaEqual, ShapeError } from './lua-value';
import type { Datatype } from './sandbox';

/**
 * Dynamic corrections as overlays (DATA_PROVENANCE §6.7): never baked into one persona. Every
 * dynamic provider is evaluated for each faction × class persona; per faction, the values that
 * are the same for every class form the faction layer, and what varies by class forms a class
 * layer under that faction (a class value can differ, or be absent, per faction). The shipped
 * patches are differences of **projected** records at top-level field granularity, so a loader
 * applies them with a shallow merge: static record, then `faction[F]`, then `class[F][C]`.
 */

export const FACTIONS = ['Alliance', 'Horde'] as const;
export type Faction = (typeof FACTIONS)[number];

/**
 * `UnitClassBase` tokens evaluated for the class dimension: the nine classes of the Era rules
 * Forever uses. A Forever-only class token would have to be added here (self-authored list).
 */
export const CLASS_TOKENS = ['WARRIOR', 'PALADIN', 'HUNTER', 'ROGUE', 'PRIEST', 'SHAMAN', 'MAGE', 'WARLOCK', 'DRUID'] as const;

export interface PersonaOverlays {
  /** faction → datatype → overlay applied to every class of that faction. */
  readonly faction: ReadonlyMap<Faction, ReadonlyMap<Datatype, Overlay>>;
  /** faction → class → datatype → the class-varying remainder. */
  readonly class: ReadonlyMap<Faction, ReadonlyMap<string, ReadonlyMap<Datatype, Overlay>>>;
  /** Dynamic entries per provider and persona, for the report. */
  readonly entryCounts: Readonly<Record<string, number>>;
}

const sameValue = (a: OverlayValue | undefined, b: OverlayValue | undefined): boolean => {
  if (a === undefined || b === undefined) return a === b;
  if (a === OVERLAY_NIL || b === OVERLAY_NIL) return a === b;
  return luaEqual(a, b);
};

export function evaluateDynamicLayers(composition: Composition): PersonaOverlays {
  const factionLayers = new Map<Faction, Map<Datatype, Overlay>>();
  const classLayers = new Map<Faction, Map<string, Map<Datatype, Overlay>>>();
  const entryCounts: Record<string, number> = {};
  for (const faction of FACTIONS) {
    const byFaction = new Map<Datatype, Overlay>();
    const byClass = new Map<string, Map<Datatype, Overlay>>(CLASS_TOKENS.map((token) => [token, new Map()]));
    for (const [datatype, steps] of composition.plan.dynamicSteps) {
      const kind: EntityKind = KIND_OF[datatype];
      const meta = composition.metas[kind];
      const zeroPairs = meta.zeroPairIsNil;
      const perClass = new Map<string, Overlay>();
      for (const classFile of CLASS_TOKENS) {
        const materialised = steps.map((step) => {
          const corrections = materialise(composition.corrections, step, { faction, classFile });
          entryCounts[`${step.file}:${step.functionName}:${faction}`] = corrections.size;
          return { step, corrections };
        });
        perClass.set(classFile, composeOverlay(materialised, meta, zeroPairs));
      }
      // Split into the class-invariant faction layer and per-class remainders.
      const invariant: Overlay = new Map();
      const ids = new Set<number>();
      for (const overlay of perClass.values()) for (const id of overlay.keys()) ids.add(id);
      for (const id of [...ids].sort((a, b) => a - b)) {
        if (!composition.composed[kind].has(id)) {
          throw new ShapeError(`dynamic ${datatype}`, `a dynamic correction targets ${kind} ${String(id)}, which the static data does not have`);
        }
        const fields = new Set<number>();
        for (const overlay of perClass.values()) for (const field of overlay.get(id)?.keys() ?? []) fields.add(field);
        for (const field of fields) {
          const values = [...perClass.values()].map((overlay) => overlay.get(id)?.get(field));
          const [first] = values;
          if (first !== undefined && values.every((v) => sameValue(v, first))) {
            let row = invariant.get(id);
            if (row === undefined) {
              row = new Map();
              invariant.set(id, row);
            }
            row.set(field, first);
          }
        }
      }
      byFaction.set(datatype, invariant);
      for (const [classFile, overlay] of perClass) {
        const remainder: Overlay = new Map();
        for (const [id, fields] of overlay) {
          for (const [field, value] of fields) {
            if (invariant.get(id)?.has(field) === true) continue;
            let row = remainder.get(id);
            if (row === undefined) {
              row = new Map();
              remainder.set(id, row);
            }
            row.set(field, value);
          }
        }
        byClass.get(classFile)?.set(datatype, remainder);
      }
    }
    factionLayers.set(faction, byFaction);
    classLayers.set(faction, byClass);
  }
  return { faction: factionLayers, class: classLayers, entryCounts };
}

/** Row of `kind` `id` with the faction layer and, optionally, one class layer applied. */
export function personaRow(composition: Composition, overlays: PersonaOverlays, kind: EntityKind, datatype: Datatype, id: number, faction: Faction, classFile: string | null): LuaTable {
  const base = composition.composed[kind].get(id);
  if (base === undefined) throw new ShapeError('overlay', `${kind} ${String(id)} is not in the static data`);
  let row = base;
  const factionFields = overlays.faction.get(faction)?.get(datatype)?.get(id);
  if (factionFields !== undefined) row = applyOverlay(row, factionFields);
  if (classFile !== null) {
    const classFields = overlays.class.get(faction)?.get(classFile)?.get(datatype)?.get(id);
    if (classFields !== undefined) row = applyOverlay(row, classFields);
  }
  return row;
}

/** The top-level fields of `after` whose JSON differs from `before` (never `id`). */
export function topLevelPatch(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (key === 'id') continue;
    if (compact(before[key] ?? null) !== compact(after[key] ?? null)) patch[key] = after[key] ?? null;
  }
  return patch;
}

/** Ids a persona layer touches for one datatype. */
export function touchedIds(overlays: PersonaOverlays, datatype: Datatype, faction: Faction): readonly number[] {
  const ids = new Set<number>(overlays.faction.get(faction)?.get(datatype)?.keys() ?? []);
  for (const byDatatype of overlays.class.get(faction)?.values() ?? []) for (const id of byDatatype.get(datatype)?.keys() ?? []) ids.add(id);
  return [...ids].sort((a, b) => a - b);
}

