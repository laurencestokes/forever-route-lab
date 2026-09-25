import {
  createEmptyProject,
  type DatasetView,
  type GroupId,
  groupId,
  type IdSource,
  type Location,
  makeAcceptStep,
  makeCompleteStep,
  makeFlightStep,
  makeGrindStep,
  makeHearthStep,
  makeNoteStep,
  makeTrainStep,
  makeTravelStep,
  makeTurnInStep,
  makeVendorStep,
  type NpcId,
  type ProjectV1,
  type QuestId,
  type RouteStep,
  sequentialIdSource,
  type TaxiNodeRef,
  zoneSourcedPoint,
} from '../domain';
import {
  createPlaceholderDataset,
  PLACEHOLDER_DATA_REVISION,
  PLACEHOLDER_NPC_IDS,
  PLACEHOLDER_QUEST_IDS,
  PLACEHOLDER_SPOTS,
  type PlaceholderSpot,
} from '../infra/data/placeholder-dataset';

/**
 * The Milestone 1 placeholder project, now a TEST FIXTURE only: about forty steps over the
 * placeholder dataset (src/infra/data/placeholder-dataset.ts), built with the step factories. It
 * covers every common step kind, one locked step and one group, and it is labelled "Placeholder"
 * throughout; nothing in it is real quest data. The shell's editing tests use it. The running app
 * opens the sample project built from the real dataset instead (sample-route.ts, workspace.ts), and
 * tests/placeholder-usage.test.ts keeps this file out of it.
 */

/** Shown as the project name in the top bar; ProjectV1 itself has no name, only its route. */
export const PLACEHOLDER_PROJECT_NAME = 'Placeholder project';
export const PLACEHOLDER_ROUTE_NAME = 'Placeholder route';

const at = (spot: PlaceholderSpot): Location => ({
  source: zoneSourcedPoint(spot.uiMapId, spot.x, spot.y),
  label: spot.label,
  radius: null,
});

const npc = (id: NpcId) => ({ kind: 'npc', id }) as const;

const VALE_NODE: TaxiNodeRef = { npcId: PLACEHOLDER_NPC_IDS.valeFlightKeeper, taxiNodeId: null, name: 'Placeholder Vale' };
const RIDGE_NODE: TaxiNodeRef = { npcId: PLACEHOLDER_NPC_IDS.ridgeFlightKeeper, taxiNodeId: null, name: 'Placeholder Ridge' };

