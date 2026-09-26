import type { BackupRow, ProjectIndexRow, ProjectStorage } from './types';

/**
 * Tabs (and windows) of this site share one project storage (docs/ARCHITECTURE.md §12.3; M4 review
 * CR-02). Two browser APIs let them notice each other before anything is overwritten:
 *
 * - **Web Locks** (`navigator.locks`): a tab holds the lock of the project it has open, so another
 *   tab opening the same project learns that it is open elsewhere and can say so;
 * - **BroadcastChannel**: every change a tab makes to storage is announced to the other tabs at
 *   once, so a tab showing a project that another tab has just saved learns it straight away rather
 *   than at its own next save.
 *
 * Both are optional: where a browser lacks one, the `writeSeq` check (./types.ts) still refuses a
 * stale write, only later.
 */

/** A held lock, or a queued request for one; `release` lets it go (or stops waiting). */
export interface HeldLock {
  readonly release: () => void;
}

export interface ProjectLocks {
  /**
   * Takes the lock `name` when no other tab holds it: resolves the held lock, or null when another
   * tab holds it. Resolves a lock that holds nothing when the browser cannot tell.
   */
  readonly tryAcquire: (name: string) => Promise<HeldLock | null>;
  /** Waits for the lock `name` in the background; `onAcquired` runs once this tab holds it. */
  readonly wait: (name: string, onAcquired: () => void) => HeldLock;
}

/** The lock name of a project. */
export const projectLockName = (id: string): string => `forever-route-lab:project:${id}`;

/** The part of the Web Locks API used here (`navigator.locks.request` with options). */
export interface LockManagerLike {
  request(name: string, options: { readonly ifAvailable?: boolean; readonly signal?: AbortSignal }, callback: (lock: unknown) => unknown): Promise<unknown>;
}

/** Project locks over a Web Locks lock manager (`navigator.locks`, or a test double). */
export function webLocks(manager: LockManagerLike): ProjectLocks {
  const nothingHeld: HeldLock = { release: () => undefined };
  return {
    tryAcquire(name) {
      return new Promise<HeldLock | null>((resolve) => {
        let answered = false;
        manager
          .request(name, { ifAvailable: true }, (lock) => {
            answered = true;
            if (lock === null) {
              resolve(null);
              return undefined;
            }
            // The lock is held until the promise returned here settles.
            return new Promise<void>((release) => {
              resolve({ release: () => release() });
            });
          })
          .catch(() => {
            // The browser refused the request (an opaque origin, say): nothing is known.
            if (!answered) resolve(nothingHeld);
          });
      });
    },

    wait(name, onAcquired) {
      const controller = new AbortController();
      let released = false;
      let letGo: (() => void) | null = null;
      manager
        .request(name, { signal: controller.signal }, () => {
          if (released) return undefined;
          onAcquired();
          return new Promise<void>((resolve) => {
            letGo = resolve;
          });
        })
        .catch(() => {
          // Aborted: the tab stopped waiting.
        });
      return {
        release() {
          if (released) return;
          released = true;
          const holding: (() => void) | null = letGo;
          if (holding !== null) holding();
          else controller.abort();
        },
      };
    },
  };
}

/** A change another tab made to storage. */
export type StorageChange =
  /**
   * A project's record was written (`index`: its new index row) or removed (`index`: null).
   * `previousSeq`: the writeSeq the write replaced (null for a new project); `nameOnly`: a rename.
   */
  | { readonly kind: 'project'; readonly id: string; readonly index: ProjectIndexRow | null; readonly previousSeq: number | null; readonly nameOnly: boolean }
  /** The backups changed. */
  | { readonly kind: 'backups' };

export interface StorageChangeChannel {
  /** Tells the other tabs; never this one. */
  readonly post: (change: StorageChange) => void;
  readonly subscribe: (listener: (change: StorageChange) => void) => () => void;
  readonly close: () => void;
}

/** The part of BroadcastChannel used here. */
export interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  close(): void;
}

export const STORAGE_CHANNEL_NAME = 'forever-route-lab:storage';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIndexRow(value: unknown): value is ProjectIndexRow {
  if (!isRecord(value)) return false;
  const strings = ['id', 'name', 'createdAt', 'updatedAt', 'savedAt', 'dataRevision'] as const;
  return (
    strings.every((key) => typeof value[key] === 'string') &&
    typeof value['stepCount'] === 'number' &&
    typeof value['writeSeq'] === 'number' &&
    typeof value['sample'] === 'boolean' &&
    (value['schemaVersion'] === null || typeof value['schemaVersion'] === 'number')
  );
}

