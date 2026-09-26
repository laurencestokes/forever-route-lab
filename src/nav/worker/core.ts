import { NavFormatError } from '../bytes';
import { quantise } from '../grid';
import { LegSearch, SearchScratch, type Leg, type LegEndpoint } from '../legs';
import type { NavFileEntry, NavManifest } from '../manifest';
import { NavMeshError, type BlockMesh, type NavMesh } from '../mesh';
import { loadBlock, openMap } from '../open';
import { snap, snapBlocks } from '../snap';
import { joinNavUrl, NavWorkerError, type NavIndexedResult, type NavLegQuery, type NavLegResult, type NavPoint, type NavPriority, type NavWorkerStats } from './protocol';

/**
 * The navigation worker's runtime (terrain-navigation.md §9.6; TN-15, RC-06, RC-07), written
 * without a `Worker` so the tests drive it directly with an injected fetch and digest.
 *
 * - **Files.** Every file is fetched relative to the base URL the `init` message carries and
 *   checked against the manifest: its byte count, then its SHA-256 (`crypto.subtle`). A file that
 *   fails the check is fetched once more with `cache: 'reload'` (a copy cached from an earlier
 *   deploy, as `src/infra/maps/geometry-loader.ts` does); a second failure fails closed with a
 *   `NavWorkerError` (`integrity`) that stays for the file, so the app falls back instead of
 *   refetching. A verified file that does not decode fails closed as `format`.
 * - **The per-map file first.** A map's `map.bin` (components, connector links, passage tags) is
 *   fetched, verified and opened before its first block or query.
 * - **Blocks** are decoded and linked in whatever order their fetches complete; `src/nav` gives
 *   the same mesh and the same legs in any order (G12).
 * - **Snapping loads** every block within the snap radius (6 yd) of an endpoint first (§8.1,
 *   RC-06); snaps are then cached per map, which is sound because they never depend on what else
 *   is loaded.
 * - **Fetches** have a time limit (`fetchTimeoutMs`, default 30 s, for the response and its body):
 *   a file that has not arrived by then fails as `network`, which the app asks again later. A
 *   server answer that may pass (HTTP 408, 425, 429 and 5xx) is `network` too; other error
 *   statuses are `http`. A fetch is aborted when every request waiting for it has been cancelled.
 * - **Resumable search.** `LegSearch.run(slice)` pauses before a polygon whose portal edge or
 *   connector link leads into an unloaded block; the core loads the block and resumes. After each
 *   slice of settled polygons it yields to the event loop, where `cancel` can arrive.
 * - **Cancelling** fails the request with `cancelled` at once and releases its pins, even while
 *   one of its files is still arriving: the core goes on with the next request, and the abandoned
 *   step stops at its next check without starting or continuing a search.
 * - **Pinning and the LRU (§9.6).** The blocks one source group (one `legsFrom` search, or one
 *   path) snaps near, starts from or loads are pinned until that group's search ends, not until the
 *   whole request ends. While a search runs, every loaded block of its map is locked as well
 *   (`src/nav` refuses to continue a search after any unload, so the blocks a search passes through
 *   untold are covered). After every load, and after every group, the core evicts unpinned,
 *   unlocked blocks, least recently used first, until the typed arrays it holds (map-wide arrays,
 *   blocks, search scratch) fit `maxBytes`; if that is not enough, it drops whole maps no running
 *   group uses. Only the running search's own map can take the total over the budget. The default
 *   budget keeps the worker heap under the 128 MB target of §14.3 (the typed layout is 98% of the
 *   heap growth measured in 3b.5).
 * - **Requests** run one source group at a time, the groups of one map together (in the order the
 *   request first names each map): `interactive` requests go before `bulk` ones at the next group
 *   boundary, and a group's search always runs to completion before another starts (one search
 *   scratch per map). A group that fails fails only its own legs: the request's other groups still
 *   run and report their results (except the rest of a map one of whose files failed), and the
 *   request then fails with the first error.
 */

/** The response shape the core reads (a browser `Response` satisfies it). */
export interface NavFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type NavFetch = (url: string, init?: { readonly cache?: RequestCache; readonly signal?: AbortSignal }) => Promise<NavFetchResponse>;

/** The one WebCrypto method the core uses; `crypto.subtle` satisfies it (so does Node's). */
export interface NavDigest {
  digest(algorithm: 'SHA-256', data: BufferSource): Promise<ArrayBuffer>;
}

