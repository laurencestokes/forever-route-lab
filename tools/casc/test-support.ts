/**
 * Synthetic CASC and WDC5 builders for tests (docs/research/terrain-navigation.md §17, step 3b.1).
 * Everything here is made from scratch in memory or in a temporary folder: no client file is
 * copied, and the layouts follow the documented formats, not any real table's bytes.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { readBuildInfo, selectProduct } from './buildinfo';
import type { ByteRange } from './bytes';
import { bucketOfEKey } from './idx';
import { buildInfoPath, resolveInstall } from './paths';
import type { Wdc5Layout } from './wdc5';

const md5 = (data: Uint8Array): Buffer => createHash('md5').update(data).digest();
const u32be = (v: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(v, 0);
  return b;
};
const u32le = (v: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v, 0);
  return b;
};

// ---------------------------------------------------------------------------------------------
// BLTE

export interface SynthChunk {
  readonly mode: 'N' | 'Z' | 'E' | 'F';
  readonly data: Buffer;
  /** For `E`: sixteen hex digits (the key name as usually printed). */
  readonly keyName?: string;
}

/** A BLTE stream: with a chunk table (the default), or a single chunk with header size 0. */
export function blte(chunks: readonly SynthChunk[], options: { readonly table?: boolean } = {}): Buffer {
  const encoded = chunks.map((c) => {
    if (c.mode === 'N') return Buffer.concat([Buffer.from('N'), c.data]);
    if (c.mode === 'Z') return Buffer.concat([Buffer.from('Z'), deflateSync(c.data)]);
    if (c.mode === 'F') return Buffer.concat([Buffer.from('F'), c.data]);
    const name = Buffer.from(c.keyName ?? '0123456789abcdef', 'hex').reverse();
    // key name size, key name (LE), iv size, iv, type 'S', then "ciphertext" of the plain length
    return Buffer.concat([Buffer.from('E'), Buffer.from([8]), name, Buffer.from([4]), Buffer.from([1, 2, 3, 4]), Buffer.from('S'), Buffer.alloc(c.data.length, 0xaa)]);
  });
  if (options.table === false) {
    if (encoded.length !== 1) throw new Error('a table-less BLTE stream has exactly one chunk');
    return Buffer.concat([Buffer.from('BLTE'), u32be(0), encoded[0] ?? Buffer.alloc(0)]);
  }
  const headerSize = 12 + 24 * chunks.length;
  const table = Buffer.alloc(headerSize - 8);
  table.writeUInt8(0x0f, 0);
  table.writeUIntBE(chunks.length, 1, 3);
  chunks.forEach((c, i) => {
    const e = encoded[i] ?? Buffer.alloc(0);
    table.writeUInt32BE(e.length, 4 + i * 24);
    table.writeUInt32BE(c.data.length, 8 + i * 24);
    md5(e).copy(table, 12 + i * 24);
  });
  return Buffer.concat([Buffer.from('BLTE'), u32be(headerSize), table, ...encoded]);
}

// ---------------------------------------------------------------------------------------------
// Local index, encoding table, root manifest

export interface SynthIndexEntry {
  readonly ekey: Buffer;
  readonly archive: number;
  readonly offset: number;
  readonly size: number;
}

/** One version-7 `.idx` file of `bucket`, entries sorted by their 9-byte key. */
export function indexFile(bucket: number, entries: readonly SynthIndexEntry[]): Buffer {
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0x10, 0);
  header.writeUInt32LE(0x12345678, 4);
  header.writeUInt16LE(7, 8);
  header.writeUInt8(bucket, 10);
  header.writeUInt8(0, 11);
  header.writeUInt8(4, 12);
  header.writeUInt8(5, 13);
  header.writeUInt8(9, 14);
  header.writeUInt8(30, 15);
  const sorted = [...entries].sort((a, b) => Buffer.compare(a.ekey.subarray(0, 9), b.ekey.subarray(0, 9)));
  const body = Buffer.alloc(sorted.length * 18);
  sorted.forEach((e, i) => {
    e.ekey.copy(body, i * 18, 0, 9);
    body.writeUIntBE(e.archive * 2 ** 30 + e.offset, i * 18 + 9, 5);
    body.writeUInt32LE(e.size, i * 18 + 14);
  });
  return Buffer.concat([header, u32le(body.length), u32le(0), body]);
}

