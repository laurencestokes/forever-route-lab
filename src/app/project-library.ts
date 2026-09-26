import { type IdSource, type ProjectId, projectId, type ProjectV1, PROJECT_SCHEMA_VERSION } from '../domain';
import type { BackupReason, BackupRow, BackupSummaryRow, DataPrints, ProjectIndexRow, ProjectRow, ProjectStorage } from '../infra/persistence';
import { detectSchemaVersion, parseProject, type ParseProjectResult, type ProjectIssue } from '../project';
import type { Clock } from './clock';

/**
 * The project library (docs/ARCHITECTURE.md §12.3): what the app means by the records in project
 * storage. It reads stored documents back as projects (detect version, migrate, validate: never
 * repaired), copies a stored document to `backups` before a migration would replace it, moves
 * deleted projects to `backups` for `BACKUP_RETENTION_DAYS` days, and remembers the last open
 * project. The session (src/app/persistence.ts) decides when to call it. Lists and checks read
 * index rows only; a project's record is read to open, copy, export or measure it.
 */

/** Days a deleted project (or the original of a migrated one) is kept before it is purged. */
export const BACKUP_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The settings key of the last open project's id. */
export const LAST_PROJECT_SETTING = 'lastProjectId';

/** The longest project name kept; longer names are cut. */
export const MAX_PROJECT_NAME_LENGTH = 120;

export interface ProjectSummary {
  readonly id: ProjectId;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly savedAt: string;
  readonly stepCount: number;
  readonly dataRevision: string;
  readonly schemaVersion: number | null;
  readonly sample: boolean;
  /** For the next write's check (ProjectIndexRow.writeSeq). */
  readonly writeSeq: number;
}

export interface BackupSummary {
  readonly id: string;
  readonly reason: BackupReason;
  readonly createdAt: string;
  readonly purgeAfter: string;
  readonly project: ProjectSummary;
}

/** What the session knows about the stored record of a project it has open. */
export interface ProjectHandle {
  readonly id: ProjectId;
  readonly name: string;
  readonly sample: boolean;
  /** The stored record's writeSeq, or null when the project has no record yet. */
  readonly writeSeq: number | null;
  /** When the record was last written, or null when there is none. */
  readonly savedAt: string | null;
  /** The dataRevision the stored record carries (the loaded one once the drift banner is dismissed). */
  readonly storedRevision: string;
  /** The fingerprints stored with it, or null. */
  readonly prints: DataPrints | null;
}

/**
 * Why a stored project did not open: `missing` (gone since it was listed), `invalid` (not a
 * project this version can read; trying again cannot help), `backup-failed` (it needs a migration
 * and its original could not be backed up first) or `storage` (it could not be read). The last two
 * can succeed when tried again.
 */
export type LoadProblemReason = 'missing' | 'invalid' | 'backup-failed' | 'storage';

export type LoadProjectResult =
  | {
      readonly ok: true;
      readonly project: ProjectV1;
      readonly handle: ProjectHandle;
      /** The schema version it was migrated from, or null when it was current. */
      readonly migratedFrom: number | null;
      /** The backup of the original document taken before the migration, or null. */
      readonly backup: BackupSummary | null;
    }
  | { readonly ok: false; readonly reason: LoadProblemReason; readonly message: string; readonly errors: readonly ProjectIssue[] };

export type WriteOutcome =
  | { readonly ok: true; readonly handle: ProjectHandle; readonly summary: ProjectSummary }
  | { readonly ok: false; readonly reason: 'conflict'; readonly current: ProjectSummary | null };

export type RenameOutcome =
  | { readonly ok: true; readonly summary: ProjectSummary }
  | { readonly ok: false; readonly reason: 'conflict'; readonly current: ProjectSummary | null };

/** A stored record's size, for the "storage is full" message (M4 review CR-03). */
export interface RecordSize {
  readonly kind: 'project' | 'backup';
  /** The project's or the backup's id. */
  readonly id: string;
  readonly name: string;
  /** The length of the record's JSON: about what it takes in storage. */
  readonly bytes: number;
}

export interface ProjectLibraryOptions {
  readonly storage: ProjectStorage;
  readonly clock: Clock;
  /** Makes backup ids (with the `project` prefix swapped for `backup`). */
  readonly ids: IdSource;
  /** Reads a stored document as a project; defaults to src/project's `parseProject`. */
  readonly parse?: ((document: unknown) => ParseProjectResult) | undefined;
  /** The schema version `parse` produces; defaults to PROJECT_SCHEMA_VERSION. */
  readonly latestSchemaVersion?: number | undefined;
  readonly retentionDays?: number | undefined;
}

