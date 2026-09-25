import type { DatasetIdentity } from '../../domain/dataset';
import { sha256Hex, type Sha256Digest } from '../hash';
import { decodeUtf8, type FetchInit, type FetchLike, isAbortError, joinUrl } from '../http';
import { computeDataRevision, type DataManifest, identityOf, type ManifestOutput, parseManifest } from './manifest';
import { DATA_JSON_FILES, DATA_NOTICE_FILE, type DataJsonFile, type DatasetFiles } from './rows';
import { datasetFilesOf, type FileContent, readDataFile } from './schema';

/**
 * Loads `public/data/` (ARCHITECTURE §5.2, DATA_PROVENANCE §8):
 *
 * 1. fetch `data/manifest.json` (revalidated, never a stale cached copy), check the fields the
 *    loader needs, and recompute its `dataRevision` from its outputs, so a hand-edited or
 *    truncated manifest is caught. The fixture slice's manifest is refused unless `allowSlice` is
 *    set (tests), so test data deployed by mistake never passes for the dataset;
 * 2. fetch every output it lists in parallel, and check each file's size and SHA-256 (WebCrypto)
 *    against the manifest. A mismatch is retried once bypassing the HTTP cache (a stale copy
 *    from a previous deploy), then fails with a clear error;
 * 3. decode (strict UTF-8), `JSON.parse` and check each JSON file against its spec (schema.ts),
 *    stripping the `_generated` wrapper.
 *
 * Each file's parse and check run in that file's own continuation, so no single task holds the
 * main thread for all of them. The result is plain data; `prepareDataset` (dataset-view.ts) turns
 * it into the synchronous `DatasetView`.
 */

export type DatasetLoadErrorCode =
  /** The browser cannot verify the files (no WebCrypto: not a secure context). */
  | 'unsupported'
  /** The request failed before any response (offline, blocked). */
  | 'network'
  /** The server answered with an error status. */
  | 'http'
  /** A file's size or SHA-256 differs from the manifest, or the manifest is inconsistent. */
  | 'integrity'
  /** A file is not UTF-8 JSON, or does not have the shape this app reads. */
  | 'format'
  /** The manifest is the test fixture slice's, and the loader was not asked to accept one. */
  | 'slice';

export class DatasetLoadError extends Error {
  override readonly name = 'DatasetLoadError';

  constructor(
    readonly code: DatasetLoadErrorCode,
    /** The file the problem is in, relative to `data/`; null for the load as a whole. */
    readonly file: string | null,
    message: string,
    /** Path-level problems (format errors), at most a handful. */
    readonly details: readonly string[] = [],
  ) {
    super(message);
  }
}

export interface DatasetLoadProgress {
  readonly phase: 'manifest' | 'files' | 'done';
  /** Files fetched and verified so far, of `filesTotal` (0 until the manifest is read). */
  readonly filesDone: number;
  readonly filesTotal: number;
  readonly bytesDone: number;
  readonly bytesTotal: number;
}

export interface DatasetLoaderOptions {
  readonly fetch: FetchLike;
  /** The app's base URL (`import.meta.env.BASE_URL`); the data lives under `<base>data/`. */
  readonly baseUrl: string;
  /** WebCrypto's digest, or null when it is unavailable (the load then fails as `unsupported`). */
  readonly sha256: Sha256Digest | null;
  readonly onProgress?: ((progress: DatasetLoadProgress) => void) | undefined;
  /** Aborts the load (also when already aborted on entry); the load then rejects with its reason. */
  readonly signal?: AbortSignal | undefined;
  /** A monotonic clock in ms for the timings (`performance.now`); timings are 0 without one. */
  readonly now?: (() => number) | undefined;
  /**
   * Accept the fixture slice (tests/fixtures/data, a manifest with `slice`). Only tests set it: the
   * app never does, so a deploy of the fixture fails to start instead of passing for the dataset.
   */
  readonly allowSlice?: boolean | undefined;
}

export interface FileTiming {
  /** Request start to verified bytes (fetch, read, hash; retries included). */
  readonly fetchMs: number;
  readonly hashMs: number;
  /** UTF-8 decoding and JSON.parse. */
  readonly parseMs: number;
  /** The shape check (schema.ts). */
  readonly checkMs: number;
  readonly bytes: number;
  readonly retried: boolean;
}

export interface LoadedDataset {
  readonly manifest: DataManifest;
  readonly identity: DatasetIdentity;
  readonly files: DatasetFiles;
  /** `NOTICE.md`, verified like every other output. */
  readonly notice: string;
  readonly timings: {
    readonly manifestMs: number;
    readonly totalMs: number;
    readonly files: Readonly<Record<string, FileTiming>>;
  };
}

