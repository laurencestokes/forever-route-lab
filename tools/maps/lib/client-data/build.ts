import {
  AREA_SANCTUARY_BIT,
  INSTANCE_TYPES,
  LFG_DUNGEON_TYPE_ID,
  TAXI_FLIGHT_MAPS,
  TAXI_NODE_ALLIANCE_BIT,
  TAXI_NODE_HORDE_BIT,
  TAXI_SHAPE_TOLERANCE_YD,
} from './constants';
import type { AreaRow, AssignmentRow, ClientTableRows, ContentTuningRow, LfgRow, MapRow, TaxiNodeRow, TaxiPathPointRow, TaxiPathRow } from './read';

/**
 * Builds the three committed client tables from plain rows (map-presentation.md §9, §10, §12.6,
 * §8.1-§8.4, §16; D-039 B, C and E). Pure: no file, clock or client access, so tests run it on
 * synthetic rows. Every shipped number is a client value or a stated computation over client
 * values, and each file names the table and column of every field in its `columns` block.
 *
 * Positions are world yards (D-017: world x runs north, y west), rounded to 1 yd.
 */

// ---------------------------------------------------------------------------------------------
// Shared

/** Whether `bit` (a power of two) is set in a 32-bit column value, by arithmetic (D-012: no bitwise operators). */
export function hasBit(value: number, bit: number): boolean {
  const unsigned = value < 0 ? value + 2 ** 32 : value;
  return Math.floor(unsigned / bit) % 2 === 1;
}

const byId = <T extends { readonly id: number }>(rows: readonly T[]): readonly T[] => [...rows].sort((a, b) => a.id - b.id);

// ---------------------------------------------------------------------------------------------
// Douglas-Peucker