export interface SynthEncodingEntry {
  readonly ckey: Buffer;
  readonly ekey: Buffer;
  readonly size: number;
}

/** An encoding table with 1-KB CKey pages (26 entries per page). */
export function encodingTable(entries: readonly SynthEncodingEntry[]): Buffer {
  const sorted = [...entries].sort((a, b) => Buffer.compare(a.ckey, b.ckey));
  const pageSize = 1024;
  const perPage = Math.floor(pageSize / 38);
  const pages: Buffer[] = [];
  const index: Buffer[] = [];
  for (let i = 0; i < sorted.length; i += perPage) {
    const page = Buffer.alloc(pageSize);
    const slice = sorted.slice(i, i + perPage);
    slice.forEach((e, k) => {
      page.writeUInt8(1, k * 38);
      page.writeUIntBE(e.size, k * 38 + 1, 5);
      e.ckey.copy(page, k * 38 + 6);
      e.ekey.copy(page, k * 38 + 22);
    });
    pages.push(page);
    index.push(Buffer.concat([slice[0]?.ckey ?? Buffer.alloc(16), md5(page)]));
  }
  const espec = Buffer.from('z\0');
  const header = Buffer.alloc(22);
  header.write('EN', 0, 'latin1');
  header.writeUInt8(1, 2);
  header.writeUInt8(16, 3);
  header.writeUInt8(16, 4);
  header.writeUInt16BE(1, 5);
  header.writeUInt16BE(1, 7);
  header.writeUInt32BE(pages.length, 9);
  header.writeUInt32BE(0, 13);
  header.writeUInt8(0, 17);
  header.writeUInt32BE(espec.length, 18);
  return Buffer.concat([header, espec, ...index, ...pages]);
}

export interface SynthRootBlock {
  readonly locale: number;
  /** contentFlags1, contentFlags2, contentFlags3 (u8). */
  readonly flags: readonly [number, number, number];
  readonly entries: readonly { readonly fileDataId: number; readonly ckey: Buffer }[];
  /** Write no name hashes (only valid with NoNameHash and total ≠ named). */
  readonly noNameHashes?: boolean;
}

