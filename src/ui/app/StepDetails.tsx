import { memo, useId, useMemo } from 'react';
import { closeOpenedQuests, type EditorState, type EditorStore, shownOpenedQuests, updateStepNote } from '../../app';
import type { MapController } from '../../app/map-exports';
import { useEditor } from '../../app/react';
import { routeGroup } from '../../app/rules-exports';
import { editNoteText, stepQuestIds } from '../../app/shell-support';
import { hasGuideEscapes, plainGuideText } from '../../app/ui-text';
import type { CharacterProfile } from '../../domain/project';
import type { DatasetView } from '../../domain/dataset';
import type { QuestId } from '../../domain/ids';
import type { Route, RouteStep } from '../../domain/route';
import { type ActiveRow, entityName, grindTargetText, originText, type RouteView, SIMULATION_PENDING, stepTitle } from '../app-model';
import {
  Button,
  DetailList,
  EmptyState,
  PanelSection,
  ReadoutValue,
  STEP_KIND_LABELS,
  StepTypeGlyph,
  TextInput,
  formatDuration,
  formatInteger,
  plural,
  unknownReadout,
  type DetailItem,
} from '../kit';
import type { Announce } from './LiveAnnouncer';
import { QuestDetails, type QuestActions } from './QuestDetails';
import type { RouteActions } from './route-actions';
import { selectCharacter, selectEditingLocked, selectSelectionCount, useActiveTarget } from './selectors';
import { DurationEditor, LocationEditor } from './StepEditors';

const SIMULATION_READOUT = unknownReadout<number>(SIMULATION_PENDING);

/** Why the Details editors are unavailable while editing is locked. */
export const DETAILS_LOCKED = 'Unavailable while the optimiser runs or a proposal is open';

function kindDetails(step: RouteStep, dataset: DatasetView): DetailItem[] {
  switch (step.kind) {
    case 'accept':
    case 'turnin': {
      const items: DetailItem[] = [];
      if (step.via !== null) items.push({ term: step.kind === 'accept' ? 'From' : 'To', value: entityName(dataset, step.via) });
      if (step.anyOf !== null) items.push({ term: 'Any of', value: step.anyOf.map((id) => `#${String(id)}`).join(', ') });
      if (step.kind === 'turnin') {
        items.push({ term: 'Reward choice', value: step.rewardIndex === null ? 'Not set' : `Option ${String(step.rewardIndex)}` });
      }
      return items;
    }
    case 'complete':
      return [{ term: 'Progress', value: step.progress === 'finish' ? 'Finishes the objectives' : 'Partial: work continues in a later step' }];
    case 'abandon':
      return [];
    case 'travel':
      return [{ term: 'Mode', value: step.mode === 'auto' ? 'Automatic' : step.mode }];
    case 'grind':
      return [
        { term: 'Target', value: grindTargetText(step.until) },
        { term: 'Mob level', value: step.mobLevel === null ? 'Not set' : String(step.mobLevel) },
      ];
    case 'hearth':
      return [{ term: 'Action', value: step.mode === 'use' ? 'Teleport to the bind point' : 'Set the bind point here' }];
    case 'flight': {
      const node = (n: typeof step.from): string => {
        if (n === null) return 'Not set';
        if (n.name !== null) return n.name;
        return n.npcId === null ? 'Unnamed node' : entityName(dataset, { kind: 'npc', id: n.npcId });
      };
      return [
        { term: 'Action', value: step.mode === 'take' ? 'Take a flight' : 'Discover the flight path' },
        { term: 'From', value: node(step.from) },
        { term: 'To', value: node(step.to) },
      ];
    }
    case 'train':
      return [
        { term: 'Training', value: step.what ?? 'Not set' },
        { term: 'Cost', value: step.cost === null ? 'Unknown' : formatInteger(step.cost) },
      ];
    case 'vendor':
      return [{ term: 'Buy or sell', value: step.what ?? 'Not set' }];
    case 'note':
      return step.preserved === null ? [] : [{ term: 'Preserved', value: `${plural(step.preserved.lines.length, 'source line')} kept for export` }];
  }
}

interface StepDetailsProps {
  readonly step: RouteStep;
  readonly number: number;
  readonly total: number;
  readonly route: Route;
  readonly dataset: DatasetView;
  readonly baseDataset: DatasetView | undefined;
  readonly character: CharacterProfile;
  readonly selectionCount: number;
  /** A group header is active: say that the actions cover the group. */
  readonly headerSelected: boolean;
  readonly editable: boolean;
  readonly store: EditorStore;
  readonly actions: RouteActions;
  readonly questActions: QuestActions | undefined;
  readonly mapController: MapController | null;
  readonly announce: Announce | undefined;
  /** Puts keyboard focus back in the route list (after Delete removes the step shown here). */
  readonly onFocusList: () => void;
}

