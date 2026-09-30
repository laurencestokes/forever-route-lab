import { sha256Hex } from './hash';
import { MINIMAP_MANIFEST_FILE, MINIMAP_NOTICE_FILE, PACK_CONTENTS } from './minimap-params';

/**
 * The release-asset tile pack and its pointer (docs/research/map-atlas.md §18.2 step 10, §23.3;
 * D-049 O14, A17). The pack is an uncompressed POSIX (ustar) tar of `NOTICE.md`, `manifest.json`
 * and the tiles under `t/`, in that order (the notice first, so any copy carries Blizzard's notice,
 * the non-affiliation statement and the alterations; D-033 rule 2), the tiles in path order, with
 * fixed metadata (mode 0644, uid and gid 0, mtime 0, no user or group names, no directory entries),
 * padded to whole 10,240-byte records: the same files give the same bytes on any machine.
 *
 * The pointer (`pack.json`) names the pack by the tiles' tree hash and the pack's own SHA-256, and
 * pins it by that SHA-256: two packs with different bytes (the same tiles with another manifest, a
 * rebuild with another tool hash or Node) never share an asset name or a release tag, so a release,
 * once published, is never replaced (§23.3; review finding MD-02). Neither the name nor the hash is
 * in the manifest: the pack holds the manifest, so the manifest cannot hold the pack's hash, and it
 * records only the tree hash and the contents. Pure; no bitwise operators.
 */

export const TAR_BLOCK = 512;
export const TAR_RECORD = 10240;

export interface PackFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

function octal(value: number, width: number): string {
  const s = value.toString(8);
  if (s.length > width - 1) throw new Error(`tar: ${String(value)} does not fit ${String(width - 1)} octal digits`);
  return `${s.padStart(width - 1, '0')}\0`;
}

/** One ustar header block. */
export function tarHeader(path: string, size: number): Buffer {
  const name = Buffer.from(path, 'utf8');
  if (name.length > 100) throw new Error(`tar: path ${path} is longer than 100 bytes`);
  const h = Buffer.alloc(TAR_BLOCK);
  name.copy(h, 0);
  h.write(octal(420, 8), 100, 'latin1'); // mode 0644
  h.write(octal(0, 8), 108, 'latin1'); // uid
  h.write(octal(0, 8), 116, 'latin1'); // gid
  h.write(octal(size, 12), 124, 'latin1');
  h.write(octal(0, 12), 136, 'latin1'); // mtime
  h.write('        ', 148, 'latin1'); // checksum placeholder: eight spaces
  h.write('0', 156, 'latin1'); // a regular file
  h.write('ustar\0', 257, 'latin1');
  h.write('00', 263, 'latin1');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
  return h;
}

/** The whole tar: each file's header and its bytes padded to 512, two zero blocks, padded to a 10,240-byte record. */
export function tarArchive(files: readonly PackFile[]): Buffer {
  const parts: Buffer[] = [];
  let length = 0;
  for (const f of files) {
    const header = tarHeader(f.path, f.bytes.length);
    const pad = (TAR_BLOCK - (f.bytes.length % TAR_BLOCK)) % TAR_BLOCK;
    parts.push(header, Buffer.from(f.bytes.buffer, f.bytes.byteOffset, f.bytes.byteLength), Buffer.alloc(pad));
    length += TAR_BLOCK + f.bytes.length + pad;
  }
  const end = 2 * TAR_BLOCK;
  const record = (TAR_RECORD - ((length + end) % TAR_RECORD)) % TAR_RECORD;
  parts.push(Buffer.alloc(end + record));
  return Buffer.concat(parts);
}

/** The files of a pack in their fixed order: `NOTICE.md`, `manifest.json`, then the tiles in path order. */
export function packFiles(notice: string, manifest: string, tiles: readonly PackFile[]): PackFile[] {
  const sorted = [...tiles].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const t of sorted) if (!t.path.startsWith('t/')) throw new Error(`tar: tile path ${t.path} is not under t/`);
  return [{ path: MINIMAP_NOTICE_FILE, bytes: Buffer.from(notice, 'utf8') }, { path: MINIMAP_MANIFEST_FILE, bytes: Buffer.from(manifest, 'utf8') }, ...sorted];
}

