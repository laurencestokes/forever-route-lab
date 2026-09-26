import 'fake-indexeddb/auto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageError, toStorageError } from './errors';
import { createIdbProjectStorage, openProjectDb, PROJECT_DB_NAME, PROJECT_DB_VERSION } from './idb-storage';
import { createMemoryProjectStorage, deepFreeze } from './memory-storage';
import { openProjectStorage } from './open';
import { announcingChanges, broadcastChanges, readStorageChange, type StorageChange, webLocks } from './tabs';
import { fakeChannelHub, fakeLockManager } from './test-doubles';
import type { BackupRow, ProjectIndexInput, ProjectRow, ProjectStorage } from './types';

const T0 = '2026-09-25T12:00:00.000Z';
const T1 = '2026-09-26T12:00:00.000Z';

const row = (id: string, body: Record<string, unknown> = {}): ProjectRow => ({ id, project: { id, schemaVersion: 1, ...body }, dataPrints: null });

const input = (id: string, name = `Project ${id}`): ProjectIndexInput => ({
  id,
  name,
  createdAt: T0,
  updatedAt: T0,
  savedAt: T0,
  stepCount: 3,
  dataRevision: 'rev-a',
  schemaVersion: 1,
  sample: false,
});

const backupRow = (id: string, projectId: string, purgeAfter: string): BackupRow => ({
  id,
  reason: 'deleted',
  createdAt: T0,
  purgeAfter,
  index: { ...input(projectId), writeSeq: 1 },
  record: row(projectId, { steps: [id] }),
});

async function idbStorage(): Promise<ProjectStorage> {
  return createIdbProjectStorage(await openProjectDb({ factory: new IDBFactory() }));
}

/** Settles the macrotasks the fake channels deliver in. */
const tick = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

afterEach(() => {
  vi.restoreAllMocks();
});

const BACKENDS: readonly (readonly [string, () => Promise<ProjectStorage>])[] = [
  ['indexeddb (fake-indexeddb)', idbStorage],
  ['memory', () => Promise.resolve(createMemoryProjectStorage())],
];

