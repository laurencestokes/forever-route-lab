import { toStorageError } from './errors';
import { createIdbProjectStorage, openProjectDb } from './idb-storage';
import { createMemoryProjectStorage } from './memory-storage';
import { announcingChanges, type ProjectLocks, type StorageChangeChannel } from './tabs';
import type { ProjectStorage } from './types';

/**
 * Opens project storage: IndexedDB when the browser allows it, otherwise memory with the reason
 * (a private window in some browsers, blocked site data, no IndexedDB at all, or an open that never
 * answers). The app keeps working either way and says when nothing outlives the page.
 */

export interface OpenedProjectStorage {
  readonly storage: ProjectStorage;
  /** Why browser storage is not used (the storage is then in memory); null when it is. */
  readonly unavailable: string | null;
  /** The project locks shared with other tabs (./tabs.ts); null or omitted: none (memory, or no Web Locks). */
  readonly locks?: ProjectLocks | null | undefined;
  /** Storage changes other tabs make (./tabs.ts); null or omitted: none (memory, or no BroadcastChannel). */
  readonly channel?: StorageChangeChannel | null | undefined;
}

export interface OpenProjectStorageOptions {
  /** `globalThis.indexedDB`; undefined when the browser has none (or it is blocked). */
  readonly factory: IDBFactory | undefined;
  readonly name?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly storageManager?: Pick<StorageManager, 'estimate'> | undefined;
  /** Called once if the connection is lost later (another tab upgrades the database). */
  readonly onClosed?: ((reason: string) => void) | undefined;
  /** Locks shared with other tabs; used with IndexedDB only (memory storage is this tab's own). */
  readonly locks?: ProjectLocks | null | undefined;
  /** A channel to the other tabs; the storage announces its changes on it (IndexedDB only). */
  readonly channel?: StorageChangeChannel | null | undefined;
}

export async function openProjectStorage(opts: OpenProjectStorageOptions): Promise<OpenedProjectStorage> {
  const memory = (unavailable: string): OpenedProjectStorage => {
    opts.channel?.close();
    return { storage: createMemoryProjectStorage(), unavailable, locks: null, channel: null };
  };
  if (opts.factory === undefined) return memory('This browser offers no IndexedDB here');
  try {
    const db = await openProjectDb({ factory: opts.factory, name: opts.name, timeoutMs: opts.timeoutMs, onClosed: opts.onClosed });
    const idb = createIdbProjectStorage(db, { storageManager: opts.storageManager });
    const channel = opts.channel ?? null;
    return { storage: channel === null ? idb : announcingChanges(idb, channel), unavailable: null, locks: opts.locks ?? null, channel };
  } catch (error: unknown) {
    const failure = toStorageError(error, true);
    return memory(failure.code === 'unavailable' ? failure.message : `The browser storage could not be opened (${failure.message})`);
  }
}

/**
 * `globalThis.indexedDB`, or undefined where reading it throws (some browsers throw a
 * SecurityError when site data is blocked) or it is missing.
 */
export function browserIndexedDb(): IDBFactory | undefined {
  try {
    const factory = (globalThis as { readonly indexedDB?: IDBFactory }).indexedDB;
    return factory ?? undefined;
  } catch {
    return undefined;
  }
}

/** `navigator.storage`, or undefined. */
export function browserStorageManager(): Pick<StorageManager, 'estimate'> | undefined {
  try {
    const manager = (globalThis as { readonly navigator?: { readonly storage?: StorageManager } }).navigator?.storage;
    return manager !== undefined && typeof manager.estimate === 'function' ? manager : undefined;
  } catch {
    return undefined;
  }
}
