import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { DownloadFile, ProjectSession, ProjectSessionState, SaveStatus } from '../../app/persistence';
import type { QuestId } from '../../domain/ids';
import { cx } from '../lib/cx';
import { plural } from '../lib/format';
import { SeverityIcon } from '../markers/SeverityIcon';
import { VisuallyHidden } from '../primitives/Badge';
import { Button } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { loadProjectDialogs, useLazy, useLazyKept } from './lazy';
import type { Announce } from './LiveAnnouncer';
import { useProjectSessionState } from './ProjectMenuContext';
import './ProjectMenu.css';

/**
 * The project controls (ARCHITECTURE §12.3, docs/UI.md §13): the Projects menu the route name opens
 * (docs/research/ui-refresh.md §4.1: switch, New, Rename, Duplicate, Recently deleted, Delete), the
 * save status in words and the drift report's button beside the top bar, and the host of the
 * Projects dialog and the drift report, which load on first use (`ProjectDialogs.tsx`, the ledger's
 * reserve, §10.3). Everything reads the project session; nothing here touches storage itself.
 */

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * A save time in the viewer's local time, 24-hour: `12:03` today, `2026-09-24 12:03` on another
 * day. The same form everywhere, whatever the browser's locale.
 */
export function formatSavedTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  return sameDay ? time : `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${time}`;
}

