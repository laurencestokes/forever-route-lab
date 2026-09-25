import { isDeleteIdiom } from './corrections';
import { describeValue, LuaTable, type LuaValue, sequence, ShapeError } from './lua-value';
import type { Transcription } from './semantics';
import type { PointMap, PointRow } from './shapes';

/**
 * Spawn lists as published (D-017; DATA_PROVENANCE §6.5). `{[areaId] = {{x, y, phase?}, ...}}`
 * becomes a PointMap with the same numbers: nothing is rounded, re-projected or converted. The
 * row shape follows QuestieDB's read contract (normalize.lua `normalizeCoordinateRow`): an instance
 * sentinel is exactly `[-1, -1]`, a phase of 0 is dropped and a non-zero phase is kept as a third
 * element. A partial sentinel fails closed (upstream's converter rejects it too).
 */

/** Upstream behaviour transcribed here, with the blob it was written against (lib/semantics.ts). */
export const TRANSCRIBES: readonly Transcription[] = [
  { path: 'src/meta/normalize.lua', sha256: '9047cb03c21dd5f26e007d07ee0f700dab0b20149484e5ee5ba4504e266b131b', what: 'normalizeCoordinateRow (sentinel, phase 0 dropped)' },
];

export function pointRow(value: LuaValue, where: string): PointRow {
  if (!(value instanceof LuaTable)) throw new ShapeError(where, `point is ${describeValue(value)}`);
  for (const key of value.keys()) {
    if (key !== 1 && key !== 2 && key !== 3) throw new ShapeError(where, `point has key ${String(key)}`);
  }
  const x = value.get(1);
  const y = value.get(2);
  const phase = value.get(3);
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new ShapeError(where, 'point coordinates must be finite numbers');
  }
  if (x === -1 || y === -1) {
    if (x !== y) throw new ShapeError(where, `partial instance sentinel {${String(x)}, ${String(y)}}`);
    return [-1, -1];
  }
  if (phase !== null && typeof phase !== 'number') throw new ShapeError(where, 'phase must be a number');
  return phase === null || phase === 0 ? [x, y] : [x, y, phase];
}

/** A spawnlist field (or the spawn list inside triggerEnd / extraObjectives), null when absent. */
export function pointMap(value: LuaValue, where: string): PointMap | null {
  if (value === null || isDeleteIdiom(value)) return null;
  if (!(value instanceof LuaTable)) throw new ShapeError(where, `spawn list is ${describeValue(value)}`);
  const out: Record<string, readonly PointRow[]> = {};
  for (const [area, rows] of value.entries()) {
    if (typeof area !== 'number' || !Number.isInteger(area) || area < 0) throw new ShapeError(where, `spawn key ${String(area)} is not an AreaTable id`);
    if (!(rows instanceof LuaTable)) throw new ShapeError(where, `points of area ${String(area)} are ${describeValue(rows)}`);
    out[String(area)] = sequence(rows, `${where} area ${String(area)}`).map((row, index) => pointRow(row, `${where} area ${String(area)} point ${String(index + 1)}`));
  }
  return out;
}

export const isInstanceSentinel = (row: PointRow): boolean => row[0] === -1 && row[1] === -1;

/** Every (areaId, row) of a PointMap, in key order. */
export function* pointsOf(map: PointMap): Generator<readonly [number, PointRow]> {
  for (const [area, rows] of Object.entries(map)) for (const row of rows) yield [Number(area), row];
}