/** An MFST version-2 root manifest. Entries of a block must be in ascending FileDataID order. */
export function rootManifest(blocks: readonly SynthRootBlock[], counts: { readonly total: number; readonly named: number }): Buffer {
  const header = Buffer.alloc(24);
  header.write('TSFM', 0, 'latin1');
  header.writeUInt32LE(24, 4);
  header.writeUInt32LE(2, 8);
  header.writeUInt32LE(counts.total, 12);
  header.writeUInt32LE(counts.named, 16);
  const parts: Buffer[] = [header];
  for (const block of blocks) {
    const h = Buffer.alloc(17);
    h.writeUInt32LE(block.entries.length, 0);
    h.writeUInt32LE(block.locale, 4);
    h.writeUInt32LE(block.flags[0], 8);
    h.writeUInt32LE(block.flags[1], 12);
    h.writeUInt8(block.flags[2], 16);
    const deltas = Buffer.alloc(4 * block.entries.length);
    let previous = -1;
    block.entries.forEach((e, i) => {
      deltas.writeInt32LE(e.fileDataId - previous - 1, i * 4);
      previous = e.fileDataId;
    });
    parts.push(h, deltas, ...block.entries.map((e) => e.ckey));
    if (block.noNameHashes !== true) parts.push(Buffer.alloc(8 * block.entries.length, 0x11));
  }
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------------------------
// A whole install

export interface SynthFile {
  readonly fileDataId: number;
  readonly content: Buffer;
  /** Chunk layout; the default is one zlib chunk of `content` in a chunk table. */
  readonly chunks?: readonly SynthChunk[];
  readonly table?: boolean;
  /** Store without the 0x1E local header. */
  readonly headerless?: boolean;
  /** Store a zero-filled placeholder instead of the BLTE stream (a not-yet-downloaded entry). */
  readonly zeroPlaceholder?: boolean;
  /** Root block for the entry (default enUS, no flags). */
  readonly locale?: number;
  readonly flags?: readonly [number, number, number];
  /** Leave the file out of the local indices (known to root and encoding only). */
  readonly notIndexed?: boolean;
}

export interface SynthInstall {
  readonly install: string;
  readonly product: string;
  readonly version: string;
  readonly buildKey: string;
  readonly cdnKey: string;
  readonly rootCKey: string;
  readonly ckeys: ReadonlyMap<number, string>;
}

export const SYNTH_PRODUCT = 'wow_synth';
export const SYNTH_VERSION = '1.0.0.1';

/** Writes `.build.info`, one build config, 16 `.idx` files and `data.000` under `install`. */
export function writeSyntheticInstall(install: string, files: readonly SynthFile[], options: { readonly product?: string; readonly version?: string } = {}): SynthInstall {
  const product = options.product ?? SYNTH_PRODUCT;
  const version = options.version ?? SYNTH_VERSION;
  const stored: { ekey: Buffer; bytes: Buffer; indexed: boolean; headerless: boolean }[] = [];
  const encoding: SynthEncodingEntry[] = [];
  const ckeys = new Map<number, string>();
  const blocks = new Map<string, { locale: number; flags: readonly [number, number, number]; entries: { fileDataId: number; ckey: Buffer }[] }>();
  for (const f of files) {
    const ckey = md5(f.content);
    const stream = blte(f.chunks ?? [{ mode: 'Z', data: f.content }], { table: f.table ?? true });
    const ekey = md5(Buffer.concat([stream, u32le(f.fileDataId)]));
    ckeys.set(f.fileDataId, ckey.toString('hex'));
    encoding.push({ ckey, ekey, size: f.content.length });
    stored.push({ ekey, bytes: f.zeroPlaceholder === true ? Buffer.alloc(stream.length + 0x1e) : stream, indexed: f.notIndexed !== true, headerless: f.headerless === true || f.zeroPlaceholder === true });
    const locale = f.locale ?? 0x2;
    const flags = f.flags ?? [0, 0, 0];
    const key = `${String(locale)}:${flags.join(',')}`;
    const block = blocks.get(key) ?? { locale, flags, entries: [] };
    block.entries.push({ fileDataId: f.fileDataId, ckey });
    blocks.set(key, block);
  }
  for (const block of blocks.values()) block.entries.sort((a, b) => a.fileDataId - b.fileDataId);
  const root = rootManifest([...blocks.values()], { total: files.length, named: files.length });
  const rootCKey = md5(root);
  const rootStream = blte([{ mode: 'Z', data: root }]);
  const rootEKey = md5(rootStream);
  encoding.push({ ckey: rootCKey, ekey: rootEKey, size: root.length });
  stored.push({ ekey: rootEKey, bytes: rootStream, indexed: true, headerless: false });
  const enc = encodingTable(encoding);
  const encCKey = md5(enc);
  const encStream = blte([{ mode: 'N', data: enc.subarray(0, 64) }, { mode: 'Z', data: enc.subarray(64) }]);
  const encEKey = md5(encStream);
  stored.push({ ekey: encEKey, bytes: encStream, indexed: true, headerless: false });

  const dataDir = join(install, 'Data', 'data');
  mkdirSync(dataDir, { recursive: true });
  const archive: Buffer[] = [];
  let offset = 0;
  const byBucket = new Map<number, SynthIndexEntry[]>();
  for (const s of stored) {
    let entry = s.bytes;
    if (!s.headerless) {
      const local = Buffer.alloc(0x1e);
      Buffer.from(s.ekey).reverse().copy(local, 0);
      local.writeUInt32LE(0x1e + s.bytes.length, 16);
      entry = Buffer.concat([local, s.bytes]);
    }
    archive.push(entry);
    if (s.indexed) {
      const bucket = bucketOfEKey(s.ekey);
      const list = byBucket.get(bucket) ?? [];
      list.push({ ekey: s.ekey, archive: 0, offset, size: entry.length });
      byBucket.set(bucket, list);
    }
    offset += entry.length;
  }
  writeFileSync(join(dataDir, 'data.000'), Buffer.concat(archive));
  for (let bucket = 0; bucket < 16; bucket += 1) {
    const name = `${bucket.toString(16).padStart(2, '0')}00000002.idx`;
    writeFileSync(join(dataDir, name), indexFile(bucket, byBucket.get(bucket) ?? []));
    // an older version of the same bucket, which must be ignored
    writeFileSync(join(dataDir, `${bucket.toString(16).padStart(2, '0')}00000001.idx`), indexFile(bucket, []));
  }
  const buildKey = md5(Buffer.from(`build ${version}`)).toString('hex');
  const cdnKey = md5(Buffer.from(`cdn ${version}`)).toString('hex');
  const configDir = join(install, 'Data', 'config', buildKey.slice(0, 2), buildKey.slice(2, 4));
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, buildKey), `# Build Configuration\n\nroot = ${rootCKey.toString('hex')}\nencoding = ${encCKey.toString('hex')} ${encEKey.toString('hex')}\n`);
  writeFileSync(
    join(install, '.build.info'),
    [
      'Branch!STRING:0|Active!DEC:1|Build Key!HEX:16|CDN Key!HEX:16|Install Key!HEX:16|CDN Hosts!STRING:0|Tags!STRING:0|Version!STRING:0|Product!STRING:0',
      `eu|1|${buildKey}|${cdnKey}|${'0'.repeat(32)}|cdn.example.invalid|Windows x86_64 EU? enUS speech?:|${version}|${product}`,
      `eu|0|${'1'.repeat(32)}|${cdnKey}|${'0'.repeat(32)}|cdn.example.invalid|old|0.0.0.1|${product}`,
      '',
    ].join('\r\n'),
  );
  return { install, product, version, buildKey, cdnKey, rootCKey: rootCKey.toString('hex'), ckeys };
}

