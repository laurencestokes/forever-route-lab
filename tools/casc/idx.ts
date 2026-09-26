import { readdirSync, readFileSync } from 'node:fs';
import { keyBytes, xorByte } from './bytes';
import { CascError } from './errors';
import { dataDirectory, INDEX_FILE_NAME, indexPath } from './paths';

/**
 * Local indices, `Data/data/<bucket 00-0f><version>.idx`, version 7 (wowdev.wiki "CASC", local
 * index files):
 *
 * ```
 * u32 headerHashSize, u32 headerHash
 * u16 version (7), u8 bucket, u8 extraBytes (0),
 * u8 sizeBytes (4), u8 offsetBytes (5), u8 keyBytes (9), u8 offsetBits (30), u64 segmentSize
 * (padding to a 16-byte boundary)
 * u32 entriesSize, u32 entriesHash
 * entries: keyBytes of EKey prefix, offsetBytes big-endian (archive = off ÷ 2^offsetBits,
 *          offset = off mod 2^offsetBits), sizeBytes little-endian
 * ```
 *
 * Entries are sorted by key, so a lookup is one binary search in the key's bucket. The bucket of a
 * key is the XOR of its nine prefix bytes, folded to four bits (high nibble XOR low nibble).
 */

export interface IndexEntry {
  /** `data.NNN` archive number. */
  readonly archive: number;
  /** Byte offset of the entry in the archive (its 0x1E local header, when it has one). */
  readonly offset: number;
  /** Stored size in bytes, local header included. */
  readonly size: number;
}

export interface IndexFile {
  readonly bucket: number;
  readonly version: number;
  readonly keyBytes: number;
  readonly offsetBytes: number;
  readonly sizeBytes: number;
  readonly offsetBits: number;
  readonly count: number;
  /** Absolute offset of the first entry in `bytes`. */
  readonly start: number;
  readonly bytes: Buffer;
}

/** Parses one `.idx` file (header and entry table; entries stay in the buffer). */
export function parseIndexFile(bytes: Buffer): IndexFile {
  if (bytes.length < 40) throw new CascError('format', `index file too short (${String(bytes.length)} bytes)`);
  const headerHashSize = bytes.readUInt32LE(0);
  const version = bytes.readUInt16LE(8);
  const bucket = bytes.readUInt8(10);
  const extraBytes = bytes.readUInt8(11);
  const sizeBytes = bytes.readUInt8(12);
  const offsetBytes = bytes.readUInt8(13);
  const keyLength = bytes.readUInt8(14);
  const offsetBits = bytes.readUInt8(15);
  if (version !== 7) throw new CascError('format', `index version ${String(version)}, expected 7`);
  if (extraBytes !== 0 || bucket > 15) throw new CascError('format', `index header: bucket ${String(bucket)}, extra bytes ${String(extraBytes)}`);
  if (keyLength < 1 || keyLength > 16 || offsetBytes < 1 || offsetBytes > 6 || sizeBytes < 1 || sizeBytes > 4 || offsetBits < 1 || offsetBits > 8 * offsetBytes) {
    throw new CascError('format', `index header field sizes key ${String(keyLength)}, offset ${String(offsetBytes)}/${String(offsetBits)} bits, size ${String(sizeBytes)}`);
  }
  const entriesAt = Math.ceil((8 + headerHashSize) / 16) * 16;
  if (entriesAt + 8 > bytes.length) throw new CascError('format', 'index file truncated before its entry table');
  const entriesSize = bytes.readUInt32LE(entriesAt);
  const entryLength = keyLength + offsetBytes + sizeBytes;
  const start = entriesAt + 8;
  if (entriesSize % entryLength !== 0 || start + entriesSize > bytes.length) {
    throw new CascError('format', `index entry table of ${String(entriesSize)} bytes does not fit ${String(entryLength)}-byte entries`);
  }
  return { bucket, version, keyBytes: keyLength, offsetBytes, sizeBytes, offsetBits, count: entriesSize / entryLength, start, bytes };
}

