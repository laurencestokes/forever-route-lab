import type {
  CharacterProfile,
  DatasetView,
  EntityRef,
  Faction,
  NpcId,
  ObjectId,
  PublishedPoint,
  QuestId,
  QuestRecord,
  RouteStep,
  SpawnPoint,
  StepId,
  UiMapId,
  WorldMapId,
  WorldPoint,
} from '../domain';
import { isFullUiRectangle, resolvePoint, type MapGeometry } from '../geo';
import {
  boundsOfPoints,
  surfaceIdOf,
  type PointGroupInput,
  type PointSubject,
  type RouteInput,
  type RouteStepInput,
  type SpawnLayerInput,
  type StepFocus,
  type SurfaceId,
  type SurfaceInfo,
  type WorldBounds,
} from '../map/adapter';
import { groupDigits, plainEqual, routeStepInputOf } from '../map/layers';
import { isFlightMaster } from './dataset-source';
import { shownOpenedQuests, type OpenedQuests } from './map-view';
import type { Selection } from './selection';
import { questsForCharacter, stepQuestIds } from './shell-support';

/**
 * View models for the map (docs/ARCHITECTURE.md §7; docs/MAPS.md §7): the dataset, the character
 * and the route turned into the inputs `map/layers` builds descriptors from, plus the bounds and
 * placements the map commands need (fit route, focus step, jump to zone). Pure functions of their
 * arguments: no store, no DOM, no Leaflet. Callers memoise them on their inputs (the map
 * controller does), so a layer's input keeps its identity while nothing it depends on changes.
 *
 * Unknown stays unknown: a point without a world position is passed on as such (map/layers counts
 * it by reason), and a subject with no map position at all (an item, a reputation objective) or
 * with no spawn in the dataset (M3 review MAP-HONEST-4) is counted here and said in the layer
 * panel, never drawn somewhere guessed.
 */

const plural = (n: number, one: string, many: string): string => `${groupDigits(n)} ${n === 1 ? one : many}`;

/** `A`, `A and B`, `A, B and 3 more`. */
function nameList(names: readonly string[]): string {
  const [first, second] = names;
  if (first === undefined) return '';
  if (second === undefined) return first;
  if (names.length === 2) return `${first} and ${second}`;
  return `${first}, ${second} and ${groupDigits(names.length - 2)} more`;
}

function entityName(dataset: DatasetView, ref: EntityRef): string {
  switch (ref.kind) {
    case 'npc':
      return dataset.npc(ref.id)?.name ?? `NPC ${String(ref.id)}`;
    case 'object':
      return dataset.object(ref.id)?.name ?? `Object ${String(ref.id)}`;
    case 'item':
      return dataset.item(ref.id)?.name ?? `Item ${String(ref.id)}`;
  }
}

const subjectOf = (ref: Extract<EntityRef, { readonly kind: 'npc' | 'object' }>): PointSubject =>
  ref.kind === 'npc' ? { kind: 'npc', id: ref.id } : { kind: 'object', id: ref.id };

const refKey = (ref: EntityRef): string => `${ref.kind}:${String(ref.id)}`;

// =============================================================================================
// Quest givers (the Available tab's quests)

export interface GiverLayerModel {
  readonly input: SpawnLayerInput;
  /** Quests open to the character by race and class (the Available tab's rule). */
  readonly openQuests: number;
  /** Open quests that start from an item: an item has no map position, so they have no giver marker. */
  readonly itemStarted: number;
  /** Open quests with no starter in the dataset. */
  readonly noStarter: number;
  /** Starting NPCs and objects with no spawn in the dataset: they have no marker (MAP-HONEST-4). */
  readonly spawnlessGivers: number;
  /** Open quests whose every NPC or object starter has no spawn (and no item starter): no giver marker anywhere. */
  readonly spawnlessQuests: number;
}

