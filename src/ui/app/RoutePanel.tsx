import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { type EditorStore, type HistoryStatus, selectionRuns } from '../../app';
import { useDerivedSelector, useEditor } from '../../app/react';
import type { DatasetView } from '../../domain/dataset';
import type { StepId } from '../../domain/ids';
import { type ActiveRow, characterName, dropToIndex, PLACEHOLDER_DATA_NOTICE, type RouteView, selectedRowKeys } from '../app-model';
import { Button, EmptyState, IconButton, PlaceholderTag, RouteList, Toolbar, ToolbarSeparator, formatInteger, plural, type SelectionMode } from '../kit';
import { createGroupDeriver, createRowDeriver, sameRowSource } from './derived-view';
import { loadRowView, useLazy } from './lazy';
import type { Announce } from './LiveAnnouncer';
import { ProjectsMenu, type ProjectsDialogMode } from './ProjectMenu';
import { useProjectSession, useProjectSessionState } from './ProjectMenuContext';
import { INSERT_GRIND_TITLE, type RouteActions } from './route-actions';
import { selectCharacter, selectClipboardCount, selectDerived, selectEditingLocked, selectHistory, selectSelection, useActiveTarget } from './selectors';
import { routeEditorKeyHandler } from './useShortcuts';
import type { ShellPrefs } from './view-prefs';
import './RoutePanel.css';

/** The route rows' View choices (ui-refresh.md §4.1), kept per browser. */
export type RowPrefs = Pick<ShellPrefs, 'density' | 'topNumber' | 'column'>;

export interface RoutePanelProps {
  readonly store: EditorStore;
  readonly view: RouteView;
  /** The project's data: the rows take quest difficulty at the level each step starts at. */
  readonly dataset: DatasetView;
  readonly routeName: string;
  /** Placeholder data is loaded: its tag and line. */
  readonly placeholder: boolean;
  /** A line about the route itself, for example that it is an auto-generated sample; null for none. */
  readonly notice?: string | null | undefined;
  readonly activeRow: ActiveRow | null;
  readonly onActiveRowChange: (row: ActiveRow) => void;
  readonly actions: RouteActions;
  /** The route editor's root element; route shortcuts only act while focus is inside it. */
  readonly containerRef: RefObject<HTMLDivElement | null>;
  /** Puts keyboard focus on the route list. */
  readonly onFocusList: () => void;
  /** The steps of the row under the pointer, or null when it leaves the list (the map highlights their markers). */
  readonly onHoverSteps?: ((ids: readonly StepId[] | null) => void) | undefined;
  /** The rows' View choices; omitted: the defaults, and View changes them for this panel only. */
  readonly rowPrefs?: RowPrefs | undefined;
  readonly onRowPrefsChange?: ((patch: Partial<RowPrefs>) => void) | undefined;
  /** Opens the Projects dialog in a step (the route name's menu); omitted: the name is plain text. */
  readonly onOpenProjects?: ((mode: ProjectsDialogMode) => void) | undefined;
  readonly announce?: Announce | undefined;
}

/** `aria-disabled` for an unavailable toolbar item: it stays focusable (docs/UI.md §9, F-03). */
const unavailable = (flag: boolean): true | undefined => (flag ? true : undefined);

const DEFAULT_ROW_PREFS: RowPrefs = { density: 'two-line', topNumber: 'xp', column: 'level' };

/**
 * View (ui-refresh.md §4.1): a non-modal disclosure like the status bar's Summary. Escape, the
 * button, a press outside or focus leaving it closes it; Escape returns focus to the button. Its
 * content (the rows' choices and the key) is a lazy part, `RouteView.tsx`.
 */
function ViewMenu({ prefs, onChange }: { readonly prefs: RowPrefs; readonly onChange: (patch: Partial<RowPrefs>) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLSpanElement>(null);
  const code = useLazy(loadRowView, open);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Node && boxRef.current?.contains(event.target) === true) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [open]);
  return (
    <span
      ref={boxRef}
      className="frl-view"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }}
      onBlur={(event) => {
        if (open && !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setOpen(false);
      }}
    >
      <Button
        ref={buttonRef}
        size="sm"
        variant="ghost"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title="Rows, their numbers, and the key to the marks"
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        View
      </Button>
      {open && (
        <div id={id} role="group" aria-label="View" className="frl-view__popup">
          {code.kind === 'ready' ? (
            <code.value.RowViewPanel prefs={prefs} onChange={onChange} />
          ) : code.kind === 'failed' ? (
            <p role="alert">{`View could not be loaded (${code.message}).`}</p>
          ) : (
            <p>Loading…</p>
          )}
        </div>
      )}
    </span>
  );
}

