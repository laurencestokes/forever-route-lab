import 'fake-indexeddb/auto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixturePrepared, fixtureView } from '../../tests/support/fixture-dataset';
import { projectId, type ProjectV1, sequentialIdSource } from '../domain';
import { createIdbProjectStorage, openProjectDb, type ProjectStorage } from '../infra/persistence';
import { parseProjectText, type ParseProjectResult, serializeProject } from '../project';
import { manualClock } from './clock';
import { insertNote, renameRoute } from './commands';
import { preparedDatasetSource } from './dataset-source';
import { dataPrintsOf } from './drift';
import { createProjectLibrary } from './project-library';
import { createMemoryProjectStorage, createTestSession, settle, testTabs, type TestSession, type TestSessionOptions } from './persistence-test-helpers';
import { exportProjectFile, projectFileName, projectNameFromFileName } from './persistence';
import { createSampleProject, SAMPLE_PROJECT_NAME } from './sample-route';

const data = preparedDatasetSource(fixturePrepared());
const createSample = (nowIso: string) => createSampleProject({ dataset: fixtureView(), nowIso });
const REVISION = data.identity.dataRevision;

afterEach(() => {
  vi.restoreAllMocks();
});

/** Storage that counts project writes and can be told to fail them. */
function instrumented(inner: ProjectStorage) {
  let writes = 0;
  let failWith: unknown = null;
  const storage: ProjectStorage = {
    ...inner,
    writeProject(row, index, seq) {
      writes += 1;
      if (failWith !== null) return Promise.reject(failWith instanceof Error ? failWith : new Error('write failed'));
      return inner.writeProject(row, index, seq);
    },
  };
  return {
    storage,
    writes: () => writes,
    failWrites(error: unknown) {
      failWith = error;
    },
  };
}

const start = (extra: Partial<TestSessionOptions> = {}): Promise<TestSession> => createTestSession({ data, createSample, ...extra });

/** Edit, then let the autosave run to completion. */
async function editAndSave(t: TestSession, text: string): Promise<void> {
  t.store.dispatch(insertNote({ text }));
  t.host.advance(100);
  t.host.idle();
  await settle();
}

const idbFactory = () => new IDBFactory();
async function idbStorage(factory: IDBFactory): Promise<ProjectStorage> {
  return createIdbProjectStorage(await openProjectDb({ factory }));
}

describe('first start', () => {
  it('makes the sample project and saves it when storage holds nothing', async () => {
    const t = await start();
    const state = t.session.getState();
    expect(t.startup.origin).toBe('sample');
    expect(state.current).toMatchObject({ name: SAMPLE_PROJECT_NAME, sample: true, stored: true });
    expect(state.save).toEqual({ kind: 'saved', at: '2026-09-25T12:00:00.000Z' });
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0]).toMatchObject({ name: SAMPLE_PROJECT_NAME, sample: true, dataRevision: REVISION, stepCount: t.store.getState().project.route.steps.length });
    expect(await t.library.lastProjectId()).toBe(state.current.id);
    // The sample content is the deterministic sample; only its project id is random.
    const again = createSample('2026-09-25T12:00:00.000Z');
    expect({ ...t.store.getState().project, id: again.id }).toEqual(again);
    expect(t.store.getState().project.id).not.toBe(again.id);
  });
});

describe('autosave', () => {
  it('saves a burst of edits once, after the quiet period, in an idle moment', async () => {
    const counted = instrumented(createMemoryProjectStorage());
    const t = await start({ storage: counted.storage });
    const before = counted.writes();
    t.store.dispatch(insertNote({ text: 'one' }));
    expect(t.session.getState().save).toEqual({ kind: 'pending' });
    t.host.advance(50);
    t.store.dispatch(insertNote({ text: 'two' }));
    t.host.advance(50);
    t.store.dispatch(insertNote({ text: 'three' }));
    t.host.advance(100);
    expect(counted.writes()).toBe(before);
    t.host.idle();
    expect(t.session.getState().save).toEqual({ kind: 'saving' });
    await settle();
    expect(counted.writes()).toBe(before + 1);
    expect(t.session.getState().save.kind).toBe('saved');
    const stored = await t.library.load(t.session.getState().current.id);
    expect(stored.ok && stored.project.route.steps.length).toBe(t.store.getState().project.route.steps.length);
  });

  it('does not save for selection or view changes', async () => {
    const counted = instrumented(createMemoryProjectStorage());
    const t = await start({ storage: counted.storage });
    const before = counted.writes();
    t.store.setView({ rightTab: 'details' });
    t.host.advance(5000);
    t.host.idle();
    await settle();
    expect(counted.writes()).toBe(before);
    expect(t.session.getState().save.kind).toBe('saved');
  });

  it('flushes at once when the page is hidden, starting the write synchronously', async () => {
    const counted = instrumented(createMemoryProjectStorage());
    const t = await start({ storage: counted.storage });
    const before = counted.writes();
    t.store.dispatch(insertNote({ text: 'before closing' }));
    t.lifecycle.hide();
    // No timer or idle callback ran: the write was requested inside the handler.
    expect(counted.writes()).toBe(before + 1);
    await settle();
    expect(t.session.getState().save.kind).toBe('saved');
  });

  it('stamps updatedAt with the app clock and savedAt when the record is written', async () => {
    const t = await start();
    t.clock.set('2026-09-25T12:03:00.000Z');
    await editAndSave(t, 'x');
    const summary = t.session.getState().projects[0];
    expect(t.store.getState().project.updatedAt).toBe('2026-09-25T12:03:00.000Z');
    expect(summary?.updatedAt).toBe('2026-09-25T12:03:00.000Z');
    expect(t.session.getState().save).toEqual({ kind: 'saved', at: '2026-09-25T12:03:00.000Z' });
  });

  it('reports a full quota with the usage, keeps the changes, and saves once space is back', async () => {
    const inner = createMemoryProjectStorage();
    const counted = instrumented({ ...inner, estimate: () => Promise.resolve({ usage: 50 * 1024 * 1024, quota: 50 * 1024 * 1024 }) });
    const t = await start({ storage: counted.storage });
    counted.failWrites(new DOMException('The quota has been exceeded.', 'QuotaExceededError'));
    await editAndSave(t, 'too big');
    const save = t.session.getState().save;
    expect(save).toMatchObject({ kind: 'failed', reason: 'quota', lastSavedAt: '2026-09-25T12:00:00.000Z' });
    // What to do, and what takes the space, so the user can tell what to delete (CR-03).
    expect(save.kind === 'failed' && save.message).toMatch(
      /^Browser storage for this site is full \(The quota has been exceeded\.\) \(50\.0 MB of 50\.0 MB used\)\. Delete projects or backups you no longer need, or export this project to keep it\. The largest: “Sample project” \(\d+ kB\)\.$/,
    );
    expect(t.session.getState().sizes?.[t.session.getState().current.id]).toBeGreaterThan(1000);
    // Another edit keeps the failure on show and tries again.
    t.store.dispatch(insertNote({ text: 'still too big' }));
    expect(t.session.getState().save.kind).toBe('failed');
    counted.failWrites(null);
    t.host.advance(100);
    t.host.idle();
    await settle();
    expect(t.session.getState().save.kind).toBe('saved');
    expect(t.session.getState().sizes).toBeNull();
  });

  it('keeps a failure on show while the save is tried again, and never says "saving" meanwhile (CR-09)', async () => {
    const counted = instrumented(createMemoryProjectStorage());
    const t = await start({ storage: counted.storage });
    const before = counted.writes();
    counted.failWrites(new DOMException('The quota has been exceeded.', 'QuotaExceededError'));
    await editAndSave(t, 'first');
    expect(t.session.getState().save).toMatchObject({ kind: 'failed', reason: 'quota' });
    const kinds: string[] = [];
    t.session.subscribe(() => {
      kinds.push(t.session.getState().save.kind);
    });
    await editAndSave(t, 'second');
    await editAndSave(t, 'third');
    expect(counted.writes()).toBe(before + 3);
    expect(kinds.filter((kind) => kind !== 'failed')).toEqual([]);
    expect(t.session.getState().save).toMatchObject({ kind: 'failed', reason: 'quota' });
  });

  it('saves an edit made just before the open project is renamed (CR-04)', async () => {
    const t = await start();
    const id = t.session.getState().current.id;
    t.store.dispatch(insertNote({ text: 'before the rename' }));
    expect(await t.session.renameProject(id, 'Renamed')).toMatchObject({ ok: true });
    expect(t.session.getState().save).toEqual({ kind: 'pending' });
    t.host.advance(100);
    t.host.idle();
    await settle();
    expect(t.session.getState().save.kind).toBe('saved');
    const stored = await t.library.load(id);
    expect(stored.ok && stored.handle.name).toBe('Renamed');
    expect(stored.ok && stored.project.route.steps.some((s) => s.kind === 'note' && s.text === 'before the rename')).toBe(true);
  });
});

