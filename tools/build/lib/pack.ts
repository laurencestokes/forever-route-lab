import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lfBytes, sha256Hex } from '../../maps/lib/hash';
import { packFiles, pointerNameProblems, tarArchive, TAR_BLOCK, tilesTreeHash, type PackPointer } from '../../maps/lib/minimap-pack';
import { MINIMAP_MANIFEST_FILE, MINIMAP_NOTICE_FILE, MINIMAP_POINTER_FILE, MINIMAP_TILE_PATH, MINIMAP_TILES_DIR, PACK_CONTENTS } from '../../maps/lib/minimap-params';
import { compareStrings } from './fs';

/**
 * The minimap tile pack outside the tile tool (docs/research/map-atlas.md Part II §23.3, §23.4;
 * D-049 O14, A17, A18; step MM.6): read the committed pointer, manifest and NOTICE; obtain the pack
 * (a path, a `file:` or `http(s):` URL, `gh release download`, or the local cache); verify it; install
 * its tiles; and assemble the same pack from built tiles. The pack's format belongs to
 * `tools/maps/lib/minimap-pack.ts` (an uncompressed ustar tar of `NOTICE.md`, `manifest.json` and
 * `t/`, in that order); this module reads it strictly and never writes outside the folder it is given.
 *
 * Nothing here publishes or uploads anything: publishing the release is the owner's step (OD-13).
 */

/**
 * Where the release lives: the project's repository on GitHub. `--repo` overrides it; the Pages
 * workflow passes its own repository, the one whose release it checks, so the two agree (D-053).
 */
export const MINIMAP_RELEASE_REPOSITORY = 'laurencestokes/forever-route-lab';
/** The local cache of packs: gitignored (`.cache/`), shared with `tools/maps/minimap.ts --pack`. */
export const MINIMAP_PACK_CACHE = '.cache/minimap-pack';

export class PackError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(problems.length === 1 ? (problems[0] ?? '') : `${String(problems.length)} problems:\n  - ${problems.slice(0, 20).join('\n  - ')}${problems.length > 20 ? `\n  - … ${String(problems.length - 20)} more` : ''}`);
    this.name = 'PackError';
    this.problems = problems;
  }
}

export interface ManifestTile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** The committed side of the pack: what `main` pins. */
export interface CommittedPack {
  readonly dir: string;
  readonly pointer: PackPointer;
  /** `NOTICE.md` and `manifest.json` as git stores them (LF). */
  readonly notice: Buffer;
  readonly manifest: Buffer;
  /** The manifest's tiles, in path (code-unit) order. */
  readonly tiles: readonly ManifestTile[];
}

type Json = Readonly<Record<string, unknown>>;
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const HEX64 = /^[0-9a-f]{64}$/;