export interface ProjectLibrary {
  readonly storage: ProjectStorage;
  /** Every stored project, most recently updated first (then by id). */
  list(): Promise<ProjectSummary[]>;
  /** One stored project's summary (its index row only), or null when there is none. */
  summary(id: string): Promise<ProjectSummary | null>;
  /**
   * Reads a stored project. A document that needs a migration is copied to the backups first,
   * once per stored version (`writeSeq`): opening it again, or copying it, reuses that backup.
   */
  load(id: string): Promise<LoadProjectResult>;
  /** The stored document as it is, unvalidated (to export a project that cannot be opened). */
  readDocument(id: string): Promise<{ readonly document: unknown; readonly summary: ProjectSummary } | null>;
  /**
   * Writes `project` as the record of `handle` (its name, sample flag and writeSeq), with `prints`.
   * Every storage request is made before this returns, so a flush from a `pagehide` handler
   * reaches storage. Resolves a conflict when the record changed since `handle.writeSeq`.
   */
  write(handle: Pick<ProjectHandle, 'name' | 'sample' | 'writeSeq'>, project: ProjectV1, prints: DataPrints | null): Promise<WriteOutcome>;
  /** Renames a stored project (its index row only). */
  rename(id: string, name: string, expectedSeq: number | null): Promise<RenameOutcome>;
  /**
   * Moves a stored project to the backups, writing `extra` backups with it; resolves the stored
   * project's backup, or null when there is no such project.
   */
  moveToBackup(id: string, reason: BackupReason, extra?: readonly BackupRow[]): Promise<BackupSummary | null>;
  /** Removes a stored project for good (nothing goes to the backups but `extra`); resolves whether it existed. */
  deletePermanently(id: string, extra?: readonly BackupRow[]): Promise<boolean>;
  /**
   * A backup of a project as this page has it (its latest changes may not be stored), to go to the
   * backups with `moveToBackup` or `deletePermanently`.
   */
  backupOf(project: ProjectV1, handle: Pick<ProjectHandle, 'name' | 'sample' | 'writeSeq' | 'savedAt'>, prints: DataPrints | null, reason: BackupReason): { readonly row: BackupRow; readonly summary: BackupSummary };
  /** Every backup, newest first (index rows only). */
  listBackups(): Promise<BackupSummary[]>;
  /**
   * Puts a backup's record back as a project and removes the backup. The original id is kept when
   * it is free; otherwise (the original of a migrated project that still exists) the document gets
   * a new id and the name says what it is. Resolves the restored project's summary, or null when
   * there is no such backup.
   */
  restoreBackup(id: string): Promise<ProjectSummary | null>;
  /** Removes a backup for good. */
  deleteBackup(id: string): Promise<void>;
  /** Removes the backups past their retention; resolves how many. */
  purgeExpired(): Promise<number>;
  /**
   * The size of every stored project and backup, reading each record once (then remembered per
   * stored version). Only for when storage is full: it reads whole records.
   */
  recordSizes(): Promise<RecordSize[]>;
  lastProjectId(): Promise<string | null>;
  setLastProjectId(id: string): Promise<void>;
}

/** A name trimmed and cut to MAX_PROJECT_NAME_LENGTH; null when nothing is left. */
export function cleanProjectName(name: string): string | null {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (trimmed === '') return null;
  return trimmed.length > MAX_PROJECT_NAME_LENGTH ? trimmed.slice(0, MAX_PROJECT_NAME_LENGTH).trimEnd() : trimmed;
}

/** The summary of a stored project from its index row. */
export function projectSummaryOf(row: ProjectIndexRow): ProjectSummary {
  return {
    id: projectId(row.id),
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    savedAt: row.savedAt,
    stepCount: row.stepCount,
    dataRevision: row.dataRevision,
    schemaVersion: row.schemaVersion,
    sample: row.sample,
    writeSeq: row.writeSeq,
  };
}

function backupSummaryOf(row: BackupSummaryRow): BackupSummary {
  return { id: row.id, reason: row.reason, createdAt: row.createdAt, purgeAfter: row.purgeAfter, project: projectSummaryOf(row.index) };
}