describe('restore at startup', () => {
  it('opens the last open project, with its edits, after a restart', async () => {
    const factory = idbFactory();
    const first = await start({ storage: await idbStorage(factory) });
    await first.session.newProject('Second');
    first.store.dispatch(renameRoute('Kept route'));
    await first.session.flush();
    first.session.dispose();
    first.storage.close();

    const second = await start({ storage: await idbStorage(factory) });
    expect(second.startup.origin).toBe('restored');
    expect(second.session.getState().current).toMatchObject({ name: 'Second', sample: false, stored: true });
    expect(second.store.getState().project.route.name).toBe('Kept route');
    expect(second.session.getState().projects.map((p) => p.name).sort()).toEqual(['Sample project', 'Second']);
  });

  it('leaves a stored project that does not open untouched, reports it and opens another', async () => {
    const storage = createMemoryProjectStorage();
    const first = await start({ storage });
    const good = first.session.getState().current.id;
    await storage.writeProject(
      { id: 'broken', project: { schemaVersion: 1, id: 'broken', route: 'no' }, dataPrints: null },
      { id: 'broken', name: 'Broken', createdAt: 'x', updatedAt: '2030-01-01T00:00:00.000Z', savedAt: 'x', stepCount: 0, dataRevision: 'r', schemaVersion: 1, sample: false },
      null,
    );
    await storage.setSetting('lastProjectId', 'broken');
    const second = await start({ storage });
    expect(second.session.getState().current.id).toBe(good);
    const notice = second.session.getState().notices.find((n) => n.id === 'unopenable-broken');
    expect(notice?.message).toMatch(/^“Broken” could not be opened: The stored project is not a valid project file for this version of the app\. It is kept in storage unchanged\.$/);
    expect(notice?.details.length).toBeGreaterThan(0);
    const listed = second.session.getState().projects.find((p) => p.id === 'broken');
    expect(listed?.problem?.errors.length).toBeGreaterThan(0);
    // Exported as it is stored, not validated.
    const exported = await second.session.exportStored(projectId('broken'));
    expect(exported?.validated).toBe(false);
    expect(exported?.file.text).toBe('{\n  "schemaVersion": 1,\n  "id": "broken",\n  "route": "no"\n}\n');
    expect((await storage.readProject('broken'))?.row.project).toEqual({ schemaVersion: 1, id: 'broken', route: 'no' });
  });

  it('starts a new project, never the sample, when no stored project opens', async () => {
    const storage = createMemoryProjectStorage();
    await storage.writeProject(
      { id: 'broken', project: { schemaVersion: 99 }, dataPrints: null },
      { id: 'broken', name: 'From the future', createdAt: 'x', updatedAt: 'x', savedAt: 'x', stepCount: 0, dataRevision: 'r', schemaVersion: 99, sample: false },
      null,
    );
    const t = await start({ storage });
    expect(t.startup.origin).toBe('new');
    expect(t.session.getState().current).toMatchObject({ name: 'New project', sample: false });
    expect(t.session.getState().notices.map((n) => n.id)).toEqual(['unopenable-broken', 'none-openable']);
    expect(t.session.getState().notices[0]?.details).toEqual(['schemaVersion: Project schemaVersion 99 is newer than this app supports (1)']);
  });
});

