import { createEmptyProject, type IdSource, type ProjectId, projectId, type ProjectV1 } from '../domain';
import {
  browserIndexedDb,
  browserProjectLocks,
  browserStorageChannel,
  browserStorageManager,
  type DataPrints,
  type HeldLock,
  type OpenedProjectStorage,
  openProjectStorage,
  projectLockName,
  type ProjectLocks,
  type ProjectStorage,
  type StorageChange,
  type StorageChangeChannel,
  toStorageError,
} from '../infra/persistence';
import { parseProject, parseProjectText, type ProjectIssue, serializeProject } from '../project';
import { type Autosave, type AutosaveHost, type AutosaveTiming, browserAutosaveHost, createAutosave, DEFAULT_AUTOSAVE_TIMING } from './autosave';
import type { Clock } from './clock';
import { type DatasetSource, datasetViewInputOf } from './dataset-source';
import { checkDrift, dataPrintsOf, type DriftReport } from './drift';
import { collisionFreeIds } from './ids';
import {
  BACKUP_RETENTION_DAYS,
  type BackupSummary,
  cleanProjectName,
  createProjectLibrary,
  type LoadProblemReason,
  type LoadProjectResult,
  type ProjectHandle,
  type ProjectLibrary,
  projectSummaryOf,
  type ProjectSummary,
  type WriteOutcome,
} from './project-library';
import type { EditorStore } from './store';

/**
 * The project session (docs/ARCHITECTURE.md §12.3): the open project's link to project storage,
 * and the project list. Framework-agnostic like the store; the ui reads it with
 * useSyncExternalStore (src/ui/app/ProjectMenuContext.tsx).
 *
 * - **Autosave.** Every project change (a new store revision) schedules a save (src/app/autosave.ts).
 *   Hiding or leaving the page starts the save at once, with every storage request made inside the
 *   page's event handler (M4 review CR-01); a save already running is followed by another as soon
 *   as it ends. While changes cannot be kept (a failed or refused save, or no browser storage), the
 *   page asks before it closes. `project.updatedAt` is the store's (the app clock's), and `savedAt`
 *   is when the record was written.
 * - **Honest status.** `save` is one of: saved (with the time), pending, saving, failed (with the
 *   reason: storage full, changed in another tab, open in another tab, connection lost, other) or
 *   unavailable (browser storage refused: projects live in memory until the page closes). A failure
 *   stays on show while the save is tried again, until one succeeds.
 * - **Other tabs** (CR-02). The open project's Web Lock says whether another tab has it open; a
 *   project opened while another tab has it is not saved from here until the user chooses "Open
 *   anyway" or "Open a copy". Every change another tab stores is announced on a BroadcastChannel,
 *   so a save there shows here as "changed elsewhere" at once, not at this tab's next save.
 * - **Drift.** A project saved with another data revision opens with the drift report
 *   (ARCHITECTURE §5.5). Until it is dismissed, saves, copies and exports keep the stored revision
 *   and fingerprints, so the report comes back at the next start; dismissing records the loaded
 *   revision.
 * - **Operations** (new, open, rename, duplicate, delete, restore, import) run one at a time and
 *   resolve a `SessionResult` whose `message` the ui announces.
 */

export type { BackupSummary, ProjectSummary } from './project-library';
export type { DriftReport } from './drift';
export type { ProjectIssue } from '../project';
export type { LoadProblemReason } from './project-library';
export { BACKUP_RETENTION_DAYS, MAX_PROJECT_NAME_LENGTH } from './project-library';

/** The open project, as the top bar and the project menu show it. */
export interface CurrentProject {
  readonly id: ProjectId;
  readonly name: string;
  /** The auto-generated sample: the shell shows the "Sample" label and the sample route notice. */
  readonly sample: boolean;
  /** Whether storage has a record of it (false until its first save succeeds). */
  readonly stored: boolean;
}

/**
 * Why saving stopped or failed: storage full, changed (or deleted) in another tab, open in another
 * tab (this tab does not save it until the user chooses), the storage connection lost, other.
 */
export type SaveFailureReason = 'quota' | 'conflict' | 'elsewhere' | 'closed' | 'error';

export type SaveStatus =
  /** Everything up to the current change is stored; `at` is when (app clock, ISO). */
  | { readonly kind: 'saved'; readonly at: string }
  /** Changes wait for the next save. */
  | { readonly kind: 'pending' }
  | { readonly kind: 'saving' }
  /** The last save failed (or saving is held back); changes since `lastSavedAt` are only in this page. */
  | { readonly kind: 'failed'; readonly reason: SaveFailureReason; readonly message: string; readonly lastSavedAt: string | null }
  /** Browser storage is unavailable: projects are kept in memory and lost when the page closes. */
  | { readonly kind: 'unavailable'; readonly reason: string };

/** Something the start or an operation wants the user to know that is not a save status. */
export interface SessionNotice {
  readonly id: string;
  readonly message: string;
  readonly details: readonly string[];
}

/** A stored project that could not be opened in this session, and why. */
export interface ProjectProblem {
  /** `storage` and `backup-failed` can succeed when tried again; `invalid` and `missing` cannot. */
  readonly reason: LoadProblemReason;
  readonly message: string;
  readonly errors: readonly ProjectIssue[];
}

export interface ProjectListItem extends ProjectSummary {
  /** Set once opening it failed in this session. */
  readonly problem: ProjectProblem | null;
}

export interface ProjectSessionState {
  /** `memory`: browser storage is unavailable (see `unavailable`). */
  readonly storageKind: ProjectStorage['kind'];
  readonly unavailable: string | null;
  readonly current: CurrentProject;
  readonly save: SaveStatus;
  /**
   * After "changed elsewhere": the version another tab or window stored, which "Keep this version
   * (overwrite)" replaces; null when there is no conflict or the project was deleted there.
   */
  readonly otherVersion: ProjectSummary | null;
  /** The drift report of the open project, until dismissed; null when there is none. */
  readonly drift: DriftReport | null;
  /** Stored projects, most recently updated first; empty until the first `refresh`. */
  readonly projects: readonly ProjectListItem[];
  /** Deleted projects and originals of migrated ones, newest first. */
  readonly backups: readonly BackupSummary[];
  /**
   * About how many bytes each stored project and backup takes, by project or backup id: measured
   * when storage is full (CR-03), so the user can tell what to delete; null otherwise.
   */
  readonly sizes: Readonly<Record<string, number>> | null;
  readonly notices: readonly SessionNotice[];
  /** An operation is running; the menu's actions wait. */
  readonly busy: boolean;
}

export type SessionResult =
  | { readonly ok: true; readonly message: string }
  | {
      readonly ok: false;
      readonly message: string;
      readonly errors: readonly ProjectIssue[];
      /** The project is open in another tab or window: the ui offers "Open anyway" and "Open a copy". */
      readonly openElsewhere?: ProjectId | undefined;
    };

/** A file for the ui to hand to the browser as a download. */
export interface DownloadFile {
  readonly fileName: string;
  readonly text: string;
  readonly mimeType: string;
}

