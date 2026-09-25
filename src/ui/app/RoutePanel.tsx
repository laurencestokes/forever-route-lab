import { memo, useMemo, type RefObject } from 'react';
import type { EditorStore } from '../../app';
import { useEditor } from '../../app/react';
import type { StepId } from '../../domain/ids';
import {
  type ActiveRow,
  dropToIndex,
  PLACEHOLDER_DATA_NOTICE,
  type RouteView,
  selectedRowKeys,
  UNKNOWN_LEGEND,
  UNKNOWN_LEGEND_SPOKEN,
} from '../app-model';
import {
  Button,
  EmptyState,
  IconButton,
  PanelHeader,
  PlaceholderTag,
  RouteList,
  Toolbar,
  ToolbarSeparator,
  VisuallyHidden,
  formatInteger,
  plural,
  type SelectionMode,
} from '../kit';
import { INSERT_GRIND_TITLE, type RouteActions } from './route-actions';
import { selectEditingLocked, selectHistory, selectSelection, useActiveTarget } from './selectors';
import { routeEditorKeyHandler } from './useShortcuts';

export interface RoutePanelProps {
  readonly store: EditorStore;
  readonly view: RouteView;
  readonly routeName: string;
  /** Placeholder data is loaded: show its line in the banner. */
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
}

/** `aria-disabled` for an unavailable toolbar item: it stays focusable (docs/UI.md §9, F-03). */
const unavailable = (flag: boolean): true | undefined => (flag ? true : undefined);

/**
 * The route editor (left panel): header with history, the banner (placeholder data, a sample
 * route's notice) and its legend, the
 * route actions and the virtualised list. It reads the selection, the lock and the history; the
 * rows come from the caller, built once per route revision.
 */
export const RoutePanel = memo(function RoutePanel({
  store,
  view,
  routeName,
  placeholder,
  notice = null,
  activeRow,
  onActiveRowChange,
  actions,
  containerRef,
  onFocusList,
}: RoutePanelProps) {
  const selection = useEditor(store, selectSelection);
  const editingLocked = useEditor(store, selectEditingLocked);
  const history = useEditor(store, selectHistory);
  const { index: activeIndex } = useActiveTarget(store, view, activeRow);
  const selectedKeys = useMemo(() => selectedRowKeys(view, selection.stepIds), [view, selection.stepIds]);
  const onKeyDown = useMemo(() => routeEditorKeyHandler(store, actions), [store, actions]);

  const rowIds = (index: number): readonly StepId[] => view.rowSteps[index] ?? [];
  const rowIsSelected = (index: number): boolean => {
    const ids = rowIds(index);
    return ids.length > 0 && ids.every((id) => selection.stepIds.has(id));
  };
  /** A row action applies to the selection when the row is part of it, else to the row alone. */
  const targetOf = (index: number): ReadonlySet<StepId> => (rowIsSelected(index) ? selection.stepIds : new Set(rowIds(index)));

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
  const canEditSelection = canEdit && selectionCount > 0;
  // Handlers guard as well: the toolbar swallows clicks on aria-disabled items, the store refuses
  // edits while locked, and a guard keeps the intent obvious here.
  const whenEditable = (run: () => void) => () => {
    if (canEdit) run();
  };
  const whenSelection = (run: () => void) => () => {
    if (canEditSelection) run();
  };

  return (
    <div className="frl-app-route" ref={containerRef} onKeyDown={onKeyDown}>
      <PanelHeader
        title="Route"
        meta={
          <span className="frl-num">
            {plural(view.steps.length, 'step')}
            {selectionCount > 0 && ` · ${formatInteger(selectionCount)} selected`}
          </span>
        }
        actions={
          <Toolbar label="History">
            <Button
              size="sm"
              variant="ghost"
              aria-disabled={unavailable(!history.canUndo)}
              title={history.undoLabel === null ? 'Nothing to undo (Ctrl+Z)' : `Undo ${history.undoLabel} (Ctrl+Z)`}
              onClick={actions.undo}
            >
              Undo
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-disabled={unavailable(!history.canRedo)}
              title={history.redoLabel === null ? 'Nothing to redo (Ctrl+Shift+Z)' : `Redo ${history.redoLabel} (Ctrl+Shift+Z or Ctrl+Y)`}
              onClick={actions.redo}
            >
              Redo
            </Button>
          </Toolbar>
        }
      />
      <div className="frl-app-banner" role="note">
        {placeholder && (
          <p className="frl-app-banner__line">
            <PlaceholderTag what="data" />
            <span>{PLACEHOLDER_DATA_NOTICE}</span>
          </p>
        )}
        {notice !== null && (
          <p className="frl-app-banner__line">
            <PlaceholderTag label="Sample" what="route" />
            <span>{notice}</span>
          </p>
        )}
        <p className="frl-app-banner__legend">
          <span aria-hidden="true">{UNKNOWN_LEGEND}</span>
          <VisuallyHidden>{UNKNOWN_LEGEND_SPOKEN}</VisuallyHidden>
        </p>
      </div>
      <div className="frl-app-route__toolbar">
        <Toolbar label="Route actions">
          <Button
            size="sm"
            variant="ghost"
            icon="add"
            aria-disabled={unavailable(!canEdit)}
            title="Insert a note after the selection"
            onClick={whenEditable(() => {
              actions.insertNote();
              store.setView({ rightTab: 'details' });
            })}
          >
            Note
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="add"
            aria-disabled={unavailable(!canEdit)}
            title="Insert a travel step (destination not set) after the selection"
            onClick={whenEditable(actions.insertTravel)}
          >
            Travel
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="add"
            aria-disabled={unavailable(!canEdit)}
            title={INSERT_GRIND_TITLE}
            onClick={whenEditable(actions.insertGrind)}
          >
            Grind
          </Button>
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
            label="Lock or unlock selected steps"
            shortcut="L"
            size="sm"
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
        </Toolbar>
      </div>
      <div className="frl-app-route__list">
        <RouteList
          rows={view.rows}
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
          emptyState={<EmptyState title="The route is empty">Insert a note, travel or grind step to begin.</EmptyState>}
        />
      </div>
    </div>
  );
});
