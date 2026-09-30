import { useCallback, useMemo } from 'react';
import { type EditorState, type EditorStore, insertionIndex, openQuestsInDetails } from '../../app';
import { type DerivedState, selectQuestState } from '../../app/derived';
import type { MapController, MapPopoverTarget } from '../../app/map-exports';
import { buildMapPopover, type PopoverAction, type PopoverSection } from '../../app/map-popover';
import { useDerivedSelector, useEditor } from '../../app/react';
import type { DatasetView } from '../../domain/dataset';
import type { StepId } from '../../domain/ids';
import { formatInteger } from '../kit';
import { foreverProvenanceOf } from '../markers/provenance';
import { MapPopover, type MapPopoverActionView, type MapPopoverSectionView } from '../shell/MapPopover';
import type { RouteActions } from './route-actions';
import { DETAILS_LOCKED, selectEditingLocked } from './selectors';

/**
 * The map popover's container (docs/research/map-presentation.md §14.2; docs/UI.md §9 rule 15;
 * step MP.6), a lazy part (`lazy-parts.ts`): builds the popover's content from the map's target
 * (`app/map-popover.ts`) with the quest state and the places after the active step, and runs the
 * chosen action: an insert after the selection (announced as the other inserts are), a quest's part
 * (`addQuest`), Show in Details, or selecting steps. An action closes the popover and gives focus
 * back to the map; the Wowhead link opens its page in a new tab.
 */

export interface MapPopoverPanelProps {
  readonly target: MapPopoverTarget;
  readonly controller: MapController;
  readonly store: EditorStore;
  readonly dataset: DatasetView;
  readonly actions: RouteActions;
  /** Gives focus back to the map's surface. */
  readonly returnFocus: () => void;
  /** The map's stage: a press there is the map's own click, which closes the popover itself. */
  readonly stage: () => HTMLElement | null;
}

/** Where the inserts go, in words: after the selection's last step, as `insertionIndex` puts them. */
const selectAfter = (s: EditorState): string => {
  const index = insertionIndex(s.project.route.steps, s.selection);
  return index === 0 ? 'at the start of the route' : `after step ${formatInteger(index)}`;
};
const selectSteps = (s: EditorState) => s.project.route.steps;
const selectPlaces = (state: DerivedState | null) => state?.places ?? null;

const XP_BASIS = {
  'era-seed': { basis: 'era-fallback', detail: 'Era value from QuestieDB; Forever XP is unknown' },
  user: { basis: 'assumption', detail: 'entered by you' },
  'forever-observed': { basis: null, detail: 'observed in Forever' },
} as const;

function sectionView(section: PopoverSection): MapPopoverSectionView {
  const quest = section.quest;
  return {
    key: section.key,
    heading: section.heading,
    lines: section.lines,
    actions: section.actions.map(actionView),
    quest:
      quest === null
        ? null
        : {
            level: quest.level,
            difficulty: quest.difficulty,
            lowerBound: quest.lowerBound,
            xp: quest.xp === null ? null : { text: `${formatInteger(quest.xp.baseXp)} base XP`, ...XP_BASIS[quest.xp.basis] },
            provenance: quest.provenance === null ? null : foreverProvenanceOf(quest.provenance),
          },
  };
}

function actionView(action: PopoverAction): MapPopoverActionView {
  return { key: action.key, label: action.label, name: action.name, variant: action.variant, unavailable: action.unavailable, href: action.command.kind === 'link' ? action.command.href : undefined };
}

export function MapPopoverPanel({ target, controller, store, dataset, actions, returnFocus, stage }: MapPopoverPanelProps) {
  const after = useEditor(store, selectAfter);
  const steps = useEditor(store, selectSteps);
  const locked = useEditor(store, selectEditingLocked);
  const questState = useDerivedSelector(selectQuestState);
  const places = useDerivedSelector(selectPlaces);
  const model = useMemo(() => {
    const positions = new Map(steps.map((step, index) => [step.id, index + 1]));
    return buildMapPopover(target, {
      dataset,
      questState,
      places,
      after,
      locked: locked ? DETAILS_LOCKED : null,
      zoneName: (id) => dataset.zone(id)?.name ?? null,
      stepNumber: (id: StepId) => positions.get(id) ?? null,
    });
  }, [target, dataset, questState, places, after, locked, steps]);
  const byKey = useMemo(() => new Map([...model.sections.flatMap((section) => section.actions), ...model.footer].map((action) => [action.key, action])), [model]);

  const onClose = useCallback(
    (how: 'escape' | 'outside' | 'tab') => {
      controller.closePopover();
      if (how === 'escape') returnFocus();
    },
    [controller, returnFocus],
  );
  const onAction = useCallback(
    (key: string) => {
      const action = byKey.get(key);
      if (action === undefined || action.unavailable !== null) return;
      const command = action.command;
      controller.closePopover();
      switch (command.kind) {
        case 'add-quest':
          actions.addQuest(dataset, command.questId, command.parts);
          break;
        case 'details':
          openQuestsInDetails(store, command.questIds);
          break;
        case 'select':
          if (command.stepIds.length === 1 && command.stepIds[0] !== undefined) store.select({ kind: 'single', id: command.stepIds[0] });
          else store.select({ kind: 'set', ids: command.stepIds });
          break;
        case 'insert':
          actions.insertCommand(command.command);
          break;
        case 'link':
        case 'none':
          break;
      }
      returnFocus();
    },
    [byKey, controller, actions, dataset, store, returnFocus],
  );
  // Nothing is said on opening (its name is read with the focus); the inserts say their result.

  return (
    <MapPopover
      openKey={target.key}
      title={model.title}
      sections={model.sections.map(sectionView)}
      footer={model.footer.map(actionView)}
      at={target.at}
      onAction={onAction}
      onClose={onClose}
      insideOf={stage}
    />
  );
}
