import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  BACKUP_RETENTION_DAYS,
  type BackupSummary,
  canRetryOpen,
  type DownloadFile,
  type DriftReport,
  formatStoredSize,
  type ProjectIssue,
  type ProjectListItem,
  type ProjectSession,
  type ProjectSessionState,
  type ProjectSummary,
  type SessionResult,
} from '../../app/persistence';
import type { ProjectId, QuestId } from '../../domain/ids';
import { formatInteger, plural } from '../lib/format';
import { cx } from '../lib/cx';
import { SeverityIcon } from '../markers/SeverityIcon';
import { PlaceholderTag, VisuallyHidden } from '../primitives/Badge';
import { Button } from '../primitives/Button';
import type { IconName } from '../primitives/Icon';
import { TextInput } from '../primitives/TextInput';
import { downloadFile } from './ImportExport';
import type { Announce } from './LiveAnnouncer';
import { describeSave, formatDay, formatSavedTime, type ProjectsDialogMode } from './ProjectMenu';
import { ModalDialog } from './ProjectMenuDialog';
import './ProjectMenu.css';

/**
 * The Projects dialog and the drift report (ARCHITECTURE §12.3, docs/UI.md §13), loaded on first
 * use in the lazy parts' chunk (`lazy-parts.ts`; docs/research/ui-refresh.md §10.3's reserve): the
 * route name's Projects menu and the project bar open them (`ProjectMenu.tsx`), which stay in the
 * entry chunk. Everything reads the project session; nothing here touches storage itself.
 */

const BUSY_REASON = 'Wait for the current operation to finish';

type Mode =
  | { readonly kind: 'list' }
  | { readonly kind: 'rename'; readonly id: ProjectId; readonly draft: string }
  | { readonly kind: 'delete'; readonly id: ProjectId }
  | { readonly kind: 'delete-backup'; readonly id: string }
  | { readonly kind: 'overwrite' }
  | { readonly kind: 'new'; readonly draft: string };

const LIST: Mode = { kind: 'list' };

interface ActionProps {
  readonly busy: boolean;
  readonly onClick: () => void;
  readonly variant?: 'primary' | 'default' | 'ghost' | undefined;
  /** A destructive action: the danger variant, never the primary (docs/UI.md §13; ui-refresh.md §7.1). */
  readonly destructive?: boolean | undefined;
  /** A leading icon; a destructive action has the delete icon unless this says otherwise (null: none). */
  readonly icon?: IconName | null | undefined;
  /** Names the button so focus can come back to it after an inline step (`data-focus-key`). */
  readonly focusKey?: string | undefined;
  readonly buttonRef?: ((element: HTMLButtonElement | null) => void) | undefined;
  readonly children: ReactNode;
}

/** A small button that is aria-disabled, with the reason, while an operation runs. */
function Action({ busy, onClick, variant = 'default', destructive = false, icon, focusKey, buttonRef, children }: ActionProps) {
  return (
    <Button
      ref={buttonRef}
      size="sm"
      variant={destructive ? 'danger' : variant}
      icon={icon === null ? undefined : (icon ?? (destructive ? 'delete' : undefined))}
      data-focus-key={focusKey}
      aria-disabled={busy ? true : undefined}
      title={busy ? BUSY_REASON : undefined}
      onClick={() => {
        if (!busy) onClick();
      }}
    >
      {children}
    </Button>
  );
}

function IssueList({ errors, limit = 50 }: { readonly errors: readonly ProjectIssue[]; readonly limit?: number }) {
  if (errors.length === 0) return null;
  return (
    <ul className="frl-projects__issues">
      {errors.slice(0, limit).map((issue, i) => (
        <li key={`${issue.path}-${String(i)}`}>
          <code>{issue.path === '' ? '(the whole file)' : issue.path}</code>: {issue.message}
        </li>
      ))}
      {errors.length > limit && <li>… and {plural(errors.length - limit, 'more problem', 'more problems')}</li>}
    </ul>
  );
}

const shortRevision = (revision: string): string => revision.slice(0, 8);

