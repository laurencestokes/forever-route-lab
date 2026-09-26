import { parseAdtRoot, innerIndex, outerIndex, type Mcnk } from './formats/adt';
import { FormatError, type Vec3 } from './formats/chunked';
import { rectsOverlap, tileRect, UNIT_YD, type Rect, type TileRef } from './formats/grid';
import { liquidAt, mliqTileHasLiquid, wmoLiquidType } from './formats/liquid';
import { parseM2Collision } from './formats/m2';
import { parseObj0 } from './formats/obj0';
import { apply, doodadTransform, placementTransform, type Transform } from './formats/transform';
import { wdtTile, type Wdt } from './formats/wdt';
import { parseWmoGroup, parseWmoRoot, skipGroup, type WmoGroup, type WmoRoot } from './formats/wmo';
import { wmoGroupArea, wmoRootArea, type WmoAreaIndex } from './zones';

/**
 * The triangle soup of one block (terrain-navigation.md §3.1 step 1, TN-06): terrain quads,
 * MH2O liquids, WMO LOD-0 collision and liquids, and M2 collision, for the block's ADT tiles plus
 * a one-tile ring (`blockTiles`), kept when a triangle's 2D AABB overlaps the clip rectangle
 * (block plus 8 yd, wider than the Recast border of 2.1 yd).
 *
 * - Terrain: each quad is a four-triangle fan around its inner vertex; holes are removed; a quad
 *   under more than `swimDepth` of liquid is not walked (only its liquid surface is kept).
 * - MH2O liquid: two triangles at the surface height when the liquid is a hazard or deeper than
 *   `swimDepth`; class hazard (LiquidType SoundBank 2 or 3), deep (the MH2O deep bit) or water.
 * - WMO: collision triangles of each LOD-0 group that is not skipped (wmo.ts), and MLIQ tiles with
 *   liquid, classed hazard or water by the group's resolved LiquidType (liquid.ts).
 * - M2: collision of ADT placements and of the WMO's doodad set 0 plus its chosen set; models
 *   whose footprint (larger of the X and Y model extents × scale) is under `m2MinFootprint` are
 *   dropped (0 keeps all). Placements are deduplicated by (kind, unique id) across tiles.
 * - Every triangle carries an area class and an AreaTable tag (zones.ts). Vertices are quantised
 *   to 1/256 yd (§3.1), so a last-bit difference in `Math.sin` cannot change the voxels.
 *
 * Files come from a `FileSource`, which must fail on a missing or encrypted file (LocalCasc.file
 * does). Every FileDataID read is recorded in `inputs`, for the per-block input hash (§5).
 */

export const AREA_CLASS = { ground: 1, object: 2, water: 3, deep: 4, hazard: 5 } as const;
export type AreaClass = (typeof AREA_CLASS)[keyof typeof AREA_CLASS];

export interface FileSource {
  /** The decoded file; throws when the file is missing, encrypted or corrupt. */
  read(fileDataId: number): Buffer;
}

export interface GeometryOptions {
  /** Block rectangle plus the clip margin (8 yd in the chosen build). */
  readonly clip: Rect;
  /** Liquid deeper than this is swum and its terrain is not walked (1.6 yd). */
  readonly swimDepth: number;
  /** M2 models with a smaller footprint are dropped (4 yd); 0 keeps every model. */
  readonly m2MinFootprint: number;
  /** Hazard LiquidType IDs (`hazardLiquidTypes`). */
  readonly hazardLiquids: ReadonlySet<number>;
  readonly wmoAreas: WmoAreaIndex;
}

export interface GeometryStats {
  adtTiles: number;
  terrainTriangles: number;
  liquidTriangles: number;
  wmoPlacements: number;
  wmoTriangles: number;
  wmoGroupsSkipped: number;
  m2Placements: number;
  m2Triangles: number;
  m2SkippedSmall: number;
  wmoDoodads: number;
  clippedOut: number;
  bytesRead: number;
}

