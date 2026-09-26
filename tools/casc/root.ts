import { hasFlag, hexOf } from './bytes';
import { CascError } from './errors';

/**
 * The root manifest, `TSFM` ("MFST" read little-endian) version 2 (wowdev.wiki "TACT", root):
 *
 * ```
 * 'TSFM', u32 headerSize, u32 version (2), u32 totalFileCount, u32 namedFileCount, u32 (0)
 * blocks until the end:
 *   u32 count, u32 localeFlags, u32 contentFlags1, u32 contentFlags2, u8 contentFlags3
 *   count × i32 FileDataID delta (first = delta; next = previous + 1 + delta)
 *   count × 16-byte CKey
 *   count × u64 name hash, absent when the block has NoNameHash (0x10000000) and
 *     totalFileCount ≠ namedFileCount
 * ```
 *
 * A block's content flags are contentFlags1 | contentFlags2 | (contentFlags3 << 17); a flag is set
 * when any of the three words carries it. For each FileDataID the first entry in file order that
 * is enUS (locale 0x2) and not LowViolence (0x80) is kept. The result is stored as sorted typed
 * arrays (FileDataIDs, CKeys, a flag byte), never as a map of strings: the first prototype's
 * `Map<number, {ckey: string}>` cost about 500 MB of RSS.
 */

export const LOCALE_ENUS = 0x2;
export const CONTENT_LOW_VIOLENCE = 0x80;
export const CONTENT_ENCRYPTED = 0x8000000;
export const CONTENT_NO_NAME_HASH = 0x10000000;

export interface RootStats {
  readonly blocks: number;
  /** Entries over all blocks and locales. */
  readonly entries: number;
  /** Distinct FileDataIDs kept (enUS, not LowViolence). */
  readonly fileDataIds: number;
  /** Distinct FileDataIDs that carry the Encrypted content flag in any block. */
  readonly encryptedFlagFileDataIds: number;
}

const blockFlag = (c1: number, c2: number, c3: number, mask: number): boolean =>
  hasFlag(c1, mask) || hasFlag(c2, mask) || hasFlag(c3 * 2 ** 17, mask);

export class RootManifest {
  /** Sorted, distinct. */
  private readonly ids: Uint32Array;
  /** 16 bytes per entry of `ids`. */
  private readonly ckeys: Uint8Array;
  /** 1 when the kept entry's block has the Encrypted flag. */
  private readonly encrypted: Uint8Array;
  readonly stats: RootStats;

  private constructor(ids: Uint32Array, ckeys: Uint8Array, encrypted: Uint8Array, stats: RootStats) {
    this.ids = ids;
    this.ckeys = ckeys;
    this.encrypted = encrypted;
    this.stats = stats;
  }