// ---------------------------------------------------------------------------------------------
// WDC5

export type SynthStorage =
  | { readonly kind: 'none' }
  | { readonly kind: 'bitpacked'; readonly bits: number; readonly signed?: 'flag' | 'type5' }
  | { readonly kind: 'common'; readonly default: number }
  | { readonly kind: 'pallet'; readonly bits: number }
  | { readonly kind: 'palletArray'; readonly bits: number };

export type SynthValue = number | string | readonly number[] | readonly string[];

export interface SynthRow {
  readonly id: number;
  readonly values: Readonly<Record<string, SynthValue>>;
}

export interface SynthSection {
  readonly rows: readonly SynthRow[];
  /** Store IDs in an ID list (default true; false needs an inline ID in the layout). */
  readonly idList?: boolean;
  /** Declare a TACT key and zero the section's bytes, as the BLTE reader does for an E chunk. */
  readonly encrypted?: boolean;
  readonly copies?: readonly (readonly [newId: number, sourceId: number])[];
  /** (foreign id, record index) pairs. */
  readonly relations?: readonly (readonly [foreignId: number, recordIndex: number])[];
}

export interface SynthWdc5 {
  readonly bytes: Buffer;
  /** Byte span of each section's data. */
  readonly sectionSpans: readonly ByteRange[];
}

const toU32 = (value: number, type: string): number => {
  if (type === 'float') {
    const b = Buffer.alloc(4);
    b.writeFloatLE(value, 0);
    return b.readUInt32LE(0);
  }
  return ((value % 2 ** 32) + 2 ** 32) % 2 ** 32;
};

function writeBits(target: Buffer, byteOffset: number, bitOffset: number, bits: number, value: number): void {
  let v = ((value % 2 ** bits) + 2 ** bits) % 2 ** bits;
  for (let i = 0; i < bits; i += 1) {
    const position = bitOffset + i;
    const at = byteOffset + Math.floor(position / 8);
    if (v % 2 === 1) target.writeUInt8((target.readUInt8(at) + 2 ** (position % 8)) % 256, at);
    v = Math.floor(v / 2);
  }
}