export const PROJECT_FILE_EXTENSION = '.frl.json';
export const PROJECT_FILE_MIME = 'application/json';
/** Larger files are refused before they are read. */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
export const NEW_PROJECT_NAME = 'New project';
export const NEW_ROUTE_NAME = 'Untitled route';
export const LOCKED_MESSAGE = 'Unavailable while the optimiser runs or a proposal is open';

export interface ProjectSession {
  readonly getState: () => ProjectSessionState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Reloads the project and backup lists. */
  readonly refresh: () => Promise<void>;
  /** Saves now if anything is unsaved; resolves once the save has finished (or failed). */
  readonly flush: () => Promise<SaveStatus>;
  /**
   * After "changed in another tab": write this page's version over the stored one (keeping the
   * stored name and sample flag; `otherVersion` says what is replaced).
   */
  readonly overwriteStored: () => Promise<SessionResult>;
  /** The open project is open in another tab too: save it from this tab as well. */
  readonly openAnyway: () => Promise<SessionResult>;
  readonly newProject: (name?: string) => Promise<SessionResult>;
  /**
   * Opens a stored project. When another tab has it open, nothing happens and the result carries
   * `openElsewhere`, unless `anyway`: then it opens and this tab saves it too.
   */
  readonly openProject: (id: ProjectId, opts?: { readonly anyway?: boolean }) => Promise<SessionResult>;
  readonly renameProject: (id: ProjectId, name: string) => Promise<SessionResult>;
  /** Copies a project (the open one with its unsaved changes); `open` switches to the copy. */
  readonly duplicateProject: (id: ProjectId, opts?: { readonly open?: boolean }) => Promise<SessionResult>;
  /**
   * Moves a project to the backups for BACKUP_RETENTION_DAYS, with the open project's latest
   * changes even when they could not be saved; `permanently` removes it with no backup (to free
   * space when storage is full). The open one is replaced by another.
   */
  readonly deleteProject: (id: ProjectId, opts?: { readonly permanently?: boolean }) => Promise<SessionResult>;
  readonly restoreBackup: (backupId: string) => Promise<SessionResult>;
  /** Removes a backup for good. */
  readonly deleteBackup: (backupId: string) => Promise<SessionResult>;
  /** Imports a native project file as a new project and opens it. */
  readonly importProjectText: (text: string, fileName: string) => Promise<SessionResult>;
  /**
   * Stores a project made elsewhere (for example lowered from an RXP guide) as a new project and
   * opens it, once it passes the project schema (a project that does not is refused with its
   * problems, CR-11). It gets a new id; nothing else in it changes. `name` is the project's name
   * (the route's name when it is blank).
   */
  readonly importProject: (project: ProjectV1, name: string) => Promise<SessionResult>;
  /**
   * The open project as a deterministic `.frl.json` file (serializeProject). While the drift report
   * is pending, the file records the stored data revision, as saves do (CR-12).
   */
  readonly exportCurrent: () => DownloadFile;
  /**
   * A stored project as a file: validated and serialised when it opens, otherwise the stored
   * document as it is (`validated: false`), so a project this version cannot open can still be kept.
   */
  readonly exportStored: (id: ProjectId) => Promise<{ readonly file: DownloadFile; readonly validated: boolean } | null>;
  /** Dismisses the drift report: the loaded data revision is recorded at the next save. */
  readonly acknowledgeDrift: () => void;
  /** The storage connection is gone (another tab upgraded the database): saving stops, with `reason`. */
  readonly storageLost: (reason: string) => void;
  readonly dismissNotice: (id: string) => void;
  readonly dispose: () => void;
}

/** Page events that must save at once, and the question before the page closes. */
export interface LifecycleSource {
  /** Calls `flush` when the page is hidden or unloaded; returns the unsubscribe function. */
  readonly onHide: (flush: () => void) => () => void;
  /**
   * Asks the browser to confirm leaving while `unkept()` says changes would be lost (the
   * `beforeunload` prompt); returns the unsubscribe function.
   */
  readonly onBeforeUnload?: ((unkept: () => boolean) => () => void) | undefined;
}

/** `visibilitychange` to hidden and `pagehide`, and `beforeunload`. */
export function browserLifecycle(): LifecycleSource {
  return {
    onHide(flush) {
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') flush();
      };
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pagehide', flush);
      return () => {
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', flush);
      };
    },
    onBeforeUnload(unkept) {
      const onBeforeUnload = (event: BeforeUnloadEvent) => {
        if (!unkept()) return;
        // Both, for browsers that still read the legacy returnValue.
        event.preventDefault();
        event.returnValue = '';
      };
      window.addEventListener('beforeunload', onBeforeUnload);
      return () => {
        window.removeEventListener('beforeunload', onBeforeUnload);
      };
    },
  };
}

/**
 * Browser project storage (IndexedDB, or memory with the reason), with the Web Locks and the
 * BroadcastChannel that link it to other tabs, for the composition root.
 */
export function openBrowserProjectStorage(onClosed?: (reason: string) => void): Promise<OpenedProjectStorage> {
  return openProjectStorage({
    factory: browserIndexedDb(),
    storageManager: browserStorageManager(),
    onClosed,
    locks: browserProjectLocks(),
    channel: browserStorageChannel(),
  });
}

/**
 * A calendar date in local time (`2026-10-25`), matching how the Projects dialog shows dates, so an
 * announcement and the list never disagree near midnight (UI review F20).
 */
