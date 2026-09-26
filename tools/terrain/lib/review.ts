import { z } from 'zod';
import type { Census, ComponentRow, SpawnId } from './census';
import type { Stage2Settings } from './settings';
import type { WaterSplit } from './water';

/**
 * The reviewed census (`tools/terrain/inputs/census-reviewed.json`, terrain-navigation.md §12;
 * gates G6 and G9) and the gate itself. Components are matched by map and anchor, never by index.
 *
 * The gate fails when:
 * - an off-main component or an unsnapped spawn has no reviewed entry;
 * - a spawn in the main component stands over a containing off-main floor of at least 20 polygons
 *   whose component has no reviewed entry in `overOffMainFloor` (RC-05);
 * - a reviewed component's spawn count grows by more than the tolerance (10%), in either list;
 * - a zone with at least 50 spawns keeps less than 90% of them (or the zone entry's `minShare`)
 *   in its dominant component, or that component is not main and the zone is not reviewed (RC-02);
 * - a part the water rule splits off (other than the largest) has no reviewed entry (G9).
 * Reviewed entries that no longer match anything are warnings (a pin bump may resolve them).
 */

export const REASONS = [
  'transport',
  'teleport-connector-missing',
  'elevator-connector-missing',
  'upper-floor',
  'enclosed',
  'unreachable-terrain',
  'floor-ambiguous',
  'mesh-break-suspected',
  'no-mesh',
  'island',
  'other',
] as const;

const anchor = z.strictObject({ kind: z.enum(['npc', 'object']), id: z.number().int().positive(), index: z.number().int().min(0) });

const componentEntry = z.strictObject({
  map: z.number().int().min(0),
  anchor,
  reason: z.enum(REASONS),
  spawns: z.number().int().positive(),
  polygons: z.number().int().positive().optional(),
  zones: z.array(z.string()).optional(),
  connectors: z.array(z.string()).optional(),
  note: z.string().optional(),
});

const reviewedFile = z.strictObject({
  $comment: z.array(z.string()).optional(),
  schema: z.literal(1),
  kind: z.literal('nav-census-reviewed'),
  components: z.array(componentEntry),
  overOffMainFloor: z.array(componentEntry),
  unsnapped: z.array(z.strictObject({ map: z.number().int().min(0), kind: z.enum(['npc', 'object']), id: z.number().int().positive(), index: z.number().int().min(0), reason: z.enum(REASONS), note: z.string().optional() })),
  zones: z.array(z.strictObject({ map: z.number().int().min(0), zone: z.number().int().positive(), name: z.string().optional(), reason: z.enum(REASONS), minShare: z.number().min(0).max(1).optional(), note: z.string().optional() })),
  waterSplits: z.array(z.strictObject({ map: z.number().int().min(0), zone: z.number().int().min(0), polygons: z.number().int().positive(), centroid: z.tuple([z.number(), z.number()]), reason: z.enum(REASONS), note: z.string().optional() })),
  mustConnectExceptions: z.array(
    z.strictObject({
      map: z.number().int().min(0),
      fixture: z.string(),
      spawn: anchor,
      polygons: z.number().int().positive(),
      zMin: z.number(),
      zMax: z.number(),
      reason: z.enum(REASONS),
      note: z.string().optional(),
    }),
  ),
});

export type ReviewedFile = z.infer<typeof reviewedFile>;
export type ComponentEntry = z.infer<typeof componentEntry>;

