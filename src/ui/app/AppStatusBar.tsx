import { memo } from 'react';
import type { EditorStore } from '../../app';
import { useEditor } from '../../app/react';
import type { DatasetView } from '../../domain/dataset';
import { type ActiveRow, dataBadgeDetail, dataBadgeLabel, type RouteView, SIMULATION_PENDING, stepTitle } from '../app-model';
import { StatusBar, unknownReadout } from '../kit';
import { selectCharacter, selectRulesetId, useActiveTarget } from './selectors';

const SIMULATION_READOUT = unknownReadout<number>(SIMULATION_PENDING);
const OPTIMIZER = { state: 'unavailable', detail: 'The optimiser arrives in Milestone 7' } as const;
const RULESET_DETAIL =
  'Quest difficulty uses the Era yellow threshold (-2); the Forever value is unknown. Other rules arrive with simulation in Milestone 6.';

export interface ActivePanelProps {
  readonly store: EditorStore;
  readonly view: RouteView;
  readonly dataset: DatasetView;
  readonly activeRow: ActiveRow | null;
}

/** The status bar: the start level as a lower bound, the active step, and everything else unknown until simulation. */
export const AppStatusBar = memo(function AppStatusBar({ store, view, dataset, activeRow }: ActivePanelProps) {
  const active = useActiveTarget(store, view, activeRow);
  const character = useEditor(store, selectCharacter);
  const rulesetId = useEditor(store, selectRulesetId);
  const identity = dataset.identity;
  return (
    <StatusBar
      xp={{
        level: character.startLevel,
        xp: character.startXp,
        xpToNext: null,
        lowerBound: true,
        lowerBoundReason: `the character's start level; ${SIMULATION_PENDING.toLowerCase()}`,
        unknownReason: SIMULATION_PENDING,
      }}
      currentStep={active.step === null ? null : { number: active.number, total: view.steps.length, title: stepTitle(active.step, dataset) }}
      duration={SIMULATION_READOUT}
      xpPerHour={SIMULATION_READOUT}
      optimizer={OPTIMIZER}
      data={{ label: dataBadgeLabel(identity), detail: dataBadgeDetail(identity), placeholder: identity.dataRevision === 'placeholder' }}
      ruleset={{ label: rulesetId, detail: RULESET_DETAIL, eraFallback: true }}
    />
  );
});
