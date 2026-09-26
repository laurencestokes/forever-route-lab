import { createHash } from 'node:crypto';
import type { Components } from './components';
import type { MapMesh } from './link';
import { snap, type SnapIndex, type SnapResult } from './snap';
import { compareSpawnKeys, type Spawn, type SpawnKind } from './spawns';

/**
 * The spawn census (terrain-navigation.md §12; D-030, TN-01, TN-11, TN-13, RC-02, RC-05). Every
 * dataset spawn with a world point on the map is snapped with the runtime rules (§8.1). Off-main
 * spawns are grouped **by component**, each identified by its **anchor**, the lowest
 * (kind, id, index) among the spawns in it, which survives rebuilds whereas component indices do
 * not. Spawns in the main component that stand over a containing off-main floor of at least
 * `floorMin` polygons are grouped by that floor's component the same way (RC-05).
 */

export interface SpawnId {
  readonly kind: SpawnKind;
  readonly id: number;
  readonly index: number;
}

export interface SpawnSnap {
  readonly spawn: Spawn;
  /** Zone hint: the spawn's area key rolled up to its top-level zone. */
  readonly hint: number;
  readonly snap: SnapResult;
  /** Component of the snapped polygon, −1 when none is within the radius. */
  readonly comp: number;
}

export interface ComponentRow {
  readonly comp: number;
  readonly polygons: number;
  readonly anchor: SpawnId;
  readonly spawns: number;
  /** Spawn hint zones, most spawns first. */
  readonly zones: readonly (readonly [number, number])[];
  /** Polygon zones of the component, most polygons first (at most five). */
  readonly polygonZones: readonly (readonly [number, number])[];
  /** Up to eight distinct entities, as `n<id>` or `o<id>`. */
  readonly sample: readonly string[];
}

export interface ZoneRow {
  readonly zone: number;
  readonly spawns: number;
  readonly dominant: number;
  readonly dominantSpawns: number;
  readonly dominantShare: number;
  readonly mainShare: number;
}

export interface CensusCounts {
  spawns: number;
  main: number;
  offMain: number;
  none: number;
  ambiguous: number;
  overOffMainFloor: number;
  reassigned: number;
  hintUsed: number;
  hintMiss: number;
  spanOver20: number;
  offBySize: Record<string, number>;
}

export interface Census {
  readonly mapId: number;
  readonly results: readonly SpawnSnap[];
  readonly counts: CensusCounts;
  readonly offMain: readonly ComponentRow[];
  readonly overOffMainFloor: readonly ComponentRow[];
  readonly unsnapped: readonly SpawnId[];
  readonly zones: readonly ZoneRow[];
}

export interface CensusOptions {
  /** Rule B threshold (20). */
  readonly minComp: number;
  /** Smallest off-main floor the over-a-floor class counts (20). */
  readonly floorMin: number;
}

const idOf = (s: Spawn): SpawnId => ({ kind: s.kind, id: s.id, index: s.index });
const sizeClass = (n: number): string => (n < 20 ? '<20' : n < 200 ? '20-199' : n < 2000 ? '200-1999' : '>=2000');

function tally(values: Iterable<number>): [number, number][] {
  const m = new Map<number, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
}

function rows(g: MapMesh, c: Components, groups: Map<number, SpawnSnap[]>): ComponentRow[] {
  const polyZones = new Map<number, Map<number, number>>();
  for (const comp of groups.keys()) polyZones.set(comp, new Map());
  for (let p = 0; p < g.n; p += 1) {
    const m = polyZones.get(c.comp[p] ?? -1);
    if (m !== undefined) m.set(g.zone[p] ?? 0, (m.get(g.zone[p] ?? 0) ?? 0) + 1);
  }
  const out: ComponentRow[] = [];
  for (const [comp, list] of groups) {
    const sorted = [...list].sort((a, b) => compareSpawnKeys(a.spawn, b.spawn));
    const first = sorted[0];
    if (first === undefined) continue;
    const sample: string[] = [];
    for (const r of sorted) {
      const k = `${r.spawn.kind === 'npc' ? 'n' : 'o'}${String(r.spawn.id)}`;
      if (!sample.includes(k)) sample.push(k);
      if (sample.length === 8) break;
    }
    out.push({
      comp,
      polygons: c.sizes[comp] ?? 0,
      anchor: idOf(first.spawn),
      spawns: list.length,
      zones: tally(list.map((r) => r.hint)),
      polygonZones: [...(polyZones.get(comp) ?? new Map<number, number>())].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 5),
      sample,
    });
  }
  return out.sort((a, b) => b.spawns - a.spawns || compareSpawnKeys(a.anchor, b.anchor));
}