function localDay(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** A file name for a project: its name with characters file systems refuse replaced, plus `.frl.json`. */
export function projectFileName(name: string): string {
  const printable = Array.from(name, (ch) => (ch.charCodeAt(0) < 32 ? '-' : ch)).join('');
  const base = printable
    // "Sample: Durotar" reads "Sample - Durotar", not "Sample- Durotar" (UI review F20).
    .replace(/\s*[\\/:*?"<>|]+\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.-]+$/g, '')
    .slice(0, 80)
    .trim();
  return `${base === '' ? 'project' : base}${PROJECT_FILE_EXTENSION}`;
}

/** The project name a file name suggests (`Durotar.frl.json` → `Durotar`), or null. */
export function projectNameFromFileName(fileName: string): string | null {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/(\.frl)?\.json$/i, '');
  return cleanProjectName(base);
}

export function exportProjectFile(project: ProjectV1, name: string): DownloadFile {
  return { fileName: projectFileName(name), text: serializeProject(project), mimeType: PROJECT_FILE_MIME };
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A stored record's size in words: `8.0 MB`, or `12 kB` below a megabyte. */
export function formatStoredSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? formatBytes(bytes) : `${String(Math.max(1, Math.round(bytes / 1024)))} kB`;
}

// Locks --------------------------------------------------------------------------------------------

/** Whether this tab holds the project's lock, or another tab does. */
interface Claim {
  /** The lock, when this tab holds it. */
  readonly lock: HeldLock | null;
  /** Another tab or window holds it: the project is open there. */
  readonly elsewhere: boolean;
}

const UNCLAIMED: Claim = { lock: null, elsewhere: false };

/** Takes the project's lock if no other tab holds it (a no-op claim without locks). */
async function claimProject(locks: ProjectLocks | null, id: string): Promise<Claim> {
  if (locks === null) return UNCLAIMED;
  try {
    const lock = await locks.tryAcquire(projectLockName(id));
    return { lock, elsewhere: lock === null };
  } catch {
    return UNCLAIMED;
  }
}

// Startup ----------------------------------------------------------------------------------------

/** What the start opened, for the store and the session. */
export interface StartupProject {
  /** The project for the store (recording the loaded data revision). */
  readonly project: ProjectV1;
  readonly handle: ProjectHandle;
  readonly drift: DriftReport | null;
  /** Projects that could not be opened on the way. */
  readonly problems: ReadonlyMap<string, ProjectProblem>;
  readonly notices: readonly SessionNotice[];
  /** Whether it was restored, or made because there was nothing (or nothing openable) to restore. */
  readonly origin: 'restored' | 'sample' | 'new';
  /** A migration ran; the project is saved again soon. */
  readonly migrated: boolean;
  /** The project's lock, when this tab holds it; null when another tab does, or without locks. */
  readonly lock?: HeldLock | null | undefined;
  /** Another tab has the project open: this tab does not save it until the user chooses. */
  readonly openElsewhere?: boolean | undefined;
}

export interface StartupOptions {
  readonly library: ProjectLibrary;
  readonly data: DatasetSource;
  readonly clock: Clock;
  readonly ids: IdSource;
  /** The sample project, built only when storage holds no project at all. */
  readonly createSample: () => ProjectV1;
  readonly sampleName: string;
  /** Locks shared with other tabs; omitted or null: none. */
  readonly locks?: ProjectLocks | null | undefined;
}

const problemOf = (result: Extract<LoadProjectResult, { ok: false }>): ProjectProblem => ({ reason: result.reason, message: result.message, errors: result.errors });

/** Whether opening again can help: the project could not be read, or its migration backup failed. */
export const canRetryOpen = (problem: Pick<ProjectProblem, 'reason'>): boolean => problem.reason === 'storage' || problem.reason === 'backup-failed';

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

function describeErrors(errors: readonly ProjectIssue[], limit = 5): string[] {
  const shown = errors.slice(0, limit).map((e) => `${e.path === '' ? '(document)' : e.path}: ${e.message}`);
  if (errors.length > limit) shown.push(`… and ${plural(errors.length - limit, 'more problem', 'more problems')}`);
  return shown;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withLoadedRevision(project: ProjectV1, drift: DriftReport | null): ProjectV1 {
  return drift === null ? project : { ...project, dataRevision: drift.loadedRevision };
}

/** A new empty project on the loaded data, with a random id. */
function emptyProject(ids: IdSource, clock: Clock, data: DatasetSource): ProjectV1 {
  return createEmptyProject({ ids, nowIso: clock.nowIso(), name: NEW_ROUTE_NAME, dataRevision: data.identity.dataRevision, gameBuild: data.identity.frameBuild });
}

const unsavedHandle = (project: ProjectV1, name: string, sample: boolean): ProjectHandle => ({
  id: project.id,
  name,
  sample,
  writeSeq: null,
  savedAt: null,
  storedRevision: project.dataRevision,
  prints: null,
});

/**
 * Opens what the last visit had open (ARCHITECTURE §12.3). The last open project first, then the
 * others, most recently updated first; a stored project that cannot be opened is left exactly as it
 * is and reported. With no stored project at all, the sample is made and saved; with stored
 * projects of which none opens, a new empty project. When the stored projects cannot even be
 * listed, a new unsaved project, and nothing stored is touched (CR-13). Expired backups are purged
 * first.
 */
export async function restoreStartupProject(opts: StartupOptions): Promise<StartupProject> {
  const { library, data, clock, ids } = opts;
  const locks = opts.locks ?? null;
  const notices: SessionNotice[] = [];
  const problems = new Map<string, ProjectProblem>();
  try {
    const purged = await library.purgeExpired();
    if (purged > 0) {
      notices.push({ id: 'purged', message: `${plural(purged, 'backup', 'backups')} older than ${String(BACKUP_RETENTION_DAYS)} days removed.`, details: [] });
    }
  } catch {
    // Purging again at the next start is harmless.
  }

  let summaries: ProjectSummary[];
  try {
    summaries = await library.list();
  } catch (error: unknown) {
    // The user's projects may well be there: neither the sample nor the last-project setting may
    // replace them. This project is stored only once it is changed.
    const project = emptyProject(ids, clock, data);
    notices.push({
      id: 'list-failed',
      message: 'The stored projects could not be listed, so a new project was started. Nothing stored was changed; reload the page to try again.',
      details: [errorText(error)],
    });
    const claim = await claimProject(locks, project.id);
    return { project, handle: unsavedHandle(project, NEW_PROJECT_NAME, false), drift: null, problems, notices, origin: 'new', migrated: false, lock: claim.lock, openElsewhere: false };
  }

  const last = summaries.length === 0 ? null : await library.lastProjectId().catch(() => null);
  const ordered = [...summaries].sort((a, b) => (a.id === last ? -1 : b.id === last ? 1 : 0));
  for (const summary of ordered) {
    const loaded = await library.load(summary.id);
    if (!loaded.ok) {
      const problem = problemOf(loaded);
      problems.set(summary.id, problem);
      notices.push({
        id: `unopenable-${summary.id}`,
        message: canRetryOpen(problem)
          ? `“${summary.name}” could not be opened: ${loaded.message}. It is kept in storage unchanged; try opening it again from Projects.`
          : `“${summary.name}” could not be opened: ${loaded.message}. It is kept in storage unchanged.`,
        details: describeErrors(loaded.errors),
      });
      continue;
    }
    if (loaded.migratedFrom !== null && loaded.backup !== null) {
      notices.push({
        id: `migrated-${summary.id}`,
        message: `“${summary.name}” was migrated from schema version ${String(loaded.migratedFrom)}. The original is kept in Recently deleted until ${loaded.backup.purgeAfter.slice(0, 10)}.`,
        details: [],
      });
    }
    const drift = checkDrift({
      project: loaded.project,
      storedRevision: loaded.handle.storedRevision,
      view: data.view(datasetViewInputOf(loaded.project)),
      prints: loaded.handle.prints,
    });
    const claim = await claimProject(locks, summary.id);
    await library.setLastProjectId(summary.id).catch(() => undefined);
    return {
      project: withLoadedRevision(loaded.project, drift),
      handle: loaded.handle,
      drift,
      problems,
      notices,
      origin: 'restored',
      migrated: loaded.migratedFrom !== null,
      lock: claim.lock,
      openElsewhere: claim.elsewhere,
    };
  }

  // Nothing to restore: the sample when storage is empty, otherwise a new project beside the
  // stored ones that could not be opened (never the sample over them).
  const origin = summaries.length === 0 ? 'sample' : 'new';
  const safeIds = collisionFreeIds(ids, emptyProject(ids, clock, data));
  const base = origin === 'sample' ? opts.createSample() : emptyProject(safeIds, clock, data);
  // A random id, so a later sample never takes the id of an earlier one kept in the backups.
  const project: ProjectV1 = origin === 'sample' ? { ...base, id: projectId(safeIds.next('project')) } : base;
  const name = origin === 'sample' ? opts.sampleName : NEW_PROJECT_NAME;
  const sample = origin === 'sample';
  let handle = unsavedHandle(project, name, sample);
  try {
    const written = await library.write(handle, project, dataPrintsOf(project, data.view(datasetViewInputOf(project))));
    if (written.ok) {
      handle = written.handle;
      await library.setLastProjectId(project.id).catch(() => undefined);
    }
  } catch (error: unknown) {
    notices.push({ id: 'first-save', message: `“${name}” could not be saved yet.`, details: [errorText(error)] });
  }
  if (origin === 'new') {
    notices.push({
      id: 'none-openable',
      message: `None of the ${plural(summaries.length, 'stored project', 'stored projects')} could be opened, so a new project was started. They are kept in storage unchanged; see Projects.`,
      details: [],
    });
  }
  const claim = await claimProject(locks, project.id);
  return { project, handle, drift: null, problems, notices, origin, migrated: false, lock: claim.lock, openElsewhere: false };
}

// The session ------------------------------------------------------------------------------------

export interface ProjectSessionOptions {
  readonly store: EditorStore;
  readonly library: ProjectLibrary;
  readonly data: DatasetSource;
  readonly startup: StartupProject;
  readonly clock: Clock;
  readonly ids: IdSource;
  /** Why browser storage is unavailable (the storage is then in memory); null when it is available. */
  readonly unavailable: string | null;
  /** The sample, for when the last stored project is deleted. */
  readonly createSample: () => ProjectV1;
  readonly sampleName: string;
  readonly host?: AutosaveHost | undefined;
  readonly timing?: AutosaveTiming | undefined;
  readonly lifecycle?: LifecycleSource | undefined;
  /** Locks shared with other tabs (src/infra/persistence/tabs.ts); omitted or null: none. */
  readonly locks?: ProjectLocks | null | undefined;
  /** Storage changes other tabs make; omitted or null: none (a stale save is still refused, later). */
  readonly channel?: StorageChangeChannel | null | undefined;
}

function failureOf(error: unknown): { readonly reason: SaveFailureReason; readonly message: string } {
  const failure = toStorageError(error);
  if (failure.code === 'quota') return { reason: 'quota', message: failure.message };
  if (failure.code === 'closed') return { reason: 'closed', message: failure.message };
  return { reason: 'error', message: failure.message };
}

const ok = (message: string): SessionResult => ({ ok: true, message });
const fail = (message: string, errors: readonly ProjectIssue[] = []): SessionResult => ({ ok: false, message, errors });

const CHANGED_ELSEWHERE = 'This project was changed in another tab or window since this page last saved it. Keep this version (overwrite) or save it as a copy.';
const DELETED_ELSEWHERE = 'This project was deleted in another tab or window. Duplicate it to keep this version.';
const OPEN_ELSEWHERE = 'This project is open in another tab or window, so this tab does not save it. Open it anyway to save it from here too, or open a copy.';

type Blocked = { readonly reason: SaveFailureReason; readonly message: string };

export function createProjectSession(opts: ProjectSessionOptions): ProjectSession {
  const { store, library, data, clock, ids } = opts;
  const storage = library.storage;
  const unavailable = opts.unavailable;
  const locks = opts.locks ?? null;
  const channel = opts.channel ?? null;
  const listeners = new Set<() => void>();

  let handle: ProjectHandle = opts.startup.handle;
  let drift: DriftReport | null = opts.startup.drift;
  /** The store revision the stored record holds; -1 when it holds none (or an older document). */
  let savedRevision = handle.writeSeq === null || opts.startup.migrated ? -1 : store.getState().revision;
  let forceDirty = false;
  /** Saving is stopped (conflict, open elsewhere, connection lost, deleted) until this is cleared. */
  let blocked: Blocked | null = opts.startup.openElsewhere === true ? { reason: 'elsewhere', message: OPEN_ELSEWHERE } : null;
  let saving: Promise<void> | null = null;
  /** A save was asked for while one ran: the next goes through the autosave schedule. */
  let saveAgain = false;
  /** The page was hidden while a save ran: the next starts as soon as that one ends (CR-01). */
  let flushAgain = false;
  /** Increases on every project switch; a save that finishes after one no longer speaks for the open project. */
  let generation = 0;
  let adopting = false;
  /** Any edit in this visit (in memory storage, all of it is lost when the page closes). */
  let editedThisVisit = false;
  let otherVersion: ProjectSummary | null = null;
  /** The open project's lock, held or waited for. */
  let lock: HeldLock | null = null;
  const problems = new Map<string, ProjectProblem>(opts.startup.problems);
  let summaries: ProjectSummary[] = [];

  const isDirty = (): boolean => forceDirty || store.getState().revision !== savedRevision;
  /** The save status now (read through a call, so an earlier check does not narrow it). */
  const saveKind = (): SaveStatus['kind'] => state.save.kind;
  const currentOf = (h: ProjectHandle): CurrentProject => ({ id: h.id, name: h.name, sample: h.sample, stored: h.writeSeq !== null });

  /** The status that follows from the session's own state (not from a save that just ran). */
  function baseStatus(): SaveStatus {
    if (blocked !== null) return { kind: 'failed', ...blocked, lastSavedAt: handle.savedAt };
    if (unavailable !== null) return { kind: 'unavailable', reason: unavailable };
    if (isDirty() || handle.savedAt === null) return { kind: 'pending' };
    return { kind: 'saved', at: handle.savedAt };
  }

  let state: ProjectSessionState = {
    storageKind: storage.kind,
    unavailable,
    current: currentOf(handle),
    save: baseStatus(),
    otherVersion: null,
    drift,
    projects: [],
    backups: [],
    sizes: null,
    notices: opts.startup.notices,
    busy: false,
  };

  function publish(patch: Partial<ProjectSessionState>): void {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  }

  /** The status to show; `unavailable` wins over everything but a failure (memory writes do not fail). */
  function setSave(save: SaveStatus): void {
    const next = unavailable !== null && save.kind !== 'failed' ? ({ kind: 'unavailable', reason: unavailable } as const) : save;
    const current = state.save;
    if (current.kind === next.kind && JSON.stringify(current) === JSON.stringify(next)) return;
    publish({ save: next });
  }

  function listItems(): ProjectListItem[] {
    return summaries.map((summary) => ({ ...summary, problem: problems.get(summary.id) ?? null }));
  }

  async function refresh(): Promise<void> {
    try {
      const [projects, backups] = await Promise.all([library.list(), library.listBackups()]);
      summaries = projects;
      publish({ projects: listItems(), backups });
    } catch (error: unknown) {
      // The start's own notice (what it did instead) says more; it stays.
      if (state.notices.some((n) => n.id === 'list-failed')) return;
      publish({ notices: [...state.notices, { id: 'list-failed', message: 'The stored projects could not be listed.', details: [errorText(error)] }] });
    }
  }

  /** A refresh after another tab's change; changes arriving meanwhile are taken by one more. */
  let refreshing: Promise<void> | null = null;
  let refreshAgain = false;
  function refreshSoon(): void {
    if (refreshing !== null) {
      refreshAgain = true;
      return;
    }
    refreshing = refresh().finally(() => {
      refreshing = null;
      if (refreshAgain) {
        refreshAgain = false;
        refreshSoon();
      }
    });
  }

  /** The quota failure in words: usage, what to do, and the largest records (CR-03). */
  async function quotaMessage(message: string): Promise<string> {
    const [estimate, measured] = await Promise.all([storage.estimate().catch(() => null), library.recordSizes().catch(() => null)]);
    const usage = estimate === null ? '' : ` (${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)} used)`;
    let largest = '';
    if (measured !== null && measured.length > 0) {
      publish({ sizes: Object.fromEntries(measured.map((m) => [m.id, m.bytes])) });
      const top = [...measured].sort((a, b) => b.bytes - a.bytes || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, 3);
      largest = ` The largest: ${top.map((m) => `“${m.name}”${m.kind === 'backup' ? ' in Recently deleted' : ''} (${formatStoredSize(m.bytes)})`).join(', ')}.`;
    }
    return `${message}${usage}. Delete projects or backups you no longer need, or export this project to keep it.${largest}`;
  }

  /** What a save of `project` stores: until the drift report is dismissed, the stored revision and prints. */
  function recordOf(project: ProjectV1): { readonly record: ProjectV1; readonly prints: DataPrints | null } {
    const dismissed = drift === null;
    const record: ProjectV1 = dismissed ? project : { ...project, dataRevision: handle.storedRevision };
    let prints: DataPrints | null;
    try {
      prints = dismissed ? dataPrintsOf(project, data.view(datasetViewInputOf(project))) : handle.prints;
    } catch {
      prints = null;
    }
    return { record, prints };
  }

  /** Another tab or window stored (`other`) or deleted (null) the open project: stop saving over it. */
  function conflictWith(other: ProjectSummary | null): void {
    autosave.cancel();
    otherVersion = other;
    blocked = { reason: 'conflict', message: other === null ? DELETED_ELSEWHERE : CHANGED_ELSEWHERE };
    publish({ otherVersion });
    setSave({ kind: 'failed', ...blocked, lastSavedAt: handle.savedAt });
  }

  /**
   * Saves the open project if anything is unsaved. Every storage request of the save is made before
   * this returns (CR-01).
   */
  function saveNow(): Promise<void> {
    if (saving !== null) {
      saveAgain = true;
      return saving;
    }
    if (!isDirty() || blocked !== null) return Promise.resolve();
    const { revision, project } = store.getState();
    const target = handle;
    const mine = generation;
    const { record, prints } = recordOf(project);
    const wasForced = forceDirty;
    // A failure stays on show while the save is tried again; only a success replaces it (CR-09).
    if (state.save.kind !== 'failed') setSave({ kind: 'saving' });
    let request: Promise<WriteOutcome>;
    try {
      request = library.write(target, record, prints);
    } catch (error: unknown) {
      request = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    const run = request.then(
      (outcome) => {
        if (mine !== generation) return;
        if (!outcome.ok) {
          conflictWith(outcome.current);
          return;
        }
        handle = { ...outcome.handle, name: handle.name };
        savedRevision = revision;
        if (wasForced) forceDirty = false;
        if (state.current.stored !== true) publish({ current: currentOf(handle) });
        if (state.sizes !== null) publish({ sizes: null });
        setSave(isDirty() ? { kind: 'pending' } : { kind: 'saved', at: outcome.handle.savedAt ?? clock.nowIso() });
        const index = summaries.findIndex((s) => s.id === outcome.summary.id);
        summaries = index === -1 ? [outcome.summary, ...summaries] : summaries.map((s, i) => (i === index ? outcome.summary : s));
        publish({ projects: listItems() });
      },
      async (error: unknown) => {
        if (mine !== generation) return;
        const failure = failureOf(error);
        if (failure.reason === 'closed') blocked = failure;
        const message = failure.reason === 'quota' ? await quotaMessage(failure.message) : failure.message;
        if (mine !== generation) return;
        setSave({ kind: 'failed', reason: failure.reason, message, lastSavedAt: handle.savedAt });
      },
    );
    saving = run.finally(afterSlot);
    return saving;
  }

  /**
   * Ends a save (or another write of the open project's record). A hide during it saves again at
   * once; otherwise a change still unsaved goes back on the autosave schedule, including after a
   * rename, which cancelled it (CR-04). A failed save is tried again by the next change, not in a
   * loop.
   */
  function afterSlot(): void {
    saving = null;
    const again = saveAgain;
    const hidden = flushAgain;
    saveAgain = false;
    flushAgain = false;
    if (!isDirty() || blocked !== null) return;
    if (hidden) {
      void saveNow();
      return;
    }
    if (again || state.save.kind !== 'failed') autosave.notify();
  }

  /**
   * Runs `body`, a write of the open project's record other than a save (rename, delete), while no
   * save runs: a save in between would carry a stale writeSeq and be refused as a conflict.
   * `body` must not save.
   */
  async function inSaveSlot<T>(body: () => Promise<T>): Promise<T> {
    autosave.cancel();
    while (saving !== null) await saving;
    const run = body();
    const slot = run.then(
      () => undefined,
      () => undefined,
    );
    saving = slot.finally(afterSlot);
    return run;
  }

  const autosave: Autosave = createAutosave(
    () => {
      void saveNow();
    },
    opts.host ?? browserAutosaveHost(),
    opts.timing ?? DEFAULT_AUTOSAVE_TIMING,
  );

  /** Holds the open project's lock (`claim`), or waits for it when another tab has the project. */
  function holdLock(id: ProjectId, claim: Claim): void {
    lock?.release();
    lock = claim.lock;
    if (claim.elsewhere && locks !== null) {
      const mine = generation;
      lock = locks.wait(projectLockName(id), () => {
        if (mine === generation) lockFreed();
      });
    }
  }

  /** The other tab let the project go (it closed, or opened another): this tab saves it again. */
  function lockFreed(): void {
    if (blocked?.reason !== 'elsewhere') return;
    blocked = null;
    resumeSaving();
  }

  function resumeSaving(): void {
    if (isDirty()) {
      setSave({ kind: 'pending' });
      autosave.notify();
    } else {
      setSave(baseStatus());
    }
  }

  /** Another tab changed storage: a change to the open project may stop this tab saving over it. */
  function changedElsewhere(change: Extract<StorageChange, { kind: 'project' }>): void {
    if (change.id !== handle.id || blocked?.reason === 'closed') return;
    if (change.index === null) {
      conflictWith(null);
      return;
    }
    if (change.index.writeSeq === handle.writeSeq) return;
    if (change.nameOnly && change.previousSeq === handle.writeSeq) {
      // A rename there: nothing this tab would save is overwritten; take the name and carry on.
      handle = { ...handle, name: change.index.name, writeSeq: change.index.writeSeq };
      publish({ current: currentOf(handle) });
      return;
    }
    conflictWith(projectSummaryOf(change.index));
  }

  holdLock(handle.id, { lock: opts.startup.lock ?? null, elsewhere: opts.startup.openElsewhere === true });

  const unsubscribeChannel =
    channel?.subscribe((change) => {
      if (change.kind === 'project') changedElsewhere(change);
      refreshSoon();
    }) ?? null;

  const unsubscribeStore = store.subscribe(() => {
    if (adopting || !isDirty()) return;
    editedThisVisit = true;
    if (blocked !== null) return;
    // A failure stays on show until a save succeeds; the next attempt is scheduled all the same.
    if (state.save.kind !== 'saving' && state.save.kind !== 'failed') setSave({ kind: 'pending' });
    autosave.notify();
  });

  const unsubscribeLifecycle =
    opts.lifecycle?.onHide(() => {
      autosave.cancel();
      // A save already running took the state of its moment: the next starts as soon as it ends.
      if (saving !== null) flushAgain = true;
      else void saveNow();
    }) ?? null;

  /** Whether closing the page now would lose changes: they cannot be saved, or nothing outlives the page. */
  const unkept = (): boolean => (unavailable !== null ? editedThisVisit : isDirty() && (blocked !== null || state.save.kind === 'failed'));
  const unsubscribeUnload = opts.lifecycle?.onBeforeUnload?.(unkept) ?? null;

  /** Saves before the open project is left; fails when changes would be lost. */
  async function leaveCurrent(): Promise<SessionResult> {
    autosave.cancel();
    while (saving !== null) await saving;
    await saveNow();
    if (!isDirty()) return ok('');
    const why = state.save.kind === 'failed' ? state.save.message : 'The changes could not be saved';
    return fail(`The open project has unsaved changes: ${why}. Export it, or duplicate it as a copy, before opening another project.`);
  }

  /**
   * Makes `project` the open project. `claim`: its lock, or that another tab has it (then saving
   * waits for the user's choice, unless `anyway`). False when the store refuses (an edit lock is held).
   */
  function adopt(project: ProjectV1, next: ProjectHandle, nextDrift: DriftReport | null, dirty: boolean, claim: Claim, anyway = false): boolean {
    adopting = true;
    let replaced: boolean;
    try {
      replaced = store.replaceProject(withLoadedRevision(project, nextDrift));
    } finally {
      adopting = false;
    }
    if (!replaced) {
      claim.lock?.release();
      return false;
    }
    generation += 1;
    autosave.cancel();
    handle = next;
    drift = nextDrift;
    blocked = claim.elsewhere && !anyway ? { reason: 'elsewhere', message: OPEN_ELSEWHERE } : null;
    forceDirty = false;
    flushAgain = false;
    otherVersion = null;
    savedRevision = dirty ? -1 : store.getState().revision;
    holdLock(next.id, claim);
    publish({ current: currentOf(handle), drift, otherVersion: null, save: baseStatus() });
    if (dirty && blocked === null) autosave.notify();
    return true;
  }

  function driftOf(project: ProjectV1, h: ProjectHandle): DriftReport | null {
    return checkDrift({ project, storedRevision: h.storedRevision, view: data.view(datasetViewInputOf(project)), prints: h.prints });
  }

  let queue: Promise<unknown> = Promise.resolve();
  function exclusive(body: () => Promise<SessionResult>): Promise<SessionResult> {
    const run = queue.then(async () => {
      publish({ busy: true });
      try {
        return await body();
      } catch (error: unknown) {
        return fail(`Something went wrong: ${errorText(error)}`);
      } finally {
        publish({ busy: false });
      }
    });
    queue = run.catch(() => undefined);
    return run;
  }

  const locked = (): boolean => store.getState().editingLocked;

  /** Writes a new record for `project` (its id must be unused). */
  async function writeNew(project: ProjectV1, name: string, sample: boolean, prints: DataPrints | null): Promise<ProjectHandle> {
    const outcome = await library.write({ name, sample, writeSeq: null }, project, prints);
    if (!outcome.ok) throw new Error('A project with this id already exists');
    return outcome.handle;
  }

  const printsNow = (project: ProjectV1): DataPrints => dataPrintsOf(project, data.view(datasetViewInputOf(project)));

  const nameOf = (id: string): string => summaries.find((s) => s.id === id)?.name ?? 'The project';

  async function openLoaded(id: string, claim: Claim, anyway = false): Promise<SessionResult> {
    const loaded = await library.load(id);
    if (!loaded.ok) {
      claim.lock?.release();
      problems.set(id, problemOf(loaded));
      await refresh();
      return fail(`The project could not be opened: ${loaded.message}.`, loaded.errors);
    }
    problems.delete(id);
    if (!adopt(loaded.project, loaded.handle, driftOf(loaded.project, loaded.handle), loaded.migratedFrom !== null, claim, anyway)) return fail(LOCKED_MESSAGE);
    await library.setLastProjectId(id).catch(() => undefined);
    await refresh();
    const migrated = loaded.migratedFrom === null ? '' : ` It was migrated from schema version ${String(loaded.migratedFrom)}; the original is in Recently deleted.`;
    const elsewhere = !claim.elsewhere
      ? ''
      : anyway
        ? ' It is open in another tab or window too; if that one saves it first, this tab says so before saving over it.'
        : ' It is open in another tab or window, so this tab does not save it until you choose: open it anyway, or open a copy.';
    return ok(`Opened “${loaded.handle.name}”.${migrated}${elsewhere}`);
  }

  /**
   * After the open project was deleted: the most recently updated other project that opens. With
   * no stored project left, the sample (as at a first start); with only projects that do not open,
   * a new empty project.
   */
  async function openFallback(): Promise<string> {
    const stored = await library.list().catch((): ProjectSummary[] => []);
    for (const summary of stored.filter((s) => !problems.has(s.id))) {
      const result = await openLoaded(summary.id, await claimProject(locks, summary.id));
      if (result.ok) return `“${summary.name}” is open now.`;
    }
    const sample = stored.length === 0;
    const base = sample ? opts.createSample() : emptyProject(collisionFreeIds(ids, store.getState().project), clock, data);
    const project: ProjectV1 = sample ? { ...base, id: projectId(collisionFreeIds(ids, base).next('project')) } : base;
    const name = sample ? opts.sampleName : NEW_PROJECT_NAME;
    let next = unsavedHandle(project, name, sample);
    try {
      next = await writeNew(project, name, sample, printsNow(project));
    } catch {
      // Stays unsaved; the next change tries again.
    }
    adopt(project, next, null, next.writeSeq === null, await claimProject(locks, project.id));
    await library.setLastProjectId(project.id).catch(() => undefined);
    return sample ? 'No project was left, so the sample project is open.' : `No other project could be opened, so “${name}” was started.`;
  }

  /**
   * Stores `source` as a new project (a new id; nothing else changes) and opens it. `checked`: it
   * already passed the project schema (a parsed file); otherwise it is checked here first.
   */
  async function storeImported(source: ProjectV1, name: string, checked: boolean): Promise<SessionResult> {
    let project: ProjectV1 = { ...source, id: projectId(collisionFreeIds(ids, source).next('project')) };
    if (!checked) {
      // A project built elsewhere (an RXP lowering) must be one the next start can open (CR-11).
      const parsed = parseProject(project);
      if (!parsed.ok) return fail(`“${name}” could not be imported: it is not a valid project, so nothing was stored.`, parsed.errors);
      project = parsed.project;
    }
    let next: ProjectHandle;
    try {
      // Nothing is known about the data it was made with, so there are no prints.
      next = await writeNew(project, name, false, null);
    } catch (error: unknown) {
      return fail(`“${name}” could not be saved: ${errorText(error)}.`);
    }
    const left = await leaveCurrent();
    if (!left.ok) {
      await refresh();
      return fail(`Imported “${name}” but did not open it. ${left.message}`);
    }
    if (!adopt(project, next, driftOf(project, next), false, await claimProject(locks, project.id))) return fail(LOCKED_MESSAGE);
    await library.setLastProjectId(project.id).catch(() => undefined);
    await refresh();
    return ok(`Imported “${name}” as a new project and opened it.`);
  }

  /** The open project as an export records it (the stored revision while the drift report is pending). */
  const exportable = (): ProjectV1 => {
    const project = store.getState().project;
    return drift === null ? project : { ...project, dataRevision: handle.storedRevision };
  };

  /** Removes the open project from storage, keeping in the backups what `permanently` does not drop. */
  async function removeOpen(permanently: boolean): Promise<BackupSummary | null> {
    if (permanently) {
      await library.deletePermanently(handle.id);
      return null;
    }
    if (!isDirty() && handle.writeSeq !== null) return library.moveToBackup(handle.id, 'deleted');
    // The latest changes are only in this page: they go to Recently deleted from here (CR-05).
    const { record, prints } = recordOf(store.getState().project);
    const own = library.backupOf(record, handle, prints, 'deleted');
    // What is stored is another tab's version when this tab stopped saving because of it: keep it too.
    const theirs = blocked !== null && (blocked.reason === 'conflict' || blocked.reason === 'elsewhere');
    if (theirs) await library.moveToBackup(handle.id, 'deleted', [own.row]);
    else await library.deletePermanently(handle.id, [own.row]);
    return own.summary;
  }

  /** After space was freed while the open project's save failed for lack of it: save again now. */
  async function saveAfterFreeing(): Promise<string> {
    if (state.save.kind !== 'failed' || state.save.reason !== 'quota' || blocked !== null) return '';
    while (saving !== null) await saving;
    await saveNow();
    return saveKind() === 'saved' ? ' The open project is saved now.' : '';
  }

  const keptUntil = (backup: BackupSummary): string =>
    unavailable !== null ? 'until this tab closes' : `until ${localDay(backup.purgeAfter)}`;

  const session: ProjectSession = {
    getState: () => state,

    subscribe(listener) {
      const entry = () => listener();
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },

    refresh,

    async flush() {
      autosave.cancel();
      while (saving !== null) await saving;
      await saveNow();
      return state.save;
    },

    overwriteStored: () =>
      exclusive(async () => {
        while (saving !== null) await saving;
        if (blocked?.reason !== 'conflict') return ok('Nothing to overwrite.');
        let stored: ProjectSummary | null;
        try {
          stored = await library.summary(handle.id);
        } catch (error: unknown) {
          return fail(`Nothing was overwritten: the stored version could not be read (${errorText(error)}).`);
        }
        // The stored name and sample flag stay: a rename made in the other tab is kept.
        handle = stored === null ? { ...handle, writeSeq: null } : { ...handle, writeSeq: stored.writeSeq, name: stored.name, sample: stored.sample };
        blocked = null;
        otherVersion = null;
        forceDirty = true;
        publish({ current: currentOf(handle), otherVersion: null });
        await saveNow();
        return state.save.kind === 'failed' ? fail(`Not saved: ${state.save.message}`) : ok(`Saved this version of “${handle.name}” over the other one.`);
      }),

    openAnyway: () =>
      exclusive(() => {
        if (blocked?.reason !== 'elsewhere') return Promise.resolve(ok(`“${handle.name}” is open.`));
        // The lock is still waited for: once the other tab lets it go, this one holds it.
        blocked = null;
        resumeSaving();
        return Promise.resolve(ok(`“${handle.name}” is open here too, and this tab saves it. If the other tab saves it first, this tab says so before saving over it.`));
      }),

    newProject: (name = NEW_PROJECT_NAME) =>
      exclusive(async () => {
        if (locked()) return fail(LOCKED_MESSAGE);
        const clean = cleanProjectName(name);
        if (clean === null) return fail('A project needs a name.');
        const left = await leaveCurrent();
        if (!left.ok) return left;
        const project = emptyProject(collisionFreeIds(ids, store.getState().project), clock, data);
        let next = unsavedHandle(project, clean, false);
        let note = '';
        try {
          next = await writeNew(project, clean, false, printsNow(project));
        } catch (error: unknown) {
          note = ` It is not saved yet: ${errorText(error)}.`;
        }
        if (!adopt(project, next, null, next.writeSeq === null, await claimProject(locks, project.id))) return fail(LOCKED_MESSAGE);
        await library.setLastProjectId(project.id).catch(() => undefined);
        await refresh();
        return ok(`New project “${clean}” is open.${note}`);
      }),

    openProject: (id, openOpts = {}) =>
      exclusive(async () => {
        if (id === handle.id) return ok(`“${handle.name}” is already open.`);
        if (locked()) return fail(LOCKED_MESSAGE);
        const anyway = openOpts.anyway ?? false;
        const claim = await claimProject(locks, id);
        if (claim.elsewhere && !anyway) {
          return { ok: false, message: `“${nameOf(id)}” is open in another tab or window. Open it here anyway, or open a copy of it.`, errors: [], openElsewhere: id };
        }
        const left = await leaveCurrent();
        if (!left.ok) {
          claim.lock?.release();
          return left;
        }
        return openLoaded(id, claim, anyway);
      }),

    renameProject: (id, name) =>
      exclusive(async () => {
        const clean = cleanProjectName(name);
        if (clean === null) return fail('A project needs a name.');
        if (id === handle.id) {
          const renamed = await inSaveSlot(async () => {
            if (handle.writeSeq === null) {
              // Not stored yet: the first save writes the name.
              handle = { ...handle, name: clean };
              return true;
            }
            const outcome = await library.rename(id, clean, handle.writeSeq);
            if (!outcome.ok) return false;
            handle = { ...handle, name: clean, writeSeq: outcome.summary.writeSeq };
            return true;
          });
          if (!renamed) return fail('The project was changed in another tab or window; it was not renamed.');
          publish({ current: currentOf(handle) });
          await refresh();
          return ok(`Renamed to “${clean}”.`);
        }
        const summary = summaries.find((s) => s.id === id);
        if (summary === undefined) return fail('The project is no longer in storage.');
        const outcome = await library.rename(id, clean, summary.writeSeq);
        await refresh();
        return outcome.ok ? ok(`Renamed to “${clean}”.`) : fail('The project was changed in another tab or window; it was not renamed.');
      }),

    duplicateProject: (id, dupOpts = {}) =>
      exclusive(async () => {
        const open = dupOpts.open ?? false;
        if (open && locked()) return fail(LOCKED_MESSAGE);
        let source: { readonly project: ProjectV1; readonly handle: ProjectHandle };
        if (id === handle.id) {
          source = { project: store.getState().project, handle };
        } else {
          const loaded = await library.load(id);
          if (!loaded.ok) return fail(`The project could not be copied: ${loaded.message}.`, loaded.errors);
          source = loaded;
        }
        const name = cleanProjectName(`${source.handle.name} (copy)`) ?? NEW_PROJECT_NAME;
        const now = clock.nowIso();
        const fresh = collisionFreeIds(ids, source.project).next('project');
        // The copy keeps the data revision and prints of what it copies, so a pending drift report
        // follows it: nothing is acknowledged by copying.
        const isOpen = id === handle.id;
        const storedRevision = isOpen && drift !== null ? handle.storedRevision : isOpen ? source.project.dataRevision : source.handle.storedRevision;
        const copy: ProjectV1 = { ...source.project, id: projectId(fresh), createdAt: now, updatedAt: now, dataRevision: storedRevision };
        const prints = isOpen && drift === null ? printsNow(copy) : source.handle.prints;
        let next: ProjectHandle;
        try {
          next = await writeNew(copy, name, source.handle.sample, prints);
        } catch (error: unknown) {
          return fail(`The copy could not be saved: ${errorText(error)}.`);
        }
        if (open) {
          // The open project's unsaved changes live on in the copy; the original stays as stored.
          if (!isOpen) {
            const left = await leaveCurrent();
            if (!left.ok) {
              await refresh();
              return fail(`“${name}” was saved but not opened. ${left.message}`);
            }
          }
          if (!adopt(copy, next, driftOf(copy, next), false, await claimProject(locks, copy.id))) return fail(LOCKED_MESSAGE);
          await library.setLastProjectId(copy.id).catch(() => undefined);
        }
        await refresh();
        return ok(open ? `“${name}” is open.` : `Saved a copy: “${name}”.`);
      }),

    deleteProject: (id, delOpts = {}) =>
      exclusive(async () => {
        const permanently = delOpts.permanently ?? false;
        const isOpen = id === handle.id;
        if (isOpen && locked()) return fail(LOCKED_MESSAGE);
        const name = isOpen ? handle.name : nameOf(id);
        let backup: BackupSummary | null;
        try {
          if (isOpen) {
            autosave.cancel();
            // The backup takes the latest changes: saved first when they can be, otherwise from here.
            if (!permanently && blocked === null) {
              while (saving !== null) await saving;
              await saveNow();
            }
            backup = await inSaveSlot(async () => {
              const kept = await removeOpen(permanently);
              // Nothing more of the deleted project may be saved, not even by a hide during this.
              generation += 1;
              blocked = { reason: 'error', message: 'The project was deleted' };
              return kept;
            });
          } else if (permanently) {
            await library.deletePermanently(id);
            backup = null;
          } else {
            backup = await library.moveToBackup(id, 'deleted');
          }
        } catch (error: unknown) {
          const failure = failureOf(error);
          const hint = failure.reason === 'quota' && !permanently ? ' Storage is full: delete it permanently to free the space, or export it first.' : '';
          return fail(`“${name}” could not be deleted: ${failure.message}.${hint}`);
        }
        problems.delete(id);
        const kept = permanently ? '' : backup === null ? '' : ` It is kept in Recently deleted ${keptUntil(backup)}.`;
        const then = isOpen ? ` ${await openFallback()}` : '';
        await refresh();
        const saved = isOpen ? '' : await saveAfterFreeing();
        return ok(`Deleted “${name}”${permanently ? ' permanently' : ''}.${kept}${then}${saved}`);
      }),

    restoreBackup: (backupId) =>
      exclusive(async () => {
        let restored: ProjectSummary | null;
        try {
          restored = await library.restoreBackup(backupId);
        } catch (error: unknown) {
          return fail(`The backup could not be restored: ${errorText(error)}.`);
        }
        await refresh();
        return restored === null ? fail('The backup is no longer there.') : ok(`Restored “${restored.name}”. Open it from the project list.`);
      }),

    deleteBackup: (backupId) =>
      exclusive(async () => {
        const name = state.backups.find((b) => b.id === backupId)?.project.name ?? 'The backup';
        try {
          await library.deleteBackup(backupId);
        } catch (error: unknown) {
          return fail(`“${name}” could not be deleted from Recently deleted: ${errorText(error)}.`);
        }
        await refresh();
        const saved = await saveAfterFreeing();
        return ok(`Deleted “${name}” from Recently deleted permanently.${saved}`);
      }),

    importProjectText: (text, fileName) =>
      exclusive(async () => {
        if (locked()) return fail(LOCKED_MESSAGE);
        const parsed = parseProjectText(text);
        if (!parsed.ok) return fail(`“${fileName}” is not a project file this app can open.`, parsed.errors);
        const name = projectNameFromFileName(fileName) ?? cleanProjectName(parsed.project.route.name) ?? 'Imported project';
        return storeImported(parsed.project, name, true);
      }),

    importProject: (project, name) =>
      exclusive(async () => {
        if (locked()) return fail(LOCKED_MESSAGE);
        return storeImported(project, cleanProjectName(name) ?? cleanProjectName(project.route.name) ?? 'Imported project', false);
      }),

    exportCurrent: () => exportProjectFile(exportable(), handle.name),

    async exportStored(id) {
      if (id === handle.id) return { file: exportProjectFile(exportable(), handle.name), validated: true };
      const read = await library.readDocument(id);
      if (read === null) return null;
      const parsed = parseProject(read.document);
      if (parsed.ok) return { file: exportProjectFile(parsed.project, read.summary.name), validated: true };
      let text: string;
      try {
        text = `${JSON.stringify(read.document, null, 2)}\n`;
      } catch {
        return null;
      }
      return { file: { fileName: projectFileName(read.summary.name), text, mimeType: PROJECT_FILE_MIME }, validated: false };
    },

    acknowledgeDrift() {
      if (drift === null) return;
      handle = { ...handle, storedRevision: drift.loadedRevision };
      drift = null;
      forceDirty = true;
      publish({ drift: null });
      if (blocked === null) {
        setSave({ kind: 'pending' });
        autosave.notify();
      }
    },

    storageLost(reason) {
      autosave.cancel();
      blocked = { reason: 'closed', message: reason };
      setSave({ kind: 'failed', ...blocked, lastSavedAt: handle.savedAt });
    },

    dismissNotice(id) {
      const notices = state.notices.filter((n) => n.id !== id);
      if (notices.length !== state.notices.length) publish({ notices });
    },

    dispose() {
      autosave.cancel();
      unsubscribeStore();
      unsubscribeLifecycle?.();
      unsubscribeUnload?.();
      unsubscribeChannel?.();
      lock?.release();
      lock = null;
      listeners.clear();
    },
  };

  // The start may have left work: a migrated project, or one whose first save failed.
  if (isDirty() && blocked === null) autosave.notify();
  return session;
}

export { createProjectLibrary };

export type { ProjectHandle, ProjectLibrary } from './project-library';
