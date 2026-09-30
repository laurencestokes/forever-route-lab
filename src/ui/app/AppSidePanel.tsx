import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type EditorStore, openQuestsInDetails } from '../../app';
import type { MapController } from '../../app/map-exports';
import { deleteCustomQuest } from '../../app/project-commands';
import { useDerivedSelector, useEditor } from '../../app/react';
import type { DatasetView } from '../../domain/dataset';
import type { QuestId } from '../../domain/ids';
import type { Route } from '../../domain/route';
import { type ActiveRow, panelTabOf, rightTabOf, type RouteView } from '../app-model';
import { Button, PanelSection, SidePanel } from '../kit';
import { AvailableQuests } from './AvailableQuests';
import type { CustomQuestEdit, CustomQuestEditorClose } from './CustomQuestEditor';
import { questLogCountOf, questLogWords, sameQuestLogCount } from './derived-view';
import { loadCustomQuestEditor, loadDetailsPanel, loadQuestLogPanel, loadValidationPanel, useLazy } from './lazy';
import type { Announce } from './LiveAnnouncer';
import type { QuestActions } from './QuestDetails';
import type { RouteActions } from './route-actions';
import { DETAILS_LOCKED, sameCounts, selectCharacter, selectEditingLocked, selectIssueCounts, selectRightTab } from './selectors';

export interface AppSidePanelProps {
  readonly store: EditorStore;
  readonly view: RouteView;
  readonly route: Route;
  readonly dataset: DatasetView;
  /** The project's data without its custom quests (DATA001-custom-shadowed); omitted: not said. */
  readonly baseDataset?: DatasetView | undefined;
  readonly activeRow: ActiveRow | null;
  readonly search: string;
  /** The Available tab's filter edits the quest search (one text, two fields); omitted: the tab has no filter field. */
  readonly onSearchChange?: ((value: string) => void) | undefined;
  readonly actions: RouteActions;
  /** For "Pick on map" in Details; null or omitted without a map. */
  readonly mapController?: MapController | null | undefined;
  readonly announce?: Announce | undefined;
  readonly onFocusList: () => void;
}


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
  onSearchChange,
  actions,
  mapController = null,
  announce = quiet,
  onFocusList,
}: AppSidePanelProps) {
  const rightTab = useEditor(store, selectRightTab);
  const editingLocked = useEditor(store, selectEditingLocked);
  // Unknown (null) until the route is checked, so the tab never claims "no issues" early.
  const issueCounts = useDerivedSelector(selectIssueCounts, sameCounts);
  // The Quest log tab's count after the active step ("Quest log, 4 quests after step 12"; review UR-11).
  const logCount = useDerivedSelector(questLogCountOf, sameQuestLogCount);
  const priorHistory = useEditor(store, selectCharacter).priorHistory;
  const logStep = logCount === null ? null : (view.numberOfStep.get(logCount.stepId) ?? null);
  const logWords = logCount === null ? null : questLogWords(logCount, logStep, priorHistory, '');
  const logBadge = logWords?.badge ?? null;
  const logLabel = logWords?.badgeLabel ?? null;
  const counts = useMemo(
    () => ({ available: null, questLog: logBadge === null || logLabel === null ? null : { badge: logBadge, badgeLabel: logLabel }, validation: issueCounts }),
    [issueCounts, logBadge, logLabel],
  );
  // The Quest log tab loads on first use, with the other lazy parts (ui-refresh.md §5.5).
  const questLogCode = useLazy(loadQuestLogPanel, rightTab === 'context');
  // The validation panel loads on first use (lazy.tsx), with the issue-code registry.
  const validationCode = useLazy(loadValidationPanel, rightTab === 'validation');
  // So does the Details panel (ui-refresh.md §10.3, UR.1a); production builds preload it when idle.
  const detailsCode = useLazy(loadDetailsPanel, rightTab === 'details');
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
  const onOpenQuest = useCallback(
    (id: QuestId) => {
      openQuestsInDetails(store, [id]);
    },
    [store],
  );

  const details =
    editor === null ? (
      detailsCode.kind === 'ready' ? (
        <detailsCode.value.DetailsPanel
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
      ) : detailsCode.kind === 'failed' ? (
        <PanelSection title="Details">
          <p className="frl-app-hint">{`The details panel could not be loaded (${detailsCode.message}). Check the connection and try again.`}</p>
          <div className="frl-app-actions">
            <Button size="sm" onClick={detailsCode.retry}>
              Try again
            </Button>
          </div>
        </PanelSection>
      ) : (
        <PanelSection title="Details">
          <p className="frl-app-hint">Loading the details panel…</p>
        </PanelSection>
      )
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
      available={
        <AvailableQuests store={store} dataset={dataset} search={search} onSearchChange={onSearchChange} questActions={questActions} onNewCustomQuest={onNewCustomQuest} />
      }
      questLog={
        questLogCode.kind === 'ready' ? (
          <questLogCode.value.QuestLogPanel store={store} view={view} dataset={dataset} questActions={questActions} onOpen={onOpenQuest} />
        ) : questLogCode.kind === 'failed' ? (
          <PanelSection title="Quest log">
            <p className="frl-app-hint">{`The quest log could not be loaded (${questLogCode.message}). Check the connection and try again.`}</p>
            <div className="frl-app-actions">
              <Button size="sm" onClick={questLogCode.retry}>
                Try again
              </Button>
            </div>
          </PanelSection>
        ) : (
          <PanelSection title="Quest log">
            <p className="frl-app-hint">Loading the quest log…</p>
          </PanelSection>
        )
      }
      details={details}
      validation={
        validationCode.kind === 'ready' ? (
          <validationCode.value.ValidationPanel store={store} view={view} announce={announce} onFocusList={onFocusList} />
        ) : validationCode.kind === 'failed' ? (
          <PanelSection title="Issues">
            <p className="frl-app-hint">{`The validation panel could not be loaded (${validationCode.message}). Check the connection and try again.`}</p>
            <div className="frl-app-actions">
              <Button size="sm" onClick={validationCode.retry}>
                Try again
              </Button>
            </div>
          </PanelSection>
        ) : (
          <PanelSection title="Issues">
            <p className="frl-app-hint">Loading the validation panel…</p>
          </PanelSection>
        )
      }
      counts={counts}
    />
  );
});
