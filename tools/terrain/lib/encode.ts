import { AREA_GROUND, AREA_WATER, type RecastTile } from './recast';
import { ByteReader, ByteWriter } from './varint';

/**
 * Block format v3 (terrain-navigation.md §5): one file per 4×4-ADT block,
 * `public/nav/<mapId>/<row0>_<col0>.bin`. Little-endian, LEB128 varints, zigzag deltas, no
 * floating point: every coordinate is a voxel integer on the map's grid (lossless against
 * `rcPolyMesh`). Ported from the m3b prototype `format3.ts` (our own research code), without its
 * component stream (RC-03: components live in the per-map `map.bin`, mapfile.ts).
 *
 * ```
 * 'FRN3'  u8 version = 3
 * varint mapId, varint row0, varint col0
 * zig    blockStep                  (0 in this build; the tile steps carry the origin)
 * varint tileCount
 * per tile, in (tx, tz) order:
 *   varint dtx, varint dtz          tile position in the block (tx0 = (63 − (row0 + 3))·4, tz0 = col0·4)
 *   zig    originStep               tile origin = mapOriginZ + (blockStep + originStep)·ch
 *   varint nv, varint np
 *   nv × (zig dx, zig dz, zig dy)   vertex voxels, delta to the previous vertex
 *   np × (u8 (nv_p − 3)·2 + swim, nv_p × zig (index − previous index))
 * attributes, mode 3:
 *   u8 3, varint zoneCount, zoneCount × varint AreaTable id (ascending)
 *   per tile: varint n, n × varint zone index (ascending), then (n > 1) per polygon varint local index
 * ```
 *
 * Vertices keep rcPolyMesh's order (the smaller of the measured orders, §5). Neighbours are not
 * stored: link.ts derives them.
 */

export const BLOCK_MAGIC = 'FRN3';
export const BLOCK_VERSION = 3;
export const ATTRIBUTE_MODE = 3;
export const MAX_POLY_VERTS = 12;

export interface NavTile {
  readonly tx: number;
  readonly tz: number;
  readonly originStep: number;
  /** x, y, z voxel integers per vertex (Recast layout). */
  readonly verts: Int32Array;
  /** Vertex indices of each polygon, in Recast's order. */
  readonly polys: readonly (readonly number[])[];
  readonly swim: readonly boolean[];
}

export interface NavBlock {
  readonly mapId: number;
  readonly row0: number;
  readonly col0: number;
  readonly blockStep: number;
  readonly tiles: readonly NavTile[];
  /** Top-level zone (AreaTable id) per polygon, in tile then polygon order. */
  readonly zones: Int32Array;
}

export interface BlockGrid {
  /** Recast tiles per ADT side. */
  readonly perAdt: number;
  readonly blockAdts: number;
  readonly tileVoxels: number;
}

export const tileOriginOf = (grid: BlockGrid, row0: number, col0: number): { readonly tx0: number; readonly tz0: number } => ({
  tx0: (63 - (row0 + grid.blockAdts - 1)) * grid.perAdt,
  tz0: col0 * grid.perAdt,
});

export const polygonCount = (block: { readonly tiles: readonly { readonly polys: readonly unknown[] }[] }): number =>
  block.tiles.reduce((sum, t) => sum + t.polys.length, 0);

/**
 * The exported part of one Recast tile: deep (area 4) and hazard (area 5) polygons and
 * unwalkable ones are dropped (never traversable), unused vertices are removed, and the rest keep
 * rcPolyMesh's order. Returns null when no polygon is left.
 */
export function keepTile(t: RecastTile): NavTile | null {
  const polys: number[][] = [];
  const swim: boolean[] = [];
  for (let p = 0; p < t.np; p += 1) {
    const area = t.areas[p] ?? 0;
    if (area !== AREA_GROUND && area !== AREA_WATER) continue;
    const vs: number[] = [];
    for (let j = 0; j < t.nvp; j += 1) {
      const v = t.polys[p * t.nvp * 2 + j] ?? 0xffff;
      if (v === 0xffff) break;
      vs.push(v);
    }
    polys.push(vs);
    swim.push(area === AREA_WATER);
  }
  if (polys.length === 0) return null;
  return compactTile({ tx: t.tx, tz: t.tz, originStep: t.originStep, verts: Int32Array.from(t.verts), polys, swim });
}

