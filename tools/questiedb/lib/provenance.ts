import type { EntityKind } from './entities';
import { LuaTable, type LuaValue, luaEqual, ShapeError } from './lua-value';

/**
 * `upstreamDiff` (DATA_PROVENANCE §9.3, D-026): a fact about QuestieDB, from comparing a Forever
 * composed static row with the fork-base (Era) composed static row of the same id:
 *
 * - `era`: identical;
 * - `era-coords`: they differ only in coordinate numbers, and every differing pair is exactly the
 *   documented Era→Forever projection of the Era pair (conversion.json coefficients, 2 dp,
 *   halfway away from zero: QuestieDB tools/dbc/convert.py `round_coordinate`);
 * - `forever-new`: the id is absent from the fork base;
 * - `forever-changed`: any other difference.
 */

export type UpstreamDiff = 'era' | 'era-coords' | 'forever-new' | 'forever-changed';

export interface Coefficients {
  readonly scaleX: number;
  readonly offsetX: number;
  readonly scaleY: number;
  readonly offsetY: number;
}

/** convert.py `round_coordinate`: floor(|v| * 100 + 0.5) / 100 with the sign copied back. */
export function roundCoordinate(value: number): number {
  const scaled = Math.abs(value) * 100;
  if (!Number.isFinite(scaled)) throw new Error('coordinate is too large to round safely');
  const rounded = Math.floor(scaled + 0.5) / 100;
  if (rounded === 0) return 0;
  return value < 0 ? -rounded : rounded;
}

/** The documented projection of one Era pair (never applied to shipped data; D-017). */
export function projectEraPair(c: Coefficients, x: number, y: number): readonly [number, number] {
  return [roundCoordinate(c.scaleX * x + c.offsetX), roundCoordinate(c.scaleY * y + c.offsetY)];
}

export function readCoefficients(conversion: unknown): ReadonlyMap<number, Coefficients> {
  const geometry = (conversion as { readonly geometry?: { readonly area_coefficients?: unknown } } | null)?.geometry;
  const table = geometry?.area_coefficients;
  if (typeof table !== 'object' || table === null) throw new ShapeError('conversion.json', 'geometry.area_coefficients is missing');
  const out = new Map<number, Coefficients>();
  for (const [area, raw] of Object.entries(table as Record<string, unknown>)) {
    const c = raw as { readonly scale_x?: unknown; readonly offset_x?: unknown; readonly scale_y?: unknown; readonly offset_y?: unknown };
    if (typeof c.scale_x !== 'number' || typeof c.offset_x !== 'number' || typeof c.scale_y !== 'number' || typeof c.offset_y !== 'number') {
      throw new ShapeError('conversion.json', `coefficients of area ${area} are not numbers`);
    }
    out.set(Number(area), { scaleX: c.scale_x, offsetX: c.offset_x, scaleY: c.scale_y, offsetY: c.offset_y });
  }
  return out;
}

type CoordinateField = 'spawnlist' | 'waypointlist' | 'trigger' | 'extraobjectives';

/** Coordinate-bearing fields per type (research/questiedb-schema.md §9). */
export const COORDINATE_FIELDS: Readonly<Record<EntityKind, ReadonlyMap<number, CoordinateField>>> = {
  quest: new Map([
    [9, 'trigger'],
    [29, 'extraobjectives'],
  ]),
  npc: new Map([
    [7, 'spawnlist'],
    [8, 'waypointlist'],
  ]),
  object: new Map([
    [4, 'spawnlist'],
    [7, 'waypointlist'],
  ]),
  item: new Map(),
};

interface PairTally {
  converted: number;
}