/** A message from another tab as a StorageChange, or null when it is not one (it is ignored). */
export function readStorageChange(data: unknown): StorageChange | null {
  if (!isRecord(data)) return null;
  if (data['kind'] === 'backups') return { kind: 'backups' };
  if (data['kind'] !== 'project' || typeof data['id'] !== 'string' || typeof data['nameOnly'] !== 'boolean') return null;
  const index = data['index'];
  const previousSeq = data['previousSeq'];
  if (index !== null && !isIndexRow(index)) return null;
  if (previousSeq !== null && typeof previousSeq !== 'number') return null;
  return { kind: 'project', id: data['id'], index, previousSeq, nameOnly: data['nameOnly'] };
}

/** A storage change channel over a BroadcastChannel (or a test double). */
export function broadcastChanges(channel: BroadcastChannelLike): StorageChangeChannel {
  const listeners = new Set<(change: StorageChange) => void>();
  const onMessage = (event: { readonly data: unknown }) => {
    const change = readStorageChange(event.data);
    if (change === null) return;
    for (const listener of [...listeners]) listener(change);
  };
  channel.addEventListener('message', onMessage);
  let closed = false;
  return {
    post(change) {
      if (closed) return;
      try {
        channel.postMessage(change);
      } catch {
        // A closed channel: the other tabs find out at their next write instead.
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      channel.removeEventListener('message', onMessage);
      channel.close();
    },
  };
}

/** `navigator.locks` as ProjectLocks, or null where the browser has none (or refuses it). */
export function browserProjectLocks(): ProjectLocks | null {
  try {
    const manager = (globalThis as { readonly navigator?: { readonly locks?: LockManagerLike } }).navigator?.locks;
    return manager !== undefined && typeof manager.request === 'function' ? webLocks(manager) : null;
  } catch {
    return null;
  }
}

/** A BroadcastChannel for storage changes, or null where the browser has none. */
export function browserStorageChannel(name = STORAGE_CHANNEL_NAME): StorageChangeChannel | null {
  try {
    const Channel = (globalThis as { readonly BroadcastChannel?: new (name: string) => BroadcastChannelLike }).BroadcastChannel;
    return Channel === undefined ? null : broadcastChanges(new Channel(name));
  } catch {
    return null;
  }
}

/**
 * `storage`, telling the other tabs through `channel` about every change it makes once the change is
 * stored. Reads and failed writes say nothing.
 */
export function announcingChanges(storage: ProjectStorage, channel: StorageChangeChannel): ProjectStorage {
  const project = (id: string, index: ProjectIndexRow | null, previousSeq: number | null, nameOnly: boolean) => {
    channel.post({ kind: 'project', id, index, previousSeq, nameOnly });
  };
  const backups = () => {
    channel.post({ kind: 'backups' });
  };
  const removed = (id: string, existed: boolean, extra: readonly BackupRow[]) => {
    if (existed) project(id, null, null, false);
    if (existed || extra.length > 0) backups();
  };
  return {
    ...storage,
    kind: storage.kind,
    writeProject: (row, input, expectedSeq) =>
      storage.writeProject(row, input, expectedSeq).then((result) => {
        if (result.ok) project(row.id, result.index, expectedSeq, false);
        return result;
      }),
    renameProject: (id, name, expectedSeq) =>
      storage.renameProject(id, name, expectedSeq).then((result) => {
        if (result.ok) project(id, result.index, expectedSeq, true);
        return result;
      }),
    moveToBackup: (id, meta, extra = []) =>
      storage.moveToBackup(id, meta, extra).then((backup) => {
        removed(id, backup !== null, extra);
        return backup;
      }),
    deleteProject: (id, extra = []) =>
      storage.deleteProject(id, extra).then((existed) => {
        removed(id, existed, extra);
        return existed;
      }),
    putBackup: (backup) => storage.putBackup(backup).then(backups),
    deleteBackup: (id) => storage.deleteBackup(id).then(backups),
    purgeBackups: (nowIso) =>
      storage.purgeBackups(nowIso).then((count) => {
        if (count > 0) backups();
        return count;
      }),
    close() {
      storage.close();
      channel.close();
    },
  };
}