/** The worker heap target (§14.3). */
export const NAV_HEAP_TARGET_BYTES = 128_000_000;
/** Default budget for the typed arrays the core holds, leaving room under the heap target for the rest. */
export const DEFAULT_NAV_MAX_BYTES = 100_000_000;
/** Default search slice: settled polygons between yields (about 4 ms on the 3b.5 machine). */
export const DEFAULT_SLICE_SETTLED = 20_000;
/** Default time limit for one file (its response and body): a stalled connection fails as `network`. */
export const DEFAULT_NAV_FETCH_TIMEOUT_MS = 30_000;
/** Snap cache entries per map before the cache is cleared. */
const SNAP_CACHE_LIMIT = 100_000;
/** HTTP statuses that may pass on their own: asked again later, as a network failure is. */
const TRANSIENT_HTTP: ReadonlySet<number> = new Set([408, 425, 429]);
const isTransientStatus = (status: number): boolean => TRANSIENT_HTTP.has(status) || (status >= 500 && status <= 599);

export interface NavWorkerCoreOptions {
  readonly manifest: NavManifest;
  /** The base URL the manifest's paths are relative to (absolute in the worker; see client.ts). */
  readonly baseUrl: string;
  readonly fetch: NavFetch;
  readonly digest: NavDigest;
  /** Budget for the typed arrays held (default `DEFAULT_NAV_MAX_BYTES`). */
  readonly maxBytes?: number;
  /** Settled polygons per search slice (default `DEFAULT_SLICE_SETTLED`). */
  readonly sliceSettled?: number;
  /** Yields to the event loop between slices (default: a zero-delay timer). */
  readonly yieldToEventLoop?: () => Promise<void>;
  /** Called for each evicted block, and with `block` null when a whole map is dropped (tests). */
  readonly onEvict?: (event: { readonly mapId: number; readonly block: number | null }) => void;
  /** Time limit for one file, response and body (default `DEFAULT_NAV_FETCH_TIMEOUT_MS`). */
  readonly fetchTimeoutMs?: number;
}

export interface NavLegsOptions {
  readonly priority?: NavPriority;
  /** After each source group: legs done, legs requested, and the group's results. */
  readonly onProgress?: (done: number, total: number, results: readonly NavIndexedResult[]) => void;
}

const HEX_DIGITS = '0123456789abcdef';

/** Lowercase hex of the bytes (no bitwise operators, D-012). */
export function hexOf(buffer: ArrayBuffer): string {
  let out = '';
  for (const byte of new Uint8Array(buffer)) out += (HEX_DIGITS[Math.floor(byte / 16)] ?? '') + (HEX_DIGITS[byte % 16] ?? '');
  return out;
}

