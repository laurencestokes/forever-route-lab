import { closeSync, openSync, readSync } from 'node:fs';
import { allZero, md5Hex, type ByteRange } from './bytes';
import { decodeBlte, type BlteChunk } from './blte';
import { checkPin, readBuildInfo, selectProduct, type BuildInfoRow, type BuildPin } from './buildinfo';
import { readBuildConfig, type BuildConfig } from './config';
import { EncodingTable } from './encoding';
import { CascError } from './errors';
import { LocalIndex, type IndexEntry } from './idx';
import { archivePath } from './paths';
import { RootManifest, type RootStats } from './root';

/**
 * A read-only local CASC storage (docs/research/terrain-navigation.md §2.1, §15):
 *
 * `.build.info` → build config → local indices → `data.NNN` → BLTE → encoding (CKey → EKey)
 * → root (FileDataID → CKey) → a file by FileDataID, checked MD5(decoded) = CKey.
 *
 * - Reads only `<install>/.build.info` and `<install>/Data/{config,data}` (tools/casc/paths.ts),
 *   opening every file read-only. Nothing is written anywhere, and no file is ever fetched from a
 *   CDN: a file that is not stored locally is an error.
 * - Encrypted BLTE chunks are never decrypted. `file()` refuses a file with an encrypted chunk
 *   unless the caller asks for `encrypted: 'zero-fill'` (DB2 tables with encrypted sections).
 * - Archive entries normally start with a 0x1E-byte local header before `BLTE`; some start with
 *   `BLTE` directly (273 at 1.60.1.70009). Both are read; the headerless ones are counted.
 */

export interface CascOpenOptions {
  /** The install root (usually `resolveInstall()`). */
  readonly install: string;
  /** The `.build.info` product, for example `wow_classic_beta`. */
  readonly product: string;
  /** When given, the installed version and build key must equal it (gate G1). */
  readonly pin?: BuildPin;
}

export interface CascFileOptions {
  /**
   * `fail` (default): an encrypted chunk is an `encrypted` error.
   * `zero-fill`: encrypted chunks come back as zeros, listed in `encryptedRanges`; the MD5 check
   * is skipped for such a file (`verified` false), and runs for every other file.
   */
  readonly encrypted?: 'fail' | 'zero-fill';
}

export interface CascFile {
  readonly fileDataId: number;
  readonly ckey: string;
  readonly ekey: string;
  readonly data: Buffer;
  /** True when MD5(data) was checked against the CKey (always, unless chunks were zero-filled). */
  readonly verified: boolean;
  readonly chunks: readonly BlteChunk[];
  readonly encryptedRanges: readonly ByteRange[];
  readonly keyNames: readonly string[];
  /** Bytes stored in the archive, local header included. */
  readonly storedSize: number;
  readonly headerless: boolean;
}

export interface CascStats {
  readonly indexEntries: number;
  readonly indexFiles: readonly string[];
  readonly encodingBytes: number;
  readonly encodingPages: number;
  readonly rootBytes: number;
  readonly root: RootStats;
  /** Milliseconds per open step (indices, encoding, root) and in total. Not deterministic. */
  readonly openMs: Readonly<Record<'indices' | 'encoding' | 'root' | 'total', number>>;
}

const LOCAL_HEADER_SIZE = 0x1e;

export class LocalCasc {
  readonly install: string;
  readonly build: BuildInfoRow;
  readonly buildConfig: BuildConfig;
  readonly stats: CascStats;
  private readonly index: LocalIndex;
  private readonly encoding: EncodingTable;
  private readonly root: RootManifest;
  private readonly descriptors = new Map<number, number>();
  private headerlessCount = 0;

  private constructor(
    install: string,
    build: BuildInfoRow,
    buildConfig: BuildConfig,
    parts: { index: LocalIndex; encoding: EncodingTable; root: RootManifest; stats: CascStats },
  ) {
    this.install = install;
    this.build = build;
    this.buildConfig = buildConfig;
    this.index = parts.index;
    this.encoding = parts.encoding;
    this.root = parts.root;
    this.stats = parts.stats;
  }

  static open(options: CascOpenOptions): LocalCasc {
    const build = selectProduct(readBuildInfo(options.install), options.product);
    if (options.pin !== undefined) checkPin(build, options.pin);
    const buildConfig = readBuildConfig(options.install, build.buildKey);
    const t0 = performance.now();
    const index = LocalIndex.read(options.install);
    const t1 = performance.now();
    const descriptors = new Map<number, number>();
    try {
      const read = (ekey: string, ckey: string, what: string): Buffer => {
        const entry = index.lookup(ekey);
        if (entry === null) throw new CascError('missing', `${what} (EKey ${ekey}) is not in the local indices`);
        const stored = readEntry(options.install, descriptors, entry);
        const decoded = decodeBlte(stored.blte);
        if (decoded.encryptedRanges.length > 0) throw new CascError('encrypted', `${what} has encrypted chunks`);
        if (md5Hex(decoded.data) !== ckey) throw new CascError('integrity', `${what}: MD5 of the decoded bytes is not its CKey ${ckey}`);
        return decoded.data;
      };
      const encodingBytes = read(buildConfig.encodingEKey, buildConfig.encodingCKey, 'encoding table');
      const encoding = EncodingTable.parse(encodingBytes);
      const t2 = performance.now();
      const rootHit = encoding.lookup(buildConfig.rootCKey);
      if (rootHit === null) throw new CascError('missing', `root CKey ${buildConfig.rootCKey} is not in the encoding table`);
      const rootBytes = read(rootHit.ekey, buildConfig.rootCKey, 'root manifest');
      const root = RootManifest.parse(rootBytes);
      const t3 = performance.now();
      const stats: CascStats = {
        indexEntries: index.entryCount,
        indexFiles: index.files,
        encodingBytes: encodingBytes.length,
        encodingPages: encoding.pageCount,
        rootBytes: rootBytes.length,
        root: root.stats,
        openMs: { indices: t1 - t0, encoding: t2 - t1, root: t3 - t2, total: t3 - t0 },
      };
      const casc = new LocalCasc(options.install, build, buildConfig, { index, encoding, root, stats });
      for (const [archive, fd] of descriptors) casc.descriptors.set(archive, fd);
      return casc;
    } catch (error) {
      for (const fd of descriptors.values()) closeSync(fd);
      throw error;
    }
  }

