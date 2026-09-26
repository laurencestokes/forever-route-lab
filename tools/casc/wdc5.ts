import { allZero, float32FromBits, hexOf, readBits, signExtend, type ByteRange } from './bytes';
import { CascError } from './errors';

/**
 * WDC5 DB2 tables (wowdev.wiki "DB2", WDC3-WDC5), read with a layout supplied as data
 * (tools/casc/layouts.ts, copied from WoWDBDefs). Only non-sparse tables are read; a table with an
 * offset map (header flag 0x1) is refused.
 *
 * ```
 * 'WDC5', u32 version, char schema[128]                                    (136 bytes)
 * u32 recordCount, fieldCount, recordSize, stringTableSize, tableHash, layoutHash,
 *     minId, maxId, locale; u16 flags, u16 idIndex; u32 totalFieldCount, bitpackedDataOffset,
 *     lookupColumnCount, fieldStorageInfoSize, commonDataSize, palletDataSize, sectionCount
 * sectionCount × { u64 tactKeyHash, u32 fileOffset, recordCount, stringTableSize,
 *     offsetRecordsEnd, idListSize, relationshipDataSize, offsetMapIdCount, copyTableCount }
 * fieldCount × { i16 size, u16 position }
 * totalFieldCount × { u16 offsetBits, u16 sizeBits, u32 additionalDataSize, u32 compression,
 *     u32 v1, u32 v2, u32 v3 }
 * pallet data, then common data (each field's `additionalDataSize` bytes, in field order)
 * per section at fileOffset: records, string table, id list, copy table (newId, sourceId),
 *     relationship map (u32 count, u32 minId, u32 maxId, count × (foreignId, recordIndex))
 * ```
 *
 * Compression: 0 none (byte-aligned), 1 bitpacked (signed when v3 has flag 0x1), 2 common data
 * (id → u32 value, default v1), 3 pallet (index → u32), 4 pallet array (index → v3 × u32),
 * 5 bitpacked signed.
 *
 * Record IDs come from the section's ID list or, when a table has none, from the inline ID field.
 * Common-data lookups are keyed by that record ID in both cases (the fix of the m3b prototype:
 * the first reader keyed inline-ID tables by −1, which made every common-data value its default).
 *
 * Strings: a string field holds an offset from the field's own position in a virtual layout where
 * every section's records follow each other and then every section's string table, in section
 * order. A zero offset is the empty string.
 *
 * Encrypted sections (tactKeyHash ≠ 0) whose bytes the BLTE reader zero-filled are skipped and
 * listed in `skippedSections`; their rows are simply absent. The reader fails closed when a
 * zero-filled range touches the header, an unencrypted section, or only part of a section.
 */

export type Wdc5ColumnType = 'int' | 'uint' | 'float' | 'string' | 'locstring';

export interface Wdc5Column {
  readonly name: string;
  readonly type: Wdc5ColumnType;
  /** Integer width from the definition (8, 16, 32 or 64); 32 for floats and strings. */
  readonly bits: number;
  /** Element count; 1 for a scalar. */
  readonly array: number;
}

export interface Wdc5Layout {
  readonly table: string;
  /** Eight uppercase hex digits, as in a WoWDBDefs `LAYOUT` line. */
  readonly layoutHash: string;
  /** The inline fields, in record order (one field-storage entry each). */
  readonly fields: readonly Wdc5Column[];
  /** The ID column's name; `idInline` false when IDs come only from the ID list (`$noninline,id$`). */
  readonly id: string;
  readonly idInline: boolean;
  /** The relation column (`$relation$` or `$noninline,relation$`), if any. */
  readonly relation: string | null;
  readonly relationInline: boolean;
  /** Where the layout was copied from (WoWDBDefs commit and file). */
  readonly source: string;
}

export type Wdc5Value = number | string | readonly number[] | readonly string[];

export interface Wdc5Header {
  readonly version: number;
  readonly recordCount: number;
  readonly fieldCount: number;
  readonly recordSize: number;
  readonly tableHash: string;
  readonly layoutHash: string;
  readonly minId: number;
  readonly maxId: number;
  readonly locale: number;
  readonly flags: number;
  readonly idIndex: number;
  readonly totalFieldCount: number;
  readonly sectionCount: number;
}

