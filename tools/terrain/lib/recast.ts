import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allocCompactHeightfield,
  allocContourSet,
  allocHeightfield,
  allocPolyMesh,
  buildCompactHeightfield,
  buildContours,
  buildDistanceField,
  buildPolyMesh,
  buildRegions,
  createHeightfield,
  erodeWalkableArea,
  filterLedgeSpans,
  filterLowHangingWalkableObstacles,
  filterWalkableLowHeightSpans,
  freeCompactHeightfield,
  freeContourSet,
  freeHeightfield,
  freePolyMesh,
  init,
  markWalkableTriangles,
  rasterizeTriangles,
  Recast,
  RecastBuildContext,
  type RecastPolyMesh,
  TriangleAreasArray,
  TrianglesArray,
  VerticesArray,
} from 'recast-navigation';
import { MAP_ORIGIN_YD } from './formats/grid';
import { AREA_CLASS, type BlockGeometry } from './geometry';
import { blockTileOrigin, type Derived } from './settings';

/**
 * Recast per tile (terrain-navigation.md §3.1 step 2, §6; TN-06), with recast-navigation-js
 * 0.43.1 (MIT; Recast by Mikko Mononen, zlib), at build time only. Ported from the m3b prototype
 * `build3.ts` (our own research code).
 *
 * - Recast tiles lie on one grid per map (settings.ts): a block builds the tiles of its ADTs.
 * - A tile's triangles are those whose recast-space AABB overlaps the tile plus the border, **in
 *   canonical order** (`canonicalOrder`): Recast's span merge makes rasterisation order-sensitive,
 *   so without the sort a tile would depend on how blocks are cut (321 of 11,776 tiles differ).
 * - A tile's vertical origin is `floor((zMin − 1 − mapOriginZ) / ch)` steps of its own
 *   triangles (a per-tile origin on one 0.25-yd grid per map), its height at most 8,191 voxels.
 * - Then the filters, erosion by the radius, watershed regions, contours with wall-edge
 *   tessellation and the polygon mesh. No detail mesh, no Detour data (Detour only in the
 *   implementation check, detour-check.ts).
 *
 * So a tile's output depends only on its own triangles: block seams are inner seams (§6).
 */

/** Recast area of each geometry class: walkable ground and objects 1, water 3, deep 4, hazard 5. */
export const RECAST_AREA: Readonly<Record<number, number>> = {
  [AREA_CLASS.ground]: 1,
  [AREA_CLASS.object]: 1,
  [AREA_CLASS.water]: 3,
  [AREA_CLASS.deep]: 4,
  [AREA_CLASS.hazard]: 5,
};
export const AREA_GROUND = 1;
export const AREA_WATER = 3;

/** Recast's 13-bit span limit: a tile's heightfield is at most this many voxels high. */
export const MAX_TILE_HEIGHT_VOXELS = 8191;

/** One Recast tile's polygon mesh, exactly as `rcPolyMesh` holds it. */
export interface RecastTile {
  readonly tx: number;
  readonly tz: number;
  /** Tile heightfield origin = mapOriginZ + originStep · ch. */
  readonly originStep: number;
  readonly nv: number;
  /** x, y, z voxel integers per vertex: x, z in 0..tileVoxels from the tile's corner, y from the tile origin. */
  readonly verts: Uint16Array;
  readonly np: number;
  readonly nvp: number;
  /** Per polygon: nvp vertex slots then nvp neighbour slots (0xffff = unused), Recast's layout. */
  readonly polys: Uint16Array;
  readonly areas: Uint8Array;
}

export interface BlockBuildStats {
  readonly tilesWithTriangles: number;
  readonly polygons: number;
  readonly polygonsByArea: Readonly<Record<string, number>>;
  /** Tiles whose height hit the 8,191-voxel limit (spans above it are dropped). */
  readonly clampedTiles: number;
  readonly zMin: number;
  readonly zMax: number;
}

export type PolyMeshHook = (pm: RecastPolyMesh, tx: number, tz: number) => void;

let ready: Promise<void> | null = null;

/** Loads the Recast WASM module once per process. */
export function ensureRecast(): Promise<void> {
  ready ??= init();
  return ready;
}