export interface BlockGeometry {
  /** World xyz per vertex (X north, Y west, Z up), quantised to 1/256 yd; three vertices per triangle. */
  readonly positions: Float64Array;
  readonly triangles: Int32Array;
  readonly classes: Uint8Array;
  /** AreaTable tag per triangle; 0 = none (M2). */
  readonly tags: Int32Array;
  readonly triangleCount: number;
  /** MCNK area per global chunk key (grid.chunkKey) of every root ADT read. */
  readonly chunkAreas: ReadonlyMap<number, number>;
  /** FileDataIDs read, ascending. */
  readonly inputs: readonly number[];
  readonly stats: Readonly<GeometryStats>;
}

export const QUANTUM = 256;

/** Rounds to the 1/256-yd grid. */
export function quantise(v: number): number {
  return Math.round(v * QUANTUM) / QUANTUM;
}

/** True when the triangle's 2D AABB overlaps `clip` (edges included). */
export function triangleOverlaps(clip: Rect, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  return Math.max(ax, bx, cx) >= clip.xMin && Math.min(ax, bx, cx) <= clip.xMax && Math.max(ay, by, cy) >= clip.yMin && Math.min(ay, by, cy) <= clip.yMax;
}

class Floats {
  data = new Float64Array(3 * 4096);
  length = 0;
  push3(a: number, b: number, c: number): void {
    if (this.length + 3 > this.data.length) {
      const grown = new Float64Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.length] = a;
    this.data[this.length + 1] = b;
    this.data[this.length + 2] = c;
    this.length += 3;
  }
}

class Ints {
  data = new Int32Array(4096);
  length = 0;
  push(v: number): void {
    if (this.length + 1 > this.data.length) {
      const grown = new Int32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.length] = v;
    this.length += 1;
  }
}

interface M2Model {
  readonly vertices: Float32Array;
  readonly triangles: Uint32Array;
  /** Larger of the model's X and Y extents (unscaled). */
  readonly footprint: number;
}

interface LoadedWmo {
  readonly root: WmoRoot;
  readonly groups: readonly WmoGroup[];
}