/** What a giver starts: `Your Place in the World`, or `3 quests (A, B and 1 more)`. */
function startsText(quests: readonly QuestRecord[]): string {
  const names = quests.map((q) => q.name);
  return quests.length === 1 ? (names[0] ?? '') : `${plural(quests.length, 'quest', 'quests')} (${nameList(names)})`;
}

/**
 * The givers of the quests open to the character, by the Available tab's rule (race and class
 * only; availability at a step waits for simulation, Milestone 6): one group per starting NPC or
 * object, labelled with what it starts, for example `Gornek: starts Your Place in the World` or
 * `Master Gadrin: starts 3 quests (A, B and 1 more)`. Givers with no spawn in the dataset are
 * counted (`spawnlessGivers`, `spawnlessQuests`), not dropped silently.
 */
export function questGiverModel(dataset: DatasetView, character: Pick<CharacterProfile, 'race' | 'class'>): GiverLayerModel {
  const { open } = questsForCharacter(dataset, character);
  const byStarter = new Map<string, { readonly ref: Extract<EntityRef, { readonly kind: 'npc' | 'object' }>; readonly quests: QuestRecord[] }>();
  const spawned = new Map<string, boolean>();
  const hasSpawn = (ref: Extract<EntityRef, { readonly kind: 'npc' | 'object' }>): boolean => {
    const key = refKey(ref);
    const known = spawned.get(key);
    if (known !== undefined) return known;
    const result = dataset.spawns(ref).length > 0;
    spawned.set(key, result);
    return result;
  };
  let itemStarted = 0;
  let noStarter = 0;
  let spawnlessQuests = 0;
  for (const quest of open) {
    if (quest.starters.length === 0) {
      noStarter += 1;
      continue;
    }
    let placeable = false;
    let itemStarter = false;
    let anySpawn = false;
    for (const ref of quest.starters) {
      if (ref.kind === 'item') {
        itemStarter = true;
        continue;
      }
      placeable = true;
      if (hasSpawn(ref)) anySpawn = true;
      const key = refKey(ref);
      const entry = byStarter.get(key) ?? { ref, quests: [] };
      if (!entry.quests.includes(quest)) entry.quests.push(quest);
      byStarter.set(key, entry);
    }
    if (!placeable) itemStarted += 1;
    else if (!anySpawn && !itemStarter) spawnlessQuests += 1;
  }
  let spawnlessGivers = 0;
  const groups: PointGroupInput[] = [...byStarter.values()].map(({ ref, quests }) => {
    const spawns = dataset.spawns(ref);
    if (spawns.length === 0) spawnlessGivers += 1;
    return { subject: subjectOf(ref), label: `${entityName(dataset, ref)}: starts ${startsText(quests)}`, questIds: quests.map((q) => q.id), spawns };
  });
  return { input: { groups }, openQuests: open.length, itemStarted, noStarter, spawnlessGivers, spawnlessQuests };
}

// =============================================================================================
// Objectives and turn-ins of the focused quests

export interface QuestPointsModel {
  readonly input: SpawnLayerInput;
  /** The quests the model covers (the focused quests), ascending. */
  readonly questIds: readonly QuestId[];
  /** Focused quests the dataset does not have (custom quests without records). */
  readonly missingQuests: number;
  /**
   * Objectives or turn-ins with no map position of their own: reputation and spell objectives,
   * items that drop from other items or from nothing listed, item finishers.
   */
  readonly noPosition: number;
  /**
   * Objectives or turn-ins whose every NPC or object (for an item objective, every NPC or object it
   * drops from) has no spawn in the dataset: they are in the input but nothing of them can be drawn
   * (MAP-HONEST-4).
   */
  readonly spawnless: number;
}

/** An objective's event point as a spawn: resolved when it is a sourced point, otherwise without a world position (counted by map/layers). */
function eventSpawn(point: PublishedPoint, geometry: MapGeometry): SpawnPoint {
  if (!('space' in point)) return { source: point, world: null, uiMapId: null };
  const world = resolvePoint(point, geometry);
  return { source: point, world, uiMapId: world === null ? null : point.uiMapId };
}