  /** Closes the archive file descriptors. The instance must not be used afterwards. */
  close(): void {
    for (const fd of this.descriptors.values()) closeSync(fd);
    this.descriptors.clear();
  }

  /** True when the root manifest has an enUS entry for the FileDataID. */
  has(fileDataId: number): boolean {
    return this.root.has(fileDataId);
  }

  /** The CKey of a FileDataID (for input hashes), or null when the root has none. */
  ckeyOf(fileDataId: number): string | null {
    return this.root.ckey(fileDataId);
  }

  /** True when the root manifest flags the FileDataID's entry as encrypted. */
  encryptedFlag(fileDataId: number): boolean {
    return this.root.encryptedFlag(fileDataId);
  }

  /** Archive entries seen so far that start with `BLTE` instead of a local header. */
  get headerlessEntries(): number {
    return this.headerlessCount;
  }

  /** The FileDataIDs the root manifest keeps, ascending. */
  fileDataIds(): Uint32Array {
    return this.root.fileDataIds();
  }

  /**
   * A file by FileDataID. Fails closed: `missing` when the root, encoding or local index has no
   * entry, or the archive holds only a zero-filled placeholder (the client streams such data
   * later); `encrypted` for an encrypted chunk (unless zero-fill is asked for); `integrity` when
   * MD5(decoded) is not the CKey.
   */
  file(fileDataId: number, options: CascFileOptions = {}): CascFile {
    const ckey = this.root.ckey(fileDataId);
    if (ckey === null) throw new CascError('missing', `FileDataID ${String(fileDataId)} is not in the root manifest (enUS)`);
    const hit = this.encoding.lookup(ckey);
    if (hit === null) throw new CascError('missing', `FileDataID ${String(fileDataId)}: CKey ${ckey} is not in the encoding table`);
    const entry = this.index.lookup(hit.ekey);
    if (entry === null) throw new CascError('missing', `FileDataID ${String(fileDataId)}: EKey ${hit.ekey} is not stored locally`);
    const stored = readEntry(this.install, this.descriptors, entry);
    if (stored.headerless) this.headerlessCount += 1;
    const decoded = decodeBlte(stored.blte);
    const zeroFill = options.encrypted === 'zero-fill';
    if (decoded.encryptedRanges.length > 0 && !zeroFill) {
      throw new CascError('encrypted', `FileDataID ${String(fileDataId)} has ${String(decoded.encryptedRanges.length)} encrypted chunk(s) (keys ${decoded.keyNames.join(', ')})`);
    }
    const verified = decoded.encryptedRanges.length === 0;
    if (verified && md5Hex(decoded.data) !== ckey) throw new CascError('integrity', `FileDataID ${String(fileDataId)}: MD5 of the decoded bytes is not its CKey ${ckey}`);
    if (hit.size !== decoded.data.length) {
      throw new CascError('integrity', `FileDataID ${String(fileDataId)}: decoded ${String(decoded.data.length)} bytes, the encoding table says ${String(hit.size)}`);
    }
    return {
      fileDataId,
      ckey,
      ekey: hit.ekey,
      data: decoded.data,
      verified,
      chunks: decoded.chunks,
      encryptedRanges: decoded.encryptedRanges,
      keyNames: decoded.keyNames,
      storedSize: entry.size,
      headerless: stored.headerless,
    };
  }
}

interface StoredEntry {
  readonly blte: Buffer;
  readonly headerless: boolean;
}

function readEntry(install: string, descriptors: Map<number, number>, entry: IndexEntry): StoredEntry {
  let fd = descriptors.get(entry.archive);
  if (fd === undefined) {
    fd = openSync(archivePath(install, entry.archive), 'r');
    descriptors.set(entry.archive, fd);
  }
  const bytes = Buffer.alloc(entry.size);
  const got = readSync(fd, bytes, 0, entry.size, entry.offset);
  if (got !== entry.size) throw new CascError('format', `archive ${String(entry.archive)}: read ${String(got)} of ${String(entry.size)} bytes at ${String(entry.offset)}`);
  if (bytes.toString('latin1', 0, 4) === 'BLTE') return { blte: bytes, headerless: true };
  if (bytes.length > LOCAL_HEADER_SIZE + 4 && bytes.toString('latin1', LOCAL_HEADER_SIZE, LOCAL_HEADER_SIZE + 4) === 'BLTE') {
    return { blte: bytes.subarray(LOCAL_HEADER_SIZE), headerless: false };
  }
  if (allZero(bytes)) throw new CascError('missing', `archive ${String(entry.archive)} holds only zeros at ${String(entry.offset)} (data not downloaded yet)`);
  throw new CascError('format', `archive ${String(entry.archive)} at ${String(entry.offset)}: no BLTE stream`);
}

