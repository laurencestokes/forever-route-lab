/**
 * The chunked ("IFF") layout of WDT, ADT, WMO and M2 files: a four-character id stored reversed,
 * a u32 little-endian size, then the payload (wowdev.wiki "Chunks"). A chunk that runs past its
 * container is a format error: nothing here reads past the end or guesses.
 */

export class FormatError extends Error {
  override readonly name = 'FormatError';
}

export interface Chunk {
  /** The id as usually written (`MCNK`, not the stored `KNCM`). */
  readonly id: string;
  /** Offset of the payload. */
  readonly start: number;
  readonly size: number;
}

export function* chunks(bytes: Buffer, start = 0, end = bytes.length, what = 'file'): Generator<Chunk> {
  let at = start;
  while (at + 8 <= end) {
    const id = String.fromCharCode(bytes.readUInt8(at + 3), bytes.readUInt8(at + 2), bytes.readUInt8(at + 1), bytes.readUInt8(at));
    const size = bytes.readUInt32LE(at + 4);
    if (at + 8 + size > end) throw new FormatError(`${what}: chunk ${id} at ${String(at)} (${String(size)} bytes) runs past the end (${String(end)})`);
    yield { id, start: at + 8, size };
    at += 8 + size;
  }
  if (at !== end) throw new FormatError(`${what}: ${String(end - at)} stray bytes after the last chunk`);
}

/** The first chunk with `id`, or null. */
export function findChunk(bytes: Buffer, id: string, start = 0, end = bytes.length, what = 'file'): Chunk | null {
  for (const c of chunks(bytes, start, end, what)) if (c.id === id) return c;
  return null;
}

/** True when bit value `mask` (a power of two) is set in `value` (no bitwise operators, D-012). */
export function flag(value: number, mask: number): boolean {
  return Math.floor(value / mask) % 2 === 1;
}

/** Reads `count` bits from `bytes` at `offset`, least significant bit of each byte first. */
export function bitList(bytes: Buffer, offset: number, count: number): boolean[] {
  const out: boolean[] = [];
  for (let k = 0; k < count; k += 1) out.push(Math.floor(bytes.readUInt8(offset + Math.floor(k / 8)) / 2 ** (k % 8)) % 2 === 1);
  return out;
}

/** A float32 triple. */
export type Vec3 = readonly [number, number, number];

export function vec3(bytes: Buffer, at: number): Vec3 {
  return [bytes.readFloatLE(at), bytes.readFloatLE(at + 4), bytes.readFloatLE(at + 8)];
}
