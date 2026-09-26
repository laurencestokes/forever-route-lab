import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorStore } from '../../app';
import type { MapController } from '../../app/map-exports';
import { deleteCustomQuest } from '../../app/project-commands';
import { useEditor } from '../../app/react';
import type { DatasetView } from '../../domain/dataset';
import type { QuestId } from '../../domain/ids';
import type { Route } from '../../domain/route';
import { type ActiveRow, panelTabOf, rightTabOf, type RouteView } from '../app-model';
import { Button, EmptyState, PanelSection, SidePanel } from '../kit';
import { AvailableQuests } from './AvailableQuests';
import type { CustomQuestEdit, CustomQuestEditorClose } from './CustomQuestEditor';
import { loadCustomQuestEditor, useLazy } from './lazy';
import type { Announce } from './LiveAnnouncer';
import type { QuestActions } from './QuestDetails';
import type { RouteActions } from './route-actions';
import { selectEditingLocked, selectRightTab } from './selectors';
import { DETAILS_LOCKED, DetailsPanel } from './StepDetails';

export interface AppSidePanelProps {
  readonly store: EditorStore;
  readonly view: RouteView;
  readonly route: Route;
  readonly dataset: DatasetView;
  /** The project's data without its custom quests (DATA001-custom-shadowed); omitted: not said. */
  readonly baseDataset?: DatasetView | undefined;
  readonly activeRow: ActiveRow | null;
  readonly search: string;
  readonly actions: RouteActions;
  /** For "Pick on map" in Details; null or omitted without a map. */
  readonly mapController?: MapController | null | undefined;
  readonly announce?: Announce | undefined;
  readonly onFocusList: () => void;
}

const QUEST_LOG = (
  <EmptyState title="The quest log arrives in Milestone 6" placeholder>
    <p>It shows the quests in the log at the active step, which needs the route walker and simulation.</p>
  </EmptyState>
);

const VALIDATION = (
  <EmptyState title="Validation arrives in Milestone 6" placeholder>
    <p>
      Route checks (levels, prerequisites, quest log capacity, travel) need the simulator. Until then no issues are reported,
      and none are claimed to be absent.
    </p>
  </EmptyState>
);

/** Counts wait for simulation: unknown, so nothing claims "no issues". */
const COUNTS = { available: null, questLog: null, validation: null } as const;

const quiet: Announce = () => undefined;

/** The `data-focus-key` of the button that opens the custom quest editor for `edit` (QuestDetails, AvailableQuests). */
export function customQuestOpenerKey(edit: { readonly mode: 'new' | 'edit' | 'replace' | 'new-with-id'; readonly id?: QuestId | undefined }): string {
  return edit.id === undefined ? `custom-quest:${edit.mode}` : `custom-quest:${edit.mode}:${String(edit.id)}`;
}

/** Where focus goes after the custom quest editor closes: a button in the tab panel, else the panel. */
interface FocusReturn {
  readonly panel: HTMLElement | null;
  readonly key: string | null;
}

/** The side panel's one tab panel (docs/UI.md §9 rule 10), from the element that has focus in it. */
function focusedTabPanel(): HTMLElement | null {
  const active = typeof document === 'undefined' ? null : document.activeElement;
  return active instanceof HTMLElement ? active.closest<HTMLElement>('[role="tabpanel"]') : null;
}

/**
 * The right-hand tabs. Only the tab choice and the custom quest editor are held here; each tab
 * subscribes to its own slices. The editor shows in the Details tab, beside the map, so "Pick on
 * map" works while it is open. Opening it moves focus into it; closing it puts focus back on the
 * button that opened it when Cancel shows that button again, else on the tab panel, which then
 * shows the saved quest or the step (UI-F5). "Use the dataset record" removes its own button, so
 * focus moves to the "Replace with a custom quest" that takes its place.
 */