/**
 * Where the focused quests' objectives are done (MAPS §7.4): kill and kill-credit targets, objects
 * to use, the NPCs and objects an objective item drops from, and event areas (QuestieDB
 * `triggerEnd`). Groups are labelled `<target> · <what> for <quest>`.
 */
export function objectiveModel(dataset: DatasetView, geometry: MapGeometry, questIds: readonly QuestId[]): QuestPointsModel {
  const groups: PointGroupInput[] = [];
  let missingQuests = 0;
  let noPosition = 0;
  let spawnless = 0;
  const ids = [...new Set(questIds)].sort((a, b) => a - b);
  /** Adds a target's group; true when it has at least one spawn. */
  const entity = (ref: Extract<EntityRef, { readonly kind: 'npc' | 'object' }>, label: string, questId: QuestId): boolean => {
    const spawns = dataset.spawns(ref);
    groups.push({ subject: subjectOf(ref), label, questIds: [questId], spawns });
    return spawns.length > 0;
  };
  /** Counts an objective none of whose targets has a spawn. */
  const tally = (placed: readonly boolean[]): void => {
    if (!placed.some(Boolean)) spawnless += 1;
  };
  for (const questId of ids) {
    const quest = dataset.quest(questId);
    if (quest === undefined) {
      missingQuests += 1;
      continue;
    }
    const name = quest.name;
    quest.objectives.forEach((objective, index) => {
      switch (objective.kind) {
        case 'kill': {
          const ref = { kind: 'npc', id: objective.npcId } as const;
          tally([entity(ref, `${entityName(dataset, ref)} · kill for ${name}`, questId)]);
          return;
        }
        case 'killCredit': {
          const npcs: NpcId[] = [...new Set([objective.rootNpcId, ...objective.npcIds])];
          tally(
            npcs.map((id) => {
              const ref = { kind: 'npc', id } as const;
              return entity(ref, `${entityName(dataset, ref)} · kill credit for ${name}`, questId);
            }),
          );
          return;
        }
        case 'object': {
          const ref = { kind: 'object', id: objective.objectId } as const;
          tally([entity(ref, `${entityName(dataset, ref)} · use for ${name}`, questId)]);
          return;
        }
        case 'item': {
          const item = dataset.item(objective.itemId);
          const itemName = item?.name ?? objective.label ?? `Item ${String(objective.itemId)}`;
          const sources: Extract<EntityRef, { readonly kind: 'npc' | 'object' }>[] = [
            ...(item?.dropNpcs ?? []).map((id: NpcId) => ({ kind: 'npc', id }) as const),
            ...(item?.dropObjects ?? []).map((id: ObjectId) => ({ kind: 'object', id }) as const),
          ];
          if (sources.length === 0) {
            noPosition += 1;
            return;
          }
          tally(
            sources.map((ref) => {
              const verb = ref.kind === 'npc' ? 'drops' : 'holds';
              return entity(ref, `${entityName(dataset, ref)} · ${verb} ${itemName} for ${name}`, questId);
            }),
          );
          return;
        }
        case 'event': {
          if (objective.points.length === 0) {
            noPosition += 1;
            return;
          }
          groups.push({
            subject: { kind: 'event', questId, objective: index },
            label: `${objective.text ?? 'Event area'} · for ${name}`,
            questIds: [questId],
            spawns: objective.points.map((point) => eventSpawn(point, geometry)),
          });
          return;
        }
        case 'reputation':
        case 'spell':
          noPosition += 1;
          return;
      }
    });
  }
  return { input: { groups }, questIds: ids, missingQuests, noPosition, spawnless };
}

/**
 * Where the focused quests are turned in: their finishing NPCs and objects (`<finisher> · turn in
 * <quest>`). A quest whose NPC and object finishers all have no spawn counts in `spawnless`.
 */