export const MANIFEST_FILE = 'manifest.json';
const DATA_DIR = 'data/';

const short = (hash: string): string => `${hash.slice(0, 12)}…`;

interface Fetched {
  readonly bytes: ArrayBuffer;
  readonly hashMs: number;
  readonly retried: boolean;
}

class Loader {
  private readonly now: () => number;
  private readonly controller = new AbortController();

  constructor(
    private readonly opts: DatasetLoaderOptions,
    private readonly sha256: Sha256Digest,
  ) {
    this.now = opts.now ?? (() => 0);
    const signal = opts.signal;
    // A signal that is already aborted never fires 'abort' again: honour it now.
    if (signal?.aborted === true) this.controller.abort(signal.reason);
    else {
      signal?.addEventListener(
        'abort',
        () => {
          this.controller.abort(signal.reason);
        },
        { once: true },
      );
    }
  }

  private url(file: string): string {
    return joinUrl(this.opts.baseUrl, `${DATA_DIR}${file}`);
  }

  async get(file: string, cache: RequestCache): Promise<ArrayBuffer> {
    const init: FetchInit = { cache, signal: this.controller.signal };
    // Once the load is aborted (by the caller, or after another file failed), a failed request is
    // that abort, whatever the browser rejected it with (`signal.reason` when one was given).
    const network = (error: unknown, what: string): unknown =>
      isAbortError(error) || this.controller.signal.aborted
        ? error
        : new DatasetLoadError('network', file, `data/${file} could not be ${what} (${error instanceof Error ? error.message : String(error)}). Check the connection and reload.`);
    let response;
    try {
      response = await this.opts.fetch(this.url(file), init);
    } catch (error) {
      throw network(error, 'fetched');
    }
    if (!response.ok) {
      throw new DatasetLoadError(
        'http',
        file,
        `data/${file} could not be loaded: the server answered HTTP ${String(response.status)}. The deployed site may be incomplete.`,
      );
    }
    // The body arrives after the headers: a connection dropped mid-download fails here.
    try {
      return await response.arrayBuffer();
    } catch (error) {
      throw network(error, 'read to the end');
    }
  }

  /** Fetches one output and checks its size and hash; a mismatch is retried once past the cache. */
  async verified(output: ManifestOutput): Promise<Fetched> {
    let hashMs = 0;
    const attempt = async (cache: RequestCache): Promise<{ readonly bytes: ArrayBuffer; readonly problem: string | null }> => {
      const bytes = await this.get(output.path, cache);
      if (bytes.byteLength !== output.bytes) {
        return { bytes, problem: `it is ${String(bytes.byteLength)} bytes, the manifest says ${String(output.bytes)}` };
      }
      const start = this.now();
      const hash = await sha256Hex(this.sha256, bytes);
      hashMs += this.now() - start;
      return { bytes, problem: hash === output.sha256 ? null : `its SHA-256 is ${short(hash)}, the manifest says ${short(output.sha256)}` };
    };
    const first = await attempt('default');
    if (first.problem === null) return { bytes: first.bytes, hashMs, retried: false };
    const second = await attempt('reload');
    if (second.problem === null) return { bytes: second.bytes, hashMs, retried: true };
    throw new DatasetLoadError(
      'integrity',
      output.path,
      `data/${output.path} failed its integrity check: ${second.problem}. The deployed data files do not match each other, so none of them is used. Reload the page; if this persists, the site needs to be redeployed.`,
    );
  }