/** Whether `forever` equals `era` up to projected coordinate pairs of `area`. */
function samePoints(era: LuaValue, forever: LuaValue, area: number, depth: number, coefficients: ReadonlyMap<number, Coefficients>, tally: PairTally): boolean {
  if (!(era instanceof LuaTable) || !(forever instanceof LuaTable)) return luaEqual(era, forever);
  if (era.size !== forever.size) return false;
  if (depth === 0) {
    // A coordinate row: {x, y, phase?}; only x and y may differ.
    for (const key of era.keys()) if (!forever.has(key)) return false;
    const ex = era.get(1);
    const ey = era.get(2);
    const fx = forever.get(1);
    const fy = forever.get(2);
    for (const key of era.keys()) if (key !== 1 && key !== 2 && !luaEqual(era.get(key), forever.get(key))) return false;
    if (typeof ex !== 'number' || typeof ey !== 'number' || typeof fx !== 'number' || typeof fy !== 'number') return luaEqual(era, forever);
    if (ex === fx && ey === fy) return true;
    const c = coefficients.get(area);
    if (c === undefined || (ex === -1 && ey === -1)) return false;
    const [px, py] = projectEraPair(c, ex, ey);
    if (px === fx && py === fy) {
      tally.converted += 1;
      return true;
    }
    return false;
  }
  for (const key of era.keys()) {
    if (!forever.has(key)) return false;
    if (!samePoints(era.get(key), forever.get(key), area, depth - 1, coefficients, tally)) return false;
  }
  return true;
}

/** `{[area] = rows}` with rows at `depth` below the area key (spawnlist 2, waypointlist 3). */
function sameAreaList(era: LuaValue, forever: LuaValue, depth: number, coefficients: ReadonlyMap<number, Coefficients>, tally: PairTally): boolean {
  if (!(era instanceof LuaTable) || !(forever instanceof LuaTable)) return luaEqual(era, forever);
  if (era.size !== forever.size) return false;
  for (const [area, rows] of era.entries()) {
    if (typeof area !== 'number' || !forever.has(area)) return false;
    if (!samePoints(rows, forever.get(area), area, depth - 1, coefficients, tally)) return false;
  }
  return true;
}

function sameCoordinateField(kind: CoordinateField, era: LuaValue, forever: LuaValue, coefficients: ReadonlyMap<number, Coefficients>, tally: PairTally): boolean {
  switch (kind) {
    case 'spawnlist':
      return sameAreaList(era, forever, 2, coefficients, tally);
    case 'waypointlist':
      return sameAreaList(era, forever, 3, coefficients, tally);
    case 'trigger':
    case 'extraobjectives': {
      if (!(era instanceof LuaTable) || !(forever instanceof LuaTable) || era.size !== forever.size) return luaEqual(era, forever);
      for (const [key, value] of era.entries()) {
        if (!forever.has(key)) return false;
        const other = forever.get(key);
        if (kind === 'trigger') {
          if (key === 2 ? !sameAreaList(value, other, 2, coefficients, tally) : !luaEqual(value, other)) return false;
        } else {
          // extraObjectives rows: slot 1 is a spawnlist, the rest must be equal.
          if (!(value instanceof LuaTable) || !(other instanceof LuaTable) || value.size !== other.size) {
            if (!luaEqual(value, other)) return false;
            continue;
          }
          for (const [slot, slotValue] of value.entries()) {
            if (!other.has(slot)) return false;
            if (slot === 1 ? !sameAreaList(slotValue, other.get(slot), 2, coefficients, tally) : !luaEqual(slotValue, other.get(slot))) return false;
          }
        }
      }
      return true;
    }
  }
}

export interface DiffResult {
  readonly tag: UpstreamDiff;
  /** Coordinate pairs that differ from the fork base by exactly the projection. */
  readonly convertedPairs: number;
}

export function classifyRow(kind: EntityKind, forever: LuaTable, era: LuaTable | undefined, coefficients: ReadonlyMap<number, Coefficients>): DiffResult {
  if (era === undefined) return { tag: 'forever-new', convertedPairs: 0 };
  if (luaEqual(era, forever)) return { tag: 'era', convertedPairs: 0 };
  const tally: PairTally = { converted: 0 };
  const fields = new Set([...era.keys(), ...forever.keys()]);
  let coordinatesOnly = true;
  for (const field of fields) {
    const a = era.get(field);
    const b = forever.get(field);
    if (luaEqual(a, b)) continue;
    const coordinateKind = typeof field === 'number' ? COORDINATE_FIELDS[kind].get(field) : undefined;
    if (coordinateKind === undefined || !sameCoordinateField(coordinateKind, a, b, coefficients, tally)) {
      coordinatesOnly = false;
      break;
    }
  }
  if (coordinatesOnly && tally.converted > 0) return { tag: 'era-coords', convertedPairs: tally.converted };
  return { tag: 'forever-changed', convertedPairs: 0 };
}
