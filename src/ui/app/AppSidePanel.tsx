import { memo } from 'react';
import type { EditorStore } from '../../app';
import { useEditor } from '../../app/react';
import type { DatasetView } from '../../domain/dataset';
import type { Route } from '../../domain/route';
import { type ActiveRow, panelTabOf, rightTabOf, type RouteView } from '../app-model';
import { EmptyState, SidePanel } from '../kit';
import { AvailableQuests } from './AvailableQuests';
import type { RouteActions } from './route-actions';
import { selectRightTab } from './selectors';
import { DetailsPanel } from './StepDetails';

export interface AppSidePanelProps {
  readonly store: EditorStore;
  readonly view: RouteView;
  readonly route: Route;
  readonly dataset: DatasetView;
  readonly activeRow: ActiveRow | null;
  readonly search: string;
  readonly actions: RouteActions;
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

/** The right-hand tabs. Only the tab choice is read here; each tab subscribes to its own slices. */
export const AppSidePanel = memo(function AppSidePanel({ store, view, route, dataset, activeRow, search, actions, onFocusList }: AppSidePanelProps) {
  const rightTab = useEditor(store, selectRightTab);
  return (
    <SidePanel
      activeTab={panelTabOf(rightTab)}
      onTabChange={(tab) => {
        store.setView({ rightTab: rightTabOf(tab) });
      }}
      available={<AvailableQuests store={store} dataset={dataset} search={search} />}
      questLog={QUEST_LOG}
      details={
        <DetailsPanel
          store={store}
          view={view}
          route={route}
          dataset={dataset}
          activeRow={activeRow}
          actions={actions}
          onFocusList={onFocusList}
        />
      }
      validation={VALIDATION}
      counts={COUNTS}
    />
  );
});