/** The local-index bucket of an EKey: XOR of its first nine bytes, high nibble XOR low nibble. */
export function bucketOfEKey(ekey: Uint8Array): number {
  let x = 0;
  for (let i = 0; i < 9; i += 1) x = xorByte(x, ekey[i] ?? 0);
  return xorByte(x % 16, Math.floor(x / 16));
}

/** Binary search of one parsed index file. */
export function lookupInIndex(file: IndexFile, ekey: Uint8Array): IndexEntry | null {
  const length = file.keyBytes + file.offsetBytes + file.sizeBytes;
  const key = Buffer.from(ekey.buffer, ekey.byteOffset, file.keyBytes);
  let lo = 0;
  let hi = file.count - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const at = file.start + mid * length;
    const order = file.bytes.compare(key, 0, file.keyBytes, at, at + file.keyBytes);
    if (order === 0) {
      const packed = file.bytes.readUIntBE(at + file.keyBytes, file.offsetBytes);
      const span = 2 ** file.offsetBits;
      return {
        archive: Math.floor(packed / span),
        offset: packed % span,
        size: file.bytes.readUIntLE(at + file.keyBytes + file.offsetBytes, file.sizeBytes),
      };
    }
    // `compare` is positive when the entry sorts after the key.
    if (order > 0) hi = mid - 1;
    else lo = mid + 1;
  }
  return null;
}

/** All sixteen buckets of an install, the highest version of each. */
export class LocalIndex {
  private readonly buckets: ReadonlyMap<number, IndexFile>;
  readonly entryCount: number;
  /** The file names read, in bucket order (for reports). */
  readonly files: readonly string[];

  private constructor(buckets: ReadonlyMap<number, IndexFile>, files: readonly string[]) {
    this.buckets = buckets;
    this.files = files;
    let count = 0;
    for (const file of buckets.values()) count += file.count;
    this.entryCount = count;
  }

  static fromFiles(files: ReadonlyMap<string, Buffer>): LocalIndex {
    const best = new Map<number, string>();
    for (const name of files.keys()) {
      const match = INDEX_FILE_NAME.exec(name);
      if (match === null) continue;
      const bucket = Number.parseInt(match[1] ?? '', 16);
      const previous = best.get(bucket);
      if (previous === undefined || previous < name) best.set(bucket, name);
    }
    const buckets = new Map<number, IndexFile>();
    const names: string[] = [];
    for (const [bucket, name] of [...best].sort((a, b) => a[0] - b[0])) {
      const bytes = files.get(name);
      if (bytes === undefined) continue;
      const file = parseIndexFile(bytes);
      if (file.bucket !== bucket) throw new CascError('format', `${name}: header says bucket ${String(file.bucket)}, name says ${String(bucket)}`);
      buckets.set(bucket, file);
      names.push(name);
    }
    if (buckets.size === 0) throw new CascError('missing', 'no local index files');
    return new LocalIndex(buckets, names);
  }

  /** Reads the newest `.idx` file of every bucket from `Data/data`. */
  static read(install: string): LocalIndex {
    const files = new Map<string, Buffer>();
    const names = readdirSync(dataDirectory(install)).filter((name) => INDEX_FILE_NAME.test(name));
    const newest = new Map<string, string>();
    for (const name of names) {
      const bucket = name.slice(0, 2);
      const previous = newest.get(bucket);
      if (previous === undefined || previous < name) newest.set(bucket, name);
    }
    for (const name of newest.values()) files.set(name, readFileSync(indexPath(install, name)));
    return LocalIndex.fromFiles(files);
  }

  /** The local entry of an EKey (hex or bytes), or null when this install does not store it. */
  lookup(ekey: string | Uint8Array): IndexEntry | null {
    const key = typeof ekey === 'string' ? keyBytes(ekey, 'EKey') : ekey;
    const file = this.buckets.get(bucketOfEKey(key));
    return file === undefined ? null : lookupInIndex(file, key);
  }
}
