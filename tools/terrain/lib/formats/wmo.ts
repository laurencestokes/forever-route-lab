import { chunks, flag, FormatError, vec3, type Vec3 } from './chunked';
import { parseMliq, type WmoLiquid } from './liquid';

/**
 * WMO root and group files (wowdev.wiki WMO; terrain-navigation.md §3.4).
 *
 * Root: `MOHD` (u32 group count at +0x04, **WMO ID** at +0x20 (the `WMOAreaTable.WMOID` key),
 * bounding box at +0x24, flags u16 at +0x3C); `GFID` group FileDataIDs, group count × LOD levels,
 * of which the first group-count entries are LOD 0; `MOGN` group names; `MODS` doodad sets (name,
 * first index, count); `MODI` doodad FileDataIDs; `MODD` doodads (u24 name index + u8 flags,
 * position, quaternion (x, y, z, w), scale, colour).
 *
 * Group: `MOGP`, a 0x44-byte header (name offset +0x00, flags +0x08, bounding box +0x0C, group
 * liquid +0x34, **WMOGroupID** +0x38) followed by sub-chunks: `MOPY` (u8 flags, u8 material) or
 * `MPY2` (u16, u16) per triangle, `MOVI` (u16) or `MOVX` (u32) indices, `MOVT` vertices, `MLIQ`.
 *
 * Collision follows TrinityCore's published rule (read for the rule only, nothing copied): a
 * triangle collides when its flags have COLLISION (0x08), or RENDER (0x20) without DETAIL (0x04).
 * A group is skipped when MOGP has 0x80 (unreachable) or 0x4000000 (antiportal), or its name is
 * "antiportal".
 */

export interface WmoDoodad {
  readonly nameIndex: number;
  readonly flags: number;
  readonly position: Vec3;
  /** Quaternion (x, y, z, w). */
  readonly rotation: readonly [number, number, number, number];
  readonly scale: number;
}

export interface WmoDoodadSet {
  readonly name: string;
  readonly start: number;
  readonly count: number;
}

export interface WmoRoot {
  readonly groupCount: number;
  readonly flags: number;
  /** `MOHD` WMO ID, the key of `WMOAreaTable.WMOID`. */
  readonly wmoId: number;
  readonly boundsMin: Vec3;
  readonly boundsMax: Vec3;
  /** LOD 0 group FileDataIDs (0 where a group has no file). */
  readonly groupFileDataIds: readonly number[];
  readonly doodadSets: readonly WmoDoodadSet[];
  readonly doodadFileDataIds: readonly number[];
  readonly doodads: readonly WmoDoodad[];
  /** The raw `MOGN` block (NUL-separated names). */
  readonly groupNames: Buffer;
}

export function parseWmoRoot(bytes: Buffer): WmoRoot {
  let mohd: { start: number; size: number } | null = null;
  const gfid: number[] = [];
  const doodadSets: WmoDoodadSet[] = [];
  const doodadFileDataIds: number[] = [];
  const doodads: WmoDoodad[] = [];
  let groupNames: Buffer = Buffer.alloc(0);
  for (const c of chunks(bytes, 0, bytes.length, 'WMO root')) {
    const o = c.start;
    if (c.id === 'MOHD') mohd = c;
    else if (c.id === 'GFID') for (let i = 0; i + 4 <= c.size; i += 4) gfid.push(bytes.readUInt32LE(o + i));
    else if (c.id === 'MOGN') groupNames = bytes.subarray(o, o + c.size);
    else if (c.id === 'MODS') {
      for (let i = 0; i + 32 <= c.size; i += 32) {
        const name = bytes.toString('latin1', o + i, o + i + 20);
        const nul = name.indexOf('\0');
        doodadSets.push({ name: nul < 0 ? name : name.slice(0, nul), start: bytes.readUInt32LE(o + i + 20), count: bytes.readUInt32LE(o + i + 24) });
      }
    } else if (c.id === 'MODI') {
      for (let i = 0; i + 4 <= c.size; i += 4) doodadFileDataIds.push(bytes.readUInt32LE(o + i));
    } else if (c.id === 'MODD') {
      if (c.size % 40 !== 0) throw new FormatError('WMO root: MODD is not a whole number of 40-byte entries');
      for (let d = o; d < o + c.size; d += 40) {
        doodads.push({
          nameIndex: bytes.readUIntLE(d, 3),
          flags: bytes.readUInt8(d + 3),
          position: vec3(bytes, d + 4),
          rotation: [bytes.readFloatLE(d + 16), bytes.readFloatLE(d + 20), bytes.readFloatLE(d + 24), bytes.readFloatLE(d + 28)],
          scale: bytes.readFloatLE(d + 32),
        });
      }
    }
  }
  if (mohd === null || mohd.size < 0x40) throw new FormatError('WMO root: MOHD is missing or truncated');
  const groupCount = bytes.readUInt32LE(mohd.start + 4);
  if (gfid.length < groupCount) throw new FormatError(`WMO root: GFID has ${String(gfid.length)} entries for ${String(groupCount)} groups (only FileDataID-named WMOs are supported)`);
  return {
    groupCount,
    flags: bytes.readUInt16LE(mohd.start + 0x3c),
    wmoId: bytes.readUInt32LE(mohd.start + 0x20),
    boundsMin: vec3(bytes, mohd.start + 0x24),
    boundsMax: vec3(bytes, mohd.start + 0x30),
    groupFileDataIds: gfid.slice(0, groupCount),
    doodadSets,
    doodadFileDataIds,
    doodads,
    groupNames,
  };
}

