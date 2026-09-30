import { memo, useCallback, useMemo } from 'react';
import type { DerivedState, EditorStore } from '../../app';
import { useDerivedSelector, useDerivedStore, useEditor } from '../../app/react';
import type { DatasetView } from '../../domain/dataset';
import { type ActiveRow, dataBadgeDetail, dataBadgeLabel, type RouteView, stepTitle } from '../app-model';
import {
  formatDuration,
  formatDurationLong,
  formatInteger,
  formatLevel,
  formatPercent,
  ReadoutValue,
  RouteSummary,
  type RouteSummaryRow,
  SimulationStatus,
  StatusBar,
} from '../kit';
import type { Readout } from '../lib/readout';
import {
  type MapNameOf,
  noResultsReason,
  questLogCountOf,
  questLogWords,
  routeMetricsView,
  sameQuestLogCount,
  sameSimulationStatus,
  simulationStatusOf,
  xpBarAt,
} from './derived-view';
import type { Announce } from './LiveAnnouncer';
import { sameResultsView, selectCharacter, selectDerived, selectRevision, selectRulesetId, useActiveTarget } from './selectors';

const OPTIMIZER = { state: 'unavailable', detail: 'The optimiser arrives in Milestone 7' } as const;

/** The ruleset badge's tooltip. */
export function rulesetDetail(rulesetId: string): string {
  return rulesetId === 'forever-beta'
    ? 'Forever beta: where a Forever value is unknown the Era value is used, and every number that depends on one carries the E mark; numbers that depend on assumptions carry ≈. Quest difficulty uses the Era yellow threshold (-2).'
    : 'Era 1.15: the Era rules, with numbers that depend on assumptions marked ≈.';
}

export const PATHS_PAUSED_MESSAGE = 'Computing walking paths paused: pending legs keep their straight-line estimates. Resume from the status bar.';
export const PATHS_RESUMED_MESSAGE = 'Computing walking paths resumed.';

export interface ActivePanelProps {
  readonly store: EditorStore;
  readonly view: RouteView;
  readonly dataset: DatasetView;
  readonly activeRow: ActiveRow | null;
  /** Says the result of Cancel and Resume (the shell's live region). */
  readonly announce?: Announce | undefined;
  /** World map names (the map panel's surfaces), for the travel sentences; omitted: "world map 1". */
  readonly mapName?: MapNameOf | undefined;
}

const quiet: Announce = () => undefined;

const percent = (value: number): string => formatPercent(value);

/**
 * One row of the route summary: a readout with its markers (pending while walking paths are
 * computed, for the numbers that depend on travel time) and its basis in words.
 */
function summaryRow(
  term: string,
  readout: Readout<number>,
  format: (value: number) => string,
  basis: string,
  options: { readonly formatLong?: (value: number) => string; readonly pending?: string | null } = {},
): RouteSummaryRow {
  return { term, basis, value: <ReadoutValue readout={readout} format={format} formatLong={options.formatLong} pending={options.pending ?? null} /> };
}

/**
 * The simulation's item (`SimulationStatus`), subscribed on its own: it is the only part of the
 * status bar that draws the paths' progress, so a progress tick re-renders it alone (PERF-11).
 */
const AppSimulationStatus = memo(function AppSimulationStatus({ announce, mapName }: { readonly announce: Announce; readonly mapName: MapNameOf | undefined }) {
  const derivedStore = useDerivedStore();
  const select = useCallback((state: DerivedState | null) => simulationStatusOf(state, mapName), [mapName]);
  const status = useDerivedSelector(select, sameSimulationStatus);
  const onCancel = useCallback(() => {
    if (derivedStore === null) return;
    derivedStore.cancelPaths();
    announce(PATHS_PAUSED_MESSAGE);
  }, [derivedStore, announce]);
  const onResume = useCallback(() => {
    if (derivedStore === null) return;
    derivedStore.resumePaths();
    announce(PATHS_RESUMED_MESSAGE);
  }, [derivedStore, announce]);
  return <SimulationStatus status={status} onCancel={derivedStore === null ? undefined : onCancel} onResume={derivedStore === null ? undefined : onResume} />;
});