function parseJson(path: string, problems: string[]): unknown {
  try {
    return JSON.parse(lfBytes(readFileSync(path)).toString('utf8')) as unknown;
  } catch (error) {
    problems.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Reads and cross-checks the committed folder: the pointer's shape, the manifest's tiles, the tree
 * hash over them (equal to the pointer's and the manifest's pack record), and the asset name and
 * release tag (`minimap-tiles-<tree hash 12>-<pack SHA-256 12>.tar`, `pointerNameProblems`). Returns
 * null when the folder has neither `manifest.json` nor `pack.json` (never built, or removed on
 * request, §23.3): there is nothing to fetch.
 */
export function readCommittedPack(dir: string): CommittedPack | null {
  const manifestPath = join(dir, MINIMAP_MANIFEST_FILE);
  const pointerPath = join(dir, MINIMAP_POINTER_FILE);
  const noticePath = join(dir, MINIMAP_NOTICE_FILE);
  if (!existsSync(manifestPath) && !existsSync(pointerPath)) return null;
  const problems: string[] = [];
  for (const [path, name] of [
    [manifestPath, MINIMAP_MANIFEST_FILE],
    [pointerPath, MINIMAP_POINTER_FILE],
    [noticePath, MINIMAP_NOTICE_FILE],
  ] as const) {
    if (!existsSync(path)) problems.push(`${name} is missing from ${dir}`);
  }
  if (problems.length > 0) throw new PackError(problems);
  const pointerJson = parseJson(pointerPath, problems);
  const manifestJson = parseJson(manifestPath, problems);
  if (problems.length > 0) throw new PackError(problems);

  const p = isRecord(pointerJson) ? pointerJson : {};
  if (typeof p['bytes'] !== 'number' || !Number.isInteger(p['bytes']) || p['bytes'] <= 0) problems.push(`${MINIMAP_POINTER_FILE}: bytes must be a positive integer`);
  if (typeof p['sha256'] !== 'string' || !HEX64.test(p['sha256'])) problems.push(`${MINIMAP_POINTER_FILE}: sha256 must be 64 hex digits`);
  if (typeof p['treeHash'] !== 'string' || !HEX64.test(p['treeHash'])) problems.push(`${MINIMAP_POINTER_FILE}: treeHash must be 64 hex digits`);
  if (typeof p['client'] !== 'string') problems.push(`${MINIMAP_POINTER_FILE}: client must be a string`);
  // the asset and tag carry the tree hash and the pack's SHA-256, so two packs never share a name (MD-02)
  for (const problem of pointerNameProblems(p)) problems.push(`${MINIMAP_POINTER_FILE}: ${problem}`);

  const m = isRecord(manifestJson) ? manifestJson : {};
  const files = Array.isArray(m['files']) ? (m['files'] as unknown[]) : null;
  const tiles: ManifestTile[] = [];
  if (files === null) problems.push(`${MINIMAP_MANIFEST_FILE}: no files array`);
  else {
    for (const entry of files) {
      if (!isRecord(entry) || typeof entry['path'] !== 'string' || typeof entry['bytes'] !== 'number' || !Number.isInteger(entry['bytes']) || entry['bytes'] < 0 || typeof entry['sha256'] !== 'string' || !HEX64.test(entry['sha256'])) {
        problems.push(`${MINIMAP_MANIFEST_FILE}: files[] entry ${JSON.stringify(entry)} needs path, bytes and sha256`);
        break;
      }
      if (MINIMAP_TILE_PATH.test(entry['path'])) tiles.push({ path: entry['path'], bytes: entry['bytes'], sha256: entry['sha256'] });
      else if (entry['path'].startsWith(`${MINIMAP_TILES_DIR}/`)) problems.push(`${MINIMAP_MANIFEST_FILE}: ${entry['path']} is under ${MINIMAP_TILES_DIR}/ but is not a tile path`);
    }
    if (tiles.length === 0) problems.push(`${MINIMAP_MANIFEST_FILE}: lists no tiles`);
  }
  tiles.sort((a, b) => compareStrings(a.path, b.path));
  for (let i = 1; i < tiles.length; i += 1) if (tiles[i]?.path === tiles[i - 1]?.path) problems.push(`${MINIMAP_MANIFEST_FILE}: ${tiles[i]?.path ?? ''} is listed twice`);
  const pack = isRecord(m['pack']) ? m['pack'] : {};
  if (problems.length === 0) {
    const pointer = p as unknown as PackPointer;
    const tree = tilesTreeHash(tiles);
    if (tree !== pointer.treeHash) problems.push(`the tree hash over the manifest's tiles (${tree.slice(0, 12)}…) is not ${MINIMAP_POINTER_FILE}'s (${pointer.treeHash.slice(0, 12)}…)`);
    if (pack['treeHash'] !== pointer.treeHash || JSON.stringify(pack['contents']) !== JSON.stringify(PACK_CONTENTS)) problems.push(`the manifest's pack record (treeHash, contents) is not ${MINIMAP_POINTER_FILE}'s`);
    if ('asset' in pack || 'tag' in pack) problems.push(`the manifest's pack record names an asset or tag; only ${MINIMAP_POINTER_FILE} can, since they carry the pack's SHA-256`);
  }
  if (problems.length > 0) throw new PackError(problems);
  return {
    dir,
    pointer: p as unknown as PackPointer,
    notice: lfBytes(readFileSync(noticePath)),
    manifest: lfBytes(readFileSync(manifestPath)),
    tiles,
  };
}

// ---------------------------------------------------------------------------------------------
// The tar, read strictly

export interface TarEntry {
  readonly path: string;
  readonly data: Buffer;
}

/**
 * A ustar archive's regular files, in order. Refuses anything the pack tool does not write: a bad
 * header checksum, another magic, a type other than a regular file (no links, directories or
 * extended headers), a `prefix` field, data past the end, or bytes after the end blocks that are not
 * zero. Paths are returned as stored; the caller checks them against the manifest.
 */
export function readTar(tar: Uint8Array): TarEntry[] {
  const buf = Buffer.from(tar.buffer, tar.byteOffset, tar.byteLength);
  if (buf.length % TAR_BLOCK !== 0) throw new PackError([`the pack is ${String(buf.length)} B, not whole 512-byte blocks`]);
  const out: TarEntry[] = [];
  let at = 0;
  for (;;) {
    if (at + TAR_BLOCK > buf.length) throw new PackError(['the pack ends without its two zero blocks']);
    const h = buf.subarray(at, at + TAR_BLOCK);
    if (h.every((b) => b === 0)) {
      if (!buf.subarray(at).every((b) => b === 0)) throw new PackError([`the pack has bytes after its end block at ${String(at)}`]);
      if (buf.length - at < 2 * TAR_BLOCK) throw new PackError(['the pack ends without its two zero blocks']);
      return out;
    }
    let sum = 0;
    for (let i = 0; i < TAR_BLOCK; i += 1) sum += i >= 148 && i < 156 ? 32 : (h[i] ?? 0);
    const recorded = parseInt(h.toString('latin1', 148, 156).replace(/[\0 ]+$/, ''), 8);
    const nameEnd = h.indexOf(0);
    const path = h.toString('utf8', 0, nameEnd < 0 || nameEnd > 100 ? 100 : nameEnd);
    const where = `pack entry ${String(out.length)} (${JSON.stringify(path)})`;
    if (recorded !== sum) throw new PackError([`${where}: header checksum ${String(recorded)}, computed ${String(sum)}`]);
    if (h.toString('latin1', 257, 263) !== 'ustar\0') throw new PackError([`${where}: not a ustar header`]);
    const type = h.toString('latin1', 156, 157);
    if (type !== '0' && type !== '\0') throw new PackError([`${where}: type ${JSON.stringify(type)} is not a regular file`]);
    if (!h.subarray(345, 500).every((b) => b === 0)) throw new PackError([`${where}: uses the ustar prefix field`]);
    const sizeText = h.toString('latin1', 124, 136).replace(/[\0 ]+$/, '');
    if (!/^[0-7]+$/.test(sizeText)) throw new PackError([`${where}: size ${JSON.stringify(sizeText)} is not octal`]);
    const size = parseInt(sizeText, 8);
    const start = at + TAR_BLOCK;
    if (start + size > buf.length) throw new PackError([`${where}: its ${String(size)} B run past the end of the pack`]);
    out.push({ path, data: buf.subarray(start, start + size) });
    at = start + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
  }
}

// ---------------------------------------------------------------------------------------------
// Verify

export interface VerifiedPack {
  readonly tiles: readonly TarEntry[];
}

/**
 * The pack against the committed files (§23.3): its size and SHA-256 are the pointer's; it holds
 * `NOTICE.md` first and `manifest.json` second, each byte-equal to the committed one; then exactly
 * the manifest's tiles, in path order, each with the manifest's size and SHA-256. Every tile is
 * checked even when the pack's hash matches, so a pointer written for a tampered pack still fails.
 */
export function verifyPack(tar: Uint8Array, committed: CommittedPack): VerifiedPack {
  const { pointer } = committed;
  if (tar.length !== pointer.bytes) throw new PackError([`the pack is ${String(tar.length)} B; ${MINIMAP_POINTER_FILE} pins ${String(pointer.bytes)} B`]);
  const sha = sha256Hex(tar);
  if (sha !== pointer.sha256) throw new PackError([`the pack's SHA-256 is ${sha}; ${MINIMAP_POINTER_FILE} pins ${pointer.sha256}`]);
  const entries = readTar(tar);
  const problems: string[] = [];
  const [notice, manifest, ...tiles] = entries;
  if (notice?.path !== MINIMAP_NOTICE_FILE) problems.push(`the pack's first file is ${notice?.path ?? 'nothing'}, not ${MINIMAP_NOTICE_FILE}`);
  else if (!notice.data.equals(committed.notice)) problems.push(`the pack's ${MINIMAP_NOTICE_FILE} is not the committed one`);
  if (manifest?.path !== MINIMAP_MANIFEST_FILE) problems.push(`the pack's second file is ${manifest?.path ?? 'nothing'}, not ${MINIMAP_MANIFEST_FILE}`);
  else if (!manifest.data.equals(committed.manifest)) problems.push(`the pack's ${MINIMAP_MANIFEST_FILE} is not the committed one`);
  const want = committed.tiles;
  for (const [i, t] of tiles.entries()) {
    if (!MINIMAP_TILE_PATH.test(t.path)) {
      problems.push(`the pack holds ${JSON.stringify(t.path)}, which is not a tile path under ${MINIMAP_TILES_DIR}/`);
      continue;
    }
    const w = want[i];
    if (w?.path !== t.path) {
      problems.push(`the pack's tile ${String(i)} is ${t.path}; the manifest's is ${w?.path ?? 'none'} (the tiles must be the manifest's, in path order)`);
      break;
    }
    if (t.data.length !== w.bytes || sha256Hex(t.data) !== w.sha256) problems.push(`${t.path}: size or SHA-256 differs from the manifest`);
  }
  if (tiles.length !== want.length) problems.push(`the pack holds ${String(tiles.length)} tiles; the manifest lists ${String(want.length)}`);
  if (problems.length > 0) throw new PackError(problems);
  return { tiles };
}

// ---------------------------------------------------------------------------------------------
// The tiles on disk

/** Every file under `dir`, relative and `/`-separated, in code-unit order. */
export function listTree(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    if (statSync(path).isDirectory()) out.push(...listTree(path, rel));
    else out.push(rel);
  }
  return out.sort(compareStrings);
}

/** The tiles present under `<dir>/t/`, as `t/…` paths. */
export const presentTiles = (dir: string): string[] => listTree(join(dir, MINIMAP_TILES_DIR)).map((p) => `${MINIMAP_TILES_DIR}/${p}`);

/**
 * Writes the verified tiles under `<dir>/t/`: a tile already there with the same bytes is kept,
 * anything else under `t/` that the manifest does not list is removed (a stale tile from another
 * build), and empty folders are pruned.
 */
export function installTiles(dir: string, tiles: readonly TarEntry[]): { readonly written: number; readonly kept: number; readonly removed: number } {
  const wanted = new Map(tiles.map((t) => [t.path, t.data]));
  let removed = 0;
  for (const path of presentTiles(dir)) {
    if (!wanted.has(path)) {
      rmSync(join(dir, path));
      removed += 1;
    }
  }
  let written = 0;
  let kept = 0;
  for (const t of tiles) {
    if (!MINIMAP_TILE_PATH.test(t.path)) throw new PackError([`refusing to write ${JSON.stringify(t.path)}`]);
    const path = join(dir, t.path);
    if (existsSync(path) && readFileSync(path).equals(t.data)) {
      kept += 1;
      continue;
    }
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, t.data);
    written += 1;
  }
  const prune = (folder: string): void => {
    if (!existsSync(folder)) return;
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      if (!statSync(path).isDirectory()) continue;
      prune(path);
      if (readdirSync(path).length === 0) rmSync(path, { recursive: true });
    }
  };
  prune(join(dir, MINIMAP_TILES_DIR));
  return { written, kept, removed };
}