const newestFirst = (a: { readonly updatedAt: string; readonly id: string }, b: { readonly updatedAt: string; readonly id: string }): number =>
  a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** About how many bytes a record takes: the length of its JSON (0 when it has none). */
function recordBytes(row: ProjectRow): number {
  try {
    return (JSON.stringify(row.project)?.length ?? 0) + (JSON.stringify(row.dataPrints)?.length ?? 0);
  } catch {
    return 0;
  }
}

export function createProjectLibrary(opts: ProjectLibraryOptions): ProjectLibrary {
  const { storage, clock, ids } = opts;
  const parse = opts.parse ?? parseProject;
  const latest = opts.latestSchemaVersion ?? PROJECT_SCHEMA_VERSION;
  const retentionMs = (opts.retentionDays ?? BACKUP_RETENTION_DAYS) * DAY_MS;
  /** Record sizes by `project:<id>:<writeSeq>` or `backup:<id>` (backups never change). */
  const sizes = new Map<string, number>();

  const backupId = (): string => ids.next('project').replace(/^project-/, 'backup-');
  const backupTimes = () => {
    const createdAt = clock.nowIso();
    return { createdAt, purgeAfter: new Date(Date.parse(createdAt) + retentionMs).toISOString() };
  };

  const handleOf = (row: ProjectIndexRow, prints: DataPrints | null): ProjectHandle => ({
    id: projectId(row.id),
    name: row.name,
    sample: row.sample,
    writeSeq: row.writeSeq,
    savedAt: row.savedAt,
    storedRevision: row.dataRevision,
    prints,
  });

  const indexInput = (project: ProjectV1, name: string, sample: boolean, savedAt: string) => ({
    id: project.id,
    name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    savedAt,
    stepCount: project.route.steps.length,
    dataRevision: project.dataRevision,
    schemaVersion: project.schemaVersion,
    sample,
  });

  /** The migration backup already taken of this stored version, if any. */
  async function migrationBackupOf(index: ProjectIndexRow): Promise<BackupSummary | null> {
    const existing = (await storage.listBackups()).find((b) => b.reason === 'migration' && b.index.id === index.id && b.index.writeSeq === index.writeSeq);
    return existing === undefined ? null : backupSummaryOf(existing);
  }

  return {
    storage,

    async list() {
      return (await storage.listProjects()).map(projectSummaryOf).sort(newestFirst);
    },

    async summary(id) {
      const row = await storage.readIndex(id);
      return row === null ? null : projectSummaryOf(row);
    },

    async load(id) {
      let read: Awaited<ReturnType<ProjectStorage['readProject']>>;
      try {
        read = await storage.readProject(id);
      } catch (error: unknown) {
        return { ok: false, reason: 'storage', message: `The stored project could not be read (${error instanceof Error ? error.message : String(error)})`, errors: [] };
      }
      if (read === null) return { ok: false, reason: 'missing', message: 'The project is no longer in storage', errors: [] };
      const document = read.row.project;
      const declared = detectSchemaVersion(document);
      const parsed = parse(document);
      if (!parsed.ok) {
        return { ok: false, reason: 'invalid', message: 'The stored project is not a valid project file for this version of the app', errors: parsed.errors };
      }
      if (parsed.project.id !== read.index.id) {
        return {
          ok: false,
          reason: 'invalid',
          message: 'The stored project does not match its storage record',
          errors: [{ path: 'id', message: `Expected "${read.index.id}", found "${parsed.project.id}"` }],
        };
      }
      const migratedFrom = declared.ok && declared.version < latest ? declared.version : null;
      let backup: BackupSummary | null = null;
      if (migratedFrom !== null) {
        // The migrated project replaces the stored document at the next save: keep the original,
        // once per stored version (M4 review CR-18).
        try {
          backup = await migrationBackupOf(read.index);
          if (backup === null) {
            const row: BackupRow = { id: backupId(), reason: 'migration', ...backupTimes(), index: read.index, record: read.row };
            await storage.putBackup(row);
            backup = backupSummaryOf(row);
          }
        } catch (error: unknown) {
          const reason = error instanceof Error ? error.message : String(error);
          return { ok: false, reason: 'backup-failed', message: `The project needs a migration, and its original could not be backed up first (${reason})`, errors: [] };
        }
      }
      return { ok: true, project: parsed.project, handle: handleOf(read.index, read.row.dataPrints), migratedFrom, backup };
    },

    async readDocument(id) {
      const read = await storage.readProject(id);
      return read === null ? null : { document: read.row.project, summary: projectSummaryOf(read.index) };
    },

    write(handle, project, prints) {
      // No await before this call: every request of the write is made in the caller's task.
      return storage
        .writeProject({ id: project.id, project, dataPrints: prints }, indexInput(project, handle.name, handle.sample, clock.nowIso()), handle.writeSeq)
        .then(
          (result): WriteOutcome =>
            result.ok
              ? { ok: true, handle: handleOf(result.index, prints), summary: projectSummaryOf(result.index) }
              : { ok: false, reason: 'conflict', current: result.current === null ? null : projectSummaryOf(result.current) },
        );
    },

    async rename(id, name, expectedSeq) {
      const result = await storage.renameProject(id, name, expectedSeq);
      return result.ok ? { ok: true, summary: projectSummaryOf(result.index) } : { ok: false, reason: 'conflict', current: result.current === null ? null : projectSummaryOf(result.current) };
    },

    async moveToBackup(id, reason, extra = []) {
      const backup = await storage.moveToBackup(id, { id: backupId(), reason, ...backupTimes() }, extra);
      return backup === null ? null : backupSummaryOf(backup);
    },

    deletePermanently: (id, extra = []) => storage.deleteProject(id, extra),

    backupOf(project, handle, prints, reason) {
      const times = backupTimes();
      const index: ProjectIndexRow = { ...indexInput(project, handle.name, handle.sample, handle.savedAt ?? times.createdAt), writeSeq: handle.writeSeq ?? 0 };
      const row: BackupRow = { id: backupId(), reason, ...times, index, record: { id: project.id, project, dataPrints: prints } };
      return { row, summary: backupSummaryOf(row) };
    },

    async listBackups() {
      const rows = await storage.listBackups();
      return rows.map(backupSummaryOf).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? -1 : 1));
    },

    async restoreBackup(id) {
      const backup = await storage.readBackup(id);
      if (backup === null) return null;
      // The index row says whether the id is taken; the stored record is not read.
      const taken = (await storage.readIndex(backup.index.id)) !== null;
      let record = backup.record;
      let index = backup.index;
      if (taken) {
        // Only the document's id changes; everything else is restored as it was stored.
        const fresh = ids.next('project');
        const document = isRecord(record.project) ? { ...record.project, id: fresh } : record.project;
        record = { ...record, id: fresh, project: document };
        index = { ...index, id: fresh, name: cleanProjectName(`${index.name} (${backup.reason === 'migration' ? 'before migration' : 'restored'})`) ?? index.name };
      }
      const { writeSeq: _seq, ...input } = index;
      const written = await storage.writeProject(record, { ...input, savedAt: clock.nowIso() }, null);
      if (!written.ok) return null;
      await storage.deleteBackup(id);
      return projectSummaryOf(written.index);
    },

    deleteBackup: (id) => storage.deleteBackup(id),

    purgeExpired: () => storage.purgeBackups(clock.nowIso()),

    async recordSizes() {
      const [projects, backups] = await Promise.all([storage.listProjects(), storage.listBackups()]);
      const out: RecordSize[] = [];
      for (const project of projects) {
        const key = `project:${project.id}:${String(project.writeSeq)}`;
        let bytes = sizes.get(key);
        if (bytes === undefined) {
          const read = await storage.readProject(project.id);
          if (read === null) continue;
          bytes = recordBytes(read.row);
          sizes.set(key, bytes);
        }
        out.push({ kind: 'project', id: project.id, name: project.name, bytes });
      }
      for (const backup of backups) {
        const key = `backup:${backup.id}`;
        let bytes = sizes.get(key);
        if (bytes === undefined) {
          const read = await storage.readBackup(backup.id);
          if (read === null) continue;
          bytes = recordBytes(read.record);
          sizes.set(key, bytes);
        }
        out.push({ kind: 'backup', id: backup.id, name: backup.index.name, bytes });
      }
      return out;
    },

    async lastProjectId() {
      const value = await storage.getSetting(LAST_PROJECT_SETTING);
      return typeof value === 'string' ? value : null;
    },

    setLastProjectId: (id) => storage.setSetting(LAST_PROJECT_SETTING, id),
  };
}