/** The name at `offset` in a root's `MOGN` block, or '' when out of range. */
export function groupName(root: WmoRoot, offset: number): string {
  if (offset < 0 || offset >= root.groupNames.length) return '';
  const end = root.groupNames.indexOf(0, offset);
  return root.groupNames.toString('latin1', offset, end < 0 ? root.groupNames.length : end);
}

export const MOGP_UNREACHABLE = 0x80;
export const MOGP_ANTIPORTAL = 0x4000000;
export const MOPY_DETAIL = 0x04;
export const MOPY_COLLISION = 0x08;
export const MOPY_RENDER = 0x20;

/** TrinityCore's collision rule for one triangle's material flags. */
export function isCollisionTriangle(flags: number): boolean {
  return flag(flags, MOPY_COLLISION) || (flag(flags, MOPY_RENDER) && !flag(flags, MOPY_DETAIL));
}

export interface WmoGroup {
  readonly nameOffset: number;
  readonly flags: number;
  readonly groupLiquid: number;
  /** `MOGP` WMOGroupID, the key of `WMOAreaTable.WMOGroupID`. */
  readonly wmoGroupId: number;
  /** MOGP flags 0x80 or 0x4000000 (the name rule needs the root: `skipGroup`). */
  readonly skippedByFlags: boolean;
  readonly triangleCount: number;
  /** Model-space vertices, xyz. */
  readonly vertices: Float32Array;
  /** Index triples of the collision triangles only (empty when the group is skipped by flags). */
  readonly collision: Uint32Array;
  readonly liquid: WmoLiquid | null;
}

export function parseWmoGroup(bytes: Buffer): WmoGroup {
  let mogp: { start: number; size: number } | null = null;
  for (const c of chunks(bytes, 0, bytes.length, 'WMO group')) if (c.id === 'MOGP') mogp = c;
  if (mogp === null || mogp.size < 0x44) throw new FormatError('WMO group: MOGP is missing or truncated');
  const o = mogp.start;
  const flags = bytes.readUInt32LE(o + 8);
  let materials: { start: number; size: number; stride: number } | null = null;
  let indices: Uint32Array | null = null;
  let vertices: Float32Array | null = null;
  let liquid: WmoLiquid | null = null;
  for (const c of chunks(bytes, o + 0x44, o + mogp.size, 'MOGP')) {
    if (c.id === 'MOPY' && materials === null) materials = { start: c.start, size: c.size, stride: 2 };
    else if (c.id === 'MPY2' && materials === null) materials = { start: c.start, size: c.size, stride: 4 };
    else if (c.id === 'MOVI' && indices === null) {
      indices = new Uint32Array(c.size / 2);
      for (let i = 0; i < indices.length; i += 1) indices[i] = bytes.readUInt16LE(c.start + i * 2);
    } else if (c.id === 'MOVX' && indices === null) {
      indices = new Uint32Array(c.size / 4);
      for (let i = 0; i < indices.length; i += 1) indices[i] = bytes.readUInt32LE(c.start + i * 4);
    } else if (c.id === 'MOVT' && vertices === null) {
      vertices = new Float32Array(c.size / 4);
      for (let i = 0; i < vertices.length; i += 1) vertices[i] = bytes.readFloatLE(c.start + i * 4);
    } else if (c.id === 'MLIQ') {
      liquid = parseMliq(bytes, c.start, c.size);
    }
  }
  const triangleCount = indices === null ? 0 : Math.floor(indices.length / 3);
  const skippedByFlags = flag(flags, MOGP_UNREACHABLE) || flag(flags, MOGP_ANTIPORTAL);
  const keep: number[] = [];
  if (materials !== null && indices !== null && !skippedByFlags) {
    if (materials.size / materials.stride !== triangleCount) {
      throw new FormatError(`WMO group: ${String(materials.size / materials.stride)} triangle materials for ${String(triangleCount)} triangles`);
    }
    const vertexCount = vertices === null ? 0 : vertices.length / 3;
    for (let t = 0; t < triangleCount; t += 1) {
      const f = materials.stride === 2 ? bytes.readUInt8(materials.start + t * 2) : bytes.readUInt16LE(materials.start + t * 4);
      if (!isCollisionTriangle(f)) continue;
      const a = indices[t * 3] ?? 0;
      const b = indices[t * 3 + 1] ?? 0;
      const c = indices[t * 3 + 2] ?? 0;
      if (a >= vertexCount || b >= vertexCount || c >= vertexCount) throw new FormatError('WMO group: a triangle index is past the vertex list');
      keep.push(a, b, c);
    }
  }
  return {
    nameOffset: bytes.readUInt32LE(o),
    flags,
    groupLiquid: bytes.readUInt32LE(o + 0x34),
    wmoGroupId: bytes.readInt32LE(o + 0x38),
    skippedByFlags,
    triangleCount,
    vertices: vertices ?? new Float32Array(0),
    collision: Uint32Array.from(keep),
    liquid,
  };
}

/** TrinityCore's skip rule: flags 0x80 or 0x4000000, or a group named "antiportal". */
export function skipGroup(root: WmoRoot, group: WmoGroup): boolean {
  return group.skippedByFlags || groupName(root, group.nameOffset) === 'antiportal';
}