/**
 * The pack assembled from the tiles under `<dir>/t/` (the local command, `pnpm maps:minimap:pack`):
 * every listed tile must be present with the manifest's size and SHA-256 and nothing else may be
 * under `t/`; the result must be the pack `pack.json` pins, byte for byte (the format is
 * deterministic, so the same NOTICE, manifest and tiles always give the same pack).
 */
export function assemblePack(committed: CommittedPack): Buffer {
  const present = presentTiles(committed.dir);
  const listed = new Map(committed.tiles.map((t) => [t.path, t]));
  const problems: string[] = [];
  const extra = present.filter((p) => !listed.has(p));
  if (extra.length > 0) problems.push(`${String(extra.length)} files under ${MINIMAP_TILES_DIR}/ are not in the manifest (first ${extra[0] ?? ''})`);
  const have = new Set(present);
  const missing = committed.tiles.filter((t) => !have.has(t.path));
  if (missing.length > 0) problems.push(`${String(missing.length)} of ${String(committed.tiles.length)} tiles are missing under ${MINIMAP_TILES_DIR}/ (first ${missing[0]?.path ?? ''}); build them with tools/maps/minimap.ts or fetch the pack`);
  if (problems.length > 0) throw new PackError(problems);
  const tiles = committed.tiles.map((t) => {
    const bytes = readFileSync(join(committed.dir, t.path));
    if (bytes.length !== t.bytes || sha256Hex(bytes) !== t.sha256) problems.push(`${t.path}: size or SHA-256 differs from the manifest`);
    return { path: t.path, bytes };
  });
  if (problems.length > 0) throw new PackError(problems);
  const tar = tarArchive(packFiles(committed.notice.toString('utf8'), committed.manifest.toString('utf8'), tiles));
  if (tar.length !== committed.pointer.bytes || sha256Hex(tar) !== committed.pointer.sha256) {
    throw new PackError([`the assembled pack (${String(tar.length)} B, SHA-256 ${sha256Hex(tar)}) is not the one ${MINIMAP_POINTER_FILE} pins (${String(committed.pointer.bytes)} B, ${committed.pointer.sha256}); rebuild with tools/maps/minimap.ts`]);
  }
  return tar;
}

