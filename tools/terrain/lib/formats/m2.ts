import { FormatError } from './chunked';

/**
 * M2 collision (wowdev.wiki M2): the `MD20` header, either at the start of a legacy file or as the
 * payload of the leading `MD21` chunk of a chunked one (whose ids, unlike ADT and WMO chunk ids,
 * are not stored reversed). Offsets inside the header are from the `MD20` magic:
 *
 * - 0xD4 f32 collision sphere radius;
 * - 0xD8 M2Array collision indices (u32 count, u32 offset; u16 elements);
 * - 0xE0 M2Array collision positions (u32 count, u32 offset; 3 × f32 elements).
 *
 * Collision triangles are counter-clockwise seen from outside (§3.4).
 */

export interface M2Collision {
  /** Model-space vertices, xyz. */
  readonly vertices: Float32Array;
  /** Index triples. */
  readonly triangles: Uint32Array;
  readonly radius: number;
}

export function parseM2Collision(bytes: Buffer): M2Collision {
  let base = -1;
  let end = bytes.length;
  const magic = bytes.length >= 8 ? bytes.toString('latin1', 0, 4) : '';
  if (magic === 'MD20') base = 0;
  else if (magic === 'MD21') {
    // Chunked M2 files store their chunk ids in reading order ("MD21"), unlike ADT and WMO files;
    // the MD21 chunk comes first and holds the whole legacy MD20 data.
    base = 8;
    end = 8 + bytes.readUInt32LE(4);
    if (end > bytes.length) throw new FormatError('M2: the MD21 chunk runs past the end');
  }
  if (base < 0 || base + 0xe8 > end || bytes.toString('latin1', base, base + 4) !== 'MD20') throw new FormatError('M2: no MD20 header');
  const indexCount = bytes.readUInt32LE(base + 0xd8);
  const indexOffset = bytes.readUInt32LE(base + 0xdc);
  const positionCount = bytes.readUInt32LE(base + 0xe0);
  const positionOffset = bytes.readUInt32LE(base + 0xe4);
  if (indexCount % 3 !== 0) throw new FormatError(`M2: ${String(indexCount)} collision indices is not a whole number of triangles`);
  if (base + indexOffset + indexCount * 2 > end || base + positionOffset + positionCount * 12 > end) throw new FormatError('M2: collision arrays run past the MD20 data');
  const triangles = new Uint32Array(indexCount);
  for (let i = 0; i < indexCount; i += 1) {
    const v = bytes.readUInt16LE(base + indexOffset + i * 2);
    if (v >= positionCount) throw new FormatError('M2: a collision index is past the position list');
    triangles[i] = v;
  }
  const vertices = new Float32Array(positionCount * 3);
  for (let i = 0; i < positionCount * 3; i += 1) vertices[i] = bytes.readFloatLE(base + positionOffset + i * 4);
  return { vertices, triangles, radius: bytes.readFloatLE(base + 0xd4) };
}