/** " · about 8.0 MB" once sizes were measured (storage is full), else nothing. */
const sizeText = (sizes: ProjectSessionState['sizes'], id: string): string => {
  const bytes = sizes?.[id];
  return bytes === undefined ? '' : ` · about ${formatStoredSize(bytes)}`;
};

function projectMeta(item: Pick<ProjectListItem, 'id' | 'stepCount' | 'updatedAt' | 'dataRevision'>, sizes: ProjectSessionState['sizes']): string {
  return `${plural(item.stepCount, 'step', 'steps')} · updated ${formatSavedTime(item.updatedAt)} · data ${shortRevision(item.dataRevision)}${sizeText(sizes, item.id)}`;
}

/** Moves focus to the element once it mounts (a callback ref, stable across renders). */
function useFocusOnMount<T extends HTMLElement>(): (element: T | null) => void {
  return useCallback((element: T | null) => {
    element?.focus();
  }, []);
}

interface NameFormProps {
  readonly label: string;
  readonly draft: string;
  readonly submitLabel: string;
  readonly busy: boolean;
  readonly onDraft: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}

function NameForm({ label, draft, submitLabel, busy, onDraft, onSubmit, onCancel }: NameFormProps) {
  const focus = useFocusOnMount<HTMLInputElement>();
  return (
    <div className="frl-projects__form">
      <TextInput label={label} value={draft} onChange={onDraft} onSubmit={onSubmit} inputRef={focus} className="frl-projects__name-input" />
      <Action busy={busy} variant="primary" onClick={onSubmit}>
        {submitLabel}
      </Action>
      <Action busy={false} onClick={onCancel}>
        Cancel
      </Action>
    </div>
  );
}

/** An inline confirmation: what happens, in words, the destructive choices, and Cancel (focused). */
function Confirm({ label, children, actions, onCancel }: { readonly label: string; readonly children: ReactNode; readonly actions: ReactNode; readonly onCancel: () => void }) {
  const focus = useFocusOnMount<HTMLButtonElement>();
  return (
    <div className="frl-projects__confirm" role="group" aria-label={label}>
      <p>{children}</p>
      {actions}
      <Action busy={false} buttonRef={focus} onClick={onCancel}>
        Cancel
      </Action>
    </div>
  );
}

/** What deleting the open project opens instead, as the session's fallback will choose it. */
function nextAfterDelete(state: ProjectSessionState): string {
  const others = state.projects.filter((p) => p.id !== state.current.id);
  const next = others.find((p) => p.problem === null);
  if (next !== undefined) return `opens “${next.name}”`;
  return others.length === 0 ? 'opens the sample project' : 'starts a new empty project';
}

interface DeleteConfirmProps {
  readonly name: string;
  readonly busy: boolean;
  /** Where the project goes: Recently deleted lasts 30 days, or only until the tab closes (memory storage). */
  readonly unavailable: boolean;
  /** For the open project: what opens instead ("opens “Durotar run”"); null for another project. */
  readonly then: string | null;
  readonly onConfirm: () => void;
  readonly onPermanently: () => void;
  readonly onCancel: () => void;
}

function DeleteConfirm({ name, busy, unavailable, then, onConfirm, onPermanently, onCancel }: DeleteConfirmProps) {
  const kept = unavailable
    ? 'It moves to Recently deleted, which is kept only until this tab closes.'
    : `It moves to Recently deleted and is kept there for ${String(BACKUP_RETENTION_DAYS)} days.`;
  return (
    <Confirm
      label={`Delete “${name}”?`}
      onCancel={onCancel}
      actions={
        <>
          <Action busy={busy} destructive onClick={onConfirm}>
            Delete
          </Action>
          <Action busy={busy} destructive onClick={onPermanently}>
            Delete permanently
          </Action>
        </>
      }
    >
      Delete “{name}”? {kept}
      {then !== null && ` This closes it and ${then}.`} “Delete permanently” removes it now, with no copy to restore.
    </Confirm>
  );
}