describe('several projects', () => {
  it('creates, opens, renames, duplicates and deletes projects, keeping deleted ones as backups', async () => {
    const t = await start();
    const sampleId = t.session.getState().current.id;
    await editAndSave(t, 'sample edit');

    expect(await t.session.newProject('Durotar run')).toEqual({ ok: true, message: 'New project “Durotar run” is open.' });
    const runId = t.session.getState().current.id;
    expect(t.store.getState().project.route.steps).toEqual([]);
    expect(t.store.getState().project.dataRevision).toBe(REVISION);
    await editAndSave(t, 'run edit');

    expect(await t.session.openProject(sampleId)).toEqual({ ok: true, message: `Opened “${SAMPLE_PROJECT_NAME}”.` });
    expect(t.store.getState().project.route.steps.some((s) => s.kind === 'note' && s.text === 'sample edit')).toBe(true);
    // Opening is not an edit: nothing to save, and undo history starts empty.
    expect(t.session.getState().save.kind).toBe('saved');
    expect(t.store.getState().history.canUndo).toBe(false);

    expect(await t.session.renameProject(runId, '  Durotar   run 2 ')).toEqual({ ok: true, message: 'Renamed to “Durotar run 2”.' });
    expect(await t.session.renameProject(sampleId, 'My sample')).toEqual({ ok: true, message: 'Renamed to “My sample”.' });
    expect(t.session.getState().current.name).toBe('My sample');
    expect(await t.session.renameProject(sampleId, '   ')).toMatchObject({ ok: false, message: 'A project needs a name.' });

    expect(await t.session.duplicateProject(runId)).toEqual({ ok: true, message: 'Saved a copy: “Durotar run 2 (copy)”.' });
    const names = () => t.session.getState().projects.map((p) => p.name).sort();
    expect(names()).toEqual(['Durotar run 2', 'Durotar run 2 (copy)', 'My sample']);
    const copy = t.session.getState().projects.find((p) => p.name === 'Durotar run 2 (copy)');
    const copied = await t.library.load(copy?.id ?? '');
    expect(copied.ok && copied.project.route.steps.map((s) => (s.kind === 'note' ? s.text : s.kind))).toEqual(['run edit']);

    const deleted = await t.session.deleteProject(runId);
    expect(deleted).toEqual({ ok: true, message: 'Deleted “Durotar run 2”. It is kept in Recently deleted until 2026-10-25.' });
    expect(names()).toEqual(['Durotar run 2 (copy)', 'My sample']);
    expect(t.session.getState().backups).toMatchObject([{ reason: 'deleted', purgeAfter: '2026-10-25T12:00:00.000Z', project: { id: runId, name: 'Durotar run 2' } }]);

    const backupId = t.session.getState().backups[0]?.id ?? '';
    expect(await t.session.restoreBackup(backupId)).toEqual({ ok: true, message: 'Restored “Durotar run 2”. Open it from the project list.' });
    expect(names()).toEqual(['Durotar run 2', 'Durotar run 2 (copy)', 'My sample']);
    expect(t.session.getState().backups).toEqual([]);
    const restored = await t.library.load(runId);
    expect(restored.ok && restored.project.route.steps.map((s) => (s.kind === 'note' ? s.text : s.kind))).toEqual(['run edit']);
  });

  it('opens the next project when the open one is deleted, and the sample once none is left', async () => {
    const t = await start();
    const sampleId = t.session.getState().current.id;
    await t.session.newProject('Other');
    const otherId = t.session.getState().current.id;
    t.store.dispatch(insertNote({ text: 'unsaved at delete' }));
    const result = await t.session.deleteProject(otherId);
    expect(result).toEqual({ ok: true, message: `Deleted “Other”. It is kept in Recently deleted until 2026-10-25. “${SAMPLE_PROJECT_NAME}” is open now.` });
    expect(t.session.getState().current.id).toBe(sampleId);
    // The deleted project's backup has the change made just before the delete.
    const backup = await t.storage.readBackup(t.session.getState().backups[0]?.id ?? '');
    expect(JSON.stringify(backup?.record.project)).toContain('unsaved at delete');

    const last = await t.session.deleteProject(sampleId);
    expect(last.ok && last.message).toMatch(/No project was left, so the sample project is open\.$/);
    expect(t.session.getState().current).toMatchObject({ name: SAMPLE_PROJECT_NAME, sample: true, stored: true });
    expect(t.session.getState().current.id).not.toBe(sampleId);
    expect(t.session.getState().backups).toHaveLength(2);
  });

  it('refuses to switch projects while an edit lock is held', async () => {
    const t = await start();
    const sampleId = t.session.getState().current.id;
    await t.session.newProject('Other');
    t.store.acquireLock('proposal');
    expect(await t.session.openProject(sampleId)).toMatchObject({ ok: false, message: 'Unavailable while the optimiser runs or a proposal is open' });
    expect(await t.session.newProject()).toMatchObject({ ok: false });
    t.store.releaseLock('proposal');
    expect((await t.session.openProject(sampleId)).ok).toBe(true);
  });

  it('refuses to leave a project whose changes cannot be saved', async () => {
    const counted = instrumented(createMemoryProjectStorage());
    const t = await start({ storage: counted.storage });
    const sampleId = t.session.getState().current.id;
    await t.session.newProject('Other');
    counted.failWrites(new Error('disk on fire'));
    t.store.dispatch(insertNote({ text: 'precious' }));
    const result = await t.session.openProject(sampleId);
    expect(result).toMatchObject({ ok: false, message: 'The open project has unsaved changes: disk on fire. Export it, or duplicate it as a copy, before opening another project.' });
    expect(t.session.getState().current.name).toBe('Other');
  });

  it('purges backups past their retention at the next start', async () => {
    const storage = createMemoryProjectStorage();
    const clock = manualClock('2026-09-25T12:00:00.000Z');
    const t = await start({ storage, clock });
    await t.session.newProject('Doomed');
    await t.session.deleteProject(t.session.getState().current.id);
    t.session.dispose();
    clock.set('2026-10-26T00:00:00.000Z');
    const later = await start({ storage, clock });
    expect(later.session.getState().backups).toEqual([]);
    expect(later.session.getState().notices.map((n) => n.message)).toContain('1 backup older than 30 days removed.');
  });
});