  static parse(bytes: Buffer): RootManifest {
    if (bytes.length < 24 || bytes.toString('latin1', 0, 4) !== 'TSFM') throw new CascError('format', 'root manifest has no TSFM magic (only MFST version 2 is supported)');
    const headerSize = bytes.readUInt32LE(4);
    const version = bytes.readUInt32LE(8);
    const total = bytes.readUInt32LE(12);
    const named = bytes.readUInt32LE(16);
    if (version !== 2) throw new CascError('format', `root manifest version ${String(version)}, expected 2`);
    if (headerSize < 24 || headerSize > bytes.length) throw new CascError('format', `root header size ${String(headerSize)} is out of range`);
    const namelessAllowed = total !== named;

    interface Block {
      readonly at: number;
      readonly count: number;
      readonly keep: boolean;
      readonly encrypted: boolean;
      readonly hashes: boolean;
    }
    const blocks: Block[] = [];
    let candidates = 0;
    let entries = 0;
    for (let at = headerSize; at < bytes.length; ) {
      if (at + 17 > bytes.length) throw new CascError('format', 'root block header truncated');
      const count = bytes.readUInt32LE(at);
      const locale = bytes.readUInt32LE(at + 4);
      const c1 = bytes.readUInt32LE(at + 8);
      const c2 = bytes.readUInt32LE(at + 12);
      const c3 = bytes.readUInt8(at + 16);
      const hashes = !(namelessAllowed && blockFlag(c1, c2, c3, CONTENT_NO_NAME_HASH));
      const keep = hasFlag(locale, LOCALE_ENUS) && !blockFlag(c1, c2, c3, CONTENT_LOW_VIOLENCE);
      const block: Block = { at: at + 17, count, keep, encrypted: blockFlag(c1, c2, c3, CONTENT_ENCRYPTED), hashes };
      at = block.at + count * (4 + 16 + (hashes ? 8 : 0));
      if (at > bytes.length) throw new CascError('format', `root block of ${String(count)} entries runs past the end`);
      blocks.push(block);
      entries += count;
      if (keep) candidates += count;
    }

    // Stable selection of the first kept entry per FileDataID: sort (id, sequence) packed in a
    // float64 (ids < 2^31, sequence < 2^22), then take the first of each run.
    const span = 2 ** Math.max(1, Math.ceil(Math.log2(candidates + 1)));
    if (span > 2 ** 22) throw new CascError('format', `root has ${String(candidates)} candidate entries, more than this reader packs`);
    const packed = new Float64Array(candidates);
    const ckeyAt = new Uint32Array(candidates);
    const flagged = new Uint8Array(candidates);
    const encryptedIds: number[] = [];
    let sequence = 0;
    for (const block of blocks) {
      let id = -1;
      const ckeysAt = block.at + block.count * 4;
      for (let i = 0; i < block.count; i += 1) {
        id = id + 1 + bytes.readInt32LE(block.at + i * 4);
        if (id < 0 || id >= 2 ** 31) throw new CascError('format', `root FileDataID ${String(id)} out of range`);
        if (block.encrypted) encryptedIds.push(id);
        if (!block.keep) continue;
        packed[sequence] = id * span + sequence;
        ckeyAt[sequence] = ckeysAt + i * 16;
        flagged[sequence] = block.encrypted ? 1 : 0;
        sequence += 1;
      }
    }
    packed.sort();
    let distinct = 0;
    let previous = -1;
    for (const key of packed) {
      const id = Math.floor(key / span);
      if (id !== previous) distinct += 1;
      previous = id;
    }
    const ids = new Uint32Array(distinct);
    const ckeys = new Uint8Array(distinct * 16);
    const encrypted = new Uint8Array(distinct);
    let out = -1;
    previous = -1;
    for (const key of packed) {
      const id = Math.floor(key / span);
      if (id === previous) continue;
      previous = id;
      out += 1;
      const seq = key % span;
      ids[out] = id;
      ckeys.set(bytes.subarray(ckeyAt[seq] ?? 0, (ckeyAt[seq] ?? 0) + 16), out * 16);
      encrypted[out] = flagged[seq] ?? 0;
    }
    encryptedIds.sort((a, b) => a - b);
    let encryptedDistinct = 0;
    for (let i = 0; i < encryptedIds.length; i += 1) if (i === 0 || encryptedIds[i] !== encryptedIds[i - 1]) encryptedDistinct += 1;
    return new RootManifest(ids, ckeys, encrypted, { blocks: blocks.length, entries, fileDataIds: distinct, encryptedFlagFileDataIds: encryptedDistinct });
  }

  get size(): number {
    return this.ids.length;
  }

  private indexOf(fileDataId: number): number {
    let lo = 0;
    let hi = this.ids.length - 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const value = this.ids[mid] ?? 0;
      if (value === fileDataId) return mid;
      if (value < fileDataId) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  has(fileDataId: number): boolean {
    return this.indexOf(fileDataId) >= 0;
  }

  /** The kept entry's CKey (hex), or null when the manifest has no enUS entry for the id. */
  ckey(fileDataId: number): string | null {
    const index = this.indexOf(fileDataId);
    return index < 0 ? null : hexOf(this.ckeys, index * 16, 16);
  }

  /** True when the kept entry's block carries the root Encrypted content flag. */
  encryptedFlag(fileDataId: number): boolean {
    const index = this.indexOf(fileDataId);
    return index >= 0 && this.encrypted[index] === 1;
  }

  /** The kept FileDataIDs, ascending (a copy). */
  fileDataIds(): Uint32Array {
    return this.ids.slice();
  }
}