/** Snaps every spawn of the map (`hintOf` gives each spawn's zone hint) and groups the results. */
export function runCensus(mapId: number, si: SnapIndex, c: Components, spawns: readonly Spawn[], hintOf: (s: Spawn) => number, opt: CensusOptions): Census {
  const g = si.g;
  const results: SpawnSnap[] = [];
  const counts: CensusCounts = { spawns: 0, main: 0, offMain: 0, none: 0, ambiguous: 0, overOffMainFloor: 0, reassigned: 0, hintUsed: 0, hintMiss: 0, spanOver20: 0, offBySize: {} };
  const off = new Map<number, SpawnSnap[]>();
  const over = new Map<number, SpawnSnap[]>();
  const unsnapped: SpawnId[] = [];
  for (const s of spawns) {
    if (s.mapId !== mapId) continue;
    const hint = hintOf(s);
    const r = snap(si, c.comp, c.sizes, s.x, s.y, hint, opt.minComp);
    const comp = r.poly < 0 ? -1 : (c.comp[r.poly] ?? -1);
    const row: SpawnSnap = { spawn: s, hint, snap: r, comp };
    results.push(row);
    counts.spawns += 1;
    if (r.flags.ambiguous) counts.ambiguous += 1;
    if (r.flags.reassigned) counts.reassigned += 1;
    if (r.flags.hint === 'used') counts.hintUsed += 1;
    else if (r.flags.hint === 'miss') counts.hintMiss += 1;
    if (r.flags.spanYd > 20) counts.spanOver20 += 1;
    if (comp < 0) {
      counts.none += 1;
      unsnapped.push(idOf(s));
    } else if (comp === 0) {
      counts.main += 1;
      const floorComps = new Set<number>();
      for (const p of r.floors) {
        const fc = c.comp[p] ?? -1;
        if (fc > 0 && (c.sizes[fc] ?? 0) >= opt.floorMin) floorComps.add(fc);
      }
      if (floorComps.size > 0) counts.overOffMainFloor += 1;
      for (const fc of floorComps) {
        const list = over.get(fc);
        if (list === undefined) over.set(fc, [row]);
        else list.push(row);
      }
    } else {
      counts.offMain += 1;
      const k = sizeClass(c.sizes[comp] ?? 0);
      counts.offBySize[k] = (counts.offBySize[k] ?? 0) + 1;
      const list = off.get(comp);
      if (list === undefined) off.set(comp, [row]);
      else list.push(row);
    }
  }
  // zones: share of each zone's spawns in its dominant component (RC-02) and in main
  const byZone = new Map<number, SpawnSnap[]>();
  for (const r of results) {
    const list = byZone.get(r.hint);
    if (list === undefined) byZone.set(r.hint, [r]);
    else list.push(r);
  }
  const zones: ZoneRow[] = [];
  for (const [zone, list] of [...byZone].sort((a, b) => a[0] - b[0])) {
    const t = tally(list.filter((r) => r.comp >= 0).map((r) => r.comp)).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const [dominant, dominantSpawns] = t[0] ?? [-1, 0];
    const main = list.filter((r) => r.comp === 0).length;
    zones.push({ zone, spawns: list.length, dominant, dominantSpawns, dominantShare: dominantSpawns / list.length, mainShare: main / list.length });
  }
  unsnapped.sort(compareSpawnKeys);
  return { mapId, results, counts, offMain: rows(g, c, off), overOffMainFloor: rows(g, c, over), unsnapped, zones };
}

/** The canonical summary of a census (no component indices, which change between builds). */
export function censusSummary(c: Census): unknown {
  const row = (r: ComponentRow): unknown => ({ anchor: r.anchor, polygons: r.polygons, spawns: r.spawns, zones: r.zones });
  return {
    mapId: c.mapId,
    counts: c.counts,
    offMain: c.offMain.map(row),
    overOffMainFloor: c.overOffMainFloor.map(row),
    unsnapped: c.unsnapped,
    zones: c.zones.map((z) => ({ zone: z.zone, spawns: z.spawns, dominantIsMain: z.dominant === 0, dominantSpawns: z.dominantSpawns, main: Math.round(z.mainShare * z.spawns) })),
  };
}

export const censusHash = (c: Census): string => createHash('sha256').update(JSON.stringify(censusSummary(c))).digest('hex');
