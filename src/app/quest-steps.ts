import {
  type CustomQuest,
  type DatasetView,
  type EntityRef,
  type IdSource,
  insertSteps,
  type Location,
  makeAcceptStep,
  makeCompleteStep,
  makeTurnInStep,
  type ObjectiveDef,
  type ProjectV1,
  type PublishedPoint,
  type QuestId,
  type QuestRecord,
  type RouteStep,
  type SourcedPoint,
  type WorldPoint,
} from '../domain';
import { distanceYards, type MapGeometry, resolve } from '../geo';
import { type Command, insertionIndex } from './commands';

/**
 * Adding quest steps from the Available tab and Details (ARCHITECTURE §8.1, §12.4; UI.md §8):
 * accept, complete (one objective or all of them) and turn in, as one command each or all three as
 * one command. New steps go after the selection (the insertion point of every insert command,
 * `insertionIndex`), which is where a planner is working (docs/research/ux-benchmark.md).
 *
 * **Where.** A step's location is the relevant spawn nearest the insertion context, by straight
 * line (`distanceYards`): the starter's spawns for an accept, the finisher's for a turn-in, and the
 * objectives' targets for a complete (a kill's creature, an object, an item's drop sources, an
 * event's points). The context is the last step before the insertion point whose location
 * resolves, else the character's start location; each added step then becomes the context of the
 * next one, so "accept, complete, turn in" walks from the giver to the work to the receiver. With
 * no context, the first spawn the dataset lists is taken. Spawns on another world map than the
 * context come after every spawn on it. The location is the spawn's published point, as published
 * (D-017): nothing derived is stored. A spawn with no published zone point (inside an instance, an
 * unmapped area) is never used, and a part with no usable spawn gets no location: unknown, not
 * guessed. A custom quest's own starter or finisher location counts as one more spawn.
 */

export type QuestStepPart = 'accept' | 'complete' | 'turnin';

/** The order the parts of one quest are added in. */
export const QUEST_STEP_PARTS: readonly QuestStepPart[] = ['accept', 'complete', 'turnin'];

/** A place a quest part can happen: an entity's spawn, or a custom quest's own location. */
export interface QuestSpot {
  /** The entity the step is taken at or handed to; null for a custom quest's own location. */
  readonly via: EntityRef | null;
  readonly location: Location;
  /** The point's world position, when geometry places it; null when it cannot be placed. */
  readonly world: WorldPoint | null;
}

export interface QuestStepOptions {
  readonly dataset: DatasetView;
  /** Places zone-percent step locations for the insertion context; null: only world-form locations do. */
  readonly geometry: MapGeometry | null;
  /** For `complete`: the objective (Questie ObjectiveData index), or null for all of them. */
  readonly objective?: number | null | undefined;
  /** Insert before this index; null or omitted: after the selection (`insertionIndex`). */
  readonly at?: number | null | undefined;
}

function entityName(dataset: DatasetView, ref: EntityRef): string | null {
  switch (ref.kind) {
    case 'npc':
      return dataset.npc(ref.id)?.name ?? null;
    case 'object':
      return dataset.object(ref.id)?.name ?? null;
    case 'item':
      return dataset.item(ref.id)?.name ?? null;
  }
}

const isSourced = (point: PublishedPoint): point is SourcedPoint => 'space' in point;

/** The spots of an NPC or object: its published zone points, with the world position the dataset gives them. */
function entitySpots(dataset: DatasetView, ref: EntityRef): QuestSpot[] {
  if (ref.kind === 'item') return [];
  const label = entityName(dataset, ref);
  return dataset.spawns(ref).flatMap((spawn): QuestSpot[] =>
    isSourced(spawn.source) ? [{ via: ref, location: { source: spawn.source, label, radius: null }, world: spawn.world }] : [],
  );
}

function customSpot(location: Location | null, geometry: MapGeometry | null): QuestSpot[] {
  return location === null ? [] : [{ via: null, location, world: worldOf(location, geometry) }];
}

/** A world-form point is its own world position; a zone point needs geometry. */
function worldOf(location: Location, geometry: MapGeometry | null): WorldPoint | null {
  const point = location.source;
  if (geometry !== null) return resolve(location, geometry);
  if (point.space === 'world' && Number.isFinite(point.x) && Number.isFinite(point.y)) return { mapId: point.mapId, x: point.x, y: point.y };
  return null;
}

function objectiveSpots(dataset: DatasetView, objective: ObjectiveDef, geometry: MapGeometry | null): QuestSpot[] {
  switch (objective.kind) {
    case 'kill':
      return entitySpots(dataset, { kind: 'npc', id: objective.npcId });
    case 'object':
      return entitySpots(dataset, { kind: 'object', id: objective.objectId });
    case 'killCredit': {
      const ids = [objective.rootNpcId, ...objective.npcIds.filter((id) => id !== objective.rootNpcId)];
      return ids.flatMap((id) => entitySpots(dataset, { kind: 'npc', id }));
    }
    case 'item': {
      const item = dataset.item(objective.itemId);
      if (item === undefined) return [];
      return [
        ...item.dropNpcs.flatMap((id) => entitySpots(dataset, { kind: 'npc', id })),
        ...item.dropObjects.flatMap((id) => entitySpots(dataset, { kind: 'object', id })),
      ];
    }
    case 'event':
      return objective.points.flatMap((point): QuestSpot[] => {
        if (!isSourced(point)) return [];
        const location: Location = { source: point, label: objective.text, radius: null };
        return [{ via: null, location, world: worldOf(location, geometry) }];
      });
    case 'reputation':
    case 'spell':
      return [];
  }
}

