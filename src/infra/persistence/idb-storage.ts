import { type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames, unwrap, wrap } from 'idb';
import { StorageError, toStorageError } from './errors';
import type {
  BackupMeta,
  BackupRow,
  BackupSummaryRow,
  ProjectIndexInput,
  ProjectIndexRow,
  ProjectRow,
  ProjectStorage,
  StorageEstimate,
  WriteProjectResult,
} from './types';

/**
 * Project storage in IndexedDB through `idb` (ISC; docs/ARCHITECTURE.md §12.3). Database
 * `forever-route-lab`, version 2, with the stores described in ./types.ts. Every write of a
 * project and its index row is one transaction, so the list never disagrees with the records.
 */

export const PROJECT_DB_NAME = 'forever-route-lab';
/** 1: projects, projectIndex, backups, settings. 2: backupIndex, so listing backups loads no record (M4 review CR-14). */
export const PROJECT_DB_VERSION = 2;

export interface ProjectDbSchema extends DBSchema {
  projects: { key: string; value: ProjectRow };
  projectIndex: { key: string; value: ProjectIndexRow };
  backups: { key: string; value: BackupRow };
  backupIndex: { key: string; value: BackupSummaryRow; indexes: { purgeAfter: string } };
  settings: { key: string; value: unknown };
}

type Db = IDBPDatabase<ProjectDbSchema>;

/** The summary of a backup, as the `backupIndex` store keeps it. */
function summaryOf(backup: BackupRow): BackupSummaryRow {
  const { record: _record, ...summary } = backup;
  return summary;
}

/**
 * Brings the raw database being upgraded from `oldVersion` to PROJECT_DB_VERSION, one version at a
 * time, inside the upgrade transaction `tx`.
 */
function upgrade(db: IDBDatabase, tx: IDBTransaction, oldVersion: number): void {
  if (oldVersion < 1) {
    db.createObjectStore('projects', { keyPath: 'id' });
    db.createObjectStore('projectIndex', { keyPath: 'id' });
    db.createObjectStore('backups', { keyPath: 'id' }).createIndex('purgeAfter', 'purgeAfter');
    db.createObjectStore('settings');
  }
  if (oldVersion < 2) {
    // The backup summaries move to their own store; `backups` keeps the whole rows only.
    const backups = tx.objectStore('backups');
    backups.deleteIndex('purgeAfter');
    const summaries = db.createObjectStore('backupIndex', { keyPath: 'id' });
    summaries.createIndex('purgeAfter', 'purgeAfter');
    const cursor = backups.openCursor();
    cursor.onsuccess = () => {
      const at = cursor.result;
      if (at === null) return;
      summaries.put(summaryOf(at.value as BackupRow));
      at.continue();
    };
  }
}

export interface OpenIdbOptions {
  readonly factory: IDBFactory;
  readonly name?: string | undefined;
  /** An open that neither succeeds nor fails in this time counts as unavailable (default 5 s). */
  readonly timeoutMs?: number | undefined;
  /** Called once when the connection is lost (another tab upgrades the database, or the browser closes it). */
  readonly onClosed?: ((reason: string) => void) | undefined;
}

/**
 * Opens the database with an injected factory (idb's `openDB` always uses the global one). Rejects
 * with a StorageError: `unavailable` when the browser refuses (or never answers), otherwise as
 * classified by `toStorageError`.
 */
export function openProjectDb(opts: OpenIdbOptions): Promise<Db> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  return new Promise<Db>((resolve, reject) => {
    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      outcome();
    };
    const timer = setTimeout(() => {
      finish(() => {
        reject(new StorageError('unavailable', `The browser did not open its storage within ${String(timeoutMs)} ms`));
      });
    }, timeoutMs);
    let request: IDBOpenDBRequest;
    try {
      request = opts.factory.open(opts.name ?? PROJECT_DB_NAME, PROJECT_DB_VERSION);
    } catch (error: unknown) {
      finish(() => {
        reject(toStorageError(error, true));
      });
      return;
    }
    request.onupgradeneeded = (event) => {
      const tx = request.transaction;
      if (tx !== null) upgrade(request.result, tx, event.oldVersion);
    };
    request.onerror = (event) => {
      // Handled here; without preventDefault the error would also reach window.onerror.
      event.preventDefault();
      finish(() => {
        reject(toStorageError(request.error, true));
      });
    };
    request.onblocked = () => {
      // Another tab holds an older version open; the open continues once it closes. Nothing to do.
    };
    request.onsuccess = () => {
      const raw = request.result;
      if (settled) {
        // The open answered after the timeout had already given up on it.
        raw.close();
        return;
      }
      let lost = false;
      const lose = (reason: string) => {
        if (lost) return;
        lost = true;
        opts.onClosed?.(reason);
      };
      raw.onversionchange = () => {
        // A newer version of the app wants to upgrade the database: let it, and stop writing.
        raw.close();
        lose('Another tab updated the storage format; reload this page to keep saving');
      };
      raw.onclose = () => {
        lose('The browser closed the storage connection');
      };
      finish(() => {
        resolve(wrap(raw) as unknown as Db);
      });
    };
  });
}