describe('another tab', () => {
  it('refuses to overwrite a newer version from another tab, and can keep this one either way', async () => {
    const factory = idbFactory();
    const tabA = await start({ storage: await idbStorage(factory) });
    const tabB = await start({ storage: await idbStorage(factory) });
    expect(tabB.session.getState().current.id).toBe(tabA.session.getState().current.id);
    await editAndSave(tabA, 'from A');
    await editAndSave(tabB, 'from B');
    expect(tabB.session.getState().save).toMatchObject({ kind: 'failed', reason: 'conflict' });
    // No further saves while the conflict stands.
    tabB.store.dispatch(insertNote({ text: 'more from B' }));
    expect(tabB.session.getState().save).toMatchObject({ kind: 'failed', reason: 'conflict' });

    const copy = await tabB.session.duplicateProject(tabB.session.getState().current.id, { open: true });
    expect(copy).toEqual({ ok: true, message: `“${SAMPLE_PROJECT_NAME} (copy)” is open.` });
    await settle();
    const copyId = tabB.session.getState().current.id;
    const saved = await tabB.library.load(copyId);
    expect(saved.ok && saved.project.route.steps.filter((s) => s.kind === 'note').map((s) => (s.kind === 'note' ? s.text : '')).slice(-2)).toEqual(['from B', 'more from B']);
    // Tab A's version is untouched.
    const original = await tabA.library.load(tabA.session.getState().current.id);
    expect(original.ok && original.project.route.steps.some((s) => s.kind === 'note' && s.text === 'from A')).toBe(true);
    expect(original.ok && original.project.route.steps.some((s) => s.kind === 'note' && s.text === 'from B')).toBe(false);
  });

  it('overwrites the other version when asked', async () => {
    const factory = idbFactory();
    const tabA = await start({ storage: await idbStorage(factory) });
    const tabB = await start({ storage: await idbStorage(factory) });
    await editAndSave(tabA, 'from A');
    await editAndSave(tabB, 'from B');
    expect(await tabB.session.overwriteStored()).toEqual({ ok: true, message: `Saved this version of “${SAMPLE_PROJECT_NAME}” over the other one.` });
    const stored = await tabA.library.load(tabA.session.getState().current.id);
    expect(stored.ok && stored.project.route.steps.some((s) => s.kind === 'note' && s.text === 'from B')).toBe(true);
    // Tab A now finds the record changed under it.
    await editAndSave(tabA, 'A again');
    expect(tabA.session.getState().save).toMatchObject({ kind: 'failed', reason: 'conflict' });
  });

  it('stops saving when the storage connection is lost', async () => {
    const t = await start();
    t.session.storageLost('Another tab updated the storage format; reload this page to keep saving');
    expect(t.session.getState().save).toMatchObject({ kind: 'failed', reason: 'closed', message: 'Another tab updated the storage format; reload this page to keep saving' });
    t.store.dispatch(insertNote({ text: 'x' }));
    t.host.advance(5000);
    t.host.idle();
    await settle();
    expect(t.session.getState().save.kind).toBe('failed');
  });
});

describe('import and export', () => {
  it('round-trips the open project through a deterministic .frl.json file, importing it as a new project', async () => {
    const t = await start();
    await editAndSave(t, 'exported');
    const file = t.session.exportCurrent();
    expect(file.fileName).toBe('Sample project.frl.json');
    expect(file.mimeType).toBe('application/json');
    expect(file.text).toBe(serializeProject(t.store.getState().project));
    expect(t.session.exportCurrent().text).toBe(file.text);

    const original = t.store.getState().project;
    const result = await t.session.importProjectText(file.text, 'Durotar route.frl.json');
    expect(result).toEqual({ ok: true, message: 'Imported “Durotar route” as a new project and opened it.' });
    const imported = t.store.getState().project;
    expect(imported.id).not.toBe(original.id);
    expect({ ...imported, id: original.id }).toEqual(original);
    expect(t.session.getState().current).toMatchObject({ name: 'Durotar route', sample: false, stored: true });
    expect(t.session.getState().projects.map((p) => p.name).sort()).toEqual(['Durotar route', 'Sample project']);
    // Its export is the same file but for the id.
    expect(t.session.exportCurrent().text).toBe(file.text.replace(original.id, imported.id));
  });

  it('rejects a malformed file with path-level errors and stores nothing', async () => {
    const t = await start();
    const project = JSON.parse(t.session.exportCurrent().text) as Record<string, unknown> & { route: { steps: unknown[] } };
    project.route.steps = [{ kind: 'teleport' }];
    project['extra'] = true;
    const result = await t.session.importProjectText(JSON.stringify(project), 'bad.frl.json');
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toBe('“bad.frl.json” is not a project file this app can open.');
    const paths = result.ok ? [] : result.errors.map((e) => e.path);
    expect(paths).toContain('extra');
    expect(paths.some((p) => p.startsWith('route.steps[0]'))).toBe(true);
    expect(t.session.getState().projects).toHaveLength(1);

    const notJson = await t.session.importProjectText('{"schemaVersion": 1,', 'cut.frl.json');
    expect(notJson.ok ? [] : notJson.errors.map((e) => e.path)).toEqual(['']);
    expect(notJson.ok ? '' : notJson.errors[0]?.message).toMatch(/^Invalid JSON: /);
  });

  it('stores a project made elsewhere (an RXP import) as a new project and opens it', async () => {
    const t = await start();
    const made = { ...createSample('2026-09-25T12:00:00.000Z'), route: { ...createSample('2026-09-25T12:00:00.000Z').route, name: 'From a guide' } };
    expect(await t.session.importProject(made, '  ')).toEqual({ ok: true, message: 'Imported “From a guide” as a new project and opened it.' });
    expect(t.store.getState().project.id).not.toBe(made.id);
    expect({ ...t.store.getState().project, id: made.id }).toEqual(made);
    expect(t.session.getState().current).toMatchObject({ name: 'From a guide', sample: false, stored: true });
  });

  it('names export files safely and reads names back from them', () => {
    expect(projectFileName('Durotar: 1-6 / fast?')).toBe('Durotar - 1-6 - fast.frl.json');
    expect(projectFileName('Sample: Durotar start')).toBe('Sample - Durotar start.frl.json');
    expect(projectFileName('...')).toBe('project.frl.json');
    expect(projectNameFromFileName('C:\\routes\\Durotar run.frl.json')).toBe('Durotar run');
    expect(projectNameFromFileName('plain.json')).toBe('plain');
    expect(projectNameFromFileName('.frl.json')).toBeNull();
    const project = createSample('2026-09-25T12:00:00.000Z');
    const file = exportProjectFile(project, 'x');
    const parsed = parseProjectText(file.text);
    expect(parsed.ok && parsed.project).toEqual(project);
  });
});