/** The version another tab stored, in words: "saved 12:05, 42 steps". */
function otherVersionText(other: ProjectSummary): string {
  return `saved ${formatSavedTime(other.savedAt)}, ${plural(other.stepCount, 'step', 'steps')}`;
}

export interface ProjectMenuDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly session: ProjectSession;
  readonly state: ProjectSessionState;
  readonly announce?: Announce | undefined;
  readonly download?: ((file: DownloadFile) => void) | undefined;
  /**
   * The step the dialog opens in (the Projects menu's item): the list (default), New, Rename or
   * Delete of the open project, or the list with focus on Recently deleted.
   */
  readonly initial?: ProjectsDialogMode | undefined;
}

/** The inline step a menu item opens, and the key of the button that step returns focus to. */
function initialStep(initial: ProjectsDialogMode, current: ProjectSessionState['current']): { readonly mode: Mode; readonly key: string | null } {
  switch (initial) {
    case 'new':
      return { mode: { kind: 'new', draft: 'New project' }, key: 'new' };
    case 'rename':
      return { mode: { kind: 'rename', id: current.id, draft: current.name }, key: `rename:${current.id}` };
    case 'delete':
      return { mode: { kind: 'delete', id: current.id }, key: `delete:${current.id}` };
    case 'list':
    case 'deleted':
      return { mode: LIST, key: null };
  }
}

interface Failure {
  readonly message: string;
  readonly errors: readonly ProjectIssue[];
  /** The project a refused open was about, when another tab has it open. */
  readonly openElsewhere: ProjectId | null;
}

