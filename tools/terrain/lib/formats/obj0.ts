import { chunks, flag, FormatError, vec3, type Vec3 } from './chunked';
import { placementToWorld } from './transform';

/**
 * Object placements of an `obj0` ADT (wowdev.wiki ADT/v18):
 *
 * - `MDDF`, 36 bytes: u32 name (a FileDataID when flag 0x40), u32 unique id, position (ADT
 *   placement space), rotation (degrees), u16 scale (1024 = 1), u16 flags;
 * - `MODF`, 64 bytes: u32 name (a FileDataID when flag 0x8), u32 unique id, position, rotation,
 *   extents (placement space, min then max), u16 flags, u16 doodad set, u16 **name set**, u16
 *   scale (0 or 1024 = 1).
 *
 * Positions and extents are converted to world coordinates (transform.ts). Placements named by
 * an MMID/MWID string index instead of a FileDataID are kept with `nameIsFileDataId` false; the
 * geometry builder refuses them, since resolving names would need a listfile.
 */

export interface Placement {
  readonly kind: 'm2' | 'wmo';
  /** FileDataID, or the legacy name index when `nameIsFileDataId` is false. */
  readonly name: number;
  readonly nameIsFileDataId: boolean;
  readonly uniqueId: number;
  /** World X (north), Y (west), Z (up). */
  readonly position: Vec3;
  /** Rotation in degrees, as stored (a, b, c). */
  readonly rotation: Vec3;
  readonly scale: number;
  readonly flags: number;
  /** WMO only: doodad set and name set; 0 for M2. */
  readonly doodadSet: number;
  readonly nameSet: number;
  /** WMO only: world AABB [xMin, yMin, zMin, xMax, yMax, zMax] from the stored extents. */
  readonly extents: readonly [number, number, number, number, number, number] | null;
}

export const MDDF_NAME_IS_FILEDATAID = 0x40;
export const MODF_NAME_IS_FILEDATAID = 0x8;

export function parseObj0(bytes: Buffer): Placement[] {
  const out: Placement[] = [];
  for (const c of chunks(bytes, 0, bytes.length, 'obj0')) {
    if (c.id === 'MDDF') {
      if (c.size % 36 !== 0) throw new FormatError('obj0: MDDF is not a whole number of 36-byte entries');
      for (let o = c.start; o < c.start + c.size; o += 36) {
        const flags = bytes.readUInt16LE(o + 34);
        const [px, py, pz] = vec3(bytes, o + 8);
        out.push({
          kind: 'm2',
          name: bytes.readUInt32LE(o),
          nameIsFileDataId: flag(flags, MDDF_NAME_IS_FILEDATAID),
          uniqueId: bytes.readUInt32LE(o + 4),
          position: placementToWorld(px, py, pz),
          rotation: vec3(bytes, o + 20),
          scale: bytes.readUInt16LE(o + 32) / 1024,
          flags,
          doodadSet: 0,
          nameSet: 0,
          extents: null,
        });
      }
    } else if (c.id === 'MODF') {
      if (c.size % 64 !== 0) throw new FormatError('obj0: MODF is not a whole number of 64-byte entries');
      for (let o = c.start; o < c.start + c.size; o += 64) {
        const flags = bytes.readUInt16LE(o + 56);
        const [px, py, pz] = vec3(bytes, o + 8);
        const [ax, ay, az] = vec3(bytes, o + 32);
        const [bx, by, bz] = vec3(bytes, o + 44);
        const lo = placementToWorld(ax, ay, az);
        const hi = placementToWorld(bx, by, bz);
        const scale = bytes.readUInt16LE(o + 62);
        out.push({
          kind: 'wmo',
          name: bytes.readUInt32LE(o),
          nameIsFileDataId: flag(flags, MODF_NAME_IS_FILEDATAID),
          uniqueId: bytes.readUInt32LE(o + 4),
          position: placementToWorld(px, py, pz),
          rotation: vec3(bytes, o + 20),
          scale: scale === 0 ? 1 : scale / 1024,
          flags,
          doodadSet: bytes.readUInt16LE(o + 58),
          nameSet: bytes.readUInt16LE(o + 60),
          extents: [Math.min(lo[0], hi[0]), Math.min(lo[1], hi[1]), Math.min(lo[2], hi[2]), Math.max(lo[0], hi[0]), Math.max(lo[1], hi[1]), Math.max(lo[2], hi[2])],
        });
      }
    }
  }
  return out;
}