describe('data revision drift', () => {
  /** A stored project saved against an older data revision, with prints edited as if the data changed. */
  async function storedOnOlderRevision(storage: ProjectStorage, editPrints: boolean) {
    const first = await start({ storage });
    const project = first.store.getState().project;
    const accept = project.route.steps.find((s) => s.kind === 'accept');
    if (accept?.kind !== 'accept') throw new Error('sample has an accept step');
    const prints = dataPrintsOf(project, fixtureView());
    const key = String(accept.questId);
    const old = { ...prints, dataRevision: 'rev-old', quests: editPrints ? { ...prints.quests, [key]: { objectives: 'old', prerequisites: prints.quests[key]?.prerequisites ?? '' } } : prints.quests };
    const index = first.session.getState().projects[0];
    if (index === undefined) throw new Error('stored');
    const { writeSeq, ...input } = index;
    await storage.writeProject({ id: project.id, project: { ...project, dataRevision: 'rev-old' }, dataPrints: old }, { ...input, dataRevision: 'rev-old' }, writeSeq);
    first.session.dispose();
    return { questId: accept.questId };
  }

  it('shows the drift report on open and keeps the stored revision until it is dismissed', async () => {
    const storage = createMemoryProjectStorage();
    const { questId } = await storedOnOlderRevision(storage, true);
    const t = await start({ storage });
    const drift = t.session.getState().drift;
    expect(drift).toMatchObject({ storedRevision: 'rev-old', loadedRevision: REVISION, missingQuestIds: [], changedObjectives: [questId], changedPrerequisites: [] });
    // The open project records the loaded data; the stored one keeps its revision while the report is up.
    expect(t.store.getState().project.dataRevision).toBe(REVISION);
    await editAndSave(t, 'edit under drift');
    const whileUp = await storage.readProject(t.session.getState().current.id);
    expect(whileUp?.index.dataRevision).toBe('rev-old');
    expect((whileUp?.row.project as ProjectV1).dataRevision).toBe('rev-old');
    expect(whileUp?.row.dataPrints?.dataRevision).toBe('rev-old');
    // Exports record what saves record, so a re-imported file brings the report back (CR-12).
    expect(JSON.parse(t.session.exportCurrent().text)).toMatchObject({ dataRevision: 'rev-old' });
    expect(JSON.parse((await t.session.exportStored(t.session.getState().current.id))?.file.text ?? '{}')).toMatchObject({ dataRevision: 'rev-old' });

    t.session.acknowledgeDrift();
    expect(JSON.parse(t.session.exportCurrent().text)).toMatchObject({ dataRevision: REVISION });
    expect(t.session.getState().drift).toBeNull();
    expect(t.session.getState().save).toEqual({ kind: 'pending' });
    t.host.advance(100);
    t.host.idle();
    await settle();
    const after = await storage.readProject(t.session.getState().current.id);
    expect(after?.index.dataRevision).toBe(REVISION);
    expect(after?.row.dataPrints?.dataRevision).toBe(REVISION);
    t.session.dispose();
    const next = await start({ storage });
    expect(next.session.getState().drift).toBeNull();
  });

  it('comes back at the next start when it was not dismissed', async () => {
    const storage = createMemoryProjectStorage();
    await storedOnOlderRevision(storage, false);
    const t = await start({ storage });
    expect(t.session.getState().drift).toMatchObject({ changedObjectives: [], changedPrerequisites: [] });
    await editAndSave(t, 'x');
    t.session.dispose();
    const again = await start({ storage });
    expect(again.session.getState().drift).toMatchObject({ storedRevision: 'rev-old' });
  });

  it('reports only missing quests for an imported file, with the rest unknown', async () => {
    const t = await start();
    const text = t.session.exportCurrent().text.replace(`"dataRevision": "${REVISION}"`, '"dataRevision": "rev-file"');
    await t.session.importProjectText(text, 'old.frl.json');
    expect(t.session.getState().drift).toMatchObject({ storedRevision: 'rev-file', missingQuestIds: [], changedObjectives: null, changedPrerequisites: null });
  });
});

describe('storage unavailable (private window)', () => {
  it('works in memory and says that nothing outlives the page', async () => {
    const t = await start({ unavailable: 'The browser does not allow storage here (InvalidStateError: private)' });
    expect(t.session.getState().save).toEqual({ kind: 'unavailable', reason: 'The browser does not allow storage here (InvalidStateError: private)' });
    await editAndSave(t, 'x');
    expect(t.session.getState().save.kind).toBe('unavailable');
    await t.session.newProject('Second');
    expect(t.session.getState().projects).toHaveLength(2);
    expect(t.session.getState().unavailable).toMatch(/private/);
  });
});

describe('migration of a stored project', () => {
  it('backs up the stored original before the migrated project replaces it', async () => {
    const storage = createMemoryProjectStorage();
    const clock = manualClock('2026-09-25T12:00:00.000Z');
    const ids = sequentialIdSource(500);
    const t = await start({ storage, clock, ids });
    const id = t.session.getState().current.id;
    t.session.dispose();
    const original = (await storage.readProject(id))?.row.project;
    // A future app whose schema is version 2, with a migration 1 → 2.
    const parseV2 = (document: unknown): ParseProjectResult => parseProjectText(JSON.stringify(document));
    const library = createProjectLibrary({ storage, clock, ids, parse: parseV2, latestSchemaVersion: 2 });
    const loaded = await library.load(id);
    expect(loaded.ok && loaded.migratedFrom).toBe(1);
    const backups = await storage.listBackups();
    expect(backups).toMatchObject([{ reason: 'migration', index: { id } }]);
    expect((await storage.readBackup(backups[0]?.id ?? ''))?.record.project).toEqual(original);
    // Restoring the original while the project exists gives it a new id and says what it is.
    const restored = await library.restoreBackup(backups[0]?.id ?? '');
    expect(restored?.name).toBe('Sample project (before migration)');
    expect(restored?.id).not.toBe(id);
    expect(((await storage.readProject(restored?.id ?? ''))?.row.project as ProjectV1).id).toBe(restored?.id);
  });
});

