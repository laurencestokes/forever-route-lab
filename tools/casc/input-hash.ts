import { createHash } from 'node:crypto';

/**
 * Shared by tools/maps (the painted art) and tools/terrain (the byproducts), which both record
 * tools/casc in their tool tree hashes.
 *
 * The input hash of a derived file (terrain-navigation.md §13.3, §13.4; RC-08): SHA-256 over the
 * sorted list of the client files it was made from, one line per file, `<FileDataID> <CKey>\n`,
 * ascending by FileDataID, each FileDataID once. The CKey is the MD5 of the file's decoded bytes as
 * the root manifest records it (`LocalCasc.ckeyOf`), so the hash changes exactly when an input
 * changes, and anyone with the same build can recompute it without the file contents.
 */

export interface ClientInput {
  readonly fileDataId: number;
  readonly ckey: string;
}

const CKEY = /^[0-9a-f]{32}$/;

/** The canonical text the hash covers; throws on a malformed CKey or a FileDataID listed with two CKeys. */
export function inputListText(inputs: Iterable<ClientInput>): string {
  const byId = new Map<number, string>();
  for (const input of inputs) {
    if (!Number.isInteger(input.fileDataId) || input.fileDataId <= 0) throw new Error(`input FileDataID ${String(input.fileDataId)} is not a positive integer`);
    if (!CKEY.test(input.ckey)) throw new Error(`input ${String(input.fileDataId)}: CKey ${input.ckey} is not 32 lowercase hex digits`);
    const known = byId.get(input.fileDataId);
    if (known !== undefined && known !== input.ckey) throw new Error(`input ${String(input.fileDataId)} is listed with two CKeys`);
    byId.set(input.fileDataId, input.ckey);
  }
  return [...byId.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, ckey]) => `${String(id)} ${ckey}\n`)
    .join('');
}

export function inputHash(inputs: Iterable<ClientInput>): string {
  return createHash('sha256').update(inputListText(inputs)).digest('hex');
}