function StepDetails({
  step,
  number,
  total,
  route,
  dataset,
  baseDataset,
  character,
  selectionCount,
  headerSelected,
  editable,
  store,
  actions,
  questActions,
  mapController,
  announce,
  onFocusList,
}: StepDetailsProps) {
  const group = routeGroup(route, step.groupId);
  const groupSize = step.groupId === null ? 0 : route.steps.filter((s) => s.groupId === step.groupId).length;
  const items: DetailItem[] = [
    {
      term: 'Type',
      value: (
        <span className="frl-app-inline">
          <StepTypeGlyph kind={step.kind} labelled={false} size={14} />
          {STEP_KIND_LABELS[step.kind]}
        </span>
      ),
    },
    { term: 'Title', value: stepTitle(step, dataset) },
    ...kindDetails(step, dataset),
    {
      term: 'Group',
      value: step.groupId === null ? 'None' : `${group?.rxp === null || group === null ? 'Step group' : 'Imported RXP step'} of ${plural(groupSize, 'step')}`,
    },
    { term: 'Locked', value: step.locked ? 'Yes: an anchor the optimiser keeps in place' : 'No' },
    { term: 'Origin', value: originText(step.origin) },
    {
      term: 'Duration',
      value:
        step.durationOverride === null ? (
          <ReadoutValue readout={SIMULATION_READOUT} format={formatDuration} />
        ) : (
          `${formatDuration(step.durationOverride)} (override)`
        ),
    },
    { term: 'Level after', value: <ReadoutValue readout={SIMULATION_READOUT} format={String} /> },
  ];
  const only: ReadonlySet<RouteStep['id']> = new Set([step.id]);
  const plainHintId = useId();
  // Imported guide text keeps its colour and icon codes for export; say how it reads (UI-F7).
  const plainText = step.kind === 'note' && hasGuideEscapes(step.text) ? plainGuideText(step.text) : null;
  const pick = useMemo(
    () => (mapController === null ? null : { controller: mapController, what: `the location of step ${formatInteger(number)}` }),
    [mapController, number],
  );
  return (
    <>
      <PanelSection title="Step" aside={<span className="frl-num">{`${formatInteger(number)} of ${formatInteger(total)}`}</span>}>
        {(selectionCount > 1 || headerSelected) && (
          <p className="frl-app-hint">
            {headerSelected ? 'A group header is active; showing its first step. ' : ''}
            {selectionCount > 1 ? `${formatInteger(selectionCount)} steps are selected; showing the active one.` : ''}
          </p>
        )}
        {!editable && <p className="frl-app-hint">{`${DETAILS_LOCKED}: the fields below are read-only.`}</p>}
        <DetailList items={items} />
        <div className="frl-app-fields">
          {step.kind === 'note' && (
            <TextInput
              label="Text"
              value={step.text}
              disabled={!editable}
              describedBy={plainText === null ? undefined : plainHintId}
              onChange={(text) => {
                store.dispatch(editNoteText(step.id, text));
              }}
            />
          )}
          {plainText !== null && (
            <p className="frl-app-hint" id={plainHintId}>
              {`Shown as “${plainText}”: the guide’s colour and icon codes are kept for export.`}
            </p>
          )}
          <TextInput
            label="Note"
            value={step.note ?? ''}
            placeholder="Add a note to this step"
            disabled={!editable}
            onChange={(note) => {
              store.dispatch(updateStepNote(step.id, note));
            }}
          />
          <LocationEditor
            key={`location:${step.id}`}
            label={step.kind === 'travel' ? 'Destination' : 'Location'}
            value={step.location}
            dataset={dataset}
            disabled={!editable}
            onChange={(location) => {
              actions.setLocation(step.id, location);
            }}
            pick={pick}
            announce={announce}
          />
          <DurationEditor
            key={`duration:${step.id}`}
            value={step.durationOverride}
            disabled={!editable}
            onChange={(seconds) => {
              actions.setDuration(step.id, seconds);
            }}
            announce={announce}
          />
        </div>
        <div className="frl-app-actions">
          <Button
            size="sm"
            icon={step.locked ? 'unlock' : 'lock'}
            disabled={!editable}
            onClick={() => {
              actions.toggleLock(only);
            }}
          >
            {step.locked ? 'Unlock' : 'Lock'}
          </Button>
          <Button
            size="sm"
            icon="duplicate"
            disabled={!editable}
            onClick={() => {
              actions.duplicateSteps(only);
            }}
          >
            Duplicate
          </Button>
          <Button
            size="sm"
            icon="delete"
            disabled={!editable}
            onClick={() => {
              // The step, and this button with it, leaves the panel: keep focus in the route.
              if (actions.deleteSteps(only)) onFocusList();
            }}
          >
            Delete
          </Button>
        </div>
      </PanelSection>
      {stepQuestIds(step).map((id) => (
        <QuestDetails key={id} questId={id} dataset={dataset} character={character} actions={questActions} baseDataset={baseDataset} />
      ))}
    </>
  );
}