/** The recast-navigation version and the SHA-256 of the WASM module it runs (manifest `tool.recastNavigation`). */
export function recastModuleInfo(): { readonly version: string; readonly wasmSha256: string; readonly wasmCompatJsSha256: string } {
  const entry = fileURLToPath(import.meta.resolve('recast-navigation'));
  const core = createRequire(entry).resolve('@recast-navigation/core');
  const wasmCompat = createRequire(core).resolve('@recast-navigation/wasm');
  const wasmDir = dirname(wasmCompat);
  const pkg = JSON.parse(readFileSync(join(dirname(entry), 'package.json'), 'utf8')) as { version: string };
  const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
  return { version: pkg.version, wasmSha256: sha(join(wasmDir, 'recast-navigation.wasm.wasm')), wasmCompatJsSha256: sha(wasmCompat) };
}

/**
 * The canonical sort key of every triangle of `g`: its vertices rotated so the smallest (x, then
 * y, then z) comes first, keeping the winding, as nine coordinates, then the class (ten numbers
 * per triangle).
 */
export function triangleKeys(g: BlockGeometry): Float64Array {
  const p = g.positions;
  const key = new Float64Array(g.triangleCount * 10);
  const less = (a: number, b: number): boolean => {
    const ax = p[a * 3] ?? 0;
    const bx = p[b * 3] ?? 0;
    if (ax !== bx) return ax < bx;
    const ay = p[a * 3 + 1] ?? 0;
    const by = p[b * 3 + 1] ?? 0;
    if (ay !== by) return ay < by;
    return (p[a * 3 + 2] ?? 0) < (p[b * 3 + 2] ?? 0);
  };
  for (let t = 0; t < g.triangleCount; t += 1) {
    const i0 = g.triangles[t * 3] ?? 0;
    const i1 = g.triangles[t * 3 + 1] ?? 0;
    const i2 = g.triangles[t * 3 + 2] ?? 0;
    const ix = [i0, i1, i2];
    let r = 0;
    if (less(i1, i0)) r = 1;
    if (less(i2, ix[r] ?? 0)) r = 2;
    for (let j = 0; j < 3; j += 1) {
      const v = ix[(r + j) % 3] ?? 0;
      key[t * 10 + j * 3] = p[v * 3] ?? 0;
      key[t * 10 + j * 3 + 1] = p[v * 3 + 1] ?? 0;
      key[t * 10 + j * 3 + 2] = p[v * 3 + 2] ?? 0;
    }
    key[t * 10 + 9] = g.classes[t] ?? 0;
  }
  return key;
}

/**
 * Sorts triangle indices `list` into canonical order by `keys` (triangleKeys). Equal keys keep
 * their relative order (the sort is stable), and equal keys rasterise identically, so the order
 * never depends on how the block was cut.
 */
