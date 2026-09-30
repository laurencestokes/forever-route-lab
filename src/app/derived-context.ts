import type { AssumptionOverrides } from '../domain/assumptions';
import type { Faction } from '../domain/character';
import type { DatasetView, SpawnPoint } from '../domain/dataset';
import type { NpcId, WorldMapId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';
import type { RulesetId } from '../domain/project';
import type { RouteStep } from '../domain/route';
import type { TravelEndpoint, TravelModel } from '../domain/travel';
import { NO_ZONE_HINTS, type ZoneHintResolver } from '../engine/types';
import { resolve } from '../geo/resolve';
import type { MapGeometry } from '../geo/types';
import type { NavManifest } from '../nav/manifest';
import { effectiveRules, type EffectiveRules } from '../rules/precedence';
import { rulesetById } from '../rules/ruleset';
import { createStraightLineTravelModel } from '../rules/straight-line';
import { type CommittedTaxi, sameMapTransports, seedTravelGraph, type TransportDock, type TravelGraph, type TravelGraphSource, type UserDock } from '../rules/travel-graph';
import { TRANSPORT_SEEDS, type TransportSeed } from '../rules/travel-seeds';
import { ruleInput, sumEstimates, withBasis } from '../sim/provenance';
import { uiMapZoneHint } from './navigation-hints';
import { createNavigationTravelModel, type NavigationTravelModel, type SameMapTransport, type SameMapTransports } from './navigation-model';
import type { NavigationState } from './navigation-runtime';

/**
 * The inputs of one engine walk besides the project (ARCHITECTURE §9.1, §12.1): the effective
 * rules (ruleset and project assumptions, with precedence from src/rules), the TravelGraph seeded
 * from the loaded dataset, and the travel model:
 *
 * - navigation available: the `navigation` model (src/app/navigation-model.ts) over the shared leg
 *   table, with the straight-line model as its labelled fallback, the same-map transports of the
 *   TravelGraph (D-034 item 2) and zone hints from the geometry and the navigation manifest;
 * - otherwise (checking, or unavailable): the straight-line model, with no zone hints (it reads none).
 */

/** The effective rules of a project: its ruleset with its assumptions on top (§9.1 precedence). */
export function projectRules(rulesetId: RulesetId, assumptions: AssumptionOverrides): EffectiveRules {
  return effectiveRules(rulesetById(rulesetId), assumptions);
}

/**
 * What `seedTravelGraph` reads, from the project's dataset view and the dataset's flight-master
 * ids. `dungeons` is empty: `zones.json` records no instance world map per dungeon (QuestieDB's
 * `instanceIdToAreaId.lua` is not extracted yet, DATA_PROVENANCE §6.6), and `DatasetView` exposes
 * no dungeon table, so no entrance edge can be seeded: a step on an instance map keeps SIM-4 and
 * no kill there counts as a dungeon kill (TIME-7, ARCHITECTURE §9.1). tests/derived-navigation.test.ts
 * fails once `zones.json` gains instance map ids while this is still empty.
 */
export function travelGraphSourceOf(view: Pick<DatasetView, 'npc' | 'spawns' | 'zone'>, flightMasterIds: readonly NpcId[]): TravelGraphSource {
  return {
    npc: (id) => view.npc(id),
    spawns: (ref) => view.spawns(ref),
    zone: (id) => view.zone(id),
    flightMasterIds,
    dungeons: [],
  };
}

/**
 * The TravelGraph for a project's view and rules (transport wait and ride come from the rules),
 * with the dock positions the project's transport steps give (`userDocksOf`) and, once it has
 * loaded, the committed client taxi file (D-039 B): its nodes, its flights with their path lengths
 * (TIME-6) and the inferred docks of the seeded transports (TIME-7, map-presentation.md §10). Null
 * while it loads or when it failed: the dataset's flight masters, the cited seeds and TIME-5.
 */
export function projectTravelGraph(
  view: Pick<DatasetView, 'npc' | 'spawns' | 'zone'>,
  flightMasterIds: readonly NpcId[],
  rules: EffectiveRules,
  userDocks: readonly UserDock[] = [],
  taxi: CommittedTaxi | null = null,
): TravelGraph {
  return seedTravelGraph(travelGraphSourceOf(view, flightMasterIds), rules, {
    ...(userDocks.length === 0 ? {} : { userDocks }),
    ...(taxi === null ? {} : { taxi }),
  });
}

/**
 * The dock positions the user entered on the route's transport steps (TIME-7: `TransportRef.dock`
 * is where the step boards its transport), as `seedTravelGraph`'s user docks: a step naming a seeded
 * transport (`TransportRef.id`) whose dock resolves to a world point on exactly one of that
 * transport's stops gives that stop's position. A dock on a map where the transport has two stops
 * (which stop it is would be a guess), a step without a transport id and a dock that does not
 * resolve give none. The first step in route order wins for a stop. Nothing is invented: every
 * position is one the user entered.
 */
export function userDocksOf(steps: readonly RouteStep[], geometry: MapGeometry, transports: readonly TransportSeed[] = TRANSPORT_SEEDS): UserDock[] {
  const out: UserDock[] = [];
  const taken = new Set<string>();
  for (const step of steps) {
    if (step.kind !== 'travel' || step.mode !== 'transport') continue;
    const ref = step.transport;
    if (ref === null || ref.id === null || ref.dock === null) continue;
    const seed = transports.find((t) => t.id === ref.id);
    if (seed === undefined) continue;
    const point = resolve(ref.dock, geometry);
    if (point === null) continue;
    const stops = seed.stops.flatMap((stop, index) => (stop.mapId === point.mapId ? [index] : []));
    const [stop, ...others] = stops;
    if (stop === undefined || others.length > 0) continue;
    const key = `${seed.id}:${String(stop)}`;
    if (taken.has(key)) continue;
    taken.add(key);
    out.push({ transportId: seed.id, stop, point });
  }
  return out;
}

/** The same user docks as a string (for keeping the graph while they do not change). */
export const userDocksKey = (docks: readonly UserDock[]): string =>
  docks.map((d) => `${d.transportId}:${String(d.stop)}@${String(d.point.mapId)}:${String(d.point.x)},${String(d.point.y)}`).join('|');

/**
 * Why the navigation model's same-map transport rule (terrain-navigation.md §9.3 case 2, D-034
 * item 2) cannot apply on the navigation maps, in words; null when some same-map transport has
 * both docks positioned. No dataset NPC positions a dock (TIME-7): the docks are the committed taxi
 * file's inferred stops once it has loaded (NAV-08), else only those the user entered on transport
 * steps.
 */
export function sameMapTransportNote(graph: TravelGraph, mapIds: readonly number[]): string | null {
  const maps = new Set(mapIds);
  let seeded = 0;
  for (const edge of graph.transports) {
    if (edge.from.mapId !== edge.to.mapId || !maps.has(edge.from.mapId)) continue;
    seeded += 1;
    if (edge.from.point !== null && edge.to.point !== null) return null;
  }
  if (seeded === 0) return null;
  return 'Boats and zeppelins between two docks on one continent are not used for walking legs that have no walking path: no dock has a known position (the client taxi file gives them once it has loaded; or enter both docks on transport steps).';
}

/**
 * Zone hints for navigation endpoints (terrain-navigation.md §8.1 rule A), from
 * src/app/navigation-hints.ts: a route point's hint is the zone of the UiMap it was authored on, a
 * spawn's the zone of the UiMap it was published on, rolled up with the manifest.
 */
export function createZoneHintResolver(geometry: MapGeometry, nav: NavManifest): ZoneHintResolver {
  return {
    routePoint: (source, world) => uiMapZoneHint(geometry, source.uiMapId, world, nav),
    spawn: (spawn, world) => uiMapZoneHint(geometry, spawn.uiMapId, world, nav),
  };
}

const samePoint = (a: WorldPoint, b: WorldPoint): boolean => a.mapId === b.mapId && a.x === b.x && a.y === b.y;

/**
 * A dock's endpoint as the engine's walker makes it (src/engine/places.ts `dock`): a dock NPC's
 * spawn at the dock point with that spawn's hint, else the point with hint 0. The same endpoint
 * gives the same leg-table key, so the model's compositions and the walker's dock walks share legs.
 */
function dockEndpoint(dock: TransportDock, spawns: DatasetView['spawns'], hints: ZoneHintResolver): TravelEndpoint | null {
  const point = dock.point;
  if (point === null) return null;
  if (dock.npcId === null) return { point, zoneHint: 0 };
  const spawn: SpawnPoint | undefined = spawns({ kind: 'npc', id: dock.npcId }).find((candidate) => candidate.world !== null && samePoint(candidate.world, point));
  return spawn === undefined || spawn.world === null ? { point, zoneHint: 0 } : { point: spawn.world, zoneHint: hints.spawn(spawn, spawn.world) };
}

/**
 * The same-map transports of a TravelGraph for the navigation model (terrain-navigation.md §9.3
 * case 2, D-034 item 2): edges with both docks positioned on one world map, open to the faction
 * (unknown factions count as open, as TIME-7 treats them), with wait plus ride carrying the
 * rules' provenance, and which docks are client berths (inferred stops, whose walks count their
 * swim as the walk along the pier, TIME-7). Per map, computed once.
 */
export function sameMapTransportsOf(graph: TravelGraph, faction: Faction, spawns: DatasetView['spawns'], hints: ZoneHintResolver): SameMapTransports {
  const byMap = new Map<WorldMapId, readonly SameMapTransport[]>();
  return (mapId) => {
    let list = byMap.get(mapId);
    if (list === undefined) {
      const out: SameMapTransport[] = [];
      for (const edge of sameMapTransports(graph, mapId)) {
        if (edge.factions !== null && !edge.factions.includes(faction)) continue;
        const from = dockEndpoint(edge.from, spawns, hints);
        const to = dockEndpoint(edge.to, spawns, hints);
        if (from === null || to === null) continue;
        const seconds = sumEstimates([withBasis(edge.waitS.value, ruleInput(edge.waitS)), withBasis(edge.rideS.value, ruleInput(edge.rideS))]);
        // Inferred docks are client berths in the water beside the pier (TIME-7): their walks count as walking.
        const berths = { from: edge.from.pointFrom === 'inferred', to: edge.to.pointFrom === 'inferred' };
        out.push({ id: edge.id, from, to, seconds, ...(berths.from || berths.to ? { berths } : {}) });
      }
      list = out;
      byMap.set(mapId, list);
    }
    return list;
  };
}

/** The travel model a walk uses, and what goes with it. */
export interface TravelSelection {
  readonly model: TravelModel;
  /** The navigation model when `model` is one (for map paths and "computing paths"); null otherwise. */
  readonly navigation: NavigationTravelModel | null;
  readonly hints: ZoneHintResolver;
}

export interface TravelSelectionInput {
  readonly navigation: NavigationState;
  /** The effective `groundDetourFactor` (`travelDetourFactor` assumption), the fallback's detour. */
  readonly detourFactor: number;
  readonly graph: TravelGraph;
  readonly faction: Faction;
  readonly dataset: Pick<DatasetView, 'spawns'>;
  readonly geometry: MapGeometry;
}

/**
 * Picks the travel model (ARCHITECTURE §9.1, terrain-navigation.md §9.3): navigation when its
 * runtime is available, with the straight-line model as the fallback and the TravelGraph's
 * same-map transports; otherwise the straight-line model.
 */
export function selectTravelModel(input: TravelSelectionInput): TravelSelection {
  const fallback = createStraightLineTravelModel(input.detourFactor);
  if (input.navigation.kind !== 'available') return { model: fallback, navigation: null, hints: NO_ZONE_HINTS };
  const { manifest, table, paths } = input.navigation.runtime;
  const hints = createZoneHintResolver(input.geometry, manifest);
  const spawns: DatasetView['spawns'] = (ref) => input.dataset.spawns(ref);
  const navigation = createNavigationTravelModel({ manifest, fallback, table, paths, transports: sameMapTransportsOf(input.graph, input.faction, spawns, hints) });
  return { model: navigation, navigation, hints };
}