/** Runs `body` in a transaction and waits for it to commit; any failure becomes a StorageError. */
async function inTransaction<Names extends StoreNames<ProjectDbSchema>[], Mode extends IDBTransactionMode, T>(
  db: () => Db,
  names: Names,
  mode: Mode,
  body: (tx: IDBPTransaction<ProjectDbSchema, Names, Mode>) => Promise<T>,
): Promise<T> {
  let tx: IDBPTransaction<ProjectDbSchema, Names, Mode>;
  try {
    tx = db().transaction(names, mode);
  } catch (error: unknown) {
    throw toStorageError(error);
  }
  try {
    const [result] = await Promise.all([body(tx), tx.done]);
    return result;
  } catch (error: unknown) {
    // A transaction aborted for lack of space reports QuotaExceededError on the transaction, while
    // its requests fail with AbortError: prefer the transaction's reason.
    throw toStorageError(tx.error ?? error);
  }
}

/**
 * A read-write transaction on the raw database whose requests `issue` makes all at once, before
 * this returns: no request waits for another's answer (M4 review CR-01). A request's success
 * handler may call `refuse()` to abort the transaction after a failed check: nothing is written,
 * and the promise resolves `result()` all the same. Any other abort rejects with the
 * transaction's error as a StorageError.
 */
function issueAll<T>(db: () => IDBDatabase, names: readonly string[], issue: (tx: IDBTransaction, refuse: () => void) => () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db().transaction([...names], 'readwrite');
    } catch (error: unknown) {
      reject(toStorageError(error));
      return;
    }
    let refused = false;
    const refuse = () => {
      refused = true;
      tx.abort();
    };
    let result: () => T;
    try {
      result = issue(tx, refuse);
    } catch (error: unknown) {
      // A value the structured clone refuses throws here, synchronously: write nothing.
      try {
        tx.abort();
      } catch {
        // Already finished.
      }
      reject(toStorageError(error));
      return;
    }
    tx.oncomplete = () => {
      resolve(result());
    };
    tx.onabort = () => {
      if (refused) resolve(result());
      else reject(toStorageError(tx.error ?? new DOMException('The transaction was aborted', 'AbortError')));
    };
  });
}

const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function conflict(current: ProjectIndexRow | undefined): WriteProjectResult {
  return { ok: false, reason: 'conflict', current: current ?? null };
}

export interface IdbStorageOptions {
  /** `navigator.storage`, for the usage estimate; omitted: no estimate. */
  readonly storageManager?: Pick<StorageManager, 'estimate'> | undefined;
}

const REMOVAL_STORES: ['projects', 'projectIndex', 'backups', 'backupIndex'] = ['projects', 'projectIndex', 'backups', 'backupIndex'];
type RemovalTx = IDBPTransaction<ProjectDbSchema, typeof REMOVAL_STORES, 'readwrite'>;

/** Requests the removal of a project's record and index row. */
function requestRemoval(tx: RemovalTx, id: string): Promise<unknown> {
  return Promise.all([tx.objectStore('projects').delete(id), tx.objectStore('projectIndex').delete(id)]);
}

/** The two stores a backup is written to, in a transaction that has them. */
interface BackupStores {
  readonly rows: { put(value: BackupRow): Promise<unknown> };
  readonly summaries: { put(value: BackupSummaryRow): Promise<unknown> };
}

/** Requests the backups' rows and summaries. */
function requestBackups(stores: BackupStores, backups: readonly BackupRow[]): Promise<unknown> {
  return Promise.all(backups.flatMap((backup) => [stores.rows.put(backup), stores.summaries.put(summaryOf(backup))]));
}

const backupStores = (tx: { objectStore(name: 'backups'): BackupStores['rows']; objectStore(name: 'backupIndex'): BackupStores['summaries'] }): BackupStores => ({
  rows: tx.objectStore('backups'),
  summaries: tx.objectStore('backupIndex'),
});