/** Storage whose project writes are held in flight until the test lets each one answer. */
function gated(inner: ProjectStorage) {
  const waiting: (() => void)[] = [];
  let writes = 0;
  const storage: ProjectStorage = {
    ...inner,
    writeProject(row, index, seq) {
      writes += 1;
      // The write itself happens now (as IndexedDB queues it); only the answer waits.
      const result = inner.writeProject(row, index, seq);
      return new Promise((resolve) => {
        waiting.push(() => {
          resolve(result);
        });
      });
    },
  };
  return {
    storage,
    writes: () => writes,
    answerNext() {
      waiting.shift()?.();
    },
  };
}

describe('saving when the page is hidden or closed (CR-01)', () => {
  it('makes every IndexedDB request of the save inside the hide handler', async () => {
    const t = await start({ storage: await idbStorage(idbFactory()) });
    t.store.dispatch(insertNote({ text: 'before closing' }));
    const puts = vi.spyOn(IDBObjectStore.prototype, 'put');
    t.lifecycle.hide();
    // Before any other task runs: the project record and its index row are both requested.
    expect(puts.mock.contexts.map((store) => (store as IDBObjectStore).name).sort()).toEqual(['projectIndex', 'projects']);
    puts.mockRestore();
    await settle();
    expect(t.session.getState().save.kind).toBe('saved');
    const stored = await t.library.load(t.session.getState().current.id);
    expect(stored.ok && stored.project.route.steps.some((s) => s.kind === 'note' && s.text === 'before closing')).toBe(true);
  });

  it('saves again the moment a running save ends when the page is hidden during it, not on a timer', async () => {
    const held = gated(createMemoryProjectStorage());
    const start1 = start({ storage: held.storage });
    // The start saves the sample: let that write answer.
    await settle();
    held.answerNext();
    const t = await start1;
    const before = held.writes();
    t.store.dispatch(insertNote({ text: 'first' }));
    t.host.advance(100);
    t.host.idle();
    expect(held.writes()).toBe(before + 1);
    t.store.dispatch(insertNote({ text: 'while saving' }));
    t.lifecycle.hide();
    // The running save took the state before the second edit; nothing waits on a timer.
    expect(t.host.pendingCount()).toBe(0);
    held.answerNext();
    await settle();
    expect(held.writes()).toBe(before + 2);
    held.answerNext();
    await settle();
    expect(t.session.getState().save.kind).toBe('saved');
    const stored = await t.library.load(t.session.getState().current.id);
    expect(stored.ok && stored.project.route.steps.some((s) => s.kind === 'note' && s.text === 'while saving')).toBe(true);
  });

  it('asks before the page closes only while changes would be lost', async () => {
    const counted = instrumented(createMemoryProjectStorage());
    const t = await start({ storage: counted.storage });
    expect(t.lifecycle.wouldAskBeforeClosing()).toBe(false);
    // Pending changes are saved by the hide that closing brings: no question.
    t.store.dispatch(insertNote({ text: 'pending' }));
    expect(t.lifecycle.wouldAskBeforeClosing()).toBe(false);
    counted.failWrites(new Error('disk on fire'));
    t.host.advance(100);
    t.host.idle();
    await settle();
    expect(t.session.getState().save.kind).toBe('failed');
    expect(t.lifecycle.wouldAskBeforeClosing()).toBe(true);
    counted.failWrites(null);
    await t.session.flush();
    expect(t.session.getState().save.kind).toBe('saved');
    expect(t.lifecycle.wouldAskBeforeClosing()).toBe(false);
  });

  it('asks after any edit when browser storage is unavailable, since nothing outlives the tab', async () => {
    const t = await start({ unavailable: 'The browser does not allow storage here (InvalidStateError: private)' });
    expect(t.lifecycle.wouldAskBeforeClosing()).toBe(false);
    await editAndSave(t, 'kept in memory only');
    expect(t.lifecycle.wouldAskBeforeClosing()).toBe(true);
  });
});