export function blockGeometry(source: FileSource, wdt: Wdt, tiles: readonly TileRef[], options: GeometryOptions): BlockGeometry {
  const { clip } = options;
  const positions = new Floats();
  const triangles = new Ints();
  const classes = new Ints();
  const tags = new Ints();
  const stats: GeometryStats = {
    adtTiles: 0,
    terrainTriangles: 0,
    liquidTriangles: 0,
    wmoPlacements: 0,
    wmoTriangles: 0,
    wmoGroupsSkipped: 0,
    m2Placements: 0,
    m2Triangles: 0,
    m2SkippedSmall: 0,
    wmoDoodads: 0,
    clippedOut: 0,
    bytesRead: 0,
  };
  const chunkAreas = new Map<number, number>();
  const inputs = new Set<number>();
  const read = (fileDataId: number): Buffer => {
    const bytes = source.read(fileDataId);
    inputs.add(fileDataId);
    stats.bytesRead += bytes.length;
    return bytes;
  };

  /** Adds one triangle if it overlaps the clip rectangle; returns whether it was kept. */
  const add = (a: Vec3, b: Vec3, c: Vec3, cls: AreaClass, tag: number): boolean => {
    if (!triangleOverlaps(clip, a[0], a[1], b[0], b[1], c[0], c[1])) {
      stats.clippedOut += 1;
      return false;
    }
    const first = positions.length / 3;
    for (const v of [a, b, c]) positions.push3(quantise(v[0]), quantise(v[1]), quantise(v[2]));
    triangles.push(first);
    triangles.push(first + 1);
    triangles.push(first + 2);
    classes.push(cls);
    tags.push(tag);
    return true;
  };

  const addMesh = (vertices: Float32Array, indices: Uint32Array, t: Transform, cls: AreaClass, tag: number): number => {
    let kept = 0;
    const at = (i: number): Vec3 => {
      const v = (indices[i] ?? 0) * 3;
      return apply(t, vertices[v] ?? 0, vertices[v + 1] ?? 0, vertices[v + 2] ?? 0);
    };
    for (let i = 0; i + 2 < indices.length; i += 3) if (add(at(i), at(i + 1), at(i + 2), cls, tag)) kept += 1;
    return kept;
  };

  const m2Cache = new Map<number, M2Model>();
  const m2 = (fileDataId: number): M2Model => {
    let model = m2Cache.get(fileDataId);
    if (model === undefined) {
      const c = parseM2Collision(read(fileDataId));
      let xMin = Infinity;
      let xMax = -Infinity;
      let yMin = Infinity;
      let yMax = -Infinity;
      for (let i = 0; i + 2 < c.vertices.length; i += 3) {
        const x = c.vertices[i] ?? 0;
        const y = c.vertices[i + 1] ?? 0;
        xMin = Math.min(xMin, x);
        xMax = Math.max(xMax, x);
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
      }
      model = { vertices: c.vertices, triangles: c.triangles, footprint: c.vertices.length === 0 ? 0 : Math.max(xMax - xMin, yMax - yMin) };
      m2Cache.set(fileDataId, model);
    }
    return model;
  };
  const tooSmall = (model: M2Model, scale: number): boolean => options.m2MinFootprint > 0 && model.footprint * scale < options.m2MinFootprint;

  const wmoCache = new Map<number, LoadedWmo>();
  const wmo = (fileDataId: number): LoadedWmo => {
    let loaded = wmoCache.get(fileDataId);
    if (loaded === undefined) {
      const root = parseWmoRoot(read(fileDataId));
      loaded = { root, groups: root.groupFileDataIds.filter((g) => g !== 0).map((g) => parseWmoGroup(read(g))) };
      wmoCache.set(fileDataId, loaded);
    }
    return loaded;
  };

  const addTerrain = (m: Mcnk): void => {
    const heights = m.heights;
    if (heights === null) return;
    const point = (row: number, col: number, inner: boolean): Vec3 => {
      const h = heights[inner ? innerIndex(row, col) : outerIndex(row, col)] ?? 0;
      const offset = inner ? 0.5 : 0;
      return [m.position[0] - (row + offset) * UNIT_YD, m.position[1] - (col + offset) * UNIT_YD, m.position[2] + h];
    };
    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 8; c += 1) {
        const hole = m.holes[r * 8 + c] === true;
        const tl = point(r, c, false);
        const tr = point(r, c + 1, false);
        const bl = point(r + 1, c, false);
        const br = point(r + 1, c + 1, false);
        const mid = point(r, c, true);
        const liquid = liquidAt(m.liquid, r, c);
        if (liquid !== null) {
          const hazard = options.hazardLiquids.has(liquid.type);
          const depth = liquid.height - mid[2];
          if (hazard || depth > options.swimDepth) {
            const cls = hazard ? AREA_CLASS.hazard : liquid.deep ? AREA_CLASS.deep : AREA_CLASS.water;
            const h = liquid.height;
            const a: Vec3 = [tl[0], tl[1], h];
            const b: Vec3 = [tr[0], tr[1], h];
            const cc: Vec3 = [bl[0], bl[1], h];
            const d: Vec3 = [br[0], br[1], h];
            add(a, cc, d, cls, m.areaId);
            add(a, d, b, cls, m.areaId);
            stats.liquidTriangles += 2;
            if (depth > options.swimDepth) continue;
          }
        }
        if (hole) continue;
        add(tl, mid, tr, AREA_CLASS.ground, m.areaId);
        add(tr, mid, br, AREA_CLASS.ground, m.areaId);
        add(br, mid, bl, AREA_CLASS.ground, m.areaId);
        add(bl, mid, tl, AREA_CLASS.ground, m.areaId);
        stats.terrainTriangles += 4;
      }
    }
  };

  const seen = new Set<string>();
  for (const t of tiles) {
    const tile = wdtTile(wdt, t.row, t.col);
    if (tile === undefined || tile.rootAdt === 0) continue;
    stats.adtTiles += 1;
    if (rectsOverlap(tileRect(t.row, t.col), clip)) {
      const root = parseAdtRoot(read(tile.rootAdt));
      for (const m of root.chunks) {
        chunkAreas.set((t.row * 16 + m.iy) * 1024 + (t.col * 16 + m.ix), m.areaId);
        const [north, west] = m.position;
        if (north < clip.xMin || north - 8 * UNIT_YD > clip.xMax || west < clip.yMin || west - 8 * UNIT_YD > clip.yMax) continue;
        addTerrain(m);
      }
    }
    if (tile.obj0 === 0) continue;
    for (const p of parseObj0(read(tile.obj0))) {
      if (!p.nameIsFileDataId) throw new FormatError(`obj0 ${String(tile.obj0)}: placement ${String(p.uniqueId)} is named by a string index, not a FileDataID`);
      const key = `${p.kind}:${String(p.uniqueId)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const placed = placementTransform(p.position, p.rotation, p.scale);
      if (p.kind === 'm2') {
        stats.m2Placements += 1;
        const model = m2(p.name);
        if (model.triangles.length === 0) continue;
        if (tooSmall(model, p.scale)) {
          stats.m2SkippedSmall += 1;
          continue;
        }
        stats.m2Triangles += addMesh(model.vertices, model.triangles, placed, AREA_CLASS.object, 0);
        continue;
      }
      stats.wmoPlacements += 1;
      const w = wmo(p.name);
      const rootArea = wmoRootArea(options.wmoAreas, w.root.wmoId, p.nameSet);
      for (const g of w.groups) {
        if (skipGroup(w.root, g)) {
          stats.wmoGroupsSkipped += 1;
          continue;
        }
        const tag = wmoGroupArea(options.wmoAreas, w.root.wmoId, p.nameSet, g.wmoGroupId);
        stats.wmoTriangles += addMesh(g.vertices, g.collision, placed, AREA_CLASS.object, tag);
        const liquid = g.liquid;
        if (liquid === null) continue;
        const cls = options.hazardLiquids.has(wmoLiquidType(g.groupLiquid, w.root.flags, g.flags, liquid)) ? AREA_CLASS.hazard : AREA_CLASS.water;
        const corner = (ix: number, iy: number): Vec3 => apply(placed, liquid.corner[0] + ix * UNIT_YD, liquid.corner[1] + iy * UNIT_YD, liquid.heights[iy * liquid.xVerts + ix] ?? 0);
        for (let ty = 0; ty < liquid.yTiles; ty += 1) {
          for (let tx = 0; tx < liquid.xTiles; tx += 1) {
            if (!mliqTileHasLiquid(liquid.tiles[ty * liquid.xTiles + tx] ?? 15)) continue;
            const a = corner(tx, ty);
            const b = corner(tx + 1, ty);
            const c = corner(tx, ty + 1);
            const d = corner(tx + 1, ty + 1);
            add(a, b, d, cls, tag);
            add(a, d, c, cls, tag);
            stats.liquidTriangles += 2;
          }
        }
      }
      for (const setIndex of new Set([0, p.doodadSet])) {
        const set = w.root.doodadSets[setIndex];
        if (set === undefined) continue;
        for (let i = set.start; i < set.start + set.count; i += 1) {
          const doodad = w.root.doodads[i];
          if (doodad === undefined) continue;
          const fileDataId = w.root.doodadFileDataIds[doodad.nameIndex];
          if (fileDataId === undefined || fileDataId === 0) continue;
          const model = m2(fileDataId);
          if (model.triangles.length === 0) continue;
          if (tooSmall(model, doodad.scale)) {
            stats.m2SkippedSmall += 1;
            continue;
          }
          stats.wmoDoodads += 1;
          stats.m2Triangles += addMesh(model.vertices, model.triangles, doodadTransform(placed, doodad), AREA_CLASS.object, rootArea);
        }
      }
    }
  }
  return {
    positions: positions.data.slice(0, positions.length),
    triangles: triangles.data.slice(0, triangles.length),
    classes: Uint8Array.from(classes.data.subarray(0, classes.length)),
    tags: tags.data.slice(0, tags.length),
    triangleCount: triangles.length / 3,
    chunkAreas,
    inputs: [...inputs].sort((a, b) => a - b),
    stats,
  };
}