const mapIdOfPath = (path: string): number | undefined => {
  const m = /^([0-9]+)\//.exec(path);
  return m === null ? undefined : Number(m[1]);
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Bytes of the typed arrays one loaded block holds (the per-block part of `NavMesh.typedBytes`). */
export function blockBytes(m: BlockMesh): number {
  let n = 0;
  for (const a of [m.tileTx, m.tileTz, m.tilePolyBase, m.polyFirst, m.slotVert, m.nei, m.vx, m.vy, m.vz, m.zones, m.outerSides]) n += a.byteLength;
  const c = m.cross;
  n += c.first.byteLength + c.to.byteLength + c.ax.byteLength + c.ay.byteLength + c.az.byteLength + c.bx.byteLength + c.by.byteLength + c.bz.byteLength;
  for (const o of m.outer) n += o.tile.byteLength + o.poly.byteLength + o.slot.byteLength;
  for (const s of m.sides) if (s !== null) n += s.from.byteLength + s.to.byteLength + s.ax.byteLength + s.ay.byteLength + s.az.byteLength + s.bx.byteLength + s.by.byteLength + s.bz.byteLength;
  if (m.bins !== null) n += m.bins.first.byteLength + m.bins.items.byteLength;
  return n;
}

interface MapState {
  readonly mesh: NavMesh;
  scratch: SearchScratch | null;
  /** LRU tick per block index. */
  readonly used: Map<number, number>;
  lastUse: number;
}

interface Snapped {
  readonly x: number;
  readonly y: number;
  readonly poly: number;
  readonly ambiguous: boolean;
}

interface Group {
  readonly mapId: number;
  readonly from: NavPoint;
  readonly targets: NavPoint[];
  readonly indices: number[];
}

interface Job {
  readonly id: number;
  readonly rank: number;
  readonly seq: number;
  readonly units: (() => Promise<void>)[];
  next: number;
  cancelled: boolean;
  /** Resolves when the job is cancelled: the pump stops waiting for its running unit. */
  readonly stopped: Promise<void>;
  readonly stop: () => void;
  /** Block keys (`mapId:block`) pinned by the running unit (one group's search). */
  readonly pins: Set<string>;
  /** Maps the running unit uses (never dropped while it runs). */
  readonly maps: Set<number>;
  readonly settle: (error: NavWorkerError | null) => void;
}

/** A file being fetched, and the jobs waiting for it (it is aborted when all of them are cancelled). */
interface Inflight {
  readonly promise: Promise<Uint8Array>;
  readonly controller: AbortController;
  readonly waiters: Set<Job>;
}

const cancelledError = (id: number): NavWorkerError => new NavWorkerError('cancelled', `request ${String(id)} was cancelled`);

export class NavWorkerCore {
  readonly manifest: NavManifest;
  private readonly baseUrl: string;
  private readonly fetchFile: NavFetch;
  private readonly digest: NavDigest;
  readonly maxBytes: number;
  private readonly slice: number;
  private readonly yieldToEventLoop: () => Promise<void>;
  private readonly onEvict: NavWorkerCoreOptions['onEvict'];
  private readonly states = new Map<number, MapState>();
  private readonly opening = new Map<number, Promise<MapState>>();
  private readonly snaps = new Map<number, Map<string, Snapped>>();
  private readonly inflight = new Map<string, Inflight>();
  /** Files that failed closed: every later use fails the same way. */
  private readonly failures = new Map<string, NavWorkerError>();
  private readonly pins = new Map<string, number>();
  private readonly mapUsers = new Map<number, number>();
  private readonly queue: Job[] = [];
  private pumping = false;
  private seq = 0;
  private tick = 0;
  /** The map of each job's running search: none of its blocks may be unloaded. */
  private readonly searching = new Map<Job, number>();
  private readonly fetchTimeoutMs: number;
  /** Polygons settled since the last yield to the event loop (the slice spans searches). */
  private sinceYield = 0;
  private filesVerified = 0;
  private bytesVerified = 0;
  private refetches = 0;
  private blocksEvicted = 0;
  private mapsDropped = 0;

  constructor(options: NavWorkerCoreOptions) {
    this.manifest = options.manifest;
    this.baseUrl = options.baseUrl;
    this.fetchFile = options.fetch;
    this.digest = options.digest;
    this.maxBytes = options.maxBytes ?? DEFAULT_NAV_MAX_BYTES;
    this.slice = options.sliceSettled ?? DEFAULT_SLICE_SETTLED;
    this.yieldToEventLoop = options.yieldToEventLoop ?? (() => new Promise((resolve) => setTimeout(resolve, 0)));
    this.onEvict = options.onEvict;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_NAV_FETCH_TIMEOUT_MS;
    if (!(this.maxBytes > 0) || !(this.slice > 0) || !(this.fetchTimeoutMs > 0)) throw new RangeError('NavWorkerCore: maxBytes, sliceSettled and fetchTimeoutMs must be positive');
  }

  get navRevision(): string {
    return this.manifest.navRevision;
  }

  /** True when the manifest lists navigation data for the map. */
  hasMap(mapId: number): boolean {
    return this.manifest.maps.some((m) => m.mapId === mapId);
  }

  /**
   * Computes a batch of directed legs. Legs from one source point form one `legsFrom` search over
   * all of that point's targets (one group); results arrive per group through `onProgress`, and
   * the promise resolves with every result in query order. Rejects with a `NavWorkerError`.
   */
  legs(id: number, queries: readonly NavLegQuery[], options: NavLegsOptions = {}): Promise<readonly NavLegResult[]> {
    // Groups by map (in the order the request first names each map), then by source point: one
    // map's searches run together, so the LRU does not trade one continent's blocks for another's.
    const byMap = new Map<number, Map<string, Group>>();
    queries.forEach((q, index) => {
      const from = { x: quantise(q.from.x), y: quantise(q.from.y), hint: q.from.hint };
      const key = `${String(from.x)},${String(from.y)},${String(from.hint)}`;
      let groups = byMap.get(q.mapId);
      if (groups === undefined) {
        groups = new Map();
        byMap.set(q.mapId, groups);
      }
      let g = groups.get(key);
      if (g === undefined) {
        g = { mapId: q.mapId, from, targets: [], indices: [] };
        groups.set(key, g);
      }
      g.targets.push(q.to);
      g.indices.push(index);
    });
    const results = new Array<NavLegResult | undefined>(queries.length).fill(undefined);
    const total = queries.length;
    let done = 0;
    /** The first group failure: the request fails with it once its other groups have run. */
    let failure: NavWorkerError | null = null;
    /** Maps one of whose files failed in this request: their other groups would fail the same way. */
    const failedMaps = new Set<number>();
    return new Promise((resolve, reject) => {
      const job = this.job(id, options.priority ?? 'interactive', (error) => {
        const first = error ?? failure;
        if (first !== null) {
          reject(first);
          return;
        }
        const out: NavLegResult[] = [];
        for (const r of results) {
          if (r === undefined) {
            reject(new NavWorkerError('internal', `request ${String(id)}: a leg has no result`));
            return;
          }
          out.push(r);
        }
        resolve(out);
      });
      for (const groups of byMap.values()) {
        for (const g of groups.values()) {
          job.units.push(async () => {
            if (failedMaps.has(g.mapId)) return;
            let out: NavLegResult[];
            try {
              out = await this.runGroup(job, g);
            } catch (error) {
              if (job.cancelled || (error instanceof NavWorkerError && error.code === 'cancelled')) throw error;
              // The failure stays with this group (and, for a file of its map, with that map's groups).
              const e = error instanceof NavWorkerError ? error : new NavWorkerError('internal', messageOf(error));
              if (e.path !== undefined || e.code === 'no-map') failedMaps.add(g.mapId);
              failure ??= e.mapId === undefined ? new NavWorkerError(e.code, e.message, e.path, g.mapId) : e;
              return;
            }
            const batch: NavIndexedResult[] = out.map((result, k) => ({ index: g.indices[k] ?? 0, result }));
            for (const r of batch) results[r.index] = r.result;
            done += batch.length;
            options.onProgress?.(done, total, batch);
          });
        }
      }
      this.submit(job);
    });
  }

  /** The drawn polyline of one leg (x, y, z triples, §9.3 `path()`), or null when it is not reachable. */
  path(id: number, query: NavLegQuery): Promise<readonly number[] | null> {
    let path: readonly number[] | null = null;
    return new Promise((resolve, reject) => {
      const job = this.job(id, 'interactive', (error) => {
        if (error !== null) reject(error);
        else resolve(path);
      });
      job.units.push(async () => {
        const mesh = await this.openMesh(query.mapId, job);
        const a = await this.snapPoint(mesh, query.from, job);
        const b = await this.snapPoint(mesh, query.to, job);
        const [leg] = await this.search(mesh, job, a, [b], true);
        path = leg?.reachable === true ? (leg.path ?? null) : null;
      });
      this.submit(job);
    });
  }

  /**
   * Cancels a queued or running request: it fails with `cancelled` at once and releases its pins,
   * and a file that only cancelled requests were waiting for is no longer fetched.
   */
  cancel(id: number): void {
    for (const job of this.queue) {
      if (job.id !== id || job.cancelled) continue;
      job.cancelled = true;
      job.stop();
    }
    for (const [path, f] of this.inflight) {
      if (![...f.waiters].every((waiter) => waiter.cancelled)) continue;
      this.inflight.delete(path);
      f.controller.abort(new NavWorkerError('cancelled', `${path}: every request waiting for it was cancelled`, path, mapIdOfPath(path)));
    }
  }

  stats(): NavWorkerStats {
    let blocksLoaded = 0;
    for (const s of this.states.values()) blocksLoaded += s.mesh.loaded;
    return {
      maps: this.states.size,
      blocksLoaded,
      blocksPinned: this.pins.size,
      bytes: this.bytes(),
      maxBytes: this.maxBytes,
      filesVerified: this.filesVerified,
      bytesVerified: this.bytesVerified,
      refetches: this.refetches,
      blocksEvicted: this.blocksEvicted,
      mapsDropped: this.mapsDropped,
    };
  }

  /** True while a running request pins the block (tests). */
  isPinned(mapId: number, block: number): boolean {
    return this.pins.has(`${String(mapId)}:${String(block)}`);
  }

  /** Bytes of the typed arrays held: map-wide arrays, loaded blocks and search scratch. */
  bytes(): number {
    let total = 0;
    for (const s of this.states.values()) {
      const t = s.mesh.typedBytes();
      total += t.map + t.blocks + (s.scratch?.bytes ?? 0);
    }
    return total;
  }

  // ---------------------------------------------------------------------------------------------
  // requests

  private internal(message: string): never {
    throw new NavWorkerError('internal', message);
  }

  private job(id: number, priority: NavPriority, settle: (error: NavWorkerError | null) => void): Job {
    this.seq += 1;
    let stop: () => void = () => undefined;
    const stopped = new Promise<void>((resolve) => {
      stop = resolve;
    });
    return { id, rank: priority === 'bulk' ? 1 : 0, seq: this.seq, units: [], next: 0, cancelled: false, stopped, stop, pins: new Set(), maps: new Set(), settle };
  }

  private submit(job: Job): void {
    this.queue.push(job);
    if (!this.pumping) void this.pump();
  }

  private pick(): Job | undefined {
    let best: Job | undefined;
    for (const job of this.queue) if (best === undefined || job.rank < best.rank || (job.rank === best.rank && job.seq < best.seq)) best = job;
    return best;
  }

  private async pump(): Promise<void> {
    this.pumping = true;
    try {
      for (let job = this.pick(); job !== undefined; job = this.pick()) {
        if (job.cancelled) {
          this.finish(job, cancelledError(job.id));
          continue;
        }
        const unit = job.units[job.next];
        if (unit === undefined) {
          this.finish(job, null);
          continue;
        }
        try {
          // A cancel stops the wait at once, even while the unit waits for a file: the unit is
          // abandoned, and stops at its next check (every await in it is followed by one).
          await Promise.race([unit(), job.stopped]);
          if (job.cancelled) {
            this.finish(job, cancelledError(job.id));
            continue;
          }
          job.next += 1;
          // The group's search has ended: release its pins and trim to the budget (§9.6).
          this.releaseUnit(job);
          this.evict();
          if (job.next >= job.units.length) this.finish(job, null);
        } catch (error) {
          this.finish(job, job.cancelled ? cancelledError(job.id) : error instanceof NavWorkerError ? error : new NavWorkerError('internal', messageOf(error)));
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Releases the pins, maps and search lock of the job's running unit. */
  private releaseUnit(job: Job): void {
    for (const key of job.pins) {
      const n = (this.pins.get(key) ?? 0) - 1;
      if (n > 0) this.pins.set(key, n);
      else this.pins.delete(key);
    }
    job.pins.clear();
    for (const mapId of job.maps) {
      const n = (this.mapUsers.get(mapId) ?? 0) - 1;
      if (n > 0) this.mapUsers.set(mapId, n);
      else this.mapUsers.delete(mapId);
    }
    job.maps.clear();
    this.searching.delete(job);
  }

  private finish(job: Job, error: NavWorkerError | null): void {
    const i = this.queue.indexOf(job);
    if (i >= 0) this.queue.splice(i, 1);
    this.releaseUnit(job);
    // Its pins are gone: trim to the budget now rather than at the next load.
    this.evict();
    job.settle(error);
  }

  private throwIfCancelled(job: Job): void {
    if (job.cancelled) throw cancelledError(job.id);
  }

  private async runGroup(job: Job, g: Group): Promise<NavLegResult[]> {
    const mesh = await this.openMesh(g.mapId, job);
    const source = await this.snapPoint(mesh, g.from, job);
    const targets: Snapped[] = [];
    for (const t of g.targets) targets.push(await this.snapPoint(mesh, t, job));
    const legs = await this.search(mesh, job, source, targets, false);
    return legs.map((leg, k) => this.resultOf(mesh, leg, source, targets[k] ?? source));
  }

  private resultOf(mesh: NavMesh, leg: Leg, from: Snapped, to: Snapped): NavLegResult {
    return {
      reachable: leg.reachable,
      reason: leg.reason,
      groundTenths: leg.groundTenths,
      swimTenths: leg.swimTenths,
      connectorTenthsSeconds: leg.connectorTenthsSeconds,
      longestSwimYd: leg.longestSwimYd,
      flags: leg.flags,
      passages: leg.passages.map((i) => mesh.passageIds[i] ?? `passage ${String(i)}`),
      from: { snapped: from.poly >= 0, ambiguous: from.ambiguous },
      to: { snapped: to.poly >= 0, ambiguous: to.ambiguous },
    };
  }

  /** Runs one resumable search to completion, loading the blocks it asks for and yielding between slices. */
  private async search(mesh: NavMesh, job: Job, source: Snapped, targets: readonly Snapped[], withPath: boolean): Promise<readonly Leg[]> {
    if (source.poly >= 0) await this.ensureBlocks(mesh, [mesh.blockOf[source.poly] ?? 0], job);
    this.throwIfCancelled(job);
    const state = this.stateOf(mesh);
    if (state.scratch === null) state.scratch = new SearchScratch(mesh);
    const scratch = state.scratch;
    const end = (s: Snapped): LegEndpoint => ({ x: s.x, y: s.y, poly: s.poly });
    this.searching.set(job, mesh.mapId);
    try {
      const search = new LegSearch(mesh, scratch, end(source), targets.map(end), withPath ? { withPath: true } : {});
      for (;;) {
        // The slice runs on across searches: many small searches with their blocks loaded would
        // otherwise hold the worker in microtasks, so a cancel or an interactive request could not
        // arrive until the whole request ended.
        const before = search.settled;
        const status = search.run(Math.max(1, this.slice - this.sinceYield));
        this.sinceYield += search.settled - before;
        if (status.kind === 'done') return status.legs;
        if (status.kind === 'needs') await this.ensureBlocks(mesh, status.blocks, job);
        else {
          this.sinceYield = 0;
          await this.yieldToEventLoop();
        }
        this.throwIfCancelled(job);
      }
    } finally {
      // A cancelled job's lock went when it finished; its abandoned search never runs again.
      if (!job.cancelled) this.searching.delete(job);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // maps, blocks and snaps

  private stateOf(mesh: NavMesh): MapState {
    const s = this.states.get(mesh.mapId);
    if (s === undefined || s.mesh !== mesh) this.internal(`map ${String(mesh.mapId)} was dropped while a request used it`);
    return s;
  }

  private useMap(job: Job, mapId: number): void {
    this.throwIfCancelled(job);
    if (job.maps.has(mapId)) return;
    job.maps.add(mapId);
    this.mapUsers.set(mapId, (this.mapUsers.get(mapId) ?? 0) + 1);
  }

  /** The open mesh of a map: its `map.bin` is fetched, verified and decoded first (§9.6). */
  private async openMesh(mapId: number, job: Job): Promise<NavMesh> {
    this.useMap(job, mapId);
    const open = this.states.get(mapId);
    if (open !== undefined) {
      open.lastUse = ++this.tick;
      return open.mesh;
    }
    const entry = this.manifest.maps.find((m) => m.mapId === mapId);
    if (entry === undefined) throw new NavWorkerError('no-map', `map ${String(mapId)} has no navigation data`, undefined, mapId);
    let pending = this.opening.get(mapId);
    if (pending === undefined) {
      pending = this.openState(mapId, entry, job).finally(() => this.opening.delete(mapId));
      this.opening.set(mapId, pending);
    } else {
      // Waiting for the same map.bin: this job keeps the fetch alive if the opener is cancelled.
      this.inflight.get(entry.mapFile.path)?.waiters.add(job);
    }
    const state = await pending;
    this.throwIfCancelled(job);
    return state.mesh;
  }

  private async openState(mapId: number, entry: NavManifest['maps'][number], job: Job): Promise<MapState> {
    const bytes = await this.fetchVerified(entry.mapFile, job);
    let mesh: NavMesh;
    try {
      mesh = openMap(this.manifest, mapId, bytes);
    } catch (error) {
      throw this.failClosed(entry.mapFile.path, error);
    }
    const state: MapState = { mesh, scratch: null, used: new Map(), lastUse: ++this.tick };
    this.states.set(mapId, state);
    return state;
  }

  /** Snaps a point (quantised here) after loading every block within the snap radius (§8.1, RC-06). */
  private async snapPoint(mesh: NavMesh, p: NavPoint, job: Job): Promise<Snapped> {
    const x = quantise(p.x);
    const y = quantise(p.y);
    const key = `${String(x)},${String(y)},${String(p.hint)}`;
    let cache = this.snaps.get(mesh.mapId);
    if (cache === undefined) {
      cache = new Map();
      this.snaps.set(mesh.mapId, cache);
    }
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const blocks = snapBlocks(mesh, x, y);
    await this.ensureBlocks(mesh, blocks, job);
    this.throwIfCancelled(job);
    const s = snap(mesh, x, y, p.hint);
    const out: Snapped = { x, y, poly: s.poly, ambiguous: s.flags.ambiguous };
    if (cache.size >= SNAP_CACHE_LIMIT) cache.clear();
    cache.set(key, out);
    return out;
  }

  /** Pins `blocks` to the job, loads the missing ones (in completion order), then evicts over budget. */
  private async ensureBlocks(mesh: NavMesh, blocks: readonly number[], job: Job): Promise<void> {
    // An abandoned (cancelled) unit pins nothing more.
    this.throwIfCancelled(job);
    const state = this.stateOf(mesh);
    for (const b of blocks) {
      const key = `${String(mesh.mapId)}:${String(b)}`;
      if (!job.pins.has(key)) {
        job.pins.add(key);
        this.pins.set(key, (this.pins.get(key) ?? 0) + 1);
      }
      state.used.set(b, ++this.tick);
    }
    state.lastUse = this.tick;
    const missing = blocks.filter((b) => !mesh.isLoaded(b));
    if (missing.length === 0) return;
    const settled = await Promise.allSettled(
      missing.map(async (b) => {
        const entry = mesh.entry.blocks[b];
        if (entry === undefined) this.internal(`block index ${String(b)} of map ${String(mesh.mapId)}`);
        const bytes = await this.fetchVerified(entry, job);
        // Loading is additive and order-free (G12): a block that arrives for an abandoned unit is
        // still loaded, unpinned, and a dropped map's mesh is simply not used again.
        if (mesh.isLoaded(b)) return;
        try {
          loadBlock(mesh, b, bytes);
        } catch (error) {
          throw this.failClosed(entry.path, error);
        }
      }),
    );
    for (const s of settled) if (s.status === 'rejected') throw s.reason;
    this.evict();
  }

  /** Evicts unpinned, unlocked blocks (least recently used first), then unused maps, until the budget fits. */
  private evict(): void {
    let total = this.bytes();
    if (total <= this.maxBytes) return;
    const locked = new Set(this.searching.values());
    const candidates: { mapId: number; block: number; used: number }[] = [];
    for (const [mapId, s] of this.states) {
      if (locked.has(mapId)) continue;
      for (const block of s.mesh.loadedBlocks()) {
        if (!this.isPinned(mapId, block)) candidates.push({ mapId, block, used: s.used.get(block) ?? 0 });
      }
    }
    candidates.sort((a, b) => a.used - b.used || a.mapId - b.mapId || a.block - b.block);
    for (const c of candidates) {
      if (total <= this.maxBytes) return;
      this.states.get(c.mapId)?.mesh.removeBlock(c.block);
      this.blocksEvicted += 1;
      this.onEvict?.({ mapId: c.mapId, block: c.block });
      total = this.bytes();
    }
    const idle = [...this.states.values()].filter((s) => !locked.has(s.mesh.mapId) && !this.mapUsers.has(s.mesh.mapId)).sort((a, b) => a.lastUse - b.lastUse);
    for (const s of idle) {
      if (total <= this.maxBytes) return;
      this.states.delete(s.mesh.mapId);
      this.mapsDropped += 1;
      this.onEvict?.({ mapId: s.mesh.mapId, block: null });
      total = this.bytes();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // fetching and verification

  private failClosed(path: string, error: unknown): NavWorkerError {
    const failure = error instanceof NavWorkerError ? error : new NavWorkerError(error instanceof NavFormatError || error instanceof NavMeshError ? 'format' : 'internal', `${path}: ${messageOf(error)}`, path, mapIdOfPath(path));
    this.failures.set(path, failure);
    return failure;
  }

  /**
   * The verified bytes of a manifest file. Concurrent requests for one file share one fetch, and
   * `job` is recorded as waiting for it (the fetch is aborted when every waiting job is cancelled).
   */
  private fetchVerified(file: NavFileEntry, job: Job): Promise<Uint8Array> {
    const failure = this.failures.get(file.path);
    if (failure !== undefined) return Promise.reject(failure);
    let f = this.inflight.get(file.path);
    if (f === undefined) {
      const controller = new AbortController();
      const promise: Promise<Uint8Array> = this.fetchWithRetry(file, controller.signal).finally(() => {
        if (this.inflight.get(file.path)?.promise === promise) this.inflight.delete(file.path);
      });
      f = { promise, controller, waiters: new Set() };
      this.inflight.set(file.path, f);
    }
    f.waiters.add(job);
    return f.promise;
  }

  private async fetchWithRetry(file: NavFileEntry, signal: AbortSignal): Promise<Uint8Array> {
    try {
      return await this.fetchOnce(file, undefined, signal);
    } catch (error) {
      if (!(error instanceof NavWorkerError) || error.code !== 'integrity') throw error;
    }
    this.refetches += 1;
    try {
      return await this.fetchOnce(file, 'reload', signal);
    } catch (error) {
      if (error instanceof NavWorkerError && error.code === 'integrity') throw this.failClosed(file.path, error);
      throw error;
    }
  }

  /**
   * One fetch of a file, response and body within `fetchTimeoutMs`. `signal` aborts it when no
   * request waits for it any more (`cancelled`); the time limit fails it as `network`. The fetch is
   * also raced against both, so a fetch that ignores its signal cannot hold the core.
   */
  private async fetchOnce(file: NavFileEntry, cache: RequestCache | undefined, signal: AbortSignal): Promise<Uint8Array> {
    const mapId = mapIdOfPath(file.path);
    const url = joinNavUrl(this.baseUrl, file.path);
    const local = new AbortController();
    const onAbort = (): void => {
      local.abort(signal.reason);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      local.abort(new NavWorkerError('network', `${file.path} did not arrive within ${String(this.fetchTimeoutMs / 1000)} s`, file.path, mapId));
    }, this.fetchTimeoutMs);
    const aborted = new Promise<never>((_resolve, reject) => {
      const fail = (): void => {
        reject(local.signal.reason as Error);
      };
      if (local.signal.aborted) fail();
      else local.signal.addEventListener('abort', fail, { once: true });
    });
    aborted.catch(() => undefined);
    /** The error when the fetch was stopped (cancelled, or the time limit), else null. */
    const stopped = (): NavWorkerError | null => {
      if (!local.signal.aborted) return null;
      const reason: unknown = local.signal.reason;
      return reason instanceof NavWorkerError ? reason : new NavWorkerError('cancelled', `${file.path}: ${messageOf(reason)}`, file.path, mapId);
    };
    try {
      let response: NavFetchResponse;
      try {
        response = await Promise.race([this.fetchFile(url, cache === undefined ? { signal: local.signal } : { cache, signal: local.signal }), aborted]);
      } catch (error) {
        throw stopped() ?? new NavWorkerError('network', `${file.path} could not be fetched (${messageOf(error)})`, file.path, mapId);
      }
      if (!response.ok) {
        const status = String(response.status);
        if (isTransientStatus(response.status)) throw new NavWorkerError('network', `${file.path} could not be loaded: the server answered HTTP ${status}, which may pass`, file.path, mapId);
        throw new NavWorkerError('http', `${file.path} could not be loaded: the server answered HTTP ${status}`, file.path, mapId);
      }
      let buffer: ArrayBuffer;
      try {
        buffer = await Promise.race([response.arrayBuffer(), aborted]);
      } catch (error) {
        throw stopped() ?? new NavWorkerError('network', `${file.path} could not be read to the end (${messageOf(error)})`, file.path, mapId);
      }
      return await this.verify(file, buffer, mapId);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }

  /** The file's bytes after its size and SHA-256 matched the manifest. */
  private async verify(file: NavFileEntry, buffer: ArrayBuffer, mapId: number | undefined): Promise<Uint8Array> {
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength !== file.bytes) {
      throw new NavWorkerError('integrity', `${file.path} has ${String(bytes.byteLength)} bytes, the manifest says ${String(file.bytes)}`, file.path, mapId);
    }
    const hash = hexOf(await this.digest.digest('SHA-256', bytes));
    if (hash !== file.sha256) {
      throw new NavWorkerError('integrity', `${file.path} failed its SHA-256 check (${hash.slice(0, 12)}…, the manifest says ${file.sha256.slice(0, 12)}…)`, file.path, mapId);
    }
    this.filesVerified += 1;
    this.bytesVerified += bytes.byteLength;
    return bytes;
  }
}