/** A tar's entries, in order (for the checks and tests): path, size and the byte offset of the data. */
export function tarEntries(tar: Uint8Array): { readonly path: string; readonly size: number; readonly offset: number }[] {
  const out: { path: string; size: number; offset: number }[] = [];
  let at = 0;
  const buf = Buffer.from(tar.buffer, tar.byteOffset, tar.byteLength);
  while (at + TAR_BLOCK <= buf.length) {
    const h = buf.subarray(at, at + TAR_BLOCK);
    if (h.every((b) => b === 0)) break;
    const end = h.indexOf(0);
    const path = h.toString('utf8', 0, end < 0 || end > 100 ? 100 : end);
    const size = parseInt(h.toString('latin1', 124, 135), 8);
    out.push({ path, size, offset: at + TAR_BLOCK });
    at += TAR_BLOCK + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
  }
  return out;
}

/** The tiles' tree hash: SHA-256 of the sorted `<path> <sha256>\n` lines of every tile file (M7). */
export function tilesTreeHash(tiles: readonly { readonly path: string; readonly sha256: string }[]): string {
  const lines = tiles.map((t) => `${t.path} ${t.sha256}\n`).sort();
  return sha256Hex(lines.join(''));
}

export interface PackPointer {
  /** The release asset's file name: `minimap-tiles-<tree hash, 12 hex>-<pack SHA-256, 12 hex>.tar`. */
  readonly asset: string;
  /** The release tag: `minimap-<client version>-<tree hash, 12 hex>-<pack SHA-256, 12 hex>`. */
  readonly tag: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly treeHash: string;
  readonly client: string;
  readonly contents: readonly string[];
}

/** The pack's identity in its name: the tile set (the tree hash) and the pack's bytes (its SHA-256), 12 hex each. */
const packId = (treeHash: string, sha256: string): string => `${treeHash.slice(0, 12)}-${sha256.slice(0, 12)}`;
export const packAssetName = (treeHash: string, sha256: string): string => `minimap-tiles-${packId(treeHash, sha256)}.tar`;
export const packTag = (clientVersion: string, treeHash: string, sha256: string): string => `minimap-${clientVersion}-${packId(treeHash, sha256)}`;

export function packPointer(tar: Uint8Array, treeHash: string, clientVersion: string): PackPointer {
  const sha256 = sha256Hex(tar);
  return { asset: packAssetName(treeHash, sha256), tag: packTag(clientVersion, treeHash, sha256), bytes: tar.length, sha256, treeHash, client: clientVersion, contents: PACK_CONTENTS };
}

/**
 * The rules a committed pointer's name, tag and contents follow, shared by `readCommittedPack`
 * (tools/build), M7 and the dist audit (review finding MD-06): the asset and the tag named by its
 * tree hash and SHA-256, the tag by its client version, and the contents `PACK_CONTENTS`. Empty
 * when the pointer is well formed.
 */
export function pointerNameProblems(pointer: { readonly asset?: unknown; readonly tag?: unknown; readonly treeHash?: unknown; readonly sha256?: unknown; readonly client?: unknown; readonly contents?: unknown }): string[] {
  const hex64 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
  if (!hex64(pointer.treeHash) || !hex64(pointer.sha256) || typeof pointer.client !== 'string' || !/^[0-9]+(?:\.[0-9]+)*$/.test(pointer.client)) {
    return ['the pointer needs a 64-hex treeHash, a 64-hex sha256 and a dotted client version'];
  }
  const problems: string[] = [];
  const asset = packAssetName(pointer.treeHash, pointer.sha256);
  const tag = packTag(pointer.client, pointer.treeHash, pointer.sha256);
  if (pointer.asset !== asset) problems.push(`the asset must be named ${asset} (minimap-tiles-<tree hash 12>-<pack SHA-256 12>.tar)`);
  if (pointer.tag !== tag) problems.push(`the release tag must be ${tag} (minimap-<client version>-<tree hash 12>-<pack SHA-256 12>)`);
  if (JSON.stringify(pointer.contents) !== JSON.stringify(PACK_CONTENTS)) problems.push(`the contents must be ${PACK_CONTENTS.join(', ')}`);
  return problems;
}
