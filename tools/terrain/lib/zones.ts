import type { BlockGeometry } from './geometry';
import { chunkKeyAt } from './formats/grid';

/**
 * Areas and zones (terrain-navigation.md §3.1 step 4, §8.1; D-034 item 3).
 *
 * - Every source triangle carries an AreaTable tag (geometry.ts): the MCNK area for terrain and
 *   liquid, `WMOAreaTable` for WMO groups, the WMO root's area for its doodads, 0 for M2s.
 * - A navigation polygon's area is the tag of the source triangle that contains its centroid in
 *   2D and is nearest in height (within 8 yd); when that tag is 0 or no triangle qualifies, the
 *   MCNK area of the chunk under the centroid.
 * - The zone is that area rolled up through `AreaTable.ParentAreaID` to a row whose parent is 0.
 */

/** `AreaTable` ID → `ParentAreaID`. */
export function areaParents(rows: Iterable<{ readonly id: number; readonly parent: number }>): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of rows) out.set(r.id, r.parent);
  return out;
}

/** The top-level zone of an area: follows `ParentAreaID` until a row whose parent is 0 or unknown. */
export function topZone(parents: ReadonlyMap<number, number>, area: number): number {
  let a = area;
  for (let guard = 0; guard < 16; guard += 1) {
    const parent = parents.get(a);
    if (parent === undefined || parent === 0) return a;
    a = parent;
  }
  throw new Error(`AreaTable parent chain of ${String(area)} is longer than 16 (a cycle?)`);
}

// ---------------------------------------------------------------------------------------------
// WMOAreaTable

export interface WmoAreaRow {
  readonly wmoId: number;
  readonly nameSet: number;
  /** −1 for the WMO's root row. */
  readonly groupId: number;
  readonly areaId: number;
}

export interface WmoAreaIndex {
  get(wmoId: number, nameSet: number, groupId: number): number | undefined;
  readonly size: number;
}

/** An index over `WMOAreaTable` rows. For a repeated (WMOID, NameSetID, WMOGroupID) the last row in file order wins. */
export function wmoAreaIndex(rows: Iterable<WmoAreaRow>): WmoAreaIndex {
  const map = new Map<string, number>();
  for (const r of rows) map.set(`${String(r.wmoId)}:${String(r.nameSet)}:${String(r.groupId)}`, r.areaId);
  return { get: (wmoId, nameSet, groupId) => map.get(`${String(wmoId)}:${String(nameSet)}:${String(groupId)}`), size: map.size };
}

/** The area of a placed WMO as a whole: its root row (group −1) for the name set, else for name set 0, else 0. */
export function wmoRootArea(index: WmoAreaIndex, wmoId: number, nameSet: number): number {
  return index.get(wmoId, nameSet, -1) ?? index.get(wmoId, 0, -1) ?? 0;
}

/** The area of one group: its own row for the name set, else for name set 0, else the root area. */
export function wmoGroupArea(index: WmoAreaIndex, wmoId: number, nameSet: number, groupId: number): number {
  return index.get(wmoId, nameSet, groupId) ?? index.get(wmoId, 0, groupId) ?? wmoRootArea(index, wmoId, nameSet);
}

// ---------------------------------------------------------------------------------------------
// Polygon areas from source triangles

export interface ZoneIndex {
  readonly cell: number;
  readonly bins: ReadonlyMap<number, readonly number[]>;
  readonly geometry: BlockGeometry;
}

const binKey = (i: number, j: number): number => (i + 8192) * 16384 + (j + 8192);

/** Bins the block's triangles by 2D AABB into `cell`-yard cells (triangles over 4,096 cells are left to the chunk fallback). */
export function zoneIndex(g: BlockGeometry, cell = 4): ZoneIndex {
  const bins = new Map<number, number[]>();
  const p = g.positions;
  for (let t = 0; t < g.triangleCount; t += 1) {
    const a = (g.triangles[t * 3] ?? 0) * 3;
    const b = (g.triangles[t * 3 + 1] ?? 0) * 3;
    const c = (g.triangles[t * 3 + 2] ?? 0) * 3;
    const ax = p[a] ?? 0;
    const bx = p[b] ?? 0;
    const cx = p[c] ?? 0;
    const ay = p[a + 1] ?? 0;
    const by = p[b + 1] ?? 0;
    const cy = p[c + 1] ?? 0;
    const x0 = Math.floor(Math.min(ax, bx, cx) / cell);
    const x1 = Math.floor(Math.max(ax, bx, cx) / cell);
    const y0 = Math.floor(Math.min(ay, by, cy) / cell);
    const y1 = Math.floor(Math.max(ay, by, cy) / cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) continue;
    for (let i = x0; i <= x1; i += 1) {
      for (let j = y0; j <= y1; j += 1) {
        const k = binKey(i, j);
        const list = bins.get(k);
        if (list === undefined) bins.set(k, [t]);
        else list.push(t);
      }
    }
  }
  return { cell, bins, geometry: g };
}

/** The MCNK area under world (x, y), 0 when the block did not read that chunk. */
export function chunkAreaAt(g: BlockGeometry, x: number, y: number): number {
  return g.chunkAreas.get(chunkKeyAt(x, y)) ?? 0;
}

export interface AreaHit {
  readonly area: number;
  /** True when a source triangle gave the area; false for the chunk fallback. */
  readonly fromTriangle: boolean;
}

/** Maximum height difference between a polygon centroid and the source triangle that tags it. */
export const AREA_HEIGHT_TOLERANCE_YD = 8;

/**
 * The AreaTable ID at world (x, y, z): the tag of the source triangle containing (x, y) whose
 * height there is nearest z (strictly within 8 yd; ties to the lower triangle index), unless that
 * tag is 0; otherwise the chunk's area.
 */
export function areaAt(zi: ZoneIndex, x: number, y: number, z: number): AreaHit {
  const g = zi.geometry;
  const p = g.positions;
  let best = -1;
  let bestDz = AREA_HEIGHT_TOLERANCE_YD;
  for (const t of zi.bins.get(binKey(Math.floor(x / zi.cell), Math.floor(y / zi.cell))) ?? []) {
    const a = (g.triangles[t * 3] ?? 0) * 3;
    const b = (g.triangles[t * 3 + 1] ?? 0) * 3;
    const c = (g.triangles[t * 3 + 2] ?? 0) * 3;
    const ax = p[a] ?? 0;
    const ay = p[a + 1] ?? 0;
    const bx = p[b] ?? 0;
    const by = p[b + 1] ?? 0;
    const cx = p[c] ?? 0;
    const cy = p[c + 1] ?? 0;
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
    const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    const dz = Math.abs(l1 * (p[a + 2] ?? 0) + l2 * (p[b + 2] ?? 0) + l3 * (p[c + 2] ?? 0) - z);
    if (dz < bestDz || (dz === bestDz && t < best)) {
      bestDz = dz;
      best = t;
    }
  }
  const tag = best >= 0 ? (g.tags[best] ?? 0) : 0;
  if (tag !== 0) return { area: tag, fromTriangle: true };
  return { area: chunkAreaAt(g, x, y), fromTriangle: false };
}

/** The top-level zone at world (x, y, z). */
export function zoneAt(parents: ReadonlyMap<number, number>, zi: ZoneIndex, x: number, y: number, z: number): number {
  return topZone(parents, areaAt(zi, x, y, z).area);
}