/** A WDC5 table for `layout` with the given storage per inline field and sections. */
export function buildWdc5(
  layout: Wdc5Layout,
  storage: readonly SynthStorage[],
  sections: readonly SynthSection[],
  options: { readonly layoutHash?: string; readonly flags?: number; readonly idIndex?: number } = {},
): SynthWdc5 {
  if (storage.length !== layout.fields.length) throw new Error('one storage entry per layout field');
  // Field positions in the record.
  const placed: { offsetBits: number; sizeBits: number }[] = [];
  let cursor = 0;
  for (const [i, s] of storage.entries()) {
    const column = layout.fields[i];
    if (column === undefined) throw new Error('missing column');
    const elementBits = column.type === 'int' || column.type === 'uint' ? column.bits : 32;
    if (s.kind === 'none') {
      cursor = Math.ceil(cursor / 8) * 8;
      placed.push({ offsetBits: cursor, sizeBits: elementBits * column.array });
      cursor += elementBits * column.array;
    } else if (s.kind === 'common') {
      placed.push({ offsetBits: cursor, sizeBits: 0 });
    } else {
      placed.push({ offsetBits: cursor, sizeBits: s.bits });
      cursor += s.bits;
    }
  }
  const recordSize = Math.max(1, Math.ceil(cursor / 8));
  const allRows = sections.flatMap((s) => s.rows);
  const totalRecords = allRows.length;

  // Pallet and common data.
  const valueOf = (row: SynthRow, name: string): SynthValue => {
    if (name === layout.id) return row.id;
    const v = row.values[name];
    if (v === undefined) throw new Error(`row ${String(row.id)} has no value for ${name}`);
    return v;
  };
  const pallets: number[][][] = storage.map(() => []);
  const palletIndex = (field: number, tuple: readonly number[]): number => {
    const list = pallets[field] ?? [];
    const found = list.findIndex((t) => t.length === tuple.length && t.every((x, k) => x === tuple[k]));
    if (found >= 0) return found;
    list.push([...tuple]);
    pallets[field] = list;
    return list.length - 1;
  };
  const commonParts: Buffer[] = [];
  const palletParts: Buffer[] = [];
  const storageInfo: Buffer[] = [];
  // Pallet indices must be known before records are written, so collect them first.
  const rowPallet = new Map<string, number>();
  for (const row of allRows) {
    storage.forEach((s, f) => {
      const column = layout.fields[f];
      if (column === undefined || (s.kind !== 'pallet' && s.kind !== 'palletArray')) return;
      const v = valueOf(row, column.name);
      const tuple = (Array.isArray(v) ? v : [v]).map((x) => toU32(Number(x), column.type));
      rowPallet.set(`${String(row.id)}:${String(f)}`, palletIndex(f, tuple));
    });
  }
  storage.forEach((s, f) => {
    const column = layout.fields[f];
    if (column === undefined) return;
    const info = Buffer.alloc(24);
    const p = placed[f] ?? { offsetBits: 0, sizeBits: 0 };
    info.writeUInt16LE(p.offsetBits, 0);
    info.writeUInt16LE(p.sizeBits, 2);
    let additional = 0;
    let compression = 0;
    let v1 = 0;
    let v2 = 0;
    let v3 = 0;
    if (s.kind === 'bitpacked') {
      compression = s.signed === 'type5' ? 5 : 1;
      v2 = s.bits;
      v3 = s.signed === 'flag' ? 1 : 0;
    } else if (s.kind === 'common') {
      compression = 2;
      v1 = toU32(s.default, column.type);
      const pairs: Buffer[] = [];
      for (const row of allRows) {
        const value = toU32(Number(valueOf(row, column.name)), column.type);
        if (value !== v1) pairs.push(Buffer.concat([u32le(row.id), u32le(value)]));
      }
      const data = Buffer.concat(pairs);
      additional = data.length;
      commonParts.push(data);
    } else if (s.kind === 'pallet' || s.kind === 'palletArray') {
      compression = s.kind === 'pallet' ? 3 : 4;
      v2 = s.bits;
      v3 = s.kind === 'palletArray' ? column.array : 0;
      const data = Buffer.concat((pallets[f] ?? []).flatMap((t) => t.map(u32le)));
      additional = data.length;
      palletParts.push(data);
    }
    info.writeUInt32LE(additional, 4);
    info.writeUInt32LE(compression, 8);
    info.writeUInt32LE(v1, 12);
    info.writeUInt32LE(v2, 16);
    info.writeUInt32LE(v3, 20);
    storageInfo.push(info);
  });

  // Section bodies (records, strings, id list, copy table, relationship map).
  const stringTables: Buffer[] = [];
  const stringVirtualStart: number[] = [];
  const stringOffsets: Map<string, number>[] = [];
  {
    let virtual = 0;
    for (const section of sections) {
      const strings: Buffer[] = [];
      const seen = new Map<string, number>();
      let size = 0;
      const intern = (text: string): void => {
        if (text === '' || seen.has(text)) return;
        seen.set(text, size);
        const b = Buffer.from(`${text}\0`, 'utf8');
        strings.push(b);
        size += b.length;
      };
      for (const row of section.rows) {
        layout.fields.forEach((column) => {
          if (column.type !== 'string' && column.type !== 'locstring') return;
          const v = valueOf(row, column.name);
          for (const text of Array.isArray(v) ? v : [v]) intern(String(text));
        });
      }
      stringTables.push(Buffer.concat(strings));
      stringVirtualStart.push(virtual);
      virtual += size;
      stringOffsets.push(seen);
    }
  }
  const bodies: Buffer[] = [];
  let recordsBefore = 0;
  for (const [si, section] of sections.entries()) {
    const records = Buffer.alloc(recordSize * section.rows.length);
    const seen = stringOffsets[si] ?? new Map<string, number>();
    section.rows.forEach((row, r) => {
      const base = r * recordSize;
      const recordVirtual = (recordsBefore + r) * recordSize;
      storage.forEach((s, f) => {
        const column = layout.fields[f];
        const p = placed[f];
        if (column === undefined || p === undefined || s.kind === 'common') return;
        const v = valueOf(row, column.name);
        if (s.kind === 'pallet' || s.kind === 'palletArray') {
          writeBits(records, base, p.offsetBits, p.sizeBits, rowPallet.get(`${String(row.id)}:${String(f)}`) ?? 0);
          return;
        }
        if (s.kind === 'bitpacked') {
          writeBits(records, base, p.offsetBits, p.sizeBits, column.type === 'float' ? toU32(Number(v), 'float') : Number(v));
          return;
        }
        const list = Array.isArray(v) ? v : [v];
        const width = column.type === 'int' || column.type === 'uint' ? column.bits / 8 : 4;
        list.forEach((x, k) => {
          const at = base + p.offsetBits / 8 + k * width;
          if (column.type === 'string' || column.type === 'locstring') {
            const text = String(x);
            const inTable = seen.get(text);
            const offset = text === '' || inTable === undefined ? 0 : (stringVirtualStart[si] ?? 0) + inTable + totalRecords * recordSize - (recordVirtual + p.offsetBits / 8 + k * 4);
            records.writeUInt32LE(offset, at);
          } else if (column.type === 'float') {
            records.writeFloatLE(Number(x), at);
          } else {
            writeBits(records, at, 0, width * 8, Number(x));
          }
        });
      });
    });
    const idList = section.idList === false ? Buffer.alloc(0) : Buffer.concat(section.rows.map((row) => u32le(row.id)));
    const copies = Buffer.concat((section.copies ?? []).map(([n, s]) => Buffer.concat([u32le(n), u32le(s)])));
    const relations = section.relations ?? [];
    const relationMap =
      relations.length === 0
        ? Buffer.alloc(0)
        : Buffer.concat([u32le(relations.length), u32le(0), u32le(0), ...relations.map(([foreign, index]) => Buffer.concat([u32le(foreign), u32le(index)]))]);
    bodies.push(Buffer.concat([records, stringTables[si] ?? Buffer.alloc(0), idList, copies, relationMap]));
    recordsBefore += section.rows.length;
  }

  const header = Buffer.alloc(136 + 68);
  header.write('WDC5', 0, 'latin1');
  header.writeUInt32LE(5, 4);
  header.write('synthetic', 8, 'latin1');
  let at = 136;
  const put32 = (v: number): void => {
    header.writeUInt32LE(v, at);
    at += 4;
  };
  const put16 = (v: number): void => {
    header.writeUInt16LE(v, at);
    at += 2;
  };
  const ids = allRows.map((r) => r.id);
  const commonSize = commonParts.reduce((n, b) => n + b.length, 0);
  const palletSize = palletParts.reduce((n, b) => n + b.length, 0);
  put32(totalRecords);
  put32(layout.fields.length);
  put32(recordSize);
  put32(stringTables.reduce((n, b) => n + b.length, 0));
  put32(0xabcdef01);
  put32(Number.parseInt(options.layoutHash ?? layout.layoutHash, 16));
  put32(ids.length > 0 ? Math.min(...ids) : 0);
  put32(ids.length > 0 ? Math.max(...ids) : 0);
  put32(0);
  put16(options.flags ?? 0);
  put16(options.idIndex ?? (layout.idInline ? layout.fields.findIndex((f) => f.name === layout.id) : 0));
  put32(layout.fields.length);
  put32(0);
  put32(0);
  put32(24 * layout.fields.length);
  put32(commonSize);
  put32(palletSize);
  put32(sections.length);
  const fieldStructure = Buffer.alloc(4 * layout.fields.length);
  const metadataSize = header.length + 40 * sections.length + fieldStructure.length + 24 * layout.fields.length + palletSize + commonSize;
  const sectionHeaders: Buffer[] = [];
  const sectionSpans: ByteRange[] = [];
  let offset = metadataSize;
  sections.forEach((section, si) => {
    const body = bodies[si] ?? Buffer.alloc(0);
    const h = Buffer.alloc(40);
    if (section.encrypted === true) h.write('0102030405060708', 0, 'hex');
    h.writeUInt32LE(offset, 8);
    h.writeUInt32LE(section.rows.length, 12);
    h.writeUInt32LE((stringTables[si] ?? Buffer.alloc(0)).length, 16);
    h.writeUInt32LE(0, 20);
    h.writeUInt32LE(section.idList === false ? 0 : 4 * section.rows.length, 24);
    h.writeUInt32LE(section.relations === undefined || section.relations.length === 0 ? 0 : 12 + 8 * section.relations.length, 28);
    h.writeUInt32LE(0, 32);
    h.writeUInt32LE((section.copies ?? []).length, 36);
    sectionHeaders.push(h);
    sectionSpans.push({ start: offset, end: offset + body.length });
    if (section.encrypted === true) body.fill(0);
    offset += body.length;
  });
  const bytes = Buffer.concat([header, ...sectionHeaders, fieldStructure, ...storageInfo, ...palletParts, ...commonParts, ...bodies]);
  return { bytes, sectionSpans };
}