export interface Wdc5Section {
  readonly index: number;
  /** Sixteen hex digits; all zeros for an unencrypted section. */
  readonly tactKeyHash: string;
  readonly fileOffset: number;
  readonly recordCount: number;
  readonly stringTableSize: number;
  readonly idListSize: number;
  readonly relationshipDataSize: number;
  readonly offsetMapIdCount: number;
  readonly copyTableCount: number;
  /** True when the section was zero-filled (encrypted) and its rows are absent. */
  readonly skipped: boolean;
}

export interface FieldStorage {
  readonly offsetBits: number;
  readonly sizeBits: number;
  readonly additionalDataSize: number;
  readonly compression: number;
  readonly v1: number;
  readonly v2: number;
  readonly v3: number;
}

export interface Wdc5Options {
  /** Zero-filled ranges of the decoded file (`CascFile.encryptedRanges`). */
  readonly encryptedRanges?: readonly ByteRange[];
  /** Refuse a table with any skipped (encrypted) section. */
  readonly requireComplete?: boolean;
}

export class Wdc5Row {
  readonly id: number;
  /** Section the row was read from. */
  readonly section: number;
  /** The relationship-map value of the row (null when its section has no entry for it). */
  readonly relation: number | null;
  private readonly columns: ReadonlyMap<string, number>;
  private readonly values: readonly Wdc5Value[];
  private readonly table: string;

  constructor(table: string, columns: ReadonlyMap<string, number>, id: number, section: number, relation: number | null, values: readonly Wdc5Value[]) {
    this.table = table;
    this.columns = columns;
    this.id = id;
    this.section = section;
    this.relation = relation;
    this.values = values;
  }

  private value(name: string): Wdc5Value {
    const index = this.columns.get(name);
    if (index === undefined) throw new CascError('layout', `${this.table} has no column "${name}"`);
    const value = this.values[index];
    if (value === undefined) throw new CascError('layout', `${this.table} row ${String(this.id)}: no value for "${name}"`);
    return value;
  }

  /** A scalar number column (integer or float). */
  num(name: string): number {
    const value = this.value(name);
    if (typeof value !== 'number') throw new CascError('layout', `${this.table}.${name} is not a scalar number`);
    return value;
  }

  /** A scalar string column. */
  str(name: string): string {
    const value = this.value(name);
    if (typeof value !== 'string') throw new CascError('layout', `${this.table}.${name} is not a scalar string`);
    return value;
  }

  /** A number array column. */
  nums(name: string): readonly number[] {
    const value = this.value(name);
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'number')) throw new CascError('layout', `${this.table}.${name} is not a number array`);
    return value as readonly number[];
  }

  /** A string array column. */
  strs(name: string): readonly string[] {
    const value = this.value(name);
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new CascError('layout', `${this.table}.${name} is not a string array`);
    return value as readonly string[];
  }
}

export interface Wdc5Table {
  readonly layout: Wdc5Layout;
  readonly header: Wdc5Header;
  readonly sections: readonly Wdc5Section[];
  readonly storage: readonly FieldStorage[];
  /** Rows in file order (section, record), then rows created by copy tables. */
  readonly rows: readonly Wdc5Row[];
  readonly byId: ReadonlyMap<number, Wdc5Row>;
  readonly skippedSections: readonly Wdc5Section[];
}

const HEADER_SIZE = 136 + 4 * 17;

