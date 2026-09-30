import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { lfBytes, sha256Hex } from './hash';
import { formatJson } from './json';
import { MINIMAP_ALTERATIONS, MINIMAP_KEPT, minimapParameters, parseMinimapManifest } from './minimap-manifest';
import { minimapNoticeText } from './minimap-notice';
import { packFiles, packPointer, tarArchive, tilesTreeHash, type PackFile, type PackPointer } from './minimap-pack';
import { MINIMAP_INDEX_FILE, MINIMAP_MANIFEST_FILE, MINIMAP_POINTER_FILE, MINIMAP_TILE_PATH, MINIMAP_TILES_DIR, PACK_CONTENTS } from './minimap-params';

/**
 * The minimap folder's manifest, NOTICE, pointer and pack re-derived **without the client** from
 * the committed tiles and the committed manifest (review findings MD-01, MD-02, MD-05; used on
 * 2026-09-30, when the installed Forever client had moved from the pinned 1.60.1.70009 to
 * 1.60.1.70124, so `minimap.ts` could not run).
 *
 * Only what the code, not the client, decides is recomputed: the tool tree hash and file count, the
 * alterations and what is kept (their wording), the pack record's shape, the NOTICE (a function of
 * the manifest), the pack and the pointer. Everything the client decided is carried over byte for
 * byte: the client pin, every source record, the census, the levels, the sea keys, the liquid grids,
 * the encoder and Node that encoded the tiles, and every file's size and SHA-256. It refuses unless
 * every tile under `t/` and `index.json` match the manifest, nothing unlisted is under `t/`, the
 * tiles' tree hash is the recorded one, and the recorded parameters equal `minimap-params.ts`'s (a
 * change of any parameter changes pixels, and only the client rebuild can make those).
 *
 * The manifest says what was done: `tool.remanifest` names the tool tree hash of the last build from
 * the client, the pack it pinned and why. It is not the §23.4 gate: `maps:validate` MT fails while
 * the record is there, `minimap.ts --check --pack` on the pinned client still differs (the client
 * build writes no such record), and a pack re-derived this way is not published until that gate
 * passes. No bitwise operators.
 */

export interface RemanifestRecord {
  /** The tool tree hash of the last build that ran on the pinned client. */
  readonly fromToolTreeHash: string;
  /** The SHA-256 of the pack that build's pointer pinned, when there was one. */
  readonly fromPackSha256: string | null;
  readonly why: string;
}

export interface Remanifest {
  readonly manifestText: string;
  readonly noticeText: string;
  readonly pointer: PackPointer;
  readonly pointerText: string;
  readonly pack: Buffer;
  readonly record: RemanifestRecord;
  readonly tiles: number;
}

type Json = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

function listTree(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    if (statSync(path).isDirectory()) out.push(...listTree(path, rel));
    else out.push(rel);
  }
  return out;
}

