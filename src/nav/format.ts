import { ByteReader } from './bytes';
import { blockSpan, blockTileOrigin, type NavParams } from './grid';

/**
 * Decoder of block format v3 (terrain-navigation.md §5), one file per 4×4-ADT block,
 * `public/nav/<mapId>/<row0>_<col0>.bin`:
 *
 * ```
 * 'FRN3'  u8 version = 3
 * varint mapId, varint row0, varint col0
 * zig    blockStep
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
 * Strict: every rule `tools/terrain/lib/encode.ts` checks when it decodes is checked here, and a
 * violation throws `NavFormatError`. The result is flat typed arrays over the whole block (tile
 * vertices concatenated), ready for `mesh.ts`. A block has no component stream (RC-03): components
 * are per map, in `map.bin` (mapfile.ts).
 */

export const BLOCK_MAGIC = 'FRN3';
export const BLOCK_VERSION = 3;
export const ATTRIBUTE_MODE = 3;
export const MAX_POLY_VERTS = 12;

export interface DecodedBlock {
  readonly mapId: number;
  readonly row0: number;
  readonly col0: number;
  readonly blockStep: number;
  readonly tileCount: number;
  /** Recast tile coordinates of each tile, in file order (ascending tx, then tz). */
  readonly tileTx: Int32Array;
  readonly tileTz: Int32Array;
  readonly tileOriginStep: Int32Array;
  /** First block vertex of each tile, plus the total. */
  readonly tileVertBase: Int32Array;
  /** First block polygon of each tile, plus the total. */
  readonly tilePolyBase: Int32Array;
  /** Voxel (x, y, z) per vertex, tile vertices concatenated: x, z in 0..tileVoxels, y ≥ 0. */
  readonly verts: Int32Array;
  /** Slots of each polygon: polyFirst[p] .. polyFirst[p + 1] − 1 index slotVert. */
  readonly polyFirst: Int32Array;
  /** Block vertex index of each polygon slot, in Recast's vertex order. */
  readonly slotVert: Int32Array;
  /** 1 for a swim polygon, 0 for ground. */
  readonly swim: Uint8Array;
  /** Top-level zone (AreaTable id) per polygon. */
  readonly zones: Int32Array;
  readonly polygons: number;
}

/** Decodes and checks one block against the grid of `P`. */
export function decodeBlock(bytes: Uint8Array, P: NavParams, what = 'nav block'): DecodedBlock {
  const r = new ByteReader(bytes, what);
  if (r.ascii(4) !== BLOCK_MAGIC) r.fail('not a FRN3 block');
  const version = r.byte();
  if (version !== BLOCK_VERSION) r.fail(`version ${String(version)}, expected ${String(BLOCK_VERSION)}`);
  const mapId = r.u();
  const row0 = r.bounded(63, 'row0');
  const col0 = r.bounded(63, 'col0');
  if (row0 % P.blockAdts !== 0 || col0 % P.blockAdts !== 0) r.fail(`block ${String(row0)}_${String(col0)} is not on the ${String(P.blockAdts)}-ADT grid`);
  const blockStep = r.z();
  const span = blockSpan(P);
  const tileCount = r.bounded(span * span, 'tile count');
  const { tx0, tz0 } = blockTileOrigin(P, row0, col0);
  const tileTx = new Int32Array(tileCount);
  const tileTz = new Int32Array(tileCount);
  const tileOriginStep = new Int32Array(tileCount);
  const tileVertBase = new Int32Array(tileCount + 1);
  const tilePolyBase = new Int32Array(tileCount + 1);
  const verts: number[] = [];
  const polyFirst: number[] = [0];
  const slotVert: number[] = [];
  const swim: number[] = [];
  let last = -1;
  for (let i = 0; i < tileCount; i += 1) {
    const dtx = r.bounded(span - 1, 'dtx');
    const dtz = r.bounded(span - 1, 'dtz');
    if (dtx * span + dtz <= last) r.fail('tiles out of order');
    last = dtx * span + dtz;
    const originStep = r.z();
    const nv = r.bounded(0xfffe, 'vertex count');
    const np = r.bounded(0xfffe, 'polygon count');
    if (np === 0) r.fail('empty tile');
    const vBase = verts.length / 3;
    tileTx[i] = tx0 + dtx;
    tileTz[i] = tz0 + dtz;
    tileOriginStep[i] = originStep;
    tileVertBase[i] = vBase;
    tilePolyBase[i] = swim.length;
    let px = 0;
    let py = 0;
    let pz = 0;
    for (let v = 0; v < nv; v += 1) {
      px += r.z();
      pz += r.z();
      py += r.z();
      if (px < 0 || px > P.tileVoxels || pz < 0 || pz > P.tileVoxels || py < 0 || py > 0xffff) r.fail(`vertex ${String(v)} outside the tile`);
      verts.push(px, py, pz);
    }
    let prev = 0;
    for (let p = 0; p < np; p += 1) {
      const header = r.byte();
      const k = Math.floor(header / 2) + 3;
      if (k > MAX_POLY_VERTS) r.fail(`polygon with ${String(k)} vertices`);
      swim.push(header % 2);
      for (let j = 0; j < k; j += 1) {
        prev += r.z();
        if (prev < 0 || prev >= nv) r.fail(`vertex index ${String(prev)} of ${String(nv)}`);
        slotVert.push(vBase + prev);
      }
      polyFirst.push(slotVert.length);
    }
  }
  tileVertBase[tileCount] = verts.length / 3;
  tilePolyBase[tileCount] = swim.length;
  const total = swim.length;
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
  for (let t = 0; t < tileCount; t += 1) {
    const n = r.bounded(zoneCount, 'tile zone count');
    if (n === 0) r.fail('tile without zones');
    const local: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const zi = r.bounded(zoneCount - 1, 'zone index');
      if (i > 0 && zi <= (local[i - 1] ?? -1)) r.fail('tile zones not ascending');
      local.push(zi);
    }
    for (let p = tilePolyBase[t] ?? 0; p < (tilePolyBase[t + 1] ?? 0); p += 1) {
      const li = n > 1 ? r.bounded(n - 1, 'local zone index') : 0;
      zones[p] = zoneIds[local[li] ?? 0] ?? 0;
    }
  }
  r.end();
  return {
    mapId,
    row0,
    col0,
    blockStep,
    tileCount,
    tileTx,
    tileTz,
    tileOriginStep,
    tileVertBase,
    tilePolyBase,
    verts: Int32Array.from(verts),
    polyFirst: Int32Array.from(polyFirst),
    slotVert: Int32Array.from(slotVert),
    swim: Uint8Array.from(swim),
    zones,
    polygons: total,
  };
}
