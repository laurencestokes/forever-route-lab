import type { UiMapId } from '../domain/ids';
import { createMapGeometry } from './geometry';
import type { GeometryAssignment, MapGeometry, UiMapGeometry } from './types';

/**
 * Frame compatibility (docs/MAPS.md §5.6; ARCHITECTURE §6; D-018).
 *
 * The dataset's spawn percentages are in the frames of the 49 UiMaps QuestieDB's
 * `conversion.json` lists (frame set F: the committed geometry's `questiedb-conversion` UiMaps,
 * 1411-1413 and 1416-1461). A geometry is frame-compatible when its rows for F encode to the same
 * canonical string, and therefore the same SHA-256 frame hash.
 *
 * Canonical form: one tuple per UiMap in F, ascending by UiMapId,
 * `[uiMapId, mapId, xMin, xMax, yMin, yMax, uiMin_u, uiMin_v, uiMax_u, uiMax_v]`, from its single
 * OrderIndex 0 row, every coordinate passed through `Math.fround` (DB2 stores float32, so
 * exporters that print different decimals for one float agree), serialised with `JSON.stringify`.
 * The hash is the lowercase hex SHA-256 of the UTF-8 bytes; hashing is not pure, so `tools/maps`
 * (node:crypto) and `infra/maps` (WebCrypto) do it. Reference at the pinned inputs:
 * `2cb10551b1502b652e4d54922e8b3a1ecb48057fbfb7cf9c77863edd7efea78f`.
 */

export type FrameTuple = readonly [
  uiMapId: number,
  mapId: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  uiMinU: number,
  uiMinV: number,
  uiMaxU: number,
  uiMaxV: number,
];

/** The canonical tuple of one row. Assignment ID, AreaID, OrderIndex, source and build are not part of it. */
export function frameTuple(id: UiMapId, row: GeometryAssignment): FrameTuple {
  const f = Math.fround;
  return [id, row.mapId, f(row.xMin), f(row.xMax), f(row.yMin), f(row.yMax), f(row.uiMin[0]), f(row.uiMin[1]), f(row.uiMax[0]), f(row.uiMax[1])];
}

/** Frame set F of a geometry: the UiMaps with `questiedb-conversion` rows, ascending. */
export function frameSetOf(geometry: MapGeometry): readonly UiMapId[] {
  return [...geometry.maps.values()]
    .filter((map) => map.assignments.some((row) => row.source === 'questiedb-conversion'))
    .map((map) => map.uiMapId);
}

export type FrameTuplesResult =
  | { readonly ok: true; readonly tuples: readonly FrameTuple[]; readonly canonical: string }
  /** UiMaps of the frame set that the geometry lacks, or that have no or several OrderIndex 0 rows. */
  | { readonly ok: false; readonly incompatible: readonly UiMapId[] };

/**
 * The canonical frame tuples and string of `geometry` over `frameSet` (default: the geometry's own
 * frame set). A UiMap of the set without exactly one OrderIndex 0 row makes the geometry
 * incompatible (MAPS.md §5.6).
 */
export function canonicalFrameTuples(geometry: MapGeometry, frameSet: readonly UiMapId[] = frameSetOf(geometry)): FrameTuplesResult {
  const ids = [...new Set(frameSet)].sort((a, b) => a - b);
  const tuples: FrameTuple[] = [];
  const incompatible: UiMapId[] = [];
  for (const id of ids) {
    const primary = geometry.maps.get(id)?.assignments.filter((row) => row.orderIndex === 0) ?? [];
    const [row] = primary;
    if (primary.length !== 1 || row === undefined) incompatible.push(id);
    else tuples.push(frameTuple(id, row));
  }
  if (incompatible.length > 0) return { ok: false, incompatible };
  return { ok: true, tuples, canonical: canonicalFrameString(tuples) };
}

