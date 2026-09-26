import type { LocalCasc } from './casc';
import type { Db2Table } from './layouts';
import { parseWdc5, type Wdc5Table } from './wdc5';

export interface ReadDb2Options {
  /** Refuse the table when an encrypted section had to be skipped. */
  readonly requireComplete?: boolean;
}

/**
 * Reads a DB2 table by its FileDataID with its generated layout. Encrypted BLTE chunks are
 * zero-filled by the CASC reader and handed to the WDC5 reader, which skips exactly the sections
 * they cover and fails closed on anything else (wdc5.ts).
 */
export function readDb2(casc: LocalCasc, table: Db2Table, options: ReadDb2Options = {}): Wdc5Table {
  const file = casc.file(table.fileDataId, { encrypted: 'zero-fill' });
  return parseWdc5(file.data, table.layout, { encryptedRanges: file.encryptedRanges, requireComplete: options.requireComplete ?? false });
}