function overlaps(a: ByteRange, b: ByteRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Bytes of `span` covered by `ranges` (ranges assumed disjoint). */
function covered(span: ByteRange, ranges: readonly ByteRange[]): number {
  let total = 0;
  for (const r of ranges) total += Math.max(0, Math.min(span.end, r.end) - Math.max(span.start, r.start));
  return total;
}

export function parseWdc5(bytes: Buffer, layout: Wdc5Layout, options: Wdc5Options = {}): Wdc5Table {
  if (bytes.length < HEADER_SIZE || bytes.toString('latin1', 0, 4) !== 'WDC5') throw new CascError('format', `${layout.table}: not a WDC5 table`);
  let at = 136;
  const u32 = (): number => {
    const v = bytes.readUInt32LE(at);
    at += 4;
    return v;
  };
  const u16 = (): number => {
    const v = bytes.readUInt16LE(at);
    at += 2;
    return v;
  };
  const version = bytes.readUInt32LE(4);
  const recordCount = u32();
  const fieldCount = u32();
  const recordSize = u32();
  u32(); // total string table size (the sections carry their own)
  const tableHash = u32().toString(16).padStart(8, '0').toUpperCase();
  const layoutHash = u32().toString(16).padStart(8, '0').toUpperCase();
  const minId = u32();
  const maxId = u32();
  const locale = u32();
  const flags = u16();
  const idIndex = u16();
  const totalFieldCount = u32();
  u32(); // bitpacked data offset
  u32(); // lookup column count
  const fieldStorageInfoSize = u32();
  const commonDataSize = u32();
  const palletDataSize = u32();
  const sectionCount = u32();
  const header: Wdc5Header = { version, recordCount, fieldCount, recordSize, tableHash, layoutHash, minId, maxId, locale, flags, idIndex, totalFieldCount, sectionCount };
  const name = layout.table;

  if (layoutHash !== layout.layoutHash) throw new CascError('layout', `${name}: layout hash ${layoutHash}, the supplied layout is ${layout.layoutHash}`);
  if (Math.floor(flags) % 2 === 1) throw new CascError('format', `${name}: sparse tables (offset map, flag 0x1) are not supported`);
  if (totalFieldCount !== layout.fields.length) {
    throw new CascError('layout', `${name}: ${String(totalFieldCount)} stored fields, the layout has ${String(layout.fields.length)} inline fields`);
  }
  if (fieldStorageInfoSize !== totalFieldCount * 24) throw new CascError('format', `${name}: field storage info is ${String(fieldStorageInfoSize)} bytes for ${String(totalFieldCount)} fields`);
  if (layout.idInline && layout.fields[idIndex]?.name !== layout.id) {
    throw new CascError('layout', `${name}: header ID index ${String(idIndex)} is not the layout's inline ID field "${layout.id}"`);
  }

  const sectionHeaders: Omit<Wdc5Section, 'skipped'>[] = [];
  for (let i = 0; i < sectionCount; i += 1) {
    const tactKeyHash = hexOf(bytes, at, 8);
    at += 8;
    const fileOffset = u32();
    const count = u32();
    const stringTableSize = u32();
    u32(); // offset records end (sparse only)
    const idListSize = u32();
    const relationshipDataSize = u32();
    const offsetMapIdCount = u32();
    const copyTableCount = u32();
    sectionHeaders.push({ index: i, tactKeyHash, fileOffset, recordCount: count, stringTableSize, idListSize, relationshipDataSize, offsetMapIdCount, copyTableCount });
  }
  at += fieldCount * 4; // field structure: (size, position) per field, implied by the storage info
  const storage: FieldStorage[] = [];
  for (let i = 0; i < totalFieldCount; i += 1) {
    storage.push({ offsetBits: u16(), sizeBits: u16(), additionalDataSize: u32(), compression: u32(), v1: u32(), v2: u32(), v3: u32() });
  }
  const palletAt = at;
  const commonAt = palletAt + palletDataSize;
  const metadataEnd = commonAt + commonDataSize;
  if (metadataEnd > bytes.length) throw new CascError('format', `${name}: pallet and common data run past the end`);
  let sectionTotal = 0;
  for (const s of sectionHeaders) sectionTotal += s.recordCount;
  if (sectionTotal !== recordCount) throw new CascError('format', `${name}: sections hold ${String(sectionTotal)} records, header says ${String(recordCount)}`);

  // Per-field storage checks against the layout, and pallet / common-data offsets.
  const palletOffsets: number[] = [];
  const common: Map<number, number>[] = [];
  let pallet = palletAt;
  let commonCursor = commonAt;
  for (const [f, s] of storage.entries()) {
    const column = layout.fields[f];
    if (column === undefined) throw new CascError('layout', `${name}: no layout column for field ${String(f)}`);
    const elementBits = column.type === 'int' || column.type === 'uint' ? column.bits : 32;
    if (s.compression > 5) throw new CascError('format', `${name}.${column.name}: unknown compression ${String(s.compression)}`);
    if (s.compression === 0 && s.sizeBits !== elementBits * column.array) {
      throw new CascError('layout', `${name}.${column.name}: ${String(s.sizeBits)} stored bits, the layout needs ${String(elementBits * column.array)}`);
    }
    if ((s.compression === 1 || s.compression === 5 || s.compression === 2 || s.compression === 3) && column.array !== 1) {
      throw new CascError('layout', `${name}.${column.name}: compression ${String(s.compression)} holds a scalar, the layout has ${String(column.array)} elements`);
    }
    if (s.compression === 4 && s.v3 !== column.array) throw new CascError('layout', `${name}.${column.name}: pallet array of ${String(s.v3)}, the layout has ${String(column.array)}`);
    palletOffsets.push(pallet);
    if (s.compression === 3 || s.compression === 4) pallet += s.additionalDataSize;
    const map = new Map<number, number>();
    if (s.compression === 2) {
      for (let k = 0; k + 8 <= s.additionalDataSize; k += 8) map.set(bytes.readUInt32LE(commonCursor + k), bytes.readUInt32LE(commonCursor + k + 4));
      commonCursor += s.additionalDataSize;
    }
    common.push(map);
  }
  if (pallet !== commonAt || commonCursor !== metadataEnd) throw new CascError('format', `${name}: pallet or common data sizes do not add up`);

  // Encryption: decide which sections to skip, failing closed on anything ambiguous.
  const ranges = options.encryptedRanges ?? [];
  const headerSpan: ByteRange = { start: 0, end: metadataEnd };
  if (ranges.some((r) => overlaps(r, headerSpan))) throw new CascError('encrypted', `${name}: the table header is encrypted`);
  const sections: Wdc5Section[] = sectionHeaders.map((s) => {
    const recordsEnd = s.fileOffset + s.recordCount * recordSize;
    const end = recordsEnd + s.stringTableSize + s.idListSize + s.copyTableCount * 8 + s.offsetMapIdCount * 6 + s.relationshipDataSize;
    if (end > bytes.length) throw new CascError('format', `${name}: section ${String(s.index)} runs past the end`);
    const span: ByteRange = { start: s.fileOffset, end };
    const declared = s.tactKeyHash !== '0000000000000000';
    const hit = covered(span, ranges);
    let skipped = false;
    if (options.encryptedRanges !== undefined) {
      if (hit > 0 && hit < end - s.fileOffset) throw new CascError('encrypted', `${name}: section ${String(s.index)} is only partly encrypted`);
      if (hit > 0 && !declared) throw new CascError('encrypted', `${name}: section ${String(s.index)} is zero-filled but declares no TACT key`);
      skipped = hit > 0;
    } else if (declared && s.recordCount > 0 && allZero(bytes, s.fileOffset, recordsEnd)) {
      skipped = true;
    }
    if (s.offsetMapIdCount > 0 && !skipped) throw new CascError('format', `${name}: section ${String(s.index)} has an offset map (sparse)`);
    return { ...s, skipped };
  });
  const skippedSections = sections.filter((s) => s.skipped);
  if (options.requireComplete === true && skippedSections.length > 0) {
    throw new CascError('encrypted', `${name}: ${String(skippedSections.length)} encrypted section(s) are missing and the table is required complete`);
  }

  // Column index: inline fields, then the non-inline ID and relation.
  const columns = new Map<string, number>();
  for (const [i, column] of layout.fields.entries()) columns.set(column.name, i);
  const extra: string[] = [];
  if (!layout.idInline) extra.push(layout.id);
  if (layout.relation !== null && !layout.relationInline) extra.push(layout.relation);
  for (const column of extra) {
    if (columns.has(column)) throw new CascError('layout', `${name}: column "${column}" is both inline and non-inline`);
    columns.set(column, columns.size);
  }

  // String tables in the virtual layout.
  const stringBase = recordCount * recordSize;
  const stringTables: { readonly virtualStart: number; readonly size: number; readonly fileStart: number }[] = [];
  let virtual = 0;
  for (const s of sections) {
    stringTables.push({ virtualStart: virtual, size: s.stringTableSize, fileStart: s.fileOffset + s.recordCount * recordSize });
    virtual += s.stringTableSize;
  }
  const readString = (fieldVirtual: number, offset: number, column: string): string => {
    if (offset === 0) return '';
    const index = fieldVirtual + offset - stringBase;
    const table = stringTables.find((t) => index >= t.virtualStart && index < t.virtualStart + t.size);
    if (table === undefined) throw new CascError('format', `${name}.${column}: string offset points outside every string table`);
    const start = table.fileStart + index - table.virtualStart;
    const end = bytes.indexOf(0, start);
    if (end < 0 || end > table.fileStart + table.size) throw new CascError('format', `${name}.${column}: unterminated string`);
    return bytes.toString('utf8', start, end);
  };

  const rows: Wdc5Row[] = [];
  const byId = new Map<number, Wdc5Row>();
  const add = (row: Wdc5Row): void => {
    if (byId.has(row.id)) throw new CascError('format', `${name}: duplicate record ID ${String(row.id)}`);
    byId.set(row.id, row);
    rows.push(row);
  };
  const idStorage = layout.idInline ? storage[idIndex] : undefined;
  const copies: { readonly newId: number; readonly sourceId: number }[] = [];
  let recordsBefore = 0;
  for (const s of sections) {
    const sectionRecordsBefore = recordsBefore;
    recordsBefore += s.recordCount;
    if (s.skipped) continue;
    const idsAt = s.fileOffset + s.recordCount * recordSize + s.stringTableSize;
    if (s.idListSize > 0 && s.idListSize !== s.recordCount * 4) throw new CascError('format', `${name}: section ${String(s.index)} ID list does not match its record count`);
    if (s.idListSize === 0 && idStorage === undefined) throw new CascError('layout', `${name}: section ${String(s.index)} has no ID list and the layout has no inline ID`);
    const copyAt = idsAt + s.idListSize;
    for (let k = 0; k < s.copyTableCount; k += 1) copies.push({ newId: bytes.readUInt32LE(copyAt + k * 8), sourceId: bytes.readUInt32LE(copyAt + k * 8 + 4) });
    const relations = new Map<number, number>();
    if (s.relationshipDataSize > 0) {
      const relAt = copyAt + s.copyTableCount * 8 + s.offsetMapIdCount * 6;
      const count = bytes.readUInt32LE(relAt);
      if (12 + count * 8 !== s.relationshipDataSize) throw new CascError('format', `${name}: section ${String(s.index)} relationship map size does not match its entry count`);
      for (let k = 0; k < count; k += 1) relations.set(bytes.readUInt32LE(relAt + 12 + k * 8 + 4), bytes.readUInt32LE(relAt + 12 + k * 8));
    }
    for (let r = 0; r < s.recordCount; r += 1) {
      const base = s.fileOffset + r * recordSize;
      const recordVirtual = (sectionRecordsBefore + r) * recordSize;
      const id = s.idListSize > 0 ? bytes.readUInt32LE(idsAt + r * 4) : readScalarBits(bytes, base, idStorage, name);
      const values: Wdc5Value[] = [];
      for (const [f, st] of storage.entries()) {
        const column = layout.fields[f];
        if (column === undefined) continue;
        values.push(readField(bytes, base, recordVirtual, st, column, id, common[f] ?? new Map<number, number>(), palletOffsets[f] ?? 0, readString, name));
      }
      const relation = relations.get(r) ?? null;
      if (!layout.idInline) values.push(id);
      if (layout.relation !== null && !layout.relationInline) values.push(relation ?? 0);
      add(new Wdc5Row(name, columns, id, s.index, relation, values));
    }
  }
  const idColumn = layout.idInline ? idIndex : columns.get(layout.id);
  for (const copy of copies) {
    const source = byId.get(copy.sourceId);
    if (source === undefined) continue; // the source row sits in a skipped section
    const values = layout.fields.map((column) => rowValue(source, column));
    for (const column of extra) values.push(column === layout.id ? copy.newId : rowValue(source, { name: column, type: 'uint', bits: 32, array: 1 }));
    if (idColumn !== undefined) values[idColumn] = copy.newId;
    add(new Wdc5Row(name, columns, copy.newId, source.section, source.relation, values));
  }
  return { layout, header, sections, storage, rows, byId, skippedSections };
}

function rowValue(row: Wdc5Row, column: Wdc5Column): Wdc5Value {
  if (column.array !== 1) return column.type === 'string' || column.type === 'locstring' ? row.strs(column.name) : row.nums(column.name);
  return column.type === 'string' || column.type === 'locstring' ? row.str(column.name) : row.num(column.name);
}

function readScalarBits(bytes: Buffer, base: number, s: FieldStorage | undefined, table: string): number {
  if (s === undefined) throw new CascError('layout', `${table}: no inline ID storage`);
  if (s.compression === 0) return bytes.readUIntLE(base + s.offsetBits / 8, s.sizeBits / 8);
  if (s.compression === 1 || s.compression === 5) {
    const raw = readBits(bytes, base, s.offsetBits, s.sizeBits);
    const id = s.compression === 5 || s.v3 % 2 === 1 ? signExtend(raw, s.sizeBits) : raw;
    if (id < 0) throw new CascError('format', `${table}: negative inline record ID ${String(id)}`);
    return id;
  }
  throw new CascError('format', `${table}: inline ID field uses compression ${String(s.compression)}`);
}

function fromU32(bits: number, column: Wdc5Column): number {
  if (column.type === 'float') return float32FromBits(bits);
  return toColumnWidth(bits, column);
}

/**
 * An integer as the definition types it: reduced to the column's width and, for signed columns,
 * reinterpreted as two's complement. A bitpacked, common-data or pallet value is stored wider or
 * narrower than the column (for example an `int<16>` held as the u32 65535 means −1).
 */
function toColumnWidth(value: number, column: Wdc5Column): number {
  if (column.type !== 'int' && column.type !== 'uint') return value;
  const span = 2 ** column.bits;
  const reduced = ((value % span) + span) % span;
  return column.type === 'int' ? signExtend(reduced, column.bits) : reduced;
}

function readField(
  bytes: Buffer,
  base: number,
  recordVirtual: number,
  s: FieldStorage,
  column: Wdc5Column,
  id: number,
  common: ReadonlyMap<number, number>,
  palletAt: number,
  readString: (fieldVirtual: number, offset: number, column: string) => string,
  table: string,
): Wdc5Value {
  const isString = column.type === 'string' || column.type === 'locstring';
  switch (s.compression) {
    case 0: {
      if (s.offsetBits % 8 !== 0) throw new CascError('format', `${table}.${column.name}: unaligned uncompressed field`);
      const at = base + s.offsetBits / 8;
      const width = isString || column.type === 'float' ? 4 : column.bits / 8;
      if (width > 4) throw new CascError('layout', `${table}.${column.name}: ${String(column.bits)}-bit integers are not supported`);
      const element = (i: number): number | string => {
        const p = at + i * width;
        if (isString) return readString(recordVirtual + s.offsetBits / 8 + i * 4, bytes.readUInt32LE(p), column.name);
        if (column.type === 'float') return bytes.readFloatLE(p);
        return column.type === 'int' ? bytes.readIntLE(p, width) : bytes.readUIntLE(p, width);
      };
      if (column.array === 1) return element(0);
      const out = Array.from({ length: column.array }, (_, i) => element(i));
      return isString ? (out as string[]) : (out as number[]);
    }
    case 1:
    case 5: {
      const raw = readBits(bytes, base, s.offsetBits, s.sizeBits);
      const signed = s.compression === 5 || s.v3 % 2 === 1;
      const value = signed ? signExtend(raw, s.sizeBits) : raw;
      if (column.type === 'float') {
        if (s.sizeBits !== 32) throw new CascError('layout', `${table}.${column.name}: bitpacked float of ${String(s.sizeBits)} bits`);
        return float32FromBits(raw);
      }
      if (isString) throw new CascError('layout', `${table}.${column.name}: bitpacked string`);
      return toColumnWidth(value, column);
    }
    case 2: {
      if (isString) throw new CascError('layout', `${table}.${column.name}: string in common data`);
      return fromU32(common.get(id) ?? s.v1, column);
    }
    case 3:
    case 4: {
      if (isString) throw new CascError('layout', `${table}.${column.name}: string in pallet data`);
      const index = readBits(bytes, base, s.offsetBits, s.sizeBits);
      const count = s.compression === 4 ? s.v3 : 1;
      const at = palletAt + index * 4 * count;
      if (at + 4 * count > palletAt + s.additionalDataSize) throw new CascError('format', `${table}.${column.name}: pallet index ${String(index)} out of range`);
      const values = Array.from({ length: count }, (_, i) => fromU32(bytes.readUInt32LE(at + i * 4), column));
      return s.compression === 4 ? values : (values[0] ?? 0);
    }
    default:
      throw new CascError('format', `${table}.${column.name}: unknown compression ${String(s.compression)}`);
  }
}