export function turnInModel(dataset: DatasetView, questIds: readonly QuestId[]): QuestPointsModel {
  const groups: PointGroupInput[] = [];
  let missingQuests = 0;
  let noPosition = 0;
  let spawnless = 0;
  const ids = [...new Set(questIds)].sort((a, b) => a - b);
  for (const questId of ids) {
    const quest = dataset.quest(questId);
    if (quest === undefined) {
      missingQuests += 1;
      continue;
    }
    if (quest.finishers.length === 0) noPosition += 1;
    let placeable = false;
    let anySpawn = false;
    for (const ref of quest.finishers) {
      if (ref.kind === 'item') {
        noPosition += 1;
        continue;
      }
      const spawns = dataset.spawns(ref);
      placeable = true;
      if (spawns.length > 0) anySpawn = true;
      groups.push({ subject: subjectOf(ref), label: `${entityName(dataset, ref)} · turn in ${quest.name}`, questIds: [questId], spawns });
    }
    if (placeable && !anySpawn) spawnless += 1;
  }
  return { input: { groups }, questIds: ids, missingQuests, noPosition, spawnless };
}

// =============================================================================================
// Flight masters

export interface FlightMasterModel {
  readonly input: SpawnLayerInput;
  /** Flight masters of the other faction, left out. */
  readonly otherFaction: number;
  /** Flight masters whose faction the dataset does not say (drawn, and labelled so). */
  readonly factionUnknown: number;
  /** Flight masters of the faction with no spawn in the dataset (MAP-HONEST-4). */
  readonly spawnless: number;
}

const FACTION_LETTER: Readonly<Record<Faction, 'A' | 'H'>> = { Alliance: 'A', Horde: 'H' };

/**
 * The flight masters the character's faction can use (`friendlyTo` includes it), and those whose
 * faction is unknown, labelled `Doras <Wind Rider Master> · flight master`. A flight master that
 * also starts quests open to the character (the Available tab's rule) carries them as its group's
 * `questIds` and says so (`…; starts Return to the Crossroads.`), so a click on it opens them: it is
 * drawn above the quest-giver marker at the same point (M3 review MAP-UX-3).
 */
export function flightMasterModel(
  dataset: DatasetView,
  ids: readonly NpcId[],
  character: Pick<CharacterProfile, 'faction' | 'race' | 'class'>,
): FlightMasterModel {
  const groups: PointGroupInput[] = [];
  let otherFaction = 0;
  let factionUnknown = 0;
  let spawnless = 0;
  const letter = FACTION_LETTER[character.faction];
  const wanted = new Set<number>(ids);
  const started = new Map<number, QuestRecord[]>();
  if (wanted.size > 0) {
    for (const quest of questsForCharacter(dataset, character).open) {
      for (const ref of quest.starters) {
        if (ref.kind !== 'npc' || !wanted.has(ref.id)) continue;
        const list = started.get(ref.id) ?? [];
        if (!list.includes(quest)) list.push(quest);
        started.set(ref.id, list);
      }
    }
  }
  for (const id of ids) {
    const npc = dataset.npc(id);
    if (npc === undefined || !isFlightMaster(npc)) continue;
    const friendly = npc.friendlyTo;
    if (friendly !== null && !friendly.includes(letter)) {
      otherFaction += 1;
      continue;
    }
    if (friendly === null) factionUnknown += 1;
    const title = npc.subName === null ? npc.name : `${npc.name} <${npc.subName}>`;
    const quests = started.get(id) ?? [];
    const spawns = dataset.spawns({ kind: 'npc', id });
    if (spawns.length === 0) spawnless += 1;
    groups.push({
      subject: { kind: 'npc', id },
      label: `${title} · flight master${friendly === null ? ' (faction unknown)' : ''}${quests.length === 0 ? '' : `; starts ${startsText(quests)}`}`,
      questIds: quests.map((quest) => quest.id),
      spawns,
    });
  }
  return { input: { groups }, otherFaction, factionUnknown, spawnless };
}

