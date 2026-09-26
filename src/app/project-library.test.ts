import { describe, expect, it, vi } from 'vitest';
import { sequentialIdSource } from '../domain';
import { createMemoryProjectStorage } from '../infra/persistence';
import { parseProjectText, type ParseProjectResult } from '../project';
import { manualClock } from './clock';
import { cleanProjectName, createProjectLibrary, MAX_PROJECT_NAME_LENGTH } from './project-library';
import { notesProject } from './test-helpers';

function setup() {
  const storage = createMemoryProjectStorage();
  const clock = manualClock('2026-09-25T12:00:00.000Z');
  const library = createProjectLibrary({ storage, clock, ids: sequentialIdSource(100) });
  return { storage, clock, library };
}

describe('cleanProjectName', () => {
  it('trims, folds runs of whitespace and cuts long names; nothing left is no name', () => {
    expect(cleanProjectName('  Durotar \n run  ')).toBe('Durotar run');
    expect(cleanProjectName(' \t ')).toBeNull();
    expect(cleanProjectName('x'.repeat(200))?.length).toBe(MAX_PROJECT_NAME_LENGTH);
  });
});

describe('createProjectLibrary', () => {
  it('lists projects most recently updated first, and reads them back as projects', async () => {
    const { library, clock } = setup();
    const older = { ...notesProject('ab'), id: 'p-old' } as ReturnType<typeof notesProject>;
    const newer = { ...notesProject('c'), id: 'p-new', updatedAt: '2026-09-25T13:00:00.000Z' } as ReturnType<typeof notesProject>;
    clock.set('2026-09-25T14:00:00.000Z');
    await library.write({ name: 'Old', sample: false, writeSeq: null }, older, null);
    await library.write({ name: 'New', sample: true, writeSeq: null }, newer, null);
    expect((await library.list()).map((p) => [p.name, p.stepCount, p.sample, p.savedAt])).toEqual([
      ['New', 1, true, '2026-09-25T14:00:00.000Z'],
      ['Old', 2, false, '2026-09-25T14:00:00.000Z'],
    ]);
    const loaded = await library.load('p-old');
    expect(loaded.ok && loaded.project).toEqual(older);
    expect(loaded.ok && loaded.handle).toMatchObject({ name: 'Old', writeSeq: 1, storedRevision: older.dataRevision, prints: null });
    expect(await library.load('missing')).toMatchObject({ ok: false, reason: 'missing' });
    expect(await library.summary('p-new')).toMatchObject({ name: 'New', writeSeq: 1 });
    expect(await library.summary('missing')).toBeNull();
  });

  it('says a record that could not be read can be tried again', async () => {
    const { storage, clock } = setup();
    const library = createProjectLibrary({ storage: { ...storage, readProject: () => Promise.reject(new Error('disk hiccup')) }, clock, ids: sequentialIdSource(1) });
    expect(await library.load('p1')).toEqual({ ok: false, reason: 'storage', message: 'The stored project could not be read (disk hiccup)', errors: [] });
  });

  it('refuses a stored document whose id disagrees with its record', async () => {
    const { library, storage } = setup();
    const project = notesProject('a');
    await storage.writeProject(
      { id: 'elsewhere', project, dataPrints: null },
      { id: 'elsewhere', name: 'X', createdAt: '', updatedAt: '', savedAt: '', stepCount: 1, dataRevision: 'r', schemaVersion: 1, sample: false },
      null,
    );
    expect(await library.load('elsewhere')).toMatchObject({ ok: false, reason: 'invalid', errors: [{ path: 'id' }] });
  });

  it('restores a deleted project under its own id and keeps the backup list tidy', async () => {
    const { library } = setup();
    const project = notesProject('a');
    await library.write({ name: 'Kept', sample: false, writeSeq: null }, project, null);
    const backup = await library.moveToBackup(project.id, 'deleted');
    expect(backup).toMatchObject({ reason: 'deleted', purgeAfter: '2026-10-25T12:00:00.000Z', project: { id: project.id, name: 'Kept' } });
    expect(backup?.id).toMatch(/^backup-/);
    expect(await library.list()).toEqual([]);
    const restored = await library.restoreBackup(backup?.id ?? '');
    expect(restored).toMatchObject({ id: project.id, name: 'Kept', writeSeq: 1 });
    expect(await library.listBackups()).toEqual([]);
    expect(await library.restoreBackup('gone')).toBeNull();
  });

  it('reads index rows only for renames, restores and summaries (CR-14)', async () => {
    const { library, storage } = setup();
    const project = notesProject('a');
    await library.write({ name: 'Kept', sample: false, writeSeq: null }, project, null);
    const backup = await library.moveToBackup(project.id, 'deleted');
    const readProject = vi.spyOn(storage, 'readProject');
    await library.restoreBackup(backup?.id ?? '');
    expect(await library.rename(project.id, 'Renamed', 1)).toMatchObject({ ok: true, summary: { name: 'Renamed', writeSeq: 2 } });
    expect(await library.rename(project.id, 'Stale', 1)).toMatchObject({ ok: false, reason: 'conflict', current: { writeSeq: 2 } });
    await library.summary(project.id);
    await library.listBackups();
    expect(readProject).not.toHaveBeenCalled();
  });

  it('deletes for good, keeping only the backups it is given', async () => {
    const { library } = setup();
    const project = notesProject('ab');
    await library.write({ name: 'Doomed', sample: false, writeSeq: null }, project, null);
    const edited = { ...project, route: { ...project.route, name: 'Unsaved edit' } };
    const own = library.backupOf(edited, { name: 'Doomed', sample: false, writeSeq: 1, savedAt: '2026-09-25T11:00:00.000Z' }, null, 'deleted');
    expect(own.summary).toMatchObject({ reason: 'deleted', purgeAfter: '2026-10-25T12:00:00.000Z', project: { id: project.id, name: 'Doomed', stepCount: 2, writeSeq: 1, savedAt: '2026-09-25T11:00:00.000Z' } });
    expect(await library.deletePermanently(project.id, [own.row])).toBe(true);
    expect(await library.list()).toEqual([]);
    expect((await library.listBackups()).map((b) => b.id)).toEqual([own.row.id]);
    await library.deleteBackup(own.row.id);
    expect(await library.listBackups()).toEqual([]);
  });

  it('backs up the original of a migrated project once per stored version (CR-18)', async () => {
    const { storage, clock } = setup();
    const project = notesProject('a');
    const parseV2 = (document: unknown): ParseProjectResult => parseProjectText(JSON.stringify(document));
    const library = createProjectLibrary({ storage, clock, ids: sequentialIdSource(200), parse: parseV2, latestSchemaVersion: 2 });
    await library.write({ name: 'Old', sample: false, writeSeq: null }, project, null);
    const first = await library.load(project.id);
    const second = await library.load(project.id);
    expect(first.ok && first.migratedFrom).toBe(1);
    expect(second.ok && second.backup?.id).toBe(first.ok ? first.backup?.id : 'no');
    expect(await library.listBackups()).toHaveLength(1);
    // A new stored version (still of the old schema, from an older app in another tab) gets its own.
    await library.write({ name: 'Old', sample: false, writeSeq: 1 }, project, null);
    await library.load(project.id);
    expect(await library.listBackups()).toHaveLength(2);
  });

  it('measures stored records once per stored version, for the "storage is full" message', async () => {
    const { library, storage } = setup();
    const project = notesProject('abc');
    await library.write({ name: 'Measured', sample: false, writeSeq: null }, project, null);
    await library.moveToBackup(project.id, 'deleted');
    await library.write({ name: 'Measured again', sample: false, writeSeq: null }, project, null);
    const readProject = vi.spyOn(storage, 'readProject');
    const sizes = await library.recordSizes();
    expect(sizes.map((s) => [s.kind, s.name])).toEqual([
      ['project', 'Measured again'],
      ['backup', 'Measured'],
    ]);
    const bytes = JSON.stringify(project).length + 'null'.length;
    expect(sizes.map((s) => s.bytes)).toEqual([bytes, bytes]);
    await library.recordSizes();
    expect(readProject).toHaveBeenCalledTimes(1);
  });

  it('remembers the last open project', async () => {
    const { library } = setup();
    expect(await library.lastProjectId()).toBeNull();
    await library.setLastProjectId('p1');
    expect(await library.lastProjectId()).toBe('p1');
  });
});