/** The Projects dialog: the open project, the other stored projects, recently deleted ones, and notices. */
export function ProjectMenuDialog({ open, onClose, session, state, announce, download = downloadFile, initial = 'list' }: ProjectMenuDialogProps) {
  const [mode, setMode] = useState<Mode>(LIST);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [openedFor, setOpenedFor] = useState<ProjectsDialogMode | null>(null);
  const listHeadingId = useId();
  const failureRef = useRef<HTMLDivElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const deletedHeadingRef = useRef<HTMLHeadingElement>(null);
  /** The `data-focus-key` of the button that opened the inline step (UI review F3). */
  const returnFocus = useRef<string | null>(null);
  const busy = state.busy;
  const current = state.current;
  const save = describeSave(state.save);

  // Opening from a menu item starts in its step (set while rendering, so the list never flashes);
  // leaving the step returns focus to the button that opens the same step in the dialog.
  const wanted = open ? initial : null;
  if (wanted !== openedFor) {
    setOpenedFor(wanted);
    if (wanted !== null) setMode(initialStep(wanted, current).mode);
  }
  const openedKey = wanted === null ? null : initialStep(wanted, current).key;
  useLayoutEffect(() => {
    if (openedKey !== null) returnFocus.current = openedKey;
  }, [openedKey]);
  useEffect(() => {
    if (open && initial === 'deleted') deletedHeadingRef.current?.focus();
  }, [open, initial]);

  useEffect(() => {
    if (open) void session.refresh();
  }, [open, session]);

  useEffect(() => {
    if (failure !== null) failureRef.current?.focus();
  }, [failure]);

  // Back in the list: focus the button that opened the step, found again by its key because the
  // list re-rendered (the row may even have a new name); the list heading when it is gone.
  useEffect(() => {
    if (mode.kind !== 'list') return;
    const key = returnFocus.current;
    returnFocus.current = null;
    if (key === null) return;
    const dialog = listHeadingRef.current?.closest('dialog');
    const target = [...(dialog?.querySelectorAll<HTMLElement>('[data-focus-key]') ?? [])].find((element) => element.dataset['focusKey'] === key);
    if (target !== undefined) target.focus();
    else listHeadingRef.current?.focus();
  }, [mode]);

  const enter = (next: Mode, key: string) => {
    returnFocus.current = key;
    setMode(next);
  };

  const leave = () => {
    setMode(LIST);
  };

  /**
   * Runs an operation and announces its result. On success the inline step closes (focus returns
   * to its opener). On failure the message takes focus; the step stays open with what was typed
   * (`keep`), or closes without moving focus back.
   */
  const run = async (operation: () => Promise<SessionResult>, keep = false) => {
    const result = await operation();
    announce?.(result.message);
    if (result.ok) {
      setFailure(null);
      setMode(LIST);
      return result;
    }
    setFailure({ message: result.message, errors: result.errors, openElsewhere: result.openElsewhere ?? null });
    if (!keep) {
      returnFocus.current = null;
      setMode(LIST);
    }
    return result;
  };

  const close = () => {
    setMode(LIST);
    setFailure(null);
    onClose();
  };

  const closeOnSuccess = (result: SessionResult) => {
    if (result.ok) close();
  };

  const exportProject = async (id: ProjectId, name: string) => {
    const exported = id === current.id ? { file: session.exportCurrent(), validated: true } : await session.exportStored(id);
    if (exported === null) {
      announce?.(`“${name}” could not be exported.`);
      return;
    }
    download(exported.file);
    announce?.(exported.validated ? `Exported “${exported.file.fileName}”.` : `Exported “${exported.file.fileName}” as it is stored, without checking it.`);
  };

  const renderRowActions = (id: ProjectId, name: string, problem: ProjectListItem['problem']): ReactNode => {
    if (mode.kind === 'rename' && mode.id === id) {
      return (
        <NameForm
          label={`New name for “${name}”`}
          draft={mode.draft}
          submitLabel="Rename"
          busy={busy}
          onDraft={(draft) => {
            setMode({ ...mode, draft });
          }}
          onSubmit={() => void run(() => session.renameProject(id, mode.draft), true)}
          onCancel={leave}
        />
      );
    }
    if (mode.kind === 'delete' && mode.id === id) {
      const isOpen = id === current.id;
      return (
        <DeleteConfirm
          name={name}
          busy={busy}
          unavailable={state.unavailable !== null}
          then={isOpen ? nextAfterDelete(state) : null}
          onConfirm={() => void run(() => session.deleteProject(id), true)}
          onPermanently={() => void run(() => session.deleteProject(id, { permanently: true }), true)}
          onCancel={leave}
        />
      );
    }
    const isOpen = id === current.id;
    const openable = problem === null;
    const retryable = problem !== null && canRetryOpen(problem);
    return (
      <div className="frl-projects__actions">
        {!isOpen && (openable || retryable) && (
          <Action busy={busy} variant="primary" focusKey={`open:${id}`} onClick={() => void run(() => session.openProject(id)).then(closeOnSuccess)}>
            {retryable ? 'Try opening again' : 'Open'}
            <VisuallyHidden> “{name}”</VisuallyHidden>
          </Action>
        )}
        <Action busy={busy} focusKey={`rename:${id}`} onClick={() => enter({ kind: 'rename', id, draft: name }, `rename:${id}`)}>
          Rename<VisuallyHidden> “{name}”</VisuallyHidden>
        </Action>
        {openable && (
          <Action busy={busy} focusKey={`duplicate:${id}`} onClick={() => void run(() => session.duplicateProject(id))}>
            Duplicate<VisuallyHidden> “{name}”</VisuallyHidden>
          </Action>
        )}
        <Action busy={busy} focusKey={`export:${id}`} onClick={() => void exportProject(id, name)}>
          Export<VisuallyHidden> “{name}”</VisuallyHidden>
        </Action>
        <Action busy={busy} focusKey={`delete:${id}`} onClick={() => enter({ kind: 'delete', id }, `delete:${id}`)}>
          Delete<VisuallyHidden> “{name}”</VisuallyHidden>
        </Action>
      </div>
    );
  };

  const others = state.projects.filter((p) => p.id !== current.id);
  const failedReason = state.save.kind === 'failed' ? state.save.reason : null;
  const conflict = failedReason === 'conflict';
  const elsewhere = failedReason === 'elsewhere';
  const retry = failedReason === 'quota' || failedReason === 'error';
  const where = state.unavailable === null ? 'in this browser' : 'in this tab (not saved)';
  const other = state.otherVersion;

  const conflictActions =
    mode.kind === 'overwrite' ? (
      <Confirm
        label="Keep this version?"
        onCancel={leave}
        actions={
          <Action busy={busy} destructive icon={null} onClick={() => void run(() => session.overwriteStored(), true)}>
            Overwrite
          </Action>
        }
      >
        {other === null
          ? `It was deleted in another tab or window. This page's version of “${current.name}” is stored again.`
          : `The version saved in another tab or window (“${other.name}”, ${otherVersionText(other)}) is replaced by this page's version, and cannot be restored. Save as a copy keeps both.`}
      </Confirm>
    ) : (
      <div className="frl-projects__actions" role="group" aria-label="Keep this page's version">
        <Action busy={busy} focusKey="overwrite" onClick={() => enter({ kind: 'overwrite' }, 'overwrite')}>
          {other === null ? 'Keep this version (store it again)' : 'Keep this version (overwrite)'}
        </Action>
        <Action busy={busy} variant="primary" onClick={() => void run(() => session.duplicateProject(current.id, { open: true }))}>
          Save as a copy
        </Action>
      </div>
    );

  return (
    <ModalDialog
      open={open}
      onClose={close}
      title="Projects"
      className="frl-projects"
      onEscape={() => {
        if (mode.kind === 'list') return false;
        leave();
        return true;
      }}
    >
      {state.unavailable !== null && (
        <p className="frl-projects__notice is-problem">
          <SeverityIcon severity="warning" labelled={false} size={14} />
          <span>{save.long}</span>
        </p>
      )}
      {state.notices.map((notice) => (
        <div key={notice.id} className="frl-projects__notice">
          <SeverityIcon severity="info" labelled={false} size={14} />
          <div className="frl-projects__notice-text">
            <p>{notice.message}</p>
            {notice.details.length > 0 && (
              <ul className="frl-projects__issues">
                {notice.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              session.dismissNotice(notice.id);
            }}
          >
            Dismiss<VisuallyHidden> notice</VisuallyHidden>
          </Button>
        </div>
      ))}
      {failure !== null && (
        <div ref={failureRef} tabIndex={-1} className="frl-projects__failure">
          <p className="frl-projects__failure-title">
            <SeverityIcon severity="error" labelled={false} size={14} />
            {failure.message}
          </p>
          <IssueList errors={failure.errors} />
          {failure.openElsewhere !== null && (
            <OpenElsewhereActions
              busy={busy}
              onAnyway={(id) => void run(() => session.openProject(id, { anyway: true })).then(closeOnSuccess)}
              onCopy={(id) => void run(() => session.duplicateProject(id, { open: true })).then(closeOnSuccess)}
              id={failure.openElsewhere}
            />
          )}
        </div>
      )}

      <section className="frl-projects__section" aria-label="Open project">
        <h3 className="frl-projects__heading">Open project</h3>
        <div className="frl-projects__item is-current">
          <div className="frl-projects__item-main">
            <span className="frl-projects__name">{current.name}</span>
            {current.sample && <PlaceholderTag what="project" label="Sample" />}
            <span className={cx('frl-projects__meta', save.problem && 'is-problem')}>
              {save.problem && <SeverityIcon severity="warning" labelled={false} size={12} />}
              {save.long}
            </span>
          </div>
          {conflict && conflictActions}
          {elsewhere && (
            <div className="frl-projects__actions" role="group" aria-label="This project is open in another tab">
              <Action busy={busy} onClick={() => void run(() => session.openAnyway())}>
                Open anyway
              </Action>
              <Action busy={busy} variant="primary" onClick={() => void run(() => session.duplicateProject(current.id, { open: true }))}>
                Open a copy
              </Action>
            </div>
          )}
          {retry && (
            <div className="frl-projects__actions">
              <Action
                busy={busy}
                onClick={() =>
                  void session.flush().then((status) => {
                    announce?.(describeSave(status).short);
                  })
                }
              >
                Try saving again
              </Action>
            </div>
          )}
          {renderRowActions(current.id, current.name, null)}
        </div>
      </section>

      <section className="frl-projects__section" aria-labelledby={listHeadingId}>
        <h3 id={listHeadingId} ref={listHeadingRef} tabIndex={-1} className="frl-projects__heading">
          Other projects {where}
        </h3>
        {mode.kind === 'new' ? (
          <NameForm
            label="Name of the new project"
            draft={mode.draft}
            submitLabel="Create"
            busy={busy}
            onDraft={(draft) => {
              setMode({ kind: 'new', draft });
            }}
            onSubmit={() => void run(() => session.newProject(mode.draft), true).then(closeOnSuccess)}
            onCancel={leave}
          />
        ) : (
          <div className="frl-projects__actions">
            <Action busy={busy} focusKey="new" onClick={() => enter({ kind: 'new', draft: 'New project' }, 'new')}>
              New project
            </Action>
          </div>
        )}
        {others.length === 0 ? (
          <p className="frl-projects__empty">No other projects.</p>
        ) : (
          <ul className="frl-projects__list">
            {others.map((item) => (
              <li key={item.id} className="frl-projects__item">
                <div className="frl-projects__item-main">
                  <span className="frl-projects__name">{item.name}</span>
                  {item.sample && <PlaceholderTag what="project" label="Sample" />}
                  <span className="frl-projects__meta">{projectMeta(item, state.sizes)}</span>
                  {item.problem !== null && (
                    <div className="frl-projects__problem">
                      <p>
                        <SeverityIcon severity="warning" labelled={false} size={12} />
                        {canRetryOpen(item.problem)
                          ? `Not opened: ${item.problem.message}. It is kept unchanged; try opening it again.`
                          : `Cannot be opened: ${item.problem.message}. It is kept unchanged; export it to keep a copy.`}
                      </p>
                      <IssueList errors={item.problem.errors} limit={10} />
                    </div>
                  )}
                </div>
                {renderRowActions(item.id, item.name, item.problem)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="frl-projects__section" aria-label="Recently deleted">
        <h3 ref={deletedHeadingRef} tabIndex={-1} className="frl-projects__heading">
          Recently deleted
        </h3>
        <p className="frl-projects__hint">
          {state.unavailable === null
            ? `Deleted projects, and the originals of projects a newer version migrated, are kept for ${String(BACKUP_RETENTION_DAYS)} days and then removed.`
            : 'Deleted projects are kept only until this tab closes: browser storage is unavailable.'}
        </p>
        {state.backups.length === 0 ? (
          <p className="frl-projects__empty">Nothing here.</p>
        ) : (
          <ul className="frl-projects__list">
            {state.backups.map((backup) => (
              <BackupItem
                key={backup.id}
                backup={backup}
                busy={busy}
                size={sizeText(state.sizes, backup.id)}
                confirming={mode.kind === 'delete-backup' && mode.id === backup.id}
                onRestore={() => void run(() => session.restoreBackup(backup.id))}
                onDelete={() => enter({ kind: 'delete-backup', id: backup.id }, `delete-backup:${backup.id}`)}
                onConfirmDelete={() => void run(() => session.deleteBackup(backup.id), true)}
                onCancel={leave}
              />
            ))}
          </ul>
        )}
      </section>
      <p className="frl-projects__hint">
        {plural(state.projects.length, 'project', 'projects')} stored {where}.
      </p>
    </ModalDialog>
  );
}

function OpenElsewhereActions({ id, busy, onAnyway, onCopy }: { readonly id: ProjectId; readonly busy: boolean; readonly onAnyway: (id: ProjectId) => void; readonly onCopy: (id: ProjectId) => void }) {
  return (
    <div className="frl-projects__actions" role="group" aria-label="Open it anyway, or open a copy">
      <Action busy={busy} onClick={() => onAnyway(id)}>
        Open anyway
      </Action>
      <Action busy={busy} variant="primary" onClick={() => onCopy(id)}>
        Open a copy
      </Action>
    </div>
  );
}

interface BackupItemProps {
  readonly backup: BackupSummary;
  readonly busy: boolean;
  /** " · about 8.0 MB", or empty. */
  readonly size: string;
  readonly confirming: boolean;
  readonly onRestore: () => void;
  readonly onDelete: () => void;
  readonly onConfirmDelete: () => void;
  readonly onCancel: () => void;
}

function BackupItem({ backup, busy, size, confirming, onRestore, onDelete, onConfirmDelete, onCancel }: BackupItemProps) {
  const what = backup.reason === 'deleted' ? `deleted ${formatSavedTime(backup.createdAt)}` : `original before a migration on ${formatDay(backup.createdAt)}`;
  const name = backup.project.name;
  return (
    <li className="frl-projects__item">
      <div className="frl-projects__item-main">
        <span className="frl-projects__name">{name}</span>
        <span className="frl-projects__meta">
          {plural(backup.project.stepCount, 'step', 'steps')} · {what} · kept until {formatDay(backup.purgeAfter)}
          {size}
        </span>
      </div>
      {confirming ? (
        <Confirm
          label={`Delete “${name}” permanently?`}
          onCancel={onCancel}
          actions={
            <Action busy={busy} destructive onClick={onConfirmDelete}>
              Delete permanently
            </Action>
          }
        >
          Delete “{name}” permanently? It is removed from Recently deleted now and cannot be restored.
        </Confirm>
      ) : (
        <div className="frl-projects__actions">
          <Action busy={busy} focusKey={`restore:${backup.id}`} onClick={onRestore}>
            Restore<VisuallyHidden> “{name}”</VisuallyHidden>
          </Action>
          <Action busy={busy} focusKey={`delete-backup:${backup.id}`} onClick={onDelete}>
            Delete permanently<VisuallyHidden> “{name}”</VisuallyHidden>
          </Action>
        </div>
      )}
    </li>
  );
}

function questList(ids: readonly QuestId[], questName: (id: QuestId) => string | null): string {
  const shown = ids.slice(0, 12).map((id) => {
    const name = questName(id);
    return name === null ? `quest ${String(id)}` : `${name} (${String(id)})`;
  });
  return ids.length > 12 ? `${shown.join(', ')} and ${formatInteger(ids.length - 12)} more` : shown.join(', ');
}

function driftLine(label: string, ids: readonly QuestId[] | null, questName: (id: QuestId) => string | null): string {
  if (ids === null) return `${label}: unknown. There is no record of the data this project was made with (it came from a file).`;
  if (ids.length === 0) return `${label}: none.`;
  return `${label}: ${plural(ids.length, 'quest', 'quests')}: ${questList(ids, questName)}.`;
}

export interface DriftDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly drift: DriftReport;
  readonly projectName: string;
  readonly onDismissReport: () => void;
  /** The quest's name in the loaded data, for the lists; null when it has none. */
  readonly questName: (id: QuestId) => string | null;
}

/** The drift report (ARCHITECTURE §5.5): what changed in the data since the project was saved. */
export function DriftDialog({ open, onClose, drift, projectName, onDismissReport, questName }: DriftDialogProps) {
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="The data changed since this project was saved"
      className="frl-drift"
      footer={
        <>
          <Button onClick={onClose}>Keep the report</Button>
          <Button
            variant="primary"
            onClick={() => {
              onDismissReport();
              onClose();
            }}
          >
            Dismiss the report
          </Button>
        </>
      }
    >
      <p>
        “{projectName}” was last saved with data revision <code>{drift.storedRevision.slice(0, 12)}</code>; this page loaded revision{' '}
        <code>{drift.loadedRevision.slice(0, 12)}</code>. The project uses {plural(drift.questCount, 'quest', 'quests')}.
      </p>
      <ul className="frl-drift__lines">
        <li>{driftLine('Missing from the loaded data', drift.missingQuestIds, questName)}</li>
        <li>{driftLine('Objectives changed', drift.changedObjectives, questName)}</li>
        <li>{driftLine('Prerequisites changed', drift.changedPrerequisites, questName)}</li>
      </ul>
      <p className="frl-projects__hint">
        Until the report is dismissed, the stored project keeps its old data revision, so the report comes back next time. Dismissing it records
        the new revision with the next save.
      </p>
    </ModalDialog>
  );
}