/**
 * The status bar: the level after the active step (else at the end of the route), the active
 * step, the route's duration, XP and XP per hour with their markers (pending while walking paths
 * are computed), the route summary with every metric and its basis, the simulation's state
 * (computing paths with Cancel, paused with Resume, straight-line travel), and the identities.
 * It reads the derived results with `sameResultsView`, so the paths' progress re-renders only the
 * simulation item.
 */
export const AppStatusBar = memo(function AppStatusBar({ store, view, dataset, activeRow, announce = quiet, mapName }: ActivePanelProps) {
  const active = useActiveTarget(store, view, activeRow);
  const character = useEditor(store, selectCharacter);
  const rulesetId = useEditor(store, selectRulesetId);
  const revision = useEditor(store, selectRevision);
  const derived = useDerivedSelector(selectDerived, sameResultsView);
  const logCount = useDerivedSelector(questLogCountOf, sameQuestLogCount);
  const identity = dataset.identity;
  const logStep = logCount === null ? null : (view.numberOfStep.get(logCount.stepId) ?? null);
  const noResults = noResultsReason(derived);
  const logWhy = derived === null || derived.results === null ? `${noResults.charAt(0).toLowerCase()}${noResults.slice(1)}` : 'select a step to see the quest log after it';
  const questLog = questLogWords(logCount, logStep, character.priorHistory, logWhy);

  const metrics = useMemo(() => routeMetricsView(derived, revision, mapName), [derived, revision, mapName]);
  const activeId = active.step?.id ?? null;
  const activeNumber = active.number;
  const { startLevel, startXp } = character;
  const xp = useMemo(
    () => xpBarAt(derived, view, activeId === null ? null : { stepId: activeId, number: activeNumber }, { level: startLevel, xp: startXp }),
    [derived, view, activeId, activeNumber, startLevel, startXp],
  );

  // Every time-based number waits for the walking paths; XP and the level do not.
  const pending = metrics.provisional;
  const rows: RouteSummaryRow[] = [
    summaryRow('Duration', metrics.duration, formatDuration, metrics.basis.duration, { formatLong: formatDurationLong, pending }),
    summaryRow('XP gained', metrics.xpGained, formatInteger, metrics.basis.xpGained),
    summaryRow('Level reached', metrics.levelReached, formatLevel, metrics.basis.levelReached),
    summaryRow('XP per hour', metrics.xpPerHour, formatInteger, metrics.basis.xpPerHour, { pending }),
    summaryRow('Travel', metrics.travelShare, percent, metrics.basis.shares, { pending }),
    summaryRow('Combat and objectives', metrics.workShare, percent, metrics.basis.shares, { pending }),
    summaryRow('Interaction', metrics.interactionShare, percent, metrics.basis.shares, { pending }),
    summaryRow('Waiting', metrics.waitingShare, percent, metrics.basis.shares, { pending }),
  ];

  return (
    <StatusBar
      xp={xp}
      currentStep={active.step === null ? null : { number: active.number, total: view.steps.length, title: stepTitle(active.step, dataset) }}
      duration={metrics.duration}
      xpGained={metrics.xpGained}
      xpPerHour={metrics.xpPerHour}
      provisional={metrics.provisional}
      questLog={questLog}
      summary={<RouteSummary rows={rows} notes={metrics.notes} parameters={metrics.parameters} />}
      simulation={<AppSimulationStatus announce={announce} mapName={mapName} />}
      optimizer={OPTIMIZER}
      data={{ label: dataBadgeLabel(identity), detail: dataBadgeDetail(identity), placeholder: identity.dataRevision === 'placeholder' }}
      ruleset={{ label: rulesetId, detail: rulesetDetail(rulesetId), eraFallback: rulesetId === 'forever-beta' }}
    />
  );
});
