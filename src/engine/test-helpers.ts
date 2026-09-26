import type { AssumptionOverrides } from '../domain/assumptions';
import type { EntityRef, ItemRecord, NpcRecord, ObjectiveDef, QuestRecord, RecordProvenance, SpawnPoint } from '../domain/dataset';
import { areaId, groupId, type IdSource, type ItemId, itemId, type NpcId, npcId, type QuestId, questId, routeId, sequentialIdSource, worldMapId, type WorldMapId } from '../domain/ids';
import { type Location, worldSourcedPoint, type WorldPoint } from '../domain/points';
import type { CharacterProfile, RouteProfile } from '../domain/project';
import { DEFAULT_ROUTE_PROFILE, defaultCharacter } from '../domain/project-factory';
import type { RouteGroup, RouteStep } from '../domain/route';
import type { TravelModel } from '../domain/travel';
import { fixtureGeometry } from '../geo/test-fixtures';
import { effectiveRules } from '../rules/precedence';
import { ERA_1_15, FOREVER_BETA } from '../rules/ruleset';
import { createStraightLineTravelModel } from '../rules/straight-line';
import { type DungeonEntrances, seedTravelGraph, type TravelGraphSeedOptions } from '../rules/travel-graph';
import type { EngineContext, EngineDataset, WalkProject } from './types';

/**
 * Synthetic fixtures for the engine's tests and benchmark: records, spawns and projects built in
 * code. The numbers are made up for the tests (not dataset values); nothing here is imported by
 * application code.
 */

export const KALIMDOR: WorldMapId = worldMapId(1);
export const EASTERN_KINGDOMS: WorldMapId = worldMapId(0);
/** A made-up instance map for entrance-edge tests. */
export const TEST_INSTANCE: WorldMapId = worldMapId(9001);

const PROVENANCE: RecordProvenance = { upstreamDiff: 'era', foreverStatus: 'unknown', corrected: false, created: false, source: 'questiedb' };

export const point = (x: number, y = 0, mapId: WorldMapId = KALIMDOR): WorldPoint => ({ mapId, x, y });

/** A world-space location (resolves under any geometry). */
export const at = (x: number, y = 0, mapId: WorldMapId = KALIMDOR, radius: number | null = null): Location => ({
  source: worldSourcedPoint(mapId, x, y),
  label: null,
  radius,
});

export function questRecord(id: number, fields: Partial<QuestRecord> = {}): QuestRecord {
  return {
    id: questId(id),
    name: `Quest ${String(id)}`,
    level: 10,
    minLevel: 1,
    maxLevel: null,
    races: null,
    classes: null,
    zoneOrSort: null,
    dungeonQuest: false,
    starters: [],
    finishers: [],
    objectives: [],
    objectiveHints: [],
    objectivesText: null,
    prerequisites: {
      preQuestSingle: [],
      preQuestGroup: [],
      exclusiveTo: [],
      nextQuestInChain: null,
      parentQuest: null,
      childQuests: [],
      inGroupWith: [],
      breadcrumbForQuestId: null,
      breadcrumbs: [],
      availableUntilCompleted: null,
      availableStartingWith: null,
      disabledByQuest: null,
    },
    requirements: { skill: null, minReputation: null, maxReputation: null, spell: null, specialization: null, sourceItemId: null, requiredSourceItems: [] },
    reputationReward: [],
    flags: { repeatable: false, needsEvent: false, questFlags: 0, specialFlags: 0 },
    xp: { questLevel: 10, baseXp: 840, basis: 'era-seed' },
    provenance: PROVENANCE,
    ...fields,
  };
}

export function npcRecord(id: number, fields: Partial<NpcRecord> = {}): NpcRecord {
  return {
    id: npcId(id),
    name: `NPC ${String(id)}`,
    subName: null,
    minLevel: 10,
    maxLevel: 10,
    rank: 0,
    zoneId: null,
    npcFlags: 0,
    friendlyTo: null,
    questStarts: [],
    questEnds: [],
    provenance: PROVENANCE,
    ...fields,
  };
}