  parse(file: string, bytes: ArrayBuffer): unknown {
    let text: string;
    try {
      text = decodeUtf8(bytes);
    } catch {
      throw new DatasetLoadError('format', file, `data/${file} is not valid UTF-8 text.`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new DatasetLoadError('format', file, `data/${file} is not valid JSON (${error instanceof Error ? error.message : String(error)}).`);
    }
  }

  abort(reason: unknown): void {
    this.controller.abort(reason);
  }
}

async function readManifest(loader: Loader, sha256: Sha256Digest): Promise<DataManifest> {
  const bytes = await loader.get(MANIFEST_FILE, 'no-cache');
  const parsed = parseManifest(loader.parse(MANIFEST_FILE, bytes));
  if (!parsed.ok) {
    throw new DatasetLoadError(
      'format',
      MANIFEST_FILE,
      'data/manifest.json does not have the shape this version of the app reads.',
      parsed.errors.slice(0, 8),
    );
  }
  const revision = await computeDataRevision(sha256, parsed.manifest.outputs);
  if (revision !== parsed.manifest.dataRevision) {
    throw new DatasetLoadError(
      'integrity',
      MANIFEST_FILE,
      `data/manifest.json is inconsistent: its outputs hash to data revision ${short(revision)}, but it states ${short(parsed.manifest.dataRevision)}. It was edited or damaged; regenerate it with pnpm data:extract.`,
    );
  }
  return parsed.manifest;
}

/**
 * Loads, verifies and checks the dataset. Rejects with a `DatasetLoadError` (or the abort reason
 * when `signal` aborts); on the first failure the remaining requests are aborted.
 */
export async function loadDataset(opts: DatasetLoaderOptions): Promise<LoadedDataset> {
  opts.signal?.throwIfAborted();
  const sha256 = opts.sha256;
  if (sha256 === null) {
    throw new DatasetLoadError(
      'unsupported',
      null,
      'This browser cannot verify the data files: WebCrypto is only available on secure pages (https, or http on localhost). Open the site over https.',
    );
  }
  const loader = new Loader(opts, sha256);
  const now = opts.now ?? (() => 0);
  const start = now();
  const report = opts.onProgress ?? (() => undefined);
  report({ phase: 'manifest', filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 });

  const manifest = await readManifest(loader, sha256);
  if (manifest.slice !== null && opts.allowSlice !== true) {
    throw new DatasetLoadError(
      'slice',
      MANIFEST_FILE,
      `data/manifest.json describes the test fixture slice (${manifest.slice.label}), not the Forever dataset: the site was deployed with test data. It needs to be redeployed with public/data.`,
    );
  }
  const manifestMs = now() - start;
  const outputs = manifest.outputs;
  const bytesTotal = outputs.reduce((sum, o) => sum + o.bytes, 0);
  let filesDone = 0;
  let bytesDone = 0;
  report({ phase: 'files', filesDone, filesTotal: outputs.length, bytesDone, bytesTotal });

  const timings: Record<string, FileTiming> = {};
  const contents: Partial<Record<DataJsonFile, FileContent[DataJsonFile]>> = {};
  let notice = '';

  const one = async (output: ManifestOutput): Promise<void> => {
    const fetchStart = now();
    const fetched = await loader.verified(output);
    const fetchMs = now() - fetchStart;
    const parseStart = now();
    let checkMs = 0;
    if (output.path === DATA_NOTICE_FILE) {
      try {
        notice = decodeUtf8(fetched.bytes);
      } catch {
        throw new DatasetLoadError('format', output.path, 'data/NOTICE.md is not valid UTF-8 text.');
      }
    } else {
      const file = output.path as DataJsonFile; // parseManifest admits only the known outputs
      const json = loader.parse(file, fetched.bytes);
      const checkStart = now();
      const result = readDataFile(file, json);
      checkMs = now() - checkStart;
      if (!result.ok) {
        throw new DatasetLoadError('format', file, `data/${file} does not have the shape this version of the app reads.`, result.errors.slice(0, 8));
      }
      contents[file] = result.content;
    }
    const parseMs = now() - parseStart - checkMs;
    timings[output.path] = { fetchMs, hashMs: fetched.hashMs, parseMs, checkMs, bytes: output.bytes, retried: fetched.retried };
    filesDone += 1;
    bytesDone += output.bytes;
    report({ phase: 'files', filesDone, filesTotal: outputs.length, bytesDone, bytesTotal });
  };

  try {
    await Promise.all(outputs.map(one));
  } catch (error) {
    loader.abort(error);
    throw error;
  }

  const files = datasetFilesOf(requireAll(contents));
  report({ phase: 'done', filesDone, filesTotal: outputs.length, bytesDone, bytesTotal });
  // Timings keyed in path order, so a report is the same whichever file finished first.
  const orderedTimings = Object.fromEntries(outputs.map((o) => [o.path, timings[o.path]]).filter((e): e is [string, FileTiming] => e[1] !== undefined));
  return { manifest, identity: identityOf(manifest), files, notice, timings: { manifestMs, totalMs: now() - start, files: orderedTimings } };
}

function requireAll(contents: Partial<Record<DataJsonFile, FileContent[DataJsonFile]>>): { readonly [F in DataJsonFile]: FileContent[F] } {
  const missing = DATA_JSON_FILES.filter((f) => contents[f] === undefined);
  if (missing.length > 0) throw new DatasetLoadError('format', null, `The manifest does not list ${missing.join(', ')}.`);
  return contents as { readonly [F in DataJsonFile]: FileContent[F] };
}
