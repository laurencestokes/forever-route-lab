import { hexOf, keyBytes, md5Hex } from './bytes';
import { CascError } from './errors';

/**
 * The encoding table (wowdev.wiki "TACT", encoding file), decoded from BLTE:
 *
 * ```
 * 'EN', u8 version (1), u8 ckeySize (16), u8 ekeySize (16),
 * u16 BE ckeyPageKB, u16 BE especPageKB, u32 BE ckeyPageCount, u32 BE especPageCount,
 * u8 (0), u32 BE especBlockSize                                  (22 bytes)
 * especBlockSize bytes of ESpec strings
 * ckeyPageCount × (first CKey, MD5 of the page)                  (page index)
 * ckeyPageCount pages of ckeyPageKB × 1024 bytes:
 *   entries (u8 ekeyCount, u40 BE decoded size, CKey, ekeyCount × EKey) until ekeyCount = 0
 * ```
 *
 * A lookup is a binary search over the page index, then a scan of one page. Each page is checked
 * against its MD5 the first time it is used.
 */

export interface EncodingHit {
  /** The first EKey of the content key. */
  readonly ekey: string;
  /** Decoded (content) size in bytes. */
  readonly size: number;
}

export class EncodingTable {
  private readonly bytes: Buffer;
  private readonly indexAt: number;
  private readonly pagesAt: number;
  private readonly pageSize: number;
  readonly pageCount: number;
  private readonly checkedPages = new Set<number>();

  private constructor(bytes: Buffer, indexAt: number, pagesAt: number, pageSize: number, pageCount: number) {
    this.bytes = bytes;
    this.indexAt = indexAt;
    this.pagesAt = pagesAt;
    this.pageSize = pageSize;
    this.pageCount = pageCount;
  }

  static parse(bytes: Buffer): EncodingTable {
    if (bytes.length < 22 || bytes.toString('latin1', 0, 2) !== 'EN') throw new CascError('format', 'encoding table has no "EN" magic');
    const version = bytes.readUInt8(2);
    const ckeySize = bytes.readUInt8(3);
    const ekeySize = bytes.readUInt8(4);
    if (version !== 1 || ckeySize !== 16 || ekeySize !== 16) {
      throw new CascError('format', `encoding table version ${String(version)}, key sizes ${String(ckeySize)}/${String(ekeySize)}; expected 1, 16/16`);
    }
    const pageKB = bytes.readUInt16BE(5);
    const pageCount = bytes.readUInt32BE(9);
    const especSize = bytes.readUInt32BE(18);
    const indexAt = 22 + especSize;
    const pagesAt = indexAt + pageCount * 32;
    const pageSize = pageKB * 1024;
    if (pageSize === 0 || pagesAt + pageCount * pageSize > bytes.length) {
      throw new CascError('format', `encoding table of ${String(bytes.length)} bytes cannot hold ${String(pageCount)} pages of ${String(pageKB)} KB`);
    }
    return new EncodingTable(bytes, indexAt, pagesAt, pageSize, pageCount);
  }

  /** The first EKey and the size of a content key, or null when the table has no entry. */
  lookup(ckey: string | Uint8Array): EncodingHit | null {
    const key = typeof ckey === 'string' ? keyBytes(ckey, 'CKey') : Buffer.from(ckey.buffer, ckey.byteOffset, ckey.byteLength);
    if (key.length !== 16) throw new CascError('format', 'CKey must be 16 bytes');
    let lo = 0;
    let hi = this.pageCount - 1;
    let page = -1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const at = this.indexAt + mid * 32;
      // the page's first key sorts at or before the key: candidate page, look further right
      if (this.bytes.compare(key, 0, 16, at, at + 16) <= 0) {
        page = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (page < 0) return null;
    this.checkPage(page);
    const b = this.bytes;
    let at = this.pagesAt + page * this.pageSize;
    const end = at + this.pageSize;
    while (at + 22 <= end) {
      const count = b.readUInt8(at);
      if (count === 0) break;
      const next = at + 22 + 16 * count;
      if (next > end) throw new CascError('format', `encoding page ${String(page)}: entry runs past the page`);
      if (b.compare(key, 0, 16, at + 6, at + 22) === 0) return { ekey: hexOf(b, at + 22, 16), size: b.readUIntBE(at + 1, 5) };
      at = next;
    }
    return null;
  }

  private checkPage(page: number): void {
    if (this.checkedPages.has(page)) return;
    const start = this.pagesAt + page * this.pageSize;
    const expected = hexOf(this.bytes, this.indexAt + page * 32 + 16, 16);
    if (md5Hex(this.bytes.subarray(start, start + this.pageSize)) !== expected) throw new CascError('integrity', `encoding page ${String(page)} checksum mismatch`);
    this.checkedPages.add(page);
  }
}