function placeholderSteps(ids: IdSource, group: GroupId): RouteStep[] {
  const Q = PLACEHOLDER_QUEST_IDS;
  const N = PLACEHOLDER_NPC_IDS;
  const S = PLACEHOLDER_SPOTS;
  const accept = (questId: QuestId, giver: NpcId, spot: PlaceholderSpot) =>
    makeAcceptStep(ids, { questId, via: npc(giver), location: at(spot) });
  const turnIn = (questId: QuestId, giver: NpcId, spot: PlaceholderSpot, locked = false) =>
    makeTurnInStep(ids, { questId, via: npc(giver), location: at(spot), locked });
  const complete = (questIds: readonly QuestId[], spot: PlaceholderSpot, grouped = false) =>
    makeCompleteStep(ids, {
      targets: questIds.map((questId) => ({ questId, objective: null })),
      location: at(spot),
      ...(grouped ? { groupId: group } : {}),
    });
  const travel = (spot: PlaceholderSpot, grouped = false) =>
    makeTravelStep(ids, { location: at(spot), ...(grouped ? { groupId: group } : {}) });
  const grindTo = (level: number, spot: PlaceholderSpot) =>
    makeGrindStep(ids, { until: { kind: 'level', level, offset: null }, location: at(spot) });

  return [
    makeNoteStep(ids, { text: 'Placeholder route: sample steps for the Milestone 1 shell, not real quest data' }),
    accept(Q.kill, N.quartermaster, S.camp),
    accept(Q.item, N.quartermaster, S.camp),
    accept(Q.delivery, N.quartermaster, S.camp),
    travel(S.meadow),
    complete([Q.kill], S.meadow),
    grindTo(2, S.meadow),
    travel(S.grove),
    complete([Q.item], S.grove),
    travel(S.camp),
    // The one locked step: an anchor the optimiser (Milestone 7) will keep in place.
    turnIn(Q.kill, N.quartermaster, S.camp, true),
    turnIn(Q.item, N.quartermaster, S.camp),
    accept(Q.followUp, N.quartermaster, S.camp),
    makeHearthStep(ids, { mode: 'bind', location: at(S.inn), note: 'Placeholder Innkeeper' }),
    accept(Q.object, N.scout, S.camp),
    // The one group: three steps that belong together, as an imported RXP step would.
    travel(S.ruins, true),
    makeCompleteStep(ids, {
      targets: [
        { questId: Q.object, objective: 0 },
        { questId: Q.followUp, objective: 0 },
      ],
      location: at(S.ruins),
      groupId: group,
    }),
    makeNoteStep(ids, { text: 'Placeholder note in a group: both objectives share one area', groupId: group }),
    grindTo(3, S.ruins),
    makeHearthStep(ids, { mode: 'use' }),
    turnIn(Q.object, N.scout, S.camp),
    turnIn(Q.followUp, N.quartermaster, S.camp),
    travel(S.valeFlight),
    makeFlightStep(ids, { mode: 'discover', to: VALE_NODE, location: at(S.valeFlight) }),
    makeFlightStep(ids, { mode: 'take', from: VALE_NODE, to: RIDGE_NODE, nodeQuery: 'Placeholder Ridge', location: at(S.ridgeFlight) }),
    makeFlightStep(ids, { mode: 'discover', to: RIDGE_NODE, location: at(S.ridgeFlight) }),
    travel(S.outpost),
    turnIn(Q.delivery, N.herbalist, S.outpost),
    accept(Q.secondZone, N.herbalist, S.outpost),
    accept(Q.hordeOnly, N.herbalist, S.outpost),
    makeVendorStep(ids, { what: 'Placeholder supplies', location: at(S.outpost), note: 'Placeholder Supplier' }),
    makeTrainStep(ids, { skill: 'class', what: 'Placeholder class training', location: at(S.outpost), note: 'Placeholder Trainer' }),
    makeTravelStep(ids, { mode: 'walk', location: at(S.banditCamp) }),
    complete([Q.secondZone, Q.hordeOnly], S.banditCamp),
    grindTo(4, S.banditCamp),
    travel(S.outpost),
    turnIn(Q.secondZone, N.herbalist, S.outpost),
    makeHearthStep(ids, { mode: 'use' }),
    turnIn(Q.hordeOnly, N.quartermaster, S.camp),
    makeNoteStep(ids, { text: 'End of the placeholder route' }),
  ];
}

export interface PlaceholderProjectOptions {
  readonly nowIso: string;
  /** Defaults to a sequential source, so the placeholder is the same on every load. */
  readonly ids?: IdSource;
}

/** The placeholder project. Deterministic for a given IdSource and time. */
export function createPlaceholderProject(opts: PlaceholderProjectOptions): ProjectV1 {
  const ids = opts.ids ?? sequentialIdSource();
  const project = createEmptyProject({
    ids,
    nowIso: opts.nowIso,
    name: PLACEHOLDER_ROUTE_NAME,
    dataRevision: PLACEHOLDER_DATA_REVISION,
    character: { startLocation: at(PLACEHOLDER_SPOTS.camp) },
  });
  const group = groupId(ids.next('group'));
  return {
    ...project,
    route: {
      ...project.route,
      description: 'Placeholder content for the Milestone 1 shell. Not real quest data.',
      steps: placeholderSteps(ids, group),
      groups: { [group]: { id: group, rxp: null } },
    },
  };
}

/** The placeholder project and dataset (test fixture). */
export interface PlaceholderWorkspace {
  readonly project: ProjectV1;
  readonly dataset: DatasetView;
}

/**
 * The placeholder project together with the placeholder dataset it refers to, for the shell's
 * tests: ui may not import infra itself (ARCHITECTURE §4).
 */
export function createPlaceholderWorkspace(opts: PlaceholderProjectOptions): PlaceholderWorkspace {
  return { project: createPlaceholderProject(opts), dataset: createPlaceholderDataset() };
}
