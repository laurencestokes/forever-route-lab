/**
 * Project storage records (docs/ARCHITECTURE.md §12.3). Five stores:
 *
 * - `projects`: id → `ProjectRow`, the project document as saved plus the fingerprints of the
 *   dataset records it used (the drift check, ARCHITECTURE §5.5);
 * - `projectIndex`: id → `ProjectIndexRow`, what the project list shows without loading a project;
 * - `backups`: id → `BackupRow`, deleted projects and the originals of migrated ones, each kept
 *   until its `purgeAfter` time;
 * - `backupIndex`: id → `BackupSummaryRow`, what the Recently deleted list shows without loading a
 *   backup's record (M4 review CR-14);
 * - `settings`: key → value (the last open project).
 *
 * Storage does not interpret documents: `ProjectRow.project` is whatever was written, and reading it
 * back as a project (parse, migrate, validate) is the app's job (src/app/project-library.ts).
 */

/** What the dataset said about the quests a project uses, when the project was last saved. */
export interface DataPrints {
  /** The manifest `dataRevision` the prints were taken against. */
  readonly dataRevision: string;
  /** Keyed by quest id (decimal string): fingerprints of the quest's objective list and prerequisites. */
  readonly quests: Readonly<Record<string, QuestPrint>>;
}

export interface QuestPrint {
  readonly objectives: string;
  readonly prerequisites: string;
}

export interface ProjectRow {
  readonly id: string;
  /** The project document as saved. Written as a ProjectV1; read back as unknown until parsed. */
  readonly project: unknown;
  /** Null when nothing is known about the data the project was saved with (an imported file). */
  readonly dataPrints: DataPrints | null;
}

export interface ProjectIndexRow {
  readonly id: string;
  /** The project's name (ProjectV1 has none of its own; the route has its own name). */
  readonly name: string;
  /** `project.createdAt` and `project.updatedAt` of the saved document. */
  readonly createdAt: string;
  readonly updatedAt: string;
  /** When this record was written, by the app clock. */
  readonly savedAt: string;
  readonly stepCount: number;
  /** The `dataRevision` the saved document records. */
  readonly dataRevision: string;
  /** The schema version the saved document declares, or null when it declares none. */
  readonly schemaVersion: number | null;
  /** The auto-generated sample project (shown with the "Sample" label and route notice). */
  readonly sample: boolean;
  /**
   * Incremented by every write of this project. A writer states the value it last saw; any other
   * value means someone else (another tab) wrote in between, and the write is refused.
   */
  readonly writeSeq: number;
}

/** An index row as a writer supplies it: storage assigns `writeSeq`. */
export type ProjectIndexInput = Omit<ProjectIndexRow, 'writeSeq'>;

export type BackupReason = 'deleted' | 'migration';

export interface BackupRow {
  readonly id: string;
  readonly reason: BackupReason;
  /** When the backup was taken (app clock). */
  readonly createdAt: string;
  /** The first start after this time removes the backup. */
  readonly purgeAfter: string;
  /** The project's index row and record at the time, unchanged. */
  readonly index: ProjectIndexRow;
  readonly record: ProjectRow;
}

/** A backup without its record, for lists (the `backupIndex` store). */
export type BackupSummaryRow = Omit<BackupRow, 'record'>;

/** What a writer says about a backup storage makes from a stored project. */
export type BackupMeta = Pick<BackupRow, 'id' | 'reason' | 'createdAt' | 'purgeAfter'>;

export type WriteProjectResult =
  | { readonly ok: true; readonly index: ProjectIndexRow }
  | {
      readonly ok: false;
      readonly reason: 'conflict';
      /** The row found instead of the expected one; null when the project no longer exists. */
      readonly current: ProjectIndexRow | null;
    };

/** Browser storage usage, when the browser reports it (`navigator.storage.estimate`). */
export interface StorageEstimate {
  readonly usage: number;
  readonly quota: number;
}

/**
 * The storage operations the app uses. Every method rejects with a `StorageError`
 * (src/infra/persistence/errors.ts) on failure.
 */
export interface ProjectStorage {
  /** `memory`: nothing outlives the page (browser storage is unavailable). */
  readonly kind: 'indexeddb' | 'memory';
  /** Every index row, in id order. */
  listProjects(): Promise<ProjectIndexRow[]>;
  /** One index row without its record (existence and `writeSeq` checks), or null. */
  readIndex(id: string): Promise<ProjectIndexRow | null>;
  readProject(id: string): Promise<{ readonly index: ProjectIndexRow; readonly row: ProjectRow } | null>;
  /**
   * Writes the project and its index row in one transaction. `expectedSeq` is the `writeSeq` the
   * writer last saw, or null for a project it believes does not exist yet; anything else found in
   * storage writes nothing and resolves a conflict. Every request of the write is made before this
   * returns (no request waits for another's answer), so a write started in a `pagehide` handler
   * has reached the database before the page goes (M4 review CR-01).
   */
  writeProject(row: ProjectRow, index: ProjectIndexInput, expectedSeq: number | null): Promise<WriteProjectResult>;
  /** Changes the name in the index row, with the same check as `writeProject`. */
  renameProject(id: string, name: string, expectedSeq: number | null): Promise<WriteProjectResult>;
  /**
   * Moves a project to the backups in one transaction: the project is removed and a backup (with
   * its index row and record as stored) is written, plus `extra` backups. The removal is requested
   * before any backup, so at a full quota the space it frees comes first. Resolves the stored
   * project's backup, or null when the project does not exist (the `extra` backups are written
   * either way).
   */
  moveToBackup(id: string, backup: BackupMeta, extra?: readonly BackupRow[]): Promise<BackupRow | null>;
  /**
   * Removes a project for good (no backup of what is stored), writing `extra` backups in the same
   * transaction, after the removal. Resolves whether the project existed.
   */
  deleteProject(id: string, extra?: readonly BackupRow[]): Promise<boolean>;
  putBackup(backup: BackupRow): Promise<void>;
  /** Every backup without its record, in id order (never loads a record). */
  listBackups(): Promise<BackupSummaryRow[]>;
  readBackup(id: string): Promise<BackupRow | null>;
  deleteBackup(id: string): Promise<void>;
  /** Removes every backup whose `purgeAfter` is at or before `nowIso`; resolves how many. */
  purgeBackups(nowIso: string): Promise<number>;
  getSetting(key: string): Promise<unknown>;
  setSetting(key: string, value: unknown): Promise<void>;
  /** Usage and quota, or null when the browser does not say. */
  estimate(): Promise<StorageEstimate | null>;
  close(): void;
}