// =============================================================================================
// The route

/**
 * One step's route-layer input: `placeStep` and `legOf` (map/layers' `routeStepInputOf`) and the
 * step's quests. No position and no text: step numbers change with every insert above the step, so
 * the map's label provider numbers steps when a label is shown (M3 review PERF-2).
 */
export function mapRouteStepInput(step: RouteStep, geometry: MapGeometry): RouteStepInput {
  return routeStepInputOf(step, geometry, stepQuestIds(step));
}

/** The route layers' input (MAPS §7.4): each step placed from its authored location, styled by its leg, with its quests. */
export function mapRouteInput(steps: readonly RouteStep[], geometry: MapGeometry): RouteInput {
  return { steps: steps.map((step) => mapRouteStepInput(step, geometry)) };
}

/**
 * `mapRouteInput`, incrementally, with a cache keyed by step id (never by position, so an insert or
 * a move re-places nothing else):
 * - a step whose object is the one of the previous call keeps its input (the store's edits share
 *   unchanged step objects);
 * - an edited step whose new input equals its old one (a note's text, a step's own note) keeps the
 *   old input object;
 * - when every input is the previous one in the same order, the previous `RouteInput` is returned,
 *   so the route layers are not even recollected.
 *
 * Same content as `mapRouteInput`. The input does not depend on the dataset, so a dataset change
 * keeps it.
 */
export interface RouteInputBuilder {
  (steps: readonly RouteStep[]): RouteInput;
  /**
   * The input the builder holds for step `id`, or null when it has none. After a call it is the
   * input of that call's step with the id; an id that has left the route may still be found.
   */
  readonly inputOf: (id: StepId) => RouteStepInput | null;
}

export function createRouteInputBuilder(geometry: MapGeometry): RouteInputBuilder {
  let cache = new Map<StepId, { readonly step: RouteStep; readonly input: RouteStepInput }>();
  let last: { readonly steps: readonly RouteStep[]; readonly route: RouteInput } | null = null;
  const build = (steps: readonly RouteStep[]): RouteInput => {
    if (last?.steps === steps) return last.route;
    const inputs = steps.map((step) => {
      const hit = cache.get(step.id);
      if (hit !== undefined && hit.step === step) return hit.input;
      const fresh = mapRouteStepInput(step, geometry);
      const input = hit !== undefined && plainEqual(hit.input, fresh) ? hit.input : fresh;
      cache.set(step.id, { step, input });
      return input;
    });
    // Forget steps that left the route (the cache holds at most about twice the route).
    if (cache.size > 2 * steps.length + 64) {
      const kept = new Map<StepId, { readonly step: RouteStep; readonly input: RouteStepInput }>();
      for (const step of steps) {
        const entry = cache.get(step.id);
        if (entry !== undefined) kept.set(step.id, entry);
      }
      cache = kept;
    }
    const previous = last?.route.steps;
    const same = previous !== undefined && previous.length === inputs.length && inputs.every((input, i) => input === previous[i]);
    const route: RouteInput = same && last !== null ? last.route : { steps: inputs };
    last = { steps, route };
    return route;
  };
  return Object.assign(build, { inputOf: (id: StepId): RouteStepInput | null => cache.get(id)?.input ?? null });
}

/**
 * Whether the route layers draw from this step: it has a location, or it moves the character
 * somewhere unknown, or it leaves by a special means (`createDrawnRouteFilter`).
 */
export const isDrawnStep = (step: RouteStepInput): boolean => step.placement.kind !== 'none' || step.departs !== null;