/** Distance from `p` to the segment `a`-`b` in the plane. */
export function segmentDistance(p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Douglas-Peucker on a polyline: the indices of the points kept, ascending, always the first and
 * the last. A point is kept when it lies more than `tolerance` from the segment between the kept
 * points around it; ties keep the first farthest point. Iterative, so long paths cannot overflow
 * the stack; the result does not depend on the order the spans are processed in.
 */
export function simplifyIndices(points: readonly (readonly [number, number])[], tolerance: number): readonly number[] {
  const n = points.length;
  if (n <= 2) return points.map((_, i) => i);
  const keep = new Array<boolean>(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  const spans: [number, number][] = [[0, n - 1]];
  for (let span = spans.pop(); span !== undefined; span = spans.pop()) {
    const [first, last] = span;
    const a = points[first];
    const b = points[last];
    if (a === undefined || b === undefined) continue;
    let farthest = -1;
    let distance = tolerance;
    for (let i = first + 1; i < last; i += 1) {
      const p = points[i];
      if (p === undefined) continue;
      const d = segmentDistance(p, a, b);
      if (d > distance) {
        distance = d;
        farthest = i;
      }
    }
    if (farthest === -1) continue;
    keep[farthest] = true;
    spans.push([first, farthest], [farthest, last]);
  }
  return keep.flatMap((kept, i) => (kept ? [i] : []));
}

/** `[x0, y0, dx1, dy1, …]`: points rounded to 1 yd, then each after the first as its difference from the previous (as the terrain arc files). */
export function deltaCode(points: readonly (readonly [number, number])[]): number[] {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  for (const [x, y] of points) {
    const rx = Math.round(x);
    const ry = Math.round(y);
    out.push(rx - px, ry - py);
    px = rx;
    py = ry;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// B: the taxi graph

export interface TaxiNodeOut {
  readonly id: number;
  readonly name: string;
  readonly mapId: number;
  readonly x: number;
  readonly y: number;
  readonly alliance: boolean;
  readonly horde: boolean;
}

export interface TaxiFlightOut {
  readonly pathId: number;
  readonly from: number;
  readonly to: number;
  readonly l3d: number;
  readonly shape: readonly number[];
}

export interface TaxiTransportOut {
  readonly pathId: number;
  readonly maps: readonly number[];
  /** `[mapId, x, y, delaySeconds]` per stop, in NodeIndex order. */
  readonly stops: readonly (readonly [number, number, number, number])[];
}

export interface TaxiCounts {
  readonly nodes: number;
  readonly flights: number;
  readonly pairs: number;
  readonly transports: number;
  readonly stops: number;
  readonly shapePoints: number;
  readonly rawPathPoints: number;
  /** `TaxiPath` rows with `Cost` > 0. */
  readonly paidPaths: number;
  /** Paid paths not carried, with the reason, ascending by path id. */
  readonly excludedPaidPaths: readonly { readonly pathId: number; readonly reason: string }[];
  /**
   * `TaxiPath` rows with `Cost` 0 and no stop, not carried (quest, class and free flights among
   * them, such as Rut'theran Village to Auberdine), ascending: the file holds paid flights only.
   */
  readonly unpaidPathsWithoutStops: readonly number[];
}

export interface TaxiBuild {
  readonly nodes: readonly TaxiNodeOut[];
  readonly flights: readonly TaxiFlightOut[];
  readonly transports: readonly TaxiTransportOut[];
  readonly counts: TaxiCounts;
}

function pointsByPath(points: readonly TaxiPathPointRow[]): ReadonlyMap<number, readonly TaxiPathPointRow[]> {
  const out = new Map<number, TaxiPathPointRow[]>();
  for (const point of points) {
    const list = out.get(point.pathId);
    if (list === undefined) out.set(point.pathId, [point]);
    else list.push(point);
  }
  for (const [pathId, list] of out) {
    list.sort((a, b) => a.index - b.index || a.id - b.id);
    for (let i = 1; i < list.length; i += 1) {
      if (list[i]?.index === list[i - 1]?.index) throw new Error(`TaxiPathNode: path ${String(pathId)} repeats NodeIndex ${String(list[i]?.index)}`);
    }
  }
  return out;
}

function length3d(points: readonly TaxiPathPointRow[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a !== undefined && b !== undefined) total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return total;
}

/** Consecutive repeats removed. */
function mapSequence(points: readonly TaxiPathPointRow[]): number[] {
  const out: number[] = [];
  for (const p of points) if (out[out.length - 1] !== p.mapId) out.push(p.mapId);
  return out;
}

export function buildTaxi(rows: Pick<ClientTableRows, 'taxiNodes' | 'taxiPaths' | 'taxiPathPoints'>): TaxiBuild {
  const nodes = new Map<number, TaxiNodeRow>(rows.taxiNodes.map((n) => [n.id, n]));
  const byPath = pointsByPath(rows.taxiPathPoints);
  const paths: readonly TaxiPathRow[] = byId(rows.taxiPaths);
  const flights: TaxiFlightOut[] = [];
  const excluded: { pathId: number; reason: string }[] = [];
  const used = new Set<number>();
  let rawPathPoints = 0;
  let shapePoints = 0;
  for (const path of paths) {
    if (!(path.cost > 0)) continue;
    const from = nodes.get(path.from);
    const to = nodes.get(path.to);
    const points = byPath.get(path.id) ?? [];
    const reason =
      from === undefined || to === undefined
        ? `a node is not in TaxiNodes (${String(path.from)} → ${String(path.to)})`
        : from.mapId !== to.mapId
          ? `its nodes are on maps ${String(from.mapId)} and ${String(to.mapId)}`
          : !TAXI_FLIGHT_MAPS.includes(from.mapId)
            ? `its nodes are on map ${String(from.mapId)}`
            : points.length < 2
              ? `it has ${String(points.length)} TaxiPathNode points`
              : points.some((p) => p.mapId !== from.mapId)
                ? `its TaxiPathNode points leave map ${String(from.mapId)}`
                : null;
    if (reason !== null || from === undefined || to === undefined) {
      excluded.push({ pathId: path.id, reason: reason ?? 'unreachable' });
      continue;
    }
    if (points.some((p) => p.delay > 0)) throw new Error(`TaxiPath ${String(path.id)} has Cost > 0 and a stop (Delay > 0); SIMULATION §6.3 says paid paths have none`);
    const planar = points.map((p): readonly [number, number] => [p.x, p.y]);
    const kept = simplifyIndices(planar, TAXI_SHAPE_TOLERANCE_YD).flatMap((i) => {
      const p = planar[i];
      return p === undefined ? [] : [p];
    });
    rawPathPoints += points.length;
    shapePoints += kept.length;
    used.add(from.id);
    used.add(to.id);
    flights.push({ pathId: path.id, from: from.id, to: to.id, l3d: Math.round(length3d(points)), shape: deltaCode(kept) });
  }
  const pairs = new Set(flights.map((f) => `${String(Math.min(f.from, f.to))}-${String(Math.max(f.from, f.to))}`));
  const transports: TaxiTransportOut[] = [];
  let stops = 0;
  for (const path of paths) {
    const points = byPath.get(path.id) ?? [];
    if (!points.some((p) => p.delay > 0)) continue;
    const pathStops = points.filter((p) => p.delay > 0).map((p): readonly [number, number, number, number] => [p.mapId, Math.round(p.x), Math.round(p.y), p.delay]);
    stops += pathStops.length;
    transports.push({ pathId: path.id, maps: mapSequence(points), stops: pathStops });
  }
  const nodesOut = byId(rows.taxiNodes)
    .filter((n) => used.has(n.id))
    .map((n): TaxiNodeOut => ({
      id: n.id,
      name: n.name,
      mapId: n.mapId,
      x: Math.round(n.x),
      y: Math.round(n.y),
      alliance: hasBit(n.flags, TAXI_NODE_ALLIANCE_BIT),
      horde: hasBit(n.flags, TAXI_NODE_HORDE_BIT),
    }));
  return {
    nodes: nodesOut,
    flights,
    transports,
    counts: {
      nodes: nodesOut.length,
      flights: flights.length,
      pairs: pairs.size,
      transports: transports.length,
      stops,
      shapePoints,
      rawPathPoints,
      paidPaths: paths.filter((p) => p.cost > 0).length,
      excludedPaidPaths: excluded,
      unpaidPathsWithoutStops: paths.filter((p) => !(p.cost > 0) && !(byPath.get(p.id) ?? []).some((q) => q.delay > 0)).map((p) => p.id),
    },
  };
}

export const TAXI_COLUMNS = {
  'nodes[].id': 'TaxiNodes.ID',
  'nodes[].name': 'TaxiNodes.Name_lang',
  'nodes[].mapId': 'TaxiNodes.ContinentID',
  'nodes[].x': 'TaxiNodes.Pos[0], rounded to 1 yd',
  'nodes[].y': 'TaxiNodes.Pos[1], rounded to 1 yd',
  'nodes[].alliance': 'TaxiNodes.Flags bit 0 (value 1); the decode is INFERRED from Era usage',
  'nodes[].horde': 'TaxiNodes.Flags bit 1 (value 2); the decode is INFERRED from Era usage',
  'flights[].pathId': 'TaxiPath.ID',
  'flights[].from': 'TaxiPath.FromTaxiNode',
  'flights[].to': 'TaxiPath.ToTaxiNode',
  'flights[].l3d': 'the sum of the 3D distances between consecutive TaxiPathNode.Loc of the path in NodeIndex order (yards), rounded to 1 yd',
  'flights[].shape': `TaxiPathNode.Loc[0] and Loc[1] of the path in NodeIndex order, simplified by Douglas-Peucker at ${String(TAXI_SHAPE_TOLERANCE_YD)} yd, rounded to 1 yd and delta-coded [x0, y0, dx1, dy1, ...]`,
  'transports[].pathId': 'TaxiPath.ID',
  'transports[].maps': 'TaxiPathNode.ContinentID of the path in NodeIndex order, consecutive repeats removed',
  'transports[].stops': '[TaxiPathNode.ContinentID, Loc[0] and Loc[1] rounded to 1 yd, Delay (seconds)] of each point of the path with Delay > 0, in NodeIndex order',
} as const;

export const TAXI_SELECTION = {
  flights: `TaxiPath rows with Cost > 0 whose FromTaxiNode and ToTaxiNode and every TaxiPathNode point lie on one of maps ${TAXI_FLIGHT_MAPS.join(' and ')}; directed, ascending by path id`,
  nodes: 'the TaxiNodes rows the flights start or end at, ascending by id',
  transports: 'TaxiPath rows with a TaxiPathNode point whose Delay > 0 (the transport paths; which service each is stays to be inferred), ascending by path id',
} as const;

// ---------------------------------------------------------------------------------------------
// C: zone faction and sanctuary

export interface ZoneOut {
  readonly areaId: number;
  readonly mapId: number;
  readonly name: string;
  readonly factionGroupMask: number;
  readonly sanctuary: boolean;
}

export interface ZonesBuild {
  readonly zones: readonly ZoneOut[];
  readonly counts: { readonly zones: number; readonly factionGroupMask: Readonly<Record<string, number>>; readonly sanctuary: number };
}

export function buildZones(rows: { readonly areas: readonly AreaRow[]; readonly assignments: readonly AssignmentRow[] }): ZonesBuild {
  const areas = new Map(rows.areas.map((a) => [a.id, a]));
  const ids = [...new Set(rows.assignments.map((a) => a.areaId).filter((id) => id > 0))].sort((a, b) => a - b);
  const zones = ids.map((id): ZoneOut => {
    const area = areas.get(id);
    if (area === undefined) throw new Error(`UiMapAssignment names AreaTable ${String(id)}, which is not decoded (an encrypted section?)`);
    if (area.parentId !== 0) throw new Error(`UiMapAssignment names AreaTable ${String(id)}, a subzone of ${String(area.parentId)}; the zone file expects top-level areas`);
    return { areaId: id, mapId: area.mapId, name: area.name, factionGroupMask: area.factionGroupMask, sanctuary: hasBit(area.flags0, AREA_SANCTUARY_BIT) };
  });
  const masks: Record<string, number> = {};
  for (const z of [...zones].sort((a, b) => a.factionGroupMask - b.factionGroupMask)) masks[String(z.factionGroupMask)] = (masks[String(z.factionGroupMask)] ?? 0) + 1;
  return { zones, counts: { zones: zones.length, factionGroupMask: masks, sanctuary: zones.filter((z) => z.sanctuary).length } };
}

export const ZONE_COLUMNS = {
  'zones[].areaId': 'AreaTable.ID',
  'zones[].mapId': 'AreaTable.ContinentID',
  'zones[].name': 'AreaTable.AreaName_lang',
  'zones[].factionGroupMask': 'AreaTable.FactionGroupMask (2 Alliance, 4 Horde, 6 both, 0 none; the decode is INFERRED from the FactionGroup bit convention)',
  'zones[].sanctuary': 'AreaTable.Flags[0] bit 0x800 (sanctuary by the wowdev convention; the decode is INFERRED)',
} as const;

export const ZONE_SELECTION = {
  zones: 'every AreaTable row that a UiMapAssignment row names as its AreaID (the zones, cities, battlegrounds and new Forever zones of the world map), ascending by id',
} as const;

// ---------------------------------------------------------------------------------------------
// E: dungeon tuning levels (and the instance maps they belong to)

export interface LfgOut {
  readonly id: number;
  readonly name: string;
  readonly contentTuningId: number;
  readonly minLevelSquish: number;
  readonly maxLevelSquish: number;
  readonly lfgMinLevel: number;
  readonly lfgMaxLevel: number;
}

export interface InstanceMapOut {
  readonly id: number;
  readonly name: string;
  readonly instanceType: number;
  readonly areaIds: readonly number[];
}

export interface DungeonsBuild {
  readonly lfg: readonly LfgOut[];
  readonly instanceMaps: readonly InstanceMapOut[];
  readonly counts: { readonly lfgRows: number; readonly instanceMaps: number; readonly dungeonMaps: number; readonly raidMaps: number };
}

export function buildDungeons(rows: {
  readonly lfg: readonly LfgRow[];
  readonly contentTuning: readonly ContentTuningRow[];
  readonly maps: readonly MapRow[];
  readonly areas: readonly AreaRow[];
}): DungeonsBuild {
  const tuning = new Map(rows.contentTuning.map((t) => [t.id, t]));
  const lfg = byId(rows.lfg)
    .filter((r) => r.typeId === LFG_DUNGEON_TYPE_ID)
    .map((r): LfgOut => {
      const t = tuning.get(r.contentTuningId);
      if (t === undefined) throw new Error(`LFGDungeons ${String(r.id)} names ContentTuning ${String(r.contentTuningId)}, which is not in the table`);
      return { id: r.id, name: r.name, contentTuningId: r.contentTuningId, minLevelSquish: t.minLevelSquish, maxLevelSquish: t.maxLevelSquish, lfgMinLevel: t.lfgMinLevel, lfgMaxLevel: t.lfgMaxLevel };
    });
  const instanceMaps = byId(rows.maps)
    .filter((m) => INSTANCE_TYPES.includes(m.instanceType))
    .map((m): InstanceMapOut => ({
      id: m.id,
      name: m.name,
      instanceType: m.instanceType,
      areaIds: rows.areas.filter((a) => a.parentId === 0 && a.mapId === m.id).map((a) => a.id).sort((a, b) => a - b),
    }));
  return {
    lfg,
    instanceMaps,
    counts: {
      lfgRows: lfg.length,
      instanceMaps: instanceMaps.length,
      dungeonMaps: instanceMaps.filter((m) => m.instanceType === 1).length,
      raidMaps: instanceMaps.filter((m) => m.instanceType === 2).length,
    },
  };
}

export const DUNGEON_COLUMNS = {
  'lfg[].id': 'LFGDungeons.ID (the row)',
  'lfg[].name': 'LFGDungeons.Name_lang',
  'lfg[].contentTuningId': 'LFGDungeons.ContentTuningID',
  'lfg[].minLevelSquish': 'ContentTuning.MinLevelSquish of that ContentTuning row (the "LFG tuning level"; its meaning is unverified)',
  'lfg[].maxLevelSquish': 'ContentTuning.MaxLevelSquish of that row',
  'lfg[].lfgMinLevel': 'ContentTuning.LfgMinLevel of that row (0: none set)',
  'lfg[].lfgMaxLevel': 'ContentTuning.LfgMaxLevel of that row (0: none set)',
  'instanceMaps[].id': 'Map.ID',
  'instanceMaps[].name': 'Map.MapName_lang',
  'instanceMaps[].instanceType': 'Map.InstanceType (1 dungeon, 2 raid)',
  'instanceMaps[].areaIds': 'AreaTable.ID of the rows with ParentAreaID 0 and ContinentID equal to the map (the instance\'s top-level areas), ascending',
} as const;

export const DUNGEON_SELECTION = {
  lfg: `LFGDungeons rows with TypeID ${String(LFG_DUNGEON_TYPE_ID)} (the dungeon and raid rows; the zone rows are 4 and the battlegrounds 5), ascending by id`,
  instanceMaps: 'Map rows with InstanceType 1 or 2, ascending by id',
} as const;