/** The re-derived files of the minimap folder `dir` for the tool tree `tool` (`toolTreeHash` of `minimap.ts`). */
export function remanifestMinimap(dir: string, tool: { readonly hash: string; readonly files: number }, why: string): Remanifest {
  const problems: string[] = [];
  const raw = JSON.parse(lfBytes(readFileSync(join(dir, MINIMAP_MANIFEST_FILE))).toString('utf8')) as unknown;
  if (!isRecord(raw) || raw['kind'] !== 'map-minimap' || raw['schema'] !== 1) throw new Error(`${MINIMAP_MANIFEST_FILE}: not a schema-1 minimap manifest`);
  const recordedTool = raw['tool'];
  const pack = raw['pack'];
  const files = raw['files'];
  if (!isRecord(recordedTool) || typeof recordedTool['toolTreeHash'] !== 'string' || !isRecord(pack) || typeof pack['treeHash'] !== 'string' || !Array.isArray(files)) {
    throw new Error(`${MINIMAP_MANIFEST_FILE}: needs tool.toolTreeHash, pack.treeHash and files`);
  }
  if (JSON.stringify(raw['parameters']) !== JSON.stringify(minimapParameters())) {
    problems.push("the manifest's parameters are not minimap-params.ts's: the tiles must be rebuilt from the pinned client (tools/maps/minimap.ts)");
  }
  // every listed file present with its size and SHA-256; nothing unlisted under t/
  const tiles: PackFile[] = [];
  const listed = new Set<string>();
  for (const entry of files as unknown[]) {
    if (!isRecord(entry) || typeof entry['path'] !== 'string' || typeof entry['bytes'] !== 'number' || typeof entry['sha256'] !== 'string') {
      problems.push(`${MINIMAP_MANIFEST_FILE}: files[] entry ${JSON.stringify(entry)} needs path, bytes and sha256`);
      continue;
    }
    const path = entry['path'];
    listed.add(path);
    const file = join(dir, path);
    if (!existsSync(file)) {
      problems.push(`${path}: missing (fetch the pack or build the tiles first)`);
      continue;
    }
    const bytes = readFileSync(file);
    const same = path === MINIMAP_INDEX_FILE ? lfBytes(bytes) : bytes;
    if (same.length !== entry['bytes'] || sha256Hex(same) !== entry['sha256']) problems.push(`${path}: size or SHA-256 differs from the manifest`);
    else if (MINIMAP_TILE_PATH.test(path)) tiles.push({ path, bytes });
  }
  const extra = listTree(join(dir, MINIMAP_TILES_DIR)).map((p) => `${MINIMAP_TILES_DIR}/${p}`).filter((p) => !listed.has(p));
  if (extra.length > 0) problems.push(`${String(extra.length)} files under ${MINIMAP_TILES_DIR}/ are not in the manifest (first ${extra[0] ?? ''})`);
  const treeHash = tilesTreeHash(tiles.map((t) => ({ path: t.path, sha256: sha256Hex(t.bytes) })));
  if (problems.length === 0 && treeHash !== pack['treeHash']) problems.push(`the tiles' tree hash ${treeHash.slice(0, 12)}… is not the manifest's ${String(pack['treeHash']).slice(0, 12)}…`);
  if (problems.length > 0) throw new Error(`remanifest refused:\n  - ${problems.slice(0, 20).join('\n  - ')}`);

  const previous = recordedTool['remanifest'];
  const pointerPath = join(dir, MINIMAP_POINTER_FILE);
  const pinned = existsSync(pointerPath) ? (JSON.parse(readFileSync(pointerPath, 'utf8')) as unknown) : null;
  const record: RemanifestRecord =
    isRecord(previous) && typeof previous['fromToolTreeHash'] === 'string'
      ? { fromToolTreeHash: previous['fromToolTreeHash'], fromPackSha256: typeof previous['fromPackSha256'] === 'string' ? previous['fromPackSha256'] : null, why }
      : { fromToolTreeHash: recordedTool['toolTreeHash'], fromPackSha256: isRecord(pinned) && typeof pinned['sha256'] === 'string' ? pinned['sha256'] : null, why };
  const { remanifest: _dropped, ...kept } = recordedTool;
  void _dropped;
  const value = {
    ...raw,
    tool: { ...kept, toolTreeHash: tool.hash, toolFiles: tool.files, remanifest: record },
    alterations: MINIMAP_ALTERATIONS,
    kept: MINIMAP_KEPT,
    pack: { treeHash, contents: PACK_CONTENTS },
  };
  const manifestText = formatJson(value);
  const parsed = parseMinimapManifest(JSON.parse(manifestText) as unknown);
  if (parsed.manifest === null) throw new Error(`the re-derived manifest does not parse: ${parsed.errors.join('; ')}`);
  const noticeText = minimapNoticeText(parsed.manifest);
  const tar = tarArchive(packFiles(noticeText, manifestText, tiles));
  const pointer = packPointer(tar, treeHash, parsed.manifest.client.version);
  return { manifestText, noticeText, pointer, pointerText: formatJson(pointer), pack: tar, record, tiles: tiles.length };
}