export interface DetailsPanelProps {
  readonly store: EditorStore;
  readonly view: RouteView;
  readonly route: Route;
  readonly dataset: DatasetView;
  /** The project's data without its custom quests (DATA001-custom-shadowed); omitted: not said. */
  readonly baseDataset?: DatasetView | undefined;
  readonly activeRow: ActiveRow | null;
  readonly actions: RouteActions;
  /** Adds a quest's steps and opens the custom quest editor; omitted: quests are shown without actions. */
  readonly questActions?: QuestActions | undefined;
  /** For "Pick on map"; null or omitted without a map. */
  readonly mapController?: MapController | null | undefined;
  readonly announce?: Announce | undefined;
  readonly onFocusList: () => void;
}

/** The quests opened in Details while the selection they were opened under lasts (null otherwise). */
const selectOpenedQuests = (s: EditorState): readonly QuestId[] | null => shownOpenedQuests(s.view.openedQuests, s.selection);

interface OpenedQuestsProps {
  readonly questIds: readonly QuestId[];
  readonly dataset: DatasetView;
  readonly baseDataset: DatasetView | undefined;
  readonly character: CharacterProfile;
  readonly questActions: QuestActions | undefined;
  /** The active step's number, for the way back; 0 when there is none. */
  readonly activeNumber: number;
  readonly onClose: () => void;
}

/** Quests opened from a map marker or the Available tab, with the way back to the active step. */
function OpenedQuests({ questIds, dataset, baseDataset, character, questActions, activeNumber, onClose }: OpenedQuestsProps) {
  return (
    <>
      <PanelSection
        title={questIds.length === 1 ? 'Opened quest' : `${formatInteger(questIds.length)} opened quests`}
        aside={
          <Button size="sm" variant="ghost" onClick={onClose}>
            {activeNumber > 0 ? `Back to step ${formatInteger(activeNumber)}` : 'Close'}
          </Button>
        }
      >
        <p className="frl-app-hint">
          Opened from the map or the Available tab. Selecting a step in the route shows the step here again.
        </p>
      </PanelSection>
      {questIds.map((id) => (
        <QuestDetails key={id} questId={id} dataset={dataset} character={character} actions={questActions} baseDataset={baseDataset} />
      ))}
    </>
  );
}

/** The Details tab: opened quests, else the active step (and its quests), or an empty state. */
export const DetailsPanel = memo(function DetailsPanel({
  store,
  view,
  route,
  dataset,
  baseDataset,
  activeRow,
  actions,
  questActions,
  mapController = null,
  announce,
  onFocusList,
}: DetailsPanelProps) {
  const active = useActiveTarget(store, view, activeRow);
  const selectionCount = useEditor(store, selectSelectionCount);
  const editingLocked = useEditor(store, selectEditingLocked);
  const character = useEditor(store, selectCharacter);
  const opened = useEditor(store, selectOpenedQuests);
  if (opened !== null) {
    return (
      <OpenedQuests
        questIds={opened}
        dataset={dataset}
        baseDataset={baseDataset}
        character={character}
        questActions={questActions}
        activeNumber={active.step === null ? 0 : active.number}
        onClose={() => {
          // The button leaves the panel with the quests: continue from the route list.
          closeOpenedQuests(store);
          onFocusList();
        }}
      />
    );
  }
  if (active.step === null) {
    return <EmptyState title="No step selected">Select a step in the route to see its details here.</EmptyState>;
  }
  return (
    <StepDetails
      step={active.step}
      number={active.number}
      total={view.steps.length}
      route={route}
      dataset={dataset}
      baseDataset={baseDataset}
      character={character}
      selectionCount={selectionCount}
      headerSelected={active.header}
      editable={!editingLocked}
      store={store}
      actions={actions}
      questActions={questActions}
      mapController={mapController}
      announce={announce}
      onFocusList={onFocusList}
    />
  );
});