describe.each(BACKENDS)('%s project storage', (_name, make) => {
  it('writes a project and its index row together, and nothing a reader does changes what is stored', async () => {
    const storage = await make();
    const written = await storage.writeProject(row('p1', { steps: [1, 2, 3] }), input('p1'), null);
    expect(written).toEqual({ ok: true, index: { ...input('p1'), writeSeq: 1 } });
    const read = await storage.readProject('p1');
    expect(read?.row.project).toEqual({ id: 'p1', schemaVersion: 1, steps: [1, 2, 3] });
    expect(read?.index.writeSeq).toBe(1);
    // IndexedDB hands out a copy; memory storage hands out the stored record frozen (CR-06), so a
    // change is refused. Either way, what is stored stays as it was.
    try {
      (read?.row.project as { steps: number[] }).steps.push(4);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(TypeError);
    }
    expect((await storage.readProject('p1'))?.row.project).toEqual({ id: 'p1', schemaVersion: 1, steps: [1, 2, 3] });
    expect(await storage.readProject('missing')).toBeNull();
  });

  it('reads an index row on its own', async () => {
    const storage = await make();
    await storage.writeProject(row('p1'), input('p1', 'Indexed'), null);
    expect(await storage.readIndex('p1')).toEqual({ ...input('p1', 'Indexed'), writeSeq: 1 });
    expect(await storage.readIndex('missing')).toBeNull();
  });

  it('lists index rows in id order', async () => {
    const storage = await make();
    await storage.writeProject(row('b'), input('b'), null);
    await storage.writeProject(row('a'), input('a'), null);
    expect((await storage.listProjects()).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('refuses a write whose expected writeSeq is not the stored one (another tab wrote in between)', async () => {
    const storage = await make();
    await storage.writeProject(row('p1'), input('p1'), null);
    // Creating a project that already exists is a conflict too.
    const again = await storage.writeProject(row('p1', { edited: 'x' }), input('p1'), null);
    expect(again).toMatchObject({ ok: false, reason: 'conflict', current: { writeSeq: 1 } });
    const second = await storage.writeProject(row('p1', { edited: 'tab A' }), input('p1'), 1);
    expect(second).toMatchObject({ ok: true, index: { writeSeq: 2 } });
    const stale = await storage.writeProject(row('p1', { edited: 'tab B' }), input('p1', 'Renamed by B'), 1);
    expect(stale).toMatchObject({ ok: false, reason: 'conflict', current: { writeSeq: 2 } });
    // Neither the record nor the index row of the refused write was kept.
    expect(await storage.readProject('p1')).toMatchObject({ row: { project: { edited: 'tab A' } }, index: { name: 'Project p1', writeSeq: 2 } });
    // Updating a project that is gone is refused, and writes nothing.
    expect(await storage.writeProject(row('gone'), input('gone'), 3)).toEqual({ ok: false, reason: 'conflict', current: null });
    expect(await storage.readIndex('gone')).toBeNull();
  });

  it('renames in the index only, bumping writeSeq, with the same check', async () => {
    const storage = await make();
    await storage.writeProject(row('p1'), input('p1', 'Old'), null);
    expect(await storage.renameProject('p1', 'New', 1)).toMatchObject({ ok: true, index: { name: 'New', writeSeq: 2 } });
    expect(await storage.renameProject('p1', 'Other', 1)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(await storage.renameProject('gone', 'Other', 1)).toEqual({ ok: false, reason: 'conflict', current: null });
    expect((await storage.readProject('p1'))?.index.name).toBe('New');
  });

  it('moves a project to the backups in one step, keeping its record and index row, with extra backups', async () => {
    const storage = await make();
    await storage.writeProject(row('p1', { steps: [1] }), input('p1', 'Keep me'), null);
    const extra = backupRow('backup-extra', 'p1', T1);
    const backup = await storage.moveToBackup('p1', { id: 'backup-1', reason: 'deleted', createdAt: T0, purgeAfter: T1 }, [extra]);
    expect(backup).toMatchObject({ id: 'backup-1', reason: 'deleted', index: { name: 'Keep me' }, record: { project: { steps: [1] } } });
    expect(await storage.readProject('p1')).toBeNull();
    expect(await storage.listProjects()).toEqual([]);
    expect(await storage.listBackups()).toEqual([
      { id: 'backup-1', reason: 'deleted', createdAt: T0, purgeAfter: T1, index: { ...input('p1', 'Keep me'), writeSeq: 1 } },
      { id: 'backup-extra', reason: 'deleted', createdAt: T0, purgeAfter: T1, index: { ...input('p1'), writeSeq: 1 } },
    ]);
    expect((await storage.readBackup('backup-1'))?.record.project).toEqual({ id: 'p1', schemaVersion: 1, steps: [1] });
    expect((await storage.readBackup('backup-extra'))?.record.project).toEqual({ id: 'p1', schemaVersion: 1, steps: ['backup-extra'] });
    // A project that is gone: no backup of it, but the extra backups are written all the same.
    expect(await storage.moveToBackup('p1', { id: 'backup-2', reason: 'deleted', createdAt: T0, purgeAfter: T1 }, [backupRow('backup-3', 'p1', T1)])).toBeNull();
    expect((await storage.listBackups()).map((b) => b.id)).toEqual(['backup-1', 'backup-3', 'backup-extra']);
  });

  it('deletes a project for good, with no backup of what is stored (CR-03)', async () => {
    const storage = await make();
    await storage.writeProject(row('p1'), input('p1'), null);
    expect(await storage.deleteProject('p1')).toBe(true);
    expect(await storage.readIndex('p1')).toBeNull();
    expect(await storage.readProject('p1')).toBeNull();
    expect(await storage.listBackups()).toEqual([]);
    expect(await storage.deleteProject('p1')).toBe(false);
    // An extra backup (a version only the page had) goes in with the removal.
    await storage.writeProject(row('p2'), input('p2'), null);
    expect(await storage.deleteProject('p2', [backupRow('backup-unsaved', 'p2', T1)])).toBe(true);
    expect((await storage.listBackups()).map((b) => b.id)).toEqual(['backup-unsaved']);
  });

  it('purges the backups that are due, and only those, and deletes one for good', async () => {
    const storage = await make();
    await storage.putBackup(backupRow('b-old', 'p1', '2026-09-20T00:00:00.000Z'));
    await storage.putBackup(backupRow('b-now', 'p1', T0));
    await storage.putBackup(backupRow('b-later', 'p1', T1));
    expect(await storage.purgeBackups(T0)).toBe(2);
    expect((await storage.listBackups()).map((b) => b.id)).toEqual(['b-later']);
    expect(await storage.readBackup('b-old')).toBeNull();
    await storage.deleteBackup('b-later');
    expect(await storage.listBackups()).toEqual([]);
    expect(await storage.readBackup('b-later')).toBeNull();
  });

  it('keeps settings', async () => {
    const storage = await make();
    expect(await storage.getSetting('lastProjectId')).toBeUndefined();
    await storage.setSetting('lastProjectId', 'p1');
    expect(await storage.getSetting('lastProjectId')).toBe('p1');
  });

  it('refuses every operation once closed', async () => {
    const storage = await make();
    storage.close();
    for (const operation of [() => storage.listProjects(), () => storage.writeProject(row('p1'), input('p1'), null), () => storage.readIndex('p1')]) {
      const error = await operation().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(StorageError);
      expect((error as StorageError).code).toBe('closed');
    }
  });
});

describe('IndexedDB storage', () => {
  it('survives a reopen: the same database holds the same projects', async () => {
    const factory = new IDBFactory();
    const first = createIdbProjectStorage(await openProjectDb({ factory }));
    await first.writeProject(row('p1'), input('p1'), null);
    await first.setSetting('lastProjectId', 'p1');
    first.close();
    const second = createIdbProjectStorage(await openProjectDb({ factory }));
    expect((await second.listProjects()).map((r) => r.id)).toEqual(['p1']);
    expect(await second.getSetting('lastProjectId')).toBe('p1');
  });

  it('makes every request of a write before writeProject returns (CR-01)', async () => {
    const storage = await idbStorage();
    await storage.writeProject(row('p1'), input('p1'), null);
    const puts = vi.spyOn(IDBObjectStore.prototype, 'put');
    const gets = vi.spyOn(IDBObjectStore.prototype, 'get');
    const written = storage.writeProject(row('p1', { edited: true }), input('p1'), 1);
    // Synchronously, inside the caller's task: the check and both puts.
    expect(gets).toHaveBeenCalledTimes(1);
    expect(puts.mock.contexts.map((store) => (store as IDBObjectStore).name).sort()).toEqual(['projectIndex', 'projects']);
    expect(await written).toMatchObject({ ok: true, index: { writeSeq: 2 } });
  });

  it('rejects a write the browser refuses with a StorageError, and writes nothing', async () => {
    const storage = await idbStorage();
    // A value the structured clone refuses stands in for the browser's refusal. A full quota is
    // classified from the error's name (toStorageError, below), which fake-indexeddb cannot produce.
    const error = await storage.writeProject({ id: 'p1', project: () => undefined, dataPrints: null }, input('p1'), null).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).code).toBe('failed');
    // Nothing half-written.
    expect(await storage.listProjects()).toEqual([]);
    expect(await storage.readIndex('p1')).toBeNull();
  });

  it('removes a project before it writes its backup, so a delete at a full quota frees space first (CR-03)', async () => {
    const storage = await idbStorage();
    await storage.writeProject(row('p1'), input('p1'), null);
    const deletes = vi.spyOn(IDBObjectStore.prototype, 'delete');
    const puts = vi.spyOn(IDBObjectStore.prototype, 'put');
    await storage.moveToBackup('p1', { id: 'backup-1', reason: 'deleted', createdAt: T0, purgeAfter: T1 });
    const calls = (verb: string, spy: typeof deletes | typeof puts) =>
      spy.mock.contexts.map((store, i) => ({ at: spy.mock.invocationCallOrder[i] ?? 0, what: `${verb} ${(store as IDBObjectStore).name}` }));
    const order = [...calls('delete', deletes), ...calls('put', puts)].sort((a, b) => a.at - b.at).map((call) => call.what);
    expect(order).toEqual(['delete projects', 'delete projectIndex', 'put backups', 'put backupIndex']);
  });

  it('lists backups from their index, without loading a record (CR-14)', async () => {
    const storage = await idbStorage();
    await storage.putBackup(backupRow('b1', 'p1', T1));
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    const get = vi.spyOn(IDBObjectStore.prototype, 'get');
    expect((await storage.listBackups()).map((b) => b.id)).toEqual(['b1']);
    expect(getAll.mock.contexts.map((store) => (store as IDBObjectStore).name)).toEqual(['backupIndex']);
    expect(get).not.toHaveBeenCalled();
  });

  it('upgrades a version 1 database, moving the backup summaries to their own store', async () => {
    const factory = new IDBFactory();
    // The version 1 layout, with one project and one backup in it.
    await new Promise<void>((resolve, reject) => {
      const request = factory.open(PROJECT_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('projects', { keyPath: 'id' }).put(row('p1'));
        db.createObjectStore('projectIndex', { keyPath: 'id' }).put({ ...input('p1'), writeSeq: 1 });
        const backups = db.createObjectStore('backups', { keyPath: 'id' });
        backups.createIndex('purgeAfter', 'purgeAfter');
        backups.put(backupRow('b1', 'p0', T0));
        backups.put(backupRow('b2', 'p0', T1));
        db.createObjectStore('settings').put('p1', 'lastProjectId');
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => {
        reject(request.error ?? new Error('open failed'));
      };
    });
    const storage = createIdbProjectStorage(await openProjectDb({ factory }));
    expect((await storage.listProjects()).map((r) => r.id)).toEqual(['p1']);
    expect(await storage.getSetting('lastProjectId')).toBe('p1');
    expect((await storage.listBackups()).map((b) => [b.id, b.purgeAfter])).toEqual([
      ['b1', T0],
      ['b2', T1],
    ]);
    expect((await storage.readBackup('b2'))?.record.project).toEqual({ id: 'p0', schemaVersion: 1, steps: ['b2'] });
    expect(await storage.purgeBackups(T0)).toBe(1);
    expect((await storage.listBackups()).map((b) => b.id)).toEqual(['b2']);
  });

  it('says how much storage is used when the browser tells, and nothing otherwise', async () => {
    const db = await openProjectDb({ factory: new IDBFactory() });
    expect(await createIdbProjectStorage(db).estimate()).toBeNull();
    const withManager = createIdbProjectStorage(db, { storageManager: { estimate: () => Promise.resolve({ usage: 10, quota: 100 }) } });
    expect(await withManager.estimate()).toEqual({ usage: 10, quota: 100 });
    const failing = createIdbProjectStorage(db, { storageManager: { estimate: () => Promise.reject(new Error('no')) } });
    expect(await failing.estimate()).toBeNull();
  });

  it('stops and reports when another tab upgrades the database', async () => {
    const factory = new IDBFactory();
    const reasons: string[] = [];
    await openProjectDb({ factory, onClosed: (reason) => reasons.push(reason) });
    // A newer version of the app opens the same database at a higher version.
    await new Promise<void>((resolve, reject) => {
      const request = factory.open(PROJECT_DB_NAME, PROJECT_DB_VERSION + 1);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => {
        reject(request.error ?? new Error('open failed'));
      };
    });
    expect(reasons).toEqual(['Another tab updated the storage format; reload this page to keep saving']);
  });
});

describe('memory storage', () => {
  it('keeps the frozen record instead of a copy (CR-06), freezing only what it has not frozen before', () => {
    const shared = { steps: [{ id: 's1' }] };
    const first = deepFreeze({ id: 'p1', route: shared });
    expect(Object.isFrozen(first.route.steps[0])).toBe(true);
    // A new project that shares its route with the first: the route is not visited again.
    const keys = vi.spyOn(Object, 'keys');
    deepFreeze({ id: 'p1', route: shared, name: 'edited' });
    expect(keys.mock.calls.map(([value]) => value)).not.toContain(shared);
  });

  it('stores what it is given without copying it', async () => {
    const storage = createMemoryProjectStorage();
    const project = { id: 'p1', schemaVersion: 1, steps: [1] };
    await storage.writeProject({ id: 'p1', project, dataPrints: null }, input('p1'), null);
    expect((await storage.readProject('p1'))?.row.project).toBe(project);
    expect(Object.isFrozen(project.steps)).toBe(true);
  });
});

describe('openProjectStorage', () => {
  it('opens IndexedDB when the browser allows it, with the links to other tabs it is given', async () => {
    const locks = webLocks(fakeLockManager());
    const channel = broadcastChanges(fakeChannelHub().connect());
    const opened = await openProjectStorage({ factory: new IDBFactory(), locks, channel });
    expect(opened.storage.kind).toBe('indexeddb');
    expect(opened.unavailable).toBeNull();
    expect(opened.locks).toBe(locks);
    expect(opened.channel).toBe(channel);
  });

  it('falls back to memory with the reason when there is no IndexedDB, and without links to other tabs', async () => {
    const opened = await openProjectStorage({ factory: undefined, locks: webLocks(fakeLockManager()), channel: broadcastChanges(fakeChannelHub().connect()) });
    expect(opened.storage.kind).toBe('memory');
    expect(opened.unavailable).toBe('This browser offers no IndexedDB here');
    expect(opened.locks).toBeNull();
    expect(opened.channel).toBeNull();
  });

  it('falls back to memory when the browser refuses the open (a private window)', async () => {
    const refusing = {
      open() {
        throw new DOMException('A mutation operation was attempted on a database that did not allow mutations.', 'InvalidStateError');
      },
    } as unknown as IDBFactory;
    const opened = await openProjectStorage({ factory: refusing });
    expect(opened.storage.kind).toBe('memory');
    expect(opened.unavailable).toMatch(/^The browser does not allow storage here \(InvalidStateError: /);
  });

  it('falls back to memory when the open never answers', async () => {
    const silent = { open: () => ({}) } as unknown as IDBFactory;
    const opened = await openProjectStorage({ factory: silent, timeoutMs: 5 });
    expect(opened.storage.kind).toBe('memory');
    expect(opened.unavailable).toBe('The browser did not open its storage within 5 ms');
  });
});

describe('links between tabs (CR-02)', () => {
  it('takes a project lock only when no other tab holds it, and waits for it in the background', async () => {
    const manager = fakeLockManager();
    const tabA = webLocks(manager);
    const tabB = webLocks(manager);
    const held = await tabA.tryAcquire('p1');
    expect(held).not.toBeNull();
    expect(await tabB.tryAcquire('p1')).toBeNull();
    const acquired = vi.fn();
    const waiting = tabB.wait('p1', acquired);
    await tick();
    expect(acquired).not.toHaveBeenCalled();
    held?.release();
    await tick();
    expect(acquired).toHaveBeenCalledTimes(1);
    expect(manager.held('p1')).toBe(true);
    waiting.release();
    await tick();
    expect(manager.held('p1')).toBe(false);
    // A wait given up before the lock came never runs its callback.
    const again = await tabA.tryAcquire('p1');
    const never = vi.fn();
    tabB.wait('p1', never).release();
    again?.release();
    await tick();
    expect(never).not.toHaveBeenCalled();
    expect(manager.held('p1')).toBe(false);
  });

  it('knows nothing, rather than guessing "held", when the browser refuses a lock request', async () => {
    const refusing = webLocks({ request: () => Promise.reject(new DOMException('no', 'SecurityError')) });
    expect(await refusing.tryAcquire('p1')).not.toBeNull();
  });

  it('tells the other tabs about every stored change, never the tab that made it', async () => {
    const hub = fakeChannelHub();
    const mine = broadcastChanges(hub.connect());
    const theirs = broadcastChanges(hub.connect());
    const heardHere: StorageChange[] = [];
    const heardThere: StorageChange[] = [];
    mine.subscribe((change) => heardHere.push(change));
    theirs.subscribe((change) => heardThere.push(change));
    const storage = announcingChanges(createMemoryProjectStorage(), mine);
    await storage.writeProject(row('p1'), input('p1'), null);
    await storage.writeProject(row('p1'), input('p1'), null);
    await storage.renameProject('p1', 'New name', 1);
    await storage.moveToBackup('p1', { id: 'backup-1', reason: 'deleted', createdAt: T0, purgeAfter: T1 });
    await storage.deleteBackup('backup-1');
    await tick();
    expect(heardHere).toEqual([]);
    expect(heardThere).toEqual([
      { kind: 'project', id: 'p1', index: { ...input('p1'), writeSeq: 1 }, previousSeq: null, nameOnly: false },
      { kind: 'project', id: 'p1', index: { ...input('p1', 'New name'), writeSeq: 2 }, previousSeq: 1, nameOnly: true },
      { kind: 'project', id: 'p1', index: null, previousSeq: null, nameOnly: false },
      { kind: 'backups' },
      { kind: 'backups' },
    ]);
  });

  it('ignores a message that is not a storage change', () => {
    expect(readStorageChange('hello')).toBeNull();
    expect(readStorageChange({ kind: 'project', id: 'p1', index: { id: 'p1' }, previousSeq: null, nameOnly: false })).toBeNull();
    expect(readStorageChange({ kind: 'project', id: 'p1', index: null, previousSeq: 'x', nameOnly: false })).toBeNull();
    expect(readStorageChange({ kind: 'backups', extra: 1 })).toEqual({ kind: 'backups' });
  });
});

describe('toStorageError', () => {
  it('classifies quota, refusal, closed and other failures', () => {
    expect(toStorageError(new DOMException('full', 'QuotaExceededError')).code).toBe('quota');
    expect(toStorageError({ name: 'NS_ERROR_DOM_QUOTA_REACHED', message: 'full' }).code).toBe('quota');
    expect(toStorageError(new DOMException('no', 'SecurityError'), true).code).toBe('unavailable');
    expect(toStorageError(new DOMException('no', 'InvalidStateError'), true).code).toBe('unavailable');
    expect(toStorageError(new DOMException('gone', 'InvalidStateError')).code).toBe('closed');
    expect(toStorageError(new Error('odd')).code).toBe('failed');
    expect(toStorageError(new Error('odd')).message).toBe('odd');
    const same = new StorageError('quota', 'x');
    expect(toStorageError(same)).toBe(same);
    expect(toStorageError(new DOMException('full', 'QuotaExceededError')).message).toBe('Browser storage for this site is full (full)');
  });
});