/** A layout for synthetic tables (not any real table's). */
export function synthLayout(fields: Wdc5Layout['fields'], options: Partial<Pick<Wdc5Layout, 'id' | 'idInline' | 'relation' | 'relationInline' | 'layoutHash'>> = {}): Wdc5Layout {
  return {
    table: 'Synthetic',
    layoutHash: options.layoutHash ?? '0A1B2C3D',
    fields,
    id: options.id ?? 'ID',
    idInline: options.idInline ?? false,
    relation: options.relation ?? null,
    relationInline: options.relationInline ?? false,
    source: 'test',
  };
}

// ---------------------------------------------------------------------------------------------
// The local client, for the integration tests that skip loudly without it

/**
 * The Forever client build the integration tests assert numbers for (terrain-navigation.md §2).
 * `tools/terrain/build.json` (step 3b.3) becomes the pin the build tools read; these tests keep
 * their own copy because their expected counts belong to this build only.
 */
export const FOREVER_TEST_PIN = { product: 'wow_classic_beta', version: '1.60.1.70124', buildKey: 'dd3dfc2881c407299f46c2aaf34c130b' } as const;

export type ClientStatus = { readonly available: true; readonly install: string } | { readonly available: false; readonly reason: string };

/** Whether the pinned client is installed at `WOW_INSTALL` (reads `.build.info` only). */
export function pinnedClientStatus(env: Readonly<Record<string, string | undefined>> = process.env): ClientStatus {
  const install = resolveInstall(env);
  if (!existsSync(buildInfoPath(install))) return { available: false, reason: `no .build.info under WOW_INSTALL (${install})` };
  try {
    const row = selectProduct(readBuildInfo(install), FOREVER_TEST_PIN.product);
    if (row.version !== FOREVER_TEST_PIN.version || row.buildKey !== FOREVER_TEST_PIN.buildKey) {
      return { available: false, reason: `installed ${row.product} is ${row.version} (${row.buildKey}), the tests are pinned to ${FOREVER_TEST_PIN.version}` };
    }
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error) };
  }
  return { available: true, install };
}

/**
 * Prints a skip banner that stands out in the test log. It writes to the process's stderr
 * directly: Vitest's default reporter does not print console output of passing or skipped tests.
 */
export function announceSkip(suite: string, reason: string): void {
  const line = '='.repeat(96);
  process.stderr.write(`\n${line}\nSKIPPED: ${suite}\n  ${reason}\n  Set WOW_INSTALL to a World of Warcraft install with ${FOREVER_TEST_PIN.product} ${FOREVER_TEST_PIN.version} to run it.\n${line}\n`);
}