/** Removes the vertices no polygon uses, keeping the others in order. */
export function compactTile(t: NavTile): NavTile {
  const nv = t.verts.length / 3;
  const used = new Uint8Array(nv);
  for (const vs of t.polys) for (const v of vs) used[v] = 1;
  const map = new Int32Array(nv).fill(-1);
  let n = 0;
  for (let v = 0; v < nv; v += 1) {
    if (used[v] === 1) {
      map[v] = n;
      n += 1;
    }
  }
  if (n === nv) return t;
  const verts = new Int32Array(n * 3);
  for (let v = 0; v < nv; v += 1) {
    const m = map[v] ?? -1;
    if (m < 0) continue;
    verts[m * 3] = t.verts[v * 3] ?? 0;
    verts[m * 3 + 1] = t.verts[v * 3 + 1] ?? 0;
    verts[m * 3 + 2] = t.verts[v * 3 + 2] ?? 0;
  }
  return { tx: t.tx, tz: t.tz, originStep: t.originStep, verts, polys: t.polys.map((vs) => vs.map((v) => map[v] ?? 0)), swim: t.swim };
}

export function encodeBlock(block: NavBlock, grid: BlockGrid): Buffer {
  const { tx0, tz0 } = tileOriginOf(grid, block.row0, block.col0);
  const span = grid.blockAdts * grid.perAdt;
  const total = polygonCount(block);
  if (block.zones.length !== total) throw new RangeError(`encodeBlock: ${String(block.zones.length)} zones for ${String(total)} polygons`);
  const w = new ByteWriter();
  w.ascii(BLOCK_MAGIC);
  w.byte(BLOCK_VERSION);
  w.u(block.mapId);
  w.u(block.row0);
  w.u(block.col0);
  w.z(block.blockStep);
  w.u(block.tiles.length);
  let last = -1;
  for (const t of block.tiles) {
    const dtx = t.tx - tx0;
    const dtz = t.tz - tz0;
    if (dtx < 0 || dtx >= span || dtz < 0 || dtz >= span) throw new RangeError(`encodeBlock: tile ${String(t.tx)},${String(t.tz)} is outside block ${String(block.row0)}_${String(block.col0)}`);
    const order = dtx * span + dtz;
    if (order <= last) throw new RangeError('encodeBlock: tiles must be in strictly increasing (tx, tz) order');
    last = order;
    const nv = t.verts.length / 3;
    if (t.polys.length === 0 || t.polys.length !== t.swim.length) throw new RangeError('encodeBlock: a tile needs polygons and one swim flag each');
    w.u(dtx);
    w.u(dtz);
    w.z(t.originStep);
    w.u(nv);
    w.u(t.polys.length);
    let px = 0;
    let py = 0;
    let pz = 0;
    for (let v = 0; v < nv; v += 1) {
      const x = t.verts[v * 3] ?? 0;
      const y = t.verts[v * 3 + 1] ?? 0;
      const z = t.verts[v * 3 + 2] ?? 0;
      w.z(x - px);
      w.z(z - pz);
      w.z(y - py);
      px = x;
      py = y;
      pz = z;
    }
    let prev = 0;
    t.polys.forEach((vs, p) => {
      if (vs.length < 3 || vs.length > MAX_POLY_VERTS) throw new RangeError(`encodeBlock: polygon with ${String(vs.length)} vertices`);
      w.byte((vs.length - 3) * 2 + (t.swim[p] === true ? 1 : 0));
      for (const v of vs) {
        if (!Number.isInteger(v) || v < 0 || v >= nv) throw new RangeError(`encodeBlock: vertex index ${String(v)} of ${String(nv)}`);
        w.z(v - prev);
        prev = v;
      }
    });
  }
  // attributes, mode 3: per-polygon top-level zones through per-tile local tables
  w.byte(ATTRIBUTE_MODE);
  const zones = [...new Set(block.zones)].sort((a, b) => a - b);
  const zoneIndex = new Map(zones.map((z, i) => [z, i]));
  w.u(zones.length);
  for (const z of zones) w.u(z);
  let base = 0;
  for (const t of block.tiles) {
    const own = block.zones.subarray(base, base + t.polys.length);
    const distinct = [...new Set(own)].sort((a, b) => a - b);
    w.u(distinct.length);
    for (const z of distinct) w.u(zoneIndex.get(z) ?? 0);
    if (distinct.length > 1) {
      const local = new Map(distinct.map((z, i) => [z, i]));
      for (const z of own) w.u(local.get(z) ?? 0);
    }
    base += t.polys.length;
  }
  return w.bytes();
}