export function createIdbProjectStorage(db: Db, opts: IdbStorageOptions = {}): ProjectStorage {
  let closed = false;
  const live = (): Db => {
    if (closed) throw new StorageError('closed', 'The storage connection is closed');
    return db;
  };
  const liveRaw = (): IDBDatabase => unwrap(live());

  return {
    kind: 'indexeddb',

    listProjects: () => inTransaction(live, ['projectIndex'], 'readonly', (tx) => tx.objectStore('projectIndex').getAll()).then((rows) => rows.sort((a, b) => byKey(a.id, b.id))),

    readIndex: (id) => inTransaction(live, ['projectIndex'], 'readonly', async (tx) => (await tx.objectStore('projectIndex').get(id)) ?? null),

    readProject: (id) =>
      inTransaction(live, ['projects', 'projectIndex'], 'readonly', async (tx) => {
        const [row, index] = await Promise.all([tx.objectStore('projects').get(id), tx.objectStore('projectIndex').get(id)]);
        return row === undefined || index === undefined ? null : { index, row };
      }),

    writeProject: (row, input: ProjectIndexInput, expectedSeq) =>
      issueAll(liveRaw, ['projects', 'projectIndex'], (tx, refuse) => {
        const indexStore = tx.objectStore('projectIndex');
        const next: ProjectIndexRow = { ...input, id: row.id, writeSeq: (expectedSeq ?? 0) + 1 };
        let outcome: WriteProjectResult = { ok: true, index: next };
        // The check and both puts are requested together. Requests run in order, so the check
        // answers first, and a failed check aborts the puts with it.
        const check = indexStore.get(row.id);
        check.onsuccess = () => {
          const current = check.result as ProjectIndexRow | undefined;
          if ((current?.writeSeq ?? null) !== expectedSeq) {
            outcome = conflict(current);
            refuse();
          }
        };
        tx.objectStore('projects').put(row);
        indexStore.put(next);
        return () => outcome;
      }),

    renameProject: (id, name, expectedSeq) =>
      inTransaction(live, ['projectIndex'], 'readwrite', async (tx): Promise<WriteProjectResult> => {
        const store = tx.objectStore('projectIndex');
        const current = await store.get(id);
        if (current === undefined || current.writeSeq !== expectedSeq) return conflict(current);
        const next: ProjectIndexRow = { ...current, name, writeSeq: current.writeSeq + 1 };
        await store.put(next);
        return { ok: true, index: next };
      }),

    moveToBackup: (id, meta: BackupMeta, extra = []) =>
      inTransaction(live, REMOVAL_STORES, 'readwrite', async (tx) => {
        // Read, then remove, then back up: requests run in the order they are made, so the reads
        // see the project and the removal comes before any backup needs space.
        const reads = Promise.all([tx.objectStore('projects').get(id), tx.objectStore('projectIndex').get(id)]);
        const removal = requestRemoval(tx, id);
        const [row, index] = await reads;
        const backup: BackupRow | null = row === undefined || index === undefined ? null : { ...meta, index, record: row };
        await Promise.all([removal, requestBackups(backupStores(tx), backup === null ? extra : [backup, ...extra])]);
        return backup;
      }),

    deleteProject: (id, extra = []) =>
      inTransaction(live, REMOVAL_STORES, 'readwrite', async (tx) => {
        const existed = tx.objectStore('projectIndex').count(id);
        await Promise.all([requestRemoval(tx, id), requestBackups(backupStores(tx), extra)]);
        return (await existed) > 0;
      }),

    putBackup: (backup) =>
      inTransaction(live, ['backups', 'backupIndex'], 'readwrite', async (tx) => {
        await requestBackups(backupStores(tx), [backup]);
      }),

    listBackups: () => inTransaction(live, ['backupIndex'], 'readonly', (tx) => tx.objectStore('backupIndex').getAll()).then((rows) => rows.sort((a, b) => byKey(a.id, b.id))),

    readBackup: (id) => inTransaction(live, ['backups'], 'readonly', async (tx) => (await tx.objectStore('backups').get(id)) ?? null),

    deleteBackup: (id) =>
      inTransaction(live, ['backups', 'backupIndex'], 'readwrite', async (tx) => {
        await Promise.all([tx.objectStore('backups').delete(id), tx.objectStore('backupIndex').delete(id)]);
      }),

    purgeBackups: (nowIso) =>
      inTransaction(live, ['backups', 'backupIndex'], 'readwrite', async (tx) => {
        const summaries = tx.objectStore('backupIndex');
        const due = await summaries.index('purgeAfter').getAllKeys(IDBKeyRange.upperBound(nowIso));
        await Promise.all(due.flatMap((key) => [tx.objectStore('backups').delete(key), summaries.delete(key)]));
        return due.length;
      }),

    getSetting: (key) => inTransaction(live, ['settings'], 'readonly', (tx) => tx.objectStore('settings').get(key)),

    setSetting: (key, value) =>
      inTransaction(live, ['settings'], 'readwrite', async (tx) => {
        await tx.objectStore('settings').put(value, key);
      }),

    async estimate(): Promise<StorageEstimate | null> {
      const manager = opts.storageManager;
      if (manager === undefined) return null;
      try {
        const { usage, quota } = await manager.estimate();
        return usage === undefined || quota === undefined ? null : { usage, quota };
      } catch {
        return null;
      }
    },

    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