describe('a project open in two tabs (CR-02)', () => {
  const noteTexts = (project: ProjectV1): string[] => project.route.steps.flatMap((s) => (s.kind === 'note' ? [s.text] : []));

  async function twoTabs() {
    const factory = idbFactory();
    const tabs = testTabs();
    const tabA = await start({ storage: await idbStorage(factory), tabs: tabs.tab() });
    const tabB = await start({ storage: await idbStorage(factory), tabs: tabs.tab() });
    return { tabA, tabB, tabs };
  }

  it('says so when the project opens, and saves nothing from the second tab until the user chooses', async () => {
    const { tabA, tabB } = await twoTabs();
    const id = tabA.session.getState().current.id;
    expect(tabA.startup.openElsewhere).toBe(false);
    expect(tabB.startup.openElsewhere).toBe(true);
    expect(tabB.session.getState().current.id).toBe(id);
    expect(tabB.session.getState().save).toMatchObject({ kind: 'failed', reason: 'elsewhere' });
    await editAndSave(tabB, 'from B');
    const stored = await tabA.library.load(id);
    expect(stored.ok && noteTexts(stored.project)).not.toContain('from B');
    expect(tabB.lifecycle.wouldAskBeforeClosing()).toBe(true);

    expect(await tabB.session.openAnyway()).toMatchObject({ ok: true });
    tabB.host.advance(100);
    tabB.host.idle();
    await settle();
    expect(tabB.session.getState().save.kind).toBe('saved');
    const after = await tabA.library.load(id);
    expect(after.ok && noteTexts(after.project)).toContain('from B');
    // Tab A hears of B's save straight away, before it saves anything itself.
    expect(tabA.session.getState().save).toMatchObject({ kind: 'failed', reason: 'conflict' });
    expect(tabA.session.getState().otherVersion).toMatchObject({ id, stepCount: tabB.store.getState().project.route.steps.length });
  });

  it('opens a copy instead, which this tab saves', async () => {
    const { tabA, tabB } = await twoTabs();
    await editAndSave(tabB, 'kept in the copy');
    expect(await tabB.session.duplicateProject(tabB.session.getState().current.id, { open: true })).toEqual({ ok: true, message: `“${SAMPLE_PROJECT_NAME} (copy)” is open.` });
    await settle();
    expect(tabB.session.getState().save.kind).toBe('saved');
    const copy = await tabB.library.load(tabB.session.getState().current.id);
    expect(copy.ok && noteTexts(copy.project)).toContain('kept in the copy');
    expect(tabA.session.getState().save.kind).toBe('saved');
  });

  it('saves from the second tab by itself once the first lets the project go', async () => {
    const { tabA, tabB } = await twoTabs();
    tabB.store.dispatch(insertNote({ text: 'waiting' }));
    tabA.session.dispose();
    await settle();
    expect(tabB.session.getState().save).toEqual({ kind: 'pending' });
    tabB.host.advance(100);
    tabB.host.idle();
    await settle();
    expect(tabB.session.getState().save.kind).toBe('saved');
  });

  it('asks before opening a project another tab has open, and opens it anyway when told to', async () => {
    const factory = idbFactory();
    const tabs = testTabs();
    const tabA = await start({ storage: await idbStorage(factory), tabs: tabs.tab() });
    const sampleId = tabA.session.getState().current.id;
    await tabA.session.newProject('Second');
    const secondId = tabA.session.getState().current.id;
    const tabB = await start({ storage: await idbStorage(factory), tabs: tabs.tab() });
    // The last project is Second, which A has open.
    expect(tabB.session.getState().save).toMatchObject({ kind: 'failed', reason: 'elsewhere' });
    // The sample was let go when A switched away from it.
    expect(await tabB.session.openProject(sampleId)).toEqual({ ok: true, message: `Opened “${SAMPLE_PROJECT_NAME}”.` });
    expect(tabB.session.getState().save.kind).toBe('saved');
    const refused = await tabB.session.openProject(secondId);
    expect(refused).toEqual({ ok: false, message: '“Second” is open in another tab or window. Open it here anyway, or open a copy of it.', errors: [], openElsewhere: secondId });
    expect(tabB.session.getState().current.id).toBe(sampleId);
    const opened = await tabB.session.openProject(secondId, { anyway: true });
    expect(opened.ok && opened.message).toMatch(/^Opened “Second”\. It is open in another tab or window too;/);
    expect(tabB.session.getState().save.kind).toBe('saved');
  });

  it('takes a rename made in the other tab without a conflict, and keeps the stored name when overwriting', async () => {
    const { tabA, tabB } = await twoTabs();
    const id = tabA.session.getState().current.id;
    await tabB.session.openAnyway();
    expect(await tabA.session.renameProject(id, 'Renamed in A')).toMatchObject({ ok: true });
    await settle();
    expect(tabB.session.getState().current.name).toBe('Renamed in A');
    await editAndSave(tabB, 'from B');
    expect(tabB.session.getState().save.kind).toBe('saved');
    await settle();
    // A now knows of B's save; A's own edit is not saved over it.
    await editAndSave(tabA, 'from A');
    expect(tabA.session.getState().save).toMatchObject({ kind: 'failed', reason: 'conflict' });
    expect(tabA.session.getState().otherVersion).toMatchObject({ name: 'Renamed in A' });
    expect(await tabA.session.overwriteStored()).toEqual({ ok: true, message: 'Saved this version of “Renamed in A” over the other one.' });
    const stored = await tabA.library.load(id);
    expect(stored.ok && stored.handle.name).toBe('Renamed in A');
    expect(stored.ok && noteTexts(stored.project)).toContain('from A');
    expect(stored.ok && noteTexts(stored.project)).not.toContain('from B');
  });

  it('stops saving at once when the other tab deletes the project', async () => {
    const { tabA, tabB } = await twoTabs();
    await tabB.session.openAnyway();
    const id = tabA.session.getState().current.id;
    await tabA.session.deleteProject(id);
    await settle();
    expect(tabB.session.getState().save).toMatchObject({ kind: 'failed', reason: 'conflict', message: 'This project was deleted in another tab or window. Duplicate it to keep this version.' });
    expect(tabB.session.getState().otherVersion).toBeNull();
  });
});

/** Memory storage that is full until a project or backup is deleted for good. */
function fullStorage() {
  const inner = createMemoryProjectStorage();
  let full = false;
  const quota = () => Promise.reject(new DOMException('The quota has been exceeded.', 'QuotaExceededError'));
  const storage: ProjectStorage = {
    ...inner,
    writeProject: (row, index, seq) => (full ? quota() : inner.writeProject(row, index, seq)),
    moveToBackup: (id, meta, extra) => (full ? quota() : inner.moveToBackup(id, meta, extra)),
    putBackup: (backup) => (full ? quota() : inner.putBackup(backup)),
    deleteProject: async (id, extra = []) => {
      if (full && extra.length > 0) return quota();
      const existed = await inner.deleteProject(id, extra);
      full = false;
      return existed;
    },
    deleteBackup: async (id) => {
      await inner.deleteBackup(id);
      full = false;
    },
  };
  return {
    storage,
    fill() {
      full = true;
    },
  };
}