/** Decodes and checks one block; throws NavFormatError on anything that does not follow the layout. */
export function decodeBlock(bytes: Uint8Array, grid: BlockGrid, what = 'nav block'): NavBlock {
  const r = new ByteReader(bytes, what);
  if (r.ascii(4) !== BLOCK_MAGIC) r.fail('not a FRN3 block');
  const version = r.byte();
  if (version !== BLOCK_VERSION) r.fail(`version ${String(version)}, expected ${String(BLOCK_VERSION)}`);
  const mapId = r.u();
  const row0 = r.bounded(63, 'row0');
  const col0 = r.bounded(63, 'col0');
  if (row0 % grid.blockAdts !== 0 || col0 % grid.blockAdts !== 0) r.fail(`block ${String(row0)}_${String(col0)} is not on the ${String(grid.blockAdts)}-ADT grid`);
  const blockStep = r.z();
  const span = grid.blockAdts * grid.perAdt;
  const tileCount = r.bounded(span * span, 'tile count');
  const { tx0, tz0 } = tileOriginOf(grid, row0, col0);
  const tiles: NavTile[] = [];
  let last = -1;
  let total = 0;
  for (let i = 0; i < tileCount; i += 1) {
    const dtx = r.bounded(span - 1, 'dtx');
    const dtz = r.bounded(span - 1, 'dtz');
    if (dtx * span + dtz <= last) r.fail('tiles out of order');
    last = dtx * span + dtz;
    const originStep = r.z();
    const nv = r.bounded(0xfffe, 'vertex count');
    const np = r.bounded(0xfffe, 'polygon count');
    if (np === 0) r.fail('empty tile');
    const verts = new Int32Array(nv * 3);
    let px = 0;
    let py = 0;
    let pz = 0;
    for (let v = 0; v < nv; v += 1) {
      px += r.z();
      pz += r.z();
      py += r.z();
      if (px < 0 || px > grid.tileVoxels || pz < 0 || pz > grid.tileVoxels || py < 0 || py > 0xffff) r.fail(`vertex ${String(v)} outside the tile`);
      verts[v * 3] = px;
      verts[v * 3 + 1] = py;
      verts[v * 3 + 2] = pz;
    }
    const polys: number[][] = [];
    const swim: boolean[] = [];
    let prev = 0;
    for (let p = 0; p < np; p += 1) {
      const header = r.byte();
      const k = Math.floor(header / 2) + 3;
      if (k > MAX_POLY_VERTS) r.fail(`polygon with ${String(k)} vertices`);
      swim.push(header % 2 === 1);
      const vs: number[] = [];
      for (let j = 0; j < k; j += 1) {
        prev += r.z();
        if (prev < 0 || prev >= nv) r.fail(`vertex index ${String(prev)} of ${String(nv)}`);
        vs.push(prev);
      }
      polys.push(vs);
    }
    tiles.push({ tx: tx0 + dtx, tz: tz0 + dtz, originStep, verts, polys, swim });
    total += np;
  }
  const mode = r.byte();
  if (mode !== ATTRIBUTE_MODE) r.fail(`attribute mode ${String(mode)}, expected ${String(ATTRIBUTE_MODE)}`);
  const zoneCount = r.bounded(total, 'zone count');
  const zoneIds: number[] = [];
  for (let i = 0; i < zoneCount; i += 1) {
    const z = r.u();
    if (i > 0 && z <= (zoneIds[i - 1] ?? -1)) r.fail('zones not ascending');
    zoneIds.push(z);
  }
  const zones = new Int32Array(total);
  let base = 0;
  for (const t of tiles) {
    const n = r.bounded(zoneCount, 'tile zone count');
    if (n === 0) r.fail('tile without zones');
    const local: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const zi = r.bounded(zoneCount - 1, 'zone index');
      if (i > 0 && zi <= (local[i - 1] ?? -1)) r.fail('tile zones not ascending');
      local.push(zi);
    }
    for (let p = 0; p < t.polys.length; p += 1) {
      const li = n > 1 ? r.bounded(n - 1, 'local zone index') : 0;
      zones[base + p] = zoneIds[local[li] ?? 0] ?? 0;
    }
    base += t.polys.length;
  }
  r.end();
  return { mapId, row0, col0, blockStep, tiles, zones };
}