export function parseReviewed(value: unknown): ReviewedFile {
  const parsed = reviewedFile.safeParse(value);
  if (!parsed.success) throw new Error(`census-reviewed.json: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const seen = new Set<string>();
  for (const [list, entries] of [['components', parsed.data.components], ['overOffMainFloor', parsed.data.overOffMainFloor]] as const) {
    for (const e of entries) {
      // one spawn can stand over two isolated floors, so an anchor may repeat when the sizes tell the entries apart
      const k = `${list}:${String(e.map)}:${anchorKey(e.anchor)}:${String(e.polygons ?? '')}`;
      if (seen.has(k)) throw new Error(`census-reviewed.json: ${list} lists anchor ${anchorKey(e.anchor)} on map ${String(e.map)} twice`);
      seen.add(k);
    }
    const repeated = new Map<string, number>();
    for (const e of entries) repeated.set(`${String(e.map)}:${anchorKey(e.anchor)}`, (repeated.get(`${String(e.map)}:${anchorKey(e.anchor)}`) ?? 0) + 1);
    for (const e of entries) {
      if ((repeated.get(`${String(e.map)}:${anchorKey(e.anchor)}`) ?? 0) > 1 && e.polygons === undefined) throw new Error(`census-reviewed.json: ${list} repeats anchor ${anchorKey(e.anchor)} on map ${String(e.map)}; each such entry needs "polygons"`);
    }
  }
  return parsed.data;
}

/** The reviewed entry of a component row: same map and anchor; with several, the one nearest in size. */
export function matchEntry(entries: readonly ComponentEntry[], mapId: number, row: ComponentRow): ComponentEntry | undefined {
  const same = entries.filter((e) => e.map === mapId && anchorKey(e.anchor) === anchorKey(row.anchor));
  if (same.length <= 1) return same[0];
  return [...same].sort((a, b) => Math.abs((a.polygons ?? 0) - row.polygons) - Math.abs((b.polygons ?? 0) - row.polygons))[0];
}

export const anchorKey = (a: SpawnId): string => `${a.kind}:${String(a.id)}:${String(a.index)}`;

export interface GateResult {
  readonly failures: string[];
  readonly warnings: string[];
  /** Reviewed rows per reason (spawns), for the report. */
  readonly byReason: Record<string, { components: number; spawns: number }>;
}

const describe = (r: ComponentRow, names: (zone: number) => string): string =>
  `anchor ${anchorKey(r.anchor)}: ${String(r.spawns)} spawns, ${String(r.polygons)} polygons, zones ${r.zones.map(([z, n]) => `${names(z)} ${String(n)}`).join(', ')}; ${r.sample.join(' ')}`;

/** A split part matches a reviewed entry on the same map and zone, within 25% in size and 200 yd. */
export function splitMatches(e: ReviewedFile['waterSplits'][number], mapId: number, part: WaterSplit['parts'][number]): boolean {
  const dx = e.centroid[0] - part.centroid[0];
  const dy = e.centroid[1] - part.centroid[1];
  return e.map === mapId && e.zone === part.zone && Math.abs(part.polygons - e.polygons) <= 0.25 * e.polygons && dx * dx + dy * dy <= 200 * 200;
}

export function censusGate(c: Census, splits: readonly WaterSplit[], reviewed: ReviewedFile, st: Stage2Settings, names: (zone: number) => string = String): GateResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const byReason: Record<string, { components: number; spawns: number }> = {};
  const tol = st.census.growthTolerance;
  const lists: readonly (readonly ['components' | 'overOffMainFloor', readonly ComponentRow[]])[] = [
    ['components', c.offMain],
    ['overOffMainFloor', c.overOffMainFloor],
  ];
  for (const [list, rows] of lists) {
    const entries = reviewed[list].filter((e) => e.map === c.mapId);
    const used = new Set<ComponentEntry>();
    for (const r of rows) {
      const k = anchorKey(r.anchor);
      const e = matchEntry(entries, c.mapId, r);
      const what = list === 'components' ? 'off-main component' : 'off-main floor under or over main spawns';
      if (e === undefined || used.has(e)) {
        failures.push(`map ${String(c.mapId)}: unreviewed ${what}, ${describe(r, names)}`);
        continue;
      }
      used.add(e);
      if (r.spawns > e.spawns * (1 + tol)) failures.push(`map ${String(c.mapId)}: reviewed ${what} ${k} grew from ${String(e.spawns)} to ${String(r.spawns)} spawns (more than ${String(Math.round(tol * 100))}%)`);
      const b = (byReason[`${list}:${e.reason}`] ??= { components: 0, spawns: 0 });
      b.components += 1;
      b.spawns += r.spawns;
    }
    for (const e of entries) if (!used.has(e)) warnings.push(`map ${String(c.mapId)}: reviewed ${list} entry ${anchorKey(e.anchor)} matches no component of this build`);
  }
  const unsnapped = new Set(reviewed.unsnapped.filter((e) => e.map === c.mapId).map((e) => anchorKey(e)));
  const seenUnsnapped = new Set<string>();
  for (const s of c.unsnapped) {
    const k = anchorKey(s);
    seenUnsnapped.add(k);
    if (!unsnapped.has(k)) failures.push(`map ${String(c.mapId)}: unreviewed unsnapped spawn ${k} (no polygon within the snap radius)`);
  }
  for (const k of unsnapped) if (!seenUnsnapped.has(k)) warnings.push(`map ${String(c.mapId)}: reviewed unsnapped spawn ${k} now snaps`);
  const zoneEntries = new Map(reviewed.zones.filter((z) => z.map === c.mapId).map((z) => [z.zone, z]));
  for (const z of c.zones) {
    if (z.spawns < st.census.zoneMinSpawns) continue;
    const e = zoneEntries.get(z.zone);
    const min = e?.minShare ?? st.census.zoneMinShare;
    if (z.dominantShare < min) failures.push(`map ${String(c.mapId)}: zone ${names(z.zone)} keeps ${(z.dominantShare * 100).toFixed(1)}% of its ${String(z.spawns)} spawns in its dominant component (at least ${(min * 100).toFixed(0)}% required)`);
    if (z.dominant !== 0 && e === undefined) failures.push(`map ${String(c.mapId)}: zone ${names(z.zone)}'s dominant component is not main and the zone is not reviewed`);
  }
  for (const s of splits) {
    s.parts.slice(1).forEach((part) => {
      if (!reviewed.waterSplits.some((e) => splitMatches(e, c.mapId, part))) {
        failures.push(`map ${String(c.mapId)}: unreviewed water split, a ${String(part.polygons)}-polygon part in ${names(part.zone)} at (${String(part.centroid[0])}, ${String(part.centroid[1])}) of a ${String(s.fullPolygons)}-polygon component`);
      }
    });
  }
  return { failures, warnings, byReason };
}