interface RoutePanelHeadProps {
  readonly routeName: string;
  readonly onOpenProjects: ((mode: ProjectsDialogMode) => void) | undefined;
  readonly announce: Announce | undefined;
  readonly prefs: RowPrefs;
  readonly onPrefsChange: (patch: Partial<RowPrefs>) => void;
  readonly history: HistoryStatus;
  readonly actions: RouteActions;
}

/** The 36px header: the route's name (the Projects menu), View, Undo and Redo (the tags are on the meta line, UI-07). Memoised: arrowing through the list does not re-render it. */
const RoutePanelHead = memo(function RoutePanelHead({ routeName, onOpenProjects, announce, prefs, onPrefsChange, history, actions }: RoutePanelHeadProps) {
  const session = useProjectSession();
  // The name the Projects menu checks, which Rename… changes (review UI-07): the open project's; the route's without a session.
  const sessionState = useProjectSessionState(session);
  const shownName = sessionState?.current.name ?? routeName;
  return (
      <div className="frl-app-route__head">
      <h2 className="frl-app-route__name">
        {session !== null && onOpenProjects !== undefined ? (
          <ProjectsMenu session={session} routeName={shownName} onOpenDialog={onOpenProjects} announce={announce} />
        ) : (
          <span className="frl-app-route__title" title={routeName}>
            {routeName}
          </span>
        )}
      </h2>
      <span className="frl-app-route__spacer" />
      <ViewMenu prefs={prefs} onChange={onPrefsChange} />
      <Toolbar label="History" className="frl-app-route__history">
        <IconButton
          icon="undo"
          size="sm"
          label={history.undoLabel === null ? 'Nothing to undo' : `Undo ${history.undoLabel}`}
          shortcut="Ctrl+Z"
          aria-disabled={unavailable(!history.canUndo)}
          onClick={actions.undo}
        />
        <IconButton
          icon="redo"
          size="sm"
          label={history.redoLabel === null ? 'Nothing to redo' : `Redo ${history.redoLabel}`}
          shortcut="Ctrl+Shift+Z"
          aria-disabled={unavailable(!history.canRedo)}
          onClick={actions.redo}
        />
      </Toolbar>
    </div>
  );
});

interface StepToolbarProps {
  readonly canEdit: boolean;
  readonly selectionCount: number;
  readonly selectionLocked: boolean;
  readonly sections: number;
  readonly clipboardCount: number;
  readonly actions: RouteActions;
  readonly onFocusList: () => void;
}