describe('deleting projects (CR-03, CR-05)', () => {
  it('frees space when storage is full by deleting permanently, then saves the open project', async () => {
    const quota = fullStorage();
    const t = await start({ storage: quota.storage });
    const sampleId = t.session.getState().current.id;
    await t.session.newProject('Old');
    const oldId = t.session.getState().current.id;
    await t.session.openProject(sampleId);
    quota.fill();
    await editAndSave(t, 'needs space');
    expect(t.session.getState().save).toMatchObject({ kind: 'failed', reason: 'quota' });
    // Moving it to Recently deleted needs space too: refused, with what to do instead.
    const refused = await t.session.deleteProject(oldId);
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(/^“Old” could not be deleted: Browser storage for this site is full .*\. Storage is full: delete it permanently to free the space, or export it first\.$/);
    expect(await t.session.deleteProject(oldId, { permanently: true })).toEqual({ ok: true, message: 'Deleted “Old” permanently. The open project is saved now.' });
    expect(t.session.getState().save.kind).toBe('saved');
    expect(t.session.getState().projects.map((p) => p.id)).toEqual([sampleId]);
    expect(t.session.getState().backups).toEqual([]);
  });

  it('deletes a backup permanently, which frees its space too', async () => {
    const quota = fullStorage();
    const t = await start({ storage: quota.storage });
    const sampleId = t.session.getState().current.id;
    await t.session.newProject('Old');
    await t.session.deleteProject(t.session.getState().current.id);
    expect(t.session.getState().current.id).toBe(sampleId);
    const backupId = t.session.getState().backups[0]?.id ?? '';
    quota.fill();
    await editAndSave(t, 'needs space');
    expect(await t.session.deleteBackup(backupId)).toEqual({ ok: true, message: 'Deleted “Old” from Recently deleted permanently. The open project is saved now.' });
    expect(t.session.getState().backups).toEqual([]);
    expect(t.session.getState().save.kind).toBe('saved');
  });

  it('keeps the latest changes of the open project in Recently deleted when they could not be saved', async () => {
    const counted = instrumented(createMemoryProjectStorage());
    const t = await start({ storage: counted.storage });
    await t.session.newProject('Other');
    const otherId = t.session.getState().current.id;
    counted.failWrites(new Error('disk on fire'));
    t.store.dispatch(insertNote({ text: 'unsaved at delete' }));
    const result = await t.session.deleteProject(otherId);
    expect(result).toEqual({ ok: true, message: `Deleted “Other”. It is kept in Recently deleted until 2026-10-25. “${SAMPLE_PROJECT_NAME}” is open now.` });
    expect(await t.storage.readIndex(otherId)).toBeNull();
    const backups = t.session.getState().backups;
    expect(backups).toMatchObject([{ reason: 'deleted', project: { id: otherId, name: 'Other' } }]);
    expect(JSON.stringify((await t.storage.readBackup(backups[0]?.id ?? ''))?.record.project)).toContain('unsaved at delete');
  });

  it('keeps a project that was never stored in Recently deleted too', async () => {
    const counted = instrumented(createMemoryProjectStorage());
    const t = await start({ storage: counted.storage });
    counted.failWrites(new Error('disk on fire'));
    const created = await t.session.newProject('Never stored');
    expect(created.ok && created.message).toMatch(/It is not saved yet: disk on fire\.$/);
    const id = t.session.getState().current.id;
    t.store.dispatch(insertNote({ text: 'only in the page' }));
    expect((await t.session.deleteProject(id)).ok).toBe(true);
    const backup = t.session.getState().backups.find((b) => b.project.id === id);
    expect(backup).toBeDefined();
    expect(JSON.stringify((await t.storage.readBackup(backup?.id ?? ''))?.record.project)).toContain('only in the page');
  });

  it('keeps both versions when the open project changed in another tab, and says Recently deleted lasts only the tab without storage', async () => {
    const factory = idbFactory();
    const tabA = await start({ storage: await idbStorage(factory) });
    const tabB = await start({ storage: await idbStorage(factory) });
    await editAndSave(tabA, 'from A');
    await editAndSave(tabB, 'from B');
    expect(tabB.session.getState().save).toMatchObject({ kind: 'failed', reason: 'conflict' });
    expect((await tabB.session.deleteProject(tabB.session.getState().current.id)).ok).toBe(true);
    const kept = await Promise.all(tabB.session.getState().backups.map((b) => tabB.storage.readBackup(b.id)));
    const texts = kept.map((b) => JSON.stringify(b?.record.project));
    expect(texts.some((text) => text.includes('from A') && !text.includes('from B'))).toBe(true);
    expect(texts.some((text) => text.includes('from B'))).toBe(true);

    const memory = await start({ unavailable: 'The browser does not allow storage here (InvalidStateError: private)' });
    await memory.session.newProject('Short-lived');
    const deleted = await memory.session.deleteProject(memory.session.getState().current.id);
    expect(deleted.ok && deleted.message).toMatch(/^Deleted “Short-lived”\. It is kept in Recently deleted until this tab closes\./);
  });
});

describe('imports and failed starts (CR-11, CR-13)', () => {
  it('refuses a project made elsewhere that the project schema does not accept, and stores nothing', async () => {
    const t = await start();
    const made = { ...createSample('2026-09-25T12:00:00.000Z'), extra: true } as unknown as ProjectV1;
    const result = await t.session.importProject(made, 'Broken guide');
    expect(result.ok).toBe(false);
    expect(result.message).toBe('“Broken guide” could not be imported: it is not a valid project, so nothing was stored.');
    expect(result.ok ? [] : result.errors.map((e) => e.path)).toContain('extra');
    expect(t.session.getState().projects).toHaveLength(1);
    expect(t.session.getState().current.sample).toBe(true);
  });

  it('starts an unsaved project and changes nothing stored when the stored projects cannot be listed', async () => {
    const storage = createMemoryProjectStorage();
    const first = await start({ storage });
    const id = first.session.getState().current.id;
    first.session.dispose();
    const t = await start({ storage: { ...storage, listProjects: () => Promise.reject(new Error('disk hiccup')) } });
    expect(t.startup.origin).toBe('new');
    expect(t.session.getState().current).toMatchObject({ name: 'New project', sample: false, stored: false });
    expect(t.session.getState().notices.find((n) => n.id === 'list-failed')).toEqual({
      id: 'list-failed',
      message: 'The stored projects could not be listed, so a new project was started. Nothing stored was changed; reload the page to try again.',
      details: ['disk hiccup'],
    });
    expect((await storage.listProjects()).map((p) => p.id)).toEqual([id]);
    expect(await storage.getSetting('lastProjectId')).toBe(id);
  });

  it('offers to open again a project that could not be read, and opens it then', async () => {
    const storage = createMemoryProjectStorage();
    const first = await start({ storage });
    await first.session.newProject('Mine');
    const mine = first.session.getState().current.id;
    first.session.dispose();
    let hiccups = 1;
    const flaky: ProjectStorage = {
      ...storage,
      readProject: (id) => {
        if (id === mine && hiccups > 0) {
          hiccups -= 1;
          return Promise.reject(new Error('disk hiccup'));
        }
        return storage.readProject(id);
      },
    };
    const t = await start({ storage: flaky });
    expect(t.session.getState().current.name).toBe(SAMPLE_PROJECT_NAME);
    expect(t.session.getState().notices.find((n) => n.id === `unopenable-${mine}`)?.message).toBe(
      '“Mine” could not be opened: The stored project could not be read (disk hiccup). It is kept in storage unchanged; try opening it again from Projects.',
    );
    expect(t.session.getState().projects.find((p) => p.id === mine)?.problem).toMatchObject({ reason: 'storage' });
    expect(await t.session.openProject(projectId(mine))).toEqual({ ok: true, message: 'Opened “Mine”.' });
    expect(t.session.getState().projects.find((p) => p.id === mine)?.problem).toBeNull();
  });
});
