import { StorageError } from './errors';
import type {
  BackupMeta,
  BackupRow,
  BackupSummaryRow,
  ProjectIndexInput,
  ProjectIndexRow,
  ProjectRow,
  ProjectStorage,
  WriteProjectResult,
} from './types';

/**
 * Project storage in memory, with the IndexedDB storage's semantics (the `writeSeq` check, atomic
 * moves, nothing a reader does changes what is stored). The app falls back to it when the browser
 * refuses storage, so projects still work for the visit, and says that nothing outlives the page.
 * Tests use it too.
 *
 * Project records are not copied (M4 review CR-06): a deep copy of a 10,000-step project on every
 * autosave is a long task on the main thread. Project documents are immutable in the app (every
 * command builds a new project with structural sharing), so storage keeps the reference and
 * deep-freezes it instead; the freeze visits only objects it has not frozen before, so a save
 * after an edit costs the new objects and the arrays that hold them. A reader that tries to change
 * a record gets a TypeError rather than a silent change to storage. Index rows and settings are
 * small and copied, as IndexedDB copies them.
 */

const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A deep copy, as IndexedDB's structured clone makes on every write and read (small values only). */
const copy = <T>(value: T): T => structuredClone(value);

/** Objects this module has deep-frozen: their whole subtree is frozen, so a later freeze stops there. */
const deepFrozen = new WeakSet<object>();

/**
 * Freezes `value` and everything it holds, children first, so a frozen object recorded here never
 * holds an unfrozen one. Returns `value`.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || deepFrozen.has(value)) return value;
  // Views over buffers cannot be frozen; project documents hold none.
  if (ArrayBuffer.isView(value)) return value;
  for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  Object.freeze(value);
  deepFrozen.add(value);
  return value;
}

export function createMemoryProjectStorage(): ProjectStorage {
  const projects = new Map<string, ProjectRow>();
  const index = new Map<string, ProjectIndexRow>();
  const backups = new Map<string, BackupRow>();
  const settings = new Map<string, unknown>();
  let closed = false;

  const open = (): void => {
    if (closed) throw new StorageError('closed', 'The storage connection is closed');
  };
  // Every operation answers asynchronously, like IndexedDB, and runs its checks and writes in one
  // synchronous step (inside the promise executor, so a write is made before the call returns),
  // so each is atomic.
  const run = <T>(operation: () => T): Promise<T> =>
    new Promise<T>((resolve) => {
      open();
      resolve(operation());
    });

  function checkSeq(id: string, expectedSeq: number | null): WriteProjectResult | null {
    const current = index.get(id) ?? null;
    if ((current?.writeSeq ?? null) === expectedSeq) return null;
    return { ok: false, reason: 'conflict', current: current === null ? null : copy(current) };
  }

  /** A backup as stored: its record frozen (not copied), its index row copied. */
  const kept = (backup: BackupRow): BackupRow => deepFreeze({ ...backup, index: copy(backup.index), record: deepFreeze(backup.record) });

  function remove(id: string): boolean {
    const existed = index.has(id);
    projects.delete(id);
    index.delete(id);
    return existed;
  }

  const summaryOf = ({ record: _record, ...summary }: BackupRow): BackupSummaryRow => copy(summary);

  return {
    kind: 'memory',

    listProjects: () => run(() => [...index.values()].sort((a, b) => byKey(a.id, b.id)).map(copy)),

    readIndex: (id) =>
      run(() => {
        const entry = index.get(id);
        return entry === undefined ? null : copy(entry);
      }),

    readProject: (id) =>
      run(() => {
        const row = projects.get(id);
        const entry = index.get(id);
        return row === undefined || entry === undefined ? null : { index: copy(entry), row };
      }),

    writeProject: (row, input: ProjectIndexInput, expectedSeq) =>
      run((): WriteProjectResult => {
        const conflict = checkSeq(row.id, expectedSeq);
        if (conflict !== null) return conflict;
        const next: ProjectIndexRow = { ...copy(input), id: row.id, writeSeq: (index.get(row.id)?.writeSeq ?? 0) + 1 };
        projects.set(row.id, deepFreeze({ ...row }));
        index.set(row.id, next);
        return { ok: true, index: copy(next) };
      }),

    renameProject: (id, name, expectedSeq) =>
      run((): WriteProjectResult => {
        const current = index.get(id);
        const conflict = checkSeq(id, expectedSeq);
        if (conflict !== null || current === undefined) return conflict ?? { ok: false, reason: 'conflict', current: null };
        const next: ProjectIndexRow = { ...current, name, writeSeq: current.writeSeq + 1 };
        index.set(id, next);
        return { ok: true, index: copy(next) };
      }),

    moveToBackup: (id, meta: BackupMeta, extra = []) =>
      run((): BackupRow | null => {
        const row = projects.get(id);
        const entry = index.get(id);
        remove(id);
        const backup = row === undefined || entry === undefined ? null : kept({ ...meta, index: entry, record: row });
        for (const other of backup === null ? extra : [backup, ...extra]) backups.set(other.id, kept(other));
        return backup;
      }),

    deleteProject: (id, extra = []) =>
      run(() => {
        const existed = remove(id);
        for (const backup of extra) backups.set(backup.id, kept(backup));
        return existed;
      }),

    putBackup: (backup) =>
      run(() => {
        backups.set(backup.id, kept(backup));
      }),

    listBackups: () => run(() => [...backups.values()].sort((a, b) => byKey(a.id, b.id)).map(summaryOf)),

    readBackup: (id) => run(() => backups.get(id) ?? null),

    deleteBackup: (id) =>
      run(() => {
        backups.delete(id);
      }),

    purgeBackups: (nowIso) =>
      run(() => {
        let removed = 0;
        for (const [id, backup] of [...backups]) {
          if (backup.purgeAfter <= nowIso) {
            backups.delete(id);
            removed += 1;
          }
        }
        return removed;
      }),

    getSetting: (key) => run(() => copy(settings.get(key))),

    setSetting: (key, value) =>
      run(() => {
        settings.set(key, copy(value));
      }),

    estimate: () => Promise.resolve(null),

    close() {
      closed = true;
    },
  };
}