/** The step toolbar under the list: one tab stop; Move up and down first. Memoised on plain values, so arrowing re-renders it only when they change. */
const StepToolbar = memo(function StepToolbar({ canEdit, selectionCount, selectionLocked, sections, clipboardCount, actions, onFocusList }: StepToolbarProps) {
  const canEditSelection = canEdit && selectionCount > 0;
  const canPaste = canEdit && clipboardCount > 0;
  const canJoin = canEdit && sections >= 2;
  // Handlers guard as well: the toolbar swallows clicks on aria-disabled items, the store refuses
  // edits while locked, and a guard keeps the intent obvious here.
  const whenSelection = (run: () => void) => () => {
    if (canEditSelection) run();
  };
  return (
      <div className="frl-app-route__toolbar">
      <Toolbar label="Selected steps">
        <IconButton
          icon="up"
          label="Move selected steps up"
          shortcut="Alt+↑"
          size="sm"
          aria-disabled={unavailable(!canEditSelection)}
          onClick={whenSelection(() => {
            actions.moveSteps({ by: -1 });
          })}
        />
        <IconButton
          icon="down"
          label="Move selected steps down"
          shortcut="Alt+↓"
          size="sm"
          aria-disabled={unavailable(!canEditSelection)}
          onClick={whenSelection(() => {
            actions.moveSteps({ by: 1 });
          })}
        />
        <ToolbarSeparator />
        <IconButton
          icon="duplicate"
          label="Duplicate selected steps"
          shortcut="Ctrl+D"
          size="sm"
          aria-disabled={unavailable(!canEditSelection)}
          onClick={whenSelection(() => {
            actions.duplicateSteps();
          })}
        />
        <IconButton
          icon="lock"
          label="Lock selected steps"
          shortcut="L"
          size="sm"
          pressed={selectionLocked}
          aria-disabled={unavailable(!canEditSelection)}
          onClick={whenSelection(() => {
            actions.toggleLock();
          })}
        />
        <IconButton
          icon="delete"
          label="Delete selected steps"
          shortcut="Delete"
          size="sm"
          aria-disabled={unavailable(!canEditSelection)}
          onClick={whenSelection(() => {
            // Continue from the list: the next step is active there.
            if (actions.deleteSteps()) onFocusList();
          })}
        />
        <ToolbarSeparator />
        <IconButton
          icon="cut"
          label="Cut selected steps"
          shortcut="Ctrl+X"
          size="sm"
          aria-disabled={unavailable(!canEditSelection)}
          onClick={whenSelection(() => {
            if (actions.cutSteps()) onFocusList();
          })}
        />
        <IconButton
          icon="copy"
          label="Copy selected steps"
          shortcut="Ctrl+C"
          size="sm"
          // Copying changes nothing, so it stays available while editing is locked.
          aria-disabled={unavailable(selectionCount === 0)}
          onClick={() => {
            if (selectionCount > 0) actions.copySteps();
          }}
        />
        <IconButton
          icon="paste"
          label={clipboardCount > 0 ? `Paste ${plural(clipboardCount, 'step')} after the selection` : 'Paste steps (the clipboard is empty)'}
          shortcut="Ctrl+V"
          size="sm"
          aria-disabled={unavailable(!canPaste)}
          onClick={() => {
            if (canPaste) actions.pasteSteps();
          }}
        />
        <IconButton
          icon="join"
          label={sections >= 2 ? `Join the ${formatInteger(sections)} selected sections` : 'Join sections (select two or more separate runs of steps)'}
          shortcut="J"
          size="sm"
          aria-disabled={unavailable(!canJoin)}
          onClick={() => {
            if (canJoin) actions.joinSections();
          }}
        />
      </Toolbar>
    </div>
  );
});

/** The Add footer ("Add after step 12": Grind, Travel, Hearth, Train, Buy, Note), named for where new steps go. */
const AddFooter = memo(function AddFooter({ label: addLabel, canEdit, actions, store }: { readonly label: string; readonly canEdit: boolean; readonly actions: RouteActions; readonly store: EditorStore }) {
  const whenEditable = (run: () => void) => () => {
    if (canEdit) run();
  };
  const toDetails = (run: () => void) =>
    whenEditable(() => {
      run();
      store.setView({ rightTab: 'details' });
    });
  return (
      <div className="frl-app-route__add">
      <p className="frl-app-route__add-caption" aria-hidden="true">
        {addLabel}
      </p>
      <Toolbar label={addLabel} className="frl-app-route__add-buttons">
        <Button size="sm" aria-disabled={unavailable(!canEdit)} title={INSERT_GRIND_TITLE} onClick={whenEditable(actions.insertGrind)}>
          Grind
        </Button>
        <Button size="sm" aria-disabled={unavailable(!canEdit)} title="Insert a travel step (destination not set) after the selection" onClick={whenEditable(actions.insertTravel)}>
          Travel
        </Button>
        <Button size="sm" aria-disabled={unavailable(!canEdit)} title="Insert a hearthstone use (to the bind point) after the selection" onClick={whenEditable(actions.insertHearth)}>
          Hearth
        </Button>
        <Button size="sm" aria-disabled={unavailable(!canEdit)} title="Insert a train step after the selection, and set it in Details" onClick={toDetails(actions.insertTrain)}>
          Train
        </Button>
        <Button size="sm" aria-disabled={unavailable(!canEdit)} title="Insert a vendor step after the selection, and set it in Details" onClick={toDetails(actions.insertBuy)}>
          Buy
        </Button>
        <Button size="sm" aria-disabled={unavailable(!canEdit)} title="Insert a note after the selection, and write it in Details" onClick={toDetails(actions.insertNote)}>
          Note
        </Button>
      </Toolbar>
    </div>
  );
});

