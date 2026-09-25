/**
 * A small quote-aware CSV reader for DB2 exports (wago.tools, DBC2CSV, wow.export): a header row,
 * comma separators, `"` quoting with `""` escapes, fields that may contain commas or newlines
 * (the `Map` table has multi-line fields). Input must be LF text: a CR anywhere fails, because
 * the research CSVs are LF and their recorded SHA-256 values are of those bytes (MAPS.md §8.3).
 */

export interface CsvRecord {
  /** 1-based physical line the record starts on (the header is line 1). */
  readonly line: number;
  /** The record's exact text, without its terminating LF. */
  readonly raw: string;
  readonly fields: readonly string[];
}

export interface CsvTable {
  readonly header: readonly string[];
  readonly records: readonly CsvRecord[];
}

export function parseCsv(text: string): CsvTable {
  if (text.includes('\r')) throw new Error('CSV must use LF line endings (found CR)');
  const records: { line: number; start: number; end: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let recordStart = 0;
  let fieldStarted = false;
  const finishRecord = (end: number): void => {
    fields.push(field);
    records.push({ line: recordLine, start: recordStart, end, fields });
    fields = [];
    field = '';
    fieldStarted = false;
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else {
        if (c === '\n') line += 1;
        field += c;
      }
      continue;
    }
    if (c === '"') {
      if (fieldStarted) throw new Error(`line ${String(line)}: a quote may only open a field`);
      quoted = true;
      fieldStarted = true;
    } else if (c === ',') {
      fields.push(field);
      field = '';
      fieldStarted = false;
    } else if (c === '\n') {
      finishRecord(i);
      line += 1;
      recordLine = line;
      recordStart = i + 1;
    } else {
      field += c;
      fieldStarted = true;
    }
  }
  if (quoted) throw new Error('unterminated quoted field at end of CSV');
  if (recordStart < text.length) finishRecord(text.length);
  const [head, ...body] = records;
  if (head === undefined) throw new Error('CSV has no header row');
  const header = head.fields;
  if (new Set(header).size !== header.length) throw new Error('CSV header has duplicate column names');
  return {
    header,
    records: body.map((record) => {
      if (record.fields.length !== header.length) {
        throw new Error(`line ${String(record.line)}: ${String(record.fields.length)} fields, header has ${String(header.length)}`);
      }
      return { line: record.line, raw: text.slice(record.start, record.end), fields: record.fields };
    }),
  };
}

/** A record's fields keyed by column name, in header order. */
export function recordColumns(table: CsvTable, record: CsvRecord): Readonly<Record<string, string>> {
  return Object.fromEntries(table.header.map((name, i) => [name, record.fields[i] ?? '']));
}

/** Fails unless every named column is present (tools read CSVs by column name, never by position). */
export function requireColumns(table: CsvTable, names: readonly string[], what: string): void {
  const missing = names.filter((name) => !table.header.includes(name));
  if (missing.length > 0) throw new Error(`${what}: missing column(s) ${missing.join(', ')}`);
}
