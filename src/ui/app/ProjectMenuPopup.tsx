import { type KeyboardEvent, type RefObject, useEffect, useRef } from 'react';
import type { ProjectSession } from '../../app/persistence';
import { cx } from '../lib/cx';
import { formatInteger, plural } from '../lib/format';
import { Icon } from '../primitives/Icon';
import type { Announce } from './LiveAnnouncer';
import type { ProjectsDialogMode } from './ProjectMenu';
import { useProjectSessionState } from './ProjectMenuContext';

export interface ProjectsMenuPopupProps {
  readonly id: string;
  readonly session: ProjectSession;
  /** Where focus goes as it opens: the first item (Enter, Space, ↓, a click) or the last (↑). */
  readonly focusAt: 'first' | 'last';
  /** The menu button: a press on it is not a press outside. */
  readonly buttonRef: RefObject<HTMLButtonElement | null>;
  /** Closes the menu; `refocus` puts focus back on the button (Escape, a chosen item). */
  readonly onClose: (refocus: boolean) => void;
  readonly onOpenDialog: (mode: ProjectsDialogMode) => void;
  readonly announce?: Announce | undefined;
}

interface MenuItem {
  readonly key: string;
  readonly label: string;
  /** What the item says after its label (the step count), or null. */
  readonly meta: string | null;
  /** A project to switch to: a radio item, checked for the open one. */
  readonly checked?: boolean | undefined;
  readonly danger?: boolean | undefined;
  readonly icon?: 'add' | 'delete' | undefined;
  /** Why it cannot run now, or null. */
  readonly unavailable: string | null;
  readonly run: () => void;
}

const BUSY = 'Wait for the current operation to finish';

/**
 * The Projects menu's content (ui-refresh.md §4.1), a lazy part: the routes in this browser with the
 * open one checked, then New route…, Rename…, Duplicate, Recently deleted…, Projects… (the whole
 * dialog, an addition to the design's list) and Delete route… (the danger item). ↑ ↓ Home End move (wrapping), Enter or Space runs, Escape closes and returns focus to
 * the name, and Tab or a press outside closes it. The items that end in "…" open the Projects dialog
 * in that step; switching opens the project and says so.
 */
export function ProjectsMenuPopup({ id, session, focusAt, buttonRef, onClose, onOpenDialog, announce }: ProjectsMenuPopupProps) {
  const state = useProjectSessionState(session);
  const menuRef = useRef<HTMLDivElement>(null);
  const items = (): HTMLElement[] => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);

  useEffect(() => {
    const list = items();
    (focusAt === 'first' ? list[0] : list.at(-1))?.focus();
  }, [focusAt]);

  // A press outside closes the menu (focus stays where the press put it).
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (menuRef.current?.contains(target) === true || buttonRef.current?.contains(target) === true)) return;
      onClose(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [buttonRef, onClose]);

  if (state === null) return null;
  const busy = state.busy ? BUSY : null;
  const current = state.current;
  const report = (promise: Promise<{ readonly message: string }>) => {
    void promise.then((result) => {
      announce?.(result.message);
    });
  };
  const projects: MenuItem[] = state.projects.map((project) => ({
    key: `project:${project.id}`,
    label: project.name,
    meta: plural(project.stepCount, 'step'),
    checked: project.id === current.id,
    unavailable: project.problem !== null ? 'It cannot be opened: see the Projects dialog' : busy,
    run: () => {
      if (project.id !== current.id) report(session.openProject(project.id));
    },
  }));
  const actions: MenuItem[] = [
    { key: 'new', label: 'New route…', meta: null, icon: 'add', unavailable: busy, run: () => onOpenDialog('new') },
    { key: 'rename', label: 'Rename…', meta: null, unavailable: busy, run: () => onOpenDialog('rename') },
    { key: 'duplicate', label: 'Duplicate', meta: null, unavailable: busy, run: () => report(session.duplicateProject(current.id)) },
    { key: 'deleted', label: 'Recently deleted…', meta: state.backups.length === 0 ? null : formatInteger(state.backups.length), unavailable: null, run: () => onOpenDialog('deleted') },
    // The Projects dialog as today (every stored project: open, rename, export, delete, notices).
    { key: 'all', label: 'Projects…', meta: state.notices.length === 0 ? null : plural(state.notices.length, 'notice'), unavailable: null, run: () => onOpenDialog('list') },
  ];
  const danger: MenuItem = { key: 'delete', label: 'Delete route…', meta: null, danger: true, icon: 'delete', unavailable: busy, run: () => onOpenDialog('delete') };

  const choose = (item: MenuItem) => {
    if (item.unavailable !== null) return;
    onClose(true);
    item.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const at = list.findIndex((element) => element === document.activeElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = at < 0 || at === list.length - 1 ? 0 : at + 1;
        break;
      case 'ArrowUp':
        next = at <= 0 ? list.length - 1 : at - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = list.length - 1;
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onClose(true);
        return;
      case 'Tab':
        onClose(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    list[next]?.focus();
  };

  const renderItem = (item: MenuItem) => (
    <div
      key={item.key}
      role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={item.checked}
      aria-disabled={item.unavailable === null ? undefined : true}
      title={item.unavailable ?? undefined}
      tabIndex={-1}
      className={cx('frl-projects-menu__item', item.checked === true && 'is-current', item.danger === true && 'is-danger')}
      onClick={() => {
        choose(item);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        choose(item);
      }}
    >
      {item.icon !== undefined && <Icon name={item.icon} size={14} />}
      <span className="frl-projects-menu__label">{item.label}</span>
      {item.meta !== null && <span className="frl-projects-menu__meta frl-num">{item.meta}</span>}
    </div>
  );

  return (
    <div ref={menuRef} id={id} role="menu" aria-label="Projects" className="frl-projects-menu__popup" onKeyDown={onKeyDown}>
      <div role="group" aria-label="Routes in this browser">
        <div className="frl-projects-menu__caption" aria-hidden="true">
          Routes in this browser
        </div>
        {projects.map(renderItem)}
      </div>
      <div role="separator" className="frl-projects-menu__separator" />
      {actions.map(renderItem)}
      <div role="separator" className="frl-projects-menu__separator" />
      {renderItem(danger)}
    </div>
  );
}