/**
 * The route the route layers draw: only the steps that can change what they draw. A step with no
 * location that does not move the character and leaves by no special means (`none`, `departs`
 * null: a note, most quest steps without one) is skipped by every route layer, so it is left out
 * here. The result is element-wise the previous one, and then the previous object, when an edit
 * only touched such steps: inserting, editing or deleting a note then rebuilds no route layer.
 * Counts of steps without a location come from the full route (`routeMapSummary`).
 */
export function createDrawnRouteFilter(): (route: RouteInput) => RouteInput {
  let last: { readonly route: RouteInput; readonly drawn: RouteInput } | null = null;
  return (route) => {
    if (last?.route === route) return last.drawn;
    const steps = route.steps.filter(isDrawnStep);
    const previous = last?.drawn.steps;
    const same = previous !== undefined && previous.length === steps.length && steps.every((step, i) => step === previous[i]);
    const drawn: RouteInput = same && last !== null ? last.drawn : steps.length === route.steps.length ? route : { steps };
    last = { route, drawn };
    return drawn;
  };
}

export interface RouteMapSummary {
  readonly total: number;
  /** Steps with a world position. */
  readonly placed: number;
  /** Steps with a location that cannot be placed, or that move the character somewhere unknown. */
  readonly unplaced: number;
  /** Steps without a location that do not move the character (notes, most quest steps without one). */
  readonly withoutLocation: number;
  /** World maps with placed steps, in the order the route first reaches them, with their counts. */
  readonly maps: readonly { readonly mapId: WorldMapId; readonly steps: number }[];
}

export function routeMapSummary(route: RouteInput): RouteMapSummary {
  let placed = 0;
  let unplaced = 0;
  let withoutLocation = 0;
  const counts = new Map<WorldMapId, number>();
  for (const step of route.steps) {
    switch (step.placement.kind) {
      case 'point':
        placed += 1;
        counts.set(step.placement.world.mapId, (counts.get(step.placement.world.mapId) ?? 0) + 1);
        break;
      case 'unknown':
        unplaced += 1;
        break;
      case 'none':
        withoutLocation += 1;
        break;
    }
  }
  return { total: route.steps.length, placed, unplaced, withoutLocation, maps: [...counts].map(([mapId, steps]) => ({ mapId, steps })) };
}

/** The placed steps' points on one world map. */
const placedPoints = (route: RouteInput): WorldPoint[] =>
  route.steps.flatMap((step) => (step.placement.kind === 'point' ? [step.placement.world] : []));

/** The rectangle around the route's placed steps on `mapId`, or null when none is on that map. */
export function routeBoundsOn(route: RouteInput, mapId: WorldMapId): WorldBounds | null {
  return boundsOfPoints(mapId, placedPoints(route));
}

/** The first surface the route reaches, or null when no step is placed. */
export function firstRouteSurface(route: RouteInput): SurfaceId | null {
  for (const step of route.steps) if (step.placement.kind === 'point') return surfaceIdOf(step.placement.world.mapId);
  return null;
}

/** A step's route input, or null when it is not in the route. */
export function routeStepOf(route: RouteInput, id: StepId): RouteStepInput | null {
  return route.steps.find((step) => step.stepId === id) ?? null;
}

/** A step's 0-based position in the route, or null when it is not in the route. */
export function routeStepIndex(route: RouteInput, id: StepId): number | null {
  const index = route.steps.findIndex((step) => step.stepId === id);
  return index < 0 ? null : index;
}

/**
 * Whether the leg into the step at `index` is unknown: a step that could not be placed comes after
 * the previous placed step (map/layers draws the `leg-unknown` badge on its marker).
 */
export function legUnknownAt(route: RouteInput, index: number): boolean {
  for (let i = index - 1; i >= 0; i -= 1) {
    const kind = route.steps[i]?.placement.kind;
    if (kind === 'point') return false;
    if (kind === 'unknown') return true;
  }
  return false;
}

