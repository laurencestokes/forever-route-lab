import type { EntityRef, SpawnPoint } from '../domain/dataset';
import type { NpcId } from '../domain/ids';
import type { Location, SourcedPoint, WorldPoint } from '../domain/points';
import type { TravelEndpoint } from '../domain/travel';
import { distanceYards } from '../geo/distance';
import { resolve } from '../geo/resolve';
import type { TaxiNode, TransportDock } from '../rules/travel-graph';
import { type EngineContext, NO_ZONE_HINTS } from './types';

/**
 * Where things are (docs/SIMULATION.md TIME-2): authored points resolved through `src/geo` with
 * the injected geometry, dataset spawns, taxi nodes and transport docks, each as a travel endpoint
 * with its zone hint. A point that does not resolve is null, never a zero distance. Results are
 * cached per object: steps, locations and spawns are immutable, and one cache serves one context.
 */

/** The spawn of an entity the walker travels to (TIME-2). */
export type SpawnChoice =
  /** The entity names no place (an item: quest items are carried, not visited). */
  | { readonly kind: 'none' }
  /** No spawn resolves to a world point (SIM-3). */
  | { readonly kind: 'unresolved' }
  /**
   * From an unknown position, an entity with several resolved spawns: which one the character
   * reaches is unknown (TIME-2 picks the nearest, which needs a known position).
   */
  | { readonly kind: 'several' }
  | { readonly kind: 'spawn'; readonly endpoint: TravelEndpoint };

export interface Places {
  /** A step, start or bind location; null when it does not resolve under the geometry. */
  location(location: Location): TravelEndpoint | null;
  /** A waypoint's point; null when it does not resolve. */
  point(source: SourcedPoint): TravelEndpoint | null;
  /**
   * The entity's spawn nearest to `near` by straight-line distance, ties by spawn order
   * (ASSUMPTION, TIME-2; unchanged by the navigation model). Spawns without a world point
   * (unmapped area points) are skipped; instance presence already sits at its entrance. With no
   * spawn on `near`'s world map, the first spawn with a world point. Without `near` the only
   * spawn with a world point, or `several` when spawns lie at more than one point.
   */
  nearestSpawn(ref: EntityRef, near: WorldPoint | null): SpawnChoice;
  /** A taxi node's flight master, with the hint of its spawn; null without a position. */
  taxiNode(node: TaxiNode): TravelEndpoint | null;
  /** A transport dock; null until its position is known. */
  dock(dock: TransportDock): TravelEndpoint | null;
  /** A world point with no authored source (an entrance): hint 0. */
  world(point: WorldPoint): TravelEndpoint;
}

const samePoint = (a: WorldPoint, b: WorldPoint): boolean => a === b || (a.mapId === b.mapId && a.x === b.x && a.y === b.y);

export function createPlaces(context: Pick<EngineContext, 'dataset' | 'geometry' | 'zoneHints'>): Places {
  const { dataset, geometry } = context;
  const hints = context.zoneHints ?? NO_ZONE_HINTS;
  const locations = new WeakMap<Location, TravelEndpoint | null>();
  const points = new WeakMap<SourcedPoint, TravelEndpoint | null>();
  const spawnEnds = new WeakMap<SpawnPoint, TravelEndpoint>();
  const nodes = new Map<string, TravelEndpoint | null>();

  const resolveSource = (source: SourcedPoint): TravelEndpoint | null => {
    const world = resolve(source, geometry);
    return world === null ? null : { point: world, zoneHint: hints.routePoint(source, world) };
  };

  const spawnEndpoint = (spawn: SpawnPoint, world: WorldPoint): TravelEndpoint => {
    let endpoint = spawnEnds.get(spawn);
    if (endpoint === undefined) {
      endpoint = { point: world, zoneHint: hints.spawn(spawn, world) };
      spawnEnds.set(spawn, endpoint);
    }
    return endpoint;
  };

  /** The endpoint of an NPC's spawn at `point` (the one a taxi node or dock was seeded from). */
  const npcSpawnAt = (npcId: NpcId, point: WorldPoint): TravelEndpoint => {
    const spawn = dataset.spawns({ kind: 'npc', id: npcId }).find((candidate) => candidate.world !== null && samePoint(candidate.world, point));
    return spawn === undefined || spawn.world === null ? { point, zoneHint: 0 } : spawnEndpoint(spawn, spawn.world);
  };

  return {
    location(location) {
      let endpoint = locations.get(location);
      if (endpoint === undefined) {
        endpoint = resolveSource(location.source);
        locations.set(location, endpoint);
      }
      return endpoint;
    },
    point(source) {
      let endpoint = points.get(source);
      if (endpoint === undefined) {
        endpoint = resolveSource(source);
        points.set(source, endpoint);
      }
      return endpoint;
    },
    nearestSpawn(ref, near) {
      if (ref.kind === 'item') return { kind: 'none' };
      let first: SpawnPoint | null = null;
      let best: SpawnPoint | null = null;
      let bestYards = Number.POSITIVE_INFINITY;
      for (const spawn of dataset.spawns(ref)) {
        if (spawn.world === null) continue;
        if (near === null) {
          // A second spawn at another point: which one is reached is unknown.
          if (first !== null && first.world !== null && !samePoint(first.world, spawn.world)) return { kind: 'several' };
          first ??= spawn;
          continue;
        }
        first ??= spawn;
        const yards = distanceYards(near, spawn.world);
        if (yards !== null && yards < bestYards) {
          best = spawn;
          bestYards = yards;
        }
      }
      const chosen = best ?? first;
      if (chosen === null || chosen.world === null) return { kind: 'unresolved' };
      return { kind: 'spawn', endpoint: spawnEndpoint(chosen, chosen.world) };
    },
    taxiNode(node) {
      if (node.point === null) return null;
      let endpoint = nodes.get(node.key);
      if (endpoint === undefined) {
        endpoint = node.npcId === null ? { point: node.point, zoneHint: 0 } : npcSpawnAt(node.npcId, node.point);
        nodes.set(node.key, endpoint);
      }
      return endpoint;
    },
    dock(dock) {
      if (dock.point === null) return null;
      return dock.npcId === null ? { point: dock.point, zoneHint: 0 } : npcSpawnAt(dock.npcId, dock.point);
    },
    world(point) {
      return { point, zoneHint: 0 };
    },
  };
}
