import { inflateSync } from 'node:zlib';
import { hexOf, md5Hex, type ByteRange } from './bytes';
import { CascError } from './errors';

/**
 * BLTE (wowdev.wiki "BLTE"):
 *
 * ```
 * 'BLTE', u32 BE headerSize
 * headerSize > 0: u8 flags (0x0F), u24 BE chunkCount,
 *                 chunkCount × (u32 BE compressedSize, u32 BE decodedSize, 16-byte MD5 of the chunk)
 * headerSize = 0: one chunk, the rest of the data
 * chunk: u8 mode, payload
 *   'N' plain; 'Z' zlib; 'E' encrypted: u8 keyNameSize (8), key name (8 bytes, little-endian),
 *   u8 ivSize, iv, u8 type ('S' Salsa20 or 'A' ARC4), ciphertext; 'F' (nested frame) is refused.
 * ```
 *
 * Encrypted chunks are never decrypted. They are zero-filled at their decoded size and reported
 * (`encryptedRanges`), so a caller can skip exactly those bytes (DB2 sections) or refuse the file
 * (navigation inputs, `LocalCasc.file`). A single-chunk file has no size table, so an encrypted
 * single chunk is refused outright.
 */

export type BlteMode = 'N' | 'Z' | 'E';

export interface BlteChunk {
  readonly mode: BlteMode;
  readonly encodedSize: number;
  readonly decodedSize: number;
  /** Offset of this chunk's bytes in the decoded output. */
  readonly decodedOffset: number;
  /** For `E` chunks: the TACT key name, as the usual big-endian hex of the little-endian u64. */
  readonly keyName: string | null;
}

export interface BlteResult {
  readonly data: Buffer;
  readonly chunks: readonly BlteChunk[];
  /** Zero-filled ranges of `data` (one per encrypted chunk), in order. */
  readonly encryptedRanges: readonly ByteRange[];
  /** Distinct TACT key names of the encrypted chunks. */
  readonly keyNames: readonly string[];
}

export interface BlteOptions {
  /** Check each chunk's MD5 against the chunk table (default true). */
  readonly verifyChunks?: boolean;
}

interface TableEntry {
  readonly encodedSize: number;
  readonly decodedSize: number;
  readonly checksum: string | null;
}

export function decodeBlte(raw: Uint8Array, options: BlteOptions = {}): BlteResult {
  const bytes = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  if (bytes.length < 8 || bytes.toString('latin1', 0, 4) !== 'BLTE') throw new CascError('format', 'not a BLTE stream');
  const headerSize = bytes.readUInt32BE(4);
  const table: TableEntry[] = [];
  let position = 8;
  if (headerSize > 0) {
    if (headerSize < 12 || headerSize > bytes.length) throw new CascError('format', `BLTE header size ${String(headerSize)} is out of range`);
    const flags = bytes.readUInt8(8);
    if (flags !== 0x0f) throw new CascError('format', `BLTE chunk-table flags 0x${flags.toString(16)}, expected 0x0f`);
    const count = bytes.readUIntBE(9, 3);
    if (12 + count * 24 !== headerSize) throw new CascError('format', `BLTE header of ${String(headerSize)} bytes does not hold ${String(count)} chunk entries`);
    for (let i = 0; i < count; i += 1) {
      const at = 12 + i * 24;
      table.push({ encodedSize: bytes.readUInt32BE(at), decodedSize: bytes.readUInt32BE(at + 4), checksum: hexOf(bytes, at + 8, 16) });
    }
    position = headerSize;
  } else {
    table.push({ encodedSize: bytes.length - 8, decodedSize: -1, checksum: null });
  }
  const verify = options.verifyChunks ?? true;
  const parts: Buffer[] = [];
  const chunks: BlteChunk[] = [];
  const encryptedRanges: ByteRange[] = [];
  const keyNames = new Set<string>();
  let decodedOffset = 0;
  for (const [index, entry] of table.entries()) {
    const end = position + entry.encodedSize;
    if (entry.encodedSize < 1 || end > bytes.length) throw new CascError('format', `BLTE chunk ${String(index)} runs past the end of the stream`);
    const chunk = bytes.subarray(position, end);
    position = end;
    if (verify && entry.checksum !== null && md5Hex(chunk) !== entry.checksum) {
      throw new CascError('integrity', `BLTE chunk ${String(index)} checksum mismatch`);
    }
    const mode = String.fromCharCode(chunk.readUInt8(0));
    let decoded: Buffer;
    let keyName: string | null = null;
    if (mode === 'N') {
      decoded = chunk.subarray(1);
    } else if (mode === 'Z') {
      try {
        decoded = inflateSync(chunk.subarray(1));
      } catch (error) {
        throw new CascError('format', `BLTE chunk ${String(index)}: zlib stream is invalid (${error instanceof Error ? error.message : String(error)})`);
      }
    } else if (mode === 'E') {
      keyName = encryptedKeyName(chunk, index);
      if (entry.decodedSize < 0) throw new CascError('encrypted', 'single-chunk BLTE stream is encrypted; its decoded size is unknown');
      decoded = Buffer.alloc(entry.decodedSize);
      encryptedRanges.push({ start: decodedOffset, end: decodedOffset + entry.decodedSize });
      keyNames.add(keyName);
    } else if (mode === 'F') {
      throw new CascError('format', `BLTE chunk ${String(index)} is a nested frame ('F'), which this reader does not support`);
    } else {
      throw new CascError('format', `BLTE chunk ${String(index)} has unknown mode 0x${chunk.readUInt8(0).toString(16)}`);
    }
    if (entry.decodedSize >= 0 && decoded.length !== entry.decodedSize) {
      throw new CascError('format', `BLTE chunk ${String(index)} decoded to ${String(decoded.length)} bytes, table says ${String(entry.decodedSize)}`);
    }
    chunks.push({ mode, encodedSize: entry.encodedSize, decodedSize: decoded.length, decodedOffset, keyName });
    parts.push(decoded);
    decodedOffset += decoded.length;
  }
  if (position !== bytes.length) throw new CascError('format', `BLTE stream has ${String(bytes.length - position)} trailing bytes`);
  return { data: parts.length === 1 ? (parts[0] ?? Buffer.alloc(0)) : Buffer.concat(parts), chunks, encryptedRanges, keyNames: [...keyNames] };
}

function encryptedKeyName(chunk: Buffer, index: number): string {
  if (chunk.length < 12) throw new CascError('format', `BLTE chunk ${String(index)}: encrypted header truncated`);
  const nameSize = chunk.readUInt8(1);
  if (nameSize !== 8) throw new CascError('format', `BLTE chunk ${String(index)}: key name size ${String(nameSize)}, expected 8`);
  const name = Buffer.from(chunk.subarray(2, 10)).reverse();
  const ivSize = chunk.readUInt8(10);
  const typeAt = 11 + ivSize;
  if (typeAt >= chunk.length) throw new CascError('format', `BLTE chunk ${String(index)}: encrypted header truncated`);
  const type = String.fromCharCode(chunk.readUInt8(typeAt));
  if (type !== 'S' && type !== 'A') throw new CascError('format', `BLTE chunk ${String(index)}: unknown encryption type "${type}"`);
  return name.toString('hex');
}