export function canonicalOrder(keys: Float64Array, list: number[]): number[] {
  return list.sort((a, b) => {
    for (let j = 0; j < 10; j += 1) {
      const d = (keys[a * 10 + j] ?? 0) - (keys[b * 10 + j] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  });
}

/** The tile origin step of triangles whose lowest height is zMin (map grid of `ch` from mapOriginZ). */
export function tileOriginStep(d: Derived, zMin: number): number {
  return Math.floor((zMin - 1 - d.settings.mapOriginZ) / d.ch);
}

/** The heightfield height in voxels of a tile whose origin step is `step` and whose highest triangle vertex is zMax. */
export function tileHeightVoxels(d: Derived, step: number, zMax: number): number {
  return Math.min(MAX_TILE_HEIGHT_VOXELS, Math.ceil((zMax + 4 - (d.settings.mapOriginZ + step * d.ch)) / d.ch));
}

/**
 * The triangles of each Recast tile of a block: `bins[(tx − tx0) · count + (tz − tz0)]`, a
 * triangle in every tile whose rectangle plus the border its recast-space AABB overlaps.
 */
export function binTriangles(g: BlockGeometry, d: Derived, tx0: number, tz0: number, count: number): number[][] {
  const bs = d.border * d.cs;
  const bins: number[][] = Array.from({ length: count * count }, () => []);
  const p = g.positions;
  for (let t = 0; t < g.triangleCount; t += 1) {
    const a = (g.triangles[t * 3] ?? 0) * 3;
    const b = (g.triangles[t * 3 + 1] ?? 0) * 3;
    const c = (g.triangles[t * 3 + 2] ?? 0) * 3;
    // recast x = world X, recast z = −world Y
    const x0 = Math.min(p[a] ?? 0, p[b] ?? 0, p[c] ?? 0);
    const x1 = Math.max(p[a] ?? 0, p[b] ?? 0, p[c] ?? 0);
    const z0 = -Math.max(p[a + 1] ?? 0, p[b + 1] ?? 0, p[c + 1] ?? 0);
    const z1 = -Math.min(p[a + 1] ?? 0, p[b + 1] ?? 0, p[c + 1] ?? 0);
    const i0 = Math.max(tx0, Math.floor((x0 - bs + MAP_ORIGIN_YD) / d.tileYd));
    const i1 = Math.min(tx0 + count - 1, Math.floor((x1 + bs + MAP_ORIGIN_YD) / d.tileYd));
    const j0 = Math.max(tz0, Math.floor((z0 - bs + MAP_ORIGIN_YD) / d.tileYd));
    const j1 = Math.min(tz0 + count - 1, Math.floor((z1 + bs + MAP_ORIGIN_YD) / d.tileYd));
    for (let i = i0; i <= i1; i += 1) for (let j = j0; j <= j1; j += 1) bins[(i - tx0) * count + (j - tz0)]?.push(t);
  }
  return bins;
}

/**
 * Builds every Recast tile of the block whose first ADT is (row0, col0), tiles in (tx, tz) order;
 * tiles without triangles or polygons are left out. `ensureRecast()` must have resolved.
 * `hook`, when given, sees each tile's live `rcPolyMesh` before it is freed (the Detour check).
 */
export function buildBlockTiles(g: BlockGeometry, d: Derived, row0: number, col0: number, blockAdts = d.settings.blockAdts, hook?: PolyMeshHook): { tiles: RecastTile[]; stats: BlockBuildStats } {
  const s = d.settings;
  const { tx0, tz0, count } = blockTileOrigin(d, row0, col0, blockAdts);
  const bs = d.border * d.cs;
  const n = g.positions.length / 3;
  const rv = new Float32Array(g.positions.length);
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const z = g.positions[i * 3 + 2] ?? 0;
    rv[i * 3] = g.positions[i * 3] ?? 0;
    rv[i * 3 + 1] = z;
    rv[i * 3 + 2] = -(g.positions[i * 3 + 1] ?? 0);
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  const bins = binTriangles(g, d, tx0, tz0, count);
  const keys = triangleKeys(g);
  const ctx = new RecastBuildContext(false);
  const va = new VerticesArray();
  va.copy(rv);
  const tiles: RecastTile[] = [];
  const polygonsByArea: Record<string, number> = {};
  let polygons = 0;
  let clampedTiles = 0;
  let tilesWithTriangles = 0;
  const walkable = Recast.RC_WALKABLE_AREA;
  try {
    for (let i = 0; i < count; i += 1) {
      for (let j = 0; j < count; j += 1) {
        const list = bins[i * count + j] ?? [];
        if (list.length === 0) continue;
        tilesWithTriangles += 1;
        canonicalOrder(keys, list);
        const tx = tx0 + i;
        const tz = tz0 + j;
        let tMin = Infinity;
        let tMax = -Infinity;
        for (const t of list) {
          for (let k = 0; k < 3; k += 1) {
            const z = g.positions[(g.triangles[t * 3 + k] ?? 0) * 3 + 2] ?? 0;
            if (z < tMin) tMin = z;
            if (z > tMax) tMax = z;
          }
        }
        const step = tileOriginStep(d, tMin);
        const height = tileHeightVoxels(d, step, tMax);
        if (height >= MAX_TILE_HEIGHT_VOXELS) clampedTiles += 1;
        const origin = s.mapOriginZ + step * d.ch;
        const bmin: [number, number, number] = [-MAP_ORIGIN_YD + tx * d.tileYd - bs, origin, -MAP_ORIGIN_YD + tz * d.tileYd - bs];
        const bmax: [number, number, number] = [-MAP_ORIGIN_YD + (tx + 1) * d.tileYd + bs, origin + height * d.ch, -MAP_ORIGIN_YD + (tz + 1) * d.tileYd + bs];
        const side = s.tileVoxels + d.border * 2;
        const hf = allocHeightfield();
        if (!createHeightfield(ctx, hf, side, side, bmin, bmax, d.cs, d.ch)) throw new Error(`recast: createHeightfield failed at tile ${String(tx)},${String(tz)}`);
        const ta = new TrianglesArray();
        const idx = new Int32Array(list.length * 3);
        list.forEach((t, k) => {
          idx[k * 3] = g.triangles[t * 3] ?? 0;
          idx[k * 3 + 1] = g.triangles[t * 3 + 1] ?? 0;
          idx[k * 3 + 2] = g.triangles[t * 3 + 2] ?? 0;
        });
        ta.copy(idx);
        const areas = new TriangleAreasArray();
        areas.resize(list.length);
        markWalkableTriangles(ctx, s.slopeDeg, va, n, ta, list.length, areas);
        list.forEach((t, k) => {
          if (areas.get(k) === walkable) areas.set(k, RECAST_AREA[g.classes[t] ?? 0] ?? 0);
        });
        const ok = rasterizeTriangles(ctx, va, n, ta, areas, list.length, hf, d.walkableClimb);
        ta.destroy();
        areas.destroy();
        if (!ok) throw new Error(`recast: rasterizeTriangles failed at tile ${String(tx)},${String(tz)}`);
        filterLowHangingWalkableObstacles(ctx, d.walkableClimb, hf);
        filterLedgeSpans(ctx, d.walkableHeight, d.walkableClimb, hf);
        filterWalkableLowHeightSpans(ctx, d.walkableHeight, hf);
        const chf = allocCompactHeightfield();
        const built = buildCompactHeightfield(ctx, d.walkableHeight, d.walkableClimb, hf, chf);
        freeHeightfield(hf);
        if (!built) throw new Error(`recast: buildCompactHeightfield failed at tile ${String(tx)},${String(tz)}`);
        if (s.radiusVoxels > 0 && !erodeWalkableArea(ctx, s.radiusVoxels, chf)) throw new Error('recast: erodeWalkableArea failed');
        if (!buildDistanceField(ctx, chf)) throw new Error('recast: buildDistanceField failed');
        if (!buildRegions(ctx, chf, d.border, d.minRegionArea, d.mergeRegionArea)) throw new Error('recast: buildRegions failed');
        const cset = allocContourSet();
        if (!buildContours(ctx, chf, d.maxError, d.maxEdgeLen, cset, Recast.RC_CONTOUR_TESS_WALL_EDGES)) throw new Error('recast: buildContours failed');
        const pm = allocPolyMesh();
        const meshed = buildPolyMesh(ctx, cset, s.vertsPerPoly, pm);
        freeCompactHeightfield(chf);
        freeContourSet(cset);
        if (!meshed) {
          freePolyMesh(pm);
          throw new Error(`recast: buildPolyMesh failed at tile ${String(tx)},${String(tz)}`);
        }
        const np = pm.npolys();
        const nv = pm.nverts();
        const nvp = pm.nvp();
        if (np > 0) {
          const verts = new Uint16Array(nv * 3);
          for (let v = 0; v < nv * 3; v += 1) verts[v] = pm.verts(v);
          const polys = new Uint16Array(np * nvp * 2);
          for (let v = 0; v < np * nvp * 2; v += 1) polys[v] = pm.polys(v);
          const ar = new Uint8Array(np);
          for (let q = 0; q < np; q += 1) {
            ar[q] = pm.areas(q);
            const key = String(ar[q]);
            polygonsByArea[key] = (polygonsByArea[key] ?? 0) + 1;
          }
          tiles.push({ tx, tz, originStep: step, nv, verts, np, nvp, polys, areas: ar });
          polygons += np;
          hook?.(pm, tx, tz);
        }
        freePolyMesh(pm);
      }
    }
  } finally {
    va.destroy();
  }
  return { tiles, stats: { tilesWithTriangles, polygons, polygonsByArea, clampedTiles, zMin: n > 0 ? zMin : 0, zMax: n > 0 ? zMax : 0 } };
}