// ---------------------------------------------------------------------------------------------
// Obtain

/** The release asset's download address for the pointer. */
export const releaseUrl = (repository: string, pointer: PackPointer): string => `https://github.com/${repository}/releases/download/${encodeURIComponent(pointer.tag)}/${encodeURIComponent(pointer.asset)}`;

/**
 * Downloads `url` with the runtime's `fetch` (redirects followed), refusing a failed response or
 * more than `maxBytes`.
 */
export async function download(url: string, maxBytes: number, fetcher: typeof fetch = fetch): Promise<Buffer> {
  const response = await fetcher(url, { redirect: 'follow' });
  if (!response.ok || response.body === null) throw new PackError([`${url}: HTTP ${String(response.status)} ${response.statusText}`]);
  const reader = response.body.getReader();
  const parts: Buffer[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new PackError([`${url}: more than the ${String(maxBytes)} B the pointer pins`]);
    }
    parts.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(parts, length);
}

/** `gh release download` into a temporary folder (the GitHub CLI brings its own sign-in, for a private repository or a workflow's `GH_TOKEN`). */
export function ghDownload(repository: string, pointer: PackPointer, run: (file: string, args: readonly string[]) => void = (file, args) => execFileSync(file, args, { stdio: 'inherit' })): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'frl-minimap-pack-'));
  try {
    run('gh', ['release', 'download', pointer.tag, '--repo', repository, '--pattern', pointer.asset, '--dir', dir, '--clobber']);
    const path = join(dir, pointer.asset);
    if (!existsSync(path)) throw new PackError([`gh release download did not produce ${pointer.asset}`]);
    return readFileSync(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** What a source string names: `gh`, an `http(s):` URL, a `file:` URL or a path (relative to `cwd`). */
export type PackSource = { readonly kind: 'gh' } | { readonly kind: 'url'; readonly url: string } | { readonly kind: 'path'; readonly path: string };

export function parsePackSource(source: string, cwd: string): PackSource {
  if (source === 'gh') return { kind: 'gh' };
  if (/^https?:\/\//i.test(source)) return { kind: 'url', url: source };
  if (/^file:/i.test(source)) return { kind: 'path', path: fileURLToPath(source) };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) throw new PackError([`${source}: only https:, http:, file: URLs, a path or "gh" are accepted`]);
  return { kind: 'path', path: resolve(cwd, source) };
}

export async function readPackSource(source: PackSource, repository: string, pointer: PackPointer, fetcher: typeof fetch = fetch): Promise<Buffer> {
  switch (source.kind) {
    case 'gh':
      return ghDownload(repository, pointer);
    case 'url':
      return download(source.url, pointer.bytes, fetcher);
    case 'path':
      if (!existsSync(source.path)) throw new PackError([`${source.path}: no such file`]);
      return readFileSync(source.path);
  }
}

/** The cached pack, when it is there and is the one the pointer pins; otherwise null. */
export function readCachedPack(cacheDir: string, pointer: PackPointer): Buffer | null {
  const path = join(cacheDir, pointer.asset);
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  return bytes.length === pointer.bytes && sha256Hex(bytes) === pointer.sha256 ? bytes : null;
}

/** Keeps a verified pack in the cache (written beside, then renamed, so a cut-off write never looks complete). */
export function cachePack(cacheDir: string, pointer: PackPointer, tar: Uint8Array): string {
  const path = join(cacheDir, pointer.asset);
  if (existsSync(path) && readFileSync(path).equals(tar)) return path;
  mkdirSync(cacheDir, { recursive: true });
  const part = `${path}.part`;
  writeFileSync(part, tar);
  renameSync(part, path);
  return path;
}