/**
 * Where a part of `quest` can happen, in dataset order: its starters' or finishers' spawns (and a
 * custom quest's own location), or its objectives' targets (`objective` null: all objectives).
 */
export function questPartSpots(
  dataset: DatasetView,
  quest: QuestRecord,
  part: QuestStepPart,
  options: { readonly objective?: number | null | undefined; readonly custom?: CustomQuest | null | undefined; readonly geometry?: MapGeometry | null | undefined } = {},
): readonly QuestSpot[] {
  const geometry = options.geometry ?? null;
  const custom = options.custom ?? null;
  switch (part) {
    case 'accept':
      return [...quest.starters.flatMap((ref) => entitySpots(dataset, ref)), ...customSpot(custom?.starterLocation ?? null, geometry)];
    case 'turnin':
      return [...quest.finishers.flatMap((ref) => entitySpots(dataset, ref)), ...customSpot(custom?.finisherLocation ?? null, geometry)];
    case 'complete': {
      const index = options.objective ?? null;
      const objectives = index === null ? quest.objectives : quest.objectives.slice(index, index + 1);
      return objectives.flatMap((objective) => objectiveSpots(dataset, objective, geometry));
    }
  }
}

/**
 * The spot nearest `context` by straight line on its world map; spots on other world maps, or that
 * cannot be placed, come after, in their order. Ties keep the earlier spot. Without a context, the
 * first spot that can be placed, else the first spot. Null when there is none.
 */
export function nearestSpot(spots: readonly QuestSpot[], context: WorldPoint | null): QuestSpot | null {
  let best: QuestSpot | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const spot of spots) {
    if (spot.world === null) continue;
    if (context === null) return spot;
    const distance = distanceYards(context, spot.world);
    if (distance !== null && distance < bestDistance) {
      best = spot;
      bestDistance = distance;
    }
  }
  if (best !== null) return best;
  return spots.find((spot) => spot.world !== null) ?? spots[0] ?? null;
}

/**
 * Where the character is when a step is inserted at `index`: the last step before it whose location
 * resolves, else the character's start location, else unknown (null).
 */
export function insertionContext(project: Pick<ProjectV1, 'route' | 'character'>, index: number, geometry: MapGeometry | null): WorldPoint | null {
  const steps = project.route.steps;
  for (let i = Math.min(index, steps.length) - 1; i >= 0; i -= 1) {
    const location = steps[i]?.location ?? null;
    if (location === null) continue;
    const world = worldOf(location, geometry);
    if (world !== null) return world;
  }
  const start = project.character.startLocation;
  return start === null ? null : worldOf(start, geometry);
}

/** The custom quest with this id in the project, or null. */
export function customQuestOf(project: Pick<ProjectV1, 'customQuests'>, id: QuestId): CustomQuest | null {
  // The dataset view lets a later entry win when an id repeats (the schema refuses repeats).
  let found: CustomQuest | null = null;
  for (const quest of project.customQuests) if (quest.id === id) found = quest;
  return found;
}

/** What `addQuestSteps` would insert: the steps and the context each was placed from. */
export function planQuestSteps(
  project: ProjectV1,
  ids: IdSource,
  questId: QuestId,
  parts: readonly QuestStepPart[],
  index: number,
  options: Pick<QuestStepOptions, 'dataset' | 'geometry' | 'objective'>,
): RouteStep[] {
  const { dataset, geometry } = options;
  const quest = dataset.quest(questId);
  const custom = customQuestOf(project, questId);
  let context = insertionContext(project, index, geometry);
  const steps: RouteStep[] = [];
  for (const part of QUEST_STEP_PARTS.filter((p) => parts.includes(p))) {
    const spot = quest === undefined ? null : nearestSpot(questPartSpots(dataset, quest, part, { objective: options.objective ?? null, custom, geometry }), context);
    const location = spot?.location ?? null;
    const via = spot?.via ?? null;
    switch (part) {
      case 'accept':
        steps.push(makeAcceptStep(ids, { questId, location, via }));
        break;
      case 'complete':
        steps.push(makeCompleteStep(ids, { targets: [{ questId, objective: options.objective ?? null }], location }));
        break;
      case 'turnin':
        steps.push(makeTurnInStep(ids, { questId, location, via }));
        break;
    }
    if (spot?.world !== null && spot?.world !== undefined) context = spot.world;
  }
  return steps;
}

const PART_LABELS: Readonly<Record<QuestStepPart, string>> = { accept: 'Add accept', complete: 'Add complete', turnin: 'Add turn-in' };

/**
 * One command that inserts steps for `parts` of a quest (in accept, complete, turn-in order,
 * whatever order `parts` lists them in), after the selection unless `at` is given. The new steps
 * become the selection. All three parts are one undo entry ("Add quest").
 */
export function addQuestSteps(questId: QuestId, parts: readonly QuestStepPart[], options: QuestStepOptions): Command {
  const wanted = QUEST_STEP_PARTS.filter((p) => parts.includes(p));
  const [only] = wanted;
  const label = wanted.length === 1 && only !== undefined ? PART_LABELS[only] : 'Add quest';
  return {
    label,
    apply(project, ctx) {
      if (wanted.length === 0) return project;
      const steps = project.route.steps;
      const index = options.at ?? insertionIndex(steps, ctx.selection);
      const added = planQuestSteps(project, ctx.ids, questId, wanted, index, options);
      return { ...project, route: { ...project.route, steps: insertSteps(steps, index, added) } };
    },
  };
}