export const AppSidePanel = memo(function AppSidePanel({
  store,
  view,
  route,
  dataset,
  baseDataset,
  activeRow,
  search,
  actions,
  mapController = null,
  announce = quiet,
  onFocusList,
}: AppSidePanelProps) {
  const rightTab = useEditor(store, selectRightTab);
  const editingLocked = useEditor(store, selectEditingLocked);
  const [editor, setEditor] = useState<CustomQuestEdit | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  // The editor loads on first use (lazy.tsx, CR-19).
  const editorCode = useLazy(loadCustomQuestEditor, editor !== null);
  const opener = useRef<FocusReturn | null>(null);
  const pendingFocus = useRef<FocusReturn | null>(null);

  const openEditor = useCallback(
    (edit: CustomQuestEdit, openerKey: string) => {
      opener.current = { panel: focusedTabPanel(), key: openerKey };
      setEditor(edit);
      setEditorKey((key) => key + 1);
      store.setView({ rightTab: 'details' });
    },
    [store],
  );
  const closeEditor = useCallback((how: CustomQuestEditorClose) => {
    const back = opener.current;
    opener.current = null;
    pendingFocus.current = { panel: back?.panel ?? focusedTabPanel(), key: how === 'cancelled' ? (back?.key ?? null) : null };
    setEditor(null);
  }, []);

  // After the render that follows a close (or "Use the dataset record"): the button, else the panel.
  useEffect(() => {
    const pending = pendingFocus.current;
    if (pending === null || editor !== null) return;
    pendingFocus.current = null;
    const button = pending.key === null ? null : pending.panel?.querySelector<HTMLElement>(`[data-focus-key="${pending.key}"]`);
    (button ?? pending.panel)?.focus();
  });

  const questActions = useMemo(
    (): QuestActions => ({
      unavailable: editingLocked ? DETAILS_LOCKED : null,
      add: (questId: QuestId, parts, objective = null) => {
        actions.addQuest(dataset, questId, parts, objective);
      },
      editCustom: (edit) => {
        openEditor(
          edit.mode === 'new-with-id' ? { mode: 'new', id: edit.id } : edit.mode === 'edit' ? { mode: 'edit', id: edit.id } : { mode: 'replace', id: edit.id },
          customQuestOpenerKey(edit),
        );
      },
      deleteCustom: (id) => {
        const { revision } = store.getState();
        const panel = focusedTabPanel();
        store.dispatch(deleteCustomQuest(id));
        if (store.getState().revision === revision) return;
        // The button leaves with the custom quest; "Replace with a custom quest" takes its place.
        pendingFocus.current = { panel, key: customQuestOpenerKey({ mode: 'replace', id }) };
        announce('Custom quest deleted: the dataset record shows again. Undo with Ctrl+Z.');
      },
    }),
    [editingLocked, actions, dataset, openEditor, store, announce],
  );

  const onNewCustomQuest = useCallback(() => {
    openEditor({ mode: 'new' }, customQuestOpenerKey({ mode: 'new' }));
  }, [openEditor]);

  const details =
    editor === null ? (
      <DetailsPanel
        store={store}
        view={view}
        route={route}
        dataset={dataset}
        baseDataset={baseDataset}
        activeRow={activeRow}
        actions={actions}
        questActions={questActions}
        mapController={mapController}
        announce={announce}
        onFocusList={onFocusList}
      />
    ) : editorCode.kind === 'ready' ? (
      <editorCode.value.CustomQuestEditor
        key={editorKey}
        store={store}
        edit={editor}
        dataset={dataset}
        baseDataset={baseDataset ?? dataset}
        editable={!editingLocked}
        mapController={mapController}
        announce={announce}
        onClose={closeEditor}
      />
    ) : (
      <PanelSection title="Custom quest">
        {editorCode.kind === 'failed' ? (
          <>
            <p className="frl-app-hint">{`The custom quest editor could not be loaded (${editorCode.message}). Check the connection and try again.`}</p>
            <div className="frl-app-actions">
              <Button size="sm" onClick={editorCode.retry}>
                Try again
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  closeEditor('cancelled');
                }}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <p className="frl-app-hint">Loading the custom quest editor…</p>
        )}
      </PanelSection>
    );

  return (
    <SidePanel
      activeTab={panelTabOf(rightTab)}
      onTabChange={(tab) => {
        store.setView({ rightTab: rightTabOf(tab) });
      }}
      available={<AvailableQuests store={store} dataset={dataset} search={search} questActions={questActions} onNewCustomQuest={onNewCustomQuest} />}
      questLog={QUEST_LOG}
      details={details}
      validation={VALIDATION}
      counts={COUNTS}
    />
  );
});