/** `JSON.stringify` of the tuples: the exact bytes the frame hash is taken over. */
export function canonicalFrameString(tuples: readonly FrameTuple[]): string {
  return JSON.stringify(tuples);
}

// =============================================================================================
// Local geometry merge

/** Row identity for the shared-UiMap comparison: the frame tuple plus the fields resolution uses. */
type RowKey = readonly [...FrameTuple, orderIndex: number, areaId: number];

const rowKey = (id: UiMapId, row: GeometryAssignment): RowKey => [...frameTuple(id, row), row.orderIndex, row.areaId];

function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

const sortedKeys = (map: UiMapGeometry): readonly RowKey[] => map.assignments.map((row) => rowKey(map.uiMapId, row)).sort(compareKeys);

const sameRows = (a: UiMapGeometry, b: UiMapGeometry): boolean => {
  const left = sortedKeys(a);
  const right = sortedKeys(b);
  return left.length === right.length && left.every((key, i) => compareKeys(key, right[i] ?? []) === 0);
};

export type MergeResult =
  | {
      readonly kind: 'merged';
      /** The committed geometry plus the added UiMaps; everything the committed file has is kept as is. */
      readonly geometry: MapGeometry;
      /** UiMaps the local set added, ascending. */
      readonly added: readonly UiMapId[];
    }
  | {
      readonly kind: 'mismatch';
      /** Frame-set UiMaps whose local frame differs from the committed one, or that the local set lacks. */
      readonly frameUiMapIds: readonly UiMapId[];
      /** Other UiMaps both geometries have whose rows differ. */
      readonly sharedRowUiMapIds: readonly UiMapId[];
    };

/**
 * Merges a local geometry into the committed one (ARCHITECTURE §6; MAPS.md §5.6 steps 3-5).
 *
 * 1. The local rows for the committed frame set must give the committed canonical frame string
 *    (equal strings are equal frame hashes, so no hashing is needed here).
 * 2. For every other UiMap both have, the rows must be identical: equal sorted row keys (the frame
 *    tuple after `Math.fround`, plus OrderIndex and AreaID, which resolution and zone attribution
 *    use). Assignment IDs, `source` and `build` are provenance and are not compared.
 * 3. Any difference rejects the whole local set; otherwise every UiMap the committed geometry
 *    lacks is added with its local rows. Names, types and parents of committed UiMaps, and the
 *    `eraToForever` block, always come from the committed geometry.
 *
 * Resolution therefore never differs between machines for a UiMap both geometries know.
 */
export function mergeLocalGeometry(committed: MapGeometry, local: MapGeometry): MergeResult {
  const frameSet = frameSetOf(committed);
  const frameUiMapIds: UiMapId[] = [];
  for (const id of frameSet) {
    const want = canonicalFrameTuples(committed, [id]);
    const got = canonicalFrameTuples(local, [id]);
    if (!want.ok || !got.ok || want.canonical !== got.canonical) frameUiMapIds.push(id);
  }
  const sharedRowUiMapIds: UiMapId[] = [];
  const added: UiMapGeometry[] = [];
  for (const map of local.maps.values()) {
    const mine = committed.maps.get(map.uiMapId);
    if (mine === undefined) added.push(map);
    else if (!frameUiMapIds.includes(map.uiMapId) && !sameRows(mine, map)) sharedRowUiMapIds.push(map.uiMapId);
  }
  if (frameUiMapIds.length > 0 || sharedRowUiMapIds.length > 0) return { kind: 'mismatch', frameUiMapIds, sharedRowUiMapIds };
  const geometry = createMapGeometry({
    kind: 'merged',
    product: committed.product,
    recordedFrameHash: committed.recordedFrameHash,
    // The merged content is not the committed file's: its recorded content hash does not carry over.
    recordedContentHash: null,
    maps: [...committed.maps.values(), ...added],
    eraToForever: [...committed.eraToForever],
  });
  return { kind: 'merged', geometry, added: added.map((map) => map.uiMapId) };
}
