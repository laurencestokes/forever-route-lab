import type { EntityRef } from '../../domain/dataset';
import type { WorldPoint } from '../../domain/points';
import type { TravelEndpoint } from '../../domain/travel';
import type { Places } from '../../engine/places';
import { type LocationTable, SPAWN_LOST, SPAWN_NONE, type SpawnTables } from './types';

/**
 * Locations (docs/research/optimizer-m7.md §5.2): interned endpoints, their point ids, and the
 * nearest-spawn tables. A location is interned by (mapId, x, y, zoneHint) and carries a point id
 * interned by (mapId, x, y) alone, so "moved" and zero-length legs compare points, not zone hints
 * (review OP-13). Locations are sorted by (mapId, x, y, zoneHint): indices never depend on the
 * order in which compile met them.
 */

export const endpointKey = (end: TravelEndpoint): string => `${String(end.point.mapId)}|${String(end.point.x)}|${String(end.point.y)}|${String(end.zoneHint)}`;

export const pointKey = (point: WorldPoint): string => `${String(point.mapId)}|${String(point.x)}|${String(point.y)}`;

export const entityKey = (ref: EntityRef): string => `${ref.kind}:${String(ref.id)}`;

/** Collects endpoints before the indices are fixed; the first endpoint object of a key is kept. */
export class LocationSet {
  private readonly byKey = new Map<string, TravelEndpoint>();

  /** Adds an endpoint; returns true when its key is new. */
  add(end: TravelEndpoint): boolean {
    const key = endpointKey(end);
    if (this.byKey.has(key)) return false;
    this.byKey.set(key, end);
    return true;
  }

  has(end: TravelEndpoint): boolean {
    return this.byKey.has(endpointKey(end));
  }

  get size(): number {
    return this.byKey.size;
  }

  /** The endpoints in (mapId, x, y, zoneHint) order. */
  sorted(): TravelEndpoint[] {
    return [...this.byKey.values()].sort(compareEndpoints);
  }
}

export function compareEndpoints(a: TravelEndpoint, b: TravelEndpoint): number {
  return a.point.mapId - b.point.mapId || a.point.x - b.point.x || a.point.y - b.point.y || a.zoneHint - b.zoneHint;
}

/** The fixed location indices: the sorted endpoints, the key → index map, and the typed table. */
export interface IndexedLocations {
  readonly endpoints: readonly TravelEndpoint[];
  readonly index: ReadonlyMap<string, number>;
  readonly table: LocationTable;
}

export function indexLocations(set: LocationSet): IndexedLocations {
  const endpoints = set.sorted();
  const index = new Map<string, number>();
  const n = endpoints.length;
  const mapId = new Int32Array(n);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const pointId = new Int32Array(n);
  const points = new Map<string, number>();
  endpoints.forEach((end, i) => {
    index.set(endpointKey(end), i);
    mapId[i] = end.point.mapId;
    x[i] = end.point.x;
    y[i] = end.point.y;
    const key = pointKey(end.point);
    let id = points.get(key);
    if (id === undefined) {
      id = points.size;
      points.set(key, id);
    }
    pointId[i] = id;
  });
  return { endpoints, index, table: { count: n, mapId, x, y, pointId, pointCount: points.size } };
}

/** The index of an endpoint (−1 for null); throws for an endpoint compile did not collect (a bug). */
export function locationOf(locations: IndexedLocations, end: TravelEndpoint | null): number {
  if (end === null) return -1;
  const i = locations.index.get(endpointKey(end));
  if (i === undefined) throw new Error(`Location ${endpointKey(end)} was not collected`);
  return i;
}

/** The outcome of `Places.nearestSpawn` as a position: an endpoint, `none` (stay), or `lost` (unknown). */
export type SpawnOutcome = { readonly kind: 'at'; readonly end: TravelEndpoint } | { readonly kind: 'none' } | { readonly kind: 'lost' };

/** Memoised `Places.nearestSpawn` per (entity, from point), keyed by object identity. */
export class SpawnChooser {
  private readonly memo = new WeakMap<EntityRef, { unknown: SpawnOutcome | null; readonly byPoint: WeakMap<WorldPoint, SpawnOutcome> }>();

  constructor(private readonly places: Places) {}

  choose(ref: EntityRef, near: WorldPoint | null): SpawnOutcome {
    let entry = this.memo.get(ref);
    if (entry === undefined) {
      entry = { unknown: null, byPoint: new WeakMap() };
      this.memo.set(ref, entry);
    }
    const known = near === null ? entry.unknown : entry.byPoint.get(near);
    if (known !== undefined && known !== null) return known;
    const choice = this.places.nearestSpawn(ref, near);
    const out: SpawnOutcome = choice.kind === 'spawn' ? { kind: 'at', end: choice.endpoint } : choice.kind === 'none' ? { kind: 'none' } : { kind: 'lost' };
    if (near === null) entry.unknown = out;
    else entry.byPoint.set(near, out);
    return out;
  }
}

/**
 * The spawn tables (§5.2): for each entity, the chosen location from the unknown position (slot 0)
 * and from each location. Every chosen spawn must already be a location (the fixpoint).
 */
export function buildSpawnTables(entities: readonly EntityRef[], locations: IndexedLocations, chooser: SpawnChooser): SpawnTables {
  const n = locations.table.count;
  const data = new Int32Array(entities.length * (n + 1));
  entities.forEach((ref, t) => {
    const base = t * (n + 1);
    for (let from = -1; from < n; from += 1) {
      const near = from < 0 ? null : (locations.endpoints[from]?.point ?? null);
      const out = chooser.choose(ref, near);
      data[base + from + 1] = out.kind === 'none' ? SPAWN_NONE : out.kind === 'lost' ? SPAWN_LOST : locationOf(locations, out.end);
    }
  });
  return { count: entities.length, data };
}