/** Steps placed on world maps none of `surfaces` shows (a world-form location on MapID 36, say). */
export function stepsWithoutSurface(summary: RouteMapSummary, surfaces: readonly SurfaceInfo[]): number {
  const shown = new Set<number>(surfaces.map((surface) => surface.mapId));
  return summary.maps.reduce((sum, entry) => sum + (shown.has(entry.mapId) ? 0 : entry.steps), 0);
}

// =============================================================================================
// Zones

/** A UiMap's world rectangle when it has exactly one full-rectangle row (not Azeroth 947); null otherwise. */
export function zoneBounds(geometry: MapGeometry, id: UiMapId): WorldBounds | null {
  const rows = geometry.maps.get(id)?.assignments ?? [];
  const [row] = rows;
  if (rows.length !== 1 || row === undefined || !isFullUiRectangle(row)) return null;
  return { mapId: row.mapId, xMin: row.xMin, xMax: row.xMax, yMin: row.yMin, yMax: row.yMax };
}

export interface ZoneOption {
  readonly uiMapId: UiMapId;
  readonly label: string;
}

export interface ZoneGroup {
  readonly surface: SurfaceId;
  readonly label: string;
  readonly zones: readonly ZoneOption[];
}

/** Code-unit order, never the host locale's. */
const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The zones jump-to-zone offers, grouped by surface (in the surfaces' order) and sorted by name:
 * every UiMap with one full-rectangle zone row (AreaID > 0) on a surface's world map. A name that
 * repeats within a group gets its UiMap id.
 */
export function zoneGroups(geometry: MapGeometry, surfaces: readonly SurfaceInfo[]): readonly ZoneGroup[] {
  const groups: ZoneGroup[] = [];
  for (const surface of surfaces) {
    const zones: { readonly uiMapId: UiMapId; readonly name: string }[] = [];
    for (const map of geometry.maps.values()) {
      const [row] = map.assignments;
      if (map.assignments.length !== 1 || row === undefined || row.mapId !== surface.mapId || row.areaId <= 0 || !isFullUiRectangle(row)) continue;
      zones.push({ uiMapId: map.uiMapId, name: map.name });
    }
    if (zones.length === 0) continue;
    const counts = new Map<string, number>();
    for (const zone of zones) counts.set(zone.name, (counts.get(zone.name) ?? 0) + 1);
    const options = zones
      .map((zone) => ({ uiMapId: zone.uiMapId, label: (counts.get(zone.name) ?? 0) > 1 ? `${zone.name} (UiMap ${String(zone.uiMapId)})` : zone.name }))
      .sort((a, b) => compareStrings(a.label, b.label) || a.uiMapId - b.uiMapId);
    groups.push({ surface: surface.id, label: surface.name, zones: options });
  }
  return groups;
}

// =============================================================================================
// Focus

/**
 * The quests the map puts in focus: the quests opened in Details while they are shown, otherwise
 * the active step's quests. Their objectives and turn-ins are drawn, and their givers raw and
 * emphasised at any zoom.
 */
export function focusQuestIds(opened: OpenedQuests | null, selection: Selection, activeStep: RouteStep | null): readonly QuestId[] {
  return shownOpenedQuests(opened, selection) ?? (activeStep === null ? [] : stepQuestIds(activeStep));
}

/** The route layers' focus: the selected steps and the active one (hover is drawn by the adapter's highlight). */
export function stepFocusOf(selection: Selection, active: StepId | null): StepFocus {
  return { selected: [...selection.stepIds], hovered: null, active };
}

/**
 * `focus` without the steps the route layers do not draw from (`createDrawnRouteFilter`): focusing
 * a note changes nothing they draw, so it is left out, and selecting a note rebuilds no route layer.
 */
export function focusWithin(focus: StepFocus, drawn: { readonly has: (id: StepId) => boolean }): StepFocus {
  const keep = (id: StepId | null): StepId | null => (id !== null && drawn.has(id) ? id : null);
  return { selected: focus.selected.filter((id) => drawn.has(id)), hovered: keep(focus.hovered), active: keep(focus.active) };
}