/**
 * The route editor (left panel, ui-refresh.md §4.1): one job, no tabs. The header holds the route's
 * name, which opens the Projects menu (with New), the Sample or Placeholder tag, View, Undo and Redo;
 * a meta line; the virtualised list, with the insertion line and the band under the steps after the
 * selection; the step toolbar with Move up and Move down; and the Add footer ("Add after step 12":
 * Grind, Travel, Hearth, Train, Buy, Note). It reads the selection, the lock and the history; the rows
 * come from the caller, built once per route revision, and the walk's numbers (derived results)
 * fill in only the rows in view (`deriveRow`), so a new walk never rebuilds them.
 */
export const RoutePanel = memo(function RoutePanel({
  store,
  view,
  dataset,
  routeName,
  placeholder,
  notice = null,
  activeRow,
  onActiveRowChange,
  actions,
  containerRef,
  onFocusList,
  onHoverSteps,
  rowPrefs,
  onRowPrefsChange,
  onOpenProjects,
  announce,
}: RoutePanelProps) {
  const selection = useEditor(store, selectSelection);
  const editingLocked = useEditor(store, selectEditingLocked);
  const history = useEditor(store, selectHistory);
  const clipboardCount = useEditor(store, selectClipboardCount);
  const character = useEditor(store, selectCharacter);
  const { index: activeIndex } = useActiveTarget(store, view, activeRow);
  const selectedKeys = useMemo(() => selectedRowKeys(view, selection.stepIds), [view, selection.stepIds]);
  const onKeyDown = useMemo(() => routeEditorKeyHandler(store, actions), [store, actions]);
  // The rows read the results, not the paths' progress: a progress tick does not re-render them (PERF-11).
  const derived = useDerivedSelector(selectDerived, sameRowSource);
  const deriveRow = useMemo(() => createRowDeriver(view, dataset, derived), [view, dataset, derived]);
  const deriveGroup = useMemo(() => createGroupDeriver(view, derived), [view, derived]);
  const [localPrefs, setLocalPrefs] = useState<RowPrefs>(DEFAULT_ROW_PREFS);
  const prefs = rowPrefs ?? localPrefs;
  const setPrefs = useCallback(
    (patch: Partial<RowPrefs>) => {
      if (onRowPrefsChange === undefined) setLocalPrefs((was) => ({ ...was, ...patch }));
      else onRowPrefsChange(patch);
    },
    [onRowPrefsChange],
  );

  const rowIds = (index: number): readonly StepId[] => view.rowSteps[index] ?? [];
  const rowIsSelected = (index: number): boolean => {
    const ids = rowIds(index);
    return ids.length > 0 && ids.every((id) => selection.stepIds.has(id));
  };
  /** A row action applies to the selection when the row is part of it, else to the row alone. */
  const targetOf = (index: number): ReadonlySet<StepId> => (rowIsSelected(index) ? selection.stepIds : new Set(rowIds(index)));

  // Where new steps go (the store's `insertionIndex`): after the selection's last step, else after
  // the focus step, else at the end. The list draws the line and the band there.
  const insertion = useMemo(() => {
    let lastRow = -1;
    let lastStep: StepId | null = null;
    for (const id of selection.stepIds) {
      const row = view.rowOfStep.get(id);
      if (row !== undefined && row > lastRow) {
        lastRow = row;
        lastStep = id;
      }
    }
    if (lastStep === null && selection.focus !== null) {
      const row = view.rowOfStep.get(selection.focus);
      if (row !== undefined) {
        lastRow = row;
        lastStep = selection.focus;
      }
    }
    const number = lastStep === null ? null : (view.numberOfStep.get(lastStep) ?? null);
    return { at: lastRow < 0 ? view.rows.length : lastRow + 1, number };
  }, [selection.stepIds, selection.focus, view]);
  const addLabel = insertion.number === null ? (view.steps.length === 0 ? 'Add to the route' : 'Add at the end of the route') : `Add after step ${formatInteger(insertion.number)}`;

  const rememberActive = (index: number) => {
    const row = view.rows[index];
    if (row !== undefined) onActiveRowChange({ key: row.key, focus: store.getState().selection.focus });
  };

  const onSelect = (index: number, mode: SelectionMode) => {
    const row = view.rows[index];
    const ids = rowIds(index);
    const first = ids[0];
    const last = ids.at(-1);
    if (row === undefined || first === undefined || last === undefined) return;
    if (row.type === 'step') {
      store.select(mode === 'replace' ? { kind: 'single', id: first } : { kind: mode, id: first });
    } else if (mode === 'replace') {
      store.select({ kind: 'set', ids });
    } else if (mode === 'toggle') {
      const next = new Set(selection.stepIds);
      const all = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      store.select({ kind: 'set', ids: view.steps.filter((s) => next.has(s.id)).map((s) => s.id) });
    } else {
      // A range to a group header covers the whole group, whichever side the anchor is on.
      const anchorRow = selection.anchor === null ? undefined : view.rowOfStep.get(selection.anchor);
      store.select({ kind: 'range', id: anchorRow !== undefined && anchorRow > index ? first : last });
    }
    rememberActive(index);
  };

  const onDrop = (from: number, to: number) => {
    const moving = targetOf(from);
    if (!rowIsSelected(from)) store.select({ kind: 'set', ids: [...moving] });
    actions.moveSteps({ toIndex: dropToIndex(view, moving, from, to) }, moving);
  };

  const selectionCount = selection.stepIds.size;
  const canEdit = !editingLocked;
  const sections = useMemo(() => selectionRuns(view.steps, selection.stepIds).length, [view.steps, selection.stepIds]);
  // The Lock toggle is pressed when every selected step is locked.
  const selectionLocked = useMemo(() => {
    if (selection.stepIds.size === 0) return false;
    for (const id of selection.stepIds) {
      const number = view.numberOfStep.get(id);
      if (number === undefined || view.steps[number - 1]?.locked !== true) return false;
    }
    return true;
  }, [selection.stepIds, view]);

  const sample = notice !== null;
  const who = `${characterName(character)} from level ${String(character.startLevel)}`;

  return (
    <div className="frl-app-route" ref={containerRef} onKeyDown={onKeyDown}>
      <RoutePanelHead
        routeName={routeName}
        onOpenProjects={onOpenProjects}
        announce={announce}
        prefs={prefs}
        onPrefsChange={setPrefs}
        history={history}
        actions={actions}
      />
      <div className="frl-app-route__meta">
        <p className="frl-num">
          {plural(view.steps.length, 'step')}
          {selectionCount > 0 && ` · ${formatInteger(selectionCount)} selected`}
          {` · ${who}`}
        </p>
        {/* The Sample and Placeholder tags sit with their notice lines, so the route's name keeps about 200px in the header (review UI-07; §8). */}
        {sample && (
          <p className="frl-app-route__notice">
            <PlaceholderTag label="Sample" what="route" /> {notice}
          </p>
        )}
        {placeholder && (
          <p className="frl-app-route__notice">
            <PlaceholderTag what="data" /> {PLACEHOLDER_DATA_NOTICE}
          </p>
        )}
      </div>
      <div className="frl-app-route__list">
        <RouteList
          rows={view.rows}
          deriveRow={deriveRow}
          deriveGroup={deriveGroup}
          density={prefs.density}
          estimateColumn={prefs.column}
          topNumber={prefs.topNumber}
          insertAt={insertion.at}
          label={routeName}
          activeIndex={activeIndex}
          selectedKeys={selectedKeys}
          readOnly={editingLocked}
          onActiveIndexChange={rememberActive}
          onSelect={onSelect}
          onSelectAll={() => {
            store.select({ kind: 'all' });
          }}
          onActivate={() => {
            store.setView({ rightTab: 'details' });
          }}
          onMove={(index, delta) => {
            actions.moveSteps({ by: delta }, targetOf(index));
          }}
          onToggleLock={(index) => {
            actions.toggleLock(targetOf(index));
          }}
          onDuplicate={(index) => {
            actions.duplicateSteps(targetOf(index));
          }}
          onDelete={(index) => {
            actions.deleteSteps(targetOf(index));
          }}
          onDrop={onDrop}
          onHoverIndexChange={
            onHoverSteps === undefined
              ? undefined
              : (index) => {
                  onHoverSteps(index === null ? null : rowIds(index));
                }
          }
          emptyState={<EmptyState title="The route is empty">Add a step below, or accept a quest from the Available tab, to begin.</EmptyState>}
        />
      </div>
      <StepToolbar
        canEdit={canEdit}
        selectionCount={selectionCount}
        selectionLocked={selectionLocked}
        sections={sections}
        clipboardCount={clipboardCount}
        actions={actions}
        onFocusList={onFocusList}
      />
      <AddFooter label={addLabel} canEdit={canEdit} actions={actions} store={store} />
    </div>
  );
});