/** A calendar date from an ISO time, in local time: `2026-10-25`. */
export function formatDay(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export interface SaveText {
  /** The status line beside the Projects button. */
  readonly short: string;
  /** The full sentence (tooltip, the button's description, the menu). */
  readonly long: string;
  /** Nothing is being kept (failed or unavailable): drawn with the warning shape. */
  readonly problem: boolean;
}

const FAILURE_SHORT: Readonly<Record<Extract<SaveStatus, { kind: 'failed' }>['reason'], string>> = {
  quota: 'Not saved: storage full',
  conflict: 'Not saved: changed elsewhere',
  elsewhere: 'Not saved: open in another tab',
  closed: 'Not saved: storage closed',
  error: 'Not saved',
};

/** The save status in words (docs/UI.md §13). Never claims a save that did not happen. */
export function describeSave(save: SaveStatus, now?: Date): SaveText {
  switch (save.kind) {
    case 'saved': {
      const at = formatSavedTime(save.at, now);
      return { short: `Saved ${at}`, long: `All changes are saved in this browser (last saved ${at}).`, problem: false };
    }
    case 'pending':
      return { short: 'Unsaved changes', long: 'Changes are saved automatically in a moment.', problem: false };
    case 'saving':
      return { short: 'Saving…', long: 'Saving changes in this browser.', problem: false };
    case 'failed': {
      const last = save.lastSavedAt === null ? 'It has not been saved yet.' : `Last saved ${formatSavedTime(save.lastSavedAt, now)}.`;
      return { short: FAILURE_SHORT[save.reason], long: `Not saved: ${save.message} ${last}`, problem: true };
    }
    case 'unavailable':
      return {
        short: 'Not saved: storage unavailable',
        long: `${save.reason}. Projects are kept in this tab only and are lost when it closes. Export a project to keep it.`,
        problem: true,
      };
  }
}

/**
 * The key a failed save is announced under: the open project and the reason. A retry that fails
 * the same way is not announced again (M4 review CR-09), whatever its message now says.
 */
export function failureAnnouncementKey(state: Pick<ProjectSessionState, 'save' | 'current'>): string | null {
  return state.save.kind === 'failed' ? `${state.current.id}:${state.save.reason}` : null;
}

/** The step the Projects dialog opens in (the menu's items): see `ProjectMenuDialog`. */
export type ProjectsDialogMode = 'list' | 'new' | 'rename' | 'delete' | 'deleted';

/** Why a lazy dialog is missing, in words, for its stand-in. */
function loadFailure(message: string): string {
  return `The projects dialog could not be loaded (${message}). Check the connection and try again.`;
}

export interface ProjectBarProps {
  readonly session: ProjectSession;
  readonly announce?: Announce | undefined;
  readonly questName: (id: QuestId) => string | null;
  /** Opens the Projects dialog (its notices); omitted: the notices button is not shown. */
  readonly onOpenProjects?: ((mode: ProjectsDialogMode) => void) | undefined;
}

/**
 * The strip beside the top bar: the save status, the drift report's button and the notices'. The
 * Projects menu moved to the route name (ui-refresh.md §4.1, §8); the save status stays here.
 */
export function ProjectBar({ session, announce, questName, onOpenProjects }: ProjectBarProps) {
  const state = useProjectSessionState(session);
  const [driftOpen, setDriftOpen] = useState(false);
  const drift = useLazyKept(loadProjectDialogs, driftOpen);
  const statusRef = useRef<HTMLSpanElement>(null);
  const lastFailure = useRef<string | null>(null);

  // A failed save is announced once, when it happens (docs/UI.md §9 rule 6): the change the user
  // just made is not kept. The key is forgotten only once a save succeeds (or another project
  // opens), so a failure that repeats while the save is retried stays quiet.
  const failureKey = state === null ? null : failureAnnouncementKey(state);
  const saveStatus = state?.save ?? null;
  useEffect(() => {
    if (saveStatus === null) return;
    if (failureKey !== null) {
      if (failureKey !== lastFailure.current) announce?.(describeSave(saveStatus).long);
      lastFailure.current = failureKey;
    } else if (saveStatus.kind !== 'saving') {
      lastFailure.current = null;
    }
  }, [failureKey, saveStatus, announce]);

  if (state === null) return null;
  const save = describeSave(state.save);
  const noticeCount = state.notices.length;
  const closeDrift = () => {
    setDriftOpen(false);
  };
  return (
    <section className="frl-projectbar" aria-label="Project storage">
      <span ref={statusRef} className={cx('frl-projectbar__status', save.problem && 'is-problem')} title={save.long} tabIndex={-1}>
        {save.problem && <SeverityIcon severity="warning" labelled={false} size={14} />}
        <span aria-hidden="true">{save.short}</span>
        <span className="frl-visually-hidden">{save.long}</span>
      </span>
      {state.drift !== null && (
        <Button
          size="sm"
          className="frl-projectbar__drift"
          aria-haspopup="dialog"
          title="The data changed since this project was saved: see what changed"
          onClick={() => {
            setDriftOpen(true);
          }}
        >
          <SeverityIcon severity="warning" labelled={false} size={14} />
          <span>Data changed</span>
          <VisuallyHidden> since this project was saved: see what changed</VisuallyHidden>
        </Button>
      )}
      {noticeCount > 0 && state.drift === null && onOpenProjects !== undefined && (
        <Button
          size="sm"
          variant="ghost"
          aria-haspopup="dialog"
          onClick={() => {
            onOpenProjects('list');
          }}
        >
          <SeverityIcon severity="info" labelled={false} size={14} />
          <span>{plural(noticeCount, 'notice', 'notices')}</span>
        </Button>
      )}
      {state.drift !== null &&
        (drift.kind === 'ready' ? (
          <drift.value.DriftDialog
            open={driftOpen}
            onClose={closeDrift}
            drift={state.drift}
            projectName={state.current.name}
            questName={questName}
            onDismissReport={() => {
              setDriftOpen(false);
              session.acknowledgeDrift();
              // The "Data changed" button that opened the report leaves with it: focus the save status (UI review F11).
              statusRef.current?.focus();
              announce?.('Report dismissed: the new data revision is recorded with the next save.');
            }}
          />
        ) : driftOpen && drift.kind === 'failed' ? (
          <p className="frl-projectbar__failure" role="alert">
            {loadFailure(drift.message)}{' '}
            <Button size="sm" onClick={drift.retry}>
              Try again
            </Button>
          </p>
        ) : null)}
    </section>
  );
}

export interface ProjectsDialogHostProps {
  readonly session: ProjectSession;
  /** The step to open in, or null while closed. */
  readonly mode: ProjectsDialogMode | null;
  readonly onClose: () => void;
  readonly announce?: Announce | undefined;
  readonly download?: ((file: DownloadFile) => void) | undefined;
}

/** The Projects dialog, loaded on first use (lazy parts), kept mounted once loaded so focus returns natively. */
export function ProjectsDialogHost({ session, mode, onClose, announce, download }: ProjectsDialogHostProps) {
  const state = useProjectSessionState(session);
  const code = useLazyKept(loadProjectDialogs, mode !== null);
  if (state === null) return null;
  if (code.kind === 'ready') {
    return (
      <code.value.ProjectMenuDialog
        open={mode !== null}
        onClose={onClose}
        session={session}
        state={state}
        announce={announce}
        download={download}
        initial={mode ?? 'list'}
      />
    );
  }
  if (code.kind === 'failed' && mode !== null) {
    return (
      <p className="frl-projectbar__failure" role="alert">
        {loadFailure(code.message)}{' '}
        <Button size="sm" onClick={code.retry}>
          Try again
        </Button>
      </p>
    );
  }
  return null;
}

// The Projects menu (the route name) --------------------------------------------------------------

export interface ProjectsMenuProps {
  readonly session: ProjectSession;
  /** The route's name, the button's visible words. */
  readonly routeName: string;
  readonly onOpenDialog: (mode: ProjectsDialogMode) => void;
  readonly announce?: Announce | undefined;
}

/**
 * The route name as a menu button that opens the Projects menu (ui-refresh.md §4.1; WAI-ARIA menu
 * button). Enter, Space or ↓ opens it on the first item, ↑ on the last. The menu's content is a lazy
 * part (`ProjectMenuPopup.tsx`, the ledger's reserve: "the Projects menu's content lazy, the button
 * stays"), fetched when the page is idle.
 */
export function ProjectsMenu({ session, routeName, onOpenDialog, announce }: ProjectsMenuProps) {
  const [open, setOpen] = useState<'first' | 'last' | null>(null);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const code = useLazy(loadProjectDialogs, open !== null);
  const close = useCallback((refocus: boolean) => {
    setOpen(null);
    if (refocus) buttonRef.current?.focus();
  }, []);
  return (
    <span className="frl-projects-menu">
      <button
        ref={buttonRef}
        type="button"
        className="frl-projects-menu__button"
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-controls={open !== null ? menuId : undefined}
        aria-label={`${routeName}, route: open the projects menu`}
        title="Switch, create, rename, duplicate or delete routes"
        onClick={() => {
          setOpen((was) => (was === null ? 'first' : null));
        }}
        onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          setOpen(event.key === 'ArrowDown' ? 'first' : 'last');
        }}
      >
        <span className="frl-projects-menu__name">{routeName}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      {open !== null && code.kind === 'ready' && (
        <code.value.ProjectsMenuPopup id={menuId} session={session} focusAt={open} buttonRef={buttonRef} onClose={close} onOpenDialog={onOpenDialog} announce={announce} />
      )}
      {open !== null && code.kind === 'failed' && (
        <span className="frl-projects-menu__popup frl-projects-menu__failure" role="alert">
          {loadFailure(code.message)}{' '}
          <Button size="sm" onClick={code.retry}>
            Try again
          </Button>
        </span>
      )}
    </span>
  );
}