export function itemRecord(id: number, dropNpcs: readonly number[]): ItemRecord {
  return { id: itemId(id), name: `Item ${String(id)}`, itemClass: 12, dropNpcs: dropNpcs.map(npcId), dropObjects: [], dropItems: [], startsQuest: null, provenance: PROVENANCE };
}

export const itemObjective = (item: number, count: number | null = null): ObjectiveDef => ({ kind: 'item', itemId: itemId(item), label: null, count });

export const killObjective = (npc: number, count: number | null = null): ObjectiveDef => ({ kind: 'kill', npcId: npcId(npc), label: null, count });

export const spawnAt = (world: WorldPoint | null): SpawnPoint => ({
  source: { kind: 'unmapped', areaId: areaId(1), x: 0, y: 0, reason: 'no-uimap' },
  world,
  uiMapId: null,
});

export interface FixtureData {
  readonly quests?: readonly QuestRecord[];
  readonly npcs?: readonly NpcRecord[];
  readonly items?: readonly ItemRecord[];
  /** Keyed `npc:<id>` or `object:<id>`. */
  readonly spawns?: Readonly<Record<string, readonly SpawnPoint[]>>;
}

export function fixtureDataset(data: FixtureData): EngineDataset & { readonly zone: () => undefined } {
  const quests = new Map((data.quests ?? []).map((q) => [q.id, q]));
  const npcs = new Map((data.npcs ?? []).map((n) => [n.id, n]));
  const items = new Map((data.items ?? []).map((i) => [i.id, i]));
  const spawns = data.spawns ?? {};
  return {
    quest: (id: QuestId) => quests.get(id),
    npc: (id: NpcId) => npcs.get(id),
    object: () => undefined,
    item: (id: ItemId) => items.get(id),
    spawns: (ref: EntityRef) => spawns[`${ref.kind}:${String(ref.id)}`] ?? [],
    zone: () => undefined,
  };
}

export interface FixtureContextOptions {
  readonly rulesetId?: 'forever-beta' | 'era-1.15';
  readonly assumptions?: AssumptionOverrides;
  readonly travel?: TravelModel;
  readonly flightMasterIds?: readonly number[];
  readonly dungeons?: readonly DungeonEntrances[];
  readonly graph?: TravelGraphSeedOptions;
}

export function fixtureContext(dataset: EngineDataset & { readonly zone: () => undefined }, options: FixtureContextOptions = {}): EngineContext {
  const rules = effectiveRules(options.rulesetId === 'era-1.15' ? ERA_1_15 : FOREVER_BETA, options.assumptions ?? {});
  const graph = seedTravelGraph(
    { npc: dataset.npc, spawns: dataset.spawns, zone: dataset.zone, flightMasterIds: (options.flightMasterIds ?? []).map(npcId), dungeons: options.dungeons ?? [] },
    rules,
    { transports: [], taxiNodes: [], ...options.graph },
  );
  return {
    dataset,
    geometry: fixtureGeometry(),
    rules,
    travel: options.travel ?? createStraightLineTravelModel(rules.values.groundDetourFactor.value),
    graph,
  };
}

export const testIds = (): IdSource => sequentialIdSource();

export function fixtureProject(
  steps: readonly RouteStep[],
  options: { readonly character?: Partial<CharacterProfile>; readonly routeProfile?: Partial<RouteProfile>; readonly groups?: readonly RouteGroup[] } = {},
): WalkProject {
  const groups: Record<string, RouteGroup> = {};
  for (const group of options.groups ?? []) groups[group.id] = group;
  return {
    route: { id: routeId('route-1'), name: 'Test', description: '', steps, groups },
    character: defaultCharacter({ startLocation: at(0), ...options.character }),
    routeProfile: { ...DEFAULT_ROUTE_PROFILE, ...options.routeProfile },
    customQuests: [],
  };
}

/** An RXP-style group with a condition and waypoints. */
export function rxpGroup(id: string, rxp: Partial<NonNullable<RouteGroup['rxp']>> = {}): RouteGroup {
  return {
    id: groupId(id),
    rxp: { importId: 'import-1', stepIndex: 0, tags: [], condition: null, waypoints: [], annotations: [], fingerprint: '', ...rxp },
  };
}
